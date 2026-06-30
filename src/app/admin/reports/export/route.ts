/**
 * GET /admin/reports/export?range=30&format=csv|xlsx
 *
 * The master report export: a styled multi-sheet workbook (or clean multi-section
 * CSV) bundling the headline order/loyalty/inventory/promo metrics, the per-day
 * order & revenue series, and the top products / brands. Staff-gated
 * (reports.view). Money is emitted as real currency cells (xlsx) or two-decimal
 * dollars (csv) via the shared workbook helper.
 */
import { requirePermission } from "@/lib/auth/session";
import {
  getOrdersReport,
  getLoyaltyReport,
  getInventoryHealthReport,
  getPromotionsReport,
} from "@/lib/reports/analytics";
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
  { key: "section", header: "Section", type: "text" },
  { key: "metric", header: "Metric", type: "text" },
  { key: "value", header: "Value", type: "text" },
  { key: "amount", header: "Amount", type: "currency" },
];

const DAILY_COLUMNS: TableColumn[] = [
  { key: "date", header: "Date", type: "text" },
  { key: "orders", header: "Orders", type: "integer" },
  { key: "revenue", header: "Revenue", type: "currency" },
];

const TOP_COLUMNS = (label: string): TableColumn[] => [
  { key: "label", header: label, type: "text" },
  { key: "units", header: "Units", type: "integer" },
];

export async function GET(request: Request) {
  await requirePermission("reports.view");
  const url = new URL(request.url);
  const format = parseFormat(url.searchParams.get("format"));
  const days = [7, 30, 90].includes(Number(url.searchParams.get("range")))
    ? Number(url.searchParams.get("range"))
    : 30;

  const [orders, loyalty, inventory, promos] = await Promise.all([
    getOrdersReport(days),
    getLoyaltyReport(days),
    getInventoryHealthReport(),
    getPromotionsReport(),
  ]);

  // Summary metrics. `value` carries counts/flags; `amount` carries money (cents).
  const summary: TableRow[] = [];
  const m = (section: string, metric: string, value: unknown) =>
    summary.push({ section, metric, value: value == null ? "" : String(value), amount: null });
  const money = (section: string, metric: string, cents: number) =>
    summary.push({ section, metric, value: "", amount: cents });

  m("Orders", "Range (days)", days);
  m("Orders", "Total orders", orders.totalOrders);
  m("Orders", "Completed", orders.completedOrders);
  m("Orders", "Cancelled", orders.cancelledOrders);
  m("Orders", "No-show", orders.noShowOrders);
  money("Orders", "Gross revenue", orders.grossMinorUnits);
  money("Orders", "Avg order value", orders.avgOrderMinorUnits);
  m("Orders", "Avg items / order", orders.avgItemsPerOrder);

  m("Loyalty", "Total", loyalty.total);
  m("Loyalty", "New", loyalty.newCount);
  m("Loyalty", "Entered", loyalty.enteredCount);
  m("Loyalty", "Duplicate", loyalty.duplicateCount);
  m("Loyalty", "Archived", loyalty.archivedCount);
  m("Loyalty", "Dedupe flagged", loyalty.dedupeFlagged);

  m("Inventory", "Has published menu", inventory.hasPublishedMenu);
  m("Inventory", "Total items", inventory.totalItems);
  m("Inventory", "Total variants", inventory.totalVariants);
  m("Inventory", "Out of stock", inventory.outOfStock);
  m("Inventory", "Low stock", inventory.lowStock);
  m("Inventory", "Zero price", inventory.zeroPrice);
  m("Inventory", "Missing description", inventory.missingDescription);
  m("Inventory", "Missing brand", inventory.missingBrand);
  m("Inventory", "Hidden items", inventory.hiddenItems);
  m("Inventory", "Suspicious potency", inventory.suspiciousPotency);

  m("Promotions", "Published", promos.published);
  m("Promotions", "Scheduled", promos.scheduled);
  m("Promotions", "Draft", promos.draft);
  m("Promotions", "Archived", promos.archived);

  const daily: TableRow[] = orders.ordersByDay.map((d, i) => ({
    date: d.date,
    orders: d.value,
    revenue: orders.revenueByDay[i]?.value ?? 0,
  }));

  const topProducts: TableRow[] = orders.topProducts.map((p) => ({ label: p.label, units: p.value }));
  const topBrands: TableRow[] = orders.topBrands.map((b) => ({ label: b.label, units: b.value }));

  const sheets: TableSheet[] = [
    { name: "Summary", caption: `Last ${days} days`, columns: SUMMARY_COLUMNS, rows: summary },
    { name: "Daily series", caption: `Last ${days} days`, columns: DAILY_COLUMNS, rows: daily },
    { name: "Top products", columns: TOP_COLUMNS("Product"), rows: topProducts },
    { name: "Top brands", columns: TOP_COLUMNS("Brand"), rows: topBrands },
  ];

  const stamp = new Date().toISOString().slice(0, 10);
  const spec: WorkbookSpec = {
    filename: `greenway-report-${days}d-${stamp}`,
    title: "Greenway — Report summary",
    sheets,
  };

  return exportResponse(spec, format);
}
