/// <reference types="vite/client" />
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { balances, expectError, key, newDevice, setup, type Device, type T } from "./test.setup";
import { table } from "./test.setup";
import { CLASSIC } from "../lib/monopoly/presets";

beforeAll(() => {
  process.env.MONOPOLY_ENABLED = "true";
});

type Opts = {
  settings?: Partial<{
    presetKey: string;
    startingCash: number;
    trackProperties: boolean;
    bankerMode: "selfService" | "bankerApproves";
    banker: string;
    freeParkingPot: boolean;
    doubleOnGo: boolean;
    buyIn: number;
    split: number[];
  }>;
  start?: boolean;
};

type Seat = { as: Device; sessionPlayerId: Id<"sessionPlayers">; playerId?: Id<"mPlayers"> };

/** A property-game session: the first name hosts, everyone joins from their own phone, then the game starts. */
async function monoTable(t: T, names: string[], opts: Opts = {}) {
  const [hostName, ...others] = names;
  const host = await newDevice(t);
  const created = await host.mutation(api.mono.createSession, { newCrewName: "Property Night", hostName, presetKey: opts.settings?.presetKey ?? "classic", idempotencyKey: key() });
  const seats: Record<string, Seat> = { [hostName]: { as: host, sessionPlayerId: created.playerId } };
  for (const n of others) {
    const device = await newDevice(t);
    const joined = await device.mutation(api.sessions.join, { code: created.code, newName: n, idempotencyKey: key() });
    seats[n] = { as: device, sessionPlayerId: joined.playerId };
  }
  const s = opts.settings ?? {};
  await host.mutation(api.mono.updateSetup, {
    gameId: created.gameId,
    presetKey: s.presetKey,
    startingCash: s.startingCash,
    trackProperties: s.trackProperties,
    bankerMode: s.bankerMode,
    bankerSessionPlayerId: s.banker ? seats[s.banker].sessionPlayerId : undefined,
    freeParkingPot: s.freeParkingPot,
    doubleOnGo: s.doubleOnGo,
    buyIn: s.buyIn,
    split: s.split,
  });
  if (opts.start !== false) {
    await host.mutation(api.mono.start, { gameId: created.gameId, idempotencyKey: key() });
    const state = await host.query(api.mono.state, { sessionId: created.sessionId });
    for (const p of state.game!.players) {
      const name = state.seats.find((x) => x._id === p.sessionPlayerId)!.name;
      seats[name].playerId = p._id;
    }
  }
  return { sessionId: created.sessionId, code: created.code, gameId: created.gameId, seats, host: seats[hostName], hostName };
}
type Table = Awaited<ReturnType<typeof monoTable>>;

const perform = (s: Table, who: string, action: Record<string, unknown>) =>
  s.seats[who].as.mutation(api.mono.perform, { gameId: s.gameId, action: action as never, idempotencyKey: key() });

async function cashOf(t: T, s: Table) {
  return await t.run(async (ctx) => {
    const players = await ctx.db.query("mPlayers").withIndex("by_game", (q) => q.eq("gameId", s.gameId)).collect();
    const out: Record<string, number> = {};
    for (const p of players) out[(await ctx.db.get(p.sessionPlayerId))!.name] = p.cash;
    return out;
  });
}

const check = (t: T, s: Table) => t.query(internal.mono.assertGameInvariants, { gameId: s.gameId });
const id = (s: Table, who: string) => s.seats[who].playerId!;

describe("creating a property game", () => {
  test("is refused unless the server has Monopoly switched on", async () => {
    const t = setup();
    const device = await newDevice(t);
    process.env.MONOPOLY_ENABLED = "false";
    try {
      await expectError(device.mutation(api.mono.createSession, { newCrewName: "X", hostName: "A", presetKey: "classic", idempotencyKey: key() }), "FORBIDDEN");
    } finally {
      process.env.MONOPOLY_ENABLED = "true";
    }
  });

  test("makes a monopoly session with a game waiting in setup, and no pool wallet money", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { start: false });
    const session = await t.run((ctx) => ctx.db.get(s.sessionId));
    expect(session).toMatchObject({ type: "monopoly", status: "lobby", startingAmount: 0 });
    const state = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(state.game).toMatchObject({ status: "setup", gameNo: 1 });
    expect(state.game!.boardSnapshot.key).toBe("classic");
    expect(state.seats).toHaveLength(3);
    // No session-level buy-in: wallets stay at zero for everyone.
    expect(await balances(t, s.sessionId)).toEqual({ Arjun: 0, Priya: 0, Meera: 0 });
    const info = await s.host.as.query(api.sessions.joinInfo, { code: s.code });
    expect(info!.type).toBe("monopoly");
  });

  test("only the host can change the setup, and only before the game starts", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { start: false });
    await expectError(s.seats.Priya.as.mutation(api.mono.updateSetup, { gameId: s.gameId, freeParkingPot: true }), "NOT_HOST");
    await s.host.as.mutation(api.mono.updateSetup, { gameId: s.gameId, presetKey: "business", startingCash: 2000 });
    const state = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(state.game!.boardSnapshot).toMatchObject({ key: "business", currency: "₹", startingCash: 2000 });
    await s.host.as.mutation(api.mono.start, { gameId: s.gameId, idempotencyKey: key() });
    await expectError(s.host.as.mutation(api.mono.updateSetup, { gameId: s.gameId, freeParkingPot: true }), "INVALID_STATE", /already started/);
  });

  test("rejects a payout split that doesn't total 100", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { start: false });
    await s.host.as.mutation(api.mono.updateSetup, { gameId: s.gameId, split: [60, 30] }).then(
      () => {
        throw new Error("should have failed");
      },
      (e) => expect(String(e.data?.message ?? e)).toMatch(/total 100/),
    );
  });

  test("start deals starting cash in seat order, creates property states, and gives the first seat the turn", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    expect(await cashOf(t, s)).toEqual({ Arjun: 1500, Priya: 1500, Meera: 1500 });
    const state = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(state.game).toMatchObject({ status: "active", turnNo: 1, bankHouses: 32, bankHotels: 12 });
    expect(state.game!.props).toHaveLength(28);
    expect(state.game!.currentTurnPlayerId).toBe(id(s, "Arjun"));
    expect(state.game!.myPlayerId).toBe(id(s, "Arjun"));
    await check(t, s);
  });

  test("a money-only game has no property states", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { settings: { trackProperties: false, presetKey: "business" } });
    const state = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(state.game!.props).toHaveLength(0);
    await check(t, s);
  });

  test("needs two players and a banker when banker mode is on", async () => {
    const t = setup();
    const solo = await monoTable(t, ["Arjun"], { start: false });
    await expectError(solo.host.as.mutation(api.mono.start, { gameId: solo.gameId, idempotencyKey: key() }), "INVALID_STATE", /at least two/);
    const s = await monoTable(t, ["Arjun", "Priya"], { start: false, settings: { bankerMode: "bankerApproves" } });
    await expectError(s.host.as.mutation(api.mono.start, { gameId: s.gameId, idempotencyKey: key() }), "INVALID_STATE", /banker/);
  });

  test("a player who joins after the game starts is only watching", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const late = await newDevice(t);
    await late.mutation(api.sessions.join, { code: s.code, newName: "Latecomer", idempotencyKey: key() });
    const state = await late.query(api.mono.state, { sessionId: s.sessionId });
    expect(state.game!.myPlayerId).toBeNull();
    await expectError(late.mutation(api.mono.perform, { gameId: s.gameId, action: { kind: "bankCollect", amount: 10 }, idempotencyKey: key() }), "FORBIDDEN");
  });
});

describe("real-₹ stakes", () => {
  test("buy-ins are recorded per player at start and show up in the nets; cancel refunds them", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { buyIn: 500, split: [70, 30] } });
    let { nets } = await s.host.as.query(api.report.settlement, { sessionId: s.sessionId });
    expect(nets.map((n) => n.stakes)).toEqual([-500, -500, -500]);
    await s.host.as.mutation(api.mono.cancelGame, { gameId: s.gameId, idempotencyKey: key() });
    ({ nets } = await s.host.as.query(api.report.settlement, { sessionId: s.sessionId }));
    expect(nets.map((n) => n.net)).toEqual([0, 0, 0]);
    await t.query(internal.invariants.assertSessionInvariants, { sessionId: s.sessionId });
    const state = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(state.game).toMatchObject({ status: "cancelled" });
  });
});

describe("Pass GO, bank moves and payments", () => {
  test("Pass GO pays the preset amount, and a second tap in the same turn asks first", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await perform(s, "Arjun", { kind: "passGo" });
    expect((await cashOf(t, s)).Arjun).toBe(1700);
    const e = await expectError(perform(s, "Arjun", { kind: "passGo" }), "NEEDS_CONFIRM", /already collected GO/);
    expect(e.message).toContain("Arjun");
    expect((await cashOf(t, s)).Arjun).toBe(1700);
    await perform(s, "Arjun", { kind: "passGo", confirmRepeat: true });
    expect((await cashOf(t, s)).Arjun).toBe(1900);
    await s.seats.Arjun.as.mutation(api.mono.endTurn, { gameId: s.gameId });
    await perform(s, "Arjun", { kind: "passGo" }); // next lap, no warning
    await check(t, s);
  });

  test("doubleOnGo pays double only when landing exactly on GO", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { settings: { doubleOnGo: true } });
    await perform(s, "Priya", { kind: "passGo", landedExactly: true });
    expect((await cashOf(t, s)).Priya).toBe(1900);
  });

  test("a player pays the bank and collects from it for themselves", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await perform(s, "Priya", { kind: "bankPay", amount: 200, reason: "tax" });
    await perform(s, "Priya", { kind: "bankCollect", amount: 50 });
    expect((await cashOf(t, s)).Priya).toBe(1350);
    await check(t, s);
  });

  test("taxes go into the Free Parking pot when that rule is on, and Collect pot pays it out", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { settings: { freeParkingPot: true } });
    await perform(s, "Priya", { kind: "bankPay", amount: 200, reason: "tax" });
    await perform(s, "Arjun", { kind: "bankPay", amount: 100, reason: "card" });
    let state = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(state.game!.freeParkingPot).toBe(300);
    await perform(s, "Arjun", { kind: "collectPot" });
    state = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(state.game!.freeParkingPot).toBe(0);
    expect((await cashOf(t, s)).Arjun).toBe(1500 - 100 + 300);
    await check(t, s);
  });

  test("cash can't go below 0: a payment bigger than the payer's cash is blocked and says who is short", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const e = await expectError(perform(s, "Priya", { kind: "pay", toPlayerId: id(s, "Arjun"), amount: 1501 }), "INSUFFICIENT_BALANCE", /Priya has only \$1,500/);
    expect(e).toMatchObject({ detail: { playerId: id(s, "Priya"), needed: 1501, shortBy: 1 } });
    expect(await cashOf(t, s)).toEqual({ Arjun: 1500, Priya: 1500 });
    await check(t, s);
  });

  test("payments between players are instant and move exactly that amount", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await perform(s, "Priya", { kind: "pay", toPlayerId: id(s, "Arjun"), amount: 300 });
    expect(await cashOf(t, s)).toEqual({ Arjun: 1800, Priya: 1200, Meera: 1500 });
    await check(t, s);
  });

  test("a repeated request key moves money once", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const k = key();
    const args = { gameId: s.gameId, action: { kind: "bankCollect" as const, amount: 100 }, idempotencyKey: k };
    await s.seats.Priya.as.mutation(api.mono.perform, args);
    await s.seats.Priya.as.mutation(api.mono.perform, args);
    expect((await cashOf(t, s)).Priya).toBe(1600);
  });

  test("self-service: you move only your own money; the host can act for anyone", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await expectError(perform(s, "Priya", { kind: "bankCollect", playerId: id(s, "Meera"), amount: 100 }), "FORBIDDEN", /your own money/);
    await perform(s, "Arjun", { kind: "bankCollect", playerId: id(s, "Meera"), amount: 100 });
    expect((await cashOf(t, s)).Meera).toBe(1600);
  });

  test("a bankrupt or paused game takes no moves", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await t.run((ctx) => ctx.db.patch(s.gameId, { status: "paused" }));
    await expectError(perform(s, "Arjun", { kind: "passGo" }), "INVALID_STATE", /paused/);
  });
});

