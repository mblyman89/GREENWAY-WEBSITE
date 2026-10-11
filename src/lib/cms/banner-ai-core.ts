/**
 * src/lib/cms/banner-ai-core.ts — R41 S8 "AI focus + placement" (Q21).
 *
 * PURE helpers behind the Banner Studio "✨ AI suggest" button. The AI (a
 * vision model) LOOKS at the banner picture and answers in strict JSON: where
 * the subject is (focal point), which empty area is best for text, what shade
 * helps legibility, and whether the text there should be light or dark.
 *
 * Nothing here saves anything (bible rule 3, drafts-only): the action returns
 * the suggestion, Banner Studio previews it, and only "Apply" changes the
 * editor's UNSAVED state (one Undo step). The owner still presses Save/Publish.
 *
 *   • buildPlacementPrompt() — instruction text (asks for STRICT JSON only)
 *   • parsePlacementReply()  — fences/garbage tolerant, clamps, enums → or null
 *   • applySuggestion()      — new design: focus + boxes stacked inside the
 *                              suggested zone + buttons below + shade + colour
 *                              (desktop writes x/y/w + focusX/Y; phone writes
 *                              mx/my/mw + focusXMobile/YMobile only)
 */
import {
  OVERLAY_DIRECTIONS,
  OVERLAY_KINDS,
  estimateBoxHeightPct,
  resolveBoxText,
  type BannerDesign,
  type DesignDevice,
  type DesignDirection,
  type DesignOverlayKind,
} from "./banner-design-core";

export type TextZone = { x: number; y: number; w: number; h: number };

export type PlacementSuggestion = {
  focusX: number;
  focusY: number;
  textZone: TextZone;
  overlay: DesignOverlayKind;
  overlayDirection: DesignDirection;
  textColor: "light" | "dark";
  reason: string;
};

export const LIGHT_TEXT = "#ffffff";
export const DARK_TEXT = "#111111";
const MAX_REASON = 200;
const MIN_ZONE_W = 20;
const MIN_ZONE_H = 15;

const half = (n: number) => Math.round(n * 2) / 2;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Extra system rules appended after COMPLIANCE_SYSTEM by the action. */
export const PLACEMENT_SYSTEM = [
  "You are also a senior web banner art director.",
  "You will see ONE banner background photo. Decide where text reads best without covering the main subject.",
  "Reply with STRICT JSON only (no markdown, no prose), exactly this shape:",
  '{"focusX":0-100,"focusY":0-100,"textZone":{"x":0-100,"y":0-100,"w":0-100,"h":0-100},"overlay":"none|full|gradient|floor|radial","overlayDirection":"left|right|top|bottom","textColor":"light|dark","reason":"<=200 chars"}',
  "focusX/focusY = the main subject's centre as % of width/height (0,0 = top-left).",
  "textZone = the calmest empty rectangle for the text block, % of the banner, top-left corner + size. It must not cover the subject.",
  "overlay = the shading that makes text readable there; overlayDirection = the side the shade is darkest on (for gradient).",
  "textColor = light if the zone is dark (or will be shaded dark), else dark.",
  "reason = one short plain-English sentence for a shop owner. Do not mention prices, effects, or health.",
].join("\n");

/** The user message: what text must fit, for which device. */
export function buildPlacementPrompt(input: {
  device: DesignDevice;
  boxes: { role: string; chars: number }[];
  buttons: number;
}): string {
  const shape = input.device === "mobile" ? "a PHONE banner (tall-ish, about 390px wide)" : "a WIDE desktop banner (about 1408px wide)";
  const lines = input.boxes.length
    ? input.boxes.map((b) => `- ${b.role}: about ${Math.max(0, Math.round(b.chars))} characters`).join("\n")
    : "- (no text yet)";
  return [
    `This photo is the background of ${shape}.`,
    "The text block that must fit inside textZone, top to bottom:",
    lines,
    input.buttons > 0 ? `Plus ${input.buttons} button${input.buttons === 1 ? "" : "s"} under the text.` : "No buttons.",
    "Return the JSON now.",
  ].join("\n");
}

