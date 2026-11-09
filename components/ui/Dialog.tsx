"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";

/** Centred confirm dialog on a scrim: eyebrow, title, body, optional extra, two buttons. */
export function Dialog({
  open,
  eyebrow,
  eyebrowColor = "var(--gold-ink)",
  title,
  body,
  extra,
  noLabel,
  yesLabel,
  onNo,
  onYes,
  pending,
}: {
  open: boolean;
  eyebrow: string;
  eyebrowColor?: string;
  title: string;
  body?: ReactNode;
  extra?: ReactNode;
  noLabel: string;
  yesLabel: string;
  onNo: () => void;
  onYes: () => void;
  pending?: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40 grid place-items-center px-6">
          <motion.div
            className="absolute inset-0"
            style={{ background: "var(--scrim)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onNo}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-label={title}
            className="relative w-full max-w-[420px] rounded-3xl border border-line-gold bg-surface px-5 pb-[18px] pt-[22px] text-center"
            style={{ boxShadow: "var(--sh2)" }}
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", damping: 28, stiffness: 420 }}
          >
            <div className="text-[10.5px] font-extrabold tracking-[.16em]" style={{ color: eyebrowColor }}>
              {eyebrow}
            </div>
            <div className="font-display mt-1.5 text-[28px] font-semibold leading-[1.15]">{title}</div>
            {body && <div className="mx-1 mt-2 text-sm leading-[1.45] text-ink2 text-pretty">{body}</div>}
            {extra}
            <div className="mt-[18px] grid gap-2.5" style={{ gridTemplateColumns: "1fr 1.3fr" }}>
              <button onClick={onNo} disabled={pending} className="press h-[52px] rounded-2xl border border-line bg-surface2 text-[15px] font-bold">
                {noLabel}
              </button>
              <button onClick={onYes} disabled={pending} className="gold-btn press h-[52px] rounded-2xl text-[15px]">
                {pending ? <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--on-gold)] border-t-transparent" /> : yesLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
