/**
 * R71 S3 - Merch Studio print-file export + proofing (PURE, no I/O, no DOM).
 *
 * Turns a MerchDesign into the exact files a printer needs, the way a pro
 * prepress desk would:
 *
 *  1. ONE PNG PER PRINTFUL FILE TYPE (not per studio placement). Printful's
 *     DTG left chest rides inside the FRONT file (catalog `files[].id`
 *     "default" -> type "front"), so a design with full-front + left-chest
 *     art on DTG is merged into one front file - exactly what Printful prints.
 *  2. Transparent PNG, sRGB, 300 DPI (Printful DTG file guide: PNG with a
 *     transparent background - JPG prints a white box; sRGB IEC61966-2.1;
 *     >= 150 DPI, best not above 300). The PNG gets an `sRGB` chunk and a
 *     `pHYs` chunk (300 DPI) so Photoshop / Printful read the right size.
 *  3. Trimmed to the art (plus a small pad) and placed with Printful's
 *     documented `position` object {area_width, area_height, width, height,
 *     top, left} where the AREA is our print frame at the same DPI.
 *  4. Embroidery: the PNG goes to Printful's digitizers; thread colours ride
 *     on the item `options` using the catalog's real option id
 *     (`thread_colors_<placement>`, verified against PRINTFUL_OPTION_IDS).
 *     When the catalog lists no thread option for that file we send the
 *     documented `auto_thread_color` file option + a `notes` line instead -
 *     never an invented option id.
 *  5. A proof sheet: every placement with real inches, distance from the
 *     collar / brim and centre line, DPI, threads, issues - what you check
 *     against the physical sample.
 *
 * Browser limits: iOS Safari caps a canvas at 16,777,216 pixels. A 12x16"
 * front at 300 DPI is 17.28 MP, so the export DPI steps down just enough to
 * fit (e.g. 294 DPI) and says so - still far above Printful's 150 minimum.
 *
 * Also here (pure + tested): CRC-32, PNG chunk tagging, a STORE-only ZIP
 * writer (PNGs are already compressed) and alpha statistics for the
 * semi-transparency check (Printful "Transparency in DTG printing").
 */
import { colorsFor, getBlank, METHOD_LABEL, nearestThread, THREAD_PALETTE, type Blank, type Method, type Placement } from "./garment-catalog-core";
import { PRINTFUL_FILE_TYPES, PRINTFUL_OPTION_IDS, PRINTFUL_VARIANTS, type VariantRow } from "./garment-colors-data";
import { frameRect, type Rect } from "./garment-views-core";
import { checkSides, elementColors, rotatedBox, usedPlacements, type MElement, type MerchDesign, type Side } from "./merch-design-core";
import { DPI_MIN, type Issue } from "./print-rules-core";

export const EXPORT_DPI = 300;
/** iOS Safari / WebKit canvas area cap (pixels). Chrome/Firefox allow more; we use the strictest. */
export const MAX_CANVAS_PIXELS = 16_777_216;
/** Padding around trimmed art so anti-aliased edges and outlines are never clipped (inches). */
export const TRIM_PAD_IN = 0.05;
/** Above this share of semi-transparent pixels (of all inked pixels) we warn (estimate; edges are always soft). */
export const SEMI_ALPHA_WARN = 0.18;
/** Extra room around TEXT (em): italic / script glyphs overhang their measured advance box. Never clip a letter. */
export const TEXT_BLEED_EM = 0.12;

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ---------------------------------------------------------------------------
// Printful mapping
// ---------------------------------------------------------------------------

/** Printful file TYPE for a placement + method (catalog `files[].id` -> `files[].type`). null = not in the catalog snapshot. */
export function printfulFileType(b: Blank, p: Placement, m: Method): string | null {
  const id = p.printfulKey[m];
  if (!id) return null;
  return PRINTFUL_FILE_TYPES[b.printfulId]?.[id] ?? null;
}

/**
 * Thread-colour option id for an embroidery file type, per Printful's options
 * table ("thread_colors" for embroidery_front, "thread_colors_<rest>" for
 * embroidery_<rest>, "thread_colors_3d" for 3D puff). Only returned when the
 * product's catalog options actually list it.
 */
export function threadOptionId(b: Blank, fileType: string, puff = false): string | null {
  const ids = PRINTFUL_OPTION_IDS[b.printfulId] ?? [];
  let want: string;
  if (puff) want = "thread_colors_3d";
  else if (fileType === "embroidery_front") want = "thread_colors";
  else if (fileType.startsWith("embroidery_")) want = `thread_colors_${fileType.slice("embroidery_".length)}`;
  else return null;
  return ids.includes(want) ? want : null;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Highest DPI <= 300 whose pixel area fits the canvas cap. */
export function exportDpiFor(wIn: number, hIn: number, maxPixels = MAX_CANVAS_PIXELS): number {
  if (!(wIn > 0 && hIn > 0)) return EXPORT_DPI;
  const fit = Math.floor(Math.sqrt(maxPixels / (wIn * hIn)));
  return Math.max(1, Math.min(EXPORT_DPI, fit));
}

/** Art bounds of visible elements in FRAME inches (rotation + outline aware), padded and clamped to the frame. null = nothing visible. */
/** Unclamped ink box (rotation + stroke aware). Used for spill detection. */
export function inkBounds(els: readonly MElement[]): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) {
    if (e.hidden) continue;
    const bb = rotatedBox(e);
    const s = (e.strokeIn > 0 ? (e.kind === "text" ? e.strokeIn : e.strokeIn / 2) : 0) + (e.kind === "text" ? (e.fontSizeIn ?? 0.6) * TEXT_BLEED_EM : 0);
    x0 = Math.min(x0, bb.x - s); y0 = Math.min(y0, bb.y - s);
    x1 = Math.max(x1, bb.x + bb.w + s); y1 = Math.max(y1, bb.y + bb.h + s);
  }
  if (!Number.isFinite(x0)) return null;
  return { x: r4(x0), y: r4(y0), w: r4(x1 - x0), h: r4(y1 - y0) };
}

export function artBounds(els: readonly MElement[], frameW: number, frameH: number, pad = TRIM_PAD_IN): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) {
    if (e.hidden) continue;
    const bb = rotatedBox(e);
    const s = (e.strokeIn > 0 ? (e.kind === "text" ? e.strokeIn : e.strokeIn / 2) : 0) + (e.kind === "text" ? (e.fontSizeIn ?? 0.6) * TEXT_BLEED_EM : 0);
    x0 = Math.min(x0, bb.x - s); y0 = Math.min(y0, bb.y - s);
    x1 = Math.max(x1, bb.x + bb.w + s); y1 = Math.max(y1, bb.y + bb.h + s);
  }
  if (!Number.isFinite(x0)) return null;
  const x = clamp(x0 - pad, 0, frameW); const y = clamp(y0 - pad, 0, frameH);
  const w = clamp(x1 + pad, 0, frameW) - x; const h = clamp(y1 + pad, 0, frameH) - y;
  if (w <= 0 || h <= 0) return null;
  return { x: r4(x), y: r4(y), w: r4(w), h: r4(h) };
}

