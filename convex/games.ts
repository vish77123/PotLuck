import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getGameInSession, getPlayerInSession, requireActivePlayer, requireHost, requirePlayer } from "./lib/access";
import { fail } from "./lib/errors";
import {
  activeGameOf,
  advanceTurn,
  assertBetInRange,
  participantOf,
  participantsOf,
  requireActiveGame,
} from "./lib/game";
import { applyEntry, findReversal, getWallet, reverseEntry, withIdempotency } from "./lib/ledger";
import { assertAmount, formatInr } from "./lib/validators";

export const start = mutation({
  args: {
    sessionId: v.id("sessions"),
    templateId: v.id("gameTemplates"),
    participants: v.array(v.object({ playerId: v.id("sessionPlayers"), teamNo: v.optional(v.number()) })),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, session, player: host } = await requireHost(ctx, args.sessionId);
    return await withIdempotency(ctx, userId, args.idempotencyKey, async () => {
      if (await activeGameOf(ctx, session._id)) fail("INVALID_STATE", "A game is already in progress.");
      const template = await ctx.db.get(args.templateId);
      if (!template || template.crewId !== session.crewId || template.archived) {
        fail("NOT_FOUND", "That game template isn't available.");
      }
      const snapshot = {
        name: template.name,
        boot: template.boot,
        minBet: template.minBet,
        maxBet: template.maxBet,
        blindSeenMultiplier: template.blindSeenMultiplier,
        turnMode: template.turnMode,
        teamMode: template.teamMode,
        confirmAbove: template.confirmAbove,
      };

      const seen = new Set<Id<"sessionPlayers">>();
      const chosen: { player: Doc<"sessionPlayers">; teamNo?: number }[] = [];
      for (const p of args.participants) {
        if (seen.has(p.playerId)) fail("INVALID_STATE", "A player is listed twice.");
        seen.add(p.playerId);
        const player = await getPlayerInSession(ctx, session._id, p.playerId);
        if (player.status !== "active") fail("INVALID_STATE", `${player.name} has cashed out.`);
        if (snapshot.teamMode === "team") {
          if (p.teamNo === undefined || !Number.isSafeInteger(p.teamNo) || p.teamNo < 1) {
            fail("INVALID_STATE", `Put ${player.name} on a team.`);
          }
        }
        chosen.push({ player, teamNo: snapshot.teamMode === "team" ? p.teamNo : undefined });
      }
      chosen.sort((a, b) => a.player.seatNo - b.player.seatNo);

      // Anyone who can't cover the boot sits this game out.
      const excluded: { playerId: Id<"sessionPlayers">; name: string; balance: number }[] = [];
      const playing: typeof chosen = [];
      for (const c of chosen) {
        const wallet = await getWallet(ctx, c.player._id);
        if (wallet.balance < snapshot.boot) excluded.push({ playerId: c.player._id, name: c.player.name, balance: wallet.balance });
        else playing.push(c);
      }
      if (playing.length < 2) {
        const short = excluded.map((e) => `${e.name} (${formatInr(e.balance)})`).join(", ");
        fail(
          "INSUFFICIENT_BALANCE",
          excluded.length
            ? `Not enough players can cover the ${formatInr(snapshot.boot)} boot. Short: ${short}.`
            : "Pick at least two players.",
        );
      }
      if (snapshot.teamMode === "team" && new Set(playing.map((c) => c.teamNo)).size < 2) {
        fail("INVALID_STATE", "Team games need at least two teams.");
      }

      const now = Date.now();
      const gameId = await ctx.db.insert("games", {
        sessionId: session._id,
        gameNo: session.nextGameNo,
        templateId: template._id,
        templateSnapshot: snapshot,
        status: "active",
        currentTurnPlayerId: snapshot.turnMode === "turn_based" ? playing[0].player._id : undefined,
        turnStartedAt: snapshot.turnMode === "turn_based" ? now : undefined,
        poolAmount: 0,
        startedAt: now,
      });
      await ctx.db.patch(session._id, {
        nextGameNo: session.nextGameNo + 1,
        status: "active",
        startedAt: session.startedAt ?? now,
      });
      for (let i = 0; i < playing.length; i++) {
        const c = playing[i];
        await ctx.db.insert("gameParticipants", {
          gameId,
          sessionId: session._id,
          sessionPlayerId: c.player._id,
          seatOrder: i + 1,
          teamNo: c.teamNo,
          status: "playing",
          isSeen: false,
        });
        if (snapshot.boot > 0) {
          await applyEntry(ctx, {
            sessionId: session._id,
            gameId,
            type: "BOOT",
            fromPlayerId: c.player._id,
            toPool: true,
            amount: snapshot.boot,
            createdByPlayerId: host._id,
            idempotencyKey: args.idempotencyKey,
          });
        }
      }
      return { gameId, excluded };
    });
  },
});

