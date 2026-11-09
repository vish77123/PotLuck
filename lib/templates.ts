import { formatInr } from "@/lib/format";

type T = {
  boot: number;
  minBet: number;
  maxBet?: number;
  blindSeenMultiplier?: number;
  turnMode: "turn_based" | "free_form";
  teamMode: "solo" | "team";
};

/** One-line summary under a template name: "Boot ₹10 · ₹10–₹500 · Blind/Seen ×2 · Turn-based". */
export function templateMeta(t: T) {
  const parts = [t.boot > 0 ? `Boot ${formatInr(t.boot)}` : "No boot"];
  parts.push(t.maxBet !== undefined ? `${formatInr(t.minBet)}–${formatInr(t.maxBet)}` : `${formatInr(t.minBet)}+`);
  if (t.blindSeenMultiplier) parts.push(`Blind/Seen ×${t.blindSeenMultiplier}`);
  if (t.teamMode === "team") parts.push("Teams");
  parts.push(t.turnMode === "turn_based" ? "Turn-based" : "Free-form");
  return parts.join(" · ");
}
