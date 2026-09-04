/**
 * SLICE 18B — the pure logic behind the Shop sidebar's dynamic **sales-limit
 * classification** filter (the "Product Type" facet).
 *
 * Michael's directive: "Our filters are dynamic and appear in the list when
 * there are products with those traits in the menu... make sure there is an
 * easy path for customers and budtenders to filter and sort and find these
 * products... I want this to be additive and not something new."
 *
 * So this module is a deliberate MIRROR of menu-doh-filter-core.ts — same
 * shape, same naming, same honesty rules — because that is the house pattern
 * for a compliance trait surfaced as a shop facet. Nothing here is a new
 * mechanism; it is the DOH facet's twin pointed at the SLICE 16/17 flags.
 *
 * WHY NO SERVER OVERLAY (the reason this slice is additive):
 * unlike DOH — which needed a medical_product_registry read — the four
 * classification fields ALREADY ride on every public menu item. SLICE 16/17 put
 * them there for the register:
 *
 *   live-menu.ts:93  lowThcLiquid:    row.low_thc_liquid    ?? null
 *   live-menu.ts:94  unitThcMg:       row.unit_thc_mg       ?? null
 *   live-menu.ts:98  otherwiseTaken:  row.otherwise_taken   ?? null
 *   live-menu.ts:99  unitsPerPackage: row.units_per_package ?? null
 *
 * There is therefore NO new DB read, NO new overlay, and NO migration in this
 * slice. The facet is pure derivation over data already in the browser.
 *
 * THE CENTRAL RULE — WE DO NOT RE-IMPLEMENT "QUALIFIES":
 * a product only earns a lane if the REGISTER would actually route it to that
 * bucket. Qualification is a three-condition test, not a boolean
 * (sales-limits-core.ts:613 and :638): the category must bucket as a liquid,
 * the flag must be LITERALLY true, and for low-THC a positive per-unit mg ≤ 4
 * must be present. A facet keyed on the raw boolean would advertise "Low-THC
 * Beverages" for a product the register still counts in the 72 oz bucket — the
 * website and the register would then disagree in public, which is exactly the
 * drift SLICE 18A's parity test exists to prevent.
 *
 * So we import the register's own predicates and adapt a menu item to the
 * LimitCartLine they expect. One source of truth, by construction.
 *
 * HONESTY — WHY THERE IS NO "UNCLASSIFIED" LANE:
 * types.ts:89-94 warns that, unlike lowThcLiquid, a null `otherwiseTaken` is
 * the PERMISSIVE direction — an unflagged suppository reads as an ordinary
 * topical. A "not a suppository" lane built from `!== true` would therefore
 * quietly include every product nobody has reviewed yet. The shop only ever
 * advertises what was AFFIRMATIVELY verified.
 *
 * This module is PURE (no "server-only", no DB, no React) so the client
 * browser (InteractiveMenuBrowser), the server, and vitest all share ONE
 * matcher — the same split as menu-doh-filter-core and menu-special-filters-core.
 */
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import {
  LIMIT_BUCKET_LABELS,
  LOW_THC_UNIT_MAX_MG,
  qualifiesAsLowThcLiquid,
  qualifiesAsOtherwiseTaken,
  type LimitCartLine,
} from "@/lib/compliance/sales-limits-core";

/**
 * The stable lane ids. These become URL tokens (`?classification=low-thc`), so
 * they are kebab-case and MUST stay stable — a shopper's shared link and a
 * budtender's bookmark both depend on them.
 */
export const CLASSIFICATION_FILTER_LOW_THC_ID = "low-thc";
export const CLASSIFICATION_FILTER_OTHERWISE_TAKEN_ID = "otherwise-taken";

/** The kinds of lane this facet can offer. */
export type ClassificationFilterKind = "low_thc_liquid" | "otherwise_taken";

/**
 * One selectable lane. `count` is how many CURRENTLY-qualifying items match,
 * which drives the honest, data-driven render: a lane with count 0 is never
 * built, so the sidebar section simply does not appear.
 */
export type ClassificationFilterOption = {
  id: string;
  label: string;
  kind: ClassificationFilterKind;
  count: number;
  /** Plain-language help for the shopper (why this lane exists). */
  help: string;
};