async function requireMyParticipant(ctx: Parameters<typeof participantOf>[0], game: Doc<"games">, playerId: Id<"sessionPlayers">) {
  const me = await participantOf(ctx, game._id, playerId);
  if (!me) fail("FORBIDDEN", "You're not playing in this game.");
  return me;
}

export const bet = mutation({
  args: { gameId: v.id("games"), amount: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, { gameId, amount, idempotencyKey }) => {
    const game = await getGameInSession(ctx, gameId);
    const { userId, player } = await requireActivePlayer(ctx, game.sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      requireActiveGame(game);
      const me = await requireMyParticipant(ctx, game, player._id);
      if (me.status === "packed") fail("INVALID_STATE", "You've packed this game.");
      const t = game.templateSnapshot;
      if (t.turnMode === "turn_based" && game.currentTurnPlayerId !== player._id) {
        const turnPlayer = game.currentTurnPlayerId ? await ctx.db.get(game.currentTurnPlayerId) : null;
        fail("NOT_YOUR_TURN", turnPlayer ? `It's ${turnPlayer.name}'s turn.` : "It's not your turn.");
      }
      assertAmount(amount, "Bet");
      assertBetInRange(t, amount);
      const entry = await applyEntry(ctx, {
        sessionId: game.sessionId,
        gameId,
        type: "BET",
        fromPlayerId: player._id,
        toPool: true,
        amount,
        createdByPlayerId: player._id,
        meta: { seen: me.isSeen },
        idempotencyKey,
      });
      await advanceTurn(ctx, game, player._id);
      return { entryId: entry._id };
    });
  },
});

export const pack = mutation({
  args: { gameId: v.id("games"), playerId: v.optional(v.id("sessionPlayers")) },
  handler: async (ctx, { gameId, playerId }) => {
    const game = await getGameInSession(ctx, gameId);
    const { player, isHost } = await requireActivePlayer(ctx, game.sessionId);
    requireActiveGame(game);
    const targetId = playerId ?? player._id;
    const forSomeoneElse = targetId !== player._id;
    if (forSomeoneElse && !isHost) fail("NOT_HOST", "Only the host can pack for another player.");
    const target = await participantOf(ctx, gameId, targetId);
    if (!target) fail("FORBIDDEN", forSomeoneElse ? "That player isn't in this game." : "You're not playing in this game.");
    if (target.status === "packed") return null; // double tap
    if (!forSomeoneElse && game.templateSnapshot.turnMode === "turn_based" && game.currentTurnPlayerId !== player._id) {
      fail("NOT_YOUR_TURN", "You can pack on your turn.");
    }
    await ctx.db.patch(target._id, { status: "packed" });
    await ctx.db.insert("gameEvents", {
      sessionId: game.sessionId,
      gameId,
      kind: "pack",
      playerId: targetId,
      byPlayerId: player._id,
      createdAt: Date.now(),
    });
    if (game.currentTurnPlayerId === targetId) await advanceTurn(ctx, game, targetId);
    return null;
  },
});

export const setSeen = mutation({
  args: { gameId: v.id("games"), seen: v.boolean() },
  handler: async (ctx, { gameId, seen }) => {
    const game = await getGameInSession(ctx, gameId);
    const { player } = await requireActivePlayer(ctx, game.sessionId);
    requireActiveGame(game);
    const me = await requireMyParticipant(ctx, game, player._id);
    await ctx.db.patch(me._id, { isSeen: seen });
    return null;
  },
});

export const setTurn = mutation({
  args: { gameId: v.id("games"), playerId: v.id("sessionPlayers") },
  handler: async (ctx, { gameId, playerId }) => {
    const game = await getGameInSession(ctx, gameId);
    await requireHost(ctx, game.sessionId);
    requireActiveGame(game);
    if (game.templateSnapshot.turnMode !== "turn_based") fail("INVALID_STATE", "This game has no turns.");
    const target = await participantOf(ctx, gameId, playerId);
    if (!target) fail("NOT_FOUND", "That player isn't in this game.");
    if (target.status !== "playing") fail("INVALID_STATE", "That player has packed.");
    await ctx.db.patch(gameId, { currentTurnPlayerId: playerId, turnStartedAt: Date.now() });
    return null;
  },
});

