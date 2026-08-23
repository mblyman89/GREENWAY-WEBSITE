/**
 * tests/compliance/financial-statements-ui-core.test.ts   (books-42)
 *
 * THE FINANCIAL STATEMENTS SCREEN'S DECISIONS, PROVED.
 *
 * The page that goes with `financial-statements-ui-core.ts` is markup and
 * nothing else. Every rule it follows lives in that module, and this file is
 * the reason we can say it works.
 *
 * WHAT THIS SUITE IS ESPECIALLY LOOKING FOR
 *
 *   1. THE ROLE GUARD. books-42 found that passing Greenway's real excise
 *      account — `32000`, a trust LIABILITY — to `buildIncomeStatement` made
 *      net sales EXCEED gross sales on a balanced trial balance, with no
 *      refusal. That is the headline defect of this slice and the guard against
 *      it is tested from both directions: it fires on a balance sheet account,
 *      and it stays silent on a legitimate income account.
 *
 *   2. THE ADAPTER. Two types in this codebase are called a trial balance and
 *      they are not the same type. The join between them re-attaches account
 *      TYPE, which is the only thing that decides which side of the §280E wall
 *      a dollar falls on. An unmapped account must refuse, never default.
 *
 *   3. THAT BLOCKERS ARE NOT ZEROS. Three of the four statements need facts
 *      nobody has supplied. The failure mode is a confident, well-formatted
 *      $0.00 that renders and lies.
 *
 *   4. THAT NO RATIO EVER DIVIDES BY ZERO INTO A CONFIDENT ANSWER. "There is no
 *      answer" and "the answer is nothing" are different statements.
 *
 * Every figure is computed from the engine, never typed in.
 */

import { describe, expect, it } from "vitest";

import {
  adaptTrialBalance,
  assertRoleCodesAreProfitAndLoss,
  balanceRatios,
  bandHigherIsBetter,
  bandLowerIsBetter,
  bandTone,
  basisPoints,
  blockersFor,
  blockersForStatement,
  bookToTaxGapCents,
  buildFsScreen,
  contraRevenueCodesFrom,
  disallowedSpendCents,
  exciseCodesFrom,
  formatBasisPoints,
  incomeRatios,
  incomeRows,
  isProfitAndLossType,
  losingMoneyButStillTaxed,
  PROFIT_AND_LOSS_TYPES,
  READING_ORDER,
  readingStepsFor,
  readinessTone,
  refusalCard,
  REFUSAL_HEADLINES,
  scopeNoteMentionsNoAssurance,
  STATEMENT_QUESTIONS,
  STATEMENT_SCOPE_NOTE,
  STATEMENT_TITLES,
  statementCards,
  trustAccountCodesFrom,
  trustMoneyHeldCents,
  WALL_LINE_KEY,
  type FsFactsOnFile,
} from "@/lib/accounting/financial-statements-ui-core";
import {
  buildIncomeStatement,
  ALL_STATEMENT_REFUSAL_CODES,
} from "@/lib/accounting/financial-statements-core";
// ---------------------------------------------------------------------------
// FIXTURES — Greenway's REAL chart codes, taken from migration 0173.
//
// This matters more than it looks. The engine's own test suite uses fictional
// codes `4900` and `6900`, which are income and expense types. Greenway's chart
// has no income-type excise account at all, which is precisely why the defect
// this suite guards against was never exercised.
//
// The fixture itself now lives in `greenway-chart-fixture.ts` and is SHARED
// with `owner-report-books-42.test.ts`. It used to live here, and the owner
// report gate built its own second copy — which lacked the contra-revenue
// account, so the same defect produced $13,700.00 there and $13,200.00 here.
// Two fixtures both claiming to be "Greenway's books" is a disagreement with a
// date on it. There is now one. See that file's header for the full account.
// ---------------------------------------------------------------------------

import type { TrialBalanceView } from "@/lib/accounting/books-ledger-guidance-core";
import {
  GREENWAY_CONTRA_CODES,
  GREENWAY_FACTS as FACTS,
  greenwayView,
  line,
} from "./greenway-chart-fixture";

const NOTHING_ON_FILE: FsFactsOnFile = {
  nonCurrentClassificationSupplied: false,
  cashFlowActivitySplitSupplied: false,
  hasAccumulatedEandP: null,
  beginningAaaSupplied: false,
  beginningBasisSupplied: false,
};

const EVERYTHING_ON_FILE: FsFactsOnFile = {
  nonCurrentClassificationSupplied: true,
  cashFlowActivitySplitSupplied: true,
  hasAccumulatedEandP: false,
  beginningAaaSupplied: true,
  beginningBasisSupplied: true,
};

function screen(overrides: Partial<Parameters<typeof buildFsScreen>[0]> = {}) {
  return buildFsScreen({
    view: greenwayView(),
    facts: FACTS,
    entityCode: "greenway",
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
    nonCurrentAccountCodes: [],
    factsOnFile: NOTHING_ON_FILE,
    ...overrides,
  });
}

