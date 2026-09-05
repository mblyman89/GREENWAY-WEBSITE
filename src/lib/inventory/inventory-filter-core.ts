/**
 * src/lib/inventory/inventory-filter-core.ts  (SLICE 13)
 *
 * The complete filter grammar for the back-office inventory list.
 *
 * The owner asked to "refine my inventory list in every way imaginable" —
 * vendors, brands, types, categories, flags, lot numbers, strain type,
 * receive date, "every descriptor, every value, every identifier". This module
 * is the single pure place that:
 *
 *   1. Declares every facet (the dropdown/checkbox filters) as DATA, so the UI
 *      renders itself from the same list the predicate walks and the two can
 *      never disagree.
 *   2. Builds each facet's option list FROM THE ROWS THEMSELVES, with counts,
 *      so a dropdown can only ever offer values that actually exist. An
 *      inventory filter that offers "Live Rosin" when no rosin is in stock
 *      wastes the owner's time; one built from the data cannot.
 *   3. Parses untrusted URL params into a filter state, following the
 *      established page doctrine: GARBAGE SILENTLY MEANS "FILTER OFF", never
 *      an exception (page.tsx:116-117).
 *   4. Applies the state to rows as one pure predicate.
 *
 * TWO DOCTRINES CARRIED IN FROM THE EXISTING CODE
 * -----------------------------------------------------------------------
 * A. NULL MEANS UNKNOWN, NEVER "NO". `low_thc_liquid`, `otherwise_taken`,
 *    `received_on`, `expires_on` and `unit_cost_minor_units` are all
 *    explicitly documented as "null = we have not been told" (types.ts:132-176,
 *    and the SLICE 2 doctrine in lot-table-core.ts). So their filters are
 *    THREE-state — yes / no / unknown — not two. A "Low-THC: no" filter that
 *    swept up 4,000 never-answered lots would be a lie in exactly the way
 *    migration 0191 warns about.
 *
 * B. FACETS MUST BE BUILT FROM THE DISPLAYED LABEL, NOT THE RAW COLUMN.
 *    `lotTypeLabel` screens raw CCRS blobs ("EndProduct") and can derive a
 *    house type from the product name, so a Type facet built from
 *    `row.category` would offer values the TYPE column never shows, and would
 *    fail to offer the ones it does. The facet therefore calls the same helper
 *    the table renders.
 *
 * PURE: no I/O, no React, no server-only. Self-tests registered in the pure
 * runner.
 */
import {
  lotTypeLabel,
  lotStrainTypeLabel,
  type LotTableFields,
} from "@/lib/inventory/lot-table-core";

/** The em-dash the display helpers return for "nothing stored". */
const EM_DASH = "\u2014";

/**
 * The label a facet option carries when the underlying value is absent. It is
 * a real, selectable option: "show me the lots that are missing this" is one
 * of the most useful filters in the building, and it is how the owner finds
 * the gaps worth fixing.
 */
export const UNSET_FACET_VALUE = "__unset__";
export const UNSET_FACET_LABEL = "(not set)";

/**
 * The row shape the filter grammar reads. It is the intersection of
 * `LotWithDetail` and what the table displays; declaring it here (rather than
 * importing the store type) keeps this module pure and testable with plain
 * objects.
 */
export type FilterableLot = LotTableFields & {
  id: string;
  lot_code: string | null;
  pos_product_key: string | null;
  product_name: string | null;
  strain_type: string | null;
  status: string;
  is_sample: boolean;
  is_medical: boolean;
  low_thc_liquid: boolean | null;
  otherwise_taken: boolean | null;
  unit: string;
  unit_cost_minor_units: number | null;
  unit_thc_mg: number | null;
  units_per_package: number | null;
  expires_on: string | null;
  received_on: string | null;
  received_on_source: string | null;
  notes: string | null;
  vendor_id: string | null;
  brand_id: string | null;
  vendor_name: string | null;
  brand_name: string | null;
  lab: {
    total_thc_pct: number | null;
    total_cbd_pct: number | null;
    lab_name: string | null;
    passed: boolean | null;
  } | null;
};

/* ── Facets ──────────────────────────────────────────────────────────────── */

