/**
 * card-cannabinoids.ts — pure display helpers for the menu product card.
 *
 * WHY THIS EXISTS
 * ----------------
 * The website product card historically rendered only two opaque strings —
 * `THC: {item.thc}` and `CBD: {item.cbd}` — and ignored the richer `compounds[]`
 * array entirely. This module turns the verified menu-item data into honest,
 * compliance-aware display pieces.
 *
 * SLICE 43 (owner directive — validated data only, totals only)
 * -------------------------------------------------------------
 *   • Info boxes appear ONLY when there is validated data for them and are
 *     hidden otherwise. No "--" placeholders, and category-average ESTIMATES
 *     (values carrying the "~" marker from transform.ts Section G) count as
 *     NOT validated and are hidden.
 *   • ONE combined THC box showing the TOTAL (the POS "Total" column, which is
 *     the lab-reported total that already folds THC + THC-A). No separate
 *     THC/THCA boxes. Same for CBD (total CBD; no separate CBDA box).
 *   • Minor cannabinoids (CBG, CBN, CBC, CBDV) get their own full info boxes
 *     when present — promoted from the old tiny pills (owner Q4).
 *   • Every value shown is the total cannabinoid figure — package-total mg for
 *     edibles/drinks/tinctures, lab-total % for flower/concentrate/cartridge —
 *     never a per-serving amount.
 *
 * GROUNDING (verified, never guessed)
 * -----------------------------------
 *   • `totalThc`/`totalCbd` come from transform.ts resolveCannabinoid (the POS
 *     Total/Cbd columns): Solid/Liquid Edible + Tincture are PACKAGE TOTALS in
 *     mg; flower/concentrate/cartridge are lab-total `%`. This module never
 *     converts units.
 *   • Section G average fallbacks are prefixed "~" by transform.ts; the owner
 *     ruled those are not validated COA data, so they hide the box.
 *   • The profile badge derives through the finalized naming engine
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

export type CannabinoidBox = {
  /** Upper-cased short label, e.g. "THC", "CBD", "CBG". */
  label: string;
  /** Formatted value + unit, e.g. "100 mg" or "21.4%". */
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
  /**
   * Validated info boxes in display order: total THC, total CBD, then minor
   * cannabinoids (CBG, CBN, CBC, CBDV). Empty when no validated data exists —
   * the card renders NOTHING in that case (owner rule: no placeholder boxes).
   */
  boxes: CannabinoidBox[];
};

/* ------------------------------------------------------------------ *
 *  Small utilities
 * ------------------------------------------------------------------ */

const MINOR_LABEL: Partial<Record<GreenwayCannabinoid["type"], string>> = {
  cbg: "CBG",
  cbn: "CBN",
  cbc: "CBC",
  cbdv: "CBDV",
};

/** Display order for the minor-cannabinoid boxes (after THC and CBD). */
const MINOR_ORDER: GreenwayCannabinoid["type"][] = ["cbg", "cbn", "cbc", "cbdv"];

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Section G category-average fallbacks are prefixed "~" by transform.ts.
 * The owner ruled estimates are NOT validated COA data → treat as absent.
 */
