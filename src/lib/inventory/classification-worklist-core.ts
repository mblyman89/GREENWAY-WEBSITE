/**
 * src/lib/inventory/classification-worklist-core.ts   (SLICE 18A)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS
 *
 * The pure shaping layer behind the "Sales-limit classification" worklist: it
 * turns a pile of inventory lots plus the menu-side truth into the short,
 * ordered list of PRODUCTS a human still has to answer a question about.
 *
 * The status maths itself lives in classification-status-core.ts. This module
 * does the three things that module deliberately does not:
 *
 *   1. GROUPS BY PRODUCT — see below, this is the whole reason the file exists
 *   2. ORDERS the result so the dangerous rows are unmissable
 *   3. Parses / serialises the query-string knobs the page filters on
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY GROUPING BY PRODUCT IS LOAD-BEARING, NOT COSMETIC
 *
 * The four flags live on `menu_items`, ONE row per product
 * (fact-review-store.ts:122-135, live-menu.ts:94-100). Inventory holds one row
 * per LOT, and a product that has been restocked eight times has eight lots
 * carrying the same `pos_product_key`.
 *
 * So a lot-per-row worklist would print the SAME unanswered question eight
 * times, and answering it once would clear all eight at once. The reader
 * cannot tell those eight rows are one job. They would either answer it eight
 * times (wasted work, and a chance to answer inconsistently) or conclude the
 * list is broken. Both end with the compliance list being ignored, which is
 * the failure mode this whole slice exists to prevent.
 *
 * One product = one question = one row. The lots behind it are reported as a
 * count, so the reader still knows how much stock is affected.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SOURCE-AGNOSTIC (correcting the brief)
 *
 * The ask was "the worklist will pertain specifically to Cultivera products".
 * Recon says otherwise, on two independent grounds (docs/slice-18a-recon.md,
 * FINDING 4):
 *
 *   1. The Cultivera importer DOES create `inventory_lots` rows
 *      (import-service.ts:582-624) — imported products are not a separate
 *      species of row that could be filtered on.
 *   2. The set is 100% Cultivera today only because nothing has been received
 *      through the new door yet. That is a fact about THIS WEEK, not about the
 *      system. Hard-coding it means the first received suppository is invisible
 *      to the very list built to catch it.
 *
 * So the list covers everything and the Cultivera view is a FILTER
 * (`ClassificationWorklistFilter.source`), not the definition. Same list, one
 * knob, no blind spot.
 *
 * PURE: no I/O, no Supabase, no clock.
 * ────────────────────────────────────────────────────────────────────────────
 */
import {
  assessClassificationStatus,
  classificationSortWeight,
  summarizeClassificationStatuses,
  type ClassificationStatus,
  type ProductClassificationFacts,
} from "@/lib/inventory/classification-status-core";
// SLICE 18B — the shop facet's lane resolver. Imported (not re-implemented) so
// the "where does the customer see this?" column on the worklist is decided by
// the exact same predicates as the shop sidebar and the register's limit meter.
import {
  classificationKindForItem,
  type ClassificationFilterKind,
} from "@/lib/menu/menu-classification-filter-core";

/**
 * One inventory lot as the worklist assembler hands it over: the lot's own
 * identity plus the EFFECTIVE website category already resolved for it
 * (override → published menu category → inventory-type map).
 *
 * The category must arrive pre-resolved because resolving it needs three
 * database reads, and this module is pure.
 */
export type WorklistLotInput = {
  lotId: string;
  posProductKey: string | null;
  productName: string | null;
  inventoryType: string | null;
  /** The EFFECTIVE website category, not the raw import string. */
  resolvedWebsiteCategory: string | null;
  vendorName: string | null;
  /** Quantity on hand, used only to report how much stock is affected. */
  onHandQty: number | null;
  /**
   * True when this lot came from the one-time Cultivera menu import rather
   * than from the receiving door. Drives the `source` filter ONLY — never the
   * scope, never the status.
   */
  fromImport: boolean;
};

