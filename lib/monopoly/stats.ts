import type { MEvent } from "./types";

export type RentTotals = Record<string, { earned: number; paid: number }>;

/**
 * Rent each player earned and paid over a game's whole event log. A rent payment that was undone is cancelled by its
 * inverse (marked `undo`), so it counts for nothing.
 */
export function rentTotals(events: MEvent[]): RentTotals {
  const totals: RentTotals = {};
  const row = (id: string) => (totals[id] ??= { earned: 0, paid: 0 });
  for (const e of events) {
    if (e.type !== "PAY" || e.meta?.reason !== "rent") continue;
    const sign = e.meta.undo ? -1 : 1;
    // An undo runs the money the other way, so "to" is the payer of the original.
    if (e.meta.undo) {
      row(e.fromParty).earned += sign * e.amount;
      row(e.toParty).paid += sign * e.amount;
    } else {
      row(e.toParty).earned += e.amount;
      row(e.fromParty).paid += e.amount;
    }
  }
  return totals;
}

/** Average finishing place, one decimal, or null with no games. */
export function averageFinish(positions: number[]): number | null {
  if (positions.length === 0) return null;
  return Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10;
}
