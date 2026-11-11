import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { insertCrew, upsertMember } from "./crews";
import { requireCrewAccess, requireActivePlayer, requireHost, requirePlayer, requireUser } from "./lib/access";
import { fail } from "./lib/errors";
import { applyEntry, findReversal, reverseEntry, withIdempotency } from "./lib/ledger";
import { applyMonopolyGroup, loadGame, loadGroups, myMonoPlayer, requireLive, rowToEvent, rules } from "./lib/mono";
import { assertAmount, cleanName } from "./lib/validators";
import { seatPlayer, uniqueCode, monoGameInProgress } from "./sessions";
import { describeGroup } from "../lib/monopoly/describe";
import { checkUndo, gameViolations, invertEvents, planBankCollect, planCollectPot, planPassGo, planPayBank, planPlayerPay, type Plan } from "../lib/monopoly/engine";
import { PRESETS, presetByKey } from "../lib/monopoly/presets";
import { nextPlayer, validateSettings, validateSplit } from "../lib/monopoly/rules";
import { DEFAULT_SETTINGS, type BoardConfig, type MEvent, type Settings } from "../lib/monopoly/types";

/** Payment requests, trade offers and banker approvals all lapse after 5 minutes. */
export const REQUEST_TTL_MS = 5 * 60 * 1000;

function requireEnabled() {
  if (process.env.MONOPOLY_ENABLED !== "true") fail("FORBIDDEN", "Property games aren't switched on yet.");
}

// ---------------------------------------------------------------------------------------------
// Session and setup
// ---------------------------------------------------------------------------------------------

async function insertSetupGame(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  board: BoardConfig,
  settings: Settings,
  bankerSessionPlayerId?: Id<"sessionPlayers">,
) {
  const session = (await ctx.db.get(sessionId))!;
  const { bankerPlayerId: _unused, ...stored } = settings;
  void _unused;
  const gameId = await ctx.db.insert("mGames", {
    sessionId,
    gameNo: session.nextGameNo,
    boardSnapshot: board,
    settings: stored,
    bankerSessionPlayerId,
    status: "setup",
    turnNo: 1,
    freeParkingPot: 0,
    bankHouses: board.houses,
    bankHotels: board.hotels,
    nextGroupNo: 1,
  });
  await ctx.db.patch(sessionId, { nextGameNo: session.nextGameNo + 1 });
  return gameId;
}

/** Creates a property-game session (hosted like any other) with its first game waiting in setup. */
export const createSession = mutation({
  args: {
    crewId: v.optional(v.id("crews")),
    newCrewName: v.optional(v.string()),
    name: v.optional(v.string()),
    hostMemberId: v.optional(v.id("crewMembers")),
    hostName: v.optional(v.string()),
    presetKey: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    requireEnabled();
    const userId = await requireUser(ctx);
    return await withIdempotency(ctx, userId, args.idempotencyKey, async () => {
      if (!PRESETS[args.presetKey]) fail("INVALID_STATE", "Pick a board.");
      let crewId: Id<"crews">;
      if (args.crewId) {
        await requireCrewAccess(ctx, args.crewId);
        crewId = args.crewId;
      } else {
        if (!args.newCrewName) fail("INVALID_STATE", "Name your crew.");
        crewId = await insertCrew(ctx, userId, args.newCrewName);
      }
      let member: Doc<"crewMembers">;
      if (args.hostMemberId) {
        const m = await ctx.db.get(args.hostMemberId);
        if (!m || m.crewId !== crewId) fail("NOT_FOUND", "That name isn't in this crew.");
        member = m;
      } else {
        if (!args.hostName) fail("INVALID_STATE", "Enter your name.");
        member = await upsertMember(ctx, crewId, args.hostName, false);
      }

      const sessionId = await ctx.db.insert("sessions", {
        crewId,
        type: "monopoly",
        name: args.name ? cleanName(args.name, "Session name") : undefined,
        code: await uniqueCode(ctx),
        status: "lobby",
        walletMode: "equal",
        startingAmount: 0,
        theme: "inr",
        hostHistory: [],
        nextSeq: 1,
        nextGameNo: 1,
        createdAt: Date.now(),
      });
      const session = (await ctx.db.get(sessionId))!;
      const playerId = await seatPlayer(ctx, session, member, userId, 0);
      await ctx.db.patch(sessionId, {
        hostPlayerId: playerId,
        hostHistory: [{ kind: "create", toPlayerId: playerId, at: Date.now() }],
      });
      const gameId = await insertSetupGame(ctx, sessionId, presetByKey(args.presetKey), DEFAULT_SETTINGS);
      return { sessionId, code: session.code, playerId, gameId };
    });
  },
});

