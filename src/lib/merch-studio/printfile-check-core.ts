/**
 * D232 M-8 (G-92) - compare the studio's placement sizes with Printful's own
 * print files (PURE).
 *
 * SOP-11 F-11-14: 8 placements in garment-catalog-core.ts are marked
 * `dimsSource: "studio-default"` (an estimate, not from a Printful guide).
 * Michael approved ordering samples to measure them (SOP-11 Q-11-6, verbatim
 * "Q6: yes."). Until a sample is measured, the studio must NOT call them
 * confirmed. This module:
 *
 *  - lists the studio-default placements with their sample status, and
 *  - reads Printful API v1 `GET /mockup-generator/printfiles/{product_id}`
 *    (developers.printful.com/docs, "Mockup Generator API"): result
 *    { product_id, available_placements: { front: "Front print", ... },
 *      printfiles: [{ printfile_id, width, height, dpi, fill_mode, can_rotate }],
 *      variant_printfiles: [{ variant_id, placements: { front: 1 } }] }
 *    and turns Printful's print-file pixels into inches (px / dpi), so the
 *    Garments tab shows Printful's file size next to the studio's size.
 *
 * Printful's print file is the AREA it can print; the studio's box may be
 * smaller on purpose (e.g. kept above a pouch). So a smaller studio box is a
 * note, a bigger one is a warning (art could be cut off).
 */
import { BLANKS, getBlank, printfileFor, type Blank, type Method, type Placement } from "./garment-catalog-core";
import { PRINTFUL_FILE_TYPES } from "./garment-colors-data";

/** What we know about each studio-default placement today. */
export const STUDIO_DEFAULT_STATUS = "Awaiting sample measurement (D232 Q-11-6: samples approved, not measured yet)";

export interface StudioDefaultRow { blankId: string; printfulId: number; title: string; placementId: string; label: string; widthIn: number; heightIn: number; keys: string[] }

/** Every studio-default placement in the catalog (SOP-11 F-11-14 / G-92). */
export function studioDefaultPlacements(blanks: readonly Blank[] = BLANKS): StudioDefaultRow[] {
  const out: StudioDefaultRow[] = [];
  for (const b of blanks) {
    for (const p of b.placements) {
      if (p.dimsSource !== "studio-default") continue;
      out.push({ blankId: b.id, printfulId: b.printfulId, title: `${b.brand} ${b.model}`, placementId: p.id, label: p.label, widthIn: p.widthIn, heightIn: p.heightIn, keys: [...new Set(Object.values(p.printfulKey).filter((k): k is string => typeof k === "string"))] });
    }
  }
  return out;
}

export interface PrintfileSize { key: string; label: string; widthIn: number; heightIn: number; dpi: number; widthPx: number; heightPx: number }

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Printful's print-file size per placement key for one product. Uses the
 * first variant that lists the key (sizes are per print file; most products
 * share one per placement). Unreadable rows are skipped.
 */
export function printfileSizes(result: unknown): Record<string, PrintfileSize> {
  const out: Record<string, PrintfileSize> = {};
  if (!result || typeof result !== "object") return out;
  const r = result as { available_placements?: unknown; printfiles?: unknown; variant_printfiles?: unknown };
  const labels = r.available_placements && typeof r.available_placements === "object" ? (r.available_placements as Record<string, unknown>) : {};
  const files = new Map<number, { w: number; h: number; dpi: number }>();
  for (const f of Array.isArray(r.printfiles) ? r.printfiles : []) {
    const o = (f ?? {}) as { printfile_id?: unknown; width?: unknown; height?: unknown; dpi?: unknown };
    const id = num(o.printfile_id), w = num(o.width), h = num(o.height), dpi = num(o.dpi);
    if (id && w && h && dpi) files.set(id, { w, h, dpi });
  }
  for (const v of Array.isArray(r.variant_printfiles) ? r.variant_printfiles : []) {
    const pl = (v as { placements?: unknown })?.placements;
    if (!pl || typeof pl !== "object") continue;
    for (const [key, fid] of Object.entries(pl as Record<string, unknown>)) {
      if (out[key]) continue;
      const f = typeof fid === "number" ? files.get(fid) : undefined;
      if (!f) continue;
      out[key] = { key, label: typeof labels[key] === "string" ? (labels[key] as string) : key, widthIn: round2(f.w / f.dpi), heightIn: round2(f.h / f.dpi), dpi: f.dpi, widthPx: f.w, heightPx: f.h };
    }
  }
  return out;
}

export type PlacementVerdict = "fits" | "bigger" | "ratio" | "no-file";
export interface PlacementCompare { placementId: string; label: string; studio: { widthIn: number; heightIn: number }; printful: PrintfileSize | null; verdict: PlacementVerdict; text: string }

/** Printful rejects an order when the area ratio is > 2% off its print file (D275 rejection text). */
export const RATIO_TOLERANCE = 0.02;

