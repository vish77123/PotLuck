import { formatMoney } from "./money";
import type { BoardConfig, MEvent, PayEvent } from "./types";
import { BANK, POT } from "./types";

export type DescribeContext = {
  board: BoardConfig;
  name: (playerId: string) => string;
};

/** A one-sentence, plain-language description of one group of events, e.g. "Rahul paid Priya $200 rent for Summit Dr". */
export function describeGroup(events: MEvent[], ctx: DescribeContext): string {
  const money = (n: number) => formatMoney(n, ctx.board.currency);
  const who = (p: string | undefined) => (p === BANK ? "the bank" : p === POT ? "Free Parking" : p ? ctx.name(p) : "Someone");
  const space = (id?: string) => ctx.board.spaces.find((s) => s.id === id)?.name ?? "a space";

  const pays = events.filter((e): e is PayEvent => e.type === "PAY");
  const has = (t: MEvent["type"]) => events.some((e) => e.type === t);

  const bankrupt = events.find((e) => e.type === "BANKRUPT" && !e.meta.undo);
  if (bankrupt && bankrupt.type === "BANKRUPT") {
    const creditor = events.find((e) => e.type === "PAY" && e.meta?.reason === "bankruptcy");
    const to = creditor && creditor.type === "PAY" ? who(creditor.toParty) : events.find((e) => e.type === "PROPERTY") ? who((events.find((e) => e.type === "PROPERTY") as { toParty: string }).toParty) : "the bank";
    return `${ctx.name(bankrupt.meta.player)} went bankrupt to ${to}`;
  }
  if (has("FINISH") && !has("PAY")) return "The game ended and places were set";

  const first = pays[0];
  if (events.length === 1 && first) {
    const reason = first.meta?.reason;
    const a = first.amount;
    switch (reason) {
      case "pass_go":
        return `${who(first.toParty)} passed GO and collected ${money(a)}`;
      case "go_bonus":
        return `${who(first.toParty)} landed on GO and collected ${money(a)}`;
      case "rent":
        return `${who(first.fromParty)} paid ${who(first.toParty)} ${money(a)} rent for ${space(first.spaceId)}`;
      case "tax":
        return `${who(first.fromParty)} paid ${money(a)} tax${first.toParty === POT ? " into the Free Parking pot" : ""}`;
      case "jail_fine":
        return `${who(first.fromParty)} paid the ${money(a)} jail fine`;
      case "card":
        return first.fromParty === BANK ? `${who(first.toParty)} collected ${money(a)} from a card` : `${who(first.fromParty)} paid ${money(a)} on a card`;
      case "repairs":
        return `${who(first.fromParty)} paid ${money(a)} for repairs`;
      case "pot":
        return `${who(first.toParty)} collected the Free Parking pot, ${money(a)}`;
      default:
        if (first.fromParty === BANK) return `${who(first.toParty)} collected ${money(a)} from the bank`;
        if (first.toParty === BANK) return `${who(first.fromParty)} paid the bank ${money(a)}`;
        if (first.toParty === POT) return `${who(first.fromParty)} paid ${money(a)} into the Free Parking pot`;
        return `${who(first.fromParty)} paid ${who(first.toParty)} ${money(a)}`;
    }
  }

  const prop = events.find((e) => e.type === "PROPERTY");
  if (prop && prop.type === "PROPERTY") {
    const buy = pays.find((p) => p.meta?.reason === "purchase" || p.meta?.reason === "auction");
    if (buy) return `${who(buy.fromParty)} bought ${space(prop.spaceId)} for ${money(buy.amount)}`;
    if (pays.some((p) => p.meta?.reason === "trade") || events.filter((e) => e.type === "PROPERTY").length > 0) {
      const parties = new Set<string>();
      for (const e of events) if (e.type === "PROPERTY" || e.type === "PAY") [e.fromParty, e.toParty].forEach((p) => p !== BANK && p !== POT && parties.add(p));
      // Lead with whoever handed over the first property, so the sentence doesn't depend on the order of the cash move.
      const lead = prop.fromParty !== BANK ? prop.fromParty : [...parties][0];
      const other = [...parties].find((p) => p !== lead);
      if (lead && other) return `${who(lead)} traded with ${who(other)}`;
    }
  }

  const cardPays = pays.filter((p) => p.meta?.reason === "card");
  if (cardPays.length > 1) {
    const same = cardPays.every((p) => p.amount === cardPays[0].amount);
    const collector = cardPays.every((p) => p.toParty === cardPays[0].toParty);
    if (same && collector) return `${who(cardPays[0].toParty)} collected ${money(cardPays[0].amount)} from every player`;
    if (same && cardPays.every((p) => p.fromParty === cardPays[0].fromParty)) return `${who(cardPays[0].fromParty)} paid ${money(cardPays[0].amount)} to every player`;
  }

  const jail = events.find((e) => e.type === "JAIL");
  if (jail && jail.type === "JAIL") {
    const name = ctx.name(jail.meta.player);
    if (jail.meta.after.inJail && !jail.meta.before.inJail) return `${name} went to jail`;
    if (!jail.meta.after.inJail) return `${name} got out of jail`;
    return `${name} spent a turn in jail`;
  }
  const b = events.find((e) => e.type === "BUILDINGS");
  if (b && b.type === "BUILDINGS") {
    const grew = (b.meta.after.hotel ? 5 : b.meta.after.houses) > (b.meta.before.hotel ? 5 : b.meta.before.houses);
    const payer = pays[0];
    return `${who(grew ? payer?.fromParty : payer?.toParty)} ${grew ? "built on" : "sold a building on"} ${space(b.spaceId)}`;
  }
  const m = events.find((e) => e.type === "MORTGAGE");
  if (m && m.type === "MORTGAGE") return `${who(pays[0]?.fromParty === BANK ? pays[0]?.toParty : pays[0]?.fromParty)} ${m.meta.mortgaged ? "mortgaged" : "unmortgaged"} ${space(m.spaceId)}`;

  return events.length === 1 ? "A move was recorded" : `${events.length} moves were recorded`;
}
