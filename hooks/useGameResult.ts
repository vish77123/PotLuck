"use client";

import { useEffect, useRef } from "react";
import type { SessionState } from "@/components/lobby/types";
import { useUi } from "@/stores/ui";

/**
 * What to show after a game ends. If this phone watched the game finish, everyone gets the winner
 * celebration; if the game ended while the app was closed or in the background, a "while you were
 * away" note instead. Cancelled games just get a toast.
 */
export function useGameResult(state: SessionState) {
  const game = state.latestGame;
  const sessionId = state.session._id;
  const acked = useUi((s) => s.ackedGame[sessionId]);
  const ack = useUi((s) => s.ackGame);
  const pushToast = useUi((s) => s.pushToast);
  const watched = useRef<Set<string>>(new Set());
  const lastStatus = useRef<string | null>(null);

  useEffect(() => {
    if (!game) return;
    if (game.status === "active") watched.current.add(game._id);
    if (game.status === "cancelled" && lastStatus.current === "active") {
      pushToast({ text: `Round ${game.gameNo} was cancelled — everyone got their money back.`, tone: "warn" });
      ack(sessionId, game._id);
    }
    lastStatus.current = game.status;
  }, [game, sessionId, ack, pushToast]);

  if (!game || game.status !== "ended" || acked === game._id) return { kind: null as null, game: null };
  return { kind: (watched.current.has(game._id) ? "celebrate" : "away") as "celebrate" | "away", game };
}
