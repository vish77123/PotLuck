"use client";

import { useConvex } from "convex/react";
import Link from "next/link";
import { useSubmit } from "@/hooks/useSubmit";
import { api } from "@/convex/_generated/api";
import { PRESET_TEMPLATES } from "@/lib/presets";
import { templateMeta } from "@/lib/templates";
import type { TemplateRow } from "@/components/lobby/types";
import type { Id } from "@/convex/_generated/dataModel";

export function GamesCard({
  code,
  crewId,
  templates,
  selectedId,
  onSelect,
}: {
  code: string;
  crewId: Id<"crews">;
  templates: TemplateRow[];
  selectedId: Id<"gameTemplates"> | null;
  onSelect: (id: Id<"gameTemplates">) => void;
}) {
  const convex = useConvex();
  const { pending, run } = useSubmit();

  if (templates.length === 0) {
    return (
      <div className="mx-4 mt-2.5 rounded-[20px] border-[1.5px] border-dashed border-line-gold p-[22px] text-center">
        <div className="text-[15px] font-extrabold">No games yet</div>
        <div className="mt-1 text-[13px] leading-snug text-ink2">Start from a preset — you can tweak boot and limits after.</div>
        <div className="mt-3.5 flex flex-wrap justify-center gap-2">
          {PRESET_TEMPLATES.map((p) => (
            <button
              key={p.name}
              disabled={pending}
              onClick={() => run(() => convex.mutation(api.crews.saveTemplate, { crewId, ...p }))}
              className="press h-11 rounded-xl border border-line bg-surface2 px-3.5 text-[13px] font-bold"
            >
              + {p.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 mt-2.5 overflow-hidden rounded-[20px] border border-line bg-surface" role="radiogroup" aria-label="Game to play">
      {templates.map((t) => {
        const on = t._id === selectedId;
        return (
          <div key={t._id} className="flex items-center gap-3 border-b border-line last:border-b-0" style={{ background: on ? "var(--surface2)" : "transparent" }}>
            <button
              role="radio"
              aria-checked={on}
              onClick={() => onSelect(t._id)}
              className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 py-3.5 pl-4 text-left"
            >
              <span className="box-border h-[22px] w-[22px] flex-none rounded-full" style={{ border: on ? "7px solid var(--gold)" : "2px solid var(--ink3)" }} />
              <span className="min-w-0 flex-1">
                <span className="font-display block truncate text-lg font-semibold">{t.name}</span>
                <span className="mt-0.5 block text-xs font-semibold text-ink3">{templateMeta(t)}</span>
              </span>
            </button>
            <Link href={`/s/${code}/templates/${t._id}`} className="grid h-11 min-w-11 place-items-center pr-4 text-[13px] font-bold text-gold-ink">
              Edit
            </Link>
          </div>
        );
      })}
    </div>
  );
}
