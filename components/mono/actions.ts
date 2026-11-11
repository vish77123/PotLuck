"use client";

import { useConvex } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useCallback } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSubmit } from "@/hooks/useSubmit";
import { errorCode, errorMessage, newKey } from "@/lib/errors";
import { useUi } from "@/stores/ui";
import type { MonoGame } from "@/components/mono/types";

export type MonoAction = FunctionArgs<typeof api.mono.perform>["action"];

/** Every in-game action a phone can take. Each call carries its own idempotency key; the server explains any refusal. */
export function useMonoActions(game: MonoGame) {
  const convex = useConvex();
  const pushToast = useUi((s) => s.pushToast);
  const { pending, run } = useSubmit();

  const perform = useCallback(
    (action: MonoAction, opts: { onConfirm?: (message: string) => void; done?: string } = {}) =>
      run(async () => {
        try {
          const res = await convex.mutation(api.mono.perform, { gameId: game._id, action, idempotencyKey: newKey() });
          if (res.status === "pending") {
            pushToast({ text: "Sent for approval", badge: "⏳" });
          } else if (opts.done) {
            pushToast({ text: opts.done });
          }
          return res;
        } catch (e) {
          if (errorCode(e) === "NEEDS_CONFIRM" && opts.onConfirm) {
            opts.onConfirm(errorMessage(e));
            return undefined;
          }
          throw e;
        }
      }),
    [convex, game._id, run, pushToast],
  );

  const requestPayment = useCallback(
    (fromPlayerId: Id<"mPlayers">, amount: number) =>
      run(async () => {
        const res = await convex.mutation(api.mono.requestPayment, { gameId: game._id, fromPlayerId, amount, idempotencyKey: newKey() });
        pushToast({ text: "Request sent. It expires in 5 minutes.", badge: "↗" });
        return res;
      }),
    [convex, game._id, run, pushToast],
  );

  const respond = useCallback(
    (requestId: Id<"mRequests">, accept: boolean, doneText?: string) =>
      run(async () => {
        const res = await convex.mutation(api.mono.respond, { requestId, accept, idempotencyKey: newKey() });
        if (doneText) pushToast({ text: doneText });
        return res;
      }),
    [convex, run, pushToast],
  );

  const cancelRequest = useCallback((requestId: Id<"mRequests">) => run(() => convex.mutation(api.mono.cancelRequest, { requestId })), [convex, run]);
  const endTurn = useCallback(() => run(() => convex.mutation(api.mono.endTurn, { gameId: game._id })), [convex, game._id, run]);

  const undo = useCallback(
    (groupId: string, label: string) =>
      run(async () => {
        await convex.mutation(api.mono.undo, { gameId: game._id, groupId, idempotencyKey: newKey() });
        pushToast({ text: `Undid: ${label}`, tone: "warn", badge: "↺" });
        return true;
      }),
    [convex, game._id, run, pushToast],
  );

  const cancelGame = useCallback(
    () => run(() => convex.mutation(api.mono.cancelGame, { gameId: game._id, idempotencyKey: newKey() })),
    [convex, game._id, run],
  );
  const setBanker = useCallback((playerId: Id<"mPlayers">) => run(() => convex.mutation(api.mono.setBanker, { gameId: game._id, playerId })), [convex, game._id, run]);

  return { pending, perform, requestPayment, respond, cancelRequest, endTurn, undo, cancelGame, setBanker };
}
