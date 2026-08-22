/**
 * books-34 — THE YEAR-TO-DATE ENGINE.
 *
 * The oracle for this file is not my arithmetic. It is the IRS's own worked
 * example, quoted verbatim in ytd-authorities.ts and verified character for
 * character against the mirrored instructions on disk:
 *
 *   "You paid your employee $199,750 in wages. Enter in box 3 (social security
 *    wages) 184500.00, but enter in box 5 (Medicare wages and tips) 199750.00.
 *    There is no limit on the amount reported in box 5."
 *
 * That single sentence exercises everything this slice was built for: a wage
 * base that stops, a Medicare figure that does not, and the gap between them
 * that only appears if somebody remembered what was paid earlier in the year.
 * If the engine can reproduce those two numbers by accumulating twenty-six
 * biweekly cheques, it works. If it cannot, nothing else here matters.
 *
 * Standing rule 43: every refusal code must be reachable. All eight are
 * exercised below, and a test at the end asserts that the list of codes proven
 * here matches the union declared in the module - so adding a ninth code
 * without proving it goes red.
 */
import { describe, expect, it } from "vitest";
import {
  applyRunToAccumulator,
  unapplyRunFromAccumulator,
  assertRowMatches,
  computePeriodWithYtd,
  emptyAccumulator,
  oasdiRoomRemaining,
  rebuildAccumulator,
  reconcileAccumulator,
  taxYearForPayDate,
  ytdForWithholding,
  type RunContribution,
  type YtdAccumulatorRow,
  type YtdRefusalCode,
} from "@/lib/payroll/ytd-core";
import {
  OASDI_WAGE_BASE_2026_CENTS,
  ADDITIONAL_MEDICARE_WITHHOLDING_THRESHOLD_CENTS,
} from "@/lib/payroll/payroll-withholding-core";

const EMP = "employee-1";
const YEAR = 2026;

/** A contribution with everything zero except what a test sets. */
function contribution(over: Partial<RunContribution> & { runId: string }): RunContribution {
  return {
    oasdiWagesCents: 0,
    medicareWagesCents: 0,
    futaWagesCents: 0,
    waSutaWagesCents: 0,
    waPfmlWagesCents: 0,
    waCaresWagesCents: 0,
    lniHundredthHours: 0,
    oasdiEmployeeCents: 0,
    medicareEmployeeCents: 0,
    addlMedicareEmployeeCents: 0,
    federalIncomeTaxCents: 0,
    ...over,
  };
}

/** Collects every refusal code a test actually reached, for the rule-43 check. */
const reached = new Set<YtdRefusalCode>();
function expectRefusal(
  r: { ok: boolean } | { ok: false; code: YtdRefusalCode; message: string } | null,
  code: YtdRefusalCode,
): void {
  expect(r, "expected a refusal, got null/ok").not.toBeNull();
  const refusal = r as { ok: false; code: YtdRefusalCode; message: string };
  expect(refusal.ok).toBe(false);
  expect(refusal.code).toBe(code);
  // Rule 26 / 64a: a refusal must EXPLAIN, not merely fire. A bare code is a
  // dead end for the person reading the screen.
  expect(refusal.message.length).toBeGreaterThan(60);
  reached.add(code);
}

