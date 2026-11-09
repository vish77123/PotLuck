"use client";

import { useConvex } from "convex/react";
import { useState } from "react";
import type { SessionState } from "@/components/lobby/types";
import { useResult } from "@/components/table/ResultScreen";
import { Dialog } from "@/components/ui/Dialog";
import { api } from "@/convex/_generated/api";
import { useSubmit } from "@/hooks/useSubmit";
import { newKey } from "@/lib/errors";
import { formatInr } from "@/lib/format";

type Game = NonNullable<SessionState["latestGame"]>;

/** Between games: who won the last one, and the host's way to reopen it if the wrong winner was picked. */
export function LastGameCard({ state, game }: { state: SessionState; game: Game }) {
  const convex = useConvex();
  const { pending, run } = useSubmit();
  const [confirm, setConfirm] = useState(false);
  const r = useResult(state, game);
  const mine = game.gameNo === state.session.gamesStarted;

  return (
    <>
      <div className="mx-4 mt-3.5 flex items-center gap-3 rounded-[20px] border border-line bg-surface px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-extrabold tracking-[.16em] text-ink3">
            LAST GAME · ROUND {game.gameNo} · {game.templateSnapshot.name.toUpperCase()}
          </div>
          <div className="font-display mt-0.5 truncate text-lg font-semibold">
            {r.ready ? `${r.headline} won ${formatInr(r.total)}` : "…"}
          </div>
        </div>
        {state.isHost && mine && (
          <button onClick={() => setConfirm(true)} className="press h-11 rounded-xl border border-line px-3 text-[13px] font-bold text-gold-ink">
            ↺ Reopen
          </button>
        )}
      </div>
      <Dialog
        open={confirm}
        eyebrow="REOPEN GAME"
        title={`Reopen Round ${game.gameNo}?`}
        body="The payout is reversed and the game goes back on the table so you can pick the right winner. The winner needs to still have the money."
        noLabel="Not now"
        yesLabel="Reopen"
        onNo={() => setConfirm(false)}
        onYes={() =>
          run(async () => {
            await convex.mutation(api.games.reopen, { gameId: game._id, idempotencyKey: newKey() });
            setConfirm(false);
          })
        }
        pending={pending}
      />
    </>
  );
}
