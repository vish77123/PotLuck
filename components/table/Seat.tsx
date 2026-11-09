import { avatarColor, initials } from "@/lib/avatar";

export type SeatView = {
  id: string;
  name: string;
  wallet: string;
  tag: string;
  ring: string;
  active: boolean;
  host: boolean;
  timer: string | null;
  dim: boolean;
  online: boolean | null;
};

/** One opponent on the arc: 52px avatar, dark name plate with wallet, and a status line under it. */
export function Seat({ s, x, y }: { s: SeatView; x: number; y: number }) {
  return (
    <div
      className="absolute flex w-[86px] flex-col items-center gap-1"
      style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -26px)", opacity: s.dim ? 0.4 : 1, transition: "opacity 200ms" }}
    >
      <div
        className="relative grid h-[52px] w-[52px] place-items-center rounded-full text-base font-extrabold tracking-[.02em] text-[#f6eedb]"
        style={{
          boxSizing: "border-box",
          background: avatarColor(s.name),
          border: `2px solid ${s.active ? "#f1d590" : s.ring}`,
          boxShadow: s.active ? "var(--glow)" : "0 2px 6px rgba(0,0,0,.4)",
          animation: s.active ? "pl-glow 2.4s ease-in-out infinite" : undefined,
        }}
      >
        {initials(s.name)}
        {s.host && <div className="absolute -top-[9px] left-1/2 -translate-x-1/2 text-[13px] leading-none text-[#f1d590]">♛</div>}
        {s.timer && (
          <div className="absolute -bottom-1 -right-3 rounded-lg bg-[#f1d590] px-1.5 py-0.5 text-[10.5px] font-extrabold tabular-nums text-[#1d1608]">
            {s.timer}
          </div>
        )}
        {s.online !== null && (
          <span
            className="absolute -left-0.5 top-0 h-2.5 w-2.5 rounded-full"
            style={{ background: s.online ? "var(--up)" : "var(--ink3)", boxShadow: "0 0 0 2px rgba(8,10,8,.8)" }}
            aria-label={s.online ? "online" : "offline"}
          />
        )}
      </div>
      <div className="flex flex-col items-center rounded-[9px] px-2 pb-1 pt-[3px] leading-[1.2]" style={{ background: "var(--plate)" }}>
        <div className="max-w-[78px] truncate text-xs font-bold text-[#f6eedb]">{s.name}</div>
        <div className="amount text-[11px] font-bold text-[#e5c47c]">{s.wallet}</div>
      </div>
      {s.tag && <div className="text-[9.5px] font-extrabold tracking-[.1em] text-on-felt2">{s.tag}</div>}
    </div>
  );
}
