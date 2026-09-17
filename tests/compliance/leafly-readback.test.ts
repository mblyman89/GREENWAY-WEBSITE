/**
 * SLICE L-4 — the GET /menu readback contract, asserted against Leafly's LIVE schema.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `readback-core.ts` claims to describe the shape Leafly sends back. A comment claiming
 * that is worth nothing — `docs/leafly-menu-api-v2.md` claimed things too, and eight
 * field defects came out of it (finding L-17). So the claim is asserted here against the
 * vendored copy of Leafly's own published schema, `docs/leafly-specs/schemas/v2-show.json`,
 * which was retrieved live and is byte-identical to the download.
 *
 * The most important test in this file is the ANTI-MERGE test. The readback calls the
 * brand `brandName` and the strain `strainName` — the exact two names that caused findings
 * L-06 and L-07 and would have made Leafly reject every item with HTTP 400. They are
 * correct on the way in and fatal on the way out. If anyone ever "tidies" the two contracts
 * into one, `write and readback disagree...` fails on purpose.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  LEAFLY_READBACK_ENVELOPE_FIELDS,
  LEAFLY_READBACK_ITEM_FIELDS,
  LEAFLY_READBACK_ONLY_FIELDS,
  LEAFLY_READBACK_TO_WRITE_NAMES,
  LEAFLY_READBACK_UNVERIFIED_CORRESPONDENCES,
  LEAFLY_READBACK_VARIANT_FIELDS,
  LEAFLY_PRODUCTION_PROPAGATION_SECONDS,
  LEAFLY_RECONCILE_ISSUES_PER_CODE,
  LEAFLY_SANDBOX_PROPAGATION_SECONDS,
  __runLeaflyReadbackTests,
  assessReadbackTiming,
  describeReconcileResult,
  leaflyPropagationSeconds,
  normalizeReadbackId,
  parseLeaflyMenuReadback,
  reconcileLeaflyMenu,
} from "@/lib/leafly/readback-core";
import {
  LEAFLY_FORBIDDEN_FIELD_ALIASES,
  LEAFLY_ITEM_FIELDS,
  LEAFLY_VARIANT_FIELDS,
} from "@/lib/leafly/contract-core";
import type { LeaflyItemsPayload } from "@/lib/leafly/payload-core";

const SPEC_DIR = path.join(process.cwd(), "docs", "leafly-specs");

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(SPEC_DIR, rel), "utf8")) as Record<string, unknown>;
}

const showSchema = readJson(path.join("schemas", "v2-show.json"));
const openapi = readJson("menu-integration-v2.openapi.json");

/* eslint-disable @typescript-eslint/no-explicit-any */
const showItem = (showSchema as any).properties.result.items;
const showVariant = showItem.properties.variants.items;
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("L-4 · the readback schema is vendored and intact", () => {
  it("v2-show.json is present and parses", () => {
    expect(typeof showSchema).toBe("object");
  });

  it("the OpenAPI document really does point GET /menu at show.json", () => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const get = (openapi as any).paths["/{menu_integration_key}/menu"].get;
    expect(get.responses["200"].content["application/json"].schema.$ref).toBe(
      "schemas/v2/show.json",
    );
  });

  it("every external $ref in the OpenAPI document is now vendored", () => {
    // This is the check whose absence in L-1 let show.json go un-downloaded.
    const raw = readFileSync(path.join(SPEC_DIR, "menu-integration-v2.openapi.json"), "utf8");
    const refs = [...new Set([...raw.matchAll(/"\$ref":\s*"([^"#]+)"/g)].map((m) => m[1]))];
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      // schemas/v2/items.json  ->  schemas/v2-items.json
      const vendored = ref.replace(/^schemas\/(v\d)\//, "schemas/$1-");
      expect(() => readFileSync(path.join(SPEC_DIR, vendored), "utf8")).not.toThrow();
    }
  });

  it("GET /menu is documented as sandbox-only, returning 405 elsewhere", () => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const get = (openapi as any).paths["/{menu_integration_key}/menu"].get;
    expect(get.description).toMatch(/only permitted in the sandbox/i);
    expect(get.description).toMatch(/405/);
  });

  it("the readback endpoint has no write methods, and the write path has no GET", () => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const paths = (openapi as any).paths;
    expect(Object.keys(paths["/{menu_integration_key}/menu"])).toEqual(["get"]);
    expect(Object.keys(paths["/{menu_integration_key}/menu/items"]).sort()).toEqual([
      "delete",
      "post",
      "put",
    ]);
  });
});

describe("L-4 · our readback vocabulary matches Leafly's published schema exactly", () => {
  it("every item field we name exists in the schema", () => {
    for (const wire of Object.values(LEAFLY_READBACK_ITEM_FIELDS)) {
      expect(Object.keys(showItem.properties)).toContain(wire);
    }
  });

  it("we name every item field the schema declares — nothing quietly dropped", () => {
    const declared = Object.keys(showItem.properties).sort();
    const ours = Object.values(LEAFLY_READBACK_ITEM_FIELDS).sort();
    expect(ours).toEqual(declared);
  });

  it("every variant field we name exists in the schema", () => {
    for (const wire of Object.values(LEAFLY_READBACK_VARIANT_FIELDS)) {
      expect(Object.keys(showVariant.properties)).toContain(wire);
    }
  });

  it("we name every variant field the schema declares", () => {
    const declared = Object.keys(showVariant.properties).sort();
    const ours = Object.values(LEAFLY_READBACK_VARIANT_FIELDS).sort();
    expect(ours).toEqual(declared);
  });

  it("the envelope is { result, metadata: { totalCount } }, all required", () => {
    expect(showSchema.required).toEqual(
      expect.arrayContaining([
        LEAFLY_READBACK_ENVELOPE_FIELDS.result,
        LEAFLY_READBACK_ENVELOPE_FIELDS.metadata,
      ]),
    );
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    expect((showSchema as any).properties.metadata.required).toContain(
      LEAFLY_READBACK_ENVELOPE_FIELDS.totalCount,
    );
  });

  it("the readback declares far more required fields than the write schema does", () => {
    // Write requires 4 (id/type/name/variants); the readback requires 17. Worth knowing:
    // a missing field in a readback is Leafly deviating from its own contract, not us.
    expect(showItem.required.length).toBeGreaterThan(4);
    expect(showVariant.required.length).toBe(7);
  });
});

describe("L-4 · ANTI-MERGE — the write and readback contracts must stay separate", () => {
  it("write and readback disagree on the brand field name", () => {
    expect(LEAFLY_ITEM_FIELDS.brand).toBe("brand");
    expect(LEAFLY_READBACK_ITEM_FIELDS.brandName).toBe("brandName");
    expect(String(LEAFLY_ITEM_FIELDS.brand)).not.toBe(
      String(LEAFLY_READBACK_ITEM_FIELDS.brandName),
    );
  });

  it("write and readback disagree on the strain field name", () => {
    expect(LEAFLY_ITEM_FIELDS.strain).toBe("strain");
    expect(LEAFLY_READBACK_ITEM_FIELDS.strainName).toBe("strainName");
  });

  it("the readback spellings are EXACTLY the forbidden write aliases (L-06 / L-07)", () => {
    // This is the whole point. `brandName` and `strainName` are already recorded in
    // contract-core as forbidden write names because they caused real defects. Proving
    // they are the readback's correct names is what explains WHY the confusion happened.
    for (const [readbackName, writeName] of Object.entries(LEAFLY_READBACK_TO_WRITE_NAMES)) {
      expect(LEAFLY_FORBIDDEN_FIELD_ALIASES[readbackName]).toBe(writeName);
      expect(Object.keys(showItem.properties)).toContain(readbackName);
    }
  });

  it("the write schema does NOT contain the readback's brand/strain names", () => {
    const writeItem = readJson(path.join("schemas", "v2-items.json"));
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const writeProps = Object.keys((writeItem as any).properties.items.items.properties);
    expect(writeProps).not.toContain("brandName");
    expect(writeProps).not.toContain("strainName");
    expect(writeProps).toContain("brand");
    expect(writeProps).toContain("strain");
  });

  it("cannabinoids are nested on the way out and flat on the way back", () => {
    const writeItem = readJson(path.join("schemas", "v2-items.json"));
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const writeProps = (writeItem as any).properties.items.items.properties;
    // out: total_thc: { content, unit }
    expect(Object.keys(writeProps.total_thc.properties).sort()).toEqual(["content", "unit"]);
    // back: thcContent + thcUnit, two flat fields
    expect(Object.keys(showItem.properties)).toContain("thcContent");
    expect(Object.keys(showItem.properties)).toContain("thcUnit");
    expect(Object.keys(showItem.properties)).not.toContain("total_thc");
  });

  it("variant size is amount+unit going out and packageSize+packageUnit coming back", () => {
    expect(LEAFLY_VARIANT_FIELDS.amount).toBe("amount");
    expect(Object.keys(showVariant.properties)).not.toContain("amount");
    expect(Object.keys(showVariant.properties)).toContain("packageSize");
    expect(Object.keys(showVariant.properties)).toContain("packageUnit");
  });

  it("Leafly-owned readback fields have no write counterpart and are excluded", () => {
    const writeItem = readJson(path.join("schemas", "v2-items.json"));
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const writeProps = Object.keys((writeItem as any).properties.items.items.properties);
    for (const f of LEAFLY_READBACK_ONLY_FIELDS) {
      expect(Object.keys(showItem.properties)).toContain(f);
      expect(writeProps).not.toContain(f);
    }
  });
});

describe("L-4 · the correspondences we refuse to assert", () => {
  it("isReservable is recorded as unverified, not mapped", () => {
    const entry = LEAFLY_READBACK_UNVERIFIED_CORRESPONDENCES.find(
      (c) => c.readbackField === "isReservable",
    );
    expect(entry).toBeDefined();
    expect(entry?.suspectedWriteField).toBe("availableForPickup");
    // It must NOT appear in the asserted mapping.
    expect(LEAFLY_READBACK_TO_WRITE_NAMES.isReservable).toBeUndefined();
  });

  it('the word "reservable" genuinely appears in no other Leafly spec', () => {
    // This is the evidence behind refusing the mapping, so it is re-proven here rather
    // than trusted from a comment. If Leafly ever documents it, this test fails and the
    // mapping can be promoted from "suspected" to "asserted".
    for (const file of [
      "menu-integration-v2.openapi.json",
      "order-api-v1.openapi.json",
      path.join("schemas", "v2-items.json"),
    ]) {
      const raw = readFileSync(path.join(SPEC_DIR, file), "utf8");
      expect(raw.toLowerCase()).not.toContain("reservable");
    }
    // ...and it DOES appear in the readback schema. Both halves matter.
    const show = readFileSync(path.join(SPEC_DIR, "schemas", "v2-show.json"), "utf8");
    expect(show).toContain("isReservable");
  });

  it("packagePrice really is undocumented, which is why we will not compare prices", () => {
    expect(showVariant.properties.packagePrice.description).toBeUndefined();
    expect(showVariant.properties.packagePrice.type).toBe("integer");
    const entry = LEAFLY_READBACK_UNVERIFIED_CORRESPONDENCES.find(
      (c) => c.readbackField === "packagePrice",
    );
    expect(entry?.suspectedWriteField).toBe("price");
  });

  it("the v1→v2 price unit really did change, justifying the caution", () => {
    const v1 = readJson(path.join("schemas", "v1-items.json"));
    const v2 = readJson(path.join("schemas", "v2-items.json"));
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v1price = (v1 as any).properties.items.items.properties.variants.items.properties.price;
    const v2price = (v2 as any).properties.items.items.properties.variants.items.properties.price;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    expect(v1price.description).toMatch(/major currency unit/i);
    expect(v2price.description).toMatch(/minor currency units/i);
  });

  it("every refusal names the missing fact and a question to ask", () => {
    for (const c of LEAFLY_READBACK_UNVERIFIED_CORRESPONDENCES) {
      expect(c.missingFact.length).toBeGreaterThan(40);
      expect(c.askLeafly.trim().endsWith("?")).toBe(true);
    }
  });
});

describe("L-4 · parsing fails soft, never loudly and never falsely", () => {
  it("an HTML error page is reported as such, not as an empty menu", () => {
    const r = parseLeaflyMenuReadback("<html><body>403</body></html>");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/non-JSON/i);
  });

  it.each([
    ["null", null],
    ["a number", 42],
    ["an array", []],
    ["an empty object", {}],
  ])("%s does not parse as a menu", (_label, body) => {
    expect(parseLeaflyMenuReadback(body).ok).toBe(false);
  });

  it("never throws, whatever it is handed", () => {
    for (const junk of [undefined, Number.NaN, { result: "nope" }, { result: [null] }]) {
      expect(() => parseLeaflyMenuReadback(junk)).not.toThrow();
    }
  });

  it("numeric and string variant ids are the same variant", () => {
    expect(normalizeReadbackId(11)).toBe(normalizeReadbackId("11"));
  });

  it("a totalCount that disagrees with the payload length is flagged as truncation", () => {
    const r = parseLeaflyMenuReadback({
      result: [{ id: "A", variants: [] }],
      metadata: { totalCount: 900 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(" ")).toMatch(/truncated|paged/i);
  });
});

/** The payload we pretend to have pushed. */
const SENT: LeaflyItemsPayload = {
  items: [
    {
      id: "SKU-1",
      type: "Flower",
      name: "Blue Dream",
      brand: "Greenway",
      strain: "Blue Dream",
      imageUrl: "https://example.com/bd.jpg",
      total_thc: { content: 22.5, unit: "percent" },
      availableForPickup: true,
      variants: [
        { id: "v1", medical: false, price: 1200, amount: 3.5, unit: "g", inventoryLevel: 6 },
      ],
    },
  ],
};

/** The faithful readback of SENT. */
function faithfulReadback() {
  return parseLeaflyMenuReadback({
    result: [
      {
        id: "SKU-1",
        name: "Blue Dream",
        type: "Flower",
        brandName: "Greenway",
        strainName: "Blue Dream",
        description: null,
        imageUrl: "https://example.com/bd.jpg",
        hidden: false,
        isReservable: true,
        isStaffPick: false,
        thcContent: 22.5,
        thcUnit: "percent",
        cbdContent: null,
        cbdUnit: null,
        created: "2026-01-01T00:00:00Z",
        lastModified: "2026-01-01T00:00:00Z",
        variants: [
          {
            id: "v1",
            inventoryLevel: 6,
            medical: false,
            packagePrice: 1200,
            packageSize: 3.5,
            packageUnit: "g",
            packageWeightGrams: 3.5,
          },
        ],
      },
    ],
    metadata: { totalCount: 1 },
  });
}

describe("L-4 · reconciliation catches what an HTTP 200 cannot", () => {
  it("a faithful readback reconciles clean", () => {
    const r = reconcileLeaflyMenu(SENT, faithfulReadback());
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(r.comparedItemCount).toBe(1);
    expect(describeReconcileResult(r)).toMatch(/no differences/i);
  });

  it("an item Leafly silently never stored is an ERROR, named by product", () => {
    const empty = parseLeaflyMenuReadback({ result: [], metadata: { totalCount: 0 } });
    const r = reconcileLeaflyMenu(SENT, empty);
    expect(r.ok).toBe(false);
    expect(r.missingFromLeafly).toContain("SKU-1");
    expect(r.issues.some((i) => i.message.includes("Blue Dream"))).toBe(true);
  });

  it("a photo we sent that Leafly dropped is an ERROR (the L-10 field)", () => {
    const back = parseLeaflyMenuReadback({
      result: [
        {
          id: "SKU-1",
          name: "Blue Dream",
          brandName: "Greenway",
          strainName: "Blue Dream",
          imageUrl: null,
          thcContent: 22.5,
          thcUnit: "percent",
          cbdContent: null,
          cbdUnit: null,
          variants: [
            {
              id: "v1",
              inventoryLevel: 6,
              medical: false,
              packagePrice: 1200,
              packageSize: 3.5,
              packageUnit: "g",
              packageWeightGrams: 3.5,
            },
          ],
        },
      ],
      metadata: { totalCount: 1 },
    });
    const r = reconcileLeaflyMenu(SENT, back);
    const issue = r.issues.find((i) => i.code === "image_dropped");
    expect(issue?.severity).toBe("error");
    expect(r.ok).toBe(false);
  });

  it("a medical-flag disagreement is an ERROR and says it is a compliance matter", () => {
    const back = parseLeaflyMenuReadback({
      result: [
        {
          id: "SKU-1",
          name: "Blue Dream",
          brandName: "Greenway",
          strainName: "Blue Dream",
          imageUrl: "https://example.com/bd.jpg",
          thcContent: 22.5,
          thcUnit: "percent",
          cbdContent: null,
          cbdUnit: null,
          variants: [
            {
              id: "v1",
              inventoryLevel: 6,
              medical: true,
              packagePrice: 1200,
              packageSize: 3.5,
              packageUnit: "g",
              packageWeightGrams: 3.5,
            },
          ],
        },
      ],
      metadata: { totalCount: 1 },
    });
    const r = reconcileLeaflyMenu(SENT, back);
    const issue = r.issues.find((i) => i.code === "medical_mismatch");
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toMatch(/compliance/i);
  });

  it("Leafly's inventory cap of 10 is NOT reported as a mismatch", () => {
    // Sending 40 and reading back 10 is Leafly behaving as documented. Reporting it
    // would train the owner to ignore this report, which is worse than not having it.
    const sent: LeaflyItemsPayload = {
      items: [
        {
          ...SENT.items[0],
          variants: [
            { id: "v1", medical: false, price: 1200, amount: 3.5, unit: "g", inventoryLevel: 40 },
          ],
        },
      ],
    };
    const back = parseLeaflyMenuReadback({
      result: [
        {
          id: "SKU-1",
          name: "Blue Dream",
          brandName: "Greenway",
          strainName: "Blue Dream",
          imageUrl: "https://example.com/bd.jpg",
          thcContent: 22.5,
          thcUnit: "percent",
          cbdContent: null,
          cbdUnit: null,
          variants: [
            {
              id: "v1",
              inventoryLevel: 10,
              medical: false,
              packagePrice: 1200,
              packageSize: 3.5,
              packageUnit: "g",
              packageWeightGrams: 3.5,
            },
          ],
        },
      ],
      metadata: { totalCount: 1 },
    });
    const r = reconcileLeaflyMenu(sent, back);
    expect(r.issues.some((i) => i.code === "inventory_mismatch")).toBe(false);
  });

  it("prices are never compared, because the readback unit is undocumented", () => {
    const r = reconcileLeaflyMenu(SENT, faithfulReadback());
    expect(r.issues.some((i) => i.code.includes("price"))).toBe(false);
    expect(r.unverifiable.some((u) => u.readbackField === "packagePrice")).toBe(true);
  });

  it("pickup availability is never compared, and the reason is carried to the UI", () => {
    const r = reconcileLeaflyMenu(SENT, faithfulReadback());
    expect(r.issues.some((i) => /pickup|reservable/i.test(i.code))).toBe(false);
    expect(r.unverifiable.some((u) => u.readbackField === "isReservable")).toBe(true);
  });

  it("a clean reconcile still reports what it did not check", () => {
    // The failure mode this guards against: a report that says "all good" while
    // quietly skipping two fields reads as a clean bill of health it has not earned.
    const r = reconcileLeaflyMenu(SENT, faithfulReadback());
    expect(r.ok).toBe(true);
    expect(r.unverifiable.length).toBe(2);
  });

  it("hand-added Menu Manager items are info, not failures", () => {
    const back = parseLeaflyMenuReadback({
      result: [{ id: "MANUAL-1", name: "Added by hand", variants: [] }],
      metadata: { totalCount: 1 },
    });
    const r = reconcileLeaflyMenu({ items: [] }, back);
    expect(r.ok).toBe(true);
    expect(r.extraAtLeafly).toContain("MANUAL-1");
    expect(r.issues.find((i) => i.code === "extra_at_leafly")?.severity).toBe("info");
  });

  it("an unreadable readback NEVER reconciles clean", () => {
    // The single worst possible bug in this module would be reporting success because
    // parsing failed.
    const r = reconcileLeaflyMenu(SENT, parseLeaflyMenuReadback("<html/>"));
    expect(r.ok).toBe(false);
    expect(r.comparedItemCount).toBe(0);
    expect(r.issues.some((i) => i.code === "readback_unreadable")).toBe(true);
  });

  it("the unreadable issue is severity ERROR, or the admin report renders empty", () => {
    // ADDED BECAUSE A MUTATION SURVIVED. `ok: false` is hardcoded on this branch, so
    // downgrading the issue to "info" left every existing assertion passing -- while
    // breaking the screen. ReadbackReport derives its red banner from
    // `issues.filter(i => i.severity === "error")`, so an "info"-severity failure shows
    // a report with no errors, no warnings and nothing to fix, on a readback that could
    // not be read at all. The severity IS the user-visible contract here.
    const r = reconcileLeaflyMenu(SENT, parseLeaflyMenuReadback("<html/>"));
    const issue = r.issues.find((i) => i.code === "readback_unreadable");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
    // And the UI's own derivation must be non-empty, not merely the severity field.
    expect(r.issues.filter((i) => i.severity === "error").length).toBeGreaterThan(0);
  });

  it("every unreadable body produces an error-severity issue, not just HTML", () => {
    // Generalises the above across every fail-soft path, so a future parse branch
    // cannot be added with a softer severity.
    for (const body of ["<html/>", "", 42, null, [], { nope: true }, { result: "x" }]) {
      const r = reconcileLeaflyMenu(SENT, parseLeaflyMenuReadback(body));
      expect(r.ok).toBe(false);
      expect(r.issues.filter((i) => i.severity === "error").length).toBeGreaterThan(0);
    }
  });

  it("a 400-item disaster stays readable but keeps the true count", () => {
    const many: LeaflyItemsPayload = {
      items: Array.from({ length: 400 }, (_, i) => ({
        id: `SKU-${i}`,
        type: "Flower" as const,
        name: `Item ${i}`,
        variants: [
          { id: `v${i}`, medical: false, price: 1200, amount: 3.5, unit: "g" as const, inventoryLevel: 5 },
        ],
      })),
    };
    const empty = parseLeaflyMenuReadback({ result: [], metadata: { totalCount: 0 } });
    const r = reconcileLeaflyMenu(many, empty);
    expect(r.issues.filter((i) => i.code === "missing_from_leafly")).toHaveLength(
      LEAFLY_RECONCILE_ISSUES_PER_CODE,
    );
    expect(r.issues.some((i) => i.code === "missing_from_leafly_truncated")).toBe(true);
    expect(r.missingFromLeafly).toHaveLength(400);
  });

  it("never throws on any combination of junk", () => {
    // Typed explicitly rather than with `as const`: `as const` would freeze `items` to
    // `readonly []`, which is not the mutable shape reconcileLeaflyMenu accepts, and the
    // test would fail to compile for a reason that has nothing to do with junk input.
    const payloads: (LeaflyItemsPayload | null | undefined)[] = [
      null,
      undefined,
      { items: [] },
    ];
    for (const payload of payloads) {
      for (const body of [null, "<html/>", {}, { result: [] }]) {
        expect(() => reconcileLeaflyMenu(payload, parseLeaflyMenuReadback(body))).not.toThrow();
      }
    }
  });
});

/**
 * FINDING L-19 — the propagation window.
 *
 * The two constants in readback-core are only correct if Leafly's spec really says
 * 2.5 minutes / 5 minutes. So these tests do not trust the constants OR my reading of
 * the spec: they parse the sentence out of the vendored OpenAPI description and assert
 * the numbers agree. If Leafly republishes the spec with different figures, the vendored
 * file changes, this test fails, and somebody has to look at it.
 */
describe("L-4 · the propagation window is Leafly's number, not ours", () => {
  const description = String(
    (openapi.info as Record<string, unknown> | undefined)?.description ?? "",
  );

  it("the vendored spec really does document a latency section", () => {
    expect(description).toContain("### Latency");
    expect(description).toContain("not\ninstantaneously visible");
  });

  it("the spec says GET requests are affected, which is why this matters at all", () => {
    // If latency only affected the consumer site, reconciling immediately would be fine.
    // It explicitly names subsequent GET requests, which is what we reconcile from.
    expect(description).toContain("through subsequent\n`GET` requests");
  });

  it("the sandbox constant matches the spec's 'two and half minutes'", () => {
    expect(description).toContain("sandbox environment\nthis is likely not more than about two and half minutes");
    expect(LEAFLY_SANDBOX_PROPAGATION_SECONDS).toBe(Math.round(2.5 * 60));
  });

  it("the production constant matches the spec's 'about five minutes'", () => {
    expect(description).toContain("production\nenvironment this is likely not more than about five minutes");
    expect(LEAFLY_PRODUCTION_PROPAGATION_SECONDS).toBe(5 * 60);
  });

  it("the spec warns the interval is not a guarantee, so nothing is gated on it", () => {
    // Justifies the design: we WARN, we never suppress or block. If a future edit turns
    // this into a hard gate, this comment and test are the record of why it must not.
    expect(description).toContain("can be faster or slower depending on external factors");
  });

  it("leaflyPropagationSeconds returns the documented value per environment", () => {
    expect(leaflyPropagationSeconds("sandbox")).toBe(LEAFLY_SANDBOX_PROPAGATION_SECONDS);
    expect(leaflyPropagationSeconds("production")).toBe(LEAFLY_PRODUCTION_PROPAGATION_SECONDS);
  });

  it("a comparison inside the window is flagged as possibly premature", () => {
    const now = new Date("2026-03-01T10:00:00.000Z");
    const pushedAt = new Date(now.getTime() - 30_000).toISOString();
    const v = assessReadbackTiming(pushedAt, now, "sandbox");
    expect(v.tooSoon).toBe(true);
    expect(v.secondsSincePush).toBe(30);
    expect(v.secondsToWait).toBe(120);
  });

  it("a comparison after the window is trusted", () => {
    const now = new Date("2026-03-01T10:00:00.000Z");
    const pushedAt = new Date(now.getTime() - 10 * 60_000).toISOString();
    expect(assessReadbackTiming(pushedAt, now, "sandbox").tooSoon).toBe(false);
  });

  it("fails SAFE: unknown timing is never reported as premature", () => {
    // The expensive mistake is dismissing a real defect as latency. Unknown timing must
    // therefore never produce `tooSoon: true`.
    const now = new Date("2026-03-01T10:00:00.000Z");
    for (const bad of [null, "", "yesterday", "not a date"]) {
      const v = assessReadbackTiming(bad as string | null, now, "sandbox");
      expect(v.tooSoon).toBe(false);
      expect(v.message.length).toBeGreaterThan(20);
    }
  });

  it("a push timestamped in the future is reported, not silently clamped", () => {
    const now = new Date("2026-03-01T10:00:00.000Z");
    const future = new Date(now.getTime() + 5 * 60_000).toISOString();
    const v = assessReadbackTiming(future, now, "sandbox");
    expect(v.tooSoon).toBe(false);
    expect(v.message.toLowerCase()).toContain("clock");
  });

  it("the same elapsed time can be settled in sandbox but premature in production", () => {
    // Proves the environment argument is load-bearing rather than decorative.
    const now = new Date("2026-03-01T10:00:00.000Z");
    const pushedAt = new Date(now.getTime() - 200_000).toISOString();
    expect(assessReadbackTiming(pushedAt, now, "sandbox").tooSoon).toBe(false);
    expect(assessReadbackTiming(pushedAt, now, "production").tooSoon).toBe(true);
  });

  it("being inside the window never hides a real difference", () => {
    // The whole design decision in one test: a premature comparison is LABELLED, not
    // suppressed. A missing item is still reported as missing.
    const sent = {
      items: [
        {
          id: "SKU-1",
          name: "Blue Dream",
          brand: "Greenway",
          category: "Flower" as const,
          strain: null,
          description: "Plain text.",
          variants: [
            {
              id: "v1",
              medical: false,
              price: 1200,
              amount: 3.5,
              unit: "g" as const,
              inventoryLevel: 5,
            },
          ],
        },
      ],
    } as unknown as LeaflyItemsPayload;
    const readback = parseLeaflyMenuReadback({ result: [], metadata: { totalCount: 0 } });
    const r = reconcileLeaflyMenu(sent, readback);
    expect(r.missingFromLeafly).toContain("SKU-1");
    expect(r.ok).toBe(false);
  });
});

describe("L-4 · the pure self-tests are wired in", () => {
  it("readback-core self-tests all pass", () => {
    const r = __runLeaflyReadbackTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(82);
  });
});
