import { describe, expect, test } from "vitest";
import {
  applyEvents,
  checkUndo,
  createGame,
  gameIsOver,
  gameViolations,
  invertEvents,
  planBankCollect,
  planBankruptcy,
  planBuild,
  planBuy,
  planCardEveryPlayer,
  planCollectPot,
  planDrawJailCard,
  planEndGame,
  planGoToJail,
  planJailTurn,
  planLeaveJail,
  planMortgage,
  planPassGo,
  planPayBank,
  planPayJailFine,
  planPlayerPay,
  planRent,
  planRepairs,
  planSellBuilding,
  planTrade,
  planUnmortgage,
  planUseJailCard,
  type GroupRecord,
  type Plan,
} from "./engine";
import { BUSINESS, CLASSIC } from "./presets";
import { ownableSpaces } from "./rules";
import { BANK, DEFAULT_SETTINGS, RuleError, type GameState, type MEvent, type Settings } from "./types";

// Deterministic RNG so a failure can be replayed from its seed.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T,>(rng: Rng, xs: T[]): T => xs[Math.floor(rng() * xs.length)];
const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

/** Draws one random action against the current state. May throw a RuleError, which the runner counts as a refusal. */
function randomAction(rng: Rng, s: GameState): { label: string; plan: Plan } {
  const playing = Object.values(s.players).filter((p) => p.status === "playing");
  const a = pick(rng, playing).id;
  const others = playing.filter((p) => p.id !== a);
  const b = others.length ? pick(rng, others).id : a;
  const spaces = ownableSpaces(s.board);
  const space = () => pick(rng, spaces);
  const tracked = s.settings.trackProperties;
  const kinds = ["go", "bankIn", "bankOut", "pay", "pay", "pay", "jail", "pot", "card", "end"];
  if (tracked) kinds.push("buy", "buy", "buy", "buySet", "buySet", "rent", "rent", "build", "build", "build", "build", "sell", "mortgage", "unmortgage", "trade", "trade", "repairs", "bankrupt");
  else kinds.push("bankrupt");
  const kind = pick(rng, kinds);
  switch (kind) {
    case "buySet": {
      // One group of several purchases: everything unowned in a random colour set, so building becomes possible.
      const group = pick(rng, ["brown", "lblue", "pink", "orange", "red", "yellow", "green", "dblue"] as const);
      const events: MEvent[] = [];
      let cur = s;
      for (const sp of spaces.filter((x) => x.group === group && s.props[x.id].owner === null)) {
        const p = planBuy(cur, a, sp.id);
        events.push(...p.events);
        cur = p.after;
      }
      if (events.length === 0) throw new RuleError("INVALID_ACTION", "set already owned");
      return { label: "buy a set", plan: { events, after: cur } };
    }
    case "go":
      return { label: "pass go", plan: planPassGo(s, a, { landedExactly: rng() < 0.3 }) };
    case "bankIn":
      return { label: "bank pays", plan: planBankCollect(s, a, rng() < 0.2 ? int(rng, 500, 2500) : int(rng, 1, 300)) };
    case "bankOut":
      return { label: "pays bank", plan: planPayBank(s, a, int(rng, 1, 400), pick(rng, ["tax", "card", "bank"] as const)) };
    case "pay":
      return { label: "pays player", plan: planPlayerPay(s, a, b, int(rng, 1, 600)) };
    case "jail": {
      const p = s.players[a];
      const op = p.inJail ? pick(rng, ["turn", "fine", "card", "leave"]) : pick(rng, ["go", "draw"]);
      if (op === "turn") return { label: "jail turn", plan: planJailTurn(s, a) };
      if (op === "fine") return { label: "jail fine", plan: planPayJailFine(s, a) };
      if (op === "card") return { label: "jail card", plan: planUseJailCard(s, a) };
      if (op === "leave") return { label: "leave jail", plan: planLeaveJail(s, a) };
      if (op === "draw") return { label: "draw jail card", plan: planDrawJailCard(s, a) };
      return { label: "go to jail", plan: planGoToJail(s, a) };
    }
    case "pot":
      return { label: "collect pot", plan: planCollectPot(s, a) };
    case "card":
      return { label: "card to everyone", plan: planCardEveryPlayer(s, a, int(rng, 1, 120), rng() < 0.5 ? "collect" : "pay") };
    case "buy":
      return { label: "buy", plan: planBuy(s, a, space().id) };
    case "rent":
      return { label: "rent", plan: planRent(s, a, space().id, { diceTotal: int(rng, 2, 12) }) };
    case "build":
      return { label: "build", plan: planBuild(s, a, space().id) };
    case "sell":
      return { label: "sell", plan: planSellBuilding(s, a, space().id) };
    case "mortgage":
      return { label: "mortgage", plan: planMortgage(s, a, space().id) };
    case "unmortgage":
      return { label: "unmortgage", plan: planUnmortgage(s, a, space().id) };
    case "trade": {
      const mine = spaces.filter((x) => s.props[x.id].owner === a).map((x) => x.id);
      const theirs = spaces.filter((x) => s.props[x.id].owner === b).map((x) => x.id);
      const some = (xs: string[]) => xs.filter(() => rng() < 0.35).slice(0, 3);
      return {
        label: "trade",
        plan: planTrade(s, {
          a: { player: a, cash: rng() < 0.6 ? int(rng, 0, 400) : 0, spaceIds: some(mine), jailCards: rng() < 0.1 ? 1 : 0 },
          b: { player: b, cash: rng() < 0.6 ? int(rng, 0, 400) : 0, spaceIds: some(theirs), jailCards: rng() < 0.1 ? 1 : 0 },
        }),
      };
    }
    case "repairs":
      return { label: "repairs", plan: planRepairs(s, a, int(rng, 10, 45), int(rng, 50, 125)) };
    case "bankrupt":
      // Rare, so games last long enough to build things.
      if (rng() > 0.08) throw new RuleError("INVALID_ACTION", "skip");
      return { label: "bankrupt", plan: planBankruptcy(s, a, rng() < 0.5 ? BANK : b) };
    default:
      if (rng() > 0.02) throw new RuleError("INVALID_ACTION", "skip");
      return { label: "end game", plan: planEndGame(s) };
  }
}

