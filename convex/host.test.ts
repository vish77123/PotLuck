import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { balances, checkInvariants, expectError, getGame, key, setup, startGame, table, type Device, type T } from "./test.setup";

const bet = (seat: { as: Device }, gameId: Id<"games">, amount: number) =>
  seat.as.mutation(api.games.bet, { gameId, amount, idempotencyKey: key() });

async function entriesOf(t: T, gameId: Id<"games">) {
  return await t.run((ctx) => ctx.db.query("ledgerEntries").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect());
}

describe("undo", () => {
  test("undoing a bet refunds it and the original stays in the ledger", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya", "Rahul"]);
    const { entryId } = await bet(s.seats.Arjun, gameId, 200);
    const { reversalId } = await s.host.as.mutation(api.host.undo, { entryId, idempotencyKey: key() });
    expect((await balances(t, s.sessionId)).Arjun).toBe(990);
    const entries = await entriesOf(t, gameId);
    expect(entries.find((e) => e._id === entryId)?.type).toBe("BET");
    const rev = entries.find((e) => e._id === reversalId)!;
    expect(rev).toMatchObject({ type: "REVERSAL", reversesEntryId: entryId, fromPool: true, toPlayerId: s.seats.Arjun.playerId });
    expect(rev.meta).toEqual({ undoneByName: "Arjun" });
    await checkInvariants(t, s.sessionId);
  });

  test("undoing the most recent bet in a turn-based game moves the turn back", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya", "Rahul"]);
    const first = await bet(s.seats.Arjun, gameId, 20);
    const second = await bet(s.seats.Priya, gameId, 20);
    expect((await getGame(t, gameId)).currentTurnPlayerId).toBe(s.seats.Rahul.playerId);
    // An older bet: turn stays put.
    await s.host.as.mutation(api.host.undo, { entryId: first.entryId, idempotencyKey: key() });
    expect((await getGame(t, gameId)).currentTurnPlayerId).toBe(s.seats.Rahul.playerId);
    // The latest bet: turn returns to Priya.
    await s.host.as.mutation(api.host.undo, { entryId: second.entryId, idempotencyKey: key() });
    expect((await getGame(t, gameId)).currentTurnPlayerId).toBe(s.seats.Priya.playerId);
    await bet(s.seats.Priya, gameId, 40);
    await checkInvariants(t, s.sessionId);
  });

  test("undoing a boot refunds it", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya"]);
    const boot = (await entriesOf(t, gameId)).find((e) => e.type === "BOOT" && e.fromPlayerId === s.seats.Priya.playerId)!;
    await s.host.as.mutation(api.host.undo, { entryId: boot._id, idempotencyKey: key() });
    expect((await balances(t, s.sessionId)).Priya).toBe(1000);
    expect((await getGame(t, gameId)).poolAmount).toBe(10);
  });

  test("an entry can be reversed once; a reversal can't be reversed", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya"]);
    const { entryId } = await bet(s.seats.Arjun, gameId, 50);
    const { reversalId } = await s.host.as.mutation(api.host.undo, { entryId, idempotencyKey: key() });
    await expectError(s.host.as.mutation(api.host.undo, { entryId, idempotencyKey: key() }), "ALREADY_REVERSED");
    await expectError(s.host.as.mutation(api.host.undo, { entryId: reversalId, idempotencyKey: key() }), "NOT_UNDOABLE");
    await checkInvariants(t, s.sessionId);
  });

  test("buy-ins, cash-outs and payouts can't be undone directly", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    const buyIn = await t.run(async (ctx) =>
      (await ctx.db.query("ledgerEntries").withIndex("by_session_type", (q) => q.eq("sessionId", s.sessionId).eq("type", "BUY_IN")).first())!,
    );
    await expectError(s.host.as.mutation(api.host.undo, { entryId: buyIn._id, idempotencyKey: key() }), "NOT_UNDOABLE", /Buy-ins/);

    await s.seats.Rahul.as.mutation(api.wallet.cashOut, { sessionId: s.sessionId, idempotencyKey: key() });
    const cashOut = await t.run(async (ctx) =>
      (await ctx.db.query("ledgerEntries").withIndex("by_session_type", (q) => q.eq("sessionId", s.sessionId).eq("type", "CASH_OUT")).first())!,
    );
    await expectError(s.host.as.mutation(api.host.undo, { entryId: cashOut._id, idempotencyKey: key() }), "NOT_UNDOABLE", /Cash-outs/);

    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya"]);
    await s.host.as.mutation(api.games.endSolo, { gameId, winnerPlayerId: s.seats.Priya.playerId, idempotencyKey: key() });
    const payout = (await entriesOf(t, gameId)).find((e) => e.type === "PAYOUT")!;
    await expectError(s.host.as.mutation(api.host.undo, { entryId: payout._id, idempotencyKey: key() }), "NOT_UNDOABLE", /reopen/);
  });

  test("only the host can undo, and not bets of a finished game", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya"]);
    const { entryId } = await bet(s.seats.Arjun, gameId, 50);
    await expectError(s.seats.Priya.as.mutation(api.host.undo, { entryId, idempotencyKey: key() }), "NOT_HOST");
    await s.host.as.mutation(api.games.endSolo, { gameId, winnerPlayerId: s.seats.Priya.playerId, idempotencyKey: key() });
    await expectError(s.host.as.mutation(api.host.undo, { entryId, idempotencyKey: key() }), "INVALID_STATE", /reopen/);
  });

  test("undoing a top-up that has already been bet is rejected with a reason", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"], { walletMode: "custom", buyIns: [1000, 10] });
    const { entryId: topUpId } = await s.seats.Priya.as.mutation(api.wallet.topUp, {
      sessionId: s.sessionId,
      amount: 500,
      idempotencyKey: key(),
    });
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya"]);
    await bet(s.seats.Arjun, gameId, 10);
    await bet(s.seats.Priya, gameId, 400);
    await expectError(
      s.host.as.mutation(api.host.undo, { entryId: topUpId, idempotencyKey: key() }),
      "INSUFFICIENT_BALANCE",
      /Priya has only ₹100 — ₹500 needed/,
    );
    await checkInvariants(t, s.sessionId);
  });

  test("undoing a top-up that hasn't been spent works", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const { entryId } = await s.seats.Priya.as.mutation(api.wallet.topUp, {
      sessionId: s.sessionId,
      amount: 500,
      idempotencyKey: key(),
    });
    await s.host.as.mutation(api.host.undo, { entryId, idempotencyKey: key() });
    const { nets } = await s.host.as.query(api.report.settlement, { sessionId: s.sessionId });
    expect(nets.find((n) => n.name === "Priya")).toMatchObject({ topUps: 0, wallet: 1000, net: 0 });
    await checkInvariants(t, s.sessionId);
  });
});

