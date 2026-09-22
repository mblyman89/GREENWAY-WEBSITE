/**
 * src/lib/leafly/split-preview-core.ts
 *
 * ###########################################################################
 * # THE OWNER'S FOURTH QUESTION                                             #
 * #                                                                        #
 * #   "I'm not sure what you mean by stage 2 changes my menu looks to      #
 * #    shoppers."                                                          #
 * ###########################################################################
 *
 * WHAT THIS FILE IS FOR
 *
 * The owner was told, in a sentence, that "stage 2 changes how your menu
 * looks to shoppers". He said he did not understand it. The honest remedy
 * for a sentence somebody did not understand is NOT a longer sentence. It is
 * showing him the thing itself: these product names go away, these product
 * names appear in their place, and here is the price and stock on each one so
 * he can confirm nothing was invented.
 *
 * WHY THIS IS A SEPARATE FILE AND NOT A FIELD ON THE REPAIR SUMMARY
 *
 * `FullMenuRepairSummary` carries COUNTS -- "3 products were split into 9".
 * A count cannot answer the owner's question. He is not asking how many; he
 * is asking what his shoppers will SEE. The names already exist inside
 * `ItemSplit.products` and were being computed and then discarded before
 * anything reached the screen. This file is the shape that carries them out,
 * and it is pure so the wording can be tested without a database.
 *
 * ---------------------------------------------------------------------------
 * THE RULES THIS FILE ENFORCES
 * ---------------------------------------------------------------------------
 *
 * P1. NEVER SHOW A CHANGE WITHOUT SHOWING WHAT IT REPLACES. Every entry names
 *     the product as it appears on the menu TODAY, next to the products that
 *     would appear instead. A list of new names alone would be unreadable --
 *     the owner would have no way to tell an addition from a replacement.
 *
 * P2. NEVER CLAIM A SIZE THAT IS NOT ON THE PRODUCT. Each created listing is
 *     labelled with the size label the split actually used, taken from the
 *     split result, never re-derived here. Re-deriving it would let this
 *     preview and the real send disagree, which is the one thing a preview
 *     must never do.
 *
 * P3. ALWAYS SAY WHAT DID NOT CHANGE. The loudest question a shopper-visible
 *     change raises is "did my prices move?". The answer is no, and this
 *     file states it explicitly rather than leaving it to be inferred from
 *     silence.
 *
 * P4. A REFUSAL IS PART OF THE PREVIEW, NOT AN ERROR PAGE. Products the split
 *     declined to touch are listed in the same breath as the ones it would
 *     change, because "nothing will happen to this one and here is why" is
 *     information the owner needs BEFORE he presses send, not after.
 *
 * P5. ORDER IS STABLE AND ALPHABETICAL BY THE NAME HE ALREADY KNOWS. Two
 *     previews of the same menu must read identically, or the owner cannot
 *     diff them by eye. Sorting by the CURRENT name (not the generated one)
 *     is what makes the list scannable against the menu in front of him.
 *
 * PURITY. Zero imports. Types are declared structurally so this file never
 * drags the split engine (or anything server-side) into a client bundle. The
 * structural types are pinned against the real ones by a compliance test, so
 * "structural" does not mean "unchecked".
 */

/* ========================================================================== */
/* Structural inputs                                                          */
/* ========================================================================== */

/**
 * The shape of one created listing, as `collision-split-core` reports it.
 *
 * Declared structurally rather than imported. A compile-time assignability
 * test in `tests/compliance/leafly-full-menu.test.ts` proves the real
 * `ItemSplit` still satisfies this, so drift is caught by CI rather than by
 * the owner looking at a blank panel.
 */
export type SplitPreviewProduct = {
  id: string;
  name: string;
  label: string;
  variantIds: string[];
};

/** The shape of one split, as `collision-split-core` reports it. */
export type SplitPreviewSplit = {
  parentId: string;
  parentName: string;
  leaflyType: string;
  products: readonly SplitPreviewProduct[];
};

/** The shape of one refusal, as `collision-split-core` reports it. */
export type SplitPreviewRefusal = {
  itemId: string;
  itemName: string;
  leaflyType: string;
  reason: string;
};

/**
 * Price and stock for a created listing, keyed by variant id.
 *
 * Optional throughout. When the caller cannot supply it, the preview still
 * renders names -- it simply does not assert a price. Showing a name with no
 * price is honest; showing a name with a GUESSED price is not.
 */
