/**
 * src/lib/inventory/expiry-report-export.ts  (R34)
 *
 * PURE: ExpiryReport -> WorkbookSpec for the Expiration report export
 * (/admin/reports/expiration/export?sheet=...&format=csv|xlsx). Same numbers
 * as the page (both read buildExpiryReport). Money stays in MINOR units - the
 * shared workbook helper divides currency columns by 100. Percent columns are
 * fractions (0..1), which the helper formats as percentages.
 */
import type { TableColumn, TableRow, TableSheet, WorkbookSpec } from "@/lib/reports/workbook";
import { monthLabel, type ExpiryReport } from "@/lib/inventory/expiry-rules-core";

export const EXPIRY_EXPORT_SHEETS = ["watchlist", "buckets", "forecast", "sources", "categories", "gaps", "rules"] as const;
export type ExpiryExportSheet = (typeof EXPIRY_EXPORT_SHEETS)[number];

/** "all" (or anything unknown) -> every sheet; otherwise exactly one. */
export function parseExpirySheet(v: string | null | undefined): ExpiryExportSheet | "all" {
  const s = String(v ?? "").toLowerCase();
  return (EXPIRY_EXPORT_SHEETS as readonly string[]).includes(s) ? (s as ExpiryExportSheet) : "all";
}

const col = (key: string, header: string, type: TableColumn["type"] = "text"): TableColumn => ({ key, header, type });

function sheetFor(report: ExpiryReport, which: ExpiryExportSheet): TableSheet {
  const { stats } = report;
  switch (which) {
    case "watchlist":
      return {
        name: "Watchlist (90 days)",
        caption: `On-hand lots expired or expiring within 90 days of ${report.today}`,
        columns: [
          col("lot", "Lot"),
          col("product", "Product"),
          col("category", "Category"),
          col("date", "Date"),
          col("days", "Days from today", "integer"),
          col("status", "Status"),
          col("source", "Date source"),
          col("onHand", "On hand", "number"),
          col("value", "Value at cost", "currency"),
          col("costKnown", "Cost known"),
        ],
        rows: report.watch.map(
          (w): TableRow => ({
            lot: w.lotCode ?? w.id,
            product: w.productName ?? "",
            category: w.categoryLabel,
            date: w.expiresOn,
            days: w.days,
            status: w.tone === "expired" ? "Expired" : w.tone === "soon" ? "Expiring soon" : "Upcoming",
            source: w.sourceLabel,
            onHand: w.onHand,
            value: w.valueMinor,
            costKnown: w.costKnown ? "Yes" : "No",
          }),
        ),
        totals: {
          lot: "TOTAL",
          onHand: report.watch.reduce((n, w) => n + w.onHand, 0),
          value: report.watch.reduce((n, w) => n + w.valueMinor, 0),
        },
      };
    case "buckets":
      return {
        name: "Aging buckets",
        columns: [col("bucket", "Bucket"), col("lots", "Lots", "integer"), col("units", "Units", "number"), col("value", "Value at cost", "currency"), col("uncosted", "Lots without cost", "integer")],
        rows: stats.buckets.map((b): TableRow => ({ bucket: b.label, lots: b.lots, units: b.units, value: b.valueMinor, uncosted: b.uncostedLots })),
        totals: {
          bucket: "TOTAL",
          lots: stats.buckets.reduce((n, b) => n + b.lots, 0),
          units: stats.buckets.reduce((n, b) => n + b.units, 0),
          value: stats.buckets.reduce((n, b) => n + b.valueMinor, 0),
          uncosted: stats.buckets.reduce((n, b) => n + b.uncostedLots, 0),
        },
      };
    case "forecast":
      return {
        name: "12-month forecast",
        caption: "Already-expired stock is in the Expired bucket, not here",
        columns: [col("month", "Month"), col("lots", "Lots", "integer"), col("value", "Value at cost", "currency")],
        rows: report.forecast.map((m): TableRow => ({ month: monthLabel(m.month), lots: m.lots, value: m.valueMinor })),
        totals: {
          month: "TOTAL",
          lots: report.forecast.reduce((n, m) => n + m.lots, 0),
          value: report.forecast.reduce((n, m) => n + m.valueMinor, 0),
        },
      };
    case "sources":
      return {
        name: "Date sources",
        columns: [col("source", "Where the date came from"), col("lots", "On-hand lots", "integer"), col("share", "Share", "percent")],
        rows: stats.bySource.map((s): TableRow => ({ source: s.label, lots: s.lots, share: stats.onHandLots ? s.lots / stats.onHandLots : 0 })),
      };
    case "categories":
      return {
        name: "By category",
        columns: [
          col("category", "Category"),
          col("lots", "On-hand lots", "integer"),
          col("dated", "Dated", "integer"),
          col("coverage", "Coverage", "percent"),
          col("expired", "Expired", "integer"),
          col("soon", "0-30 days", "integer"),
          col("risk", "Value at risk", "currency"),
        ],
        rows: stats.byCategory.map(
          (c): TableRow => ({
            category: report.categoryLabels[c.category] ?? c.category,
            lots: c.lots,
            dated: c.dated,
            coverage: c.lots ? c.dated / c.lots : 0,
            expired: c.expired,
            soon: c.soon,
            risk: c.valueAtRiskMinor,
          }),
        ),
        totals: { category: "TOTAL", lots: stats.onHandLots, dated: stats.dated, risk: stats.valueAtRiskMinor },
      };
    case "gaps":
      return {
        name: "Coverage gaps",
        columns: [col("category", "Category"), col("undated", "Undated on-hand lots", "integer"), col("onHand", "Of on-hand lots", "integer"), col("rule", "Category rule")],
        rows: report.gaps.map(
          (g): TableRow => ({
            category: g.label,
            undated: g.undated,
            onHand: g.onHandLots,
            rule: g.category === "unmapped" ? "File under a category first" : g.hasCategoryRule ? "Yes - preview & apply" : "None yet",
          }),
        ),
      };
    case "rules":
      return {
        name: "Rule usage",
        columns: [
          col("rule", "Rule"),
          col("describe", "What it does"),
          col("enabled", "Enabled"),
          col("lots", "Lots dated", "integer"),
          col("onHand", "On hand", "integer"),
          col("expired", "Expired", "integer"),
          col("soon", "0-30 days", "integer"),
          col("value", "On-hand value", "currency"),
        ],
        rows: report.rules.map(
          (r): TableRow => ({
            rule: r.label,
            describe: r.describe,
            enabled: r.scope === "deleted" ? "Deleted" : r.enabled ? "Yes" : "No",
            lots: r.lots,
            onHand: r.onHandLots,
            expired: r.expired,
            soon: r.soon,
            value: r.valueMinor,
          }),
        ),
      };
  }
}

