/**
 * menu-mg-facet-core.ts — R49 S3 (owner: Michael)
 *
 * OWNER'S ASK: "add thc, cbd, cbg, cbn, cbc mg slider filter options meant for
 * the edibles, liquids, topicals, and others that use mg."
 *
 * SINGLE SOURCE OF TRUTH: the per-PACKAGE mg comes from
 * cannabinoid-profile-core `resolvePackageMg` — the same resolver the product
 * card uses for its "100 mg THC · 490 mg CBD" profile line. It already refuses
 * percent rows and "~" estimates, so a slider can never filter on a guessed
 * number. Measured on the live menu (2026-10-12): 10 items carry mg data
 * (5 Bytes edibles, 5 Hiku drinks) — THC 55–110, CBD 25–490, CBG 25–300,
 * CBN 25–210, CBC 95.
 *
 * SEMANTICS (enterprise-standard range facet, e.g. Algolia numeric refinement):
 *   - One min–max range per cannabinoid; a slider only appears when at least
 *     one item in the pool has that cannabinoid in mg (data-driven, never a
 *     hard-coded ceiling).
 *   - An UNTOUCHED slider (range covers the full bounds) is NOT a filter:
 *     every item passes, including flower that has no mg at all.
 *   - A NARROWED slider keeps only items whose package mg for that
 *     cannabinoid lies inside [min, max]. Items with no mg figure for it are
 *     excluded (unknown is never assumed to be in range).
 *   - Multiple narrowed sliders AND together.
 *
 * URL: `mg_thc=50-150` (integers). Parsed defensively; garbage is ignored.
 *
 * Pure; self-tests via __runMenuMgFacetCoreTests().
 */

import { resolvePackageMg, type ProfileInput } from "@/lib/menu/cannabinoid-profile-core";

export const MG_FACET_TYPES = ["thc", "cbd", "cbg", "cbn", "cbc"] as const;
export type MgFacetType = (typeof MG_FACET_TYPES)[number];

export type MgRange = { min: number; max: number };
export type MgBounds = Partial<Record<MgFacetType, MgRange>>;
export type MgSelection = Partial<Record<MgFacetType, MgRange>>;

export const MG_FACET_LABELS: Record<MgFacetType, string> = {
  thc: "THC",
  cbd: "CBD",
  cbg: "CBG",
  cbn: "CBN",
  cbc: "CBC",
};

export function mgUrlParam(type: MgFacetType): string {
  return `mg_${type}`;
}

/** The item's verified package mg for one cannabinoid, or null. */
export function itemMg(item: ProfileInput, type: MgFacetType): number | null {
  const row = resolvePackageMg(item).find((r) => r.type === type);
  return row ? row.mg : null;
}

/** Integer bounds per cannabinoid present in the pool (floor of min, ceil of max). */
export function buildMgBounds(items: ReadonlyArray<ProfileInput>): MgBounds {
  const out: MgBounds = {};
  for (const item of items) {
    for (const row of resolvePackageMg(item)) {
      if (!(MG_FACET_TYPES as readonly string[]).includes(row.type)) continue;
      const t = row.type as MgFacetType;
      const lo = Math.floor(row.mg);
      const hi = Math.ceil(row.mg);
      const cur = out[t];
      out[t] = cur ? { min: Math.min(cur.min, lo), max: Math.max(cur.max, hi) } : { min: lo, max: hi };
    }
  }
  return out;
}

/** True when a selected range actually narrows the bounds (i.e. is a real filter). */
export function isMgRangeActive(range: MgRange | undefined, bounds: MgRange | undefined): boolean {
  if (!range) return false;
  if (!bounds) return true; // selected but cannabinoid absent from pool → still a filter (yields 0)
  return range.min > bounds.min || range.max < bounds.max;
}

