// The Monopoly engine: a pure reducer over atomic events, planners that turn one user action into a group of
// events, and the undo and invariant checks. The Convex layer (applyMonopolyGroup) runs the same reducer.
import { formatMoney } from "./money";
import {
  bankSink,
  canBuild,
  canMortgage,
  canSellBuilding,
  canUnmortgage,
  interestOn,
  isOwnable,
  levelOf,
  netWorth,
  ownableSpaces,
  ownedSpaces,
  playingPlayers,
  propOf,
  rentFor,
  repairsBill,
  sellValue,
  spaceOf,
  validateSettings,
} from "./rules";
import {
  BANK,
  POT,
  RuleError,
  type BoardConfig,
  type GameState,
  type MEvent,
  type Party,
  type PayReason,
  type PlayerState,
  type PropState,
  type Settings,
} from "./types";

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

/** A fresh game: everyone on starting cash in seat order, every ownable space with the bank. */
export function createGame(
  board: BoardConfig,
  settings: Settings,
  players: { id: string; name?: string }[],
): GameState {
  validateSettings(settings, players.length);
  const state: GameState = {
    board,
    settings,
    players: {},
    props: {},
    pot: 0,
    bankHouses: board.houses,
    bankHotels: board.hotels,
  };
  players.forEach((p, i) => {
    state.players[p.id] = {
      id: p.id,
      name: p.name,
      seat: i + 1,
      cash: board.startingCash,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      status: "playing",
    };
  });
  if (settings.trackProperties) {
    for (const s of ownableSpaces(board)) state.props[s.id] = { owner: null, houses: 0, hotel: false, mortgaged: false };
  }
  return state;
}

function money(state: GameState, n: number) {
  return formatMoney(n, state.board.currency);
}

function nameOf(state: GameState, id: string) {
  return state.players[id]?.name ?? "That player";
}

// ---------------------------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------------------------

function assertWholeAmount(amount: number | undefined): number {
  if (amount === undefined || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new RuleError("INVALID_ACTION", "Amount must be a whole number above 0.");
  }
  return amount;
}

function assertParty(state: GameState, party: Party | undefined): Party {
  if (party === undefined) throw new RuleError("INVALID_ACTION", "Missing player.");
  if (party === BANK || party === POT) return party;
  const p = state.players[party];
  if (!p) throw new RuleError("NOT_FOUND", "That player isn't in this game.");
  if (p.status !== "playing") throw new RuleError("INVALID_ACTION", `${p.name ?? "That player"} is out of the game.`);
  return party;
}

function heldJailCards(state: GameState) {
  return Object.values(state.players).reduce((s, p) => s + p.jailCards, 0);
}

/** Applies a group of events to a copy of the state. Throws a RuleError at the first rule it would break. */
export function applyEvents(state: GameState, events: MEvent[]): GameState {
  const next = structuredClone(state);
  for (const e of events) applyEvent(next, e);
  return next;
}