async function requireSetupGame(ctx: MutationCtx, gameId: Id<"mGames">) {
  const game = await ctx.db.get(gameId);
  if (!game) fail("NOT_FOUND", "Game not found.");
  const pc = await requireHost(ctx, game.sessionId);
  if (game.status !== "setup") fail("INVALID_STATE", "The game has already started.");
  return { game, ...pc };
}

export const updateSetup = mutation({
  args: {
    gameId: v.id("mGames"),
    presetKey: v.optional(v.string()),
    startingCash: v.optional(v.number()),
    trackProperties: v.optional(v.boolean()),
    bankerMode: v.optional(v.union(v.literal("selfService"), v.literal("bankerApproves"))),
    bankerSessionPlayerId: v.optional(v.union(v.id("sessionPlayers"), v.null())),
    freeParkingPot: v.optional(v.boolean()),
    doubleOnGo: v.optional(v.boolean()),
    auctions: v.optional(v.boolean()),
    evenBuilding: v.optional(v.boolean()),
    buyIn: v.optional(v.number()),
    split: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    const { game } = await requireSetupGame(ctx, args.gameId);
    let board: BoardConfig = game.boardSnapshot;
    if (args.presetKey !== undefined && args.presetKey !== board.key) {
      if (!PRESETS[args.presetKey]) fail("INVALID_STATE", "Pick a board.");
      board = presetByKey(args.presetKey);
    }
    if (args.startingCash !== undefined) {
      assertAmount(args.startingCash, "Starting cash");
      board = { ...board, startingCash: args.startingCash };
    }
    const s = game.settings;
    const stakes = { buyIn: args.buyIn ?? s.stakes.buyIn, split: args.split ?? s.stakes.split };
    if (args.buyIn !== undefined) assertAmount(args.buyIn, "Buy-in", { allowZero: true });
    if (args.split !== undefined) rules(() => validateSplit(args.split!));
    const settings = {
      trackProperties: args.trackProperties ?? s.trackProperties,
      bankerMode: args.bankerMode ?? s.bankerMode,
      bankerPlayerId: s.bankerPlayerId,
      freeParkingPot: args.freeParkingPot ?? s.freeParkingPot,
      doubleOnGo: args.doubleOnGo ?? s.doubleOnGo,
      auctions: args.auctions ?? s.auctions,
      evenBuilding: args.evenBuilding ?? s.evenBuilding,
      stakes,
    };
    let banker = game.bankerSessionPlayerId;
    if (args.bankerSessionPlayerId !== undefined) banker = args.bankerSessionPlayerId ?? undefined;
    await ctx.db.patch(game._id, {
      boardSnapshot: board,
      settings,
      bankerSessionPlayerId: banker,
      bankHouses: board.houses,
      bankHotels: board.hotels,
    });
    return null;
  },
});

