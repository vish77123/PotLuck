"use client";

import { useEffect, useState } from "react";

/** Re-renders on an interval so "online in the last 45s" stays honest without a server clock query. */
export function useNow(everyMs = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
