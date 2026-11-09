import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requirePlayer } from "./lib/access";

/** Called every 20s while the app is visible. Writes only the presence table. */
export const heartbeat = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const { player } = await requirePlayer(ctx, sessionId);
    const row = await ctx.db
      .query("presence")
      .withIndex("by_player", (q) => q.eq("sessionPlayerId", player._id))
      .unique();
    const now = Date.now();
    if (row) await ctx.db.patch(row._id, { lastSeenAt: now });
    else await ctx.db.insert("presence", { sessionId, sessionPlayerId: player._id, lastSeenAt: now });
    return null;
  },
});

/** Raw last-seen times; the client decides "online" (seen in the last 45s) against its own clock. */
export const list = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    await requirePlayer(ctx, sessionId);
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .take(100);
    return rows.map((r) => ({ playerId: r.sessionPlayerId, lastSeenAt: r.lastSeenAt }));
  },
});
