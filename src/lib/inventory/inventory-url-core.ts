/**
 * ────────────────────────────────────────────────────────────────────────────
 * SLICE 13 — inventory list URLs: header sort links, facet toggles, chips.
 *
 * WHY THIS IS A PURE MODULE AND NOT INLINE JSX
 * ---------------------------------------------------------------------------
 * Every piece of list state on /admin/inventory lives in the query string —
 * there is no client component and no React state. That is a deliberate,
 * pre-existing property of the page: it means a filtered view can be
 * bookmarked, linked to a colleague, or reloaded without anything getting out
 * of sync. The cost is that every interactive control is really a LINK, and
 * building those links correctly is fiddly, high-consequence logic:
 *
 *   * clicking a column header must keep every filter the owner set,
 *   * removing one chip must remove EXACTLY one value and keep the rest,
 *   * any change to what is being shown must reset to page 1, otherwise the
 *     owner lands on page 7 of a 2-page result and sees an empty screen and
 *     concludes the filter is broken.
 *
 * Inline, that logic would be untestable. Here it is pure string-in/string-out
 * and every rule above is pinned by a self-test below.
 *
 * PARAMS THAT MUST SURVIVE
 * ---------------------------------------------------------------------------
 * The page has accumulated deep-links from elsewhere in the app:
 * `?needsReceivedDate=1` (the compliance banner), `?vendor=<uuid>` (the
 * vendors ⇄ inventory cross-link), the four SLICE 7 gap knobs, and the SLICE 8
 * `bulk*` family. Those are not this slice's params, but dropping one would
 * silently break another screen's link. `PRESERVED_PARAMS` names them and a
 * self-test asserts they survive a sort click.
 *
 * PURE: no I/O, no React. Self-tests registered in the pure runner.
 * ────────────────────────────────────────────────────────────────────────────
 */
import {
  INVENTORY_FACETS,
  UNSET_FACET_VALUE,
  UNSET_FACET_LABEL,
  type InventoryFilterState,
} from "@/lib/inventory/inventory-filter-core";
import {
  INVENTORY_COLUMN_SORTS,
  columnSortDef,
  nextSortState,
  parseDirection,
  type ColumnSortDef,
  type SortDirection,
} from "@/lib/inventory/inventory-sort-core";

/** The page's own path. Single constant so links cannot drift apart. */
export const INVENTORY_PATH = "/admin/inventory";

/** URL key for the clicked column and its direction (append-only contract). */
export const SORT_COLUMN_PARAM = "sc";
export const SORT_DIRECTION_PARAM = "sd";

/**
 * Params that belong to OTHER features and must never be dropped when this
 * slice rewrites the query string. Deep links from other screens depend on
 * them; see the header comment.
 */
export const PRESERVED_PARAMS: readonly string[] = [
  "status",
  "q",
  "sort",
  "coa",
  "sample",
  "medical",
  "expiring",
  "vendor",
  "needsReceivedDate",
  "missingProductLink",
  "emptyActive",
  "missingExpiry",
  "unknownCost",
  "bulk",
  "bulkField",
  "bulkValue",
  "bulkPreview",
  "bulkSkipped",
  "bulkIds",
  "bulkDone",
  "bulkFailed",
  "bulkError",
];

/** A bag of raw URL params (the shape Next.js hands a server component). */
export type RawParams = Record<string, string | string[] | undefined>;

/**
 * Rebuild a URLSearchParams from the incoming params, preserving repeated
 * keys. `URLSearchParams` is used rather than manual string building so that
 * encoding is handled by the platform: a vendor named "Grow Op Farms, LLC" or
 * a strain with an ampersand must round-trip exactly, and hand-rolled
 * concatenation is where that reliably goes wrong.
 */
export function paramsFrom(raw: RawParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) out.append(key, String(v));
    } else {
      out.append(key, String(value));
    }
  }
  return out;
}

/** Render a query string back onto the page path, omitting a bare "?". */
export function hrefFrom(params: URLSearchParams): string {
  // Sorting keeps links stable between renders, which keeps them cacheable
  // and makes them comparable in tests.
  params.sort();
  const qs = params.toString();
  return qs ? `${INVENTORY_PATH}?${qs}` : INVENTORY_PATH;
}

/**
 * Any change to WHAT is shown resets pagination. Without this the owner
 * filters from page 6, lands past the end of a shorter result, and sees an
 * empty table — which reads as "the filter is broken" rather than "you are
 * past the end".
 */
function resetPage(params: URLSearchParams): void {
  params.delete("page");
}

/* ── Column header sort links ─────────────────────────────────────────────── */

