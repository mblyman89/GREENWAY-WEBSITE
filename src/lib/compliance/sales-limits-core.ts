/**
 * src/lib/compliance/sales-limits-core.ts
 *
 * Slice 34 (Feature S) — CCRS sales-limits window. PURE logic (no server-only,
 * no DB). Models the WA single-transaction limits from WAC 314-55-095
 * (effective 1/7/2025) and RCW 69.50.360, and evaluates a cart against them so
 * the POS can warn / block before an over-limit sale.
 *
 * FIVE legal "buckets" with their recreational single-transaction maximums.
 * NOTE the unit column — four are GRAMS, one is MILLIGRAMS OF THC:
 *   - usable          : 1 ounce useable cannabis           = 28 g   (flower-equivalent)
 *   - solid_edible    : 16 ounces solid infused            = 448 g   (16 × 28)
 *   - concentrate     : 7 grams extract/concentrate inhale = 7 g
 *   - liquid_edible   : 72 ounces liquid infused           = 2016 g  (72 × 28, ≈ ml)
 *   - low_thc_liquid  : 200 MILLIGRAMS of active delta-9 THC  — SLICE 16
 *
 * (The gram figures above are computed as ounces × STATUTORY_GRAMS_PER_OUNCE
 * (28), which is the license-critical equivalence GW-016 pinned for limit
 * ENFORCEMENT. An older revision of this header quoted 453.592 / 2041.166 —
 * the 28.3495 avoirdupois conversion — which never matched the code. Corrected
 * in SLICE 16; the CODE was always right, only the comment was stale.)
 *
 * Medical patients in the DOH database get the higher maximums:
 *   3 oz usable, 48 oz solid, 21 g concentrate, 216 oz liquid — but the
 *   low_thc_liquid cap stays 200 mg (it does NOT scale; see MEDICAL_LIMITS).
 *
 * ── SLICE 16: THE LOW-THC BEVERAGE BUCKET ───────────────────────────────
 * WAC 314-55-095(1)(d)(i), verbatim:
 *   (E) Seventy-two ounces of cannabis-infused product in liquid form for oral
 *       ingestion or applied topically to the skin, UNLESS the product is
 *       packaged in individual units containing no more than four milligrams
 *       of active delta-9 THC per unit; and
 *   (F) Two hundred mg of active delta-9 THC within a cannabis-infused product
 *       in liquid form if the product is packaged in individual units
 *       containing no more than four milligrams of active delta-9 THC per unit.
 *
 * Three consequences, each of which is pinned by a test:
 *   1. The cap is 200 MILLIGRAMS OF THC, not 200 ounces of volume. At the 4 mg
 *      per-unit ceiling that is 50 units; at 2 mg/unit it is 100 units.
 *   2. (E) and (F) are MUTUALLY EXCLUSIVE, not additive — (E) says "unless".
 *      A qualifying product is carved OUT of the 72 oz bucket and governed by
 *      (F) instead. It never consumes both.
 *   3. The trigger is how the product is PACKAGED (a shelf attribute), not
 *      anything computed from the cart. "Unit" is the individual sellable
 *      container: one can is one unit; a 4-pack of 4 mg cans is four qualifying
 *      units; a single bottle holding 16 mg is ONE 16 mg unit and does NOT
 *      qualify, no matter how its label divides that into servings.
 *
 * Because servings ≠ units, this bucket is driven by an EXPLICIT per-product
 * flag set at intake from the label/invoice — never derived from
 * servings × mg-per-serving, which would be a guess and is wrong for
 * multi-serving single containers.
 *
 * SAFE DEFAULT: a liquid with no flag is treated as a NORMAL liquid (72 oz
 * bucket). "Unknown" must never unlock the more permissive path.
 *
 * Each cart line carries a website category + quantity. We map the category to
 * a bucket and a per-unit weight contribution (grams), then sum per bucket and
 * compare to the active maximum. Weight-equivalents per unit are CONFIGURABLE
 * by the owner (they vary by product) — these defaults are conservative.
 *
 * NOTE: This is an in-transaction limit (per RCW 69.50.360), which CCRS / LCB
 * enforce per sale. We deliberately do not invent a rolling "daily" window the
 * statute doesn't define; the configurable settings let the owner tighten it.
 *
 * MIX-INFUSED RULE (owner-directed compliance fix, verified against the WAC):
 * Infused flower, infused prerolls, infused blunts, and infused preroll packs
 * are "cannabis mix infused" (WAC 314-55-010(8)) — flower combined with
 * concentrate for inhalation. They count against the 7 g CONCENTRATE bucket
 * (WAC 314-55-095(1)(d)(i)(C)), NOT the 28 g flower bucket. The whole unit
 * weight counts (conservative; labels don't state the flower/concentrate
 * split and under-counting concentrate is the enforcement risk).
 */