/** Printful `position` object (integers, pixels at `dpi`). Area = the print frame. */
export interface PrintfulPosition { area_width: number; area_height: number; width: number; height: number; top: number; left: number; limit_to_print_area: true }
export function printfulPosition(area: { w: number; h: number }, art: Rect, dpi: number): PrintfulPosition {
  const px = (n: number) => Math.round(n * dpi);
  const aw = px(area.w); const ah = px(area.h);
  const left = clamp(px(art.x), 0, aw); const top = clamp(px(art.y), 0, ah);
  return { area_width: aw, area_height: ah, width: Math.min(px(art.w), aw - left), height: Math.min(px(art.h), ah - top), top, left, limit_to_print_area: true };
}

// ---------------------------------------------------------------------------
// Export plan
// ---------------------------------------------------------------------------

/** One studio placement's contribution to a print file. */
export interface PlanPart {
  placement: Placement;
  /** Offset of this placement's frame inside the file's area frame (inches). */
  dx: number; dy: number;
  elements: MElement[];
}
export interface PrintFilePlan {
  key: string;               // `${fileType}` - unique per design
  fileType: string;          // Printful files[].type
  printfulFileId: string;    // Printful files[].id (catalog)
  method: Method;
  puff: boolean;
  /** The "owner" placement whose frame is the Printful area. */
  area: Placement;
  areaRect: Rect;            // the owner's frame on the garment view (inches)
  parts: PlanPart[];
  /** Trimmed art box inside the area (inches). */
  art: Rect;
  dpi: number;
  pxW: number; pxH: number;
  position: PrintfulPosition;
  filename: string;
  threads: { hex: string; code: string; name: string }[];
  threadOption: string | null;
  /** Problems found while planning (blockers stop an export from being "print-ready"). */
  issues: Issue[];
}

export function slug(s: string, max = 40): string {
  const out = s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
  return out || "design";
}
export function printFileName(designName: string, fileType: string, method: Method): string {
  return `${slug(designName)}-${slug(fileType, 30)}-${method}.png`;
}

/**
 * Plan every print file for a design. Placements that share a Printful file
 * type (left-chest DTG + full-front DTG -> "front") are merged; the area is the
 * LARGEST frame in the group, and smaller frames are offset into it using
 * their real positions on the garment.
 */
export function planPrintFiles(d: MerchDesign, maxPixels = MAX_CANVAS_PIXELS): { plans: PrintFilePlan[]; issues: Issue[] } {
  const b = getBlank(d.blankId);
  const issues: Issue[] = [];
  if (!b) return { plans: [], issues: [{ id: "export-blank", level: "blocker", title: "Unknown garment", why: "This design points at a garment that is no longer in the catalog.", fix: "Open it in Design and pick a garment.", source: "studio" }] };
  const used = usedPlacements(d, b);
  const groups = new Map<string, { fileType: string; fileId: string; method: Method; puff: boolean; members: { p: Placement; side: Side }[] }>();
  for (const p of used) {
    const side = d.sides[p.id];
    if (!side || !p.methods.includes(side.method)) continue;
    const fileType = printfulFileType(b, p, side.method);
    if (!fileType) {
      issues.push({ id: `export-nofile-${p.id}`, level: "blocker", title: `${p.label}: no Printful file for ${METHOD_LABEL[side.method]}`, why: "The Printful catalog snapshot has no print file for this placement + method, so it cannot be ordered.", fix: "Switch the method, or refresh the catalog (R70 doc section 5).", source: "Printful catalog API files[]" });
      continue;
    }
    const g = groups.get(fileType) ?? { fileType, fileId: p.printfulKey[side.method]!, method: side.method, puff: !!side.puff, members: [] };
    if (g.method !== side.method) {
      issues.push({ id: `export-mixed-${fileType}`, level: "blocker", title: `${p.label} and another side share Printful's "${fileType}" file but use different methods`, why: "One Printful file is printed with one technique.", fix: "Use the same method on both sides.", source: "Printful Orders API (one file per type)" });
      continue;
    }
    g.puff = g.puff || !!side.puff;
    g.members.push({ p, side });
    groups.set(fileType, g);
  }
  const plans: PrintFilePlan[] = [];
  for (const g of groups.values()) {
    const owner = g.members.reduce((a, m) => (m.p.widthIn * m.p.heightIn > a.p.widthIn * a.p.heightIn ? m : a));
    const areaRect = frameRect(b, owner.p);
    const parts: PlanPart[] = g.members.map((m) => {
      const r = frameRect(b, m.p);
      return { placement: m.p, dx: r4(r.x - areaRect.x), dy: r4(r.y - areaRect.y), elements: m.side.elements.filter((e) => !e.hidden) };
    });
    // Union of art across parts, in AREA inches (unpadded first, to detect spill).
    const shifted = parts.flatMap((pt) => pt.elements.map((e) => ({ ...e, x: e.x + pt.dx, y: e.y + pt.dy })));
    const raw = inkBounds(shifted);
    const planIssues: Issue[] = [];
    if (raw && (raw.x < -1e-6 || raw.y < -1e-6 || raw.x + raw.w > owner.p.widthIn + 1e-6 || raw.y + raw.h > owner.p.heightIn + 1e-6)) {
      const spill = Math.max(-raw.x, -raw.y, raw.x + raw.w - owner.p.widthIn, raw.y + raw.h - owner.p.heightIn);
      planIssues.push({
        id: `export-spill-${g.fileType}`, level: "blocker",
        title: `Art spills ${r4(spill)}" outside Printful's ${owner.p.label.toLowerCase()} area`,
        why: g.members.length > 1 ? `${g.members.map((m) => m.p.label).join(" + ")} print as ONE Printful "${g.fileType}" file. Its area is the ${owner.p.label.toLowerCase()} frame (${owner.p.widthIn}x${owner.p.heightIn}"); anything outside it is cropped.` : "Anything outside the print area is cropped by the printer.",
        fix: "Move that art inside the dashed frame (for left chest: lower it a little).", source: "Printful Orders API: position + limit_to_print_area",
      });
    }
    const art = artBounds(shifted, owner.p.widthIn, owner.p.heightIn);
    if (!art) continue;
    const dpi = exportDpiFor(art.w, art.h, maxPixels);
    if (dpi < EXPORT_DPI) planIssues.push({ id: `export-dpi-${g.fileType}`, level: "tip", title: `Exported at ${dpi} DPI (browser canvas limit)`, why: `A ${r4(art.w)}x${r4(art.h)}" file at 300 DPI exceeds the ${MAX_CANVAS_PIXELS.toLocaleString("en-US")}-pixel canvas cap of Safari/iPad.`, fix: `Nothing to do: ${dpi} DPI is well above Printful's ${DPI_MIN} DPI minimum.`, source: "WebKit canvas limit; Printful DTG file guide" });
    const colors = [...new Set(shifted.flatMap((e) => elementColors(e)))];
    const threads = g.method === "embroidery" ? [...new Map(colors.map((c) => { const t = nearestThread(c); return [t.code, { hex: t.hex, code: t.code, name: t.name }] as const; })).values()] : [];
    const threadOption = g.method === "embroidery" ? threadOptionId(b, g.fileType, g.puff) : null;
    if (g.method === "embroidery" && !threadOption) planIssues.push({ id: `export-thread-${g.fileType}`, level: "tip", title: "Threads sent as auto-match + notes", why: `Printful's catalog lists no thread-colour option for "${g.fileType}" on this product.`, fix: "The order uses Printful's documented auto_thread_color and lists your threads in the embroidery notes.", source: "Printful Orders API: Automatic thread color" });
    if (g.method !== "embroidery") {
      const semi = shifted.filter((e) => e.opacity < 100);
      for (const e of semi) planIssues.push({ id: `export-semi-${e.id}`, level: "warning", elementId: e.id, title: `${e.name || e.kind} is ${e.opacity}% opacity`, why: "DTG/DTF inks are concentrated pigment: semi-transparent areas print with gaps and the shirt shows through (worst on dark garments).", fix: "Use 100% opacity and pick a lighter/darker solid colour instead.", source: "Printful: Transparency in DTG printing" });
    }
    const pxW = Math.max(1, Math.round(art.w * dpi)); const pxH = Math.max(1, Math.round(art.h * dpi));
    plans.push({
      key: g.fileType, fileType: g.fileType, printfulFileId: g.fileId, method: g.method, puff: g.puff, area: owner.p, areaRect, parts, art, dpi, pxW, pxH,
      position: printfulPosition({ w: owner.p.widthIn, h: owner.p.heightIn }, art, dpi),
      filename: printFileName(d.name, g.fileType, g.method), threads, threadOption, issues: planIssues,
    });
  }
  plans.sort((a, b2) => b.placements.indexOf(a.area) - b.placements.indexOf(b2.area));
  return { plans, issues };
}

