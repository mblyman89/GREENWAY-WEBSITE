/**
 * tests/compliance/sick-leave-core.test.ts
 *
 * books-33. The sick leave engine.
 *
 * THE TWO TESTS THAT MATTER MOST, and why:
 *
 *   1. "sick hours do not count toward the forty-hour threshold". Michael
 *      raised this himself: "If sick time used pushes the total hours for the
 *      week over 40, they do not get paid over time for that sick time." He is
 *      right, 29 CFR 778.218(a) says so, and an engine that gets this wrong
 *      overpays quietly and forever on every week containing leave.
 *
 *   2. "statutory hours are spent before awarded hours". This is the one that
 *      protects Michael from his own generosity. If gifted hours were spent
 *      first, the statutory hours would survive to year end and he would be
 *      required to carry them over, so every gift would permanently increase
 *      his liability. Spending statutory first means what survives is the gift,
 *      and a gift is allowed to lapse.
 *
 * Neither is obvious, both are invisible when wrong, and both are asserted
 * here with the arithmetic written out rather than a single expected total.
 */
import { describe, it, expect } from "vitest";

import {
  STATUTORY_ACCRUAL_HUNDREDTH_MINUTES_PER_HOUR,
  STATUTORY_VERIFICATION_MINIMUM_DAYS,
  SICK_LEAVE_CARRYOVER_CAP_MINUTES,
  validatePolicy,
  accrueForPeriod,
  hoursThatCountTowardAccrual,
  computeBalance,
  planDraw,
  planAward,
  reviewRequest,
  sickLeaveRateOfPay,
  sickLeavePayCents,
  splitWeekWithSickLeave,
  planYearEndCarryover,
  monthlyNotificationText,
  type SickLeavePolicy,
  type SickLeaveLedgerEntry,
  type SickLeaveRequestFacts,
} from "../../src/lib/payroll/sick-leave-core";

/** A fully answered, lawful policy. Individual tests blank out one field. */
const GOOD_POLICY: SickLeavePolicy = {
  accrualHundredthMinutesPerHour: STATUTORY_ACCRUAL_HUNDREDTH_MINUTES_PER_HOUR,
  carryoverCapMinutes: SICK_LEAVE_CARRYOVER_CAP_MINUTES,
  usableAfterDays: 90,
  usageIncrementMinutes: 15,
  verificationAfterDays: 4,
  verificationRequired: true,
};

function entry(
  kind: SickLeaveLedgerEntry["entryKind"],
  minutes: number,
  drawnFrom: SickLeaveLedgerEntry["drawnFrom"] = null,
): SickLeaveLedgerEntry {
  return { id: Math.random().toString(36), entryKind: kind, minutes, drawnFrom, effectiveDate: "2027-01-15" };
}

