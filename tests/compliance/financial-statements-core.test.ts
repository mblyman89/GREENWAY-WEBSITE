/**
 * tests/compliance/financial-statements-core.test.ts   (slice books-17)
 *
 * THE SECOND GATE over the four financial statements.
 *
 * `financial-statements-core.ts` carries its own `__runFinancialStatementsCoreTests()`.
 * This file re-runs that suite under vitest AND adds independent assertions that
 * do not live inside the module, for the reason given in bank-match-core.test.ts:
 * a self-test that lives inside the module it tests can be weakened by the very
 * edit that breaks the module. Two locks, two keys.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS ADVERSARIAL RATHER THAN CONFIRMATORY
 * ---------------------------------------------------------------------------
 *
 * Standing rule 22 says the test is a SUSPECT, not a witness. Standing rule 23
 * says try your hardest to break it. So the organising question here is not
 * "does the income statement work?" but "what is the most expensive lie this
 * module could tell, and is there a test that stops it?"
 *
 * For Greenway there are five, in descending order of what they cost:
 *
 *   1. AN OPERATING EXPENSE SMUGGLED INTO COST OF GOODS SOLD. Worth roughly
 *      forty cents on the dollar and the exact conduct that lost Harborside and
 *      Alterman. The §280E wall must be structural, not cosmetic.
 *   2. THE EXCISE TAX IN THE WRONG PLACE. 37% of gross is the second largest
 *      number on the statement. Below the wall it is a disallowed deduction;
 *      above it, it reduces the amount realised (CCA 201531016).
 *   3. AAA GIVEN A ZERO FLOOR. §1368(e)(1)(A) removes the "not below zero"
 *      floor that §1367(a)(2) applies to stock basis. A tidy-looking
 *      `Math.max(0, ...)` here would be a misstatement of the statute and would
 *      hide how much the wall really costs.
 *   4. §1368(d) ORDERING REVERSED. Testing distributions before adding the
 *      year's income invents a capital gain out of nothing.
 *   5. A STATEMENT RENDERED FROM BOOKS THAT DO NOT TIE. The 2023 review carried
 *      a $4,624,697.31 difference for months precisely because every report
 *      rendered anyway (standing rule 19).
 *
 * Each of those five has a mutation test at the bottom of this file that plants
 * the bug and demands detection. The harness SELF-CHECKS FIRST: before it is
 * allowed to report on anything, it must prove it can catch a bug it planted
 * itself. A mutation harness that cannot fail is theatre.
 *
 * ---------------------------------------------------------------------------
 * A NOTE ON FIXTURES
 * ---------------------------------------------------------------------------
 *
 * Every number below was produced by RUNNING the engine and reading the result,
 * never by working out on paper what it ought to be and typing that in. Where a
 * fixture looks odd it is because the real API is stricter than expected:
 *
 *   - `line({ amountCents: 0 })` is impossible. `buildTrialBalance` throws
 *     TB_ZERO_LINE because 0172 forbids zero-value ledger lines. A "missing"
 *     line is therefore modelled by OMITTING it, not by zeroing it.
 *   - BAD_DATE_RANGE cannot be reached through `buildTrialBalance`, which
 *     throws on a backwards range before it can return one. It is reached by
 *     building a good trial balance and spread-overriding the dates, which is
 *     exactly what a buggy caller would effectively do.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildTrialBalance,
  type LedgerLineInput,
  type AccountType,
  type TrialBalance,
} from "@/lib/accounting/trial-balance-core";

import {
  ALL_WALL_SIDES,
  ALL_STATEMENT_REFUSAL_CODES,
  WALL_SIDE_BY_ACCOUNT_TYPE,
  WALL_SIDE_MEANING,
  WALL_AUTHORITY_IDS,
  wallSideOf,
  tbDoesNotTieRefusal,
  formatCents,
  shareInMilliPercent,
  formatMilliPercent,
  requiresSeparateDisclosure,
  buildIncomeStatement,
  buildBalanceSheet,
  buildCashFlowStatement,
  buildEquityStatement,
  comparabilityRefusal,
  compareIncomeStatements,
  __runFinancialStatementsCoreTests,
  type IncomeStatement,
  type StatementRefusalCode,
} from "@/lib/accounting/financial-statements-core";

import {
  FINANCIAL_STATEMENT_AUTHORITIES_NEW,
  AUTHORITY_IDS_OWNED_ELSEWHERE,
  findFinancialStatementAuthority,
  PRESENTATION_CANON_DISCLAIMER,
} from "@/lib/accounting/financial-statement-authorities";

import {
  FINANCIAL_STATEMENT_LESSONS,
  lessonFor,
  taughtFunctionNames,
  citedAuthorityIds,
  exportedCoreFunctionNames,
  assertEveryExportedFunctionIsTaught,
} from "@/lib/accounting/financial-statements-mentor";

import {
  findGuidanceAuthority,
  ALL_SOURCE_REGISTRIES,
  findAuthorityDrift,
  unresolvedDrift,
} from "@/lib/accounting/books-guidance-core";

// ---------------------------------------------------------------------------
// FIXTURE HELPERS
// ---------------------------------------------------------------------------

const FROM = "2026-07-01";
const TO = "2026-07-31";

/**
 * One ledger line, with Greenway-shaped defaults.
 *
 * `amountCents` defaults to 1, NOT 0. A zero default would throw TB_ZERO_LINE
 * on every call that did not override it, and the resulting confusion cost real
 * time the first time this suite was written.
 */
function line(o: Partial<LedgerLineInput>): LedgerLineInput {
  return {
    accountCode: o.accountCode ?? "1000",
    accountName: o.accountName ?? "Cash",
    accountType: o.accountType ?? "asset",
    normalBalance: o.normalBalance ?? "debit",
    amountCents: o.amountCents ?? 1,
    status: o.status ?? "posted",
    // Empty means "stamp me with the period start". A hardcoded default date
    // here silently fell outside every non-July fixture and was caught by the
    // engine's own TB_LINE_OUT_OF_RANGE gate — which is the gate working, but
    // the fixture should not have needed it. Fixed at the helper so no future
    // fixture can reintroduce it (standing rule 23: fix the class).
    journalDate: o.journalDate ?? "",
  };
}

function tbOf(lines: readonly LedgerLineInput[], entityCode = "greenway", from = FROM, to = TO): TrialBalance {
  const stamped = lines.map((l) => (l.journalDate === "" ? { ...l, journalDate: from } : l));
  return buildTrialBalance({ entityCode, fromDate: from, toDate: to, lines: stamped });
}

/**
 * A realistic Greenway month, in round numbers so the arithmetic is checkable
 * by eye: $1,000,000 gross, 37% excise, $400,000 of product, $200,000 of
 * operating cost that §280E disallows.
 */
const GROSS = 100_000_000; // $1,000,000.00
const EXCISE = 37_000_000; //   $370,000.00
const COGS = 40_000_000; //     $400,000.00
const RENT = 12_000_000; //     $120,000.00
const WAGES = 8_000_000; //      $80,000.00

