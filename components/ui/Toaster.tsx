"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useUi } from "@/stores/ui";

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-4"
      style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
      aria-live="polite"
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            onClick={() => dismiss(t.id)}
            className="pointer-events-auto flex min-h-[44px] max-w-[420px] items-center gap-2.5 rounded-[14px] bg-surface3 px-3 py-2 text-left text-[13px]"
            style={{
              boxShadow: "var(--sh1)",
              border: t.tone === "error" ? "1px solid var(--down)" : t.tone === "warn" ? "1px solid var(--line-gold)" : undefined,
            }}
          >
            {t.tone === "error" && (
              <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-down text-[13px] font-extrabold text-white">!</span>
            )}
            {t.badge && (
              <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-warn text-[13px] font-extrabold text-on-gold">
                {t.badge}
              </span>
            )}
            <span className="flex-1 font-semibold leading-snug">{t.text}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
