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
};

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
  return l;
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
  };
}

/** Seconds one play of a "once" layer lasts. */
export function onceSeconds(l: SmokeLayer): number {
  return Math.round(((l.kind === "hit" ? HIT_SECONDS : 6) / SPEED_MUL[l.speed ?? "normal"]) * 10) / 10;
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
  const props: Record<string, unknown> = {
    emitFrom: { x: x / 100, y: y / 100 },
    direction: l.dir,
    speed: Math.round((14 + (l.size / 100) * 26) * sp * 10) / 10,
    spread: Math.round(30 + (l.size / 100) * 40),
    emitRadius: Math.round((0.03 + (l.size / 100) * 0.07) * 1000) / 1000,
    intensity: emitting ? Math.round((0.4 + (l.amount / 100) * 0.8) * 100) / 100 : 0,
    dissipation: Math.round((0.45 - (l.amount / 100) * 0.3) * 100) / 100,
    detail: 28,
    gravity: 0,
    colorDecay: 0.5,
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

/** Seconds a hit keeps emitting before it drifts + dissipates. */
export function hitEmitSeconds(l: SmokeLayer): number {
  return Math.round((0.9 + (l.size / 100) * 0.9) * 10) / 10;
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
  return { passed, failed };
}
