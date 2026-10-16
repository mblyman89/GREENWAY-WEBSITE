/**
 * banner-atmos-core — R58-S1. Smoke, fog & haze layers for Banner Studio.
 *
 *  fog   rising fog that hugs the bottom of the banner (any colour)
 *  haze  a slow drifting haze over the whole banner
 *  wisp  a thin curling smoke column from one point — the tip of a joint or
 *        blunt, a pipe or a bong bowl (technique: Brad Woods "Shaders 103 —
 *        smoke": rising noise, smoothstep remap, edge fade, twist/sway)
 *  hit   a bong hit / exhale blown ACROSS the banner, usually once per showing.
 *        Desktop/modern browsers: shaders.com `Smoke` (real stable-fluids
 *        simulation, WebGPU, MIT). No WebGPU → our WebGL2 "plume" fallback.
 *
 * Everything else (fog/haze/wisp/plume fallback) is OUR OWN small WebGL2
 * fragment shader (smoke-gl.ts) — no three.js, ~6 KB, works on phones.
 *
 * `reveal`: the words and buttons fade in after the smoke (seconds) — the
 * "cloud blows across, then the words appear" moment. Replays every time the
 * carousel shows the slide.
 *
 * Fields are optional and only written when used (old designs byte-identical).
 * Pure + self-tested; imports nothing from the other banner cores.
 */
export type SmokeKind = "fog" | "haze" | "wisp" | "hit";
export type SmokeSpeed = "slow" | "fast";
export type SmokeLayer = {
  id: string;
  kind: SmokeKind;
  /** Where the smoke comes from, % of the banner (wisp/hit). */
  x: number;
  y: number;
  /** Phone position overrides (null = same as computer). */
  mx: number | null;
  my: number | null;
  /** Direction it travels, degrees: 0 = up, 90 = right, -90 = left. */
  dir: number;
  color: string;
  color2: string;
  /** Colourful / psychedelic: colours cycle through the rainbow. */
  rainbow?: true;
  /** Thickness 10–100. */
  amount: number;
  /** Size / height / reach 10–100. */
  size: number;
  speed?: SmokeSpeed;
  /** Plays once each time the slide is shown (instead of looping). */
  once?: true;
  /** Seconds before it starts (0–10). */
  delay?: number;
  hideOnMobile?: true;
  /** Smoke follows / is pushed by the mouse (hit only). */
  interactive?: true;
  /** Drawn in front of the words and buttons (default: behind them). */
  front?: true;
  // ── R60: pro controls for the big clouds (hit) — all optional ──────────
  /** Look of the cloud (a bundle of the settings below). Default "billow". */
  style?: HitStyle;
  /** Seconds the smoke keeps pouring out of the source (0.3–8). */
  emit?: number;
  /** How many puffs it comes out in (1–6). */
  puffs?: number;
  /** How hard it's blown 0–100 (how fast it shoots out). */
  power?: number;
  /** Cone width 0–100. */
  spread?: number;
  /** Size of the source 0–100 (a mouth vs a bong vs a smoke machine). */
  source?: number;
  /** Swirl / turbulence 0–100 (also on fog + haze). */
  swirl?: number;
  /** Rise −100…100: + floats up like warm smoke, − sinks like dry ice. */
  rise?: number;
  /** How long it hangs in the air 0–100. */
  linger?: number;
};

