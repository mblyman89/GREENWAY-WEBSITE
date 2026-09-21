/**
 * FINDING L-21 — sizes Leafly cannot tell apart.
 *
 * THE FAILURE THIS FILE EXISTS FOR
 *
 * The owner pushed 8 products to Leafly. All 8 were accepted. The read-back
 * then reported four errors of the form:
 *
 *   Size/variant "pos-406a50c84648-b8c643bfe6ae" of "Ceres Dragon Balm CBD RED"
 *   is missing from Leafly's menu.
 *
 * The read-back was correct — those variant ids really were absent from Leafly's
 * copy. Nothing failed in transit. Leafly describes a variant's size with
 * exactly one pair of fields, `amount` and `unit`, and two variants of one item
 * carrying the same pair are the same size described twice. Leafly keeps one.
 *
 * Every function involved behaves exactly as documented. `variantAmountAndUnit`
 * maps every variant of a counted type to `1 each` because Leafly permits no
 * other unit for those types. That is correct. It is the COMBINATION with a
 * multi-size product that loses data — the same shape as the read-back scope
 * defect, and invisible until the day a topical with two sizes gets pushed.
 *
 * WHAT IS ASSERTED HERE
 *
 * 1. The identity rule itself, including that price and id are NOT part of it.
 * 2. That the validator refuses a payload carrying an indistinguishable pair.
 * 3. That the read-back EXPLAINS such a variant, and refuses to invent an
 *    explanation when it cannot prove one.
 * 4. That the picker's size columns and warning are wired to the real mapper.
 * 5. Negative controls throughout — a correct menu must stay silent.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  __runLeaflyVariantIdentityTests,
  assessItemVariantIdentity,
  assessPayloadVariantIdentity,
  describeItemVariantIdentity,
  describePayloadVariantIdentity,
  explainMissingVariant,
  findVariantCollisions,
  variantSizeKey,
} from "@/lib/leafly/variant-identity-core";
import {
  toLeaflyType,
  variantAmountAndUnit,
  variantsFor,
} from "@/lib/leafly/payload-core";
import { validateLeaflyPayload } from "@/lib/leafly/payload-validate-core";
import {
  parseLeaflyMenuReadback,
  reconcileLeaflyMenu,
} from "@/lib/leafly/readback-core";
import type { LeaflyItemsPayload } from "@/lib/leafly/payload-core";
import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";
import {
  describeSizeLoss,
  summarizeSizeLoss,
} from "@/lib/leafly/picker-view-core";

const ROOT = join(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * Strip comments so a prose mention of an identifier cannot satisfy a wiring
 * assertion. Every guard in this file that claims "the code does X" runs on
 * this, never on the raw text — otherwise the long explanatory comments in
 * these modules would make the guards pass on their own.
 */
