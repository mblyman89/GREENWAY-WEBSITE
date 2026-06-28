/**
 * GET /admin/reports/export?range=30 — CSV summary of the current report window.
 * Staff-gated (reports.view). Bundles the headline order/loyalty/inventory/promo
 * metrics plus the per-day order & revenue series into one CSV.
 */
import { requirePermission } from "@/lib/auth/session";
import {
  getOrdersReport,
  getLoyaltyReport,
  getInventoryHealthReport,
  getPromotionsReport,
} from "@/lib/reports/analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  await requirePermission("reports.view");
  const url = new URL(request.url);
  const days = [7, 30, 90].includes(Number(url.searchParams.get("range")))
    ? Number(url.searchParams.get("range"))
    : 30;

  const [orders, loyalty, inventory, promos] = await Promise.all([
    getOrdersReport(days),
    getLoyaltyReport(days),
    getInventoryHealthReport(),
    getPromotionsReport(),
  ]);

  const lines: string[] = [];
  lines.push(["section", "metric", "value"].join(","));

  const push = (section: string, metric: string, value: unknown) =>
    lines.push([section, metric, value].map(cell).join(","));

  push("orders", "range_days", days);
  push("orders", "total_orders", orders.totalOrders);
  push("orders", "completed", orders.completedOrders);
  push("orders", "cancelled", orders.cancelledOrders);
  push("orders", "no_show", orders.noShowOrders);
  push("orders", "gross_minor_units", orders.grossMinorUnits);
  push("orders", "avg_order_minor_units", orders.avgOrderMinorUnits);
  push("orders", "avg_items_per_order", orders.avgItemsPerOrder);

  push("loyalty", "total", loyalty.total);
  push("loyalty", "new", loyalty.newCount);
  push("loyalty", "entered", loyalty.enteredCount);
  push("loyalty", "duplicate", loyalty.duplicateCount);
  push("loyalty", "archived", loyalty.archivedCount);
  push("loyalty", "dedupe_flagged", loyalty.dedupeFlagged);

  push("inventory", "has_published_menu", inventory.hasPublishedMenu);
  push("inventory", "total_items", inventory.totalItems);
  push("inventory", "total_variants", inventory.totalVariants);
  push("inventory", "out_of_stock", inventory.outOfStock);
  push("inventory", "low_stock", inventory.lowStock);
  push("inventory", "zero_price", inventory.zeroPrice);
  push("inventory", "missing_description", inventory.missingDescription);
  push("inventory", "missing_brand", inventory.missingBrand);
  push("inventory", "hidden_items", inventory.hiddenItems);
  push("inventory", "suspicious_potency", inventory.suspiciousPotency);

  push("promotions", "published", promos.published);
  push("promotions", "scheduled", promos.scheduled);
  push("promotions", "draft", promos.draft);
  push("promotions", "archived", promos.archived);

  // Per-day series.
  lines.push("");
  lines.push(["date", "orders", "revenue_minor_units"].join(","));
  for (let i = 0; i < orders.ordersByDay.length; i += 1) {
    lines.push(
      [
        orders.ordersByDay[i].date,
        orders.ordersByDay[i].value,
        orders.revenueByDay[i]?.value ?? 0,
      ]
        .map(cell)
        .join(","),
    );
  }

  // Top products / brands.
  lines.push("");
  lines.push(["top_product", "units"].join(","));
  for (const p of orders.topProducts) lines.push([p.label, p.value].map(cell).join(","));
  lines.push("");
  lines.push(["top_brand", "units"].join(","));
  for (const b of orders.topBrands) lines.push([b.label, b.value].map(cell).join(","));

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="greenway-report-${days}d-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
