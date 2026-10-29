import "server-only";

/**
 * src/lib/registers/cashier-report-store.ts  (Fix Phase 2.1b · G-05 · F-01-10)
 *
 * Reads the records behind the per-cashier shift summary and hands them to
 * the pure core (cashier-report-core.ts). Nothing here does arithmetic.
 *
 * Every read is paged with a completeness verdict (pagedAllChecked). A failed
 * page is never treated as "no more rows" (rule 46): it becomes a warning the
 * page shows above the figures, so a short report never looks complete.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { businessDayFor } from "@/lib/staffing/time";
import { readDayRefunds } from "@/lib/registers/drawer-figure-store";
import {
  buildCashierReport,
  checkCashierRange,
  type CashierAdjustmentRow,
  type CashierEventRow,
  type CashierRefundRow,
  type CashierReport,
} from "@/lib/registers/cashier-report-core";

export type LoadedCashierReport = {
  report: CashierReport;
  /** employee id → name (inactive employees too: old shifts keep their name). */
  names: Record<string, string>;
  /** register id → name. */
  registers: Record<string, string>;
  /** Every read that came back short. Empty = the figures are complete. */
  warnings: string[];
};

/** Every Pacific day from..to inclusive (the range was already checked). */
export function daysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  let t = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  while (t <= end && out.length < 400) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

const CHUNK = 200;
function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