export type HitStyle = "billow" | "rip" | "exhale" | "vortex" | "rolling" | "wall" | "puffs" | "blast";
export type HitTuning = { emit: number; puffs: number; power: number; spread: number; source: number; swirl: number; rise: number; linger: number };
export const HIT_TUNE_KEYS = ["emit", "puffs", "power", "spread", "source", "swirl", "rise", "linger"] as const;
/** Each style is just a starting bundle — every slider can still be changed. emit null = from cloud size. */
export const HIT_STYLES: { id: HitStyle; label: string; hint: string; tune: Omit<HitTuning, "emit"> & { emit: number | null } }[] = [
  { id: "billow", label: "Big billowy cloud", hint: "Soft, round, rolls across", tune: { emit: null, puffs: 1, power: 45, spread: 55, source: 45, swirl: 55, rise: 25, linger: 70 } },
  { id: "rip", label: "Dense bong rip", hint: "Thick, pushed hard, hangs heavy", tune: { emit: 2.2, puffs: 1, power: 75, spread: 30, source: 35, swirl: 40, rise: 15, linger: 82 } },
  { id: "exhale", label: "Slow exhale stream", hint: "A long, thin, lazy stream", tune: { emit: 3.5, puffs: 1, power: 30, spread: 14, source: 18, swirl: 35, rise: 35, linger: 55 } },
  { id: "vortex", label: "Swirling vortex", hint: "Curls and eddies everywhere", tune: { emit: 2, puffs: 1, power: 50, spread: 45, source: 40, swirl: 95, rise: 20, linger: 75 } },
  { id: "rolling", label: "Rolling mushroom cloud", hint: "Slows down, rises and mushrooms out", tune: { emit: 1.6, puffs: 1, power: 38, spread: 70, source: 60, swirl: 65, rise: 75, linger: 85 } },
  { id: "wall", label: "Drifting smoke wall", hint: "A wide wall that drifts across", tune: { emit: 4, puffs: 1, power: 25, spread: 90, source: 100, swirl: 45, rise: 8, linger: 95 } },
  { id: "puffs", label: "Puff, puff, puff", hint: "Comes out in separate bursts", tune: { emit: 2.4, puffs: 3, power: 60, spread: 40, source: 35, swirl: 50, rise: 25, linger: 70 } },
  { id: "blast", label: "Fast blast", hint: "Short, sharp and quick to clear", tune: { emit: 0.8, puffs: 1, power: 100, spread: 25, source: 30, swirl: 30, rise: 0, linger: 40 } },
];
export const HIT_EMIT = { min: 0.3, max: 8 };
export const HIT_PUFFS = { min: 1, max: 6 };

export const SMOKE_KINDS: { id: SmokeKind; label: string; hint: string }[] = [
  { id: "fog", label: "Rising fog", hint: "Fog hugging the bottom of the banner" },
  { id: "haze", label: "Haze", hint: "A slow drifting haze over everything" },
  { id: "wisp", label: "Smoke wisp", hint: "Curling smoke from one point — joint, blunt, pipe or bowl" },
  { id: "hit", label: "Bong hit / exhale", hint: "A cloud blown across the banner" },
];
export const MAX_SMOKE_LAYERS = 4;
export const SMOKE_AMOUNT = { min: 10, max: 100 };
export const SMOKE_SIZE = { min: 10, max: 100 };
export const SMOKE_DELAY_MAX = 10;
export const REVEAL = { min: 0.5, max: 8 };
/** Seconds one "once" hit lasts (emission + drift + fade), at normal speed. */
export const HIT_SECONDS = 4.5;
export const SPEED_MUL: Record<SmokeSpeed | "normal", number> = { slow: 0.55, normal: 1, fast: 1.8 };

