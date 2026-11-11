"use client";

import { useEffect, useState } from "react";
import { useMonoActions } from "@/components/mono/actions";
import { useGameState, useMoney, type MonoGame, type MonoPlayer } from "@/components/mono/types";
import { AmountStepper } from "@/components/ui/AmountStepper";
import { GoldButton, Segmented } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/Sheet";
import { ShortNotice } from "@/components/mono/MonoSheets";
import { buildingCounts } from "@/lib/monopoly/rules";

const CHIPS = [10, 20, 50, 100, 150, 200];

type Mode = "collect" | "pay" | "repairs" | "jailcard";

/** Card actions: "collect from / pay every player" as one move, repairs by the card's amounts, a Get Out of Jail Free card. */
export function CardsSheet({ open, onClose, game, me }: { open: boolean; onClose: () => void; game: MonoGame; me: MonoPlayer }) {
  const fmt = useMoney(game);
  const gs = useGameState(game);
  const actions = useMonoActions(game);
  const [mode, setMode] = useState<Mode>("collect");
  const [amount, setAmount] = useState(50);
  const [perHouse, setPerHouse] = useState(25);
  const [perHotel, setPerHotel] = useState(100);
  useEffect(() => {
    if (open) setMode("collect");
  }, [open]);

  const others = game.players.filter((p) => p._id !== me._id && p.status === "playing");
  const counts = buildingCounts(gs, me._id);
  const bill = counts.houses * perHouse + counts.hotels * perHotel;
  const payTotal = amount * others.length;
  const tracked = game.settings.trackProperties;

  const submit = async () => {
    const res =
      mode === "collect"
        ? await actions.perform({ kind: "cardEvery", direction: "collect", amount }, { done: `Collected ${fmt(amount)} from every player` })
        : mode === "pay"
          ? await actions.perform({ kind: "cardEvery", direction: "pay", amount }, { done: `Paid ${fmt(amount)} to every player` })
          : mode === "repairs"
            ? await actions.perform({ kind: "repairs", perHouse, perHotel }, { done: `Paid ${fmt(bill)} for repairs` })
            : await actions.perform({ kind: "drawJailCard" }, { done: "You hold a Get Out of Jail Free card" });
    if (res) onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Card" subtitle="Do what the card says.">
      <div className="mt-3">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "collect", label: "From all" },
            { value: "pay", label: "To all" },
            ...(tracked ? [{ value: "repairs" as const, label: "Repairs" }] : []),
            { value: "jailcard", label: "Jail-free" },
          ]}
          height={42}
        />
      </div>

      {(mode === "collect" || mode === "pay") && (
        <>
          <div className="mt-3 text-[13px] font-semibold leading-snug text-ink2">
            {mode === "collect"
              ? `Every other player pays you ${fmt(amount)}. If anyone can't afford it, nobody pays.`
              : `You pay ${fmt(amount)} to each of the other ${others.length} players, ${fmt(payTotal)} in all.`}
          </div>
          <div className="mt-4 flex justify-center">
            <AmountStepper label="Amount" value={amount} onChange={setAmount} step={10} min={0} size="lg" format={fmt} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {CHIPS.map((c) => (
              <button key={c} onClick={() => setAmount(c)} aria-pressed={amount === c} className="press h-10 rounded-[13px] border px-3.5 text-[13px] font-extrabold" style={{ borderColor: amount === c ? "var(--gold)" : "var(--line)", background: amount === c ? "var(--surface3)" : "transparent" }}>
                {fmt(c)}
              </button>
            ))}
          </div>
          {mode === "pay" && payTotal > me.cash && <ShortNotice text={`You have only ${fmt(me.cash)}. ${fmt(payTotal - me.cash)} more is needed.`} needed={payTotal} onClose={onClose} />}
        </>
      )}

      {mode === "repairs" && (
        <>
          <div className="mt-3 text-[13px] font-semibold leading-snug text-ink2">
            You have {counts.houses} house{counts.houses === 1 ? "" : "s"} and {counts.hotels} hotel{counts.hotels === 1 ? "" : "s"}. Enter the amounts on the card.
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1 text-[11px] font-extrabold tracking-[.14em] text-ink3">PER HOUSE</div>
              <AmountStepper label="Per house" value={perHouse} onChange={setPerHouse} step={5} min={0} format={fmt} />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-extrabold tracking-[.14em] text-ink3">PER HOTEL</div>
              <AmountStepper label="Per hotel" value={perHotel} onChange={setPerHotel} step={5} min={0} format={fmt} />
            </div>
          </div>
          <div className="mt-4 rounded-[16px] border border-line bg-surface2 px-4 py-3 text-[14px] font-extrabold">Your bill: {fmt(bill)}</div>
          {bill > me.cash && <ShortNotice text={`You have only ${fmt(me.cash)}. ${fmt(bill - me.cash)} more is needed.`} needed={bill} onClose={onClose} />}
          {game.settings.freeParkingPot && <div className="mt-2 text-[12.5px] font-semibold text-ink3">Goes into the Free Parking pot.</div>}
        </>
      )}

      {mode === "jailcard" && (
        <div className="mt-3 text-[13px] font-semibold leading-snug text-ink2">
          Pick up a Get Out of Jail Free card from the deck. You can keep it, use it, or trade it. Only {game.boardSnapshot.jailCards} exist.
          {me.jailCards > 0 && <span className="font-extrabold"> You hold {me.jailCards} now.</span>}
        </div>
      )}

      <div className="mt-5">
        <GoldButton
          pending={actions.pending}
          disabled={mode === "collect" || mode === "pay" ? amount <= 0 || (mode === "pay" && payTotal > me.cash) : mode === "repairs" ? bill <= 0 || bill > me.cash : false}
          onClick={submit}
        >
          {mode === "collect" ? `Collect ${fmt(amount)} from everyone` : mode === "pay" ? `Pay ${fmt(payTotal)}` : mode === "repairs" ? (bill > 0 ? `Pay ${fmt(bill)}` : "No buildings to repair") : "Take the card"}
        </GoldButton>
      </div>
    </Sheet>
  );
}