export async function loadCashierReport(from: string, to: string): Promise<LoadedCashierReport | { error: string }> {
  const range = checkCashierRange(from, to);
  if (!range.ok) return { error: range.error };
  if (!isSupabaseServiceConfigured) return { error: "The database is not configured." };
  const admin = createSupabaseAdminClient();
  const warnings: string[] = [];
  const startIso = pacificWallTimeToUtcISO(from, "start");
  const endIso = pacificWallTimeToUtcISO(to, "end");

  // 1) Register events: sales + no-sales, every status (exceptions and
  //    pending are counted, never summed as money).
  type EvRow = {
    id: string;
    employee_id: string;
    register_id: string | null;
    event_type: string;
    status: string;
    order_id: string | null;
    occurred_at: string;
    payload: unknown;
  };
  const ev = await pagedAllChecked<EvRow>(async (a, b) => {
    const { data, error } = await admin
      .from("pos_sale_events")
      .select("id, employee_id, register_id, event_type, status, order_id, occurred_at, payload")
      .in("event_type", ["sale", "no_sale"])
      .gte("occurred_at", startIso)
      .lte("occurred_at", endIso)
      .order("id", { ascending: true })
      .range(a, b);
    if (error) return { rows: [], ok: false };
    return { rows: (data as EvRow[] | null) ?? [], ok: true };
  });
  if (!ev.verdict.complete) warnings.push(`Register sales could not all be read (${ev.verdict.message}). The figures below are short.`);
  const events: CashierEventRow[] = ev.rows.map((r) => ({
    employeeId: r.employee_id,
    registerId: r.register_id,
    eventType: r.event_type,
    status: r.status,
    businessDay: businessDayFor(r.occurred_at),
    orderId: r.order_id,
    payload: r.payload,
  }));

  // 2) Cart adjustments (lines taken off before payment).
  type AdjRow = {
    id: string;
    employee_id: string | null;
    action: string;
    units_removed: number | null;
    value_minor: number | null;
    occurred_at: string;
  };
  const adj = await pagedAllChecked<AdjRow>(async (a, b) => {
    const { data, error } = await admin
      .from("pos_cart_adjustments")
      .select("id, employee_id, action, units_removed, value_minor, occurred_at")
      .gte("occurred_at", startIso)
      .lte("occurred_at", endIso)
      .order("id", { ascending: true })
      .range(a, b);
    if (error) return { rows: [], ok: false };
    return { rows: (data as AdjRow[] | null) ?? [], ok: true };
  });
  if (!adj.verdict.complete) warnings.push(`Cart adjustments could not all be read (${adj.verdict.message}).`);
  const adjustments: CashierAdjustmentRow[] = adj.rows.map((r) => ({
    employeeId: r.employee_id,
    businessDay: businessDayFor(r.occurred_at),
    action: r.action,
    unitsRemoved: Number(r.units_removed) || 0,
    valueMinor: Number(r.value_minor) || 0,
  }));

  // 3) Refunds, day by day, with the SAME reader the drawer figure uses.
  const refunds: CashierRefundRow[] = [];
  const returnIds: string[] = [];
  const pendingReturns: { id: string; day: string; minor: number; label: string }[] = [];
  for (const day of daysInRange(from, to)) {
    const read = await readDayRefunds(day);
    if (!read.complete) warnings.push(`Refunds for ${day} could not all be read (${read.problem ?? "read failed"}).`);
    for (const r of read.refunds) {
      if (r.source === "void") {
        refunds.push({ source: "void", orderId: r.sourceId, businessDay: day, refundMinor: r.refundMinor, label: r.label ?? "Void" });
      } else {
        returnIds.push(r.sourceId);
        pendingReturns.push({ id: r.sourceId, day, minor: r.refundMinor, label: r.label ?? "Counter return" });
      }
    }
  }
  // A return names its sale through customer_returns.order_id.
  const returnOrder = new Map<string, string | null>();
  for (const part of chunks(returnIds)) {
    const { data, error } = await admin.from("customer_returns").select("id, order_id").in("id", part);
    if (error) {
      warnings.push("Some returns could not be matched to their sale, so they are listed as not traced.");
      continue;
    }
    for (const row of (data as { id: string; order_id: string | null }[] | null) ?? []) returnOrder.set(row.id, row.order_id);
  }
  for (const p of pendingReturns) {
    refunds.push({ source: "return", orderId: returnOrder.get(p.id) ?? null, businessDay: p.day, refundMinor: p.minor, label: p.label });
  }

  // 4) Refunds of sales rung BEFORE the range: find who rang them.
  const inRange = new Set(events.filter((e) => e.eventType === "sale" && e.orderId).map((e) => e.orderId as string));
  const missing = [...new Set(refunds.map((r) => r.orderId).filter((x): x is string => !!x && !inRange.has(x)))];
  const extraSaleCashiers = new Map<string, string>();
  for (const part of chunks(missing)) {
    const { data, error } = await admin
      .from("pos_sale_events")
      .select("order_id, employee_id")
      .eq("event_type", "sale")
      .in("order_id", part);
    if (error) {
      warnings.push("Some older sales could not be traced to their cashier, so their refunds are listed as not traced.");
      continue;
    }
    for (const row of (data as { order_id: string | null; employee_id: string }[] | null) ?? []) {
      if (row.order_id) extraSaleCashiers.set(row.order_id, row.employee_id);
    }
  }

  const report = buildCashierReport({ events, adjustments, refunds, extraSaleCashiers });

  // 5) Names (inactive employees included so an old shift keeps its name).
  const names: Record<string, string> = {};
  const empIds = [...new Set([...report.cashiers.map((c) => c.employeeId), ...report.cashiers.flatMap((c) => c.noSales.map((n) => n.approvedByEmployeeId ?? ""))].filter(Boolean))];
  for (const part of chunks(empIds)) {
    const { data, error } = await admin.from("employees").select("id, full_name").in("id", part);
    if (error) warnings.push("Some employee names could not be read; their id is shown instead.");
    for (const row of (data as { id: string; full_name: string }[] | null) ?? []) names[row.id] = row.full_name;
  }
  const registers: Record<string, string> = {};
  const regIds = [...new Set(report.cashiers.flatMap((c) => c.registerIds))];
  if (regIds.length > 0) {
    const { data } = await admin.from("registers").select("id, name").in("id", regIds);
    for (const row of (data as { id: string; name: string }[] | null) ?? []) registers[row.id] = row.name;
  }
  return { report, names, registers, warnings };
}
