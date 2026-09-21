/**
 * TASK J, ask 7 -- the blanket fix for the 124 variant-collision errors.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * Earlier work in this task DIAGNOSED the collision (finding J-1: labels are
 * clean; `variantAmountAndUnit()` reads the weight and then discards it when
 * the Leafly type forbids `g`, falling back to `1 each`) and DESCRIBED a
 * remedy. Nothing performed one. `planRemedies()` had no apply path anywhere
 * in the tree, so every one of the owner's 124 errors was still live.
 *
 * Two pure cores now close that gap, and this file pins both plus the server
 * bridge that joins them to a real payload:
 *
 *   stage 1  collision-apply-core.ts   correct `amount`/`unit` in place
 *   stage 2  collision-split-core.ts   list one product as several products
 *
 * THE FOUR ASSUMPTIONS THAT WERE TESTED RATHER THAN TRUSTED
 * ---------------------------------------------------------
 * The first draft of the server bridge paired source variants to built
 * variants BY POSITION, justified by a comment asserting that (a) the built
 * variant id is a re-derived hash and so cannot be used as a key, and (b)
 * `toLeaflyItem` preserves variant order. Both claims were false:
 *
 *   (a) `toLeaflyVariant()` emits `id: String(v.id)` -- the source id, copied
 *       verbatim. The `${itemId}-${stableId(...)}` shape is minted far
 *       upstream in `toMenuItem()` (pos/transform.ts) and travels through
 *       unchanged. A direct id lookup HITS.
 *   (b) `variantsFor()` drops variants in two places -- the low-stock
 *       withhold rule, and an unreadable weight on a weight-only type. Either
 *       drop shifts every later index.
 *
 * Measured consequence: for a Flower item labelled ["1g", "MYSTERY BAG",
 * "5g"], the middle variant is rejected and positional pairing then reports
 * the surviving 5g variant's label as "MYSTERY BAG" -- a wrong weight written
 * onto cannabis. The tests below pin the true behaviour so the wrong
 * assumption cannot be reintroduced.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyCollisionRepairs,
  parseSizeFromLabel,
  collidingVariantIds,
  APPLY_UNITS_BY_TYPE,
  __runLeaflyCollisionApplyTests,
  type ApplyItem,
} from "@/lib/leafly/collision-apply-core";
import {
  applyCollisionSplits,
  splitCollidingVariantIds,
  splitItemId,
  splitItemName,
  labelSlug,
  describeSplitResult,
  __runLeaflyCollisionSplitTests,
  type SplitItem,
} from "@/lib/leafly/collision-split-core";
import { LEAFLY_TYPE_UNIT_MATRIX } from "@/lib/leafly/contract-core";
import { toLeaflyItem, variantsFor, type LeaflyItem } from "@/lib/leafly/payload-core";
import { validateLeaflyPayload } from "@/lib/leafly/payload-validate-core";
import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";

const SRC = (p: string) => readFileSync(join(process.cwd(), "src", p), "utf8");

/* -------------------------------------------------------------------------- */
/* Embedded self-tests actually run                                           */
/* -------------------------------------------------------------------------- */

describe("pure cores self-test", () => {
  it("collision-apply-core passes its own suite", () => {
    const r = __runLeaflyCollisionApplyTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(66);
  });

  it("collision-split-core passes its own suite", () => {
    const r = __runLeaflyCollisionSplitTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(60);
  });

  it("both cores are registered in the pure self-test runner", () => {
    const runner = readFileSync(
      join(process.cwd(), "scripts", "compliance", "run-pure-selftests.ts"),
      "utf8",
    );
    expect(runner).toContain("leafly-collision-apply-core");
    expect(runner).toContain("leafly-collision-split-core");
  });
});

/* -------------------------------------------------------------------------- */
/* Drift guard against the authoritative unit matrix                          */
/* -------------------------------------------------------------------------- */

