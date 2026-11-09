"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { breakdown, compose, denomsFor, takeOne, total, type Counts, type Theme } from "@/lib/wallet";

/**
 * The bet being built: notes taken out of the wallet into a stack. The wallet is re-split whenever the
 * real balance changes, which also clears a half-built stack (a bet landed, an undo came in, a top-up).
 */
export function useComposer(balance: number, theme: Theme) {
  const base = useMemo(() => breakdown(balance, theme), [balance, theme]);
  const [counts, setCounts] = useState<Counts>(base);
  const [built, setBuilt] = useState<number[]>([]);

  useEffect(() => {
    setCounts(base);
    setBuilt([]);
  }, [base]);

  const add = useCallback(
    (d: number) => {
      const next = takeOne(counts, d, theme);
      if (!next) return false;
      setCounts(next);
      setBuilt((b) => [...b, d]);
      return true;
    },
    [counts, theme],
  );

  const removeTop = useCallback(() => {
    setBuilt((b) => {
      if (!b.length) return b;
      const d = b[b.length - 1];
      setCounts((c) => ({ ...c, [d]: c[d] + 1 }));
      return b.slice(0, -1);
    });
  }, []);

  const clear = useCallback(() => {
    setCounts(base);
    setBuilt([]);
  }, [base]);

  /** Replace the stack with an exact amount (quick bets). False if the wallet is short. */
  const setAmount = useCallback(
    (amount: number) => {
      const res = compose(amount, base, theme);
      if (!res) return false;
      setCounts(res.counts);
      setBuilt(res.built);
      return true;
    },
    [base, theme],
  );

  return { counts, built, amount: built.reduce((a, b) => a + b, 0), walletTotal: total(counts), add, removeTop, clear, setAmount, denoms: denomsFor(theme) };
}