function applyEvent(s: GameState, e: MEvent) {
  switch (e.type) {
    case "PAY": {
      const amount = assertWholeAmount(e.amount);
      const from = assertParty(s, e.fromParty);
      const to = assertParty(s, e.toParty);
      if (from === to) throw new RuleError("INVALID_ACTION", "Nobody can pay themselves.");
      if (from === POT) {
        if (s.pot < amount) throw new RuleError("INVALID_ACTION", `The pot has only ${money(s, s.pot)}.`);
        s.pot -= amount;
      } else if (from !== BANK) {
        const p = s.players[from];
        if (p.cash < amount) {
          throw new RuleError(
            "INSUFFICIENT_CASH",
            `${p.name ?? "That player"} has only ${money(s, p.cash)} — ${money(s, amount)} needed.`,
            { playerId: from, needed: amount, shortBy: amount - p.cash },
          );
        }
        p.cash -= amount;
      }
      if (to === POT) s.pot += amount;
      else if (to !== BANK) s.players[to].cash += amount;
      return;
    }
    case "PROPERTY": {
      const p = propOf(s, e.spaceId);
      const from = assertParty(s, e.fromParty);
      const to = assertParty(s, e.toParty);
      if (from === POT || to === POT) throw new RuleError("INVALID_ACTION", "The pot can't own a property.");
      if ((p.owner ?? BANK) !== from) throw new RuleError("NOT_OWNER", `${spaceOf(s.board, e.spaceId).name} isn't owned by that party.`);
      if (from === to) throw new RuleError("INVALID_ACTION", "That property is already there.");
      p.owner = to === BANK ? null : to;
      return;
    }
    case "BUILDINGS": {
      const p = propOf(s, e.spaceId);
      const { before, after } = e.meta;
      if (p.houses !== before.houses || p.hotel !== before.hotel) {
        throw new RuleError("INVALID_ACTION", `${spaceOf(s.board, e.spaceId).name}'s buildings changed since this was planned.`);
      }
      if (after.houses < 0 || after.houses > 4 || (after.hotel && after.houses !== 0)) {
        throw new RuleError("INVALID_ACTION", "That isn't a valid set of buildings.");
      }
      if (p.mortgaged && (after.houses > 0 || after.hotel)) {
        throw new RuleError("BLOCKED", "A mortgaged property can't have buildings.");
      }
      const houses = s.bankHouses - (after.houses - before.houses);
      const hotels = s.bankHotels - ((after.hotel ? 1 : 0) - (before.hotel ? 1 : 0));
      if (houses < 0) throw new RuleError("BANK_STOCK", "The bank has no houses left.");
      if (hotels < 0) throw new RuleError("BANK_STOCK", "The bank has no hotels left.");
      s.bankHouses = houses;
      s.bankHotels = hotels;
      p.houses = after.houses;
      p.hotel = after.hotel;
      return;
    }
    case "MORTGAGE": {
      const p = propOf(s, e.spaceId);
      if (p.mortgaged === e.meta.mortgaged) throw new RuleError("INVALID_ACTION", "That property is already in that state.");
      if (e.meta.mortgaged && (p.houses > 0 || p.hotel)) throw new RuleError("BLOCKED", "Sell the buildings before mortgaging.");
      p.mortgaged = e.meta.mortgaged;
      return;
    }
    case "JAIL": {
      const p = s.players[e.meta.player];
      if (!p) throw new RuleError("NOT_FOUND", "That player isn't in this game.");
      if (p.inJail !== e.meta.before.inJail || p.jailTurns !== e.meta.before.jailTurns) {
        throw new RuleError("INVALID_ACTION", `${p.name ?? "That player"}'s jail status changed since this was planned.`);
      }
      p.inJail = e.meta.after.inJail;
      p.jailTurns = e.meta.after.jailTurns;
      return;
    }
    case "JAIL_CARD": {
      const amount = assertWholeAmount(e.amount);
      const from = assertParty(s, e.fromParty);
      const to = assertParty(s, e.toParty);
      if (from === POT || to === POT || from === to) throw new RuleError("INVALID_ACTION", "That isn't a valid card move.");
      if (from !== BANK) {
        if (s.players[from].jailCards < amount) throw new RuleError("INVALID_ACTION", `${nameOf(s, from)} doesn't hold that many Get Out of Jail Free cards.`);
        s.players[from].jailCards -= amount;
      }
      if (to !== BANK) s.players[to].jailCards += amount;
      if (heldJailCards(s) > s.board.jailCards) throw new RuleError("BANK_STOCK", "All the Get Out of Jail Free cards are already held.");
      return;
    }
    case "BANKRUPT": {
      const p = s.players[e.meta.player];
      if (!p) throw new RuleError("NOT_FOUND", "That player isn't in this game.");
      if (e.meta.undo) {
        if (p.status !== "bankrupt" || p.finishPosition !== e.meta.position) throw new RuleError("INVALID_ACTION", "That player isn't bankrupt.");
        p.status = "playing";
        p.finishPosition = undefined;
        return;
      }
      if (p.status !== "playing") throw new RuleError("INVALID_ACTION", `${p.name ?? "That player"} is already out.`);
      if (p.cash !== 0 || p.jailCards !== 0 || ownedSpaces(s, p.id).length > 0) {
        throw new RuleError("INVALID_ACTION", "A bankrupt player must hand over everything first.");
      }
      if (Object.values(s.players).some((x) => x.finishPosition === e.meta.position)) {
        throw new RuleError("INVALID_ACTION", `Place ${e.meta.position} is already taken.`);
      }
      p.status = "bankrupt";
      p.finishPosition = e.meta.position;
      return;
    }
    case "FINISH": {
      const p = s.players[e.meta.player];
      if (!p) throw new RuleError("NOT_FOUND", "That player isn't in this game.");
      if (e.meta.undo) {
        if (p.status !== "playing" || p.finishPosition !== e.meta.position) throw new RuleError("INVALID_ACTION", "That player has no such finishing place.");
        p.finishPosition = undefined;
        return;
      }
      if (p.status !== "playing" || p.finishPosition !== undefined) throw new RuleError("INVALID_ACTION", `${p.name ?? "That player"} already has a finishing place.`);
      if (Object.values(s.players).some((x) => x.finishPosition === e.meta.position)) {
        throw new RuleError("INVALID_ACTION", `Place ${e.meta.position} is already taken.`);
      }
      p.finishPosition = e.meta.position;
      return;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Planners: one user action → one group of events, validated against the state.
// ---------------------------------------------------------------------------------------------

export type Plan = { events: MEvent[]; after: GameState };

/** Validates a group by applying it. */
function plan(state: GameState, events: MEvent[]): Plan {
  return { events, after: applyEvents(state, events) };
}

function requirePlaying(state: GameState, id: string) {
  const p = state.players[id];
  if (!p) throw new RuleError("NOT_FOUND", "That player isn't in this game.");
  if (p.status !== "playing") throw new RuleError("INVALID_ACTION", `${p.name ?? "That player"} is out of the game.`);
  return p;
}

const pay = (fromParty: Party, toParty: Party, amount: number, reason: PayReason, spaceId?: string): MEvent => ({
  type: "PAY",
  fromParty,
  toParty,
  amount,
  spaceId,
  meta: { reason },
});

/** A player collects money from the bank (a card, a bonus). */
export function planBankCollect(state: GameState, playerId: string, amount: number, reason: PayReason = "bank") {
  requirePlaying(state, playerId);
  return plan(state, [pay(BANK, playerId, amount, reason)]);
}

/** A player pays the bank. Taxes, fines and card payments go to the Free Parking pot when that house rule is on. */
export function planPayBank(state: GameState, playerId: string, amount: number, reason: PayReason = "bank", spaceId?: string) {
  requirePlaying(state, playerId);
  return plan(state, [pay(playerId, bankSink(state.settings, reason), amount, reason, spaceId)]);
}

/** Pass GO. Landing exactly on GO pays double when doubleOnGo is on. */
export function planPassGo(state: GameState, playerId: string, opts: { landedExactly?: boolean } = {}) {
  requirePlaying(state, playerId);
  const double = state.settings.doubleOnGo && !!opts.landedExactly;
  if (state.board.passGo <= 0) throw new RuleError("INVALID_ACTION", "This board pays nothing for passing GO.");
  return plan(state, [pay(BANK, playerId, state.board.passGo * (double ? 2 : 1), double ? "go_bonus" : "pass_go")]);
}

/** Direct payment between two players. */
export function planPlayerPay(state: GameState, fromId: string, toId: string, amount: number, reason: PayReason = "payment") {
  requirePlaying(state, fromId);
  requirePlaying(state, toId);
  return plan(state, [pay(fromId, toId, amount, reason)]);
}

/** Collect the Free Parking pot. */
export function planCollectPot(state: GameState, playerId: string) {
  requirePlaying(state, playerId);
  if (state.pot <= 0) throw new RuleError("INVALID_ACTION", "The Free Parking pot is empty.");
  return plan(state, [pay(POT, playerId, state.pot, "pot")]);
}

/** Rent for landing on an owned space, paid to its owner. */
export function planRent(state: GameState, payerId: string, spaceId: string, opts: { diceTotal?: number } = {}) {
  requirePlaying(state, payerId);
  const due = rentFor(state, spaceId, opts);
  if (due.ownerId === null || due.amount <= 0) throw new RuleError("INVALID_ACTION", due.note);
  if (due.ownerId === payerId) throw new RuleError("INVALID_ACTION", "You own this space.");
  return { ...plan(state, [pay(payerId, due.ownerId, due.amount, "rent", spaceId)]), due };
}

/** Buy an unowned property from the bank (at the list price unless an auction set another). */
export function planBuy(state: GameState, playerId: string, spaceId: string, opts: { price?: number; reason?: "purchase" | "auction" } = {}) {
  requirePlaying(state, playerId);
  const space = spaceOf(state.board, spaceId);
  if (!isOwnable(space)) throw new RuleError("INVALID_ACTION", `${space.name} can't be bought.`);
  const p = propOf(state, spaceId);
  if (p.owner !== null) throw new RuleError("INVALID_ACTION", `${space.name} already has an owner.`);
  const price = opts.price ?? space.price ?? 0;
  return plan(state, [
    pay(playerId, BANK, price, opts.reason ?? "purchase", spaceId),
    { type: "PROPERTY", fromParty: BANK, toParty: playerId, spaceId },
  ]);
}

export function planBuild(state: GameState, playerId: string, spaceId: string) {
  requirePlaying(state, playerId);
  const check = canBuild(state, playerId, spaceId);
  if (!check.ok) throw new RuleError("BLOCKED", check.reason);
  return plan(state, [
    pay(playerId, BANK, check.cost, "build", spaceId),
    { type: "BUILDINGS", spaceId, meta: { before: check.before, after: check.after } },
  ]);
}

export function planSellBuilding(state: GameState, playerId: string, spaceId: string) {
  requirePlaying(state, playerId);
  const check = canSellBuilding(state, playerId, spaceId);
  if (!check.ok) throw new RuleError("BLOCKED", check.reason);
  return plan(state, [
    { type: "BUILDINGS", spaceId, meta: { before: check.before, after: check.after } },
    pay(BANK, playerId, check.refund, "sell_building", spaceId),
  ]);
}

export function planMortgage(state: GameState, playerId: string, spaceId: string) {
  requirePlaying(state, playerId);
  const check = canMortgage(state, playerId, spaceId);
  if (!check.ok) throw new RuleError("BLOCKED", check.reason);
  return plan(state, [
    { type: "MORTGAGE", spaceId, meta: { mortgaged: true } },
    pay(BANK, playerId, check.raises, "mortgage", spaceId),
  ]);
}

export function planUnmortgage(state: GameState, playerId: string, spaceId: string) {
  requirePlaying(state, playerId);
  const check = canUnmortgage(state, playerId, spaceId);
  if (!check.ok) throw new RuleError("BLOCKED", check.reason);
  return plan(state, [
    pay(playerId, BANK, check.cost, "unmortgage", spaceId),
    { type: "MORTGAGE", spaceId, meta: { mortgaged: false } },
  ]);
}

// ---- Trades ----

export type TradeSide = { player: string; cash: number; spaceIds: string[]; jailCards: number };
export type TradeOffer = { a: TradeSide; b: TradeSide };

/**
 * Both sides' cash, properties and jail cards, executed atomically. Buildings must be sold first. A mortgaged
 * property costs its receiver 10% interest at once, paid to the bank.
 */
export function planTrade(state: GameState, offer: TradeOffer) {
  const { a, b } = offer;
  requirePlaying(state, a.player);
  requirePlaying(state, b.player);
  if (a.player === b.player) throw new RuleError("INVALID_ACTION", "A trade needs two different players.");
  const empty = (x: TradeSide) => x.cash === 0 && x.spaceIds.length === 0 && x.jailCards === 0;
  if (empty(a) && empty(b)) throw new RuleError("INVALID_ACTION", "Add something to the trade.");

  const events: MEvent[] = [];
  const interest: MEvent[] = [];
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    if (!Number.isSafeInteger(from.cash) || from.cash < 0) throw new RuleError("INVALID_ACTION", "Cash in a trade must be a whole number.");
    if (!Number.isSafeInteger(from.jailCards) || from.jailCards < 0) throw new RuleError("INVALID_ACTION", "Invalid Get Out of Jail Free card count.");
    if (new Set(from.spaceIds).size !== from.spaceIds.length) throw new RuleError("INVALID_ACTION", "A property is listed twice.");
    for (const spaceId of from.spaceIds) {
      const space = spaceOf(state.board, spaceId);
      const p = propOf(state, spaceId);
      if (p.owner !== from.player) throw new RuleError("NOT_OWNER", `${nameOf(state, from.player)} doesn't own ${space.name}.`);
      if (space.group) {
        const built = state.board.spaces.some((m) => m.group === space.group && levelOf(state.props[m.id]) > 0);
        if (built) throw new RuleError("BLOCKED", `Sell the buildings in the ${space.group} set before trading ${space.name}.`);
      }
      events.push({ type: "PROPERTY", fromParty: from.player, toParty: to.player, spaceId });
      if (p.mortgaged) interest.push(pay(to.player, BANK, interestOn(space), "interest", spaceId));
    }
    if (from.jailCards > 0) events.push({ type: "JAIL_CARD", fromParty: from.player, toParty: to.player, amount: from.jailCards });
  }
  // One net cash move, first, so a player can fund interest with cash they receive in the same trade.
  const diff = a.cash - b.cash;
  if (diff !== 0) events.unshift(pay(diff > 0 ? a.player : b.player, diff > 0 ? b.player : a.player, Math.abs(diff), "trade"));
  events.push(...interest);
  return plan(state, events);
}

// ---- Card actions ----

/** "Collect X from every player" / "Pay X to every player", one atomic group. */
export function planCardEveryPlayer(state: GameState, playerId: string, amount: number, direction: "collect" | "pay") {
  requirePlaying(state, playerId);
  assertWholeAmount(amount);
  const others = playingPlayers(state).filter((p) => p.id !== playerId);
  if (others.length === 0) throw new RuleError("INVALID_ACTION", "There's nobody else to pay or collect from.");

  const payers: PlayerState[] = direction === "collect" ? others : [state.players[playerId]];
  const needed = direction === "collect" ? amount : amount * others.length;
  const short = payers.filter((p) => p.cash < (direction === "collect" ? amount : needed));
  if (short.length > 0) {
    const first = short[0];
    const names = short.map((p) => p.name ?? "A player").join(", ");
    const each = direction === "collect" ? amount : needed;
    throw new RuleError(
      "INSUFFICIENT_CASH",
      `${names} can't afford ${money(state, each)}. They need to raise money first.`,
      { playerId: first.id, needed: each, shortBy: each - first.cash },
    );
  }
  const events = others.map((o) => (direction === "collect" ? pay(o.id, playerId, amount, "card") : pay(playerId, o.id, amount, "card")));
  return plan(state, events);
}

/** A repairs card: so much per house and per hotel, paid to the bank (or the pot when that rule is on). */
export function planRepairs(state: GameState, playerId: string, perHouse: number, perHotel: number) {
  requirePlaying(state, playerId);
  if (!state.settings.trackProperties) throw new RuleError("INVALID_ACTION", "Buildings aren't tracked in this game.");
  const bill = repairsBill(state, playerId, perHouse, perHotel);
  if (bill <= 0) throw new RuleError("INVALID_ACTION", `${nameOf(state, playerId)} has no buildings, so there's nothing to pay.`);
  return { ...plan(state, [pay(playerId, bankSink(state.settings, "repairs"), bill, "repairs")]), bill };
}

// ---- Jail ----

const jail = (player: string, before: { inJail: boolean; jailTurns: number }, after: { inJail: boolean; jailTurns: number }): MEvent => ({
  type: "JAIL",
  meta: { player, before, after },
});

export function planGoToJail(state: GameState, playerId: string) {
  const p = requirePlaying(state, playerId);
  if (p.inJail) throw new RuleError("INVALID_ACTION", `${nameOf(state, playerId)} is already in jail.`);
  return plan(state, [jail(playerId, { inJail: false, jailTurns: p.jailTurns }, { inJail: true, jailTurns: 0 })]);
}

/** One more turn spent in jail (the player didn't roll doubles). */
export function planJailTurn(state: GameState, playerId: string) {
  const p = requirePlaying(state, playerId);
  if (!p.inJail) throw new RuleError("INVALID_ACTION", `${nameOf(state, playerId)} isn't in jail.`);
  return plan(state, [jail(playerId, { inJail: true, jailTurns: p.jailTurns }, { inJail: true, jailTurns: p.jailTurns + 1 })]);
}

export function planPayJailFine(state: GameState, playerId: string) {
  const p = requirePlaying(state, playerId);
  if (!p.inJail) throw new RuleError("INVALID_ACTION", `${nameOf(state, playerId)} isn't in jail.`);
  const events: MEvent[] = [];
  if (state.board.jailFine > 0) events.push(pay(playerId, bankSink(state.settings, "jail_fine"), state.board.jailFine, "jail_fine"));
  events.push(jail(playerId, { inJail: true, jailTurns: p.jailTurns }, { inJail: false, jailTurns: 0 }));
  return plan(state, events);
}

export function planUseJailCard(state: GameState, playerId: string) {
  const p = requirePlaying(state, playerId);
  if (!p.inJail) throw new RuleError("INVALID_ACTION", `${nameOf(state, playerId)} isn't in jail.`);
  if (p.jailCards < 1) throw new RuleError("INVALID_ACTION", `${nameOf(state, playerId)} has no Get Out of Jail Free card.`);
  return plan(state, [
    { type: "JAIL_CARD", fromParty: playerId, toParty: BANK, amount: 1 },
    jail(playerId, { inJail: true, jailTurns: p.jailTurns }, { inJail: false, jailTurns: 0 }),
  ]);
}

/** Out of jail without paying (the player rolled doubles). */
export function planLeaveJail(state: GameState, playerId: string) {
  const p = requirePlaying(state, playerId);
  if (!p.inJail) throw new RuleError("INVALID_ACTION", `${nameOf(state, playerId)} isn't in jail.`);
  return plan(state, [jail(playerId, { inJail: true, jailTurns: p.jailTurns }, { inJail: false, jailTurns: 0 })]);
}

/** Someone picks up a Get Out of Jail Free card from a deck. */
export function planDrawJailCard(state: GameState, playerId: string) {
  requirePlaying(state, playerId);
  return plan(state, [{ type: "JAIL_CARD", fromParty: BANK, toParty: playerId, amount: 1 }]);
}

// ---- Bankruptcy and the end of the game ----

export type BankruptcyPlan = Plan & {
  /** Spaces to auction one by one (bankrupt to the bank, auctions on). */
  toAuction: string[];
  /** Set when only one player is left standing. */
  winnerId?: string;
};

/**
 * A player who can't pay is out. To a player: buildings are sold to the bank at half cost, then all cash,
 * properties and jail cards go to the creditor, who pays 10% interest on each mortgaged property. To the bank:
 * cash goes to the bank, properties go back unmortgaged. The bankrupt player takes the worst place still open;
 * if one player is left, they win.
 */
export function planBankruptcy(state: GameState, debtorId: string, creditor: string): BankruptcyPlan {
  const debtor = requirePlaying(state, debtorId);
  const toBank = creditor === BANK;
  if (!toBank) {
    requirePlaying(state, creditor);
    if (creditor === debtorId) throw new RuleError("INVALID_ACTION", "A player can't go bankrupt to themselves.");
  }
  const events: MEvent[] = [];
  const owned = ownedSpaces(state, debtorId);
  let cash = debtor.cash;

  // 1. Buildings go back to the bank. Selling to a creditor converts them to cash at half cost.
  for (const s of owned) {
    const p = state.props[s.id];
    if (levelOf(p) === 0) continue;
    events.push({ type: "BUILDINGS", spaceId: s.id, meta: { before: { houses: p.houses, hotel: p.hotel }, after: { houses: 0, hotel: false } } });
    if (!toBank) {
      const proceeds = levelOf(p) * sellValue(s);
      if (proceeds > 0) {
        events.push(pay(BANK, debtorId, proceeds, "sell_building", s.id));
        cash += proceeds;
      }
    }
  }
  // 2. Cash.
  if (cash > 0) events.push(pay(debtorId, creditor, cash, "bankruptcy"));
  // 3. Properties. Mortgaged ones are cleared when they go back to the bank; a creditor pays 10% on each.
  const interest: MEvent[] = [];
  const toAuction: string[] = [];
  for (const s of owned) {
    const p = state.props[s.id];
    if (toBank) {
      if (p.mortgaged) events.push({ type: "MORTGAGE", spaceId: s.id, meta: { mortgaged: false } });
      events.push({ type: "PROPERTY", fromParty: debtorId, toParty: BANK, spaceId: s.id });
      toAuction.push(s.id);
    } else {
      events.push({ type: "PROPERTY", fromParty: debtorId, toParty: creditor, spaceId: s.id });
      if (p.mortgaged) interest.push(pay(creditor, BANK, interestOn(s), "interest", s.id));
    }
  }
  // 4. Jail cards.
  if (debtor.jailCards > 0) events.push({ type: "JAIL_CARD", fromParty: debtorId, toParty: creditor, amount: debtor.jailCards });
  events.push(...interest);

  // 5. Finishing place: the worst place still open (first out is last).
  const standing = playingPlayers(state).length;
  events.push({ type: "BANKRUPT", meta: { player: debtorId, position: standing } });
  const remaining = playingPlayers(state).filter((p) => p.id !== debtorId);
  let winnerId: string | undefined;
  if (remaining.length === 1) {
    winnerId = remaining[0].id;
    events.push({ type: "FINISH", meta: { player: winnerId, position: 1 } });
  }
  const planned = plan(state, events);
  return { ...planned, toAuction: state.settings.auctions ? toAuction : [], winnerId };
}

/**
 * Ends the game before only one player is left. `order` lists every player still playing, best first;
 * without it they're ranked by net worth (ties by seat). Bankrupt players keep the places they already have.
 */
export function planEndGame(state: GameState, order?: string[]) {
  const playing = playingPlayers(state).filter((p) => p.finishPosition === undefined);
  if (playing.length === 0) throw new RuleError("INVALID_ACTION", "Everyone already has a finishing place.");
  const ranked = order ?? [...playing].sort((a, b) => netWorth(state, b.id) - netWorth(state, a.id) || a.seat - b.seat).map((p) => p.id);
  if (ranked.length !== playing.length || new Set(ranked).size !== ranked.length || !ranked.every((id) => playing.some((p) => p.id === id))) {
    throw new RuleError("INVALID_ACTION", "List every player still in the game once.");
  }
  return plan(state, ranked.map((player, i) => ({ type: "FINISH" as const, meta: { player, position: i + 1 } })));
}

/** Final standings by finishing place, 1st first. Only complete once every player has a place. */
export function standings(state: GameState) {
  return Object.values(state.players)
    .filter((p) => p.finishPosition !== undefined)
    .sort((a, b) => a.finishPosition! - b.finishPosition!)
    .map((p) => ({ playerId: p.id, position: p.finishPosition! }));
}

export function gameIsOver(state: GameState) {
  return Object.values(state.players).every((p) => p.finishPosition !== undefined);
}

// ---------------------------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------------------------

function invert(e: MEvent): MEvent {
  switch (e.type) {
    case "PAY":
      // Marked so totals (rent earned and paid) can tell an undo from a real payment.
      return { ...e, fromParty: e.toParty, toParty: e.fromParty, meta: e.meta ? { ...e.meta, undo: true } : e.meta };
    case "PROPERTY":
      return { ...e, fromParty: e.toParty, toParty: e.fromParty };
    case "BUILDINGS":
      return { ...e, meta: { before: e.meta.after, after: e.meta.before } };
    case "MORTGAGE":
      return { ...e, meta: { mortgaged: !e.meta.mortgaged } };
    case "JAIL":
      return { ...e, meta: { player: e.meta.player, before: e.meta.after, after: e.meta.before } };
    case "JAIL_CARD":
      return { ...e, fromParty: e.toParty, toParty: e.fromParty };
    case "BANKRUPT":
    case "FINISH":
      return { ...e, meta: { ...e.meta, undo: !e.meta.undo } };
  }
}

/** The events that exactly reverse a group, in reverse order. */
export function invertEvents(events: MEvent[]): MEvent[] {
  return [...events].reverse().map(invert);
}

/** What a group changed, as keys: a player's cash, the pot, a property, jail state, jail cards, finishing status. */
export function touchedKeys(events: MEvent[]): Set<string> {
  const keys = new Set<string>();
  const party = (p: Party | undefined, prefix: string) => {
    if (p && p !== BANK && p !== POT) keys.add(`${prefix}:${p}`);
  };
  for (const e of events) {
    switch (e.type) {
      case "PAY":
        party(e.fromParty, "cash");
        party(e.toParty, "cash");
        if (e.fromParty === POT || e.toParty === POT) keys.add("pot");
        break;
      case "PROPERTY":
      case "BUILDINGS":
      case "MORTGAGE":
        keys.add(`prop:${e.spaceId}`);
        break;
      case "JAIL":
        keys.add(`jail:${e.meta.player}`);
        break;
      case "JAIL_CARD":
        party(e.fromParty, "jailcards");
        party(e.toParty, "jailcards");
        break;
      case "BANKRUPT":
      case "FINISH":
        keys.add(`status:${e.meta.player}`);
        break;
    }
  }
  return keys;
}

/** Every player a group mentions. */
export function involvedPlayers(events: MEvent[]): Set<string> {
  const ids = new Set<string>();
  const add = (p: Party | undefined) => {
    if (p && p !== BANK && p !== POT) ids.add(p);
  };
  for (const e of events) {
    if (e.type === "PAY" || e.type === "PROPERTY" || e.type === "JAIL_CARD") {
      add(e.fromParty);
      add(e.toParty);
    } else if (e.type === "JAIL" || e.type === "BANKRUPT" || e.type === "FINISH") {
      add(e.meta.player);
    }
  }
  return ids;
}

/** Players whose place in the game a group settled: bankrupt, or given a final position. */
function playersSettledBy(events: MEvent[]): string[] {
  return events.filter((e) => (e.type === "BANKRUPT" || e.type === "FINISH") && !e.meta.undo).map((e) => (e as { meta: { player: string } }).meta.player);
}

export type GroupRecord = {
  groupId: string;
  /** Plain-language description of the action, shown when it blocks an undo. */
  label: string;
  events: MEvent[];
  reversesGroupId?: string;
};

export type UndoCheck = { ok: true } | { ok: false; code: "NOT_UNDOABLE" | "ALREADY_REVERSED" | "BLOCKED"; reason: string; blocker?: GroupRecord };

/**
 * Whether a whole group can be undone. `groups` is every group of the game, oldest first. Undo is refused if a
 * later group that is still in effect touched the same players' cash or the same properties (or the pot, jail
 * state or finishing status), and the answer names that group so the host knows what to undo first.
 */
export function checkUndo(groups: GroupRecord[], groupId: string): UndoCheck {
  const idx = groups.findIndex((g) => g.groupId === groupId);
  if (idx < 0) return { ok: false, code: "NOT_UNDOABLE", reason: "That action isn't in this game." };
  const target = groups[idx];
  if (target.reversesGroupId) return { ok: false, code: "NOT_UNDOABLE", reason: "An undo can't be undone. Do the action again instead." };
  if (groups.some((g) => g.reversesGroupId === groupId)) return { ok: false, code: "ALREADY_REVERSED", reason: "That action has already been undone." };

  const position = new Map(groups.map((g, i) => [g.groupId, i]));
  const undone = new Set(groups.map((g) => g.reversesGroupId).filter((x): x is string => !!x));
  const mine = touchedKeys(target.events);
  const involved = involvedPlayers(target.events);
  for (const g of groups.slice(idx + 1)) {
    if (undone.has(g.groupId)) continue; // already cancelled out
    if (g.reversesGroupId && (position.get(g.reversesGroupId) ?? -1) > idx) continue; // cancels a later group
    for (const key of touchedKeys(g.events)) {
      if (mine.has(key)) {
        return { ok: false, code: "BLOCKED", reason: `Undo "${g.label}" first — it came after and changed the same ${describeKey(key)}.`, blocker: g };
      }
    }
    // A player who has since gone out (or been given a final place) can't be part of an action that's reversed.
    if (playersSettledBy(g.events).some((p) => involved.has(p))) {
      return { ok: false, code: "BLOCKED", reason: `Undo "${g.label}" first — a player in this action has left the game since.`, blocker: g };
    }
  }
  return { ok: true };
}

function describeKey(key: string) {
  const kind = key.split(":")[0];
  switch (kind) {
    case "cash":
      return "player's cash";
    case "prop":
      return "property";
    case "pot":
      return "pot";
    case "jail":
    case "jailcards":
      return "jail status";
    default:
      return "player";
  }
}

// ---------------------------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------------------------

/** Net money the bank has paid out: Σ bank → party minus Σ party → bank, over every event ever written (undos included). */
export function netBankFlow(events: MEvent[]) {
  let flow = 0;
  for (const e of events) {
    if (e.type !== "PAY") continue;
    if (e.fromParty === BANK) flow += e.amount;
    if (e.toParty === BANK) flow -= e.amount;
  }
  return flow;
}

/**
 * Everything that must always be true. `events` is every event so far; with it, cash is also checked against
 * starting cash × players + net bank flow. Returns the violations (empty = healthy).
 */
export function gameViolations(state: GameState, events?: MEvent[]): string[] {
  const v: string[] = [];
  const players = Object.values(state.players);
  let cash = 0;
  for (const p of players) {
    cash += p.cash;
    if (p.cash < 0) v.push(`${p.name ?? p.id} has negative cash ${p.cash}`);
    if (!Number.isSafeInteger(p.cash)) v.push(`${p.name ?? p.id}'s cash isn't a whole number`);
    if (p.status === "bankrupt" && (p.cash !== 0 || p.jailCards !== 0 || ownedSpaces(state, p.id).length > 0)) {
      v.push(`bankrupt ${p.name ?? p.id} still holds something`);
    }
  }
  if (state.pot < 0) v.push(`the pot is negative (${state.pot})`);
  if (events) {
    const expected = state.board.startingCash * players.length + netBankFlow(events);
    if (cash + state.pot !== expected) v.push(`cash ${cash} + pot ${state.pot} ≠ starting cash × players + bank flow ${expected}`);
  }

  if (state.settings.trackProperties) {
    let houses = 0;
    let hotels = 0;
    for (const s of ownableSpaces(state.board)) {
      const p: PropState | undefined = state.props[s.id];
      if (!p) {
        v.push(`${s.name} has no state`);
        continue;
      }
      if (p.owner !== null && state.players[p.owner]?.status !== "playing") v.push(`${s.name} is owned by someone who isn't playing`);
      if (p.hotel && p.houses !== 0) v.push(`${s.name} has a hotel and houses`);
      if (p.houses < 0 || p.houses > 4) v.push(`${s.name} has ${p.houses} houses`);
      if (p.mortgaged && (p.houses > 0 || p.hotel)) v.push(`${s.name} is mortgaged with buildings`);
      if (p.owner === null && (p.houses > 0 || p.hotel)) v.push(`${s.name} is unowned with buildings`);
      houses += p.houses;
      if (p.hotel) hotels += 1;
    }
    if (Object.keys(state.props).length !== ownableSpaces(state.board).length) v.push("property states don't match the board");
    if (houses + state.bankHouses !== state.board.houses) v.push(`houses ${houses} + bank ${state.bankHouses} ≠ ${state.board.houses}`);
    if (hotels + state.bankHotels !== state.board.hotels) v.push(`hotels ${hotels} + bank ${state.bankHotels} ≠ ${state.board.hotels}`);
  } else if (Object.keys(state.props).length > 0) {
    v.push("properties are tracked although the game says they're not");
  }
  if (heldJailCards(state) > state.board.jailCards) v.push("more Get Out of Jail Free cards are held than exist");
  const positions = players.map((p) => p.finishPosition).filter((x): x is number => x !== undefined);
  if (new Set(positions).size !== positions.length) v.push("two players share a finishing place");
  return v;
}
