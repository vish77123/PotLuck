"use client";

import { useConvex } from "convex/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AmountStepper } from "@/components/ui/AmountStepper";
import { BackButton, GoldButton, SecondaryButton, TextField } from "@/components/ui/controls";
import { NameGrid } from "@/components/ui/NameGrid";
import { Sheet } from "@/components/ui/Sheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useSubmit } from "@/hooks/useSubmit";
import { newKey } from "@/lib/errors";
import { formatInr, normalizeCode } from "@/lib/format";
import { useUi } from "@/stores/ui";

export default function JoinPage() {
  const router = useRouter();
  const convex = useConvex();
  const params = useParams<{ code: string }>();
  const code = normalizeCode(params.code ?? "");
  const info = useAuthedQuery(api.sessions.joinInfo, { code });
  const lastMember = useUi((s) => s.lastMember);
  const pushToast = useUi((s) => s.pushToast);
  const { pending, run } = useSubmit();

  const [selected, setSelected] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");
  const [buyIn, setBuyIn] = useState<number | null>(null);
  const [askAbout, setAskAbout] = useState<string | null>(null);

  // Already seated on this phone → straight to the table.
  useEffect(() => {
    if (info?.myPlayerId && info.myStatus === "active") router.replace(`/s/${code}`);
  }, [info, router, code]);

  // Preselect "you": the name this phone is already using here, else the one it last played as in this crew.
  const preselect = useMemo(() => {
    if (!info) return null;
    const mine = info.members.find((m) => m.onThisPhone);
    if (mine) return mine._id;
    const remembered = info.members.find((m) => m._id === lastMember[info.crewId]);
    return remembered && !remembered.atTable ? remembered._id : null;
  }, [info, lastMember]);
  useEffect(() => {
    if (selected === null && preselect) setSelected(preselect);
  }, [preselect, selected]);

  if (info === undefined) {
    return (
      <main className="room mx-auto w-full max-w-[520px] px-4 text-ink" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }} aria-busy="true">
        <div className="skeleton mt-16 h-10 w-52 rounded-xl bg-surface3" />
        <div className="skeleton mt-6 grid grid-cols-3 gap-2.5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[118px] rounded-[20px] bg-surface2" />
          ))}
        </div>
      </main>
    );
  }

  if (info === null) {
    return (
      <main className="room mx-auto flex w-full max-w-[520px] flex-col px-4 text-ink" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <div className="pt-3">
          <BackButton href="/" />
        </div>
        <div className="mt-16 px-1">
          <h1 className="font-display text-[34px] font-semibold leading-[1.1]">No table with that code</h1>
          <p className="mt-2 text-sm text-ink2">
            <span className="font-bold tracking-[.18em] text-gold-ink">{code || "—"}</span> doesn’t match a session. Check the code with your host and try again.
          </p>
          <Link href="/" className="gold-btn mt-6 grid h-[58px] place-items-center rounded-[18px] text-[16.5px]">
            Back home
          </Link>
        </div>
      </main>
    );
  }

  if (info.status === "ended") {
    return (
      <main className="room mx-auto w-full max-w-[520px] px-4 text-ink" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <div className="pt-3">
          <BackButton href="/" />
        </div>
        <div className="mt-16 px-1">
          <h1 className="font-display text-[34px] font-semibold leading-[1.1]">This session has ended</h1>
          <p className="mt-2 text-sm text-ink2">{info.crewName} is done for the night.</p>
          {info.myPlayerId && (
            <Link href={`/s/${code}/report`} className="gold-btn mt-6 grid h-[58px] place-items-center rounded-[18px] text-[16.5px]">
              See the report
            </Link>
          )}
        </div>
      </main>
    );
  }

  const choosingNew = selected === "new";
  const chosen = info.members.find((m) => m._id === selected);
  const chosenName = choosingNew ? typedName.trim() : chosen?.name ?? "";
  const custom = info.walletMode === "custom";
  const stake = buyIn ?? info.startingAmount;
  const askMember = info.members.find((m) => m._id === askAbout);
  const rejoining = !!info.myPlayerId && info.myStatus === "left";

  const people = info.members.map((m) => ({
    id: m._id as string,
    name: m.name,
    taken: m.atTable && !m.onThisPhone,
    pending: m.rebindPending,
  }));

  const onSelect = (id: string) => {
    const m = info.members.find((x) => x._id === id);
    if (m && m.atTable && !m.onThisPhone) {
      setAskAbout(id);
      return;
    }
    setSelected(id);
  };

  const join = () =>
    run(async () => {
      await convex.mutation(api.sessions.join, {
        code,
        crewMemberId: choosingNew ? undefined : (selected as Id<"crewMembers">),
        newName: choosingNew ? typedName : undefined,
        buyIn: custom ? stake : undefined,
        idempotencyKey: newKey(),
      });
      router.replace(`/s/${code}`);
    });

  const askHost = () =>
    run(async () => {
      await convex.mutation(api.sessions.requestRebind, { code, crewMemberId: askAbout as Id<"crewMembers"> });
      pushToast({ text: `Asked the host to move ${askMember?.name} to this phone.` });
      setAskAbout(null);
    });

  return (
    <main className="room mx-auto min-h-dvh w-full max-w-[520px] pb-64 text-ink">
      <div className="flex items-center gap-2.5 px-4" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <div className="flex items-center gap-2.5 pt-3">
          <BackButton href="/" />
          <div className="rounded-xl border border-line-gold bg-surface px-3 py-[7px] text-[13px] font-extrabold tracking-[.18em] text-gold-ink">{info.code}</div>
        </div>
      </div>
      <div className="px-[22px] pt-[22px]">
        <h1 className="font-display text-[34px] font-semibold leading-[1.1]">Who’s playing?</h1>
        <p className="mt-1.5 text-sm text-ink2">
          {info.sessionName ? `${info.sessionName} · ` : ""}
          {info.crewName}
          {info.hostName ? ` · hosted by ${info.hostName}` : ""}
        </p>
      </div>

      <NameGrid people={people} selected={selected} onSelect={onSelect} />

      {choosingNew && (
        <div className="mx-4 mt-3 rounded-[20px] border border-line bg-surface p-4">
          <TextField label="Your name" value={typedName} onChange={setTypedName} placeholder="Priya" autoFocus onEnter={() => chosenName && join()} />
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10" style={{ background: "linear-gradient(transparent, var(--bg) 30%)" }}>
        <div className="mx-auto max-w-[520px] px-4 pt-4" style={{ paddingBottom: "max(34px, env(safe-area-inset-bottom))" }}>
          {custom ? (
            <div className="mb-3 flex items-center justify-between rounded-[18px] border border-line bg-surface px-4 py-2.5">
              <div>
                <div className="text-[10.5px] font-extrabold tracking-[.16em] text-ink3">YOUR BUY-IN</div>
                <div className="text-xs text-ink3">Everyone picks their own</div>
              </div>
              <AmountStepper label="Buy-in" value={stake} onChange={setBuyIn} step={100} min={10} />
            </div>
          ) : (
            <div className="mb-3 text-center text-[13px] font-semibold text-ink2">
              {rejoining ? "Welcome back — " : "You’ll start with "}
              <span className="amount text-ink">{formatInr(info.startingAmount)}</span>
              {rejoining ? " in a fresh buy-in" : ""}
            </div>
          )}
          <GoldButton pending={pending} disabled={!chosenName} onClick={join}>
            {chosenName ? `Take a seat as ${chosenName}` : "Pick your name"}
          </GoldButton>
          <div className="mt-2.5 text-center text-[12.5px] font-semibold text-ink3">No login. Your name is remembered on this phone.</div>
        </div>
      </div>

      <Sheet open={!!askMember} onClose={() => setAskAbout(null)} title={askMember ? `Is that you, ${askMember.name}?` : ""}>
        <p className="mt-2 text-sm leading-relaxed text-ink2">
          {askMember?.name} is already at the table on another phone. If you’re on a new phone, ask the host to move the seat here — your wallet comes with it.
        </p>
        <div className="mt-4 grid gap-2.5">
          <GoldButton pending={pending} disabled={askMember?.rebindPending} onClick={askHost}>
            {askMember?.rebindPending ? "Waiting for the host…" : `Ask host to move ${askMember?.name ?? ""} here`}
          </GoldButton>
          <SecondaryButton onClick={() => setAskAbout(null)}>Never mind</SecondaryButton>
        </div>
      </Sheet>
    </main>
  );
}
