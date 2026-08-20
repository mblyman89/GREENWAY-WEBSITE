/**
 * tests/compliance/interest-core.test.ts   (books-21)
 *
 * §6621 INTEREST, §6622 DAILY COMPOUNDING, §6699 LATE 1120-S, §6651(j) MINIMUM.
 *
 * TWO THINGS THIS FILE IS DELIBERATELY NOT DOING.
 *
 * First, it does not re-implement the engine (rule 39). Every expected figure
 * below was computed OUTSIDE this codebase, in exact decimal arithmetic, using
 * the closed-form P*((1+r/n)^d - 1) rather than the engine's day-by-day loop.
 * Two different formulas that agree is evidence; one formula compared against
 * itself is a tautology dressed as a test.
 *
 * Second, it does not use the real rate table. `FEDERAL_SHORT_TERM_RATES` is
 * empty on purpose, because Michael never supplied quarterly short-term rates.
 * The fixtures here are labelled as fixtures. If a rate in this file ever ends
 * up quoted as fact, that is the bug rule 41 warns about.
 *
 * The most important test in the file is B6's: a year-late Form 1120-S. Before
 * books-21 this codebase answered $0.00, because nothing in it had heard of
 * §6699. That was measured, not assumed, and the number below is what it should
 * have said all along.
 */
import { describe, it, expect } from "vitest";

import {
  type Section6651MinimumRow,
  type ShortTermRateRow,
  type TaxpayerKind,
  BASIS_POINTS_ONE_HUNDRED_PERCENT,
  CORPORATE_OVERPAYMENT_THRESHOLD_CENTS,
  INTEREST_REFUSAL_CODES,
  SECTION_6621_ADDITIONS,
  SECTION_6651_STATUTORY_BASE_CENTS,
  SECTION_6699_MAX_MONTHS,
  SECTION_6699_STATUTORY_BASE_CENTS,
  ShortTermRateRegistry,
  compoundDailyInterestCents,
  computeInterest,
  computeSection6699Penalty,
  daysBetween,
  daysInYearOf,
  isIsoDate,
  quarterOf,
  rateKindFor,
  section6651MinimumFor,
  validateSection6651Rows,
} from "@/lib/accounting/interest-core";
import {
  DOR_ANNUAL_RATES,
  FEDERAL_SHORT_TERM_RATES,
  SECTION_6651_MINIMUMS,
} from "@/lib/accounting/interest-rates-evidenced";

// ---------------------------------------------------------------------------
// FIXTURES. Invented rates, so labelled.
// ---------------------------------------------------------------------------

const fixtureRate = (
  year: number,
  quarter: 1 | 2 | 3 | 4,
  shortTermRateBasisPoints: number,
): ShortTermRateRow => ({
  year,
  quarter,
  shortTermRateBasisPoints,
  evidenceSource: `TEST FIXTURE \u2014 not a real revenue ruling (${year} Q${quarter})`,
});

/** 4% short term everywhere in 2026 => 7% underpayment. */
const flat2026 = ShortTermRateRegistry.create([
  fixtureRate(2026, 1, 400),
  fixtureRate(2026, 2, 400),
  fixtureRate(2026, 3, 400),
  fixtureRate(2026, 4, 400),
]);

/** Rate MOVES across the year: 4%, 5%, 3% short term => 7%, 8%, 6% underpayment. */
const moving2026 = ShortTermRateRegistry.create([
  fixtureRate(2026, 1, 400),
  fixtureRate(2026, 2, 500),
  fixtureRate(2026, 3, 300),
]);

/** Spans a year boundary into a LEAP year (2028). Same rate both sides. */
const across2027to2028 = ShortTermRateRegistry.create([
  fixtureRate(2027, 4, 400),
  fixtureRate(2028, 1, 400),
]);

const codes = (rs: readonly { code: string }[]): string[] => rs.map((r) => r.code);

// ---------------------------------------------------------------------------

describe("B1: dates, quarters and the leap-year denominator", () => {
  it("accepts real dates and rejects ones that only look real", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true); // 2028 IS a leap year
    expect(isIsoDate("2026-02-29")).toBe(false); // 2026 is not
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-00-10")).toBe(false);
    expect(isIsoDate("26-01-01")).toBe(false);
    expect(isIsoDate("2026-1-1")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });

  it("counts days as [from, to) and signs a backwards period", () => {
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
    expect(daysBetween("2026-01-01", "2026-01-02")).toBe(1);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
    expect(daysBetween("2028-01-01", "2029-01-01")).toBe(366);
    expect(daysBetween("2026-06-01", "2026-01-01")).toBe(-151);
  });

  it("crosses a daylight-saving boundary without losing an hour", () => {
    // Computed in UTC on purpose. A local-time implementation loses or gains a
    // day here, and a one-day error in an interest period is invisible.
    expect(daysBetween("2026-03-01", "2026-04-01")).toBe(31);
    expect(daysBetween("2026-10-15", "2026-11-15")).toBe(31);
  });

  it("uses 366 days in a leap year, because the IRS does", () => {
    expect(daysInYearOf("2024-05-05")).toBe(366);
    expect(daysInYearOf("2028-01-01")).toBe(366);
    expect(daysInYearOf("2026-01-01")).toBe(365);
    expect(daysInYearOf("2027-12-31")).toBe(365);
    // The century rule, which is where hand-rolled leap logic usually breaks.
    expect(daysInYearOf("2000-01-01")).toBe(366);
    expect(daysInYearOf("2100-01-01")).toBe(365);
  });

  it("maps months to quarters at the edges", () => {
    expect(quarterOf("2026-01-01")).toBe(1);
    expect(quarterOf("2026-03-31")).toBe(1);
    expect(quarterOf("2026-04-01")).toBe(2);
    expect(quarterOf("2026-06-30")).toBe(2);
    expect(quarterOf("2026-07-01")).toBe(3);
    expect(quarterOf("2026-09-30")).toBe(3);
    expect(quarterOf("2026-10-01")).toBe(4);
    expect(quarterOf("2026-12-31")).toBe(4);
  });
});

