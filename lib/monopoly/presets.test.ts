import { describe, expect, test } from "vitest";
import { BUSINESS, CLASSIC, presetByKey, unverifiedItems } from "./presets";
import { boardProblems, groupSpaces, ownableSpaces } from "./rules";
import type { GroupKey } from "./types";

const GROUPS: GroupKey[] = ["brown", "lblue", "pink", "orange", "red", "yellow", "green", "dblue"];

describe.each([CLASSIC, BUSINESS])("$name preset", (board) => {
  test("is a valid 40-space board", () => {
    expect(board.spaces).toHaveLength(40);
    expect(boardProblems(board)).toEqual([]);
    expect(new Set(board.spaces.map((s) => s.id)).size).toBe(40);
  });

  test("has the standard shape: 22 streets, 4 stations, 2 utilities, 2 taxes, 6 card spaces", () => {
    const count = (k: string) => board.spaces.filter((s) => s.kind === k).length;
    expect(count("property")).toBe(22);
    expect(count("rail")).toBe(4);
    expect(count("utility")).toBe(2);
    expect(count("tax")).toBe(2);
    expect(count("card")).toBe(6);
    expect(ownableSpaces(board)).toHaveLength(28);
    expect(board.spaces[0].kind).toBe("go");
    expect(board.spaces[10].kind).toBe("jail");
    expect(board.spaces[20].kind).toBe("parking");
    expect(board.spaces[30].kind).toBe("gotojail");
  });

  test("every colour group has 2 or 3 properties, with one house cost, in board order", () => {
    for (const g of GROUPS) {
      const members = groupSpaces(board, g);
      expect(members.length).toBe(g === "brown" || g === "dblue" ? 2 : 3);
      expect(new Set(members.map((m) => m.houseCost)).size).toBe(1);
    }
  });

  test("mortgage is half the price and rents rise with every house", () => {
    for (const s of ownableSpaces(board)) expect(s.mortgage).toBe(s.price! / 2);
    for (const s of board.spaces.filter((x) => x.kind === "property")) {
      const rent = s.rent!;
      for (let i = 1; i < rent.length; i++) expect(rent[i]).toBeGreaterThan(rent[i - 1]);
    }
  });
});

describe("Classic values", () => {
  test("board-wide values are the standard ones", () => {
    expect(CLASSIC).toMatchObject({ passGo: 200, jailFine: 50, startingCash: 1500, houses: 32, hotels: 12, currency: "$" });
    expect(CLASSIC.utilityMultipliers).toEqual([4, 10]);
    expect(CLASSIC.spaces.filter((s) => s.kind === "tax").map((s) => s.amount)).toEqual([200, 100]);
  });

  test("spot checks: cheapest, dearest and a middle street", () => {
    const byName = (n: string) => CLASSIC.spaces.find((s) => s.name === n)!;
    expect(byName("Mill Lane")).toMatchObject({ price: 60, rent: [2, 10, 30, 90, 160, 250], houseCost: 50, mortgage: 30 });
    expect(byName("Market Sq")).toMatchObject({ price: 180, rent: [14, 70, 200, 550, 750, 950], houseCost: 100, mortgage: 90 });
    expect(byName("Grand Esplanade")).toMatchObject({ price: 400, rent: [50, 200, 600, 1400, 1700, 2000], houseCost: 200, mortgage: 200 });
    expect(byName("North Stn")).toMatchObject({ price: 200, rent: [25, 50, 100, 200], mortgage: 100 });
    expect(byName("Power Co.")).toMatchObject({ price: 150, mortgage: 75 });
  });

  test("all 28 deeds add up to $5,690 (streets 4,590 + stations 800 + utilities 300)", () => {
    expect(ownableSpaces(CLASSIC).reduce((s, x) => s + x.price!, 0)).toBe(5690);
  });

  test("everything is marked verified", () => {
    expect(unverifiedItems(CLASSIC)).toEqual([]);
  });
});

describe("Business placeholders", () => {
  test("every value is flagged unverified and listed for checking", () => {
    expect(BUSINESS.verified).toBe(false);
    const items = unverifiedItems(BUSINESS);
    expect(items[0]).toMatch(/Board-wide/);
    // 28 ownable spaces + 2 taxes + the board-wide line.
    expect(items).toHaveLength(1 + 28 + 2);
    expect(BUSINESS.spaces.filter((s) => s.kind === "property").every((s) => s.verified === false)).toBe(true);
  });

  test("uses Indian city names and rupees", () => {
    expect(BUSINESS.currency).toBe("₹");
    expect(BUSINESS.spaces.map((s) => s.name)).toEqual(expect.arrayContaining(["Mumbai", "Juhu", "Agra", "Central", "Water Co."]));
  });
});

describe("presetByKey", () => {
  test("returns an independent copy", () => {
    const a = presetByKey("classic");
    a.spaces[1].name = "Edited";
    expect(CLASSIC.spaces[1].name).toBe("Mill Lane");
    expect(() => presetByKey("nope")).toThrow(/Unknown board preset/);
  });
});

describe("boardProblems", () => {
  test("catches an editor mistake", () => {
    const b = presetByKey("classic");
    b.spaces[1].rent = [2, 10];
    b.spaces[3].mortgage = 999;
    b.startingCash = 0;
    const problems = boardProblems(b);
    expect(problems).toEqual(expect.arrayContaining([expect.stringMatching(/Mill Lane needs 6 rents/), expect.stringMatching(/Cobble Row's mortgage/), expect.stringMatching(/Starting cash/)]));
  });
});
