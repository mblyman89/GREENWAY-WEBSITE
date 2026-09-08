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
 *   - liquid_edible   : 72 FLUID ounces liquid infused      = 2129.292 ml — SLICE L4
 *   - low_thc_liquid  : 200 MILLIGRAMS of active delta-9 THC  — SLICE 16
 *   - otherwise_taken : 10 UNITS (a COUNT OF ITEMS)           — SLICE 17
 *
 * (The gram figures above are computed as ounces × STATUTORY_GRAMS_PER_OUNCE
 * (28), which is the license-critical equivalence GW-016 pinned for limit
 * ENFORCEMENT. An older revision of this header quoted 453.592 / 2041.166 —
 * the 28.3495 avoirdupois conversion — which never matched the code. Corrected
 * in SLICE 16; the CODE was always right, only the comment was stale.)
 *
 * Medical patients in the DOH database get the higher maximums:
 *   3 oz usable, 48 oz solid, 21 g concentrate, 216 oz liquid — but the
 *   low_thc_liquid cap stays 200 mg (it does NOT scale; see MEDICAL_LIMITS),
 *   and the otherwise_taken cap stays 10 units for the same kind of reason:
 *   WAC 314-55-095(2)(d) simply does not list the category. See SLICE 17.
 *
 * ── SLICE 17: THE "OTHERWISE TAKEN INTO THE BODY" BUCKET ────────────────────
 * WAC 314-55-095(1)(d)(i)(D), verbatim:
 *   (D) Ten units of a cannabis-infused product otherwise taken into the body;
 *
 * WAC 314-55-010(40) defines the category, verbatim:
 *   "Product(s) otherwise taken into the body" means a cannabis-infused product
 *   for human consumption or ingestion intended for uses other than inhalation,
 *   oral ingestion, or external application to the skin.
 *
 * Three exclusions — inhaled, swallowed, rubbed on skin. What remains, among
 * products a Washington retailer can actually stock, is the SUPPOSITORY.
 * Transdermal patches are EXCLUDED (skin). Sublingual tinctures are EXCLUDED
 * (oral ingestion). Both are routinely mis-filed here; they must not be.
 *
 * THIS IS THE ONLY BUCKET THAT COUNTS ITEMS. Not grams, not milligrams of THC
 * — a count of individual consumable items. RCW 69.50.101: "'Unit' means an
 * individual consumable item within a package of one or more consumable items";
 * "'Package' means a container that has a single unit or group of units." So a
 * box of six suppositories is ONE package of SIX units and consumes six of the
 * ten. It is not one unit merely because it is one box.
 *
 * MEDICAL DOES NOT INCREASE. WAC 314-55-095(2)(d) enumerates five categories
 * (usable, solid, concentrate, liquid, low-THC liquid) and this is not among
 * them. The rule grants no enhancement, so we do not invent one. Tripling by
 * analogy would authorize a sale the rule nowhere permits — the one direction
 * that creates real exposure. Declining can only under-sell, which is
 * recoverable and explainable. Do NOT "fix" this to 30.
 *
 * ── SLICE L4: WHY liquid_edible IS MEASURED IN MILLILITRES ───────────────
 * The owner found that the liquid limit allowed vastly more than 72 ounces.
 * The instinctive diagnosis — "2016 is the wrong constant" — IS WRONG, and
 * anyone changing this code must understand why before touching it.
 *
 * For an OUNCE-labelled product the grams basis was numerically EXACT, because
 * the 28 cancels:
 *
 *     2016 / (q * 28)  ==  72 / q  ==  (72 * 29.5735) / (q * 29.5735)
 *
 * So 1oz→72, 2oz→36, 16oz→4, 32oz→2 all enforced correctly. The real defect
 * was that ml / fl oz / L produced NO per-unit measure at all
 * (gramsFromVariantLabel matches only g|oz), so they fell back to
 * DEFAULT_UNIT_GRAMS["edible-liquid"] = 28 and EVERY size allowed exactly 72
 * packages: a 1.5 L bottle counted the same as a 1 oz vial (a 72x oversell),
 * while a 10 ml dropper was capped at 72 when 212 are legal (an UNDER-sell
 * that cost legal sales). The error ran both ways.
 *
 * The fix is the BASIS, not the number. Both the bucket total and the cap are
 * rescaled by the SAME ratio R = 29.5735 / 28 = 1.056196, so no
 * currently-correct verdict can move:
 *
 *     G <= 2016  <==>  G*R <= 2129.292
 *
 * Verified numerically across g = 0..4000 in 0.25 g steps: 0 mismatches, with
 * both boundaries exact (2016*R = 2129.2920 = the cap; 2016.25*R exceeds it).
 *
 * THIS IS ALSO WHAT KEEPS TOPICALS SAFE. categoryToBucket routes `topical`
 * into liquid_edible, and the owner's decision is that topicals stay on
 * WEIGHTED ounces until their own later slice. Because the ounce-count is
 * carried across as an ounce-count (never through an invented g/ml density), a
 * weight-labelled salve keeps its exact previous behaviour: 1oz→72, 1.7oz→42,
 * 2oz→36, 4oz→18, 8oz→9 — all identical. NO DENSITY IS ASSUMED ANYWHERE.
 *
 * FAIL-SAFE RUNS THE OPPOSITE WAY HERE — READ THIS BEFORE CHANGING ANYTHING.
 * For low_thc_liquid, an unflagged product falls back to the 72 oz bucket,
 * which is STRICTER for a bulky low-dose drink. Falling back is safe.
 * For otherwise_taken the arithmetic inverts: an unflagged suppository falls
 * into liquid_edible, where a few grams against a 2016 g cap is effectively
 * unlimited. Falling back is the PERMISSIVE direction. That is why this slice
 * ships suspectsOtherwiseTaken() and emits a WARNING on an unclassified
 * suspicious line, instead of trusting a silent default the way SLICE 16 could.
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
// SLICE L4 — the volume basis. Imported, never re-derived: a second copy of
// 29.5735 is how the cap and the line measure drift apart.
import {
  ML_PER_FLUID_OUNCE,
  REC_LIQUID_ML,
  MED_LIQUID_ML,
} from "@/lib/compliance/liquid-volume-core";

