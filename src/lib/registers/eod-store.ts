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
 *
 * Fix Phase 2.6b (G-15, F-03-7): every other failed read is now RETURNED in
 * `readProblems` and shown at the top of the sheet. A failed read used to
 * render as "No drawer sessions on this business day." or as zeros. The
 * day's sale events are read page by page with a completeness check (a busy
 * day can pass the 1,000-row server cap). eodData also builds the deposit
 * sheet (eod-sheet-core.ts): deposit by till, cash check with refunds, and
 * the day's bag.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { summarizeDayEvents, type DayEventRow } from "@/lib/pos/day-report-core";
import { buildEodModel, type EodModel, type EodSafeCountInput } from "@/lib/registers/eod-core";
import { listEmployees } from "@/lib/staffing/store";
import { type DrawerSession, type DrawerDrop } from "@/lib/registers/store";
import { type SafeSwapRow } from "@/lib/registers/safe-store";
import { readDayRefunds } from "@/lib/registers/drawer-figure-store";
import { bagDetailForDay } from "@/lib/registers/deposit-bag-store";
import { buildEodSheet, denomsFromJson, type EodSheet, type SheetBagInput } from "@/lib/registers/eod-sheet-core";

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
  /** Fix Phase 2.6b (G-15): the deposit sheet for the same day. */
  sheet: EodSheet;
  /** Every read that did not complete (F-03-7). Empty = the report is whole. */
  readProblems: string[];
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
  const emptySheet = buildEodSheet({
    businessDay,
    sessions: [],
    drops: [],
    saleEvents: [],
    refunds: [],
    bag: null,
    bagMissingSchema: false,
    readProblems: [],
  });
  const empty: EodData = {
    configured: false,
    businessDay,
    sheet: emptySheet,
    readProblems: [],
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

  const readProblems: string[] = [];

  // Registers + the day's sessions.
  const [{ data: regRows, error: regErr }, { data: sessionRows, error: sessionErr }] = await Promise.all([
    admin.from("registers").select("id, name").order("name"),
    admin.from("drawer_sessions").select("*").eq("business_day", businessDay).order("opened_at", { ascending: true }),
  ]);
  if (regErr) readProblems.push(`Registers could not be read: ${regErr.message}`);
  if (sessionErr) readProblems.push(`Drawer sessions could not be read: ${sessionErr.message}`);
  const registers = ((regRows as { id: string; name: string }[] | null) ?? []).map((r) => ({
    id: r.id,
    name: r.name,
  }));
  const sessions = (sessionRows as DrawerSession[] | null) ?? [];

  // Drops for those sessions (mapped back to their register).
  const regBySession = new Map(sessions.map((s) => [s.id, s.register_id]));
  let drops: { registerId: string; amountMinor: number }[] = [];
  let sessionDrops: { sessionId: string; amountMinor: number }[] = [];
  if (sessions.length > 0) {
    const { data: dropRows, error: dropErr } = await admin
      .from("drawer_drops")
      .select("session_id, amount_minor")
      .in("session_id", sessions.map((s) => s.id));
    if (dropErr) readProblems.push(`Drops could not be read: ${dropErr.message}`);
    const rows = (dropRows as { session_id: string; amount_minor: number }[] | null) ?? [];
    drops = rows.map((d) => ({
      registerId: regBySession.get(d.session_id) ?? "",
      amountMinor: d.amount_minor,
    }));
    sessionDrops = rows.map((d) => ({ sessionId: d.session_id, amountMinor: d.amount_minor }));
  }

  // Store-wide sales facts from the ledger (ALL registers, processed only
  // summed — same verified-facts aggregation as the register X/Z slip).
  type EventRow = { id: string; event_type: string; status: string; payload: unknown };
  const eventRead = await pagedAllChecked<EventRow>(async (from, to) => {
    const { data, error } = await admin
      .from("pos_sale_events")
      .select("id, event_type, status, payload")
      .gte("occurred_at", dayStart)
      .lte("occurred_at", dayEnd)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) return { rows: [], ok: false };
    return { rows: (data as EventRow[] | null) ?? [], ok: true };
  });
  if (!eventRead.verdict.complete) readProblems.push(`Sales could not all be read: ${eventRead.verdict.message}`);
  const events: DayEventRow[] = eventRead.rows.map((r) => ({ eventType: r.event_type, status: r.status, payload: r.payload }));
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
    else readProblems.push(`Safe counts could not be read: ${countErr.message}`);
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
      else readProblems.push(`Change swaps could not be read: ${swapErr.message}`);
    } else {
      swaps = ((swapRows as { amount_minor: number }[] | null) ?? []).map((s) => ({
        amountMinor: s.amount_minor,
      }));
    }
  }

  // Deposit sheet (G-15): refunds by where they were paid, and the day's bag.
  const regName = new Map(registers.map((r) => [r.id, r.name]));
  const [refundRead, bagRead, names] = await Promise.all([
    readDayRefunds(businessDay),
    bagDetailForDay(businessDay),
    employeeNames().catch(() => null),
  ]);
  if (!refundRead.complete) readProblems.push(`Refunds could not all be read: ${refundRead.problem ?? "unknown"}`);
  if (!bagRead.ok && !bagRead.missingSchema) readProblems.push(`Deposit bag could not be read: ${bagRead.error}`);
  if (names === null) readProblems.push("Employee names could not be read.");
  const nameFor = (id: string | null): string | null => (id ? (names?.get(id) ?? "—") : null);
  let sheetBag: SheetBagInput | null = null;
  if (bagRead.ok && bagRead.bag) {
    const b = bagRead.bag;
    sheetBag = {
      ...b,
      nightDenoms: denomsFromJson(b.nightDenoms),
      morningDenoms: denomsFromJson(b.morningDenoms),
      nightCountedByName: nameFor(b.nightCountedBy),
      morningCountedByName: nameFor(b.morningCountedBy),
      sealedByName: nameFor(b.sealedBy),
    };
  }
  const sheet = buildEodSheet({
    businessDay,
    sessions: sessions.map((s) => ({
      id: s.id,
      registerName: regName.get(s.register_id) ?? "Register",
      status: s.status,
      openingMinor: s.opening_count_minor,
      closingMinor: s.closing_count_minor,
    })),
    drops: sessionDrops,
    saleEvents: events,
    refunds: refundRead.refunds.map((r) => ({ source: r.source, refundMinor: r.refundMinor, paidFrom: r.paidFrom })),
    bag: sheetBag,
    bagMissingSchema: !bagRead.ok && bagRead.missingSchema,
    readProblems,
  });

  return {
    configured: true,
    businessDay,
    sheet,
    readProblems,
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
  /** Fix Phase 2.2 (G-01, 0314): the second counter at close. null = none. */
  secondCountedByName: string | null;
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
    secondCountedByName: nameFor(session.second_counted_by ?? null),
    drops,
    swaps,
  };
}
