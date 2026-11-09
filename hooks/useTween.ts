"use client";

import { useEffect, useRef, useState } from "react";
import { useUi } from "@/stores/ui";

/** Eases a number from its previous value to the new one (pool count-up). Off → jumps straight there. */
export function useTween(target: number, ms = 300) {
  const animations = useUi((s) => s.animations);
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (animations === "off" || from.current === target) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const v = Math.round(a + (target - a) * (1 - Math.pow(1 - t, 3)));
      from.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, animations]);
  return value;
}
