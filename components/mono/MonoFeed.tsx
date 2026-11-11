"use client";

import { useMemo } from "react";
import { useMonoActions } from "@/components/mono/actions";
import type { MonoGame, MonoState } from "@/components/mono/types";
import { Avatar } from "@/components/ui/Avatar";

type Row = { groupId: string; groupNo: number; label: string; at: number; by: string; turn: boolean; reversal: boolean };

const time = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** The activity feed: one plain-language line per action, newest first. The host can undo a whole action. */
export function MonoFeed({ game, seats, isHost }: { game: MonoGame; seats: MonoState["seats"]; isHost: boolean }) {
  const actions = useMonoActions(game);
  const { rows, undone } = useMemo(() => {
    const byGroup = new Map<string, Row>();
    const undone = new Set<string>();
    for (const e of game.events) {
      if (e.reversesGroupId) undone.add(e.reversesGroupId);
      if (byGroup.has(e.groupId)) continue;
      byGroup.set(e.groupId, {
        groupId: e.groupId,
        groupNo: e.groupNo,
        label: e.label ?? "A move was recorded",
        at: e.createdAt,
        by: seats.find((s) => s._id === e.createdBy)?.name ?? "Someone",
        turn: e.type === "TURN",
        reversal: !!e.reversesGroupId,
      });
    }
    return { rows: [...byGroup.values()].sort((a, b) => b.groupNo - a.groupNo), undone };
  }, [game.events, seats]);

  if (rows.length === 0) {
    return <div className="mx-5 mt-10 text-center text-sm font-semibold text-ink3">Nothing has happened yet. Moves show up here as they're made.</div>;
  }
  return (
    <div className="mx-4 mt-3 flex flex-col">
      {rows.map((r) => {
        const dead = undone.has(r.groupId);
        return (
          <div key={r.groupId} className="flex gap-2.5 rounded-2xl px-2.5 py-2.5" style={{ opacity: dead ? 0.5 : 1 }}>
            <Avatar name={r.by} size={32} />
            <div className="min-w-0 flex-1 leading-snug">
              <div className={`text-[13.5px] font-semibold ${dead ? "line-through" : ""}`}>{r.label}</div>
              <div className="mt-0.5 text-[11.5px] font-semibold text-ink3">
                {time(r.at)}
                {dead ? " · undone" : ""}
                {r.reversal ? " · undo" : ""}
              </div>
            </div>
            {isHost && !r.turn && !r.reversal && !dead && game.status !== "ended" && (
              <button
                disabled={actions.pending}
                onClick={() => actions.undo(r.groupId, r.label)}
                className="press h-10 flex-none self-center rounded-xl border border-line px-3 text-[12.5px] font-bold text-warn"
              >
                Undo
              </button>
            )}
          </div>
        );
      })}
      {game.events.length >= 150 && <div className="py-3 text-center text-xs font-semibold text-ink3">Showing the latest 150 moves.</div>}
    </div>
  );
}