/** Seats everyone who's at the table (or the chosen players), deals starting cash, collects the buy-ins and opens the game. */
export const start = mutation({
  args: { gameId: v.id("mGames"), playerIds: v.optional(v.array(v.id("sessionPlayers"))), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const { userId, game, session, player: host } = await requireSetupGame(ctx, args.gameId);
    return await withIdempotency(ctx, userId, args.idempotencyKey, async () => {
      if (await monoGameInProgress(ctx, session._id)) fail("INVALID_STATE", "A game is already in progress.");
      const seats = await ctx.db
        .query("sessionPlayers")
        .withIndex("by_session", (q) => q.eq("sessionId", session._id))
        .collect();
      const chosen = (args.playerIds ? seats.filter((p) => args.playerIds!.includes(p._id)) : seats.filter((p) => p.status === "active")).sort(
        (a, b) => a.seatNo - b.seatNo,
      );
      if (chosen.some((p) => p.status !== "active")) fail("INVALID_STATE", "Everyone playing must be at the table.");
      if (chosen.length < 2) fail("INVALID_STATE", "Pick at least two players.");
      if (chosen.length > 8) fail("INVALID_STATE", "A game seats up to 8 players.");

      const board = game.boardSnapshot;
      const inserted: { sp: Doc<"sessionPlayers">; id: Id<"mPlayers"> }[] = [];
      for (let i = 0; i < chosen.length; i++) {
        const id = await ctx.db.insert("mPlayers", {
          gameId: game._id,
          sessionId: session._id,
          sessionPlayerId: chosen[i]._id,
          seatOrder: i + 1,
          cash: board.startingCash,
          inJail: false,
          jailTurns: 0,
          jailCards: 0,
          status: "playing",
        });
        inserted.push({ sp: chosen[i], id });
      }
      const banker = inserted.find((p) => p.sp._id === game.bankerSessionPlayerId);
      const settings = { ...game.settings, bankerPlayerId: banker?.id };
      if (settings.bankerMode === "bankerApproves" && !banker) fail("INVALID_STATE", "Choose who the banker is.");
      rules(() => validateSettings(settings, chosen.length));

      if (settings.trackProperties) {
        for (const s of board.spaces) {
          if (s.kind !== "property" && s.kind !== "rail" && s.kind !== "utility") continue;
          await ctx.db.insert("mPropertyStates", { gameId: game._id, spaceId: s.id, ownerPlayerId: null, houses: 0, hotel: false, mortgaged: false });
        }
      }
      if (settings.stakes.buyIn > 0) {
        for (const p of inserted) {
          await applyEntry(ctx, {
            sessionId: session._id,
            mGameId: game._id,
            type: "MONO_BUY_IN",
            fromPlayerId: p.sp._id,
            amount: settings.stakes.buyIn,
            createdByPlayerId: host._id,
          });
        }
      }
      const now = Date.now();
      await ctx.db.patch(game._id, { settings, status: "active", currentTurnPlayerId: inserted[0].id, turnNo: 1, startedAt: now });
      await ctx.db.patch(session._id, { status: "active", startedAt: session.startedAt ?? now });
      return { gameId: game._id };
    });
  },
});

/** After a game was cancelled or ended: a new game in the same session, copying the board and house rules. */
export const newGame = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const { session } = await requireHost(ctx, sessionId);
    if (session.type !== "monopoly") fail("WRONG_SESSION_TYPE", "This isn't a property game.");
    const games = await ctx.db
      .query("mGames")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .take(1);
    const last = games[0];
    if (last && (last.status === "setup" || last.status === "active" || last.status === "paused")) {
      fail("INVALID_STATE", "Finish or cancel the current game first.");
    }
    let banker: Id<"sessionPlayers"> | undefined;
    if (last?.settings.bankerPlayerId) banker = (await ctx.db.get(last.settings.bankerPlayerId))?.sessionPlayerId;
    const { bankerPlayerId: _b, ...rest } = last?.settings ?? DEFAULT_SETTINGS;
    void _b;
    const gameId = await insertSetupGame(ctx, sessionId, last?.boardSnapshot ?? presetByKey("classic"), rest, banker);
    return { gameId };
  },
});

/** Host cancels a game: stakes are refunded, nothing is paid out. */
export const cancelGame = mutation({
  args: { gameId: v.id("mGames"), idempotencyKey: v.string() },
  handler: async (ctx, { gameId, idempotencyKey }) => {
    const game = await ctx.db.get(gameId);
    if (!game) fail("NOT_FOUND", "Game not found.");
    const { userId, player: host } = await requireHost(ctx, game.sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      if (game.status === "ended" || game.status === "cancelled") fail("INVALID_STATE", "That game is already over.");
      const entries = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_session_type", (q) => q.eq("sessionId", game.sessionId).eq("type", "MONO_BUY_IN"))
        .collect();
      for (const e of entries) {
        if (e.mGameId === gameId && !(await findReversal(ctx, e._id))) {
          await reverseEntry(ctx, e, host._id, { meta: { reason: "game_cancelled" } });
        }
      }
      const open = await ctx.db
        .query("mRequests")
        .withIndex("by_game_status", (q) => q.eq("gameId", gameId).eq("status", "pending"))
        .collect();
      for (const r of open) await ctx.db.patch(r._id, { status: "cancelled", respondedAt: Date.now() });
      await ctx.db.patch(gameId, { status: "cancelled", endedAt: Date.now(), currentTurnPlayerId: undefined });
      return null;
    });
  },
});

