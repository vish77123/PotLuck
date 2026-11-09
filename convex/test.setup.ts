/// <reference types="vite/client" />
// Two dots in the file name keep Convex from deploying this as a function module.
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

export const modules = import.meta.glob("./**/*.ts");

export function setup() {
  return convexTest(schema, modules);
}

export type T = ReturnType<typeof setup>;
export type Device = ReturnType<T["withIdentity"]>;

let keyCounter = 0;
export function key() {
  keyCounter += 1;
  return `test-key-${keyCounter}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A fresh phone: a new anonymous auth user. */
export async function newDevice(t: T): Promise<Device> {
  const userId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }));
  return t.withIdentity({ subject: `${userId}|test-session`, tokenIdentifier: `test|${userId}` });
}

export type Seat = { as: Device; playerId: Id<"sessionPlayers"> };

/** Creates a session hosted by the first name; everyone else joins from their own phone. */
export async function table(
  t: T,
  names: string[],
  opts: { startingAmount?: number; walletMode?: "equal" | "custom"; buyIns?: number[]; theme?: "inr" | "chips" } = {},
) {
  const [hostName, ...others] = names;
  const startingAmount = opts.startingAmount ?? 1000;
  const hostDevice = await newDevice(t);
  const created = await hostDevice.mutation(api.sessions.create, {
    newCrewName: "Friday Night Crew",
    hostName,
    walletMode: opts.walletMode ?? "equal",
    startingAmount,
    hostBuyIn: opts.buyIns?.[0],
    theme: opts.theme ?? "inr",
    idempotencyKey: key(),
  });
  const seats: Record<string, Seat> = { [hostName]: { as: hostDevice, playerId: created.playerId } };
  for (let i = 0; i < others.length; i++) {
    const device = await newDevice(t);
    const joined = await device.mutation(api.sessions.join, {
      code: created.code,
      newName: others[i],
      buyIn: opts.buyIns?.[i + 1],
      idempotencyKey: key(),
    });
    seats[others[i]] = { as: device, playerId: joined.playerId };
  }
  return { sessionId: created.sessionId, code: created.code, seats, host: seats[hostName] };
}

export async function templateId(t: T, sessionId: Id<"sessions">, name: string) {
  return await t.run(async (ctx) => {
    const session = (await ctx.db.get(sessionId))!;
    const tpl = (await ctx.db
      .query("gameTemplates")
      .withIndex("by_crew", (q) => q.eq("crewId", session.crewId))
      .collect()).find((x) => x.name === name);
    return tpl!._id;
  });
}

export async function balances(t: T, sessionId: Id<"sessions">) {
  return await t.run(async (ctx) => {
    const players = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const out: Record<string, number> = {};
    for (const p of players) {
      const w = await ctx.db
        .query("wallets")
        .withIndex("by_player", (q) => q.eq("sessionPlayerId", p._id))
        .unique();
      out[p.name] = w!.balance;
    }
    return out;
  });
}

export async function getGame(t: T, gameId: Id<"games">) {
  return await t.run(async (ctx) => (await ctx.db.get(gameId))!);
}

export async function checkInvariants(t: T, sessionId: Id<"sessions">) {
  return await t.query(internal.invariants.assertSessionInvariants, { sessionId });
}

/** Asserts the promise rejects with a ConvexError carrying `code`. */
export async function expectError(p: Promise<unknown>, code: string, message?: RegExp) {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError);
    const data = (err as ConvexError<{ code: string; message: string }>).data;
    expect(data.code).toBe(code);
    if (message) expect(data.message).toMatch(message);
    return data;
  }
  throw new Error(`Expected ${code} error, but the call succeeded.`);
}

/** Starts a game with every listed seat. */
export async function startGame(
  t: T,
  ctx: Awaited<ReturnType<typeof table>>,
  template: string,
  players: string[],
  teams?: number[],
) {
  const tplId = await templateId(t, ctx.sessionId, template);
  return await ctx.host.as.mutation(api.games.start, {
    sessionId: ctx.sessionId,
    templateId: tplId,
    participants: players.map((n, i) => ({ playerId: ctx.seats[n].playerId, teamNo: teams?.[i] })),
    idempotencyKey: key(),
  });
}
