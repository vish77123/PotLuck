import { describe, expect, test } from "vitest";
import { createGame } from "./engine";
import { CLASSIC } from "./presets";
import {
  bankSink,
  boardProblems,
  buildingCounts,
  canBuild,
  canMortgage,
  canSellBuilding,
  canUnmortgage,
  interestOn,
  netWorth,
  netWorthParts,
  nextPlayer,
  raiseMoneyOptions,
  rentFor,
  repairsBill,
  sellValue,
  splitStakes,
  unmortgageCost,
  validateSettings,
} from "./rules";
import { BANK, DEFAULT_SETTINGS, POT, RuleError, type GameState, type Settings } from "./types";

const space = (name: string) => CLASSIC.spaces.find((s) => s.name === name)!;
const id = (name: string) => space(name).id;

function game(settings: Partial<Settings> = {}, names = ["A", "B", "C"]): GameState {
  return createGame(structuredClone(CLASSIC), { ...DEFAULT_SETTINGS, ...settings }, names.map((n) => ({ id: n, name: n })));
}

/** Gives `owner` the named spaces, optionally with buildings. */
function own(state: GameState, owner: string | null, names: string[], extra: Partial<GameState["props"][string]> = {}) {
  for (const n of names) Object.assign(state.props[id(n)], { owner }, extra);
  return state;
}

const ORANGE = ["Market Sq", "Bridge St", "Chapel Hill"];
const BROWN = ["Mill Lane", "Cobble Row"];
const RAILS = ["North Stn", "East Stn", "South Stn", "West Stn"];

