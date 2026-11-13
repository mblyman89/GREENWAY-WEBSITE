/**
 * src/lib/cms/newsletter-picture-core.ts
 *
 * D243 E-4 (SOP-22 G-124): the AI picture tools of the newsletter studio,
 * pure part (no network, no keys). The owner asked for "generate an image or
 * gif using the ai. Or, use it to remove the background of an image I add to
 * the canvas. Or stretch or extend or other types of advanced features you'd
 * find in canva or adobe ... Change the color, remove this from the image,
 * etc. various image styles and transformations."
 *
 * Decision 3 (approved): FLUX does Erase and Replace (flux-pro-1.0-fill, a
 * painted mask) and Extend (flux-pro-1.0-expand); GPT Image or Gemini does
 * the rest. Enlarge runs on our own server (no AI cost).
 *
 * Every result is saved to Media as a NEW file; the original is never changed.
 * Every ask still goes through checkImageAsk (WAC 314-55-155) and gets the
 * safety rules added (fullImagePrompt).
 */
import { checkImageAsk, fullImagePrompt, type AiIssue, type ImageEngine } from "./newsletter-ai-core";
import { replaceImageUrl, type CanvasBlock } from "./newsletter-canvas-core";
import { STYLE_SWATCHES } from "./newsletter-style-core";

// ── Tools ──────────────────────────────────────────────────────────────

export type PictureTool =
  | "generate"
  | "edit"
  | "remove-bg"
  | "erase"
  | "replace"
  | "extend"
  | "recolor"
  | "relight"
  | "style"
  | "variation"
  | "upscale"
  | "gif-frame";

/** "local" = runs on our own server with sharp (free, no AI). */
export type ToolEngine = ImageEngine | "local";

export type PictureToolDef = {
  key: PictureTool;
  label: string;
  help: string;
  needsSource: boolean;
  needsMask: boolean;
  ask: "required" | "optional" | "none";
  engines: ToolEngine[];
};

export const PICTURE_TOOLS: PictureToolDef[] = [
  { key: "generate", label: "Make a picture", help: "Describe it; the AI draws a new picture in the shape you pick.", needsSource: false, needsMask: false, ask: "required", engines: ["gpt", "gemini", "flux"] },
  { key: "edit", label: "Edit with words", help: "Say what to change in the selected picture (put it on a wooden counter, add warm light...).", needsSource: true, needsMask: false, ask: "required", engines: ["gpt", "gemini", "flux"] },
  { key: "remove-bg", label: "Remove background", help: "Cuts the subject out. GPT Image gives a see-through PNG; Gemini puts it on white.", needsSource: true, needsMask: false, ask: "none", engines: ["gpt", "gemini"] },
  { key: "erase", label: "Erase (paint over it)", help: "Paint over what should go; FLUX fills the spot to match the background.", needsSource: true, needsMask: true, ask: "optional", engines: ["flux"] },
  { key: "replace", label: "Replace what I paint", help: "Paint an area and say what goes there instead (FLUX).", needsSource: true, needsMask: true, ask: "required", engines: ["flux"] },
  { key: "extend", label: "Extend / stretch", help: "Grow the picture on any side, or to a banner shape; FLUX draws the new edges.", needsSource: true, needsMask: false, ask: "optional", engines: ["flux"] },
  { key: "recolor", label: "Change a colour", help: "Say what to recolour and pick the new colour; everything else stays.", needsSource: true, needsMask: false, ask: "required", engines: ["gpt", "gemini"] },
  { key: "relight", label: "Relight", help: "New lighting (golden hour, studio, moody...) without changing the subject.", needsSource: true, needsMask: false, ask: "none", engines: ["gpt", "gemini"] },
  { key: "style", label: "Style look", help: "Restyle the picture (film photo, bright and airy, vintage poster...).", needsSource: true, needsMask: false, ask: "none", engines: ["gpt", "gemini"] },
  { key: "variation", label: "Variations", help: "Up to 3 fresh takes on the same picture to choose from.", needsSource: true, needsMask: false, ask: "optional", engines: ["gpt", "gemini"] },
  { key: "upscale", label: "Enlarge 2× (crisp)", help: "Doubles the size for sharp phones and retina screens. Runs on our server, no AI cost.", needsSource: true, needsMask: false, ask: "none", engines: ["local"] },
  { key: "gif-frame", label: "AI GIF", help: "The AI draws 3 or 4 frames with gentle motion and joins them into a looping GIF.", needsSource: false, needsMask: false, ask: "required", engines: ["gpt", "gemini"] },
];

