/**
 * PR-P3 — AI Smart Selector, PURE CORE.
 *
 * The hallucination-proofing lives here: the transform that turns the AI's flat
 * draft into a validated SelectionPredicate, plus the AI response schema and the
 * embedded self-tests. This module has NO `server-only` and NO AI-provider
 * import, so it is fully unit-testable under tsx/vitest. The thin server wrapper
 * (promotion-selector-ai.ts) adds the actual model call.
 *
 * Anti-hallucination guarantees (all enforced here, deterministically):
 *   1. The AI never names product keys/IDs/SKUs — it only fills this predicate.
 *   2. Enumerable dimensions (sizes, cannabinoids) are re-verified against the
 *      real vocabulary; anything else is dropped.
 *   3. Brands / categories / vendors / strain types / inventory statuses are
 *      validated against the LIVE menu vocabulary; unknown values are dropped
 *      with a plain-English warning (canonicalized to the menu's own casing).
 *   4. Numeric ranges are clamped; contradictory min>max ranges are removed.
 *   5. Fail-safe: an empty/vague draft yields a predicate with no positive
 *      condition, and the deterministic core selects NOTHING (never everything).
 */

import { defineSchema } from "@/lib/ai/schema";
import {
  SIZE_BUCKETS,
  SIZE_LABELS,
  CANNABINOIDS,
  predicateHasPositiveCondition,
  type SelectionPredicate,
  type SizeBucket,
} from "@/lib/promotions/promotion-selector-core";

/**
 * The live menu "vocabulary" the AI draft is validated against. These come from
 * the real published menu (brands/categories/vendors/strains actually in
 * stock), so the drafted predicate can only reference things that exist.
 */
export type MenuVocabulary = {
  brands: string[];
  categories: string[];
  vendors: string[];
  strainTypes: string[];
  inventoryStatuses: string[];
};

/**
 * The flat draft shape the AI emits. Every field is scalar or a string array
 * (the schema layer supports NO arrays-of-objects), which maps cleanly onto the
 * SelectionPredicate. Ranges use sentinel -1 to mean "not set" (strict mode
 * requires the field present, and 0 is a legitimate floor for price/thc/cbd).
 */
export type PredicateDraft = {
  sizes: string[];
  categories: string[];
  strainTypes: string[];
  brands: string[];
  vendors: string[];
  nameContains: string[];
  nameExcludes: string[];
  hasCannabinoid: string[];

  priceMinDollars: number;
  priceMaxDollars: number;
  weightMinGrams: number;
  weightMaxGrams: number;
  thcMinPercent: number;
  thcMaxPercent: number;
  cbdMinPercent: number;
  cbdMaxPercent: number;

  ratioProducts: boolean;
  lowStock: boolean;
  lowStockThreshold: number;
  newArrival: boolean;
  onSaleFilter: "any" | "only_on_sale" | "only_not_on_sale";

  inventoryStatuses: string[];

  summary: string;
};

/** Clamp bounds — defensive limits so the AI can't emit nonsense ranges. */
export const PRICE_MAX_DOLLARS = 100_000; // $100k ceiling; menu prices are far below
export const WEIGHT_MAX_GRAMS = 2_000; // well beyond any single retail unit
export const PCT_MAX = 100;
export const LOW_STOCK_MAX = 1_000;

export const SENTINEL = -1; // "field not set"

const strArr = (description: string, maxItems: number, allowed?: readonly string[]) =>
  (allowed
    ? ({ kind: "stringArray", description, maxItems, allowed: [...allowed] } as const)
    : ({ kind: "stringArray", description, maxItems } as const));

const rangeNum = (description: string, max: number) =>
  ({ kind: "number", description, min: SENTINEL, max } as const);

/**
 * The AI response schema. `allowed` lists lock the enumerable dimensions to the
 * real vocabulary so the model cannot invent size/cannabinoid values.
 * Brands/categories/vendors/strains/statuses are free strings validated after.
 */