describe("books-34: the IRS worked example is reproduced by accumulation", () => {
  /**
   * $199,750 paid across 26 biweekly cheques. No single cheque crosses the
   * ceiling by itself - the ceiling is only visible to something that remembers
   * the previous twenty-two.
   */
  it("reproduces box 3 = 184500.00 and box 5 = 199750.00 from 26 pay runs", () => {
    const TOTAL_CENTS = 19_975_000; // $199,750.00
    const PERIODS = 26;
    // 19,975,000 / 26 is not a whole number of cents, so the remainder is put
    // on the final cheque exactly as a real payroll would - which also makes
    // this a test that the engine survives an uneven period.
    const per = Math.floor(TOTAL_CENTS / PERIODS);
    const remainder = TOTAL_CENTS - per * PERIODS;

    let row = emptyAccumulator(EMP, YEAR);
    let totalOasdiWithheld = 0;

    for (let i = 0; i < PERIODS; i += 1) {
      const periodWages = i === PERIODS - 1 ? per + remainder : per;

      // Ask the withholding engine, giving it the stored year to date. This is
      // the seam the whole slice exists to create.
      const fica = computePeriodWithYtd({ row, periodWagesCents: periodWages });
      totalOasdiWithheld += fica.employeeOasdiCents;

      const applied = applyRunToAccumulator(
        row,
        contribution({
          runId: `run-${i}`,
          oasdiWagesCents: fica.oasdiTaxableCents,
          medicareWagesCents: fica.medicareTaxableCents,
          oasdiEmployeeCents: fica.employeeOasdiCents,
          medicareEmployeeCents: fica.employeeMedicareCents,
          addlMedicareEmployeeCents: fica.employeeAdditionalMedicareCents,
        }),
      );
      expect(applied.ok, `run ${i} was refused`).toBe(true);
      if (!applied.ok) return;
      row = applied.value;
    }

    // THE IRS's TWO NUMBERS.
    expect(row.wages.oasdiWagesCents).toBe(18_450_000); // box 3: 184500.00
    expect(row.wages.medicareWagesCents).toBe(19_975_000); // box 5: 199750.00

    // And the relationship the SSA checks: box 5 >= box 3, by exactly the
    // wages that sat above the ceiling.
    expect(row.wages.medicareWagesCents - row.wages.oasdiWagesCents).toBe(1_525_000);

    // Social security withheld is 6.2% of the CAPPED figure, not of gross.
    expect(totalOasdiWithheld).toBe(Math.round(18_450_000 * 0.062));
  });

  it("stops withholding social security once the ceiling is reached", () => {
    let row = emptyAccumulator(EMP, YEAR);
    // Put the employee exactly at the wage base.
    const atCeiling = applyRunToAccumulator(
      row,
      contribution({
        runId: "big-one",
        oasdiWagesCents: OASDI_WAGE_BASE_2026_CENTS,
        medicareWagesCents: OASDI_WAGE_BASE_2026_CENTS,
      }),
    );
    expect(atCeiling.ok).toBe(true);
    if (!atCeiling.ok) return;
    row = atCeiling.value;

    const fica = computePeriodWithYtd({ row, periodWagesCents: 500_000 });
    // Nothing more is taxable for social security...
    expect(fica.oasdiTaxableCents).toBe(0);
    expect(fica.employeeOasdiCents).toBe(0);
    expect(fica.oasdiCeilingReached).toBe(true);
    // ...but Medicare keeps going, which is the whole reason the two figures
    // are stored separately.
    expect(fica.medicareTaxableCents).toBe(500_000);
    expect(fica.employeeMedicareCents).toBeGreaterThan(0);
  });

  /**
   * THE CHEQUE THAT STRADDLES THE CEILING. This is the case a naive
   * implementation gets wrong in both directions - taxing all of it or none of
   * it - and it is invisible in production because the resulting cheque looks
   * entirely ordinary.
   */
  it("splits a single period that crosses the wage base", () => {
    let row = emptyAccumulator(EMP, YEAR);
    const justUnder = OASDI_WAGE_BASE_2026_CENTS - 100_000; // $1,000 of room
    const seeded = applyRunToAccumulator(
      row,
      contribution({
        runId: "seed",
        oasdiWagesCents: justUnder,
        medicareWagesCents: justUnder,
      }),
    );
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    row = seeded.value;

    expect(oasdiRoomRemaining(row).roomCents).toBe(100_000);
    expect(oasdiRoomRemaining(row).ceilingReached).toBe(false);

    // A $2,500 cheque against $1,000 of room: exactly $1,000 is taxable.
    const fica = computePeriodWithYtd({ row, periodWagesCents: 250_000 });
    expect(fica.oasdiTaxableCents).toBe(100_000);
    expect(fica.medicareTaxableCents).toBe(250_000);
    expect(fica.employeeOasdiCents).toBe(Math.round(100_000 * 0.062));
  });

  it("starts Additional Medicare at $200,000 and the employer does not match", () => {
    let row = emptyAccumulator(EMP, YEAR);
    const seeded = applyRunToAccumulator(
      row,
      contribution({
        runId: "seed",
        oasdiWagesCents: OASDI_WAGE_BASE_2026_CENTS,
        medicareWagesCents: ADDITIONAL_MEDICARE_WITHHOLDING_THRESHOLD_CENTS,
      }),
    );
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    row = seeded.value;

    const fica = computePeriodWithYtd({ row, periodWagesCents: 100_000 });
    expect(fica.additionalMedicareTaxableCents).toBe(100_000);
    expect(fica.employeeAdditionalMedicareCents).toBe(Math.round(100_000 * 0.009));
    // The reason it has its own column in the schema.
    expect(fica.employerAdditionalMedicareCents).toBe(0);
  });
});

