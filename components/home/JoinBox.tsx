"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { normalizeCode } from "@/lib/format";

/** Six boxes backed by one real input, so paste, autofill and the phone keyboard all just work. */
export function JoinBox() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const change = (raw: string) => {
    const next = normalizeCode(raw);
    setCode(next);
    if (next.length === 6) router.push(`/join/${next}`);
  };

  return (
    <div className="mx-4 mt-3.5 rounded-3xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-base font-extrabold">Join a table</div>
        <div className="text-xs font-semibold text-ink3">6-character code</div>
      </div>
      <div className="relative mt-3 flex gap-1.5" onClick={() => input.current?.focus()}>
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="font-display grid h-[54px] flex-1 place-items-center rounded-xl bg-surface2 text-2xl font-bold"
            style={{ border: `1.5px solid ${i === Math.min(code.length, 5) ? "var(--gold)" : "var(--line)"}` }}
          >
            {code[i] ?? ""}
          </div>
        ))}
        <input
          ref={input}
          value={code}
          onChange={(e) => change(e.target.value)}
          aria-label="Room code"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          className="absolute inset-0 h-full w-full opacity-0"
        />
      </div>
    </div>
  );
}
