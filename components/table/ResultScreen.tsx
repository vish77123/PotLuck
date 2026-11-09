"use client";

import { useConvex } from "convex/react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Money } from "@/components/money/Money";
import type { SessionState } from "@/components/lobby/types";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/convex/_generated/api";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useCountUp } from "@/hooks/useCountUp";
import { useSubmit } from "@/hooks/useSubmit";
import { newKey } from "@/lib/errors";
import { clock } from "@/lib/feed";
import { formatInr } from "@/lib/format";
import { teamOf } from "@/lib/seats";
import { useUi } from "@/stores/ui";

type Game = NonNullable<SessionState["latestGame"]>;

// Notes thrown across the felt (x, y, value, rotation, width, opacity), from the design.
const BURST: [number, number, number, number, number, number][] = [
  [30, 90, 500, -30, 96, 0.9],
  [250, 70, 200, 24, 90, 0.85],
  [290, 250, 100, -12, 80, 0.7],
  [-10, 300, 50, 18, 84, 0.75],
  [60, 560, 20, -20, 74, 0.6],
  [260, 560, 500, 14, 92, 0.8],
  [150, 40, 100, 6, 70, 0.55],
  [310, 430, 10, -26, 70, 0.6],
];

/** The result of a game: who won what. Used by the full-screen celebration and the "while you were away" note. */
export function useResult(state: SessionState, game: Game) {
  const summary = useAuthedQuery(api.games.summary, { gameId: game._id });
  const nameOf = (id?: string) => state.players.find((p) => p._id === id)?.name ?? "Someone";
  const won = summary?.won ?? {};
  const total = Object.values(won).reduce((a, b) => a + b, 0);
  const winners = game.winnerPlayerIds ?? [];
  const team = game.winningTeamNo !== undefined ? teamOf(game.winningTeamNo) : null;
  const myShare = won[state.meId] ?? 0;
  const myPutIn = summary?.putIn[state.meId] ?? 0;
  const headline = team ? `Team ${team.name}` : nameOf(winners[0]);
  return { summary, nameOf, total, winners, team, myShare, myPutIn, headline, ready: summary !== undefined };
}

