/**
 * src/lib/compliance/sample-history-core.ts
 *
 * PURE filtering / sorting / summarizing for the Employee Sample History page
 * (no server-only imports → tsx-testable). Operates on already-fetched sample
 * events. Only OUTGOING-to-employee events matter for an employee's history
 * (trade outgoing); incoming-from-processor events are not "an employee
 * received" records and are excluded by the server query.
 *
 * Controlling cap (WAC 314-55-096(1)(j)(vi)): trade 30 units per employee per
 * calendar quarter. IQC is producer/processor-only [096(3)] and is not
 * available to a retailer, so it has been fully retired from this module.
 */
import {
  quarterLabel,
  PRODUCT_TYPE_LABELS,
  CATEGORY_LABELS,
  type SampleCategory,
  type SampleProductType,
} from "@/lib/compliance/trade-samples-core";

export { quarterLabel, PRODUCT_TYPE_LABELS, CATEGORY_LABELS };

/** The subset of a sample event this page needs (a paid-employee receipt). */
export type HistoryEvent = {
  id: string;
  category: SampleCategory;
  productType: SampleProductType;
  unitCount: number;
  unitSizeGrams: number | null;
  unitSizeMg: number | null;
  thcMgPerServing: number | null;
  quarterKey: string;
  employeeId: string | null;
  employeeName: string | null;
  fromSampleJar: boolean;
  note: string | null;
  /** CCRS: the sample product name/strain assigned to the employee (null on
   * legacy rows recorded before migration 0105). */
  sourceProductName: string | null;
  /** CCRS: the traceability lot / unique-identifier reference of the sample. */
  sourceLotRef: string | null;
  createdAt: string; // ISO
};

export type HistorySort = "date_desc" | "date_asc" | "units_desc" | "units_asc" | "employee_asc" | "type_asc";

export type HistoryFilters = {
  employeeId?: string | null; // null/undefined = all
  quarterKey?: string | null; // null/undefined = all
  category?: SampleCategory | "all";
  productType?: SampleProductType | "all";
  search?: string; // matches employee name / note
};

