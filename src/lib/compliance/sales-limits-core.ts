/**
 * src/lib/compliance/sales-limits-core.ts
 *
 * Slice 34 (Feature S) — CCRS sales-limits window. PURE logic (no server-only,
 * no DB). Models the WA single-transaction limits from WAC 314-55-095
 * (effective 1/7/2025) and RCW 69.50.360, and evaluates a cart against them so
 * the POS can warn / block before an over-limit sale.
 *
 * Four legal "buckets" with their recreational single-transaction maximums:
 *   - usable        : 1 ounce useable cannabis            = 28 g   (flower-equivalent)
 *   - solid_edible  : 16 ounces solid infused             = 453.592 g
 *   - concentrate   : 7 grams extract/concentrate inhale  = 7 g
 *   - liquid_edible : 72 ounces liquid infused            = 2041.166 g (≈ ml)
 *
 * Medical patients in the DOH database get the higher maximums:
 *   3 oz usable, 48 oz solid, 21 g concentrate, 216 oz liquid.
 *
 * Each cart line carries a website category + quantity. We map the category to
 * a bucket and a per-unit weight contribution (grams), then sum per bucket and
 * compare to the active maximum. Weight-equivalents per unit are CONFIGURABLE
 * by the owner (they vary by product) — these defaults are conservative.
 *
 * NOTE: This is an in-transaction limit (per RCW 69.50.360), which CCRS / LCB
 * enforce per sale. We deliberately do not invent a rolling "daily" window the
 * statute doesn't define; the configurable settings let the owner tighten it.
 */

export const GRAMS_PER_OUNCE = 28; // WA statute treats 1 oz useable = 28 g.

/** The four statutory limit buckets. */
export type LimitBucket = "usable" | "solid_edible" | "concentrate" | "liquid_edible";

export const LIMIT_BUCKETS: readonly LimitBucket[] = [
  "usable",
  "solid_edible",
  "concentrate",
  "liquid_edible",
] as const;

export const LIMIT_BUCKET_LABELS: Record<LimitBucket, string> = {
  usable: "Useable cannabis (flower-equivalent)",
  solid_edible: "Solid infused edibles",
  concentrate: "Concentrate / extract for inhalation",
  liquid_edible: "Liquid infused products",
};

/** Statutory single-transaction maximums, expressed in GRAMS. */
export type LimitProfile = {
  usable: number;
  solid_edible: number;
  concentrate: number;
  liquid_edible: number;
};

/** Recreational (21+) single-transaction limits — WAC 314-55-095(1)(d). */
export const RECREATIONAL_LIMITS: LimitProfile = {
  usable: 1 * GRAMS_PER_OUNCE, // 28 g (1 oz)
  solid_edible: 16 * GRAMS_PER_OUNCE, // 453.6 g (16 oz)
  concentrate: 7, // 7 g
  liquid_edible: 72 * GRAMS_PER_OUNCE, // 2016 g (72 oz)
};

/** Medical (in DOH database) single-transaction limits — WAC 314-55-095(2)(d). */
export const MEDICAL_LIMITS: LimitProfile = {
  usable: 3 * GRAMS_PER_OUNCE, // 84 g (3 oz)
  solid_edible: 48 * GRAMS_PER_OUNCE, // 1360.8 g (48 oz)
  concentrate: 21, // 21 g
  liquid_edible: 216 * GRAMS_PER_OUNCE, // 6048 g (216 oz)
};

/**
 * Map a website category slug to a statutory bucket. Non-cannabis categories
 * (accessories, merch, paraphernalia) map to null = not limited.
 */
export function categoryToBucket(category: string | null | undefined): LimitBucket | null {
  const c = (category ?? "").trim().toLowerCase();
  switch (c) {
    // Flower / useable cannabis
    case "flower":
    case "popcorn-bud":
    case "infused-flower":
    case "trim":
    case "preroll":
    case "blunt":
    case "preroll-pack":
    case "infused-preroll":
    case "infused-blunt":
    case "infused-preroll-pack":
      return "usable";
    // Concentrate / extract for inhalation
    case "cartridge":
    case "disposable-cartridge":
    case "concentrate":
    case "rso":
      return "concentrate";
    // Solid edibles
    case "edible-solid":
      return "solid_edible";
    // Liquid edibles / tinctures
    case "edible-liquid":
    case "tincture":
      return "liquid_edible";
    // Topicals are infused liquid for limit purposes (applied to skin).
    case "topical":
      return "liquid_edible";
    // Accessories / merch / non-cannabis: not limited.
    case "accessories":
    case "merch":
    case "paraphernalia":
      return null;
    default:
      return null;
  }
}

