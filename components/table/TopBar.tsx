import type { ReactNode } from "react";

export function TopBar({
  title,
  sub,
  live,
  unread,
  onFeed,
  right,
}: {
  title: string;
  sub: string;
  live: boolean;
  unread: number;
  onFeed: () => void;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3" style={{ paddingTop: "max(14px, env(safe-area-inset-top))" }}>
      <button
        onClick={onFeed}
        aria-label={unread ? `Open live feed, ${unread} new` : "Open live feed"}
        className="press relative grid h-11 w-11 flex-none place-items-center rounded-full border border-line bg-surface"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-[3px] -top-[3px] grid h-[18px] min-w-[18px] place-items-center rounded-[9px] bg-gold px-[5px] text-[10.5px] font-extrabold text-on-gold">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <div className="min-w-0 flex-1 text-center">
        <div className="font-display truncate text-xl font-semibold leading-[1.1]">{title}</div>
        <div className="mt-[3px] flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-[.06em] text-ink2">
          <span className="h-[7px] w-[7px] rounded-full" style={{ background: live ? "var(--up)" : "var(--warn)" }} />
          <span>{live ? "Live" : "Reconnecting"}</span>
          <span>·</span>
          <span>{sub}</span>
        </div>
      </div>
      <div className="grid h-11 w-11 flex-none place-items-center">{right}</div>
    </div>
  );
}
