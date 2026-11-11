"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { BackButton, Segmented } from "@/components/ui/controls";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { MONOPOLY_ENABLED } from "@/lib/flags";
import { formatNet, netColor } from "@/lib/format";

const RANK = ["#d4ac5a", "#a9adb3", "#b0763e"];

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export default function CrewPage() {
  const { crewId } = useParams<{ crewId: string }>();
  const [period, setPeriod] = useState<"all" | "month">("all");
  const [since] = useState(monthStart);
  const data = useAuthedQuery(api.stats.leaderboard, { crewId: crewId as Id<"crews">, since: period === "month" ? since : undefined });
  const propertyBoard = useAuthedQuery(api.monoStats.leaderboard, MONOPOLY_ENABLED ? { crewId: crewId as Id<"crews"> } : "skip");

  return (
    <main className="room mx-auto w-full max-w-[520px] pb-10 text-ink">
      <div className="flex items-center gap-2.5 px-4" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <div className="flex items-center gap-2.5 pt-3">
          <BackButton href="/" />
          <div className="text-[13px] font-bold tracking-[.1em] text-ink3">CREW LEADERBOARD</div>
        </div>
      </div>
      {!data ? (
        <div className="skeleton mx-4 mt-6 h-72 rounded-[22px] bg-surface2" aria-busy="true" />
      ) : (
        <>
          <div className="px-5 pt-3.5">
            <h1 className="font-display text-[32px] font-semibold leading-[1.1]">{data.crew.name}</h1>
            <div className="mt-1 text-[13.5px] text-ink2">
              {data.memberCount} players · {data.sessionCount} {data.sessionCount === 1 ? "session" : "sessions"}
              {data.since ? ` since ${new Date(data.since).toLocaleDateString("en-IN", { month: "long" })}` : ""}
            </div>
          </div>
          <div className="mx-4 mt-4">
            <Segmented
              value={period}
              onChange={setPeriod}
              options={[
                { value: "all", label: "All time" },
                { value: "month", label: "This month" },
              ]}
            />
          </div>
          {MONOPOLY_ENABLED && (
            <Link href={`/crew/${crewId}/board`} className="press mx-4 mt-3.5 flex h-12 items-center justify-between rounded-[16px] border border-line bg-surface px-4 text-[13.5px] font-bold">
              <span>Property game board values</span>
              <span className="text-gold-ink">Edit</span>
            </Link>
          )}
          <div className="mx-4 mt-3.5 overflow-hidden rounded-[22px] border border-line bg-surface">
            {data.board.length === 0 && <div className="px-4 py-10 text-center text-sm text-ink3">No finished sessions {period === "month" ? "this month" : "yet"}.</div>}
            {data.board.map((r) => (
              <Link
                key={r.memberId}
                href={`/crew/${crewId}/${r.memberId}`}
                className="flex h-16 items-center gap-3 border-b border-line px-4 last:border-b-0"
                style={{ background: r.rank === 1 ? "var(--surface2)" : undefined }}
              >
                <div className="font-display w-[26px] text-center text-[22px] font-bold" style={{ color: RANK[r.rank - 1] ?? "var(--ink3)" }}>
                  {r.rank}
                </div>
                <Avatar name={r.name} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-bold">{r.name}</div>
                  <div className="text-xs font-semibold text-ink3">
                    {r.sessions} {r.sessions === 1 ? "session" : "sessions"} · {r.gamesWon} {r.gamesWon === 1 ? "win" : "wins"}
                  </div>
                </div>
                <div className="amount text-xl" style={{ color: netColor(r.totalNet) }}>
                  {formatNet(r.totalNet)}
                </div>
              </Link>
            ))}
          </div>
          {propertyBoard && propertyBoard.length > 0 && (
            <>
              <div className="px-5 pt-6 text-[15px] font-extrabold">Property games</div>
              <div className="mx-4 mt-2.5 overflow-hidden rounded-[22px] border border-line bg-surface">
                {propertyBoard.map((r) => (
                  <Link key={r.memberId} href={`/crew/${crewId}/${r.memberId}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                    <Avatar name={r.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-bold">{r.name}</div>
                      <div className="text-xs font-semibold text-ink3">
                        {r.games} {r.games === 1 ? "game" : "games"} · {r.wins} {r.wins === 1 ? "win" : "wins"} · avg place {r.avgFinish ?? "—"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="amount text-[17px]">{r.rentEarned.toLocaleString("en-IN")}</div>
                      <div className="text-[10.5px] font-extrabold tracking-[.1em] text-ink3">RENT EARNED</div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
