import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { splitPool } from "./games";
import {
  balances,
  checkInvariants,
  expectError,
  getGame,
  key,
  setup,
  startGame,
  table,
  templateId,
  type Device,
} from "./test.setup";

const bet = (seat: { as: Device }, gameId: Id<"games">, amount: number) =>
  seat.as.mutation(api.games.bet, { gameId, amount, idempotencyKey: key() });

describe("start game", () => {
  test("collects the boot from every participant", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    const { gameId, excluded } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya", "Rahul"]);
    expect(excluded).toEqual([]);
    const game = await getGame(t, gameId);
    expect(game.poolAmount).toBe(30);
    expect(game.gameNo).toBe(1);
    expect(game.currentTurnPlayerId).toBe(s.seats.Arjun.playerId);
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 990, Priya: 990, Rahul: 990 });
    await checkInvariants(t, s.sessionId);
  });

  test("a participant who can't cover the boot is excluded with a reason", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"], { walletMode: "custom", buyIns: [100, 100, 5] });
    const { gameId, excluded } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya", "Rahul"]);
    expect(excluded.map((e) => e.name)).toEqual(["Rahul"]);
    expect((await getGame(t, gameId)).poolAmount).toBe(20);
    expect((await balances(t, s.sessionId)).Rahul).toBe(5);
  });

  test("fewer than two who can pay → rejected, nothing collected", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"], { walletMode: "custom", buyIns: [100, 5] });
    await expectError(startGame(t, s, "Teen Patti", ["Arjun", "Priya"]), "INSUFFICIENT_BALANCE", /Priya \(₹5\)/);
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 100, Priya: 5 });
    await checkInvariants(t, s.sessionId);
  });

  test("host only, one game at a time, template is snapshotted", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const tpl = await templateId(t, s.sessionId, "Teen Patti");
    await expectError(
      s.seats.Priya.as.mutation(api.games.start, {
        sessionId: s.sessionId,
        templateId: tpl,
        participants: [{ playerId: s.seats.Priya.playerId }, { playerId: s.seats.Arjun.playerId }],
        idempotencyKey: key(),
      }),
      "NOT_HOST",
    );
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya"]);
    await expectError(startGame(t, s, "Teen Patti", ["Arjun", "Priya"]), "INVALID_STATE", /already in progress/);

    const state = await s.host.as.query(api.sessions.state, { sessionId: s.sessionId });
    const crewId = state.crew._id;
    await s.host.as.mutation(api.crews.saveTemplate, {
      crewId,
      templateId: tpl,
      name: "Teen Patti",
      boot: 50,
      minBet: 50,
      turnMode: "turn_based",
      teamMode: "solo",
    });
    expect((await getGame(t, gameId)).templateSnapshot.boot).toBe(10);
  });

  test("team mode needs a team for everyone and at least two teams", async () => {
    const t = setup();
    const s = await table(t, ["A", "B", "C", "D"]);
    await expectError(startGame(t, s, "Sequence", ["A", "B", "C", "D"]), "INVALID_STATE", /team/);
    await expectError(startGame(t, s, "Sequence", ["A", "B", "C", "D"], [1, 1, 1, 1]), "INVALID_STATE", /two teams/);
    const { gameId } = await startGame(t, s, "Sequence", ["A", "B", "C", "D"], [1, 2, 1, 2]);
    expect((await getGame(t, gameId)).currentTurnPlayerId).toBeUndefined();
  });
});

