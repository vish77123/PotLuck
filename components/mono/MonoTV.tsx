"use client";

import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useNow } from "@/hooks/useNow";
import { avatarColor, initials } from "@/lib/avatar";
import { formatCode } from "@/lib/format";
import { GROUP_COLOURS } from "@/lib/monopoly/colors";
import { formatMoney, formatReal } from "@/lib/monopoly/money";

/** Where each of the 40 spaces sits on the 11×11 ring: bottom row right to left, up the left side, along the top, down the right. */
function cell(i: number) {
  if (i <= 10) return { col: 11 - i, row: 11 };
  if (i <= 20) return { col: 1, row: 11 - (i - 10) };
  if (i <= 30) return { col: 1 + (i - 20), row: 1 };
  return { col: 11, row: 1 + (i - 30) };
}

const CORNER = 84;
const SIDE = 56;
const BOARD = CORNER * 2 + SIDE * 9;

type Data = NonNullable<ReturnType<typeof useTV>>;
type TVGame = NonNullable<Data["game"]>;

function useTV(code: string) {
  return useAuthedQuery(api.monoDisplay.view, { code });
}

type TVSpace = TVGame["board"]["spaces"][number];

function Tile({ space, game, index }: { space: TVSpace; game: TVGame; index: number }) {
  const { col, row } = cell(index);
  const corner = (col === 1 || col === 11) && (row === 1 || row === 11);
  const ownable = space.kind === "property" || space.kind === "rail" || space.kind === "utility";
  const prop = game.props.find((p) => p.spaceId === space.id);
  const owner = prop?.owner ? game.players.find((p) => p.id === prop.owner) : undefined;
  const key = ownable ? (space.kind === "rail" ? "rail" : space.kind === "utility" ? "util" : (space.group ?? "brown")) : null;
  const level = prop ? (prop.hotel ? 5 : prop.houses) : 0;
  const w = col === 1 || col === 11 ? (corner ? CORNER : CORNER) : SIDE;
  const h = row === 1 || row === 11 ? CORNER : SIDE;
  const label =
    space.kind === "go" ? "GO" : space.kind === "jail" ? "JAIL" : space.kind === "parking" ? "FREE PARKING" : space.kind === "gotojail" ? "GO TO JAIL" : space.kind === "card" ? "CARD" : space.kind === "tax" ? "TAX" : space.name;
  return (
    <div
      className="relative flex flex-col justify-between overflow-hidden rounded-[6px] text-center leading-[1.1]"
      style={{
        gridColumn: col,
        gridRow: row,
        width: w,
        height: h,
        backgroundColor: owner ? avatarColor(owner.name) : "var(--surface)",
        color: owner ? "#f6eedb" : "var(--ink)",
        border: ownable && !owner ? "1.5px dashed var(--ink3)" : "1px solid var(--line)",
        backgroundImage: prop?.mortgaged ? "repeating-linear-gradient(135deg, rgba(0,0,0,.32) 0 5px, transparent 5px 10px)" : undefined,
      }}
    >
      {key && <div style={{ height: 13, background: GROUP_COLOURS[key] }} />}
      <div className="px-0.5 text-[10.5px] font-extrabold" style={{ marginTop: key ? 2 : "auto", marginBottom: key ? 0 : "auto" }}>
        {label}
      </div>
      {ownable ? (
        <div className="flex h-[14px] items-center justify-center gap-[2px] pb-0.5">
          {level > 0 ? (
            prop!.hotel ? (
              <span className="h-2.5 w-5 rounded-[2px]" style={{ background: "#d93a35" }} />
            ) : (
              Array.from({ length: level }).map((_, i) => <span key={i} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "#3aa35f" }} />)
            )
          ) : (
            <span className="text-[9.5px] font-bold opacity-70">{space.price ? formatMoney(space.price, game.board.currency) : ""}</span>
          )}
        </div>
      ) : (
        space.kind === "parking" &&
        game.freeParkingPot && <div className="amount pb-1 text-[15px]">{formatMoney(game.pot, game.board.currency)}</div>
      )}
    </div>
  );
}

