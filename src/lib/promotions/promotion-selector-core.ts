/**
 * src/lib/promotions/promotion-selector-core.ts  —  PR-P2
 *
 * THE DETERMINISTIC SELECTION BRAIN.
 *
 * A pure, side-effect-free resolver that turns a typed SelectionPredicate (a
 * machine-readable filter like "all eighths under $30 over 20% THC, exclude
 * brand X") into the EXACT set of live-menu products it matches — with a plain
 * English reason for every match. No database, no AI, no I/O. This is the piece
 * that guarantees zero hallucinated products: the AI layer (PR-P3) only ever
 * emits a SelectionPredicate; THIS code decides which real products it hits.
 *
 * Design principles (from research/PROMOTIONS_AUDIT/01_DEEP_RESEARCH_AND_ROADMAP.md):
 *   1. PARSE-TO-PREDICATE, RESOLVE DETERMINISTICALLY — the predicate is data;
 *      matching is code we own and test.
 *   2. FAIL-SAFE DEFAULT — an EMPTY or all-null predicate matches NOTHING, never
 *      everything. A promotion must never silently widen because a filter was
 *      blank. (You want "everything"? Use the explicit storewide toggle.)
 *   3. EXCLUSIONS ALWAYS WIN — excludeKeys and the *Excludes fields remove a
 *      product even if a hundred include-conditions matched it.
 *   4. EVERY MATCH IS EXPLAINABLE — resolveSelection returns the human reasons a
 *      product was selected, so the owner can validate before publishing.
 *
 * Attribute vocabulary is grounded in the real menu schema
 * (src/lib/pos/db-types.ts MenuItemRow + MenuVariantRow) and the confirmed size
 * table (gram 1g / eighth 3.5g / quarter 7g / half 14g / ounce 28g). Cannabinoid
 * keys mirror src/lib/pos/draft-injection-core.ts COMPOUND_TYPES.
 */

// ---------------------------------------------------------------------------
// Size vocabulary (owner-confirmed)
// ---------------------------------------------------------------------------

export type SizeBucket = "gram" | "eighth" | "quarter" | "half" | "ounce";

/** Canonical grams per size bucket. */
export const SIZE_GRAMS: Record<SizeBucket, number> = {
  gram: 1,
  eighth: 3.5,
  quarter: 7,
  half: 14,
  ounce: 28,
};

/** Human labels for size buckets (UI + reasons). */
export const SIZE_LABELS: Record<SizeBucket, string> = {
  gram: "Gram (1g)",
  eighth: "Eighth (3.5g)",
  quarter: "Quarter (7g)",
  half: "Half ounce (14g)",
  ounce: "Ounce (28g)",
};

export const SIZE_BUCKETS: SizeBucket[] = ["gram", "eighth", "quarter", "half", "ounce"];

/**
 * How close a product's net weight must be to a bucket's canonical grams to
 * count as that size. Vendors round (3.5g listed as 3.54g, ounces as 28.35g),
 * so we allow a small tolerance rather than exact equality.
 */
const SIZE_TOLERANCE_GRAMS = 0.35;

/** Words that appear in a variant/size label for each bucket (case-insensitive). */
const SIZE_LABEL_WORDS: Record<SizeBucket, string[]> = {
  gram: ["1g", "gram", "1 g", "1.0g"],
  eighth: ["eighth", "1/8", "3.5g", "3.5 g", "8th"],
  quarter: ["quarter", "1/4", "7g", "7 g"],
  half: ["half", "1/2", "14g", "14 g", "half ounce", "half oz"],
  ounce: ["ounce", "1oz", "1 oz", "28g", "28 g", "full oz", "one oz"],
};

// ---------------------------------------------------------------------------
// Cannabinoid vocabulary (mirrors draft-injection-core COMPOUND_TYPES)
// ---------------------------------------------------------------------------

