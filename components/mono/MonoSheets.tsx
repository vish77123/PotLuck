"use client";

import { useEffect, useState } from "react";
import { useMonoActions } from "@/components/mono/actions";
import { useMoney, type MonoGame, type MonoPlayer } from "@/components/mono/types";
import { AmountStepper } from "@/components/ui/AmountStepper";
import { Avatar } from "@/components/ui/Avatar";
import { GoldButton } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/Sheet";
import { useRaise } from "@/components/mono/raiseStore";

const CHIPS = [10, 20, 50, 100, 200, 500];

/** "You have only $X": a dead end turned into the raise-money flow. Closes the sheet it's in first. */
export function ShortNotice({ text, needed, onClose }: { text: string; needed: number; onClose: () => void }) {
  return (
    <div className="mt-3 rounded-[14px] border border-down px-3.5 py-2.5">
      <div className="text-[13px] font-semibold text-down">{text}</div>
      <button
        onClick={() => {
          onClose();
          useRaise.getState().open(needed);
        }}
        className="press mt-2 h-9 rounded-lg border border-down px-3 text-[12.5px] font-bold text-down"
      >
        Raise money
      </button>
    </div>
  );
}

function Chips({ value, onPick, fmt }: { value: number; onPick: (n: number) => void; fmt: (n: number) => string }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {CHIPS.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          aria-pressed={value === c}
          className="press h-10 rounded-[13px] border px-3.5 text-[13px] font-extrabold"
          style={{ borderColor: value === c ? "var(--gold)" : "var(--line)", background: value === c ? "var(--surface3)" : "transparent" }}
        >
          {fmt(c)}
        </button>
      ))}
    </div>
  );
}

function PlayerPick({ players, value, onPick }: { players: MonoPlayer[]; value: string | null; onPick: (id: string) => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-3">
      {players.map((p) => (
        <button key={p._id} onClick={() => onPick(p._id)} aria-pressed={value === p._id} className="press flex w-[64px] flex-col items-center gap-1.5">
          <Avatar name={p.name} size={52} ring={value === p._id ? "var(--gold)" : undefined} />
          <span className={`max-w-full truncate text-xs font-bold ${value === p._id ? "text-gold-ink" : "text-ink2"}`}>{p.name}</span>
        </button>
      ))}
    </div>
  );
}

