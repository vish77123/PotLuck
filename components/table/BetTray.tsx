"use client";

import { motion } from "framer-motion";
import type { RefObject } from "react";
import { Money } from "@/components/money/Money";
import { formatInr } from "@/lib/format";
import { COINS, NOTES, CHIPS, kindOf, takeOne, type Counts, type Theme } from "@/lib/wallet";

export type Quick = { label: string; amount: number };

type Props = {
  theme: Theme;
  counts: Counts;
  built: number[];
  /** Can the player build and place a bet right now? Otherwise the tray is dimmed. */
  canAct: boolean;
  pending: boolean;
  status: { label: string; color: string };
  limits: string;
  /** Label / amount / sub-line next to the stack. */
  readout: { label: string; amount: string; sub: string; subTone: "normal" | "warn" | "bad"; amountBad: boolean; text?: boolean };
  quick: Quick[];
  freeForm: boolean;
  poolRef: RefObject<HTMLDivElement | null>;
  hint: boolean;
  tray: "gold" | "plain";
  onAdd: (d: number) => void;
  onRemoveTop: () => void;
  onClear: () => void;
  onQuick: (amount: number) => void;
  onPack: () => void;
  onPlace: () => void;
  onHover: (over: boolean) => void;
  onTopUp?: () => void;
};

const SUB_COLOR = { normal: "var(--ink2)", warn: "var(--warn)", bad: "var(--down)" } as const;

function BuiltStack({ built, theme }: { built: number[]; theme: Theme }) {
  const chips = theme === "chips";
  const shown = built.slice(-6);
  return (
    <>
      {shown.map((v, i) => {
        const key = `${built.length - shown.length + i}-${v}`;
        if (chips) {
          return (
            <div key={key} className="absolute" style={{ left: 53, top: 30 - i * 6 }}>
              <Money kind="chip" v={v} w={44} />
            </div>
          );
        }
        return (
          <div key={key} className="absolute" style={{ left: 6 + i * 8, top: 6 + (i % 2) * 16 }}>
            <Money v={v} w={104} rot={i % 2 ? 3 : -4} />
          </div>
        );
      })}
      {built.length > 6 && (
        <div className="absolute right-1 top-1 rounded-lg bg-ink px-1.5 py-0.5 text-[10px] font-extrabold text-bg">+{built.length - 6}</div>
      )}
    </>
  );
}

