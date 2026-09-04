/**
 * src/lib/inventory/inventory-sort-core.ts  (SLICE 13)
 *
 * Click-a-column sorting for the back-office inventory table.
 *
 * The owner asked to "sort the list by clicking the header of the column,
 * which would sort highest to lowest or whatever makes the most sense for
 * clicking there". Two design decisions follow from that sentence:
 *
 *   1. EVERY COLUMN GETS A SENSIBLE FIRST CLICK. Clicking "THC" should show
 *      the strongest product first; clicking "Product" should start at A.
 *      So each column declares its own first-click direction rather than
 *      everything defaulting to ascending. Each column also declares whether
 *      it is numeric, textual or a date, because those compare differently.
 *   2. THE SECOND CLICK REVERSES. A third click returns to the default sort,
 *      so there is always a way back without hunting for a "clear" link.
 *
 * TWO CORRECTNESS TRAPS THIS MODULE HANDLES
 * -----------------------------------------------------------------------
 * A. THC IS NOT ONE NUMBER. The lab `*_pct` columns hold raw manifest
 *    NUMBERS, but for mg-dosed LCB inventory types (Solid Edible, Liquid
 *    Edible, Tincture, Topical Ointment) those numbers are package-total
 *    MILLIGRAMS, not percentages — that is the documented reason
 *    `lotPotencyLabel` exists (lot-table-core.ts:125-142, the owner's "3000%"
 *    bug). Sorting them together would rank a 100 mg gummy above a 30 %
 *    concentrate and call the gummy stronger, which is nonsense.
 *
 *    So potency sorting compares WITHIN a unit and groups the units apart:
 *    percent-dosed lots rank against each other, mg-dosed lots against each
 *    other, and the two groups never interleave. This is disclosed in the UI
 *    rather than hidden, because a silently-wrong ordering is worse than an
 *    explained one.
 *
 * B. UNKNOWN ALWAYS SINKS. A lot with no THC on file, no expiry, or no cost
 *    sorts to the BOTTOM in both directions. If nulls sorted as 0 they would
 *    top the "lowest first" list and the owner would think he had found his
 *    cheapest product when he had actually found the ones nobody costed.
 *    Unknown is not a value; it is the absence of one, so it never competes.
 *
 * PURE: no I/O, no React. Self-tests registered in the pure runner.
 */
import { intakePotencyUnit } from "@/lib/pos/intake-potency-core";
import { lotTypeLabel, lotStrainTypeLabel } from "@/lib/inventory/lot-table-core";
import type { FilterableLot } from "@/lib/inventory/inventory-filter-core";

export type SortDirection = "asc" | "desc";

/** How a column's values compare. */
export type SortValueKind = "text" | "number" | "date" | "potency";

export type ColumnSortDef = {
  /** URL key. Part of the URL contract — append only, never rename. */
  key: string;
  /** Column header text this sort belongs to. */
  label: string;
  kind: SortValueKind;
  /**
   * Direction applied by the FIRST click. "Highest to lowest or whatever
   * makes the most sense": quantities and potency start high, names and dates
   * start at the natural reading order.
   */
  firstClick: SortDirection;
  /** Text value for text columns; null when the row has none. */
  text?: (lot: FilterableLot) => string | null;
  /** Numeric value; null when unknown (sinks, never treated as 0). */
  number?: (lot: FilterableLot) => number | null;
  /** ISO date; null when unknown. */
  date?: (lot: FilterableLot) => string | null;
};

/** Units sold — identical arithmetic to `lotSoldQty`. */
function soldQty(lot: FilterableLot): number {
  const sold = Number(lot.received_qty ?? 0) - Number(lot.on_hand_qty ?? 0);
  return sold > 0 ? sold : 0;
}

/**
 * EVERY sortable column, as data. The table header renders from this list and
 * the comparator reads from it, so a header that looks clickable is always
 * actually sortable.
 */