/**
 * A facet is a multi-select filter over a text-ish value. `values` is read
 * from the row via `get`, which returns the DISPLAY label so the dropdown and
 * the table always agree (doctrine B above).
 */
export type FacetDef = {
  /** URL param name. Part of the URL contract — append only, never rename. */
  param: string;
  /** Human label for the control. */
  label: string;
  /** The displayed value for a row, or null when the row has none. */
  get: (lot: FilterableLot) => string | null;
};

/**
 * EVERY multi-select facet, as data. Adding one here adds it to the parser,
 * the predicate, the option builder and the UI simultaneously — they all walk
 * this list, so a facet cannot be half-implemented.
 */
export const INVENTORY_FACETS: FacetDef[] = [
  { param: "fVendor", label: "Vendor", get: (l) => l.vendor_name },
  { param: "fBrand", label: "Brand", get: (l) => l.brand_name },
  // Doctrine B: the DISPLAYED type, screened of CCRS blobs.
  { param: "fType", label: "Type", get: (l) => nullIfDash(lotTypeLabel(l)) },
  { param: "fCategory", label: "Category", get: (l) => l.category },
  { param: "fInvType", label: "LCB inventory type", get: (l) => l.inventory_type },
  { param: "fStrain", label: "Strain", get: (l) => l.strain_name },
  { param: "fStrainType", label: "Strain type", get: (l) => nullIfDash(lotStrainTypeLabel(l)) },
  { param: "fSize", label: "Size", get: (l) => sizeFacetValue(l) },
  { param: "fUnit", label: "Unit", get: (l) => l.unit },
  { param: "fStatus", label: "Status", get: (l) => l.status },
  { param: "fLab", label: "Lab", get: (l) => l.lab?.lab_name ?? null },
  { param: "fRecvSource", label: "Received-date source", get: (l) => l.received_on_source },
];

/** Display helpers return an em-dash for "nothing"; the facet wants null. */
function nullIfDash(s: string): string | null {
  const t = s.trim();
  return t && t !== EM_DASH ? t : null;
}

/**
 * Size as a facet value. Deliberately built from the same two columns
 * `lotSizeLabel` renders, but WITHOUT its em-dash, so "3.5 g" groups together
 * regardless of how many lots share it.
 */
function sizeFacetValue(l: FilterableLot): string | null {
  if (l.unit_weight == null || !Number.isFinite(l.unit_weight) || l.unit_weight <= 0) return null;
  const uom = String(l.unit_weight_uom ?? "").trim();
  return uom ? `${l.unit_weight} ${uom}` : String(l.unit_weight);
}

/** One selectable option in a facet dropdown, with how many rows carry it. */
export type FacetOption = { value: string; label: string; count: number };

/**
 * Build a facet's options from the rows, with counts, sorted by count
 * descending then label ascending (the busiest values first — that is what a
 * person reaches for). The "(not set)" option is included when rows are
 * missing the value, and always sorts LAST so it never crowds out real data.
 */