/**
 * Compare one studio placement with Printful's print file for any of its keys.
 * D275: also checks the ASPECT RATIO of the area the studio sends (the
 * placement's `printfileIn` for the method, else the frame) - a mismatch over
 * 2% is exactly what made Printful reject order gm-mwv5yt0q.
 */
export function comparePlacement(p: Placement, sizes: Record<string, PrintfileSize>, printfulId?: number): PlacementCompare {
  const keys = [...new Set(Object.values(p.printfulKey).filter((k): k is string => typeof k === "string"))];
  const types = printfulId ? PRINTFUL_FILE_TYPES[printfulId] ?? {} : {};
  // Printful v1 calls the standard front "front"; our DTG key is "default". The technique-specific response uses file TYPES (embroidery_front...).
  const hit = (k: string) => sizes[k] ?? (types[k] ? sizes[types[k]] : undefined) ?? (k === "default" ? sizes.front : undefined);
  const key = keys.find((k) => hit(k));
  const pf = key ? hit(key)! : null;
  const studio = { widthIn: p.widthIn, heightIn: p.heightIn };
  if (!pf) return { placementId: p.id, label: p.label, studio, printful: null, verdict: "no-file", text: `Printful did not list a print file for ${keys.join(" / ") || "this placement"}. Check Printful's template for this product.` };
  const method = (Object.keys(p.printfulKey) as Method[]).find((m) => p.printfulKey[m] === key) ?? p.methods[0];
  const area = printfileFor(p, method);
  const off = Math.abs(area.w / area.h - pf.widthPx / pf.heightPx) / (pf.widthPx / pf.heightPx);
  const tail = `(${pf.widthPx} x ${pf.heightPx} px at ${pf.dpi} DPI)`;
  if (off > RATIO_TOLERANCE) {
    return { placementId: p.id, label: p.label, studio, printful: pf, verdict: "ratio",
      text: `ORDERS WILL BE REJECTED: the studio sends a ${area.w}" x ${area.h}" area (ratio ${(area.w / area.h).toFixed(2)}) but Printful's print file is ${pf.widthIn}" x ${pf.heightIn}" ${tail}, ratio ${(pf.widthPx / pf.heightPx).toFixed(2)} - ${Math.round(off * 1000) / 10}% off; Printful allows 2%. Tell the developer to set this placement's print file to ${pf.widthIn}" x ${pf.heightIn}".` };
  }
  const bigger = p.widthIn > pf.widthIn + 0.05 || p.heightIn > pf.heightIn + 0.05;
  return {
    placementId: p.id, label: p.label, studio, printful: pf,
    verdict: bigger ? "bigger" : "fits",
    text: bigger
      ? `Studio box ${p.widthIn}" x ${p.heightIn}" is BIGGER than Printful's print file ${pf.widthIn}" x ${pf.heightIn}" ${tail}: art near the edge could be cut off. Shrink the art, and measure the sample.`
      : `Studio box ${p.widthIn}" x ${p.heightIn}" fits inside Printful's print file ${pf.widthIn}" x ${pf.heightIn}" ${tail}, ratio matches.${p.dimsSource === "studio-default" ? " Still measure the sample before calling it confirmed." : ""}`,
  };
}

/** Compare placements of one blank (D275: ALL placements by default; `studioDefaultOnly` keeps the old G-92 list). */
export function compareBlank(blankId: string, result: unknown, studioDefaultOnly = false): PlacementCompare[] {
  const b = getBlank(blankId);
  if (!b) return [];
  const sizes = printfileSizes(result);
  return b.placements.filter((p) => !studioDefaultOnly || p.dimsSource === "studio-default").map((p) => comparePlacement(p, sizes, b.printfulId));
}

/** D275: Printful technique per blank for the printfiles call (embroidery-only hats need ?technique=EMBROIDERY). */
export function printfileTechniques(b: Blank): string[] {
  const ms = new Set(b.placements.flatMap((p) => p.methods));
  return [...ms].map((m) => (m === "embroidery" ? "EMBROIDERY" : m === "dtg" ? "DTG" : "DTFILM"));
}

/** Merge several technique responses into one printfiles-shaped result. */
export function mergePrintfileResults(results: readonly unknown[]): { available_placements: Record<string, unknown>; printfiles: unknown[]; variant_printfiles: unknown[] } {
  const out = { available_placements: {} as Record<string, unknown>, printfiles: [] as unknown[], variant_printfiles: [] as unknown[] };
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const o = r as { available_placements?: unknown; printfiles?: unknown; variant_printfiles?: unknown };
    if (o.available_placements && typeof o.available_placements === "object") Object.assign(out.available_placements, o.available_placements);
    if (Array.isArray(o.printfiles)) out.printfiles.push(...o.printfiles);
    if (Array.isArray(o.variant_printfiles)) out.variant_printfiles.push(...o.variant_printfiles);
  }
  return out;
}

