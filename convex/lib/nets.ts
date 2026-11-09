import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export type PlayerNetRow = {
  playerId: Id<"sessionPlayers">;
  crewMemberId: Id<"crewMembers">;
  name: string;
  status: Doc<"sessionPlayers">["status"];
  wallet: number;
  buyIn: number;
  topUps: number;
  cashOut: number;
  borrowedOutstanding: number;
  lentOutstanding: number;
  net: number;
};

async function entriesOfType(ctx: Ctx, sessionId: Id<"sessions">, type: Doc<"ledgerEntries">["type"]) {
  return await ctx.db
    .query("ledgerEntries")
    .withIndex("by_session_type", (q) => q.eq("sessionId", sessionId).eq("type", type))
    .collect();
}

/**
 * net = final wallet (+ cash-outs) − buy-in − top-ups − outstanding borrowed + outstanding lent.
 * Loans settled outside the app are excluded. Reads only buy-in/top-up/cash-out/reversal entries,
 * never the bet stream.
 */
export async function computeNets(ctx: Ctx, sessionId: Id<"sessions">): Promise<PlayerNetRow[]> {
  const players = await ctx.db
    .query("sessionPlayers")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  const wallets = await ctx.db
    .query("wallets")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  const loans = await ctx.db
    .query("loans")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  const [buyIns, topUps, cashOuts, reversals] = await Promise.all([
    entriesOfType(ctx, sessionId, "BUY_IN"),
    entriesOfType(ctx, sessionId, "TOP_UP"),
    entriesOfType(ctx, sessionId, "CASH_OUT"),
    entriesOfType(ctx, sessionId, "REVERSAL"),
  ]);

  const rows = new Map<Id<"sessionPlayers">, PlayerNetRow>();
  for (const p of players) {
    rows.set(p._id, {
      playerId: p._id,
      crewMemberId: p.crewMemberId,
      name: p.name,
      status: p.status,
      wallet: wallets.find((w) => w.sessionPlayerId === p._id)?.balance ?? 0,
      buyIn: 0,
      topUps: 0,
      cashOut: 0,
      borrowedOutstanding: 0,
      lentOutstanding: 0,
      net: 0,
    });
  }
  for (const e of buyIns) rows.get(e.toPlayerId!)!.buyIn += e.amount;
  for (const e of topUps) rows.get(e.toPlayerId!)!.topUps += e.amount;
  for (const e of cashOuts) rows.get(e.fromPlayerId!)!.cashOut += e.amount;
  for (const e of reversals) {
    if (e.reversesType === "BUY_IN") rows.get(e.fromPlayerId!)!.buyIn -= e.amount;
    if (e.reversesType === "TOP_UP") rows.get(e.fromPlayerId!)!.topUps -= e.amount;
  }
  for (const l of loans) {
    if (l.status !== "open") continue;
    const outstanding = l.amount - l.repaidAmount;
    rows.get(l.borrowerPlayerId)!.borrowedOutstanding += outstanding;
    rows.get(l.lenderPlayerId)!.lentOutstanding += outstanding;
  }
  for (const r of rows.values()) {
    r.net = r.wallet + r.cashOut - r.buyIn - r.topUps - r.borrowedOutstanding + r.lentOutstanding;
  }
  return [...rows.values()];
}
