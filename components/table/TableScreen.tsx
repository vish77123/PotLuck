"use client";

import { useConvex } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Money } from "@/components/money/Money";
import type { SessionState } from "@/components/lobby/types";
import { BetTray, type Quick } from "@/components/table/BetTray";
import { FeedDrawer } from "@/components/table/FeedDrawer";
import { PoolPile } from "@/components/table/PoolPile";
import { Seat, type SeatView } from "@/components/table/Seat";
import { TopBar } from "@/components/table/TopBar";
import { Dialog } from "@/components/ui/Dialog";
import { api } from "@/convex/_generated/api";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useComposer } from "@/hooks/useComposer";
import { useConnection } from "@/hooks/useConnection";
import { useEntryToasts } from "@/hooks/useEntryToasts";
import { useNow } from "@/hooks/useNow";
import { ONLINE_WINDOW_MS, usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
import { useSubmit } from "@/hooks/useSubmit";
import { avatarColor, initials } from "@/lib/avatar";
import { betProblem, suggest } from "@/lib/bets";
import { newKey } from "@/lib/errors";
import { ago } from "@/lib/feed";
import { formatInr } from "@/lib/format";
import { arcPositions, orderFromMe, teamOf } from "@/lib/seats";
import { useUi } from "@/stores/ui";

type Game = NonNullable<SessionState["latestGame"]>;

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function TableScreen({ state, game }: { state: SessionState; game: Game }) {
  const convex = useConvex();
  const { session, players, meId, recentEntries, isHost } = state;
  const template = game.templateSnapshot;
  const turnBased = template.turnMode === "turn_based";
  const theme = session.theme;
  const me = players.find((p) => p._id === meId)!;
  const meP = game.participants.find((p) => p.sessionPlayerId === meId) ?? null;
  const nameOf = (id?: string) => players.find((p) => p._id === id)?.name ?? "Someone";

  usePresenceHeartbeat(session._id);
  useEntryToasts(state);
  const now = useNow(1000);
  const { reconnecting, retries } = useConnection();
  const presence = useAuthedQuery(api.presence.list, { sessionId: session._id });
  const seen = useMemo(() => new Map((presence ?? []).map((r) => [r.playerId as string, r.lastSeenAt])), [presence]);

  const feedOpen = useUi((s) => s.feedOpen);
  const setFeedOpen = useUi((s) => s.setFeedOpen);
  const hintSeen = useUi((s) => s.hintSeen);
  const setHintSeen = useUi((s) => s.setHintSeen);
  const pushToast = useUi((s) => s.pushToast);

  const composer = useComposer(me.balance, theme);
  const bet = useSubmit();
  const act = useSubmit();
  const [requested, setRequested] = useState<number | null>(null);
  const [hot, setHot] = useState(false);
  const [confirmBet, setConfirmBet] = useState(false);
  const [confirmPack, setConfirmPack] = useState(false);
  const poolRef = useRef<HTMLDivElement>(null);
  const betKey = useRef<string | null>(null);

  // What's live at the table: bets that haven't been undone, newest first.
  const reversed = new Set(recentEntries.filter((e) => e.type === "REVERSAL").map((e) => e.reversesEntryId as string));
  const liveBets = recentEntries.filter((e) => e.type === "BET" && e.gameId === game._id && !reversed.has(e._id));
  const lastBet = liveBets[0] ? { amount: liveBets[0].amount, seen: !!liveBets[0].meta?.seen } : null;
  const lastByPlayer = new Map<string, number>();
  for (const e of liveBets) if (e.fromPlayerId && !lastByPlayer.has(e.fromPlayerId)) lastByPlayer.set(e.fromPlayerId, e.amount);
  const quickAmounts = suggest(template, lastBet, meP?.isSeen ?? false);

  // Seats around the arc, clockwise from my left.
  const others = orderFromMe(game.participants, meId).filter((p) => p.sessionPlayerId !== meId);
  const spots = arcPositions(others.length);
  const seatViews: SeatView[] = others.map((p) => {
    const pl = players.find((x) => x._id === p.sessionPlayerId);
    const team = teamOf(p.teamNo);
    const active = turnBased && game.currentTurnPlayerId === p.sessionPlayerId;
    const last = lastByPlayer.get(p.sessionPlayerId);
    const parts = [
      team ? team.name.toUpperCase() : null,
      template.blindSeenMultiplier ? (p.isSeen ? "SEEN" : "BLIND") : null,
      last !== undefined ? formatInr(last) : null,
    ].filter(Boolean);
    const lastSeen = seen.get(p.sessionPlayerId);
    return {
      id: p.sessionPlayerId,
      name: pl?.name ?? "?",
      wallet: formatInr(pl?.balance ?? 0),
      tag: p.status === "packed" ? "PACKED" : parts.join(" · "),
      ring: team?.color ?? "rgba(246,238,219,.35)",
      active,
      host: session.hostPlayerId === p.sessionPlayerId,
      timer: active && game.turnStartedAt ? mmss(now - game.turnStartedAt) : null,
      dim: p.status === "packed",
      online: pl?.status === "left" ? null : lastSeen !== undefined && now - lastSeen < ONLINE_WINDOW_MS,
    };
  });

  const myTurn = turnBased && game.currentTurnPlayerId === meId;
  const canAct = !!meP && meP.status === "playing" && (turnBased ? myTurn : true) && !reconnecting && me.status === "active";
  const myTeam = teamOf(meP?.teamNo);
  const turnName = nameOf(game.currentTurnPlayerId);

  // The player who acts right before me, for "You're up after …".
  const playing = game.participants.filter((p) => p.status === "playing").sort((a, b) => a.seatOrder - b.seatOrder);
  const myIdx = playing.findIndex((p) => p.sessionPlayerId === meId);
  const pred = myIdx === -1 ? null : playing[(myIdx - 1 + playing.length) % playing.length];

  const problem = betProblem(requested ?? composer.amount, template, me.balance);
  const shownAmount = composer.amount > 0 ? composer.amount : (requested ?? 0);
  const walletShort = requested !== null && requested > me.balance;

  let status = { label: turnBased ? `${turnName.toUpperCase()}’S TURN` : "FREE-FORM · BET ANY TIME", color: "var(--ink3)" };
  let readout: { label: string; amount: string; sub: string; subTone: "normal" | "warn" | "bad"; amountBad: boolean; text?: boolean };
  if (reconnecting) {
    status = { label: "OFFLINE", color: "var(--warn)" };
    readout = { label: "PAUSED", amount: "Reconnecting…", sub: "Bets resume when you’re back online", subTone: "normal", amountBad: false, text: true };
  } else if (!meP) {
    status = { label: "SPECTATING", color: "var(--ink3)" };
    readout = { label: "WATCHING", amount: "Not in this game", sub: "You’ll be dealt in next round", subTone: "normal", amountBad: false, text: true };
  } else if (meP.status === "packed") {
    status = { label: "YOU PACKED", color: "var(--ink3)" };
    readout = { label: "PACKED", amount: "You’re out", sub: "You can bet again next game", subTone: "normal", amountBad: false, text: true };
  } else if (turnBased && !myTurn) {
    readout = {
      label: "NOT YOUR TURN",
      amount: `${turnName} is betting`,
      sub: pred && pred.sessionPlayerId === game.currentTurnPlayerId ? "You’re up next" : `You’re up after ${nameOf(pred?.sessionPlayerId)}`,
      subTone: "normal",
      amountBad: false,
      text: true,
    };
  } else {
    if (myTurn) status = { label: `YOUR TURN · ${game.turnStartedAt ? mmss(now - game.turnStartedAt) : "0:00"}`, color: "var(--gold-ink)" };
    const over = template.confirmAbove !== undefined && shownAmount > template.confirmAbove;
    readout = {
      label: "YOUR BET",
      amount: formatInr(shownAmount),
      sub: problem
        ? walletShort
          ? `${problem}`
          : problem
        : over
          ? `Over ${formatInr(template.confirmAbove!)} — will ask to confirm`
          : shownAmount > 0
            ? turnBased
              ? "↑ Swipe stack up to bet"
              : "↑ Swipe up · anyone can bet"
            : "Pick notes or a quick bet",
      subTone: problem ? "bad" : over ? "warn" : "normal",
      amountBad: !!problem,
    };
  }

  const quick: Quick[] = [
    { label: "Boot", amount: quickAmounts.boot },
    { label: "Same", amount: quickAmounts.same },
    { label: "2×", amount: quickAmounts.double },
  ];

  const onQuick = (amount: number) => {
    composer.clear();
    if (composer.setAmount(amount)) setRequested(null);
    else setRequested(amount);
  };

  const submitBet = () =>
    bet.run(async () => {
      try {
        betKey.current ??= newKey();
        await convex.mutation(api.games.bet, { gameId: game._id, amount: composer.amount, idempotencyKey: betKey.current });
        betKey.current = null;
        setConfirmBet(false);
        setRequested(null);
      } catch (err) {
        betKey.current = null;
        setConfirmBet(false);
        throw err;
      }
    });

  const place = () => {
    const amount = composer.amount;
    if (amount === 0) {
      pushToast({ text: "Build a bet first: tap notes, then swipe the stack up.", tone: "warn" });
      return;
    }
    const why = betProblem(amount, template, me.balance);
    if (why) {
      pushToast({ text: why, tone: "error" });
      return;
    }
    if (template.confirmAbove !== undefined && amount > template.confirmAbove) setConfirmBet(true);
    else submitBet();
  };

  const toggleSeen = (next: boolean) => act.run(() => convex.mutation(api.games.setSeen, { gameId: game._id, seen: next }));
  const doPack = () =>
    act.run(async () => {
      await convex.mutation(api.games.pack, { gameId: game._id });
      setConfirmPack(false);
      composer.clear();
    });

  // First-bet walkthrough, once per phone.
  const showHint = !hintSeen && canAct && !feedOpen;

  // Feed ticker + unread badge.
  const newestSeq = recentEntries[0]?.seq ?? 0;
  const [lastSeenSeq, setLastSeenSeq] = useState(newestSeq);
  useEffect(() => {
    if (feedOpen) setLastSeenSeq(newestSeq);
  }, [feedOpen, newestSeq]);
  const unread = recentEntries.filter((e) => e.seq > lastSeenSeq && e.createdByPlayerId !== meId && e.type !== "BOOT").length;

  const latestEntry = recentEntries.find((e) => e.gameId === game._id) ?? null;
  const latestEvent = game.events[0] ?? null;
  let ticker: { who: string; what: string; amt: string; when: string } | null = null;
  if (latestEntry && (!latestEvent || latestEntry.createdAt >= latestEvent.createdAt)) {
    const e = latestEntry;
    ticker = {
      who: nameOf(e.type === "PAYOUT" ? e.toPlayerId : (e.fromPlayerId ?? e.toPlayerId)),
      what: e.type === "BET" ? (e.meta?.seen ? "Seen bet" : template.blindSeenMultiplier ? "Blind bet" : "bet") : e.type === "BOOT" ? "boot" : e.type === "REVERSAL" ? "undone" : e.type === "PAYOUT" ? "won" : e.type.toLowerCase(),
      amt: formatInr(e.amount),
      when: ago(e.createdAt, now),
    };
  } else if (latestEvent) {
    ticker = { who: nameOf(latestEvent.playerId), what: latestEvent.kind === "pack" ? "packed" : "is back in", amt: "", when: ago(latestEvent.createdAt, now) };
  }

  return (
    <main className="room relative mx-auto flex min-h-dvh w-full max-w-[520px] flex-col overflow-x-hidden text-ink">
      <TopBar
        title={template.name}
        sub={`Round ${game.gameNo}`}
        live={!reconnecting}
        unread={unread}
        onFeed={() => setFeedOpen(true)}
      />

      {reconnecting ? (
        <div className="mx-4 mt-2 flex h-10 items-center gap-2.5 rounded-xl bg-warn px-3.5 text-[13px] font-bold text-[#1d1608]" role="status">
          <span className="h-4 w-4 animate-spin rounded-full border-[2.5px] border-[rgba(29,22,8,.25)] border-t-[#1d1608]" />
          <span className="flex-1">Reconnecting… betting paused</span>
          <span className="font-semibold opacity-75">Try {Math.max(1, retries)}</span>
        </div>
      ) : (
        <div className="mt-2 flex h-7 justify-center">
          {ticker && (
            <button
              onClick={() => setFeedOpen(true)}
              className="flex h-7 items-center gap-[7px] whitespace-nowrap rounded-[14px] border border-line bg-surface px-3 text-xs text-ink2"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              <b className="text-ink">{ticker.who}</b>
              <span>{ticker.what}</span>
              {ticker.amt && <b className="tabular-nums text-gold-ink">{ticker.amt}</b>}
              <span className="text-ink3">{ticker.when}</span>
            </button>
          )}
        </div>
      )}

      <div className="relative mt-1.5 min-h-[400px] flex-1">
        <div className="absolute inset-x-2.5 bottom-[30px] top-0">
          <div className="rail absolute inset-0 rounded-[50%]" style={{ boxShadow: "var(--sh2), inset 0 2px 0 rgba(255,255,255,.09), inset 0 -3px 6px rgba(0,0,0,.4)" }}>
            <div
              className="absolute inset-[13px] rounded-[50%]"
              style={{ background: "var(--felt-bg)", boxShadow: "inset 0 0 0 1.5px var(--rail-pin), inset 0 0 70px rgba(0,0,0,.55)" }}
            >
              <div className="absolute rounded-[50%]" style={{ inset: "52px 46px", border: "1.5px solid rgba(246,238,219,.1)" }} />
            </div>
          </div>

          <div ref={poolRef} className="pointer-events-none absolute left-1/2 top-[22%] h-[150px] w-[170px] -translate-x-1/2" aria-hidden />
          <PoolPile pool={game.poolAmount} theme={theme} subtitle={`Round ${game.gameNo} · ${playing.length} playing`} hot={hot} />

          {seatViews.map((s, i) => (
            <Seat key={s.id} s={s} x={spots[i].x} y={spots[i].y} />
          ))}
        </div>

        <div className="absolute inset-x-0 bottom-1 flex items-center justify-center gap-2.5">
          <div className="flex w-[118px] justify-end">
            {template.blindSeenMultiplier && meP ? (
              <div className="flex rounded-[20px] border p-[3px]" style={{ background: "var(--plate)", borderColor: "var(--rail-pin)" }} role="radiogroup" aria-label="Blind or seen">
                {[
                  { v: false, l: "Blind" },
                  { v: true, l: "Seen" },
                ].map((o) => {
                  const on = meP.isSeen === o.v;
                  return (
                    <button
                      key={o.l}
                      role="radio"
                      aria-checked={on}
                      disabled={act.pending || meP.status !== "playing"}
                      onClick={() => !on && toggleSeen(o.v)}
                      className="h-[38px] rounded-2xl px-3 text-xs"
                      style={{ background: on ? "#e5c47c" : "transparent", color: on ? "#1d1608" : "#c2d5c4", fontWeight: on ? 800 : 700 }}
                    >
                      {o.l}
                    </button>
                  );
                })}
              </div>
            ) : myTeam ? (
              <div className="flex items-center gap-1.5 rounded-[20px] border px-3 py-[9px] text-xs font-bold text-[#f6eedb]" style={{ background: "var(--plate)", borderColor: "var(--rail-pin)" }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: myTeam.color }} />
                Team {myTeam.name}
              </div>
            ) : null}
          </div>
          <div
            className="relative grid h-[70px] w-[70px] place-items-center rounded-full text-[22px] font-extrabold text-[#f6eedb]"
            style={{
              boxSizing: "border-box",
              background: avatarColor(me.name),
              border: `3px solid ${myTurn ? "#f1d590" : (myTeam?.color ?? "rgba(246,238,219,.4)")}`,
              boxShadow: myTurn ? "var(--glow)" : "0 2px 8px rgba(0,0,0,.4)",
              animation: myTurn ? "pl-glow 2.4s ease-in-out infinite" : undefined,
            }}
          >
            {initials(me.name)}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-[7px] bg-[#f6eedb] px-[7px] py-px text-[9.5px] font-extrabold tracking-[.1em] text-[#1d1608]">YOU</div>
          </div>
          <div className="w-[118px]">
            <div className="inline-flex flex-col rounded-[14px] border px-3 py-1.5" style={{ background: "var(--plate)", borderColor: "var(--rail-pin)" }}>
              <span className="text-[9.5px] font-extrabold tracking-[.14em] text-[#c2d5c4]">WALLET</span>
              <span className="amount text-[19px] leading-[1.1] text-[#e5c47c]">{formatInr(me.balance)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className={showHint ? "relative z-[31]" : undefined}>
        <BetTray
          theme={theme}
          counts={composer.counts}
          built={composer.built}
          canAct={canAct}
          pending={bet.pending}
          status={status}
          limits={[template.boot > 0 ? `Boot ${formatInr(template.boot)}` : null, template.maxBet !== undefined ? `Max ${formatInr(template.maxBet)}` : `Min ${formatInr(template.minBet)}`].filter(Boolean).join(" · ")}
          readout={readout}
          quick={quick}
          freeForm={!turnBased}
          poolRef={poolRef}
          hint={showHint}
          tray={canAct ? "gold" : "plain"}
          onAdd={(d) => {
            setRequested(null);
            composer.add(d);
          }}
          onRemoveTop={composer.removeTop}
          onClear={() => {
            setRequested(null);
            composer.clear();
          }}
          onQuick={onQuick}
          onPack={() => setConfirmPack(true)}
          onPlace={place}
          onHover={setHot}
        />
      </div>

      {showHint && (
        <div className="fixed inset-0 z-30" style={{ background: "rgba(4,5,4,.74)" }}>
          <div className="absolute inset-x-6 top-[34%] mx-auto max-w-[420px] rounded-[20px] border border-line-gold bg-surface px-[18px] pb-4 pt-[18px]" style={{ boxShadow: "var(--sh2)" }}>
            <div className="text-[10.5px] font-extrabold tracking-[.16em] text-gold-ink">FIRST BET</div>
            <div className="font-display mt-1 text-[22px] font-semibold leading-[1.2]">Drag your stack into the pool</div>
            <div className="mt-1.5 text-[13.5px] leading-[1.45] text-ink2">Tap notes to build a bet. Tap the stack to take one back. Swipe it up to place it.</div>
            <div className="mt-3 flex justify-end">
              <button onClick={() => setHintSeen(true)} className="gold-btn press h-11 rounded-[22px] px-5 text-sm">
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      <FeedDrawer
        open={feedOpen}
        onClose={() => setFeedOpen(false)}
        sessionId={session._id}
        gameId={game._id}
        title={`${template.name} · Round ${game.gameNo}`}
        isHost={isHost}
        meId={meId}
        names={nameOf}
        blindSeen={!!template.blindSeenMultiplier}
      />

      <Dialog
        open={confirmBet}
        eyebrow="CONFIRM BET"
        title={`Place ${formatInr(composer.amount)}?`}
        body={`This is above the ${formatInr(template.confirmAbove ?? 0)} confirm limit for ${template.name}.`}
        extra={
          <div className="mt-3.5 flex justify-center gap-1.5">
            {composer.built.slice(-2).map((v, i) => (
              <Money key={i} kind={theme === "chips" ? "chip" : v < 10 ? "coin" : "note"} v={v} w={theme === "chips" ? 56 : v < 10 ? 48 : 96} rot={i ? 3 : -4} />
            ))}
          </div>
        }
        noLabel="Back"
        yesLabel={`Place ${formatInr(composer.amount)}`}
        onNo={() => setConfirmBet(false)}
        onYes={submitBet}
        pending={bet.pending}
      />
      <Dialog
        open={confirmPack}
        eyebrow="PACK"
        eyebrowColor="var(--down)"
        title="Pack this hand?"
        body="You’re out of this game and can’t bet again until the next one. The host can bring you back if it was a mistake."
        noLabel="Keep playing"
        yesLabel="Pack"
        onNo={() => setConfirmPack(false)}
        onYes={doPack}
        pending={act.pending}
      />
    </main>
  );
}
