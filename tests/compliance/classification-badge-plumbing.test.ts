/**
 * SLICE 18C — PLUMBING.
 *
 * The core tests prove the badge's LOGIC. These prove it is actually RENDERED,
 * on every surface a shopper touches, following the DOH pill's precedent.
 *
 * A logic-only suite would stay green while the pill was computed and thrown
 * away — which is EXACTLY the pre-existing defect this slice repairs: the
 * product detail page has always called withDohCompliance() and never rendered
 * the result. That bug survived because no test asserted the render.
 *
 * TECHNIQUE NOTE — comments are stripped before asserting. A source-reading
 * test that matches its own explanatory prose is a false positive (SLICE 18-0
 * mutant #15, and again in 18A/18B). Every assertion runs against CODE ONLY,
 * and each block carries an anti-vacuity guard so a stripper failing open
 * cannot silently pass the suite.
 *
 * 18B's mutation round #1 also taught that text-matching alone is insufficient:
 * a mutant kept the identifiers and broke the VALUE. So the behavioural
 * agreements live in menu-classification-badge-core.test.ts, and this file
 * pins only what a source read can honestly prove — that the wiring exists.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { lineBucket, lineThcMg, lineUnits } from "@/lib/compliance/sales-limits-core";

const repoRoot = process.cwd();
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // {/* jsx */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */
    .replace(/^\s*\/\/.*$/gm, " "); // // line
}

/** Assert the stripper produced usable code, not an empty string. */
function guardStripped(code: string, original: string, mustContain: string) {
  expect(code).toContain(mustContain);
  expect(code.length).toBeGreaterThan(original.length / 3);
}

const CARD_VISUAL = "src/components/menu/ProductCardVisual.tsx";
const PDP_PANEL = "src/components/menu/ProductDetailPurchasePanel.tsx";
const PDP_PAGE = "src/app/menu/products/[id]/page.tsx";
const BADGE_CORE = "src/lib/menu/menu-classification-badge-core.ts";
const FILTER_CORE = "src/lib/menu/menu-classification-filter-core.ts";
const SELFTESTS = "scripts/compliance/run-pure-selftests.ts";

describe("18C plumbing — the card pill lane", () => {
  it("ProductCardVisual derives the pills from the shared core", () => {
    const original = read(CARD_VISUAL);
    const code = stripComments(original);
    guardStripped(code, original, "ProductCardVisual");
    expect(code).toContain("@/lib/menu/menu-classification-badge-core");
    expect(code).toContain("classificationPillsForItem(item)");
  });

  it("renders one pill per earned lane, with its tone tokens and title", () => {
    const code = stripComments(read(CARD_VISUAL));
    const block = code.slice(code.indexOf("classificationPills.map"));
    expect(block.length).toBeGreaterThan(0);
    // Tone comes from the core, so a recolour there reaches the card.
    expect(block).toContain("pill.tone.border");
    expect(block).toContain("pill.tone.text");
    expect(block).toContain("pill.tone.dot");
    expect(block).toContain("pill.label");
    // The FULL label must be available to hover / assistive tech.
    expect(block).toContain("title={pill.title}");
    // Keyed by lane, so React can reconcile two pills.
    expect(block).toContain("key={pill.kind}");
  });

  it("sits in the SAME lane as the DOH pill (Michael's rule: with the other pills)", () => {
    const code = stripComments(read(CARD_VISUAL));
    const dohAt = code.indexOf("dohPill.label");
    const classAt = code.indexOf("classificationPills.map");
    const cannabinoidAt = code.indexOf("showCannabinoids && cannabinoids");
    expect(dohAt).toBeGreaterThan(-1);
    expect(classAt).toBeGreaterThan(-1);
    expect(cannabinoidAt).toBeGreaterThan(-1);
    // Directly after the DOH pill, and BEFORE the cannabinoid block, so it
    // renders independently of whether cannabinoid data exists.
    expect(classAt).toBeGreaterThan(dohAt);
    expect(classAt).toBeLessThan(cannabinoidAt);
  });

  it("reuses the DOH pill's shape so the lane stays visually consistent", () => {
    const code = stripComments(read(CARD_VISUAL));
    const block = code.slice(
      code.indexOf("classificationPills.map"),
      code.indexOf("showCannabinoids && cannabinoids"),
    );
    for (const fragment of ["rounded-full border", "bg-black/45", "backdrop-blur-sm", "h-1.5 w-1.5"]) {
      expect(block).toContain(fragment);
    }
  });

  it("covers BOTH card surfaces through the one shared visual", () => {
    // ProductCard (menu grid) and RelatedProductCard (the PDP rail) both
    // render ProductCardVisual, so one edit reaches both. If either stopped
    // using it, the pill would silently vanish from that surface.
    for (const path of [
      "src/components/menu/ProductCard.tsx",
      "src/components/menu/RelatedProductCard.tsx",
    ]) {
      const code = stripComments(read(path));
      expect(code).toContain("ProductCardVisual");
    }
  });
});

