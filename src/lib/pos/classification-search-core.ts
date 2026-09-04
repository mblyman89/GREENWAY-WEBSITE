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
  LIMIT_BUCKET_LABELS,
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

/**
 * SLICE 18D — the two lanes the register can show and filter by.
 *
 * Named identically to the shop's `ClassificationFilterKind` on purpose, but
 * declared HERE rather than imported: `src/app/pos/SaleFlow.tsx` imports
 * nothing from `@/lib/menu/*` (recon F9), and the register must not start
 * depending on the storefront to render its own chips. The two stay in step
 * because both derive from the same `sales-limits-core` predicates and the same
 * `LimitBucket` union — not because one imports the other.
 */
export type PosClassificationKind = "low_thc_liquid" | "otherwise_taken";

/** Stable lane order. Not data-dependent, so chips never reshuffle mid-shift. */
export const POS_CLASSIFICATION_KINDS: readonly PosClassificationKind[] = [
  "low_thc_liquid",
  "otherwise_taken",
] as const;

/**
 * Short chip labels. A register chip is a TOUCH TARGET on a crowded row
 * (SaleFlow chip row, recon F8), so the label has to stay short enough to read
 * at a glance during a queue. The full statutory phrasing rides in the title
 * attribute via POS_CLASSIFICATION_TITLES.
 */
export const POS_CLASSIFICATION_LABELS: Record<PosClassificationKind, string> = {
  low_thc_liquid: "Low-THC",
  otherwise_taken: "Suppository",
};

/**
 * The full statutory description, taken from LIMIT_BUCKET_LABELS in
 * sales-limits-core — the module BOTH the register and the shop already depend
 * on. Deriving instead of retyping means a wording change happens in one place
 * and the register cannot drift from the limit meter's own vocabulary.
 */
export const POS_CLASSIFICATION_TITLES: Record<PosClassificationKind, string> = {
  low_thc_liquid: LIMIT_BUCKET_LABELS.low_thc_liquid,
  otherwise_taken: LIMIT_BUCKET_LABELS.otherwise_taken,
};

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

// ───────────────────────────────────────────────────────────────────────────
// SLICE 18D — register VISIBILITY: does this product wear a marker, and can a
// budtender narrow the grid to just these?
// ───────────────────────────────────────────────────────────────────────────

/**
 * True when the register would ACTUALLY route this product to the given
 * bucket.
 *
 * The single most important function added by 18D, and the reason a tile
 * marker can be trusted. It asks the very same predicates the limit meter asks
 * (`qualifiesAsLowThcLiquid` / `qualifiesAsOtherwiseTaken`), so a "Low-THC"
 * marker on a tile and the 200 mg allowance the meter applies are ONE fact
 * read twice — never two opinions that can drift apart.
 *
 * Deliberately NOT keyed off the raw booleans. A drink flagged `lowThcLiquid`
 * with 10 mg per can, or no mg at all, still counts against the 72 oz liquid
 * limit; marking it "Low-THC" would tell a budtender they may sell far more
 * than they legally may.
 */
export function productHasClassification(
  product: ClassifiableProduct,
  kind: PosClassificationKind,
): boolean {
  const line = toLine(product);
  return kind === "low_thc_liquid"
    ? qualifiesAsLowThcLiquid(line)
    : qualifiesAsOtherwiseTaken(line);
}

/**
 * Every lane this product belongs to, in the stable POS_CLASSIFICATION_KINDS
 * order. EMPTY for an ordinary product.
 *
 * Empty means RENDER NOTHING — never "this is an ordinary product". Recon F1
 * is why: the flags are optional on PosMenuProduct so an offline register
 * running a bundle cached before intake classification looks byte-for-byte
 * identical to a product genuinely in no lane. For `otherwiseTaken` that
 * absence is the PERMISSIVE direction (sale-flow-core.ts:113-116). Silence is
 * the only honest output; a negative claim would be a statement we cannot
 * support.
 */