export function toolDef(key: unknown): PictureToolDef {
  return PICTURE_TOOLS.find((t) => t.key === key) ?? PICTURE_TOOLS[0];
}

/** The engines that can run a tool right now (local is always there). */
export function toolEngines(tool: PictureTool, available: ImageEngine[]): ToolEngine[] {
  return toolDef(tool).engines.filter((e) => e === "local" || available.includes(e));
}

/** Keep the preferred engine when it can run the tool, else the first one that can. */
export function pickEngine(tool: PictureTool, preferred: ToolEngine | null, available: ImageEngine[]): ToolEngine | null {
  const can = toolEngines(tool, available);
  if (preferred && can.includes(preferred)) return preferred;
  return can[0] ?? null;
}

// ── Looks ──────────────────────────────────────────────────────────────

export const RELIGHT_LOOKS = [
  { key: "golden", label: "Golden hour", text: "warm, low golden-hour sunlight with soft long shadows" },
  { key: "studio", label: "Soft studio", text: "soft, even studio lighting with a gentle shadow under the subject" },
  { key: "moody", label: "Moody low-key", text: "dramatic low-key lighting, deep shadows and one soft key light" },
  { key: "daylight", label: "Bright daylight", text: "bright, clean natural daylight from a large window" },
  { key: "neon", label: "Neon accent", text: "dark scene with a soft green and gold neon rim light" },
  { key: "candle", label: "Cozy warm", text: "cozy warm interior light, like a lamp-lit evening" },
] as const;

/** Style looks. Nothing cartoonish or toy-like (WAC 314-55-155 appeal to children). */
export const STYLE_LOOKS = [
  { key: "product", label: "Clean product photo", text: "a crisp, professional e-commerce product photo on a seamless backdrop" },
  { key: "film", label: "Film photo", text: "a 35 mm film photograph with natural grain and gentle colour" },
  { key: "airy", label: "Bright and airy", text: "a bright, airy lifestyle photo with soft pastel tones" },
  { key: "dark", label: "Dark luxe", text: "a dark, premium look with rich blacks and subtle gold highlights" },
  { key: "poster", label: "Vintage poster", text: "a tasteful vintage travel-poster print with muted inks" },
  { key: "botanical", label: "Botanical print", text: "a fine-art botanical engraving with delicate lines" },
  { key: "flatlay", label: "Minimal flat lay", text: "a minimal top-down flat lay with lots of clean space" },
  { key: "duotone", label: "Brand duotone", text: "a bold duotone in deep green (#14301f) and Greenway green (#7ed957)" },
] as const;

export const GIF_MOTIONS = [
  { key: "light", label: "Light sweep", text: "a soft beam of light slowly sweeps from left to right" },
  { key: "glow", label: "Gentle glow", text: "the light softly brightens, like a slow pulse" },
  { key: "leaves", label: "Falling leaves", text: "a few autumn leaves drift down across the scene" },
  { key: "sparkle", label: "Sparkle", text: "small sparkles twinkle around the subject" },
  { key: "zoom", label: "Slow push-in", text: "the camera moves slightly closer to the subject" },
  { key: "snow", label: "Light snow", text: "light snow falls gently in front of the scene" },
] as const;

export const EXTEND_SIDES = [
  { key: "all", label: "All sides" },
  { key: "left", label: "Left" },
  { key: "right", label: "Right" },
  { key: "top", label: "Top" },
  { key: "bottom", label: "Bottom" },
  { key: "sides", label: "Left and right" },
] as const;
export type ExtendSide = (typeof EXTEND_SIDES)[number]["key"];

export const EXTEND_AMOUNTS = [25, 50, 100] as const;

