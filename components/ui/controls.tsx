"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export function BackButton({ href, onClick, label = "Back" }: { href?: string; onClick?: () => void; label?: string }) {
  const cls = "grid h-11 w-11 flex-none place-items-center rounded-full border border-line bg-surface press";
  const icon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
  return href ? (
    <Link href={href} aria-label={label} className={cls}>
      {icon}
    </Link>
  ) : (
    <button onClick={onClick} aria-label={label} className={cls}>
      {icon}
    </button>
  );
}

/** Segmented control: the selected option is a raised surface chip. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  height = 40,
  disabled,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  height?: number;
  disabled?: boolean;
}) {
  return (
    <div
      className="grid rounded-[14px] bg-surface3 p-[3px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`, opacity: disabled ? 0.5 : 1 }}
      role="radiogroup"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`grid place-items-center rounded-[11px] text-[13.5px] transition-colors ${on ? "bg-surface font-extrabold" : "font-bold text-ink2"}`}
            style={{ height, boxShadow: on ? "var(--sh1)" : undefined }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="relative h-8 w-[52px] flex-none rounded-2xl transition-colors"
      style={{ background: on ? "var(--gold)" : "var(--surface3)" }}
    >
      <span
        className="absolute top-[3px] h-[26px] w-[26px] rounded-full bg-[#fffaf0] transition-[left]"
        style={{ left: on ? 23 : 3, boxShadow: "0 1px 3px rgba(0,0,0,.3)" }}
      />
    </button>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between px-5 pt-[22px]">
      <h2 className="text-base font-extrabold">{children}</h2>
      {action}
    </div>
  );
}

export function GoldButton({
  children,
  onClick,
  disabled,
  pending,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  pending?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || pending}
      className={`gold-btn grid h-[58px] w-full place-items-center rounded-[18px] text-[16.5px] ${className}`}
    >
      {pending ? <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--on-gold)] border-t-transparent" /> : children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`press grid h-12 place-items-center rounded-2xl border border-line bg-surface2 text-sm font-bold disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  maxLength = 24,
  autoFocus,
  label,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  label: string;
  onEnter?: () => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-extrabold tracking-[.14em] text-ink3">{label.toUpperCase()}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCapitalize="words"
        className="mt-1 block h-[52px] w-full rounded-[14px] border border-line bg-surface2 px-4 font-display text-[22px] font-semibold outline-none placeholder:text-ink3 focus:border-gold"
      />
    </label>
  );
}
