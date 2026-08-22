/**
 * tests/compliance/timesheet-core.test.ts
 *
 * books-32. The overtime engine, tested against the REGULATION'S OWN WORKED
 * EXAMPLES rather than examples I invented.
 *
 * WHY THAT DISTINCTION MATTERS. A test I write from my own understanding tests
 * my understanding. A test taken from 29 CFR §778.110(a) — "a $12 hourly rate
 * will bring, for an employee who works 46 hours, a total weekly wage of $588"
 * — tests the engine against the government's arithmetic. If the engine ever
 * disagrees with that, the engine is wrong, and there is nothing to argue
 * about.
 *
 * The two examples that carry the most weight here:
 *
 *   §778.110(a)  $12/hr x 46 hours = $588.00, being $480.00 + $108.00
 *   §778.104     30 hours then 50 hours = 10 hours of overtime, NOT zero
 *
 * The second is the one that would bankrupt Greenway if it were wrong, because
 * an engine that averages a biweekly period gets it wrong SILENTLY and forever.
 */
import { describe, it, expect } from "vitest";

import {
  computePeriodHours,
  splitIntoWorkweeks,
  workweekStartFor,
  weekdayOfDayKey,
  daysBetweenDayKeys,
  punchMinutes,
  minutesToHundredthHours,
  formatHundredthHours,
  formatCents,
  DEFAULT_OVERTIME_RULES,
  WA_OVERTIME_THRESHOLD_HUNDREDTH_HOURS,
  WA_OVERTIME_MULTIPLIER_BASIS_POINTS,
  type RawPunch,
  type EmployeePayFacts,
  type TimesheetSettings,
  type WeekdayIndex,
} from "@/lib/payroll/timesheet-core";
import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** $12.00/hr expressed in milli-cents: 12 dollars = 1200 cents = 1,200,000. */
const RATE_12_PER_HOUR = 1_200_000;

const SUNDAY: WeekdayIndex = 0;
const MONDAY: WeekdayIndex = 1;

const SETTINGS: TimesheetSettings = {
  workweekStartsOn: SUNDAY,
  ...DEFAULT_OVERTIME_RULES,
};

const HOURLY: EmployeePayFacts = {
  employeeId: "emp-1",
  fullName: "Test Budtender",
  flsaStatus: "non_exempt",
  basis: "hourly",
  hourlyRateMilliCents: RATE_12_PER_HOUR,
};

let punchSeq = 0;

/**
 * Build a work punch on a given Pacific day, `hours` long, starting at 09:00
 * Pacific. Written as a helper so a test reads as hours-per-day rather than as
 * a wall of ISO strings.
 *
 * Pacific is UTC-8 in winter, so 09:00 Pacific on a January day is 17:00 UTC.
 * The tests below all sit in January and March 2027 and the offsets are
 * written explicitly rather than computed, so the fixture cannot drift with
 * the engine it is testing (standing rule 55: a fixture broken the same way as
 * the code proves nothing).
 */
function punch(
  dayYmd: string,
  hours: number,
  opts: { utcOffsetHours?: number; kind?: "work" | "break" } = {},
): RawPunch {
  const off = opts.utcOffsetHours ?? 8; // PST
  const startUtcHour = 9 + off; // 09:00 Pacific
  const minutes = Math.round(hours * 60);
  const startMs = Date.parse(`${dayYmd}T${String(startUtcHour).padStart(2, "0")}:00:00Z`);
  const endMs = startMs + minutes * 60_000;
  punchSeq += 1;
  return {
    id: `p${punchSeq}`,
    employeeId: "emp-1",
    punchKind: opts.kind ?? "work",
    clockInAt: new Date(startMs).toISOString(),
    clockOutAt: new Date(endMs).toISOString(),
    minutes,
  };
}

// ===========================================================================
// 1) THE REGULATION'S OWN WORKED EXAMPLES
// ===========================================================================

