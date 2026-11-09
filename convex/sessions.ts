import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { insertCrew, upsertMember } from "./crews";
import {
  getPlayerInSession,
  grantCrewAccess,
  requireCrewAccess,
  requireActivePlayer,
  requireHost,
  requirePlayer,
  requireUser,
} from "./lib/access";
import { fail } from "./lib/errors";
import { activeGameOf, participantsOf } from "./lib/game";
import { applyEntry, findReversal, reverseEntry, withIdempotency } from "./lib/ledger";
import { computeNets } from "./lib/nets";
import { assertAmount, cleanName, normalizeName } from "./lib/validators";
import { moneyTheme, walletMode } from "./schema";

// No 0/O or 1/I so codes read cleanly off a phone across the table.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

async function uniqueCode(ctx: MutationCtx) {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = "";
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    const clash = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (!clash) return code;
  }
  fail("INVALID_STATE", "Couldn't generate a room code. Try again.");
}

export function normalizeCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function sessionByCode(ctx: { db: MutationCtx["db"] }, code: string) {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_code", (q) => q.eq("code", normalizeCode(code)))
    .unique();
  if (!session) fail("NOT_FOUND", "No table with that code.");
  return session;
}

function buyInFor(session: Doc<"sessions">, requested: number | undefined) {
  if (session.walletMode === "equal") return session.startingAmount;
  if (requested === undefined) fail("INVALID_AMOUNT", "Choose your buy-in.");
  assertAmount(requested, "Buy-in");
  return requested;
}

/** Seats a crew member on this device, or reseats them after a cash-out. One device = one player per session. */
async function seatPlayer(
  ctx: MutationCtx,
  session: Doc<"sessions">,
  member: Doc<"crewMembers">,
  userId: Id<"users">,
  buyIn: number,
) {
  const mySeat = await ctx.db
    .query("sessionPlayers")
    .withIndex("by_session_user", (q) => q.eq("sessionId", session._id).eq("userId", userId))
    .unique();
  if (mySeat && mySeat.crewMemberId !== member._id) {
    fail("FORBIDDEN", `This phone is already playing as ${mySeat.name} in this session.`);
  }
  const existing = await ctx.db
    .query("sessionPlayers")
    .withIndex("by_session_member", (q) => q.eq("sessionId", session._id).eq("crewMemberId", member._id))
    .unique();

  let playerId: Id<"sessionPlayers">;
  if (existing) {
    if (existing.userId !== userId) {
      fail(
        "NAME_TAKEN",
        `${existing.name} is already at the table on another phone. Ask the host to move them to this phone.`,
      );
    }
    if (existing.status === "active") return existing._id;
    // Rejoining after a cash-out: same seat, fresh buy-in.
    await ctx.db.patch(existing._id, { status: "active" });
    playerId = existing._id;
  } else {
    const last = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .order("desc")
      .first();
    playerId = await ctx.db.insert("sessionPlayers", {
      sessionId: session._id,
      crewMemberId: member._id,
      name: member.name,
      userId,
      seatNo: (last?.seatNo ?? 0) + 1,
      status: "active",
      joinedAt: Date.now(),
    });
    await ctx.db.insert("wallets", { sessionId: session._id, sessionPlayerId: playerId, balance: 0 });
    await ctx.db.insert("presence", { sessionId: session._id, sessionPlayerId: playerId, lastSeenAt: Date.now() });
  }
  await applyEntry(ctx, {
    sessionId: session._id,
    type: "BUY_IN",
    toPlayerId: playerId,
    amount: buyIn,
    createdByPlayerId: playerId,
  });
  await grantCrewAccess(ctx, session.crewId, userId);
  return playerId;
}

