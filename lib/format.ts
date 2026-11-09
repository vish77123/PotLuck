export function formatInr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

/** Signed amount for nets: "+₹640" / "−₹310" (true minus sign) / "₹0". */
export function formatNet(n: number) {
  if (n === 0) return "₹0";
  return `${n > 0 ? "+" : "−"}${formatInr(Math.abs(n))}`;
}

export function netColor(n: number) {
  return n > 0 ? "var(--up)" : n < 0 ? "var(--down)" : "var(--ink2)";
}

/** "K7Q2PX" → "K7Q 2PX" */
export function formatCode(code: string) {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export function normalizeCode(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export function formatDay(ms: number) {
  return new Date(ms).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export function parseAmount(raw: string) {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return 0;
  return Math.min(Number(digits), 1_000_000);
}
