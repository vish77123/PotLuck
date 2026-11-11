"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { MonoUnavailable } from "@/components/mono/MonoSession";
import { BoardEditor, BoardEditorHeader } from "@/components/mono/BoardEditor";
import type { Id } from "@/convex/_generated/dataModel";
import { MONOPOLY_ENABLED } from "@/lib/flags";

function Editor() {
  const { crewId } = useParams<{ crewId: string }>();
  const preset = useSearchParams().get("preset") ?? undefined;
  return (
    <main className="room mx-auto w-full max-w-[520px] pb-44 text-ink">
      <BoardEditorHeader crewId={crewId as Id<"crews">} />
      <BoardEditor crewId={crewId as Id<"crews">} initialKey={preset} />
    </main>
  );
}

/** /crew/ID/board: the crew's corrected copy of each property-game board. */
export default function BoardPage() {
  if (!MONOPOLY_ENABLED) return <MonoUnavailable />;
  return (
    <Suspense fallback={null}>
      <Editor />
    </Suspense>
  );
}
