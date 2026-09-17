// Leafly Menu Integration API v2.0 — THE FIELD CONTRACT.
//
// WHY THIS FILE EXISTS
// --------------------
// `docs/leafly-menu-api-v2.md` used to say "camelCase convention for all fields", and
// `payload-core.ts` repeated that claim in its header comment. Both were WRONG, and eight
// field-level defects descend from them. Validating our real generated payload against
// Leafly's live published JSON Schema produced four hard schema errors before a single
// credential was ever exercised — the first menu push would have returned HTTP 400.
//
// The truth, proven by diffing Leafly's live v1 and v2 schemas
// (`docs/leafly-specs/schemas/`):
//
//   v1 -> v2 renamed  image_url      -> imageUrl
//   v1 -> v2 renamed  inventory_level -> inventoryLevel
//   v1 -> v2 renamed  available_for_pickup -> availableForPickup
//   v1 -> v2 ADDED    total_thc, total_cbd   <-- snake_case, brand new in v2
//   v1 -> v2 KEPT     brand, strain          <-- NEVER renamed, no *Name suffix
//
// So v2 is camelCase EXCEPT `total_thc` and `total_cbd`. Whoever wrote the old doc saw the
// image_url/inventory_level renames and over-generalised them into a rule that does not
// exist. Anyone who "tidies" this contract by applying a uniform camelCase transform will
// silently re-break the two cannabinoid fields and get a 400 on every item.
//
// This module is PURE (no DB, no network, no "server-only") so it can be unit-tested
// directly and imported by both the mapper and the drift tests. It deliberately contains
// NO mapping logic — it is the vocabulary, not the translator. Slice L-2 rewrites
// `payload-core.ts` against these constants.
//
// Ground truth: docs/leafly-specs/schemas/v2-items.json (see docs/leafly-specs/SOURCES.md)

/** Wire field names for a Leafly v2 menu ITEM. */
export const LEAFLY_ITEM_FIELDS = {
  id: "id",
  type: "type",
  name: "name",
  strain: "strain",
  brand: "brand",
  compounds: "compounds",
  totalThc: "total_thc",
  totalCbd: "total_cbd",
  variants: "variants",
  description: "description",
  availableForPickup: "availableForPickup",
  imageUrl: "imageUrl",
} as const;

/** Wire field names for a Leafly v2 menu VARIANT. */
export const LEAFLY_VARIANT_FIELDS = {
  id: "id",
  medical: "medical",
  price: "price",
  amount: "amount",
  unit: "unit",
  inventoryLevel: "inventoryLevel",
} as const;

/** Wire field names for a Leafly v2 COMPOUND (and for total_thc / total_cbd). */
export const LEAFLY_COMPOUND_FIELDS = {
  type: "type",
  content: "content",
  unit: "unit",
} as const;

/**
 * Required item fields, per `v2-items.json`.
 * Note what is NOT here: `brand`, `strain`, `description`, `compounds`, `imageUrl` and
 * `availableForPickup` are all OPTIONAL. Omitting them is legal; getting their NAME wrong
 * is not a 400, it is silent data loss, which is worse.
 */
export const LEAFLY_ITEM_REQUIRED = ["id", "type", "name", "variants"] as const;

/** Required variant fields, per `v2-items.json`. All six are mandatory. */
export const LEAFLY_VARIANT_REQUIRED = [
  "id",
  "medical",
  "price",
  "amount",
  "unit",
  "inventoryLevel",
] as const;

/** Required compound fields, per `v2-items.json`. */
export const LEAFLY_COMPOUND_REQUIRED = ["type", "content", "unit"] as const;

/**
 * Legal `compounds[].unit` / `total_thc.unit` / `total_cbd.unit` values.
 * `"%"` IS NOT LEGAL — that was defect L-03. The percent unit is spelled `percent`.
 */
export const LEAFLY_COMPOUND_UNITS = ["percent", "mg"] as const;
export type LeaflyCompoundUnit = (typeof LEAFLY_COMPOUND_UNITS)[number];

/** Legal `variants[].unit` values. */
export const LEAFLY_VARIANT_UNITS = ["oz", "g", "each"] as const;
export type LeaflyVariantUnit = (typeof LEAFLY_VARIANT_UNITS)[number];