export type SplitPreviewFacts = {
  price?: number | null;
  inventoryLevel?: number | null;
};

/* ========================================================================== */
/* Outputs                                                                    */
/* ========================================================================== */

/** One listing a shopper would newly see. */
export type PreviewedListing = {
  id: string;
  name: string;
  /** The size label this listing represents. Never re-derived. P2. */
  sizeLabel: string;
  /** The ordering id(s) carried across unchanged. */
  variantIds: string[];
  price: number | null;
  inventoryLevel: number | null;
};

/** One product that would become several. */
export type PreviewedChange = {
  /** The name on the menu TODAY. P1. */
  currentName: string;
  currentId: string;
  leaflyType: string;
  /** What a shopper would see instead. */
  listings: PreviewedListing[];
  /** Plain-language line for this one product. */
  line: string;
};

/** One product the split declined to touch, and why. P4. */
export type PreviewedRefusal = {
  itemId: string;
  itemName: string;
  leaflyType: string;
  reason: string;
};

export type SplitPreview = {
  /** True when nothing at all would change for shoppers. */
  noChange: boolean;
  changes: PreviewedChange[];
  refusals: PreviewedRefusal[];
  /** Products that would be replaced by several listings. */
  changedProductCount: number;
  /** Listings a shopper would see in their place. */
  createdListingCount: number;
  /** Net change in the number of things on the menu. */
  netListingChange: number;
  /** Ordering ids carried across unchanged. Proof nothing was invented. */
  carriedVariantCount: number;
  /** True when every created listing kept a price. P3. */
  allPricesCarried: boolean;
};

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

function safeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Sort by the name the owner already knows, then by id.
 *
 * The id tiebreak is not decoration: two products CAN legitimately share a
 * display name (same product, two vendors), and without the tiebreak their
 * relative order would depend on the order the feed happened to arrive in,
 * which would make two previews of an unchanged menu read differently. P5.
 */
function byCurrentName(a: PreviewedChange, b: PreviewedChange): number {
  const n = a.currentName.localeCompare(b.currentName);
  if (n !== 0) return n;
  return a.currentId.localeCompare(b.currentId);
}

function byItemName(a: PreviewedRefusal, b: PreviewedRefusal): number {
  const n = a.itemName.localeCompare(b.itemName);
  if (n !== 0) return n;
  return a.itemId.localeCompare(b.itemId);
}

/* ========================================================================== */
/* The preview                                                                */
/* ========================================================================== */

/**
 * Turn the split engine's report into something a shop owner can read.
 *
 * `factsByVariantId` is how price and stock reach the preview. It is a lookup
 * rather than a parameter on each product because the split engine reports
 * ids, and the prices live on the payload -- joining them by id here keeps
 * the join in ONE place with a test on it, instead of in the component.
 */
export function previewSplits(input: {
  splits: readonly SplitPreviewSplit[];
  refusals?: readonly SplitPreviewRefusal[];
  factsByVariantId?: ReadonlyMap<string, SplitPreviewFacts>;
}): SplitPreview {
  const splits = input?.splits ?? [];
  const refusalsIn = input?.refusals ?? [];
  const facts = input?.factsByVariantId ?? new Map<string, SplitPreviewFacts>();

  const changes: PreviewedChange[] = [];
  let carriedVariantCount = 0;
  let allPricesCarried = true;

  for (const split of splits) {
    const currentName = safeText(split?.parentName);
    const currentId = safeText(split?.parentId);
    const leaflyType = safeText(split?.leaflyType);
    const products = split?.products ?? [];

    // A split with no products is not a change worth showing. It also cannot
    // happen for any output of `applyCollisionSplits` -- but a preview that
    // renders an empty "becomes:" list would look like data loss to the owner,
    // and looking like data loss is its own kind of harm.
    if (products.length === 0) continue;

    const listings: PreviewedListing[] = products.map((p) => {
      const variantIds = (p?.variantIds ?? []).map((v) => safeText(v)).filter((v) => v.length > 0);
      carriedVariantCount += variantIds.length;

      // Facts come from the FIRST variant, because a split product carries
      // exactly one size by construction (rule S1 of the split engine).
      const f = variantIds.length > 0 ? facts.get(variantIds[0]) : undefined;
      const price = finiteOrNull(f?.price);
      if (price === null) allPricesCarried = false;

      return {
        id: safeText(p?.id),
        name: safeText(p?.name),
        sizeLabel: safeText(p?.label),
        variantIds,
        price,
        inventoryLevel: finiteOrNull(f?.inventoryLevel),
      };
    });

    const names = listings.map((l) => `"${l.name}"`).join(", ");
    changes.push({
      currentName,
      currentId,
      leaflyType,
      listings,
      // P1 + P3 in one sentence: what it is now, what it becomes, and the
      // explicit reassurance about price, stock and ordering.
      line:
        `"${currentName}" is one product with ${listings.length} sizes today. On Leafly it would ` +
        `appear as ${listings.length} separate listings (${names}). Each keeps its own price, ` +
        `its own stock count and its own ordering id, so nothing is repriced and no order breaks.`,
    });
  }

  const refusals: PreviewedRefusal[] = refusalsIn
    .map((r) => ({
      itemId: safeText(r?.itemId),
      itemName: safeText(r?.itemName),
      leaflyType: safeText(r?.leaflyType),
      reason: safeText(r?.reason),
    }))
    .sort(byItemName);

  changes.sort(byCurrentName);

  const createdListingCount = changes.reduce((sum, c) => sum + c.listings.length, 0);

  return {
    noChange: changes.length === 0,
    changes,
    refusals,
    changedProductCount: changes.length,
    createdListingCount,
    // One product LEAVES for every change, and its listings arrive. Stating
    // the net rather than only the gross is what lets the owner reconcile the
    // preview against the product count he sees on Leafly afterwards.
    netListingChange: createdListingCount - changes.length,
    carriedVariantCount,
    allPricesCarried: changes.length === 0 ? true : allPricesCarried,
  };
}

