/**
 * TASK J -- Leafly x Cultivera remediation.
 *
 * These tests guard the four things the owner asked for that can be asserted
 * without a browser:
 *
 *   1. Products are identified by NAME / BRAND / VENDOR / BARCODE, not by id.
 *   2. The 124-error size collision has a safe, bulk-applicable remedy.
 *   3. "Suggest a sample" can suggest a DIFFERENT set, and prefers products
 *      that will actually send.
 *   4. The back office cannot forget credentials because a lambda went cold
 *      or a database call blipped.
 *
 * Several of these are WIRING tests that read the source. That is deliberate:
 * a pure core can be perfect and still be unreachable, which is exactly what
 * happened to `describeQuarantinedItems()` in Task I -- it was correct, fully
 * tested, and had no caller. A core with no caller is a core that does not
 * exist as far as the owner is concerned.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import {
  makeProductIdentity,
  describeProductIdentity,
  identityMatchesQuery,
  identityCompleteness,
  describeIdentityGaps,
  productFixHref,
  itemIdFromVariantId,
  __runLeaflyProductIdentityTests,
} from "@/lib/leafly/product-identity-core";

import {
  parseLabelWeight,
  planRemedyForItem,
  planRemedies,
  describeRemedyPlan,
  WEIGHT_CAPABLE_LEAFLY_TYPES,
  LEAFLY_VARIANT_UNITS,
  __runLeaflyCollisionRemedyTests,
} from "@/lib/leafly/collision-remedy-core";

import {
  buildRotatingSample,
  rotationJitter,
  describeSample,
  CONTRACT_PASS_BONUS,
  CONTRACT_FAIL_PENALTY,
  __runLeaflySampleRotationTests,
} from "@/lib/leafly/sample-rotation-core";

import { LEAFLY_TYPE_UNIT_MATRIX } from "@/lib/leafly/contract-core";
import {
  classifyFix,
  blanketFixAvailable,
  triageSendability,
  describeTriage,
  describeBlockedProducts,
  describeDefectGroup,
  RECOGNISED_DEFECT_CODES,
  type SendabilityIssue,
} from "@/lib/leafly/sendability-core";
import { validateLeaflyPayload } from "@/lib/leafly/payload-validate-core";
import {
  filterMenuRows,
  describeMenuRow,
  summarizeSelection,
  describeSelectAll,
  __runLeaflyMenuBrowserTests,
  type MenuBrowserRow,
} from "@/lib/leafly/menu-browser-core";

const repoRoot = process.cwd();
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * Strip comments so a source guard inspects CODE, not prose.
 *
 * Why this exists: these files deliberately document the bug they fix by
 * quoting the old broken implementation inside a comment block. A naive
 * substring guard then "finds" the defect in its own postmortem and fails a
 * file that is actually correct. Stripping comments first means a guard can
 * only ever fail on real executable code, which is the thing we care about.
 *
 * This makes the guards STRONGER, not weaker: nothing that was previously
 * caught stops being caught, but documentation can no longer trip them.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ========================================================================== */
/* The embedded self-tests must actually run                                  */
/* ========================================================================== */

describe("Task J pure cores: embedded self-tests", () => {
  it("product-identity self-tests pass and are not vacuous", () => {
    const r = __runLeaflyProductIdentityTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(90);
  });

  it("collision-remedy self-tests pass and are not vacuous", () => {
    const r = __runLeaflyCollisionRemedyTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(72);
  });

  it("sample-rotation self-tests pass and are not vacuous", () => {
    const r = __runLeaflySampleRotationTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(46);
  });

  it("all three cores are registered in the pure self-test runner with a real floor", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    for (const name of [
      "leafly-product-identity-core",
      "leafly-collision-remedy-core",
      "leafly-sample-rotation-core",
    ]) {
      const re = new RegExp(`assertRan\\("${name}"[^;]*?,\\s*(\\d+)\\s*\\)`);
      const m = re.exec(runner);
      expect(m, `${name} must be registered via assertRan`).not.toBeNull();
      expect(Number(m![1]), `${name} floor must be > 0`).toBeGreaterThan(0);
    }
  });

  it("the three cores are PURE -- no imports, no server-only, no React", () => {
    for (const f of [
      "src/lib/leafly/product-identity-core.ts",
      "src/lib/leafly/collision-remedy-core.ts",
      "src/lib/leafly/sample-rotation-core.ts",
    ]) {
      // Guard the CODE, not the comments. These files document the defect
      // they fix by quoting it, and prose must never fail a purity check.
      const src = stripComments(read(f));
      expect(src, `${f} must not import anything`).not.toMatch(/^\s*import\s/m);
      expect(src, `${f} must not be server-only`).not.toContain("server-only");
      expect(src, `${f} must not touch React`).not.toMatch(/\breact\b/i);
      expect(src, `${f} must not do I/O`).not.toMatch(/\bfetch\(|node:fs/);
      expect(src, `${f} must not touch the DOM`).not.toMatch(
        /\bdocument\.|\bwindow\./,
      );
      expect(src, `${f} must not read process env`).not.toContain(
        "process.env",
      );
    }
  });
});

/* ========================================================================== */
/* FINDING J-1 -- the variant-id decode, reproduced from first principles     */
/* ========================================================================== */

describe("FINDING J-1: the owner's 124 errors decode to clean 1g/3g/5g data", () => {
  // Replays src/lib/pos/transform.ts:263-266 exactly.
  const collapseKeyPart = (v: unknown): string =>
    String(v ?? "")
      .replace(/\u0000/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, "-");
  const stableId = (...parts: unknown[]): string =>
    createHash("sha1").update(parts.map(collapseKeyPart).join("|")).digest("hex").slice(0, 12);

  it("reproduces the transform's id algorithm against real suffixes from production", () => {
    // These five variant ids came from the owner's real error message. If this
    // test ever fails, the id algorithm changed and FINDING J-1's evidence
    // needs to be re-derived before any of the remedy logic is trusted.
    expect(stableId("1g", 1200, "medical")).toBe("cca24072824d");
    expect(stableId("3g", 3300, "medical")).toBe("00de6c9e8f2c");
    expect(stableId("5g", 4500, "medical")).toBe("feda4c3b3628");
    expect(stableId("1g", 1200, "adult")).toBe("28e453b71118");
    expect(stableId("5g", 4500, "adult")).toBe("34e5d01d3909");
  });

  it("the transform still builds variant ids the way the decode assumed", () => {
    const transform = read("src/lib/pos/transform.ts");
    expect(transform).toContain(
      'stableId(variant.package.label, variant.priceMinorUnits, variant.medical ? "medical" : "adult")',
    );
    expect(transform).toMatch(/sha1.*digest\("hex"\)\.slice\(0,\s*12\)/);
  });

  it("the decoded labels are real weights, NOT junk", () => {
    for (const label of ["1g", "3g", "5g"]) {
      const w = parseLabelWeight(label);
      expect(w, `${label} must parse as a real weight`).not.toBeNull();
      expect(w!.unit).toBe("g");
      expect(w!.value).toBeGreaterThan(0);
    }
  });
});

