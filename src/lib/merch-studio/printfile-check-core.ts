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
import { BLANKS, getBlank, type Blank, type Placement } from "./garment-catalog-core";

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

export type PlacementVerdict = "fits" | "bigger" | "no-file";
export interface PlacementCompare { placementId: string; label: string; studio: { widthIn: number; heightIn: number }; printful: PrintfileSize | null; verdict: PlacementVerdict; text: string }

/** Compare one studio placement with Printful's print file for any of its keys. */
export function comparePlacement(p: Placement, sizes: Record<string, PrintfileSize>): PlacementCompare {
  const keys = [...new Set(Object.values(p.printfulKey).filter((k): k is string => typeof k === "string"))];
  // Printful v1 calls the standard front "front"; our DTG key is "default".
  const pf = keys.map((k) => sizes[k] ?? (k === "default" ? sizes.front : undefined)).find(Boolean) ?? null;
  const studio = { widthIn: p.widthIn, heightIn: p.heightIn };
  if (!pf) return { placementId: p.id, label: p.label, studio, printful: null, verdict: "no-file", text: `Printful did not list a print file for ${keys.join(" / ") || "this placement"}. Check Printful's template for this product.` };
  const bigger = p.widthIn > pf.widthIn + 0.05 || p.heightIn > pf.heightIn + 0.05;
  return {
    placementId: p.id, label: p.label, studio, printful: pf,
    verdict: bigger ? "bigger" : "fits",
    text: bigger
      ? `Studio box ${p.widthIn}" x ${p.heightIn}" is BIGGER than Printful's print file ${pf.widthIn}" x ${pf.heightIn}" (${pf.widthPx} x ${pf.heightPx} px at ${pf.dpi} DPI): art near the edge could be cut off. Shrink the art, and measure the sample.`
      : `Studio box ${p.widthIn}" x ${p.heightIn}" fits inside Printful's print file ${pf.widthIn}" x ${pf.heightIn}" (${pf.widthPx} x ${pf.heightPx} px at ${pf.dpi} DPI). Still measure the sample before calling it confirmed.`,
  };
}

/** Compare every studio-default placement of one blank. */
export function compareBlank(blankId: string, result: unknown): PlacementCompare[] {
  const b = getBlank(blankId);
  if (!b) return [];
  const sizes = printfileSizes(result);
  return b.placements.filter((p) => p.dimsSource === "studio-default").map((p) => comparePlacement(p, sizes));
}

export function __runPrintfileCheckTests(): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error("FAIL printfile-check-core:", m); } };
  const rows = studioDefaultPlacements();
  ok(rows.length === 8, "8 studio-default placements (SOP said 7; F-11-14 corrected)");
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
  const cmp = compareBlank("ind-exp54", res);
  const front = cmp.find((c) => c.placementId === "front")!;
  const back = cmp.find((c) => c.placementId === "back")!;
  ok(front.verdict === "fits" && front.text.includes("measure the sample"), "10x8 inside 10x8 fits, still says measure");
  ok(back.verdict === "bigger" && back.text.includes("BIGGER"), "12x12 vs 11x11 -> bigger warning");
  const zip = compareBlank("l7-14003", { available_placements: { front: "Front" }, printfiles: [{ printfile_id: 9, width: 3600, height: 3600, dpi: 300 }], variant_printfiles: [{ variant_id: 1, placements: { front: 9 } }] });
  ok(zip.length === 1 && zip[0].verdict === "fits" && zip[0].printful!.key === "front", "DTG key 'default' falls back to Printful's 'front'");
  ok(compareBlank("ind-4000", { printfiles: [], variant_printfiles: [] }).every((c) => c.verdict === "no-file"), "no file listed -> no-file");
  ok(compareBlank("nope", res).length === 0, "unknown blank -> nothing");
  ok(STUDIO_DEFAULT_STATUS.includes("not measured"), "status never claims confirmed");
  return { passed, failed };
}
