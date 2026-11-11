"use client";

import { useConvex } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { BackButton, GoldButton, Segmented, TextField, Toggle } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/Dialog";
import { Sheet } from "@/components/ui/Sheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useSubmit } from "@/hooks/useSubmit";
import { GROUP_COLOURS, GROUP_LABELS, GROUP_ORDER, groupKeyOf } from "@/lib/monopoly/colors";
import { formatMoney } from "@/lib/monopoly/money";
import { boardProblems, isOwnable } from "@/lib/monopoly/rules";
import { unverifiedItems } from "@/lib/monopoly/presets";
import type { BoardConfig, Space } from "@/lib/monopoly/types";
import { useUi } from "@/stores/ui";

function NumField({ label, value, onChange, hint }: { label: string; value: number | undefined; onChange: (n: number) => void; hint?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] font-extrabold tracking-[.14em] text-ink3">{label.toUpperCase()}</span>
      <input
        inputMode="numeric"
        value={value === undefined ? "" : String(value)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
        className="mt-1 block h-12 w-full rounded-[14px] border border-line bg-surface2 px-3.5 font-display text-[20px] font-semibold tabular-nums outline-none focus:border-gold"
      />
      {hint && <span className="mt-0.5 block text-[11.5px] font-semibold text-ink3">{hint}</span>}
    </label>
  );
}

const RENT_LABELS = ["Base rent", "1 house", "2 houses", "3 houses", "4 houses", "Hotel"];

