/**
 * tests/compliance/leafly-contract.test.ts
 *
 * SLICE L-1 — the Leafly contract must stay true to Leafly's own schema.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `docs/leafly-menu-api-v2.md` was grounded on an owner-supplied COPY of the Leafly spec
 * instead of the live document. That copy claimed v2 used "camelCase convention for all
 * fields" and that v2 had no image field. Both were false. `payload-core.ts` repeated the
 * claim in its own header comment and emitted `brandName`, `strainName`, `totalThc`,
 * `totalCbd` and `value` — none of which exist in Leafly v2 — while omitting the REQUIRED
 * `amount` and `unit`. Validating our real generated payload against Leafly's published
 * JSON Schema produced four hard errors. The first menu push would have been rejected with
 * HTTP 400 on every item, before a credential was ever exercised.
 *
 * A prose document cannot fail CI. That is precisely how it rotted.
 *
 * These tests close the loop by asserting our TypeScript contract against Leafly's ACTUAL
 * vendored schema (`docs/leafly-specs/schemas/v2-items.json`). If Leafly changes a field
 * name, adds a required field, or extends an enum, re-downloading the spec makes this file
 * go red instead of letting us discover it as a 400 in production.
 *
 * They also assert the prose doc repeats no falsehoods, following the precedent set by
 * `announcer-docs.test.ts`.
 *
 * Ground truth: docs/leafly-specs/schemas/v2-items.json (docs/leafly-specs/SOURCES.md)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LEAFLY_COMPOUND_FIELDS,
  LEAFLY_COMPOUND_REQUIRED,
  LEAFLY_COMPOUND_TYPES,
  LEAFLY_COMPOUND_UNITS,
  LEAFLY_FORBIDDEN_FIELD_ALIASES,
  LEAFLY_FUNNEL_TYPES,
  LEAFLY_INVENTORY_LEVEL_CAP,
  LEAFLY_ITEM_FIELDS,
  LEAFLY_ITEM_REQUIRED,
  LEAFLY_MIN_VARIANTS_PER_ITEM,
  LEAFLY_PRICE_MIN_MINOR_UNITS,
  LEAFLY_TYPE_UNIT_MATRIX,
  LEAFLY_V1_REMOVED_ITEM_FIELDS,
  LEAFLY_V1_REMOVED_VARIANT_FIELDS,
  LEAFLY_VARIANT_FIELDS,
  LEAFLY_VARIANT_REQUIRED,
  LEAFLY_VARIANT_UNITS,
  __runLeaflyContractTests,
  compoundUnitForType,
  isLeaflyCompoundUnit,
  isLeaflyFunnelType,
  isVariantUnitValidForType,
} from "@/lib/leafly/contract-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const V2_SCHEMA_PATH = "docs/leafly-specs/schemas/v2-items.json";
const V1_SCHEMA_PATH = "docs/leafly-specs/schemas/v1-items.json";
const DOC_PATH = "docs/leafly-menu-api-v2.md";
const SOURCES_PATH = "docs/leafly-specs/SOURCES.md";

type JsonObject = Record<string, unknown>;
const asObj = (v: unknown): JsonObject => v as JsonObject;

const v2 = JSON.parse(read(V2_SCHEMA_PATH)) as JsonObject;
const v1 = JSON.parse(read(V1_SCHEMA_PATH)) as JsonObject;
const doc = read(DOC_PATH);
const sources = read(SOURCES_PATH);

/** Navigate to the item-level subschema of an items.json document. */
function itemSchema(schema: JsonObject): JsonObject {
  const props = asObj(schema.properties);
  const items = asObj(props.items);
  return asObj(items.items);
}

const v2Item = itemSchema(v2);
const v2ItemProps = asObj(v2Item.properties);
const v2Variant = asObj(asObj(v2ItemProps.variants).items);
const v2VariantProps = asObj(v2Variant.properties);
const v2Compound = asObj(asObj(v2ItemProps.compounds).items);
const v2CompoundProps = asObj(v2Compound.properties);

