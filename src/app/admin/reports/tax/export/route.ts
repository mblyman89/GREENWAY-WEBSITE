/**
 * GET /admin/reports/tax/export?view=month|category&format=csv|xlsx&from=&to=
 *
 * Export the WA tax summary for filing as a clean CSV or styled .xlsx. Staff-gated
 * (reports.view). Money is emitted as real currency cells (xlsx) or two-decimal
 * dollars (csv) via the shared workbook helper.
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { getWaTaxReport } from "@/lib/reports/wa-tax";
import {
  exportResponse,
  parseFormat,
  type TableColumn,
  type TableRow,
  type WorkbookSpec,
} from "@/lib/reports/workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CATEGORY_COLUMNS: TableColumn[] = [
  { key: "category", header: "Category", type: "text" },
  { key: "isCannabis", header: "Cannabis", type: "text" },
  { key: "base", header: "Taxable sales", type: "currency" },
  { key: "salesTax", header: "Sales tax", type: "currency" },
  { key: "exciseTax", header: "Excise tax", type: "currency" },
  { key: "units", header: "Units", type: "integer" },
];

const MONTH_COLUMNS: TableColumn[] = [
  { key: "month", header: "Month", type: "text" },
  { key: "cannabis", header: "Cannabis sales", type: "currency" },
  { key: "nonCannabis", header: "Non-cannabis sales", type: "currency" },
  { key: "stateSalesTax", header: "State sales tax", type: "currency" },
  { key: "localSalesTax", header: "Local sales tax", type: "currency" },
  { key: "salesTax", header: "Sales tax", type: "currency" },
  { key: "exciseTax", header: "Excise tax", type: "currency" },
  { key: "totalTax", header: "Total tax", type: "currency" },
  { key: "orders", header: "Orders", type: "integer" },
];

export async function GET(request: Request) {
  await requirePermission("reports.view");
  const url = new URL(request.url);
  const view = (url.searchParams.get("view") ?? "month").toLowerCase();
  const format = parseFormat(url.searchParams.get("format"));
  const range = resolveRange({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    range: url.searchParams.get("range") ?? undefined,
    year: url.searchParams.get("year") ?? undefined,
  });

  const report = await getWaTaxReport(range.fromISO, range.toISO);
  const stamp = `${range.fromISO.slice(0, 10)}_${range.toISO.slice(0, 10)}`;

  let spec: WorkbookSpec;
  if (view === "category") {
    const rows: TableRow[] = report.byCategory.map((r) => ({
      category: r.category,
      isCannabis: r.isCannabis ? "Yes" : "No",
      base: r.baseMinor,
      salesTax: r.salesTaxMinor,
      exciseTax: r.exciseTaxMinor,
      units: r.units,
    }));
    const totals: TableRow = {
      category: "TOTAL",
      isCannabis: "",
      base: report.totalBaseMinor,
      salesTax: report.salesTaxMinor,
      exciseTax: report.exciseTaxMinor,
      units: null,
    };
    spec = {
      filename: `greenway_wa_tax_by_category_${stamp}`,
      title: "Greenway — WA tax by category",
      sheets: [{ name: "WA tax by category", caption: range.label, columns: CATEGORY_COLUMNS, rows, totals }],
    };
  } else {
    const rows: TableRow[] = report.byMonth.map((r) => ({
      month: r.label,
      cannabis: r.cannabisBaseMinor,
      nonCannabis: r.nonCannabisBaseMinor,
      stateSalesTax: r.stateSalesTaxMinor,
      localSalesTax: r.localSalesTaxMinor,
      salesTax: r.salesTaxMinor,
      exciseTax: r.exciseTaxMinor,
      totalTax: r.totalTaxMinor,
      orders: r.orders,
    }));
    const totals: TableRow = {
      month: "TOTAL",
      cannabis: report.cannabisBaseMinor,
      nonCannabis: report.nonCannabisBaseMinor,
      stateSalesTax: report.stateSalesTaxMinor,
      localSalesTax: report.localSalesTaxMinor,
      salesTax: report.salesTaxMinor,
      exciseTax: report.exciseTaxMinor,
      totalTax: report.totalTaxMinor,
      orders: report.orders,
    };
    spec = {
      filename: `greenway_wa_tax_by_month_${stamp}`,
      title: "Greenway — WA tax by month",
      sheets: [{ name: "WA tax by month", caption: range.label, columns: MONTH_COLUMNS, rows, totals }],
    };
  }

  return exportResponse(spec, format);
}