describe("betting", () => {
  test("turn-based: only the current player bets, then the turn moves by seat", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya", "Rahul"]);
    await expectError(bet(s.seats.Priya, gameId, 20), "NOT_YOUR_TURN", /Arjun's turn/);
    await bet(s.seats.Arjun, gameId, 20);
    expect((await getGame(t, gameId)).currentTurnPlayerId).toBe(s.seats.Priya.playerId);
    await bet(s.seats.Priya, gameId, 40);
    await bet(s.seats.Rahul, gameId, 40);
    expect((await getGame(t, gameId)).currentTurnPlayerId).toBe(s.seats.Arjun.playerId);
    expect((await getGame(t, gameId)).poolAmount).toBe(30 + 100);
    await checkInvariants(t, s.sessionId);
  });

  test("pack skips the packed player and blocks their bets", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya", "Rahul"]);
    await bet(s.seats.Arjun, gameId, 10);
    await expectError(s.seats.Rahul.as.mutation(api.games.pack, { gameId }), "NOT_YOUR_TURN");
    await s.seats.Priya.as.mutation(api.games.pack, { gameId });
    expect((await getGame(t, gameId)).currentTurnPlayerId).toBe(s.seats.Rahul.playerId);
    await bet(s.seats.Rahul, gameId, 10);
    expect((await getGame(t, gameId)).currentTurnPlayerId).toBe(s.seats.Arjun.playerId);
    await expectError(bet(s.seats.Priya, gameId, 10), "INVALID_STATE", /packed/);
  });

  test("host sets the turn manually, but never to a packed player", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya", "Rahul"]);
    await bet(s.seats.Arjun, gameId, 10);
    await s.seats.Priya.as.mutation(api.games.pack, { gameId });
    await expectError(
      s.host.as.mutation(api.games.setTurn, { gameId, playerId: s.seats.Priya.playerId }),
      "INVALID_STATE",
      /packed/,
    );
    await expectError(
      s.seats.Rahul.as.mutation(api.games.setTurn, { gameId, playerId: s.seats.Rahul.playerId }),
      "NOT_HOST",
    );
    await s.host.as.mutation(api.games.setTurn, { gameId, playerId: s.seats.Arjun.playerId });
    await expectError(bet(s.seats.Rahul, gameId, 10), "NOT_YOUR_TURN");
    await bet(s.seats.Arjun, gameId, 10);
    // Host fixes a mistaken pack.
    await s.host.as.mutation(api.games.unpack, { gameId, playerId: s.seats.Priya.playerId });
    await s.host.as.mutation(api.games.setTurn, { gameId, playerId: s.seats.Priya.playerId });
    await bet(s.seats.Priya, gameId, 10);
  });

  test("pack and unpack are recorded as events outside the ledger", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya", "Rahul"]);
    await bet(s.seats.Arjun, gameId, 10);
    await s.seats.Priya.as.mutation(api.games.pack, { gameId });
    await s.seats.Priya.as.mutation(api.games.pack, { gameId }); // double tap adds nothing
    await s.host.as.mutation(api.games.unpack, { gameId, playerId: s.seats.Priya.playerId });
    const events = await s.host.as.query(api.sessions.gameEvents, { sessionId: s.sessionId, gameId });
    expect(events.map((e) => e.kind)).toEqual(["unpack", "pack"]);
    const state = await s.host.as.query(api.sessions.state, { sessionId: s.sessionId });
    expect(state.latestGame?.events).toHaveLength(2);
    await checkInvariants(t, s.sessionId);
  });

  test("free-form: anyone playing bets any time, no turn pointer", async () => {
    const t = setup();
    const s = await table(t, ["A", "B", "C", "D"]);
    const { gameId } = await startGame(t, s, "Sequence", ["A", "B", "C", "D"], [1, 2, 1, 2]);
    await bet(s.seats.C, gameId, 10);
    await bet(s.seats.C, gameId, 10);
    await bet(s.seats.A, gameId, 30);
    const g = await getGame(t, gameId);
    expect(g.currentTurnPlayerId).toBeUndefined();
    expect(g.poolAmount).toBe(200 + 50);
    await expectError(
      s.host.as.mutation(api.games.setTurn, { gameId, playerId: s.seats.B.playerId }),
      "INVALID_STATE",
      /no turns/,
    );
  });

  test("bets must be within min..max, whole rupees, and within the balance", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"], { walletMode: "custom", buyIns: [3000, 200] });
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya"]);
    await expectError(bet(s.seats.Arjun, gameId, 5), "BET_OUT_OF_RANGE", /Minimum bet is ₹10/);
    await expectError(bet(s.seats.Arjun, gameId, 1001), "BET_OUT_OF_RANGE", /Maximum bet is ₹1,000/);
    await expectError(bet(s.seats.Arjun, gameId, 10.5), "INVALID_AMOUNT");
    await expectError(bet(s.seats.Arjun, gameId, -10), "INVALID_AMOUNT");
    await bet(s.seats.Arjun, gameId, 1000);
    await expectError(bet(s.seats.Priya, gameId, 500), "INSUFFICIENT_BALANCE", /Priya has only ₹190/);
    expect((await getGame(t, gameId)).currentTurnPlayerId).toBe(s.seats.Priya.playerId);
    await checkInvariants(t, s.sessionId);
  });

  test("non-participants can't bet; double-tapped bet is applied once", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    const { gameId } = await startGame(t, s, "Sequence", ["Arjun", "Priya"], [1, 2]);
    await expectError(bet(s.seats.Rahul, gameId, 10), "FORBIDDEN");
    const k = key();
    const a = await s.seats.Priya.as.mutation(api.games.bet, { gameId, amount: 100, idempotencyKey: k });
    const b = await s.seats.Priya.as.mutation(api.games.bet, { gameId, amount: 100, idempotencyKey: k });
    expect(a).toEqual(b);
    expect((await balances(t, s.sessionId)).Priya).toBe(1000 - 50 - 100);
  });

  test("seen flag is recorded on the bet", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya"]);
    await s.seats.Arjun.as.mutation(api.games.setSeen, { gameId, seen: true });
    const { entryId } = await bet(s.seats.Arjun, gameId, 20);
    const entry = await t.run(async (ctx) => (await ctx.db.get(entryId))!);
    expect(entry.meta).toEqual({ seen: true });
  });
});