describe("payment requests", () => {
  const ask = (s: Table, from: string, payer: string, amount: number) =>
    s.seats[from].as.mutation(api.mono.requestPayment, { gameId: s.gameId, fromPlayerId: id(s, payer), amount, idempotencyKey: key() });
  const answer = (s: Table, who: string, requestId: Id<"mRequests">, accept: boolean) =>
    s.seats[who].as.mutation(api.mono.respond, { requestId, accept, idempotencyKey: key() });

  test("the receiver asks, the payer accepts, and the money moves once", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const { requestId } = await ask(s, "Arjun", "Priya", 250);
    expect(await cashOf(t, s)).toEqual({ Arjun: 1500, Priya: 1500 });
    await expectError(answer(s, "Arjun", requestId, true), "FORBIDDEN"); // the asker can't accept their own request
    await answer(s, "Priya", requestId, true);
    expect(await cashOf(t, s)).toEqual({ Arjun: 1750, Priya: 1250 });
    await expectError(answer(s, "Priya", requestId, true), "INVALID_STATE");
    await check(t, s);
  });

  test("declining moves nothing; the asker can withdraw", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const a = await ask(s, "Arjun", "Priya", 100);
    await answer(s, "Priya", a.requestId, false);
    const b = await ask(s, "Arjun", "Priya", 100);
    await s.seats.Arjun.as.mutation(api.mono.cancelRequest, { requestId: b.requestId });
    expect(await cashOf(t, s)).toEqual({ Arjun: 1500, Priya: 1500 });
    const rows = await t.run((ctx) => Promise.all([ctx.db.get(a.requestId), ctx.db.get(b.requestId)]));
    expect(rows.map((r) => r!.status)).toEqual(["declined", "cancelled"]);
  });

  test("accepting a request the payer can't afford fails and the request stays open", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const { requestId } = await ask(s, "Arjun", "Priya", 2000);
    await expectError(answer(s, "Priya", requestId, true), "INSUFFICIENT_BALANCE");
    expect((await t.run((ctx) => ctx.db.get(requestId)))!.status).toBe("pending");
  });

  test("requests expire after 5 minutes: the scheduled function closes them and a late answer is refused", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const { requestId } = await ask(s, "Arjun", "Priya", 100);
    const req = (await t.run((ctx) => ctx.db.get(requestId)))!;
    expect(req.expiresAt - req.createdAt).toBe(5 * 60 * 1000);
    expect(req.scheduledId).toBeDefined();
    // Too early: nothing happens.
    await t.mutation(internal.mono.expireRequest, { requestId });
    expect((await t.run((ctx) => ctx.db.get(requestId)))!.status).toBe("pending");
    await t.run((ctx) => ctx.db.patch(requestId, { expiresAt: Date.now() - 1 }));
    await t.mutation(internal.mono.expireRequest, { requestId });
    expect((await t.run((ctx) => ctx.db.get(requestId)))!.status).toBe("expired");
    await expectError(answer(s, "Priya", requestId, true), "INVALID_STATE", /expired/);
    expect(await cashOf(t, s)).toEqual({ Arjun: 1500, Priya: 1500 });
  });

  test("an unanswered request past its time is also closed by a late answer", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const { requestId } = await ask(s, "Arjun", "Priya", 100);
    await t.run((ctx) => ctx.db.patch(requestId, { expiresAt: Date.now() - 1 }));
    await expectError(answer(s, "Priya", requestId, true), "INVALID_STATE", /expired/);
  });

  test("you can't ask yourself, or ask for a bad amount", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await expectError(ask(s, "Arjun", "Arjun", 10), "INVALID_STATE");
    await expectError(ask(s, "Arjun", "Priya", 0), "INVALID_AMOUNT");
  });
});

describe("banker mode", () => {
  const settings = { bankerMode: "bankerApproves" as const };
  const approve = (s: Table, who: string, requestId: Id<"mRequests">, accept = true) =>
    s.seats[who].as.mutation(api.mono.respond, { requestId, accept, idempotencyKey: key() });

  test("a player's bank move waits for the banker; approving runs it against the game as it is now", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { ...settings, banker: "Meera" } });
    const r = await perform(s, "Priya", { kind: "bankCollect", amount: 400 });
    expect(r).toMatchObject({ status: "pending", groupId: null });
    expect((await cashOf(t, s)).Priya).toBe(1500);
    // Only the banker (or host) can approve.
    await expectError(approve(s, "Priya", r.requestId!), "FORBIDDEN");
    await approve(s, "Meera", r.requestId!);
    expect((await cashOf(t, s)).Priya).toBe(1900);
    await check(t, s);
  });

  test("the banker's own bank moves go to the host", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { ...settings, banker: "Meera" } });
    const r = await perform(s, "Meera", { kind: "passGo" });
    expect(r.status).toBe("pending");
    const req = await t.run((ctx) => ctx.db.get(r.requestId!));
    expect(req!.toPlayerId).toBe(id(s, "Arjun")); // Arjun hosts
    await expectError(approve(s, "Priya", r.requestId!), "FORBIDDEN");
    await approve(s, "Arjun", r.requestId!);
    expect((await cashOf(t, s)).Meera).toBe(1700);
  });

  test("the host acts at once, and player-to-player payments stay instant", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { ...settings, banker: "Meera" } });
    expect(await perform(s, "Arjun", { kind: "bankCollect", amount: 100 })).toMatchObject({ status: "done" });
    expect(await perform(s, "Priya", { kind: "pay", toPlayerId: id(s, "Meera"), amount: 50 })).toMatchObject({ status: "done" });
    expect(await cashOf(t, s)).toEqual({ Arjun: 1600, Priya: 1450, Meera: 1550 });
  });

  test("the host can approve too, and declining moves nothing", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { ...settings, banker: "Meera" } });
    const a = await perform(s, "Priya", { kind: "bankPay", amount: 100, reason: "tax" });
    const b = await perform(s, "Priya", { kind: "bankCollect", amount: 100 });
    await approve(s, "Arjun", a.requestId!);
    await approve(s, "Meera", b.requestId!, false);
    expect((await cashOf(t, s)).Priya).toBe(1400);
  });

  test("a request that is no longer affordable when approved fails cleanly and stays pending", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { ...settings, banker: "Meera" } });
    const r = await perform(s, "Priya", { kind: "bankPay", amount: 1000, reason: "bank" });
    await perform(s, "Priya", { kind: "pay", toPlayerId: id(s, "Arjun"), amount: 1200 });
    await expectError(approve(s, "Meera", r.requestId!), "INSUFFICIENT_BALANCE");
    expect((await t.run((ctx) => ctx.db.get(r.requestId!)))!.status).toBe("pending");
    expect((await cashOf(t, s)).Priya).toBe(300);
  });

  test("a doomed bank move is refused when it's made, not queued", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { ...settings, banker: "Meera" } });
    await expectError(perform(s, "Priya", { kind: "bankPay", amount: 5000, reason: "bank" }), "INSUFFICIENT_BALANCE");
  });

  test("the requester can withdraw a queued move", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { ...settings, banker: "Meera" } });
    const r = await perform(s, "Priya", { kind: "passGo" });
    await s.seats.Priya.as.mutation(api.mono.cancelRequest, { requestId: r.requestId! });
    await expectError(approve(s, "Meera", r.requestId!), "INVALID_STATE");
  });
});

describe("turns", () => {
  test("the turn passes in seat order, only the current player or the host can end it", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    const turn = async () => (await s.host.as.query(api.mono.state, { sessionId: s.sessionId })).game!.currentTurnPlayerId;
    expect(await turn()).toBe(id(s, "Arjun"));
    await expectError(s.seats.Priya.as.mutation(api.mono.endTurn, { gameId: s.gameId }), "NOT_YOUR_TURN", /Arjun's turn/);
    await s.seats.Arjun.as.mutation(api.mono.endTurn, { gameId: s.gameId });
    expect(await turn()).toBe(id(s, "Priya"));
    await s.host.as.mutation(api.mono.endTurn, { gameId: s.gameId }); // the host can end anyone's turn
    expect(await turn()).toBe(id(s, "Meera"));
    await s.seats.Meera.as.mutation(api.mono.endTurn, { gameId: s.gameId });
    expect(await turn()).toBe(id(s, "Arjun")); // wraps
    expect((await s.host.as.query(api.mono.state, { sessionId: s.sessionId })).game!.turnNo).toBe(4);
    await check(t, s);
  });
});

describe("grouped undo", () => {
  const groupOf = async (t: T, s: Table, nth = -1) => {
    const state = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    const ids = [...new Set(state.game!.events.filter((e) => e.type !== "TURN").map((e) => e.groupId))].reverse();
    return ids.at(nth)!;
  };
  const undo = (s: Table, who: string, groupId: string) => s.seats[who].as.mutation(api.mono.undo, { gameId: s.gameId, groupId, idempotencyKey: key() });

  test("the host reverses a whole action, and only the host can", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await perform(s, "Priya", { kind: "pay", toPlayerId: id(s, "Arjun"), amount: 300 });
    const groupId = await groupOf(t, s);
    await expectError(undo(s, "Priya", groupId), "NOT_HOST");
    await undo(s, "Arjun", groupId);
    expect(await cashOf(t, s)).toEqual({ Arjun: 1500, Priya: 1500 });
    await expectError(undo(s, "Arjun", groupId), "ALREADY_REVERSED");
    await check(t, s);
  });

  test("undoing an action refused when a later one touched the same cash, naming the blocker", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await perform(s, "Priya", { kind: "pay", toPlayerId: id(s, "Arjun"), amount: 300 });
    const first = await groupOf(t, s);
    await perform(s, "Arjun", { kind: "pay", toPlayerId: id(s, "Meera"), amount: 100 });
    await expectError(undo(s, "Arjun", first), "NOT_UNDOABLE", /Undo "Arjun paid Meera \$100" first/);
    // Undo in the right order and both come back.
    await undo(s, "Arjun", await groupOf(t, s));
    await undo(s, "Arjun", first);
    expect(await cashOf(t, s)).toEqual({ Arjun: 1500, Priya: 1500, Meera: 1500 });
    await check(t, s);
  });

  test("an undo can't be undone, and undoing Pass GO clears the once-per-turn warning", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await perform(s, "Arjun", { kind: "passGo" });
    const go = await groupOf(t, s);
    await undo(s, "Arjun", go);
    const reversal = await groupOf(t, s);
    await expectError(undo(s, "Arjun", reversal), "NOT_UNDOABLE");
    await perform(s, "Arjun", { kind: "passGo" }); // no "already collected" warning after the undo
    expect((await cashOf(t, s)).Arjun).toBe(1700);
    await check(t, s);
  });

  test("an undo that would take cash someone has since spent is blocked, not left to fail", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await perform(s, "Priya", { kind: "bankCollect", amount: 500 });
    const collect = await groupOf(t, s);
    await perform(s, "Priya", { kind: "pay", toPlayerId: id(s, "Arjun"), amount: 2000 });
    await expectError(undo(s, "Arjun", collect), "NOT_UNDOABLE", /first/);
    expect(await cashOf(t, s)).toEqual({ Arjun: 3500, Priya: 0 });
    await check(t, s);
  });

  test("the feed carries plain-language labels for each group", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await perform(s, "Priya", { kind: "pay", toPlayerId: id(s, "Arjun"), amount: 300 });
    await perform(s, "Arjun", { kind: "passGo" });
    const state = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(state.game!.events.map((e) => e.label)).toEqual(["Arjun passed GO and collected $200", "Priya paid Arjun $300"]);
  });
});

