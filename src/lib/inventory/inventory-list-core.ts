/**
 * src/lib/inventory/inventory-list-core.ts  (SLICE 13)
 *
 * The inventory list pipeline, in one pure function.
 *
 * ORDER OF OPERATIONS, AND WHY IT IS THIS ORDER
 * -----------------------------------------------------------------------
 *   1. FILTER first. Facets and ranges are precise, cheap, and they define
 *      the universe the owner is working in. Searching before filtering would
 *      make the fuzzy fallback fire against products the filters had already
 *      excluded.
 *   2. SEARCH second, INSIDE the filtered set. This matters for the
 *      typo-tolerant fallback: "did you mean" should only ever be offered
 *      from among the lots the owner is actually looking at. Searching a
 *      vendor's shelf for "dreem" must not surface another vendor's Blue
 *      Dream just because the filtered shelf had no strict hit.
 *   3. SORT third. An explicit column sort is an instruction and must win
 *      over relevance ordering. When there is NO column sort and there IS a
 *      query, relevance order is kept — that is the useful default.
 *   4. PAGINATE last, over the final ordered result, so "Showing 1-100 of
 *      412" counts the rows that actually matched.
 *
 * FACET COUNTS ARE COMPUTED BEFORE SEARCH+SORT BUT AFTER NOTHING
 * -----------------------------------------------------------------------
 * The dropdowns are built from the UNFILTERED set. If they were built from
 * the filtered set, choosing "Vendor: Fweedom" would erase every other vendor
 * from the vendor dropdown and the owner could never switch vendors without
 * clearing the filter first — a well-known dead end in faceted UIs.
 *
 * PURE: no I/O, no React. Self-tests registered in the pure runner.
 */
import {
  filterLots,
  type FilterableLot,
  type InventoryFilterState,
} from "@/lib/inventory/inventory-filter-core";
import {
  searchInventoryRows,
  type SearchableRow,
  type SearchField,
} from "@/lib/inventory/inventory-search-core";
import {
  sortLots,
  type ColumnSortDef,
  type SortDirection,
} from "@/lib/inventory/inventory-sort-core";

/**
 * The fields search looks at, with their weights.
 *
 * WEIGHTS ARE ORDERED BY HOW SPECIFICALLY A HIT IDENTIFIES THE LOT. A lot
 * code or POS key is an identifier — if it matches, that is almost certainly
 * the row wanted, so those rank highest. The product name is next. Vendor,
 * brand and strain are shared by many lots, so a hit there is a weaker
 * signal. Notes are free text and rank lowest, but ARE searched: the old
 * search ignored them entirely, which is part of why things could not be
 * found.
 */
export function searchFieldsForLot(lot: FilterableLot): SearchField[] {
  return [
    { text: lot.lot_code, weight: 3 },
    { text: lot.pos_product_key, weight: 3 },
    { text: lot.product_name, weight: 2.5 },
    { text: lot.strain_name, weight: 2 },
    { text: lot.brand_name, weight: 1.8 },
    { text: lot.vendor_name, weight: 1.6 },
    { text: lot.category, weight: 1.4 },
    { text: lot.inventory_type, weight: 1.2 },
    { text: lot.strain_type, weight: 1.2 },
    { text: lot.status, weight: 1 },
    { text: lot.unit_weight_uom, weight: 1 },
    { text: lot.notes, weight: 0.8 },
  ];
}

export type InventoryListInput<T extends FilterableLot> = {
  lots: T[];
  filters: InventoryFilterState;
  query: string;
  column: ColumnSortDef | null;
  direction: SortDirection | null;
  /** 1-based page number. */
  page: number;
  pageSize: number;
};

export type InventoryListResult<T> = {
  /** The rows for the requested page. */
  rows: T[];
  /** How many rows matched, before pagination. */
  total: number;
  /** The page actually served (clamped when the request is past the end). */
  page: number;
  totalPages: number;
  /** True when results came from the typo-tolerant fallback. */
  didYouMean: boolean;
};

