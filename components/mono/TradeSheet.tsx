"use client";

import { useEffect, useMemo, useState } from "react";
import { useMonoActions } from "@/components/mono/actions";
import { sideText } from "@/components/mono/trade";
import { useGameState, useMoney, type MonoGame, type MonoPlayer } from "@/components/mono/types";
import { AmountStepper } from "@/components/ui/AmountStepper";
import { Avatar } from "@/components/ui/Avatar";
import { GoldButton } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/Sheet";
import { GROUP_COLOURS, groupKeyOf } from "@/lib/monopoly/colors";
import { planTrade, type TradeSide } from "@/lib/monopoly/engine";
import { interestOn, levelOf, ownedSpaces } from "@/lib/monopoly/rules";
import { RuleError } from "@/lib/monopoly/types";

type Side = { cash: number; spaceIds: string[]; jailCards: number };
const empty = (): Side => ({ cash: 0, spaceIds: [], jailCards: 0 });

/** One side of the offer: cash, the properties that can be traded, and jail cards. */
function SideEditor({
  title,
  game,
  owner,
  side,
  onChange,
  fmt,
}: {
  title: string;
  game: MonoGame;
  owner: MonoPlayer;
  side: Side;
  onChange: (s: Side) => void;
  fmt: (n: number) => string;
}) {
  const gs = useGameState(game);
  const props = game.settings.trackProperties ? ownedSpaces(gs, owner._id) : [];
  const toggle = (id: string) => onChange({ ...side, spaceIds: side.spaceIds.includes(id) ? side.spaceIds.filter((x) => x !== id) : [...side.spaceIds, id] });
  return (
    <div className="mt-4 rounded-[18px] border border-line bg-surface2 p-3.5">
      <div className="flex items-center gap-2.5">
        <Avatar name={owner.name} size={30} />
        <div className="text-[13.5px] font-extrabold">{title}</div>
        <div className="ml-auto text-[12px] font-bold text-ink3">has {fmt(owner.cash)}</div>
      </div>
      <div className="mt-3 flex justify-center">
        <AmountStepper label={`${title} cash`} value={side.cash} onChange={(cash) => onChange({ ...side, cash })} step={10} min={0} max={owner.cash} format={fmt} />
      </div>
      {props.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {props.map((s) => {
            const p = gs.props[s.id];
            const built = s.group ? game.boardSnapshot.spaces.some((m) => m.group === s.group && levelOf(gs.props[m.id]) > 0) : false;
            const on = side.spaceIds.includes(s.id);
            return (
              <button
                key={s.id}
                disabled={built}
                onClick={() => toggle(s.id)}
                aria-pressed={on}
                title={built ? "Sell the buildings in this set first" : undefined}
                className="press flex h-9 items-center gap-1.5 rounded-[11px] border px-2.5 text-[12.5px] font-bold disabled:opacity-40"
                style={{ borderColor: on ? "var(--gold)" : "var(--line)", background: on ? "var(--surface3)" : "transparent" }}
              >
                <span className="h-3 w-3 rounded-[3px]" style={{ background: GROUP_COLOURS[groupKeyOf(s)] }} />
                {s.name}
                {p.mortgaged && <span className="text-warn">· mortgaged</span>}
                {built && <span className="text-ink3">· built on</span>}
              </button>
            );
          })}
        </div>
      )}
      {owner.jailCards > 0 && (
        <div className="mt-3 flex items-center justify-between text-[13px] font-bold">
          <span>Get Out of Jail Free cards</span>
          <AmountStepper label={`${title} jail cards`} value={side.jailCards} onChange={(jailCards) => onChange({ ...side, jailCards })} step={1} min={0} max={owner.jailCards} format={(n) => String(n)} />
        </div>
      )}
    </div>
  );
}

