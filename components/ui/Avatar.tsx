import { avatarColor, initials } from "@/lib/avatar";

export function Avatar({
  name,
  size = 52,
  ring,
  dashed,
  online,
  badge,
  dim,
}: {
  name: string;
  size?: number;
  ring?: string;
  dashed?: boolean;
  online?: boolean;
  badge?: React.ReactNode;
  dim?: boolean;
}) {
  return (
    <div
      className="relative grid flex-none place-items-center rounded-full font-extrabold text-[#f6eedb]"
      style={{
        width: size,
        height: size,
        boxSizing: "border-box",
        background: dashed ? "transparent" : avatarColor(name),
        border: dashed ? "1.5px dashed var(--ink3)" : ring ? `3px solid ${ring}` : "2px solid transparent",
        fontSize: Math.round(size * 0.31),
        opacity: dim ? 0.5 : 1,
        color: dashed ? "var(--ink2)" : undefined,
      }}
    >
      {initials(name)}
      {online !== undefined && (
        <span
          className="absolute -top-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-surface"
          style={{ background: online ? "var(--up)" : "var(--ink3)" }}
          aria-label={online ? "online" : "offline"}
        />
      )}
      {badge !== undefined && (
        <div className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border-2 border-surface bg-surface3 text-[10px] font-extrabold text-ink2">
          {badge}
        </div>
      )}
    </div>
  );
}
