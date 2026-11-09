"use client";

import { useConvex } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BackButton, GoldButton, TextField } from "@/components/ui/controls";
import { NameGrid } from "@/components/ui/NameGrid";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useSubmit } from "@/hooks/useSubmit";
import { newKey } from "@/lib/errors";
import { useUi } from "@/stores/ui";

const DEFAULT_START = 2000;

export default function NewSessionPage() {
  const router = useRouter();
  const convex = useConvex();
  const crews = useAuthedQuery(api.crews.mine, {});
  const lastMember = useUi((s) => s.lastMember);
  const { pending, run } = useSubmit();

  const [crewChoice, setCrewChoice] = useState<Id<"crews"> | "new" | null>(null);
  const [crewName, setCrewName] = useState("");
  const [memberChoice, setMemberChoice] = useState<string | null>(null);
  const [hostName, setHostName] = useState("");
  const [sessionName, setSessionName] = useState("");

  // Default to the most recently used crew, or a brand-new one.
  useEffect(() => {
    if (crews && crewChoice === null) setCrewChoice(crews[0]?._id ?? "new");
  }, [crews, crewChoice]);

  const existingCrew = crewChoice && crewChoice !== "new" ? crewChoice : null;
  const members = useAuthedQuery(api.crews.members, existingCrew ? { crewId: existingCrew } : "skip");

  // Preselect the name this phone last played as in that crew.
  useEffect(() => {
    if (!existingCrew || !members) return;
    const remembered = lastMember[existingCrew];
    setMemberChoice(members.some((m) => m._id === remembered) ? remembered : null);
  }, [existingCrew, members, lastMember]);

  const typingHost = !existingCrew || memberChoice === "new";
  const ready =
    crewChoice !== null &&
    (existingCrew ? true : crewName.trim().length > 0) &&
    (typingHost ? hostName.trim().length > 0 : memberChoice !== null);

  const create = () =>
    run(async () => {
      const res = await convex.mutation(api.sessions.create, {
        crewId: existingCrew ?? undefined,
        newCrewName: existingCrew ? undefined : crewName,
        hostMemberId: !typingHost ? (memberChoice as Id<"crewMembers">) : undefined,
        hostName: typingHost ? hostName : undefined,
        name: sessionName.trim() || undefined,
        walletMode: "equal",
        startingAmount: DEFAULT_START,
        theme: "inr",
        idempotencyKey: newKey(),
      });
      router.replace(`/s/${res.code}`);
    });

  return (
    <main className="room mx-auto min-h-dvh w-full max-w-[520px] pb-40 text-ink">
      <div className="flex items-center gap-2.5 px-4" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <div className="pt-3">
          <BackButton href="/" />
        </div>
      </div>
      <div className="px-[22px] pt-5">
        <h1 className="font-display text-[34px] font-semibold leading-[1.1]">New table</h1>
        <p className="mt-1.5 text-sm text-ink2">You’ll be the host. You can set wallets and games in the lobby.</p>
      </div>

      {crews === undefined ? (
        <div className="skeleton mx-4 mt-6 h-24 rounded-[20px] bg-surface2" aria-busy="true" />
      ) : (
        <>
          <div className="mx-4 mt-6 rounded-[20px] border border-line bg-surface p-4">
            {crews.length > 0 && (
              <div className="text-[11px] font-extrabold tracking-[.14em] text-ink3">CREW</div>
            )}
            {crews.length > 0 && (
              <div className="no-scrollbar -mx-1 mt-2.5 flex gap-2 overflow-x-auto px-1 pb-1">
                {[...crews.map((c) => ({ id: c._id as string, label: c.name })), { id: "new", label: "+ New crew" }].map((c) => {
                  const on = crewChoice === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setCrewChoice(c.id as Id<"crews"> | "new")}
                      aria-pressed={on}
                      className="press h-11 flex-none whitespace-nowrap rounded-[22px] px-4 text-[13.5px] font-extrabold"
                      style={{
                        border: `1px solid ${on ? "var(--gold)" : "var(--line)"}`,
                        background: on ? "var(--gold)" : "transparent",
                        color: on ? "var(--on-gold)" : "var(--ink2)",
                      }}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            )}
            {!existingCrew && (
              <div className={crews.length > 0 ? "mt-3" : "mt-1"}>
                <TextField label="Crew name" value={crewName} onChange={setCrewName} placeholder="Friday Night Crew" autoFocus={crews.length === 0} />
                <div className="mt-2 text-xs text-ink3">Everyone who joins becomes part of this crew, and their results add up over time.</div>
              </div>
            )}
          </div>

          <div className="px-[22px] pt-6 font-display text-[22px] font-semibold">Who are you?</div>
          {existingCrew ? (
            members === undefined ? (
              <div className="skeleton mx-4 mt-3 h-[118px] rounded-[20px] bg-surface2" />
            ) : (
              <NameGrid people={members.map((m) => ({ id: m._id, name: m.name }))} selected={memberChoice} onSelect={setMemberChoice} />
            )
          ) : null}
          {typingHost && (
            <div className="mx-4 mt-3 rounded-[20px] border border-line bg-surface p-4">
              <TextField label="Your name" value={hostName} onChange={setHostName} placeholder="Priya" autoFocus={!!existingCrew} />
            </div>
          )}

          <div className="mx-4 mt-3 rounded-[20px] border border-line bg-surface p-4">
            <TextField label="Session name (optional)" value={sessionName} onChange={setSessionName} placeholder="Diwali Teen Patti" maxLength={40} />
          </div>
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10" style={{ background: "linear-gradient(transparent, var(--bg) 35%)" }}>
        <div className="mx-auto max-w-[520px] px-4 pt-[18px]" style={{ paddingBottom: "max(30px, env(safe-area-inset-bottom))" }}>
          <GoldButton disabled={!ready} pending={pending} onClick={create}>
            Create session
          </GoldButton>
        </div>
      </div>
    </main>
  );
}
