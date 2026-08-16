/**
 * POST /api/pos/day-report  (POS Slice B22)
 *
 * X/Z day report for THIS register, requested from the iPad and printed on
 * the Star. The server aggregates verified facts only:
 *
 *   - pos_sale_events for this register within the Pacific business day
 *     (processed sales carry the totals the compliance gate accepted at
 *     sync; exceptions and pendings are counted, never summed as money)
 *   - drawer_sessions + drawer_drops for the same business day
 *
 * MANAGER-GATED (manager/lead PIN, same role gate as /api/pos/approve):
 * gross cash sales + opening float − drops IS the expected drawer cash —
 * exactly the number the blind close hides from the cashier. Handing this
 * slip to whoever closes the drawer would defeat the blind count, so a
 * manager or lead must put their PIN on the request. Over/short prints
 * only from manager-reconciled sessions; it is never computed here.
 *
 * X = a drawer session is still open (mid-day snapshot).
 * Z = the day's sessions are all closed (end of day).
 *
 * The response is DATA — the register builds the 576px slip client-side
 * (same pattern as receipts / no-sale slips) and prints with the drawer
 * kick OFF: a report never pops the drawer.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { getEmployeeByPin } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import { pinPadBlocked, notePinFailure, notePinSuccess, deviceThrottleScope } from "@/lib/security/pin-throttle-store";
import { pacificToday, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import {
  summarizeDayEvents,
  summarizeDrawerDay,
  reportKind,
  type DayEventRow,
  type DaySessionRow,
} from "@/lib/pos/day-report-core";
import { refundsForBusinessDay } from "@/lib/pos/refunds-store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same role gate as /api/pos/approve — the slip reveals expected cash. */
const APPROVER_ROLES = new Set(["manager", "lead"]);

async function handlePost(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";
  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const registerId = auth.device.register_id;
  if (!registerId) {
    return NextResponse.json(
      { error: "This device is not bound to a register — a manager must assign one in the back office." },
      { status: 409 },
    );
  }
  if (!isSupabaseServiceConfigured) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }

  const throttleScope = deviceThrottleScope(auth.device.id);
  const locked = await pinPadBlocked(throttleScope);
  if (locked) return NextResponse.json({ error: locked }, { status: 429 });

  let pin = "";
  try {
    pin = String(((await req.json()) as { pin?: unknown })?.pin ?? "");
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!isValidPin(pin)) {
    return NextResponse.json({ error: "Enter a valid 4–6 digit PIN." }, { status: 400 });
  }
  const employee = await getEmployeeByPin(pin);
  if (!employee) {
    await notePinFailure(throttleScope);
    return NextResponse.json({ error: "No active employee for that PIN." }, { status: 401 });
  }
  await notePinSuccess(throttleScope);
  if (!APPROVER_ROLES.has(employee.job_role)) {
    return NextResponse.json(
      { error: `${employee.full_name} is not a manager or lead — the day report reveals expected drawer cash.` },
      { status: 403 },
    );
  }

  const admin = createSupabaseAdminClient();
  const businessDay = pacificToday();
  const dayStart = pacificWallTimeToUtcISO(businessDay, "start");
  const dayEnd = pacificWallTimeToUtcISO(businessDay, "end");

  // ── this register's ledger for the Pacific business day ──
  const { data: eventRows, error: eventsError } = await admin
    .from("pos_sale_events")
    .select("event_type, status, payload")
    .eq("register_id", registerId)
    .gte("occurred_at", dayStart)
    .lte("occurred_at", dayEnd);
  if (eventsError) {
    return NextResponse.json({ error: `Could not read the day's events: ${eventsError.message}` }, { status: 503 });
  }
  const events: DayEventRow[] = ((eventRows as { event_type: string; status: string; payload: unknown }[] | null) ?? []).map(
    (r) => ({ eventType: r.event_type, status: r.status, payload: r.payload }),
  );
  const summary = summarizeDayEvents(events);

  // ── the day's drawer sessions + drops ──
  const { data: sessionRows } = await admin
    .from("drawer_sessions")
    .select("id, status, opening_count_minor, over_short_minor")
    .eq("register_id", registerId)
    .eq("business_day", businessDay);
  const sessions =
    (sessionRows as { id: string; status: string; opening_count_minor: number | null; over_short_minor: number | null }[] | null) ??
    [];
  let drops: { amountMinor: number }[] = [];
  if (sessions.length > 0) {
    const { data: dropRows } = await admin
      .from("drawer_drops")
      .select("amount_minor")
      .in("session_id", sessions.map((s) => s.id));
    drops = ((dropRows as { amount_minor: number }[] | null) ?? []).map((d) => ({ amountMinor: d.amount_minor }));
  }
  const sessionSummaries: DaySessionRow[] = sessions.map((s) => ({
    status: s.status,
    openingCountMinor: s.opening_count_minor,
    overShortMinor: s.over_short_minor,
  }));
  const drawer = sessions.length > 0 ? summarizeDrawerDay(sessionSummaries, drops) : null;
  const kind = reportKind(drawer);

  // ── AN-4: cash refunded OUT today (STORE-WIDE — voids and counter returns
  // carry no register attribution, so we never guess a register). Shared
  // query with the back-office reconcile screen so both print the same
  // number. Best-effort: a read failure yields all-zeros, never blocks.
  const refunds = await refundsForBusinessDay(businessDay);

  await recordAudit({
    actorId: employee.staff_id,
    actorEmail: employee.full_name,
    action: "register.day_report",
    entityType: "register",
    entityId: registerId,
    after: {
      via: "register",
      deviceId: auth.device.id,
      kind,
      businessDay,
      saleCount: summary.saleCount,
      grossMinor: summary.grossMinor,
      refundTotalMinor: refunds.refundTotalMinor,
    },
  });

  return NextResponse.json({
    ok: true,
    kind,
    businessDay,
    requestedByName: employee.full_name,
    summary,
    drawer,
    refunds,
  });
}

/**
 * CORS preflight. The packaged register app ("Greenway Point of Transaction")
 * calls this API cross-origin from capacitor://localhost. Policy lives in
 * @/lib/pos/cors-core (pure).
 */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Wrap once so EVERY return path carries the CORS headers.
  return withPosCors(req, await handlePost(req));
}
