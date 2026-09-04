/**
 * ────────────────────────────────────────────────────────────────────────────
 * SLICE 13 — the inventory page's list pipeline, end to end.
 *
 * WHY THIS MODULE EXISTS
 * ---------------------------------------------------------------------------
 * The page used to hand its filters to PostgREST and let the database do the
 * work. That is why the owner could not filter or sort by vendor, brand, THC
 * or CBD: those values live in three OTHER tables and were resolved AFTER the
 * page of rows had already been chosen (`hydrateLots`, store.ts). A query
 * cannot order by a column it has never seen.
 *
 * So the whole set is now loaded once and everything happens here, in pure
 * code. That moves the legacy filters out of SQL too — and THAT is the risk
 * this module exists to contain. Several screens deep-link into this page:
 * the compliance banner (`?needsReceivedDate=1`), the vendor cross-link
 * (`?vendor=<uuid>`), and the four "what's missing" worklists. If a rewritten
 * predicate is even slightly different from the SQL it replaces, those links
 * quietly start showing a different set of rows than the badge that sent the
 * owner there promised. A count that disagrees with its own list is exactly
 * the class of bug this codebase has been burned by before (SLICE 6A).
 *
 * Every legacy predicate below is therefore written to mirror one specific
 * PostgREST expression, the expression is quoted above it, and the gap filters
 * REUSE `LOT_GAP_DEFINITIONS.matches` rather than restating it — one
 * definition, used by the counter and the filter alike, so they cannot drift.
 *
 * ORDER OF OPERATIONS
 * ---------------------------------------------------------------------------
 *   legacy filters → new filters → smart search → sort → paginate
 *
 * Search runs INSIDE the filtered set, never across everything: if the owner
 * has narrowed to one vendor and then types, they expect to search that
 * vendor's shelf, not to have the vendor filter silently overridden.
 *
 * PURE: no I/O, no React, no clock. `now` is passed in. Self-tests registered
 * in the pure runner.
 * ────────────────────────────────────────────────────────────────────────────
 */
import {
  LOT_GAP_DEFINITIONS,
  parseGapFlag,
  type LotGapKey,
  type LotGapRow,
} from "@/lib/inventory/lot-gap-core";
import {
  parseInventoryFilters,
  countActiveFilters,
  hasActiveFilters,
  type FilterableLot,
  type InventoryFilterState,
} from "@/lib/inventory/inventory-filter-core";
import { buildInventoryList, type InventoryListResult } from "@/lib/inventory/inventory-list-core";
import {
  columnSortDef,
  type ColumnSortDef,
  type SortDirection,
} from "@/lib/inventory/inventory-sort-core";
import { currentSort, type RawParams } from "@/lib/inventory/inventory-url-core";

/**
 * A lot as this page sees it: everything the filters read, plus the raw
 * `lab_result_id` the legacy COA predicate was written against.
 */
export type PageLot = FilterableLot & { lab_result_id: string | null };

/** The legacy knobs, parsed. Kept separate so their behaviour is auditable. */
export type LegacyFilterState = {
  status: string;
  vendorId?: string;
  hasCoa?: boolean;
  isSample?: boolean;
  isMedical?: boolean;
  expiringWithinDays?: number;
  needsReceivedDate?: boolean;
  gaps: LotGapKey[];
  /** The legacy `?sort=` menu key, used only when no column header is active. */
  sortKey: string;
};