/** Host moves a player to another team mid-game (team games only). */
export const setTeam = mutation({
  args: { gameId: v.id("games"), playerId: v.id("sessionPlayers"), teamNo: v.number() },
  handler: async (ctx, { gameId, playerId, teamNo }) => {
    const game = await getGameInSession(ctx, gameId);
    await requireHost(ctx, game.sessionId);
    requireActiveGame(game);
    if (game.templateSnapshot.teamMode !== "team") fail("INVALID_STATE", "This isn't a team game.");
    if (!Number.isSafeInteger(teamNo) || teamNo < 1 || teamNo > 6) fail("INVALID_STATE", "Pick a team from 1 to 6.");
    const target = await participantOf(ctx, gameId, playerId);
    if (!target) fail("NOT_FOUND", "That player isn't in this game.");
    await ctx.db.patch(target._id, { teamNo });
    return null;
  },
});

/** Host fixes a mistaken pack. Pack isn't money, so it isn't in the ledger. */
export const unpack = mutation({
  args: { gameId: v.id("games"), playerId: v.id("sessionPlayers") },
  handler: async (ctx, { gameId, playerId }) => {
    const game = await getGameInSession(ctx, gameId);
    const { player: host } = await requireHost(ctx, game.sessionId);
    requireActiveGame(game);
    const target = await participantOf(ctx, gameId, playerId);
    if (!target) fail("NOT_FOUND", "That player isn't in this game.");
    if (target.status === "playing") return null;
    await ctx.db.patch(target._id, { status: "playing" });
    await ctx.db.insert("gameEvents", {
      sessionId: game.sessionId,
      gameId,
      kind: "unpack",
      playerId: playerId,
      byPlayerId: host._id,
      createdAt: Date.now(),
    });
    if (game.templateSnapshot.turnMode === "turn_based" && !game.currentTurnPlayerId) {
      await ctx.db.patch(gameId, { currentTurnPlayerId: playerId, turnStartedAt: Date.now() });
    }
    return null;
  },
});

async function finishGame(
  ctx: Parameters<typeof applyEntry>[0],
  game: Doc<"games">,
  fields: Partial<Doc<"games">>,
) {
  const after = (await ctx.db.get(game._id))!;
  if (after.poolAmount !== 0) fail("INVALID_STATE", `Pool should be empty but has ${formatInr(after.poolAmount)}.`);
  await ctx.db.patch(game._id, {
    ...fields,
    endedAt: Date.now(),
    turnAtEnd: game.currentTurnPlayerId,
    currentTurnPlayerId: undefined,
    turnStartedAt: undefined,
  });
}

export const endSolo = mutation({
  args: { gameId: v.id("games"), winnerPlayerId: v.id("sessionPlayers"), idempotencyKey: v.string() },
  handler: async (ctx, { gameId, winnerPlayerId, idempotencyKey }) => {
    const game = await getGameInSession(ctx, gameId);
    const { userId, player: host } = await requireHost(ctx, game.sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      requireActiveGame(game);
      if (game.templateSnapshot.teamMode !== "solo") fail("INVALID_STATE", "This is a team game — pick a team.");
      const winner = await participantOf(ctx, gameId, winnerPlayerId);
      if (!winner) fail("NOT_FOUND", "The winner must be playing in this game.");
      const fresh = (await ctx.db.get(gameId))!;
      if (fresh.poolAmount > 0) {
        await applyEntry(ctx, {
          sessionId: game.sessionId,
          gameId,
          type: "PAYOUT",
          fromPool: true,
          toPlayerId: winnerPlayerId,
          amount: fresh.poolAmount,
          createdByPlayerId: host._id,
          idempotencyKey,
        });
      }
      await finishGame(ctx, game, { status: "ended", winnerPlayerIds: [winnerPlayerId] });
      return { payout: fresh.poolAmount };
    });
  },
});

/** Pure split: base to every winner, then +1 to `remainder` of them chosen by `pick`. */
export function splitPool(pool: number, winners: string[], random: () => number = Math.random) {
  const n = winners.length;
  const base = Math.floor(pool / n);
  const remainder = pool % n;
  const shuffled = [...winners];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const lucky = new Set(shuffled.slice(0, remainder));
  return { base, remainder, lucky: [...lucky], shares: winners.map((w) => ({ id: w, amount: base + (lucky.has(w) ? 1 : 0) })) };
}

