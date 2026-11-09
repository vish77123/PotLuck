import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { checkInvariants, key, setup, startGame, table } from "./test.setup";

describe("session report", () => {
  test("totals, nets, settle-up, per-game lines, money and undo log line up", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);

    // Game 1: Priya wins after a bet by Arjun is undone.
    const g1 = (await startGame(t, s, "Teen Patti", ["Arjun", "Priya", "Rahul"])).gameId;
    const undone = await s.host.as.mutation(api.games.bet, { gameId: g1, amount: 50, idempotencyKey: key() });
    await s.host.as.mutation(api.host.undo, { entryId: undone.entryId, idempotencyKey: key() });
    await s.host.as.mutation(api.games.bet, { gameId: g1, amount: 100, idempotencyKey: key() });
    await s.seats.Priya.as.mutation(api.games.bet, { gameId: g1, amount: 200, idempotencyKey: key() });
    await s.seats.Rahul.as.mutation(api.games.pack, { gameId: g1 });
    await s.host.as.mutation(api.games.endSolo, { gameId: g1, winnerPlayerId: s.seats.Priya.playerId, idempotencyKey: key() });

    // Game 2 is cancelled, so it doesn't count as played.
    const g2 = (await startGame(t, s, "Teen Patti", ["Arjun", "Priya"])).gameId;
    await s.host.as.mutation(api.games.cancel, { gameId: g2, idempotencyKey: key() });

    // A top-up and a loan.
    await s.seats.Rahul.as.mutation(api.wallet.topUp, { sessionId: s.sessionId, amount: 300, idempotencyKey: key() });
    const { loanId } = await s.seats.Rahul.as.mutation(api.loans.request, {
      sessionId: s.sessionId,
      lenderPlayerId: s.seats.Priya.playerId,
      amount: 100,
      idempotencyKey: key(),
    });
    await s.seats.Priya.as.mutation(api.loans.respond, { loanId, accept: true, idempotencyKey: key() });

    const r = await s.host.as.query(api.report.full, { sessionId: s.sessionId });
    expect(r.totals).toEqual({ games: 1, moved: 330, biggestPot: 330 });
    // Priya won 330 after putting in 210; Arjun put in 110; Rahul only the boot. The ₹100 loan and the top-up don't change nets.
    expect(r.players.map((p) => [p.name, p.net, p.gamesWon])).toEqual([
      ["Priya", 120, 1],
      ["Rahul", -10, 0],
      ["Arjun", -110, 0],
    ]);
    expect(r.players.reduce((sum, p) => sum + p.net, 0)).toBe(0);
    expect(r.transfers).toEqual([
      { from: "Arjun", to: "Priya", amount: 110 },
      { from: "Rahul", to: "Priya", amount: 10 },
    ]);

    const game1 = r.games.find((g) => g.no === 1)!;
    expect(game1).toMatchObject({ status: "ended", pot: 330, betCount: 2, winners: ["Priya"] });
    expect(game1.lines.find((l) => l.name === "Rahul")).toMatchObject({ packed: true, putIn: 10, won: 0, net: -10 });
    expect(game1.lines.find((l) => l.name === "Priya")).toMatchObject({ bets: 1, putIn: 210, won: 330, net: 120 });
    expect(game1.entries.some((e) => e.undone && e.amount === 50)).toBe(true);
    expect(r.games.find((g) => g.no === 2)?.status).toBe("cancelled");

    expect(r.topUps).toMatchObject([{ who: "Rahul", amount: 300, undone: false }]);
    expect(r.loans).toMatchObject([{ lender: "Priya", borrower: "Rahul", amount: 100, status: "open" }]);
    // One undo by the host, two refunded boots from the cancelled game.
    expect(r.undos).toHaveLength(3);
    expect(r.undos.filter((u) => u.reason === "game_cancelled")).toHaveLength(2);
    await checkInvariants(t, s.sessionId);
  });

  test("no settle-up while a game is still open", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    await startGame(t, s, "Teen Patti", ["Arjun", "Priya"]);
    const r = await s.host.as.query(api.report.full, { sessionId: s.sessionId });
    expect(r.transfers).toBeNull();
  });
});
