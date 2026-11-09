import { v } from "convex/values";
import { query } from "./_generated/server";
import { requirePlayer } from "./lib/access";
import { computeNets } from "./lib/nets";
import { settleUp } from "../lib/settle";

/** Per-player nets and the settle-up list. Used live in the wallet and in the report. */
export const settlement = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    await requirePlayer(ctx, sessionId);
    const nets = await computeNets(ctx, sessionId);
    const total = nets.reduce((s, n) => s + n.net, 0);
    // While a game is open its pool belongs to nobody yet, so nets don't balance; no transfers until it closes.
    const transfers = total === 0 ? settleUp(nets.map((n) => ({ id: n.playerId, net: n.net }))) : null;
    return { nets, transfers };
  },
});