type Run = { actions: number; undos: number; refused: number; refusedUndos: number; games: number; maxBuildings: number; trades: number; bankruptcies: number };

/**
 * Plays `steps` random actions with random undos, checking after every step that: nothing leaves the state
 * broken, every undo the rule allows applies cleanly and restores the exact state before that group, and the
 * running state always equals replaying the whole event log from scratch.
 */
function simulate(seed: number, steps: number, settings: Settings, board = CLASSIC): Run {
  const rng = mulberry32(seed);
  const names = ["A", "B", "C", "D", "E"].slice(0, int(rng, 3, 5));
  const fresh = () => createGame(structuredClone(board), settings, names.map((n) => ({ id: n, name: n })));
  let initial = fresh();
  let state = initial;
  let groups: GroupRecord[] = [];
  let events: MEvent[] = [];
  const stats: Run = { actions: 0, undos: 0, refused: 0, refusedUndos: 0, games: 1, maxBuildings: 0, trades: 0, bankruptcies: 0 };
  let n = 0;

  for (let step = 0; step < steps; step++) {
    if (gameIsOver(state)) {
      initial = fresh();
      state = initial;
      groups = [];
      events = [];
      stats.games++;
    }
    if (groups.length > 3 && rng() < 0.18) {
      // Undo a recent group, as a host would. Mostly the latest few; the rule must refuse the ones that are blocked.
      const recent = groups.slice(-(rng() < 0.8 ? 5 : 40)).filter((g) => !g.reversesGroupId);
      if (recent.length === 0) continue;
      const target = pick(rng, recent);
      const verdict = checkUndo(groups, target.groupId);
      if (!verdict.ok) {
        stats.refusedUndos++;
        continue;
      }
      const inverse = invertEvents(target.events);
      let after: GameState;
      try {
        after = applyEvents(state, inverse);
      } catch (e) {
        // The bank's stock of houses/hotels is shared between groups, so an undo can legitimately find it used up.
        if (e instanceof RuleError && e.code === "BANK_STOCK") {
          stats.refusedUndos++;
          continue;
        }
        throw new Error(`seed ${seed} step ${step}: undo of "${target.label}" allowed but failed: ${(e as Error).message}`);
      }
      state = after;
      events.push(...inverse);
      groups.push({ groupId: `g${n++}`, label: `Undo: ${target.label}`, events: inverse, reversesGroupId: target.groupId });
      stats.undos++;
    } else {
      let made: { label: string; plan: Plan };
      try {
        made = randomAction(rng, state);
      } catch (e) {
        if (e instanceof RuleError) {
          stats.refused++;
          continue;
        }
        throw e;
      }
      state = made.plan.after;
      events.push(...made.plan.events);
      groups.push({ groupId: `g${n++}`, label: made.label, events: made.plan.events });
      stats.actions++;
      if (made.label === "trade") stats.trades++;
      if (made.label === "bankrupt") stats.bankruptcies++;
    }

    const problems = gameViolations(state, events);
    if (problems.length) throw new Error(`seed ${seed} step ${step}: ${problems.join("; ")}`);
    stats.maxBuildings = Math.max(stats.maxBuildings, Object.values(state.props).reduce((s, p) => s + p.houses + (p.hotel ? 1 : 0), 0));
    if (step % 50 === 0) expect(applyEvents(initial, events)).toEqual(state);
  }
  expect(applyEvents(initial, events)).toEqual(state);
  return stats;
}