/** Legal `compounds[].type` values (25 of them), per `v2-items.json`. */
export const LEAFLY_COMPOUND_TYPES = [
  "thc",
  "cbd",
  "cbc",
  "cbca",
  "cbcv",
  "cbda",
  "cbdml",
  "cbdv",
  "cbdva",
  "cbg",
  "cbga",
  "cbl",
  "cbla",
  "cbn",
  "cbna",
  "cbt",
  "tac",
  "thca",
  "thcha",
  "thc_d8",
  "thc_d9",
  "thc_d10",
  "thcml",
  "thcv",
  "thcva",
] as const;
export type LeaflyCompoundType = (typeof LEAFLY_COMPOUND_TYPES)[number];

/**
 * The ten categories Leafly funnels `item.type` into.
 *
 * `item.type` itself is a FREE-TEXT string in the schema (`minLength: 1`), NOT an enum, so
 * a wrong value does NOT produce a 400 — Leafly silently miscategorises the product on the
 * storefront. That is the worst possible failure mode: invisible. Emitting a value that
 * matches a funnel target exactly removes the guesswork.
 */
export const LEAFLY_FUNNEL_TYPES = [
  "Accessory",
  "Seeds",
  "Clone",
  "Flower",
  "Edible",
  "PreRoll",
  "Concentrate",
  "Cartridge",
  "Topical",
  "Other",
] as const;
export type LeaflyFunnelType = (typeof LEAFLY_FUNNEL_TYPES)[number];

/**
 * Which `variant.unit` values Leafly documents as valid for each funnel type, and which
 * `compound.unit` applies. Verbatim from the `variant.unit` and `compound.unit` tables in
 * `v2-items.json`.
 *
 * This is why `item.type` and `variant.unit` cannot be chosen independently: a Flower item
 * priced `each`, or an Edible measured in `percent`, is a data-quality defect even though
 * both values are individually in-enum. Leafly grades data quality at certification.
 *
 * `compoundUnit: null` means Leafly ignores compounds for that type entirely.
 */
export const LEAFLY_TYPE_UNIT_MATRIX: Readonly<
  Record<
    LeaflyFunnelType,
    { readonly variantUnits: readonly LeaflyVariantUnit[]; readonly compoundUnit: LeaflyCompoundUnit | null }
  >
> = {
  Accessory: { variantUnits: ["each"], compoundUnit: null },
  Seeds: { variantUnits: ["each"], compoundUnit: null },
  Clone: { variantUnits: ["each"], compoundUnit: null },
  Flower: { variantUnits: ["g", "oz"], compoundUnit: "percent" },
  Edible: { variantUnits: ["each"], compoundUnit: "mg" },
  PreRoll: { variantUnits: ["each"], compoundUnit: "percent" },
  Concentrate: { variantUnits: ["each", "g"], compoundUnit: "percent" },
  Cartridge: { variantUnits: ["each", "g"], compoundUnit: "percent" },
  Topical: { variantUnits: ["each"], compoundUnit: null },
  Other: { variantUnits: ["each"], compoundUnit: null },
} as const;

/**
 * Fields that existed in v1 and are GONE in v2. Sending them is not merely useless; it is
 * the signature of code written against the old spec.
 */
export const LEAFLY_V1_REMOVED_ITEM_FIELDS = [
  "available_for_pickup",
  "batchId",
  "image_url",
  "parentBatchId",
  "sku",
] as const;

export const LEAFLY_V1_REMOVED_VARIANT_FIELDS = [
  "batch_id",
  "inventory_level",
  "parent_batch_id",
  "price_includes_tax",
  "sku",
  "tax_rate",
] as const;

/**
 * Field names that LOOK plausible but are NOT in the v2 contract. Every one of these is a
 * real defect found in `payload-core.ts`, kept here so the drift test can assert none of
 * them ever reappears. The value is the correct name.
 */
export const LEAFLY_FORBIDDEN_FIELD_ALIASES: Readonly<Record<string, string>> = {
  brandName: "brand",
  strainName: "strain",
  totalThc: "total_thc",
  totalCbd: "total_cbd",
  value: "content",
  inventory_level: "inventoryLevel",
  image_url: "imageUrl",
  available_for_pickup: "availableForPickup",
} as const;

/** `variants[].inventoryLevel` is internally capped at this value by Leafly. */
export const LEAFLY_INVENTORY_LEVEL_CAP = 10;

/** `variants[].price` is an integer in MINOR units (cents) with `minimum: 1`. */
export const LEAFLY_PRICE_MIN_MINOR_UNITS = 1;

