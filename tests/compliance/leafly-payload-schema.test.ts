/**
 * tests/compliance/leafly-payload-schema.test.ts
 *
 * SLICE L-2 — validate REAL GENERATED PAYLOADS against Leafly's own JSON Schema.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT A DUPLICATE OF leafly-contract.test.ts
 * -----------------------------------------------------------------------------
 * `leafly-contract.test.ts` (slice L-1) asserts that our CONSTANTS match Leafly's
 * schema: that `LEAFLY_ITEM_FIELDS.strain` really is `"strain"`, that the enums
 * line up, that nothing we declare has been renamed upstream. That is a test of
 * the vocabulary.
 *
 * It cannot catch a mapper that knows the right field names and still emits the
 * wrong document. `payload-core.ts` could import every constant correctly and
 * then write `null` into a non-nullable field, omit a required one, or attach a
 * compound to a type that forbids it — and L-1's tests would stay green. Two of
 * the three NEW defects found in this slice were exactly that shape.
 *
 * So this file closes the remaining gap: it takes the ACTUAL output of
 * `buildLeaflyItemsPayload()` for realistic Greenway inventory and runs it
 * through a real JSON Schema validator against the vendored live schema. Not a
 * hand-written approximation of the rules — the rules themselves, as published
 * by Leafly.
 *
 * This is the test that makes the L-01…L-08 / L-12 class of drift structurally
 * unable to recur: any future change to the mapper that produces a
 * non-conforming document fails here, in CI, before a credential is ever used.
 *
 * Ground truth: docs/leafly-specs/schemas/v2-items.json (docs/leafly-specs/SOURCES.md)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import {
  buildLeaflyItemsPayload,
  buildLeaflyItemsResult,
  toLeaflyType,
} from "@/lib/leafly/payload-core";
import { validateLeaflyPayload } from "@/lib/leafly/payload-validate-core";
import { applyLeaflySettings } from "@/lib/syndication/apply-settings-core";
import { LEAFLY_FUNNEL_TYPES, LEAFLY_TYPE_UNIT_MATRIX } from "@/lib/leafly/contract-core";
import type { SyndicationItem, SyndicationVariant } from "@/lib/syndication/menu-feed-core";

// ---------------------------------------------------------------------------
// The validator, built from Leafly's published schema
// ---------------------------------------------------------------------------

const SCHEMA_PATH = "docs/leafly-specs/schemas/v2-items.json";
const schema = JSON.parse(readFileSync(join(process.cwd(), SCHEMA_PATH), "utf8")) as object;

/**
 * `allErrors` so a failure lists everything wrong at once rather than making us
 * fix one field per CI run.
 *
 * `strictSchema` is not set because ajv 6 has no strict mode; the schema is
 * Leafly's and is taken verbatim.
 */
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

/** Validate and return readable errors (empty array = valid). */
function schemaErrors(payload: unknown): string[] {
  const valid = validate(payload);
  if (valid) return [];
  return (validate.errors ?? []).map(
    (e) => `${e.dataPath || "$"} ${e.message}${e.params ? ` ${JSON.stringify(e.params)}` : ""}`,
  );
}

// ---------------------------------------------------------------------------
// Realistic Greenway fixtures
// ---------------------------------------------------------------------------

function variant(over: Partial<SyndicationVariant> = {}): SyndicationVariant {
  return {
    id: "v1",
    label: "3.5g",
    priceMinorUnits: 3500,
    inStock: true,
    inventoryLevel: 4,
    ...over,
  } as SyndicationVariant;
}

function item(over: Partial<SyndicationItem> = {}): SyndicationItem {
  return {
    id: "p1",
    name: "Blue Dream",
    brand: "Acme Farms",
    category: "flower",
    strainType: "sativa",
    strainName: "Blue Dream",
    thc: "22.4%",
    cbd: "0.1%",
    description: "Smooth and citrusy.",
    priceMinorUnits: 3500,
    inStock: true,
    variants: [variant()],
    ...over,
  };
}

/**
 * One realistic item per Greenway category, with category-appropriate labels.
 * This is the closest thing to "the real menu" a unit test can hold, and it is
 * what makes the sweep below meaningful rather than decorative.
 */
