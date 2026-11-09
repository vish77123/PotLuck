import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requireCrewAccess } from "./lib/access";

type Summary = Doc<"playerSessionSummaries">;

function aggregate(rows: Summary[]) {
  const sessions = rows.length;
  const totalNet = rows.reduce((s, r) => s + r.net, 0);
  const gamesWon = rows.reduce((s, r) => s + r.gamesWon, 0);
  const biggestPayout = rows.reduce((m, r) => Math.max(m, r.biggestPayout), 0);
  return { sessions, totalNet, gamesWon, biggestPayout };
}

/**
 * Crew leaderboard, best total net first. Reads the per-player summary rows written when each session
 * ended, never the ledger. `since` (ms) limits it to sessions that ended after that time ("this month").
 */
export const leaderboard = query({
  args: { crewId: v.id("crews"), since: v.optional(v.number()) },
  handler: async (ctx, { crewId, since }) => {
    const { crew } = await requireCrewAccess(ctx, crewId);
    const members = await ctx.db
      .query("crewMembers")
      .withIndex("by_crew", (q) => q.eq("crewId", crewId))
      .take(200);
    const rows = await ctx.db
      .query("playerSessionSummaries")
      .withIndex("by_crew", (q) => (since === undefined ? q.eq("crewId", crewId) : q.eq("crewId", crewId).gte("endedAt", since)))
      .take(5000);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_crew", (q) => q.eq("crewId", crewId))
      .order("asc")
      .take(500);

    const byMember = new Map<Id<"crewMembers">, Summary[]>();
    for (const r of rows) byMember.set(r.crewMemberId, [...(byMember.get(r.crewMemberId) ?? []), r]);

    const board = members
      .map((m) => ({ memberId: m._id, name: m.name, ...aggregate(byMember.get(m._id) ?? []) }))
      .filter((m) => m.sessions > 0 || since === undefined)
      .sort((a, b) => b.totalNet - a.totalNet || b.sessions - a.sessions || a.name.localeCompare(b.name))
      .map((m, i) => ({ ...m, rank: i + 1 }));

    const ended = sessions.filter((s) => s.status === "ended");
    return {
      crew: { _id: crew._id, name: crew.name },
      memberCount: members.length,
      sessionCount: ended.length,
      since: sessions[0]?.createdAt ?? null,
      board,
    };
  },
});

/** One player's lifetime numbers in a crew: totals, best/worst session, last 12 results and rank. */
export const profile = query({
  args: { crewId: v.id("crews"), memberId: v.id("crewMembers") },
  handler: async (ctx, { crewId, memberId }) => {
    const { crew } = await requireCrewAccess(ctx, crewId);
    const member = await ctx.db.get(memberId);
    if (!member || member.crewId !== crewId) return null;
    const mine = await ctx.db
      .query("playerSessionSummaries")
      .withIndex("by_member", (q) => q.eq("crewMemberId", memberId))
      .order("desc")
      .take(500);

    const everyone = await ctx.db
      .query("playerSessionSummaries")
      .withIndex("by_crew", (q) => q.eq("crewId", crewId))
      .take(5000);
    const totals = new Map<Id<"crewMembers">, number>();
    for (const r of everyone) totals.set(r.crewMemberId, (totals.get(r.crewMemberId) ?? 0) + r.net);
    const myTotal = totals.get(memberId) ?? 0;
    const rank = 1 + [...totals.entries()].filter(([id, t]) => id !== memberId && t > myTotal).length;

    const sessionDocs = await Promise.all(mine.slice(0, 12).map((r) => ctx.db.get(r.sessionId)));
    const label = (i: number) => {
      const s = sessionDocs[i];
      return { name: s?.name ?? crew.name, code: s?.code ?? "", endedAt: mine[i].endedAt };
    };
    const best = mine.reduce<Summary | null>((b, r) => (b === null || r.net > b.net ? r : b), null);
    const worst = mine.reduce<Summary | null>((w, r) => (w === null || r.net < w.net ? r : w), null);

    return {
      member: { _id: member._id, name: member.name },
      crewName: crew.name,
      rank: totals.has(memberId) ? rank : null,
      ...aggregate(mine),
      best: best ? best.net : null,
      worst: worst ? worst.net : null,
      // Oldest first, so the chart reads left to right.
      recent: mine.slice(0, 12).map((r, i) => ({ net: r.net, ...label(i) })).reverse(),
      firstEndedAt: mine.length ? mine[mine.length - 1].endedAt : null,
    };
  },
});
