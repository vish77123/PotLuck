import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { balances, checkInvariants, expectError, key, setup, startGame, table, type Device } from "./test.setup";

const nets = async (seat: { as: Device }, sessionId: Id<"sessions">) => {
  const r = await seat.as.query(api.report.settlement, { sessionId });
  return Object.fromEntries(r.nets.map((n) => [n.name, n.net])) as Record<string, number>;
};

describe("top-ups", () => {
  test("tracked separately from the buy-in, net unchanged", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    await s.seats.Priya.as.mutation(api.wallet.topUp, { sessionId: s.sessionId, amount: 300, idempotencyKey: key() });
    const r = await s.host.as.query(api.report.settlement, { sessionId: s.sessionId });
    expect(r.nets.find((n) => n.name === "Priya")).toMatchObject({ buyIn: 1000, topUps: 300, wallet: 1300, net: 0 });
    await expectError(
      s.seats.Priya.as.mutation(api.wallet.topUp, { sessionId: s.sessionId, amount: 0, idempotencyKey: key() }),
      "INVALID_AMOUNT",
    );
    await checkInvariants(t, s.sessionId);
  });
});

describe("loans", () => {
  async function lend(s: Awaited<ReturnType<typeof table>>, borrower: string, lender: string, amount: number) {
    const { loanId } = await s.seats[borrower].as.mutation(api.loans.request, {
      sessionId: s.sessionId,
      lenderPlayerId: s.seats[lender].playerId,
      amount,
      idempotencyKey: key(),
    });
    return loanId as Id<"loans">;
  }

  test("money moves only after the lender accepts", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Kabir", "Priya"]);
    const loanId = await lend(s, "Kabir", "Priya", 300);
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 1000, Kabir: 1000, Priya: 1000 });
    await expectError(
      s.seats.Kabir.as.mutation(api.loans.respond, { loanId, accept: true, idempotencyKey: key() }),
      "FORBIDDEN",
    );
    await expectError(
      s.seats.Arjun.as.mutation(api.loans.respond, { loanId, accept: true, idempotencyKey: key() }),
      "FORBIDDEN",
    );
    await s.seats.Priya.as.mutation(api.loans.respond, { loanId, accept: true, idempotencyKey: key() });
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 1000, Kabir: 1300, Priya: 700 });
    expect(await nets(s.host, s.sessionId)).toEqual({ Arjun: 0, Kabir: 0, Priya: 0 });
    await checkInvariants(t, s.sessionId);
  });

  test("decline and withdraw move nothing", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Kabir"]);
    const a = await lend(s, "Kabir", "Arjun", 300);
    await s.host.as.mutation(api.loans.respond, { loanId: a, accept: false, idempotencyKey: key() });
    const b = await lend(s, "Kabir", "Arjun", 300);
    await s.seats.Kabir.as.mutation(api.loans.cancelRequest, { loanId: b });
    await expectError(
      s.host.as.mutation(api.loans.respond, { loanId: b, accept: true, idempotencyKey: key() }),
      "INVALID_STATE",
    );
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 1000, Kabir: 1000 });
  });

  test("lender must have the money; you can't borrow from yourself", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Kabir"], { walletMode: "custom", buyIns: [100, 100] });
    const loanId = await lend(s, "Kabir", "Arjun", 500);
    await expectError(
      s.host.as.mutation(api.loans.respond, { loanId, accept: true, idempotencyKey: key() }),
      "INSUFFICIENT_BALANCE",
      /Arjun has only ₹100/,
    );
    await expectError(lend(s, "Kabir", "Kabir", 10), "INVALID_STATE");
  });

  test("repayment in parts, then repaid", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Kabir"]);
    const loanId = await lend(s, "Kabir", "Arjun", 300);
    await s.host.as.mutation(api.loans.respond, { loanId, accept: true, idempotencyKey: key() });
    await expectError(
      s.host.as.mutation(api.loans.repay, { loanId, amount: 100, idempotencyKey: key() }),
      "FORBIDDEN",
    );
    const r1 = await s.seats.Kabir.as.mutation(api.loans.repay, { loanId, amount: 100, idempotencyKey: key() });
    expect(r1.outstanding).toBe(200);
    await expectError(
      s.seats.Kabir.as.mutation(api.loans.repay, { loanId, amount: 201, idempotencyKey: key() }),
      "INVALID_AMOUNT",
    );
    const r2 = await s.seats.Kabir.as.mutation(api.loans.repay, { loanId, idempotencyKey: key() });
    expect(r2.outstanding).toBe(0);
    const loan = await t.run(async (ctx) => (await ctx.db.get(loanId))!);
    expect(loan.status).toBe("repaid");
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 1000, Kabir: 1000 });
    await checkInvariants(t, s.sessionId);
  });

  test("outstanding loans count in nets: borrower owes, lender is owed", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Kabir"]);
    const loanId = await lend(s, "Kabir", "Arjun", 300);
    await s.host.as.mutation(api.loans.respond, { loanId, accept: true, idempotencyKey: key() });
    // Kabir loses the borrowed money in a game.
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Kabir"]);
    await s.host.as.mutation(api.games.bet, { gameId, amount: 10, idempotencyKey: key() });
    await s.seats.Kabir.as.mutation(api.games.bet, { gameId, amount: 300, idempotencyKey: key() });
    await s.host.as.mutation(api.games.endSolo, { gameId, winnerPlayerId: s.host.playerId, idempotencyKey: key() });
    expect(await nets(s.host, s.sessionId)).toEqual({ Arjun: 310, Kabir: -310 });
    const { transfers } = await s.host.as.query(api.report.settlement, { sessionId: s.sessionId });
    expect(transfers).toEqual([{ from: s.seats.Kabir.playerId, to: s.host.playerId, amount: 310 }]);
    await checkInvariants(t, s.sessionId);
  });

  test("settled outside the app: closes the loan, excluded from nets, wallets untouched", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Kabir", "Rahul"]);
    const loanId = await lend(s, "Kabir", "Arjun", 300);
    await s.host.as.mutation(api.loans.respond, { loanId, accept: true, idempotencyKey: key() });
    await expectError(s.seats.Rahul.as.mutation(api.loans.markSettledOutside, { loanId }), "FORBIDDEN");
    await s.seats.Kabir.as.mutation(api.loans.markSettledOutside, { loanId });
    const loan = await t.run(async (ctx) => (await ctx.db.get(loanId))!);
    expect(loan.status).toBe("settled_outside");
    expect(loan.meta).toMatchObject({ settledByName: "Kabir", outstandingAtSettle: 300 });
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 700, Kabir: 1300, Rahul: 1000 });
    // Kabir paid Arjun ₹300 in cash, so the chips are now genuinely Kabir's.
    expect(await nets(s.host, s.sessionId)).toEqual({ Arjun: -300, Kabir: 300, Rahul: 0 });
    await expectError(
      s.seats.Kabir.as.mutation(api.loans.repay, { loanId, idempotencyKey: key() }),
      "INVALID_STATE",
    );
    await checkInvariants(t, s.sessionId);
  });

  test("host undoes a loan (status reversed) and a repayment (loan reopens)", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Kabir", "Priya"]);
    const loanId = await lend(s, "Kabir", "Priya", 300);
    const { entryId } = await s.seats.Priya.as.mutation(api.loans.respond, { loanId, accept: true, idempotencyKey: key() });
    const repay = await s.seats.Kabir.as.mutation(api.loans.repay, { loanId, amount: 300, idempotencyKey: key() });
    await expectError(
      s.host.as.mutation(api.host.undo, { entryId: entryId!, idempotencyKey: key() }),
      "INVALID_STATE",
      /closed/,
    );
    await s.host.as.mutation(api.host.undo, { entryId: repay.entryId, idempotencyKey: key() });
    let loan = await t.run(async (ctx) => (await ctx.db.get(loanId))!);
    expect(loan).toMatchObject({ status: "open", repaidAmount: 0 });
    await s.host.as.mutation(api.host.undo, { entryId: entryId!, idempotencyKey: key() });
    loan = await t.run(async (ctx) => (await ctx.db.get(loanId))!);
    expect(loan.status).toBe("reversed");
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 1000, Kabir: 1000, Priya: 1000 });
    expect(await nets(s.host, s.sessionId)).toEqual({ Arjun: 0, Kabir: 0, Priya: 0 });
    await checkInvariants(t, s.sessionId);
  });
});

