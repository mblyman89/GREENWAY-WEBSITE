/**
 * src/lib/leafly/payload-core.ts
 *
 * Pure mapper: Greenway `SyndicationItem[]` -> Leafly Menu Integration API v2.0 wire format.
 *
 * SLICE L-2 REWRITE. Every field name, type, enum and required-flag in this file is taken
 * from the VENDORED LIVE SCHEMA at `docs/leafly-specs/schemas/v2-items.json`, by way of the
 * vocabulary in `contract-core.ts`. Nothing here is grounded in prose.
 *
 * WHY THAT SENTENCE MATTERS
 * -------------------------
 * The previous version of this file opened by saying it was "grounded entirely in the
 * owner-supplied OpenAPI spec ... Key v2 rules encoded here: camelCase fields". That claim
 * was false, and it was load-bearing: EIGHT of the eleven menu defects in the readiness
 * report descend from it. v2 is camelCase *except* `total_thc` and `total_cbd`, which are
 * literally snake_case in the published schema, and the v1->v2 diff proves the rename was
 * partial rather than universal. A prose claim cannot fail CI. That is why this module is
 * now written against `contract-core.ts`, and why `tests/compliance/leafly-payload.test.ts`
 * validates real generated payloads against the real JSON Schema.
 *
 * WHAT CHANGED, AND WHICH FINDING IT CLOSES
 *   L-01  variant.amount is now emitted (required; was absent entirely)
 *   L-02  variant.unit is now emitted, from the oz|g|each enum (was absent)
 *   L-03  variant.label is GONE -- it is not a v2 field. The weight it carried is now
 *         parsed into amount+unit, which is where Leafly actually looks for it.
 *   L-04  compound value field renamed  value    -> content
 *   L-05  compound percent unit renamed "%"      -> "percent"
 *   L-06  item brand field renamed      brandName -> brand
 *   L-07  item strain field renamed     strainName -> strain
 *   L-08  totals renamed                totalThc/totalCbd -> total_thc/total_cbd
 *   L-12  item.type now emits Leafly's ten funnel targets exactly, including the
 *         Cartridge target that was previously folded into Concentrate
 *
 * THREE MORE DEFECTS FOUND DURING THIS SLICE, none of which were in the report. All three
 * are the same shape: a field the old code sent as `null` that the schema does not allow
 * to be null. They are documented at their emit sites below.
 *
 * THE RULE THIS FILE WILL NOT BREAK
 * ---------------------------------
 * Standing rule 3: never silently invent a value. Where the source data cannot answer a
 * question Leafly requires an answer to -- above all, "how much is in this package?" --
 * this module does NOT guess a plausible number. It refuses to emit the variant and says
 * why, and `payload-validate-core.ts` turns that into an error a human resolves. A wrong
 * weight on a cannabis menu is a compliance problem, not a cosmetic one.
 *
 * PURE: no DB, no network, no `server-only`. Unit-testable directly.
 */

import type { SyndicationItem, SyndicationVariant } from "../syndication/menu-feed-core";
import { parseWeightFromLabel } from "../weedmaps/payload-core";
import {
  decideOrderability,
  resolveVariantMedical,
  type VariantMedicalInput,
} from "./orderability-core";
import {
  LEAFLY_TYPE_UNIT_MATRIX,
  compoundUnitForType,
  isLeaflyFunnelType,
  type LeaflyCompoundType,
  type LeaflyCompoundUnit,
  type LeaflyFunnelType,
  type LeaflyVariantUnit,
} from "./contract-core";

// ---------------------------------------------------------------------------
// Wire types -- these mirror v2-items.json exactly.
// ---------------------------------------------------------------------------

/**
 * An entry in `item.compounds`. All three properties are required by the schema.
 * `content` is nullable ("Use `null` for unknown or not tested values instead of `0`").
 */
export type LeaflyCompound = {
  type: LeaflyCompoundType;
  content: number | null;
  unit: LeaflyCompoundUnit;
};

/**
 * `item.total_thc` / `item.total_cbd`.
 *
 * NOTE THE SHAPE: the schema gives these `content` and `unit` ONLY -- `required: ["content",
 * "unit"]` with no `type` property. The old code reused its compound object here, so it
 * also sent a `type` field that the totals contract does not define. Emitting exactly what
 * is specified is free; relying on Leafly to ignore a surplus field is not.
 */
export type LeaflyTotalCompound = {
  content: number | null;
  unit: LeaflyCompoundUnit;
};

/**
 * An entry in `item.variants`. The schema marks ALL SIX of these required, which is why
 * the old variant shape (which carried `label` and no `amount`/`unit`) could never have
 * validated.
 *
 * `id` is `["number","string"]` in the schema; we always send a string, which is the
 * stricter and stabler of the two, and the schema's own note says the variant id "takes
 * precedence over top-level id for order integration purposes" -- so these ids become the
 * join key when Leafly starts sending us orders in L-5.
 */
export type LeaflyVariant = {
  id: string;
  medical: boolean;
  price: number;
  amount: number;
  unit: LeaflyVariantUnit;
  inventoryLevel: number;
};

/**
 * A menu item.
 *
 * Optionality here is not a style choice -- it is copied from the schema, and it is the
 * source of the three new defects. `brand` and `description` are declared `type: "string"`
 * with NO null in the type union, so they are optional-or-string and NEVER null. `strain`
 * and `imageUrl` are declared `["string","null"]`, so null is meaningful for those two.
 * The old code sent `null` for all of them uniformly.
 */
export type LeaflyItem = {
  id: string;
  type: LeaflyFunnelType;
  name: string;
  variants: LeaflyVariant[];
  /** Nullable per schema. Leafly links known strains on the storefront. Never "NA". */
  strain?: string | null;
  /** NOT nullable per schema -- omitted when absent. */
  brand?: string;
  compounds?: LeaflyCompound[];
  total_thc?: LeaflyTotalCompound;
  total_cbd?: LeaflyTotalCompound;
  /** NOT nullable per schema -- omitted when absent. */
  description?: string;
  /** Omit to leave the current setting untouched. New items default to FALSE. */
  availableForPickup?: boolean;
  /** Nullable per schema; null or omitted REMOVES any existing image. */
  imageUrl?: string | null;
};

export type LeaflyItemsPayload = { items: LeaflyItem[] };
export type LeaflyDeletePayload = { ids: string[] };

/**
 * Why a variant could not be represented on the wire. Returned instead of a guess.
 * `payload-validate-core.ts` renders these for a human; nothing auto-resolves them.
 */
export type LeaflyVariantRejection = {
  itemId: string;
  variantId: string;
  label: string;
  reason: string;
};

// ---------------------------------------------------------------------------
// item.type -- Greenway category -> Leafly funnel target
// ---------------------------------------------------------------------------

