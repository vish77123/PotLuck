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
  // Real-₹ stakes of a Monopoly game. Ledger-only: they never move a wallet or a pool.
  v.literal("MONO_BUY_IN"),
  v.literal("MONO_PAYOUT"),
);

export const sessionType = v.union(v.literal("pool"), v.literal("monopoly"));

// ---- Monopoly board and rule data. Mirrors lib/monopoly/types.ts (checked by convex/monopoly.schema.test.ts). ----
export const spaceKind = v.union(
  v.literal("go"),
  v.literal("property"),
  v.literal("rail"),
  v.literal("utility"),
  v.literal("tax"),
  v.literal("card"),
  v.literal("jail"),
  v.literal("parking"),
  v.literal("gotojail"),
);

export const colourGroup = v.union(
  v.literal("brown"),
  v.literal("lblue"),
  v.literal("pink"),
  v.literal("orange"),
  v.literal("red"),
  v.literal("yellow"),
  v.literal("green"),
  v.literal("dblue"),
);

export const spaceV = v.object({
  id: v.string(),
  name: v.string(),
  kind: spaceKind,
  group: v.optional(colourGroup),
  price: v.optional(v.number()),
  // property: [base, 1 house .. 4 houses, hotel]; rail: rent by number owned [1, 2, 3, 4]
  rent: v.optional(v.array(v.number())),
  houseCost: v.optional(v.number()),
  mortgage: v.optional(v.number()),
  amount: v.optional(v.number()),
  verified: v.optional(v.boolean()),
});

export const boardV = v.object({
  key: v.string(),
  name: v.string(),
  currency: v.union(v.literal("$"), v.literal("₹")),
  spaces: v.array(spaceV),
  passGo: v.number(),
  jailFine: v.number(),
  startingCash: v.number(),
  jailCards: v.number(),
  houses: v.number(),
  hotels: v.number(),
  utilityMultipliers: v.array(v.number()),
  verified: v.optional(v.boolean()),
});

export const monoSettingsV = v.object({
  trackProperties: v.boolean(),
  bankerMode: v.union(v.literal("selfService"), v.literal("bankerApproves")),
  bankerPlayerId: v.optional(v.id("mPlayers")),
  freeParkingPot: v.boolean(),
  doubleOnGo: v.boolean(),
  auctions: v.boolean(),
  evenBuilding: v.boolean(),
  // Real ₹ stakes: buy-in per player and the payout split by finishing position (percentages, total 100).
  stakes: v.object({ buyIn: v.number(), split: v.array(v.number()) }),
});

