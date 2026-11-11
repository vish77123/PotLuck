import type { Space } from "./types";

// Identity colours for the eight sets, stations and utilities. They mark identity only; gold still means "tap me"
// and a player's avatar colour means "owned by".
export const GROUP_COLOURS: Record<string, string> = {
  brown: "#8b5a3c",
  lblue: "#9ad3ee",
  pink: "#d64f97",
  orange: "#ef8b2c",
  red: "#d93a35",
  yellow: "#f2cf3e",
  green: "#23925a",
  dblue: "#2a4d9e",
  rail: "#26272a",
  util: "#9aa3a6",
};

export const GROUP_LABELS: Record<string, string> = {
  brown: "Brown",
  lblue: "Light blue",
  pink: "Pink",
  orange: "Orange",
  red: "Red",
  yellow: "Yellow",
  green: "Green",
  dblue: "Dark blue",
  rail: "Stations",
  util: "Utilities",
};

/** The key used for colours and labels: the colour set, or rail / util for the special spaces. */
export function groupKeyOf(space: Space): string {
  return space.kind === "rail" ? "rail" : space.kind === "utility" ? "util" : (space.group ?? "brown");
}

export const GROUP_ORDER = ["brown", "lblue", "pink", "orange", "red", "yellow", "green", "dblue", "rail", "util"];
