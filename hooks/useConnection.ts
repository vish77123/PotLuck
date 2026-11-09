"use client";

import { useConvexConnectionState } from "convex/react";
import { useEffect, useState } from "react";

/**
 * "Reconnecting" only after the socket has been down for a moment, so the first load and quick
 * blips don't flash a banner. Bets are paused while this is true.
 */
export function useConnection() {
  const cs = useConvexConnectionState();
  const down = cs.hasEverConnected && !cs.isWebSocketConnected;
  const [grace, setGrace] = useState(false);
  useEffect(() => {
    if (!down) {
      setGrace(false);
      return;
    }
    const id = setTimeout(() => setGrace(true), 1200);
    return () => clearTimeout(id);
  }, [down]);
  return { reconnecting: down && grace, retries: cs.connectionRetries };
}
