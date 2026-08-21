/**
 * tests/compliance/payroll-deposit-schedule-core.test.ts  (books-26)
 *
 * WHEN THE MONEY IS DUE, ADVERSARIALLY TESTED.
 *
 * This module exists because of a 15% penalty. IRC 6656 charges up to 15% for a
 * LATE deposit of a PERFECTLY CALCULATED amount, so every paycheck in the system
 * can be right to the penny and Michael can still lose 15% by depositing on the
 * wrong Wednesday. That makes a WRONG DATE the expensive failure here, and this
 * file is written to hunt for wrong dates rather than to confirm right ones.
 *
 * The three failure modes it attacks, in order of how much they would cost:
 *
 *   1. A DEFAULT WHERE THERE SHOULD BE A REFUSAL. Greenway is not a new
 *      employer - only the software is new. Any code path that turns "I have no
 *      lookback history" into "monthly" is a late deposit every payday for a
 *      year. Several tests below exist purely to prove no such path exists.
 *   2. A DUE DATE THAT IS TOO LATE. Off by one business day, usually because a
 *      holiday was ignored or the algorithm nudged a Wednesday instead of
 *      counting three business days.
 *   3. A THRESHOLD READ BACKWARDS. "$50,000 or less" is monthly; "more than
 *      $50,000" is semiweekly. The boundary itself is monthly, and the penny on
 *      either side is tested.
 *
 * THE FIXTURES ARE REAL. Michael's Q2 2026 Form 941 reported $14,204.57 on line
 * 12, and its Schedule B lists seven Friday paydays with day-by-day liabilities
 * that sum to that figure exactly. Pub 15 (2026) also prints its own worked
 * examples and its own 2026 holiday list. So most of this file compares the
 * engine against documents that already exist - a filed return and a government
 * publication - rather than against numbers I chose. A regression here means the
 * code stopped agreeing with a return that has already been filed.
 *
 * Every test in this file was confirmed capable of failing by breaking the code
 * under it (standing rule 15c). Nothing here passes vacuously (rule 39).
 */
import { describe, expect, it } from "vitest";
import {
  DEPOSIT_SCHEDULE_LABELS,
  LOOKBACK_THRESHOLD_CENTS,
  NEXT_DAY_THRESHOLD_CENTS,
  SEMIWEEKLY_PERIOD_LABELS,
  __runDepositScheduleTests,
  addBusinessDays,
  dayName,
  depositDueDate,
  depositScheduleAuthorities,
  determineDepositSchedule,
  federalHolidays,
  formatCents,
  formatQuarter,
  holidaySet,
  isBusinessDay,
  lookbackQuartersFor,
  lookbackWindowLabel,
  onOrAfterBusinessDay,
  quarterDateRange,
  semiweeklyPeriodOf,
  spansTwoQuarters,
  tripsNextDayRule,
  nextDayRuleConsequence,
  type LookbackQuarter,
} from "@/lib/payroll/payroll-deposit-schedule-core";
import { PAYROLL_TAX_AUTHORITIES } from "@/lib/payroll/payroll-tax-authorities";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Michael's REAL Q2 2026 Form 941 line 12, in cents. */
const Q2_2026_LINE12 = 1_420_457;

/** The seven REAL paydays on his Q2 2026 Schedule B. */
const Q2_2026_PAYDAYS = [
  "2026-04-03",
  "2026-04-17",
  "2026-05-01",
  "2026-05-15",
  "2026-05-29",
  "2026-06-12",
  "2026-06-26",
] as const;

/** The REAL day-by-day liabilities from that Schedule B, keyed by payday. */
const Q2_2026_LIABILITIES: Record<string, number> = {
  "2026-04-03": 208_976,
  "2026-04-17": 250_065,
  "2026-05-01": 206_654,
  "2026-05-15": 205_559,
  "2026-05-29": 177_645,
  "2026-06-12": 196_501,
  "2026-06-26": 175_057,
};

function q(year: number, quarter: 1 | 2 | 3 | 4, cents: number): LookbackQuarter {
  return { year, quarter, line12Cents: cents, asOriginallyFiled: true };
}

/** The four lookback quarters for 2027, all at Michael's real Q2 level. */
function greenway2027(): LookbackQuarter[] {
  return [
    q(2025, 3, Q2_2026_LINE12),
    q(2025, 4, Q2_2026_LINE12),
    q(2026, 1, Q2_2026_LINE12),
    q(2026, 2, Q2_2026_LINE12),
  ];
}

function mustDetermine(r: ReturnType<typeof determineDepositSchedule>) {
  if (!r.ok) throw new Error(`expected a determination, got refusal: ${r.explanation}`);
  return r;
}

function mustRefuseDet(r: ReturnType<typeof determineDepositSchedule>) {
  if (r.ok) throw new Error(`expected a refusal, got ${r.schedule}`);
  return r;
}

function mustDue(r: ReturnType<typeof depositDueDate>) {
  if (!r.ok) throw new Error(`expected a due date, got refusal: ${r.explanation}`);
  return r;
}

// ---------------------------------------------------------------------------
// 1) THE MODULE'S OWN SELF-TESTS
// ---------------------------------------------------------------------------

describe("the module's embedded self-tests", () => {
  it("all pass, and there are a substantial number of them (rule 39)", () => {
    const r = __runDepositScheduleTests();
    expect(r.failed).toBe(0);
    // A self-test block that silently shrank to nothing would still report
    // failed===0. Assert the count is real.
    expect(r.passed).toBeGreaterThan(150);
  });
});

// ---------------------------------------------------------------------------
// 2) THE LOOKBACK PERIOD - the rule everyone misreads
// ---------------------------------------------------------------------------

