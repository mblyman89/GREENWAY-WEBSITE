/**
 * GET /admin/staffing/tips/csv?from=YYYY-MM-DD&to=YYYY-MM-DD[&employee=<id>]
 *
 * Fix Phase 2.1c: the tip tracker's sessions as a spreadsheet. Managers and
 * up get every session (or one employee's); anyone else signed in gets only
 * the sessions they closed. A bad date is refused (F-03-8); an incomplete
 * read is refused (409), never shipped as a short file (rule 46).
 */
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificToday, addPacificDays } from "@/lib/reports/timezone";
import { parseBusinessDay } from "@/lib/registers/deposit-bag-flow-core";
import { tipCsv } from "@/lib/staffing/tips-core";
import { employeeIdForStaff, loadTipReport } from "@/lib/staffing/tips-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bad = (m: string, status = 400) => new Response(m, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(req: NextRequest) {
  const session = await requirePermission("timeclock.use");
  if (!isSupabaseServiceConfigured) return bad("Supabase is not configured.", 503);
  const manager = can(session.profile.role, "staffing.manage");
  let ownId: string | null = null;
  if (!manager) {
    ownId = await employeeIdForStaff(session.userId);
    if (!ownId) return bad("Your sign-in is not linked to an employee record.", 403);
  }
  const u = new URL(req.url);
  const today = pacificToday();
  const from = parseBusinessDay(u.searchParams.get("from"), addPacificDays(today, -29));
  if (!from.ok) return bad(`From: ${from.error}`);
  const to = parseBusinessDay(u.searchParams.get("to"), today);
  if (!to.ok) return bad(`To: ${to.error}`);
  const loaded = await loadTipReport(from.day, to.day, ownId);
  if ("error" in loaded) return bad(loaded.error);
  if (loaded.warnings.some((w) => w.startsWith("Drawer sessions"))) return bad(`The report is incomplete, so no file was made: ${loaded.warnings.join(" ")}`, 409);
  const focus = manager ? u.searchParams.get("employee") : null;
  const rows = loaded.report.sessions.filter((s) => !focus || s.closedBy === focus);
  const csv = tipCsv(
    rows,
    (id) => (id ? (loaded.names[id] ?? id) : ""),
    (id) => loaded.registers[id] ?? id,
  );
  return new Response("\uFEFF" + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tips-${from.day}-to-${to.day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
