/**
 * GET /admin/reports/customers/export?format=csv|xlsx&from=&to=
 *
 * Export the customers report as a clean CSV or styled multi-sheet .xlsx.
 * Staff-gated (reports.view). The workbook carries the top customers, the
 * new-vs-returning split, and the RFM-style segments — each on its own sheet
 * (xlsx) or section (csv). Money is emitted as real currency cells (xlsx) or
 * two-decimal dollars (csv) via the shared workbook helper.
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { getCustomersReport } from "@/lib/reports/customers";
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

const CUSTOMER_COLUMNS: TableColumn[] = [
  { key: "label", header: "Customer", type: "text" },
  { key: "email", header: "Email", type: "text" },
  { key: "segment", header: "Segment", type: "text" },
  { key: "orders", header: "Orders", type: "integer" },
  { key: "units", header: "Units bought", type: "integer" },
  { key: "spend", header: "Spend", type: "currency" },
  { key: "avgOrder", header: "Avg order", type: "currency" },
  { key: "firstOrder", header: "First order", type: "text" },
  { key: "lastOrder", header: "Last order", type: "text" },
];

const SEGMENT_COLUMNS: TableColumn[] = [
  { key: "label", header: "Segment", type: "text" },
  { key: "customers", header: "Customers", type: "integer" },
  { key: "revenue", header: "Revenue", type: "currency" },
];

const NEW_RETURNING_COLUMNS: TableColumn[] = [
  { key: "label", header: "Type", type: "text" },
  { key: "customers", header: "Customers", type: "integer" },
  { key: "orders", header: "Orders", type: "integer" },
  { key: "revenue", header: "Revenue", type: "currency" },
  { key: "share", header: "Revenue share", type: "percent" },
];

export async function GET(request: Request) {
  await requirePermission("reports.view");
  const url = new URL(request.url);
  const format = parseFormat(url.searchParams.get("format"));
  const range = resolveRange({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    range: url.searchParams.get("range") ?? undefined,
    year: url.searchParams.get("year") ?? undefined,
  });

  const report = await getCustomersReport(range.fromISO, range.toISO);
  const stamp = `${range.fromISO.slice(0, 10)}_${range.toISO.slice(0, 10)}`;

  const customerRows: TableRow[] = report.topCustomers.map((r) => ({
    label: r.label,
    email: r.email,
    segment: r.segment,
    orders: r.orders,
    units: r.unitsBought,
    spend: r.revenueMinorUnits,
    avgOrder: r.avgOrderMinorUnits,
    firstOrder: r.firstOrderDate,
    lastOrder: r.lastOrderDate,
  }));

  const segmentRows: TableRow[] = report.segments.map((s) => ({
    label: s.label,
    customers: s.customers,
    revenue: s.revenueMinorUnits,
  }));

  const newReturningRows: TableRow[] = report.newVsReturning.map((r) => ({
    label: r.label,
    customers: r.customers,
    orders: r.orders,
    revenue: r.revenueMinorUnits,
    share: r.revenueShare,
  }));

  const sheets: TableSheet[] = [
    { name: "Top customers", caption: range.label, columns: CUSTOMER_COLUMNS, rows: customerRows },
    { name: "New vs returning", caption: range.label, columns: NEW_RETURNING_COLUMNS, rows: newReturningRows },
    { name: "Segments", caption: range.label, columns: SEGMENT_COLUMNS, rows: segmentRows },
  ];

  const spec: WorkbookSpec = {
    filename: `greenway_customers_${stamp}`,
    title: "Greenway — Customers",
    sheets,
  };

  return exportResponse(spec, format);
}