describe("cash out", () => {
  test("not while playing; allowed after packing; full balance leaves, player stays in report", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya", "Rahul"]);
    await expectError(
      s.seats.Priya.as.mutation(api.wallet.cashOut, { sessionId: s.sessionId, idempotencyKey: key() }),
      "INVALID_STATE",
      /still playing/,
    );
    await s.host.as.mutation(api.games.bet, { gameId, amount: 10, idempotencyKey: key() });
    await s.seats.Priya.as.mutation(api.games.pack, { gameId });
    const r = await s.seats.Priya.as.mutation(api.wallet.cashOut, { sessionId: s.sessionId, idempotencyKey: key() });
    expect(r.amount).toBe(990);
    expect((await balances(t, s.sessionId)).Priya).toBe(0);
    await expectError(
      s.seats.Priya.as.mutation(api.wallet.topUp, { sessionId: s.sessionId, amount: 10, idempotencyKey: key() }),
      "INVALID_STATE",
      /cashed out/,
    );
    // Still readable, still in the report.
    const state = await s.seats.Priya.as.query(api.sessions.state, { sessionId: s.sessionId });
    expect(state.players.find((p) => p.name === "Priya")?.status).toBe("left");
    await s.host.as.mutation(api.games.endSolo, { gameId, winnerPlayerId: s.seats.Rahul.playerId, idempotencyKey: key() });
    expect(await nets(s.host, s.sessionId)).toEqual({ Arjun: -20, Priya: -10, Rahul: 30 });
    await checkInvariants(t, s.sessionId);
  });

  test("host can cash out another player; others can't; host must hand over first", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    await expectError(
      s.seats.Priya.as.mutation(api.wallet.cashOut, {
        sessionId: s.sessionId,
        playerId: s.seats.Rahul.playerId,
        idempotencyKey: key(),
      }),
      "NOT_HOST",
    );
    await s.host.as.mutation(api.wallet.cashOut, {
      sessionId: s.sessionId,
      playerId: s.seats.Rahul.playerId,
      idempotencyKey: key(),
    });
    expect((await balances(t, s.sessionId)).Rahul).toBe(0);
    await expectError(
      s.host.as.mutation(api.wallet.cashOut, { sessionId: s.sessionId, idempotencyKey: key() }),
      "INVALID_STATE",
      /Hand host/,
    );
    await checkInvariants(t, s.sessionId);
  });

  test("a player who cashed out can rejoin with a new buy-in", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    await s.seats.Priya.as.mutation(api.wallet.cashOut, { sessionId: s.sessionId, idempotencyKey: key() });
    const info = await s.seats.Priya.as.query(api.sessions.joinInfo, { code: s.code });
    const priya = info!.members.find((m) => m.name === "Priya")!;
    const again = await s.seats.Priya.as.mutation(api.sessions.join, {
      code: s.code,
      crewMemberId: priya._id,
      idempotencyKey: key(),
    });
    expect(again.playerId).toBe(s.seats.Priya.playerId);
    const r = await s.host.as.query(api.report.settlement, { sessionId: s.sessionId });
    expect(r.nets.find((n) => n.name === "Priya")).toMatchObject({ buyIn: 2000, cashOut: 1000, wallet: 1000, net: 0 });
    await checkInvariants(t, s.sessionId);
  });
});