/**
 * One paragraph answering "what does this do to my menu?".
 *
 * Deliberately avoids the words "stage 2", "split" and "collision". Those are
 * OUR words for OUR defect. The owner's question was what it does to his
 * shop, and the answer should be in the language of his shop.
 */
export function describeSplitPreview(preview: SplitPreview): string {
  if (preview.noChange) {
    return (
      "Nothing about how your menu looks would change. No product needs to be listed as " +
      "several listings, so shoppers would see exactly the products they see now."
    );
  }

  const p = preview.changedProductCount;
  const l = preview.createdListingCount;
  const productWord = p === 1 ? "product" : "products";
  const isAre = p === 1 ? "is" : "are";

  const priceNote = preview.allPricesCarried
    ? "Every one of those listings keeps the price it has now."
    : // Never smooth this over. A missing price in the preview means the send
      // would carry a missing price, and the owner must see that BEFORE he
      // sends, not in a Leafly rejection afterwards.
      "Some of those listings have no price recorded, which you should fix before sending.";

  return (
    `${p} ${productWord} on your menu ${isAre} sold in several sizes that Leafly cannot tell ` +
    `apart on a single listing. Rather than dropping the extra sizes, those ${p} ${productWord} ` +
    `would be shown to shoppers as ${l} separate listings, one per size, each named with its ` +
    `size. Your menu would show ${preview.netListingChange >= 0 ? "" : ""}` +
    `${Math.abs(preview.netListingChange)} more listing${Math.abs(preview.netListingChange) === 1 ? "" : "s"} ` +
    `than it does now. ${priceNote} Stock counts and ordering ids are carried across untouched, ` +
    `so existing and future orders still match the right size.` +
    (preview.refusals.length > 0
      ? ` ${preview.refusals.length} other product${preview.refusals.length === 1 ? "" : "s"} ` +
        `could not be handled automatically and ${preview.refusals.length === 1 ? "is" : "are"} ` +
        `listed separately with the reason.`
      : "")
  );
}

/**
 * One line per change, for a log or a plain-text summary.
 *
 * Capped, because a durable log entry that is ten thousand words long is a
 * log entry nobody reads.
 */
export function describeSplitPreviewLines(
  preview: SplitPreview,
  limit = 100,
): string[] {
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100;
  const lines = preview.changes.slice(0, max).map((c) => c.line);
  const hidden = preview.changes.length - lines.length;
  if (hidden > 0) {
    lines.push(`(and ${hidden} more product${hidden === 1 ? "" : "s"} handled the same way)`);
  }
  return lines;
}

/* ========================================================================== */
/* Self-tests                                                                 */
/* ========================================================================== */

export function __runLeaflySplitPreviewTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const fail = (msg: string) => {
    failed += 1;
    console.error(`[leafly-split-preview] FAIL: ${msg}`);
  };
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else fail(msg);
  };

  const split = (over: Partial<SplitPreviewSplit> = {}): SplitPreviewSplit => ({
    parentId: "p1",
    parentName: "House Pre-Roll",
    leaflyType: "PreRoll",
    products: [
      { id: "p1--1g", name: "House Pre-Roll - 1g", label: "1g", variantIds: ["v1"] },
      { id: "p1--3g", name: "House Pre-Roll - 3g", label: "3g", variantIds: ["v3"] },
    ],
    ...over,
  });

  /* ---- empty input ---------------------------------------------------- */
  const none = previewSplits({ splits: [] });
  ok(none.noChange === true, "empty input must report noChange");
  ok(none.changes.length === 0, "empty input must produce no changes");
  ok(none.changedProductCount === 0, "empty input product count must be 0");
  ok(none.createdListingCount === 0, "empty input listing count must be 0");
  ok(none.netListingChange === 0, "empty input net change must be 0");
  ok(none.carriedVariantCount === 0, "empty input carried count must be 0");
  ok(none.allPricesCarried === true, "empty input must not claim missing prices");
  ok(none.refusals.length === 0, "empty input must produce no refusals");
  ok(
    describeSplitPreview(none).includes("Nothing about how your menu looks would change"),
    "empty preview prose must say nothing changes",
  );
  ok(
    !describeSplitPreview(none).includes("undefined"),
    "empty preview prose must not leak undefined",
  );

  /* ---- undefined-safe ------------------------------------------------- */
  const bare = previewSplits({ splits: undefined as unknown as SplitPreviewSplit[] });
  ok(bare.noChange === true, "undefined splits must be treated as none");
  ok(describeSplitPreviewLines(bare).length === 0, "undefined splits must yield no lines");

  /* ---- one split, names carried --------------------------------------- */
  const one = previewSplits({ splits: [split()] });
  ok(one.noChange === false, "a split must not report noChange");
  ok(one.changedProductCount === 1, "one split is one changed product");
  ok(one.createdListingCount === 2, "two sizes make two listings");
  ok(one.netListingChange === 1, "one product becoming two listings is +1 net");
  ok(one.carriedVariantCount === 2, "both ordering ids must be counted");
  ok(one.changes[0].currentName === "House Pre-Roll", "P1: current name must be carried");
  ok(one.changes[0].currentId === "p1", "P1: current id must be carried");
  ok(one.changes[0].leaflyType === "PreRoll", "leafly type must be carried");
  ok(one.changes[0].listings[0].name === "House Pre-Roll - 1g", "created name must be carried");
  ok(one.changes[0].listings[1].name === "House Pre-Roll - 3g", "second created name must be carried");
  ok(one.changes[0].listings[0].sizeLabel === "1g", "P2: size label must come from the split");
  ok(one.changes[0].listings[1].sizeLabel === "3g", "P2: second size label must come from the split");
  ok(one.changes[0].listings[0].variantIds[0] === "v1", "ordering id must be carried");
  ok(one.changes[0].listings[1].variantIds[0] === "v3", "second ordering id must be carried");

  /* ---- the line names both sides -------------------------------------- */
  const line = one.changes[0].line;
  ok(line.includes("House Pre-Roll"), "P1: line must name the current product");
  ok(line.includes("House Pre-Roll - 1g"), "line must name the first created listing");
  ok(line.includes("House Pre-Roll - 3g"), "line must name the second created listing");
  ok(line.includes("price"), "P3: line must address price");
  ok(line.includes("stock"), "P3: line must address stock");
  ok(line.includes("ordering id"), "P3: line must address ordering ids");
  ok(!line.includes("undefined"), "line must not leak undefined");
  ok(!line.includes("stage 2"), "line must not use internal vocabulary");

  /* ---- prose ---------------------------------------------------------- */
  const prose = describeSplitPreview(one);
  ok(prose.includes("2 separate listings"), "prose must state the listing count");
  ok(prose.includes("1 more listing"), "prose must state the net change in the singular");
  ok(prose.includes("ordering id"), "P3: prose must reassure about ordering ids");
  ok(!prose.includes("collision"), "prose must avoid the word collision");
  ok(!prose.includes("stage 2"), "prose must avoid the words stage 2");
  ok(!prose.includes("split"), "prose must avoid the word split");
  ok(!prose.includes("undefined"), "prose must not leak undefined");
  ok(!prose.includes("NaN"), "prose must not leak NaN");

  /* ---- prices carried ------------------------------------------------- */
  const withPrices = previewSplits({
    splits: [split()],
    factsByVariantId: new Map([
      ["v1", { price: 1000, inventoryLevel: 4 }],
      ["v3", { price: 2500, inventoryLevel: 7 }],
    ]),
  });
  ok(withPrices.allPricesCarried === true, "both prices present must report allPricesCarried");
  ok(withPrices.changes[0].listings[0].price === 1000, "price must be joined by variant id");
  ok(withPrices.changes[0].listings[1].price === 2500, "second price must be joined by variant id");
  ok(withPrices.changes[0].listings[0].inventoryLevel === 4, "stock must be joined by variant id");
  ok(withPrices.changes[0].listings[1].inventoryLevel === 7, "second stock must be joined");
  ok(
    describeSplitPreview(withPrices).includes("keeps the price it has now"),
    "P3: full prices must be stated as kept",
  );

  /* ---- a missing price must be SAID, never smoothed over -------------- */
  const halfPriced = previewSplits({
    splits: [split()],
    factsByVariantId: new Map([["v1", { price: 1000 }]]),
  });
  ok(halfPriced.allPricesCarried === false, "a missing price must clear allPricesCarried");
  ok(halfPriced.changes[0].listings[1].price === null, "a missing price must be null, not 0");
  ok(
    describeSplitPreview(halfPriced).includes("no price recorded"),
    "a missing price must be stated in the prose",
  );
  ok(
    !describeSplitPreview(halfPriced).includes("keeps the price it has now"),
    "a missing price must not also claim prices were kept",
  );

  /* ---- a non-finite price is not a price ------------------------------ */
  const nanPriced = previewSplits({
    splits: [split()],
    factsByVariantId: new Map([
      ["v1", { price: Number.NaN }],
      ["v3", { price: 2500 }],
    ]),
  });
  ok(nanPriced.changes[0].listings[0].price === null, "NaN must not be reported as a price");
  ok(nanPriced.allPricesCarried === false, "NaN must clear allPricesCarried");

  /* ---- three sizes ---------------------------------------------------- */
  const three = previewSplits({
    splits: [
      split({
        products: [
          { id: "p1--1g", name: "A - 1g", label: "1g", variantIds: ["v1"] },
          { id: "p1--2g", name: "A - 2g", label: "2g", variantIds: ["v2"] },
          { id: "p1--3g", name: "A - 3g", label: "3g", variantIds: ["v3"] },
        ],
      }),
    ],
  });
  ok(three.createdListingCount === 3, "three sizes make three listings");
  ok(three.netListingChange === 2, "one product becoming three listings is +2 net");
  ok(
    describeSplitPreview(three).includes("2 more listings"),
    "prose must pluralise the net change",
  );

  /* ---- P5 stable alphabetical order ----------------------------------- */
  const sorted = previewSplits({
    splits: [
      split({ parentId: "z", parentName: "Zebra Gummies" }),
      split({ parentId: "a", parentName: "Apple Pre-Roll" }),
      split({ parentId: "m", parentName: "Mango Vape" }),
    ],
  });
  ok(sorted.changes[0].currentName === "Apple Pre-Roll", "P5: must sort by current name");
  ok(sorted.changes[1].currentName === "Mango Vape", "P5: middle entry must sort correctly");
  ok(sorted.changes[2].currentName === "Zebra Gummies", "P5: last entry must sort correctly");

  const sortedAgain = previewSplits({
    splits: [
      split({ parentId: "m", parentName: "Mango Vape" }),
      split({ parentId: "z", parentName: "Zebra Gummies" }),
      split({ parentId: "a", parentName: "Apple Pre-Roll" }),
    ],
  });
  ok(
    JSON.stringify(sorted.changes.map((c) => c.currentId)) ===
      JSON.stringify(sortedAgain.changes.map((c) => c.currentId)),
    "P5: a different input order must produce the same preview order",
  );

  /* ---- P5 id tiebreak for duplicate display names --------------------- */
  const tied = previewSplits({
    splits: [
      split({ parentId: "b-vendor", parentName: "Same Name" }),
      split({ parentId: "a-vendor", parentName: "Same Name" }),
    ],
  });
  ok(tied.changes[0].currentId === "a-vendor", "P5: equal names must tiebreak on id");
  ok(tied.changes[1].currentId === "b-vendor", "P5: tiebreak must be total");

  /* ---- P4 refusals are part of the preview ---------------------------- */
  const refused = previewSplits({
    splits: [split()],
    refusals: [
      {
        itemId: "r2",
        itemName: "Mystery Edible",
        leaflyType: "Edible",
        reason: "2 of this product's 3 sizes has no size label recorded.",
      },
      {
        itemId: "r1",
        itemName: "Another Edible",
        leaflyType: "Edible",
        reason: "Two or more sizes carry the same label.",
      },
    ],
  });
  ok(refused.refusals.length === 2, "P4: refusals must be carried");
  ok(refused.refusals[0].itemName === "Another Edible", "P4: refusals must be sorted by name");
  ok(
    refused.refusals[0].reason.includes("same label"),
    "P4: the real reason must be carried verbatim",
  );
  ok(
    describeSplitPreview(refused).includes("could not be handled automatically"),
    "P4: prose must mention refusals",
  );
  ok(
    describeSplitPreview(refused).includes("2 other products"),
    "P4: prose must count refusals",
  );

  /* ---- a refusal alone is still "no change" for shoppers -------------- */
  const onlyRefused = previewSplits({
    splits: [],
    refusals: [{ itemId: "r1", itemName: "X", leaflyType: "Edible", reason: "no label" }],
  });
  ok(onlyRefused.noChange === true, "refusals alone must not count as a shopper-visible change");
  ok(onlyRefused.refusals.length === 1, "refusals alone must still be reported");

  /* ---- a split with no products is skipped, not rendered empty -------- */
  const emptyProducts = previewSplits({ splits: [split({ products: [] })] });
  ok(emptyProducts.noChange === true, "a productless split must not render as a change");
  ok(emptyProducts.changes.length === 0, "a productless split must be skipped");

  /* ---- lines and the cap ---------------------------------------------- */
  const many = previewSplits({
    splits: Array.from({ length: 7 }, (_, i) =>
      split({ parentId: `p${i}`, parentName: `Product ${String.fromCharCode(65 + i)}` }),
    ),
  });
  ok(many.changedProductCount === 7, "all seven splits must be counted");
  ok(describeSplitPreviewLines(many).length === 7, "under the cap, every line is returned");
  const capped = describeSplitPreviewLines(many, 3);
  ok(capped.length === 4, "over the cap, a summary line must be appended");
  ok(capped[3].includes("4 more products"), "the summary line must count what it hid");
  ok(
    describeSplitPreviewLines(many, 0).length === 7,
    "a zero cap must fall back to the default, not hide everything",
  );
  ok(
    describeSplitPreviewLines(many, -5).length === 7,
    "a negative cap must fall back to the default",
  );

  /* ---- whitespace and hostile input ---------------------------------- */
  const messy = previewSplits({
    splits: [
      split({
        parentName: "  Padded Name  ",
        products: [{ id: " x ", name: "  X - 1g  ", label: " 1g ", variantIds: [" v1 ", ""] }],
      }),
    ],
  });
  ok(messy.changes[0].currentName === "Padded Name", "names must be trimmed");
  ok(messy.changes[0].listings[0].name === "X - 1g", "created names must be trimmed");
  ok(messy.changes[0].listings[0].sizeLabel === "1g", "labels must be trimmed");
  ok(
    messy.changes[0].listings[0].variantIds.length === 1,
    "empty ordering ids must be dropped, not counted",
  );
  ok(messy.carriedVariantCount === 1, "only real ordering ids count towards the total");

  const nully = previewSplits({
    splits: [
      {
        parentId: null as unknown as string,
        parentName: null as unknown as string,
        leaflyType: null as unknown as string,
        products: [
          {
            id: null as unknown as string,
            name: null as unknown as string,
            label: null as unknown as string,
            variantIds: null as unknown as string[],
          },
        ],
      },
    ],
  });
  ok(nully.changes.length === 1, "null fields must not throw");
  ok(nully.changes[0].currentName === "", "null name must become empty string");
  ok(
    !nully.changes[0].line.includes("null"),
    "null must never reach the owner-facing line",
  );

  /* ---- input is never mutated ----------------------------------------- */
  const original = split();
  const snapshot = JSON.stringify(original);
  previewSplits({ splits: [original] });
  ok(JSON.stringify(original) === snapshot, "input must never be mutated");

  if (failed === 0) {
    console.log(`[leafly-split-preview] ${passed} assertions passed`);
  }
  return { passed, failed };
}
