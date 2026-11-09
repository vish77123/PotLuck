import { v } from "convex/values";
import { query } from "./_generated/server";
import { requirePlayer } from "./lib/access";
import { computeNets } from "./lib/nets";
import { settleUp } from "../lib/settle";

/** Per-player nets and the settle-up list. Used live in the wallet and in the report. */
export const settlement = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    await requirePlayer(ctx, sessionId);
    const nets = await computeNets(ctx, sessionId);
    const total = nets.reduce((s, n) => s + n.net, 0);
    // While a game is open its pool belongs to nobody yet, so nets don't balance; no transfers until it closes.
    const transfers = total === 0 ? settleUp(nets.map((n) => ({ id: n.playerId, net: n.net }))) : null;
    return { nets, transfers };
  },
});

/** Every undo in the session, newest first, with what was undone. Shown to the host and in the report. */
export const undoLog = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    await requirePlayer(ctx, sessionId);
    const reversals = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_session_type", (q) => q.eq("sessionId", sessionId).eq("type", "REVERSAL"))
      .order("desc")
      .take(200);
    const rows = await Promise.all(
      reversals.map(async (r) => {
        const original = r.reversesEntryId ? await ctx.db.get(r.reversesEntryId) : null;
        const playerId = original?.fromPlayerId ?? original?.toPlayerId;
        const player = playerId ? await ctx.db.get(playerId) : null;
        const by = await ctx.db.get(r.createdByPlayerId);
        return {
          reversalId: r._id,
          at: r.createdAt,
          type: r.reversesType ?? null,
          amount: r.amount,
          playerName: player?.name ?? "Someone",
          byName: by?.name ?? "Host",
          reason: (r.meta?.reason as string | undefined) ?? null,
          gameId: r.gameId ?? null,
        };
      }),
    );
    return rows;
  },
});
