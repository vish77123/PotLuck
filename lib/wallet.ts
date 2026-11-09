// A wallet is a balance in rupees, shown as notes, coins or chips. Only the total is real money;
// the breakdown is a presentation that lets a player build any amount up to their balance.

export type Theme = "inr" | "chips";
export type Counts = Record<number, number>;

export const NOTES = [500, 200, 100, 50, 20, 10];
export const COINS = [5, 2, 1];
export const CHIPS = [500, 100, 25, 10, 5, 1];

/** Every denomination for a theme, largest first. */
export function denomsFor(theme: Theme): number[] {
  return theme === "chips" ? CHIPS : [...NOTES, ...COINS];
}

export function kindOf(theme: Theme, v: number): "note" | "coin" | "chip" {
  if (theme === "chips") return "chip";
  return v < 10 ? "coin" : "note";
}

// How many of each small denomination a wallet keeps in stock, so any amount can be built without change.
const STOCK_INR: Counts = { 1: 4, 2: 4, 5: 4, 10: 4, 20: 4, 50: 3, 100: 3, 200: 2 };
const STOCK_CHIPS: Counts = { 1: 6, 5: 6, 10: 6, 25: 6, 100: 5 };

export function total(counts: Counts) {
  let sum = 0;
  for (const [d, n] of Object.entries(counts)) sum += Number(d) * n;
  return sum;
}

function empty(theme: Theme): Counts {
  const c: Counts = {};
  for (const d of denomsFor(theme)) c[d] = 0;
  return c;
}

/** Splits a balance into denominations: a stock of small ones (never more than ~60% of the balance), the rest as big as possible. */
export function breakdown(balance: number, theme: Theme): Counts {
  const counts = empty(theme);
  const stock = theme === "chips" ? STOCK_CHIPS : STOCK_INR;
  const asc = [...denomsFor(theme)].reverse();
  let rest = balance;
  for (const d of asc) {
    const n = Math.min(stock[d] ?? 0, Math.floor((rest * 0.6) / d));
    counts[d] = n;
    rest -= n * d;
  }
  for (const d of denomsFor(theme)) {
    const n = Math.floor(rest / d);
    counts[d] += n;
    rest -= n * d;
  }
  return counts;
}

/** The notes that visually make up an amount, biggest first. Used for the pool pile. */
export function pile(amount: number, theme: Theme, max = 8): number[] {
  const out: number[] = [];
  let rest = amount;
  for (const d of denomsFor(theme)) {
    while (rest >= d && out.length < max) {
      out.push(d);
      rest -= d;
    }
  }
  return out;
}

function greedyChange(value: number, theme: Theme, below: number, into: Counts) {
  let rest = value;
  for (const d of denomsFor(theme)) {
    if (d >= below) continue;
    const n = Math.floor(rest / d);
    into[d] += n;
    rest -= n * d;
  }
  return rest;
}

/**
 * Takes one `d` out of the wallet. If there's none, breaks the smallest bigger note into `d` plus change.
 * Returns the new counts, or null if the wallet can't produce a `d`.
 */
export function takeOne(counts: Counts, d: number, theme: Theme): Counts | null {
  const next = { ...counts };
  if (next[d] > 0) {
    next[d] -= 1;
    return next;
  }
  const bigger = denomsFor(theme)
    .filter((e) => e > d && next[e] > 0)
    .sort((a, b) => a - b)[0];
  if (bigger === undefined) return null;
  next[bigger] -= 1;
  greedyChange(bigger - d, theme, bigger, next);
  return next;
}

/** Builds an exact amount from the wallet, making change where needed. Null if the wallet is short. */
export function compose(amount: number, counts: Counts, theme: Theme): { built: number[]; counts: Counts } | null {
  if (amount > total(counts)) return null;
  let rest = amount;
  let cur = counts;
  const built: number[] = [];
  const desc = denomsFor(theme);
  while (rest > 0) {
    let placed = false;
    for (const d of desc) {
      if (d > rest) continue;
      const next = takeOne(cur, d, theme);
      if (next) {
        cur = next;
        built.push(d);
        rest -= d;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Nothing at or below `rest` can be produced: break the smallest note we hold and try again.
      const smallest = [...desc].reverse().find((e) => cur[e] > 0);
      if (smallest === undefined || smallest <= rest) return null;
      const next = { ...cur };
      next[smallest] -= 1;
      greedyChange(smallest, theme, smallest, next);
      cur = next;
    }
  }
  return { built, counts: cur };
}