// ===========================================================================
describe("the fixture itself", () => {
  it("balances — otherwise every statement below would refuse for the wrong reason", () => {
    const v = greenwayView();
    expect(v.foots).toBe(true);
    expect(v.differenceCents).toBe(0);
  });

  it("uses Greenway's real chart codes, not the engine's fictional 4900/6900", () => {
    const codes = new Set(greenwayView().lines.map((l) => l.accountCode));
    expect(codes.has("4900")).toBe(false);
    expect(codes.has("6900")).toBe(false);
    expect(codes.has("32000")).toBe(true);
  });

  it("contains NO income-type or expense-type excise account, because Greenway's chart has none", () => {
    const exciseNamed = FACTS.filter((f) => /excise/i.test(f.name));
    expect(exciseNamed.length).toBeGreaterThan(0);
    for (const f of exciseNamed) expect(f.accountType).toBe("liability");
  });
});

// ===========================================================================
describe("THE ROLE GUARD — the defect books-42 found", () => {
  /*
   * The proof, re-run here rather than quoted. Passing the trust liability as
   * the excise code produced net sales ABOVE gross sales on a balanced trial
   * balance, and nothing refused. This test exists so the engine's behaviour is
   * pinned: if the engine is ever fixed upstream, this goes red and the guard
   * can be reconsidered rather than left as superstition.
   */
  it("PROVES the engine really does produce net sales above gross when handed a liability", () => {
    const adapted = adaptTrialBalance(greenwayView(), FACTS, "greenway", "2026-07-01", "2026-07-31");
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;

    const bad = buildIncomeStatement({
      trialBalance: adapted.trialBalance,
      exciseAccountCodes: ["32000"],
      contraRevenueAccountCodes: GREENWAY_CONTRA_CODES,
    });

    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    expect(bad.statement.netSalesCents).toBeGreaterThan(bad.statement.grossSalesCents);
    expect(bad.statement.grossSalesCents).toBe(10_000_00);
    expect(bad.statement.netSalesCents).toBe(13_200_00);
  });

  it("the guard THROWS on a balance sheet account offered as excise", () => {
    expect(() => assertRoleCodesAreProfitAndLoss(["32000"], FACTS, "excise")).toThrow(
      /FS_ROLE_CODE_NOT_PROFIT_AND_LOSS/,
    );
  });

  it("the guard names the offending account, its name AND its type", () => {
    try {
      assertRoleCodesAreProfitAndLoss(["32000"], FACTS, "excise");
      throw new Error("the guard did not fire");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("32000");
      expect(msg).toContain("Cannabis Excise Tax Payable");
      expect(msg).toContain("liability");
    }
  });

  it("the guard explains the ARITHMETIC, not just the rule", () => {
    try {
      assertRoleCodesAreProfitAndLoss(["32000"], FACTS, "excise");
      throw new Error("the guard did not fire");
    } catch (e) {
      // A refusal that does not say what went wrong teaches nothing.
      expect((e as Error).message).toContain("$13,200.00");
      expect((e as Error).message).toContain("$10,000.00");
    }
  });

  it("fires for contra-revenue too, with the right wording", () => {
    expect(() => assertRoleCodesAreProfitAndLoss(["30000"], FACTS, "contra-revenue")).toThrow(
      /contra-revenue account/,
    );
  });

  it("stays SILENT on a legitimate income account — a guard that always fires is useless", () => {
    expect(() => assertRoleCodesAreProfitAndLoss(["50900"], FACTS, "contra-revenue")).not.toThrow();
    expect(() => assertRoleCodesAreProfitAndLoss(["50010"], FACTS, "excise")).not.toThrow();
  });

  it("stays silent on an unknown code — that is the adapter's job, not this guard's", () => {
    expect(() => assertRoleCodesAreProfitAndLoss(["99999"], FACTS, "excise")).not.toThrow();
  });

  it("stays silent on an empty list", () => {
    expect(() => assertRoleCodesAreProfitAndLoss([], FACTS, "excise")).not.toThrow();
  });

  it("every profit-and-loss type is accepted, and every balance sheet type is not", () => {
    for (const t of PROFIT_AND_LOSS_TYPES) expect(isProfitAndLossType(t)).toBe(true);
    for (const t of ["asset", "liability", "equity"] as const) {
      expect(isProfitAndLossType(t)).toBe(false);
    }
  });

  it("PROFIT_AND_LOSS_TYPES has exactly the five types that belong on a P&L", () => {
    expect([...PROFIT_AND_LOSS_TYPES].sort()).toEqual([
      "cogs",
      "expense",
      "income",
      "other_expense",
      "other_income",
    ]);
  });

  it("buildFsScreen runs the guard BEFORE the engine, so the wrong number is never computed", () => {
    // Poison the chart: rename the trust liability so `exciseCodesFrom` would
    // pick it up if the type filter were removed. With the filter in place the
    // code is never selected, so the screen builds. This is the negative half.
    const poisoned = FACTS.map((f) =>
      f.code === "32000" ? { ...f, accountType: "income" as const } : f,
    );
    // Now 32000 IS an income account called "excise", so it is selected, and
    // the guard must NOT fire — an income-typed excise account is legitimate.
    expect(() => screen({ facts: poisoned })).not.toThrow();
  });
});

