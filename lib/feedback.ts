import { useUi } from "@/stores/ui";

type Haptic = "tap" | "place" | "turn" | "undo" | "win";
type Sound = "flick" | "thup" | "clack" | "bell" | "win";

const PATTERNS: Record<Haptic, number | number[]> = {
  tap: 10,
  place: 25,
  turn: [15, 70, 15],
  undo: 60,
  win: [30, 50, 30, 50, 80],
};

/** Vibrates where the browser supports it; silently does nothing elsewhere or when switched off in settings. */
export function haptic(kind: Haptic) {
  if (!useUi.getState().haptics) return;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(PATTERNS[kind]);
  } catch {}
}

let ctx: AudioContext | null = null;
function audio() {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(c: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, gain: number, to?: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  if (to) o.frequency.exponentialRampToValueAtTime(to, c.currentTime + start + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.02);
}

function noise(c: AudioContext, start: number, dur: number, gain: number) {
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource();
  const g = c.createGain();
  const f = c.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 2500;
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(f).connect(g).connect(c.destination);
  src.start(c.currentTime + start);
}

/** Small synthesized sound effects (no audio files to ship). Respects the Sound setting. */
export function sound(kind: Sound) {
  if (!useUi.getState().sound) return;
  const c = audio();
  if (!c) return;
  switch (kind) {
    case "flick": // paper note
      noise(c, 0, 0.08, 0.18);
      break;
    case "thup": // soft landing in the pool
      tone(c, 180, 0, 0.12, "sine", 0.25, 70);
      noise(c, 0, 0.05, 0.08);
      break;
    case "clack": // chips
      tone(c, 1800, 0, 0.05, "square", 0.06, 900);
      tone(c, 1200, 0.045, 0.05, "square", 0.05, 700);
      break;
    case "bell": // your turn
      tone(c, 880, 0, 0.5, "sine", 0.18);
      tone(c, 1320, 0.02, 0.4, "sine", 0.08);
      break;
    case "win": // coin cascade
      for (let i = 0; i < 6; i++) tone(c, 880 * Math.pow(1.122, i * 2), i * 0.07, 0.25, "triangle", 0.12);
      break;
  }
}