export const create = mutation({
  args: {
    crewId: v.optional(v.id("crews")),
    newCrewName: v.optional(v.string()),
    name: v.optional(v.string()),
    hostMemberId: v.optional(v.id("crewMembers")),
    hostName: v.optional(v.string()),
    walletMode,
    startingAmount: v.number(),
    hostBuyIn: v.optional(v.number()),
    theme: moneyTheme,
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return await withIdempotency(ctx, userId, args.idempotencyKey, async () => {
      assertAmount(args.startingAmount, "Starting amount");
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
        name: args.name ? cleanName(args.name, "Session name") : undefined,
        code: await uniqueCode(ctx),
        status: "lobby",
        walletMode: args.walletMode,
        startingAmount: args.startingAmount,
        theme: args.theme,
        hostHistory: [],
        nextSeq: 1,
        nextGameNo: 1,
        createdAt: Date.now(),
      });
      const session = (await ctx.db.get(sessionId))!;
      const playerId = await seatPlayer(ctx, session, member, userId, buyInFor(session, args.hostBuyIn));
      await ctx.db.patch(sessionId, {
        hostPlayerId: playerId,
        hostHistory: [{ kind: "create", toPlayerId: playerId, at: Date.now() }],
      });
      return { sessionId, code: session.code, playerId };
    });
  },
});

