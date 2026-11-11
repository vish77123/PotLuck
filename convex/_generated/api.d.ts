/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as crews from "../crews.js";
import type * as display from "../display.js";
import type * as games from "../games.js";
import type * as host from "../host.js";
import type * as http from "../http.js";
import type * as invariants from "../invariants.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_game from "../lib/game.js";
import type * as lib_ledger from "../lib/ledger.js";
import type * as lib_mono from "../lib/mono.js";
import type * as lib_nets from "../lib/nets.js";
import type * as lib_validators from "../lib/validators.js";
import type * as loans from "../loans.js";
import type * as mono from "../mono.js";
import type * as monoBoards from "../monoBoards.js";
import type * as monoStats from "../monoStats.js";
import type * as presence from "../presence.js";
import type * as report from "../report.js";
import type * as sessions from "../sessions.js";
import type * as stats from "../stats.js";
import type * as wallet from "../wallet.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  crews: typeof crews;
  display: typeof display;
  games: typeof games;
  host: typeof host;
  http: typeof http;
  invariants: typeof invariants;
  "lib/access": typeof lib_access;
  "lib/errors": typeof lib_errors;
  "lib/game": typeof lib_game;
  "lib/ledger": typeof lib_ledger;
  "lib/mono": typeof lib_mono;
  "lib/nets": typeof lib_nets;
  "lib/validators": typeof lib_validators;
  loans: typeof loans;
  mono: typeof mono;
  monoBoards: typeof monoBoards;
  monoStats: typeof monoStats;
  presence: typeof presence;
  report: typeof report;
  sessions: typeof sessions;
  stats: typeof stats;
  wallet: typeof wallet;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
