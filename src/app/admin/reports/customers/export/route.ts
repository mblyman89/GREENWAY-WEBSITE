/**
 * GET /admin/reports/customers/export?from=&to=
 *
 * CSV export of the top-customers list. Staff-gated (reports.view). Money is
 * emitted in DOLLARS for spreadsheet friendliness, with raw cents alongside.
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { getCustomersReport } from "@/lib/reports/customers";

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
  const range = resolveRange({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    range: url.searchParams.get("range") ?? undefined,
  });

  const report = await getCustomersReport(range.fromISO, range.toISO);

  const lines: string[] = [];
  lines.push(
    [
      "customer",
      "email",
      "segment",
      "orders",
      "units_bought",
      "spend_usd",
      "spend_cents",
      "avg_order_usd",
      "first_order_date",
      "last_order_date",
    ]
      .map(cell)
      .join(","),
  );
  for (const r of report.topCustomers) {
    lines.push(
      [
        r.label,
        r.email,
        r.segment,
        r.orders,
        r.unitsBought,
        dollars(r.revenueMinorUnits),
        r.revenueMinorUnits,
        dollars(r.avgOrderMinorUnits),
        r.firstOrderDate,
        r.lastOrderDate,
      ]
        .map(cell)
        .join(","),
    );
  }

  const csv = lines.join("\n");
  const fname = `greenway_top_customers_${range.fromISO.slice(0, 10)}_${range.toISO.slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