const v1Item = itemSchema(v1);
const v1ItemProps = asObj(v1Item.properties);
const v1VariantProps = asObj(asObj(asObj(v1ItemProps.variants).items).properties);

describe("the vendored Leafly schema is present and is really a schema", () => {
  it("v2-items.json parses and describes an items array", () => {
    expect(Object.keys(v2ItemProps).length).toBeGreaterThan(5);
    expect(v2.required).toEqual(["items"]);
  });

  it("SOURCES.md records provenance so the file can be re-verified", () => {
    expect(sources).toContain("docs.leafly.io/menu-integration-docs/schemas/v2/items.json");
    expect(sources).toContain("md5");
  });
});

describe("every ITEM field name in our contract exists in Leafly's schema", () => {
  it.each(Object.entries(LEAFLY_ITEM_FIELDS))(
    "item field %s -> %s is a real v2 property",
    (_key, wireName) => {
      expect(Object.keys(v2ItemProps)).toContain(wireName);
    },
  );

  it("our contract covers every item property Leafly defines (nothing missed)", () => {
    const ours = new Set(Object.values(LEAFLY_ITEM_FIELDS) as string[]);
    const theirs = Object.keys(v2ItemProps);
    expect(theirs.filter((f) => !ours.has(f))).toEqual([]);
  });
});

describe("every VARIANT field name in our contract exists in Leafly's schema", () => {
  it.each(Object.entries(LEAFLY_VARIANT_FIELDS))(
    "variant field %s -> %s is a real v2 property",
    (_key, wireName) => {
      expect(Object.keys(v2VariantProps)).toContain(wireName);
    },
  );

  it("our contract covers every variant property Leafly defines", () => {
    const ours = new Set(Object.values(LEAFLY_VARIANT_FIELDS) as string[]);
    expect(Object.keys(v2VariantProps).filter((f) => !ours.has(f))).toEqual([]);
  });
});

describe("COMPOUND field names match", () => {
  it.each(Object.entries(LEAFLY_COMPOUND_FIELDS))(
    "compound field %s -> %s is a real v2 property",
    (_key, wireName) => {
      expect(Object.keys(v2CompoundProps)).toContain(wireName);
    },
  );

  it("total_thc and total_cbd use the same content/unit shape as a compound", () => {
    for (const totals of ["total_thc", "total_cbd"]) {
      const schema = asObj(v2ItemProps[totals]);
      const props = Object.keys(asObj(schema.properties));
      expect(props).toContain(LEAFLY_COMPOUND_FIELDS.content);
      expect(props).toContain(LEAFLY_COMPOUND_FIELDS.unit);
      // Both sub-properties are mandatory once the object is present.
      expect([...(schema.required as string[])].sort()).toEqual(["content", "unit"]);
      expect(schema.type).toBe("object");
    }
  });

  it("total_thc/total_cbd still describe themselves as content+unit objects", () => {
    // Guards upstream drift in the DESCRIPTION, not just the property names: if Leafly
    // reshapes these into bare numbers, the prose changes before the keys do.
    expect(String(asObj(v2ItemProps.total_thc).description)).toMatch(
      /total THC content .* object with `content` and `unit`/i,
    );
    expect(String(asObj(v2ItemProps.total_cbd).description)).toMatch(
      /total CBD content .* object with `content` and `unit`/i,
    );
  });
});