describe("18C plumbing — the PDP allowance disclosure", () => {
  it("the purchase panel derives disclosures from the shared core", () => {
    const original = read(PDP_PANEL);
    const code = stripComments(original);
    guardStripped(code, original, "ProductDetailPurchasePanel");
    expect(code).toContain("@/lib/menu/menu-classification-badge-core");
    expect(code).toContain("classificationDisclosuresForItem(item)");
  });

  it("renders the headline, the statutory figure, the body and the citation", () => {
    const code = stripComments(read(PDP_PANEL));
    const block = code.slice(code.indexOf("allowanceDisclosures.length > 0"));
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain("disclosure.headline");
    expect(block).toContain("disclosure.limit");
    expect(block).toContain("disclosure.body");
    expect(block).toContain("disclosure.citation");
    expect(block).toContain("key={disclosure.kind}");
  });

  it("renders NOTHING when the product earned no lane", () => {
    const code = stripComments(read(PDP_PANEL));
    // The whole block must be gated, or an ordinary product would show an
    // empty bordered box.
    expect(code).toMatch(/allowanceDisclosures\.length > 0 \?/);
  });

  it("places the disclosure ABOVE the price and the add-to-cart button", () => {
    const code = stripComments(read(PDP_PANEL));
    const disclosureAt = code.indexOf("allowanceDisclosures.length > 0");
    const priceAt = code.indexOf("formatMinorCurrency(activeUnitPrice)");
    const cartAt = code.indexOf("Add to Cart");
    expect(disclosureAt).toBeGreaterThan(-1);
    expect(priceAt).toBeGreaterThan(-1);
    expect(cartAt).toBeGreaterThan(-1);
    // A shopper should read why this product is counted differently BEFORE
    // they commit, not discover it later in the cart meter.
    expect(disclosureAt).toBeLessThan(priceAt);
    expect(disclosureAt).toBeLessThan(cartAt);
  });

  it("does NOT hand-roll the wording or the figures", () => {
    const code = stripComments(read(PDP_PANEL));
    // Any of these appearing here would be a second definition of truth,
    // free to drift from the statute and from the register.
    expect(code).not.toMatch(/200\s*mg/i);
    expect(code).not.toMatch(/10\s*units/i);
    expect(code).not.toMatch(/WAC\s*314/i);
    expect(code).not.toMatch(/RECREATIONAL_LIMITS|MEDICAL_LIMITS/);
  });

  it("still passes all four classification flags to the cart (18C is additive)", () => {
    const code = stripComments(read(PDP_PANEL));
    for (const field of ["lowThcLiquid", "unitThcMg", "otherwiseTaken", "unitsPerPackage"]) {
      expect(code).toContain(field);
    }
  });
});

/**
 * MUTATION ROUND #1 FOUND A HOLE HERE.
 *
 * The test above asserts the four field NAMES appear in the panel. A mutant
 * that kept the key and nulled the VALUE --
 *
 *     lowThcLiquid: item.lowThcLiquid ?? null,   ->   lowThcLiquid: null,
 *
 * -- SURVIVED, because "lowThcLiquid" is still right there in the source. This
 * is the identical failure mode 18B's mutation round #1 exposed: a text match
 * proves a word exists, never that a value is correct.
 *
 * The consequence of that mutant is not cosmetic. It is the SLICE 16 defect
 * returning: the cart meter would measure a low-THC beverage against the 72 oz
 * liquid_edible allowance instead of the 200 mg THC allowance, so the meter on
 * screen would disagree with the till.
 *
 * So these tests do not read for words. They EXTRACT the real object literal
 * the panel hands to addItem(), EVALUATE it against a fixture item, and push
 * the result through the same lineBucket() the cart meter uses. The assertion
 * is the bucket the shopper is actually measured against. Null the value and
 * the bucket changes and the test fails.
 */