export const setBanker = mutation({
  args: { gameId: v.id("mGames"), playerId: v.id("mPlayers") },
  handler: async (ctx, { gameId, playerId }) => {
    const game = await ctx.db.get(gameId);
    if (!game) fail("NOT_FOUND", "Game not found.");
    await requireHost(ctx, game.sessionId);
    const p = await ctx.db.get(playerId);
    if (!p || p.gameId !== gameId) fail("NOT_FOUND", "That player isn't in this game.");
    await ctx.db.patch(gameId, { settings: { ...game.settings, bankerPlayerId: playerId } });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------
// Everything the screen renders, in one subscription
// ---------------------------------------------------------------------------------------------

export const state = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const { session, player: me, isHost } = await requirePlayer(ctx, sessionId);
    if (session.type !== "monopoly") fail("WRONG_SESSION_TYPE", "This isn't a property game.");
    const crew = (await ctx.db.get(session.crewId))!;
    const seats = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const latest = await ctx.db
      .query("mGames")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .first();

    let game = null;
    if (latest) {
      const loaded = await loadGame(ctx, latest._id);
      const events = await ctx.db
        .query("mEvents")
        .withIndex("by_game_group", (q) => q.eq("gameId", latest._id))
        .order("desc")
        .take(150);
      const requests = await ctx.db
        .query("mRequests")
        .withIndex("by_game_status", (q) => q.eq("gameId", latest._id).eq("status", "pending"))
        .take(60);
      const mine = loaded.players.find((p) => p.sessionPlayerId === me._id) ?? null;
      game = {
        ...latest,
        players: loaded.players.map((p) => ({ ...p, name: loaded.state.players[p._id].name ?? "A player" })),
        props: loaded.props,
        events,
        requests,
        myPlayerId: mine?._id ?? null,
      };
    }
    return {
      session: {
        _id: session._id,
        code: session.code,
        name: session.name ?? null,
        status: session.status,
        hostPlayerId: session.hostPlayerId,
      },
      crew: { _id: crew._id, name: crew.name },
      meId: me._id,
      isHost,
      seats: seats.map((p) => ({
        _id: p._id,
        name: p.name,
        crewMemberId: p.crewMemberId,
        seatNo: p.seatNo,
        status: p.status,
        rebindPending: isHost && !!p.pendingRebindUserId,
      })),
      game,
    };
  },
});

// ---------------------------------------------------------------------------------------------
// Actions: bank moves, Pass GO, player payments
// ---------------------------------------------------------------------------------------------

const actionV = v.union(
  v.object({ kind: v.literal("passGo"), playerId: v.optional(v.id("mPlayers")), landedExactly: v.optional(v.boolean()), confirmRepeat: v.optional(v.boolean()) }),
  v.object({
    kind: v.literal("bankPay"),
    playerId: v.optional(v.id("mPlayers")),
    amount: v.number(),
    reason: v.union(v.literal("tax"), v.literal("card"), v.literal("bank")),
  }),
  v.object({ kind: v.literal("bankCollect"), playerId: v.optional(v.id("mPlayers")), amount: v.number() }),
  v.object({ kind: v.literal("collectPot"), playerId: v.optional(v.id("mPlayers")) }),
  v.object({ kind: v.literal("pay"), toPlayerId: v.id("mPlayers"), amount: v.number() }),
);
type Action = Infer<typeof actionV>;

const isBankFacing = (a: Action) => a.kind !== "pay";

