"use client";

import { useConvex } from "convex/react";
import type { FunctionArgs } from "convex/server";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { GameOver } from "@/components/mono/MonoEnd";
import { MonoSeats } from "@/components/mono/MonoSeats";
import type { MonoGame, MonoState } from "@/components/mono/types";
import { RoomCard } from "@/components/lobby/RoomCard";
import { AmountStepper } from "@/components/ui/AmountStepper";
import { Avatar } from "@/components/ui/Avatar";
import { BackButton, GoldButton, Segmented, Toggle } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/Dialog";
import { api } from "@/convex/_generated/api";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useNow } from "@/hooks/useNow";
import { ONLINE_WINDOW_MS, usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
import { useSubmit } from "@/hooks/useSubmit";
import { errorMessage, newKey } from "@/lib/errors";
import { formatInr } from "@/lib/format";
import { formatMoney, formatReal } from "@/lib/monopoly/money";
import { unverifiedItems } from "@/lib/monopoly/presets";
import { useUi } from "@/stores/ui";

type Patch = Omit<FunctionArgs<typeof api.mono.updateSetup>, "gameId">;

const PRESET_CARDS = [
  { key: "classic", title: "Classic", sub: "$ play money" },
  { key: "business", title: "Business", sub: "₹ notes · Indian cities" },
] as const;

const SPLIT_PRESETS: { label: string; split: number[] }[] = [
  { label: "Winner takes all", split: [100] },
  { label: "70 / 30", split: [70, 30] },
  { label: "50 / 30 / 20", split: [50, 30, 20] },
];
const ordinal = (i: number) => ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"][i] ?? `${i + 1}th`;

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-4 mt-2.5 rounded-[20px] border border-line bg-surface p-4 ${className}`}>{children}</div>;
}
function Title({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between px-5 pt-[22px]">
      <h2 className="text-[15px] font-extrabold">{children}</h2>
      {right && <span className="text-xs font-bold text-ink3">{right}</span>}
    </div>
  );
}
function Rule({ title, desc, on, onChange, disabled }: { title: string; desc: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-b-0" style={{ opacity: disabled ? 0.45 : 1 }}>
      <div className="flex-1">
        <div className="text-sm font-extrabold">{title}</div>
        <div className="mt-px text-xs font-semibold leading-snug text-ink3">{desc}</div>
      </div>
      <Toggle on={on && !disabled} onChange={disabled ? () => {} : onChange} label={title} />
    </div>
  );
}

/** Editable payout percentages by finishing place; saved only when they total 100. */
function SplitEditor({ split, players, onSave }: { split: number[]; players: number; onSave: (s: number[]) => void }) {
  const [draft, setDraft] = useState(split);
  useEffect(() => setDraft(split), [split]);
  const total = draft.reduce((a, b) => a + b, 0);
  const dirty = draft.join() !== split.join();
  const set = (i: number, n: number) => setDraft(draft.map((v, j) => (j === i ? Math.max(0, Math.min(100, n)) : v)));
  return (
    <div className="mt-3 rounded-[14px] bg-black/25 p-3">
      {draft.map((pct, i) => (
        <div key={i} className="flex items-center gap-2 py-1">
          <div className="w-10 text-[13px] font-extrabold">{ordinal(i)}</div>
          <button aria-label={`Less for ${ordinal(i)}`} onClick={() => set(i, pct - 5)} className="press h-9 w-9 rounded-full border border-white/30 text-lg">
            −
          </button>
          <div className="w-14 text-center text-[17px] font-extrabold tabular-nums">{pct}%</div>
          <button aria-label={`More for ${ordinal(i)}`} onClick={() => set(i, pct + 5)} className="press h-9 w-9 rounded-full border border-white/30 text-lg">
            +
          </button>
          {i === draft.length - 1 && draft.length > 1 && (
            <button onClick={() => setDraft(draft.slice(0, -1))} className="press ml-auto h-9 rounded-lg px-2 text-xs font-bold text-on-felt2">
              Remove
            </button>
          )}
        </div>
      ))}
      <div className="mt-1 flex items-center gap-2">
        {draft.length < Math.min(players, 8) && (
          <button onClick={() => setDraft([...draft, 0])} className="press h-9 rounded-lg border border-white/30 px-3 text-xs font-bold">
            + Place
          </button>
        )}
        <div className={`ml-auto text-[12.5px] font-extrabold ${total === 100 ? "text-up" : "text-warn"}`}>Total {total}%</div>
        <button disabled={!dirty || total !== 100} onClick={() => onSave(draft)} className="gold-btn press h-9 rounded-lg px-3 text-xs disabled:opacity-40">
          Save
        </button>
      </div>
    </div>
  );
}

export function MonoLobby({ code, state, game }: { code: string; state: MonoState; game: MonoGame }) {
  const { session, crew, seats, isHost, meId } = state;
  const convex = useConvex();
  const router = useRouter();
  const pushToast = useUi((s) => s.pushToast);
  const presence = useAuthedQuery(api.presence.list, { sessionId: session._id });
  const now = useNow();
  usePresenceHeartbeat(session._id);
  const { pending, run } = useSubmit();
  const [seatsOpen, setSeatsOpen] = useState(false);
  const [endAsk, setEndAsk] = useState(false);

  const board = game.boardSnapshot;
  const s = game.settings;
  const seated = seats.filter((p) => p.status === "active");
  const seen = useMemo(() => new Map((presence ?? []).map((r) => [r.playerId as string, r.lastSeenAt])), [presence]);
  const host = seats.find((p) => p._id === session.hostPlayerId);
  const bankerSeat = seats.find((p) => p._id === game.bankerSessionPlayerId);
  const fmt = (n: number) => formatMoney(n, board.currency);
  const unverified = unverifiedItems(board);
  const inSetup = game.status === "setup";

  /** Each setting saves as it changes. Errors show as a toast; the screen re-renders from the server's copy. */
  const save = async (patch: Patch) => {
    try {
      await convex.mutation(api.mono.updateSetup, { gameId: game._id, ...patch });
    } catch (e) {
      pushToast({ text: errorMessage(e), tone: "error" });
    }
  };
  const pendingPhones = seats.filter((p) => p.rebindPending);

  const startGame = () =>
    run(async () => {
      await convex.mutation(api.mono.start, { gameId: game._id, idempotencyKey: newKey() });
    });

  const startBlock = !inSetup
    ? null
    : seated.length < 2
      ? "Waiting for at least one more player."
      : s.bankerMode === "bankerApproves" && !bankerSeat
        ? "Choose who the banker is."
        : s.stakes.split.length > seated.length
          ? `The payout pays ${s.stakes.split.length} places, but only ${seated.length} are playing.`
          : null;

  return (
    <main className="room relative mx-auto min-h-dvh w-full max-w-[520px] pb-44 text-ink">
      <div className="flex items-center gap-2.5 px-4" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <div className="flex w-full items-center gap-2.5 pt-3">
          <BackButton href="/" />
          <div className="font-display min-w-0 flex-1 truncate text-[22px] font-semibold">{session.name ?? crew.name}</div>
          {isHost && <div className="rounded-xl border border-line-gold px-2.5 py-1.5 text-[11.5px] font-extrabold tracking-[.1em] text-gold-ink">♛ HOST</div>}
        </div>
      </div>

      <RoomCard code={code} />

      {isHost && pendingPhones.length > 0 && (
        <button onClick={() => setSeatsOpen(true)} className="press mx-4 mt-3 flex w-[calc(100%-32px)] items-center gap-3 rounded-[18px] border border-line-gold bg-surface p-3.5 text-left">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-gold text-[15px] font-black text-on-gold">!</span>
          <span className="flex-1 text-[13.5px] font-semibold leading-snug">{pendingPhones.map((p) => p.name).join(", ")} want{pendingPhones.length > 1 ? "" : "s"} their seat on a new phone. Tap to review.</span>
        </button>
      )}

      <Title
        right={
          isHost && inSetup ? (
            <button onClick={() => setSeatsOpen(true)} className="h-11 text-[13px] font-bold text-gold-ink">
              Seats and turn order
            </button>
          ) : undefined
        }
      >
        At the table · {seated.length}
      </Title>
      <div className="mx-4 mt-2.5 grid grid-cols-4 gap-y-3.5 rounded-[20px] border border-line bg-surface px-2.5 py-3.5">
        {seats.map((p) => {
          const left = p.status === "left";
          const last = seen.get(p._id);
          const online = !left && (p._id === meId || (last !== undefined && now - last < ONLINE_WINDOW_MS));
          return (
            <div key={p._id} className="flex flex-col items-center gap-1.5" style={{ opacity: left ? 0.5 : 1 }}>
              <Avatar name={p.name} size={52} ring={p._id === meId ? "var(--gold)" : undefined} dashed={left} online={left ? undefined : online} badge={p.seatNo} />
              <div className="max-w-full truncate px-0.5 text-[12.5px] font-bold">{p.name}</div>
            </div>
          );
        })}
      </div>

      {game.status === "ended" && <GameOver code={code} state={state} game={game} />}

      {game.status === "cancelled" && (
        <Card>
          <div className="font-display text-[22px] font-semibold">{game.status === "cancelled" ? "Game cancelled" : "Game over"}</div>
          <div className="mt-1 text-sm text-ink2">{game.status === "cancelled" ? "Nothing was paid out and the buy-ins were refunded." : "The result is in the session report."}</div>
          {isHost && (
            <div className="mt-3">
              <GoldButton pending={pending} onClick={() => run(async () => void (await convex.mutation(api.mono.newGame, { sessionId: session._id })))}>
                Set up a new game
              </GoldButton>
            </div>
          )}
        </Card>
      )}

      {inSetup && isHost && (
        <>
          <Title
            right={
              <Link href={`/crew/${crew._id}/board?preset=${board.key}`} className="text-[13px] font-bold text-gold-ink">
                Edit board values
              </Link>
            }
          >
            Board
          </Title>
          <div className="mx-4 mt-2.5 grid grid-cols-2 gap-2.5">
            {PRESET_CARDS.map((c) => {
              const on = board.key === c.key;
              return (
                <button
                  key={c.key}
                  onClick={() => save({ presetKey: c.key })}
                  aria-pressed={on}
                  className="press rounded-[20px] bg-surface p-3.5 text-left"
                  style={{ border: `2px solid ${on ? "var(--gold)" : "var(--line)"}`, boxShadow: on ? "var(--glow)" : undefined }}
                >
                  <div className="text-[14.5px] font-extrabold">{c.title}</div>
                  <div className="text-[11.5px] font-semibold text-ink3">{c.sub}</div>
                </button>
              );
            })}
          </div>
          {unverified.length > 0 && (
            <Card className="!border-line-gold">
              <div className="text-[13px] font-extrabold text-warn">Placeholder values</div>
              <div className="mt-1 text-[12.5px] font-semibold leading-snug text-ink2">
                This board's prices, rents and rules haven't been checked against a physical board yet ({unverified.length} items). They copy the Classic numbers.
              </div>
            </Card>
          )}

          <Card className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-sm font-extrabold">Track properties</div>
              <div className="mt-0.5 text-xs font-semibold leading-snug text-ink2">Deeds, rent, buildings and mortgages are tracked for you. Off = money only.</div>
            </div>
            <Toggle on={s.trackProperties} onChange={(v) => save({ trackProperties: v })} label="Track properties" />
          </Card>

          <Title>Starting cash</Title>
          <Card>
            <div className="flex justify-center">
              <AmountStepper label="Starting cash" value={board.startingCash} onChange={(n) => save({ startingCash: n })} step={100} min={100} size="lg" format={fmt} />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              {[1000, 1500, 2000, 2500].map((n) => (
                <button
                  key={n}
                  onClick={() => save({ startingCash: n })}
                  className="press h-9 rounded-[10px] border text-[13px] font-bold"
                  style={{ borderColor: board.startingCash === n ? "var(--gold)" : "var(--line)", background: board.startingCash === n ? "var(--surface3)" : "transparent" }}
                >
                  {fmt(n)}
                </button>
              ))}
            </div>
          </Card>

          <Title>Banker</Title>
          <Card>
            <Segmented
              value={s.bankerMode}
              onChange={(v) => save({ bankerMode: v })}
              options={[
                { value: "selfService", label: "Self-service" },
                { value: "bankerApproves", label: "Banker approves" },
              ]}
              height={42}
            />
            <div className="mt-2.5 text-[12.5px] font-semibold leading-snug text-ink2">
              {s.bankerMode === "selfService"
                ? "Anyone can move their own money with the bank. Instant."
                : "Every bank payment waits for the banker's tap. Player-to-player stays instant. The banker still plays; their own bank moves go to the host."}
            </div>
            {s.bankerMode === "bankerApproves" && (
              <>
                <Title>Who's the banker</Title>
                <div className="mt-2 flex flex-wrap gap-3 px-1">
                  {seated.map((p) => (
                    <button key={p._id} onClick={() => save({ bankerSessionPlayerId: p._id })} aria-pressed={bankerSeat?._id === p._id} className="press flex w-[60px] flex-col items-center gap-1">
                      <Avatar name={p.name} size={48} ring={bankerSeat?._id === p._id ? "var(--gold)" : undefined} />
                      <span className="max-w-full truncate text-xs font-bold">{p.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </Card>

          <Title>House rules</Title>
          <div className="mx-4 mt-2.5 overflow-hidden rounded-[20px] border border-line bg-surface">
            <Rule title="Free Parking pot" desc="Fines, taxes and card payments collect in a pot; landing there takes it." on={s.freeParkingPot} onChange={(v) => save({ freeParkingPot: v })} />
            <Rule title="Double on GO" desc={`Land exactly on GO to collect ${fmt(board.passGo * 2)}.`} on={s.doubleOnGo} onChange={(v) => save({ doubleOnGo: v })} />
            <Rule title="Auctions" desc="Unbought properties go to a live auction." on={s.auctions} onChange={(v) => save({ auctions: v })} disabled={!s.trackProperties} />
            <Rule title="Even building" desc="Build and sell evenly across a colour set." on={s.evenBuilding} onChange={(v) => save({ evenBuilding: v })} disabled={!s.trackProperties} />
          </div>

          <Title right="Optional">Real-money stakes</Title>
          <div className="rail mx-4 mt-2.5 rounded-[26px] p-[7px]">
            <div className="felt rounded-[20px] p-4">
              <div className="whitespace-nowrap text-[10.5px] font-extrabold tracking-[.2em] text-on-felt2">BUY-IN PER PLAYER · REAL ₹</div>
              <div className="mt-2 flex justify-center">
                <AmountStepper label="Buy-in" value={s.stakes.buyIn} onChange={(n) => save({ buyIn: n })} step={50} min={0} size="lg" zeroLabel="None" format={formatReal} />
              </div>
              {s.stakes.buyIn > 0 && (
                <>
                  <div className="mt-1 text-[12.5px] font-semibold text-on-felt2">
                    Pot {formatReal(s.stakes.buyIn * seated.length)} · {seated.length} players · settled outside the app
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {SPLIT_PRESETS.filter((p) => p.split.length <= Math.max(1, seated.length)).map((p) => {
                      const on = p.split.join() === s.stakes.split.join();
                      return (
                        <button
                          key={p.label}
                          onClick={() => save({ split: p.split })}
                          aria-pressed={on}
                          className="press h-9 rounded-[11px] px-3 text-[12.5px] font-extrabold"
                          style={{ background: on ? "#f6eedb" : "rgba(0,0,0,.3)", color: on ? "#1d1608" : "var(--on-felt2)" }}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                  <SplitEditor split={s.stakes.split} players={Math.max(2, seated.length)} onSave={(sp) => save({ split: sp })} />
                </>
              )}
            </div>
          </div>
        </>
      )}

      {inSetup && !isHost && (
        <>
          <Title>How this game works</Title>
          <Card className="flex flex-col gap-3">
            {[
              { k: "Board", v: `${board.name} · ${fmt(board.startingCash)} each` },
              { k: "Properties", v: s.trackProperties ? "Tracked in the app" : "Money only" },
              { k: "Bank", v: s.bankerMode === "selfService" ? "Self-service" : `Banker approves${bankerSeat ? ` (${bankerSeat.name})` : ""}` },
              {
                k: "House rules",
                v: [s.freeParkingPot && "Free Parking pot", s.doubleOnGo && "Double on GO", s.trackProperties && s.auctions && "Auctions", s.trackProperties && s.evenBuilding && "Even building"].filter(Boolean).join(" · ") || "Standard",
              },
              { k: "Stakes", v: s.stakes.buyIn > 0 ? `${formatReal(s.stakes.buyIn)} each · ${s.stakes.split.map((p, i) => `${ordinal(i)} ${p}%`).join(", ")}` : "None" },
            ].map((r) => (
              <div key={r.k} className="flex justify-between gap-4 text-sm">
                <span className="font-semibold text-ink2">{r.k}</span>
                <span className="text-right font-extrabold">{r.v}</span>
              </div>
            ))}
          </Card>
          <div className="mx-4 mt-[22px] text-center">
            <div className="font-display text-[22px] font-semibold">Waiting for {host?.name ?? "the host"} to start</div>
            <div className="mt-1 text-[13px] text-ink3">You'll jump to the table automatically.</div>
          </div>
        </>
      )}

      {isHost && inSetup && (
        <div className="mt-5 flex justify-center">
          <button onClick={() => setEndAsk(true)} className="press h-11 rounded-xl border border-down px-4 text-[13px] font-bold text-down">
            End session
          </button>
        </div>
      )}

      {isHost && inSetup && (
        <div className="fixed inset-x-0 bottom-0 z-10" style={{ background: "linear-gradient(transparent, var(--bg) 35%)" }}>
          <div className="mx-auto max-w-[520px] px-4 pt-[18px]" style={{ paddingBottom: "max(30px, env(safe-area-inset-bottom))" }}>
            <GoldButton disabled={!!startBlock} pending={pending} onClick={startGame}>
              Start game
            </GoldButton>
            {startBlock && <div className="mt-2 text-center text-xs font-semibold text-ink3">{startBlock}</div>}
          </div>
        </div>
      )}

      {isHost && <MonoSeats open={seatsOpen} onClose={() => setSeatsOpen(false)} state={state} locked={!inSetup} />}
      <Dialog
        open={endAsk}
        eyebrow="END SESSION"
        eyebrowColor="var(--down)"
        title="End the session?"
        body="Nobody can join after this. The report becomes final."
        noLabel="Keep going"
        yesLabel="End session"
        onNo={() => setEndAsk(false)}
        onYes={() =>
          run(async () => {
            await convex.mutation(api.sessions.end, { sessionId: session._id, idempotencyKey: newKey() });
            setEndAsk(false);
            router.push(`/s/${code}/report`);
          })
        }
        pending={pending}
      />
    </main>
  );
}
