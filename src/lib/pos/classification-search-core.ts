/**
 * SLICE 18B — the budtender half: make specially-classified products FINDABLE
 * at the register.
 *
 * Michael's directive: "make sure there is an easy path for customers and
 * budtenders to filter and sort and find these products."
 *
 * THE GAP THIS CLOSES (recon F7):
 * the register bundle ALREADY carries all four classification flags
 * (api/pos/menu/route.ts:175-180, PosMenuProduct at sale-flow-core.ts:97-115),
 * but the only text a budtender can search is:
 *
 *   sale-flow-core.ts:303
 *   const hay = `${p.name} ${p.brand ?? ""} ${p.category} ${p.variantLabel ?? ""}`
 *
 * So a budtender who types "suppository" finds nothing unless the vendor
 * happened to put that word in the product name. The register HAS the fact and
 * offers no path to it. That is the whole defect.
 *
 * THE FIX, KEPT ADDITIVE:
 * this module contributes extra SEARCH KEYWORDS derived from a product's
 * classification. It does not change how search works, does not add UI, does
 * not add state, and does not touch the bundle format. searchProducts() simply
 * appends these tokens to its haystack, so every existing query behaves
 * EXACTLY as before (proven by the "no keywords for an ordinary product" tests
 * below and by the untouched sale-flow-core self-tests).
 *
 * WHY DELEGATE TO THE REGISTER'S PREDICATES:
 * same rule as the shop facet — a keyword is only attached when the register
 * would ACTUALLY route the product to that bucket. Typing "low thc" must not
 * surface a drink that is flagged but has no per-unit mg, because that product
 * still counts against the 72 oz liquid limit. The words a budtender searches
 * and the bucket the meter uses have to be the same fact.
 *
 * Pure: no I/O, no React, no server-only. Self-tested below and registered in
 * the pure-selftest sweep.
 */
import {
  qualifiesAsLowThcLiquid,
  qualifiesAsOtherwiseTaken,
  type LimitCartLine,
} from "@/lib/compliance/sales-limits-core";

/**
 * The minimum shape this module needs. Deliberately narrower than
 * PosMenuProduct so the module stays usable from anywhere (and so the tests do
 * not have to build a whole product).
 */
export type ClassifiableProduct = {
  category?: string | null;
  lowThcLiquid?: boolean | null;
  unitThcMg?: number | null;
  otherwiseTaken?: boolean | null;
  unitsPerPackage?: number | null;
};

/**
 * Search keywords for a qualifying low-THC beverage.
 *
 * Multiple spellings on purpose: a budtender under pressure types whatever
 * comes to mind first. "low thc", "lowthc", "low-thc" all tokenize differently,
 * and searchProducts() requires EVERY token to hit the haystack, so we include
 * the separate words too ("low", "thc") — that is what makes the multi-word
 * query "low thc" match.
 */
export const LOW_THC_SEARCH_KEYWORDS: readonly string[] = [
  "low-thc",
  "lowthc",
  "low",
  "thc",
  "beverage",
  "beverages",
  "drink",
  "drinks",
] as const;

/**
 * Search keywords for a qualifying "otherwise taken into the body" product.
 *
 * "suppository" is the practical word; the statutory phrase is included so an
 * owner or compliance reviewer can find them with the language of the WAC.
 */
export const OTHERWISE_TAKEN_SEARCH_KEYWORDS: readonly string[] = [
  "suppository",
  "suppositories",
  "otherwise",
  "taken",
] as const;

/** Adapt a product to the LimitCartLine the register's predicates expect. */
function toLine(product: ClassifiableProduct): LimitCartLine {
  return {
    category: product.category ?? null,
    quantity: 1,
    lowThcLiquid: product.lowThcLiquid ?? null,
    unitThcMg: product.unitThcMg ?? null,
    otherwiseTaken: product.otherwiseTaken ?? null,
    unitsPerPackage: product.unitsPerPackage ?? null,
  };
}

/**
 * The classification keywords for one product — EMPTY for an ordinary product,
 * which is what keeps this additive: an unclassified product's haystack is
 * byte-for-byte what it was before SLICE 18B.
 */
export function classificationSearchKeywords(product: ClassifiableProduct): string[] {
  const line = toLine(product);
  const out: string[] = [];
  if (qualifiesAsLowThcLiquid(line)) out.push(...LOW_THC_SEARCH_KEYWORDS);
  if (qualifiesAsOtherwiseTaken(line)) out.push(...OTHERWISE_TAKEN_SEARCH_KEYWORDS);
  return out;
}

