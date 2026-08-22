import { describe, it, expect } from "vitest";
import {
  computePeriodHours,
  formatCents,
  formatHundredthHours,
  DEFAULT_OVERTIME_RULES,
  type RawPunch,
  type EmployeePayFacts,
  type TimesheetSettings,
} from "@/lib/payroll/timesheet-core";
import { WORKWEEK_STANDS_ALONE, HOURLY_RATE_EMPLOYEE_EXAMPLE } from "@/lib/payroll/timesheet-authorities";

/* ==========================================================================
 * THE REGULATOR'S OWN ARITHMETIC, EXECUTED
 *
 * Standing rule 60 and the reason this file exists separately from
 * timesheet-core.test.ts.
 *
 * timesheet-core.test.ts was written by whoever wrote the engine, from the
 * same understanding of the rule. If that understanding is wrong, the engine
 * and its test are wrong TOGETHER and both are green. That is the single
 * failure mode a unit test cannot detect about itself.
 *
 * The numbers in this file were not chosen by us. They are printed inside
 * 29 CFR part 778 by the Department of Labor, they are quoted verbatim in
 * timesheet-authorities.ts, and they are checked character-for-character
 * against the mirrored source by scripts/verify-verbatim-quotes.ts. They come
 * from outside the loop.
 *
 * If the engine cannot reproduce the government's own published answer, the
 * build fails, and the failure message is a citation rather than an opinion.
 * ========================================================================== */

/* --------------------------------------------------------------------------
 * FIXTURE SCAFFOLDING
 *
 * Standing rule 55: a fixture broken two ways proves nothing. Everything below
 * is built from ONE anchor instant and ONE spreading helper, so a mistake in
 * the scaffolding shows up as an obviously wrong hours total rather than as a
 * silently compensating pair of errors.
 * -------------------------------------------------------------------------- */

/**
 * Sunday 2027-01-03, 09:00 Pacific.
 *
 * January is Pacific STANDARD time (UTC-8), so 09:00 Pacific is 17:00Z. This
 * is written as an explicit UTC instant rather than a local-time string so the
 * fixture does not depend on the machine's timezone.
 *
 * Sunday is chosen because the workweek anchor below is Sunday, so day 0 of
 * the fixture is day 0 of the workweek and the arithmetic is legible.
 */
const SUNDAY_0900_PACIFIC = Date.parse("2027-01-03T17:00:00.000Z");

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Sunday-anchored workweek, 40-hour threshold, 1.5x. Federal and WA agree. */
const SETTINGS: TimesheetSettings = {
  workweekStartsOn: 0,
  ...DEFAULT_OVERTIME_RULES,
};

/** $12.00/hour expressed in thousandths of a cent, the engine's unit. */
const TWELVE_DOLLARS_MILLICENTS = 12 * 100 * 1000;

function hourlyEmployee(rateMilliCents: number): EmployeePayFacts {
  return {
    employeeId: "emp-1",
    fullName: "Worked Example",
    flsaStatus: "non_exempt",
    basis: "hourly",
    hourlyRateMilliCents: rateMilliCents,
  };
}

/**
 * Lay `totalHours` down as one punch per day starting on `dayOffset`, capped at
 * `maxPerDay` hours in any single day.
 *
 * WHY THE CAP: the engine refuses any single punch longer than 24 hours as
 * IMPLAUSIBLE_SHIFT, which is correct behaviour and must not be circumvented.
 * Ten hours a day is an ordinary retail double shift, so 50 hours in a week is
 * five days of ten rather than one impossible punch. The regulation cares only
 * about the weekly total, so how the hours are distributed across days does not
 * change the expected answer -- and the 40-hours-exactly control below proves
 * the distribution is not secretly driving the result.
 */