/**
 * The sort currently in force, read from the URL. Returns null when no column
 * sort is active (the page then falls back to its legacy `?sort=` menu, which
 * still works exactly as before).
 */
export function currentSort(
  raw: RawParams,
): { key: string; direction: SortDirection } | null {
  const rawKey = raw[SORT_COLUMN_PARAM];
  const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
  const def = columnSortDef(key);
  if (!def) return null;
  const rawDir = raw[SORT_DIRECTION_PARAM];
  const dir = parseDirection(Array.isArray(rawDir) ? rawDir[0] : rawDir);
  // A known column with a garbage direction means "sorted, default direction"
  // rather than "not sorted" — the owner clicked the header, so honour it.
  return { key: def.key, direction: dir ?? def.firstClick };
}

/**
 * The href for clicking a column header, implementing the three-state cycle
 * (unsorted → the column's natural direction → reversed → off).
 */
export function sortHref(raw: RawParams, column: ColumnSortDef): string {
  const params = paramsFrom(raw);
  const next = nextSortState(column, currentSort(raw));
  params.delete(SORT_COLUMN_PARAM);
  params.delete(SORT_DIRECTION_PARAM);
  if (next) {
    params.set(SORT_COLUMN_PARAM, next.key);
    params.set(SORT_DIRECTION_PARAM, next.direction);
  }
  resetPage(params);
  return hrefFrom(params);
}

/**
 * The arrow shown in a column header. Only the active column gets one, so the
 * header row never looks like several columns are sorted at once.
 */
export function sortIndicator(
  raw: RawParams,
  column: ColumnSortDef,
): "asc" | "desc" | null {
  const cur = currentSort(raw);
  if (!cur || cur.key !== column.key) return null;
  return cur.direction;
}

/**
 * Screen-reader/tooltip text for a header. Says what clicking will DO, not
 * what the state is — a header is a control, and controls should describe
 * their action.
 */
export function sortActionLabel(raw: RawParams, column: ColumnSortDef): string {
  const next = nextSortState(column, currentSort(raw));
  if (!next) return `Remove sorting on ${column.label}`;
  const dir =
    next.direction === "asc"
      ? column.kind === "text"
        ? "A to Z"
        : column.kind === "date"
          ? "oldest first"
          : "lowest first"
      : column.kind === "text"
        ? "Z to A"
        : column.kind === "date"
          ? "newest first"
          : "highest first";
  return `Sort by ${column.label}, ${dir}`;
}

/* ── Facet toggle links ───────────────────────────────────────────────────── */

/**
 * Toggle one value of one facet on or off, leaving every other value of that
 * facet — and every other filter — untouched.
 *
 * Values are written as REPEATED KEYS, never joined with a delimiter, because
 * facet values are arbitrary user data. This store really does have a vendor
 * called "Grow Op Farms, LLC"; a comma-joined encoding turns it into two
 * vendors that do not exist and the filter matches nothing. (That defect was
 * found and fixed in inventory-filter-core.ts; this module must not
 * reintroduce it from the writing side.)
 */
export function toggleFacetHref(
  raw: RawParams,
  param: string,
  value: string,
  selected: readonly string[],
): string {
  const params = paramsFrom(raw);
  params.delete(param);
  const next = selected.includes(value)
    ? selected.filter((v) => v !== value)
    : [...selected, value];
  for (const v of next) params.append(param, v);
  resetPage(params);
  return hrefFrom(params);
}

/** Clear one entire facet (the "x" on a facet's header). */
export function clearFacetHref(raw: RawParams, param: string): string {
  const params = paramsFrom(raw);
  params.delete(param);
  resetPage(params);
  return hrefFrom(params);
}

/** Remove any single param — used by the scalar chips (ranges, tri-states). */
export function clearParamHref(raw: RawParams, param: string): string {
  const params = paramsFrom(raw);
  params.delete(param);
  resetPage(params);
  return hrefFrom(params);
}

/**
 * Clear EVERY filter this slice owns, plus the legacy knobs, while keeping the
 * status tab. Deliberately keeps `status` because the tabs are a separate
 * control above the panel and yanking the tab out from under the owner when
 * they hit "clear filters" would be surprising.
 */
export function clearAllFiltersHref(raw: RawParams): string {
  const params = paramsFrom(raw);
  const keep = new URLSearchParams();
  const status = params.get("status");
  if (status) keep.set("status", status);
  return hrefFrom(keep);
}

/* ── Active-filter chips ──────────────────────────────────────────────────── */

/** One removable chip describing an engaged filter in plain language. */
export type FilterChip = {
  /** Which control it came from, e.g. "Vendor". */
  group: string;
  /** The value in plain language, e.g. "Grow Op Farms, LLC". */
  label: string;
  /** Where clicking the chip's "x" goes. */
  href: string;
};

