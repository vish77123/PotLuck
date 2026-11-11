// Every Monopoly rule as a pure function. The Convex mutations and the UI previews call these same functions.
import {
  BANK,
  POT,
  RuleError,
  type BoardConfig,
  type Buildings,
  type GameState,
  type GroupKey,
  type Party,
  type PayReason,
  type PropState,
  type Settings,
  type Space,
} from "./types";

// ---- Board lookups ----

export function spaceOf(board: BoardConfig, spaceId: string): Space {
  const s = board.spaces.find((x) => x.id === spaceId);
  if (!s) throw new RuleError("NOT_FOUND", "That space isn't on this board.");
  return s;
}

export function isOwnable(s: Space) {
  return s.kind === "property" || s.kind === "rail" || s.kind === "utility";
}

export function ownableSpaces(board: BoardConfig) {
  return board.spaces.filter(isOwnable);
}

export function groupSpaces(board: BoardConfig, group: GroupKey) {
  return board.spaces.filter((s) => s.kind === "property" && s.group === group);
}

export function propOf(state: GameState, spaceId: string): PropState {
  const p = state.props[spaceId];
  if (!p) throw new RuleError("INVALID_ACTION", "Properties aren't tracked in this game, or that space can't be owned.");
  return p;
}

export function ownedSpaces(state: GameState, playerId: string) {
  return ownableSpaces(state.board).filter((s) => state.props[s.id]?.owner === playerId);
}

export function ownsFullGroup(state: GameState, playerId: string, group: GroupKey) {
  const members = groupSpaces(state.board, group);
  return members.length > 0 && members.every((s) => state.props[s.id]?.owner === playerId);
}

/** Houses count 1–4, a hotel counts 5. */
export function levelOf(p: Pick<PropState, "houses" | "hotel">) {
  return p.hotel ? 5 : p.houses;
}

export function playingPlayers(state: GameState) {
  return Object.values(state.players)
    .filter((p) => p.status === "playing")
    .sort((a, b) => a.seat - b.seat);
}

/** The next playing player after `afterId` in seat order, wrapping. Undefined if nobody else is playing. */
export function nextPlayer(state: GameState, afterId: string): string | undefined {
  const all = Object.values(state.players).sort((a, b) => a.seat - b.seat);
  const i = all.findIndex((p) => p.id === afterId);
  for (let step = 1; step <= all.length; step++) {
    const p = all[(i + step) % all.length];
    if (p.status === "playing" && p.id !== afterId) return p.id;
  }
  return undefined;
}

// ---- Money routing ----

const POT_REASONS: ReadonlySet<PayReason> = new Set(["tax", "jail_fine", "card", "repairs"]);

/** Where a payment to "the bank" actually goes: taxes, fines and card payments feed the Free Parking pot when it's on. */
export function bankSink(settings: Settings, reason: PayReason): Party {
  return settings.freeParkingPot && POT_REASONS.has(reason) ? POT : BANK;
}

// ---- Rent ----

export type RentDue = { amount: number; ownerId: string | null; note: string };

export function assertDiceTotal(n: number | undefined): number {
  if (n === undefined || !Number.isSafeInteger(n) || n < 1 || n > 99) {
    throw new RuleError("INVALID_ACTION", "Enter the dice total to work out the utility rent.");
  }
  return n;
}

/** Rent due for landing on a space. Unowned, mortgaged and non-ownable spaces owe nothing. */
export function rentFor(state: GameState, spaceId: string, opts: { diceTotal?: number } = {}): RentDue {
  const space = spaceOf(state.board, spaceId);
  if (!isOwnable(space)) return { amount: 0, ownerId: null, note: "Nothing to pay here." };
  const p = propOf(state, spaceId);
  if (p.owner === null) return { amount: 0, ownerId: null, note: "The bank owns this." };
  if (p.mortgaged) return { amount: 0, ownerId: p.owner, note: "Mortgaged, so no rent." };
  const owner = p.owner;

  if (space.kind === "rail") {
    const count = ownableSpaces(state.board).filter((s) => s.kind === "rail" && state.props[s.id]?.owner === owner).length;
    const table = space.rent ?? [];
    return { amount: table[count - 1] ?? 0, ownerId: owner, note: `${count} station${count === 1 ? "" : "s"} owned` };
  }
  if (space.kind === "utility") {
    const dice = assertDiceTotal(opts.diceTotal);
    const count = ownableSpaces(state.board).filter((s) => s.kind === "utility" && state.props[s.id]?.owner === owner).length;
    const mult = state.board.utilityMultipliers[count - 1] ?? 0;
    return { amount: dice * mult, ownerId: owner, note: `${mult}× the dice (${dice})` };
  }

  const table = space.rent ?? [];
  if (p.hotel) return { amount: table[5] ?? 0, ownerId: owner, note: "Hotel" };
  if (p.houses > 0) return { amount: table[p.houses] ?? 0, ownerId: owner, note: `${p.houses} house${p.houses === 1 ? "" : "s"}` };
  const set = space.group !== undefined && ownsFullGroup(state, owner, space.group);
  return set ? { amount: (table[0] ?? 0) * 2, ownerId: owner, note: "Double rent, full colour set" } : { amount: table[0] ?? 0, ownerId: owner, note: "Base rent" };
}

