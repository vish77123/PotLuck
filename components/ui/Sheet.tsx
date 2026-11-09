"use client";

import { AnimatePresence, motion, useDragControls, useReducedMotion } from "framer-motion";
import { useEffect } from "react";
import { useUi } from "@/stores/ui";

/** Bottom sheet: radius 28, 40×5 handle, scrim, tap outside or drag down to dismiss. */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const animations = useUi((s) => s.animations);
  const dragControls = useDragControls();
  const systemReduced = useReducedMotion();
  const instant = animations === "off" || systemReduced;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40">
          <motion.div
            className="absolute inset-0"
            style={{ background: "var(--scrim)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: instant ? 0 : 0.18 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="absolute inset-x-0 bottom-0 mx-auto max-h-[92dvh] w-full max-w-[520px] overflow-y-auto rounded-t-[28px] bg-surface px-[18px] pb-[30px] pt-[10px]"
            style={{ boxShadow: "var(--sh2)" }}
            initial={{ y: instant ? 0 : "100%" }}
            animate={{ y: 0 }}
            exit={{ y: instant ? 0 : "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 380 }}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => (info.offset.y > 90 || info.velocity.y > 600) && onClose()}
          >
            {/* Only the grab area drags the sheet, so scrolling and inner drags (seat reorder) stay free. */}
            <div className="touch-none" onPointerDown={(e) => dragControls.start(e)}>
              <div className="mx-auto mb-3 h-[5px] w-10 rounded-[3px] bg-line" />
              {title && <div className="font-display text-[26px] font-semibold">{title}</div>}
              {subtitle && <div className="mt-0.5 text-[13px] text-ink3">{subtitle}</div>}
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
