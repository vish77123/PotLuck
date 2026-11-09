"use client";

import { useConvexAuth } from "convex/react";
import Link from "next/link";
import { JoinBox } from "@/components/home/JoinBox";
import { Money } from "@/components/money/Money";
import { Avatar } from "@/components/ui/Avatar";
import { SectionTitle } from "@/components/ui/controls";
import { api } from "@/convex/_generated/api";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { formatDay, formatNet, netColor } from "@/lib/format";
import { useUi } from "@/stores/ui";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Skeleton() {
  return (
    <div className="skeleton flex flex-col gap-3 px-5 pt-[22px]" aria-busy="true">
      <div className="h-3.5 w-[110px] rounded-[7px] bg-surface3" />
      <div className="flex gap-3">
        <div className="h-[118px] w-[230px] flex-none rounded-[20px] bg-surface2" />
        <div className="h-[118px] flex-1 rounded-[20px] bg-surface2" />
      </div>
      <div className="mt-2 h-3.5 w-[140px] rounded-[7px] bg-surface3" />
      <div className="h-16 rounded-2xl bg-surface2" />
      <div className="h-16 rounded-2xl bg-surface2 opacity-60" />
      <div className="text-center text-xs font-semibold text-ink3">Loading your crews…</div>
    </div>
  );
}

export function HomeScreen() {
  const { isAuthenticated } = useConvexAuth();
  const crews = useAuthedQuery(api.crews.mine, {});
  const sessions = useAuthedQuery(api.sessions.mine, {});
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const loading = !isAuthenticated || crews === undefined || sessions === undefined;
  const empty = !loading && crews.length === 0 && sessions.length === 0;

  return (
    <main className="room mx-auto w-full max-w-[520px] pb-10 text-ink" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
      <header className="flex items-center justify-between px-5 pt-4">
        <div className="font-display text-[32px] font-bold leading-none tracking-[-.01em]">
          Pot<span className="italic text-gold-ink">Luck</span>
        </div>
        <button
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
          className="press grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-ink2"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
          </svg>
        </button>
      </header>
      <div className="px-5 pt-1 text-sm font-medium text-ink2">{greeting()}</div>

      <div className="rail relative mx-4 mt-[18px] rounded-[30px] p-2">
        <div className="felt relative overflow-hidden rounded-3xl px-[18px] pb-[18px] pt-5">
          <div className="pointer-events-none absolute -right-[22px] top-3 flex flex-col" aria-hidden>
            <div style={{ transform: "translate(10px,0)" }}>
              <Money v={500} w={104} rot={-14} />
            </div>
            <div style={{ transform: "translate(-4px,-22px)" }}>
              <Money v={200} w={104} rot={8} />
            </div>
          </div>
          <div className="text-[10.5px] font-extrabold tracking-[.2em] text-on-felt2">TONIGHT’S TABLE</div>
          <div className="font-display mt-1.5 max-w-[220px] text-[27px] font-semibold leading-[1.12] text-balance">
            You deal the cards. We hold the cash.
          </div>
          <Link href="/new" className="gold-btn mt-[18px] flex h-[58px] items-center justify-center gap-2 rounded-[18px] text-[16.5px]">
            <span className="text-[22px] leading-none">+</span>Create session
          </Link>
        </div>
      </div>

      <JoinBox />

      {loading && <Skeleton />}

      {empty && (
        <>
          <SectionTitle>My crews</SectionTitle>
          <div className="mx-4 mt-2.5 flex items-center gap-3.5 rounded-[20px] border-[1.5px] border-dashed border-line-gold p-[18px]">
            <div className="flex flex-none" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[38px] w-[38px] rounded-full border-[1.5px] border-dashed border-ink3" style={{ marginLeft: i ? -12 : 0 }} />
              ))}
            </div>
            <div className="text-[13.5px] leading-[1.45] text-ink2">
              <b className="text-ink">No crew yet.</b> Host your first table and everyone who joins becomes your crew.
            </div>
          </div>
          <SectionTitle>Recent sessions</SectionTitle>
          <div className="mx-4 mt-2.5 rounded-[20px] border border-line bg-surface px-[18px] py-[22px] text-center">
            <div className="flex justify-center opacity-55" aria-hidden>
              <Money v={100} w={70} rot={-8} />
              <div style={{ marginLeft: -30, marginTop: 8 }}>
                <Money v={10} w={70} rot={6} />
              </div>
            </div>
            <div className="mt-3 text-sm font-bold">No sessions yet</div>
            <div className="mt-[3px] text-[12.5px] text-ink3">Your results and settle-ups will live here.</div>
          </div>
        </>
      )}

      {!loading && !empty && (
        <>
          {crews.length > 0 && (
            <>
              <SectionTitle>My crews</SectionTitle>
              <div className="no-scrollbar mt-2.5 flex gap-3 overflow-x-auto px-4">
                {crews.map((c) => (
                  <div key={c._id} className="box-border w-[226px] flex-none rounded-[20px] border border-line bg-surface px-4 py-3.5">
                    <div className="font-display text-[19px] font-semibold">{c.name}</div>
                    <div className="mt-2.5 flex pl-2">
                      {c.memberNames.slice(0, 5).map((n) => (
                        <div key={n} style={{ marginLeft: -8 }} className="rounded-full border-2 border-surface">
                          <Avatar name={n} size={26} />
                        </div>
                      ))}
                    </div>
                    <div className="mt-2.5 text-xs font-semibold text-ink3">
                      {c.memberCount} {c.memberCount === 1 ? "player" : "players"} · {c.sessionCount} {c.sessionCount === 1 ? "session" : "sessions"}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {sessions.length > 0 && (
            <>
              <SectionTitle>Recent sessions</SectionTitle>
              <div className="mx-4 mt-2 overflow-hidden rounded-[20px] border border-line bg-surface">
                {sessions.map((s) => (
                  <Link
                    key={s.sessionId}
                    href={s.status === "ended" ? `/s/${s.code}/report` : `/s/${s.code}`}
                    className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14.5px] font-bold">{s.name ?? s.crewName}</div>
                      <div className="mt-0.5 text-xs font-semibold text-ink3">
                        {formatDay(s.createdAt)} · {s.status === "ended" ? "ended" : s.status === "active" ? "in play" : "lobby"} · {s.code}
                      </div>
                    </div>
                    {s.myNet !== null ? (
                      <div className="text-right">
                        <div className="amount text-lg" style={{ color: netColor(s.myNet) }}>
                          {formatNet(s.myNet)}
                        </div>
                        <div className="text-[11px] font-semibold text-ink3">your net</div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-line-gold px-2.5 py-1 text-[11px] font-extrabold tracking-[.1em] text-gold-ink">
                        {s.status === "active" ? "LIVE" : "OPEN"}
                      </div>
                    )}
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