/** Build an offer: both phones must accept, then it runs as one move. The preview uses the same rules as the server. */
export function TradeSheet({ open, onClose, game, me }: { open: boolean; onClose: () => void; game: MonoGame; me: MonoPlayer }) {
  const fmt = useMoney(game);
  const gs = useGameState(game);
  const actions = useMonoActions(game);
  const others = game.players.filter((p) => p._id !== me._id && p.status === "playing");
  const [withId, setWithId] = useState<string | null>(null);
  const [give, setGive] = useState<Side>(empty());
  const [get, setGet] = useState<Side>(empty());
  useEffect(() => {
    if (open) {
      setWithId(others.length === 1 ? others[0]._id : null);
      setGive(empty());
      setGet(empty());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const other = others.find((p) => p._id === withId);
  // Changing partner clears what was picked from their side.
  const pickPartner = (id: string) => {
    setWithId(id);
    setGet(empty());
  };

  const verdict = useMemo(() => {
    if (!other) return { ok: false as const, message: "Pick who to trade with." };
    const offer = { a: { player: me._id, ...give } as TradeSide, b: { player: other._id, ...get } as TradeSide };
    try {
      planTrade(gs, offer);
      const interest = [...give.spaceIds.map((id) => ({ id, to: other.name })), ...get.spaceIds.map((id) => ({ id, to: "you" }))].filter((x) => gs.props[x.id]?.mortgaged);
      const notes = interest.map((x) => {
        const sp = game.boardSnapshot.spaces.find((s) => s.id === x.id)!;
        return `${x.to === "you" ? "You pay" : `${x.to} pays`} ${fmt(interestOn(sp))} interest on ${sp.name}, which is mortgaged.`;
      });
      return { ok: true as const, notes };
    } catch (e) {
      return { ok: false as const, message: e instanceof RuleError ? e.message : "That trade can't be made." };
    }
  }, [other, give, get, gs, me._id, game.boardSnapshot.spaces, fmt]);

  const submit = async () => {
    if (!other) return;
    const res = await actions.proposeTrade(other._id, give, get);
    if (res) onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Trade" subtitle="Both of you must accept. Nothing moves until then.">
      <div className="mt-3 text-[10.5px] font-extrabold tracking-[.16em] text-ink3">TRADE WITH</div>
      <div className="mt-2 flex flex-wrap gap-3">
        {others.map((p) => (
          <button key={p._id} onClick={() => pickPartner(p._id)} aria-pressed={withId === p._id} className="press flex w-[64px] flex-col items-center gap-1.5">
            <Avatar name={p.name} size={52} ring={withId === p._id ? "var(--gold)" : undefined} />
            <span className={`max-w-full truncate text-xs font-bold ${withId === p._id ? "text-gold-ink" : "text-ink2"}`}>{p.name}</span>
          </button>
        ))}
      </div>
      {other && (
        <>
          <SideEditor title="You give" game={game} owner={me} side={give} onChange={setGive} fmt={fmt} />
          <SideEditor title={`${other.name} gives`} game={game} owner={other} side={get} onChange={setGet} fmt={fmt} />
          <div className="mt-4 rounded-[16px] border border-line bg-surface px-4 py-3 text-[13.5px] font-semibold leading-snug">
            <div>
              <span className="font-extrabold">You give:</span> {sideText(game, give)}
            </div>
            <div className="mt-1">
              <span className="font-extrabold">{other.name} gives:</span> {sideText(game, get)}
            </div>
            {verdict.ok && verdict.notes.map((n) => (
              <div key={n} className="mt-1.5 text-[12.5px] text-warn">
                {n}
              </div>
            ))}
          </div>
        </>
      )}
      {!verdict.ok && other && (give.cash > 0 || give.spaceIds.length > 0 || get.cash > 0 || get.spaceIds.length > 0 || give.jailCards > 0 || get.jailCards > 0) && (
        <div className="mt-2 text-[13px] font-semibold text-down">{verdict.message}</div>
      )}
      <div className="mt-4">
        <GoldButton pending={actions.pending} disabled={!verdict.ok} onClick={submit}>
          {other ? `Offer to ${other.name}` : "Pick a player"}
        </GoldButton>
      </div>
    </Sheet>
  );
}
