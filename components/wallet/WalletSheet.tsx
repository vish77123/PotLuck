"use client";

import { useConvex } from "convex/react";
import { useEffect, useState } from "react";
import { Money } from "@/components/money/Money";
import type { SessionState } from "@/components/lobby/types";
import { AmountStepper } from "@/components/ui/AmountStepper";
import { Avatar } from "@/components/ui/Avatar";
import { Dialog } from "@/components/ui/Dialog";
import { GoldButton, SecondaryButton } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/Sheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useSubmit } from "@/hooks/useSubmit";
import { newKey } from "@/lib/errors";
import { clock } from "@/lib/feed";
import { formatInr } from "@/lib/format";
import { breakdown, denomsFor, kindOf } from "@/lib/wallet";
import { useUi } from "@/stores/ui";

export type WalletView = "main" | "topup" | "borrow";
const TOPUP_PRESETS = [100, 500, 1000, 2000];

function Section({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 px-1 text-[11px] font-extrabold tracking-[.14em] text-ink3">{children}</div>;
}

/** My wallet: balance and what it's made of, top-up, loans between players, history, and cashing out. */
export function WalletSheet({
  open,
  onClose,
  state,
  initialView = "main",
}: {
  open: boolean;
  onClose: () => void;
  state: SessionState;
  initialView?: WalletView;
}) {
  const convex = useConvex();
  const pushToast = useUi((s) => s.pushToast);
  const { pending, run } = useSubmit();
  const [view, setView] = useState<WalletView>(initialView);
  const [amount, setAmount] = useState(500);
  const [lender, setLender] = useState<Id<"sessionPlayers"> | null>(null);
  const [cashOutAsk, setCashOutAsk] = useState(false);
  const [repayFor, setRepayFor] = useState<null | { id: Id<"loans">; owed: number; name: string }>(null);
  const [repayAmount, setRepayAmount] = useState(0);

  const { session, players, meId } = state;
  const me = players.find((p) => p._id === meId)!;
  const theme = session.theme;
  const data = useAuthedQuery(api.wallet.overview, open ? { sessionId: session._id } : "skip");
  const others = players.filter((p) => p.status === "active" && p._id !== meId);
  const nameOf = (id?: string) => players.find((p) => p._id === id)?.name ?? "Someone";

  useEffect(() => {
    if (open) {
      setView(initialView);
      setAmount(500);
      setLender(null);
    }
  }, [open, initialView]);

  const incoming = data?.loans.filter((l) => l.role === "lender" && l.status === "requested") ?? [];
  const outstanding = data?.loans.filter((l) => l.status === "open" || (l.status === "requested" && l.role === "borrower")) ?? [];
  const mix = breakdown(me.balance, theme);
  const mixCells = denomsFor(theme)
    .filter((d) => (mix[d] ?? 0) > 0)
    .slice(0, 6);

  const topUp = () =>
    run(async () => {
      await convex.mutation(api.wallet.topUp, { sessionId: session._id, amount, idempotencyKey: newKey() });
      pushToast({ text: `Topped up ${formatInr(amount)}` });
      setView("main");
    });
  const ask = () =>
    run(async () => {
      await convex.mutation(api.loans.request, { sessionId: session._id, lenderPlayerId: lender!, amount, idempotencyKey: newKey() });
      pushToast({ text: `Asked ${nameOf(lender!)} for ${formatInr(amount)}` });
      setView("main");
    });
  const answer = (loanId: Id<"loans">, accept: boolean) =>
    run(async () => {
      await convex.mutation(api.loans.respond, { loanId, accept, idempotencyKey: newKey() });
    });
  const repay = () =>
    run(async () => {
      if (!repayFor) return;
      await convex.mutation(api.loans.repay, { loanId: repayFor.id, amount: repayAmount, idempotencyKey: newKey() });
      pushToast({ text: `Paid back ${formatInr(repayAmount)} to ${repayFor.name}` });
      setRepayFor(null);
    });
  const settle = (loanId: Id<"loans">) => run(() => convex.mutation(api.loans.markSettledOutside, { loanId }));
  const cancelAsk = (loanId: Id<"loans">) => run(() => convex.mutation(api.loans.cancelRequest, { loanId }));
  const cashOut = () =>
    run(async () => {
      const r = await convex.mutation(api.wallet.cashOut, { sessionId: session._id, idempotencyKey: newKey() });
      pushToast({ text: `Cashed out ${formatInr(r.amount)}. See you next time!` });
      setCashOutAsk(false);
      onClose();
    });

  const back = (
    <button onClick={() => setView("main")} aria-label="Back to wallet" className="press mb-1 grid h-11 w-11 place-items-center rounded-full border border-line bg-surface2">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M15 5l-7 7 7 7" />
      </svg>
    </button>
  );

  return (
    <>
      <Sheet open={open} onClose={onClose}>
        {view === "main" && (
          <>
            <div className="flex items-end justify-between px-1">
              <div>
                <div className="text-[11px] font-extrabold tracking-[.16em] text-ink3">MY WALLET</div>
                <div className="amount text-[50px] leading-[1.05]">{formatInr(me.balance)}</div>
              </div>
              <div className="text-right text-xs font-semibold leading-[1.5] tabular-nums text-ink3">
                Buy-in {formatInr(data?.buyIn ?? 0)}
                <br />
                Top-ups {formatInr(data?.topUps ?? 0)}
                <br />
                In this pot {formatInr(data?.inPot ?? 0)}
              </div>
            </div>

            <div className="mt-3 flex h-[58px] items-center gap-1.5 overflow-hidden rounded-2xl bg-surface2 px-2.5" aria-label="Wallet contents">
              {mixCells.map((d) => (
                <div key={d} className="relative flex-none">
                  <Money kind={kindOf(theme, d)} v={d} w={theme === "chips" ? 40 : d < 10 ? 28 : 52} />
                  <div className="absolute -right-[5px] -top-1.5 rounded-md bg-ink px-1 text-[9.5px] font-extrabold text-bg">×{mix[d]}</div>
                </div>
              ))}
            </div>

            <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: "1.2fr 1fr 1fr" }}>
              <button onClick={() => setView("topup")} className="gold-btn press h-[52px] rounded-2xl text-[15px]" disabled={me.status !== "active"}>
                + Top up
              </button>
              <SecondaryButton
                className="!h-[52px] !rounded-2xl !text-[15px]"
                disabled={me.status !== "active"}
                onClick={() =>
                  incoming.length
                    ? document.getElementById("incoming-loans")?.scrollIntoView({ behavior: "smooth" })
                    : pushToast({ text: "Nobody has asked to borrow from you yet. Requests show up here.", tone: "warn" })
                }
              >
                Lend{incoming.length ? ` · ${incoming.length}` : ""}
              </SecondaryButton>
              <SecondaryButton className="!h-[52px] !rounded-2xl !text-[15px]" disabled={me.status !== "active" || others.length === 0} onClick={() => setView("borrow")}>
                Borrow
              </SecondaryButton>
            </div>

            {incoming.map((l, i) => (
              <div key={l._id} id={i === 0 ? "incoming-loans" : undefined} className="mt-3.5 rounded-[18px] border border-line-gold bg-surface3 p-3.5">
                <div className="flex items-center gap-2.5">
                  <Avatar name={l.otherName} size={36} />
                  <div className="flex-1 text-sm leading-[1.35]">
                    <b>{l.otherName}</b> wants to borrow <b className="tabular-nums">{formatInr(l.amount)}</b> from you
                  </div>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <button disabled={pending} onClick={() => answer(l._id, false)} className="press h-11 rounded-xl border border-line text-sm font-bold">
                    Decline
                  </button>
                  <button disabled={pending} onClick={() => answer(l._id, true)} className="press h-11 rounded-xl bg-ink text-sm font-extrabold text-bg">
                    Lend {formatInr(l.amount)}
                  </button>
                </div>
              </div>
            ))}

            <Section>OUTSTANDING LOANS</Section>
            {outstanding.length === 0 && <div className="py-3 text-center text-sm text-ink3">No open loans.</div>}
            {outstanding.map((l) => {
              const owed = l.amount - l.repaidAmount;
              const lent = l.role === "lender";
              const waiting = l.status === "requested";
              return (
                <div key={l._id} className="flex min-h-[56px] items-center gap-2.5 border-b border-line px-1 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{waiting ? `You asked ${l.otherName}` : lent ? `You lent ${l.otherName}` : `You owe ${l.otherName}`}</div>
                    <div className="text-xs text-ink3">
                      {clock(l.at).slice(0, 5)} · {waiting ? `waiting for ${l.otherName} to accept` : l.repaidAmount > 0 ? `${formatInr(l.repaidAmount)} paid back` : "accepted"}
                    </div>
                  </div>
                  <div className="amount text-[19px]" style={{ color: waiting ? "var(--ink3)" : lent ? "var(--up)" : "var(--down)" }}>
                    {formatInr(owed)}
                  </div>
                  {waiting ? (
                    <button disabled={pending} onClick={() => cancelAsk(l._id)} className="press h-11 rounded-[10px] border border-line px-2.5 text-xs font-extrabold text-ink3">
                      Cancel
                    </button>
                  ) : (
                    <div className="flex gap-1.5">
                      {!lent && (
                        <button
                          onClick={() => {
                            setRepayFor({ id: l._id, owed, name: l.otherName });
                            setRepayAmount(Math.min(owed, Math.max(1, me.balance)));
                          }}
                          className="press h-11 rounded-[10px] border border-line px-2.5 text-xs font-extrabold"
                        >
                          Repay
                        </button>
                      )}
                      <button
                        disabled={pending}
                        onClick={() => settle(l._id)}
                        className="press h-11 rounded-[10px] border border-line px-2.5 text-xs font-extrabold"
                        title="Settled outside the app, in cash"
                      >
                        {lent ? "Mark repaid" : "Paid in cash"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            <Section>BUY-IN &amp; TOP-UP HISTORY</Section>
            {data?.history.map((h) => (
              <div key={h.entryId} className="flex h-11 items-center justify-between border-b border-line px-1 text-sm" style={{ opacity: h.undone ? 0.5 : 1 }}>
                <span className="font-semibold text-ink2" style={{ textDecoration: h.undone ? "line-through" : undefined }}>
                  {h.type === "BUY_IN" ? "Buy-in" : "Top up"} · {clock(h.at).slice(0, 5)}
                  {h.undone ? " · undone" : ""}
                </span>
                <span className="font-extrabold tabular-nums" style={{ textDecoration: h.undone ? "line-through" : undefined }}>
                  {h.type === "TOP_UP" ? "+" : ""}
                  {formatInr(h.amount)}
                </span>
              </div>
            ))}

            {me.status === "active" && (
              <div className="mt-5 text-center">
                <button onClick={() => setCashOutAsk(true)} className="h-11 px-4 text-[13.5px] font-bold text-down">
                  Cash out &amp; leave
                </button>
              </div>
            )}
          </>
        )}

        {view === "topup" && (
          <>
            {back}
            <div className="font-display text-[26px] font-semibold">Top up</div>
            <div className="text-[13px] text-ink3">Add money to your wallet. It’s tracked separately from your buy-in.</div>
            <div className="mt-4 flex justify-center">
              <AmountStepper label="Top-up" size="lg" value={amount} onChange={setAmount} step={100} min={10} />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              {TOPUP_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setAmount(p)}
                  className="press h-11 rounded-[10px] text-[13px] font-bold tabular-nums"
                  style={{ border: `1px solid ${amount === p ? "var(--gold)" : "var(--line)"}`, background: amount === p ? "var(--surface3)" : "transparent" }}
                >
                  {formatInr(p)}
                </button>
              ))}
            </div>
            <div className="mt-4">
              <GoldButton pending={pending} disabled={amount < 1} onClick={topUp}>
                Top up {formatInr(amount)}
              </GoldButton>
            </div>
          </>
        )}

        {view === "borrow" && (
          <>
            {back}
            <div className="font-display text-[26px] font-semibold">Borrow</div>
            <div className="text-[13px] text-ink3">Ask another player. Money only moves if they tap Lend. How and when you pay back is up to you two.</div>
            <div className="mt-3 grid gap-2">
              {others.map((p) => {
                const on = lender === p._id;
                return (
                  <button
                    key={p._id}
                    onClick={() => setLender(p._id)}
                    aria-pressed={on}
                    className="press flex min-h-[60px] items-center gap-3 rounded-2xl px-3 py-2 text-left"
                    style={{ background: on ? "var(--surface3)" : "var(--surface2)", border: on ? "2px solid var(--gold)" : "1px solid var(--line)" }}
                  >
                    <Avatar name={p.name} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-bold">{p.name}</div>
                      <div className="text-xs text-ink3">{formatInr(p.balance)} in wallet</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex justify-center">
              <AmountStepper label="Loan amount" size="lg" value={amount} onChange={setAmount} step={100} min={10} />
            </div>
            <div className="mt-4">
              <GoldButton pending={pending} disabled={!lender || amount < 1} onClick={ask}>
                {lender ? `Ask ${nameOf(lender)} for ${formatInr(amount)}` : "Pick who to ask"}
              </GoldButton>
            </div>
          </>
        )}
      </Sheet>

      <Dialog
        open={!!repayFor}
        eyebrow="REPAY"
        title={`Pay back ${repayFor?.name ?? ""}`}
        body={`You owe ${formatInr(repayFor?.owed ?? 0)}. Pay all or part of it now.`}
        extra={
          <div className="mt-3 flex justify-center">
            <AmountStepper label="Repayment" value={repayAmount} onChange={(n) => setRepayAmount(Math.min(n, repayFor?.owed ?? n))} step={50} min={1} max={repayFor?.owed} />
          </div>
        }
        noLabel="Not now"
        yesLabel={`Pay ${formatInr(repayAmount)}`}
        onNo={() => setRepayFor(null)}
        onYes={repay}
        pending={pending}
      />
      <Dialog
        open={cashOutAsk}
        eyebrow="CASH OUT"
        eyebrowColor="var(--down)"
        title={`Cash out ${formatInr(me.balance)}?`}
        body="Your whole wallet comes out and you leave the table. You stay in the report and can rejoin with a new buy-in. You can only leave when you're not in a hand."
        noLabel="Stay"
        yesLabel="Cash out"
        onNo={() => setCashOutAsk(false)}
        onYes={cashOut}
        pending={pending}
      />
    </>
  );
}
