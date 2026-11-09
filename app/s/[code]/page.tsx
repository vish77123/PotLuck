"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { LobbyScreen } from "@/components/lobby/LobbyScreen";
import { ResultScreen, awayText, useResult } from "@/components/table/ResultScreen";
import { TableScreen } from "@/components/table/TableScreen";
import type { SessionState } from "@/components/lobby/types";
import { Dialog } from "@/components/ui/Dialog";
import { useGameResult } from "@/hooks/useGameResult";
import { useLoanToasts } from "@/hooks/useLoanToasts";
import { useUi } from "@/stores/ui";
import { BackButton } from "@/components/ui/controls";
import { api } from "@/convex/_generated/api";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { normalizeCode } from "@/lib/format";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="room mx-auto w-full max-w-[520px] px-4 text-ink" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
      <div className="pt-3">
        <BackButton href="/" />
      </div>
      {children}
    </main>
  );
}

type Game = NonNullable<SessionState["latestGame"]>;

/** Shown over the lobby when a game finished while this phone wasn't looking. */
function AwayNote({ code, state, game }: { code: string; state: SessionState; game: Game }) {
  const router = useRouter();
  const ack = useUi((s) => s.ackGame);
  const r = useResult(state, game);
  const text = awayText(state, game, r);
  return (
    <Dialog
      open={r.ready}
      eyebrow="WHILE YOU WERE AWAY"
      title={text.title}
      body={text.body}
      noLabel="Session report"
      yesLabel="Back to table"
      onNo={() => {
        ack(state.session._id, game._id);
        router.push(`/s/${code}/report`);
      }}
      onYes={() => ack(state.session._id, game._id)}
    />
  );
}

/** Table while a game is live, winner celebration right after, lobby/waiting room otherwise. */
function SessionRouter({ code, state }: { code: string; state: SessionState }) {
  const result = useGameResult(state);
  useLoanToasts(state);
  if (state.latestGame?.status === "active") return <TableScreen state={state} game={state.latestGame} />;
  if (result.kind === "celebrate") return <ResultScreen code={code} state={state} game={result.game} />;
  return (
    <>
      <LobbyScreen code={code} state={state} />
      {result.kind === "away" && <AwayNote code={code} state={state} game={result.game} />}
    </>
  );
}

/** /s/CODE: resolves the code, makes sure this phone has a seat, then shows the lobby (or the table once a game is live). */
export default function SessionPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = normalizeCode(params.code ?? "");
  const info = useAuthedQuery(api.sessions.joinInfo, { code });
  const sessionId = info?.myPlayerId ? info.sessionId : undefined;
  const state = useAuthedQuery(api.sessions.state, sessionId ? { sessionId } : "skip");

  const notSeated = info !== undefined && info !== null && !info.myPlayerId;
  useEffect(() => {
    if (notSeated) router.replace(`/join/${code}`);
  }, [notSeated, router, code]);

  if (info === null) {
    return (
      <Shell>
        <h1 className="font-display mt-16 text-[34px] font-semibold leading-[1.1]">No table with that code</h1>
        <Link href="/" className="gold-btn mt-6 grid h-[58px] place-items-center rounded-[18px] text-[16.5px]">
          Back home
        </Link>
      </Shell>
    );
  }
  if (info === undefined || notSeated || state === undefined) {
    return (
      <Shell>
        <div className="skeleton mt-5 h-36 rounded-[28px] bg-surface2" aria-busy="true" />
        <div className="skeleton mt-6 h-24 rounded-[20px] bg-surface2" />
      </Shell>
    );
  }
  if (state.session.status === "ended") {
    return (
      <Shell>
        <h1 className="font-display mt-16 text-[34px] font-semibold leading-[1.1]">This session has ended</h1>
        <Link href={`/s/${code}/report`} className="gold-btn mt-6 grid h-[58px] place-items-center rounded-[18px] text-[16.5px]">
          See the report
        </Link>
      </Shell>
    );
  }
  return <SessionRouter code={code} state={state} />;
}