function isEstimate(value: string | number | null | undefined): boolean {
  return typeof value === "string" && value.includes("~");
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
 *  Profile
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
  // SLICE 43: "~" estimates are not validated data → null them out so the
  // profile badge can never be driven by a category-average guess.
  const totalThc = item.totalThc && !isEstimate(item.totalThc.value) ? toEngineCannabinoid(item.totalThc) : null;
  const totalCbd = item.totalCbd && !isEstimate(item.totalCbd.value) ? toEngineCannabinoid(item.totalCbd) : null;

  const tag = cannabinoidTag(compounds, totalThc, totalCbd);

  // Presence check (post acid-fold) to distinguish THC-only vs CBD-only.
  const has = (t: "thc" | "cbd") => {
    const check = (c?: Cannabinoid | null) => {
      if (!c) return false;
      if (isEstimate(c.value)) return false;
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

/* ------------------------------------------------------------------ *
 *  Info boxes (SLICE 43)
 * ------------------------------------------------------------------ */

/**
 * Build the validated cannabinoid info boxes:
 *   1. "THC"  — the combined TOTAL (POS Total column; folds THC + THC-A).
 *   2. "CBD"  — the total CBD (POS Cbd column; CBDA folded upstream).
 *   3. Minors — CBG, CBN, CBC, CBDV from `compounds[]`, each its own box.
 * A box only appears when its value is validated: present, > 0, and NOT a
 * "~" category-average estimate. THCA/CBDA never get their own boxes (they
 * are folded into the totals — owner Q3).
 */
export function deriveBoxes(
  item: Pick<GreenwayMenuItem, "totalThc" | "totalCbd" | "compounds">,
): CannabinoidBox[] {
  const boxes: CannabinoidBox[] = [];
  const push = (label: string, c: GreenwayCannabinoid | null | undefined) => {
    if (!c || isEstimate(c.value)) return;
    const display = formatCompound(c.value, c.unit);
    if (!display) return;
    boxes.push({ label, display });
  };

  push("THC", item.totalThc);
  push("CBD", item.totalCbd);

  const compounds = item.compounds ?? [];
  for (const type of MINOR_ORDER) {
    const match = compounds.find((c) => c.type === type);
    if (!match) continue;
    const label = MINOR_LABEL[type];
    if (!label) continue;
    push(label, match);
  }
  return boxes;
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
  return {
    profile: deriveProfile(item),
    boxes: deriveBoxes(item),
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

  // 1) 100 mg lemonade: ONE total THC box carrying the package total.
  const lemonade = mk({
    category: "edible-liquid",
    totalThc: { type: "thc", value: "100", unit: "mg" },
    compounds: [{ type: "thc", value: "100", unit: "mg" }],
    variants: [{ id: "v", label: "12fl oz", priceMinorUnits: 500, inventoryLevel: 4, medical: false }],
  });
  const l = cardCannabinoids(lemonade);
  check("lemonade one box", l.boxes.length === 1, l.boxes);
  check("lemonade box is package-total mg", l.boxes[0]?.label === "THC" && l.boxes[0]?.display === "100 mg", l.boxes[0]);
  check("lemonade profile THC", l.profile?.kind === "thc", l.profile);
  check("lemonade net weight fl oz", deriveNetWeightLine(lemonade) === "12 fl oz (354.88 ml)", deriveNetWeightLine(lemonade));

  // 2) 1:1 tincture: THC + CBD boxes, ratio profile.
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
  check("1:1 two boxes", o.boxes.length === 2, o.boxes);
  check("1:1 box order THC then CBD", o.boxes[0]?.label === "THC" && o.boxes[1]?.label === "CBD", o.boxes);

  // 3) 3-compound blend → THC + CBD + CBN boxes (minor PROMOTED to a full box, owner Q4).
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
  check("blend three boxes", b.boxes.length === 3, b.boxes);
  check("blend CBN box promoted", b.boxes[2]?.label === "CBN" && b.boxes[2]?.display === "2 mg", b.boxes[2]);

  // 4) Flower (%): ONE combined total-THC box; THCA folded, never its own box (owner Q3).
  const flower = mk({
    category: "flower",
    totalThc: { type: "thc", value: "28.94", unit: "%" },
    compounds: [
      { type: "thc", value: "24.5", unit: "%" },
      { type: "thca", value: "3.9", unit: "%" },
    ],
    variants: [{ id: "v", label: "3.5g", priceMinorUnits: 3500, inventoryLevel: 5, medical: false }],
  });
  const f = cardCannabinoids(flower);
  check("flower one combined THC box", f.boxes.length === 1, f.boxes);
  check("flower box shows lab TOTAL", f.boxes[0]?.label === "THC" && f.boxes[0]?.display === "28.94%", f.boxes[0]);
  check("flower no THCA box", f.boxes.every((x) => x.label !== "THCA"), f.boxes);
  check("flower no oz net line", deriveNetWeightLine(flower) === null, deriveNetWeightLine(flower));

  // 5) "~" category-average estimate is NOT validated → box hidden (owner Q2).
  const estimated = mk({
    category: "flower",
    totalThc: { type: "thc", value: "~21.00", unit: "%" },
    compounds: [],
  });
  const e = cardCannabinoids(estimated);
  check("estimate hides THC box", e.boxes.length === 0, e.boxes);
  check("estimate hides profile too", e.profile === null, e.profile);

  // 6) No data at all → no boxes, no profile (card shows nothing — no "--").
  const bare = mk({ category: "topical" });
  const n = cardCannabinoids(bare);
  check("no data no boxes", n.boxes.length === 0, n.boxes);
  check("no data no profile", n.profile === null, n.profile);

  // 7) CBG minor on a % product gets its own box after THC.
  const cbgFlower = mk({
    category: "flower",
    totalThc: { type: "thc", value: "22", unit: "%" },
    compounds: [
      { type: "thc", value: "22", unit: "%" },
      { type: "cbg", value: "1.2", unit: "%" },
    ],
  });
  const g = cardCannabinoids(cbgFlower);
  check("cbg box present", g.boxes.some((x) => x.label === "CBG" && x.display === "1.2%"), g.boxes);
  check("cbg after THC", g.boxes[0]?.label === "THC" && g.boxes[1]?.label === "CBG", g.boxes);

  // 8) parseNetMeasure edge cases.
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