describe("the snake_case exceptions are real — this is the whole point of Slice L-1", () => {
  it("total_thc and total_cbd are snake_case in Leafly's schema", () => {
    expect(Object.keys(v2ItemProps)).toContain("total_thc");
    expect(Object.keys(v2ItemProps)).toContain("total_cbd");
    expect(Object.keys(v2ItemProps)).not.toContain("totalThc");
    expect(Object.keys(v2ItemProps)).not.toContain("totalCbd");
  });

  it("brand and strain carry NO Name suffix", () => {
    expect(Object.keys(v2ItemProps)).toContain("brand");
    expect(Object.keys(v2ItemProps)).toContain("strain");
    expect(Object.keys(v2ItemProps)).not.toContain("brandName");
    expect(Object.keys(v2ItemProps)).not.toContain("strainName");
  });

  it("the v1->v2 diff proves the rename was PARTIAL, not universal", () => {
    // These were renamed to camelCase...
    expect(Object.keys(v1ItemProps)).toContain("image_url");
    expect(Object.keys(v2ItemProps)).toContain("imageUrl");
    expect(Object.keys(v1VariantProps)).toContain("inventory_level");
    expect(Object.keys(v2VariantProps)).toContain("inventoryLevel");
    // ...while these were left exactly as they were.
    expect(Object.keys(v1ItemProps)).toContain("brand");
    expect(Object.keys(v2ItemProps)).toContain("brand");
    // ...and the two snake_case fields are NEW IN v2, not leftovers.
    expect(Object.keys(v1ItemProps)).not.toContain("total_thc");
    expect(Object.keys(v2ItemProps)).toContain("total_thc");
  });
});

describe("no forbidden alias is a real Leafly field", () => {
  it.each(Object.entries(LEAFLY_FORBIDDEN_FIELD_ALIASES))(
    "%s does not exist in v2 (correct name is %s)",
    (alias, correct) => {
      const everywhere = [
        ...Object.keys(v2ItemProps),
        ...Object.keys(v2VariantProps),
        ...Object.keys(v2CompoundProps),
      ];
      expect(everywhere).not.toContain(alias);
      expect(everywhere).toContain(correct);
    },
  );
});

describe("required-field sets match Leafly's schema exactly", () => {
  it("item required set matches", () => {
    expect([...LEAFLY_ITEM_REQUIRED].sort()).toEqual([...(v2Item.required as string[])].sort());
  });

  it("variant required set matches — including amount and unit", () => {
    expect([...LEAFLY_VARIANT_REQUIRED].sort()).toEqual(
      [...(v2Variant.required as string[])].sort(),
    );
    expect(v2Variant.required as string[]).toContain("amount");
    expect(v2Variant.required as string[]).toContain("unit");
  });

  it("compound required set matches — content, not value", () => {
    expect([...LEAFLY_COMPOUND_REQUIRED].sort()).toEqual(
      [...(v2Compound.required as string[])].sort(),
    );
  });

  it("brand/strain/description/imageUrl are NOT required", () => {
    const req = v2Item.required as string[];
    for (const f of ["brand", "strain", "description", "imageUrl", "availableForPickup"]) {
      expect(req).not.toContain(f);
    }
  });
});

describe("enums match Leafly's schema exactly", () => {
  it("compound unit enum matches and excludes '%'", () => {
    const schemaEnum = asObj(v2CompoundProps.unit).enum as string[];
    expect([...LEAFLY_COMPOUND_UNITS]).toEqual(schemaEnum);
    expect(schemaEnum).not.toContain("%");
    expect(isLeaflyCompoundUnit("%")).toBe(false);
  });

  it("variant unit enum matches", () => {
    expect([...LEAFLY_VARIANT_UNITS]).toEqual(asObj(v2VariantProps.unit).enum as string[]);
  });

  it("compound type enum matches all 25 values", () => {
    const schemaEnum = asObj(v2CompoundProps.type).enum as string[];
    expect([...LEAFLY_COMPOUND_TYPES]).toEqual(schemaEnum);
    expect(schemaEnum).toHaveLength(25);
  });

  it("total_thc/total_cbd units use the same enum", () => {
    for (const totals of ["total_thc", "total_cbd"]) {
      const props = asObj(asObj(v2ItemProps[totals]).properties);
      expect(asObj(props.unit).enum as string[]).toEqual([...LEAFLY_COMPOUND_UNITS]);
    }
  });
});