/** What the join screen needs before the caller has a seat. The room code is the secret. */
export const joinInfo = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await requireUser(ctx);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", normalizeCode(code)))
      .unique();
    if (!session) return null;
    const crew = (await ctx.db.get(session.crewId))!;
    const members = await ctx.db
      .query("crewMembers")
      .withIndex("by_crew", (q) => q.eq("crewId", session.crewId))
      .collect();
    const players = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    const host = players.find((p) => p._id === session.hostPlayerId);
    const mine = players.find((p) => p.userId === userId);
    return {
      sessionId: session._id,
      code: session.code,
      status: session.status,
      crewId: crew._id,
      crewName: crew.name,
      sessionName: session.name ?? null,
      hostName: host?.name ?? null,
      walletMode: session.walletMode,
      startingAmount: session.startingAmount,
      myPlayerId: mine?._id ?? null,
      myStatus: mine?.status ?? null,
      members: members
        .map((m) => {
          const p = players.find((x) => x.crewMemberId === m._id);
          return {
            _id: m._id,
            name: m.name,
            atTable: p?.status === "active",
            onThisPhone: p?.userId === userId,
            rebindPending: p?.pendingRebindUserId === userId,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  },
});

export const join = mutation({
  args: {
    code: v.string(),
    crewMemberId: v.optional(v.id("crewMembers")),
    newName: v.optional(v.string()),
    buyIn: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return await withIdempotency(ctx, userId, args.idempotencyKey, async () => {
      const session = await sessionByCode(ctx, args.code);
      if (session.status === "ended") fail("INVALID_STATE", "This session has ended.");
      let member: Doc<"crewMembers">;
      if (args.crewMemberId) {
        const m = await ctx.db.get(args.crewMemberId);
        if (!m || m.crewId !== session.crewId) fail("NOT_FOUND", "That name isn't in this crew.");
        member = m;
      } else {
        if (!args.newName) fail("INVALID_STATE", "Pick your name or add a new one.");
        member = await upsertMember(ctx, session.crewId, args.newName, true);
      }
      const playerId = await seatPlayer(ctx, session, member, userId, buyInFor(session, args.buyIn));
      return { sessionId: session._id, playerId };
    });
  },
});

/** A new phone asks to take over a seat that's bound to another device. The host approves. */
export const requestRebind = mutation({
  args: { code: v.string(), crewMemberId: v.id("crewMembers") },
  handler: async (ctx, { code, crewMemberId }) => {
    const userId = await requireUser(ctx);
    const session = await sessionByCode(ctx, code);
    if (session.status === "ended") fail("INVALID_STATE", "This session has ended.");
    const mySeat = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_session_user", (q) => q.eq("sessionId", session._id).eq("userId", userId))
      .unique();
    if (mySeat) fail("FORBIDDEN", `This phone is already playing as ${mySeat.name}.`);
    const player = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_session_member", (q) => q.eq("sessionId", session._id).eq("crewMemberId", crewMemberId))
      .unique();
    if (!player) fail("NOT_FOUND", "That player isn't at this table.");
    await ctx.db.patch(player._id, { pendingRebindUserId: userId });
  },
});

export const approveRebind = mutation({
  args: { sessionId: v.id("sessions"), playerId: v.id("sessionPlayers"), approve: v.boolean() },
  handler: async (ctx, { sessionId, playerId, approve }) => {
    await requireHost(ctx, sessionId);
    const player = await getPlayerInSession(ctx, sessionId, playerId);
    const newUserId = player.pendingRebindUserId;
    if (!newUserId) fail("INVALID_STATE", "No device change is pending for that player.");
    if (!approve) {
      await ctx.db.patch(playerId, { pendingRebindUserId: undefined });
      return;
    }
    const clash = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_session_user", (q) => q.eq("sessionId", sessionId).eq("userId", newUserId))
      .unique();
    if (clash) fail("FORBIDDEN", `That phone is already playing as ${clash.name}.`);
    await ctx.db.patch(playerId, { userId: newUserId, pendingRebindUserId: undefined });
    const session = (await ctx.db.get(sessionId))!;
    await grantCrewAccess(ctx, session.crewId, newUserId);
  },
});

async function liveBuyIns(ctx: MutationCtx, sessionId: Id<"sessions">, playerId: Id<"sessionPlayers">) {
  const entries = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_session_type", (q) => q.eq("sessionId", sessionId).eq("type", "BUY_IN"))
    .collect();
  const mine = entries.filter((e) => e.toPlayerId === playerId);
  const live = [];
  for (const e of mine) if (!(await findReversal(ctx, e._id))) live.push(e);
  return live;
}

/**
 * Before the first game, the host may change a buy-in. The ledger stays append-only:
 * the old BUY_IN is reversed and a new one is written.
 */
async function rebuy(
  ctx: MutationCtx,
  session: Doc<"sessions">,
  playerId: Id<"sessionPlayers">,
  amount: number,
  hostId: Id<"sessionPlayers">,
) {
  const live = await liveBuyIns(ctx, session._id, playerId);
  if (live.reduce((s, e) => s + e.amount, 0) === amount) return;
  for (const e of live) await reverseEntry(ctx, e, hostId, { meta: { reason: "buy_in_edit" } });
  await applyEntry(ctx, {
    sessionId: session._id,
    type: "BUY_IN",
    toPlayerId: playerId,
    amount,
    createdByPlayerId: hostId,
    meta: { reason: "buy_in_edit" },
  });
}

function assertNoGamesYet(session: Doc<"sessions">) {
  if (session.nextGameNo !== 1) fail("INVALID_STATE", "Buy-ins are locked once the first game has started.");
}

export const updateSettings = mutation({
  args: {
    sessionId: v.id("sessions"),
    name: v.optional(v.string()),
    walletMode: v.optional(walletMode),
    startingAmount: v.optional(v.number()),
    theme: v.optional(moneyTheme),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, session, player } = await requireHost(ctx, args.sessionId);
    return await withIdempotency(ctx, userId, args.idempotencyKey, async () => {
      if (args.theme) await ctx.db.patch(session._id, { theme: args.theme });
      if (args.name !== undefined) await ctx.db.patch(session._id, { name: cleanName(args.name, "Session name") });
      const modeChanged = args.walletMode !== undefined && args.walletMode !== session.walletMode;
      const amountChanged = args.startingAmount !== undefined && args.startingAmount !== session.startingAmount;
      if (!modeChanged && !amountChanged) return null;

      assertNoGamesYet(session);
      const mode = args.walletMode ?? session.walletMode;
      const amount = args.startingAmount ?? session.startingAmount;
      assertAmount(amount, "Starting amount");
      await ctx.db.patch(session._id, { walletMode: mode, startingAmount: amount });
      if (mode === "equal") {
        const players = await ctx.db
          .query("sessionPlayers")
          .withIndex("by_session", (q) => q.eq("sessionId", session._id))
          .collect();
        for (const p of players) if (p.status === "active") await rebuy(ctx, session, p._id, amount, player._id);
      }
      return null;
    });
  },
});

