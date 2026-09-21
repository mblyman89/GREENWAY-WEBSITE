/**
 * src/lib/leafly/payload-validate-core.ts  (SLICE L-2)
 *
 * THE LAST GATE BEFORE THE WIRE.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `payload-core.ts` is now written against Leafly's live JSON Schema, and its
 * self-tests pass. That is necessary and it is not sufficient. The builder is
 * correct with respect to the inputs it was TESTED with; this module is correct
 * with respect to the payload actually about to be transmitted. The difference
 * matters because the input to the builder is live shop data, and live shop data
 * does things no fixture does.
 *
 * The defects this slice repaired (L-01…L-08, L-12, plus three nullability bugs)
 * shared one property: **every one of them would have been caught by reading the
 * payload and comparing it to the contract.** Nobody did, for months, because
 * nothing in the codebase was responsible for doing it. This module is that
 * responsibility, made executable.
 *
 * DESIGN: FAIL CLOSED, AND NEVER REPAIR
 * -------------------------------------
 * Two rules, and they are the whole design:
 *
 *   1. FAIL CLOSED. Anything this module cannot positively confirm is legal is
 *      an ERROR. Not a warning, not a silent drop, not a best guess. An unknown
 *      compound type, an out-of-enum unit, a field Leafly has never defined:
 *      all errors. The default answer to "should this go out?" is no.
 *
 *   2. NEVER REPAIR (house rule 3). This module has every piece of information
 *      it would need to "helpfully" clamp a price to the minimum, coerce a unit
 *      to the type's legal value, or drop an offending key and carry on. It does
 *      none of those things. A repaired payload is a payload nobody ever looks
 *      at again, carrying a number nobody chose. It reports, precisely, and a
 *      human decides.
 *
 * The distinction between ERROR and WARNING here is NOT severity. It is
 * knowability:
 *
 *   ERROR   = provably violates the published contract. Leafly will reject it,
 *             or worse, accept it and be wrong. Blocks transmission.
 *   WARNING = legal on the wire, but a data-quality signal a human should see.
 *             Leafly grades data quality at certification, so these are not
 *             noise — they are the certification feedback, early.
 *
 * PURE: no DB, no network, no `server-only`. Import it from anywhere, test it
 * directly, and run it in CI against real generated payloads.
 */
import {
  LEAFLY_FORBIDDEN_FIELD_ALIASES,
  LEAFLY_INVENTORY_LEVEL_CAP,
  LEAFLY_MIN_VARIANTS_PER_ITEM,
  LEAFLY_PRICE_MIN_MINOR_UNITS,
  LEAFLY_TYPE_UNIT_MATRIX,
  LEAFLY_V1_REMOVED_ITEM_FIELDS,
  LEAFLY_V1_REMOVED_VARIANT_FIELDS,
  compoundUnitForType,
  isLeaflyCompoundType,
  isLeaflyCompoundUnit,
  isLeaflyFunnelType,
  isLeaflyVariantUnit,
} from "./contract-core";
import type { LeaflyItem, LeaflyItemsPayload, LeaflyVariant } from "./payload-core";
// FINDING L-21. The rule for "can Leafly tell these two sizes apart" lives in
// exactly one place so that the pre-flight warning in the picker, this
// validator finding, and the after-the-fact explanation on a read-back error
// cannot drift into disagreeing with each other. They are the same function.
import {
  findVariantCollisions,
  remedyForCollision,
  type IdentifiedVariant,
} from "./variant-identity-core";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export type LeaflyValidationSeverity = "error" | "warning";

/**
 * One finding.
 *
 * `path` is a JSON pointer-ish path into the payload (`items[3].variants[0].unit`)
 * so a human can find the offending value without reading the whole document,
 * and `itemId` is carried separately because the person fixing this works in the
 * admin UI, where the item id is the handle they have.
 */
export type LeaflyValidationIssue = {
  severity: LeaflyValidationSeverity;
  code: string;
  path: string;
  itemId: string | null;
  message: string;
};

export type LeaflyValidationResult = {
  /** True only when there are ZERO errors. Warnings never block. */
  ok: boolean;
  errors: LeaflyValidationIssue[];
  warnings: LeaflyValidationIssue[];
  /** Every issue, in discovery order. */
  issues: LeaflyValidationIssue[];
  itemsChecked: number;
  variantsChecked: number;
};

/**
 * Thrown by `assertLeaflyPayloadValid`. Carries the full result so a caller can
 * render every finding rather than just the first line of the message.
 */
export class LeaflyPayloadInvalidError extends Error {
  readonly result: LeaflyValidationResult;

