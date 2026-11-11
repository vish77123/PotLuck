"use client";

import { useEffect, useState } from "react";
import { useMonoActions } from "@/components/mono/actions";
import { useMoney, type MonoGame, type MonoPlayer } from "@/components/mono/types";
import { AmountStepper } from "@/components/ui/AmountStepper";
import { Avatar } from "@/components/ui/Avatar";
import { GoldButton } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/Sheet";
import { useNow } from "@/hooks/useNow";
import { GROUP_COLOURS, GROUP_LABELS, groupKeyOf } from "@/lib/monopoly/colors";

/** The live auction, on every phone. Anyone who can cover a bid can make it; each bid restarts a 15 second countdown. */
export function AuctionSheet({ open, onClose, game, me, isHost }: { open: boolean; onClose: () => void; game: MonoGame; me: MonoPlayer | null; isHost: boolean }) {
  const auction = game.auction;
  const fmt = useMoney(game);
  const actions = useMonoActions(game);
  const now = useNow(250);
  const high = auction?.highestBid ?? 0;
  const [amount, setAmount] = useState(high + 10);
  // Keep the stepper just above the highest bid as others bid.
  useEffect(() => {
    setAmount((a) => Math.max(a, high + 1));
  }, [high, auction?._id]);

  if (!auction) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const space = game.boardSnapshot.spaces.find((s) => s.id === auction.spaceId);
  const key = space ? groupKeyOf(space) : "brown";
  const bidder = game.players.find((p) => p._id === auction.highestBidderId);
  const left = Math.max(0, Math.ceil((auction.endsAt - now) / 1000));
  const closing = auction.endsAt - now <= 0;
  const iAmHigh = !!me && bidder?._id === me._id;
  const canBid = !!me && me.status === "playing" && !iAmHigh && !closing;
  const quick = [1, 10, 50, 100].map((d) => high + d).filter((n) => !me || n <= me.cash);
  const total = auction.highestBid > 0 ? 15 : 30;

  const place = async (n: number) => {
    await actions.bid(auction._id, n);
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="mt-1 overflow-hidden rounded-[18px] border border-line">
        <div className="px-4 py-3" style={{ background: GROUP_COLOURS[key], color: key === "lblue" || key === "yellow" || key === "util" ? "#1d1608" : "#fff" }}>
          <div className="text-[10.5px] font-extrabold tracking-[.16em] opacity-80">LIVE AUCTION · {GROUP_LABELS[key].toUpperCase()}</div>
          <div className="font-display text-[26px] font-semibold leading-[1.1]">{space?.name ?? "Property"}</div>
          <div className="text-[12.5px] font-bold opacity-80">List price {fmt(space?.price ?? 0)}</div>
        </div>
        <div className="bg-surface2 px-4 py-3.5">
          <div className="text-[10.5px] font-extrabold tracking-[.16em] text-ink3">HIGHEST BID</div>
          <div className="flex items-center gap-3">
            <div className="amount text-[42px] leading-[1.1] tabular-nums">{high > 0 ? fmt(high) : "No bids"}</div>
            {bidder && (
              <div className="flex items-center gap-2">
                <Avatar name={bidder.name} size={30} />
                <span className="text-[13.5px] font-extrabold">{bidder.name}</span>
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface3">
              <div className="h-full bg-gold" style={{ width: `${Math.min(100, (left / total) * 100)}%`, transition: "width 250ms linear" }} />
            </div>
            <div className="w-16 text-right text-[15px] font-extrabold tabular-nums" aria-live="polite">
              {closing ? "Closing…" : `${left}s`}
            </div>
          </div>
        </div>
      </div>

      {canBid ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {quick.map((n) => (
              <button key={n} disabled={actions.pending} onClick={() => place(n)} className="press h-11 rounded-[13px] border border-line bg-surface2 px-3.5 text-[14px] font-extrabold">
                {fmt(n)}
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-center">
            <AmountStepper label="Bid" value={amount} onChange={setAmount} step={10} min={high + 1} max={me!.cash} format={fmt} />
          </div>
          <div className="mt-3">
            <GoldButton pending={actions.pending} disabled={amount <= high || amount > me!.cash} onClick={() => place(amount)}>
              Bid {fmt(amount)}
            </GoldButton>
            <div className="mt-2 text-center text-[12.5px] font-semibold text-ink3">You have {fmt(me!.cash)}.</div>
          </div>
        </>
      ) : (
        <div className="mt-3 text-center text-[14px] font-bold text-ink2">
          {!me ? "You're watching this auction." : iAmHigh ? "You're the highest bidder. Waiting to see if anyone bids higher." : closing ? "Time's up. Closing the auction…" : "You're out of this game."}
        </div>
      )}
      {isHost && (
        <div className="mt-4 text-center">
          <button disabled={actions.pending} onClick={() => actions.cancelAuction(auction._id)} className="press h-10 rounded-xl border border-down px-4 text-[12.5px] font-bold text-down">
            Stop the auction
          </button>
        </div>
      )}
    </Sheet>
  );
}
