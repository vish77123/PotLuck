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
