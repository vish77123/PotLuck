export type PlayerNet = { id: string; net: number };
export type Transfer = { from: string; to: string; amount: number };

/**
 * Greedy settle-up: repeatedly match the largest debtor with the largest creditor.
 * Shared by the backend (report) and the frontend (live preview). Ties break by id so
 * every device shows the same list.
 */
export function settleUp(nets: PlayerNet[]): Transfer[] {
  const total = nets.reduce((s, n) => s + n.net, 0);
  if (total !== 0) throw new Error(`Nets must sum to 0 (got ${total}).`);
  for (const n of nets) {
    if (!Number.isSafeInteger(n.net)) throw new Error(`Net for ${n.id} is not a whole number.`);
  }

  const debtors = nets.filter((n) => n.net < 0).map((n) => ({ id: n.id, left: -n.net }));
  const creditors = nets.filter((n) => n.net > 0).map((n) => ({ id: n.id, left: n.net }));
  const byLargest = (a: { id: string; left: number }, b: { id: string; left: number }) =>
    b.left - a.left || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const transfers: Transfer[] = [];
  while (debtors.length && creditors.length) {
    debtors.sort(byLargest);
    creditors.sort(byLargest);
    const d = debtors[0];
    const c = creditors[0];
    const amount = Math.min(d.left, c.left);
    transfers.push({ from: d.id, to: c.id, amount });
    d.left -= amount;
    c.left -= amount;
    if (d.left === 0) debtors.shift();
    if (c.left === 0) creditors.shift();
  }
  return transfers;
}
