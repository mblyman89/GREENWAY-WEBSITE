/**
 * src/lib/compliance/sample-product-type-core.ts  (H16b Samples Slice A)
 *
 * PURE mapping: an accepted email-intake sample LINE → the sample ledger's
 * three-value product type (useable | concentrate | infused), so accepting a
 * manifest can seed the correct `trade_sample_events` incoming row.
 *
 * WHY three values: `trade_sample_events.product_type` drives the per-unit SIZE
 * caps in WAC 314-55-096(1)(e):
 *   • useable      → ≤ 3.5 g / unit   (flower-family: flower, preroll, trim…)
 *   • concentrate  → ≤ 1 g / unit     (concentrate, RSO, cartridge, vape…)
 *   • infused      → ≤ 100 mg / unit, ≤ 10 mg THC / serving  (edibles, tincture,
 *                                     topical, AND any infused flower/preroll)
 *
 * DESIGN: we do NOT re-parse LCB inventory-type strings here. We reuse the
 * H16b-9 website-category resolver (the single source of truth for classifying
 * an LCB type + product name) and then COLLAPSE its fine-grained website
 * category onto the coarse three-value sample type. Reusing the resolver keeps
 * one classification brain and means the smell-jar / mix-infused / sample-jar
 * name-reading already lands correctly.
 *
 * CONSERVATIVE RULE for infused: any infused form (infused-flower, infused
 * preroll/blunt/pack, edibles, tincture, topical) maps to `infused` — the
 * STRICTEST 100 mg / 10 mg-THC size cap — so a mis-read can never let an
 * over-size infused unit through as useable.
 *
 * Non-cannabis website categories (accessories, merch, paraphernalia) are not
 * a lawful cannabis sample product and return null (the caller SKIPS them).
 */
import type { SampleProductType } from "@/lib/compliance/trade-samples-core";
import { heuristicWebsiteCategory } from "@/lib/inventory/website-category-resolver";

/** Website categories that are USEABLE cannabis (flower family, ≤ 3.5 g cap). */
const USEABLE_CATEGORIES = new Set<string>([
  "flower",
  "popcorn-bud",
  "preroll",
  "blunt",
  "preroll-pack",
  "trim",
]);

/** Website categories that are CONCENTRATE (≤ 1 g cap). */
const CONCENTRATE_CATEGORIES = new Set<string>([
  "concentrate",
  "rso",
  "cartridge",
  "disposable-cartridge",
]);

/** Website categories that are INFUSED (≤ 100 mg / ≤ 10 mg THC cap). */
const INFUSED_CATEGORIES = new Set<string>([
  "infused-flower",
  "infused-preroll",
  "infused-blunt",
  "infused-preroll-pack",
  "edible-solid",
  "edible-liquid",
  "tincture",
  "topical",
]);

/** Website categories that are NOT a cannabis sample product (skip). */
const NON_CANNABIS_CATEGORIES = new Set<string>(["accessories", "merch", "paraphernalia"]);

/**
 * Collapse a resolved WEBSITE category onto the three-value sample product type.
 * Returns null for non-cannabis or unmapped categories (caller skips the line).
 */
export function sampleProductTypeFromWebsiteCategory(
  websiteCategory: string | null | undefined,
): SampleProductType | null {
  if (!websiteCategory) return null;
  const c = websiteCategory.toLowerCase();
  if (NON_CANNABIS_CATEGORIES.has(c)) return null;
  if (USEABLE_CATEGORIES.has(c)) return "useable";
  if (CONCENTRATE_CATEGORIES.has(c)) return "concentrate";
  if (INFUSED_CATEGORIES.has(c)) return "infused";
  return null;
}

/**
 * Map an accepted sample line (its LCB inventory_type + product name) to the
 * sample ledger product type. Uses the H16b-9 resolver so name-reading (smell
 * jar, mix-infused, sample jar) stays consistent. Returns null when the line is
 * not a lawful cannabis sample product (caller skips it).
 */
export function sampleProductTypeForLine(args: {
  productName: string | null | undefined;
  inventoryType: string | null | undefined;
}): SampleProductType | null {
  const website = heuristicWebsiteCategory(args.productName, args.inventoryType);
  return sampleProductTypeFromWebsiteCategory(website);
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE module).
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

