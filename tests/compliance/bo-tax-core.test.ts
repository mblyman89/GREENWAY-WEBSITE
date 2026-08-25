/**
 * bo-tax-core.test.ts — the three sales-side taxes, proved against a real
 * filed return.
 *
 * Michael's instruction: "we need to account for sales tax by all three types,
 * state/ local/ b&o. its important that the books account for b&o as it is an
 * expense and not a liability."
 *
 * The corpus is his own July 2026 Combined Excise Tax Return, confirmation
 * # 0-053-958-352, mirrored verbatim at
 * `docs/authorities/state-wa/dor-combined-excise-return-july-2026.txt`.
 *
 * These tests are deliberately hostile to the two failures that would actually
 * hurt him:
 *   1. storing the B&O rate in basis points, which silently misstates a filed
 *      government return by $1.68 a month, forever;
 *   2. booking B&O the way sales tax is booked — liability only — which
 *      overstates his profit by the full B&O every single month.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ALL_BO_CLASSIFICATIONS,
  ALL_BO_REFUSAL_CODES,
  BO_REFUSAL,
  ALL_WA_SALES_TAX_TYPES,
  ACCOUNT_BO_EXPENSE,
  ACCOUNT_BO_PAYABLE,
  ACCOUNT_SALES_TAX_PAYABLE,
  BO_CLASSIFICATION_ENTITY,
  BO_CLASSIFICATION_LABELS,
  DEFAULT_BO_RATES,
  JULY_2026_RETURN_AS_FILED,
  RATE_MILLIONTHS_SCALE,
  __runBoTaxCoreTests,
  applyRateMillionths,
  boAccrualEntry,
  boLine,
  boPaymentEntry,
  bpsToMillionths,
  entryBalances,
  recognisesBoExpense,
  threeTypeBreakdown,
} from "@/lib/accounting/bo-tax-core";

const REPO_ROOT = process.cwd();
const RETURN_PATH = join(
  REPO_ROOT,
  "docs/authorities/state-wa/dor-combined-excise-return-july-2026.txt",
);

function filedReturnText(): string {
  return readFileSync(RETURN_PATH, "utf8");
}

describe("bo-tax-core embedded self-tests", () => {
  it("passes its own suite", () => {
    expect(() => {
      __runBoTaxCoreTests();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// THE FILED RETURN IS REALLY THERE, AND REALLY SAYS THIS
// ---------------------------------------------------------------------------

describe("the filed July 2026 return is the corpus (rule 115)", () => {
  it("the mirrored return exists and is his", () => {
    const t = filedReturnText();
    expect(t).toContain("Combined Excise Tax Return");
    expect(t).toContain("GREENWAY");
    expect(t).toContain("603-353-555");
    expect(t).toContain("Filing Period: July 31, 2026");
    expect(t).toContain("Prepared By: Michael Lyman");
  });

  it("the confirmation number pins it to one specific filing", () => {
    expect(filedReturnText()).toContain(`Confirmation #: ${JULY_2026_RETURN_AS_FILED.confirmation}`);
  });

  it("the return states the two B&O rates verbatim", () => {
    const t = filedReturnText();
    // These are the rates Michael gave, and they must appear on the paper.
    expect(t).toContain("0.004710");
    expect(t).toContain("0.015000");
    expect(t).toContain("Retailing");
    expect(t).toContain("Service and Other Activities (Less Than");
    expect(t).toContain("$1,000,000 in the Prior Year)");
  });

  it("the return states the state and local rates verbatim", () => {
    const t = filedReturnText();
    expect(t).toContain("0.065000");
    expect(t).toContain("0.028000");
    expect(t).toContain("1802 - PORT ORCHARD");
  });

  it("every figure in the fixture appears on the filed return", () => {
    const t = filedReturnText();
    // If a fixture figure is not on the paper, it is invented. Rule 115.
    const mustAppear = [
      "168,465.17", // retail base
      "4,355.00", // ATM surcharge
      "793.47", // B&O retailing
      "65.33", // B&O service
      "858.80", // B&O total
      "10,950.24", // state
      "4,717.02", // local
      "16,526.06", // grand total
    ];
    for (const fig of mustAppear) {
      expect(t, `${fig} must be on the filed return`).toContain(fig);
    }
  });

  it("the mirror records that it was reconciled before being trusted", () => {
    const t = filedReturnText();
    expect(t).toContain("RECONCILIATION PERFORMED BEFORE ANY FIGURE WAS USED");
    expect(t).toContain("authoritative");
  });
});

// ---------------------------------------------------------------------------
// EVERY LINE OF THE RETURN, RECOMPUTED
// ---------------------------------------------------------------------------

describe("every line of the filed return recomputes exactly", () => {
  const F = JULY_2026_RETURN_AS_FILED;

  it("B&O Retailing: 168,465.17 x 0.004710 = 793.47", () => {
    const l = boLine({
      classification: "retailing",
      grossCents: F.retailBaseCents,
      rates: DEFAULT_BO_RATES,
    });
    expect(l.taxCents).toBe(F.boRetailingTaxCents);
    expect(l.taxCents).toBe(79_347);
  });

  it("B&O Service and Other: 4,355.00 x 0.015000 = 65.33", () => {
    const l = boLine({
      classification: "service_and_other",
      grossCents: F.atmSurchargeCents,
      rates: DEFAULT_BO_RATES,
    });
    expect(l.taxCents).toBe(F.boServiceTaxCents);
    expect(l.taxCents).toBe(6_533);
  });

  it("B&O total is 858.80", () => {
    const b = threeTypeBreakdown({
      retailBaseCents: F.retailBaseCents,
      atmSurchargeCents: F.atmSurchargeCents,
      stateSalesRateBps: 650,
      localSalesRateBps: 280,
      boRates: DEFAULT_BO_RATES,
    });
    expect(b.boTaxCents).toBe(85_880);
    expect(b.boTaxCents).toBe(F.boTotalTaxCents);
  });

  it("State retail sales: 168,465.17 x 0.065 = 10,950.24", () => {
    expect(applyRateMillionths(F.retailBaseCents, bpsToMillionths(650))).toBe(1_095_024);
  });

  it("Local Port Orchard: 168,465.17 x 0.028 = 4,717.02", () => {
    expect(applyRateMillionths(F.retailBaseCents, bpsToMillionths(280))).toBe(471_702);
  });

  it("the grand total is 16,526.06, all three types together", () => {
    const b = threeTypeBreakdown({
      retailBaseCents: F.retailBaseCents,
      atmSurchargeCents: F.atmSurchargeCents,
      stateSalesRateBps: 650,
      localSalesRateBps: 280,
      boRates: DEFAULT_BO_RATES,
    });
    expect(b.totalTaxCents).toBe(1_652_606);
    expect(b.totalTaxCents).toBe(F.totalTaxCents);
    // and it really is the sum of the parts, not a coincidence
    expect(b.stateSalesTaxCents + b.localSalesTaxCents + b.boTaxCents).toBe(F.totalTaxCents);
  });
});

// ---------------------------------------------------------------------------
// THE UNIT — RULE 114
// ---------------------------------------------------------------------------

describe("basis points cannot hold the B&O retailing rate (rule 114)", () => {
  it("47.10 basis points is not an integer, and bps refuses it", () => {
    expect(() => bpsToMillionths(47.1)).toThrow();
  });

  it("the rate stored in millionths is exact", () => {
    expect(DEFAULT_BO_RATES.retailing).toBe(4710);
    expect(DEFAULT_BO_RATES.retailing / RATE_MILLIONTHS_SCALE).toBeCloseTo(0.00471, 10);
  });

  it("rounding the rate to 47 bps understates his filed return by $1.68", () => {
    const F = JULY_2026_RETURN_AS_FILED;
    const wrong = applyRateMillionths(F.retailBaseCents, bpsToMillionths(47));
    expect(wrong).toBe(79_179);
    expect(F.boRetailingTaxCents - wrong).toBe(168);
  });

  it("rounding the rate to 48 bps overstates his filed return by $15.16", () => {
    const F = JULY_2026_RETURN_AS_FILED;
    const wrong = applyRateMillionths(F.retailBaseCents, bpsToMillionths(48));
    expect(wrong).toBe(80_863);
    expect(wrong - F.boRetailingTaxCents).toBe(1516);
  });

  it("the state and local rates convert from bps without moving", () => {
    // Nothing that already worked may change its answer.
    expect(bpsToMillionths(650)).toBe(65_000);
    expect(bpsToMillionths(280)).toBe(28_000);
    const F = JULY_2026_RETURN_AS_FILED;
    expect(applyRateMillionths(F.retailBaseCents, 65_000)).toBe(F.stateSalesTaxCents);
    expect(applyRateMillionths(F.retailBaseCents, 28_000)).toBe(F.localSalesTaxCents);
  });

  it("every B&O rate is an exact integer in millionths", () => {
    for (const c of ALL_BO_CLASSIFICATIONS) {
      expect(Number.isInteger(DEFAULT_BO_RATES[c]), `${c}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// THREE TYPES, TOLD APART — HIS ACTUAL REQUEST
// ---------------------------------------------------------------------------

describe("the three types are accounted for separately (his request)", () => {
  it("there are exactly three types, named as he named them", () => {
    expect(ALL_WA_SALES_TAX_TYPES).toEqual(["state_sales", "local_sales", "bo"]);
  });

  it("state, local and B&O come out as three different numbers", () => {
    const F = JULY_2026_RETURN_AS_FILED;
    const b = threeTypeBreakdown({
      retailBaseCents: F.retailBaseCents,
      atmSurchargeCents: F.atmSurchargeCents,
      stateSalesRateBps: 650,
      localSalesRateBps: 280,
      boRates: DEFAULT_BO_RATES,
    });
    const set = new Set([b.stateSalesTaxCents, b.localSalesTaxCents, b.boTaxCents]);
    expect(set.size).toBe(3);
  });

  it("the trust total excludes B&O — B&O is not trust money", () => {
    const F = JULY_2026_RETURN_AS_FILED;
    const b = threeTypeBreakdown({
      retailBaseCents: F.retailBaseCents,
      atmSurchargeCents: F.atmSurchargeCents,
      stateSalesRateBps: 650,
      localSalesRateBps: 280,
      boRates: DEFAULT_BO_RATES,
    });
    expect(b.trustTaxCents).toBe(F.stateSalesTaxCents + F.localSalesTaxCents);
    expect(b.trustTaxCents).not.toBe(b.totalTaxCents);
    expect(b.totalTaxCents - b.trustTaxCents).toBe(b.boTaxCents);
  });
});

// ---------------------------------------------------------------------------
// THE ATM — HIS ANSWER, BUILT TO
// ---------------------------------------------------------------------------

describe("the ATM surcharge is its own classification at its own rate", () => {
  it("the surcharge is taxed at 1.5%, not at the retail rate", () => {
    const F = JULY_2026_RETURN_AS_FILED;
    const correct = applyRateMillionths(F.atmSurchargeCents, DEFAULT_BO_RATES.service_and_other);
    const ifRetail = applyRateMillionths(F.atmSurchargeCents, DEFAULT_BO_RATES.retailing);
    expect(correct).toBe(F.boServiceTaxCents);
    expect(ifRetail).not.toBe(correct);
  });

  it("the service rate is more than three times the retailing rate", () => {
    // So confusing the two is not a rounding matter, it is a real misstatement.
    expect(DEFAULT_BO_RATES.service_and_other).toBeGreaterThan(
      DEFAULT_BO_RATES.retailing * 3,
    );
  });

  it("the surcharge belongs to the ATM entity, retail to Greenway", () => {
    expect(BO_CLASSIFICATION_ENTITY.service_and_other).toBe("atm");
    expect(BO_CLASSIFICATION_ENTITY.retailing).toBe("greenway");
  });

  it("a month with no surcharge produces no ATM line", () => {
    const b = threeTypeBreakdown({
      retailBaseCents: 5_000_00,
      atmSurchargeCents: 0,
      stateSalesRateBps: 650,
      localSalesRateBps: 280,
      boRates: DEFAULT_BO_RATES,
    });
    expect(b.boLines).toHaveLength(1);
    expect(b.boLines[0]?.classification).toBe("retailing");
  });

  it("the DOR label for the service line matches the paper exactly", () => {
    expect(filedReturnText()).toContain(
      BO_CLASSIFICATION_LABELS.service_and_other.split(" (Less Than")[0],
    );
    // and the threshold wording is on the return too
    expect(BO_CLASSIFICATION_LABELS.service_and_other).toContain(
      "Less Than $1,000,000 in the Prior Year",
    );
  });
});

// ---------------------------------------------------------------------------
// "AN EXPENSE AND NOT A LIABILITY" — THE HEART OF IT
// ---------------------------------------------------------------------------

describe("B&O books as an expense, unlike sales tax (his instruction)", () => {
  const entry = () => boAccrualEntry({ boTaxCents: 85_880, periodLabel: "July 2026" });

  it("the accrual debits the B&O EXPENSE account 75040", () => {
    expect(recognisesBoExpense(entry())).toBe(true);
    const e = entry().find((l) => l.accountCode === ACCOUNT_BO_EXPENSE);
    expect(e?.debitCents).toBe(85_880);
  });

  it("the accrual balances", () => {
    expect(entryBalances(entry())).toBe(true);
  });

  it("B&O never touches the trust sales-tax liability", () => {
    expect(entry().some((l) => l.accountCode === ACCOUNT_SALES_TAX_PAYABLE)).toBe(false);
  });

  it("a liability-only entry is detected as missing the expense", () => {
    // This is the "tidy simplification" that would overstate his profit by the
    // full B&O every month. It balances, so only an expense check catches it.
    const wrong = [
      { accountCode: ACCOUNT_BO_PAYABLE, debitCents: 0, creditCents: 85_880, memo: "" },
      { accountCode: "10100", debitCents: 85_880, creditCents: 0, memo: "" },
    ];
    expect(entryBalances(wrong)).toBe(true); // it LOOKS fine
    expect(recognisesBoExpense(wrong)).toBe(false); // but it is not
  });

  it("paying the tax does not expense it a second time", () => {
    const p = boPaymentEntry({
      boTaxCents: 85_880,
      periodLabel: "July 2026",
      bankAccountCode: "10100",
    });
    expect(recognisesBoExpense(p)).toBe(false);
    expect(entryBalances(p)).toBe(true);
  });

  it("accrue then pay: the liability nets to zero, the expense stays once", () => {
    const all = [
      ...boAccrualEntry({ boTaxCents: 85_880, periodLabel: "July 2026" }),
      ...boPaymentEntry({
        boTaxCents: 85_880,
        periodLabel: "July 2026",
        bankAccountCode: "10100",
      }),
    ];
    const payable = all
      .filter((l) => l.accountCode === ACCOUNT_BO_PAYABLE)
      .reduce((s, l) => s + l.creditCents - l.debitCents, 0);
    const expense = all
      .filter((l) => l.accountCode === ACCOUNT_BO_EXPENSE)
      .reduce((s, l) => s + l.debitCents - l.creditCents, 0);
    expect(payable).toBe(0);
    expect(expense).toBe(85_880);
  });

  it("the memo explains WHY it is an expense, in his language", () => {
    const e = boAccrualEntry({ boTaxCents: 85_880, periodLabel: "July 2026" });
    const memo = e.find((l) => l.accountCode === ACCOUNT_BO_EXPENSE)?.memo ?? "";
    expect(memo).toContain("ON Greenway");
    expect(memo).toContain("trust money");
  });

  it("the accounts used are the ones the chart of accounts already defined", () => {
    // Rule 25: extend, never duplicate. 0173 created these in the first place.
    const coa = readFileSync(
      join(REPO_ROOT, "supabase/migrations/0173_chart_of_accounts.sql"),
      "utf8",
    );
    expect(coa).toContain(`'${ACCOUNT_BO_EXPENSE}'`);
    expect(coa).toContain(`'${ACCOUNT_BO_PAYABLE}'`);
    expect(coa).toContain("B&O Tax Expense");
    expect(coa).toContain("B&O Tax Payable");
  });

  it("the chart of accounts agrees that B&O has an expense side", () => {
    const coa = readFileSync(
      join(REPO_ROOT, "supabase/migrations/0173_chart_of_accounts.sql"),
      "utf8",
    );
    // 0173's own words, which are exactly Michael's point.
    expect(coa).toContain("so it has an expense side");
  });
});

// ---------------------------------------------------------------------------
// REFUSALS — RULE 48, LOUD FAILURE NOT SILENT SKIP
// ---------------------------------------------------------------------------

describe("the engine refuses rather than inventing a figure", () => {
  // Each assertion pins a UNIQUE refusal code, never prose.
  //
  // This section was rewritten after the books-59 mutation campaign found a
  // real escape (M10). The original test asserted `.toThrow(/negative/i)` for
  // negative gross receipts. When the mutation disabled that guard, the suite
  // stayed GREEN — because with gross -100 and deductions 0, the
  // deductions-exceed-gross guard (0 > -100) fired instead, and its message
  // contains the word "negative". The test passed for the wrong reason and
  // would have kept passing with the guard deleted.
  //
  // Matching on prose is matching on a coincidence. A code cannot be satisfied
  // by accident, and rewording a message can no longer decouple a test from
  // the guard it thinks it is testing.

  it("negative gross receipts are refused BY THE GROSS GUARD specifically", () => {
    expect(() =>
      boLine({
        classification: "retailing",
        grossCents: -100,
        deductionsCents: 0,
        rates: DEFAULT_BO_RATES,
      }),
    ).toThrow(`[${BO_REFUSAL.GROSS_NEGATIVE}]`);
  });

  it("fractional cents are refused", () => {
    expect(() =>
      boLine({ classification: "retailing", grossCents: 10.5, rates: DEFAULT_BO_RATES }),
    ).toThrow(`[${BO_REFUSAL.GROSS_NOT_INTEGER}]`);
  });

  it("deductions above gross are refused", () => {
    expect(() =>
      boLine({
        classification: "retailing",
        grossCents: 100,
        deductionsCents: 500,
        rates: DEFAULT_BO_RATES,
      }),
    ).toThrow(`[${BO_REFUSAL.DEDUCTIONS_EXCEED_GROSS}]`);
  });

  it("negative deductions are refused by their own guard", () => {
    expect(() =>
      boLine({
        classification: "retailing",
        grossCents: 100,
        deductionsCents: -5,
        rates: DEFAULT_BO_RATES,
      }),
    ).toThrow(`[${BO_REFUSAL.DEDUCTIONS_NEGATIVE}]`);
  });

  it("a negative rate is refused", () => {
    expect(() => applyRateMillionths(1000, -1)).toThrow(`[${BO_REFUSAL.RATE_NEGATIVE}]`);
  });

  it("a fractional rate is refused", () => {
    expect(() => applyRateMillionths(1000, 1.5)).toThrow(`[${BO_REFUSAL.RATE_NOT_INTEGER}]`);
  });

  it("a fractional base is refused", () => {
    expect(() => applyRateMillionths(1.5, 4710)).toThrow(`[${BO_REFUSAL.BASE_NOT_INTEGER}]`);
  });

  it("a non-integer bps value is refused", () => {
    expect(() => bpsToMillionths(47.1)).toThrow(`[${BO_REFUSAL.BPS_NOT_INTEGER}]`);
  });

  it("a zero accrual is refused rather than posting an empty entry", () => {
    expect(() => boAccrualEntry({ boTaxCents: 0, periodLabel: "x" })).toThrow(
      `[${BO_REFUSAL.ACCRUAL_NOT_POSITIVE}]`,
    );
  });

  it("a zero payment is refused", () => {
    expect(() =>
      boPaymentEntry({ boTaxCents: 0, periodLabel: "x", bankAccountCode: "10100" }),
    ).toThrow(`[${BO_REFUSAL.PAYMENT_NOT_POSITIVE}]`);
  });

  it("an unsafe-integer product is refused, not approximated (rule 40)", () => {
    expect(() => applyRateMillionths(Number.MAX_SAFE_INTEGER, 4710)).toThrow(
      `[${BO_REFUSAL.PRODUCT_UNSAFE}]`,
    );
  });

  it("every guard has a distinct code, so no guard can hide behind another", () => {
    expect(new Set(ALL_BO_REFUSAL_CODES).size).toBe(ALL_BO_REFUSAL_CODES.length);
    expect(ALL_BO_REFUSAL_CODES.length).toBe(14);
  });

  it("every refusal code is actually carried in a thrown message", () => {
    // Rule 39: a code that no guard emits is decoration. Walk the ones that
    // are reachable from this module's public surface and prove each appears.
    const reachable: ReadonlyArray<readonly [string, () => unknown]> = [
      [BO_REFUSAL.BASE_NOT_INTEGER, () => applyRateMillionths(1.5, 100)],
      [BO_REFUSAL.RATE_NOT_INTEGER, () => applyRateMillionths(100, 1.5)],
      [BO_REFUSAL.RATE_NEGATIVE, () => applyRateMillionths(100, -1)],
      [BO_REFUSAL.PRODUCT_UNSAFE, () => applyRateMillionths(Number.MAX_SAFE_INTEGER, 4710)],
      [
        BO_REFUSAL.GROSS_NOT_INTEGER,
        () => boLine({ classification: "retailing", grossCents: 1.5, rates: DEFAULT_BO_RATES }),
      ],
      [
        BO_REFUSAL.DEDUCTIONS_NOT_INTEGER,
        () =>
          boLine({
            classification: "retailing",
            grossCents: 100,
            deductionsCents: 1.5,
            rates: DEFAULT_BO_RATES,
          }),
      ],
      [
        BO_REFUSAL.GROSS_NEGATIVE,
        () => boLine({ classification: "retailing", grossCents: -1, rates: DEFAULT_BO_RATES }),
      ],
      [
        BO_REFUSAL.DEDUCTIONS_NEGATIVE,
        () =>
          boLine({
            classification: "retailing",
            grossCents: 100,
            deductionsCents: -1,
            rates: DEFAULT_BO_RATES,
          }),
      ],
      [
        BO_REFUSAL.DEDUCTIONS_EXCEED_GROSS,
        () =>
          boLine({
            classification: "retailing",
            grossCents: 100,
            deductionsCents: 200,
            rates: DEFAULT_BO_RATES,
          }),
      ],
      [BO_REFUSAL.ACCRUAL_NOT_INTEGER, () => boAccrualEntry({ boTaxCents: 1.5, periodLabel: "x" })],
      [BO_REFUSAL.ACCRUAL_NOT_POSITIVE, () => boAccrualEntry({ boTaxCents: 0, periodLabel: "x" })],
      [
        BO_REFUSAL.PAYMENT_NOT_POSITIVE,
        () => boPaymentEntry({ boTaxCents: 0, periodLabel: "x", bankAccountCode: "10100" }),
      ],
      [BO_REFUSAL.BPS_NOT_INTEGER, () => bpsToMillionths(1.5)],
    ];
    for (const [code, fn] of reachable) {
      let msg = "";
      try {
        fn();
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
      }
      expect(msg, `code ${code} must appear in its own guard's message`).toContain(`[${code}]`);
    }
    // NO_RATE_FOR_CLASSIFICATION is only reachable with a deliberately
    // incomplete rate table, which TypeScript forbids at the type level. It is
    // a runtime backstop for JS callers, so it is exercised via a cast rather
    // than pretended to be unreachable.
    let msg = "";
    try {
      boLine({
        classification: "retailing",
        grossCents: 100,
        rates: {} as unknown as typeof DEFAULT_BO_RATES,
      });
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toContain(`[${BO_REFUSAL.NO_RATE_FOR_CLASSIFICATION}]`);
  });
});

// ---------------------------------------------------------------------------
// VOCABULARY WALK — RULE 43
// ---------------------------------------------------------------------------

describe("the vocabulary is complete for every classification (rule 43)", () => {
  for (const c of ALL_BO_CLASSIFICATIONS) {
    it(`${c} has a rate, a DOR label and an owning entity`, () => {
      expect(DEFAULT_BO_RATES[c]).toBeGreaterThan(0);
      expect(Number.isInteger(DEFAULT_BO_RATES[c])).toBe(true);
      expect(BO_CLASSIFICATION_LABELS[c].length).toBeGreaterThan(0);
      expect(BO_CLASSIFICATION_ENTITY[c].length).toBeGreaterThan(0);
    });

    it(`${c} computes a plausible tax on a real-sized base`, () => {
      const l = boLine({ classification: c, grossCents: 10_000_00, rates: DEFAULT_BO_RATES });
      expect(l.taxCents).toBeGreaterThan(0);
      expect(l.taxCents).toBeLessThan(10_000_00);
      expect(l.classification).toBe(c);
    });
  }

  it("no rate exists for a classification the list does not know about", () => {
    expect(Object.keys(DEFAULT_BO_RATES).sort()).toEqual([...ALL_BO_CLASSIFICATIONS].sort());
    expect(Object.keys(BO_CLASSIFICATION_LABELS).sort()).toEqual(
      [...ALL_BO_CLASSIFICATIONS].sort(),
    );
    expect(Object.keys(BO_CLASSIFICATION_ENTITY).sort()).toEqual(
      [...ALL_BO_CLASSIFICATIONS].sort(),
    );
  });
});
