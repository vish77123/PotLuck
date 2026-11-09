import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const entryType = v.union(
  v.literal("BUY_IN"),
  v.literal("TOP_UP"),
  v.literal("BOOT"),
  v.literal("BET"),
  v.literal("PAYOUT"),
  v.literal("LOAN"),
  v.literal("LOAN_REPAYMENT"),
  v.literal("CASH_OUT"),
  v.literal("REVERSAL"),
);

export const turnMode = v.union(v.literal("turn_based"), v.literal("free_form"));
export const teamMode = v.union(v.literal("solo"), v.literal("team"));
export const walletMode = v.union(v.literal("equal"), v.literal("custom"));
export const moneyTheme = v.union(v.literal("inr"), v.literal("chips"));

export const templateFields = {
  name: v.string(),
  boot: v.number(),
  minBet: v.number(),
  maxBet: v.optional(v.number()),
  blindSeenMultiplier: v.optional(v.number()),
  turnMode,
  teamMode,
  confirmAbove: v.optional(v.number()),
};

export const loanStatus = v.union(
  v.literal("requested"),
  v.literal("open"),
  v.literal("repaid"),
  v.literal("settled_outside"),
  v.literal("declined"),
  v.literal("reversed"),
);

export default defineSchema({
  ...authTables,

  crews: defineTable({
    name: v.string(),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
  }),

  // Which devices (auth users) may see a crew: its creator and anyone who has joined one of its sessions.
  crewAccess: defineTable({
    crewId: v.id("crews"),
    userId: v.id("users"),
    lastUsedAt: v.number(),
  })
    .index("by_user", ["userId", "lastUsedAt"])
    .index("by_crew_user", ["crewId", "userId"]),

  crewMembers: defineTable({
    crewId: v.id("crews"),
    name: v.string(),
    nameNormalized: v.string(),
    createdAt: v.number(),
  })
    .index("by_crew", ["crewId"])
    .index("by_crew_name", ["crewId", "nameNormalized"]),

  sessions: defineTable({
    crewId: v.id("crews"),
    name: v.optional(v.string()),
    code: v.string(),
    status: v.union(v.literal("lobby"), v.literal("active"), v.literal("ended")),
    walletMode,
    startingAmount: v.number(),
    theme: moneyTheme,
    hostPlayerId: v.optional(v.id("sessionPlayers")),
    hostHistory: v.array(
      v.object({
        kind: v.union(v.literal("create"), v.literal("transfer"), v.literal("claim")),
        fromPlayerId: v.optional(v.id("sessionPlayers")),
        toPlayerId: v.id("sessionPlayers"),
        at: v.number(),
      }),
    ),
    nextSeq: v.number(),
    nextGameNo: v.number(),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
  })
    .index("by_code", ["code"])
    .index("by_crew", ["crewId", "createdAt"]),

  sessionPlayers: defineTable({
    sessionId: v.id("sessions"),
    crewMemberId: v.id("crewMembers"),
    name: v.string(),
    userId: v.id("users"),
    pendingRebindUserId: v.optional(v.id("users")),
    seatNo: v.number(),
    status: v.union(v.literal("active"), v.literal("left")),
    joinedAt: v.number(),
  })
    .index("by_session", ["sessionId", "seatNo"])
    .index("by_session_user", ["sessionId", "userId"])
    .index("by_session_member", ["sessionId", "crewMemberId"])
    .index("by_user", ["userId"]),

  // Kept apart from sessionPlayers so 20s heartbeats don't invalidate getSessionState.
  presence: defineTable({
    sessionId: v.id("sessions"),
    sessionPlayerId: v.id("sessionPlayers"),
    lastSeenAt: v.number(),
  })
    .index("by_player", ["sessionPlayerId"])
    .index("by_session", ["sessionId"]),

  gameTemplates: defineTable({
    crewId: v.id("crews"),
    ...templateFields,
    archived: v.boolean(),
    createdAt: v.number(),
  }).index("by_crew", ["crewId"]),

  games: defineTable({
    sessionId: v.id("sessions"),
    gameNo: v.number(),
    templateId: v.id("gameTemplates"),
    templateSnapshot: v.object(templateFields),
    status: v.union(v.literal("active"), v.literal("ended"), v.literal("cancelled")),
    currentTurnPlayerId: v.optional(v.id("sessionPlayers")),
    turnStartedAt: v.optional(v.number()),
    turnAtEnd: v.optional(v.id("sessionPlayers")),
    poolAmount: v.number(),
    winnerPlayerIds: v.optional(v.array(v.id("sessionPlayers"))),
    winningTeamNo: v.optional(v.number()),
    remainderPlayerIds: v.optional(v.array(v.id("sessionPlayers"))),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index("by_session", ["sessionId", "gameNo"])
    .index("by_session_status", ["sessionId", "status"]),

  gameParticipants: defineTable({
    gameId: v.id("games"),
    sessionId: v.id("sessions"),
    sessionPlayerId: v.id("sessionPlayers"),
    seatOrder: v.number(),
    teamNo: v.optional(v.number()),
    status: v.union(v.literal("playing"), v.literal("packed")),
    isSeen: v.boolean(),
  })
    .index("by_game", ["gameId", "seatOrder"])
    .index("by_game_player", ["gameId", "sessionPlayerId"])
    .index("by_session_player", ["sessionId", "sessionPlayerId"]),

  // Non-money table events (pack / unpack) so the live feed can show them. The ledger stays money-only.
  gameEvents: defineTable({
    sessionId: v.id("sessions"),
    gameId: v.id("games"),
    kind: v.union(v.literal("pack"), v.literal("unpack")),
    playerId: v.id("sessionPlayers"),
    byPlayerId: v.id("sessionPlayers"),
    createdAt: v.number(),
  }).index("by_game", ["gameId", "createdAt"]),

  // Append-only. Never patched or deleted.
  ledgerEntries: defineTable({
    sessionId: v.id("sessions"),
    gameId: v.optional(v.id("games")),
    loanId: v.optional(v.id("loans")),
    seq: v.number(),
    type: entryType,
    fromPlayerId: v.optional(v.id("sessionPlayers")),
    toPlayerId: v.optional(v.id("sessionPlayers")),
    fromPool: v.boolean(),
    toPool: v.boolean(),
    amount: v.number(),
    reversesEntryId: v.optional(v.id("ledgerEntries")),
    reversesType: v.optional(entryType),
    createdByPlayerId: v.id("sessionPlayers"),
    createdAt: v.number(),
    meta: v.optional(v.any()),
    idempotencyKey: v.optional(v.string()),
  })
    .index("by_session_seq", ["sessionId", "seq"])
    .index("by_session_type", ["sessionId", "type", "seq"])
    .index("by_game", ["gameId", "seq"])
    .index("by_loan", ["loanId", "seq"])
    .index("by_reverses", ["reversesEntryId"]),

  wallets: defineTable({
    sessionId: v.id("sessions"),
    sessionPlayerId: v.id("sessionPlayers"),
    balance: v.number(),
  })
    .index("by_player", ["sessionPlayerId"])
    .index("by_session", ["sessionId"]),

  loans: defineTable({
    sessionId: v.id("sessions"),
    lenderPlayerId: v.id("sessionPlayers"),
    borrowerPlayerId: v.id("sessionPlayers"),
    amount: v.number(),
    repaidAmount: v.number(),
    status: loanStatus,
    loanEntryId: v.optional(v.id("ledgerEntries")),
    requestedAt: v.number(),
    respondedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    meta: v.optional(v.any()),
  }).index("by_session", ["sessionId", "requestedAt"]),

  idempotencyKeys: defineTable({
    key: v.string(),
    userId: v.id("users"),
    result: v.any(),
    createdAt: v.number(),
  }).index("by_key", ["key"]),

  // Written once when a session ends, so lifetime stats never scan the ledger.
  playerSessionSummaries: defineTable({
    crewId: v.id("crews"),
    crewMemberId: v.id("crewMembers"),
    sessionId: v.id("sessions"),
    sessionPlayerId: v.id("sessionPlayers"),
    endedAt: v.number(),
    net: v.number(),
    buyIn: v.number(),
    topUps: v.number(),
    gamesWon: v.number(),
    biggestPayout: v.number(),
  })
    .index("by_crew", ["crewId", "endedAt"])
    .index("by_member", ["crewMemberId", "endedAt"])
    .index("by_session", ["sessionId"]),
});
