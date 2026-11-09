import type { CSSProperties } from "react";

export type MoneyKind = "note" | "coin" | "chip";

// Stylised only: colour, proportion, a big numeral and an abstract sunburst. Never a replica of a real banknote.
const NOTES: Record<number, [string, string]> = {
  10: ["#7b4a2c", "#f6e7d0"],
  20: ["#c9cd5b", "#353708"],
  50: ["#5ccbdd", "#08343e"],
  100: ["#ab9cd8", "#241b4c"],
  200: ["#f3b934", "#472e03"],
  500: ["#b1b2a6", "#292a23"],
};
const COINS: Record<number, [string, string, string]> = {
  1: ["#eceeee", "#9b9fa0", "#2a2c2d"],
  2: ["#dfe2e2", "#868b8c", "#25282a"],
  5: ["#f2d88f", "#a47e2c", "#3a2906"],
};
const CHIPS: Record<number, [string, string, string]> = {
  1: ["#ece6d8", "#2457a6", "#1d2b44"],
  5: ["#b3302a", "#f4efe4", "#fff"],
  10: ["#2156a6", "#f4efe4", "#fff"],
  25: ["#25774a", "#f4efe4", "#fff"],
  100: ["#1d1d1d", "#e6d29a", "#f1e2b4"],
  500: ["#5b3594", "#f2c443", "#fff"],
};

export function Money({
  kind = "note",
  v,
  w = 120,
  rot = 0,
  dim = false,
  style,
}: {
  kind?: MoneyKind;
  v: number;
  w?: number;
  rot?: number;
  dim?: boolean;
  style?: CSSProperties;
}) {
  const opacity = dim ? 0.35 : 1;
  const lift = `0 ${Math.max(1, w * 0.02)}px ${Math.max(2, w * 0.06)}px rgba(0,0,0,.32)`;
  const isChip = kind === "chip";
  const isCoin = !isChip && (kind === "coin" || v < 10);

  if (!isChip && !isCoin) {
    const [base, ink] = NOTES[v] ?? NOTES[100];
    const h = Math.round(w * 0.46);
    const r = Math.max(2, w * 0.035);
    const p = Math.max(2, w * 0.04);
    const p2 = Math.max(3, w * 0.07);
    const p3 = Math.max(3, w * 0.06);
    const small = Math.max(7, h * 0.2);
    return (
      <div
        aria-label={`₹${v} note`}
        style={{
          position: "relative",
          flex: "none",
          width: w,
          height: h,
          borderRadius: r,
          overflow: "hidden",
          color: ink,
          transform: `rotate(${rot}deg)`,
          opacity,
          background: `repeating-conic-gradient(from 0deg at 30% 52%, rgba(0,0,0,.075) 0deg 5deg, transparent 5deg 10deg), radial-gradient(ellipse 34% 60% at 30% 52%, rgba(255,255,255,.28), transparent 70%), linear-gradient(90deg, transparent 52%, rgba(255,255,255,.16) 52% 54%, transparent 54%), linear-gradient(160deg, rgba(255,255,255,.16), rgba(0,0,0,.12)), ${base}`,
          boxShadow: `inset 0 0 0 1px rgba(0,0,0,.12), ${lift}`,
          ...style,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: p,
            borderRadius: r,
            border: `1px solid ${ink === "#f6e7d0" ? "rgba(246,231,208,.35)" : "rgba(0,0,0,.18)"}`,
          }}
        />
        <div style={{ position: "absolute", left: p2, top: p2, fontWeight: 800, fontSize: small, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{v}</div>
        <div style={{ position: "absolute", left: p2, bottom: p2, fontWeight: 800, fontSize: small, lineHeight: 1 }}>₹</div>
        <div
          style={{
            position: "absolute",
            right: p2,
            bottom: p3,
            fontFamily: "var(--font-playfair), serif",
            fontWeight: 700,
            fontSize: h * 0.62,
            lineHeight: 0.8,
            fontVariantNumeric: "lining-nums",
            letterSpacing: "-.02em",
          }}
        >
          {v}
        </div>
      </div>
    );
  }

  if (isCoin) {
    const [hi, dk, ink] = COINS[v] ?? COINS[1];
    return (
      <div
        aria-label={`₹${v} coin`}
        style={{
          position: "relative",
          flex: "none",
          width: w,
          height: w,
          borderRadius: "50%",
          color: ink,
          display: "grid",
          placeItems: "center",
          transform: `rotate(${rot}deg)`,
          opacity,
          background: `radial-gradient(circle at 34% 28%, #fff 0, ${hi} 34%, ${dk} 100%)`,
          boxShadow: `inset 0 0 0 1px rgba(0,0,0,.2), inset 0 -2px 3px rgba(0,0,0,.15), ${lift}`,
          ...style,
        }}
      >
        <div style={{ position: "absolute", inset: w * 0.09, borderRadius: "50%", border: "1px solid rgba(0,0,0,.22)" }} />
        <div style={{ display: "flex", alignItems: "flex-start", gap: 1, fontFamily: "var(--font-playfair), serif", fontWeight: 700, lineHeight: 1 }}>
          {w >= 40 && <span style={{ fontFamily: "var(--font-manrope), sans-serif", fontSize: w * 0.18, marginTop: 2 }}>₹</span>}
          <span style={{ fontSize: w * 0.44 }}>{v}</span>
        </div>
      </div>
    );
  }

  const [base, stripe, ink] = CHIPS[v] ?? CHIPS[5];
  return (
    <div
      aria-label={`${v} chip`}
      style={{
        position: "relative",
        flex: "none",
        width: w,
        height: w,
        borderRadius: "50%",
        transform: `rotate(${rot}deg)`,
        opacity,
        background: `repeating-conic-gradient(from 8deg, ${stripe} 0deg 15deg, ${base} 15deg 60deg)`,
        boxShadow: `inset 0 0 0 1px rgba(0,0,0,.28), inset 0 0 0 ${Math.max(1, w * 0.02)}px rgba(255,255,255,.08), ${lift}`,
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: w * 0.13,
          borderRadius: "50%",
          background: base,
          border: `${Math.max(1, w * 0.03)}px dashed ${stripe}`,
          display: "grid",
          placeItems: "center",
        }}
      >
        <div
          style={{
            width: w * 0.5,
            height: w * 0.5,
            borderRadius: "50%",
            background: `radial-gradient(circle at 40% 35%, rgba(255,255,255,.22), transparent 70%), ${base}`,
            display: "grid",
            placeItems: "center",
            color: ink,
            fontFamily: "var(--font-playfair), serif",
            fontWeight: 700,
            fontSize: w * (String(v).length > 2 ? 0.2 : 0.26),
            lineHeight: 1,
            fontVariantNumeric: "lining-nums",
          }}
        >
          {v}
        </div>
      </div>
    </div>
  );
}