/** Apply the filters (all optional, AND-combined). */
export function filterHistory(events: HistoryEvent[], f: HistoryFilters): HistoryEvent[] {
  const search = (f.search ?? "").trim().toLowerCase();
  return events.filter((e) => {
    if (f.employeeId && e.employeeId !== f.employeeId) return false;
    if (f.quarterKey && e.quarterKey !== f.quarterKey) return false;
    if (f.category && f.category !== "all" && e.category !== f.category) return false;
    if (f.productType && f.productType !== "all" && e.productType !== f.productType) return false;
    if (search) {
      const hay = `${e.employeeName ?? ""} ${e.note ?? ""} ${e.sourceProductName ?? ""} ${e.sourceLotRef ?? ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

/** Sort a copy of the events by the chosen key (stable, deterministic). */
export function sortHistory(events: HistoryEvent[], sort: HistorySort): HistoryEvent[] {
  const copy = [...events];
  const byDate = (a: HistoryEvent, b: HistoryEvent) => a.createdAt.localeCompare(b.createdAt);
  switch (sort) {
    case "date_asc":
      copy.sort(byDate);
      break;
    case "units_desc":
      copy.sort((a, b) => b.unitCount - a.unitCount || byDate(b, a));
      break;
    case "units_asc":
      copy.sort((a, b) => a.unitCount - b.unitCount || byDate(a, b));
      break;
    case "employee_asc":
      copy.sort((a, b) => (a.employeeName ?? "").localeCompare(b.employeeName ?? "") || byDate(b, a));
      break;
    case "type_asc":
      copy.sort(
        (a, b) =>
          a.category.localeCompare(b.category) ||
          a.productType.localeCompare(b.productType) ||
          byDate(b, a),
      );
      break;
    case "date_desc":
    default:
      copy.sort((a, b) => byDate(b, a));
      break;
  }
  return copy;
}

/** Convenience: filter then sort. */
export function queryHistory(events: HistoryEvent[], f: HistoryFilters, sort: HistorySort): HistoryEvent[] {
  return sortHistory(filterHistory(events, f), sort);
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export type HistoryTotals = {
  events: number;
  totalUnits: number;
  tradeUnits: number;
  fromJarUnits: number;
};

/** Aggregate totals across a (usually already-filtered) list. */
export function summarizeHistory(events: HistoryEvent[]): HistoryTotals {
  const t: HistoryTotals = {
    events: events.length,
    totalUnits: 0,
    tradeUnits: 0,
    fromJarUnits: 0,
  };
  for (const e of events) {
    t.totalUnits += e.unitCount;
    t.tradeUnits += e.unitCount;
    if (e.fromSampleJar) t.fromJarUnits += e.unitCount;
  }
  return t;
}

/** Per-employee, per-quarter roll-up vs the statutory caps (for the summary cards). */
export type EmployeeQuarterRollup = {
  employeeId: string | null;
  employeeName: string;
  quarterKey: string;
  tradeUnits: number;
  tradeCap: number;
};

export function rollupByEmployeeQuarter(
  events: HistoryEvent[],
  caps: { tradeCap: number },
): EmployeeQuarterRollup[] {
  const map = new Map<string, EmployeeQuarterRollup>();
  for (const e of events) {
    const key = `${e.employeeId ?? e.employeeName ?? "?"}::${e.quarterKey}`;
    const cur =
      map.get(key) ??
      ({
        employeeId: e.employeeId,
        employeeName: e.employeeName ?? "(unknown)",
        quarterKey: e.quarterKey,
        tradeUnits: 0,
        tradeCap: caps.tradeCap,
      } satisfies EmployeeQuarterRollup);
    cur.tradeUnits += e.unitCount;
    if (e.employeeName) cur.employeeName = e.employeeName;
    map.set(key, cur);
  }
  // newest quarter first, then employee name
  return [...map.values()].sort(
    (a, b) => b.quarterKey.localeCompare(a.quarterKey) || a.employeeName.localeCompare(b.employeeName),
  );
}

/** Distinct quarter keys present (newest first) — for the quarter filter dropdown. */
export function distinctQuarters(events: HistoryEvent[]): string[] {
  return [...new Set(events.map((e) => e.quarterKey))].sort((a, b) => b.localeCompare(a));
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function csvCell(v: string | number | boolean | null): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from the (filtered/sorted) events for download. */
export function historyToCsv(events: HistoryEvent[]): string {
  const header = [
    "date",
    "employee",
    "category",
    "product_type",
    "sample_product",
    "lot_ref",
    "units",
    "unit_size_g",
    "unit_size_mg",
    "thc_mg",
    "from_sample_jar",
    "quarter",
    "note",
  ];
  const rows = events.map((e) =>
    [
      e.createdAt.slice(0, 10),
      e.employeeName ?? "",
      CATEGORY_LABELS[e.category],
      PRODUCT_TYPE_LABELS[e.productType],
      e.sourceProductName ?? "",
      e.sourceLotRef ?? "",
      e.unitCount,
      e.unitSizeGrams ?? "",
      e.unitSizeMg ?? "",
      e.thcMgPerServing ?? "",
      e.fromSampleJar ? "yes" : "no",
      e.quarterKey,
      e.note ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

function ev(p: Partial<HistoryEvent> & { id: string }): HistoryEvent {
  return {
    id: p.id,
    category: p.category ?? "trade",
    productType: p.productType ?? "useable",
    unitCount: p.unitCount ?? 1,
    unitSizeGrams: p.unitSizeGrams ?? null,
    unitSizeMg: p.unitSizeMg ?? null,
    thcMgPerServing: p.thcMgPerServing ?? null,
    quarterKey: p.quarterKey ?? "2026-Q3",
    employeeId: p.employeeId ?? "e1",
    employeeName: p.employeeName ?? "Alice",
    fromSampleJar: p.fromSampleJar ?? false,
    note: p.note ?? null,
    sourceProductName: p.sourceProductName ?? null,
    sourceLotRef: p.sourceLotRef ?? null,
    createdAt: p.createdAt ?? "2026-07-01T10:00:00.000Z",
  };
}

export function __runSampleHistoryCoreTests(): string {
  const events: HistoryEvent[] = [
    ev({ id: "1", employeeId: "e1", employeeName: "Alice", category: "trade", productType: "useable", unitCount: 5, createdAt: "2026-07-01T10:00:00Z", quarterKey: "2026-Q3" }),
    ev({ id: "2", employeeId: "e2", employeeName: "Bob", category: "trade", productType: "concentrate", unitCount: 3, createdAt: "2026-07-05T10:00:00Z", quarterKey: "2026-Q3" }),
    ev({ id: "3", employeeId: "e1", employeeName: "Alice", category: "trade", productType: "useable", unitCount: 10, createdAt: "2026-04-10T10:00:00Z", quarterKey: "2026-Q2", fromSampleJar: false }),
    ev({ id: "4", employeeId: "e1", employeeName: "Alice", category: "trade", productType: "concentrate", unitCount: 2, createdAt: "2026-07-03T10:00:00Z", quarterKey: "2026-Q3", fromSampleJar: true, note: "jar leftovers" }),
  ];

  // filter by employee
  assert(filterHistory(events, { employeeId: "e1" }).length === 3, "filter e1 → 3");
  assert(filterHistory(events, { employeeId: "e2" }).length === 1, "filter e2 → 1");

  // filter by quarter
  assert(filterHistory(events, { quarterKey: "2026-Q3" }).length === 3, "filter Q3 → 3");

  // filter by category (only trade remains; "all" is a superset)
  assert(filterHistory(events, { category: "trade" }).length === 4, "filter trade → 4");
  assert(filterHistory(events, { category: "all" }).length === 4, "filter all → 4");

  // filter by product type
  assert(filterHistory(events, { productType: "concentrate" }).length === 2, "filter concentrate → 2");

  // search matches note + name
  assert(filterHistory(events, { search: "jar" }).length === 1, "search note");
  assert(filterHistory(events, { search: "bob" }).length === 1, "search name");

  // combined AND
  assert(filterHistory(events, { employeeId: "e1", category: "trade" }).length === 3, "e1 + trade → 3");

  // sort by units desc
  const su = sortHistory(events, "units_desc");
  assert(su[0]!.id === "3" && su[1]!.id === "1", "units_desc order");

  // sort by date asc/desc
  assert(sortHistory(events, "date_asc")[0]!.id === "3", "date_asc oldest first");
  assert(sortHistory(events, "date_desc")[0]!.id === "2", "date_desc newest first (Jul 5)");

  // sort by employee
  assert(sortHistory(events, "employee_asc")[0]!.employeeName === "Alice", "employee_asc Alice first");

  // does not mutate input
  const before = events.map((e) => e.id).join(",");
  sortHistory(events, "units_desc");
  assert(events.map((e) => e.id).join(",") === before, "sort does not mutate");

  // summarize (all units are trade now)
  const totalsAll = summarizeHistory(events);
  assert(totalsAll.totalUnits === 20 && totalsAll.tradeUnits === 20, "totals");
  assert(totalsAll.fromJarUnits === 2, "jar totals");

  // rollup by employee/quarter
  const caps = { tradeCap: 30 };
  const roll = rollupByEmployeeQuarter(events, caps);
  const aliceQ3 = roll.find((r) => r.employeeId === "e1" && r.quarterKey === "2026-Q3");
  assert(!!aliceQ3 && aliceQ3.tradeUnits === 7, "alice Q3 rollup");
  const aliceQ2 = roll.find((r) => r.employeeId === "e1" && r.quarterKey === "2026-Q2");
  assert(!!aliceQ2 && aliceQ2.tradeUnits === 10, "alice Q2 rollup");
  assert(roll[0]!.quarterKey === "2026-Q3", "rollup newest quarter first");

  // distinct quarters
  const qs = distinctQuarters(events);
  assert(qs.length === 2 && qs[0] === "2026-Q3", "distinct quarters newest first");

  // CSV
  const csv = historyToCsv([events[3]!]);
  const lines = csv.split("\n");
  assert(lines.length === 2, "csv header + 1 row");
  assert(lines[0]!.startsWith("date,employee,category"), "csv header");
  assert(lines[0]!.includes("sample_product") && lines[0]!.includes("lot_ref"), "csv header has product identity columns");
  assert(lines[1]!.includes("jar leftovers"), "csv includes note");

  // CSV escaping of commas/quotes
  const tricky = historyToCsv([ev({ id: "x", note: 'a, "quoted", b', employeeName: "O'Neil" })]);
  assert(tricky.includes('"a, ""quoted"", b"'), "csv escapes commas + quotes");

  // product identity surfaces in CSV + search
  const withProduct = ev({ id: "p1", sourceProductName: "OG Kush", sourceLotRef: "L-1042", note: null });
  const csvP = historyToCsv([withProduct]);
  assert(csvP.split("\n")[1]!.includes("OG Kush") && csvP.split("\n")[1]!.includes("L-1042"), "csv includes sample product + lot");
  assert(filterHistory([withProduct], { search: "og kush" }).length === 1, "search matches sample product name");
  assert(filterHistory([withProduct], { search: "l-1042" }).length === 1, "search matches lot ref");

  return "OK: sample-history-core tests passed";
}