/**
 * `item.type` is FREE TEXT in the schema (`minLength: 1`), not an enum. That is precisely
 * what makes getting it wrong dangerous: a bad value does not 400, it silently lands the
 * product in the wrong place on the storefront, or in no place a shopper filters by.
 * Leafly documents that it funnels the value to one of ten targets, so we emit those ten
 * targets verbatim and never send a value that has to be guessed at.
 *
 * Two corrections to the old table, both defect L-12:
 *   - `cartridge` / `disposable-cartridge` now funnel to **Cartridge**, not Concentrate.
 *     This is not cosmetic: the type decides which `variant.unit` values are legal, and
 *     it decides which Leafly filter a shopper finds the product under.
 *   - `tincture` no longer emits the invented value "tincture". There is no such funnel
 *     target. Tinctures are ingested liquids, so they funnel to **Edible**, which also
 *     carries the correct `mg` compound unit.
 *
 * Every one of the Greenway categories in `category-taxonomy.ts` is mapped explicitly.
 * An unmapped category falls to `Other`, which is a real funnel target and is honest --
 * but the validator flags it, because `Other` means "Leafly ignores this item's compounds".
 */
const CATEGORY_TO_LEAFLY_TYPE: Readonly<Record<string, LeaflyFunnelType>> = {
  // Flower family -- measured by weight
  flower: "Flower",
  "popcorn-bud": "Flower",
  "infused-flower": "Flower",
  trim: "Flower",

  // Pre-rolls -- sold as pieces
  preroll: "PreRoll",
  "preroll-pack": "PreRoll",
  "infused-preroll": "PreRoll",
  "infused-preroll-pack": "PreRoll",
  blunt: "PreRoll",
  "infused-blunt": "PreRoll",

  // Concentrates vs cartridges -- Leafly separates these, so we do too (L-12)
  concentrate: "Concentrate",
  rso: "Concentrate",
  cartridge: "Cartridge",
  "disposable-cartridge": "Cartridge",

  // Ingested
  "edible-solid": "Edible",
  "edible-liquid": "Edible",
  tincture: "Edible",

  // Applied
  topical: "Topical",

  // Non-cannabis
  paraphernalia: "Accessory",
  accessories: "Accessory",
  merch: "Accessory",
};

export function toLeaflyType(category: string): LeaflyFunnelType {
  return CATEGORY_TO_LEAFLY_TYPE[category] ?? "Other";
}

/** Categories this mapper knows about. Exposed so tests can prove none was forgotten. */
export function mappedLeaflyCategories(): string[] {
  return Object.keys(CATEGORY_TO_LEAFLY_TYPE);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Strip markup -> plain text. Leafly requires plain-text descriptions. */
export function toPlainText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text : null;
}

// ---------------------------------------------------------------------------
// Compounds
// ---------------------------------------------------------------------------

/**
 * Parse a stored cannabinoid reading into Leafly's compound shape.
 *
 * TWO DEFECTS CLOSED HERE.
 *
 * L-04: the value field is `content`, not `value`.
 *
 * L-05: the percent unit is spelled `percent`. The old code emitted `"%"`, which is not in
 * the enum `["percent","mg"]`. Note what that means in practice -- `unit` is a REQUIRED
 * property, so `"%"` is a hard schema violation on every single item carrying a THC
 * reading. That is essentially the whole menu.
 *
 * The unit is decided by the ITEM TYPE, not by sniffing the string, because Leafly's own
 * table ties them together: Flower/PreRoll/Concentrate/Cartridge report `percent`, Edible
 * reports `mg`. Sniffing "mg" out of the text is how an edible's milligrams end up on a
 * flower item. When Leafly ignores compounds for a type (Accessory, Topical, Other,
 * Seeds, Clone) this returns null and the field is simply not sent.
 *
 * A present-but-unreadable reading yields `content: null` -- explicitly "unknown", which
 * the schema asks for -- rather than 0, which would assert the product tested at zero.
 */
export function toCompound(
  type: LeaflyCompoundType,
  raw: string | number | null | undefined,
  itemType: LeaflyFunnelType,
): LeaflyCompound | null {
  const unit = compoundUnitForType(itemType);
  if (unit === null) return null; // Leafly ignores compounds for this type

  if (raw == null) return null;
  const asString = String(raw).trim();
  if (asString.length === 0) return null;

  const numeric = Number.parseFloat(asString.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric)) return { type, content: null, unit };
  return { type, content: numeric, unit };
}

/** The totals carry no `type` -- see LeaflyTotalCompound. */
export function toTotalCompound(compound: LeaflyCompound | null): LeaflyTotalCompound | null {
  if (compound === null) return null;
  return { content: compound.content, unit: compound.unit };
}

// ---------------------------------------------------------------------------
// Variants -- amount + unit (L-01, L-02, L-03)
// ---------------------------------------------------------------------------

/**
 * Turn a parsed label weight into a legal Leafly `variant.unit` + `amount`.
 *
 * Leafly's enum is `oz | g | each`. Our label parser also recognises mg, kg and lb, so
 * this decides what to do with each:
 *
 *   g, oz  -> used directly.
 *   kg     -> converted to g (x1000). An exact conversion inside the same measurement
 *             system. No information is created.
 *   lb     -> converted to oz (x16). Same reasoning.
 *   mg     -> REFUSED for weight-measured types, deliberately.
 *
 * The mg refusal is the interesting one, and it is a rule-3 decision. Converting mg to g is
 * arithmetically exact, so it is tempting. But a flower or concentrate variant labelled in
 * milligrams is almost always mis-entered data, not a genuinely 0.1g package -- milligrams
 * are how EDIBLES are dosed. Converting would launder a data-entry error into a
 * plausible-looking wrong weight that nobody would ever catch. Refusing surfaces it to a
 * human. We would rather hold one item off the menu than publish a confident wrong number.
 */
export function weightToLeaflyAmount(
  weight: { unit: string; value: number } | null,
): { amount: number; unit: LeaflyVariantUnit } | null {
  if (weight === null || !Number.isFinite(weight.value) || weight.value <= 0) return null;
  switch (weight.unit) {
    case "g":
      return { amount: weight.value, unit: "g" };
    case "oz":
      return { amount: weight.value, unit: "oz" };
    case "kg":
      return { amount: weight.value * 1000, unit: "g" };
    case "lb":
      return { amount: weight.value * 16, unit: "oz" };
    default:
      return null; // mg, and anything else we do not trust
  }
}

/**
 * Decide `amount` + `unit` for one variant of an item of this type.
 *
 * The two families behave differently, and the difference comes straight from Leafly's
 * `variant.unit` table in the schema:
 *
 * COUNTED TYPES (Accessory, Seeds, Clone, Edible, PreRoll, Topical, Other) accept only
 * `each`. A variant IS one saleable package, so the count of "each" is 1. We do NOT try to
 * read "10pk" and send amount: 10 -- `inventoryLevel` is already documented as "the number
 * of saleable packages in stock", so sending the pack size in `amount` would describe the
 * same package twice in two different units and make the menu arithmetic incoherent.
 * Choosing 1 asserts only what is certainly true: this is one package.
 *
 * WEIGHED TYPES (Flower: g|oz) MUST carry a real weight, and there is nowhere to get one
 * except the label. No weight -> no variant, and a rejection a human can act on. This is
 * the single most important line in the file: an invented weight on a cannabis menu is a
 * compliance exposure, and "3.5g" appearing on a product that is not 3.5g is exactly the
 * kind of thing an inspector reads back to you.
 *
 * MIXED TYPES (Concentrate, Cartridge: each|g) prefer a real gram weight when the label
 * gives one and fall back to `each` when it does not -- both are legal for these types, so
 * the fallback is a documented choice rather than a guess.
 */