/** AND across narrowed sliders; an un-narrowed slider never excludes anything. */
export function matchesMgSelection(item: ProfileInput, selection: MgSelection, bounds: MgBounds): boolean {
  let resolved: { type: string; mg: number }[] | null = null;
  for (const t of MG_FACET_TYPES) {
    const range = selection[t];
    if (!isMgRangeActive(range, bounds[t])) continue;
    resolved ??= resolvePackageMg(item);
    const row = resolved.find((r) => r.type === t);
    if (!row) return false;
    if (row.mg < range!.min || row.mg > range!.max) return false;
  }
  return true;
}

/** Parse "50-150" → {min:50,max:150}; null on anything malformed. Swaps a reversed pair. */
export function parseMgRangeParam(raw: string | null | undefined): MgRange | null {
  if (typeof raw !== "string") return null;
  const m = /^\s*(\d{1,6})\s*-\s*(\d{1,6})\s*$/.exec(raw);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a <= b ? { min: a, max: b } : { min: b, max: a };
}

export function formatMgRangeParam(range: MgRange): string {
  return `${Math.round(range.min)}-${Math.round(range.max)}`;
}

/** Read every mg_<type> param from a getter (URLSearchParams.get-like). */
export function parseMgSelection(get: (key: string) => string | null | undefined): MgSelection {
  const out: MgSelection = {};
  for (const t of MG_FACET_TYPES) {
    const r = parseMgRangeParam(get(mgUrlParam(t)));
    if (r) out[t] = r;
  }
  return out;
}

/** Drop ranges that no longer narrow anything (keeps URLs/pills clean). */
export function activeMgSelection(selection: MgSelection, bounds: MgBounds): MgSelection {
  const out: MgSelection = {};
  for (const t of MG_FACET_TYPES) {
    const r = selection[t];
    if (r && isMgRangeActive(r, bounds[t])) out[t] = r;
  }
  return out;
}

/** Selection without one cannabinoid (for disjunctive bounds). */
export function mgSelectionWithout(selection: MgSelection, type: MgFacetType): MgSelection {
  const out: MgSelection = { ...selection };
  delete out[type];
  return out;
}

/** "50–150 mg" pill text. */
export function mgRangeLabel(range: MgRange): string {
  return `${range.min}–${range.max} mg`;
}

/** Stable string for memo keys / result signatures. */
export function mgSelectionKey(selection: MgSelection): string {
  return MG_FACET_TYPES.map((t) => (selection[t] ? `${t}:${selection[t]!.min}-${selection[t]!.max}` : "")).filter(Boolean).join("|");
}

// ---------------------------------------------------------------------------
// Self-tests (pure, tsx-runnable)
// ---------------------------------------------------------------------------