describe("29 CFR 778.110(a) — the government's own arithmetic", () => {
  /**
   * The quote, verbatim from the mirrored corpus:
   *
   *   "Thus a $12 hourly rate will bring, for an employee who works 46 hours,
   *    a total weekly wage of $588 (46 hours at $12 plus 6 at $6). In other
   *    words, the employee is entitled to be paid an amount equal to $12 an
   *    hour for 40 hours and $18 an hour for the 6 hours of overtime, or a
   *    total of $588."
   */
  it("$12/hr for 46 hours in ONE workweek = $588.00 exactly", () => {
    // One workweek: Sunday 2027-01-03 .. Saturday 2027-01-09.
    // 46 hours spread over six days so no single punch is implausible.
    const punches = [
      punch("2027-01-03", 8),
      punch("2027-01-04", 8),
      punch("2027-01-05", 8),
      punch("2027-01-06", 8),
      punch("2027-01-07", 8),
      punch("2027-01-08", 6),
    ];
    const r = computePeriodHours({
      employee: HOURLY,
      period: { startDate: "2027-01-03", endDate: "2027-01-09" },
      punches,
      settings: SETTINGS,
    });
    expect(r.ok, r.ok ? "" : JSON.stringify(r.refusals, null, 2)).toBe(true);
    if (!r.ok) return;

    expect(r.value.totalHundredthHours).toBe(4_600); // 46.00 hours
    expect(r.value.regularHundredthHours).toBe(4_000); // 40.00
    expect(r.value.overtimeHundredthHours).toBe(600); // 6.00

    // The regulation's own split: "46 hours at $12 plus 6 at $6".
    expect(r.value.straightTimeCents).toBe(55_200); // 46 x $12 = $552.00
    expect(r.value.overtimePremiumCents).toBe(3_600); //  6 x  $6 =  $36.00
    expect(r.value.grossCents).toBe(58_800); //           = $588.00

    // And the regulation's SECOND way of saying the same thing:
    // "$12 an hour for 40 hours and $18 an hour for the 6 hours of overtime".
    const fortyAtTwelve = 40 * 1_200; // $480.00 in cents
    const sixAtEighteen = 6 * 1_800; // $108.00 in cents
    expect(fortyAtTwelve + sixAtEighteen).toBe(58_800);
    expect(r.value.grossCents).toBe(fortyAtTwelve + sixAtEighteen);
  });

  it("prints as $588.00 for a human", () => {
    expect(formatCents(58_800)).toBe("$588.00");
    expect(formatHundredthHours(4_600)).toBe("46.00");
  });
});

