"use client";

import { useConvex } from "convex/react";
import { useEffect, useState } from "react";
import { AmountStepper } from "@/components/ui/AmountStepper";
import { Segmented } from "@/components/ui/controls";
import { api } from "@/convex/_generated/api";
import { useSubmit } from "@/hooks/useSubmit";
import { newKey } from "@/lib/errors";
import { formatInr } from "@/lib/format";
import type { SessionState } from "@/components/lobby/types";

const PRESETS = [500, 1000, 2000, 5000];

/** Host-only: equal vs custom wallets and the starting amount. Buy-ins lock once a game has started. */
export function WalletCard({ session }: { session: SessionState["session"] }) {
  const convex = useConvex();
  const { pending, run } = useSubmit();
  const locked = session.gamesStarted > 0;
  const custom = session.walletMode === "custom";
  const [draft, setDraft] = useState<number | null>(null);
  const amount = draft ?? session.startingAmount;

  const update = (patch: { walletMode?: "equal" | "custom"; startingAmount?: number }) =>
    run(async () => {
      await convex.mutation(api.sessions.updateSettings, { sessionId: session._id, ...patch, idempotencyKey: newKey() });
    });

  // The stepper can be tapped fast; each commit rewrites everyone's buy-in, so wait for a pause.
  useEffect(() => {
    if (draft === null) return;
    if (draft === session.startingAmount) {
      setDraft(null);
      return;
    }
    const id = setTimeout(async () => {
      await update({ startingAmount: draft });
      setDraft(null);
    }, 700);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, session.startingAmount]);

  return (
    <div className="mx-4 mt-2.5 rounded-[20px] border border-line bg-surface p-3.5">
      <Segmented
        height={42}
        value={session.walletMode}
        disabled={locked || pending}
        onChange={(walletMode) => update({ walletMode })}
        options={[
          { value: "equal", label: "Equal for all" },
          { value: "custom", label: "Custom per player" },
        ]}
      />
      <div className="mt-3.5 flex flex-col items-center">
        <div className="text-[10.5px] font-extrabold tracking-[.16em] text-ink3">{custom ? "SUGGESTED BUY-IN" : "STARTING AMOUNT"}</div>
        <AmountStepper label="Starting amount" size="lg" value={amount} onChange={setDraft} step={100} min={10} />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {PRESETS.map((p) => {
          const on = amount === p;
          return (
            <button
              key={p}
              disabled={locked}
              onClick={() => {
                setDraft(null);
                update({ startingAmount: p });
              }}
              className="press h-11 rounded-[10px] text-[13px] font-bold tabular-nums disabled:opacity-40"
              style={{ border: `1px solid ${on ? "var(--gold)" : "var(--line)"}`, background: on ? "var(--surface3)" : "transparent" }}
            >
              {formatInr(p)}
            </button>
          );
        })}
      </div>
      <div className="mt-3 text-xs leading-snug text-ink3">
        {locked
          ? "Buy-ins are locked now that a game has started."
          : custom
            ? "Each player chooses their own buy-in when they join. You can edit anyone’s under Seats."
            : "Everyone gets this when they join. Changing it updates everyone before the first game."}
      </div>
    </div>
  );
}