/** Every item must carry at least this many variants (`minItems: 1`). */
export const LEAFLY_MIN_VARIANTS_PER_ITEM = 1;

/** Is `unit` legal for `compounds[].unit` / `total_thc.unit` / `total_cbd.unit`? */
export function isLeaflyCompoundUnit(unit: unknown): unit is LeaflyCompoundUnit {
  return typeof unit === "string" && (LEAFLY_COMPOUND_UNITS as readonly string[]).includes(unit);
}

/** Is `unit` legal for `variants[].unit`? */
export function isLeaflyVariantUnit(unit: unknown): unit is LeaflyVariantUnit {
  return typeof unit === "string" && (LEAFLY_VARIANT_UNITS as readonly string[]).includes(unit);
}

/** Is `type` legal for `compounds[].type`? */
export function isLeaflyCompoundType(type: unknown): type is LeaflyCompoundType {
  return typeof type === "string" && (LEAFLY_COMPOUND_TYPES as readonly string[]).includes(type);
}

/** Does `type` exactly match one of Leafly's ten funnel targets? */
export function isLeaflyFunnelType(type: unknown): type is LeaflyFunnelType {
  return typeof type === "string" && (LEAFLY_FUNNEL_TYPES as readonly string[]).includes(type);
}

/**
 * The `compound.unit` Leafly expects for a given funnel type, or `null` when Leafly
 * ignores compounds for that type. Unknown type -> `null` (never guess a unit).
 */
export function compoundUnitForType(type: string): LeaflyCompoundUnit | null {
  if (!isLeaflyFunnelType(type)) return null;
  return LEAFLY_TYPE_UNIT_MATRIX[type].compoundUnit;
}

/** Is `unit` a documented `variant.unit` for this funnel type? */
export function isVariantUnitValidForType(type: string, unit: string): boolean {
  if (!isLeaflyFunnelType(type)) return false;
  return (LEAFLY_TYPE_UNIT_MATRIX[type].variantUnits as readonly string[]).includes(unit);
}

/* -------------------------------------------------------------------------- */
/* Self-tests                                                                 */
/* -------------------------------------------------------------------------- */

