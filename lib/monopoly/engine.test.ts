import { describe, expect, test } from "vitest";
import {
  applyEvents,
  checkUndo,
  createGame,
  gameIsOver,
  gameViolations,
  invertEvents,
  netBankFlow,
  planBankCollect,
  planBankruptcy,
  planBuild,
  planBuy,
  planCardEveryPlayer,
  planCollectPot,
  planDrawJailCard,
  planEndGame,
  planGoToJail,
  planJailTurn,
  planLeaveJail,
  planMortgage,
  planPassGo,
  planPayBank,
  planPayJailFine,
  planPlayerPay,
  planRent,
  planRepairs,
  planSellBuilding,
  planTrade,
  planUnmortgage,
  planUseJailCard,
  standings,
  touchedKeys,
  type GroupRecord,
} from "./engine";
import { CLASSIC } from "./presets";
import { BANK, DEFAULT_SETTINGS, POT, RuleError, type GameState, type MEvent, type Settings } from "./types";

const id = (name: string) => CLASSIC.spaces.find((s) => s.name === name)!.id;
const ORANGE = ["Market Sq", "Bridge St", "Chapel Hill"];

function game(settings: Partial<Settings> = {}, names = ["A", "B", "C"]): GameState {
  return createGame(structuredClone(CLASSIC), { ...DEFAULT_SETTINGS, ...settings }, names.map((n) => ({ id: n, name: n })));
}

/** Hands spaces to a player straight away (test setup, bypassing cash). */
function give(s: GameState, owner: string, names: string[], extra: Partial<GameState["props"][string]> = {}) {
  for (const n of names) Object.assign(s.props[id(n)], { owner }, extra);
  return s;
}

function expectRule(fn: () => unknown, code: string, message?: RegExp) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RuleError);
    expect((e as RuleError).code).toBe(code);
    if (message) expect((e as RuleError).message).toMatch(message);
    return e as RuleError;
  }
  throw new Error(`Expected ${code}, but nothing was thrown.`);
}

describe("createGame", () => {
  test("everyone starts on the preset's cash, the bank owns every deed, stock is full", () => {
    const s = game();
    expect(Object.values(s.players).map((p) => p.cash)).toEqual([1500, 1500, 1500]);
    expect(Object.keys(s.props)).toHaveLength(28);
    expect(Object.values(s.props).every((p) => p.owner === null && !p.mortgaged && p.houses === 0 && !p.hotel)).toBe(true);
    expect([s.bankHouses, s.bankHotels, s.pot]).toEqual([32, 12, 0]);
    expect(gameViolations(s, [])).toEqual([]);
  });

  test("money-only games have no property states", () => {
    const s = game({ trackProperties: false });
    expect(s.props).toEqual({});
    expect(gameViolations(s, [])).toEqual([]);
    expectRule(() => planBuy(s, "A", id("Market Sq")), "INVALID_ACTION");
  });
});

describe("cash can never go below 0", () => {
  test("a payment larger than the payer's cash is refused with who is short and by how much", () => {
    const s = game();
    const e = expectRule(() => planPlayerPay(s, "A", "B", 1501), "INSUFFICIENT_CASH", /A has only \$1,500 — \$1,501 needed/);
    expect(e.detail).toEqual({ playerId: "A", needed: 1501, shortBy: 1 });
    expect(planPlayerPay(s, "A", "B", 1500).after.players.A.cash).toBe(0);
  });

  test("the bank never runs out", () => {
    const s = game();
    let cur = s;
    for (let i = 0; i < 50; i++) cur = planBankCollect(cur, "A", 1_000_000).after;
    expect(cur.players.A.cash).toBe(1500 + 50_000_000);
  });

  test("amounts must be whole numbers above 0", () => {
    const s = game();
    for (const bad of [0, -5, 1.5, NaN, 2 ** 53]) expectRule(() => planPlayerPay(s, "A", "B", bad), "INVALID_ACTION");
  });

  test("planning never changes the state you pass in", () => {
    const s = game();
    const before = structuredClone(s);
    planPlayerPay(s, "A", "B", 100);
    expect(s).toEqual(before);
  });

  test("a failed group changes nothing: the second event fails, so the first doesn't apply either", () => {
    const s = game();
    const events: MEvent[] = [
      { type: "PAY", fromParty: "A", toParty: "B", amount: 100, meta: { reason: "payment" } },
      { type: "PAY", fromParty: "A", toParty: "B", amount: 5000, meta: { reason: "payment" } },
    ];
    expectRule(() => applyEvents(s, events), "INSUFFICIENT_CASH");
    expect(s.players.A.cash).toBe(1500);
  });
});

