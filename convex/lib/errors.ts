import { ConvexError, type Value } from "convex/values";

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
  | "IDEMPOTENCY_CONFLICT"
  | "NEEDS_CONFIRM"
  | "WRONG_SESSION_TYPE";

/**
 * Every user-facing failure is a ConvexError carrying a code and a sentence the UI shows as-is.
 * `detail` carries structured data for the UI (e.g. who is short of cash and by how much).
 */
export function fail(code: ErrorCode, message: string, detail?: Record<string, Value>): never {
  throw new ConvexError(detail ? { code, message, detail } : { code, message });
}
