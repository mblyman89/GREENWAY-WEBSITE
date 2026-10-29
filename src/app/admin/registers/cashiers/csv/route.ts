/**
 * GET /admin/registers/cashiers/csv?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Fix Phase 2.1b (G-05, F-01-10): the per-cashier shift report as a
 * spreadsheet, one row per cashier per business day. Read only. Managers and
 * up (inventory.manage), like the page. A bad date is refused, never replaced
 * (F-03-8). An incomplete read is refused (409), never shipped as a short
 * file that looks complete (rule 46).
 */
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificToday } from "@/lib/reports/timezone";
import { parseBusinessDay } from "@/lib/registers/deposit-bag-flow-core";
import { cashierCsv, cashierCsvRow } from "@/lib/registers/cashier-report-core";
import { loadCashierReport } from "@/lib/registers/cashier-report-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bad = (m: string, status = 400) => new Response(m, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(req: NextRequest) {
  await requirePermission("inventory.manage");
  if (!isSupabaseServiceConfigured) return bad("Supabase is not configured.", 503);
  const u = new URL(req.url);
  const today = pacificToday();
  const from = parseBusinessDay(u.searchParams.get("from"), today);
  if (!from.ok) return bad(`From: ${from.error}`);
  const to = parseBusinessDay(u.searchParams.get("to"), from.day);
  if (!to.ok) return bad(`To: ${to.error}`);

  const loaded = await loadCashierReport(from.day, to.day);
  if ("error" in loaded) return bad(loaded.error);
  if (loaded.warnings.length > 0) return bad(`The report is incomplete, so no file was made: ${loaded.warnings.join(" ")}`, 409);
  const nameOf = (id: string) => loaded.names[id] ?? id;
  const regs = (ids: string[]) => ids.map((r) => loaded.registers[r] ?? r).join(" / ");
  const rows = loaded.report.cashiers.flatMap((c) => c.shifts.map((s) => cashierCsvRow(s, nameOf(c.employeeId), regs(s.registerIds))));
  return new Response("\uFEFF" + cashierCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cashier-shifts-${from.day}-to-${to.day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
