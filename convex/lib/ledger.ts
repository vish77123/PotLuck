import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { fail } from "./errors";
import { formatInr } from "./validators";

export type EntryType = Doc<"ledgerEntries">["type"];

export type EntryInput = {
  sessionId: Id<"sessions">;
  type: EntryType;
  amount: number;
  createdByPlayerId: Id<"sessionPlayers">;
  gameId?: Id<"games">;
  loanId?: Id<"loans">;
  fromPlayerId?: Id<"sessionPlayers">;
  toPlayerId?: Id<"sessionPlayers">;
  fromPool?: boolean;
  toPool?: boolean;
  reversesEntryId?: Id<"ledgerEntries">;
  reversesType?: EntryType;
  meta?: Record<string, unknown>;
  idempotencyKey?: string;
};

// Which side of each entry type touches a player wallet, the pool, or the outside world (cash).
const SHAPES: Record<Exclude<EntryType, "REVERSAL">, { from: "player" | "pool" | "outside"; to: "player" | "pool" | "outside" }> = {
  BUY_IN: { from: "outside", to: "player" },
  TOP_UP: { from: "outside", to: "player" },
  BOOT: { from: "player", to: "pool" },
  BET: { from: "player", to: "pool" },
  PAYOUT: { from: "pool", to: "player" },
  LOAN: { from: "player", to: "player" },
  LOAN_REPAYMENT: { from: "player", to: "player" },
  CASH_OUT: { from: "player", to: "outside" },
};

function sideOf(playerId: Id<"sessionPlayers"> | undefined, pool: boolean | undefined) {
  if (playerId && pool) return "invalid";
  return playerId ? "player" : pool ? "pool" : "outside";
}

async function walletOf(ctx: MutationCtx, playerId: Id<"sessionPlayers">) {
  const wallet = await ctx.db
    .query("wallets")
    .withIndex("by_player", (q) => q.eq("sessionPlayerId", playerId))
    .unique();
  if (!wallet) fail("NOT_FOUND", "Wallet not found.");
  return wallet;
}

/**
 * The only code that writes ledgerEntries. Validates the entry's shape, moves money between
 * the wallet/pool projections, and refuses anything that would take a balance below 0.
 * Runs inside the caller's mutation, so it's atomic with everything else the caller does.
 */
export async function applyEntry(ctx: MutationCtx, e: EntryInput): Promise<Doc<"ledgerEntries">> {
  if (!Number.isSafeInteger(e.amount) || e.amount <= 0) {
    fail("INVALID_AMOUNT", "Amount must be a whole number of rupees above 0.");
  }
  const from = sideOf(e.fromPlayerId, e.fromPool);
  const to = sideOf(e.toPlayerId, e.toPool);
  if (e.type === "REVERSAL") {
    if (!e.reversesEntryId || !e.reversesType) fail("INVALID_STATE", "A reversal must point at its original entry.");
  } else {
    const shape = SHAPES[e.type];
    if (shape.from !== from || shape.to !== to) fail("INVALID_STATE", `Malformed ${e.type} entry.`);
  }
  if (from === "invalid" || to === "invalid") fail("INVALID_STATE", "An entry side can't be both a player and the pool.");
  if (from === "outside" && to === "outside") fail("INVALID_STATE", "An entry must move money somewhere.");
  if ((e.fromPool || e.toPool) && !e.gameId) fail("INVALID_STATE", "Pool entries need a game.");
  if (e.fromPlayerId && e.fromPlayerId === e.toPlayerId) fail("INVALID_STATE", "A player can't pay themselves.");

  const session = await ctx.db.get(e.sessionId);
  if (!session) fail("NOT_FOUND", "Session not found.");

  if (e.fromPlayerId) {
    const wallet = await walletOf(ctx, e.fromPlayerId);
    if (wallet.sessionId !== e.sessionId) fail("INVALID_STATE", "Wallet belongs to another session.");
    if (wallet.balance - e.amount < 0) {
      const player = await ctx.db.get(e.fromPlayerId);
      fail(
        "INSUFFICIENT_BALANCE",
        `${player?.name ?? "That player"} has only ${formatInr(wallet.balance)} — ${formatInr(e.amount)} needed.`,
      );
    }
    await ctx.db.patch(wallet._id, { balance: wallet.balance - e.amount });
  }
  if (e.toPlayerId) {
    const wallet = await walletOf(ctx, e.toPlayerId);
    if (wallet.sessionId !== e.sessionId) fail("INVALID_STATE", "Wallet belongs to another session.");
    await ctx.db.patch(wallet._id, { balance: wallet.balance + e.amount });
  }
  if (e.fromPool || e.toPool) {
    const game = await ctx.db.get(e.gameId!);
    if (!game || game.sessionId !== e.sessionId) fail("NOT_FOUND", "Game not found in this session.");
    const delta = (e.toPool ? e.amount : 0) - (e.fromPool ? e.amount : 0);
    if (game.poolAmount + delta < 0) {
      fail("INSUFFICIENT_POOL", `The pool has only ${formatInr(game.poolAmount)} — ${formatInr(e.amount)} needed.`);
    }
    await ctx.db.patch(game._id, { poolAmount: game.poolAmount + delta });
  }

  await ctx.db.patch(session._id, { nextSeq: session.nextSeq + 1 });
  const id = await ctx.db.insert("ledgerEntries", {
    sessionId: e.sessionId,
    gameId: e.gameId,
    loanId: e.loanId,
    seq: session.nextSeq,
    type: e.type,
    fromPlayerId: e.fromPlayerId,
    toPlayerId: e.toPlayerId,
    fromPool: !!e.fromPool,
    toPool: !!e.toPool,
    amount: e.amount,
    reversesEntryId: e.reversesEntryId,
    reversesType: e.reversesType,
    createdByPlayerId: e.createdByPlayerId,
    createdAt: Date.now(),
    meta: e.meta,
    idempotencyKey: e.idempotencyKey,
  });
  return (await ctx.db.get(id))!;
}

