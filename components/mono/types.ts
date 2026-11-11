import type { FunctionReturnType } from "convex/server";
import { useMemo } from "react";
import type { api } from "@/convex/_generated/api";
import { toGameState } from "@/lib/monopoly/state";
import { formatMoney } from "@/lib/monopoly/money";

export type MonoState = FunctionReturnType<typeof api.mono.state>;
export type MonoGame = NonNullable<MonoState["game"]>;
export type MonoPlayer = MonoGame["players"][number];
export type MonoRequest = MonoGame["requests"][number];
export type MonoEvent = MonoGame["events"][number];

/** The shared pure GameState, built from what the server sent, so the UI uses the same rules as the backend. */
export function useGameState(game: MonoGame) {
  return useMemo(
    () =>
      toGameState(
        game,
        game.players.map((p) => ({ ...p, _id: p._id as string })),
        game.props.map((p) => ({ ...p, ownerPlayerId: p.ownerPlayerId as string | null })),
      ),
    [game],
  );
}

export function useMoney(game: MonoGame) {
  const currency = game.boardSnapshot.currency;
  return useMemo(() => (n: number) => formatMoney(n, currency), [currency]);
}
