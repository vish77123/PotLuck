/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import type { Infer } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { applyEntry, reverseEntry } from "./lib/ledger";
import { boardV, monoSettingsV } from "./schema";
import { balances, checkInvariants, expectError, setup, table, type T } from "./test.setup";
import { BUSINESS, CLASSIC } from "../lib/monopoly/presets";
import { DEFAULT_SETTINGS, type BoardConfig, type Settings } from "../lib/monopoly/types";

// The stored validators and the pure types must stay assignable to each other.
type Stored = Infer<typeof boardV>;
const _toPure: BoardConfig = {} as Stored;
const _toStored: Stored = {} as BoardConfig;
const _settingsToStored: Infer<typeof monoSettingsV> = {} as Omit<Settings, "bankerPlayerId">;
void [_toPure, _toStored, _settingsToStored];

/** A session whose type is monopoly, with one Monopoly game row and real-₹ stakes of ₹500 each. */
async function monoTable(t: T, names = ["Arjun", "Priya", "Meera"]) {
  const s = await table(t, names, { startingAmount: 1000 });
  const gameId = await t.run(async (ctx) => {
    await ctx.db.patch(s.sessionId, { type: "monopoly" });
    return await ctx.db.insert("mGames", {
      sessionId: s.sessionId,
      gameNo: 1,
      boardSnapshot: CLASSIC,
      settings: { ...DEFAULT_SETTINGS, bankerPlayerId: undefined, stakes: { buyIn: 500, split: [100] } },
      status: "active",
      turnNo: 1,
      freeParkingPot: 0,
      bankHouses: 32,
      bankHotels: 12,
      nextGroupNo: 1,
      startedAt: Date.now(),
    });
  });
  return { ...s, gameId };
}

const stake = (t: T, s: Awaited<ReturnType<typeof monoTable>>, type: "MONO_BUY_IN" | "MONO_PAYOUT", name: string, amount: number) =>
  t.run((ctx) =>
    applyEntry(ctx, {
      sessionId: s.sessionId,
      mGameId: s.gameId,
      type,
      amount,
      fromPlayerId: type === "MONO_BUY_IN" ? s.seats[name].playerId : undefined,
      toPlayerId: type === "MONO_PAYOUT" ? s.seats[name].playerId : undefined,
      createdByPlayerId: s.host.playerId,
    }),
  );

const endGame = (t: T, s: Awaited<ReturnType<typeof monoTable>>) => t.run((ctx) => ctx.db.patch(s.gameId, { status: "ended", endedAt: Date.now() }));