export type Cannabinoid = "thc" | "thca" | "cbd" | "cbda" | "cbg" | "cbn" | "cbc" | "cbdv";

export const CANNABINOIDS: Cannabinoid[] = ["thc", "thca", "cbd", "cbda", "cbg", "cbn", "cbc", "cbdv"];

export const CANNABINOID_LABELS: Record<Cannabinoid, string> = {
  thc: "THC",
  thca: "THCA",
  cbd: "CBD",
  cbda: "CBDA",
  cbg: "CBG",
  cbn: "CBN",
  cbc: "CBC",
  cbdv: "CBDV",
};

// ---------------------------------------------------------------------------
// The normalized product the resolver reads
// ---------------------------------------------------------------------------

/**
 * A single measured cannabinoid reading on a product ({type:"cbn", value:100,
 * unit:"mg"}). Value is numeric here (the resolver pre-parses the string form
 * from compounds_json). Absent = "not verified", which we treat as "does not
 * have a measurable amount" for hasCannabinoid.
 */
export type SelectableCompound = { type: string; value: number; unit: string };

/**
 * The menu product in the shape the selector needs. Built from a
 * MenuItemWithVariants by the store adapter (listSelectableProducts). Kept flat
 * and numeric so matching is trivial and testable. All potency numbers are
 * PERCENT for flower-style and left null when unknown.
 */
export type SelectableProduct = {
  key: string;
  name: string;
  brand: string;
  vendor: string;
  categories: string[]; // filter_categories, else [category]
  strainType: string; // indica/sativa/hybrid/indica-hybrid/sativa-hybrid/cbd/unknown
  strainName: string | null;
  priceMinorUnits: number;
  netWeightGrams: number | null;
  /** Variant/size labels present on the product (e.g. ["Eighth","Ounce"]). */
  variantLabels: string[];
  /** Lowest variant inventory level (for lowStock), null if unknown. */
  minInventoryLevel: number | null;
  thcPercent: number | null;
  cbdPercent: number | null;
  /** Measured cannabinoids from compounds_json (value already numeric). */
  compounds: SelectableCompound[];
  ratioLabel: string | null;
  inventoryStatus: string;
  /** Caller-supplied: is this product ALREADY inside an active promotion? */
  onSaleAlready?: boolean;
  /** Caller-supplied: is this a new arrival? (store adapter's heuristic). */
  newArrival?: boolean;
};

// ---------------------------------------------------------------------------
// The predicate — a typed, JSON-safe filter (AI-emittable in PR-P3)
// ---------------------------------------------------------------------------

/**
 * A SelectionPredicate is AND across kinds, OR within a kind's list. Example:
 * {sizes:["eighth","quarter"], categories:["flower"], thcMinPercent:20} means
 * "flower that is an eighth OR a quarter, AND at least 20% THC". Every field is
 * optional; a predicate with no positive condition matches NOTHING (fail-safe).
 */
export type SelectionPredicate = {
  // --- product identity ---
  sizes?: SizeBucket[];
  categories?: string[];
  strainTypes?: string[];
  brands?: string[];
  vendors?: string[];
  nameContains?: string[]; // any (OR)
  nameExcludes?: string[]; // any match => excluded

  // --- numeric ranges ---
  priceMinCents?: number;
  priceMaxCents?: number;
  weightMinGrams?: number;
  weightMaxGrams?: number;
  thcMinPercent?: number;
  thcMaxPercent?: number;
  cbdMinPercent?: number;
  cbdMaxPercent?: number;

  // --- cannabinoids ---
  hasCannabinoid?: string[]; // any measurable amount of ANY listed (OR)
  ratioProducts?: boolean; // has a ratio label like "1:1"

  // --- inventory / creative flags ---
  inventoryStatuses?: string[];
  lowStock?: boolean;
  lowStockThreshold?: number; // default 10
  onSaleAlready?: boolean; // true => only already-on-sale; false => only NOT
  newArrival?: boolean;

  // --- hard overrides (always win) ---
  includeKeys?: string[]; // force-include these product keys
  excludeKeys?: string[]; // force-exclude these product keys
};