/** One-click starting points. Every value stays editable afterwards. */
export type SmokePreset = { id: string; label: string; emoji: string; layer: Omit<SmokeLayer, "id" | "mx" | "my">; reveal?: number };
export const SMOKE_PRESETS: SmokePreset[] = [
  { id: "joint", label: "Joint / blunt smoke", emoji: "🚬", layer: { kind: "wisp", x: 30, y: 70, dir: 0, color: "#e9e9e9", color2: "#9a9a9a", amount: 55, size: 45 } },
  { id: "pipe", label: "Pipe / bowl smoke", emoji: "🪈", layer: { kind: "wisp", x: 30, y: 70, dir: 0, color: "#f1f1f1", color2: "#a7b0c0", amount: 75, size: 70 } },
  { id: "bong", label: "Bong hit blown across", emoji: "💨", layer: { kind: "hit", x: 6, y: 62, dir: 80, color: "#f4f4f4", color2: "#8f8f8f", amount: 80, size: 70, once: true, interactive: true }, reveal: 2.2 },
  { id: "rip", label: "Thick bong rip (pro)", emoji: "🌪️", layer: { kind: "hit", x: 6, y: 62, dir: 80, color: "#f6f6f6", color2: "#9ca3af", amount: 90, size: 80, once: true, interactive: true, style: "rip" }, reveal: 2.8 },
  { id: "exhale", label: "Slow exhale", emoji: "😮‍💨", layer: { kind: "hit", x: 10, y: 55, dir: 75, color: "#f1f1f1", color2: "#a3a3a3", amount: 70, size: 75, once: true, style: "exhale" }, reveal: 3.2 },
  { id: "mushroom", label: "Rolling mushroom", emoji: "🍄", layer: { kind: "hit", x: 50, y: 98, dir: 0, color: "#f4f4f4", color2: "#94a3b8", amount: 85, size: 85, once: true, interactive: true, style: "rolling" }, reveal: 2.6 },
  { id: "wall", label: "Smoke wall reveal", emoji: "🧱", layer: { kind: "hit", x: 0, y: 70, dir: 85, color: "#ececec", color2: "#7c7c7c", amount: 95, size: 100, once: true, style: "wall" }, reveal: 3.6 },
  { id: "puffs", label: "Puff puff pass", emoji: "☁️", layer: { kind: "hit", x: 8, y: 60, dir: 80, color: "#f5f5f5", color2: "#a1a1aa", amount: 80, size: 70, once: true, interactive: true, style: "puffs" }, reveal: 2.8 },
  { id: "psy", label: "Psychedelic cloud", emoji: "🌈", layer: { kind: "hit", x: 4, y: 55, dir: 85, color: "#ff3ea5", color2: "#22d3ee", rainbow: true, amount: 85, size: 80, once: true, interactive: true }, reveal: 2.4 },
  { id: "fog", label: "Spooky fog (bottom)", emoji: "🌫️", layer: { kind: "fog", x: 50, y: 100, dir: 0, color: "#d9dde3", color2: "#6b7280", amount: 70, size: 40 } },
  { id: "greenfog", label: "Green fog", emoji: "🟢", layer: { kind: "fog", x: 50, y: 100, dir: 0, color: "#7ed957", color2: "#1f5130", amount: 60, size: 45 } },
  { id: "haze", label: "Dreamy haze", emoji: "✨", layer: { kind: "haze", x: 50, y: 50, dir: 90, color: "#ffffff", color2: "#c4b5fd", amount: 35, size: 60, speed: "slow" } },
];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function hex(v: unknown, def: string): string {
  if (typeof v !== "string") return def;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return def;
}
function num(v: unknown, def: number, min: number, max: number, step = 1): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.round(Math.min(max, Math.max(min, n)) / step) * step;
}
function numOrNull(v: unknown, min: number, max: number): number | null {
  return v === null || v === undefined || v === "" ? null : num(v, 0, min, max, 0.5);
}
const KIND_IDS = SMOKE_KINDS.map((k) => k.id);

