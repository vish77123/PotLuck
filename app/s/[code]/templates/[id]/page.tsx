"use client";

import { useConvex } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AmountStepper } from "@/components/ui/AmountStepper";
import { BackButton, GoldButton, Segmented, Toggle } from "@/components/ui/controls";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useSubmit } from "@/hooks/useSubmit";
import { normalizeCode } from "@/lib/format";
import { PRESET_TEMPLATES, type TemplateDraft } from "@/lib/presets";

const BLANK: TemplateDraft = { name: "", boot: 10, minBet: 10, turnMode: "turn_based", teamMode: "solo" };
const MULTIPLIERS = [1.5, 2, 3];

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[66px] items-center gap-3 border-b border-line">
      <div className="flex-1">
        <div className="text-[15px] font-bold">{label}</div>
        <div className="text-xs text-ink3">{hint}</div>
      </div>
      {children}
    </div>
  );
}

export default function TemplateEditorPage() {
  const router = useRouter();
  const convex = useConvex();
  const params = useParams<{ code: string; id: string }>();
  const code = normalizeCode(params.code ?? "");
  const isNew = params.id === "new";
  const info = useAuthedQuery(api.sessions.joinInfo, { code });
  const sessionId = info?.myPlayerId ? info.sessionId : undefined;
  const state = useAuthedQuery(api.sessions.state, sessionId ? { sessionId } : "skip");
  const { pending, run } = useSubmit();

  const [draft, setDraft] = useState<TemplateDraft | null>(isNew ? BLANK : null);
  const [preset, setPreset] = useState<string>("Custom");

  // Load an existing template once.
  useEffect(() => {
    if (draft || !state || isNew) return;
    const t = state.templates.find((x) => x._id === params.id);
    if (!t) return;
    setDraft({
      name: t.name,
      boot: t.boot,
      minBet: t.minBet,
      maxBet: t.maxBet,
      blindSeenMultiplier: t.blindSeenMultiplier,
      turnMode: t.turnMode,
      teamMode: t.teamMode,
      confirmAbove: t.confirmAbove,
    });
    setPreset(PRESET_TEMPLATES.some((p) => p.name === t.name) ? t.name : "Custom");
  }, [state, draft, isNew, params.id]);

  if (state && !state.isHost) {
    return (
      <main className="room mx-auto min-h-dvh w-full max-w-[520px] px-4 text-ink" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <div className="pt-3">
          <BackButton href={`/s/${code}`} />
        </div>
        <p className="mt-10 text-ink2">Only the host can edit games.</p>
      </main>
    );
  }
  if (!state || !draft) {
    return (
      <main className="room mx-auto min-h-dvh w-full max-w-[520px] px-4 text-ink" aria-busy="true">
        <div className="skeleton mt-24 h-64 rounded-[20px] bg-surface2" />
      </main>
    );
  }

  const set = (patch: Partial<TemplateDraft>) => setDraft({ ...draft, ...patch });
  const blind = draft.blindSeenMultiplier !== undefined;
  const valid = draft.name.trim().length > 0;

  const save = () =>
    run(async () => {
      const fields = {
        name: draft.name,
        boot: draft.boot,
        minBet: draft.minBet,
        turnMode: draft.turnMode,
        teamMode: draft.teamMode,
        ...(draft.maxBet ? { maxBet: draft.maxBet } : {}),
        ...(draft.blindSeenMultiplier ? { blindSeenMultiplier: draft.blindSeenMultiplier } : {}),
        ...(draft.confirmAbove ? { confirmAbove: draft.confirmAbove } : {}),
      };
      await convex.mutation(api.crews.saveTemplate, {
        crewId: state.crew._id,
        templateId: isNew ? undefined : (params.id as Id<"gameTemplates">),
        ...fields,
      });
      router.replace(`/s/${code}`);
    });

  const remove = () =>
    run(async () => {
      await convex.mutation(api.crews.archiveTemplate, { templateId: params.id as Id<"gameTemplates"> });
      router.replace(`/s/${code}`);
    });

  return (
    <main className="room mx-auto min-h-dvh w-full max-w-[520px] pb-44 text-ink">
      <div className="flex items-center gap-2.5 px-4" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <div className="flex w-full items-center gap-2.5 pt-3">
          <BackButton href={`/s/${code}`} />
          <div className="font-display flex-1 text-[22px] font-semibold">Game template</div>
          <button disabled={!valid || pending} onClick={save} className="h-11 px-1 text-sm font-extrabold text-gold-ink disabled:opacity-40">
            Save
          </button>
        </div>
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pt-4">
        {[...PRESET_TEMPLATES.map((p) => p.name), "Custom"].map((name) => {
          const on = preset === name;
          return (
            <button
              key={name}
              onClick={() => {
                setPreset(name);
                const p = PRESET_TEMPLATES.find((x) => x.name === name);
                setDraft(p ? { ...p } : { ...BLANK });
              }}
              className="press h-11 flex-none rounded-[20px] px-3.5 text-[13.5px] font-extrabold"
              style={{
                border: `1px solid ${on ? "var(--gold)" : "var(--line)"}`,
                background: on ? "var(--gold)" : "transparent",
                color: on ? "var(--on-gold)" : "var(--ink2)",
              }}
            >
              {name}
            </button>
          );
        })}
      </div>

      <div className="mx-4 mt-4 rounded-[20px] border border-line bg-surface px-4 py-1">
        <label className="block border-b border-line py-3">
          <span className="text-[11px] font-extrabold tracking-[.14em] text-ink3">NAME</span>
          <input
            value={draft.name}
            maxLength={24}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Teen Patti"
            autoComplete="off"
            className="font-display mt-0.5 block h-11 w-full bg-transparent text-[22px] font-semibold outline-none placeholder:text-ink3"
          />
        </label>
        <Row label="Boot amount" hint="Everyone puts this in to start">
          <AmountStepper label="Boot amount" value={draft.boot} onChange={(boot) => set({ boot })} step={10} zeroLabel="None" />
        </Row>
        <Row label="Min bet" hint="Smallest bet allowed">
          <AmountStepper label="Min bet" value={draft.minBet} min={1} onChange={(minBet) => set({ minBet, maxBet: draft.maxBet && draft.maxBet < minBet ? minBet : draft.maxBet })} step={10} />
        </Row>
        <Row label="Max bet" hint="Biggest single bet">
          <AmountStepper
            label="Max bet"
            value={draft.maxBet ?? 0}
            onChange={(v) => set({ maxBet: v === 0 ? undefined : Math.max(v, draft.minBet) })}
            step={50}
            zeroLabel="No limit"
          />
        </Row>
        <div className="py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[15px] font-bold">Blind / Seen</div>
              <div className="text-xs text-ink3">Seen players bet a multiple of blind</div>
            </div>
            <Toggle label="Blind / Seen" on={blind} onChange={(on) => set({ blindSeenMultiplier: on ? 2 : undefined })} />
          </div>
          {blind && (
            <div className="mt-3">
              <Segmented
                height={44}
                value={draft.blindSeenMultiplier!}
                onChange={(blindSeenMultiplier) => set({ blindSeenMultiplier })}
                options={MULTIPLIERS.map((m) => ({ value: m, label: m === draft.blindSeenMultiplier ? `${m}× seen` : `${m}×` }))}
              />
            </div>
          )}
        </div>
      </div>

      <div className="mx-4 mt-3 flex flex-col gap-3.5 rounded-[20px] border border-line bg-surface px-4 py-3.5">
        <div>
          <div className="text-[15px] font-bold">Turn mode</div>
          <div className="mb-2 text-xs text-ink3">Who can bet when</div>
          <Segmented
            height={44}
            value={draft.turnMode}
            onChange={(turnMode) => set({ turnMode })}
            options={[
              { value: "turn_based", label: "Turn-based" },
              { value: "free_form", label: "Free-form" },
            ]}
          />
        </div>
        <div>
          <div className="text-[15px] font-bold">Team mode</div>
          <div className="mb-2 text-xs text-ink3">How the pot is won</div>
          <Segmented
            height={44}
            value={draft.teamMode}
            onChange={(teamMode) => set({ teamMode })}
            options={[
              { value: "solo", label: "Solo" },
              { value: "team", label: "Teams" },
            ]}
          />
        </div>
      </div>

      <div className="mx-4 mt-3 flex items-center gap-3 rounded-[20px] border border-line-gold bg-surface px-4 py-3.5">
        <div className="flex-1">
          <div className="text-[15px] font-bold">Confirm bets above</div>
          <div className="text-xs text-ink3">Big bets ask “Place ₹X?” first</div>
        </div>
        <AmountStepper label="Confirm above" value={draft.confirmAbove ?? 0} onChange={(v) => set({ confirmAbove: v || undefined })} step={50} zeroLabel="Never" />
      </div>

      {!isNew && (
        <div className="mt-4 text-center">
          <button disabled={pending} onClick={remove} className="h-11 px-4 text-[13.5px] font-bold text-down">
            Remove this game
          </button>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10" style={{ background: "linear-gradient(transparent, var(--bg) 35%)" }}>
        <div className="mx-auto max-w-[520px] px-4 pt-[18px]" style={{ paddingBottom: "max(30px, env(safe-area-inset-bottom))" }}>
          <GoldButton pending={pending} disabled={!valid} onClick={save}>
            Save template
          </GoldButton>
        </div>
      </div>
    </main>
  );
}