export function variantAmountAndUnit(
  itemType: LeaflyFunnelType,
  label: string | null | undefined,
): { amount: number; unit: LeaflyVariantUnit } | null {
  const legal = LEAFLY_TYPE_UNIT_MATRIX[itemType].variantUnits;
  const parsed = weightToLeaflyAmount(parseWeightFromLabel(label));

  if (parsed !== null && (legal as readonly string[]).includes(parsed.unit)) {
    return parsed;
  }
  if ((legal as readonly string[]).includes("each")) {
    return { amount: 1, unit: "each" };
  }
  // Weight-only type (Flower) with no usable weight in the label.
  return null;
}

/**
 * `variant.medical` -- SLICE L-3 completes finding L-11.
 *
 * L-2 turned a hardcoded `false` into a function, which made it a mechanism instead of a
 * literal. L-3 supplies the part that was still missing: the GATE. The value is no longer
 * read off the variant at all, because a variant flag could be flipped by any future edit
 * and would then advertise medical product at a shop with no endorsement to sell it.
 *
 * It is now derived, fail-closed, from two facts that live outside this mapper:
 *   - does the STORE hold an LCB medical endorsement, and
 *   - does the PRODUCT carry a verified WAC 246-70 DOH category.
 *
 * Both must hold. Today the first is false (owner, Q5, verbatim: "we carry doh products,
 * but we have not been certified yet. So we will only have regular non medical sales at
 * the start until we get the endorsement."), so every variant correctly emits `false` --
 * the same posture the CCRS bible takes for `IsMedical`.
 *
 * The decision itself lives in `orderability-core.ts` so the menu and the register share
 * one vocabulary; this is only the adapter from a Leafly variant to that decision.
 */
export function variantMedicalFlag(input?: VariantMedicalInput): boolean {
  return resolveVariantMedical(input);
}

/**
 * `inventoryLevel` -- the real on-hand count.
 *
 * Leafly documents an internal cap of 10, and we deliberately do NOT pre-clamp to it.
 * Sending the true number costs nothing (they cap on receipt), and data quality is graded
 * at certification. In stock is floored to 1 so Leafly's auto-publish rule -- items
 * received WITH inventory are published -- still holds when the quantity field lags.
 */