describe("rentFor", () => {
  test("unowned, mortgaged and non-ownable spaces owe nothing", () => {
    const s = game();
    expect(rentFor(s, id("Market Sq")).amount).toBe(0);
    own(s, "A", ["Market Sq"], { mortgaged: true });
    expect(rentFor(s, id("Market Sq"))).toMatchObject({ amount: 0, ownerId: "A", note: "Mortgaged, so no rent." });
    expect(rentFor(s, "s00").amount).toBe(0);
  });

  test("base rent, then double for an unimproved full colour set", () => {
    const s = game();
    own(s, "A", ["Market Sq"]);
    expect(rentFor(s, id("Market Sq")).amount).toBe(14);
    own(s, "A", ["Bridge St", "Chapel Hill"]);
    expect(rentFor(s, id("Market Sq"))).toMatchObject({ amount: 28, note: "Double rent, full colour set" });
    expect(rentFor(s, id("Chapel Hill")).amount).toBe(32);
  });

  test("a mortgaged property in the set still counts as owned for the double, but pays nothing itself", () => {
    const s = own(game(), "A", ORANGE);
    s.props[id("Bridge St")].mortgaged = true;
    expect(rentFor(s, id("Market Sq")).amount).toBe(28);
    expect(rentFor(s, id("Bridge St")).amount).toBe(0);
  });

  test("house and hotel rents come from the table", () => {
    const s = own(game(), "A", ORANGE);
    for (const [houses, rent] of [[1, 70], [2, 200], [3, 550], [4, 750]] as const) {
      s.props[id("Market Sq")].houses = houses;
      expect(rentFor(s, id("Market Sq")).amount).toBe(rent);
    }
    Object.assign(s.props[id("Market Sq")], { houses: 0, hotel: true });
    expect(rentFor(s, id("Market Sq")).amount).toBe(950);
  });

  test("stations pay 25 / 50 / 100 / 200 by number owned", () => {
    const s = game();
    RAILS.forEach((r, i) => {
      own(s, "A", [r]);
      expect(rentFor(s, id("North Stn")).amount).toBe([25, 50, 100, 200][i]);
    });
    s.props[id("East Stn")].owner = "B";
    expect(rentFor(s, id("North Stn")).amount).toBe(100);
  });

  test("utilities pay 4× the dice with one, 10× with both, and ask for the dice", () => {
    const s = own(game(), "A", ["Power Co."]);
    expect(() => rentFor(s, id("Power Co."))).toThrow(/dice total/);
    expect(() => rentFor(s, id("Power Co."), { diceTotal: 0 })).toThrow(RuleError);
    expect(rentFor(s, id("Power Co."), { diceTotal: 9 }).amount).toBe(36);
    own(s, "A", ["Water Co."]);
    expect(rentFor(s, id("Power Co."), { diceTotal: 9 }).amount).toBe(90);
  });

  test("rejects properties when deeds aren't tracked", () => {
    expect(() => rentFor(game({ trackProperties: false }), id("Market Sq"))).toThrow(/aren't tracked/);
  });
});

describe("mortgage maths", () => {
  test("unmortgage = mortgage value + 10% rounded up", () => {
    expect(unmortgageCost(space("Market Sq"))).toBe(99); // 90 + 9
    expect(unmortgageCost(space("Mill Lane"))).toBe(33); // 30 + 3
    expect(unmortgageCost(space("Power Co."))).toBe(83); // 75 + 7.5 → 8
    expect(interestOn(space("Power Co."))).toBe(8);
    expect(interestOn(space("North Stn"))).toBe(10);
  });

  test("a property can be mortgaged only without buildings anywhere in its set", () => {
    const s = own(game(), "A", ORANGE);
    expect(canMortgage(s, "A", id("Market Sq"))).toEqual({ ok: true, raises: 90 });
    s.props[id("Bridge St")].houses = 1;
    s.bankHouses -= 1;
    expect(canMortgage(s, "A", id("Market Sq"))).toMatchObject({ ok: false, reason: expect.stringMatching(/Sell the buildings/) });
    expect(canMortgage(s, "B", id("Market Sq"))).toMatchObject({ ok: false });
  });

  test("already-mortgaged and not-mortgaged states are refused", () => {
    const s = own(game(), "A", ["Market Sq"]);
    expect(canUnmortgage(s, "A", id("Market Sq"))).toMatchObject({ ok: false });
    s.props[id("Market Sq")].mortgaged = true;
    expect(canMortgage(s, "A", id("Market Sq"))).toMatchObject({ ok: false });
    expect(canUnmortgage(s, "A", id("Market Sq"))).toEqual({ ok: true, cost: 99 });
  });
});

describe("building", () => {
  test("needs the full set, no mortgage in it, and the owner", () => {
    const s = own(game(), "A", ["Market Sq", "Bridge St"]);
    expect(canBuild(s, "A", id("Market Sq"))).toMatchObject({ ok: false, reason: expect.stringMatching(/whole orange set/) });
    own(s, "A", ["Chapel Hill"]);
    expect(canBuild(s, "A", id("Market Sq"))).toMatchObject({ ok: true, cost: 100 });
    expect(canBuild(s, "B", id("Market Sq"))).toMatchObject({ ok: false });
    s.props[id("Chapel Hill")].mortgaged = true;
    expect(canBuild(s, "A", id("Market Sq"))).toMatchObject({ ok: false, reason: expect.stringMatching(/Unmortgage/) });
  });

  test("only coloured properties can be built on", () => {
    const s = own(game(), "A", RAILS);
    expect(canBuild(s, "A", id("North Stn"))).toMatchObject({ ok: false });
  });

  test("even building: no house more than one ahead of the lowest in the set", () => {
    const s = own(game(), "A", ORANGE);
    s.props[id("Market Sq")].houses = 1;
    s.bankHouses -= 1;
    expect(canBuild(s, "A", id("Market Sq"))).toMatchObject({ ok: false, reason: expect.stringMatching(/evenly/) });
    expect(canBuild(s, "A", id("Bridge St"))).toMatchObject({ ok: true });
  });

  test("with evenBuilding off, any order works", () => {
    const s = own(game({ evenBuilding: false }), "A", ORANGE);
    s.props[id("Market Sq")].houses = 3;
    s.bankHouses -= 3;
    expect(canBuild(s, "A", id("Market Sq"))).toMatchObject({ ok: true });
  });

  test("the 4th house becomes a hotel, returning 4 houses to the bank", () => {
    const s = own(game(), "A", ORANGE, { houses: 4 });
    s.bankHouses -= 12;
    const plan = canBuild(s, "A", id("Market Sq"));
    expect(plan).toMatchObject({ ok: true, before: { houses: 4, hotel: false }, after: { houses: 0, hotel: true } });
  });

  test("a hotel can't be built on", () => {
    const s = own(game({ evenBuilding: false }), "A", ORANGE);
    Object.assign(s.props[id("Market Sq")], { houses: 0, hotel: true });
    s.bankHotels -= 1;
    expect(canBuild(s, "A", id("Market Sq"))).toMatchObject({ ok: false, reason: expect.stringMatching(/already has a hotel/) });
  });

  test("building is blocked when the bank runs out of houses or hotels", () => {
    const s = own(game(), "A", ORANGE);
    s.bankHouses = 0;
    expect(canBuild(s, "A", id("Market Sq"))).toMatchObject({ ok: false, reason: expect.stringMatching(/no houses left/) });
    for (const n of ORANGE) s.props[id(n)].houses = 4;
    s.bankHotels = 0;
    expect(canBuild(s, "A", id("Market Sq"))).toMatchObject({ ok: false, reason: expect.stringMatching(/no hotels left/) });
  });
});

describe("selling buildings", () => {
  test("returns half the house cost", () => {
    const s = own(game(), "A", ORANGE);
    s.props[id("Market Sq")].houses = 1;
    s.bankHouses -= 1;
    expect(canSellBuilding(s, "A", id("Market Sq"))).toMatchObject({ ok: true, refund: 50, after: { houses: 0, hotel: false } });
    expect(sellValue(space("Market Sq"))).toBe(50);
  });

  test("even selling: only from the most-built property", () => {
    const s = own(game(), "A", ORANGE);
    s.props[id("Market Sq")].houses = 2;
    s.props[id("Bridge St")].houses = 1;
    s.bankHouses -= 3;
    expect(canSellBuilding(s, "A", id("Bridge St"))).toMatchObject({ ok: false, reason: expect.stringMatching(/Sell evenly/) });
    expect(canSellBuilding(s, "A", id("Market Sq"))).toMatchObject({ ok: true });
  });

  test("a hotel sells back as 4 houses, which the bank must have in stock", () => {
    const s = own(game(), "A", ORANGE);
    for (const n of ORANGE) Object.assign(s.props[id(n)], { houses: 0, hotel: true });
    s.bankHotels -= 3;
    expect(canSellBuilding(s, "A", id("Market Sq"))).toMatchObject({ ok: true, after: { houses: 4, hotel: false } });
    s.bankHouses = 3;
    expect(canSellBuilding(s, "A", id("Market Sq"))).toMatchObject({ ok: false, reason: expect.stringMatching(/4 houses/) });
  });

  test("nothing to sell on a bare property", () => {
    const s = own(game(), "A", ORANGE);
    expect(canSellBuilding(s, "A", id("Market Sq"))).toMatchObject({ ok: false });
  });
});

describe("repairs, net worth", () => {
  test("repairs bill counts houses and hotels separately", () => {
    const s = own(game(), "A", ORANGE);
    s.props[id("Market Sq")].houses = 3;
    s.props[id("Bridge St")].houses = 2;
    Object.assign(s.props[id("Chapel Hill")], { houses: 0, hotel: true });
    expect(buildingCounts(s, "A")).toEqual({ houses: 5, hotels: 1 });
    expect(repairsBill(s, "A", 25, 100)).toBe(5 * 25 + 100);
    expect(repairsBill(s, "B", 25, 100)).toBe(0);
  });

  test("net worth = cash + deeds (mortgaged at mortgage value) + buildings at cost", () => {
    const s = own(game(), "A", ORANGE);
    s.props[id("Market Sq")].houses = 2; // 2 × 100
    s.props[id("Bridge St")].mortgaged = true; // 90 instead of 180
    s.players.A.cash = 100;
    expect(netWorthParts(s, "A")).toEqual({ cash: 100, property: 180 + 90 + 200, buildings: 200 });
    expect(netWorth(s, "A")).toBe(100 + 470 + 200);
    expect(netWorth(s, "B")).toBe(1500);
  });
});

describe("raiseMoneyOptions", () => {
  test("lists what can be sold or mortgaged and what it raises", () => {
    const s = own(game(), "A", ORANGE);
    s.props[id("Market Sq")].houses = 1;
    s.props[id("Bridge St")].houses = 1;
    s.props[id("Chapel Hill")].houses = 1;
    s.bankHouses -= 3;
    own(s, "A", ["Mill Lane"]);
    s.players.A.cash = 20;
    const r = raiseMoneyOptions(s, "A", 400);
    expect(r.shortBy).toBe(380);
    expect(r.options.filter((o) => o.kind === "sell_building")).toHaveLength(3);
    // The orange set has houses, so only Mill Lane can be mortgaged right now.
    expect(r.options.filter((o) => o.kind === "mortgage").map((o) => o.name)).toEqual(["Mill Lane"]);
    // Everything: 20 cash + 3×50 houses + orange 90+90+100 + brown 30.
    expect(r.maxCash).toBe(20 + 150 + 280 + 30);
    expect(r.canCover).toBe(true);
  });

  test("says when even a full liquidation can't cover the debt", () => {
    const s = own(game(), "A", ["Mill Lane"]);
    s.players.A.cash = 10;
    const r = raiseMoneyOptions(s, "A", 500);
    expect(r).toMatchObject({ maxCash: 40, canCover: false, shortBy: 490 });
  });

  test("a player who can afford it needs to raise nothing", () => {
    const r = raiseMoneyOptions(game(), "A", 100);
    expect(r).toMatchObject({ shortBy: 0, canCover: true });
  });
});

describe("stakes", () => {
  test("winner takes all", () => {
    expect(splitStakes(500, 4, [100])).toEqual({ pot: 2000, payouts: [2000] });
  });

  test("percentage split by finishing place", () => {
    expect(splitStakes(500, 5, [70, 30])).toEqual({ pot: 2500, payouts: [1750, 750] });
  });

  test("leftover rupees from rounding go to 1st, so payouts equal the pot", () => {
    const r = splitStakes(100, 3, [50, 30, 20]); // 300 → 150 / 90 / 60
    expect(r.payouts).toEqual([150, 90, 60]);
    const odd = splitStakes(33, 3, [60, 40]); // 99 → 59 / 39 + 1 leftover
    expect(odd.payouts.reduce((a, b) => a + b, 0)).toBe(99);
    expect(odd.payouts).toEqual([60, 39]);
  });

  test("a free game pays nothing", () => {
    expect(splitStakes(0, 4, [100])).toEqual({ pot: 0, payouts: [0] });
  });

  test("rejects splits that don't total 100 or pay more places than players", () => {
    expect(() => splitStakes(100, 4, [60, 30])).toThrow(/total 100/);
    expect(() => splitStakes(100, 2, [50, 30, 20])).toThrow(/at most 2/);
    expect(() => splitStakes(100, 4, [])).toThrow(RuleError);
    expect(() => splitStakes(100, 4, [50.5, 49.5])).toThrow(/whole numbers/);
    expect(() => splitStakes(-5, 4, [100])).toThrow(/Buy-in/);
  });
});

describe("settings and routing", () => {
  test("bankerApproves needs a banker; evenBuilding is ignored without deeds", () => {
    const base = { ...DEFAULT_SETTINGS };
    expect(() => validateSettings({ ...base, bankerMode: "bankerApproves" }, 3)).toThrow(/banker/);
    expect(() => validateSettings({ ...base, bankerMode: "bankerApproves", bankerPlayerId: "A" }, 3)).not.toThrow();
    expect(() => validateSettings({ ...base, trackProperties: false, evenBuilding: true }, 3)).not.toThrow();
  });

  test("taxes, fines, card payments and repairs go to the pot only when Free Parking is on", () => {
    const off = { ...DEFAULT_SETTINGS, freeParkingPot: false };
    const on = { ...DEFAULT_SETTINGS, freeParkingPot: true };
    for (const reason of ["tax", "jail_fine", "card", "repairs"] as const) {
      expect(bankSink(off, reason)).toBe(BANK);
      expect(bankSink(on, reason)).toBe(POT);
    }
    for (const reason of ["purchase", "build", "unmortgage", "interest", "bank"] as const) expect(bankSink(on, reason)).toBe(BANK);
  });
});

describe("turn order", () => {
  test("follows seat order, skips bankrupt players and wraps", () => {
    const s = game({}, ["A", "B", "C", "D"]);
    expect(nextPlayer(s, "A")).toBe("B");
    expect(nextPlayer(s, "D")).toBe("A");
    s.players.B.status = "bankrupt";
    expect(nextPlayer(s, "A")).toBe("C");
    s.players.C.status = "bankrupt";
    s.players.D.status = "bankrupt";
    expect(nextPlayer(s, "A")).toBeUndefined();
  });
});

describe("boardProblems", () => {
  test("a good board has none", () => {
    expect(boardProblems(CLASSIC)).toEqual([]);
  });
});