describe("item.type is free text, so its funnel targets must be exact", () => {
  it("the schema does NOT constrain type with an enum", () => {
    // This is why a wrong type is silent instead of a 400 — nothing rejects it.
    expect(asObj(v2ItemProps.type).enum).toBeUndefined();
    expect(asObj(v2ItemProps.type).type).toBe("string");
  });

  it("every funnel type we ship is named in Leafly's own type description", () => {
    const description = String(asObj(v2ItemProps.type).description);
    for (const t of LEAFLY_FUNNEL_TYPES) {
      expect(description).toContain(t);
    }
  });

  it("the values payload-core currently emits are NOT funnel targets", () => {
    // Defect L-12, recorded as a test so L-2 cannot forget it.
    for (const wrong of ["flower", "pre-roll", "topicals", "tincture", "edible", "concentrate"]) {
      expect(isLeaflyFunnelType(wrong)).toBe(false);
    }
  });
});

describe("the type/unit matrix matches Leafly's documented tables", () => {
  it("covers all ten funnel types", () => {
    expect(Object.keys(LEAFLY_TYPE_UNIT_MATRIX).sort()).toEqual([...LEAFLY_FUNNEL_TYPES].sort());
  });

  it("every variant unit in the matrix is in the variant unit enum", () => {
    for (const [, rule] of Object.entries(LEAFLY_TYPE_UNIT_MATRIX)) {
      for (const u of rule.variantUnits) {
        expect(LEAFLY_VARIANT_UNITS as readonly string[]).toContain(u);
      }
    }
  });

  it("matches Leafly's variant.unit table verbatim", () => {
    const table = String(asObj(v2VariantProps.unit).description);
    // Spot-check the rows that actually constrain Greenway's catalogue.
    expect(table).toContain("| Flower      | `g`, `oz`");
    expect(table).toContain("| Edible      | `each`");
    expect(table).toContain("| Cartridge   | `each`, `g`");
    expect(isVariantUnitValidForType("Flower", "g")).toBe(true);
    expect(isVariantUnitValidForType("Flower", "each")).toBe(false);
    expect(isVariantUnitValidForType("Edible", "g")).toBe(false);
  });

  it("matches Leafly's compound.unit table verbatim", () => {
    const table = String(asObj(v2CompoundProps.unit).description);
    expect(table).toContain("| Flower      | `percent`");
    expect(table).toContain("| Edible      | `mg`");
    expect(compoundUnitForType("Flower")).toBe("percent");
    expect(compoundUnitForType("Edible")).toBe("mg");
    expect(compoundUnitForType("Other")).toBeNull();
  });
});

describe("numeric limits match the schema", () => {
  it("inventoryLevel cap of 10 is stated by Leafly", () => {
    expect(String(asObj(v2VariantProps.inventoryLevel).description)).toContain(
      `capped at \`${LEAFLY_INVENTORY_LEVEL_CAP}\``,
    );
  });

  it("price is an integer with the minimum we claim", () => {
    expect(asObj(v2VariantProps.price).type).toBe("integer");
    expect(asObj(v2VariantProps.price).minimum).toBe(LEAFLY_PRICE_MIN_MINOR_UNITS);
  });

  it("variants has the minItems we claim", () => {
    expect(asObj(v2ItemProps.variants).minItems).toBe(LEAFLY_MIN_VARIANTS_PER_ITEM);
  });

  it("compound content and total_* content are nullable — never 0 for unknown", () => {
    expect(asObj(v2CompoundProps.content).type).toEqual(["number", "null"]);
    const desc = String(asObj(v2CompoundProps.content).description);
    expect(desc).toContain("null");
  });

  it("strain is nullable but brand is not", () => {
    expect(asObj(v2ItemProps.strain).type).toEqual(["string", "null"]);
    expect(asObj(v2ItemProps.brand).type).toBe("string");
  });
});

describe("v1-removed fields are really gone from v2", () => {
  it.each(LEAFLY_V1_REMOVED_ITEM_FIELDS)("item field %s existed in v1, absent in v2", (f) => {
    expect(Object.keys(v1ItemProps)).toContain(f);
    expect(Object.keys(v2ItemProps)).not.toContain(f);
  });

  it.each(LEAFLY_V1_REMOVED_VARIANT_FIELDS)(
    "variant field %s existed in v1, absent in v2",
    (f) => {
      expect(Object.keys(v1VariantProps)).toContain(f);
      expect(Object.keys(v2VariantProps)).not.toContain(f);
    },
  );
});

