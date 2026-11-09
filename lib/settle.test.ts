import { describe, expect, test } from "vitest";
import { settleUp, type PlayerNet } from "./settle";

function applyTransfers(nets: PlayerNet[], transfers: ReturnType<typeof settleUp>) {
  const left = new Map(nets.map((n) => [n.id, n.net]));
  for (const tr of transfers) {
    expect(tr.amount).toBeGreaterThan(0);
    left.set(tr.from, left.get(tr.from)! + tr.amount);
    left.set(tr.to, left.get(tr.to)! - tr.amount);
  }
  return [...left.values()];
}

describe("settleUp", () => {
  test("all nets zero → no transfers", () => {
    expect(settleUp([{ id: "a", net: 0 }, { id: "b", net: 0 }])).toEqual([]);
    expect(settleUp([])).toEqual([]);
  });

  test("one debtor, one creditor", () => {
    expect(settleUp([{ id: "a", net: -500 }, { id: "b", net: 500 }])).toEqual([{ from: "a", to: "b", amount: 500 }]);
  });

  test("largest debtor pays largest creditor first", () => {
    const nets = [
      { id: "priya", net: 1200 },
      { id: "rahul", net: -900 },
      { id: "kabir", net: -400 },
      { id: "arjun", net: 100 },
    ];
    const tr = settleUp(nets);
    expect(tr[0]).toEqual({ from: "rahul", to: "priya", amount: 900 });
    expect(tr).toEqual([
      { from: "rahul", to: "priya", amount: 900 },
      { from: "kabir", to: "priya", amount: 300 },
      { from: "kabir", to: "arjun", amount: 100 },
    ]);
    expect(applyTransfers(nets, tr).every((x) => x === 0)).toBe(true);
  });

  test("ties break by id, so every device shows the same list", () => {
    const nets = [
      { id: "d", net: -100 },
      { id: "c", net: -100 },
      { id: "b", net: 100 },
      { id: "a", net: 100 },
    ];
    expect(settleUp(nets)).toEqual([
      { from: "c", to: "a", amount: 100 },
      { from: "d", to: "b", amount: 100 },
    ]);
    expect(settleUp([...nets].reverse())).toEqual(settleUp(nets));
  });

  test("single creditor, many debtors", () => {
    const nets = [
      { id: "w", net: 600 },
      { id: "x", net: -100 },
      { id: "y", net: -200 },
      { id: "z", net: -300 },
    ];
    const tr = settleUp(nets);
    expect(tr).toHaveLength(3);
    expect(tr.every((t) => t.to === "w")).toBe(true);
    expect(applyTransfers(nets, tr).every((x) => x === 0)).toBe(true);
  });

  test("never more than n − 1 transfers", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let round = 0; round < 200; round++) {
      const n = 2 + Math.floor(rand() * 8);
      const nets = Array.from({ length: n - 1 }, (_, i) => ({ id: `p${i}`, net: Math.floor(rand() * 2001) - 1000 }));
      nets.push({ id: `p${n - 1}`, net: -nets.reduce((s, x) => s + x.net, 0) });
      const tr = settleUp(nets);
      expect(tr.length).toBeLessThanOrEqual(n - 1);
      expect(applyTransfers(nets, tr).every((x) => x === 0)).toBe(true);
    }
  });

  test("rejects nets that don't balance", () => {
    expect(() => settleUp([{ id: "a", net: 10 }])).toThrow(/sum to 0/);
  });
});
