import { ConvexError } from "convex/values";

/** Server rules throw ConvexError({code, message}); the message is written to be shown as-is. */
export function errorMessage(err: unknown): string {
  if (err instanceof ConvexError) {
    const data = err.data as unknown;
    if (typeof data === "string") return data;
    if (data && typeof data === "object" && "message" in data && typeof data.message === "string") return data.message;
  }
  return "Something went wrong. Check your connection and try again.";
}

export function errorCode(err: unknown): string | null {
  if (err instanceof ConvexError) {
    const data = err.data as unknown;
    if (data && typeof data === "object" && "code" in data && typeof data.code === "string") return data.code;
  }
  return null;
}

export function newKey() {
  return crypto.randomUUID();
}
