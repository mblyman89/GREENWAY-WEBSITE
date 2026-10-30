/**
 * src/lib/registers/store.ts
 *
 * Server-side cash-drawer lifecycle (Slice 26). Blind counts: the closing
 * employee records a count WITHOUT seeing expected; the manager reveals the
 * variance at reconcile. (The old next-morning "verify till" step was retired
 * in Fix Phase 6, owner D83: the deposit bag's morning recount is the verify.)
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { businessDayFor } from "@/lib/staffing/time";
import { type DenomCounts, denomTotalMinor, expectedClose, overShort } from "@/lib/registers/cash";
import { checkSecondCounter, closeErrorMessage } from "@/lib/registers/second-count-core";
import { checkOverShortReason, isOverShortWarning } from "@/lib/registers/over-short-warning-core";

export type Register = {
  id: string;
  name: string;
  kind: "sales" | "manager_till";
  default_float_minor: number;
  active: boolean;
  sort_order: number;
  notes: string | null;
};

export type DrawerSession = {
  id: string;
  register_id: string;
  opened_by: string | null;
  closed_by: string | null;
  shift_id: string | null;
  business_day: string;
  status: "open" | "closed" | "reconciled" | "verified";
  opening_count_minor: number | null;
  closing_count_minor: number | null;
  expected_close_minor: number | null;
  over_short_minor: number | null;
  /**
   * Tips counted at close, cents (migration 0134). NULL = not recorded;
   * 0 = counted-zero jar. Employee money — never part of expected/over-short.
   * Optional so the type stays truthful before 0134 is applied.
   */
  tips_minor?: number | null;
  /** Fix Phase 2.1 (0313): system cash sales at reconcile. NULL = typed era. */
  cash_sales_minor?: number | null;
  /** Fix Phase 2.1 (0313): cash refunds this drawer paid. NULL = typed era. */
  refunds_paid_minor?: number | null;
  /** Fix Phase 2.2 (0314, G-01): the second employee who counted at close. */
  second_counted_by?: string | null;
  /** Fix Phase 2.2 (0314): the second employee's own count, cents. */
  second_count_minor?: number | null;
  /** Fix Phase 2.2 (0314): when the second count was recorded. */
  second_counted_at?: string | null;
  /** Fix Phase 2.3 (0315, G-03): the over/short reason written at reconcile. */
  over_short_reason?: string | null;
  /** Fix Phase 2.3 (0315): the manager (employee record) who wrote it. */
  over_short_reason_by?: string | null;
  /** The manager (employee record) who reconciled. */
  reconciled_by?: string | null;
  opened_at: string | null;
  closed_at: string | null;
  reconciled_at: string | null;
  notes: string | null;
};

export type DrawerDrop = {
  id: string;
  session_id: string;
  amount_minor: number;
  drop_window: "afternoon" | "night" | "other";
  dropped_by: string | null;
  witnessed_by: string | null;
  notes: string | null;
  dropped_at: string;
};

// ---------------------------------------------------------------------------
// Registers
// ---------------------------------------------------------------------------

export async function listRegisters(opts?: { includeInactive?: boolean }): Promise<Register[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin.from("registers").select("*").order("sort_order", { ascending: true });
  if (!opts?.includeInactive) q = q.eq("active", true);
  const { data } = await q;
  return (data as Register[] | null) ?? [];
}

export async function getRegister(id: string): Promise<Register | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("registers").select("*").eq("id", id).maybeSingle();
  return (data as Register | null) ?? null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function openSessionForRegister(registerId: string): Promise<DrawerSession | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("drawer_sessions")
    .select("*")
    .eq("register_id", registerId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as DrawerSession | null) ?? null;
}

export async function getSession(id: string): Promise<DrawerSession | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("drawer_sessions").select("*").eq("id", id).maybeSingle();
  return (data as DrawerSession | null) ?? null;
}

export async function dropsForSession(sessionId: string): Promise<DrawerDrop[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("drawer_drops")
    .select("*")
    .eq("session_id", sessionId)
    .order("dropped_at", { ascending: true });
  return (data as DrawerDrop[] | null) ?? [];
}

export async function totalDropsMinor(sessionId: string): Promise<number> {
  const drops = await dropsForSession(sessionId);
  return drops.reduce((sum, d) => sum + d.amount_minor, 0);
}

export type OpenResult = { ok: true; sessionId: string } | { ok: false; error: string };

/**
 * Open (count-in) a register. The opening count IS the starting float counted by
 * the employee. A register may have only one open session at a time.
 */