const REAL_WORLD_FEED: SyndicationItem[] = [
  item({ id: "f1", category: "flower", variants: [variant({ id: "f1v1", label: "3.5g" }), variant({ id: "f1v2", label: "7g", priceMinorUnits: 6000 }), variant({ id: "f1v3", label: "1 oz", priceMinorUnits: 18000 })] }),
  item({ id: "f2", category: "popcorn-bud", name: "Popcorn Gelato", variants: [variant({ id: "f2v1", label: "14g", priceMinorUnits: 7000 })] }),
  item({ id: "f3", category: "infused-flower", name: "Moon Rocks", variants: [variant({ id: "f3v1", label: "1g", priceMinorUnits: 2500 })] }),
  item({ id: "f4", category: "trim", name: "Shake", variants: [variant({ id: "f4v1", label: "28g", priceMinorUnits: 5000 })] }),
  item({ id: "pr1", category: "preroll", name: "House Preroll", thc: "24%", variants: [variant({ id: "pr1v1", label: "1g", priceMinorUnits: 800 })] }),
  item({ id: "pr2", category: "preroll-pack", name: "5pk Prerolls", variants: [variant({ id: "pr2v1", label: "5pk", priceMinorUnits: 3500 })] }),
  item({ id: "pr3", category: "infused-preroll", name: "Infused Joint", variants: [variant({ id: "pr3v1", label: "1.2g", priceMinorUnits: 1400 })] }),
  item({ id: "pr4", category: "blunt", name: "Hemp Blunt", variants: [variant({ id: "pr4v1", label: "2g", priceMinorUnits: 2200 })] }),
  item({ id: "c1", category: "concentrate", name: "Live Rosin", thc: "78%", variants: [variant({ id: "c1v1", label: "1g", priceMinorUnits: 5000 })] }),
  item({ id: "c2", category: "rso", name: "RSO Syringe", thc: "65%", variants: [variant({ id: "c2v1", label: "1g", priceMinorUnits: 3000 })] }),
  item({ id: "ct1", category: "cartridge", name: "Sauce Cart", thc: "85%", variants: [variant({ id: "ct1v1", label: "1g", priceMinorUnits: 4000 })] }),
  item({ id: "ct2", category: "disposable-cartridge", name: "Disposable", thc: "80%", variants: [variant({ id: "ct2v1", label: "0.5g", priceMinorUnits: 2500 })] }),
  item({ id: "e1", category: "edible-solid", name: "Gummies", thc: "100mg", cbd: null, variants: [variant({ id: "e1v1", label: "10pk", priceMinorUnits: 1500 })] }),
  item({ id: "e2", category: "edible-liquid", name: "Seltzer", thc: "10mg", variants: [variant({ id: "e2v1", label: "12oz can", priceMinorUnits: 700 })] }),
  item({ id: "e3", category: "tincture", name: "CBD Tincture", thc: "5mg", cbd: "500mg", variants: [variant({ id: "e3v1", label: "30ml", priceMinorUnits: 4500 })] }),
  item({ id: "t1", category: "topical", name: "Salve", thc: null, cbd: "200mg", variants: [variant({ id: "t1v1", label: "2oz jar", priceMinorUnits: 3000 })] }),
  item({ id: "a1", category: "paraphernalia", name: "Grinder", thc: null, cbd: null, strainName: null, variants: [variant({ id: "a1v1", label: "each", priceMinorUnits: 1500 })] }),
  item({ id: "a2", category: "accessories", name: "Lighter", thc: null, cbd: null, strainName: null, variants: [variant({ id: "a2v1", label: "each", priceMinorUnits: 200 })] }),
  item({ id: "a3", category: "merch", name: "Greenway Tee", thc: null, cbd: null, strainName: null, variants: [variant({ id: "a3v1", label: "L", priceMinorUnits: 2500 })] }),
];

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

describe("the vendored schema actually compiles as a JSON Schema", () => {
  it("compiles", () => {
    expect(typeof validate).toBe("function");
  });

  it("rejects a payload the contract forbids (proves the validator is live)", () => {
    // A validator that accepts everything would make every test below pass
    // vacuously. This proves it has teeth before we trust its verdicts.
    expect(schemaErrors({ items: [{ id: "x" }] }).length).toBeGreaterThan(0);
    expect(schemaErrors({})).not.toEqual([]);
  });
});

