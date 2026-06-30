/**
 * GET /admin/reports/tax/export?view=month|category&from=&to=
 *
 * CSV export of the WA tax summary for filing. Staff-gated (reports.view).
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { getWaTaxReport } from "@/lib/reports/wa-tax";

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
  const view = (url.searchParams.get("view") ?? "month").toLowerCase();
  const range = resolveRange({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    range: url.searchParams.get("range") ?? undefined,
  });

  const report = await getWaTaxReport(range.fromISO, range.toISO);
  const lines: string[] = [];

  if (view === "category") {
    lines.push(
      ["category", "is_cannabis", "taxable_sales_usd", "sales_tax_usd", "excise_tax_usd", "units"]
        .map(cell)
        .join(","),
    );
    for (const r of report.byCategory) {
      lines.push(
        [r.category, r.isCannabis ? "yes" : "no", dollars(r.baseMinor), dollars(r.salesTaxMinor), dollars(r.exciseTaxMinor), r.units]
          .map(cell)
          .join(","),
      );
    }
    lines.push(
      ["TOTAL", "", dollars(report.totalBaseMinor), dollars(report.salesTaxMinor), dollars(report.exciseTaxMinor), ""]
        .map(cell)
        .join(","),
    );
  } else {
    lines.push(
      [
        "month",
        "cannabis_sales_usd",
        "non_cannabis_sales_usd",
        "state_sales_tax_usd",
        "local_sales_tax_usd",
        "sales_tax_usd",
        "excise_tax_usd",
        "total_tax_usd",
        "orders",
      ]
        .map(cell)
        .join(","),
    );
    for (const r of report.byMonth) {
      lines.push(
        [
          r.label,
          dollars(r.cannabisBaseMinor),
          dollars(r.nonCannabisBaseMinor),
          dollars(r.stateSalesTaxMinor),
          dollars(r.localSalesTaxMinor),
          dollars(r.salesTaxMinor),
          dollars(r.exciseTaxMinor),
          dollars(r.totalTaxMinor),
          r.orders,
        ]
          .map(cell)
          .join(","),
      );
    }
    lines.push(
      [
        "TOTAL",
        dollars(report.cannabisBaseMinor),
        dollars(report.nonCannabisBaseMinor),
        dollars(report.stateSalesTaxMinor),
        dollars(report.localSalesTaxMinor),
        dollars(report.salesTaxMinor),
        dollars(report.exciseTaxMinor),
        dollars(report.totalTaxMinor),
        report.orders,
      ]
        .map(cell)
        .join(","),
    );
  }

  const csv = lines.join("\n");
  const fname = `greenway_wa_tax_${view}_${range.fromISO.slice(0, 10)}_${range.toISO.slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