/**
 * The category slugs that map into each statutory bucket, derived by inverting
 * categoryToBucket() over the full known taxonomy. Used by the read-only staff
 * reference so budtenders can see exactly which products count toward which
 * limit. GROUNDED: the slug list mirrors DEFAULT_UNIT_GRAMS + categoryToBucket's
 * own switch — no invented categories.
 */
export const ALL_LIMIT_CATEGORY_SLUGS: readonly string[] = [
  "flower",
  "popcorn-bud",
  "infused-flower",
  "trim",
  "preroll",
  "blunt",
  "preroll-pack",
  "infused-preroll",
  "infused-blunt",
  "infused-preroll-pack",
  "cartridge",
  "disposable-cartridge",
  "concentrate",
  "rso",
  "edible-solid",
  "edible-liquid",
  "tincture",
  "topical",
] as const;

/** Group the known category slugs by the bucket they count toward. */
export function bucketCategories(): Record<LimitBucket, string[]> {
  const out: Record<LimitBucket, string[]> = {
    usable: [],
    solid_edible: [],
    concentrate: [],
    liquid_edible: [],
  };
  for (const slug of ALL_LIMIT_CATEGORY_SLUGS) {
    const bucket = categoryToBucket(slug);
    if (bucket) out[bucket].push(slug);
  }
  return out;
}

/**
 * Default grams-equivalent contributed by ONE unit of a given category. These
 * are conservative defaults the owner can override per-category in settings.
 * For useable: a typical retail unit is 3.5 g; prerolls ~1 g; packs larger.
 */
export const DEFAULT_UNIT_GRAMS: Record<string, number> = {
  flower: 3.5,
  "popcorn-bud": 3.5,
  "infused-flower": 1,
  trim: 7,
  preroll: 1,
  blunt: 1.5,
  "preroll-pack": 5,
  "infused-preroll": 1,
  "infused-blunt": 1.5,
  "infused-preroll-pack": 5,
  cartridge: 1,
  "disposable-cartridge": 1,
  concentrate: 1,
  rso: 1,
  "edible-solid": 28, // 1 oz package
  "edible-liquid": 28, // ~1 oz / 28 ml unit
  tincture: 28,
  topical: 28,
};

export type LimitOverrides = Partial<LimitProfile> & {
  /** Per-category grams-per-unit overrides keyed by category slug. */
  unitGrams?: Record<string, number>;
};

/** A minimal cart line for limit evaluation. */
export type LimitCartLine = {
  category: string | null;
  quantity: number;
  /** Optional explicit grams for this whole line (overrides per-unit math). */
  grams?: number | null;
};

export type BucketUsage = {
  bucket: LimitBucket;
  label: string;
  /** Grams consumed by the cart in this bucket. */
  usedGrams: number;
  /** Statutory/owner maximum grams for this bucket. */
  maxGrams: number;
  /** usedGrams / maxGrams, clamped 0..(can exceed 1 when over). */
  ratio: number;
  overBy: number; // grams over the max (0 when within limit)
  exceeded: boolean;
};

export type LimitEvaluation = {
  customerType: "recreational" | "medical";
  buckets: BucketUsage[];
  /** True if ANY bucket is over its maximum. */
  blocked: boolean;
  /** Human-readable reasons for each exceeded bucket. */
  reasons: string[];
  /** Untracked (non-cannabis) line count, for transparency. */
  untrackedLines: number;
};

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function gramsToOunces(g: number): number {
  return round3(g / GRAMS_PER_OUNCE);
}

/** Resolve the active limit profile, applying owner overrides. */
export function resolveLimits(
  customerType: "recreational" | "medical",
  overrides?: LimitOverrides,
): LimitProfile {
  const base = customerType === "medical" ? MEDICAL_LIMITS : RECREATIONAL_LIMITS;
  return {
    usable: overrides?.usable ?? base.usable,
    solid_edible: overrides?.solid_edible ?? base.solid_edible,
    concentrate: overrides?.concentrate ?? base.concentrate,
    liquid_edible: overrides?.liquid_edible ?? base.liquid_edible,
  };
}

