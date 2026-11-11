import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { isStakeType } from "./lib/ledger";
import { computeNets } from "./lib/nets";

/**
 * Replays the whole session ledger and checks it against the wallet and pool projections:
 *  1. no wallet below 0
 *  2. each pool = its BOOT + BET − reversals − payouts (via replay)
 *  3. wallets + open pools = buy-ins + top-ups − cash-outs
 *  4. settlement nets + open pools = 0 (so nets sum to 0 once every game is closed)
 * Returns the list of violations; empty means healthy.
 */
export async function checkSessionInvariants(ctx: QueryCtx, sessionId: Id<"sessions">) {
  const violations: string[] = [];
  const entries = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_session_seq", (q) => q.eq("sessionId", sessionId))
    .collect();
  const wallets = await ctx.db
    .query("wallets")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  const games = await ctx.db
    .query("games")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();

  const replayWallet = new Map<string, number>();
  const replayPool = new Map<string, number>();
  const byId = new Map(entries.map((e) => [e._id as string, e]));
  const reversed = new Set<string>();
  let external = 0; // buy-ins + top-ups − cash-outs, net of reversals
  let lastSeq = 0;
  const stakeBuyIns = new Map<string, number>(); // per Monopoly game, net of reversals
  const stakePayouts = new Map<string, number>();

  for (const e of entries) {
    if (e.seq <= lastSeq) violations.push(`seq not increasing at ${e.seq}`);
    lastSeq = e.seq;
    if (!Number.isSafeInteger(e.amount) || e.amount <= 0) violations.push(`bad amount on seq ${e.seq}`);
    const kind = e.type === "REVERSAL" ? e.reversesType : e.type;
    const sign = e.type === "REVERSAL" ? -1 : 1;
    if (isStakeType(kind)) {
      // Stakes are attribution only; they're checked per game below, not against wallets or pools.
      stakeBuyIns.set(e.mGameId!, (stakeBuyIns.get(e.mGameId!) ?? 0) + (kind === "MONO_BUY_IN" ? sign * e.amount : 0));
      stakePayouts.set(e.mGameId!, (stakePayouts.get(e.mGameId!) ?? 0) + (kind === "MONO_PAYOUT" ? sign * e.amount : 0));
      if (e.mGameId === undefined) violations.push(`stake entry seq ${e.seq} has no game`);
    } else {
      if (e.fromPlayerId) replayWallet.set(e.fromPlayerId, (replayWallet.get(e.fromPlayerId) ?? 0) - e.amount);
      if (e.toPlayerId) replayWallet.set(e.toPlayerId, (replayWallet.get(e.toPlayerId) ?? 0) + e.amount);
      if (e.fromPool) replayPool.set(e.gameId!, (replayPool.get(e.gameId!) ?? 0) - e.amount);
      if (e.toPool) replayPool.set(e.gameId!, (replayPool.get(e.gameId!) ?? 0) + e.amount);
    }

    if (kind === "BUY_IN" || kind === "TOP_UP") external += sign * e.amount;
    if (kind === "CASH_OUT") external -= sign * e.amount;

    if (e.type === "REVERSAL") {
      const original = byId.get(e.reversesEntryId!);
      if (!original) violations.push(`reversal seq ${e.seq} points at a missing entry`);
      else if (original.type === "REVERSAL") violations.push(`reversal seq ${e.seq} reverses a reversal`);
      else if (original.amount !== e.amount) violations.push(`reversal seq ${e.seq} amount mismatch`);
      if (reversed.has(e.reversesEntryId!)) violations.push(`entry ${e.reversesEntryId} reversed twice`);
      reversed.add(e.reversesEntryId!);
    }
  }

  let walletSum = 0;
  for (const w of wallets) {
    walletSum += w.balance;
    if (w.balance < 0) violations.push(`wallet ${w.sessionPlayerId} is ${w.balance}`);
    const expected = replayWallet.get(w.sessionPlayerId) ?? 0;
    if (w.balance !== expected) violations.push(`wallet ${w.sessionPlayerId} is ${w.balance}, ledger says ${expected}`);
  }

  let openPools = 0;
  for (const g of games) {
    const expected = replayPool.get(g._id) ?? 0;
    if (g.poolAmount < 0) violations.push(`game #${g.gameNo} pool is ${g.poolAmount}`);
    if (g.poolAmount !== expected) violations.push(`game #${g.gameNo} pool is ${g.poolAmount}, ledger says ${expected}`);
    if (g.status !== "active" && g.poolAmount !== 0) violations.push(`closed game #${g.gameNo} still holds ${g.poolAmount}`);
    if (g.status === "active") openPools += g.poolAmount;
  }

  if (walletSum + openPools !== external) {
    violations.push(`wallets ${walletSum} + open pools ${openPools} ≠ buy-ins + top-ups − cash-outs ${external}`);
  }

  // Real-₹ stakes: a finished game pays out exactly what it collected; a cancelled game refunds all of it.
  // Games still going hold their buy-ins in the physical pot.
  let openStakes = 0;
  const mGames = await ctx.db
    .query("mGames")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  for (const g of mGames) {
    const inn = stakeBuyIns.get(g._id) ?? 0;
    const out = stakePayouts.get(g._id) ?? 0;
    if (g.status === "ended" && inn !== out) violations.push(`Monopoly game #${g.gameNo} took ${inn} in stakes but paid out ${out}`);
    else if (g.status === "cancelled" && (inn !== 0 || out !== 0)) violations.push(`cancelled Monopoly game #${g.gameNo} still holds stakes ${inn}/${out}`);
    else if (g.status !== "ended" && g.status !== "cancelled") openStakes += inn - out;
  }
  for (const gameId of new Set([...stakeBuyIns.keys(), ...stakePayouts.keys()])) {
    if (!mGames.some((g) => g._id === gameId)) violations.push(`stake entries point at a missing game ${gameId}`);
  }

  const nets = await computeNets(ctx, sessionId);
  const netSum = nets.reduce((s, n) => s + n.net, 0);
  if (netSum + openPools + openStakes !== 0) {
    violations.push(`nets sum to ${netSum} with ${openPools} in open pools and ${openStakes} in open stakes`);
  }

  return { violations, walletSum, openPools, openStakes, external, netSum, entryCount: entries.length };
}

export const assertSessionInvariants = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const result = await checkSessionInvariants(ctx, sessionId);
    if (result.violations.length) throw new Error(`Invariant violations:\n${result.violations.join("\n")}`);
    return result;
  },
});