// GW-016: the statutory equivalence now lives (named + documented + self-tested)
// in the shared grams-per-ounce module; re-exported here so existing consumers
// keep working. WA statute treats 1 oz useable = 28 g for limit ENFORCEMENT.
export const GRAMS_PER_OUNCE = STATUTORY_GRAMS_PER_OUNCE;

/** The six statutory limit buckets (16 added low_thc_liquid, 17 otherwise_taken). */
export type LimitBucket =
  | "usable"
  | "solid_edible"
  | "concentrate"
  | "liquid_edible"
  | "low_thc_liquid"
  | "otherwise_taken";

export const LIMIT_BUCKETS: readonly LimitBucket[] = [
  "usable",
  "solid_edible",
  "concentrate",
  "liquid_edible",
  "low_thc_liquid",
  "otherwise_taken",
] as const;

export const LIMIT_BUCKET_LABELS: Record<LimitBucket, string> = {
  usable: "Useable cannabis (flower-equivalent)",
  solid_edible: "Solid infused edibles",
  concentrate: "Concentrate / extract (incl. infused prerolls & flower)",
  liquid_edible: "Liquid infused products",
  low_thc_liquid: "Low-THC beverages (\u2264 4 mg THC per unit)",
  otherwise_taken: "Products otherwise taken into the body (suppositories)",
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
export type LimitUnit = "g" | "ml" | "mg_thc" | "units";

export const LIMIT_BUCKET_UNITS: Record<LimitBucket, LimitUnit> = {
  usable: "g",
  solid_edible: "g",
  concentrate: "g",
  // SLICE L4 — MILLILITRES. The statute caps this bucket at 72 FLUID ounces,
  // and a volume cap can only be enforced on a volume basis. Any formatter
  // that assumes grams here will render 2129.292 as "76.046 oz", which is
  // wrong by the ratio between a fluid ounce and a weight ounce.
  liquid_edible: "ml",
  low_thc_liquid: "mg_thc",
  // SLICE 17 — a COUNT OF ITEMS. Not convertible to grams or mg. Any formatter
  // that assumes a weight will render "10 units" as "0.357 oz", which is both
  // meaningless and dangerously wrong.
  otherwise_taken: "units",
};

/** True when the bucket is measured in mg of THC rather than grams of product. */
export function isThcBucket(bucket: LimitBucket): boolean {
  return LIMIT_BUCKET_UNITS[bucket] === "mg_thc";
}

/** SLICE 17 — true when the bucket counts ITEMS rather than any measure of mass. */
export function isUnitCountBucket(bucket: LimitBucket): boolean {
  return LIMIT_BUCKET_UNITS[bucket] === "units";
}

/** SLICE L4 — true when the bucket is measured in millilitres of product. */
export function isVolumeBucket(bucket: LimitBucket): boolean {
  return LIMIT_BUCKET_UNITS[bucket] === "ml";
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
  // SLICE 17 — a count of items. Singular reads "1 unit", everything else
  // "N units". MUST come before the gramsToOunces fallthrough.
  if (isUnitCountBucket(bucket)) {
    const n = round3(amount);
    return `${n} ${n === 1 ? "unit" : "units"}`;
  }
  if (bucket === "concentrate") return `${round3(amount)} g`;
  // SLICE L4 — a volume bucket renders in FLUID ounces, because that is how
  // the statute states it and how the owner asked to see it. Rendering ml
  // through gramsToOunces() would report 2129.292 as "76.046 oz".
  if (isVolumeBucket(bucket)) return `${round3(amount / ML_PER_FLUID_OUNCE)} fl oz`;
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
  /** A COUNT OF ITEMS — not grams, not mg. WAC 314-55-095(1)(d)(i)(D). */
  otherwise_taken: number;
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
  liquid_edible: REC_LIQUID_ML, // 2129.292 ml (72 FLUID oz) — SLICE L4
  low_thc_liquid: 200, // 200 mg THC — WAC 314-55-095(1)(d)(i)(F)
  otherwise_taken: 10, // 10 UNITS — WAC 314-55-095(1)(d)(i)(D)
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
  liquid_edible: MED_LIQUID_ML, // 6387.876 ml (216 FLUID oz) — SLICE L4
  low_thc_liquid: 200, // 200 mg THC — NOT tripled. See the note above.
  // SLICE 17 — 10 UNITS, NOT tripled, and for a different reason than
  // low_thc_liquid: WAC 314-55-095(2)(d) does not list this category AT ALL.
  // It enumerates usable / solid / concentrate / liquid / low-THC liquid. The
  // rule grants no medical enhancement here, so we grant none. Do NOT set 30.
  otherwise_taken: 10,
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
    // SLICE 17: same shape. A suppository arrives as `topical` and is moved
    // into this bucket by an explicit per-product flag, not by its slug — a
    // "topical" shelf legitimately holds both balms (skin → 72 oz) and
    // suppositories (otherwise taken → 10 units), and no single slug can
    // express that split.
    otherwise_taken: [],
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
   * SLICE L4 — total MILLILITRES this line contributes to the liquid bucket:
   * the L3-plumbed per-package net volume times the quantity, resolved by the
   * caller. This is the field that finally makes the 72 FLUID ounce cap
   * enforceable on a bottle whose size is stated in ml, fl oz, or litres.
   *
   * null/absent means "not measured", NEVER zero — an unmeasured liquid falls
   * back to the weight-carried default below rather than becoming free.
   */
  volumeMl?: number | null;
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
  /**
   * SLICE 17 — WAC 314-55-095(1)(d)(i)(D). True when this product is
   * administered by a route that is not inhalation, not oral ingestion, and not
   * external application to the skin — in practice, a suppository.
   *
   * Explicit, set at intake. Absent/null/false → the product stays in whatever
   * bucket its category assigns. NOTE that unlike the low-THC flag, falling
   * back here is the PERMISSIVE direction, which is why `name` below exists.
   */
  otherwiseTaken?: boolean | null;
  /**
   * SLICE 17 — how many individual consumable items are inside ONE sellable
   * package (RCW 69.50.101). A box of six suppositories is 6. Absent → 1.
   */
  unitsPerPackage?: number | null;
  /**
   * SLICE 17 — product name, read ONLY by suspectsOtherwiseTaken() to warn
   * about an unclassified suppository. Never used to block and never used to
   * decide a bucket. Optional; absence simply means no warning is possible.
   */
  name?: string | null;
  /** SLICE 17 — CCRS inventory type, same warning-only purpose as `name`. */
  inventoryType?: string | null;
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
  /**
   * SLICE 17 — non-blocking advisories. Today this carries the "this looks
   * like a suppository and nobody has classified it" notice. A warning NEVER
   * affects `blocked`; it exists so an invisible gap becomes visible.
   */
  warnings: string[];
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
  /**
   * SLICE 17 — the clamp for a bucket counted in ITEMS rather than mass.
   *
   * Identical tighten-only semantics, plus a floor. Migration 0217 puts a
   * `= floor(...)` CHECK on both settings columns so the back office cannot
   * write a fraction, but this function's parameter is `raw: unknown` and it is
   * the choke point for values arriving from ANY source — a legacy row written
   * before that constraint existed, a hand-edited override, a future import.
   * The constraint guards the write; this guards the read.
   *
   * FLOOR, never round: 9.99 must become 9. Rounding up would hand back a unit
   * the owner deliberately took away, which is the one direction a clamp is
   * never allowed to move.
   *
   * If flooring would produce zero (any cap between 0 and 1), fall back to the
   * statutory figure. A cap of zero is not a strict limit, it is an outage —
   * it would block every suppository sale in the shop, and a limit that
   * silently turns into a total ban is a worse failure than the fraction.
   */
  const clampUnits = (v: unknown, max: number): number => {
    const floored = Math.floor(clamp(v, max));
    return floored >= 1 ? floored : max;
  };
  return {
    usable: clamp(r.usable, base.usable),
    solid_edible: clamp(r.solid_edible, base.solid_edible),
    concentrate: clamp(r.concentrate, base.concentrate),
    liquid_edible: clamp(r.liquid_edible, base.liquid_edible),
    // SLICE 16 — mg THC, same clamp semantics: the owner may tighten below
    // 200 mg, never widen above it.
    low_thc_liquid: clamp(r.low_thc_liquid, base.low_thc_liquid),
    // SLICE 17 — a COUNT. Same "tighten only" semantics, and additionally
    // floored to an integer: a limit of 10.5 units is not a thing, and a
    // fractional ceiling would make the boundary test ambiguous.
    otherwise_taken: clampUnits(r.otherwise_taken, base.otherwise_taken),
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
      otherwise_taken: overrides?.otherwise_taken ?? base.otherwise_taken,
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
 * SLICE 17 — does this line count against the ten-unit "otherwise taken into
 * the body" allowance? WAC 314-55-095(1)(d)(i)(D) + WAC 314-55-010(40).
 *
 * BOTH must hold:
 *   1. the owner has EXPLICITLY flagged the product at intake, and
 *   2. the product's category is one that could plausibly be administered this
 *      way — in Greenway's taxonomy that is `topical`, which is where the CCRS
 *      "Suppository" end-product type already resolves.
 *
 * Requirement 2 is a guard rail, not the classification. It exists so that a
 * mis-set flag on a flower or gummy line cannot silently move that line out of
 * the bucket the statute actually assigns it to. The flag alone never decides.
 *
 * The flag must be LITERALLY `true`. A string "true", a 1, or any other truthy
 * value returns false — an intake bug must never widen an allowance.
 */
export function qualifiesAsOtherwiseTaken(line: LimitCartLine): boolean {
  if (line.otherwiseTaken !== true) return false;
  return categoryToBucket(line.category) === "liquid_edible";
}

/**
 * SLICE 17 — how many UNITS this line contributes to the ten-unit bucket.
 *
 * units = quantity × unitsPerPackage
 *
 * RCW 69.50.101 defines a "unit" as an individual consumable item and a
 * "package" as a container holding one or more units. So the sellable thing on
 * the shelf may be a package of six, and it consumes six of the ten. When
 * `unitsPerPackage` is absent the package IS the unit and the multiplier is 1.
 *
 * Both factors are floored to integers: you cannot sell a fraction of a
 * suppository, and a fractional count would make the ten-unit boundary
 * ambiguous. A zero/negative/NaN multiplier falls back to 1 rather than 0 —
 * falling back to zero would silently erase the line from the limit entirely,
 * which is the one outcome we can never allow.
 */
export function lineUnits(line: LimitCartLine): number {
  if (!qualifiesAsOtherwiseTaken(line)) return 0;
  const qtyRaw = Number.isFinite(line.quantity) ? line.quantity : 0;
  const qty = Math.max(0, Math.floor(qtyRaw));
  const perRaw = typeof line.unitsPerPackage === "number" ? line.unitsPerPackage : NaN;
  const per = Number.isFinite(perRaw) && perRaw >= 1 ? Math.floor(perRaw) : 1;
  return qty * per;
}

/**
 * SLICE 17 — does this product LOOK like something otherwise taken into the
 * body, judged only by its name and CCRS inventory type?
 *
 * This is a DETECTOR, never a classifier. It exists because of the inverted
 * fail-safe documented in the header: an unflagged suppository lands in the
 * 72 oz liquid bucket where it is effectively unlimited, so "nobody classified
 * it" must be made VISIBLE rather than silently permissive. evaluateCart turns
 * a hit on an unclassified line into a warning; it never blocks on this.
 *
 * Deliberately narrow. It matches suppository/suppositories and the two CCRS
 * spellings, and NOTHING else. It specifically must NOT match:
 *   - transdermal patches — WAC 314-55-010(40) excludes external application
 *     to the skin, so a patch belongs in the 72 oz bucket;
 *   - sublingual tinctures — 010(40) excludes oral ingestion.
 * Both are commonly assumed to belong here. They do not.
 */
export function suspectsOtherwiseTaken(input: {
  name?: string | null;
  inventoryType?: string | null;
}): boolean {
  const hay = `${input.name ?? ""} ${input.inventoryType ?? ""}`.toLowerCase();
  if (!hay.trim()) return false;
  return /suppositor(?:y|ies)|\bsupp\b/.test(hay);
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
  // SLICE 17 first: a flagged suppository leaves liquid_edible entirely.
  // Checked BEFORE the low-THC carve-out because the two flags are about
  // different products and a line carrying both is a data error; routing it to
  // the ITEM-COUNTED bucket is the conservative resolution (ten units is a far
  // tighter cap than 200 mg of THC).
  if (qualifiesAsOtherwiseTaken(line)) return "otherwise_taken";
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

/**
 * SLICE L4 — millilitres a single cart line contributes to the liquid bucket.
 *
 * Three sources, in strict priority order:
 *
 *  1. A REAL measured volume (`volumeMl`), plumbed from the product name by
 *     SLICE L3. This is the fix: it is the only source that can tell a 30 ml
 *     dropper from a 1.5 L growler.
 *
 *  2. A weight measure (`grams`, from the variant label via AN-1), carried
 *     across AT ITS OUNCE-COUNT: grams / 28 * 29.5735. This is NOT a density
 *     conversion and does not pretend to be one — it preserves "how many of
 *     the statute's 72 ounces does this package use", which is exactly what
 *     the grams basis was already computing correctly. It is what keeps
 *     ounce-labelled liquids and every weight-based TOPICAL behaving
 *     identically to before this slice.
 *
 *  3. The category default, carried across the same way, so a line nobody has
 *     measured still consumes allowance instead of being silently free.
 *
 * Returns 0 only for a genuinely zero/absent quantity.
 */
export function lineMl(line: LimitCartLine, overrides?: LimitOverrides): number {
  // 1. a real, measured volume for the whole line
  if (typeof line.volumeMl === "number" && line.volumeMl > 0) return round3(line.volumeMl);
  // 2/3. fall back to the weight basis, carried across at its ounce-count
  const grams = lineGrams(line, overrides);
  if (grams <= 0) return 0;
  return round3((grams / GRAMS_PER_OUNCE) * ML_PER_FLUID_OUNCE);
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
    otherwise_taken: 0,
  };
  let untrackedLines = 0;
  // SLICE 17 — lines that look like a suppository but were never classified.
  const unclassifiedSuspects: string[] = [];

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
    const contribution =
      bucket === "low_thc_liquid"
        ? lineThcMg(line)
        // SLICE L4 — the liquid bucket accumulates MILLILITRES against a
        // 2129.292 ml (72 fl oz) cap. Before this, it accumulated grams
        // against 2016 g, and since ml/fl oz/L labels produced no per-unit
        // weight at all, every liquid used the 28 g default and 72 packages
        // of ANY size fit.
        : bucket === "liquid_edible"
          ? lineMl(line, overrides)
          : bucket === "otherwise_taken"
            ? lineUnits(line)
            : lineGrams(line, overrides);
    totals[bucket] = round3(totals[bucket] + contribution);

    // SLICE 17 — the inverted fail-safe. A line that LOOKS like a suppository
    // but carries no classification at all (null/undefined — NOT an explicit
    // false, which means a human already answered the question) is surfaced as
    // a warning. It is not blocked: a name regex is evidence, not a fact.
    if (
      line.otherwiseTaken === undefined ||
      line.otherwiseTaken === null
    ) {
      if (suspectsOtherwiseTaken({ name: line.name, inventoryType: line.inventoryType })) {
        unclassifiedSuspects.push((line.name ?? "unnamed product").trim());
      }
    }
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

  // SLICE 17 — warn (never block) about unclassified suppository suspects.
  const warnings: string[] = unclassifiedSuspects.map(
    (n) =>
      `"${n}" looks like a suppository but has not been classified. Products otherwise taken ` +
      `into the body are limited to ${formatLimitAmount("otherwise_taken", RECREATIONAL_LIMITS.otherwise_taken)} ` +
      `per transaction (WAC 314-55-095(1)(d)(i)(D)). Until it is classified it counts toward the ` +
      `liquid allowance instead. Classify it on the menu-import facts screen (for imported ` +
      `products) or in Product Onboarding (for anything received on a manifest).`,
  );

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
    warnings,
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
  // SLICE L4 — rebased to millilitres: 72 FLUID ounces, not 72 weight ounces.
  ok(
    Math.abs(RECREATIONAL_LIMITS.liquid_edible - 72 * 29.5735) < 1e-6,
    "rec liquid 72 fl oz = 2129.292 ml",
  );
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
      .liquid_edible === REC_LIQUID_ML,
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