export const predicateDraftSchema = defineSchema<PredicateDraft>("promotion_selection_predicate", {
  sizes: strArr(
    "Product sizes to include. Use ONLY these buckets by grams: gram=1g, eighth=3.5g, quarter=7g, half=14g, ounce=28g. Empty if size is not mentioned.",
    SIZE_BUCKETS.length,
    SIZE_BUCKETS,
  ),
  categories: strArr(
    "Menu categories to include (e.g. flower, prerolls, edibles, concentrates, vapor). Empty if not mentioned. Use the retailer's own category names.",
    24,
  ),
  strainTypes: strArr(
    "Strain types to include (indica, sativa, hybrid, indica-hybrid, sativa-hybrid, cbd, unknown). Empty if not mentioned.",
    12,
  ),
  brands: strArr("Brand names to include exactly as the manager said them. Empty if not mentioned.", 40),
  vendors: strArr("Vendor / distributor names to include. Empty if not mentioned.", 40),
  nameContains: strArr("Words the product name must contain (OR). Empty if not mentioned.", 12),
  nameExcludes: strArr("Words that, if in the product name, EXCLUDE it. Empty if not mentioned.", 12),
  hasCannabinoid: strArr(
    "Cannabinoids the product must measurably contain (any listed = match). Empty if not mentioned.",
    CANNABINOIDS.length,
    CANNABINOIDS,
  ),

  priceMinDollars: rangeNum("Minimum shelf price in DOLLARS. -1 if not mentioned.", PRICE_MAX_DOLLARS),
  priceMaxDollars: rangeNum("Maximum shelf price in DOLLARS. -1 if not mentioned.", PRICE_MAX_DOLLARS),
  weightMinGrams: rangeNum("Minimum net weight in GRAMS. -1 if not mentioned.", WEIGHT_MAX_GRAMS),
  weightMaxGrams: rangeNum("Maximum net weight in GRAMS. -1 if not mentioned.", WEIGHT_MAX_GRAMS),
  thcMinPercent: rangeNum("Minimum THC percent. -1 if not mentioned.", PCT_MAX),
  thcMaxPercent: rangeNum("Maximum THC percent. -1 if not mentioned.", PCT_MAX),
  cbdMinPercent: rangeNum("Minimum CBD percent. -1 if not mentioned.", PCT_MAX),
  cbdMaxPercent: rangeNum("Maximum CBD percent. -1 if not mentioned.", PCT_MAX),

  ratioProducts: { kind: "boolean", description: "True only if the manager asked for ratio products (e.g. 1:1 THC:CBD)." },
  lowStock: { kind: "boolean", description: "True only if the manager asked for low / running-out stock." },
  lowStockThreshold: rangeNum("Units at or below which a product counts as low stock. -1 for the default.", LOW_STOCK_MAX),
  newArrival: { kind: "boolean", description: "True only if the manager asked for new arrivals / just-added products." },
  onSaleFilter: {
    kind: "enum",
    description:
      "Sale filter: 'only_not_on_sale' if they said things NOT already discounted, 'only_on_sale' if they said things ALREADY on sale, otherwise 'any'.",
    values: ["any", "only_not_on_sale", "only_on_sale"],
  },

  inventoryStatuses: strArr("Inventory statuses to include (e.g. in_stock, low_stock, out_of_stock). Empty if not mentioned.", 8),

  summary: {
    kind: "string",
    description: "One-sentence plain-English restatement of the selection for the manager to confirm.",
    maxLength: 240,
  },
});

/** Case-insensitive membership; returns the CANONICAL vocab value (preserves menu casing). */
function canonicalize(value: string, vocab: readonly string[]): string | null {
  const needle = value.trim().toLowerCase();
  if (!needle) return null;
  const hit = vocab.find((v) => v.toLowerCase() === needle);
  return hit ?? null;
}

/** Keep only vocab-known values (canonicalized); collect dropped ones for a warning. */
function filterToVocab(values: string[], vocab: readonly string[], dropped: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const canon = canonicalize(raw, vocab);
    if (canon == null) {
      const t = raw.trim();
      if (t) dropped.push(t);
      continue;
    }
    if (!seen.has(canon.toLowerCase())) {
      seen.add(canon.toLowerCase());
      out.push(canon);
    }
  }
  return out;
}

