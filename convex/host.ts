import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { getPlayerInSession, requireActivePlayer, requireHost } from "./lib/access";
import { fail } from "./lib/errors";
import { participantOf } from "./lib/game";
import { findReversal, reverseEntry, withIdempotency } from "./lib/ledger";

export const HOST_STALE_MS = 2 * 60 * 1000;

const UNDOABLE = new Set(["BOOT", "BET", "TOP_UP", "LOAN", "LOAN_REPAYMENT"]);

export const undo = mutation({
  args: { entryId: v.id("ledgerEntries"), idempotencyKey: v.string() },
  handler: async (ctx, { entryId, idempotencyKey }) => {
    const entry = await ctx.db.get(entryId);
    if (!entry) fail("NOT_FOUND", "Entry not found.");
    const { userId, player: host } = await requireHost(ctx, entry.sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      if (entry.type === "REVERSAL") fail("NOT_UNDOABLE", "An undo can't be undone. Place a new entry instead.");
      if (entry.type === "PAYOUT") fail("NOT_UNDOABLE", "To undo a payout, reopen the game.");
      if (!UNDOABLE.has(entry.type)) fail("NOT_UNDOABLE", `${entry.type === "BUY_IN" ? "Buy-ins" : "Cash-outs"} can't be undone.`);
      if (await findReversal(ctx, entry._id)) fail("ALREADY_REVERSED", "That entry has already been undone.");

      let moveTurnTo: typeof entry.fromPlayerId;
      if (entry.type === "BOOT" || entry.type === "BET") {
        const game = (await ctx.db.get(entry.gameId!))!;
        if (game.status !== "active") fail("INVALID_STATE", `Game #${game.gameNo} is over — reopen it to change its bets.`);
        if (entry.type === "BET" && game.templateSnapshot.turnMode === "turn_based") {
          // Undoing the latest live bet hands the turn back to whoever placed it.
          const recent = await ctx.db
            .query("ledgerEntries")
            .withIndex("by_game", (q) => q.eq("gameId", game._id))
            .order("desc")
            .take(200);
          for (const e of recent) {
            if (e.type !== "BET" || (await findReversal(ctx, e._id))) continue;
            if (e._id === entry._id) {
              const p = await participantOf(ctx, game._id, entry.fromPlayerId!);
              if (p?.status === "playing") moveTurnTo = entry.fromPlayerId;
            }
            break;
          }
        }
      }

      let loanPatch: (() => Promise<void>) | undefined;
      if (entry.type === "LOAN" || entry.type === "LOAN_REPAYMENT") {
        const loan = (await ctx.db.get(entry.loanId!))!;
        if (entry.type === "LOAN") {
          if (loan.status !== "open") fail("INVALID_STATE", "This loan is already closed.");
          if (loan.repaidAmount > 0) fail("INVALID_STATE", "Undo the repayments on this loan first.");
          loanPatch = () => ctx.db.patch(loan._id, { status: "reversed", closedAt: Date.now() });
        } else {
          if (loan.status !== "open" && loan.status !== "repaid") fail("INVALID_STATE", "This loan is already closed.");
          loanPatch = () =>
            ctx.db.patch(loan._id, { repaidAmount: loan.repaidAmount - entry.amount, status: "open", closedAt: undefined });
        }
      }

      const reversal = await reverseEntry(ctx, entry, host._id, { meta: { undoneByName: host.name }, idempotencyKey });
      if (loanPatch) await loanPatch();
      if (moveTurnTo) await ctx.db.patch(entry.gameId!, { currentTurnPlayerId: moveTurnTo, turnStartedAt: Date.now() });
      return { reversalId: reversal._id };
    });
  },
});

export const transfer = mutation({
  args: { sessionId: v.id("sessions"), toPlayerId: v.id("sessionPlayers") },
  handler: async (ctx, { sessionId, toPlayerId }) => {
    const { session, player } = await requireHost(ctx, sessionId);
    const target = await getPlayerInSession(ctx, sessionId, toPlayerId);
    if (target._id === player._id) return null;
    if (target.status !== "active") fail("INVALID_STATE", `${target.name} has cashed out.`);
    await ctx.db.patch(sessionId, {
      hostPlayerId: target._id,
      hostHistory: [...session.hostHistory, { kind: "transfer", fromPlayerId: player._id, toPlayerId: target._id, at: Date.now() }],
    });
    return null;
  },
});

/** Any active player may take over if the host's phone hasn't been seen for 2 minutes. */
export const claim = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const { session, player, isHost } = await requireActivePlayer(ctx, sessionId);
    if (isHost) return null;
    const hostId = session.hostPlayerId!;
    const host = (await ctx.db.get(hostId))!;
    const presence = await ctx.db
      .query("presence")
      .withIndex("by_player", (q) => q.eq("sessionPlayerId", hostId))
      .unique();
    const lastSeen = presence?.lastSeenAt ?? 0;
    if (host.status === "active" && Date.now() - lastSeen < HOST_STALE_MS) {
      fail("FORBIDDEN", `${host.name} is still connected. Ask them to hand over host.`);
    }
    await ctx.db.patch(sessionId, {
      hostPlayerId: player._id,
      hostHistory: [
        ...session.hostHistory,
        { kind: "claim", fromPlayerId: hostId, toPlayerId: player._id, at: Date.now() },
      ],
    });
    return null;
  },
});