describe("host rights", () => {
  afterEach(() => vi.useRealTimers());

  test("host hands over host rights; only the host can", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    await expectError(
      s.seats.Priya.as.mutation(api.host.transfer, { sessionId: s.sessionId, toPlayerId: s.seats.Priya.playerId }),
      "NOT_HOST",
    );
    await s.host.as.mutation(api.host.transfer, { sessionId: s.sessionId, toPlayerId: s.seats.Priya.playerId });
    const state = await s.seats.Priya.as.query(api.sessions.state, { sessionId: s.sessionId });
    expect(state.isHost).toBe(true);
    const history = await t.run(async (ctx) => (await ctx.db.get(s.sessionId))!.hostHistory);
    expect(history.map((h) => h.kind)).toEqual(["create", "transfer"]);
  });

  test("any active player can claim host after the host is unseen for 2 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T20:00:00Z"));
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    await expectError(s.seats.Priya.as.mutation(api.host.claim, { sessionId: s.sessionId }), "FORBIDDEN", /still connected/);

    vi.setSystemTime(new Date("2026-11-07T20:01:30Z"));
    await s.seats.Priya.as.mutation(api.presence.heartbeat, { sessionId: s.sessionId });
    await expectError(s.seats.Priya.as.mutation(api.host.claim, { sessionId: s.sessionId }), "FORBIDDEN");

    vi.setSystemTime(new Date("2026-11-07T20:02:01Z"));
    await s.seats.Priya.as.mutation(api.host.claim, { sessionId: s.sessionId });
    const history = await t.run(async (ctx) => (await ctx.db.get(s.sessionId))!.hostHistory);
    expect(history.at(-1)).toMatchObject({ kind: "claim", fromPlayerId: s.host.playerId, toPlayerId: s.seats.Priya.playerId });
    await expectError(
      s.host.as.mutation(api.host.transfer, { sessionId: s.sessionId, toPlayerId: s.host.playerId }),
      "NOT_HOST",
    );
  });

  test("heartbeat updates presence without touching the session", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const before = await t.run(async (ctx) => (await ctx.db.get(s.sessionId))!);
    await s.seats.Priya.as.mutation(api.presence.heartbeat, { sessionId: s.sessionId });
    const after = await t.run(async (ctx) => (await ctx.db.get(s.sessionId))!);
    expect(after).toEqual(before);
    const list = await s.seats.Priya.as.query(api.presence.list, { sessionId: s.sessionId });
    expect(list).toHaveLength(2);
  });
});
