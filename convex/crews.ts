import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { grantCrewAccess, requireCrewAccess, requireUser } from "./lib/access";
import { fail } from "./lib/errors";
import { assertAmount, cleanName, normalizeName } from "./lib/validators";
import { templateFields } from "./schema";

export const PRESET_TEMPLATES = [
  {
    name: "Teen Patti",
    boot: 10,
    minBet: 10,
    maxBet: 1000,
    blindSeenMultiplier: 2,
    turnMode: "turn_based",
    teamMode: "solo",
    confirmAbove: 200,
  },
  { name: "Poker", boot: 0, minBet: 10, turnMode: "turn_based", teamMode: "solo", confirmAbove: 500 },
  { name: "Sequence", boot: 50, minBet: 10, turnMode: "free_form", teamMode: "team", confirmAbove: 500 },
] as const;

export async function insertCrew(ctx: MutationCtx, userId: Id<"users">, rawName: string) {
  const name = cleanName(rawName, "Crew name");
  const crewId = await ctx.db.insert("crews", { name, createdByUserId: userId, createdAt: Date.now() });
  for (const t of PRESET_TEMPLATES) {
    await ctx.db.insert("gameTemplates", { crewId, ...t, archived: false, createdAt: Date.now() });
  }
  await grantCrewAccess(ctx, crewId, userId);
  return crewId;
}

/** Finds a crew member by name (case-insensitive) or creates one. `mustBeNew` rejects an existing name. */
export async function upsertMember(ctx: MutationCtx, crewId: Id<"crews">, rawName: string, mustBeNew: boolean) {
  const name = cleanName(rawName);
  const nameNormalized = normalizeName(name);
  const existing = await ctx.db
    .query("crewMembers")
    .withIndex("by_crew_name", (q) => q.eq("crewId", crewId).eq("nameNormalized", nameNormalized))
    .unique();
  if (existing) {
    if (mustBeNew) fail("NAME_TAKEN", `${existing.name} is already in this crew — pick it from the list.`);
    return existing;
  }
  const id = await ctx.db.insert("crewMembers", { crewId, name, nameNormalized, createdAt: Date.now() });
  return (await ctx.db.get(id))!;
}

function validateTemplate(t: {
  boot: number;
  minBet: number;
  maxBet?: number;
  blindSeenMultiplier?: number;
  confirmAbove?: number;
}) {
  assertAmount(t.boot, "Boot", { allowZero: true });
  assertAmount(t.minBet, "Minimum bet");
  if (t.maxBet !== undefined) {
    assertAmount(t.maxBet, "Maximum bet");
    if (t.maxBet < t.minBet) fail("INVALID_STATE", "Maximum bet can't be below the minimum.");
  }
  if (t.confirmAbove !== undefined) assertAmount(t.confirmAbove, "Confirm-above limit");
  if (t.blindSeenMultiplier !== undefined && !(t.blindSeenMultiplier >= 1 && t.blindSeenMultiplier <= 10)) {
    fail("INVALID_STATE", "Blind/seen multiplier must be between 1× and 10×.");
  }
}

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await requireUser(ctx);
    return await insertCrew(ctx, userId, name);
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const access = await ctx.db
      .query("crewAccess")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
    const crews = await Promise.all(access.map((a) => ctx.db.get(a.crewId)));
    return crews.filter((c) => c !== null);
  },
});

export const get = query({
  args: { crewId: v.id("crews") },
  handler: async (ctx, { crewId }) => {
    const { crew } = await requireCrewAccess(ctx, crewId);
    const members = await ctx.db
      .query("crewMembers")
      .withIndex("by_crew", (q) => q.eq("crewId", crewId))
      .collect();
    const templates = await ctx.db
      .query("gameTemplates")
      .withIndex("by_crew", (q) => q.eq("crewId", crewId))
      .collect();
    return { crew, members, templates: templates.filter((t) => !t.archived) };
  },
});

export const saveTemplate = mutation({
  args: { crewId: v.id("crews"), templateId: v.optional(v.id("gameTemplates")), ...templateFields },
  handler: async (ctx, { crewId, templateId, ...fields }) => {
    await requireCrewAccess(ctx, crewId);
    validateTemplate(fields);
    const name = cleanName(fields.name, "Template name");
    if (templateId) {
      const existing = await ctx.db.get(templateId);
      if (!existing || existing.crewId !== crewId) fail("NOT_FOUND", "Template not found.");
      // Games copy the template at start, so editing never rewrites past games.
      await ctx.db.patch(templateId, { ...fields, name });
      return templateId;
    }
    return await ctx.db.insert("gameTemplates", { crewId, ...fields, name, archived: false, createdAt: Date.now() });
  },
});

export const archiveTemplate = mutation({
  args: { templateId: v.id("gameTemplates") },
  handler: async (ctx, { templateId }) => {
    const t = await ctx.db.get(templateId);
    if (!t) fail("NOT_FOUND", "Template not found.");
    await requireCrewAccess(ctx, t.crewId);
    await ctx.db.patch(templateId, { archived: true });
  },
});