describe("18C plumbing \u2014 the add-to-cart payload BEHAVES (not just reads) right", () => {
  /** Extract the object literal passed to addItem() by brace balancing. */
  function extractAddItemPayload(source: string): string {
    const call = source.indexOf("addItem({");
    expect(call).toBeGreaterThan(-1);
    const objStart = source.indexOf("{", call + "addItem(".length - 1);
    let depth = 0;
    for (let i = objStart; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return source.slice(objStart, i + 1);
      }
    }
    throw new Error("addItem payload braces never balanced");
  }

  /** Evaluate that literal with a real item and read the resulting cart line. */
  function payloadFor(source: string, item: Record<string, unknown>) {
    const literal = extractAddItemPayload(source);
    const build = new Function(
      "item",
      "selectedVariant",
      "basePrice",
      "quantity",
      `return (${literal});`,
    ) as (
      i: unknown,
      v: unknown,
      b: number,
      q: number,
    ) => Record<string, unknown>;
    return build(
      item,
      { id: "v1", label: "1 ea", inventoryLevel: "high" },
      1200,
      1,
    );
  }

  // A beverage the owner classified at intake: 4 mg per can, the statutory
  // ceiling. categoryToBucket() must see a real liquid slug for the carve-out
  // to be available at all.
  const LOW_THC_DRINK = {
    id: "p1",
    name: "Low-THC Seltzer",
    brand: "Brand",
    category: "edible-liquid",
    filterCategories: ["edible-liquid"],
    strainType: null,
    lowThcLiquid: true,
    unitThcMg: 4,
    otherwiseTaken: null,
    unitsPerPackage: null,
  };

  const SUPPOSITORY = {
    id: "p2",
    name: "Suppository 10ct",
    brand: "Brand",
    category: "topical",
    filterCategories: ["topical"],
    strainType: null,
    lowThcLiquid: null,
    unitThcMg: null,
    otherwiseTaken: true,
    unitsPerPackage: 10,
  };

  it("carries the low-THC classification through to the 200 mg bucket", () => {
    const line = payloadFor(read(PDP_PANEL), LOW_THC_DRINK);

    // The values themselves survived the trip.
    expect(line.lowThcLiquid).toBe(true);
    expect(line.unitThcMg).toBe(4);

    // ANTI-VACUITY: the payload really is the panel's, not an empty object.
    expect(line.productId).toBe("p1");
    expect(Object.keys(line).length).toBeGreaterThan(8);

    // THE POINT: the meter measures this line against the 200 mg allowance.
    expect(lineBucket(line as never)).toBe("low_thc_liquid");
    expect(lineBucket(line as never)).not.toBe("liquid_edible");
    expect(lineThcMg(line as never)).toBe(4);
  });

  it("carries the suppository classification through to the ten-unit bucket", () => {
    const line = payloadFor(read(PDP_PANEL), SUPPOSITORY);

    expect(line.otherwiseTaken).toBe(true);
    expect(line.unitsPerPackage).toBe(10);
    expect(line.productId).toBe("p2");

    expect(lineBucket(line as never)).toBe("otherwise_taken");
    expect(lineBucket(line as never)).not.toBe("liquid_edible");
    // One package of ten consumes the ENTIRE daily allowance.
    expect(lineUnits(line as never)).toBe(10);
  });

  /**
   * THE MUTANT, PINNED. We apply M15's exact edit to a copy of the source in
   * memory and prove the harness above notices. This is a test OF THE TEST:
   * if someone later weakens payloadFor() into a no-op, this fails too.
   */
  it("detects a nulled flag value \u2014 the mutation a text match missed", () => {
    const real = read(PDP_PANEL);

    const m15 = real.replace(
      "lowThcLiquid: item.lowThcLiquid ?? null,",
      "lowThcLiquid: null,",
    );
    expect(m15).not.toBe(real); // the simulated edit actually applied

    const mutatedLine = payloadFor(m15, LOW_THC_DRINK);
    expect(mutatedLine.lowThcLiquid).toBeNull();
    // The regression made visible: back into the 72 oz liquid bucket.
    expect(lineBucket(mutatedLine as never)).toBe("liquid_edible");

    const m15b = real.replace(
      "otherwiseTaken: item.otherwiseTaken ?? null,",
      "otherwiseTaken: null,",
    );
    expect(m15b).not.toBe(real);
    expect(lineBucket(payloadFor(m15b, SUPPOSITORY) as never)).toBe("liquid_edible");
  });

  it("passes the flags through untouched rather than re-deriving them", () => {
    // A product the owner never classified must arrive as null, never as a
    // guess the panel invented. Silence stays silence.
    const unreviewed = { ...LOW_THC_DRINK, lowThcLiquid: null, unitThcMg: null };
    const line = payloadFor(read(PDP_PANEL), unreviewed);
    expect(line.lowThcLiquid).toBeNull();
    expect(line.unitThcMg).toBeNull();
    // Fail-safe direction: unclassified stays in the stricter 72 oz bucket.
    expect(lineBucket(line as never)).toBe("liquid_edible");
  });
});

