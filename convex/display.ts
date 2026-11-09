import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./lib/access";
import { normalizeCode } from "./sessions";

/**
 * Read-only view for a TV or laptop in the middle of the table. That device has no seat, so like the join
 * screen it's keyed by the room code. It exposes only what's already public at the table: names, wallets, pool, feed.
 */
export const view = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    await requireUser(ctx);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", normalizeCode(code)))
      .unique();
    if (!session) return null;
    const players = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    const wallets = await ctx.db
      .query("wallets")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    const game = await ctx.db
      .query("games")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .order("desc")
      .first();
    const participants = game
      ? await ctx.db.query("gameParticipants").withIndex("by_game", (q) => q.eq("gameId", game._id)).collect()
      : [];
    const entries = game
      ? await ctx.db.query("ledgerEntries").withIndex("by_game", (q) => q.eq("gameId", game._id)).order("desc").take(14)
      : [];
    const name = (id?: string) => players.find((p) => p._id === id)?.name ?? "Someone";
    const undone = new Set(entries.filter((e) => e.type === "REVERSAL").map((e) => e.reversesEntryId as string));
    return {
      code: session.code,
      theme: session.theme,
      status: session.status,
      hostId: session.hostPlayerId ?? null,
      players: players.map((p) => ({
        id: p._id,
        name: p.name,
        balance: wallets.find((w) => w.sessionPlayerId === p._id)?.balance ?? 0,
        left: p.status === "left",
      })),
      game: game
        ? {
            no: game.gameNo,
            template: game.templateSnapshot.name,
            status: game.status,
            pool: game.poolAmount,
            turnId: game.currentTurnPlayerId ?? null,
            turnStartedAt: game.turnStartedAt ?? null,
            seats: participants
              .sort((a, b) => a.seatOrder - b.seatOrder)
              .map((p) => ({ id: p.sessionPlayerId, packed: p.status === "packed" })),
          }
        : null,
      feed: entries
        .filter((e) => e.type !== "REVERSAL")
        .map((e) => ({
          id: e._id,
          who: name(e.type === "PAYOUT" ? e.toPlayerId : e.fromPlayerId),
          type: e.type === "BET" ? (e.meta?.seen ? "Seen bet" : "Bet") : e.type === "BOOT" ? "Boot" : e.type === "PAYOUT" ? "Won the pot" : e.type,
          amount: e.amount,
          undone: undone.has(e._id),
        }))
        .slice(0, 8),
    };
  },
});