/** The landscape display for a property game: the real board ring with owners and buildings, the players and a live feed. */
export function MonoTV({ code }: { code: string }) {
  const d = useTV(code);
  const now = useNow(500);
  const game = d?.game ?? null;
  const turn = game?.players.find((p) => p.id === game.turnId);
  const spaces = useMemo(() => game?.board.spaces ?? [], [game]);
  const money = (n: number) => formatMoney(n, game?.board.currency ?? "$");
  const auction = game?.auction;
  const auctionSpace = auction ? spaces.find((s) => s.id === auction.spaceId) : null;
  const left = auction ? Math.max(0, Math.ceil((auction.endsAt - now) / 1000)) : 0;

  if (d === undefined) return <div className="skeleton h-40 w-96 rounded-3xl bg-surface2" aria-busy="true" />;
  if (d === null) return <div className="font-display text-4xl font-semibold">No property game with that code</div>;

  return (
    <div style={{ width: 1280, height: 720, position: "relative" }}>
      <div className="absolute flex items-center gap-4" style={{ left: 36, top: 22, right: 36, height: 40 }}>
        <div className="font-display text-[28px] font-bold">
          Pot<span className="italic text-gold-ink">Luck</span>
          <span className="ml-4 text-lg font-bold text-ink2" style={{ fontFamily: "var(--font-manrope)" }}>
            {game ? `${game.board.name} · Game ${game.no}` : d.crewName ?? "Property game"}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2.5 text-lg font-extrabold tracking-[.14em] text-gold-ink">
          <span className="h-2.5 w-2.5 rounded-full bg-up" />
          {formatCode(d.code)}
        </div>
      </div>

      {!game ? (
        <div className="absolute inset-0 grid place-items-center text-center">
          <div className="font-display text-5xl font-semibold">{d.status === "ended" ? "Session over" : "Waiting for the game to start"}</div>
        </div>
      ) : (
        <>
          <div
            className="absolute grid"
            style={{ left: 36, top: 70, width: BOARD, height: BOARD, gridTemplateColumns: `${CORNER}px repeat(9, ${SIDE}px) ${CORNER}px`, gridTemplateRows: `${CORNER}px repeat(9, ${SIDE}px) ${CORNER}px`, gap: 0 }}
          >
            {spaces.map((s, i) => (
              <Tile key={s.id} space={s} game={game} index={i} />
            ))}
            <div className="felt flex flex-col items-center justify-center rounded-[10px] text-center" style={{ gridColumn: "2 / 11", gridRow: "2 / 11" }}>
              {game.status === "ended" ? (
                <div className="font-display text-[44px] font-bold">Game over</div>
              ) : game.status === "paused" ? (
                <div className="font-display text-[48px] font-bold">Paused</div>
              ) : auction && auctionSpace ? (
                <>
                  <div className="text-lg font-extrabold tracking-[.3em] text-on-felt2">LIVE AUCTION</div>
                  <div className="font-display mt-1 text-[40px] font-bold leading-tight">{auctionSpace.name}</div>
                  <div className="amount mt-1 text-[64px] leading-none">{auction.highestBid > 0 ? money(auction.highestBid) : "No bids"}</div>
                  <div className="mt-2 text-2xl font-bold text-on-felt2">{auction.bidder ? `${auction.bidder} · ` : ""}{left}s</div>
                </>
              ) : (
                <>
                  {turn && (
                    <div className="inline-flex items-center gap-3 rounded-full px-6 py-2.5 text-[28px] font-extrabold" style={{ background: "#f1d590", color: "#1d1608" }}>
                      <span className="h-3 w-3 rounded-full" style={{ background: "#1d1608" }} />
                      {turn.name}&rsquo;s turn
                    </div>
                  )}
                  {game.freeParkingPot && (
                    <div className="mt-6">
                      <div className="text-base font-extrabold tracking-[.3em] text-on-felt2">FREE PARKING</div>
                      <div className="amount text-[56px] leading-none">{money(game.pot)}</div>
                    </div>
                  )}
                  {game.trackProperties && (
                    <div className="mt-5 text-lg font-bold text-on-felt2">
                      Houses {game.bankHouses} · Hotels {game.bankHotels} in the bank
                    </div>
                  )}
                  {game.buyIn > 0 && <div className="mt-2 text-base font-semibold text-on-felt2">Playing for real {formatReal(game.buyIn)} each</div>}
                </>
              )}
            </div>
          </div>

          <div className="absolute flex flex-col rounded-[28px] border border-line bg-surface p-5" style={{ left: 36 + BOARD + 24, top: 70, right: 36, height: BOARD }}>
            <div className="font-display text-[26px] font-semibold">Players</div>
            <div className="mt-2 flex flex-col">
              {game.players.map((p) => (
                <div key={p.id} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0" style={{ opacity: p.bankrupt ? 0.45 : 1 }}>
                  <div
                    className="grid h-10 w-10 flex-none place-items-center rounded-full text-sm font-extrabold text-[#f6eedb]"
                    style={{ boxSizing: "border-box", background: avatarColor(p.name), border: `3px solid ${p.id === game.turnId && game.status === "active" ? "#f1d590" : "transparent"}` }}
                  >
                    {initials(p.name)}
                  </div>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-xl font-extrabold">{p.name}</div>
                    <div className="text-[13px] font-semibold text-ink3">{p.bankrupt ? "Out" : p.inJail ? "In jail" : p.id === game.turnId ? "Playing now" : ""}</div>
                  </div>
                  <div className="amount text-[26px] tabular-nums">{p.bankrupt ? "—" : money(p.cash)}</div>
                </div>
              ))}
            </div>
            <div className="font-display mt-4 text-[22px] font-semibold">Live feed</div>
            <div className="mt-1 flex flex-col overflow-hidden">
              {(d.feed ?? []).length === 0 && <div className="py-4 text-base text-ink3">Nothing yet.</div>}
              {(d.feed ?? []).slice(0, 6).map((f) => (
                <div key={f.id} className="border-b border-line py-1.5 text-[15.5px] font-semibold leading-snug last:border-b-0" style={{ opacity: f.undone ? 0.5 : 1, textDecoration: f.undone ? "line-through" : undefined }}>
                  {f.label}
                </div>
              ))}
            </div>
            {game.status === "active" && <div className="mt-auto pt-2 text-xs font-semibold text-ink3">Turn {game.turnNo}</div>}
          </div>
        </>
      )}
    </div>
  );
}