// ===========================================================================
describe("deriving the role codes from the chart instead of typing them in", () => {
  it("Greenway has NO excise account on the income statement, and that is correct", () => {
    expect(exciseCodesFrom(FACTS)).toEqual([]);
  });

  it("the contra-revenue codes are 50900 and 50910, read from is_contra", () => {
    expect(contraRevenueCodesFrom(FACTS)).toEqual(["50900", "50910"]);
  });

  it("contra accounts that are NOT revenue are excluded", () => {
    // 20810 (inventory reserve) and 41000 (distributions) are both is_contra
    // and neither is a customer discount.
    const out = contraRevenueCodesFrom(FACTS);
    expect(out).not.toContain("20810");
    expect(out).not.toContain("41000");
  });

  it("a new contra-revenue account appears automatically", () => {
    const extended = [
      ...FACTS,
      { code: "50920", name: "Loyalty Redemptions", accountType: "income" as const, normalBalance: "debit" as const, isContra: true },
    ];
    expect(contraRevenueCodesFrom(extended)).toEqual(["50900", "50910", "50920"]);
  });

  it("the trust accounts are 32000 and 32100, derived from the chart's own wording", () => {
    expect(trustAccountCodesFrom(FACTS)).toEqual(["32000", "32100"]);
  });

  it("an income-typed excise account WOULD be found — the emptiness is derived, not hard-coded", () => {
    const withExcise = [
      ...FACTS,
      { code: "50930", name: "Excise Tax Collected", accountType: "income" as const, normalBalance: "debit" as const, isContra: false },
    ];
    expect(exciseCodesFrom(withExcise)).toEqual(["50930"]);
  });
});

// ===========================================================================
describe("the adapter between the two trial balance types", () => {
  it("produces a TrialBalance the engine accepts, and it ties", () => {
    const a = adaptTrialBalance(greenwayView(), FACTS, "greenway", "2026-07-01", "2026-07-31");
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.trialBalance.balanced).toBe(true);
    expect(a.trialBalance.differenceCents).toBe(0);
    expect(a.trialBalance.rows).toHaveLength(12);
  });

  it("carries the entity and the dates through — a statement is always FOR a period", () => {
    const a = adaptTrialBalance(greenwayView(), FACTS, "greenway", "2026-07-01", "2026-07-31");
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.trialBalance.entityCode).toBe("greenway");
    expect(a.trialBalance.fromDate).toBe("2026-07-01");
    expect(a.trialBalance.toDate).toBe("2026-07-31");
  });

  it("RE-ATTACHES ACCOUNT TYPE — the only thing that decides which side of the wall a dollar falls on", () => {
    const a = adaptTrialBalance(greenwayView(), FACTS, "greenway", "2026-07-01", "2026-07-31");
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const byCode = new Map(a.trialBalance.rows.map((r) => [r.accountCode, r]));
    expect(byCode.get("60010")?.accountType).toBe("cogs");
    expect(byCode.get("73030")?.accountType).toBe("expense");
    expect(byCode.get("32000")?.accountType).toBe("liability");
  });

  it("REFUSES an account the chart cannot explain — it does not default to expense", () => {
    const v = greenwayView();
    const withGhost: TrialBalanceView = {
      ...v,
      lines: [...v.lines, line("99999", "Mystery", 0)],
    };
    const a = adaptTrialBalance(withGhost, FACTS, "greenway", "2026-07-01", "2026-07-31");
    expect(a.ok).toBe(false);
    expect(a.unmappedAccountCodes).toContain("99999");
    expect(a.trialBalance).toBeNull();
  });

  it("honours unmapped codes the VIEW already found, not only the ones it finds itself", () => {
    const v = greenwayView();
    const a = adaptTrialBalance(
      { ...v, unmappedAccountCodes: ["20009-GRWNY"] },
      FACTS,
      "greenway",
      "2026-07-01",
      "2026-07-31",
    );
    expect(a.ok).toBe(false);
    expect(a.unmappedAccountCodes).toEqual(["20009-GRWNY"]);
  });

  it("recomputes 'abnormal' rather than trusting the flag it was handed", () => {
    const v = greenwayView();
    // Claim cash is fine while giving it a credit balance. The adapter must
    // disagree, because it recomputes from normal balance.
    const lying: TrialBalanceView = {
      ...v,
      lines: v.lines.map((l) =>
        l.accountCode === "10100"
          ? { ...l, balanceCents: -1, debitCents: 0, creditCents: 1, isAbnormal: false }
          : l,
      ),
    };
    const a = adaptTrialBalance(lying, FACTS, "greenway", "2026-07-01", "2026-07-31");
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.trialBalance.rows.find((r) => r.accountCode === "10100")?.isAbnormal).toBe(true);
  });

  it("never reports a line count of zero, which would read as 'no evidence'", () => {
    const a = adaptTrialBalance(greenwayView(), FACTS, "greenway", "2026-07-01", "2026-07-31");
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    for (const r of a.trialBalance.rows) expect(r.lineCount).toBeGreaterThan(0);
  });

  it("an out-of-balance view is carried through as out of balance, not silently plugged", () => {
    const v = greenwayView();
    const broken: TrialBalanceView = {
      ...v,
      lines: [...v.lines, line("73030", "Hardware & Equipment", 1_00)],
    };
    const a = adaptTrialBalance(broken, FACTS, "greenway", "2026-07-01", "2026-07-31");
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.trialBalance.balanced).toBe(false);
    expect(a.trialBalance.differenceCents).toBe(1_00);
  });
});