export const monoGameStatus = v.union(
  v.literal("setup"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("ended"),
  v.literal("cancelled"),
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
    // Missing = a pool session (every session created before Monopoly existed).
    type: v.optional(sessionType),
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
    // Set on MONO_BUY_IN / MONO_PAYOUT entries (and their reversals). Deliberately not indexed: ledgerEntries is
    // a large live table, so stake entries are found through by_session_type and filtered in code.
    mGameId: v.optional(v.id("mGames")),
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

  // ---------------------------------------------------------------------------------------------
  // Monopoly sessions. All new tables; nothing above is read or written by pool sessions.
  // ---------------------------------------------------------------------------------------------

  // A crew's editable copy of a board preset. Each game snapshots it at start.
  boardConfigs: defineTable({
    crewId: v.id("crews"),
    presetKey: v.string(),
    board: boardV,
    updatedAt: v.number(),
  }).index("by_crew", ["crewId"]),

  mGames: defineTable({
    sessionId: v.id("sessions"),
    gameNo: v.number(),
    boardSnapshot: boardV,
    settings: monoSettingsV,
    // Chosen in setup, before mPlayers exist; resolved to settings.bankerPlayerId when the game starts.
    bankerSessionPlayerId: v.optional(v.id("sessionPlayers")),
    status: monoGameStatus,
    currentTurnPlayerId: v.optional(v.id("mPlayers")),
    turnNo: v.number(),
    freeParkingPot: v.number(),
    bankHouses: v.number(),
    bankHotels: v.number(),
    nextGroupNo: v.number(),
    startedAt: v.optional(v.number()),
    pausedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
  })
    .index("by_session", ["sessionId", "gameNo"])
    .index("by_session_status", ["sessionId", "status"]),

  mPlayers: defineTable({
    gameId: v.id("mGames"),
    sessionId: v.id("sessions"),
    sessionPlayerId: v.id("sessionPlayers"),
    seatOrder: v.number(),
    cash: v.number(),
    inJail: v.boolean(),
    jailTurns: v.number(),
    jailCards: v.number(),
    status: v.union(v.literal("playing"), v.literal("bankrupt")),
    finishPosition: v.optional(v.number()),
    lastPassGoTurn: v.optional(v.number()),
  })
    .index("by_game", ["gameId", "seatOrder"])
    .index("by_game_player", ["gameId", "sessionPlayerId"]),

  // One row per ownable space, created when a game with trackProperties starts.
  mPropertyStates: defineTable({
    gameId: v.id("mGames"),
    spaceId: v.string(),
    ownerPlayerId: v.union(v.id("mPlayers"), v.null()),
    houses: v.number(),
    hotel: v.boolean(),
    mortgaged: v.boolean(),
  }).index("by_game_space", ["gameId", "spaceId"]),

  // Append-only. A "group" is one user action (a trade, a bankruptcy, one payment). Parties are an mPlayers id,
  // "bank" or "pot".
  mEvents: defineTable({
    sessionId: v.id("sessions"),
    gameId: v.id("mGames"),
    groupId: v.string(),
    groupNo: v.number(),
    type: v.string(),
    fromParty: v.optional(v.string()),
    toParty: v.optional(v.string()),
    amount: v.optional(v.number()),
    spaceId: v.optional(v.string()),
    meta: v.optional(v.any()),
    label: v.optional(v.string()),
    createdBy: v.id("sessionPlayers"),
    createdAt: v.number(),
    idempotencyKey: v.optional(v.string()),
    reversesGroupId: v.optional(v.string()),
  })
    .index("by_game_group", ["gameId", "groupNo"])
    .index("by_group", ["groupId"])
    .index("by_reverses", ["reversesGroupId"]),

  // Payment requests, trade offers and banker approvals.
  mRequests: defineTable({
    sessionId: v.id("sessions"),
    gameId: v.id("mGames"),
    kind: v.union(v.literal("payment"), v.literal("trade"), v.literal("approval")),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("expired"),
      v.literal("cancelled"),
    ),
    fromPlayerId: v.id("mPlayers"),
    toPlayerId: v.optional(v.id("mPlayers")),
    amount: v.optional(v.number()),
    // payment: reason; trade: the offer and each side's acceptance; approval: the stored action {kind, args}.
    payload: v.optional(v.any()),
    createdAt: v.number(),
    expiresAt: v.number(),
    respondedAt: v.optional(v.number()),
    resultGroupId: v.optional(v.string()),
    scheduledId: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_game_status", ["gameId", "status"])
    .index("by_to", ["toPlayerId", "status"]),

  mAuctions: defineTable({
    sessionId: v.id("sessions"),
    gameId: v.id("mGames"),
    spaceId: v.string(),
    highestBid: v.number(),
    highestBidderId: v.optional(v.id("mPlayers")),
    endsAt: v.number(),
    status: v.union(v.literal("open"), v.literal("sold"), v.literal("unsold")),
    startedBy: v.id("mPlayers"),
    scheduledId: v.optional(v.id("_scheduled_functions")),
    // Bankruptcy to the bank auctions the debtor's properties one by one.
    queue: v.optional(v.array(v.string())),
    startedAt: v.number(),
  }).index("by_game_status", ["gameId", "status"]),

  // Written when a game ends, so lifetime Monopoly stats never scan events.
  mGameSummaries: defineTable({
    crewId: v.id("crews"),
    crewMemberId: v.id("crewMembers"),
    sessionId: v.id("sessions"),
    gameId: v.id("mGames"),
    sessionPlayerId: v.id("sessionPlayers"),
    endedAt: v.number(),
    finishPosition: v.number(),
    players: v.number(),
    rentEarned: v.number(),
    rentPaid: v.number(),
    stakeNet: v.number(),
  })
    .index("by_crew", ["crewId", "endedAt"])
    .index("by_member", ["crewMemberId", "endedAt"])
    .index("by_game", ["gameId"]),
});