describe("generated payloads validate against Leafly's published JSON Schema", () => {
  it("a realistic full menu validates with zero schema errors", () => {
    const payload = buildLeaflyItemsPayload(REAL_WORLD_FEED);
    expect(schemaErrors(payload)).toEqual([]);
  });

  it("the realistic menu actually produced items (the test is not vacuous)", () => {
    // An empty `items` array validates perfectly. Without this assertion, a
    // mapper that dropped EVERY product would pass the test above.
    const payload = buildLeaflyItemsPayload(REAL_WORLD_FEED);
    expect(payload.items.length).toBe(REAL_WORLD_FEED.length);
    expect(payload.items.every((i) => i.variants.length > 0)).toBe(true);
  });

  it("every single item validates on its own", () => {
    // Per-item so a failure names the offending product instead of the batch.
    for (const src of REAL_WORLD_FEED) {
      const payload = buildLeaflyItemsPayload([src]);
      expect({ id: src.id, errors: schemaErrors(payload) }).toEqual({ id: src.id, errors: [] });
    }
  });

  it("an empty feed produces a valid empty payload", () => {
    expect(schemaErrors(buildLeaflyItemsPayload([]))).toEqual([]);
  });
});

describe("the payload survives the owner's transmission toggles", () => {
  // This is the combination that actually goes on the wire, and it is where two
  // of this slice's defects lived: the toggle layer rewrote fields AFTER the
  // builder had produced a valid document.
  const combos = [
    { sendDescriptions: true, sendCannabinoids: true, sendImages: true, sendStrains: true },
    { sendDescriptions: false, sendCannabinoids: true, sendImages: true, sendStrains: true },
    { sendDescriptions: true, sendCannabinoids: false, sendImages: true, sendStrains: true },
    { sendDescriptions: true, sendCannabinoids: true, sendImages: false, sendStrains: true },
    { sendDescriptions: true, sendCannabinoids: true, sendImages: true, sendStrains: false },
    { sendDescriptions: false, sendCannabinoids: false, sendImages: false, sendStrains: false },
  ];

  for (const toggles of combos) {
    const label = Object.entries(toggles)
      .map(([k, v]) => `${k.replace("send", "").toLowerCase()}=${v ? "on" : "off"}`)
      .join(" ");

    it(`validates with ${label}`, () => {
      const built = buildLeaflyItemsPayload(REAL_WORLD_FEED);
      const toggled = { items: applyLeaflySettings(built.items, toggles) };
      expect(schemaErrors(toggled)).toEqual([]);
    });
  }

  it("all 16 toggle combinations validate", () => {
    // Exhaustive rather than sampled: there are only sixteen, and the cost of
    // checking them all is a few milliseconds.
    const built = buildLeaflyItemsPayload(REAL_WORLD_FEED);
    for (let mask = 0; mask < 16; mask += 1) {
      const toggles = {
        sendDescriptions: Boolean(mask & 1),
        sendCannabinoids: Boolean(mask & 2),
        sendImages: Boolean(mask & 4),
        sendStrains: Boolean(mask & 8),
      };
      const toggled = { items: applyLeaflySettings(built.items, toggles) };
      expect({ mask, errors: schemaErrors(toggled) }).toEqual({ mask, errors: [] });
    }
  });
});

describe("our own validator agrees with the JSON Schema", () => {
  // Two independent implementations of the same contract. If they disagree,
  // one of them is wrong and we want to know which before Leafly tells us.
  it("accepts everything the schema accepts", () => {
    const payload = buildLeaflyItemsPayload(REAL_WORLD_FEED);
    expect(schemaErrors(payload)).toEqual([]);

    const ours = validateLeaflyPayload(payload);
    expect(ours.errors.map((e) => `${e.path}: ${e.code}`)).toEqual([]);
    expect(ours.ok).toBe(true);
  });

  it("our validator is STRICTER, never looser", () => {
    // Deliberate asymmetry. The schema cannot express "type must be one of the
    // ten funnel targets" (item.type is free text) or "a Flower cannot be sold
    // each". Ours can, and does. So ours may reject things the schema accepts;
    // it must never accept something the schema rejects.
    const looseButLegalToSchema = {
      items: [
        {
          id: "x",
          type: "sparkles", // free text: schema-valid, semantically wrong
          name: "Mystery",
          variants: [{ id: "v", medical: false, price: 100, amount: 1, unit: "each", inventoryLevel: 1 }],
        },
      ],
    };
    expect(schemaErrors(looseButLegalToSchema)).toEqual([]);
    expect(validateLeaflyPayload(looseButLegalToSchema).ok).toBe(false);
  });
});