export function __runMenuMgFacetCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`menu-mg-facet-core FAIL: ${msg}`);
    }
  };

  // Shapes mirror the live Bytes / Hiku rows.
  const bytesCbd = { category: "edible-solid", packageThcMg: 100, packageCbdMg: 490 };
  const bytesCbg = {
    category: "edible-solid",
    packageThcMg: 110,
    compounds: [{ type: "cbg", value: "300", unit: "mg" }],
  };
  const hikuCbn = {
    category: "edible-liquid",
    packageThcMg: 100,
    compounds: [{ type: "cbn", value: "25", unit: "mg" }],
  };
  const flower = { category: "flower", totalThc: { value: "24.5", unit: "%" } };
  const estimate = { category: "edible-solid", compounds: [{ type: "cbn", value: "~10", unit: "mg" }] };
  const pool = [bytesCbd, bytesCbg, hikuCbn, flower, estimate];

  ok(itemMg(bytesCbd, "cbd") === 490, "package CBD column read");
  ok(itemMg(bytesCbg, "cbg") === 300, "minor from compounds");
  ok(itemMg(flower, "thc") === null, "percent is never mg");
  ok(itemMg(estimate, "cbn") === null, "'~' estimate is never mg");

  const b = buildMgBounds(pool);
  ok(b.thc?.min === 100 && b.thc?.max === 110, "THC bounds 100–110");
  ok(b.cbd?.min === 490 && b.cbd?.max === 490, "CBD bounds");
  ok(b.cbg?.min === 300 && b.cbn?.min === 25, "minor bounds");
  ok(b.cbc === undefined, "absent cannabinoid has no slider");
  ok(Object.keys(buildMgBounds([flower])).length === 0, "flower-only pool → no mg sliders");
  const frac = buildMgBounds([{ category: "edible-solid", packageThcMg: 5.5 }]);
  ok(frac.thc?.min === 5 && frac.thc?.max === 6, "fractional mg → integer floor/ceil bounds");

  ok(matchesMgSelection(flower, {}, b), "no selection: flower passes");
  ok(matchesMgSelection(flower, { thc: { min: 100, max: 110 } }, b), "untouched slider is not a filter");
  ok(!matchesMgSelection(flower, { thc: { min: 100, max: 105 } }, b), "narrowed slider excludes no-mg items");
  ok(matchesMgSelection(hikuCbn, { thc: { min: 100, max: 105 } }, b), "100 in [100,105]");
  ok(!matchesMgSelection(bytesCbg, { thc: { min: 100, max: 105 } }, b), "110 outside [100,105]");
  ok(matchesMgSelection(bytesCbg, { thc: { min: 101, max: 110 }, cbg: { min: 300, max: 300 } }, b) === true, "AND across sliders (both pass)");
  ok(!matchesMgSelection(bytesCbd, { thc: { min: 100, max: 105 }, cbn: { min: 26, max: 25 + 1 } }, b), "AND across sliders (one fails)");
  ok(!matchesMgSelection(bytesCbd, { cbc: { min: 1, max: 5 } }, b), "selection on an absent cannabinoid excludes all");

  ok(isMgRangeActive({ min: 100, max: 110 }, { min: 100, max: 110 }) === false, "full range inactive");
  ok(isMgRangeActive({ min: 101, max: 110 }, { min: 100, max: 110 }), "raised min active");

  const p = parseMgRangeParam("50-150");
  ok(p?.min === 50 && p?.max === 150, "parse 50-150");
  ok(parseMgRangeParam("150-50")?.min === 50, "reversed pair swapped");
  ok(parseMgRangeParam("abc") === null && parseMgRangeParam("") === null && parseMgRangeParam(null) === null, "garbage rejected");
  ok(parseMgRangeParam("-5-10") === null, "negative rejected");
  ok(formatMgRangeParam({ min: 50, max: 150 }) === "50-150", "format");

  const params = new URLSearchParams("mg_thc=100-105&mg_cbn=x&mg_cbg=0-300");
  const sel = parseMgSelection((k) => params.get(k));
  ok(sel.thc?.max === 105 && sel.cbn === undefined && sel.cbg?.max === 300, "parseMgSelection");
  // Pool bounds: thc 100–110, cbg 300–300. Full ranges drop; a narrowed one stays.
  const act = activeMgSelection({ thc: { min: 100, max: 110 }, cbg: { min: 300, max: 300 }, cbd: { min: 1, max: 2 } }, b);
  ok(act.thc === undefined && act.cbg === undefined, "activeMgSelection drops full ranges");
  ok(act.cbd?.min === 1, "activeMgSelection keeps a narrowed range");
  ok(mgSelectionWithout({ thc: { min: 1, max: 2 }, cbd: { min: 1, max: 2 } }, "thc").thc === undefined, "without");
  ok(mgRangeLabel({ min: 50, max: 150 }) === "50–150 mg", "label");
  ok(mgSelectionKey({ cbd: { min: 1, max: 2 }, thc: { min: 3, max: 4 } }) === "thc:3-4|cbd:1-2", "stable key order");
  ok(mgUrlParam("cbn") === "mg_cbn", "url param name");

  return { passed, failed };
}
