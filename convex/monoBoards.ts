import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireCrewAccess } from "./lib/access";
import { fail } from "./lib/errors";
import { boardV } from "./schema";
import { PRESETS, presetByKey } from "../lib/monopoly/presets";
import { boardProblems } from "../lib/monopoly/rules";
import type { BoardConfig } from "../lib/monopoly/types";

async function savedRow(ctx: QueryCtx, crewId: Id<"crews">, presetKey: string) {
  const rows = await ctx.db
    .query("boardConfigs")
    .withIndex("by_crew", (q) => q.eq("crewId", crewId))
    .take(20);
  return rows.find((r) => r.presetKey === presetKey) ?? null;
}

/** The board a crew plays on for a preset: its corrected copy if it has one, otherwise the shipped preset. */
export async function crewBoard(ctx: QueryCtx, crewId: Id<"crews">, presetKey: string): Promise<BoardConfig> {
  if (!PRESETS[presetKey]) fail("INVALID_STATE", "Pick a board.");
  const saved = await savedRow(ctx, crewId, presetKey);
  return saved ? structuredClone(saved.board) : presetByKey(presetKey);
}

/** Every preset with the crew's version (or the default), for the board editor. */
export const list = query({
  args: { crewId: v.id("crews") },
  handler: async (ctx, { crewId }) => {
    const { crew } = await requireCrewAccess(ctx, crewId);
    const rows = await ctx.db
      .query("boardConfigs")
      .withIndex("by_crew", (q) => q.eq("crewId", crewId))
      .take(20);
    return {
      crewName: crew.name,
      boards: Object.keys(PRESETS).map((key) => {
        const saved = rows.find((r) => r.presetKey === key);
        return { key, saved: !!saved, updatedAt: saved?.updatedAt ?? null, board: saved ? saved.board : PRESETS[key] };
      }),
    };
  },
});

/** Games still in setup pick up a corrected board straight away; a game that has started keeps the snapshot it began with. */
async function refreshSetupGames(ctx: MutationCtx, crewId: Id<"crews">, oldBoard: BoardConfig, next: BoardConfig) {
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_crew", (q) => q.eq("crewId", crewId))
    .order("desc")
    .take(50);
  for (const s of sessions) {
    if (s.type !== "monopoly" || s.status === "ended") continue;
    const games = await ctx.db
      .query("mGames")
      .withIndex("by_session_status", (q) => q.eq("sessionId", s._id).eq("status", "setup"))
      .collect();
    for (const g of games) {
      if (g.boardSnapshot.key !== next.key) continue;
      // Keep a starting cash the host chose in the lobby; otherwise follow the corrected board.
      const hostChoseCash = g.boardSnapshot.startingCash !== oldBoard.startingCash;
      await ctx.db.patch(g._id, {
        boardSnapshot: { ...next, startingCash: hostChoseCash ? g.boardSnapshot.startingCash : next.startingCash },
        bankHouses: next.houses,
        bankHotels: next.hotels,
      });
    }
  }
}

/** Saves the crew's corrected copy of a board. Anyone in the crew can; a game that has started is never changed. */
export const save = mutation({
  args: { crewId: v.id("crews"), presetKey: v.string(), board: boardV },
  handler: async (ctx, { crewId, presetKey, board }) => {
    await requireCrewAccess(ctx, crewId);
    if (!PRESETS[presetKey]) fail("INVALID_STATE", "Pick a board.");
    if (board.key !== presetKey) fail("INVALID_STATE", "That board doesn't match the preset.");
    const problems = boardProblems(board);
    if (problems.length) fail("INVALID_STATE", problems.slice(0, 3).join(" "));
    const old = await crewBoard(ctx, crewId, presetKey);
    const existing = await savedRow(ctx, crewId, presetKey);
    if (existing) await ctx.db.patch(existing._id, { board, updatedAt: Date.now() });
    else await ctx.db.insert("boardConfigs", { crewId, presetKey, board, updatedAt: Date.now() });
    await refreshSetupGames(ctx, crewId, old, board);
    return null;
  },
});

/** Throws away the crew's corrections and goes back to the shipped preset. */
export const reset = mutation({
  args: { crewId: v.id("crews"), presetKey: v.string() },
  handler: async (ctx, { crewId, presetKey }) => {
    await requireCrewAccess(ctx, crewId);
    if (!PRESETS[presetKey]) fail("INVALID_STATE", "Pick a board.");
    const old = await crewBoard(ctx, crewId, presetKey);
    const existing = await savedRow(ctx, crewId, presetKey);
    if (existing) await ctx.db.delete(existing._id);
    await refreshSetupGames(ctx, crewId, old, presetByKey(presetKey));
    return null;
  },
});