/**
 * Shopper-facing lane labels.
 *
 * These are intentionally SHORTER and plainer than LIMIT_BUCKET_LABELS (which
 * is owner/compliance wording like "Products otherwise taken into the body
 * (suppositories)"). A shop sidebar is not the place for a WAC citation. The
 * compliance wording is still reachable through `classificationBucketLabel()`
 * below, so the back office and the register keep their precise language while
 * customers get plain English.
 */
export const CLASSIFICATION_FILTER_LABELS: Record<ClassificationFilterKind, string> = {
  low_thc_liquid: "Low-THC Beverages",
  otherwise_taken: "Suppositories",
};

/** One-line shopper help per lane. Plain language, no medical claims. */
export const CLASSIFICATION_FILTER_HELP: Record<ClassificationFilterKind, string> = {
  low_thc_liquid: `Drinks packaged in single servings of ${LOW_THC_UNIT_MAX_MG} mg THC or less, so you can buy more of them in one visit.`,
  otherwise_taken: "Products taken into the body by a route other than smoking, eating, or applying to skin.",
};

/** The lane order the sidebar renders (stable, not data-dependent). */
export const CLASSIFICATION_FILTER_KINDS: readonly ClassificationFilterKind[] = [
  "low_thc_liquid",
  "otherwise_taken",
] as const;

/** Map a lane kind to its stable id. */
export function classificationFilterId(kind: ClassificationFilterKind): string {
  return kind === "low_thc_liquid"
    ? CLASSIFICATION_FILTER_LOW_THC_ID
    : CLASSIFICATION_FILTER_OTHERWISE_TAKEN_ID;
}

/**
 * Parse a lane id back to its kind (null for anything unrecognized).
 * Defensive: never throws, tolerates null/blank/whitespace, so a hand-edited
 * URL can only ever fail closed to "no filter".
 */
export function classificationKindFromId(
  id: string | null | undefined,
): ClassificationFilterKind | null {
  const wanted = (id ?? "").trim();
  if (wanted === CLASSIFICATION_FILTER_LOW_THC_ID) return "low_thc_liquid";
  if (wanted === CLASSIFICATION_FILTER_OTHERWISE_TAKEN_ID) return "otherwise_taken";
  return null;
}

/**
 * The precise compliance label for a lane, straight from the register's own
 * LIMIT_BUCKET_LABELS. Used by the back office and any owner-facing surface so
 * the shop, the register and the admin never invent separate vocabularies.
 */
export function classificationBucketLabel(kind: ClassificationFilterKind): string {
  return LIMIT_BUCKET_LABELS[kind];
}

/**
 * Adapt a public menu item to the LimitCartLine the register's predicates
 * expect. `quantity: 1` because we are asking a question about the PRODUCT
 * ("would one of these route to this bucket?"), not about a cart.
 *
 * Exported so tests — and any future caller — can prove the adapter itself is
 * faithful rather than trusting it silently.
 */
export function menuItemToLimitLine(
  item: Pick<
    GreenwayMenuItem,
    "category" | "lowThcLiquid" | "unitThcMg" | "otherwiseTaken" | "unitsPerPackage"
  >,
): LimitCartLine {
  return {
    category: item.category ?? null,
    quantity: 1,
    lowThcLiquid: item.lowThcLiquid ?? null,
    unitThcMg: item.unitThcMg ?? null,
    otherwiseTaken: item.otherwiseTaken ?? null,
    unitsPerPackage: item.unitsPerPackage ?? null,
  };
}

/**
 * True when the REGISTER would route this product to the given bucket.
 *
 * Delegates entirely to sales-limits-core so the shop can never drift from the
 * point of sale. This is the single most important function in the module.
 */
export function itemHasClassification(
  item: Pick<
    GreenwayMenuItem,
    "category" | "lowThcLiquid" | "unitThcMg" | "otherwiseTaken" | "unitsPerPackage"
  >,
  kind: ClassificationFilterKind,
): boolean {
  const line = menuItemToLimitLine(item);
  return kind === "low_thc_liquid"
    ? qualifiesAsLowThcLiquid(line)
    : qualifiesAsOtherwiseTaken(line);
}

/**
 * Derive the facet's lanes from the live menu items.
 *
 * Returns ONE lane per classification that actually has qualifying products,
 * in the stable CLASSIFICATION_FILTER_KINDS order. Returns an EMPTY array when
 * nothing qualifies — the honest empty state, so the sidebar section does not
 * appear at all. That is the dynamic contract Michael described, and it is
 * enforced here AND again in FilterMobile (belt and braces, matching DOH).
 *
 * Note there is deliberately no "umbrella" lane here (unlike DOH). DOH has an
 * umbrella because its per-category lanes are subdivisions of one verified
 * state. These two classifications are DIFFERENT statutory buckets that share
 * no parent — a combined "specially classified" lane would mix a beverage cap
 * with a suppository cap and mean nothing to a shopper. Fewer, truer lanes.
 */
