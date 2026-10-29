/**
 * GET /admin/registers/deposit-bags/csv?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Fix Phase 2.6 (G-04 requirement 7): the deposit bag log as a spreadsheet.
 * Read only. Managers and up (inventory.manage), because the file carries the
 * night count, which the morning recounter must not see before recounting
 * (SOP-03 §4.10 step 2). A bad date is refused, never replaced (F-03-8).
 */
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listEmployees } from "@/lib/staffing/store";
import { pacificToday, addPacificDays } from "@/lib/reports/timezone";
import { bagLogCsv, bagLogRow, parseBusinessDay } from "@/lib/registers/deposit-bag-flow-core";
import { listBagsInRange, staffNames } from "@/lib/registers/deposit-bag-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bad = (m: string, status = 400) => new Response(m, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(req: NextRequest) {
  await requirePermission("inventory.manage");
  if (!isSupabaseServiceConfigured) return bad("Supabase is not configured.", 503);
  const u = new URL(req.url);
  const today = pacificToday();
  const from = parseBusinessDay(u.searchParams.get("from"), addPacificDays(today, -30));
  if (!from.ok) return bad(`From: ${from.error}`);
  const to = parseBusinessDay(u.searchParams.get("to"), today);
  if (!to.ok) return bad(`To: ${to.error}`);
  if (from.day > to.day) return bad("The From day is after the To day.");

  const res = await listBagsInRange(from.day, to.day);
  if (!res.ok) return bad(res.missingSchema ? "Apply migration 0316_deposit_bag_custody.sql first." : `The bags could not be read: ${res.error}`, 409);
  const employees = await listEmployees({ includeInactive: true });
  const names = new Map(employees.map((e) => [e.id, e.full_name]));
  const bankers = await staffNames(res.bags.map((b) => b.bankedBy ?? ""));
  if (!bankers.ok) return bad(`Owner names could not be read: ${bankers.error}`, 409);
  const rows = res.bags.map((b) =>
    bagLogRow(
      b,
      (id) => (id ? (names.get(id) ?? id) : ""),
      (id) => (id ? (bankers.names.get(id) ?? id) : ""),
    ),
  );
  return new Response("\uFEFF" + bagLogCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="deposit-bag-log-${from.day}-to-${to.day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