function readCode(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Extract a single brace-balanced block starting at `marker`, so a guard about
 * one function cannot be satisfied by an identical line in the next function
 * down. Searching to end-of-file is how an earlier mutation run produced eight
 * false survivors.
 */
function block(src: string, marker: string): string {
  const start = src.indexOf(marker);
  if (start === -1) return "";
  const open = src.indexOf("{", start);
  if (open === -1) return src.slice(start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

/** Build a source item the real mapper accepts. */
/**
 * Build a real `SyndicationItem`. Typed deliberately -- an `as never` cast here
 * would let the fixture drift out of shape with the production type and the
 * tests would keep passing while testing something that can no longer occur.
 */
function srcItem(
  id: string,
  name: string,
  category: string,
  // `label` is a non-nullable string on SyndicationVariant, so the fixture
  // takes the same. Widening it here would let the tests exercise a shape the
  // production type forbids.
  labels: string[],
): SyndicationItem {
  return {
    id,
    name,
    brand: null,
    category,
    strainType: "unknown",
    strainName: null,
    thc: null,
    cbd: null,
    description: "",
    priceMinorUnits: 1000,
    inStock: true,
    variants: labels.map((label, i) => ({
      id: `${id}-v${i}`,
      label,
      priceMinorUnits: 1000 + i * 500,
      inStock: true,
      inventoryLevel: 5,
    })),
  };
}

describe("the identity rule", () => {
  it("runs its own self-tests with a real floor", () => {
    const r = __runLeaflyVariantIdentityTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(68);
  });

  it("treats the same amount and unit as one size", () => {
    expect(variantSizeKey({ amount: 1, unit: "each" })).toBe(
      variantSizeKey({ amount: 1, unit: "each" }),
    );
  });

  it("treats different amounts as different sizes", () => {
    expect(variantSizeKey({ amount: 3.5, unit: "g" })).not.toBe(
      variantSizeKey({ amount: 7, unit: "g" }),
    );
  });

  it("does not let price distinguish two sizes, because Leafly does not", () => {
    // Two variants at different prices, same amount+unit. If price were part of
    // identity we would predict "distinct" and Leafly would still collapse them,
    // so our warning would be silent on a real loss.
    const collisions = findVariantCollisions([
      { id: "cheap", amount: 1, unit: "each" },
      { id: "expensive", amount: 1, unit: "each" },
    ]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].variantIds).toEqual(["cheap", "expensive"]);
  });

  it("never reports the same size on two different items as a collision", () => {
    // A menu where most products have a 1g would otherwise light up entirely.
    const p = assessPayloadVariantIdentity([
      { id: "i1", name: "A", variants: [{ id: "a", amount: 1, unit: "each" }] },
      { id: "i2", name: "B", variants: [{ id: "b", amount: 1, unit: "each" }] },
    ]);
    expect(p.affected).toHaveLength(0);
    expect(describePayloadVariantIdentity(p)).toBeNull();
  });

  it("stays silent on a correct item (negative control)", () => {
    const a = assessItemVariantIdentity({
      itemId: "i",
      itemName: "Khush Kush",
      variants: [
        { id: "v1", amount: 3.5, unit: "g" },
        { id: "v2", amount: 7, unit: "g" },
        { id: "v3", amount: 14, unit: "g" },
      ],
    });
    expect(a.lostCount).toBe(0);
    expect(describeItemVariantIdentity(a)).toBeNull();
  });
});

describe("the mechanism, through the real mapper", () => {
  it("collapses two counted-type sizes to one, which is the owner's case", () => {
    // A topical with two sizes. Leafly allows only `each` for Topical, so both
    // variants map to the identical descriptor.
    const built = variantsFor(srcItem("t1", "Ceres Dragon Balm", "topical", ["1oz", "2oz"]));
    expect(built.variants).toHaveLength(2);
    const keys = new Set(built.variants.map((v) => variantSizeKey(v)));
    expect(keys.size).toBe(1);
  });

  it("keeps genuinely distinct flower weights apart (negative control)", () => {
    const built = variantsFor(srcItem("f1", "Khush Kush", "flower", ["3.5g", "7g", "14g"]));
    const keys = new Set(built.variants.map((v) => variantSizeKey(v)));
    expect(keys.size).toBe(3);
  });

  it("collapses a mixed-type item when neither label carries a readable weight", () => {
    // Cartridge accepts `each` or `g`. Two unparseable labels both fall back to
    // `1 each`. This is the general form of the defect.
    expect(variantAmountAndUnit("Cartridge", "Full Gram")).toEqual({ amount: 1, unit: "each" });
    expect(variantAmountAndUnit("Cartridge", "Half Gram")).toEqual({ amount: 1, unit: "each" });
    const built = variantsFor(
      srcItem("c1", "Some Cart", "cartridge", ["Full Gram", "Half Gram"]),
    );
    expect(new Set(built.variants.map((v) => variantSizeKey(v))).size).toBe(1);
  });

  it("does NOT collapse a mixed-type item when one label has a real weight", () => {
    const built = variantsFor(srcItem("c2", "Some Cart", "cartridge", ["1g", "Half Gram"]));
    expect(new Set(built.variants.map((v) => variantSizeKey(v))).size).toBe(2);
  });

  it("maps the categories in the owner's push to the types that explain the result", () => {
    // Pinned because the collapse is a property of the TYPE, and a future edit
    // moving `topical` to a weighed type would change the diagnosis silently.
    expect(toLeaflyType("topical")).toBe("Topical");
    expect(toLeaflyType("cartridge")).toBe("Cartridge");
    expect(toLeaflyType("disposable-cartridge")).toBe("Cartridge");
    expect(toLeaflyType("concentrate")).toBe("Concentrate");
    expect(toLeaflyType("flower")).toBe("Flower");
    expect(toLeaflyType("infused-flower")).toBe("Flower");
  });
});

describe("the owner's actual push, reproduced from the real mapper", () => {
  /**
   * The strongest evidence available that the diagnosis is right: replay the
   * eight products from the owner's own screenshots and show the model picks
   * out exactly the four the live read-back flagged, and nothing else.
   *
   * Categories and size counts are READ OFF the picker screenshot. They are
   * observations, not inventions. The variant labels are NOT in the screenshot,
   * so nothing here claims to know them -- the prediction is made from a
   * property of the TYPE, which is fully computable.
   *
   * A model that flagged all eight would also "catch" all four, and would be
   * worthless. The false-positive count is what makes this meaningful, which
   * is why it is asserted as hard as the true-positive count.
   */
  const OBSERVED = [
    { name: "Ceres Dragon Balm CBD RED", category: "topical", sizes: 2 },
    { name: "Khush Kush-Flower-B Line-Item 9-14g", category: "flower", sizes: 3 },
    { name: "Legacy Truffles - Golden Truffle - Legacy Loco - 1g", category: "infused-flower", sizes: 2 },
    { name: "Lifted Cannabis-Disposable Cartridge-Cured Malibu Marker-1g", category: "disposable-cartridge", sizes: 2 },
    { name: "Rosin- One Piece - 1g", category: "concentrate", sizes: 2 },
    { name: "Thrills - FlavorStrains - Cartridge - 1g - (C6)(S) Sweet Island Skunk", category: "cartridge", sizes: 2 },
    { name: "Trees Co.-Infused Pre-roll-Lemon Tree-1g", category: "infused-preroll", sizes: 1 },
    { name: "Trees Co.-Pre-roll-Bananaconda-1g", category: "preroll", sizes: 1 },
  ];

  /** The four the live read-back actually reported as missing variants. */
  const FLAGGED = new Set([
    "Ceres Dragon Balm CBD RED",
    "Lifted Cannabis-Disposable Cartridge-Cured Malibu Marker-1g",
    "Rosin- One Piece - 1g",
    "Thrills - FlavorStrains - Cartridge - 1g - (C6)(S) Sweet Island Skunk",
  ]);

  /**
   * Does this type map every weight-free label onto ONE identical size?
   *
   * This is the discriminating property, and it is measured by calling the real
   * mapper rather than asserted from memory. Flower REJECTS a label with no
   * readable weight, so a flower item can never lose a size silently. Topical
   * and PreRoll have no unit but `each`. Cartridge and Concentrate accept a
   * weight when the label carries one and fall back to `1 each` when it does
   * not -- which is why they collapse in practice.
   */
  function collapsesUnreadableLabels(type: string): boolean {
    const keys = new Set<string>();
    for (const label of ["Small", "Large", "Regular", "Jar", "Piece"]) {
      const au = variantAmountAndUnit(type as never, label);
      if (au === null) return false;
      keys.add(variantSizeKey({ amount: au.amount, unit: au.unit }));
    }
    return keys.size === 1;
  }

  const scored = OBSERVED.map((o) => {
    const type = toLeaflyType(o.category);
    return {
      ...o,
      type,
      predictLoss: o.sizes > 1 && collapsesUnreadableLabels(type),
      actualFlagged: FLAGGED.has(o.name),
    };
  });

  it("flags exactly the four products the live read-back flagged", () => {
    const predicted = scored.filter((s) => s.predictLoss).map((s) => s.name).sort();
    expect(predicted).toEqual([...FLAGGED].sort());
  });

  it("raises no false alarms on the four that came back clean", () => {
    // The part that makes the match meaningful rather than a coincidence.
    const falsePositives = scored.filter((s) => s.predictLoss && !s.actualFlagged);
    expect(falsePositives.map((s) => s.name)).toEqual([]);
  });

  it("misses none of the four that failed", () => {
    const falseNegatives = scored.filter((s) => !s.predictLoss && s.actualFlagged);
    expect(falseNegatives.map((s) => s.name)).toEqual([]);
  });

  it("explains WHY flower survived while cartridges did not", () => {
    // Flower refuses an unreadable label outright, so the failure mode cannot
    // occur there. If a future edit gives Flower an `each` fallback "to be more
    // forgiving", flower menus would start losing sizes silently -- so the
    // distinction is pinned here deliberately.
    expect(collapsesUnreadableLabels("Flower")).toBe(false);
    expect(variantAmountAndUnit("Flower" as never, "Small")).toBeNull();

    expect(collapsesUnreadableLabels("Topical")).toBe(true);
    expect(collapsesUnreadableLabels("Cartridge")).toBe(true);
    expect(collapsesUnreadableLabels("Concentrate")).toBe(true);

    // ...but a cartridge label that DOES carry a weight keeps its own size.
    expect(variantAmountAndUnit("Cartridge" as never, "1g")).toEqual({ amount: 1, unit: "g" });
    expect(variantAmountAndUnit("Cartridge" as never, "Half Gram")).toEqual({ amount: 1, unit: "each" });
  });

  it("does not flag a single-size product even when its type collapses", () => {
    // Both prerolls are `each`-only, but with one size there is nothing to
    // collide with. Type alone must never be enough to raise the alarm.
    const prerolls = scored.filter((s) => s.type === "PreRoll");
    expect(prerolls.length).toBeGreaterThan(0);
    for (const p of prerolls) {
      expect(collapsesUnreadableLabels(p.type)).toBe(true);
      expect(p.predictLoss).toBe(false);
    }
  });
});

describe("the validator refuses to send a size that cannot arrive", () => {
  function payloadWith(
    variants: { id: string; amount: number; unit: string }[],
    // Defaults to the owner's real failing case. Parameterised because the
    // REMEDY depends on the type, so a fixed type could not test the wording.
    type = "Topical",
  ) {
    return {
      items: [
        {
          id: "item-1",
          type,
          name: "Probe",
          variants: variants.map((v) => ({
            id: v.id,
            medical: false,
            price: 1000,
            amount: v.amount,
            unit: v.unit,
            inventoryLevel: 5,
          })),
        },
      ],
    };
  }

  /** The collision message the validator produces for a given funnel type. */
  function collisionMessageForType(type: string): string {
    const res = validateLeaflyPayload(
      payloadWith(
        [
          { id: "a", amount: 1, unit: "each" },
          { id: "b", amount: 1, unit: "each" },
        ],
        type,
      ),
    );
    const hit = res.errors.find((e) => e.code === "variant_size_indistinguishable");
    // A missing finding would make every wording assertion below vacuously
    // pass, so fail loudly instead of returning "".
    if (!hit) throw new Error(`no collision finding produced for type ${type}`);
    return hit.message;
  }

  it("rejects an indistinguishable pair as an ERROR", () => {
    const res = validateLeaflyPayload(
      payloadWith([
        { id: "v1", amount: 1, unit: "each" },
        { id: "v2", amount: 1, unit: "each" },
      ]),
    );
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === "variant_size_indistinguishable")).toBe(true);
  });

  it("names every colliding id so the owner knows which sizes to relabel", () => {
    const res = validateLeaflyPayload(
      payloadWith([
        { id: "keep-me", amount: 1, unit: "each" },
        { id: "lose-me", amount: 1, unit: "each" },
      ]),
    );
    const hit = res.errors.find((e) => e.code === "variant_size_indistinguishable");
    expect(hit?.message).toContain("keep-me");
    expect(hit?.message).toContain("lose-me");
  });

  it("explains the cause and offers a fix, not just a code", () => {
    const res = validateLeaflyPayload(
      payloadWith([
        { id: "v1", amount: 1, unit: "each" },
        { id: "v2", amount: 1, unit: "each" },
      ]),
    );
    const hit = res.errors.find((e) => e.code === "variant_size_indistinguishable");
    expect(hit?.message).toContain("amount and unit");
    expect(hit?.message).toMatch(/distinct weights|separate products/);
  });

  it("gives advice that is POSSIBLE for the product's type", () => {
    // A topical can only ever be `each`, so "relabel them with distinct
    // weights" is advice that cannot work. Verified against the real mapper:
    // relabelling a topical "1oz"/"2oz" still collapses to a single `1 each`.
    // Sending an owner to spend an afternoon on an impossible fix costs more
    // than the defect did.
    const eachOnly = ["Topical", "PreRoll", "Edible", "Accessory"];
    for (const type of eachOnly) {
      const msg = collisionMessageForType(type);
      expect(msg).not.toContain("distinct weights");
      expect(msg).toContain("separate products");
      expect(msg).toContain('only "each"');
    }

    // Cartridge and Concentrate accept `g`, so relabelling genuinely fixes it.
    for (const type of ["Cartridge", "Concentrate"]) {
      const msg = collisionMessageForType(type);
      expect(msg).toContain("distinct weights");
      expect(msg).toContain("separate products");
    }
  });

  it("offers a remedy that actually clears the error when followed", () => {
    // Advice is only worth printing if doing it works. Replay the owner's
    // cartridge shape, apply exactly the suggested fix, and require silence.
    const before = variantsFor(srcItem("c8", "Cart", "cartridge", ["Full Gram", "Half Gram"]));
    const beforeCollisions = findVariantCollisions(
      before.variants.map((v) => ({ id: v.id, amount: v.amount, unit: v.unit })),
    );
    expect(beforeCollisions.length).toBe(1);

    const after = variantsFor(srcItem("c8", "Cart", "cartridge", ["1g", "0.5g"]));
    const afterCollisions = findVariantCollisions(
      after.variants.map((v) => ({ id: v.id, amount: v.amount, unit: v.unit })),
    );
    expect(afterCollisions).toEqual([]);
  });

  it("accepts genuinely distinct sizes (negative control)", () => {
    const res = validateLeaflyPayload(
      payloadWith([
        { id: "v1", amount: 3.5, unit: "g" },
        { id: "v2", amount: 7, unit: "g" },
      ]),
    );
    expect(res.errors.some((e) => e.code === "variant_size_indistinguishable")).toBe(false);
  });

  it("accepts a single-variant item (negative control)", () => {
    const res = validateLeaflyPayload(payloadWith([{ id: "v1", amount: 1, unit: "each" }]));
    expect(res.errors.some((e) => e.code === "variant_size_indistinguishable")).toBe(false);
  });

  it("reports a three-way collision once rather than twice", () => {
    const res = validateLeaflyPayload(
      payloadWith([
        { id: "a", amount: 1, unit: "each" },
        { id: "b", amount: 1, unit: "each" },
        { id: "c", amount: 1, unit: "each" },
      ]),
    );
    const hits = res.errors.filter((e) => e.code === "variant_size_indistinguishable");
    expect(hits).toHaveLength(1);
  });
});

