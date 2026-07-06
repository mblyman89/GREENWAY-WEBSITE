/**
 * tests/compliance/compliance-calendar.test.ts
 *
 * S-18 compliance calendar — pins the PURE period/due-date/status math for the
 * recurring licensing obligations (LIQ-1295 by the 20th, weekly Sun–Sat CCRS,
 * monthly CCTV 45-day retention + badge/visitor-log checks, annual scale
 * calibration).
 */
import { describe, it, expect } from "vitest";
import {
  CALENDAR_TASKS,
  pendingPeriodFor,
  evaluateCalendar,
  overdueCount,
  normalizeDoneMap,
  weekdayOf,
  addDays,
  daysInMonth,
  compareDates,
  formatPlainDate,
  type PlainDate,
  type DoneMap,
} from "@/lib/compliance/compliance-calendar-core";

const d = (y: number, m: number, day: number): PlainDate => ({ y, m, d: day });

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
describe("plain-date helpers", () => {
  it("daysInMonth handles leap years", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it("weekdayOf: 2026-01-04 is a Sunday", () => {
    expect(weekdayOf(d(2026, 1, 4))).toBe(0);
    expect(weekdayOf(d(2026, 1, 10))).toBe(6); // Saturday
  });

  it("addDays rolls month/year boundaries", () => {
    expect(addDays(d(2026, 1, 31), 1)).toEqual(d(2026, 2, 1));
    expect(addDays(d(2026, 12, 31), 1)).toEqual(d(2027, 1, 1));
    expect(addDays(d(2026, 3, 1), -1)).toEqual(d(2026, 2, 28));
  });

  it("compareDates + formatPlainDate", () => {
    expect(compareDates(d(2026, 1, 5), d(2026, 1, 6))).toBeLessThan(0);
    expect(compareDates(d(2026, 1, 5), d(2026, 1, 5))).toBe(0);
    expect(formatPlainDate(d(2026, 3, 7))).toBe("2026-03-07");
  });
});

// ---------------------------------------------------------------------------
// LIQ-1295: prior month, due the 20th
// ---------------------------------------------------------------------------
describe("pendingPeriodFor — liq1295", () => {
  it("mid-February points at January, due Feb 20", () => {
    const p = pendingPeriodFor("liq1295", d(2026, 2, 10));
    expect(p.periodKey).toBe("2026-01");
    expect(p.dueDate).toEqual(d(2026, 2, 20));
  });

  it("January points at DECEMBER of the prior year", () => {
    const p = pendingPeriodFor("liq1295", d(2026, 1, 5));
    expect(p.periodKey).toBe("2025-12");
    expect(p.dueDate).toEqual(d(2026, 1, 20));
  });
});

// ---------------------------------------------------------------------------
// Weekly CCRS: last completed Sun–Sat week, due within the following week
// ---------------------------------------------------------------------------
describe("pendingPeriodFor — ccrs_weekly", () => {
  it("a Wednesday points at the week ending last Saturday", () => {
    // Wed 2026-01-14 → last Saturday 2026-01-10, week start Sunday 2026-01-04.
    const p = pendingPeriodFor("ccrs_weekly", d(2026, 1, 14));
    expect(p.periodKey).toBe("W-2026-01-04");
    expect(p.dueDate).toEqual(d(2026, 1, 17)); // Saturday of the following week
  });

  it("a Sunday points at the week that ended YESTERDAY", () => {
    const p = pendingPeriodFor("ccrs_weekly", d(2026, 1, 11)); // Sunday
    expect(p.periodKey).toBe("W-2026-01-04");
  });

  it("a Saturday still points at the PREVIOUS completed week", () => {
    const p = pendingPeriodFor("ccrs_weekly", d(2026, 1, 10)); // Saturday
    expect(p.periodKey).toBe("W-2025-12-28");
  });
});

// ---------------------------------------------------------------------------
// Monthly + annual tasks
// ---------------------------------------------------------------------------
describe("pendingPeriodFor — monthly/annual", () => {
  it("cctv_retention: current month, due month-end", () => {
    const p = pendingPeriodFor("cctv_retention", d(2026, 2, 3));
    expect(p.periodKey).toBe("2026-02");
    expect(p.dueDate).toEqual(d(2026, 2, 28));
  });

  it("badge_visitor_log: current month, due month-end (leap year)", () => {
    const p = pendingPeriodFor("badge_visitor_log", d(2024, 2, 3));
    expect(p.dueDate).toEqual(d(2024, 2, 29));
  });

  it("scale_calibration: calendar year, due Dec 31", () => {
    const p = pendingPeriodFor("scale_calibration", d(2026, 6, 15));
    expect(p.periodKey).toBe("2026");
    expect(p.dueDate).toEqual(d(2026, 12, 31));
  });
});

// ---------------------------------------------------------------------------
// Status evaluation
// ---------------------------------------------------------------------------
describe("evaluateCalendar", () => {
  it("emits one entry per defined task", () => {
    const entries = evaluateCalendar(d(2026, 2, 10), {});
    expect(entries.length).toBe(CALENDAR_TASKS.length);
  });

  it("nothing done: LIQ-1295 is 'due' before the 20th, 'overdue' after", () => {
    const before = evaluateCalendar(d(2026, 2, 10), {});
    const liqBefore = before.find((e) => e.task.id === "liq1295")!;
    expect(liqBefore.status).toBe("due");
    expect(liqBefore.daysUntilDue).toBe(10);

    const after = evaluateCalendar(d(2026, 2, 25), {});
    const liqAfter = after.find((e) => e.task.id === "liq1295")!;
    expect(liqAfter.status).toBe("overdue");
    expect(liqAfter.daysUntilDue).toBe(-5);
  });

  it("done map flips the status and rolls over to the NEXT period automatically", () => {
    const doneJan: DoneMap = {
      liq1295: { "2026-01": { doneAt: "2026-02-05T10:00:00Z", byEmail: "owner@x.com" } },
    };
    // February: January's report is signed off → done.
    const feb = evaluateCalendar(d(2026, 2, 25), doneJan);
    expect(feb.find((e) => e.task.id === "liq1295")!.status).toBe("done");
    // March: the pending period is now FEBRUARY, which is NOT done → overdue after the 20th.
    const mar = evaluateCalendar(d(2026, 3, 25), doneJan);
    const liqMar = mar.find((e) => e.task.id === "liq1295")!;
    expect(liqMar.period.periodKey).toBe("2026-02");
    expect(liqMar.status).toBe("overdue");
  });

  it("overdueCount counts only overdue", () => {
    const entries = evaluateCalendar(d(2026, 2, 25), {});
    // liq1295 overdue (due the 20th); monthly tasks due at month-end; weekly
    // CCRS due the Saturday after the completed week (may or may not be past).
    expect(overdueCount(entries)).toBe(
      entries.filter((e) => e.status === "overdue").length,
    );
    expect(overdueCount(entries)).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// DoneMap normalization (site_settings JSON hygiene)
// ---------------------------------------------------------------------------
describe("normalizeDoneMap", () => {
  it("round-trips a valid map", () => {
    const valid: DoneMap = {
      ccrs_weekly: { "W-2026-01-04": { doneAt: "2026-01-12T08:00:00Z", byEmail: "a@b.c" } },
    };
    expect(normalizeDoneMap(valid)).toEqual(valid);
  });

  it("drops unknown tasks, junk records, and non-object payloads", () => {
    expect(normalizeDoneMap(null)).toEqual({});
    expect(normalizeDoneMap("junk")).toEqual({});
    expect(
      normalizeDoneMap({
        not_a_task: { x: { doneAt: "t", byEmail: null } },
        liq1295: { "2026-01": { nope: true }, "2026-02": { doneAt: "t", byEmail: 5 } },
      }),
    ).toEqual({ liq1295: { "2026-02": { doneAt: "t", byEmail: null } } });
  });
});