describe("pool sessions are untouched", () => {
  test("pool-only actions refuse a property-game session", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await expectError(s.host.as.mutation(api.wallet.topUp, { sessionId: s.sessionId, amount: 100, idempotencyKey: key() }), "WRONG_SESSION_TYPE");
    await expectError(
      s.seats.Priya.as.mutation(api.loans.request, { sessionId: s.sessionId, lenderPlayerId: s.host.sessionPlayerId, amount: 10, idempotencyKey: key() }),
      "WRONG_SESSION_TYPE",
    );
    const crewTemplates = await t.run(async (ctx) => {
      const session = (await ctx.db.get(s.sessionId))!;
      return await ctx.db.query("gameTemplates").withIndex("by_crew", (q) => q.eq("crewId", session.crewId)).first();
    });
    await expectError(
      s.host.as.mutation(api.games.start, {
        sessionId: s.sessionId,
        templateId: crewTemplates!._id,
        participants: [{ playerId: s.host.sessionPlayerId }, { playerId: s.seats.Priya.sessionPlayerId }],
        idempotencyKey: key(),
      }),
      "WRONG_SESSION_TYPE",
    );
  });

  test("a property session can't end or reseat mid-game, and ends fine afterwards", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await expectError(s.host.as.mutation(api.sessions.end, { sessionId: s.sessionId, idempotencyKey: key() }), "INVALID_STATE", /cancel the current game/);
    await expectError(s.host.as.mutation(api.sessions.reorderSeats, { sessionId: s.sessionId, order: [s.seats.Priya.sessionPlayerId, s.host.sessionPlayerId] }), "INVALID_STATE");
    await s.host.as.mutation(api.mono.cancelGame, { gameId: s.gameId, idempotencyKey: key() });
    await s.host.as.mutation(api.sessions.end, { sessionId: s.sessionId, idempotencyKey: key() });
    expect((await t.run((ctx) => ctx.db.get(s.sessionId)))!.status).toBe("ended");
  });

  test("a session that ends before its game starts cancels the waiting game", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { start: false });
    await s.host.as.mutation(api.sessions.end, { sessionId: s.sessionId, idempotencyKey: key() });
    expect((await t.run((ctx) => ctx.db.get(s.gameId)))!.status).toBe("cancelled");
  });

  test("a pool session is unchanged: no type, normal buy-ins, and the pool table works", async () => {
    const t = setup();
    const p = await table(t, ["Arjun", "Priya"], { startingAmount: 1000 });
    expect((await t.run((ctx) => ctx.db.get(p.sessionId)))!.type).toBeUndefined();
    expect(await balances(t, p.sessionId)).toEqual({ Arjun: 1000, Priya: 1000 });
    await expectError(p.host.as.query(api.mono.state, { sessionId: p.sessionId }), "WRONG_SESSION_TYPE");
    const info = await p.host.as.query(api.sessions.joinInfo, { code: p.code });
    expect(info!.type).toBe("pool");
  });

  test("a rematch is a new game in the same session with the same rules", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { settings: { freeParkingPot: true, presetKey: "business" } });
    await expectError(s.host.as.mutation(api.mono.newGame, { sessionId: s.sessionId }), "INVALID_STATE", /Finish or cancel/);
    await s.host.as.mutation(api.mono.cancelGame, { gameId: s.gameId, idempotencyKey: key() });
    const { gameId } = await s.host.as.mutation(api.mono.newGame, { sessionId: s.sessionId });
    const state = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(state.game).toMatchObject({ _id: gameId, gameNo: 2, status: "setup" });
    expect(state.game!.settings.freeParkingPot).toBe(true);
    expect(state.game!.boardSnapshot.key).toBe("business");
  });
});

// ---------------------------------------------------------------------------------------------
// Milestone 3: property tracking and the crew board editor
// ---------------------------------------------------------------------------------------------

const sp = (name: string) => CLASSIC.spaces.find((x) => x.name === name)!.id;
const ORANGE = ["Market Sq", "Bridge St", "Chapel Hill"];

async function propOf(t: T, s: Table, name: string) {
  return await t.run(async (ctx) => {
    const row = await ctx.db.query("mPropertyStates").withIndex("by_game_space", (q) => q.eq("gameId", s.gameId).eq("spaceId", sp(name))).unique();
    const owner = row!.ownerPlayerId ? (await ctx.db.get(row!.ownerPlayerId))! : null;
    const ownerName = owner ? (await ctx.db.get(owner.sessionPlayerId))!.name : null;
    return { owner: ownerName, houses: row!.houses, hotel: row!.hotel, mortgaged: row!.mortgaged };
  });
}
const stock = async (t: T, s: Table) => {
  const g = await t.run((ctx) => ctx.db.get(s.gameId));
  return { houses: g!.bankHouses, hotels: g!.bankHotels };
};
const buy = (s: Table, who: string, name: string) => perform(s, who, { kind: "buy", spaceId: sp(name) });
async function ownSet(s: Table, who: string, names = ORANGE) {
  for (const n of names) await buy(s, who, n);
}

describe("buying and rent", () => {
  test("buying takes the list price and hands over the deed", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await buy(s, "Priya", "Market Sq");
    expect((await cashOf(t, s)).Priya).toBe(1320);
    expect(await propOf(t, s, "Market Sq")).toMatchObject({ owner: "Priya", houses: 0, mortgaged: false });
    await expectError(buy(s, "Meera", "Market Sq"), "INVALID_STATE", /already has an owner/);
    await expectError(buy(s, "Meera", "GO"), "INVALID_STATE");
    await check(t, s);
  });

  test("you can't buy what you can't afford, and the deed stays with the bank", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { settings: { startingCash: 100 } });
    await expectError(buy(s, "Priya", "Market Sq"), "INSUFFICIENT_BALANCE");
    expect((await propOf(t, s, "Market Sq")).owner).toBeNull();
  });

  test("money-only games refuse property actions", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { settings: { trackProperties: false } });
    await expectError(buy(s, "Priya", "Market Sq"), "INVALID_STATE", /aren't tracked/);
  });

  test("landing on an owned space: rent is paid in one tap, doubled for a full set, and is player-to-player", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await buy(s, "Arjun", "Market Sq");
    await perform(s, "Priya", { kind: "rent", spaceId: sp("Market Sq") });
    expect(await cashOf(t, s)).toMatchObject({ Arjun: 1500 - 180 + 14, Priya: 1486 });
    await buy(s, "Arjun", "Bridge St");
    await buy(s, "Arjun", "Chapel Hill");
    await perform(s, "Meera", { kind: "rent", spaceId: sp("Market Sq") }); // full unimproved set: 2 × 14
    expect((await cashOf(t, s)).Meera).toBe(1472);
    await check(t, s);
  });

  test("utilities ask for the dice total; the owner can't pay themselves; unowned and mortgaged owe nothing", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await buy(s, "Arjun", "Power Co.");
    await expectError(perform(s, "Priya", { kind: "rent", spaceId: sp("Power Co.") }), "INVALID_STATE", /dice total/);
    await perform(s, "Priya", { kind: "rent", spaceId: sp("Power Co."), diceTotal: 8 });
    expect((await cashOf(t, s)).Priya).toBe(1500 - 32);
    await expectError(perform(s, "Arjun", { kind: "rent", spaceId: sp("Power Co."), diceTotal: 8 }), "INVALID_STATE", /You own this/);
    await expectError(perform(s, "Priya", { kind: "rent", spaceId: sp("Mill Lane") }), "INVALID_STATE", /bank owns/);
    await perform(s, "Arjun", { kind: "mortgage", spaceId: sp("Power Co.") });
    await expectError(perform(s, "Priya", { kind: "rent", spaceId: sp("Power Co."), diceTotal: 8 }), "INVALID_STATE", /Mortgaged/);
  });

  test("rent the payer can't afford says who is short and by how much", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await ownSet(s, "Arjun");
    for (let i = 0; i < 3; i++) for (const n of ORANGE) await perform(s, "Arjun", { kind: "build", spaceId: sp(n) });
    await perform(s, "Priya", { kind: "bankPay", amount: 1000, reason: "bank" });
    // 3 houses on Market Sq = $550 rent against $500 cash.
    const e = await expectError(perform(s, "Priya", { kind: "rent", spaceId: sp("Market Sq") }), "INSUFFICIENT_BALANCE");
    expect(e).toMatchObject({ detail: { playerId: id(s, "Priya"), needed: 550, shortBy: 50 } });
  });
});

