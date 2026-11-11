"use client";

import { useState } from "react";
import { AuctionSheet } from "@/components/mono/AuctionSheet";
import { MonoBoardTab, MyDeeds } from "@/components/mono/MonoBoardTab";
import { CardsSheet, JailSheet } from "@/components/mono/MonoCards";
import { BankruptcySheet, EndGameSheet, RaiseMoneySheet } from "@/components/mono/MonoEnd";
import { useRaise } from "@/components/mono/raiseStore";
import { MonoFeed } from "@/components/mono/MonoFeed";
import { BankSheet, GoSheet, PaySheet } from "@/components/mono/MonoSheets";
import { PropertySheet } from "@/components/mono/PropertySheet";
import { TradeSheet } from "@/components/mono/TradeSheet";
import { sideText } from "@/components/mono/trade";
import { useMonoActions } from "@/components/mono/actions";
import { useGameState, useMoney, type MonoGame, type MonoPlayer, type MonoRequest, type MonoState } from "@/components/mono/types";
import { Avatar } from "@/components/ui/Avatar";
import { BackButton } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/Dialog";
import { useNow } from "@/hooks/useNow";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
import { gameIsOver } from "@/lib/monopoly/engine";
import { ordinal } from "@/lib/monopoly/money";

type Tab = "me" | "board" | "bank" | "feed";
type SheetKind = "go" | "pay" | "request" | "bankIn" | "bankOut" | "trade" | "card" | "jail" | null;

function minutesLeft(r: MonoRequest, now: number) {
  const m = Math.max(1, Math.round((r.expiresAt - now) / 60000));
  return `${m} min left`;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-[10.5px] font-extrabold tracking-[.16em] text-ink3">{children}</div>;
}

/** A queued request or approval, with the buttons that fit who is looking at it. */
function RequestRow({
  game,
  request,
  mine,
  now,
  actions,
}: {
  game: MonoGame;
  request: MonoRequest;
  mine: boolean;
  now: number;
  actions: ReturnType<typeof useMonoActions>;
}) {
  const fmt = useMoney(game);
  const from = game.players.find((p) => p._id === request.fromPlayerId);
  const payload = request.payload as { label?: string; note?: string } | undefined;
  const offer = request.kind === "trade" ? (request.payload as { a: { cash: number; spaceIds: string[]; jailCards: number }; b: { cash: number; spaceIds: string[]; jailCards: number } }) : null;
  const other = game.players.find((p) => p._id === request.toPlayerId);
  const text = offer
    ? mine
      ? `Waiting for ${other?.name ?? "them"} to answer your trade: you give ${sideText(game, offer.a)} for ${sideText(game, offer.b)}`
      : `${from?.name ?? "Someone"} offers ${sideText(game, offer.a)} for your ${sideText(game, offer.b)}`
    : request.kind === "payment"
      ? mine
        ? `Waiting for ${game.players.find((p) => p._id === request.toPlayerId)?.name ?? "them"} to pay you ${fmt(request.amount ?? 0)}`
        : `${from?.name ?? "Someone"} asks you for ${fmt(request.amount ?? 0)}`
      : mine
        ? `Waiting for approval: ${payload?.label ?? "a bank move"}`
        : (payload?.label ?? "A bank move");
  return (
    <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-3 last:border-b-0">
      <Avatar name={from?.name ?? "?"} size={34} />
      <div className="min-w-0 flex-1 leading-snug">
        <div className="text-[13.5px] font-extrabold">{text}</div>
        <div className="text-[11.5px] font-semibold text-ink3">{minutesLeft(request, now)}</div>
      </div>
      {mine ? (
        <button disabled={actions.pending} onClick={() => actions.cancelRequest(request._id)} className="press h-10 rounded-xl border border-line px-3 text-[12.5px] font-bold text-ink2">
          Withdraw
        </button>
      ) : (
        <>
          <button
            aria-label="Decline"
            disabled={actions.pending}
            onClick={() => actions.respond(request._id, false)}
            className="press grid h-11 w-11 place-items-center rounded-[13px] border border-line bg-surface2 font-black text-down"
          >
            ✕
          </button>
          <button
            aria-label="Approve"
            disabled={actions.pending}
            onClick={() => actions.respond(request._id, true, request.kind === "payment" ? `Paid ${from?.name ?? ""} ${fmt(request.amount ?? 0)}` : request.kind === "trade" ? "Trade done" : undefined)}
            className="gold-btn press grid h-11 w-11 place-items-center rounded-[13px] font-black"
          >
            ✓
          </button>
        </>
      )}
    </div>
  );
}

