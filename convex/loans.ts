import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { getPlayerInSession, requireActivePlayer, requirePlayer } from "./lib/access";
import { fail } from "./lib/errors";
import { applyEntry, withIdempotency } from "./lib/ledger";
import { assertAmount, formatInr } from "./lib/validators";

async function getLoan(ctx: MutationCtx, loanId: Id<"loans">) {
  const loan = await ctx.db.get(loanId);
  if (!loan) fail("NOT_FOUND", "Loan not found.");
  return loan;
}

/** Borrower asks a lender. No money moves until the lender accepts. */
export const request = mutation({
  args: {
    sessionId: v.id("sessions"),
    lenderPlayerId: v.id("sessionPlayers"),
    amount: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { sessionId, lenderPlayerId, amount, idempotencyKey }) => {
    const { userId, player: me } = await requireActivePlayer(ctx, sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      assertAmount(amount, "Loan amount");
      const lender = await getPlayerInSession(ctx, sessionId, lenderPlayerId);
      if (lender._id === me._id) fail("INVALID_STATE", "You can't borrow from yourself.");
      if (lender.status !== "active") fail("INVALID_STATE", `${lender.name} has cashed out.`);
      const loanId = await ctx.db.insert("loans", {
        sessionId,
        lenderPlayerId,
        borrowerPlayerId: me._id,
        amount,
        repaidAmount: 0,
        status: "requested",
        requestedAt: Date.now(),
      });
      return { loanId };
    });
  },
});

export const cancelRequest = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await getLoan(ctx, loanId);
    const { player: me } = await requirePlayer(ctx, loan.sessionId);
    if (loan.borrowerPlayerId !== me._id) fail("FORBIDDEN", "Only the borrower can withdraw this request.");
    if (loan.status !== "requested") return null;
    await ctx.db.patch(loanId, { status: "declined", closedAt: Date.now(), meta: { reason: "withdrawn" } });
    return null;
  },
});

export const respond = mutation({
  args: { loanId: v.id("loans"), accept: v.boolean(), idempotencyKey: v.string() },
  handler: async (ctx, { loanId, accept, idempotencyKey }) => {
    const loan = await getLoan(ctx, loanId);
    const { userId, player: me } = await requireActivePlayer(ctx, loan.sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      if (loan.lenderPlayerId !== me._id) fail("FORBIDDEN", "Only the lender can answer this request.");
      if (loan.status !== "requested") fail("INVALID_STATE", "This request has already been answered.");
      const now = Date.now();
      if (!accept) {
        await ctx.db.patch(loanId, { status: "declined", respondedAt: now, closedAt: now });
        return { accepted: false };
      }
      const borrower = (await ctx.db.get(loan.borrowerPlayerId))!;
      if (borrower.status !== "active") fail("INVALID_STATE", `${borrower.name} has cashed out.`);
      const entry = await applyEntry(ctx, {
        sessionId: loan.sessionId,
        loanId,
        type: "LOAN",
        fromPlayerId: loan.lenderPlayerId,
        toPlayerId: loan.borrowerPlayerId,
        amount: loan.amount,
        createdByPlayerId: me._id,
        idempotencyKey,
      });
      await ctx.db.patch(loanId, { status: "open", respondedAt: now, loanEntryId: entry._id });
      return { accepted: true, entryId: entry._id };
    });
  },
});

/** Borrower pays back some or all of what's outstanding, whenever they choose. */
export const repay = mutation({
  args: { loanId: v.id("loans"), amount: v.optional(v.number()), idempotencyKey: v.string() },
  handler: async (ctx, { loanId, amount, idempotencyKey }) => {
    const loan = await getLoan(ctx, loanId);
    const { userId, player: me } = await requireActivePlayer(ctx, loan.sessionId);
    return await withIdempotency(ctx, userId, idempotencyKey, async () => {
      if (loan.borrowerPlayerId !== me._id) fail("FORBIDDEN", "Only the borrower can repay this loan.");
      if (loan.status !== "open") fail("INVALID_STATE", "This loan isn't open.");
      const outstanding = loan.amount - loan.repaidAmount;
      const pay = amount ?? outstanding;
      assertAmount(pay, "Repayment");
      if (pay > outstanding) fail("INVALID_AMOUNT", `Only ${formatInr(outstanding)} is outstanding.`);
      const lender = (await ctx.db.get(loan.lenderPlayerId))!;
      if (lender.status !== "active") {
        fail("INVALID_STATE", `${lender.name} has cashed out — mark this loan settled outside the app instead.`);
      }
      const entry = await applyEntry(ctx, {
        sessionId: loan.sessionId,
        loanId,
        type: "LOAN_REPAYMENT",
        fromPlayerId: loan.borrowerPlayerId,
        toPlayerId: loan.lenderPlayerId,
        amount: pay,
        createdByPlayerId: me._id,
        idempotencyKey,
      });
      const repaidAmount = loan.repaidAmount + pay;
      await ctx.db.patch(loanId, {
        repaidAmount,
        status: repaidAmount === loan.amount ? "repaid" : "open",
        closedAt: repaidAmount === loan.amount ? Date.now() : undefined,
      });
      return { entryId: entry._id, outstanding: loan.amount - repaidAmount };
    });
  },
});

/** Either side closes the loan without moving wallet money (they settled in cash). Excluded from nets. */
export const markSettledOutside = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await getLoan(ctx, loanId);
    const { player: me } = await requirePlayer(ctx, loan.sessionId);
    if (loan.lenderPlayerId !== me._id && loan.borrowerPlayerId !== me._id) {
      fail("FORBIDDEN", "Only the lender or borrower can settle this loan.");
    }
    if (loan.status !== "open") fail("INVALID_STATE", "This loan isn't open.");
    await ctx.db.patch(loanId, {
      status: "settled_outside",
      closedAt: Date.now(),
      meta: { settledByPlayerId: me._id, settledByName: me.name, outstandingAtSettle: loan.amount - loan.repaidAmount },
    });
    return null;
  },
});
