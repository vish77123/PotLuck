"use client";

import { useEffect, useRef } from "react";
import type { SessionState } from "@/components/lobby/types";
import { formatInr } from "@/lib/format";
import { useUi } from "@/stores/ui";

/** Loan requests and answers pop up as toasts, wherever you are in the app. Already-known loans stay quiet on load. */
export function useLoanToasts(state: SessionState) {
  const pushToast = useUi((s) => s.pushToast);
  const known = useRef<Map<string, string> | null>(null);
  const { myLoans, players, meId } = state;

  useEffect(() => {
    const name = (id: string) => players.find((p) => p._id === id)?.name ?? "Someone";
    if (known.current === null) {
      known.current = new Map(myLoans.map((l) => [l._id, l.status]));
      return;
    }
    for (const l of myLoans) {
      const before = known.current.get(l._id);
      if (before === l.status) continue;
      known.current.set(l._id, l.status);
      const iAmLender = l.lenderPlayerId === meId;
      if (before === undefined && l.status === "requested" && iAmLender) {
        pushToast({ text: `${name(l.borrowerPlayerId)} wants to borrow ${formatInr(l.amount)} — open your wallet`, tone: "warn", badge: "₹" });
      } else if (!iAmLender && before === "requested" && l.status === "open") {
        pushToast({ text: `${name(l.lenderPlayerId)} lent you ${formatInr(l.amount)}` });
      } else if (!iAmLender && before === "requested" && l.status === "declined") {
        pushToast({ text: `${name(l.lenderPlayerId)} declined your request for ${formatInr(l.amount)}`, tone: "warn" });
      } else if (iAmLender && l.status === "settled_outside") {
        pushToast({ text: `${name(l.borrowerPlayerId)}'s loan was marked settled outside the app` });
      }
    }
  }, [myLoans, players, meId, pushToast]);
}