  constructor(result: LeaflyValidationResult) {
    super(
      `Leafly payload failed validation with ${result.errors.length} error(s): ` +
        result.errors
          .slice(0, 5)
          .map((e) => `${e.path}: ${e.message}`)
          .join(" | ") +
        (result.errors.length > 5 ? ` | …and ${result.errors.length - 5} more` : ""),
    );
    this.name = "LeaflyPayloadInvalidError";
    this.result = result;
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Keys the v2 item contract defines. Anything else is drift. */
const KNOWN_ITEM_KEYS = new Set([
  "id",
  "type",
  "name",
  "strain",
  "brand",
  "compounds",
  "total_thc",
  "total_cbd",
  "variants",
  "description",
  "availableForPickup",
  "imageUrl",
]);

/** Keys the v2 variant contract defines. */
const KNOWN_VARIANT_KEYS = new Set([
  "id",
  "medical",
  "price",
  "amount",
  "unit",
  "inventoryLevel",
]);

/** Keys a compounds[] entry may carry. */
const KNOWN_COMPOUND_KEYS = new Set(["type", "content", "unit"]);

/** Keys total_thc / total_cbd may carry — note: NO `type`. */
const KNOWN_TOTAL_KEYS = new Set(["content", "unit"]);

class IssueCollector {
  readonly issues: LeaflyValidationIssue[] = [];

  add(
    severity: LeaflyValidationSeverity,
    code: string,
    path: string,
    itemId: string | null,
    message: string,
  ): void {
    this.issues.push({ severity, code, path, itemId, message });
  }

  error(code: string, path: string, itemId: string | null, message: string): void {
    this.add("error", code, path, itemId, message);
  }

  warn(code: string, path: string, itemId: string | null, message: string): void {
    this.add("warning", code, path, itemId, message);
  }
}

/**
 * Flag any key that is not in the contract.
 *
 * Unknown keys are ERRORS, not warnings, and that is a deliberate choice worth
 * defending: a stray key is nearly always a RENAMED key, which means the real
 * field is missing and its value is silently not being transmitted. That is
 * exactly defect L-04 (`strainName`), L-05 (`brandName`) and L-06 (`totalThc`).
 * Treating it as cosmetic is what let those live for months.
 */
function checkUnknownKeys(
  obj: Record<string, unknown>,
  known: Set<string>,
  path: string,
  itemId: string | null,
  removedInV2: readonly string[],
  c: IssueCollector,
): void {
  for (const key of Object.keys(obj)) {
    if (known.has(key)) continue;

    const correctName = LEAFLY_FORBIDDEN_FIELD_ALIASES[key];
    if (correctName) {
      c.error(
        "forbidden_field_alias",
        `${path}.${key}`,
        itemId,
        `"${key}" is not a Leafly v2 field. The correct field name is "${correctName}". ` +
          `Sending "${key}" means the real field is NOT being transmitted at all.`,
      );
      continue;
    }

    if (removedInV2.includes(key)) {
      c.error(
        "v1_field_removed_in_v2",
        `${path}.${key}`,
        itemId,
        `"${key}" existed in Leafly Menu API v1 and was REMOVED in v2. It is not ignored — ` +
          `it is the signature of code written against the old specification.`,
      );
      continue;
    }

    c.error(
      "unknown_field",
      `${path}.${key}`,
      itemId,
      `"${key}" is not defined anywhere in the Leafly v2 contract. It was either invented ` +
        `or renamed. Nothing is transmitted on a guess.`,
    );
  }
}

/** A finite number that is not NaN/Infinity. JSON cannot carry the others. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function checkCompoundLike(
  obj: unknown,
  path: string,
  itemId: string | null,
  expectedUnit: string | null,
  itemType: string,
  kind: "compound" | "total",
  c: IssueCollector,
): void {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    c.error(
      "compound_not_object",
      path,
      itemId,
      `Expected an object with ${kind === "total" ? "`content` and `unit`" : "`type`, `content` and `unit`"}, got ${
        obj === null ? "null" : Array.isArray(obj) ? "an array" : typeof obj
      }. ` +
        (kind === "total"
          ? "`total_thc`/`total_cbd` are non-nullable objects in the schema — to omit a total, omit the key."
          : ""),
    );
    return;
  }

  const rec = obj as Record<string, unknown>;
  checkUnknownKeys(rec, kind === "total" ? KNOWN_TOTAL_KEYS : KNOWN_COMPOUND_KEYS, path, itemId, [], c);

  // `type` — required on compounds[], and MUST NOT appear on the totals.
  if (kind === "compound") {
    if (!("type" in rec)) {
      c.error("compound_type_missing", `${path}.type`, itemId, "`type` is required on every compounds[] entry.");
    } else if (!isLeaflyCompoundType(rec.type)) {
      c.error(
        "compound_type_unknown",
        `${path}.type`,
        itemId,
        `"${String(rec.type)}" is not one of Leafly's documented compound types. ` +
          `Fail closed: an unrecognised compound is never silently dropped or renamed.`,
      );
    }
  } else if ("type" in rec) {
    c.error(
      "total_has_type",
      `${path}.type`,
      itemId,
      "`total_thc`/`total_cbd` define only `content` and `unit`. A `type` key here is v1-shaped drift.",
    );
  }

  // `content` — required, and nullable BY DESIGN ("use null, not 0, for untested").
  if (!("content" in rec)) {
    c.error("content_missing", `${path}.content`, itemId, "`content` is required (use null for untested).");
  } else if (rec.content !== null && !isFiniteNumber(rec.content)) {
    c.error(
      "content_not_number",
      `${path}.content`,
      itemId,
      `\`content\` must be a number or null; got ${typeof rec.content}. ` +
        `Leafly's schema is explicit: use null for unknown or not-tested values, never 0.`,
    );
  } else if (rec.content === 0) {
    c.warn(
      "content_zero",
      `${path}.content`,
      itemId,
      "`content` is 0, which asserts the product tested at zero. If it was simply not tested, " +
        "the schema asks for null instead.",
    );
  } else if (isFiniteNumber(rec.content) && rec.content < 0) {
    c.error("content_negative", `${path}.content`, itemId, "`content` cannot be negative.");
  } else if (isFiniteNumber(rec.content) && expectedUnit === "percent" && rec.content > 100) {
    c.error(
      "content_percent_over_100",
      `${path}.content`,
      itemId,
      `\`content\` is ${rec.content} with unit "percent". A potency above 100% is impossible; ` +
        `this is almost always a mg value in a percent field.`,
    );
  }

  // `unit` — required, in-enum, AND consistent with the item type.
  if (!("unit" in rec)) {
    c.error("unit_missing", `${path}.unit`, itemId, "`unit` is required.");
    return;
  }
  if (!isLeaflyCompoundUnit(rec.unit)) {
    c.error(
      "unit_out_of_enum",
      `${path}.unit`,
      itemId,
      `"${String(rec.unit)}" is not a legal compound unit. Leafly accepts only "percent" or "mg". ` +
        `(The literal "%" is the single most common wrong value here and is NOT accepted.)`,
    );
    return;
  }
  if (expectedUnit === null) {
    c.warn(
      "compound_ignored_for_type",
      path,
      itemId,
      `Leafly ignores cannabinoid readings for item type "${itemType}", so this value will not ` +
        `appear on the menu. It is harmless but pointless.`,
    );
  } else if (rec.unit !== expectedUnit) {
    c.error(
      "unit_wrong_for_item_type",
      `${path}.unit`,
      itemId,
      `Item type "${itemType}" requires compound unit "${expectedUnit}", but this is "${String(rec.unit)}". ` +
        `Both values are individually in-enum, which is exactly why this has to be checked explicitly.`,
    );
  }
}

function checkVariant(
  v: unknown,
  path: string,
  itemId: string | null,
  itemType: string,
  seenIds: Set<string>,
  c: IssueCollector,
): void {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    c.error("variant_not_object", path, itemId, "Each entry in `variants` must be an object.");
    return;
  }
  const rec = v as Record<string, unknown>;
  checkUnknownKeys(rec, KNOWN_VARIANT_KEYS, path, itemId, LEAFLY_V1_REMOVED_VARIANT_FIELDS, c);

  // All six variant properties are REQUIRED by the schema. This is the check
  // that proves defect L-01/L-02: the old variant shape carried `label` and no
  // `amount`/`unit` at all, so it could never have validated.
  for (const key of ["id", "medical", "price", "amount", "unit", "inventoryLevel"]) {
    if (!(key in rec)) {
      c.error(
        "variant_field_missing",
        `${path}.${key}`,
        itemId,
        `\`${key}\` is required on every variant — the schema marks all six variant properties required.`,
      );
    }
  }

  // id — string (we always send the stricter string form) and unique.
  if ("id" in rec) {
    if (typeof rec.id !== "string" || rec.id.trim() === "") {
      c.error("variant_id_invalid", `${path}.id`, itemId, "`id` must be a non-empty string.");
    } else if (seenIds.has(rec.id)) {
      c.error(
        "variant_id_duplicate",
        `${path}.id`,
        itemId,
        `Duplicate variant id "${rec.id}" within the same item. Leafly's schema notes that the ` +
          `variant id takes precedence over the item id for ORDER INTEGRATION, so a duplicate here ` +
          `becomes an ambiguous order line later.`,
      );
    } else {
      seenIds.add(rec.id);
    }
  }

  if ("medical" in rec && typeof rec.medical !== "boolean") {
    c.error("variant_medical_not_boolean", `${path}.medical`, itemId, "`medical` must be a boolean.");
  }

  // price — integer, MINOR units, minimum 1.
  if ("price" in rec) {
    if (!isFiniteNumber(rec.price)) {
      c.error("variant_price_not_number", `${path}.price`, itemId, "`price` must be a number.");
    } else if (!Number.isInteger(rec.price)) {
      c.error(
        "variant_price_not_integer",
        `${path}.price`,
        itemId,
        `\`price\` must be an INTEGER in minor units (cents); got ${rec.price}. ` +
          `A fractional price here is the signature of dollars being sent where cents are expected.`,
      );
    } else if (rec.price < LEAFLY_PRICE_MIN_MINOR_UNITS) {
      c.error(
        "variant_price_below_minimum",
        `${path}.price`,
        itemId,
        `\`price\` is ${rec.price}; the schema sets minimum ${LEAFLY_PRICE_MIN_MINOR_UNITS}. ` +
          `A zero or negative price is never clamped up — a human decides what this product costs.`,
      );
    } else if (rec.price < 100) {
      c.warn(
        "variant_price_suspiciously_low",
        `${path}.price`,
        itemId,
        `\`price\` is ${rec.price} minor units ($${(rec.price / 100).toFixed(2)}). That is legal, but a ` +
          `price under a dollar is usually dollars mistakenly sent as cents.`,
      );
    }
  }

  // amount — positive number.
  if ("amount" in rec) {
    if (!isFiniteNumber(rec.amount)) {
      c.error("variant_amount_not_number", `${path}.amount`, itemId, "`amount` must be a number.");
    } else if (rec.amount <= 0) {
      c.error(
        "variant_amount_not_positive",
        `${path}.amount`,
        itemId,
        `\`amount\` must be greater than zero; got ${rec.amount}.`,
      );
    }
  }

  // unit — in-enum AND legal for this item type.
  if ("unit" in rec) {
    if (!isLeaflyVariantUnit(rec.unit)) {
      c.error(
        "variant_unit_out_of_enum",
        `${path}.unit`,
        itemId,
        `"${String(rec.unit)}" is not a legal variant unit. Leafly accepts only "oz", "g" or "each".`,
      );
    } else if (isLeaflyFunnelType(itemType)) {
      const legal = LEAFLY_TYPE_UNIT_MATRIX[itemType].variantUnits;
      if (!(legal as readonly string[]).includes(rec.unit)) {
        c.error(
          "variant_unit_wrong_for_item_type",
          `${path}.unit`,
          itemId,
          `Item type "${itemType}" is sold by ${legal.join(" or ")}, but this variant uses "${String(rec.unit)}". ` +
            `Leafly grades data quality at certification, and a Flower item priced "each" is the ` +
            `canonical example of what they fail.`,
        );
      }
    }
  }

  // inventoryLevel — non-negative integer.
  if ("inventoryLevel" in rec) {
    if (!isFiniteNumber(rec.inventoryLevel)) {
      c.error(
        "variant_inventory_not_number",
        `${path}.inventoryLevel`,
        itemId,
        "`inventoryLevel` must be a number.",
      );
    } else if (!Number.isInteger(rec.inventoryLevel) || rec.inventoryLevel < 0) {
      c.error(
        "variant_inventory_invalid",
        `${path}.inventoryLevel`,
        itemId,
        `\`inventoryLevel\` must be a non-negative integer; got ${rec.inventoryLevel}.`,
      );
    } else if (rec.inventoryLevel > LEAFLY_INVENTORY_LEVEL_CAP) {
      // Explicitly NOT an error and explicitly NOT clamped. Leafly caps this on
      // receipt; sending the true count costs nothing and is more honest.
      c.warn(
        "variant_inventory_above_cap",
        `${path}.inventoryLevel`,
        itemId,
        `\`inventoryLevel\` is ${rec.inventoryLevel}; Leafly caps it internally at ` +
          `${LEAFLY_INVENTORY_LEVEL_CAP}. This is fine — the true count is sent deliberately and ` +
          `Leafly does the capping.`,
      );
    }
  }
}

function checkItem(item: unknown, index: number, c: IssueCollector): number {
  const path = `items[${index}]`;

  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    c.error("item_not_object", path, null, "Each entry in `items` must be an object.");
    return 0;
  }
  const rec = item as Record<string, unknown>;
  const itemId = typeof rec.id === "string" ? rec.id : null;

  checkUnknownKeys(rec, KNOWN_ITEM_KEYS, path, itemId, LEAFLY_V1_REMOVED_ITEM_FIELDS, c);

  // Required: id, type, name, variants.
  if (typeof rec.id !== "string" || rec.id.trim() === "") {
    c.error("item_id_invalid", `${path}.id`, itemId, "`id` is required and must be a non-empty string.");
  }
  if (typeof rec.name !== "string" || rec.name.trim() === "") {
    c.error("item_name_invalid", `${path}.name`, itemId, "`name` is required and must be a non-empty string.");
  }

  // type — free text in the schema (minLength 1), which is the danger: a wrong
  // value does not 400, it silently miscategorises. So an unrecognised type is
  // an ERROR here even though Leafly would accept it.
  const itemType = typeof rec.type === "string" ? rec.type : "";
  if (itemType.trim() === "") {
    c.error("item_type_missing", `${path}.type`, itemId, "`type` is required and must be a non-empty string.");
  } else if (!isLeaflyFunnelType(itemType)) {
    c.error(
      "item_type_not_funnel_target",
      `${path}.type`,
      itemId,
      `"${itemType}" is not one of Leafly's ten funnel targets. \`type\` is FREE TEXT in the schema, ` +
        `so Leafly will NOT reject this — it will silently file the product somewhere no shopper ` +
        `filters by. Invisible failure is why this is an error and not a warning.`,
    );
  } else if (itemType === "Other") {
    c.warn(
      "item_type_other",
      `${path}.type`,
      itemId,
      `Item type is "Other", which is legal but means Leafly ignores its cannabinoid values and ` +
        `shoppers cannot filter to it. Usually this means the Greenway category has no mapping yet.`,
    );
  }

  // strain — nullable string, never a placeholder.
  if ("strain" in rec && rec.strain !== null) {
    if (typeof rec.strain !== "string") {
      c.error("item_strain_type", `${path}.strain`, itemId, "`strain` must be a string or null.");
    } else {
      const s = rec.strain.trim();
      if (s === "") {
        c.error(
          "item_strain_empty",
          `${path}.strain`,
          itemId,
          'An empty `strain` string is not "no strain" — use null, which is the documented signal.',
        );
      } else if (/^(na|n\/a|none|unknown|null|n\.a\.)$/i.test(s)) {
        c.error(
          "item_strain_placeholder",
          `${path}.strain`,
          itemId,
          `"${s}" is a placeholder, not a strain. Leafly auto-links strain names to strain pages, so ` +
            `this would publish a link to a strain that does not exist. Use null.`,
        );
      }
    }
  }

  // brand / description — NON-nullable strings. null is a schema violation, and
  // these two are new defects found in this slice.
  for (const key of ["brand", "description"] as const) {
    if (!(key in rec)) continue;
    if (rec[key] === null) {
      c.error(
        "item_null_in_non_nullable",
        `${path}.${key}`,
        itemId,
        `\`${key}\` is declared type "string" with no null in the union, so null is invalid. ` +
          `To send nothing, OMIT the key.`,
      );
    } else if (typeof rec[key] !== "string") {
      c.error("item_field_type", `${path}.${key}`, itemId, `\`${key}\` must be a string.`);
    }
  }

  // imageUrl — nullable, but a non-URL string is a defect.
  if ("imageUrl" in rec && rec.imageUrl !== null) {
    if (typeof rec.imageUrl !== "string") {
      c.error("item_image_type", `${path}.imageUrl`, itemId, "`imageUrl` must be a string or null.");
    } else if (!/^https?:\/\/\S+$/i.test(rec.imageUrl.trim())) {
      c.error(
        "item_image_not_url",
        `${path}.imageUrl`,
        itemId,
        `\`imageUrl\` must be a valid absolute URL ("${rec.imageUrl}" is not). Leafly fetches and ` +
          `caches this; a relative path resolves against Leafly's domain, not ours.`,
      );
    } else if (rec.imageUrl.trim().toLowerCase().startsWith("http://")) {
      c.warn(
        "item_image_insecure",
        `${path}.imageUrl`,
        itemId,
        "`imageUrl` is http, not https. It will usually still fetch, but it is worth fixing.",
      );
    }
  }

  if ("availableForPickup" in rec && typeof rec.availableForPickup !== "boolean") {
    c.error(
      "item_pickup_not_boolean",
      `${path}.availableForPickup`,
      itemId,
      "`availableForPickup` must be a boolean when present (omit it to keep the current setting).",
    );
  }

  // compounds + totals, checked against the unit the ITEM TYPE demands.
  const expectedUnit = compoundUnitForType(itemType);

  if ("compounds" in rec) {
    if (!Array.isArray(rec.compounds)) {
      c.error("item_compounds_not_array", `${path}.compounds`, itemId, "`compounds` must be an array.");
    } else {
      const seenTypes = new Set<string>();
      rec.compounds.forEach((cp, i) => {
        checkCompoundLike(cp, `${path}.compounds[${i}]`, itemId, expectedUnit, itemType, "compound", c);
        const t = (cp as Record<string, unknown> | null)?.type;
        if (typeof t === "string") {
          if (seenTypes.has(t)) {
            c.error(
              "compound_type_duplicate",
              `${path}.compounds[${i}].type`,
              itemId,
              `Compound type "${t}" appears more than once. Which reading is authoritative is undefined.`,
            );
          }
          seenTypes.add(t);
        }
      });
    }
  }

  for (const key of ["total_thc", "total_cbd"] as const) {
    if (!(key in rec)) continue;
    if (rec[key] === null) {
      c.error(
        "total_null",
        `${path}.${key}`,
        itemId,
        `\`${key}\` is a non-nullable object (required: content, unit). To send no total, OMIT the key — ` +
          `null is not a softer form of removal here.`,
      );
      continue;
    }
    checkCompoundLike(rec[key], `${path}.${key}`, itemId, expectedUnit, itemType, "total", c);
  }

  // variants — required, minItems 1.
  if (!Array.isArray(rec.variants)) {
    c.error("item_variants_not_array", `${path}.variants`, itemId, "`variants` is required and must be an array.");
    return 0;
  }
  if (rec.variants.length < LEAFLY_MIN_VARIANTS_PER_ITEM) {
    c.error(
      "item_variants_empty",
      `${path}.variants`,
      itemId,
      `Every item needs at least ${LEAFLY_MIN_VARIANTS_PER_ITEM} variant (schema minItems). ` +
        `An item with no variants has no price and nothing to sell.`,
    );
    return 0;
  }

  const seenVariantIds = new Set<string>();
  rec.variants.forEach((v, i) => {
    checkVariant(v, `${path}.variants[${i}]`, itemId, itemType, seenVariantIds, c);
  });

  // FINDING L-21 -- two variants Leafly cannot tell apart.
  //
  // Leafly's variant describes its size with exactly one pair of fields:
  // `amount` and `unit`. There is no label, no name, no size string. So two
  // variants of the same item carrying the same amount+unit are not two similar
  // sizes to Leafly -- they are one size sent twice, and only one survives.
  //
  // This is how the owner's first push produced four "Size/variant ... is
  // missing from Leafly's menu" errors on a push that was otherwise a complete
  // success. Nothing failed in transit. Two sizes described themselves
  // identically, and Leafly kept one.
  //
  // The collision is easy to create without noticing, because every rule that
  // produces it is individually correct. `variantAmountAndUnit()` maps every
  // variant of a COUNTED type (Topical, PreRoll, Edible, Accessory, Seeds,
  // Clone, Other) to `1 each`, because Leafly permits no other unit for those
  // types and a variant IS one package. MIXED types (Cartridge, Concentrate) do
  // the same whenever the label carries no readable weight. Both behaviours are
  // documented and deliberate. It is the COMBINATION with a multi-size product
  // that loses data -- the same shape of defect as the read-back scope bug.
  //
  // This is an ERROR, not a warning. A warning would be the softer, safer-looking
  // choice, and it would be wrong: the outcome is a size silently vanishing from
  // a cannabis menu, which is a pricing and compliance problem, not a cosmetic
  // one. It is also perfectly detectable before we send, so there is no reason
  // to let it through and discover it in a read-back afterwards.
  //
  // We do NOT auto-merge or auto-drop the losers. Choosing which size survives
  // is a decision about what the shop sells, and it belongs to the shop.
  {
    const identified: IdentifiedVariant[] = [];
    for (const v of rec.variants) {
      if (v === null || typeof v !== "object" || Array.isArray(v)) continue;
      const vr = v as Record<string, unknown>;
      // Only consider variants that are otherwise well-formed enough to have a
      // size. A variant with a missing or non-numeric amount already produced
      // its own finding above, and reporting it a second time as a "collision"
      // would be duplicate noise about a single underlying problem.
      if (typeof vr.id !== "string" || vr.id.trim() === "") continue;
      if (typeof vr.amount !== "number" || !Number.isFinite(vr.amount)) continue;
      if (typeof vr.unit !== "string" || vr.unit.trim() === "") continue;
      identified.push({ id: vr.id, amount: vr.amount, unit: vr.unit });
    }

    for (const collision of findVariantCollisions(identified)) {
      c.error(
        "variant_size_indistinguishable",
        `${path}.variants`,
        itemId,
        `${collision.variantIds.length} sizes of this item are all described to Leafly as ` +
          `"${collision.size}" (${collision.variantIds.join(", ")}). Leafly identifies a size ` +
          `only by its amount and unit, so it will keep one and silently discard the ` +
          `${collision.likelyLostIds.length === 1 ? "other" : "others"}. ` +
          // Type-aware: "relabel them" is impossible advice for an each-only
          // type such as Topical or PreRoll, and impossible advice is worse
          // than none. See remedyForCollision().
          //
          // An unrecognised type is already an error of its own further up, and
          // Leafly funnels it to `Other`, which is each-only -- so falling back
          // to the each-only wording is the honest answer rather than a guess.
          `${remedyForCollision(
            isLeaflyFunnelType(itemType)
              ? LEAFLY_TYPE_UNIT_MATRIX[itemType].variantUnits
              : LEAFLY_TYPE_UNIT_MATRIX.Other.variantUnits,
          )} ` +
          `A size that vanishes from the menu is not something a customer or an inspector ` +
          `will forgive.`,
      );
    }
  }

  return rec.variants.length;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a built Leafly items payload against the v2 contract.
 *
 * Takes `unknown` on purpose. The whole point is to catch a payload whose TYPE
 * says one thing and whose RUNTIME SHAPE says another — which is exactly what
 * happened here, where `LeaflyItem` typechecked perfectly for months while
 * describing fields Leafly does not define.
 */
export function validateLeaflyPayload(payload: unknown): LeaflyValidationResult {
  const c = new IssueCollector();
  let itemsChecked = 0;
  let variantsChecked = 0;

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    c.error("payload_not_object", "$", null, "The payload must be an object with an `items` array.");
  } else {
    const rec = payload as Record<string, unknown>;

    for (const key of Object.keys(rec)) {
      if (key !== "items") {
        c.error(
          "payload_unknown_key",
          `$.${key}`,
          null,
          `The items payload defines only \`items\`; "${key}" is not part of the contract.`,
        );
      }
    }

    if (!Array.isArray(rec.items)) {
      c.error("payload_items_missing", "$.items", null, "`items` is required and must be an array.");
    } else {
      itemsChecked = rec.items.length;

      const seenItemIds = new Set<string>();
      rec.items.forEach((item, i) => {
        variantsChecked += checkItem(item, i, c);
        const id = (item as Record<string, unknown> | null)?.id;
        if (typeof id === "string" && id !== "") {
          if (seenItemIds.has(id)) {
            c.error(
              "item_id_duplicate",
              `items[${i}].id`,
              id,
              `Duplicate item id "${id}" in the same payload. Leafly upserts by id, so one of these ` +
                `silently overwrites the other and a product disappears from the menu.`,
            );
          }
          seenItemIds.add(id);
        }
      });
    }
  }

  const errors = c.issues.filter((i) => i.severity === "error");
  const warnings = c.issues.filter((i) => i.severity === "warning");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    issues: c.issues,
    itemsChecked,
    variantsChecked,
  };
}