import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";

// GW-016: the statutory equivalence now lives (named + documented + self-tested)
// in the shared grams-per-ounce module; re-exported here so existing consumers
// keep working. WA statute treats 1 oz useable = 28 g for limit ENFORCEMENT.
export const GRAMS_PER_OUNCE = STATUTORY_GRAMS_PER_OUNCE;

/** The five statutory limit buckets (SLICE 16 added low_thc_liquid). */
export type LimitBucket =
  | "usable"
  | "solid_edible"
  | "concentrate"
  | "liquid_edible"
  | "low_thc_liquid";

export const LIMIT_BUCKETS: readonly LimitBucket[] = [
  "usable",
  "solid_edible",
  "concentrate",
  "liquid_edible",
  "low_thc_liquid",
] as const;

export const LIMIT_BUCKET_LABELS: Record<LimitBucket, string> = {
  usable: "Useable cannabis (flower-equivalent)",
  solid_edible: "Solid infused edibles",
  concentrate: "Concentrate / extract (incl. infused prerolls & flower)",
  liquid_edible: "Liquid infused products",
  low_thc_liquid: "Low-THC beverages (\u2264 4 mg THC per unit)",
};

/**
 * The measurement unit each bucket is denominated in.
 *
 * This exists because SLICE 16 introduced the first bucket that is NOT a
 * weight. Every other bucket counts grams; low_thc_liquid counts MILLIGRAMS OF
 * ACTIVE DELTA-9 THC. Without an explicit unit the 200 mg cap would flow into
 * gramsToOunces() somewhere downstream and render to the owner as "7.143 oz",
 * which is meaningless and dangerous. Any code formatting a bucket figure MUST
 * consult this map rather than assuming grams.
 */
export type LimitUnit = "g" | "mg_thc";

export const LIMIT_BUCKET_UNITS: Record<LimitBucket, LimitUnit> = {
  usable: "g",
  solid_edible: "g",
  concentrate: "g",
  liquid_edible: "g",
  low_thc_liquid: "mg_thc",
};

/** True when the bucket is measured in mg of THC rather than grams of product. */
export function isThcBucket(bucket: LimitBucket): boolean {
  return LIMIT_BUCKET_UNITS[bucket] === "mg_thc";
}

/**
 * Format a bucket amount for humans, in the bucket's OWN unit.
 *
 * - mg-THC buckets  -> "200 mg THC"
 * - concentrate     -> "7 g"        (statute states it in grams, not ounces)
 * - other gram buckets -> "72 oz"   (statute states these in ounces)
 */
export function formatLimitAmount(bucket: LimitBucket, amount: number): string {
  if (isThcBucket(bucket)) return `${round3(amount)} mg THC`;
  if (bucket === "concentrate") return `${round3(amount)} g`;
  return `${gramsToOunces(amount)} oz`;
}

/**
 * Statutory single-transaction maximums.
 *
 * UNITS ARE NOT UNIFORM — consult LIMIT_BUCKET_UNITS. The first four fields are
 * GRAMS; `low_thc_liquid` is MILLIGRAMS OF ACTIVE DELTA-9 THC.
 */
export type LimitProfile = {
  usable: number;
  solid_edible: number;
  concentrate: number;
  liquid_edible: number;
  /** MILLIGRAMS of active delta-9 THC — NOT grams. WAC 314-55-095(1)(d)(i)(F). */
  low_thc_liquid: number;
};

