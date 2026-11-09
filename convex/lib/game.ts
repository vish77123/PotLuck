import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./errors";

type Ctx = QueryCtx | MutationCtx;

export async function participantsOf(ctx: Ctx, gameId: Id<"games">) {
  return await ctx.db
    .query("gameParticipants")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
}

export async function participantOf(ctx: Ctx, gameId: Id<"games">, playerId: Id<"sessionPlayers">) {
  return await ctx.db
    .query("gameParticipants")
    .withIndex("by_game_player", (q) => q.eq("gameId", gameId).eq("sessionPlayerId", playerId))
    .unique();
}

export async function activeGameOf(ctx: Ctx, sessionId: Id<"sessions">) {
  return await ctx.db
    .query("games")
    .withIndex("by_session_status", (q) => q.eq("sessionId", sessionId).eq("status", "active"))
    .first();
}

export function requireActiveGame(game: Doc<"games">) {
  if (game.status !== "active") fail("INVALID_STATE", `Game #${game.gameNo} is not in progress.`);
}

/** Next playing participant after `afterPlayerId` in seat order, wrapping. Undefined if nobody else is playing. */
export function nextPlaying(
  participants: Doc<"gameParticipants">[],
  afterPlayerId: Id<"sessionPlayers">,
): Id<"sessionPlayers"> | undefined {
  const ordered = [...participants].sort((a, b) => a.seatOrder - b.seatOrder);
  const i = ordered.findIndex((p) => p.sessionPlayerId === afterPlayerId);
  for (let step = 1; step <= ordered.length; step++) {
    const p = ordered[(i + step) % ordered.length];
    if (p.status === "playing") return p.sessionPlayerId;
  }
  return undefined;
}

/** After a turn-based action by `actorId`, hand the turn to the next playing participant. */
export async function advanceTurn(ctx: MutationCtx, game: Doc<"games">, actorId: Id<"sessionPlayers">) {
  if (game.templateSnapshot.turnMode !== "turn_based") return;
  const participants = await participantsOf(ctx, game._id);
  const next = nextPlaying(participants, actorId);
  await ctx.db.patch(game._id, { currentTurnPlayerId: next, turnStartedAt: Date.now() });
}

export function assertBetInRange(template: Doc<"games">["templateSnapshot"], amount: number) {
  if (amount < template.minBet) fail("BET_OUT_OF_RANGE", `Minimum bet is ₹${template.minBet.toLocaleString("en-IN")}.`);
  if (template.maxBet !== undefined && amount > template.maxBet) {
    fail("BET_OUT_OF_RANGE", `Maximum bet is ₹${template.maxBet.toLocaleString("en-IN")}.`);
  }
}