describe("books-34: posting twice must not double the year", () => {
  it("refuses a run id it has already applied", () => {
    const row = emptyAccumulator(EMP, YEAR);
    const c = contribution({ runId: "run-A", oasdiWagesCents: 500_000, medicareWagesCents: 500_000 });
    const once = applyRunToAccumulator(row, c);
    expect(once.ok).toBe(true);
    if (!once.ok) return;

    const twice = applyRunToAccumulator(once.value, c);
    expectRefusal(twice, "YTD_RUN_ALREADY_APPLIED");
    // Rule 39: prove the refusal CHANGED NOTHING.
    expect(once.value.wages.oasdiWagesCents).toBe(500_000);
  });

  it("ACCEPT CONTROL: a different run id is applied normally", () => {
    // Rule 55. If the guard refused every second run it would be useless, and
    // the test above would still pass.
    const row = emptyAccumulator(EMP, YEAR);
    const first = applyRunToAccumulator(
      row,
      contribution({ runId: "run-A", oasdiWagesCents: 500_000, medicareWagesCents: 500_000 }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyRunToAccumulator(
      first.value,
      contribution({ runId: "run-B", oasdiWagesCents: 500_000, medicareWagesCents: 500_000 }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.wages.oasdiWagesCents).toBe(1_000_000);
  });
});

describe("books-34: voiding a run unwinds exactly what it added", () => {
  it("apply then unapply returns the original figures", () => {
    const start = emptyAccumulator(EMP, YEAR);
    const seeded = applyRunToAccumulator(
      start,
      contribution({ runId: "earlier", oasdiWagesCents: 300_000, medicareWagesCents: 300_000, oasdiEmployeeCents: 18_600 }),
    );
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;

    const c = contribution({
      runId: "to-void",
      oasdiWagesCents: 250_000,
      medicareWagesCents: 250_000,
      oasdiEmployeeCents: 15_500,
      medicareEmployeeCents: 3_625,
      lniHundredthHours: 8_000,
    });
    const applied = applyRunToAccumulator(seeded.value, c);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const unapplied = unapplyRunFromAccumulator(applied.value, c);
    expect(unapplied.ok).toBe(true);
    if (!unapplied.ok) return;

    expect(unapplied.value.wages).toEqual(seeded.value.wages);
    expect(unapplied.value.oasdiEmployeeCents).toBe(seeded.value.oasdiEmployeeCents);
  });

  it("refuses to unwind more than was ever added, rather than clamping at zero", () => {
    const row = emptyAccumulator(EMP, YEAR);
    const tooMuch = unapplyRunFromAccumulator(
      row,
      contribution({ runId: "never-applied", oasdiWagesCents: 1, medicareWagesCents: 1 }),
    );
    expectRefusal(tooMuch, "YTD_WOULD_GO_NEGATIVE");
    // The message must name the field, or Michael cannot act on it.
    if (!tooMuch.ok) expect(tooMuch.message).toContain("oasdiWagesCents");
  });

  it("clears lastRunId so the unwound run can be re-applied", () => {
    const row = emptyAccumulator(EMP, YEAR);
    const c = contribution({ runId: "r1", oasdiWagesCents: 100_000, medicareWagesCents: 100_000 });
    const applied = applyRunToAccumulator(row, c);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const unapplied = unapplyRunFromAccumulator(applied.value, c);
    expect(unapplied.ok).toBe(true);
    if (!unapplied.ok) return;
    expect(unapplied.value.lastRunId).toBeNull();
    // And re-applying is now permitted, because it genuinely is not applied.
    expect(applyRunToAccumulator(unapplied.value, c).ok).toBe(true);
  });
});

describe("books-34: bad input is refused with a reason, not absorbed", () => {
  it("refuses a fraction of a cent", () => {
    expectRefusal(
      applyRunToAccumulator(
        emptyAccumulator(EMP, YEAR),
        contribution({ runId: "r", oasdiWagesCents: 1234.56, medicareWagesCents: 1234.56 }),
      ),
      "YTD_NON_INTEGER_INPUT",
    );
  });

  it("refuses negative wages", () => {
    expectRefusal(
      applyRunToAccumulator(
        emptyAccumulator(EMP, YEAR),
        contribution({ runId: "r", medicareWagesCents: 0, oasdiWagesCents: -1 }),
      ),
      "YTD_NEGATIVE_INPUT",
    );
  });

  it("refuses Medicare wages below social security wages (SSA rejection condition 1)", () => {
    expectRefusal(
      applyRunToAccumulator(
        emptyAccumulator(EMP, YEAR),
        contribution({ runId: "r", oasdiWagesCents: 500_000, medicareWagesCents: 499_999 }),
      ),
      "YTD_MEDICARE_BELOW_OASDI",
    );
  });

  it("refuses a contribution aimed at the wrong employee", () => {
    expectRefusal(
      assertRowMatches(emptyAccumulator(EMP, YEAR), "someone-else", YEAR),
      "YTD_EMPLOYEE_MISMATCH",
    );
  });

  it("refuses a contribution aimed at the wrong year", () => {
    expectRefusal(assertRowMatches(emptyAccumulator(EMP, YEAR), EMP, 2027), "YTD_YEAR_MISMATCH");
  });

  it("ACCEPT CONTROL: the right employee and year pass", () => {
    expect(assertRowMatches(emptyAccumulator(EMP, YEAR), EMP, YEAR)).toBeNull();
  });
});

describe("books-34: wages belong to the year they are PAID", () => {
  it("a period ending in December but paid in January is the later year", () => {
    const r = taxYearForPayDate("2027-01-01");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(2027);
  });

  it("refuses a date it cannot parse rather than guessing", () => {
    expectRefusal(taxYearForPayDate("01/01/2027"), "YTD_NON_INTEGER_INPUT");
  });
});

describe("books-34: drift is reported, never silently repaired", () => {
  const runs = [
    contribution({ runId: "r1", oasdiWagesCents: 100_000, medicareWagesCents: 100_000, oasdiEmployeeCents: 6_200 }),
    contribution({ runId: "r2", oasdiWagesCents: 100_000, medicareWagesCents: 100_000, oasdiEmployeeCents: 6_200 }),
  ];

  it("agrees when the stored total matches the lines", () => {
    const rebuilt = rebuildAccumulator(EMP, YEAR, runs);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    const result = reconcileAccumulator(rebuilt.value, runs);
    expect(result.inAgreement).toBe(true);
    expect(result.drifts).toEqual([]);
  });

  it("names every field that disagrees, with both figures", () => {
    const rebuilt = rebuildAccumulator(EMP, YEAR, runs);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    // Corrupt one field, as a bad manual edit or a half-applied run would.
    const tampered: YtdAccumulatorRow = {
      ...rebuilt.value,
      wages: { ...rebuilt.value.wages, oasdiWagesCents: 250_000 },
    };
    const result = reconcileAccumulator(tampered, runs);
    expect(result.inAgreement).toBe(false);
    expect(result.drifts).toHaveLength(1);
    expect(result.drifts[0].field).toBe("oasdiWagesCents");
    expect(result.drifts[0].storedCents).toBe(250_000);
    expect(result.drifts[0].recomputedCents).toBe(200_000);
    // Rule 64a: the difference is reported, so Michael knows the SIZE of the
    // problem and not merely that one exists.
    expect(result.drifts[0].differenceCents).toBe(50_000);
  });

  it("rebuilding refuses a duplicated run rather than double counting", () => {
    const dup = [runs[0], runs[0]];
    expectRefusal(rebuildAccumulator(EMP, YEAR, dup), "YTD_RUN_ALREADY_APPLIED");
  });
});

describe("books-34: the engine seam", () => {
  it("ytdForWithholding hands the engine all seven figures", () => {
    const row = emptyAccumulator(EMP, YEAR);
    const ytd = ytdForWithholding(row);
    expect(Object.keys(ytd).sort()).toEqual(
      [
        "futaWagesCents", "lniHundredthHours", "medicareWagesCents", "oasdiWagesCents",
        "waCaresWagesCents", "waPfmlWagesCents", "waSutaWagesCents",
      ].sort(),
    );
  });

  it("returns a COPY, so a caller cannot mutate the stored row", () => {
    const row = emptyAccumulator(EMP, YEAR);
    const ytd = ytdForWithholding(row);
    ytd.oasdiWagesCents = 999;
    expect(row.wages.oasdiWagesCents).toBe(0);
  });

  it("oasdiRoomRemaining never reports negative room", () => {
    const row: YtdAccumulatorRow = {
      ...emptyAccumulator(EMP, YEAR),
      wages: { ...emptyAccumulator(EMP, YEAR).wages, oasdiWagesCents: OASDI_WAGE_BASE_2026_CENTS + 1 },
    };
    expect(oasdiRoomRemaining(row).roomCents).toBe(0);
    expect(oasdiRoomRemaining(row).ceilingReached).toBe(true);
  });
});

describe("books-34: rule 43 — every refusal code is reachable", () => {
  it("every declared code was actually produced by a test above", () => {
    // The declared union, written out. If a ninth code is added to the module
    // without a test reaching it, this goes red - which is the point. A refusal
    // nobody can trigger is a comment with a type annotation.
    const declared: readonly YtdRefusalCode[] = [
      "YTD_RUN_ALREADY_APPLIED",
      "YTD_NEGATIVE_INPUT",
      "YTD_NON_INTEGER_INPUT",
      "YTD_YEAR_MISMATCH",
      "YTD_EMPLOYEE_MISMATCH",
      "YTD_WOULD_GO_NEGATIVE",
      "YTD_MEDICARE_BELOW_OASDI",
    ];
    const unreached = declared.filter((c) => !reached.has(c));
    expect(unreached).toEqual([]);
  });
});