/** Read one param as a single string, tolerating the repeated-key form. */
function one(params: RawParams, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Parse the legacy knobs with EXACTLY the rules page.tsx used before this
 * slice — same regexes, same "only the literal 1 counts", same silent
 * fallbacks. Anything unparseable means "filter off"; that is this page's
 * long-standing doctrine and garbage in a URL must never throw.
 */
export function parseLegacyFilters(params: RawParams): LegacyFilterState {
  const status = one(params, "status") ?? "all";
  const rawVendor = one(params, "vendor");
  const rawExpiring = one(params, "expiring");
  const coa = one(params, "coa");
  const sample = one(params, "sample");
  const medical = one(params, "medical");
  const yesNo = (v: string | undefined): boolean | undefined =>
    v === "yes" ? true : v === "no" ? false : undefined;

  return {
    status,
    vendorId: rawVendor && /^[0-9a-f-]{36}$/i.test(rawVendor) ? rawVendor : undefined,
    hasCoa: yesNo(coa),
    isSample: yesNo(sample),
    isMedical: yesNo(medical),
    expiringWithinDays:
      rawExpiring && /^\d{1,3}$/.test(rawExpiring) ? Number(rawExpiring) : undefined,
    needsReceivedDate: one(params, "needsReceivedDate") === "1" ? true : undefined,
    gaps: LOT_GAP_DEFINITIONS.filter((d) => parseGapFlag(one(params, d.param)) === true).map(
      (d) => d.key,
    ),
    sortKey: one(params, "sort") ?? "newest",
  };
}

/** The gap predicates read this shape; PageLot supplies every field. */
function gapRow(lot: PageLot): LotGapRow {
  return {
    status: lot.status,
    on_hand_qty: lot.on_hand_qty,
    unit_cost_minor_units: lot.unit_cost_minor_units,
    lab_result_id: lot.lab_result_id,
    pos_product_key: lot.pos_product_key,
    expires_on: lot.expires_on,
  };
}

/**
 * Apply the legacy knobs. Each clause mirrors the PostgREST expression quoted
 * beside it (store.ts `listLotsPaged`).
 */
export function matchesLegacyFilters(
  lot: PageLot,
  state: LegacyFilterState,
  now: Date,
): boolean {
  // .eq("status", opts.status) — skipped entirely when status is "all"
  if (state.status && state.status !== "all" && lot.status !== state.status) return false;

  // .eq("vendor_id", opts.vendorId)
  if (state.vendorId && lot.vendor_id !== state.vendorId) return false;

  // .not("lab_result_id","is",null) / .is("lab_result_id", null)
  // NOTE: written against lab_result_id, not the hydrated `lab` object. A lot
  // can carry a lab_result_id whose row was deleted; the SQL counted that as
  // "has COA", so this does too. Matching the old behaviour exactly is the
  // point of this function.
  if (state.hasCoa === true && lot.lab_result_id == null) return false;
  if (state.hasCoa === false && lot.lab_result_id != null) return false;

  // .is("received_on", null).neq("status","destroyed")
  if (state.needsReceivedDate) {
    if (lot.received_on != null) return false;
    if (lot.status === "destroyed") return false;
  }

  // Each gap: .eq("status","active") + the gap's own predicate. Reusing
  // LOT_GAP_DEFINITIONS.matches means the badge's count and this list are
  // driven by ONE definition and cannot disagree.
  for (const key of state.gaps) {
    const def = LOT_GAP_DEFINITIONS.find((d) => d.key === key);
    if (!def) continue;
    if (!def.matches(gapRow(lot))) return false;
  }

  // .eq("is_sample", …) / .eq("is_medical", …)
  if (state.isSample !== undefined && lot.is_sample !== state.isSample) return false;
  if (state.isMedical !== undefined && lot.is_medical !== state.isMedical) return false;

  // .not("expires_on","is",null).lte("expires_on", horizon)
  if (state.expiringWithinDays != null) {
    if (lot.expires_on == null) return false;
    const horizon = new Date(now.getTime() + state.expiringWithinDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    if (String(lot.expires_on).slice(0, 10) > horizon) return false;
  }

  return true;
}

/**
 * The legacy `?sort=` menu, as comparators.
 *
 * These reproduce the PostgREST `.order()` chains in `LOT_SORTS`
 * (list-filter-core.ts), including `nullsFirst: false` — PostgREST's default
 * for a descending order puts NULLs first, and the two sorts that care say so
 * explicitly. Getting this wrong would not error; it would just quietly
 * reorder the owner's default view, which is worse.
 */
const LEGACY_SORTS: Record<string, (a: PageLot, b: PageLot) => number> = {
  newest: (a, b) => cmpText(b.created_at, a.created_at),
  oldest: (a, b) => cmpText(a.created_at, b.created_at),
  expiry: (a, b) =>
    nullsLast(a.expires_on, b.expires_on, (x, y) => cmpText(x, y)) ||
    cmpText(b.created_at, a.created_at),
  qty_high: (a, b) => cmpNum(b.on_hand_qty, a.on_hand_qty) || cmpText(b.created_at, a.created_at),
  qty_low: (a, b) => cmpNum(a.on_hand_qty, b.on_hand_qty) || cmpText(b.created_at, a.created_at),
  name: (a, b) => nullsLast(a.product_name, b.product_name, (x, y) => cmpText(x, y)),
};

function cmpText(a: string | null | undefined, b: string | null | undefined): number {
  const x = String(a ?? "");
  const y = String(b ?? "");
  return x < y ? -1 : x > y ? 1 : 0;
}
function cmpNum(a: number | null | undefined, b: number | null | undefined): number {
  const x = Number(a ?? 0);
  const y = Number(b ?? 0);
  return x < y ? -1 : x > y ? 1 : 0;
}
/** Unknown sinks regardless of direction — the same rule the column sorts use. */
function nullsLast<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  cmp: (x: T, y: T) => number,
): number {
  const aMissing = a == null || a === "";
  const bMissing = b == null || b === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return cmp(a as T, b as T);
}

/** Apply the legacy sort menu. Unknown keys fall back to the default, never throw. */
export function applyLegacySort(lots: PageLot[], sortKey: string): PageLot[] {
  const cmp = LEGACY_SORTS[sortKey] ?? LEGACY_SORTS.newest;
  if (!cmp) return lots;
  // Non-mutating and stable: index breaks ties so the order is reproducible.
  return lots
    .map((row, i) => ({ row, i }))
    .sort((p, q) => cmp(p.row, q.row) || p.i - q.i)
    .map((p) => p.row);
}

export type InventoryPageInput = {
  lots: PageLot[];
  params: RawParams;
  page: number;
  pageSize: number;
  now: Date;
};

export type InventoryPageResult = InventoryListResult<PageLot> & {
  /** Lots surviving the LEGACY knobs only — what the facet menus are built from. */
  facetSource: PageLot[];
  filters: InventoryFilterState;
  legacy: LegacyFilterState;
  column: ColumnSortDef | null;
  direction: SortDirection | null;
  activeFilterCount: number;
  anyFilterActive: boolean;
};

/**
 * Build everything the page renders, from raw params and the full lot set.
 *
 * The facet menus are built from `facetSource` — the set after the LEGACY
 * knobs but before this slice's own filters. That is deliberate: inside the
 * "missing expiry" worklist the vendor menu should list the vendors in THAT
 * worklist (the legacy knob defines which job the owner is doing), but
 * choosing vendor A must not erase vendor B from the menu, or there would be
 * no way to switch without clearing first.
 */
export function buildInventoryPage(input: InventoryPageInput): InventoryPageResult {
  const legacy = parseLegacyFilters(input.params);
  const filters = parseInventoryFilters(input.params);

  const facetSource = input.lots.filter((l) => matchesLegacyFilters(l, legacy, input.now));

  const cur = currentSort(input.params);
  const column = cur ? columnSortDef(cur.key) ?? null : null;
  const direction = cur && column ? cur.direction : null;

  // With no column header active, the legacy `?sort=` menu still orders the
  // list exactly as it always has. Pre-sorting here means the pipeline's
  // stable sort preserves it, so the default view is unchanged by this slice.
  const ordered = column && direction ? facetSource : applyLegacySort(facetSource, legacy.sortKey);

  const list = buildInventoryList<PageLot>({
    lots: ordered,
    filters,
    query: one(input.params, "q") ?? "",
    column,
    direction,
    page: input.page,
    pageSize: input.pageSize,
  });

  return {
    ...list,
    facetSource,
    filters,
    legacy,
    column,
    direction,
    activeFilterCount: countActiveFilters(filters),
    anyFilterActive: hasActiveFilters(filters),
  };
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------

/** A minimal valid page lot; tests override only what they care about. */
export function __testPageLot(over: Partial<PageLot> = {}): PageLot {
  return {
    id: "lot-1",
    lot_code: "LC-1",
    pos_product_key: "POS-1",
    product_name: "Blue Dream 3.5g",
    strain_type: "hybrid",
    status: "active",
    is_sample: false,
    is_medical: false,
    low_thc_liquid: null,
    otherwise_taken: null,
    unit: "ea",
    unit_cost_minor_units: 1000,
    unit_thc_mg: null,
    units_per_package: null,
    expires_on: null,
    received_on: "2026-01-10",
    received_on_source: "manifest",
    notes: null,
    vendor_id: "v-1",
    brand_id: "b-1",
    vendor_name: "Phat Panda",
    brand_name: "Panda",
    lab: null,
    lab_result_id: null,
    created_at: "2026-01-10T00:00:00Z",
    category: "Flower",
    inventory_type: "Usable Marijuana",
    unit_weight: 3.5,
    unit_weight_uom: "g",
    received_qty: 10,
    on_hand_qty: 10,
    strain_name: "Blue Dream",
    ...over,
  };
}

export function __runInventoryPageCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    n += 1;
    if (!cond) throw new Error(`inventory-page-core: ${msg}`);
  };
  const NOW = new Date("2026-06-01T12:00:00Z");

  // ---- legacy param parsing matches the page's old rules exactly
  ok(parseLegacyFilters({}).status === "all", "absent status means all");
  ok(parseLegacyFilters({ vendor: "not-a-uuid" }).vendorId === undefined, "junk vendor is off");
  const UUID = "0123abcd-0123-0123-0123-0123456789ab";
  ok(parseLegacyFilters({ vendor: UUID }).vendorId === UUID, "uuid vendor accepted");
  ok(parseLegacyFilters({ expiring: "30" }).expiringWithinDays === 30, "expiring parsed");
  ok(parseLegacyFilters({ expiring: "9999" }).expiringWithinDays === undefined, "4 digits is off");
  ok(parseLegacyFilters({ expiring: "abc" }).expiringWithinDays === undefined, "junk expiring off");
  ok(parseLegacyFilters({ needsReceivedDate: "1" }).needsReceivedDate === true, "worklist on");
  ok(
    parseLegacyFilters({ needsReceivedDate: "true" }).needsReceivedDate === undefined,
    "only literal 1 turns the worklist on",
  );
  ok(parseLegacyFilters({ coa: "yes" }).hasCoa === true, "coa yes");
  ok(parseLegacyFilters({ coa: "no" }).hasCoa === false, "coa no");
  ok(parseLegacyFilters({ coa: "maybe" }).hasCoa === undefined, "junk coa is off");
  ok(parseLegacyFilters({ missingExpiry: "1" }).gaps.includes("missingExpiry"), "gap flag on");
  ok(parseLegacyFilters({ missingExpiry: "0" }).gaps.length === 0, "gap flag off");

  // ---- legacy predicates
  const base = __testPageLot();
  ok(matchesLegacyFilters(base, parseLegacyFilters({}), NOW), "no filters passes everything");
  ok(
    !matchesLegacyFilters(base, parseLegacyFilters({ status: "quarantine" }), NOW),
    "status narrows",
  );
  ok(
    matchesLegacyFilters(base, parseLegacyFilters({ status: "all" }), NOW),
    "status=all is not a predicate",
  );

  // COA is judged on lab_result_id, exactly like the SQL it replaces.
  ok(
    !matchesLegacyFilters(base, parseLegacyFilters({ coa: "yes" }), NOW),
    "no lab_result_id fails has-COA",
  );
  ok(
    matchesLegacyFilters(base, parseLegacyFilters({ coa: "no" }), NOW),
    "no lab_result_id passes missing-COA",
  );
  const orphan = __testPageLot({ lab_result_id: "lr-1", lab: null });
  ok(
    matchesLegacyFilters(orphan, parseLegacyFilters({ coa: "yes" }), NOW),
    "an id with no joined row still counts as has-COA, as the SQL did",
  );

  // needsReceivedDate excludes destroyed, mirroring the counter.
  const noDate = __testPageLot({ received_on: null });
  ok(
    matchesLegacyFilters(noDate, parseLegacyFilters({ needsReceivedDate: "1" }), NOW),
    "missing received date is in the worklist",
  );
  ok(
    !matchesLegacyFilters(
      __testPageLot({ received_on: null, status: "destroyed" }),
      parseLegacyFilters({ needsReceivedDate: "1" }),
      NOW,
    ),
    "destroyed lots are out of the received-date worklist",
  );
  ok(
    !matchesLegacyFilters(base, parseLegacyFilters({ needsReceivedDate: "1" }), NOW),
    "a lot WITH a received date is not in the worklist",
  );

  // Expiry window is inclusive of the horizon day and excludes unknowns.
  const onHorizon = __testPageLot({ expires_on: "2026-07-01" }); // exactly +30d
  ok(
    matchesLegacyFilters(onHorizon, parseLegacyFilters({ expiring: "30" }), NOW),
    "the horizon day itself is included",
  );
  ok(
    !matchesLegacyFilters(
      __testPageLot({ expires_on: "2026-07-02" }),
      parseLegacyFilters({ expiring: "30" }),
      NOW,
    ),
    "one day past the horizon is excluded",
  );
  ok(
    !matchesLegacyFilters(base, parseLegacyFilters({ expiring: "30" }), NOW),
    "no expiry date is excluded from an expiry window",
  );
  // A timestamp-shaped expires_on must not be dropped by the string compare.
  ok(
    matchesLegacyFilters(
      __testPageLot({ expires_on: "2026-07-01T23:59:00Z" }),
      parseLegacyFilters({ expiring: "30" }),
      NOW,
    ),
    "a timestamp on the horizon day still counts",
  );

  // Gap filters reuse the counter's own predicates.
  for (const def of LOT_GAP_DEFINITIONS) {
    const state = parseLegacyFilters({ [def.param]: "1" });
    ok(state.gaps.length === 1, `gap ${def.key} parses alone`);
    // A non-active lot can never be in a gap worklist.
    ok(
      !matchesLegacyFilters(__testPageLot({ status: "sold_out" }), state, NOW),
      `gap ${def.key} is scoped to active lots`,
    );
  }
  ok(
    matchesLegacyFilters(
      __testPageLot({ status: "active", pos_product_key: "" }),
      parseLegacyFilters({ missingProductLink: "1" }),
      NOW,
    ),
    "EMPTY STRING pos key counts as unlinked, matching the counter",
  );
  ok(
    matchesLegacyFilters(
      __testPageLot({ status: "active", on_hand_qty: -2 }),
      parseLegacyFilters({ emptyActive: "1" }),
      NOW,
    ),
    "negative on-hand counts as empty, matching <= 0",
  );

  // ---- legacy sort menu
  const a = __testPageLot({ id: "a", created_at: "2026-01-01T00:00:00Z", on_hand_qty: 5, product_name: "Alpha" });
  const b = __testPageLot({ id: "b", created_at: "2026-03-01T00:00:00Z", on_hand_qty: 9, product_name: "Beta" });
  const c = __testPageLot({ id: "c", created_at: "2026-02-01T00:00:00Z", on_hand_qty: 1, product_name: null });
  const set = [a, b, c];
  ok(applyLegacySort(set, "newest").map((l) => l.id).join("") === "bca", "newest is created desc");
  ok(applyLegacySort(set, "oldest").map((l) => l.id).join("") === "acb", "oldest is created asc");
  ok(applyLegacySort(set, "qty_high").map((l) => l.id).join("") === "bac", "qty_high is desc");
  ok(applyLegacySort(set, "qty_low").map((l) => l.id).join("") === "cab", "qty_low is asc");
  ok(applyLegacySort(set, "name")[2]?.id === "c", "a null product name sorts LAST");
  ok(
    applyLegacySort(set, "not-a-sort").map((l) => l.id).join("") === "bca",
    "an unknown sort key falls back to the default, never throws",
  );
  // Expiry: real dates ascending, unknowns last.
  const e1 = __testPageLot({ id: "e1", expires_on: "2026-09-01" });
  const e2 = __testPageLot({ id: "e2", expires_on: "2026-08-01" });
  const e3 = __testPageLot({ id: "e3", expires_on: null });
  ok(
    applyLegacySort([e1, e2, e3], "expiry").map((l) => l.id).join("") === "e2e1e3",
    "expiry sorts soonest first with unknowns last",
  );
  // Sorting must not mutate the caller's array.
  const orig = [a, b, c];
  applyLegacySort(orig, "qty_high");
  ok(orig[0]?.id === "a", "legacy sort does not mutate its input");

  // ---- the whole pipeline
  const lots = [
    __testPageLot({ id: "1", product_name: "Blue Dream", vendor_name: "Phat Panda", on_hand_qty: 3 }),
    __testPageLot({ id: "2", product_name: "Green Crack", vendor_name: "Grow Op Farms, LLC", on_hand_qty: 7 }),
    __testPageLot({ id: "3", product_name: "Purple Punch", vendor_name: "Phat Panda", on_hand_qty: 1, status: "quarantine" }),
  ];
  const all = buildInventoryPage({ lots, params: {}, page: 1, pageSize: 50, now: NOW });
  ok(all.total === 3, "no filters shows everything");
  ok(all.column === null && all.direction === null, "no column sort by default");

  // A legacy knob narrows the facet source too.
  const activeOnly = buildInventoryPage({
    lots,
    params: { status: "active" },
    page: 1,
    pageSize: 50,
    now: NOW,
  });
  ok(activeOnly.total === 2, "status tab narrows the list");
  ok(activeOnly.facetSource.length === 2, "facet menus are built inside the status tab");

  /**
   * REGRESSION — the real comma-bearing vendor must be selectable end to end.
   * "Grow Op Farms, LLC" is an actual vendor in this store.
   */
  const byVendor = buildInventoryPage({
    lots,
    params: { fVendor: "Grow Op Farms, LLC" },
    page: 1,
    pageSize: 50,
    now: NOW,
  });
  ok(byVendor.total === 1, "comma-bearing vendor facet matches its lot");
  ok(byVendor.rows[0]?.id === "2", "and it is the right lot");

  // Facet menus are NOT narrowed by this slice's own facets, so the owner can
  // switch vendors without clearing first.
  ok(byVendor.facetSource.length === 3, "choosing a vendor keeps every vendor in the menu");

  // Search runs inside the filtered set.
  const scoped = buildInventoryPage({
    lots,
    params: { fVendor: "Phat Panda", q: "green" },
    page: 1,
    pageSize: 50,
    now: NOW,
  });
  ok(scoped.total === 0, "search cannot escape an active facet filter");

  // Typo tolerance, end to end — the owner's actual complaint.
  const typo = buildInventoryPage({
    lots,
    params: { q: "purpel" },
    page: 1,
    pageSize: 50,
    now: NOW,
  });
  ok(typo.total === 1, "a typo still finds the product");
  ok(typo.rows[0]?.id === "3", "and finds the RIGHT product");
  ok(typo.didYouMean === true, "a fuzzy result is disclosed as a guess");

  // A middle-of-word fragment finds it too, and is NOT a guess.
  const mid = buildInventoryPage({ lots, params: { q: "rack" }, page: 1, pageSize: 50, now: NOW });
  ok(mid.total === 1 && mid.rows[0]?.id === "2", "a mid-word fragment matches");
  ok(mid.didYouMean === false, "a real substring hit is not labelled a guess");

  // A column sort overrides the legacy menu.
  const sorted = buildInventoryPage({
    lots,
    params: { sc: "onhand", sd: "desc" },
    page: 1,
    pageSize: 50,
    now: NOW,
  });
  ok(sorted.column?.key === "onhand", "column sort is picked up");
  ok(sorted.rows.map((l) => l.on_hand_qty).join(",") === "7,3,1", "on-hand sorts high to low");
  const sortedAsc = buildInventoryPage({
    lots,
    params: { sc: "onhand", sd: "asc" },
    page: 1,
    pageSize: 50,
    now: NOW,
  });
  ok(sortedAsc.rows.map((l) => l.on_hand_qty).join(",") === "1,3,7", "and low to high reversed");

  // Pagination clamps rather than showing an empty screen.
  const past = buildInventoryPage({ lots, params: {}, page: 99, pageSize: 2, now: NOW });
  ok(past.page === 2 && past.rows.length === 1, "a page past the end clamps to the last page");
  ok(past.totalPages === 2, "total pages is honest");

  // Garbage never throws.
  const junk = buildInventoryPage({
    lots,
    params: { sc: "nope", sd: "sideways", thcMin: "abc", status: "zzz", expiring: "!!" },
    page: -5,
    pageSize: 0,
    now: NOW,
  });
  ok(junk.column === null, "unknown sort column is ignored");
  ok(junk.total === 0, "an unknown status tab legitimately matches nothing");
  ok(junk.page >= 1, "page is always at least 1");

  // An empty store is not an error.
  const empty = buildInventoryPage({ lots: [], params: { q: "x" }, page: 1, pageSize: 50, now: NOW });
  ok(empty.total === 0 && empty.rows.length === 0 && empty.totalPages === 1, "empty store is fine");

  // Filter counting drives the badge.
  ok(
    buildInventoryPage({ lots, params: { fVendor: "Phat Panda", thcMin: "10" }, page: 1, pageSize: 50, now: NOW })
      .activeFilterCount === 2,
    "the badge counts each engaged filter",
  );
  ok(all.activeFilterCount === 0, "no filters means no badge");

  console.log(`inventory-page-core: ${n} assertions passed`);
}
