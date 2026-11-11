"use client";

import { useParams } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { BackButton } from "@/components/ui/controls";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { MONOPOLY_ENABLED } from "@/lib/flags";
import { formatDay, formatInr, formatNet, netColor } from "@/lib/format";

export default function ProfilePage() {
  const { crewId, memberId } = useParams<{ crewId: string; memberId: string }>();
  const p = useAuthedQuery(api.stats.profile, { crewId: crewId as Id<"crews">, memberId: memberId as Id<"crewMembers"> });
  const property = useAuthedQuery(api.monoStats.profile, MONOPOLY_ENABLED ? { crewId: crewId as Id<"crews">, memberId: memberId as Id<"crewMembers"> } : "skip");
  const maxAbs = Math.max(1, ...(p?.recent.map((r) => Math.abs(r.net)) ?? [1]));

  return (
    <main className="room mx-auto w-full max-w-[520px] pb-10 text-ink">
      <div className="flex items-center gap-2.5 px-4" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <div className="flex items-center gap-2.5 pt-3">
          <BackButton href={`/crew/${crewId}`} />
          <div className="text-[13px] font-bold tracking-[.1em] text-ink3">PLAYER</div>
        </div>
      </div>
      {p === undefined ? (
        <div className="skeleton mx-4 mt-6 h-72 rounded-[22px] bg-surface2" aria-busy="true" />
      ) : p === null ? (
        <div className="px-5 pt-10 text-ink2">That player isn’t in this crew.</div>
      ) : (
        <>
          <div className="flex flex-col items-center pt-3.5">
            <Avatar name={p.member.name} size={96} ring="#f1d590" />
            <div className="font-display mt-3 text-[32px] font-semibold">{p.member.name}</div>
            <div className="text-[13px] font-semibold text-ink3">
              {p.rank ? `#${p.rank} in ${p.crewName}` : p.crewName}
              {p.firstEndedAt ? ` · since ${new Date(p.firstEndedAt).toLocaleDateString("en-IN", { month: "long" })}` : ""}
            </div>
          </div>
          <div className="mx-4 mt-[18px] grid grid-cols-2 gap-2">
            {[
              { k: "SESSIONS", v: String(p.sessions), c: "var(--ink)" },
              { k: "TOTAL NET", v: formatNet(p.totalNet), c: netColor(p.totalNet) },
              { k: "GAMES WON", v: String(p.gamesWon), c: "var(--ink)" },
              { k: "BIGGEST WIN", v: formatInr(p.biggestPayout), c: "var(--gold-ink)" },
              { k: "BEST SESSION", v: p.best === null ? "—" : formatNet(p.best), c: p.best === null ? "var(--ink)" : netColor(p.best) },
              { k: "WORST SESSION", v: p.worst === null ? "—" : formatNet(p.worst), c: p.worst === null ? "var(--ink)" : netColor(p.worst) },
            ].map((s) => (
              <div key={s.k} className="rounded-[18px] border border-line bg-surface p-3.5">
                <div className="text-[10.5px] font-extrabold tracking-[.12em] text-ink3">{s.k}</div>
                <div className="amount mt-0.5 text-[28px]" style={{ color: s.c }}>
                  {s.v}
                </div>
              </div>
            ))}
          </div>
          {p.recent.length > 0 && (
            <>
              <div className="mx-4 mt-3 rounded-[18px] border border-line bg-surface px-4 py-3.5">
                <div className="flex justify-between">
                  <div className="text-[13px] font-extrabold">Net by session</div>
                  <div className="text-xs font-semibold text-ink3">Last {p.recent.length}</div>
                </div>
                <div className="relative mt-2.5 flex h-24 items-center gap-[5px]" role="img" aria-label="Net result of each recent session">
                  <div className="absolute inset-x-0 top-12 border-t border-dashed border-line" />
                  {p.recent.map((r, i) => {
                    const h = Math.max(2, Math.round((Math.abs(r.net) / maxAbs) * 44));
                    return (
                      <div key={i} className="relative h-24 flex-1">
                        <div className="absolute inset-x-0 rounded-[3px]" style={{ top: r.net >= 0 ? 48 - h : 48, height: h, background: r.net >= 0 ? "var(--up)" : "var(--down)" }} />
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mx-4 mt-3 rounded-[18px] border border-line bg-surface px-4 py-1">
                {[...p.recent].reverse().slice(0, 5).map((r, i) => (
                  <div key={i} className="flex h-12 items-center justify-between border-b border-line last:border-b-0">
                    <span className="truncate text-[13.5px] font-semibold text-ink2">
                      {r.name} · {formatDay(r.endedAt)}
                    </span>
                    <span className="amount text-[17px]" style={{ color: netColor(r.net) }}>
                      {formatNet(r.net)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          {property && property.games > 0 && (
            <>
              <div className="px-5 pt-6 text-[15px] font-extrabold">Property games</div>
              <div className="mx-4 mt-2.5 grid grid-cols-2 gap-2">
                {[
                  { k: "GAMES", v: String(property.games) },
                  { k: "WINS", v: String(property.wins) },
                  { k: "AVERAGE PLACE", v: property.avgFinish === null ? "—" : String(property.avgFinish) },
                  { k: "RENT EARNED", v: property.rentEarned.toLocaleString("en-IN") },
                ].map((x) => (
                  <div key={x.k} className="rounded-[18px] border border-line bg-surface p-3.5">
                    <div className="text-[10.5px] font-extrabold tracking-[.12em] text-ink3">{x.k}</div>
                    <div className="amount mt-0.5 text-[28px]">{x.v}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