describe("the repaired defects cannot come back", () => {
  const payload = buildLeaflyItemsPayload(REAL_WORLD_FEED);
  const json = JSON.stringify(payload);

  it("no v1 or invented field name appears anywhere in the payload", () => {
    for (const dead of [
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
      "label",
    ]) {
      expect({ field: dead, present: json.includes(`"${dead}"`) }).toEqual({
        field: dead,
        present: false,
      });
    }
  });

  it('no compound carries the literal "%" unit (L-07)', () => {
    expect(json).not.toContain('"%"');
  });

  it('no compound uses "value" instead of "content" (L-08)', () => {
    expect(json).not.toContain('"value":');
  });

  it("every item.type is one of Leafly's ten funnel targets (L-12)", () => {
    for (const it of payload.items) {
      expect(LEAFLY_FUNNEL_TYPES).toContain(it.type);
    }
  });

  it("cartridges funnel to Cartridge, not Concentrate (L-12)", () => {
    expect(toLeaflyType("cartridge")).toBe("Cartridge");
    expect(toLeaflyType("disposable-cartridge")).toBe("Cartridge");
  });

  it('tinctures never emit the invented type "tincture" (L-12)', () => {
    expect(toLeaflyType("tincture")).toBe("Edible");
    expect(LEAFLY_FUNNEL_TYPES).not.toContain("tincture" as never);
  });

  it("every variant carries the required amount and unit (L-01, L-02)", () => {
    for (const it of payload.items) {
      for (const v of it.variants) {
        expect(typeof v.amount).toBe("number");
        expect(v.amount).toBeGreaterThan(0);
        expect(["oz", "g", "each"]).toContain(v.unit);
      }
    }
  });

  it("every variant unit is legal for its item type", () => {
    for (const it of payload.items) {
      const legal = LEAFLY_TYPE_UNIT_MATRIX[it.type].variantUnits;
      for (const v of it.variants) {
        expect({ id: it.id, unit: v.unit, legal: [...legal] }).toEqual({
          id: it.id,
          unit: v.unit,
          legal: [...legal],
        });
        expect(legal as readonly string[]).toContain(v.unit);
      }
    }
  });

  it("every compound unit matches the unit its item type demands", () => {
    for (const it of payload.items) {
      const expected = LEAFLY_TYPE_UNIT_MATRIX[it.type].compoundUnit;
      if (expected === null) {
        // Leafly ignores compounds for this type: we must not send them.
        expect(it.compounds ?? []).toEqual([]);
        expect(it.total_thc).toBeUndefined();
        expect(it.total_cbd).toBeUndefined();
        continue;
      }
      for (const c of it.compounds ?? []) expect(c.unit).toBe(expected);
      if (it.total_thc) expect(it.total_thc.unit).toBe(expected);
      if (it.total_cbd) expect(it.total_cbd.unit).toBe(expected);
    }
  });

  it("the totals never carry a `type` key", () => {
    for (const it of payload.items) {
      for (const t of [it.total_thc, it.total_cbd]) {
        if (t) expect("type" in t).toBe(false);
      }
    }
  });

  it("brand and description are never null (the new defects)", () => {
    for (const it of payload.items) {
      expect(it.brand === null).toBe(false);
      expect(it.description === null).toBe(false);
    }
  });

  it("availableForPickup is now emitted (L-09, closed in slice L-3)", () => {
    // SLICE L-3 replaces the L-2 assertion that this field must be ABSENT.
    //
    // L-2 deliberately withheld it: turning it on makes real customers able to
    // place real orders the shop has fifteen minutes to acknowledge, which is
    // not a side effect a field-rename slice should have. L-3 emits it, but
    // behind an owner toggle that defaults OFF — so the safety property L-2
    // was protecting is still intact, it is just enforced by the toggle now
    // instead of by the field's absence.
    //
    // `payload` here is built WITHOUT options, so every item must fail closed.
    for (const it of payload.items) {
      expect("availableForPickup" in it).toBe(true);
      expect(it.availableForPickup).toBe(false);
    }
  });

  it("availableForPickup is a real boolean and never null on the wire", () => {
    // The schema declares a plain `"type": "boolean"` — unlike `strain` and
    // `imageUrl`, there is no null form of this field.
    const json = JSON.stringify(payload);
    expect(json).not.toContain('"availableForPickup":null');
    for (const it of payload.items) {
      expect(typeof it.availableForPickup).toBe("boolean");
    }
  });
});