export function __runPrintfileCheckTests(): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error("FAIL printfile-check-core:", m); } };
  const rows = studioDefaultPlacements();
  // D278 +5: adidas A401 wrists (Printful gives no size) + Columbia left chests (only the right chest is sized).
  ok(rows.length === 11, "11 studio-default placements (8 + 5 D278 - 2 IND4000 wrists confirmed 2x3 in D286)");
  ok(rows.some((r) => r.blankId === "ind-exp54" && r.placementId === "back") && rows.some((r) => r.blankId === "l7-14003" && r.placementId === "front"), "windbreaker back + zip-hoodie front listed");
  ok(rows.every((r) => r.keys.length > 0 && r.printfulId > 0), "each has a Printful key and product id");
  const res = {
    product_id: 629,
    available_placements: { front: "Front print", back: "Back print" },
    printfiles: [{ printfile_id: 1, width: 3000, height: 2400, dpi: 300 }, { printfile_id: 2, width: 3300, height: 3300, dpi: 300 }, { printfile_id: "x", width: 1 }],
    variant_printfiles: [{ variant_id: 1, placements: { front: 1, back: 2 } }, { variant_id: 2, placements: { front: 2 } }],
  };
  const s = printfileSizes(res);
  ok(s.front.widthIn === 10 && s.front.heightIn === 8 && s.front.label === "Front print", "px / dpi -> inches, first variant wins");
  ok(s.back.widthIn === 11 && s.back.heightIn === 11, "back 3300 px at 300 = 11 in");
  ok(Object.keys(printfileSizes(null)).length === 0 && Object.keys(printfileSizes({ printfiles: "x" })).length === 0, "junk -> empty");
  const cmp = compareBlank("ind-exp54", res, true);
  const front = cmp.find((c) => c.placementId === "front")!;
  const back = cmp.find((c) => c.placementId === "back")!;
  ok(front.verdict === "fits" && front.text.includes("measure the sample"), "10x8 inside 10x8 fits, still says measure");
  ok(back.verdict === "bigger" && back.text.includes("BIGGER"), "12x12 vs 11x11 -> bigger warning");
  const zip = compareBlank("l7-14003", { available_placements: { front: "Front" }, printfiles: [{ printfile_id: 9, width: 3600, height: 3000, dpi: 300 }], variant_printfiles: [{ variant_id: 1, placements: { front: 9 } }] }, true);
  ok(zip.length === 1 && zip[0].verdict === "fits" && zip[0].printful!.key === "front", "DTG key 'default' falls back to Printful's 'front'");
  ok(compareBlank("ind-4000", { printfiles: [], variant_printfiles: [] }, true).every((c) => c.verdict === "no-file"), "no file listed -> no-file");
  ok(compareBlank("nope", res).length === 0, "unknown blank -> nothing");
  ok(STUDIO_DEFAULT_STATUS.includes("not measured"), "status never claims confirmed");
  // D275: the real rejection - 6089M front file 1650x600 (2.75). Old studio area 5x2.25 (2.22) would be flagged; the fixed 5.5x2 matches.
  const snapRes = { available_placements: { embroidery_front: "Front" }, printfiles: [{ printfile_id: 75, width: 1650, height: 600, dpi: 300 }], variant_printfiles: [{ variant_id: 1, placements: { embroidery_front: 75 } }] };
  const snap = compareBlank("yp-6089m", snapRes).find((c) => c.placementId === "hat_front")!;
  ok(snap.verdict === "fits" && snap.printful!.widthPx === 1650, "6089M 5.5x2 matches Printful 1650x600 via file type embroidery_front");
  const old = comparePlacement({ ...getBlank("yp-6089m")!.placements[0], widthIn: 5, heightIn: 2.25, printfileIn: undefined }, printfileSizes(snapRes), 99);
  ok(old.verdict === "ratio" && old.text.includes("REJECTED") && old.text.includes("2.75"), "old 5x2.25 area -> ratio rejection warning");
  ok(compareBlank("yp-6089m", snapRes).length === 4, "all placements compared by default");
  ok(printfileTechniques(getBlank("yp-6245cm")!).sort().join() === "DTFILM,EMBROIDERY" && printfileTechniques(getBlank("yp-6089m")!).join() === "EMBROIDERY", "techniques per blank");
  const merged = mergePrintfileResults([snapRes, { available_placements: { front_dtf_hat: "DTF" }, printfiles: [{ printfile_id: 816, width: 1500, height: 600, dpi: 300 }], variant_printfiles: [{ variant_id: 1, placements: { front_dtf_hat: 816 } }] }, null]);
  ok(Object.keys(printfileSizes(merged)).sort().join() === "embroidery_front,front_dtf_hat", "technique responses merged");
  return { passed, failed };
}
