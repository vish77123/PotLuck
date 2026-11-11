import type { Currency } from "./types";

/** Game money, in the board's own currency ($ for Classic, ₹ for Business). Real stakes always use formatReal. */
export function formatMoney(amount: number, currency: Currency) {
  const sign = amount < 0 ? "−" : "";
  return `${sign}${currency}${Math.abs(amount).toLocaleString("en-IN")}`;
}

/** Real-money stakes: always rupees, so they can't be mistaken for play money. */
export function formatReal(amount: number) {
  return formatMoney(amount, "₹");
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
