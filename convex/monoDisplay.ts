import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./lib/access";
import { normalizeCode } from "./sessions";

/**
 * Read-only view of a property game for a TV or laptop in the middle of the table. Like the join screen it's keyed by the
 * room code and shows only what's already public at the table: names, cash, deeds, buildings, the pot and the feed.
 */
export const view = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    await requireUser(ctx);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", normalizeCode(code)))
      .unique();
    if (!session || session.type !== "monopoly") return null;
    const game = await ctx.db
      .query("mGames")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .order("desc")
      .first();
    if (!game || game.status === "setup") {
      return { code: session.code, status: session.status, crewName: session.name ?? null, game: null };
    }
    const players = await ctx.db
      .query("mPlayers")
      .withIndex("by_game", (q) => q.eq("gameId", game._id))
      .collect();
    const props = await ctx.db
      .query("mPropertyStates")
      .withIndex("by_game_space", (q) => q.eq("gameId", game._id))
      .collect();
    const names = new Map<string, string>();
    for (const p of players) names.set(p._id, (await ctx.db.get(p.sessionPlayerId))?.name ?? "A player");
    const auction = await ctx.db
      .query("mAuctions")
      .withIndex("by_game_status", (q) => q.eq("gameId", game._id).eq("status", "open"))
      .first();
    const events = await ctx.db
      .query("mEvents")
      .withIndex("by_game_group", (q) => q.eq("gameId", game._id))
      .order("desc")
      .take(60);
    const undone = new Set(events.map((e) => e.reversesGroupId).filter((x): x is string => !!x));
    const seen = new Set<string>();
    const feed: { id: string; label: string; at: number; undone: boolean }[] = [];
    for (const e of events) {
      if (seen.has(e.groupId) || e.type === "TURN") continue;
      seen.add(e.groupId);
      feed.push({ id: e.groupId, label: e.label ?? "", at: e.createdAt, undone: undone.has(e.groupId) });
      if (feed.length >= 9) break;
    }
    return {
      code: session.code,
      status: session.status,
      crewName: session.name ?? null,
      game: {
        no: game.gameNo,
        status: game.status,
        board: {
          name: game.boardSnapshot.name,
          currency: game.boardSnapshot.currency,
          spaces: game.boardSnapshot.spaces.map((s) => ({ id: s.id, name: s.name, kind: s.kind, group: s.group ?? null, price: s.price ?? null })),
        },
        trackProperties: game.settings.trackProperties,
        freeParkingPot: game.settings.freeParkingPot,
        pot: game.freeParkingPot,
        bankHouses: game.bankHouses,
        bankHotels: game.bankHotels,
        turnId: game.currentTurnPlayerId ?? null,
        turnNo: game.turnNo,
        buyIn: game.settings.stakes.buyIn,
        players: players
          .sort((a, b) => a.seatOrder - b.seatOrder)
          .map((p) => ({ id: p._id, name: names.get(p._id)!, cash: p.cash, inJail: p.inJail, bankrupt: p.status === "bankrupt", position: p.finishPosition ?? null })),
        props: props.map((p) => ({ spaceId: p.spaceId, owner: p.ownerPlayerId, houses: p.houses, hotel: p.hotel, mortgaged: p.mortgaged })),
        auction: auction ? { spaceId: auction.spaceId, highestBid: auction.highestBid, bidder: auction.highestBidderId ? (names.get(auction.highestBidderId) ?? null) : null, endsAt: auction.endsAt } : null,
      },
      feed,
    };
  },
});