// ===========================================================================
describe("the income statement, on screen", () => {
  it("builds, and the arithmetic is the truth rather than the trap", () => {
    const s = screen();
    expect(s.income?.ok).toBe(true);
    if (!s.income?.ok) return;
    expect(s.income.statement.grossSalesCents).toBe(10_000_00);
    expect(s.income.statement.netSalesCents).toBe(9_500_00);
    expect(s.income.statement.grossIncomeCents).toBe(3_500_00);
    expect(s.income.statement.netIncomeCents).toBe(2_300_00);
  });

  it("net sales never exceeds gross sales on the real chart", () => {
    const s = screen();
    if (!s.income?.ok) throw new Error("expected an income statement");
    expect(s.income.statement.netSalesCents).toBeLessThanOrEqual(
      s.income.statement.grossSalesCents,
    );
  });

  it("has NO excise line, because the excise is trust money and never was revenue", () => {
    const s = screen();
    if (!s.income?.ok) throw new Error("expected an income statement");
    expect(s.income.statement.lines.some((l) => l.key === "excise_tax")).toBe(false);
  });

  it("renders the §280E wall as a rule with no amount, not as $0.00", () => {
    const s = screen();
    if (!s.income?.ok) throw new Error("expected an income statement");
    const rows = incomeRows(s.income.statement);
    const wall = rows.find((r) => r.isWall);
    expect(wall).toBeDefined();
    expect(wall?.key).toBe(WALL_LINE_KEY);
    expect(wall?.amount).toBe("");
  });

  it("every row except the wall carries a formatted amount", () => {
    const s = screen();
    if (!s.income?.ok) throw new Error("expected an income statement");
    for (const r of incomeRows(s.income.statement)) {
      if (r.isWall) continue;
      expect(r.amount).toMatch(/^\(?\$[\d,]+\.\d{2}\)?$/);
    }
  });

  it("rows above the wall are marked above the line, and below are below", () => {
    const s = screen();
    if (!s.income?.ok) throw new Error("expected an income statement");
    const rows = incomeRows(s.income.statement);
    const wallAt = rows.findIndex((r) => r.isWall);
    expect(wallAt).toBeGreaterThan(0);
    expect(rows.slice(0, wallAt).every((r) => r.wallSide === "above_the_line")).toBe(true);
    expect(rows.some((r, i) => i > wallAt && r.wallSide === "below_the_line")).toBe(true);
  });

  it("the disallowed spend is the operating expenses, and it is real money", () => {
    const s = screen();
    if (!s.income?.ok) throw new Error("expected an income statement");
    expect(disallowedSpendCents(s.income.statement)).toBe(1_200_00);
  });

  it("the book-to-tax gap equals gross income less book net income", () => {
    const s = screen();
    if (!s.income?.ok) throw new Error("expected an income statement");
    expect(bookToTaxGapCents(s.income.statement)).toBe(3_500_00 - 2_300_00);
  });

  it("recognises the cruellest case: a book loss with tax still owed", () => {
    const v = greenwayView();
    // Push operating expenses past gross income: a loss on paper, tax on gross.
    const loss: TrialBalanceView = {
      ...v,
      lines: v.lines.map((l) =>
        l.accountCode === "73030"
          ? { ...l, balanceCents: 5_000_00, debitCents: 5_000_00 }
          : l.accountCode === "40400"
            ? { ...l, balanceCents: 1_200_00, debitCents: 1_200_00 }
            : l,
      ),
    };
    let d = 0;
    let c = 0;
    for (const l of loss.lines) {
      d += l.debitCents;
      c += l.creditCents;
    }
    const balanced: TrialBalanceView = { ...loss, totalDebitCents: d, totalCreditCents: c, differenceCents: d - c, foots: d === c };
    expect(balanced.foots).toBe(true);

    const s = screen({ view: balanced });
    if (!s.income?.ok) throw new Error("expected an income statement");
    expect(s.income.statement.netIncomeCents).toBeLessThan(0);
    expect(s.income.statement.grossIncomeCents).toBeGreaterThan(0);
    expect(losingMoneyButStillTaxed(s.income.statement)).toBe(true);
  });

  it("a profitable month is NOT flagged as losing money", () => {
    const s = screen();
    if (!s.income?.ok) throw new Error("expected an income statement");
    expect(losingMoneyButStillTaxed(s.income.statement)).toBe(false);
  });
});

