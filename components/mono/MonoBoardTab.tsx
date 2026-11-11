"use client";

import { useMemo, useState } from "react";
import { useGameState, useMoney, type MonoGame, type MonoPlayer } from "@/components/mono/types";
import { avatarColor } from "@/lib/avatar";
import { GROUP_COLOURS, GROUP_LABELS, GROUP_ORDER, groupKeyOf } from "@/lib/monopoly/colors";
import { levelOf, ownableSpaces } from "@/lib/monopoly/rules";
import type { Space } from "@/lib/monopoly/types";

/** One ownable space as a tile: fill = owner's colour, ring = mine, dashed = for sale, hatch = mortgaged, pips = buildings. */
function Tile({ game, space, me, onOpen }: { game: MonoGame; space: Space; me: MonoPlayer | null; onOpen: (id: string) => void }) {
  const gs = useGameState(game);
  const fmt = useMoney(game);
  const prop = gs.props[space.id];
  const owner = prop?.owner ? game.players.find((p) => p._id === prop.owner) : undefined;
  const mine = !!me && owner?._id === me._id;
  const level = prop ? levelOf(prop) : 0;
  const fill = owner ? avatarColor(owner.name) : "transparent";
  return (
    <button
      onClick={() => onOpen(space.id)}
      aria-label={`${space.name}, ${owner ? `owned by ${owner.name}` : "for sale"}${prop?.mortgaged ? ", mortgaged" : ""}`}
      className="press relative flex min-h-[76px] flex-col justify-between overflow-hidden rounded-[14px] p-2 text-left"
      style={{
        backgroundColor: owner ? fill : "var(--surface)",
        color: owner ? "#f6eedb" : "var(--ink)",
        border: owner ? `2px solid ${mine ? "var(--gold)" : "transparent"}` : "1.5px dashed var(--ink3)",
        boxShadow: mine ? "var(--glow)" : undefined,
        backgroundImage: prop?.mortgaged ? "repeating-linear-gradient(135deg, rgba(0,0,0,.28) 0 5px, transparent 5px 10px)" : undefined,
      }}
    >
      <span className="line-clamp-2 text-[12px] font-extrabold leading-tight">{space.name}</span>
      <span className="flex items-end justify-between gap-1">
        <span className="text-[11px] font-bold opacity-80 tabular-nums">{fmt(space.price ?? 0)}</span>
        {level > 0 && (
          <span className="flex gap-[2px]" aria-label={prop.hotel ? "hotel" : `${level} houses`}>
            {prop.hotel ? <span className="h-2.5 w-4 rounded-[3px] bg-[#d93a35]" /> : Array.from({ length: level }).map((_, i) => <span key={i} className="h-2.5 w-2.5 rounded-[3px] bg-[#3aa35f]" />)}
          </span>
        )}
      </span>
    </button>
  );
}

/** Every ownable space by colour group, with a search for "where did you land?". */
export function MonoBoardTab({ game, me, onOpen }: { game: MonoGame; me: MonoPlayer | null; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const spaces = useMemo(() => ownableSpaces(game.boardSnapshot), [game.boardSnapshot]);
  const groups = useMemo(() => {
    const out = new Map<string, Space[]>();
    for (const s of spaces) out.set(groupKeyOf(s), [...(out.get(groupKeyOf(s)) ?? []), s]);
    return GROUP_ORDER.filter((k) => out.has(k)).map((k) => ({ key: k, spaces: out.get(k)! }));
  }, [spaces]);
  const q = query.trim().toLowerCase();
  const matches = q ? spaces.filter((s) => s.name.toLowerCase().includes(q)) : [];

  if (!game.settings.trackProperties) {
    return <div className="mx-5 mt-10 text-center text-sm font-semibold text-ink3">This game is money only. Deeds, rent and buildings aren't tracked.</div>;
  }
  return (
    <>
      <div className="px-5 pt-5">
        <h1 className="font-display text-[28px] font-semibold">Board</h1>
        <div className="mt-0.5 text-[12.5px] font-semibold text-ink3">Where did you land? Tap a space to see who owns it and what's due.</div>
      </div>
      <div className="mx-4 mt-3">
        <input
          aria-label="Search spaces"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a space"
          className="h-12 w-full rounded-[14px] border border-line bg-surface px-4 text-[15px] font-semibold outline-none placeholder:text-ink3 focus:border-gold"
        />
      </div>
      {q ? (
        <div className="mx-4 mt-3 grid grid-cols-3 gap-2">
          {matches.length === 0 && <div className="col-span-3 py-6 text-center text-sm font-semibold text-ink3">No space with that name.</div>}
          {matches.map((s) => (
            <Tile key={s.id} game={game} space={s} me={me} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="mx-4 mt-4">
            <div className="flex items-center gap-2 px-1 pb-1.5">
              <span className="h-3 w-7 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.2)]" style={{ background: GROUP_COLOURS[g.key] }} />
              <span className="text-[11.5px] font-extrabold tracking-[.14em] text-ink2">{GROUP_LABELS[g.key].toUpperCase()}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {g.spaces.map((s) => (
                <Tile key={s.id} game={game} space={s} me={me} onOpen={onOpen} />
              ))}
            </div>
          </div>
        ))
      )}
      <div className="mx-5 mt-5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] font-semibold text-ink3">
        <span>Fill = owner</span>
        <span>Gold ring = mine</span>
        <span>Dashed = for sale</span>
        <span>Hatched = mortgaged</span>
      </div>
    </>
  );
}

/** My deeds by colour, on the Me tab. */
export function MyDeeds({ game, me, onOpen }: { game: MonoGame; me: MonoPlayer; onOpen: (id: string) => void }) {
  const gs = useGameState(game);
  const fmt = useMoney(game);
  const mine = ownableSpaces(game.boardSnapshot).filter((s) => gs.props[s.id]?.owner === me._id);
  if (!game.settings.trackProperties || mine.length === 0) return null;
  const byKey = GROUP_ORDER.map((k) => ({ key: k, spaces: mine.filter((s) => groupKeyOf(s) === k) })).filter((g) => g.spaces.length > 0);
  return (
    <>
      <div className="px-5 pt-[22px]">
        <div className="text-[10.5px] font-extrabold tracking-[.16em] text-ink3">MY DEEDS · {mine.length}</div>
      </div>
      <div className="mx-4 mt-2 overflow-hidden rounded-[20px] border border-line bg-surface">
        {byKey.map((g) =>
          g.spaces.map((s) => {
            const p = gs.props[s.id];
            const level = levelOf(p);
            return (
              <button key={s.id} onClick={() => onOpen(s.id)} className="press flex w-full items-center gap-3 border-b border-line px-3.5 py-3 text-left last:border-b-0">
                <span className="h-9 w-2 flex-none rounded-[3px]" style={{ background: GROUP_COLOURS[g.key] }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-extrabold">{s.name}</span>
                  <span className="block text-[11.5px] font-semibold text-ink3">{p.mortgaged ? "Mortgaged" : p.hotel ? "Hotel" : level > 0 ? `${level} house${level > 1 ? "s" : ""}` : GROUP_LABELS[g.key]}</span>
                </span>
                <span className="text-[12.5px] font-bold text-ink2 tabular-nums">{fmt(s.price ?? 0)}</span>
              </button>
            );
          }),
        )}
      </div>
    </>
  );
}