/** Extend to a shape: the picture is grown (never cropped) to the ratio. */
export const EXTEND_SHAPES = [
  { key: "banner", label: "Email banner (2:1)", ratio: 2 },
  { key: "wide", label: "Wide (3:2)", ratio: 1.5 },
  { key: "square", label: "Square", ratio: 1 },
  { key: "story", label: "Tall (4:5)", ratio: 0.8 },
] as const;

export const FLUX_EXPAND_MAX_SIDE = 2048;
/** FLUX outputs are capped around 4 megapixels; bigger pads are scaled down. */
export const FLUX_MAX_PIXELS = 4_000_000;
export const VARIATIONS_MAX = 3;
export const GIF_AI_FRAMES = [3, 4] as const;

const lookOf = <T extends readonly { key: string }[]>(list: T, key: unknown): T[number] => list.find((l) => l.key === key) ?? list[0];

// ── Sizes ──────────────────────────────────────────────────────────────

export type Pad = { top: number; bottom: number; left: number; right: number };

function fitPad(w: number, h: number, p: Pad): Pad {
  const clampSide = (n: number) => Math.max(0, Math.min(FLUX_EXPAND_MAX_SIDE, Math.round(n)));
  let pad = { top: clampSide(p.top), bottom: clampSide(p.bottom), left: clampSide(p.left), right: clampSide(p.right) };
  const area = (q: Pad) => (w + q.left + q.right) * (h + q.top + q.bottom);
  if (area(pad) > FLUX_MAX_PIXELS) {
    // Shrink the padding (not the picture) until it fits.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      const q = { top: pad.top * mid, bottom: pad.bottom * mid, left: pad.left * mid, right: pad.right * mid };
      if (area(q) > FLUX_MAX_PIXELS) hi = mid;
      else lo = mid;
    }
    pad = { top: Math.floor(pad.top * lo), bottom: Math.floor(pad.bottom * lo), left: Math.floor(pad.left * lo), right: Math.floor(pad.right * lo) };
  }
  return pad;
}

/** Pixels to add per side for "grow the left side by 50%" and friends. */
export function extendPadding(w: number, h: number, side: ExtendSide, percent: number): Pad {
  const pct = Math.max(5, Math.min(100, Number(percent) || 50)) / 100;
  const dx = w * pct;
  const dy = h * pct;
  const pad: Pad = { top: 0, bottom: 0, left: 0, right: 0 };
  if (side === "left") pad.left = dx;
  else if (side === "right") pad.right = dx;
  else if (side === "top") pad.top = dy;
  else if (side === "bottom") pad.bottom = dy;
  else if (side === "sides") pad.left = pad.right = dx / 2;
  else {
    pad.left = pad.right = dx / 2;
    pad.top = pad.bottom = dy / 2;
  }
  return fitPad(w, h, pad);
}

/** Grow (centred) to a ratio; already that shape gives all zeros. */
export function padToRatio(w: number, h: number, ratio: number): Pad {
  if (!(w > 0 && h > 0 && ratio > 0)) return { top: 0, bottom: 0, left: 0, right: 0 };
  const now = w / h;
  if (Math.abs(now - ratio) / ratio < 0.02) return { top: 0, bottom: 0, left: 0, right: 0 };
  if (now < ratio) {
    const extra = h * ratio - w;
    return fitPad(w, h, { top: 0, bottom: 0, left: extra / 2, right: extra / 2 });
  }
  const extra = w / ratio - h;
  return fitPad(w, h, { top: extra / 2, bottom: extra / 2, left: 0, right: 0 });
}

export const padTotal = (p: Pad) => p.top + p.bottom + p.left + p.right;

/** Enlarge plan: 2× up to 2400 px; refuse when it is already sharp for email. */
export function upscalePlan(w: number, h: number): { ok: true; width: number; height: number } | { ok: false; error: string } {
  if (!(w > 0 && h > 0)) return { ok: false, error: "The picture size could not be read." };
  if (w >= 1200) return { ok: false, error: `Already sharp for email (${w} px wide; 1200 px is retina for a 600 px email).` };
  const factor = Math.min(2, 2400 / Math.max(w, h));
  if (factor < 1.2) return { ok: false, error: "The picture is already as large as it should be." };
  return { ok: true, width: Math.round(w * factor), height: Math.round(h * factor) };
}

