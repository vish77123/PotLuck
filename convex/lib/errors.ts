import { ConvexError } from "convex/values";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "NOT_IN_SESSION"
  | "NOT_HOST"
  | "FORBIDDEN"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_POOL"
  | "NOT_YOUR_TURN"
  | "BET_OUT_OF_RANGE"
  | "INVALID_STATE"
  | "ALREADY_REVERSED"
  | "NOT_UNDOABLE"
  | "NAME_TAKEN"
  | "IDEMPOTENCY_CONFLICT";

/** Every user-facing failure is a ConvexError carrying a code and a sentence the UI shows as-is. */
export function fail(code: ErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}
