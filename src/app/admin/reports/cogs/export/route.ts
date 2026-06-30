/**
 * GET /admin/reports/cogs/export?group=category|vendor|brand&from=&to=
 *
 * CSV export of a COGS/margin breakdown. Staff-gated (reports.view).
 */
import { requirePermission } from "@/lib/auth/session";
import { resolveRange } from "@/lib/reports/range";
import { getCogsReport, type CogsGroupRow } from "@/lib/reports/cogs";

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
  });

  const report = await getCogsReport(range.fromISO, range.toISO);

  let rows: CogsGroupRow[];
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
    case "category":
    default:
      rows = report.byCategory;
      labelHeader = "category";
      break;
  }

  const lines: string[] = [];
  lines.push(
    [labelHeader, "revenue_usd", "cogs_usd", "gross_profit_usd", "margin_pct", "units", "gross_profit_cents"]
      .map(cell)
      .join(","),
  );
  for (const r of rows) {
    lines.push(
      [
        r.label,
        dollars(r.revenueMinorUnits),
        dollars(r.cogsMinorUnits),
        dollars(r.grossProfitMinorUnits),
        (r.margin * 100).toFixed(2),
        r.units,
        r.grossProfitMinorUnits,
      ]
        .map(cell)
        .join(","),
    );
  }
  lines.push(
    [
      "TOTAL",
      dollars(report.totalRevenueMinorUnits),
      dollars(report.totalCogsMinorUnits),
      dollars(report.totalGrossProfitMinorUnits),
      (report.overallMargin * 100).toFixed(2),
      report.unitsSold,
      report.totalGrossProfitMinorUnits,
    ]
      .map(cell)
      .join(","),
  );

  const csv = lines.join("\n");
  const fname = `greenway_cogs_by_${labelHeader}_${range.fromISO.slice(0, 10)}_${range.toISO.slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