describe("the read-back explains a collided variant", () => {
  const collidingSent: LeaflyItemsPayload = {
    items: [
      {
        id: "TOPICAL-1",
        type: "Topical",
        name: "Ceres Dragon Balm CBD RED",
        variants: [
          { id: "tv-kept", medical: false, price: 1000, amount: 1, unit: "each", inventoryLevel: 5 },
          { id: "tv-lost", medical: false, price: 2000, amount: 1, unit: "each", inventoryLevel: 5 },
        ],
      },
    ],
  };

  // Built through the REAL parser, so the fixture cannot describe a response
  // shape Leafly never produces.
  const backWithOne = parseLeaflyMenuReadback({
    result: [
      {
        id: "TOPICAL-1",
        name: "Ceres Dragon Balm CBD RED",
        variants: [
          {
            id: "tv-kept",
            inventoryLevel: 5,
            medical: false,
            packagePrice: 1000,
            packageSize: 1,
            packageUnit: "each",
          },
        ],
      },
    ],
    metadata: { totalCount: 1 },
  });

  it("still reports the variant as missing, because it is", () => {
    const rec = reconcileLeaflyMenu(collidingSent, backWithOne, "targeted");
    expect(rec.issues.some((i) => i.code === "variant_missing")).toBe(true);
  });

  it("says why, instead of leaving the owner hunting a transmission failure", () => {
    const rec = reconcileLeaflyMenu(collidingSent, backWithOne, "targeted");
    const vm = rec.issues.find((i) => i.code === "variant_missing");
    expect(vm?.message).toContain("amount and unit");
    expect(vm?.message).toContain("not a transmission failure");
    expect(vm?.message).toContain("tv-kept");
  });

  it("invents no explanation when it cannot prove one (negative control)", () => {
    const distinctSent: LeaflyItemsPayload = {
      items: [
        {
          id: "FLOWER-1",
          type: "Flower",
          name: "Khush Kush",
          variants: [
            { id: "fv-1", medical: false, price: 1200, amount: 3.5, unit: "g", inventoryLevel: 5 },
            { id: "fv-2", medical: false, price: 2200, amount: 7, unit: "g", inventoryLevel: 5 },
          ],
        },
      ],
    };
    const back = parseLeaflyMenuReadback({
      result: [
        {
          id: "FLOWER-1",
          name: "Khush Kush",
          variants: [
            {
              id: "fv-1",
              inventoryLevel: 5,
              medical: false,
              packagePrice: 1200,
              packageSize: 3.5,
              packageUnit: "g",
            },
          ],
        },
      ],
      metadata: { totalCount: 1 },
    });
    const rec = reconcileLeaflyMenu(distinctSent, back, "targeted");
    const vm = rec.issues.find((i) => i.code === "variant_missing");
    expect(vm).toBeDefined();
    expect(vm?.message).not.toContain("amount and unit");
  });

  it("does not explain an id that was never in the payload", () => {
    expect(
      explainMissingVariant({
        missingVariantId: "never-sent",
        sentVariants: [
          { id: "a", amount: 1, unit: "each" },
          { id: "b", amount: 1, unit: "each" },
        ],
      }),
    ).toBeNull();
  });
});