/**
 * Validate, or throw. This is the call site a transmitter should use.
 *
 * Deliberately all-or-nothing: it does NOT drop the offending items and send
 * the rest. A payload that fails validation means the BUILDER is wrong, and a
 * wrong builder usually produces a systematic error affecting many items the
 * same way. Sending "the good ones" would publish a partial menu and bury the
 * cause.
 */
export function assertLeaflyPayloadValid(payload: LeaflyItemsPayload | unknown): LeaflyValidationResult {
  const result = validateLeaflyPayload(payload);
  if (!result.ok) throw new LeaflyPayloadInvalidError(result);
  return result;
}

/** Render a result as human-readable lines for a log or an admin screen. */
export function describeLeaflyValidation(result: LeaflyValidationResult): string[] {
  const lines: string[] = [];
  lines.push(
    result.ok
      ? `Leafly payload OK — ${result.itemsChecked} item(s), ${result.variantsChecked} variant(s), ` +
          `${result.warnings.length} warning(s).`
      : `Leafly payload BLOCKED — ${result.errors.length} error(s) across ${result.itemsChecked} item(s).`,
  );
  for (const issue of result.issues) {
    lines.push(`  [${issue.severity.toUpperCase()}] ${issue.path} (${issue.code}): ${issue.message}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runLeaflyPayloadValidateTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL: ${label}`);
    }
  };

  /** A minimal, fully-legal flower item. Every negative case mutates a copy. */
  const goodVariant: LeaflyVariant = {
    id: "v1",
    medical: false,
    price: 3500,
    amount: 3.5,
    unit: "g",
    inventoryLevel: 4,
  };
  const goodItem: LeaflyItem = {
    id: "p1",
    type: "Flower",
    name: "Blue Dream 3.5g",
    variants: [goodVariant],
    strain: "Blue Dream",
    brand: "Acme",
    compounds: [{ type: "thc", content: 21.4, unit: "percent" }],
    total_thc: { content: 21.4, unit: "percent" },
    description: "Nice.",
    imageUrl: "https://cdn.example.com/p1.jpg",
  };
  const good: LeaflyItemsPayload = { items: [goodItem] };

  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const codes = (p: unknown) => validateLeaflyPayload(p).issues.map((i) => i.code);
  const hasCode = (p: unknown, code: string) => codes(p).includes(code);

  // --- the happy path -------------------------------------------------------
  const r = validateLeaflyPayload(good);
  ok("good payload ok", r.ok);
  ok("good payload has no errors", r.errors.length === 0);
  ok("good payload has no warnings", r.warnings.length === 0);
  ok("good payload counts items", r.itemsChecked === 1);
  ok("good payload counts variants", r.variantsChecked === 1);
  ok("assert does not throw on good payload", (() => {
    try {
      assertLeaflyPayloadValid(good);
      return true;
    } catch {
      return false;
    }
  })());

  // Legal minimum: only the four required item fields.
  ok(
    "minimal item ok",
    validateLeaflyPayload({
      items: [{ id: "x", type: "Edible", name: "Gummy", variants: [{ id: "v", medical: false, price: 1500, amount: 1, unit: "each", inventoryLevel: 2 }] }],
    }).ok,
  );

  // --- payload envelope -----------------------------------------------------
  ok("null payload fails", !validateLeaflyPayload(null).ok);
  ok("array payload fails", !validateLeaflyPayload([]).ok);
  ok("string payload fails", !validateLeaflyPayload("nope").ok);
  ok("missing items fails", hasCode({}, "payload_items_missing"));
  ok("items not array fails", hasCode({ items: {} }, "payload_items_missing"));
  ok("extra top-level key fails", hasCode({ items: [], extra: 1 }, "payload_unknown_key"));
  ok("empty items array is legal", validateLeaflyPayload({ items: [] }).ok);

  // --- THE EIGHT ORIGINAL FIELD-NAME DEFECTS --------------------------------
  // Each of these is a real bug this slice repaired. If the validator ever
  // stops catching one, the bug can come back unnoticed.
  for (const [wrong, right] of Object.entries(LEAFLY_FORBIDDEN_FIELD_ALIASES)) {
    const bad = clone(good);
    (bad.items[0] as unknown as Record<string, unknown>)[wrong] = "x";
    const issues = validateLeaflyPayload(bad).issues;
    const found = issues.find((i) => i.path.endsWith(`.${wrong}`));
    ok(`forbidden alias "${wrong}" is an error`, found?.severity === "error");
    ok(`alias "${wrong}" names the correct field "${right}"`, (found?.message ?? "").includes(`"${right}"`));
  }

  // v1 fields removed in v2.
  for (const dead of LEAFLY_V1_REMOVED_ITEM_FIELDS) {
    const bad = clone(good);
    (bad.items[0] as unknown as Record<string, unknown>)[dead] = "x";
    ok(`v1 item field "${dead}" rejected`, !validateLeaflyPayload(bad).ok);
  }
  for (const dead of LEAFLY_V1_REMOVED_VARIANT_FIELDS) {
    const bad = clone(good);
    (bad.items[0].variants[0] as unknown as Record<string, unknown>)[dead] = "x";
    ok(`v1 variant field "${dead}" rejected`, !validateLeaflyPayload(bad).ok);
  }

  // A wholly invented field.
  {
    const bad = clone(good);
    (bad.items[0] as unknown as Record<string, unknown>).sparkle = true;
    ok("invented field rejected", hasCode(bad, "unknown_field"));
  }

  // --- item required fields -------------------------------------------------
  for (const key of ["id", "type", "name", "variants"] as const) {
    const bad = clone(good);
    delete (bad.items[0] as unknown as Record<string, unknown>)[key];
    ok(`missing item.${key} fails`, !validateLeaflyPayload(bad).ok);
  }
  {
    const bad = clone(good);
    bad.items[0].name = "   ";
    ok("blank name fails", hasCode(bad, "item_name_invalid"));
  }
  {
    const bad = clone(good);
    bad.items[0].variants = [];
    ok("empty variants fails", hasCode(bad, "item_variants_empty"));
  }
  {
    const bad = clone(good);
    bad.items.push(clone(goodItem));
    ok("duplicate item id fails", hasCode(bad, "item_id_duplicate"));
  }

  // --- item.type: free text, so a wrong value must be OUR error -------------
  {
    const bad = clone(good);
    (bad.items[0] as unknown as Record<string, unknown>).type = "flower"; // lowercase
    ok("lowercase type rejected (not a funnel target)", hasCode(bad, "item_type_not_funnel_target"));
  }
  {
    const bad = clone(good);
    (bad.items[0] as unknown as Record<string, unknown>).type = "tincture"; // the invented L-12 value
    ok("invented type 'tincture' rejected", hasCode(bad, "item_type_not_funnel_target"));
  }
  {
    const warnOther = clone(good);
    (warnOther.items[0] as unknown as Record<string, unknown>).type = "Other";
    delete (warnOther.items[0] as unknown as Record<string, unknown>).compounds;
    delete (warnOther.items[0] as unknown as Record<string, unknown>).total_thc;
    warnOther.items[0].variants[0].unit = "each";
    warnOther.items[0].variants[0].amount = 1;
    const res = validateLeaflyPayload(warnOther);
    ok("type Other is legal", res.ok);
    ok("type Other warns", res.warnings.some((w) => w.code === "item_type_other"));
  }

  // --- strain: nullable, but never a placeholder ---------------------------
  {
    const okNull = clone(good);
    okNull.items[0].strain = null;
    ok("strain null is legal", validateLeaflyPayload(okNull).ok);
  }
  for (const placeholder of ["NA", "n/a", "None", "unknown", "NULL"]) {
    const bad = clone(good);
    bad.items[0].strain = placeholder;
    ok(`strain placeholder "${placeholder}" rejected`, hasCode(bad, "item_strain_placeholder"));
  }
  {
    const bad = clone(good);
    bad.items[0].strain = "";
    ok("empty strain string rejected", hasCode(bad, "item_strain_empty"));
  }

  // --- brand / description: NON-nullable (the new defects) -----------------
  for (const key of ["brand", "description"] as const) {
    const bad = clone(good);
    (bad.items[0] as unknown as Record<string, unknown>)[key] = null;
    ok(`null ${key} rejected (non-nullable)`, hasCode(bad, "item_null_in_non_nullable"));
    const omitted = clone(good);
    delete (omitted.items[0] as unknown as Record<string, unknown>)[key];
    ok(`omitted ${key} is legal`, validateLeaflyPayload(omitted).ok);
  }

  // --- totals: non-nullable objects, and NO type key ------------------------
  {
    const bad = clone(good);
    (bad.items[0] as unknown as Record<string, unknown>).total_thc = null;
    ok("null total_thc rejected", hasCode(bad, "total_null"));
  }
  {
    const bad = clone(good);
    (bad.items[0].total_thc as unknown as Record<string, unknown>).type = "thc";
    ok("total with a type key rejected", hasCode(bad, "total_has_type"));
  }
  {
    const bad = clone(good);
    delete (bad.items[0].total_thc as unknown as Record<string, unknown>).unit;
    ok("total missing unit rejected", hasCode(bad, "unit_missing"));
  }

  // --- compounds ------------------------------------------------------------
  {
    const bad = clone(good);
    bad.items[0].compounds![0].unit = "%" as never;
    ok('compound unit "%" rejected', hasCode(bad, "unit_out_of_enum"));
  }
  {
    const bad = clone(good);
    (bad.items[0].compounds![0] as unknown as Record<string, unknown>).type = "terpene";
    ok("unknown compound type rejected", hasCode(bad, "compound_type_unknown"));
  }
  {
    const bad = clone(good);
    bad.items[0].compounds![0].unit = "mg"; // legal enum, wrong for Flower
    ok("mg on Flower rejected", hasCode(bad, "unit_wrong_for_item_type"));
  }
  {
    const bad = clone(good);
    bad.items[0].compounds![0].content = 150;
    ok("percent over 100 rejected", hasCode(bad, "content_percent_over_100"));
  }
  {
    const bad = clone(good);
    bad.items[0].compounds![0].content = -1;
    ok("negative content rejected", hasCode(bad, "content_negative"));
  }
  {
    const warnZero = clone(good);
    warnZero.items[0].compounds![0].content = 0;
    warnZero.items[0].total_thc!.content = 0;
    const res = validateLeaflyPayload(warnZero);
    ok("zero content is legal", res.ok);
    ok("zero content warns (null means untested)", res.warnings.some((w) => w.code === "content_zero"));
  }
  {
    const okNull = clone(good);
    okNull.items[0].compounds![0].content = null;
    okNull.items[0].total_thc!.content = null;
    ok("null content is legal (untested)", validateLeaflyPayload(okNull).ok);
  }
  {
    const bad = clone(good);
    bad.items[0].compounds!.push({ type: "thc", content: 5, unit: "percent" });
    ok("duplicate compound type rejected", hasCode(bad, "compound_type_duplicate"));
  }
  {
    // Compounds on a type Leafly ignores: legal, but worth saying out loud.
    const acc = {
      items: [
        {
          id: "a1",
          type: "Accessory",
          name: "Grinder",
          compounds: [{ type: "thc", content: 1, unit: "percent" }],
          variants: [{ id: "v", medical: false, price: 1500, amount: 1, unit: "each", inventoryLevel: 1 }],
        },
      ],
    };
    const res = validateLeaflyPayload(acc);
    ok("compounds on Accessory legal", res.ok);
    ok("compounds on Accessory warn", res.warnings.some((w) => w.code === "compound_ignored_for_type"));
  }

  // --- variants -------------------------------------------------------------
  for (const key of ["id", "medical", "price", "amount", "unit", "inventoryLevel"] as const) {
    const bad = clone(good);
    delete (bad.items[0].variants[0] as unknown as Record<string, unknown>)[key];
    ok(`missing variant.${key} fails`, hasCode(bad, "variant_field_missing"));
  }
  {
    const bad = clone(good);
    bad.items[0].variants[0].price = 35.5;
    ok("fractional price rejected (cents expected)", hasCode(bad, "variant_price_not_integer"));
  }
  {
    const bad = clone(good);
    bad.items[0].variants[0].price = 0;
    ok("zero price rejected", hasCode(bad, "variant_price_below_minimum"));
  }
  {
    const warnLow = clone(good);
    warnLow.items[0].variants[0].price = 35; // 35 cents — legal, probably dollars
    const res = validateLeaflyPayload(warnLow);
    ok("35-cent price is legal", res.ok);
    ok("35-cent price warns", res.warnings.some((w) => w.code === "variant_price_suspiciously_low"));
  }
  {
    const bad = clone(good);
    bad.items[0].variants[0].unit = "mg" as never;
    ok("out-of-enum variant unit rejected", hasCode(bad, "variant_unit_out_of_enum"));
  }
  {
    const bad = clone(good);
    bad.items[0].variants[0].unit = "each"; // legal enum, illegal for Flower
    ok("Flower priced 'each' rejected", hasCode(bad, "variant_unit_wrong_for_item_type"));
  }
  {
    const bad = clone(good);
    bad.items[0].variants[0].amount = 0;
    ok("zero amount rejected", hasCode(bad, "variant_amount_not_positive"));
  }
  {
    const bad = clone(good);
    bad.items[0].variants[0].inventoryLevel = -1;
    ok("negative inventory rejected", hasCode(bad, "variant_inventory_invalid"));
  }
  {
    const bad = clone(good);
    bad.items[0].variants[0].inventoryLevel = 2.5;
    ok("fractional inventory rejected", hasCode(bad, "variant_inventory_invalid"));
  }
  {
    const warnCap = clone(good);
    warnCap.items[0].variants[0].inventoryLevel = 250;
    const res = validateLeaflyPayload(warnCap);
    ok("inventory above cap is legal (never clamped)", res.ok);
    ok("inventory above cap warns", res.warnings.some((w) => w.code === "variant_inventory_above_cap"));
  }
  {
    const bad = clone(good);
    bad.items[0].variants.push(clone(goodVariant));
    ok("duplicate variant id rejected", hasCode(bad, "variant_id_duplicate"));
  }
  {
    const bad = clone(good);
    (bad.items[0].variants[0] as unknown as Record<string, unknown>).medical = "false";
    ok("string medical rejected", hasCode(bad, "variant_medical_not_boolean"));
  }

  // --- FINDING L-21: sizes Leafly cannot tell apart --------------------------
  //
  // The NEGATIVE CONTROL comes first, deliberately. A check that fires on a
  // correct payload is worse than no check, because it trains the reader to
  // scroll past it.
  {
    const distinct = clone(good);
    distinct.items[0].variants = [
      { ...distinct.items[0].variants[0], id: "v-a", amount: 3.5, unit: "g" },
      { ...distinct.items[0].variants[0], id: "v-b", amount: 7, unit: "g" },
    ];
    ok(
      "genuinely distinct sizes produce NO collision finding",
      !hasCode(distinct, "variant_size_indistinguishable"),
    );
  }
  {
    const single = clone(good);
    single.items[0].variants = [{ ...single.items[0].variants[0], id: "v-only", amount: 1, unit: "each" }];
    ok(
      "a single variant cannot collide with itself",
      !hasCode(single, "variant_size_indistinguishable"),
    );
  }
  {
    // The owner's real case: two counted-type sizes both mapping to `1 each`.
    const collide = clone(good);
    collide.items[0].variants = [
      { ...collide.items[0].variants[0], id: "v-1", amount: 1, unit: "each" },
      { ...collide.items[0].variants[0], id: "v-2", amount: 1, unit: "each" },
    ];
    ok("two identical sizes rejected", hasCode(collide, "variant_size_indistinguishable"));
    ok("collision is an ERROR not a warning", !validateLeaflyPayload(collide).ok);
  }
  {
    // Same amount, different unit is NOT a collision.
    const mixed = clone(good);
    mixed.items[0].variants = [
      { ...mixed.items[0].variants[0], id: "v-1", amount: 1, unit: "g" },
      { ...mixed.items[0].variants[0], id: "v-2", amount: 1, unit: "each" },
    ];
    ok(
      "same amount with different units does not collide",
      !hasCode(mixed, "variant_size_indistinguishable"),
    );
  }
  {
    // CRITICAL: the same size on two DIFFERENT items must never be reported.
    // A menu where every product has a 1g would otherwise light up entirely.
    const twoItems = clone(good);
    const second = clone(good).items[0];
    second.id = "second-item";
    second.variants = [{ ...second.variants[0], id: "s-1", amount: 1, unit: "each" }];
    twoItems.items[0].variants = [
      { ...twoItems.items[0].variants[0], id: "f-1", amount: 1, unit: "each" },
    ];
    twoItems.items.push(second);
    ok(
      "the same size on different items is not a collision",
      !hasCode(twoItems, "variant_size_indistinguishable"),
    );
  }
  {
    // A variant with a broken amount already reports its own defect; it must not
    // ALSO be counted as a collision, or one problem produces two findings.
    const broken = clone(good);
    broken.items[0].variants = [
      { ...broken.items[0].variants[0], id: "b-1", amount: 1, unit: "each" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...broken.items[0].variants[0], id: "b-2", amount: "1" as any, unit: "each" },
    ];
    ok(
      "a malformed amount is not double-reported as a collision",
      !hasCode(broken, "variant_size_indistinguishable"),
    );
  }
  {
    const three = clone(good);
    three.items[0].variants = [
      { ...three.items[0].variants[0], id: "t-1", amount: 1, unit: "each" },
      { ...three.items[0].variants[0], id: "t-2", amount: 1, unit: "each" },
      { ...three.items[0].variants[0], id: "t-3", amount: 1, unit: "each" },
    ];
    const res = validateLeaflyPayload(three);
    const hits = res.errors.filter((e) => e.code === "variant_size_indistinguishable");
    ok("a three-way collision is reported once, not twice", hits.length === 1);
    ok("the collision message names every colliding id", hits[0].message.includes("t-3"));
  }

  // --- imageUrl -------------------------------------------------------------
  {
    const okNull = clone(good);
    okNull.items[0].imageUrl = null;
    ok("null imageUrl legal (removes image)", validateLeaflyPayload(okNull).ok);
  }
  {
    const bad = clone(good);
    bad.items[0].imageUrl = "/images/p1.jpg";
    ok("relative imageUrl rejected", hasCode(bad, "item_image_not_url"));
  }
  {
    const warnHttp = clone(good);
    warnHttp.items[0].imageUrl = "http://cdn.example.com/p1.jpg";
    const res = validateLeaflyPayload(warnHttp);
    ok("http imageUrl legal", res.ok);
    ok("http imageUrl warns", res.warnings.some((w) => w.code === "item_image_insecure"));
  }

  // --- availableForPickup ---------------------------------------------------
  {
    const bad = clone(good);
    (bad.items[0] as unknown as Record<string, unknown>).availableForPickup = "yes";
    ok("string availableForPickup rejected", hasCode(bad, "item_pickup_not_boolean"));
  }
  {
    const okBool = clone(good);
    okBool.items[0].availableForPickup = true;
    ok("boolean availableForPickup legal", validateLeaflyPayload(okBool).ok);
  }

  // --- IT NEVER REPAIRS (house rule 3) -------------------------------------
  // The single most important property of this module: validating a bad payload
  // must leave that payload byte-identical. A validator that "helps" is a
  // validator that silently changes what gets transmitted.
  {
    const bad = clone(good);
    bad.items[0].variants[0].price = 0;
    bad.items[0].strain = "NA";
    bad.items[0].variants[0].inventoryLevel = 999;
    const before = JSON.stringify(bad);
    validateLeaflyPayload(bad);
    ok("validation never mutates the payload", JSON.stringify(bad) === before);
  }

  // --- throwing form --------------------------------------------------------
  {
    const bad = clone(good);
    bad.items[0].variants[0].price = 0;
    let threw = false;
    let carried = false;
    try {
      assertLeaflyPayloadValid(bad);
    } catch (e) {
      threw = true;
      carried = e instanceof LeaflyPayloadInvalidError && e.result.errors.length > 0;
    }
    ok("assert throws on bad payload", threw);
    ok("thrown error carries the full result", carried);
  }

  // --- reporting ------------------------------------------------------------
  {
    const lines = describeLeaflyValidation(validateLeaflyPayload(good));
    ok("describe reports ok", lines[0].includes("OK"));
    const bad = clone(good);
    bad.items[0].variants[0].price = 0;
    const badLines = describeLeaflyValidation(validateLeaflyPayload(bad));
    ok("describe reports blocked", badLines[0].includes("BLOCKED"));
    ok("describe lists the issue", badLines.some((l) => l.includes("variant_price_below_minimum")));
  }

  // --- errors and warnings are partitioned, never conflated ----------------
  {
    const mixed = clone(good);
    mixed.items[0].variants[0].price = 0; // error
    mixed.items[0].variants[0].inventoryLevel = 999; // warning
    const res = validateLeaflyPayload(mixed);
    ok("mixed: not ok", !res.ok);
    ok("mixed: has both", res.errors.length > 0 && res.warnings.length > 0);
    ok("mixed: issues is the union", res.issues.length === res.errors.length + res.warnings.length);
    ok("mixed: no error in warnings", res.warnings.every((w) => w.severity === "warning"));
    ok("mixed: no warning in errors", res.errors.every((e) => e.severity === "error"));
  }

  // --- every issue is actionable -------------------------------------------
  {
    const bad = clone(good);
    bad.items[0].variants[0].price = 0;
    const res = validateLeaflyPayload(bad);
    ok("issues carry a code", res.issues.every((i) => i.code.length > 0));
    ok("issues carry a path", res.issues.every((i) => i.path.length > 0));
    ok("issues carry a message", res.issues.every((i) => i.message.length > 10));
    ok("issues carry the item id", res.issues.every((i) => i.itemId === "p1"));
  }

  console.log(`leafly-payload-validate: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} leafly-payload-validate test(s) failed`);
  return { passed, failed };
}