// ---- Mortgages ----

export function mortgageValue(space: Space) {
  return space.mortgage ?? Math.floor((space.price ?? 0) / 2);
}

/** 10% of the mortgage value, rounded up. Charged on unmortgaging and on receiving a mortgaged property. */
export function interestOn(space: Space) {
  return Math.ceil(mortgageValue(space) / 10);
}

export function unmortgageCost(space: Space) {
  return mortgageValue(space) + interestOn(space);
}

export function groupHasBuildings(state: GameState, group: GroupKey) {
  return groupSpaces(state.board, group).some((s) => {
    const p = state.props[s.id];
    return !!p && (p.houses > 0 || p.hotel);
  });
}

export function groupHasMortgage(state: GameState, group: GroupKey) {
  return groupSpaces(state.board, group).some((s) => state.props[s.id]?.mortgaged);
}

export type Check<T extends object = object> = ({ ok: true } & T) | { ok: false; reason: string };

export function canMortgage(state: GameState, playerId: string, spaceId: string): Check<{ raises: number }> {
  const space = spaceOf(state.board, spaceId);
  const p = state.props[spaceId];
  if (!isOwnable(space) || !p) return { ok: false, reason: "That space can't be mortgaged." };
  if (p.owner !== playerId) return { ok: false, reason: `You don't own ${space.name}.` };
  if (p.mortgaged) return { ok: false, reason: `${space.name} is already mortgaged.` };
  if (space.group && groupHasBuildings(state, space.group)) {
    return { ok: false, reason: `Sell the buildings in the ${space.group} set before mortgaging ${space.name}.` };
  }
  return { ok: true, raises: mortgageValue(space) };
}

export function canUnmortgage(state: GameState, playerId: string, spaceId: string): Check<{ cost: number }> {
  const space = spaceOf(state.board, spaceId);
  const p = state.props[spaceId];
  if (!isOwnable(space) || !p) return { ok: false, reason: "That space can't be unmortgaged." };
  if (p.owner !== playerId) return { ok: false, reason: `You don't own ${space.name}.` };
  if (!p.mortgaged) return { ok: false, reason: `${space.name} isn't mortgaged.` };
  return { ok: true, cost: unmortgageCost(space) };
}

// ---- Building and selling ----

export function sellValue(space: Space) {
  return Math.floor((space.houseCost ?? 0) / 2);
}

export type BuildPlan = { cost: number; before: Buildings; after: Buildings };

export function canBuild(state: GameState, playerId: string, spaceId: string): Check<BuildPlan> {
  const space = spaceOf(state.board, spaceId);
  const p = state.props[spaceId];
  if (space.kind !== "property" || !p || !space.group) return { ok: false, reason: "You can only build on coloured properties." };
  if (p.owner !== playerId) return { ok: false, reason: `You don't own ${space.name}.` };
  if (!ownsFullGroup(state, playerId, space.group)) return { ok: false, reason: `You need the whole ${space.group} set to build.` };
  if (groupHasMortgage(state, space.group)) return { ok: false, reason: `Unmortgage the ${space.group} set before building.` };
  if (p.hotel) return { ok: false, reason: `${space.name} already has a hotel.` };

  const level = levelOf(p);
  if (state.settings.evenBuilding) {
    const lowest = Math.min(...groupSpaces(state.board, space.group).map((s) => levelOf(state.props[s.id])));
    if (level > lowest) return { ok: false, reason: `Build evenly: add to the other ${space.group} properties first.` };
  }
  const before: Buildings = { houses: p.houses, hotel: p.hotel };
  if (p.houses === 4) {
    if (state.bankHotels < 1) return { ok: false, reason: "The bank has no hotels left." };
    return { ok: true, cost: space.houseCost ?? 0, before, after: { houses: 0, hotel: true } };
  }
  if (state.bankHouses < 1) return { ok: false, reason: "The bank has no houses left." };
  return { ok: true, cost: space.houseCost ?? 0, before, after: { houses: p.houses + 1, hotel: false } };
}

