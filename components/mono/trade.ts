import type { MonoGame } from "@/components/mono/types";
import { formatMoney } from "@/lib/monopoly/money";
import type { TradeSide } from "@/lib/monopoly/engine";

/** "$200 + Market Sq + Mill Lane + 1 Get Out of Jail Free card" */
export function sideText(game: MonoGame, side: Pick<TradeSide, "cash" | "spaceIds" | "jailCards">) {
  const parts: string[] = [];
  if (side.cash > 0) parts.push(formatMoney(side.cash, game.boardSnapshot.currency));
  for (const id of side.spaceIds) parts.push(game.boardSnapshot.spaces.find((s) => s.id === id)?.name ?? "a property");
  if (side.jailCards > 0) parts.push(`${side.jailCards} Get Out of Jail Free card${side.jailCards > 1 ? "s" : ""}`);
  return parts.join(" + ") || "nothing";
}