/** Pay another player now, or ask them to pay me (they approve or decline within 5 minutes). */
export function PaySheet({
  open,
  onClose,
  game,
  mode,
  me,
}: {
  open: boolean;
  onClose: () => void;
  game: MonoGame;
  mode: "pay" | "request";
  me: MonoPlayer;
}) {
  const fmt = useMoney(game);
  const actions = useMonoActions(game);
  const others = game.players.filter((p) => p._id !== me._id && p.status === "playing");
  const [who, setWho] = useState<string | null>(null);
  const [amount, setAmount] = useState(100);
  useEffect(() => {
    if (open) {
      setWho(others.length === 1 ? others[0]._id : null);
      setAmount(100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const target = others.find((p) => p._id === who);
  const short = mode === "pay" && amount > me.cash;
  const submit = async () => {
    if (!target) return;
    const ok =
      mode === "pay"
        ? await actions.perform({ kind: "pay", toPlayerId: target._id, amount }, { done: `Paid ${target.name} ${fmt(amount)}` })
        : await actions.requestPayment(target._id, amount);
    if (ok) onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === "pay" ? "Pay a player" : "Request money"}
      subtitle={mode === "pay" ? `You have ${fmt(me.cash)}` : "They approve or decline. It expires in 5 minutes."}
    >
      <div className="mt-3 text-[10.5px] font-extrabold tracking-[.16em] text-ink3">{mode === "pay" ? "PAY TO" : "ASK"}</div>
      <PlayerPick players={others} value={who} onPick={setWho} />
      <div className="mt-5 flex justify-center">
        <AmountStepper label="Amount" value={amount} onChange={setAmount} step={10} min={0} size="lg" format={fmt} />
      </div>
      <Chips value={amount} onPick={setAmount} fmt={fmt} />
      {short && <ShortNotice text={`You have only ${fmt(me.cash)}. ${fmt(amount - me.cash)} more is needed.`} needed={amount} onClose={onClose} />}
      <div className="mt-4">
        <GoldButton pending={actions.pending} disabled={!target || amount <= 0 || short} onClick={submit}>
          {!target ? "Pick a player" : mode === "pay" ? `Pay ${target.name} ${fmt(amount)}` : `Ask ${target.name} for ${fmt(amount)}`}
        </GoldButton>
      </div>
    </Sheet>
  );
}

const PAY_REASONS = [
  { v: "tax", label: "Tax" },
  { v: "card", label: "Card" },
  { v: "bank", label: "Other" },
] as const;

/** Money from the bank, or to it. Taxes, fines and card payments go into the Free Parking pot when that rule is on. */
export function BankSheet({
  open,
  onClose,
  game,
  mode,
  me,
  canActForOthers,
}: {
  open: boolean;
  onClose: () => void;
  game: MonoGame;
  mode: "collect" | "pay";
  me: MonoPlayer;
  canActForOthers: boolean;
}) {
  const fmt = useMoney(game);
  const actions = useMonoActions(game);
  const playing = game.players.filter((p) => p.status === "playing");
  const [who, setWho] = useState<string>(me._id);
  const [amount, setAmount] = useState(100);
  const [reason, setReason] = useState<"tax" | "card" | "bank">("tax");
  useEffect(() => {
    if (open) {
      setWho(me._id);
      setAmount(100);
      setReason(mode === "pay" ? "tax" : "bank");
    }
  }, [open, mode, me._id]);
  const target = playing.find((p) => p._id === who) ?? me;
  const approval = game.settings.bankerMode === "bankerApproves";
  const toPot = mode === "pay" && game.settings.freeParkingPot && reason !== "bank";
  const short = mode === "pay" && amount > target.cash;
  const submit = async () => {
    const id = target._id as typeof me._id;
    const res =
      mode === "pay"
        ? await actions.perform({ kind: "bankPay", playerId: id, amount, reason }, { done: `${target.name} paid ${toPot ? "the pot" : "the bank"} ${fmt(amount)}` })
        : await actions.perform({ kind: "bankCollect", playerId: id, amount }, { done: `${target.name} collected ${fmt(amount)}` });
    if (res) onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === "pay" ? "Pay the bank" : "Collect from the bank"}
      subtitle={approval ? "Waits for the banker's tap." : toPot ? "Goes into the Free Parking pot." : undefined}
    >
      {canActForOthers && (
        <>
          <div className="mt-3 text-[10.5px] font-extrabold tracking-[.16em] text-ink3">FOR</div>
          <PlayerPick players={playing} value={who} onPick={setWho} />
        </>
      )}
      {mode === "pay" && (
        <div className="mt-4 flex gap-2">
          {PAY_REASONS.map((r) => (
            <button
              key={r.v}
              onClick={() => setReason(r.v)}
              aria-pressed={reason === r.v}
              className="press h-10 rounded-[13px] border px-4 text-[13px] font-extrabold"
              style={{ borderColor: reason === r.v ? "var(--gold)" : "var(--line)", background: reason === r.v ? "var(--surface3)" : "transparent" }}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
      <div className="mt-5 flex justify-center">
        <AmountStepper label="Amount" value={amount} onChange={setAmount} step={10} min={0} size="lg" format={fmt} />
      </div>
      <Chips value={amount} onPick={setAmount} fmt={fmt} />
      {short && target._id === me._id && <ShortNotice text={`You have only ${fmt(me.cash)}. ${fmt(amount - me.cash)} more is needed.`} needed={amount} onClose={onClose} />}
      {short && target._id !== me._id && <div className="mt-3 rounded-[14px] border border-down px-3.5 py-2.5 text-[13px] font-semibold text-down">{target.name} has only {fmt(target.cash)}. {fmt(amount - target.cash)} more is needed.</div>}
      <div className="mt-4">
        <GoldButton pending={actions.pending} disabled={amount <= 0 || short} onClick={submit}>
          {mode === "pay" ? `Pay ${fmt(amount)}` : `Collect ${fmt(amount)}`}
        </GoldButton>
      </div>
    </Sheet>
  );
}

/** Pass GO. With double-on-GO the player says whether they passed or landed exactly. */
export function GoSheet({ open, onClose, game, me }: { open: boolean; onClose: () => void; game: MonoGame; me: MonoPlayer }) {
  const fmt = useMoney(game);
  const actions = useMonoActions(game);
  const [confirm, setConfirm] = useState<{ message: string; landed: boolean } | null>(null);
  const pass = game.boardSnapshot.passGo;
  const go = async (landed: boolean, confirmRepeat = false) => {
    const res = await actions.perform(
      { kind: "passGo", landedExactly: landed, confirmRepeat },
      { done: `Collected ${fmt(landed && game.settings.doubleOnGo ? pass * 2 : pass)} for GO`, onConfirm: (message) => setConfirm({ message, landed }) },
    );
    if (res) {
      setConfirm(null);
      onClose();
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Pass GO" subtitle={`${me.name} · ${fmt(me.cash)} now`}>
      {confirm ? (
        <>
          <div className="mt-3 rounded-[16px] border border-line-gold bg-surface2 p-4 text-sm font-semibold leading-snug">{confirm.message}</div>
          <div className="mt-4 grid gap-2.5">
            <GoldButton pending={actions.pending} onClick={() => go(confirm.landed, true)}>
              Collect again
            </GoldButton>
            <button onClick={() => setConfirm(null)} className="press h-12 rounded-2xl border border-line text-sm font-bold">
              Not this time
            </button>
          </div>
        </>
      ) : (
        <div className="mt-4 grid gap-2.5">
          <GoldButton pending={actions.pending} onClick={() => go(false)}>
            Passed GO · +{fmt(pass)}
          </GoldButton>
          {game.settings.doubleOnGo && (
            <button disabled={actions.pending} onClick={() => go(true)} className="press h-14 rounded-[18px] border border-line-gold bg-surface2 text-[15px] font-extrabold">
              Landed exactly on GO · +{fmt(pass * 2)}
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
