/**
 * tests/compliance/d211-lunch-other-breaks.test.ts   (D211 - clock out for lunch / other)
 *
 * Owner (2026-11-07, verbatim): "My employees told me they cannot clock out for a lunch break.
 * The logic currently requires them to close their drawer first. There needs to be an option to
 * clock out for lunch, or, for an “other” reason. This new feature needs to be connected to all
 * places in the back office."
 *
 * Pinned here:
 *   1. The pure rules (reasons, Other needs a note, the clock state machine, meal-break checks).
 *   2. A break skips the D84 drawer guard; a full clock-out keeps it.
 *   3. Migration 0348 is idempotent with a pg-check and a rollback.
 *   4. Every surface is wired: register, back-office and phone clock, Hours, employee report
 *      (and the business_day bug fix), export, timesheets, night watch, register oversight,
 *      cockpit, employee file, SOP-01/SOP-08, help, concierge, handbook.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  __runBreakClockCoreTests,
  BREAK_FLAG_TEXT,
  clockStateOf,
  clockedBannerText,
  dayBreakFlags,
  decideClockAction,
  parseBreakRequest,
  summarizeBreaks,
  isLongOpenBreak,
  type BreakPunch,
} from "@/lib/staffing/break-clock-core";
import { __runNightWatchTests } from "@/lib/registers/night-watch-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("D211 pure rules", () => {
  it("break-clock-core self-tests all pass", () => {
    const r = __runBreakClockCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(45);
  });

  it("night-watch self-tests (with the open-break item) all pass", () => {
    expect(__runNightWatchTests().failed).toBe(0);
  });

  it("Lunch needs no note, Other needs a reason", () => {
    expect(parseBreakRequest("lunch", "")).toEqual({ ok: true, value: { reason: "lunch", note: null } });
    expect(parseBreakRequest("other", "").ok).toBe(false);
    expect(parseBreakRequest("other", "doctor call")).toEqual({ ok: true, value: { reason: "other", note: "doctor call" } });
    expect(parseBreakRequest("smoke", "x").ok).toBe(false);
    expect(parseBreakRequest("other", "x".repeat(201)).ok).toBe(false);
  });

  it("the state machine: a break only from working; out from a break is refused", () => {
    expect(clockStateOf(null)).toBe("off");
    expect(clockStateOf({ punch_kind: "work" })).toBe("working");
    expect(clockStateOf({ punch_kind: "break" })).toBe("on_break");
    expect(decideClockAction("break", "working").kind).toBe("start_break");
    expect(decideClockAction("break", "off").kind).toBe("refuse");
    expect(decideClockAction("out", "on_break").kind).toBe("refuse");
    expect(decideClockAction("back", "on_break").kind).toBe("end_break");
    expect(decideClockAction("in", "on_break").kind).toBe("end_break");
    expect(decideClockAction(null, "on_break").kind).toBe("end_break");
    expect(decideClockAction(null, "working").kind).toBe("clock_out");
  });

  it("banner words for every action", () => {
    expect(clockedBannerText("break_start", "Ana")).toContain("out on a break");
    expect(clockedBannerText("break_end", "Ana")).toContain("back from break");
    expect(clockedBannerText("in", "Ana")).toContain("clocked IN");
  });

  it("meal-break checks: 6h with no lunch, short lunch, open break", () => {
    const e = "e1";
    const noLunch: BreakPunch[] = [
      { employeeId: e, kind: "work", reason: null, clockInIso: "2026-11-07T16:00:00Z", clockOutIso: "2026-11-07T22:00:00Z" },
    ];
    expect(dayBreakFlags(noLunch).map((f) => f.code)).toContain("NO_MEAL_AFTER_5H");

    const shortLunch: BreakPunch[] = [
      { employeeId: e, kind: "work", reason: null, clockInIso: "2026-11-07T16:00:00Z", clockOutIso: "2026-11-07T19:00:00Z" },
      { employeeId: e, kind: "break", reason: "lunch", clockInIso: "2026-11-07T19:00:00Z", clockOutIso: "2026-11-07T19:15:00Z" },
      { employeeId: e, kind: "work", reason: null, clockInIso: "2026-11-07T19:15:00Z", clockOutIso: "2026-11-07T22:00:00Z" },
    ];
    const codes = dayBreakFlags(shortLunch).map((f) => f.code);
    expect(codes).toContain("MEAL_UNDER_30");
    // a 15-minute "lunch" is not a meal period, so the 5-hours-in-a-row check still fires
    expect(codes).toContain("NO_MEAL_AFTER_5H");

    const goodDay: BreakPunch[] = [
      { employeeId: e, kind: "work", reason: null, clockInIso: "2026-11-07T16:00:00Z", clockOutIso: "2026-11-07T19:00:00Z" },
      { employeeId: e, kind: "break", reason: "lunch", clockInIso: "2026-11-07T19:00:00Z", clockOutIso: "2026-11-07T19:30:00Z" },
      { employeeId: e, kind: "work", reason: null, clockInIso: "2026-11-07T19:30:00Z", clockOutIso: "2026-11-08T00:00:00Z" },
    ];
    expect(dayBreakFlags(goodDay)).toEqual([]);

    const open: BreakPunch[] = [
      { employeeId: e, kind: "break", reason: "other", clockInIso: "2026-11-07T19:00:00Z", clockOutIso: null },
    ];
    expect(dayBreakFlags(open).map((f) => f.code)).toContain("OPEN_BREAK");
    expect(BREAK_FLAG_TEXT.NO_MEAL_AFTER_5H.rule).toContain("WAC 296-126-092");
  });

  it("summaries split lunch and other minutes", () => {
    const m = summarizeBreaks([
      { employeeId: "a", kind: "break", reason: "lunch", clockInIso: "2026-11-07T19:00:00Z", clockOutIso: "2026-11-07T19:30:00Z" },
      { employeeId: "a", kind: "break", reason: "other", clockInIso: "2026-11-07T20:00:00Z", clockOutIso: "2026-11-07T20:10:00Z" },
    ]);
    const a = m.get("a")!;
    expect(a.lunchMinutes).toBe(30);
    expect(a.otherMinutes).toBe(10);
  });

  it("a long open break is 3 hours or more", () => {
    expect(isLongOpenBreak("2026-11-07T10:00:00Z", "2026-11-07T13:30:00Z")).toBe(true);
    expect(isLongOpenBreak("2026-11-07T10:00:00Z", "2026-11-07T11:00:00Z")).toBe(false);
  });
});

describe("D211 migration 0348", () => {
  const up = read("supabase/migrations/0348_time_punch_breaks.sql");
  it("is idempotent and constrained", () => {
    expect(up).toContain("add column if not exists break_reason text");
    expect(up).toContain("add column if not exists break_note text");
    expect(up).toContain("time_punches_break_reason_values");
    expect(up).toContain("time_punches_break_shape");
    expect(up).toMatch(/if not exists \(select 1 from pg_constraint/);
  });
  it("has a rollback and a pg-check, and is registered", () => {
    expect(existsSync(join(ROOT, "supabase/rollbacks/0348_time_punch_breaks.rollback.sql"))).toBe(true);
    expect(existsSync(join(ROOT, "scripts/recon/time-punch-breaks-0348-pg-check.sql"))).toBe(true);
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain("0348");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("supabase/migrations/0348_time_punch_breaks.sql");
  });
});

describe("D211 the drawer guard", () => {
  const store = read("src/lib/staffing/store.ts");
  it("startBreak never checks open drawers; toggleClock still does", () => {
    const start = store.indexOf("export async function startBreak");
    const end = store.indexOf("export async function endBreak");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = store.slice(start, end);
    expect(body).not.toContain("openDrawersOwnedBy");
    expect(body).not.toContain("clockOutBlocked");
    expect(body).toContain('punch_kind: "break"');
    const toggle = store.slice(store.indexOf("export async function toggleClock"));
    expect(toggle).toContain("clockOutBlocked({ isClockOut: true");
  });
  it("openWorkPunch stays work-only for sale and approver checks", () => {
    expect(store).toContain("export async function openPunchAny");
    expect(store).toContain("export async function onBreakNow");
  });
});

describe("D211 wiring", () => {
  it("register: API intents, modal, MORE item, back from break", () => {
    const route = read("src/app/api/pos/clock/route.ts");
    expect(route).toContain('body.intent === "break"');
    expect(route).toContain('body.intent === "back"');
    expect(read("src/app/(site)/pos/RegisterBreakModal.tsx")).toContain("Start break");
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).toContain("Clock out for a break (lunch / other)");
    expect(shell).toContain("Back from break");
    expect(read("src/app/api/pos/unlock/route.ts")).toContain("onBreak");
  });
  it("back office: time clock, phone clock, Hours", () => {
    expect(read("src/app/admin/staffing/actions.ts")).toContain("startBreak");
    expect(read("src/components/admin/staffing/BreakReasonFields.tsx")).toContain('name="break_reason"');
    expect(read("src/app/admin/staffing/page.tsx")).toContain("On break now (off the clock)");
    expect(read("src/app/admin/staffing/clock/page.tsx")).toContain("breakOption");
    expect(read("src/components/admin/staffing/PhonePinPad.tsx")).toContain("Going on a break?");
    expect(read("src/app/admin/staffing/hours/page.tsx")).toContain("dayBreakFlags");
  });
  it("employee report reads punches by clock_in_at (the business_day bug is fixed)", () => {
    const ops = read("src/lib/reports/operations.ts");
    expect(ops).toContain("async function reportPunches(");
    expect(ops).toContain("pacificDayKey(p.clock_in_at)");
    expect(ops).toContain("lunchMinutes");
    expect(ops).toContain("breakFlags");
    expect(read("src/app/admin/reports/employees/page.tsx")).toContain("Breaks and meal-break checks");
    expect(read("src/app/admin/reports/employees/export/route.ts")).toContain("Meal-break checks");
  });
  it("timesheets, night watch, oversight, cockpit, employee file", () => {
    expect(read("src/lib/payroll/timesheet-store.ts")).toContain("breakFlags");
    expect(read("src/components/admin/books/TimesheetWorkbench.tsx")).toContain("BREAK_FLAG_TEXT");
    expect(read("src/lib/registers/night-watch-store.ts")).toContain("longOpenBreaks");
    expect(read("src/lib/registers/oversight.ts")).toContain("onBreakNow");
    expect(read("src/lib/admin/cockpit-analytics-server.ts")).toContain("onBreak");
    expect(read("src/app/admin/staffing/employees/[id]/page.tsx")).toContain("openPunchAny");
  });
  it("SOPs, help, concierge, handbook, verbatim", () => {
    const sop1 = read("docs/sop/SOP-01-register-operations.md");
    expect(sop1).toContain("### 4.2a Clocking out for lunch or another break (owner rule D211)");
    expect(sop1).toContain("| 1.25 draft | 2026-11-07 |");
    expect(read("docs/sop/SOP-08-onboarding-system-access-offboarding.md")).toContain("| 1.4 | 2026-11-07 |");
    expect(read("src/lib/admin/help-content.ts")).toContain("How does someone clock out for lunch without closing their drawer?");
    const kb = read("src/lib/admin/concierge-kb.ts");
    expect(kb).toContain("Lunch and other breaks (owner D211");
    expect(kb).toContain("Tracking breaks (D211)");
    expect(read("src/lib/staffing/handbook-content.ts")).toContain("Clock out for a break \u2192 Lunch");
    expect(read("docs/sop-program/00-OWNER-REQUEST-VERBATIM.md")).toContain("## D211");
  });
});
