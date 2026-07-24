/**
 * src/lib/registers/eod-store.ts  (Feature slice 32 — printable records)
 *
 * Server-side data gathering for the two printable back-office records:
 *
 *   eodData(day)            — the store-wide END-OF-DAY summary report
 *   tillSummaryData(id)     — one drawer session's TILL SUMMARY sheet
 *
 * Both are read-only. The EOD model math lives in the PURE eod-core module;
 * this file only fetches rows and maps them into typed inputs.
 *
 * Safe tables (0135) degrade gracefully here: a missing table turns the
 * safe section off with a note instead of breaking the whole report —
 * reading a report must never be as strict as WRITING a swap (which
 * refuses loudly in safe-store).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { summarizeDayEvents, type DayEventRow } from "@/lib/pos/day-report-core";
import { buildEodModel, type EodModel, type EodSafeCountInput } from "@/lib/registers/eod-core";
import { listEmployees } from "@/lib/staffing/store";
import { type DrawerSession, type DrawerDrop } from "@/lib/registers/store";
import { type SafeSwapRow } from "@/lib/registers/safe-store";

/** PostgREST "table doesn't exist" (same detection as safe-store). */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "42P01") return true;
  return /relation .* does not exist|Could not find the table/i.test(err.message ?? "");
}

/** Employee id → full name map (for printed attribution). */
async function employeeNames(): Promise<Map<string, string>> {
  const all = await listEmployees({ includeInactive: true });
  return new Map(all.map((e) => [e.id, e.full_name]));
}

// ---------------------------------------------------------------------------
// End-of-day report
// ---------------------------------------------------------------------------

export type EodData = {
  configured: boolean;
  businessDay: string;
  model: EodModel;
};

const EMPTY_SALES = {
  saleCount: 0,
  grossMinor: 0,
  subtotalMinor: 0,
  taxMinor: 0,
  medicalSaleCount: 0,
  medicalSavingsMinor: 0,
  roundedSaleCount: 0,
  roundingMinor: 0,
  noSaleCount: 0,
  exceptionCount: 0,
  pendingCount: 0,
};

/** Gather everything the printable EOD page needs for one business day. */
export async function eodData(businessDay: string): Promise<EodData> {
  const empty: EodData = {
    configured: false,
    businessDay,
    model: buildEodModel({
      registers: [],
      sessions: [],
      drops: [],
      sales: EMPTY_SALES,
      safeReady: false,
      safeCounts: [],
      swaps: [],
    }),
  };
  if (!isSupabaseServiceConfigured) return empty;

  const admin = createSupabaseAdminClient();
  const dayStart = pacificWallTimeToUtcISO(businessDay, "start");
  const dayEnd = pacificWallTimeToUtcISO(businessDay, "end");

  // Registers + the day's sessions.
  const [{ data: regRows }, { data: sessionRows }] = await Promise.all([
    admin.from("registers").select("id, name").order("name"),
    admin.from("drawer_sessions").select("*").eq("business_day", businessDay),
  ]);
  const registers = ((regRows as { id: string; name: string }[] | null) ?? []).map((r) => ({
    id: r.id,
    name: r.name,
  }));
  const sessions = (sessionRows as DrawerSession[] | null) ?? [];

  // Drops for those sessions (mapped back to their register).
  const regBySession = new Map(sessions.map((s) => [s.id, s.register_id]));
  let drops: { registerId: string; amountMinor: number }[] = [];
  if (sessions.length > 0) {
    const { data: dropRows } = await admin
      .from("drawer_drops")
      .select("session_id, amount_minor")
      .in("session_id", sessions.map((s) => s.id));
    drops = ((dropRows as { session_id: string; amount_minor: number }[] | null) ?? []).map((d) => ({
      registerId: regBySession.get(d.session_id) ?? "",
      amountMinor: d.amount_minor,
    }));
  }

  // Store-wide sales facts from the ledger (ALL registers, processed only
  // summed — same verified-facts aggregation as the register X/Z slip).
  const { data: eventRows } = await admin
    .from("pos_sale_events")
    .select("event_type, status, payload")
    .gte("occurred_at", dayStart)
    .lte("occurred_at", dayEnd);
  const events: DayEventRow[] = (
    (eventRows as { event_type: string; status: string; payload: unknown }[] | null) ?? []
  ).map((r) => ({ eventType: r.event_type, status: r.status, payload: r.payload }));
  const sales = summarizeDayEvents(events);

  // Safe section (0135) — graceful when the migration hasn't run.
  let safeReady = true;
  let safeCounts: EodSafeCountInput[] = [];
  let swaps: { amountMinor: number }[] = [];
  const { data: countRows, error: countErr } = await admin
    .from("safe_counts")
    .select("count_window, total_minor, variance_minor")
    .eq("business_day", businessDay)
    .order("counted_at", { ascending: false });
  if (countErr) {
    if (isMissingTable(countErr)) safeReady = false;
  } else {
    safeCounts = (
      (countRows as { count_window: string; total_minor: number; variance_minor: number }[] | null) ?? []
    ).map((c) => ({ window: c.count_window, totalMinor: c.total_minor, varianceMinor: c.variance_minor }));
  }
  if (safeReady) {
    const { data: swapRows, error: swapErr } = await admin
      .from("safe_swaps")
      .select("amount_minor")
      .gte("occurred_at", dayStart)
      .lte("occurred_at", dayEnd);
    if (swapErr) {
      if (isMissingTable(swapErr)) safeReady = false;
    } else {
      swaps = ((swapRows as { amount_minor: number }[] | null) ?? []).map((s) => ({
        amountMinor: s.amount_minor,
      }));
    }
  }

  return {
    configured: true,
    businessDay,
    model: buildEodModel({
      registers,
      sessions: sessions.map((s) => ({
        registerId: s.register_id,
        status: s.status,
        openingCountMinor: s.opening_count_minor,
        closingCountMinor: s.closing_count_minor,
        overShortMinor: s.over_short_minor,
        tipsMinor: s.tips_minor ?? null,
      })),
      drops,
      sales,
      safeReady,
      safeCounts,
      swaps,
    }),
  };
}

