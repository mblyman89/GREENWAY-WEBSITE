/**
 * R70 S1 - Merch Studio print-rules engine (PURE, no I/O).
 *
 * Looks at a design on ONE placement of ONE blank with ONE decoration method
 * and returns plain-English issues, the way a veteran printer would:
 *   blocker - the job will fail or be rejected; fix before listing.
 *   warning - it will print, but look worse / cost more / wear worse.
 *   tip     - a pro suggestion.
 *   review  - compliance-themed content a person must acknowledge (never auto-reject;
 *             standing rule: automated output is advisory, a human decides).
 *
 * Every rule cites where its number came from (`source`). Numbers:
 *   Resolution: Printful/Gelato 150 DPI min, 300 DPI ideal; px / 300 = max inches
 *     (R69 s5, French Press Custom).
 *   Letter height: >= 0.25" print + embroidery; beanie lower 0.25" / upper 0.3"
 *     (Printful hat guide, Gelato).
 *   Line weight: embroidery >= 0.05" (Gelato); print >= 1 pt (French Press).
 *   Embroidery detail: nothing under 1/16" (Printful hat guide).
 *   Threads: Printful palette, typically <= 6 colours (Printful hat guide).
 *   Stitches: 1 sq in fill = 1,200; 1 in satin = 150; text 5-6 mm = 100/letter,
 *     7-8 mm = 150, 9-10 mm = 200, >= 12 mm digitised as satin/fill; +/-15% on
 *     textured fabric (JA Digitizing). ~15,000 cap on hats (Printful hat guide).
 *   Hat side text <= 10 characters per line (Gelato, Printful).
 *   Inside label fonts >= 10 pt (Printful tee guide).
 *   Contrast: WCAG 2.x 1.4.11 non-text contrast 3:1 used as the "will it read" bar.
 *   Content themes: WAC 314-55-155(2)(a) (R69 s1.1).
 */
import { type Blank, type Method, type Placement, METHOD_LABEL, contrastRatio, getBlank, getPlacement, isDarkColor, isThreadColor, nearestThread } from "./garment-catalog-core";

export type Level = "blocker" | "warning" | "tip" | "review";
export const LEVEL_ORDER: Record<Level, number> = { blocker: 0, warning: 1, review: 2, tip: 3 };

export interface RuleElement {
  id: string;
  kind: "text" | "image" | "shape";
  name?: string;
  /** Inches inside the placement frame (top-left origin), axis-aligned bbox after rotation. */
  x: number; y: number; w: number; h: number;
  text?: string;
  /** Measured letter (cap) height in inches for text. */
  letterHeightIn?: number;
  /** Font size (em) in inches for text. */
  fontSizeIn?: number;
  /** Thinnest stroke/outline in inches (0/undefined = none). */
  strokeIn?: number;
  /** Smallest feature (e.g. shape min dimension) in inches. */
  minFeatureIn?: number;
  /** Solid colours used by the element (hex). */
  colors: string[];
  hasGradient?: boolean;
  isPhoto?: boolean;
  /** Source pixel size for raster images. */
  pxW?: number; pxH?: number;
  /** Measured/computed ink coverage in square inches (for stitch + DTF weight). */
  inkAreaSqIn?: number;
  /** Outline length in inches (for satin stitch estimate). */
  strokeLengthIn?: number;
  opacity?: number;
}

export interface RuleInput {
  blank: Blank;
  placement: Placement;
  method: Method;
  garmentHex: string;
  elements: RuleElement[];
  puff?: boolean;
}

export interface Issue {
  id: string;
  level: Level;
  title: string;
  why: string;
  fix: string;
  elementId?: string;
  source: string;
}