describe("B2: §6622 daily compounding, checked against outside arithmetic", () => {
  // Every expectation in this block came from an exact-decimal calculation of
  // P*((1+r/n)^d - 1) run outside this repository. The engine multiplies day by
  // day; these numbers do not. Agreement is the evidence.

  it("matches the closed form on a quarter of a year", () => {
    expect(compoundDailyInterestCents(1_000_000, 700, 90, 365)).toBe(17_408);
  });

  it("matches the closed form on a full year", () => {
    expect(compoundDailyInterestCents(1_000_000, 700, 365, 365)).toBe(72_501);
  });

  it("matches the closed form on a full LEAP year", () => {
    // 366 days over 366 denominator lands on the same total as 365/365 \u2014 which
    // is the point: the denominator has to move with the numerator.
    expect(compoundDailyInterestCents(1_000_000, 700, 366, 366)).toBe(72_501);
  });

  it("matches the closed form on two years, where compounding really shows", () => {
    expect(compoundDailyInterestCents(10_000_000, 1_000, 731, 365)).toBe(2_217_039);
  });

  it("matches the closed form on odd periods", () => {
    expect(compoundDailyInterestCents(5_000_000, 800, 92, 365)).toBe(101_834);
    expect(compoundDailyInterestCents(2_500_000, 600, 31, 366)).toBe(12_736);
  });

  it("compounds MORE than simple interest, and provably so", () => {
    // Simple interest on the same facts, computed outside: 70,000 cents for a
    // year and 17,260 for a quarter. If this engine ever quietly became simple
    // interest these two assertions are what catches it.
    const year = compoundDailyInterestCents(1_000_000, 700, 365, 365);
    const quarter = compoundDailyInterestCents(1_000_000, 700, 90, 365);
    expect(year).toBeGreaterThan(70_000);
    expect(year).toBe(70_000 + 2_501);
    expect(quarter).toBeGreaterThan(17_260);
    expect(quarter).toBe(17_260 + 148);
  });

  it("the leap denominator changes the answer, so it cannot be hardcoded", () => {
    // Same principal, same rate, same 90 days \u2014 only the denominator differs.
    // Values from outside arithmetic: 17,408 at /365 and 17,360 at /366.
    expect(compoundDailyInterestCents(1_000_000, 700, 90, 365)).toBe(17_408);
    expect(compoundDailyInterestCents(1_000_000, 700, 90, 366)).toBe(17_360);
  });

  it("returns zero for the three degenerate cases and does not throw", () => {
    expect(compoundDailyInterestCents(1_000_000, 700, 0, 365)).toBe(0);
    expect(compoundDailyInterestCents(0, 700, 90, 365)).toBe(0);
    expect(compoundDailyInterestCents(1_000_000, 0, 90, 365)).toBe(0);
  });

  it("rounds once at the end, so a tiny balance does not round up to a cent", () => {
    // One dollar for one day at 7% is a small fraction of a cent. Rounding per
    // day instead of once would turn that into a full cent.
    expect(compoundDailyInterestCents(100, 700, 1, 365)).toBe(0);
  });

  it("preserves the sign of a negative principal instead of flipping it", () => {
    expect(compoundDailyInterestCents(-1_000_000, 700, 90, 365)).toBe(-17_408);
  });

  it("throws rather than guesses on malformed arithmetic input", () => {
    expect(() => compoundDailyInterestCents(1_000.5, 700, 90, 365)).toThrow(/integer/);
    expect(() => compoundDailyInterestCents(1_000_000, -100, 90, 365)).toThrow(/basis points/);
    expect(() => compoundDailyInterestCents(1_000_000, 700.5, 90, 365)).toThrow(/basis points/);
    expect(() => compoundDailyInterestCents(1_000_000, 700, -1, 365)).toThrow(/days/);
    expect(() => compoundDailyInterestCents(1_000_000, 700, 1.5, 365)).toThrow(/days/);
  });
});

