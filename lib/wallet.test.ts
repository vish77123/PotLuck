import { describe, expect, test } from "vitest";
import { breakdown, compose, pile, takeOne, total, type Theme } from "./wallet";

const THEMES: Theme[] = ["inr", "chips"];

describe("breakdown", () => {
  test("always adds up to the balance", () => {
    for (const theme of THEMES) {
      for (const balance of [0, 1, 7, 45, 99, 130, 450, 1000, 3450, 18640, 250000]) {
        expect(total(breakdown(balance, theme))).toBe(balance);
      }
    }
  });

  test("keeps small notes in stock so small bets are possible", () => {
    const c = breakdown(3450, "inr");
    expect(c[10]).toBeGreaterThanOrEqual(3);
    expect(c[20]).toBeGreaterThanOrEqual(3);
    expect(c[500]).toBeGreaterThan(0);
  });

  test("a small balance isn't swallowed by the stock", () => {
    const c = breakdown(45, "inr");
    expect(total(c)).toBe(45);
  });
});

describe("compose", () => {
  test("builds exact amounts and conserves the wallet total", () => {
    let seed = 12345;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (const theme of THEMES) {
      for (let i = 0; i < 400; i++) {
        const balance = 1 + Math.floor(rand() * 5000);
        const amount = 1 + Math.floor(rand() * balance);
        const wallet = breakdown(balance, theme);
        const res = compose(amount, wallet, theme);
        expect(res, `${theme} ${amount} of ${balance}`).not.toBeNull();
        expect(res!.built.reduce((a, b) => a + b, 0)).toBe(amount);
        expect(total(res!.counts)).toBe(balance - amount);
        for (const n of Object.values(res!.counts)) expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("the whole balance can be built", () => {
    for (const theme of THEMES) {
      const wallet = breakdown(1234, theme);
      expect(compose(1234, wallet, theme)?.counts).toBeTruthy();
    }
  });

  test("more than the balance is refused", () => {
    expect(compose(451, breakdown(450, "inr"), "inr")).toBeNull();
  });

  test("breaks a bigger note when the small ones are used up", () => {
    const counts = { 500: 1, 200: 0, 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 2: 0, 1: 0 };
    const next = takeOne(counts, 10, "inr");
    expect(next).not.toBeNull();
    expect(total(next!)).toBe(490);
    expect(next![500]).toBe(0);
  });
});

describe("pile", () => {
  test("lists the biggest notes first and caps the count", () => {
    expect(pile(1240, "inr")).toEqual([500, 500, 200, 20, 20]);
    expect(pile(1_000_000, "inr", 6)).toHaveLength(6);
    expect(pile(0, "inr")).toEqual([]);
  });
});
