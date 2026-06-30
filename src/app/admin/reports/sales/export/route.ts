/**
 * GET /admin/reports/sales/export?group=category|type|vendor|brand|product&format=csv|xlsx&from=&to=
 *
 * Export a single sales breakdown as a clean CSV or styled .xlsx. Staff-gated
 * (reports.view). Money is emitted as real currency cells (xlsx) or two-decimal
 * dollars (csv) via the shared workbook helper.
 *
 * group=type emits the detailed product types WITH their parent category, so the
 * spreadsheet shows e.g. Concentrate → Rosin, Concentrate → BHO, Edible → Gummies.
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { getSalesReport, type SalesGroupRow } from "@/lib/reports/sales";
import {
  exportResponse,
  parseFormat,
  type TableColumn,
  type TableRow,
  type WorkbookSpec,
} from "@/lib/reports/workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GROUP_COLUMNS = (labelHeader: string): TableColumn[] => [
  { key: "label", header: labelHeader, type: "text" },
  { key: "revenue", header: "Revenue", type: "currency" },
  { key: "units", header: "Units", type: "integer" },
  { key: "orders", header: "Orders", type: "integer" },
  { key: "discount", header: "Discount", type: "currency" },
  { key: "share", header: "Revenue share", type: "percent" },
];

function groupRow(r: SalesGroupRow): TableRow {
  return {
    label: r.label,
    revenue: r.revenueMinorUnits,
    units: r.units,
    orders: r.orders,
    discount: r.discountMinorUnits,
    share: r.revenueShare,
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

  const report = await getSalesReport(range.fromISO, range.toISO);
  const stamp = `${range.fromISO.slice(0, 10)}_${range.toISO.slice(0, 10)}`;

  const totals: TableRow = {
    label: "TOTAL",
    revenue: report.totalRevenueMinorUnits,
    units: report.totalUnits,
    orders: report.totalOrders,
    discount: report.totalDiscountMinorUnits,
    share: 1,
  };

  // Special case: type export carries a parent-category column.
  if (group === "type") {
    const columns: TableColumn[] = [
      { key: "category", header: "Category", type: "text" },
      ...GROUP_COLUMNS("Type"),
    ];
    const rows: TableRow[] = [];
    for (const cat of report.byTypeWithinCategory) {
      for (const t of cat.types) {
        rows.push({ category: cat.category, ...groupRow(t) });
      }
    }
    const spec: WorkbookSpec = {
      filename: `greenway_sales_by_type_${stamp}`,
      title: "Greenway — Sales by type",
      sheets: [
        {
          name: "Sales by type",
          caption: range.label,
          columns,
          rows,
          totals: { category: "", ...totals },
        },
      ],
    };
    return exportResponse(spec, format);
  }

  let rows: SalesGroupRow[];
  let labelHeader: string;
  switch (group) {
    case "vendor":
      rows = report.byVendor;
      labelHeader = "Vendor";
      break;
    case "brand":
      rows = report.byBrand;
      labelHeader = "Brand";
      break;
    case "product":
      rows = report.byProduct;
      labelHeader = "Product";
      break;
    case "category":
    default:
      rows = report.byCategory;
      labelHeader = "Category";
      break;
  }

  const spec: WorkbookSpec = {
    filename: `greenway_sales_by_${labelHeader.toLowerCase()}_${stamp}`,
    title: `Greenway — Sales by ${labelHeader.toLowerCase()}`,
    sheets: [
      {
        name: `Sales by ${labelHeader.toLowerCase()}`,
        caption: range.label,
        columns: GROUP_COLUMNS(labelHeader),
        rows: rows.map(groupRow),
        totals,
      },
    ],
  };
  return exportResponse(spec, format);
}
