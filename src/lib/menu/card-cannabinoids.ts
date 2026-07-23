/**
 * card-cannabinoids.ts — pure display helpers for the menu product card.
 *
 * WHY THIS EXISTS
 * ----------------
 * The website product card historically rendered only two opaque strings —
 * `THC: {item.thc}` and `CBD: {item.cbd}` — and ignored the richer `compounds[]`
 * array entirely. For an edible/beverage that means a 100 mg-per-package
 * lemonade could read like a 10 mg microdose, and multi-cannabinoid products
 * (THC:CBD:CBN blends, 1:1 tinctures) lost their profile. This module turns the
 * verified menu-item data into honest, compliance-aware display pieces:
 *
 *   • a cannabinoid PROFILE badge  (THC-only / 1:1 / 2:1 / THC:CBD:CBN / CBD)
 *   • per-compound chips           (THC 8.2 mg, CBD 8.4 mg, CBN 2 mg, …)
 *   • a package-TOTAL THC headline (mg products only — "100 mg THC total")
 *   • a net weight/volume line in  oz + g  for edibles/drinks (flower stays g/%)
 *
 * GROUNDING (verified, never guessed)
 * -----------------------------------
 *   • `compounds`, `totalThc`, `totalCbd` for Solid/Liquid Edible + Tincture are
 *     already stored as the PACKAGE TOTAL in mg (src/lib/pos/transform.ts). Flower/
 *     concentrate/cartridge are stored as `%`. This module never converts units.
 *   • WAC 314-55-095 caps Δ9-THC at 10 mg/serving and 100 mg/package; WAC
 *     314-55-105 requires Total THC/CBD + net weight in oz and grams. We surface
 *     the total and net weight; we DO NOT invent a "× N servings" breakdown
 *     because per-serving mg is not persisted on the menu item (reported to owner
 *     as a follow-up plumbing task — no guessing).
 *   • The profile badge is derived through the finalized naming engine
 *     (`cannabinoidTag`) so the card and the compliance name stay in lock-step.
 *
 * All functions here are pure and unit-tested via `__runCardCannabinoidTests()`.
 */

