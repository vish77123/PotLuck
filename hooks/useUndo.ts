"use client";

import { useConvex } from "convex/react";
import { useCallback } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSubmit } from "@/hooks/useSubmit";
import { newKey } from "@/lib/errors";
import { useUi } from "@/stores/ui";

/** Host undo: inserts a REVERSAL. The server explains in words when an undo isn't allowed (e.g. the money was already spent). */
export function useUndo() {
  const convex = useConvex();
  const { pending, run } = useSubmit();
  const pushToast = useUi((s) => s.pushToast);
  const undo = useCallback(
    (entryId: string, summary: string) =>
      run(async () => {
        await convex.mutation(api.host.undo, { entryId: entryId as Id<"ledgerEntries">, idempotencyKey: newKey() });
        pushToast({ text: `Undid ${summary}`, tone: "warn", badge: "↺" });
        return true;
      }),
    [convex, run, pushToast],
  );
  return { undo, pending };
}
