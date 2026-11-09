/**
 * Seats on the table's upper arc, as percentages of the table box (from the design:
 * centre (50%, 40.8%), radii 42.7% × 35%). Angles run from lower-left, over the top, to lower-right.
 */
export function arcPositions(n: number): { x: number; y: number }[] {
  if (n <= 0) return [];
  const span = Math.min(234, (n - 1) * 58);
  return Array.from({ length: n }, (_, i) => {
    const t = (n === 1 ? 0 : -span / 2 + (i * span) / (n - 1)) * (Math.PI / 180);
    return { x: 50 + 42.7 * Math.sin(t), y: 40.8 - 35 * Math.cos(t) };
  });
}

/** Others in seat order starting with whoever plays right after me, so turns run clockwise from my seat. */
export function orderFromMe<T extends { seatOrder: number; sessionPlayerId: string }>(participants: T[], meId: string): T[] {
  const sorted = [...participants].sort((a, b) => a.seatOrder - b.seatOrder);
  const i = sorted.findIndex((p) => p.sessionPlayerId === meId);
  if (i === -1) return sorted;
  return [...sorted.slice(i + 1), ...sorted.slice(0, i)];
}

export const TEAMS = [
  { name: "Gold", color: "#e5c47c" },
  { name: "Teal", color: "#4fc3b0" },
  { name: "Rose", color: "#e08aa0" },
  { name: "Sky", color: "#6fb1e8" },
  { name: "Violet", color: "#a58be0" },
  { name: "Lime", color: "#a9c95b" },
];

export function teamOf(teamNo: number | undefined) {
  return teamNo === undefined ? null : TEAMS[(teamNo - 1) % TEAMS.length];
}