describe("randomized play with undos", () => {
  const all: Settings = { ...DEFAULT_SETTINGS, freeParkingPot: true, doubleOnGo: true };

  test("1,000 mixed actions and undos keep every invariant (Classic, all house rules)", () => {
    const run = simulate(1, 3500, all);
    expect(run.actions + run.undos).toBeGreaterThanOrEqual(1000);
    expect(run.undos).toBeGreaterThan(100);
    expect(run.refusedUndos).toBeGreaterThan(0); // the blocking rule really fires
    expect(run.trades).toBeGreaterThan(5);
  });

  test.each([2, 3, 4, 5, 6, 7, 8])("seed %i: 800 steps with property tracking, house-rule variations", (seed) => {
    const rng = mulberry32(seed * 977);
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      freeParkingPot: rng() < 0.5,
      doubleOnGo: rng() < 0.5,
      evenBuilding: rng() < 0.5,
      auctions: rng() < 0.5,
    };
    const run = simulate(seed, 800, settings);
    expect(run.actions).toBeGreaterThan(200);
  });

  test("money-only games (Business, no deeds) stay consistent too", () => {
    const run = simulate(11, 1000, { ...DEFAULT_SETTINGS, trackProperties: false, evenBuilding: false }, BUSINESS);
    expect(run.actions + run.undos).toBeGreaterThanOrEqual(500);
  });

  test("the harness really exercises building, trading and bankruptcy", () => {
    const runs = [21, 22, 23, 24].map((seed) => simulate(seed, 1200, all));
    expect(Math.max(...runs.map((r) => r.maxBuildings))).toBeGreaterThan(3);
    expect(runs.reduce((s, r) => s + r.trades, 0)).toBeGreaterThan(5);
    expect(runs.reduce((s, r) => s + r.bankruptcies, 0)).toBeGreaterThan(2);
    expect(runs.reduce((s, r) => s + r.games, 0)).toBeGreaterThan(4);
  });
});
