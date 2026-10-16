/**
 * R59-S2/S3 — entrance animations + the intro curtain (pure + testable).
 *
 * ENTRANCES: any text box, button, shape or icon can enter with one of 18
 * effects, its own delay, length and feel. One-click "animate everything"
 * presets stagger the whole banner in reading order. Played with the Web
 * Animations API by BannerEntrances (tiny client island): only `opacity`,
 * `translate`, `scale`, `rotate`, `clip-path` and an appended `blur()` are
 * animated, and every effect's last keyframe is implicit, so it always lands
 * EXACTLY on the item's own styling (its rotation, see-through, glow …).
 *
 * INTRO CURTAIN ("start blank, then reveal"): the banner starts covered by a
 * colour / gradient / image / frosted-glass curtain that smoke plays over,
 * then the curtain leaves with one of 8 transitions and the real banner shows.
 *
 * Shoppers who ask for reduced motion see the finished banner at once (WCAG
 * 2.3.3); with JavaScript off, a <noscript> rule shows everything.
 */

export type EnterFx =
  | "fade" | "rise" | "drop" | "left" | "right" | "zoom" | "zoomOut" | "pop" | "bounce"
  | "blur" | "smoke" | "wipe" | "wipeUp" | "type" | "flip" | "spin" | "glitch" | "neon";
export type EnterEase = "smooth" | "gentle" | "snappy" | "springy";
export type Enter = { fx: EnterFx; delay?: number; dur?: number; ease?: EnterEase };

export const ENTER_FX: { id: EnterFx; label: string; group: string; dur: number }[] = [
  { id: "fade", label: "Fade", group: "Fade & slide", dur: 0.8 },
  { id: "rise", label: "Rise up", group: "Fade & slide", dur: 0.8 },
  { id: "drop", label: "Drop down", group: "Fade & slide", dur: 0.8 },
  { id: "left", label: "From left", group: "Fade & slide", dur: 0.8 },
  { id: "right", label: "From right", group: "Fade & slide", dur: 0.8 },
  { id: "zoom", label: "Zoom in", group: "Zoom & pop", dur: 0.7 },
  { id: "zoomOut", label: "Zoom down", group: "Zoom & pop", dur: 0.8 },
  { id: "pop", label: "Pop", group: "Zoom & pop", dur: 0.6 },
  { id: "bounce", label: "Bounce", group: "Zoom & pop", dur: 1 },
  { id: "spin", label: "Spin in", group: "Zoom & pop", dur: 0.9 },
  { id: "blur", label: "Focus in", group: "Reveal", dur: 0.9 },
  { id: "smoke", label: "From smoke", group: "Reveal", dur: 1.4 },
  { id: "wipe", label: "Wipe →", group: "Reveal", dur: 0.8 },
  { id: "wipeUp", label: "Wipe ↑", group: "Reveal", dur: 0.8 },
  { id: "type", label: "Typewriter", group: "Reveal", dur: 1.2 },
  { id: "flip", label: "Flip", group: "Fun", dur: 0.8 },
  { id: "glitch", label: "Glitch", group: "Fun", dur: 0.7 },
  { id: "neon", label: "Neon flicker", group: "Fun", dur: 1.1 },
];
const FX_IDS = ENTER_FX.map((f) => f.id);
export const ENTER_EASES: { id: EnterEase; label: string; css: string }[] = [
  { id: "smooth", label: "Smooth", css: "cubic-bezier(.2,.7,.2,1)" },
  { id: "gentle", label: "Gentle", css: "ease-in-out" },
  { id: "snappy", label: "Snappy", css: "cubic-bezier(.5,0,.1,1)" },
  { id: "springy", label: "Springy", css: "cubic-bezier(.34,1.56,.64,1)" },
];
const EASE_IDS = ENTER_EASES.map((e) => e.id);
export const ENTER_LIMITS = { delayMax: 10, durMin: 0.2, durMax: 4 };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const step = (v: unknown, min: number, max: number, s = 0.05): number | null => {
  const n = typeof v === "number" ? v : Number.NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.round(Math.min(max, Math.max(min, n)) / s) * s * 100) / 100;
};
const hex = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return null;
};