export function canSellBuilding(state: GameState, playerId: string, spaceId: string): Check<{ refund: number; before: Buildings; after: Buildings }> {
  const space = spaceOf(state.board, spaceId);
  const p = state.props[spaceId];
  if (space.kind !== "property" || !p || !space.group) return { ok: false, reason: "There are no buildings on that space." };
  if (p.owner !== playerId) return { ok: false, reason: `You don't own ${space.name}.` };
  if (!p.hotel && p.houses === 0) return { ok: false, reason: `${space.name} has no buildings to sell.` };

  if (state.settings.evenBuilding) {
    const highest = Math.max(...groupSpaces(state.board, space.group).map((s) => levelOf(state.props[s.id])));
    if (levelOf(p) < highest) return { ok: false, reason: `Sell evenly: sell from the other ${space.group} properties first.` };
  }
  const before: Buildings = { houses: p.houses, hotel: p.hotel };
  if (p.hotel) {
    if (state.bankHouses < 4) return { ok: false, reason: "The bank needs 4 houses in stock to swap for the hotel." };
    return { ok: true, refund: sellValue(space), before, after: { houses: 4, hotel: false } };
  }
  return { ok: true, refund: sellValue(space), before, after: { houses: p.houses - 1, hotel: false } };
}

/** Houses and hotels a player has on the board. A hotel counts as one hotel, not four houses. */
export function buildingCounts(state: GameState, playerId: string) {
  let houses = 0;
  let hotels = 0;
  for (const s of ownedSpaces(state, playerId)) {
    const p = state.props[s.id];
    houses += p.houses;
    if (p.hotel) hotels += 1;
  }
  return { houses, hotels };
}

/** The bill a repairs card makes a player pay for their buildings. */
export function repairsBill(state: GameState, playerId: string, perHouse: number, perHotel: number) {
  const { houses, hotels } = buildingCounts(state, playerId);
  return houses * perHouse + hotels * perHotel;
}

// ---- Net worth ----

/** Cash + property price (mortgaged at its mortgage value) + buildings at cost. */
export function netWorth(state: GameState, playerId: string) {
  const player = state.players[playerId];
  let total = player.cash;
  for (const s of ownedSpaces(state, playerId)) {
    const p = state.props[s.id];
    total += p.mortgaged ? mortgageValue(s) : (s.price ?? 0);
    total += levelOf(p) * (s.houseCost ?? 0);
  }
  return total;
}

export function netWorthParts(state: GameState, playerId: string) {
  let property = 0;
  let buildings = 0;
  for (const s of ownedSpaces(state, playerId)) {
    const p = state.props[s.id];
    property += p.mortgaged ? mortgageValue(s) : (s.price ?? 0);
    buildings += levelOf(p) * (s.houseCost ?? 0);
  }
  return { cash: state.players[playerId].cash, property, buildings };
}

// ---- Raise money ----

export type RaiseOption = { kind: "sell_building" | "mortgage"; spaceId: string; name: string; raises: number };

export type RaiseMoney = {
  cash: number;
  needed: number;
  shortBy: number;
  /** Things the player could do right now, one step each. Selling a building may unlock a mortgage in that set. */
  options: RaiseOption[];
  /** Cash plus everything that could be raised by selling every building and mortgaging every property. */
  maxCash: number;
  canCover: boolean;
};

export function raiseMoneyOptions(state: GameState, playerId: string, needed: number): RaiseMoney {
  const player = state.players[playerId];
  const options: RaiseOption[] = [];
  let maxCash = player.cash;
  for (const s of ownedSpaces(state, playerId)) {
    const p = state.props[s.id];
    maxCash += levelOf(p) * sellValue(s);
    if (!p.mortgaged) maxCash += mortgageValue(s);

    const sell = canSellBuilding(state, playerId, s.id);
    if (sell.ok) options.push({ kind: "sell_building", spaceId: s.id, name: s.name, raises: sell.refund });
    const mort = canMortgage(state, playerId, s.id);
    if (mort.ok) options.push({ kind: "mortgage", spaceId: s.id, name: s.name, raises: mort.raises });
  }
  options.sort((a, b) => b.raises - a.raises || a.name.localeCompare(b.name));
  return { cash: player.cash, needed, shortBy: Math.max(0, needed - player.cash), options, maxCash, canCover: maxCash >= needed };
}

// ---- Stakes ----

