"use client";

import { useConvex } from "convex/react";
import { useState } from "react";
import type { SessionState } from "@/components/lobby/types";
import { Avatar } from "@/components/ui/Avatar";
import { Dialog } from "@/components/ui/Dialog";
import { GoldButton, SecondaryButton } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/Sheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useSubmit } from "@/hooks/useSubmit";
import { useUndo } from "@/hooks/useUndo";
import { newKey } from "@/lib/errors";
import { clock } from "@/lib/feed";
import { formatInr } from "@/lib/format";
import { TEAMS, teamOf } from "@/lib/seats";
import { useUi } from "@/stores/ui";

type Game = NonNullable<SessionState["latestGame"]>;
type View = "main" | "undo" | "teams" | "transfer";

const TYPE_LABEL: Record<string, string> = { BET: "Bet", BOOT: "Boot", TOP_UP: "Top-up", LOAN: "Loan", LOAN_REPAYMENT: "Repayment", PAYOUT: "Payout" };

function Tile({ icon, label, hint, onClick }: { icon: string; label: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="press flex min-h-[74px] flex-col justify-center rounded-2xl border border-line bg-surface2 px-3 py-2 text-left">
      <div className="text-lg text-gold-ink">{icon}</div>
      <div className="mt-1 text-[13px] font-extrabold">{label}</div>
      <div className="text-[11px] font-semibold text-ink3">{hint}</div>
    </button>
  );
}

function Back({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <button onClick={onClick} aria-label="Back to host controls" className="press grid h-11 w-11 place-items-center rounded-full border border-line bg-surface2">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <div className="font-display text-[26px] font-semibold">{title}</div>
    </div>
  );
}