/** The SVG for one print file, in inches (viewBox = trimmed art box). Elements render via MerchElementArt on the client. */
export function planViewBox(p: PrintFilePlan): string {
  return `${p.art.x} ${p.art.y} ${p.art.w} ${p.art.h}`;
}

// ---------------------------------------------------------------------------
// Printful order-item preview (what the merch site sends in Slice 6; shown on the proof sheet + listing package)
// ---------------------------------------------------------------------------
export interface PrintfulItemFile { type: string; url: string; position: PrintfulPosition; options?: { id: string; value: unknown }[] }
export interface PrintfulItemDraft { files: PrintfulItemFile[]; options: { id: string; value: unknown }[] }

/** Build the `files` + `options` of a Printful order item from plans and their hosted URLs. */
export function printfulItemDraft(b: Blank, plans: readonly PrintFilePlan[], urls: Readonly<Record<string, string>>): PrintfulItemDraft {
  const files: PrintfulItemFile[] = [];
  const options: { id: string; value: unknown }[] = [];
  const notes: string[] = [];
  let puff = false;
  for (const p of plans) {
    const f: PrintfulItemFile = { type: p.fileType, url: urls[p.key] ?? "", position: p.position };
    if (p.method === "embroidery") {
      if (p.puff) puff = true;
      if (p.threadOption) options.push({ id: p.threadOption, value: p.threads.map((t) => t.hex) });
      else { f.options = [{ id: "auto_thread_color", value: true }]; notes.push(`${p.area.label}: threads ${p.threads.map((t) => `${t.code} ${t.name}`).join(", ")}`); }
    }
    files.push(f);
  }
  const ids = PRINTFUL_OPTION_IDS[b.printfulId] ?? [];
  if (plans.some((p) => p.method === "embroidery") && ids.includes("embroidery_type")) options.push({ id: "embroidery_type", value: puff ? "3d" : "flat" });
  if (notes.length && ids.includes("notes")) options.push({ id: "notes", value: notes.join(" | ").slice(0, 500) });
  return { files, options };
}

// ---------------------------------------------------------------------------
// Printful variants + mockup-generator request (pure)
// ---------------------------------------------------------------------------
/** Every catalog variant for a blank (colour x size), from the generated snapshot. */
export function variantsFor(b: Blank): readonly VariantRow[] { return PRINTFUL_VARIANTS[b.printfulId] ?? []; }
/** Exact catalog variant for colour + size (null when Printful doesn't make it). */
export function variantFor(b: Blank, color: string, size: string): VariantRow | null {
  return variantsFor(b).find((v) => v[0] === color && v[1] === size) ?? null;
}
const SIZE_PREF = ["M", "L", "S", "XL", "One size", "2XL", "XS", "3XL", "4XL", "5XL"];
/** One representative variant per colour for mockups (prefers an in-stock M, then L, S...). */
export function mockupVariantIds(b: Blank, colors: readonly string[]): number[] {
  const out: number[] = [];
  for (const c of colors) {
    const rows = variantsFor(b).filter((v) => v[0] === c);
    if (!rows.length) continue;
    const rank = (v: VariantRow) => (v[4] ? 0 : 100) + (SIZE_PREF.indexOf(v[1]) < 0 ? 50 : SIZE_PREF.indexOf(v[1]));
    out.push([...rows].sort((a, z) => rank(a) - rank(z))[0][2]);
  }
  return out;
}
/** Printful mockup generator caps output width at 2000 (docs: min 50, max 2000). */
export const MOCKUP_MAX_COLORS = 6;
export interface MockupTaskBody {
  variant_ids: number[]; format: "jpg"; width: number;
  files: { placement: string; image_url: string; position: Omit<PrintfulPosition, "limit_to_print_area"> }[];
  product_options?: Record<string, unknown>;
}
/** Body for POST /mockup-generator/create-task/{product_id} (Printful API v1, CreateGenerationTask). */
export function mockupTaskBody(b: Blank, plans: readonly PrintFilePlan[], urls: Readonly<Record<string, string>>, colors: readonly string[], width = 1000): MockupTaskBody | null {
  const variant_ids = mockupVariantIds(b, colors.slice(0, MOCKUP_MAX_COLORS));
  const files = plans.filter((p) => urls[p.key]).map((p) => {
    const { limit_to_print_area: _drop, ...position } = p.position; void _drop;
    return { placement: p.fileType, image_url: urls[p.key], position };
  });
  if (!variant_ids.length || !files.length) return null;
  const item = printfulItemDraft(b, plans, urls);
  const product_options: Record<string, unknown> = {};
  for (const o of item.options) if (o.id !== "notes") product_options[o.id] = o.value;
  return { variant_ids, format: "jpg", width: Math.max(50, Math.min(2000, Math.round(width))), files, ...(Object.keys(product_options).length ? { product_options } : {}) };
}

