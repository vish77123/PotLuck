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

/**
 * The whole session report in one query: totals, nets, settle-up, a breakdown of every game (with every
 * entry), top-ups and loans, and the undo log. Reads the session's ledger once; sessions are small.
 */
export const full = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const { session } = await requirePlayer(ctx, sessionId);
    const crew = await ctx.db.get(session.crewId);
    const players = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const name = (id?: string | null) => players.find((p) => p._id === id)?.name ?? "Someone";

    const entries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_session_seq", (q) => q.eq("sessionId", sessionId))
      .take(8000);
    const reversedBy = new Map<string, (typeof entries)[number]>();
    for (const e of entries) if (e.type === "REVERSAL" && e.reversesEntryId) reversedBy.set(e.reversesEntryId, e);

    const games = await ctx.db
      .query("games")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const participants = await ctx.db
      .query("gameParticipants")
      .withIndex("by_session_player", (q) => q.eq("sessionId", sessionId))
      .collect();

    const nets = await computeNets(ctx, sessionId);
    const gamesWon = new Map<string, number>();
    const gameRows = games.map((g) => {
      const mine = entries.filter((e) => e.gameId === g._id);
      const live = mine.filter((e) => e.type !== "REVERSAL" && !reversedBy.has(e._id));
      const putIn = new Map<string, number>();
      const won = new Map<string, number>();
      const bets = new Map<string, number>();
      let betCount = 0;
      for (const e of live) {
        if (e.type === "BOOT" || e.type === "BET") {
          putIn.set(e.fromPlayerId!, (putIn.get(e.fromPlayerId!) ?? 0) + e.amount);
          if (e.type === "BET") {
            bets.set(e.fromPlayerId!, (bets.get(e.fromPlayerId!) ?? 0) + 1);
            betCount++;
          }
        } else if (e.type === "PAYOUT") {
          won.set(e.toPlayerId!, (won.get(e.toPlayerId!) ?? 0) + e.amount);
        }
      }
      const pot = [...won.values()].reduce((a, b) => a + b, 0) || [...putIn.values()].reduce((a, b) => a + b, 0);
      if (g.status === "ended") for (const id of g.winnerPlayerIds ?? []) gamesWon.set(id, (gamesWon.get(id) ?? 0) + 1);
      const parts = participants.filter((p) => p.gameId === g._id).sort((a, b) => a.seatOrder - b.seatOrder);
      return {
        id: g._id,
        no: g.gameNo,
        template: g.templateSnapshot.name,
        status: g.status,
        startedAt: g.startedAt,
        endedAt: g.endedAt ?? null,
        pot,
        betCount,
        teamNo: g.winningTeamNo ?? null,
        winners: (g.winnerPlayerIds ?? []).map(name),
        remainderTo: (g.remainderPlayerIds ?? []).map(name),
        lines: parts.map((p) => {
          const inn = putIn.get(p.sessionPlayerId) ?? 0;
          const w = won.get(p.sessionPlayerId) ?? 0;
          return {
            name: name(p.sessionPlayerId),
            packed: p.status === "packed",
            seen: p.isSeen,
            teamNo: p.teamNo ?? null,
            bets: bets.get(p.sessionPlayerId) ?? 0,
            putIn: inn,
            won: w,
            net: w - inn,
          };
        }),
        entries: mine
          .filter((e) => e.type !== "REVERSAL")
          .map((e) => ({
            at: e.createdAt,
            type: e.type,
            who: name(e.type === "PAYOUT" ? e.toPlayerId : e.fromPlayerId),
            amount: e.amount,
            undone: reversedBy.has(e._id),
          })),
      };
    });

    const finished = gameRows.filter((g) => g.status === "ended");
    const total = nets.reduce((s, n) => s + n.net, 0);
    const transfers = total === 0 ? settleUp(nets.map((n) => ({ id: n.playerId, net: n.net }))) : null;

    const topUps = entries
      .filter((e) => e.type === "TOP_UP")
      .map((e) => ({ who: name(e.toPlayerId), amount: e.amount, at: e.createdAt, undone: reversedBy.has(e._id) }));
    const loans = (
      await ctx.db
        .query("loans")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .collect()
    )
      .filter((l) => l.status !== "declined" && l.status !== "requested" && l.status !== "reversed")
      .map((l) => ({ lender: name(l.lenderPlayerId), borrower: name(l.borrowerPlayerId), amount: l.amount, repaid: l.repaidAmount, status: l.status, at: l.requestedAt }));

    const undos = entries
      .filter((e) => e.type === "REVERSAL")
      .map((r) => {
        const original = entries.find((e) => e._id === r.reversesEntryId);
        return {
          at: r.createdAt,
          type: r.reversesType ?? null,
          amount: r.amount,
          who: name(original?.fromPlayerId ?? original?.toPlayerId),
          by: name(r.createdByPlayerId),
          reason: (r.meta?.reason as string | undefined) ?? null,
        };
      })
      .reverse();

    return {
      session: {
        name: session.name ?? null,
        crewName: crew?.name ?? "",
        code: session.code,
        status: session.status,
        theme: session.theme,
        createdAt: session.createdAt,
        startedAt: session.startedAt ?? null,
        endedAt: session.endedAt ?? null,
      },
      totals: {
        games: finished.length,
        moved: finished.reduce((s, g) => s + g.pot, 0),
        biggestPot: finished.reduce((m, g) => Math.max(m, g.pot), 0),
      },
      players: nets.map((n) => ({
        id: n.playerId,
        name: n.name,
        status: n.status,
        net: n.net,
        buyIn: n.buyIn,
        topUps: n.topUps,
        cashOut: n.cashOut,
        wallet: n.wallet,
        gamesWon: gamesWon.get(n.playerId) ?? 0,
      })).sort((a, b) => b.net - a.net || a.name.localeCompare(b.name)),
      transfers: transfers?.map((t) => ({ from: name(t.from), to: name(t.to), amount: t.amount })) ?? null,
      games: gameRows.sort((a, b) => b.no - a.no),
      topUps,
      loans,
      undos,
    };
  },
});