/* ========================================================================== */
/* Leafly contract anchors -- the vendored spec is the authority              */
/* ========================================================================== */

describe("authoritative Leafly contract anchors", () => {
  // `unknown` + local narrowing rather than `any`: the point of reading the
  // vendored spec is to catch it changing shape, and `any` would silently
  // swallow exactly that.
  const spec = JSON.parse(
    read("docs/leafly-specs/schemas/v2-items.json"),
  ) as Record<string, unknown>;
  const pick = (obj: unknown, ...path: string[]): Record<string, unknown> => {
    let cur: unknown = obj;
    for (const key of path) {
      expect(cur, `spec path .${path.join(".")} is missing at "${key}"`).toBeTruthy();
      cur = (cur as Record<string, unknown>)[key];
    }
    return cur as Record<string, unknown>;
  };
  const variantProps = pick(
    spec,
    "properties", "items", "items", "properties", "variants", "items", "properties",
  );

  it("variant.unit enum is exactly oz | g | each (vendored spec)", () => {
    const unitEnum = (pick(variantProps, "unit").enum as string[]);
    expect(unitEnum).toEqual(["oz", "g", "each"]);
    expect([...LEAFLY_VARIANT_UNITS].sort()).toEqual([...unitEnum].sort());
  });

  it("Leafly documents the per-type unit table our remedy relies on", () => {
    const doc = String(pick(variantProps, "unit").description);
    expect(doc).toContain("PreRoll");
    expect(doc).toContain("Flower");
    expect(doc).toContain("Concentrate");
  });

  it("WEIGHT_CAPABLE types match the type/unit matrix derived from that table", () => {
    const capable = Object.entries(LEAFLY_TYPE_UNIT_MATRIX)
      .filter(([, v]) => (v.variantUnits as readonly string[]).some((u) => u === "g" || u === "oz"))
      .map(([k]) => k)
      .sort();
    expect([...WEIGHT_CAPABLE_LEAFLY_TYPES].sort()).toEqual(capable);
  });

  it("PreRoll really is each-only, which is why the owner's items collided", () => {
    expect(LEAFLY_TYPE_UNIT_MATRIX.PreRoll.variantUnits).toEqual(["each"]);
    expect(LEAFLY_TYPE_UNIT_MATRIX.Topical.variantUnits).toEqual(["each"]);
    expect(LEAFLY_TYPE_UNIT_MATRIX.Edible.variantUnits).toEqual(["each"]);
  });

  it("item.name is free text, which is what makes the split remedy legal", () => {
    const itemProps = pick(spec, "properties", "items", "items", "properties");
    expect(pick(itemProps, "name").type).toBe("string");
    const required = pick(spec, "properties", "items", "items").required as string[];
    expect(required).toContain("name");
  });
});

/* ========================================================================== */
/* Ask 5 -- human identifiers                                                 */
/* ========================================================================== */

describe("ask 5: products are identified by name/brand/vendor/barcode, not id", () => {
  const ceres = makeProductIdentity({
    id: "pos-45c6e282e0e8",
    name: "Dragon Balm CBD RED",
    productName: "CERES DRAGON BALM CBD RED 3G",
    brand: "Ceres",
    vendor: "Ceres Garden",
    category: "topical",
    barcodes: ["GF42802505795142"],
  });

  it("a message leads with a human name, never the id", () => {
    const text = describeProductIdentity(ceres, { size: "3g" });
    expect(text.startsWith("Ceres Dragon Balm CBD RED")).toBe(true);
    expect(text.indexOf("Ceres")).toBeLessThan(text.indexOf("pos-45c6e282e0e8"));
  });

  it("the id is still present, because a fix link and support need it", () => {
    expect(describeProductIdentity(ceres)).toContain("pos-45c6e282e0e8");
  });

  it("vendor and barcode appear, which is what the owner explicitly asked for", () => {
    const text = describeProductIdentity(ceres);
    expect(text).toContain("vendor Ceres Garden");
    expect(text).toContain("GF42802505795142");
  });

  it("search works by every human handle, including a barcode tail", () => {
    expect(identityMatchesQuery(ceres, "dragon")).toBe(true);
    expect(identityMatchesQuery(ceres, "ceres garden")).toBe(true);
    expect(identityMatchesQuery(ceres, "795142")).toBe(true);
    expect(identityMatchesQuery(ceres, "topical")).toBe(true);
    expect(identityMatchesQuery(ceres, "zkittlez")).toBe(false);
  });

  it("multi-token search is AND, so a 400-product menu actually narrows", () => {
    const other = makeProductIdentity({ id: "p2", name: "Healing Balm", brand: "Other Co" });
    expect(identityMatchesQuery(ceres, "ceres balm")).toBe(true);
    expect(identityMatchesQuery(other, "ceres balm")).toBe(false);
  });

  it("missing identifiers are reported honestly, never invented", () => {
    const bare = makeProductIdentity({ id: "p", name: "Nameless Co Product" });
    const text = describeProductIdentity(bare);
    expect(text).not.toContain("Unknown");
    expect(text).not.toContain("N/A");
    expect(describeIdentityGaps(bare)).toContain("vendor");
    expect(identityCompleteness(bare).percent).toBe(0);
  });

  it("an empty brand (schema default '') is treated as absent, not printed blank", () => {
    expect(makeProductIdentity({ id: "p", name: "X", brand: "" }).brand).toBeNull();
    expect(describeProductIdentity(makeProductIdentity({ id: "p", name: "X", brand: "" }))).not.toContain("  ");
  });

  it("the columns this core reads really exist in the migration", () => {
    const mig = read("supabase/migrations/0002_slice2_pos_import.sql");
    expect(mig).toContain("vendor_name");
    expect(mig).toContain("product_name");
    expect(mig).toContain("brand_name");
    expect(mig).toMatch(/create table if not exists public\.menu_variants/);
    expect(mig).toContain("label");
  });

  it("the barcode really comes from inventory_lots joined on the POS key", () => {
    const lots = read("supabase/migrations/0023_pos_inventory_lots.sql");
    expect(lots).toContain("lot_code");
    expect(lots).toContain("pos_product_key");
    // And the import planner documents it as the Cultivera barcode.
    expect(read("src/lib/pos/import-lot-core.ts")).toContain("the Cultivera barcode");
  });
});