export function variantInventoryLevel(v: { inStock: boolean; inventoryLevel: number }): number {
  if (!v.inStock) return 0;
  const n = Math.round(v.inventoryLevel);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Map one variant. Returns null when the variant cannot be honestly represented, which the
 * caller turns into a rejection rather than a silently dropped product.
 */
export function toLeaflyVariant(
  v: SyndicationVariant,
  itemType: LeaflyFunnelType,
  medical?: VariantMedicalInput,
): LeaflyVariant | null {
  const au = variantAmountAndUnit(itemType, v.label);
  if (au === null) return null;

  return {
    id: String(v.id),
    // SLICE L-3: derived from the store's endorsement + the product's verified DOH
    // category, NOT from anything on the variant. Omitting the argument yields `false`,
    // which is the lawful answer for an unendorsed licence.
    medical: variantMedicalFlag(medical),
    price: Math.round(v.priceMinorUnits),
    amount: au.amount,
    unit: au.unit,
    inventoryLevel: variantInventoryLevel(v),
  };
}

/**
 * Every variant for an item, plus the ones we refused.
 *
 * An item with no source variants still gets a synthesized default so the `minItems: 1`
 * rule holds -- but only when the item's own type can produce a legal amount/unit without
 * inventing anything. A Flower item with no variants and no weight anywhere is not
 * publishable, and pretending otherwise would put a made-up weight on cannabis.
 */
export function variantsFor(
  item: SyndicationItem,
  opts?: LeaflyBuildOptions,
): {
  variants: LeaflyVariant[];
  rejected: LeaflyVariantRejection[];
} {
  const itemType = toLeaflyType(item.category);
  const variants: LeaflyVariant[] = [];
  const rejected: LeaflyVariantRejection[] = [];

  // SLICE L-3. The medical answer is a property of the STORE (endorsement) and the
  // PRODUCT (verified DOH category), so it is computed once per item and shared by
  // every variant of it -- variants of one product cannot disagree about whether the
  // product is medical.
  const medical: VariantMedicalInput = {
    endorsed: opts?.medicallyEndorsed === true,
    dohCategory: item.dohCategory ?? null,
  };

  if (item.variants.length > 0) {
    for (const v of item.variants) {
      const mapped = toLeaflyVariant(v, itemType, medical);
      if (mapped === null) {
        rejected.push({
          itemId: item.id,
          variantId: String(v.id),
          label: v.label ?? "",
          reason:
            `Leafly type "${itemType}" must be sold by weight ` +
            `(${LEAFLY_TYPE_UNIT_MATRIX[itemType].variantUnits.join(" or ")}), and no weight ` +
            `could be read from the variant label "${v.label ?? "(blank)"}". ` +
            `Fix the label (e.g. "3.5g", "1 oz") — a weight will never be guessed.`,
        });
        continue;
      }
      variants.push(mapped);
    }
    return { variants, rejected };
  }

  const au = variantAmountAndUnit(itemType, null);
  if (au === null) {
    rejected.push({
      itemId: item.id,
      variantId: `${item.id}-default`,
      label: "",
      reason:
        `Item has no variants and Leafly type "${itemType}" is sold by weight, so a default ` +
        `variant cannot be synthesized without inventing a weight.`,
    });
    return { variants, rejected };
  }

  variants.push({
    id: `${item.id}-default`,
    medical: variantMedicalFlag(medical),
    price: Math.round(item.priceMinorUnits),
    amount: au.amount,
    unit: au.unit,
    inventoryLevel: variantInventoryLevel({ inStock: item.inStock, inventoryLevel: 1 }),
  });
  return { variants, rejected };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type LeaflyItemResult = {
  item: LeaflyItem | null;
  rejected: LeaflyVariantRejection[];
};

/**
 * Options that describe the STORE and the owner's choices, as opposed to the product.
 *
 * SLICE L-3. These are deliberately parameters rather than module state or a DB read:
 * this file is pure, and the two facts below are exactly the ones a test must be able to
 * vary in order to prove the gates work.
 */
export type LeaflyBuildOptions = {
  /**
   * The owner's "offer pickup ordering on Leafly" toggle. DEFAULTS OFF when absent, so a
   * caller that has not thought about ordering cannot accidentally turn it on.
   */
  pickupEnabled?: boolean;
  /**
   * Does the store currently hold an LCB medical endorsement (RCW 69.50.375)? DEFAULTS
   * FALSE. Today this is false (owner, Q5), and false is also the safe answer.
   */
  medicallyEndorsed?: boolean;
};

/**
 * Map one Greenway item to one Leafly item.
 *
 * SLICE L-3 CLOSES FINDING L-09: `availableForPickup` is now emitted.
 *
 * L-2 deliberately left it absent, because the moment it is `true` real customers can
 * place real orders the shop has fifteen minutes to acknowledge, and turning that on as a
 * side effect of a field-rename slice would have been reckless. It is now emitted, but
 * behind the owner's own toggle, which defaults OFF -- merging this slice changes nothing
 * about what shoppers can do until he decides otherwise.
 *
 * WHY IT IS ALWAYS EMITTED RATHER THAN OMITTED WHEN FALSE. The schema offers three
 * states, not two: `true`, `false`, and omitted ("may be omitted to maintain the current
 * item setting"). Omission is the dangerous one during a sync. Consider an item that was
 * orderable yesterday and sold out overnight: omitting the field leaves Leafly's existing
 * `true` in place and keeps taking orders for a product that is gone. Saying `false`
 * explicitly is the only way to withdraw an offer we can no longer honour. So we always
 * state the current truth, and the payload we log is a complete record of what we told
 * Leafly rather than a diff a reader has to reconstruct.
 */
export function toLeaflyItemResult(
  item: SyndicationItem,
  opts?: LeaflyBuildOptions,
): LeaflyItemResult {
  const type = toLeaflyType(item.category);
  const { variants, rejected } = variantsFor(item, opts);

  if (variants.length === 0) return { item: null, rejected };

  // `name` is `minLength: 1`, so an all-whitespace name is a schema violation --
  // and a padded name is a storefront defect (" Blue Dream" sorts under space
  // and reads as a typo on a public menu).
  //
  // Trimming is NOT inventing a value: surrounding whitespace carries no
  // information, so removing it cannot change what the name MEANS. Supplying a
  // name for a product that has none WOULD be inventing, so that case is
  // refused instead -- the item is dropped with a reason a human can act on.
  const name = item.name.trim();
  if (name.length === 0) {
    rejected.push({
      itemId: item.id,
      variantId: "",
      label: "",
      reason:
        `Item has a blank name, and Leafly requires a non-empty name (minLength 1). ` +
        `A name is never invented — set a real product name on this item.`,
    });
    return { item: null, rejected };
  }

  const out: LeaflyItem = {
    id: item.id,
    type,
    name,
    variants,
  };

  // strain: nullable in the schema, and Leafly's certification checklist explicitly wants
  // null when absent rather than a placeholder. "NA" would become a strain page.
  const strain = item.strainName?.trim();
  out.strain = strain && strain.length > 0 ? strain : null;

  // brand: NOT nullable -- `type: "string"` with no null. NEW DEFECT (1 of 3): the old code
  // emitted `brandName: null`, which is both the wrong key AND an illegal value. Omit it.
  const brand = item.brand?.trim();
  if (brand && brand.length > 0) out.brand = brand;

  // description: NOT nullable either. NEW DEFECT (2 of 3): the old code emitted
  // `description: null` for every item without one. Omit it.
  const description = toPlainText(item.description);
  if (description !== null) out.description = description;

  // compounds + totals. NEW DEFECT (3 of 3): the old code pushed compounds into the array
  // unconditionally, which meant an Edible carrying a percent-shaped reading, or an
  // Accessory carrying any reading at all, both of which the type/unit table forbids.
  // toCompound() now returns null whenever Leafly ignores compounds for the type.
  const thc = toCompound("thc", item.thc, type);
  const cbd = toCompound("cbd", item.cbd, type);
  const compounds: LeaflyCompound[] = [];
  if (thc) compounds.push(thc);
  if (cbd) compounds.push(cbd);
  if (compounds.length > 0) out.compounds = compounds;

  const totalThc = toTotalCompound(thc);
  const totalCbd = toTotalCompound(cbd);
  if (totalThc) out.total_thc = totalThc;
  if (totalCbd) out.total_cbd = totalCbd;

  // imageUrl: nullable, and null/omitted REMOVES the cached image. Only send a real one.
  // The owner's sendImages toggle is honoured in `apply-settings-core.ts` (finding L-10).
  if (typeof item.imageUrl === "string" && item.imageUrl.trim() !== "") {
    out.imageUrl = item.imageUrl.trim();
  }

  // availableForPickup (L-09). Fail-closed: `true` requires the owner's toggle AND real
  // stock AND a product that is not DOH card-only. See orderability-core.ts for why each
  // condition exists. The value is always a real boolean -- `null` is illegal here, the
  // schema declares a plain `"type": "boolean"`.
  out.availableForPickup = decideOrderability({
    inStock: item.inStock,
    dohCategory: item.dohCategory ?? null,
    pickupEnabled: opts?.pickupEnabled === true,
  }).availableForPickup;

  return { item: out, rejected };
}

/** Back-compat single-item mapper. Returns null when the item is not publishable. */
export function toLeaflyItem(item: SyndicationItem, opts?: LeaflyBuildOptions): LeaflyItem | null {
  return toLeaflyItemResult(item, opts).item;
}

export type LeaflyBuildResult = {
  payload: LeaflyItemsPayload;
  rejected: LeaflyVariantRejection[];
  droppedItemIds: string[];
};

/**
 * Build the full payload, keeping the refusals rather than swallowing them.
 *
 * `buildLeaflyItemsPayload` stays as the plain entry point so existing callers keep
 * working; `buildLeaflyItemsResult` is what the validator and the admin preflight use,
 * because "we published 412 of your 415 items and here is exactly why" is the honest
 * report, and a silent 412 is not.
 */
export function buildLeaflyItemsResult(
  items: SyndicationItem[],
  opts?: LeaflyBuildOptions,
): LeaflyBuildResult {
  const out: LeaflyItem[] = [];
  const rejected: LeaflyVariantRejection[] = [];
  const droppedItemIds: string[] = [];

  for (const item of items) {
    const result = toLeaflyItemResult(item, opts);
    rejected.push(...result.rejected);
    if (result.item === null) droppedItemIds.push(item.id);
    else out.push(result.item);
  }

  return { payload: { items: out }, rejected, droppedItemIds };
}

export function buildLeaflyItemsPayload(
  items: SyndicationItem[],
  opts?: LeaflyBuildOptions,
): LeaflyItemsPayload {
  return buildLeaflyItemsResult(items, opts).payload;
}

export function buildLeaflyDeletePayload(ids: string[]): LeaflyDeletePayload {
  return { ids: [...new Set(ids)] };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runLeaflyPayloadTests(): { passed: number; failed: number } {
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

  // -- item.type funnel targets (L-12) ---------------------------------------
  ok("flower->Flower", toLeaflyType("flower") === "Flower");
  ok("popcorn-bud->Flower", toLeaflyType("popcorn-bud") === "Flower");
  ok("trim->Flower", toLeaflyType("trim") === "Flower");
  ok("preroll-pack->PreRoll", toLeaflyType("preroll-pack") === "PreRoll");
  ok("blunt->PreRoll", toLeaflyType("blunt") === "PreRoll");
  ok("cartridge->Cartridge NOT Concentrate", toLeaflyType("cartridge") === "Cartridge");
  ok("disposable-cartridge->Cartridge", toLeaflyType("disposable-cartridge") === "Cartridge");
  ok("concentrate->Concentrate", toLeaflyType("concentrate") === "Concentrate");
  ok("rso->Concentrate", toLeaflyType("rso") === "Concentrate");
  ok("edible-solid->Edible", toLeaflyType("edible-solid") === "Edible");
  ok("tincture->Edible (never the invented 'tincture')", toLeaflyType("tincture") === "Edible");
  ok("topical->Topical", toLeaflyType("topical") === "Topical");
  ok("merch->Accessory", toLeaflyType("merch") === "Accessory");
  ok("unknown->Other", toLeaflyType("nonsense") === "Other");
  ok(
    "every mapped category yields a real funnel type",
    mappedLeaflyCategories().every((c) => isLeaflyFunnelType(toLeaflyType(c))),
  );

  // -- plain text ------------------------------------------------------------
  ok("plaintext strips tags", toPlainText("<p>Hello <b>world</b></p>") === "Hello world");
  ok("plaintext entities", toPlainText("A &amp; B") === "A & B");
  ok("plaintext empty->null", toPlainText("   ") === null);
  ok("plaintext null->null", toPlainText(null) === null);

  // -- compounds (L-04, L-05) ------------------------------------------------
  const flowerThc = toCompound("thc", "21.4%", "Flower");
  ok("compound uses content not value", flowerThc !== null && flowerThc.content === 21.4);
  ok("compound percent spelled out, never '%'", flowerThc !== null && flowerThc.unit === "percent");
  ok("compound keeps its type", flowerThc !== null && flowerThc.type === "thc");

  const edibleThc = toCompound("thc", "100", "Edible");
  ok("edible compound unit is mg", edibleThc !== null && edibleThc.unit === "mg");
  ok(
    "edible unit comes from the TYPE not the string",
    toCompound("thc", "10mg", "Flower")?.unit === "percent",
  );

  ok("accessory compounds ignored", toCompound("thc", "21.4", "Accessory") === null);
  ok("topical compounds ignored", toCompound("thc", "21.4", "Topical") === null);
  ok("other compounds ignored", toCompound("thc", "21.4", "Other") === null);
  ok("absent reading -> null", toCompound("thc", "", "Flower") === null);
  ok("null reading -> null", toCompound("thc", null, "Flower") === null);
  const trace = toCompound("thc", "trace", "Flower");
  ok(
    "unreadable reading -> content null, never 0",
    trace !== null && trace.content === null && trace.unit === "percent",
  );

  // -- totals carry no type (L-08) -------------------------------------------
  const total = toTotalCompound(flowerThc);
  ok("total has content", total !== null && total.content === 21.4);
  ok("total has unit", total !== null && total.unit === "percent");
  ok(
    "total carries NO type field",
    total !== null && !Object.prototype.hasOwnProperty.call(total, "type"),
  );
  ok("total of null is null", toTotalCompound(null) === null);

  // -- weight conversion -----------------------------------------------------
  ok(
    "g passes through",
    JSON.stringify(weightToLeaflyAmount({ unit: "g", value: 3.5 })) ===
      JSON.stringify({ amount: 3.5, unit: "g" }),
  );
  ok(
    "oz passes through",
    JSON.stringify(weightToLeaflyAmount({ unit: "oz", value: 1 })) ===
      JSON.stringify({ amount: 1, unit: "oz" }),
  );
  ok(
    "kg -> g",
    JSON.stringify(weightToLeaflyAmount({ unit: "kg", value: 1 })) ===
      JSON.stringify({ amount: 1000, unit: "g" }),
  );
  ok(
    "lb -> oz",
    JSON.stringify(weightToLeaflyAmount({ unit: "lb", value: 1 })) ===
      JSON.stringify({ amount: 16, unit: "oz" }),
  );
  ok(
    "mg REFUSED, never laundered into grams",
    weightToLeaflyAmount({ unit: "mg", value: 100 }) === null,
  );
  ok("null weight -> null", weightToLeaflyAmount(null) === null);
  ok("zero weight -> null", weightToLeaflyAmount({ unit: "g", value: 0 }) === null);
  ok("negative weight -> null", weightToLeaflyAmount({ unit: "g", value: -1 }) === null);

  // -- amount + unit per type (L-01, L-02, L-03) -----------------------------
  ok(
    "flower 3.5g -> 3.5 g",
    JSON.stringify(variantAmountAndUnit("Flower", "3.5g")) ===
      JSON.stringify({ amount: 3.5, unit: "g" }),
  );
  ok(
    "flower 1/8 oz -> 0.125 oz",
    JSON.stringify(variantAmountAndUnit("Flower", "1/8 oz")) ===
      JSON.stringify({ amount: 0.125, unit: "oz" }),
  );
  ok("flower with no weight -> REFUSED", variantAmountAndUnit("Flower", "each") === null);
  ok("flower with blank label -> REFUSED", variantAmountAndUnit("Flower", "") === null);
  ok("flower with 10pk -> REFUSED", variantAmountAndUnit("Flower", "10pk") === null);
  ok(
    "edible 10pk -> 1 each (pack size is NOT the amount)",
    JSON.stringify(variantAmountAndUnit("Edible", "10pk")) ===
      JSON.stringify({ amount: 1, unit: "each" }),
  );
  ok(
    "preroll -> each",
    JSON.stringify(variantAmountAndUnit("PreRoll", "1g")) ===
      JSON.stringify({ amount: 1, unit: "each" }),
  );
  ok(
    "concentrate 1g -> 1 g (gram is legal for this type)",
    JSON.stringify(variantAmountAndUnit("Concentrate", "1g")) ===
      JSON.stringify({ amount: 1, unit: "g" }),
  );
  ok(
    "cartridge with no weight -> 1 each",
    JSON.stringify(variantAmountAndUnit("Cartridge", "disposable")) ===
      JSON.stringify({ amount: 1, unit: "each" }),
  );
  ok(
    "accessory -> each",
    JSON.stringify(variantAmountAndUnit("Accessory", "grinder")) ===
      JSON.stringify({ amount: 1, unit: "each" }),
  );
  // An edible labelled in grams must still be `each` -- g is not legal for Edible.
  ok("edible labelled 5g still each", variantAmountAndUnit("Edible", "5g")?.unit === "each");

  // Cross-check every funnel type against the contract matrix: the unit we choose must
  // always be one the schema permits for that type. This is the assertion that would
  // catch a future table edit that looks harmless.
  const allTypes: LeaflyFunnelType[] = [
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
  ];
  ok(
    "chosen unit is always legal for the type",
    allTypes.every((t) => {
      const r = variantAmountAndUnit(t, "3.5g");
      if (r === null) return false;
      return (LEAFLY_TYPE_UNIT_MATRIX[t].variantUnits as readonly string[]).includes(r.unit);
    }),
  );
  ok(
    "only the weighed type can refuse",
    allTypes.every((t) => (variantAmountAndUnit(t, "no weight here") === null) === (t === "Flower")),
  );

  // -- medical flag is a GATED mechanism, not a literal (L-11) ---------------
  //
  // SLICE L-3 note. L-2 asserted here that `variantMedicalFlag({ medical: true })`
  // returns true -- i.e. that a flag on the variant could switch medical on. L-3
  // deliberately removes that capability, so that assertion is gone rather than
  // adjusted. The reason is the point of the whole finding: a per-variant boolean could
  // be set by any future import or edit, and it would then advertise medical product at
  // a store with no endorsement to sell it. Medical is now a conclusion drawn from the
  // STORE's endorsement and the PRODUCT's verified DOH category, and nothing else can
  // assert it.
  ok("medical defaults false with no input", variantMedicalFlag() === false);
  ok("medical false for an empty input", variantMedicalFlag({ endorsed: false }) === false);
  ok(
    "medical false when unendorsed, whatever the product is",
    variantMedicalFlag({ endorsed: false, dohCategory: "general_use" }) === false,
  );
  ok(
    "medical false when endorsed but the product is not DOH-verified",
    variantMedicalFlag({ endorsed: true, dohCategory: null }) === false,
  );
  ok(
    "medical true ONLY when endorsed AND DOH-verified",
    variantMedicalFlag({ endorsed: true, dohCategory: "general_use" }) === true,
  );

  // -- inventory -------------------------------------------------------------
  ok("out of stock -> 0", variantInventoryLevel({ inStock: false, inventoryLevel: 9 }) === 0);
  ok("in stock real qty", variantInventoryLevel({ inStock: true, inventoryLevel: 7 }) === 7);
  ok("in stock floors to 1", variantInventoryLevel({ inStock: true, inventoryLevel: 0 }) === 1);
  ok("fractional rounds", variantInventoryLevel({ inStock: true, inventoryLevel: 3.4 }) === 3);
  ok(
    "above Leafly's cap is sent truthfully, not pre-clamped",
    variantInventoryLevel({ inStock: true, inventoryLevel: 47 }) === 47,
  );

  // -- whole item ------------------------------------------------------------
  const flower: SyndicationItem = {
    id: "item-1",
    name: "House Flower",
    brand: "  Greenway  ",
    category: "flower",
    strainType: "hybrid",
    strainName: "  Blue Dream  ",
    thc: "24.1%",
    cbd: null,
    description: "<p>Smooth &amp; balanced</p>",
    priceMinorUnits: 2000,
    inStock: true,
    variants: [
      { id: "v1", label: "3.5g", priceMinorUnits: 1500.4, inStock: true, inventoryLevel: 7 },
    ],
  };
  const fr = toLeaflyItemResult(flower);
  const fi = fr.item;
  ok("item built", fi !== null);
  ok("item type Flower", fi?.type === "Flower");
  ok("brand key is 'brand' (L-06)", fi?.brand === "Greenway");
  ok("no brandName key survives", fi !== null && !("brandName" in fi));
  ok("strain key is 'strain' (L-07)", fi?.strain === "Blue Dream");
  ok("no strainName key survives", fi !== null && !("strainName" in fi));
  ok("total_thc snake_case (L-08)", fi !== null && fi.total_thc?.content === 24.1);
  ok("no totalThc key survives", fi !== null && !("totalThc" in fi));
  ok("total_cbd omitted when absent", fi !== null && fi.total_cbd === undefined);
  ok("description plain text", fi?.description === "Smooth & balanced");
  ok("variant price rounded", fi?.variants[0].price === 1500);
  ok("variant amount emitted (L-01)", fi?.variants[0].amount === 3.5);
  ok("variant unit emitted (L-02)", fi?.variants[0].unit === "g");
  ok("variant label GONE (L-03)", fi !== null && !("label" in fi.variants[0]));
  ok("variant medical present", fi?.variants[0].medical === false);
  // SLICE L-3 replaces the L-2 assertion "availableForPickup NOT set". It is now always
  // set, and with no options it is FALSE -- the fail-closed default.
  ok(
    "availableForPickup IS now emitted (L-09)",
    fi !== null && typeof fi.availableForPickup === "boolean",
  );
  ok(
    "availableForPickup defaults FALSE with no options",
    fi !== null && fi.availableForPickup === false,
  );
  ok("no rejections for a good flower item", fr.rejected.length === 0);

  // absent brand/description must be OMITTED, not null (the three new defects)
  const bare: SyndicationItem = {
    id: "item-2",
    name: "Gummies",
    brand: null,
    category: "edible-solid",
    strainType: "unknown",
    strainName: null,
    thc: "100",
    cbd: null,
    description: "",
    priceMinorUnits: 1500,
    inStock: true,
    variants: [{ id: "x", label: "10pk", priceMinorUnits: 1500, inStock: true, inventoryLevel: 12 }],
  };
  const bi = toLeaflyItem(bare);
  ok("absent brand omitted, not null", bi !== null && !("brand" in bi));
  ok("absent description omitted, not null", bi !== null && !("description" in bi));
  ok("absent strain IS null (nullable in schema)", bi !== null && bi.strain === null);
  ok("edible gets mg unit", bi?.total_thc?.unit === "mg");
  ok("edible variant is each", bi?.variants[0].unit === "each");
  ok("no imageUrl when absent", bi !== null && !("imageUrl" in bi));

  // a flower item whose label has no weight is refused, not invented
  const badFlower: SyndicationItem = {
    ...flower,
    id: "item-3",
    variants: [
      { id: "bad", label: "each", priceMinorUnits: 1000, inStock: true, inventoryLevel: 2 },
    ],
  };
  const bad = toLeaflyItemResult(badFlower);
  ok("weightless flower variant refused", bad.item === null);
  ok("refusal is reported", bad.rejected.length === 1);
  ok("refusal names the variant", bad.rejected[0].variantId === "bad");
  ok("refusal explains itself", /weight/i.test(bad.rejected[0].reason));
  ok("refusal promises not to guess", /never be guessed/i.test(bad.rejected[0].reason));

  // synthesized default variant
  const noVariants: SyndicationItem = { ...bare, id: "item-4", variants: [] };
  const nv = toLeaflyItemResult(noVariants);
  ok("default variant synthesized for counted type", nv.item?.variants.length === 1);
  ok("default variant id", nv.item?.variants[0].id === "item-4-default");
  ok("default variant is each", nv.item?.variants[0].unit === "each");
  const noVariantsFlower: SyndicationItem = { ...flower, id: "item-5", variants: [] };
  const nvf = toLeaflyItemResult(noVariantsFlower);
  ok("no default variant invented for weighed type", nvf.item === null);
  ok("and it says why", nvf.rejected.length === 1 && /weight/i.test(nvf.rejected[0].reason));

  // image
  const withImage: SyndicationItem = { ...bare, id: "item-6", imageUrl: " https://x/y.jpg " };
  ok("imageUrl trimmed and sent", toLeaflyItem(withImage)?.imageUrl === "https://x/y.jpg");

  // A present-but-blank imageUrl must be treated as ABSENT, never emitted.
  // The schema declares imageUrl `format: "uri"`, so "" and "   " are not
  // legal values; and because "omitted or null" both mean "remove the image",
  // omitting is the correct, lossless way to say "we have no image".
  const blankImage = toLeaflyItem({ ...bare, id: "item-6a", imageUrl: "" });
  ok("empty-string imageUrl omitted entirely", blankImage !== null && !("imageUrl" in blankImage));
  const wsImage = toLeaflyItem({ ...bare, id: "item-6b", imageUrl: "   " });
  ok("whitespace-only imageUrl omitted entirely", wsImage !== null && !("imageUrl" in wsImage));
  ok(
    "whitespace-only imageUrl is not emitted as an empty string either",
    wsImage !== null && wsImage.imageUrl === undefined,
  );
  const tabImage = toLeaflyItem({ ...bare, id: "item-6c", imageUrl: "\t\n " });
  ok("tab/newline-only imageUrl omitted entirely", tabImage !== null && !("imageUrl" in tabImage));
  // `SyndicationItem.imageUrl` is declared `string | undefined`, so a null
  // cannot arrive through the type system. It can still arrive through the
  // DOOR the type system does not guard: these rows are built from Supabase,
  // where `image_url` is a nullable column. menu-feed-core.ts:140 filters that
  // null out today, but this mapper must not depend on a caller staying
  // careful, so the cast asserts the runtime shape on purpose.
  const nullImage = toLeaflyItem({
    ...bare,
    id: "item-6d",
    imageUrl: null as unknown as string | undefined,
  });
  ok(
    "explicit null imageUrl omitted (omission == null to Leafly)",
    nullImage !== null && !("imageUrl" in nullImage),
  );
  ok(
    "a blank image never blanks out a sibling field",
    blankImage !== null && blankImage.name === bare.name && blankImage.variants.length === 1,
  );

  // -- name: minLength 1, so trim; but never invent one ----------------------
  const padded: SyndicationItem = { ...bare, id: "item-7", name: "  Padded Name  " };
  ok("name is trimmed", toLeaflyItem(padded)?.name === "Padded Name");
  ok(
    "inner spacing is preserved",
    toLeaflyItem({ ...bare, id: "item-7b", name: " Blue  Dream " })?.name === "Blue  Dream",
  );

  const blankName: SyndicationItem = { ...bare, id: "item-8", name: "   " };
  ok("blank name yields no item", toLeaflyItem(blankName) === null);
  const blankNameResult = toLeaflyItemResult(blankName);
  ok("blank name is reported, not swallowed", blankNameResult.rejected.length === 1);
  ok(
    "blank name refusal says a name is never invented",
    blankNameResult.rejected[0].reason.includes("never invented"),
  );
  ok(
    "blank name refusal names the item",
    blankNameResult.rejected[0].itemId === "item-8",
  );
  ok("empty-string name yields no item", toLeaflyItem({ ...bare, id: "item-9", name: "" }) === null);

  // -- payload ---------------------------------------------------------------
  const built = buildLeaflyItemsResult([flower, bare, badFlower]);
  ok("payload keeps the good items", built.payload.items.length === 2);
  ok("payload records the dropped item", built.droppedItemIds.length === 1);
  ok("dropped item is the weightless one", built.droppedItemIds[0] === "item-3");
  ok("payload surfaces rejections", built.rejected.length === 1);
  ok("plain builder still works", buildLeaflyItemsPayload([flower]).items.length === 1);

  const del = buildLeaflyDeletePayload(["a", "a", "b"]);
  ok("delete dedupes", del.ids.length === 2 && del.ids.includes("a") && del.ids.includes("b"));

  // -- no forbidden key may appear ANYWHERE in a generated payload -----------
  const json = JSON.stringify(buildLeaflyItemsResult([flower, bare, withImage]).payload);
  for (const forbidden of [
    "brandName",
    "strainName",
    "totalThc",
    "totalCbd",
    "inventory_level",
    "image_url",
    "available_for_pickup",
    "batchId",
    "parentBatchId",
    "sku",
    "tax_rate",
    "price_includes_tax",
  ]) {
    ok(`payload never contains "${forbidden}"`, !json.includes(`"${forbidden}"`));
  }
  ok('payload never contains a "%" unit', !json.includes('"%"'));
  ok('payload never contains a "label" key', !json.includes('"label"'));
  ok('payload never contains "value":', !json.includes('"value":'));

  // =========================================================================
  // SLICE L-3 -- orderability (L-09) and the medical gate (L-11)
  // =========================================================================

  /** An ordinary, in-stock recreational flower item. */
  const orderableSrc: SyndicationItem = {
    id: "l3-1",
    name: "Blue Dream",
    brand: "Greenway",
    category: "flower",
    strainType: "hybrid",
    strainName: "Blue Dream",
    thc: "24.1%",
    cbd: null,
    description: "Smooth",
    priceMinorUnits: 1500,
    inStock: true,
    variants: [{ id: "l3-1-v", label: "3.5g", priceMinorUnits: 1500, inStock: true, inventoryLevel: 7 }],
  };

  // --- the field is always present, and always a real boolean --------------
  const pickOff = toLeaflyItem(orderableSrc);
  ok("availableForPickup present even when ordering is off", pickOff !== null && "availableForPickup" in pickOff);
  ok("availableForPickup false when ordering is off", pickOff?.availableForPickup === false);
  ok(
    "availableForPickup is never null (schema says plain boolean)",
    pickOff !== null && pickOff.availableForPickup !== null,
  );

  const pickOn = toLeaflyItem(orderableSrc, { pickupEnabled: true });
  ok("availableForPickup true when enabled + in stock", pickOn?.availableForPickup === true);

  // Explicitly passing the toggle as false must behave like omitting it.
  const pickExplicitOff = toLeaflyItem(orderableSrc, { pickupEnabled: false });
  ok("explicit pickupEnabled:false => not orderable", pickExplicitOff?.availableForPickup === false);

  // --- out of stock withdraws the offer, explicitly ------------------------
  const oosSrc: SyndicationItem = {
    ...orderableSrc,
    id: "l3-2",
    inStock: false,
    variants: [{ id: "l3-2-v", label: "3.5g", priceMinorUnits: 1500, inStock: false, inventoryLevel: 0 }],
  };
  const oosItem = toLeaflyItem(oosSrc, { pickupEnabled: true });
  ok("out-of-stock item is NOT orderable", oosItem?.availableForPickup === false);
  // This is the assertion that protects against the "just omit it" shortcut: an omitted
  // field would leave Leafly's existing `true` in place on a sold-out product.
  ok(
    "out-of-stock item SAYS false rather than staying silent",
    oosItem !== null && oosItem.availableForPickup === false && "availableForPickup" in oosItem,
  );
  ok("out-of-stock variant still reports inventoryLevel 0", oosItem?.variants[0].inventoryLevel === 0);

  // --- the DOH statutory gate ---------------------------------------------
  const highThcSrc: SyndicationItem = {
    ...orderableSrc,
    id: "l3-3",
    name: "High-THC Tincture",
    category: "tincture",
    dohCategory: "high_thc",
    variants: [{ id: "l3-3-v", label: "30ml", priceMinorUnits: 4000, inStock: true, inventoryLevel: 5 }],
  };
  const highThcItem = toLeaflyItem(highThcSrc, { pickupEnabled: true });
  ok(
    "WAC 246-70 high_thc is NEVER orderable, even in stock with ordering on",
    highThcItem?.availableForPickup === false,
  );
  ok(
    "high_thc is still PUBLISHED (it is legal to show, just not to order)",
    highThcItem !== null,
  );
  // Endorsement must not unlock ordering: the card cannot be checked at order time.
  const highThcEndorsed = toLeaflyItem(highThcSrc, { pickupEnabled: true, medicallyEndorsed: true });
  ok(
    "high_thc stays un-orderable even WITH an endorsement",
    highThcEndorsed?.availableForPickup === false,
  );

  // The other two DOH lanes carry no such restriction.
  const generalUse = toLeaflyItem(
    { ...orderableSrc, id: "l3-4", dohCategory: "general_use" },
    { pickupEnabled: true },
  );
  ok("DOH general_use remains orderable", generalUse?.availableForPickup === true);
  const highCbd = toLeaflyItem(
    { ...orderableSrc, id: "l3-5", dohCategory: "high_cbd" },
    { pickupEnabled: true },
  );
  ok("DOH high_cbd remains orderable", highCbd?.availableForPickup === true);
  // A product with no registry entry is ordinary recreational stock, not "suspicious".
  const noCategory = toLeaflyItem({ ...orderableSrc, id: "l3-6", dohCategory: null }, { pickupEnabled: true });
  ok("a product with no DOH category is orderable", noCategory?.availableForPickup === true);

  // --- variant.medical: the endorsement gate (L-11) ------------------------
  ok("medical false today: unendorsed, no category", pickOn?.variants[0].medical === false);
  ok(
    "medical false: unendorsed even for a DOH-verified product",
    toLeaflyItem({ ...orderableSrc, id: "l3-7", dohCategory: "general_use" })?.variants[0].medical === false,
  );
  ok(
    "medical false: endorsed but the product has no DOH category",
    toLeaflyItem({ ...orderableSrc, id: "l3-8" }, { medicallyEndorsed: true })?.variants[0].medical === false,
  );
  ok(
    "medical TRUE only when endorsed AND DOH-verified",
    toLeaflyItem({ ...orderableSrc, id: "l3-9", dohCategory: "general_use" }, { medicallyEndorsed: true })
      ?.variants[0].medical === true,
  );
  // The synthesized default variant must obey the same gate as a real one --
  // this is the path that previously called variantMedicalFlag() with no argument.
  const noVariantSrc: SyndicationItem = {
    ...orderableSrc,
    id: "l3-10",
    category: "edible",
    dohCategory: "general_use",
    variants: [],
  };
  const synth = toLeaflyItem(noVariantSrc, { medicallyEndorsed: true });
  ok("synthesized default variant exists", synth !== null && synth.variants.length === 1);
  ok(
    "synthesized default variant honours the medical gate too",
    synth?.variants[0].medical === true,
  );
  ok(
    "synthesized default variant is medical:false when unendorsed",
    toLeaflyItem(noVariantSrc)?.variants[0].medical === false,
  );
  // Every variant of one item must agree about medical -- a product is or is not medical.
  const multiVariant = toLeaflyItem(
    {
      ...orderableSrc,
      id: "l3-11",
      dohCategory: "high_cbd",
      variants: [
        { id: "a", label: "1g", priceMinorUnits: 1000, inStock: true, inventoryLevel: 3 },
        { id: "b", label: "3.5g", priceMinorUnits: 3000, inStock: true, inventoryLevel: 2 },
      ],
    },
    { medicallyEndorsed: true },
  );
  ok(
    "all variants of an item agree about medical",
    multiVariant !== null &&
      multiVariant.variants.length === 2 &&
      multiVariant.variants.every((v) => v.medical === true),
  );

  // --- the whole-payload builders thread the options through ---------------
  const builtL3 = buildLeaflyItemsResult([orderableSrc, highThcSrc, oosSrc], { pickupEnabled: true });
  ok("L-3 build produced all three items", builtL3.payload.items.length === 3);
  ok(
    "builder threads pickupEnabled to the ordinary item",
    builtL3.payload.items.find((i) => i.id === "l3-1")?.availableForPickup === true,
  );
  ok(
    "builder threads the DOH block",
    builtL3.payload.items.find((i) => i.id === "l3-3")?.availableForPickup === false,
  );
  ok(
    "builder threads the stock rule",
    builtL3.payload.items.find((i) => i.id === "l3-2")?.availableForPickup === false,
  );
  ok(
    "buildLeaflyItemsPayload also accepts options",
    buildLeaflyItemsPayload([orderableSrc], { pickupEnabled: true }).items[0].availableForPickup === true,
  );
  // Back-compat: the no-options call still works and fails closed.
  ok(
    "buildLeaflyItemsPayload with no options fails closed",
    buildLeaflyItemsPayload([orderableSrc]).items[0].availableForPickup === false,
  );

  // --- the wire form -------------------------------------------------------
  const l3Json = JSON.stringify(builtL3.payload);
  ok("wire form uses camelCase availableForPickup", l3Json.includes('"availableForPickup"'));
  ok("wire form never uses the v1 snake_case name", !l3Json.includes('"available_for_pickup"'));
  ok("availableForPickup is never serialized as null", !l3Json.includes('"availableForPickup":null'));
  ok(
    'availableForPickup is never serialized as a string',
    !l3Json.includes('"availableForPickup":"'),
  );
  // dohCategory is OUR internal field. Leafly has no such property, so leaking it would
  // be sending an undeclared field on every DOH-verified product.
  ok("internal dohCategory never leaks onto the wire", !l3Json.includes('"dohCategory"'));

  console.log(`leafly-payload: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} leafly-payload test(s) failed`);
  // Returned as well as thrown: throwing protects a caller that ignores the
  // value, and returning lets the CI registry assert that assertions actually
  // RAN. A suite that returns { passed: 0, failed: 0 } is not a passing suite,
  // it is a suite that never executed -- and that is exactly what an early
  // `return` mutation produces.
  return { passed, failed };
}