export const INVENTORY_COLUMN_SORTS: ColumnSortDef[] = [
  {
    key: "product",
    label: "Product / lot",
    kind: "text",
    firstClick: "asc",
    text: (l) => l.product_name,
  },
  { key: "lotcode", label: "Lot code", kind: "text", firstClick: "asc", text: (l) => l.lot_code },
  { key: "vendor", label: "Vendor", kind: "text", firstClick: "asc", text: (l) => l.vendor_name },
  { key: "brand", label: "Brand", kind: "text", firstClick: "asc", text: (l) => l.brand_name },
  { key: "type", label: "Type", kind: "text", firstClick: "asc", text: (l) => lotTypeLabel(l) },
  { key: "strain", label: "Strain", kind: "text", firstClick: "asc", text: (l) => l.strain_name },
  {
    key: "strainType",
    label: "Strain Type",
    kind: "text",
    firstClick: "asc",
    text: (l) => lotStrainTypeLabel(l),
  },
  {
    key: "size",
    label: "Size",
    kind: "number",
    firstClick: "asc",
    number: (l) => (l.unit_weight != null && Number.isFinite(l.unit_weight) ? l.unit_weight : null),
  },
  {
    key: "coa",
    label: "COA",
    kind: "number",
    firstClick: "desc",
    // 1 = has a COA, 0 = none. Sorting this column groups the gaps together,
    // which is how the owner finds what still needs paperwork.
    number: (l) => (l.lab ? 1 : 0),
  },
  { key: "thc", label: "THC", kind: "potency", firstClick: "desc", number: (l) => l.lab?.total_thc_pct ?? null },
  { key: "cbd", label: "CBD", kind: "potency", firstClick: "desc", number: (l) => l.lab?.total_cbd_pct ?? null },
  { key: "received", label: "Received", kind: "date", firstClick: "desc", date: (l) => l.received_on },
  { key: "onhand", label: "On hand", kind: "number", firstClick: "desc", number: (l) => l.on_hand_qty },
  { key: "sold", label: "Sold", kind: "number", firstClick: "desc", number: (l) => soldQty(l) },
  {
    key: "cost",
    label: "Unit cost",
    kind: "number",
    firstClick: "desc",
    number: (l) => l.unit_cost_minor_units,
  },
  { key: "expires", label: "Expires", kind: "date", firstClick: "asc", date: (l) => l.expires_on },
  { key: "status", label: "Status", kind: "text", firstClick: "asc", text: (l) => l.status },
];

export function columnSortDef(key: string | undefined | null): ColumnSortDef | undefined {
  if (!key) return undefined;
  return INVENTORY_COLUMN_SORTS.find((c) => c.key === key);
}

/** Parse a direction param; anything else means "use the column's default". */
export function parseDirection(raw: string | undefined | null): SortDirection | undefined {
  return raw === "asc" || raw === "desc" ? raw : undefined;
}

/**
 * The three-state header click cycle:
 *   unsorted        -> the column's firstClick direction
 *   firstClick dir  -> the opposite direction
 *   opposite dir    -> off (back to the page default)
 *
 * Returning `null` for the third click is what gives the owner a way out of a
 * sort without reaching for a separate control.
 */
export function nextSortState(
  column: ColumnSortDef,
  current: { key: string; direction: SortDirection } | null,
): { key: string; direction: SortDirection } | null {
  if (!current || current.key !== column.key) {
    return { key: column.key, direction: column.firstClick };
  }
  if (current.direction === column.firstClick) {
    return { key: column.key, direction: column.firstClick === "asc" ? "desc" : "asc" };
  }
  return null;
}

/**
 * Potency bucket. mg-dosed inventory types are a different quantity from
 * percentage-dosed ones (trap A), so they are ranked separately. Percent
 * sorts first because it is the larger share of a cannabis shelf; the choice
 * is arbitrary but must be STABLE, which is why it is a constant.
 */
function potencyBucket(lot: FilterableLot): number {
  return intakePotencyUnit(null, lot.inventory_type) === "mg" ? 1 : 0;
}

/**
 * Compare two lots on one column in one direction.
 *
 * Unknown values ALWAYS sink (trap B): the null check happens before the
 * direction is applied, so a missing value is last whether the owner asked
 * for highest-first or lowest-first.
 */