describe("the picker tells the truth about sizes", () => {
  it("computes the sent size count with the REAL mapper, not a copy of it", () => {
    const src = readCode("src/app/admin/integrations/leafly/selection-actions.ts");
    const fn = block(src, "function toRow(");
    expect(fn).toContain("variantsFor(item)");
    expect(fn).toContain("variantSizeKey");
    // A hand-rolled reimplementation would drift from the push on the first
    // change to the mapper.
    expect(fn).not.toContain('unit: "each"');
  });

  it("actually ASSIGNS the mapper's result to the column", () => {
    // A mutation run caught this: the guard above passed while the column was
    // reverted to `sentVariantCount: item.variants.length`, because
    // `variantsFor` was still *called* a few lines earlier -- its result was
    // simply thrown away. Calling the right function proves nothing unless the
    // value reaches the field, so assert the assignment itself.
    const src = readCode("src/app/admin/integrations/leafly/selection-actions.ts");
    const fn = block(src, "function toRow(");
    expect(fn).toMatch(/sentVariantCount:\s*distinctSizes\s*,/);
    // The pre-fix bug, stated explicitly so it cannot come back unnoticed:
    // `item.variants.length` is how many sizes exist in OUR system, counted
    // before the Leafly mapper runs. Reporting it as "sizes to Leafly" is the
    // exact untruth this whole finding exists to remove.
    expect(fn).not.toMatch(/sentVariantCount:\s*item\.variants\.length/);
    // `distinctSizes` must itself be derived from the mapper's output, not
    // from the raw item -- otherwise the name would be the only honest part.
    expect(fn).toMatch(/distinctSizes\s*=[\s\S]*?built\.variants/);
  });

  it("counts distinct sizes by size identity, proven behaviourally", () => {
    // The guards above are text. This one runs the real functions the column
    // is built from, so the MEANING of the column is pinned, not its spelling.
    const twoTopicalSizes = srcItem("t9", "Balm", "topical", ["Small", "Large"]);
    const built = variantsFor(twoTopicalSizes);
    const distinct = new Set(
      built.variants.map((v) => variantSizeKey({ amount: v.amount, unit: v.unit })),
    ).size;
    // Two sizes go in; Leafly can only tell one of them apart.
    expect(twoTopicalSizes.variants.length).toBe(2);
    expect(distinct).toBe(1);
    expect(Math.max(0, twoTopicalSizes.variants.length - distinct)).toBe(1);

    // Negative control: real weights survive, so the column must not cry wolf.
    const flower = srcItem("f9", "Blue Dream", "flower", ["3.5g", "7g"]);
    const fBuilt = variantsFor(flower);
    const fDistinct = new Set(
      fBuilt.variants.map((v) => variantSizeKey({ amount: v.amount, unit: v.unit })),
    ).size;
    expect(fDistinct).toBe(2);
    expect(Math.max(0, flower.variants.length - fDistinct)).toBe(0);
  });

  it("derives lostVariantCount rather than storing an unrelated number", () => {
    const src = readCode("src/app/admin/integrations/leafly/selection-actions.ts");
    const fn = block(src, "function toRow(");
    expect(fn).toMatch(/lostVariantCount:\s*Math\.max\(\s*0\s*,\s*item\.variants\.length\s*-\s*distinctSizes\s*\)/);
  });

  it("exposes both counts on the row type", () => {
    const src = readCode("src/app/admin/integrations/leafly/selection-actions.ts");
    expect(src).toContain("sentVariantCount: number");
    expect(src).toContain("lostVariantCount: number");
  });

  it("renders the honest column heading", () => {
    const src = read("src/app/admin/integrations/leafly/leafly-picker-client.tsx");
    expect(src).toContain("Sizes to Leafly");
  });

  it("shows the lost count beside the real one rather than replacing it", () => {
    const src = readCode("src/app/admin/integrations/leafly/leafly-picker-client.tsx");
    expect(src).toContain("row.lostVariantCount > 0");
    expect(src).toContain("row.sentVariantCount");
    expect(src).toContain("line-through");
  });

  it("warns before the push, gated on there being something to warn about", () => {
    const src = readCode("src/app/admin/integrations/leafly/leafly-picker-client.tsx");
    expect(src).toContain("summarizeSizeLoss(rows, selected)");
    expect(src).toContain("{sizeLossNotice && (");
  });

  it("summarises only the selected products", () => {
    const rows = [
      { id: "sel", name: "Bad", variantCount: 2, sentVariantCount: 1, lostVariantCount: 1 },
      { id: "unsel", name: "Also Bad", variantCount: 2, sentVariantCount: 1, lostVariantCount: 1 },
    ];
    const s = summarizeSizeLoss(rows, new Set(["sel"]));
    expect(s.affected).toHaveLength(1);
    expect(s.affected[0].id).toBe("sel");
  });

  it("stays silent when nothing is lost (negative control)", () => {
    const rows = [
      { id: "a", name: "Fine", variantCount: 3, sentVariantCount: 3, lostVariantCount: 0 },
    ];
    expect(describeSizeLoss(summarizeSizeLoss(rows, new Set(["a"])))).toBeNull();
  });
});