// ── Masks ──────────────────────────────────────────────────────────────

export const MASK_DATA_URL_MAX = 6_000_000;

/** The painted share (0..1) must be a real area but not the whole picture. */
export function maskCoverageIssue(fraction: number): string | null {
  if (!(fraction >= 0.002)) return "Paint over the part to change first.";
  if (fraction > 0.9) return "That covers almost the whole picture. Use Make a picture instead.";
  return null;
}

/** Only a PNG data URL from the brush is accepted as a mask. */
export function maskBase64(dataUrl: unknown): string | null {
  const s = String(dataUrl ?? "");
  if (s.length > MASK_DATA_URL_MAX) return null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(s);
  return m ? m[1] : null;
}

// ── Colours ────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;

export function colourName(hex: string): string {
  const h = hex.toLowerCase();
  const sw = STYLE_SWATCHES.find((s) => s.hex.toLowerCase() === h);
  return sw ? `${sw.label} (${h})` : h;
}

// ── Prompts ────────────────────────────────────────────────────────────

export type PictureOpts = {
  ask?: string;
  colour?: string;
  look?: string;
  motion?: string;
  frame?: number;
  frames?: number;
  variant?: number;
};

export type PromptOut = { ok: true; prompt: string; issues: AiIssue[] } | { ok: false; error: string; issues: AiIssue[] };

const KEEP = "Keep the product, any label and any words on it exactly as they are.";

/**
 * The full prompt for a tool (with the safety rules). The owner's own words
 * are checked with checkImageAsk; a must-fix stops the call.
 */
export function buildPicturePrompt(tool: PictureTool, o: PictureOpts): PromptOut {
  const def = toolDef(tool);
  const ask = String(o.ask ?? "").trim();
  const issues = ask ? checkImageAsk(ask) : [];
  const must = issues.filter((i) => i.level === "must-fix");
  if (must.length) return { ok: false, error: must.map((i) => i.text).join(" "), issues };
  if (def.ask === "required" && !ask) {
    const what: Partial<Record<PictureTool, string>> = {
      generate: "Say what the picture should show.",
      edit: "Say what to change in the picture.",
      replace: "Say what should go in the painted area.",
      recolor: "Say what to recolour (for example: the jar lid).",
      "gif-frame": "Say what the GIF should show.",
    };
    return { ok: false, error: what[tool] ?? "Say what the AI should do.", issues };
  }
  let p = "";
  switch (tool) {
    case "generate":
      p = ask;
      break;
    case "edit":
      p = `${ask}. ${KEEP}`;
      break;
    case "remove-bg":
      p = "Remove the background completely. Keep the subject exactly as it is, with clean, natural edges.";
      break;
    case "erase":
      p = ask
        ? `Remove what is in the masked area (${ask}) and fill it so it blends naturally with the surroundings.`
        : "Remove what is in the masked area and fill it so it blends naturally with the surroundings, as if it was never there.";
      break;
    case "replace":
      p = `In the masked area: ${ask}. Match the light, perspective and colour of the rest of the picture.`;
      break;
    case "extend":
      p = ask ? `Continue the scene naturally beyond the edges: ${ask}.` : "Continue the scene naturally beyond the edges, matching the light, colour and texture. Do not add new subjects or words.";
      break;
    case "recolor": {
      const c = String(o.colour ?? "");
      if (!HEX.test(c)) return { ok: false, error: "Pick the new colour.", issues };
      p = `Change the colour of ${ask} to ${colourName(c)}. Keep everything else in the picture exactly the same. ${KEEP}`;
      break;
    }
    case "relight": {
      const l = lookOf(RELIGHT_LOOKS, o.look);
      p = `Relight this picture with ${l.text}. Do not change the subject, its shape or its position. ${KEEP}`;
      break;
    }
    case "style": {
      const l = lookOf(STYLE_LOOKS, o.look);
      p = `Restyle this picture as ${l.text}. Keep the same subject and composition. ${KEEP}`;
      break;
    }
    case "variation": {
      const n = Math.max(1, Math.min(VARIATIONS_MAX, Math.round(Number(o.variant) || 1)));
      p = `Make a fresh variation (take ${n}) of this picture: same subject, a new angle, backdrop or arrangement${ask ? `, ${ask}` : ""}. ${KEEP}`;
      break;
    }
    case "upscale":
      p = "";
      break;
    case "gif-frame": {
      const m = lookOf(GIF_MOTIONS, o.motion);
      const frames = Math.max(2, Math.min(4, Math.round(Number(o.frames) || 3)));
      const frame = Math.max(1, Math.min(frames, Math.round(Number(o.frame) || 1)));
      p =
        frame === 1
          ? `${ask}. This is frame 1 of ${frames} of a short looping animation in which ${m.text}.`
          : `The same picture, frame ${frame} of ${frames}: ${m.text}, one small step further than before. Keep everything else identical (same framing, subject, colours).`;
      break;
    }
  }
  return { ok: true, prompt: tool === "upscale" ? "" : fullImagePrompt(p), issues };
}