/** Only known effects; delay/length/feel written only when not the default. */
export function normalizeEnter(raw: unknown): Enter | undefined {
  if (!isObj(raw) || typeof raw.fx !== "string" || !(FX_IDS as string[]).includes(raw.fx)) return undefined;
  const e: Enter = { fx: raw.fx as EnterFx };
  const d = step(raw.delay, 0, ENTER_LIMITS.delayMax);
  if (d) e.delay = d;
  const l = step(raw.dur, ENTER_LIMITS.durMin, ENTER_LIMITS.durMax);
  if (l !== null && l !== fxInfo(e.fx).dur) e.dur = l;
  if (typeof raw.ease === "string" && (EASE_IDS as string[]).includes(raw.ease) && raw.ease !== "smooth") e.ease = raw.ease as EnterEase;
  return e;
}

export const fxInfo = (fx: EnterFx) => ENTER_FX.find((f) => f.id === fx) ?? ENTER_FX[0];
export const enterDur = (e: Enter) => e.dur ?? fxInfo(e.fx).dur;
export const easeCss = (e?: EnterEase) => (ENTER_EASES.find((x) => x.id === e) ?? ENTER_EASES[0]).css;

type Frame = Record<string, string | number>;
/**
 * Keyframes for an effect. The END keyframe is left implicit on purpose: the
 * browser finishes on the item's real styling. `filter` = the item's own
 * inline filter (blur is appended so the two lists interpolate smoothly).
 */
export function enterKeyframes(fx: EnterFx, ctx: { filter?: string; chars?: number } = {}): Frame[] {
  const base = ctx.filter && ctx.filter !== "none" ? `${ctx.filter} ` : "";
  switch (fx) {
    case "fade":
      return [{ opacity: 0 }];
    case "rise":
      return [{ opacity: 0, translate: "0 28px" }];
    case "drop":
      return [{ opacity: 0, translate: "0 -28px" }];
    case "left":
      return [{ opacity: 0, translate: "-60px 0" }];
    case "right":
      return [{ opacity: 0, translate: "60px 0" }];
    case "zoom":
      return [{ opacity: 0, scale: "0.6" }];
    case "zoomOut":
      return [{ opacity: 0, scale: "1.5" }];
    case "pop":
      return [{ opacity: 0, scale: "0", offset: 0 }, { scale: "1.12", offset: 0.6 }, { scale: "0.96", offset: 0.82 }];
    case "bounce":
      return [
        { opacity: 0, translate: "0 -80px", offset: 0 },
        { translate: "0 0", offset: 0.45 },
        { translate: "0 -22px", offset: 0.65 },
        { translate: "0 0", offset: 0.82 },
        { translate: "0 -6px", offset: 0.92 },
      ];
    case "spin":
      return [{ opacity: 0, scale: "0", rotate: "-270deg" }];
    case "blur":
      return [{ opacity: 0, filter: `${base}blur(14px)` }];
    case "smoke":
      return [
        { opacity: 0, filter: `${base}blur(22px)`, scale: "1.18", translate: "0 -10px", offset: 0 },
        { opacity: 0.55, offset: 0.45 },
      ];
    case "wipe":
      return [{ clipPath: "inset(-20% 100% -20% 0)" }, { clipPath: "inset(-20% 0% -20% 0)" }];
    case "wipeUp":
      return [{ clipPath: "inset(100% -20% 0 -20%)" }, { clipPath: "inset(0% -20% 0 -20%)" }];
    case "type":
      return [{ clipPath: "inset(-20% 100% -20% 0)" }, { clipPath: "inset(-20% 0% -20% 0)" }];
    case "flip":
      return [{ opacity: 0, rotate: "x 90deg" }];
    case "glitch":
      return [
        { opacity: 0, translate: "-8px 0", offset: 0 },
        { opacity: 1, translate: "6px 2px", offset: 0.2 },
        { opacity: 0.3, translate: "-4px -2px", offset: 0.35 },
        { opacity: 1, translate: "3px 0", offset: 0.55 },
        { translate: "-2px 1px", offset: 0.75 },
      ];
    case "neon":
      return [
        { opacity: 0, offset: 0 },
        { opacity: 1, offset: 0.1 },
        { opacity: 0.1, offset: 0.2 },
        { opacity: 1, offset: 0.35 },
        { opacity: 0.3, offset: 0.45 },
        { opacity: 1, offset: 0.7 },
      ];
  }
}

/** Typewriter: one step per character (min 4) so it really "types". */
export function enterEasing(e: Enter, chars = 12): string {
  if (e.fx === "type") return `steps(${Math.max(4, Math.min(80, chars))}, end)`;
  if (e.fx === "glitch" || e.fx === "neon") return "linear";
  return easeCss(e.ease);
}

