"use client";

import { useConvex } from "convex/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GamesCard } from "@/components/lobby/GamesCard";
import { PlayerGrid } from "@/components/lobby/PlayerGrid";
import { RoomCard } from "@/components/lobby/RoomCard";
import { SeatsSheet } from "@/components/lobby/SeatsSheet";
import { StartGameSheet } from "@/components/lobby/StartGameSheet";
import { ThemeCards } from "@/components/lobby/ThemeCards";
import type { SessionState } from "@/components/lobby/types";
import { WalletCard } from "@/components/lobby/WalletCard";
import { BackButton, GoldButton, SectionTitle, SecondaryButton, TextField } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/Sheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useNow } from "@/hooks/useNow";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
import { useSubmit } from "@/hooks/useSubmit";
import { formatInr } from "@/lib/format";
import { useUi } from "@/stores/ui";

export function LobbyScreen({ code, state }: { code: string; state: SessionState }) {
  const { session, crew, players, templates, isHost, meId } = state;
  const convex = useConvex();
  const rememberMember = useUi((s) => s.rememberMember);
  const presence = useAuthedQuery(api.presence.list, { sessionId: session._id });
  const now = useNow();
  usePresenceHeartbeat(session._id);

  const me = players.find((p) => p._id === meId);
  const host = players.find((p) => p._id === session.hostPlayerId);
  useEffect(() => {
    if (me) rememberMember(crew._id, me.crewMemberId);
  }, [me, crew._id, rememberMember]);

  const seen = useMemo(() => new Map((presence ?? []).map((r) => [r.playerId as string, r.lastSeenAt])), [presence]);
  const seated = players.filter((p) => p.status === "active");

  const [selectedTemplate, setSelectedTemplate] = useState<Id<"gameTemplates"> | null>(null);
  const activeTemplate = templates.find((t) => t._id === selectedTemplate) ?? templates[0] ?? null;

  const [seatsOpen, setSeatsOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const { pending, run } = useSubmit();
  const pendingPhones = players.filter((p) => p.rebindPending);

  const rename = () =>
    run(async () => {
      await convex.mutation(api.sessions.renameMe, { sessionId: session._id, name: newName });
      setRenameOpen(false);
    });

  return (
    <main className="room relative mx-auto min-h-dvh w-full max-w-[520px] pb-44 text-ink">
      <div className="flex items-center gap-2.5 px-4" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <div className="flex w-full items-center gap-2.5 pt-3">
          <BackButton href="/" />
          <div className="font-display min-w-0 flex-1 truncate text-[22px] font-semibold">{session.name ?? crew.name}</div>
          {isHost && <div className="rounded-xl border border-line-gold px-2.5 py-1.5 text-[11.5px] font-extrabold tracking-[.1em] text-gold-ink">♛ HOST</div>}
        </div>
      </div>

      <RoomCard code={code} />

      {isHost && pendingPhones.length > 0 && (
        <button onClick={() => setSeatsOpen(true)} className="press mx-4 mt-3 flex w-[calc(100%-32px)] items-center gap-3 rounded-[18px] border border-line-gold bg-surface p-3.5 text-left">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-gold text-[15px] font-black text-on-gold">!</span>
          <span className="flex-1 text-[13.5px] font-semibold leading-snug">
            {pendingPhones.map((p) => p.name).join(", ")} {pendingPhones.length > 1 ? "have" : "has"} a new phone and want{pendingPhones.length > 1 ? "" : "s"} their seat back. Tap to review.
          </span>
        </button>
      )}

      <div className="flex items-center justify-between px-5 pt-[22px]">
        <h2 className="text-base font-extrabold">At the table · {seated.length}</h2>
        <div className="flex items-center gap-3">
          {isHost && (
            <button onClick={() => setSeatsOpen(true)} className="h-11 text-[13px] font-bold text-gold-ink">
              Seats
            </button>
          )}
          <div className="flex items-center gap-1.5 text-xs font-bold text-up">
            <span className="h-2 w-2 rounded-full bg-up" style={{ boxShadow: "0 0 0 4px rgba(111,213,154,.2)" }} />
            Joining live
          </div>
        </div>
      </div>
      <PlayerGrid players={players} meId={meId} seen={seen} now={now} />

      {isHost ? (
        <>
          <SectionTitle>Wallets</SectionTitle>
          <WalletCard session={session} />
          <SectionTitle>Money theme</SectionTitle>
          <ThemeCards sessionId={session._id} theme={session.theme} />
          <SectionTitle
            action={
              <Link href={`/s/${code}/templates/new`} className="grid h-11 place-items-center text-[13px] font-bold text-gold-ink">
                + New template
              </Link>
            }
          >
            Games
          </SectionTitle>
          <GamesCard code={code} crewId={crew._id} templates={templates} selectedId={activeTemplate?._id ?? null} onSelect={setSelectedTemplate} />
        </>
      ) : (
        <>
          <div className="mx-4 mt-3.5 flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-4">
            {[
              { k: "Wallet", v: session.walletMode === "equal" ? `${formatInr(session.startingAmount)} each` : "Custom per player" },
              { k: "You have", v: formatInr(me?.balance ?? 0) },
              { k: "Money", v: session.theme === "inr" ? "INR notes" : "Casino chips" },
              { k: "Games", v: templates.map((t) => t.name).join(" · ") || "None yet" },
            ].map((r) => (
              <div key={r.k} className="flex justify-between gap-4 text-sm">
                <span className="font-semibold text-ink2">{r.k}</span>
                <span className="text-right font-extrabold">{r.v}</span>
              </div>
            ))}
          </div>
          <div className="mx-4 mt-[22px] text-center">
            <div className="flex justify-center gap-2" aria-hidden>
              {[1, 0.55, 0.25].map((o, i) => (
                <span key={i} className="h-2 w-2 rounded-full bg-gold" style={{ opacity: o, animation: `pl-pulse 1.6s ${i * 0.25}s ease-in-out infinite` }} />
              ))}
            </div>
            <div className="font-display mt-3 text-[22px] font-semibold">Waiting for {host?.name ?? "the host"} to start</div>
            <div className="mt-1 text-[13px] text-ink3">You’ll jump to the table automatically.</div>
          </div>
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10" style={{ background: "linear-gradient(transparent, var(--bg) 35%)" }}>
        <div className="mx-auto max-w-[520px] px-4 pt-[18px]" style={{ paddingBottom: "max(30px, env(safe-area-inset-bottom))" }}>
          {isHost ? (
            <>
              <GoldButton disabled={!activeTemplate || seated.length < 2} onClick={() => setStartOpen(true)}>
                {activeTemplate ? `Start ${activeTemplate.name}` : "Add a game to start"}
              </GoldButton>
              {activeTemplate && seated.length < 2 && <div className="mt-2 text-center text-xs font-semibold text-ink3">Waiting for at least one more player.</div>}
            </>
          ) : (
            session.status === "lobby" && (
              <SecondaryButton
                className="w-full !h-[58px] !rounded-[18px] !text-[15px]"
                onClick={() => {
                  setNewName(me?.name ?? "");
                  setRenameOpen(true);
                }}
              >
                Change my name
              </SecondaryButton>
            )
          )}
        </div>
      </div>

      {isHost && <SeatsSheet open={seatsOpen} onClose={() => setSeatsOpen(false)} state={state} />}
      {isHost && activeTemplate && <StartGameSheet open={startOpen} onClose={() => setStartOpen(false)} state={state} template={activeTemplate} />}

      <Sheet open={renameOpen} onClose={() => setRenameOpen(false)} title="Change my name" subtitle="Updates your name in the whole crew.">
        <div className="mt-3.5">
          <TextField label="Your name" value={newName} onChange={setNewName} autoFocus onEnter={rename} />
        </div>
        <div className="mt-4 grid gap-2.5">
          <GoldButton pending={pending} disabled={!newName.trim() || newName.trim() === me?.name} onClick={rename}>
            Save name
          </GoldButton>
        </div>
      </Sheet>
    </main>
  );
}