describe("B3: the rate registry refuses on a gap and never interpolates", () => {
  it("adds the §6621 points itself, so a stored rate cannot double-count them", () => {
    const r = flat2026.rateFor("2026-02-01", "underpayment");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.shortTermRateBasisPoints).toBe(400);
    expect(r.basisPoints).toBe(400 + SECTION_6621_ADDITIONS.underpayment);
    expect(r.basisPoints).toBe(700);
  });

  it("gives all five §6621 rates off the same stored short-term rate", () => {
    const at = (kind: Parameters<typeof flat2026.rateFor>[1]): number => {
      const r = flat2026.rateFor("2026-02-01", kind);
      if (!r.ok) throw new Error("fixture should resolve");
      return r.basisPoints;
    };
    expect(at("underpayment")).toBe(700);
    expect(at("overpayment_non_corporate")).toBe(700);
    expect(at("overpayment_corporate")).toBe(600);
    expect(at("overpayment_corporate_above_threshold")).toBe(450);
    expect(at("large_corporate_underpayment")).toBe(900);
  });

  it("the five additions are the five in the statute and are not equal", () => {
    expect(SECTION_6621_ADDITIONS.underpayment).toBe(300);
    expect(SECTION_6621_ADDITIONS.overpaymentNonCorporate).toBe(300);
    expect(SECTION_6621_ADDITIONS.overpaymentCorporate).toBe(200);
    expect(SECTION_6621_ADDITIONS.overpaymentCorporateAboveThreshold).toBe(50);
    expect(SECTION_6621_ADDITIONS.largeCorporateUnderpayment).toBe(500);
    // Underpayment and non-corporate overpayment really are both three points.
    // The asymmetry is on the CORPORATE overpayment side, and it is the thing
    // most likely to be "tidied" into symmetry by someone being helpful.
    expect(SECTION_6621_ADDITIONS.overpaymentCorporate).toBeLessThan(
      SECTION_6621_ADDITIONS.underpayment,
    );
    expect(SECTION_6621_ADDITIONS.overpaymentCorporateAboveThreshold).toBeLessThan(
      SECTION_6621_ADDITIONS.overpaymentCorporate,
    );
  });

  it("refuses a quarter it does not have, and says why it will not guess", () => {
    const r = moving2026.rateFor("2026-11-01", "underpayment");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.code).toBe("RATE_NOT_LOADED_FOR_QUARTER");
    expect(r.refusal.message).toContain("2026 Q4");
    // The remedy has to kill the obvious workaround out loud.
    expect(r.refusal.whatToDo).toMatch(/will not carry the previous/i);
    expect(r.refusal.authorityIds.length).toBeGreaterThan(0);
  });

  it("refuses a malformed date at the lookup, not deep inside the loop", () => {
    const r = flat2026.rateFor("2026-02-30", "underpayment");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.code).toBe("INVALID_DATE");
  });

  it("rejects a rate that is not a whole percent, per §6621(b)(3)", () => {
    expect(() => ShortTermRateRegistry.create([fixtureRate(2026, 1, 425)])).toThrow(
      /multiple of 100/,
    );
  });

  it("rejects a rate with no evidence source", () => {
    expect(() =>
      ShortTermRateRegistry.create([
        { year: 2026, quarter: 1, shortTermRateBasisPoints: 400, evidenceSource: "   " },
      ]),
    ).toThrow(/evidence source/);
  });

  it("rejects duplicate quarters, because the answer would depend on order", () => {
    expect(() =>
      ShortTermRateRegistry.create([fixtureRate(2026, 1, 400), fixtureRate(2026, 1, 500)]),
    ).toThrow(/duplicate/);
  });

  it("rejects an implausible year and an out-of-range rate", () => {
    expect(() => ShortTermRateRegistry.create([fixtureRate(1900, 1, 400)])).toThrow(/whole year/);
    expect(() =>
      ShortTermRateRegistry.create([
        fixtureRate(2026, 1, BASIS_POINTS_ONE_HUNDRED_PERCENT + 100),
      ]),
    ).toThrow(/0\.\.10000/);
  });

  it("reports every problem at once instead of one per attempt", () => {
    let message = "";
    try {
      ShortTermRateRegistry.create([
        fixtureRate(2026, 1, 425),
        { year: 2026, quarter: 2, shortTermRateBasisPoints: 400, evidenceSource: "" },
      ]);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/2 problem/);
    expect(message).toContain("multiple of 100");
    expect(message).toContain("evidence source");
  });

  it("an empty registry is legal to build and refuses every lookup", () => {
    // This is the real production state today, and it must not throw on build.
    const empty = ShortTermRateRegistry.create([]);
    expect(empty.all()).toHaveLength(0);
    const r = empty.rateFor("2026-01-15", "underpayment");
    expect(r.ok).toBe(false);
  });
});

describe("B4: which rate applies — the §6621(c) finding, both directions", () => {
  const forKind = (
    taxpayer: TaxpayerKind,
    direction: "underpayment" | "overpayment",
    principalCents = 1_000_000,
    requestLargeCorporateRate?: boolean,
  ) => rateKindFor({ taxpayer, direction, principalCents, requestLargeCorporateRate });

  it("REFUSES hot interest for an S corporation — §6621(c)(3)(A) plus §1361(a)(2)", () => {
    const r = forKind("s_corporation", "underpayment", 50_000_000, true);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.code).toBe("HOT_INTEREST_NOT_APPLICABLE_TO_S_CORP");
    // The refusal must say this is GOOD news, because it is, and it must name
    // both statutes \u2014 the finding is only sound with the pair.
    expect(r.refusal.whatToDo).toMatch(/in Greenway's favour/i);
    expect(r.refusal.authorityIds).toContain("irc-6621-c-large-corporate-underpayment");
    expect(r.refusal.authorityIds).toContain("irc-1361-a-s-and-c-corporation-defined");
    // And it must name the condition on which the protection ends.
    expect(r.refusal.whatToDo).toMatch(/Break the election/i);
  });

  it("also refuses hot interest for an individual", () => {
    const r = forKind("individual", "underpayment", 50_000_000, true);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.code).toBe("HOT_INTEREST_NOT_APPLICABLE_TO_S_CORP");
    expect(r.refusal.message).toContain("an individual");
  });

  it("PERMITS hot interest for a C corporation — rule 34, the other direction", () => {
    // If this passes and the S-corp test also passes, the gate is a gate. If
    // only the refusal test passed, a function that refused everything would
    // look correct.
    const r = forKind("c_corporation", "underpayment", 50_000_000, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("large_corporate_underpayment");
  });

  it("gives an S corporation the ordinary three points however large the debt", () => {
    for (const principal of [1_00, 50_000_00, 100_000_00, 10_000_000_00]) {
      const r = forKind("s_corporation", "underpayment", principal);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.kind).toBe("underpayment");
    }
  });

  it("underpayment has no corporate variant — §6621(a)(2) is flat", () => {
    for (const t of ["individual", "s_corporation", "c_corporation"] as const) {
      const r = forKind(t, "underpayment");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.kind).toBe("underpayment");
    }
  });

  it("overpayment IS asymmetric, and the corporate threshold bites at $10,000", () => {
    const nonCorp = forKind("individual", "overpayment", 10_000_000);
    expect(nonCorp.ok && nonCorp.kind).toBe("overpayment_non_corporate");

    const atThreshold = forKind("c_corporation", "overpayment", CORPORATE_OVERPAYMENT_THRESHOLD_CENTS);
    expect(atThreshold.ok && atThreshold.kind).toBe("overpayment_corporate");

    const overThreshold = forKind(
      "c_corporation",
      "overpayment",
      CORPORATE_OVERPAYMENT_THRESHOLD_CENTS + 1,
    );
    expect(overThreshold.ok && overThreshold.kind).toBe("overpayment_corporate_above_threshold");
  });

  it("an S corporation is a corporation for the OVERPAYMENT rate", () => {
    // The §6621(c) restriction is written on "C corporation"; the §6621(a)(1)
    // flush text is written on "corporation". Those are different words and this
    // engine must not collapse them into one flag.
    const r = forKind("s_corporation", "overpayment", 1_000_000);
    expect(r.ok && r.kind).toBe("overpayment_corporate");
    const big = forKind("s_corporation", "overpayment", 100_000_000);
    expect(big.ok && big.kind).toBe("overpayment_corporate_above_threshold");
  });

  it("the threshold constant is $10,000, not $10,000 of something else", () => {
    expect(CORPORATE_OVERPAYMENT_THRESHOLD_CENTS).toBe(1_000_000);
  });
});