function spread(
  idPrefix: string,
  dayOffset: number,
  totalHours: number,
  maxPerDay = 10,
): RawPunch[] {
  const punches: RawPunch[] = [];
  let remaining = totalHours;
  let day = dayOffset;
  let n = 0;
  while (remaining > 0) {
    const today = Math.min(maxPerDay, remaining);
    const start = SUNDAY_0900_PACIFIC + day * DAY_MS;
    const end = start + today * HOUR_MS;
    punches.push({
      id: `${idPrefix}-${n}`,
      employeeId: "emp-1",
      punchKind: "work",
      clockInAt: new Date(start).toISOString(),
      clockOutAt: new Date(end).toISOString(),
      minutes: today * 60,
    });
    remaining -= today;
    day += 1;
    n += 1;
  }
  return punches;
}

/** Unwrap an ok result, failing loudly (not silently) when the engine refused. */
function mustCompute(args: Parameters<typeof computePeriodHours>[0]) {
  const res = computePeriodHours(args);
  if (!res.ok) {
    throw new Error(
      "engine refused a worked example it should have computed: " +
        res.refusals.map((r) => `${r.code}: ${r.message}`).join(" | "),
    );
  }
  return res.value;
}

/* ==========================================================================
 * 1) 29 CFR 778.110(a) -- $12/hour, 46 hours, $588.00
 * ========================================================================== */

describe("29 CFR 778.110(a): the government's own $588 example", () => {
  /*
   * The regulation, quoted verbatim in timesheet-authorities.ts:
   *
   *   "Thus a $12 hourly rate will bring, for an employee who works 46 hours,
   *    a total weekly wage of $588 (46 hours at $12 plus 6 at $6). In other
   *    words, the employee is entitled to be paid an amount equal to $12 an
   *    hour for 40 hours and $18 an hour for the 6 hours of overtime, or a
   *    total of $588."
   *
   * Note the regulation gives TWO decompositions of the same total. Both are
   * asserted below, because a bug that splits the total wrongly while keeping
   * the sum right would pass a total-only test -- and the split is what ends up
   * on the W-2 and the 941.
   */

  const value = mustCompute({
    employee: hourlyEmployee(TWELVE_DOLLARS_MILLICENTS),
    period: { startDate: "2027-01-03", endDate: "2027-01-09" },
    punches: spread("wk", 0, 46),
    settings: SETTINGS,
  });

  it("computes 46.00 hours: 40.00 regular and 6.00 overtime", () => {
    expect(formatHundredthHours(value.totalHundredthHours)).toBe("46.00");
    expect(formatHundredthHours(value.regularHundredthHours)).toBe("40.00");
    expect(formatHundredthHours(value.overtimeHundredthHours)).toBe("6.00");
  });

  it("returns the regulation's total of exactly $588.00", () => {
    expect(value.grossCents).toBe(58_800);
    expect(formatCents(value.grossCents)).toBe("$588.00");
  });

  it("matches decomposition one: 46 hours at $12, plus 6 at $6", () => {
    // "46 hours at $12 plus 6 at $6"
    expect(value.straightTimeCents).toBe(46 * 12 * 100); // $552.00
    expect(value.overtimePremiumCents).toBe(6 * 6 * 100); // $36.00
    expect(formatCents(value.straightTimeCents)).toBe("$552.00");
    expect(formatCents(value.overtimePremiumCents)).toBe("$36.00");
    expect(value.straightTimeCents + value.overtimePremiumCents).toBe(58_800);
  });

  it("matches decomposition two: $12 for 40 hours and $18 for 6 hours", () => {
    // "$12 an hour for 40 hours and $18 an hour for the 6 hours of overtime"
    const fortyAtTwelve = 40 * 12 * 100; // $480.00
    const sixAtEighteen = 6 * 18 * 100; // $108.00
    expect(fortyAtTwelve + sixAtEighteen).toBe(58_800);
    // The engine must agree with the regulation's SECOND framing too, which it
    // reaches by a different arithmetic route than the one it implements.
    expect(value.grossCents).toBe(fortyAtTwelve + sixAtEighteen);
  });

  it("cites the authority it is testing, so a failure names the source", () => {
    expect(HOURLY_RATE_EMPLOYEE_EXAMPLE.cite).toContain("778.110");
    expect(HOURLY_RATE_EMPLOYEE_EXAMPLE.quote).toContain("$588");
    expect(HOURLY_RATE_EMPLOYEE_EXAMPLE.quote).toContain("46 hours");
  });
});

