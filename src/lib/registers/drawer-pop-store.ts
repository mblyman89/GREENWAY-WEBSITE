/**
 * src/lib/registers/drawer-pop-store.ts  (owner D129 / D130 / D131 / D132)
 *
 * Reads behind "Open drawer to count" on the iPad close and the clock-out
 * guard. Rules live in drawer-pop-core (pure). No migration: the opens are
 * audit rows (audit_logs, action drawer.popped_for_count, entity the drawer
 * session), and the cashier working a drawer comes from the sales rung on it
 * (pos_sale_events).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { custodianOf, buildPopWarnings, type DrawerSale, type PopEvent, type PopSession, type PopWarning } from "@/lib/registers/drawer-pop-core";

export const POP_AUDIT_ACTION = "drawer.popped_for_count";
/** Sales read per drawer. A drawer rings far fewer in a shift. */
const SALES_READ_CAP = 3000;
const POP_READ_CAP = 1000;

type SessionLike = { id: string; register_id: string; opened_by: string | null; opened_at: string | null; closed_at?: string | null };

/**
 * D129: the cashier working this drawer. When the sales cannot be read the
 * person who counted it in is used (never a guess beyond that).
 */
export async function drawerCustodian(session: SessionLike): Promise<string | null> {
  if (!isSupabaseServiceConfigured || !session.opened_at) return session.opened_by ?? null;
  try {
    const admin = createSupabaseAdminClient();
    let q = admin
      .from("pos_sale_events")
      .select("employee_id, occurred_at")
      .eq("register_id", session.register_id)
      .eq("event_type", "sale")
      .gte("occurred_at", session.opened_at);
    if (session.closed_at) q = q.lte("occurred_at", session.closed_at);
    const { data, error } = await q.order("occurred_at", { ascending: false }).limit(SALES_READ_CAP);
    if (error) return custodianOf({ openedBy: session.opened_by, sales: [] });
    const sales: DrawerSale[] = ((data as { employee_id: string | null; occurred_at: string }[] | null) ?? []).map((r) => ({
      employeeId: r.employee_id,
      atIso: r.occurred_at,
    }));
    return custodianOf({ openedBy: session.opened_by, sales });
  } catch {
    return session.opened_by ?? null;
  }
}

/**
 * D132: the OPEN drawers this employee is working (D129). Read errors return
 * an empty list on purpose, same as D84: nobody is trapped on the clock by a
 * database hiccup.
 */
export async function openDrawersWorkedBy(employeeId: string): Promise<{ sessionId: string; registerName: string }[]> {
  if (!isSupabaseServiceConfigured || !employeeId) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("drawer_sessions")
      .select("id, register_id, opened_by, opened_at")
      .eq("status", "open")
      .limit(20);
    if (error || !data || data.length === 0) return [];
    const rows = data as SessionLike[];
    const mine: SessionLike[] = [];
    for (const r of rows) {
      if ((await drawerCustodian(r)) === employeeId) mine.push(r);
    }
    if (mine.length === 0) return [];
    const { data: regs } = await admin.from("registers").select("id, name").in("id", [...new Set(mine.map((r) => r.register_id))]);
    const names = new Map(((regs as { id: string; name: string }[] | null) ?? []).map((r) => [r.id, r.name]));
    return mine.map((r) => ({ sessionId: r.id, registerName: names.get(r.register_id) ?? "a register" }));
  } catch {
    return [];
  }
}

/**
 * D131: earlier opens-for-count on this drawer. A read error returns null so
 * the route can refuse rather than hand out a free open.
 */
export async function popsForSession(sessionId: string): Promise<number | null> {
  if (!isSupabaseServiceConfigured) return 0;
  const admin = createSupabaseAdminClient();
  const { count, error } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", POP_AUDIT_ACTION)
    .eq("entity_type", "drawer_session")
    .eq("entity_id", sessionId);
  if (error) return null;
  return count ?? 0;
}

export type PopWarningSources = { ok: boolean; warnings: PopWarning[]; pops: number; capped: boolean };

/** D131: owner warnings for opens-for-count since `sinceIso`. */
export async function loadPopWarnings(sinceIso: string, nowIso: string): Promise<PopWarningSources> {
  const out: PopWarningSources = { ok: false, warnings: [], pops: 0, capped: false };
  if (!isSupabaseServiceConfigured) return out;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("audit_logs")
    .select("entity_id, after_json, created_at")
    .eq("action", POP_AUDIT_ACTION)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(POP_READ_CAP);
  if (error) return out;
  const rows = (data as { entity_id: string | null; after_json: Record<string, unknown> | null; created_at: string }[] | null) ?? [];
  out.capped = rows.length >= POP_READ_CAP;
  out.pops = rows.length;
  const pops: PopEvent[] = rows
    .filter((r) => !!r.entity_id)
    .map((r) => ({
      sessionId: r.entity_id as string,
      atIso: r.created_at,
      employeeId: typeof r.after_json?.employeeId === "string" ? (r.after_json.employeeId as string) : null,
      popNumber: Number.isInteger(r.after_json?.popNumber) ? (r.after_json?.popNumber as number) : 1,
      reason: typeof r.after_json?.reason === "string" ? (r.after_json.reason as string) : null,
    }));
  const ids = [...new Set(pops.map((p) => p.sessionId))];
  const sessions = new Map<string, PopSession>();
  if (ids.length > 0) {
    const { data: sess, error: sErr } = await admin
      .from("drawer_sessions")
      .select("id, register_id, business_day, status, closed_at, closed_by")
      .in("id", ids);
    if (sErr) return out;
    const sRows = (sess as { id: string; register_id: string; business_day: string; status: string; closed_at: string | null; closed_by: string | null }[] | null) ?? [];
    const { data: regs } = await admin.from("registers").select("id, name").in("id", [...new Set(sRows.map((r) => r.register_id))]);
    const names = new Map(((regs as { id: string; name: string }[] | null) ?? []).map((r) => [r.id, r.name]));
    for (const r of sRows) {
      sessions.set(r.id, {
        id: r.id,
        registerName: names.get(r.register_id) ?? "Register",
        businessDay: r.business_day,
        status: r.status,
        closedAtIso: r.closed_at,
        closedBy: r.closed_by,
      });
    }
  }
  out.warnings = buildPopWarnings(pops, sessions, nowIso);
  out.ok = true;
  return out;
}