/**
 * The statutory ceiling on THC per INDIVIDUAL UNIT for a product to qualify for
 * the low-THC beverage allowance: "no more than four milligrams of active
 * delta-9 THC per unit" (WAC 314-55-095(1)(d)(i)(E) and (F), and identically in
 * (2)(d) for medical).
 *
 * "Unit" = the individual sellable container. One can is one unit. A 4-pack of
 * 4 mg cans is four qualifying units. A single bottle containing 16 mg is one
 * 16 mg unit and does NOT qualify even if labelled "4 servings × 4 mg".
 */
export const LOW_THC_UNIT_MAX_MG = 4;

/** Recreational (21+) single-transaction limits — WAC 314-55-095(1)(d). */
export const RECREATIONAL_LIMITS: LimitProfile = {
  usable: 1 * GRAMS_PER_OUNCE, // 28 g (1 oz)
  solid_edible: 16 * GRAMS_PER_OUNCE, // 448 g (16 oz)
  concentrate: 7, // 7 g
  liquid_edible: 72 * GRAMS_PER_OUNCE, // 2016 g (72 oz)
  low_thc_liquid: 200, // 200 mg THC — WAC 314-55-095(1)(d)(i)(F)
};

/**
 * Medical (in DOH database) single-transaction limits — WAC 314-55-095(2)(d).
 *
 * ⚠ DO NOT "FIX" low_thc_liquid TO 600. Every other bucket triples for a
 * DOH-database patient (1→3 oz, 16→48 oz, 7→21 g, 72→216 oz), so the
 * pattern-matching instinct is to write 200 × 3. The statute does not do that.
 * WAC 314-55-095(2)(d), verbatim, ends:
 *
 *   "…and 216 ounces of cannabis-infused product in liquid form meant to be
 *    eaten or swallowed, AND UP TO 200 MG of active delta-9 THC within a
 *    cannabis-infused product in liquid form meant to be eaten or swallowed if
 *    product is packaged in individual units containing no more than four
 *    milligrams of active delta-9 THC per unit."
 *
 * 200 mg for recreational, 200 mg for medical. Identical. Raising it would be
 * an over-sale on every medical transaction. Pinned by a dedicated test.
 */
export const MEDICAL_LIMITS: LimitProfile = {
  usable: 3 * GRAMS_PER_OUNCE, // 84 g (3 oz)
  solid_edible: 48 * GRAMS_PER_OUNCE, // 1344 g (48 oz)
  concentrate: 21, // 21 g
  liquid_edible: 216 * GRAMS_PER_OUNCE, // 6048 g (216 oz)
  low_thc_liquid: 200, // 200 mg THC — NOT tripled. See the note above.
};

/**
 * Map a website category slug to a statutory bucket. Non-cannabis categories
 * (accessories, merch, paraphernalia) map to null = not limited.
 */