/** Grams a single cart line contributes to its bucket. */
export function lineGrams(line: LimitCartLine, overrides?: LimitOverrides): number {
  if (typeof line.grams === "number" && line.grams > 0) return line.grams;
  const cat = (line.category ?? "").trim().toLowerCase();
  const perUnit =
    overrides?.unitGrams?.[cat] ?? DEFAULT_UNIT_GRAMS[cat] ?? 0;
  const qty = Number.isFinite(line.quantity) ? line.quantity : 0;
  return round3(perUnit * Math.max(0, qty));
}

/**
 * Evaluate a cart against the statutory single-transaction limits.
 * Concentrate bucket is the one most likely to trip on small carts.
 */
export function evaluateCart(
  lines: LimitCartLine[],
  customerType: "recreational" | "medical" = "recreational",
  overrides?: LimitOverrides,
): LimitEvaluation {
  const limits = resolveLimits(customerType, overrides);
  const totals: Record<LimitBucket, number> = {
    usable: 0,
    solid_edible: 0,
    concentrate: 0,
    liquid_edible: 0,
  };
  let untrackedLines = 0;

  for (const line of lines) {
    const bucket = categoryToBucket(line.category);
    if (!bucket) {
      untrackedLines += 1;
      continue;
    }
    totals[bucket] = round3(totals[bucket] + lineGrams(line, overrides));
  }

  const buckets: BucketUsage[] = LIMIT_BUCKETS.map((bucket) => {
    const usedGrams = totals[bucket];
    const maxGrams = limits[bucket];
    const overBy = usedGrams > maxGrams ? round3(usedGrams - maxGrams) : 0;
    const ratio = maxGrams > 0 ? round3(usedGrams / maxGrams) : 0;
    return {
      bucket,
      label: LIMIT_BUCKET_LABELS[bucket],
      usedGrams,
      maxGrams,
      ratio,
      overBy,
      exceeded: overBy > 0,
    };
  });

  const exceeded = buckets.filter((b) => b.exceeded);
  const reasons = exceeded.map(
    (b) =>
      `${b.label}: ${gramsToOunces(b.usedGrams)} oz exceeds the ${gramsToOunces(
        b.maxGrams,
      )} oz ${customerType} limit (over by ${gramsToOunces(b.overBy)} oz).`,
  );

  return {
    customerType,
    buckets,
    blocked: exceeded.length > 0,
    reasons,
    untrackedLines,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run with: npx tsx _tt.ts importing this module)
// ---------------------------------------------------------------------------
export function __runSalesLimitTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) {
      pass += 1;
    } else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // Bucket mapping
  ok(categoryToBucket("flower") === "usable", "flower→usable");
  ok(categoryToBucket("preroll") === "usable", "preroll→usable");
  ok(categoryToBucket("concentrate") === "concentrate", "concentrate→concentrate");
  ok(categoryToBucket("cartridge") === "concentrate", "cartridge→concentrate");
  ok(categoryToBucket("edible-solid") === "solid_edible", "edible-solid→solid_edible");
  ok(categoryToBucket("edible-liquid") === "liquid_edible", "edible-liquid→liquid_edible");
  ok(categoryToBucket("tincture") === "liquid_edible", "tincture→liquid_edible");
  ok(categoryToBucket("topical") === "liquid_edible", "topical→liquid_edible");
  ok(categoryToBucket("accessories") === null, "accessories→null");
  ok(categoryToBucket("merch") === null, "merch→null");
  ok(categoryToBucket(null) === null, "null→null");
  ok(categoryToBucket("UNKNOWN") === null, "unknown→null");

  // Statutory maxima
  ok(RECREATIONAL_LIMITS.usable === 28, "rec usable 28g");
  ok(RECREATIONAL_LIMITS.concentrate === 7, "rec concentrate 7g");
  ok(RECREATIONAL_LIMITS.solid_edible === 448, "rec solid 16oz=448g");
  ok(RECREATIONAL_LIMITS.liquid_edible === 2016, "rec liquid 72oz=2016g");
  ok(MEDICAL_LIMITS.usable === 84, "med usable 84g");
  ok(MEDICAL_LIMITS.concentrate === 21, "med concentrate 21g");

  // resolveLimits + overrides
  ok(resolveLimits("recreational").usable === 28, "resolve rec");
  ok(resolveLimits("medical").usable === 84, "resolve med");
  ok(resolveLimits("recreational", { usable: 14 }).usable === 14, "override usable 14");
  ok(
    resolveLimits("recreational", { usable: 14 }).concentrate === 7,
    "override leaves others",
  );

  // lineGrams: defaults
  ok(lineGrams({ category: "flower", quantity: 2 }) === 7, "2x flower 3.5=7g");
  ok(lineGrams({ category: "concentrate", quantity: 3 }) === 3, "3x concentrate 1g=3g");
  ok(
    lineGrams({ category: "concentrate", quantity: 1, grams: 5 }) === 5,
    "explicit grams override",
  );
  ok(
    lineGrams({ category: "flower", quantity: 1 }, { unitGrams: { flower: 28 } }) === 28,
    "unitGrams override",
  );
  ok(lineGrams({ category: "accessories", quantity: 5 }) === 0, "untracked 0g");

  // evaluateCart: within limit
  const within = evaluateCart([
    { category: "flower", quantity: 2 }, // 7g usable
    { category: "concentrate", quantity: 3 }, // 3g concentrate
    { category: "accessories", quantity: 1 }, // untracked
  ]);
  ok(within.blocked === false, "within not blocked");
  ok(within.untrackedLines === 1, "1 untracked");
  const usableB = within.buckets.find((b) => b.bucket === "usable")!;
  ok(usableB.usedGrams === 7, "usable used 7g");
  ok(usableB.exceeded === false, "usable not exceeded");

  // evaluateCart: over concentrate (8g > 7g)
  const overConc = evaluateCart([{ category: "concentrate", quantity: 8 }]);
  ok(overConc.blocked === true, "over concentrate blocked");
  ok(overConc.reasons.length === 1, "one reason");
  const cb = overConc.buckets.find((b) => b.bucket === "concentrate")!;
  ok(cb.exceeded === true, "concentrate exceeded");
  ok(cb.overBy === 1, "concentrate over by 1g");

  // exactly at limit is OK (7g concentrate)
  const exact = evaluateCart([{ category: "concentrate", quantity: 7 }]);
  ok(exact.blocked === false, "exactly at limit ok");

  // over usable: 10x flower * 3.5 = 35g > 28g
  const overUsable = evaluateCart([{ category: "flower", quantity: 10 }]);
  ok(overUsable.blocked === true, "over usable blocked");
  ok(
    overUsable.buckets.find((b) => b.bucket === "usable")!.overBy === 7,
    "usable over by 7g",
  );

  // medical higher limit: 10x flower not blocked for medical (35g < 84g)
  const med = evaluateCart([{ category: "flower", quantity: 10 }], "medical");
  ok(med.blocked === false, "medical 35g within 84g");
  ok(med.customerType === "medical", "customerType medical");

  // gramsToOunces
  ok(gramsToOunces(28) === 1, "28g=1oz");
  ok(gramsToOunces(14) === 0.5, "14g=0.5oz");

  // bucketCategories: every known slug lands in exactly one bucket, and the
  // groupings match categoryToBucket.
  const bc = bucketCategories();
  ok(bc.usable.includes("flower") && bc.usable.includes("preroll"), "usable has flower+preroll");
  ok(bc.concentrate.includes("cartridge") && bc.concentrate.includes("rso"), "concentrate has cartridge+rso");
  ok(bc.solid_edible.length === 1 && bc.solid_edible[0] === "edible-solid", "solid = edible-solid only");
  ok(
    bc.liquid_edible.includes("edible-liquid") &&
      bc.liquid_edible.includes("tincture") &&
      bc.liquid_edible.includes("topical"),
    "liquid has edible-liquid+tincture+topical",
  );
  const totalGrouped = bc.usable.length + bc.solid_edible.length + bc.concentrate.length + bc.liquid_edible.length;
  ok(totalGrouped === ALL_LIMIT_CATEGORY_SLUGS.length, "all slugs grouped exactly once");

  console.log(`sales-limits-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`${fail} sales-limits-core tests failed`);
}