export const setPlayerBuyIn = mutation({
  args: {
    sessionId: v.id("sessions"),
    playerId: v.id("sessionPlayers"),
    amount: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, session, player } = await requireHost(ctx, args.sessionId);
    return await withIdempotency(ctx, userId, args.idempotencyKey, async () => {
      assertNoGamesYet(session);
      if (session.walletMode !== "custom") fail("INVALID_STATE", "Buy-ins are equal for everyone in this session.");
      assertAmount(args.amount, "Buy-in");
      const target = await getPlayerInSession(ctx, session._id, args.playerId);
      if (target.status !== "active") fail("INVALID_STATE", `${target.name} has cashed out.`);
      await rebuy(ctx, session, target._id, args.amount, player._id);
      return null;
    });
  },
});

/** "Change my name" in the lobby. Renames the crew member, and this session's seat. Past reports keep the old name. */
export const renameMe = mutation({
  args: { sessionId: v.id("sessions"), name: v.string() },
  handler: async (ctx, { sessionId, name: rawName }) => {
    const { session, player } = await requireActivePlayer(ctx, sessionId);
    if (session.status !== "lobby") fail("INVALID_STATE", "You can change your name before the first game starts.");
    const name = cleanName(rawName);
    const nameNormalized = normalizeName(name);
    const member = (await ctx.db.get(player.crewMemberId))!;
    if (member.nameNormalized !== nameNormalized) {
      const clash = await ctx.db
        .query("crewMembers")
        .withIndex("by_crew_name", (q) => q.eq("crewId", session.crewId).eq("nameNormalized", nameNormalized))
        .unique();
      if (clash) fail("NAME_TAKEN", `${clash.name} is already in this crew.`);
    }
    await ctx.db.patch(member._id, { name, nameNormalized });
    await ctx.db.patch(player._id, { name });
    return null;
  },
});

export const reorderSeats = mutation({
  args: { sessionId: v.id("sessions"), order: v.array(v.id("sessionPlayers")) },
  handler: async (ctx, { sessionId, order }) => {
    await requireHost(ctx, sessionId);
    if (await activeGameOf(ctx, sessionId)) fail("INVALID_STATE", "Seats can't move during a game.");
    const players = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const ids = new Set(players.map((p) => p._id));
    if (order.length !== ids.size || !order.every((id) => ids.has(id)) || new Set(order).size !== order.length) {
      fail("INVALID_STATE", "Seat order must list every player once.");
    }
    for (let i = 0; i < order.length; i++) await ctx.db.patch(order[i], { seatNo: i + 1 });
  },
});

export const end = mutation({
  args: { sessionId: v.id("sessions"), idempotencyKey: v.string() },
  handler: async (ctx, { sessionId, idempotencyKey }) => {
    const { userId, session } = await requireHost(ctx, sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      if (await activeGameOf(ctx, sessionId)) fail("INVALID_STATE", "End or cancel the current game first.");
      const now = Date.now();
      const loans = await ctx.db
        .query("loans")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .collect();
      for (const l of loans) {
        if (l.status === "requested") await ctx.db.patch(l._id, { status: "declined", closedAt: now, meta: { reason: "session_ended" } });
      }
      await ctx.db.patch(sessionId, { status: "ended", endedAt: now });

      const nets = await computeNets(ctx, sessionId);
      const games = await ctx.db
        .query("games")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .collect();
      const payouts = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_session_type", (q) => q.eq("sessionId", sessionId).eq("type", "PAYOUT"))
        .collect();
      for (const row of nets) {
        let biggestPayout = 0;
        for (const p of payouts) {
          if (p.toPlayerId === row.playerId && p.amount > biggestPayout && !(await findReversal(ctx, p._id))) {
            biggestPayout = p.amount;
          }
        }
        await ctx.db.insert("playerSessionSummaries", {
          crewId: session.crewId,
          crewMemberId: row.crewMemberId,
          sessionId,
          sessionPlayerId: row.playerId,
          endedAt: now,
          net: row.net,
          buyIn: row.buyIn,
          topUps: row.topUps,
          gamesWon: games.filter((g) => g.status === "ended" && g.winnerPlayerIds?.includes(row.playerId)).length,
          biggestPayout,
        });
      }
      return null;
    });
  },
});