describe("B5: interest over a period, re-rated quarterly and compounded through", () => {
  it("computes one quarter and matches outside arithmetic", () => {
    const r = computeInterest(
      {
        principalCents: 1_000_000,
        fromDateIso: "2026-01-01",
        toDateIso: "2026-04-01",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      flat2026,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.interestCents).toBe(17_408);
    expect(r.endingBalanceCents).toBe(1_017_408);
    expect(r.segments).toHaveLength(1);
  });

  it("walks three quarters at three rates, matching outside arithmetic exactly", () => {
    // 5,000,000c from 2026-02-15 to 2026-07-10. Computed outside:
    //   2026 Q1  45 days @ 700bp on 5,000,000 ->  43,333
    //   2026 Q2  91 days @ 800bp on 5,043,333 -> 101,589
    //   2026 Q3   9 days @ 600bp on 5,144,922 ->   7,617
    //   total 152,539, ending 5,152,539
    const r = computeInterest(
      {
        principalCents: 5_000_000,
        fromDateIso: "2026-02-15",
        toDateIso: "2026-07-10",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      moving2026,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.segments).toHaveLength(3);

    expect(r.segments[0]).toMatchObject({
      year: 2026, quarter: 1, days: 45, rateBasisPoints: 700,
      interestCents: 43_333, openingBalanceCents: 5_000_000,
    });
    expect(r.segments[1]).toMatchObject({
      year: 2026, quarter: 2, days: 91, rateBasisPoints: 800,
      interestCents: 101_589, openingBalanceCents: 5_043_333,
    });
    expect(r.segments[2]).toMatchObject({
      year: 2026, quarter: 3, days: 9, rateBasisPoints: 600,
      interestCents: 7_617, openingBalanceCents: 5_144_922,
    });

    expect(r.interestCents).toBe(152_539);
    expect(r.endingBalanceCents).toBe(5_152_539);
  });

  it("does not restart the compounding at a quarter boundary", () => {
    // The classic error. Each segment's opening balance must be the previous
    // segment's closing balance, never the original principal.
    const r = computeInterest(
      {
        principalCents: 5_000_000,
        fromDateIso: "2026-02-15",
        toDateIso: "2026-07-10",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      moving2026,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (let i = 1; i < r.segments.length; i += 1) {
      const prev = r.segments[i - 1]!;
      expect(r.segments[i]!.openingBalanceCents).toBe(
        prev.openingBalanceCents + prev.interestCents,
      );
    }
    // And the second segment's opening is NOT the principal.
    expect(r.segments[1]!.openingBalanceCents).not.toBe(5_000_000);
  });

  it("does not rate the whole period at one quarter's rate", () => {
    // The other classic error, stated as a number: rating all 145 days at 700bp
    // would give 140,013, which is not the answer.
    const wrong = compoundDailyInterestCents(5_000_000, 700, 145, 365);
    const r = computeInterest(
      {
        principalCents: 5_000_000,
        fromDateIso: "2026-02-15",
        toDateIso: "2026-07-10",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      moving2026,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.interestCents).not.toBe(wrong);
    expect(r.segments.map((s) => s.rateBasisPoints)).toEqual([700, 800, 600]);
  });

  it("crosses a year boundary into a leap year and changes denominator mid-run", () => {
    // 1,000,000c from 2027-11-01 to 2028-02-01, 400bp short term both sides so
    // the rate is 700bp throughout. Computed outside:
    //   2027 Q4  61 days /365 -> 11,766
    //   2028 Q1  31 days /366 ->  6,016  (on 1,011,766)
    //   total 17,782
    const r = computeInterest(
      {
        principalCents: 1_000_000,
        fromDateIso: "2027-11-01",
        toDateIso: "2028-02-01",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      across2027to2028,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0]).toMatchObject({ year: 2027, quarter: 4, days: 61, interestCents: 11_766 });
    expect(r.segments[1]).toMatchObject({ year: 2028, quarter: 1, days: 31, interestCents: 6_016 });
    expect(r.interestCents).toBe(17_782);
    // Same rate on both segments proves the difference came from the denominator.
    expect(r.segments[0]!.rateBasisPoints).toBe(r.segments[1]!.rateBasisPoints);
  });

  it("a zero-length period earns nothing and is not an error", () => {
    const r = computeInterest(
      {
        principalCents: 1_000_000,
        fromDateIso: "2026-03-01",
        toDateIso: "2026-03-01",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      flat2026,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.interestCents).toBe(0);
    expect(r.segments).toHaveLength(0);
  });

  it("refuses a backwards period instead of returning a negative charge", () => {
    const r = computeInterest(
      {
        principalCents: 1_000_000,
        fromDateIso: "2026-06-01",
        toDateIso: "2026-01-01",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      flat2026,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(codes(r.refusals)).toContain("PERIOD_RUNS_BACKWARDS");
  });

  it("refuses non-integer cents", () => {
    const r = computeInterest(
      {
        principalCents: 1_000.5,
        fromDateIso: "2026-01-01",
        toDateIso: "2026-04-01",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      flat2026,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(codes(r.refusals)).toContain("NOT_INTEGER_CENTS");
  });

  it("refuses both malformed dates in one pass", () => {
    const r = computeInterest(
      {
        principalCents: 1_000_000,
        fromDateIso: "nope",
        toDateIso: "2026-02-31",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      flat2026,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(codes(r.refusals).filter((c) => c === "INVALID_DATE")).toHaveLength(2);
  });

  it("reports EVERY missing quarter, not just the first", () => {
    // Rule 27 with manners: sending Michael back four separate times for four
    // revenue rulings is a refusal that technically works and is useless.
    const onlyQ1 = ShortTermRateRegistry.create([fixtureRate(2026, 1, 400)]);
    const r = computeInterest(
      {
        principalCents: 1_000_000,
        fromDateIso: "2026-01-01",
        toDateIso: "2027-01-01",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      onlyQ1,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals).toHaveLength(3); // Q2, Q3, Q4
    expect(new Set(codes(r.refusals))).toEqual(new Set(["RATE_NOT_LOADED_FOR_QUARTER"]));
    expect(r.refusals.map((x) => x.message).join(" ")).toContain("2026 Q2");
    expect(r.refusals.map((x) => x.message).join(" ")).toContain("2026 Q4");
  });

  it("refuses rather than partially computing when a middle quarter is missing", () => {
    // The dangerous shape: a gap in the MIDDLE. A tempting implementation
    // returns the quarters it could do and a warning, and that number gets used.
    const gapped = ShortTermRateRegistry.create([fixtureRate(2026, 1, 400), fixtureRate(2026, 3, 400)]);
    const r = computeInterest(
      {
        principalCents: 1_000_000,
        fromDateIso: "2026-01-01",
        toDateIso: "2026-09-01",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      gapped,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(codes(r.refusals)).toEqual(["RATE_NOT_LOADED_FOR_QUARTER"]);
    expect(r.refusals[0]!.message).toContain("2026 Q2");
  });

  it("refuses the whole run when hot interest is requested for an S corporation", () => {
    const r = computeInterest(
      {
        principalCents: 50_000_000,
        fromDateIso: "2026-01-01",
        toDateIso: "2026-04-01",
        direction: "underpayment",
        taxpayer: "s_corporation",
        requestLargeCorporateRate: true,
      },
      flat2026,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(codes(r.refusals)).toEqual(["HOT_INTEREST_NOT_APPLICABLE_TO_S_CORP"]);
  });

  it("the same facts as a C corporation compute, and cost more — rule 34", () => {
    // 900bp instead of 700bp on the same quarter. Outside arithmetic on
    // 50,000,000c for 90 days: 700bp -> 870,404; 900bp -> 1,120,564.
    const asC = computeInterest(
      {
        principalCents: 50_000_000,
        fromDateIso: "2026-01-01",
        toDateIso: "2026-04-01",
        direction: "underpayment",
        taxpayer: "c_corporation",
        requestLargeCorporateRate: true,
      },
      flat2026,
    );
    const asS = computeInterest(
      {
        principalCents: 50_000_000,
        fromDateIso: "2026-01-01",
        toDateIso: "2026-04-01",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      flat2026,
    );
    expect(asC.ok).toBe(true);
    expect(asS.ok).toBe(true);
    if (!asC.ok || !asS.ok) return;
    expect(asC.segments[0]!.rateBasisPoints).toBe(900);
    expect(asS.segments[0]!.rateBasisPoints).toBe(700);
    expect(asC.interestCents).toBeGreaterThan(asS.interestCents);
  });

  it("carries the evidence source through to every segment", () => {
    // A number in a report with no traceable source is the thing rule 11 exists
    // to stop, and the trace has to survive the arithmetic.
    const r = computeInterest(
      {
        principalCents: 1_000_000,
        fromDateIso: "2026-02-15",
        toDateIso: "2026-07-10",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      moving2026,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const s of r.segments) {
      expect(s.evidenceSource.trim().length).toBeGreaterThan(0);
    }
  });

  it("explains itself in plain English — rule 29", () => {
    const r = computeInterest(
      {
        principalCents: 5_000_000,
        fromDateIso: "2026-02-15",
        toDateIso: "2026-07-10",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      moving2026,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plainEnglish).toContain("$1,525.39".replace(/,/g, "")); // $1525.39
    expect(r.plainEnglish).toMatch(/3 different rate/);
    expect(r.plainEnglish).toMatch(/compounds daily/i);
    // It must explain WHY the number is bigger than rate-times-balance, because
    // that is the question Michael will actually ask.
    expect(r.plainEnglish).toMatch(/gap widens/i);
    expect(r.plainEnglish).not.toMatch(/\bAAA\b|\bbasis points\b/);
  });
});

describe("B6: §6699 — the penalty this system could not see", () => {
  const base = {
    monthsLate: 12,
    shareholderCount: 3,
    perShareholderPerMonthCents: SECTION_6699_STATUTORY_BASE_CENTS,
    reasonableCauseEstablished: false,
  };

  it("THE FINDING: a year-late 1120-S with no tax due is not $0.00", () => {
    // Before books-21 the penalty engine answered $0.00 for exactly these
    // facts, because §6651 is a percentage of tax and an S corporation shows
    // none. Measured, not assumed. At the mere statutory base it is $7,020, and
    // the real §6699(e) figure is higher still.
    const r = computeSection6699Penalty(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.penaltyCents).toBe(702_000);
    expect(r.penaltyCents).not.toBe(0);
    expect(r.monthsCharged).toBe(12);
  });

  it("multiplies per shareholder per month, and the split is irrelevant", () => {
    // Michael 85 / mother 10 / grandfather 5. A 5% holder costs the same as an
    // 85% holder, which is the counter-intuitive part.
    const one = computeSection6699Penalty({ ...base, shareholderCount: 1, monthsLate: 1 });
    const three = computeSection6699Penalty({ ...base, shareholderCount: 3, monthsLate: 1 });
    expect(one.ok && one.penaltyCents).toBe(19_500);
    expect(three.ok && three.penaltyCents).toBe(58_500);
    expect((three.ok ? three.penaltyCents : 0)).toBe((one.ok ? one.penaltyCents : 0) * 3);
  });

  it("charges one month for one day late — 'or fraction thereof'", () => {
    const r = computeSection6699Penalty({ ...base, monthsLate: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.penaltyCents).toBe(58_500);
    expect(r.plainEnglish).toMatch(/no such thing as being slightly late/i);
  });

  it("caps at 12 months and says so", () => {
    const twelve = computeSection6699Penalty({ ...base, monthsLate: 12 });
    const thirteen = computeSection6699Penalty({ ...base, monthsLate: 13 });
    const twoYears = computeSection6699Penalty({ ...base, monthsLate: 24 });
    expect(twelve.ok && twelve.penaltyCents).toBe(702_000);
    expect(thirteen.ok && thirteen.penaltyCents).toBe(702_000);
    expect(twoYears.ok && twoYears.penaltyCents).toBe(702_000);
    expect(thirteen.ok && thirteen.monthsCharged).toBe(SECTION_6699_MAX_MONTHS);
    expect(thirteen.ok && thirteen.plainEnglish).toMatch(/capped at 12 months/i);
    // And the uncapped case must NOT claim a cap.
    expect(twelve.ok && twelve.plainEnglish).not.toMatch(/capped/i);
  });

  it("zero months late costs nothing", () => {
    const r = computeSection6699Penalty({ ...base, monthsLate: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.penaltyCents).toBe(0);
  });

  it("reasonable cause zeroes it, and notes the defence is broader than §6651's", () => {
    const r = computeSection6699Penalty({ ...base, reasonableCauseEstablished: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.penaltyCents).toBe(0);
    expect(r.monthsCharged).toBe(0);
    // §6699(a) asks only for reasonable cause; §6651 also requires the absence
    // of willful neglect. That difference is worth money and is easy to miss.
    expect(r.plainEnglish).toMatch(/willful neglect/i);
    expect(r.plainEnglish).toMatch(/defence, not a plan|defense, not a plan/i);
  });

  it("refuses without an evidenced §6699(e) amount rather than using $195", () => {
    const r = computeSection6699Penalty({ ...base, perShareholderPerMonthCents: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(codes(r.refusals)).toContain("SECTION_6699_AMOUNT_NOT_EVIDENCED");
    expect(r.refusals[0]!.whatToDo).toMatch(/required to be filed/i);
    expect(r.refusals[0]!.whatToDo).toMatch(/multiple of \$5/);
  });

  it("refuses an amount BELOW the statutory base, which can only be an error", () => {
    const r = computeSection6699Penalty({ ...base, perShareholderPerMonthCents: 100_00 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(codes(r.refusals)).toContain("SECTION_6699_AMOUNT_NOT_EVIDENCED");
  });

  it("refuses a missing or impossible shareholder count", () => {
    for (const n of [null, 0, -1, 2.5]) {
      const r = computeSection6699Penalty({ ...base, shareholderCount: n as number | null });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(codes(r.refusals)).toContain("SECTION_6699_SHAREHOLDER_COUNT_MISSING");
    }
  });

  it("the shareholder-count remedy states the ANY-PART-OF-YEAR rule", () => {
    const r = computeSection6699Penalty({ ...base, shareholderCount: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const remedy = r.refusals.find((x) => x.code === "SECTION_6699_SHAREHOLDER_COUNT_MISSING")!.whatToDo;
    expect(remedy).toMatch(/any part of the taxable year/i);
    expect(remedy).toMatch(/single\s+day/i);
  });

  it("refuses malformed months instead of flooring them", () => {
    for (const m of [-1, 1.5]) {
      const r = computeSection6699Penalty({ ...base, monthsLate: m });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(codes(r.refusals)).toContain("RATE_MALFORMED");
    }
  });

  it("collects all three refusals at once", () => {
    const r = computeSection6699Penalty({
      monthsLate: -1,
      shareholderCount: null,
      perShareholderPerMonthCents: null,
      reasonableCauseEstablished: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals).toHaveLength(3);
  });

  it("the explanation says the tax is NOT in the formula — rule 29", () => {
    const r = computeSection6699Penalty(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plainEnglish).toMatch(/Notice what is NOT in that sentence: the tax/);
    expect(r.plainEnglish).toMatch(/nothing owed carries exactly the same penalty/);
  });

  it("the statutory base is the statute's number and is marked as a base", () => {
    expect(SECTION_6699_STATUTORY_BASE_CENTS).toBe(19_500);
    expect(SECTION_6699_MAX_MONTHS).toBe(12);
  });
});

describe("B7: §6651(j) minimums — Michael's own figures, mechanically checked", () => {
  it("his four figures pass the statute's rounding rule", () => {
    // Rule 22 applied to DATA. §6651(j)(2) rounds to the next lowest $5, so
    // every adjusted figure must be a multiple of $5. This check could have
    // failed on his notes and did not.
    expect(validateSection6651Rows(SECTION_6651_MINIMUMS)).toEqual([]);
  });

  it("the supplied table is the table he actually gave, unrounded and unextended", () => {
    expect(SECTION_6651_MINIMUMS.map((r) => [r.filingYear, r.minimumCents])).toEqual([
      [2023, 45_000],
      [2024, 48_500],
      [2025, 52_500],
      [2026, 52_500],
    ]);
  });

  it("looks up a year it has", () => {
    const r = section6651MinimumFor(2026, SECTION_6651_MINIMUMS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.minimumCents).toBe(52_500);
    expect(r.evidenceSource.trim().length).toBeGreaterThan(0);
  });

  it("REFUSES a year it does not have instead of falling back to $435", () => {
    // The tempting fallback. In 2026 it would understate the floor by $90.
    const r = section6651MinimumFor(2027, SECTION_6651_MINIMUMS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.code).toBe("SECTION_6651_MINIMUM_NOT_EVIDENCED");
    expect(r.refusal.whatToDo).toMatch(/rather than using the base/i);
    expect(r.refusal.whatToDo).toMatch(/required to be FILED in, not the tax year/i);
  });

  it("the $435 base is stated as a BASE, not as a stale current figure", () => {
    // Correction 3 in this slice: I had assumed $435 was out of date. It is the
    // statute's own number and is correct as the base; §6651(j) inflates it.
    expect(SECTION_6651_STATUTORY_BASE_CENTS).toBe(43_500);
    expect(SECTION_6651_MINIMUMS.every((r) => r.minimumCents >= SECTION_6651_STATUTORY_BASE_CENTS)).toBe(true);
  });

  it("catches a figure that is not a multiple of $5", () => {
    const bad: Section6651MinimumRow[] = [
      { filingYear: 2026, minimumCents: 52_499, evidenceSource: "x" },
    ];
    expect(validateSection6651Rows(bad).join(" ")).toMatch(/multiple of \$5/);
  });

  it("catches a figure below the base, a pre-2021 year, a blank source, a duplicate", () => {
    expect(
      validateSection6651Rows([{ filingYear: 2026, minimumCents: 40_000, evidenceSource: "x" }]).join(" "),
    ).toMatch(/cannot be below/);
    expect(
      validateSection6651Rows([{ filingYear: 2019, minimumCents: 52_500, evidenceSource: "x" }]).join(" "),
    ).toMatch(/after 2020/);
    expect(
      validateSection6651Rows([{ filingYear: 2026, minimumCents: 52_500, evidenceSource: "  " }]).join(" "),
    ).toMatch(/no evidence source/);
    expect(
      validateSection6651Rows([
        { filingYear: 2026, minimumCents: 52_500, evidenceSource: "x" },
        { filingYear: 2026, minimumCents: 52_500, evidenceSource: "y" },
      ]).join(" "),
    ).toMatch(/duplicate/);
  });
});

describe("B8: the evidence file is honest about what is missing", () => {
  it("FEDERAL_SHORT_TERM_RATES is empty, because he never supplied them", () => {
    // This assertion is the opposite of the usual one. It will fail the day
    // somebody adds a rate, and at that moment the person adding it has to come
    // here, read the comment, and confirm they have a revenue ruling rather
    // than a memory. That is the intended cost.
    expect(FEDERAL_SHORT_TERM_RATES).toHaveLength(0);
  });

  it("so the production registry builds and then refuses every computation", () => {
    const production = ShortTermRateRegistry.create(FEDERAL_SHORT_TERM_RATES);
    const r = computeInterest(
      {
        principalCents: 1_000_000,
        fromDateIso: "2026-01-01",
        toDateIso: "2026-04-01",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      production,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(codes(r.refusals)).toEqual(["RATE_NOT_LOADED_FOR_QUARTER"]);
  });

  it("every DOR rate has a source, and DOR is kept separate from federal", () => {
    expect(DOR_ANNUAL_RATES.length).toBeGreaterThan(0);
    for (const r of DOR_ANNUAL_RATES) {
      expect(r.evidenceSource.trim().length).toBeGreaterThan(0);
      expect(Number.isInteger(r.basisPoints)).toBe(true);
    }
    expect(DOR_ANNUAL_RATES.map((r) => [r.year, r.basisPoints])).toEqual([
      [2026, 600],
      [2027, 600],
    ]);
  });

  it("6% simple annually is cheaper than 6% compounded daily — the DOR contrast", () => {
    // Same nominal rate, different cadence. This is why the two schedules must
    // never share a code path.
    const dorSimple = Math.round((1_000_000 * 600) / 10_000);
    const federalCompound = compoundDailyInterestCents(1_000_000, 600, 365, 365);
    expect(dorSimple).toBe(60_000);
    expect(federalCompound).toBe(61_831);
    expect(federalCompound).toBeGreaterThan(dorSimple);
  });
});

describe("B9: refusal codes — reachable and declared (rules 43 and 34)", () => {
  /**
   * Inputs chosen to reach every code. If a code cannot be reached from here it
   * is decoration, and if a code is emitted that is not declared the two lists
   * have drifted apart (rule 42).
   */
  const emitted = (): Set<string> => {
    const seen = new Set<string>();
    const add = (rs: readonly { code: string }[]): void => {
      for (const c of codes(rs)) seen.add(c);
    };

    const empty = ShortTermRateRegistry.create([]);

    // RATE_NOT_LOADED_FOR_QUARTER
    const miss = empty.rateFor("2026-01-15", "underpayment");
    if (!miss.ok) add([miss.refusal]);
    // INVALID_DATE via lookup
    const badDate = flat2026.rateFor("2026-02-30", "underpayment");
    if (!badDate.ok) add([badDate.refusal]);

    const run = (i: Parameters<typeof computeInterest>[0], reg = flat2026): void => {
      const r = computeInterest(i, reg);
      if (!r.ok) add(r.refusals);
    };
    const std = {
      fromDateIso: "2026-01-01",
      toDateIso: "2026-04-01",
      direction: "underpayment",
      taxpayer: "s_corporation",
    } as const;

    run({ ...std, principalCents: 1.5 });                                  // NOT_INTEGER_CENTS
    run({ ...std, principalCents: 100, fromDateIso: "bad" });               // INVALID_DATE
    run({ ...std, principalCents: 100, fromDateIso: "2026-06-01", toDateIso: "2026-01-01" }); // PERIOD_RUNS_BACKWARDS
    run({ ...std, principalCents: 100, requestLargeCorporateRate: true });  // HOT_INTEREST...
    run({ ...std, principalCents: 100 }, ShortTermRateRegistry.create([])); // RATE_NOT_LOADED...

    const p = (i: Parameters<typeof computeSection6699Penalty>[0]): void => {
      const r = computeSection6699Penalty(i);
      if (!r.ok) add(r.refusals);
    };
    p({ monthsLate: 1, shareholderCount: null, perShareholderPerMonthCents: 19_500, reasonableCauseEstablished: false });
    p({ monthsLate: 1, shareholderCount: 3, perShareholderPerMonthCents: null, reasonableCauseEstablished: false });
    p({ monthsLate: -1, shareholderCount: 3, perShareholderPerMonthCents: 19_500, reasonableCauseEstablished: false });

    const m = section6651MinimumFor(1999, SECTION_6651_MINIMUMS);
    if (!m.ok) add([m.refusal]);

    return seen;
  };

  it("RATE_NOT_EVIDENCED, RATE_MALFORMED and DUPLICATE_RATE_ROW are reachable", () => {
    // These three are raised by the registry CONSTRUCTOR as thrown errors
    // rather than returned refusals, which is a real asymmetry in this engine.
    // Saying so out loud rather than widening the reachability set silently:
    // the constructor cannot return a refusal because there is no object to
    // return it on. The messages are asserted in B3; here we only record that
    // the paths exist so the next reader is not left wondering.
    expect(() => ShortTermRateRegistry.create([fixtureRate(2026, 1, 425)])).toThrow();
    expect(() =>
      ShortTermRateRegistry.create([
        { year: 2026, quarter: 1, shortTermRateBasisPoints: 400, evidenceSource: "" },
      ]),
    ).toThrow();
    expect(() =>
      ShortTermRateRegistry.create([fixtureRate(2026, 1, 400), fixtureRate(2026, 1, 400)]),
    ).toThrow();
  });

  it("every OTHER declared code is emitted by some path", () => {
    const seen = emitted();
    // The three constructor-thrown codes are excluded, with the reason stated
    // in the test above rather than hidden in a filter.
    const constructorOnly = new Set(["RATE_NOT_EVIDENCED", "RATE_MALFORMED", "DUPLICATE_RATE_ROW"]);
    for (const c of INTEREST_REFUSAL_CODES) {
      if (constructorOnly.has(c)) continue;
      expect(seen, `refusal code ${c} is unreachable`).toContain(c);
    }
  });

  it("RATE_MALFORMED is reachable as a RETURNED refusal too, via §6699 months", () => {
    // Which means only two of the three are constructor-only. Worth pinning,
    // because the exclusion list above would otherwise quietly grow.
    const r = computeSection6699Penalty({
      monthsLate: 1.5,
      shareholderCount: 3,
      perShareholderPerMonthCents: 19_500,
      reasonableCauseEstablished: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(codes(r.refusals)).toContain("RATE_MALFORMED");
  });

  it("no path emits an undeclared code — rule 42", () => {
    const declared = new Set<string>(INTEREST_REFUSAL_CODES);
    for (const c of emitted()) {
      expect(declared, `emitted undeclared code ${c}`).toContain(c);
    }
  });

  it("the declared list has no duplicates", () => {
    expect(new Set(INTEREST_REFUSAL_CODES).size).toBe(INTEREST_REFUSAL_CODES.length);
  });

  it("every refusal carries an authority and a usable remedy — rule 27", () => {
    const checkAll = (rs: readonly { code: string; message: string; whatToDo: string; authorityIds: readonly string[] }[]): void => {
      for (const r of rs) {
        expect(r.authorityIds.length, r.code).toBeGreaterThan(0);
        expect(r.message.length, r.code).toBeGreaterThan(40);
        expect(r.whatToDo.length, r.code).toBeGreaterThan(40);
      }
    };
    const r1 = computeInterest(
      {
        principalCents: 100,
        fromDateIso: "2026-01-01",
        toDateIso: "2026-04-01",
        direction: "underpayment",
        taxpayer: "s_corporation",
      },
      ShortTermRateRegistry.create([]),
    );
    if (!r1.ok) checkAll(r1.refusals);
    const r2 = computeSection6699Penalty({
      monthsLate: -1,
      shareholderCount: null,
      perShareholderPerMonthCents: null,
      reasonableCauseEstablished: false,
    });
    if (!r2.ok) checkAll(r2.refusals);
  });
});
