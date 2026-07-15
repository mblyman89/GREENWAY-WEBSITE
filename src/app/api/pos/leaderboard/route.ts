/**
 * GET /api/pos/leaderboard  (POS Slice B34)
 *
 * Budtender leaderboard for the register — the SparkPlug/Flowhub motivation
 * loop computed from our own ledger. Aggregates PROCESSED sales from
 * `pos_sale_events` across ALL registers (the whole store competes) for the
 * trailing 7 Pacific days, joins employee names, and returns both boards
 * ranked:
 *
 *   today — by SALES COUNT, no dollar figures. Same-day per-employee gross
 *           could reconstruct a register's expected drawer cash and defeat
 *           the blind-count discipline (B21/B22), so money stays OFF the
 *           same-day board by design.
 *   week  — by GROSS dollars across the trailing 7 days (spans closed and
 *           reconciled sessions, so it can't precompute today's drawer).
 *
 * Auth: the standard X-POS-Device-Id / X-POS-Device-Key headers. No PIN —
 * the board is a celebration screen, and it reveals nothing the blind
 * count protects.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { pacificToday, pacificDayKey, addPacificDays, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import {
  aggregateLeaderboard,
  rankLeaderboard,
  type LeaderboardEventRow,
} from "@/lib/pos/leaderboard-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";
  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!isSupabaseServiceConfigured) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }

  const admin = createSupabaseAdminClient();
  const today = pacificToday();
  const weekStartDay = addPacificDays(today, -6);
  const windowStart = pacificWallTimeToUtcISO(weekStartDay, "start");
  const windowEnd = pacificWallTimeToUtcISO(today, "end");

  const { data: eventRows, error } = await admin
    .from("pos_sale_events")
    .select("employee_id, event_type, status, payload, occurred_at")
    .eq("event_type", "sale")
    .gte("occurred_at", windowStart)
    .lte("occurred_at", windowEnd);
  if (error) {
    return NextResponse.json({ error: `Could not read the week's sales: ${error.message}` }, { status: 503 });
  }

  const rows: LeaderboardEventRow[] = (
    (eventRows as {
      employee_id: string | null;
      event_type: string;
      status: string;
      payload: unknown;
      occurred_at: string;
    }[] | null) ?? []
  ).map((r) => ({
    employeeId: r.employee_id ?? "",
    eventType: r.event_type,
    status: r.status,
    payload: r.payload,
    dayKey: pacificDayKey(r.occurred_at),
  }));

  const boards = aggregateLeaderboard(rows, today);

  // Resolve names for everyone on either board.
  const ids = [...new Set([...boards.today, ...boards.week].map((e) => e.employeeId))];
  const names: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: employees } = await admin.from("employees").select("id, full_name").in("id", ids);
    for (const e of (employees as { id: string; full_name: string }[] | null) ?? []) {
      names[e.id] = e.full_name;
    }
  }

  return NextResponse.json({
    ok: true,
    businessDay: today,
    weekStartDay,
    today: rankLeaderboard(boards.today, "today", names).map((e) => ({
      rank: e.rank,
      name: e.name,
      saleCount: e.saleCount,
      itemCount: e.itemCount,
      // No grossMinor on the same-day board — blind-count discipline.
    })),
    week: rankLeaderboard(boards.week, "week", names).map((e) => ({
      rank: e.rank,
      name: e.name,
      saleCount: e.saleCount,
      itemCount: e.itemCount,
      grossMinor: e.grossMinor,
    })),
  });
}