describe("CI enforces these tests", () => {
  it("registers the new core with a floor", () => {
    const src = readCode("scripts/compliance/run-pure-selftests.ts");
    expect(src).toContain("__runLeaflyVariantIdentityTests");
    expect(src).toMatch(/assertRan\("leafly-variant-identity-core",\s*__runLeaflyVariantIdentityTests\(\),\s*\d+\)/);
  });

  it("raised the floors that the new assertions sit behind", () => {
    const src = readCode("scripts/compliance/run-pure-selftests.ts");
    const floor = (name: string) => {
      const m = src.match(new RegExp(`assertRan\\("${name}",[^,]+,\\s*(\\d+)\\)`));
      return m ? Number(m[1]) : -1;
    };
    // A floor that is not raised when assertions are added lets a future edit
    // delete them without failing anything.
    expect(floor("leafly-readback-core")).toBeGreaterThanOrEqual(104);
    expect(floor("leafly-picker-view-core")).toBeGreaterThanOrEqual(138);
    expect(floor("leafly-payload-validate-core")).toBeGreaterThanOrEqual(124);
    expect(floor("leafly-variant-identity-core")).toBeGreaterThanOrEqual(75);
  });

  it("keeps the identity core pure", () => {
    // Assert the real property -- what the module IMPORTS -- rather than the
    // proxy "does the file contain the text 'server-only' anywhere". The proxy
    // version of this guard failed on the file's own comment explaining why it
    // must never import `server-only`, which is the wrong thing to fail on: a
    // test that punishes documentation pushes authors to delete documentation.
    const src = readCode("src/lib/leafly/variant-identity-core.ts");

    // Every module specifier: static `import ... from "x"`, bare `import "x"`,
    // dynamic `import("x")`, and CommonJS `require("x")`.
    const specifiers: string[] = [];
    for (const re of [
      /\bimport\s+(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/g,
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
      /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    ]) {
      for (const m of src.matchAll(re)) specifiers.push(m[1]);
    }

    // The module is deliberately self-contained: the size-identity rule is the
    // one thing every other layer must agree on, so it depends on nothing that
    // could drag React, Next, a database client or `server-only` in behind it.
    // If a future edit genuinely needs an import, this list is where the
    // decision gets made -- consciously, in review.
    const ALLOWED: string[] = [];
    expect(specifiers.filter((s) => !ALLOWED.includes(s))).toEqual([]);

    // Belt and braces: no runtime globals that only exist in a browser or in a
    // Node server process. These would not show up as imports.
    for (const forbidden of ["document.", "window.", "process.env", "fetch("]) {
      expect(src).not.toContain(forbidden);
    }
  });

  it("states the rule in exactly one place", () => {
    // The validator, the read-back and the picker must all consume the shared
    // module rather than each re-deriving "same size".
    const validator = readCode("src/lib/leafly/payload-validate-core.ts");
    const readback = readCode("src/lib/leafly/readback-core.ts");
    const actions = readCode("src/app/admin/integrations/leafly/selection-actions.ts");
    expect(validator).toContain("variant-identity-core");
    expect(readback).toContain("variant-identity-core");
    expect(actions).toContain("variant-identity-core");
  });
});
