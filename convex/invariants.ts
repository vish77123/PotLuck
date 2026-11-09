import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
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

  for (const e of entries) {
    if (e.seq <= lastSeq) violations.push(`seq not increasing at ${e.seq}`);
    lastSeq = e.seq;
    if (!Number.isSafeInteger(e.amount) || e.amount <= 0) violations.push(`bad amount on seq ${e.seq}`);
    if (e.fromPlayerId) replayWallet.set(e.fromPlayerId, (replayWallet.get(e.fromPlayerId) ?? 0) - e.amount);
    if (e.toPlayerId) replayWallet.set(e.toPlayerId, (replayWallet.get(e.toPlayerId) ?? 0) + e.amount);
    if (e.fromPool) replayPool.set(e.gameId!, (replayPool.get(e.gameId!) ?? 0) - e.amount);
    if (e.toPool) replayPool.set(e.gameId!, (replayPool.get(e.gameId!) ?? 0) + e.amount);

    const kind = e.type === "REVERSAL" ? e.reversesType : e.type;
    const sign = e.type === "REVERSAL" ? -1 : 1;
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

  const nets = await computeNets(ctx, sessionId);
  const netSum = nets.reduce((s, n) => s + n.net, 0);
  if (netSum + openPools !== 0) violations.push(`nets sum to ${netSum} with ${openPools} in open pools`);

  return { violations, walletSum, openPools, external, netSum, entryCount: entries.length };
}

export const assertSessionInvariants = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const result = await checkSessionInvariants(ctx, sessionId);
    if (result.violations.length) throw new Error(`Invariant violations:\n${result.violations.join("\n")}`);
    return result;
  },
});