// ── The banner's plan (who enters when) ────────────────────────────────────

type Item = { id: string; enter?: Enter; hidden?: boolean };
type PlanDesign = {
  boxes: (Item & { y: number; x: number })[];
  buttons: (Item & { y: number; x: number; enabled: boolean })[];
  elements?: (Item & { y: number; x: number })[];
  reveal?: number;
  intro?: Intro;
};
export type PlanItem = { id: string; fx: EnterFx; start: number; dur: number; ease?: EnterEase };

/**
 * Items with their own entrance start at (words-wait) + their delay. With
 * "words wait for the smoke" on, text + buttons WITHOUT their own entrance
 * rise in one after another (the R58 behaviour).
 */
export function entrancePlan(d: PlanDesign): PlanItem[] {
  // With the intro curtain on, EVERYTHING waits for it (words default to when it's ~40% gone).
  const base = d.reveal ?? (d.intro ? revealFor(d.intro) : 0);
  const out: PlanItem[] = [];
  let auto = 0;
  const add = (it: Item, isWord: boolean) => {
    if (it.hidden) return;
    if (it.enter) out.push({ id: it.id, fx: it.enter.fx, start: r2(base + (it.enter.delay ?? 0)), dur: enterDur(it.enter), ...(it.enter.ease ? { ease: it.enter.ease } : {}) });
    else if (isWord && base > 0) out.push({ id: it.id, fx: "rise", start: r2(base + auto++ * 0.09), dur: 0.9 });
    else if (d.intro) out.push({ id: it.id, fx: "fade", start: base, dur: 0.9 });
  };
  for (const e of d.elements ?? []) add(e, false);
  for (const b of d.boxes) add(b, true);
  for (const b of d.buttons) if (b.enabled) add(b, true);
  return out;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Reading order (top→bottom, then left→right): shapes first, then words, then buttons. */
export function readingOrder(d: PlanDesign): string[] {
  const sort = <T extends { x: number; y: number }>(a: T[]) => [...a].sort((p, q) => p.y - q.y || p.x - q.x);
  return [...sort((d.elements ?? []).filter((e) => !e.hidden)), ...sort(d.boxes.filter((b) => !b.hidden)), ...sort(d.buttons.filter((b) => b.enabled && !b.hidden))].map((i) => i.id);
}

export type EnterPreset = { id: string; label: string; emoji: string; pick: (kind: "element" | "box" | "button", i: number) => Enter | undefined };
const st = (fx: EnterFx, gap: number, extra: Partial<Enter> = {}) => (_k: string, i: number): Enter => ({ fx, ...(i ? { delay: r2(i * gap) } : {}), ...extra });
export const ENTER_PRESETS: EnterPreset[] = [
  { id: "cascade", label: "Cascade up", emoji: "⬆️", pick: st("rise", 0.15) },
  { id: "fade", label: "Soft fade", emoji: "🌫️", pick: st("fade", 0.2, { ease: "gentle" }) },
  { id: "slide", label: "Slide from left", emoji: "➡️", pick: st("left", 0.12) },
  { id: "pop", label: "Pop party", emoji: "🎉", pick: (k, i) => ({ fx: k === "box" ? "rise" : "pop", ...(i ? { delay: r2(i * 0.12) } : {}), ...(k === "box" ? {} : { ease: "springy" as const }) }) },
  { id: "zoom", label: "Zoom punch", emoji: "💥", pick: st("zoom", 0.12, { ease: "springy" }) },
  { id: "cinema", label: "Cinematic focus", emoji: "🎬", pick: st("blur", 0.25, { dur: 1.2 }) },
  { id: "smoke", label: "Out of the smoke", emoji: "💨", pick: st("smoke", 0.3) },
  { id: "type", label: "Typewriter", emoji: "⌨️", pick: (k, i) => ({ fx: k === "box" ? "type" : "fade", ...(i ? { delay: r2(i * 0.5) } : {}) }) },
  { id: "bounce", label: "Bouncy", emoji: "🏀", pick: st("bounce", 0.15) },
  { id: "neon", label: "Neon sign", emoji: "💡", pick: (k, i) => ({ fx: k === "box" ? "neon" : "fade", ...(i ? { delay: r2(i * 0.2) } : {}) }) },
  { id: "glitch", label: "Glitch", emoji: "📺", pick: st("glitch", 0.1) },
];

/** Apply a preset to every visible item in reading order (pure; returns new arrays). */
export function applyEnterPreset<D extends PlanDesign>(d: D, p: EnterPreset | null): D {
  const order = readingOrder(d);
  const set = <T extends Item>(arr: T[], kind: "element" | "box" | "button"): T[] =>
    arr.map((it) => {
      const i = order.indexOf(it.id);
      const next = { ...it };
      const e = p && i >= 0 ? normalizeEnter(p.pick(kind, i)) : undefined;
      if (e) next.enter = e;
      else delete next.enter;
      return next;
    });
  const out = { ...d, boxes: set(d.boxes, "box"), buttons: set(d.buttons, "button") };
  if (d.elements) out.elements = set(d.elements, "element");
  return out;
}

// ── Intro curtain ──────────────────────────────────────────────────────────

export type IntroOut = "fade" | "smoke" | "dissolve" | "wipe" | "wipeUp" | "iris" | "zoom" | "split";
export const INTRO_OUTS: { id: IntroOut; label: string }[] = [
  { id: "smoke", label: "Melt into smoke" },
  { id: "fade", label: "Fade" },
  { id: "dissolve", label: "Blur away" },
  { id: "wipe", label: "Wipe →" },
  { id: "wipeUp", label: "Wipe ↑" },
  { id: "iris", label: "Shrink to centre" },
  { id: "split", label: "Close to a line" },
  { id: "zoom", label: "Fly through" },
];
const OUT_IDS = INTRO_OUTS.map((o) => o.id);
export type Intro = {
  color: string;
  /** 0–100: how solid the curtain colour is (lower + frost = see the picture through frosted glass). */
  opacity?: number;
  color2?: string;
  angle?: number;
  /** site-relative path or Supabase public URL (validated by the caller). */
  image?: string;
  fit?: "cover" | "contain";
  /** contain only: image width as % of the banner (10–100). */
  size?: number;
  /** frosted glass: blur of the real banner behind the curtain (px). */
  frost?: number;
  hold: number;
  out: IntroOut;
  dur: number;
};
export const INTRO_LIMITS = { holdMin: 0.3, holdMax: 10, durMin: 0.3, durMax: 4 };

export function normalizeIntro(raw: unknown, safeSrc: (v: unknown) => string | null): Intro | undefined {
  if (!isObj(raw)) return undefined;
  const color = hex(raw.color);
  if (!color) return undefined;
  const it: Intro = {
    color,
    hold: step(raw.hold, INTRO_LIMITS.holdMin, INTRO_LIMITS.holdMax) ?? 2,
    out: typeof raw.out === "string" && (OUT_IDS as string[]).includes(raw.out) ? (raw.out as IntroOut) : "fade",
    dur: step(raw.dur, INTRO_LIMITS.durMin, INTRO_LIMITS.durMax) ?? 1.2,
  };
  const op = typeof raw.opacity === "number" && Number.isFinite(raw.opacity) ? Math.round(Math.min(100, Math.max(0, raw.opacity))) : 100;
  if (op !== 100) it.opacity = op;
  const c2 = hex(raw.color2);
  if (c2) {
    it.color2 = c2;
    const a = typeof raw.angle === "number" && Number.isFinite(raw.angle) ? Math.round(((raw.angle % 360) + 360) % 360) : 180;
    if (a !== 180) it.angle = a;
  }
  const img = safeSrc(raw.image);
  if (img) {
    it.image = img;
    if (raw.fit === "contain") {
      it.fit = "contain";
      const s = typeof raw.size === "number" && Number.isFinite(raw.size) ? Math.round(Math.min(100, Math.max(10, raw.size))) : 40;
      if (s !== 40) it.size = s;
    }
  }
  const fr = typeof raw.frost === "number" && Number.isFinite(raw.frost) ? Math.round(Math.min(30, Math.max(0, raw.frost))) : 0;
  if (fr) it.frost = fr;
  return it;
}

const rgba = (h: string, a: number) => {
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(a * 1000) / 1000})`;
};
const cssUrl = (src: string) => `url("${src.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;

/** Inline style for the curtain. */
export function introStyle(it: Intro): Record<string, string> {
  const a = (it.opacity ?? 100) / 100;
  const fill = it.color2 ? `linear-gradient(${it.angle ?? 180}deg, ${rgba(it.color, a)}, ${rgba(it.color2, a)})` : `linear-gradient(${rgba(it.color, a)}, ${rgba(it.color, a)})`;
  const layers = it.image ? [`${cssUrl(it.image)} center / ${it.fit === "contain" ? `${it.size ?? 40}% auto` : "cover"} no-repeat`, fill] : [fill];
  const s: Record<string, string> = { background: layers.join(", ") };
  if (it.frost) {
    s.backdropFilter = `blur(${it.frost}px)`;
    s.WebkitBackdropFilter = `blur(${it.frost}px)`;
  }
  return s;
}

/** Keyframes for the curtain leaving (explicit both ends; fill: forwards). */
export function introOutKeyframes(out: IntroOut): Frame[] {
  switch (out) {
    case "fade":
      return [{ opacity: 1 }, { opacity: 0 }];
    case "dissolve":
      return [{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(28px)" }];
    case "smoke":
      return [
        { opacity: 1, filter: "blur(0px)", scale: "1", offset: 0 },
        { opacity: 0.7, filter: "blur(8px)", scale: "1.04", offset: 0.4 },
        { opacity: 0, filter: "blur(30px)", scale: "1.15", offset: 1 },
      ];
    case "wipe":
      return [{ clipPath: "inset(0 0 0 0%)" }, { clipPath: "inset(0 0 0 100%)" }];
    case "wipeUp":
      return [{ clipPath: "inset(0 0 0% 0)" }, { clipPath: "inset(0 0 100% 0)" }];
    case "iris":
      return [{ clipPath: "circle(75% at 50% 50%)" }, { clipPath: "circle(0% at 50% 50%)" }];
    case "split":
      return [{ clipPath: "inset(0 0% 0 0%)" }, { clipPath: "inset(0 50% 0 50%)" }];
    case "zoom":
      return [{ opacity: 1, scale: "1" }, { opacity: 0, scale: "1.8" }];
  }
}

/** One-click "start blank" recipes: curtain + the smoke that plays over it + when words appear. */
export type IntroPreset = { id: string; label: string; emoji: string; intro: Intro; smoke?: string };
export const INTRO_PRESETS: IntroPreset[] = [
  { id: "black-hit", label: "Black → bong hit → banner", emoji: "💨", smoke: "bong", intro: { color: "#000000", hold: 2, out: "smoke", dur: 1.4 } },
  { id: "psy", label: "Dark purple → rainbow cloud", emoji: "🌈", smoke: "psy", intro: { color: "#1a0033", color2: "#000000", hold: 2.2, out: "dissolve", dur: 1.4 } },
  { id: "frost", label: "Frosted picture → fog clears", emoji: "🧊", smoke: "fog", intro: { color: "#000000", opacity: 25, frost: 18, hold: 1.4, out: "fade", dur: 1.8 } },
  { id: "logo", label: "Logo on black → smoke", emoji: "🌿", smoke: "joint", intro: { color: "#000000", image: "/brand/greenway-black-gold-logo-transparent.png", fit: "contain", size: 30, hold: 2.4, out: "zoom", dur: 1.1 } },
  { id: "green", label: "Greenway green → wipe", emoji: "🟢", smoke: "greenfog", intro: { color: "#0b2015", color2: "#1f5130", angle: 135, hold: 1.6, out: "wipe", dur: 1 } },
  { id: "iris", label: "Black → circle reveal", emoji: "⚫", smoke: "haze", intro: { color: "#000000", hold: 1.2, out: "iris", dur: 1.2 } },
  { id: "white", label: "White-out haze", emoji: "☁️", smoke: "haze", intro: { color: "#f4f4f4", hold: 1.6, out: "dissolve", dur: 1.6 } },
];
/** Words appear as the curtain is ~40% gone. */
export const revealFor = (it: Intro) => Math.round((it.hold + it.dur * 0.4) * 10) / 10;

// ── Self-tests ─────────────────────────────────────────────────────────────

export function __runBannerEnterTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`  ✗ banner-enter: ${m}`);
    }
  };
  const J = JSON.stringify;
  ok(normalizeEnter({ fx: "explode" }) === undefined && normalizeEnter(null) === undefined, "unknown effect dropped");
  ok(J(normalizeEnter({ fx: "rise", delay: 0, dur: 0.8, ease: "smooth" })) === J({ fx: "rise" }), "defaults not written");
  ok(J(normalizeEnter({ fx: "pop", delay: 99, dur: 0.01, ease: "springy" })) === J({ fx: "pop", delay: 10, dur: 0.2, ease: "springy" }), "clamped");
  ok(normalizeEnter({ fx: "fade", delay: 0.333 })!.delay === 0.35, "delay snaps to 0.05 s");
  ok(ENTER_FX.length === 18 && ENTER_FX.every((f) => enterKeyframes(f.id).length >= 1), "18 effects, all have keyframes");
  ok(ENTER_FX.every((f) => !enterKeyframes(f.id).some((k) => k.offset === 1)), "end keyframe always implicit (lands on own styling)");
  ok(ENTER_FX.filter((f) => f.id !== "wipe" && f.id !== "wipeUp" && f.id !== "type").every((f) => enterKeyframes(f.id)[0].opacity === 0), "every non-wipe effect starts invisible");
  ok(enterKeyframes("blur", { filter: "drop-shadow(0 1px 2px red)" })[0].filter === "drop-shadow(0 1px 2px red) blur(14px)", "blur appended after own filter");
  ok(enterEasing({ fx: "type" }, 20) === "steps(20, end)" && enterEasing({ fx: "type" }, 1) === "steps(4, end)", "typewriter steps per char");
  const d: PlanDesign = {
    boxes: [{ id: "h", x: 5, y: 40 }, { id: "e", x: 5, y: 10 }, { id: "x", x: 5, y: 1, hidden: true }],
    buttons: [{ id: "b", x: 5, y: 80, enabled: true }],
    elements: [{ id: "s", x: 50, y: 50 }],
  };
  ok(readingOrder(d).join() === "s,e,h,b", "reading order: shapes, words top→bottom, buttons");
  ok(entrancePlan(d).length === 0, "no entrances, no reveal → empty plan (banner unchanged)");
  const words = entrancePlan({ ...d, reveal: 2 });
  ok(words.map((p) => `${p.id}@${p.start}`).join() === "h@2,e@2.09,b@2.18", "reveal: words rise one after another");
  const cas = applyEnterPreset(d, ENTER_PRESETS[0]);
  ok(J(cas.elements![0].enter) === J({ fx: "rise" }) && cas.boxes[1].enter?.delay === 0.15 && cas.boxes[0].enter?.delay === 0.3 && cas.buttons[0].enter?.delay === 0.45, "cascade staggers in reading order");
  ok(cas.boxes[2].enter === undefined, "hidden items skipped");
  const plan = entrancePlan({ ...cas, reveal: 1 });
  ok(plan.find((p) => p.id === "b")!.start === 1.45, "own entrance = words-wait + delay");
  ok(applyEnterPreset(cas, null).boxes.every((b) => !("enter" in b)), "remove all clears entrances");
  const safe = (v: unknown) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : null);
  ok(normalizeIntro({ color: "nope" }, safe) === undefined, "intro needs a colour");
  ok(J(normalizeIntro({ color: "#000", hold: 2, out: "smoke", dur: 1.4 }, safe)) === J({ color: "#000000", hold: 2, out: "smoke", dur: 1.4 }), "intro minimal");
  const ni = normalizeIntro({ color: "#000", image: "https://evil.example/x.png", frost: 99, opacity: 100, out: "boom" }, safe)!;
  ok(ni.image === undefined && ni.frost === 30 && ni.out === "fade" && !("opacity" in ni), "intro: bad image dropped, frost clamped, bad transition → fade");
  const S = (o: unknown) => J(Object.entries(o as object).sort(([a], [b]) => a.localeCompare(b)));
  ok(INTRO_PRESETS.every((p) => S(normalizeIntro(p.intro, safe)) === S(p.intro)), "every intro preset is normalized");
  ok(introStyle({ color: "#000000", hold: 1, out: "fade", dur: 1, image: '/a")b.png', fit: "contain" }).background.startsWith('url("/a%22)b.png") center / 40% auto'), "image url escaped + contain size");
  ok(introStyle({ color: "#ffffff", opacity: 50, frost: 10, hold: 1, out: "fade", dur: 1 }).backdropFilter === "blur(10px)", "frosted glass");
  ok(INTRO_OUTS.every((o) => introOutKeyframes(o.id).length >= 2), "every curtain transition has keyframes");
  ok(revealFor({ color: "#000000", hold: 2, out: "fade", dur: 1.5 }) === 2.6, "words appear as the curtain goes");
  const ip = entrancePlan({ ...d, intro: { color: "#000000", hold: 2, out: "fade", dur: 1.5 } });
  ok(ip.find((p) => p.id === "s")?.start === 2.6 && ip.find((p) => p.id === "h")?.start === 2.6, "intro: shapes + words wait for the curtain");
  return { passed, failed };
}