function SpaceSheet({ space, currency, onChange, onClose }: { space: Space | null; currency: BoardConfig["currency"]; onChange: (s: Space) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Space | null>(space);
  useEffect(() => setDraft(space), [space]);
  if (!draft) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const set = (patch: Partial<Space>) => setDraft({ ...draft, ...patch });
  const setRent = (i: number, n: number) => set({ rent: (draft.rent ?? []).map((r, j) => (j === i ? n : r)) });
  return (
    <Sheet open onClose={onClose} title={draft.name} subtitle={`${GROUP_LABELS[groupKeyOf(draft)] ?? "Tax"} · amounts in ${currency}`}>
      <div className="mt-3 grid gap-3">
        <TextField label="Name" value={draft.name} onChange={(name) => set({ name })} maxLength={24} />
        {draft.kind === "tax" ? (
          <NumField label="Tax amount" value={draft.amount} onChange={(amount) => set({ amount })} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Price" value={draft.price} onChange={(price) => set({ price })} />
              <NumField label="Mortgage value" value={draft.mortgage} onChange={(mortgage) => set({ mortgage })} />
            </div>
            {draft.kind === "property" && <NumField label="House cost" value={draft.houseCost} onChange={(houseCost) => set({ houseCost })} hint="A hotel costs the same, on top of four houses." />}
            {draft.rent && (
              <div className="grid grid-cols-2 gap-3">
                {draft.rent.map((r, i) => (
                  <NumField key={i} label={draft.kind === "rail" ? `${i + 1} station${i ? "s" : ""}` : RENT_LABELS[i]} value={r} onChange={(n) => setRent(i, n)} />
                ))}
              </div>
            )}
          </>
        )}
        <div className="flex items-center gap-3 rounded-[16px] border border-line bg-surface2 px-4 py-3">
          <div className="flex-1">
            <div className="text-sm font-extrabold">Checked against my board</div>
            <div className="text-xs font-semibold text-ink3">Removes the "unchecked" flag.</div>
          </div>
          <Toggle on={draft.verified !== false} onChange={(v) => set({ verified: v })} label="Checked against my board" />
        </div>
        <GoldButton
          onClick={() => {
            onChange(draft);
            onClose();
          }}
        >
          Done
        </GoldButton>
      </div>
    </Sheet>
  );
}

/** The crew's own copy of a board: fix names and values to match the physical board. Games already started keep their snapshot. */
export function BoardEditor({ crewId, initialKey }: { crewId: Id<"crews">; initialKey?: string }) {
  const convex = useConvex();
  const data = useAuthedQuery(api.monoBoards.list, { crewId });
  const pushToast = useUi((s) => s.pushToast);
  const { pending, run } = useSubmit();
  const [key, setKey] = useState(initialKey ?? "classic");
  const [draft, setDraft] = useState<BoardConfig | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [resetAsk, setResetAsk] = useState(false);

  const served = data?.boards.find((b) => b.key === key);
  // Reload the draft when the preset changes or the server copy changes (after a save or reset).
  const servedJson = served ? JSON.stringify(served.board) : null;
  useEffect(() => {
    if (served) setDraft(structuredClone(served.board) as BoardConfig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, servedJson]);

  const dirty = !!draft && servedJson !== null && JSON.stringify(draft) !== servedJson;
  const problems = useMemo(() => (draft ? boardProblems(draft) : []), [draft]);
  const unchecked = draft ? unverifiedItems(draft) : [];

  if (!data || !draft || !served) return <div className="skeleton mx-4 mt-6 h-72 rounded-[22px] bg-surface2" aria-busy="true" />;

  const fmt = (n: number) => formatMoney(n, draft.currency);
  const setSpace = (s: Space) => setDraft({ ...draft, spaces: draft.spaces.map((x) => (x.id === s.id ? s : x)) });
  const markAllChecked = () => setDraft({ ...draft, verified: true, spaces: draft.spaces.map((s) => ({ ...s, verified: true })) });
  const board = (patch: Partial<BoardConfig>) => setDraft({ ...draft, ...patch });
  const editable = draft.spaces.filter((s) => isOwnable(s) || s.kind === "tax");
  const groups = [
    ...GROUP_ORDER.map((k) => ({ title: GROUP_LABELS[k], key: k, spaces: editable.filter((s) => s.kind !== "tax" && groupKeyOf(s) === k) })),
    { title: "Taxes", key: "tax", spaces: editable.filter((s) => s.kind === "tax") },
  ].filter((g) => g.spaces.length > 0);

  const save = () =>
    run(async () => {
      await convex.mutation(api.monoBoards.save, { crewId, presetKey: key, board: draft });
      pushToast({ text: "Board saved. New games use it." });
    });

  return (
    <>
      <div className="mx-4 mt-4">
        <Segmented
          value={key}
          onChange={setKey}
          options={data.boards.map((b) => ({ value: b.key, label: b.board.name }))}
          height={44}
        />
      </div>
      <div className="mx-4 mt-2.5 text-[12.5px] font-semibold leading-snug text-ink2">
        {served.saved ? "This crew has its own corrected copy." : "Using the shipped values."} Games already started keep the board they began with.
      </div>

      {unchecked.length > 0 && (
        <div className="mx-4 mt-3 rounded-[18px] border border-line-gold bg-surface p-3.5">
          <div className="text-[13px] font-extrabold text-warn">{unchecked.length} unchecked values</div>
          <div className="mt-1 text-[12.5px] font-semibold leading-snug text-ink2">These are placeholders. Check each against your physical board, fix what's different, then mark it checked.</div>
          <button onClick={markAllChecked} className="press mt-2.5 h-10 rounded-xl border border-line px-3 text-[12.5px] font-bold">
            Mark everything checked
          </button>
        </div>
      )}

      <div className="px-5 pt-5 text-[15px] font-extrabold">Whole board</div>
      <div className="mx-4 mt-2.5 grid grid-cols-2 gap-3 rounded-[20px] border border-line bg-surface p-4">
        <NumField label="Pass GO" value={draft.passGo} onChange={(passGo) => board({ passGo })} />
        <NumField label="Jail fine" value={draft.jailFine} onChange={(jailFine) => board({ jailFine })} />
        <NumField label="Starting cash" value={draft.startingCash} onChange={(startingCash) => board({ startingCash })} />
        <NumField label="Jail-free cards" value={draft.jailCards} onChange={(jailCards) => board({ jailCards })} hint="How many exist" />
        <NumField label="Houses in the bank" value={draft.houses} onChange={(houses) => board({ houses })} />
        <NumField label="Hotels in the bank" value={draft.hotels} onChange={(hotels) => board({ hotels })} />
        <NumField label="Utility rent ×, one owned" value={draft.utilityMultipliers[0]} onChange={(n) => board({ utilityMultipliers: [n, draft.utilityMultipliers[1]] })} />
        <NumField label="Utility rent ×, both owned" value={draft.utilityMultipliers[1]} onChange={(n) => board({ utilityMultipliers: [draft.utilityMultipliers[0], n] })} />
        <div className="col-span-2 flex items-center gap-3 rounded-[14px] bg-surface2 px-3.5 py-2.5">
          <div className="flex-1 text-[13px] font-extrabold">These values are checked</div>
          <Toggle on={draft.verified !== false} onChange={(v) => board({ verified: v })} label="Whole-board values checked" />
        </div>
      </div>

      {groups.map((g) => (
        <div key={g.key} className="mx-4 mt-5">
          <div className="flex items-center gap-2 px-1 pb-1.5">
            {g.key !== "tax" && <span className="h-3 w-7 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.2)]" style={{ background: GROUP_COLOURS[g.key] }} />}
            <span className="text-[11.5px] font-extrabold tracking-[.14em] text-ink2">{g.title.toUpperCase()}</span>
          </div>
          <div className="overflow-hidden rounded-[18px] border border-line bg-surface">
            {g.spaces.map((s) => (
              <button key={s.id} onClick={() => setEditing(s.id)} className="press flex w-full items-center gap-3 border-b border-line px-3.5 py-3 text-left last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-extrabold">{s.name}</span>
                  {s.verified === false && <span className="text-[11px] font-bold text-warn">unchecked</span>}
                </span>
                <span className="text-[13px] font-bold tabular-nums text-ink2">{fmt(s.kind === "tax" ? (s.amount ?? 0) : (s.price ?? 0))}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {served.saved && (
        <div className="mt-6 text-center">
          <button onClick={() => setResetAsk(true)} className="press h-11 rounded-xl border border-down px-4 text-[13px] font-bold text-down">
            Reset to the shipped values
          </button>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10" style={{ background: "linear-gradient(transparent, var(--bg) 35%)" }}>
        <div className="mx-auto max-w-[520px] px-4 pt-[18px]" style={{ paddingBottom: "max(30px, env(safe-area-inset-bottom))" }}>
          <GoldButton pending={pending} disabled={!dirty || problems.length > 0} onClick={save}>
            {dirty ? "Save board" : "No changes"}
          </GoldButton>
          {problems.length > 0 && <div className="mt-2 text-center text-xs font-semibold text-down">{problems[0]}</div>}
        </div>
      </div>

      <SpaceSheet space={draft.spaces.find((s) => s.id === editing) ?? null} currency={draft.currency} onChange={setSpace} onClose={() => setEditing(null)} />
      <Dialog
        open={resetAsk}
        eyebrow="RESET BOARD"
        eyebrowColor="var(--down)"
        title="Go back to the shipped values?"
        body="Your corrections to this board are discarded. Games already started aren't affected."
        noLabel="Keep my values"
        yesLabel="Reset"
        onNo={() => setResetAsk(false)}
        onYes={() =>
          run(async () => {
            await convex.mutation(api.monoBoards.reset, { crewId, presetKey: key });
            setResetAsk(false);
          })
        }
        pending={pending}
      />
    </>
  );
}

export function BoardEditorHeader({ crewId }: { crewId: Id<"crews"> }) {
  const data = useAuthedQuery(api.monoBoards.list, { crewId });
  return (
    <>
      <div className="flex items-center gap-2.5 px-4" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <div className="flex items-center gap-2.5 pt-3">
          <BackButton href={`/crew/${crewId}`} />
          <div className="text-[13px] font-bold tracking-[.1em] text-ink3">BOARD VALUES</div>
        </div>
      </div>
      <div className="px-5 pt-3.5">
        <h1 className="font-display text-[32px] font-semibold leading-[1.1]">{data?.crewName ?? " "}</h1>
        <div className="mt-1 text-[13.5px] text-ink2">Correct names and values so the app matches your physical board.</div>
      </div>
    </>
  );
}