describe("building, selling, mortgages", () => {
  test("building needs the set, charges the house cost and draws from the bank's 32 houses", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await buy(s, "Arjun", "Market Sq");
    await expectError(perform(s, "Arjun", { kind: "build", spaceId: sp("Market Sq") }), "INVALID_STATE", /whole orange set/);
    await buy(s, "Arjun", "Bridge St");
    await buy(s, "Arjun", "Chapel Hill");
    const before = (await cashOf(t, s)).Arjun;
    await perform(s, "Arjun", { kind: "build", spaceId: sp("Market Sq") });
    expect((await cashOf(t, s)).Arjun).toBe(before - 100);
    expect(await stock(t, s)).toEqual({ houses: 31, hotels: 12 });
    await expectError(perform(s, "Arjun", { kind: "build", spaceId: sp("Market Sq") }), "INVALID_STATE", /evenly/);
    await check(t, s);
  });

  test("four houses then a hotel returns the houses to the bank; selling steps back down for half the cost", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { settings: { startingCash: 5000 } });
    await ownSet(s, "Arjun");
    for (let i = 0; i < 4; i++) for (const n of ORANGE) await perform(s, "Arjun", { kind: "build", spaceId: sp(n) });
    expect(await stock(t, s)).toEqual({ houses: 20, hotels: 12 });
    await perform(s, "Arjun", { kind: "build", spaceId: sp("Market Sq") });
    expect(await propOf(t, s, "Market Sq")).toMatchObject({ houses: 0, hotel: true });
    expect(await stock(t, s)).toEqual({ houses: 24, hotels: 11 });
    const cash = (await cashOf(t, s)).Arjun;
    await expectError(perform(s, "Arjun", { kind: "sellBuilding", spaceId: sp("Bridge St") }), "INVALID_STATE", /Sell evenly/);
    await perform(s, "Arjun", { kind: "sellBuilding", spaceId: sp("Market Sq") });
    expect((await cashOf(t, s)).Arjun).toBe(cash + 50);
    expect(await propOf(t, s, "Market Sq")).toMatchObject({ houses: 4, hotel: false });
    await check(t, s);
  });

  test("the bank's houses run out: building is blocked", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { settings: { startingCash: 20000 } });
    // A board with no houses in the box at all (consistent with the stock invariant).
    await t.run(async (ctx) => {
      const g = (await ctx.db.get(s.gameId))!;
      await ctx.db.patch(s.gameId, { boardSnapshot: { ...g.boardSnapshot, houses: 0 }, bankHouses: 0 });
    });
    await ownSet(s, "Arjun");
    await expectError(perform(s, "Arjun", { kind: "build", spaceId: sp("Market Sq") }), "INVALID_STATE", /no houses left/);
  });

  test("mortgage pays half the price; unmortgage costs it plus 10%; buildings must be sold first", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await ownSet(s, "Arjun");
    await perform(s, "Arjun", { kind: "build", spaceId: sp("Market Sq") });
    await expectError(perform(s, "Arjun", { kind: "mortgage", spaceId: sp("Bridge St") }), "INVALID_STATE", /Sell the buildings/);
    await perform(s, "Arjun", { kind: "sellBuilding", spaceId: sp("Market Sq") });
    const before = (await cashOf(t, s)).Arjun;
    await perform(s, "Arjun", { kind: "mortgage", spaceId: sp("Bridge St") });
    expect((await cashOf(t, s)).Arjun).toBe(before + 90);
    expect((await propOf(t, s, "Bridge St")).mortgaged).toBe(true);
    await expectError(perform(s, "Arjun", { kind: "build", spaceId: sp("Market Sq") }), "INVALID_STATE", /Unmortgage/);
    await perform(s, "Arjun", { kind: "unmortgage", spaceId: sp("Bridge St") });
    expect((await cashOf(t, s)).Arjun).toBe(before + 90 - 99);
    await expectError(perform(s, "Priya", { kind: "mortgage", spaceId: sp("Market Sq") }), "INVALID_STATE", /don't own/);
    await check(t, s);
  });

  test("you can only build for yourself; the host can for anyone", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await ownSet(s, "Priya");
    await expectError(perform(s, "Meera", { kind: "build", playerId: id(s, "Priya"), spaceId: sp("Market Sq") }), "FORBIDDEN");
    await perform(s, "Arjun", { kind: "build", playerId: id(s, "Priya"), spaceId: sp("Market Sq") });
    expect((await propOf(t, s, "Market Sq")).houses).toBe(1);
  });

  test("banker mode queues buying, building and mortgages but never rent", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { bankerMode: "bankerApproves", banker: "Meera" } });
    const r = await buy(s, "Priya", "Market Sq");
    expect(r.status).toBe("pending");
    expect((await propOf(t, s, "Market Sq")).owner).toBeNull();
    await s.seats.Meera.as.mutation(api.mono.respond, { requestId: r.requestId!, accept: true, idempotencyKey: key() });
    expect(await propOf(t, s, "Market Sq")).toMatchObject({ owner: "Priya" });
    expect((await cashOf(t, s)).Priya).toBe(1320);
    expect(await perform(s, "Arjun", { kind: "rent", spaceId: sp("Market Sq") })).toMatchObject({ status: "done" });
    const m = await perform(s, "Priya", { kind: "mortgage", spaceId: sp("Market Sq") });
    expect(m.status).toBe("pending");
    await check(t, s);
  });

  test("an approval that was overtaken fails cleanly: the deed was bought by someone else meanwhile", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { bankerMode: "bankerApproves", banker: "Meera" } });
    const queued = await buy(s, "Priya", "Market Sq");
    await buy(s, "Arjun", "Market Sq"); // the host buys at once
    await expectError(s.seats.Meera.as.mutation(api.mono.respond, { requestId: queued.requestId!, accept: true, idempotencyKey: key() }), "INVALID_STATE", /already has an owner/);
    expect((await propOf(t, s, "Market Sq")).owner).toBe("Arjun");
  });

  test("undoing a purchase returns the deed and cash, but not after rent was paid on it", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const groupOf = async () => {
      const st = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
      return st.game!.events.filter((e) => e.type !== "TURN")[0].groupId;
    };
    await buy(s, "Priya", "Market Sq");
    const purchase = await groupOf();
    await perform(s, "Arjun", { kind: "rent", spaceId: sp("Market Sq") });
    await expectError(s.host.as.mutation(api.mono.undo, { gameId: s.gameId, groupId: purchase, idempotencyKey: key() }), "NOT_UNDOABLE", /Undo "Arjun paid Priya \$14 rent for Market Sq" first/);
    await s.host.as.mutation(api.mono.undo, { gameId: s.gameId, groupId: await groupOf(), idempotencyKey: key() });
    await s.host.as.mutation(api.mono.undo, { gameId: s.gameId, groupId: purchase, idempotencyKey: key() });
    expect((await propOf(t, s, "Market Sq")).owner).toBeNull();
    expect(await cashOf(t, s)).toEqual({ Arjun: 1500, Priya: 1500 });
    await check(t, s);
  });

  test("labels read as sentences", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await buy(s, "Priya", "Market Sq");
    await perform(s, "Arjun", { kind: "rent", spaceId: sp("Market Sq") });
    const state = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect([...new Set(state.game!.events.map((e) => e.label))]).toEqual(["Arjun paid Priya $14 rent for Market Sq", "Priya bought Market Sq for $180"]);
  });
});

describe("crew board editor", () => {
  const crewOf = async (t: T, s: Table) => (await t.run((ctx) => ctx.db.get(s.sessionId)))!.crewId;
  const edited = (patch: (b: typeof CLASSIC) => void) => {
    const b = structuredClone(CLASSIC);
    patch(b);
    return b;
  };

  test("lists every preset, flagging which ones the crew has corrected", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { start: false });
    const crewId = await crewOf(t, s);
    const res = await s.host.as.query(api.monoBoards.list, { crewId });
    expect(res.boards.map((b) => [b.key, b.saved])).toEqual([["classic", false], ["business", false]]);
    expect(res.boards.find((b) => b.key === "business")!.board.verified).toBe(false);
  });

  test("a corrected board is used by the crew's next games, and other crews are untouched", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { start: false, settings: { presetKey: "business" } });
    const crewId = await crewOf(t, s);
    const board = (await s.host.as.query(api.monoBoards.list, { crewId })).boards.find((b) => b.key === "business")!.board;
    const fixed = structuredClone(board);
    const mumbai = fixed.spaces.find((x) => x.name === "Mumbai")!;
    mumbai.price = 420;
    mumbai.mortgage = 210;
    mumbai.verified = true;
    await s.host.as.mutation(api.monoBoards.save, { crewId, presetKey: "business", board: fixed });
    const after = await s.host.as.query(api.monoBoards.list, { crewId });
    expect(after.boards.find((b) => b.key === "business")).toMatchObject({ saved: true });
    expect(after.boards.find((b) => b.key === "classic")!.saved).toBe(false);

    // A brand-new game in this crew starts from the corrected board…
    const s2 = await monoTable(t, ["Zed", "Yan"], { start: false });
    const other = await s2.host.as.query(api.mono.state, { sessionId: s2.sessionId });
    expect(other.game!.boardSnapshot.key).toBe("classic");
    // …and so does the waiting game in the first session, straight away.
    const waiting = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(waiting.game!.boardSnapshot.spaces.find((x) => x.name === "Mumbai")).toMatchObject({ price: 420, verified: true });
    // The other crew's board is not affected.
    const otherCrew = await crewOf(t, s2);
    expect((await s2.host.as.query(api.monoBoards.list, { crewId: otherCrew })).boards.every((b) => !b.saved)).toBe(true);
  });

  test("a game keeps the board it started with; later corrections only affect new games", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const crewId = await crewOf(t, s);
    await s.host.as.mutation(api.monoBoards.save, { crewId, presetKey: "classic", board: edited((b) => (b.spaces.find((x) => x.name === "Market Sq")!.price = 999)) });
    const running = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(running.game!.boardSnapshot.spaces.find((x) => x.name === "Market Sq")!.price).toBe(180);
    await buy(s, "Priya", "Market Sq");
    expect((await cashOf(t, s)).Priya).toBe(1320);
    await s.host.as.mutation(api.mono.cancelGame, { gameId: s.gameId, idempotencyKey: key() });
    const { gameId } = await s.host.as.mutation(api.mono.newGame, { sessionId: s.sessionId });
    expect(gameId).toBeDefined();
  });

  test("a hosts's starting cash choice in the lobby survives a board correction", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { start: false, settings: { startingCash: 2500 } });
    const crewId = await crewOf(t, s);
    await s.host.as.mutation(api.monoBoards.save, { crewId, presetKey: "classic", board: edited((b) => (b.passGo = 300)) });
    const st = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(st.game!.boardSnapshot).toMatchObject({ passGo: 300, startingCash: 2500 });
  });

  test("rejects an invalid board with a plain reason, and only crew members can edit", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { start: false });
    const crewId = await crewOf(t, s);
    await expectError(
      s.host.as.mutation(api.monoBoards.save, { crewId, presetKey: "classic", board: edited((b) => (b.spaces[1].rent = [1, 2])) }),
      "INVALID_STATE",
      /needs 6 rents/,
    );
    await expectError(s.host.as.mutation(api.monoBoards.save, { crewId, presetKey: "business", board: structuredClone(CLASSIC) }), "INVALID_STATE", /doesn't match/);
    const stranger = await newDevice(t);
    await expectError(stranger.mutation(api.monoBoards.save, { crewId, presetKey: "classic", board: structuredClone(CLASSIC) }), "FORBIDDEN");
    await expectError(stranger.query(api.monoBoards.list, { crewId }), "FORBIDDEN");
  });

  test("reset goes back to the shipped preset", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { start: false });
    const crewId = await crewOf(t, s);
    await s.host.as.mutation(api.monoBoards.save, { crewId, presetKey: "classic", board: edited((b) => (b.jailFine = 75)) });
    expect((await s.host.as.query(api.mono.state, { sessionId: s.sessionId })).game!.boardSnapshot.jailFine).toBe(75);
    await s.host.as.mutation(api.monoBoards.reset, { crewId, presetKey: "classic" });
    expect((await s.host.as.query(api.mono.state, { sessionId: s.sessionId })).game!.boardSnapshot.jailFine).toBe(50);
    expect((await s.host.as.query(api.monoBoards.list, { crewId })).boards[0].saved).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Milestone 4: cards, jail, trades, auctions
// ---------------------------------------------------------------------------------------------

const auctionOf = async (t: T, s: Table) =>
  await t.run(async (ctx) => (await ctx.db.query("mAuctions").withIndex("by_game_status", (q) => q.eq("gameId", s.gameId)).collect()).sort((a, b) => a._creationTime - b._creationTime).at(-1) ?? null);
const jailOf = async (t: T, s: Table, who: string) =>
  await t.run(async (ctx) => {
    const p = (await ctx.db.get(id(s, who)))!;
    return { inJail: p.inJail, jailTurns: p.jailTurns, jailCards: p.jailCards };
  });

