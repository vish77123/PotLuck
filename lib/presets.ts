export type TemplateDraft = {
  name: string;
  boot: number;
  minBet: number;
  maxBet?: number;
  blindSeenMultiplier?: number;
  turnMode: "turn_based" | "free_form";
  teamMode: "solo" | "team";
  confirmAbove?: number;
};

/** Seeded into every new crew. Shared by the backend (seeding) and the template editor (preset pills). */
export const PRESET_TEMPLATES: TemplateDraft[] = [
  {
    name: "Teen Patti",
    boot: 10,
    minBet: 10,
    maxBet: 1000,
    blindSeenMultiplier: 2,
    turnMode: "turn_based",
    teamMode: "solo",
    confirmAbove: 200,
  },
  { name: "Poker", boot: 0, minBet: 10, turnMode: "turn_based", teamMode: "solo", confirmAbove: 500 },
  { name: "Sequence", boot: 50, minBet: 10, turnMode: "free_form", teamMode: "team", confirmAbove: 500 },
];