describe("a weight can never be invented (house rule 3)", () => {
  it("flower with an unreadable label is REFUSED, not guessed", () => {
    const result = buildLeaflyItemsResult([
      item({ id: "bad", category: "flower", variants: [variant({ id: "badv", label: "big jar" })] }),
    ]);
    expect(result.payload.items).toEqual([]);
    expect(result.droppedItemIds).toEqual(["bad"]);
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0].reason).toContain("never be guessed");
  });

  it("the refusal names the item, the variant and the label", () => {
    const result = buildLeaflyItemsResult([
      item({ id: "bad", category: "flower", variants: [variant({ id: "badv", label: "big jar" })] }),
    ]);
    expect(result.rejected[0].itemId).toBe("bad");
    expect(result.rejected[0].variantId).toBe("badv");
    expect(result.rejected[0].reason).toContain("big jar");
  });

  it("milligrams are refused on weight-sold types rather than converted", () => {
    // Converting mg->g is arithmetically exact and still wrong: milligrams on
    // flower is a data-entry error, and converting would launder it into a
    // plausible weight nobody would ever question.
    const result = buildLeaflyItemsResult([
      item({ id: "mg", category: "flower", variants: [variant({ id: "mgv", label: "500mg" })] }),
    ]);
    expect(result.payload.items).toEqual([]);
    expect(result.rejected.length).toBe(1);
  });

  it("whatever survives refusal still validates", () => {
    const mixed = [
      item({ id: "ok", category: "flower", variants: [variant({ id: "okv", label: "3.5g" })] }),
      item({ id: "bad", category: "flower", variants: [variant({ id: "badv", label: "big jar" })] }),
    ];
    const result = buildLeaflyItemsResult(mixed);
    expect(result.payload.items.map((i) => i.id)).toEqual(["ok"]);
    expect(schemaErrors(result.payload)).toEqual([]);
  });
});