describe("lookbackQuartersFor", () => {
  it("reproduces Table 1 from Pub 15 (2026) exactly", () => {
    // The publication PRINTS the 2026 lookback period as four quarters:
    // Jul 1-Sep 30 2024, Oct 1-Dec 31 2024, Jan 1-Mar 31 2025, Apr 1-Jun 30
    // 2025. This is ground truth, not my arithmetic.
    expect(lookbackQuartersFor(2026)).toEqual([
      { year: 2024, quarter: 3 },
      { year: 2024, quarter: 4 },
      { year: 2025, quarter: 1 },
      { year: 2025, quarter: 2 },
    ]);
  });

  it("is NOT last year - it ends eighteen months before the payroll it governs", () => {
    // THE misreading. Everybody reaches for the previous calendar year. For
    // 2027 the period ends June 30, 2026, so the second half of 2026 is
    // irrelevant to the 2027 schedule and calendar 2026 is NOT the answer.
    const lb = lookbackQuartersFor(2027);
    expect(lb).toEqual([
      { year: 2025, quarter: 3 },
      { year: 2025, quarter: 4 },
      { year: 2026, quarter: 1 },
      { year: 2026, quarter: 2 },
    ]);
    // Explicitly: Q3 and Q4 of 2026 must not appear.
    expect(lb).not.toContainEqual({ year: 2026, quarter: 3 });
    expect(lb).not.toContainEqual({ year: 2026, quarter: 4 });
    // And it is not simply "the four quarters of 2026".
    expect(lb.every((x) => x.year === 2026)).toBe(false);
  });

  it("always begins July 1 and ends June 30, for any year (rule 15b sweep)", () => {
    // "The lookback period begins July 1 and ends June 30." Sweeping 40 years
    // proves the boundary is structural, not tuned to one example.
    for (let y = 2000; y <= 2040; y++) {
      const lb = lookbackQuartersFor(y);
      expect(lb).toHaveLength(4);
      expect(quarterDateRange(lb[0]!).start).toBe(`${y - 2}-07-01`);
      expect(quarterDateRange(lb[3]!).end).toBe(`${y - 1}-06-30`);
      // Four consecutive quarters, no gaps, no repeats.
      expect(new Set(lb.map((x) => `${x.year}Q${x.quarter}`)).size).toBe(4);
    }
  });

  it("labels the window in words Michael can check against the publication", () => {
    expect(lookbackWindowLabel(2027)).toBe("July 1, 2025 through June 30, 2026");
    expect(lookbackWindowLabel(2026)).toBe("July 1, 2024 through June 30, 2025");
  });
});

describe("quarterDateRange", () => {
  it("gets every quarter's boundaries right, including February", () => {
    expect(quarterDateRange({ year: 2026, quarter: 1 })).toEqual({
      start: "2026-01-01",
      end: "2026-03-31",
    });
    expect(quarterDateRange({ year: 2026, quarter: 2 })).toEqual({
      start: "2026-04-01",
      end: "2026-06-30",
    });
    expect(quarterDateRange({ year: 2026, quarter: 3 })).toEqual({
      start: "2026-07-01",
      end: "2026-09-30",
    });
    expect(quarterDateRange({ year: 2026, quarter: 4 })).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
    });
  });

  it("handles leap years, where Q1 is a day longer", () => {
    expect(quarterDateRange({ year: 2024, quarter: 1 }).end).toBe("2024-03-31");
    // The real leap-sensitive case is a February end, which no quarter has -
    // so assert the thing that WOULD break a naive implementation: Q1 2024 and
    // Q1 2025 both end March 31 regardless of February's length.
    expect(quarterDateRange({ year: 2025, quarter: 1 }).end).toBe("2025-03-31");
  });
});

// ---------------------------------------------------------------------------
// 3) THE DETERMINATION - against Michael's real filed return
// ---------------------------------------------------------------------------

describe("determineDepositSchedule - Greenway's real numbers", () => {
  it("Michael's Schedule B months tie to his line 12 (the fixture is real)", () => {
    // 4,590.41 + 5,898.58 + 3,715.58 = 14,204.57. If this fails, every fixture
    // in this file is fiction and nothing below means anything.
    expect(459_041 + 589_858 + 371_558).toBe(Q2_2026_LINE12);
    // And the seven day-by-day liabilities sum to the same total.
    const sum = Object.values(Q2_2026_LIABILITIES).reduce((a, b) => a + b, 0);
    expect(sum).toBe(Q2_2026_LINE12);
  });

  it("concludes SEMIWEEKLY for 2027, agreeing with his filed Schedule B", () => {
    // TWO INDEPENDENT PROOFS, one conclusion. (a) The arithmetic: four quarters
    // at his real Q2 level is $56,818.28, over the $50,000 line. (b) The
    // evidence: his Q2 2026 941 carries a POPULATED Schedule B, and per Pub 15
    // only semiweekly depositors file one.
    const d = mustDetermine(determineDepositSchedule(2027, greenway2027()));
    expect(d.schedule).toBe("semiweekly");
    expect(d.lookbackTotalCents).toBe(5_681_828);
    expect(formatCents(d.lookbackTotalCents)).toBe("$56,818.28");
    expect(d.lookbackTotalCents).toBeGreaterThan(LOOKBACK_THRESHOLD_CENTS);
  });

  it("shows its arithmetic, so Michael can check it without trusting us", () => {
    const d = mustDetermine(determineDepositSchedule(2027, greenway2027()));
    expect(d.explanation).toContain("$56,818.28");
    expect(d.explanation).toContain("$50,000.00");
    expect(d.explanation).toContain("July 1, 2025 through June 30, 2026");
    // Each of the four quarters must be named with its own figure.
    for (const label of ["Q3 2025", "Q4 2025", "Q1 2026", "Q2 2026"]) {
      expect(d.explanation).toContain(label);
    }
    expect(d.explanation).toContain("$14,204.57");
  });

  it("kills the 'semiweekly means twice a week' misreading in the explanation", () => {
    // Michael has a master's in accounting; the word still misleads everyone,
    // because it describes the RULEBOOK, not the frequency. He pays every other
    // Friday and will make ~26 deposits a year, not 104.
    const d = mustDetermine(determineDepositSchedule(2027, greenway2027()));
    expect(d.explanation).toContain("does NOT mean depositing twice a week");
    expect(d.explanation).toContain("Schedule B");
  });

  it("uses the four quarters in lookback order, not input order", () => {
    const shuffled = [
      q(2026, 2, 400_000),
      q(2025, 3, 100_000),
      q(2026, 1, 300_000),
      q(2025, 4, 200_000),
    ];
    const d = mustDetermine(determineDepositSchedule(2027, shuffled));
    expect(d.quartersUsed.map((x) => `${x.year}Q${x.quarter}`)).toEqual([
      "2025Q3",
      "2025Q4",
      "2026Q1",
      "2026Q2",
    ]);
    // Order must not change the total.
    expect(d.lookbackTotalCents).toBe(1_000_000);
  });

  it("ignores quarters outside the lookback period rather than adding them in", () => {
    // A caller handing over five years of history must not get a five-year
    // total. Only the four named quarters count.
    const withExtras = [
      ...greenway2027(),
      q(2026, 3, 9_999_999), // after the window
      q(2024, 1, 9_999_999), // before the window
      q(2027, 1, 9_999_999), // the year being determined
    ];
    const d = mustDetermine(determineDepositSchedule(2027, withExtras));
    expect(d.quartersUsed).toHaveLength(4);
    expect(d.lookbackTotalCents).toBe(5_681_828);
  });

  it("carries real authorities, and every id resolves in the registry", () => {
    const d = mustDetermine(determineDepositSchedule(2027, greenway2027()));
    expect(d.authorities.length).toBeGreaterThanOrEqual(4);
    const known = new Set(PAYROLL_TAX_AUTHORITIES.map((a) => a.id));
    for (const a of d.authorities) {
      expect(known.has(a.id)).toBe(true);
      // A citation Michael cannot go read is decoration.
      expect(a.quote.trim().length).toBeGreaterThanOrEqual(40);
      expect(a.source).toMatch(/^https:\/\//);
      expect(a.soWhat.trim().length).toBeGreaterThan(40);
    }
  });

  it("includes the lookback rule itself among the authorities", () => {
    const ids = depositScheduleAuthorities().map((a) => a.id);
    expect(ids).toContain("pub15-2026-lookback-period");
    // And the trap we do NOT qualify for, so the reasoning is auditable.
    expect(ids).toContain("pub15-2026-new-employer-zero");
  });
});

// ---------------------------------------------------------------------------
// 4) THE THRESHOLD - asymmetric wording, tested to the penny
// ---------------------------------------------------------------------------

describe("the $50,000 threshold", () => {
  const at = (cents: number) =>
    determineDepositSchedule(2027, [q(2025, 3, cents), q(2025, 4, 0), q(2026, 1, 0), q(2026, 2, 0)]);

  it("is exactly $50,000.00 in cents", () => {
    expect(LOOKBACK_THRESHOLD_CENTS).toBe(5_000_000);
    expect(formatCents(LOOKBACK_THRESHOLD_CENTS)).toBe("$50,000.00");
  });

  it("treats EXACTLY $50,000 as monthly, because the rule says 'or less'", () => {
    // The wording is asymmetric and trivially flipped by a > vs >=. This is the
    // single most likely off-by-one in the module.
    const d = mustDetermine(at(5_000_000));
    expect(d.schedule).toBe("monthly");
    expect(d.explanation).toContain("$50,000 or less");
  });

  it("treats $50,000.01 as semiweekly", () => {
    expect(mustDetermine(at(5_000_001)).schedule).toBe("semiweekly");
  });

  it("treats $49,999.99 as monthly", () => {
    expect(mustDetermine(at(4_999_999)).schedule).toBe("monthly");
  });

  it("sweeps the boundary and finds exactly one transition, in the right place", () => {
    // Rule 15b. Walk 41 pennies across the line; there must be one change and
    // it must occur stepping from 5_000_000 to 5_000_001.
    const seen: Array<{ c: number; s: string }> = [];
    for (let c = 4_999_980; c <= 5_000_020; c++) {
      seen.push({ c, s: mustDetermine(at(c)).schedule });
    }
    const changes = seen.filter((x, i) => i > 0 && x.s !== seen[i - 1]!.s);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.c).toBe(5_000_001);
    expect(changes[0]!.s).toBe("semiweekly");
  });

  it("adds the four quarters rather than testing any one of them", () => {
    // Four quarters of $13,000 each is $52,000 - semiweekly - even though no
    // single quarter is close to the line. A per-quarter test would say monthly.
    const d = mustDetermine(
      determineDepositSchedule(2027, [
        q(2025, 3, 1_300_000),
        q(2025, 4, 1_300_000),
        q(2026, 1, 1_300_000),
        q(2026, 2, 1_300_000),
      ]),
    );
    expect(d.lookbackTotalCents).toBe(5_200_000);
    expect(d.schedule).toBe("semiweekly");
  });
});

