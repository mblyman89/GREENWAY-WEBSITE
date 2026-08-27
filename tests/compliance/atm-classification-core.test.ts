/**
 * tests/compliance/atm-classification-core.test.ts   (books-69 step 4)
 *
 * THE PROMISE UNDER TEST, in Michael's own words:
 *
 *     "My plan is to switch to paying vendors from the atm account starting on
 *      November 1st. I will begin paying employees via the atm account on
 *      January 1st."
 *
 *     "Even after the start of the new year though, I don't know exactly how
 *      the cash flow will work, so we will need a system that allows
 *      flexibility."
 *
 * and the recon report's answer to it:
 *
 *     "A transaction gets classified by the rule that was in force on its own
 *      date, never by today's rules. If your CPA re-runs last March in two
 *      years' time, he gets last March's answer."
 *
 * Every test below is named for the RISK it retires, not for the function it
 * calls (rule 129), so a failure line says what broke rather than what ran.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultCostClass } from "@/lib/accounting/coa-core";
import { AUTOPOSTABLE_SOURCE_KINDS, NEVER_AUTOPOST_REASONS } from "@/lib/accounting/posting-core";
import {
  ACCOUNT_ATM_VAULT,
  ACCOUNT_BANK_FEES,
  ACCOUNT_PROCESSING_FEES,
  ATM_CLASSIFICATION_NOTICES,
  ATM_CLASSIFICATION_REGISTRY,
  ATM_CLASSIFICATION_RULES,
  ATM_EXPENSE_COST_CLASS,
  CLASSIFICATION_SOURCE_KIND,
  ClassificationRegistry,
  DESC_ACCOUNT_ANALYSIS,
  DESC_DLY_SETTLE,
  DESC_EFTRANSACT,
  EVIDENCE_OPENS_ON,
  PAYROLL_SWITCH_DATE,
  VENDOR_SWITCH_DATE,
  classificationMessage,
  classifyAtmDebit,
  classifyAtmDebits,
  findRuleGaps,
  findRuleOverlaps,
  proposalBalanceCents,
  summariseClassification,
  validateClassificationRule,
  type ClassificationFacts,
  type ClassificationRule,
} from "@/lib/atm/atm-classification-core";
import { BANK_ATM, BANK_CANNABIS, BANK_PERSONAL } from "@/lib/atm/atm-sweep-core";

/* ── The real rows, verbatim from the Timberland statement ────────────────── */

const ANALYSIS_2026_07_31: ClassificationFacts = {
  processedDate: "2026-07-31",
  description: DESC_ACCOUNT_ANALYSIS,
  amountCents: 772,
  creditOrDebit: "Debit",
};
const ANALYSIS_2026_06_30: ClassificationFacts = {
  processedDate: "2026-06-30",
  description: DESC_ACCOUNT_ANALYSIS,
  amountCents: 792,
  creditOrDebit: "Debit",
};
const ANALYSIS_2026_05_29: ClassificationFacts = {
  processedDate: "2026-05-29",
  description: DESC_ACCOUNT_ANALYSIS,
  amountCents: 774,
  creditOrDebit: "Debit",
};
const EFTRANSACT_2026_07_07: ClassificationFacts = {
  processedDate: "2026-07-07",
  description: DESC_EFTRANSACT,
  amountCents: 185,
  creditOrDebit: "Debit",
};
const REVERSAL_2026_06_29: ClassificationFacts = {
  processedDate: "2026-06-29",
  description: DESC_DLY_SETTLE,
  amountCents: 10000,
  creditOrDebit: "Debit",
};
const SWEEP_2026_08_21: ClassificationFacts = {
  processedDate: "2026-08-21",
  description: `TRANSFER FROM X${BANK_ATM} TO X${BANK_CANNABIS}`,
  amountCents: 1142750,
  creditOrDebit: "Debit",
};
const PERSONAL_2026_07_03: ClassificationFacts = {
  processedDate: "2026-07-03",
  description: `TRANSFER FROM X${BANK_ATM} TO X${BANK_PERSONAL}`,
  amountCents: 524250,
  creditOrDebit: "Debit",
};

