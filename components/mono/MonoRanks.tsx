"use client";

import { useGameState, useMoney, type MonoGame, type MonoPlayer } from "@/components/mono/types";
import { Avatar } from "@/components/ui/Avatar";
import { netWorthParts } from "@/lib/monopoly/rules";
import { ordinal } from "@/lib/monopoly/money";

/** Net-worth leaderboard: cash + property price (mortgaged at its mortgage value) + buildings at cost. Out players sit below. */
export function MonoRanks({ game, me }: { game: MonoGame; me: MonoPlayer | null }) {
  const gs = useGameState(game);
  const fmt = useMoney(game);
  const rows = game.players.map((p) => {
    const parts = netWorthParts(gs, p._id);
    return { p, parts, total: parts.cash + parts.property + parts.buildings };
  });
  const alive = rows.filter((r) => r.p.status === "playing").sort((a, b) => b.total - a.total || a.p.seatOrder - b.p.seatOrder);
  const out = rows.filter((r) => r.p.status === "bankrupt").sort((a, b) => (a.p.finishPosition ?? 99) - (b.p.finishPosition ?? 99));
  const ranked = [...alive, ...out];

  return (
    <>
      <div className="px-5 pt-5">
        <h1 className="font-display text-[28px] font-semibold">Ranks</h1>
        <div className="mt-0.5 text-[12.5px] font-semibold text-ink3">Net worth = cash + property price (mortgaged at half) + buildings at cost.</div>
      </div>
      <div className="mx-5 mt-3 flex gap-3.5 text-[11.5px] font-bold text-ink2">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-gold" />Cash</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-ink3" />Property</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "#3aa35f" }} />Buildings</span>
      </div>
      <div className="mx-4 mt-3 flex flex-col gap-2">
        {ranked.map((r, i) => {
          const dead = r.p.status === "bankrupt";
          const total = Math.max(1, r.total);
          return (
            <div key={r.p._id} className="rounded-[18px] border bg-surface px-3.5 py-3" style={{ borderColor: r.p._id === me?._id ? "var(--gold)" : "var(--line)", opacity: dead ? 0.55 : 1 }}>
              <div className="flex items-center gap-2.5">
                <div className="font-display w-7 text-[20px] font-bold" style={{ color: i === 0 && !dead ? "var(--gold-ink)" : "var(--ink3)" }}>
                  {dead ? "—" : i + 1}
                </div>
                <Avatar name={r.p.name} size={36} />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-[15px] font-extrabold">{r.p.name}</div>
                  <div className="text-[11.5px] font-semibold text-ink3">{dead ? `Out · finished ${ordinal(r.p.finishPosition ?? 0)}` : `${fmt(r.parts.cash)} cash`}</div>
                </div>
                <div className="amount text-[22px] tabular-nums">{fmt(dead ? 0 : r.total)}</div>
              </div>
              {!dead && (
                <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-surface3">
                  <div className="bg-gold" style={{ width: `${(r.parts.cash / total) * 100}%` }} />
                  <div className="bg-ink3" style={{ width: `${(r.parts.property / total) * 100}%` }} />
                  <div style={{ width: `${(r.parts.buildings / total) * 100}%`, background: "#3aa35f" }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