/* ==========================================================================
 * 2) BOUNDARY CONTROLS -- either side of the 40-hour threshold
 *
 * Standing rule 60: without these, an engine that paid overtime on EVERY hour
 * would still produce $588 for 46 hours by coincidence of the fixture. These
 * two cases make that impossible.
 * ========================================================================== */

describe("the 40-hour threshold, from both sides", () => {
  it("40 hours exactly is zero overtime and $480.00", () => {
    const v = mustCompute({
      employee: hourlyEmployee(TWELVE_DOLLARS_MILLICENTS),
      period: { startDate: "2027-01-03", endDate: "2027-01-09" },
      punches: spread("ctl40", 0, 40),
      settings: SETTINGS,
    });
    expect(formatHundredthHours(v.totalHundredthHours)).toBe("40.00");
    expect(v.overtimeHundredthHours).toBe(0);
    expect(v.overtimePremiumCents).toBe(0);
    expect(formatCents(v.grossCents)).toBe("$480.00");
  });

  it("41 hours is exactly one overtime hour and $6.00 of premium", () => {
    const v = mustCompute({
      employee: hourlyEmployee(TWELVE_DOLLARS_MILLICENTS),
      period: { startDate: "2027-01-03", endDate: "2027-01-09" },
      punches: spread("ctl41", 0, 41),
      settings: SETTINGS,
    });
    expect(formatHundredthHours(v.overtimeHundredthHours)).toBe("1.00");
    expect(formatCents(v.overtimePremiumCents)).toBe("$6.00");
    // 41 x $12 = $492.00 straight, + $6.00 premium = $498.00
    expect(formatCents(v.grossCents)).toBe("$498.00");
  });
});

/* ==========================================================================
 * 3) 29 CFR 778.104 -- 30 hours then 50 hours, across ONE pay period
 *
 * This is the defect the whole slice exists to prevent, and the regulation
 * supplies the example.
 * ========================================================================== */