/** Every distinct DEBIT description in the measured statement. */
const MEASURED_POPULATION: readonly ClassificationFacts[] = [
  ANALYSIS_2026_05_29,
  ANALYSIS_2026_06_30,
  ANALYSIS_2026_07_31,
  EFTRANSACT_2026_07_07,
  REVERSAL_2026_06_29,
  SWEEP_2026_08_21,
  PERSONAL_2026_07_03,
];

const rule = (over: Partial<ClassificationRule> = {}): ClassificationRule => ({
  key: "t.rule",
  matchKind: "description_exact",
  matchValue: "WIDGET FEE",
  effectiveFrom: "2026-05-01",
  effectiveTo: null,
  treatment: "atm_expense",
  debitAccountCode: ACCOUNT_BANK_FEES,
  entityCode: "atm",
  note: "A note.",
  evidence: "A measured row.",
  ...over,
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. THE REAL STATEMENT ROWS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the four real costs that had never reached the books", () => {
  it("classifies the 2026-07-31 account analysis charge of $7.72 to bank fees", () => {
    const p = classifyAtmDebit(ANALYSIS_2026_07_31);
    expect(p.outcome).toBe("classified");
    expect(p.lines[0]?.accountCode).toBe(ACCOUNT_BANK_FEES);
    expect(p.lines[0]?.amountCents).toBe(772);
  });

  it("classifies the 2026-06-30 charge of $7.92, so the rule is not date-specific", () => {
    const p = classifyAtmDebit(ANALYSIS_2026_06_30);
    expect(p.outcome).toBe("classified");
    expect(p.lines[0]?.amountCents).toBe(792);
  });

  it("classifies the 2026-05-29 charge of $7.74 on the first day evidence opens", () => {
    const p = classifyAtmDebit(ANALYSIS_2026_05_29);
    expect(p.outcome).toBe("classified");
    expect(p.lines[0]?.amountCents).toBe(774);
  });

  it("sends the processor debit to 76050 and not to the bank-fee account", () => {
    const p = classifyAtmDebit(EFTRANSACT_2026_07_07);
    expect(p.outcome).toBe("classified");
    expect(p.lines[0]?.accountCode).toBe(ACCOUNT_PROCESSING_FEES);
    expect(p.lines[0]?.accountCode).not.toBe(ACCOUNT_BANK_FEES);
  });

  it("credits the ATM vault account, because that is where the money left from", () => {
    const p = classifyAtmDebit(ANALYSIS_2026_07_31);
    expect(p.lines[1]?.accountCode).toBe(ACCOUNT_ATM_VAULT);
    expect(p.lines[1]?.amountCents).toBe(-772);
  });

  it("proposes an entry that balances to exactly zero", () => {
    for (const f of [ANALYSIS_2026_07_31, EFTRANSACT_2026_07_07]) {
      expect(proposalBalanceCents(classifyAtmDebit(f))).toBe(0);
    }
  });

  it("totals the four real costs at $25.23, the figure that was missing from the ATM entity", () => {
    const s = summariseClassification(
      classifyAtmDebits([
        ANALYSIS_2026_05_29,
        ANALYSIS_2026_06_30,
        ANALYSIS_2026_07_31,
        EFTRANSACT_2026_07_07,
      ]),
    );
    expect(s.classified).toBe(4);
    expect(s.classifiedCents).toBe(2523);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. THE 280E POINT — THE REASON THE ENTITY MATTERS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("an ATM cost is deductible, and the cost class has to say so", () => {
  it("tags the expense line separate_business, not nondeductible_280e", () => {
    const p = classifyAtmDebit(ANALYSIS_2026_07_31);
    expect(p.lines[0]?.costClass).toBe("separate_business");
    expect(p.lines[0]?.costClass).not.toBe("nondeductible_280e");
  });

  it("agrees with coa-core's defaultCostClass rather than hard-coding a guess", () => {
    // 76040 is seeded default nondeductible_280e because the chart is written
    // greenway-first. The ENTITY is what makes it deductible, and this proves
    // the two sources cannot drift apart.
    expect(ATM_EXPENSE_COST_CLASS).toBe(defaultCostClass("expense", "atm"));
  });

  it("puts no cost class on the bank line, because balance-sheet lines carry none", () => {
    const p = classifyAtmDebit(ANALYSIS_2026_07_31);
    expect(p.lines[1]?.costClass).toBe("none");
  });

  it("books every cost to the atm entity, never to greenway", () => {
    for (const f of MEASURED_POPULATION) {
      expect(classifyAtmDebit(f).entityCode).toBe("atm");
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. THE $100.00 THAT WOULD HAVE BEEN COUNTED TWICE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the settlement reversal is not a cost", () => {
  it("reports the 2026-06-29 $100.00 debit as already accounted, not as an expense", () => {
    const p = classifyAtmDebit(REVERSAL_2026_06_29);
    expect(p.outcome).toBe("already_accounted");
    expect(p.outcome).not.toBe("classified");
  });

  it("proposes no lines at all, so the same $100.00 cannot be recorded twice", () => {
    expect(classifyAtmDebit(REVERSAL_2026_06_29).lines).toHaveLength(0);
  });

  it("explains that booking it again would double-count", () => {
    expect(classifyAtmDebit(REVERSAL_2026_06_29).refusal).toContain("twice");
  });

  it("names the rule that made the decision, so the reasoning is auditable", () => {
    expect(classifyAtmDebit(REVERSAL_2026_06_29).appliedRule?.key).toBe("atm.settlement-reversal");
  });

  it("records the traced evidence, not a pattern guess about the description", () => {
    const r = ATM_CLASSIFICATION_RULES.find((x) => x.key === "atm.settlement-reversal");
    expect(r?.evidence).toContain("2026-06-27");
    expect(r?.evidence).toContain("2026-06-29");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. EFFECTIVE DATING — THE WHOLE POINT
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("a transaction is classified by the rule in force on its own date", () => {
  const dated = ClassificationRegistry.create([
    rule({ key: "t.old", effectiveFrom: "2026-05-01", effectiveTo: "2026-10-31" }),
    rule({
      key: "t.new",
      effectiveFrom: "2026-11-01",
      effectiveTo: null,
      debitAccountCode: ACCOUNT_PROCESSING_FEES,
    }),
  ]);
  const row: ClassificationFacts = {
    processedDate: "2026-10-31",
    description: "WIDGET FEE",
    amountCents: 500,
    creditOrDebit: "Debit",
  };

  it("still gives October's answer for an October row after November's rule exists", () => {
    expect(classifyAtmDebit(row, dated).lines[0]?.accountCode).toBe(ACCOUNT_BANK_FEES);
  });

  it("gives November's answer for a November row", () => {
    const p = classifyAtmDebit({ ...row, processedDate: "2026-11-01" }, dated);
    expect(p.lines[0]?.accountCode).toBe(ACCOUNT_PROCESSING_FEES);
  });

  it("switches on the boundary day itself, not the day after", () => {
    expect(classifyAtmDebit({ ...row, processedDate: "2026-10-31" }, dated).appliedRule?.key).toBe("t.old");
    expect(classifyAtmDebit({ ...row, processedDate: "2026-11-01" }, dated).appliedRule?.key).toBe("t.new");
  });

  it("treats effectiveTo as INCLUSIVE, so the last day of the old rule is covered", () => {
    // If effectiveTo were exclusive, 2026-10-31 would fall into the gap and
    // refuse. That is the one-day-a-year bug this asserts against.
    expect(classifyAtmDebit({ ...row, processedDate: "2026-10-31" }, dated).outcome).toBe("classified");
  });

  it("refuses a date before any rule instead of reaching for the earliest one", () => {
    const p = classifyAtmDebit({ ...row, processedDate: "2026-04-30" }, dated);
    expect(p.outcome).toBe("no_rule_for_date");
    expect(p.lines).toHaveLength(0);
  });

  it("tells Michael which periods ARE covered when it refuses", () => {
    const p = classifyAtmDebit({ ...row, processedDate: "2026-04-30" }, dated);
    expect(p.refusal).toContain("2026-05-01");
    expect(p.refusal).toContain("2026-10-31");
  });

  it("keeps the full history of a matcher, oldest first, as the audit trail", () => {
    const h = dated.history("WIDGET FEE");
    expect(h.map((r) => r.key)).toEqual(["t.old", "t.new"]);
  });

  it("has no current() or latest() escape hatch on the registry", () => {
    const anyReg = dated as unknown as Record<string, unknown>;
    expect(typeof anyReg.current).toBe("undefined");
    expect(typeof anyReg.latest).toBe("undefined");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. THE TABLE REFUSES TO BE BUILT WRONG
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("a rule table that could give two answers is refused at construction", () => {
  it("throws when an open-ended rule is followed by a later rule for the same matcher", () => {
    expect(() =>
      ClassificationRegistry.create([
        rule({ key: "a", effectiveFrom: "2026-05-01", effectiveTo: null }),
        rule({ key: "b", effectiveFrom: "2026-11-01", effectiveTo: null }),
      ]),
    ).toThrow(/never ends/);
  });

  it("throws when two closed ranges overlap by a single day", () => {
    expect(() =>
      ClassificationRegistry.create([
        rule({ key: "a", effectiveFrom: "2026-05-01", effectiveTo: "2026-11-01" }),
        rule({ key: "b", effectiveFrom: "2026-11-01", effectiveTo: "2026-12-31" }),
      ]),
    ).toThrow(/overlaps/);
  });

  it("allows two ranges that touch without overlapping", () => {
    expect(() =>
      ClassificationRegistry.create([
        rule({ key: "a", effectiveFrom: "2026-05-01", effectiveTo: "2026-10-31" }),
        rule({ key: "b", effectiveFrom: "2026-11-01", effectiveTo: null }),
      ]),
    ).not.toThrow();
  });

  it("does not call it an overlap when the same text applies to two different entities", () => {
    expect(() =>
      ClassificationRegistry.create([
        rule({ key: "a", entityCode: "atm", effectiveTo: null }),
        rule({ key: "b", entityCode: "greenway", effectiveTo: null }),
      ]),
    ).not.toThrow();
  });

  it("throws on a duplicate rule key, which would make the audit trail ambiguous", () => {
    expect(() =>
      ClassificationRegistry.create([
        rule({ key: "same", matchValue: "A", effectiveTo: null }),
        rule({ key: "same", matchValue: "B", effectiveTo: null }),
      ]),
    ).toThrow(/duplicate rule key/);
  });

  it("finds no overlap in the real shipped rule table", () => {
    expect(findRuleOverlaps(ATM_CLASSIFICATION_RULES)).toEqual([]);
  });
});

describe("a gap is shown to Michael but does not break the table", () => {
  // This is the one deliberate divergence from PayrollRateRegistry, where a
  // gap is a hard error. Here a gap is correct: there is genuinely no
  // vendor-payment rule before November.
  //
  // Built inside a FUNCTION, not as a `const` in the describe body. A const is
  // evaluated at COLLECTION time, so a build that treated a gap as fatal would
  // throw before a single test ran and vitest would report "no tests" - a pass
  // by absence, naming no risk at all. Deferring the call means the named
  // assertion below is what fails (rule 129).
  const makeGapped = (): ClassificationRegistry =>
    ClassificationRegistry.create([
      rule({ key: "a", effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31" }),
      rule({ key: "b", effectiveFrom: "2026-07-01", effectiveTo: null }),
    ]);

  it("builds successfully despite an uncovered June", () => {
    // If a gap were a hard error - PayrollRateRegistry's rule, borrowed without
    // thinking - then the CORRECT table would be the one that cannot be built.
    // Michael genuinely has no vendor-payment rule before November 1st.
    expect(() => makeGapped()).not.toThrow();
    expect(makeGapped().all()).toHaveLength(2);
  });

  it("reports the uncovered stretch with real calendar dates", () => {
    const gaps = findRuleGaps(makeGapped().all());
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("2026-06-01");
    expect(gaps[0]).toContain("2026-06-30");
  });

  it("refuses a transaction inside the gap rather than borrowing a neighbouring rule", () => {
    const p = classifyAtmDebit(
      { processedDate: "2026-06-15", description: "WIDGET FEE", amountCents: 500, creditOrDebit: "Debit" },
      makeGapped(),
    );
    expect(p.outcome).toBe("no_rule_for_date");
  });

  it("reports no gap for the real shipped rule table", () => {
    expect(findRuleGaps(ATM_CLASSIFICATION_RULES)).toEqual([]);
  });
});

describe("a malformed rule is refused with the reason", () => {
  it("refuses an impossible calendar date", () => {
    expect(validateClassificationRule(rule({ effectiveFrom: "2026-02-30" }))).toContain("not a real");
  });

  it("refuses an end date before the start date", () => {
    expect(
      validateClassificationRule(rule({ effectiveFrom: "2026-11-01", effectiveTo: "2026-05-01" })),
    ).toContain("before");
  });

  it("refuses a blank matcher, which would match every transaction", () => {
    expect(validateClassificationRule(rule({ matchValue: "   " }))).toContain("blank");
  });

  it("refuses an expense rule with no account to debit", () => {
    expect(validateClassificationRule(rule({ debitAccountCode: null }))).toContain("account");
  });

  it("refuses an already-accounted rule that carries an account anyway", () => {
    expect(
      validateClassificationRule(
        rule({ treatment: "already_accounted", debitAccountCode: ACCOUNT_BANK_FEES }),
      ),
    ).not.toBeNull();
  });

  it("refuses a rule with no evidence, because that is a guess with a start date", () => {
    expect(validateClassificationRule(rule({ evidence: "  " }))).toContain("evidence");
  });

  it("accepts every rule in the real shipped table", () => {
    for (const r of ATM_CLASSIFICATION_RULES) {
      expect(validateClassificationRule(r)).toBeNull();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. MICHAEL'S TWO DATES ARE NOTICES, NOT INVENTED RULES
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the November and January dates are recorded without being guessed at", () => {
  it("uses the dates Michael actually gave", () => {
    expect(VENDOR_SWITCH_DATE).toBe("2026-11-01");
    expect(PAYROLL_SWITCH_DATE).toBe("2027-01-01");
  });

  it("has NOT invented a vendor-payment rule, because the treatment is undecided", () => {
    const invented = ATM_CLASSIFICATION_RULES.filter(
      (r) => r.effectiveFrom === VENDOR_SWITCH_DATE || r.effectiveFrom === PAYROLL_SWITCH_DATE,
    );
    expect(invented).toEqual([]);
  });

  it("still refuses an unknown November debit rather than guessing a vendor account", () => {
    const p = classifyAtmDebit({
      processedDate: "2026-11-15",
      description: "SOME VENDOR ACH",
      amountCents: 250000,
      creditOrDebit: "Debit",
    });
    expect(p.outcome).toBe("no_rule_for_date");
    expect(p.lines).toHaveLength(0);
  });

  it("attaches the November notice to that refusal, so the screen has context", () => {
    const p = classifyAtmDebit({
      processedDate: "2026-11-15",
      description: "SOME VENDOR ACH",
      amountCents: 250000,
      creditOrDebit: "Debit",
    });
    expect(p.notices.map((n) => n.key)).toContain("notice.vendor-payments-from-atm");
  });

  it("names the real decision still needed — 36000 or capital — in the refusal", () => {
    const p = classifyAtmDebit({
      processedDate: "2026-11-15",
      description: "SOME VENDOR ACH",
      amountCents: 250000,
      creditOrDebit: "Debit",
    });
    expect(p.refusal).toContain("36000");
  });

  it("does NOT apply the November notice on October 31st", () => {
    const p = classifyAtmDebit({
      processedDate: "2026-10-31",
      description: "SOME VENDOR ACH",
      amountCents: 250000,
      creditOrDebit: "Debit",
    });
    expect(p.notices).toHaveLength(0);
  });

  it("has both notices in force on January 1st", () => {
    const p = classifyAtmDebit({
      processedDate: "2027-01-01",
      description: "SOME PAYROLL ACH",
      amountCents: 250000,
      creditOrDebit: "Debit",
    });
    expect(p.notices).toHaveLength(2);
  });

  it("says payroll must route to the payroll run, because 31000 is a control account", () => {
    const n = ATM_CLASSIFICATION_NOTICES.find((x) => x.key === "notice.payroll-from-atm");
    expect(n?.whatIsStillNeeded).toContain("31000");
    expect(n?.whatIsStillNeeded).toContain("CONTROL");
  });

  it("gives every notice a concrete next step, never just a warning", () => {
    for (const n of ATM_CLASSIFICATION_NOTICES) {
      expect(n.whatIsStillNeeded.trim().length).toBeGreaterThan(20);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. NOTHING POSTS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("nothing this module produces can post itself", () => {
  it("returns postable false on every outcome, including the successful ones", () => {
    for (const f of MEASURED_POPULATION) {
      expect(classifyAtmDebit(f).postable).toBe(false);
    }
  });

  it("shows the ledger's own reason rather than a paraphrase of it", () => {
    expect(classifyAtmDebit(ANALYSIS_2026_07_31).whyNotAutomatic).toBe(NEVER_AUTOPOST_REASONS.atm);
  });

  it("uses a source kind that is not on the autopostable list", () => {
    expect(AUTOPOSTABLE_SOURCE_KINDS).not.toContain(CLASSIFICATION_SOURCE_KIND);
  });

  it("does not use the manual source kind, which Postgres would reject on the 10300 line", () => {
    // Migration 0172 guard (6): a source_kind='manual' journal touching a
    // control account raises GL_CONTROL_ACCOUNT. 10300 is is_control. No pure
    // test could ever see that failure, so the invariant is asserted here.
    expect(CLASSIFICATION_SOURCE_KIND).not.toBe("manual");
    expect(CLASSIFICATION_SOURCE_KIND).toBe("atm");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8. A BAD ROW IS SHOWN, NEVER DROPPED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("an unreadable row is refused with a reason and kept", () => {
  it("refuses money arriving in the ATM account, which is settlement income", () => {
    const p = classifyAtmDebit({ ...ANALYSIS_2026_07_31, creditOrDebit: "Credit" });
    expect(p.outcome).toBe("not_classifiable");
    expect(p.refusal).toContain("INTO");
  });

  it("refuses a zero amount", () => {
    expect(classifyAtmDebit({ ...ANALYSIS_2026_07_31, amountCents: 0 }).outcome).toBe("not_classifiable");
  });

  it("refuses February 30th rather than rolling it into March", () => {
    expect(classifyAtmDebit({ ...ANALYSIS_2026_07_31, processedDate: "2026-02-30" }).outcome).toBe(
      "not_classifiable",
    );
  });

  it("refuses a fractional amount that the ledger could not hold exactly", () => {
    expect(classifyAtmDebit({ ...ANALYSIS_2026_07_31, amountCents: 772.5 }).outcome).toBe(
      "not_classifiable",
    );
  });

  it("refuses a blank description rather than matching something", () => {
    expect(classifyAtmDebit({ ...ANALYSIS_2026_07_31, description: "   " }).outcome).toBe(
      "not_classifiable",
    );
  });

  it("keeps every row handed in, so the count out equals the count in", () => {
    const rows = [...MEASURED_POPULATION, { ...ANALYSIS_2026_07_31, amountCents: 0 }];
    expect(classifyAtmDebits(rows)).toHaveLength(rows.length);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9. THE MEASURED POPULATION IS FULLY COVERED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every debit shape in the real statement has a home", () => {
  it("leaves nothing needing a rule across all seven measured rows", () => {
    const s = summariseClassification(classifyAtmDebits(MEASURED_POPULATION));
    expect(s.needsRule).toBe(0);
  });

  it("leaves nothing unreadable across all seven measured rows", () => {
    const s = summariseClassification(classifyAtmDebits(MEASURED_POPULATION));
    expect(s.notClassifiable).toBe(0);
  });

  it("hands the sweep to 6048 back to the sweep path instead of expensing it", () => {
    const p = classifyAtmDebit(SWEEP_2026_08_21);
    expect(p.outcome).toBe("already_accounted");
    expect(p.lines).toHaveLength(0);
  });

  it("does NOT raise a false alarm on the $5,242.50 personal transfer", () => {
    // Reported as "needs a rule" in the first walk of the population. That is
    // a false alarm 208 times larger than the four genuine costs put together,
    // and it would have dominated the screen while needing nothing at all.
    const p = classifyAtmDebit(PERSONAL_2026_07_03);
    expect(p.outcome).toBe("already_accounted");
    expect(p.outcome).not.toBe("no_rule_for_date");
  });

  it("proposes no entry for the personal transfer, so 41000 cannot be doubled", () => {
    expect(classifyAtmDebit(PERSONAL_2026_07_03).lines).toHaveLength(0);
  });

  it("dates every shipped rule from the first day of evidence, never earlier", () => {
    for (const r of ATM_CLASSIFICATION_RULES) {
      expect(r.effectiveFrom).toBe(EVIDENCE_OPENS_ON);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 10. MATCHING, AND THE SENTENCE MICHAEL READS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("matching is exact, but tolerant of how banks export text", () => {
  it("matches regardless of case and surrounding whitespace", () => {
    expect(
      ATM_CLASSIFICATION_REGISTRY.lookup("  account analysis charge ", "2026-07-31", "atm"),
    ).not.toBeNull();
  });

  it("does not fire on a prefix of the description", () => {
    expect(ATM_CLASSIFICATION_REGISTRY.lookup("ACCOUNT ANALYSIS", "2026-07-31", "atm")).toBeNull();
  });

  it("does not fire on a longer description that contains it", () => {
    expect(
      ATM_CLASSIFICATION_REGISTRY.lookup("ACCOUNT ANALYSIS CHARGE REVERSAL", "2026-07-31", "atm"),
    ).toBeNull();
  });

  it("does not apply an ATM rule to the store's books", () => {
    expect(ATM_CLASSIFICATION_REGISTRY.lookup(DESC_ACCOUNT_ANALYSIS, "2026-07-31", "greenway")).toBeNull();
  });

  it("returns nothing for a malformed date rather than the first row in the table", () => {
    expect(ATM_CLASSIFICATION_REGISTRY.lookup(DESC_ACCOUNT_ANALYSIS, "not-a-date", "atm")).toBeNull();
  });
});

describe("the sentence Michael reads", () => {
  it("states the money as well as the count", () => {
    const s = summariseClassification(
      classifyAtmDebits([ANALYSIS_2026_07_31, EFTRANSACT_2026_07_07]),
    );
    expect(classificationMessage(s)).toContain("$9.57");
  });

  it("never prints money as $- for a negative", () => {
    const s = summariseClassification(classifyAtmDebits(MEASURED_POPULATION));
    expect(classificationMessage(s)).not.toContain("$-");
  });

  it("separates costs from movements already recorded elsewhere", () => {
    const msg = classificationMessage(summariseClassification(classifyAtmDebits(MEASURED_POPULATION)));
    expect(msg).toContain("ready for your approval");
    expect(msg).toContain("already recorded elsewhere");
  });

  it("says something honest when there is nothing to report", () => {
    expect(classificationMessage(summariseClassification([]))).toContain("No money left");
  });

  it("uses the singular for one item and the plural for several", () => {
    const one = summariseClassification(classifyAtmDebits([ANALYSIS_2026_07_31]));
    expect(classificationMessage(one)).toContain("1 cost");
    const many = summariseClassification(
      classifyAtmDebits([ANALYSIS_2026_07_31, ANALYSIS_2026_06_30]),
    );
    expect(classificationMessage(many)).toContain("2 costs");
  });
});

// ===========================================================================
// THE CORE IS REACHABLE FROM THE STORE
//
// The books-69 recon's entire finding was that the ATM subsystem LOOKED wired
// to the ledger and was not. A classifier with 76 green tests that no screen
// ever calls would reproduce that exact situation with better paperwork
// attached - standing rule 50, dead code wearing a green check.
//
// `atm/store.ts` is `server-only` and cannot be imported into a unit suite, so
// its source is read. That is weaker than calling the function and is chosen
// knowingly: the alternative is a live database in the unit suite.
// ===========================================================================

describe("the classifier is reachable from the store", () => {
  const storeSrc = readFileSync(
    join(__dirname, "..", "..", "src", "lib", "atm", "store.ts"),
    "utf8",
  );

  it("the store imports the classifier and exposes the proposals", () => {
    expect(storeSrc).toContain('from "@/lib/atm/atm-classification-core"');
    expect(storeSrc).toContain("export async function listAtmClassificationProposals");
  });

  it("hands the rows to the classifier rather than returning an empty list", () => {
    // A function that compiles, is exported, is imported, and returns [] would
    // pass every assertion above while showing Michael nothing at all.
    expect(storeSrc).toContain("classifyAtmDebits(rows)");
  });

  it("sorts oldest-first, because Plaid returns newest-first", () => {
    expect(storeSrc).toContain("rows.sort(");
  });

  it("offers only debits, because money arriving is not a cost", () => {
    // 229 of the 301 statement rows are settlement CREDITS. Passing those in
    // would bury the four real costs under a wall of refusals.
    expect(storeSrc).toContain("if (t.amountCents <= 0) continue;");
  });
});