/** Everything the lobby and game table render, in one subscription. */
export const state = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const { session, player: me, isHost } = await requirePlayer(ctx, sessionId);
    const players = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const wallets = await ctx.db
      .query("wallets")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const crew = (await ctx.db.get(session.crewId))!;
    const templates = (
      await ctx.db
        .query("gameTemplates")
        .withIndex("by_crew", (q) => q.eq("crewId", session.crewId))
        .collect()
    ).filter((t) => !t.archived);
    const latestGame = await ctx.db
      .query("games")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .first();
    const participants = latestGame ? await participantsOf(ctx, latestGame._id) : [];
    const recentEntries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_session_seq", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .take(30);
    const loans = (
      await ctx.db
        .query("loans")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .collect()
    ).filter((l) => l.lenderPlayerId === me._id || l.borrowerPlayerId === me._id);

    return {
      session: {
        _id: session._id,
        code: session.code,
        name: session.name ?? null,
        status: session.status,
        walletMode: session.walletMode,
        startingAmount: session.startingAmount,
        theme: session.theme,
        hostPlayerId: session.hostPlayerId,
        gamesStarted: session.nextGameNo - 1,
        createdAt: session.createdAt,
        startedAt: session.startedAt ?? null,
        endedAt: session.endedAt ?? null,
      },
      crew: { _id: crew._id, name: crew.name },
      meId: me._id,
      isHost,
      players: players.map((p) => ({
        _id: p._id,
        name: p.name,
        crewMemberId: p.crewMemberId,
        seatNo: p.seatNo,
        status: p.status,
        balance: wallets.find((w) => w.sessionPlayerId === p._id)?.balance ?? 0,
        rebindPending: isHost && !!p.pendingRebindUserId,
      })),
      templates,
      latestGame: latestGame ? { ...latestGame, participants } : null,
      recentEntries,
      myLoans: loans,
    };
  },
});

/** The full feed, newest first, paginated. Optionally one game only. */
export const feed = query({
  args: { sessionId: v.id("sessions"), gameId: v.optional(v.id("games")), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { sessionId, gameId, paginationOpts }) => {
    await requirePlayer(ctx, sessionId);
    if (gameId) {
      const game = await ctx.db.get(gameId);
      if (!game || game.sessionId !== sessionId) fail("NOT_FOUND", "Game not found.");
      return await ctx.db
        .query("ledgerEntries")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .order("desc")
        .paginate(paginationOpts);
    }
    return await ctx.db
      .query("ledgerEntries")
      .withIndex("by_session_seq", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .paginate(paginationOpts);
  },
});

/** Home screen: this device's sessions, newest first. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const seats = await ctx.db
      .query("sessionPlayers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
    const rows = await Promise.all(
      seats.map(async (seat) => {
        const session = await ctx.db.get(seat.sessionId);
        if (!session) return null;
        const crew = await ctx.db.get(session.crewId);
        const summary =
          session.status === "ended"
            ? await ctx.db
                .query("playerSessionSummaries")
                .withIndex("by_session", (q) => q.eq("sessionId", session._id))
                .filter((q) => q.eq(q.field("sessionPlayerId"), seat._id))
                .first()
            : null;
        return {
          sessionId: session._id,
          code: session.code,
          name: session.name ?? null,
          crewName: crew?.name ?? "",
          status: session.status,
          createdAt: session.createdAt,
          endedAt: session.endedAt ?? null,
          myName: seat.name,
          myNet: summary?.net ?? null,
        };
      }),
    );
    return rows.filter((r) => r !== null);
  },
});
