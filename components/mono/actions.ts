"use client";

import { useConvex } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useCallback } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSubmit } from "@/hooks/useSubmit";
import { useRaise } from "@/components/mono/raiseStore";
import { errorCode, errorDetail, errorMessage, newKey } from "@/lib/errors";
import { useUi } from "@/stores/ui";
import type { MonoGame } from "@/components/mono/types";

export type MonoAction = FunctionArgs<typeof api.mono.perform>["action"];
export type TradeSideInput = FunctionArgs<typeof api.mono.proposeTrade>["give"];

/** Every in-game action a phone can take. Each call carries its own idempotency key; the server explains any refusal. */
export function useMonoActions(game: MonoGame) {
  const convex = useConvex();
  const pushToast = useUi((s) => s.pushToast);
  const { pending, run } = useSubmit();

  /**
   * A payment failed because someone is short. If it's me, open the raise-money flow; if it's another player (a card that
   * collects from everyone), flag them so their phone opens it. The error toast still names who is short.
   */
  const handleShort = useCallback(
    (e: unknown) => {
      if (errorCode(e) !== "INSUFFICIENT_BALANCE") return;
      const d = errorDetail(e);
      const playerId = d?.playerId as Id<"mPlayers"> | undefined;
      const needed = typeof d?.needed === "number" ? d.needed : 0;
      if (!playerId || needed <= 0) return;
      if (playerId === game.myPlayerId) useRaise.getState().open(needed);
      else convex.mutation(api.mono.flagShort, { gameId: game._id, playerId, needed }).catch(() => {});
    },
    [convex, game._id, game.myPlayerId],
  );

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
          handleShort(e);
          throw e;
        }
      }),
    [convex, game._id, run, pushToast, handleShort],
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
        try {
          const res = await convex.mutation(api.mono.respond, { requestId, accept, idempotencyKey: newKey() });
          if (doneText) pushToast({ text: doneText });
          return res;
        } catch (e) {
          handleShort(e);
          throw e;
        }
      }),
    [convex, run, pushToast, handleShort],
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

  const proposeTrade = useCallback(
    (withPlayerId: Id<"mPlayers">, give: TradeSideInput, get: TradeSideInput) =>
      run(async () => {
        const res = await convex.mutation(api.mono.proposeTrade, { gameId: game._id, withPlayerId, give, get, idempotencyKey: newKey() });
        pushToast({ text: "Offer sent. It expires in 5 minutes.", badge: "⇄" });
        return res;
      }),
    [convex, game._id, run, pushToast],
  );

  const startAuction = useCallback(
    (spaceId: string) =>
      run(async () => {
        const res = await convex.mutation(api.mono.startAuction, { gameId: game._id, spaceId, idempotencyKey: newKey() });
        return res;
      }),
    [convex, game._id, run],
  );

  const bid = useCallback(
    (auctionId: Id<"mAuctions">, amount: number) => run(() => convex.mutation(api.mono.bid, { auctionId, amount, idempotencyKey: newKey() })),
    [convex, run],
  );

  const cancelAuction = useCallback((auctionId: Id<"mAuctions">) => run(() => convex.mutation(api.mono.cancelAuction, { auctionId })), [convex, run]);

  const declareBankruptcy = useCallback(
    (creditorId: Id<"mPlayers"> | null, playerId?: Id<"mPlayers">) =>
      run(() => convex.mutation(api.mono.declareBankruptcy, { gameId: game._id, playerId, creditorId, idempotencyKey: newKey() })),
    [convex, game._id, run],
  );

  const endGameEarly = useCallback(
    (order?: Id<"mPlayers">[]) => run(() => convex.mutation(api.mono.endGameEarly, { gameId: game._id, order, idempotencyKey: newKey() })),
    [convex, game._id, run],
  );

  const finishGame = useCallback(() => run(() => convex.mutation(api.mono.finishGame, { gameId: game._id, idempotencyKey: newKey() })), [convex, game._id, run]);
  const reopenGame = useCallback(() => run(() => convex.mutation(api.mono.reopenGame, { gameId: game._id, idempotencyKey: newKey() })), [convex, game._id, run]);
  const clearShort = useCallback(() => run(() => convex.mutation(api.mono.clearShort, { gameId: game._id })), [convex, game._id, run]);

  const cancelGame = useCallback(
    () => run(() => convex.mutation(api.mono.cancelGame, { gameId: game._id, idempotencyKey: newKey() })),
    [convex, game._id, run],
  );
  const setBanker = useCallback((playerId: Id<"mPlayers">) => run(() => convex.mutation(api.mono.setBanker, { gameId: game._id, playerId })), [convex, game._id, run]);

  return { pending, perform, requestPayment, respond, cancelRequest, endTurn, undo, cancelGame, setBanker, proposeTrade, startAuction, bid, cancelAuction, declareBankruptcy, endGameEarly, finishGame, reopenGame, clearShort };
}
