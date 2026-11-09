"use client";

import { useConvex } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const HEARTBEAT_MS = 20_000;
export const ONLINE_WINDOW_MS = 45_000;

/** Pings every 20s while the app is visible, and once right away when it comes back to the foreground. */
export function usePresenceHeartbeat(sessionId: Id<"sessions"> | undefined) {
  const convex = useConvex();
  useEffect(() => {
    if (!sessionId) return;
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      convex.mutation(api.presence.heartbeat, { sessionId }).catch(() => {});
    };
    ping();
    const id = setInterval(ping, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [convex, sessionId]);
}