export function productClassifications(
  product: ClassifiableProduct,
): PosClassificationKind[] {
  return POS_CLASSIFICATION_KINDS.filter((kind) =>
    productHasClassification(product, kind),
  );
}

/** One chip: the lane, its label, and how many products in the bundle qualify. */
export type PosClassificationChip = {
  kind: PosClassificationKind;
  label: string;
  title: string;
  count: number;
};

/**
 * The classification chips to show for a given menu, busiest lane never
 * reordered — POS_CLASSIFICATION_KINDS order is fixed so muscle memory holds
 * from shift to shift, unlike the category chips which sort by count.
 *
 * A lane with ZERO qualifying products is omitted entirely. A chip that
 * filters to an empty grid is a promise of inventory the store does not have,
 * and a budtender who taps it learns nothing except that the register lies.
 * Returns [] when nothing qualifies, so the caller renders no row at all.
 */
export function posClassificationChips(
  products: readonly ClassifiableProduct[],
): PosClassificationChip[] {
  const counts = new Map<PosClassificationKind, number>();
  for (const product of products) {
    for (const kind of productClassifications(product)) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  return POS_CLASSIFICATION_KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0).map(
    (kind) => ({
      kind,
      label: POS_CLASSIFICATION_LABELS[kind],
      title: POS_CLASSIFICATION_TITLES[kind],
      count: counts.get(kind) ?? 0,
    }),
  );
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

  // ── SLICE 18D — register visibility ──────────────────────────────────────

  const DRINK = { category: "edible-liquid", lowThcLiquid: true, unitThcMg: 4 };
  const SUPP = { category: "topical", otherwiseTaken: true, unitsPerPackage: 6 };
  const FLOWER = { category: "flower" };

  // productHasClassification delegates to the register's predicates.
  ok(productHasClassification(DRINK, "low_thc_liquid"), "drink is low-thc");
  ok(!productHasClassification(DRINK, "otherwise_taken"), "drink is not a suppository");
  ok(productHasClassification(SUPP, "otherwise_taken"), "suppository is otherwise-taken");
  ok(!productHasClassification(FLOWER, "low_thc_liquid"), "flower is not low-thc");
  ok(!productHasClassification(FLOWER, "otherwise_taken"), "flower is not otherwise-taken");

  // The register's RULES decide, never the raw flag. Each of these carries the
  // flag and must still be refused, because the limit meter would refuse it.
  ok(
    !productHasClassification({ category: "edible-liquid", lowThcLiquid: true }, "low_thc_liquid"),
    "flag without mg is not low-thc",
  );
  ok(
    !productHasClassification(
      { category: "edible-liquid", lowThcLiquid: true, unitThcMg: 5 },
      "low_thc_liquid",
    ),
    "over 4 mg is not low-thc",
  );
  ok(
    !productHasClassification(
      { category: "edible-liquid", lowThcLiquid: true, unitThcMg: 0 },
      "low_thc_liquid",
    ),
    "zero mg is not low-thc",
  );
  ok(
    !productHasClassification(
      { category: "flower", lowThcLiquid: true, unitThcMg: 4 },
      "low_thc_liquid",
    ),
    "wrong bucket is not low-thc",
  );
  ok(
    !productHasClassification({ category: "flower", otherwiseTaken: true }, "otherwise_taken"),
    "flagged flower is refused by the guard rail",
  );
  ok(
    !productHasClassification(
      { category: "topical", otherwiseTaken: "true" as unknown as boolean },
      "otherwise_taken",
    ),
    "string 'true' does not earn a marker",
  );
  // Exactly 4 mg is INSIDE the allowance (<=, not <).
  ok(
    productHasClassification(
      { category: "edible-liquid", lowThcLiquid: true, unitThcMg: 4 },
      "low_thc_liquid",
    ),
    "4 mg exactly still qualifies",
  );

  // A stale bundle (flags absent entirely) must read as NO classification, and
  // must never be mistaken for a positive statement either way.
  ok(productClassifications({ category: "edible-liquid" }).length === 0, "stale drink is silent");
  ok(productClassifications({ category: "topical" }).length === 0, "stale topical is silent");
  ok(productClassifications({}).length === 0, "empty product is silent");

  // productClassifications: order is the stable lane order, not input order.
  {
    const both = { category: "topical", otherwiseTaken: true, lowThcLiquid: true, unitThcMg: 4 };
    const lanes = productClassifications(both);
    ok(lanes.length === 2, "dual-flagged product reports both lanes");
    ok(lanes[0] === "low_thc_liquid", "stable order: low_thc_liquid first");
    ok(lanes[1] === "otherwise_taken", "stable order: otherwise_taken second");
    ok(productClassifications(DRINK).length === 1, "drink reports exactly one lane");
    ok(productClassifications(FLOWER).length === 0, "flower reports no lane");
  }

  // Chips: derived from the bundle, empty lanes omitted, counts accurate.
  {
    ok(posClassificationChips([]).length === 0, "no products means no chips");
    ok(posClassificationChips([FLOWER, FLOWER]).length === 0, "ordinary menu shows no chips");

    const chips = posClassificationChips([FLOWER, DRINK, DRINK, SUPP]);
    ok(chips.length === 2, "both lanes present when both have stock");
    ok(chips[0]?.kind === "low_thc_liquid", "chip order is the stable lane order");
    ok(chips[0]?.count === 2, "low-thc count is 2");
    ok(chips[1]?.kind === "otherwise_taken", "second chip is otherwise_taken");
    ok(chips[1]?.count === 1, "suppository count is 1");

    // A lane with no qualifying stock is OMITTED, never rendered at zero.
    const only = posClassificationChips([FLOWER, SUPP]);
    ok(only.length === 1, "only the stocked lane gets a chip");
    ok(only[0]?.kind === "otherwise_taken", "and it is the right one");
    ok(
      only.every((c) => c.count > 0),
      "no chip is ever rendered with a zero count",
    );

    // A flagged-but-non-qualifying product must not conjure a chip.
    const bogus = posClassificationChips([
      { category: "edible-liquid", lowThcLiquid: true, unitThcMg: 99 },
    ]);
    ok(bogus.length === 0, "a non-qualifying product creates no chip");

    // A dual-flagged product counts once in EACH lane it truly belongs to.
    const dual = posClassificationChips([
      { category: "topical", otherwiseTaken: true, lowThcLiquid: true, unitThcMg: 4 },
    ]);
    ok(dual.length === 2, "dual-flagged product appears in both lanes");
    ok(dual.every((c) => c.count === 1), "counted once per lane, not twice in one");
  }

  // Labels and titles: short chip label, full statutory phrasing in the title,
  // and the title must come from the shared limit vocabulary.
  {
    for (const kind of POS_CLASSIFICATION_KINDS) {
      const label = POS_CLASSIFICATION_LABELS[kind];
      const title = POS_CLASSIFICATION_TITLES[kind];
      ok(label.trim().length > 0, `${kind} has a label`);
      ok(label.length <= 12, `${kind} label stays short enough for a chip`);
      ok(title.trim().length > 0, `${kind} has a title`);
      ok(title.length > label.length, `${kind} title is more descriptive than its label`);
      ok(title === LIMIT_BUCKET_LABELS[kind], `${kind} title derives from LIMIT_BUCKET_LABELS`);
    }
    ok(POS_CLASSIFICATION_KINDS.length === 2, "exactly two register lanes");
    ok(
      POS_CLASSIFICATION_LABELS.low_thc_liquid !== POS_CLASSIFICATION_LABELS.otherwise_taken,
      "the two labels are distinguishable",
    );
    // The register must never promise a quantity on a chip; the limit meter
    // owns that arithmetic and it depends on the whole cart.
    ok(
      !Object.values(POS_CLASSIFICATION_LABELS).some((l) => /\d/.test(l)),
      "no chip label states a number",
    );
  }

  return { passed };
}
