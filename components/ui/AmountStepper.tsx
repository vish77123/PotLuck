"use client";

import { formatInr, parseAmount } from "@/lib/format";

/** − / amount / + control. The amount is also a number field, so big values can be typed. */
export function AmountStepper({
  value,
  onChange,
  step = 10,
  min = 0,
  max = 1_000_000,
  zeroLabel,
  size = "md",
  label,
  format = formatInr,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  zeroLabel?: string;
  size?: "md" | "lg";
  label: string;
  /** How the amount is shown. Defaults to rupees; property games pass their own currency. */
  format?: (n: number) => string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const dim = size === "lg" ? 52 : 40;
  const btn = "press grid flex-none place-items-center rounded-full border border-line bg-surface2 text-[22px] font-medium disabled:opacity-35";
  return (
    <div className="flex items-center gap-1.5">
      <button aria-label={`Decrease ${label}`} className={btn} style={{ width: dim, height: dim }} disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
        −
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        value={value === 0 && zeroLabel ? zeroLabel : format(value)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(clamp(parseAmount(e.target.value)))}
        className="amount min-w-0 bg-transparent text-center outline-none"
        style={{ width: size === "lg" ? 170 : 90, fontSize: size === "lg" ? 40 : 22, lineHeight: 1.1 }}
      />
      <button aria-label={`Increase ${label}`} className={btn} style={{ width: dim, height: dim }} disabled={value >= max} onClick={() => onChange(clamp(value + step))}>
        +
      </button>
    </div>
  );
}