export function BetTray(p: Props) {
  const chips = p.theme === "chips";
  const cells = chips ? [...CHIPS].reverse() : [...NOTES].reverse();
  const coins = [...COINS].reverse();
  const stackEmpty = p.built.length === 0;
  const dimmed = !p.canAct;

  const isOverPool = (clientX: number, clientY: number) => {
    const r = p.poolRef.current?.getBoundingClientRect();
    if (!r) return false;
    const pad = 30;
    return clientX > r.left - pad && clientX < r.right + pad && clientY > r.top - pad && clientY < r.bottom + pad;
  };

  const cell = (d: number, w: number) => {
    const n = p.counts[d] ?? 0;
    const feasible = n > 0 || takeOne(p.counts, d, p.theme) !== null;
    return (
      <button
        key={d}
        onClick={() => p.onAdd(d)}
        disabled={!p.canAct || p.pending || !feasible}
        aria-label={`Add ${formatInr(d)} ${kindOf(p.theme, d)}, ${n} left`}
        className="press relative grid h-[42px] place-items-center rounded-xl bg-surface2"
        style={{ opacity: !feasible ? 0.35 : n === 0 ? 0.7 : 1 }}
      >
        <Money kind={kindOf(p.theme, d)} v={d} w={w} />
        <div className="absolute -right-[3px] -top-[5px] rounded-[7px] bg-ink px-[5px] py-px text-[10px] font-extrabold tabular-nums text-bg">×{n}</div>
      </button>
    );
  };

  return (
    <div
      className="relative z-[1] flex flex-col gap-2 rounded-t-[26px] bg-surface px-3.5 pt-2.5"
      style={{
        borderTop: `1.5px solid ${p.tray === "gold" ? "var(--gold)" : "var(--line)"}`,
        boxShadow: p.tray === "gold" ? "0 -10px 40px rgba(241,213,144,.28)" : "0 -6px 20px rgba(0,0,0,.2)",
        paddingBottom: "max(24px, env(safe-area-inset-bottom))",
      }}
    >
      <div className="flex h-5 items-center justify-between">
        <div className="flex items-center gap-[7px] text-[11.5px] font-extrabold tracking-[.13em]" style={{ color: p.status.color }}>
          <span className="h-[7px] w-[7px] rounded-full" style={{ background: p.status.color }} />
          {p.status.label}
        </div>
        <div className="text-[11.5px] font-semibold tabular-nums text-ink3">{p.limits}</div>
      </div>

      <div className="grid h-[76px] gap-3" style={{ gridTemplateColumns: "150px minmax(0, 1fr)", opacity: dimmed ? 0.4 : 1 }}>
        <div
          className="relative rounded-2xl border-[1.5px] border-dashed bg-surface2"
          style={{ borderColor: "var(--line-gold)", boxShadow: p.hint ? "var(--glow)" : undefined }}
        >
          {stackEmpty ? (
            <div className="absolute inset-0 grid place-items-center px-3 text-center text-[11.5px] font-semibold text-ink3">
              Tap {chips ? "chips" : "notes"} to build a bet
            </div>
          ) : (
            <motion.div
              role="button"
              tabIndex={p.canAct ? 0 : -1}
              aria-label={`Bet stack ${p.readout.amount}. Swipe up to place it, tap to take one back, press Enter to place.`}
              className="absolute inset-0 touch-none outline-none"
              drag={p.canAct && !p.pending}
              dragSnapToOrigin
              dragElastic={0.25}
              dragMomentum={false}
              whileDrag={{ scale: 1.07, zIndex: 40 }}
              animate={p.pending ? { opacity: 0.55, scale: 0.96 } : { opacity: 1, scale: 1 }}
              transition={{ duration: 0.15 }}
              onDrag={(e) => {
                const pt = e as PointerEvent;
                p.onHover(isOverPool(pt.clientX, pt.clientY));
              }}
              onDragEnd={(e, info) => {
                const pt = e as PointerEvent;
                const over = isOverPool(pt.clientX, pt.clientY);
                p.onHover(false);
                if (over || info.offset.y <= -80 || info.velocity.y < -600) p.onPlace();
              }}
              onTap={() => p.canAct && !p.pending && p.onRemoveTop()}
              onKeyDown={(e) => {
                if (e.key === "Enter" && p.canAct && !p.pending) p.onPlace();
                if (e.key === "Backspace" || e.key === "Delete") p.onRemoveTop();
              }}
            >
              <BuiltStack built={p.built} theme={p.theme} />
            </motion.div>
          )}
          {!stackEmpty && !p.pending && p.canAct && (
            <button
              onClick={p.onClear}
              aria-label="Clear the bet"
              className="absolute -right-2 -top-2 z-10 grid h-6 w-6 place-items-center rounded-full border border-line bg-surface3 text-[11px] font-extrabold text-ink2"
            >
              ✕
            </button>
          )}
        </div>
        <div className="flex min-w-0 flex-col justify-center">
          <div className="text-[10.5px] font-extrabold tracking-[.14em] text-ink3">{p.readout.label}</div>
          <div
            className="amount truncate leading-[1.05]"
            style={{ fontSize: p.readout.text ? 21 : stackEmpty ? 26 : 38, color: p.readout.amountBad ? "var(--down)" : "var(--ink)" }}
          >
            {p.readout.amount}
          </div>
          <div className="text-[11.5px] font-semibold leading-[1.3]" style={{ color: SUB_COLOR[p.readout.subTone] }}>
            {p.readout.sub}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2" style={{ opacity: dimmed ? 0.4 : 1 }}>
        {p.quick.map((q) => (
          <button
            key={q.label}
            disabled={!p.canAct || p.pending}
            onClick={() => p.onQuick(q.amount)}
            className="press flex h-[46px] flex-col items-center justify-center rounded-[14px] border border-line bg-surface2 leading-[1.15]"
          >
            <span className="text-[10.5px] font-bold tracking-[.04em] text-ink2">{q.label}</span>
            <span className="text-[14.5px] font-extrabold tabular-nums">{formatInr(q.amount)}</span>
          </button>
        ))}
        {p.freeForm ? (
          <button
            disabled={!p.canAct || p.pending || stackEmpty}
            onClick={p.onClear}
            className="press grid h-[46px] place-items-center rounded-[14px] border border-line text-sm font-bold text-ink2 disabled:opacity-50"
          >
            Clear
          </button>
        ) : (
          <button
            disabled={!p.canAct || p.pending}
            onClick={p.onPack}
            className="press grid h-[46px] place-items-center rounded-[14px] border-[1.5px] border-down text-[14.5px] font-extrabold text-down"
          >
            Pack
          </button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2" style={{ opacity: dimmed ? 0.4 : 1 }}>
        {cells.map((d) => cell(d, chips ? 34 : 70))}
        {chips ? (
          p.onTopUp && (
            <button
              onClick={p.onTopUp}
              className="press col-span-2 grid h-[42px] place-items-center rounded-xl border-[1.5px] border-dashed border-line-gold text-[13px] font-extrabold text-gold-ink"
            >
              + Top up
            </button>
          )
        ) : (
          <div className="relative col-span-2 flex h-[42px] items-center justify-center gap-3 rounded-xl bg-surface2">
            {coins.map((d) => {
              const n = p.counts[d] ?? 0;
              return (
                <button
                  key={d}
                  disabled={!p.canAct || p.pending || (n === 0 && takeOne(p.counts, d, p.theme) === null)}
                  onClick={() => p.onAdd(d)}
                  aria-label={`Add ${formatInr(d)} coin, ${n} left`}
                  className="press relative grid h-[44px] w-[34px] place-items-center disabled:opacity-35"
                >
                  <Money kind="coin" v={d} w={30} />
                  <div className="absolute -right-3 -top-[7px] rounded-[7px] bg-ink px-1 py-px text-[9.5px] font-extrabold tabular-nums text-bg">×{n}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