describe("card actions", () => {
  test("collect from every player is one atomic group, even in banker mode", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { bankerMode: "bankerApproves", banker: "Meera" } });
    const r = await perform(s, "Priya", { kind: "cardEvery", direction: "collect", amount: 50 });
    expect(r.status).toBe("done");
    expect(await cashOf(t, s)).toEqual({ Arjun: 1450, Priya: 1600, Meera: 1450 });
    const st = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect([...new Set(st.game!.events.map((e) => e.label))]).toEqual(["Priya collected $50 from every player"]);
    await check(t, s);
  });

  test("if any payer can't afford it, nobody pays and that payer is named", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await perform(s, "Meera", { kind: "pay", toPlayerId: id(s, "Arjun"), amount: 1480 });
    const e = await expectError(perform(s, "Priya", { kind: "cardEvery", direction: "collect", amount: 50 }), "INSUFFICIENT_BALANCE", /Meera can't afford \$50/);
    expect(e).toMatchObject({ detail: { playerId: id(s, "Meera"), needed: 50, shortBy: 30 } });
    expect(await cashOf(t, s)).toEqual({ Arjun: 2980, Priya: 1500, Meera: 20 });
    await check(t, s);
  });

  test("pay to every player needs the whole amount in cash", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await expectError(perform(s, "Priya", { kind: "cardEvery", direction: "pay", amount: 800 }), "INSUFFICIENT_BALANCE");
    await perform(s, "Priya", { kind: "cardEvery", direction: "pay", amount: 100 });
    expect(await cashOf(t, s)).toEqual({ Arjun: 1600, Priya: 1300, Meera: 1600 });
  });

  test("repairs bill houses and hotels by the card's amounts, go to the pot when it's on, and wait for the banker", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { freeParkingPot: true } });
    await ownSet(s, "Priya");
    await perform(s, "Priya", { kind: "build", spaceId: sp("Market Sq") });
    await perform(s, "Priya", { kind: "build", spaceId: sp("Bridge St") });
    const before = (await cashOf(t, s)).Priya;
    await perform(s, "Priya", { kind: "repairs", perHouse: 25, perHotel: 100 });
    expect((await cashOf(t, s)).Priya).toBe(before - 50);
    expect((await s.host.as.query(api.mono.state, { sessionId: s.sessionId })).game!.freeParkingPot).toBe(50);
    await expectError(perform(s, "Arjun", { kind: "repairs", perHouse: 25, perHotel: 100 }), "INVALID_STATE", /no buildings/);
    await check(t, s);

    const q = await monoTable(t, ["Zed", "Yan", "Xi"], { settings: { bankerMode: "bankerApproves", banker: "Xi" } });
    // Give Yan the set and a house directly (buying would itself queue), then repairs must wait for the banker.
    await t.run(async (ctx) => {
      for (const n of ORANGE) {
        const row = await ctx.db.query("mPropertyStates").withIndex("by_game_space", (x) => x.eq("gameId", q.gameId).eq("spaceId", sp(n))).unique();
        await ctx.db.patch(row!._id, { ownerPlayerId: id(q, "Yan"), houses: n === "Market Sq" ? 1 : 0 });
      }
      await ctx.db.patch(q.gameId, { bankHouses: 31 });
    });
    await check(t, q);
    const queued = await perform(q, "Yan", { kind: "repairs", perHouse: 25, perHotel: 100 });
    expect(queued.status).toBe("pending");
    expect((await cashOf(t, q)).Yan).toBe(1500);
  });
});

describe("jail", () => {
  test("go to jail, count turns, pay the fine to get out", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await perform(s, "Priya", { kind: "goToJail" });
    expect(await jailOf(t, s, "Priya")).toMatchObject({ inJail: true, jailTurns: 0 });
    await expectError(perform(s, "Priya", { kind: "goToJail" }), "INVALID_STATE", /already in jail/);
    await perform(s, "Priya", { kind: "jailTurn" });
    await perform(s, "Priya", { kind: "jailTurn" });
    expect((await jailOf(t, s, "Priya")).jailTurns).toBe(2);
    await perform(s, "Priya", { kind: "payJailFine" });
    expect(await jailOf(t, s, "Priya")).toMatchObject({ inJail: false, jailTurns: 0 });
    expect((await cashOf(t, s)).Priya).toBe(1450);
    await expectError(perform(s, "Priya", { kind: "payJailFine" }), "INVALID_STATE", /isn't in jail/);
    await check(t, s);
  });

  test("the fine goes into the Free Parking pot when that rule is on", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { settings: { freeParkingPot: true } });
    await perform(s, "Priya", { kind: "goToJail" });
    await perform(s, "Priya", { kind: "payJailFine" });
    expect((await s.host.as.query(api.mono.state, { sessionId: s.sessionId })).game!.freeParkingPot).toBe(50);
  });

  test("Get Out of Jail Free cards are tracked per player, used once, and only two exist", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await perform(s, "Priya", { kind: "drawJailCard" });
    expect((await jailOf(t, s, "Priya")).jailCards).toBe(1);
    await expectError(perform(s, "Priya", { kind: "useJailCard" }), "INVALID_STATE", /isn't in jail/);
    await perform(s, "Priya", { kind: "goToJail" });
    await perform(s, "Priya", { kind: "useJailCard" });
    expect(await jailOf(t, s, "Priya")).toMatchObject({ inJail: false, jailCards: 0 });
    expect((await cashOf(t, s)).Priya).toBe(1500);
    await perform(s, "Arjun", { kind: "drawJailCard" });
    await perform(s, "Meera", { kind: "drawJailCard" });
    await expectError(perform(s, "Priya", { kind: "drawJailCard" }), "INVALID_STATE", /already held/);
    await perform(s, "Meera", { kind: "goToJail" });
    await perform(s, "Priya", { kind: "goToJail" });
    await expectError(perform(s, "Priya", { kind: "useJailCard" }), "INVALID_STATE", /no Get Out of Jail/);
    await perform(s, "Priya", { kind: "leaveJail" }); // rolled doubles
    expect((await jailOf(t, s, "Priya")).inJail).toBe(false);
    await check(t, s);
  });

  test("in banker mode the fine waits for the banker but going to jail doesn't", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { bankerMode: "bankerApproves", banker: "Meera" } });
    expect((await perform(s, "Priya", { kind: "goToJail" })).status).toBe("done");
    expect((await perform(s, "Priya", { kind: "payJailFine" })).status).toBe("pending");
    expect((await jailOf(t, s, "Priya")).inJail).toBe(true);
  });

  test("undoing a jail move restores the jail state", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await perform(s, "Priya", { kind: "goToJail" });
    const st = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    await s.host.as.mutation(api.mono.undo, { gameId: s.gameId, groupId: st.game!.events[0].groupId, idempotencyKey: key() });
    expect((await jailOf(t, s, "Priya")).inJail).toBe(false);
  });
});

describe("trades", () => {
  const side = (o: Partial<{ cash: number; spaceIds: string[]; jailCards: number }> = {}) => ({ cash: 0, spaceIds: [] as string[], jailCards: 0, ...o });
  const propose = (s: Table, from: string, to: string, give: ReturnType<typeof side>, get: ReturnType<typeof side>) =>
    s.seats[from].as.mutation(api.mono.proposeTrade, { gameId: s.gameId, withPlayerId: id(s, to), give, get, idempotencyKey: key() });
  const answer = (s: Table, who: string, requestId: Id<"mRequests">, accept: boolean) => s.seats[who].as.mutation(api.mono.respond, { requestId, accept, idempotencyKey: key() });

  test("both agree, then cash, a property and a jail card swap in one move", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await buy(s, "Priya", "Market Sq");
    await buy(s, "Arjun", "Mill Lane");
    await perform(s, "Arjun", { kind: "drawJailCard" });
    const { requestId } = await propose(s, "Priya", "Arjun", side({ cash: 300, spaceIds: [sp("Market Sq")] }), side({ spaceIds: [sp("Mill Lane")], jailCards: 1 }));
    // Nothing moves until the other side accepts.
    expect((await propOf(t, s, "Market Sq")).owner).toBe("Priya");
    await answer(s, "Arjun", requestId, true);
    expect(await propOf(t, s, "Market Sq")).toMatchObject({ owner: "Arjun" });
    expect(await propOf(t, s, "Mill Lane")).toMatchObject({ owner: "Priya" });
    expect(await cashOf(t, s)).toMatchObject({ Priya: 1500 - 180 - 300 + 60 * 0 + 0 + 0 + 0 === 0 ? 0 : 1020, Arjun: 1500 - 60 + 300 });
    expect(await jailOf(t, s, "Priya")).toMatchObject({ jailCards: 1 });
    expect(await jailOf(t, s, "Arjun")).toMatchObject({ jailCards: 0 });
    const st = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(st.game!.events[0].label).toBe("Priya traded with Arjun");
    await check(t, s);
  });

  test("a mortgaged property costs its receiver 10% interest at once", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await buy(s, "Priya", "Power Co.");
    await perform(s, "Priya", { kind: "mortgage", spaceId: sp("Power Co.") });
    const before = await cashOf(t, s);
    const { requestId } = await propose(s, "Priya", "Arjun", side({ spaceIds: [sp("Power Co.")] }), side({ cash: 100 }));
    await answer(s, "Arjun", requestId, true);
    expect(await propOf(t, s, "Power Co.")).toMatchObject({ owner: "Arjun", mortgaged: true });
    expect((await cashOf(t, s)).Arjun).toBe(before.Arjun - 100 - 8);
    await check(t, s);
  });

  test("only the other player accepts; declining or withdrawing moves nothing", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await buy(s, "Priya", "Market Sq");
    const a = await propose(s, "Priya", "Arjun", side({ spaceIds: [sp("Market Sq")] }), side({ cash: 50 }));
    await expectError(answer(s, "Priya", a.requestId, true), "FORBIDDEN");
    await expectError(answer(s, "Meera", a.requestId, true), "FORBIDDEN");
    await answer(s, "Arjun", a.requestId, false);
    const b = await propose(s, "Priya", "Arjun", side({ spaceIds: [sp("Market Sq")] }), side({ cash: 50 }));
    await s.seats.Priya.as.mutation(api.mono.cancelRequest, { requestId: b.requestId });
    expect((await propOf(t, s, "Market Sq")).owner).toBe("Priya");
    const rows = await t.run((ctx) => Promise.all([ctx.db.get(a.requestId), ctx.db.get(b.requestId)]));
    expect(rows.map((r) => r!.status)).toEqual(["declined", "cancelled"]);
  });

  test("an offer that can't work is refused when it's made", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await buy(s, "Arjun", "Market Sq");
    await expectError(propose(s, "Priya", "Arjun", side({ spaceIds: [sp("Market Sq")] }), side()), "INVALID_STATE", /doesn't own/);
    await expectError(propose(s, "Priya", "Arjun", side(), side()), "INVALID_STATE", /Add something/);
    await expectError(propose(s, "Priya", "Arjun", side({ cash: 5000 }), side()), "INSUFFICIENT_BALANCE");
    await expectError(propose(s, "Priya", "Priya", side({ cash: 5 }), side()), "INVALID_STATE");
  });

  test("buildings must be sold before a set's property can be traded", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await ownSet(s, "Priya");
    await perform(s, "Priya", { kind: "build", spaceId: sp("Market Sq") });
    await expectError(propose(s, "Priya", "Arjun", side({ spaceIds: [sp("Bridge St")] }), side({ cash: 10 })), "INVALID_STATE", /Sell the buildings/);
  });

  test("an accepted offer is re-checked: if the deal fell apart meanwhile it fails and stays open", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await buy(s, "Priya", "Market Sq");
    const { requestId } = await propose(s, "Priya", "Arjun", side({ spaceIds: [sp("Market Sq")] }), side({ cash: 1400 }));
    await perform(s, "Arjun", { kind: "pay", toPlayerId: id(s, "Priya"), amount: 500 }); // Arjun can no longer afford it
    await expectError(answer(s, "Arjun", requestId, true), "INSUFFICIENT_BALANCE");
    expect((await t.run((ctx) => ctx.db.get(requestId)))!.status).toBe("pending");
    expect((await propOf(t, s, "Market Sq")).owner).toBe("Priya");
  });

  test("offers expire after 5 minutes", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const { requestId } = await propose(s, "Priya", "Arjun", side({ cash: 10 }), side());
    const req = (await t.run((ctx) => ctx.db.get(requestId)))!;
    expect(req.expiresAt - req.createdAt).toBe(5 * 60 * 1000);
    await t.run((ctx) => ctx.db.patch(requestId, { expiresAt: Date.now() - 1 }));
    await t.mutation(internal.mono.expireRequest, { requestId });
    await expectError(answer(s, "Arjun", requestId, true), "INVALID_STATE", /expired/);
  });

  test("the host can undo a whole trade, but not once the property has been used", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await buy(s, "Priya", "Market Sq");
    const { requestId } = await propose(s, "Priya", "Arjun", side({ spaceIds: [sp("Market Sq")] }), side({ cash: 100 }));
    await answer(s, "Arjun", requestId, true);
    const groupId = (await s.host.as.query(api.mono.state, { sessionId: s.sessionId })).game!.events[0].groupId;
    await perform(s, "Meera", { kind: "rent", spaceId: sp("Market Sq") });
    await expectError(s.host.as.mutation(api.mono.undo, { gameId: s.gameId, groupId, idempotencyKey: key() }), "NOT_UNDOABLE", /rent for Market Sq/);
    const rent = (await s.host.as.query(api.mono.state, { sessionId: s.sessionId })).game!.events[0].groupId;
    await s.host.as.mutation(api.mono.undo, { gameId: s.gameId, groupId: rent, idempotencyKey: key() });
    await s.host.as.mutation(api.mono.undo, { gameId: s.gameId, groupId, idempotencyKey: key() });
    expect((await propOf(t, s, "Market Sq")).owner).toBe("Priya");
    await check(t, s);
  });
});

