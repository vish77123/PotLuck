"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Money } from "@/components/money/Money";
import { useUi } from "@/stores/ui";

export type Flight = { id: string; from: { x: number; y: number }; to: { x: number; y: number }; value: number; chips: boolean };

/**
 * A note or chip flying between a seat and the pool: 420ms on an arc into the pool, 320ms back out on undo.
 * "Reduced" swaps the flight for a short fade at the pool; "Off" draws nothing.
 */
export function FlightLayer({ flights, onDone }: { flights: Flight[]; onDone: (id: string) => void }) {
  const mode = useUi((s) => s.animations);
  if (mode === "off") return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[5]" aria-hidden>
      <AnimatePresence>
        {flights.map((f) => (
          <motion.div
            key={f.id}
            className="absolute"
            initial={mode === "reduced" ? { left: `${f.to.x}%`, top: `${f.to.y}%`, opacity: 0, scale: 0.9, x: "-50%", y: "-50%" } : { left: `${f.from.x}%`, top: `${f.from.y}%`, opacity: 0, rotate: -20, scale: 1, x: "-50%", y: "-50%" }}
            animate={
              mode === "reduced"
                ? { opacity: [0, 1, 0], transition: { duration: 0.3 } }
                : { left: `${f.to.x}%`, top: [`${f.from.y}%`, `${Math.min(f.from.y, f.to.y) - 12}%`, `${f.to.y}%`], opacity: [0, 1, 1, 0], rotate: 4, scale: 0.8, transition: { duration: 0.42, ease: [0.3, 0.7, 0.2, 1] } }
            }
            onAnimationComplete={() => onDone(f.id)}
          >
            <Money kind={f.chips ? "chip" : f.value < 10 ? "coin" : "note"} v={f.value} w={f.chips ? 34 : f.value < 10 ? 28 : 58} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