export function expiryReportWorkbook(report: ExpiryReport, which: ExpiryExportSheet | "all"): WorkbookSpec {
  const names = which === "all" ? [...EXPIRY_EXPORT_SHEETS] : [which];
  return {
    filename: `greenway-expiration-${which}-${report.today}`,
    title: `Greenway Expiration Report (${report.today})`,
    sheets: names.map((n) => sheetFor(report, n)),
  };
}

// ---------------------------------------------------------------------------
// Self-tests (pure; registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runExpiryReportExportTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL expiry-report-export:", m);
    }
  };
  const report: ExpiryReport = {
    today: "2026-05-15",
    stats: {
      onHandLots: 4,
      dated: 3,
      coveragePct: 75,
      buckets: [
        { key: "expired", label: "Expired", lots: 1, units: 2, valueMinor: 2000, uncostedLots: 0 },
        { key: "d0_30", label: "0-30 days", lots: 2, units: 6, valueMinor: 1800, uncostedLots: 1 },
      ] as ExpiryReport["stats"]["buckets"],
      bySource: [
        { key: "rule", label: "Expiration rule", lots: 3 },
        { key: "none", label: "No date", lots: 1 },
      ],
      byCategory: [{ category: "flower", lots: 4, dated: 3, expired: 1, soon: 2, valueAtRiskMinor: 3800 }],
      valueAtRiskMinor: 3800,
    },
    watch: [
      { id: "a", expiresOn: "2026-05-10", days: -5, tone: "expired", source: "manifest", sourceLabel: "Vendor manifest", onHand: 2, valueMinor: 2000, costKnown: true, lotCode: "LC-1", productName: "P1", categoryLabel: "Flower" },
      { id: "b", expiresOn: "2026-06-01", days: 17, tone: "soon", source: "rule", sourceLabel: "Expiration rule", onHand: 1, valueMinor: 0, costKnown: false, lotCode: null, productName: null, categoryLabel: "Flower" },
    ],
    forecast: [
      { month: "2026-05", lots: 0, valueMinor: 0 },
      { month: "2026-06", lots: 2, valueMinor: 1800 },
    ],
    rules: [
      { ruleId: "r1", lots: 2, onHandLots: 2, expired: 0, soon: 2, valueMinor: 1800, label: "Category: Flower", describe: "12 months after received date", enabled: true, scope: "category" },
      { ruleId: "r2", lots: 1, onHandLots: 0, expired: 0, soon: 0, valueMinor: 0, label: "Deleted rule", describe: "x", enabled: false, scope: "deleted" },
    ],
    categoryLabels: { flower: "Flower Buds", unmapped: "Unmapped" },
    rulesActive: 1,
    gaps: [
      { category: "unmapped", label: "Unmapped", onHandLots: 2, undated: 2, hasCategoryRule: false },
      { category: "flower", label: "Flower Buds", onHandLots: 4, undated: 1, hasCategoryRule: true },
    ],
  };
  ok(parseExpirySheet("Watchlist") === "watchlist" && parseExpirySheet("nope") === "all" && parseExpirySheet(null) === "all", "parse sheet");
  const all = expiryReportWorkbook(report, "all");
  ok(all.sheets.length === EXPIRY_EXPORT_SHEETS.length && all.filename === "greenway-expiration-all-2026-05-15", "all sheets + filename");
  ok(all.sheets.every((s) => s.name.length <= 31), "sheet names fit Excel's 31 chars");
  ok(all.sheets.every((s) => s.rows.length > 0 && s.rows.every((r) => s.columns.every((c) => c.key in r))), "every row carries every column key");
  const w = expiryReportWorkbook(report, "watchlist").sheets[0];
  ok(w.rows[0].lot === "LC-1" && w.rows[1].lot === "b" && w.rows[0].status === "Expired" && w.rows[1].status === "Expiring soon", "watchlist: lot code fallback to id, status words");
  ok(w.rows[1].costKnown === "No" && w.totals?.value === 2000 && w.totals?.onHand === 3, "watchlist: uncosted flagged, totals in minor units");
  ok(w.columns.find((c) => c.key === "value")?.type === "currency", "money column is currency (minor units)");
  const b = expiryReportWorkbook(report, "buckets").sheets[0];
  ok(b.totals?.lots === 3 && b.totals?.value === 3800 && b.totals?.uncosted === 1, "bucket totals");
  const f = expiryReportWorkbook(report, "forecast").sheets[0];
  ok(f.rows[1].month === "Jun 2026" && f.totals?.value === 1800, "forecast month label + total");
  const s = expiryReportWorkbook(report, "sources").sheets[0];
  ok(s.rows[0].share === 0.75 && s.rows[1].share === 0.25, "source share as fraction");
  const c = expiryReportWorkbook(report, "categories").sheets[0];
  ok(c.rows[0].category === "Flower Buds" && c.rows[0].coverage === 0.75 && c.totals?.risk === 3800, "category label from registry, coverage fraction");
  const g = expiryReportWorkbook(report, "gaps").sheets[0];
  ok(g.rows[0].rule === "File under a category first" && g.rows[1].rule === "Yes - preview & apply", "gap next step words");
  const r = expiryReportWorkbook(report, "rules").sheets[0];
  ok(r.rows[0].enabled === "Yes" && r.rows[1].enabled === "Deleted", "rule enabled words");
  const empty = expiryReportWorkbook({ ...report, stats: { ...report.stats, onHandLots: 0, bySource: [{ key: "none", label: "No date", lots: 0 }] } }, "sources").sheets[0];
  ok(empty.rows[0].share === 0, "no divide by zero");
  return { passed, failed };
}