export async function findReversal(ctx: MutationCtx, entryId: Id<"ledgerEntries">) {
  return await ctx.db
    .query("ledgerEntries")
    .withIndex("by_reverses", (q) => q.eq("reversesEntryId", entryId))
    .first();
}

/** Inserts a REVERSAL that moves the original's money back. One reversal per entry; reversals are final. */
export async function reverseEntry(
  ctx: MutationCtx,
  original: Doc<"ledgerEntries">,
  byPlayerId: Id<"sessionPlayers">,
  extra: { meta?: Record<string, unknown>; idempotencyKey?: string } = {},
) {
  if (original.type === "REVERSAL") fail("NOT_UNDOABLE", "An undo can't be undone. Place a new entry instead.");
  if (await findReversal(ctx, original._id)) fail("ALREADY_REVERSED", "That entry has already been undone.");
  return await applyEntry(ctx, {
    sessionId: original.sessionId,
    gameId: original.gameId,
    loanId: original.loanId,
    type: "REVERSAL",
    amount: original.amount,
    fromPlayerId: original.toPlayerId,
    toPlayerId: original.fromPlayerId,
    fromPool: original.toPool,
    toPool: original.fromPool,
    reversesEntryId: original._id,
    reversesType: original.type,
    createdByPlayerId: byPlayerId,
    meta: extra.meta,
    idempotencyKey: extra.idempotencyKey,
  });
}

/**
 * Runs fn once per client-generated key. A repeat (double tap, network retry) returns the
 * stored result without moving money again. If fn throws, nothing is stored, so a retry runs it.
 */
export async function withIdempotency<T>(
  ctx: MutationCtx,
  userId: Id<"users">,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (key.length < 8 || key.length > 64) fail("INVALID_STATE", "Bad idempotency key.");
  const existing = await ctx.db
    .query("idempotencyKeys")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (existing) {
    if (existing.userId !== userId) fail("IDEMPOTENCY_CONFLICT", "That request key belongs to another device.");
    return existing.result as T;
  }
  const result = await fn();
  await ctx.db.insert("idempotencyKeys", { key, userId, result: result ?? null, createdAt: Date.now() });
  return result;
}

export async function getWallet(ctx: MutationCtx, playerId: Id<"sessionPlayers">) {
  return await walletOf(ctx, playerId);
}
