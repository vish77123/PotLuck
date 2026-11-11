import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getPlayerInSession, requireActivePlayer, requirePlayer, requirePoolSession } from "./lib/access";
import { fail } from "./lib/errors";
import { activeGameOf, participantOf } from "./lib/game";
import { applyEntry, getWallet, withIdempotency } from "./lib/ledger";
import { assertAmount } from "./lib/validators";

export const topUp = mutation({
  args: { sessionId: v.id("sessions"), amount: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, { sessionId, amount, idempotencyKey }) => {
    const { userId, session, player } = await requireActivePlayer(ctx, sessionId);
    requirePoolSession(session);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      assertAmount(amount, "Top-up");
      const entry = await applyEntry(ctx, {
        sessionId,
        type: "TOP_UP",
        toPlayerId: player._id,
        amount,
        createdByPlayerId: player._id,
        idempotencyKey,
      });
      return { entryId: entry._id };
    });
  },
});

/**
 * Cash out a player's whole balance and mark them left. Players cash themselves out;
 * the host can cash out someone else (e.g. their phone died). Not allowed mid-hand.
 */
export const cashOut = mutation({
  args: { sessionId: v.id("sessions"), playerId: v.optional(v.id("sessionPlayers")), idempotencyKey: v.string() },
  handler: async (ctx, { sessionId, playerId, idempotencyKey }) => {
    const { userId, session, player: me, isHost } = await requireActivePlayer(ctx, sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      const target = playerId ? await getPlayerInSession(ctx, sessionId, playerId) : me;
      const self = target._id === me._id;
      if (!self && !isHost) fail("NOT_HOST", "Only the host can cash out another player.");
      if (target.status !== "active") fail("INVALID_STATE", `${target.name} has already cashed out.`);

      const game = await activeGameOf(ctx, sessionId);
      if (game) {
        const p = await participantOf(ctx, game._id, target._id);
        if (p?.status === "playing") {
          fail("INVALID_STATE", `${self ? "You're" : `${target.name} is`} still playing game #${game.gameNo}. Pack first.`);
        }
      }
      if (session.hostPlayerId === target._id) {
        const others = await ctx.db
          .query("sessionPlayers")
          .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
          .collect();
        if (others.some((o) => o._id !== target._id && o.status === "active")) {
          fail("INVALID_STATE", "Hand host to someone else before cashing out.");
        }
      }

      const loans = await ctx.db
        .query("loans")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .collect();
      for (const l of loans) {
        if (l.status === "requested" && (l.borrowerPlayerId === target._id || l.lenderPlayerId === target._id)) {
          await ctx.db.patch(l._id, { status: "declined", closedAt: Date.now(), meta: { reason: "cashed_out" } });
        }
      }

      const wallet = await getWallet(ctx, target._id);
      const amount = wallet.balance;
      if (amount > 0) {
        await applyEntry(ctx, {
          sessionId,
          type: "CASH_OUT",
          fromPlayerId: target._id,
          amount,
          createdByPlayerId: me._id,
          meta: self ? undefined : { byHost: true },
          idempotencyKey,
        });
      }
      await ctx.db.patch(target._id, { status: "left" });
      return { amount };
    });
  },
});

/** Everything the wallet sheet shows: totals, what's tied up in the pot, loans with names, buy-in and top-up history. */
export const overview = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const { player } = await requirePlayer(ctx, sessionId);
    const wallet = await ctx.db
      .query("wallets")
      .withIndex("by_player", (q) => q.eq("sessionPlayerId", player._id))
      .unique();

    const [buyIns, topUps, reversals] = await Promise.all([
      ctx.db.query("ledgerEntries").withIndex("by_session_type", (q) => q.eq("sessionId", sessionId).eq("type", "BUY_IN")).collect(),
      ctx.db.query("ledgerEntries").withIndex("by_session_type", (q) => q.eq("sessionId", sessionId).eq("type", "TOP_UP")).collect(),
      ctx.db.query("ledgerEntries").withIndex("by_session_type", (q) => q.eq("sessionId", sessionId).eq("type", "REVERSAL")).collect(),
    ]);
    const reversed = new Set(reversals.map((r) => r.reversesEntryId as string));
    const mine = [...buyIns, ...topUps]
      .filter((e) => e.toPlayerId === player._id)
      .sort((a, b) => a.seq - b.seq)
      .map((e) => ({ entryId: e._id, type: e.type as "BUY_IN" | "TOP_UP", amount: e.amount, at: e.createdAt, undone: reversed.has(e._id) }));
    const live = mine.filter((e) => !e.undone);

    // Money of mine that's sitting in the pot of a game that's still going.
    let inPot = 0;
    const game = await ctx.db
      .query("games")
      .withIndex("by_session_status", (q) => q.eq("sessionId", sessionId).eq("status", "active"))
      .first();
    if (game) {
      const entries = await ctx.db.query("ledgerEntries").withIndex("by_game", (q) => q.eq("gameId", game._id)).take(3000);
      const undone = new Set(entries.filter((e) => e.type === "REVERSAL").map((e) => e.reversesEntryId as string));
      for (const e of entries) {
        if ((e.type === "BOOT" || e.type === "BET") && e.fromPlayerId === player._id && !undone.has(e._id)) inPot += e.amount;
      }
    }

    const loans = await ctx.db.query("loans").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).collect();
    const names = new Map<string, string>();
    const nameOf = async (id: Id<"sessionPlayers">) => {
      if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.name ?? "Someone");
      return names.get(id)!;
    };
    const myLoans = [];
    for (const l of loans) {
      if (l.lenderPlayerId !== player._id && l.borrowerPlayerId !== player._id) continue;
      if (l.status === "declined" || l.status === "reversed") continue;
      const iAmLender = l.lenderPlayerId === player._id;
      myLoans.push({
        _id: l._id,
        role: iAmLender ? ("lender" as const) : ("borrower" as const),
        otherId: iAmLender ? l.borrowerPlayerId : l.lenderPlayerId,
        otherName: await nameOf(iAmLender ? l.borrowerPlayerId : l.lenderPlayerId),
        amount: l.amount,
        repaidAmount: l.repaidAmount,
        status: l.status,
        at: l.requestedAt,
      });
    }

    return {
      balance: wallet?.balance ?? 0,
      buyIn: live.filter((e) => e.type === "BUY_IN").reduce((s, e) => s + e.amount, 0),
      topUps: live.filter((e) => e.type === "TOP_UP").reduce((s, e) => s + e.amount, 0),
      inPot,
      history: mine,
      loans: myLoans.sort((a, b) => b.at - a.at),
    };
  },
});