/** Builds and validates the events for an action against the current state, without writing anything. */
function planAction(loaded: Awaited<ReturnType<typeof loadGame>>, actor: Id<"mPlayers"> | null, action: Action, opts: { skipRepeatCheck?: boolean } = {}) {
  const { state, players, game } = loaded;
  const target = (("playerId" in action && action.playerId) || actor) as string | null;
  if (!target) fail("INVALID_STATE", "Pick a player.");
  let plan: Plan;
  switch (action.kind) {
    case "passGo": {
      const mp = players.find((p) => p._id === target);
      if (!opts.skipRepeatCheck && mp?.lastPassGoTurn === game.turnNo && !action.confirmRepeat) {
        fail("NEEDS_CONFIRM", `${state.players[target]?.name ?? "That player"} already collected GO this turn. Collect again?`);
      }
      plan = rules(() => planPassGo(state, target, { landedExactly: action.landedExactly }));
      // Remember the turn so undo can clear the "already collected" warning.
      for (const e of plan.events) if (e.type === "PAY" && e.meta) e.meta.turnNo = game.turnNo;
      break;
    }
    case "bankPay":
      assertAmount(action.amount, "Amount");
      plan = rules(() => planPayBank(state, target, action.amount, action.reason));
      break;
    case "bankCollect":
      assertAmount(action.amount, "Amount");
      plan = rules(() => planBankCollect(state, target, action.amount, "bank"));
      break;
    case "collectPot":
      plan = rules(() => planCollectPot(state, target));
      break;
    case "pay": {
      if (!actor) fail("INVALID_STATE", "Only players can pay each other.");
      assertAmount(action.amount, "Amount");
      plan = rules(() => planPlayerPay(state, actor, action.toPlayerId, action.amount));
      break;
    }
  }
  const label = describeGroup(plan.events, { board: state.board, name: (id) => state.players[id]?.name ?? "A player" });
  return { plan, label, target };
}

async function sessionPlayerOf(ctx: MutationCtx, playerId: Id<"mPlayers">) {
  return (await ctx.db.get(playerId))!.sessionPlayerId;
}

/** Applies an action now. `by` is the session player it's recorded against. */
async function executeAction(
  ctx: MutationCtx,
  gameId: Id<"mGames">,
  by: Id<"sessionPlayers">,
  actor: Id<"mPlayers"> | null,
  action: Action,
  extra: { idempotencyKey?: string; fromApproval?: boolean } = {},
) {
  const loaded = await loadGame(ctx, gameId);
  requireLive(loaded.game);
  const { plan, label, target } = planAction(loaded, actor, action, { skipRepeatCheck: extra.fromApproval });
  const result = await applyMonopolyGroup(ctx, { loaded, events: plan.events, by, label, idempotencyKey: extra.idempotencyKey });
  if (action.kind === "passGo") await ctx.db.patch(target as Id<"mPlayers">, { lastPassGoTurn: loaded.game.turnNo });
  return { groupId: result.groupId, label };
}

/**
 * Pass GO, collect from or pay the bank, collect the pot, or pay another player. In banker mode a player's bank move
 * waits for the banker (the banker's own go to the host); everything else happens at once. A player moves their own
 * money; the host or banker can act for anyone.
 */
