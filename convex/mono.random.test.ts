/// <reference types="vite/client" />
import { beforeAll, describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { key, newDevice, setup, type Device, type T } from "./test.setup";
import { CLASSIC } from "../lib/monopoly/presets";

beforeAll(() => {
  process.env.MONOPOLY_ENABLED = "true";
});

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
const pick = <X,>(rng: Rng, xs: X[]): X => xs[Math.floor(rng() * xs.length)];
const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

const SPACES = CLASSIC.spaces.filter((s) => s.kind === "property" || s.kind === "rail" || s.kind === "utility").map((s) => s.id);

type Seat = { as: Device; sp: Id<"sessionPlayers"> };

async function table(t: T, names: string[], settings: { freeParkingPot: boolean; evenBuilding: boolean; bankerMode?: "selfService" | "bankerApproves" }) {
  const host = await newDevice(t);
  const created = await host.mutation(api.mono.createSession, { newCrewName: "Random Crew", hostName: names[0], presetKey: "classic", idempotencyKey: key() });
  const seats: Record<string, Seat> = { [names[0]]: { as: host, sp: created.playerId } };
  for (const n of names.slice(1)) {
    const d = await newDevice(t);
    const j = await d.mutation(api.sessions.join, { code: created.code, newName: n, idempotencyKey: key() });
    seats[n] = { as: d, sp: j.playerId };
  }
  await host.mutation(api.mono.updateSetup, {
    gameId: created.gameId,
    startingCash: 3000,
    freeParkingPot: settings.freeParkingPot,
    evenBuilding: settings.evenBuilding,
    bankerMode: settings.bankerMode,
    bankerSessionPlayerId: settings.bankerMode === "bankerApproves" ? seats[names[2]].sp : undefined,
    buyIn: 100,
    split: [60, 40],
  });
  return { sessionId: created.sessionId, code: created.code, host, seats, names, gameId: created.gameId };
}

type Run = { applied: number; undos: number; refused: number; trades: number; auctions: number; bankruptcies: number; games: number; buildings: number };

/**
 * Drives the real mutations: payments, rent, buying, building, trades, auctions, cards, jail, bankruptcy and host undos,
 * in random order, for many operations. After every batch it replays the game's event log against its projections.
 */
async function simulate(t: T, seed: number, attempts: number, settings: Parameters<typeof table>[2]): Promise<Run> {
  const rng = mulberry32(seed);
  const names = ["Arjun", "Priya", "Meera", "Kabir"];
  const s = await table(t, names, settings);
  const stats: Run = { applied: 0, undos: 0, refused: 0, trades: 0, auctions: 0, bankruptcies: 0, games: 1, buildings: 0 };
  let gameId = s.gameId;
  await s.host.mutation(api.mono.start, { gameId, idempotencyKey: key() });

  const stateOf = async () => (await s.host.query(api.mono.state, { sessionId: s.sessionId })).game!;
  let pid: Record<string, Id<"mPlayers">> = {};
  const loadIds = async () => {
    const g = await stateOf();
    const st = await s.host.query(api.mono.state, { sessionId: s.sessionId });
    pid = {};
    for (const p of g.players) pid[st.seats.find((x) => x._id === p.sessionPlayerId)!.name] = p._id;
  };
  await loadIds();

  const attempt = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      stats.applied++;
      return true;
    } catch (e) {
      if (e instanceof ConvexError) {
        stats.refused++;
        return false;
      }
      throw new Error(`seed ${seed} ${label}: unexpected error: ${(e as Error).message}`);
    }
  };
  const perform = (who: string, action: Record<string, unknown>) => s.seats[who].as.mutation(api.mono.perform, { gameId, action: action as never, idempotencyKey: key() });

  for (let i = 0; i < attempts; i++) {
    const g0 = i % 40 === 0 ? await stateOf() : null;
    if (g0 && g0.status === "ended") {
      await s.host.mutation(api.mono.newGame, { sessionId: s.sessionId });
      const next = await stateOf();
      gameId = next._id;
      await s.host.mutation(api.mono.start, { gameId, idempotencyKey: key() });
      await loadIds();
      stats.games++;
    }
    const a = pick(rng, names);
    const b = pick(rng, names.filter((n) => n !== a));
    const space = pick(rng, SPACES);
    const r = rng();
    if (r < 0.1) await attempt("bankCollect", () => perform(a, { kind: "bankCollect", amount: int(rng, 50, 900) }));
    else if (r < 0.14) await attempt("bankPay", () => perform(a, { kind: "bankPay", amount: int(rng, 10, 300), reason: pick(rng, ["tax", "card", "bank"]) }));
    else if (r < 0.2) await attempt("pay", () => perform(a, { kind: "pay", toPlayerId: pid[b], amount: int(rng, 1, 400) }));
    else if (r < 0.3) await attempt("buy", () => perform(a, { kind: "buy", spaceId: space }));
    else if (r < 0.36) await attempt("rent", () => perform(a, { kind: "rent", spaceId: space, diceTotal: int(rng, 2, 12) }));
    else if (r < 0.46) {
      if (await attempt("build", () => perform(a, { kind: "build", spaceId: space }))) stats.buildings++;
    } else if (r < 0.49) await attempt("sell", () => perform(a, { kind: "sellBuilding", spaceId: space }));
    else if (r < 0.52) await attempt("mortgage", () => perform(a, { kind: "mortgage", spaceId: space }));
    else if (r < 0.55) await attempt("unmortgage", () => perform(a, { kind: "unmortgage", spaceId: space }));
    else if (r < 0.58) await attempt("passGo", () => perform(a, { kind: "passGo", confirmRepeat: rng() < 0.5 }));
    else if (r < 0.6) await attempt("pot", () => perform(a, { kind: "collectPot" }));
    else if (r < 0.63) await attempt("cardEvery", () => perform(a, { kind: "cardEvery", direction: pick(rng, ["collect", "pay"]), amount: int(rng, 10, 150) }));
    else if (r < 0.65) await attempt("repairs", () => perform(a, { kind: "repairs", perHouse: int(rng, 10, 45), perHotel: int(rng, 50, 125) }));
    else if (r < 0.7) {
      const op = pick(rng, ["goToJail", "jailTurn", "payJailFine", "useJailCard", "leaveJail", "drawJailCard"]);
      await attempt(op, () => perform(a, { kind: op }));
    } else if (r < 0.75) {
      // A trade is two steps: offer, then the other player accepts.
      const mine = SPACES.filter(() => rng() < 0.06).slice(0, 2);
      const theirs = SPACES.filter(() => rng() < 0.06).slice(0, 2);
      const offered = await s.seats[a].as
        .mutation(api.mono.proposeTrade, {
          gameId,
          withPlayerId: pid[b],
          give: { cash: rng() < 0.6 ? int(rng, 0, 300) : 0, spaceIds: mine, jailCards: 0 },
          get: { cash: rng() < 0.6 ? int(rng, 0, 300) : 0, spaceIds: theirs, jailCards: 0 },
          idempotencyKey: key(),
        })
        .catch((e) => {
          if (e instanceof ConvexError) return null;
          throw e;
        });
      if (!offered) stats.refused++;
      else {
        stats.applied++;
        if (rng() < 0.8 && (await attempt("accept trade", () => s.seats[b].as.mutation(api.mono.respond, { requestId: offered.requestId, accept: true, idempotencyKey: key() })))) stats.trades++;
      }
    } else if (r < 0.79) {
      const started = await s.seats[a].as.mutation(api.mono.startAuction, { gameId, spaceId: space, idempotencyKey: key() }).catch((e) => {
        if (e instanceof ConvexError) return null;
        throw e;
      });
      if (!started) stats.refused++;
      else {
        stats.applied++;
        for (const n of names.filter(() => rng() < 0.7)) await attempt("bid", () => s.seats[n].as.mutation(api.mono.bid, { auctionId: started.auctionId, amount: int(rng, 1, 600), idempotencyKey: key() }));
        // Let the countdown run out.
        await t.run((ctx) => ctx.db.patch(started.auctionId, { endsAt: Date.now() - 1 }));
        await t.mutation(internal.mono.closeAuction, { auctionId: started.auctionId });
        stats.auctions++;
      }
    } else if (r < 0.82) await attempt("endTurn", () => s.host.mutation(api.mono.endTurn, { gameId }));
    else if (r < 0.9) {
      // Host undo of one of the last few actions. The rule may refuse; it must never leave the game broken.
      const g = await stateOf();
      const groups = [...new Set(g.events.filter((e) => e.type !== "TURN" && e.type !== "NOTE" && !e.reversesGroupId).slice(0, 12).map((e) => e.groupId))];
      if (groups.length > 0) {
        if (await attempt("undo", () => s.host.mutation(api.mono.undo, { gameId, groupId: pick(rng, groups), idempotencyKey: key() }))) stats.undos++;
      }
    } else if (r < 0.905) {
      const alive = (await stateOf()).players.filter((p) => p.status === "playing");
      if (alive.length > 2 || rng() < 0.3) {
        const who = pick(rng, alive);
        const name = names.find((n) => pid[n] === who._id)!;
        const creditor = rng() < 0.5 ? null : pid[pick(rng, names.filter((n) => n !== name))];
        if (await attempt("bankrupt", () => s.host.mutation(api.mono.declareBankruptcy, { gameId, playerId: who._id, creditorId: creditor, idempotencyKey: key() }))) stats.bankruptcies++;
      }
    } else if (r < 0.92) await attempt("pause/resume", async () => {
      await s.host.mutation(api.mono.pause, { gameId });
      await s.host.mutation(api.mono.resume, { gameId });
    });
    else await attempt("bankCollect", () => perform(a, { kind: "bankCollect", amount: int(rng, 100, 600) }));

    if (i % 25 === 24) await t.query(internal.mono.assertGameInvariants, { gameId });
  }
  await t.query(internal.mono.assertGameInvariants, { gameId });
  await t.query(internal.invariants.assertSessionInvariants, { sessionId: s.sessionId });
  return stats;
}

describe("randomized play through the real mutations", () => {
  test("1,000+ mixed operations with undos keep every invariant (all house rules)", async () => {
    const t = setup();
    const run = await simulate(t, 1, 4500, { freeParkingPot: true, evenBuilding: true });
    expect(run.applied).toBeGreaterThanOrEqual(1000);
    expect(run.undos).toBeGreaterThan(20);
    expect(run.trades).toBeGreaterThan(5);
    expect(run.auctions).toBeGreaterThan(5);
    expect(run.buildings).toBeGreaterThan(5);
  }, 180_000);

  test("banker mode and no even-building, a second seed", async () => {
    const t = setup();
    const run = await simulate(t, 7, 2500, { freeParkingPot: false, evenBuilding: false, bankerMode: "bankerApproves" });
    expect(run.applied).toBeGreaterThan(300);
  }, 180_000);
});

// Silence "unused" for the generic helper type kept for readability.
export type _Unused = typeof expect;