// ===========================================================================
describe("WAC 296-128-620(1) - accrual at one hour per forty worked", () => {
  it("forty hours worked earns exactly one hour of leave", () => {
    // The statutory ratio, stated in the units the engine uses:
    // 4000 hundredth-hours worked at 150 hundredth-minutes per hour.
    const r = accrueForPeriod(4_000, GOOD_POLICY, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.minutesToCredit).toBe(60);
    expect(r.value.remainderHundredthMinutes).toBe(0);
  });

  it("eighty hours - a normal Greenway biweekly period - earns two hours", () => {
    const r = accrueForPeriod(8_000, GOOD_POLICY, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.minutesToCredit).toBe(120);
  });

  it("CARRIES the fractional remainder instead of throwing it away", () => {
    // 35 hours = 52.5 minutes. A system that floors to 52 every period steals
    // half a minute twenty-six times a year, and every individual period looks
    // perfectly defensible.
    const first = accrueForPeriod(3_500, GOOD_POLICY, 0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.minutesToCredit).toBe(52);
    expect(first.value.remainderHundredthMinutes).toBe(50); // half a minute

    // Next period, same hours, with the remainder fed back in.
    const second = accrueForPeriod(3_500, GOOD_POLICY, first.value.remainderHundredthMinutes);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.minutesToCredit).toBe(53); // the half minutes joined up
    expect(second.value.remainderHundredthMinutes).toBe(0);

    // Two periods of 35 hours = 70 hours = 105 minutes exactly. Nothing lost.
    expect(first.value.minutesToCredit + second.value.minutesToCredit).toBe(105);
  });

  it("a more generous rate is allowed and is actually used", () => {
    // WAC 296-128-620(1) lets an employer "provide ... a more generous ...
    // accrual rate". Double rate, double leave.
    const generous: SickLeavePolicy = { ...GOOD_POLICY, accrualHundredthMinutesPerHour: 300 };
    const r = accrueForPeriod(4_000, generous, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.minutesToCredit).toBe(120);
  });

  it("REFUSES a rate below the statutory floor rather than quietly using it", () => {
    const stingy: SickLeavePolicy = { ...GOOD_POLICY, accrualHundredthMinutesPerHour: 100 };
    const r = accrueForPeriod(4_000, stingy, 0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("ACCRUAL_RATE_BELOW_STATUTORY_FLOOR");
  });

  it("REFUSES with no rate on file, instead of accruing zero", () => {
    // Rule 62d. Zero accrual is indistinguishable from an employee who did not
    // work, which is exactly why the silent version of this bug survives.
    const blank: SickLeavePolicy = { ...GOOD_POLICY, accrualHundredthMinutesPerHour: null };
    const r = accrueForPeriod(4_000, blank, 0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("NO_ACCRUAL_RATE_ON_FILE");
    expect(r.refusals[0].message).toMatch(/looks exactly like an employee who did not work/);
  });

  it("sick leave does not accrue on sick leave", () => {
    // Leave accrues "for every forty hours worked"; paid leave is not worked.
    expect(
      hoursThatCountTowardAccrual({ totalPaidHundredthHours: 4_000, sickHundredthHours: 800 }),
    ).toBe(3_200);
  });
});

// ===========================================================================
describe("29 CFR 778.218(a) - sick hours never create overtime", () => {
  it("36 worked + 8 sick = 44 paid hours and ZERO overtime", () => {
    // Michael asked about exactly this case. 29 CFR 778.218(a): payments for
    // idle hours "are not made as compensation for his hours of employment"
    // and "no part of such payments may be credited toward overtime
    // compensation due under the Act."
    const r = splitWeekWithSickLeave({
      workedHundredthHours: 3_600,
      sickHundredthHours: 800,
      overtimeThresholdHundredthHours: 4_000,
    });
    expect(r.totalPaidHundredthHours).toBe(4_400); // 44 paid hours
    expect(r.overtimeHundredthHours).toBe(0); // and no overtime
    expect(r.regularHundredthHours).toBe(3_600);
    expect(r.explanation).toMatch(/paid leave is not hours worked/);
  });

  it("exactly 40 worked plus any sick is still zero overtime", () => {
    const r = splitWeekWithSickLeave({
      workedHundredthHours: 4_000,
      sickHundredthHours: 1_600,
      overtimeThresholdHundredthHours: 4_000,
    });
    expect(r.overtimeHundredthHours).toBe(0);
    expect(r.totalPaidHundredthHours).toBe(5_600);
  });

  it("real overtime is still paid when the WORKED hours exceed forty", () => {
    // The rule must not become "leave weeks never have overtime".
    const r = splitWeekWithSickLeave({
      workedHundredthHours: 4_500,
      sickHundredthHours: 800,
      overtimeThresholdHundredthHours: 4_000,
    });
    expect(r.overtimeHundredthHours).toBe(500); // five hours
    expect(r.regularHundredthHours).toBe(4_000);
  });

  it("the threshold is consulted, not hardcoded", () => {
    // Proves the parameter is load-bearing: same hours, different threshold.
    const r = splitWeekWithSickLeave({
      workedHundredthHours: 4_500,
      sickHundredthHours: 0,
      overtimeThresholdHundredthHours: 3_500,
    });
    expect(r.overtimeHundredthHours).toBe(1_000);
  });
});

// ===========================================================================
describe("the two buckets - statutory is spent FIRST", () => {
  it("splits a ledger into earned and awarded", () => {
    const b = computeBalance([
      entry("accrual", 120),
      entry("carry_in", 60),
      entry("award", 480),
      entry("usage", -60, "statutory"),
    ]);
    expect(b.statutoryMinutes).toBe(120);
    expect(b.awardedMinutes).toBe(480);
    expect(b.totalMinutes).toBe(600);
  });

  it("spends earned leave before touching the gift", () => {
    const plan = planDraw({ statutoryMinutes: 100, awardedMinutes: 500, totalMinutes: 600 }, 300);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.fromStatutoryMinutes).toBe(100); // all of it
    expect(plan.value.fromAwardedMinutes).toBe(200); // then the gift
  });

  it("does not touch the gift at all when earned leave covers the request", () => {
    const plan = planDraw({ statutoryMinutes: 500, awardedMinutes: 500, totalMinutes: 1000 }, 300);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.fromStatutoryMinutes).toBe(300);
    expect(plan.value.fromAwardedMinutes).toBe(0);
  });

  it("THE PAYOFF: the draw order is what stops a gift becoming a permanent liability", () => {
    // Same employee, same hours used, two possible orderings. This test exists
    // to show the consequence in numbers rather than in a comment.
    const balance = { statutoryMinutes: 2_400, awardedMinutes: 2_400, totalMinutes: 4_800 };

    const plan = planDraw(balance, 2_400);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    // Statutory-first: the 2400 earned minutes are consumed, leaving the gift.
    const after = {
      statutoryMinutes: balance.statutoryMinutes - plan.value.fromStatutoryMinutes,
      awardedMinutes: balance.awardedMinutes - plan.value.fromAwardedMinutes,
      totalMinutes: 0,
    };
    expect(after.statutoryMinutes).toBe(0);
    expect(after.awardedMinutes).toBe(2_400);

    // At year end the gift lapses and NOTHING is required to carry over.
    const carry = planYearEndCarryover({
      balance: { ...after, totalMinutes: after.statutoryMinutes + after.awardedMinutes },
      policy: GOOD_POLICY,
      awardedHoursLapse: true,
    });
    expect(carry.ok).toBe(true);
    if (!carry.ok) return;
    expect(carry.value.carriedStatutoryMinutes).toBe(0);

    // Had the gift been spent first, 2400 STATUTORY minutes would have survived
    // and the full forty hours would have had to carry over - for every gift,
    // every year, forever.
    const hypothetical = planYearEndCarryover({
      balance: { statutoryMinutes: 2_400, awardedMinutes: 0, totalMinutes: 2_400 },
      policy: GOOD_POLICY,
      awardedHoursLapse: true,
    });
    expect(hypothetical.ok).toBe(true);
    if (!hypothetical.ok) return;
    expect(hypothetical.value.carriedStatutoryMinutes).toBe(2_400);
  });

  it("refuses a draw larger than the balance and says how to cover it anyway", () => {
    const plan = planDraw({ statutoryMinutes: 60, awardedMinutes: 0, totalMinutes: 60 }, 480);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.refusals[0].code).toBe("INSUFFICIENT_BALANCE");
    // Rule 64a: the refusal points at the remedy Michael actually wants.
    expect(plan.refusals[0].fix).toMatch(/[Aa]ward/);
  });
});

