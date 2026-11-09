import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { applyEntry, reverseEntry } from "./lib/ledger";
import { balances, checkInvariants, expectError, getGame, key, setup, startGame, table } from "./test.setup";

describe("applyEntry", () => {
  test("refuses to take a wallet or the pool below 0, and rolls back the whole mutation", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"], { walletMode: "custom", buyIns: [100, 100] });
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya"]);
    await expectError(
      t.run((ctx) =>
        applyEntry(ctx, {
          sessionId: s.sessionId,
          gameId,
          type: "PAYOUT",
          fromPool: true,
          toPlayerId: s.host.playerId,
          amount: 21,
          createdByPlayerId: s.host.playerId,
        }),
      ),
      "INSUFFICIENT_POOL",
    );
    await expectError(
      t.run(async (ctx) => {
        await applyEntry(ctx, {
          sessionId: s.sessionId,
          type: "TOP_UP",
          toPlayerId: s.host.playerId,
          amount: 50,
          createdByPlayerId: s.host.playerId,
        });
        // Second write in the same transaction fails → the top-up above must not survive.
        await applyEntry(ctx, {
          sessionId: s.sessionId,
          type: "CASH_OUT",
          fromPlayerId: s.seats.Priya.playerId,
          amount: 1000,
          createdByPlayerId: s.host.playerId,
        });
      }),
      "INSUFFICIENT_BALANCE",
    );
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 90, Priya: 90 });
    expect((await getGame(t, gameId)).poolAmount).toBe(20);
    await checkInvariants(t, s.sessionId);
  });

  test("rejects malformed entries", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const base = { sessionId: s.sessionId, createdByPlayerId: s.host.playerId };
    // A BET must go from a player to the pool.
    await expectError(
      t.run((ctx) => applyEntry(ctx, { ...base, type: "BET", fromPlayerId: s.host.playerId, toPlayerId: s.seats.Priya.playerId, amount: 10 })),
      "INVALID_STATE",
    );
    await expectError(
      t.run((ctx) => applyEntry(ctx, { ...base, type: "LOAN", fromPlayerId: s.host.playerId, toPlayerId: s.host.playerId, amount: 10 })),
      "INVALID_STATE",
    );
    await expectError(t.run((ctx) => applyEntry(ctx, { ...base, type: "TOP_UP", toPlayerId: s.host.playerId, amount: 0 })), "INVALID_AMOUNT");
    await expectError(t.run((ctx) => applyEntry(ctx, { ...base, type: "TOP_UP", toPlayerId: s.host.playerId, amount: 1.5 })), "INVALID_AMOUNT");
    await expectError(
      t.run((ctx) => applyEntry(ctx, { ...base, type: "TOP_UP", toPlayerId: s.host.playerId, amount: 2 ** 53 })),
      "INVALID_AMOUNT",
    );
    await expectError(t.run((ctx) => applyEntry(ctx, { ...base, type: "BET", fromPlayerId: s.host.playerId, toPool: true, amount: 10 })), "INVALID_STATE");
    await checkInvariants(t, s.sessionId);
  });

  test("seq is strictly increasing across the session", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya", "Rahul"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya", "Rahul"]);
    await s.host.as.mutation(api.games.bet, { gameId, amount: 10, idempotencyKey: key() });
    const seqs = await t.run(async (ctx) =>
      (await ctx.db.query("ledgerEntries").withIndex("by_session_seq", (q) => q.eq("sessionId", s.sessionId)).collect()).map((e) => e.seq),
    );
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("reverseEntry refuses a second reversal", async () => {
    const t = setup();
    const s = await table(t, ["Arjun"]);
    const { entryId } = await s.host.as.mutation(api.wallet.topUp, { sessionId: s.sessionId, amount: 100, idempotencyKey: key() });
    await t.run(async (ctx) => {
      await reverseEntry(ctx, (await ctx.db.get(entryId))!, s.host.playerId);
    });
    await expectError(
      t.run(async (ctx) => {
        await reverseEntry(ctx, (await ctx.db.get(entryId))!, s.host.playerId);
      }),
      "ALREADY_REVERSED",
    );
  });
});

