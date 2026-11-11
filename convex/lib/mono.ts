import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { applyEvents, gameViolations, type GroupRecord } from "../../lib/monopoly/engine";
import { toGameState } from "../../lib/monopoly/state";
import { RuleError, type GameState, type MEvent } from "../../lib/monopoly/types";
import { fail } from "./errors";

type Ctx = QueryCtx | MutationCtx;

/** Runs pure rules code and turns a RuleError into the ConvexError the UI shows. A short wallet carries who and how much. */
export function rules<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RuleError) {
      if (e.code === "INSUFFICIENT_CASH") {
        fail("INSUFFICIENT_BALANCE", e.message, e.detail ? { ...e.detail } : undefined);
      }
      fail("INVALID_STATE", e.message);
    }
    throw e;
  }
}

export type LoadedGame = {
  game: Doc<"mGames">;
  players: Doc<"mPlayers">[];
  props: Doc<"mPropertyStates">[];
  state: GameState;
};

/** The projection documents of one game, and the pure GameState built from them. */
export async function loadGame(ctx: Ctx, gameId: Id<"mGames">): Promise<LoadedGame> {
  const game = await ctx.db.get(gameId);
  if (!game) fail("NOT_FOUND", "Game not found.");
  const players = await ctx.db
    .query("mPlayers")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  const props = await ctx.db
    .query("mPropertyStates")
    .withIndex("by_game_space", (q) => q.eq("gameId", gameId))
    .collect();
  const names = new Map<string, string>();
  for (const p of players) names.set(p._id, (await ctx.db.get(p.sessionPlayerId))?.name ?? "A player");
  const state = toGameState(
    game,
    players.map((p) => ({ ...p, _id: p._id as string, name: names.get(p._id) })),
    props.map((p) => ({ ...p, ownerPlayerId: p.ownerPlayerId as string | null })),
  );
  return { game, players, props, state };
}

export async function myMonoPlayer(ctx: Ctx, gameId: Id<"mGames">, sessionPlayerId: Id<"sessionPlayers">) {
  return await ctx.db
    .query("mPlayers")
    .withIndex("by_game_player", (q) => q.eq("gameId", gameId).eq("sessionPlayerId", sessionPlayerId))
    .unique();
}

/** A game that is being played: not in setup, paused, ended or cancelled. */
export function requireLive(game: Doc<"mGames">) {
  if (game.status === "paused") fail("INVALID_STATE", "The game is paused.");
  if (game.status !== "active") fail("INVALID_STATE", "That game isn't in progress.");
}

const clean = <T,>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));

export function eventToRow(e: MEvent) {
  const anyE = e as { fromParty?: string; toParty?: string; amount?: number; spaceId?: string; meta?: unknown };
  return {
    type: e.type,
    fromParty: anyE.fromParty,
    toParty: anyE.toParty,
    amount: anyE.amount,
    spaceId: anyE.spaceId,
    meta: clean(anyE.meta),
  };
}

export function rowToEvent(r: Doc<"mEvents">): MEvent {
  const e: Record<string, unknown> = { type: r.type };
  if (r.fromParty !== undefined) e.fromParty = r.fromParty;
  if (r.toParty !== undefined) e.toParty = r.toParty;
  if (r.amount !== undefined) e.amount = r.amount;
  if (r.spaceId !== undefined) e.spaceId = r.spaceId;
  if (r.meta !== undefined) e.meta = r.meta;
  return e as MEvent;
}

export type GroupInput = {
  loaded: LoadedGame;
  events: MEvent[];
  by: Id<"sessionPlayers">;
  label: string;
  idempotencyKey?: string;
  reversesGroupId?: string;
};

/**
 * The only code that changes a Monopoly game's projections. Runs the pure reducer over the group (which enforces
 * cash ≥ 0, ownership and bank stock), patches players, properties and the game, and appends every event under one
 * groupId. All of it is one transaction, so a rule failure anywhere leaves the game untouched.
 */
export async function applyMonopolyGroup(ctx: MutationCtx, a: GroupInput) {
  const { game, players, props, state } = a.loaded;
  const next = rules(() => applyEvents(state, a.events));
  const violations = gameViolations(next);
  if (violations.length) throw new Error(`Monopoly invariants broken: ${violations.join("; ")}`);

  for (const p of players) {
    const before = state.players[p._id];
    const after = next.players[p._id];
    const patch: Partial<Doc<"mPlayers">> = {};
    if (after.cash !== before.cash) patch.cash = after.cash;
    if (after.inJail !== before.inJail) patch.inJail = after.inJail;
    if (after.jailTurns !== before.jailTurns) patch.jailTurns = after.jailTurns;
    if (after.jailCards !== before.jailCards) patch.jailCards = after.jailCards;
    if (after.status !== before.status) patch.status = after.status;
    if (after.finishPosition !== before.finishPosition) patch.finishPosition = after.finishPosition;
    if (Object.keys(patch).length) await ctx.db.patch(p._id, patch);
  }
  for (const p of props) {
    const before = state.props[p.spaceId];
    const after = next.props[p.spaceId];
    const patch: Partial<Doc<"mPropertyStates">> = {};
    if (after.owner !== before.owner) patch.ownerPlayerId = after.owner as Id<"mPlayers"> | null;
    if (after.houses !== before.houses) patch.houses = after.houses;
    if (after.hotel !== before.hotel) patch.hotel = after.hotel;
    if (after.mortgaged !== before.mortgaged) patch.mortgaged = after.mortgaged;
    if (Object.keys(patch).length) await ctx.db.patch(p._id, patch);
  }
  const groupNo = game.nextGroupNo;
  await ctx.db.patch(game._id, {
    freeParkingPot: next.pot,
    bankHouses: next.bankHouses,
    bankHotels: next.bankHotels,
    nextGroupNo: groupNo + 1,
  });

  const groupId = `${game._id}:${groupNo}`;
  const now = Date.now();
  for (const e of a.events) {
    await ctx.db.insert("mEvents", {
      sessionId: game.sessionId,
      gameId: game._id,
      groupId,
      groupNo,
      ...eventToRow(e),
      label: a.label,
      createdBy: a.by,
      createdAt: now,
      idempotencyKey: a.idempotencyKey,
      reversesGroupId: a.reversesGroupId,
    });
  }
  return { groupId, groupNo, state: next };
}

/** Rows that aren't money or property changes (turn changes, notes) are logged but never part of an undoable group. */
export const NON_GROUP_TYPES = new Set(["TURN", "NOTE"]);

/** Every undoable group of a game, oldest first. */
export async function loadGroups(ctx: Ctx, gameId: Id<"mGames">): Promise<GroupRecord[]> {
  const rows = await ctx.db
    .query("mEvents")
    .withIndex("by_game_group", (q) => q.eq("gameId", gameId))
    .take(20000);
  const groups = new Map<string, GroupRecord>();
  for (const r of rows) {
    if (NON_GROUP_TYPES.has(r.type)) continue;
    let g = groups.get(r.groupId);
    if (!g) {
      g = { groupId: r.groupId, label: r.label ?? "an action", events: [], reversesGroupId: r.reversesGroupId };
      groups.set(r.groupId, g);
    }
    g.events.push(rowToEvent(r));
  }
  return [...groups.values()];
}
