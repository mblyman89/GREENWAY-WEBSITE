/**
 * R-3 (CCRS Bible Part 09 R-3): the DOR Combined Excise Tax Return is on the
 * compliance calendar and has reminders.
 *
 * Why: Greenway files the DOR return MONTHLY ("Filing Frequency: Monthly",
 * docs/authorities/state-wa/dor-combined-excise-return-july-2026.txt). Returns
 * "are due monthly within 25 days after the end of the month in which the
 * taxable activities occur" (RCW 82.32.045(1)), and "If the due date falls on
 * a weekend or legal holiday, the due date is extended to the next business
 * day" (DOR, 2026 Excise tax return due dates). A late return costs 9% at once.
 * Before R-3 nothing in the system tracked it (Part 04, Part 09 R-3).
 *
 * The expected dates below are DOR's own published 2026 monthly table
 * (https://dor.wa.gov/file-pay-taxes/filing-frequencies-due-dates/2026-excise-tax-return-due-dates,
 * read 2026-10-20): the last day to file without penalty is the day before
 * "9% penalty begins". Every month of 2026 is pinned, including the weekend
 * rolls (Mar, Jun, Sep) and the holiday rolls (Apr: Memorial Day 5/25;
 * Nov: Christmas 12/25).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CALENDAR_TASKS,
  dorExciseDueDate,
  evaluateCalendar,
  normalizeDoneMap,
  pendingPeriodFor,
  planDorExciseReminders,
  type DoneMap,
  type PlainDate,
} from "@/lib/compliance/compliance-calendar-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const d = (iso: string): PlainDate => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });
const iso = (p: PlainDate) => `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;

/** DOR 2026 monthly table: return month -> [published due date, 9% penalty begins]. */
const DOR_2026: Record<number, [string, string]> = {
  1: ["2026-02-25", "2026-02-26"],
  2: ["2026-03-25", "2026-03-26"],
  3: ["2026-04-25", "2026-04-28"],
  4: ["2026-05-25", "2026-05-27"],
  5: ["2026-06-25", "2026-06-26"],
  6: ["2026-07-25", "2026-07-28"],
  7: ["2026-08-25", "2026-08-26"],
  8: ["2026-09-25", "2026-09-26"],
  9: ["2026-10-25", "2026-10-27"],
  10: ["2026-11-25", "2026-11-26"],
  11: ["2026-12-25", "2026-12-29"],
  12: ["2027-01-25", "2027-01-26"],
};
const dayBefore = (s: string) => { const t = new Date(`${s}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };

describe("R-3 dorExciseDueDate matches DOR's published 2026 table, every month", () => {
  for (const [m, [named, penalty]] of Object.entries(DOR_2026)) {
    it(`${m}/2026 return: named ${named}, last day without penalty ${dayBefore(penalty)}`, () => {
      const r = dorExciseDueDate(2026, Number(m));
      expect(r.namedDate).toBe(named);
      expect(r.dueDate).toBe(dayBefore(penalty));
    });
  }
  it("says why a date moved: weekend or legal holiday", () => {
    expect(dorExciseDueDate(2026, 3).shiftedBy).toBe("weekend"); // 4/25 Saturday
    expect(dorExciseDueDate(2026, 4).shiftedBy).toBe("holiday"); // 5/25 Memorial Day
    expect(dorExciseDueDate(2026, 11).shiftedBy).toBe("holiday"); // 12/25 Christmas (Friday)
    expect(dorExciseDueDate(2026, 1).shiftedBy).toBe("none");
  });
  it("refuses a month that is not 1-12 or a year that is not a whole number", () => {
    expect(() => dorExciseDueDate(2026, 13)).toThrow();
    expect(() => dorExciseDueDate(2026, 0)).toThrow();
    expect(() => dorExciseDueDate(2026.5, 1)).toThrow();
  });
});

describe("R-3 the calendar task", () => {
  it("is on the calendar, monthly, citing RCW 82.32.045", () => {
    const t = CALENDAR_TASKS.find((x) => x.id === "dor_excise");
    expect(t).toBeTruthy();
    expect(t!.cadence).toBe("monthly");
    expect(t!.authority).toContain("RCW 82.32.045");
    expect(t!.description).toMatch(/25th/);
  });
  it("pending period is LAST month; the due date rolls like DOR's table", () => {
    const p = pendingPeriodFor("dor_excise", d("2026-10-20"));
    expect(p.periodKey).toBe("2026-09");
    expect(iso(p.dueDate)).toBe("2026-10-26");
    const jan = pendingPeriodFor("dor_excise", d("2027-01-05"));
    expect(jan.periodKey).toBe("2026-12");
    expect(iso(jan.dueDate)).toBe("2027-01-25");
  });
  it("status: due before and on the due day, overdue the day after, done once marked", () => {
    const st = (today: string, done: DoneMap = {}) => evaluateCalendar(d(today), done).find((e) => e.task.id === "dor_excise")!.status;
    expect(st("2026-10-26")).toBe("due");
    expect(st("2026-10-27")).toBe("overdue");
    expect(evaluateCalendar(d("2026-10-27"), {}).find((e) => e.task.id === "dor_excise")!.daysUntilDue).toBe(-1);
    expect(st("2026-10-27", normalizeDoneMap({ dor_excise: { "2026-09": { doneAt: "2026-10-22T10:00:00Z", byEmail: "m@x" } } }))).toBe("done");
  });
  it("the done map keeps dor_excise records (no migration: site_settings compliance_calendar_done)", () => {
    const m = normalizeDoneMap({ dor_excise: { "2026-09": { doneAt: "t", byEmail: null } }, nope: { x: { doneAt: "t" } } });
    expect(m.dor_excise?.["2026-09"]?.doneAt).toBe("t");
    expect(Object.keys(m)).toEqual(["dor_excise"]);
  });
});

describe("R-3 reminders", () => {
  // August is marked filed so each October test looks at ONE period
  // (September); an unfiled August would correctly nag too (see lookback test).
  const AUG_FILED: DoneMap = { dor_excise: { "2026-08": { doneAt: "2026-09-20T10:00:00Z", byEmail: null } } };
  const plan = (today: string, done: DoneMap = AUG_FILED) => planDorExciseReminders(d(today), done);
  it("nothing more than 5 days before the due day", () => {
    expect(plan("2026-10-20")).toEqual([]);
  });
  it("due soon (5..1 days before), one stable key per period", () => {
    const r = plan("2026-10-21");
    expect(r.length).toBe(1);
    expect(r[0].stage).toBe("dor_due_soon");
    expect(r[0].dedupeKey).toBe("dor_due_soon:2026-09");
    expect(r[0].urgency).toBe("warning");
    expect(r[0].subject).toContain("2026-10-26");
    expect(plan("2026-10-25")[0].dedupeKey).toBe("dor_due_soon:2026-09");
  });
  it("due today is critical", () => {
    const r = plan("2026-10-26");
    expect(r.map((x) => [x.stage, x.dedupeKey, x.urgency])).toEqual([["dor_due_today", "dor_due_today:2026-09", "critical"]]);
  });
  it("overdue: a new key every day, and it says 9%", () => {
    const r = plan("2026-10-28");
    expect(r[0].stage).toBe("dor_overdue_daily");
    expect(r[0].dedupeKey).toBe("dor_overdue_daily:2026-09:2026-10-28");
    expect(r[0].body).toMatch(/9%/);
  });
  it("silent once the period is marked filed on the calendar", () => {
    expect(plan("2026-10-26", { dor_excise: { "2026-08": { doneAt: "t", byEmail: null }, "2026-09": { doneAt: "t", byEmail: null } } })).toEqual([]);
  });
  it("a missed return keeps nagging after the month turns (looks back two months)", () => {
    // 11/05: October is not due yet (11/25); September (due 10/26) was never marked filed
    const r = plan("2026-11-05", {});
    expect(r.map((x) => x.dedupeKey)).toEqual(["dor_overdue_daily:2026-09:2026-11-05"]);
    // three months back is not looked at (the calendar page shows the history)
    // 12/05: pending is November (due 12/28, not soon); October (due 11/25) is overdue;
    // September is three months back and is not looked at.
    expect(plan("2026-12-05", {}).map((x) => x.dedupeKey)).toEqual(["dor_overdue_daily:2026-10:2026-12-05"]);
    // two missed months in the window -> both nag, oldest first
    expect(plan("2026-11-27", {}).map((x) => x.dedupeKey)).toEqual([
      "dor_overdue_daily:2026-09:2026-11-27",
      "dor_overdue_daily:2026-10:2026-11-27",
    ]);
  });
  it("an unfiled previous month nags alongside the current one (oldest first)", () => {
    expect(plan("2026-10-21", {}).map((x) => x.dedupeKey)).toEqual([
      "dor_overdue_daily:2026-08:2026-10-21",
      "dor_due_soon:2026-09",
    ]);
  });
  it("links to the calendar, where 'filed' is marked", () => {
    expect(plan("2026-10-26")[0].linkPath).toBe("/admin/compliance/calendar");
  });
});

describe("R-3 wiring", () => {
  it("the reminder engine runs the DOR planner in its own try/catch", () => {
    const src = read("src/lib/notifications/compliance-reminders.ts");
    expect(src).toContain("planDorExciseReminders(");
    expect(src).toMatch(/DOR excise planner failed/);
  });
  it("the calendar core stays pure and takes the WA holiday table from one place", () => {
    const src = read("src/lib/compliance/compliance-calendar-core.ts");
    expect(src).not.toMatch(/^import\s+["']server-only["']|from\s+["'][^"']*supabase|Date\.now\(|new Date\(\)/m);
    expect(src).toContain('import { isWaLegalHoliday } from "@/lib/payroll/wa-quarterly-core"');
  });
});