describe("Leafly v2 DOES support images and pickup flags", () => {
  it("imageUrl is a real, documented, URI-formatted field", () => {
    expect(Object.keys(v2ItemProps)).toContain("imageUrl");
    expect(asObj(v2ItemProps.imageUrl).format).toBe("uri");
  });

  it("omitting imageUrl REMOVES an existing image — silence is destructive", () => {
    // This is why "we just don't send images" was never a safe default.
    expect(String(asObj(v2ItemProps.imageUrl).description)).toContain(
      "any existing image will be removed",
    );
  });

  it("availableForPickup exists and new items default to false", () => {
    expect(Object.keys(v2ItemProps)).toContain("availableForPickup");
    expect(String(asObj(v2ItemProps.availableForPickup).description)).toContain(
      "default to false",
    );
  });
});

/**
 * The doc deliberately QUOTES the two old falsehoods inside its "why this was rewritten"
 * warning, because a reader who does not know what the old error was will cheerfully
 * reintroduce it. So these assertions cannot simply grep the whole file for the bad
 * phrases — that would forbid the warning itself.
 *
 * Instead they strip the blockquoted warning block (every line beginning `>`) and assert
 * against the remaining BODY, which is the part a reader treats as current fact.
 */
const docBody = doc
  .split("\n")
  .filter((line) => !line.trimStart().startsWith(">"))
  .join("\n");

describe("the prose doc no longer repeats the falsehoods that caused this slice", () => {
  it("the warning block does still explain the old error (kept on purpose)", () => {
    // Guard the guard: if someone deletes the warning, the next person repeats the bug.
    expect(doc).toMatch(/camelCase/);
    expect(doc).toMatch(/Why this document was rewritten/i);
  });

  it("the BODY never claims camelCase for all fields", () => {
    expect(docBody).not.toMatch(/camelCase\s*(\*\*)?\s*convention for all fields/i);
    expect(docBody).not.toMatch(/camelCase for (all|every)/i);
  });

  it("the BODY never claims v2 lacks an image field", () => {
    expect(docBody).not.toMatch(/no image field/i);
  });

  it("states the snake_case exception explicitly", () => {
    expect(doc).toContain("total_thc");
    expect(doc).toContain("total_cbd");
    expect(doc).toMatch(/snake_case/i);
  });

  it("uses the correct field names, not the aliases", () => {
    // The doc may MENTION a wrong name only to warn about it, so we check the
    // spec-shape section carries the right ones.
    expect(doc).toMatch(/`brand`/);
    expect(doc).toMatch(/`strain`/);
    expect(doc).toMatch(/`content`/);
    expect(doc).toMatch(/`amount`/);
  });

  it("documents imageUrl as a real field, and that omitting it deletes the image", () => {
    expect(docBody).toContain("imageUrl");
    expect(docBody).toMatch(/REMOVES any existing image/i);
  });

  it("documents variant.amount and variant.unit as required", () => {
    const variantSection = doc.slice(doc.indexOf("### Variant"));
    expect(variantSection).toMatch(/amount/);
    expect(variantSection).toMatch(/unit/);
  });

  it("points at the vendored spec as its source of truth", () => {
    expect(doc).toContain("docs/leafly-specs/");
  });

  it("records the correct endpoint paths", () => {
    // POST/PUT/DELETE are all on /menu/items; GET /menu is sandbox-only.
    const paths = Object.keys(asObj(JSON.parse(read("docs/leafly-specs/menu-integration-v2.openapi.json")).paths));
    expect(paths).toContain("/{menu_integration_key}/menu/items");
    expect(doc).toContain("/menu/items");
  });
});

describe("the pure self-tests pass", () => {
  it("__runLeaflyContractTests does not throw", () => {
    expect(() => __runLeaflyContractTests()).not.toThrow();
  });
});