export function normalizeSmokeLayer(raw: unknown, fallbackId: string): SmokeLayer | null {
  if (!isObj(raw)) return null;
  const kind = KIND_IDS.includes(raw.kind as SmokeKind) ? (raw.kind as SmokeKind) : null;
  if (!kind) return null;
  const id = typeof raw.id === "string" && /^[a-z0-9-]{1,40}$/.test(raw.id) ? raw.id : fallbackId;
  const l: SmokeLayer = {
    id,
    kind,
    x: num(raw.x, 50, 0, 100, 0.5),
    y: num(raw.y, 80, 0, 100, 0.5),
    mx: numOrNull(raw.mx, 0, 100),
    my: numOrNull(raw.my, 0, 100),
    dir: num(raw.dir, 0, -180, 180),
    color: hex(raw.color, "#eeeeee"),
    color2: hex(raw.color2, "#888888"),
    amount: num(raw.amount, 60, SMOKE_AMOUNT.min, SMOKE_AMOUNT.max),
    size: num(raw.size, 50, SMOKE_SIZE.min, SMOKE_SIZE.max),
  };
  if (raw.rainbow === true) l.rainbow = true;
  if (raw.speed === "slow" || raw.speed === "fast") l.speed = raw.speed;
  if (raw.once === true && (kind === "hit" || kind === "wisp")) l.once = true;
  const delay = num(raw.delay, 0, 0, SMOKE_DELAY_MAX, 0.1);
  if (delay > 0) l.delay = delay;
  if (raw.hideOnMobile === true) l.hideOnMobile = true;
  if (raw.interactive === true && kind === "hit") l.interactive = true;
  if (raw.front === true) l.front = true;
  if (kind === "hit") {
    if (HIT_STYLES.some((h) => h.id === raw.style)) l.style = raw.style as HitStyle;
    if (raw.emit !== undefined && raw.emit !== null) l.emit = num(raw.emit, 2, HIT_EMIT.min, HIT_EMIT.max, 0.1);
    if (raw.puffs !== undefined && raw.puffs !== null) l.puffs = num(raw.puffs, 1, HIT_PUFFS.min, HIT_PUFFS.max);
    for (const k of ["power", "spread", "source", "linger"] as const) if (raw[k] !== undefined && raw[k] !== null) l[k] = num(raw[k], 50, 0, 100);
    if (raw.rise !== undefined && raw.rise !== null) l.rise = num(raw.rise, 0, -100, 100);
  }
  if (kind !== "wisp" && raw.swirl !== undefined && raw.swirl !== null) l.swirl = num(raw.swirl, 50, 0, 100);
  return l;
}

/** Style bundle + the layer's own overrides → the numbers the engines use. */
export function hitTuning(l: SmokeLayer): HitTuning {
  const st = (HIT_STYLES.find((h) => h.id === l.style) ?? HIT_STYLES[0]).tune;
  const sp = SPEED_MUL[l.speed ?? "normal"];
  return {
    emit: l.emit ?? st.emit ?? Math.round(((0.9 + (l.size / 100) * 0.9) / sp) * 10) / 10,
    puffs: l.puffs ?? st.puffs,
    power: l.power ?? st.power,
    spread: l.spread ?? st.spread,
    source: l.source ?? st.source,
    swirl: l.swirl ?? st.swirl,
    rise: l.rise ?? st.rise,
    linger: l.linger ?? st.linger,
  };
}

/** Seconds: pouring out, then hanging in the air, then gone. */
export function hitTimeline(l: SmokeLayer): { emit: number; hang: number; total: number } {
  const t = hitTuning(l);
  const hang = Math.round(((1.4 + (t.linger / 100) * 4.6) / SPEED_MUL[l.speed ?? "normal"]) * 10) / 10;
  return { emit: t.emit, hang, total: Math.round((t.emit + hang) * 10) / 10 };
}

/** The on/off windows (seconds from start) the smoke pours in — one per puff. */
export function hitPuffWindows(l: SmokeLayer): [number, number][] {
  const { emit, puffs } = hitTuning(l);
  if (puffs <= 1) return [[0, emit]];
  const slot = emit / puffs;
  return Array.from({ length: puffs }, (_, i) => [Math.round(i * slot * 100) / 100, Math.round((i * slot + slot * 0.6) * 100) / 100] as [number, number]);
}

export function normalizeSmoke(raw: unknown): SmokeLayer[] {
  if (!Array.isArray(raw)) return [];
  const out: SmokeLayer[] = [];
  const used = new Set<string>();
  for (const r of raw) {
    if (out.length >= MAX_SMOKE_LAYERS) break;
    const l = normalizeSmokeLayer(r, `smoke-${out.length + 1}`);
    if (!l) continue;
    let id = l.id;
    for (let i = 2; used.has(id); i += 1) id = `${l.id}-${i}`;
    used.add(id);
    out.push({ ...l, id });
  }
  return out;
}