export function compareLots(
  a: FilterableLot,
  b: FilterableLot,
  column: ColumnSortDef,
  direction: SortDirection,
): number {
  const flip = direction === "desc" ? -1 : 1;

  if (column.kind === "text") {
    const av = (column.text?.(a) ?? "").trim();
    const bv = (column.text?.(b) ?? "").trim();
    const aEmpty = av === "" || av === "\u2014";
    const bEmpty = bv === "" || bv === "\u2014";
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1; // unknown sinks regardless of direction
    if (bEmpty) return -1;
    return flip * av.localeCompare(bv, "en", { sensitivity: "base", numeric: true });
  }

  if (column.kind === "date") {
    const av = column.date?.(a) ?? null;
    const bv = column.date?.(b) ?? null;
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    return flip * (av < bv ? -1 : av > bv ? 1 : 0);
  }

  // potency: group by unit first so mg and % never interleave (trap A).
  if (column.kind === "potency") {
    const ab = potencyBucket(a);
    const bb = potencyBucket(b);
    if (ab !== bb) return ab - bb; // grouping is NOT flipped by direction
  }

  const av = column.number?.(a) ?? null;
  const bv = column.number?.(b) ?? null;
  const aBad = av == null || !Number.isFinite(av);
  const bBad = bv == null || !Number.isFinite(bv);
  if (aBad && bBad) return 0;
  if (aBad) return 1;
  if (bBad) return -1;
  return flip * (av - bv);
}

/**
 * Sort a list by a column. The sort is STABLE (ties keep their incoming
 * order), so a column sort layered on top of search relevance preserves
 * relevance within equal values instead of scrambling it.
 */