const DEFAULT_LOW_STOCK = 10;

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export type SelectionMatch = {
  key: string;
  name: string;
  brand: string;
  priceMinorUnits: number;
  /** Plain-English reasons this product matched (validation-friendly). */
  reasons: string[];
};

export type SelectionResult = {
  matched: SelectionMatch[];
  /** Count of products considered but not matched. */
  skippedCount: number;
  /** Non-fatal advisories (empty predicate, zero results, very broad, etc). */
  warnings: string[];
  /** True when the predicate had no positive condition (matched nothing). */
  predicateEmpty: boolean;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function ci(s: string): string {
  return s.trim().toLowerCase();
}

function listHasCi(list: string[] | undefined, value: string): boolean {
  if (!list || list.length === 0) return false;
  const v = ci(value);
  return list.some((x) => ci(x) === v);
}

function anyContainsCi(needles: string[] | undefined, hay: string): boolean {
  if (!needles || needles.length === 0) return false;
  const h = ci(hay);
  return needles.some((n) => n.trim() && h.includes(ci(n)));
}

/** Does the product match a given size bucket (by net weight OR variant label)? */
function matchesSize(p: SelectableProduct, bucket: SizeBucket): boolean {
  const grams = SIZE_GRAMS[bucket];
  if (p.netWeightGrams != null && Math.abs(p.netWeightGrams - grams) <= SIZE_TOLERANCE_GRAMS) {
    return true;
  }
  const words = SIZE_LABEL_WORDS[bucket];
  return p.variantLabels.some((label) => {
    const l = ci(label);
    return words.some((w) => l.includes(ci(w)));
  });
}

/** Highest measured amount of a cannabinoid type (0 if absent). */
function cannabinoidAmount(p: SelectableProduct, type: string): number {
  const t = ci(type);
  let max = 0;
  // thc/cbd may live in the percent fields too.
  if (t === "thc" && p.thcPercent != null) max = Math.max(max, p.thcPercent);
  if (t === "cbd" && p.cbdPercent != null) max = Math.max(max, p.cbdPercent);
  for (const c of p.compounds) {
    if (ci(c.type) === t && Number.isFinite(c.value)) max = Math.max(max, c.value);
  }
  return max;
}

/** A predicate has at least one POSITIVE selection condition. */
export function predicateHasPositiveCondition(pred: SelectionPredicate): boolean {
  return Boolean(
    (pred.sizes && pred.sizes.length) ||
      (pred.categories && pred.categories.length) ||
      (pred.strainTypes && pred.strainTypes.length) ||
      (pred.brands && pred.brands.length) ||
      (pred.vendors && pred.vendors.length) ||
      (pred.nameContains && pred.nameContains.length) ||
      pred.priceMinCents != null ||
      pred.priceMaxCents != null ||
      pred.weightMinGrams != null ||
      pred.weightMaxGrams != null ||
      pred.thcMinPercent != null ||
      pred.thcMaxPercent != null ||
      pred.cbdMinPercent != null ||
      pred.cbdMaxPercent != null ||
      (pred.hasCannabinoid && pred.hasCannabinoid.length) ||
      pred.ratioProducts === true ||
      (pred.inventoryStatuses && pred.inventoryStatuses.length) ||
      pred.lowStock === true ||
      pred.onSaleAlready != null ||
      pred.newArrival === true ||
      (pred.includeKeys && pred.includeKeys.length),
  );
}

// ---------------------------------------------------------------------------
// The matcher — returns reasons, or null when the product does not match
// ---------------------------------------------------------------------------

/**
 * Evaluate ONE product against the predicate. Returns the list of match reasons
 * (non-empty => matched) or null (did not match / was excluded). includeKeys is
 * a hard include that still respects excludes (excludes always win).
 */
export function matchProduct(p: SelectableProduct, pred: SelectionPredicate): string[] | null {
  // Hard exclude wins over everything.
  if (listHasCi(pred.excludeKeys, p.key)) return null;
  if (anyContainsCi(pred.nameExcludes, `${p.brand} ${p.name}`)) return null;

  // Hard include short-circuits (still validated against excludes above).
  if (listHasCi(pred.includeKeys, p.key)) return ["Hand-picked (explicit include)"];

  const reasons: string[] = [];

  // sizes (OR within, must satisfy the kind if present)
  if (pred.sizes && pred.sizes.length) {
    const hit = pred.sizes.find((b) => matchesSize(p, b));
    if (!hit) return null;
    reasons.push(`Size: ${SIZE_LABELS[hit]}`);
  }

  // categories (OR within)
  if (pred.categories && pred.categories.length) {
    const hit = pred.categories.find((c) => p.categories.some((pc) => ci(pc) === ci(c)));
    if (!hit) return null;
    reasons.push(`Category: ${hit}`);
  }

  // strain types (OR within)
  if (pred.strainTypes && pred.strainTypes.length) {
    if (!listHasCi(pred.strainTypes, p.strainType)) return null;
    reasons.push(`Strain type: ${p.strainType}`);
  }

  // brands (OR within)
  if (pred.brands && pred.brands.length) {
    if (!listHasCi(pred.brands, p.brand)) return null;
    reasons.push(`Brand: ${p.brand}`);
  }

  // vendors (OR within)
  if (pred.vendors && pred.vendors.length) {
    if (!listHasCi(pred.vendors, p.vendor)) return null;
    reasons.push(`Vendor: ${p.vendor}`);
  }

  // name contains (OR within)
  if (pred.nameContains && pred.nameContains.length) {
    if (!anyContainsCi(pred.nameContains, `${p.brand} ${p.name}`)) return null;
    reasons.push(`Name matches "${pred.nameContains.join('", "')}"`);
  }

  // price range
  if (pred.priceMinCents != null) {
    if (p.priceMinorUnits < pred.priceMinCents) return null;
    reasons.push(`Price ≥ $${(pred.priceMinCents / 100).toFixed(2)}`);
  }
  if (pred.priceMaxCents != null) {
    if (p.priceMinorUnits > pred.priceMaxCents) return null;
    reasons.push(`Price ≤ $${(pred.priceMaxCents / 100).toFixed(2)}`);
  }

  // weight range
  if (pred.weightMinGrams != null) {
    if (p.netWeightGrams == null || p.netWeightGrams < pred.weightMinGrams) return null;
    reasons.push(`Weight ≥ ${pred.weightMinGrams}g`);
  }
  if (pred.weightMaxGrams != null) {
    if (p.netWeightGrams == null || p.netWeightGrams > pred.weightMaxGrams) return null;
    reasons.push(`Weight ≤ ${pred.weightMaxGrams}g`);
  }

  // THC range
  if (pred.thcMinPercent != null) {
    if (p.thcPercent == null || p.thcPercent < pred.thcMinPercent) return null;
    reasons.push(`THC ≥ ${pred.thcMinPercent}%`);
  }
  if (pred.thcMaxPercent != null) {
    if (p.thcPercent == null || p.thcPercent > pred.thcMaxPercent) return null;
    reasons.push(`THC ≤ ${pred.thcMaxPercent}%`);
  }

  // CBD range
  if (pred.cbdMinPercent != null) {
    if (p.cbdPercent == null || p.cbdPercent < pred.cbdMinPercent) return null;
    reasons.push(`CBD ≥ ${pred.cbdMinPercent}%`);
  }
  if (pred.cbdMaxPercent != null) {
    if (p.cbdPercent == null || p.cbdPercent > pred.cbdMaxPercent) return null;
    reasons.push(`CBD ≤ ${pred.cbdMaxPercent}%`);
  }

  // has cannabinoid (OR within — any measurable amount)
  if (pred.hasCannabinoid && pred.hasCannabinoid.length) {
    const hit = pred.hasCannabinoid.find((c) => cannabinoidAmount(p, c) > 0);
    if (!hit) return null;
    const label = CANNABINOID_LABELS[ci(hit) as Cannabinoid] ?? hit.toUpperCase();
    reasons.push(`Contains ${label}`);
  }

  // ratio products
  if (pred.ratioProducts === true) {
    if (!p.ratioLabel || !/\d\s*:\s*\d/.test(p.ratioLabel)) return null;
    reasons.push(`Ratio product (${p.ratioLabel})`);
  }

  // inventory statuses (OR within)
  if (pred.inventoryStatuses && pred.inventoryStatuses.length) {
    if (!listHasCi(pred.inventoryStatuses, p.inventoryStatus)) return null;
    reasons.push(`Inventory: ${p.inventoryStatus}`);
  }

  // low stock
  if (pred.lowStock === true) {
    const threshold = pred.lowStockThreshold ?? DEFAULT_LOW_STOCK;
    if (p.minInventoryLevel == null || p.minInventoryLevel > threshold) return null;
    reasons.push(`Low stock (≤ ${threshold})`);
  }

  // on sale already (true => only on-sale; false => only NOT on-sale)
  if (pred.onSaleAlready != null) {
    const flag = p.onSaleAlready === true;
    if (flag !== pred.onSaleAlready) return null;
    reasons.push(pred.onSaleAlready ? "Already on sale" : "Not currently on sale");
  }

  // new arrival
  if (pred.newArrival === true) {
    if (p.newArrival !== true) return null;
    reasons.push("New arrival");
  }

  // If we got here with no reasons, the predicate had no positive condition for
  // this product path — fail safe: match nothing.
  if (reasons.length === 0) return null;
  return reasons;
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a predicate against a live menu into the exact matched products with
 * reasons. Fail-safe: an empty predicate matches nothing. Adds advisory
 * warnings for zero-result and very-broad selections so the UI can prompt the
 * owner before publishing.
 */
export function resolveSelection(
  products: SelectableProduct[],
  pred: SelectionPredicate,
): SelectionResult {
  const warnings: string[] = [];
  const empty = !predicateHasPositiveCondition(pred);

  if (empty) {
    warnings.push(
      "This rule has no conditions, so it selects no products. Add at least one condition (or use the Storewide toggle for an everything sale).",
    );
    return { matched: [], skippedCount: products.length, warnings, predicateEmpty: true };
  }

  const matched: SelectionMatch[] = [];
  for (const p of products) {
    const reasons = matchProduct(p, pred);
    if (reasons) {
      matched.push({
        key: p.key,
        name: p.name,
        brand: p.brand,
        priceMinorUnits: p.priceMinorUnits,
        reasons,
      });
    }
  }

  if (matched.length === 0) {
    warnings.push("This rule matched no products in the current menu. Loosen the conditions or check the menu is published.");
  } else if (products.length > 0 && matched.length === products.length) {
    warnings.push(
      "This rule matches EVERY product in the menu. If you meant a storewide sale, use the Storewide toggle; otherwise tighten the conditions.",
    );
  } else if (products.length >= 20 && matched.length / products.length >= 0.8) {
    warnings.push("This rule matches most of the menu (80%+). Double-check that's intended before publishing.");
  }

  return {
    matched,
    skippedCount: products.length - matched.length,
    warnings,
    predicateEmpty: false,
  };
}

// ---------------------------------------------------------------------------
// Plain-English restatement (owner validation + AI self-check groundwork)
// ---------------------------------------------------------------------------

/** Restate a predicate as a single readable sentence for the owner to confirm. */
export function describePredicate(pred: SelectionPredicate): string {
  if (!predicateHasPositiveCondition(pred)) return "No products (this rule has no conditions).";

  const clauses: string[] = [];
  if (pred.categories?.length) clauses.push(`category is ${pred.categories.join(" or ")}`);
  if (pred.sizes?.length) clauses.push(`size is ${pred.sizes.map((s) => SIZE_LABELS[s]).join(" or ")}`);
  if (pred.strainTypes?.length) clauses.push(`strain is ${pred.strainTypes.join(" or ")}`);
  if (pred.brands?.length) clauses.push(`brand is ${pred.brands.join(" or ")}`);
  if (pred.vendors?.length) clauses.push(`vendor is ${pred.vendors.join(" or ")}`);
  if (pred.nameContains?.length) clauses.push(`name contains "${pred.nameContains.join('" or "')}"`);
  if (pred.priceMinCents != null) clauses.push(`price at least $${(pred.priceMinCents / 100).toFixed(2)}`);
  if (pred.priceMaxCents != null) clauses.push(`price at most $${(pred.priceMaxCents / 100).toFixed(2)}`);
  if (pred.weightMinGrams != null) clauses.push(`weight at least ${pred.weightMinGrams}g`);
  if (pred.weightMaxGrams != null) clauses.push(`weight at most ${pred.weightMaxGrams}g`);
  if (pred.thcMinPercent != null) clauses.push(`THC at least ${pred.thcMinPercent}%`);
  if (pred.thcMaxPercent != null) clauses.push(`THC at most ${pred.thcMaxPercent}%`);
  if (pred.cbdMinPercent != null) clauses.push(`CBD at least ${pred.cbdMinPercent}%`);
  if (pred.cbdMaxPercent != null) clauses.push(`CBD at most ${pred.cbdMaxPercent}%`);
  if (pred.hasCannabinoid?.length)
    clauses.push(`contains ${pred.hasCannabinoid.map((c) => CANNABINOID_LABELS[ci(c) as Cannabinoid] ?? c.toUpperCase()).join(" or ")}`);
  if (pred.ratioProducts) clauses.push("is a ratio product (e.g. 1:1)");
  if (pred.inventoryStatuses?.length) clauses.push(`inventory status is ${pred.inventoryStatuses.join(" or ")}`);
  if (pred.lowStock) clauses.push(`low stock (≤ ${pred.lowStockThreshold ?? DEFAULT_LOW_STOCK})`);
  if (pred.onSaleAlready === true) clauses.push("already on sale");
  if (pred.onSaleAlready === false) clauses.push("not currently on sale");
  if (pred.newArrival) clauses.push("is a new arrival");
  if (pred.includeKeys?.length) clauses.push(`plus ${pred.includeKeys.length} hand-picked product(s)`);

  let sentence = `Select products where ${clauses.join(", and ")}`;
  if (pred.nameExcludes?.length) sentence += `, excluding names containing "${pred.nameExcludes.join('" or "')}"`;
  if (pred.excludeKeys?.length) sentence += `, minus ${pred.excludeKeys.length} hand-excluded product(s)`;
  return sentence + ".";
}

// ---------------------------------------------------------------------------
// Embedded pure self-tests
// ---------------------------------------------------------------------------

function makeProduct(over: Partial<SelectableProduct> = {}): SelectableProduct {
  // Base defaults, then spread `over` so explicit values (incl. null) win —
  // using `??` here would let a deliberate null (e.g. "no THC verified")
  // silently fall back to the default, which broke a test.
  const base: SelectableProduct = {
    key: "k1",
    name: "Blue Dream",
    brand: "Lifted",
    vendor: "Grow Co",
    categories: ["flower"],
    strainType: "hybrid",
    strainName: "Blue Dream",
    priceMinorUnits: 3000,
    netWeightGrams: 3.5,
    variantLabels: ["Eighth"],
    minInventoryLevel: 50,
    thcPercent: 22,
    cbdPercent: 0.1,
    compounds: [],
    ratioLabel: null,
    inventoryStatus: "in_stock",
  };
  return { ...base, ...over };
}

export function __runPromotionSelectorTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`promotion-selector-core FAIL: ${msg}`);
    }
  };

  // FAIL-SAFE: empty predicate matches nothing.
  {
    const menu = [makeProduct(), makeProduct({ key: "k2" })];
    const r = resolveSelection(menu, {});
    ok(r.matched.length === 0, "empty predicate matches nothing");
    ok(r.predicateEmpty === true, "empty predicate flagged");
    ok(r.warnings.length > 0, "empty predicate warns");
  }

  // sizes: net-weight tolerance
  {
    const eighth = makeProduct({ key: "e", netWeightGrams: 3.54, variantLabels: [] });
    const ounce = makeProduct({ key: "o", netWeightGrams: 28.0, variantLabels: [] });
    const r = resolveSelection([eighth, ounce], { sizes: ["eighth"] });
    ok(r.matched.length === 1 && r.matched[0].key === "e", "eighth matches by net weight tolerance");
    const r2 = resolveSelection([eighth, ounce], { sizes: ["ounce"] });
    ok(r2.matched.length === 1 && r2.matched[0].key === "o", "ounce matches by net weight");
  }

  // sizes: variant label fallback
  {
    const p = makeProduct({ key: "lbl", netWeightGrams: null, variantLabels: ["1/4 oz Quarter"] });
    const r = resolveSelection([p], { sizes: ["quarter"] });
    ok(r.matched.length === 1, "quarter matches by variant label");
    const rMiss = resolveSelection([p], { sizes: ["ounce"] });
    ok(rMiss.matched.length === 0, "quarter label does not match ounce");
  }

  // categories OR
  {
    const flower = makeProduct({ key: "f", categories: ["flower"] });
    const edible = makeProduct({ key: "ed", categories: ["edible-solid"] });
    const r = resolveSelection([flower, edible], { categories: ["edible-solid"] });
    ok(r.matched.length === 1 && r.matched[0].key === "ed", "category filter");
  }

  // brand + exclude brand-name via nameExcludes
  {
    const a = makeProduct({ key: "a", brand: "Lifted", name: "OG Kush" });
    const b = makeProduct({ key: "b", brand: "Lifted", name: "Sample Tester" });
    const r = resolveSelection([a, b], { brands: ["Lifted"], nameExcludes: ["Sample"] });
    ok(r.matched.length === 1 && r.matched[0].key === "a", "nameExcludes carves out sample");
  }

  // excludeKeys always wins even with includeKeys
  {
    const p = makeProduct({ key: "x" });
    const r = resolveSelection([p], { includeKeys: ["x"], excludeKeys: ["x"] });
    ok(r.matched.length === 0, "excludeKeys beats includeKeys");
  }

  // includeKeys hard-picks
  {
    const p = makeProduct({ key: "hp", thcPercent: 1 });
    const r = resolveSelection([p], { includeKeys: ["hp"], thcMinPercent: 90 });
    ok(r.matched.length === 1 && r.matched[0].reasons[0].includes("Hand-picked"), "includeKeys short-circuits");
  }

  // THC range
  {
    const hi = makeProduct({ key: "hi", thcPercent: 30 });
    const lo = makeProduct({ key: "lo", thcPercent: 10 });
    const unk = makeProduct({ key: "u", thcPercent: null });
    const r = resolveSelection([hi, lo, unk], { thcMinPercent: 20 });
    ok(r.matched.length === 1 && r.matched[0].key === "hi", "thcMin filters + null excluded");
  }

  // price range (cents)
  {
    const cheap = makeProduct({ key: "c", priceMinorUnits: 1500 });
    const dear = makeProduct({ key: "d", priceMinorUnits: 5000 });
    const r = resolveSelection([cheap, dear], { priceMaxCents: 2000 });
    ok(r.matched.length === 1 && r.matched[0].key === "c", "priceMax filters");
  }

  // hasCannabinoid: measurable CBN via compounds
  {
    const withCbn = makeProduct({ key: "cbn", compounds: [{ type: "cbn", value: 100, unit: "mg" }] });
    const without = makeProduct({ key: "no", compounds: [] });
    const r = resolveSelection([withCbn, without], { hasCannabinoid: ["cbn"] });
    ok(r.matched.length === 1 && r.matched[0].key === "cbn", "hasCannabinoid CBN");
    // thc/cbd via percent fields count as measurable
    const thcOnly = makeProduct({ key: "t", thcPercent: 20, compounds: [] });
    const r2 = resolveSelection([thcOnly], { hasCannabinoid: ["thc"] });
    ok(r2.matched.length === 1, "hasCannabinoid THC via percent field");
  }

  // ratio products
  {
    const ratio = makeProduct({ key: "r", ratioLabel: "1:1" });
    const notRatio = makeProduct({ key: "n", ratioLabel: "High THC" });
    const r = resolveSelection([ratio, notRatio], { ratioProducts: true });
    ok(r.matched.length === 1 && r.matched[0].key === "r", "ratioProducts detects colon ratio");
  }

  // low stock
  {
    const low = makeProduct({ key: "low", minInventoryLevel: 3 });
    const stocked = makeProduct({ key: "ok", minInventoryLevel: 100 });
    const r = resolveSelection([low, stocked], { lowStock: true, lowStockThreshold: 10 });
    ok(r.matched.length === 1 && r.matched[0].key === "low", "lowStock threshold");
  }

  // onSaleAlready both directions
  {
    const on = makeProduct({ key: "on", onSaleAlready: true });
    const off = makeProduct({ key: "off", onSaleAlready: false });
    ok(resolveSelection([on, off], { onSaleAlready: true }).matched[0]?.key === "on", "onSaleAlready true");
    ok(resolveSelection([on, off], { onSaleAlready: false }).matched[0]?.key === "off", "onSaleAlready false");
  }

  // AND across kinds
  {
    const good = makeProduct({ key: "g", categories: ["flower"], thcPercent: 25, netWeightGrams: 3.5 });
    const wrongCat = makeProduct({ key: "wc", categories: ["edible-solid"], thcPercent: 25, netWeightGrams: 3.5 });
    const lowThc = makeProduct({ key: "lt", categories: ["flower"], thcPercent: 10, netWeightGrams: 3.5 });
    const r = resolveSelection([good, wrongCat, lowThc], {
      categories: ["flower"],
      thcMinPercent: 20,
      sizes: ["eighth"],
    });
    ok(r.matched.length === 1 && r.matched[0].key === "g", "AND across category+thc+size");
    ok(r.matched[0].reasons.length === 3, "three reasons recorded");
  }

  // very-broad warning
  {
    const menu = Array.from({ length: 25 }, (_, i) => makeProduct({ key: `b${i}`, categories: ["flower"] }));
    const r = resolveSelection(menu, { categories: ["flower"] });
    ok(r.matched.length === 25 && r.warnings.some((w) => w.includes("EVERY")), "matches-all warning");
  }

  // zero-result warning
  {
    const r = resolveSelection([makeProduct()], { brands: ["Nonexistent"] });
    ok(r.matched.length === 0 && r.warnings.some((w) => w.includes("no products")), "zero-result warning");
  }

  // describePredicate is readable and non-empty
  {
    const s = describePredicate({ categories: ["flower"], sizes: ["ounce"], thcMinPercent: 20 });
    ok(s.includes("flower") && s.includes("Ounce") && s.includes("THC"), "describePredicate readable");
    ok(describePredicate({}).includes("no conditions"), "describePredicate empty");
  }

  return { passed, failed };
}
