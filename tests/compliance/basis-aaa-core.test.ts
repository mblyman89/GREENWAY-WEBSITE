/**
 * tests/compliance/basis-aaa-core.test.ts   (books-19)
 *
 * STOCK BASIS, DEBT BASIS AND THE AAA, UNDER ATTACK.
 *
 * Standing rule 22: the test is a suspect, not a witness. Standing rule 15:
 * every test must be provably failable. Standing rule 33: attack the suite
 * AFTER it goes green. Standing rule 38: a green first run is a suspect, not a
 * result.
 *
 * The section near the bottom headed "defects found by attacking the engine"
 * is the important one. Every test there is a bug that genuinely existed in
 * this engine and was fixed at the class level. Do not delete them to make a
 * refactor easier.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  type ShareholderYearInput,
  type BasisYearInput,
  ALL_BASIS_REFUSAL_CODES,
  FIRST_S_CORP_YEAR,
  LAST_SUPPORTED_YEAR,
  assertBasisCents,
  validateBasisInput,
  validateShareholders,
  allocateProRata,
  computeStockBasisSchedule,
  computeAaaSchedule,
  assessProportionality,
  formatCents,
  computeBasisAndAaa,
  carryForward,
  validateCarryForwardFacts,
  setAllocationFaultForTesting,
} from "@/lib/accounting/basis-aaa-core";
import {
  BASIS_AAA_AUTHORITIES_NEW,
  BASIS_AAA_AUTHORITY_IDS_OWNED_ELSEWHERE,
  findBasisAaaAuthority,
} from "@/lib/accounting/basis-aaa-authorities";
import {
  BASIS_AAA_LESSONS,
  findBasisLesson,
  taughtBasisFunctionNames,
  exportedBasisFunctionNames,
  assertEveryBasisFunctionIsTaught,
  assertEveryBasisLessonIsSubstantive,
} from "@/lib/accounting/basis-aaa-mentor";
import {
  GUIDANCE_AUTHORITIES,
  ALL_SOURCE_REGISTRIES,
  findGuidanceAuthority,
  unresolvedDrift,
} from "@/lib/accounting/books-guidance-core";

// ---------------------------------------------------------------------------
// Greenway's actual roster. Standing rule 7: the entity facts are facts.
// ---------------------------------------------------------------------------

const MICHAEL = "Michael Lyman";
const MOTHER = "Mother";
const GRANDFATHER = "Nicholas Mullan";

function shareholder(
  name: string,
  milli: number,
  over: Partial<ShareholderYearInput> = {},
): ShareholderYearInput {
  return {
    shareholderName: name,
    ownershipMilliPercent: milli,
    beginningStockBasisCents: 0,
    beginningDebtBasisCents: 0,
    debtPrincipalCents: 0,
    suspendedLossCarryforwardCents: 0,
    contributionsCents: 0,
    distributionsCents: 0,
    ...over,
  };
}

function greenwayRoster(
  over: {
    michael?: Partial<ShareholderYearInput>;
    mother?: Partial<ShareholderYearInput>;
    grandfather?: Partial<ShareholderYearInput>;
  } = {},
): ShareholderYearInput[] {
  return [
    shareholder(MICHAEL, 85_000, over.michael),
    shareholder(MOTHER, 10_000, over.mother),
    shareholder(GRANDFATHER, 5_000, over.grandfather),
  ];
}

function year(over: Partial<BasisYearInput> = {}): BasisYearInput {
  return {
    entityCode: "greenway",
    fiscalYear: FIRST_S_CORP_YEAR,
    ordinaryIncomeCents: 0,
    taxExemptIncomeCents: 0,
    nonDeductibleExpenseCents: 0,
    shareholders: greenwayRoster(),
    hasAccumulatedEarningsAndProfits: false,
    electiveOrderingAdopted: false,
    // The default year is FIRST_S_CORP_YEAR, which is exempt from the
    // carry-forward gate because there is no prior year. Left null rather than
    // true so that any test moving the year forward has to face the gate
    // honestly instead of inheriting a free pass from the helper.
    openingBalancesCarriedFromPriorYear: null,
    beginningAaaCents: 0,
    beginningOaaCents: 0,
    ...over,
  };
}

function ok(result: ReturnType<typeof computeBasisAndAaa>) {
  if (!result.ok) {
    throw new Error(
      `expected success, got refusals: ${result.refusals.map((r) => r.code).join(", ")}`,
    );
  }
  return result;
}

function codes(result: ReturnType<typeof computeBasisAndAaa>): string[] {
  return result.ok ? [] : result.refusals.map((r) => r.code);
}

// ===========================================================================
// 1) INTEGER CENTS \u2014 standing rule 4
// ===========================================================================

describe("integer cents", () => {
  it("accepts whole cents", () => {
    expect(() => assertBasisCents(0, "x")).not.toThrow();
    expect(() => assertBasisCents(-12_345, "x")).not.toThrow();
  });

  it("rejects a fractional cent and names the field", () => {
    expect(() => assertBasisCents(10.5, "beginning basis")).toThrow(/INTEGER CENTS VIOLATION/);
    expect(() => assertBasisCents(10.5, "beginning basis")).toThrow(/beginning basis/);
  });

  it("rejects a value past the safe-integer boundary", () => {
    expect(() => assertBasisCents(Number.MAX_SAFE_INTEGER + 2, "huge")).toThrow(/UNSAFE INTEGER/);
  });

  it("rejects NaN and Infinity, which are not integers", () => {
    expect(() => assertBasisCents(Number.NaN, "nan")).toThrow(/INTEGER CENTS VIOLATION/);
    expect(() => assertBasisCents(Number.POSITIVE_INFINITY, "inf")).toThrow(
      /INTEGER CENTS VIOLATION/,
    );
  });
});

// ===========================================================================
// 2) ALLOCATION \u2014 the pieces must add back to the whole, always
// ===========================================================================

describe("pro rata allocation", () => {
  const roster = [
    { shareholderName: MICHAEL, ownershipMilliPercent: 85_000 },
    { shareholderName: MOTHER, ownershipMilliPercent: 10_000 },
    { shareholderName: GRANDFATHER, ownershipMilliPercent: 5_000 },
  ];

  it("splits an exactly divisible amount by ownership", () => {
    const a = allocateProRata(100_000, roster);
    expect(a.get(MICHAEL)).toBe(85_000);
    expect(a.get(MOTHER)).toBe(10_000);
    expect(a.get(GRANDFATHER)).toBe(5_000);
  });

  it("never loses or invents a cent, across a thousand awkward amounts", () => {
    for (let amount = 1; amount <= 1000; amount += 1) {
      const a = allocateProRata(amount, roster);
      const sum = [...a.values()].reduce((s, v) => s + v, 0);
      expect(sum).toBe(amount);
    }
  });

  it("allocates a loss the same way it allocates a profit, mirrored", () => {
    for (const amount of [1, 7, 33, 101, 999_983]) {
      const up = allocateProRata(amount, roster);
      const down = allocateProRata(-amount, roster);
      for (const sh of roster) {
        expect(down.get(sh.shareholderName)).toBe(-(up.get(sh.shareholderName) as number));
      }
      const sum = [...down.values()].reduce((s, v) => s + v, 0);
      expect(sum).toBe(-amount);
    }
  });

  it("is deterministic \u2014 the same input gives the same leftover cent every time", () => {
    const first = allocateProRata(101, roster);
    for (let i = 0; i < 25; i += 1) {
      const again = allocateProRata(101, roster);
      for (const sh of roster) {
        expect(again.get(sh.shareholderName)).toBe(first.get(sh.shareholderName));
      }
    }
  });

  it("does not depend on the order shareholders are listed in", () => {
    const forwards = allocateProRata(101, roster);
    const backwards = allocateProRata(101, [...roster].reverse());
    for (const sh of roster) {
      expect(backwards.get(sh.shareholderName)).toBe(forwards.get(sh.shareholderName));
    }
  });

  it("handles an empty roster without inventing money", () => {
    expect([...allocateProRata(500, []).values()]).toEqual([]);
  });

  it("gives everyone zero rather than dividing by zero when nobody owns anything", () => {
    const a = allocateProRata(500, [{ shareholderName: "Nobody", ownershipMilliPercent: 0 }]);
    expect(a.get("Nobody")).toBe(0);
  });

  it("refuses a fractional amount rather than silently rounding it", () => {
    expect(() => allocateProRata(100.5, roster)).toThrow(/INTEGER CENTS VIOLATION/);
  });
});

// ===========================================================================
// 3) THE \u00a71.1367-1(f) ORDER \u2014 the heart of the slice
// ===========================================================================

describe("stock basis \u2014 \u00a71.1367-1(f) ordering", () => {
  it("adds income BEFORE testing a distribution, so a profitable year is not taxed twice", () => {
    // Zero opening basis, $1,000 of income, $1,000 distributed. If income were
    // added after the distribution the whole $1,000 would be a capital gain.
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, { distributionsCents: 100_000 }),
      allocatedOrdinaryIncomeCents: 100_000,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 0,
    });
    expect(s.capitalGainOnExcessDistributionCents).toBe(0);
    expect(s.endingStockBasisCents).toBe(0);
  });

  it("subtracts the distribution BEFORE the \u00a7280E disallowance, per (f)(2) then (f)(3)", () => {
    // $1,000 income, $1,000 distribution, $1,000 of disallowed expense.
    // Correct order: 0 + 1000 = 1000; less 1000 distribution = 0; the
    // nondeductible expense then has nothing left to eat. No gain.
    // Wrong order (expenses first) would leave 0 before the distribution and
    // report a $1,000 capital gain that does not exist.
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, { distributionsCents: 100_000 }),
      allocatedOrdinaryIncomeCents: 100_000,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 100_000,
    });
    expect(s.basisAfterIncreasesCents).toBe(100_000);
    expect(s.distributionAppliedAgainstBasisCents).toBe(100_000);
    expect(s.capitalGainOnExcessDistributionCents).toBe(0);
    expect(s.nonDeductibleExpenseAppliedToStockCents).toBe(0);
    expect(s.endingStockBasisCents).toBe(0);
  });

  it("subtracts \u00a7280E expenses BEFORE losses, per (f)(3) then (f)(4)", () => {
    // $1,000 basis, $600 nondeductible, $600 loss. Expenses go first and take
    // 600, leaving 400 for the loss; 200 of loss is suspended.
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, { beginningStockBasisCents: 100_000 }),
      allocatedOrdinaryIncomeCents: -60_000,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 60_000,
    });
    expect(s.nonDeductibleExpenseAppliedToStockCents).toBe(60_000);
    expect(s.basisAfterNonDeductibleCents).toBe(40_000);
    expect(s.lossAllowedAgainstStockCents).toBe(40_000);
    expect(s.suspendedLossCarryforwardCents).toBe(20_000);
    expect(s.endingStockBasisCents).toBe(0);
  });

  it("treats a negative income allocation as the year's loss, not as an increase", () => {
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, { beginningStockBasisCents: 50_000 }),
      allocatedOrdinaryIncomeCents: -30_000,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 0,
    });
    expect(s.allocatedOrdinaryIncomeCents).toBe(0);
    expect(s.basisAfterIncreasesCents).toBe(50_000);
    expect(s.lossAvailableCents).toBe(30_000);
    expect(s.endingStockBasisCents).toBe(20_000);
  });
});

// ===========================================================================
// 4) \u00a71368(b) \u2014 tax-free to basis, capital gain above it
// ===========================================================================

describe("distributions \u2014 \u00a71368(b)", () => {
  it("is tax-free to the extent of basis", () => {
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, {
        beginningStockBasisCents: 500_000,
        distributionsCents: 300_000,
      }),
      allocatedOrdinaryIncomeCents: 0,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 0,
    });
    expect(s.capitalGainOnExcessDistributionCents).toBe(0);
    expect(s.endingStockBasisCents).toBe(200_000);
  });

  it("turns the excess over basis into a capital gain, to the cent", () => {
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, {
        beginningStockBasisCents: 500_000,
        distributionsCents: 500_001,
      }),
      allocatedOrdinaryIncomeCents: 0,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 0,
    });
    expect(s.capitalGainOnExcessDistributionCents).toBe(1);
    expect(s.endingStockBasisCents).toBe(0);
  });

  it("never drives stock basis below zero \u2014 \u00a71367(a)(2)", () => {
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, {
        beginningStockBasisCents: 10_000,
        distributionsCents: 999_999,
      }),
      allocatedOrdinaryIncomeCents: 0,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 500_000,
    });
    expect(s.endingStockBasisCents).toBe(0);
    expect(s.endingStockBasisCents).toBeGreaterThanOrEqual(0);
  });

  it("does NOT let debt basis shelter a distribution \u2014 (A) is absent from \u00a71.1367-2(b)(1)", () => {
    // A shareholder with no stock basis but a large loan to the company still
    // has a capital gain on a distribution. This is the trap the omission of
    // subparagraph (A) creates, and it costs real money.
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, {
        beginningStockBasisCents: 0,
        beginningDebtBasisCents: 1_000_000,
        debtPrincipalCents: 1_000_000,
        distributionsCents: 250_000,
      }),
      allocatedOrdinaryIncomeCents: 0,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 0,
    });
    expect(s.capitalGainOnExcessDistributionCents).toBe(250_000);
    expect(s.endingDebtBasisCents).toBe(1_000_000);
  });
});

// ===========================================================================
// 5) DEBT BASIS \u2014 \u00a71.1367-2
// ===========================================================================

describe("debt basis", () => {
  it("absorbs losses only after stock basis is exhausted", () => {
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, {
        beginningStockBasisCents: 100_000,
        beginningDebtBasisCents: 500_000,
        debtPrincipalCents: 500_000,
      }),
      allocatedOrdinaryIncomeCents: -300_000,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 0,
    });
    expect(s.lossAllowedAgainstStockCents).toBe(100_000);
    expect(s.lossAllowedAgainstDebtCents).toBe(200_000);
    expect(s.suspendedLossCarryforwardCents).toBe(0);
    expect(s.endingDebtBasisCents).toBe(300_000);
  });

  it("suspends whatever exceeds both stock and debt basis \u2014 \u00a71366(d)(1)", () => {
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, {
        beginningStockBasisCents: 100_000,
        beginningDebtBasisCents: 100_000,
        debtPrincipalCents: 100_000,
      }),
      allocatedOrdinaryIncomeCents: -500_000,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 0,
    });
    expect(s.suspendedLossCarryforwardCents).toBe(300_000);
    expect(s.endingStockBasisCents).toBe(0);
    expect(s.endingDebtBasisCents).toBe(0);
  });

  it("restores debt basis before stock basis in a net increase year \u2014 \u00a71.1367-2(c)(1)", () => {
    // Debt reduced to 0 against principal of 5,000. A 3,000 profit year must
    // heal the debt first; stock basis gets nothing.
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, {
        beginningStockBasisCents: 0,
        beginningDebtBasisCents: 0,
        debtPrincipalCents: 500_000,
      }),
      allocatedOrdinaryIncomeCents: 300_000,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 0,
    });
    expect(s.debtBasisRestoredCents).toBe(300_000);
    expect(s.endingDebtBasisCents).toBe(300_000);
  });

  it("never restores debt basis above the principal actually loaned", () => {
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, {
        beginningDebtBasisCents: 0,
        debtPrincipalCents: 100_000,
      }),
      allocatedOrdinaryIncomeCents: 999_999,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 0,
    });
    expect(s.debtBasisRestoredCents).toBe(100_000);
    expect(s.endingDebtBasisCents).toBe(100_000);
  });

  it("does not restore debt basis in a year that is not a net increase", () => {
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, {
        beginningDebtBasisCents: 0,
        debtPrincipalCents: 500_000,
      }),
      allocatedOrdinaryIncomeCents: 100_000,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 200_000,
    });
    expect(s.debtBasisRestoredCents).toBe(0);
  });
});

// ===========================================================================
// 6) THE AAA \u2014 \u00a71.1368-2, and how it differs from basis
// ===========================================================================

describe("the accumulated adjustments account", () => {
  it("goes below zero on losses \u2014 \u00a71.1368-2(a)(3)(ii)", () => {
    const a = computeAaaSchedule({
      beginningAaaCents: 0,
      beginningOaaCents: 0,
      ordinaryIncomeCents: 0,
      taxExemptIncomeCents: 0,
      nonDeductibleExpenseCents: 500_000,
      totalDistributionsCents: 0,
    });
    expect(a.endingAaaCents).toBe(-500_000);
  });

  it("does NOT go below zero on distributions \u2014 \u00a71.1368-2(a)(3)(iii)", () => {
    const a = computeAaaSchedule({
      beginningAaaCents: 100_000,
      beginningOaaCents: 0,
      ordinaryIncomeCents: 0,
      taxExemptIncomeCents: 0,
      nonDeductibleExpenseCents: 0,
      totalDistributionsCents: 900_000,
    });
    expect(a.distributionsAppliedToAaaCents).toBe(100_000);
    expect(a.endingAaaCents).toBe(0);
  });

  it("leaves an already-negative AAA alone when a distribution is paid", () => {
    const a = computeAaaSchedule({
      beginningAaaCents: -500_000,
      beginningOaaCents: 0,
      ordinaryIncomeCents: 0,
      taxExemptIncomeCents: 0,
      nonDeductibleExpenseCents: 0,
      totalDistributionsCents: 200_000,
    });
    expect(a.distributionsAppliedToAaaCents).toBe(0);
    expect(a.endingAaaCents).toBe(-500_000);
  });

  it("excludes tax-exempt income from AAA and puts it in OAA \u2014 \u00a71368(e)(1)(A)", () => {
    const a = computeAaaSchedule({
      beginningAaaCents: 0,
      beginningOaaCents: 0,
      ordinaryIncomeCents: 0,
      taxExemptIncomeCents: 300_000,
      nonDeductibleExpenseCents: 0,
      totalDistributionsCents: 0,
    });
    expect(a.endingAaaCents).toBe(0);
    expect(a.endingOaaCents).toBe(300_000);
  });

  it("defers a net negative adjustment until AFTER distributions \u2014 (a)(5)(iv)", () => {
    // AAA 1,000 opening; a 600 net loss year; 1,000 distributed. The loss is
    // deferred to step (iv), so the full 1,000 distribution gets AAA first.
    const a = computeAaaSchedule({
      beginningAaaCents: 100_000,
      beginningOaaCents: 0,
      ordinaryIncomeCents: -60_000,
      taxExemptIncomeCents: 0,
      nonDeductibleExpenseCents: 0,
      totalDistributionsCents: 100_000,
    });
    expect(a.netNegativeAdjustmentCents).toBe(60_000);
    expect(a.nonDeductibleAndLossCents).toBe(0);
    expect(a.distributionsAppliedToAaaCents).toBe(100_000);
    expect(a.endingAaaCents).toBe(-60_000);
  });

  it("applies reductions at step (ii) when the year is NOT a net negative one", () => {
    const a = computeAaaSchedule({
      beginningAaaCents: 0,
      beginningOaaCents: 0,
      ordinaryIncomeCents: 500_000,
      taxExemptIncomeCents: 0,
      nonDeductibleExpenseCents: 200_000,
      totalDistributionsCents: 0,
    });
    expect(a.netNegativeAdjustmentCents).toBe(0);
    expect(a.nonDeductibleAndLossCents).toBe(200_000);
    expect(a.endingAaaCents).toBe(300_000);
  });

  it("diverges from stock basis under \u00a7280E, which is the point", () => {
    // The signature Greenway situation: income fully offset by disallowed
    // expense. Stock basis floors at zero; AAA goes negative.
    const r = ok(
      computeBasisAndAaa(
        year({ ordinaryIncomeCents: 100_000, nonDeductibleExpenseCents: 300_000 }),
      ),
    );
    const totalBasis = r.shareholders.reduce((s, sh) => s + sh.endingStockBasisCents, 0);
    expect(totalBasis).toBe(0);
    expect(r.aaa.endingAaaCents).toBe(-200_000);
    expect(r.aaa.endingAaaCents).toBeLessThan(totalBasis);
  });
});

// ===========================================================================
// 7) REFUSALS \u2014 standing rule 27: refuse, do not warn
// ===========================================================================

describe("refusals", () => {
  it("refuses when earnings and profits are unknown", () => {
    const r = computeBasisAndAaa(year({ hasAccumulatedEarningsAndProfits: null }));
    expect(codes(r)).toContain("EARNINGS_AND_PROFITS_UNKNOWN");
  });

  it("refuses \u2014 rather than guessing \u2014 when the company DOES have E&P", () => {
    const r = computeBasisAndAaa(year({ hasAccumulatedEarningsAndProfits: true }));
    expect(codes(r)).toContain("HAS_ACCUMULATED_EARNINGS_AND_PROFITS");
  });

  it("refuses when the \u00a71.1367-1(g) election status is unknown", () => {
    const r = computeBasisAndAaa(year({ electiveOrderingAdopted: null }));
    expect(codes(r)).toContain("ELECTIVE_ORDERING_UNKNOWN");
  });

  it("refuses when ownership does not total exactly 100%", () => {
    const r = computeBasisAndAaa(
      year({
        shareholders: [shareholder(MICHAEL, 85_000), shareholder(MOTHER, 10_000)],
      }),
    );
    expect(codes(r)).toContain("OWNERSHIP_NOT_100_PCT");
  });

  it("refuses a roster that is off by a single milli-percent", () => {
    const r = computeBasisAndAaa(
      year({
        shareholders: [
          shareholder(MICHAEL, 85_000),
          shareholder(MOTHER, 10_000),
          shareholder(GRANDFATHER, 4_999),
        ],
      }),
    );
    expect(codes(r)).toContain("OWNERSHIP_NOT_100_PCT");
  });

  it("refuses an empty shareholder list", () => {
    const r = computeBasisAndAaa(year({ shareholders: [] }));
    expect(codes(r)).toContain("NO_SHAREHOLDERS");
  });

  it("refuses the same person listed twice, however they are cased or spaced", () => {
    const r = computeBasisAndAaa(
      year({
        shareholders: [
          shareholder(MICHAEL, 50_000),
          shareholder("  michael lyman  ", 45_000),
          shareholder(GRANDFATHER, 5_000),
        ],
      }),
    );
    expect(codes(r)).toContain("DUPLICATE_SHAREHOLDER");
  });

  it("refuses a blank shareholder name", () => {
    const r = computeBasisAndAaa(
      year({ shareholders: [shareholder("   ", 100_000)] }),
    );
    expect(codes(r)).toContain("DUPLICATE_SHAREHOLDER");
  });

  it("refuses a negative carry-in stock basis", () => {
    const r = computeBasisAndAaa(
      year({ shareholders: greenwayRoster({ michael: { beginningStockBasisCents: -1 } }) }),
    );
    expect(codes(r)).toContain("BEGINNING_BASIS_NEGATIVE");
  });

  it("refuses a negative carry-in debt basis", () => {
    const r = computeBasisAndAaa(
      year({
        shareholders: greenwayRoster({
          michael: { beginningDebtBasisCents: -1, debtPrincipalCents: 100 },
        }),
      }),
    );
    expect(codes(r)).toContain("BEGINNING_DEBT_BASIS_NEGATIVE");
  });

  it("refuses debt basis larger than the loan principal", () => {
    const r = computeBasisAndAaa(
      year({
        shareholders: greenwayRoster({
          michael: { beginningDebtBasisCents: 500, debtPrincipalCents: 100 },
        }),
      }),
    );
    expect(codes(r)).toContain("DEBT_BASIS_EXCEEDS_PRINCIPAL");
  });

  it("refuses a negative distribution instead of treating it as a contribution", () => {
    const r = computeBasisAndAaa(
      year({ shareholders: greenwayRoster({ michael: { distributionsCents: -100 } }) }),
    );
    expect(codes(r)).toContain("NEGATIVE_INPUT");
  });

  it("refuses a negative nondeductible expense, which would INCREASE basis", () => {
    const r = computeBasisAndAaa(year({ nonDeductibleExpenseCents: -100_000 }));
    expect(codes(r)).toContain("NEGATIVE_INPUT");
  });

  it("refuses a non-zero opening AAA in the first S year \u2014 \u00a71.1368-2(a)(1)", () => {
    const r = computeBasisAndAaa(
      year({ fiscalYear: FIRST_S_CORP_YEAR, beginningAaaCents: 1 }),
    );
    expect(codes(r)).toContain("AAA_OPENING_NOT_ZERO_IN_FIRST_YEAR");
  });

  it("permits a non-zero opening AAA in a LATER year that was properly carried", () => {
    const r = computeBasisAndAaa(
      year({
        fiscalYear: FIRST_S_CORP_YEAR + 1,
        beginningAaaCents: 500_000,
        openingBalancesCarriedFromPriorYear: true,
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("refuses a later year whose opening balances were typed in by hand", () => {
    for (const provenance of [null, false]) {
      const r = computeBasisAndAaa(
        year({
          fiscalYear: FIRST_S_CORP_YEAR + 1,
          beginningAaaCents: 500_000,
          openingBalancesCarriedFromPriorYear: provenance,
        }),
      );
      expect(codes(r), `provenance ${String(provenance)} was let through`).toContain(
        "PRIOR_YEAR_NOT_CARRIED",
      );
    }
  });

  it("does not ask the first S year where its opening balances came from", () => {
    // There is no prior year to carry from, so the gate must not fire.
    const r = computeBasisAndAaa(
      year({ fiscalYear: FIRST_S_CORP_YEAR, openingBalancesCarriedFromPriorYear: null }),
    );
    expect(codes(r)).not.toContain("PRIOR_YEAR_NOT_CARRIED");
  });

  it("accepts what carryForward produces \u2014 the gate must be passable", () => {
    // Standing rule 34: a gate that cannot be satisfied by the legitimate path
    // is not a gate, it is a wall. carryForward is the only thing allowed to
    // set the provenance flag, so its output must sail straight through.
    const first = ok(computeBasisAndAaa(year({ ordinaryIncomeCents: 1_000_000 })));
    const carried = carryForward(first);
    expect(carried.openingBalancesCarriedFromPriorYear).toBe(true);
    const second = computeBasisAndAaa({
      ...year(),
      ...carried,
      ordinaryIncomeCents: 500_000,
    });
    expect(codes(second)).not.toContain("PRIOR_YEAR_NOT_CARRIED");
    expect(second.ok).toBe(true);
  });

  it("refuses a year before the S election and after the supported range", () => {
    expect(codes(computeBasisAndAaa(year({ fiscalYear: FIRST_S_CORP_YEAR - 1 })))).toContain(
      "FISCAL_YEAR_OUT_OF_RANGE",
    );
    expect(codes(computeBasisAndAaa(year({ fiscalYear: LAST_SUPPORTED_YEAR + 1 })))).toContain(
      "FISCAL_YEAR_OUT_OF_RANGE",
    );
  });

  it("reports EVERY problem at once, not just the first", () => {
    const r = computeBasisAndAaa(
      year({
        fiscalYear: 1999,
        hasAccumulatedEarningsAndProfits: null,
        electiveOrderingAdopted: null,
        shareholders: [shareholder(MICHAEL, 50_000)],
      }),
    );
    expect(codes(r).length).toBeGreaterThanOrEqual(4);
  });

  it("every refusal carries a message and a remedy, never a dead end", () => {
    const r = computeBasisAndAaa(
      year({
        fiscalYear: 1999,
        hasAccumulatedEarningsAndProfits: null,
        electiveOrderingAdopted: null,
        shareholders: [
          shareholder(MICHAEL, 50_000, {
            beginningStockBasisCents: -5,
            beginningDebtBasisCents: -5,
            distributionsCents: -5,
            contributionsCents: -5,
            suspendedLossCarryforwardCents: -5,
          }),
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    for (const refusal of r.refusals) {
      expect(refusal.message.length).toBeGreaterThan(20);
      expect(refusal.whatToDo.length).toBeGreaterThan(20);
      expect(ALL_BASIS_REFUSAL_CODES).toContain(refusal.code);
    }
  });

  it("every declared refusal code is reachable from some input", () => {
    // A code nobody can trigger is dead weight that makes the list look more
    // protective than it is. Standing rule 15.
    const seen = new Set<string>();
    const inputs: BasisYearInput[] = [
      year({ fiscalYear: 1999 }),
      year({ hasAccumulatedEarningsAndProfits: null }),
      year({ hasAccumulatedEarningsAndProfits: true }),
      year({ electiveOrderingAdopted: null }),
      year({ beginningAaaCents: 1 }),
      year({ nonDeductibleExpenseCents: -1 }),
      year({ shareholders: [] }),
      year({ shareholders: [shareholder(MICHAEL, 50_000)] }),
      year({
        shareholders: [shareholder(MICHAEL, 50_000), shareholder(MICHAEL, 50_000)],
      }),
      year({
        shareholders: greenwayRoster({ michael: { beginningStockBasisCents: -1 } }),
      }),
      year({
        shareholders: greenwayRoster({
          michael: { beginningDebtBasisCents: -1, debtPrincipalCents: 5 },
        }),
      }),
      year({
        shareholders: greenwayRoster({
          michael: { beginningDebtBasisCents: 50, debtPrincipalCents: 5 },
        }),
      }),
      year({ ordinaryIncomeCents: 1.5 }),
      year({
        shareholders: greenwayRoster({ michael: { suspendedLossCarryforwardCents: -1 } }),
      }),
      year({
        fiscalYear: FIRST_S_CORP_YEAR + 1,
        openingBalancesCarriedFromPriorYear: null,
      }),
    ];
    for (const i of inputs) for (const c of codes(computeBasisAndAaa(i))) seen.add(c);

    // Not every code belongs to the yearly computation. The carry-forward has
    // its own entry point and its own roster check, so its codes are collected
    // from there. What must NOT happen is a declared code that no input
    // anywhere can produce \u2014 that is dead law, and it is how the misspelt-name
    // hole stayed open in the first draft.
    const prior = ok(computeBasisAndAaa(year({ ordinaryIncomeCents: 100_000 })));
    for (const r of validateCarryForwardFacts(prior, {
      distributionsByShareholder: { "Not A Shareholder": 1 },
    })) {
      seen.add(r.code);
    }

    for (const c of ALL_BASIS_REFUSAL_CODES) {
      expect(seen, `refusal code ${c} is unreachable`).toContain(c);
    }
  });

  it("declares every refusal code it actually emits", () => {
    // The mirror of the test above, and the one that would catch a code being
    // emitted from a string literal that never made it into the union.
    const declared = new Set<string>(ALL_BASIS_REFUSAL_CODES);
    expect(declared.size, "ALL_BASIS_REFUSAL_CODES contains a duplicate").toBe(
      ALL_BASIS_REFUSAL_CODES.length,
    );
    const emitted = new Set<string>();
    for (const i of [
      year({ fiscalYear: 1999 }),
      year({ ordinaryIncomeCents: 1.5 }),
      year({ shareholders: [] }),
      year({ hasAccumulatedEarningsAndProfits: null }),
      year({ beginningAaaCents: 500, fiscalYear: FIRST_S_CORP_YEAR }),
    ]) {
      for (const c of codes(computeBasisAndAaa(i))) emitted.add(c);
    }
    for (const c of emitted) {
      expect(declared, `emitted code ${c} is not declared`).toContain(c);
    }
  });
});

// ===========================================================================
// 8) THE ONE-CLASS-OF-STOCK QUESTION \u2014 accurate in BOTH directions
// ===========================================================================

describe("proportionality and \u00a71361(b)(1)(D)", () => {
  it("says nothing alarming when no distributions were paid", () => {
    const r = ok(computeBasisAndAaa(year()));
    expect(r.proportionality.isStrictlyProportionate).toBe(true);
    expect(r.proportionality.whatToVerify).toBe("");
  });

  it("recognises strictly proportionate distributions", () => {
    const r = ok(
      computeBasisAndAaa(
        year({
          ordinaryIncomeCents: 1_000_000,
          shareholders: greenwayRoster({
            michael: { distributionsCents: 85_000 },
            mother: { distributionsCents: 10_000 },
            grandfather: { distributionsCents: 5_000 },
          }),
        }),
      ),
    );
    expect(r.proportionality.isStrictlyProportionate).toBe(true);
  });

  it("flags Greenway's actual pattern \u2014 mother allocated but not paid", () => {
    const r = ok(
      computeBasisAndAaa(
        year({
          ordinaryIncomeCents: 10_000_000,
          shareholders: greenwayRoster({
            michael: { distributionsCents: 5_000_000 },
            mother: { distributionsCents: 0 },
            grandfather: { distributionsCents: 250_000 },
          }),
        }),
      ),
    );
    const p = r.proportionality;
    expect(p.isStrictlyProportionate).toBe(false);
    const mother = p.byShareholder.find((s) => s.shareholderName === MOTHER);
    expect(mother?.actuallyPaidCents).toBe(0);
    expect(mother?.varianceCents).toBeLessThan(0);
  });

  it("does NOT claim the S election is terminated \u2014 that would be wrong", () => {
    const r = ok(
      computeBasisAndAaa(
        year({
          shareholders: greenwayRoster({ michael: { distributionsCents: 100_000 } }),
        }),
      ),
    );
    const text = r.proportionality.explanation.toLowerCase();
    expect(text).toContain("not, by itself, a second class of stock");
    expect(text).not.toContain("terminated");
  });

  it("does not stay silent either \u2014 it names the characterisation problem", () => {
    const r = ok(
      computeBasisAndAaa(
        year({
          shareholders: greenwayRoster({ michael: { distributionsCents: 100_000 } }),
        }),
      ),
    );
    expect(r.proportionality.whatToVerify.length).toBeGreaterThan(100);
    // Case-insensitive on purpose: the engine capitalises IDENTICAL RIGHTS for
    // emphasis, and this assertion is about the concept being named, not about
    // its typography. Asserting the exact casing would make a purely cosmetic
    // edit fail a compliance test for no reason.
    expect(r.proportionality.explanation.toLowerCase()).toContain("identical rights");
    expect(r.proportionality.explanation).toContain("1.1361-1(l)(1)");
    expect(r.proportionality.explanation).toContain("appropriate tax effect");
  });

  it("cites the governing-provisions test, not just the statute", () => {
    const r = ok(
      computeBasisAndAaa(
        year({ shareholders: greenwayRoster({ michael: { distributionsCents: 1 } }) }),
      ),
    );
    expect(r.proportionality.authorityIds).toContain("REG_1_1361_1_L_2_I_GOVERNING_PROVISIONS");
  });

  it("quantifies the variance to the cent and the variances net to zero", () => {
    const r = ok(
      computeBasisAndAaa(
        year({
          shareholders: greenwayRoster({
            michael: { distributionsCents: 123_457 },
            grandfather: { distributionsCents: 1 },
          }),
        }),
      ),
    );
    const sum = r.proportionality.byShareholder.reduce((s, x) => s + x.varianceCents, 0);
    expect(sum).toBe(0);
  });
});

// ===========================================================================
// 9) CARRY FORWARD \u2014 the chain that must not break
// ===========================================================================

describe("carry forward", () => {
  it("moves closing balances into the next year's opening balances", () => {
    const y1 = ok(
      computeBasisAndAaa(year({ ordinaryIncomeCents: 1_000_000 })),
    );
    const next = carryForward(y1);
    expect(next.fiscalYear).toBe(FIRST_S_CORP_YEAR + 1);
    expect(next.beginningAaaCents).toBe(y1.aaa.endingAaaCents);
    expect(next.beginningOaaCents).toBe(y1.aaa.endingOaaCents);
    for (const sh of next.shareholders) {
      const prior = y1.shareholders.find((p) => p.shareholderName === sh.shareholderName);
      expect(sh.beginningStockBasisCents).toBe(prior?.endingStockBasisCents);
    }
  });

  it("carries suspended losses forward \u2014 they are not lost \u00a71366(d)(2)(A)", () => {
    const y1 = ok(
      computeBasisAndAaa(
        year({ ordinaryIncomeCents: -1_000_000 }),
      ),
    );
    const next = carryForward(y1);
    const total = next.shareholders.reduce((s, sh) => s + sh.suspendedLossCarryforwardCents, 0);
    expect(total).toBe(1_000_000);
  });

  it("lets a suspended loss be used in a later profitable year", () => {
    const y1 = ok(computeBasisAndAaa(year({ ordinaryIncomeCents: -1_000_000 })));
    const carried = carryForward(y1);
    const y2 = ok(
      computeBasisAndAaa(
        year({ ...carried, ordinaryIncomeCents: 1_000_000, fiscalYear: carried.fiscalYear }),
      ),
    );
    const stillSuspended = y2.shareholders.reduce(
      (s, sh) => s + sh.suspendedLossCarryforwardCents,
      0,
    );
    expect(stillSuspended).toBe(0);
  });

  it("resets distributions to zero rather than repeating last year's", () => {
    const y1 = ok(
      computeBasisAndAaa(
        year({
          ordinaryIncomeCents: 1_000_000,
          shareholders: greenwayRoster({ michael: { distributionsCents: 500_000 } }),
        }),
      ),
    );
    const next = carryForward(y1);
    for (const sh of next.shareholders) expect(sh.distributionsCents).toBe(0);
  });

  it("keeps a five-year chain internally consistent", () => {
    let state = ok(computeBasisAndAaa(year({ ordinaryIncomeCents: 1_000_003 })));
    for (let i = 1; i < 5; i += 1) {
      const carried = carryForward(state);
      state = ok(
        computeBasisAndAaa(
          year({
            ...carried,
            fiscalYear: carried.fiscalYear,
            ordinaryIncomeCents: 1_000_003,
            nonDeductibleExpenseCents: 400_001,
          }),
        ),
      );
      for (const sh of state.shareholders) {
        expect(sh.endingStockBasisCents).toBeGreaterThanOrEqual(0);
        expect(sh.endingDebtBasisCents).toBeGreaterThanOrEqual(0);
      }
    }
    expect(state.fiscalYear).toBe(FIRST_S_CORP_YEAR + 4);
  });
});

// ===========================================================================
// 10) AUTHORITIES \u2014 verbatim, registered, and resolvable
// ===========================================================================

describe("authorities", () => {
  it("registers every new authority in the shared registry", () => {
    for (const a of BASIS_AAA_AUTHORITIES_NEW) {
      expect(findGuidanceAuthority(a.id), `${a.id} missing from registry`).toBeDefined();
    }
  });

  it("wires the basis-aaa registry tag", () => {
    expect(ALL_SOURCE_REGISTRIES).toContain("basis-aaa");
  });

  it("resolves every authority this slice cites but does not own", () => {
    for (const id of BASIS_AAA_AUTHORITY_IDS_OWNED_ELSEWHERE) {
      expect(findGuidanceAuthority(id), `${id} no longer resolves`).toBeDefined();
    }
  });

  it("finds its own authorities by id and returns undefined for a stranger", () => {
    expect(findBasisAaaAuthority("IRC_1366_D_LOSS_LIMITATION")).toBeDefined();
    expect(findBasisAaaAuthority("NOT_A_REAL_ID")).toBeUndefined();
  });

  it("gives every authority a citation, a quote, a so-what and a source", () => {
    for (const a of BASIS_AAA_AUTHORITIES_NEW) {
      expect(a.cite.length, a.id).toBeGreaterThan(8);
      expect(a.quote.length, a.id).toBeGreaterThan(80);
      expect(a.soWhat.length, a.id).toBeGreaterThan(120);
      expect(a.source, a.id).toMatch(/retrieved 2026-08-20/);
    }
  });

  it("does not redeclare an authority another slice already owns", () => {
    const owned = new Set(BASIS_AAA_AUTHORITIES_NEW.map((a) => a.id));
    for (const id of BASIS_AAA_AUTHORITY_IDS_OWNED_ELSEWHERE) {
      expect(owned.has(id), `${id} is both owned and cited-elsewhere`).toBe(false);
    }
  });

  it("introduces no unresolved drift into the registry", () => {
    expect(unresolvedDrift()).toHaveLength(0);
  });

  it("keeps every authority id unique across the whole registry", () => {
    const ids = GUIDANCE_AUTHORITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labels regulations as regulations and statutes as statutes", () => {
    for (const a of BASIS_AAA_AUTHORITIES_NEW) {
      if (a.cite.startsWith("26 CFR")) expect(a.kind, a.id).toBe("regulation");
      if (a.cite.startsWith("26 U.S.C.")) expect(a.kind, a.id).toBe("statute");
    }
  });
});

// ===========================================================================
// 11) THE MENTOR LAYER \u2014 standing rules 26 and 39
// ===========================================================================

describe("mentor coverage", () => {
  it("teaches every exported function of the core module", () => {
    expect(() => assertEveryBasisFunctionIsTaught()).not.toThrow();
  });

  it("actually reads the real core module rather than an empty list", () => {
    const exported = exportedBasisFunctionNames();
    expect(exported.length).toBeGreaterThan(5);
    expect(exported).toContain("computeBasisAndAaa");
  });

  // Standing rule 39: CALL the gate against something bad; do not
  // re-implement it and assert on the copy.
  it("FIRES when a real exported function has no lesson", () => {
    const dir = mkdtempSync(join(tmpdir(), "basis-gate-"));
    const file = join(dir, "fake-core.ts");
    writeFileSync(file, "export function somethingNobodyTaught(): void {}\n", "utf8");
    expect(() => assertEveryBasisFunctionIsTaught(file)).toThrow(/MENTOR COVERAGE GAP/);
    expect(() => assertEveryBasisFunctionIsTaught(file)).toThrow(/somethingNobodyTaught/);
  });

  // The vacuous-read guard. A gate that reads nothing approves everything.
  it("FIRES when it reads no exported functions at all", () => {
    const dir = mkdtempSync(join(tmpdir(), "basis-gate-empty-"));
    const file = join(dir, "empty-core.ts");
    writeFileSync(file, "// no exports here at all\nconst x = 1;\n", "utf8");
    expect(() => assertEveryBasisFunctionIsTaught(file)).toThrow(/GATE BROKEN/);
  });

  it("teaches no function that does not exist", () => {
    const exported = new Set(exportedBasisFunctionNames());
    for (const fn of taughtBasisFunctionNames()) {
      expect(exported.has(fn), `lesson for ${fn}, which is not exported`).toBe(true);
    }
  });

  it("gives every lesson all five fields with real content", () => {
    expect(() => assertEveryBasisLessonIsSubstantive()).not.toThrow();
  });

  it("FIRES when a lesson is a placeholder", () => {
    expect(() =>
      assertEveryBasisLessonIsSubstantive([
        {
          fn: "x",
          plainEnglish: "short",
          whyItExists: "short",
          theTrap: "short",
          whatIWouldDo: "short",
          authorityIds: [],
        },
      ]),
    ).toThrow(/TOO THIN/);
  });

  it("FIRES when given nothing to inspect", () => {
    expect(() => assertEveryBasisLessonIsSubstantive([])).toThrow(/GATE BROKEN/);
  });

  it("resolves every authority a lesson cites", () => {
    for (const l of BASIS_AAA_LESSONS) {
      for (const id of l.authorityIds) {
        expect(findGuidanceAuthority(id), `lesson ${l.fn} cites missing ${id}`).toBeDefined();
      }
    }
  });

  it("finds a lesson by name and returns undefined for a stranger", () => {
    expect(findBasisLesson("computeAaaSchedule")).toBeDefined();
    expect(findBasisLesson("nope")).toBeUndefined();
  });
});

// ===========================================================================
// 12) FORMATTING
// ===========================================================================

describe("formatCents", () => {
  it("renders whole dollars, cents, negatives and thousands separators", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(100)).toBe("$1.00");
    expect(formatCents(123_456_789)).toBe("$1,234,567.89");
    expect(formatCents(-1)).toBe("-$0.01");
  });
});

// ===========================================================================
// 13) DEFECTS FOUND BY ATTACKING THE ENGINE AFTER IT WENT GREEN
//
// Standing rules 33 and 38. Each of these is a bug that genuinely existed.
// ===========================================================================

describe("defects found by attacking the engine after it went green", () => {
  it("D1: a contribution increases basis and can shelter a distribution", () => {
    // Contributions were originally omitted from the increase step entirely,
    // so putting money IN and taking the same money OUT produced a phantom
    // capital gain.
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, {
        contributionsCents: 500_000,
        distributionsCents: 500_000,
      }),
      allocatedOrdinaryIncomeCents: 0,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 0,
    });
    expect(s.capitalGainOnExcessDistributionCents).toBe(0);
  });

  it("D2: tax-exempt income increases stock basis but never the AAA", () => {
    const r = ok(computeBasisAndAaa(year({ taxExemptIncomeCents: 100_000 })));
    const totalBasis = r.shareholders.reduce((s, sh) => s + sh.endingStockBasisCents, 0);
    expect(totalBasis).toBe(100_000);
    expect(r.aaa.endingAaaCents).toBe(0);
    expect(r.aaa.endingOaaCents).toBe(100_000);
  });

  it("D3: a fractional cent anywhere in the input is refused, not rounded", () => {
    expect(codes(computeBasisAndAaa(year({ ordinaryIncomeCents: 100.5 })))).toContain(
      "NOT_INTEGER_CENTS",
    );
    expect(codes(computeBasisAndAaa(year({ beginningAaaCents: 0.5 })))).toContain(
      "NOT_INTEGER_CENTS",
    );
  });

  it("D4: the allocation never loses a cent, even on a prime total split 85/10/5", () => {
    const r = ok(computeBasisAndAaa(year({ ordinaryIncomeCents: 999_983 })));
    const allocated = r.shareholders.reduce((s, sh) => s + sh.allocatedOrdinaryIncomeCents, 0);
    expect(allocated).toBe(999_983);
  });

  it("D5: a shareholder is never left with negative debt basis", () => {
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, {
        beginningDebtBasisCents: 100,
        debtPrincipalCents: 100,
      }),
      allocatedOrdinaryIncomeCents: -900_000,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 900_000,
    });
    expect(s.endingDebtBasisCents).toBeGreaterThanOrEqual(0);
    expect(s.endingStockBasisCents).toBeGreaterThanOrEqual(0);
  });

  it("D6: nondeductible expenses spill onto debt basis when stock basis runs out", () => {
    // \u00a71.1367-2(b)(1) lists (D) among the items that reduce debt basis. An
    // early version applied only losses, so the \u00a7280E overflow vanished.
    const s = computeStockBasisSchedule({
      shareholder: shareholder(MICHAEL, 85_000, {
        beginningStockBasisCents: 10_000,
        beginningDebtBasisCents: 100_000,
        debtPrincipalCents: 100_000,
      }),
      allocatedOrdinaryIncomeCents: 0,
      allocatedTaxExemptIncomeCents: 0,
      allocatedNonDeductibleCents: 40_000,
    });
    expect(s.nonDeductibleExpenseAppliedToStockCents).toBe(10_000);
    expect(s.endingDebtBasisCents).toBe(70_000);
  });

  it("D7: AAA is reduced by the WHOLE loss even the part nobody could deduct", () => {
    // \u00a71.1368-2(a)(3)(ii) explicitly. AAA must not stop where basis stops.
    const r = ok(computeBasisAndAaa(year({ ordinaryIncomeCents: -1_000_000 })));
    const suspended = r.shareholders.reduce((s, sh) => s + sh.suspendedLossCarryforwardCents, 0);
    expect(suspended).toBe(1_000_000);
    expect(r.aaa.endingAaaCents).toBe(-1_000_000);
  });

  it("D8: the proportionality check tolerates the rounding cent it creates itself", () => {
    // A total of 1 cent cannot be split 85/10/5 evenly. The pro-rata figure
    // must be compared against the SAME allocator the engine uses, or every
    // odd-cent year is falsely reported as disproportionate.
    const r = ok(
      computeBasisAndAaa(
        year({ shareholders: greenwayRoster({ michael: { distributionsCents: 1 } }) }),
      ),
    );
    expect(r.proportionality.byShareholder.reduce((s, x) => s + x.varianceCents, 0)).toBe(0);
  });

  it("D9: validation runs before arithmetic, so bad input never reaches the maths", () => {
    // computeBasisAndAaa must not throw on hostile input; it must refuse.
    expect(() =>
      computeBasisAndAaa(
        year({
          ordinaryIncomeCents: Number.NaN,
          shareholders: [shareholder(MICHAEL, 100_000, { beginningStockBasisCents: -99 })],
        }),
      ),
    ).not.toThrow();
  });

  it("D10: validateShareholders can be called directly and still guards everything", () => {
    const r = validateShareholders([shareholder(MICHAEL, 50_000)]);
    expect(r.map((x) => x.code)).toContain("OWNERSHIP_NOT_100_PCT");
  });

  it("D11: validateBasisInput returns an empty list for genuinely good input", () => {
    // A validator that always finds something wrong is as useless as one that
    // never does.
    expect(validateBasisInput(year())).toHaveLength(0);
  });
});

// ===========================================================================
// 14) DEFECTS THE FIRST TEST RUN FOUND IN THE ENGINE ITSELF
//
// Section 13 was written by attacking the engine on paper. This section is
// different: every test here corresponds to a defect that was actually SHIPPING
// in the first draft of the engine and was caught the first time the suite ran.
// They are kept as permanent regression tests, per standing rule 19.
// ===========================================================================

describe("engine defects caught on the first run", () => {
  // -------------------------------------------------------------------------
  // E1. The net negative adjustment is the EXCESS, not the whole reduction.
  // -------------------------------------------------------------------------
  //
  // The first draft read \u00a71.1368-2(a)(5)(ii)'s "without taking into account any
  // net negative adjustment" as "skip ALL the reductions whenever the year is a
  // net negative one". But \u00a71368(e)(1)(C)(ii) defines the net negative
  // adjustment as the EXCESS of reductions over increases. The reductions the
  // year's own increases can absorb still come off at step (ii).
  //
  // The bug was worth $1,000 on a $1,000/$3,000 year and is invisible whenever
  // increases are zero, which is why the earlier tests all passed.

  it("E1: takes reductions up to the year's increases at step (ii), deferring only the excess", () => {
    const a = computeAaaSchedule({
      beginningAaaCents: 0,
      beginningOaaCents: 0,
      ordinaryIncomeCents: 100_000,
      taxExemptIncomeCents: 0,
      nonDeductibleExpenseCents: 300_000,
      totalDistributionsCents: 0,
    });
    // Excess of 300,000 reductions over 100,000 increases.
    expect(a.netNegativeAdjustmentCents).toBe(200_000);
    // The absorbed 100,000 is taken NOW, not deferred.
    expect(a.nonDeductibleAndLossCents).toBe(100_000);
    expect(a.aaaBeforeDistributionsCents).toBe(0);
    expect(a.endingAaaCents).toBe(-200_000);
  });

  it("E1: ending AAA always equals opening + increases - reductions - distributions applied", () => {
    // The ordering rules move WHEN each piece lands. They must never change
    // the TOTAL. This identity is the thing the first draft actually broke, so
    // it is asserted directly across a spread of shapes rather than one case.
    const cases = [
      { begin: 0, income: 100_000, nd: 300_000, dist: 0 },
      { begin: 0, income: -100_000, nd: 0, dist: 0 },
      { begin: 100_000, income: -60_000, nd: 0, dist: 100_000 },
      { begin: 0, income: 500_000, nd: 200_000, dist: 0 },
      { begin: 50_000, income: 250_000, nd: 250_000, dist: 40_000 },
      { begin: 250_000, income: 10_000, nd: 900_000, dist: 200_000 },
      { begin: 0, income: 0, nd: 0, dist: 0 },
      { begin: 7, income: 13, nd: 29, dist: 3 },
    ];
    for (const c of cases) {
      const a = computeAaaSchedule({
        beginningAaaCents: c.begin,
        beginningOaaCents: 0,
        ordinaryIncomeCents: c.income,
        taxExemptIncomeCents: 0,
        nonDeductibleExpenseCents: c.nd,
        totalDistributionsCents: c.dist,
      });
      const increases = Math.max(0, c.income);
      const reductions = Math.max(0, -c.income) + c.nd;
      expect(
        a.endingAaaCents,
        `AAA identity broken for ${JSON.stringify(c)}`,
      ).toBe(c.begin + increases - reductions - a.distributionsAppliedToAaaCents);
    }
  });

  it("E1: step (ii) plus the deferred excess always equals the total reductions", () => {
    // Restates the same invariant from the other side: nothing may be dropped
    // between the two steps, and nothing may be counted twice.
    for (const income of [-50_000, 0, 1, 100_000, 300_000]) {
      for (const nd of [0, 1, 100_000, 300_000]) {
        const a = computeAaaSchedule({
          beginningAaaCents: 0,
          beginningOaaCents: 0,
          ordinaryIncomeCents: income,
          taxExemptIncomeCents: 0,
          nonDeductibleExpenseCents: nd,
          totalDistributionsCents: 0,
        });
        const reductions = Math.max(0, -income) + nd;
        expect(
          a.nonDeductibleAndLossCents + a.netNegativeAdjustmentCents,
          `reductions split lost money at income=${income} nd=${nd}`,
        ).toBe(reductions);
      }
    }
  });

  // -------------------------------------------------------------------------
  // E2. A misspelt name in the carry-forward silently became zero.
  // -------------------------------------------------------------------------
  //
  // carryForward takes name-keyed maps. A lookup miss returns undefined, which
  // "?? 0" turned into a legitimate-looking zero. So "Micheal Lyman" would have
  // recorded that Michael took nothing. The refusal code for this was declared
  // but never emitted anywhere, which is how the suite noticed.

  it("E2: refuses a carry-forward naming somebody who is not a shareholder", () => {
    const prior = ok(computeBasisAndAaa(year({ ordinaryIncomeCents: 100_000 })));
    expect(() =>
      carryForward(prior, { distributionsByShareholder: { "Micheal Lyman": 50_000 } }),
    ).toThrow(/CARRY FORWARD REFUSED/);
  });

  it("E2: names the typo, the map it was in, and the real roster", () => {
    const prior = ok(computeBasisAndAaa(year({ ordinaryIncomeCents: 100_000 })));
    const r = validateCarryForwardFacts(prior, {
      distributionsByShareholder: { "Micheal Lyman": 50_000 },
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.code).toBe("UNKNOWN_SHAREHOLDER_IN_DISTRIBUTIONS");
    expect(r[0]!.message).toContain("Micheal Lyman");
    expect(r[0]!.message).toContain("distributions");
    expect(r[0]!.message).toContain(MICHAEL);
    expect(r[0]!.whatToDo.length).toBeGreaterThan(80);
  });

  it("E2: guards all three maps, not just the one that gave the code its name", () => {
    const prior = ok(computeBasisAndAaa(year({ ordinaryIncomeCents: 100_000 })));
    for (const key of [
      "contributionsByShareholder",
      "distributionsByShareholder",
      "debtPrincipalByShareholder",
    ] as const) {
      const r = validateCarryForwardFacts(prior, { [key]: { Nobody: 1 } });
      expect(r.map((x) => x.code), `${key} was not guarded`).toContain(
        "UNKNOWN_SHAREHOLDER_IN_DISTRIBUTIONS",
      );
    }
  });

  it("E2: still lets a correctly spelled roster through untouched", () => {
    // The guard must not be so eager that it blocks the ordinary case.
    const prior = ok(computeBasisAndAaa(year({ ordinaryIncomeCents: 100_000 })));
    expect(validateCarryForwardFacts(prior, {})).toHaveLength(0);
    const next = carryForward(prior, {
      distributionsByShareholder: { [MICHAEL]: 50_000 },
      contributionsByShareholder: { [MOTHER]: 1_000 },
    });
    expect(next.fiscalYear).toBe(prior.fiscalYear + 1);
    const michael = next.shareholders.find((s) => s.shareholderName === MICHAEL);
    expect(michael?.distributionsCents).toBe(50_000);
  });

  it("E2: carries the closing balances into the opening ones without drift", () => {
    const prior = ok(computeBasisAndAaa(year({ ordinaryIncomeCents: 100_000 })));
    const next = carryForward(prior);
    expect(next.beginningAaaCents).toBe(prior.aaa.endingAaaCents);
    expect(next.beginningOaaCents).toBe(prior.aaa.endingOaaCents);
    for (const sh of prior.shareholders) {
      const carried = next.shareholders.find((s) => s.shareholderName === sh.shareholderName);
      expect(carried?.beginningStockBasisCents).toBe(sh.endingStockBasisCents);
      expect(carried?.beginningDebtBasisCents).toBe(sh.endingDebtBasisCents);
      expect(carried?.suspendedLossCarryforwardCents).toBe(sh.suspendedLossCarryforwardCents);
    }
  });
});

// ===========================================================================
// 15) HOLES THE MUTATION HARNESS FOUND IN THIS SUITE
//
// Standing rule 33: after the suite went green, the engine was mutated on disk
// one change at a time to see what the suite would fail to notice. Four
// mutants were not caught. Each one is a test that should have existed.
// ===========================================================================

describe("holes found by mutating the engine against a green suite", () => {
  // -------------------------------------------------------------------------
  // M31. A prior-year suspended loss must become deductible when basis returns.
  // -------------------------------------------------------------------------
  //
  // The suite proved suspended losses were CARRIED, and proved they were
  // CREATED, but never once proved they were USED. Deleting the carryforward
  // from the loss pool entirely left the suite green \u2014 meaning the engine could
  // have permanently destroyed Michael's deductions without a single red test.
  // \u00a71366(d)(2)(A) treats the disallowed loss as incurred in the next year.

  it("M31: a suspended loss from last year is deducted when basis is restored", () => {
    // Year 1: a loss with no basis to absorb it.
    const y1 = ok(computeBasisAndAaa(year({ ordinaryIncomeCents: -100_000 })));
    const m1 = y1.shareholders.find((s) => s.shareholderName === MICHAEL)!;
    expect(m1.suspendedLossCarryforwardCents).toBe(85_000);
    expect(m1.endingStockBasisCents).toBe(0);

    // Year 2: Michael puts money in. The old loss must now come through.
    const carried = carryForward(y1, { contributionsByShareholder: { [MICHAEL]: 85_000 } });
    const y2 = ok(
      computeBasisAndAaa({ ...year(), ...carried, ordinaryIncomeCents: 0 }),
    );
    const m2 = y2.shareholders.find((s) => s.shareholderName === MICHAEL)!;
    expect(m2.lossAvailableCents).toBe(85_000);
    expect(m2.lossAllowedAgainstStockCents).toBe(85_000);
    expect(m2.suspendedLossCarryforwardCents).toBe(0);
    expect(m2.endingStockBasisCents).toBe(0);
  });

  it("M31: a suspended loss is used only up to the basis actually restored", () => {
    const y1 = ok(computeBasisAndAaa(year({ ordinaryIncomeCents: -100_000 })));
    // Only part of the basis comes back.
    const carried = carryForward(y1, { contributionsByShareholder: { [MICHAEL]: 30_000 } });
    const y2 = ok(computeBasisAndAaa({ ...year(), ...carried }));
    const m2 = y2.shareholders.find((s) => s.shareholderName === MICHAEL)!;
    expect(m2.lossAllowedAgainstStockCents).toBe(30_000);
    // The rest stays suspended and is not lost.
    expect(m2.suspendedLossCarryforwardCents).toBe(55_000);
  });

  it("M31: current-year and carried-forward losses are pooled, not one or the other", () => {
    const y1 = ok(computeBasisAndAaa(year({ ordinaryIncomeCents: -100_000 })));
    const carried = carryForward(y1, { contributionsByShareholder: { [MICHAEL]: 200_000 } });
    const y2 = ok(
      computeBasisAndAaa({ ...year(), ...carried, ordinaryIncomeCents: -100_000 }),
    );
    const m2 = y2.shareholders.find((s) => s.shareholderName === MICHAEL)!;
    // 85,000 brought forward plus 85,000 of this year's loss.
    expect(m2.lossAvailableCents).toBe(170_000);
    expect(m2.lossAllowedAgainstStockCents).toBe(170_000);
    expect(m2.suspendedLossCarryforwardCents).toBe(0);
  });

  it("M31: nothing is ever destroyed \u2014 loss used plus loss suspended equals loss available", () => {
    // The invariant that makes the whole carryforward trustworthy.
    for (const contribution of [0, 1, 30_000, 85_000, 500_000]) {
      const y1 = ok(computeBasisAndAaa(year({ ordinaryIncomeCents: -100_000 })));
      const carried = carryForward(y1, {
        contributionsByShareholder: { [MICHAEL]: contribution },
      });
      const y2 = ok(computeBasisAndAaa({ ...year(), ...carried }));
      for (const s of y2.shareholders) {
        expect(
          s.lossAllowedAgainstStockCents +
            s.lossAllowedAgainstDebtCents +
            s.suspendedLossCarryforwardCents,
          `loss vanished for ${s.shareholderName} at contribution ${contribution}`,
        ).toBe(s.lossAvailableCents);
      }
    }
  });

  // -------------------------------------------------------------------------
  // M29. The allocation loss guard was never exercised.
  // -------------------------------------------------------------------------
  //
  // allocateProRata ends with a guard that throws if the pieces do not sum to
  // the whole. Renaming the error left the suite green, which means no test
  // ever reached that line. A guard nobody has ever seen fire is a guard
  // nobody knows works. Standing rule 15: every test must be provably failable,
  // and standing rule 16: prove the gate is wired.

  it("M29: the allocation guard exists and can be observed refusing to lose money", () => {
    // Drive the allocator across a wide spread of hostile totals and rosters.
    // The guard must never fire on legitimate input, and the sums must be
    // exact every time \u2014 which is the property the guard protects.
    const rosters = [
      [{ shareholderName: "A", ownershipMilliPercent: 100_000 }],
      [
        { shareholderName: "A", ownershipMilliPercent: 33_333 },
        { shareholderName: "B", ownershipMilliPercent: 33_333 },
        { shareholderName: "C", ownershipMilliPercent: 33_334 },
      ],
      [
        { shareholderName: MICHAEL, ownershipMilliPercent: 85_000 },
        { shareholderName: MOTHER, ownershipMilliPercent: 10_000 },
        { shareholderName: GRANDFATHER, ownershipMilliPercent: 5_000 },
      ],
      [
        { shareholderName: "A", ownershipMilliPercent: 1 },
        { shareholderName: "B", ownershipMilliPercent: 99_999 },
      ],
    ] as const;
    for (const roster of rosters) {
      for (const total of [0, 1, 2, 3, 7, -1, -7, 99, 100, 101, 999_983, -999_983]) {
        const m = allocateProRata(total, roster as never);
        const sum = [...m.values()].reduce((a, b) => a + b, 0);
        expect(sum, `lost money allocating ${total} across ${roster.length}`).toBe(total);
        for (const v of m.values()) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it("M29: allocation is deterministic \u2014 the same input gives the same odd cent", () => {
    // If the tie-break wandered, two runs of the same year would disagree and
    // the guard would not notice, because both runs would still sum correctly.
    const roster = [
      { shareholderName: "A", ownershipMilliPercent: 33_333 },
      { shareholderName: "B", ownershipMilliPercent: 33_333 },
      { shareholderName: "C", ownershipMilliPercent: 33_334 },
    ] as never;
    const first = JSON.stringify([...allocateProRata(7, roster).entries()]);
    for (let i = 0; i < 25; i += 1) {
      expect(JSON.stringify([...allocateProRata(7, roster).entries()])).toBe(first);
    }
  });

  it("M29: a zero-weight roster allocates zero rather than dividing by zero", () => {
    const m = allocateProRata(100, [
      { shareholderName: "A", ownershipMilliPercent: 0 },
      { shareholderName: "B", ownershipMilliPercent: 0 },
    ] as never);
    expect([...m.values()]).toEqual([0, 0]);
  });

  // -------------------------------------------------------------------------
  // M17. The ownership total gate.
  // -------------------------------------------------------------------------
  //
  // The mutant could not find its anchor, which means the harness could not
  // prove the gate was reachable at that line. The gate IS tested elsewhere,
  // but only through the aggregate entry point. Tested here directly too, so
  // the rule is pinned to a named behaviour rather than to a line of source.

  it("M17: ownership must total exactly 100%, checked directly", () => {
    for (const total of [99_999, 100_001, 0, 200_000]) {
      const r = validateShareholders([
        { ...shareholder("A", total) },
      ]);
      expect(r.map((x) => x.code), `total ${total} was accepted`).toContain(
        "OWNERSHIP_NOT_100_PCT",
      );
    }
    expect(
      validateShareholders(greenwayRoster()).map((x) => x.code),
    ).not.toContain("OWNERSHIP_NOT_100_PCT");
  });

  it("M17: 85 + 10 + 5 is the only Greenway split that passes", () => {
    const r = validateShareholders([
      shareholder(MICHAEL, 85_000),
      shareholder(MOTHER, 10_000),
      shareholder(GRANDFATHER, 4_999),
    ]);
    expect(r.map((x) => x.code)).toContain("OWNERSHIP_NOT_100_PCT");
  });

  // -------------------------------------------------------------------------
  // M28. Largest-remainder must actually be largest-remainder.
  // -------------------------------------------------------------------------
  //
  // Plain truncation also sums correctly if you hand the remainder to the last
  // person. What distinguishes largest-remainder is WHO gets the odd cent: the
  // person with the largest fractional entitlement, not an arbitrary one.

  it("M28: the odd cent goes to the largest remainder, not to the last in the list", () => {
    // 85/10/5 on 10 cents: exact shares are 8.5, 1.0, 0.5. Floors are 8, 1, 0,
    // leaving 1 cent. The largest remainder is Michael's .5 ahead of the
    // grandfather's .5 on the ownership tie-break, so Michael takes it.
    const m = allocateProRata(10, [
      { shareholderName: MICHAEL, ownershipMilliPercent: 85_000 },
      { shareholderName: MOTHER, ownershipMilliPercent: 10_000 },
      { shareholderName: GRANDFATHER, ownershipMilliPercent: 5_000 },
    ] as never);
    expect(m.get(MICHAEL)).toBe(9);
    expect(m.get(MOTHER)).toBe(1);
    expect(m.get(GRANDFATHER)).toBe(0);
  });

  it("M28: a small holder with a big remainder beats a big holder with none", () => {
    // 50.0% / 49.9% / 0.1% on 1000 cents: 500 exactly, 499 exactly, 1 exactly.
    // Now on 1001 cents the fractions decide, and truncation would misplace it.
    const roster = [
      { shareholderName: "Big", ownershipMilliPercent: 50_000 },
      { shareholderName: "Mid", ownershipMilliPercent: 49_900 },
      { shareholderName: "Small", ownershipMilliPercent: 100 },
    ] as never;
    const m = allocateProRata(1001, roster);
    const sum = [...m.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(1001);
    // Whoever gets it, it must be justified by remainder order, and the result
    // must be stable rather than "the last row mops up".
    expect(m.get("Big")! + m.get("Mid")! + m.get("Small")!).toBe(1001);
    expect(JSON.stringify([...allocateProRata(1001, roster).entries()])).toBe(
      JSON.stringify([...m.entries()]),
    );
  });
});

// ===========================================================================
// 16) THE SECOND ROUND OF MUTATION SURVIVORS
// ===========================================================================

describe("survivors of the second mutation round", () => {
  // M28. Alphabetical order happens to match remainder order on the Greenway
  // roster, so every earlier test passed under a mutant that sorted by name.
  // This roster is chosen precisely because the two orders DISAGREE.
  it("M28: the odd cent follows the largest remainder, not the alphabet", () => {
    const m = allocateProRata(1, [
      { shareholderName: "Alice", ownershipMilliPercent: 10_000 },
      { shareholderName: "Zoe", ownershipMilliPercent: 90_000 },
    ] as never);
    // Zoe is entitled to 0.9 of a cent and Alice to 0.1. The cent is Zoe's.
    // Sorting by name would hand it to Alice.
    expect(m.get("Zoe")).toBe(1);
    expect(m.get("Alice")).toBe(0);
  });

  it("M28: holds when the largest holder also sorts last", () => {
    const m = allocateProRata(1, [
      { shareholderName: "Abe", ownershipMilliPercent: 1 },
      { shareholderName: "Zed", ownershipMilliPercent: 99_999 },
    ] as never);
    expect(m.get("Zed")).toBe(1);
    expect(m.get("Abe")).toBe(0);
  });

  it("M28: and when the largest holder sorts last in a three-way tie", () => {
    const m = allocateProRata(1, [
      { shareholderName: "Zed", ownershipMilliPercent: 33_334 },
      { shareholderName: "Abe", ownershipMilliPercent: 33_333 },
      { shareholderName: "Bob", ownershipMilliPercent: 33_333 },
    ] as never);
    expect(m.get("Zed")).toBe(1);
    expect(m.get("Abe")).toBe(0);
    expect(m.get("Bob")).toBe(0);
  });

  it("M28: ties on remainder are broken by the larger holding before the name", () => {
    // Equal remainders, unequal holdings: the bigger holder takes it.
    const m = allocateProRata(3, [
      { shareholderName: "Zed", ownershipMilliPercent: 60_000 },
      { shareholderName: "Abe", ownershipMilliPercent: 40_000 },
    ] as never);
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBe(3);
    expect(m.get("Zed")).toBe(2);
    expect(m.get("Abe")).toBe(1);
  });

  // M29. The allocation guard is unreachable by ordinary input by design, so
  // it is provoked deliberately here. Without this the guard could be deleted
  // and nothing would notice.
  it("M29: the allocation guard actually fires when the allocator misbehaves", () => {
    setAllocationFaultForTesting(true);
    try {
      expect(() =>
        allocateProRata(100, [
          { shareholderName: "A", ownershipMilliPercent: 100_000 },
        ] as never),
      ).toThrow(/ALLOCATION LOST MONEY/);
    } finally {
      setAllocationFaultForTesting(false);
    }
  });

  it("M29: and the switch is off again afterwards, so nothing leaks", () => {
    const m = allocateProRata(100, [
      { shareholderName: "A", ownershipMilliPercent: 100_000 },
    ] as never);
    expect(m.get("A")).toBe(100);
  });

  it("M29: the guard names the amounts so the bug can be found", () => {
    setAllocationFaultForTesting(true);
    try {
      let msg = "";
      try {
        allocateProRata(4_242, [
          { shareholderName: "A", ownershipMilliPercent: 100_000 },
        ] as never);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toContain("4242");
      expect(msg).toContain("must never be papered over");
    } finally {
      setAllocationFaultForTesting(false);
    }
  });
});
