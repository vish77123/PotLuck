import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { getPlayerInSession, requireActivePlayer } from "./lib/access";
import { fail } from "./lib/errors";
import { activeGameOf, participantOf } from "./lib/game";
import { applyEntry, getWallet, withIdempotency } from "./lib/ledger";
import { assertAmount } from "./lib/validators";

export const topUp = mutation({
  args: { sessionId: v.id("sessions"), amount: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, { sessionId, amount, idempotencyKey }) => {
    const { userId, player } = await requireActivePlayer(ctx, sessionId);
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
