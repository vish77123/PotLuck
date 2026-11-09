import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { expectError, key, newDevice, setup, startGame, table } from "./test.setup";

/** One session: Arjun's table where `winner` takes a pot of 30 after a ₹50 bet by `bettor`. */
async function playSession(t: ReturnType<typeof setup>, names: string[], winner: string, bet: number) {
  const s = await table(t, names);
  const { gameId } = await startGame(t, s, "Sequence", names, names.map((_, i) => (i % 2) + 1));
  await s.seats[names[0]].as.mutation(api.games.bet, { gameId, amount: bet, idempotencyKey: key() });
  const team = names.indexOf(winner) % 2 + 1;
  await s.host.as.mutation(api.games.endTeam, { gameId, teamNo: team, idempotencyKey: key() });
  await s.host.as.mutation(api.sessions.end, { sessionId: s.sessionId, idempotencyKey: key() });
  return s;
}

describe("crew stats", () => {
  test("ending a session writes summaries that roll up into the leaderboard and profiles", async () => {
    const t = setup();
    const s1 = await playSession(t, ["Arjun", "Priya"], "Priya", 50);
    const state = await s1.host.as.query(api.sessions.state, { sessionId: s1.sessionId });
    const crewId = state.crew._id;

    const board1 = await s1.host.as.query(api.stats.leaderboard, { crewId });
    // Sequence boot is 50 each and Arjun bets 50: a pot of 150. Priya put in 50 and takes it all (+100); Arjun put in 100 (−100).
    expect(board1.board.map((b) => [b.name, b.totalNet, b.sessions, b.gamesWon, b.rank])).toEqual([
      ["Priya", 100, 1, 1, 1],
      ["Arjun", -100, 1, 0, 2],
    ]);
    expect(board1.sessionCount).toBe(1);
    expect(board1.board.reduce((sum, b) => sum + b.totalNet, 0)).toBe(0);

    const priyaMember = state.players.find((p) => p.name === "Priya")!.crewMemberId;
    const prof = await s1.host.as.query(api.stats.profile, { crewId, memberId: priyaMember });
    expect(prof).toMatchObject({ rank: 1, sessions: 1, totalNet: 100, gamesWon: 1, biggestPayout: 150, best: 100, worst: 100 });
    expect(prof?.recent).toHaveLength(1);

    // A second session in the same crew: Arjun wins, so both totals move and Arjun's profile has a best and a worst.
    const arjunMember = state.players.find((p) => p.name === "Arjun")!.crewMemberId;
    const second = await s1.host.as.mutation(api.sessions.create, {
      crewId,
      hostMemberId: arjunMember,
      walletMode: "equal",
      startingAmount: 1000,
      theme: "inr",
      idempotencyKey: key(),
    });
    await s1.seats.Priya.as.mutation(api.sessions.join, { code: second.code, crewMemberId: priyaMember, idempotencyKey: key() });
    const players = await s1.host.as.query(api.sessions.state, { sessionId: second.sessionId });
    const ids = players.players.map((p) => p._id);
    const tpl = players.templates.find((x) => x.name === "Teen Patti")!._id;
    const g2 = await s1.host.as.mutation(api.games.start, {
      sessionId: second.sessionId,
      templateId: tpl,
      participants: ids.map((id) => ({ playerId: id })),
      idempotencyKey: key(),
    });
    await s1.host.as.mutation(api.games.endSolo, { gameId: g2.gameId, winnerPlayerId: second.playerId, idempotencyKey: key() });
    await s1.host.as.mutation(api.sessions.end, { sessionId: second.sessionId, idempotencyKey: key() });

    const board2 = await s1.host.as.query(api.stats.leaderboard, { crewId });
    expect(board2.board.map((b) => [b.name, b.totalNet, b.sessions, b.gamesWon])).toEqual([
      ["Priya", 90, 2, 1],
      ["Arjun", -90, 2, 1],
    ].map(([n, net, ses, w]) => [n, net, ses, w]).map((r) => r));
    const prof2 = await s1.host.as.query(api.stats.profile, { crewId, memberId: arjunMember });
    expect(prof2).toMatchObject({ sessions: 2, totalNet: -90, gamesWon: 1, best: 10, worst: -100, rank: 2 });
    expect(prof2?.recent.map((r) => r.net)).toEqual([-100, 10]);
  });

  test("this-month filter and access control", async () => {
    const t = setup();
    const s = await playSession(t, ["Arjun", "Priya"], "Arjun", 20);
    const state = await s.host.as.query(api.sessions.state, { sessionId: s.sessionId });
    const crewId = state.crew._id;

    const future = Date.now() + 60_000;
    const none = await s.host.as.query(api.stats.leaderboard, { crewId, since: future });
    expect(none.board).toEqual([]);
    const all = await s.host.as.query(api.stats.leaderboard, { crewId, since: 0 });
    expect(all.board).toHaveLength(2);

    const stranger = await newDevice(t);
    await expectError(stranger.query(api.stats.leaderboard, { crewId }), "FORBIDDEN");
  });
});
