import "server-only";

/**
 * src/lib/registers/drawer-figure-store.ts  (Fix Phase 2.1 · G-05 · F-01-4)
 *
 * Reads the records behind one drawer's cash figure and hands them to the
 * pure core (drawer-figure-core.ts). Also owns the small writes that tie a
 * cash refund to the drawer (or the safe) that paid it.
 *
 * Every read is paged with a completeness verdict: a failed page is never
 * treated as "no more rows" (rule 46), it becomes a blocker on the figure.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { auditRefundMinor } from "@/lib/pos/day-report-core";
import { receiptNumber } from "@/lib/pos/receipt-core";
import { businessDayFor } from "@/lib/staffing/time";
import { getSession, totalDropsMinor, type DrawerSession } from "@/lib/registers/store";
import {
  buildDrawerFigure,
  type DrawerFigure,
  type FigureRefund,
  type FigureSaleEvent,
} from "@/lib/registers/drawer-figure-core";

/** Audit action a manager's later "this void was paid from X" writes. */
export const VOID_REFUND_ASSIGNED_ACTION = "register.void_refund_assigned";

const MIGRATION_0313_HINT =
  "Apply migration 0313 (drawer cash refunds) first. Until then a refund cannot be tied to a drawer, so reconcile waits.";

function isMissingColumn(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42703" || e.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(e.message ?? "");
}

type VoidAuditRow = { id: number | string; entity_id: string | null; after_json: unknown; created_at: string };
type AssignAuditRow = { id: number | string; entity_id: string | null; after_json: unknown; created_at: string };
type ReturnRow = {
  id: string;
  refund_minor_units: number;
  created_at: string;
  refund_paid_from?: string | null;
  refund_drawer_session_id?: string | null;
};

export type DayRefundsRead = {
  refunds: FigureRefund[];
  complete: boolean;
  problem: string | null;
  /** False before migration 0313 (returns cannot carry a drawer yet). */
  returnsAttributable: boolean;
};

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function voidAttribution(after: unknown): { paidFrom: "drawer" | "safe" | null; drawerSessionId: string | null } {
  const a = rec(after);
  const sid = typeof a.drawerSessionId === "string" && a.drawerSessionId ? a.drawerSessionId : null;
  if (a.refundPaidFrom === "safe") return { paidFrom: "safe", drawerSessionId: null };
  if (sid) return { paidFrom: "drawer", drawerSessionId: sid };
  return { paidFrom: null, drawerSessionId: null };
}

/**
 * Every cash refund of one Pacific business day, store-wide, each with where
 * its cash came from (or null when nobody has said).
 */
