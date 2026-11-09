"use client";

import { useConvex } from "convex/react";
import { useState } from "react";
import { Money } from "@/components/money/Money";
import type { SessionState } from "@/components/lobby/types";
import { Avatar } from "@/components/ui/Avatar";
import { GoldButton } from "@/components/ui/controls";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useSubmit } from "@/hooks/useSubmit";
import { newKey } from "@/lib/errors";
import { formatInr } from "@/lib/format";
import { TEAMS, teamOf } from "@/lib/seats";
import { pile } from "@/lib/wallet";

type Game = NonNullable<SessionState["latestGame"]>;

/** Full-screen winner picker. The preview is the payout: nothing moves until the gold button is pressed. */
export function EndGameScreen({ state, game, onClose }: { state: SessionState; game: Game; onClose: () => void }) {
  const convex = useConvex();
  const { pending, run } = useSubmit();
  const summary = useAuthedQuery(api.games.summary, { gameId: game._id });
  const template = game.templateSnapshot;
  const team = template.teamMode === "team";
  const nameOf = (id?: string) => state.players.find((p) => p._id === id)?.name ?? "Someone";
  const participants = [...game.participants].sort((a, b) => a.seatOrder - b.seatOrder);
  const pool = game.poolAmount;

  const playing = participants.filter((p) => p.status === "playing");
  const [winner, setWinner] = useState<Id<"sessionPlayers"> | null>(playing.length === 1 ? playing[0].sessionPlayerId : null);
  const [teamNo, setTeamNo] = useState<number | null>(null);

  const teamNos = [...new Set(participants.map((p) => p.teamNo ?? 1))].sort((a, b) => a - b);
  const members = (n: number) => participants.filter((p) => (p.teamNo ?? 1) === n);
  const winners = teamNo === null ? [] : members(teamNo);
  const base = winners.length ? Math.floor(pool / winners.length) : 0;
  const extra = winners.length ? pool % winners.length : 0;

  const cta = team
    ? teamNo === null
      ? "Pick the winning team"
      : `Pay Team ${teamOf(teamNo)?.name} ${formatInr(pool)}`
    : winner === null
      ? "Pick the winner"
      : `Pay ${formatInr(pool)} to ${nameOf(winner)}`;
  const ready = team ? teamNo !== null : winner !== null;

  const pay = () =>
    run(async () => {
      if (team && teamNo !== null) await convex.mutation(api.games.endTeam, { gameId: game._id, teamNo, idempotencyKey: newKey() });
      else if (winner) await convex.mutation(api.games.endSolo, { gameId: game._id, winnerPlayerId: winner, idempotencyKey: newKey() });
      onClose();
    });

  return (
    <div className="room fixed inset-0 z-40 overflow-y-auto text-ink">
      <div className="mx-auto w-full max-w-[520px] pb-44">
        <div className="flex items-center gap-2.5 px-4" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
          <button onClick={onClose} aria-label="Close" className="press mt-3 grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-xl">
            ×
          </button>
          <div className="font-display mt-3 flex-1 text-[22px] font-semibold">End {template.name}</div>
        </div>

        <div className="rail mx-4 mt-3.5 rounded-[26px] p-2">
          <div className="felt flex h-24 items-center justify-between rounded-[20px] px-[18px]" style={{ boxShadow: "inset 0 0 0 1.5px var(--rail-pin), inset 0 0 40px rgba(0,0,0,.45)" }}>
            <div>
              <div className="text-[10.5px] font-extrabold tracking-[.2em] text-on-felt2">POOL</div>
              <div className="amount text-[42px] leading-[1.05]">{formatInr(pool)}</div>
            </div>
            <div className="flex" aria-hidden>
              {pile(pool, state.session.theme, 2).map((v, i) => (
                <div key={i} style={{ marginLeft: i ? -50 : 0, marginTop: i ? 16 : 0 }}>
                  <Money kind={state.session.theme === "chips" ? "chip" : "note"} v={v} w={state.session.theme === "chips" ? 44 : 74} rot={i ? 6 : -12} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 pt-5 text-base font-extrabold">{team ? "Which team won?" : "Who won?"}</div>

        {!team && (
          <div className="mx-4 mt-2.5 flex flex-col gap-2">
            {participants.map((p) => {
              const packed = p.status === "packed";
              const on = winner === p.sessionPlayerId;
              const name = nameOf(p.sessionPlayerId);
              const put = summary?.putIn[p.sessionPlayerId];
              const detail = packed ? "Packed — can’t win" : `${template.blindSeenMultiplier ? (p.isSeen ? "Seen · " : "Blind · ") : ""}put in ${put === undefined ? "…" : formatInr(put)}`;
              return (
                <button
                  key={p._id}
                  disabled={packed}
                  onClick={() => setWinner(p.sessionPlayerId)}
                  aria-pressed={on}
                  className="press flex h-16 items-center gap-3 rounded-[18px] px-3.5 text-left"
                  style={{
                    opacity: packed ? 0.4 : 1,
                    background: on ? "var(--surface3)" : "var(--surface)",
                    border: on ? "2px solid var(--gold)" : "1px solid var(--line)",
                    boxShadow: on ? "var(--glow)" : undefined,
                  }}
                >
                  <Avatar name={name} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15.5px] font-bold">{name}</div>
                    <div className="text-xs font-semibold text-ink3">{detail}</div>
                  </div>
                  <span className="box-border h-6 w-6 flex-none rounded-full" style={{ border: on ? "8px solid var(--gold)" : "2px solid var(--ink3)" }} />
                </button>
              );
            })}
          </div>
        )}

        {team && (
          <>
            <div className="mx-4 mt-2.5 grid grid-cols-2 gap-2.5">
              {teamNos.map((n) => {
                const t = teamOf(n) ?? TEAMS[0];
                const on = teamNo === n;
                const ms = members(n);
                return (
                  <button
                    key={n}
                    onClick={() => setTeamNo(n)}
                    aria-pressed={on}
                    className="press rounded-[20px] p-3.5 text-left"
                    style={{ background: on ? "var(--surface3)" : "var(--surface)", border: on ? "2px solid var(--gold)" : "1px solid var(--line)", boxShadow: on ? "var(--glow)" : undefined }}
                  >
                    <div className="font-display flex items-center gap-2 text-[19px] font-semibold">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                      Team {t.name}
                    </div>
                    <div className="mt-2.5 flex pl-2">
                      {ms.slice(0, 4).map((m) => (
                        <div key={m._id} className="rounded-full border-2 border-surface" style={{ marginLeft: -8 }}>
                          <Avatar name={nameOf(m.sessionPlayerId)} size={30} />
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 text-xs font-semibold text-ink3">{ms.map((m) => nameOf(m.sessionPlayerId)).join(", ")}</div>
                  </button>
                );
              })}
            </div>
            {teamNo !== null && winners.length > 0 && (
              <div className="mx-4 mt-3 rounded-[20px] border border-line bg-surface px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-[13px] font-bold text-ink2">Equal split</div>
                  <div className="amount text-[13px] !font-extrabold">
                    {formatInr(pool)} ÷ {winners.length} = {formatInr(base)}
                    {extra > 0 ? ` r ${formatInr(extra)}` : ""}
                  </div>
                </div>
                {winners.map((m) => (
                  <div key={m._id} className="mt-2 flex h-[46px] items-center gap-2.5 border-t border-line">
                    <div className="flex-1 text-[14.5px] font-bold">{nameOf(m.sessionPlayerId)}</div>
                    <div className="amount text-xl text-up">{formatInr(base)}</div>
                  </div>
                ))}
                {extra > 0 && (
                  <div className="mt-1 rounded-[10px] bg-surface3 px-2.5 py-2 text-xs font-bold text-gold-ink">
                    🎲 {extra === 1 ? "The extra ₹1 goes" : `The extra ${formatInr(extra)} goes, ₹1 each,`} to {extra === 1 ? "one winner" : `${extra} winners`} picked at random — everyone sees who.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10" style={{ background: "linear-gradient(transparent, var(--bg) 30%)" }}>
        <div className="mx-auto max-w-[520px] px-4 pt-4" style={{ paddingBottom: "max(32px, env(safe-area-inset-bottom))" }}>
          <GoldButton pending={pending} disabled={!ready} onClick={pay}>
            {cta}
          </GoldButton>
          <div className="mt-2 text-center text-xs font-semibold text-ink3">Everyone sees the payout. Host can undo for 30s.</div>
        </div>
      </div>
    </div>
  );
}
