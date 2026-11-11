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