/**
 * The keywords as a single lowercase string ready to append to a search
 * haystack. Returns "" for an ordinary product so callers can append
 * unconditionally without introducing stray whitespace semantics.
 */
export function classificationSearchText(product: ClassifiableProduct): string {
  const keywords = classificationSearchKeywords(product);
  return keywords.length === 0 ? "" : keywords.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure self-tests (throw on failure).
// ─────────────────────────────────────────────────────────────────────────────

export function __runPosClassificationSearchTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`classification-search-core: ${msg}`);
    passed += 1;
  };

  // An ORDINARY product contributes nothing. This is the additive guarantee.
  ok(classificationSearchKeywords({ category: "flower" }).length === 0, "flower has no keywords");
  ok(classificationSearchText({ category: "flower" }) === "", "flower text is empty");
  ok(classificationSearchKeywords({}).length === 0, "empty product has no keywords");
  ok(classificationSearchKeywords({ category: "edible-liquid" }).length === 0, "plain liquid has no keywords");

  // A qualifying low-THC beverage gets the beverage words.
  {
    const drink = { category: "edible-liquid", lowThcLiquid: true, unitThcMg: 4 };
    const kw = classificationSearchKeywords(drink);
    ok(kw.includes("low-thc"), "qualifying drink has low-thc");
    ok(kw.includes("low") && kw.includes("thc"), "separate words so 'low thc' matches");
    ok(kw.includes("beverage") && kw.includes("drink"), "beverage/drink synonyms");
    ok(!kw.includes("suppository"), "a drink is not a suppository");
    ok(classificationSearchText(drink).includes("beverage"), "text form contains beverage");
  }

  // A qualifying suppository gets the suppository words.
  {
    const supp = { category: "topical", otherwiseTaken: true, unitsPerPackage: 6 };
    const kw = classificationSearchKeywords(supp);
    ok(kw.includes("suppository"), "qualifying suppository has suppository");
    ok(kw.includes("suppositories"), "plural spelling too");
    ok(kw.includes("otherwise") && kw.includes("taken"), "statutory phrase words");
    ok(!kw.includes("beverage"), "a suppository is not a beverage");
  }

  // NON-qualifying products get NOTHING — the register's rules decide, not the
  // raw boolean. These are the assertions that stop the register from lying.
  ok(
    classificationSearchKeywords({ category: "edible-liquid", lowThcLiquid: true }).length === 0,
    "flag without mg → no keywords",
  );
  ok(
    classificationSearchKeywords({ category: "edible-liquid", lowThcLiquid: true, unitThcMg: 5 }).length === 0,
    "over 4 mg → no keywords",
  );
  ok(
    classificationSearchKeywords({ category: "edible-liquid", lowThcLiquid: true, unitThcMg: 0 }).length === 0,
    "zero mg → no keywords",
  );
  ok(
    classificationSearchKeywords({ category: "flower", lowThcLiquid: true, unitThcMg: 4 }).length === 0,
    "wrong bucket → no keywords",
  );
  ok(
    classificationSearchKeywords({ category: "flower", otherwiseTaken: true }).length === 0,
    "flower flagged otherwise-taken → no keywords (guard rail)",
  );
  ok(
    classificationSearchKeywords({
      category: "topical",
      otherwiseTaken: "true" as unknown as boolean,
    }).length === 0,
    "string 'true' does not earn keywords",
  );

  // A product carrying BOTH flags is a data error; the register resolves it to
  // otherwise_taken (the tighter bucket). Keywords for both are still correct
  // here because search is about FINDING, not about limits — a budtender
  // looking for either word should surface the problem product.
  {
    const both = {
      category: "topical",
      otherwiseTaken: true,
      lowThcLiquid: true,
      unitThcMg: 4,
    };
    const kw = classificationSearchKeywords(both);
    ok(kw.includes("suppository"), "dual-flagged product is findable as a suppository");
    // `topical` buckets as liquid_edible, so the low-THC predicate also passes.
    ok(kw.includes("low-thc"), "dual-flagged product is also findable as low-thc");
  }

  // Every keyword must be lowercase and whitespace-free, because
  // searchProducts() lowercases the query and splits it on whitespace — an
  // uppercase or multi-word keyword could never be matched by a single token.
  {
    const all = [...LOW_THC_SEARCH_KEYWORDS, ...OTHERWISE_TAKEN_SEARCH_KEYWORDS];
    ok(all.every((k) => k === k.toLowerCase()), "all keywords are lowercase");
    ok(all.every((k) => !/\s/.test(k)), "no keyword contains whitespace");
    ok(all.every((k) => k.length > 0), "no empty keyword");
  }

  return { passed };
}
