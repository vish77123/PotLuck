"use client";

import Link from "next/link";
import { MonoLobby } from "@/components/mono/MonoLobby";
import { MonoTable } from "@/components/mono/MonoTable";
import type { MonoState } from "@/components/mono/types";

/** A property-game session: the table while a game is running or paused, the lobby (setup) otherwise. */
export function MonoSession({ code, state }: { code: string; state: MonoState }) {
  const game = state.game;
  if (!game) return null;
  if (game.status === "active" || game.status === "paused") return <MonoTable state={state} game={game} />;
  return <MonoLobby code={code} state={state} game={game} />;
}

export function MonoUnavailable() {
  return (
    <main className="room mx-auto w-full max-w-[520px] px-4 text-ink" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
      <h1 className="font-display mt-20 text-[34px] font-semibold leading-[1.1]">Property games aren't available yet</h1>
      <p className="mt-2 text-sm text-ink2">This table is a property game, which isn't switched on for this site.</p>
      <Link href="/" className="gold-btn mt-6 grid h-[58px] place-items-center rounded-[18px] text-[16.5px]">
        Back home
      </Link>
    </main>
  );
}