export const DPI_MIN = 150;
export const DPI_IDEAL = 300;
export const MIN_LETTER_IN = 0.25;
export const BEANIE_UPPER_IN = 0.3;
export const EMB_MIN_LINE_IN = 0.05;
export const PRINT_MIN_LINE_IN = 1 / 72;
export const EMB_MIN_DETAIL_IN = 1 / 16;
export const MAX_THREADS = 6;
export const STITCH_CAP = 15000;
export const LABEL_MIN_FONT_IN = 10 / 72;
export const SIDE_MAX_CHARS = 10;
export const CONTRAST_WARN = 1.5;
export const CONTRAST_TIP = 3;
/** Studio heuristic (not a published number): one solid DTF block bigger than this feels heavy. */
export const DTF_HEAVY_SQIN = 60;

const MM_PER_IN = 25.4;

/** Effective DPI of a raster at its placed size. */
export function effectiveDpi(pxW: number, pxH: number, wIn: number, hIn: number): number {
  if (wIn <= 0 || hIn <= 0) return 0;
  return Math.floor(Math.min(pxW / wIn, pxH / hIn));
}
/** Largest sharp print width for a pixel width at 300 DPI. */
export function maxInchesAt300(px: number): number { return Math.round((px / DPI_IDEAL) * 100) / 100; }

/** JA Digitizing per-letter stitch counts by letter height. Returns null when the letter should be counted as fill. */
export function stitchesPerLetter(letterHeightIn: number): number | null {
  const mm = letterHeightIn * MM_PER_IN;
  if (mm < 7) return 100;
  if (mm < 9) return 150;
  if (mm < 12) return 200;
  return null;
}

export interface StitchEstimate { low: number; mid: number; high: number; complete: boolean }
/** Estimate total stitches for embroidery. `complete=false` when some element lacked the data to count. */
export function estimateStitches(elements: RuleElement[], textured: boolean): StitchEstimate {
  let mid = 0; let complete = true;
  for (const e of elements) {
    if (e.kind === "text" && e.text) {
      const letters = e.text.replace(/\s+/g, "").length;
      const per = e.letterHeightIn ? stitchesPerLetter(e.letterHeightIn) : null;
      if (per !== null) mid += letters * per;
      else if (typeof e.inkAreaSqIn === "number") mid += e.inkAreaSqIn * 1200;
      else complete = false;
    } else if (typeof e.inkAreaSqIn === "number") {
      mid += e.inkAreaSqIn * 1200;
    } else complete = false;
    if (e.strokeIn && e.strokeLengthIn) mid += e.strokeLengthIn * 150;
  }
  mid = Math.round(mid);
  const spread = textured ? 0.15 : 0;
  return { low: Math.round(mid * (1 - spread)), mid, high: Math.round(mid * (1 + spread)), complete };
}

/** Distinct colours across elements, uppercased. */
export function distinctColors(elements: RuleElement[]): string[] {
  const s = new Set<string>();
  for (const e of elements) for (const c of e.colors) s.add(c.trim().toUpperCase());
  return [...s];
}

function overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Compliance theme keywords (WAC 314-55-155(2)(a)). Whole-word, case-insensitive.
export const THEME_KEYWORDS: Record<string, { label: string; words: string[] }> = {
  youth: { label: "may appeal to people under 21", words: ["kid", "kids", "child", "children", "cartoon", "toy", "toys", "candy", "lollipop", "unicorn", "teddy", "school", "teen", "babies", "baby"] },
  overconsumption: { label: "may promote over-consumption", words: ["wasted", "faded", "zooted", "couchlock", "stoned", "obliterated", "smoke more", "get high", "higher than", "too high", "all day every day", "wake and bake"] },
  alcohol: { label: "depicts alcohol or tobacco", words: ["beer", "vodka", "whiskey", "tequila", "wine", "shots", "booze", "drunk", "cigarette", "cigarettes", "cigar", "tobacco", "nicotine"] },
  vehicles: { label: "depicts vehicles / driving", words: ["car", "cars", "truck", "drive", "driving", "driver", "motorcycle", "lowrider"] },
  curative: { label: "makes curative or therapeutic claims", words: ["cure", "cures", "heal", "heals", "healing", "medicine", "medicinal", "therapy", "therapeutic", "treats", "pain relief", "anxiety relief", "remedy"] },
};
export function themeHits(text: string): { theme: string; label: string; word: string }[] {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ")} `;
  const hits: { theme: string; label: string; word: string }[] = [];
  for (const [theme, def] of Object.entries(THEME_KEYWORDS)) {
    for (const w of def.words) if (t.includes(` ${w} `)) { hits.push({ theme, label: def.label, word: w }); break; }
  }
  return hits;
}