export function validateSplit(split: number[], players?: number) {
  if (split.length === 0) throw new RuleError("INVALID_ACTION", "Add at least one payout position.");
  if (!split.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 100)) {
    throw new RuleError("INVALID_ACTION", "Payout percentages must be whole numbers from 0 to 100.");
  }
  if (split.reduce((a, b) => a + b, 0) !== 100) throw new RuleError("INVALID_ACTION", "Payout percentages must total 100.");
  if (players !== undefined && split.length > players) {
    throw new RuleError("INVALID_ACTION", `There are only ${players} players, so at most ${players} places can be paid.`);
  }
}

/**
 * Real-₹ payouts by finishing position (index 0 = 1st). Each place gets its percentage of the pot rounded down;
 * the leftover rupees go to 1st so the payouts always add up to exactly the pot.
 */
export function splitStakes(buyIn: number, players: number, split: number[]) {
  validateSplit(split, players);
  if (!Number.isSafeInteger(buyIn) || buyIn < 0) throw new RuleError("INVALID_ACTION", "Buy-in must be a whole number of rupees.");
  const pot = buyIn * players;
  const payouts = split.map((pct) => Math.floor((pot * pct) / 100));
  payouts[0] += pot - payouts.reduce((a, b) => a + b, 0);
  return { pot, payouts };
}

// ---- Validation for settings and the board editor ----

export function validateSettings(settings: Settings, players: number) {
  if (!Number.isSafeInteger(settings.stakes.buyIn) || settings.stakes.buyIn < 0) {
    throw new RuleError("INVALID_ACTION", "Buy-in must be a whole number of rupees.");
  }
  validateSplit(settings.stakes.split, players);
  // evenBuilding is simply ignored while trackProperties is off: nothing can be built.
  if (settings.bankerMode === "bankerApproves" && !settings.bankerPlayerId) {
    throw new RuleError("INVALID_ACTION", "Choose who the banker is.");
  }
}

const isMoney = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Problems with a board config (empty = fine). Used by the board editor before saving. */
export function boardProblems(board: BoardConfig): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  if (board.spaces.length !== 40) problems.push(`The board has ${board.spaces.length} spaces, expected 40.`);
  if (board.spaces[0]?.kind !== "go") problems.push("The first space must be GO.");
  for (const s of board.spaces) {
    if (ids.has(s.id)) problems.push(`Duplicate space id ${s.id}.`);
    ids.add(s.id);
    if (!s.name.trim()) problems.push(`Space ${s.id} needs a name.`);
    if (s.kind === "property") {
      if (!s.group) problems.push(`${s.name} needs a colour group.`);
      if (!isMoney(s.price) || s.price === 0) problems.push(`${s.name} needs a price.`);
      if (!s.rent || s.rent.length !== 6 || !s.rent.every(isMoney)) problems.push(`${s.name} needs 6 rents (base, 1–4 houses, hotel).`);
      if (!isMoney(s.houseCost) || s.houseCost === 0) problems.push(`${s.name} needs a house cost.`);
    }
    if (s.kind === "rail") {
      if (!isMoney(s.price) || s.price === 0) problems.push(`${s.name} needs a price.`);
      if (!s.rent || s.rent.length !== 4 || !s.rent.every(isMoney)) problems.push(`${s.name} needs 4 rents (1 to 4 stations owned).`);
    }
    if (s.kind === "utility" && (!isMoney(s.price) || s.price === 0)) problems.push(`${s.name} needs a price.`);
    if (isOwnable(s) && !isMoney(s.mortgage)) problems.push(`${s.name} needs a mortgage value.`);
    if (isOwnable(s) && isMoney(s.mortgage) && isMoney(s.price) && s.mortgage > s.price) problems.push(`${s.name}'s mortgage can't exceed its price.`);
    if (s.kind === "tax" && !isMoney(s.amount)) problems.push(`${s.name} needs a tax amount.`);
  }
  if (!isMoney(board.passGo)) problems.push("Pass GO must be a whole number.");
  if (!isMoney(board.jailFine)) problems.push("The jail fine must be a whole number.");
  if (!isMoney(board.startingCash) || board.startingCash === 0) problems.push("Starting cash must be above 0.");
  if (!isMoney(board.houses) || !isMoney(board.hotels)) problems.push("House and hotel stock must be whole numbers.");
  if (!isMoney(board.jailCards) || board.jailCards > 4) problems.push("Jail cards must be 0 to 4.");
  if (board.utilityMultipliers.length < 2 || !board.utilityMultipliers.every(isMoney)) problems.push("Utility multipliers need one value per utility owned.");
  return problems;
}