export function ResultScreen({ code, state, game }: { code: string; state: SessionState; game: Game }) {
  const convex = useConvex();
  const ack = useUi((s) => s.ackGame);
  const { pending, run } = useSubmit();
  const r = useResult(state, game);
  const now = Date.now();
  const [left, setLeft] = useState(Math.max(0, 30 - Math.floor((now - (game.endedAt ?? now)) / 1000)));
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  const iWon = r.winners.includes(state.meId);
  const shown = useCountUp(r.team ? (r.winners.length ? Math.floor(r.total / r.winners.length) : 0) : r.total, 800);
  const dismiss = () => ack(state.session._id, game._id);
  const reopen = () =>
    run(async () => {
      await convex.mutation(api.games.reopen, { gameId: game._id, idempotencyKey: newKey() });
      dismiss();
    });

  return (
    <main className="fixed inset-0 z-40 overflow-hidden text-on-felt" style={{ background: "var(--felt-bg)", boxShadow: "inset 0 0 160px rgba(0,0,0,.7)" }}>
      <div
        className="pointer-events-none absolute left-1/2 top-[38%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: "repeating-conic-gradient(rgba(241,213,144,.12) 0deg 6deg, transparent 6deg 18deg)",
          WebkitMask: "radial-gradient(circle, #000 20%, transparent 70%)",
          mask: "radial-gradient(circle, #000 20%, transparent 70%)",
          animation: "pl-spin 20s linear infinite",
        }}
        aria-hidden
      />
      <div className="absolute inset-0 mx-auto max-w-[520px]" aria-hidden>
        {BURST.map(([x, y, v, rot, w, o], i) => (
          <motion.div
            key={i}
            className="absolute"
            style={{ left: `calc(${x}px + (100% - 390px) / 2)`, top: y, opacity: o }}
            initial={{ opacity: 0, y: 40, scale: 0.7 }}
            animate={{ opacity: o, y: 0, scale: 1 }}
            transition={{ delay: 0.05 * i, type: "spring", damping: 18 }}
          >
            <Money kind={state.session.theme === "chips" ? "chip" : v < 10 ? "coin" : "note"} v={state.session.theme === "chips" ? ([1, 5, 10, 25, 100, 500][i % 6] as number) : v} w={state.session.theme === "chips" ? 56 : w} rot={rot} />
          </motion.div>
        ))}
      </div>

      <div className="absolute inset-x-0 top-[17%] flex flex-col items-center px-6 text-center">
        {r.team ? (
          <div className="flex pl-3">
            {r.winners.slice(0, 5).map((id) => (
              <div key={id} className="rounded-full" style={{ marginLeft: -12, boxShadow: `0 0 0 3px ${r.team!.color}` }}>
                <Avatar name={r.nameOf(id)} size={64} />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-full" style={{ boxShadow: "0 0 0 3px #f1d590, 0 0 50px 16px rgba(241,213,144,.5)" }}>
            <Avatar name={r.nameOf(r.winners[0])} size={96} />
          </div>
        )}
        <div className="mt-[22px] text-[11px] font-extrabold tracking-[.26em] text-[#f1d590]">{iWon ? "YOU WON" : r.team ? "WINNING TEAM" : "WINNER"}</div>
        <div className="font-display text-[44px] font-bold italic leading-[1.05]">{r.headline}</div>
        <div className="amount text-[64px] leading-[1.05] text-[#f1d590]" style={{ textShadow: "0 4px 24px rgba(0,0,0,.5)" }}>
          +{formatInr(shown)}
        </div>
        {r.team && <div className="text-sm font-bold text-on-felt2">each · {r.winners.map((id) => r.nameOf(id)).join(", ")}</div>}
        {r.team && (game.remainderPlayerIds?.length ?? 0) > 0 && (
          <div className="mt-2 rounded-[10px] px-2.5 py-1 text-xs font-bold text-[#f1d590]" style={{ background: "rgba(0,0,0,.3)" }}>
            🎲 +₹1 dice: {game.remainderPlayerIds!.map((id) => r.nameOf(id)).join(", ")}
          </div>
        )}
        <div className="mt-1.5 text-[13px] font-semibold text-on-felt2">
          {game.templateSnapshot.name} · Round {game.gameNo} · {r.summary?.betCount ?? "…"} {r.summary?.betCount === 1 ? "bet" : "bets"}
        </div>
        {!iWon && r.ready && r.myPutIn > 0 && <div className="mt-1 text-xs font-semibold text-on-felt2">You put in {formatInr(r.myPutIn)}</div>}
      </div>

      <div className="absolute inset-x-4 mx-auto max-w-[488px]" style={{ bottom: "max(34px, env(safe-area-inset-bottom))" }}>
        {state.isHost && left > 0 && (
          <button onClick={reopen} disabled={pending} className="press mx-auto mb-3 flex h-11 items-center gap-2 rounded-full px-4 text-[13px] font-bold text-[#f1d590]" style={{ background: "rgba(0,0,0,.35)" }}>
            ↺ Undo payout · {left}s
          </button>
        )}
        <div className="grid gap-2.5" style={{ gridTemplateColumns: "1fr 1.3fr" }}>
          <Link
            href={`/s/${code}/report`}
            onClick={dismiss}
            className="press grid h-14 place-items-center rounded-[18px] text-[15px] font-bold text-on-felt"
            style={{ background: "rgba(0,0,0,.35)", border: "1px solid rgba(246,238,219,.3)" }}
          >
            Report
          </Link>
          <button onClick={dismiss} className="gold-btn press h-14 rounded-[18px] text-[15.5px]">
            Next round
          </button>
        </div>
      </div>
    </main>
  );
}

/** Shown over the lobby when a game ended while this phone wasn't watching. */
export function awayText(state: SessionState, game: Game, r: ReturnType<typeof useResult>) {
  const me = state.players.find((p) => p._id === state.meId);
  return {
    title: `${r.headline} won ${formatInr(r.total)}`,
    body: `${game.templateSnapshot.name} · Round ${game.gameNo} ended at ${clock(game.endedAt ?? Date.now()).slice(0, 5)}. You put in ${formatInr(r.myPutIn)} this round${r.myShare > 0 ? ` and won ${formatInr(r.myShare)}` : ""}. Your wallet is now ${formatInr(me?.balance ?? 0)}.`,
  };
}
