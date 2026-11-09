"use client";

import { useCallback, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { useUi } from "@/stores/ui";

/**
 * Wraps a mutation call: ignores taps while one is in flight, and shows the server's reason on failure.
 * Returns the result, or undefined if it failed.
 */
export function useSubmit() {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    try {
      return await fn();
    } catch (err) {
      useUi.getState().pushToast({ text: errorMessage(err), tone: "error" });
      return undefined;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);
  return { pending, run };
}
