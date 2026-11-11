import type { BoardConfig, GroupKey, Space } from "./types";

// Both presets share one 40-space layout (the design's ring order). Only names, currency and the `verified`
// flag differ. Classic uses the standard values; Business copies them as PLACEHOLDERS (see BUSINESS below).

type Colour = { price: number; rents: number[][]; houseCost: number; mortgages: number[]; prices?: number[] };

// rents: one row per property in the group: [base, 1h, 2h, 3h, 4h, hotel]
const COLOURS: Record<GroupKey, Colour> = {
  brown: {
    price: 60,
    rents: [[2, 10, 30, 90, 160, 250], [4, 20, 60, 180, 320, 450]],
    houseCost: 50,
    mortgages: [30, 30],
  },
  lblue: {
    price: 100,
    prices: [100, 100, 120],
    rents: [[6, 30, 90, 270, 400, 550], [6, 30, 90, 270, 400, 550], [8, 40, 100, 300, 450, 600]],
    houseCost: 50,
    mortgages: [50, 50, 60],
  },
  pink: {
    price: 140,
    prices: [140, 140, 160],
    rents: [[10, 50, 150, 450, 625, 750], [10, 50, 150, 450, 625, 750], [12, 60, 180, 500, 700, 900]],
    houseCost: 100,
    mortgages: [70, 70, 80],
  },
  orange: {
    price: 180,
    prices: [180, 180, 200],
    rents: [[14, 70, 200, 550, 750, 950], [14, 70, 200, 550, 750, 950], [16, 80, 220, 600, 800, 1000]],
    houseCost: 100,
    mortgages: [90, 90, 100],
  },
  red: {
    price: 220,
    prices: [220, 220, 240],
    rents: [[18, 90, 250, 700, 875, 1050], [18, 90, 250, 700, 875, 1050], [20, 100, 300, 750, 925, 1100]],
    houseCost: 150,
    mortgages: [110, 110, 120],
  },
  yellow: {
    price: 260,
    prices: [260, 260, 280],
    rents: [[22, 110, 330, 800, 975, 1150], [22, 110, 330, 800, 975, 1150], [24, 120, 360, 850, 1025, 1200]],
    houseCost: 150,
    mortgages: [130, 130, 140],
  },
  green: {
    price: 300,
    prices: [300, 300, 320],
    rents: [[26, 130, 390, 900, 1100, 1275], [26, 130, 390, 900, 1100, 1275], [28, 150, 450, 1000, 1200, 1400]],
    houseCost: 200,
    mortgages: [150, 150, 160],
  },
  dblue: {
    price: 350,
    prices: [350, 400],
    rents: [[35, 175, 500, 1100, 1300, 1500], [50, 200, 600, 1400, 1700, 2000]],
    houseCost: 200,
    mortgages: [175, 200],
  },
};

type Names = {
  groups: Record<GroupKey, string[]>;
  rail: string[];
  util: string[];
  tax: [string, string];
};

// Board order: [kind, group | index-into-rail/util/tax]. Colour groups are taken in order, so the nth entry of a
// group is the nth name and the nth row of COLOURS[group].
type Slot =
  | { kind: "go" | "jail" | "parking" | "gotojail" | "card" }
  | { kind: "property"; group: GroupKey }
  | { kind: "rail" | "utility" | "tax" };

const LAYOUT: Slot[] = [
  { kind: "go" },
  { kind: "property", group: "brown" },
  { kind: "card" },
  { kind: "property", group: "brown" },
  { kind: "tax" },
  { kind: "rail" },
  { kind: "property", group: "lblue" },
  { kind: "card" },
  { kind: "property", group: "lblue" },
  { kind: "property", group: "lblue" },
  { kind: "jail" },
  { kind: "property", group: "pink" },
  { kind: "utility" },
  { kind: "property", group: "pink" },
  { kind: "property", group: "pink" },
  { kind: "rail" },
  { kind: "property", group: "orange" },
  { kind: "card" },
  { kind: "property", group: "orange" },
  { kind: "property", group: "orange" },
  { kind: "parking" },
  { kind: "property", group: "red" },
  { kind: "card" },
  { kind: "property", group: "red" },
  { kind: "property", group: "red" },
  { kind: "rail" },
  { kind: "property", group: "yellow" },
  { kind: "property", group: "yellow" },
  { kind: "utility" },
  { kind: "property", group: "yellow" },
  { kind: "gotojail" },
  { kind: "property", group: "green" },
  { kind: "property", group: "green" },
  { kind: "card" },
  { kind: "property", group: "green" },
  { kind: "rail" },
  { kind: "card" },
  { kind: "property", group: "dblue" },
  { kind: "tax" },
  { kind: "property", group: "dblue" },
];

