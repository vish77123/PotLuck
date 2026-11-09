import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./errors";

type Ctx = QueryCtx | MutationCtx;

export async function requireUser(ctx: Ctx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) fail("UNAUTHENTICATED", "This device isn't signed in yet. Reload and try again.");
  return userId;
}

export async function getSession(ctx: Ctx, sessionId: Id<"sessions">) {
  const session = await ctx.db.get(sessionId);
  if (!session) fail("NOT_FOUND", "Session not found.");
  return session;
}

export type PlayerContext = {
  userId: Id<"users">;
  session: Doc<"sessions">;
  player: Doc<"sessionPlayers">;
  isHost: boolean;
};

/** Resolves the caller's seat in this session, or rejects. Players who cashed out can still read. */
export async function requirePlayer(ctx: Ctx, sessionId: Id<"sessions">): Promise<PlayerContext> {
  const userId = await requireUser(ctx);
  const session = await getSession(ctx, sessionId);
  const player = await ctx.db
    .query("sessionPlayers")
    .withIndex("by_session_user", (q) => q.eq("sessionId", sessionId).eq("userId", userId))
    .unique();
  if (!player) fail("NOT_IN_SESSION", "You're not in this session.");
  return { userId, session, player, isHost: session.hostPlayerId === player._id };
}

/** For money and game actions: the caller must be seated (not cashed out) and the session not ended. */
export async function requireActivePlayer(ctx: Ctx, sessionId: Id<"sessions">) {
  const pc = await requirePlayer(ctx, sessionId);
  if (pc.session.status === "ended") fail("INVALID_STATE", "This session has ended.");
  if (pc.player.status !== "active") fail("INVALID_STATE", "You've cashed out of this session.");
  return pc;
}

export async function requireHost(ctx: Ctx, sessionId: Id<"sessions">) {
  const pc = await requireActivePlayer(ctx, sessionId);
  if (!pc.isHost) fail("NOT_HOST", "Only the host can do that.");
  return pc;
}

export async function requireCrewAccess(ctx: Ctx, crewId: Id<"crews">) {
  const userId = await requireUser(ctx);
  const crew = await ctx.db.get(crewId);
  if (!crew) fail("NOT_FOUND", "Crew not found.");
  const access = await ctx.db
    .query("crewAccess")
    .withIndex("by_crew_user", (q) => q.eq("crewId", crewId).eq("userId", userId))
    .unique();
  if (!access) fail("FORBIDDEN", "You're not part of this crew.");
  return { userId, crew };
}

export async function grantCrewAccess(ctx: MutationCtx, crewId: Id<"crews">, userId: Id<"users">) {
  const existing = await ctx.db
    .query("crewAccess")
    .withIndex("by_crew_user", (q) => q.eq("crewId", crewId).eq("userId", userId))
    .unique();
  if (existing) await ctx.db.patch(existing._id, { lastUsedAt: Date.now() });
  else await ctx.db.insert("crewAccess", { crewId, userId, lastUsedAt: Date.now() });
}

export async function getPlayerInSession(ctx: Ctx, sessionId: Id<"sessions">, playerId: Id<"sessionPlayers">) {
  const player = await ctx.db.get(playerId);
  if (!player || player.sessionId !== sessionId) fail("NOT_FOUND", "That player isn't in this session.");
  return player;
}

export async function getGameInSession(ctx: Ctx, gameId: Id<"games">) {
  const game = await ctx.db.get(gameId);
  if (!game) fail("NOT_FOUND", "Game not found.");
  return game;
}