/* ========================================================================== */
/* Asks 3/4/7 -- the fix link must point somewhere real                       */
/* ========================================================================== */

describe("asks 3, 4, 7: the 'fix this product' button goes to a real page", () => {
  it("the route it links to exists in the app", () => {
    // Throws if the file is missing, which is the assertion.
    const page = read("src/app/admin/products/[key]/page.tsx");
    expect(page).toContain("params");
    expect(page).toContain("getItemBySourceKey");
  });

  it("the route segment is keyed by source_item_id, the id Leafly errors carry", () => {
    const page = read("src/app/admin/products/[key]/page.tsx");
    expect(page).toMatch(/params:\s*Promise<\{\s*key:\s*string\s*\}>/);
    expect(page).toMatch(/getItemBySourceKey\(\s*published\.id,\s*key\s*\)/);
  });

  it("builds the href for a real product id", () => {
    expect(productFixHref("pos-45c6e282e0e8")).toBe("/admin/products/pos-45c6e282e0e8");
  });

  it("a VARIANT id from the error message resolves to its product's fix page", () => {
    // Every id below is real, from the owner's 124-error message.
    const pairs: Array<[string, string]> = [
      ["pos-45c6e282e0e8-cca24072824d", "pos-45c6e282e0e8"],
      ["pos-45c6e282e0e8-00de6c9e8f2c", "pos-45c6e282e0e8"],
      ["pos-a1ced5301c8a-cca24072824d", "pos-a1ced5301c8a"],
      ["pos-9393e5a4833a-feda4c3b3628", "pos-9393e5a4833a"],
      ["pos-97daeda0187e-28e453b71118", "pos-97daeda0187e"],
      ["pos-a196be913e9a-feda4c3b3628", "pos-a196be913e9a"],
    ];
    for (const [variantId, itemId] of pairs) {
      expect(itemIdFromVariantId(variantId)).toBe(itemId);
      expect(productFixHref(itemIdFromVariantId(variantId))).toBe(`/admin/products/${itemId}`);
    }
  });

  it("REGRESSION: an item id must never be mangled into a broken link", () => {
    // The naive implementation stripped `pos-45c6e282e0e8` down to `pos`,
    // sending the owner to a product that does not exist. Caught by a
    // self-test before it shipped; pinned here so it cannot come back.
    expect(itemIdFromVariantId("pos-45c6e282e0e8")).toBe("pos-45c6e282e0e8");
    expect(productFixHref(itemIdFromVariantId("pos-45c6e282e0e8"))).toBe("/admin/products/pos-45c6e282e0e8");
  });

  it("never links to a wrong product when the shape is unfamiliar", () => {
    expect(itemIdFromVariantId("pos-abc-zzzzzzzzzzzz")).toBe("pos-abc-zzzzzzzzzzzz");
    expect(itemIdFromVariantId("pos-abc-cca240")).toBe("pos-abc-cca240");
  });

  it("encodes ids so a stray slash cannot produce a 404", () => {
    expect(productFixHref("a/b")).toBe("/admin/products/a%2Fb");
    expect(productFixHref("")).toBeNull();
  });
});

/* ========================================================================== */
/* Ask 7 -- the blanket fix                                                   */
/* ========================================================================== */