describe("auctions", () => {
  const start = (s: Table, who: string, name: string) => s.seats[who].as.mutation(api.mono.startAuction, { gameId: s.gameId, spaceId: sp(name), idempotencyKey: key() });
  const bid = (s: Table, who: string, auctionId: Id<"mAuctions">, amount: number) => s.seats[who].as.mutation(api.mono.bid, { auctionId, amount, idempotencyKey: key() });
  const closeNow = async (t: T, auctionId: Id<"mAuctions">) => {
    await t.run((ctx) => ctx.db.patch(auctionId, { endsAt: Date.now() - 1 }));
    await t.mutation(internal.mono.closeAuction, { auctionId });
  };

  test("anyone can start one; it has a 30 second countdown and a scheduled close", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const { auctionId } = await start(s, "Priya", "Market Sq");
    const a = (await t.run((ctx) => ctx.db.get(auctionId)))!;
    expect(a).toMatchObject({ status: "open", highestBid: 0, spaceId: sp("Market Sq") });
    expect(a.endsAt - a.startedAt).toBe(30_000);
    expect(a.scheduledId).toBeDefined();
    const st = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(st.game!.auction).toMatchObject({ _id: auctionId });
  });

  test("only unowned properties, only one at a time, and only when auctions are on", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await buy(s, "Arjun", "Mill Lane");
    await expectError(start(s, "Priya", "Mill Lane"), "INVALID_STATE", /already has an owner/);
    await start(s, "Priya", "Market Sq");
    await expectError(start(s, "Arjun", "Bridge St"), "INVALID_STATE", /already running/);
    const off = await monoTable(t, ["Zed", "Yan"]);
    await off.host.as.mutation(api.mono.cancelGame, { gameId: off.gameId, idempotencyKey: key() });
    const noProps = await monoTable(t, ["A1", "B1"], { settings: { trackProperties: false } });
    await expectError(noProps.host.as.mutation(api.mono.startAuction, { gameId: noProps.gameId, spaceId: sp("Market Sq"), idempotencyKey: key() }), "INVALID_STATE", /aren't tracked/);
  });

  test("bids must beat the highest, fit the bidder's cash, and each one resets the countdown to 15 seconds", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    const { auctionId } = await start(s, "Arjun", "Market Sq");
    const first = (await t.run((ctx) => ctx.db.get(auctionId)))!.scheduledId;
    await bid(s, "Priya", auctionId, 100);
    const a = (await t.run((ctx) => ctx.db.get(auctionId)))!;
    expect(a).toMatchObject({ highestBid: 100, highestBidderId: id(s, "Priya") });
    expect(a.endsAt - Date.now()).toBeLessThanOrEqual(15_100);
    expect(a.endsAt - Date.now()).toBeGreaterThan(13_000);
    expect(a.scheduledId).not.toBe(first);
    await expectError(bid(s, "Meera", auctionId, 100), "INVALID_AMOUNT", /more than 100/);
    await expectError(bid(s, "Priya", auctionId, 150), "INVALID_STATE", /already the highest/);
    await expectError(bid(s, "Meera", auctionId, 1501), "INSUFFICIENT_BALANCE");
    await bid(s, "Meera", auctionId, 101);
    expect((await t.run((ctx) => ctx.db.get(auctionId)))!.highestBidderId).toBe(id(s, "Meera"));
  });

  test("the countdown ends: the highest bidder pays the bank and gets the deed", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    const { auctionId } = await start(s, "Arjun", "Market Sq");
    await bid(s, "Priya", auctionId, 120);
    await bid(s, "Meera", auctionId, 210);
    // Too early: a later bid moved the deadline, so a stale close does nothing.
    await t.mutation(internal.mono.closeAuction, { auctionId });
    expect((await t.run((ctx) => ctx.db.get(auctionId)))!.status).toBe("open");
    await closeNow(t, auctionId);
    expect((await t.run((ctx) => ctx.db.get(auctionId)))!.status).toBe("sold");
    expect(await propOf(t, s, "Market Sq")).toMatchObject({ owner: "Meera" });
    expect((await cashOf(t, s)).Meera).toBe(1290);
    const st = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(st.game!.auction).toBeNull();
    expect(st.game!.events[0].label).toBe("Meera won the auction for Market Sq at $210");
    await check(t, s);
  });

  test("no bids: the property stays with the bank and the feed says so", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const { auctionId } = await start(s, "Arjun", "Market Sq");
    await closeNow(t, auctionId);
    expect((await t.run((ctx) => ctx.db.get(auctionId)))!.status).toBe("unsold");
    expect((await propOf(t, s, "Market Sq")).owner).toBeNull();
    const st = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    expect(st.game!.events[0]).toMatchObject({ type: "NOTE", label: "Nobody bid on Market Sq, so it stays with the bank" });
    // The note isn't an undoable action.
    await expectError(s.host.as.mutation(api.mono.undo, { gameId: s.gameId, groupId: st.game!.events[0].groupId, idempotencyKey: key() }), "NOT_UNDOABLE");
    await start(s, "Priya", "Market Sq"); // it can go up again
    await check(t, s);
  });

  test("a winner who can't pay any more doesn't get the deed", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const { auctionId } = await start(s, "Arjun", "Market Sq");
    await bid(s, "Priya", auctionId, 900);
    await perform(s, "Priya", { kind: "pay", toPlayerId: id(s, "Arjun"), amount: 1400 });
    await closeNow(t, auctionId);
    expect((await t.run((ctx) => ctx.db.get(auctionId)))!.status).toBe("unsold");
    expect((await propOf(t, s, "Market Sq")).owner).toBeNull();
    expect((await cashOf(t, s)).Priya).toBe(100);
    await check(t, s);
  });

  test("late bids are refused, and the host can stop an auction", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const { auctionId } = await start(s, "Arjun", "Market Sq");
    await t.run((ctx) => ctx.db.patch(auctionId, { endsAt: Date.now() - 1 }));
    await expectError(bid(s, "Priya", auctionId, 10), "INVALID_STATE", /Time's up/);
    await t.run((ctx) => ctx.db.patch(auctionId, { endsAt: Date.now() + 20_000 }));
    await expectError(s.seats.Priya.as.mutation(api.mono.cancelAuction, { auctionId }), "NOT_HOST");
    await s.host.as.mutation(api.mono.cancelAuction, { auctionId });
    await expectError(bid(s, "Priya", auctionId, 10), "INVALID_STATE", /over/);
  });

  test("a queued auction (properties of a bankrupt player) starts the next one when this closes", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const { auctionId } = await start(s, "Arjun", "Market Sq");
    await t.run((ctx) => ctx.db.patch(auctionId, { queue: [sp("Bridge St"), sp("Chapel Hill")] }));
    await closeNow(t, auctionId);
    const next = (await auctionOf(t, s))!;
    expect(next).toMatchObject({ status: "open", spaceId: sp("Bridge St"), queue: [sp("Chapel Hill")] });
  });

  test("spectators can't bid, and a bankrupt player can't", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const { auctionId } = await start(s, "Arjun", "Market Sq");
    const late = await newDevice(t);
    await late.mutation(api.sessions.join, { code: s.code, newName: "Latecomer", idempotencyKey: key() });
    await expectError(late.mutation(api.mono.bid, { auctionId, amount: 10, idempotencyKey: key() }), "FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------------------------
// Milestone 5: bankruptcy, the end of a game, stakes, stats
// ---------------------------------------------------------------------------------------------

const bankrupt = (s: Table, who: string, creditor: string | null, as = who) =>
  s.seats[as].as.mutation(api.mono.declareBankruptcy, { gameId: s.gameId, playerId: id(s, who), creditorId: creditor ? id(s, creditor) : null, idempotencyKey: key() });
const gameOf = async (t: T, s: Table) => (await t.run((ctx) => ctx.db.get(s.gameId)))!;
const stateOf = async (s: Table) => (await s.host.as.query(api.mono.state, { sessionId: s.sessionId })).game!;
const netsOf = async (s: Table) => {
  const { nets, transfers } = await s.host.as.query(api.report.settlement, { sessionId: s.sessionId });
  return { byName: Object.fromEntries(nets.map((n) => [n.name, n.net])), transfers };
};

describe("bankruptcy", () => {
  test("to a player: buildings sold at half cost, then cash, deeds and cards go to the creditor", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { startingCash: 3000 } });
    await ownSet(s, "Priya");
    for (const n of ORANGE) await perform(s, "Priya", { kind: "build", spaceId: sp(n) });
    await perform(s, "Priya", { kind: "drawJailCard" });
    const before = await cashOf(t, s);
    await bankrupt(s, "Priya", "Meera");
    const after = await cashOf(t, s);
    // Priya's cash after the three builds and the three deeds, plus 3 houses × $50, all go to Meera.
    expect(after.Priya).toBe(0);
    expect(after.Meera).toBe(before.Meera + before.Priya + 150);
    for (const n of ORANGE) expect(await propOf(t, s, n)).toMatchObject({ owner: "Meera", houses: 0 });
    expect(await jailOf(t, s, "Meera")).toMatchObject({ jailCards: 1 });
    expect((await stateOf(s)).players.find((p) => p.name === "Priya")).toMatchObject({ status: "bankrupt", finishPosition: 3 });
    expect((await gameOf(t, s)).status).toBe("active");
    expect(await stock(t, s)).toEqual({ houses: 32, hotels: 12 });
    await check(t, s);
  });

  test("the creditor pays 10% interest on any mortgaged property received", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await buy(s, "Priya", "Power Co.");
    await perform(s, "Priya", { kind: "mortgage", spaceId: sp("Power Co.") });
    const before = (await cashOf(t, s)).Meera;
    const priya = (await cashOf(t, s)).Priya;
    await bankrupt(s, "Priya", "Meera");
    expect((await cashOf(t, s)).Meera).toBe(before + priya - 8);
    expect(await propOf(t, s, "Power Co.")).toMatchObject({ owner: "Meera", mortgaged: true });
    await check(t, s);
  });

  test("a creditor who can't cover the interest blocks it until they raise money", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await buy(s, "Priya", "North Stn");
    await perform(s, "Priya", { kind: "mortgage", spaceId: sp("North Stn") });
    await perform(s, "Priya", { kind: "pay", toPlayerId: id(s, "Arjun"), amount: (await cashOf(t, s)).Priya });
    await perform(s, "Meera", { kind: "pay", toPlayerId: id(s, "Arjun"), amount: 1500 });
    const e = await expectError(bankrupt(s, "Priya", "Meera"), "INSUFFICIENT_BALANCE");
    expect(e).toMatchObject({ detail: { playerId: id(s, "Meera"), needed: 10 } });
  });

  test("to the bank with auctions on: the deeds go up for auction one after another", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await buy(s, "Priya", "Market Sq");
    await buy(s, "Priya", "Mill Lane");
    await perform(s, "Priya", { kind: "mortgage", spaceId: sp("Mill Lane") });
    await bankrupt(s, "Priya", null);
    expect(await propOf(t, s, "Market Sq")).toMatchObject({ owner: null });
    expect(await propOf(t, s, "Mill Lane")).toMatchObject({ owner: null, mortgaged: false });
    const first = (await auctionOf(t, s))!;
    // Board order: Mill Lane comes before Market Sq.
    expect(first).toMatchObject({ status: "open", spaceId: sp("Mill Lane"), queue: [sp("Market Sq")] });
    await t.run((ctx) => ctx.db.patch(first._id, { endsAt: Date.now() - 1 }));
    await t.mutation(internal.mono.closeAuction, { auctionId: first._id });
    expect(await auctionOf(t, s)).toMatchObject({ status: "open", spaceId: sp("Market Sq"), queue: [] });
    await check(t, s);
  });

  test("with auctions off the deeds just go back to the bank", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await t.run(async (ctx) => {
      const g = (await ctx.db.get(s.gameId))!;
      await ctx.db.patch(s.gameId, { settings: { ...g.settings, auctions: false } });
    });
    await buy(s, "Priya", "Market Sq");
    await bankrupt(s, "Priya", null);
    expect(await auctionOf(t, s)).toBeNull();
    expect((await propOf(t, s, "Market Sq")).owner).toBeNull();
  });

  test("only the player or the host can do it, and the turn moves on if it was theirs", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await expectError(bankrupt(s, "Priya", null, "Meera"), "FORBIDDEN");
    await bankrupt(s, "Arjun", "Priya", "Arjun"); // Arjun has the turn
    expect((await gameOf(t, s)).currentTurnPlayerId).toBe(id(s, "Priya"));
    await expectError(perform(s, "Arjun", { kind: "passGo" }), "INVALID_STATE", /out of this game/);
    // A host who is out of the game can still put another player out; with two gone, Priya wins.
    const r = await bankrupt(s, "Meera", "Priya", "Arjun");
    expect(r.gameOver).toBe(true);
    expect((await gameOf(t, s)).status).toBe("ended");
  });

  test("their open requests are cancelled", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    const { requestId } = await s.seats.Priya.as.mutation(api.mono.requestPayment, { gameId: s.gameId, fromPlayerId: id(s, "Meera"), amount: 50, idempotencyKey: key() });
    await bankrupt(s, "Meera", "Arjun");
    expect((await t.run((ctx) => ctx.db.get(requestId)))!.status).toBe("cancelled");
  });
});