function ActionButton({ title, sub, onClick, disabled, gold }: { title: string; sub?: string; onClick: () => void; disabled?: boolean; gold?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`press flex h-[74px] flex-col items-start justify-center rounded-[18px] px-3.5 text-left disabled:opacity-40 ${gold ? "gold-btn" : "border border-line bg-surface"}`}
    >
      <span className="text-[14.5px] font-extrabold leading-tight">{title}</span>
      {sub && <span className={`mt-0.5 text-[11.5px] font-bold ${gold ? "opacity-70" : "text-ink3"}`}>{sub}</span>}
    </button>
  );
}

export function MonoTable({ state, game }: { state: MonoState; game: MonoGame }) {
  const { session, crew, seats, isHost } = state;
  usePresenceHeartbeat(session._id);
  const fmt = useMoney(game);
  const actions = useMonoActions(game);
  const now = useNow(15_000);
  const [tab, setTab] = useState<Tab>("me");
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [cancelAsk, setCancelAsk] = useState(false);
  const gs = useGameState(game);
  const raiseNeeded = useRaise((r) => r.needed);
  const closeRaise = useRaise((r) => r.close);
  const [bankruptOpen, setBankruptOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [auctionHiddenFor, setAuctionHiddenFor] = useState<string | null>(null);
  const auctionHidden = !!game.auction && auctionHiddenFor === game.auction._id;
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [spaceOpen, setSpaceOpen] = useState(false);
  const openSpace = (id: string) => {
    setSpaceId(id);
    setSpaceOpen(true);
  };

  const players = [...game.players].sort((a, b) => a.seatOrder - b.seatOrder);
  const me: MonoPlayer | null = players.find((p) => p._id === game.myPlayerId) ?? null;
  const banker = players.find((p) => p._id === game.settings.bankerPlayerId);
  const isBanker = !!me && me._id === banker?._id;
  const turn = players.find((p) => p._id === game.currentTurnPlayerId);
  const myTurn = !!me && me._id === turn?._id;
  const approvalMode = game.settings.bankerMode === "bankerApproves";
  const paused = game.status === "paused";

  const askedOfMe = game.requests.filter((r) => (r.kind === "payment" || r.kind === "trade") && r.toPlayerId === me?._id);
  const forApproval = game.requests.filter((r) => r.kind === "approval" && (r.toPlayerId === me?._id || isHost) && r.fromPlayerId !== me?._id);
  const waitingOnOthers = game.requests.filter((r) => r.fromPlayerId === me?._id);
  const attention = askedOfMe.length + forApproval.length;

  const close = () => setSheet(null);

  return (
    <main className="room relative mx-auto min-h-dvh w-full max-w-[520px] pb-32 text-ink">
      <div className="flex items-center gap-2.5 px-4" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <div className="flex w-full items-center gap-2.5 pt-3">
          <BackButton href="/" />
          <div className="font-display min-w-0 flex-1 truncate text-[22px] font-semibold">{session.name ?? crew.name}</div>
          {isHost && <div className="rounded-xl border border-line-gold px-2.5 py-1.5 text-[11.5px] font-extrabold tracking-[.1em] text-gold-ink">♛ HOST</div>}
          <div className="rounded-xl border border-line bg-surface px-2.5 py-1.5 text-[11.5px] font-extrabold tracking-[.1em] text-ink2">GAME {game.gameNo}</div>
        </div>
      </div>

      {paused && <div className="mx-4 mt-3 rounded-[16px] border border-line-gold bg-surface p-3.5 text-sm font-bold">The game is paused. Nothing can be moved until the host resumes it.</div>}

      {tab === "me" && (
        <>
          {me ? (
            <div className="rail mx-4 mt-4 rounded-[28px] p-2">
              <div className="felt rounded-[22px] px-5 py-[18px]">
                <div className="text-[10.5px] font-extrabold tracking-[.2em] text-on-felt2">YOUR CASH · {me.name.toUpperCase()}</div>
                <div className="font-display text-[clamp(40px,13vw,56px)] font-bold leading-[1.05] tabular-nums" aria-label={`Your cash ${fmt(me.cash)}`}>
                  {fmt(me.cash)}
                </div>
                <div className="mt-1 text-[12.5px] font-semibold text-on-felt2">
                  {isBanker ? "You're the banker · " : ""}
                  {me.status === "bankrupt" ? "Out of the game" : me.inJail ? `In jail · turn ${me.jailTurns + 1}` : game.settings.stakes.buyIn > 0 ? `Playing for real ₹${game.settings.stakes.buyIn.toLocaleString("en-IN")} each` : "Play money"}
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-4 mt-4 rounded-[20px] border border-line bg-surface p-4 text-sm font-semibold text-ink2">
              You're watching this game. Ask the host to seat you in the next one.
            </div>
          )}

          <div className="mx-4 mt-3 rounded-[20px] border border-line bg-surface p-3.5">
            <div className="flex items-center gap-3">
              <Avatar name={turn?.name ?? "?"} size={40} ring="var(--gold)" />
              <div className="min-w-0 flex-1">
                <Eyebrow>TURN {game.turnNo}</Eyebrow>
                <div className="font-display truncate text-[20px] font-semibold">{myTurn ? "Your turn" : `${turn?.name ?? "Nobody"}'s turn`}</div>
              </div>
              {(myTurn || isHost) && !paused && (
                <button disabled={actions.pending} onClick={() => actions.endTurn()} className={`press h-11 flex-none rounded-xl px-4 text-[13.5px] ${myTurn ? "gold-btn" : "border border-line font-bold"}`}>
                  {myTurn ? "End turn" : "End their turn"}
                </button>
              )}
            </div>
            <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
              {players.map((p) => (
                <div key={p._id} className="flex flex-none flex-col items-center gap-1" style={{ opacity: p.status === "bankrupt" ? 0.4 : 1 }}>
                  <Avatar name={p.name} size={34} ring={p._id === turn?._id ? "var(--gold)" : undefined} />
                  <span className="max-w-[52px] truncate text-[10.5px] font-bold text-ink2">{p.name}</span>
                </div>
              ))}
            </div>
          </div>

          {(askedOfMe.length > 0 || forApproval.length > 0) && (
            <>
              <div className="px-5 pt-[18px]">
                <Eyebrow>WAITING FOR YOU · {attention}</Eyebrow>
              </div>
              <div className="mx-4 mt-2 overflow-hidden rounded-[20px] border border-line-gold bg-surface">
                {[...askedOfMe, ...forApproval].map((r) => (
                  <RequestRow key={r._id} game={game} request={r} mine={false} now={now} actions={actions} />
                ))}
              </div>
            </>
          )}
          {waitingOnOthers.length > 0 && (
            <div className="mx-4 mt-3 overflow-hidden rounded-[20px] border border-line bg-surface">
              {waitingOnOthers.map((r) => (
                <RequestRow key={r._id} game={game} request={r} mine now={now} actions={actions} />
              ))}
            </div>
          )}

          {me && me.status === "bankrupt" && (
            <div className="mx-4 mt-3 rounded-[18px] border border-line-gold bg-surface p-3.5 text-[13.5px] font-extrabold">
              You're out of the game{me.finishPosition ? `, finishing ${ordinal(me.finishPosition)}` : ""}. You can keep watching.
            </div>
          )}
          {me && me.status === "playing" && me.owes && now - me.owes.at < 5 * 60 * 1000 && me.cash < me.owes.needed && (
            <div className="mx-4 mt-3 rounded-[18px] border border-down bg-surface p-3.5">
              <div className="text-[13.5px] font-extrabold">A card needs {fmt(me.owes.needed)} from you. You have {fmt(me.cash)}.</div>
              <div className="mt-2.5 flex gap-2">
                <button onClick={() => useRaise.getState().open(me.owes!.needed)} className="gold-btn press h-10 rounded-xl px-4 text-[13px]">
                  Raise money
                </button>
                <button onClick={() => actions.clearShort()} className="press h-10 rounded-xl border border-line px-4 text-[13px] font-bold text-ink2">
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {me?.inJail && me.status === "playing" && (
            <button onClick={() => setSheet("jail")} className="press mx-4 mt-3 flex w-[calc(100%-32px)] items-center gap-3 rounded-[18px] border border-line-gold bg-surface p-3.5 text-left">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-gold text-[13px] font-black text-on-gold">⛓</span>
              <span className="flex-1 text-[13.5px] font-extrabold">You're in jail · turn {me.jailTurns + 1}. Tap for your options.</span>
            </button>
          )}
          {game.auction && auctionHidden && (
            <button onClick={() => setAuctionHiddenFor(null)} className="press mx-4 mt-3 flex w-[calc(100%-32px)] items-center gap-3 rounded-[18px] border border-line-gold bg-surface p-3.5 text-left">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-gold text-[15px] font-black text-on-gold">⚖</span>
              <span className="flex-1 text-[13.5px] font-extrabold">Auction live: {game.boardSnapshot.spaces.find((x) => x.id === game.auction!.spaceId)?.name}. Tap to bid.</span>
            </button>
          )}

          {me && me.status === "playing" && (
            <div className="mx-4 mt-4 grid grid-cols-2 gap-2.5">
              <ActionButton gold title="Pass GO" sub={`+${fmt(game.boardSnapshot.passGo)}`} disabled={paused} onClick={() => setSheet("go")} />
              <ActionButton title="Pay a player" sub="Instant" disabled={paused} onClick={() => setSheet("pay")} />
              <ActionButton title="Request money" sub="They approve" disabled={paused} onClick={() => setSheet("request")} />
              <ActionButton title="From the bank" sub={approvalMode && !isHost ? "Banker approves" : "Collect"} disabled={paused} onClick={() => setSheet("bankIn")} />
              <ActionButton title="To the bank" sub={game.settings.freeParkingPot ? "Tax, fine, card → pot" : approvalMode && !isHost ? "Banker approves" : "Tax, fine, card"} disabled={paused} onClick={() => setSheet("bankOut")} />
              <ActionButton title="Trade" sub="Both must accept" disabled={paused} onClick={() => setSheet("trade")} />
              <ActionButton title="Card" sub="From all · to all · repairs" disabled={paused} onClick={() => setSheet("card")} />
              <ActionButton title="Jail" sub={me.inJail ? "You're in jail" : "Go to jail"} disabled={paused} onClick={() => setSheet("jail")} />
              {game.settings.freeParkingPot && (
                <ActionButton
                  title="Collect pot"
                  sub={fmt(game.freeParkingPot)}
                  disabled={paused || game.freeParkingPot <= 0}
                  onClick={() => actions.perform({ kind: "collectPot" }, { done: `Collected the pot, ${fmt(game.freeParkingPot)}` })}
                />
              )}
            </div>
          )}

          {me && <MyDeeds game={game} me={me} onOpen={openSpace} />}

          <div className="px-5 pt-[22px]">
            <Eyebrow>AT THE TABLE · {players.length}</Eyebrow>
          </div>
          <div className="mx-4 mt-2 overflow-hidden rounded-[20px] border border-line bg-surface">
            {players.map((p) => (
              <div key={p._id} className="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0" style={{ opacity: p.status === "bankrupt" ? 0.5 : 1 }}>
                <Avatar name={p.name} size={36} ring={p._id === me?._id ? "var(--gold)" : undefined} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-extrabold">
                    {p.name}
                    {p._id === banker?._id && <span className="ml-1.5 rounded-md border border-line-gold px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-gold-ink">BANKER</span>}
                  </div>
                  <div className="text-[11.5px] font-semibold text-ink3">{p.status === "bankrupt" ? "Out of the game" : p.inJail ? "In jail" : p._id === turn?._id ? "Playing now" : "Waiting"}</div>
                </div>
                <div className="amount text-[19px] tabular-nums">{fmt(p.cash)}</div>
              </div>
            ))}
          </div>
          {me && me.status === "playing" && (
            <div className="mt-6 text-center">
              <button onClick={() => setBankruptOpen(true)} className="press h-11 rounded-xl border border-down px-4 text-[13px] font-bold text-down">
                Declare bankruptcy
              </button>
            </div>
          )}
        </>
      )}

      {tab === "board" && <MonoBoardTab game={game} me={me} onOpen={openSpace} />}

      {tab === "bank" && (
        <>
          <div className="px-5 pt-5">
            <h1 className="font-display text-[28px] font-semibold">Bank</h1>
          </div>
          <div className="mx-4 mt-3 rounded-[20px] border border-line bg-surface p-4">
            <Eyebrow>BANKER</Eyebrow>
            <div className="mt-1 text-[15px] font-extrabold">
              {approvalMode ? (banker ? `${banker.name}${isBanker ? " (you)" : ""}` : "Not chosen") : "Self-service: anyone can move their own money"}
            </div>
            <div className="mt-1 text-[12.5px] font-semibold leading-snug text-ink2">
              {approvalMode ? "Bank payments wait for the banker's tap. The banker's own go to the host. Player-to-player stays instant." : "The bank never runs out of money."}
            </div>
            {isHost && approvalMode && (
              <div className="mt-3 flex flex-wrap gap-2">
                {players.filter((p) => p.status === "playing").map((p) => (
                  <button
                    key={p._id}
                    disabled={actions.pending || p._id === banker?._id}
                    onClick={() => actions.setBanker(p._id)}
                    className="press h-9 rounded-xl border px-3 text-[12.5px] font-bold"
                    style={{ borderColor: p._id === banker?._id ? "var(--gold)" : "var(--line)" }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {game.settings.trackProperties && (
            <div className="mx-4 mt-3 grid grid-cols-2 gap-2.5">
              {[
                { k: "Houses in the bank", v: game.bankHouses, of: game.boardSnapshot.houses },
                { k: "Hotels in the bank", v: game.bankHotels, of: game.boardSnapshot.hotels },
              ].map((x) => (
                <div key={x.k} className="rounded-[18px] border border-line bg-surface p-3.5">
                  <div className="text-[11.5px] font-extrabold text-ink2">{x.k}</div>
                  <div className="font-display mt-1 text-[30px] font-bold leading-[1.1] tabular-nums">
                    {x.v}
                    <span className="text-[15px] text-ink3"> / {x.of}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface3">
                    <div className="h-full bg-gold" style={{ width: `${x.of ? (x.v / x.of) * 100 : 0}%` }} />
                  </div>
                  {x.v === 0 && <div className="mt-1 text-[11.5px] font-bold text-warn">None left. Building is blocked.</div>}
                </div>
              ))}
            </div>
          )}

          {game.settings.freeParkingPot && (
            <div className="rail mx-4 mt-3 rounded-[26px] p-2">
              <div className="felt rounded-[20px] px-[18px] py-4">
                <div className="text-[10.5px] font-extrabold tracking-[.2em] text-on-felt2">FREE PARKING POT</div>
                <div className="font-display text-[44px] font-bold leading-[1.05] tabular-nums">{fmt(game.freeParkingPot)}</div>
                <div className="text-xs font-semibold text-on-felt2">Taxes, fines and card payments</div>
              </div>
            </div>
          )}

          <div className="px-5 pt-[18px]">
            <Eyebrow>{isBanker || isHost ? `WAITING FOR YOU · ${forApproval.length}` : "YOUR BANK MOVES"}</Eyebrow>
          </div>
          {(isBanker || isHost ? forApproval : waitingOnOthers.filter((r) => r.kind === "approval")).length === 0 ? (
            <div className="mx-5 mt-3 text-sm font-semibold text-ink3">Nothing is waiting.</div>
          ) : (
            <div className="mx-4 mt-2 overflow-hidden rounded-[20px] border border-line-gold bg-surface">
              {(isBanker || isHost ? forApproval : waitingOnOthers.filter((r) => r.kind === "approval")).map((r) => (
                <RequestRow key={r._id} game={game} request={r} mine={r.fromPlayerId === me?._id} now={now} actions={actions} />
              ))}
            </div>
          )}

          {isHost && (
            <div className="mx-4 mt-8 grid gap-2.5 text-center">
              {gameIsOver(gs) ? (
                <button disabled={actions.pending} onClick={() => actions.finishGame()} className="gold-btn press h-12 rounded-xl text-[14px]">
                  Finish the game
                </button>
              ) : (
                <button onClick={() => setEndOpen(true)} className="press h-12 rounded-xl border border-line-gold text-[14px] font-bold text-gold-ink">
                  End the game early
                </button>
              )}
              <button onClick={() => setCancelAsk(true)} className="press h-11 rounded-xl border border-down px-4 text-[13px] font-bold text-down">
                Cancel this game
              </button>
            </div>
          )}
        </>
      )}

      {tab === "feed" && (
        <>
          <div className="px-5 pt-5">
            <h1 className="font-display text-[28px] font-semibold">Activity</h1>
            {isHost && <div className="mt-0.5 text-[12.5px] font-semibold text-ink3">Undo reverses a whole action. It's refused if something later touched the same money or deeds.</div>}
          </div>
          <MonoFeed game={game} seats={seats} isHost={isHost} />
        </>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }} aria-label="Game sections">
        <div className="mx-auto grid max-w-[520px]" style={{ gridTemplateColumns: `repeat(${game.settings.trackProperties ? 4 : 3}, minmax(0, 1fr))` }}>
          {(
            [
              ["me", "Me"],
              ...(game.settings.trackProperties ? ([["board", "Board"]] as const) : []),
              ["bank", "Bank"],
              ["feed", "Feed"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} aria-current={tab === k} className={`relative h-14 text-[13px] font-extrabold ${tab === k ? "text-gold-ink" : "text-ink3"}`}>
              {label}
              {k === "bank" && forApproval.length > 0 && <span className="absolute right-[32%] top-2.5 h-2.5 w-2.5 rounded-full bg-gold" />}
              {k === "me" && askedOfMe.length > 0 && <span className="absolute right-[32%] top-2.5 h-2.5 w-2.5 rounded-full bg-gold" />}
            </button>
          ))}
        </div>
      </nav>

      <PropertySheet open={spaceOpen} onClose={() => setSpaceOpen(false)} game={game} me={me} spaceId={spaceId} isHost={isHost} />
      <AuctionSheet open={!!game.auction && !auctionHidden} onClose={() => setAuctionHiddenFor(game.auction?._id ?? null)} game={game} me={me} isHost={isHost} />
      {me && me.status === "playing" && raiseNeeded !== null && (
        <RaiseMoneySheet open onClose={closeRaise} game={game} me={me} needed={raiseNeeded} onBankrupt={() => { closeRaise(); setBankruptOpen(true); }} />
      )}
      {me && me.status === "playing" && <BankruptcySheet open={bankruptOpen} onClose={() => setBankruptOpen(false)} game={game} me={me} />}
      {isHost && <EndGameSheet open={endOpen} onClose={() => setEndOpen(false)} game={game} />}
      {me && (
        <>
          <TradeSheet open={sheet === "trade"} onClose={close} game={game} me={me} />
          <CardsSheet open={sheet === "card"} onClose={close} game={game} me={me} />
          <JailSheet open={sheet === "jail"} onClose={close} game={game} me={me} />
          <GoSheet open={sheet === "go"} onClose={close} game={game} me={me} />
          <PaySheet open={sheet === "pay"} onClose={close} game={game} mode="pay" me={me} />
          <PaySheet open={sheet === "request"} onClose={close} game={game} mode="request" me={me} />
          <BankSheet open={sheet === "bankIn"} onClose={close} game={game} mode="collect" me={me} canActForOthers={isHost || isBanker} />
          <BankSheet open={sheet === "bankOut"} onClose={close} game={game} mode="pay" me={me} canActForOthers={isHost || isBanker} />
        </>
      )}
      <Dialog
        open={cancelAsk}
        eyebrow="CANCEL GAME"
        eyebrowColor="var(--down)"
        title="Cancel this game?"
        body="Nothing is paid out and everyone's real-money buy-in is refunded. You can start a new game right after."
        noLabel="Keep playing"
        yesLabel="Cancel game"
        onNo={() => setCancelAsk(false)}
        onYes={async () => {
          await actions.cancelGame();
          setCancelAsk(false);
        }}
        pending={actions.pending}
      />
    </main>
  );
}