// ===========================================================================
describe("awarding more than accrued - Michael's explicit request", () => {
  it("accepts an award with a reason and files it in the gifted bucket", () => {
    const a = planAward({ minutes: 480, reason: "covered his shift when his kid was sick" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.value.bucket).toBe("awarded");
    expect(a.value.minutes).toBe(480);
    expect(a.value.explanation).toMatch(/does not increase what you are required to carry over/);
  });

  it("refuses an award with no reason written down", () => {
    const a = planAward({ minutes: 480, reason: "" });
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(a.refusals[0].code).toBe("AWARD_WITHOUT_REASON");
  });

  it("refuses a zero or negative award and points at corrections instead", () => {
    const a = planAward({ minutes: 0, reason: "typo" });
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(a.refusals.some((r) => r.code === "AWARD_NOT_POSITIVE")).toBe(true);
  });

  it("an awarded balance is spendable - the gift is real, not cosmetic", () => {
    const b = computeBalance([entry("award", 480)]);
    const plan = planDraw(b, 480);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.fromAwardedMinutes).toBe(480);
  });
});

// ===========================================================================
describe("WAC 296-128-670 - paid at the GREATER of normal pay or minimum wage", () => {
  it("uses the employee's own rate when it is above minimum wage", () => {
    const r = sickLeaveRateOfPay({
      normalHourlyMilliCents: 2_500_000, // $25.00
      minimumWage: { ok: true, value: 1_713_000 }, // $17.13
      usedOn: "2026-06-01",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rateMilliCentsPerHour).toBe(2_500_000);
    expect(r.value.basis).toBe("normal_hourly_compensation");
  });

  it("lifts a below-minimum rate UP to the minimum wage", () => {
    // "the greater of". Easy to get wrong and never notice, because at Greenway
    // the two are normally the same number.
    const r = sickLeaveRateOfPay({
      normalHourlyMilliCents: 1_500_000, // $15.00, below the floor
      minimumWage: { ok: true, value: 1_713_000 },
      usedOn: "2026-06-01",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rateMilliCentsPerHour).toBe(1_713_000);
    expect(r.value.basis).toBe("minimum_wage_floor");
  });

  it("REFUSES when the minimum wage for the date is not evidenced", () => {
    // This is the live 2027 situation until L&I publishes on 2026-09-30.
    const r = sickLeaveRateOfPay({
      normalHourlyMilliCents: 2_500_000,
      minimumWage: {
        ok: false,
        refusal: {
          message: "I do not have an evidenced Washington minimum wage covering 2027-01-01.",
          whatToDo: "Add the 2027 figure once L&I announces it.",
        },
      },
      usedOn: "2027-01-01",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("NO_MINIMUM_WAGE_FOR_DATE");
    // The upstream refusal is carried through, not swallowed.
    expect(r.refusals[0].message).toMatch(/evidenced Washington minimum wage/);
  });

  it("refuses when the employee has no rate on file", () => {
    const r = sickLeaveRateOfPay({
      normalHourlyMilliCents: null,
      minimumWage: { ok: true, value: 1_713_000 },
      usedOn: "2026-06-01",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("NO_NORMAL_HOURLY_RATE");
  });

  it("prices eight hours of leave to the cent", () => {
    // 8h at $17.13 = $137.04
    expect(sickLeavePayCents(480, 1_713_000)).toBe(13_704);
  });

  it("prices a part hour without losing a cent", () => {
    // 15 minutes at $17.13 = $4.2825 -> $4.28
    expect(sickLeavePayCents(15, 1_713_000)).toBe(428);
  });
});

// ===========================================================================
describe("requests", () => {
  function request(o: Partial<SickLeaveRequestFacts> = {}): SickLeaveRequestFacts {
    return {
      employeeId: "e1",
      purpose: "own_health",
      noticeKind: "unforeseeable",
      startDate: "2027-03-01",
      endDate: "2027-03-01",
      requestedMinutes: 480,
      submittedOn: "2027-03-01",
      ...o,
    };
  }
  const BAL = { statutoryMinutes: 2_400, awardedMinutes: 0, totalMinutes: 2_400 };

  it("accepts an ordinary one-day request", () => {
    const r = reviewRequest({
      request: request(),
      policy: GOOD_POLICY,
      balance: BAL,
      hireDate: "2026-01-01",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.draw.fromStatutoryMinutes).toBe(480);
    expect(r.value.absenceDays).toBe(1);
  });

  it("WAC 296-128-630(2): refuses use before the ninetieth day, but says leave is not lost", () => {
    const r = reviewRequest({
      request: request({ startDate: "2027-01-15", endDate: "2027-01-15" }),
      policy: GOOD_POLICY,
      balance: BAL,
      hireDate: "2027-01-01",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("NOT_YET_USABLE");
    expect(r.refusals[0].message).toMatch(/not lost/);
    // And it offers the generous route Michael actually wants.
    expect(r.refusals[0].fix).toMatch(/[Aa]ward/);
  });

  it("a zero-day waiting period is honoured - being generous is allowed", () => {
    const r = reviewRequest({
      request: request({ startDate: "2027-01-02", endDate: "2027-01-02" }),
      policy: { ...GOOD_POLICY, usableAfterDays: 0 },
      balance: BAL,
      hireDate: "2027-01-01",
    });
    expect(r.ok).toBe(true);
  });

  it("WAC 296-128-630(4): enforces the usage increment", () => {
    const r = reviewRequest({
      request: request({ requestedMinutes: 20 }), // not a multiple of 15
      policy: GOOD_POLICY,
      balance: BAL,
      hireDate: "2026-01-01",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("REQUEST_NOT_IN_INCREMENT");
  });

  it("WAC 296-128-660(1): verification only for absences EXCEEDING three days", () => {
    // A three-day absence is NOT long enough.
    const three = reviewRequest({
      request: request({ startDate: "2027-03-01", endDate: "2027-03-03", requestedMinutes: 1_440 }),
      policy: GOOD_POLICY,
      balance: { statutoryMinutes: 5_000, awardedMinutes: 0, totalMinutes: 5_000 },
      hireDate: "2026-01-01",
    });
    expect(three.ok).toBe(true);
    if (!three.ok) return;
    expect(three.value.absenceDays).toBe(3);
    expect(three.value.verificationMayBeRequested).toBe(false);

    // Four days IS.
    const four = reviewRequest({
      request: request({ startDate: "2027-03-01", endDate: "2027-03-04", requestedMinutes: 1_920 }),
      policy: GOOD_POLICY,
      balance: { statutoryMinutes: 5_000, awardedMinutes: 0, totalMinutes: 5_000 },
      hireDate: "2026-01-01",
    });
    expect(four.ok).toBe(true);
    if (!four.ok) return;
    expect(four.value.absenceDays).toBe(4);
    expect(four.value.verificationMayBeRequested).toBe(true);
    expect(four.value.explanation).toMatch(/cannot make the note a condition/);
  });

  it("never asks for verification when the policy says it is not required", () => {
    const r = reviewRequest({
      request: request({ startDate: "2027-03-01", endDate: "2027-03-10", requestedMinutes: 2_400 }),
      policy: { ...GOOD_POLICY, verificationRequired: false },
      balance: { statutoryMinutes: 5_000, awardedMinutes: 0, totalMinutes: 5_000 },
      hireDate: "2026-01-01",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.verificationMayBeRequested).toBe(false);
  });

  it("notes short notice on foreseeable leave but DOES NOT deny it", () => {
    // WAC 296-128-650(1)(a) wants ten days' notice where foreseeable. The
    // remedy for late notice is NOT confiscating the leave, and a system that
    // auto-denied would produce unlawful denials at scale.
    const r = reviewRequest({
      request: request({
        noticeKind: "foreseeable",
        submittedOn: "2027-02-28",
        startDate: "2027-03-01",
        endDate: "2027-03-01",
      }),
      policy: GOOD_POLICY,
      balance: BAL,
      hireDate: "2026-01-01",
    });
    expect(r.ok).toBe(true); // NOT a refusal
    if (!r.ok) return;
    expect(r.value.noticeDaysGiven).toBe(1);
    expect(r.value.noticeShortfallNote).toMatch(/does not cost them the leave/);
  });

  it("says nothing about notice when ten days were given", () => {
    const r = reviewRequest({
      request: request({
        noticeKind: "foreseeable",
        submittedOn: "2027-02-01",
        startDate: "2027-03-01",
        endDate: "2027-03-01",
      }),
      policy: GOOD_POLICY,
      balance: BAL,
      hireDate: "2026-01-01",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.noticeShortfallNote).toBeNull();
  });

  it("refuses a request that ends before it starts", () => {
    const r = reviewRequest({
      request: request({ startDate: "2027-03-05", endDate: "2027-03-01" }),
      policy: GOOD_POLICY,
      balance: BAL,
      hireDate: "2026-01-01",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("REQUEST_DATES_BACKWARD");
  });

  it("all five statutory purposes are accepted", () => {
    // RCW 49.46.210(1)(b)-(c) and the domestic violence and immigration
    // grounds. An engine that only knew about "own illness" would refuse lawful
    // leave.
    for (const purpose of [
      "own_health",
      "family_care",
      "closure",
      "immigration",
      "domestic_violence",
    ] as const) {
      const r = reviewRequest({
        request: request({ purpose }),
        policy: GOOD_POLICY,
        balance: BAL,
        hireDate: "2026-01-01",
      });
      expect(r.ok, `purpose ${purpose} should be allowed`).toBe(true);
    }
  });
});

// ===========================================================================
describe("policy validation", () => {
  it("passes a fully answered lawful policy", () => {
    expect(validatePolicy(GOOD_POLICY).ok).toBe(true);
  });

  it("names EVERY unanswered question at once, not the first one", () => {
    // Michael should get one list, not five round trips.
    const blank: SickLeavePolicy = {
      accrualHundredthMinutesPerHour: null,
      carryoverCapMinutes: null,
      usableAfterDays: null,
      usageIncrementMinutes: null,
      verificationAfterDays: null,
      verificationRequired: null,
    };
    const r = validatePolicy(blank);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const codes = r.refusals.map((x) => x.code);
    expect(codes).toContain("NO_ACCRUAL_RATE_ON_FILE");
    expect(codes).toContain("NO_CARRYOVER_CAP_ON_FILE");
    expect(codes).toContain("NO_USABLE_AFTER_ANSWER");
    expect(codes).toContain("NO_USAGE_INCREMENT_ON_FILE");
    expect(codes).toContain("VERIFICATION_POLICY_UNANSWERED");
  });

  it("rejects a verification threshold sooner than the fourth day", () => {
    const r = validatePolicy({ ...GOOD_POLICY, verificationAfterDays: 3 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("VERIFICATION_THRESHOLD_UNLAWFUL");
    expect(STATUTORY_VERIFICATION_MINIMUM_DAYS).toBe(4);
  });

  it("rejects a usage increment larger than one hour", () => {
    const r = validatePolicy({ ...GOOD_POLICY, usageIncrementMinutes: 61 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("USAGE_INCREMENT_ABOVE_ONE_HOUR");
  });

  it("rejects a carryover cap below forty hours", () => {
    const r = validatePolicy({ ...GOOD_POLICY, carryoverCapMinutes: 1_200 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("CARRYOVER_CAP_BELOW_STATUTORY_FLOOR");
  });

  it("does not demand a verification threshold when verification is switched off", () => {
    const r = validatePolicy({
      ...GOOD_POLICY,
      verificationRequired: false,
      verificationAfterDays: null,
    });
    expect(r.ok).toBe(true);
  });
});

// ===========================================================================
describe("WAC 296-128-620(4)/(5) - year end", () => {
  it("carries forty hours and lapses the excess", () => {
    const r = planYearEndCarryover({
      balance: { statutoryMinutes: 3_000, awardedMinutes: 0, totalMinutes: 3_000 },
      policy: GOOD_POLICY,
      awardedHoursLapse: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.carriedStatutoryMinutes).toBe(2_400);
    expect(r.value.forfeitedStatutoryMinutes).toBe(600);
  });

  it("honours a MORE generous cap", () => {
    const r = planYearEndCarryover({
      balance: { statutoryMinutes: 3_000, awardedMinutes: 0, totalMinutes: 3_000 },
      policy: { ...GOOD_POLICY, carryoverCapMinutes: 4_800 },
      awardedHoursLapse: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.carriedStatutoryMinutes).toBe(3_000);
    expect(r.value.forfeitedStatutoryMinutes).toBe(0);
  });

  it("REFUSES when nobody has said whether gifted hours lapse", () => {
    // Rule 62d again. Carrying them forever and wiping them are both
    // defensible, so the engine will not pick.
    const r = planYearEndCarryover({
      balance: { statutoryMinutes: 100, awardedMinutes: 100, totalMinutes: 200 },
      policy: GOOD_POLICY,
      awardedHoursLapse: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].message).toMatch(/lapse at year end or roll forward/);
  });

  it("rolls gifted hours forward ON TOP of the cap when policy says so", () => {
    const r = planYearEndCarryover({
      balance: { statutoryMinutes: 2_400, awardedMinutes: 600, totalMinutes: 3_000 },
      policy: GOOD_POLICY,
      awardedHoursLapse: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.carriedStatutoryMinutes).toBe(2_400);
    expect(r.value.carriedAwardedMinutes).toBe(600);
  });
});

// ===========================================================================
describe("WAC 296-128-755(2) - the monthly notification", () => {
  it("states accrued, used and available, which is exactly what the rule requires", () => {
    const text = monthlyNotificationText({
      employeeName: "Angela",
      monthLabel: "March 2027",
      entriesThisMonth: [entry("accrual", 120), entry("usage", -60, "statutory")],
      balanceAfter: { statutoryMinutes: 300, awardedMinutes: 0, totalMinutes: 300 },
    });
    expect(text).toMatch(/earned 2h/);
    expect(text).toMatch(/used 1h/);
    expect(text).toMatch(/5h available/);
  });

  it("mentions an award, because a gift the employee never hears about is wasted", () => {
    const text = monthlyNotificationText({
      employeeName: "Angela",
      monthLabel: "March 2027",
      entriesThisMonth: [entry("award", 480)],
      balanceAfter: { statutoryMinutes: 0, awardedMinutes: 480, totalMinutes: 480 },
    });
    expect(text).toMatch(/added 8h on top of what you earned/);
  });
});
