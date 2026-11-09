export type BetTemplate = {
  boot: number;
  minBet: number;
  maxBet?: number;
  blindSeenMultiplier?: number;
  confirmAbove?: number;
};

export type LiveBet = { amount: number; seen: boolean };

export function clampBet(amount: number, t: BetTemplate) {
  const max = t.maxBet ?? Number.MAX_SAFE_INTEGER;
  return Math.max(t.minBet, Math.min(max, amount));
}

/**
 * Quick-bet suggestions. The server only enforces min/max and balance; these are conveniences.
 * Blind = the current stake; seen = stake × multiplier. `lastBet` is the newest live bet at the table.
 */
export function suggest(t: BetTemplate, lastBet: LiveBet | null, iAmSeen: boolean) {
  const mult = t.blindSeenMultiplier;
  const boot = clampBet(t.boot > 0 ? t.boot : t.minBet, t);
  let same: number;
  if (!lastBet) {
    same = boot;
  } else if (mult) {
    const stake = lastBet.seen ? Math.ceil(lastBet.amount / mult) : lastBet.amount;
    same = clampBet(iAmSeen ? stake * mult : stake, t);
  } else {
    same = clampBet(lastBet.amount, t);
  }
  return { boot, same, double: clampBet(same * 2, t) };
}

/** Why an amount can't be placed right now, in words. Null when it's fine. */
export function betProblem(amount: number, t: BetTemplate, balance: number): string | null {
  if (amount <= 0) return null;
  if (amount < t.minBet) return `Min bet is ₹${t.minBet.toLocaleString("en-IN")}`;
  if (t.maxBet !== undefined && amount > t.maxBet) return `Max bet is ₹${t.maxBet.toLocaleString("en-IN")}`;
  if (amount > balance) return `Only ₹${balance.toLocaleString("en-IN")} in wallet`;
  return null;
}