const SRC = {
  dpi: "Printful/Gelato file specs (150 DPI min), French Press Custom (300 DPI, px/300)",
  letter: "Printful hat & tee guides, Gelato embroidery guidelines (0.25\")",
  beanie: "Printful hat guide (beanie: 0.25\" lowercase, 0.3\" uppercase)",
  embLine: "Gelato embroidery guidelines (0.05\" min thickness)",
  printLine: "French Press Custom art prep (lines >= 1 pt)",
  detail: "Printful hat guide (nothing under 1/16\")",
  thread: "Printful catalog thread palette + hat guide (<= 6 colours typical)",
  stitch: "JA Digitizing stitch estimates; Printful hat guide (~15k cap)",
  side: "Gelato / Printful (<= 10 characters per line on side areas)",
  label: "Printful tee guide (inside label fonts >= 10 pt)",
  bounds: "Printful print-file guide (art outside the print area is cropped)",
  obstacle: "Printful hoodie & tee guides (avoid seams, zippers, pockets, hood)",
  method: "Printful catalog API (techniques per placement)",
  fabric: "R69 report s3 (DTG best on high-cotton; DTF any fabric)",
  contrast: "WCAG 2.x SC 1.4.11 (3:1 non-text contrast)",
  wac: "WAC 314-55-155(2)(a) themes - acknowledge, a person decides",
  emb: "Printful / Gelato embroidery guidelines (no gradients or photos)",
  heuristic: "Studio heuristic (R70 doc) - not a published limit",
};