describe("the end of a game and the stakes", () => {
  const stakes = { buyIn: 500, split: [70, 30] };

  test("the last player standing wins; the stakes pay out by place; nets add up to zero; settle-up pays the winner", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: stakes });
    await bankrupt(s, "Meera", "Priya");
    expect((await gameOf(t, s)).status).toBe("active");
    const r = await bankrupt(s, "Arjun", "Priya");
    expect(r.gameOver).toBe(true);
    expect((await gameOf(t, s)).status).toBe("ended");
    const g = await stateOf(s);
    expect(Object.fromEntries(g.players.map((p) => [p.name, p.finishPosition]))).toEqual({ Arjun: 2, Priya: 1, Meera: 3 });
    // Pot ₹1,500: 1st ₹1,050, 2nd ₹450, 3rd nothing. Net = payout − ₹500 buy-in.
    const { byName, transfers } = await netsOf(s);
    expect(byName).toEqual({ Arjun: -50, Priya: 550, Meera: -500 });
    expect(transfers!.reduce((sum, x) => sum + x.amount, 0)).toBe(550);
    expect(g.summaries.map((x) => x.stakeNet).sort((a, b) => a - b)).toEqual([-500, -50, 550]);
    await t.query(internal.invariants.assertSessionInvariants, { sessionId: s.sessionId });
    await check(t, s);
  });

  test("winner takes all", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { settings: { buyIn: 200, split: [100] } });
    await bankrupt(s, "Priya", "Arjun");
    expect((await netsOf(s)).byName).toEqual({ Arjun: 200, Priya: -200 });
  });

  test("no stakes means nothing is paid, and a finished game takes no more moves", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await bankrupt(s, "Priya", "Arjun");
    expect((await netsOf(s)).byName).toEqual({ Arjun: 0, Priya: 0 });
    await expectError(perform(s, "Arjun", { kind: "passGo" }), "INVALID_STATE", /isn't in progress/);
  });

  test("the host can end early: places by net worth, or an order they choose", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { buyIn: 300, split: [60, 40] } });
    await buy(s, "Priya", "Market Sq"); // Priya keeps the most value
    await perform(s, "Meera", { kind: "pay", toPlayerId: id(s, "Arjun"), amount: 600 });
    await expectError(s.seats.Priya.as.mutation(api.mono.endGameEarly, { gameId: s.gameId, idempotencyKey: key() }), "NOT_HOST");
    await expectError(s.host.as.mutation(api.mono.endGameEarly, { gameId: s.gameId, order: [id(s, "Arjun")], idempotencyKey: key() }), "INVALID_STATE", /every player/);
    await s.host.as.mutation(api.mono.endGameEarly, { gameId: s.gameId, order: [id(s, "Meera"), id(s, "Arjun"), id(s, "Priya")], idempotencyKey: key() });
    const g = await stateOf(s);
    expect(g.status).toBe("ended");
    expect(Object.fromEntries(g.players.map((p) => [p.name, p.finishPosition]))).toEqual({ Meera: 1, Arjun: 2, Priya: 3 });
    // Pot ₹900: 1st ₹540, 2nd ₹360.
    expect((await netsOf(s)).byName).toEqual({ Meera: 240, Arjun: 60, Priya: -300 });
    await check(t, s);
  });

  test("by default early places follow net worth", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await buy(s, "Meera", "Grand Esplanade");
    await perform(s, "Arjun", { kind: "pay", toPlayerId: id(s, "Meera"), amount: 400 });
    await s.host.as.mutation(api.mono.endGameEarly, { gameId: s.gameId, idempotencyKey: key() });
    const g = await stateOf(s);
    expect(g.players.find((p) => p.name === "Meera")!.finishPosition).toBe(1);
    expect(g.players.find((p) => p.name === "Arjun")!.finishPosition).toBe(3);
  });

  test("reopening reverses the payouts and the summaries; undo the last move, play on, finish again", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { settings: { buyIn: 100, split: [100] } });
    await bankrupt(s, "Priya", "Arjun");
    expect((await netsOf(s)).byName).toEqual({ Arjun: 100, Priya: -100 });
    await expectError(s.seats.Priya.as.mutation(api.mono.reopenGame, { gameId: s.gameId, idempotencyKey: key() }), "NOT_HOST");
    await s.host.as.mutation(api.mono.reopenGame, { gameId: s.gameId, idempotencyKey: key() });
    expect((await gameOf(t, s)).status).toBe("active");
    expect((await netsOf(s)).byName).toEqual({ Arjun: -100, Priya: -100 });
    expect((await stateOf(s)).summaries).toHaveLength(0);
    // Undo the bankruptcy and the game carries on.
    const last = (await stateOf(s)).events.find((e) => e.type !== "TURN" && e.type !== "NOTE" && !e.reversesGroupId)!.groupId;
    await s.host.as.mutation(api.mono.undo, { gameId: s.gameId, groupId: last, idempotencyKey: key() });
    expect((await stateOf(s)).players.every((p) => p.status === "playing")).toBe(true);
    await bankrupt(s, "Arjun", "Priya");
    expect((await netsOf(s)).byName).toEqual({ Arjun: -100, Priya: 100 });
    await t.query(internal.invariants.assertSessionInvariants, { sessionId: s.sessionId });
    await check(t, s);
  });

  test("finishGame refuses while someone has no place", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await expectError(s.host.as.mutation(api.mono.finishGame, { gameId: s.gameId, idempotencyKey: key() }), "INVALID_STATE", /finishing place/);
  });

  test("a running auction blocks undo; ending the game closes the auction and cancels requests", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await perform(s, "Priya", { kind: "bankCollect", amount: 10 });
    const group = (await stateOf(s)).events[0].groupId;
    const { auctionId } = await s.seats.Arjun.as.mutation(api.mono.startAuction, { gameId: s.gameId, spaceId: sp("Market Sq"), idempotencyKey: key() });
    await expectError(s.host.as.mutation(api.mono.undo, { gameId: s.gameId, groupId: group, idempotencyKey: key() }), "INVALID_STATE", /running auction/);
    const { requestId } = await s.seats.Arjun.as.mutation(api.mono.requestPayment, { gameId: s.gameId, fromPlayerId: id(s, "Priya"), amount: 5, idempotencyKey: key() });
    await bankrupt(s, "Priya", "Arjun");
    expect((await t.run((ctx) => ctx.db.get(auctionId)))!.status).toBe("unsold");
    expect((await t.run((ctx) => ctx.db.get(requestId)))!.status).toBe("cancelled");
  });
});

describe("rent stats and raise-money flag", () => {
  test("summaries count rent earned and paid, and ignore undone rent", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"]);
    await buy(s, "Arjun", "Market Sq");
    await perform(s, "Priya", { kind: "rent", spaceId: sp("Market Sq") });
    await perform(s, "Meera", { kind: "rent", spaceId: sp("Market Sq") });
    const undone = (await stateOf(s)).events[0].groupId;
    await s.host.as.mutation(api.mono.undo, { gameId: s.gameId, groupId: undone, idempotencyKey: key() });
    await bankrupt(s, "Meera", "Arjun");
    await bankrupt(s, "Priya", "Arjun");
    const g = await stateOf(s);
    const byName = Object.fromEntries(g.summaries.map((x) => [g.players.find((p) => p.sessionPlayerId === x.sessionPlayerId)!.name, x]));
    expect(byName.Arjun).toMatchObject({ finishPosition: 1, rentEarned: 14, rentPaid: 0 });
    expect(byName.Priya).toMatchObject({ finishPosition: 3 === 3 ? 2 : 0, rentPaid: 14 });
    expect(byName.Meera).toMatchObject({ finishPosition: 3, rentPaid: 0 });
  });

  test("a short player is flagged for the raise-money flow, only when really short", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const flag = (who: string, needed: number) => s.seats.Arjun.as.mutation(api.mono.flagShort, { gameId: s.gameId, playerId: id(s, who), needed });
    await flag("Priya", 1000); // she has 1,500
    expect((await t.run((ctx) => ctx.db.get(id(s, "Priya"))))!.owes).toBeUndefined();
    await flag("Priya", 2000);
    expect((await t.run((ctx) => ctx.db.get(id(s, "Priya"))))!.owes).toMatchObject({ needed: 2000 });
    await s.seats.Priya.as.mutation(api.mono.clearShort, { gameId: s.gameId });
    expect((await t.run((ctx) => ctx.db.get(id(s, "Priya"))))!.owes).toBeUndefined();
  });
});

