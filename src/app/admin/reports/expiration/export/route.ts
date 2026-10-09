/**
 * GET /admin/reports/expiration/export?sheet=all|watchlist|buckets|forecast|sources|categories|gaps|rules&format=csv|xlsx
 *
 * R34 - export the Expiration report. Staff-gated (reports.view). Numbers come
 * from buildExpiryReport over loadExpiryLots - exactly what the page shows.
 * Fail-closed: if every lot can't be read, it returns 503 with the reason
 * rather than a partial spreadsheet.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { exportResponse, parseFormat } from "@/lib/reports/workbook";
import { pacificToday } from "@/lib/reports/timezone";
import { buildExpiryReport } from "@/lib/inventory/expiry-rules-core";
import { listExpiryRules, loadExpiryLots } from "@/lib/inventory/expiry-rules-store";
import { expiryReportWorkbook, parseExpirySheet } from "@/lib/inventory/expiry-report-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  await requirePermission("reports.view");
  const url = new URL(request.url);
  const format = parseFormat(url.searchParams.get("format"));
  const sheet = parseExpirySheet(url.searchParams.get("sheet"));
  if (!isSupabaseServiceConfigured) {
    return new Response("Supabase is not configured, so expiration data is unavailable.", { status: 503 });
  }
  const [lotsRead, rulesRead] = await Promise.all([loadExpiryLots(), listExpiryRules()]);
  if (!lotsRead.ok) {
    return new Response(`Expiration export unavailable: ${lotsRead.error}`, { status: 503 });
  }
  const report = buildExpiryReport(lotsRead.lots, rulesRead.ok ? rulesRead.rules : [], pacificToday());
  return exportResponse(expiryReportWorkbook(report, sheet), format);
}