function numIn(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** Validate the model's reply. Anything unusable → null (never guess). */
export function parsePlacementReply(raw: unknown): PlacementSuggestion | null {
  if (typeof raw !== "string") return null;
  let text = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const fx = numIn(d.focusX);
  const fy = numIn(d.focusY);
  const z = d.textZone && typeof d.textZone === "object" ? (d.textZone as Record<string, unknown>) : null;
  if (fx === null || fy === null || !z) return null;
  const zx = numIn(z.x);
  const zy = numIn(z.y);
  const zw = numIn(z.w);
  const zh = numIn(z.h);
  if (zx === null || zy === null || zw === null || zh === null) return null;
  const x = half(clamp(zx, 0, 100 - MIN_ZONE_W));
  const y = half(clamp(zy, 0, 100 - MIN_ZONE_H));
  const w = half(clamp(zw, MIN_ZONE_W, 100 - x));
  const h = half(clamp(zh, MIN_ZONE_H, 100 - y));
  const overlay = typeof d.overlay === "string" && (OVERLAY_KINDS as string[]).includes(d.overlay) ? (d.overlay as DesignOverlayKind) : null;
  const dir =
    typeof d.overlayDirection === "string" && (OVERLAY_DIRECTIONS as string[]).includes(d.overlayDirection)
      ? (d.overlayDirection as DesignDirection)
      : null;
  const color = d.textColor === "light" || d.textColor === "dark" ? d.textColor : null;
  if (!overlay || !dir || !color) return null;
  const reason = typeof d.reason === "string" ? d.reason.replace(/\s+/g, " ").trim().slice(0, MAX_REASON) : "";
  return {
    focusX: half(clamp(fx, 0, 100)),
    focusY: half(clamp(fy, 0, 100)),
    textZone: { x, y, w, h },
    overlay,
    overlayDirection: dir,
    textColor: color,
    reason,
  };
}

/** The visible text boxes in reading order (top to bottom for that device). */
function readingOrder(design: BannerDesign, device: DesignDevice) {
  return design.boxes
    .filter((b) => !b.hidden && !(device === "mobile" && b.hideOnMobile))
    .map((b, i) => ({ b, i, y: device === "mobile" ? (b.my ?? b.y) : b.y }))
    .sort((a, c) => a.y - c.y || a.i - c.i)
    .map((r) => r.b);
}

/** What the prompt needs to know about the current text (role + length). */
export function promptInputFor(design: BannerDesign, legacy: { eyebrow?: string; title?: string; subtitle?: string }, device: DesignDevice) {
  return {
    device,
    boxes: readingOrder(design, device).map((b) => ({ role: b.role, chars: resolveBoxText(b, legacy).length })),
    buttons: design.buttons.filter((b) => b.enabled && !(device === "mobile" && b.hideOnMobile)).length,
  };
}

/**
 * The URL the AI provider fetches. Only https URLs or site-relative paths
 * ("/home/x.webp" → origin + path) are allowed; anything else (http, data:,
 * javascript:, protocol-relative "//", blank) → null and the action refuses.
 */
export function absoluteImageUrl(src: unknown, origin: string): string | null {
  if (typeof src !== "string") return null;
  const v = src.trim();
  if (!v) return null;
  if (v.startsWith("/") && !v.startsWith("//")) {
    try {
      const u = new URL(v, origin);
      return u.protocol === "https:" ? u.toString() : null;
    } catch {
      return null;
    }
  }
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

const GAP_PCT = 2;

/**
 * Lay the design out per the suggestion for ONE device. Boxes keep their ids,
 * text, fonts and sizes; only position/width (+ colour) change. Buttons go in a
 * row under the text. Returns a new design (the input is not mutated).
 */
export function applySuggestion(
  design: BannerDesign,
  s: PlacementSuggestion,
  legacy: { eyebrow?: string; title?: string; subtitle?: string },
  device: DesignDevice,
): BannerDesign {
  const next: BannerDesign = JSON.parse(JSON.stringify(design));
  const mobile = device === "mobile";
  const z = s.textZone;
  const color = s.textColor === "light" ? LIGHT_TEXT : DARK_TEXT;

  if (mobile) {
    next.image.focusXMobile = s.focusX;
    next.image.focusYMobile = s.focusY;
  } else {
    next.image.focusX = s.focusX;
    next.image.focusY = s.focusY;
    // Shade is shared by both layouts: only the desktop suggestion sets it.
    next.overlay = {
      ...next.overlay,
      kind: s.overlay,
      direction: s.overlayDirection,
      color: s.textColor === "light" ? "#000000" : "#ffffff",
    };
  }

  const order = readingOrder(next, device);
  let y = z.y;
  for (const b of order) {
    const w = half(clamp(z.w, 5, 100 - z.x));
    const yy = half(clamp(y, 0, 95));
    if (mobile) {
      b.mx = z.x;
      b.my = yy;
      b.mw = w;
    } else {
      b.x = z.x;
      b.y = yy;
      b.w = w;
    }
    // Colour is shared by both layouts: only change it from the desktop pass,
    // or on phone when the box has no shade of its own to keep it readable.
    if (!mobile) b.color = color;
    const sized = { ...b, w, mw: mobile ? w : b.mw };
    y += estimateBoxHeightPct(sized, resolveBoxText(b, legacy).length, device, next) + GAP_PCT;
  }

  // Buttons: one row under the text, left-aligned to the zone, wrapping lines.
  const btns = next.buttons.filter((b) => b.enabled && !(mobile && b.hideOnMobile));
  let bx = z.x;
  const by0 = half(clamp(y, 0, 92));
  let by = by0;
  for (const btn of btns) {
    const approxW = Math.min(45, Math.max(12, ((btn.label.length * 9 + 40) / (mobile ? 390 : 1408)) * 100));
    if (bx > z.x && bx + approxW > z.x + z.w) {
      bx = z.x;
      by = half(clamp(by + (mobile ? 22 : 18), 0, 92));
    }
    if (mobile) {
      btn.mx = half(clamp(bx, 0, 100));
      btn.my = by;
    } else {
      btn.x = half(clamp(bx, 0, 100));
      btn.y = by;
    }
    bx += approxW + 2;
  }
  return next;
}

// ── Self-tests (registered in scripts/compliance/run-pure-selftests.ts) ─────
export function __runBannerAiCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`banner-ai-core: ${m}`);
    passed += 1;
  };
  const good =
    '{"focusX":70,"focusY":40,"textZone":{"x":5,"y":20,"w":45,"h":60},"overlay":"gradient","overlayDirection":"left","textColor":"light","reason":"The product sits on the right; the left is calm."}';
  const p = parsePlacementReply(good)!;
  ok(!!p && p.focusX === 70 && p.textZone.w === 45 && p.overlay === "gradient", "parses strict JSON");
  ok(parsePlacementReply("```json\n" + good + "\n```")?.focusY === 40, "strips code fences");
  ok(parsePlacementReply("Sure! Here you go: " + good + " Hope that helps")?.textColor === "light", "ignores chatter around JSON");
  ok(parsePlacementReply("no json here") === null, "garbage → null");
  ok(parsePlacementReply("{bad json}") === null, "bad json → null");
  ok(parsePlacementReply(42) === null, "non-string → null");
  ok(parsePlacementReply('{"focusX":50}') === null, "missing fields → null");
  ok(parsePlacementReply(good.replace('"gradient"', '"sparkles"')) === null, "bad overlay enum → null");
  ok(parsePlacementReply(good.replace('"left","textColor"', '"diagonal","textColor"')) === null, "bad direction → null");
  ok(parsePlacementReply(good.replace('"light"', '"purple"')) === null, "bad colour → null");
  const big = parsePlacementReply('{"focusX":150,"focusY":-5,"textZone":{"x":95,"y":99,"w":300,"h":2},"overlay":"none","overlayDirection":"top","textColor":"dark","reason":"x"}')!;
  ok(big.focusX === 100 && big.focusY === 0, "focus clamped");
  ok(big.textZone.x === 80 && big.textZone.y === 85 && big.textZone.x + big.textZone.w <= 100 && big.textZone.h >= 15, "zone clamped inside banner with minimum size");
  ok(parsePlacementReply(good.replace("The product sits", "A".repeat(500)))!.reason.length <= 200, "reason capped");
  ok(parsePlacementReply('{"focusX":"60","focusY":"30","textZone":{"x":"10","y":"10","w":"40","h":"50"},"overlay":"full","overlayDirection":"right","textColor":"dark"}')?.focusX === 60, "numeric strings ok, reason optional");

  // prompt
  const pr = buildPlacementPrompt({ device: "mobile", boxes: [{ role: "headline", chars: 20 }], buttons: 2 });
  ok(pr.includes("PHONE") && pr.includes("headline: about 20") && pr.includes("2 buttons"), "prompt content");
  ok(PLACEMENT_SYSTEM.includes("STRICT JSON") && PLACEMENT_SYSTEM.includes('"textZone"'), "system asks for strict JSON");

  // apply
  const design: BannerDesign = {
    v: 1,
    enabled: true,
    frame: { height: 260, heightMobile: 200, radius: 16 },
    image: { focusX: 50, focusY: 50, focusXMobile: null, focusYMobile: null, zoom: 100, brightness: 100, saturation: 100, blur: 0, flip: false },
    overlay: { kind: "none", color: "#000000", opacity: 70, direction: "left" },
    boxes: [
      { id: "headline", role: "headline", bind: "title", text: "", x: 50, y: 50, w: 40, mx: null, my: null, mw: null, align: "left", font: "site", size: 40, sizeMobile: 26, weight: 900, italic: false, underline: false, strike: false, transform: "none", color: "#000000", opacity: 100, letterSpacing: 0, lineHeight: 1.1, shadow: "none", outline: false, backdrop: "none", backdropColor: "#000000", backdropOpacity: 50, wrap: "normal", hidden: false, hideOnMobile: false },
      { id: "eyebrow", role: "eyebrow", bind: "eyebrow", text: "", x: 50, y: 20, w: 40, mx: null, my: null, mw: null, align: "left", font: "site", size: 14, sizeMobile: 12, weight: 700, italic: false, underline: false, strike: false, transform: "uppercase", color: "#000000", opacity: 100, letterSpacing: 0.1, lineHeight: 1.2, shadow: "none", outline: false, backdrop: "none", backdropColor: "#000000", backdropOpacity: 50, wrap: "normal", hidden: false, hideOnMobile: false },
    ],
    buttons: [{ id: "go", label: "Shop now", href: "/menu", x: 80, y: 80, mx: null, my: null, size: "md", shape: "pill", style: "solid", bg: "#7ed957", fg: "#000000", border: "#7ed957", font: "site", uppercase: false, newTab: false, enabled: true, hideOnMobile: false }],
  };
  const legacy = { eyebrow: "Deals", title: "Big Weekend Sale" };
  const before = JSON.stringify(design);
  const a = applySuggestion(design, p, legacy, "desktop");
  ok(JSON.stringify(design) === before, "input not mutated");
  ok(a.image.focusX === 70 && a.image.focusY === 40 && a.image.focusXMobile === null, "desktop focus only");
  ok(a.overlay.kind === "gradient" && a.overlay.direction === "left" && a.overlay.opacity === 70, "shade applied, opacity kept");
  const eb = a.boxes.find((b) => b.id === "eyebrow")!;
  const hl = a.boxes.find((b) => b.id === "headline")!;
  ok(eb.x === 5 && hl.x === 5 && eb.w === 45, "boxes moved into zone");
  ok(eb.y === 20 && hl.y > eb.y, "reading order kept (eyebrow above headline)");
  ok(hl.color === LIGHT_TEXT && eb.color === LIGHT_TEXT, "light text applied");
  ok(a.boxes.map((b) => b.id).join() === "headline,eyebrow", "ids + array order unchanged");
  ok(a.buttons[0].x === 5 && a.buttons[0].y > hl.y, "button under text in zone");
  ok(a.boxes.every((b) => b.mx === null && b.my === null), "desktop apply leaves phone untouched");
  const m = applySuggestion(design, p, legacy, "mobile");
  ok(m.image.focusXMobile === 70 && m.image.focusX === 50, "phone focus only");
  ok(m.boxes.every((b) => b.x === 50 && b.mx === 5 && b.mw === 45), "phone writes mx/mw only");
  ok(m.overlay.kind === "none" && m.boxes[0].color === "#000000", "phone leaves shared shade + colour");
  ok(m.buttons[0].mx === 5 && m.buttons[0].x === 80, "phone button override only");
  const hidden = applySuggestion({ ...design, boxes: design.boxes.map((b) => (b.id === "eyebrow" ? { ...b, hidden: true } : b)) }, p, legacy, "desktop");
  ok(hidden.boxes.find((b) => b.id === "eyebrow")!.x === 50, "hidden boxes untouched");
  const O = "https://greenwaymarijuana.com";
  ok(absoluteImageUrl("/home/a.webp", O) === "https://greenwaymarijuana.com/home/a.webp", "relative → origin");
  ok(absoluteImageUrl("https://cdn.x.co/a.png", O) === "https://cdn.x.co/a.png", "https kept");
  ok(absoluteImageUrl("http://x.co/a.png", O) === null, "http refused");
  ok(absoluteImageUrl("//evil.co/a.png", O) === null, "protocol-relative refused");
  ok(absoluteImageUrl("javascript:alert(1)", O) === null && absoluteImageUrl("data:image/png;base64,AA", O) === null, "js/data refused");
  ok(absoluteImageUrl("  ", O) === null && absoluteImageUrl(undefined, O) === null, "blank refused");
  ok(absoluteImageUrl("https://u:p@x.co/a.png", O) === null, "credentials refused");
  const pin = promptInputFor(design, legacy, "desktop");
  ok(pin.boxes[0].role === "eyebrow" && pin.boxes[0].chars === 5 && pin.buttons === 1, "prompt input in reading order with real text lengths");
  return { passed, failed: 0 };
}