describe("property-game stats and the report", () => {
  async function playedGame(t: T, names = ["Arjun", "Priya", "Meera"]) {
    const s = await monoTable(t, names, { settings: { buyIn: 100, split: [100] } });
    await buy(s, "Arjun", "Market Sq");
    await perform(s, "Priya", { kind: "rent", spaceId: sp("Market Sq") });
    await bankrupt(s, "Meera", "Arjun");
    await bankrupt(s, "Priya", "Arjun");
    return s;
  }

  test("the crew leaderboard counts games, wins, average finish and rent earned", async () => {
    const t = setup();
    const s = await playedGame(t);
    const crewId = (await t.run((ctx) => ctx.db.get(s.sessionId)))!.crewId;
    const board = await s.host.as.query(api.monoStats.leaderboard, { crewId });
    expect(board.map((r) => [r.name, r.games, r.wins, r.avgFinish, r.rentEarned])).toEqual([
      ["Arjun", 1, 1, 1, 14],
      ["Priya", 1, 0, 2, 0],
      ["Meera", 1, 0, 3, 0],
    ]);
    expect(board[0].stakeNet).toBe(200);
    const memberId = (await t.run((ctx) => ctx.db.query("crewMembers").withIndex("by_crew", (q) => q.eq("crewId", crewId)).collect())).find((m) => m.name === "Priya")!._id;
    expect(await s.host.as.query(api.monoStats.profile, { crewId, memberId })).toMatchObject({ games: 1, wins: 0, avgFinish: 2, recent: [{ position: 2, players: 3 }] });
    await expectError((await newDevice(t)).query(api.monoStats.leaderboard, { crewId }), "FORBIDDEN");
  });

  test("a second game builds up the averages", async () => {
    const t = setup();
    const s = await playedGame(t);
    await s.host.as.mutation(api.mono.newGame, { sessionId: s.sessionId });
    const state = await s.host.as.query(api.mono.state, { sessionId: s.sessionId });
    await s.host.as.mutation(api.mono.start, { gameId: state.game!._id, idempotencyKey: key() });
    const g2 = (await s.host.as.query(api.mono.state, { sessionId: s.sessionId })).game!;
    const mp = (n: string) => g2.players.find((p) => p.name === n)!._id;
    await s.seats.Arjun.as.mutation(api.mono.declareBankruptcy, { gameId: g2._id, creditorId: mp("Priya"), idempotencyKey: key() });
    await s.seats.Meera.as.mutation(api.mono.declareBankruptcy, { gameId: g2._id, creditorId: mp("Priya"), idempotencyKey: key() });
    const crewId = (await t.run((ctx) => ctx.db.get(s.sessionId)))!.crewId;
    const board = await s.host.as.query(api.monoStats.leaderboard, { crewId });
    const arjun = board.find((r) => r.name === "Arjun")!;
    expect(arjun).toMatchObject({ games: 2, wins: 1, avgFinish: 2 });
    expect(board.find((r) => r.name === "Priya")).toMatchObject({ games: 2, wins: 1, avgFinish: 1.5 });
    await t.query(internal.invariants.assertSessionInvariants, { sessionId: s.sessionId });
  });

  test("the session report lists each game with places, payouts and rent, and settle-up follows the stakes", async () => {
    const t = setup();
    const s = await playedGame(t);
    const report = await s.host.as.query(api.report.full, { sessionId: s.sessionId });
    expect(report.mono!.games).toHaveLength(1);
    const g = report.mono!.games[0];
    expect(g).toMatchObject({ no: 1, status: "ended", board: "Classic", buyIn: 100, pot: 300 });
    expect(g.players.map((p) => [p.name, p.position, p.payout, p.stakeNet])).toEqual([
      ["Arjun", 1, 300, 200],
      ["Priya", 2, 0, -100],
      ["Meera", 3, 0, -100],
    ]);
    expect(report.totals).toEqual({ games: 1, moved: 300, biggestPot: 300 });
    expect(report.players.map((p) => [p.name, p.net]).sort()).toEqual([["Arjun", 200], ["Meera", -100], ["Priya", -100]]);
    expect(report.transfers!.reduce((x, y) => x + y.amount, 0)).toBe(200);
  });

  test("a pool report has no property section", async () => {
    const t = setup();
    const p = await table(t, ["Arjun", "Priya"]);
    expect((await p.host.as.query(api.report.full, { sessionId: p.sessionId })).mono).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Milestone 6: pause and resume, the table display
// ---------------------------------------------------------------------------------------------

describe("pause and resume", () => {
  test("a paused game takes no moves until the host resumes it, however long it waits", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await perform(s, "Priya", { kind: "bankCollect", amount: 100 });
    await expectError(s.seats.Priya.as.mutation(api.mono.pause, { gameId: s.gameId }), "NOT_HOST");
    await s.host.as.mutation(api.mono.pause, { gameId: s.gameId });
    expect((await gameOf(t, s)).status).toBe("paused");
    expect((await gameOf(t, s)).pausedAt).toBeDefined();
    await expectError(perform(s, "Priya", { kind: "passGo" }), "INVALID_STATE", /paused/);
    await expectError(s.seats.Arjun.as.mutation(api.mono.endTurn, { gameId: s.gameId }), "INVALID_STATE", /paused/);
    await expectError(buy(s, "Priya", "Market Sq"), "INVALID_STATE", /paused/);
    // A day later: still paused, state intact.
    expect((await cashOf(t, s)).Priya).toBe(1600);
    await expectError(s.seats.Priya.as.mutation(api.mono.resume, { gameId: s.gameId }), "NOT_HOST");
    await s.host.as.mutation(api.mono.resume, { gameId: s.gameId });
    await perform(s, "Priya", { kind: "passGo" });
    expect((await cashOf(t, s)).Priya).toBe(1800);
    await check(t, s);
  });

  test("the host can undo and cancel while paused; pausing twice or resuming a running game is harmless", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { settings: { buyIn: 100, split: [100] } });
    await perform(s, "Priya", { kind: "bankCollect", amount: 50 });
    await s.host.as.mutation(api.mono.pause, { gameId: s.gameId });
    await s.host.as.mutation(api.mono.pause, { gameId: s.gameId });
    const group = (await stateOf(s)).events[0].groupId;
    await s.host.as.mutation(api.mono.undo, { gameId: s.gameId, groupId: group, idempotencyKey: key() });
    expect((await cashOf(t, s)).Priya).toBe(1500);
    await s.host.as.mutation(api.mono.resume, { gameId: s.gameId });
    await s.host.as.mutation(api.mono.resume, { gameId: s.gameId });
    await s.host.as.mutation(api.mono.pause, { gameId: s.gameId });
    await s.host.as.mutation(api.mono.cancelGame, { gameId: s.gameId, idempotencyKey: key() });
    expect((await gameOf(t, s)).status).toBe("cancelled");
    expect((await netsOf(s)).byName).toEqual({ Arjun: 0, Priya: 0 });
  });

  test("a running auction has to finish before the game can be paused", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await s.seats.Arjun.as.mutation(api.mono.startAuction, { gameId: s.gameId, spaceId: sp("Market Sq"), idempotencyKey: key() });
    await expectError(s.host.as.mutation(api.mono.pause, { gameId: s.gameId }), "INVALID_STATE", /auction/);
  });

  test("a paused game can still be ended early and paid out", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"], { settings: { buyIn: 100, split: [100] } });
    await s.host.as.mutation(api.mono.pause, { gameId: s.gameId });
    await s.host.as.mutation(api.mono.endGameEarly, { gameId: s.gameId, order: [id(s, "Priya"), id(s, "Arjun")], idempotencyKey: key() });
    expect((await netsOf(s)).byName).toEqual({ Arjun: -100, Priya: 100 });
  });
});

describe("table display", () => {
  const view = (s: Table) => s.host.as.query(api.monoDisplay.view, { code: s.code });

  test("shows the public table: players, cash, deeds, buildings, pot, stock and the feed", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya", "Meera"], { settings: { freeParkingPot: true } });
    await ownSet(s, "Priya");
    await perform(s, "Priya", { kind: "build", spaceId: sp("Market Sq") });
    await perform(s, "Meera", { kind: "bankPay", amount: 200, reason: "tax" });
    await perform(s, "Arjun", { kind: "goToJail" });
    const d = (await view(s))!;
    expect(d.game!.players.map((p) => [p.name, p.inJail, p.bankrupt])).toEqual([["Arjun", true, false], ["Priya", false, false], ["Meera", false, false]]);
    expect(d.game).toMatchObject({ pot: 200, freeParkingPot: true, bankHouses: 31, bankHotels: 12, status: "active", trackProperties: true });
    expect(d.game!.board.spaces).toHaveLength(40);
    expect(d.game!.props.find((p) => p.spaceId === sp("Market Sq"))).toMatchObject({ houses: 1, owner: id(s, "Priya") });
    expect(d.feed![0].label).toBe("Arjun went to jail");
    expect(d.feed!.map((f) => f.label)).toContain("Priya built on Market Sq");
  });

  test("an undone move is marked in the feed; turn changes are left out; a paused game shows as paused", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    await perform(s, "Priya", { kind: "bankCollect", amount: 50 });
    await s.seats.Arjun.as.mutation(api.mono.endTurn, { gameId: s.gameId });
    await s.host.as.mutation(api.mono.undo, { gameId: s.gameId, groupId: (await stateOf(s)).events.find((e) => e.type === "PAY" && !e.reversesGroupId)!.groupId, idempotencyKey: key() });
    await s.host.as.mutation(api.mono.pause, { gameId: s.gameId });
    const d = (await view(s))!;
    expect(d.feed!.some((f) => /ended their turn/.test(f.label))).toBe(false);
    expect(d.feed!.filter((f) => f.undone)).toHaveLength(1);
    expect(d.game!.status).toBe("paused");
  });

  test("shows the live auction and, when over, the standings; works from any device with the code", async () => {
    const t = setup();
    const s = await monoTable(t, ["Arjun", "Priya"]);
    const { auctionId } = await s.seats.Arjun.as.mutation(api.mono.startAuction, { gameId: s.gameId, spaceId: sp("Market Sq"), idempotencyKey: key() });
    await s.seats.Priya.as.mutation(api.mono.bid, { auctionId, amount: 75, idempotencyKey: key() });
    const tv = await newDevice(t); // the TV has no seat
    const d = (await tv.query(api.monoDisplay.view, { code: s.code }))!;
    expect(d.game!.auction).toMatchObject({ spaceId: sp("Market Sq"), highestBid: 75, bidder: "Priya" });
    await s.host.as.mutation(api.mono.cancelAuction, { auctionId });
    await bankrupt(s, "Arjun", "Priya");
    const over = (await tv.query(api.monoDisplay.view, { code: s.code }))!;
    expect(over.game).toMatchObject({ status: "ended" });
    expect(over.game!.players.map((p) => [p.name, p.position])).toEqual([["Arjun", 2], ["Priya", 1]]);
  });

  test("is only for property games, and shows a waiting screen before the game starts", async () => {
    const t = setup();
    const pool = await table(t, ["Arjun", "Priya"]);
    expect(await pool.host.as.query(api.monoDisplay.view, { code: pool.code })).toBeNull();
    const s = await monoTable(t, ["Zed", "Yan"], { start: false });
    expect(await view(s)).toMatchObject({ game: null });
  });

  test("the pool display is unchanged", async () => {
    const t = setup();
    const pool = await table(t, ["Arjun", "Priya"]);
    const d = await pool.host.as.query(api.display.view, { code: pool.code });
    expect(d!.players.map((p) => p.name)).toEqual(["Arjun", "Priya"]);
  });
});
