import { describe, expect, test } from "vitest";
import { describeGroup } from "./describe";
import {
  createGame,
  planBankCollect,
  planBankruptcy,
  planBuild,
  planBuy,
  planCardEveryPlayer,
  planCollectPot,
  planGoToJail,
  planMortgage,
  planPassGo,
  planPayBank,
  planPlayerPay,
  planRent,
  planTrade,
} from "./engine";
import { CLASSIC } from "./presets";
import { BANK, DEFAULT_SETTINGS, type GameState, type Settings } from "./types";

const id = (name: string) => CLASSIC.spaces.find((s) => s.name === name)!.id;
const game = (s: Partial<Settings> = {}): GameState =>
  createGame(structuredClone(CLASSIC), { ...DEFAULT_SETTINGS, ...s }, ["Arjun", "Priya", "Meera"].map((n) => ({ id: n, name: n })));
const say = (events: Parameters<typeof describeGroup>[0]) => describeGroup(events, { board: CLASSIC, name: (p) => p });

describe("describeGroup", () => {
  test("bank and player payments", () => {
    const s = game();
    expect(say(planPassGo(s, "Arjun").events)).toBe("Arjun passed GO and collected $200");
    expect(say(planPassGo(game({ doubleOnGo: true }), "Arjun", { landedExactly: true }).events)).toBe("Arjun landed on GO and collected $400");
    expect(say(planPlayerPay(s, "Priya", "Arjun", 300).events)).toBe("Priya paid Arjun $300");
    expect(say(planBankCollect(s, "Meera", 150).events)).toBe("Meera collected $150 from the bank");
    expect(say(planPayBank(s, "Meera", 75, "bank").events)).toBe("Meera paid the bank $75");
  });

  test("taxes, pot and cards", () => {
    const on = game({ freeParkingPot: true });
    expect(say(planPayBank(on, "Arjun", 200, "tax").events)).toBe("Arjun paid $200 tax into the Free Parking pot");
    expect(say(planPayBank(game(), "Arjun", 200, "tax").events)).toBe("Arjun paid $200 tax");
    const potted = planPayBank(on, "Arjun", 200, "tax").after;
    expect(say(planCollectPot(potted, "Priya").events)).toBe("Priya collected the Free Parking pot, $200");
    expect(say(planCardEveryPlayer(game(), "Arjun", 50, "collect").events)).toBe("Arjun collected $50 from every player");
    expect(say(planCardEveryPlayer(game(), "Arjun", 50, "pay").events)).toBe("Arjun paid $50 to every player");
  });

  test("properties, rent, buildings, mortgages", () => {
    let s = planBuy(game(), "Arjun", id("Market Sq")).after;
    expect(say(planBuy(game(), "Arjun", id("Market Sq")).events)).toBe("Arjun bought Market Sq for $180");
    expect(say(planRent(s, "Priya", id("Market Sq")).events)).toBe("Priya paid Arjun $14 rent for Market Sq");
    for (const n of ["Bridge St", "Chapel Hill"]) s = planBuy(s, "Arjun", id(n)).after;
    expect(say(planBuild(s, "Arjun", id("Market Sq")).events)).toBe("Arjun built on Market Sq");
    expect(say(planMortgage(planBuy(game(), "Priya", id("Power Co.")).after, "Priya", id("Power Co.")).events)).toBe("Priya mortgaged Power Co.");
  });

  test("trades, jail and bankruptcy", () => {
    const s = planBuy(game(), "Arjun", id("Market Sq")).after;
    const trade = planTrade(s, {
      a: { player: "Arjun", cash: 0, spaceIds: [id("Market Sq")], jailCards: 0 },
      b: { player: "Priya", cash: 100, spaceIds: [], jailCards: 0 },
    });
    expect(say(trade.events)).toBe("Arjun traded with Priya");
    expect(say(planGoToJail(game(), "Meera").events)).toBe("Meera went to jail");
    expect(say(planBankruptcy(game(), "Priya", "Arjun").events)).toBe("Priya went bankrupt to Arjun");
    expect(say(planBankruptcy(game(), "Priya", BANK).events)).toBe("Priya went bankrupt to the bank");
  });
});
