"use client";

import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import type { api } from "@/convex/_generated/api";
import { clock } from "@/lib/feed";
import { formatDay, formatInr, formatNet, netColor } from "@/lib/format";
import { formatMoney, formatReal, ordinal } from "@/lib/monopoly/money";
import { TEAMS } from "@/lib/seats";

export type ReportData = FunctionReturnType<typeof api.report.full>;
type GameRow = ReportData["games"][number];
type MonoGameRow = NonNullable<ReportData["mono"]>["games"][number];

/** screen: interactive. print: PDF copy, everything expanded. image: compact, for sharing. */
export type ReportVariant = "screen" | "print" | "image";

const LOAN_LABEL: Record<string, string> = { open: "open", repaid: "repaid", settled_outside: "settled outside the app" };

function duration(ms: number) {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="px-5 pt-6 text-base font-extrabold">{children}</h2>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`avoid-break mx-4 mt-2.5 rounded-[20px] border border-line bg-surface ${className}`}>{children}</div>;
}

/** A property game: places, the real-money payout, and rent. */
function MonoGameBlock({ g }: { g: MonoGameRow }) {
  const fmt = (n: number) => formatMoney(n, g.currency as "$" | "₹");
  const verdict =
    g.status === "cancelled" ? "Cancelled · stakes refunded" : g.status === "ended" ? `${g.players[0]?.name ?? "—"} won` : "In play";
  return (
    <div className="avoid-break border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-sm font-extrabold">
            #{g.no} Property · {g.board}
          </div>
          <div className="text-xs font-semibold text-ink3">{verdict}</div>
        </div>
        <div className="amount text-[19px]">{g.buyIn > 0 && g.status !== "cancelled" ? formatReal(g.pot) : "—"}</div>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {g.players.map((l) => (
          <div key={l.name} className="flex justify-between gap-3 text-[13px]">
            <span className="font-semibold text-ink2">
              {l.position ? `${ordinal(l.position)} · ` : ""}
              {l.name}
              {l.rentEarned > 0 ? ` · rent ${fmt(l.rentEarned)}` : ""}
            </span>
            {g.buyIn > 0 && g.status === "ended" && (
              <span className="font-extrabold tabular-nums" style={{ color: netColor(l.stakeNet) }}>
                {formatNet(l.stakeNet)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GameBlock({ g, open, onToggle, variant }: { g: GameRow; open: boolean; onToggle: () => void; variant: ReportVariant }) {
  const [entries, setEntries] = useState(false);
  const showEntries = variant === "print" || entries;
  const team = g.teamNo ? TEAMS[(g.teamNo - 1) % TEAMS.length] : null;
  const verdict =
    g.status === "cancelled"
      ? "Cancelled · everyone refunded"
      : g.status === "active"
        ? "In play"
        : `${team ? `Team ${team.name}` : (g.winners[0] ?? "—")} won · ${g.betCount} ${g.betCount === 1 ? "bet" : "bets"}${g.endedAt ? ` · ${clock(g.endedAt).slice(0, 5)}` : ""}`;

  return (
    <div className="avoid-break border-b border-line last:border-b-0" style={{ background: open ? "var(--surface2)" : undefined }}>
      <button onClick={onToggle} disabled={variant !== "screen"} className="flex w-full items-center gap-2.5 px-4 py-3 text-left" aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold">
            #{g.no} {g.template}
          </div>
          <div className="text-xs font-semibold text-ink3">{verdict}</div>
        </div>
        <div className="amount text-[19px]">{g.status === "cancelled" ? "—" : formatInr(g.pot)}</div>
        {variant === "screen" && <div className="text-sm text-ink3">{open ? "▴" : "▾"}</div>}
      </button>
      {open && (
        <div className="px-4 pb-3">
          <div className="flex flex-col gap-1.5">
            {g.lines.map((l) => (
              <div key={l.name} className="flex justify-between gap-3 text-[13px]">
                <span className="font-semibold text-ink2">
                  {l.name} · {l.packed ? "packed" : l.bets > 0 ? `${l.bets} ${l.bets === 1 ? "bet" : "bets"}` : "boot only"}
                  {team === null && l.teamNo ? ` · ${TEAMS[(l.teamNo - 1) % TEAMS.length].name}` : ""}
                </span>
                <span className="font-extrabold tabular-nums" style={{ color: netColor(l.net) }}>
                  {g.status === "cancelled" ? "—" : formatNet(l.net)}
                </span>
              </div>
            ))}
          </div>
          {g.remainderTo.length > 0 && <div className="mt-2 text-xs font-bold text-gold-ink">🎲 +₹1 dice: {g.remainderTo.join(", ")}</div>}
          {variant !== "image" && g.entries.length > 0 && (
            <>
              {variant === "screen" && (
                <button onClick={() => setEntries((e) => !e)} className="mt-2 h-11 text-xs font-extrabold text-gold-ink">
                  {entries ? "Hide entries" : `Every entry (${g.entries.length})`}
                </button>
              )}
              {showEntries && (
                <div className="mt-1 border-t border-line pt-1.5">
                  {g.entries.map((e, i) => (
                    <div key={i} className="flex justify-between gap-2 py-0.5 text-xs" style={{ opacity: e.undone ? 0.5 : 1 }}>
                      <span className="text-ink2" style={{ textDecoration: e.undone ? "line-through" : undefined }}>
                        {clock(e.at)} · {e.who} · {e.type === "BOOT" ? "boot" : e.type === "BET" ? "bet" : e.type === "PAYOUT" ? "payout" : e.type.toLowerCase()}
                      </span>
                      <span className="font-bold tabular-nums" style={{ textDecoration: e.undone ? "line-through" : undefined }}>
                        {formatInr(e.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The session report: one tall column. The same component draws the screen, the PDF copy and the
 * share image, so they always say the same thing in the same order.
 */
export function ReportView({
  data,
  variant = "screen",
  sessionId,
  paid,
  onTogglePaid,
}: {
  data: ReportData;
  variant?: ReportVariant;
  sessionId: string;
  paid: Record<string, true>;
  onTogglePaid?: (key: string) => void;
}) {
  const { session, totals, players, transfers, games } = data;
  const [openGame, setOpenGame] = useState<string | null>(games[0]?.id ?? null);
  const maxAbs = Math.max(1, ...players.map((p) => Math.abs(p.net)));
  const start = session.startedAt ?? session.createdAt;
  const end = session.endedAt ?? Date.now();
  const live = session.status !== "ended";

  return (
    <div className="bg-bg text-ink" style={{ fontFamily: "var(--font-manrope), system-ui, sans-serif" }}>
      <div className="px-5 pt-5">
        <div className="text-[13px] font-bold tracking-[.1em] text-ink3">
          SESSION REPORT{live ? " · STILL RUNNING" : ""}
        </div>
        <h1 className="font-display mt-3.5 text-[32px] font-semibold leading-[1.1]">{session.name ?? session.crewName}</h1>
        <div className="mt-1 text-[13.5px] text-ink2">
          {session.name ? `${session.crewName} · ` : ""}
          {formatDay(start)} · {clock(start).slice(0, 5)}–{clock(end).slice(0, 5)} · {duration(end - start)}
        </div>
      </div>

      <div className="mx-4 mt-4 grid grid-cols-3 gap-2">
        {[
          { k: "GAMES", v: String(totals.games) },
          { k: "MOVED", v: formatInr(totals.moved) },
          { k: "BIGGEST POT", v: formatInr(totals.biggestPot) },
        ].map((t) => (
          <div key={t.k} className="avoid-break rounded-2xl border border-line bg-surface p-3">
            <div className="text-[10px] font-extrabold tracking-[.12em] text-ink3">{t.k}</div>
            <div className="amount mt-1 text-2xl">{t.v}</div>
          </div>
        ))}
      </div>

      <Heading>Net per player</Heading>
      <Card className="px-3.5 py-2">
        {players.map((p) => (
          <div key={p.id} className="grid h-[42px] items-center" style={{ gridTemplateColumns: "92px 1fr 1fr 72px" }}>
            <div className="truncate text-sm font-bold">{p.name}</div>
            <div className="flex h-[22px] items-center justify-end border-r border-line">
              <div className="h-4 rounded-l" style={{ background: "var(--down)", width: p.net < 0 ? Math.round((-p.net / maxAbs) * 84) : 0 }} />
            </div>
            <div className="flex h-[22px] items-center">
              <div className="h-4 rounded-r" style={{ background: "var(--up)", width: p.net > 0 ? Math.round((p.net / maxAbs) * 84) : 0 }} />
            </div>
            <div className="amount text-[17px] text-right" style={{ color: netColor(p.net) }}>
              {formatNet(p.net)}
            </div>
          </div>
        ))}
      </Card>
      {transfers === null && <div className="mx-5 mt-1.5 text-xs font-semibold text-ink3">Nets leave out money still sitting in the open pot.</div>}

      <div className="rail avoid-break mx-4 mt-4 rounded-[26px] p-2" style={{ boxShadow: "var(--sh1)" }}>
        <div className={`${variant === "screen" ? "felt" : "felt-flat"} rounded-[20px] px-4 pb-2.5 pt-4`} style={{ boxShadow: "inset 0 0 0 1.5px var(--rail-pin), inset 0 0 40px rgba(0,0,0,.4)" }}>
          <div className="flex items-baseline justify-between">
            <div className="font-display text-[22px] font-semibold">Settle up</div>
            <div className="text-[11.5px] font-bold text-on-felt2">{transfers ? `${transfers.length} ${transfers.length === 1 ? "transfer" : "transfers"}` : "waiting"}</div>
          </div>
          {transfers === null && <div className="mt-2 py-3 text-sm text-on-felt2">A game is still open, so nets don’t add up to zero yet. Settle-up appears when it finishes.</div>}
          {transfers?.length === 0 && <div className="mt-2 py-3 text-sm text-on-felt2">Everyone broke even. Nobody owes anything.</div>}
          {transfers?.map((t) => {
            const key = `${sessionId}:${t.from}>${t.to}`;
            const done = !!paid[key];
            return (
              <div key={key} className="mt-1.5 flex h-12 items-center gap-2 border-t" style={{ borderColor: "rgba(246,238,219,.15)", opacity: done ? 0.55 : 1 }}>
                <div className="flex-1 text-[14.5px] font-bold" style={{ textDecoration: done ? "line-through" : undefined }}>
                  <span>{t.from}</span>
                  <span className="font-semibold text-on-felt2"> pays </span>
                  <span>{t.to}</span>
                </div>
                <div className="amount text-xl text-[#f1d590]">{formatInr(t.amount)}</div>
                {variant === "screen" ? (
                  <button
                    onClick={() => onTogglePaid?.(key)}
                    role="checkbox"
                    aria-checked={done}
                    aria-label={`${t.from} paid ${t.to}`}
                    className="grid h-11 w-8 place-items-center"
                  >
                    <span className="grid h-[22px] w-[22px] place-items-center rounded-md text-xs font-black" style={{ border: "1.5px solid rgba(246,238,219,.5)", background: done ? "#f1d590" : "transparent", color: "#1d1608" }}>
                      {done ? "✓" : ""}
                    </span>
                  </button>
                ) : (
                  <span className="grid h-[22px] w-[22px] place-items-center rounded-md" style={{ border: "1.5px solid rgba(246,238,219,.5)" }}>
                    {done ? "✓" : ""}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {data.mono && (
        <>
          <Heading>Property games · {data.mono.games.filter((g) => g.status === "ended").length}</Heading>
          {data.mono.games.length === 0 ? (
            <Card className="px-4 py-5 text-center text-sm text-ink3">No games played yet.</Card>
          ) : (
            <Card className="overflow-hidden">
              {data.mono.games.map((g) => (
                <MonoGameBlock key={g.no} g={g} />
              ))}
            </Card>
          )}
        </>
      )}

      {!data.mono && <Heading>Games · {totals.games}</Heading>}
      {data.mono ? null : games.length === 0 ? (
        <Card className="px-4 py-5 text-center text-sm text-ink3">No games played yet.</Card>
      ) : (
        <Card className="overflow-hidden">
          {games.map((g) => (
            <GameBlock
              key={g.id}
              g={g}
              variant={variant}
              open={variant === "print" || openGame === g.id}
              onToggle={() => setOpenGame((cur) => (cur === g.id ? null : g.id))}
            />
          ))}
        </Card>
      )}

      <Heading>Top-ups &amp; loans</Heading>
      <Card className="px-4 py-1">
        {data.topUps.length + data.loans.length === 0 && <div className="py-4 text-center text-sm text-ink3">No top-ups or loans.</div>}
        {data.topUps.map((t, i) => (
          <div key={`t${i}`} className="flex h-11 items-center justify-between border-b border-line text-[13.5px] last:border-b-0" style={{ opacity: t.undone ? 0.5 : 1 }}>
            <span className="font-semibold text-ink2" style={{ textDecoration: t.undone ? "line-through" : undefined }}>
              {t.who} topped up · {clock(t.at).slice(0, 5)}
            </span>
            <span className="font-extrabold tabular-nums">{formatInr(t.amount)}</span>
          </div>
        ))}
        {data.loans.map((l, i) => (
          <div key={`l${i}`} className="flex h-11 items-center justify-between gap-2 border-b border-line text-[13.5px] last:border-b-0">
            <span className="min-w-0 flex-1 truncate font-semibold text-ink2">
              {l.borrower} borrowed from {l.lender} · {LOAN_LABEL[l.status] ?? l.status}
            </span>
            <span className="font-extrabold tabular-nums">{formatInr(l.amount)}</span>
          </div>
        ))}
      </Card>

      <Heading>Undo log</Heading>
      <Card className="px-4 py-1">
        {data.undos.length === 0 && <div className="py-4 text-center text-sm text-ink3">No undos.</div>}
        {data.undos.map((u, i) => (
          <div key={i} className="flex min-h-[46px] items-center gap-2 border-b border-line py-1 text-[13.5px] last:border-b-0">
            <span className="font-extrabold text-warn">↺</span>
            <span className="flex-1 font-semibold">
              {formatInr(u.amount)} {u.type === "BET" ? "bet" : u.type === "BOOT" ? "boot" : (u.type ?? "").toLowerCase()} from {u.who}
              {u.reason === "game_cancelled" ? " · game cancelled" : u.reason === "game_reopened" ? " · game reopened" : ` · by ${u.by}`}
            </span>
            <span className="text-xs tabular-nums text-ink3">{clock(u.at).slice(0, 5)}</span>
          </div>
        ))}
      </Card>

      {variant !== "screen" && <div className="px-5 pb-6 pt-5 text-center text-xs font-semibold text-ink3">PotLuck · code {session.code}</div>}
    </div>
  );
}