describe("end game", () => {
  test("solo: one PAYOUT of the whole pool, pool ends at 0", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya", "Rahul"]);
    await bet(s.seats.Arjun, gameId, 100);
    await bet(s.seats.Priya, gameId, 200);
    const r = await s.host.as.mutation(api.games.endSolo, {
      gameId,
      winnerPlayerId: s.seats.Priya.playerId,
      idempotencyKey: key(),
    });
    expect(r.payout).toBe(330);
    const g = await getGame(t, gameId);
    expect(g.status).toBe("ended");
    expect(g.poolAmount).toBe(0);
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 890, Priya: 1120, Rahul: 990 });
    await expectError(bet(s.seats.Rahul, gameId, 10), "INVALID_STATE");
    await checkInvariants(t, s.sessionId);
  });

  test("solo end rejects a non-host and a non-participant winner", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya"]);
    await expectError(
      s.seats.Priya.as.mutation(api.games.endSolo, { gameId, winnerPlayerId: s.seats.Priya.playerId, idempotencyKey: key() }),
      "NOT_HOST",
    );
    await expectError(
      s.host.as.mutation(api.games.endSolo, { gameId, winnerPlayerId: s.seats.Rahul.playerId, idempotencyKey: key() }),
      "NOT_FOUND",
    );
  });

  test("team split: floor(pool / n) each, +₹1 to r random winners, recorded in meta", async () => {
    const t = setup();
    const s = await table(t, ["A", "B", "C", "D", "E"]);
    const { gameId } = await startGame(t, s, "Sequence", ["A", "B", "C", "D", "E"], [1, 2, 1, 2, 1]);
    await bet(s.seats.B, gameId, 10); // pool = 250 + 10 = 260 → 3 winners: 86 each, r = 2
    const r = await s.host.as.mutation(api.games.endTeam, { gameId, teamNo: 1, idempotencyKey: key() });
    expect(r.base).toBe(86);
    expect(r.remainder).toBe(2);
    expect(r.remainderTo).toHaveLength(2);
    const winners = [s.seats.A.playerId, s.seats.C.playerId, s.seats.E.playerId];
    expect(r.remainderTo.every((id) => winners.includes(id))).toBe(true);
    const b = await balances(t, s.sessionId);
    const got = { A: b.A - 950, C: b.C - 950, E: b.E - 950 };
    expect(Object.values(got).sort()).toEqual([86, 87, 87]);
    const g = await getGame(t, gameId);
    expect(g.poolAmount).toBe(0);
    expect(g.remainderPlayerIds).toEqual(r.remainderTo);
    const payouts = await t.run((ctx) =>
      ctx.db.query("ledgerEntries").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect(),
    );
    const metaLucky = payouts.filter((e) => e.type === "PAYOUT" && e.meta?.gotRemainder).map((e) => e.toPlayerId);
    expect(metaLucky.sort()).toEqual([...r.remainderTo].sort());
    await checkInvariants(t, s.sessionId);
  });

  test("team split with a pool smaller than the team", () => {
    const { shares, base, remainder } = splitPool(2, ["a", "b", "c"], () => 0.5);
    expect(base).toBe(0);
    expect(remainder).toBe(2);
    expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(2);
    expect(shares.filter((x) => x.amount === 1)).toHaveLength(2);
  });

  test("team split is exact for every pool size", () => {
    for (let pool = 0; pool < 200; pool++) {
      for (let n = 1; n <= 6; n++) {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        const { shares } = splitPool(pool, ids);
        expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(pool);
        const amounts = shares.map((x) => x.amount);
        expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
      }
    }
  });

  test("cancel refunds every boot and bet via reversals", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya"]);
    await bet(s.seats.Arjun, gameId, 100);
    const r = await s.host.as.mutation(api.games.cancel, { gameId, idempotencyKey: key() });
    expect(r.refunded).toBe(120);
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 1000, Priya: 1000 });
    expect((await getGame(t, gameId)).status).toBe("cancelled");
    await checkInvariants(t, s.sessionId);
  });

  test("reopen reverses payouts and reactivates the most recent game only", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const g1 = (await startGame(t, s, "Teen Patti", ["Arjun", "Priya"])).gameId;
    await bet(s.seats.Arjun, g1, 50);
    await s.host.as.mutation(api.games.endSolo, { gameId: g1, winnerPlayerId: s.seats.Arjun.playerId, idempotencyKey: key() });
    await s.host.as.mutation(api.games.reopen, { gameId: g1, idempotencyKey: key() });
    let g = await getGame(t, g1);
    expect(g.status).toBe("active");
    expect(g.poolAmount).toBe(70);
    expect(g.currentTurnPlayerId).toBe(s.seats.Priya.playerId);
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 940, Priya: 990 });
    await s.host.as.mutation(api.games.endSolo, { gameId: g1, winnerPlayerId: s.seats.Priya.playerId, idempotencyKey: key() });
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 940, Priya: 1060 });

    const g2 = (await startGame(t, s, "Teen Patti", ["Arjun", "Priya"])).gameId;
    await s.host.as.mutation(api.games.endSolo, { gameId: g2, winnerPlayerId: s.seats.Arjun.playerId, idempotencyKey: key() });
    await expectError(s.host.as.mutation(api.games.reopen, { gameId: g1, idempotencyKey: key() }), "INVALID_STATE", /most recent/);
    g = await getGame(t, g1);
    expect(g.status).toBe("ended");
    await checkInvariants(t, s.sessionId);
  });

  test("reopen is rejected if the winner already spent the payout", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"], { walletMode: "custom", buyIns: [20, 1000] });
    const g1 = (await startGame(t, s, "Teen Patti", ["Arjun", "Priya"])).gameId;
    await bet(s.seats.Arjun, g1, 10);
    await bet(s.seats.Priya, g1, 500);
    await s.host.as.mutation(api.games.endSolo, { gameId: g1, winnerPlayerId: s.seats.Arjun.playerId, idempotencyKey: key() });
    // Arjun cashes out his 530 — reopening would push his wallet below 0.
    await s.host.as.mutation(api.host.transfer, { sessionId: s.sessionId, toPlayerId: s.seats.Priya.playerId });
    await s.seats.Arjun.as.mutation(api.wallet.cashOut, { sessionId: s.sessionId, idempotencyKey: key() });
    await expectError(
      s.seats.Priya.as.mutation(api.games.reopen, { gameId: g1, idempotencyKey: key() }),
      "INSUFFICIENT_BALANCE",
    );
    await checkInvariants(t, s.sessionId);
  });
});
