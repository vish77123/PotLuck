import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requireCrewAccess } from "./lib/access";
import { averageFinish } from "../lib/monopoly/stats";

type Summary = Doc<"mGameSummaries">;

function aggregate(rows: Summary[]) {
  return {
    games: rows.length,
    wins: rows.filter((r) => r.finishPosition === 1).length,
    avgFinish: averageFinish(rows.map((r) => r.finishPosition)),
    rentEarned: rows.reduce((s, r) => s + r.rentEarned, 0),
    stakeNet: rows.reduce((s, r) => s + r.stakeNet, 0),
  };
}

/** Property-game stats for every member of a crew: games, wins, average finish, total rent earned. Reads summary rows only. */
export const leaderboard = query({
  args: { crewId: v.id("crews") },
  handler: async (ctx, { crewId }) => {
    await requireCrewAccess(ctx, crewId);
    const members = await ctx.db
      .query("crewMembers")
      .withIndex("by_crew", (q) => q.eq("crewId", crewId))
      .take(200);
    const rows = await ctx.db
      .query("mGameSummaries")
      .withIndex("by_crew", (q) => q.eq("crewId", crewId))
      .take(5000);
    const by = new Map<Id<"crewMembers">, Summary[]>();
    for (const r of rows) by.set(r.crewMemberId, [...(by.get(r.crewMemberId) ?? []), r]);
    return members
      .map((m) => ({ memberId: m._id, name: m.name, ...aggregate(by.get(m._id) ?? []) }))
      .filter((m) => m.games > 0)
      .sort((a, b) => b.wins - a.wins || (a.avgFinish ?? 99) - (b.avgFinish ?? 99) || b.rentEarned - a.rentEarned || a.name.localeCompare(b.name));
  },
});

/** One player's property-game numbers in a crew. */
export const profile = query({
  args: { crewId: v.id("crews"), memberId: v.id("crewMembers") },
  handler: async (ctx, { crewId, memberId }) => {
    await requireCrewAccess(ctx, crewId);
    const member = await ctx.db.get(memberId);
    if (!member || member.crewId !== crewId) return null;
    const mine = await ctx.db
      .query("mGameSummaries")
      .withIndex("by_member", (q) => q.eq("crewMemberId", memberId))
      .order("desc")
      .take(500);
    return {
      ...aggregate(mine),
      recent: mine.slice(0, 10).map((r) => ({ position: r.finishPosition, players: r.players, rentEarned: r.rentEarned, endedAt: r.endedAt })),
    };
  },
});