/** Seconds the words wait (0 = off). */
export function normalizeReveal(raw: unknown): number {
  const n = num(raw, 0, 0, REVEAL.max, 0.1);
  return n === 0 ? 0 : Math.max(REVEAL.min, n);
}

export function presetLayer(p: SmokePreset, id: string): SmokeLayer {
  return { ...p.layer, id, mx: null, my: null };
}

// ── Render parameters (shared by our WebGL2 shader + the WebGPU hit) ─────────

export const SMOKE_MODE: Record<SmokeKind, number> = { fog: 0, haze: 1, wisp: 2, hit: 3 };

export function rgb01(h: string): [number, number, number] {
  const s = hex(h, "#ffffff");
  return [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];
}

export type GlParams = {
  mode: number;
  /** Origin in shader space: x 0..1 left→right, y 0..1 BOTTOM→top. */
  ox: number;
  oy: number;
  /** Direction radians, 0 = up, clockwise. */
  dir: number;
  c1: [number, number, number];
  c2: [number, number, number];
  amount: number;
  size: number;
  speed: number;
  rainbow: number;
  /** Render-resolution scale: smoke is low-frequency, so draw small + upscale. */
  scale: number;
  /** 0..1 swirl (fog/haze/hit); fog+haze default .44 = the R58 look. */
  swirl: number;
  /** Hit only (0..1, rise −1..1). */
  power: number;
  spread: number;
  source: number;
  rise: number;
  linger: number;
  puffs: number;
  emit: number;
};

export function glParams(l: SmokeLayer, phone: boolean): GlParams {
  const x = phone && l.mx !== null ? l.mx : l.x;
  const y = phone && l.my !== null ? l.my : l.y;
  return {
    mode: SMOKE_MODE[l.kind],
    ox: x / 100,
    oy: 1 - y / 100,
    dir: (l.dir * Math.PI) / 180,
    c1: rgb01(l.color),
    c2: rgb01(l.color2),
    amount: l.amount / 100,
    size: l.size / 100,
    speed: SPEED_MUL[l.speed ?? "normal"],
    rainbow: l.rainbow ? 1 : 0,
    scale: l.kind === "wisp" ? 0.75 : 0.5,
    ...(l.kind === "hit"
      ? (() => {
          const t = hitTuning(l);
          return { swirl: t.swirl / 100, power: t.power / 100, spread: t.spread / 100, source: t.source / 100, rise: t.rise / 100, linger: t.linger / 100, puffs: t.puffs, emit: t.emit };
        })()
      : { swirl: (l.swirl ?? 44) / 100, power: 0, spread: 0, source: 0, rise: 0, linger: 0, puffs: 1, emit: 0 }),
  };
}

/** Seconds one play of a "once" layer lasts. */
export function onceSeconds(l: SmokeLayer): number {
  if (l.kind === "hit") return hitTimeline(l).total;
  return Math.round((6 / SPEED_MUL[l.speed ?? "normal"]) * 10) / 10;
}

/** Rainbow stops for the psychedelic WebGPU cloud (shaders.com `stops`, max 8). */
export const RAINBOW_STOPS = [
  { color: "#ff3ea5", position: 0 },
  { color: "#ffb02e", position: 0.2 },
  { color: "#ffe94d", position: 0.38 },
  { color: "#7ed957", position: 0.55 },
  { color: "#22d3ee", position: 0.72 },
  { color: "#8b5cf6", position: 1 },
];

/**
 * shaders.com `Smoke` props for a hit (see shaders.com/docs/components/smoke).
 * emitFrom is authored top-down (their default {x:.5,y:1} = bottom centre);
 * direction 0 = up, 90 = right — the same convention as ours.
 */
