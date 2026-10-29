import "server-only";

/**
 * src/lib/staffing/tips-store.ts  (Fix Phase 2.1c · employee tip tracker)
 *
 * Reads drawer_sessions.tips_minor (migration 0134) plus the time clock for
 * the tip tracker, and owns the one write: a manager's audited correction of
 * one closed session's tip figure. Arithmetic lives in tips-core.ts.
 *
 * Every read is paged with a completeness verdict (rule 46). A short read is
 * a warning on the page, never a silently smaller total.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { businessDayFor } from "@/lib/staffing/time";
import { recordAudit } from "@/lib/auth/audit";
import { buildTipReport, checkTipRange, type TipReport, type TipSessionRow } from "@/lib/staffing/tips-core";

export const TIP_CORRECTED_ACTION = "drawer.tips_corrected";

export type LoadedTipReport = {
  report: TipReport;
  names: Record<string, string>;
  registers: Record<string, string>;
  warnings: string[];
};

function isMissingColumn(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42703" || e.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(e.message ?? "");
}

/**
 * @param onlyEmployeeId  when set (a staff member viewing their own tips),
 *                        only sessions that employee closed are read.
 */
export async function loadTipReport(from: string, to: string, onlyEmployeeId?: string | null): Promise<LoadedTipReport | { error: string }> {
  const range = checkTipRange(from, to);
  if (!range.ok) return { error: range.error };
  if (!isSupabaseServiceConfigured) return { error: "The database is not configured." };
  const admin = createSupabaseAdminClient();
  const warnings: string[] = [];

  type SRow = {
    id: string;
    register_id: string;
    business_day: string;
    status: string;
    opened_by: string | null;
    closed_by: string | null;
    tips_minor: number | null;
    closed_at: string | null;
  };
  let missing0134 = false;
  const res = await pagedAllChecked<SRow>(async (a, b) => {
    let q = admin
      .from("drawer_sessions")
      .select("id, register_id, business_day, status, opened_by, closed_by, tips_minor, closed_at")
      .gte("business_day", from)
      .lte("business_day", to)
      .neq("status", "open");
    if (onlyEmployeeId) q = q.eq("closed_by", onlyEmployeeId);
    const { data, error } = await q.order("id", { ascending: true }).range(a, b);
    if (error) {
      if (isMissingColumn(error)) missing0134 = true;
      return { rows: [], ok: false };
    }
    return { rows: (data as SRow[] | null) ?? [], ok: true };
  });
  if (missing0134) return { error: "Apply migration 0134_drawer_tips.sql first. Until then no tip figure is stored." };
  if (!res.verdict.complete) warnings.push(`Drawer sessions could not all be read (${res.verdict.message}). The totals below are short.`);
  const sessions: TipSessionRow[] = res.rows.map((r) => ({
    sessionId: r.id,
    registerId: r.register_id,
    businessDay: String(r.business_day).slice(0, 10),
    status: r.status,
    openedBy: r.opened_by,
    closedBy: r.closed_by,
    tipsMinor: r.tips_minor,
    closedAt: r.closed_at,
  }));

  // Worked minutes (closed work punches) in the same Pacific range.
  type PRow = { id: string; employee_id: string; minutes: number | null; clock_in_at: string; punch_kind: string };
  const startIso = pacificWallTimeToUtcISO(from, "start");
  const endIso = pacificWallTimeToUtcISO(to, "end");
  const punches = await pagedAllChecked<PRow>(async (a, b) => {
    let q = admin
      .from("time_punches")
      .select("id, employee_id, minutes, clock_in_at, punch_kind")
      .eq("punch_kind", "work")
      .gte("clock_in_at", startIso)
      .lte("clock_in_at", endIso);
    if (onlyEmployeeId) q = q.eq("employee_id", onlyEmployeeId);
    const { data, error } = await q.order("id", { ascending: true }).range(a, b);
    if (error) return { rows: [], ok: false };
    return { rows: (data as PRow[] | null) ?? [], ok: true };
  });
  let worked: Map<string, number> | undefined;
  if (!punches.verdict.complete) {
    warnings.push("The time clock could not all be read, so tips per hour are not shown.");
  } else {
    worked = new Map();
    for (const p of punches.rows) {
      if (typeof p.minutes !== "number" || p.minutes < 0) continue;
      const day = businessDayFor(p.clock_in_at);
      if (day < from || day > to) continue;
      worked.set(p.employee_id, (worked.get(p.employee_id) ?? 0) + p.minutes);
    }
  }

  const report = buildTipReport({ sessions, workedMinutes: worked });

  const names: Record<string, string> = {};
  const ids = [...new Set(sessions.flatMap((s) => [s.closedBy, s.openedBy]).filter((x): x is string => !!x))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from("employees").select("id, full_name").in("id", ids.slice(i, i + 200));
    if (error) warnings.push("Some employee names could not be read; their id is shown instead.");
    for (const row of (data as { id: string; full_name: string }[] | null) ?? []) names[row.id] = row.full_name;
  }
  const registers: Record<string, string> = {};
  const regIds = [...new Set(sessions.map((s) => s.registerId))];
  if (regIds.length > 0) {
    const { data } = await admin.from("registers").select("id, name").in("id", regIds);
    for (const row of (data as { id: string; name: string }[] | null) ?? []) registers[row.id] = row.name;
  }
  return { report, names, registers, warnings };
}

/** The employee record linked to a back-office sign-in (employees.staff_id). */
export async function employeeIdForStaff(staffId: string): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("employees").select("id").eq("staff_id", staffId).limit(1).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * A manager corrects one closed session's tip figure. Compare-and-swap on
 * the old value, so two managers cannot overwrite each other unseen; the
 * before and after are audited with the reason.
 */
export async function correctSessionTips(opts: {
  sessionId: string;
  expectedOld: number | null;
  tipsMinor: number | null;
  reason: string;
  actor: { id: string; email: string };
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  const admin = createSupabaseAdminClient();
  let q = admin.from("drawer_sessions").update({ tips_minor: opts.tipsMinor }).eq("id", opts.sessionId).neq("status", "open");
  q = opts.expectedOld === null ? q.is("tips_minor", null) : q.eq("tips_minor", opts.expectedOld);
  const { data, error } = await q.select("id");
  if (error) return { ok: false, error: isMissingColumn(error) ? "Apply migration 0134_drawer_tips.sql first." : error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "The tip figure changed (or the drawer is open) since this page loaded. Nothing was changed; reload and try again." };
  }
  await recordAudit({
    actorId: opts.actor.id,
    actorEmail: opts.actor.email,
    action: TIP_CORRECTED_ACTION,
    entityType: "drawer_session",
    entityId: opts.sessionId,
    before: { tipsMinor: opts.expectedOld },
    after: { tipsMinor: opts.tipsMinor, reason: opts.reason },
  });
  return { ok: true };
}