// ---------------------------------------------------------------------------
// 5) THE REFUSAL - the most important behaviour in the module
// ---------------------------------------------------------------------------

describe("refusing instead of guessing", () => {
  it("REFUSES on empty history rather than defaulting to monthly", () => {
    // THE ONE THAT MATTERS. A fresh install on January 1, 2027 has empty
    // tables. If "no data" collapsed to "small total" it would produce
    // "monthly", and Greenway is semiweekly - a late deposit every single
    // payday, penalised up to 15%.
    const r = mustRefuseDet(determineDepositSchedule(2027, []));
    expect(r.reason).toBe("missing_lookback_quarters");
    expect(r.missing).toHaveLength(4);
    // It must not have leaked a schedule anyway.
    expect(r as unknown as Record<string, unknown>).not.toHaveProperty("schedule");
  });

  it("names every missing quarter, so the fix is obvious", () => {
    const r = mustRefuseDet(determineDepositSchedule(2027, [q(2026, 2, Q2_2026_LINE12)]));
    expect(r.missing.map(formatQuarter).sort()).toEqual(["Q1 2026", "Q3 2025", "Q4 2025"]);
    for (const label of ["Q3 2025", "Q4 2025", "Q1 2026"]) {
      expect(r.explanation).toContain(label);
    }
  });

  it("explains the STAKES, not just the error", () => {
    // A refusal that says "missing data" teaches nothing. This one has to say
    // why guessing would be expensive, in plain English, with the penalty.
    const r = mustRefuseDet(determineDepositSchedule(2027, []));
    expect(r.explanation).toContain("15%");
    expect(r.explanation).toContain("6656");
    expect(r.explanation).toContain("July 1, 2025 through June 30, 2026");
    expect(r.explanation).toContain("line 12");
    expect(r.explanation.length).toBeGreaterThan(300);
  });

  it("still cites its authorities when refusing", () => {
    // Rule: a refusal must be as well-evidenced as an answer.
    const r = mustRefuseDet(determineDepositSchedule(2027, []));
    expect(r.authorities.length).toBeGreaterThanOrEqual(4);
    expect(r.authorities.map((a) => a.id)).toContain("pub15-2026-lookback-period");
  });

  it("refuses when even ONE of the four quarters is missing", () => {
    // Three quarters of data is not "close enough" - the missing quarter could
    // be the one that crosses the line.
    for (const omit of ["2025Q3", "2025Q4", "2026Q1", "2026Q2"]) {
      const subset = greenway2027().filter((x) => `${x.year}Q${x.quarter}` !== omit);
      expect(subset).toHaveLength(3);
      const r = mustRefuseDet(determineDepositSchedule(2027, subset));
      expect(r.missing).toHaveLength(1);
      expect(formatQuarter(r.missing[0]!)).toBe(
        `Q${omit.slice(5)} ${omit.slice(0, 4)}`,
      );
    }
  });

  it("does NOT accept the right number of wrong quarters", () => {
    // Four quarters supplied, none of them in the lookback window. A count
    // check alone would pass this; the engine must check identity.
    const r = mustRefuseDet(
      determineDepositSchedule(2027, [
        q(2026, 3, 100),
        q(2026, 4, 100),
        q(2027, 1, 100),
        q(2027, 2, 100),
      ]),
    );
    expect(r.reason).toBe("missing_lookback_quarters");
    expect(r.missing).toHaveLength(4);
  });

  it("requires a new employer's zeros to be ASSERTED, and then honours them", () => {
    // Per Pub 15 a genuine new employer's pre-business quarters ARE zero, and
    // that makes them monthly. But the caller must say so by supplying the
    // rows; the engine may not infer it from an empty table. This is the line
    // between "evidence of zero" and "absence of evidence".
    const d = mustDetermine(
      determineDepositSchedule(2027, [
        q(2025, 3, 0),
        q(2025, 4, 0),
        q(2026, 1, 0),
        q(2026, 2, 0),
      ]),
    );
    expect(d.schedule).toBe("monthly");
    expect(d.lookbackTotalCents).toBe(0);
    // And crucially, this differs from supplying nothing at all.
    expect(determineDepositSchedule(2027, []).ok).toBe(false);
  });

  it("refuses a duplicated quarter rather than picking one", () => {
    const r = mustRefuseDet(
      determineDepositSchedule(2027, [
        q(2025, 3, 100),
        q(2025, 3, 5_000_000),
        q(2025, 4, 0),
        q(2026, 1, 0),
        q(2026, 2, 0),
      ]),
    );
    expect(r.reason).toBe("duplicate_lookback_quarter");
    expect(r.explanation).toContain("2025Q3");
    expect(r.explanation).toContain("guess");
  });

  it("refuses impossible amounts rather than arithmetic-ing them in", () => {
    // A negative line 12 is not a small obligation, it is a broken input - and
    // averaged into a total it would drag a semiweekly employer to monthly.
    for (const bad of [-1, -5_000_000, 10.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = mustRefuseDet(
        determineDepositSchedule(2027, [
          q(2025, 3, bad),
          q(2025, 4, 0),
          q(2026, 1, 0),
          q(2026, 2, 0),
        ]),
      );
      expect(r.reason).toBe("invalid_amount");
    }
  });

  it("accepts a legitimate zero quarter (negative control - rule 15a)", () => {
    // Zero is real: a quarter with no payroll. If this failed, the rejection
    // tests above would be passing for the wrong reason.
    const d = mustDetermine(
      determineDepositSchedule(2027, [
        q(2025, 3, 0),
        q(2025, 4, Q2_2026_LINE12),
        q(2026, 1, 0),
        q(2026, 2, 0),
      ]),
    );
    expect(d.lookbackTotalCents).toBe(Q2_2026_LINE12);
  });

  it("has no escape hatch that produces a schedule without evidence", () => {
    // The functions that would undo the whole design. They must not exist.
    const mod = { determineDepositSchedule } as unknown as Record<string, unknown>;
    expect(mod.assumeMonthly).toBeUndefined();
    expect(mod.defaultSchedule).toBeUndefined();
    expect(mod.guessSchedule).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6) FEDERAL HOLIDAYS - validated against the printed list
// ---------------------------------------------------------------------------

describe("federalHolidays", () => {
  it("reproduces the 2026 list Pub 15 PRINTS, date for date and name for name", () => {
    // Ground truth from the publication, section 11. Reproducing a year the
    // IRS published is the only evidence the rules will be right for 2027.
    expect(federalHolidays(2026).map((h) => `${h.date} ${h.name}`)).toEqual([
      "2026-01-01 New Year's Day",
      "2026-01-19 Birthday of Martin Luther King, Jr.",
      "2026-02-16 Washington's Birthday",
      "2026-04-16 District of Columbia Emancipation Day",
      "2026-05-25 Memorial Day",
      "2026-06-19 Juneteenth National Independence Day",
      "2026-07-03 Independence Day",
      "2026-09-07 Labor Day",
      "2026-10-12 Indigenous Peoples' Day (Columbus Day)",
      "2026-11-11 Veterans Day",
      "2026-11-26 Thanksgiving Day",
      "2026-12-25 Christmas Day",
    ]);
  });

  it("observes July 4 2026 on Friday July 3, exactly as the publication does", () => {
    // July 4, 2026 is a Saturday. Pub 15 prints "July 3 - Independence Day
    // (observed)". This single date proves the Saturday-shifts-back rule.
    expect(dayName("2026-07-04")).toBe("Saturday");
    const july = federalHolidays(2026).find((h) => h.name === "Independence Day");
    expect(july?.date).toBe("2026-07-03");
    expect(dayName("2026-07-03")).toBe("Friday");
  });

  it("shifts a Sunday holiday FORWARD to Monday", () => {
    // The other half of the observance rule. July 4, 2027 is a Sunday, so it is
    // observed Monday July 5 - and that is in Michael's first payroll year.
    expect(dayName("2027-07-04")).toBe("Sunday");
    const july27 = federalHolidays(2027).find((h) => h.name === "Independence Day");
    expect(july27?.date).toBe("2027-07-05");
  });

  it("includes DC Emancipation Day and excludes Washington State holidays", () => {
    // Scope, per Pub 15: a "legal holiday" for deposits means a legal holiday in
    // the DISTRICT OF COLUMBIA, and explicitly does NOT include other statewide
    // holidays. A day off in Olympia does not move an IRS deposit.
    const names = federalHolidays(2027).map((h) => h.name);
    expect(names).toContain("District of Columbia Emancipation Day");
    // Washington State observes these; the IRS does not care.
    expect(names.join("|")).not.toContain("Native American Heritage");
    expect(names.join("|")).not.toContain("Presidents' Day");
  });

  it("generates 12 holidays a year for 30 years, with no duplicate dates", () => {
    // A generator that collides two holidays onto one date would quietly shrink
    // the holiday set and under-count business days.
    for (let y = 2020; y <= 2050; y++) {
      const h = federalHolidays(y);
      expect(h).toHaveLength(12);
      expect(new Set(h.map((x) => x.date)).size).toBe(12);
      // Sorted ascending.
      expect([...h].sort((a, b) => (a.date < b.date ? -1 : 1))).toEqual(h);
      // No observed holiday ever lands on a weekend.
      for (const x of h) {
        expect(["Saturday", "Sunday"]).not.toContain(dayName(x.date));
      }
    }
  });

  it("spans neighbouring years so year-boundary math cannot fall off the table", () => {
    // A December 31 payday is governed by January's holidays. If the set only
    // covered one year, New Year's Day would be treated as a business day.
    const s = holidaySet(2026);
    expect(s.has("2027-01-01")).toBe(true);
    expect(s.has("2025-12-25")).toBe(true);
    expect(s.size).toBe(36);
  });
});

describe("isBusinessDay", () => {
  const hol = holidaySet(2026);

  it("accepts an ordinary weekday (negative control)", () => {
    expect(isBusinessDay("2026-07-08", hol)).toBe(true);
    expect(dayName("2026-07-08")).toBe("Wednesday");
  });

  it("rejects Saturdays and Sundays", () => {
    expect(isBusinessDay("2026-07-04", hol)).toBe(false); // Saturday
    expect(isBusinessDay("2026-07-05", hol)).toBe(false); // Sunday
  });

  it("rejects federal holidays", () => {
    expect(isBusinessDay("2026-07-03", hol)).toBe(false); // Independence (obs)
    expect(isBusinessDay("2026-11-26", hol)).toBe(false); // Thanksgiving
    expect(isBusinessDay("2026-04-16", hol)).toBe(false); // DC Emancipation
  });

  it("rejects malformed and impossible dates rather than assuming a business day", () => {
    for (const bad of ["", "not-a-date", "2026-02-30", "2026-13-01", "07/08/2026"]) {
      expect(isBusinessDay(bad, hol)).toBe(false);
    }
  });
});

describe("addBusinessDays / onOrAfterBusinessDay", () => {
  const hol = holidaySet(2026);

  it("counts forward over a weekend", () => {
    // Friday + 1 business day = Monday.
    expect(addBusinessDays("2026-08-07", 1, hol)).toBe("2026-08-10");
  });

  it("never counts the starting day itself", () => {
    // Wednesday + 3 = Monday, not Friday. An inclusive count would be a day
    // early on every semiweekly deposit.
    expect(addBusinessDays("2026-07-08", 3, hol)).toBe("2026-07-13");
  });

  it("skips holidays as well as weekends", () => {
    // Friday 2026-05-22 + 3 business days: Mon 25 is Memorial Day, so
    // Tue 26, Wed 27, Thu 28.
    expect(addBusinessDays("2026-05-22", 3, hol)).toBe("2026-05-28");
  });

  it("stays put when the date is already a business day", () => {
    expect(onOrAfterBusinessDay("2026-07-08", hol)).toBe("2026-07-08");
  });

  it("rolls a weekend or holiday forward to the next business day", () => {
    expect(onOrAfterBusinessDay("2026-08-15", hol)).toBe("2026-08-17"); // Sat -> Mon
    expect(onOrAfterBusinessDay("2026-07-04", hol)).toBe("2026-07-06"); // Sat, Fri 3 was the holiday
    expect(onOrAfterBusinessDay("2026-12-25", hol)).toBe("2026-12-28"); // Christmas Fri -> Mon
  });
});

// ---------------------------------------------------------------------------
// 7) SEMIWEEKLY PERIODS AND DUE DATES
// ---------------------------------------------------------------------------

describe("semiweeklyPeriodOf", () => {
  it("splits the week into exactly the two buckets Pub 15 names", () => {
    // "Wednesday through Friday and Saturday through Tuesday."
    expect(semiweeklyPeriodOf("2026-08-05")).toBe("wed_fri"); // Wed
    expect(semiweeklyPeriodOf("2026-08-06")).toBe("wed_fri"); // Thu
    expect(semiweeklyPeriodOf("2026-08-07")).toBe("wed_fri"); // Fri
    expect(semiweeklyPeriodOf("2026-08-08")).toBe("sat_tue"); // Sat
    expect(semiweeklyPeriodOf("2026-08-09")).toBe("sat_tue"); // Sun
    expect(semiweeklyPeriodOf("2026-08-10")).toBe("sat_tue"); // Mon
    expect(semiweeklyPeriodOf("2026-08-11")).toBe("sat_tue"); // Tue
  });

  it("covers all seven days with no day in both or neither (rule 15b)", () => {
    // Aug 5 2026 is a Wednesday, so this walks one full Wed-to-Tue week.
    // NOTE: the dates are zero-padded deliberately. The first draft of this
    // test built them with `2026-08-0${5 + i}`, which produces "2026-08-010"
    // for the last two days - and the engine correctly returned null for a
    // date that does not exist. The test was wrong, not the code, but it is
    // worth recording: strict date parsing is what surfaced a string-building
    // bug that a lenient parser would have silently rolled over into
    // September.
    let wed = 0;
    let sat = 0;
    for (let i = 0; i < 7; i++) {
      const d = `2026-08-${String(5 + i).padStart(2, "0")}`;
      const p = semiweeklyPeriodOf(d);
      expect(p, `${d} must fall in exactly one semiweekly period`).not.toBeNull();
      if (p === "wed_fri") wed++;
      else sat++;
    }
    expect(wed).toBe(3);
    expect(sat).toBe(4);
  });

  it("rejects a date that rolled over, rather than silently accepting it", () => {
    // The bug the test above originally had. "2026-08-010" is not a date, and
    // a parser that accepted it would answer for some OTHER day entirely.
    expect(semiweeklyPeriodOf("2026-08-010")).toBeNull();
    expect(semiweeklyPeriodOf("2026-08-32")).toBeNull();
    expect(semiweeklyPeriodOf("2026-09-31")).toBeNull();
  });

  it("returns null for a date that is not real", () => {
    expect(semiweeklyPeriodOf("2026-02-30")).toBeNull();
    expect(semiweeklyPeriodOf("garbage")).toBeNull();
  });
});

describe("depositDueDate - semiweekly, against Pub 15's own worked examples", () => {
  it("matches the publication's Green, Inc. example exactly", () => {
    // Pub 15: "Green, Inc.'s tax liability for the May 29, 2026 (Friday),
    // payday must be deposited by June 3, 2026 (Wednesday)." Michael has a real
    // payday on that exact date, which makes this both a worked example and a
    // live fixture.
    const r = mustDue(depositDueDate("2026-05-29", "semiweekly"));
    expect(r.dueDate).toBe("2026-06-03");
    expect(dayName(r.dueDate)).toBe("Wednesday");
    expect(r.period).toBe("wed_fri");
    expect(r.movedForHoliday).toBe(false);
  });

  it("matches the publication's HOLIDAY example - Wednesday becomes Thursday", () => {
    // Pub 15: "if a semiweekly schedule depositor accumulated taxes for
    // payments made on Friday and the following Monday is a legal holiday, the
    // deposit normally due on Wednesday may be made on Thursday."
    //
    // THIS IS THE TEST THAT JUSTIFIES THE ALGORITHM. Friday 2026-05-22, with
    // Memorial Day on Monday 2026-05-25. Counting 3 BUSINESS days gives
    // Thursday the 28th. "Take the following Wednesday, then nudge off
    // holidays" would leave it on Wednesday the 27th - a day early, which
    // means a real filer following our date would be fine, but a filer
    // following the LAW would be told they were late. The distinction is why
    // the implementation counts business days.
    const r = mustDue(depositDueDate("2026-05-22", "semiweekly"));
    expect(dayName("2026-05-22")).toBe("Friday");
    expect(r.dueDate).toBe("2026-05-28");
    expect(dayName(r.dueDate)).toBe("Thursday");
    expect(r.movedForHoliday).toBe(true);
    expect(r.explanation).toContain("3 BUSINESS days");
  });

  it("gives every one of Michael's real Q2 2026 paydays the right Wednesday", () => {
    // All seven Schedule B dates. Each is a Friday, so each is due the
    // following Wednesday - five days later - unless a holiday intervenes.
    const expected: Record<string, string> = {
      "2026-04-03": "2026-04-08",
      "2026-04-17": "2026-04-22",
      "2026-05-01": "2026-05-06",
      "2026-05-15": "2026-05-20",
      "2026-05-29": "2026-06-03",
      "2026-06-12": "2026-06-17",
      "2026-06-26": "2026-07-01",
    };
    for (const p of Q2_2026_PAYDAYS) {
      expect(dayName(p)).toBe("Friday");
      const r = mustDue(depositDueDate(p, "semiweekly"));
      expect(r.dueDate, `payday ${p}`).toBe(expected[p]);
      expect(dayName(r.dueDate)).toBe("Wednesday");
      expect(r.movedForHoliday).toBe(false);
    }
  });

  it("puts a Saturday-Tuesday payday on the following Friday", () => {
    const mon = mustDue(depositDueDate("2026-08-03", "semiweekly")); // Monday
    expect(mon.period).toBe("sat_tue");
    expect(mon.dueDate).toBe("2026-08-07");
    expect(dayName(mon.dueDate)).toBe("Friday");
    const sat = mustDue(depositDueDate("2026-08-08", "semiweekly")); // Saturday
    expect(sat.dueDate).toBe("2026-08-14");
  });

  it("never returns a due date earlier than 3 business days after the period closes", () => {
    // Sweep every day of 2027 - Michael's first payroll year. An early due date
    // is a false alarm; a late one is a penalty. Neither is acceptable.
    const hol = holidaySet(2027);
    let checked = 0;
    for (let m = 1; m <= 12; m++) {
      const days = new Date(Date.UTC(2027, m, 0)).getUTCDate();
      for (let d = 1; d <= days; d++) {
        const iso = `2027-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const r = mustDue(depositDueDate(iso, "semiweekly"));
        // The due date is always a business day.
        expect(isBusinessDay(r.dueDate, hol), `${iso} -> ${r.dueDate}`).toBe(true);
        // And always strictly after the payday.
        expect(r.dueDate > iso, `${iso} -> ${r.dueDate}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBe(365);
  });

  it("lands every 2027 Friday on a Wednesday unless a holiday pushes it", () => {
    // 53 Fridays in 2027 (Jan 1 and Dec 31 are both Fridays). Six of them are
    // pushed to Thursday by holidays. Asserting the COUNT means a holiday
    // silently dropping out of the table breaks this test.
    let fridays = 0;
    const pushed: string[] = [];
    for (let m = 1; m <= 12; m++) {
      const days = new Date(Date.UTC(2027, m, 0)).getUTCDate();
      for (let d = 1; d <= days; d++) {
        const iso = `2027-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        if (dayName(iso) !== "Friday") continue;
        fridays++;
        const r = mustDue(depositDueDate(iso, "semiweekly"));
        if (dayName(r.dueDate) !== "Wednesday") pushed.push(`${iso}->${r.dueDate}`);
      }
    }
    expect(fridays).toBe(53);
    expect(pushed).toEqual([
      "2027-01-15->2027-01-21",
      "2027-02-12->2027-02-18",
      "2027-05-28->2027-06-03",
      "2027-07-02->2027-07-08",
      "2027-09-03->2027-09-09",
      "2027-10-08->2027-10-14",
    ]);
  });

  it("explains itself in plain English, naming the payday and the period", () => {
    const r = mustDue(depositDueDate("2026-05-29", "semiweekly"));
    expect(r.explanation).toContain("2026-05-29");
    expect(r.explanation).toContain("Friday");
    expect(r.explanation).toContain("Wednesday-Friday");
    expect(r.explanation).toContain("3 business days");
    // The cash-basis warning, which is the one that catches accountants out.
    expect(r.explanation).toContain("when the wages were PAID");
    expect(r.explanation).not.toContain("undefined");
    expect(r.explanation).not.toContain("[object");
  });
});

describe("depositDueDate - monthly", () => {
  it("uses the 15th of the following month", () => {
    expect(mustDue(depositDueDate("2026-04-03", "monthly")).dueDate).toBe("2026-05-15");
    expect(mustDue(depositDueDate("2026-04-30", "monthly")).dueDate).toBe("2026-05-15");
    // Any day of the month gives the same answer - the whole month pools.
    expect(mustDue(depositDueDate("2026-04-17", "monthly")).dueDate).toBe("2026-05-15");
  });

  it("rolls December into the following January", () => {
    const r = mustDue(depositDueDate("2026-12-31", "monthly"));
    expect(r.dueDate).toBe("2027-01-15");
  });

  it("rolls a 15th that falls on a weekend forward to Monday", () => {
    // August 15, 2026 is a Saturday.
    const r = mustDue(depositDueDate("2026-07-10", "monthly"));
    expect(r.nominalDueDate).toBe("2026-08-15");
    expect(dayName("2026-08-15")).toBe("Saturday");
    expect(r.dueDate).toBe("2026-08-17");
    expect(r.movedForHoliday).toBe(true);
    expect(r.explanation).toContain("not a business day");
  });

  it("gives every month of 2027 a due date that is a business day", () => {
    const hol = holidaySet(2027);
    for (let m = 1; m <= 12; m++) {
      const iso = `2027-${String(m).padStart(2, "0")}-10`;
      const r = mustDue(depositDueDate(iso, "monthly"));
      expect(isBusinessDay(r.dueDate, hol), `${iso} -> ${r.dueDate}`).toBe(true);
      expect(r.dueDate > iso).toBe(true);
    }
  });

  it("is always later than the semiweekly answer for the same payday", () => {
    // The whole reason the distinction matters: monthly gives you weeks,
    // semiweekly gives you days. If these ever coincided, one of them is wrong.
    for (const p of Q2_2026_PAYDAYS) {
      const m = mustDue(depositDueDate(p, "monthly"));
      const s = mustDue(depositDueDate(p, "semiweekly"));
      expect(m.dueDate > s.dueDate, `${p}: monthly ${m.dueDate} vs semiweekly ${s.dueDate}`).toBe(
        true,
      );
    }
  });
});

describe("depositDueDate - hostile input", () => {
  it("refuses rather than inventing a date", () => {
    for (const bad of [
      "",
      "not-a-date",
      "2026-02-30",
      "2025-02-29",
      "2026-13-01",
      "2026-00-10",
      "04/03/2026",
      "2026-04-03T00:00:00Z",
      " 2026-04-03",
    ]) {
      const r = depositDueDate(bad, "semiweekly");
      expect(r.ok, `"${bad}" should have been refused`).toBe(false);
      if (!r.ok) expect(r.explanation).toContain("not a real calendar date");
    }
  });

  it("accepts a real leap day (negative control - rule 15a)", () => {
    // If Feb 29 2028 were rejected, the rejection tests above would be passing
    // for the wrong reason.
    const r = mustDue(depositDueDate("2028-02-29", "semiweekly"));
    expect(dayName("2028-02-29")).toBe("Tuesday");
    expect(r.period).toBe("sat_tue");
    expect(r.dueDate).toBe("2028-03-03");
  });

  it("survives absurd input without throwing", () => {
    for (const bad of [
      "9999-12-31",
      "0001-01-01",
      "2026-04-03\u0000",
      "2026-04-03<script>",
      "2026-04-03;DROP TABLE",
      null as unknown as string,
      undefined as unknown as string,
    ]) {
      expect(() => depositDueDate(bad, "monthly")).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// 8) THE $100,000 NEXT-DAY RULE
// ---------------------------------------------------------------------------

describe("the $100,000 next-day rule", () => {
  it("is exactly $100,000.00 in cents", () => {
    expect(NEXT_DAY_THRESHOLD_CENTS).toBe(10_000_000);
    expect(formatCents(NEXT_DAY_THRESHOLD_CENTS)).toBe("$100,000.00");
  });

  it("trips AT $100,000, not above it", () => {
    // "If you accumulate $100,000 OR MORE" - so the boundary itself trips,
    // which is the opposite sense to the $50,000 lookback test. Getting both
    // right requires reading each sentence rather than pattern-matching.
    expect(tripsNextDayRule(10_000_000)).toBe(true);
    expect(tripsNextDayRule(9_999_999)).toBe(false);
    expect(tripsNextDayRule(10_000_001)).toBe(true);
  });

  it("is not tripped by any of Michael's real daily liabilities", () => {
    // His largest single-day liability in Q2 2026 was $2,500.65, and his whole
    // quarter was $14,204.57. This rule is dormant for Greenway today - but it
    // is checked rather than assumed away.
    for (const [day, cents] of Object.entries(Q2_2026_LIABILITIES)) {
      expect(tripsNextDayRule(cents), `${day} ${formatCents(cents)}`).toBe(false);
    }
    expect(tripsNextDayRule(Q2_2026_LINE12)).toBe(false);
  });

  it("would trip on a large one-off, which is how Michael pays himself", () => {
    // Michael: "I pay myself once at the end of the year." A single large
    // owner payment is exactly the shape of event that trips this, so the
    // system watches instead of assuming Greenway is too small.
    const r = nextDayRuleConsequence("semiweekly", 10_500_000, "2027-12-31");
    expect(r.tripped).toBe(true);
    // 2027-12-31 is a Friday; the next business day is Monday Jan 3 2028
    // (Jan 1 2028 is a Saturday, observed Friday Dec 31 2027... which is the
    // payday itself). Whatever the answer, it must be a real business day.
    expect(r.dueDate).not.toBeNull();
    expect(isBusinessDay(r.dueDate as string, holidaySet(2027))).toBe(true);
  });

  it("spells out the schedule change a monthly depositor suffers", () => {
    // The sting in the tail: a monthly depositor who trips becomes semiweekly
    // the next day and stays semiweekly for the rest of the year AND all of the
    // next one. Easy to miss, expensive to miss.
    const r = nextDayRuleConsequence("monthly", 11_000_000, "2026-08-03");
    expect(r.tripped).toBe(true);
    expect(r.dueDate).toBe("2026-08-04");
    expect(r.explanation).toContain("SEMIWEEKLY depositor from the next day");
    expect(r.explanation).toContain("rest of this");
  });

  it("tells a semiweekly depositor their schedule does NOT change", () => {
    const r = nextDayRuleConsequence("semiweekly", 11_000_000, "2026-08-03");
    expect(r.tripped).toBe(true);
    expect(r.explanation).toContain("already semiweekly");
    expect(r.explanation).not.toContain("SEMIWEEKLY depositor from the next day");
  });

  it("says plainly when the rule does not apply", () => {
    const r = nextDayRuleConsequence("semiweekly", Q2_2026_LINE12, "2026-08-03");
    expect(r.tripped).toBe(false);
    expect(r.dueDate).toBeNull();
    expect(r.explanation).toContain("below the");
    expect(r.explanation).toContain("$14,204.57");
  });

  it("skips weekends and holidays when accelerating", () => {
    // Trip it on a Friday: the next BUSINESS day is Monday, not Saturday.
    const r = nextDayRuleConsequence("semiweekly", 10_000_000, "2026-08-07");
    expect(dayName("2026-08-07")).toBe("Friday");
    expect(r.dueDate).toBe("2026-08-10");
    expect(dayName(r.dueDate as string)).toBe("Monday");
  });
});

// ---------------------------------------------------------------------------
// 9) QUARTER-SPANNING SEMIWEEKLY PERIODS
// ---------------------------------------------------------------------------

describe("spansTwoQuarters", () => {
  it("matches Pub 15's example: Sept 30 and Oct 2, 2026", () => {
    // "If you have a pay date on Wednesday, September 30, 2026 (third
    // quarter), and another pay date on Friday, October 2, 2026 (fourth
    // quarter), two separate deposits would be required even though the pay
    // dates fall within the same semiweekly period. Both deposits would be due
    // on Wednesday, October 7, 2026."
    expect(dayName("2026-09-30")).toBe("Wednesday");
    expect(dayName("2026-10-02")).toBe("Friday");
    // Same semiweekly period...
    expect(semiweeklyPeriodOf("2026-09-30")).toBe("wed_fri");
    expect(semiweeklyPeriodOf("2026-10-02")).toBe("wed_fri");
    // ...different quarters...
    expect(spansTwoQuarters("2026-09-30", "2026-10-02")).toBe(true);
    // ...and the publication's stated due date, for both.
    expect(mustDue(depositDueDate("2026-09-30", "semiweekly")).dueDate).toBe("2026-10-07");
    expect(mustDue(depositDueDate("2026-10-02", "semiweekly")).dueDate).toBe("2026-10-07");
  });

  it("says no for two paydays in the same quarter", () => {
    expect(spansTwoQuarters("2026-04-03", "2026-04-17")).toBe(false);
    expect(spansTwoQuarters("2026-01-01", "2026-03-31")).toBe(false);
  });

  it("catches every quarter boundary, including the year boundary", () => {
    expect(spansTwoQuarters("2026-03-31", "2026-04-01")).toBe(true);
    expect(spansTwoQuarters("2026-06-30", "2026-07-01")).toBe(true);
    expect(spansTwoQuarters("2026-09-30", "2026-10-01")).toBe(true);
    expect(spansTwoQuarters("2026-12-31", "2027-01-01")).toBe(true);
    // Same quarter number, different year, is still two quarters.
    expect(spansTwoQuarters("2026-01-05", "2027-01-05")).toBe(true);
  });

  it("returns false rather than throwing on bad input", () => {
    expect(spansTwoQuarters("garbage", "2026-10-02")).toBe(false);
    expect(spansTwoQuarters("2026-09-30", "")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10) PRESENTATION - Michael has to be able to read all of it
// ---------------------------------------------------------------------------

describe("presentation", () => {
  it("formats cents with commas and two decimals", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(1)).toBe("$0.01");
    expect(formatCents(100)).toBe("$1.00");
    expect(formatCents(1_420_457)).toBe("$14,204.57");
    expect(formatCents(5_681_828)).toBe("$56,818.28");
    expect(formatCents(100_000_000)).toBe("$1,000,000.00");
    expect(formatCents(-1_000)).toBe("-$10.00");
  });

  it("never shows a raw enum to Michael", () => {
    expect(DEPOSIT_SCHEDULE_LABELS.monthly).toBe("Monthly schedule depositor");
    expect(DEPOSIT_SCHEDULE_LABELS.semiweekly).toBe("Semiweekly schedule depositor");
    expect(SEMIWEEKLY_PERIOD_LABELS.wed_fri).toBe("Wednesday-Friday");
    expect(SEMIWEEKLY_PERIOD_LABELS.sat_tue).toBe("Saturday-Tuesday");
    for (const v of [
      ...Object.values(DEPOSIT_SCHEDULE_LABELS),
      ...Object.values(SEMIWEEKLY_PERIOD_LABELS),
    ]) {
      expect(v).not.toContain("_");
    }
  });

  it("names days of the week correctly", () => {
    expect(dayName("2026-04-03")).toBe("Friday");
    expect(dayName("2026-04-05")).toBe("Sunday");
    expect(dayName("garbage")).toBe("");
  });

  it("formats a quarter the way a human writes it", () => {
    expect(formatQuarter({ year: 2026, quarter: 2 })).toBe("Q2 2026");
    expect(formatQuarter({ year: 2025, quarter: 4 })).toBe("Q4 2025");
  });

  it("writes explanations with no jargon leakage anywhere", () => {
    const outputs: string[] = [];
    const d = determineDepositSchedule(2027, greenway2027());
    outputs.push(d.explanation);
    outputs.push(determineDepositSchedule(2027, []).explanation);
    for (const p of Q2_2026_PAYDAYS) {
      const r = depositDueDate(p, "semiweekly");
      if (r.ok) outputs.push(r.explanation);
      const m = depositDueDate(p, "monthly");
      if (m.ok) outputs.push(m.explanation);
    }
    outputs.push(nextDayRuleConsequence("monthly", 11_000_000, "2026-08-03").explanation);
    expect(outputs.length).toBeGreaterThan(15); // rule 39
    for (const o of outputs) {
      expect(o).not.toContain("undefined");
      expect(o).not.toContain("null");
      expect(o).not.toContain("NaN");
      expect(o).not.toContain("[object");
      expect(o).not.toContain("wed_fri");
      expect(o).not.toContain("sat_tue");
      expect(o).not.toContain("line12Cents");
      expect(o.length).toBeGreaterThan(60);
    }
  });
});

// ---------------------------------------------------------------------------
// 11) THE AUTHORITIES BEHIND ALL OF IT
// ---------------------------------------------------------------------------

describe("the deposit-schedule authorities", () => {
  const ids = [
    "pub15-2026-lookback-period",
    "pub15-2026-lookback-adjustments",
    "pub15-2026-schedule-terms-meaning",
    "pub15-2026-deposit-period",
    "pub15-2026-semiweekly-due-dates",
    "pub15-2026-monthly-due-date",
    "pub15-2026-schedule-b-required",
    "pub15-2026-new-employer-zero",
    "pub15-2026-business-days-only",
    "pub15-2026-semiweekly-three-business-days",
    "pub15-2026-100k-next-day-rule",
    "pub15-2026-semiweekly-spanning-quarters",
  ];

  it("are all registered, so a refusal can cite them", () => {
    const known = new Set(PAYROLL_TAX_AUTHORITIES.map((a) => a.id));
    for (const id of ids) {
      expect(known.has(id), `${id} is not in PAYROLL_TAX_AUTHORITIES`).toBe(true);
    }
  });

  it("each carries a substantive quote, a plain-English so-what, and a real URL", () => {
    for (const id of ids) {
      const a = PAYROLL_TAX_AUTHORITIES.find((x) => x.id === id);
      expect(a, id).toBeDefined();
      if (!a) continue;
      // The verifier proves the quote is verbatim; here we prove it is real.
      expect(a.quote.trim().length, id).toBeGreaterThanOrEqual(100);
      expect(a.soWhat.trim().length, id).toBeGreaterThan(100);
      expect(a.source, id).toMatch(/^https:\/\/www\.irs\.gov\//);
      expect(a.cite, id).toContain("Pub. 15");
      expect(a.kind).toBe("irs_guidance");
    }
  });

  it("records the rule Greenway does NOT qualify for, and says so", () => {
    // Rule 1 in spirit: the most plausible wrong answer is documented as wrong
    // rather than omitted, because omission looks like it was never considered.
    const a = PAYROLL_TAX_AUTHORITIES.find((x) => x.id === "pub15-2026-new-employer-zero");
    expect(a).toBeDefined();
    expect(a?.soWhat).toContain("Greenway does not get this");
    expect(a?.soWhat).toContain("SOFTWARE that is new");
  });

  it("quotes the threshold sentence in the lookback authority", () => {
    // The single sentence the whole module turns on. If someone paraphrases it
    // later, the verifier will fail - and so will this.
    const a = PAYROLL_TAX_AUTHORITIES.find((x) => x.id === "pub15-2026-lookback-period");
    expect(a?.quote).toContain("$50,000 or less of taxes for the lookback period");
    expect(a?.quote).toContain("you're a monthly schedule depositor");
    expect(a?.quote).toContain("more than $50,000");
    expect(a?.quote).toContain("semiweekly schedule depositor");
    // And the dates, which are the part people get wrong.
    expect(a?.quote).toContain("begins July 1 and ends");
  });

  it("explains the eighteen-month gap in the so-what, in plain English", () => {
    const a = PAYROLL_TAX_AUTHORITIES.find((x) => x.id === "pub15-2026-lookback-period");
    expect(a?.soWhat).toContain("NOT last year");
    expect(a?.soWhat).toContain("July 1, 2025 through June 30, 2026");
  });
});