/** Host-only sheet over the table: end game, whose turn, undo, teams, transfer host, and per-player controls. */
export function HostPanel({
  open,
  onClose,
  state,
  game,
  onEndGame,
}: {
  open: boolean;
  onClose: () => void;
  state: SessionState;
  game: Game;
  onEndGame: () => void;
}) {
  const convex = useConvex();
  const pushToast = useUi((s) => s.pushToast);
  const { pending, run } = useSubmit();
  const { undo, pending: undoing } = useUndo();
  const [view, setView] = useState<View>("main");
  const [confirm, setConfirm] = useState<null | { kind: "cancel" } | { kind: "cashout"; id: Id<"sessionPlayers"> } | { kind: "transfer"; id: Id<"sessionPlayers"> }>(null);

  const { players, session, meId, recentEntries } = state;
  const template = game.templateSnapshot;
  const turnBased = template.turnMode === "turn_based";
  const teamGame = template.teamMode === "team";
  const nameOf = (id?: string) => players.find((p) => p._id === id)?.name ?? "Someone";
  const undoLog = useAuthedQuery(api.report.undoLog, open && view === "undo" ? { sessionId: session._id } : "skip");
  const undoCount = recentEntries.filter((e) => e.type === "REVERSAL").length;

  const close = () => {
    setView("main");
    onClose();
  };

  const reversed = new Set(recentEntries.filter((e) => e.type === "REVERSAL").map((e) => e.reversesEntryId as string));
  const undoable = recentEntries.filter((e) => ["BET", "BOOT", "TOP_UP", "LOAN", "LOAN_REPAYMENT"].includes(e.type) && !reversed.has(e._id) && (!e.gameId || e.gameId === game._id)).slice(0, 12);

  const participants = [...game.participants].sort((a, b) => a.seatOrder - b.seatOrder);
  const others = players.filter((p) => p.status === "active" && p._id !== meId);
  const usedTeams = new Set(participants.map((p) => p.teamNo ?? 1)).size;

  const setTurn = (id: Id<"sessionPlayers">) => run(() => convex.mutation(api.games.setTurn, { gameId: game._id, playerId: id }));
  const packFor = (id: Id<"sessionPlayers">) => run(() => convex.mutation(api.games.pack, { gameId: game._id, playerId: id }));
  const unpack = (id: Id<"sessionPlayers">) => run(() => convex.mutation(api.games.unpack, { gameId: game._id, playerId: id }));
  const cycleTeam = (id: Id<"sessionPlayers">, current: number) =>
    run(() => convex.mutation(api.games.setTeam, { gameId: game._id, playerId: id, teamNo: (current % 4) + 1 }));

  const doConfirm = () =>
    run(async () => {
      if (!confirm) return;
      if (confirm.kind === "cancel") {
        await convex.mutation(api.games.cancel, { gameId: game._id, idempotencyKey: newKey() });
        close();
      } else if (confirm.kind === "cashout") {
        const r = await convex.mutation(api.wallet.cashOut, { sessionId: session._id, playerId: confirm.id, idempotencyKey: newKey() });
        pushToast({ text: `${nameOf(confirm.id)} cashed out ${formatInr(r.amount)}.` });
      } else {
        await convex.mutation(api.host.transfer, { sessionId: session._id, toPlayerId: confirm.id });
        pushToast({ text: `${nameOf(confirm.id)} is the host now.` });
        close();
      }
      setConfirm(null);
    });

  const title = view === "main" ? undefined : undefined;

  return (
    <>
      <Sheet open={open} onClose={close} title={title}>
        {view === "main" && (
          <>
            <div className="flex items-baseline justify-between px-1">
              <div className="font-display text-[26px] font-semibold">
                <span className="text-gold-ink">♛</span> Host controls
              </div>
              <div className="amount text-xs !font-bold text-ink3">Pool {formatInr(game.poolAmount)}</div>
            </div>
            <div className="mt-3.5">
              <GoldButton
                onClick={() => {
                  close();
                  onEndGame();
                }}
                className="!h-[58px] !text-base"
              >
                End game &amp; pick winner
              </GoldButton>
            </div>

            {turnBased && (
              <>
                <div className="mt-[18px] px-1 text-[11px] font-extrabold tracking-[.14em] text-ink3">WHOSE TURN</div>
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {participants.map((p) => {
                    const on = game.currentTurnPlayerId === p.sessionPlayerId;
                    const name = nameOf(p.sessionPlayerId);
                    return (
                      <button
                        key={p._id}
                        disabled={pending || p.status !== "playing"}
                        onClick={() => !on && setTurn(p.sessionPlayerId)}
                        aria-label={`Give the turn to ${name}`}
                        aria-pressed={on}
                        className="press flex min-w-[52px] flex-1 flex-col items-center gap-1"
                        style={{ opacity: p.status === "packed" ? 0.4 : 1 }}
                      >
                        <Avatar name={name} size={46} ring={on ? "#f1d590" : undefined} />
                        <span className="max-w-[58px] truncate text-[11.5px] font-bold">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div className="mt-4 grid grid-cols-3 gap-2">
              {teamGame ? <Tile icon="⇄" label="Edit teams" hint={`${usedTeams} teams`} onClick={() => setView("teams")} /> : <Tile icon="✕" label="Cancel" hint="Refund all" onClick={() => setConfirm({ kind: "cancel" })} />}
              <Tile icon="↺" label="Undo" hint={undoCount ? `${undoCount} undone` : "Fix a bet"} onClick={() => setView("undo")} />
              <Tile icon="♛" label="Transfer host" hint="Hand it over" onClick={() => setView("transfer")} />
            </div>

            <div className="mt-[18px] px-1 text-[11px] font-extrabold tracking-[.14em] text-ink3">PLAYERS</div>
            <div className="mt-1.5">
              {others.map((p) => {
                const part = participants.find((x) => x.sessionPlayerId === p._id);
                const packed = part?.status === "packed";
                return (
                  <div key={p._id} className="flex min-h-[56px] items-center gap-2.5 border-b border-line py-1.5">
                    <Avatar name={p.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14.5px] font-bold">{p.name}</div>
                      <div className="amount text-xs !font-medium text-ink3">
                        {formatInr(p.balance)}
                        {packed ? " · packed" : part ? "" : " · not in this game"}
                      </div>
                    </div>
                    <button
                      onClick={() => setConfirm({ kind: "cashout", id: p._id })}
                      className="press h-11 rounded-[10px] border border-line px-3 text-[12.5px] font-bold"
                    >
                      Cash out
                    </button>
                    {part && (
                      <button
                        disabled={pending}
                        onClick={() => (packed ? unpack(p._id) : packFor(p._id))}
                        className="press h-11 rounded-[10px] border px-3 text-[12.5px] font-bold"
                        style={{ borderColor: packed ? "var(--line)" : "var(--down)", color: packed ? "var(--ink)" : "var(--down)" }}
                      >
                        {packed ? "Unpack" : "Pack"}
                      </button>
                    )}
                  </div>
                );
              })}
              {others.length === 0 && <div className="py-4 text-center text-sm text-ink3">Nobody else is at the table.</div>}
            </div>
            {teamGame && (
              <div className="mt-4 text-center">
                <button onClick={() => setConfirm({ kind: "cancel" })} className="h-11 px-4 text-[13.5px] font-bold text-down">
                  Cancel this game
                </button>
              </div>
            )}
          </>
        )}

        {view === "undo" && (
          <>
            <Back onClick={() => setView("main")} title="Undo" />
            <div className="mt-1 px-1 text-[13px] text-ink3">Tap Undo to put a bet or boot back. Everyone sees it.</div>
            <div className="mt-3 px-1 text-[11px] font-extrabold tracking-[.14em] text-ink3">RECENT</div>
            <div className="mt-1.5">
              {undoable.length === 0 && <div className="py-4 text-center text-sm text-ink3">Nothing to undo right now.</div>}
              {undoable.map((e) => {
                const who = nameOf(e.type === "TOP_UP" ? e.toPlayerId : e.fromPlayerId);
                return (
                  <div key={e._id} className="flex min-h-[56px] items-center gap-2.5 border-b border-line py-1.5">
                    <Avatar name={who} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14.5px] font-bold">{who}</div>
                      <div className="text-xs text-ink3">
                        {TYPE_LABEL[e.type] ?? e.type} · {clock(e.createdAt)}
                      </div>
                    </div>
                    <div className="amount text-lg">{formatInr(e.amount)}</div>
                    <button
                      disabled={undoing}
                      onClick={() => undo(e._id, `${formatInr(e.amount)} from ${who}`)}
                      className="press h-11 rounded-[10px] border border-down px-3 text-[12.5px] font-bold text-down"
                    >
                      ↺ Undo
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 px-1 text-[11px] font-extrabold tracking-[.14em] text-ink3">UNDO LOG</div>
            <div className="mt-1.5">
              {undoLog === undefined && <div className="skeleton h-14 rounded-xl bg-surface2" />}
              {undoLog?.length === 0 && <div className="py-3 text-center text-sm text-ink3">No undos yet.</div>}
              {undoLog?.map((r) => (
                <div key={r.reversalId} className="flex gap-2 border-b border-line py-2 text-[13px]">
                  <span className="text-warn">↺</span>
                  <span className="min-w-0 flex-1">
                    <b>{TYPE_LABEL[r.type ?? ""] ?? r.type}</b> {formatInr(r.amount)} · {r.playerName}
                    <span className="block text-xs text-ink3">
                      {r.reason === "game_cancelled" ? "Game cancelled" : r.reason === "game_reopened" ? "Game reopened" : `Undone by ${r.byName}`} · {clock(r.at)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {view === "teams" && (
          <>
            <Back onClick={() => setView("main")} title="Edit teams" />
            <div className="mt-1 px-1 text-[13px] text-ink3">Tap a player to cycle their team (up to 4). Teams only matter at the end of the game.</div>
            <div className="mt-3 grid gap-2">
              {participants.map((p) => {
                const t = teamOf(p.teamNo) ?? TEAMS[0];
                const name = nameOf(p.sessionPlayerId);
                return (
                  <div key={p._id} className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-line bg-surface2 px-3 py-2">
                    <Avatar name={name} size={40} />
                    <div className="min-w-0 flex-1 truncate text-[15px] font-bold">{name}</div>
                    <button
                      disabled={pending}
                      onClick={() => cycleTeam(p.sessionPlayerId, p.teamNo ?? 1)}
                      className="press flex h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-bold"
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                      Team {t.name}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {view === "transfer" && (
          <>
            <Back onClick={() => setView("main")} title="Transfer host" />
            <div className="mt-1 px-1 text-[13px] text-ink3">They take over ending games, undo and player controls. You stay a normal player.</div>
            <div className="mt-3 grid gap-2">
              {others.map((p) => (
                <button key={p._id} onClick={() => setConfirm({ kind: "transfer", id: p._id })} className="press flex min-h-[60px] items-center gap-3 rounded-2xl border border-line bg-surface2 px-3 py-2 text-left">
                  <Avatar name={p.name} size={40} />
                  <div className="min-w-0 flex-1 truncate text-[15px] font-bold">{p.name}</div>
                  <span className="text-[13px] font-bold text-gold-ink">Make host</span>
                </button>
              ))}
              {others.length === 0 && <SecondaryButton disabled>Nobody else to hand it to</SecondaryButton>}
            </div>
          </>
        )}
      </Sheet>

      <Dialog
        open={confirm?.kind === "cancel"}
        eyebrow="CANCEL GAME"
        eyebrowColor="var(--down)"
        title={`Cancel Round ${game.gameNo}?`}
        body="Every boot and bet is refunded and the game is over. This is logged in the undo log."
        noLabel="Keep playing"
        yesLabel="Cancel game"
        onNo={() => setConfirm(null)}
        onYes={doConfirm}
        pending={pending}
      />
      <Dialog
        open={confirm?.kind === "cashout"}
        eyebrow="CASH OUT"
        title={confirm?.kind === "cashout" ? `Cash out ${nameOf(confirm.id)}?` : ""}
        body={confirm?.kind === "cashout" ? `${formatInr(players.find((p) => p._id === confirm.id)?.balance ?? 0)} leaves their wallet and they sit out. They stay in the report and can rejoin with a new buy-in. Not allowed while they're still in a hand.` : ""}
        noLabel="Not now"
        yesLabel="Cash out"
        onNo={() => setConfirm(null)}
        onYes={doConfirm}
        pending={pending}
      />
      <Dialog
        open={confirm?.kind === "transfer"}
        eyebrow="TRANSFER HOST"
        title={confirm?.kind === "transfer" ? `Make ${nameOf(confirm.id)} the host?` : ""}
        body="You'll lose the host controls straight away."
        noLabel="Not now"
        yesLabel="Hand over"
        onNo={() => setConfirm(null)}
        onYes={doConfirm}
        pending={pending}
      />
    </>
  );
}