// ---------------------------------------------------------------------------
// Proof sheet + sample checklist
// ---------------------------------------------------------------------------
export interface ProofRow {
  fileType: string; method: string; placements: string;
  artIn: string; px: string; dpi: number;
  fromTop: string; fromCenter: string; threads: string;
  blockers: number; warnings: number;
}
/** Human measurements for each file: art size, distance below the collar/brim reference, offset from the centre line. */
export function proofRows(d: MerchDesign): ProofRow[] {
  const b = getBlank(d.blankId);
  if (!b) return [];
  const checks = checkSides(d);
  const { plans } = planPrintFiles(d);
  const f2 = (n: number) => `${Math.round(n * 100) / 100}"`;
  return plans.map((p) => {
    const parts = new Set(p.parts.map((pt) => pt.placement.id));
    const iss = [...checks.filter((c) => parts.has(c.placement.id)).flatMap((c) => c.issues), ...p.issues];
    const headTop = b.headwear;
    const topRef = headTop ? p.area.topIn + (p.area.heightIn - (p.art.y + p.art.h)) : p.area.topIn + p.art.y;
    const centre = p.area.centerXIn + (p.art.x + p.art.w / 2 - p.area.widthIn / 2);
    return {
      fileType: p.fileType, method: METHOD_LABEL[p.method] + (p.puff ? " (3D puff)" : ""), placements: p.parts.map((pt) => pt.placement.label).join(" + "),
      artIn: `${f2(p.art.w)} x ${f2(p.art.h)}`, px: `${p.pxW} x ${p.pxH}`, dpi: p.dpi,
      fromTop: headTop ? `${f2(topRef)} above the ${p.area.view === "back" ? "closure" : "brim/cuff"}` : `${f2(topRef)} below the ${p.area.view === "back" ? "back neck seam" : p.area.view === "inside" ? "inside neck seam" : p.area.view === "front" ? "neckline" : "shoulder seam"}`,
      fromCenter: Math.abs(centre) < 0.05 ? "centred" : `${f2(Math.abs(centre))} ${centre > 0 ? "toward wearer's left" : "toward wearer's right"}`,
      threads: p.threads.map((t) => `${t.code} ${t.name}`).join(", "),
      blockers: iss.filter((i) => i.level === "blocker").length, warnings: iss.filter((i) => i.level === "warning").length,
    };
  });
}

export interface ChecklistItem { id: string; label: string; why: string }
/** What to inspect on the physical sample (Printful: order a sample before selling; 20% sample discount). */
export function sampleChecklist(d: MerchDesign): ChecklistItem[] {
  const b = getBlank(d.blankId);
  const methods = new Set(Object.values(d.sides).filter((s) => s.elements.some((e) => !e.hidden)).map((s) => s.method));
  const out: ChecklistItem[] = [
    { id: "placement", label: "Measure the print position with a ruler against the proof sheet (distance below the collar/brim and from the centre line).", why: "Catches placement drift before customers see it." },
    { id: "size", label: "Measure the printed art width and height; compare to the proof sheet.", why: "Confirms the file printed at true size." },
    { id: "color", label: "Compare colours in daylight against the proof on screen (expect small shifts: Printful converts sRGB to CMYK).", why: "Printful DTG file guide: sRGB->CMYK can shift colour slightly." },
    { id: "fit", label: "Try the garment on (or have staff try sizes S-XL) - note fit, length and neck.", why: "Size-chart questions are the #1 apparel return reason." },
    { id: "label", label: "Check neck label / tag and the packing slip show Greenway Glass & Goods, not the dispensary.", why: "Keeps the merch business visibly separate." },
  ];
  if (methods.has("dtg") || methods.has("dtf")) out.push(
    { id: "wash", label: "Wash inside-out cold, tumble low, then re-inspect for cracking, fading or edges lifting.", why: "Durability is what repeat buyers remember." },
    { id: "hand", label: "Feel the print: DTG should be soft; large DTF areas feel like a film.", why: "Decides whether a design should switch method." },
  );
  if (methods.has("embroidery")) out.push(
    { id: "stitch", label: "Inspect small text and thin lines for gaps, puckering or thread breaks; check the backing on the inside.", why: "Embroidery is digitized by Printful - the sample is the first time you see their digitizing." },
    { id: "threads", label: "Compare thread colours to the thread chart codes on the proof sheet.", why: "Thread colours can't be custom-mixed." },
  );
  if (b && (b.category === "hoodie" || b.category === "zip" || b.category === "crew")) out.push({ id: "ribs", label: "Stretch any print near ribbing, pockets or the zipper and look for gaps.", why: "Printful: ribbed garments are printed unstretched and can show gaps when worn." });
  out.push({ id: "photo", label: "Photograph the sample on a person and flat - use these as the shop photos.", why: "Real photos convert better than mockups." });
  return out;
}

// ---------------------------------------------------------------------------
// Alpha statistics (semi-transparency check after render)
// ---------------------------------------------------------------------------
export interface AlphaStats { clear: number; semi: number; opaque: number; semiShare: number }
/** Count pixels by alpha (RGBA data). semiShare = semi / (semi + opaque). */
export function alphaStats(data: ArrayLike<number>, step = 1): AlphaStats {
  let clear = 0, semi = 0, opaque = 0;
  const s = Math.max(1, Math.floor(step)) * 4;
  for (let i = 3; i < data.length; i += s) {
    const a = data[i];
    if (a === 0) clear += 1; else if (a === 255) opaque += 1; else semi += 1;
  }
  const inked = semi + opaque;
  return { clear, semi, opaque, semiShare: inked ? Math.round((semi / inked) * 1000) / 1000 : 0 };
}

// ---------------------------------------------------------------------------
// CRC-32, PNG tagging (sRGB + pHYs), STORE zip
// ---------------------------------------------------------------------------
let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}
export function crc32(bytes: Uint8Array, seed = 0): number {
  const t = crcTable();
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i += 1) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const ascii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
function u32(n: number): Uint8Array { return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255); }
function chunk(type: string, data: Uint8Array): Uint8Array {
  const td = new Uint8Array(4 + data.length);
  td.set(ascii(type), 0); td.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0); out.set(td, 4); out.set(u32(crc32(td)), 8 + data.length);
  return out;
}
export function isPng(b: Uint8Array): boolean { return b.length > 8 && PNG_SIG.every((v, i) => b[i] === v); }

/** List chunk types in a PNG (for tests / diagnostics). */
export function pngChunks(b: Uint8Array): { type: string; length: number; crcOk: boolean; data: Uint8Array }[] {
  const out: { type: string; length: number; crcOk: boolean; data: Uint8Array }[] = [];
  if (!isPng(b)) return out;
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    if (i + 12 + len > b.length) break;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const td = b.subarray(i + 4, i + 8 + len);
    const crc = ((b[i + 8 + len] << 24) | (b[i + 9 + len] << 16) | (b[i + 10 + len] << 8) | b[i + 11 + len]) >>> 0;
    out.push({ type, length: len, crcOk: crc32(td) === crc, data: b.subarray(i + 8, i + 8 + len) });
    i += 12 + len;
    if (type === "IEND") break;
  }
  return out;
}

/**
 * Re-tag a PNG as sRGB (rendering intent 0 = perceptual) at `dpi`, replacing
 * any existing colour/physical chunks (sRGB, iCCP, gAMA, cHRM, pHYs). Pixel
 * data is untouched. Returns the input unchanged if it is not a PNG.
 */
