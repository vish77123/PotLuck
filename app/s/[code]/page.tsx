"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { LobbyScreen } from "@/components/lobby/LobbyScreen";
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
  if (state.session.status === "active") {
    return (
      <Shell>
        <h1 className="font-display mt-16 text-[34px] font-semibold leading-[1.1]">A game is in progress</h1>
        <p className="mt-2 text-sm text-ink2">The game table arrives in the next milestone.</p>
      </Shell>
    );
  }
  return <LobbyScreen code={code} state={state} />;
}
