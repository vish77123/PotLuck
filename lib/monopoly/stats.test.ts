import { describe, expect, test } from "vitest";
import { createGame, invertEvents, planBankCollect, planBuy, planRent } from "./engine";
import { CLASSIC } from "./presets";
import { averageFinish, rentTotals } from "./stats";
import { DEFAULT_SETTINGS, type MEvent } from "./types";

const id = (n: string) => CLASSIC.spaces.find((s) => s.name === n)!.id;
const start = () => createGame(structuredClone(CLASSIC), DEFAULT_SETTINGS, ["A", "B", "C"].map((n) => ({ id: n, name: n })));

describe("rentTotals", () => {
  test("counts rent earned and paid, ignoring other payments", () => {
    let s = planBuy(start(), "A", id("Market Sq")).after;
    const log: MEvent[] = [];
    for (const p of [planRent(s, "B", id("Market Sq")), planRent(s, "C", id("Market Sq")), planBankCollect(s, "B", 500)]) log.push(...p.events);
    expect(rentTotals(log)).toEqual({ A: { earned: 28, paid: 0 }, B: { earned: 0, paid: 14 }, C: { earned: 0, paid: 14 } });
  });

  test("an undone rent payment counts for nothing", () => {
    const s = planBuy(start(), "A", id("Market Sq")).after;
    const rent = planRent(s, "B", id("Market Sq"));
    const log = [...rent.events, ...invertEvents(rent.events)];
    const t = rentTotals(log);
    expect(t.A).toEqual({ earned: 0, paid: 0 });
    expect(t.B).toEqual({ earned: 0, paid: 0 });
  });

  test("is empty with no rent", () => {
    expect(rentTotals([])).toEqual({});
  });
});

describe("averageFinish", () => {
  test("rounds to one decimal", () => {
    expect(averageFinish([1, 2, 2])).toBe(1.7);
    expect(averageFinish([3])).toBe(3);
    expect(averageFinish([])).toBeNull();
  });
});