import { cannabinoidTag, type Cannabinoid } from "@/lib/naming/convention-core";
import { AVOIRDUPOIS_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";
import type { GreenwayCannabinoid, GreenwayMenuItem } from "@/lib/leafly/types";

/* ------------------------------------------------------------------ *
 *  Types
 * ------------------------------------------------------------------ */

export type CannabinoidChip = {
  /** Upper-cased short label, e.g. "THC", "CBD", "CBN". */
  label: string;
  /** Formatted value + unit, e.g. "8.2 mg" or "21.4%". */
  display: string;
};

export type CardProfile =
  | { kind: "thc"; label: "THC" }
  | { kind: "ratio"; label: string } // "1:1", "2:1", "1:2", …
  | { kind: "multi"; label: string } // "THC:CBD:CBN"
  | { kind: "cbd"; label: "CBD" }
  | { kind: "none"; label: "" };

export type CardCannabinoids = {
  /** Profile badge for the card. `null` when there is nothing meaningful to show. */
  profile: CardProfile | null;
  /** All present compounds as display chips (already unit-formatted). */
  chips: CannabinoidChip[];
  /**
   * Prominent package-total THC headline for mg products (edibles/drinks/
   * tinctures), e.g. "100 mg THC total". `null` for %-based products (flower,
   * concentrate, cartridge) where a total-mg headline is meaningless.
   */
  totalThcHeadline: string | null;
  /** Optional package-total CBD companion line, e.g. "50 mg CBD total". */
  totalCbdHeadline: string | null;
  /** True when the item is dosed in mg (edible/liquid/tincture). */
  isMgProduct: boolean;
};

/* ------------------------------------------------------------------ *
 *  Small utilities
 * ------------------------------------------------------------------ */

const COMPOUND_LABEL: Record<GreenwayCannabinoid["type"], string> = {
  thc: "THC",
  thca: "THCA",
  cbd: "CBD",
  cbda: "CBDA",
  cbg: "CBG",
  cbn: "CBN",
  cbdv: "CBDV",
};

/** Display order for chips: THC family first, then CBD family, then minors. */
const CHIP_ORDER: GreenwayCannabinoid["type"][] = [
  "thc",
  "thca",
  "cbd",
  "cbda",
  "cbg",
  "cbn",
  "cbdv",
];

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Trim a trailing ".00"/".0" so "10.00" reads "10" but "8.25" is preserved. */
function trimZeros(value: number): string {
  const fixed = value.toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function formatCompound(value: string | number | null, unit: "%" | "mg"): string | null {
  const n = toNumber(value);
  if (n === null || n <= 0) return null;
  return unit === "%" ? `${trimZeros(n)}%` : `${trimZeros(n)} mg`;
}

/* ------------------------------------------------------------------ *
 *  Profile + chips
 * ------------------------------------------------------------------ */

/**
 * Adapt a `GreenwayCannabinoid` to the naming-engine `Cannabinoid` shape.
 * (Identical structurally; this keeps the dependency direction explicit and
 * lets tsc catch drift if either type changes.)
 */
function toEngineCannabinoid(c: GreenwayCannabinoid): Cannabinoid {
  return { type: c.type, value: c.value, unit: c.unit };
}

export function deriveProfile(item: Pick<GreenwayMenuItem, "compounds" | "totalThc" | "totalCbd">): CardProfile | null {
  const compounds = (item.compounds ?? []).map(toEngineCannabinoid);
  const totalThc = item.totalThc ? toEngineCannabinoid(item.totalThc) : null;
  const totalCbd = item.totalCbd ? toEngineCannabinoid(item.totalCbd) : null;

  const tag = cannabinoidTag(compounds, totalThc, totalCbd);

  // Presence check (post acid-fold) to distinguish THC-only vs CBD-only.
  const has = (t: "thc" | "cbd") => {
    const check = (c?: Cannabinoid | null) => {
      if (!c) return false;
      const n = toNumber(c.value);
      if (n === null || n <= 0) return false;
      const folded = c.type === "thca" ? "thc" : c.type === "cbda" || c.type === "cbdv" ? "cbd" : c.type;
      return folded === t;
    };
    return compounds.some(check) || check(t === "thc" ? totalThc : totalCbd);
  };

  const hasThc = has("thc");
  const hasCbd = has("cbd");

  if (tag === "") {
    // No tag => single dominant cannabinoid (or none).
    if (hasThc && !hasCbd) return { kind: "thc", label: "THC" };
    if (hasCbd && !hasThc) return { kind: "cbd", label: "CBD" };
    return null;
  }

  // Tag present: ratio (contains ':1' or '1:') vs multi-letter (contains letters).
  if (/^\d+:\d+$/.test(tag)) return { kind: "ratio", label: tag };
  return { kind: "multi", label: tag };
}

export function deriveChips(item: Pick<GreenwayMenuItem, "compounds">): CannabinoidChip[] {
  const compounds = item.compounds ?? [];
  const chips: CannabinoidChip[] = [];
  for (const type of CHIP_ORDER) {
    const match = compounds.find((c) => c.type === type);
    if (!match) continue;
    const display = formatCompound(match.value, match.unit);
    if (!display) continue;
    chips.push({ label: COMPOUND_LABEL[type], display });
  }
  return chips;
}

/* ------------------------------------------------------------------ *
 *  Total headline (mg products only)
 * ------------------------------------------------------------------ */

export function deriveTotalHeadlines(
  item: Pick<GreenwayMenuItem, "totalThc" | "totalCbd">,
): { thc: string | null; cbd: string | null; isMg: boolean } {
  const isMg = item.totalThc?.unit === "mg" || item.totalCbd?.unit === "mg";
  if (!isMg) return { thc: null, cbd: null, isMg: false };

  const thcVal = toNumber(item.totalThc?.value ?? null);
  const cbdVal = toNumber(item.totalCbd?.value ?? null);

  const thc = thcVal !== null && thcVal > 0 ? `${trimZeros(thcVal)} mg THC total` : null;
  const cbd = cbdVal !== null && cbdVal > 0 ? `${trimZeros(cbdVal)} mg CBD total` : null;
  return { thc, cbd, isMg: true };
}

/* ------------------------------------------------------------------ *
 *  Net weight / volume in oz + g  (edibles/drinks)
 * ------------------------------------------------------------------ */

// GW-016: real measured weights use the true avoirdupois conversion (shared module).
const GRAMS_PER_OZ = AVOIRDUPOIS_GRAMS_PER_OUNCE;

/**
 * Parse a variant/package label (e.g. "3.5g", "1oz", "10ml", "2fl oz", "100mg",
 * "10pk", "each", "") into a normalized measure. Returns null when the label has
 * no real weight/volume (packs, counts, bare potency, blank).
 */
export function parseNetMeasure(label: string | null | undefined): { grams: number | null; ml: number | null } | null {
  if (!label) return null;
  const s = label.trim().toLowerCase();

  // fl oz / floz  → volume (do not treat as weight ounces)
  const floz = s.match(/^([\d.]+)\s*(?:fl\.?\s*oz|floz)$/);
  if (floz) return { grams: null, ml: Number(floz[1]) * 29.5735 };

  const ml = s.match(/^([\d.]+)\s*ml$/);
  if (ml) return { grams: null, ml: Number(ml[1]) };

  const oz = s.match(/^([\d.]+)\s*oz$/);
  if (oz) return { grams: Number(oz[1]) * GRAMS_PER_OZ, ml: null };

  const g = s.match(/^([\d.]+)\s*g$/);
  if (g) return { grams: Number(g[1]), ml: null };

  // mg here is a potency, not a net weight → not a package measure.
  return null;
}

/**
 * Build a customer-facing net weight/volume line in oz + g (WAC 314-55-105).
 * Only for mg-dosed products (edibles/drinks/tinctures) — flower keeps grams/%.
 * Returns null when no real measure is available.
 */
export function deriveNetWeightLine(
  item: Pick<GreenwayMenuItem, "totalThc" | "totalCbd" | "variants" | "posInventoryCategory">,
): string | null {
  const isMg = item.totalThc?.unit === "mg" || item.totalCbd?.unit === "mg";
  if (!isMg) return null; // flower/concentrate use %/grams elsewhere — not here.

  // Use the first variant that carries a real measure.
  for (const v of item.variants ?? []) {
    const measure = parseNetMeasure(v.label);
    if (!measure) continue;
    if (measure.ml !== null) {
      // Beverages: lead with fl oz (how customers think) + ml companion.
      const floz = measure.ml / 29.5735;
      return `${trimZeros(floz)} fl oz (${trimZeros(measure.ml)} ml)`;
    }
    if (measure.grams !== null) {
      // Solid edibles: lead with oz (WAC 314-55-105 net weight) + grams companion.
      const oz = measure.grams / GRAMS_PER_OZ;
      return `${trimZeros(oz)} oz (${trimZeros(measure.grams)} g)`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  Top-level composer
 * ------------------------------------------------------------------ */

export function cardCannabinoids(item: GreenwayMenuItem): CardCannabinoids {
  const totals = deriveTotalHeadlines(item);
  return {
    profile: deriveProfile(item),
    chips: deriveChips(item),
    totalThcHeadline: totals.thc,
    totalCbdHeadline: totals.cbd,
    isMgProduct: totals.isMg,
  };
}

/* ------------------------------------------------------------------ *
 *  Self-tests  (run: npx tsx src/lib/menu/card-cannabinoids.ts)
 * ------------------------------------------------------------------ */

export function __runCardCannabinoidTests(): void {
  const results: Array<[string, boolean, unknown]> = [];
  const check = (name: string, cond: boolean, detail?: unknown) => results.push([name, cond, detail]);

  const mk = (over: Partial<GreenwayMenuItem>): GreenwayMenuItem =>
    ({
      id: "t",
      name: "Test",
      brand: "Brand",
      category: "edible-liquid",
      strainType: "unknown",
      thc: null,
      cbd: null,
      totalThc: null,
      totalCbd: null,
      compounds: [],
      description: "",
      priceLabel: "",
      priceMinorUnits: 0,
      inventoryStatus: "in-stock",
      variants: [],
      ...over,
    }) as GreenwayMenuItem;

  // 1) 100 mg lemonade: total headline shows package total, not a microdose.
  const lemonade = mk({
    category: "edible-liquid",
    totalThc: { type: "thc", value: "100", unit: "mg" },
    compounds: [{ type: "thc", value: "100", unit: "mg" }],
    variants: [{ id: "v", label: "12fl oz", priceMinorUnits: 500, inventoryLevel: 4, medical: false }],
  });
  const l = cardCannabinoids(lemonade);
  check("lemonade total headline", l.totalThcHeadline === "100 mg THC total", l.totalThcHeadline);
  check("lemonade profile THC", l.profile?.kind === "thc", l.profile);
  // "12fl oz" parses to 355.735? No: 12 * 29.5735 = 354.882 ml → leads with fl oz.
  check("lemonade net weight fl oz", deriveNetWeightLine(lemonade) === "12 fl oz (354.88 ml)", deriveNetWeightLine(lemonade));

  // 2) 1:1 tincture.
  const oneToOne = mk({
    category: "tincture",
    totalThc: { type: "thc", value: "50", unit: "mg" },
    totalCbd: { type: "cbd", value: "50", unit: "mg" },
    compounds: [
      { type: "thc", value: "50", unit: "mg" },
      { type: "cbd", value: "50", unit: "mg" },
    ],
  });
  const o = cardCannabinoids(oneToOne);
  check("1:1 ratio profile", o.profile?.kind === "ratio" && o.profile.label === "1:1", o.profile);
  check("1:1 two chips", o.chips.length === 2, o.chips);
  check("1:1 cbd headline", o.totalCbdHeadline === "50 mg CBD total", o.totalCbdHeadline);

  // 3) 3-compound blend → THC:CBD:CBN.
  const blend = mk({
    category: "edible-solid",
    totalThc: { type: "thc", value: "10", unit: "mg" },
    totalCbd: { type: "cbd", value: "10", unit: "mg" },
    compounds: [
      { type: "thc", value: "10", unit: "mg" },
      { type: "cbd", value: "10", unit: "mg" },
      { type: "cbn", value: "2", unit: "mg" },
    ],
  });
  const b = cardCannabinoids(blend);
  check("blend multi profile", b.profile?.kind === "multi" && b.profile.label === "THC:CBD:CBN", b.profile);
  check("blend three chips", b.chips.length === 3, b.chips);

  // 4) Flower (%): NO mg headline, NO net-weight-oz line here.
  const flower = mk({
    category: "flower",
    totalThc: { type: "thc", value: "24.5", unit: "%" },
    compounds: [{ type: "thc", value: "24.5", unit: "%" }],
    variants: [{ id: "v", label: "3.5g", priceMinorUnits: 3500, inventoryLevel: 5, medical: false }],
  });
  const f = cardCannabinoids(flower);
  check("flower no mg headline", f.totalThcHeadline === null, f.totalThcHeadline);
  check("flower chip is percent", f.chips[0]?.display === "24.5%", f.chips);
  check("flower no oz net line", deriveNetWeightLine(flower) === null, deriveNetWeightLine(flower));

  // 5) parseNetMeasure edge cases.
  check("parse 1oz", JSON.stringify(parseNetMeasure("1oz")) === JSON.stringify({ grams: 28.3495, ml: null }), parseNetMeasure("1oz"));
  check("parse 100mg is null (potency)", parseNetMeasure("100mg") === null, parseNetMeasure("100mg"));
  check("parse 10pk is null", parseNetMeasure("10pk") === null, parseNetMeasure("10pk"));
  check("parse each is null", parseNetMeasure("each") === null, parseNetMeasure("each"));

  // Report
  const failed = results.filter(([, ok]) => !ok);
  for (const [name, ok, detail] of results) {
     
    console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `  →  ${JSON.stringify(detail)}`}`);
  }
  if (failed.length) {
    throw new Error(`${failed.length} card-cannabinoid test(s) failed`);
  }
   
  console.log(`\nAll ${results.length} card-cannabinoid tests passed.`);
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  __runCardCannabinoidTests();
}
