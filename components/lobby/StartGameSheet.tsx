"use client";

import { useConvex } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import type { SessionState, TemplateRow } from "@/components/lobby/types";
import { Avatar } from "@/components/ui/Avatar";
import { GoldButton, Segmented, Toggle } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/Sheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSubmit } from "@/hooks/useSubmit";
import { newKey } from "@/lib/errors";
import { formatInr } from "@/lib/format";
import { TEAMS } from "@/lib/seats";
import { useUi } from "@/stores/ui";

/** Host: who's in this game, and (for team games) which team each player is on. Teams can change every game. */
export function StartGameSheet({
  open,
  onClose,
  state,
  template,
}: {
  open: boolean;
  onClose: () => void;
  state: SessionState;
  template: TemplateRow;
}) {
  const convex = useConvex();
  const pushToast = useUi((s) => s.pushToast);
  const { pending, run } = useSubmit();
  const seated = useMemo(() => state.players.filter((p) => p.status === "active"), [state.players]);
  const isTeam = template.teamMode === "team";

  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [teams, setTeams] = useState<Record<string, number>>({});
  const [teamCount, setTeamCount] = useState(2);

  // Fresh defaults each time the sheet opens: everyone who can cover the boot, split across teams in seat order.
  useEffect(() => {
    if (!open) return;
    const able = seated.filter((p) => p.balance >= template.boot);
    setIncluded(new Set(able.map((p) => p._id)));
    setTeamCount(2);
    setTeams(Object.fromEntries(seated.map((p, i) => [p._id, (i % 2) + 1])));
  }, [open, seated, template.boot]);

  const chosen = seated.filter((p) => included.has(p._id));
  const pot = chosen.length * template.boot;
  const teamsUsed = new Set(chosen.map((p) => teams[p._id] ?? 1)).size;
  const problem =
    chosen.length < 2 ? "Pick at least two players." : isTeam && teamsUsed < 2 ? "Team games need at least two teams." : null;

  const start = () =>
    run(async () => {
      const res = await convex.mutation(api.games.start, {
        sessionId: state.session._id,
        templateId: template._id,
        participants: chosen.map((p) => ({ playerId: p._id as Id<"sessionPlayers">, teamNo: isTeam ? (teams[p._id] ?? 1) : undefined })),
        idempotencyKey: newKey(),
      });
      if (res.excluded.length) {
        pushToast({ text: `${res.excluded.map((e) => e.name).join(", ")} sat out — can’t cover the ${formatInr(template.boot)} boot.`, tone: "warn" });
      }
      onClose();
    });

  return (
    <Sheet open={open} onClose={onClose} title={`Start ${template.name}`} subtitle={template.boot > 0 ? `${formatInr(template.boot)} boot from everyone in` : "No boot — bets build the pot"}>
      {isTeam && (
        <div className="mt-3.5">
          <div className="mb-1.5 text-[11px] font-extrabold tracking-[.14em] text-ink3">TEAMS</div>
          <Segmented
            height={44}
            value={teamCount}
            onChange={(n) => {
              setTeamCount(n);
              setTeams((t) => Object.fromEntries(Object.entries(t).map(([id, v]) => [id, Math.min(v, n)])));
            }}
            options={[2, 3, 4].map((n) => ({ value: n, label: `${n} teams` }))}
          />
        </div>
      )}
      <div className="mt-3.5 grid gap-2">
        {seated.map((p) => {
          const short = p.balance < template.boot;
          const on = included.has(p._id);
          const team = TEAMS[((teams[p._id] ?? 1) - 1) % TEAMS.length];
          return (
            <div key={p._id} className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-line bg-surface2 px-3 py-2" style={{ opacity: short ? 0.55 : 1 }}>
              <Avatar name={p.name} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold">{p.name}</div>
                <div className="text-xs" style={{ color: short ? "var(--down)" : "var(--ink3)" }}>
                  {short ? `Can’t cover the ${formatInr(template.boot)} boot` : `${formatInr(p.balance)} in wallet`}
                </div>
              </div>
              {isTeam && on && (
                <button
                  onClick={() => setTeams((t) => ({ ...t, [p._id]: ((t[p._id] ?? 1) % teamCount) + 1 }))}
                  aria-label={`${p.name}'s team: ${team.name}. Tap to change.`}
                  className="press flex h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-bold"
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: team.color }} />
                  {team.name}
                </button>
              )}
              <Toggle
                label={`Include ${p.name}`}
                on={on}
                onChange={(v) =>
                  setIncluded((s) => {
                    const next = new Set(s);
                    if (v) next.add(p._id);
                    else next.delete(p._id);
                    return next;
                  })
                }
              />
            </div>
          );
        })}
      </div>
      <div className="mt-4">
        <GoldButton pending={pending} disabled={!!problem} onClick={start}>
          {problem ?? `Start · ${chosen.length} players${pot > 0 ? ` · ${formatInr(pot)} pot` : ""}`}
        </GoldButton>
      </div>
    </Sheet>
  );
}