/** Go to jail, count turns, pay the fine, use a card, or leave on doubles. */
export function JailSheet({ open, onClose, game, me }: { open: boolean; onClose: () => void; game: MonoGame; me: MonoPlayer }) {
  const fmt = useMoney(game);
  const actions = useMonoActions(game);
  const fine = game.boardSnapshot.jailFine;
  const run = async (action: Parameters<typeof actions.perform>[0], done: string, close = true) => {
    const res = await actions.perform(action, { done });
    if (res && close) onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={me.inJail ? "In jail" : "Jail"} subtitle={me.inJail ? `Turn ${me.jailTurns + 1} in jail` : "Sent to jail by a card, a space or three doubles."}>
      {!me.inJail ? (
        <div className="mt-4">
          <GoldButton pending={actions.pending} onClick={() => run({ kind: "goToJail" }, "Sent to jail")}>
            Go to jail
          </GoldButton>
          <div className="mt-2 text-[12.5px] font-semibold text-ink3">You don't collect GO on the way.</div>
        </div>
      ) : (
        <div className="mt-4 grid gap-2.5">
          {me.jailTurns >= 2 && <div className="rounded-[14px] border border-line-gold bg-surface2 px-3.5 py-2.5 text-[13px] font-bold">Third turn in jail: pay the fine and move.</div>}
          <GoldButton pending={actions.pending} disabled={me.cash < fine} onClick={() => run({ kind: "payJailFine" }, `Paid the ${fmt(fine)} fine`)}>
            Pay the {fmt(fine)} fine
          </GoldButton>
          {me.cash < fine && <div className="text-[13px] font-semibold text-down">You have only {fmt(me.cash)}.</div>}
          {me.jailCards > 0 && (
            <button disabled={actions.pending} onClick={() => run({ kind: "useJailCard" }, "Used a Get Out of Jail Free card")} className="press h-14 rounded-[18px] border border-line-gold bg-surface2 text-[15px] font-extrabold">
              Use a Get Out of Jail Free card
            </button>
          )}
          <button disabled={actions.pending} onClick={() => run({ kind: "leaveJail" }, "Out of jail")} className="press h-14 rounded-[18px] border border-line bg-surface2 text-[15px] font-extrabold">
            Rolled doubles, leave
          </button>
          <button disabled={actions.pending} onClick={() => run({ kind: "jailTurn" }, "Another turn in jail", false)} className="press h-12 rounded-[16px] border border-line text-[14px] font-bold text-ink2">
            Missed doubles, count a turn
          </button>
        </div>
      )}
    </Sheet>
  );
}