/** One PRODUCT on the worklist (possibly many lots behind it). */
export type ClassificationWorklistEntry = {
  posProductKey: string;
  productName: string;
  vendorName: string | null;
  inventoryType: string | null;
  resolvedWebsiteCategory: string | null;
  status: ClassificationStatus;
  /** How many lots carry this product key. Always >= 1. */
  lotCount: number;
  /** Total on-hand across those lots — how much stock the answer affects. */
  onHandTotal: number;
  /**
   * The lot the "Classify →" button opens. The editor lives on the lot detail
   * page, so the worklist must hand over a concrete lot. Chosen
   * deterministically (see pickRepresentativeLot) so the same product always
   * opens the same lot and the link never flickers between renders.
   */
  representativeLotId: string;
  /** True when every lot behind this product came from the Cultivera import. */
  allFromImport: boolean;
  /**
   * SLICE 18B — the customer-facing shop lane this product now appears in, or
   * null when the register would not route it to a special bucket.
   *
   * This closes the loop the owner actually cares about: "I answered the
   * question" → "here is the lane the customer sees". It is computed with the
   * SAME predicates the shop facet and the till use
   * (classificationKindForItem → qualifiesAs*), so the back office can never
   * promise a lane the shop would not render. A product whose flags are set but
   * whose figures do not qualify reports null — which is the honest answer, and
   * the one that tells the owner his edit did not take effect.
   */
  shopLane: ClassificationFilterKind | null;
};

/** Which slice of the list to show. */
export type ClassificationWorklistScope =
  | "needs_attention"
  | "urgent"
  | "unconfirmed"
  | "settled"
  | "all";

/** Which door the products came through. */
export type ClassificationWorklistSource = "all" | "import" | "received";

export type ClassificationWorklistFilter = {
  scope: ClassificationWorklistScope;
  source: ClassificationWorklistSource;
};

export const DEFAULT_WORKLIST_FILTER: ClassificationWorklistFilter = {
  // Opens on the work, not on the archive. A worklist that opens showing
  // finished rows teaches the reader to scroll past it.
  scope: "needs_attention",
  source: "all",
};

const SCOPES: readonly ClassificationWorklistScope[] = [
  "needs_attention",
  "urgent",
  "unconfirmed",
  "settled",
  "all",
] as const;

const SOURCES: readonly ClassificationWorklistSource[] = ["all", "import", "received"] as const;

/**
 * Parse a scope knob from the query string. Anything unrecognised falls back
 * to the default rather than throwing — the same forgiving grammar every other
 * knob on the inventory page uses (lot-gap-core.ts:250).
 *
 * Note the fallback is the DEFAULT, not "all": a typo in the URL must not
 * quietly widen the list into the archive and bury the real work.
 */
export function parseWorklistScope(raw: string | undefined | null): ClassificationWorklistScope {
  return SCOPES.includes(raw as ClassificationWorklistScope)
    ? (raw as ClassificationWorklistScope)
    : DEFAULT_WORKLIST_FILTER.scope;
}

export function parseWorklistSource(raw: string | undefined | null): ClassificationWorklistSource {
  return SOURCES.includes(raw as ClassificationWorklistSource)
    ? (raw as ClassificationWorklistSource)
    : DEFAULT_WORKLIST_FILTER.source;
}

export function parseWorklistFilter(params: {
  scope?: string | undefined | null;
  source?: string | undefined | null;
}): ClassificationWorklistFilter {
  return {
    scope: parseWorklistScope(params.scope),
    source: parseWorklistSource(params.source),
  };
}

/**
 * The deep link into the worklist for a given filter.
 *
 * SLICE 6A's defect was a "Fix →" link that narrowed nothing, so the page
 * reloaded looking identical and the button appeared broken. Every href built
 * here therefore carries BOTH knobs explicitly, even when one is the default:
 * a link that states its whole intent survives being bookmarked, pasted into
 * a message, or landed on from a different default later.
 */
export function classificationWorklistHref(
  filter: Partial<ClassificationWorklistFilter> = {},
): string {
  const scope = filter.scope ?? DEFAULT_WORKLIST_FILTER.scope;
  const source = filter.source ?? DEFAULT_WORKLIST_FILTER.source;
  return `/admin/compliance/classification?scope=${scope}&source=${source}`;
}

/**
 * Pick the lot a product's "Classify →" button opens.
 *
 * Deterministic by design: the lot with stock on hand wins (that is the one
 * whose classification is actually about to be sold), ties broken by the
 * lexicographically smallest lot id. Without a total order the link would
 * change between two renders of the same data, which makes a bug report
 * impossible to reproduce.
 */