// ── FLUX bodies ────────────────────────────────────────────────────────

/** flux-pro-1.0-fill: white in the mask is redrawn, black is kept. */
export function fluxFillBody(p: { imageB64: string; maskB64: string; prompt: string }): Record<string, unknown> {
  return { prompt: p.prompt, image: p.imageB64, mask: p.maskB64, steps: 50, guidance: 30, output_format: "jpeg", safety_tolerance: 2, prompt_upsampling: false };
}

/** flux-pro-1.0-expand: pixels to add on each side. */
export function fluxExpandBody(p: { imageB64: string; pad: Pad; prompt: string }): Record<string, unknown> {
  return {
    prompt: p.prompt,
    image: p.imageB64,
    top: p.pad.top,
    bottom: p.pad.bottom,
    left: p.pad.left,
    right: p.pad.right,
    steps: 50,
    guidance: 60,
    output_format: "jpeg",
    safety_tolerance: 2,
    prompt_upsampling: false,
  };
}

// ── Pictures on the canvas ─────────────────────────────────────────────

export type PictureTarget = { url: string; label: string };

/** Every picture in a section the tools can work on (QR codes are left alone). */
export function pictureTargets(b: CanvasBlock | null): PictureTarget[] {
  if (!b) return [];
  const out: PictureTarget[] = [];
  if ((b.type === "image" || b.type === "design" || b.type === "overlay") && b.src) out.push({ url: b.src, label: b.type === "overlay" ? "Background picture" : b.type === "design" ? "Design picture" : "Picture" });
  if (b.type === "cards") b.cards.forEach((c, i) => c.imageUrl && out.push({ url: c.imageUrl, label: `Card ${i + 1}: ${c.title || "picture"}`.slice(0, 60) }));
  if (b.type === "columns") b.items.forEach((c, i) => c.imageUrl && out.push({ url: c.imageUrl, label: `Column ${i + 1}: ${c.title || "picture"}`.slice(0, 60) }));
  return out;
}

/** Put the new picture in place of the old one in THIS section only. */
export function swapPicture(b: CanvasBlock, from: string, to: string): CanvasBlock {
  const doc = replaceImageUrl({ version: 1, subject: "", preheader: "", theme: "dark", useForEmail: false, blocks: [b] }, from, to);
  return doc.blocks[0] ?? b;
}

/** Before/after split, 0-100 (%). */
export function clampSplit(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 50;
}

/** A short title for the saved Media file. */
export function resultTitle(tool: PictureTool, ask: string): string {
  return `AI ${toolDef(tool).label.toLowerCase()}${ask.trim() ? `: ${ask.trim()}` : ""}`.slice(0, 120);
}

// ── Self-test ──────────────────────────────────────────────────────────

