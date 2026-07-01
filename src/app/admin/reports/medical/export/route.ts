/**
 * GET /admin/reports/medical/export?format=csv|xlsx&from=&to=
 *
 * Export the enriched medical report (Slice 53) as CSV or styled XLSX.
 * Staff-gated (reports.view). Sheets: Summary, Cards by status, Expiry outlook,
 * Top exempt products, Card-validity audit, Daily trend.
 * Money columns are emitted in minor units and rendered as currency.
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { getMedicalReport } from "@/lib/reports/operations";
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

const STATUS_COLUMNS: TableColumn[] = [
  { key: "label", header: "Card status", type: "text" },
  { key: "count", header: "Cards", type: "integer" },
];

const BUCKET_COLUMNS: TableColumn[] = [
  { key: "label", header: "Expiry window", type: "text" },
  { key: "count", header: "Active cards", type: "integer" },
];

const PRODUCT_COLUMNS: TableColumn[] = [
  { key: "name", header: "Product", type: "text" },
  { key: "sku", header: "SKU", type: "text" },
  { key: "units", header: "Units", type: "integer" },
  { key: "salesMinor", header: "Exempt sales", type: "currency" },
  { key: "exciseExemptMinor", header: "Excise exempted", type: "currency" },
];

const ISSUE_COLUMNS: TableColumn[] = [
  { key: "saleDate", header: "Sale date", type: "text" },
  { key: "upid", header: "UPID", type: "text" },
  { key: "productName", header: "Product", type: "text" },
  { key: "cardExpiresOn", header: "Card expired on", type: "text" },
  { key: "salesPriceMinor", header: "Sale price", type: "currency" },
];

const DAILY_COLUMNS: TableColumn[] = [
  { key: "date", header: "Date", type: "text" },
  { key: "sales", header: "Exempt sales", type: "integer" },
  { key: "salesMinor", header: "Exempt value", type: "currency" },
  { key: "exciseMinor", header: "Excise exempted", type: "currency" },
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

  const r = await getMedicalReport(range.fromDate, range.toDate);

  const summaryRows: TableRow[] = [
    { metric: "Medical endorsement", value: r.isEndorsed ? "Endorsed" : "Not endorsed" },
    { metric: "Endorsement number", value: r.endorsementNumber ?? "—" },
    { metric: "Excise exemption ends", value: r.exemptionUntil ?? "—" },
    {
      metric: "Days until exemption ends",
      value: r.daysUntilExemptionEnds !== null ? String(r.daysUntilExemptionEnds) : "—",
    },
    { metric: "Medical patients", value: String(r.patients) },
    { metric: "Active cards", value: String(r.activeCards) },
    { metric: "Cards in DOH database", value: String(r.inDohDatabase) },
    { metric: "Expiring ≤ 30 days", value: String(r.expiringSoon) },
    { metric: "Unique patients served", value: String(r.uniquePatients) },
    { metric: "Exempt sales (line items)", value: String(r.exemptSales) },
    { metric: "Exempt sales value ($)", value: (r.exemptSalesMinor / 100).toFixed(2) },
    { metric: "Avg exempt basket ($)", value: (r.avgExemptBasketMinor / 100).toFixed(2) },
    { metric: "Sales tax exempted ($)", value: (r.salesTaxExemptedMinor / 100).toFixed(2) },
    { metric: "Excise exempted ($)", value: (r.exciseExemptedMinor / 100).toFixed(2) },
    { metric: "Card-validity issues", value: String(r.cardValidityIssues.length) },
  ];

  const productRows: TableRow[] = r.topExemptProducts.map((p) => ({
    name: p.name,
    sku: p.sku,
    units: p.units,
    salesMinor: p.salesMinor,
    exciseExemptMinor: p.exciseExemptMinor,
  }));

  const issueRows: TableRow[] = r.cardValidityIssues.map((i) => ({
    saleDate: i.saleDate,
    upid: i.upid,
    productName: i.productName,
    cardExpiresOn: i.cardExpiresOn ?? "—",
    salesPriceMinor: i.salesPriceMinor,
  }));

  const dailyRows: TableRow[] = r.daily.map((d) => ({
    date: d.date,
    sales: d.sales,
    salesMinor: d.salesMinor,
    exciseMinor: d.exciseMinor,
  }));

  const sheets: TableSheet[] = [
    { name: "Summary", caption: "Medical compliance & exempt-sale KPIs", columns: SUMMARY_COLUMNS, rows: summaryRows },
    { name: "Cards by status", columns: STATUS_COLUMNS, rows: r.authByStatus },
    { name: "Expiry outlook", columns: BUCKET_COLUMNS, rows: r.expiryBuckets },
    { name: "Top exempt products", columns: PRODUCT_COLUMNS, rows: productRows },
    { name: "Card-validity audit", columns: ISSUE_COLUMNS, rows: issueRows },
    { name: "Daily trend", columns: DAILY_COLUMNS, rows: dailyRows },
  ];

  const spec: WorkbookSpec = {
    filename: `medical-report_${range.fromDate}_${range.toDate}`,
    title: "Medical (WAC 314-55-090) report",
    sheets,
  };

  return exportResponse(spec, format);
}