// ---------------------------------------------------------------------------
// Till summary (one drawer session, printable)
// ---------------------------------------------------------------------------

export type TillSummaryData = {
  session: DrawerSession;
  registerName: string;
  openedByName: string | null;
  closedByName: string | null;
  drops: (DrawerDrop & { droppedByName: string | null; witnessedByName: string | null })[];
  /** Change swaps tied to this session (empty before 0135 — graceful). */
  swaps: (SafeSwapRow & { performedByName: string | null; approvedByName: string | null })[];
};

/** Everything the printable till-summary sheet needs for one session. */
export async function tillSummaryData(sessionId: string): Promise<TillSummaryData | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();

  const { data: sessionRow } = await admin
    .from("drawer_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (!sessionRow) return null;
  const session = sessionRow as DrawerSession;

  const [names, { data: regRow }, { data: dropRows }, swapsRes] = await Promise.all([
    employeeNames(),
    admin.from("registers").select("name").eq("id", session.register_id).maybeSingle(),
    admin.from("drawer_drops").select("*").eq("session_id", sessionId).order("dropped_at", { ascending: true }),
    admin.from("safe_swaps").select("*").eq("session_id", sessionId).order("occurred_at", { ascending: true }),
  ]);

  const nameFor = (id: string | null): string | null => (id ? (names.get(id) ?? "—") : null);

  const drops = ((dropRows as DrawerDrop[] | null) ?? []).map((d) => ({
    ...d,
    droppedByName: nameFor(d.dropped_by),
    witnessedByName: nameFor(d.witnessed_by),
  }));

  // Swaps degrade gracefully before 0135 (reading a report must not break).
  const swaps = swapsRes.error
    ? []
    : ((swapsRes.data as SafeSwapRow[] | null) ?? []).map((s) => ({
        ...s,
        performedByName: nameFor(s.performed_by),
        approvedByName: nameFor(s.approved_by),
      }));

  return {
    session,
    registerName: (regRow as { name: string } | null)?.name ?? "—",
    openedByName: nameFor(session.opened_by),
    closedByName: nameFor(session.closed_by),
    drops,
    swaps,
  };
}