const TRI_LABEL: Record<string, string> = {
  yes: "yes",
  no: "no",
  unknown: "unknown",
};

/**
 * Scalar (non-facet) filters, as data: the URL param, the human group name,
 * and how to render the value. Driving the chips from a list means a filter
 * cannot be active-but-invisible, which is the failure mode that makes people
 * distrust a filtered list ("why am I seeing so few rows?").
 */
const SCALAR_CHIPS: {
  param: string;
  group: string;
  render: (v: string) => string;
}[] = [
  { param: "coaState", group: "COA", render: (v) => TRI_LABEL[v] ?? v },
  { param: "sampleState", group: "Sample", render: (v) => TRI_LABEL[v] ?? v },
  { param: "medicalState", group: "Medical", render: (v) => TRI_LABEL[v] ?? v },
  { param: "lowThc", group: "Low-THC liquid", render: (v) => TRI_LABEL[v] ?? v },
  { param: "otherwiseTaken", group: "Otherwise taken", render: (v) => TRI_LABEL[v] ?? v },
  { param: "hasExpiry", group: "Has expiry", render: (v) => TRI_LABEL[v] ?? v },
  { param: "hasReceived", group: "Has received date", render: (v) => TRI_LABEL[v] ?? v },
  { param: "hasCost", group: "Has unit cost", render: (v) => TRI_LABEL[v] ?? v },
  { param: "hasStrainType", group: "Has strain type", render: (v) => TRI_LABEL[v] ?? v },
  { param: "labPassed", group: "Lab result", render: (v) => TRI_LABEL[v] ?? v },
  { param: "thcMin", group: "THC", render: (v) => `at least ${v}%` },
  { param: "thcMax", group: "THC", render: (v) => `at most ${v}%` },
  { param: "cbdMin", group: "CBD", render: (v) => `at least ${v}%` },
  { param: "cbdMax", group: "CBD", render: (v) => `at most ${v}%` },
  { param: "qtyMin", group: "On hand", render: (v) => `at least ${v}` },
  { param: "qtyMax", group: "On hand", render: (v) => `at most ${v}` },
  { param: "soldMin", group: "Sold", render: (v) => `at least ${v}` },
  { param: "soldMax", group: "Sold", render: (v) => `at most ${v}` },
  { param: "costMin", group: "Unit cost", render: (v) => `at least ${v} cents` },
  { param: "costMax", group: "Unit cost", render: (v) => `at most ${v} cents` },
  { param: "recvFrom", group: "Received", render: (v) => `on or after ${v}` },
  { param: "recvTo", group: "Received", render: (v) => `on or before ${v}` },
  { param: "expFrom", group: "Expires", render: (v) => `on or after ${v}` },
  { param: "expTo", group: "Expires", render: (v) => `on or before ${v}` },
];

/**
 * Build a chip for every engaged filter.
 *
 * Chips are built from the PARSED state, not the raw params, so a garbage
 * value that the parser rejected ("?thcMin=abc") produces no chip — the screen
 * never claims to be filtering by something it is ignoring.
 */