export async function readDayRefunds(businessDay: string): Promise<DayRefundsRead> {
  const out: DayRefundsRead = { refunds: [], complete: true, problem: null, returnsAttributable: true };
  if (!isSupabaseServiceConfigured) return { ...out, complete: false, problem: "database not configured" };
  const admin = createSupabaseAdminClient();
  const dayStart = pacificWallTimeToUtcISO(businessDay, "start");
  const dayEnd = pacificWallTimeToUtcISO(businessDay, "end");

  const voids = await pagedAllChecked<VoidAuditRow>(async (from, to) => {
    const { data, error } = await admin
      .from("audit_logs")
      .select("id, entity_id, after_json, created_at")
      .eq("action", "register.sale_voided")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) return { rows: [], ok: false };
    return { rows: (data as VoidAuditRow[] | null) ?? [], ok: true };
  });
  // A manager's later assignment of a void (newest wins). Not bounded by the
  // day: an assignment can be made the next morning.
  const voidOrderIds = voids.rows.map((v) => v.entity_id).filter((x): x is string => !!x);
  let assigns: AssignAuditRow[] = [];
  let assignsOk = true;
  if (voidOrderIds.length > 0) {
    const res = await pagedAllChecked<AssignAuditRow>(async (from, to) => {
      const { data, error } = await admin
        .from("audit_logs")
        .select("id, entity_id, after_json, created_at")
        .eq("action", VOID_REFUND_ASSIGNED_ACTION)
        .in("entity_id", voidOrderIds)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) return { rows: [], ok: false };
      return { rows: (data as AssignAuditRow[] | null) ?? [], ok: true };
    });
    assigns = res.rows;
    assignsOk = res.verdict.complete;
  }
  const latestAssign = new Map<string, AssignAuditRow>();
  for (const a of assigns) if (a.entity_id) latestAssign.set(a.entity_id, a); // ordered by id asc -> last wins

  for (const v of voids.rows) {
    const orderId = v.entity_id ?? String(v.id);
    const assigned = latestAssign.get(orderId);
    const attr = voidAttribution(assigned ? assigned.after_json : v.after_json);
    const after = rec(v.after_json);
    out.refunds.push({
      source: "void",
      sourceId: orderId,
      refundMinor: auditRefundMinor(v.after_json),
      paidFrom: attr.paidFrom,
      drawerSessionId: attr.drawerSessionId,
      label: typeof after.receiptNumber === "string" ? `Void · receipt ${after.receiptNumber}` : "Void",
      atIso: v.created_at,
    });
  }

  const readReturns = async (withCols: boolean) =>
    pagedAllChecked<ReturnRow>(async (from, to) => {
      const { data, error } = await admin
        .from("customer_returns")
        .select(
          withCols
            ? "id, refund_minor_units, created_at, refund_paid_from, refund_drawer_session_id"
            : "id, refund_minor_units, created_at",
        )
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        if (withCols && isMissingColumn(error)) throw new MissingColumns();
        return { rows: [], ok: false };
      }
      return { rows: (data as unknown as ReturnRow[] | null) ?? [], ok: true };
    });
  let returns: Awaited<ReturnType<typeof readReturns>>;
  try {
    returns = await readReturns(true);
  } catch (e) {
    if (!(e instanceof MissingColumns)) throw e;
    out.returnsAttributable = false;
    returns = await readReturns(false);
  }
  for (const r of returns.rows) {
    const pf = r.refund_paid_from === "drawer" || r.refund_paid_from === "safe" ? r.refund_paid_from : null;
    out.refunds.push({
      source: "return",
      sourceId: r.id,
      refundMinor: Number(r.refund_minor_units) || 0,
      paidFrom: pf,
      drawerSessionId: pf === "drawer" ? (r.refund_drawer_session_id ?? null) : null,
      label: "Counter return",
      atIso: r.created_at,
    });
  }

  if (!voids.verdict.complete || !assignsOk || !returns.verdict.complete) {
    out.complete = false;
    out.problem = [
      !voids.verdict.complete ? `voids: ${voids.verdict.message}` : null,
      !assignsOk ? "void assignments could not be read" : null,
      !returns.verdict.complete ? `returns: ${returns.verdict.message}` : null,
    ]
      .filter(Boolean)
      .join("; ");
  }
  if (!out.returnsAttributable && out.refunds.some((r) => r.source === "return")) {
    out.problem = out.problem ? `${out.problem}; ${MIGRATION_0313_HINT}` : MIGRATION_0313_HINT;
  }
  return out;
}

class MissingColumns extends Error {}

/** Processed / pending / exception register sales carrying this drawer id. */
async function readSaleEvents(sessionId: string): Promise<{ rows: FigureSaleEvent[]; complete: boolean; problem: string | null }> {
  const admin = createSupabaseAdminClient();
  type Row = { id: string; status: string; event_type: string; payload: unknown };
  const res = await pagedAllChecked<Row>(async (from, to) => {
    const { data, error } = await admin
      .from("pos_sale_events")
      .select("id, status, event_type, payload")
      .eq("event_type", "sale")
      .eq("payload->>drawerSessionId", sessionId)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) return { rows: [], ok: false };
    return { rows: (data as Row[] | null) ?? [], ok: true };
  });
  return {
    rows: res.rows.map((r) => ({ status: r.status, eventType: r.event_type, payload: r.payload })),
    complete: res.verdict.complete,
    problem: res.verdict.complete ? null : `sales: ${res.verdict.message}`,
  };
}

export type LoadedDrawerFigure = {
  session: DrawerSession;
  figure: DrawerFigure;
  returnsAttributable: boolean;
};

