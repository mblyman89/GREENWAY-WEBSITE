/**
 * GET /admin/reports/loyalty/export?format=csv|xlsx&from=&to=
 *
 * Export the enriched loyalty & discount report (Slice 51) as CSV or styled
 * XLSX. Staff-gated (reports.view). Sheets: Summary KPIs, Points by source,
 * Tier detail, Discount code funnel. Money as currency cells via the shared
 * workbook helper.
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { getLoyaltyReport } from "@/lib/reports/operations";
import {
  exportResponse,
  parseFormat,
  type TableColumn,
  type TableRow,
  type TableSheet,
  type WorkbookSpec,
} from "@/lib/reports/workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUMMARY_COLUMNS: TableColumn[] = [
  { key: "metric", header: "Metric", type: "text" },
  { key: "value", header: "Value", type: "text" },
];

const KIND_COLUMNS: TableColumn[] = [
  { key: "label", header: "Source", type: "text" },
  { key: "points", header: "Points", type: "integer" },
];

const TIER_COLUMNS: TableColumn[] = [
  { key: "name", header: "Tier", type: "text" },
  { key: "discountBps", header: "Discount (bps)", type: "integer" },
  { key: "members", header: "Members", type: "integer" },
  { key: "outstandingPoints", header: "Outstanding pts", type: "integer" },
  { key: "lifetimePoints", header: "Lifetime pts", type: "integer" },
];

const CODE_COLUMNS: TableColumn[] = [
  { key: "label", header: "Stage", type: "text" },
  { key: "count", header: "Codes", type: "integer" },
  { key: "valueMinor", header: "Cash value", type: "currency" },
];

export async function GET(request: Request) {
  await requirePermission("reports.view");

  const url = new URL(request.url);
  const range = resolveRange({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    range: url.searchParams.get("range") ?? undefined,
    year: url.searchParams.get("year") ?? undefined,
  });
  const format = parseFormat(url.searchParams.get("format"));

  const r = await getLoyaltyReport(range.fromISO, range.toISO);
  const money = (m: number) => (m / 100).toFixed(2);
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  const summaryRows: TableRow[] = [
    { metric: "Enrolled members", value: r.enrolledAccounts.toLocaleString("en-US") },
    { metric: "Active members", value: r.activeAccounts.toLocaleString("en-US") },
    { metric: "New enrollments (window)", value: r.newEnrollments.toLocaleString("en-US") },
    { metric: "Points earned", value: r.pointsEarned.toLocaleString("en-US") },
    { metric: "Points redeemed", value: r.pointsRedeemed.toLocaleString("en-US") },
    { metric: "Points outstanding", value: r.pointsOutstanding.toLocaleString("en-US") },
    { metric: "Redemption rate", value: pct(r.redemptionRate) },
    { metric: "Points liability ($)", value: money(r.liabilityMinor) },
    { metric: "Redeemed value ($)", value: money(r.redeemedValueMinor) },
    { metric: "Breakage points", value: r.breakagePoints.toLocaleString("en-US") },
    { metric: "Breakage ($)", value: money(r.breakageMinor) },
    { metric: "Avg earn basis ($)", value: money(r.avgEarnBasisMinor) },
    { metric: "Codes issued", value: r.codesIssued.toLocaleString("en-US") },
    { metric: "Codes redeemed", value: r.codesRedeemed.toLocaleString("en-US") },
    { metric: "Code redemption rate", value: pct(r.codeRedemptionRate) },
    { metric: "Avg days to redeem", value: String(r.avgDaysToRedeem) },
    { metric: "Discount value redeemed ($)", value: money(r.discountValueMinor) },
    { metric: "Outstanding code value ($)", value: money(r.outstandingCodeValueMinor) },
  ];

  const sheets: TableSheet[] = [
    { name: "Summary", caption: "Loyalty program KPIs", columns: SUMMARY_COLUMNS, rows: summaryRows },
    {
      name: "Points by source",
      columns: KIND_COLUMNS,
      rows: r.pointsByKind.map((k) => ({ label: k.label, points: k.points })),
    },
    {
      name: "Tier detail",
      columns: TIER_COLUMNS,
      rows: r.tiers.map((t) => ({
        name: t.name,
        discountBps: t.discountBps,
        members: t.members,
        outstandingPoints: t.outstandingPoints,
        lifetimePoints: t.lifetimePoints,
      })),
    },
    {
      name: "Code funnel",
      columns: CODE_COLUMNS,
      rows: r.codeFunnel.map((c) => ({ label: c.label, count: c.count, valueMinor: c.valueMinor })),
    },
  ];

  const spec: WorkbookSpec = {
    filename: `loyalty-report_${range.fromISO.slice(0, 10)}_${range.toISO.slice(0, 10)}`,
    title: "Loyalty & discount report",
    sheets,
  };

  return exportResponse(spec, format);
}