describe("end session", () => {
  test("requires no active game, then freezes, writes summaries, nets sum to 0", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya", "Rahul"]);
    await s.host.as.mutation(api.games.bet, { gameId, amount: 100, idempotencyKey: key() });
    await expectError(
      s.host.as.mutation(api.sessions.end, { sessionId: s.sessionId, idempotencyKey: key() }),
      "INVALID_STATE",
      /current game/,
    );
    await s.host.as.mutation(api.games.endSolo, { gameId, winnerPlayerId: s.seats.Priya.playerId, idempotencyKey: key() });
    const pending = await s.seats.Rahul.as.mutation(api.loans.request, {
      sessionId: s.sessionId,
      lenderPlayerId: s.host.playerId,
      amount: 50,
      idempotencyKey: key(),
    });
    await expectError(
      s.seats.Priya.as.mutation(api.sessions.end, { sessionId: s.sessionId, idempotencyKey: key() }),
      "NOT_HOST",
    );
    await s.host.as.mutation(api.sessions.end, { sessionId: s.sessionId, idempotencyKey: key() });

    const summaries = await t.run((ctx) =>
      ctx.db.query("playerSessionSummaries").withIndex("by_session", (q) => q.eq("sessionId", s.sessionId)).collect(),
    );
    const byPlayer = Object.fromEntries(summaries.map((x) => [x.sessionPlayerId, x]));
    expect(byPlayer[s.seats.Priya.playerId]).toMatchObject({ net: 120, gamesWon: 1, biggestPayout: 130 });
    expect(byPlayer[s.host.playerId]).toMatchObject({ net: -110, gamesWon: 0 });
    expect(summaries.reduce((sum, x) => sum + x.net, 0)).toBe(0);
    const loan = await t.run(async (ctx) => (await ctx.db.get(pending.loanId))!);
    expect(loan.status).toBe("declined");

    await expectError(
      s.seats.Priya.as.mutation(api.wallet.topUp, { sessionId: s.sessionId, amount: 10, idempotencyKey: key() }),
      "INVALID_STATE",
      /ended/,
    );
    const joiner = s.seats.Rahul.as;
    await expectError(
      joiner.mutation(api.sessions.join, { code: s.code, newName: "Late", idempotencyKey: key() }),
      "INVALID_STATE",
      /ended/,
    );
    await checkInvariants(t, s.sessionId);
  });
});