export function __runNewsletterPictureCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL newsletter-picture-core: ${name}`);
    }
  };

  // tools and engines
  ok("12 tools", PICTURE_TOOLS.length === 12);
  ok("edit keeps label", (() => {
    const r = buildPicturePrompt("edit", { ask: "Put it on a wooden counter" });
    return r.ok && r.prompt.startsWith("Put it on a wooden counter.") && r.prompt.includes("label");
  })());
  ok("edit needs ask", !buildPicturePrompt("edit", {}).ok);
  ok("unique keys", new Set(PICTURE_TOOLS.map((t) => t.key)).size === PICTURE_TOOLS.length);
  ok("toolDef fallback", toolDef("nope").key === "generate");
  ok("erase is FLUX only (decision 3)", toolDef("erase").engines.join() === "flux");
  ok("extend is FLUX only (decision 3)", toolDef("extend").engines.join() === "flux");
  ok("replace needs a mask", toolDef("replace").needsMask && toolDef("erase").needsMask);
  ok("upscale is local", toolEngines("upscale", []).join() === "local");
  ok("toolEngines filters", toolEngines("generate", ["gemini"]).join() === "gemini");
  ok("no flux = no erase", toolEngines("erase", ["gpt", "gemini"]).length === 0);
  ok("pickEngine keeps preferred", pickEngine("recolor", "gemini", ["gpt", "gemini"]) === "gemini");
  ok("pickEngine falls back", pickEngine("recolor", "flux", ["gpt", "gemini"]) === "gpt");
  ok("pickEngine null", pickEngine("extend", "gpt", ["gpt"]) === null);

  // sizes
  const l = extendPadding(1000, 500, "left", 50);
  ok("extend left 50%", l.left === 500 && l.right === 0 && l.top === 0);
  const a = extendPadding(1000, 500, "all", 50);
  ok("extend all splits", a.left === 250 && a.right === 250 && a.top === 125 && a.bottom === 125);
  const s = extendPadding(800, 800, "sides", 100);
  ok("extend sides", s.left === 400 && s.right === 400 && s.top === 0);
  const big = extendPadding(1536, 1536, "all", 100);
  ok("4 MP cap", (1536 + big.left + big.right) * (1536 + big.top + big.bottom) <= FLUX_MAX_PIXELS);
  ok("side cap 2048", extendPadding(4000, 100, "left", 100).left <= FLUX_EXPAND_MAX_SIDE);
  const b = padToRatio(1000, 1000, 2);
  ok("pad to banner", b.left === 500 && b.right === 500 && b.top === 0);
  const t = padToRatio(1000, 500, 1);
  ok("pad to square", t.top === 250 && t.bottom === 250 && t.left === 0);
  ok("already that shape", padTotal(padToRatio(1000, 500, 2)) === 0);
  ok("bad dims", padTotal(padToRatio(0, 10, 2)) === 0);
  const up = upscalePlan(600, 400);
  ok("upscale 2x", up.ok && up.width === 1200 && up.height === 800);
  ok("already retina", !upscalePlan(1200, 800).ok);
  ok("cap 2400", (() => {
    const r = upscalePlan(1100, 2000);
    return r.ok && r.height === 2400;
  })());
  ok("no size", !upscalePlan(0, 0).ok);

  // masks
  ok("empty mask", maskCoverageIssue(0) !== null);
  ok("whole mask", maskCoverageIssue(0.95) !== null);
  ok("good mask", maskCoverageIssue(0.1) === null);
  ok("mask png only", maskBase64("data:image/png;base64,iVBORw0KGgo=") === "iVBORw0KGgo=" && maskBase64("data:image/jpeg;base64,AAAA") === null);
  ok("mask no script", maskBase64("javascript:alert(1)") === null);

  // prompts
  const g = buildPicturePrompt("generate", { ask: "A cozy autumn storefront" });
  ok("generate has safety", g.ok && g.prompt.includes("no people who look under 21"));
  ok("generate needs ask", !buildPicturePrompt("generate", {}).ok);
  ok("WAC block", !buildPicturePrompt("generate", { ask: "a cartoon mascot" }).ok);
  ok("WAC block in replace", !buildPicturePrompt("replace", { ask: "a person smoking" }).ok);
  const e = buildPicturePrompt("erase", {});
  ok("erase without ask", e.ok && e.prompt.includes("masked area"));
  ok("recolor needs colour", !buildPicturePrompt("recolor", { ask: "the lid" }).ok);
  const rc = buildPicturePrompt("recolor", { ask: "the lid", colour: "#7ed957" });
  ok("recolor names swatch", rc.ok && rc.prompt.includes("Greenway green (#7ed957)"));
  const rl = buildPicturePrompt("relight", { look: "moody" });
  ok("relight look", rl.ok && rl.prompt.includes("low-key"));
  ok("relight fallback", (() => {
    const r = buildPicturePrompt("relight", { look: "x" });
    return r.ok && r.prompt.includes("golden-hour");
  })());
  ok("style keeps label", (() => {
    const r = buildPicturePrompt("style", { look: "film" });
    return r.ok && r.prompt.includes("label");
  })());
  ok("no cartoon looks", !STYLE_LOOKS.some((x) => /cartoon|anime|toy|kids/i.test(x.text + x.label)));
  ok("variation n", (() => {
    const r = buildPicturePrompt("variation", { variant: 9 });
    return r.ok && r.prompt.includes("take 3");
  })());
  const f1 = buildPicturePrompt("gif-frame", { ask: "A glass jar on a counter", motion: "light", frame: 1, frames: 4 });
  const f2 = buildPicturePrompt("gif-frame", { ask: "A glass jar on a counter", motion: "light", frame: 2, frames: 4 });
  ok("gif frame 1", f1.ok && f1.prompt.includes("frame 1 of 4"));
  ok("gif frame 2 keeps", f2.ok && f2.prompt.includes("Keep everything else identical"));
  ok("upscale no prompt", (() => {
    const r = buildPicturePrompt("upscale", {});
    return r.ok && r.prompt === "";
  })());
  ok("superlative heads-up", (() => {
    const r = buildPicturePrompt("generate", { ask: "the best jar ever" });
    return r.ok && r.issues.some((i) => i.level === "heads-up");
  })());

  // flux bodies
  const fb = fluxFillBody({ imageB64: "I", maskB64: "M", prompt: "P" });
  ok("fill body", fb.image === "I" && fb.mask === "M" && fb.steps === 50 && fb.output_format === "jpeg");
  const xb = fluxExpandBody({ imageB64: "I", pad: { top: 1, bottom: 2, left: 3, right: 4 }, prompt: "P" });
  ok("expand body", xb.top === 1 && xb.bottom === 2 && xb.left === 3 && xb.right === 4 && xb.image === "I");

  // targets and swap
  const img: CanvasBlock = { id: "i", type: "image", src: "https://x/a.jpg", alt: "", href: "", width: 600, caption: "" };
  ok("image target", pictureTargets(img).length === 1);
  ok("swap image", (swapPicture(img, "https://x/a.jpg", "https://x/b.jpg") as { src: string }).src === "https://x/b.jpg");
  const cards = { id: "c", type: "cards", kind: "drops", heading: "", columns: 2, cards: [{ title: "A", text: "", imageUrl: "https://x/1.jpg", imageAlt: "", href: "", cta: "" }, { title: "B", text: "", imageUrl: "", imageAlt: "", href: "", cta: "" }] } as unknown as CanvasBlock;
  ok("card targets skip empty", pictureTargets(cards).length === 1 && pictureTargets(cards)[0].label.startsWith("Card 1"));
  ok("swap card", (swapPicture(cards, "https://x/1.jpg", "https://x/2.jpg") as unknown as { cards: { imageUrl: string }[] }).cards[0].imageUrl === "https://x/2.jpg");
  ok("qr not a target", pictureTargets({ id: "q", type: "qr", url: "https://x", src: "https://x/q.png", caption: "", size: 180 }).length === 0);
  ok("null target", pictureTargets(null).length === 0);
  ok("split clamp", clampSplit(150) === 100 && clampSplit(-3) === 0 && clampSplit("x") === 50);
  ok("title", resultTitle("erase", "the cup").startsWith("AI erase (paint over it): the cup"));
  return { passed, failed };
}
