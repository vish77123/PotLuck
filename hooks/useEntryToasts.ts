"use client";

import { useEffect, useRef } from "react";
import type { SessionState } from "@/components/lobby/types";
import { formatInr } from "@/lib/format";
import { useUi } from "@/stores/ui";

/** A toast for what other people just did at the table. Entries already on screen at load stay quiet. */
export function useEntryToasts(state: SessionState) {
  const pushToast = useUi((s) => s.pushToast);
  const seen = useRef<number | null>(null);
  const { recentEntries, players, meId, latestGame } = state;

  useEffect(() => {
    const newest = recentEntries[0]?.seq ?? 0;
    if (seen.current === null) {
      seen.current = newest;
      return;
    }
    const fresh = recentEntries.filter((e) => e.seq > (seen.current ?? 0)).reverse();
    seen.current = Math.max(seen.current, newest);
    const name = (id?: string) => players.find((p) => p._id === id)?.name ?? "Someone";
    const blindSeen = !!latestGame?.templateSnapshot.blindSeenMultiplier;
    for (const e of fresh) {
      if (e.createdByPlayerId === meId) continue;
      if (e.type === "BET") {
        pushToast({
          text: `${name(e.fromPlayerId)} bet ${formatInr(e.amount)}${e.meta?.seen ? " · Seen" : blindSeen ? " · Blind" : ""}`,
        });
      } else if (e.type === "PAYOUT") {
        pushToast({ text: `${name(e.toPlayerId)} won ${formatInr(e.amount)}` });
      } else if (e.type === "REVERSAL") {
        pushToast({
          text: `${e.meta?.undoneByName ?? "Host"} undid ${formatInr(e.amount)} ${e.reversesType === "BET" || e.reversesType === "BOOT" ? "from" : "for"} ${name(e.toPlayerId ?? e.fromPlayerId)}`,
          tone: "warn",
          badge: "↺",
        });
      }
    }
  }, [recentEntries, players, meId, latestGame, pushToast]);
}