export function resolveClassificationFilterOptions(
  items: readonly GreenwayMenuItem[],
): ClassificationFilterOption[] {
  const counts = new Map<ClassificationFilterKind, number>();

  for (const item of items) {
    for (const kind of CLASSIFICATION_FILTER_KINDS) {
      if (itemHasClassification(item, kind)) {
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
    }
  }

  const options: ClassificationFilterOption[] = [];
  for (const kind of CLASSIFICATION_FILTER_KINDS) {
    const count = counts.get(kind) ?? 0;
    if (count <= 0) continue;
    options.push({
      id: classificationFilterId(kind),
      label: CLASSIFICATION_FILTER_LABELS[kind],
      kind,
      count,
      help: CLASSIFICATION_FILTER_HELP[kind],
    });
  }
  return options;
}

/**
 * True when `item` passes the active classification filter. A null/blank id
 * means "no filter applied" (everything passes) — the same convention as
 * itemMatchesDohFilter, so the browser's filter pipeline reads uniformly.
 *
 * An UNRECOGNIZED id (junk in the URL) also passes everything rather than
 * silently emptying the grid: a shopper who lands on a mangled link should see
 * the menu, not an inexplicable "no products" wall.
 */
export function itemMatchesClassificationFilter(
  item: Pick<
    GreenwayMenuItem,
    "category" | "lowThcLiquid" | "unitThcMg" | "otherwiseTaken" | "unitsPerPackage"
  >,
  activeId: string | null | undefined,
): boolean {
  const kind = classificationKindFromId(activeId);
  if (!kind) return true;
  return itemHasClassification(item, kind);
}

/**
 * The public shop URL for a classification lane.
 *
 * Exists so the BACK OFFICE and the shop can never disagree about the link. The
 * 18A worklist uses this to send the owner from a product he just classified
 * straight to the customer-facing lane it now appears in — closing the loop
 * "I answered the question" → "here is what the customer sees".
 *
 * Kept in this core (not hardcoded in the admin page) for the same reason the
 * matcher lives here: one definition, shared by every caller.
 */
export function classificationShopHref(kind: ClassificationFilterKind): string {
  return `/menu?classification=${classificationFilterId(kind)}`;
}

/**
 * The lane a product belongs to, or null when the register would not route it
 * to any special bucket.
 *
 * Note the deliberate order: `otherwise_taken` is checked FIRST, mirroring
 * lineBucket() at sales-limits-core.ts:703-712, where a line carrying both
 * flags resolves to the item-counted bucket because ten units is the tighter
 * cap. If the shop reported the other lane for such a product, the owner would
 * be told a different story than the till enforces.
 */
export function classificationKindForItem(
  item: Pick<
    GreenwayMenuItem,
    "category" | "lowThcLiquid" | "unitThcMg" | "otherwiseTaken" | "unitsPerPackage"
  >,
): ClassificationFilterKind | null {
  if (itemHasClassification(item, "otherwise_taken")) return "otherwise_taken";
  if (itemHasClassification(item, "low_thc_liquid")) return "low_thc_liquid";
  return null;
}

/** Look a lane up by id (null when absent), for pill labels / validation. */
export function findClassificationFilterOption(
  options: readonly ClassificationFilterOption[],
  id: string | null | undefined,
): ClassificationFilterOption | null {
  const wanted = (id ?? "").trim();
  if (!wanted) return null;
  return options.find((o) => o.id === wanted) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure self-tests (throw on failure). Registered in the pure-selftest runner so
// the whole compliance battery guards this matcher — same convention as
// menu-doh-filter-core and menu-special-filters-core.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal menu item factory for the self-tests.
 *
 * NOTE the default category is "edible-liquid", NOT "drinks". Verified against
 * sales-limits-core.ts:304 + the LIQUID_CATEGORIES list at :343 — the liquid
 * slugs are `edible-liquid`, `tincture`, `topical`. There is no `drinks` slug.
 */
function testItem(over: Partial<GreenwayMenuItem> & { id: string }): GreenwayMenuItem {
  return {
    name: "Test Item",
    brand: "Test Brand",
    category: "edible-liquid",
    priceMinorUnits: 3000,
    ...over,
  } as GreenwayMenuItem;
}

/** A fully-qualifying low-THC beverage (all three conditions met). */
function goodDrink(id: string, over: Partial<GreenwayMenuItem> = {}): GreenwayMenuItem {
  return testItem({ id, category: "edible-liquid", lowThcLiquid: true, unitThcMg: 4, ...over });
}

/** A fully-qualifying suppository (flag true + liquid-bucketing category). */
function goodSupp(id: string, over: Partial<GreenwayMenuItem> = {}): GreenwayMenuItem {
  return testItem({ id, category: "topical", otherwiseTaken: true, unitsPerPackage: 6, ...over });
}

export function __runMenuClassificationFilterTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`menu-classification-filter-core: ${msg}`);
    passed += 1;
  };

  // ── id ↔ kind round-trips, and junk fails closed ──────────────────────────
  ok(classificationFilterId("low_thc_liquid") === CLASSIFICATION_FILTER_LOW_THC_ID, "id for low_thc_liquid");
  ok(
    classificationFilterId("otherwise_taken") === CLASSIFICATION_FILTER_OTHERWISE_TAKEN_ID,
    "id for otherwise_taken",
  );
  ok(classificationKindFromId(CLASSIFICATION_FILTER_LOW_THC_ID) === "low_thc_liquid", "parse low-thc id");
  ok(
    classificationKindFromId(CLASSIFICATION_FILTER_OTHERWISE_TAKEN_ID) === "otherwise_taken",
    "parse otherwise-taken id",
  );
  ok(classificationKindFromId("  low-thc  ") === "low_thc_liquid", "parse trims whitespace");
  ok(classificationKindFromId("nonsense") === null, "junk id → null");
  ok(classificationKindFromId("") === null, "blank id → null");
  ok(classificationKindFromId(null) === null, "null id → null");
  ok(classificationKindFromId(undefined) === null, "undefined id → null");
  // Ids are URL tokens; a change breaks shared links, so pin the literals.
  ok(CLASSIFICATION_FILTER_LOW_THC_ID === "low-thc", "low-thc id literal is stable");
  ok(CLASSIFICATION_FILTER_OTHERWISE_TAKEN_ID === "otherwise-taken", "otherwise-taken id literal is stable");

  // ── the adapter is faithful ───────────────────────────────────────────────
  {
    const line = menuItemToLimitLine(
      testItem({ id: "a", category: "edible-liquid", lowThcLiquid: true, unitThcMg: 3, unitsPerPackage: 4 }),
    );
    ok(line.quantity === 1, "adapter asks about ONE product");
    ok(line.category === "edible-liquid", "adapter carries category");
    ok(line.lowThcLiquid === true, "adapter carries lowThcLiquid");
    ok(line.unitThcMg === 3, "adapter carries unitThcMg");
    ok(line.unitsPerPackage === 4, "adapter carries unitsPerPackage");
    // Absent fields normalize to null, never undefined, so the predicates see a
    // consistent shape (undefined vs null has bitten us before).
    const bare = menuItemToLimitLine(testItem({ id: "b" }));
    ok(bare.lowThcLiquid === null, "absent lowThcLiquid → null");
    ok(bare.unitThcMg === null, "absent unitThcMg → null");
    ok(bare.otherwiseTaken === null, "absent otherwiseTaken → null");
    ok(bare.unitsPerPackage === null, "absent unitsPerPackage → null");
  }

  // ── itemHasClassification agrees with the REGISTER, not with the boolean ──
  ok(itemHasClassification(goodDrink("d1"), "low_thc_liquid"), "qualifying drink is low-THC");
  ok(!itemHasClassification(goodDrink("d1"), "otherwise_taken"), "a drink is not a suppository");
  ok(itemHasClassification(goodSupp("s1"), "otherwise_taken"), "qualifying suppository matches");
  ok(!itemHasClassification(goodSupp("s1"), "low_thc_liquid"), "a suppository is not a low-THC drink");

  // The three-condition test — each condition independently blocks the lane.
  ok(
    !itemHasClassification(testItem({ id: "x", category: "flower", lowThcLiquid: true, unitThcMg: 4 }), "low_thc_liquid"),
    "flower with the flag does NOT qualify (wrong bucket)",
  );
  ok(
    !itemHasClassification(testItem({ id: "x", category: "edible-liquid", lowThcLiquid: true }), "low_thc_liquid"),
    "flag true but NO mg does not qualify",
  );
  ok(
    !itemHasClassification(
      testItem({ id: "x", category: "edible-liquid", lowThcLiquid: true, unitThcMg: 5 }),
      "low_thc_liquid",
    ),
    "over 4 mg does not qualify",
  );
  ok(
    !itemHasClassification(
      testItem({ id: "x", category: "edible-liquid", lowThcLiquid: true, unitThcMg: 0 }),
      "low_thc_liquid",
    ),
    "zero mg does not qualify",
  );
  ok(
    !itemHasClassification(
      testItem({ id: "x", category: "edible-liquid", lowThcLiquid: false, unitThcMg: 4 }),
      "low_thc_liquid",
    ),
    "mg present but flag false does not qualify",
  );
  ok(
    !itemHasClassification(testItem({ id: "x", category: "flower", otherwiseTaken: true }), "otherwise_taken"),
    "flower flagged otherwise-taken does NOT qualify (guard rail)",
  );
  // The flag must be LITERALLY true (sales-limits-core.ts:634).
  ok(
    !itemHasClassification(
      testItem({ id: "x", category: "topical", otherwiseTaken: "true" as unknown as boolean }),
      "otherwise_taken",
    ),
    "string 'true' does not widen the allowance",
  );
  ok(
    !itemHasClassification(
      testItem({ id: "x", category: "edible-liquid", lowThcLiquid: 1 as unknown as boolean, unitThcMg: 4 }),
      "low_thc_liquid",
    ),
    "numeric 1 does not widen the allowance",
  );
  // An unclassified product earns nothing (no permissive lane).
  ok(!itemHasClassification(testItem({ id: "u" }), "low_thc_liquid"), "unclassified is not low-THC");
  ok(!itemHasClassification(testItem({ id: "u" }), "otherwise_taken"), "unclassified is not a suppository");

  // ── resolve: dynamic + honest ─────────────────────────────────────────────
  ok(resolveClassificationFilterOptions([]).length === 0, "empty menu → no options");
  ok(
    resolveClassificationFilterOptions([testItem({ id: "a" }), testItem({ id: "b", category: "flower" })]).length === 0,
    "no qualifying items → no options (section never renders)",
  );
  // A flagged-but-not-qualifying product must NOT conjure a lane. This is the
  // whole point of delegating to the register's predicates.
  ok(
    resolveClassificationFilterOptions([
      testItem({ id: "a", category: "edible-liquid", lowThcLiquid: true, unitThcMg: 9 }),
    ]).length === 0,
    "flag set but over 4 mg → still no lane",
  );

  {
    const opts = resolveClassificationFilterOptions([goodDrink("d1"), goodDrink("d2"), testItem({ id: "p", category: "flower" })]);
    ok(opts.length === 1, "only the lane that has products appears");
    ok(opts[0].id === CLASSIFICATION_FILTER_LOW_THC_ID, "the present lane is low-thc");
    ok(opts[0].kind === "low_thc_liquid", "lane carries its kind");
    ok(opts[0].count === 2, "count is the number of QUALIFYING items");
    ok(opts[0].label === "Low-THC Beverages", "shopper-facing label");
    ok(opts[0].help.length > 0, "lane carries help text");
  }

  {
    const opts = resolveClassificationFilterOptions([goodSupp("s1")]);
    ok(opts.length === 1 && opts[0].kind === "otherwise_taken", "suppository-only menu → one lane");
    ok(opts[0].label === "Suppositories", "suppository label");
  }

  {
    // Both present → stable order (low-THC first), independent of input order.
    const opts = resolveClassificationFilterOptions([goodSupp("s1"), goodDrink("d1"), goodSupp("s2")]);
    ok(opts.length === 2, "both lanes appear");
    ok(opts[0].kind === "low_thc_liquid" && opts[1].kind === "otherwise_taken", "stable lane order");
    ok(opts[0].count === 1 && opts[1].count === 2, "per-lane counts are independent");
  }

  // ── the matcher ───────────────────────────────────────────────────────────
  ok(itemMatchesClassificationFilter(testItem({ id: "a", category: "flower" }), null), "null id passes everything");
  ok(itemMatchesClassificationFilter(testItem({ id: "a", category: "flower" }), "   "), "blank id passes everything");
  ok(
    itemMatchesClassificationFilter(testItem({ id: "a", category: "flower" }), "bogus-lane"),
    "unknown id passes everything (never an inexplicable empty grid)",
  );
  ok(
    itemMatchesClassificationFilter(goodDrink("d1"), CLASSIFICATION_FILTER_LOW_THC_ID),
    "low-thc lane keeps a qualifying drink",
  );
  ok(
    !itemMatchesClassificationFilter(testItem({ id: "f", category: "flower" }), CLASSIFICATION_FILTER_LOW_THC_ID),
    "low-thc lane drops flower",
  );
  ok(
    !itemMatchesClassificationFilter(goodDrink("d1"), CLASSIFICATION_FILTER_OTHERWISE_TAKEN_ID),
    "suppository lane drops a drink",
  );
  ok(
    itemMatchesClassificationFilter(goodSupp("s1"), CLASSIFICATION_FILTER_OTHERWISE_TAKEN_ID),
    "suppository lane keeps a suppository",
  );

  // ── find ──────────────────────────────────────────────────────────────────
  {
    const opts = resolveClassificationFilterOptions([goodDrink("d1"), goodSupp("s1")]);
    ok(findClassificationFilterOption(opts, CLASSIFICATION_FILTER_LOW_THC_ID)?.kind === "low_thc_liquid", "find low-thc");
    ok(
      findClassificationFilterOption(opts, CLASSIFICATION_FILTER_OTHERWISE_TAKEN_ID)?.kind === "otherwise_taken",
      "find otherwise-taken",
    );
    ok(findClassificationFilterOption(opts, "nope") === null, "find missing → null");
    ok(findClassificationFilterOption(opts, null) === null, "find null → null");
    ok(findClassificationFilterOption([], CLASSIFICATION_FILTER_LOW_THC_ID) === null, "find in empty → null");
  }

  // ── shop href + kind-for-item (the back-office ↔ shop bridge) ─────────────
  ok(classificationShopHref("low_thc_liquid") === "/menu?classification=low-thc", "low-thc shop href");
  ok(
    classificationShopHref("otherwise_taken") === "/menu?classification=otherwise-taken",
    "otherwise-taken shop href",
  );
  // The href must round-trip through the parser the browser actually uses,
  // otherwise the back office could link somewhere the shop ignores.
  {
    const href = classificationShopHref("low_thc_liquid");
    const token = href.slice(href.indexOf("=") + 1);
    ok(classificationKindFromId(token) === "low_thc_liquid", "shop href round-trips through the parser");
  }
  ok(classificationKindForItem(goodDrink("d1")) === "low_thc_liquid", "kind for a qualifying drink");
  ok(classificationKindForItem(goodSupp("s1")) === "otherwise_taken", "kind for a qualifying suppository");
  ok(classificationKindForItem(testItem({ id: "p", category: "flower" })) === null, "flower has no lane");
  ok(
    classificationKindForItem(testItem({ id: "x", category: "edible-liquid", lowThcLiquid: true })) === null,
    "flagged-but-not-qualifying has no lane",
  );
  // Dual-flagged data error resolves to the TIGHTER bucket, matching
  // lineBucket() at sales-limits-core.ts:703-712.
  ok(
    classificationKindForItem(
      testItem({ id: "b", category: "topical", otherwiseTaken: true, lowThcLiquid: true, unitThcMg: 4 }),
    ) === "otherwise_taken",
    "dual-flagged resolves to otherwise_taken (the tighter cap), like the register",
  );

  // ── vocabulary parity with the register ───────────────────────────────────
  ok(
    classificationBucketLabel("low_thc_liquid") === LIMIT_BUCKET_LABELS.low_thc_liquid,
    "compliance label comes from LIMIT_BUCKET_LABELS",
  );
  ok(
    classificationBucketLabel("otherwise_taken") === LIMIT_BUCKET_LABELS.otherwise_taken,
    "otherwise-taken compliance label comes from LIMIT_BUCKET_LABELS",
  );
  // The shopper help must quote the statutory 4 mg from the constant, not a
  // hardcoded "4" that could drift if the rule ever changes.
  ok(
    CLASSIFICATION_FILTER_HELP.low_thc_liquid.includes(String(LOW_THC_UNIT_MAX_MG)),
    "help text derives the mg ceiling from LOW_THC_UNIT_MAX_MG",
  );

  return { passed };
}