/** Trim, drop empties, de-dup (case-insensitive), cap length. */
function cleanStrings(values: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Keep only real size buckets (defense in depth; schema already constrains). */
function keepSizes(values: string[]): SizeBucket[] {
  const set = new Set<string>(SIZE_BUCKETS);
  const out: SizeBucket[] = [];
  for (const v of values) {
    const t = v.trim().toLowerCase();
    if (set.has(t) && !out.includes(t as SizeBucket)) out.push(t as SizeBucket);
  }
  return out;
}

/** Keep only real cannabinoid codes (defense in depth). */
function keepCannabinoids(values: string[]): string[] {
  const set = new Set<string>(CANNABINOIDS);
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim().toLowerCase();
    if (set.has(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

/** A field is "set" when the AI returned something other than the sentinel. */
function num(value: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value <= SENTINEL) return undefined;
  return value;
}

/** Clamp a value into [0, max]; returns undefined if unset. */
function clampNonNeg(value: number, max: number): number | undefined {
  const n = num(value);
  if (n === undefined) return undefined;
  return Math.max(0, Math.min(max, n));
}

export type DraftToPredicateResult = {
  predicate: SelectionPredicate;
  warnings: string[];
  /** true when the draft has no positive condition (would select nothing). */
  empty: boolean;
};

/**
 * Pure transform: AI draft + live menu vocabulary -> validated SelectionPredicate.
 * No I/O. This is where the anti-hallucination guarantees live: unknown
 * brands/categories/vendors/statuses/strains are DROPPED (with a warning),
 * ranges are clamped, and contradictory min>max ranges are removed.
 */
export function draftToPredicate(draft: PredicateDraft, vocab: MenuVocabulary): DraftToPredicateResult {
  const warnings: string[] = [];
  const pred: SelectionPredicate = {};

  // --- enumerable identity dimensions (schema-locked, re-verified here) ---
  const sizes = keepSizes(draft.sizes ?? []);
  if (sizes.length) pred.sizes = sizes;

  const cann = keepCannabinoids(draft.hasCannabinoid ?? []);
  if (cann.length) pred.hasCannabinoid = cann;

  // --- vocabulary-validated string dimensions (drop unknowns) ---
  const droppedBrands: string[] = [];
  const brands = filterToVocab(cleanStrings(draft.brands ?? [], 40), vocab.brands, droppedBrands);
  if (brands.length) pred.brands = brands;
  if (droppedBrands.length) {
    warnings.push(`Ignored ${droppedBrands.length} brand(s) not on the current menu: ${droppedBrands.join(", ")}.`);
  }

  const droppedCats: string[] = [];
  const categories = filterToVocab(cleanStrings(draft.categories ?? [], 24), vocab.categories, droppedCats);
  if (categories.length) pred.categories = categories;
  if (droppedCats.length) {
    warnings.push(`Ignored ${droppedCats.length} category name(s) not on the current menu: ${droppedCats.join(", ")}.`);
  }

  const droppedVendors: string[] = [];
  const vendors = filterToVocab(cleanStrings(draft.vendors ?? [], 40), vocab.vendors, droppedVendors);
  if (vendors.length) pred.vendors = vendors;
  if (droppedVendors.length) {
    warnings.push(`Ignored ${droppedVendors.length} vendor(s) not on the current menu: ${droppedVendors.join(", ")}.`);
  }

  const droppedStrains: string[] = [];
  const strainTypes = vocab.strainTypes.length
    ? filterToVocab(cleanStrings(draft.strainTypes ?? [], 12), vocab.strainTypes, droppedStrains)
    : cleanStrings(draft.strainTypes ?? [], 12);
  if (strainTypes.length) pred.strainTypes = strainTypes;
  if (droppedStrains.length) {
    warnings.push(`Ignored ${droppedStrains.length} strain type(s) not on the current menu: ${droppedStrains.join(", ")}.`);
  }

  const droppedStatuses: string[] = [];
  const statuses = vocab.inventoryStatuses.length
    ? filterToVocab(cleanStrings(draft.inventoryStatuses ?? [], 8), vocab.inventoryStatuses, droppedStatuses)
    : cleanStrings(draft.inventoryStatuses ?? [], 8);
  if (statuses.length) pred.inventoryStatuses = statuses;

  // --- free-text name filters (no vocabulary; passed through cleaned) ---
  const nameContains = cleanStrings(draft.nameContains ?? [], 12);
  if (nameContains.length) pred.nameContains = nameContains;
  const nameExcludes = cleanStrings(draft.nameExcludes ?? [], 12);
  if (nameExcludes.length) pred.nameExcludes = nameExcludes;

  // --- numeric ranges (clamp, then drop contradictions) ---
  const priceMin = clampNonNeg(draft.priceMinDollars, PRICE_MAX_DOLLARS);
  const priceMax = clampNonNeg(draft.priceMaxDollars, PRICE_MAX_DOLLARS);
  if (priceMin !== undefined) pred.priceMinCents = Math.round(priceMin * 100);
  if (priceMax !== undefined) pred.priceMaxCents = Math.round(priceMax * 100);
  if (pred.priceMinCents != null && pred.priceMaxCents != null && pred.priceMinCents > pred.priceMaxCents) {
    warnings.push("Price range was backwards (min above max); dropped the price limits.");
    delete pred.priceMinCents;
    delete pred.priceMaxCents;
  }

  const wMin = clampNonNeg(draft.weightMinGrams, WEIGHT_MAX_GRAMS);
  const wMax = clampNonNeg(draft.weightMaxGrams, WEIGHT_MAX_GRAMS);
  if (wMin !== undefined) pred.weightMinGrams = wMin;
  if (wMax !== undefined) pred.weightMaxGrams = wMax;
  if (pred.weightMinGrams != null && pred.weightMaxGrams != null && pred.weightMinGrams > pred.weightMaxGrams) {
    warnings.push("Weight range was backwards (min above max); dropped the weight limits.");
    delete pred.weightMinGrams;
    delete pred.weightMaxGrams;
  }

  const thcMin = clampNonNeg(draft.thcMinPercent, PCT_MAX);
  const thcMax = clampNonNeg(draft.thcMaxPercent, PCT_MAX);
  if (thcMin !== undefined) pred.thcMinPercent = thcMin;
  if (thcMax !== undefined) pred.thcMaxPercent = thcMax;
  if (pred.thcMinPercent != null && pred.thcMaxPercent != null && pred.thcMinPercent > pred.thcMaxPercent) {
    warnings.push("THC range was backwards (min above max); dropped the THC limits.");
    delete pred.thcMinPercent;
    delete pred.thcMaxPercent;
  }

  const cbdMin = clampNonNeg(draft.cbdMinPercent, PCT_MAX);
  const cbdMax = clampNonNeg(draft.cbdMaxPercent, PCT_MAX);
  if (cbdMin !== undefined) pred.cbdMinPercent = cbdMin;
  if (cbdMax !== undefined) pred.cbdMaxPercent = cbdMax;
  if (pred.cbdMinPercent != null && pred.cbdMaxPercent != null && pred.cbdMinPercent > pred.cbdMaxPercent) {
    warnings.push("CBD range was backwards (min above max); dropped the CBD limits.");
    delete pred.cbdMinPercent;
    delete pred.cbdMaxPercent;
  }

  // --- flags ---
  if (draft.ratioProducts === true) pred.ratioProducts = true;
  if (draft.newArrival === true) pred.newArrival = true;
  if (draft.lowStock === true) {
    pred.lowStock = true;
    const thr = clampNonNeg(draft.lowStockThreshold, LOW_STOCK_MAX);
    if (thr !== undefined && thr > 0) pred.lowStockThreshold = Math.round(thr);
  }
  if (draft.onSaleFilter === "only_on_sale") pred.onSaleAlready = true;
  else if (draft.onSaleFilter === "only_not_on_sale") pred.onSaleAlready = false;

  const empty = !predicateHasPositiveCondition(pred);
  return { predicate: pred, warnings, empty };
}

/* -------------------------------------------------------------------------- */
/* Embedded pure self-tests (transform/clamp logic only — no AI, no I/O).     */
/* Registered in scripts/compliance/run-pure-selftests.ts.                    */
/* -------------------------------------------------------------------------- */

/** Build a full PredicateDraft with all-unset defaults, overridden by `over`. */
function emptyDraft(over: Partial<PredicateDraft>): PredicateDraft {
  const base: PredicateDraft = {
    sizes: [],
    categories: [],
    strainTypes: [],
    brands: [],
    vendors: [],
    nameContains: [],
    nameExcludes: [],
    hasCannabinoid: [],
    priceMinDollars: SENTINEL,
    priceMaxDollars: SENTINEL,
    weightMinGrams: SENTINEL,
    weightMaxGrams: SENTINEL,
    thcMinPercent: SENTINEL,
    thcMaxPercent: SENTINEL,
    cbdMinPercent: SENTINEL,
    cbdMaxPercent: SENTINEL,
    ratioProducts: false,
    lowStock: false,
    lowStockThreshold: SENTINEL,
    newArrival: false,
    onSaleFilter: "any",
    inventoryStatuses: [],
    summary: "",
  };
  return { ...base, ...over };
}

const VOCAB: MenuVocabulary = {
  brands: ["Artizen", "Fairwinds", "Dabstract"],
  categories: ["flower", "prerolls", "edibles", "concentrates"],
  vendors: ["Northwest Cannabis Solutions"],
  strainTypes: ["indica", "sativa", "hybrid", "indica-hybrid", "sativa-hybrid", "cbd", "unknown"],
  inventoryStatuses: ["in_stock", "low_stock", "out_of_stock"],
};

export function __runPromotionSelectorAiTests(): { passed: number; failed: number } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else failures.push(name);
  };

  // 1. Empty draft => empty predicate (fail-safe: selects nothing).
  {
    const r = draftToPredicate(emptyDraft({}), VOCAB);
    ok("empty draft is empty predicate", r.empty === true && Object.keys(r.predicate).length === 0);
  }

  // 2. Known brand kept, unknown brand dropped with warning.
  {
    const r = draftToPredicate(emptyDraft({ brands: ["Artizen", "MadeUpCo"] }), VOCAB);
    ok("known brand kept", r.predicate.brands?.length === 1 && r.predicate.brands[0] === "Artizen");
    ok("unknown brand dropped + warned", r.warnings.some((w) => w.includes("MadeUpCo")));
    ok("brand draft not empty", r.empty === false);
  }

  // 3. Brand canonicalized to menu casing (case-insensitive match).
  {
    const r = draftToPredicate(emptyDraft({ brands: ["artizen"] }), VOCAB);
    ok("brand canonicalized to menu casing", r.predicate.brands?.[0] === "Artizen");
  }

  // 4. Unknown category dropped, known kept.
  {
    const r = draftToPredicate(emptyDraft({ categories: ["flower", "unicorns"] }), VOCAB);
    ok("known category kept", r.predicate.categories?.length === 1 && r.predicate.categories[0] === "flower");
    ok("unknown category warned", r.warnings.some((w) => w.toLowerCase().includes("category")));
  }

  // 5. Sizes: only real buckets kept, order preserved.
  {
    const r = draftToPredicate(emptyDraft({ sizes: ["eighth", "bogus", "ounce"] }), VOCAB);
    ok("valid sizes kept", JSON.stringify(r.predicate.sizes) === JSON.stringify(["eighth", "ounce"]));
  }

  // 6. Cannabinoids: only real codes kept.
  {
    const r = draftToPredicate(emptyDraft({ hasCannabinoid: ["cbg", "xyz", "cbn"] }), VOCAB);
    ok("valid cannabinoids kept", JSON.stringify(r.predicate.hasCannabinoid) === JSON.stringify(["cbg", "cbn"]));
  }

  // 7. Price dollars -> cents.
  {
    const r = draftToPredicate(emptyDraft({ priceMaxDollars: 30 }), VOCAB);
    ok("price dollars to cents", r.predicate.priceMaxCents === 3000 && r.predicate.priceMinCents === undefined);
  }

  // 8. Backwards price range dropped + warned.
  {
    const r = draftToPredicate(emptyDraft({ priceMinDollars: 50, priceMaxDollars: 10 }), VOCAB);
    ok("backwards price dropped", r.predicate.priceMinCents === undefined && r.predicate.priceMaxCents === undefined);
    ok("backwards price warned", r.warnings.some((w) => w.toLowerCase().includes("price range was backwards")));
  }

  // 9. THC min set, sentinel max ignored.
  {
    const r = draftToPredicate(emptyDraft({ thcMinPercent: 25, thcMaxPercent: SENTINEL }), VOCAB);
    ok("thc min kept, max unset", r.predicate.thcMinPercent === 25 && r.predicate.thcMaxPercent === undefined);
  }

  // 10. THC clamped to <= 100.
  {
    const r = draftToPredicate(emptyDraft({ thcMinPercent: 250 }), VOCAB);
    ok("thc clamped to 100", r.predicate.thcMinPercent === 100);
  }

  // 11. onSaleFilter mapping.
  {
    const a = draftToPredicate(emptyDraft({ onSaleFilter: "only_not_on_sale" }), VOCAB);
    const b = draftToPredicate(emptyDraft({ onSaleFilter: "only_on_sale" }), VOCAB);
    const c = draftToPredicate(emptyDraft({ onSaleFilter: "any" }), VOCAB);
    ok("onSale not-on-sale => false", a.predicate.onSaleAlready === false);
    ok("onSale on-sale => true", b.predicate.onSaleAlready === true);
    ok("onSale any => unset", c.predicate.onSaleAlready === undefined);
  }

  // 12. lowStock with threshold.
  {
    const r = draftToPredicate(emptyDraft({ lowStock: true, lowStockThreshold: 5 }), VOCAB);
    ok("lowStock true", r.predicate.lowStock === true && r.predicate.lowStockThreshold === 5);
  }

  // 13. lowStock without threshold => flag only.
  {
    const r = draftToPredicate(emptyDraft({ lowStock: true }), VOCAB);
    ok("lowStock no threshold", r.predicate.lowStock === true && r.predicate.lowStockThreshold === undefined);
  }

  // 14. ratioProducts + newArrival flags.
  {
    const r = draftToPredicate(emptyDraft({ ratioProducts: true, newArrival: true }), VOCAB);
    ok("ratio + newArrival flags", r.predicate.ratioProducts === true && r.predicate.newArrival === true);
  }

  // 15. name filters cleaned + deduped (case-insensitive).
  {
    const r = draftToPredicate(emptyDraft({ nameContains: ["OG", "og", " Kush "], nameExcludes: ["sample"] }), VOCAB);
    ok("nameContains cleaned/deduped", JSON.stringify(r.predicate.nameContains) === JSON.stringify(["OG", "Kush"]));
    ok("nameExcludes kept", JSON.stringify(r.predicate.nameExcludes) === JSON.stringify(["sample"]));
  }

  // 16. Strain type unknown dropped when vocab present.
  {
    const r = draftToPredicate(emptyDraft({ strainTypes: ["indica", "purpleunicorn"] }), VOCAB);
    ok("strain unknown dropped", JSON.stringify(r.predicate.strainTypes) === JSON.stringify(["indica"]));
  }

  // 17. Vendor validation.
  {
    const r = draftToPredicate(
      emptyDraft({ vendors: ["Northwest Cannabis Solutions", "Ghost Distro"] }),
      VOCAB,
    );
    ok("known vendor kept", r.predicate.vendors?.length === 1);
    ok("unknown vendor warned", r.warnings.some((w) => w.includes("Ghost Distro")));
  }

  // 18. Inventory status validation (drop unknown).
  {
    const r = draftToPredicate(emptyDraft({ inventoryStatuses: ["in_stock", "banana"] }), VOCAB);
    ok("valid status kept", JSON.stringify(r.predicate.inventoryStatuses) === JSON.stringify(["in_stock"]));
  }

  // 19. Price floor of 0 is a legitimate value (not treated as unset).
  {
    const r = draftToPredicate(emptyDraft({ priceMinDollars: 0 }), VOCAB);
    ok("price floor 0 kept", r.predicate.priceMinCents === 0);
  }

  // 20. Full realistic request assembles correctly.
  {
    const r = draftToPredicate(
      emptyDraft({ sizes: ["eighth"], strainTypes: ["indica"], priceMaxDollars: 30, onSaleFilter: "only_not_on_sale" }),
      VOCAB,
    );
    ok(
      "realistic request assembled",
      r.predicate.sizes?.[0] === "eighth" &&
        r.predicate.strainTypes?.[0] === "indica" &&
        r.predicate.priceMaxCents === 3000 &&
        r.predicate.onSaleAlready === false &&
        r.empty === false,
    );
  }

  // 21. Empty-vocab passthrough for strains (no drop when vocab unknown).
  {
    const noVocab: MenuVocabulary = { brands: [], categories: [], vendors: [], strainTypes: [], inventoryStatuses: [] };
    const r = draftToPredicate(emptyDraft({ strainTypes: ["indica"] }), noVocab);
    ok("empty strain vocab passthrough", r.predicate.strainTypes?.[0] === "indica");
  }

  // 22. Size label sanity (grams contract).
  ok("eighth is 3.5g label present", SIZE_LABELS.eighth.includes("3.5"));

  // 23. Weight range clamps + valid range kept.
  {
    const r = draftToPredicate(emptyDraft({ weightMinGrams: 3.5, weightMaxGrams: 28 }), VOCAB);
    ok("weight range kept", r.predicate.weightMinGrams === 3.5 && r.predicate.weightMaxGrams === 28);
  }

  // 24. Whitespace-only brand ignored (no false warning).
  {
    const r = draftToPredicate(emptyDraft({ brands: ["   "] }), VOCAB);
    ok("whitespace brand ignored", r.predicate.brands === undefined && r.warnings.length === 0);
  }

  if (failures.length) {
    console.error("promotion-selector-ai self-test failures:", failures.join("; "));
  }
  return { passed, failed: failures.length };
}