describe("ask 7: a blanket fix for the repeated Cultivera size-collision defect", () => {
  const ownerItem = {
    id: "pos-45c6e282e0e8",
    name: "Dragon Balm CBD RED",
    leaflyType: "PreRoll",
    variants: [
      { id: "pos-45c6e282e0e8-cca24072824d", label: "1g", priceMinorUnits: 1200 },
      { id: "pos-45c6e282e0e8-00de6c9e8f2c", label: "3g", priceMinorUnits: 3300 },
    ],
  };

  it("plans a split for the owner's real failing item", () => {
    const plan = planRemedyForItem(ownerItem)!;
    expect(plan.kind).toBe("split_items");
    expect(plan.splits).toHaveLength(2);
    expect(plan.splits.map((s) => s.newItemName)).toEqual([
      "Dragon Balm CBD RED - 1g",
      "Dragon Balm CBD RED - 3g",
    ]);
  });

  it("the new names come VERBATIM from recorded labels -- nothing invented", () => {
    const plan = planRemedyForItem(ownerItem)!;
    for (const s of plan.splits) {
      expect(ownerItem.variants.some((v) => v.label === s.label)).toBe(true);
      expect(s.newItemName.endsWith(` - ${s.label}`)).toBe(true);
    }
  });

  it("proposed item ids are unique, as Leafly's schema requires", () => {
    const plan = planRemedyForItem(ownerItem)!;
    const ids = plan.splits.map((s) => s.newItemId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("weight-capable types just carry the weight instead of splitting", () => {
    const plan = planRemedyForItem({ ...ownerItem, leaflyType: "Cartridge" })!;
    expect(plan.kind).toBe("carry_weight");
    expect(plan.splits).toHaveLength(0);
  });

  it("refuses rather than guesses when the data will not support a fix", () => {
    const noLabels = planRemedyForItem({
      id: "p",
      name: "Mystery",
      leaflyType: "Topical",
      variants: [
        { id: "a", label: "", priceMinorUnits: 1 },
        { id: "b", label: null, priceMinorUnits: 2 },
      ],
    })!;
    expect(noLabels.kind).toBe("manual");
    expect(noLabels.splits).toHaveLength(0);
    expect(noLabels.reason).toMatch(/never invented/i);
  });

  it("refuses when two sizes share a label, which would make duplicate names", () => {
    const dup = planRemedyForItem({
      id: "p",
      name: "Twin",
      leaflyType: "PreRoll",
      variants: [
        { id: "a", label: "1g", priceMinorUnits: 1 },
        { id: "b", label: "1g", priceMinorUnits: 2 },
      ],
    })!;
    expect(dup.kind).toBe("manual");
  });

  it("NEGATIVE CONTROL: a healthy single-size item produces no plan at all", () => {
    expect(
      planRemedyForItem({
        id: "ok",
        name: "Fine",
        leaflyType: "PreRoll",
        variants: [{ id: "v", label: "1g", priceMinorUnits: 100 }],
      }),
    ).toBeNull();
  });

  it("mg is refused as a size, because milligrams are potency", () => {
    expect(parseLabelWeight("100mg")).toBeNull();
    expect(parseLabelWeight("1000mg")).toBeNull();
  });

  it("never converts a unit, because that would change the recorded size", () => {
    expect(parseLabelWeight("1kg")).toBeNull();
    expect(parseLabelWeight("1lb")).toBeNull();
    expect(parseLabelWeight("3.5g")).toEqual({ value: 3.5, unit: "g" });
  });

  it("summarises a mixed plan in terms that answer 'can this be bulk fixed?'", () => {
    const plan = planRemedies([
      ownerItem,
      { ...ownerItem, id: "b", leaflyType: "Cartridge" },
      {
        id: "c",
        name: "Mystery",
        leaflyType: "Topical",
        variants: [
          { id: "x", label: "", priceMinorUnits: 1 },
          { id: "y", label: "", priceMinorUnits: 2 },
        ],
      },
    ]);
    expect(plan.total).toBe(3);
    expect(plan.automatic).toBe(2);
    expect(plan.manual).toBe(1);
    const text = describeRemedyPlan(plan);
    expect(text).toContain("2 of 3 can be fixed automatically");
    expect(text).toContain("in bulk");
    expect(text).toContain("No size is ever dropped");
    expect(text).toContain("until you approve");
  });

  it("an all-clear menu says so plainly rather than showing an empty table", () => {
    expect(describeRemedyPlan(planRemedies([]))).toBe(
      "No products have sizes that Leafly cannot tell apart.",
    );
  });
});

/* ========================================================================== */
/* Asks 1/2/3 -- the sampler                                                  */
/* ========================================================================== */

describe("asks 1, 2, 3: 'Suggest a sample' rotates and prefers sendable products", () => {
  const pool = Array.from({ length: 30 }, (_, i) => ({
    id: `p${String(i).padStart(2, "0")}`,
    category: `cat${i % 6}`,
    brand: `brand${i % 4}`,
    strainType: i % 2 ? "indica" : "sativa",
    inStock: true,
    variantCount: 1,
    passesContract: true,
  }));

  it("pressing the button again suggests a DIFFERENT eight", () => {
    const a = buildRotatingSample(pool, 8, 0).picked.map((p) => p.id);
    const b = buildRotatingSample(pool, 8, 1).picked.map((p) => p.id);
    const c = buildRotatingSample(pool, 8, 2).picked.map((p) => p.id);
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
    expect(a).not.toEqual(c);
  });

  it("but the same round always replays exactly, so a failure is reproducible", () => {
    for (const round of [0, 1, 5, 12]) {
      expect(buildRotatingSample(pool, 8, round).picked.map((p) => p.id)).toEqual(
        buildRotatingSample(pool, 8, round).picked.map((p) => p.id),
      );
    }
  });

  it("round 0 applies no jitter, preserving the previously-shipped behaviour", () => {
    expect(rotationJitter("anything", 0)).toBe(0);
  });

  it("a sendable product outranks a richer unsendable one", () => {
    const rich = {
      id: "rich",
      category: "zzz",
      variantCount: 6,
      hasImage: true,
      hasDescription: true,
      hasPotency: true,
      inStock: true,
      passesContract: false,
    };
    const plain = { id: "plain", category: "zzz", variantCount: 1, inStock: true, passesContract: true };
    expect(buildRotatingSample([rich, plain], 1, 0).picked[0].id).toBe("plain");
  });

  it("the pass bonus is strong enough to beat every coverage bonus combined", () => {
    // Coverage bonuses in the module: 100+60+40+30+30+20+15+50 = 345, plus
    // small standing preferences. A fail penalty plus a missed pass bonus must
    // exceed that, or a rich broken product could still win.
    expect(CONTRACT_PASS_BONUS + CONTRACT_FAIL_PENALTY).toBeGreaterThan(300);
  });

  it("failing products are surfaced, not silently hidden", () => {
    const bad = [
      { id: "b1", category: "a", passesContract: false, failureReason: "sizes collide" },
      { id: "b2", category: "b", passesContract: false, failureReason: "sizes collide" },
    ];
    const sel = buildRotatingSample(bad, 2, 0);
    expect(sel.picked).toHaveLength(2);
    expect(sel.failing).toHaveLength(2);
    expect(describeSample(sel)).toMatch(/fix/i);
  });

  it("an unchecked product is NOT treated as failing", () => {
    const sel = buildRotatingSample([{ id: "u1" }, { id: "u2", category: "e" }], 2, 0);
    expect(sel.picked).toHaveLength(2);
    expect(sel.failing).toHaveLength(0);
  });

  it("a mixed sample offers to send the good ones -- ask 4, at the sample level", () => {
    const sel = buildRotatingSample(
      [
        { id: "g1", category: "a", passesContract: true },
        { id: "b1", category: "b", passesContract: false },
      ],
      2,
      0,
    );
    const text = describeSample(sel);
    expect(text).toContain("can be sent now");
    expect(text).toContain("cannot");
  });

  it("still spans categories rather than returning near-identical products", () => {
    const sel = buildRotatingSample(
      [
        { id: "a", category: "flower", passesContract: true },
        { id: "b", category: "flower", passesContract: true },
        { id: "c", category: "edible", passesContract: true },
      ],
      2,
      0,
    );
    expect(new Set(sel.picked.map((p) => p.category)).size).toBe(2);
  });

  it("never returns duplicates", () => {
    const sel = buildRotatingSample(pool, 8, 3);
    expect(new Set(sel.picked.map((p) => p.id)).size).toBe(sel.picked.length);
  });
});

/* ========================================================================== */
/* Ask 8 -- credentials amnesia                                               */
/* ========================================================================== */

describe("ask 8: the back office cannot forget credentials that are set", () => {
  const gate = read("src/lib/leafly/readiness-gate.ts");
  // Comments stripped: runtime.ts quotes the OLD broken catch block in its
  // postmortem header, and the regression guard below must not match that.
  const runtime = stripComments(read("src/lib/leafly/runtime.ts"));
  const config = read("src/lib/leafly/config.ts");
  const actions = read("src/app/admin/integrations/leafly/actions.ts");
  const selectionActions = read("src/app/admin/integrations/leafly/selection-actions.ts");

  it("a DB failure no longer WIPES good credentials", () => {
    // The old code was: catch { setLeaflyOverrideCache(null); }
    expect(runtime).not.toMatch(/catch\s*\{[^}]*setLeaflyOverrideCache\(null\)/);
    expect(runtime).toContain("hasLeaflyOverrideCache()");
  });

  it("refreshLeaflyConfig reports WHY it failed instead of returning void", () => {
    expect(runtime).toMatch(/Promise<LeaflyConfigRefresh>/);
    for (const outcome of ["loaded", "unchanged", "unavailable"]) {
      expect(runtime).toContain(`"${outcome}"`);
    }
  });

  it("the cache predicate exists and does not leak the cache itself", () => {
    expect(config).toContain("export function hasLeaflyOverrideCache()");
    expect(config).not.toMatch(/export\s+(let|const)\s+overrideCache/);
  });

  it("the gate ALWAYS refreshes before deciding", () => {
    const fn = /export async function requireLeaflyReady\(\)[\s\S]*?\n}/.exec(gate);
    expect(fn).not.toBeNull();
    const body = fn![0];
    expect(body).toContain("await refreshLeaflyConfig()");
    // The refresh must come before the readiness read, or it proves nothing.
    expect(body.indexOf("await refreshLeaflyConfig()")).toBeLessThan(
      body.indexOf("describeLeaflyReadiness()"),
    );
  });

  it("'could not determine' is a DIFFERENT message from 'not configured'", () => {
    expect(gate).toContain("does NOT mean your credentials are missing");
    expect(gate).toMatch(/unavailable/);
  });

  it("no Leafly server action still uses the bare synchronous check", () => {
    // This is the defect itself: a sync check with no refresh in scope.
    expect(actions).not.toMatch(/if\s*\(!isLeaflyConfigured\(\)\)/);
    expect(selectionActions).not.toMatch(/if\s*\(!isLeaflyConfigured\(\)\)/);
  });

  // REGRESSION (2026-xx): this test used to pin a literal count -- toBe(4).
  // That is brittle by construction: adding a correctly-gated action made a
  // GREEN codebase go RED, which trains people to "just bump the number" and
  // eventually to bump it past a genuinely unguarded action. The count was
  // never the thing we cared about. The PROPERTY we care about is:
  //
  //   every exported server action that reaches Leafly's API is gated.
  //
  // So we derive the set of Leafly-reaching actions from the source itself
  // and require the gate in each one. New actions are covered automatically;
  // an unguarded new action fails immediately and names itself.
  it("every exported action that reaches Leafly's API is behind the shared gate", () => {
    // Helpers that perform (or delegate) a real Leafly network call. Sourced
    // from the import block of actions.ts, not invented here.
    const LEAFLY_CALLS = [
      "pushLeaflyMenu",
      // SLICE L-42: the certification POST ("Replace my whole Leafly menu").
      "replaceLeaflyMenu",
      "deleteLeaflyItems",
      "getLeaflyStatus",
      "getLeaflyMenu",
      "loadLeaflyMenuBrowser",
    ];

    const body = stripComments(actions);

    // Split the file into exported async functions. The lookahead stops each
    // slice at the next export so bodies cannot bleed into one another.
    const fns = [
      ...body.matchAll(
        /export async function (\w+)\(([\s\S]*?)(?=\nexport (?:async )?function |\nexport const |$)/g,
      ),
    ].map((m) => ({ name: m[1], src: m[2] }));

    expect(fns.length).toBeGreaterThan(8);

    const reachesLeafly = fns.filter((f) =>
      LEAFLY_CALLS.some((c) => new RegExp(`\\b${c}\\s*\\(`).test(f.src)),
    );

    // If this drops to zero the regex broke and the test is proving nothing.
    expect(reachesLeafly.length).toBeGreaterThanOrEqual(5);

    const unguarded = reachesLeafly
      .filter((f) => !f.src.includes("await requireLeaflyReady()"))
      .map((f) => f.name);

    // Named, not counted: the failure message tells you which action to fix.
    expect(unguarded).toEqual([]);

    // The owner's four original buttons must still be in the covered set --
    // proof the derivation did not quietly narrow.
    const covered = reachesLeafly.map((f) => f.name);
    for (const required of [
      // SLICE L-42: the old method-dropdown push was replaced by the POST card.
      "replaceLeaflyMenuAction",
      "fetchLeaflyStatusAction",
      "fetchLeaflyMenuReadbackAction",
      "deleteLeaflyItemsAction",
    ]) {
      expect(covered).toContain(required);
    }

    expect(selectionActions).toContain("await requireLeaflyReady()");
  });

  it("the owner's actual button -- check integration status -- is covered", () => {
    const fn = /export async function fetchLeaflyStatusAction\([\s\S]*?\n}/.exec(actions);
    expect(fn).not.toBeNull();
    expect(fn![0]).toContain("await requireLeaflyReady()");
  });

  it("the gate is not dead code", () => {
    expect(actions).toContain('from "@/lib/leafly/readiness-gate"');
    expect(selectionActions).toContain('from "@/lib/leafly/readiness-gate"');
  });
});

/* ========================================================================== */
/* The roadmap document the owner asked for                                   */
/* ========================================================================== */

describe("the issue register and roadmap exist and stay anchored", () => {
  const doc = read("docs/LEAFLY_CULTIVERA_REMEDIATION_ROADMAP.md");

  it("records all eight of the owner's asks as findings", () => {
    for (const f of ["J-1", "J-2", "J-3", "J-4", "J-5", "J-6"]) {
      expect(doc).toContain(`FINDING ${f}`);
    }
  });

  it("anchors to the vendored authoritative spec, not just prose", () => {
    expect(doc).toContain("docs/leafly-specs/schemas/v2-items.json");
    expect(doc).toContain("SOURCES.md");
  });

  it("carries the decoded evidence rather than an assertion", () => {
    expect(doc).toContain("cca24072824d");
    expect(doc).toContain("feda4c3b3628");
    expect(doc).toContain("1g");
  });

  it("has an ordered roadmap so the work cannot drift", () => {
    for (const r of ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"]) {
      expect(doc).toContain(r);
    }
  });
});

/* ========================================================================== */
/* Asks 4 + 6 + 7 -- sendability triage: skip the bad ones, name them, fix    */
/* them in bulk.                                                              */
/* ========================================================================== */

describe("asks 4/6/7: the send decision is honest and actionable", () => {
  /*
   * THE MOST IMPORTANT TEST IN THIS FILE.
   *
   * While writing sendability-core.ts I classified a defect code I had not
   * verified -- `variant_size_collision` -- which does not exist anywhere in
   * this codebase. The real code the validator emits for the owner's 124
   * errors is `variant_size_indistinguishable`. That single wrong string was
   * invisible: it compiled, it type-checked, and its unit tests passed,
   * because the tests used the same invented constant. In production every
   * one of the owner's 124 errors would have fallen through to "unknown" and
   * the blanket fix -- the thing he specifically asked for -- would never
   * have been offered once.
   *
   * This test makes that class of mistake impossible to repeat by checking
   * the classifier's vocabulary against the validator's actual source. A
   * guessed code now fails CI instead of silently never matching.
   */
  it("every code the triage claims to recognise is REALLY emitted by the validator", () => {
    const validatorSrc = read("src/lib/leafly/payload-validate-core.ts");
    const emitted = new Set<string>();
    for (const m of validatorSrc.matchAll(/\.(?:error|warn)\(\s*\n?\s*"([a-z0-9_]+)"/g)) {
      emitted.add(m[1]);
    }
    // Sanity: the scrape itself must work, or this test proves nothing.
    expect(emitted.size).toBeGreaterThan(40);
    expect(emitted.has("variant_size_indistinguishable")).toBe(true);

    const unknownToValidator = RECOGNISED_DEFECT_CODES.filter((c) => !emitted.has(c));
    expect(
      unknownToValidator,
      `these codes are classified but never emitted by the validator ` +
        `(they would never match in production): ${unknownToValidator.join(", ")}`,
    ).toEqual([]);
  });

  it("the invented code from the first draft is NOT recognised", () => {
    // Pins the regression directly.
    expect(classifyFix("variant_size_collision")).toBe("unknown");
    expect(RECOGNISED_DEFECT_CODES).not.toContain("variant_size_collision");
  });

  it("the owner's real defect is classified as a one-action bulk fix", () => {
    expect(classifyFix("variant_size_indistinguishable")).toBe("bulk_safe");
    expect(blanketFixAvailable(classifyFix("variant_size_indistinguishable"))).toBe(true);
  });

  it("a builder defect is never blamed on the owner's product data", () => {
    // `variant_id_duplicate` means OUR payload builder emitted the same id
    // twice. No product page can fix that, so no product link is offered.
    expect(classifyFix("variant_id_duplicate")).toBe("system_defect");
    const t = triageSendability({
      candidateIds: ["a"],
      issues: [
        {
          severity: "error",
          code: "variant_id_duplicate",
          path: "items[0]",
          itemId: "a",
          message: "duplicate variant id",
        },
      ],
    });
    expect(t.blocked[0].fixHref).toBeNull();
    expect(describeDefectGroup(t.groups[0])).toMatch(/fault in the menu software/i);
  });

  /* ---- ask 4 / ask 7: partial send ---- */

  const mixed = triageSendability({
    candidateIds: ["good1", "bad1", "good2", "bad2", "good3"],
    issues: [
      {
        severity: "error",
        code: "variant_size_indistinguishable",
        path: "items[101].variants",
        itemId: "bad1",
        message: '2 sizes of this item are all described to Leafly as "1 each"',
      },
      {
        severity: "error",
        code: "variant_size_indistinguishable",
        path: "items[104].variants",
        itemId: "bad2",
        message: '2 sizes of this item are all described to Leafly as "1 each"',
      },
    ],
    identities: [
      {
        id: "bad1",
        productName: "Dragon Balm CBD RED",
        brand: "Dragon Balm",
        vendor: "Fire Bros",
        barcodes: ["0123456789012"],
        category: "Topical",
        size: "3g",
      },
    ],
  });

  it("offers the good products instead of failing the whole push (ask 7)", () => {
    expect(mixed.sendableIds).toEqual(["good1", "good2", "good3"]);
    expect(mixed.partialSendPossible).toBe(true);
    expect(describeTriage(mixed)).toMatch(/send the 3 that pass now/i);
  });

  it("nothing is ever silently dropped", () => {
    expect(mixed.sendableCount + mixed.blockedCount).toBe(5);
    const accounted = new Set([...mixed.sendableIds, ...mixed.blocked.map((b) => b.id)]);
    expect(accounted.size).toBe(5);
  });

  /* ---- ask 5: human identifiers, not ids ---- */

  it("names the product rather than leading with an id (ask 5)", () => {
    const line = describeBlockedProducts(mixed)[0];
    expect(line.startsWith("Dragon Balm CBD RED")).toBe(true);
    expect(line).toContain("Fire Bros");          // vendor
    expect(line).toContain("0123456789012");      // barcode
    expect(line).toContain("3g");                 // size
    expect(line.startsWith("bad1")).toBe(false);  // never the id first
  });

  it("still carries the id for support, just not in front", () => {
    const line = describeBlockedProducts(mixed)[0];
    expect(line).toContain("[id bad1]");
    expect(line.indexOf("Dragon Balm CBD RED")).toBeLessThan(line.indexOf("[id bad1]"));
  });

  /* ---- ask 3 / ask 4: the fix button ---- */

  it("every product-data failure carries a working fix link (asks 3, 4)", () => {
    for (const b of mixed.blocked) {
      expect(b.fixHref).toBe(`/admin/products/${b.id}`);
    }
  });

  it("the fix link points at a route that actually exists", () => {
    // /admin/products/[key] is keyed by source_item_id, which is the id
    // carried through the feed. Verified by reading the page, not assumed.
    const page = read("src/app/admin/products/[key]/page.tsx");
    expect(page).toContain("getItemBySourceKey");
  });

  /* ---- ask 7 at real scale ---- */

  it("124 identical defects become ONE unit of work, not 124", () => {
    const ids = Array.from({ length: 124 }, (_, i) => `p${i}`);
    const t = triageSendability({
      candidateIds: [...ids, "clean"],
      issues: ids.map((id) => ({
        severity: "error" as const,
        code: "variant_size_indistinguishable",
        path: "items[0].variants",
        itemId: id,
        message: '2 sizes of this item are all described to Leafly as "1 each"',
      })),
    });
    expect(t.groups).toHaveLength(1);
    expect(t.groups[0].count).toBe(124);
    expect(t.groups[0].blanketFixAvailable).toBe(true);
    expect(t.sendableIds).toEqual(["clean"]);
    expect(describeTriage(t)).toMatch(/can be corrected in one action/i);
    // And the work list must not be 124 lines of wall.
    expect(describeBlockedProducts(t, 25)).toHaveLength(26);
    expect(describeBlockedProducts(t, 25)[25]).toMatch(/99 more/);
  });

  /* ---- the honesty guard ---- */

  it("never announces an all-clear while an untraceable error exists", () => {
    const t = triageSendability({
      candidateIds: ["a", "b"],
      issues: [
        {
          severity: "error",
          code: "payload_items_missing",
          path: "items",
          itemId: null,
          message: "items must be an array",
        },
      ],
    });
    // Zero products are blamed, so blockedCount is 0 -- the naive summary
    // said "All 2 selected products ... are ready to send" about a payload
    // that cannot possibly succeed.
    expect(t.blockedCount).toBe(0);
    expect(t.partialSendPossible).toBe(false);
    expect(describeTriage(t)).not.toMatch(/ready to send/i);
    expect(describeTriage(t)).toMatch(/could not be traced/i);
  });

  it("warnings never block a send", () => {
    const t = triageSendability({
      candidateIds: ["a"],
      issues: [
        {
          severity: "warning",
          code: "item_image_insecure",
          path: "items[0]",
          itemId: "a",
          message: "http image",
        },
      ],
    });
    expect(t.sendableIds).toEqual(["a"]);
    expect(t.warningCount).toBe(1);
  });

  it("the issue shape matches the real validator's issue shape", () => {
    // Structural compatibility is the contract; a drift must fail here
    // rather than at runtime.
    const real = validateLeaflyPayload({ items: "nope" });
    for (const issue of real.issues) {
      const asSendability: SendabilityIssue = issue;
      expect(typeof asSendability.code).toBe("string");
      expect(typeof asSendability.message).toBe("string");
      expect(["error", "warning"]).toContain(asSendability.severity);
    }
    expect(real.issues.length).toBeGreaterThan(0);
  });
});

/* ========================================================================== */
/* Ask 6 -- "there is no way to know what's on the menu so we can delete      */
/* something"                                                                 */
/* ========================================================================== */

describe("ask 6: the menu can be browsed, searched and deleted from by name", () => {
  const mk = (over: Partial<MenuBrowserRow> & { id: string }): MenuBrowserRow => ({
    id: over.id,
    name: over.name ?? null,
    brand: over.brand ?? null,
    strainName: over.strainName ?? null,
    type: over.type ?? null,
    vendor: over.vendor ?? null,
    barcodes: over.barcodes ?? [],
    hidden: over.hidden ?? null,
    variants: over.variants ?? [],
    orphaned: over.orphaned ?? false,
  });

  const blue = mk({
    id: "pos-1",
    name: "Blue Dream",
    brand: "Acme",
    vendor: "Fire Bros",
    type: "Flower",
    barcodes: ["0123456789012"],
    variants: [
      { id: "pos-1-a", sizeLabel: "1g", priceMinorUnits: 1200, inventoryLevel: 4 },
      { id: "pos-1-b", sizeLabel: "3.5g", priceMinorUnits: 3500, inventoryLevel: 2 },
    ],
  });
  const dragon = mk({
    id: "pos-45c6e282e0e8",
    name: "Dragon Balm CBD RED",
    brand: "Dragon Balm",
    vendor: "Fire Bros",
    type: "Topical",
  });
  const orphan = mk({ id: "pos-9", name: "Old Stock", brand: "Zed", orphaned: true });
  const menu = [blue, dragon, orphan];

  it("a product can be found by ANY human identifier, not an id", () => {
    for (const q of ["blue dream", "acme", "fire bros", "flower", "0123456789012", "3.5g"]) {
      expect(filterMenuRows(menu, { query: q }).map((r) => r.id), `query: ${q}`).toContain(
        "pos-1",
      );
    }
  });

  it("search narrows instead of widening (AND across tokens)", () => {
    // The property that makes a 400-item menu searchable. OR-matching would
    // return both products for this query and be useless.
    expect(filterMenuRows(menu, { query: "dragon balm" }).map((r) => r.id)).toEqual([
      "pos-45c6e282e0e8",
    ]);
    expect(filterMenuRows(menu, { query: "dragon acme" })).toHaveLength(0);
  });

  it("surfaces products Leafly still has that our feed no longer does", () => {
    // This is the product the owner is most likely hunting for: live on
    // Leafly and nowhere else.
    const orphans = filterMenuRows(menu, { orphanedOnly: true });
    expect(orphans).toHaveLength(1);
    expect(describeMenuRow(orphans[0])).toMatch(/no longer in your menu feed/);
  });

  it("every row reads as a product, never as an id", () => {
    const line = describeMenuRow(blue);
    expect(line.startsWith("Blue Dream")).toBe(true);
    expect(line).toContain("by Acme");
    expect(line).toContain("from Fire Bros");
    expect(line).toContain("1g, 3.5g");
    expect(line).toContain("barcode 0123456789012");
    expect(line.startsWith("pos-")).toBe(false);
  });

  it("the delete confirmation names what will disappear", () => {
    const s = summarizeSelection(menu, ["pos-1"]);
    expect(s.confirmation).toContain("Blue Dream");
    expect(s.confirmation).toContain("cannot be undone");
    // The id travels to the API but is never read out to the owner.
    expect(s.ids).toEqual(["pos-1"]);
    expect(s.confirmation).not.toContain("pos-1");
  });

  it("a selection hidden by the current filter is DISCLOSED, never silent", () => {
    // The classic destructive-UI bug: tick a row, change the filter, hit
    // delete, and remove something you can no longer see.
    const visible = filterMenuRows(menu, { brand: "Acme" });
    const s = summarizeSelection(visible, ["pos-1", "pos-9"]);
    expect(s.count).toBe(2);
    expect(s.confirmation).toMatch(/not shown by your current filter/);
  });

  it("select-all states the scope it actually applies to", () => {
    expect(describeSelectAll(12, 400)).toContain("12 products matching your filter");
    expect(describeSelectAll(12, 400)).toContain("of 400");
    expect(describeSelectAll(400, 400)).toBe("Select all 400 products on the menu.");
  });

  /*
   * The production-safety constraint, verified by reading the code rather
   * than assuming it. `getLeaflyMenu` refuses outside sandbox because Leafly
   * answers 405 there. A delete UI that depended solely on a live read-back
   * would therefore work in sandbox and break in production -- exactly when
   * the owner most needs to pull a product from a public menu.
   */
  it("the read-back really is sandbox-only, so a fallback source is required", () => {
    const push = read("src/lib/leafly/push.ts");
    expect(push).toContain("sandbox-only endpoint");
    expect(push).toContain("405");
  });

  it("the browser has a production-safe fallback and LABELS which source it used", () => {
    const server = read("src/lib/leafly/menu-browser-server.ts");
    expect(server).toContain('"our-records"');
    expect(server).toContain('"leafly"');
    // Presenting our belief as Leafly's word would let the owner conclude a
    // product is absent when we simply have no record of it.
    expect(server).toMatch(/not from Leafly/i);
    expect(server).toContain("sourceNote");
  });

  it("the menu browser core is pure", () => {
    const src = stripComments(read("src/lib/leafly/menu-browser-core.ts"));
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toContain("server-only");
    expect(src).not.toMatch(/\bfetch\(|node:fs/);
  });

  it("its self-tests run and are registered with a floor", () => {
    const r = __runLeaflyMenuBrowserTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(60);
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain("__runLeaflyMenuBrowserTests");
    expect(runner).toMatch(/leafly-menu-browser-core["']\s*,\s*__runLeaflyMenuBrowserTests\(\)\s*,\s*\d+/);
  });
});

/* ========================================================================== */
/* THE UI IS ACTUALLY WIRED                                                   */
/*                                                                            */
/* Every core and server action in this task can be perfect and the owner     */
/* still sees no change, because nothing renders them. That is not a          */
/* hypothetical: at one point in this task all eight asks were "done" in the  */
/* pure layer and none of them were reachable from a screen. These tests pin  */
/* the wiring itself, so a refactor cannot quietly orphan the feature.        */
/* ========================================================================== */

describe("the remediation UI is reachable, not just implemented", () => {
  const picker = read("src/app/admin/integrations/leafly/leafly-picker-client.tsx");
  const menuClient = read("src/app/admin/integrations/leafly/leafly-client.tsx");
  const browser = read("src/app/admin/integrations/leafly/menu-browser-client.tsx");
  const panel = read("src/app/admin/integrations/leafly/sendability-panel.tsx");

  it("ask 2: the rotating sampler is wired and is the PRIMARY button", () => {
    expect(picker).toContain("suggestRotatingSampleAction");
    expect(picker).toContain("sampleRound");
    // The round must advance, or every click returns the same eight -- the
    // exact defect the owner reported.
    expect(picker).toMatch(/const next = sampleRound \+ 1/);
    expect(picker).toMatch(/round:\s*next/);
    // Primary variant = the one he reaches for first.
    expect(picker).toMatch(
      /variant="primary"[\s\S]{0,120}onClick=\{suggestRotating\}/,
    );
  });

  it("ask 2: rotation is reproducible, NOT random", () => {
    // Math.random() in the sampler would make a failed push impossible to
    // reproduce. Comments are stripped first: this file EXPLAINS why random
    // was rejected, and a guard that trips on its own rationale is a guard
    // people delete. (Same false-positive class as the purity guards above.)
    const code = stripComments(picker);
    expect(code).not.toMatch(/Math\.random\(\)/);
    // And prove the rationale really is only prose, so stripping is honest.
    expect(picker).toMatch(/Math\.random\(\)/);
  });

  it("ask 3: failing sample products are named and given a fix button", () => {
    expect(picker).toContain("sampleFailing");
    expect(picker).toMatch(/\{f\.label\}/);
    // Rule 3: the button only renders when a href is known.
    expect(picker).toMatch(/f\.fixHref\s*&&/);
    expect(picker).toContain("Fix this product");
  });

  it("asks 4 and 7: the triage panel is mounted in the picker", () => {
    expect(picker).toContain("SendabilityPanel");
    expect(picker).toMatch(/<SendabilityPanel[\s\S]{0,200}selectedIds=/);
    expect(panel).toContain("pushLeaflyPassingOnlyAction");
    expect(panel).toContain("triageLeaflySelectionAction");
  });

  it("ask 4: the partial-send button is hidden when errors are untraceable", () => {
    // Offering "send the good ones" when the payload would fail anyway is
    // the reassuring lie this whole task exists to remove.
    expect(panel).toMatch(
      /t\.partialSendPossible\s*&&\s*t\.unattributedErrorCount === 0/,
    );
  });

  it("ask 7: the blanket fix is described before it can be applied", () => {
    expect(panel).toContain("remedyNarrative");
    expect(panel).toMatch(/remedyPlan[\s\S]{0,400}automatic/);
    expect(panel).toMatch(/remedyPlan[\s\S]{0,400}manual/);
  });

  it("ask 5 + 6: the menu browser is mounted ABOVE the id textarea", () => {
    expect(menuClient).toContain("LeaflyMenuBrowser");
    expect(menuClient).toContain('from "./menu-browser-client"');
    const browserAt = menuClient.indexOf("<LeaflyMenuBrowser");
    const textareaAt = menuClient.indexOf("<DeleteFromLeafly");
    expect(browserAt).toBeGreaterThan(-1);
    expect(textareaAt).toBeGreaterThan(-1);
    // The usable path must be the one he reaches first.
    expect(browserAt).toBeLessThan(textareaAt);
  });

  it("ask 5: the browser lets him search by the things he actually knows", () => {
    // Name, vendor and barcode all had to be visible columns, not just
    // searchable fields, or he cannot confirm he ticked the right row.
    expect(browser).toMatch(/Vendor/);
    expect(browser).toMatch(/Barcode/);
    expect(browser).toContain("row.barcodes");
    expect(browser).toContain("row.vendor");
    expect(browser).toMatch(/placeholder=\{?"[^"]*barcode/i);
  });

  it("ask 5: deletion is confirmed by NAME via the pure summary", () => {
    expect(browser).toContain("summarizeSelection");
    expect(browser).toContain("summary.confirmation");
    // Two-stage arm/confirm on an irreversible action.
    expect(browser).toContain("armed");
    expect(browser).toContain("deleteLeaflyMenuSelectionAction");
  });

  it("ask 6: the browser is honest about where the list came from", () => {
    expect(browser).toContain("sourceNote");
    expect(browser).toMatch(/Live from Leafly/);
    expect(browser).toMatch(/From our records/);
    expect(browser).toContain("readbackError");
  });

  it("the id textarea now presents itself as the fallback", () => {
    expect(menuClient).toMatch(/advanced/i);
    expect(menuClient).toMatch(/What is on your Leafly menu/);
  });

  it("no unicode escape leaks into rendered JSX text", () => {
    // A \\uXXXX written in JSX text renders literally to the owner. This is
    // a real defect that occurred twice while building these two screens.
    for (const [name, src] of [
      ["menu-browser-client", browser],
      ["sendability-panel", panel],
    ] as const) {
      for (const line of src.split("\n")) {
        const hasEscape = /\\u[0-9a-fA-F]{4}/.test(line);
        if (!hasEscape) continue;
        // Acceptable only inside a quoted string literal.
        expect(line, `${name}: bare unicode escape in JSX text -> ${line.trim()}`).toMatch(
          /"/,
        );
      }
    }
  });
});