export function sortLots<T extends FilterableLot>(
  lots: T[],
  column: ColumnSortDef,
  direction: SortDirection,
): T[] {
  return lots
    .map((row, index) => ({ row, index }))
    .sort((x, y) => compareLots(x.row, y.row, column, direction) || x.index - y.index)
    .map((w) => w.row);
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------

export function __runInventorySortCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL inventory-sort-core: " + msg);
    passed += 1;
  };

  // Local lot builder — mirrors inventory-filter-core's __testLot shape.
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

  const byKey = (k: string) => columnSortDef(k) as ColumnSortDef;

  // ---- the menu is coherent
  const keys = INVENTORY_COLUMN_SORTS.map((c) => c.key);
  ok(new Set(keys).size === keys.length, "column sort keys are unique");
  for (const c of INVENTORY_COLUMN_SORTS) {
    if (!c.label) throw new Error(`column ${c.key} has no label`);
    if (c.kind === "text" && !c.text) throw new Error(`text column ${c.key} has no accessor`);
    if ((c.kind === "number" || c.kind === "potency") && !c.number) {
      throw new Error(`numeric column ${c.key} has no accessor`);
    }
    if (c.kind === "date" && !c.date) throw new Error(`date column ${c.key} has no accessor`);
    passed += 1;
  }
  ok(columnSortDef("nope") === undefined, "unknown key resolves to undefined");
  ok(columnSortDef(undefined) === undefined, "absent key resolves to undefined");
  ok(parseDirection("asc") === "asc", "asc parses");
  ok(parseDirection("sideways") === undefined, "garbage direction means default");

  // ---- first-click direction is sensible per column
  ok(byKey("thc").firstClick === "desc", "clicking THC shows strongest first");
  ok(byKey("onhand").firstClick === "desc", "clicking On hand shows most stock first");
  ok(byKey("product").firstClick === "asc", "clicking Product starts at A");
  ok(byKey("expires").firstClick === "asc", "clicking Expires shows soonest first");

  // ---- the three-state click cycle
  const thc = byKey("thc");
  const c1 = nextSortState(thc, null);
  ok(c1?.direction === "desc", "first click uses the column default");
  const c2 = nextSortState(thc, c1);
  ok(c2?.direction === "asc", "second click reverses");
  const c3 = nextSortState(thc, c2);
  ok(c3 === null, "third click clears the sort");
  const other = nextSortState(byKey("product"), c1);
  ok(other?.key === "product" && other.direction === "asc", "clicking a different column starts fresh");

  // ---- text sorting, and unknown sinking in BOTH directions
  const named = lot({ product_name: "Apple" });
  const later = lot({ product_name: "Zebra" });
  const unnamed = lot({ product_name: null });
  const prod = byKey("product");
  ok(compareLots(named, later, prod, "asc") < 0, "A before Z ascending");
  ok(compareLots(named, later, prod, "desc") > 0, "Z before A descending");
  ok(compareLots(unnamed, named, prod, "asc") > 0, "unnamed sinks ascending");
  ok(compareLots(unnamed, named, prod, "desc") > 0, "unnamed ALSO sinks descending");
  ok(compareLots(unnamed, unnamed, prod, "asc") === 0, "two unknowns tie");
  // The em-dash the display helpers emit must count as empty, not as text.
  ok(
    compareLots(lot({ product_name: "\u2014" }), named, prod, "asc") > 0,
    "an em-dash placeholder sinks like a real blank",
  );

  // ---- numeric sorting, unknown sinks both ways
  const qty = byKey("onhand");
  ok(compareLots(lot({ on_hand_qty: 10 }), lot({ on_hand_qty: 2 }), qty, "desc") < 0, "10 before 2 desc");
  ok(compareLots(lot({ on_hand_qty: 10 }), lot({ on_hand_qty: 2 }), qty, "asc") > 0, "2 before 10 asc");
  const cost = byKey("cost");
  ok(
    compareLots(lot({ unit_cost_minor_units: null }), lot({ unit_cost_minor_units: 100 }), cost, "asc") > 0,
    "an uncosted lot does NOT top the cheapest-first list",
  );
  ok(
    compareLots(lot({ unit_cost_minor_units: null }), lot({ unit_cost_minor_units: 100 }), cost, "desc") > 0,
    "an uncosted lot sinks descending too",
  );

  // ---- dates
  const exp = byKey("expires");
  ok(
    compareLots(lot({ expires_on: "2026-01-01" }), lot({ expires_on: "2026-12-31" }), exp, "asc") < 0,
    "soonest expiry first ascending",
  );
  ok(
    compareLots(lot({ expires_on: null }), lot({ expires_on: "2026-01-01" }), exp, "asc") > 0,
    "no expiry sinks",
  );

  // ---- TRAP A: mg and % never interleave
  const flower = lot({ inventory_type: "Usable Marijuana", lab: { total_thc_pct: 21.66, total_cbd_pct: 0, lab_name: null, passed: true } });
  const gummy = lot({ inventory_type: "Solid Edible", lab: { total_thc_pct: 100, total_cbd_pct: 0, lab_name: null, passed: true } });
  const strongFlower = lot({ inventory_type: "Concentrate for Inhalation", lab: { total_thc_pct: 85, total_cbd_pct: 0, lab_name: null, passed: true } });
  ok(
    compareLots(flower, gummy, thc, "desc") < 0,
    "a 21.66% flower outranks a 100mg gummy — the numbers are different quantities",
  );
  ok(
    compareLots(flower, gummy, thc, "asc") < 0,
    "the mg/percent grouping does NOT flip with direction",
  );
  const sortedDesc = sortLots([gummy, flower, strongFlower], thc, "desc");
  ok(sortedDesc[0] === strongFlower, "within percent, 85% leads");
  ok(sortedDesc[1] === flower, "then 21.66%");
  ok(sortedDesc[2] === gummy, "mg-dosed products come after, as their own group");

  // ---- stability
  const a1 = lot({ product_name: "Same", lot_code: "A" });
  const a2 = lot({ product_name: "Same", lot_code: "B" });
  const stable = sortLots([a1, a2], prod, "asc");
  ok(stable[0] === a1 && stable[1] === a2, "equal values keep their incoming order");
  const stableDesc = sortLots([a1, a2], prod, "desc");
  ok(stableDesc[0] === a1 && stableDesc[1] === a2, "stability holds descending too");

  // ---- sortLots does not mutate its input
  const input = [lot({ on_hand_qty: 1 }), lot({ on_hand_qty: 9 })];
  const first = input[0];
  sortLots(input, qty, "desc");
  ok(input[0] === first, "sortLots returns a new array and leaves the input alone");

  // ---- COA column groups the gaps
  const coa = byKey("coa");
  const withCoa = lot({ lab: { total_thc_pct: null, total_cbd_pct: null, lab_name: "L", passed: true } });
  ok(compareLots(withCoa, lot({}), coa, "desc") < 0, "lots WITH a COA lead when descending");
  ok(compareLots(withCoa, lot({}), coa, "asc") > 0, "missing COAs lead when ascending");

  console.log(`inventory-sort-core: ${passed} assertions passed`);
}
