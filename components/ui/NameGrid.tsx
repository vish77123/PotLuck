"use client";

import { Avatar } from "@/components/ui/Avatar";

export type Person = { id: string; name: string; taken?: boolean; pending?: boolean };

/** "Who's playing?" — pick your name from the crew list, or add a new one. 3 columns, 118px tiles. */
export function NameGrid({
  people,
  selected,
  onSelect,
}: {
  people: Person[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mx-4 mt-5 grid grid-cols-3 gap-2.5">
      {people.map((p) => {
        const on = selected === p.id;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            aria-pressed={on}
            aria-label={p.taken ? `${p.name}, already at the table on another phone` : p.name}
            className="press relative flex h-[118px] flex-col items-center justify-center gap-2 rounded-[20px] pt-[14px]"
            style={{
              background: on ? "var(--surface2)" : "var(--surface)",
              border: on ? "2px solid var(--gold)" : "1px solid var(--line)",
              boxShadow: on ? "var(--glow)" : undefined,
              opacity: p.taken && !on ? 0.55 : 1,
            }}
          >
            <Avatar name={p.name} size={56} />
            <div className="max-w-full truncate px-1 text-sm font-bold">{p.name}</div>
            {p.taken && !on && (
              <div className="absolute right-2 top-1.5 text-[9.5px] font-extrabold tracking-[.08em] text-ink3">{p.pending ? "ASKED" : "AT TABLE"}</div>
            )}
            {on && (
              <div className="absolute right-2 top-2 grid h-[22px] w-[22px] place-items-center rounded-full bg-gold text-[13px] font-black text-on-gold">✓</div>
            )}
          </button>
        );
      })}
      <button
        onClick={() => onSelect("new")}
        aria-pressed={selected === "new"}
        aria-label="Add a new name"
        className="press flex h-[118px] flex-col items-center justify-center gap-2 rounded-[20px] border-[1.5px] border-dashed text-gold-ink"
        style={{ borderColor: selected === "new" ? "var(--gold)" : "var(--line-gold)", background: selected === "new" ? "var(--surface2)" : undefined }}
      >
        <div className="grid h-14 w-14 place-items-center rounded-full border-[1.5px] border-dashed text-[28px] font-light" style={{ borderColor: "var(--line-gold)" }}>
          +
        </div>
        <div className="text-sm font-bold">New name</div>
      </button>
    </div>
  );
}