export const perform = mutation({
  args: { gameId: v.id("mGames"), action: actionV, idempotencyKey: v.string() },
  handler: async (ctx, { gameId, action, idempotencyKey }) => {
    const game = await ctx.db.get(gameId);
    if (!game) fail("NOT_FOUND", "Game not found.");
    const { userId, player: sp, isHost } = await requireActivePlayer(ctx, game.sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      requireLive(game);
      const me = await myMonoPlayer(ctx, gameId, sp._id);
      if (me && me.status !== "playing") fail("INVALID_STATE", "You're out of this game.");
      const isBanker = !!me && game.settings.bankerPlayerId === me._id;
      const targetId = ("playerId" in action && action.playerId) || me?._id;
      if (!targetId) fail("FORBIDDEN", "You're watching this game. Ask the host to act for you.");
      if (me?._id !== targetId && !(isHost || isBanker)) fail("FORBIDDEN", "You can only move your own money.");
      if (action.kind === "pay" && !me) fail("FORBIDDEN", "You're not playing in this game.");

      const loaded = await loadGame(ctx, gameId);
      const needsApproval = game.settings.bankerMode === "bankerApproves" && isBankFacing(action) && !isHost;
      if (!needsApproval) {
        const done = await executeAction(ctx, gameId, sp._id, me?._id ?? null, action, { idempotencyKey });
        return { status: "done" as const, groupId: done.groupId, requestId: null };
      }

      // Validate now so a doomed request fails on the spot, then queue it for the banker (or the host, if I'm the banker).
      const { label } = planAction(loaded, me?._id ?? null, action);
      let approver: Id<"mPlayers"> | undefined;
      if (isBanker) {
        const hostSeat = (await ctx.db.get(game.sessionId))!.hostPlayerId;
        approver = (await myMonoPlayerBySession(ctx, gameId, hostSeat))?._id;
      } else {
        approver = game.settings.bankerPlayerId;
      }
      const now = Date.now();
      const requestId = await ctx.db.insert("mRequests", {
        sessionId: game.sessionId,
        gameId,
        kind: "approval",
        status: "pending",
        fromPlayerId: me?._id ?? (targetId as Id<"mPlayers">),
        toPlayerId: approver,
        amount: "amount" in action ? action.amount : undefined,
        payload: { action, label, actingFor: targetId },
        createdAt: now,
        expiresAt: now + REQUEST_TTL_MS,
      });
      const scheduledId = await ctx.scheduler.runAfter(REQUEST_TTL_MS, internal.mono.expireRequest, { requestId });
      await ctx.db.patch(requestId, { scheduledId });
      return { status: "pending" as const, groupId: null, requestId };
    });
  },
});

async function myMonoPlayerBySession(ctx: MutationCtx, gameId: Id<"mGames">, sessionPlayerId: Id<"sessionPlayers"> | undefined) {
  return sessionPlayerId ? await myMonoPlayer(ctx, gameId, sessionPlayerId) : null;
}

/** "Priya requests $200 from you": the receiver asks, the payer answers. Nothing moves until they accept. */
export const requestPayment = mutation({
  args: { gameId: v.id("mGames"), fromPlayerId: v.id("mPlayers"), amount: v.number(), note: v.optional(v.string()), idempotencyKey: v.string() },
  handler: async (ctx, { gameId, fromPlayerId, amount, note, idempotencyKey }) => {
    const game = await ctx.db.get(gameId);
    if (!game) fail("NOT_FOUND", "Game not found.");
    const { userId, player: sp } = await requireActivePlayer(ctx, game.sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      requireLive(game);
      assertAmount(amount, "Amount");
      const me = await myMonoPlayer(ctx, gameId, sp._id);
      if (!me || me.status !== "playing") fail("FORBIDDEN", "You're not playing in this game.");
      const payer = await ctx.db.get(fromPlayerId);
      if (!payer || payer.gameId !== gameId || payer.status !== "playing") fail("NOT_FOUND", "That player isn't in this game.");
      if (payer._id === me._id) fail("INVALID_STATE", "You can't request money from yourself.");
      const now = Date.now();
      const requestId = await ctx.db.insert("mRequests", {
        sessionId: game.sessionId,
        gameId,
        kind: "payment",
        status: "pending",
        fromPlayerId: me._id,
        toPlayerId: payer._id,
        amount,
        payload: note ? { note: note.slice(0, 60) } : undefined,
        createdAt: now,
        expiresAt: now + REQUEST_TTL_MS,
      });
      const scheduledId = await ctx.scheduler.runAfter(REQUEST_TTL_MS, internal.mono.expireRequest, { requestId });
      await ctx.db.patch(requestId, { scheduledId });
      return { requestId };
    });
  },
});

