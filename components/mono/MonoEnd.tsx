"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMonoActions } from "@/components/mono/actions";
import { useGameState, useMoney, type MonoGame, type MonoPlayer, type MonoState } from "@/components/mono/types";
import { Avatar } from "@/components/ui/Avatar";
import { GoldButton } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/Sheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useConvex } from "convex/react";
import { useSubmit } from "@/hooks/useSubmit";
import { formatMoney, formatReal, ordinal } from "@/lib/monopoly/money";
import { netWorth, netWorthParts, raiseMoneyOptions, splitStakes } from "@/lib/monopoly/rules";

/** When a payment is more than a player has: what they can sell or mortgage, and how much each raises. */
export function RaiseMoneySheet({
  open,
  onClose,
  game,
  me,
  needed,
  onBankrupt,
}: {
  open: boolean;
  onClose: () => void;
  game: MonoGame;
  me: MonoPlayer;
  needed: number;
  onBankrupt: () => void;
}) {
  const fmt = useMoney(game);
  const gs = useGameState(game);
  const actions = useMonoActions(game);
  const r = raiseMoneyOptions(gs, me._id, needed);
  const enough = me.cash >= needed;
  const pct = Math.min(100, Math.round((me.cash / Math.max(1, needed)) * 100));
  return (
    <Sheet open={open} onClose={onClose} title="Raise money" subtitle={`You need ${fmt(needed)} and have ${fmt(me.cash)}.`}>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface3">
        <div className="h-full bg-gold" style={{ width: `${pct}%`, transition: "width 200ms" }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[12.5px] font-bold text-ink2">
        <span>{enough ? "You can cover it now" : `${fmt(r.shortBy)} short`}</span>
        <span>{fmt(me.cash)} / {fmt(needed)}</span>
      </div>

      {enough ? (
        <div className="mt-4">
          <GoldButton onClick={onClose}>You have enough. Go back and pay.</GoldButton>
        </div>
      ) : (
        <>
          {r.options.length > 0 ? (
            <div className="mt-4 overflow-hidden rounded-[18px] border border-line">
              {r.options.map((o) => (
                <div key={`${o.kind}-${o.spaceId}`} className="flex items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-extrabold">{o.name}</div>
                    <div className="text-[11.5px] font-semibold text-ink3">{o.kind === "sell_building" ? "Sell a building" : "Mortgage"}</div>
                  </div>
                  <div className="text-[14px] font-extrabold tabular-nums text-up">+{fmt(o.raises)}</div>
                  <button
                    disabled={actions.pending}
                    onClick={() =>
                      actions.perform(o.kind === "sell_building" ? { kind: "sellBuilding", spaceId: o.spaceId } : { kind: "mortgage", spaceId: o.spaceId }, { done: `${o.kind === "sell_building" ? "Sold a building on" : "Mortgaged"} ${o.name}` })
                    }
                    className="gold-btn press h-10 rounded-xl px-3.5 text-[13px]"
                  >
                    {o.kind === "sell_building" ? "Sell" : "Mortgage"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-[16px] border border-line bg-surface2 px-4 py-3 text-[13.5px] font-semibold text-ink2">Nothing left to sell or mortgage right now.</div>
          )}
          <div className="mt-3 text-[12.5px] font-semibold leading-snug text-ink3">
            Selling every building and mortgaging every property would raise {fmt(r.maxCash - me.cash)} more, for {fmt(r.maxCash)} in all.
            {game.settings.bankerMode === "bankerApproves" ? " Bank payments wait for the banker's tap." : ""}
          </div>
          {!r.canCover && (
            <div className="mt-3 rounded-[16px] border border-down px-4 py-3">
              <div className="text-[14px] font-extrabold text-down">Even selling everything won't cover it.</div>
              <button onClick={onBankrupt} className="press mt-2.5 h-11 rounded-xl border border-down px-4 text-[13px] font-bold text-down">
                Declare bankruptcy
              </button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Out of the game: to another player (they get everything) or to the bank (deeds go to auction). */
export function BankruptcySheet({ open, onClose, game, me }: { open: boolean; onClose: () => void; game: MonoGame; me: MonoPlayer }) {
  const fmt = useMoney(game);
  const gs = useGameState(game);
  const actions = useMonoActions(game);
  const others = game.players.filter((p) => p._id !== me._id && p.status === "playing");
  const [to, setTo] = useState<string | "bank" | null>(null);
  useEffect(() => {
    if (open) setTo(null);
  }, [open]);
  const parts = netWorthParts(gs, me._id);
  const creditor = others.find((p) => p._id === to);
  const submit = async () => {
    const res = await actions.declareBankruptcy(to === "bank" ? null : (to as Id<"mPlayers">));
    if (res) onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Declare bankruptcy" subtitle="You're out of the game. This can be undone by the host.">
      <div className="mt-3 text-[10.5px] font-extrabold tracking-[.16em] text-ink3">WHO IS OWED</div>
      <div className="mt-2 flex flex-wrap gap-3">
        {others.map((p) => (
          <button key={p._id} onClick={() => setTo(p._id)} aria-pressed={to === p._id} className="press flex w-[64px] flex-col items-center gap-1.5">
            <Avatar name={p.name} size={52} ring={to === p._id ? "var(--gold)" : undefined} />
            <span className={`max-w-full truncate text-xs font-bold ${to === p._id ? "text-gold-ink" : "text-ink2"}`}>{p.name}</span>
          </button>
        ))}
        <button onClick={() => setTo("bank")} aria-pressed={to === "bank"} className="press flex w-[64px] flex-col items-center gap-1.5">
          <span className="grid h-[52px] w-[52px] place-items-center rounded-full border-2 text-[11px] font-extrabold" style={{ borderColor: to === "bank" ? "var(--gold)" : "var(--line)" }}>
            BANK
          </span>
          <span className={`text-xs font-bold ${to === "bank" ? "text-gold-ink" : "text-ink2"}`}>The bank</span>
        </button>
      </div>
      {to && (
        <div className="mt-4 rounded-[16px] border border-line bg-surface2 px-4 py-3 text-[13.5px] font-semibold leading-snug">
          {to === "bank" ? (
            <>
              Your {fmt(parts.cash)} cash goes to the bank. Your properties go back to the bank unmortgaged{game.settings.auctions && game.settings.trackProperties ? " and are auctioned one by one" : ""}.
            </>
          ) : (
            <>
              Your buildings are sold to the bank at half cost, then all your cash, properties and Get Out of Jail Free cards go to {creditor?.name}. They pay 10% interest on any mortgaged property.
            </>
          )}
        </div>
      )}
      <div className="mt-4">
        <button disabled={!to || actions.pending} onClick={submit} className="press h-[58px] w-full rounded-[18px] border-2 border-down text-[16px] font-extrabold text-down disabled:opacity-40">
          {actions.pending ? "…" : to ? "Yes, I'm out" : "Choose who is owed"}
        </button>
      </div>
    </Sheet>
  );
}

/** The host ends the game early. Places start from net worth; the host moves anyone up or down before confirming. */
export function EndGameSheet({ open, onClose, game }: { open: boolean; onClose: () => void; game: MonoGame }) {
  const fmt = useMoney(game);
  const gs = useGameState(game);
  const actions = useMonoActions(game);
  const standing = game.players.filter((p) => p.status === "playing");
  const [order, setOrder] = useState<Id<"mPlayers">[]>([]);
  useEffect(() => {
    if (open) setOrder([...standing].sort((a, b) => netWorth(gs, b._id) - netWorth(gs, a._id) || a.seatOrder - b.seatOrder).map((p) => p._id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const move = (i: number, d: -1 | 1) => setOrder((o) => {
    const n = [...o];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    return n;
  });
  const out = game.players.filter((p) => p.status === "bankrupt").length;
  const { buyIn, split } = game.settings.stakes;
  let payouts: number[] = [];
  try {
    payouts = buyIn > 0 ? splitStakes(buyIn, game.players.length, split).payouts : [];
  } catch {
    payouts = [];
  }
  return (
    <Sheet open={open} onClose={onClose} title="End the game" subtitle="Set the finishing places. Net worth is the starting order.">
      <div className="mt-3 overflow-hidden rounded-[18px] border border-line">
        {order.map((pid, i) => {
          const p = game.players.find((x) => x._id === pid)!;
          const payout = payouts[i] ?? 0;
          return (
            <div key={pid} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
              <div className="font-display w-9 text-[18px] font-bold text-gold-ink">{ordinal(i + 1)}</div>
              <Avatar name={p.name} size={34} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-extrabold">{p.name}</div>
                <div className="text-[11.5px] font-semibold text-ink3">Net worth {fmt(netWorth(gs, pid))}{payout > 0 ? ` · wins ${formatReal(payout)}` : ""}</div>
              </div>
              <div className="flex gap-1">
                <button aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => move(i, -1)} className="press h-10 w-10 rounded-xl border border-line disabled:opacity-30">▲</button>
                <button aria-label={`Move ${p.name} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)} className="press h-10 w-10 rounded-xl border border-line disabled:opacity-30">▼</button>
              </div>
            </div>
          );
        })}
      </div>
      {out > 0 && <div className="mt-2 text-[12.5px] font-semibold text-ink3">{out} player{out > 1 ? "s" : ""} already out keep their places below these.</div>}
      <div className="mt-4">
        <GoldButton
          pending={actions.pending}
          onClick={async () => {
            const res = await actions.endGameEarly(order);
            if (res) onClose();
          }}
        >
          End the game
        </GoldButton>
      </div>
    </Sheet>
  );
}

/** The result: places, real-money payouts, the session settle-up, and what to do next. */
export function GameOver({ code, state, game }: { code: string; state: MonoState; game: MonoGame }) {
  const fmt = useMoney(game);
  const gs = useGameState(game);
  const convex = useConvex();
  const actions = useMonoActions(game);
  const { pending, run } = useSubmit();
  const settle = useAuthedQuery(api.report.settlement, { sessionId: state.session._id });
  const { isHost, seats } = state;
  const buyIn = game.settings.stakes.buyIn;
  const rows = [...game.players]
    .map((p) => ({ p, sm: game.summaries.find((x) => x.sessionPlayerId === p.sessionPlayerId) }))
    .sort((a, b) => (a.p.finishPosition ?? 99) - (b.p.finishPosition ?? 99));
  const winner = rows[0]?.p;
  const seatName = (id: string) => seats.find((s) => s._id === id)?.name ?? "Someone";
  const topRent = rows.reduce((m, r) => ((r.sm?.rentEarned ?? 0) > (m?.sm?.rentEarned ?? 0) ? r : m), rows[0]);

  return (
    <>
      <div className="rail mx-4 mt-4 rounded-[28px] p-2">
        <div className="felt rounded-[22px] px-5 py-[18px] text-center">
          <div className="text-[10.5px] font-extrabold tracking-[.2em] text-on-felt2">GAME {game.gameNo} OVER</div>
          <div className="font-display mt-1 text-[34px] font-bold leading-[1.1]">{winner?.name ?? "—"} wins</div>
          {buyIn > 0 && <div className="mt-1 text-[13px] font-semibold text-on-felt2">Pot {formatReal(buyIn * game.players.length)} · settled outside the app</div>}
        </div>
      </div>

      <div className="px-5 pt-[22px] text-[15px] font-extrabold">Final places</div>
      <div className="mx-4 mt-2.5 overflow-hidden rounded-[20px] border border-line bg-surface">
        {rows.map(({ p, sm }) => {
          const net = sm?.stakeNet ?? 0;
          const payout = sm ? sm.stakeNet + buyIn : 0;
          return (
            <div key={p._id} className="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0">
              <div className="font-display w-9 text-[20px] font-bold" style={{ color: p.finishPosition === 1 ? "var(--gold-ink)" : "var(--ink3)" }}>{ordinal(p.finishPosition ?? 0)}</div>
              <Avatar name={p.name} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-extrabold">{p.name}</div>
                <div className="text-[11.5px] font-semibold text-ink3">
                  {p.status === "bankrupt" ? "Went bankrupt" : `Net worth ${fmt(netWorth(gs, p._id))}`}
                  {sm && sm.rentEarned > 0 ? ` · rent earned ${fmt(sm.rentEarned)}` : ""}
                </div>
              </div>
              {buyIn > 0 && (
                <div className="text-right">
                  <div className="amount text-[17px]" style={{ color: net > 0 ? "var(--up)" : net < 0 ? "var(--down)" : "var(--ink2)" }}>
                    {net > 0 ? "+" : net < 0 ? "−" : ""}
                    {formatReal(Math.abs(net))}
                  </div>
                  <div className="text-[11px] font-semibold text-ink3">{payout > 0 ? `won ${formatReal(payout)}` : `bought in ${formatReal(buyIn)}`}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {topRent && (topRent.sm?.rentEarned ?? 0) > 0 && (
        <div className="mx-5 mt-2.5 text-[12.5px] font-semibold text-ink3">Most rent collected: {topRent.p.name}, {formatMoney(topRent.sm!.rentEarned, game.boardSnapshot.currency)}.</div>
      )}

      {settle && settle.transfers && settle.transfers.length > 0 && (
        <>
          <div className="px-5 pt-[22px] text-[15px] font-extrabold">Settle up · whole session</div>
          <div className="mx-4 mt-2.5 overflow-hidden rounded-[20px] border border-line bg-surface">
            {settle.transfers.map((t, i) => (
              <div key={i} className="flex items-center gap-2 border-b border-line px-3.5 py-3 text-[14px] font-bold last:border-b-0">
                <span className="flex-1">
                  {seatName(t.from)} → {seatName(t.to)}
                </span>
                <span className="amount text-[17px]">{formatReal(t.amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mx-4 mt-6 grid gap-2.5">
        <Link href={`/s/${code}/report`} className="press grid h-[54px] place-items-center rounded-[18px] border border-line-gold bg-surface text-[15px] font-extrabold text-gold-ink">
          Session report
        </Link>
        {isHost && (
          <>
            <GoldButton pending={pending} onClick={() => run(async () => void (await convex.mutation(api.mono.newGame, { sessionId: state.session._id })))}>
              Rematch: set up a new game
            </GoldButton>
            <button disabled={actions.pending} onClick={() => actions.reopenGame()} className="press h-11 rounded-xl border border-line text-[13px] font-bold text-ink2">
              Reopen this game (fix a mistake)
            </button>
          </>
        )}
      </div>
    </>
  );
}