describe("Pass GO, pot and bank payments", () => {
  test("Pass GO pays the preset amount; landing exactly doubles it only with doubleOnGo", () => {
    expect(planPassGo(game(), "A").after.players.A.cash).toBe(1700);
    expect(planPassGo(game(), "A", { landedExactly: true }).after.players.A.cash).toBe(1700);
    const dbl = game({ doubleOnGo: true });
    expect(planPassGo(dbl, "A").after.players.A.cash).toBe(1700);
    expect(planPassGo(dbl, "A", { landedExactly: true }).after.players.A.cash).toBe(1900);
  });

  test("taxes go to the bank normally and into the pot with freeParkingPot on", () => {
    const off = planPayBank(game(), "A", 200, "tax");
    expect(off.after.pot).toBe(0);
    expect(off.events[0]).toMatchObject({ toParty: BANK });
    const on = planPayBank(game({ freeParkingPot: true }), "A", 200, "tax");
    expect(on.after.pot).toBe(200);
    expect(on.events[0]).toMatchObject({ toParty: POT });
  });

  test("purchases never feed the pot", () => {
    const s = game({ freeParkingPot: true });
    expect(planBuy(s, "A", id("Market Sq")).after.pot).toBe(0);
  });

  test("Collect pot pays it all to one player and refuses an empty pot", () => {
    let s = game({ freeParkingPot: true });
    expectRule(() => planCollectPot(s, "A"), "INVALID_ACTION", /empty/);
    s = planPayBank(s, "A", 200, "tax").after;
    s = planPayBank(s, "B", 50, "jail_fine").after;
    const got = planCollectPot(s, "C").after;
    expect(got.pot).toBe(0);
    expect(got.players.C.cash).toBe(1750);
  });
});

