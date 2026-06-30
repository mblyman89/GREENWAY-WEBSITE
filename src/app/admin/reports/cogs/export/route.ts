/**
 * GET /admin/reports/cogs/export?group=category|vendor|brand&format=csv|xlsx&from=&to=
 *
 * Export a COGS / margin breakdown as a clean CSV or styled .xlsx. Staff-gated
 * (reports.view). Money is emitted as real currency cells (xlsx) or two-decimal
 * dollars (csv) via the shared workbook helper.
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { getCogsReport, type CogsGroupRow } from "@/lib/reports/cogs";
import {
  exportResponse,
  parseFormat,
  type TableColumn,
  type TableRow,
  type WorkbookSpec,
} from "@/lib/reports/workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COLUMNS = (labelHeader: string): TableColumn[] => [
  { key: "label", header: labelHeader, type: "text" },
  { key: "revenue", header: "Revenue", type: "currency" },
  { key: "cogs", header: "COGS", type: "currency" },
  { key: "grossProfit", header: "Gross profit", type: "currency" },
  { key: "margin", header: "Margin", type: "percent" },
  { key: "units", header: "Units", type: "integer" },
];

function row(r: CogsGroupRow): TableRow {
  return {
    label: r.label,
    revenue: r.revenueMinorUnits,
    cogs: r.cogsMinorUnits,
    grossProfit: r.grossProfitMinorUnits,
    margin: r.margin,
    units: r.units,
  };
}

export async function GET(request: Request) {
  await requirePermission("reports.view");
  const url = new URL(request.url);
  const group = (url.searchParams.get("group") ?? "category").toLowerCase();
  const format = parseFormat(url.searchParams.get("format"));
  const range = resolveRange({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    range: url.searchParams.get("range") ?? undefined,
    year: url.searchParams.get("year") ?? undefined,
  });

  const report = await getCogsReport(range.fromISO, range.toISO);

  let rows: CogsGroupRow[];
  let labelHeader: string;
  switch (group) {
    case "type":
      rows = report.byType;
      labelHeader = "Type";
      break;
    case "vendor":
      rows = report.byVendor;
      labelHeader = "Vendor";
      break;
    case "brand":
      rows = report.byBrand;
      labelHeader = "Brand";
      break;
    case "category":
    default:
      rows = report.byCategory;
      labelHeader = "Category";
      break;
  }

  const totals: TableRow = {
    label: "TOTAL",
    revenue: report.totalRevenueMinorUnits,
    cogs: report.totalCogsMinorUnits,
    grossProfit: report.totalGrossProfitMinorUnits,
    margin: report.overallMargin,
    units: report.unitsSold,
  };

  const stamp = `${range.fromISO.slice(0, 10)}_${range.toISO.slice(0, 10)}`;
  const spec: WorkbookSpec = {
    filename: `greenway_cogs_by_${labelHeader.toLowerCase()}_${stamp}`,
    title: `Greenway — COGS by ${labelHeader.toLowerCase()}`,
    sheets: [
      {
        name: `COGS by ${labelHeader.toLowerCase()}`,
        caption: range.label,
        columns: COLUMNS(labelHeader),
        rows: rows.map(row),
        totals,
      },
    ],
  };
  return exportResponse(spec, format);
}