export const endTeam = mutation({
  args: { gameId: v.id("games"), teamNo: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, { gameId, teamNo, idempotencyKey }) => {
    const game = await getGameInSession(ctx, gameId);
    const { userId, player: host } = await requireHost(ctx, game.sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      requireActiveGame(game);
      if (game.templateSnapshot.teamMode !== "team") fail("INVALID_STATE", "This is a solo game — pick a winner.");
      const winners = (await participantsOf(ctx, gameId)).filter((p) => p.teamNo === teamNo);
      if (!winners.length) fail("NOT_FOUND", `Team ${teamNo} has nobody in this game.`);
      const fresh = (await ctx.db.get(gameId))!;
      const split = splitPool(fresh.poolAmount, winners.map((w) => w.sessionPlayerId));
      for (const share of split.shares) {
        if (share.amount === 0) continue;
        await applyEntry(ctx, {
          sessionId: game.sessionId,
          gameId,
          type: "PAYOUT",
          fromPool: true,
          toPlayerId: share.id as Id<"sessionPlayers">,
          amount: share.amount,
          createdByPlayerId: host._id,
          meta: { teamNo, base: split.base, remainder: split.remainder, gotRemainder: split.lucky.includes(share.id) },
          idempotencyKey,
        });
      }
      const lucky = split.lucky as Id<"sessionPlayers">[];
      await finishGame(ctx, game, {
        status: "ended",
        winningTeamNo: teamNo,
        winnerPlayerIds: winners.map((w) => w.sessionPlayerId),
        remainderPlayerIds: lucky,
      });
      return { base: split.base, remainder: split.remainder, remainderTo: lucky };
    });
  },
});

export const cancel = mutation({
  args: { gameId: v.id("games"), idempotencyKey: v.string() },
  handler: async (ctx, { gameId, idempotencyKey }) => {
    const game = await getGameInSession(ctx, gameId);
    const { userId, player: host } = await requireHost(ctx, game.sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      requireActiveGame(game);
      const entries = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .collect();
      let refunded = 0;
      for (const e of entries) {
        if ((e.type === "BOOT" || e.type === "BET") && !(await findReversal(ctx, e._id))) {
          await reverseEntry(ctx, e, host._id, { meta: { reason: "game_cancelled" }, idempotencyKey });
          refunded += e.amount;
        }
      }
      await finishGame(ctx, game, { status: "cancelled" });
      return { refunded };
    });
  },
});

export const reopen = mutation({
  args: { gameId: v.id("games"), idempotencyKey: v.string() },
  handler: async (ctx, { gameId, idempotencyKey }) => {
    const game = await getGameInSession(ctx, gameId);
    const { userId, session, player: host } = await requireHost(ctx, game.sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      if (game.status !== "ended") fail("INVALID_STATE", "Only an ended game can be reopened.");
      if (game.gameNo !== session.nextGameNo - 1) fail("INVALID_STATE", "Only the most recent game can be reopened.");
      const payouts = (
        await ctx.db
          .query("ledgerEntries")
          .withIndex("by_game", (q) => q.eq("gameId", gameId))
          .collect()
      ).filter((e) => e.type === "PAYOUT");
      for (const e of payouts) {
        if (!(await findReversal(ctx, e._id))) {
          await reverseEntry(ctx, e, host._id, { meta: { reason: "game_reopened" }, idempotencyKey });
        }
      }
      const participants = await participantsOf(ctx, gameId);
      const turnBack =
        game.templateSnapshot.turnMode === "turn_based"
          ? (participants.find((p) => p.sessionPlayerId === game.turnAtEnd && p.status === "playing") ??
              participants.find((p) => p.status === "playing"))?.sessionPlayerId
          : undefined;
      await ctx.db.patch(gameId, {
        status: "active",
        endedAt: undefined,
        winnerPlayerIds: undefined,
        winningTeamNo: undefined,
        remainderPlayerIds: undefined,
        currentTurnPlayerId: turnBack,
        turnStartedAt: turnBack ? Date.now() : undefined,
      });
      return null;
    });
  },
});

/** Per-player money in and out of one game (live entries only), for the end-game picker and the result screen. */
export const summary = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await getGameInSession(ctx, gameId);
    await requirePlayer(ctx, game.sessionId);
    const entries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .take(3000);
    const reversed = new Set(entries.filter((e) => e.type === "REVERSAL").map((e) => e.reversesEntryId as string));
    const putIn: Record<string, number> = {};
    const won: Record<string, number> = {};
    let betCount = 0;
    for (const e of entries) {
      if (e.type === "REVERSAL" || reversed.has(e._id)) continue;
      if (e.type === "BOOT" || e.type === "BET") {
        putIn[e.fromPlayerId!] = (putIn[e.fromPlayerId!] ?? 0) + e.amount;
        if (e.type === "BET") betCount++;
      } else if (e.type === "PAYOUT") {
        won[e.toPlayerId!] = (won[e.toPlayerId!] ?? 0) + e.amount;
      }
    }
    return { putIn, won, betCount };
  },
});