describe("buying and rent", () => {
  test("buy at the listed price: cash to the bank, deed to the buyer", () => {
    const s = planBuy(game(), "A", id("Market Sq")).after;
    expect(s.players.A.cash).toBe(1320);
    expect(s.props[id("Market Sq")].owner).toBe("A");
    expectRule(() => planBuy(s, "B", id("Market Sq")), "INVALID_ACTION", /already has an owner/);
    expectRule(() => planBuy(s, "B", "s00"), "INVALID_ACTION", /can't be bought/);
  });

  test("buying needs the cash", () => {
    const s = game();
    s.players.A.cash = 100;
    expectRule(() => planBuy(s, "A", id("Market Sq")), "INSUFFICIENT_CASH");
  });

  test("an auction can set another price", () => {
    const s = planBuy(game(), "A", id("Market Sq"), { price: 250, reason: "auction" }).after;
    expect(s.players.A.cash).toBe(1250);
  });

  test("landing on an owned space pays rent to the owner", () => {
    const s = give(game(), "A", ORANGE);
    const r = planRent(s, "B", id("Market Sq"));
    expect(r.due.amount).toBe(28);
    expect(r.after.players.B.cash).toBe(1472);
    expect(r.after.players.A.cash).toBe(1528);
  });

  test("no rent on your own, unowned or mortgaged property; utilities need the dice", () => {
    const s = give(game(), "A", ["Market Sq", "Power Co."]);
    expectRule(() => planRent(s, "A", id("Market Sq")), "INVALID_ACTION", /You own this/);
    expectRule(() => planRent(s, "B", id("Bridge St")), "INVALID_ACTION", /bank owns/);
    expectRule(() => planRent(s, "B", id("Power Co.")), "INVALID_ACTION", /dice total/);
    expect(planRent(s, "B", id("Power Co."), { diceTotal: 7 }).due.amount).toBe(28);
    s.props[id("Market Sq")].mortgaged = true;
    expectRule(() => planRent(s, "B", id("Market Sq")), "INVALID_ACTION", /Mortgaged/);
  });

  test("rent the payer can't afford opens the raise-money flow (INSUFFICIENT_CASH with a shortfall)", () => {
    const s = give(game(), "A", ORANGE, { hotel: true });
    s.bankHotels -= 3;
    s.players.B.cash = 900;
    const e = expectRule(() => planRent(s, "B", id("Market Sq")), "INSUFFICIENT_CASH");
    expect(e.detail).toEqual({ playerId: "B", needed: 950, shortBy: 50 });
  });
});

describe("building, selling, mortgages", () => {
  test("build charges the house cost and takes a house from the bank", () => {
    const s = give(game(), "A", ORANGE);
    const b = planBuild(s, "A", id("Market Sq")).after;
    expect(b.players.A.cash).toBe(1400);
    expect(b.props[id("Market Sq")].houses).toBe(1);
    expect(b.bankHouses).toBe(31);
  });

  test("the 4th house becomes a hotel and 4 houses go back to the bank", () => {
    let s = give(game(), "A", ORANGE);
    s.players.A.cash = 5000;
    for (let round = 0; round < 4; round++) for (const n of ORANGE) s = planBuild(s, "A", id(n)).after;
    expect(s.bankHouses).toBe(32 - 12);
    s = planBuild(s, "A", id("Market Sq")).after;
    expect(s.props[id("Market Sq")]).toMatchObject({ houses: 0, hotel: true });
    expect([s.bankHouses, s.bankHotels]).toEqual([32 - 8, 11]);
    expect(gameViolations(s)).toEqual([]);
  });

  test("building is refused without the set, and stock limits stop it", () => {
    const s = give(game(), "A", ["Market Sq", "Bridge St"]);
    expectRule(() => planBuild(s, "A", id("Market Sq")), "BLOCKED", /whole orange set/);
    give(s, "A", ["Chapel Hill"]);
    s.bankHouses = 0;
    expectRule(() => planBuild(s, "A", id("Market Sq")), "BLOCKED", /no houses left/);
  });

  test("selling returns half the cost and the house to the bank", () => {
    let s = give(game(), "A", ORANGE);
    s = planBuild(s, "A", id("Market Sq")).after;
    s = planSellBuilding(s, "A", id("Market Sq")).after;
    expect(s.players.A.cash).toBe(1500 - 100 + 50);
    expect(s.bankHouses).toBe(32);
  });

  test("mortgage pays the mortgage value; unmortgage costs it plus 10% rounded up", () => {
    let s = give(game(), "A", ["Power Co."]);
    s = planMortgage(s, "A", id("Power Co.")).after;
    expect(s.players.A.cash).toBe(1575);
    expect(s.props[id("Power Co.")].mortgaged).toBe(true);
    s = planUnmortgage(s, "A", id("Power Co.")).after;
    expect(s.players.A.cash).toBe(1575 - 83);
  });

  test("buildings in the set must be sold before mortgaging", () => {
    let s = give(game(), "A", ORANGE);
    s = planBuild(s, "A", id("Market Sq")).after;
    expectRule(() => planMortgage(s, "A", id("Bridge St")), "BLOCKED", /Sell the buildings/);
    s = planSellBuilding(s, "A", id("Market Sq")).after;
    expect(planMortgage(s, "A", id("Bridge St")).after.props[id("Bridge St")].mortgaged).toBe(true);
  });
});

describe("trades", () => {
  const side = (player: string, o: Partial<{ cash: number; spaceIds: string[]; jailCards: number }> = {}) => ({
    player,
    cash: 0,
    spaceIds: [] as string[],
    jailCards: 0,
    ...o,
  });

  test("cash, properties and jail cards swap atomically", () => {
    let s = give(game(), "A", ["Market Sq"]);
    s = give(s, "B", ["Mill Lane"]);
    s = planDrawJailCard(s, "B").after;
    const t = planTrade(s, {
      a: side("A", { cash: 300, spaceIds: [id("Market Sq")] }),
      b: side("B", { cash: 100, spaceIds: [id("Mill Lane")], jailCards: 1 }),
    }).after;
    // A offers $300 and B $100, so one net move: A pays B $200.
    expect(t.players.A.cash).toBe(1300);
    expect(t.players.B.cash).toBe(1700);
    expect(t.props[id("Market Sq")].owner).toBe("B");
    expect(t.props[id("Mill Lane")].owner).toBe("A");
    expect([t.players.A.jailCards, t.players.B.jailCards]).toEqual([1, 0]);
  });

  test("a mortgaged property received costs the receiver 10% interest at once", () => {
    const s = give(game(), "A", ["Power Co."], { mortgaged: true });
    const t = planTrade(s, { a: side("A", { spaceIds: [id("Power Co.")] }), b: side("B", { cash: 50 }) }).after;
    expect(t.props[id("Power Co.")]).toMatchObject({ owner: "B", mortgaged: true });
    expect(t.players.B.cash).toBe(1500 - 50 - 8);
    expect(t.players.A.cash).toBe(1550);
  });

  test("interest can be paid out of cash received in the same trade", () => {
    const s = give(game(), "A", ["North Stn"], { mortgaged: true });
    s.players.B.cash = 5;
    const t = planTrade(s, { a: side("A", { spaceIds: [id("North Stn")], cash: 100 }), b: side("B") }).after;
    // B receives 100 − then pays 10 interest.
    expect(t.players.B.cash).toBe(95);
  });

  test("the whole trade fails if either side can't pay", () => {
    const s = give(game(), "A", ["Market Sq"]);
    s.players.B.cash = 50;
    expectRule(() => planTrade(s, { a: side("A", { spaceIds: [id("Market Sq")] }), b: side("B", { cash: 200 }) }), "INSUFFICIENT_CASH");
    expect(s.props[id("Market Sq")].owner).toBe("A");
  });

  test("only the owner can trade a property, and buildings must be sold first", () => {
    const s = give(game(), "A", ORANGE);
    expectRule(() => planTrade(s, { a: side("A"), b: side("B", { spaceIds: [id("Market Sq")] }) }), "NOT_OWNER");
    const built = planBuild(s, "A", id("Market Sq")).after;
    expectRule(() => planTrade(built, { a: side("A", { spaceIds: [id("Bridge St")] }), b: side("B", { cash: 10 }) }), "BLOCKED", /Sell the buildings/);
  });

  test("rejects empty trades, self trades and jail cards a player doesn't hold", () => {
    const s = game();
    expectRule(() => planTrade(s, { a: side("A"), b: side("B") }), "INVALID_ACTION", /Add something/);
    expectRule(() => planTrade(s, { a: side("A", { cash: 5 }), b: side("A") }), "INVALID_ACTION", /two different/);
    expectRule(() => planTrade(s, { a: side("A", { jailCards: 1 }), b: side("B") }), "INVALID_ACTION", /doesn't hold/);
  });
});

describe("card actions", () => {
  test("collect from every player is one atomic group", () => {
    const s = game({}, ["A", "B", "C", "D"]);
    const r = planCardEveryPlayer(s, "A", 50, "collect");
    expect(r.events).toHaveLength(3);
    expect(r.after.players.A.cash).toBe(1650);
    expect([r.after.players.B.cash, r.after.players.C.cash, r.after.players.D.cash]).toEqual([1450, 1450, 1450]);
  });

  test("if any payer can't afford it the whole card fails, and names who", () => {
    const s = game({}, ["A", "B", "C", "D"]);
    s.players.C.cash = 20;
    const e = expectRule(() => planCardEveryPlayer(s, "A", 50, "collect"), "INSUFFICIENT_CASH", /C can't afford \$50/);
    expect(e.detail).toEqual({ playerId: "C", needed: 50, shortBy: 30 });
    expect(s.players.A.cash).toBe(1500);
  });

  test("pay to every player needs amount × others in cash", () => {
    const s = game({}, ["A", "B", "C", "D"]);
    s.players.A.cash = 149;
    expectRule(() => planCardEveryPlayer(s, "A", 50, "pay"), "INSUFFICIENT_CASH");
    s.players.A.cash = 150;
    const r = planCardEveryPlayer(s, "A", 50, "pay");
    expect(r.after.players.A.cash).toBe(0);
    expect(r.after.players.B.cash).toBe(1550);
  });

  test("bankrupt players are skipped", () => {
    const s = game({}, ["A", "B", "C"]);
    s.players.C.status = "bankrupt";
    s.players.C.cash = 0;
    expect(planCardEveryPlayer(s, "A", 50, "collect").events).toHaveLength(1);
  });

  test("repairs bill houses and hotels by the card's amounts; zero buildings means nothing to pay", () => {
    let s = give(game(), "A", ORANGE);
    expectRule(() => planRepairs(s, "A", 25, 100), "INVALID_ACTION", /no buildings/);
    s = planBuild(s, "A", id("Market Sq")).after;
    s = planBuild(s, "A", id("Bridge St")).after;
    const r = planRepairs(s, "A", 25, 100);
    expect(r.bill).toBe(50);
    expect(r.after.players.A.cash).toBe(s.players.A.cash - 50);
  });

  test("repairs go into the pot when Free Parking is on", () => {
    let s = give(game({ freeParkingPot: true }), "A", ORANGE);
    s = planBuild(s, "A", id("Market Sq")).after;
    expect(planRepairs(s, "A", 40, 115).after.pot).toBe(40);
  });
});

describe("jail", () => {
  test("go to jail, count turns, pay the fine to leave", () => {
    let s = planGoToJail(game(), "A").after;
    expect(s.players.A).toMatchObject({ inJail: true, jailTurns: 0 });
    s = planJailTurn(s, "A").after;
    s = planJailTurn(s, "A").after;
    expect(s.players.A.jailTurns).toBe(2);
    s = planPayJailFine(s, "A").after;
    expect(s.players.A).toMatchObject({ inJail: false, jailTurns: 0, cash: 1450 });
    expectRule(() => planPayJailFine(s, "A"), "INVALID_ACTION", /isn't in jail/);
    expectRule(() => planGoToJail(planGoToJail(game(), "B").after, "B"), "INVALID_ACTION", /already in jail/);
  });

  test("the jail fine goes to the pot when Free Parking is on", () => {
    let s = planGoToJail(game({ freeParkingPot: true }), "A").after;
    s = planPayJailFine(s, "A").after;
    expect(s.pot).toBe(50);
  });

  test("a Get Out of Jail Free card is tracked, used and returned to the deck", () => {
    let s = planDrawJailCard(game(), "A").after;
    expect(s.players.A.jailCards).toBe(1);
    expectRule(() => planUseJailCard(s, "A"), "INVALID_ACTION", /isn't in jail/);
    s = planGoToJail(s, "A").after;
    s = planUseJailCard(s, "A").after;
    expect(s.players.A).toMatchObject({ inJail: false, jailCards: 0, cash: 1500 });
    expectRule(() => planUseJailCard(planGoToJail(s, "A").after, "A"), "INVALID_ACTION", /no Get Out of Jail Free/);
  });

  test("only two cards exist", () => {
    let s = planDrawJailCard(game(), "A").after;
    s = planDrawJailCard(s, "B").after;
    expectRule(() => planDrawJailCard(s, "C"), "BANK_STOCK", /already held/);
  });

  test("leaving on doubles costs nothing", () => {
    const s = planLeaveJail(planGoToJail(game(), "A").after, "A").after;
    expect(s.players.A).toMatchObject({ inJail: false, cash: 1500 });
  });
});

describe("bankruptcy", () => {
  /** A owns the orange set with 1 house on each, a mortgaged station and a jail card; owes more than they have. */
  function broke() {
    let s = give(game({}, ["A", "B", "C"]), "A", ORANGE);
    s.players.A.cash = 5000;
    for (const n of ORANGE) s = planBuild(s, "A", id(n)).after;
    s = give(s, "A", ["North Stn"], { mortgaged: true });
    s = planDrawJailCard(s, "A").after;
    s.players.A.cash = 40;
    return s;
  }

  test("to a player: buildings sold at half cost, then cash, deeds and cards go to the creditor, who pays 10% on mortgages", () => {
    const s = broke();
    const r = planBankruptcy(s, "A", "B");
    const a = r.after;
    // 3 houses × half of 100 = 150 → A holds 190 → all of it to B, minus the station's 10 interest.
    expect(a.players.B.cash).toBe(1500 + 190 - 10);
    expect(a.players.A).toMatchObject({ cash: 0, status: "bankrupt", finishPosition: 3, jailCards: 0 });
    expect(a.players.B.jailCards).toBe(1);
    for (const n of [...ORANGE, "North Stn"]) expect(a.props[id(n)].owner).toBe("B");
    expect(a.props[id("North Stn")].mortgaged).toBe(true);
    for (const n of ORANGE) expect(a.props[id(n)]).toMatchObject({ houses: 0, hotel: false });
    expect(a.bankHouses).toBe(32);
    expect(r.winnerId).toBeUndefined();
    expect(r.toAuction).toEqual([]);
    expect(gameViolations(a)).toEqual([]);
  });

  test("a creditor who can't cover the 10% interest blocks the bankruptcy until they raise money", () => {
    const s = give(game(), "A", ["North Stn"], { mortgaged: true });
    s.players.B.cash = 0;
    s.players.A.cash = 0;
    const e = expectRule(() => planBankruptcy(s, "A", "B"), "INSUFFICIENT_CASH");
    expect(e.detail).toEqual({ playerId: "B", needed: 10, shortBy: 10 });
    s.players.B.cash = 10;
    expect(planBankruptcy(s, "A", "B").after.players.B.cash).toBe(0);
  });

  test("cash from the debtor's sold buildings can fund the creditor's interest", () => {
    let s = give(game(), "A", ORANGE);
    s.players.A.cash = 5000;
    for (const n of ORANGE) s = planBuild(s, "A", id(n)).after;
    s = give(s, "A", ["North Stn"], { mortgaged: true });
    s.players.A.cash = 0;
    s.players.B.cash = 0;
    expect(planBankruptcy(s, "A", "B").after.players.B.cash).toBe(150 - 10);
  });

  test("to the bank: cash goes to the bank, deeds return unmortgaged and are queued for auction", () => {
    const s = broke();
    const r = planBankruptcy(s, "A", BANK);
    const a = r.after;
    expect(a.players.A).toMatchObject({ cash: 0, status: "bankrupt", jailCards: 0 });
    expect(a.players.B.cash).toBe(1500);
    for (const n of [...ORANGE, "North Stn"]) expect(a.props[id(n)]).toMatchObject({ owner: null, mortgaged: false, houses: 0 });
    expect(r.toAuction.sort()).toEqual([...ORANGE, "North Stn"].map(id).sort());
    expect(a.bankHouses).toBe(32);
    expect(a.players.A.jailCards + a.players.B.jailCards + a.players.C.jailCards).toBe(0);
    expect(gameViolations(a)).toEqual([]);
  });

  test("with auctions off nothing is queued", () => {
    const s = give(game({ auctions: false }), "A", ["Market Sq"]);
    expect(planBankruptcy(s, "A", BANK).toAuction).toEqual([]);
  });

  test("money-only games hand over cash only", () => {
    const s = game({ trackProperties: false });
    s.players.A.cash = 70;
    const a = planBankruptcy(s, "A", "B").after;
    expect(a.players.B.cash).toBe(1570);
    expect(a.players.A.status).toBe("bankrupt");
  });

  test("finishing places go in reverse order and the last player standing wins", () => {
    let s = game({}, ["A", "B", "C", "D"]);
    s = planBankruptcy(s, "B", "A").after;
    expect(s.players.B.finishPosition).toBe(4);
    s = planBankruptcy(s, "D", BANK).after;
    expect(s.players.D.finishPosition).toBe(3);
    const last = planBankruptcy(s, "C", "A");
    expect(last.winnerId).toBe("A");
    expect(last.after.players.C.finishPosition).toBe(2);
    expect(last.after.players.A.finishPosition).toBe(1);
    expect(gameIsOver(last.after)).toBe(true);
    expect(standings(last.after).map((x) => x.playerId)).toEqual(["A", "C", "D", "B"]);
  });

  test("can't go bankrupt to yourself or to a player who is out", () => {
    let s = game();
    expectRule(() => planBankruptcy(s, "A", "A"), "INVALID_ACTION");
    s = planBankruptcy(s, "B", "A").after;
    expectRule(() => planBankruptcy(s, "A", "B"), "INVALID_ACTION", /out of the game/);
  });

  test("a bankrupt player can't take part any more", () => {
    const s = planBankruptcy(game(), "B", "A").after;
    expectRule(() => planPlayerPay(s, "B", "A", 1), "INVALID_ACTION");
    expectRule(() => planPlayerPay(s, "A", "B", 1), "INVALID_ACTION");
  });

  test("free parking pot isn't touched by a bankruptcy", () => {
    let s = game({ freeParkingPot: true });
    s = planPayBank(s, "A", 200, "tax").after;
    expect(planBankruptcy(s, "B", BANK).after.pot).toBe(200);
  });
});

describe("ending a game early", () => {
  test("positions default to net worth, with the host able to reorder", () => {
    let s = give(game(), "B", ORANGE);
    s.players.A.cash = 100;
    s.players.C.cash = 900;
    const proposed = planEndGame(s);
    expect(standings(proposed.after).map((x) => x.playerId)).toEqual(["B", "C", "A"]);
    const custom = planEndGame(s, ["A", "B", "C"]);
    expect(standings(custom.after).map((x) => x.playerId)).toEqual(["A", "B", "C"]);
  });

  test("bankrupt players keep their places and only the rest are ranked", () => {
    let s = planBankruptcy(game({}, ["A", "B", "C", "D"]), "D", "A").after;
    const end = planEndGame(s).after;
    expect(end.players.D.finishPosition).toBe(4);
    expect(standings(end)).toHaveLength(4);
    expectRule(() => planEndGame(s, ["A", "B"]), "INVALID_ACTION", /every player/);
  });

  test("refuses when everyone already has a place", () => {
    const done = planEndGame(game()).after;
    expectRule(() => planEndGame(done), "INVALID_ACTION", /already has a finishing place/);
  });
});

describe("undo", () => {
  function group(groupId: string, label: string, events: MEvent[], reversesGroupId?: string): GroupRecord {
    return { groupId, label, events, reversesGroupId };
  }

  test("inverse events restore the exact previous state, for every kind of group", () => {
    let s = give(game(), "A", ORANGE);
    s = planDrawJailCard(s, "B").after;
    const inJail = planGoToJail(s, "B").after;
    const mortgaged = give(structuredClone(s), "C", ["Power Co."], { mortgaged: true });
    const cases: { base: GameState; plan: { events: MEvent[]; after: GameState } }[] = [
      { base: s, plan: planBuy(s, "B", id("Mill Lane")) },
      { base: s, plan: planBuild(s, "A", id("Market Sq")) },
      { base: inJail, plan: planPayJailFine(inJail, "B") },
      { base: inJail, plan: planUseJailCard(inJail, "B") },
      { base: s, plan: planTrade(s, { a: { player: "A", cash: 10, spaceIds: [id("Market Sq")], jailCards: 0 }, b: { player: "B", cash: 0, spaceIds: [], jailCards: 1 } }) },
      { base: mortgaged, plan: planTrade(mortgaged, { a: { player: "C", cash: 0, spaceIds: [id("Power Co.")], jailCards: 0 }, b: { player: "A", cash: 5, spaceIds: [], jailCards: 0 } }) },
      { base: s, plan: planBankruptcy(s, "C", "A") },
      { base: mortgaged, plan: planBankruptcy(mortgaged, "C", BANK) },
      { base: s, plan: planCardEveryPlayer(s, "A", 20, "collect") },
      { base: s, plan: planEndGame(s) },
    ];
    for (const { base, plan } of cases) {
      expect(applyEvents(plan.after, invertEvents(plan.events))).toEqual(base);
    }
  });

  test("a bankruptcy that ended the game inverts completely, including the winner's place", () => {
    const s = game({}, ["A", "B"]);
    const r = planBankruptcy(s, "B", "A");
    expect(gameIsOver(r.after)).toBe(true);
    const back = applyEvents(r.after, invertEvents(r.events));
    expect(back).toEqual(s);
  });

  test("a group touching the same player's cash blocks an earlier undo, and the error names it", () => {
    const g1 = group("g1", "A paid B $100", planPlayerPay(game(), "A", "B", 100).events);
    const g2 = group("g2", "B paid C $50", planPlayerPay(game(), "B", "C", 50).events);
    const verdict = checkUndo([g1, g2], "g1");
    expect(verdict).toMatchObject({ ok: false, code: "BLOCKED", reason: expect.stringContaining('Undo "B paid C $50" first') });
    expect(checkUndo([g1, g2], "g2")).toEqual({ ok: true });
  });

  test("groups touching different players and properties don't block each other", () => {
    const g1 = group("g1", "A paid B", planPlayerPay(game(), "A", "B", 100).events);
    const g2 = group("g2", "C paid the bank", planPayBank(game(), "C", 50, "tax").events);
    expect(checkUndo([g1, g2], "g1")).toEqual({ ok: true });
  });

  test("a later group on the same property blocks, even if no cash is shared", () => {
    const base = give(game(), "A", ORANGE);
    const build = planBuild(base, "A", id("Market Sq"));
    const mort = planMortgage(base, "A", id("Market Sq"));
    expect(touchedKeys(build.events).has(`prop:${id("Market Sq")}`)).toBe(true);
    expect(checkUndo([group("g1", "A built", build.events), group("g2", "A mortgaged", mort.events)], "g1")).toMatchObject({ ok: false, code: "BLOCKED" });
  });

  test("a later group that was itself undone no longer blocks", () => {
    const pay1 = planPlayerPay(game(), "A", "B", 100).events;
    const pay2 = planPlayerPay(game(), "B", "C", 50).events;
    const groups = [
      group("g1", "A paid B", pay1),
      group("g2", "B paid C", pay2),
      group("g3", "Undo: B paid C", invertEvents(pay2), "g2"),
    ];
    expect(checkUndo(groups, "g1")).toEqual({ ok: true });
  });

  test("a player who has since gone out blocks the undo of an action they were in, even when nothing else is shared", () => {
    const base = game({}, ["A", "B", "C"]);
    base.players.C.cash = 0; // C's bankruptcy then touches only their finishing status, no cash or deeds
    const toJail = planGoToJail(base, "C");
    const out = planBankruptcy(base, "C", BANK);
    expect([...touchedKeys(toJail.events)]).toEqual(["jail:C"]);
    expect([...touchedKeys(out.events)]).toEqual(["status:C"]);
    const blocked = checkUndo([group("g1", "C went to jail", toJail.events), group("g2", "C went bankrupt", out.events)], "g1");
    expect(blocked).toMatchObject({ ok: false, code: "BLOCKED", reason: expect.stringMatching(/has left the game/) });

    // Someone else going out doesn't matter.
    const other = planBankruptcy(base, "B", BANK);
    expect(checkUndo([group("g1", "C went to jail", toJail.events), group("g2", "B went bankrupt", other.events)], "g1")).toEqual({ ok: true });
  });

  test("an undo can't be undone, and an undone group can't be undone twice", () => {
    const pay = planPlayerPay(game(), "A", "B", 100).events;
    const groups = [group("g1", "A paid B", pay), group("g2", "Undo", invertEvents(pay), "g1")];
    expect(checkUndo(groups, "g2")).toMatchObject({ ok: false, code: "NOT_UNDOABLE" });
    expect(checkUndo(groups, "g1")).toMatchObject({ ok: false, code: "ALREADY_REVERSED" });
    expect(checkUndo(groups, "missing")).toMatchObject({ ok: false, code: "NOT_UNDOABLE" });
  });

  test("undoing a sale the seller has since spent is blocked by the cash rule, not left to fail", () => {
    const s0 = give(game(), "A", ORANGE);
    const sell = planBuild(s0, "A", id("Market Sq"));
    const afterBuild = sell.after;
    const sold = planSellBuilding(afterBuild, "A", id("Market Sq"));
    const spend = planPlayerPay(sold.after, "A", "B", 1300);
    const groups = [group("g1", "A sold a house", sold.events), group("g2", "A paid B $1,300", spend.events)];
    expect(checkUndo(groups, "g1")).toMatchObject({ ok: false, code: "BLOCKED" });
  });
});

describe("invariants", () => {
  test("cash + pot = starting cash × players + net bank flow after a mix of actions", () => {
    let s = game({ freeParkingPot: true });
    const all: MEvent[] = [];
    const step = (p: { events: MEvent[]; after: GameState }) => {
      all.push(...p.events);
      s = p.after;
    };
    step(planPassGo(s, "A"));
    step(planBuy(s, "B", id("Market Sq")));
    step(planPayBank(s, "C", 200, "tax"));
    step(planPlayerPay(s, "C", "A", 120));
    step(planMortgage(s, "B", id("Market Sq")));
    step(planCollectPot(s, "A"));
    expect(gameViolations(s, all)).toEqual([]);
    expect(netBankFlow(all)).toBe(200 - 180 + 90);
  });

  test("detects broken states", () => {
    const s = game();
    s.players.A.cash = -5;
    s.props[id("Market Sq")].houses = 2;
    s.bankHouses = 32;
    s.props[id("Bridge St")].mortgaged = true;
    s.props[id("Bridge St")].owner = "B";
    s.props[id("Bridge St")].houses = 1;
    const v = gameViolations(s, []);
    expect(v).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/negative cash/),
        expect.stringMatching(/houses 3 \+ bank 32/),
        expect.stringMatching(/mortgaged with buildings/),
        expect.stringMatching(/unowned with buildings/),
      ]),
    );
  });

  test("detects cash created from nowhere", () => {
    const s = game();
    s.players.A.cash += 100;
    expect(gameViolations(s, [])).toEqual([expect.stringMatching(/starting cash × players/)]);
  });
});