describe("29 CFR 778.104: no averaging across weeks (30 then 50)", () => {
  /*
   * The regulation, verbatim:
   *
   *   "The Act takes a single workweek as its standard and does not permit
   *    averaging of hours over 2 or more weeks. Thus, if an employee works 30
   *    hours one week and 50 hours the next, he must receive overtime
   *    compensation for the overtime hours worked beyond the applicable
   *    maximum in the second week, even though the average number of hours
   *    worked in the 2 weeks is 40."
   *
   * Greenway's pay periods are two weeks long, so this is not a hypothetical:
   * it is the shape of an ordinary Greenway fortnight.
   */

  // Week 1 (Sun 2027-01-03 ..): 30 hours. Week 2 (Sun 2027-01-10 ..): 50 hours.
  const value = mustCompute({
    employee: hourlyEmployee(TWELVE_DOLLARS_MILLICENTS),
    period: { startDate: "2027-01-03", endDate: "2027-01-16" },
    punches: [...spread("w1", 0, 30), ...spread("w2", 7, 50)],
    settings: SETTINGS,
  });

  it("splits the pay period into exactly two whole workweeks", () => {
    expect(value.weeks).toHaveLength(2);
    expect(value.weeks[0].startDate).toBe("2027-01-03");
    expect(value.weeks[1].startDate).toBe("2027-01-10");
    // Neither is partial: a Sunday-anchored fortnight divides cleanly.
    expect(value.weeks.some((w) => w.isPartial)).toBe(false);
    expect(value.partialWeekWarning).toBeNull();
  });

  it("charges the overtime to week two, and none to week one", () => {
    expect(formatHundredthHours(value.weeks[0].totalHundredthHours)).toBe("30.00");
    expect(value.weeks[0].overtimeHundredthHours).toBe(0);

    expect(formatHundredthHours(value.weeks[1].totalHundredthHours)).toBe("50.00");
    expect(formatHundredthHours(value.weeks[1].overtimeHundredthHours)).toBe("10.00");
  });

  it("owes ten overtime hours and $60.00 of premium for the period", () => {
    expect(formatHundredthHours(value.totalHundredthHours)).toBe("80.00");
    expect(formatHundredthHours(value.overtimeHundredthHours)).toBe("10.00");
    // 10 overtime hours x half of $12 = $60.00
    expect(formatCents(value.overtimePremiumCents)).toBe("$60.00");
    // 80 x $12 = $960.00 straight time, plus the $60.00 premium.
    expect(formatCents(value.straightTimeCents)).toBe("$960.00");
    expect(formatCents(value.grossCents)).toBe("$1,020.00");
  });

  it("NAMES the wrong answer and asserts the variance, rather than only avoiding it", () => {
    /*
     * Standing rule 63d: print the variance at the handoff. It is not enough to
     * show the right number; the failure mode has to be computed and shown to
     * differ, or a future reader cannot tell that the test is load-bearing.
     *
     * The averaging mistake: total the whole 2-week period (80 hours) and pay
     * overtime on anything past 80. 80 is not more than 80, so it pays NOTHING.
     */
    const PERIOD_TOTAL_HOURS = 80;
    const AVERAGING_THRESHOLD_HOURS = 80; // 2 x 40, the tempting shortcut
    const averagingOvertimeHours = Math.max(
      0,
      PERIOD_TOTAL_HOURS - AVERAGING_THRESHOLD_HOURS,
    );
    const averagingPremiumCents = averagingOvertimeHours * 6 * 100;

    expect(averagingOvertimeHours).toBe(0);
    expect(averagingPremiumCents).toBe(0);

    // The variance IS the unpaid wage. One employee, one fortnight.
    const varianceCents = value.overtimePremiumCents - averagingPremiumCents;
    expect(varianceCents).toBe(6_000);
    expect(formatCents(varianceCents)).toBe("$60.00");
  });

  it("cites the authority it is testing, so a failure names the source", () => {
    expect(WORKWEEK_STANDS_ALONE.cite).toContain("778.104");
    expect(WORKWEEK_STANDS_ALONE.quote).toContain("does not permit averaging");
    expect(WORKWEEK_STANDS_ALONE.quote).toContain("30 hours one week and 50 hours the next");
  });
});

/* ==========================================================================
 * 4) THE MIRROR IMAGE -- 50 then 30
 *
 * Same 80-hour total, same average, overtime still owed. This proves the
 * engine is looking at each week rather than at the period, and it does so in
 * the order that a period-total bug is LEAST likely to survive by luck.
 * ========================================================================== */

describe("50 then 30 is the same answer as 30 then 50", () => {
  const value = mustCompute({
    employee: hourlyEmployee(TWELVE_DOLLARS_MILLICENTS),
    period: { startDate: "2027-01-03", endDate: "2027-01-16" },
    punches: [...spread("x1", 0, 50), ...spread("x2", 7, 30)],
    settings: SETTINGS,
  });

  it("still owes ten overtime hours, charged to week one this time", () => {
    expect(formatHundredthHours(value.totalHundredthHours)).toBe("80.00");
    expect(formatHundredthHours(value.weeks[0].overtimeHundredthHours)).toBe("10.00");
    expect(value.weeks[1].overtimeHundredthHours).toBe(0);
    expect(formatCents(value.overtimePremiumCents)).toBe("$60.00");
    expect(formatCents(value.grossCents)).toBe("$1,020.00");
  });
});