describe("real-₹ stakes in the ledger", () => {
  test("a buy-in is attribution only: it never moves a wallet, and counts against the player's net", async () => {
    const t = setup();
    const s = await monoTable(t);
    const before = await balances(t, s.sessionId);
    const entry = await stake(t, s, "MONO_BUY_IN", "Arjun", 500);
    expect(entry).toMatchObject({ type: "MONO_BUY_IN", mGameId: s.gameId, fromPool: false, toPool: false });
    expect(await balances(t, s.sessionId)).toEqual(before);
    const { nets } = await s.host.as.query(api.report.settlement, { sessionId: s.sessionId });
    expect(nets.find((n) => n.name === "Arjun")).toMatchObject({ stakes: -500, net: -500 });
    expect(nets.find((n) => n.name === "Priya")).toMatchObject({ stakes: 0, net: 0 });
    await checkInvariants(t, s.sessionId);
  });

  test("a finished game pays out what it took; net = payouts − buy-ins and settle-up follows", async () => {
    const t = setup();
    const s = await monoTable(t);
    for (const n of ["Arjun", "Priya", "Meera"]) await stake(t, s, "MONO_BUY_IN", n, 500);
    await stake(t, s, "MONO_PAYOUT", "Priya", 1500);
    await endGame(t, s);
    const inv = await checkInvariants(t, s.sessionId);
    expect(inv.openStakes).toBe(0);
    const { nets, transfers } = await s.host.as.query(api.report.settlement, { sessionId: s.sessionId });
    expect(Object.fromEntries(nets.map((n) => [n.name, n.net]))).toEqual({ Arjun: -500, Priya: 1000, Meera: -500 });
    // Everyone pays the winner: the existing settle-up works unchanged.
    expect(transfers).toHaveLength(2);
    expect(transfers!.reduce((sum, x) => sum + x.amount, 0)).toBe(1000);
    expect(transfers!.every((x) => x.to === s.seats.Priya.playerId)).toBe(true);
  });

  test("while a game is running its buy-ins are the open stake pot and the invariants still hold", async () => {
    const t = setup();
    const s = await monoTable(t);
    for (const n of ["Arjun", "Priya", "Meera"]) await stake(t, s, "MONO_BUY_IN", n, 500);
    const inv = await checkInvariants(t, s.sessionId);
    expect(inv).toMatchObject({ openStakes: 1500, netSum: -1500 });
    const { transfers } = await s.host.as.query(api.report.settlement, { sessionId: s.sessionId });
    expect(transfers).toBeNull(); // no settle-up until the game closes
  });

  test("undone stakes go back: a reversed buy-in restores the net, and a reversed payout takes it off", async () => {
    const t = setup();
    const s = await monoTable(t);
    const buyIn = await stake(t, s, "MONO_BUY_IN", "Arjun", 500);
    const payout = await stake(t, s, "MONO_PAYOUT", "Arjun", 300);
    await t.run((ctx) => reverseEntry(ctx, payout, s.host.playerId));
    await t.run((ctx) => reverseEntry(ctx, buyIn, s.host.playerId));
    const { nets } = await s.host.as.query(api.report.settlement, { sessionId: s.sessionId });
    expect(nets.find((n) => n.name === "Arjun")).toMatchObject({ stakes: 0, net: 0 });
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 1000, Priya: 1000, Meera: 1000 });
    await endGame(t, s);
    await checkInvariants(t, s.sessionId);
  });

  test("a cancelled game must have refunded every stake", async () => {
    const t = setup();
    const s = await monoTable(t);
    const entry = await stake(t, s, "MONO_BUY_IN", "Arjun", 500);
    await t.run((ctx) => ctx.db.patch(s.gameId, { status: "cancelled" }));
    await expect(checkInvariants(t, s.sessionId)).rejects.toThrow(/cancelled Monopoly game #1 still holds/);
    await t.run((ctx) => reverseEntry(ctx, entry, s.host.playerId));
    await checkInvariants(t, s.sessionId);
  });

  test("the invariants flag a finished game that paid out more or less than it collected", async () => {
    const t = setup();
    const s = await monoTable(t);
    await stake(t, s, "MONO_BUY_IN", "Arjun", 500);
    await stake(t, s, "MONO_BUY_IN", "Priya", 500);
    await stake(t, s, "MONO_PAYOUT", "Priya", 900);
    await endGame(t, s);
    await expect(checkInvariants(t, s.sessionId)).rejects.toThrow(/took 1000 in stakes but paid out 900/);
  });

  test("malformed stake entries are rejected", async () => {
    const t = setup();
    const s = await monoTable(t);
    const base = { sessionId: s.sessionId, createdByPlayerId: s.host.playerId, amount: 100 };
    // No game.
    await expectError(t.run((ctx) => applyEntry(ctx, { ...base, type: "MONO_BUY_IN", fromPlayerId: s.host.playerId })), "INVALID_STATE", /need a Monopoly game/);
    // Wrong direction: a buy-in comes from a player, a payout goes to one.
    await expectError(t.run((ctx) => applyEntry(ctx, { ...base, mGameId: s.gameId, type: "MONO_BUY_IN", toPlayerId: s.host.playerId })), "INVALID_STATE", /Malformed/);
    await expectError(t.run((ctx) => applyEntry(ctx, { ...base, mGameId: s.gameId, type: "MONO_PAYOUT", fromPlayerId: s.host.playerId })), "INVALID_STATE", /Malformed/);
    // Stakes never touch a pool.
    await expectError(t.run((ctx) => applyEntry(ctx, { ...base, mGameId: s.gameId, type: "MONO_BUY_IN", fromPlayerId: s.host.playerId, toPool: true })), "INVALID_STATE");
    // A normal entry can't carry a Monopoly game.
    await expectError(t.run((ctx) => applyEntry(ctx, { ...base, mGameId: s.gameId, type: "TOP_UP", toPlayerId: s.host.playerId })), "INVALID_STATE", /Only stake entries/);
    // Whole rupees above zero.
    await expectError(t.run((ctx) => applyEntry(ctx, { ...base, amount: 0, mGameId: s.gameId, type: "MONO_BUY_IN", fromPlayerId: s.host.playerId })), "INVALID_AMOUNT");
  });

  test("a stake can't point at a Monopoly game from another session", async () => {
    const t = setup();
    const s = await monoTable(t);
    const other = await monoTable(t, ["Zed", "Yan"]);
    await expectError(
      t.run((ctx) => applyEntry(ctx, { sessionId: s.sessionId, mGameId: other.gameId, type: "MONO_BUY_IN", fromPlayerId: s.host.playerId, amount: 10, createdByPlayerId: s.host.playerId })),
      "NOT_FOUND",
    );
  });

  test("a stake isn't offered a player's wallet as an overdraft: a player with ₹0 can still be attributed a buy-in", async () => {
    const t = setup();
    const s = await monoTable(t);
    await t.run(async (ctx) => {
      const w = await ctx.db.query("wallets").withIndex("by_player", (q) => q.eq("sessionPlayerId", s.seats.Arjun.playerId)).unique();
      await ctx.db.patch(w!._id, { balance: 0 });
    });
    await expect(stake(t, s, "MONO_BUY_IN", "Arjun", 500)).resolves.toMatchObject({ amount: 500 });
  });
});

describe("Monopoly storage", () => {
  test("a pool session has no type, and Monopoly tables accept the board presets and settings", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const session = await t.run((ctx) => ctx.db.get(s.sessionId));
    expect(session!.type).toBeUndefined();

    const crewId = session!.crewId;
    const ids = await t.run(async (ctx) => {
      const a = await ctx.db.insert("boardConfigs", { crewId, presetKey: "classic", board: CLASSIC, updatedAt: 1 });
      const b = await ctx.db.insert("boardConfigs", { crewId, presetKey: "business", board: BUSINESS, updatedAt: 1 });
      return [a, b] as Id<"boardConfigs">[];
    });
    const back = await t.run((ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));
    expect(back.map((b) => b!.board.currency)).toEqual(["$", "₹"]);
    expect(back[1]!.board.verified).toBe(false);
    expect(back[1]!.board.spaces).toHaveLength(40);
  });

  test("the schema rejects a malformed board", async () => {
    const t = setup();
    const s = await table(t, ["Arjun", "Priya"]);
    const session = await t.run((ctx) => ctx.db.get(s.sessionId));
    await expect(
      t.run((ctx) => ctx.db.insert("boardConfigs", { crewId: session!.crewId, presetKey: "x", board: { ...CLASSIC, passGo: "lots" } as never, updatedAt: 1 })),
    ).rejects.toThrow();
  });
});