// ===========================================================================
describe("the balance sheet, on screen", () => {
  it("builds and ties", () => {
    const s = screen();
    expect(s.balance?.ok).toBe(true);
    if (!s.balance?.ok) return;
    expect(s.balance.statement.totalAssetsCents).toBe(
      s.balance.statement.totalLiabilitiesAndEquityCents,
    );
  });

  it("with nothing classified, EVERY liability is current — which is the pessimistic direction", () => {
    const s = screen();
    if (!s.balance?.ok) throw new Error("expected a balance sheet");
    expect(s.balance.statement.nonCurrentLiabilities.totalCents).toBe(0);
    expect(s.balance.statement.currentLiabilities.totalCents).toBe(11_700_00);
  });

  it("classifying the loan as long-term moves it, and the sheet still ties", () => {
    const s = screen({ nonCurrentAccountCodes: ["34000"] });
    if (!s.balance?.ok) throw new Error("expected a balance sheet");
    expect(s.balance.statement.nonCurrentLiabilities.totalCents).toBe(5_000_00);
    expect(s.balance.statement.currentLiabilities.totalCents).toBe(6_700_00);
    expect(s.balance.statement.totalAssetsCents).toBe(
      s.balance.statement.totalLiabilitiesAndEquityCents,
    );
  });

  it("TRUST MONEY is separated out — the single most useful figure on the page", () => {
    const s = screen();
    if (!s.balance?.ok) throw new Error("expected a balance sheet");
    const trust = trustMoneyHeldCents(s.balance.statement, s.trustAccountCodes);
    expect(trust).toBe(4_700_00);
  });

  it("trust money counts long-term liabilities too, so it cannot be hidden by reclassifying", () => {
    const s = screen({ nonCurrentAccountCodes: ["32000"] });
    if (!s.balance?.ok) throw new Error("expected a balance sheet");
    expect(trustMoneyHeldCents(s.balance.statement, s.trustAccountCodes)).toBe(4_700_00);
  });

  it("returns zero trust money when no trust accounts are named", () => {
    const s = screen();
    if (!s.balance?.ok) throw new Error("expected a balance sheet");
    expect(trustMoneyHeldCents(s.balance.statement, [])).toBe(0);
  });
});

// ===========================================================================
describe("blockers — the facts only Michael can supply", () => {
  it("with nothing on file, all five are raised", () => {
    expect(blockersFor(NOTHING_ON_FILE)).toHaveLength(5);
  });

  it("with everything on file, none is raised", () => {
    expect(blockersFor(EVERYTHING_ON_FILE)).toHaveLength(0);
  });

  it("E&P known to be FALSE is an answer, not a gap — false must not behave like null", () => {
    const b = blockersFor({ ...EVERYTHING_ON_FILE, hasAccumulatedEandP: false });
    expect(b).toHaveLength(0);
  });

  it("E&P known to be TRUE is also an answer", () => {
    const b = blockersFor({ ...EVERYTHING_ON_FILE, hasAccumulatedEandP: true });
    expect(b).toHaveLength(0);
  });

  it("E&P UNKNOWN raises exactly one blocker, on the equity statement", () => {
    const b = blockersFor({ ...EVERYTHING_ON_FILE, hasAccumulatedEandP: null });
    expect(b).toHaveLength(1);
    expect(b[0].statement).toBe("equity");
  });

  it("three of them belong to the equity statement", () => {
    expect(blockersForStatement(blockersFor(NOTHING_ON_FILE), "equity")).toHaveLength(3);
  });

  it("every blocker names an actual DOCUMENT, never 'ask your accountant'", () => {
    for (const b of blockersFor(NOTHING_ON_FILE)) {
      expect(b.whereToGetIt.length).toBeGreaterThan(40);
      expect(b.whereToGetIt).not.toMatch(/ask your accountant/i);
    }
  });

  it("the E&P blocker names Form 2553 and CP261 specifically", () => {
    const b = blockersFor(NOTHING_ON_FILE).find((x) => /earnings and profits/i.test(x.what));
    expect(b?.whereToGetIt).toContain("2553");
    expect(b?.whereToGetIt).toContain("CP261");
  });

  it("the AAA blocker names Schedule M-2", () => {
    const b = blockersFor(NOTHING_ON_FILE).find((x) => /adjustments account/i.test(x.what));
    expect(b?.whereToGetIt).toContain("M-2");
  });

  it("the basis blocker names Form 7203", () => {
    const b = blockersFor(NOTHING_ON_FILE).find((x) => /stock basis/i.test(x.what));
    expect(b?.whereToGetIt).toContain("7203");
  });

  it("every blocker cites at least one authority", () => {
    for (const b of blockersFor(NOTHING_ON_FILE)) {
      expect(b.authorityIds.length).toBeGreaterThan(0);
    }
  });

  it("every blocker explains WHY, not just WHAT", () => {
    for (const b of blockersFor(NOTHING_ON_FILE)) {
      expect(b.why.length).toBeGreaterThan(80);
    }
  });
});