export function categoryToBucket(category: string | null | undefined): LimitBucket | null {
  const c = (category ?? "").trim().toLowerCase();
  switch (c) {
    // Flower / useable cannabis — WAC 314-55-095(1)(d)(i)(A): 1 oz.
    case "flower":
    case "popcorn-bud":
    case "trim":
    case "preroll":
    case "blunt":
    case "preroll-pack":
      return "usable";
    // Concentrate / extract for inhalation — WAC 314-55-095(1)(d)(i)(C): 7 g.
    // INFUSED flower/prerolls/blunts are "cannabis mix infused" products
    // (WAC 314-55-010(8): cannabis mix combined with other intermediate
    // products, i.e., concentrate) intended for inhalation. The conservative
    // reading — and the store's policy — counts the WHOLE unit against the
    // 7 g concentrate limit, never the 28 g flower limit.
    case "infused-flower":
    case "infused-preroll":
    case "infused-blunt":
    case "infused-preroll-pack":
    case "cartridge":
    case "disposable-cartridge":
    case "concentrate":
    case "rso": // RSO is an extract; 7 g bucket is the tighter, safer read.
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
    // SLICE 16: low-THC beverages are NOT a category of their own — they are
    // `edible-liquid` products carrying a per-product flag. This list stays
    // empty by design; the staff reference explains the flag instead.
    low_thc_liquid: [],
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
 *
 * INFUSED (mix-infused) categories count their WHOLE unit weight against the
 * 7 g concentrate bucket (see categoryToBucket) — deliberately conservative:
 * we never try to split a mix-infused unit into "flower grams" vs
 * "concentrate grams", because the label doesn't state the split and
 * under-counting the concentrate portion is the compliance risk. AN-1: when
 * the variant's true per-unit weight is parsed from the label, that weight
 * rides along on the cart line and overrides these defaults.
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
  /**
   * SLICE 16 — WAC 314-55-095(1)(d)(i)(F). True when this product is packaged
   * in individual units of ≤ 4 mg active delta-9 THC, which moves it OUT of the
   * 72 oz liquid bucket and INTO the 200 mg THC bucket.
   *
   * This is an explicit, owner-confirmed product attribute set at intake from
   * the label/invoice — NEVER derived from servings × mg-per-serving, because a
   * serving is not a unit (a single bottle labelled "4 servings × 4 mg" is one
   * 16 mg unit and does not qualify).
   *
   * Absent/null/false → treated as a normal liquid. Unknown never unlocks the
   * more permissive path.
   */
  lowThcLiquid?: boolean | null;
  /**
   * SLICE 16 — milligrams of active delta-9 THC in ONE individual unit of this
   * product. Only consulted when `lowThcLiquid` is true. Must be > 0 and
   * ≤ LOW_THC_UNIT_MAX_MG for the line to qualify; anything else fails safe
   * back to the normal liquid bucket.
   */
  unitThcMg?: number | null;
};

export type BucketUsage = {
  bucket: LimitBucket;
  label: string;
  /**
   * Amount consumed by the cart in this bucket, in the bucket's OWN unit.
   *
   * HISTORICAL NAME: for the four original buckets this is grams, which is what
   * the name says. For `low_thc_liquid` it is MILLIGRAMS OF THC. The name is
   * kept so every pre-SLICE-16 consumer keeps compiling; new code should read
   * `used`/`max`/`unit` below, which are explicit about the unit.
   */
  usedGrams: number;
  /** Statutory/owner maximum for this bucket, in the bucket's own unit. */
  maxGrams: number;
  /** usedGrams / maxGrams, clamped 0..(can exceed 1 when over). */
  ratio: number;
  overBy: number; // amount over the max, own unit (0 when within limit)
  exceeded: boolean;
  /** SLICE 16 — the unit `used`/`max`/`overBy` are denominated in. */
  unit: LimitUnit;
  /** SLICE 16 — unit-explicit alias of usedGrams. Prefer this in new code. */
  used: number;
  /** SLICE 16 — unit-explicit alias of maxGrams. Prefer this in new code. */
  max: number;
  /** SLICE 16 — pre-formatted "72 oz" / "7 g" / "200 mg THC" for display. */
  usedLabel: string;
  /** SLICE 16 — pre-formatted maximum for display. */
  maxLabel: string;
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

/**
 * AN-2 — statutory clamp for owner-entered limit profiles (mirrors the
 * sales-hours pattern: `normalizeSalesHoursWindow` clamps INTO the statute).
 *
 * The owner may TIGHTEN a bucket below the WAC 314-55-095 maximum but can
 * never widen it: values above the statutory base clamp down to the base,
 * and nonsense (non-numeric, zero, negative, NaN/Infinity) collapses to the
 * statutory base — exactly how sales-hours collapses garbage to the widest
 * legal window. Values are rounded to 3 decimals like all limit math.
 */
export function clampLimitProfile(raw: unknown, base: LimitProfile): LimitProfile {
  const r = (raw ?? {}) as Record<string, unknown>;
  const clamp = (v: unknown, max: number): number => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (!Number.isFinite(n) || n <= 0) return max;
    return round3(Math.min(n, max));
  };
  return {
    usable: clamp(r.usable, base.usable),
    solid_edible: clamp(r.solid_edible, base.solid_edible),
    concentrate: clamp(r.concentrate, base.concentrate),
    liquid_edible: clamp(r.liquid_edible, base.liquid_edible),
    // SLICE 16 — mg THC, same clamp semantics: the owner may tighten below
    // 200 mg, never widen above it.
    low_thc_liquid: clamp(r.low_thc_liquid, base.low_thc_liquid),
  };
}

/** Resolve the active limit profile, applying owner overrides.
 * AN-2: overrides are clamped INTO the statute at this single choke point —
 * every evaluation (register meter, website check, completion gate) flows
 * through here, so even a stale cached device bundle carrying pre-clamp
 * values can only ever TIGHTEN the WAC 314-55-095 maximums, never widen. */
export function resolveLimits(
  customerType: "recreational" | "medical",
  overrides?: LimitOverrides,
): LimitProfile {
  const base = customerType === "medical" ? MEDICAL_LIMITS : RECREATIONAL_LIMITS;
  return clampLimitProfile(
    {
      usable: overrides?.usable ?? base.usable,
      solid_edible: overrides?.solid_edible ?? base.solid_edible,
      concentrate: overrides?.concentrate ?? base.concentrate,
      liquid_edible: overrides?.liquid_edible ?? base.liquid_edible,
      low_thc_liquid: overrides?.low_thc_liquid ?? base.low_thc_liquid,
    },
    base,
  );
}

/**
 * SLICE 16 — does this line qualify for the low-THC beverage allowance?
 *
 * ALL of the following must hold (WAC 314-55-095(1)(d)(i)(E)+(F)):
 *   1. the product's category is a LIQUID one (the statute says "in liquid
 *      form"), i.e. it would otherwise land in the liquid_edible bucket;
 *   2. the owner has explicitly flagged it as packaged in individual units of
 *      ≤ 4 mg active delta-9 THC;
 *   3. a positive per-unit THC mg figure is present and is ≤ 4 mg.
 *
 * Anything missing or nonsensical (no flag, no mg, zero, negative, NaN, over
 * 4 mg) returns false and the line stays in the ordinary 72 oz liquid bucket.
 * That is the fail-safe direction: the 72 oz rule is the stricter one for a
 * bulky low-dose beverage, so an unclassified product can only ever be
 * OVER-restricted, never under-restricted.
 */
export function qualifiesAsLowThcLiquid(line: LimitCartLine): boolean {
  if (categoryToBucket(line.category) !== "liquid_edible") return false;
  if (line.lowThcLiquid !== true) return false;
  const mg = typeof line.unitThcMg === "number" ? line.unitThcMg : NaN;
  if (!Number.isFinite(mg) || mg <= 0) return false;
  return mg <= LOW_THC_UNIT_MAX_MG;
}

/**
 * SLICE 16 — which bucket does this LINE actually count against?
 *
 * Identical to categoryToBucket() for every product except a qualifying
 * low-THC beverage, which is carved out of liquid_edible per the word
 * "unless" in WAC 314-55-095(1)(d)(i)(E). The two are mutually exclusive: a
 * qualifying line contributes to low_thc_liquid and contributes NOTHING to
 * liquid_edible.
 */
export function lineBucket(line: LimitCartLine): LimitBucket | null {
  if (qualifiesAsLowThcLiquid(line)) return "low_thc_liquid";
  return categoryToBucket(line.category);
}

/**
 * SLICE 16 — milligrams of active delta-9 THC this line contributes to the
 * low_thc_liquid bucket: per-unit mg × quantity.
 *
 * QUANTITY IS COUNTED IN UNITS, and one unit is one individual sellable
 * container. A budtender scanning four cans out of a 4-pack rings four lines
 * of quantity 1 (or one line of quantity 4) — either way it is 4 units × the
 * per-unit mg. Returns 0 for a line that does not qualify.
 */
export function lineThcMg(line: LimitCartLine): number {
  if (!qualifiesAsLowThcLiquid(line)) return 0;
  const mg = line.unitThcMg as number;
  const qty = Number.isFinite(line.quantity) ? Math.max(0, line.quantity) : 0;
  return round3(mg * qty);
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
    low_thc_liquid: 0,
  };
  let untrackedLines = 0;

  for (const line of lines) {
    // SLICE 16: lineBucket (not categoryToBucket) so a qualifying low-THC
    // beverage is routed to its own mg-denominated bucket and contributes
    // NOTHING to the 72 oz liquid bucket — (E) and (F) are alternatives.
    const bucket = lineBucket(line);
    if (!bucket) {
      untrackedLines += 1;
      continue;
    }
    // Each bucket accumulates in ITS OWN unit: mg of THC for low_thc_liquid,
    // grams for everything else. Never mix the two.
    const contribution = bucket === "low_thc_liquid" ? lineThcMg(line) : lineGrams(line, overrides);
    totals[bucket] = round3(totals[bucket] + contribution);
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
      // SLICE 16 — unit-explicit fields so no consumer has to assume grams.
      unit: LIMIT_BUCKET_UNITS[bucket],
      used: usedGrams,
      max: maxGrams,
      usedLabel: formatLimitAmount(bucket, usedGrams),
      maxLabel: formatLimitAmount(bucket, maxGrams),
    };
  });

  const exceeded = buckets.filter((b) => b.exceeded);
  // SLICE 16 — the reason string is written in the BUCKET'S OWN UNIT. Before
  // this slice every reason hard-coded " oz", which would have described a
  // 204 mg THC overage as "7.286 oz" — meaningless to a budtender and wrong.
  const reasons = exceeded.map(
    (b) =>
      `${b.label}: ${formatLimitAmount(b.bucket, b.usedGrams)} exceeds the ${formatLimitAmount(
        b.bucket,
        b.maxGrams,
      )} ${customerType} limit (over by ${formatLimitAmount(b.bucket, b.overBy)}).`,
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
  ok(categoryToBucket("popcorn-bud") === "usable", "popcorn-bud→usable");
  ok(categoryToBucket("trim") === "usable", "trim→usable");
  ok(categoryToBucket("blunt") === "usable", "blunt→usable");
  ok(categoryToBucket("preroll-pack") === "usable", "preroll-pack→usable");
  ok(categoryToBucket("concentrate") === "concentrate", "concentrate→concentrate");
  ok(categoryToBucket("cartridge") === "concentrate", "cartridge→concentrate");
  ok(categoryToBucket("disposable-cartridge") === "concentrate", "disposable-cartridge→concentrate");
  ok(categoryToBucket("rso") === "concentrate", "rso→concentrate");
  // MIX-INFUSED RULE — WAC 314-55-010(8) + 314-55-095(1)(d)(i)(C): infused
  // flower/prerolls/blunts count against the 7 g concentrate bucket.
  ok(categoryToBucket("infused-flower") === "concentrate", "infused-flower→concentrate (7g rule)");
  ok(categoryToBucket("infused-preroll") === "concentrate", "infused-preroll→concentrate (7g rule)");
  ok(categoryToBucket("infused-blunt") === "concentrate", "infused-blunt→concentrate (7g rule)");
  ok(
    categoryToBucket("infused-preroll-pack") === "concentrate",
    "infused-preroll-pack→concentrate (7g rule)",
  );
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

  // AN-2: clampLimitProfile — tighten allowed, widen impossible.
  ok(
    clampLimitProfile({ usable: 14, solid_edible: 448, concentrate: 7, liquid_edible: 2016 }, RECREATIONAL_LIMITS)
      .usable === 14,
    "clamp: tighter usable kept",
  );
  ok(
    clampLimitProfile({ usable: 999, solid_edible: 448, concentrate: 7, liquid_edible: 2016 }, RECREATIONAL_LIMITS)
      .usable === 28,
    "clamp: usable above statute collapses to 28",
  );
  ok(
    clampLimitProfile({ usable: 28, solid_edible: 448, concentrate: 50, liquid_edible: 2016 }, RECREATIONAL_LIMITS)
      .concentrate === 7,
    "clamp: concentrate above statute collapses to 7",
  );
  ok(
    clampLimitProfile({ usable: 0, solid_edible: -5, concentrate: NaN, liquid_edible: "junk" }, RECREATIONAL_LIMITS)
      .usable === 28,
    "clamp: zero collapses to statute",
  );
  ok(
    clampLimitProfile({ usable: 0, solid_edible: -5, concentrate: NaN, liquid_edible: "junk" }, RECREATIONAL_LIMITS)
      .liquid_edible === 2016,
    "clamp: garbage string collapses to statute",
  );
  ok(clampLimitProfile(null, MEDICAL_LIMITS).usable === 84, "clamp: null profile → med statute");
  ok(
    clampLimitProfile({ usable: "42" }, MEDICAL_LIMITS).usable === 42,
    "clamp: numeric string accepted (pg numeric as text)",
  );

  // AN-2: resolveLimits clamps overrides at the engine choke point — a stale
  // cached bundle carrying widened values can never exceed the statute.
  ok(resolveLimits("recreational", { usable: 999 }).usable === 28, "resolve clamps widened usable");
  ok(resolveLimits("medical", { concentrate: 500 }).concentrate === 21, "resolve clamps widened med concentrate");
  ok(resolveLimits("recreational", { concentrate: 3 }).concentrate === 3, "resolve keeps tightened value");

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

  // MIX-INFUSED RULE scenarios — the owner's exact bug report:
  // 8 × 1 g infused prerolls = 8 g must trip the 7 g concentrate wall,
  // NOT slide under the 28 g flower wall.
  const infusedOver = evaluateCart([{ category: "infused-preroll", quantity: 8 }]);
  ok(infusedOver.blocked === true, "8x1g infused prerolls blocked at 7g");
  ok(
    infusedOver.buckets.find((b) => b.bucket === "concentrate")!.exceeded === true,
    "infused prerolls trip the CONCENTRATE bucket",
  );
  ok(
    infusedOver.buckets.find((b) => b.bucket === "usable")!.usedGrams === 0,
    "infused prerolls add NOTHING to the flower bucket",
  );
  // 5 × 1.5 g infused blunts = 7.5 g > 7 g → blocked.
  const bluntsOver = evaluateCart([{ category: "infused-blunt", quantity: 5 }]);
  ok(bluntsOver.blocked === true, "5x1.5g infused blunts blocked (7.5g > 7g)");
  // 7 × 1 g infused prerolls = exactly 7 g → allowed.
  ok(
    evaluateCart([{ category: "infused-preroll", quantity: 7 }]).blocked === false,
    "7x1g infused prerolls exactly at limit ok",
  );
  // Infused products SHARE the bucket with carts/dabs: 5 g concentrate +
  // 3 × 1 g infused prerolls = 8 g → blocked together.
  ok(
    evaluateCart([
      { category: "concentrate", quantity: 5 },
      { category: "infused-preroll", quantity: 3 },
    ]).blocked === true,
    "concentrate + infused prerolls share the 7g bucket",
  );
  // Buckets stay independent: a FULL 28 g of flower plus 6 g of infused
  // prerolls passes — infused no longer eats the flower allowance.
  const fullFlowerPlusInfused = evaluateCart([
    { category: "flower", quantity: 8 }, // 8 × 3.5 = 28 g usable (at limit)
    { category: "infused-preroll", quantity: 6 }, // 6 g concentrate (under 7)
  ]);
  ok(fullFlowerPlusInfused.blocked === false, "28g flower + 6g infused passes");
  // Medical: 21 g concentrate ceiling applies to infused too.
  ok(
    evaluateCart([{ category: "infused-preroll", quantity: 21 }], "medical").blocked === false,
    "medical 21x1g infused prerolls ok",
  );
  ok(
    evaluateCart([{ category: "infused-preroll", quantity: 22 }], "medical").blocked === true,
    "medical 22x1g infused prerolls blocked",
  );

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
  ok(
    !bc.usable.some((s) => s.startsWith("infused-")),
    "usable bucket contains NO infused categories",
  );
  ok(bc.concentrate.includes("cartridge") && bc.concentrate.includes("rso"), "concentrate has cartridge+rso");
  ok(
    bc.concentrate.includes("infused-flower") &&
      bc.concentrate.includes("infused-preroll") &&
      bc.concentrate.includes("infused-blunt") &&
      bc.concentrate.includes("infused-preroll-pack"),
    "concentrate has all four infused categories",
  );
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