export function checkDesign(input: RuleInput): Issue[] {
  const { blank, placement: p, method, garmentHex, elements } = input;
  const out: Issue[] = [];
  const add = (i: Issue) => out.push(i);
  const isEmb = method === "embroidery";
  const name = (e: RuleElement) => e.name || (e.kind === "text" ? `"${(e.text || "").slice(0, 18)}"` : e.kind);

  if (!p.methods.includes(method)) {
    add({ id: "method-unavailable", level: "blocker", title: `${METHOD_LABEL[method]} isn't offered on ${p.label}`, why: `Printful only offers ${p.methods.map((m) => METHOD_LABEL[m]).join(", ")} here for the ${blank.brand} ${blank.model}.`, fix: "Switch the method or pick another placement.", source: SRC.method });
  }
  if (elements.length === 0) {
    add({ id: "empty", level: "tip", title: "Nothing on this placement yet", why: "Empty placements are fine - they simply aren't printed (and cost nothing).", fix: "Add text, art or a shape, or leave it blank.", source: SRC.heuristic });
  }

  // Fabric / method fit
  if (method === "dtg") {
    if (blank.cottonPct !== null && blank.cottonPct < 50) add({ id: "dtg-poly", level: "warning", title: "DTG on a low-cotton fabric", why: "DTG ink bonds to cotton fibres; on polyester-heavy fabric colours look duller and fade sooner.", fix: "Use DTF for this blank.", source: SRC.fabric });
    else if (blank.cottonPct === null) add({ id: "dtg-blend", level: "tip", title: "Blend fabric - consider DTF", why: "Printful does not state this fleece's cotton ratio; DTG is softest on high-cotton, DTF is the most wash-durable on blends.", fix: "Order a sample, or choose DTF for bright colours.", source: SRC.fabric });
    if (isDarkColor(garmentHex)) add({ id: "dtg-dark", level: "tip", title: "Dark garment: white underbase", why: "On dark shirts DTG lays white ink first. It's normal, but very fine detail can look slightly soft and bright colours can fade faster than DTF.", fix: "For crisp, punchy colour on darks, compare with DTF.", source: SRC.fabric });
  }
  if (isEmb) {
    add({ id: "emb-hoop", level: "tip", title: "Embroidery shrinks slightly when hooped", why: "The garment is stretched in the hoop, so stitched art comes out a touch smaller than the file.", fix: "Size text a little above the minimums and order a sample.", source: "Gelato embroidery guidelines" });
    if (input.puff) {
      if (!blank.puffAvailable) add({ id: "puff-na", level: "blocker", title: "3D puff isn't offered on this blank", why: "Printful only offers 3D puff as a hat embroidery option.", fix: "Turn off 3D puff.", source: SRC.method });
      else add({ id: "puff-bold", level: "tip", title: "3D puff needs chunky shapes", why: "Foam under the stitches only rises cleanly on bold letters and solid shapes; thin lines flatten.", fix: "Use a heavy font and avoid hairlines and outlines.", source: "R69 report s3 (3D puff)" });
    } else if (blank.puffAvailable && blank.structured) {
      add({ id: "puff-suggest", level: "tip", title: "Try 3D puff on this structured cap", why: "Structured crowns are the best base for raised puff lettering - a premium look for +$1.50.", fix: "Enable 3D puff for bold logos.", source: "Printful catalog embroidery_type; R69 report s6.2" });
    }
  }

  // Thread palette / colour count
  if (isEmb) {
    const cols = distinctColors(elements);
    if (cols.length > MAX_THREADS) add({ id: "thread-count", level: "warning", title: `${cols.length} thread colours`, why: `Embroidery typically tops out around ${MAX_THREADS} colours; each change slows the machine and adds risk.`, fix: "Merge similar colours.", source: SRC.thread });
    const off = cols.filter((c) => !isThreadColor(c));
    if (off.length) add({ id: "thread-palette", level: "warning", title: `${off.length} colour(s) aren't Printful threads`, why: `Printful stitches only its ${15}-colour palette, so ${off.slice(0, 3).join(", ")} would be swapped for the nearest thread (e.g. ${off[0]} -> ${nearestThread(off[0]).code} ${nearestThread(off[0]).name}).`, fix: "Use the thread swatches, or apply 'Snap to threads'.", source: SRC.thread });
    const textured = blank.category === "beanie" || blank.cottonPct === null || /fleece/i.test(blank.fabric);
    const est = estimateStitches(elements, textured);
    if (est.mid > STITCH_CAP) add({ id: "stitches", level: "warning", title: `~${est.mid.toLocaleString("en-US")} stitches`, why: `Above ~${STITCH_CAP.toLocaleString("en-US")} stitches embroidery gets stiff, heavy and costly${blank.headwear ? ", and Printful caps hats around there" : ""}.`, fix: "Shrink large filled areas, use outlines, or switch to DTF.", source: SRC.stitch });
  }

  for (const e of elements) {
    // Bounds
    const eps = 1e-6;
    if (e.x < -eps || e.y < -eps || e.x + e.w > p.widthIn + eps || e.y + e.h > p.heightIn + eps) {
      const fully = e.x >= p.widthIn || e.y >= p.heightIn || e.x + e.w <= 0 || e.y + e.h <= 0;
      add({ id: `bounds-${e.id}`, level: "blocker", elementId: e.id, title: `${name(e)} ${fully ? "is outside" : "crosses the edge of"} the print area`, why: "Anything outside the print area is cut off by the printer.", fix: "Move or shrink it inside the dashed safe zone.", source: SRC.bounds });
    }
    for (const o of p.obstacles) {
      if (overlap(e, o)) add({ id: `obstacle-${o.kind}-${e.id}`, level: o.severity, elementId: e.id, title: `${name(e)} overlaps the ${o.label.toLowerCase()}`, why: o.severity === "blocker" ? "Ink or thread can't go across this - it will be rejected or ruined." : "It will distort, fold or be hidden when worn.", fix: "Move it clear of the shaded area.", source: SRC.obstacle });
    }

    // Resolution
    if (e.kind === "image" && e.pxW && e.pxH) {
      const dpi = effectiveDpi(e.pxW, e.pxH, e.w, e.h);
      if (dpi < DPI_MIN) add({ id: `dpi-${e.id}`, level: "blocker", elementId: e.id, title: `${name(e)} is ${dpi} DPI at this size`, why: `Below ${DPI_MIN} DPI prints blurry or pixelated. At 300 DPI this file prints sharp up to ${maxInchesAt300(e.pxW)}" wide.`, fix: `Shrink it to <= ${Math.round((e.pxW / DPI_MIN) * 100) / 100}" wide, or upload a larger / vector file. Never upscale.`, source: SRC.dpi });
      else if (dpi < DPI_IDEAL && !isEmb) add({ id: `dpi-${e.id}`, level: "warning", elementId: e.id, title: `${name(e)} is ${dpi} DPI`, why: `Accepted (>= ${DPI_MIN}) but ${DPI_IDEAL} DPI is ideal for crisp edges.`, fix: `Use a larger file, or shrink to ${maxInchesAt300(e.pxW)}" wide.`, source: SRC.dpi });
    }

    // Embroidery art limits
    if (isEmb) {
      if (e.hasGradient || e.isPhoto) add({ id: `emb-gradient-${e.id}`, level: "blocker", elementId: e.id, title: `${name(e)} has ${e.isPhoto ? "photo detail" : "a gradient"}`, why: "Thread is a solid colour - gradients and photos can't be stitched.", fix: "Use flat colours, or switch to DTF (Printful DTFlex).", source: SRC.emb });
      if (typeof e.opacity === "number" && e.opacity < 1) add({ id: `emb-opacity-${e.id}`, level: "warning", elementId: e.id, title: `${name(e)} is semi-transparent`, why: "Thread can't be see-through; it stitches at full colour.", fix: "Set opacity to 100% and pick the thread you want.", source: SRC.emb });
      if (e.strokeIn && e.strokeIn > 0 && e.strokeIn < EMB_MIN_LINE_IN) add({ id: `emb-line-${e.id}`, level: "blocker", elementId: e.id, title: `${name(e)} has ${e.strokeIn.toFixed(3)}" lines`, why: `Embroidery can't sew lines thinner than ${EMB_MIN_LINE_IN}".`, fix: `Thicken to >= ${EMB_MIN_LINE_IN}" or remove the outline.`, source: SRC.embLine });
      if (e.minFeatureIn !== undefined && e.minFeatureIn < EMB_MIN_DETAIL_IN) add({ id: `emb-detail-${e.id}`, level: "blocker", elementId: e.id, title: `${name(e)} has detail under 1/16"`, why: "Features smaller than 1/16\" disappear in thread.", fix: "Enlarge or simplify it.", source: SRC.detail });
    } else {
      if (e.strokeIn && e.strokeIn > 0 && e.strokeIn < PRINT_MIN_LINE_IN) add({ id: `print-line-${e.id}`, level: "warning", elementId: e.id, title: `${name(e)} has hairline strokes`, why: "Lines under 1 pt can break up or vanish after washing.", fix: "Thicken strokes to at least 1 pt (0.014\").", source: SRC.printLine });
      if (method === "dtf" && e.kind === "shape" && (e.inkAreaSqIn ?? 0) > DTF_HEAVY_SQIN) add({ id: `dtf-heavy-${e.id}`, level: "tip", elementId: e.id, title: `${name(e)} is a big solid block`, why: "Large solid DTF areas feel like a plastic patch and don't breathe.", fix: "Knock out the shape (let the shirt show through) or use a halftone/distress.", source: SRC.heuristic });
    }

    // Text
    if (e.kind === "text" && e.text) {
      const lh = e.letterHeightIn ?? 0;
      if (lh > 0) {
        const hasUpper = /[A-Z]/.test(e.text);
        if (blank.category === "beanie" && hasUpper && lh < BEANIE_UPPER_IN) add({ id: `text-beanie-${e.id}`, level: "blocker", elementId: e.id, title: `${name(e)} capitals are ${lh.toFixed(2)}" tall`, why: "Knit beanies stretch; Printful needs 0.3\" capitals (0.25\" lowercase).", fix: "Enlarge the text.", source: SRC.beanie });
        else if (lh < MIN_LETTER_IN) add({ id: `text-small-${e.id}`, level: isEmb ? "blocker" : "warning", elementId: e.id, title: `${name(e)} letters are ${lh.toFixed(2)}" tall`, why: isEmb ? "Embroidered letters under 0.25\" fill in and become unreadable." : "Text under 0.25\" gets hard to read and may break up.", fix: "Enlarge to at least 0.25\" letter height.", source: SRC.letter });
      }
      if (p.id === "label_inside" && e.fontSizeIn && e.fontSizeIn < LABEL_MIN_FONT_IN) add({ id: `label-font-${e.id}`, level: "warning", elementId: e.id, title: `${name(e)} is under 10 pt`, why: "Printful asks for inside-label fonts of at least 10 pt.", fix: "Increase the font size.", source: SRC.label });
      if (blank.headwear && (p.view === "left" || p.view === "right")) {
        const longest = Math.max(...e.text.split(/\n/).map((l) => l.trim().length));
        if (longest > SIDE_MAX_CHARS) add({ id: `side-chars-${e.id}`, level: "warning", elementId: e.id, title: `${longest} characters on a hat side`, why: `Side panels are tiny and curved; keep to ${SIDE_MAX_CHARS} characters per line.`, fix: "Shorten or split onto two lines.", source: SRC.side });
      }
      for (const h of themeHits(e.text)) add({ id: `wac-${h.theme}-${e.id}`, level: "review", elementId: e.id, title: `"${h.word}" ${h.label}`, why: "Greenway-branded apparel acts as advertising; WA rules bar these themes in cannabis ads. Even sold by Greenway Glass & Goods, keep the brand clean.", fix: "Reword, or acknowledge after your own review (lawyer if unsure).", source: SRC.wac });
    }

    // Contrast vs garment
    for (const c of e.colors) {
      const r = contrastRatio(c, garmentHex);
      if (r < CONTRAST_WARN) { add({ id: `contrast-${e.id}`, level: "warning", elementId: e.id, title: `${name(e)} nearly disappears on this colour`, why: `Contrast ${r.toFixed(2)}:1 against the garment.`, fix: "Pick a lighter/darker colour, or add an outline. (Ignore if tone-on-tone is intended.)", source: SRC.contrast }); break; }
      if (r < CONTRAST_TIP) { add({ id: `contrast-${e.id}`, level: "tip", elementId: e.id, title: `${name(e)} is low-contrast`, why: `Contrast ${r.toFixed(2)}:1 (3:1 reads clearly).`, fix: "Fine for subtle tone-on-tone; otherwise increase contrast.", source: SRC.contrast }); break; }
    }
  }

  if (elements.some((e) => e.kind === "image")) add({ id: "imagery-review", level: "tip", title: "Check imagery for compliance themes", why: "The studio can't see inside images. Avoid cartoon/youth-appeal art, alcohol, tobacco, vehicles and over-consumption themes; use leaf imagery carefully.", fix: "Give art a once-over before listing.", source: SRC.wac });

  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

export function summarize(issues: Issue[]): Record<Level, number> {
  const s: Record<Level, number> = { blocker: 0, warning: 0, review: 0, tip: 0 };
  for (const i of issues) s[i.level] += 1;
  return s;
}

// Self-tests ----------------------------------------------------------------------
export function __runPrintRulesTests(): { passed: number; failed: number } {
  let passed = 0, failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error(`FAIL print-rules-core: ${m}`); } };
  const cat = { getBlank, getPlacement };
  const tee = cat.getBlank("cc-1717")!, front = cat.getPlacement(tee, "front")!, lc = cat.getPlacement(tee, "left_chest")!;
  const has = (is: Issue[], idPrefix: string, lvl?: Level) => is.some((i) => i.id.startsWith(idPrefix) && (!lvl || i.level === lvl));

  ok(effectiveDpi(3600, 4800, 12, 16) === 300, "3600px over 12in = 300dpi");
  ok(maxInchesAt300(3000) === 10, "3000px -> 10in");
  ok(stitchesPerLetter(0.24) === 100 && stitchesPerLetter(0.3) === 150 && stitchesPerLetter(0.4) === 200 && stitchesPerLetter(0.6) === null, "per-letter bands");
  const est = estimateStitches([{ id: "a", kind: "shape", x: 0, y: 0, w: 2, h: 2, colors: ["#000000"], inkAreaSqIn: 4 }, { id: "t", kind: "text", text: "GW 420", letterHeightIn: 0.3, x: 0, y: 0, w: 1, h: 0.3, colors: ["#FFFFFF"] }], true);
  ok(est.mid === 4800 + 5 * 150 && est.low === Math.round(est.mid * 0.85) && est.complete, "stitch estimate");
  ok(!estimateStitches([{ id: "i", kind: "image", x: 0, y: 0, w: 1, h: 1, colors: [] }], false).complete, "incomplete without ink area");

  const base = { blank: tee, placement: front, method: "dtg" as Method, garmentHex: "#ffffff" };
  ok(has(checkDesign({ ...base, elements: [] }), "empty", "tip"), "empty tip");
  const lowRes = checkDesign({ ...base, elements: [{ id: "img", kind: "image", x: 0, y: 0, w: 12, h: 12, pxW: 1200, pxH: 1200, colors: [] }] });
  ok(has(lowRes, "dpi-img", "blocker"), "100 dpi blocker");
  ok(has(checkDesign({ ...base, elements: [{ id: "img", kind: "image", x: 0, y: 0, w: 10, h: 10, pxW: 2000, pxH: 2000, colors: [] }] }), "dpi-img", "warning"), "200 dpi warning");
  ok(!has(checkDesign({ ...base, elements: [{ id: "img", kind: "image", x: 0, y: 0, w: 10, h: 10, pxW: 3000, pxH: 3000, colors: [] }] }), "dpi-img"), "300 dpi clean");
  ok(has(checkDesign({ ...base, elements: [{ id: "s", kind: "shape", x: 11, y: 0, w: 2, h: 2, colors: ["#000000"] }] }), "bounds-s", "blocker"), "out of bounds");
  ok(has(checkDesign({ ...base, elements: [{ id: "t", kind: "text", text: "hi", letterHeightIn: 0.2, x: 1, y: 1, w: 1, h: 0.2, colors: ["#000000"] }] }), "text-small-t", "warning"), "small print text warning");
  const embBase = { blank: tee, placement: lc, method: "embroidery" as Method, garmentHex: "#1b1b1c" };
  ok(has(checkDesign({ ...embBase, elements: [{ id: "t", kind: "text", text: "hi", letterHeightIn: 0.2, x: 0, y: 0, w: 1, h: 0.2, colors: ["#FFFFFF"] }] }), "text-small-t", "blocker"), "small emb text blocker");
  ok(has(checkDesign({ ...embBase, elements: [{ id: "g", kind: "shape", hasGradient: true, x: 0, y: 0, w: 1, h: 1, colors: ["#FFFFFF"] }] }), "emb-gradient-g", "blocker"), "gradient emb blocker");
  ok(has(checkDesign({ ...embBase, elements: [{ id: "l", kind: "shape", strokeIn: 0.02, x: 0, y: 0, w: 1, h: 1, colors: ["#FFFFFF"] }] }), "emb-line-l", "blocker"), "thin emb line");
  const sevenCols = ["#FFFFFF", "#000000", "#96A1A8", "#A67843", "#FFCC00", "#E25C27", "#CC3366"];
  const many = checkDesign({ ...embBase, elements: sevenCols.map((c, i) => ({ id: `c${i}`, kind: "shape" as const, x: 0, y: 0, w: 0.5, h: 0.5, colors: [c] })) });
  ok(has(many, "thread-count", "warning") && !has(many, "thread-palette"), "7 palette threads -> count warning only");
  ok(has(checkDesign({ ...embBase, elements: [{ id: "x", kind: "shape", x: 0, y: 0, w: 1, h: 1, colors: ["#123456"] }] }), "thread-palette", "warning"), "off-palette warning");
  ok(has(checkDesign({ ...embBase, elements: [{ id: "big", kind: "shape", x: 0, y: 0, w: 4, h: 4, colors: ["#FFFFFF"], inkAreaSqIn: 16 }] }), "stitches", "warning"), "19,200 stitches warning");
  ok(has(checkDesign({ ...base, method: "embroidery", elements: [] }), "method-unavailable", "blocker"), "emb not on full front");
  const zip = cat.getBlank("l7-14003")!;
  ok(has(checkDesign({ blank: zip, placement: zip.placements[0], method: "dtg", garmentHex: "#1a1a1a", elements: [{ id: "z", kind: "shape", x: 5, y: 2, w: 2, h: 2, colors: ["#FFFFFF"] }] }), "obstacle-zipper-z", "blocker"), "zipper blocker");
  const beanie = cat.getBlank("yp-1501kc")!;
  ok(has(checkDesign({ blank: beanie, placement: beanie.placements[0], method: "embroidery", garmentHex: "#000000", elements: [{ id: "b", kind: "text", text: "GREENWAY", letterHeightIn: 0.27, x: 0.5, y: 0.5, w: 3, h: 0.3, colors: ["#FFFFFF"] }] }), "text-beanie-b", "blocker"), "beanie caps 0.3");
  const snap = cat.getBlank("yp-6089m")!, side = cat.getPlacement(snap, "hat_left")!;
  ok(has(checkDesign({ blank: snap, placement: side, method: "embroidery", garmentHex: "#000000", elements: [{ id: "s", kind: "text", text: "GREENWAYGLASS", letterHeightIn: 0.3, x: 0, y: 0, w: 2, h: 0.3, colors: ["#FFFFFF"] }] }), "side-chars-s", "warning"), "side chars");
  ok(has(checkDesign({ blank: snap, placement: snap.placements[0], method: "embroidery", garmentHex: "#000000", elements: [] }), "puff-suggest", "tip"), "puff suggestion on structured");
  ok(has(checkDesign({ blank: tee, placement: lc, method: "embroidery", garmentHex: "#000000", puff: true, elements: [] }), "puff-na", "blocker"), "no puff on tee");
  ok(has(checkDesign({ ...base, elements: [{ id: "w", kind: "text", text: "Cures everything", letterHeightIn: 1, x: 1, y: 1, w: 5, h: 1, colors: ["#000000"] }] }), "wac-curative-w", "review"), "curative review");
  ok(themeHits("Scarface").length === 0 && themeHits("Drive safe").length === 1, "whole-word themes");
  ok(has(checkDesign({ ...base, elements: [{ id: "c", kind: "shape", x: 1, y: 1, w: 1, h: 1, colors: ["#fafafa"] }] }), "contrast-c", "warning"), "white on white");
  ok(has(checkDesign({ ...base, garmentHex: "#000000", elements: [] }), "dtg-dark", "tip"), "dark dtg tip");
  const sorted = checkDesign({ ...base, elements: [{ id: "img", kind: "image", x: 11, y: 0, w: 12, h: 12, pxW: 100, pxH: 100, colors: [] }] });
  ok(sorted.every((x, i) => i === 0 || LEVEL_ORDER[sorted[i - 1].level] <= LEVEL_ORDER[x.level]), "sorted by severity");
  ok(summarize(sorted).blocker >= 2, "summarize");
  return { passed, failed };
}