export function activeFilterChips(
  raw: RawParams,
  state: InventoryFilterState,
): FilterChip[] {
  const chips: FilterChip[] = [];

  for (const facet of INVENTORY_FACETS) {
    const selected = state.facets[facet.param] ?? [];
    for (const value of selected) {
      chips.push({
        group: facet.label,
        label: value === UNSET_FACET_VALUE ? UNSET_FACET_LABEL : value,
        href: toggleFacetHref(raw, facet.param, value, selected),
      });
    }
  }

  const parsed = new Set<string>();
  for (const [k, v] of Object.entries(state)) {
    if (k === "facets" || v === undefined) continue;
    parsed.add(k);
  }
  // Map state keys back to their params via the scalar table, using the RAW
  // value only for display when the parser kept it.
  const stateKeyForParam: Record<string, keyof InventoryFilterState> = {
    coaState: "hasCoa",
    sampleState: "isSample",
    medicalState: "isMedical",
    lowThc: "lowThc",
    otherwiseTaken: "otherwiseTaken",
    hasExpiry: "hasExpiry",
    hasReceived: "hasReceivedDate",
    hasCost: "hasCost",
    hasStrainType: "hasStrainType",
    labPassed: "labPassed",
    thcMin: "thcMin",
    thcMax: "thcMax",
    cbdMin: "cbdMin",
    cbdMax: "cbdMax",
    qtyMin: "qtyMin",
    qtyMax: "qtyMax",
    soldMin: "soldMin",
    soldMax: "soldMax",
    costMin: "costMin",
    costMax: "costMax",
    recvFrom: "receivedFrom",
    recvTo: "receivedTo",
    expFrom: "expiresFrom",
    expTo: "expiresTo",
  };

  for (const chip of SCALAR_CHIPS) {
    const stateKey = stateKeyForParam[chip.param];
    if (!stateKey) continue;
    const value = state[stateKey];
    if (value === undefined) continue;
    chips.push({
      group: chip.group,
      label: chip.render(String(value)),
      href: clearParamHref(raw, chip.param),
    });
  }

  return chips;
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------

export function __runInventoryUrlCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    n += 1;
    if (!cond) throw new Error(`inventory-url-core: ${msg}`);
  };
  const qs = (href: string) => new URLSearchParams(href.split("?")[1] ?? "");

  const product = columnSortDef("product") as ColumnSortDef;
  const thc = columnSortDef("thc") as ColumnSortDef;
  ok(product !== undefined && thc !== undefined, "column defs resolve");

  // ---- three-state header cycle
  const h1 = sortHref({}, product);
  ok(qs(h1).get(SORT_COLUMN_PARAM) === "product", "first click sorts the column");
  ok(qs(h1).get(SORT_DIRECTION_PARAM) === "asc", "product first click is A-Z");
  const after1 = { [SORT_COLUMN_PARAM]: "product", [SORT_DIRECTION_PARAM]: "asc" };
  const h2 = sortHref(after1, product);
  ok(qs(h2).get(SORT_DIRECTION_PARAM) === "desc", "second click reverses");
  const after2 = { [SORT_COLUMN_PARAM]: "product", [SORT_DIRECTION_PARAM]: "desc" };
  const h3 = sortHref(after2, product);
  ok(qs(h3).get(SORT_COLUMN_PARAM) === null, "third click clears the sort");
  ok(qs(h3).get(SORT_DIRECTION_PARAM) === null, "third click clears direction too");

  // A numeric column starts HIGH — "price high low, thc high low".
  ok(qs(sortHref({}, thc)).get(SORT_DIRECTION_PARAM) === "desc", "THC first click is high-first");

  // Clicking a DIFFERENT column starts that column fresh, not mid-cycle.
  const hOther = sortHref(after2, thc);
  ok(qs(hOther).get(SORT_COLUMN_PARAM) === "thc", "switching column switches sort");
  ok(qs(hOther).get(SORT_DIRECTION_PARAM) === "desc", "switched column uses ITS default");

  // ---- every declared column produces a working link
  for (const col of INVENTORY_COLUMN_SORTS) {
    const href = sortHref({}, col);
    ok(qs(href).get(SORT_COLUMN_PARAM) === col.key, `sortable header links: ${col.key}`);
    ok(sortIndicator({ [SORT_COLUMN_PARAM]: col.key, [SORT_DIRECTION_PARAM]: "asc" }, col) === "asc", `indicator shows: ${col.key}`);
    ok(sortIndicator({}, col) === null, `no indicator when unsorted: ${col.key}`);
    ok(sortActionLabel({}, col).length > 0, `action label exists: ${col.key}`);
  }
  // Only the active column shows an arrow.
  ok(
    sortIndicator({ [SORT_COLUMN_PARAM]: "thc", [SORT_DIRECTION_PARAM]: "desc" }, product) === null,
    "inactive column shows no arrow",
  );
  // A known column with a junk direction is still sorted (default direction).
  ok(
    currentSort({ [SORT_COLUMN_PARAM]: "thc", [SORT_DIRECTION_PARAM]: "sideways" })?.direction === "desc",
    "junk direction falls back to the column default",
  );
  ok(currentSort({ [SORT_COLUMN_PARAM]: "nope" }) === null, "unknown column means unsorted");
  ok(currentSort({}) === null, "absent means unsorted");

  // ---- clicking a header PRESERVES every other feature's params
  const busy: RawParams = {};
  for (const p of PRESERVED_PARAMS) busy[p] = `v-${p}`;
  const preserved = qs(sortHref(busy, product));
  for (const p of PRESERVED_PARAMS) {
    ok(preserved.get(p) === `v-${p}`, `sort click preserves ?${p}`);
  }

  // ---- any view change resets to page 1
  ok(qs(sortHref({ page: "7" }, product)).get("page") === null, "sort resets page");
  ok(
    qs(toggleFacetHref({ page: "7" }, "fVendor", "A", [])).get("page") === null,
    "facet toggle resets page",
  );
  ok(qs(clearFacetHref({ page: "7" }, "fVendor")).get("page") === null, "facet clear resets page");
  ok(qs(clearParamHref({ page: "7" }, "thcMin")).get("page") === null, "chip removal resets page");

  // ---- facet toggling
  const on = toggleFacetHref({}, "fVendor", "Phat Panda", []);
  ok(qs(on).getAll("fVendor").join("|") === "Phat Panda", "toggle on adds the value");
  const off = toggleFacetHref({ fVendor: "Phat Panda" }, "fVendor", "Phat Panda", ["Phat Panda"]);
  ok(qs(off).getAll("fVendor").length === 0, "toggle off removes the value");
  // Removing ONE value keeps the others — the chip must be surgical.
  const two = { fVendor: ["A", "B"] };
  const removedA = qs(toggleFacetHref(two, "fVendor", "A", ["A", "B"])).getAll("fVendor");
  ok(removedA.length === 1 && removedA[0] === "B", "removing one value keeps the rest");

  /**
   * REGRESSION — a comma-bearing REAL vendor must survive a round trip through
   * the URL. "Grow Op Farms, LLC" is an actual vendor in this store
   * (vendors_baseline_seed.sql:25). If anyone ever encodes facet values as a
   * comma-joined list, this fails.
   */
  const REAL = "Grow Op Farms, LLC";
  const realHref = toggleFacetHref({}, "fVendor", REAL, []);
  const roundTripped = qs(realHref).getAll("fVendor");
  ok(roundTripped.length === 1, "comma vendor round-trips as ONE value");
  ok(roundTripped[0] === REAL, "comma vendor round-trips verbatim");
  // And two of them stay two.
  const both = qs(
    toggleFacetHref({ fVendor: [REAL] }, "fVendor", "Legacy Organics, LLC", [REAL]),
  ).getAll("fVendor");
  ok(both.length === 2, "two comma vendors stay two");
  ok(both.includes(REAL) && both.includes("Legacy Organics, LLC"), "both survive verbatim");

  // An ampersand must not split the query string either.
  const AMP = "Salt & Pepper Farms";
  const ampBack = qs(toggleFacetHref({}, "fBrand", AMP, [])).getAll("fBrand");
  ok(ampBack.length === 1 && ampBack[0] === AMP, "ampersand value survives encoding");

  // ---- clear all
  const cleared = qs(
    clearAllFiltersHref({ status: "active", fVendor: "A", thcMin: "20", q: "blue", page: "3" }),
  );
  ok(cleared.get("status") === "active", "clear-all keeps the status tab");
  ok(cleared.get("fVendor") === null, "clear-all drops facets");
  ok(cleared.get("thcMin") === null, "clear-all drops ranges");
  ok(cleared.get("q") === null, "clear-all drops the search");
  ok(cleared.get("page") === null, "clear-all drops the page");

  // ---- chips
  const chipState: InventoryFilterState = {
    facets: { fVendor: [REAL], fType: [UNSET_FACET_VALUE] },
    thcMin: 20,
    hasCoa: "no",
  };
  const chips = activeFilterChips(
    { fVendor: REAL, fType: UNSET_FACET_VALUE, thcMin: "20", coaState: "no" },
    chipState,
  );
  ok(chips.length === 4, "one chip per engaged filter");
  ok(chips.some((c) => c.group === "Vendor" && c.label === REAL), "vendor chip reads plainly");
  ok(
    chips.some((c) => c.group === "Type" && c.label === UNSET_FACET_LABEL),
    "unset facet chip says (not set), not the sentinel",
  );
  ok(chips.some((c) => c.group === "THC" && c.label === "at least 20%"), "range chip reads plainly");
  ok(chips.some((c) => c.group === "COA" && c.label === "no"), "tri-state chip reads plainly");
  // Removing the THC chip leaves the vendor filter alone.
  const thcChip = chips.find((c) => c.group === "THC");
  ok(thcChip !== undefined, "THC chip exists");
  const afterChip = qs((thcChip as FilterChip).href);
  ok(afterChip.get("thcMin") === null, "chip removes its own param");
  ok(afterChip.getAll("fVendor")[0] === REAL, "chip removal keeps other filters");

  // A REJECTED param produces NO chip — the screen never claims a filter it
  // is ignoring.
  const noneChips = activeFilterChips({ thcMin: "abc" }, { facets: {} });
  ok(noneChips.length === 0, "garbage param produces no chip");

  // ---- href shape
  ok(hrefFrom(new URLSearchParams()) === INVENTORY_PATH, "empty params means a bare path");
  ok(sortHref({}, product).startsWith(`${INVENTORY_PATH}?`), "links point at the page");

  console.log(`inventory-url-core: ${n} assertions passed`);
}
