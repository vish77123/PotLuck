"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { formatCode } from "@/lib/format";
import { useUi } from "@/stores/ui";

export function RoomCard({ code }: { code: string }) {
  const pushToast = useUi((s) => s.pushToast);
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(`${window.location.origin}/join/${code}`), [code]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      pushToast({ text: "Invite link copied" });
    } catch {
      pushToast({ text: `Couldn’t copy. The code is ${formatCode(code)}.`, tone: "warn" });
    }
  };
  const share = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Join my PotLuck table", text: `Join my table with code ${formatCode(code)}`, url });
        return;
      } catch (e) {
        if ((e as DOMException).name === "AbortError") return;
      }
    }
    await copy();
  };

  return (
    <div className="rail mx-4 mt-4 rounded-[28px] p-2">
      <div className="felt flex items-center gap-4 rounded-[22px] p-[18px]" style={{ boxShadow: "inset 0 0 0 1.5px var(--rail-pin), inset 0 0 40px rgba(0,0,0,.45)" }}>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-extrabold tracking-[.2em] text-on-felt2">ROOM CODE</div>
          <div className="font-display mt-1 whitespace-nowrap text-[clamp(30px,9.6vw,40px)] font-bold leading-[1.1] tracking-[.04em]" aria-label={`Room code ${code.split("").join(" ")}`}>
            {formatCode(code)}
          </div>
          <a href={`/s/${code}/display`} target="_blank" rel="noreferrer" className="mt-2 block text-[11.5px] font-bold text-on-felt2 underline underline-offset-2">
            Open table display (TV / laptop)
          </a>
          <div className="mt-3 flex gap-1.5">
            <button onClick={share} className="gold-btn press h-11 whitespace-nowrap rounded-xl px-3 text-[13px]">
              Share invite
            </button>
            <button
              onClick={copy}
              className="press h-11 whitespace-nowrap rounded-xl border px-3 text-[13px] font-bold"
              style={{ background: "rgba(0,0,0,.28)", borderColor: "rgba(246,238,219,.3)" }}
            >
              Copy
            </button>
          </div>
        </div>
        <div className="flex-none rounded-xl p-[7px]" style={{ background: "#fbf6ea" }}>
          {url ? <QRCodeSVG value={url} size={92} fgColor="#1a140a" bgColor="#fbf6ea" level="M" title="Scan to join" /> : <div style={{ width: 92, height: 92 }} />}
        </div>
      </div>
    </div>
  );
}
