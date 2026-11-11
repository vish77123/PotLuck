"use client";

import { useConvex } from "convex/react";
import { useState } from "react";
import type { MonoState } from "@/components/mono/types";
import { Avatar } from "@/components/ui/Avatar";
import { Sheet } from "@/components/ui/Sheet";
import { api } from "@/convex/_generated/api";
import { useSubmit } from "@/hooks/useSubmit";

/** Turn order follows seat order. The host moves seats up and down, and approves a player's new phone. */
export function MonoSeats({ open, onClose, state, locked }: { open: boolean; onClose: () => void; state: MonoState; locked: boolean }) {
  const convex = useConvex();
  const { pending, run } = useSubmit();
  const [busy, setBusy] = useState<string | null>(null);
  const seats = [...state.seats].sort((a, b) => a.seatNo - b.seatNo);

  const move = (i: number, dir: -1 | 1) =>
    run(async () => {
      const order = seats.map((p) => p._id);
      [order[i], order[i + dir]] = [order[i + dir], order[i]];
      await convex.mutation(api.sessions.reorderSeats, { sessionId: state.session._id, order });
    });
  const rebind = (playerId: (typeof seats)[number]["_id"], approve: boolean) =>
    run(async () => {
      setBusy(playerId);
      try {
        await convex.mutation(api.sessions.approveRebind, { sessionId: state.session._id, playerId, approve });
      } finally {
        setBusy(null);
      }
    });

  return (
    <Sheet open={open} onClose={onClose} title="Seats" subtitle={locked ? "Seats are locked while a game is running." : "Turn order follows the seat numbers."}>
      <div className="mt-3 overflow-hidden rounded-[16px] border border-line">
        {seats.map((p, i) => (
          <div key={p._id} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
            <div className="w-5 text-center text-sm font-extrabold text-ink3">{i + 1}</div>
            <Avatar name={p.name} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14.5px] font-extrabold">{p.name}</div>
              {p.status === "left" && <div className="text-[11px] font-bold text-ink3">cashed out</div>}
              {p.rebindPending && <div className="text-[11px] font-bold text-gold-ink">new phone waiting</div>}
            </div>
            {p.rebindPending && (
              <>
                <button disabled={pending || busy === p._id} onClick={() => rebind(p._id, false)} className="press h-10 rounded-xl border border-line px-3 text-xs font-bold">
                  Decline
                </button>
                <button disabled={pending || busy === p._id} onClick={() => rebind(p._id, true)} className="gold-btn press h-10 rounded-xl px-3 text-xs">
                  Move
                </button>
              </>
            )}
            {!locked && (
              <div className="flex gap-1">
                <button aria-label={`Move ${p.name} up`} disabled={pending || i === 0} onClick={() => move(i, -1)} className="press h-10 w-10 rounded-xl border border-line disabled:opacity-30">
                  ▲
                </button>
                <button aria-label={`Move ${p.name} down`} disabled={pending || i === seats.length - 1} onClick={() => move(i, 1)} className="press h-10 w-10 rounded-xl border border-line disabled:opacity-30">
                  ▼
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
