import { fail } from "./errors";

/** Amounts are whole rupees: safe, non-negative integers. */
export function assertAmount(n: number, label = "Amount", { allowZero = false } = {}) {
  if (!Number.isSafeInteger(n) || n < 0 || (!allowZero && n === 0)) {
    fail("INVALID_AMOUNT", `${label} must be a whole number of rupees${allowZero ? "" : " above 0"}.`);
  }
}

export function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function cleanName(name: string, label = "Name") {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (cleaned.length < 1 || cleaned.length > 24) {
    fail("INVALID_STATE", `${label} must be 1–24 characters.`);
  }
  return cleaned;
}

export function formatInr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}