export function pickRepresentativeLot(lots: readonly WorklistLotInput[]): string {
  let best: WorklistLotInput | null = null;
  for (const lot of lots) {
    if (best === null) {
      best = lot;
      continue;
    }
    const lotStocked = (lot.onHandQty ?? 0) > 0;
    const bestStocked = (best.onHandQty ?? 0) > 0;
    if (lotStocked !== bestStocked) {
      if (lotStocked) best = lot;
      continue;
    }
    if (lot.lotId < best.lotId) best = lot;
  }
  // Callers only ever group non-empty arrays, but returning "" beats throwing
  // inside a page render.
  return best?.lotId ?? "";
}

/**
 * Group lots into products and assess each one.
 *
 * Lots with NO `pos_product_key` are dropped, and that is correct rather than
 * lazy: the four flags are stored on the menu row and joined by that key, so a
 * lot without one has nowhere to store an answer. Listing it would offer work
 * that cannot be completed. Those lots are already covered by the SLICE 7
 * `missingProductLink` gap, which is the fix that actually unblocks them.
 */
export function buildClassificationWorklist(
  lots: readonly WorklistLotInput[],
  menuFacts: ReadonlyMap<string, Omit<ProductClassificationFacts, "posProductKey" | "productName" | "inventoryType" | "resolvedWebsiteCategory">>,
): ClassificationWorklistEntry[] {
  const byKey = new Map<string, WorklistLotInput[]>();
  for (const lot of lots) {
    const key = (lot.posProductKey ?? "").trim();
    if (!key) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(lot);
    else byKey.set(key, [lot]);
  }

  const entries: ClassificationWorklistEntry[] = [];
  for (const [key, group] of byKey) {
    // Take identity from the representative lot so the row's name and the row's
    // link always describe the same lot. Reading the name off group[0] while
    // linking to a different lot would put one product's name above another
    // product's page.
    const representativeLotId = pickRepresentativeLot(group);
    const rep = group.find((l) => l.lotId === representativeLotId) ?? group[0];

    const flags = menuFacts.get(key);
    const status = assessClassificationStatus({
      posProductKey: key,
      productName: rep.productName,
      inventoryType: rep.inventoryType,
      resolvedWebsiteCategory: rep.resolvedWebsiteCategory,
      // A key absent from the menu map means the published menu has no row for
      // it, so nothing is recorded. Null (UNKNOWN), never false.
      otherwiseTaken: flags?.otherwiseTaken ?? null,
      unitsPerPackage: flags?.unitsPerPackage ?? null,
      lowThcLiquid: flags?.lowThcLiquid ?? null,
      unitThcMg: flags?.unitThcMg ?? null,
    });

    entries.push({
      posProductKey: key,
      productName: rep.productName ?? "(unnamed product)",
      vendorName: rep.vendorName,
      inventoryType: rep.inventoryType,
      resolvedWebsiteCategory: rep.resolvedWebsiteCategory,
      status,
      lotCount: group.length,
      onHandTotal: group.reduce((sum, l) => sum + (l.onHandQty ?? 0), 0),
      representativeLotId,
      allFromImport: group.every((l) => l.fromImport),
      // SLICE 18B — ask the SHOP/register predicates, not the raw flags, so
      // this column reports what a customer would actually see.
      shopLane: classificationKindForItem({
        category: rep.resolvedWebsiteCategory ?? null,
        lowThcLiquid: flags?.lowThcLiquid ?? null,
        unitThcMg: flags?.unitThcMg ?? null,
        otherwiseTaken: flags?.otherwiseTaken ?? null,
        unitsPerPackage: flags?.unitsPerPackage ?? null,
      } as Parameters<typeof classificationKindForItem>[0]),
    });
  }

  return sortWorklist(entries);
}

/**
 * Urgent first, then unconfirmed, then settled; ties broken by product name so
 * the order is stable across renders (Map iteration order would otherwise leak
 * database ordering into the page).
 */
export function sortWorklist(
  entries: readonly ClassificationWorklistEntry[],
): ClassificationWorklistEntry[] {
  return [...entries].sort((a, b) => {
    const wa = classificationSortWeight(a.status);
    const wb = classificationSortWeight(b.status);
    if (wa !== wb) return wa - wb;
    const byName = a.productName.localeCompare(b.productName);
    if (byName !== 0) return byName;
    return a.posProductKey.localeCompare(b.posProductKey);
  });
}

