"use client";

import { Reorder, useDragControls } from "framer-motion";
import { useConvex } from "convex/react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { AmountStepper } from "@/components/ui/AmountStepper";
import { GoldButton, SecondaryButton } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/Sheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSubmit } from "@/hooks/useSubmit";
import { newKey } from "@/lib/errors";
import { formatInr } from "@/lib/format";
import type { PlayerRow, SessionState } from "@/components/lobby/types";

function SeatRow({
  player,
  seatNo,
  isHostSeat,
  canEditBuyIn,
  sessionId,
  onMove,
  isFirst,
  isLast,
}: {
  player: PlayerRow;
  seatNo: number;
  isHostSeat: boolean;
  canEditBuyIn: boolean;
  sessionId: Id<"sessions">;
  onMove: (dir: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const controls = useDragControls();
  const convex = useConvex();
  const { pending, run } = useSubmit();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(player.balance);
  useEffect(() => setAmount(player.balance), [player.balance]);

  const saveBuyIn = () =>
    run(async () => {
      await convex.mutation(api.sessions.setPlayerBuyIn, { sessionId, playerId: player._id, amount, idempotencyKey: newKey() });
      setEditing(false);
    });
  const answer = (approve: boolean) =>
    run(() => convex.mutation(api.sessions.approveRebind, { sessionId, playerId: player._id, approve }));

  return (
    <Reorder.Item value={player._id} dragListener={false} dragControls={controls} className="list-none rounded-2xl border border-line bg-surface2" style={{ position: "relative" }}>
      <div className="flex min-h-[60px] items-center gap-3 px-3 py-2">
        <button
          aria-label={`Drag to move ${player.name}`}
          onPointerDown={(e) => controls.start(e)}
          className="grid h-11 w-8 flex-none cursor-grab touch-none place-items-center text-ink3"
        >
          <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden>
            {[3, 9, 15].map((y) => (
              <g key={y}>
                <circle cx="3" cy={y} r="1.6" />
                <circle cx="11" cy={y} r="1.6" />
              </g>
            ))}
          </svg>
        </button>
        <Avatar name={player.name} size={40} badge={seatNo} dashed={player.status === "left"} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold">
            {player.name} {isHostSeat && <span className="text-gold-ink">♛</span>}
          </div>
          <div className="text-xs text-ink3">{player.status === "left" ? "Cashed out" : `${formatInr(player.balance)} in wallet`}</div>
        </div>
        <button
          onClick={() => setEditing((e) => !e)}
          aria-expanded={editing}
          className="press h-11 rounded-xl border border-line px-3 text-[13px] font-bold text-gold-ink"
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>
      {editing && (
        <div className="grid gap-2.5 border-t border-line px-3 py-2.5">
          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton disabled={isFirst} onClick={() => onMove(-1)}>
              ↑ Move up
            </SecondaryButton>
            <SecondaryButton disabled={isLast} onClick={() => onMove(1)}>
              ↓ Move down
            </SecondaryButton>
          </div>
          {canEditBuyIn && player.status === "active" && (
            <div className="flex items-center justify-between gap-2">
              <AmountStepper label={`${player.name}’s buy-in`} value={amount} onChange={setAmount} step={100} min={10} />
              <button disabled={pending || amount === player.balance} onClick={saveBuyIn} className="gold-btn press h-11 rounded-xl px-4 text-[13.5px]">
                Save
              </button>
            </div>
          )}
        </div>
      )}
      {player.rebindPending && (
        <div className="border-t border-line-gold bg-surface px-3 py-2.5">
          <div className="text-[13px] font-semibold">A new phone is asking to take over {player.name}’s seat.</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <SecondaryButton disabled={pending} onClick={() => answer(false)}>
              Decline
            </SecondaryButton>
            <GoldButton pending={pending} onClick={() => answer(true)} className="!h-12 !rounded-2xl !text-sm">
              Approve
            </GoldButton>
          </div>
        </div>
      )}
    </Reorder.Item>
  );
}

/** Host-only: drag seats into turn order, set buy-ins in custom mode, and approve phone changes. */
export function SeatsSheet({ open, onClose, state }: { open: boolean; onClose: () => void; state: SessionState }) {
  const convex = useConvex();
  const { pending, run } = useSubmit();
  const serverOrder = state.players.map((p) => p._id);
  const [order, setOrder] = useState<Id<"sessionPlayers">[]>(serverOrder);
  const key = serverOrder.join(",");
  useEffect(() => setOrder(serverOrder), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(state.players.map((p) => [p._id, p]));
  const changed = order.join(",") !== key;
  const locked = state.session.gamesStarted > 0;

  const save = () =>
    run(async () => {
      await convex.mutation(api.sessions.reorderSeats, { sessionId: state.session._id, order });
    });

  return (
    <Sheet open={open} onClose={onClose} title="Seats" subtitle="Drag to set turn order. Seat 1 plays first.">
      <Reorder.Group axis="y" values={order} onReorder={setOrder} className="mt-3.5 grid list-none gap-2 p-0">
        {order.map((id, i) => {
          const p = byId.get(id);
          return p ? (
            <SeatRow
              key={id}
              player={p}
              seatNo={i + 1}
              isHostSeat={state.session.hostPlayerId === id}
              canEditBuyIn={state.session.walletMode === "custom" && !locked}
              sessionId={state.session._id}
              isFirst={i === 0}
              isLast={i === order.length - 1}
              onMove={(dir) =>
                setOrder((o) => {
                  const next = [...o];
                  const j = i + dir;
                  [next[i], next[j]] = [next[j], next[i]];
                  return next;
                })
              }
            />
          ) : null;
        })}
      </Reorder.Group>
      {changed && (
        <div className="mt-3.5">
          <GoldButton pending={pending} onClick={save}>
            Save seat order
          </GoldButton>
        </div>
      )}
    </Sheet>
  );
}
