"use client";

import { useConvex } from "convex/react";
import { Money } from "@/components/money/Money";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSubmit } from "@/hooks/useSubmit";
import { newKey } from "@/lib/errors";

export function ThemeCards({ sessionId, theme }: { sessionId: Id<"sessions">; theme: "inr" | "chips" }) {
  const convex = useConvex();
  const { run } = useSubmit();
  const pick = (next: "inr" | "chips") =>
    next !== theme && run(() => convex.mutation(api.sessions.updateSettings, { sessionId, theme: next, idempotencyKey: newKey() }));

  const card = (on: boolean) => ({
    background: "var(--surface)",
    border: on ? "2px solid var(--gold)" : "1px solid var(--line)",
    boxShadow: on ? "var(--glow)" : undefined,
  });

  return (
    <div className="mx-4 mt-2.5 grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Money theme">
      <button role="radio" aria-checked={theme === "inr"} onClick={() => pick("inr")} className="press box-border flex h-[120px] flex-col justify-between rounded-[20px] p-3 text-left" style={card(theme === "inr")}>
        <div className="flex h-[50px] items-center pl-1" aria-hidden>
          <Money v={500} w={74} rot={-10} />
          <div style={{ marginLeft: -46, marginTop: 14 }}>
            <Money v={100} w={74} rot={5} />
          </div>
        </div>
        <div>
          <div className="text-[14.5px] font-extrabold">INR notes</div>
          <div className="text-[11.5px] font-semibold text-ink3">₹10 – ₹500 + coins</div>
        </div>
      </button>
      <button role="radio" aria-checked={theme === "chips"} onClick={() => pick("chips")} className="press box-border flex h-[120px] flex-col justify-between rounded-[20px] p-3 text-left" style={card(theme === "chips")}>
        <div className="flex h-[50px] items-center" aria-hidden>
          <Money kind="chip" v={100} w={42} />
          <div style={{ marginLeft: -12 }}>
            <Money kind="chip" v={25} w={42} />
          </div>
          <div style={{ marginLeft: -12 }}>
            <Money kind="chip" v={5} w={42} />
          </div>
        </div>
        <div>
          <div className="text-[14.5px] font-extrabold">Casino chips</div>
          <div className="text-[11.5px] font-semibold text-ink3">1 – 500 chips</div>
        </div>
      </button>
    </div>
  );
}
