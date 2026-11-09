"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { avatarColor, initials } from "@/lib/avatar";
import { api } from "@/convex/_generated/api";
import { useAuthedQuery } from "@/hooks/useAuthedQuery";
import { useNow } from "@/hooks/useNow";
import { formatCode, formatInr, normalizeCode } from "@/lib/format";

const W = 1280;
const H = 720;

/** Fits the 1280×720 design onto whatever screen this is opened on. */
function useFit() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return scale;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Read-only table for a laptop or TV: big pool, whose turn it is, and a live feed legible from 2m. */
export default function DisplayPage() {
  const params = useParams<{ code: string }>();
  const code = normalizeCode(params.code ?? "");
  const d = useAuthedQuery(api.display.view, { code });
  const now = useNow(1000);
  const scale = useFit();

  const seats = d?.game?.seats ?? [];
  const n = seats.length;
  // Seats on an ellipse inside the 820×600 table area, starting at the bottom and going clockwise.
  const pos = (i: number) => {
    const t = Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1);
    return { x: 410 + 320 * Math.cos(t), y: 300 + 215 * Math.sin(t) };
  };
  const turn = d?.players.find((p) => p.id === d.game?.turnId);

  return (
    <div className="room grid min-h-dvh place-items-center overflow-hidden text-ink" style={{ height: "100dvh" }}>
      {d === undefined ? (
        <div className="skeleton h-40 w-96 rounded-3xl bg-surface2" aria-busy="true" />
      ) : d === null ? (
        <div className="text-center">
          <div className="font-display text-4xl font-semibold">No table with that code</div>
        </div>
      ) : (
        <div style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "center", position: "relative" }}>
          <div className="absolute flex items-center justify-between" style={{ left: 40, top: 28, right: 420 }}>
            <div className="font-display text-[30px] font-bold">
              Pot<span className="italic text-gold-ink">Luck</span>
              {d.game && <span className="ml-[18px] text-lg font-bold text-ink2" style={{ fontFamily: "var(--font-manrope)" }}>{d.game.template} · Round {d.game.no}</span>}
            </div>
            <div className="flex items-center gap-2.5 text-lg font-extrabold tracking-[.14em] text-gold-ink">
              <span className="h-2.5 w-2.5 rounded-full bg-up" />
              {formatCode(d.code)}
            </div>
          </div>

          <div className="absolute" style={{ left: 40, top: 92, width: 820, height: 600 }}>
            <div className="rail absolute rounded-[50%]" style={{ left: 30, top: 40, right: 30, bottom: 40, boxShadow: "var(--sh2), inset 0 3px 0 rgba(255,255,255,.08)" }}>
              <div className="absolute rounded-[50%]" style={{ inset: 18, background: "var(--felt-bg)", boxShadow: "inset 0 0 0 2px var(--rail-pin), inset 0 0 100px rgba(0,0,0,.55)" }} />
            </div>
            <div className="absolute inset-x-0 text-center text-on-felt" style={{ top: 170 }}>
              <div className="text-lg font-extrabold tracking-[.3em] text-on-felt2">POOL</div>
              <div className="amount leading-none" style={{ fontSize: 128, textShadow: "0 4px 30px rgba(0,0,0,.5)" }}>
                {formatInr(d.game?.pool ?? 0)}
              </div>
              {d.game?.status === "active" && turn && (
                <div className="mt-[18px] inline-flex items-center gap-3 rounded-full px-[22px] py-2.5 text-2xl font-extrabold" style={{ background: "#f1d590", color: "#1d1608" }}>
                  <span className="h-3 w-3 rounded-full" style={{ background: "#1d1608" }} />
                  {turn.name}’s turn{d.game.turnStartedAt ? ` · ${mmss(now - d.game.turnStartedAt)}` : ""}
                </div>
              )}
              {d.game?.status === "active" && !turn && <div className="mt-[18px] text-2xl font-bold text-on-felt2">Bet any time</div>}
              {(!d.game || d.game.status !== "active") && <div className="mt-[18px] text-2xl font-bold text-on-felt2">{d.status === "ended" ? "Session over" : "Waiting for the next game"}</div>}
            </div>
            {seats.map((s, i) => {
              const pl = d.players.find((p) => p.id === s.id);
              if (!pl) return null;
              const active = d.game?.turnId === s.id;
              const { x, y } = pos(i);
              return (
                <div key={s.id} className="absolute flex w-[150px] flex-col items-center gap-1.5" style={{ left: x - 75, top: y - 50, opacity: s.packed ? 0.4 : 1 }}>
                  <div
                    className="grid h-[76px] w-[76px] place-items-center rounded-full text-2xl font-extrabold text-[#f6eedb]"
                    style={{
                      boxSizing: "border-box",
                      background: avatarColor(pl.name),
                      border: `3px solid ${active ? "#f1d590" : "rgba(246,238,219,.4)"}`,
                      boxShadow: active ? "0 0 0 4px #f1d590, 0 0 40px 12px rgba(241,213,144,.5)" : "0 4px 10px rgba(0,0,0,.4)",
                    }}
                  >
                    {initials(pl.name)}
                  </div>
                  <div className="rounded-xl px-3.5 py-[5px] text-center leading-[1.2]" style={{ background: "var(--plate)" }}>
                    <div className="max-w-[130px] truncate text-xl font-extrabold text-[#f6eedb]">{pl.name}</div>
                    <div className="amount text-[17px] !font-bold text-[#e5c47c]">{formatInr(pl.balance)}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="absolute flex flex-col rounded-[28px] border border-line bg-surface p-6" style={{ right: 28, top: 28, bottom: 28, width: 360 }}>
            <div className="font-display text-[30px] font-semibold">Live feed</div>
            <div className="mt-2.5 flex flex-col">
              {d.feed.length === 0 && <div className="py-8 text-lg text-ink3">Nothing yet.</div>}
              {d.feed.map((f) => (
                <div key={f.id} className="flex h-[66px] items-center gap-3 border-b border-line" style={{ opacity: f.undone ? 0.5 : 1 }}>
                  <div className="grid h-10 w-10 flex-none place-items-center rounded-full text-sm font-extrabold text-[#f6eedb]" style={{ background: avatarColor(f.who) }}>
                    {initials(f.who)}
                  </div>
                  <div className="min-w-0 flex-1 leading-[1.2]">
                    <div className="truncate text-xl font-extrabold" style={{ textDecoration: f.undone ? "line-through" : undefined }}>{f.who}</div>
                    <div className="text-[15px] font-semibold text-ink3">{f.undone ? "Undone by host" : f.type}</div>
                  </div>
                  <div className="amount text-[28px]" style={{ textDecoration: f.undone ? "line-through" : undefined }}>{formatInr(f.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