describe("hostile and degenerate inventory still produces a valid document", () => {
  // Live shop data does things fixtures do not. Whatever comes out must either
  // be schema-valid or must not come out at all — never a malformed document.
  const nasty: SyndicationItem[] = [
    item({ id: "n1", name: "  Padded Name  ", brand: "   ", strainName: "   ", description: "   " }),
    item({ id: "n2", brand: null, strainName: null, thc: null, cbd: null, description: "" }),
    item({ id: "n3", description: "<p>Markup <b>everywhere</b></p>", thc: "not a number" }),
    item({ id: "n4", thc: "22.4", cbd: "0" }),
    item({ id: "n5", name: "Unicode 🌿 Name — em dash", strainName: "Straîn Ñame" }),
    item({ id: "n6", category: "not-a-real-category", variants: [variant({ id: "n6v", label: "each" })] }),
    item({ id: "n7", category: "edible-solid", thc: "1000mg", variants: [variant({ id: "n7v", label: "" })] }),
    item({ id: "n8", category: "edible-solid", variants: [variant({ id: "n8v", label: "10pk", inStock: false, inventoryLevel: 0 })] }),
    item({ id: "n9", category: "edible-solid", variants: [variant({ id: "n9v", inventoryLevel: 99999 })] }),
    item({ id: "n10", category: "accessories", variants: [] }),
    item({ id: "n11", category: "edible-solid", imageUrl: "https://cdn.example.com/x.jpg", variants: [variant({ id: "n11v", label: "each" })] }),
  ];

  it("produces a schema-valid payload", () => {
    expect(schemaErrors(buildLeaflyItemsPayload(nasty))).toEqual([]);
  });

  it("passes our own validator too", () => {
    const res = validateLeaflyPayload(buildLeaflyItemsPayload(nasty));
    expect(res.errors.map((e) => `${e.path} ${e.code}`)).toEqual([]);
  });

  it("never emits an empty-string strain (null is the signal)", () => {
    for (const it of buildLeaflyItemsPayload(nasty).items) {
      expect(it.strain).not.toBe("");
    }
  });

  it('never emits the placeholder "NA" for a missing strain', () => {
    const json = JSON.stringify(buildLeaflyItemsPayload(nasty));
    expect(json).not.toContain('"strain":"NA"');
    expect(json).not.toContain('"strain":"N/A"');
  });

  it("never emits an empty-string brand or description", () => {
    for (const it of buildLeaflyItemsPayload(nasty).items) {
      if ("brand" in it) expect(it.brand).not.toBe("");
      if ("description" in it) expect(it.description).not.toBe("");
    }
  });

  it("strips markup from descriptions", () => {
    const withMarkup = buildLeaflyItemsPayload([nasty[2]]).items[0];
    expect(withMarkup.description ?? "").not.toContain("<");
  });

  it("an unreadable potency becomes null, never 0", () => {
    // "not a number" must not become a confident 0.0% THC reading.
    const it3 = buildLeaflyItemsPayload([nasty[2]]).items[0];
    const thc = (it3.compounds ?? []).find((c) => c.type === "thc");
    if (thc) expect(thc.content).toBeNull();
  });

  it("an unmapped category falls to a real funnel target, never invented", () => {
    const it6 = buildLeaflyItemsPayload([nasty[5]]).items[0];
    expect(LEAFLY_FUNNEL_TYPES).toContain(it6.type);
    expect(it6.type).toBe("Other");
  });

  it("out-of-stock yields inventoryLevel 0 and still validates", () => {
    const it8 = buildLeaflyItemsPayload([nasty[7]]).items[0];
    expect(it8.variants[0].inventoryLevel).toBe(0);
    expect(schemaErrors({ items: [it8] })).toEqual([]);
  });

  it("a huge inventory count is transmitted honestly, not pre-clamped", () => {
    // Leafly caps at 10 on receipt. Sending the true number costs nothing and
    // data quality is graded at certification.
    const it9 = buildLeaflyItemsPayload([nasty[8]]).items[0];
    expect(it9.variants[0].inventoryLevel).toBe(99999);
    expect(schemaErrors({ items: [it9] })).toEqual([]);
  });

  it("an item with no variants still yields one legal variant when possible", () => {
    const it10 = buildLeaflyItemsPayload([nasty[9]]).items[0];
    expect(it10.variants.length).toBe(1);
    expect(it10.variants[0].unit).toBe("each");
    expect(it10.variants[0].amount).toBe(1);
  });

  it("unicode survives intact", () => {
    const it5 = buildLeaflyItemsPayload([nasty[4]]).items[0];
    expect(it5.name).toContain("🌿");
    expect(it5.strain).toBe("Straîn Ñame");
  });

  it("names are trimmed", () => {
    expect(buildLeaflyItemsPayload([nasty[0]]).items[0].name).toBe("Padded Name");
  });
});

describe("determinism", () => {
  it("the same feed always produces byte-identical output", () => {
    // The delta plan hashes this payload for idempotency ("skipped — no
    // changes"). Non-deterministic output would resend the entire menu on
    // every run and make the hash meaningless.
    const a = JSON.stringify(buildLeaflyItemsPayload(REAL_WORLD_FEED));
    const b = JSON.stringify(buildLeaflyItemsPayload(REAL_WORLD_FEED));
    expect(a).toBe(b);
  });

  it("building does not mutate the source feed", () => {
    const before = JSON.stringify(REAL_WORLD_FEED);
    buildLeaflyItemsPayload(REAL_WORLD_FEED);
    expect(JSON.stringify(REAL_WORLD_FEED)).toBe(before);
  });

  it("validating does not mutate the payload", () => {
    const payload = buildLeaflyItemsPayload(REAL_WORLD_FEED);
    const before = JSON.stringify(payload);
    validateLeaflyPayload(payload);
    expect(JSON.stringify(payload)).toBe(before);
  });
});
