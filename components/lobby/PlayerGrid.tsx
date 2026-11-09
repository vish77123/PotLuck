"use client";

import { motion } from "framer-motion";
import { Avatar } from "@/components/ui/Avatar";
import { ONLINE_WINDOW_MS } from "@/hooks/usePresenceHeartbeat";
import type { PlayerRow } from "@/components/lobby/types";

export function PlayerGrid({
  players,
  meId,
  seen,
  now,
}: {
  players: PlayerRow[];
  meId: string;
  seen: Map<string, number>;
  now: number;
}) {
  return (
    <div className="mx-4 mt-2.5 grid grid-cols-4 gap-y-3.5 rounded-[20px] border border-line bg-surface px-2.5 py-3.5">
      {players.map((p) => {
        const left = p.status === "left";
        const last = seen.get(p._id);
        const online = !left && (p._id === meId || (last !== undefined && now - last < ONLINE_WINDOW_MS));
        return (
          <motion.div
            key={p._id}
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: left ? 0.5 : 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center gap-1.5"
          >
            <Avatar name={p.name} size={52} ring={p._id === meId ? "var(--gold)" : undefined} dashed={left} online={left ? undefined : online} badge={p.seatNo} />
            <div className="max-w-full truncate px-0.5 text-[12.5px] font-bold">{p.name}</div>
            {left && <div className="-mt-1 text-[10px] font-bold text-ink3">cashed out</div>}
          </motion.div>
        );
      })}
    </div>
  );
}