describe("idempotency", () => {
  test("a repeated key returns the first result and moves money once", async () => {
    const t = setup();
    const s = await table(t, ["Arjun"]);
    const k = key();
    const a = await s.host.as.mutation(api.wallet.topUp, { sessionId: s.sessionId, amount: 100, idempotencyKey: k });
    const b = await s.host.as.mutation(api.wallet.topUp, { sessionId: s.sessionId, amount: 100, idempotencyKey: k });
    expect(b).toEqual(a);
    expect((await balances(t, s.sessionId)).Arjun).toBe(1100);
  });

  test("a failed call stores nothing, so the retry runs", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const { gameId } = await startGame(t, s, "Teen Patti", ["Arjun", "Priya"]);
    const k = key();
    await expectError(s.seats.Priya.as.mutation(api.games.bet, { gameId, amount: 20, idempotencyKey: k }), "NOT_YOUR_TURN");
    await s.host.as.mutation(api.games.bet, { gameId, amount: 20, idempotencyKey: key() });
    await s.seats.Priya.as.mutation(api.games.bet, { gameId, amount: 20, idempotencyKey: k });
    expect((await getGame(t, gameId)).poolAmount).toBe(60);
  });

  test("another device can't replay someone else's key", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const k = key();
    await s.host.as.mutation(api.wallet.topUp, { sessionId: s.sessionId, amount: 100, idempotencyKey: k });
    await expectError(
      s.seats.Priya.as.mutation(api.wallet.topUp, { sessionId: s.sessionId, amount: 100, idempotencyKey: k }),
      "IDEMPOTENCY_CONFLICT",
    );
  });

  test("keys must look like client-generated ids", async () => {
    const t = setup();
    const s = await table(t, ["Arjun"]);
    await expectError(
      s.host.as.mutation(api.wallet.topUp, { sessionId: s.sessionId, amount: 100, idempotencyKey: "short" }),
      "INVALID_STATE",
      /idempotency key/,
    );
  });
});

describe("concurrency", () => {
  test("two bets racing for the same wallet: exactly one lands, balance never negative", async () => {
    const t = setup();
    const s = await table(t, ["A", "B"], { walletMode: "custom", buyIns: [1000, 1000] });
    const { gameId } = await startGame(t, s, "Sequence", ["A", "B"], [1, 2]);
    // A has 950 after the boot: each bet alone fits, both together don't.
    const results = await Promise.allSettled([
      s.seats.A.as.mutation(api.games.bet, { gameId, amount: 600, idempotencyKey: key() }),
      s.seats.A.as.mutation(api.games.bet, { gameId, amount: 600, idempotencyKey: key() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.data.code).toBe("INSUFFICIENT_BALANCE");
    expect((await balances(t, s.sessionId)).A).toBe(350);
    expect((await getGame(t, gameId)).poolAmount).toBe(100 + 600);
    await checkInvariants(t, s.sessionId);
  });

  test("two phones betting at the same instant both land with distinct seqs", async () => {
    const t = setup();
    const s = await table(t, ["A", "B", "C"]);
    const { gameId } = await startGame(t, s, "Sequence", ["A", "B", "C"], [1, 2, 1]);
    await Promise.all(
      ["A", "B", "C", "A", "B", "C"].map((n) =>
        s.seats[n].as.mutation(api.games.bet, { gameId, amount: 25, idempotencyKey: key() }),
      ),
    );
    expect((await getGame(t, gameId)).poolAmount).toBe(150 + 150);
    expect(await balances(t, s.sessionId)).toEqual({ A: 900, B: 900, C: 900 });
    await checkInvariants(t, s.sessionId);
  });

  test("a double tap with the same key at the same instant applies once", async () => {
    const t = setup();
    const s = await table(t, ["A", "B"]);
    const { gameId } = await startGame(t, s, "Sequence", ["A", "B"], [1, 2]);
    const k = key();
    const [r1, r2] = await Promise.all([
      s.seats.B.as.mutation(api.games.bet, { gameId, amount: 100, idempotencyKey: k }),
      s.seats.B.as.mutation(api.games.bet, { gameId, amount: 100, idempotencyKey: k }),
    ]);
    expect(r1).toEqual(r2);
    expect((await balances(t, s.sessionId)).B).toBe(850);
    await checkInvariants(t, s.sessionId);
  });
});