/**
 * Apply the visible filter. Out-of-scope products are excluded from EVERY
 * scope including "all": "all" means "all the products this list is about",
 * not "all 3,800 lots in the building". A flower lot has no classification
 * question, so showing it would be padding.
 */
export function filterWorklist(
  entries: readonly ClassificationWorklistEntry[],
  filter: ClassificationWorklistFilter,
): ClassificationWorklistEntry[] {
  return entries.filter((e) => {
    if (!e.status.inScope) return false;

    if (filter.source === "import" && !e.allFromImport) return false;
    if (filter.source === "received" && e.allFromImport) return false;

    switch (filter.scope) {
      case "urgent":
        return e.status.urgent;
      case "unconfirmed":
        return !e.status.settled && !e.status.urgent;
      case "settled":
        return e.status.settled;
      case "needs_attention":
        return !e.status.settled;
      case "all":
        return true;
    }
  });
}

/**
 * The counts printed above the list.
 *
 * Computed from the SOURCE-filtered entries but NOT the scope-filtered ones,
 * so the tallies describe the whole population the reader is looking at while
 * the table shows the slice they picked. Deriving them from the scope-filtered
 * rows would print "0 urgent" whenever the reader clicked "settled", which
 * reads as an all-clear that isn't true.
 */
export function summarizeWorklist(
  entries: readonly ClassificationWorklistEntry[],
  source: ClassificationWorklistSource = "all",
): ReturnType<typeof summarizeClassificationStatuses> & { products: number; lots: number } {
  const scoped = entries.filter((e) => {
    if (!e.status.inScope) return false;
    if (source === "import" && !e.allFromImport) return false;
    if (source === "received" && e.allFromImport) return false;
    return true;
  });
  const rolled = summarizeClassificationStatuses(scoped.map((e) => e.status));
  return {
    ...rolled,
    products: scoped.length,
    lots: scoped.reduce((sum, e) => sum + e.lotCount, 0),
  };
}

/** Human label for a scope tab. */
export function worklistScopeLabel(scope: ClassificationWorklistScope): string {
  switch (scope) {
    case "needs_attention":
      return "Needs attention";
    case "urgent":
      return "Urgent";
    case "unconfirmed":
      return "Unconfirmed";
    case "settled":
      return "Classified";
    case "all":
      return "All in scope";
  }
}

/** Human label for a source tab. */
export function worklistSourceLabel(source: ClassificationWorklistSource): string {
  switch (source) {
    case "all":
      return "All products";
    case "import":
      return "From Cultivera import";
    case "received":
      return "Received through intake";
  }
}

/**
 * The sentence shown when the filtered list is empty.
 *
 * Deliberately different per scope. A blanket "Nothing to show" would let
 * "there is genuinely no outstanding work" and "you filtered everything away"
 * look identical, and the reader would draw the wrong conclusion from a
 * mis-click.
 */
export function emptyWorklistMessage(filter: ClassificationWorklistFilter): string {
  const suffix =
    filter.source === "import"
      ? " among products from the Cultivera import"
      : filter.source === "received"
        ? " among products received through intake"
        : "";
  switch (filter.scope) {
    case "urgent":
      return `No urgent classification gaps${suffix} — nothing is currently selling under a looser limit than it should.`;
    case "unconfirmed":
      return `Nothing unconfirmed${suffix}.`;
    case "settled":
      return `No products have been classified yet${suffix}.`;
    case "needs_attention":
      return `Every product that needs a sales-limit classification has one${suffix}.`;
    case "all":
      return `No products on the liquid-edible shelf, and nothing that looks like a suppository${suffix}.`;
  }
}

/* ───────────────────────────────────────────────────────────────────────────── */
/* Self-tests (wired into scripts/compliance/run-pure-selftests.ts)             */
/* ───────────────────────────────────────────────────────────────────────────── */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`classification-worklist-core: ${msg}`);
}