/** The payer accepts or declines a payment request; the banker (or the host) accepts or declines a queued bank move. */
export const respond = mutation({
  args: { requestId: v.id("mRequests"), accept: v.boolean(), idempotencyKey: v.string() },
  handler: async (ctx, { requestId, accept, idempotencyKey }) => {
    const req = await ctx.db.get(requestId);
    if (!req) fail("NOT_FOUND", "Request not found.");
    const { userId, player: sp, isHost } = await requireActivePlayer(ctx, req.sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      const game = await ctx.db.get(req.gameId);
      if (!game) fail("NOT_FOUND", "Game not found.");
      if (req.status !== "pending") fail("INVALID_STATE", `This request was ${req.status === "accepted" ? "already answered" : req.status}.`);
      const now = Date.now();
      if (req.expiresAt <= now) {
        await ctx.db.patch(requestId, { status: "expired", respondedAt: now });
        fail("INVALID_STATE", "This request expired.");
      }
      const me = await myMonoPlayer(ctx, req.gameId, sp._id);
      const isTarget = !!me && req.toPlayerId === me._id;
      const isRequester = !!me && req.fromPlayerId === me._id;

      if (req.kind === "payment") {
        if (!isTarget) fail("FORBIDDEN", "Only the person being asked can answer.");
        if (!accept) {
          await ctx.db.patch(requestId, { status: "declined", respondedAt: now });
          return { accepted: false, groupId: null };
        }
        const done = await executeAction(ctx, req.gameId, sp._id, me!._id, { kind: "pay", toPlayerId: req.fromPlayerId, amount: req.amount! }, { idempotencyKey });
        await ctx.db.patch(requestId, { status: "accepted", respondedAt: now, resultGroupId: done.groupId });
        return { accepted: true, groupId: done.groupId };
      }

      if (req.kind === "approval") {
        if (!accept) {
          if (!(isTarget || isHost || isRequester)) fail("FORBIDDEN", "Only the banker or host can answer.");
          await ctx.db.patch(requestId, { status: isRequester && !isTarget && !isHost ? "cancelled" : "declined", respondedAt: now });
          return { accepted: false, groupId: null };
        }
        if (!(isTarget || isHost)) fail("FORBIDDEN", "Only the banker or host can approve.");
        const payload = req.payload as { action: Action; label: string };
        const requesterSp = await sessionPlayerOf(ctx, req.fromPlayerId);
        // Run it as the requester, re-checked against the game as it is now.
        const done = await executeAction(ctx, req.gameId, requesterSp, req.fromPlayerId, payload.action, { idempotencyKey, fromApproval: true });
        await ctx.db.patch(requestId, { status: "accepted", respondedAt: now, resultGroupId: done.groupId });
        return { accepted: true, groupId: done.groupId };
      }
      fail("INVALID_STATE", "That kind of request isn't supported yet.");
    });
  },
});

/** The person who made a request withdraws it. */
export const cancelRequest = mutation({
  args: { requestId: v.id("mRequests") },
  handler: async (ctx, { requestId }) => {
    const req = await ctx.db.get(requestId);
    if (!req) fail("NOT_FOUND", "Request not found.");
    const { player: sp } = await requireActivePlayer(ctx, req.sessionId);
    if (req.status !== "pending") return null;
    const me = await myMonoPlayer(ctx, req.gameId, sp._id);
    if (!me || me._id !== req.fromPlayerId) fail("FORBIDDEN", "Only the person who asked can withdraw it.");
    await ctx.db.patch(requestId, { status: "cancelled", respondedAt: Date.now() });
    return null;
  },
});

