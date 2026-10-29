/**
 * GET /admin/registers/eod/export?day=YYYY-MM-DD&format=csv|xlsx
 *
 * Fix Phase 2.6b (G-15 requirement 5, F-00-8): the end-of-day deposit sheet
 * as a spreadsheet. The owner: closing day reports "can be exported and
 * printed". Same permission as the page (inventory.manage): the sheet shows
 * expected cash, which the blind close hides from cashiers.
 *
 * A bad day is refused, never replaced with today (F-03-8). When any record
 * could not be read the export is refused (409): a file cannot carry the
 * page's "may be incomplete" warning, so it is not produced at all (F-03-7).
 * The night count stays hidden until the morning recount, in the file as on
 * the page (eod-sheet-core#buildEodSheet).
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificToday } from "@/lib/reports/timezone";
import { exportResponse, parseFormat } from "@/lib/reports/workbook";
import { parseBusinessDay } from "@/lib/registers/deposit-bag-flow-core";
import { eodData } from "@/lib/registers/eod-store";
import { eodSheetWorkbook } from "@/lib/registers/eod-sheet-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bad = (m: string, status = 400) => new Response(m, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(req: Request) {
  await requirePermission("inventory.manage");
  if (!isSupabaseServiceConfigured) return bad("Supabase is not configured.", 503);
  const u = new URL(req.url);
  const day = parseBusinessDay(u.searchParams.get("day"), pacificToday());
  if (!day.ok) return bad(day.error);
  const data = await eodData(day.day);
  if (data.readProblems.length > 0) {
    return bad(`The end-of-day sheet for ${day.day} is not exported because some records could not be read: ${data.readProblems.join(" · ")}`, 409);
  }
  return exportResponse(eodSheetWorkbook(data.sheet, data.model.sales), parseFormat(u.searchParams.get("format")));
}
