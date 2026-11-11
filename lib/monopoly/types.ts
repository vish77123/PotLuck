// Pure types for Monopoly sessions. No Convex imports: the backend, the UI and the tests all share this module.
// The stored shapes (convex/schema.ts: boardV, monoSettingsV) mirror these; convex/monopoly.schema.test.ts checks it.

export type GroupKey = "brown" | "lblue" | "pink" | "orange" | "red" | "yellow" | "green" | "dblue";

export type SpaceKind = "go" | "property" | "rail" | "utility" | "tax" | "card" | "jail" | "parking" | "gotojail";

export type Space = {
  /** Stable id, never reused inside a board (e.g. "s01"). Property state and events refer to it. */
  id: string;
  name: string;
  kind: SpaceKind;
  group?: GroupKey;
  /** property, rail, utility */
  price?: number;
  /** property: [base, 1 house, 2, 3, 4, hotel]. rail: rent by number owned [1, 2, 3, 4]. */
  rent?: number[];
  /** property: cost of one house; a hotel costs the same on top of 4 houses. */
  houseCost?: number;
  mortgage?: number;
  /** tax spaces */
  amount?: number;
  /** false = a placeholder value nobody has checked against a physical board. */
  verified?: boolean;
};

export type Currency = "$" | "₹";

export type BoardConfig = {
  key: string;
  name: string;
  currency: Currency;
  /** In board order, starting with GO. */
  spaces: Space[];
  passGo: number;
  jailFine: number;
  startingCash: number;
  /** How many Get Out of Jail Free cards exist in the game. */
  jailCards: number;
  houses: number;
  hotels: number;
  /** Utility rent = dice total × multiplier[owned − 1]. */
  utilityMultipliers: number[];
  /** false = the board-wide values above (GO, fine, cash, stock, multipliers) are unchecked placeholders. */
  verified?: boolean;
};

export type BankerMode = "selfService" | "bankerApproves";

export type Settings = {
  trackProperties: boolean;
  bankerMode: BankerMode;
  /** An mPlayers id (a plain string here). */
  bankerPlayerId?: string;
  freeParkingPot: boolean;
  doubleOnGo: boolean;
  auctions: boolean;
  evenBuilding: boolean;
  /** Real ₹. `split` is a percentage per finishing position and totals 100. */
  stakes: { buyIn: number; split: number[] };
};

export const DEFAULT_SETTINGS: Settings = {
  trackProperties: true,
  bankerMode: "selfService",
  freeParkingPot: false,
  doubleOnGo: false,
  auctions: true,
  evenBuilding: true,
  stakes: { buyIn: 0, split: [100] },
};

/** A party to a cash or card move: a player id, the bank, or the Free Parking pot. */
export type Party = string;
export const BANK = "bank";
export const POT = "pot";

export type PlayerState = {
  id: string;
  /** For error messages and descriptions; the backend fills it from the session player. */
  name?: string;
  /** Seat order; turn order follows it. */
  seat: number;
  cash: number;
  inJail: boolean;
  jailTurns: number;
  jailCards: number;
  status: "playing" | "bankrupt";
  finishPosition?: number;
};

export type PropState = {
  /** null = the bank. */
  owner: string | null;
  houses: number;
  hotel: boolean;
  mortgaged: boolean;
};

export type GameState = {
  board: BoardConfig;
  settings: Settings;
  players: Record<string, PlayerState>;
  /** Keyed by space id. Empty when trackProperties is off. */
  props: Record<string, PropState>;
  pot: number;
  bankHouses: number;
  bankHotels: number;
};

// ---- Events: the atoms of every game change. One user action = a group (array) of events. ----
// Field names match the mEvents table, so a row is an event plus its group bookkeeping.

export type PayReason =
  | "pass_go"
  | "go_bonus"
  | "bank"
  | "payment"
  | "rent"
  | "tax"
  | "jail_fine"
  | "card"
  | "repairs"
  | "purchase"
  | "auction"
  | "build"
  | "sell_building"
  | "mortgage"
  | "unmortgage"
  | "interest"
  | "trade"
  | "pot"
  | "bankruptcy";

export type PayEvent = {
  type: "PAY";
  fromParty: Party;
  toParty: Party;
  amount: number;
  spaceId?: string;
  meta?: { reason: PayReason; [k: string]: unknown };
};

/** Ownership change. The mortgaged flag travels with the property. */
export type PropertyEvent = { type: "PROPERTY"; fromParty: Party; toParty: Party; spaceId: string; meta?: Record<string, unknown> };

export type Buildings = { houses: number; hotel: boolean };

/** Houses and hotel on a space. before/after make it self-inverting; the bank's stock moves with the difference. */
export type BuildingsEvent = { type: "BUILDINGS"; spaceId: string; meta: { before: Buildings; after: Buildings } };

/** `mortgaged` is the state after the event. */
export type MortgageEvent = { type: "MORTGAGE"; spaceId: string; meta: { mortgaged: boolean } };

export type JailState = { inJail: boolean; jailTurns: number };
export type JailEvent = { type: "JAIL"; meta: { player: string; before: JailState; after: JailState } };

/** Get Out of Jail Free cards moving between a player and the deck ("bank") or another player. */
export type JailCardEvent = { type: "JAIL_CARD"; fromParty: Party; toParty: Party; amount: number };

/** A player goes bankrupt and takes `position` as their finishing place. */
export type BankruptEvent = { type: "BANKRUPT"; meta: { player: string; position: number; undo?: boolean } };

/** A player still in the game gets a final position (the winner, or the host ending the game early). */
export type FinishEvent = { type: "FINISH"; meta: { player: string; position: number; undo?: boolean } };

export type MEvent = PayEvent | PropertyEvent | BuildingsEvent | MortgageEvent | JailEvent | JailCardEvent | BankruptEvent | FinishEvent;

export type RuleErrorCode =
  | "INSUFFICIENT_CASH"
  | "INVALID_ACTION"
  | "NOT_OWNER"
  | "NOT_FOUND"
  | "BANK_STOCK"
  | "BLOCKED";

export class RuleError extends Error {
  constructor(
    public code: RuleErrorCode,
    message: string,
    /** For INSUFFICIENT_CASH: who is short and by how much, so the UI can open the raise-money flow. */
    public detail?: { playerId: string; needed: number; shortBy: number },
  ) {
    super(message);
    this.name = "RuleError";
  }
}