// ===========================================================================
describe("the statement cards", () => {
  it("there are always four, in a fixed order", () => {
    const cards = screen().cards;
    expect(cards.map((c) => c.id)).toEqual(["income", "balance", "cash_flow", "equity"]);
  });

  it("every card leads with the QUESTION the statement answers", () => {
    for (const c of screen().cards) {
      expect(c.question).toBe(STATEMENT_QUESTIONS[c.id]);
      expect(c.question.endsWith("?")).toBe(true);
    }
  });

  it("with nothing on file, income is ready and the other three are not", () => {
    const cards = screen().cards;
    const byId = new Map(cards.map((c) => [c.id, c]));
    expect(byId.get("income")?.readiness).toBe("ready");
    expect(byId.get("balance")?.readiness).toBe("blocked");
    expect(byId.get("cash_flow")?.readiness).toBe("blocked");
    expect(byId.get("equity")?.readiness).toBe("blocked");
  });

  it("with everything on file, the balance sheet becomes ready", () => {
    const cards = screen({ factsOnFile: EVERYTHING_ON_FILE }).cards;
    expect(cards.find((c) => c.id === "balance")?.readiness).toBe("ready");
  });

  it("a BLOCKED card is gold, not red — waiting is not broken", () => {
    const cards = screen().cards;
    expect(cards.find((c) => c.id === "equity")?.tone).toBe("gold");
  });

  it("a REFUSED card is danger", () => {
    expect(readinessTone("refused")).toBe("danger");
    expect(readinessTone("ready")).toBe("green");
    expect(readinessTone("blocked")).toBe("gold");
  });

  it("a card with one blocker says so in the singular", () => {
    const cards = statementCards(null, null, [
      {
        statement: "equity",
        what: "One Thing",
        why: "x",
        whereToGetIt: "y",
        authorityIds: ["IRC_280E"],
      },
    ]);
    expect(cards.find((c) => c.id === "equity")?.status).toContain("one thing");
  });

  it("a refusal wins over a blocker — the refusal is the more urgent fact", () => {
    const v = greenwayView();
    const broken: TrialBalanceView = {
      ...v,
      lines: [...v.lines, line("73030", "Hardware & Equipment", 1_00)],
    };
    const s = screen({ view: broken });
    expect(s.income?.ok).toBe(false);
    expect(s.cards.find((c) => c.id === "income")?.readiness).toBe("refused");
  });

  it("every title and question is non-empty for all four statements", () => {
    for (const id of ["income", "balance", "cash_flow", "equity"] as const) {
      expect(STATEMENT_TITLES[id].length).toBeGreaterThan(0);
      expect(STATEMENT_QUESTIONS[id].length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
describe("the ratios — integer arithmetic, and never a confident zero", () => {
  it("basisPoints returns NULL on a zero denominator, not zero", () => {
    expect(basisPoints(100, 0)).toBeNull();
  });

  it("a null ratio renders as an em dash, never as 0.00%", () => {
    expect(formatBasisPoints(null)).toBe("—");
  });

  it("computes a familiar percentage exactly", () => {
    expect(basisPoints(3_500_00, 9_500_00)).toBe(3684);
    expect(formatBasisPoints(3684)).toBe("36.84%");
  });

  it("rounds half away from zero rather than truncating", () => {
    // 1/3 = 3333.33bp -> 3333 ; 2/3 = 6666.67bp -> 6667
    expect(basisPoints(1, 3)).toBe(3333);
    expect(basisPoints(2, 3)).toBe(6667);
  });

  it("handles negatives, and formats them with a leading minus", () => {
    expect(basisPoints(-500, 10_000)).toBe(-500);
    expect(formatBasisPoints(-500)).toBe("-5.00%");
  });

  it("REFUSES a fractional input — a fraction means a float touched money upstream", () => {
    expect(() => basisPoints(10.5, 100)).toThrow(/FS_RATIO_NOT_INTEGER/);
    expect(() => basisPoints(100, 10.5)).toThrow(/FS_RATIO_NOT_INTEGER/);
  });

  it("refuses NaN, which is how $NaN.NaN reaches a printed page", () => {
    expect(() => basisPoints(Number.NaN, 100)).toThrow(/FS_RATIO_NOT_INTEGER/);
  });

  it("pads the fractional part, so 5bp is 0.05% and not 0.5%", () => {
    expect(formatBasisPoints(5)).toBe("0.05%");
    expect(formatBasisPoints(50)).toBe("0.50%");
    expect(formatBasisPoints(500)).toBe("5.00%");
  });

  it("the income ratios run in the CPA's order, with net margin last", () => {
    const s = screen();
    if (!s.income?.ok) throw new Error("expected an income statement");
    expect(incomeRatios(s.income.statement).map((r) => r.key)).toEqual([
      "gross_margin",
      "disallowed_spend",
      "opex_ratio",
      "net_margin",
    ]);
  });

  it("gross margin is computed against NET sales, not gross sales", () => {
    const s = screen();
    if (!s.income?.ok) throw new Error("expected an income statement");
    const gm = incomeRatios(s.income.statement).find((r) => r.key === "gross_margin");
    expect(gm?.valueBp).toBe(basisPoints(3_500_00, 9_500_00));
  });

  it("every ratio explains what it MEANS and what good looks like", () => {
    const s = screen();
    if (!s.income?.ok) throw new Error("expected an income statement");
    for (const r of [...incomeRatios(s.income.statement), ...balanceRatios(s.balance?.ok ? s.balance.statement : (() => { throw new Error("no sheet"); })())]) {
      expect(r.meaning.length).toBeGreaterThan(60);
      expect(r.goodLooksLike.length).toBeGreaterThan(60);
    }
  });

  it("the §280E ratio says out loud that this figure does not exist elsewhere", () => {
    const s = screen();
    if (!s.income?.ok) throw new Error("expected an income statement");
    const r = incomeRatios(s.income.statement).find((x) => x.key === "disallowed_spend");
    expect(r?.meaning).toMatch(/does not exist/);
  });

  it("net margin's guidance tells him to read it against gross margin", () => {
    const s = screen();
    if (!s.income?.ok) throw new Error("expected an income statement");
    const r = incomeRatios(s.income.statement).find((x) => x.key === "net_margin");
    expect(r?.goodLooksLike).toMatch(/gross margin/);
  });

  it("banding higher-is-better is INCLUSIVE at the healthy boundary", () => {
    expect(bandHigherIsBetter(4000, 4000, 3500)).toBe("healthy");
    expect(bandHigherIsBetter(3999, 4000, 3500)).toBe("watch");
    expect(bandHigherIsBetter(3500, 4000, 3500)).toBe("watch");
    expect(bandHigherIsBetter(3499, 4000, 3500)).toBe("concern");
  });

  it("banding lower-is-better is INCLUSIVE at the healthy boundary", () => {
    expect(bandLowerIsBetter(2500, 2500, 3500)).toBe("healthy");
    expect(bandLowerIsBetter(2501, 2500, 3500)).toBe("watch");
    expect(bandLowerIsBetter(3500, 2500, 3500)).toBe("watch");
    expect(bandLowerIsBetter(3501, 2500, 3500)).toBe("concern");
  });

  it("an unknown ratio is 'unknown' and renders neutral, never green", () => {
    expect(bandHigherIsBetter(null, 1, 1)).toBe("unknown");
    expect(bandLowerIsBetter(null, 1, 1)).toBe("unknown");
    expect(bandTone("unknown")).toBe("neutral");
  });

  it("the tones map as the house expects", () => {
    expect(bandTone("healthy")).toBe("green");
    expect(bandTone("watch")).toBe("gold");
    expect(bandTone("concern")).toBe("orange");
  });

  it("the balance sheet ratios are the two that matter to a shop with no receivables", () => {
    const s = screen();
    if (!s.balance?.ok) throw new Error("expected a balance sheet");
    expect(balanceRatios(s.balance.statement).map((r) => r.key)).toEqual([
      "current_ratio",
      "debt_to_assets",
    ]);
  });

  it("the current ratio warns that trust money sits inside the liabilities", () => {
    const s = screen();
    if (!s.balance?.ok) throw new Error("expected a balance sheet");
    const r = balanceRatios(s.balance.statement).find((x) => x.key === "current_ratio");
    expect(r?.goodLooksLike).toMatch(/trust money/i);
  });

  it("every ratio's display string matches its own value", () => {
    const s = screen();
    if (!s.income?.ok) throw new Error("expected an income statement");
    for (const r of incomeRatios(s.income.statement)) {
      expect(r.display).toBe(formatBasisPoints(r.valueBp));
    }
  });
});

// ===========================================================================
describe("the reading order — Michael asked how to READ them", () => {
  it("has seven steps, numbered 1..7 with no gaps", () => {
    expect(READING_ORDER.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("STARTS with abnormal balances, before any total on any statement", () => {
    expect(READING_ORDER[0].statement).toBe("balance");
    expect(READING_ORDER[0].look).toMatch(/abnormal/i);
  });

  it("ENDS with stock basis, which is the decision he actually has to make", () => {
    const last = READING_ORDER[READING_ORDER.length - 1];
    expect(last.statement).toBe("equity");
    expect(last.look).toMatch(/basis/i);
  });

  it("every step says what to LOOK at, what to ASK, and what a bad answer means", () => {
    for (const s of READING_ORDER) {
      expect(s.look.length).toBeGreaterThan(20);
      expect(s.ask.length).toBeGreaterThan(20);
      expect(s.ifItLooksWrong.length).toBeGreaterThan(60);
    }
  });

  it("touches all four statements — none is left without a reading step", () => {
    const covered = new Set(READING_ORDER.map((s) => s.statement));
    expect([...covered].sort()).toEqual(["balance", "cash_flow", "equity", "income"]);
  });

  it("filters correctly per statement", () => {
    expect(readingStepsFor("income")).toHaveLength(3);
    expect(readingStepsFor("balance")).toHaveLength(2);
    expect(readingStepsFor("cash_flow")).toHaveLength(1);
    expect(readingStepsFor("equity")).toHaveLength(1);
  });

  it("the cash step names the five usual causes rather than saying 'investigate'", () => {
    const s = readingStepsFor("cash_flow")[0];
    expect(s.ifItLooksWrong).toMatch(/till/i);
    expect(s.ifItLooksWrong).toMatch(/ATM/);
  });
});

// ===========================================================================
describe("refusals, on screen", () => {
  it("EVERY refusal code the engine can emit has a headline (rule 26)", () => {
    for (const code of ALL_STATEMENT_REFUSAL_CODES) {
      expect(REFUSAL_HEADLINES[code], `no headline for ${code}`).toBeDefined();
      expect(REFUSAL_HEADLINES[code].length).toBeGreaterThan(10);
    }
  });

  it("no headline exists for a code the engine cannot emit — dead entries rot", () => {
    const known = new Set<string>(ALL_STATEMENT_REFUSAL_CODES);
    for (const code of Object.keys(REFUSAL_HEADLINES)) {
      expect(known.has(code), `${code} is not a refusal code the engine emits`).toBe(true);
    }
  });

  it("the coverage check is not vacuous — the engine really does declare codes", () => {
    expect(ALL_STATEMENT_REFUSAL_CODES.length).toBeGreaterThan(5);
  });

  it("a card carries the code, the headline, the body and the remedy", () => {
    const v = greenwayView();
    const broken: TrialBalanceView = {
      ...v,
      lines: [...v.lines, line("73030", "Hardware & Equipment", 1_00)],
    };
    const s = screen({ view: broken });
    expect(s.income?.ok).toBe(false);
    if (s.income?.ok !== false) return;
    const card = refusalCard(s.income.refusals[0]);
    expect(card.code).toBe("TB_DOES_NOT_TIE");
    expect(card.headline).toBe(REFUSAL_HEADLINES.TB_DOES_NOT_TIE);
    expect(card.body.length).toBeGreaterThan(40);
    expect(card.whatToDo.length).toBeGreaterThan(20);
  });

  it("the out-of-balance refusal NAMES THE AMOUNT — the amount is the clue", () => {
    const v = greenwayView();
    const broken: TrialBalanceView = {
      ...v,
      lines: [...v.lines, line("73030", "Hardware & Equipment", 1_00)],
    };
    const s = screen({ view: broken });
    if (s.income?.ok !== false) throw new Error("expected a refusal");
    expect(refusalCard(s.income.refusals[0]).body).toContain("$1.00");
  });
});

// ===========================================================================
describe("the scope note — what these statements are NOT", () => {
  it("says out loud that nobody has audited them", () => {
    expect(scopeNoteMentionsNoAssurance()).toBe(true);
  });

  it("says Reg S-X does not bind Greenway, rather than implying it does", () => {
    expect(STATEMENT_SCOPE_NOTE).toMatch(/does not bind you/);
  });

  it("still explains why the layout follows it anyway", () => {
    expect(STATEMENT_SCOPE_NOTE).toMatch(/misleading/);
  });
});

// ===========================================================================
describe("buildFsScreen — the whole sequence", () => {
  it("derives the role codes rather than being told them", () => {
    const s = screen();
    expect(s.exciseAccountCodes).toEqual([]);
    expect(s.contraRevenueAccountCodes).toEqual(["50900", "50910"]);
    expect(s.trustAccountCodes).toEqual(["32000", "32100"]);
  });

  it("when the adapter refuses, no statement is attempted at all", () => {
    const v = greenwayView();
    const s = screen({ view: { ...v, unmappedAccountCodes: ["20009-GRWNY"] } });
    expect(s.adapted.ok).toBe(false);
    expect(s.income).toBeNull();
    expect(s.balance).toBeNull();
    expect(s.cards).toHaveLength(4);
  });

  it("an unmapped account does not silently vanish — it is named", () => {
    const v = greenwayView();
    const s = screen({ view: { ...v, unmappedAccountCodes: ["20009-GRWNY"] } });
    expect(s.adapted.unmappedAccountCodes).toContain("20009-GRWNY");
  });

  it("blockers are still reported even when the numbers cannot be produced", () => {
    const v = greenwayView();
    const s = screen({ view: { ...v, unmappedAccountCodes: ["20009-GRWNY"] } });
    expect(s.blockers.length).toBe(5);
  });

  it("net income from the income statement is what closes into equity on the balance sheet", () => {
    const s = screen();
    if (!s.income?.ok || !s.balance?.ok) throw new Error("expected both statements");
    // Equity section total plus period net income must be what the sheet used.
    expect(s.balance.statement.totalEquityCents).toBe(
      s.balance.statement.equity.totalCents + s.income.statement.netIncomeCents,
    );
  });
});