describe("the mirrored unit table cannot drift from the contract", () => {
  it("APPLY_UNITS_BY_TYPE matches LEAFLY_TYPE_UNIT_MATRIX exactly", () => {
    const contract = Object.fromEntries(
      Object.entries(LEAFLY_TYPE_UNIT_MATRIX).map(([t, v]) => [t, [...v.variantUnits]]),
    );
    const mirrored = Object.fromEntries(
      Object.entries(APPLY_UNITS_BY_TYPE).map(([t, v]) => [t, [...v]]),
    );
    expect(mirrored).toEqual(contract);
  });

  it("covers every funnel type -- no type silently defaults", () => {
    for (const t of Object.keys(LEAFLY_TYPE_UNIT_MATRIX)) {
      expect(APPLY_UNITS_BY_TYPE[t], `missing type ${t}`).toBeDefined();
    }
  });

  it("matches the published Leafly schema, not just our own copy of it", () => {
    const schema = JSON.parse(
      readFileSync(join(process.cwd(), "docs", "leafly-specs", "schemas", "v2-items.json"), "utf8"),
    );
    const desc: string =
      schema.properties.items.items.properties.variants.items.properties.unit.description;
    // The spec states the matrix as a markdown table. Parse it rather than
    // trusting a transcription.
    for (const [type, units] of Object.entries(APPLY_UNITS_BY_TYPE)) {
      const row = desc.split("\n").find((l: string) => l.trim().startsWith(`| ${type}`));
      expect(row, `no spec row for ${type}`).toBeTruthy();
      for (const u of units) expect(row).toContain(`\`${u}\``);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The join key -- the assumption that was wrong                              */
/* -------------------------------------------------------------------------- */

const baseItem: SyndicationItem = {
  id: "pos-join",
  name: "Join Test",
  brand: "Greenway",
  category: "flower",
  strainType: "hybrid",
  strainName: null,
  thc: null,
  cbd: null,
  description: "d",
  priceMinorUnits: 1200,
  inStock: true,
  variants: [],
};

describe("the source->built variant join key", () => {
  it("the built variant id IS the source variant id (so join by id)", () => {
    const item: SyndicationItem = {
      ...baseItem,
      variants: [
        { id: "pos-join-cca24072824d", label: "1g", priceMinorUnits: 1200, inStock: true, inventoryLevel: 5 },
        { id: "pos-join-00de6c9e8f2c", label: "3g", priceMinorUnits: 3300, inStock: true, inventoryLevel: 4 },
      ],
    };
    const built = toLeaflyItem(item);
    expect(built?.variants.map((v) => v.id)).toEqual(item.variants.map((v) => v.id));
  });

  it("variantsFor CAN drop a variant, so position is not a safe key", () => {
    const item: SyndicationItem = {
      ...baseItem,
      id: "pos-drop",
      variants: [
        { id: "v-a", label: "1g", priceMinorUnits: 1200, inStock: true, inventoryLevel: 5 },
        { id: "v-b", label: "MYSTERY BAG", priceMinorUnits: 2000, inStock: true, inventoryLevel: 5 },
        { id: "v-c", label: "5g", priceMinorUnits: 4500, inStock: true, inventoryLevel: 5 },
      ],
    };
    const res = variantsFor(item);
    expect(res.rejected.map((r) => r.variantId)).toEqual(["v-b"]);
    expect(res.variants.map((v) => v.id)).toEqual(["v-a", "v-c"]);
  });

  it("positional pairing would mislabel a surviving size (the measured harm)", () => {
    const item: SyndicationItem = {
      ...baseItem,
      id: "pos-harm",
      variants: [
        { id: "v-a", label: "1g", priceMinorUnits: 1200, inStock: true, inventoryLevel: 5 },
        { id: "v-b", label: "MYSTERY BAG", priceMinorUnits: 2000, inStock: true, inventoryLevel: 5 },
        { id: "v-c", label: "5g", priceMinorUnits: 4500, inStock: true, inventoryLevel: 5 },
      ],
    };
    const kept = variantsFor(item).variants;
    const byPosition = kept.map((_, i) => item.variants[i]?.label);
    const byId = kept.map((v) => item.variants.find((s) => s.id === v.id)?.label);

    expect(byPosition).toEqual(["1g", "MYSTERY BAG"]); // wrong
    expect(byId).toEqual(["1g", "5g"]); // right
    expect(byPosition).not.toEqual(byId);
  });

  it("the low-stock rule can also drop a variant", () => {
    const item: SyndicationItem = {
      ...baseItem,
      id: "pos-withheld",
      variants: [
        { id: "w-a", label: "1g", priceMinorUnits: 1200, inStock: true, inventoryLevel: 1 },
        { id: "w-b", label: "5g", priceMinorUnits: 4500, inStock: true, inventoryLevel: 50 },
      ],
    };
    const res = variantsFor(item, {
      visibility: { mode: "withhold", minimumStock: 3, perCategory: {} },
    });
    expect(res.withheld.map((w) => w.variantId)).toEqual(["w-a"]);
    expect(res.variants.map((v) => v.id)).toEqual(["w-b"]);
  });

  it("the synthesized default variant has no source row (a legitimate miss)", () => {
    const res = variantsFor({ ...baseItem, id: "pos-synth", category: "edible-solid", variants: [] });
    expect(res.variants[0]?.id).toBe("pos-synth-default");
  });

  it("the server bridge joins by id and has NO positional fallback", () => {
    const src = SRC("lib/leafly/collision-apply-server.ts");
    expect(src).toContain("labelByVariantId.get(v.id)");
    // The discredited approach must not come back.
    expect(src).not.toMatch(/src\?\.variants\?\.\[i\]/);
    expect(src).not.toMatch(/positional\s*\?\?/);
    expect(src).toMatch(/JOIN BY ID ONLY/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Stage 1 behaviour                                                          */
/* -------------------------------------------------------------------------- */

const av = (o: Partial<ApplyItem["variants"][number]> & { id: string }) => ({
  amount: 1,
  unit: "each",
  price: 1000,
  medical: false,
  inventoryLevel: 5,
  ...o,
});

describe("stage 1 -- correcting amount/unit in place", () => {
  it("restores the real weight when the type allows a weight", () => {
    const item: ApplyItem = {
      id: "i1",
      type: "Flower",
      name: "Bud",
      variants: [
        av({ id: "a", label: "1g", unit: "g" }),
        av({ id: "b", label: "3.5g", unit: "g" }),
      ],
    };
    const r = applyCollisionRepairs([item]);
    expect(r.clean).toBe(true);
    expect(r.items[0].variants.map((v) => `${v.amount}${v.unit}`)).toEqual(["1g", "3.5g"]);
  });

  it("uses distinct pack counts on an each-only type", () => {
    const item: ApplyItem = {
      id: "i2",
      type: "PreRoll",
      name: "Pack",
      variants: [av({ id: "a", label: "2pk" }), av({ id: "b", label: "10pk" })],
    };
    const r = applyCollisionRepairs([item]);
    expect(r.clean).toBe(true);
    expect(r.items[0].variants.map((v) => v.amount)).toEqual([2, 10]);
    expect(r.items[0].variants.every((v) => v.unit === "each")).toBe(true);
  });

  it("REFUSES weights on an each-only type rather than inventing a count", () => {
    const item: ApplyItem = {
      id: "i3",
      type: "PreRoll",
      name: "Roll",
      variants: [av({ id: "a", label: "1g" }), av({ id: "b", label: "3g" })],
    };
    const r = applyCollisionRepairs([item]);
    expect(r.clean).toBe(false);
    expect(r.unrepaired).toHaveLength(1);
    expect(r.unrepaired[0].reason).toMatch(/weight rather than a pack count/i);
    // Nothing was changed.
    expect(r.items[0].variants.map((v) => v.amount)).toEqual([1, 1]);
  });

  it("never invents a size from a blank label", () => {
    const item: ApplyItem = {
      id: "i4",
      type: "Topical",
      name: "Salve",
      variants: [av({ id: "a", label: "" }), av({ id: "b", label: "" })],
    };
    const r = applyCollisionRepairs([item]);
    expect(r.clean).toBe(false);
    expect(r.unrepaired[0].reason).toMatch(/no size label/i);
  });

  it("mg is NOT silently converted to grams", () => {
    expect(parseSizeFromLabel("100mg")).not.toMatchObject({ unit: "g" });
  });

  it("leaves a non-colliding item byte-identical", () => {
    const item: ApplyItem = {
      id: "i5",
      type: "Flower",
      name: "Fine",
      variants: [av({ id: "a", amount: 1, unit: "g" }), av({ id: "b", amount: 3.5, unit: "g" })],
    };
    expect(collidingVariantIds(item.variants)).toEqual([]);
    expect(applyCollisionRepairs([item]).items[0]).toBe(item);
  });
});

/* -------------------------------------------------------------------------- */
/* Stage 2 behaviour                                                          */
/* -------------------------------------------------------------------------- */

describe("stage 2 -- splitting into separate products", () => {
  const owner: SplitItem = {
    id: "pos-45c6e282e0e8",
    type: "PreRoll",
    name: "House Pre-Roll",
    variants: [
      { id: "pos-45c6e282e0e8-cca24072824d", amount: 1, unit: "each", label: "1g", price: 1200, medical: true, inventoryLevel: 5 },
      { id: "pos-45c6e282e0e8-00de6c9e8f2c", amount: 1, unit: "each", label: "3g", price: 3300, medical: true, inventoryLevel: 4 },
    ],
  };

  it("resolves the owner's real reported collision", () => {
    const r = applyCollisionSplits([owner]);
    expect(r.clean).toBe(true);
    expect(r.items).toHaveLength(2);
    expect(r.items.map((i) => i.name)).toEqual(["House Pre-Roll - 1g", "House Pre-Roll - 3g"]);
  });

  it("preserves the variant id, which is what order integration keys on", () => {
    // Leafly spec, variant.id: "Takes precedence over top-level id for order
    // integration purposes". If the split changed it, orders would break.
    const r = applyCollisionSplits([owner]);
    expect(r.items.flatMap((i) => i.variants.map((v) => v.id))).toEqual(
      owner.variants.map((v) => v.id),
    );
  });

  it("preserves price, stock, medical flag, amount and unit", () => {
    const r = applyCollisionSplits([owner]);
    const out = r.items.flatMap((i) => i.variants);
    for (const o of out) {
      const src = owner.variants.find((v) => v.id === o.id);
      expect(o.price).toBe(src?.price);
      expect(o.inventoryLevel).toBe(src?.inventoryLevel);
      expect(o.medical).toBe(src?.medical);
      expect(o.amount).toBe(src?.amount);
      expect(o.unit).toBe(src?.unit);
    }
  });

  it("produces stable ids -- the same input gives the same ids every push", () => {
    expect(splitItemId("p", "3.5g")).toBe(splitItemId("p", "3.5g"));
    expect(applyCollisionSplits([owner]).items.map((i) => i.id)).toEqual(
      applyCollisionSplits([owner]).items.map((i) => i.id),
    );
  });

  it("refuses rather than creating two products with the same name", () => {
    const dup: SplitItem = {
      id: "p",
      type: "Edible",
      name: "Gummies",
      variants: [
        { id: "a", amount: 1, unit: "each", label: "10pk", medical: false },
        { id: "b", amount: 1, unit: "each", label: "10pk", medical: false },
      ],
    };
    const r = applyCollisionSplits([dup]);
    expect(r.splitItemCount).toBe(0);
    expect(r.refusals[0].reason).toMatch(/same label/i);
  });

  it("refuses when derived ids would clash (S3)", () => {
    expect(labelSlug("1 g")).toBe(labelSlug("1-g"));
    const punct: SplitItem = {
      id: "p",
      type: "PreRoll",
      name: "Roll",
      variants: [
        { id: "a", amount: 1, unit: "each", label: "1 g", medical: false },
        { id: "b", amount: 1, unit: "each", label: "1-g", medical: false },
      ],
    };
    expect(applyCollisionSplits([punct]).refusals[0].reason).toMatch(/duplicate product id/i);
  });

  it("never shadows an item id already present in the menu", () => {
    const parent: SplitItem = {
      id: "p5",
      type: "PreRoll",
      name: "Roll",
      variants: [
        { id: "a", amount: 1, unit: "each", label: "1g", medical: false },
        { id: "b", amount: 1, unit: "each", label: "3g", medical: false },
      ],
    };
    const existing: SplitItem = {
      id: "p5--1g",
      type: "PreRoll",
      name: "Already here",
      variants: [{ id: "z", amount: 9, unit: "each", medical: false }],
    };
    const r = applyCollisionSplits([parent, existing]);
    expect(r.refusals).toHaveLength(1);
    expect(r.items.find((i) => i.id === "p5--1g")?.name).toBe("Already here");
  });

  it("does not split a product that has no collision", () => {
    const fine: SplitItem = {
      id: "f",
      type: "Flower",
      name: "Bud",
      variants: [
        { id: "a", amount: 1, unit: "g", medical: false },
        { id: "b", amount: 3.5, unit: "g", medical: false },
      ],
    };
    const r = applyCollisionSplits([fine]);
    expect(r.splitItemCount).toBe(0);
    expect(r.items[0]).toBe(fine);
    expect(describeSplitResult(r)).toBe("No products needed splitting.");
  });

  it("does not duplicate a size the name already ends with", () => {
    expect(splitItemName("Blue Dream 1g", "1g")).toBe("Blue Dream 1g");
  });

  it("treats medical and adult of the same size as distinct (not a collision)", () => {
    expect(
      splitCollidingVariantIds([
        { id: "a", amount: 1, unit: "each", medical: true },
        { id: "b", amount: 1, unit: "each", medical: false },
      ]),
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* End to end, through the real builder and the real validator                */
/* -------------------------------------------------------------------------- */

describe("end to end: the blanket fix clears the collision class", () => {
  // Real category slugs from CATEGORY_TO_LEAFLY_TYPE. Inventing slugs here
  // would send everything to the `Other` default and silently test one type
  // ten times, which an earlier draft of this suite did.
  const CATEGORIES = [
    "edible-solid", "preroll", "preroll-pack", "topical", "paraphernalia",
    "flower", "concentrate", "cartridge", "tincture", "rso",
  ];
  const WEIGHTS = ["1g", "3g", "5g"];
  const COUNTS = ["2pk", "5pk", "10pk"];

  const source: SyndicationItem[] = [];
  for (const cat of CATEGORIES) {
    for (let n = 0; n < 4; n++) {
      const id = `pos-${cat}-${n}`;
      source.push({
        ...baseItem,
        id,
        name: `${cat} product ${n}`,
        category: cat,
        variants: (n % 2 === 0 ? WEIGHTS : COUNTS).map((label, k) => ({
          id: `${id}-v${k}`,
          label,
          priceMinorUnits: 1200 + k * 1100,
          inStock: true,
          inventoryLevel: 9 - k,
        })),
      });
    }
  }

  const built = source
    .map((s) => toLeaflyItem(s))
    .filter((i): i is LeaflyItem => i !== null);

  const labelByVid = new Map<string, string>();
  for (const s of source) for (const v of s.variants) labelByVid.set(v.id, v.label);

  const countCollisions = (items: LeaflyItem[]) => {
    const res = validateLeaflyPayload({ items });
    const all = [...(res.errors ?? []), ...(res.warnings ?? [])] as Array<{ code: string }>;
    return all.filter((e) => e.code === "variant_size_indistinguishable").length;
  };
  const codeCounts = (items: LeaflyItem[]) => {
    const res = validateLeaflyPayload({ items });
    const all = [...(res.errors ?? []), ...(res.warnings ?? [])] as Array<{ code: string }>;
    const m = new Map<string, number>();
    for (const e of all) m.set(e.code, (m.get(e.code) ?? 0) + 1);
    return m;
  };

  // stage 1
  const withLabels: ApplyItem[] = built.map((i) => ({
    id: i.id,
    type: i.type,
    name: i.name,
    variants: i.variants.map((v) => ({
      id: v.id, amount: v.amount, unit: v.unit,
      label: labelByVid.get(v.id) ?? null,
      price: v.price, medical: v.medical, inventoryLevel: v.inventoryLevel,
    })),
  }));
  const s1 = applyCollisionRepairs(withLabels);
  const afterS1: LeaflyItem[] = built.map((item) => {
    const fixed = s1.items.find((x) => x.id === item.id);
    if (!fixed) return item;
    const byId = new Map(fixed.variants.map((v) => [v.id, v]));
    return {
      ...item,
      variants: item.variants.map((v) => {
        const f = byId.get(v.id);
        if (!f || (f.amount === v.amount && f.unit === v.unit)) return v;
        return { ...v, amount: f.amount, unit: f.unit as typeof v.unit };
      }),
    };
  });

  // stage 2
  const s2 = applyCollisionSplits(
    afterS1.map((i) => ({
      id: i.id, type: i.type, name: i.name,
      variants: i.variants.map((v) => ({
        id: v.id, amount: v.amount, unit: v.unit,
        label: labelByVid.get(v.id) ?? null,
        price: v.price, medical: v.medical, inventoryLevel: v.inventoryLevel,
      })),
    })),
  );
  const parentByVid = new Map<string, LeaflyItem>();
  for (const i of afterS1) for (const v of i.variants) parentByVid.set(v.id, i);
  const final: LeaflyItem[] = s2.items.map((s) => {
    const parent = parentByVid.get(s.variants[0].id)!;
    const keep = new Set(s.variants.map((v) => v.id));
    return { ...parent, id: s.id, name: s.name, variants: parent.variants.filter((v) => keep.has(v.id)) };
  });

  it("the defect reproduces on a realistic menu", () => {
    expect(countCollisions(built)).toBeGreaterThan(0);
  });

  it("stage 1 reduces the collisions but is honest about the rest", () => {
    expect(countCollisions(afterS1)).toBeLessThan(countCollisions(built));
    expect(s1.unrepaired.length).toBeGreaterThan(0);
    expect(s1.unrepaired.every((u) => (u.reason ?? "").trim().length > 0)).toBe(true);
  });

  it("stage 1 + stage 2 drive the collision class to ZERO", () => {
    expect(countCollisions(final)).toBe(0);
    expect(s2.clean).toBe(true);
  });

  it("no new violation of ANY other code is introduced", () => {
    const b = codeCounts(built);
    const a = codeCounts(final);
    const worse: string[] = [];
    for (const [code, n] of a) if (n > (b.get(code) ?? 0)) worse.push(`${code}: ${b.get(code) ?? 0} -> ${n}`);
    expect(worse).toEqual([]);
  });

  it("every variant survives exactly once -- nothing dropped or duplicated", () => {
    const before = built.flatMap((i) => i.variants.map((v) => v.id)).sort();
    const after = final.flatMap((i) => i.variants.map((v) => v.id)).sort();
    expect(after).toEqual(before);
  });

  it("no price, stock or variant id was changed anywhere", () => {
    const srcById = new Map(built.flatMap((i) => i.variants.map((v) => [v.id, v] as const)));
    for (const v of final.flatMap((i) => i.variants)) {
      const o = srcById.get(v.id)!;
      expect(v.price).toBe(o.price);
      expect(v.inventoryLevel).toBe(o.inventoryLevel);
      expect(v.medical).toBe(o.medical);
    }
  });

  it("every emitted unit is still lawful for its funnel type", () => {
    for (const i of final) {
      const legal = LEAFLY_TYPE_UNIT_MATRIX[i.type as keyof typeof LEAFLY_TYPE_UNIT_MATRIX];
      expect(legal, `unknown type ${i.type}`).toBeDefined();
      for (const v of i.variants) {
        expect(legal.variantUnits as readonly string[]).toContain(v.unit);
      }
    }
  });

  it("all item ids in the final payload are unique", () => {
    expect(new Set(final.map((i) => i.id)).size).toBe(final.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Wiring -- a core with no caller does not exist                             */
/* -------------------------------------------------------------------------- */

describe("the apply path is reachable, not merely implemented", () => {
  it("the server bridge runs stage 1 BEFORE stage 2", () => {
    const src = SRC("lib/leafly/collision-apply-server.ts");
    const s1 = src.indexOf("repairBuiltPayload(built, source)");
    const s2 = src.indexOf("applyCollisionSplits(asSplit)");
    expect(s1).toBeGreaterThan(-1);
    expect(s2).toBeGreaterThan(-1);
    expect(s1).toBeLessThan(s2);
  });

  it("the bridge explains why that order is the correct one", () => {
    expect(SRC("lib/leafly/collision-apply-server.ts")).toMatch(/WHY REPAIR BEFORE SPLIT/i);
  });

  it("the bridge never writes a non-v2 field onto the wire", () => {
    // v2 removed `variant.label` (finding L-03). Rather than grep for the
    // absence of a string -- which an earlier draft of this test did with a
    // regex that could never fail -- RUN the join and inspect the output.
    const src: SyndicationItem[] = [
      {
        ...baseItem,
        id: "wire-1",
        category: "preroll",
        variants: [
          { id: "wire-1-a", label: "1g", priceMinorUnits: 1200, inStock: true, inventoryLevel: 5 },
          { id: "wire-1-b", label: "3g", priceMinorUnits: 3300, inStock: true, inventoryLevel: 4 },
        ],
      },
    ];
    const items = src.map((s) => toLeaflyItem(s)).filter((i): i is LeaflyItem => i !== null);
    const labels = new Map(src.flatMap((s) => s.variants.map((v) => [v.id, v.label] as const)));

    const s2 = applyCollisionSplits(
      items.map((i) => ({
        id: i.id, type: i.type, name: i.name,
        variants: i.variants.map((v) => ({
          id: v.id, amount: v.amount, unit: v.unit,
          label: labels.get(v.id) ?? null,
          price: v.price, medical: v.medical, inventoryLevel: v.inventoryLevel,
        })),
      })),
    );
    // The bridge rebuilds from the ORIGINAL item, so reproduce that here and
    // assert the emitted variant carries EXACTLY the six v2 fields.
    const parentByVid = new Map<string, LeaflyItem>();
    for (const i of items) for (const v of i.variants) parentByVid.set(v.id, i);
    const wire = s2.items.map((s) => {
      const parent = parentByVid.get(s.variants[0].id)!;
      const keep = new Set(s.variants.map((v) => v.id));
      return { ...parent, id: s.id, name: s.name, variants: parent.variants.filter((v) => keep.has(v.id)) };
    });

    expect(wire.length).toBe(2);
    for (const v of wire.flatMap((i) => i.variants)) {
      expect(Object.keys(v).sort()).toEqual(
        ["amount", "id", "inventoryLevel", "medical", "price", "unit"],
      );
      expect("label" in v).toBe(false);
    }
    // And the bridge really does rebuild from the parent.
    expect(SRC("lib/leafly/collision-apply-server.ts")).toContain("...parent");
  });

  it("neither core imports anything impure", () => {
    for (const f of ["lib/leafly/collision-apply-core.ts", "lib/leafly/collision-split-core.ts"]) {
      const src = SRC(f);
      expect(src).not.toContain('from "server-only"');
      expect(src).not.toContain("require(");
      expect(src).not.toMatch(/^import .*(react|next\/|@supabase)/m);
    }
  });

  it("neither core uses Math.random -- ids must be stable between pushes", () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const f of ["lib/leafly/collision-apply-core.ts", "lib/leafly/collision-split-core.ts"]) {
      expect(strip(SRC(f))).not.toContain("Math.random");
    }
  });
});