export function __runSampleProductTypeCoreTests(): string {
  // Direct website-category collapse.
  assert(sampleProductTypeFromWebsiteCategory("flower") === "useable", "flower → useable");
  assert(sampleProductTypeFromWebsiteCategory("popcorn-bud") === "useable", "popcorn → useable");
  assert(sampleProductTypeFromWebsiteCategory("preroll") === "useable", "preroll → useable");
  assert(sampleProductTypeFromWebsiteCategory("trim") === "useable", "trim → useable");
  assert(sampleProductTypeFromWebsiteCategory("concentrate") === "concentrate", "concentrate → concentrate");
  assert(sampleProductTypeFromWebsiteCategory("rso") === "concentrate", "rso → concentrate");
  assert(sampleProductTypeFromWebsiteCategory("cartridge") === "concentrate", "cartridge → concentrate");
  assert(sampleProductTypeFromWebsiteCategory("disposable-cartridge") === "concentrate", "disposable → concentrate");
  assert(sampleProductTypeFromWebsiteCategory("edible-solid") === "infused", "edible-solid → infused");
  assert(sampleProductTypeFromWebsiteCategory("edible-liquid") === "infused", "edible-liquid → infused");
  assert(sampleProductTypeFromWebsiteCategory("tincture") === "infused", "tincture → infused");
  assert(sampleProductTypeFromWebsiteCategory("topical") === "infused", "topical → infused");
  assert(sampleProductTypeFromWebsiteCategory("infused-flower") === "infused", "infused-flower → infused");
  assert(sampleProductTypeFromWebsiteCategory("infused-preroll") === "infused", "infused-preroll → infused");
  assert(sampleProductTypeFromWebsiteCategory("infused-preroll-pack") === "infused", "infused-pack → infused");

  // Non-cannabis + unmapped + empty → null (skip).
  assert(sampleProductTypeFromWebsiteCategory("accessories") === null, "accessories → skip");
  assert(sampleProductTypeFromWebsiteCategory("merch") === null, "merch → skip");
  assert(sampleProductTypeFromWebsiteCategory("paraphernalia") === null, "paraphernalia → skip");
  assert(sampleProductTypeFromWebsiteCategory(null) === null, "null → skip");
  assert(sampleProductTypeFromWebsiteCategory("something-weird") === null, "unknown → skip");

  // End-to-end from an LCB type + name (exercises the resolver reuse).
  assert(
    sampleProductTypeForLine({ productName: "Blue Dream 3.5g", inventoryType: "Usable Cannabis" }) === "useable",
    "Usable Cannabis → useable",
  );
  assert(
    sampleProductTypeForLine({ productName: "Live Resin", inventoryType: "Concentrate for Inhalation" }) === "concentrate",
    "Concentrate → concentrate",
  );
  assert(
    sampleProductTypeForLine({ productName: "Watermelon Gummies", inventoryType: "Solid Edible" }) === "infused",
    "Solid Edible → infused",
  );
  assert(
    sampleProductTypeForLine({ productName: "Infused Preroll 1g", inventoryType: "Cannabis Mix Infused" }) === "infused",
    "Mix Infused preroll → infused",
  );
  // Smell/sniff jar: per the merged H16b-9 rule, ANY smell/sniff jar is treated
  // as useable flower (owner decision) → useable.
  assert(
    sampleProductTypeForLine({ productName: "OG Kush Smell Jar", inventoryType: "Sample Jar" }) === "useable",
    "smell jar → useable",
  );
  assert(
    sampleProductTypeForLine({ productName: "Live Rosin Sniff Jar", inventoryType: "Sample Jar" }) === "useable",
    "sniff jar (H16b-9: always useable) → useable",
  );
  // A NON-smell "Sample Jar" reads the underlying form: a concentrate jar → concentrate.
  assert(
    sampleProductTypeForLine({ productName: "Live Rosin Sample Jar", inventoryType: "Sample Jar" }) === "concentrate",
    "concentrate sample jar → concentrate",
  );

  return "OK: sample-product-type-core tests passed";
}
