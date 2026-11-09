"use client";

import { useEffect, useState } from "react";
import { useUi } from "@/stores/ui";

/** Counts a number up from 0 over `ms`. Skipped entirely when animations are off. */
export function useCountUp(target: number, ms = 800) {
  const animations = useUi((s) => s.animations);
  const [value, setValue] = useState(animations === "off" ? target : 0);
  useEffect(() => {
    if (animations === "off") {
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, animations]);
  return value;
}