export function facetOptions(rows: FilterableLot[], facet: FacetDef): FacetOption[] {
  const counts = new Map<string, number>();
  let unset = 0;
  for (const row of rows) {
    const raw = facet.get(row);
    const value = raw == null ? "" : String(raw).trim();
    if (!value) {
      unset += 1;
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const out: FacetOption[] = [...counts.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (unset > 0) {
    out.push({ value: UNSET_FACET_VALUE, label: UNSET_FACET_LABEL, count: unset });
  }
  return out;
}

/* ── Tri-state flags ─────────────────────────────────────────────────────── */

/**
 * Three states, because NULL MEANS UNKNOWN (doctrine A). "no" must not sweep
 * up the lots nobody has answered for.
 */
export type TriState = "yes" | "no" | "unknown";

export function parseTriState(raw: string | undefined | null): TriState | undefined {
  if (raw === "yes" || raw === "no" || raw === "unknown") return raw;
  return undefined;
}

/** Match a nullable boolean against a tri-state selection. */
export function matchesTriState(value: boolean | null | undefined, want: TriState): boolean {
  if (want === "unknown") return value == null;
  if (value == null) return false; // unknown is never "yes" and never "no"
  return want === "yes" ? value === true : value === false;
}

/** Match a nullable presence (a date, a cost) against a tri-state selection. */
export function matchesPresence(value: unknown, want: TriState): boolean {
  const present = value != null && value !== "";
  if (want === "unknown") return !present;
  return want === "yes" ? present : !present;
}

/* ── Numeric + date ranges ───────────────────────────────────────────────── */

/**
 * Parse a numeric range bound. Empty and garbage both mean "no bound", so a
 * half-filled range still works (min with no max is a perfectly good filter).
 * Negative numbers are allowed: an on-hand quantity can legitimately be
 * negative after a correction, and the owner may well want to find those.
 */
export function parseNumber(raw: string | undefined | null): number | undefined {
  if (raw == null) return undefined;
  const t = String(raw).trim();
  if (!t) return undefined;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Inclusive numeric range test. A null/undefined VALUE never satisfies a
 * bounded range — unknown is not zero (doctrine A). With no bounds set the
 * filter is off and everything passes, including unknowns.
 */
export function inNumericRange(
  value: number | null | undefined,
  min: number | undefined,
  max: number | undefined,
): boolean {
  if (min === undefined && max === undefined) return true;
  if (value == null || !Number.isFinite(value)) return false;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

/** ISO calendar date (yyyy-mm-dd) or undefined. Reuses the repo's strictness. */
export function parseDateBound(raw: string | undefined | null): string | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parts = raw.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) return undefined;
  if (m < 1 || m > 12 || d < 1) return undefined;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) return undefined;
  return raw;
}

/**
 * Inclusive date-range test on an ISO date string. Timestamps are compared on
 * their date prefix only, so a `created_at` of "2026-06-17T18:00:00Z" falls
 * inside a range ending "2026-06-17" — the alternative silently drops the
 * final day, which is the classic off-by-one in date filters.
 */
export function inDateRange(
  value: string | null | undefined,
  from: string | undefined,
  to: string | undefined,
): boolean {
  if (from === undefined && to === undefined) return true;
  const v = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; // unknown fails a bounded range
  if (from !== undefined && v < from) return false;
  if (to !== undefined && v > to) return false;
  return true;
}

/* ── The whole filter state ──────────────────────────────────────────────── */

export type InventoryFilterState = {
  /** facet param -> the selected values (empty/absent = that facet is off). */
  facets: Record<string, string[]>;
  hasCoa?: TriState;
  isSample?: TriState;
  isMedical?: TriState;
  lowThc?: TriState;
  otherwiseTaken?: TriState;
  hasExpiry?: TriState;
  hasReceivedDate?: TriState;
  hasCost?: TriState;
  hasStrainType?: TriState;
  labPassed?: TriState;
  thcMin?: number;
  thcMax?: number;
  cbdMin?: number;
  cbdMax?: number;
  qtyMin?: number;
  qtyMax?: number;
  soldMin?: number;
  soldMax?: number;
  costMin?: number;
  costMax?: number;
  receivedFrom?: string;
  receivedTo?: string;
  expiresFrom?: string;
  expiresTo?: string;
};

/** A bag of raw URL params (the shape Next.js hands us). */
export type RawParams = Record<string, string | string[] | undefined>;

/** Read one param as a single string, tolerating the array form. */
function one(params: RawParams, key: string): string | undefined {
  const v = params[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

/**
 * Read a multi-select param as REPEATED KEYS (`?fVendor=A&fVendor=B`), which
 * is exactly what a set of same-named HTML checkboxes submits.
 *
 * VALUES ARE NEVER SPLIT ON A DELIMITER, AND THAT IS THE WHOLE POINT.
 * -----------------------------------------------------------------------
 * The first version of this function treated the value as a comma-separated
 * list. That was measured against this store's REAL vendor names and found
 * to be broken: `back-office/kb_seed/vendors_baseline_seed.sql:25` holds
 * "Grow Op Farms, LLC", and batch3 holds "Free Rain Farms, Inc." and
 * "Legacy Organics, LLC". Splitting on the comma turned one real vendor into
 * two vendors that do not exist, so selecting that vendor matched NOTHING:
 *
 *   parseMultiParam({ fVendor: "Grow Op Farms, LLC" })
 *     -> ["Grow Op Farms", "LLC"]      // neither is a real vendor
 *     -> the lot did not match its OWN vendor
 *
 * That is the owner's original complaint ("it only found it when I used the
 * name exactly") reproduced inside the fix for it. Facet values are arbitrary
 * user data — vendor names, brands, strains, product types — so NO character
 * is safe to reserve as a separator. Repeated keys have no such problem: the
 * value survives verbatim, commas and all.
 *
 * Blank entries are dropped and duplicates collapsed, so "?fType=&fType=" is
 * simply "filter off", matching the page's garbage-means-off doctrine.
 */
export function parseMultiParam(params: RawParams, key: string): string[] {
  const v = params[key];
  const parts: string[] = [];
  if (Array.isArray(v)) {
    for (const item of v) parts.push(String(item));
  } else if (typeof v === "string") {
    parts.push(v);
  }
  const cleaned = parts.map((s) => s.trim()).filter(Boolean);
  return [...new Set(cleaned)];
}

/**
 * Parse the whole filter state from URL params. Every knob follows the page's
 * established rule: unparseable input silently means "off".
 */
export function parseInventoryFilters(params: RawParams): InventoryFilterState {
  const facets: Record<string, string[]> = {};
  for (const f of INVENTORY_FACETS) {
    const values = parseMultiParam(params, f.param);
    if (values.length > 0) facets[f.param] = values;
  }
  return {
    facets,
    hasCoa: parseTriState(one(params, "coaState")),
    isSample: parseTriState(one(params, "sampleState")),
    isMedical: parseTriState(one(params, "medicalState")),
    lowThc: parseTriState(one(params, "lowThc")),
    otherwiseTaken: parseTriState(one(params, "otherwiseTaken")),
    hasExpiry: parseTriState(one(params, "hasExpiry")),
    hasReceivedDate: parseTriState(one(params, "hasReceived")),
    hasCost: parseTriState(one(params, "hasCost")),
    hasStrainType: parseTriState(one(params, "hasStrainType")),
    labPassed: parseTriState(one(params, "labPassed")),
    thcMin: parseNumber(one(params, "thcMin")),
    thcMax: parseNumber(one(params, "thcMax")),
    cbdMin: parseNumber(one(params, "cbdMin")),
    cbdMax: parseNumber(one(params, "cbdMax")),
    qtyMin: parseNumber(one(params, "qtyMin")),
    qtyMax: parseNumber(one(params, "qtyMax")),
    soldMin: parseNumber(one(params, "soldMin")),
    soldMax: parseNumber(one(params, "soldMax")),
    costMin: parseNumber(one(params, "costMin")),
    costMax: parseNumber(one(params, "costMax")),
    receivedFrom: parseDateBound(one(params, "recvFrom")),
    receivedTo: parseDateBound(one(params, "recvTo")),
    expiresFrom: parseDateBound(one(params, "expFrom")),
    expiresTo: parseDateBound(one(params, "expTo")),
  };
}

/**
 * The non-facet knobs, as a plain list of values.
 *
 * `facets` is handled separately because it is a nested object whose emptiness
 * is "every list is empty", not "is undefined". Written as an explicit filter
 * on the key rather than a destructuring omit so there is no unused binding.
 */
function scalarKnobValues(state: InventoryFilterState): unknown[] {
  return Object.entries(state)
    .filter(([key]) => key !== "facets")
    .map(([, value]) => value);
}

/** True when at least one knob in the state is actually filtering. */
export function hasActiveFilters(state: InventoryFilterState): boolean {
  if (Object.values(state.facets).some((v) => v.length > 0)) return true;
  return scalarKnobValues(state).some((v) => v !== undefined);
}

/** How many knobs are engaged — drives the "N filters active" badge. */
export function countActiveFilters(state: InventoryFilterState): number {
  const facetCount = Object.values(state.facets).filter((v) => v.length > 0).length;
  return facetCount + scalarKnobValues(state).filter((v) => v !== undefined).length;
}

/**
 * Does one lot satisfy the whole filter state? Every clause is an AND, which
 * is what "refine" means: each control the owner touches narrows the list.
 * Within a single facet the selected values are an OR (Vendor A or Vendor B),
 * which is what a multi-select means.
 */
export function lotMatchesFilters(lot: FilterableLot, state: InventoryFilterState): boolean {
  // Facets: AND across facets, OR within one facet.
  for (const facet of INVENTORY_FACETS) {
    const selected = state.facets[facet.param];
    if (!selected || selected.length === 0) continue;
    const raw = facet.get(lot);
    const value = raw == null ? "" : String(raw).trim();
    const key = value === "" ? UNSET_FACET_VALUE : value;
    if (!selected.includes(key)) return false;
  }

  if (state.hasCoa && !matchesPresence(lot.lab, state.hasCoa)) return false;
  if (state.isSample && !matchesTriState(lot.is_sample, state.isSample)) return false;
  if (state.isMedical && !matchesTriState(lot.is_medical, state.isMedical)) return false;
  if (state.lowThc && !matchesTriState(lot.low_thc_liquid, state.lowThc)) return false;
  if (state.otherwiseTaken && !matchesTriState(lot.otherwise_taken, state.otherwiseTaken)) {
    return false;
  }
  if (state.hasExpiry && !matchesPresence(lot.expires_on, state.hasExpiry)) return false;
  if (state.hasReceivedDate && !matchesPresence(lot.received_on, state.hasReceivedDate)) {
    return false;
  }
  if (state.hasCost && !matchesPresence(lot.unit_cost_minor_units, state.hasCost)) return false;
  if (state.hasStrainType && !matchesPresence(lot.strain_type, state.hasStrainType)) return false;
  if (state.labPassed && !matchesTriState(lot.lab?.passed ?? null, state.labPassed)) return false;

  if (!inNumericRange(lot.lab?.total_thc_pct ?? null, state.thcMin, state.thcMax)) return false;
  if (!inNumericRange(lot.lab?.total_cbd_pct ?? null, state.cbdMin, state.cbdMax)) return false;
  if (!inNumericRange(lot.on_hand_qty, state.qtyMin, state.qtyMax)) return false;
  if (!inNumericRange(soldQty(lot), state.soldMin, state.soldMax)) return false;
  if (!inNumericRange(lot.unit_cost_minor_units, state.costMin, state.costMax)) return false;

  if (!inDateRange(lot.received_on, state.receivedFrom, state.receivedTo)) return false;
  if (!inDateRange(lot.expires_on, state.expiresFrom, state.expiresTo)) return false;

  return true;
}

/**
 * Units sold, matching `lotSoldQty` exactly (received − on hand, floored at
 * 0). Duplicated as a local rather than imported so this module's predicate
 * and the table column can be proven equal by test rather than by assumption.
 */
function soldQty(lot: FilterableLot): number {
  const sold = Number(lot.received_qty ?? 0) - Number(lot.on_hand_qty ?? 0);
  return sold > 0 ? sold : 0;
}

/** Apply the filter state to a list of lots. */
export function filterLots<T extends FilterableLot>(
  lots: T[],
  state: InventoryFilterState,
): T[] {
  return lots.filter((l) => lotMatchesFilters(l, state));
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------

/** A minimal valid lot; tests override only the fields they care about. */
export function __testLot(over: Partial<FilterableLot> = {}): FilterableLot {
  return {
    id: "lot-1",
    lot_code: "LC-1",
    pos_product_key: "POS-1",
    product_name: "Blue Dream 3.5g",
    strain_name: "Blue Dream",
    strain_type: "hybrid",
    category: "Flower",
    inventory_type: "Usable Marijuana",
    unit_weight: 3.5,
    unit_weight_uom: "g",
    received_qty: 10,
    on_hand_qty: 4,
    unit: "ea",
    status: "active",
    is_sample: false,
    is_medical: false,
    low_thc_liquid: null,
    otherwise_taken: null,
    unit_cost_minor_units: 1200,
    unit_thc_mg: null,
    units_per_package: null,
    expires_on: "2026-12-31",
    received_on: "2026-06-17",
    received_on_source: "pos_import",
    notes: null,
    created_at: "2026-06-17T12:00:00.000Z",
    vendor_id: "v1",
    brand_id: "b1",
    vendor_name: "Fweedom Farms",
    brand_name: "Fweedom",
    lab: { total_thc_pct: 21.66, total_cbd_pct: 0.1, lab_name: "Confidence", passed: true },
    ...over,
  };
}

export function __runInventoryFilterCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL inventory-filter-core: " + msg);
    passed += 1;
  };

  // ---- tri-state: UNKNOWN IS NOT "NO" (doctrine A)
  ok(matchesTriState(true, "yes"), "true matches yes");
  ok(matchesTriState(false, "no"), "false matches no");
  ok(matchesTriState(null, "unknown"), "null matches unknown");
  ok(!matchesTriState(null, "no"), "null does NOT match no — unknown is not a denial");
  ok(!matchesTriState(null, "yes"), "null does not match yes");
  ok(!matchesTriState(true, "unknown"), "a real value is not unknown");
  ok(!matchesTriState(false, "unknown"), "false is a real answer, not unknown");
  ok(parseTriState("unknown") === "unknown", "unknown parses");
  ok(parseTriState("maybe") === undefined, "garbage tri-state means off");
  ok(parseTriState(undefined) === undefined, "absent tri-state means off");

  ok(matchesPresence("2026-01-01", "yes"), "a date is present");
  ok(matchesPresence(null, "unknown"), "null is absent");
  ok(matchesPresence("", "unknown"), "empty string counts as absent");
  ok(matchesPresence(0, "yes"), "zero is a real value, not absence");

  // ---- numeric ranges
  ok(inNumericRange(5, 1, 10), "inside range");
  ok(inNumericRange(1, 1, 10), "min is inclusive");
  ok(inNumericRange(10, 1, 10), "max is inclusive");
  ok(!inNumericRange(0, 1, 10), "below min excluded");
  ok(!inNumericRange(11, 1, 10), "above max excluded");
  ok(inNumericRange(99, 1, undefined), "min only");
  ok(inNumericRange(-5, undefined, 0), "max only, negatives allowed");
  ok(inNumericRange(null, undefined, undefined), "no bounds = filter off, unknown passes");
  ok(!inNumericRange(null, 1, undefined), "unknown fails a bounded range — not treated as 0");
  ok(parseNumber("21.66") === 21.66, "decimal parses");
  ok(parseNumber("-3") === -3, "negative parses");
  ok(parseNumber("abc") === undefined, "garbage number means off");
  ok(parseNumber("") === undefined, "empty number means off");
  ok(parseNumber("1e5") === undefined, "exponent rejected, not silently reinterpreted");

  // ---- date ranges
  ok(inDateRange("2026-06-17", "2026-06-01", "2026-06-30"), "inside date range");
  ok(inDateRange("2026-06-01", "2026-06-01", undefined), "from is inclusive");
  ok(inDateRange("2026-06-30", undefined, "2026-06-30"), "to is inclusive");
  ok(
    inDateRange("2026-06-17T18:00:00.000Z", "2026-06-17", "2026-06-17"),
    "a timestamp on the final day is INSIDE the range (no off-by-one)",
  );
  ok(!inDateRange(null, "2026-01-01", undefined), "unknown date fails a bounded range");
  ok(inDateRange(null, undefined, undefined), "no bounds = filter off");
  ok(parseDateBound("2026-02-29") === undefined, "2026-02-29 is not a real date");
  ok(parseDateBound("2024-02-29") === "2024-02-29", "2024 leap day is real");
  ok(parseDateBound("2026-13-01") === undefined, "month 13 rejected");
  ok(parseDateBound("garbage") === undefined, "garbage date means off");

  // ---- multi-param parsing (repeated keys; values are NEVER split)
  ok(parseMultiParam({ f: ["a", "b"] }, "f").length === 2, "repeated key parses");
  ok(parseMultiParam({ f: "a" }, "f").length === 1, "single value parses");
  ok(parseMultiParam({ f: ["a", "", "b"] }, "f").length === 2, "blank entries dropped");
  ok(parseMultiParam({ f: ["", "  "] }, "f").length === 0, "all-blank means off");
  ok(parseMultiParam({}, "f").length === 0, "absent means off");
  ok(parseMultiParam({ f: ["a", "a", "b"] }, "f").length === 2, "duplicates collapsed");

  /**
   * REGRESSION — a comma inside a real value must survive verbatim.
   *
   * These are this store's actual vendor names (vendors_baseline_seed.sql:25
   * and vendors_batch3_seed.sql). An earlier version of parseMultiParam split
   * on commas and turned "Grow Op Farms, LLC" into two vendors that do not
   * exist, so filtering to that vendor returned NOTHING — the owner's own
   * "it only finds it if I type it exactly" complaint, recreated inside the
   * fix for it. If anyone reintroduces a delimiter, these fail.
   */
  for (const realVendor of ["Grow Op Farms, LLC", "Free Rain Farms, Inc.", "Legacy Organics, LLC"]) {
    const parsed = parseMultiParam({ fVendor: realVendor }, "fVendor");
    ok(parsed.length === 1, `comma vendor stays one value: ${realVendor}`);
    ok(parsed[0] === realVendor, `comma vendor survives verbatim: ${realVendor}`);
    // and end-to-end: the lot must match its OWN vendor
    ok(
      lotMatchesFilters(
        __testLot({ vendor_name: realVendor }),
        parseInventoryFilters({ fVendor: realVendor }),
      ),
      `lot matches its own comma-bearing vendor: ${realVendor}`,
    );
  }
  // Two comma-bearing vendors selected together still mean exactly two.
  ok(
    parseMultiParam({ fVendor: ["Grow Op Farms, LLC", "Legacy Organics, LLC"] }, "fVendor")
      .length === 2,
    "two comma vendors stay two values",
  );

  // ---- facet options are built from the DATA, with counts
  const rows = [
    __testLot({ id: "1", vendor_name: "Fweedom Farms" }),
    __testLot({ id: "2", vendor_name: "Fweedom Farms" }),
    __testLot({ id: "3", vendor_name: "Phat Panda" }),
    __testLot({ id: "4", vendor_name: null }),
  ];
  const vendorFacet = INVENTORY_FACETS.find((f) => f.param === "fVendor");
  ok(vendorFacet !== undefined, "vendor facet is declared");
  const opts = facetOptions(rows, vendorFacet as FacetDef);
  ok(opts.length === 3, "two real vendors plus (not set)");
  ok(opts[0]?.value === "Fweedom Farms" && opts[0]?.count === 2, "busiest value sorts first");
  ok(opts[1]?.value === "Phat Panda", "then the next");
  ok(opts[2]?.value === UNSET_FACET_VALUE && opts[2]?.count === 1, "(not set) sorts LAST");
  const allSet = facetOptions([__testLot({ vendor_name: "X" })], vendorFacet as FacetDef);
  ok(allSet.length === 1, "no (not set) option when nothing is missing");

  // Doctrine B: the Type facet shows the DISPLAYED label, not the raw column.
  const typeFacet = INVENTORY_FACETS.find((f) => f.param === "fType") as FacetDef;
  const blobRow = __testLot({
    category: "EndProduct",
    inventory_type: "Solid Edible",
    product_name: "Cantina Gummies - Guava 10 Pack 400mg",
  });
  ok(
    typeFacet.get(blobRow) === lotTypeLabel(blobRow),
    "the Type facet value equals what the Type COLUMN renders",
  );
  ok(typeFacet.get(blobRow) !== "EndProduct", "a raw CCRS blob is never offered as a Type");

  // ---- the predicate
  const base = __testLot();
  ok(lotMatchesFilters(base, { facets: {} }), "an empty state matches everything");
  ok(
    lotMatchesFilters(base, { facets: { fVendor: ["Fweedom Farms"] } }),
    "matching facet passes",
  );
  ok(
    !lotMatchesFilters(base, { facets: { fVendor: ["Someone Else"] } }),
    "non-matching facet fails",
  );
  ok(
    lotMatchesFilters(base, { facets: { fVendor: ["Someone Else", "Fweedom Farms"] } }),
    "OR within one facet",
  );
  ok(
    !lotMatchesFilters(base, { facets: { fVendor: ["Fweedom Farms"], fBrand: ["Nope"] } }),
    "AND across facets",
  );
  ok(
    lotMatchesFilters(__testLot({ vendor_name: null }), { facets: { fVendor: [UNSET_FACET_VALUE] } }),
    "(not set) selects the rows missing the value",
  );
  ok(
    !lotMatchesFilters(base, { facets: { fVendor: [UNSET_FACET_VALUE] } }),
    "(not set) excludes rows that HAVE the value",
  );

  // Ranges through the predicate, on the joined COA.
  ok(lotMatchesFilters(base, { facets: {}, thcMin: 20 }), "THC above floor passes");
  ok(!lotMatchesFilters(base, { facets: {}, thcMin: 25 }), "THC below floor fails");
  ok(
    !lotMatchesFilters(__testLot({ lab: null }), { facets: {}, thcMin: 1 }),
    "a lot with no COA fails a THC range — unknown is not zero",
  );
  ok(
    lotMatchesFilters(__testLot({ lab: null }), { facets: {} }),
    "a lot with no COA passes when no THC range is set",
  );
  ok(lotMatchesFilters(base, { facets: {}, soldMin: 6, soldMax: 6 }), "sold = received - on hand");
  ok(
    lotMatchesFilters(__testLot({ received_qty: 5, on_hand_qty: 8 }), { facets: {}, soldMax: 0 }),
    "an upward adjustment reads as 0 sold, never negative",
  );

  // Tri-states through the predicate.
  ok(
    lotMatchesFilters(__testLot({ low_thc_liquid: null }), { facets: {}, lowThc: "unknown" }),
    "unknown low-THC is findable",
  );
  ok(
    !lotMatchesFilters(__testLot({ low_thc_liquid: null }), { facets: {}, lowThc: "no" }),
    "unknown low-THC is NOT swept into 'no'",
  );
  ok(
    lotMatchesFilters(__testLot({ lab: null }), { facets: {}, hasCoa: "no" }),
    "missing COA is findable",
  );
  ok(
    lotMatchesFilters(__testLot({ received_on: null }), { facets: {}, hasReceivedDate: "no" }),
    "missing received date is findable (the compliance worklist)",
  );

  // ---- state bookkeeping
  ok(!hasActiveFilters({ facets: {} }), "empty state is not active");
  ok(hasActiveFilters({ facets: { fVendor: ["x"] } }), "a facet makes it active");
  ok(hasActiveFilters({ facets: {}, thcMin: 1 }), "a range makes it active");
  ok(!hasActiveFilters({ facets: { fVendor: [] } }), "an empty facet list is not active");
  ok(countActiveFilters({ facets: { fVendor: ["x"] }, thcMin: 1 }) === 2, "counts each knob once");
  ok(countActiveFilters({ facets: {} }) === 0, "empty state counts zero");

  // ---- parsing the whole state, garbage included
  const parsed = parseInventoryFilters({
    fVendor: "Fweedom Farms",
    thcMin: "20",
    thcMax: "junk",
    recvFrom: "2026-06-01",
    expFrom: "not-a-date",
    lowThc: "unknown",
    sampleState: "wat",
  });
  ok(parsed.facets.fVendor?.length === 1, "facet parsed");
  ok(parsed.thcMin === 20, "numeric bound parsed");
  ok(parsed.thcMax === undefined, "garbage numeric silently off");
  ok(parsed.receivedFrom === "2026-06-01", "date bound parsed");
  ok(parsed.expiresFrom === undefined, "garbage date silently off");
  ok(parsed.lowThc === "unknown", "tri-state parsed");
  ok(parsed.isSample === undefined, "garbage tri-state silently off");
  ok(Object.keys(parseInventoryFilters({}).facets).length === 0, "empty params = no facets");

  // ---- every declared facet is wired end to end
  for (const f of INVENTORY_FACETS) {
    if (!f.param || !f.label) throw new Error(`facet missing param/label: ${f.param}`);
    // get() must tolerate a fully-blank lot without throwing.
    f.get(
      __testLot({
        vendor_name: null,
        brand_name: null,
        category: null,
        inventory_type: null,
        strain_name: null,
        strain_type: null,
        unit_weight: null,
        unit_weight_uom: null,
        received_on_source: null,
        lab: null,
      }),
    );
    passed += 1;
  }
  const params = INVENTORY_FACETS.map((f) => f.param);
  ok(new Set(params).size === params.length, "facet params are unique");

  // ---- filterLots wires the predicate over a list
  ok(filterLots(rows, { facets: { fVendor: ["Phat Panda"] } }).length === 1, "filterLots narrows");
  ok(filterLots(rows, { facets: {} }).length === rows.length, "filterLots with no state is identity");

  console.log(`inventory-filter-core: ${passed} assertions passed`);
}
