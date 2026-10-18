/**
 * GET /admin/reports/merch/export?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|xlsx
 *
 * R73 S8 - Reports > Merch download: summary, daily sales, WA sales tax by
 * month and by delivery location, top items. Staff-gated (reports.view).
 * Reuses the shared workbook helper; customer-typed text goes through
 * sheetText so it can't start a spreadsheet formula.
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { exportResponse, parseFormat, type TableRow, type WorkbookSpec } from "@/lib/reports/workbook";
import { merchSalesReport, sheetText } from "@/lib/merch/merch-reports-core";
import { loadMerchSales } from "@/lib/merch/merch-reports-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  const board = await loadMerchSales();
  const r = merchSalesReport(board.orders, range);
  const t = r.totals;

  const summary: TableRow[] = [
    { metric: "Range", value: `${range.fromDate} to ${range.toDate}`, amount: null },
    { metric: "Orders", value: t.orders, amount: null },
    { metric: "Items sold", value: t.units, amount: null },
    { metric: "Items (subtotal)", value: "", amount: t.subtotalCents },
    { metric: "Discounts", value: "", amount: t.discountCents },
    { metric: "Shipping charged", value: "", amount: t.shippingCents },
    { metric: "Sales tax collected", value: "", amount: t.taxCents },
    { metric: "Customers paid", value: "", amount: t.totalCents },
    { metric: "Printful charged (priced orders)", value: "", amount: t.printfulCostCents },
    { metric: "Margin after Printful (priced orders)", value: "", amount: t.marginCents },
    { metric: "Orders not priced by Printful yet", value: t.costUnknown, amount: null },
    { metric: "Orders with no tax amount", value: t.taxUnknown, amount: null },
    { metric: "Cancelled / failed (not counted)", value: r.cancelled, amount: null },
    { metric: "Delivered outside WA", value: r.outOfState, amount: null },
    { metric: "Printful read problem", value: board.problem || "none", amount: null },
  ].map((x) => ({ ...x, value: typeof x.value === "string" ? x.value : String(x.value) }));

  const spec: WorkbookSpec = {
    filename: `greenway-merch-${range.fromDate}-to-${range.toDate}`,
    title: "Greenway Merchandising LLC - Merch report",
    sheets: [
      {
        name: "Summary",
        caption: `${range.fromDate} to ${range.toDate}`,
        columns: [
          { key: "metric", header: "Metric" },
          { key: "value", header: "Value" },
          { key: "amount", header: "Amount", type: "currency" },
        ],
        rows: summary,
      },
      {
        name: "WA sales tax by month",
        columns: [
          { key: "month", header: "Month" },
          { key: "orders", header: "Orders", type: "integer" },
          { key: "grossCents", header: "Sales before tax", type: "currency" },
          { key: "taxCents", header: "Sales tax collected", type: "currency" },
          { key: "totalCents", header: "Customer paid", type: "currency" },
        ],
        rows: r.taxByMonth.map((m) => ({ ...m })),
        totals: { month: "Total", orders: t.orders, grossCents: t.totalCents - t.taxCents, taxCents: t.taxCents, totalCents: t.totalCents },
      },
      {
        name: "Tax by delivery location",
        columns: [
          { key: "place", header: "City" },
          { key: "zip", header: "ZIP" },
          { key: "state", header: "State" },
          { key: "orders", header: "Orders", type: "integer" },
          { key: "grossCents", header: "Sales before tax", type: "currency" },
          { key: "taxCents", header: "Sales tax collected", type: "currency" },
        ],
        rows: r.taxByPlace.map((p) => ({ ...p, place: sheetText(p.place), zip: sheetText(p.zip), state: sheetText(p.state) })),
      },
      {
        name: "Daily sales",
        columns: [
          { key: "date", header: "Date" },
          { key: "orders", header: "Orders", type: "integer" },
          { key: "revenue", header: "Customers paid", type: "currency" },
        ],
        rows: r.byDay.map((d, i) => ({ date: d.date, orders: r.ordersByDay[i]?.value ?? 0, revenue: d.value })),
      },
      {
        name: "Top items",
        columns: [
          { key: "label", header: "Item" },
          { key: "units", header: "Units", type: "integer" },
          { key: "revenueCents", header: "Revenue", type: "currency" },
        ],
        rows: r.topProducts.map((p) => ({ ...p, label: sheetText(p.label) })),
      },
    ],
  };
  return exportResponse(spec, format);
}