/**
 * Run the whole pipeline. Deterministic and total: any page number, any
 * page size, empty input — all produce a well-formed result rather than an
 * exception, matching the page's "garbage means off" doctrine.
 */
export function buildInventoryList<T extends FilterableLot>(
  input: InventoryListInput<T>,
): InventoryListResult<T> {
  const pageSize = Math.max(1, Math.floor(input.pageSize) || 1);

  // 1. filter
  const filtered = filterLots(input.lots, input.filters);

  // 2. search inside the filtered set
  const searchable: SearchableRow<T>[] = filtered.map((row) => ({
    row,
    fields: searchFieldsForLot(row),
  }));
  const found = searchInventoryRows(searchable, input.query);
  let rows = found.rows;

  // 3. an explicit column sort overrides relevance order
  if (input.column && input.direction) {
    rows = sortLots(rows, input.column, input.direction);
  }

  // 4. paginate
  const total = rows.length;
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);
  const requested = Number.isFinite(input.page) ? Math.floor(input.page) : 1;
  const page = Math.min(Math.max(1, requested), totalPages);
  const start = (page - 1) * pageSize;

  return {
    rows: rows.slice(start, start + pageSize),
    total,
    page,
    totalPages,
    didYouMean: found.didYouMean,
  };
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------

export function __runInventoryListCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL inventory-list-core: " + msg);
    passed += 1;
  };

  const lot = (over: Partial<FilterableLot>): FilterableLot =>
    ({
      id: "x",
      lot_code: null,
      pos_product_key: null,
      product_name: null,
      strain_name: null,
      strain_type: null,
      category: null,
      inventory_type: "Usable Marijuana",
      unit_weight: null,
      unit_weight_uom: null,
      received_qty: 0,
      on_hand_qty: 0,
      unit: "ea",
      status: "active",
      is_sample: false,
      is_medical: false,
      low_thc_liquid: null,
      otherwise_taken: null,
      unit_cost_minor_units: null,
      unit_thc_mg: null,
      units_per_package: null,
      expires_on: null,
      received_on: null,
      received_on_source: null,
      notes: null,
      created_at: "2026-01-01T00:00:00.000Z",
      vendor_id: null,
      brand_id: null,
      vendor_name: null,
      brand_name: null,
      lab: null,
      ...over,
    }) as FilterableLot;

  const run = <T extends FilterableLot>(o: Partial<InventoryListInput<T>> & { lots: T[] }) =>
    buildInventoryList({
      filters: { facets: {} },
      query: "",
      column: null,
      direction: null,
      page: 1,
      pageSize: 100,
      ...o,
    });

  // ---- empty input is well formed, never an exception
  const none = run({ lots: [] as FilterableLot[] });
  ok(none.rows.length === 0 && none.total === 0, "no lots yields no rows");
  ok(none.page === 1 && none.totalPages === 1, "empty result still reports page 1 of 1");

  // ---- pagination
  const many = Array.from({ length: 25 }, (_, i) =>
    lot({ id: `l${i}`, product_name: `Product ${String(i).padStart(2, "0")}` }),
  );
  const p1 = run({ lots: many, pageSize: 10 });
  ok(p1.rows.length === 10 && p1.total === 25 && p1.totalPages === 3, "page 1 of 3");
  const p3 = run({ lots: many, pageSize: 10, page: 3 });
  ok(p3.rows.length === 5, "last page is short");
  const past = run({ lots: many, pageSize: 10, page: 99 });
  ok(past.page === 3 && past.rows.length === 5, "a page past the end clamps to the last page");
  const before = run({ lots: many, pageSize: 10, page: 0 });
  ok(before.page === 1, "page 0 clamps to 1");
  const zeroSize = run({ lots: many, pageSize: 0 });
  ok(zeroSize.rows.length === 1, "a zero page size is coerced to 1, never a divide-by-zero");

  // ---- ORDER OF OPERATIONS: search runs INSIDE the filter
  const fweedom = lot({ id: "f", product_name: "Blue Dream", vendor_name: "Fweedom Farms" });
  const panda = lot({ id: "p", product_name: "Blue Dream", vendor_name: "Phat Panda" });
  const scoped = run({
    lots: [fweedom, panda],
    filters: { facets: { fVendor: ["Fweedom Farms"] } },
    query: "blue dream",
  });
  ok(scoped.total === 1 && scoped.rows[0]?.id === "f", "search is scoped to the filtered set");

  // The fuzzy fallback must ALSO stay inside the filter — a typo must not
  // leak another vendor's product into a vendor-filtered view.
  const typoScoped = run({
    lots: [fweedom, panda],
    filters: { facets: { fVendor: ["Phat Panda"] } },
    query: "dreem",
  });
  ok(typoScoped.total === 1, "the typo fallback searches only the filtered set");
  ok(typoScoped.rows[0]?.id === "p", "and returns the filtered vendor's lot");
  ok(typoScoped.didYouMean === true, "the fallback is still disclosed");

  // ---- a column sort OVERRIDES relevance order
  const exactName = lot({ id: "exact", product_name: "Dream" });
  const partial = lot({ id: "partial", product_name: "Dream Weaver Extra" });
  const relevance = run({ lots: [partial, exactName], query: "dream" });
  ok(relevance.rows[0]?.id === "exact", "with no column sort, best relevance leads");
  const forced = run({
    lots: [partial, exactName],
    query: "dream",
    column: {
      key: "product",
      label: "Product",
      kind: "text",
      firstClick: "asc",
      text: (l) => l.product_name,
    },
    direction: "desc",
  });
  ok(forced.rows[0]?.id === "partial", "an explicit column sort wins over relevance");

  // ---- filters and search compose
  const shelf = [
    lot({ id: "a", product_name: "Blue Dream", on_hand_qty: 0 }),
    lot({ id: "b", product_name: "Blue Dream", on_hand_qty: 5 }),
  ];
  const inStock = run({ lots: shelf, query: "blue", filters: { facets: {}, qtyMin: 1 } });
  ok(inStock.total === 1 && inStock.rows[0]?.id === "b", "range filter and search combine");

  // ---- searchFieldsForLot covers the fields the old search ignored
  const fields = searchFieldsForLot(
    lot({ notes: "damaged case", brand_name: "Fweedom", strain_name: "GG4" }),
  );
  const texts = fields.map((f) => String(f.text ?? ""));
  ok(texts.includes("damaged case"), "notes are searchable (the old search ignored them)");
  ok(texts.includes("Fweedom"), "brand is searchable");
  ok(texts.includes("GG4"), "strain is searchable");
  ok(
    fields.every((f) => f.weight > 0),
    "every searchable field carries a positive weight",
  );
  // Identifiers must outweigh free text, or a notes hit could outrank a lot code.
  const byName = new Map(fields.map((f, i) => [i, f.weight]));
  ok(byName.size === fields.length, "weights are per field");
  const lotCodeWeight = searchFieldsForLot(lot({ lot_code: "X" }))[0]?.weight ?? 0;
  const notesWeight =
    searchFieldsForLot(lot({ notes: "X" })).find((f) => f.text === "X")?.weight ?? 99;
  ok(lotCodeWeight > notesWeight, "a lot-code hit outranks a notes hit");

  // ---- searching by brand and vendor now works at all
  const brandHit = run({
    lots: [lot({ id: "z", product_name: "Nameless", brand_name: "Fweedom" })],
    query: "fweedom",
  });
  ok(brandHit.total === 1, "a brand-only query finds the lot (impossible before this slice)");

  // ---- an unmatched query returns nothing, and says nothing was guessed
  const miss = run({ lots: [lot({ product_name: "Blue Dream" })], query: "xyzzy" });
  ok(miss.total === 0 && miss.didYouMean === false, "a true miss is reported honestly");

  console.log(`inventory-list-core: ${passed} assertions passed`);
}