export function hitShaderProps(l: SmokeLayer, phone: boolean, emitting: boolean): Record<string, unknown> {
  const x = phone && l.mx !== null ? l.mx : l.x;
  const y = phone && l.my !== null ? l.my : l.y;
  const sp = SPEED_MUL[l.speed ?? "normal"];
  const t = hitTuning(l);
  const sz = l.size / 100;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const props: Record<string, unknown> = {
    emitFrom: { x: x / 100, y: y / 100 },
    direction: l.dir,
    // Ranges from the shaders.com Smoke source: speed .1–50, spread 0–180,
    // emitRadius .01–.3, intensity .1–1 (0 = stop), dissipation .1–3,
    // detail 0–50, gravity −2…2 (negative pulls UP), colorDecay 0–3.
    speed: Math.min(50, r1((6 + t.power * 0.4) * (0.7 + sz * 0.6) * sp)),
    spread: Math.round(8 + t.spread * 1.5),
    emitRadius: Math.min(0.3, Math.max(0.01, Math.round((0.015 + (t.source / 100) * 0.15 * (0.6 + sz * 0.6)) * 1000) / 1000)),
    intensity: emitting ? Math.min(1, r2(0.25 + (l.amount / 100) * 0.75)) : 0,
    dissipation: Math.min(3, r2(0.1 + Math.pow(1 - t.linger / 100, 1.5) * 1.4)),
    detail: Math.round(t.swirl / 2),
    gravity: r1(-(t.rise / 100) * 1.4) || 0,
    colorDecay: r1(0.3 + (1 - t.linger / 100) * 0.6),
    mouseInfluence: l.interactive ? 0.3 : 0,
    mouseRadius: 0.12,
    colorSpace: "oklab",
  };
  if (l.rainbow) props.stops = RAINBOW_STOPS;
  else {
    props.colorA = l.color;
    props.colorB = l.color2;
  }
  return props;
}

/** Seconds a hit keeps emitting (all puffs) before it drifts + dissipates. */
export function hitEmitSeconds(l: SmokeLayer): number {
  return hitTuning(l).emit;
}

// ── Self-tests ──────────────────────────────────────────────────────────────

