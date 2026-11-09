import { Money } from "@/components/money/Money";
import { formatInr } from "@/lib/format";
import { useTween } from "@/hooks/useTween";
import { pile, type Theme } from "@/lib/wallet";

// Where the notes lie in the 160×92 pile box (x, y, rotation), from the design.
const NOTE_SPOTS: [number, number, number][] = [
  [8, 6, -9],
  [50, 0, 8],
  [24, 18, -3],
  [58, 26, 12],
  [12, 34, 4],
  [44, 44, -6],
];

/** The pot: a pile of notes (or columns of chips) and the amount underneath. */
export function PoolPile({ pool, theme, subtitle, hot }: { pool: number; theme: Theme; subtitle: string; hot: boolean }) {
  const chips = theme === "chips";
  const shown = useTween(pool, 300);
  const items = pile(pool, theme, chips ? 12 : 6);
  const cols = Math.min(3, items.length);
  const chipLeft = (160 - (cols * 42 - 2)) / 2;
  return (
    <>
      <div
        className="absolute left-1/2 top-[28%] h-[92px] w-[160px]"
        aria-hidden
        key={pool}
        style={{ transition: "transform 180ms", transform: `translateX(-50%) scale(${hot ? 1.06 : 1})`, animation: "pl-pulse-scale 180ms ease-out" }}
      >
        {items.map((v, i) => {
          if (chips) {
            const col = i % 3;
            const level = Math.floor(i / 3);
            return (
              <div key={`${v}-${i}`} className="absolute" style={{ left: chipLeft + col * 42, top: 40 - level * 6 + (col % 2) * 4 }}>
                <Money kind="chip" v={v} w={40} rot={(v * 7) % 40} />
              </div>
            );
          }
          const [x, y, r] = NOTE_SPOTS[i];
          return (
            <div key={`${v}-${i}`} className="absolute" style={{ left: x, top: y }}>
              <Money v={v} w={92} rot={r} />
            </div>
          );
        })}
      </div>
      <div
        className="pointer-events-none absolute left-1/2 top-[22%] h-[128px] w-[128px] -translate-x-1/2 rounded-full transition-opacity duration-150"
        style={{ opacity: hot ? 1 : 0, border: "2px dashed #f1d590", boxShadow: "0 0 30px 6px rgba(241,213,144,.35)" }}
        aria-hidden
      />
      <div className="absolute inset-x-0 top-[53.5%] text-center text-on-felt">
        <div className="text-[10.5px] font-extrabold tracking-[.24em] text-on-felt2">POOL</div>
        <div className="amount text-[46px] leading-[1.05]" style={{ textShadow: "0 2px 12px rgba(0,0,0,.45)" }}>
          {formatInr(shown)}
        </div>
        <div className="text-xs font-semibold text-on-felt2">{subtitle}</div>
      </div>
    </>
  );
}