export function __runLeaflyContractTests(): void {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`FAIL: ${label}`);
    }
  };

  // The two snake_case exceptions — the entire reason this file exists.
  ok("total_thc is snake_case", LEAFLY_ITEM_FIELDS.totalThc === "total_thc");
  ok("total_cbd is snake_case", LEAFLY_ITEM_FIELDS.totalCbd === "total_cbd");
  ok("brand has no Name suffix", LEAFLY_ITEM_FIELDS.brand === "brand");
  ok("strain has no Name suffix", LEAFLY_ITEM_FIELDS.strain === "strain");
  ok("imageUrl is camelCase", LEAFLY_ITEM_FIELDS.imageUrl === "imageUrl");
  ok(
    "availableForPickup is camelCase",
    LEAFLY_ITEM_FIELDS.availableForPickup === "availableForPickup",
  );
  ok("inventoryLevel is camelCase", LEAFLY_VARIANT_FIELDS.inventoryLevel === "inventoryLevel");
  ok("compound value field is content", LEAFLY_COMPOUND_FIELDS.content === "content");

  // Units.
  ok("percent is spelled out", isLeaflyCompoundUnit("percent"));
  ok('"%" is NOT a legal unit', !isLeaflyCompoundUnit("%"));
  ok("mg is legal", isLeaflyCompoundUnit("mg"));
  ok("g is not a compound unit", !isLeaflyCompoundUnit("g"));
  ok("g is a variant unit", isLeaflyVariantUnit("g"));
  ok("each is a variant unit", isLeaflyVariantUnit("each"));
  ok("percent is not a variant unit", !isLeaflyVariantUnit("percent"));

  // Compound types.
  ok("thc is a compound type", isLeaflyCompoundType("thc"));
  ok("thc_d9 is a compound type", isLeaflyCompoundType("thc_d9"));
  ok("compound type count is 25", LEAFLY_COMPOUND_TYPES.length === 25);
  ok("THC uppercase is rejected", !isLeaflyCompoundType("THC"));

  // Funnel types — note the exact casing Leafly funnels into.
  ok("Flower is a funnel type", isLeaflyFunnelType("Flower"));
  ok("PreRoll is a funnel type", isLeaflyFunnelType("PreRoll"));
  ok("funnel type count is 10", LEAFLY_FUNNEL_TYPES.length === 10);
  ok('lowercase "flower" is not a funnel type', !isLeaflyFunnelType("flower"));
  ok('"pre-roll" is not a funnel type', !isLeaflyFunnelType("pre-roll"));
  ok('"topicals" is not a funnel type', !isLeaflyFunnelType("topicals"));
  ok('"tincture" is not a funnel type', !isLeaflyFunnelType("tincture"));

  // Type/unit matrix.
  ok("Flower compounds are percent", compoundUnitForType("Flower") === "percent");
  ok("Edible compounds are mg", compoundUnitForType("Edible") === "mg");
  ok("Other compounds ignored", compoundUnitForType("Other") === null);
  ok("unknown type yields no unit", compoundUnitForType("nonsense") === null);
  ok("Flower may be g", isVariantUnitValidForType("Flower", "g"));
  ok("Flower may be oz", isVariantUnitValidForType("Flower", "oz"));
  ok("Flower may NOT be each", !isVariantUnitValidForType("Flower", "each"));
  ok("Edible may be each", isVariantUnitValidForType("Edible", "each"));
  ok("Edible may NOT be g", !isVariantUnitValidForType("Edible", "g"));
  ok("Cartridge may be g", isVariantUnitValidForType("Cartridge", "g"));

  // Required sets.
  ok("item requires 4 fields", LEAFLY_ITEM_REQUIRED.length === 4);
  ok("variant requires 6 fields", LEAFLY_VARIANT_REQUIRED.length === 6);
  ok("variant requires amount", (LEAFLY_VARIANT_REQUIRED as readonly string[]).includes("amount"));
  ok("variant requires unit", (LEAFLY_VARIANT_REQUIRED as readonly string[]).includes("unit"));
  ok(
    "variant requires medical",
    (LEAFLY_VARIANT_REQUIRED as readonly string[]).includes("medical"),
  );
  ok(
    "brand is NOT required",
    !(LEAFLY_ITEM_REQUIRED as readonly string[]).includes("brand"),
  );
  ok("compound requires content", (LEAFLY_COMPOUND_REQUIRED as readonly string[]).includes("content"));

  // Forbidden aliases map to their real names.
  ok("brandName -> brand", LEAFLY_FORBIDDEN_FIELD_ALIASES.brandName === "brand");
  ok("totalThc -> total_thc", LEAFLY_FORBIDDEN_FIELD_ALIASES.totalThc === "total_thc");
  ok("value -> content", LEAFLY_FORBIDDEN_FIELD_ALIASES.value === "content");
  ok(
    "no forbidden alias is also a real field",
    Object.keys(LEAFLY_FORBIDDEN_FIELD_ALIASES).every(
      (alias) =>
        !(Object.values(LEAFLY_ITEM_FIELDS) as readonly string[]).includes(alias) &&
        !(Object.values(LEAFLY_VARIANT_FIELDS) as readonly string[]).includes(alias),
    ),
  );

  // Numeric limits.
  ok("inventory cap is 10", LEAFLY_INVENTORY_LEVEL_CAP === 10);
  ok("min price is 1 minor unit", LEAFLY_PRICE_MIN_MINOR_UNITS === 1);
  ok("min 1 variant per item", LEAFLY_MIN_VARIANTS_PER_ITEM === 1);

  // v1 removals.
  ok(
    "sku was removed from items",
    (LEAFLY_V1_REMOVED_ITEM_FIELDS as readonly string[]).includes("sku"),
  );
  ok(
    "tax_rate was removed from variants",
    (LEAFLY_V1_REMOVED_VARIANT_FIELDS as readonly string[]).includes("tax_rate"),
  );
  ok(
    "no removed item field is still a live field",
    LEAFLY_V1_REMOVED_ITEM_FIELDS.every(
      (f) => !(Object.values(LEAFLY_ITEM_FIELDS) as readonly string[]).includes(f),
    ),
  );
  ok(
    "no removed variant field is still a live field",
    LEAFLY_V1_REMOVED_VARIANT_FIELDS.every(
      (f) => !(Object.values(LEAFLY_VARIANT_FIELDS) as readonly string[]).includes(f),
    ),
  );

  console.log(`leafly-contract: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} leafly-contract test(s) failed`);
}
