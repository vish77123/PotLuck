import type { Doc } from "@/convex/_generated/dataModel";
import { formatInr } from "@/lib/format";

type Entry = Doc<"ledgerEntries">;
type GameEvent = Doc<"gameEvents">;

export type FeedRow = {
  key: string;
  entryId?: string;
  who: string;
  label: string;
  amount: number | null;
  at: number;
  /** Set when a later REVERSAL undid this entry. */
  undone?: { text: string; at: number };
  /** Rows the host can long-press to undo. */
  undoable: boolean;
};

const UNDOABLE = new Set(["BOOT", "BET", "TOP_UP", "LOAN", "LOAN_REPAYMENT"]);

export function clock(ms: number) {
  return new Date(ms).toLocaleTimeString("en-GB", { hour12: false });
}

export function ago(ms: number, now: number) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : clock(ms).slice(0, 5);
}

export function entryLabel(e: Entry, blindSeen: boolean) {
  switch (e.type) {
    case "BOOT":
      return "Boot";
    case "BET":
      return e.meta?.seen ? "Seen bet" : blindSeen ? "Blind bet" : "Bet";
    case "PAYOUT":
      return e.meta?.gotRemainder ? "Won pot · +₹1 dice" : "Won the pot";
    case "TOP_UP":
      return "Top-up";
    case "BUY_IN":
      return "Buy-in";
    case "CASH_OUT":
      return "Cash-out";
    case "LOAN":
      return "Loan";
    case "LOAN_REPAYMENT":
      return "Loan repayment";
    default:
      return e.type;
  }
}

function reversalText(r: Entry, names: (id?: string) => string) {
  const reason = r.meta?.reason as string | undefined;
  if (reason === "game_cancelled") return "↺ Refunded when the game was cancelled";
  if (reason === "game_reopened") return "↺ Payout reversed when the game was reopened";
  if (reason === "buy_in_edit") return "↺ Buy-in changed by the host";
  return `↺ Undone by ${r.meta?.undoneByName ?? "the host"} (host) · ${formatInr(r.amount)} back to ${names(r.toPlayerId)}`;
}

/**
 * Newest-first rows from ledger entries and pack events. A REVERSAL isn't its own row: it hangs
 * under the entry it undid, which is shown struck through.
 */
export function buildFeed(
  entries: Entry[],
  events: GameEvent[],
  names: (id?: string) => string,
  blindSeen: boolean,
): FeedRow[] {
  const reversals = new Map<string, Entry>();
  for (const e of entries) if (e.type === "REVERSAL" && e.reversesEntryId) reversals.set(e.reversesEntryId, e);

  const rows: FeedRow[] = [];
  for (const e of entries) {
    if (e.type === "REVERSAL") continue;
    const r = reversals.get(e._id);
    rows.push({
      key: e._id,
      entryId: e._id,
      who: names(e.type === "PAYOUT" || e.type === "TOP_UP" || e.type === "BUY_IN" ? e.toPlayerId : (e.fromPlayerId ?? e.toPlayerId)),
      label: entryLabel(e, blindSeen),
      amount: e.amount,
      at: e.createdAt,
      undone: r ? { text: reversalText(r, names), at: r.createdAt } : undefined,
      undoable: UNDOABLE.has(e.type) && !r,
    });
  }

  // Events are only mixed in as far back as the entries we've loaded, so the feed never has gaps.
  const oldest = entries.length ? entries[entries.length - 1].createdAt : 0;
  for (const ev of events) {
    if (ev.createdAt < oldest) continue;
    rows.push({
      key: ev._id,
      who: names(ev.playerId),
      label: ev.kind === "pack" ? "Packed" : "Back in the game",
      amount: null,
      at: ev.createdAt,
      undoable: false,
    });
  }
  return rows.sort((a, b) => b.at - a.at);
}