export function tagPng(b: Uint8Array, dpi = EXPORT_DPI): Uint8Array {
  if (!isPng(b)) return b;
  const drop = new Set(["sRGB", "iCCP", "gAMA", "cHRM", "pHYs"]);
  const parts: Uint8Array[] = [Uint8Array.from(PNG_SIG)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const whole = b.subarray(i, i + 12 + len);
    if (!drop.has(type)) parts.push(whole);
    if (type === "IHDR") {
      const ppm = Math.round(dpi / 0.0254);
      parts.push(chunk("sRGB", Uint8Array.of(0)));
      const phys = new Uint8Array(9); phys.set(u32(ppm), 0); phys.set(u32(ppm), 4); phys[8] = 1;
      parts.push(chunk("pHYs", phys));
    }
    i += 12 + len;
    if (type === "IEND") break;
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/** DPI recorded in a PNG's pHYs chunk (null if absent / not metres). */
export function pngDpi(b: Uint8Array): number | null {
  const p = pngChunks(b).find((c) => c.type === "pHYs");
  if (!p || p.data[8] !== 1) return null;
  const ppm = ((p.data[0] << 24) | (p.data[1] << 16) | (p.data[2] << 8) | p.data[3]) >>> 0;
  return Math.round(ppm * 0.0254);
}

/** Minimal ZIP (STORE, no compression) - PNGs are already deflated. Names are UTF-8. */
export function zipStore(files: readonly { name: string; data: Uint8Array }[], date = new Date(Date.UTC(2026, 0, 1))): Uint8Array {
  const enc = new TextEncoder();
  const dosTime = ((date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2)) & 0xffff;
  const dosDate = (((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()) & 0xffff;
  const le16 = (n: number) => Uint8Array.of(n & 255, (n >>> 8) & 255);
  const le32 = (n: number) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
  const cat = (arr: Uint8Array[]) => { const t = arr.reduce((a, x) => a + x.length, 0); const o = new Uint8Array(t); let k = 0; for (const x of arr) { o.set(x, k); k += x.length; } return o; };
  const locals: Uint8Array[] = []; const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const common = [le16(20), le16(0x0800), le16(0), le16(dosTime), le16(dosDate), le32(crc), le32(f.data.length), le32(f.data.length), le16(name.length)];
    const local = cat([le32(0x04034b50), ...common, le16(0), name, f.data]);
    centrals.push(cat([le32(0x02014b50), le16(20), ...common, le16(0), le16(0), le16(0), le16(0), le32(0), le32(offset), name]));
    locals.push(local);
    offset += local.length;
  }
  const cd = cat(centrals);
  const end = cat([le32(0x06054b50), le16(0), le16(0), le16(files.length), le16(files.length), le32(cd.length), le32(offset), le16(0)]);
  return cat([...locals, cd, end]);
}

/** Read back a STORE zip's entries (tests + sanity). */
export function unzipStoreNames(z: Uint8Array): { name: string; size: number; crcOk: boolean }[] {
  const dec = new TextDecoder();
  const out: { name: string; size: number; crcOk: boolean }[] = [];
  let i = 0;
  const rd32 = (k: number) => (z[k] | (z[k + 1] << 8) | (z[k + 2] << 16) | (z[k + 3] << 24)) >>> 0;
  const rd16 = (k: number) => z[k] | (z[k + 1] << 8);
  while (i + 30 <= z.length && rd32(i) === 0x04034b50) {
    const crc = rd32(i + 14); const size = rd32(i + 18); const nlen = rd16(i + 26); const xlen = rd16(i + 28);
    const name = dec.decode(z.subarray(i + 30, i + 30 + nlen));
    const data = z.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    out.push({ name, size, crcOk: crc32(data) === crc });
    i += 30 + nlen + xlen + size;
  }
  return out;
}

/** README.txt that goes in the export zip. */
export function exportReadme(d: MerchDesign, plans: readonly PrintFilePlan[], snapshotDate: string): string {
  const b = getBlank(d.blankId);
  const L: string[] = [
    `${d.name} - print files`,
    `Garment: ${b ? `${b.brand} ${b.model} ${b.title} (Printful product ${b.printfulId})` : d.blankId}`,
    `Garment colour: ${d.colorHex}`,
    `Catalog snapshot: ${snapshotDate}`,
    "",
    "Every file: transparent PNG, sRGB (tagged), DPI recorded in the file. Printful: PNG + transparent background, sRGB IEC61966-2.1, >= 150 DPI, best <= 300.",
    "",
  ];
  for (const p of plans) {
    L.push(`${p.filename}`);
    L.push(`  Printful file type: ${p.fileType}   method: ${METHOD_LABEL[p.method]}${p.puff ? " (3D puff)" : ""}`);
    L.push(`  Studio placement(s): ${p.parts.map((pt) => pt.placement.label).join(" + ")}`);
    L.push(`  Art: ${r4(p.art.w)} x ${r4(p.art.h)} in = ${p.pxW} x ${p.pxH} px @ ${p.dpi} DPI`);
    L.push(`  Position in the ${p.area.widthIn} x ${p.area.heightIn} in area: left ${r4(p.art.x)} in, top ${r4(p.art.y)} in`);
    L.push(`  Printful position: ${JSON.stringify(p.position)}`);
    if (p.threads.length) L.push(`  Threads: ${p.threads.map((t) => `${t.code} ${t.name} ${t.hex}`).join(", ")}${p.threadOption ? ` (option ${p.threadOption})` : " (auto_thread_color + notes)"}`);
    L.push("");
  }
  L.push(`Thread chart (Printful): ${THREAD_PALETTE.map((t) => `${t.code} ${t.name}`).join(", ")}`);
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// Printable proof sheet (standalone HTML; SVG previews passed in pre-rendered)
// ---------------------------------------------------------------------------
export function escHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
/** Strip anything executable from an SVG string before embedding (defence in depth; our own renderer makes it). */
export function safeSvg(svg: string): string {
  if (!/^\s*<svg[\s>]/i.test(svg)) return "";
  return svg.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "");
}
export function proofSheetHtml(d: MerchDesign, svgs: Readonly<Record<string, string>>, meta: { generatedAt: string; snapshotDate: string; colorName: string; seller: string }): string {
  const b = getBlank(d.blankId);
  const { plans } = planPrintFiles(d);
  const rows = proofRows(d);
  const list = sampleChecklist(d);
  const cards = plans.map((p, i) => {
    const r = rows[i];
    return `<section class="card"><div class="art" style="aspect-ratio:${p.art.w}/${p.art.h}">${safeSvg(svgs[p.key] ?? "")}</div>
<h2>${escHtml(r.placements)} <small>${escHtml(r.method)}</small></h2>
<table><tr><th>Art size</th><td>${escHtml(r.artIn)}</td></tr><tr><th>Pixels</th><td>${escHtml(r.px)} @ ${r.dpi} DPI</td></tr>
<tr><th>Vertical</th><td>${escHtml(r.fromTop)}</td></tr><tr><th>Horizontal</th><td>${escHtml(r.fromCenter)}</td></tr>
<tr><th>Print area</th><td>${p.area.widthIn}" x ${p.area.heightIn}" (Printful "${escHtml(p.fileType)}")</td></tr>
${r.threads ? `<tr><th>Threads</th><td>${escHtml(r.threads)}</td></tr>` : ""}
<tr><th>File</th><td>${escHtml(p.filename)}</td></tr>
<tr><th>Checks</th><td>${r.blockers ? `<b class="bad">${r.blockers} blocker(s)</b>` : "no blockers"}${r.warnings ? `, ${r.warnings} warning(s)` : ""}</td></tr></table></section>`;
  }).join("\n");
  const checks = list.map((c) => `<li><span class="box"></span><div>${escHtml(c.label)}<br><small>${escHtml(c.why)}</small></div></li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escHtml(d.name)} - proof</title>
<style>
*{box-sizing:border-box}body{font:13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:24px;background:#fff}
header{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:16px}
h1{font-size:20px;margin:0}h2{font-size:14px;margin:8px 0 4px}h2 small{font-weight:400;color:#555}
.swatch{display:inline-block;width:12px;height:12px;border:1px solid #999;border-radius:50%;vertical-align:-1px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.card{border:1px solid #ccc;border-radius:6px;padding:10px;break-inside:avoid}
.art{width:100%;max-height:260px;display:flex;align-items:center;justify-content:center;border-radius:4px;background:${escHtml(d.colorHex)};padding:8px}
.art svg{max-width:100%;max-height:244px;width:100%;height:100%}
table{border-collapse:collapse;width:100%}th{text-align:left;color:#555;font-weight:600;padding:2px 6px 2px 0;white-space:nowrap;vertical-align:top}td{padding:2px 0}
.bad{color:#b91c1c}ul{list-style:none;padding:0}li{display:flex;gap:8px;margin:6px 0}.box{flex:none;width:14px;height:14px;border:1.5px solid #111;margin-top:2px}
small{color:#555}footer{margin-top:18px;border-top:1px solid #ccc;padding-top:6px;color:#555;font-size:11px}
@media print{body{margin:0}@page{size:letter;margin:0.5in}.noprint{display:none}}
</style></head><body>
<header><div><h1>${escHtml(d.name)}</h1><div>${b ? escHtml(`${b.brand} ${b.model} - ${b.title}`) : escHtml(d.blankId)} &middot; <span class="swatch" style="background:${escHtml(d.colorHex)}"></span> ${escHtml(meta.colorName)}</div></div>
<div style="text-align:right"><b>PROOF</b><br>${escHtml(meta.generatedAt)}<br><small>Catalog ${escHtml(meta.snapshotDate)}</small></div></header>
<p class="noprint"><button onclick="print()">Print this proof</button></p>
<div class="grid">${cards || "<p>No artwork on this design yet.</p>"}</div>
<h2 style="margin-top:20px">Sample inspection checklist</h2><ul>${checks}</ul>
<p>Approved for sale by: ______________________ &nbsp; Date: ____________</p>
<footer>Sold by ${escHtml(meta.seller)}. Measurements are from Printful's print-area reference (collar seam / back neck seam / brim). Colours on screen are sRGB; garments are printed in CMYK and may shift slightly.</footer>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runPrintExportTests(): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error("FAIL print-export-core:", m); } };
  const tee = getBlank("cc-1717")!;
  const hat = getBlank("yp-6089m")!;
  const dad = getBlank("yp-6245cm")!;
  const beanie = getBlank("yp-1501kc")!;
  const P = (b: Blank, id: string) => b.placements.find((p) => p.id === id)!;
  const el = (over: Partial<MElement>): MElement => ({ id: "e1", kind: "shape", shape: "rect", x: 1, y: 1, w: 2, h: 2, rotate: 0, opacity: 100, fill: "#FFFFFF", strokeIn: 0, strokeColor: "#000000", ...over });
  const design = (b: Blank, sides: MerchDesign["sides"], name = "Test Design"): MerchDesign => ({ v: 1, id: "ds-t", name, blankId: b.id, colorHex: "#1b1b1c", sides, ack: [], updatedAt: "2026-10-17T00:00:00.000Z" });

  // Printful mapping (verified against the generated catalog)
  ok(printfulFileType(tee, P(tee, "front"), "dtg") === "front", "tee front dtg -> front");
  ok(printfulFileType(tee, P(tee, "left_chest"), "dtg") === "front", "left chest dtg shares front file");
  ok(printfulFileType(tee, P(tee, "left_chest"), "embroidery") === "embroidery_chest_left", "left chest emb");
  ok(printfulFileType(tee, P(tee, "back"), "dtf") === "back_dtf", "back dtf");
  ok(printfulFileType(hat, P(hat, "hat_front"), "embroidery") === "embroidery_front", "hat front -> embroidery_front");
  ok(printfulFileType(hat, P(hat, "hat_left"), "embroidery") === "embroidery_left", "hat left");
  ok(printfulFileType(tee, P(tee, "front"), "embroidery") === null, "no emb on full front");
  ok(threadOptionId(tee, "embroidery_chest_left") === "thread_colors_chest_left", "tee chest thread option");
  ok(threadOptionId(hat, "embroidery_back") === "thread_colors_back", "hat back thread option");
  ok(threadOptionId(hat, "embroidery_front") === null, "6089M lists no thread_colors (front) -> null, never invented");
  ok(threadOptionId(beanie, "embroidery_front") === "thread_colors", "beanie front thread_colors listed");
  ok(threadOptionId(hat, "embroidery_front", true) === "thread_colors_3d", "puff -> thread_colors_3d");
  ok(threadOptionId(tee, "front") === null, "non-embroidery -> null");

  // DPI cap
  ok(exportDpiFor(4, 4) === 300, "small file 300 DPI");
  ok(exportDpiFor(12, 16) === 295, "12x16 steps to 295 under 16.7MP");
  ok(12 * 295 * 16 * 295 <= MAX_CANVAS_PIXELS && 12 * 296 * 16 * 296 > MAX_CANVAS_PIXELS, "295 is the max that fits");
  ok(exportDpiFor(12, 16, 1e9) === 300, "big cap keeps 300");
  ok(exportDpiFor(0, 5) === 300, "degenerate -> 300");

  // Bounds
  const b1 = artBounds([el({})], 12, 16)!;
  ok(b1.x === 0.95 && b1.y === 0.95 && b1.w === 2.1 && b1.h === 2.1, "pad 0.05");
  ok(artBounds([el({ hidden: true })], 12, 16) === null, "hidden ignored");
  ok(artBounds([], 12, 16) === null, "empty null");
  const b2 = artBounds([el({ x: 0, y: 0 })], 12, 16)!;
  ok(b2.x === 0 && b2.y === 0 && b2.w === 2.05, "clamped at frame");
  const b3 = artBounds([el({ rotate: 45 })], 12, 16, 0)!;
  ok(Math.abs(b3.w - 2.8284) < 1e-3, "rotation grows bounds");
  const b4 = artBounds([el({ strokeIn: 0.2 })], 12, 16, 0)!;
  ok(Math.abs(b4.x - 0.9) < 1e-9 && Math.abs(b4.w - 2.2) < 1e-9, "shape outline half-width");
  const b5 = artBounds([el({ kind: "text", strokeIn: 0.1, text: "A", fontSizeIn: 0.5 })], 12, 16, 0)!;
  ok(Math.abs(b5.x - (1 - 0.1 - 0.5 * TEXT_BLEED_EM)) < 1e-9, "text: full stroke (doubled) + glyph overhang bleed");

  // Position
  const pos = printfulPosition({ w: 12, h: 16 }, { x: 1, y: 2, w: 4, h: 3 }, 300);
  ok(pos.area_width === 3600 && pos.area_height === 4800 && pos.width === 1200 && pos.height === 900 && pos.left === 300 && pos.top === 600 && pos.limit_to_print_area, "position px");
  const pos2 = printfulPosition({ w: 4, h: 4 }, { x: 3, y: 3, w: 2, h: 2 }, 100);
  ok(pos2.width === 100 && pos2.height === 100, "position clipped to area");

  // Names
  ok(slug("Greenway Logo Tee — Black!") === "greenway-logo-tee-black", "slug");
  ok(slug("   ") === "design", "slug fallback");
  ok(slug("Café Crème") === "cafe-creme", "slug accents");
  ok(printFileName("Logo Tee", "embroidery_chest_left", "embroidery") === "logo-tee-embroidery-chest-left-embroidery.png", "filename");

  // Plans: front + left chest DTG merge into one front file
  const d1 = design(tee, {
    front: { method: "dtg", elements: [el({ id: "f1", x: 2, y: 2, w: 8, h: 6 })] },
    left_chest: { method: "dtg", elements: [el({ id: "l1", x: 0.5, y: 1, w: 3, h: 2.5 })] },
    back: { method: "dtg", elements: [el({ id: "b1", x: 1, y: 1, w: 10, h: 10 })] },
  });
  const p1 = planPrintFiles(d1);
  ok(p1.issues.length === 0, "no plan-level issues");
  ok(p1.plans.length === 2, "front+lc merged -> 2 files");
  const pf = p1.plans.find((p) => p.fileType === "front")!;
  ok(!!pf && pf.parts.length === 2 && pf.area.id === "front", "front owns the area");
  const lcPart = pf.parts.find((pt) => pt.placement.id === "left_chest")!;
  const fr = frameRect(tee, P(tee, "front")); const lr = frameRect(tee, P(tee, "left_chest"));
  ok(lcPart.dx === r4(lr.x - fr.x) && lcPart.dy === r4(lr.y - fr.y), "left chest offset = real garment offset");
  ok(pf.printfulFileId === "default", "front file id default");
  ok(pf.filename === "test-design-front-dtg.png", "front filename");
  ok(p1.plans[0].fileType === "front" && p1.plans[1].fileType === "back", "sorted by catalog order");
  const pb = p1.plans.find((p) => p.fileType === "back")!;
  ok(pb.dpi === 300 && pb.pxW === Math.round(pb.art.w * 300), "back px at 300");
  ok(pb.position.area_width === 3600, "back area 12in @300");

  // Spill detection: left-chest art at the very top of its frame sits above the front area (lc top 3" vs front 3.5")
  const d2 = design(tee, { front: { method: "dtg", elements: [el({ id: "f1", x: 2, y: 2, w: 2, h: 2 })] }, left_chest: { method: "dtg", elements: [el({ id: "l1", x: 0.5, y: 0, w: 2, h: 2 })] } });
  const p2 = planPrintFiles(d2).plans[0];
  ok(p2.issues.some((i) => i.id === "export-spill-front" && i.level === "blocker"), "spill above the front area is a blocker");
  const d2b = design(tee, { left_chest: { method: "dtg", elements: [el({ id: "l1", x: 0.5, y: 0, w: 2, h: 2 })] } });
  const p2b = planPrintFiles(d2b).plans[0];
  ok(inkBounds([el({ id: "n", x: -1, y: -2, w: 2, h: 2 })])!.y === -2, "inkBounds is unclamped");
  ok(p2b.area.id === "left_chest" && !p2b.issues.some((i) => i.id.startsWith("export-spill")), "left chest alone owns its own area");

  // Mixed methods on a shared file
  const d3 = design(tee, { front: { method: "dtg", elements: [el({ id: "f1" })] }, left_chest: { method: "dtf", elements: [el({ id: "l1" })] } });
  const p3 = planPrintFiles(d3);
  ok(p3.plans.length === 2, "dtg front + dtf left chest are different files (front vs front_dtf)");
  ok(p3.plans.some((p) => p.fileType === "front_dtf"), "front_dtf present");

  // Embroidery + threads
  const d4 = design(tee, { left_chest: { method: "embroidery", elements: [el({ id: "l1", fill: "#FFFFFF" }), el({ id: "l2", x: 0.2, y: 0.2, w: 1, h: 1, fill: "#000000" })] } });
  const p4 = planPrintFiles(d4).plans[0];
  ok(p4.fileType === "embroidery_chest_left" && p4.threadOption === "thread_colors_chest_left", "emb chest plan");
  ok(p4.threads.length === 2 && p4.threads.some((t) => t.code === "1801") && p4.threads.some((t) => t.code === "1800"), "threads mapped");
  const draft4 = printfulItemDraft(tee, [p4], { [p4.key]: "https://x/y.png" });
  ok(draft4.files[0].type === "embroidery_chest_left" && draft4.files[0].url === "https://x/y.png", "draft file");
  ok(draft4.options.some((o) => o.id === "thread_colors_chest_left" && Array.isArray(o.value) && (o.value as string[]).length === 2), "draft thread option");
  ok(!draft4.options.some((o) => o.id === "embroidery_type"), "no embroidery_type on tees (not in catalog options)");

  const d5 = design(hat, { hat_front: { method: "embroidery", puff: false, elements: [el({ id: "h1", w: 2, h: 1, fill: "#FFCC00" })] } });
  const p5 = planPrintFiles(d5).plans[0];
  ok(p5.threadOption === null && p5.issues.some((i) => i.id === "export-thread-embroidery_front"), "6089M front -> auto thread tip");
  const draft5 = printfulItemDraft(hat, [p5], {});
  ok(draft5.files[0].options?.[0].id === "auto_thread_color", "auto_thread_color file option");
  ok(draft5.options.some((o) => o.id === "embroidery_type" && o.value === "flat"), "embroidery_type flat");
  ok(draft5.options.some((o) => o.id === "notes" && String(o.value).includes("1951 Gold")), "threads in notes");
  const d5p = design(hat, { hat_front: { method: "embroidery", puff: true, elements: [el({ id: "h1", w: 2, h: 1 })] } });
  const p5p = planPrintFiles(d5p).plans[0];
  ok(p5p.puff && p5p.threadOption === "thread_colors_3d", "puff thread option");
  ok(printfulItemDraft(hat, [p5p], {}).options.some((o) => o.id === "embroidery_type" && o.value === "3d"), "embroidery_type 3d");
  const d6 = design(dad, { hat_back: { method: "embroidery", elements: [el({ id: "h2", w: 1, h: 0.5 })] } });
  ok(planPrintFiles(d6).plans[0].threadOption === "thread_colors_back", "dad back thread option");

  // Semi-transparency warning on print, not on embroidery
  const d7 = design(tee, { front: { method: "dtg", elements: [el({ id: "s1", opacity: 60 })] } });
  ok(planPrintFiles(d7).plans[0].issues.some((i) => i.id === "export-semi-s1" && i.level === "warning"), "semi opacity warning dtg");
  const d7e = design(tee, { left_chest: { method: "embroidery", elements: [el({ id: "s1", opacity: 60 })] } });
  ok(!planPrintFiles(d7e).plans[0].issues.some((i) => i.id.startsWith("export-semi")), "no export semi warning for emb (rules engine covers it)");

  // Big file steps DPI
  const d8 = design(tee, { front: { method: "dtg", elements: [el({ id: "big", x: 0, y: 0, w: 12, h: 16 })] } });
  const p8 = planPrintFiles(d8).plans[0];
  ok(p8.dpi < 300 && p8.pxW * p8.pxH <= MAX_CANVAS_PIXELS && p8.issues.some((i) => i.id === "export-dpi-front"), "big file DPI stepped + tip");
  ok(p8.position.area_width === Math.round(12 * p8.dpi), "area at export DPI");

  // Unknown blank / empty
  ok(planPrintFiles({ ...d1, blankId: "nope" }).issues[0].id === "export-blank", "unknown blank blocker");
  ok(planPrintFiles(design(tee, {})).plans.length === 0, "empty design no plans");
  ok(planViewBox(pb) === `${pb.art.x} ${pb.art.y} ${pb.art.w} ${pb.art.h}`, "viewBox");

  // Proof rows
  const rows = proofRows(d1);
  ok(rows.length === 2 && rows[0].fileType === "front" && rows[0].placements === "Full front + Left chest", "proof rows merge labels");
  ok(rows[0].fromTop.includes("below the neckline") && rows[1].fromTop.includes("back neck seam"), "proof reference lines");
  const rowsHat = proofRows(d5);
  ok(rowsHat[0].fromTop.includes("above the brim"), "hat measured above brim");
  ok(proofRows(d4)[0].threads.includes("1801 White"), "proof threads");
  const cent = proofRows(design(tee, { front: { method: "dtg", elements: [el({ id: "c", x: 4, y: 1, w: 4, h: 2 })] } }))[0];
  ok(cent.fromCenter === "centred", "centred art");

  // Checklist
  const cl = sampleChecklist(d1);
  ok(cl.some((c) => c.id === "wash") && !cl.some((c) => c.id === "stitch"), "dtg checklist");
  ok(sampleChecklist(d4).some((c) => c.id === "stitch"), "emb checklist");
  ok(sampleChecklist(design(getBlank("ind-4000")!, { front: { method: "dtg", elements: [el({})] } })).some((c) => c.id === "ribs"), "hoodie ribs");

  // Alpha
  const a = alphaStats(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 255));
  ok(a.clear === 1 && a.opaque === 2 && a.semi === 1 && a.semiShare === 0.333, "alpha stats");
  ok(alphaStats(new Uint8Array(0)).semiShare === 0, "alpha empty");

  // CRC + PNG
  ok(crc32(ascii("123456789")) === 0xcbf43926, "crc32 check value");
  ok(crc32(new Uint8Array(0)) === 0, "crc32 empty");
  const ihdr = new Uint8Array(13); ihdr.set(u32(1), 0); ihdr.set(u32(1), 4); ihdr[8] = 8; ihdr[9] = 6;
  const fake = Uint8Array.from([...PNG_SIG, ...chunk("IHDR", ihdr), ...chunk("gAMA", u32(45455)), ...chunk("pHYs", Uint8Array.of(0, 0, 11, 19, 0, 0, 11, 19, 1)), ...chunk("IDAT", Uint8Array.of(1, 2, 3)), ...chunk("IEND", new Uint8Array(0))]);
  ok(isPng(fake) && pngChunks(fake).every((c) => c.crcOk), "fake png valid");
  ok(pngDpi(fake) === 72, "fake png 72 dpi");
  const tagged = tagPng(fake, 300);
  const types = pngChunks(tagged).map((c) => c.type);
  ok(types.join(",") === "IHDR,sRGB,pHYs,IDAT,IEND", "tagged chunk order (gAMA/pHYs replaced)");
  ok(pngChunks(tagged).every((c) => c.crcOk), "tagged CRCs valid");
  ok(pngDpi(tagged) === 300, "tagged 300 dpi");
  ok(pngChunks(tagged).find((c) => c.type === "sRGB")!.data[0] === 0, "sRGB perceptual");
  ok(pngChunks(tagged).find((c) => c.type === "IDAT")!.data.join() === "1,2,3", "pixels untouched");
  ok(tagPng(ascii("nope"))[0] === 110, "non-png passthrough");
  ok(pngDpi(tagPng(fake, 150)) === 150, "150 dpi tag");

  // Zip
  const z = zipStore([{ name: "a.txt", data: ascii("hello") }, { name: "dir/b.png", data: fake }]);
  const names = unzipStoreNames(z);
  ok(names.length === 2 && names[0].name === "a.txt" && names[0].size === 5 && names[1].name === "dir/b.png" && names.every((n) => n.crcOk), "zip round trip");
  ok(z[z.length - 22] === 0x50 && z[z.length - 21] === 0x4b && z[z.length - 20] === 5 && z[z.length - 19] === 6, "zip EOCD");
  ok(unzipStoreNames(zipStore([])).length === 0, "empty zip");

  // Variants + mockups
  const tv = variantsFor(tee);
  ok(tv.length > 50 && tv.every((v) => v[2] > 0), "tee has catalog variants");
  const black = colorsFor(tee).find((c) => c[0] === "Black")?.[0] ?? colorsFor(tee)[0][0];
  const vm = variantFor(tee, black, "M");
  ok(!!vm && vm[1] === "M", "variantFor exact colour+size");
  ok(variantFor(tee, black, "9XL") === null, "unknown size -> null");
  const mids = mockupVariantIds(tee, [black, "Not a colour"]);
  ok(mids.length === 1 && mids[0] === vm![2], "mockup variant = M for the colour, unknown colour skipped");
  const mb = mockupTaskBody(tee, p1.plans, { front: "https://x/f.png", back: "https://x/b.png" }, [black]);
  ok(!!mb && mb.files.length === 2 && mb.files[0].placement === "front" && !("limit_to_print_area" in mb.files[0].position), "mockup body files + position");
  ok(!!mb && mb.width === 1000 && mb.format === "jpg" && !mb.product_options, "mockup defaults, no options for DTG");
  ok(mockupTaskBody(tee, p1.plans, {}, [black]) === null, "no hosted files -> no task");
  ok(mockupTaskBody(tee, p1.plans, { front: "u" }, [black], 5000)!.width === 2000, "width capped at 2000");

  // Proof sheet
  const html = proofSheetHtml(d1, { front: "<svg viewBox='0 0 1 1'><script>x</script><rect onclick=\"evil()\"/></svg>", back: "not svg" }, { generatedAt: "2026-10-17", snapshotDate: "2026-10-17", colorName: "Black", seller: "Greenway Merchandising LLC (dba Greenway Glass & Goods)" });
  ok(html.startsWith("<!doctype html>") && html.includes("Test Design") && html.includes("test-design-front-dtg.png"), "proof html basics");
  ok(!html.includes("<script>") && !html.includes("evil()"), "proof html strips script + handlers");
  ok(html.includes("Glass &amp; Goods") && html.includes("Sample inspection checklist"), "proof html seller + checklist");
  ok(escHtml("<a href=\"x\">&'") === "&lt;a href=&quot;x&quot;&gt;&amp;&#39;", "escHtml");
  ok(safeSvg("<div>") === "", "safeSvg rejects non-svg");

  // README
  const rd = exportReadme(d1, p1.plans, "2026-10-17");
  ok(rd.includes("test-design-front-dtg.png") && rd.includes("Printful file type: front") && rd.includes("Full front + Left chest"), "readme");

  return { passed, failed };
}
