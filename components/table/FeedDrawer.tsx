"use client";

import { useConvexAuth, usePaginatedQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { avatarColor, initials } from "@/lib/avatar";
import { buildFeed, clock } from "@/lib/feed";
import { formatInr } from "@/lib/format";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useUndo } from "@/hooks/useUndo";

/** Slides down from the top: every entry of this game, newest first, undone ones struck through. */
export function FeedDrawer({
  open,
  onClose,
  sessionId,
  gameId,
  title,
  isHost,
  meId,
  names,
  blindSeen,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: Id<"sessions">;
  gameId: Id<"games">;
  title: string;
  isHost: boolean;
  meId: string;
  names: (id?: string) => string;
  blindSeen: boolean;
}) {
  const { isAuthenticated } = useConvexAuth();
  const { results, status, loadMore } = usePaginatedQuery(api.sessions.feed, isAuthenticated && open ? { sessionId, gameId } : "skip", {
    initialNumItems: 25,
  });
  const events = useAuthedQuery(api.sessions.gameEvents, open ? { sessionId, gameId } : "skip");
  const rows = useMemo(() => buildFeed(results, events ?? [], names, blindSeen), [results, events, names, blindSeen]);
  const { undo, pending: undoing } = useUndo();

  // Host: hold a row for half a second (a gold ring fills) to open its undo menu. Right-click does the same on a laptop.
  const [pressing, setPressing] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const cancelPress = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPressing(null);
  };
  const startPress = (key: string, e: React.PointerEvent) => {
    origin.current = { x: e.clientX, y: e.clientY };
    setPressing(key);
    timer.current = setTimeout(() => {
      timer.current = null;
      setPressing(null);
      setMenuFor(key);
      if (typeof navigator.vibrate === "function") navigator.vibrate(30);
    }, 500);
  };
  useEffect(() => {
    if (!open) {
      setMenuFor(null);
      cancelPress();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40">
          <motion.div className="absolute inset-0" style={{ background: "var(--scrim)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-label="Live feed"
            className="absolute inset-x-0 top-0 mx-auto flex max-h-[85dvh] w-full max-w-[520px] flex-col rounded-b-[28px] bg-surface px-4 pb-3.5"
            style={{ boxShadow: "var(--sh2)", paddingTop: "max(20px, env(safe-area-inset-top))" }}
            initial={{ y: "-100%" }}
            animate={{ y: 0 }}
            exit={{ y: "-100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 380 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.6, bottom: 0 }}
            dragListener={false}
          >
            <div className="flex items-baseline justify-between px-1 pb-2.5 pt-5">
              <div>
                <div className="font-display text-2xl font-semibold">Live feed</div>
                <div className="text-xs font-semibold text-ink3">
                  {title} · {rows.length}
                  {status !== "Exhausted" ? "+" : ""} entries
                </div>
              </div>
              {isHost && <div className="text-xs font-extrabold tracking-[.06em] text-gold-ink">HOST</div>}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {status === "LoadingFirstPage" && <div className="skeleton h-40 rounded-2xl bg-surface2" />}
              {status !== "LoadingFirstPage" && rows.length === 0 && <div className="py-10 text-center text-sm text-ink3">Nothing yet — bets will show up here.</div>}
              {rows.map((r) => {
                const canUndo = isHost && r.undoable && !!r.entryId;
                const hot = pressing === r.key;
                return (
                  <motion.div key={r.key} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                    <div
                      className="relative flex select-none items-center gap-2.5 rounded-xl px-2 py-[9px] [-webkit-touch-callout:none]"
                      style={{
                        opacity: r.undone ? 0.5 : 1,
                        background: menuFor === r.key ? "var(--surface3)" : undefined,
                        boxShadow: hot ? "inset 0 0 0 2px var(--gold)" : undefined,
                        transition: "box-shadow 500ms linear",
                        touchAction: canUndo ? "pan-y" : undefined,
                      }}
                      onPointerDown={canUndo ? (e) => startPress(r.key, e) : undefined}
                      onPointerUp={canUndo ? cancelPress : undefined}
                      onPointerLeave={canUndo ? cancelPress : undefined}
                      onPointerCancel={canUndo ? cancelPress : undefined}
                      onPointerMove={
                        canUndo
                          ? (e) => {
                              const o = origin.current;
                              if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > 10) cancelPress();
                            }
                          : undefined
                      }
                      onContextMenu={canUndo ? (e) => (e.preventDefault(), cancelPress(), setMenuFor(r.key)) : undefined}
                    >
                      <div
                        className="grid h-8 w-8 flex-none place-items-center rounded-full text-[11.5px] font-extrabold text-[#f6eedb]"
                        style={{ background: avatarColor(r.who) }}
                      >
                        {initials(r.who)}
                      </div>
                      <div className="min-w-0 flex-1 leading-[1.25]">
                        <div className="truncate text-sm font-bold" style={{ textDecoration: r.undone ? "line-through" : undefined }}>
                          {r.who}
                          {r.entryId && r.who === names(meId) ? " (you)" : ""}
                        </div>
                        <div className="text-xs text-ink3">
                          {r.label} · {clock(r.at)}
                        </div>
                      </div>
                      <div className="amount text-lg" style={{ textDecoration: r.undone ? "line-through" : undefined }}>
                        {r.amount === null ? "—" : formatInr(r.amount)}
                      </div>
                    </div>
                    {r.undone && (
                      <div className="mb-1 ml-[50px] mr-2 flex gap-1.5 rounded-[10px] bg-surface2 px-2.5 py-1.5 text-xs font-semibold text-warn">
                        <span className="flex-1">{r.undone.text}</span>
                        <span className="tabular-nums text-ink3">{clock(r.undone.at)}</span>
                      </div>
                    )}
                    {menuFor === r.key && canUndo && (
                      <div className="my-1 ml-auto mr-2 w-[230px] overflow-hidden rounded-[14px] border border-line bg-surface3" style={{ boxShadow: "var(--sh2)" }}>
                        <button
                          disabled={undoing}
                          onClick={async () => {
                            const ok = await undo(r.entryId!, `${formatInr(r.amount ?? 0)} from ${r.who}`);
                            if (ok) setMenuFor(null);
                          }}
                          className="flex h-[46px] w-full items-center gap-2 border-b border-line px-3.5 text-sm font-extrabold text-down"
                        >
                          ↺ Undo {formatInr(r.amount ?? 0)} from {r.who}
                        </button>
                        <button onClick={() => setMenuFor(null)} className="flex h-11 w-full items-center px-3.5 text-sm font-bold text-ink2">
                          Cancel
                        </button>
                      </div>
                    )}
                  </motion.div>
                );
              })}
              {status === "CanLoadMore" && (
                <button onClick={() => loadMore(25)} className="press mt-2 h-11 w-full rounded-xl border border-line bg-surface2 text-[13px] font-bold text-gold-ink">
                  Show older entries
                </button>
              )}
              {status === "LoadingMore" && <div className="skeleton mt-2 h-11 rounded-xl bg-surface2" />}
            </div>
            <button onClick={onClose} aria-label="Close the feed" className="mx-auto mt-2.5 grid h-6 w-24 place-items-center">
              <span className="h-[5px] w-11 rounded-[3px] bg-line" />
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
