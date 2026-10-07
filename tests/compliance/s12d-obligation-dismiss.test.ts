/**
 * S-12d (CCRS Bible v2): first day of sales + dismiss with a reason.
 *
 * Why this matters: the owner gets nagged about weeks/months his integrator
 * (Cultivera) filed, so real deadlines drown in noise. These tests pin:
 *   1. The owner's scenario with the real dates: first day of sales
 *      2026-11-01 (a Sunday). The backlog goes quiet; the first real week
 *      and the first real LIQ-1295 still nag.
 *   2. The legal floor: a LIQ-1295 month is required "even if they have no
 *      sales", so a month before the start date only goes quiet AFTER its
 *      due date. Nothing ever silences a period that has not ended.
 *   3. Every nag surface takes the same context: reminder cron (weekly +
 *      monthly), CCRS page, compliance calendar + dashboard count, Compliance
 *      Health, the classic compliance report.
 *   4. TS <-> SQL parity with migration 0250 (obligations, reason bounds,
 *      key shapes) and 0250 hygiene (no delete, undo once, RLS, KEEP on
 *      factory reset, rollback refuses with rows).
 *   5. Fails safe: an unreadable context is EMPTY (nags as before).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMPTY_CONTEXT,
  REASON_MAX,
  REASON_MIN,
  WAIVABLE_OBLIGATIONS,
  buildContext,
  validateDismissal,
  validateReason,
  validateStartDate,
  type ObligationContext,
} from "@/lib/compliance/obligation-waiver-core";
import {
  planWeeklyReminders,
  weekDeadline,
  weekFromKey,
  weeklyDeadlineOverview,
} from "@/lib/compliance/ccrs-week-core";
import {
  isSettled,
  periodDeadline,
  planMonthlyReminders,
  reportingDeadlineOverview,
} from "@/lib/compliance/ccrs-deadline-core";
import { evaluateCalendar, overdueCount } from "@/lib/compliance/compliance-calendar-core";
import { buildComplianceHealth } from "@/lib/compliance/compliance-health-core";
import { classifyTable } from "@/lib/accounting/factory-reset-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const START = "2026-11-01";
const ctxStart: ObligationContext = { startDate: START, waivers: new Map() };
const d = (iso: string) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });

describe("the owner's dates (verified)", () => {
  it("2026-11-01 is a Sunday, so it is the first day of a CCRS week", () => {
    expect(new Date(`${START}T12:00:00Z`).getUTCDay()).toBe(0);
    expect(weekFromKey("W-2026-11-01")?.end).toBe("2026-11-07");
  });
});

describe("weekly: the backlog goes quiet, the first real week does not", () => {
  it("every completed week before the start is before_start; no overdue", () => {
    const o = weeklyDeadlineOverview("2026-10-07", {}, { lookbackWeeks: 6, ctx: ctxStart });
    expect(o.weeks.every((w) => w.status === "before_start")).toBe(true);
    expect(o.overdueCount).toBe(0);
    expect(o.mostUrgent).toBeNull();
    expect(o.beforeStartCount).toBe(6);
    const raw = weeklyDeadlineOverview("2026-10-07", {}, { lookbackWeeks: 6 });
    expect(raw.overdueCount).toBeGreaterThan(0); // control: without a start date it nags
  });
  it("no weekly reminders of any stage before the first day of sales", () => {
    for (let day = 1; day <= 31; day += 1) {
      const iso = `2026-10-${String(day).padStart(2, "0")}`;
      expect(planWeeklyReminders(iso, {}, { lookbackWeeks: 4, ctx: ctxStart })).toEqual([]);
    }
  });
  it("the first real week (Nov 1-7) gets Thursday, Saturday, Sunday-due and overdue reminders", () => {
    const stages = (iso: string) => planWeeklyReminders(iso, {}, { lookbackWeeks: 4, ctx: ctxStart }).map((r) => r.stage);
    expect(stages("2026-11-05")).toContain("thursday_heads_up");
    expect(stages("2026-11-07")).toContain("saturday_wrap");
    expect(stages("2026-11-08")).toContain("sunday_due");
    expect(stages("2026-11-09")).toContain("overdue_daily");
  });
  it("a week that ENDS on the first day of sales still nags (it holds a sales day)", () => {
    const ctxSat: ObligationContext = { startDate: "2026-11-07", waivers: new Map() };
    const o = weeklyDeadlineOverview("2026-11-09", {}, { lookbackWeeks: 2, ctx: ctxSat });
    expect(o.weeks.find((w) => w.week.key === "W-2026-11-01")!.status).toBe("overdue");
    expect(o.weeks.find((w) => w.week.key === "W-2026-10-25")!.status).toBe("before_start");
  });
  it("a recorded week always wins (the ledger is the truth)", () => {
    const wk = weekFromKey("W-2026-10-04")!;
    expect(weekDeadline(wk, "2026-10-20", "submitted", ctxStart).status).toBe("submitted");
  });
});

describe("monthly LIQ-1295: legal floor kept", () => {
  it("October 2026 (before start) still reminds until its due date, then goes quiet", () => {
    const p = { year: 2026, month: 10 };
    const due = periodDeadline(p, "2026-11-20", false, { ctx: ctxStart });
    expect(["due_today", "due_soon"]).toContain(due.status);
    expect(periodDeadline(p, "2026-11-30", false, { ctx: ctxStart }).status).toBe("before_start");
  });
  it("November 2026 (first sales month) is overdue the day after its due date", () => {
    const o = reportingDeadlineOverview("2026-12-22", new Set(), { lookbackMonths: 3, ctx: ctxStart });
    const nov = o.periods.find((x) => x.period.month === 11)!;
    expect(nov.status).toBe("overdue");
    expect(planMonthlyReminders("2026-12-22", o.periods).some((r) => r.periodKey === "2026-11")).toBe(true);
  });
  it("settled statuses never produce reminders", () => {
    expect(isSettled("before_start") && isSettled("dismissed") && isSettled("filed")).toBe(true);
  });
});

describe("dismiss with a reason", () => {
  const ctxDismiss = buildContext(null, [
    { id: "a", obligation: "ccrs_weekly", period_key: "W-2026-09-27", reason: "Filed by Cultivera", waived_at: "2026-10-07T17:00:00Z", waived_by_email: "m@x" },
    { id: "b", obligation: "liq1295", period_key: "2026-08", reason: "Filed on PayStation 09-18", waived_at: "t", waived_by_email: "m@x" },
    { id: "c", obligation: "ccrs_weekly", period_key: "W-2026-09-20", reason: "Undone one", revoked_at: "t" },
  ]);
  it("a dismissed week is quiet and carries its reason; an undone one nags again", () => {
    const o = weeklyDeadlineOverview("2026-10-07", {}, { lookbackWeeks: 4, ctx: ctxDismiss });
    const w27 = o.weeks.find((w) => w.week.key === "W-2026-09-27")!;
    expect(w27.status).toBe("dismissed");
    expect(w27.waiver?.reason).toBe("Filed by Cultivera");
    expect(w27.waiver?.id).toBe("a");
    expect(o.weeks.find((w) => w.week.key === "W-2026-09-20")!.status).toBe("overdue");
    expect(o.dismissedCount).toBe(1);
  });
  it("a dismissed month is quiet", () => {
    const o = reportingDeadlineOverview("2026-10-07", new Set(), { lookbackMonths: 3, ctx: ctxDismiss });
    expect(o.periods.find((x) => x.period.month === 8)!.status).toBe("dismissed");
    expect(planMonthlyReminders("2026-10-07", o.periods).some((r) => r.periodKey === "2026-08")).toBe(false);
  });
  it("the app refuses to dismiss a period that has not ended", () => {
    expect(validateDismissal("ccrs_weekly", "W-2026-10-04", "2026-10-10").ok).toBe(false); // Saturday itself
    expect(validateDismissal("ccrs_weekly", "W-2026-10-04", "2026-10-11").ok).toBe(true);
    expect(validateDismissal("liq1295", "2026-10", "2026-10-31").ok).toBe(false);
    expect(validateDismissal("liq1295", "2026-10", "2026-11-01").ok).toBe(true);
    expect(validateDismissal("ccrs_weekly", "W-2026-10-05", "2026-12-01").ok).toBe(false); // Monday
    expect(validateDismissal("dor_excise", "2026-10", "2026-12-01").ok).toBe(false);
  });
  it("reason and start-date validation", () => {
    expect(validateReason("   short   ").ok).toBe(false);
    expect(validateReason("x".repeat(REASON_MIN)).ok).toBe(true);
    expect(validateReason("x".repeat(REASON_MAX + 1)).ok).toBe(false);
    expect(validateStartDate("2026-11-01", "2026-10-07")).toEqual({ ok: true, value: "2026-11-01" });
    expect(validateStartDate("", "2026-10-07")).toEqual({ ok: true, value: "" });
    expect(validateStartDate("2026-02-30", "2026-10-07").ok).toBe(false);
    expect(validateStartDate("2029-01-01", "2026-10-07").ok).toBe(false);
    expect(validateStartDate("2019-12-31", "2026-10-07").ok).toBe(false); // before START_MIN
    expect(validateStartDate("2020-01-01", "2026-10-07").ok).toBe(true); // START_MIN itself
  });
});

describe("compliance calendar + dashboard count honour the context", () => {
  it("before the start date the State-reporting tasks are not overdue", () => {
    // Monday 10-26: the week Oct 18-24 was due Sunday 10-25; Sep LIQ-1295 was due 10-20.
    const raw = evaluateCalendar(d("2026-10-26"), {});
    const quiet = evaluateCalendar(d("2026-10-26"), {}, ctxStart);
    const st = (e: typeof raw, id: string) => e.find((x) => x.task.id === id)!.status;
    expect(st(raw, "liq1295")).toBe("overdue");
    expect(st(raw, "ccrs_weekly")).toBe("overdue");
    expect(st(quiet, "liq1295")).toBe("before_start");
    expect(st(quiet, "ccrs_weekly")).toBe("before_start");
    expect(overdueCount(quiet)).toBe(overdueCount(raw) - 2);
  });
  it("the other calendar tasks are NOT affected (CCTV, scale, badge log)", () => {
    const raw = evaluateCalendar(d("2026-12-31"), {});
    const quiet = evaluateCalendar(d("2026-12-31"), {}, ctxStart);
    for (const id of ["cctv_retention", "scale_calibration", "badge_visitor_log"]) {
      expect(quiet.find((x) => x.task.id === id)!.status).toBe(raw.find((x) => x.task.id === id)!.status);
    }
  });
  it("a stray waiver keyed to a non-State task is ignored by the calendar", () => {
    const today = d("2026-12-31");
    const raw = evaluateCalendar(today, {});
    const waivers = new Map<string, { obligation: "liq1295"; periodKey: string; reason: string; waivedAt: string; waivedByEmail: null }>();
    for (const e of raw) {
      if (e.task.id === "liq1295" || e.task.id === "ccrs_weekly") continue;
      waivers.set(`${e.task.id}:${e.period.periodKey}`, { obligation: "liq1295", periodKey: e.period.periodKey, reason: "should be ignored", waivedAt: "t", waivedByEmail: null });
    }
    expect(waivers.size).toBe(3);
    const withStray = evaluateCalendar(today, {}, { startDate: null, waivers } as unknown as ObligationContext);
    for (const id of ["cctv_retention", "scale_calibration", "badge_visitor_log"]) {
      const e = withStray.find((x) => x.task.id === id)!;
      expect(e.status).toBe(raw.find((x) => x.task.id === id)!.status);
      expect(e.waiver).toBeNull();
    }
  });
  it("a dismissal on the CCRS page shows on the calendar with its reason", () => {
    const ctx = buildContext(null, [{ id: "z", obligation: "liq1295", period_key: "2026-09", reason: "Filed by Cultivera", waived_at: "t" }]);
    const e = evaluateCalendar(d("2026-10-25"), {}, ctx).find((x) => x.task.id === "liq1295")!;
    expect(e.status).toBe("dismissed");
    expect(e.waiver?.reason).toBe("Filed by Cultivera");
  });
  it("the first real week is overdue on the calendar the Monday after", () => {
    const e = evaluateCalendar(d("2026-11-09"), {}, ctxStart).find((x) => x.task.id === "ccrs_weekly")!;
    expect(e.period.periodKey).toBe("W-2026-11-01");
    expect(e.status).toBe("overdue");
  });
  it("the LIQ-1295 for October (due Nov 20) still shows due on the calendar Nov 10", () => {
    const e = evaluateCalendar(d("2026-11-10"), {}, ctxStart).find((x) => x.task.id === "liq1295")!;
    expect(e.status).toBe("due");
  });
});

describe("Compliance Health weekly cadence", () => {
  it("before the first day of sales the 'never exported' warning is ok", () => {
    const r = buildComplianceHealth({ ccrsBatch: { available: true, daysSinceLastExport: null, weeklyWindowDays: 7, salesStartDate: START } });
    expect(r.checks.find((c) => c.key === "ccrs_batch")?.level).toBe("ok");
    const raw = buildComplianceHealth({ ccrsBatch: { available: true, daysSinceLastExport: null, weeklyWindowDays: 7 } });
    expect(raw.checks.find((c) => c.key === "ccrs_batch")?.level).toBe("warning");
  });
  it("the reader only sets salesStartDate while today is BEFORE it", () => {
    const src = read("src/lib/compliance/compliance-health.ts");
    expect(src).toMatch(/obligationCtx\.startDate && todayIso < obligationCtx\.startDate/);
  });
});

describe("wiring: every nag surface reads the same context", () => {
  it("reminder cron passes ctx to BOTH planners", () => {
    const src = read("src/lib/notifications/compliance-reminders.ts");
    expect(src).toMatch(/const obligationCtx = await getObligationContext\(\)/);
    expect(src).toMatch(/planWeeklyReminders\(todayIso, resolutions, \{ lookbackWeeks: 4, ctx: obligationCtx \}\)/);
    expect(src).toMatch(/getCcrsFilingOverview\(todayIso, \{ lookbackMonths: 3, ctx: obligationCtx \}\)/);
  });
  it("store readers load it when the caller does not pass one", () => {
    expect(read("src/lib/compliance/ccrs-filing-status.ts")).toMatch(/opts\?\.ctx \?\? \(await getObligationContext\(\)\)/);
    expect(read("src/lib/compliance/ccrs-week-store.ts")).toMatch(/weeklyDeadlineOverview\(pacificToday\(\), resolutions, \{ lookbackWeeks, ctx \}\)/);
    expect(read("src/lib/compliance/compliance-calendar-store.ts")).toMatch(/evaluateCalendar\(todayPacific\(\), doneMap, ctx\)/);
  });
  it("the store fails SAFE to the empty context", () => {
    const src = read("src/lib/compliance/obligation-waiver-store.ts");
    expect(src).toMatch(/if \(!isSupabaseServiceConfigured\) return EMPTY_CONTEXT;/);
    expect(src).toMatch(/catch \{\n\s+return EMPTY_CONTEXT;/);
    expect(src).toMatch(/pagedAllChecked/);
    expect(src).not.toMatch(/\.limit\(\s*[1-9]\d{3,}/);
    expect(EMPTY_CONTEXT.startDate).toBeNull();
    expect(EMPTY_CONTEXT.waivers.size).toBe(0);
  });
  it("every action is settings.manage + audited, and revalidates every nag page", () => {
    const src = read("src/app/admin/compliance/ccrs/actions.ts");
    const s12d = src.slice(src.indexOf("// ── S-12d"));
    for (const fn of ["setObligationStartAction", "dismissPeriodAction", "undoDismissalAction"]) {
      const body = s12d.slice(s12d.indexOf(`export async function ${fn}`));
      const one = body.slice(0, body.indexOf("\n}\n") + 2);
      expect(one).toMatch(/requirePermission\("settings\.manage"\)/);
      expect(one).toMatch(/recordAudit\(/);
      expect(one).toMatch(/revalidateNagSurfaces\(\)/);
    }
    for (const p of ["/admin/compliance/calendar", "/admin/compliance/health", "/admin/reports/compliance", '"/admin"']) {
      expect(s12d).toContain(p);
    }
  });
  it("the CCRS page labels both new week statuses and offers dismiss + undo", () => {
    const src = read("src/app/admin/compliance/ccrs/page.tsx");
    expect(src).toMatch(/before_start: \{ label: "Before sales start"/);
    expect(src).toMatch(/dismissed: \{ label: "Dismissed"/);
    expect(src).toMatch(/action=\{dismissPeriodAction\}/);
    expect(src).toMatch(/action=\{undoDismissalAction\}/);
    expect(src).toMatch(/action=\{setObligationStartAction\}/);
    expect(src).toMatch(/defaultValue=\{obligationCtx\.startDate \?\? "2026-11-01"\}/);
  });
  it("the calendar page labels both new statuses", () => {
    const src = read("src/app/admin/compliance/calendar/page.tsx");
    expect(src).toMatch(/entry\.status === "before_start"/);
    expect(src).toMatch(/entry\.status === "dismissed"/);
  });
});

describe("TS <-> SQL parity and 0250 hygiene", () => {
  const sql = read("supabase/migrations/0250_obligation_waivers.sql");
  const rb = read("supabase/rollbacks/0250_obligation_waivers.rollback.sql");
  it("same obligations", () => {
    const m = /check \(obligation in \(([^)]*)\)\)/.exec(sql)!;
    const list = m[1].split(",").map((x) => x.trim().replace(/'/g, ""));
    expect(list).toEqual([...WAIVABLE_OBLIGATIONS]);
  });
  it("same reason bounds", () => {
    expect(sql).toContain(`check (char_length(btrim(reason)) between ${REASON_MIN} and ${REASON_MAX})`);
  });
  it("never deleted, undo once, one live per period", () => {
    expect(sql).toMatch(/before update or delete on public\.obligation_waivers/);
    expect(sql).toContain("WAIVER_PERMANENT");
    expect(sql).toContain("WAIVER_ALREADY_UNDONE");
    expect(sql).toMatch(/create unique index if not exists obligation_waivers_one_live\s+on public\.obligation_waivers \(obligation, period_key\)\s+where revoked_at is null;/);
  });
  it("RLS staff read / admin write; no grants to anon or authenticated", () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/for select using \(public\.is_staff\(\)\)/);
    expect(sql).toMatch(/for all using \(public\.is_admin\(\)\) with check \(public\.is_admin\(\)\)/);
    expect(sql).not.toMatch(/to (anon|authenticated|public)\b/);
    expect(sql).not.toMatch(/security definer/);
  });
  it("factory reset KEEPs it", () => {
    const c = classifyTable("obligation_waivers");
    expect(c?.disposition).toBe("KEEP");
    expect(c?.source).toBe("table");
  });
  it("rollback refuses when rows exist and drops every object it created", () => {
    expect(rb).toContain("ROLLBACK_REFUSED");
    expect(rb).toMatch(/drop table if exists public\.obligation_waivers;/);
    expect(rb).toMatch(/drop function if exists public\.obligation_waivers_guard\(\);/);
    expect(rb).toMatch(/drop function if exists public\.obligation_waivers_is_sunday\(text\);/);
  });
});