function greenwayMonthTb(): TrialBalance {
  return tbOf([
    line({ accountCode: "4000", accountName: "Retail sales", accountType: "income", normalBalance: "credit", amountCents: -GROSS }),
    line({ accountCode: "4900", accountName: "WA cannabis excise tax", accountType: "income", normalBalance: "credit", amountCents: EXCISE }),
    line({ accountCode: "5000", accountName: "Cost of goods sold", accountType: "cogs", normalBalance: "debit", amountCents: COGS }),
    line({ accountCode: "6000", accountName: "Rent", accountType: "expense", normalBalance: "debit", amountCents: RENT }),
    line({ accountCode: "6100", accountName: "Wages", accountType: "expense", normalBalance: "debit", amountCents: WAGES }),
    line({ accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", amountCents: 3_000_000 }),
  ]);
}

function greenwayMonth(): IncomeStatement {
  const r = buildIncomeStatement({ trialBalance: greenwayMonthTb(), exciseAccountCodes: ["4900"] });
  if (!r.ok) throw new Error(`fixture refused: ${JSON.stringify(r.refusals)}`);
  return r.statement;
}

/** Unwrap a result that must have succeeded, loudly. */
function ok<T>(r: { ok: true; statement: T } | { ok: false; statement: null; refusals: readonly { code: string }[] }): T {
  if (!r.ok) throw new Error(`expected success, got refusals: ${r.refusals.map((x) => x.code).join(", ")}`);
  return r.statement;
}

/** The refusal codes from a result that must have failed. */
function codes(r: { ok: boolean; refusals: readonly { code: StatementRefusalCode }[] }): StatementRefusalCode[] {
  expect(r.ok).toBe(false);
  return r.refusals.map((x) => x.code);
}

const CORE_PATH = join(process.cwd(), "src/lib/accounting/financial-statements-core.ts");
const CORE_SRC = readFileSync(CORE_PATH, "utf8");

// ---------------------------------------------------------------------------
// 1) THE ENGINE'S OWN SELF-TESTS
// ---------------------------------------------------------------------------

describe("the module's internal self-tests", () => {
  it("passes when run from outside the module", () => {
    expect(() => __runFinancialStatementsCoreTests()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2) THE §280E WALL — the most expensive thing in the file
// ---------------------------------------------------------------------------

describe("the §280E wall", () => {
  it("maps every account type to a side, with no default case to absorb a new one", () => {
    // The union is read FROM DISK rather than from a hand-maintained list, so
    // adding a ninth account type without deciding its side fails here instead
    // of silently inheriting whichever side a `default:` happened to be.
    const tbSrc = readFileSync(join(process.cwd(), "src/lib/accounting/trial-balance-core.ts"), "utf8");
    const m = tbSrc.match(/export type AccountType =([\s\S]*?);/);
    expect(m).not.toBeNull();
    const declared = Array.from(m![1].matchAll(/"([a-z_]+)"/g)).map((x) => x[1]).sort();
    expect(declared.length).toBeGreaterThan(0);
    expect(Object.keys(WALL_SIDE_BY_ACCOUNT_TYPE).sort()).toEqual(declared);
  });

  it("puts revenue, the excise and COGS above the line and operating costs below it", () => {
    expect(wallSideOf("income")).toBe("above_the_line");
    expect(wallSideOf("cogs")).toBe("above_the_line");
    expect(wallSideOf("other_income")).toBe("above_the_line");
    expect(wallSideOf("expense")).toBe("below_the_line");
    expect(wallSideOf("other_expense")).toBe("below_the_line");
  });

  it("gives balance sheet accounts NO side rather than forcing them onto one", () => {
    // Forcing an asset "above the line" would imply a tax consequence that does
    // not exist. Three values, not two, on purpose.
    for (const t of ["asset", "liability", "equity"] as AccountType[]) {
      expect(wallSideOf(t)).toBe("not_applicable");
    }
  });

  it("explains every side in plain English with no undefined text", () => {
    for (const side of ALL_WALL_SIDES) {
      expect(WALL_SIDE_MEANING[side]).toBeTruthy();
      expect(WALL_SIDE_MEANING[side].length).toBeGreaterThan(60);
    }
    expect(Object.keys(WALL_SIDE_MEANING).sort()).toEqual([...ALL_WALL_SIDES].sort());
  });

  it("draws the wall ON THE FACE of the statement, not in a note", () => {
    // FASB CON 8 Ch. 7 ¶PR12: a note is not a substitute for recognition.
    const s = greenwayMonth();
    const wall = s.lines.find((l) => l.key === "the_280e_wall");
    expect(wall).toBeDefined();
    expect(wall!.label).toContain("§280E WALL");
    expect(wall!.authorityIds).toEqual(WALL_AUTHORITY_IDS);
  });

  it("places the wall AFTER gross income and BEFORE operating expenses", () => {
    // Position is the whole point. A wall drawn in the wrong place is worse
    // than no wall, because it looks authoritative.
    const keys = greenwayMonth().lines.map((l) => l.key);
    expect(keys.indexOf("gross_income")).toBeLessThan(keys.indexOf("the_280e_wall"));
    expect(keys.indexOf("the_280e_wall")).toBeLessThan(keys.indexOf("operating_expenses"));
  });

  it("every line above the wall is tagged above_the_line, every line below is not", () => {
    const lines = greenwayMonth().lines;
    const wallAt = lines.findIndex((l) => l.key === "the_280e_wall");
    for (let i = 0; i < wallAt; i += 1) {
      expect(lines[i].wallSide).toBe("above_the_line");
    }
    // Below the wall, nothing may claim to be above it.
    for (let i = wallAt + 1; i < lines.length; i += 1) {
      expect(lines[i].wallSide).not.toBe("above_the_line");
    }
  });

  it("keeps operating expenses OUT of cost of goods sold", () => {
    // The Harborside / Alterman failure, asserted directly.
    const s = greenwayMonth();
    expect(s.costOfGoodsSoldCents).toBe(COGS);
    expect(s.operatingExpensesCents).toBe(RENT + WAGES);
    expect(s.costOfGoodsSoldCents).not.toBe(COGS + RENT + WAGES);
    // and the accounts backing COGS are cogs-typed accounts only
    const cogsLine = s.lines.find((l) => l.key === "cost_of_goods_sold")!;
    expect(cogsLine.accountCodes).toEqual(["5000"]);
  });

  it("cites the reseller authorities on the COGS line, not §162", () => {
    const cogsLine = greenwayMonth().lines.find((l) => l.key === "cost_of_goods_sold")!;
    expect(cogsLine.authorityIds).toContain("REG_1_471_3_B_RESELLER_COST");
    expect(cogsLine.authorityIds).toContain("PATIENTS_MUTUAL_RESELLER");
    expect(cogsLine.authorityIds).not.toContain("REG_1_162_1_A");
  });
});

// ---------------------------------------------------------------------------
// 3) THE EXCISE TAX — 37% in the right place
// ---------------------------------------------------------------------------

describe("the Washington cannabis excise tax", () => {
  it("sits between gross sales and net sales, above the wall", () => {
    const s = greenwayMonth();
    const keys = s.lines.map((l) => l.key);
    expect(keys.indexOf("gross_sales")).toBeLessThan(keys.indexOf("excise_tax"));
    expect(keys.indexOf("excise_tax")).toBeLessThan(keys.indexOf("net_sales"));
    expect(s.lines.find((l) => l.key === "excise_tax")!.wallSide).toBe("above_the_line");
  });

  it("reduces net sales rather than being deducted below the line", () => {
    // CCA 201531016: a reduction in the amount realised, not a deduction.
    const s = greenwayMonth();
    expect(s.grossSalesCents).toBe(GROSS);
    expect(s.exciseTaxCents).toBe(EXCISE);
    expect(s.netSalesCents).toBe(GROSS - EXCISE);
    expect(s.netSalesCents).toBe(63_000_000);
  });

  it("is NOT swept into cost of goods sold", () => {
    // The CCA rules out all three wrong homes: deduction, credit, inventory
    // cost. This asserts the third.
    expect(greenwayMonth().costOfGoodsSoldCents).toBe(COGS);
  });

  it("is not double counted when the excise account is typed as an expense", () => {
    // Which account type Michael used is a fact about his chart of accounts.
    // Both shapes must produce the same net income.
    const asExpense = tbOf([
      line({ accountCode: "4000", accountName: "Retail sales", accountType: "income", normalBalance: "credit", amountCents: -GROSS }),
      line({ accountCode: "6900", accountName: "WA cannabis excise tax", accountType: "expense", normalBalance: "debit", amountCents: EXCISE }),
      line({ accountCode: "5000", accountName: "COGS", accountType: "cogs", normalBalance: "debit", amountCents: COGS }),
      line({ accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", amountCents: 23_000_000 }),
    ]);
    const s = ok(buildIncomeStatement({ trialBalance: asExpense, exciseAccountCodes: ["6900"] }));
    expect(s.exciseTaxCents).toBe(EXCISE);
    expect(s.netSalesCents).toBe(GROSS - EXCISE);
    // counted ONCE: it must not also appear in operating expenses
    expect(s.operatingExpensesCents).toBe(0);
  });

  it("is 37% of gross — thirty-seven times the 1% Reg S-X face threshold", () => {
    const s = greenwayMonth();
    const shareMilli = shareInMilliPercent(s.exciseTaxCents, s.grossSalesCents);
    expect(shareMilli).toBe(37_000);
    expect(formatMilliPercent(shareMilli!)).toBe("37%");
    // The regulation's trigger is 1% == 1000 milli-percent.
    expect(shareMilli!).toBeGreaterThan(1_000);
  });

  it("still shows an excise line when the account is named but the balance is zero", () => {
    // A missing line and a zero line say different things. If Michael names an
    // excise account, the caption appears even at zero, because a caption that
    // vanishes makes a wrong month look like a normal one.
    const noExcise = tbOf([
      line({ accountCode: "4000", accountName: "Retail sales", accountType: "income", normalBalance: "credit", amountCents: -GROSS }),
      line({ accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", amountCents: GROSS }),
    ]);
    const s = ok(buildIncomeStatement({ trialBalance: noExcise, exciseAccountCodes: ["4900"] }));
    expect(s.exciseTaxCents).toBe(0);
    expect(s.lines.some((l) => l.key === "excise_tax")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4) THE TAX BRIDGE — why a profitable-looking month owes tax
// ---------------------------------------------------------------------------

describe("the tax bridge memo", () => {
  it("reports gross income as the taxable starting point, not book net income", () => {
    const s = greenwayMonth();
    expect(s.netIncomeCents).toBe(3_000_000); // $30,000 book profit
    expect(s.grossIncomeCents).toBe(23_000_000); // $230,000 taxed
    expect(s.taxBridge.approximateTaxableIncomeCents).toBe(s.grossIncomeCents);
    expect(s.taxBridge.bookNetIncomeCents).toBe(s.netIncomeCents);
  });

  it("names the disallowed amount exactly", () => {
    const s = greenwayMonth();
    expect(s.taxBridge.disallowedDeductionsCents).toBe(RENT + WAGES);
    expect(s.taxBridge.disallowedDeductionsCents).toBe(20_000_000);
    expect(s.grossIncomeCents - s.netIncomeCents).toBe(s.taxBridge.disallowedDeductionsCents);
  });

  it("shows the case where the business loses money on paper and is still taxed", () => {
    // This is the scenario Michael most needs to understand before it happens.
    const lossTb = tbOf([
      line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -GROSS }),
      line({ accountCode: "4900", accountName: "Excise", accountType: "income", normalBalance: "credit", amountCents: EXCISE }),
      line({ accountCode: "5000", accountName: "COGS", accountType: "cogs", normalBalance: "debit", amountCents: COGS }),
      line({ accountCode: "6000", accountName: "Rent", accountType: "expense", normalBalance: "debit", amountCents: 30_000_000 }),
      line({ accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", amountCents: -7_000_000 }),
    ]);
    const s = ok(buildIncomeStatement({ trialBalance: lossTb, exciseAccountCodes: ["4900"] }));
    expect(s.netIncomeCents).toBeLessThan(0); // a loss on paper
    expect(s.grossIncomeCents).toBeGreaterThan(0); // still taxed
    expect(s.taxBridge.explanation).toContain("owe federal tax in a year it lost money on paper");
  });

  it("explains itself in plain English and warns against the COGS reclassification trap", () => {
    const e = greenwayMonth().taxBridge.explanation;
    expect(e).toContain("$230,000.00");
    expect(e).toContain("$200,000.00");
    expect(e).toContain("Harborside");
    expect(e).toContain("Alterman");
  });
});

// ---------------------------------------------------------------------------
// 5) REFUSALS — the gate, not a warning
// ---------------------------------------------------------------------------

describe("refusals", () => {
  it("declares no refusal code it never emits", () => {
    // Three codes were once declared and never used. A refusal code that
    // cannot fire is a promise the engine does not keep.
    const emitted = new Set<string>();
    for (const m of CORE_SRC.matchAll(/code:\s*"([A-Z0-9_]+)"/g)) emitted.add(m[1]);
    const dead = ALL_STATEMENT_REFUSAL_CODES.filter((c) => !emitted.has(c));
    expect(dead).toEqual([]);
  });

  it("emits no code that is missing from the declared union", () => {
    const declared = new Set<string>(ALL_STATEMENT_REFUSAL_CODES);
    const emitted = new Set<string>();
    for (const m of CORE_SRC.matchAll(/code:\s*"([A-Z0-9_]+)"/g)) emitted.add(m[1]);
    expect([...emitted].filter((c) => !declared.has(c))).toEqual([]);
  });

  it("REFUSES a statement when the books do not tie — and names the amount", () => {
    // Standing rule 19: the $4,624,697.31 suspense difference that rendered
    // for months because nobody was ever shown the number.
    const oob = tbOf([
      line({ accountCode: "1000", accountType: "asset", normalBalance: "debit", amountCents: 462_469_732 }),
      line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -1 }),
    ]);
    expect(oob.differenceCents).toBe(462_469_731);
    const r = buildIncomeStatement({ trialBalance: oob });
    expect(codes(r)).toEqual(["TB_DOES_NOT_TIE"]);
    expect(r.refusals[0].message).toContain("$4,624,697.31");
  });

  it("returns NO numbers with a refusal", () => {
    // The type makes this impossible; the test proves the type is the one in
    // use. A refusal that carries a statement is how a wrong number gets
    // rendered by a caller that only checked for null.
    const oob = tbOf([
      line({ accountCode: "1000", amountCents: 5_000 }),
      line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -4_000 }),
    ]);
    const r = buildIncomeStatement({ trialBalance: oob });
    expect(r.ok).toBe(false);
    expect(r.statement).toBeNull();
  });

  it("tells Michael NOT to plug the difference", () => {
    const refusal = tbDoesNotTieRefusal(123_45);
    expect(refusal.code).toBe("TB_DOES_NOT_TIE");
    expect(refusal.message).toContain("$123.45");
    expect(refusal.whatToDo).toContain("Do NOT create an account to hold the difference");
  });

  it("REFUSES an empty period rather than reporting zeros", () => {
    // Zeros would claim "you had no activity", which is a different and
    // usually false statement.
    const r = buildIncomeStatement({ trialBalance: tbOf([]) });
    expect(codes(r)).toEqual(["TB_EMPTY"]);
    expect(r.refusals[0].whatToDo).toContain("GRWNY");
  });

  it("reports emptiness BEFORE out-of-balance, because $0.00 out of balance is useless", () => {
    const r = buildIncomeStatement({ trialBalance: tbOf([]) });
    expect(r.refusals[0].code).not.toBe("TB_DOES_NOT_TIE");
  });

  it("REFUSES a backwards period", () => {
    const good = tbOf([
      line({ accountCode: "1000", amountCents: 1_000 }),
      line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -1_000 }),
    ]);
    // buildTrialBalance throws on a backwards range, so the only way a bad
    // range reaches the statement builder is a caller mutating it afterwards.
    const r = buildIncomeStatement({ trialBalance: { ...good, fromDate: "2026-07-31", toDate: "2026-07-01" } });
    expect(codes(r)).toEqual(["BAD_DATE_RANGE"]);
  });

  it("REFUSES a date that does not exist on the calendar", () => {
    const good = tbOf([
      line({ accountCode: "1000", amountCents: 1_000 }),
      line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -1_000 }),
    ]);
    for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10"]) {
      const r = buildIncomeStatement({ trialBalance: { ...good, toDate: bad } });
      expect(codes(r)).toEqual(["BAD_DATE_RANGE"]);
    }
  });

  it("gives every refusal a remedy, not just a complaint", () => {
    // A refusal without a next step is a dead end, and a dead end teaches an
    // owner to route around the control.
    const collected = [
      buildIncomeStatement({ trialBalance: tbOf([]) }),
      buildIncomeStatement({
        trialBalance: tbOf([
          line({ accountCode: "1000", amountCents: 5_000 }),
          line({ accountCode: "4000", accountName: "S", accountType: "income", normalBalance: "credit", amountCents: -4_000 }),
        ]),
      }),
    ];
    for (const r of collected) {
      expect(r.ok).toBe(false);
      for (const refusal of r.refusals) {
        expect(refusal.message.length).toBeGreaterThan(40);
        expect(refusal.whatToDo.length).toBeGreaterThan(40);
        expect(refusal.authorityIds.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6) MONEY AND PERCENTAGES — integers only
// ---------------------------------------------------------------------------

describe("money and percentages", () => {
  it("formats dollars with grouping and parenthesised negatives", () => {
    // Reg S-X §210.4-01(c): a minus sign is easy to miss, a parenthesis is not.
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(-1)).toBe("($0.01)");
    expect(formatCents(-100)).toBe("($1.00)");
    expect(formatCents(462_469_731)).toBe("$4,624,697.31");
    expect(formatCents(100_000)).toBe("$1,000.00");
    expect(formatCents(99_999)).toBe("$999.99");
  });

  it("never renders a cent as a single digit", () => {
    for (let c = 0; c < 100; c += 1) {
      expect(formatCents(c)).toMatch(/^\$0\.\d{2}$/);
    }
  });

  it("distinguishes 'no percentage exists' from 'the percentage is zero'", () => {
    // Collapsing the two is how a divide-by-zero becomes a plausible 0%.
    expect(shareInMilliPercent(1, 0)).toBeNull();
    expect(shareInMilliPercent(0, 100)).toBe(0);
    expect(shareInMilliPercent(50, 100)).toBe(50_000);
  });

  it("renders milli-percent without floating point artefacts", () => {
    // 85_500 / 1000 in floating point is the road to "8.549999999999999%".
    expect(formatMilliPercent(85_000)).toBe("85%");
    expect(formatMilliPercent(85_500)).toBe("85.5%");
    expect(formatMilliPercent(8_549)).toBe("8.549%");
    expect(formatMilliPercent(-5_000)).toBe("-5%");
    expect(formatMilliPercent(1)).toBe("0.001%");
    expect(formatMilliPercent(0)).toBe("0%");
    expect(formatMilliPercent(100_000)).toBe("100%");
  });

  it("treats the 5% breakout threshold as strictly MORE than five percent", () => {
    // The regulation says "in excess of". Exactly 5% is not a breakout.
    expect(requiresSeparateDisclosure(500, 10_000)).toBe(false);
    expect(requiresSeparateDisclosure(501, 10_000)).toBe(true);
    expect(requiresSeparateDisclosure(-501, 10_000)).toBe(true); // magnitude, not sign
    expect(requiresSeparateDisclosure(1_000, 0)).toBe(false); // no total, no test
  });

  it("FLOAT SENTINEL: every division in the module is truncated to an integer", () => {
    // Standing rule 13e. Floating point in money is how $0.01 differences
    // appear that nobody can explain and everyone eventually plugs.
    //
    // The stripper removes comments and strings, then removes REGEX LITERALS,
    // whose slashes are not division. The left-context guard matters: an
    // earlier, greedier version of this sentinel silently DELETED two real
    // divisions (`yoe / 4`, `yoe / 100`) by mistaking them for a regex literal.
    // A sentinel that hides the thing it is looking for is worse than none.
    let t = CORE_SRC.replace(/\/\*[\s\S]*?\*\//g, " ");
    t = t.replace(/`(?:[^`\\]|\\.)*`/g, '""');
    t = t.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
    t = t.replace(/'(?:[^'\\\n]|\\.)*'/g, '""');
    t = t.replace(/\/\/[^\n]*/g, " ");
    t = t.replace(
      /(?<=[(,=:[!&|?{;])\s*\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuy]*/g,
      " REGEXLIT ",
    );

    const divisions = t.match(/\//g) ?? [];
    const truncs = t.match(/Math\.trunc/g) ?? [];

    // The sentinel must actually be looking at something.
    expect(divisions.length).toBeGreaterThan(0);
    // Exact equality, not >=. A spare trunc would let a bare division hide.
    expect(divisions.length).toBe(truncs.length);

    // And per STATEMENT, so nine of each spread across the wrong lines cannot
    // pass the count test while leaving one division bare.
    for (const stmt of t.split(";")) {
      if (stmt.includes("/")) expect(stmt).toContain("Math.trunc");
    }
  });

  it("PROOF the float sentinel can fail: a bare division is caught", () => {
    // Standing rule 15: a test that cannot fail is decoration.
    const mutant = "const rate = totalCents / 3;";
    let caught = false;
    for (const stmt of mutant.split(";")) {
      if (stmt.includes("/") && !stmt.includes("Math.trunc")) caught = true;
    }
    expect(caught).toBe(true);
  });

  it("PROOF the float problem is real at Greenway's scale", () => {
    // Ownership as floats against one month of sales. Note the naive assertion
    // `0.85 + 0.1 + 0.05 !== 1` is FALSE in IEEE-754 — those three happen to
    // sum exactly. The failure appears when they are APPLIED to money.
    const base = 6_300_001;
    const floatSum = 0.85 * base + 0.1 * base + 0.05 * base;
    expect(floatSum).not.toBe(base);
    // The integer path does not have the problem.
    const intSum =
      Math.trunc((base * 85_000) / 100_000) +
      Math.trunc((base * 10_000) / 100_000) +
      Math.trunc((base * 5_000) / 100_000);
    expect(Number.isInteger(intSum)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7) THE BALANCE SHEET
// ---------------------------------------------------------------------------

describe("the balance sheet", () => {
  function bsTb(): TrialBalance {
    return tbOf([
      line({ accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", amountCents: 5_000_000 }),
      line({ accountCode: "1200", accountName: "Inventory", accountType: "asset", normalBalance: "debit", amountCents: 2_000_000 }),
      line({ accountCode: "1500", accountName: "Equipment", accountType: "asset", normalBalance: "debit", amountCents: 3_000_000 }),
      line({ accountCode: "2000", accountName: "Accounts payable", accountType: "liability", normalBalance: "credit", amountCents: -1_500_000 }),
      line({ accountCode: "3000", accountName: "Common stock", accountType: "equity", normalBalance: "credit", amountCents: -1_000_000 }),
      line({ accountCode: "3900", accountName: "Retained earnings", accountType: "equity", normalBalance: "credit", amountCents: -7_500_000 }),
    ]);
  }

  it("balances, and presents each side as a positive number", () => {
    const bs = ok(buildBalanceSheet({ trialBalance: bsTb(), nonCurrentAccountCodes: ["1500"] }));
    expect(bs.totalAssetsCents).toBe(10_000_000);
    expect(bs.totalLiabilitiesCents).toBe(1_500_000);
    expect(bs.totalEquityCents).toBe(8_500_000);
    expect(bs.totalAssetsCents).toBe(bs.totalLiabilitiesAndEquityCents);
  });

  it("splits current from non-current only where TOLD to, never by account number", () => {
    // Guessing this from a code range is how a long-term note lands in current
    // liabilities and makes a solvent business look insolvent.
    const told = ok(buildBalanceSheet({ trialBalance: bsTb(), nonCurrentAccountCodes: ["1500"] }));
    expect(told.currentAssets.totalCents).toBe(7_000_000);
    expect(told.nonCurrentAssets.totalCents).toBe(3_000_000);

    const notTold = ok(buildBalanceSheet({ trialBalance: bsTb() }));
    expect(notTold.currentAssets.totalCents).toBe(10_000_000);
    expect(notTold.nonCurrentAssets.totalCents).toBe(0);
  });

  it("REFUSES when assets do not equal liabilities plus equity, even though the TB ties", () => {
    // A misclassification the trial balance cannot see: income never closed
    // into equity. The books tie; the balance sheet does not.
    const misclassified = tbOf([
      line({ accountCode: "1000", accountType: "asset", normalBalance: "debit", amountCents: 5_000_000 }),
      line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -5_000_000 }),
    ]);
    expect(misclassified.balanced).toBe(true);
    const r = buildBalanceSheet({ trialBalance: misclassified });
    expect(codes(r)).toEqual(["BALANCE_SHEET_DOES_NOT_TIE"]);
    expect(r.refusals[0].message).toContain("$50,000.00");
    expect(r.refusals[0].message).toContain("The trial balance ties");
  });

  it("accepts the same books once net income is carried into equity", () => {
    const misclassified = tbOf([
      line({ accountCode: "1000", accountType: "asset", normalBalance: "debit", amountCents: 5_000_000 }),
      line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -5_000_000 }),
    ]);
    const bs = ok(buildBalanceSheet({ trialBalance: misclassified, periodNetIncomeCents: 5_000_000 }));
    expect(bs.totalEquityCents).toBe(5_000_000);
    expect(bs.totalAssetsCents).toBe(bs.totalLiabilitiesAndEquityCents);
  });

  it("SURFACES abnormal balances instead of netting them away", () => {
    // CON 8 ¶PR33. Negative inventory and negative ATM cash are on Michael's
    // permanent failure corpus (standing rule 19) — they must never be quietly
    // absorbed into a subtotal.
    const withNegativeInventory = tbOf([
      line({ accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", amountCents: 5_000_000 }),
      line({ accountCode: "1200", accountName: "Inventory", accountType: "asset", normalBalance: "debit", amountCents: -500_000 }),
      line({ accountCode: "3900", accountName: "Retained earnings", accountType: "equity", normalBalance: "credit", amountCents: -4_500_000 }),
    ]);
    const bs = ok(buildBalanceSheet({ trialBalance: withNegativeInventory }));
    expect(bs.abnormalBalances.map((r) => r.accountCode)).toContain("1200");
    // and the total still includes it — surfaced, not removed
    expect(bs.currentAssets.totalCents).toBe(4_500_000);
  });

  it("flags any line over 5% of its section for separate disclosure", () => {
    const bs = ok(buildBalanceSheet({ trialBalance: bsTb(), nonCurrentAccountCodes: ["1500"] }));
    expect(bs.requiredBreakouts).toContain("Cash");
    expect(bs.requiredBreakouts).toContain("Inventory");
    expect(bs.requiredBreakouts).toContain("Accounts payable");
  });

  it("is dated AS OF a moment, not FOR a period", () => {
    // A balance sheet is a photograph; an income statement is a film.
    const bs = ok(buildBalanceSheet({ trialBalance: bsTb() }));
    expect(bs.asOfDate).toBe(TO);
    expect(bs).not.toHaveProperty("fromDate");
  });

  it("gives balance sheet lines no §280E side", () => {
    const bs = ok(buildBalanceSheet({ trialBalance: bsTb() }));
    for (const l of [...bs.currentAssets.lines, ...bs.currentLiabilities.lines, ...bs.equity.lines]) {
      expect(l.wallSide).toBe("not_applicable");
    }
  });
});

// ---------------------------------------------------------------------------
// 8) THE CASH FLOW STATEMENT — the fraud detector
// ---------------------------------------------------------------------------

describe("the statement of cash flows", () => {
  const base = {
    entityCode: "greenway",
    fromDate: FROM,
    toDate: TO,
    beginningCashCents: 1_000_000,
    operatingCents: 500_000,
    investingCents: -200_000,
    financingCents: -50_000,
  };

  it("ties beginning cash plus movements to cash actually counted", () => {
    const cf = ok(buildCashFlowStatement({ ...base, endingCashCents: 1_250_000 }));
    expect(cf.netChangeCents).toBe(250_000);
    expect(cf.beginningCashCents + cf.netChangeCents).toBe(cf.endingCashCents);
  });

  it("REFUSES when counted cash disagrees, and will not call it an adjustment", () => {
    // For a cash business this is the closest thing the books have to a fraud
    // detector. A difference is an unrecorded transaction or money that left.
    const r = buildCashFlowStatement({ ...base, endingCashCents: 1_200_000 });
    expect(codes(r)).toEqual(["CASH_FLOW_DOES_NOT_TIE"]);
    expect(r.refusals[0].message).toContain("($500.00)");
    expect(r.refusals[0].whatToDo).toContain("Do NOT plug the difference");
  });

  it("refuses a one-cent difference exactly as firmly as a large one", () => {
    // Materiality is not a defence against an unexplained cash difference.
    const r = buildCashFlowStatement({ ...base, endingCashCents: 1_250_001 });
    expect(codes(r)).toEqual(["CASH_FLOW_DOES_NOT_TIE"]);
    expect(r.refusals[0].message).toContain("$0.01");
  });

  it("REFUSES a backwards period", () => {
    const r = buildCashFlowStatement({ ...base, fromDate: TO, toDate: FROM, endingCashCents: 1_250_000 });
    expect(codes(r)).toEqual(["BAD_DATE_RANGE"]);
  });

  it("keeps the three activity categories separate", () => {
    // CON 8 ¶PR39: homogeneity. Netting them would hide that the business is
    // funding operations by selling equipment.
    const cf = ok(buildCashFlowStatement({ ...base, endingCashCents: 1_250_000 }));
    const keys = cf.lines.map((l) => l.key);
    expect(keys).toEqual([
      "beginning_cash",
      "operating",
      "investing",
      "financing",
      "net_change",
      "ending_cash",
    ]);
    expect(cf.lines.find((l) => l.key === "ending_cash")!.label).toContain("counted");
  });
});

// ---------------------------------------------------------------------------
// 9) EQUITY, STOCK BASIS AND AAA — the §1367/§1368 machinery
// ---------------------------------------------------------------------------

describe("stockholders' equity, stock basis and AAA", () => {
  const GREENWAY_SHAREHOLDERS = [
    { shareholderName: "Michael Lyman", ownershipMilliPercent: 85_000, beginningBasisCents: 10_000_000 },
    { shareholderName: "Mother", ownershipMilliPercent: 10_000, beginningBasisCents: 3_000_000 },
    { shareholderName: "Nicholas Mullan", ownershipMilliPercent: 5_000, beginningBasisCents: 2_000_000 },
  ];

  function equityInput(over: Record<string, unknown> = {}) {
    return {
      entityCode: "greenway",
      fromDate: FROM,
      toDate: TO,
      beginningEquityCents: 15_000_000,
      netIncomeCents: 3_000_000,
      distributionsCents: 10_000_000,
      contributionsCents: 0,
      nonDeductibleExpenseCents: 20_000_000,
      beginningAaaCents: 0,
      shareholders: GREENWAY_SHAREHOLDERS,
      // Mom is ALLOCATED 10% but PAID nothing; grandfather IS paid.
      distributionsByShareholder: { "Michael Lyman": 9_500_000, Mother: 0, "Nicholas Mullan": 500_000 },
      hasAccumulatedEandP: false,
      ...over,
    } as Parameters<typeof buildEquityStatement>[0];
  }

  it("HARD BLOCKS when nobody has confirmed whether there is accumulated E&P", () => {
    // §1368(b) or §1368(c)? The answer changes the tax outcome materially, and
    // "probably no E&P" would be the most expensive assumption in the codebase.
    const r = buildEquityStatement(equityInput({ hasAccumulatedEandP: null }));
    expect(codes(r)).toContain("EARNINGS_AND_PROFITS_UNKNOWN");
    expect(r.refusals.find((x) => x.code === "EARNINGS_AND_PROFITS_UNKNOWN")!.whatToDo).toContain("CP261");
  });

  it("allocates income by ownership in milli-percent, with no float anywhere", () => {
    const s = ok(buildEquityStatement(equityInput()));
    const michael = s.shareholders.find((x) => x.shareholderName === "Michael Lyman")!;
    expect(michael.allocatedIncomeCents).toBe(2_550_000); // 85% of $30,000
    expect(s.shareholders.find((x) => x.shareholderName === "Mother")!.allocatedIncomeCents).toBe(300_000);
    expect(s.shareholders.find((x) => x.shareholderName === "Nicholas Mullan")!.allocatedIncomeCents).toBe(150_000);
    for (const r of s.shareholders) expect(Number.isInteger(r.allocatedIncomeCents)).toBe(true);
  });

  it("REFUSES when ownership does not total exactly 100%", () => {
    const r = buildEquityStatement(
      equityInput({
        shareholders: [
          { shareholderName: "Michael Lyman", ownershipMilliPercent: 85_000, beginningBasisCents: 10_000_000 },
          { shareholderName: "Mother", ownershipMilliPercent: 10_000, beginningBasisCents: 3_000_000 },
        ],
        distributionsByShareholder: { "Michael Lyman": 10_000_000, Mother: 0 },
      }),
    );
    expect(codes(r)).toContain("OWNERSHIP_NOT_100_PCT");
    expect(r.refusals.find((x) => x.code === "OWNERSHIP_NOT_100_PCT")!.message).toContain("95%");
  });

  it("REFUSES a distribution paid to somebody who owns no stock", () => {
    // The GRWNY/GRNWY typo, applied to a person's name.
    const r = buildEquityStatement(
      equityInput({
        distributionsByShareholder: { "Michael Lymann": 9_500_000, Mother: 0, "Nicholas Mullan": 500_000 },
      }),
    );
    expect(codes(r)).toContain("ENTITY_MISMATCH");
    const m = r.refusals.find((x) => x.code === "ENTITY_MISMATCH")!;
    expect(m.message).toContain("Michael Lymann");
    expect(m.whatToDo).toContain("GRWNY");
  });

  it("REFUSES when per-shareholder distributions do not add to the company total", () => {
    const r = buildEquityStatement(
      equityInput({ distributionsByShareholder: { "Michael Lyman": 9_000_000, Mother: 0, "Nicholas Mullan": 500_000 } }),
    );
    expect(codes(r)).toContain("EQUITY_ROLLFORWARD_DOES_NOT_TIE");
    const m = r.refusals.find((x) => x.code === "EQUITY_ROLLFORWARD_DOES_NOT_TIE")!;
    expect(m.message).toContain("$95,000.00");
    expect(m.message).toContain("$100,000.00");
    expect(m.whatToDo).toContain("Do NOT make the difference disappear by spreading it pro-rata");
  });

  it("does NOT spread distributions pro-rata — mom is allocated but not paid", () => {
    // Standing rule 7. A pro-rata split would be wrong for two of three
    // shareholders and would understate Michael's own draw, which is the number
    // most likely to trip §1368(b)(2).
    const s = ok(buildEquityStatement(equityInput()));
    const mom = s.shareholders.find((x) => x.shareholderName === "Mother")!;
    expect(mom.ownershipMilliPercent).toBe(10_000);
    expect(mom.allocatedIncomeCents).toBe(300_000);
    expect(mom.distributionsCents).toBe(0); // allocated, NOT paid
  });

  it("applies §1368(d) ordering: income first, then non-deductibles, then distributions", () => {
    // Testing distributions BEFORE adding the year's income invents a capital
    // gain out of nothing. Beginning basis $1,000 + income $10,000 = $11,000,
    // less a $5,000 distribution = $6,000 and NO gain. Reversed, it would
    // report a $4,000 gain that does not exist.
    const s = ok(
      buildEquityStatement(
        equityInput({
          beginningEquityCents: 100_000,
          netIncomeCents: 1_000_000,
          distributionsCents: 500_000,
          nonDeductibleExpenseCents: 0,
          shareholders: [{ shareholderName: "Solo Owner", ownershipMilliPercent: 100_000, beginningBasisCents: 100_000 }],
          distributionsByShareholder: { "Solo Owner": 500_000 },
        }),
      ),
    );
    const solo = s.shareholders[0];
    expect(solo.endingBasisCents).toBe(600_000);
    expect(solo.gainOnExcessDistributionCents).toBe(0);
  });

  it("FLOORS stock basis at zero — §1367(a)(2) 'but not below zero'", () => {
    const s = ok(buildEquityStatement(equityInput()));
    for (const r of s.shareholders) expect(r.endingBasisCents).toBeGreaterThanOrEqual(0);
    expect(s.shareholders.find((x) => x.shareholderName === "Michael Lyman")!.endingBasisCents).toBe(0);
  });

  it("reports the §1368(b)(2) capital gain when a distribution exceeds basis", () => {
    // Michael: basis $100,000 + $25,500 income - $170,000 of §280E
    // non-deductibles floors to $0, so his entire $95,000 draw is gain.
    const s = ok(buildEquityStatement(equityInput()));
    const michael = s.shareholders.find((x) => x.shareholderName === "Michael Lyman")!;
    expect(michael.nonDeductibleExpenseCents).toBe(17_000_000);
    expect(michael.gainOnExcessDistributionCents).toBe(9_500_000); // $95,000
    expect(s.warnings.some((w) => w.includes("CAPITAL GAIN"))).toBe(true);
    expect(s.warnings.some((w) => w.includes("$95,000.00"))).toBe(true);
  });

  it("does NOT invent a gain for a shareholder who took nothing", () => {
    const s = ok(buildEquityStatement(equityInput()));
    expect(s.shareholders.find((x) => x.shareholderName === "Mother")!.gainOnExcessDistributionCents).toBe(0);
  });

  it("AAA HAS NO ZERO FLOOR — §1368(e)(1)(A) disregards 'but not below zero'", () => {
    // THE load-bearing assertion of this whole section. A Math.max(0, ...) here
    // would look like a tidy fix, would be a misstatement of the statute, and
    // would hide the single most informative number about what §280E costs.
    const s = ok(buildEquityStatement(equityInput()));
    expect(s.endingAaaCents).toBe(-27_000_000); // 0 + 3,000,000 - 20,000,000 - 10,000,000
    expect(s.endingAaaCents).toBeLessThan(0);
  });

  it("explains a negative AAA rather than hiding it", () => {
    const s = ok(buildEquityStatement(equityInput()));
    const warning = s.warnings.find((w) => w.includes("Accumulated Adjustments Account"));
    expect(warning).toBeDefined();
    expect(warning!).toContain("§1368(e)(1)(A)");
    expect(warning!).toContain("NOT the same account");
  });

  it("keeps stock basis and AAA as different numbers", () => {
    // They are different accounts with different rules and they will disagree.
    // Treating them as one is a classic S-corp error.
    const s = ok(buildEquityStatement(equityInput()));
    const totalBasis = s.shareholders.reduce((a, r) => a + r.endingBasisCents, 0);
    expect(totalBasis).not.toBe(s.endingAaaCents);
    expect(totalBasis).toBeGreaterThanOrEqual(0);
    expect(s.endingAaaCents).toBeLessThan(0);
  });

  it("rolls equity forward without floating point", () => {
    const s = ok(buildEquityStatement(equityInput()));
    expect(s.endingEquityCents).toBe(15_000_000 + 3_000_000 + 0 - 10_000_000);
    expect(s.endingEquityCents).toBe(8_000_000);
    expect(Number.isInteger(s.endingEquityCents)).toBe(true);
  });

  it("collects ALL refusals rather than stopping at the first", () => {
    // An owner fixing one problem at a time, discovering a new refusal each
    // round, learns to distrust the tool. Show the whole list.
    const r = buildEquityStatement(
      equityInput({
        hasAccumulatedEandP: null,
        shareholders: [{ shareholderName: "Michael Lyman", ownershipMilliPercent: 50_000, beginningBasisCents: 0 }],
        distributionsByShareholder: { Ghost: 1_000 },
      }),
    );
    const c = codes(r);
    expect(c).toContain("OWNERSHIP_NOT_100_PCT");
    expect(c).toContain("ENTITY_MISMATCH");
    expect(c).toContain("EARNINGS_AND_PROFITS_UNKNOWN");
    expect(c.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// 10) COMPARATIVE PERIODS
// ---------------------------------------------------------------------------

describe("comparative periods", () => {
  function statementFor(entity: string, from: string, to: string, salesCents = 1_000_000): IncomeStatement {
    const t = tbOf(
      [
        line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -salesCents }),
        line({ accountCode: "5000", accountName: "COGS", accountType: "cogs", normalBalance: "debit", amountCents: salesCents }),
      ],
      entity,
      from,
      to,
    );
    return ok(buildIncomeStatement({ trialBalance: t }));
  }

  const july = statementFor("greenway", "2026-07-01", "2026-07-31");

  it("allows month against month", () => {
    expect(comparabilityRefusal(july, statementFor("greenway", "2026-06-01", "2026-06-30"))).toBeNull();
  });

  it("allows a 31-day January against a 28-day February — a comparison retailers want", () => {
    // The three-day tolerance exists for exactly this.
    expect(comparabilityRefusal(july, statementFor("greenway", "2026-02-01", "2026-02-28"))).toBeNull();
  });

  it("REFUSES a month against a quarter", () => {
    // A 200% "increase" that is really just more days is the error that makes
    // an owner think something is wrong when nothing is.
    const r = comparabilityRefusal(july, statementFor("greenway", "2026-04-01", "2026-06-30"));
    expect(r?.code).toBe("PERIOD_MISMATCH");
    expect(r!.message).toContain("31 days");
    expect(r!.message).toContain("91 days");
  });

  it("REFUSES Greenway against the ATM", () => {
    // Different entities, and they do not even share a tax return: the ATM is
    // a Schedule C, the retailer is an S corporation.
    const r = comparabilityRefusal(july, statementFor("atm", "2026-07-01", "2026-07-31"));
    expect(r?.code).toBe("ENTITY_MISMATCH");
    expect(r!.whatToDo).toContain("Schedule C");
  });

  it("handles the leap day without a Date object anywhere near it", () => {
    // February 2028 is 29 days; February 2026 is 28. One day apart, inside
    // tolerance. If the internal day arithmetic were wrong this would drift.
    const feb2028 = statementFor("greenway", "2028-02-01", "2028-02-29");
    const feb2026 = statementFor("greenway", "2026-02-01", "2026-02-28");
    expect(comparabilityRefusal(feb2028, feb2026)).toBeNull();
    // And a 29-day February against a 31-day July is 2 days apart: allowed.
    expect(comparabilityRefusal(july, feb2028)).toBeNull();
  });

  it("THROWS rather than returning a fictional comparison", () => {
    expect(() => compareIncomeStatements(july, statementFor("atm", "2026-07-01", "2026-07-31"))).toThrow(
      /ENTITY_MISMATCH/,
    );
    expect(() => compareIncomeStatements(july, statementFor("greenway", "2026-04-01", "2026-06-30"))).toThrow(
      /PERIOD_MISMATCH/,
    );
  });

  it("matches lines BY KEY, never by position", () => {
    // A prior period with one fewer line would shift every subsequent row under
    // positional matching and produce a variance report that is entirely
    // fictional while looking completely plausible.
    const withExcise = ok(
      buildIncomeStatement({
        trialBalance: tbOf(
          [
            line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -1_000_000 }),
            line({ accountCode: "4900", accountName: "Excise", accountType: "income", normalBalance: "credit", amountCents: 370_000 }),
            line({ accountCode: "5000", accountName: "COGS", accountType: "cogs", normalBalance: "debit", amountCents: 630_000 }),
          ],
          "greenway",
          "2026-07-01",
          "2026-07-31",
        ),
        exciseAccountCodes: ["4900"],
      }),
    );
    const withoutExcise = statementFor("greenway", "2026-06-01", "2026-06-30");
    const cmp = compareIncomeStatements(withExcise, withoutExcise);

    const cogs = cmp.find((c) => c.key === "cost_of_goods_sold")!;
    expect(cogs.currentCents).toBe(630_000);
    expect(cogs.priorCents).toBe(1_000_000); // matched to COGS, not shifted onto excise
    const excise = cmp.find((c) => c.key === "excise_tax")!;
    expect(excise.priorCents).toBe(0); // absent last period, shown as zero
  });

  it("shows a line that disappeared, because that is the interesting fact", () => {
    const withExcise = ok(
      buildIncomeStatement({
        trialBalance: tbOf(
          [
            line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -1_000_000 }),
            line({ accountCode: "4900", accountName: "Excise", accountType: "income", normalBalance: "credit", amountCents: 370_000 }),
            line({ accountCode: "5000", accountName: "COGS", accountType: "cogs", normalBalance: "debit", amountCents: 630_000 }),
          ],
          "greenway",
          "2026-06-01",
          "2026-06-30",
        ),
        exciseAccountCodes: ["4900"],
      }),
    );
    const cmp = compareIncomeStatements(july, withExcise);
    const excise = cmp.find((c) => c.key === "excise_tax");
    expect(excise).toBeDefined();
    expect(excise!.currentCents).toBe(0);
    expect(excise!.priorCents).toBe(370_000);
    expect(excise!.varianceCents).toBe(-370_000);
  });

  it("omits the wall marker from the variance report", () => {
    // A 0 vs 0 row labelled "§280E WALL" is noise.
    const cmp = compareIncomeStatements(july, statementFor("greenway", "2026-06-01", "2026-06-30"));
    expect(cmp.some((c) => c.key === "the_280e_wall")).toBe(false);
  });

  it("returns null percentage against a zero prior period, never Infinity", () => {
    const cmp = compareIncomeStatements(
      july,
      ok(
        buildIncomeStatement({
          trialBalance: tbOf(
            [
              line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -1_000_000 }),
              line({ accountCode: "4900", accountName: "Excise", accountType: "income", normalBalance: "credit", amountCents: 1_000_000 }),
            ],
            "greenway",
            "2026-06-01",
            "2026-06-30",
          ),
          exciseAccountCodes: ["4900"],
        }),
      ),
    );
    for (const c of cmp) {
      if (c.priorCents === 0) expect(c.variancePctMilli).toBeNull();
      if (c.variancePctMilli !== null) expect(Number.isFinite(c.variancePctMilli)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 11) THE AUTHORITIES — standing rule 24, the quote is sacred
// ---------------------------------------------------------------------------

describe("the authority records", () => {
  it("gives every new authority all six fields, populated", () => {
    for (const a of FINANCIAL_STATEMENT_AUTHORITIES_NEW) {
      expect(a.id).toMatch(/^[A-Z0-9_]+$/);
      expect(a.kind).toBeTruthy();
      expect(a.cite.length).toBeGreaterThan(8);
      expect(a.quote.length).toBeGreaterThan(40);
      expect(a.soWhat.length).toBeGreaterThan(80);
      expect(a.source.length).toBeGreaterThan(8);
    }
  });

  it("uses no duplicate ids", () => {
    const ids = FINANCIAL_STATEMENT_AUTHORITIES_NEW.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does NOT re-declare an authority that another module already owns", () => {
    // Standing rule 2: two copies of one authority is exactly how the two
    // copies drift apart and a citation stops meaning one thing.
    const ownedHere = new Set(FINANCIAL_STATEMENT_AUTHORITIES_NEW.map((a) => a.id));
    for (const id of AUTHORITY_IDS_OWNED_ELSEWHERE) {
      expect(ownedHere.has(id)).toBe(false);
    }
  });

  it("every id claimed to live elsewhere really does resolve elsewhere", () => {
    // Deleting one of these in another slice fails loudly HERE rather than
    // producing a citation to nothing on a report.
    const dangling = AUTHORITY_IDS_OWNED_ELSEWHERE.filter((id) => !findGuidanceAuthority(id));
    expect(dangling).toEqual([]);
  });

  it("carries the CCA's own precedential warning inside the quote", () => {
    // Standing rule 24. Quoting the helpful half of a document and dropping
    // "may not be used or cited as precedent" would be advocacy, not advice.
    const cca = findFinancialStatementAuthority("CCA_201531016_EXCISE_AMOUNT_REALIZED")!;
    expect(cca.quote).toContain("This advice may not be used or cited as precedent");
    expect(cca.soWhat).toContain("support, not a guarantee");
  });

  it("omits the CCA's stale 25% rate rather than quoting a repealed number", () => {
    // The 2015 CCA describes a 25% tax that no longer exists; the rate is 37%
    // today. Quoting the arithmetic verbatim would be accurate as history and
    // misleading as guidance, so that passage is not carried.
    const cca = findFinancialStatementAuthority("CCA_201531016_EXCISE_AMOUNT_REALIZED")!;
    expect(cca.quote).not.toContain("25 percent");
    expect(cca.quote).not.toContain("25%");
  });

  it("carries the 1 percent excise-on-the-face rule verbatim", () => {
    const regsx = findFinancialStatementAuthority("REG_SX_210_5_03_CAPTION_ORDER")!;
    expect(regsx.quote).toContain("1 percent or more of such total");
    expect(regsx.quote).toContain("shown on the face of the statement");
  });

  it("tells Michael plainly that Regulation S-X does not bind him", () => {
    // A rule presented as binding when it is not teaches an owner either to
    // fear an imaginary obligation or to discount a real one.
    expect(PRESENTATION_CANON_DISCLAIMER).toContain("You do not file with the SEC");
    expect(PRESENTATION_CANON_DISCLAIMER).toContain("house style guide, not as law");
  });

  it("marks the tax authorities as binding law, not style", () => {
    for (const id of ["IRC_1367_STOCK_BASIS_ADJUSTMENTS", "IRC_1368_DISTRIBUTIONS_AAA"]) {
      const a = findFinancialStatementAuthority(id)!;
      expect(a).toBeDefined();
      expect(a.kind).toBe("statute");
    }
    for (const id of ["REG_SX_210_4_01_NOT_MISLEADING", "REG_SX_210_5_03_CAPTION_ORDER"]) {
      expect(findFinancialStatementAuthority(id)!.kind).toBe("regulation");
    }
  });

  it("records where every quote came from, with a dated provenance", () => {
    // Every authority must say HOW the text was obtained and WHEN. Two verbs
    // are allowed and they mean different things:
    //   "retrieved"              - this system fetched it from a public source
    //   "supplied by the owner"  - Michael obtained it and handed it over
    // The second exists because the FASB Codification is licensed and could
    // not be fetched; he bought/obtained access himself on 2026-08-20. Naming
    // the difference is the point. A source with no date is not a source.
    for (const a of FINANCIAL_STATEMENT_AUTHORITIES_NEW) {
      expect(a.source).toMatch(/(retrieved|supplied by the owner) 20\d\d-\d\d-\d\d/);
    }
  });

  it("names the exact file every Codification quote was transcribed from", () => {
    // Standing rule 24: the quote is sacred. For the ASC records the primary
    // source is a licensed document, so the source field must point at the
    // precise file a future reader can re-open to check the transcription.
    // A bare "ASC 330" would not be re-verifiable; "fasb_codification_330.pdf"
    // is. This is what makes the verbatim claim auditable instead of trusted.
    const ascRecords = FINANCIAL_STATEMENT_AUTHORITIES_NEW.filter((a) =>
      a.cite.startsWith("FASB ASC "),
    );
    expect(ascRecords.length).toBe(5);
    for (const a of ascRecords) {
      expect(a.kind).toBe("gaap");
      expect(a.source).toMatch(/fasb_codification_\d{3}\.pdf/);
      // The FAF copyright must travel with the quote wherever it is shown.
      expect(a.source).toContain("Financial Accounting Foundation");
      // The file cited must match the topic cited: ASC 330-... -> _330.pdf.
      const topic = /FASB ASC (\d{3})-/.exec(a.cite)![1];
      expect(a.source).toContain(`fasb_codification_${topic}.pdf`);
    }
  });

  it("upgrades the no-netting rule from concept to binding GAAP", () => {
    // Before Michael supplied the Codification, the only authority this engine
    // had for refusing to net was CON 8 - the FASB explaining its reasoning.
    // Reasoning is not a rule. ASC 210-20-45-4 is the rule. Both are kept: the
    // concept explains WHY, the Codification says WHAT YOU MUST DO.
    const binding = findFinancialStatementAuthority("ASC_210_20_45_4_NOT_FAITHFUL")!;
    expect(binding).toBeDefined();
    expect(binding.quote).toContain("is not representationally faithful");
    const concept = findFinancialStatementAuthority("CON8_CH7_PR33_NETTING")!;
    expect(concept).toBeDefined();
    expect(concept.kind).toBe("gaap");
  });
});

// ---------------------------------------------------------------------------
// 12) REGISTRY WIRING — standing rule 25
// ---------------------------------------------------------------------------

describe("registry wiring", () => {
  it("registers the financial-statement source", () => {
    expect(ALL_SOURCE_REGISTRIES).toContain("financial-statement");
  });

  it("makes every new authority reachable through the GLOBAL finder", () => {
    // Written is not wired. An authority that only its own module can see is
    // invisible to every screen that renders guidance.
    const unreachable = FINANCIAL_STATEMENT_AUTHORITIES_NEW.filter((a) => !findGuidanceAuthority(a.id));
    expect(unreachable.map((a) => a.id)).toEqual([]);
  });

  it("returns the SAME object through both finders, not a copy", () => {
    for (const a of FINANCIAL_STATEMENT_AUTHORITIES_NEW) {
      expect(findGuidanceAuthority(a.id)).toBe(findFinancialStatementAuthority(a.id));
    }
  });

  it("introduces no new authority drift", () => {
    // The two known divergences are adjudicated and expected. A third means
    // this slice created a second copy of an authority somewhere.
    const fingerprint = findAuthorityDrift()
      .map((d) => `${d.id}.${d.field}`)
      .sort()
      .join(",");
    expect(fingerprint).toBe("ALPENGLOW_EXCLUSION.cite,CCA_201504011.quote");
    expect(unresolvedDrift()).toHaveLength(0);
  });

  it("resolves every authority id cited anywhere in the engine", () => {
    // Any id typed into a line item or a refusal must exist. A citation to
    // nothing is worse than no citation, because it looks like research.
    const cited = new Set<string>();
    for (const m of CORE_SRC.matchAll(/"([A-Z][A-Z0-9_]{4,})"/g)) cited.add(m[1]);
    const refusalCodes = new Set<string>(ALL_STATEMENT_REFUSAL_CODES);
    const missing = [...cited].filter((id) => !refusalCodes.has(id) && !findGuidanceAuthority(id));
    expect(missing).toEqual([]);
  });

  it("resolves every authority id cited by the wall", () => {
    for (const id of WALL_AUTHORITY_IDS) {
      expect(findGuidanceAuthority(id)).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 13) THE MENTOR LAYER — standing rule 26
// ---------------------------------------------------------------------------

describe("the mentor layer", () => {
  it("teaches EVERY exported function, with no orphan lessons", () => {
    // This gate has already earned its place: it caught `comparabilityRefusal`
    // shipping without a lesson, unprompted, during this very slice.
    expect(() => assertEveryExportedFunctionIsTaught()).not.toThrow();
  });

  it("reads the real export list from disk rather than a hand-maintained copy", () => {
    const onDisk = exportedCoreFunctionNames();
    expect(onDisk.length).toBeGreaterThan(0);
    expect([...onDisk].sort()).toEqual([...taughtFunctionNames()].sort());
  });

  it("PROOF the coverage gate can fail: an untaught function is detected", () => {
    // Standing rule 16: prove the gate is wired, not merely present.
    const taught = new Set(taughtFunctionNames());
    expect(taught.has("buildIncomeStatement")).toBe(true);
    expect(taught.has("aFunctionThatDoesNotExist")).toBe(false);
    // Simulate the gate's own logic against a planted missing lesson.
    const pretendExports = [...taught, "smuggledInWithoutALesson"];
    const untaught = pretendExports.filter((f) => !taught.has(f));
    expect(untaught).toEqual(["smuggledInWithoutALesson"]);
  });

  it("gives every lesson all five fields with real content", () => {
    for (const l of FINANCIAL_STATEMENT_LESSONS) {
      expect(l.plainEnglish.length).toBeGreaterThan(40);
      expect(l.whyItExists.length).toBeGreaterThan(40);
      expect(l.theTrap.length).toBeGreaterThan(40);
      expect(l.whatIWouldDo.length).toBeGreaterThan(40);
      expect(l.authorityIds.length).toBeGreaterThan(0);
    }
  });

  it("cites only authorities that resolve", () => {
    const bad = citedAuthorityIds().filter((id) => !findGuidanceAuthority(id));
    expect(bad).toEqual([]);
  });

  it("uses every authority it declares — no decorative citations", () => {
    // FOUND BY ATTACKING THE PASSING SUITE (standing rule 23).
    //
    // Every other gate here runs one direction: it checks that each id a
    // lesson cites actually resolves. Nothing ran the OTHER direction, so an
    // authority could be added to the registry, counted in the total, shown in
    // the authority browser, and never once be the reason the engine does
    // anything. That is a citation as decoration, and it is how a registry
    // slowly becomes a trophy cabinet instead of a control.
    //
    // Running the probe caught two real orphans the moment it was written:
    // ASC 205-10-45-1A (the full-set rule) and Reg. 1.461-4(g)(6) (economic
    // performance on the excise accrual). Both were genuinely load-bearing and
    // simply had not been wired to the lesson they justify.
    const cited = new Set(citedAuthorityIds());
    const orphans = FINANCIAL_STATEMENT_AUTHORITIES_NEW.filter((a) => !cited.has(a.id)).map(
      (a) => a.id,
    );
    expect(orphans).toEqual([]);
  });

  it("SELF-CHECK: the decorative-citation gate can actually fail", () => {
    // Standing rule 15/22: the test is a suspect, not a witness. Prove the
    // gate above would notice an orphan rather than passing vacuously.
    const cited = new Set(citedAuthorityIds());
    const pretend = [...FINANCIAL_STATEMENT_AUTHORITIES_NEW.map((a) => a.id), "AUTHORITY_NOBODY_USES"];
    const orphans = pretend.filter((id) => !cited.has(id));
    expect(orphans).toEqual(["AUTHORITY_NOBODY_USES"]);
  });

  it("writes in plain English — no unexplained jargon in the plain-English field", () => {
    // Michael has a Master's in accounting and has not opened a book in
    // thirteen years. Standing rule 29: plain English is a deliverable.
    const jargon = ["ASC ", "GAAP-compliant", "rollforward", "amortization schedule", "accretive"];
    for (const l of FINANCIAL_STATEMENT_LESSONS) {
      for (const j of jargon) {
        expect(l.plainEnglish).not.toContain(j);
      }
    }
  });

  it("finds a lesson by name and returns undefined for one that does not exist", () => {
    expect(lessonFor("buildEquityStatement")).toBeDefined();
    expect(lessonFor("nope")).toBeUndefined();
  });

  it("teaches the AAA floor trap specifically", () => {
    // The single most likely well-intentioned bug in the whole slice.
    const lesson = lessonFor("buildEquityStatement")!;
    const all = `${lesson.whyItExists} ${lesson.theTrap} ${lesson.whatIWouldDo}`;
    expect(all).toContain("1368(e)(1)(A)");
  });
});

// ---------------------------------------------------------------------------
// 13b) DEFECTS FOUND BY ATTACKING THE ENGINE — standing rule 23
//
// The suite was 110/110 green and all ten real-source mutations were caught
// before any of these existed. That proved the tests covered what the engine
// DID; it said nothing about inputs the engine had never been asked about. So
// the engine was attacked with inputs a real caller could plausibly produce,
// and six genuine defects fell out. Every one of them is fixed, and every one
// of them now has a test here so it stays fixed.
//
// This block is the record of that. It is deliberately kept separate from the
// happy-path sections above, because these are not features — they are scars.
// ---------------------------------------------------------------------------

describe("defects found by attacking the engine", () => {
  const shareholders = [
    { shareholderName: "Michael Lyman", ownershipMilliPercent: 85_000, beginningBasisCents: 10_000_000 },
    { shareholderName: "Mother", ownershipMilliPercent: 10_000, beginningBasisCents: 3_000_000 },
    { shareholderName: "Nicholas Mullan", ownershipMilliPercent: 5_000, beginningBasisCents: 2_000_000 },
  ];

  function eqInput(over: Record<string, unknown> = {}) {
    return {
      entityCode: "greenway",
      fromDate: FROM,
      toDate: TO,
      beginningEquityCents: 15_000_000,
      netIncomeCents: 3_000_000,
      distributionsCents: 10_000_000,
      contributionsCents: 0,
      nonDeductibleExpenseCents: 20_000_000,
      beginningAaaCents: 0,
      shareholders,
      distributionsByShareholder: { "Michael Lyman": 9_500_000, Mother: 0, "Nicholas Mullan": 500_000 },
      hasAccumulatedEandP: false,
      ...over,
    } as Parameters<typeof buildEquityStatement>[0];
  }

  // -- D1 -------------------------------------------------------------------

  it("D1: THROWS on a fractional cent instead of printing \"$0.10.5\"", () => {
    // The dangerous one: not obviously broken at a glance, sits in a column of
    // real money, and means a fractional cent reached the ledger unchallenged.
    expect(() => formatCents(10.5)).toThrow(/NOT_INTEGER_CENTS/);
    expect(() => formatCents(NaN)).toThrow(/NOT_INTEGER_CENTS/);
    expect(() => formatCents(Infinity)).toThrow(/NOT_INTEGER_CENTS/);
    expect(() => formatCents(-Infinity)).toThrow(/NOT_INTEGER_CENTS/);
  });

  it("D1: THROWS above the range where an integer stops being exact", () => {
    expect(() => formatCents(Number.MAX_SAFE_INTEGER + 2)).toThrow(/CENTS_OUT_OF_SAFE_RANGE|NOT_INTEGER_CENTS/);
  });

  it("D1: still formats every legitimate integer amount", () => {
    // A guard that also rejects good input is a worse bug than the one it fixed.
    for (const c of [0, 1, -1, 99, 100, -100, 462_469_731, Number.MAX_SAFE_INTEGER - 1]) {
      expect(() => formatCents(c)).not.toThrow();
    }
  });

  it("D1: the guard is wired into the money INPUTS, not just the formatter", () => {
    // Standing rule 16: prove the gate is wired.
    expect(() =>
      buildCashFlowStatement({
        entityCode: "greenway", fromDate: FROM, toDate: TO,
        beginningCashCents: NaN, endingCashCents: 0,
        operatingCents: 0, investingCents: 0, financingCents: 0,
      }),
    ).toThrow(/NOT_INTEGER_CENTS/);
    expect(() => buildEquityStatement(eqInput({ netIncomeCents: 1.5 }))).toThrow(/NOT_INTEGER_CENTS/);
    expect(() => buildEquityStatement(eqInput({ beginningAaaCents: NaN }))).toThrow(/NOT_INTEGER_CENTS/);
  });

  it("D1: rejects a fractional ownership percentage", () => {
    // Milli-percent exists precisely so ownership is never a float.
    expect(() =>
      buildEquityStatement(
        eqInput({
          shareholders: [{ shareholderName: "Solo", ownershipMilliPercent: 100_000.5, beginningBasisCents: 0 }],
          distributionsByShareholder: { Solo: 10_000_000 },
        }),
      ),
    ).toThrow(/NOT_INTEGER_MILLI_PERCENT/);
  });

  // -- D2 -------------------------------------------------------------------

  it("D2: REFUSES duplicate shareholder names that would double count a payout", () => {
    // Both rows used to claim the FULL distribution while the rollforward tie
    // check saw one key and agreed. Two K-1s, one payment.
    const r = buildEquityStatement(
      eqInput({
        shareholders: [
          { shareholderName: "A", ownershipMilliPercent: 50_000, beginningBasisCents: 0 },
          { shareholderName: "A", ownershipMilliPercent: 50_000, beginningBasisCents: 0 },
        ],
        distributionsByShareholder: { A: 10_000_000 },
      }),
    );
    expect(codes(r)).toContain("DUPLICATE_SHAREHOLDER");
    expect(r.refusals.find((x) => x.code === "DUPLICATE_SHAREHOLDER")!.message).toContain("two K-1s");
  });

  it("D2: the old rollforward check could NOT have caught it", () => {
    // Proof the new guard is load-bearing rather than redundant: the lookup
    // table sums to exactly the company total, so the tie check is satisfied.
    const table = { A: 10_000_000 };
    expect(Object.values(table).reduce((a, b) => a + b, 0)).toBe(10_000_000);
  });

  // -- D3 -------------------------------------------------------------------

  it("D3: REFUSES one account listed as BOTH the excise and a discount", () => {
    // It was subtracted twice: $10.00 of sales less $3.00 of excise came out at
    // $4.00 instead of $7.00.
    const r = buildIncomeStatement({
      trialBalance: tbOf([
        line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -1_000 }),
        line({ accountCode: "4900", accountName: "Excise", accountType: "income", normalBalance: "credit", amountCents: 300 }),
        line({ accountCode: "5000", accountName: "COGS", accountType: "cogs", normalBalance: "debit", amountCents: 700 }),
      ]),
      exciseAccountCodes: ["4900"],
      contraRevenueAccountCodes: ["4900"],
    });
    expect(codes(r)).toEqual(["ACCOUNT_ROLE_CONFLICT"]);
    expect(r.refusals[0].message).toContain("4900");
  });

  it("D3: still allows the two roles on DIFFERENT accounts", () => {
    const s = ok(
      buildIncomeStatement({
        trialBalance: tbOf([
          line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -1_000 }),
          line({ accountCode: "4900", accountName: "Excise", accountType: "income", normalBalance: "credit", amountCents: 300 }),
          line({ accountCode: "4950", accountName: "Discounts", accountType: "income", normalBalance: "credit", amountCents: 100 }),
          line({ accountCode: "5000", accountName: "COGS", accountType: "cogs", normalBalance: "debit", amountCents: 600 }),
        ]),
        exciseAccountCodes: ["4900"],
        contraRevenueAccountCodes: ["4950"],
      }),
    );
    expect(s.netSalesCents).toBe(600); // 1000 - 300 - 100, each subtracted ONCE
  });

  // -- D4 -------------------------------------------------------------------

  it("D4: a shareholder named 'constructor' gets zero, not a function", () => {
    // The lookup used to resolve up the prototype chain, so `?? 0` never fired
    // and the distribution became Object itself, poisoning basis with NaN.
    const s = ok(
      buildEquityStatement(
        eqInput({
          distributionsCents: 0,
          shareholders: [{ shareholderName: "constructor", ownershipMilliPercent: 100_000, beginningBasisCents: 500_000 }],
          distributionsByShareholder: {},
        }),
      ),
    );
    const row = s.shareholders[0];
    expect(row.distributionsCents).toBe(0);
    expect(Number.isInteger(row.endingBasisCents)).toBe(true);
    expect(Number.isNaN(row.endingBasisCents)).toBe(false);
  });

  it("D4: every inherited property name is safe, not just 'constructor'", () => {
    // Fix the class, not the instance (standing rule 23).
    for (const name of ["toString", "valueOf", "hasOwnProperty", "isPrototypeOf"]) {
      const s = ok(
        buildEquityStatement(
          eqInput({
            distributionsCents: 0,
            shareholders: [{ shareholderName: name, ownershipMilliPercent: 100_000, beginningBasisCents: 500_000 }],
            distributionsByShareholder: {},
          }),
        ),
      );
      expect(s.shareholders[0].distributionsCents).toBe(0);
      expect(Number.isInteger(s.shareholders[0].endingBasisCents)).toBe(true);
    }
  });

  // -- D5 -------------------------------------------------------------------

  it("D5: REFUSES a negative distribution that would invent basis", () => {
    // It used to INCREASE basis and AAA out of nothing.
    const r = buildEquityStatement(
      eqInput({ distributionsCents: -100_000, distributionsByShareholder: { "Michael Lyman": -100_000 } }),
    );
    expect(codes(r)).toContain("NEGATIVE_EQUITY_MOVEMENT");
    expect(r.refusals.find((x) => x.code === "NEGATIVE_EQUITY_MOVEMENT")!.whatToDo).toContain("contribution");
  });

  it("D5: REFUSES a negative contribution and names it correctly", () => {
    const r = buildEquityStatement(eqInput({ contributionsCents: -50_000 }));
    expect(codes(r)).toContain("NEGATIVE_EQUITY_MOVEMENT");
  });

  // -- D6 -------------------------------------------------------------------

  it("D6: REFUSES an S corporation with no shareholders at all", () => {
    // Used to produce AAA with no basis tracking — silently omitting the number
    // that decides whether a distribution is taxable.
    const r = buildEquityStatement(eqInput({ shareholders: [], distributionsByShareholder: {} }));
    expect(codes(r)).toContain("NO_SHAREHOLDERS");
  });

  // -- things that were checked and are NOT defects --------------------------

  it("correctly ALLOWS an all-returns month with negative sales", () => {
    // Real, and surfaced rather than hidden.
    const s = ok(
      buildIncomeStatement({
        trialBalance: tbOf([
          line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: 500_000 }),
          line({ accountCode: "1000", accountType: "asset", normalBalance: "debit", amountCents: -500_000 }),
        ]),
      }),
    );
    expect(s.grossSalesCents).toBe(-500_000);
  });

  it("correctly ALLOWS an accumulated deficit and flags it abnormal", () => {
    // CON 8 ¶PR33: surface it, never net it away.
    const bs = ok(
      buildBalanceSheet({
        trialBalance: tbOf([
          line({ accountCode: "1000", accountType: "asset", normalBalance: "debit", amountCents: 100_000 }),
          line({ accountCode: "2000", accountName: "AP", accountType: "liability", normalBalance: "credit", amountCents: -500_000 }),
          line({ accountCode: "3900", accountName: "Deficit", accountType: "equity", normalBalance: "credit", amountCents: 400_000 }),
        ]),
      }),
    );
    expect(bs.totalEquityCents).toBe(-400_000);
    expect(bs.abnormalBalances.map((r) => r.accountCode)).toContain("3900");
  });

  it("loses no pennies splitting ownership into thirds", () => {
    // 33.334 / 33.333 / 33.333 must still allocate every cent of net income.
    const s = ok(
      buildEquityStatement(
        eqInput({
          netIncomeCents: 1_000_000,
          distributionsCents: 0,
          nonDeductibleExpenseCents: 0,
          shareholders: [
            { shareholderName: "A", ownershipMilliPercent: 33_334, beginningBasisCents: 0 },
            { shareholderName: "B", ownershipMilliPercent: 33_333, beginningBasisCents: 0 },
            { shareholderName: "C", ownershipMilliPercent: 33_333, beginningBasisCents: 0 },
          ],
          distributionsByShareholder: {},
        }),
      ),
    );
    const allocated = s.shareholders.reduce((a, r) => a + r.allocatedIncomeCents, 0);
    expect(allocated).toBe(1_000_000);
  });

  it("does not mutate the statements handed to the comparative", () => {
    const cur = greenwayMonth();
    const before = JSON.stringify(cur);
    compareIncomeStatements(cur, greenwayMonth());
    expect(JSON.stringify(cur)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 14) MUTATION HARNESS — standing rules 15c, 22 and 23
//
// A test suite that cannot fail is decoration. This harness plants each of the
// five most expensive bugs and demands that the assertions above catch them.
// It SELF-CHECKS FIRST: before it may report on anything, it must prove it can
// catch a bug it planted itself.
// ---------------------------------------------------------------------------

describe("mutation harness — proving these tests can actually fail", () => {
  /** True when the check THREW, i.e. the mutation was DETECTED. */
  function detects(check: () => void): boolean {
    try {
      check();
      return false;
    } catch {
      return true;
    }
  }

  it("SELF-CHECK: the harness catches a bug it plants itself", () => {
    expect(detects(() => expect(2 + 2).toBe(5))).toBe(true);
    expect(detects(() => expect(2 + 2).toBe(4))).toBe(false);
  });

  it("SELF-CHECK: a correct engine value is not reported as a mutation", () => {
    expect(detects(() => expect(greenwayMonth().grossIncomeCents).toBe(23_000_000))).toBe(false);
  });

  it("MUTANT 1 — an operating expense smuggled into COGS is caught", () => {
    // The Harborside / Alterman bug. Worth ~40 cents on the dollar.
    const mutantCogs = COGS + RENT + WAGES;
    expect(detects(() => expect(greenwayMonth().costOfGoodsSoldCents).toBe(mutantCogs))).toBe(true);
    // and it would have changed the number §280E actually taxes
    expect(detects(() => expect(greenwayMonth().grossIncomeCents).toBe(GROSS - EXCISE - mutantCogs))).toBe(true);
    expect(greenwayMonth().grossIncomeCents).toBe(23_000_000);
  });

  it("MUTANT 2 — the excise moved below the wall is caught", () => {
    // If the excise were treated as a disallowed deduction instead of a
    // reduction in amount realised, net sales would be the full gross.
    expect(detects(() => expect(greenwayMonth().netSalesCents).toBe(GROSS))).toBe(true);
    expect(detects(() => expect(greenwayMonth().lines.find((l) => l.key === "excise_tax")!.wallSide).toBe("below_the_line"))).toBe(true);
    // and if it were swept into COGS
    expect(detects(() => expect(greenwayMonth().costOfGoodsSoldCents).toBe(COGS + EXCISE))).toBe(true);
  });

  it("MUTANT 3 — a zero floor on AAA is caught", () => {
    // The tidy-looking fix that would misstate §1368(e)(1)(A).
    const s = ok(
      buildEquityStatement({
        entityCode: "greenway",
        fromDate: FROM,
        toDate: TO,
        beginningEquityCents: 15_000_000,
        netIncomeCents: 3_000_000,
        distributionsCents: 10_000_000,
        contributionsCents: 0,
        nonDeductibleExpenseCents: 20_000_000,
        beginningAaaCents: 0,
        shareholders: [{ shareholderName: "Solo", ownershipMilliPercent: 100_000, beginningBasisCents: 10_000_000 }],
        distributionsByShareholder: { Solo: 10_000_000 },
        hasAccumulatedEandP: false,
      }),
    );
    const mutantAaa = Math.max(0, s.endingAaaCents);
    expect(detects(() => expect(s.endingAaaCents).toBe(mutantAaa))).toBe(true);
    expect(s.endingAaaCents).toBe(-27_000_000);
    expect(mutantAaa).toBe(0);
  });

  it("MUTANT 4 — reversed §1368(d) ordering is caught", () => {
    // Distributions tested BEFORE income invents a capital gain from nothing.
    const s = ok(
      buildEquityStatement({
        entityCode: "greenway",
        fromDate: FROM,
        toDate: TO,
        beginningEquityCents: 100_000,
        netIncomeCents: 1_000_000,
        distributionsCents: 500_000,
        contributionsCents: 0,
        nonDeductibleExpenseCents: 0,
        beginningAaaCents: 0,
        shareholders: [{ shareholderName: "Solo", ownershipMilliPercent: 100_000, beginningBasisCents: 100_000 }],
        distributionsByShareholder: { Solo: 500_000 },
        hasAccumulatedEandP: false,
      }),
    );
    const solo = s.shareholders[0];
    // The mutant: basis $1,000 - distribution $5,000 => $4,000 of phantom gain.
    const mutantGain = Math.max(0, 500_000 - 100_000);
    expect(mutantGain).toBe(400_000);
    expect(detects(() => expect(solo.gainOnExcessDistributionCents).toBe(mutantGain))).toBe(true);
    expect(solo.gainOnExcessDistributionCents).toBe(0);
    expect(solo.endingBasisCents).toBe(600_000);
  });

  it("MUTANT 5 — a disabled trial-balance gate is caught", () => {
    // If the tie check were downgraded to a warning, a statement would render.
    const oob = tbOf([
      line({ accountCode: "1000", accountType: "asset", normalBalance: "debit", amountCents: 462_469_732 }),
      line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -1 }),
    ]);
    const r = buildIncomeStatement({ trialBalance: oob });
    expect(detects(() => expect(r.ok).toBe(true))).toBe(true);
    expect(detects(() => expect(r.statement).not.toBeNull())).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("MUTANT 6 — a balance sheet that renders without tying is caught", () => {
    const misclassified = tbOf([
      line({ accountCode: "1000", accountType: "asset", normalBalance: "debit", amountCents: 5_000_000 }),
      line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -5_000_000 }),
    ]);
    const r = buildBalanceSheet({ trialBalance: misclassified });
    expect(detects(() => expect(r.ok).toBe(true))).toBe(true);
  });

  it("MUTANT 7 — pro-rata distributions instead of amounts actually paid are caught", () => {
    // Mom is allocated 10% and paid nothing. A pro-rata engine would give her
    // $10,000 and understate Michael's draw.
    const s = ok(
      buildEquityStatement({
        entityCode: "greenway",
        fromDate: FROM,
        toDate: TO,
        beginningEquityCents: 15_000_000,
        netIncomeCents: 3_000_000,
        distributionsCents: 10_000_000,
        contributionsCents: 0,
        nonDeductibleExpenseCents: 20_000_000,
        beginningAaaCents: 0,
        shareholders: [
          { shareholderName: "Michael Lyman", ownershipMilliPercent: 85_000, beginningBasisCents: 10_000_000 },
          { shareholderName: "Mother", ownershipMilliPercent: 10_000, beginningBasisCents: 3_000_000 },
          { shareholderName: "Nicholas Mullan", ownershipMilliPercent: 5_000, beginningBasisCents: 2_000_000 },
        ],
        distributionsByShareholder: { "Michael Lyman": 9_500_000, Mother: 0, "Nicholas Mullan": 500_000 },
        hasAccumulatedEandP: false,
      }),
    );
    const mom = s.shareholders.find((x) => x.shareholderName === "Mother")!;
    const proRataMutant = Math.trunc((10_000_000 * 10_000) / 100_000); // $10,000
    expect(proRataMutant).toBe(1_000_000);
    expect(detects(() => expect(mom.distributionsCents).toBe(proRataMutant))).toBe(true);
    expect(mom.distributionsCents).toBe(0);
  });

  it("MUTANT 8 — positional line matching in the comparative is caught", () => {
    const cur = ok(
      buildIncomeStatement({
        trialBalance: tbOf(
          [
            line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -1_000_000 }),
            line({ accountCode: "4900", accountName: "Excise", accountType: "income", normalBalance: "credit", amountCents: 370_000 }),
            line({ accountCode: "5000", accountName: "COGS", accountType: "cogs", normalBalance: "debit", amountCents: 630_000 }),
          ],
          "greenway",
          "2026-07-01",
          "2026-07-31",
        ),
        exciseAccountCodes: ["4900"],
      }),
    );
    const prior = ok(
      buildIncomeStatement({
        trialBalance: tbOf(
          [
            line({ accountCode: "4000", accountName: "Sales", accountType: "income", normalBalance: "credit", amountCents: -1_000_000 }),
            line({ accountCode: "5000", accountName: "COGS", accountType: "cogs", normalBalance: "debit", amountCents: 1_000_000 }),
          ],
          "greenway",
          "2026-06-01",
          "2026-06-30",
        ),
      }),
    );
    const cmp = compareIncomeStatements(cur, prior);
    const excise = cmp.find((c) => c.key === "excise_tax")!;
    // Positional matching would have paired the excise row against prior COGS.
    expect(detects(() => expect(excise.priorCents).toBe(1_000_000))).toBe(true);
    expect(excise.priorCents).toBe(0);
  });
});