export function __runBannerAtmosTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL banner-atmos-core: ${m}`);
    }
  };
  ok(normalizeSmokeLayer(null, "a") === null && normalizeSmokeLayer({ kind: "lava" }, "a") === null, "bad kind dropped");
  const w = normalizeSmokeLayer({ kind: "wisp", x: 200, y: -5, amount: 0, size: 999, color: "#ABC" }, "s1")!;
  ok(w.x === 100 && w.y === 0 && w.amount === 10 && w.size === 100 && w.color === "#aabbcc", "clamps + colour");
  ok(w.id === "s1" && w.mx === null && w.my === null && w.dir === 0, "defaults");
  ok(!("rainbow" in w) && !("once" in w) && !("delay" in w) && !("speed" in w), "optional fields only when used");
  ok(normalizeSmokeLayer({ kind: "fog", once: true }, "f")!.once === undefined, "fog never once");
  ok(normalizeSmokeLayer({ kind: "wisp", interactive: true }, "f")!.interactive === undefined, "only hits react to mouse");
  ok(normalizeSmokeLayer({ kind: "hit", once: true, delay: 99, speed: "fast" }, "h")!.delay === 10, "delay clamp");
  ok(normalizeSmoke("x").length === 0, "not array");
  const many = normalizeSmoke(Array.from({ length: 9 }, () => ({ kind: "fog", id: "a" })));
  ok(many.length === MAX_SMOKE_LAYERS && new Set(many.map((m) => m.id)).size === MAX_SMOKE_LAYERS, "max + unique ids");
  ok(normalizeReveal(undefined) === 0 && normalizeReveal(0.2) === REVEAL.min && normalizeReveal(99) === REVEAL.max, "reveal");
  const g = glParams({ ...w, x: 25, y: 75, mx: 10, my: null, dir: 90 }, true);
  ok(g.ox === 0.1 && g.oy === 0.25 && Math.abs(g.dir - Math.PI / 2) < 1e-9 && g.mode === 2, "gl params phone x, y flipped");
  ok(glParams(w, false).scale === 0.75 && glParams({ ...w, kind: "fog" }, false).scale === 0.5, "render scale");
  ok(rgb01("#ff0000")[0] === 1 && rgb01("#ff0000")[1] === 0, "rgb01");
  const h = normalizeSmokeLayer({ kind: "hit", x: 10, y: 60, dir: 90, rainbow: true, interactive: true }, "h")!;
  const hp = hitShaderProps(h, false, true);
  ok(JSON.stringify(hp.emitFrom) === JSON.stringify({ x: 0.1, y: 0.6 }) && hp.direction === 90, "hit emit + dir");
  ok(hp.stops === RAINBOW_STOPS && !("colorA" in hp) && hp.mouseInfluence === 0.3, "rainbow stops + mouse");
  ok(hitShaderProps(h, false, false).intensity === 0, "stop emitting");
  ok(hitShaderProps({ ...h, rainbow: undefined }, false, true).colorA === h.color, "plain colours");
  ok(onceSeconds({ ...h, speed: "slow" }) > onceSeconds(h), "slow lasts longer");
  ok(SMOKE_PRESETS.every((p) => normalizeSmokeLayer(presetLayer(p, "p"), "p") !== null), "presets valid");
  const sorted = (o: object) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  ok(SMOKE_PRESETS.every((p) => sorted(normalizeSmokeLayer(presetLayer(p, "b"), "b")!) === sorted(presetLayer(p, "b"))), "presets round-trip");
  // R60 — pro big-cloud controls
  ok(!("style" in h) && !("emit" in h) && !("swirl" in h), "R60 fields only when used");
  const pro = normalizeSmokeLayer({ kind: "hit", style: "rip", emit: 99, puffs: 0, power: 120, rise: -300, swirl: 70 }, "p")!;
  ok(pro.style === "rip" && pro.emit === HIT_EMIT.max && pro.puffs === 1 && pro.power === 100 && pro.rise === -100 && pro.swirl === 70, "R60 clamps");
  ok(normalizeSmokeLayer({ kind: "wisp", style: "rip", emit: 3, swirl: 50 }, "w")!.style === undefined && normalizeSmokeLayer({ kind: "wisp", swirl: 50 }, "w")!.swirl === undefined, "wisp untouched");
  ok(normalizeSmokeLayer({ kind: "fog", swirl: 80, emit: 2 }, "f")!.swirl === 80 && normalizeSmokeLayer({ kind: "fog", emit: 2 }, "f")!.emit === undefined, "fog swirl only");
  ok(normalizeSmokeLayer({ kind: "hit", style: "nope" }, "x")!.style === undefined, "bad style dropped");
  ok(hitTuning({ ...h, style: "rip" }).emit === 2.2 && hitTuning({ ...h, style: "rip", emit: 5 }).emit === 5, "style + override");
  ok(hitTimeline({ ...h, emit: 3 }).total > hitTimeline({ ...h, emit: 1 }).total, "longer pour lasts longer");
  ok(onceSeconds({ ...h, style: "rip" }) === hitTimeline({ ...h, style: "rip" }).total, "once = timeline");
  const pw = hitPuffWindows({ ...h, style: "puffs" });
  ok(pw.length === 3 && pw[0][0] === 0 && pw[2][1] < 2.4 && hitPuffWindows(h).length === 1, "puff windows");
  const up = hitShaderProps({ ...h, rise: 100 }, false, true);
  ok((up.gravity as number) < 0 && (hitShaderProps({ ...h, rise: -100 }, false, true).gravity as number) > 0, "rise → negative gravity");
  ok(HIT_STYLES.every((st) => { const p2 = hitShaderProps({ ...h, style: st.id, power: 100, size: 100, speed: "fast" }, false, true); return (p2.speed as number) <= 50 && (p2.spread as number) <= 180 && (p2.emitRadius as number) <= 0.3 && (p2.detail as number) <= 50; }), "props inside shaders.com ranges");
  ok(glParams({ ...w, kind: "fog" }, false).swirl === 0.44 && glParams(pro, false).puffs === 1, "gl swirl default + hit tuning");
  return { passed, failed };
}