describe("18C plumbing — the detail page chip row (and the DOH gap it repairs)", () => {
  it("renders the classification pills on the detail page too", () => {
    const original = read(PDP_PAGE);
    const code = stripComments(original);
    guardStripped(code, original, "ProductDetailPage");
    expect(code).toContain("@/lib/menu/menu-classification-badge-core");
    expect(code).toContain("classificationPillsForItem(item)");
    expect(code).toContain("classificationDetailPills.map");
  });

  /**
   * THE REPAIR. page.tsx has always run withDohCompliance() — its own comment
   * says the intent is "so the product page agrees with the menu card" — but
   * no PDP surface ever rendered the result. The registry read was paid for
   * and discarded, and a DOH product lost its pill on click.
   */
  it("finally renders the DOH pill the page was already computing", () => {
    const code = stripComments(read(PDP_PAGE));
    // The enrichment call that was previously wasted.
    expect(code).toContain("withDohCompliance");
    // And now the render that consumes it.
    expect(code).toContain("@/lib/menu/menu-doh-badge-core");
    expect(code).toContain("dohPillForItem(item)");
    expect(code).toContain("dohDetailPill");
    expect(code).toContain("dohDetailPill.label");
    expect(code).toContain("dohDetailPill.tone.border");
  });

  it("both detail pills use tone tokens from the cores, not literal colours", () => {
    const code = stripComments(read(PDP_PAGE));
    const start = code.indexOf("dohDetailPill ?");
    const end = code.indexOf("showProfilePill(detailCannabinoids.profile)");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = code.slice(start, end);
    expect(block).toContain("tone.border");
    expect(block).toContain("tone.text");
    expect(block).toContain("tone.dot");
    // No hand-picked hex in the chip row — the cores own colour.
    expect(block).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("keeps the pills in the existing chip row, before the profile pill", () => {
    const code = stripComments(read(PDP_PAGE));
    const dohAt = code.indexOf("dohDetailPill ?");
    const classAt = code.indexOf("classificationDetailPills.map");
    const profileAt = code.indexOf("showProfilePill(detailCannabinoids.profile)");
    expect(dohAt).toBeLessThan(classAt);
    expect(classAt).toBeLessThan(profileAt);
  });
});

describe("18C plumbing — the core is shared, pure and guarded by CI", () => {
  it("is registered in the pure self-test sweep with the anti-vacuity guard", () => {
    const original = read(SELFTESTS);
    const code = stripComments(original);
    guardStripped(code, original, "ALL PURE SELF-TESTS PASSED");
    expect(code).toContain("__runMenuClassificationBadgeTests");
    expect(code).toMatch(/__runMenuClassificationBadgeTests\(\);\s*if \(r\.passed < 1\)/);
  });

  /**
   * An allowlist rather than a blocklist. A blocklist can only catch impurity
   * it was told about; an allowlist fails closed on impurity nobody predicted.
   * (In 18B, the naive `not.toContain("server-only")` check was a false
   * positive generator because the module's own prose explains why it avoids
   * server-only.)
   */
  it("imports ONLY known-pure modules", () => {
    const PURE_ALLOWLIST = new Set([
      "@/lib/leafly/types",
      "@/lib/menu/menu-classification-filter-core",
      "@/lib/compliance/sales-limits-core",
    ]);
    const original = read(BADGE_CORE);
    const code = stripComments(original);
    guardStripped(code, original, "classificationPillsForItem");

    const specifiers: string[] = [];
    for (const re of [
      /\bimport\s[\s\S]*?\bfrom\s*["']([^"']+)["']/g,
      /\bimport\s*["']([^"']+)["']/g,
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
      /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    ]) {
      for (const m of code.matchAll(re)) specifiers.push(m[1]);
    }

    // Anti-vacuity: the badge MUST build on the filter core, or it stopped
    // sharing the register's definition of "qualifies".
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers).toContain("@/lib/menu/menu-classification-filter-core");

    for (const spec of specifiers) {
      expect(
        PURE_ALLOWLIST.has(spec),
        `${BADGE_CORE} imports "${spec}", which is not on the pure allowlist. ` +
          "This core must stay importable from client components, server " +
          "components and vitest alike.",
      ).toBe(true);
    }
  });

  it("carries no server-only, client-only or React dependency", () => {
    const code = stripComments(read(BADGE_CORE));
    // Match the DIRECTIVE shape (a lone string statement), not the bare word,
    // so identifiers and prose can never trip it.
    expect(code).not.toMatch(/^\s*["']server-only["']\s*;?\s*$/m);
    expect(code).not.toMatch(/^\s*["']use server["']\s*;?\s*$/m);
    expect(code).not.toMatch(/^\s*["']use client["']\s*;?\s*$/m);
    expect(code).not.toMatch(/\bfrom\s*["']react["']/);
  });

  /**
   * The badge must never re-test the flags itself. If it stopped delegating,
   * the card could advertise an allowance the register refuses to honour —
   * the single most important invariant in this slice.
   */
  it("delegates qualification instead of re-implementing it", () => {
    const code = stripComments(read(BADGE_CORE));
    expect(code).toContain("itemHasClassification");
    // No local re-derivation of the three-condition test.
    expect(code).not.toMatch(/lowThcLiquid\s*===\s*true/);
    expect(code).not.toMatch(/otherwiseTaken\s*===\s*true/);
    expect(code).not.toMatch(/unitThcMg\s*<=\s*\d/);
  });

  it("reads its figures from the statutory constants, never literals", () => {
    const code = stripComments(read(BADGE_CORE));
    expect(code).toContain("RECREATIONAL_LIMITS");
    expect(code).toContain("formatLimitAmount");
    // The formatter is what keeps a COUNT bucket from rendering as ounces.
    expect(code).toMatch(/formatLimitAmount\(\s*spec\.kind\s*,\s*RECREATIONAL_LIMITS\[/);
  });

  it("18C added NO migration and NO new menu field", () => {
    // The whole "additive" claim rests on the flags already riding on the
    // item — the same fact that made 18B additive.
    const liveMenu = stripComments(read("src/lib/pos/live-menu.ts"));
    expect(liveMenu).toMatch(/lowThcLiquid:\s*row\.low_thc_liquid/);
    expect(liveMenu).toMatch(/unitThcMg:\s*row\.unit_thc_mg/);
    expect(liveMenu).toMatch(/otherwiseTaken:\s*row\.otherwise_taken/);
    expect(liveMenu).toMatch(/unitsPerPackage:\s*row\.units_per_package/);
  });

  it("leaves 18B's filter core untouched by the badge", () => {
    // 18C must not have edited the filter to make the badge work; the badge
    // consumes it. If this fails, the slice stopped being additive.
    const filter = stripComments(read(FILTER_CORE));
    expect(filter).not.toContain("menu-classification-badge-core");
    expect(filter).not.toContain("CLASSIFICATION_PILL");
  });
});