describe("29 CFR 778.104 — averaging across weeks is forbidden", () => {
  /**
   * THE TEST THAT MATTERS MOST IN THIS FILE.
   *
   * The regulation's example, verbatim: "if an employee works 30 hours one
   * week and 50 hours the next, he must receive overtime compensation for the
   * overtime hours worked beyond the applicable maximum in the second week,
   * even though the average number of hours worked in the 2 weeks is 40."
   *
   * 30 + 50 = 80 hours in a biweekly period. An engine that totals the period
   * and compares against 80 pays ZERO overtime. The correct answer is TEN
   * hours of overtime premium.
   */
  it("30 hours then 50 hours owes 10 hours of overtime, NOT zero", () => {
    const punches = [
      // Workweek 1: Sun 2027-01-03 .. Sat 2027-01-09 — 30 hours.
      punch("2027-01-04", 10),
      punch("2027-01-05", 10),
      punch("2027-01-06", 10),
      // Workweek 2: Sun 2027-01-10 .. Sat 2027-01-16 — 50 hours.
      punch("2027-01-11", 10),
      punch("2027-01-12", 10),
      punch("2027-01-13", 10),
      punch("2027-01-14", 10),
      punch("2027-01-15", 10),
    ];
    const r = computePeriodHours({
      employee: HOURLY,
      period: { startDate: "2027-01-03", endDate: "2027-01-16" },
      punches,
      settings: SETTINGS,
    });
    expect(r.ok, r.ok ? "" : JSON.stringify(r.refusals, null, 2)).toBe(true);
    if (!r.ok) return;

    // Two complete workweeks in a fourteen-day period.
    expect(r.value.weeks).toHaveLength(2);
    expect(r.value.weeks[0].totalHundredthHours).toBe(3_000); // 30.00
    expect(r.value.weeks[1].totalHundredthHours).toBe(5_000); // 50.00

    // Week one is under forty, so no overtime there.
    expect(r.value.weeks[0].overtimeHundredthHours).toBe(0);
    // Week two is ten hours over.
    expect(r.value.weeks[1].overtimeHundredthHours).toBe(1_000);

    // THE ASSERTION THAT CATCHES THE BANKRUPTING BUG.
    expect(r.value.totalHundredthHours).toBe(8_000); // 80 hours, average 40
    expect(r.value.overtimeHundredthHours).toBe(1_000); // and STILL 10h of OT
    expect(r.value.overtimeHundredthHours).not.toBe(0);

    // The money: 80 hours straight at $12 = $960.00, plus 10 hours of
    // half-rate premium at $6 = $60.00.
    expect(r.value.straightTimeCents).toBe(96_000);
    expect(r.value.overtimePremiumCents).toBe(6_000);
    expect(r.value.grossCents).toBe(102_000); // $1,020.00
  });

  /**
   * THE CONTROL FOR THE TEST ABOVE (standing rule 60).
   *
   * If the engine simply always produced overtime, the test above would pass
   * for the wrong reason. So: the SAME eighty hours, split evenly at forty and
   * forty, must produce ZERO overtime. Same total, same period, different
   * distribution, different answer — which is precisely what §778.104 means.
   */
  it("CONTROL: 40 and 40 in the same period owes NO overtime", () => {
    const punches = [
      punch("2027-01-04", 10),
      punch("2027-01-05", 10),
      punch("2027-01-06", 10),
      punch("2027-01-07", 10),
      punch("2027-01-11", 10),
      punch("2027-01-12", 10),
      punch("2027-01-13", 10),
      punch("2027-01-14", 10),
    ];
    const r = computePeriodHours({
      employee: HOURLY,
      period: { startDate: "2027-01-03", endDate: "2027-01-16" },
      punches,
      settings: SETTINGS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.totalHundredthHours).toBe(8_000); // identical total
    expect(r.value.overtimeHundredthHours).toBe(0); // different answer
    expect(r.value.grossCents).toBe(96_000); // $960.00, no premium
  });

  it("exactly 40 hours in a week is NOT overtime (the boundary is >, not >=)", () => {
    const r = computePeriodHours({
      employee: HOURLY,
      period: { startDate: "2027-01-03", endDate: "2027-01-09" },
      punches: [
        punch("2027-01-04", 8),
        punch("2027-01-05", 8),
        punch("2027-01-06", 8),
        punch("2027-01-07", 8),
        punch("2027-01-08", 8),
      ],
      settings: SETTINGS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.totalHundredthHours).toBe(4_000);
    expect(r.value.overtimeHundredthHours).toBe(0);
  });

  it("forty hours and ONE MINUTE is overtime", () => {
    const r = computePeriodHours({
      employee: HOURLY,
      period: { startDate: "2027-01-03", endDate: "2027-01-09" },
      punches: [
        punch("2027-01-04", 8),
        punch("2027-01-05", 8),
        punch("2027-01-06", 8),
        punch("2027-01-07", 8),
        punch("2027-01-08", 8 + 1 / 60),
      ],
      settings: SETTINGS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // One minute = 2 hundredths of an hour (1 x 5 / 3 = 1.67, half-up = 2).
    expect(r.value.totalHundredthHours).toBe(4_002);
    expect(r.value.overtimeHundredthHours).toBe(2);
    // And the premium is real money, however small: 0.02h x $6 = $0.12.
    expect(r.value.overtimePremiumCents).toBe(12);
  });
});

// ===========================================================================
// 2) WORKWEEK BUCKETING
// ===========================================================================

describe("the workweek is a fixed 168-hour period (29 CFR 778.105)", () => {
  it("knows the weekday of a date label", () => {
    // 2027-01-03 is a Sunday. Verified independently: 2027-01-01 was a Friday.
    expect(weekdayOfDayKey("2027-01-01")).toBe(5); // Friday
    expect(weekdayOfDayKey("2027-01-03")).toBe(0); // Sunday
    expect(weekdayOfDayKey("2027-01-09")).toBe(6); // Saturday
  });

  it("finds the start of the workweek containing a day, for a Sunday anchor", () => {
    expect(workweekStartFor("2027-01-06", SUNDAY)).toBe("2027-01-03");
    expect(workweekStartFor("2027-01-03", SUNDAY)).toBe("2027-01-03");
    expect(workweekStartFor("2027-01-09", SUNDAY)).toBe("2027-01-03");
  });

  it("finds it for a MONDAY anchor too — the anchor is not decorative", () => {
    // With a Monday anchor, Sunday 2027-01-03 belongs to the week that began
    // Monday 2026-12-28, NOT to the week starting 2027-01-04.
    expect(workweekStartFor("2027-01-03", MONDAY)).toBe("2026-12-28");
    expect(workweekStartFor("2027-01-04", MONDAY)).toBe("2027-01-04");
  });

  it("splits an aligned fourteen-day period into exactly two whole weeks", () => {
    const segs = splitIntoWorkweeks(
      { startDate: "2027-01-03", endDate: "2027-01-16" },
      SUNDAY,
    );
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({
      startDate: "2027-01-03",
      endDate: "2027-01-09",
      isPartial: false,
    });
    expect(segs[1]).toEqual({
      startDate: "2027-01-10",
      endDate: "2027-01-16",
      isPartial: false,
    });
  });

  it("splits a MISALIGNED period into partials and says so", () => {
    // A period starting Wednesday against a Sunday anchor.
    const segs = splitIntoWorkweeks(
      { startDate: "2027-01-06", endDate: "2027-01-19" },
      SUNDAY,
    );
    expect(segs).toHaveLength(3);
    expect(segs[0].isPartial).toBe(true); // Wed .. Sat
    expect(segs[1].isPartial).toBe(false); // a whole week
    expect(segs[2].isPartial).toBe(true); // Sun .. Tue
    // The partials really are shorter than seven days.
    expect(daysBetweenDayKeys(segs[0].startDate, segs[0].endDate)).toBe(3);
    expect(daysBetweenDayKeys(segs[1].startDate, segs[1].endDate)).toBe(6);
    expect(daysBetweenDayKeys(segs[2].startDate, segs[2].endDate)).toBe(2);
  });

  it("a misaligned period WARNS, because overtime spans the cut", () => {
    const r = computePeriodHours({
      employee: HOURLY,
      period: { startDate: "2027-01-06", endDate: "2027-01-19" },
      punches: [punch("2027-01-06", 8)],
      settings: SETTINGS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.partialWeekWarning).not.toBeNull();
    expect(r.value.partialWeekWarning).toContain("does not line up");
    expect(r.value.partialWeekWarning).toContain("WHOLE workweek");
  });

  it("an ALIGNED period does NOT warn (rule 39: the warning is not always on)", () => {
    const r = computePeriodHours({
      employee: HOURLY,
      period: { startDate: "2027-01-03", endDate: "2027-01-16" },
      punches: [punch("2027-01-04", 8)],
      settings: SETTINGS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.partialWeekWarning).toBeNull();
  });

  it("THE ANCHOR CHANGES THE ANSWER — proving it is really consulted", () => {
    // Ten hours on Saturday 2027-01-09 and 35 hours Mon-Fri of the following
    // week. With a SUNDAY anchor the Saturday sits in week 1 (35+10 split
    // across two weeks => no overtime). With a SATURDAY anchor (6) the
    // Saturday joins the following Mon-Fri, making 45 hours in one workweek
    // and five hours of overtime.
    const punches = [
      punch("2027-01-09", 10), // Saturday
      punch("2027-01-11", 7),
      punch("2027-01-12", 7),
      punch("2027-01-13", 7),
      punch("2027-01-14", 7),
      punch("2027-01-15", 7),
    ];
    const period = { startDate: "2027-01-03", endDate: "2027-01-16" };

    const sun = computePeriodHours({
      employee: HOURLY,
      period,
      punches,
      settings: { ...SETTINGS, workweekStartsOn: 0 },
    });
    const sat = computePeriodHours({
      employee: HOURLY,
      period,
      punches,
      settings: { ...SETTINGS, workweekStartsOn: 6 },
    });
    expect(sun.ok && sat.ok).toBe(true);
    if (!sun.ok || !sat.ok) return;

    expect(sun.value.totalHundredthHours).toBe(4_500);
    expect(sat.value.totalHundredthHours).toBe(4_500); // same hours...

    expect(sun.value.overtimeHundredthHours).toBe(0); // ...different overtime
    expect(sat.value.overtimeHundredthHours).toBe(500); // 5.00 hours

    // Which is real money: the workweek choice is worth $30.00 here.
    expect(sat.value.grossCents - sun.value.grossCents).toBe(3_000);
  });
});

// ===========================================================================
// 3) REFUSALS — the engine must decline rather than guess (rule 62d)
// ===========================================================================

describe("the engine refuses rather than guessing", () => {
  function refuse(over: Partial<Parameters<typeof computePeriodHours>[0]>) {
    return computePeriodHours({
      employee: HOURLY,
      period: { startDate: "2027-01-03", endDate: "2027-01-16" },
      punches: [punch("2027-01-04", 8)],
      settings: SETTINGS,
      ...over,
    });
  }

  it("REFUSES when no workweek has been chosen — it does not assume Sunday", () => {
    const r = refuse({ settings: { ...SETTINGS, workweekStartsOn: null } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const codes = r.refusals.map((x) => x.code);
    expect(codes).toContain("NO_WORKWEEK_ANCHOR");
    // And it says what to do about it.
    const f = r.refusals.find((x) => x.code === "NO_WORKWEEK_ANCHOR")!;
    expect(f.fix).toContain("Company Information");
    expect(f.authorityIds).toContain("cfr-778-105-workweek-definition");
  });

  it("REFUSES an open punch rather than paying it as zero", () => {
    const open: RawPunch = {
      id: "open-1",
      employeeId: "emp-1",
      punchKind: "work",
      clockInAt: "2027-01-04T17:00:00Z",
      clockOutAt: null,
      minutes: null,
    };
    const r = refuse({ punches: [open] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals.map((x) => x.code)).toContain("OPEN_PUNCH");
  });

  it("REFUSES a punch that clocks out before it clocks in", () => {
    const bad: RawPunch = {
      id: "neg-1",
      employeeId: "emp-1",
      punchKind: "work",
      clockInAt: "2027-01-04T20:00:00Z",
      clockOutAt: "2027-01-04T17:00:00Z",
      minutes: -180,
    };
    const r = refuse({ punches: [bad] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals.map((x) => x.code)).toContain("NEGATIVE_SPAN");
  });

  it("REFUSES overlapping punches — the same minute would be paid twice", () => {
    const a: RawPunch = {
      id: "ov-a",
      employeeId: "emp-1",
      punchKind: "work",
      clockInAt: "2027-01-04T17:00:00Z",
      clockOutAt: "2027-01-04T21:00:00Z",
      minutes: 240,
    };
    const b: RawPunch = {
      id: "ov-b",
      employeeId: "emp-1",
      punchKind: "work",
      clockInAt: "2027-01-04T20:00:00Z", // starts before A ends
      clockOutAt: "2027-01-04T23:00:00Z",
      minutes: 180,
    };
    const r = refuse({ punches: [a, b] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals.map((x) => x.code)).toContain("OVERLAPPING_PUNCHES");
  });

  it("ACCEPTS punches that merely touch (rule 60: the overlap check is not always on)", () => {
    const a: RawPunch = {
      id: "t-a",
      employeeId: "emp-1",
      punchKind: "work",
      clockInAt: "2027-01-04T17:00:00Z",
      clockOutAt: "2027-01-04T21:00:00Z",
      minutes: 240,
    };
    const b: RawPunch = {
      id: "t-b",
      employeeId: "emp-1",
      punchKind: "work",
      clockInAt: "2027-01-04T21:00:00Z", // exactly when A ends
      clockOutAt: "2027-01-04T23:00:00Z",
      minutes: 120,
    };
    const r = refuse({ punches: [a, b] });
    expect(r.ok, r.ok ? "" : JSON.stringify(r.refusals)).toBe(true);
    if (!r.ok) return;
    expect(r.value.totalHundredthHours).toBe(600); // 6.00 hours
  });

  it("REFUSES an hourly employee with no rate", () => {
    const r = refuse({
      employee: { ...HOURLY, hourlyRateMilliCents: null },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals.map((x) => x.code)).toContain("NO_HOURLY_RATE");
  });

  it("REFUSES the exempt-but-hourly contradiction", () => {
    const r = refuse({ employee: { ...HOURLY, flsaStatus: "exempt" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const f = r.refusals.find((x) => x.code === "EXEMPT_PAID_HOURLY")!;
    expect(f).toBeTruthy();
    // The fix must state the actual rule, because this is THE misunderstanding.
    expect(f.fix).toContain("DUTIES");
    expect(f.fix.toLowerCase()).toContain("salary does not create an exemption");
    expect(f.authorityIds).toContain("rcw-49-46-130-exemptions");
  });

  it("REFUSES a salaried employee who has punches", () => {
    const r = refuse({
      employee: {
        ...HOURLY,
        basis: "salary",
        hourlyRateMilliCents: null,
        flsaStatus: "exempt",
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals.map((x) => x.code)).toContain("SALARY_WITH_PUNCHES");
  });

  it("REFUSES a single punch longer than a day", () => {
    const monster: RawPunch = {
      id: "long-1",
      employeeId: "emp-1",
      punchKind: "work",
      clockInAt: "2027-01-04T17:00:00Z",
      clockOutAt: "2027-01-06T17:00:00Z", // 48 hours
      minutes: 2_880,
    };
    const r = refuse({ punches: [monster] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals.map((x) => x.code)).toContain("IMPLAUSIBLE_SHIFT");
  });

  it("REFUSES a period that ends before it starts", () => {
    const r = refuse({
      period: { startDate: "2027-01-16", endDate: "2027-01-03" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals.map((x) => x.code)).toContain("BAD_PERIOD_DATES");
  });

  it("reports EVERY problem at once, not just the first", () => {
    const open: RawPunch = {
      id: "multi-open",
      employeeId: "emp-1",
      punchKind: "work",
      clockInAt: "2027-01-04T17:00:00Z",
      clockOutAt: null,
      minutes: null,
    };
    const r = computePeriodHours({
      employee: { ...HOURLY, hourlyRateMilliCents: null },
      period: { startDate: "2027-01-03", endDate: "2027-01-16" },
      punches: [open],
      settings: { ...SETTINGS, workweekStartsOn: null },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const codes = r.refusals.map((x) => x.code);
    expect(codes).toContain("NO_WORKWEEK_ANCHOR");
    expect(codes).toContain("NO_HOURLY_RATE");
    expect(codes).toContain("OPEN_PUNCH");
    expect(r.refusals.length).toBeGreaterThanOrEqual(3);
  });

  it("every refusal has a message AND a fix — never a bare error", () => {
    const r = computePeriodHours({
      employee: { ...HOURLY, hourlyRateMilliCents: null, flsaStatus: "exempt" },
      period: { startDate: "2027-01-16", endDate: "2027-01-03" },
      punches: [],
      settings: { ...SETTINGS, workweekStartsOn: null },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    for (const f of r.refusals) {
      expect(f.message.length, `${f.code} message`).toBeGreaterThan(20);
      expect(f.fix.length, `${f.code} fix`).toBeGreaterThan(20);
      expect(f.fix.toLowerCase(), `${f.code} fix must be actionable`).not.toContain(
        "contact support",
      );
    }
  });

  it("every authorityId cited by a refusal RESOLVES in the merged registry", () => {
    // Standing rule 56 / the books-20 tripwire, applied locally so a broken
    // citation fails in this file with a useful name rather than in a sweep.
    const all = [
      computePeriodHours({
        employee: { ...HOURLY, flsaStatus: "exempt" },
        period: { startDate: "2027-01-03", endDate: "2027-01-16" },
        punches: [],
        settings: { ...SETTINGS, workweekStartsOn: null },
      }),
      computePeriodHours({
        employee: { ...HOURLY, hourlyRateMilliCents: null },
        period: { startDate: "2027-01-03", endDate: "2027-01-16" },
        punches: [],
        settings: SETTINGS,
      }),
    ];
    let checked = 0;
    for (const r of all) {
      if (r.ok) continue;
      for (const f of r.refusals) {
        for (const id of f.authorityIds) {
          expect(findGuidanceAuthority(id), `unresolved authority: ${id}`).toBeTruthy();
          checked += 1;
        }
      }
    }
    // Rule 39: prove the loop actually ran.
    expect(checked).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 4) THE VARIANCE REPORT (standing rule 63d)
// ===========================================================================

describe("the handoff is where the defect lives — print the variance", () => {
  it("pays from the TIMESTAMPS and reports disagreement with stored minutes", () => {
    const p = punch("2027-01-04", 8);
    // The app wrote 500 minutes; the timestamps say 480.
    const lying: RawPunch = { ...p, minutes: 500 };
    const r = computePeriodHours({
      employee: HOURLY,
      period: { startDate: "2027-01-03", endDate: "2027-01-16" },
      punches: [lying],
      settings: SETTINGS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Paid from the timestamps: 8.00 hours, not 8.33.
    expect(r.value.totalHundredthHours).toBe(800);

    // And the disagreement is REPORTED, in integer minor units.
    expect(r.value.variances).toHaveLength(1);
    expect(r.value.variances[0]).toEqual({
      punchId: lying.id,
      storedMinutes: 500,
      computedMinutes: 480,
      varianceMinutes: -20,
    });
  });

  it("reports NOTHING when the two agree (rule 39: not always on)", () => {
    const r = computePeriodHours({
      employee: HOURLY,
      period: { startDate: "2027-01-03", endDate: "2027-01-16" },
      punches: [punch("2027-01-04", 8)],
      settings: SETTINGS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.variances).toHaveLength(0);
  });
});

// ===========================================================================
// 5) BREAKS, EXEMPTION, AND ROUNDING
// ===========================================================================

describe("breaks, exemption and rounding", () => {
  it("break punches are not paid time", () => {
    const r = computePeriodHours({
      employee: HOURLY,
      period: { startDate: "2027-01-03", endDate: "2027-01-16" },
      punches: [
        punch("2027-01-04", 8),
        punch("2027-01-04", 0.5, { kind: "break" }),
      ],
      settings: SETTINGS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.totalHundredthHours).toBe(800); // the break is excluded
  });

  it("an EXEMPT salaried employee with no punches computes cleanly at zero", () => {
    const r = computePeriodHours({
      employee: {
        employeeId: "owner",
        fullName: "Michael Lyman",
        flsaStatus: "exempt",
        basis: "salary",
        hourlyRateMilliCents: null,
      },
      period: { startDate: "2027-01-03", endDate: "2027-01-16" },
      punches: [],
      settings: SETTINGS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.overtimeHundredthHours).toBe(0);
    expect(r.value.grossCents).toBe(0); // salary is computed elsewhere
  });

  it("minutes convert to hundredths of an hour, half up, on integers", () => {
    expect(minutesToHundredthHours(0)).toBe(0);
    expect(minutesToHundredthHours(1)).toBe(2); // 1.667 -> 2
    expect(minutesToHundredthHours(6)).toBe(10); // 0.10 h
    expect(minutesToHundredthHours(30)).toBe(50); // 0.50 h
    expect(minutesToHundredthHours(45)).toBe(75); // 0.75 h
    expect(minutesToHundredthHours(60)).toBe(100); // 1.00 h
    expect(minutesToHundredthHours(2_400)).toBe(4_000); // 40 h
    expect(minutesToHundredthHours(2_760)).toBe(4_600); // 46 h
  });

  it("refuses fractional or negative minutes rather than rounding them", () => {
    expect(() => minutesToHundredthHours(1.5)).toThrow(/integer/);
    expect(() => minutesToHundredthHours(-1)).toThrow(/negative/);
  });

  it("sums MINUTES before converting, so per-punch rounding cannot accumulate", () => {
    // Eight 7-minute punches. Rounded individually: 8 x 12 = 96 hundredths.
    // Summed first: 56 minutes -> 93 hundredths. The engine must give 93.
    //
    // They are spaced ten minutes apart on purpose. Eight punches that all
    // START at the same instant are overlapping punches, and the engine is
    // right to refuse those — the first draft of this test stacked them and
    // got OVERLAPPING_PUNCHES, which proved the overlap guard works but
    // proved nothing at all about rounding.
    const dayBaseMs = Date.parse("2027-01-04T17:00:00Z"); // 09:00 Pacific
    const punches: RawPunch[] = Array.from({ length: 8 }, (_, i) => ({
      id: `round-${i}`,
      employeeId: "emp-1",
      punchKind: "work",
      clockInAt: new Date(dayBaseMs + i * 10 * 60_000).toISOString(),
      clockOutAt: new Date(dayBaseMs + (i * 10 + 7) * 60_000).toISOString(),
      minutes: 7,
    }));
    const r = computePeriodHours({
      employee: HOURLY,
      period: { startDate: "2027-01-03", endDate: "2027-01-09" },
      punches,
      settings: SETTINGS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(minutesToHundredthHours(7) * 8).toBe(96); // the WRONG way
    expect(r.value.totalHundredthHours).toBe(93); // the RIGHT way
  });

  it("punchMinutes reads elapsed time, so a DST shift is hours ACTUALLY worked", () => {
    // 2027-03-14 is the US spring-forward date. 01:00 Pacific is 09:00 UTC;
    // 04:00 Pacific (after the jump) is 11:00 UTC. The wall clock shows three
    // hours; only two were worked, and the timestamps know it.
    const p: RawPunch = {
      id: "dst",
      employeeId: "emp-1",
      punchKind: "work",
      clockInAt: "2027-03-14T09:00:00Z",
      clockOutAt: "2027-03-14T11:00:00Z",
      minutes: 120,
    };
    expect(punchMinutes(p)).toBe(120); // two hours, not three
  });
});

// ===========================================================================
// 6) THE RULES ARE DATA, AND THEY MATCH THE LAW
// ===========================================================================

describe("the thresholds are the ones the law states", () => {
  it("40 hours and 1.5x, expressed in the engine's integer units", () => {
    expect(WA_OVERTIME_THRESHOLD_HUNDREDTH_HOURS).toBe(4_000); // 40.00 hours
    expect(WA_OVERTIME_MULTIPLIER_BASIS_POINTS).toBe(15_000); // 1.5000x
    expect(DEFAULT_OVERTIME_RULES.overtimeThresholdHundredthHours).toBe(4_000);
    expect(DEFAULT_OVERTIME_RULES.overtimeMultiplierBasisPoints).toBe(15_000);
  });

  it("the threshold is genuinely consulted, not hardcoded in the loop", () => {
    // Standing rule 50: prove the parameter is wired. Drop the threshold to
    // 35 hours and the same 38-hour week must produce three hours of overtime.
    const punches = [
      punch("2027-01-04", 8),
      punch("2027-01-05", 8),
      punch("2027-01-06", 8),
      punch("2027-01-07", 8),
      punch("2027-01-08", 6),
    ];
    const period = { startDate: "2027-01-03", endDate: "2027-01-09" };
    const normal = computePeriodHours({
      employee: HOURLY,
      period,
      punches,
      settings: SETTINGS,
    });
    const strict = computePeriodHours({
      employee: HOURLY,
      period,
      punches,
      settings: { ...SETTINGS, overtimeThresholdHundredthHours: 3_500 },
    });
    expect(normal.ok && strict.ok).toBe(true);
    if (!normal.ok || !strict.ok) return;
    expect(normal.value.overtimeHundredthHours).toBe(0); // 38 < 40
    expect(strict.value.overtimeHundredthHours).toBe(300); // 38 - 35 = 3.00
  });

  it("the MULTIPLIER is genuinely consulted too", () => {
    const punches = [
      punch("2027-01-04", 10),
      punch("2027-01-05", 10),
      punch("2027-01-06", 10),
      punch("2027-01-07", 10),
      punch("2027-01-08", 6),
    ]; // 46 hours, 6 of them overtime
    const period = { startDate: "2027-01-03", endDate: "2027-01-09" };
    const at15 = computePeriodHours({
      employee: HOURLY,
      period,
      punches,
      settings: SETTINGS,
    });
    const at20 = computePeriodHours({
      employee: HOURLY,
      period,
      punches,
      settings: { ...SETTINGS, overtimeMultiplierBasisPoints: 20_000 },
    });
    expect(at15.ok && at20.ok).toBe(true);
    if (!at15.ok || !at20.ok) return;
    expect(at15.value.overtimePremiumCents).toBe(3_600); // 6h x $6
    expect(at20.value.overtimePremiumCents).toBe(7_200); // 6h x $12
  });
});

// ===========================================================================
// 7) FORMATTING
// ===========================================================================

describe("formatting never uses floating point", () => {
  it("hours", () => {
    expect(formatHundredthHours(0)).toBe("0.00");
    expect(formatHundredthHours(5)).toBe("0.05");
    expect(formatHundredthHours(4_002)).toBe("40.02");
    expect(formatHundredthHours(-250)).toBe("-2.50");
  });
  it("money", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(58_800)).toBe("$588.00");
    expect(formatCents(102_000)).toBe("$1,020.00");
    expect(formatCents(-1_234)).toBe("-$12.34");
  });
});