function lot(over: Partial<WorklistLotInput> = {}): WorklistLotInput {
  return {
    lotId: "lot-1",
    posProductKey: "pos-1",
    productName: "Fizzy Lifting Drink",
    inventoryType: "Liquid Marijuana Infused Edible",
    // VERIFIED slug, not a guess: categoryToBucket() (sales-limits-core.ts:304)
    // maps "edible-liquid" -> "liquid_edible". There is no "drinks" slug.
    resolvedWebsiteCategory: "edible-liquid",
    vendorName: "Acme",
    onHandQty: 10,
    fromImport: true,
    ...over,
  };
}

type Flags = Omit<
  ProductClassificationFacts,
  "posProductKey" | "productName" | "inventoryType" | "resolvedWebsiteCategory"
>;

function flags(over: Partial<Flags> = {}): Flags {
  return {
    otherwiseTaken: null,
    unitsPerPackage: null,
    lowThcLiquid: null,
    unitThcMg: null,
    ...over,
  };
}

export function __runClassificationWorklistTests(): { passed: number } {
  let passed = 0;
  const check = (cond: boolean, msg: string) => {
    assert(cond, msg);
    passed += 1;
  };

  // ── grouping: the whole reason this module exists ─────────────────────────
  const eightLots = Array.from({ length: 8 }, (_, i) =>
    lot({ lotId: `lot-${i + 1}`, onHandQty: 5 }),
  );
  const grouped = buildClassificationWorklist(eightLots, new Map());
  check(grouped.length === 1, "eight lots of one product produced more than one row");
  check(grouped[0].lotCount === 8, "lot count did not reflect the eight lots");
  check(grouped[0].onHandTotal === 40, `on-hand total wrong: ${grouped[0].onHandTotal}`);

  // Two genuinely different products stay two rows.
  const twoProducts = buildClassificationWorklist(
    [lot({ lotId: "a", posProductKey: "pos-1" }), lot({ lotId: "b", posProductKey: "pos-2" })],
    new Map(),
  );
  check(twoProducts.length === 2, "two distinct products collapsed into one row");

  // ── lots with no product key are dropped, not listed as impossible work ───
  for (const key of [null, "", "   "]) {
    const dropped = buildClassificationWorklist([lot({ posProductKey: key })], new Map());
    check(dropped.length === 0, `lot with key ${JSON.stringify(key)} was listed`);
  }

  // ── menu truth drives status, NOT the lot row ────────────────────────────
  // An unanswered liquid product is in scope and unsettled...
  check(!grouped[0].status.settled, "unanswered product reported as settled");
  check(grouped[0].status.inScope, "liquid product not in scope");
  // ...and the SAME lots become settled once the MENU says so.
  const answered = buildClassificationWorklist(
    eightLots,
    new Map([["pos-1", flags({ otherwiseTaken: false, lowThcLiquid: false })]]),
  );
  check(answered[0].status.settled, "menu answer did not settle the product");
  check(answered[0].lotCount === 8, "settling changed the lot count");

  // A key missing from the menu map reads as UNKNOWN, never as false.
  const absent = buildClassificationWorklist([lot({ posProductKey: "pos-none" })], new Map());
  check(!absent[0].status.settled, "product absent from the menu claimed as settled");
  check(
    absent[0].status.reasons.includes("otherwise_taken_unanswered"),
    "absent menu row did not raise the unanswered reason",
  );

  // ── SLICE 18B: the shopLane column reports what a CUSTOMER would see ──────
  {
    // A fully-qualifying low-THC drink surfaces in the low-THC lane.
    const drink = buildClassificationWorklist(
      [lot({ posProductKey: "k-drink", resolvedWebsiteCategory: "edible-liquid" })],
      new Map([
        [
          "k-drink",
          { otherwiseTaken: false, unitsPerPackage: null, lowThcLiquid: true, unitThcMg: 4 },
        ],
      ]),
    );
    check(drink[0].shopLane === "low_thc_liquid", "qualifying drink reports the low-THC shop lane");

    // Flags set but the FIGURE does not qualify (9 mg > 4 mg): the register
    // would leave this in the 72 oz bucket, so the back office must say null
    // rather than promising a lane the shop will not render. This is the
    // assertion that stops the admin from lying to the owner.
    const overDosed = buildClassificationWorklist(
      [lot({ posProductKey: "k-over", resolvedWebsiteCategory: "edible-liquid" })],
      new Map([
        [
          "k-over",
          { otherwiseTaken: false, unitsPerPackage: null, lowThcLiquid: true, unitThcMg: 9 },
        ],
      ]),
    );
    check(overDosed[0].shopLane === null, "over-4mg drink reports NO shop lane");

    // A qualifying suppository surfaces in the otherwise-taken lane.
    const supp = buildClassificationWorklist(
      [lot({ posProductKey: "k-supp", resolvedWebsiteCategory: "topical" })],
      new Map([
        ["k-supp", { otherwiseTaken: true, unitsPerPackage: 6, lowThcLiquid: null, unitThcMg: null }],
      ]),
    );
    check(supp[0].shopLane === "otherwise_taken", "qualifying suppository reports its shop lane");

    // An unanswered product has no lane at all.
    const unanswered = buildClassificationWorklist(
      [lot({ posProductKey: "k-none", resolvedWebsiteCategory: "edible-liquid" })],
      new Map(),
    );
    check(unanswered[0].shopLane === null, "unanswered product reports no shop lane");
  }

  // ── out of scope is excluded from EVERY scope, including "all" ────────────
  const flowerRow = buildClassificationWorklist(
    [lot({ resolvedWebsiteCategory: "flower", productName: "Blue Dream", inventoryType: "Usable Marijuana" })],
    new Map(),
  );
  check(flowerRow.length === 1, "flower row vanished before filtering");
  check(!flowerRow[0].status.inScope, "flower pulled into scope");
  for (const scope of SCOPES) {
    const shown = filterWorklist(flowerRow, { scope, source: "all" });
    check(shown.length === 0, `flower appeared under scope=${scope}`);
  }

  // ── ordering: urgent first, then unconfirmed, then settled ───────────────
  const mixed = buildClassificationWorklist(
    [
      lot({ lotId: "s", posProductKey: "k-settled", productName: "Settled" }),
      lot({ lotId: "u", posProductKey: "k-urgent", productName: "Urgent" }),
      lot({ lotId: "c", posProductKey: "k-unconf", productName: "Unconfirmed" }),
    ],
    new Map<string, Flags>([
      ["k-settled", flags({ otherwiseTaken: false, lowThcLiquid: false })],
      // otherwiseTaken unanswered = permissive failure = urgent
      ["k-urgent", flags({ lowThcLiquid: false })],
      // only the low-THC question outstanding = conservative failure
      ["k-unconf", flags({ otherwiseTaken: false })],
    ]),
  );
  check(
    mixed.map((e) => e.posProductKey).join(",") === "k-urgent,k-unconf,k-settled",
    `worklist order wrong: ${mixed.map((e) => e.posProductKey).join(",")}`,
  );

  // Ties break by name so the order cannot drift between renders.
  //
  // STRENGTHENED after mutation testing: the first version used Zebra/"z" and
  // Apple/"a", so the NAME tiebreaker and the KEY tiebreaker agreed. Deleting
  // the name sort entirely still produced "Apple" and the test passed. The
  // keys are now deliberately in the OPPOSITE order to the names, so only a
  // genuine name sort can satisfy this.
  const tied = sortWorklist([
    { ...mixed[2], productName: "Zebra", posProductKey: "a" },
    { ...mixed[2], productName: "Apple", posProductKey: "b" },
  ]);
  check(tied[0].productName === "Apple", "equal-weight rows not ordered by name");
  check(tied[1].productName === "Zebra", "equal-weight rows not fully ordered by name");

  // ── scope filters select exactly what they name ──────────────────────────
  check(filterWorklist(mixed, { scope: "urgent", source: "all" }).length === 1, "urgent scope wrong");
  check(
    filterWorklist(mixed, { scope: "unconfirmed", source: "all" })[0].posProductKey === "k-unconf",
    "unconfirmed scope wrong",
  );
  check(
    filterWorklist(mixed, { scope: "settled", source: "all" })[0].posProductKey === "k-settled",
    "settled scope wrong",
  );
  check(
    filterWorklist(mixed, { scope: "needs_attention", source: "all" }).length === 2,
    "needs_attention should hold urgent + unconfirmed",
  );
  check(filterWorklist(mixed, { scope: "all", source: "all" }).length === 3, "all scope wrong");

  // needs_attention is exactly urgent + unconfirmed, with no overlap.
  const urgentOnly = filterWorklist(mixed, { scope: "urgent", source: "all" });
  const unconfOnly = filterWorklist(mixed, { scope: "unconfirmed", source: "all" });
  check(
    urgentOnly.length + unconfOnly.length ===
      filterWorklist(mixed, { scope: "needs_attention", source: "all" }).length,
    "needs_attention does not partition into urgent + unconfirmed",
  );

  // ── source filter: a VIEW, never the definition ──────────────────────────
  const bothDoors = buildClassificationWorklist(
    [
      lot({ lotId: "i", posProductKey: "k-import", fromImport: true }),
      lot({ lotId: "r", posProductKey: "k-recv", fromImport: false }),
    ],
    new Map(),
  );
  check(bothDoors.length === 2, "both-door fixture did not produce two products");
  check(
    filterWorklist(bothDoors, { scope: "all", source: "all" }).length === 2,
    "default source hid a door — the worklist must be source-agnostic",
  );
  check(
    filterWorklist(bothDoors, { scope: "all", source: "import" })[0].posProductKey === "k-import",
    "import filter wrong",
  );
  check(
    filterWorklist(bothDoors, { scope: "all", source: "received" })[0].posProductKey === "k-recv",
    "received filter wrong",
  );
  // The two source views must partition the population exactly.
  check(
    filterWorklist(bothDoors, { scope: "all", source: "import" }).length +
      filterWorklist(bothDoors, { scope: "all", source: "received" }).length ===
      filterWorklist(bothDoors, { scope: "all", source: "all" }).length,
    "source views do not partition the list",
  );

  // A product restocked through BOTH doors is NOT "from the import" — one
  // received lot means the receiving door is responsible for it too.
  const mixedDoors = buildClassificationWorklist(
    [
      lot({ lotId: "a", posProductKey: "k-mix", fromImport: true }),
      lot({ lotId: "b", posProductKey: "k-mix", fromImport: false }),
    ],
    new Map(),
  );
  check(mixedDoors.length === 1, "mixed-door product split into two rows");
  check(!mixedDoors[0].allFromImport, "mixed-door product claimed as import-only");

  // ── representative lot: deterministic, and prefers stock on hand ─────────
  // STRENGTHENED after mutation testing: the first version gave the stocked lot
  // the lexicographically SMALLER id ("a"), so the id tiebreaker produced the
  // same answer and deleting the stock preference survived. The stocked lot now
  // has the LARGER id, so ONLY the stock rule can pick it.
  check(
    pickRepresentativeLot([lot({ lotId: "a", onHandQty: 0 }), lot({ lotId: "b", onHandQty: 7 })]) === "b",
    "representative lot ignored stock on hand",
  );
  // ...and it must still hold when the stocked lot is listed first.
  check(
    pickRepresentativeLot([lot({ lotId: "b", onHandQty: 7 }), lot({ lotId: "a", onHandQty: 0 })]) === "b",
    "representative lot ignored stock on hand (reversed input)",
  );
  check(
    pickRepresentativeLot([lot({ lotId: "b", onHandQty: 5 }), lot({ lotId: "a", onHandQty: 5 })]) === "a",
    "representative lot not deterministic on a tie",
  );
  // Reversing the input must not change the answer — order-independence is
  // what makes the link stable between renders.
  check(
    pickRepresentativeLot([lot({ lotId: "a", onHandQty: 5 }), lot({ lotId: "b", onHandQty: 5 })]) ===
      pickRepresentativeLot([lot({ lotId: "b", onHandQty: 5 }), lot({ lotId: "a", onHandQty: 5 })]),
    "representative lot depends on input order",
  );
  // All-empty lots still yield a stable pick rather than "".
  check(
    pickRepresentativeLot([lot({ lotId: "b", onHandQty: 0 }), lot({ lotId: "a", onHandQty: 0 })]) === "a",
    "representative lot empty when no lot has stock",
  );

  // The row's NAME and the row's LINK must describe the same lot.
  // Same strengthening: the STOCKED lot carries the lexicographically larger
  // id, so a fallback to id ordering cannot fake this result.
  const named = buildClassificationWorklist(
    [
      lot({ lotId: "y", posProductKey: "k", productName: "Wrong name", onHandQty: 0 }),
      lot({ lotId: "z", posProductKey: "k", productName: "Right name", onHandQty: 9 }),
    ],
    new Map(),
  );
  check(named[0].representativeLotId === "z", "representative lot not the stocked one");
  check(named[0].productName === "Right name", "row name taken from a different lot than the link");

  // ── summary counts ──────────────────────────────────────────────────────
  const sum = summarizeWorklist(mixed);
  check(sum.inScope === 3, `summary inScope wrong: ${sum.inScope}`);
  check(sum.urgent === 1 && sum.unconfirmed === 1 && sum.settled === 1, "summary split wrong");
  check(sum.needsAttention === 2, "summary needsAttention wrong");
  check(sum.urgent + sum.unconfirmed + sum.settled === sum.inScope, "summary parts do not sum");
  check(sum.products === 3 && sum.lots === 3, "summary product/lot counts wrong");
  // Out-of-scope products never inflate the tallies.
  //
  // STRENGTHENED after mutation testing: asserting only `inScope === 0` was
  // vacuous, because summarizeClassificationStatuses() filters on inScope a
  // SECOND time downstream. Removing this module's own scope filter therefore
  // left `inScope` at 0 while `products` and `lots` silently counted the
  // flower lot — the headline "In scope" tile would have printed 1. Assert the
  // counts this module actually owns.
  const flowerSummary = summarizeWorklist(flowerRow);
  check(flowerSummary.inScope === 0, "flower counted in the summary");
  check(flowerSummary.products === 0, "flower counted in the summary product total");
  check(flowerSummary.lots === 0, "flower counted in the summary lot total");
  check(flowerSummary.needsAttention === 0, "flower counted as needing attention");
  // The summary follows the SOURCE filter but ignores the scope filter.
  check(summarizeWorklist(bothDoors, "import").products === 1, "summary ignored the source filter");

  // ── knob grammar: forgiving, but never silently widening ─────────────────
  check(parseWorklistScope("urgent") === "urgent", "valid scope rejected");
  check(parseWorklistSource("import") === "import", "valid source rejected");
  for (const junk of ["", "URGENT", "1", "nope", undefined, null, " urgent"]) {
    check(
      parseWorklistScope(junk) === DEFAULT_WORKLIST_FILTER.scope,
      `junk scope ${JSON.stringify(junk)} was accepted`,
    );
    check(
      parseWorklistSource(junk) === DEFAULT_WORKLIST_FILTER.source,
      `junk source ${JSON.stringify(junk)} was accepted`,
    );
  }
  const parsed = parseWorklistFilter({ scope: "settled", source: "received" });
  check(parsed.scope === "settled" && parsed.source === "received", "combined parse wrong");

  // ── hrefs always narrow by something (the SLICE 6A defect) ───────────────
  for (const scope of SCOPES) {
    for (const source of SOURCES) {
      const href = classificationWorklistHref({ scope, source });
      check(href.includes(`scope=${scope}`), `href dropped scope=${scope}`);
      check(href.includes(`source=${source}`), `href dropped source=${source}`);
      // A round-trip must reproduce the filter it was built from.
      const q = new URLSearchParams(href.split("?")[1]);
      const back = parseWorklistFilter({ scope: q.get("scope"), source: q.get("source") });
      check(back.scope === scope && back.source === source, `href for ${scope}/${source} did not round-trip`);
    }
  }
  check(
    classificationWorklistHref().includes("scope=needs_attention"),
    "bare href did not default to the work",
  );

  // ── copy: labels and empty states are distinct, never a blanket message ──
  const scopeLabels = SCOPES.map(worklistScopeLabel);
  check(new Set(scopeLabels).size === SCOPES.length, "two scopes share a label");
  const sourceLabels = SOURCES.map(worklistSourceLabel);
  check(new Set(sourceLabels).size === SOURCES.length, "two sources share a label");
  const emptyMessages = SCOPES.map((scope) => emptyWorklistMessage({ scope, source: "all" }));
  check(new Set(emptyMessages).size === SCOPES.length, "two scopes share an empty-state message");
  check(
    emptyWorklistMessage({ scope: "all", source: "import" }).includes("Cultivera"),
    "empty state did not name the source filter in force",
  );

  return { passed };
}