/** Build one drawer's figure from the server's records. Null = no session. */
export async function loadDrawerFigure(sessionId: string, preloaded?: DrawerSession | null): Promise<LoadedDrawerFigure | null> {
  if (!isSupabaseServiceConfigured) return null;
  const session = preloaded ?? (await getSession(sessionId));
  if (!session) return null;
  // Every Pacific business day the drawer was open (a late drawer can run
  // past midnight; a refund it paid after midnight belongs to the next day).
  const days = [
    ...new Set(
      [session.business_day, session.opened_at ? businessDayFor(session.opened_at) : null, session.closed_at ? businessDayFor(session.closed_at) : null].filter(
        (d): d is string => !!d,
      ),
    ),
  ].sort();
  const [sales, dayReads, dropsMinor] = await Promise.all([
    readSaleEvents(session.id),
    Promise.all(days.map((d) => readDayRefunds(d))),
    totalDropsMinor(session.id),
  ]);
  const seen = new Set<string>();
  const merged: FigureRefund[] = [];
  for (const d of dayReads) {
    for (const r of d.refunds) {
      const k = `${r.source}:${r.sourceId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(r);
    }
  }
  const refunds = {
    refunds: merged,
    complete: dayReads.every((d) => d.complete),
    problem: dayReads.map((d) => d.problem).filter(Boolean).join("; ") || null,
    returnsAttributable: dayReads.every((d) => d.returnsAttributable),
  };
  const figure = buildDrawerFigure({
    sessionId: session.id,
    openingMinor: session.opening_count_minor,
    closingMinor: session.closing_count_minor,
    dropsMinor,
    saleEvents: sales.rows,
    dayRefunds: refunds.refunds,
    readsComplete: sales.complete && refunds.complete,
    readProblem: [sales.problem, refunds.problem].filter(Boolean).join("; ") || null,
  });
  return { session, figure, returnsAttributable: refunds.returnsAttributable };
}

/** The open drawer of a register, or null (used to tie a register refund). */
export async function openDrawerIdForRegister(registerId: string | null | undefined): Promise<string | null> {
  if (!registerId || !isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("drawer_sessions")
    .select("id")
    .eq("register_id", registerId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) return null;
  return data?.id ?? null;
}

/** Drawers a refund could have been paid from on a business day (for pickers). */
export async function drawersForDay(businessDay: string): Promise<{ id: string; label: string; status: string }[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("drawer_sessions")
    .select("id, status, opened_at, register_id, registers(name)")
    .eq("business_day", businessDay)
    .order("opened_at", { ascending: true })
    .limit(200);
  type Row = { id: string; status: string; opened_at: string | null; registers: { name: string } | { name: string }[] | null };
  return ((data as Row[] | null) ?? []).map((r) => {
    const reg = Array.isArray(r.registers) ? r.registers[0] : r.registers;
    const at = r.opened_at
      ? new Date(r.opened_at).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" })
      : "";
    return { id: r.id, label: `${reg?.name ?? "Register"}${at ? ` · opened ${at}` : ""} (${r.status})`, status: r.status };
  });
}

/**
 * Tie a counter return's cash to a drawer or the safe. Only a return that is
 * not tied yet can be tied (compare-and-set on refund_paid_from IS NULL), so
 * a second click or a second manager never moves a refund silently.
 */
export async function assignReturnRefund(opts: {
  returnId: string;
  paidFrom: "drawer" | "safe";
  drawerSessionId: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  if (opts.paidFrom === "drawer") {
    const s = opts.drawerSessionId ? await getSession(opts.drawerSessionId) : null;
    if (!s) return { ok: false, error: "That drawer was not found." };
    if (s.status === "reconciled" || s.status === "verified") {
      return { ok: false, error: "That drawer is already reconciled, so a refund can no longer be added to it." };
    }
  }
  const { data, error } = await admin
    .from("customer_returns")
    .update({
      refund_paid_from: opts.paidFrom,
      refund_drawer_session_id: opts.paidFrom === "drawer" ? opts.drawerSessionId : null,
    })
    .eq("id", opts.returnId)
    .is("refund_paid_from", null)
    .select("id");
  if (error) return { ok: false, error: isMissingColumn(error) ? MIGRATION_0313_HINT : error.message };
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: "That return is already tied to a drawer or the safe (or it was not found). Reload the page." };
  }
  return { ok: true };
}

/** For a void: the receipt label and whether it is already tied. */
export async function voidRefundState(orderId: string, businessDay: string): Promise<FigureRefund | null> {
  const day = await readDayRefunds(businessDay);
  return day.refunds.find((r) => r.source === "void" && r.sourceId === orderId) ?? null;
}

export { receiptNumber };