function buildSpaces(names: Names, verified: boolean): Space[] {
  const seen: Record<string, number> = {};
  const next = (key: string) => (seen[key] = (seen[key] ?? -1) + 1);
  return LAYOUT.map((slot, i): Space => {
    const id = `s${String(i).padStart(2, "0")}`;
    const flag = { verified };
    switch (slot.kind) {
      case "go":
        return { id, name: "GO", kind: "go", ...flag };
      case "jail":
        return { id, name: "Jail", kind: "jail", ...flag };
      case "parking":
        return { id, name: "Free Parking", kind: "parking", ...flag };
      case "gotojail":
        return { id, name: "Go to Jail", kind: "gotojail", ...flag };
      case "card":
        return { id, name: "Draw card", kind: "card", ...flag };
      case "tax": {
        const n = next("tax");
        return { id, name: names.tax[n], kind: "tax", amount: n === 0 ? 200 : 100, ...flag };
      }
      case "rail":
        return { id, name: names.rail[next("rail")], kind: "rail", price: 200, rent: [25, 50, 100, 200], mortgage: 100, ...flag };
      case "utility":
        return { id, name: names.util[next("util")], kind: "utility", price: 150, mortgage: 75, ...flag };
      case "property": {
        const c = COLOURS[slot.group];
        const n = next(slot.group);
        return {
          id,
          name: names.groups[slot.group][n],
          kind: "property",
          group: slot.group,
          price: c.prices?.[n] ?? c.price,
          rent: c.rents[n],
          houseCost: c.houseCost,
          mortgage: c.mortgages[n],
          ...flag,
        };
      }
    }
  });
}

/** Classic: the standard values (Pass GO 200, jail fine 50, cash 1500, 32 houses, 12 hotels) with original street names. */
export const CLASSIC: BoardConfig = {
  key: "classic",
  name: "Classic",
  currency: "$",
  spaces: buildSpaces(
    {
      groups: {
        brown: ["Mill Lane", "Cobble Row"],
        lblue: ["Harbour St", "Lantern Way", "Quay Road"],
        pink: ["Rose Court", "Orchard Ave", "Willow Walk"],
        orange: ["Market Sq", "Bridge St", "Chapel Hill"],
        red: ["Regent Row", "Crown Ave", "Kings Parade"],
        yellow: ["Gallery Rd", "Theatre Ln", "Opal Gardens"],
        green: ["Ivy Terrace", "Oak Crescent", "Embassy Row"],
        dblue: ["Summit Dr", "Grand Esplanade"],
      },
      rail: ["North Stn", "East Stn", "South Stn", "West Stn"],
      util: ["Power Co.", "Water Co."],
      tax: ["Income Tax", "Luxury Tax"],
    },
    true,
  ),
  passGo: 200,
  jailFine: 50,
  startingCash: 1500,
  jailCards: 2,
  houses: 32,
  hotels: 12,
  utilityMultipliers: [4, 10],
  verified: true,
};

/**
 * Business (Indian cities).
 *
 * PLACEHOLDER VALUES. The structure and Indian city names follow the design handoff, but every number here
 * (prices, rents, house costs, mortgages, taxes, Pass GO, jail fine, starting cash, stock, utility
 * multipliers) is a copy of the Classic number, NOT read from a physical Business board. Every space and the
 * board-wide values are flagged `verified: false` until the host corrects them in the board editor.
 * `unverifiedItems(BUSINESS)` lists what still needs checking.
 */
export const BUSINESS: BoardConfig = {
  key: "business",
  name: "Business",
  currency: "₹",
  spaces: buildSpaces(
    {
      groups: {
        brown: ["Agra", "Jaipur"],
        lblue: ["Kochi", "Mysuru", "Pune"],
        pink: ["Indore", "Lucknow", "Bhopal"],
        orange: ["Hyderabad", "Ahmedabad", "Kolkata"],
        red: ["Chennai", "Bengaluru", "Goa"],
        yellow: ["Shimla", "Darjeeling", "Ooty"],
        green: ["Chandigarh", "Gurugram", "Delhi"],
        dblue: ["Juhu", "Mumbai"],
      },
      rail: ["Central", "Western", "Eastern", "Northern"],
      util: ["Power Co.", "Water Co."],
      tax: ["Income Tax", "Luxury Tax"],
    },
    false,
  ),
  passGo: 200,
  jailFine: 50,
  startingCash: 1500,
  jailCards: 2,
  houses: 32,
  hotels: 12,
  utilityMultipliers: [4, 10],
  verified: false,
};

export const PRESETS: Record<string, BoardConfig> = { classic: CLASSIC, business: BUSINESS };

export function presetByKey(key: string): BoardConfig {
  const preset = PRESETS[key];
  if (!preset) throw new Error(`Unknown board preset "${key}".`);
  return structuredClone(preset);
}

/** What still needs checking against a physical board: spaces with unverified values, and the board-wide values. */
export function unverifiedItems(board: BoardConfig): string[] {
  const items: string[] = [];
  if (board.verified === false) {
    items.push("Board-wide: Pass GO, jail fine, starting cash, Jail cards, house and hotel stock, utility multipliers");
  }
  for (const s of board.spaces) {
    if (s.verified === false && s.kind !== "go" && s.kind !== "jail" && s.kind !== "parking" && s.kind !== "gotojail" && s.kind !== "card") {
      items.push(`${s.name} (${s.kind})`);
    }
  }
  return items;
}