export async function openDrawer(opts: {
  registerId: string;
  employeeId: string | null;
  shiftId: string | null;
  denoms: DenomCounts;
}): Promise<OpenResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();

  const existing = await openSessionForRegister(opts.registerId);
  if (existing) return { ok: false, error: "This register already has an open drawer. Close it first." };

  const nowISO = new Date().toISOString();
  const openingMinor = denomTotalMinor(opts.denoms);

  const { data: session, error } = await admin
    .from("drawer_sessions")
    .insert({
      register_id: opts.registerId,
      opened_by: opts.employeeId,
      shift_id: opts.shiftId,
      business_day: businessDayFor(nowISO),
      status: "open",
      opening_count_minor: openingMinor,
      opened_at: nowISO,
    })
    .select("id")
    .single();
  if (error || !session) return { ok: false, error: error?.message ?? "Failed to open drawer." };

  const sessionId = (session as { id: string }).id;
  await admin.from("drawer_counts").insert({
    session_id: sessionId,
    count_type: "open",
    counted_by: opts.employeeId,
    ...opts.denoms,
    total_minor: openingMinor,
  });

  return { ok: true, sessionId };
}

/**
 * Record a mid-shift cash drop to the safe (one of the 4 daily drops).
 */
export async function recordDrop(opts: {
  sessionId: string;
  amountMinor: number;
  window: "afternoon" | "night" | "other";
  droppedBy: string | null;
  witnessedBy: string | null;
  notes?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  if (opts.amountMinor <= 0) return { ok: false, error: "Drop amount must be greater than zero." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("drawer_drops").insert({
    session_id: opts.sessionId,
    amount_minor: opts.amountMinor,
    drop_window: opts.window,
    dropped_by: opts.droppedBy,
    witnessed_by: opts.witnessedBy,
    notes: opts.notes ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Close (count-out) a register — BLIND. The employee records their count; we
 * store it but DO NOT reveal expected/variance here. Reconcile does that.
 */
export async function closeDrawerBlind(opts: {
  sessionId: string;
  employeeId: string | null;
  denoms: DenomCounts;
  /**
   * Tips counted at close (cents). undefined = not recorded (column stays
   * NULL); 0 = counted-zero jar. Written BEST-EFFORT in a separate update
   * (0120 device_id pattern) so a close never fails if migration 0134 is
   * unapplied. Tips never touch the drawer's expected/over-short math.
   */
  tipsMinor?: number;
  /**
   * Fix Phase 2.2 (G-01, owner D2): the second employee and their own count.
   * Required. The caller has already verified the second person's PIN; this
   * function re-checks that they are not the closer (second-count-core),
   * and migration 0314's check is the backstop.
   */
  second: { employeeId: string; denoms: DenomCounts };
}): Promise<{ ok: boolean; error?: string; countRowWarnings?: string[] }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const who = checkSecondCounter(opts.employeeId, opts.second.employeeId);
  if (!who.ok) return { ok: false, error: who.error };
  const admin = createSupabaseAdminClient();
  const session = await getSession(opts.sessionId);
  if (!session) return { ok: false, error: "Session not found." };
  if (session.status !== "open") return { ok: false, error: "Drawer is not open." };

  const nowISO = new Date().toISOString();
  const closingMinor = denomTotalMinor(opts.denoms);
  const secondMinor = denomTotalMinor(opts.second.denoms);

  // Compare-and-swap (F-01-2, close part): only a drawer that is still open
  // closes. Two taps, or two devices, cannot both close it; the second sees
  // nothing changed and is told so.
  const { data: changed, error } = await admin
    .from("drawer_sessions")
    .update({
      status: "closed",
      closed_by: opts.employeeId,
      closing_count_minor: closingMinor,
      closed_at: nowISO,
      second_counted_by: opts.second.employeeId,
      second_count_minor: secondMinor,
      second_counted_at: nowISO,
    })
    .eq("id", opts.sessionId)
    .eq("status", "open")
    .select("id");
  if (error) return { ok: false, error: closeErrorMessage(error.message) };
  if (!changed || changed.length === 0) {
    return { ok: false, error: "This drawer was closed by someone else a moment ago. Nothing was changed." };
  }

  // Best-effort tips stamp (drawer_sessions.tips_minor, migration 0134).
  // Separate update so an unapplied migration can never block the close —
  // the blind count itself is already durable above.
  if (opts.tipsMinor !== undefined) {
    try {
      await admin
        .from("drawer_sessions")
        .update({ tips_minor: opts.tipsMinor })
        .eq("id", opts.sessionId);
    } catch {
      // Column may not exist yet if 0134 is unapplied — the tip figure is
      // skipped, nothing else.
    }
  }

  // Denomination breakdowns. The totals are already on the session row, so a
  // failed breakdown does not undo the close; it is reported to the caller
  // (and audited) instead of being silently ignored (F-01-2, count rows).
  const countRowWarnings: string[] = [];
  const { error: closeRowError } = await admin.from("drawer_counts").insert({
    session_id: opts.sessionId,
    count_type: "close",
    counted_by: opts.employeeId,
    ...opts.denoms,
    total_minor: closingMinor,
  });
  if (closeRowError) countRowWarnings.push(`close breakdown not saved: ${closeRowError.message}`);
  const { error: secondRowError } = await admin.from("drawer_counts").insert({
    session_id: opts.sessionId,
    count_type: "second",
    counted_by: opts.second.employeeId,
    ...opts.second.denoms,
    total_minor: secondMinor,
  });
  if (secondRowError) countRowWarnings.push(`second-count breakdown not saved: ${secondRowError.message}`);
  return countRowWarnings.length > 0 ? { ok: true, countRowWarnings } : { ok: true };
}

/**
 * Reconcile a closed drawer (manager): reveal over/short.
 *
 * Fix Phase 2.1 (G-05, F-01-4): the cash sales are no longer typed. The
 * caller passes the figure the server built from this drawer's own records
 * (drawer-figure-store.ts loadDrawerFigure): cash sales from processed
 * register sales carrying this drawer's id, minus the cash refunds tied to
 * this drawer. The action refuses before calling this when the figure has a
 * blocker, so an unknown is never turned into a number.
 *
 * Compare-and-set (F-01-2): the update only lands while the drawer is still
 * "closed", so a double click or a second manager cannot overwrite the first
 * reconcile's figures (the books keep the first post).
 *
 * Fix Phase 2.3 (G-03, owner D7 / D21): the reason is checked HERE, against
 * the over/short this function works out, so a page that showed an older
 * figure cannot slip past the $5 rule. More than $5.00 over or short with no
 * reason -> refused, nothing saved. $5.00 or less -> the reason is optional.
 */
export async function reconcileDrawer(opts: {
  sessionId: string;
  cashSalesMinor: number;
  refundsPaidMinor: number;
  reconciledBy: string | null;
  overShortReason?: string | null;
}): Promise<{
  ok: boolean;
  error?: string;
  overShortMinor?: number;
  expectedMinor?: number;
  /** The reason as saved (trimmed), or null. */
  reason?: string | null;
  /** False when migration 0315 is missing and the reason is only in the audit entry. */
  reasonSaved?: boolean;
  /** True when the over/short is more than $5.00 (a warning, D7). */
  warning?: boolean;
}> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const session = await getSession(opts.sessionId);
  if (!session) return { ok: false, error: "Session not found." };
  if (session.status !== "closed") return { ok: false, error: "Drawer must be closed before reconciling." };
  if (!Number.isInteger(opts.cashSalesMinor) || !Number.isInteger(opts.refundsPaidMinor) || opts.refundsPaidMinor < 0) {
    return { ok: false, error: "The drawer figure is not a whole number of cents. Nothing was saved." };
  }

  const dropsMinor = await totalDropsMinor(opts.sessionId);
  const expected = expectedClose({
    openingMinor: session.opening_count_minor ?? 0,
    cashSalesMinor: opts.cashSalesMinor - opts.refundsPaidMinor,
    dropsMinor,
  });
  const os = overShort(session.closing_count_minor ?? 0, expected);
  const reasonCheck = checkOverShortReason(os, opts.overShortReason ?? "", "This drawer");
  if (!reasonCheck.ok) return { ok: false, error: reasonCheck.error, overShortMinor: os, expectedMinor: expected };
  const reason = reasonCheck.reason;

  const base = {
    status: "reconciled",
    expected_close_minor: expected,
    over_short_minor: os,
    reconciled_at: new Date().toISOString(),
    reconciled_by: opts.reconciledBy,
  };
  const figureCols = { cash_sales_minor: opts.cashSalesMinor, refunds_paid_minor: opts.refundsPaidMinor };
  const reasonCols = { over_short_reason: reason, over_short_reason_by: reason ? opts.reconciledBy : null };
  const write = (withFigure: boolean, withReason: boolean) =>
    admin
      .from("drawer_sessions")
      .update({ ...base, ...(withFigure ? figureCols : {}), ...(withReason ? reasonCols : {}) })
      .eq("id", opts.sessionId)
      .eq("status", "closed")
      .select("id");
  const missingCol = (e: { code?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204");
  let reasonSaved = true;
  let { data, error } = await write(true, true);
  // Before migration 0315 the reason columns do not exist yet: the reconcile
  // still lands and the reason is kept in the audit entry (the caller says so
  // on the banner). Before 0313 the two figure columns are missing as well.
  if (missingCol(error)) {
    reasonSaved = false;
    ({ data, error } = await write(true, false));
    if (missingCol(error)) ({ data, error } = await write(false, false));
  }
  if (error) return { ok: false, error: error.message };
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: "This drawer was reconciled by someone else a moment ago. Nothing was changed. Reload the page." };
  }
  return { ok: true, overShortMinor: os, expectedMinor: expected, reason, reasonSaved: reason ? reasonSaved : true, warning: isOverShortWarning(os) };
}

/*
 * verifyTill() was removed in Fix Phase 6 (G-63, owner D83). The morning
 * blind recount of the deposit bag is the verify now (SOP-03 §4.10). Nothing
 * in the app writes till_verifications any more; the table and the
 * "verified" status stay readable as history.
 */

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export type RegisterLive = {
  register: Register;
  openSession: DrawerSession | null;
  dropsMinor: number;
};

/** Live view: every register with its current open session + drops total. */
export async function liveRegisters(): Promise<RegisterLive[]> {
  const registers = await listRegisters();
  // PERF2 round 4: each register's open session + drops are independent of
  // every other register's, so the registers are read side by side instead of
  // one after another (was 2 round trips PER register, in series, on every
  // /admin load). Promise.all keeps the original register order.
  return Promise.all(
    registers.map(async (register) => {
      const openSession = await openSessionForRegister(register.id);
      const dropsMinor = openSession ? await totalDropsMinor(openSession.id) : 0;
      return { register, openSession, dropsMinor };
    }),
  );
}

/**
 * At-a-glance cash summary for the Cash Management page. Computed server-side so
 * the page render stays pure (no Date.now() in the component). "Today" is the
 * current Pacific business day.
 */
export type CashDrawerSummary = {
  registerCount: number;
  openCount: number;
  /** Sum of opening (starting) cash across currently-open drawers, cents. */
  startingCashOpenMinor: number;
  /** Sum of cash dropped to the safe across currently-open drawers, cents. */
  droppedOpenMinor: number;
  /** Closed sessions still awaiting a manager reconcile. */
  awaitingReconcile: number;
  /** Net over/short across sessions reconciled today (cents). */
  netOverShortTodayMinor: number;
  reconciledToday: number;
};

export async function cashDrawerSummary(): Promise<CashDrawerSummary> {
  const live = await liveRegisters();
  const today = businessDayFor(new Date().toISOString());

  let startingCashOpenMinor = 0;
  let droppedOpenMinor = 0;
  let openCount = 0;
  for (const l of live) {
    if (l.openSession) {
      openCount += 1;
      startingCashOpenMinor += l.openSession.opening_count_minor ?? 0;
      droppedOpenMinor += l.dropsMinor;
    }
  }

  const recent = await recentSessions(120);
  const awaitingReconcile = recent.filter((s) => s.status === "closed").length;
  const reconciledTodaySessions = recent.filter(
    (s) =>
      s.business_day === today &&
      (s.status === "reconciled" || s.status === "verified") &&
      s.over_short_minor != null,
  );
  const netOverShortTodayMinor = reconciledTodaySessions.reduce(
    (sum, s) => sum + (s.over_short_minor ?? 0),
    0,
  );

  return {
    registerCount: live.length,
    openCount,
    startingCashOpenMinor,
    droppedOpenMinor,
    awaitingReconcile,
    netOverShortTodayMinor,
    reconciledToday: reconciledTodaySessions.length,
  };
}

export async function recentSessions(limit = 40): Promise<(DrawerSession & { register_name: string })[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("drawer_sessions")
    .select("*")
    .order("business_day", { ascending: false })
    .order("opened_at", { ascending: false })
    .limit(limit);
  const sessions = (data as DrawerSession[] | null) ?? [];
  if (sessions.length === 0) return [];
  const ids = [...new Set(sessions.map((s) => s.register_id))];
  const { data: regs } = await admin.from("registers").select("id, name").in("id", ids);
  const byId = new Map(((regs as { id: string; name: string }[] | null) ?? []).map((r) => [r.id, r.name]));
  return sessions.map((s) => ({ ...s, register_name: byId.get(s.register_id) ?? "—" }));
}
