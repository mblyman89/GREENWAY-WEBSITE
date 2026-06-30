/**
 * GET /admin/reports/sales/export?group=category|type|vendor|brand|product&from=&to=
 *
 * CSV export of a single sales breakdown. Staff-gated (reports.view). Money is
 * emitted in DOLLARS (two decimals) for spreadsheet friendliness; raw cents are
 * also included so nothing is lost.
 *
 * group=type emits the detailed product types WITH their parent category, so the
 * spreadsheet shows e.g. Concentrate → Rosin, Concentrate → BHO, Edible → Gummies.
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { getSalesReport, type SalesGroupRow } from "@/lib/reports/sales";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export async function GET(request: Request) {
  await requirePermission("reports.view");
  const url = new URL(request.url);
  const group = (url.searchParams.get("group") ?? "category").toLowerCase();
  const range = resolveRange({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    range: url.searchParams.get("range") ?? undefined,
    year: url.searchParams.get("year") ?? undefined,
  });

  const report = await getSalesReport(range.fromISO, range.toISO);

  // Special case: type export carries a parent-category column.
  if (group === "type") {
    const lines: string[] = [];
    lines.push(
      ["category", "type", "revenue_usd", "revenue_cents", "units", "orders", "discount_usd", "revenue_share_pct"]
        .map(cell)
        .join(","),
    );
    for (const cat of report.byTypeWithinCategory) {
      for (const t of cat.types) {
        lines.push(
          [
            cat.category,
            t.label,
            dollars(t.revenueMinorUnits),
            t.revenueMinorUnits,
            t.units,
            t.orders,
            dollars(t.discountMinorUnits),
            (t.revenueShare * 100).toFixed(2),
          ]
            .map(cell)
            .join(","),
        );
      }
    }
    lines.push(
      [
        "TOTAL",
        "",
        dollars(report.totalRevenueMinorUnits),
        report.totalRevenueMinorUnits,
        report.totalUnits,
        report.totalOrders,
        dollars(report.totalDiscountMinorUnits),
        "100.00",
      ]
        .map(cell)
        .join(","),
    );
    const csv = lines.join("\n");
    const fname = `greenway_sales_by_type_${range.fromISO.slice(0, 10)}_${range.toISO.slice(0, 10)}.csv`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fname}"`,
      },
    });
  }

  let rows: SalesGroupRow[];
  let labelHeader: string;
  switch (group) {
    case "vendor":
      rows = report.byVendor;
      labelHeader = "vendor";
      break;
    case "brand":
      rows = report.byBrand;
      labelHeader = "brand";
      break;
    case "product":
      rows = report.byProduct;
      labelHeader = "product";
      break;
    case "category":
    default:
      rows = report.byCategory;
      labelHeader = "category";
      break;
  }

  const lines: string[] = [];
  lines.push(
    [labelHeader, "revenue_usd", "revenue_cents", "units", "orders", "discount_usd", "revenue_share_pct"]
      .map(cell)
      .join(","),
  );
  for (const r of rows) {
    lines.push(
      [
        r.label,
        dollars(r.revenueMinorUnits),
        r.revenueMinorUnits,
        r.units,
        r.orders,
        dollars(r.discountMinorUnits),
        (r.revenueShare * 100).toFixed(2),
      ]
        .map(cell)
        .join(","),
    );
  }
  // Totals row.
  lines.push(
    [
      "TOTAL",
      dollars(report.totalRevenueMinorUnits),
      report.totalRevenueMinorUnits,
      report.totalUnits,
      report.totalOrders,
      dollars(report.totalDiscountMinorUnits),
      "100.00",
    ]
      .map(cell)
      .join(","),
  );

  const csv = lines.join("\n");
  const fname = `greenway_sales_by_${labelHeader}_${range.fromISO.slice(0, 10)}_${range.toISO.slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