/** Scheduled when a request is made; closes it if nobody answered in time. */
export const expireRequest = internalMutation({
  args: { requestId: v.id("mRequests") },
  handler: async (ctx, { requestId }) => {
    const req = await ctx.db.get(requestId);
    if (!req || req.status !== "pending") return null;
    if (req.expiresAt > Date.now()) return null;
    await ctx.db.patch(requestId, { status: "expired", respondedAt: Date.now() });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------
// Turns and undo
// ---------------------------------------------------------------------------------------------

/** The player whose turn it is taps End turn; the host can end anyone's. */
export const endTurn = mutation({
  args: { gameId: v.id("mGames") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    if (!game) fail("NOT_FOUND", "Game not found.");
    const { player: sp, isHost } = await requireActivePlayer(ctx, game.sessionId);
    requireLive(game);
    const me = await myMonoPlayer(ctx, gameId, sp._id);
    const current = game.currentTurnPlayerId;
    if (!current) fail("INVALID_STATE", "Nobody's turn is in progress.");
    if (!isHost && me?._id !== current) {
      const holder = await ctx.db.get(current);
      fail("NOT_YOUR_TURN", `It's ${(holder && (await ctx.db.get(holder.sessionPlayerId)))?.name ?? "someone else"}'s turn.`);
    }
    const loaded = await loadGame(ctx, gameId);
    const next = nextPlayer(loaded.state, current);
    if (!next) fail("INVALID_STATE", "There's nobody to hand the turn to.");
    const groupNo = game.nextGroupNo;
    await ctx.db.patch(gameId, { currentTurnPlayerId: next as Id<"mPlayers">, turnNo: game.turnNo + 1, nextGroupNo: groupNo + 1 });
    await ctx.db.insert("mEvents", {
      sessionId: game.sessionId,
      gameId,
      groupId: `${gameId}:${groupNo}`,
      groupNo,
      type: "TURN",
      meta: { from: current, to: next, turnNo: game.turnNo + 1 },
      label: `${loaded.state.players[current]?.name ?? "A player"} ended their turn`,
      createdBy: sp._id,
      createdAt: Date.now(),
    });
    return null;
  },
});

/** Host undo of a whole action. Refused, with the blocking action named, if something later touched the same money or deeds. */
export const undo = mutation({
  args: { gameId: v.id("mGames"), groupId: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, { gameId, groupId, idempotencyKey }) => {
    const game = await ctx.db.get(gameId);
    if (!game) fail("NOT_FOUND", "Game not found.");
    const { userId, player: host } = await requireHost(ctx, game.sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      if (game.status !== "active" && game.status !== "paused") fail("INVALID_STATE", "That game isn't in progress.");
      const groups = await loadGroups(ctx, gameId);
      const verdict = checkUndo(groups, groupId);
      if (!verdict.ok) fail(verdict.code === "BLOCKED" ? "NOT_UNDOABLE" : verdict.code, verdict.reason);
      const target = groups.find((g) => g.groupId === groupId)!;
      const events: MEvent[] = invertEvents(target.events);
      const loaded = await loadGame(ctx, gameId);
      const result = await applyMonopolyGroup(ctx, {
        loaded,
        events,
        by: host._id,
        label: `Undo: ${target.label}`,
        idempotencyKey,
        reversesGroupId: groupId,
      });
      // An undone Pass GO no longer counts as "collected this turn".
      for (const e of target.events) {
        if (e.type === "PAY" && e.meta?.reason === "pass_go" && typeof e.meta.turnNo === "number") {
          const mp = loaded.players.find((p) => p._id === e.toParty);
          if (mp && mp.lastPassGoTurn === e.meta.turnNo) await ctx.db.patch(mp._id, { lastPassGoTurn: undefined });
        }
      }
      return { groupId: result.groupId };
    });
  },
});

/** Replays the game's whole event log against its projections (see lib/monopoly gameViolations). Empty = healthy. */
export async function checkGameInvariants(ctx: QueryCtx, gameId: Id<"mGames">) {
  const loaded = await loadGame(ctx, gameId);
  const rows = await ctx.db
    .query("mEvents")
    .withIndex("by_game_group", (q) => q.eq("gameId", gameId))
    .take(20000);
  const events = rows.filter((r) => r.type !== "TURN").map(rowToEvent);
  const violations = gameViolations(loaded.state, events);
  // Every group's id and number must be unique and increasing.
  let last = 0;
  for (const r of rows) {
    if (r.groupNo < last) violations.push(`group numbers go backwards at ${r.groupId}`);
    last = r.groupNo;
  }
  return { violations, state: loaded.state, eventCount: events.length };
}

export const assertGameInvariants = internalQuery({
  args: { gameId: v.id("mGames") },
  handler: async (ctx, { gameId }) => {
    const result = await checkGameInvariants(ctx, gameId);
    if (result.violations.length) throw new Error(`Monopoly invariant violations:\n${result.violations.join("\n")}`);
    return result;
  },
});
