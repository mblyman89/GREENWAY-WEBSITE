/**
 * GET /admin/registers/safe/export?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|xlsx
 *
 * Fix Phase 2.7a (G-09 requirement 2, F-00-8, F-02-13): the master till
 * sheet as a spreadsheet, for any range of business days (up to 366). The
 * owner: "I want to make sure the master till spreadsheet is built … This
 * should be exportable and printable."
 *
 * Same permission as the history (inventory.manage). A bad date or range is
 * refused (400), never replaced. When any record could not be read the
 * export is refused (409): a file cannot carry the page's "may be
 * incomplete" warning, so it is not produced at all (same rule as the EOD
 * export).
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificToday } from "@/lib/reports/timezone";
import { exportResponse, parseFormat } from "@/lib/reports/workbook";
import { listSafeCountsRange, listSwapsRange } from "@/lib/registers/safe-store";
import { listEmployees } from "@/lib/staffing/store";
import {
  parseDayRange,
  safeSheetWorkbook,
  sheetCountFromRow,
  sheetSwapFromRow,
  sortForSheet,
} from "@/lib/registers/master-till-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bad = (m: string, status = 400) => new Response(m, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(req: Request) {
  await requirePermission("inventory.manage");
  if (!isSupabaseServiceConfigured) return bad("Supabase is not configured.", 503);
  const u = new URL(req.url);
  const range = parseDayRange(u.searchParams.get("from"), u.searchParams.get("to"), pacificToday());
  if (!range.ok) return bad(range.error);
  const [countsRes, swapsRes, employees] = await Promise.all([
    listSafeCountsRange(range.from, range.to),
    listSwapsRange(range.from, range.to),
    listEmployees({ includeInactive: true }),
  ]);
  if (!countsRes.ready || !swapsRes.ready) {
    return bad("The safe tables aren't set up yet — run migration 0135_safe_counts_swaps.sql. Nothing was exported.", 409);
  }
  const problems = [countsRes.error, swapsRes.error].filter((x): x is string => x != null);
  if (problems.length > 0) {
    return bad(`The master till sheet for ${range.from} to ${range.to} is not exported because some records could not be read: ${problems.join(" · ")}`, 409);
  }
  const empName = new Map(employees.map((e) => [e.id, e.full_name]));
  const nameFor = (id: string | null): string => (id ? (empName.get(id) ?? "\u2014") : "\u2014");
  // Oldest day first; within a day AM, PM, then extras (the paper sheet's order).
  const byDay = new Map<string, ReturnType<typeof sheetCountFromRow>[]>();
  for (const r of countsRes.counts) {
    const c = sheetCountFromRow(r, nameFor);
    byDay.set(c.businessDay, [...(byDay.get(c.businessDay) ?? []), c]);
  }
  const counts = [...byDay.keys()].sort().flatMap((d) => sortForSheet(byDay.get(d) ?? []));
  const swaps = [...swapsRes.swaps].reverse().map((r) => sheetSwapFromRow(r, nameFor));
  return exportResponse(safeSheetWorkbook(range, counts, swaps), parseFormat(u.searchParams.get("format")));
}
