/**
 * tests/compliance/payroll-cogs-core.test.ts   (slice books-04)
 *
 * The SECOND gate over the payroll / employee-as-COGS brain.
 *
 * `payroll-cogs-core.ts` carries its own `__runPayrollCogsCoreTests()`, which
 * the pure self-test runner calls. This file re-runs that suite under vitest
 * AND adds independent assertions that do not exist inside the module.
 *
 * WHY TWO GATES OVER THE SAME CODE
 * A self-test that lives inside the module it tests can be weakened by the very
 * edit that breaks the module — delete a rule and its assertion in one stroke
 * and the suite still passes. The mutation campaign for this slice requires
 * every real mutant to die on BOTH gates; a mutant that dies only in one is a
 * warning that one gate has gone decorative.
 *
 * WHAT IS TESTED HERE THAT IS *NOT* TESTED INSIDE THE MODULE
 *   • SOURCE-LEVEL drift checks that read the file from disk, so a future edit
 *     that silently paraphrases a verbatim statutory quote, deletes a hard
 *     block, or re-points a wage line at the COGS account fails HERE rather
 *     than in front of an examiner.
 *   • CROSS-FILE parity against migration 0173, proving every account code the
 *     module hard-codes for purity is actually seeded in the chart of accounts.
 *   • The slice's central legal promise asserted STRUCTURALLY rather than by
 *     example: for a reseller, no selling labor may reach inventory, for any
 *     input whatsoever.
 *   • Purity and immutability sweeps.
 *
 * THE STAKES (why this file is long)
 * Michael asked, in as many words, for "the ability to assign employees as cogs
 * so I can write them off". Greenway is an I-502 RETAILER, which in tax language
 * makes it a RESELLER, and Reg. §1.471-3(b) — the paragraph that governs
 * resellers — contains no direct-labor clause at all. Three Tax Court cases
 * (Patients Mutual 151 T.C. 176; Alternative Health Care Advocates 151 T.C. 225;
 * Richmond Patients Group T.C. Memo 2020-52) held dispensaries doing far more
 * hands-on work than Greenway to be resellers. Getting this wrong does not
 * produce a rounding error; it produces a disallowed COGS deduction, back tax,
 * interest and penalties on the largest single line of the return.
 *
 * So these tests exist to keep ONE door open — the "necessary charges incurred
 * in acquiring possession of the goods" clause, on evidence — and to keep every
 * other door shut.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  __runPayrollCogsCoreTests,
  PAYROLL_AUTHORITIES,
  PRODUCTION_ACTIVITIES,
  LABOR_ROLES,
  LABOR_DECISION_TREE,
  PAYROLL_HARD_BLOCKS,
  ACQUISITION_LABOR_CEILING_MILLI_PCT,
  ACQUISITION_LABOR_SCRUTINY_MILLI_PCT,
  MIN_SUBSTANTIATION_DAYS,
  WAGE_EXPENSE_ACCOUNT,
  PAYROLL_COGS_ACCOUNT,
  ACCRUED_PAYROLL_ACCOUNT,
  WITHHELD_TAX_ACCOUNT,
  EMPLOYER_TAX_EXPENSE_ACCOUNT,
  EMPLOYER_TAX_PAYABLE_ACCOUNT,
  GARNISHMENT_ACCOUNT,
  EMPLOYEE_ADVANCE_ACCOUNT,
  OPERATING_BANK_ACCOUNT,
  OVERTIME_EXPENSE_ACCOUNT,
  PAID_LEAVE_ACCOUNT,
  findPayrollAuthority,
  findProductionActivity,
  findLaborRole,
  determineCharacter,
  substantiationGaps,
  splitCentsByMilliPct,
  totalAllocationMilliPct,
  acquisitionShareMilliPct,
  evaluatePayrollRun,
  buildPayrollJournal,
  buildPayrollPaymentJournal,
  payrollJournalIsBalanced,
  payrollSourceRef,
  payrollContentFingerprint,
  payrollBars,
  walkLaborDecisionTree,
  formatCents,
  formatMilliPct,
  isValidIsoDate,
  type PayrollRunInput,
  type PayrollEmployeeInput,
  type TimeSubstantiation,
} from "../../src/lib/accounting/payroll-cogs-core";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const SRC_PATH = resolve(__dirname, "../../src/lib/accounting/payroll-cogs-core.ts");
const SRC = readFileSync(SRC_PATH, "utf8");

const COA_PATH = resolve(__dirname, "../../supabase/migrations/0173_chart_of_accounts.sql");
const COA_SQL = readFileSync(COA_PATH, "utf8");

function proof(over: Partial<TimeSubstantiation> = {}): TimeSubstantiation {
  return {
    daysOfRecords: 45,
    contemporaneous: true,
    taskLevelDetail: true,
    tiedToManifests: true,
    documentRef: "ALLOC-2026-11",
    basisNote: "Receiving averaged 38 minutes per delivery across 22 deliveries.",
    approvedBy: "Nicholas Mullan, CPA",
    ...over,
  };
}

function emp(over: Partial<PayrollEmployeeInput> = {}): PayrollEmployeeInput {
  return {
    employeeId: "e1",
    employeeName: "Test Employee",
    grossWagesCents: 160000,
    employeeWithholdingCents: 32000,
    employerTaxCents: 12240,
    netPayCents: 128000,
    allocations: [{ roleCode: "budtender", shareMilliPct: 100000 }],
    ...over,
  };
}

function run(over: Partial<PayrollRunInput> = {}): PayrollRunInput {
  return {
    entityCode: "greenway",
    payDate: "2026-11-13",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-15",
    employees: [emp()],
    activityCodes: ["receive_manifest", "display_sell"],
    substantiation: null,
    ...over,
  };
}

// ===========================================================================
// 1) The module's own suite must pass under vitest too.
// ===========================================================================
describe("payroll-cogs-core embedded self-tests", () => {
  it("passes its own suite", () => {
    expect(() => __runPayrollCogsCoreTests()).not.toThrow();
  });
});

// ===========================================================================
// 2) VERBATIM AUTHORITY — the quotes ARE the product.
// ===========================================================================
describe("verbatim authority text", () => {
  it("keeps the reseller rule word-for-word, including what it does NOT say", () => {
    const r = findPayrollAuthority("REG_1_471_3_B_RESELLER")!;
    expect(r).toBeDefined();
    // The clause that pays for the whole feature.
    expect(r.quote).toContain(
      "transportation or other necessary charges incurred in acquiring possession of the goods",
    );
    // The ABSENCE is the finding: no direct-labor clause for a reseller.
    expect(r.quote).not.toContain("direct labor");
    expect(r.cite).toMatch(/1\.471-3/);
  });

  it("keeps the producer rule word-for-word, including the selling-cost exclusion", () => {
    const c = findPayrollAuthority("REG_1_471_3_C_PRODUCER")!;
    expect(c.quote).toContain("direct labor");
    // This is why budtender wages can never be COGS, even for a grower.
    expect(c.quote).toContain("but not including any cost of selling");
  });

  it("keeps the §263A reseller rule that closes the last escape hatch", () => {
    const a = findPayrollAuthority("REG_1_263A_1_E_2_II_RESELLER")!;
    expect(a.quote).toContain(
      "Resellers must capitalize the acquisition costs of property acquired for resale",
    );
    expect(a.quote).toContain("1.471-3(b)");
  });

  it("keeps §7501's trust language, which is what makes withheld tax not Greenway's money", () => {
    const t = findPayrollAuthority("IRC_7501_TRUST")!;
    expect(t.quote).toContain("special fund in trust for the United States");
  });

  it("keeps §280E itself, and notes it says nothing about cost of goods sold", () => {
    const s = findPayrollAuthority("IRC_280E")!;
    expect(s.quote).toContain("No deduction or credit shall be allowed");
    expect(s.quote).toContain("trafficking in controlled substances");
    // §280E is silent on COGS. That silence is the entire reason COGS survives.
    expect(s.quote.toLowerCase()).not.toContain("cost of goods sold");
  });

  it("gives every authority a citation, a substantive quote, a so-what and a source", () => {
    expect(PAYROLL_AUTHORITIES.length).toBeGreaterThanOrEqual(20);
    for (const a of PAYROLL_AUTHORITIES) {
      expect(a.cite.trim().length, `${a.id} cite`).toBeGreaterThan(0);
      expect(a.quote.trim().length, `${a.id} quote`).toBeGreaterThan(20);
      expect(a.soWhat.trim().length, `${a.id} soWhat`).toBeGreaterThan(20);
      expect(a.source.trim().length, `${a.id} source`).toBeGreaterThan(0);
    }
  });

  it("has no duplicate authority ids", () => {
    const ids = PAYROLL_AUTHORITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("SOURCE DRIFT: the decisive quoted phrases still exist verbatim in the file", () => {
    // If an edit ever paraphrases these, the legal basis for this feature is
    // gone and the module becomes a confident guess. Reading the file from disk
    // means this fails even if the constant is renamed or re-exported.
    expect(SRC).toContain("transportation or other necessary charges incurred in acquiring possession of the goods");
    expect(SRC).toContain("but not including any cost of selling");
    expect(SRC).toContain("Resellers must capitalize the acquisition costs of property acquired for resale");
    expect(SRC).toContain("special fund in trust for the United States");
  });
});

// ===========================================================================
// 3) THE CENTRAL LEGAL PROMISE, asserted structurally.
// ===========================================================================
describe("the reseller finding — selling labor can never reach inventory", () => {
  it("flags every selling role as never-inventoriable", () => {
    for (const r of LABOR_ROLES) {
      if (r.treatment === "selling") {
        expect(r.neverInventoriable, `${r.code} must be never-inventoriable`).toBe(true);
      }
    }
  });

  it("never points a never-inventoriable role at the COGS account", () => {
    // This is the structural guarantee. If it ever fails, wages could reach
    // account 61000 through configuration alone, with no code change to review.
    for (const r of LABOR_ROLES) {
      if (r.neverInventoriable) {
        expect(r.accountCode, `${r.code}`).not.toBe(PAYROLL_COGS_ACCOUNT);
      }
    }
  });

  it("tags anything landing in COGS as allocable, never as direct product cost", () => {
    // cogs_direct is the invoice price of product bought for resale. Labor is
    // never that, even when it is capitalisable, and keeping the distinction
    // means the position can be reclassified with one query if the law moves.
    for (const r of LABOR_ROLES) {
      if (r.accountCode === PAYROLL_COGS_ACCOUNT) {
        expect(r.costClass, `${r.code}`).toBe("cogs_allocable");
      }
    }
  });

  it("PROPERTY: for a reseller, budtender wages never reach 61000 for ANY split", () => {
    // Sweep every share from 0% to 100% in 1% steps, with full paperwork and a
    // fully-substantiated study. The answer must never change.
    for (let pct = 0; pct <= 100; pct += 1) {
      const share = pct * 1000;
      const r = run({
        substantiation: proof(),
        employees: [emp({
          allocations: share === 100000
            ? [{ roleCode: "budtender", shareMilliPct: 100000 }]
            : [
                { roleCode: "budtender", shareMilliPct: share },
                { roleCode: "management", shareMilliPct: 100000 - share },
              ],
        })],
      });
      const v = evaluatePayrollRun(r);
      expect(v.acquisitionLaborCents, `budtender at ${pct}%`).toBe(0);
      const j = buildPayrollJournal(r, v);
      if (j) {
        const cogs = j.lines.filter((l) => l.accountCode === PAYROLL_COGS_ACCOUNT);
        expect(cogs.length, `budtender at ${pct}% must not post to COGS`).toBe(0);
      }
    }
  });

  it("holds the reseller character even for the most hands-on retail activities", () => {
    // Richmond Patients Group trimmed and dried product and was STILL a
    // reseller. If this ever flips, the module has quietly adopted the position
    // that lost three Tax Court cases.
    const d = determineCharacter([
      "receive_manifest", "inspect", "test_send_out", "repackage", "trim_dry", "store_maintain", "display_sell",
    ]);
    expect(d.character).toBe("reseller");
    expect(d.directLaborCapitalisable).toBe(false);
    expect(d.governingRule).toBe("REG_1_471_3_B_RESELLER");
  });

  it("marks only genuine production activities as producer-making", () => {
    const producerCodes = PRODUCTION_ACTIVITIES.filter((a) => a.makesYouAProducer).map((a) => a.code).sort();
    expect(producerCodes).toEqual(["cultivate", "extract", "infuse_manufacture"]);
  });

  it("defaults to reseller when nothing is known — the safe answer, not the useful one", () => {
    expect(determineCharacter([]).character).toBe("reseller");
    expect(determineCharacter(["something_unrecognised"]).character).toBe("reseller");
  });
});

// ===========================================================================
// 4) THE NARROW DOOR — open on evidence, shut without it.
// ===========================================================================
describe("acquisition labor — the one path a reseller has", () => {
  const receiving = (share: number) => run({
    substantiation: proof(),
    employees: [emp({
      allocations: [
        { roleCode: "receiving", shareMilliPct: share },
        { roleCode: "budtender", shareMilliPct: 100000 - share },
      ],
    })],
  });

  it("lets proved receiving labor into inventory", () => {
    const r = receiving(10000);
    const v = evaluatePayrollRun(r);
    expect(v.postable).toBe(true);
    expect(v.acquisitionLaborCents).toBe(16000);
    const j = buildPayrollJournal(r, v)!;
    expect(j.lines.find((l) => l.accountCode === PAYROLL_COGS_ACCOUNT)!.amountCents).toBe(16000);
  });

  it("refuses the identical claim when the evidence is missing", () => {
    const r = { ...receiving(10000), substantiation: null };
    const v = evaluatePayrollRun(r);
    expect(v.postable).toBe(false);
    expect(v.findings.map((f) => f.code)).toContain("PAY_ACQUISITION_UNSUBSTANTIATED");
    expect(buildPayrollJournal(r, v)).toBeNull();
  });

  it("refuses when ANY single piece of the evidence package is missing", () => {
    // Each gap must be independently fatal. A package that passes with a hole
    // in it is not a package.
    const holes: Partial<TimeSubstantiation>[] = [
      { contemporaneous: false },
      { taskLevelDetail: false },
      { tiedToManifests: false },
      { daysOfRecords: 3 },
      { documentRef: null },
      { basisNote: null },
    ];
    for (const hole of holes) {
      const r = { ...receiving(10000), substantiation: proof(hole) };
      const v = evaluatePayrollRun(r);
      expect(v.postable, `hole: ${JSON.stringify(hole)}`).toBe(false);
      expect(v.findings.map((f) => f.code)).toContain("PAY_ACQUISITION_UNSUBSTANTIATED");
    }
  });

  it("enforces the plausibility ceiling even with perfect paperwork", () => {
    const v = evaluatePayrollRun(receiving(ACQUISITION_LABOR_CEILING_MILLI_PCT));
    expect(v.postable).toBe(false);
    expect(v.findings.map((f) => f.code)).toContain("PAY_ACQUISITION_OVER_CEILING");
  });

  it("keeps the ceiling meaningfully below half of payroll", () => {
    // A retailer claiming half its payroll is receiving labor fails the smell
    // test before any record is opened. Freezing the magnitude here stops the
    // threshold being quietly relaxed later.
    expect(ACQUISITION_LABOR_CEILING_MILLI_PCT).toBeLessThanOrEqual(25000);
    expect(ACQUISITION_LABOR_SCRUTINY_MILLI_PCT).toBeLessThan(ACQUISITION_LABOR_CEILING_MILLI_PCT);
    expect(MIN_SUBSTANTIATION_DAYS).toBeGreaterThanOrEqual(30);
  });

  it("warns above the scrutiny threshold without blocking", () => {
    const v = evaluatePayrollRun(receiving(ACQUISITION_LABOR_SCRUTINY_MILLI_PCT + 1000));
    expect(v.postable).toBe(true);
    expect(v.findings.map((f) => f.code)).toContain("PAY_ACQUISITION_HIGH_SHARE");
  });

  it("weights the ceiling by DOLLARS, not by headcount", () => {
    // Simpson's paradox guard: one small cheque at 100% receiving alongside
    // several full-time floor staff must not block the run, because the MONEY
    // being capitalised is tiny.
    const r = run({
      substantiation: proof(),
      employees: [
        emp({
          employeeId: "tiny", grossWagesCents: 10000, employeeWithholdingCents: 2000,
          netPayCents: 8000, employerTaxCents: 765,
          allocations: [{ roleCode: "receiving", shareMilliPct: 100000 }],
        }),
        emp({ employeeId: "a" }), emp({ employeeId: "b" }), emp({ employeeId: "c" }),
      ],
    });
    const v = evaluatePayrollRun(r);
    expect(v.postable).toBe(true);
    expect(v.acquisitionLaborCents).toBe(10000);
  });
});

// ===========================================================================
// 5) THE BYPASSES — every way someone might route around the finding.
// ===========================================================================
describe("bypass attempts are all closed", () => {
  it("refuses production labor claimed by a reseller", () => {
    const v = evaluatePayrollRun(run({
      substantiation: proof(),
      employees: [emp({ allocations: [{ roleCode: "cultivation_labor", shareMilliPct: 100000 }] })],
    }));
    expect(v.postable).toBe(false);
    expect(v.findings.map((f) => f.code)).toContain("PAY_PRODUCER_CLAIM_BY_RESELLER");
  });

  it("refuses production labor even when the activity list CLAIMS producer status", () => {
    // The activity list is self-reported. If it were the only gate, anyone could
    // type "cultivate" and capitalise labor on a retail licence. The licence is
    // the real constraint, so the block must survive the activity list saying
    // otherwise.
    const v = evaluatePayrollRun(run({
      activityCodes: ["cultivate", "extract"],
      substantiation: proof(),
      employees: [emp({ allocations: [{ roleCode: "cultivation_labor", shareMilliPct: 100000 }] })],
    }));
    expect(v.character.character).toBe("producer");
    expect(v.postable).toBe(false);
    expect(v.findings.map((f) => f.code)).toContain("PAY_PRODUCTION_LABOR_RETAIL_LICENCE");
  });

  it("refuses cannabis acquisition labor posted to a non-cannabis entity", () => {
    for (const entityCode of ["atm", "landholding", "personal"] as const) {
      const v = evaluatePayrollRun(run({
        entityCode,
        substantiation: proof(),
        employees: [emp({ allocations: [{ roleCode: "receiving", shareMilliPct: 100000 }] })],
      }));
      expect(v.postable, entityCode).toBe(false);
      expect(v.findings.map((f) => f.code)).toContain("PAY_CANNABIS_LABOR_WRONG_ENTITY");
    }
  });

  it("refuses an unknown role rather than guessing a treatment", () => {
    const v = evaluatePayrollRun(run({
      employees: [emp({ allocations: [{ roleCode: "chief_inventory_wizard", shareMilliPct: 100000 }] })],
    }));
    expect(v.postable).toBe(false);
    expect(v.findings.map((f) => f.code)).toContain("PAY_UNKNOWN_ROLE");
  });

  it("refuses a time split that does not add to exactly 100%", () => {
    for (const total of [0, 50000, 99999, 100001, 150000]) {
      const v = evaluatePayrollRun(run({
        employees: [emp({ allocations: [{ roleCode: "budtender", shareMilliPct: total }] })],
      }));
      expect(v.postable, `total ${total}`).toBe(false);
    }
  });
});

// ===========================================================================
// 6) THE HARD-BLOCK LIST IS A FROZEN PROMISE.
// ===========================================================================
describe("hard blocks", () => {
  it("is exactly the documented list — nothing added quietly", () => {
    // Michael's instruction was that the system should push back and teach,
    // "rather than rejecting it out right". Every refusal must therefore be a
    // deliberate, reviewed decision. Freezing the list makes adding one a
    // visible act in a diff.
    expect([...PAYROLL_HARD_BLOCKS].sort()).toEqual([
      "PAY_ACQUISITION_OVER_CEILING",
      "PAY_ACQUISITION_UNSUBSTANTIATED",
      "PAY_ALLOCATION_NOT_100",
      "PAY_BAD_DATE",
      "PAY_CANNABIS_LABOR_WRONG_ENTITY",
      "PAY_NEGATIVE_AMOUNT",
      "PAY_NET_MISMATCH",
      "PAY_NO_EMPLOYEES",
      "PAY_PERIOD_BACKWARDS",
      "PAY_PERIOD_CLOSED",
      "PAY_PRODUCER_CLAIM_BY_RESELLER",
      "PAY_PRODUCTION_LABOR_RETAIL_LICENCE",
      "PAY_SELLING_LABOR_TO_COGS",
      "PAY_UNKNOWN_ROLE",
    ]);
  });

  it("has no duplicates", () => {
    expect(new Set(PAYROLL_HARD_BLOCKS).size).toBe(PAYROLL_HARD_BLOCKS.length);
  });

  it("SOURCE DRIFT: every hard-block code is actually raised somewhere in the module", () => {
    // A code on the list that no branch raises is a promise the system does not
    // keep. Counting occurrences catches deletion of the raising branch even
    // though the constant survives.
    for (const code of PAYROLL_HARD_BLOCKS) {
      const hits = SRC.split(code).length - 1;
      expect(hits, `${code} appears in the list AND in a finding`).toBeGreaterThanOrEqual(2);
    }
  });

  it("never blocks without explaining why and offering a way forward", () => {
    // The difference between this system and a form that says "invalid".
    const scenarios = [
      run({ employees: [] }),
      run({ payDate: "nope" }),
      run({ employees: [emp({ netPayCents: 7 })] }),
      run({ employees: [emp({ allocations: [{ roleCode: "receiving", shareMilliPct: 100000 }] })] }),
      run({ employees: [emp({ allocations: [{ roleCode: "cultivation_labor", shareMilliPct: 100000 }] })] }),
    ];
    for (const s of scenarios) {
      for (const f of evaluatePayrollRun(s).findings) {
        expect(f.why.trim().length, `${f.code}.why`).toBeGreaterThan(20);
        expect(f.fix.trim().length, `${f.code}.fix`).toBeGreaterThan(10);
        expect(f.concern.trim().length, `${f.code}.concern`).toBeGreaterThan(0);
      }
    }
  });
});

// ===========================================================================
// 7) THE JOURNAL — double entry, or nothing.
// ===========================================================================
describe("the payroll journal", () => {
  it("balances for a wide matrix of realistic runs", () => {
    const roleSets = [
      [{ roleCode: "budtender", shareMilliPct: 100000 }],
      [{ roleCode: "receiving", shareMilliPct: 5000 }, { roleCode: "budtender", shareMilliPct: 95000 }],
      [{ roleCode: "atm_operation", shareMilliPct: 40000 }, { roleCode: "budtender", shareMilliPct: 60000 }],
      [{ roleCode: "management", shareMilliPct: 50000 }, { roleCode: "compliance", shareMilliPct: 50000 }],
      [{ roleCode: "landholding", shareMilliPct: 100000 }],
    ];
    for (const allocations of roleSets) {
      for (const gross of [1, 99, 100, 12345, 160000, 999999]) {
        const withheld = Math.floor(gross * 0.2);
        const r = run({
          substantiation: proof(),
          employees: [emp({
            grossWagesCents: gross,
            employeeWithholdingCents: withheld,
            employerTaxCents: Math.floor(gross * 0.0765),
            netPayCents: gross - withheld,
            allocations,
          })],
        });
        const v = evaluatePayrollRun(r);
        const j = buildPayrollJournal(r, v);
        if (j) {
          expect(payrollJournalIsBalanced(j), `gross ${gross} ${JSON.stringify(allocations)}`).toBe(true);
        }
      }
    }
  });

  it("never builds a journal for a refused run", () => {
    const refused = [
      run({ employees: [] }),
      run({ payDate: "2026-02-30" }),
      run({ employees: [emp({ netPayCents: 1 })] }),
      run({ employees: [emp({ allocations: [{ roleCode: "receiving", shareMilliPct: 100000 }] })] }),
    ];
    for (const r of refused) {
      expect(buildPayrollJournal(r, evaluatePayrollRun(r))).toBeNull();
    }
  });

  it("keeps trust money on the balance sheet, out of expense", () => {
    const r = run({ employees: [emp({ garnishmentCents: 5000, netPayCents: 123000 })] });
    const v = evaluatePayrollRun(r);
    const j = buildPayrollJournal(r, v)!;
    // Withheld tax and garnishments are other people's money. They must be
    // credits to liability accounts, never a reduction of wage expense.
    const withheld = j.lines.find((l) => l.accountCode === WITHHELD_TAX_ACCOUNT)!;
    const garnish = j.lines.find((l) => l.accountCode === GARNISHMENT_ACCOUNT)!;
    expect(withheld.amountCents).toBeLessThan(0);
    expect(garnish.amountCents).toBe(-5000);
    expect(withheld.costClass).toBe("none");
    expect(garnish.costClass).toBe("none");
  });

  it("treats an employee advance as a receivable, never as wage expense", () => {
    // Michael asked about this by name: "if I loan my employees some money".
    const r = run({ employees: [emp({ advanceRepaymentCents: 20000, netPayCents: 108000 })] });
    const v = evaluatePayrollRun(r);
    const j = buildPayrollJournal(r, v)!;
    const advance = j.lines.find((l) => l.accountCode === EMPLOYEE_ADVANCE_ACCOUNT)!;
    expect(advance.amountCents).toBe(-20000);
    expect(advance.costClass).toBe("none");
    // Gross wages are unchanged by the repayment: the loan was never an expense.
    const wages = j.lines.filter((l) => l.accountCode === WAGE_EXPENSE_ACCOUNT).reduce((s, l) => s + l.amountCents, 0);
    expect(wages).toBe(160000);
  });

  it("keeps the cash payment as a SEPARATE journal, protecting the accrual basis", () => {
    const r = run();
    const accrual = buildPayrollJournal(r, evaluatePayrollRun(r))!;
    const payment = buildPayrollPaymentJournal(r, "2026-12-02")!;
    expect(payment.sourceRef).not.toBe(accrual.sourceRef);
    expect(payment.journalDate).toBe("2026-12-02");
    expect(accrual.journalDate).toBe("2026-11-13");
    expect(payrollJournalIsBalanced(payment)).toBe(true);
    // The bank is only touched by the payment, never by the accrual.
    expect(accrual.lines.some((l) => l.accountCode === OPERATING_BANK_ACCOUNT)).toBe(false);
    expect(payment.lines.some((l) => l.accountCode === OPERATING_BANK_ACCOUNT)).toBe(true);
  });

  it("produces a stable idempotency reference, and a fingerprint that notices corrections", () => {
    const a = run();
    const corrected = run({ employees: [emp({ grossWagesCents: 170000, employeeWithholdingCents: 34000, netPayCents: 136000 })] });
    expect(payrollSourceRef(a)).toBe(payrollSourceRef(corrected));
    expect(payrollContentFingerprint(a)).not.toBe(payrollContentFingerprint(corrected));
  });
});

// ===========================================================================
// 8) CROSS-FILE PARITY — the hard-coded account codes must be real.
// ===========================================================================
describe("chart-of-accounts parity with migration 0173", () => {
  it("every account code the module posts to is actually seeded", () => {
    // The module hard-codes these for purity (it must not touch a database).
    // That is only safe if something proves they exist — otherwise a renamed
    // account silently becomes a posting failure at the worst moment.
    const codes = [
      WAGE_EXPENSE_ACCOUNT, OVERTIME_EXPENSE_ACCOUNT, PAID_LEAVE_ACCOUNT,
      EMPLOYER_TAX_EXPENSE_ACCOUNT, PAYROLL_COGS_ACCOUNT, ACCRUED_PAYROLL_ACCOUNT,
      WITHHELD_TAX_ACCOUNT, EMPLOYER_TAX_PAYABLE_ACCOUNT, GARNISHMENT_ACCOUNT,
      EMPLOYEE_ADVANCE_ACCOUNT, OPERATING_BANK_ACCOUNT,
    ];
    for (const code of codes) {
      expect(COA_SQL, `account ${code} must exist in 0173`).toContain(`gl_upsert_account('${code}'`);
    }
  });

  it("every role posts to one of those seeded accounts", () => {
    const seeded = new Set([
      WAGE_EXPENSE_ACCOUNT, OVERTIME_EXPENSE_ACCOUNT, PAID_LEAVE_ACCOUNT,
      EMPLOYER_TAX_EXPENSE_ACCOUNT, PAYROLL_COGS_ACCOUNT,
    ]);
    for (const r of LABOR_ROLES) {
      expect(seeded.has(r.accountCode), `${r.code} -> ${r.accountCode}`).toBe(true);
    }
  });

  it("61000 is still the allocable payroll COGS account the migration describes", () => {
    expect(COA_SQL).toContain("gl_upsert_account('61000','Payroll — Inventory Handling (allocable)','cogs'");
    // 0173's own comment demands a documented allocation study. This slice is
    // the code that finally enforces that sentence rather than trusting it.
    expect(COA_SQL).toContain("gl_allocation_configs");
  });
});

// ===========================================================================
// 9) MONEY ARITHMETIC — integers only, always exact.
// ===========================================================================
describe("money arithmetic", () => {
  it("splits any amount across any shares with zero drift", () => {
    const shareSets = [
      [50000, 50000],
      [33333, 33333, 33334],
      [1, 99999],
      [10000, 20000, 30000, 40000],
      [16667, 16667, 16666, 16667, 16667, 16666],
    ];
    for (const shares of shareSets) {
      for (let total = 0; total <= 1000; total += 7) {
        const parts = splitCentsByMilliPct(total, shares);
        expect(parts.reduce((a, b) => a + b, 0), `${total} / ${shares.join(":")}`).toBe(total);
        for (const p of parts) expect(Number.isInteger(p)).toBe(true);
      }
    }
  });

  it("is deterministic — the same split, every time, forever", () => {
    const first = splitCentsByMilliPct(101, [33333, 33333, 33334]).join(",");
    for (let i = 0; i < 50; i += 1) {
      expect(splitCentsByMilliPct(101, [33333, 33333, 33334]).join(",")).toBe(first);
    }
  });

  it("survives hostile share inputs without losing or inventing cents", () => {
    expect(splitCentsByMilliPct(100, [Number.NaN, 100000]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(splitCentsByMilliPct(100, [-50000, 100000]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(splitCentsByMilliPct(100, [0, 0])).toEqual([0, 0]);
    expect(splitCentsByMilliPct(Number.NaN, [50000, 50000])).toEqual([0, 0]);
  });

  it("keeps the minus sign on small negative percentages", () => {
    // Math.trunc(-500/1000) is -0, which stringifies as "0" and silently drops
    // the sign. A percentage that reads 0.5% when it means -0.5% is the kind of
    // error that survives review.
    expect(formatMilliPct(-500)).toBe("-0.5%");
    expect(formatMilliPct(-100000)).toBe("-100%");
  });

  it("formats money the way a human reads it", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(1)).toBe("$0.01");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatCents(-500)).toBe("-$5.00");
  });

  it("validates dates arithmetically, immune to the two-digit-year trap", () => {
    // new Date(Date.UTC(26, 2, 0)) is 1926, not 2026 — and the two years
    // disagree about February.
    expect(isValidIsoDate("0026-02-28")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2100-02-29")).toBe(false);
    expect(isValidIsoDate("2000-02-29")).toBe(true);
  });
});

// ===========================================================================
// 10) THE TEACHING SURFACE — the mentor Michael asked for.
// ===========================================================================
describe("the teaching surface", () => {
  it("says the §280E hard truth out loud instead of hiding it", () => {
    const v = evaluatePayrollRun(run());
    const f = v.findings.find((x) => x.code === "PAY_280E_DISALLOWANCE_EXPLAINED")!;
    expect(f).toBeDefined();
    expect(f.severity).toBe("advise");
    expect(v.disallowedLaborCents).toBe(160000);
  });

  it("warns about trust-fund money whenever tax is withheld", () => {
    const f = evaluatePayrollRun(run()).findings.find((x) => x.code === "PAY_TRUST_FUND_REMINDER")!;
    expect(f).toBeDefined();
    // §6672 makes this personal. Michael should see that named.
    expect(f.authorityIds).toContain("IRC_6672_TRUST_PENALTY");
  });

  it("gives worked examples where money moves in a non-obvious way", () => {
    const advance = evaluatePayrollRun(run({
      employees: [emp({ advanceRepaymentCents: 10000, netPayCents: 118000 })],
    })).findings.find((f) => f.code === "PAY_ADVANCE_REPAYMENT")!;
    expect(advance.workedExample!.join("\n")).toContain(EMPLOYEE_ADVANCE_ACCOUNT);
    expect(advance.workedExample!.join("\n")).toContain(ACCRUED_PAYROLL_ACCOUNT);
  });

  it("routes the decision tree to the same answer the engine reaches", () => {
    // Two sources of truth that disagree are worse than one. The tree teaches;
    // the engine charges. They must say the same thing.
    const proved = walkLaborDecisionTree({
      q1_selling: false, q2_separate_business: false, q3_producer: false,
      q4_acquiring_possession: true, q5_evidence: true,
    });
    expect(proved.outcome).toContain(PAYROLL_COGS_ACCOUNT);

    const unproved = walkLaborDecisionTree({
      q1_selling: false, q2_separate_business: false, q3_producer: false,
      q4_acquiring_possession: true, q5_evidence: false,
    });
    expect(unproved.outcome).toContain(WAGE_EXPENSE_ACCOUNT);

    const selling = walkLaborDecisionTree({ q1_selling: true });
    expect(selling.outcome).toContain(WAGE_EXPENSE_ACCOUNT);
  });

  it("asks the next question instead of guessing when answers run out", () => {
    expect(walkLaborDecisionTree({}).pendingQuestionId).toBe("q1_selling");
    expect(walkLaborDecisionTree({ q1_selling: false }).pendingQuestionId).toBe("q2_separate_business");
    expect(walkLaborDecisionTree({ q1_selling: false }).outcome).toBeNull();
  });

  it("asks about selling FIRST, because that answer is final", () => {
    expect(LABOR_DECISION_TREE[0].id).toBe("q1_selling");
    expect(LABOR_DECISION_TREE[0].yes.next).toBeNull();
  });

  it("draws bars that account for every dollar and sum to exactly 100%", () => {
    const v = evaluatePayrollRun(run({
      substantiation: proof(),
      employees: [emp({
        allocations: [
          { roleCode: "receiving", shareMilliPct: 5000 },
          { roleCode: "atm_operation", shareMilliPct: 15000 },
          { roleCode: "budtender", shareMilliPct: 80000 },
        ],
      })],
    }));
    const bars = payrollBars(v);
    expect(bars.reduce((s, b) => s + b.milliPct, 0)).toBe(100000);
    expect(bars.reduce((s, b) => s + b.cents, 0)).toBe(v.totalGrossCents);
  });

  it("explains every role, activity and gap in plain English", () => {
    // Michael has a Master's in accounting but hasn't opened a book in 13 years.
    // Jargon-only guidance would defeat the purpose of the whole platform.
    for (const r of LABOR_ROLES) expect(r.plainEnglish.trim().length, r.code).toBeGreaterThan(40);
    for (const a of PRODUCTION_ACTIVITIES) expect(a.note.trim().length, a.code).toBeGreaterThan(20);
    const gaps = substantiationGaps({
      daysOfRecords: 0, contemporaneous: false, taskLevelDetail: false,
      tiedToManifests: false, documentRef: null, basisNote: null, approvedBy: null,
    });
    expect(gaps.length).toBe(6);
    for (const g of gaps) expect(g.howToFix.trim().length, g.code).toBeGreaterThan(20);
  });
});

// ===========================================================================
// 11) PURITY — the same payroll must produce the same tax answer next April.
// ===========================================================================
describe("purity and determinism", () => {
  it("is deterministic across repeated evaluation", () => {
    const r = run({
      substantiation: proof(),
      employees: [emp({
        allocations: [
          { roleCode: "receiving", shareMilliPct: 8000 },
          { roleCode: "budtender", shareMilliPct: 92000 },
        ],
      })],
    });
    const first = JSON.stringify(evaluatePayrollRun(r));
    for (let i = 0; i < 25; i += 1) {
      expect(JSON.stringify(evaluatePayrollRun(r))).toBe(first);
    }
  });

  it("never mutates the run it is given", () => {
    const r = run({ substantiation: proof() });
    const snapshot = JSON.stringify(r);
    const v = evaluatePayrollRun(r);
    buildPayrollJournal(r, v);
    buildPayrollPaymentJournal(r, "2026-12-01");
    payrollBars(v);
    payrollContentFingerprint(r);
    expect(JSON.stringify(r)).toBe(snapshot);
  });

  it("imports nothing that would drag a database or a clock into a pure module", () => {
    // Purity is what makes this module auditable. A stray Supabase import or a
    // Date.now() would make the tax answer depend on when it was asked.
    // Comments are stripped first: the header PROSE mentions these very tokens
    // while promising not to use them, and we are auditing code, not prose.
    const code = SRC
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(code).not.toMatch(/from\s+["']@supabase/);
    expect(code).not.toMatch(/createClient\(/);
    expect(code).not.toMatch(/\bDate\.now\(/);
    expect(code).not.toMatch(/\bMath\.random\(/);
    expect(code).not.toMatch(/\bnew Date\(\s*\)/);
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/\bprocess\.env\b/);
    // Date.UTC is banned too: it carries the two-digit-year trap that made
    // isValidIsoDate wrong for years below 100.
    expect(code).not.toMatch(/Date\.UTC\(/);

    // Prove the stripper kept the real code, so this cannot pass by deleting
    // everything.
    expect(code).toContain("export function evaluatePayrollRun");
    expect(code).toContain("export function buildPayrollJournal");
    expect(code).toContain("export function splitCentsByMilliPct");
  });

  it("keeps money in integer cents everywhere it posts", () => {
    const r = run({
      substantiation: proof(),
      employees: [
        emp({ employeeId: "a", grossWagesCents: 133337, employeeWithholdingCents: 26667, netPayCents: 106670,
          allocations: [{ roleCode: "receiving", shareMilliPct: 3333 }, { roleCode: "budtender", shareMilliPct: 96667 }] }),
        emp({ employeeId: "b", grossWagesCents: 99991, employeeWithholdingCents: 19998, netPayCents: 79993,
          allocations: [{ roleCode: "management", shareMilliPct: 100000 }] }),
      ],
    });
    const v = evaluatePayrollRun(r);
    const j = buildPayrollJournal(r, v)!;
    for (const l of j.lines) expect(Number.isInteger(l.amountCents), l.accountCode).toBe(true);
    expect(payrollJournalIsBalanced(j)).toBe(true);
  });
});

// ===========================================================================
// 12) SOURCE DRIFT — structural guarantees that must survive refactoring.
// ===========================================================================
describe("source-level drift guards", () => {
  /**
   * A verbatim quote living inside a JSDoc banner is physically wrapped across
   * several lines and prefixed with " * ". A naive `toContain` on the raw file
   * therefore fails for a purely cosmetic reason (and, worse, would PASS if
   * someone reflowed the words into a different sentence). Flatten the comment
   * furniture first, then match. This guard is then sensitive to what actually
   * matters -- the WORDS -- and blind to what does not -- the line breaks.
   */
  const FLAT = SRC
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").replace(/^\s*\/\/\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ");

  it("flattens the source without destroying it (guards the guard)", () => {
    // If FLAT were ever empty or mangled, every assertion below would silently
    // become vacuous. Prove the flattener still yields real content.
    expect(FLAT.length).toBeGreaterThan(50_000);
    expect(FLAT).toContain("export function evaluatePayrollRun");
  });

  it("still records the owner's request verbatim", () => {
    // Standing rule 1: record requests verbatim. The request and the answer to
    // it must stay together, so that anyone reading this file later understands
    // why it says no.
    expect(FLAT).toContain(
      "I would like the ability to assign employees as cogs so I can write them off",
    );
  });

  it("still records the owner's other standing instructions verbatim", () => {
    // These three quotes are the design brief for the whole push-back model.
    // If they vanish, the next maintainer will "simplify" the explanations away
    // and turn a teaching tool back into a dumb blocker.
    expect(FLAT).toContain(
      "I want push back",
    );
    expect(FLAT).toContain(
      "rather than rejecting it out right",
    );
    expect(FLAT).toContain(
      "not just block, but explain why, and even better, show me a way to do it properly",
    );
    expect(FLAT).toContain(
      "accurate and precise stated from actual verbatim text from authoritative sources",
    );
  });

  it("still names the three cases that decided the reseller question", () => {
    expect(SRC).toContain("Patients Mutual");
    expect(SRC).toContain("Richmond Patients Group");
    expect(SRC).toContain("Alternative Health Care Advocates");
  });

  it("still routes acquisition labor to 61000 and ordinary wages to 71010", () => {
    expect(SRC).toContain('export const PAYROLL_COGS_ACCOUNT = "61000"');
    expect(SRC).toContain('export const WAGE_EXPENSE_ACCOUNT = "71010"');
  });

  it("keeps the evidence gate wired to the acquisition path", () => {
    // If substantiationGaps() were ever disconnected, the narrow door would
    // swing open with no paperwork and nothing else would notice.
    expect(SRC).toContain("substantiationGaps(");
    expect(SRC).toContain("PAY_ACQUISITION_UNSUBSTANTIATED");
  });
});

// ===========================================================================
// 12) MUTATION-CAMPAIGN BACKSTOPS
// ===========================================================================
/**
 * Everything below was written to close a REAL hole that
 * `scripts/compliance/mutate-slice-books-04.sh` found by deliberately breaking
 * the module and discovering that nothing failed.
 *
 * The first run of that campaign broke this module in 79 different ways. Sixty-
 * two of those breaks were caught. SEVENTEEN were not — the mutant shipped, the
 * suite stayed green, and the books were silently wrong. Three of the seventeen
 * turned out to be EQUIVALENT MUTANTS (changes that cannot alter behaviour for
 * any input, documented in the harness). The other fourteen were genuine gaps in
 * this file, and each one is closed below with the mutant that exposed it named
 * in a comment.
 *
 * This is the part of testing that a green checkmark cannot tell you about, and
 * it is the reason Michael asked for it: "test it, break it, fix it to be
 * better, and test the tests."
 */
describe("mutation-campaign backstops", () => {
  /**
   * THE FROZEN TAXONOMY.
   *
   * MUTANTS CAUGHT: budtender cost class flipped to cogs_allocable;
   * inventory_count promoted to acquisition; security relabelled as
   * acquisition; marketing moved out of selling; ATM labor folded into the
   * cannabis trade; owner_officer made inventoriable.
   *
   * Every one of those is a single-word edit that a reasonable developer could
   * make while "tidying up", and every one of them changes somebody's tax
   * return. Spot-checking two or three roles is how six of them got through.
   * So the whole table is pinned, exactly, in one place: all thirteen roles,
   * all four decision fields. A deliberate change now has to be made HERE too,
   * which is precisely the speed bump this table deserves.
   */
  const EXPECTED_TAXONOMY: ReadonlyArray<
    readonly [string, string, string, string, boolean]
  > = [
    // code                treatment       account  costClass             neverInventoriable
    ["budtender",         "selling",      "71010", "nondeductible_280e", true],
    ["receiving",         "acquisition",  "61000", "cogs_allocable",     false],
    ["inventory_count",   "admin",        "71010", "nondeductible_280e", false],
    ["security",          "admin",        "71010", "nondeductible_280e", true],
    ["management",        "admin",        "71010", "nondeductible_280e", false],
    ["compliance",        "admin",        "71010", "nondeductible_280e", false],
    ["delivery_driver",   "acquisition",  "61000", "cogs_allocable",     false],
    ["marketing",         "selling",      "71010", "nondeductible_280e", true],
    ["atm_operation",     "separate",     "71010", "separate_business",  true],
    ["landholding",       "separate",     "71010", "separate_business",  true],
    ["cultivation_labor", "production",   "61000", "cogs_allocable",     false],
    ["processing_labor",  "production",   "61000", "cogs_allocable",     false],
    ["owner_officer",     "owner",        "71010", "nondeductible_280e", true],
  ];

  it("pins every labor role's treatment, account, cost class and flag", () => {
    expect(LABOR_ROLES.length).toBe(EXPECTED_TAXONOMY.length);
    for (const [code, treatment, account, costClass, neverInv] of EXPECTED_TAXONOMY) {
      const role = findLaborRole(code);
      expect(role, `role ${code} must exist`).toBeDefined();
      expect(role!.treatment, `${code} treatment`).toBe(treatment);
      expect(role!.accountCode, `${code} account`).toBe(account);
      expect(role!.costClass, `${code} cost class`).toBe(costClass);
      expect(role!.neverInventoriable, `${code} neverInventoriable`).toBe(neverInv);
    }
    // And no role may be added without being pinned here.
    const pinned = new Set(EXPECTED_TAXONOMY.map((t) => t[0]));
    for (const r of LABOR_ROLES) {
      expect(pinned.has(r.code), `role ${r.code} is not pinned in EXPECTED_TAXONOMY`).toBe(true);
    }
  });

  it("keeps the account and the cost class agreeing with each other", () => {
    // The account number and the §280E class are read by DIFFERENT consumers:
    // the balance sheet reads the account, the tax report reads the class. If
    // they ever disagree, the books balance and the return is wrong -- the
    // silent-wrong-answer failure mode this whole slice is built around.
    for (const r of LABOR_ROLES) {
      const isCogsClass = r.costClass === "cogs_allocable" || r.costClass === "cogs_direct";
      expect(isCogsClass, `${r.code}: cost class ${r.costClass} vs account ${r.accountCode}`)
        .toBe(r.accountCode === PAYROLL_COGS_ACCOUNT);
    }
  });

  it("never lets a never-inventoriable role carry an inventory cost class", () => {
    for (const r of LABOR_ROLES) {
      if (!r.neverInventoriable) continue;
      expect(r.costClass, `${r.code} can never be inventoried`).not.toBe("cogs_allocable");
      expect(r.costClass, `${r.code} can never be inventoried`).not.toBe("cogs_direct");
      expect(r.accountCode, `${r.code} must not post to COGS`).not.toBe(PAYROLL_COGS_ACCOUNT);
    }
  });

  it("keeps separate-trade labor tagged separate_business, protecting CHAMP", () => {
    // CHAMP (128 T.C. 173) is what keeps the ATM and the rental deductible.
    // Folding their wages into the §280E bucket does not just lose a deduction,
    // it erases the evidence that they were ever a separate trade.
    for (const r of LABOR_ROLES) {
      expect(r.treatment === "separate", `${r.code}`).toBe(r.costClass === "separate_business");
    }
  });

  it("keeps selling roles flagged never-inventoriable, in both directions", () => {
    for (const r of LABOR_ROLES) {
      if (r.treatment === "selling") {
        expect(r.neverInventoriable, `${r.code} is selling labor`).toBe(true);
      }
    }
    // The two roles the law names most directly.
    expect(findLaborRole("budtender")!.treatment).toBe("selling");
    expect(findLaborRole("marketing")!.treatment).toBe("selling");
  });

  /**
   * MUTANT CAUGHT: "missing substantiation defaults to fully proved".
   *
   * When a run arrives with no substantiation at all, the engine substitutes a
   * default. If that default were ever flipped from "nothing is proved" to
   * "everything is proved", absence of evidence would silently become evidence
   * of compliance -- and the run would still be blocked (for the two remaining
   * paperwork gaps), so the OLD tests still passed. The count is the tell.
   */
  it("treats absent substantiation as nothing proved, not everything proved", () => {
    const r = run({
      substantiation: null,
      employees: [emp({
        allocations: [
          { roleCode: "receiving", shareMilliPct: 10000 },
          { roleCode: "budtender", shareMilliPct: 90000 },
        ],
      })],
    });
    const f = evaluatePayrollRun(r).findings.find(
      (x) => x.code === "PAY_ACQUISITION_UNSUBSTANTIATED",
    )!;
    expect(f).toBeDefined();
    // All SIX pieces of evidence must be reported missing, not just the two
    // that happen to be strings.
    expect(f.concern).toContain("6 pieces");
    // And the fix text must actually name the missing proof, so the finding
    // teaches rather than merely refuses.
    expect(f.fix).toContain("as the work happens");
    expect(f.fix).toContain("tie to specific deliveries");
  });

  it("reports all six substantiation gaps for a wholly undocumented allocation", () => {
    const gaps = substantiationGaps({
      daysOfRecords: 0,
      contemporaneous: false,
      taskLevelDetail: false,
      tiedToManifests: false,
      documentRef: null,
      basisNote: null,
      approvedBy: null,
    });
    expect(gaps.map((g) => g.code).sort()).toEqual([
      "SUB_NOT_CONTEMPORANEOUS",
      "SUB_NOT_TIED_TO_DELIVERIES",
      "SUB_NO_BASIS_NOTE",
      "SUB_NO_STUDY_DOCUMENT",
      "SUB_NO_TASK_DETAIL",
      "SUB_TOO_FEW_DAYS",
    ].sort());
  });

  /**
   * MUTANTS CAUGHT: "ordinary wages tagged cogs_allocable in the ledger" and
   * "separate-business wages lose their CHAMP class".
   *
   * The journal was tested for BALANCE and for ACCOUNT NUMBERS, but the §280E
   * cost class on each line was never asserted. That class is the field the tax
   * reports actually read. A journal can balance perfectly, post to exactly the
   * right accounts, and still hand the return a completely different answer.
   * This is the TypeScript twin of the defect the live-database run found in
   * gl_post_payroll_run().
   */
  it("tags every journal line with the cost class the tax report will read", () => {
    const r = run({
      substantiation: proof(),
      employees: [emp({
        allocations: [
          { roleCode: "receiving", shareMilliPct: 5000 },
          { roleCode: "atm_operation", shareMilliPct: 25000 },
          { roleCode: "budtender", shareMilliPct: 70000 },
        ],
      })],
    });
    const v = evaluatePayrollRun(r);
    expect(v.postable).toBe(true);
    const j = buildPayrollJournal(r, v)!;

    const byClass = (cls: string) => j.lines.filter((l) => l.costClass === cls);

    // The one lawful inventory line: acquisition labor, allocable, in 61000.
    const cogs = byClass("cogs_allocable");
    expect(cogs.length).toBe(1);
    expect(cogs[0].accountCode).toBe(PAYROLL_COGS_ACCOUNT);
    expect(cogs[0].amountCents).toBe(8000);

    // The CHAMP line: separate trade, in wage expense, NOT §280E.
    const champ = byClass("separate_business");
    expect(champ.length).toBe(1);
    expect(champ[0].accountCode).toBe(WAGE_EXPENSE_ACCOUNT);
    expect(champ[0].amountCents).toBe(40000);

    // Ordinary wages: disallowed, and they must SAY so.
    const ordinary = j.lines.find(
      (l) => l.accountCode === WAGE_EXPENSE_ACCOUNT && l.costClass !== "separate_business",
    )!;
    expect(ordinary.costClass).toBe("nondeductible_280e");
    expect(ordinary.amountCents).toBe(112000);

    // Employer taxes are Greenway's own cost and are equally disallowed.
    const tax = j.lines.find((l) => l.accountCode === EMPLOYER_TAX_EXPENSE_ACCOUNT)!;
    expect(tax.costClass).toBe("nondeductible_280e");

    // No line may ever claim the producer-only class.
    expect(j.lines.some((l) => l.costClass === "cogs_direct")).toBe(false);

    // Every balance-sheet line carries no §280E class at all.
    for (const l of j.lines) {
      const isPnl = l.accountCode.startsWith("6") || l.accountCode.startsWith("7");
      if (!isPnl) expect(l.costClass, `${l.accountCode}`).toBe("none");
    }
  });

  /**
   * MUTANT CAUGHT: "balance check gains a one-cent tolerance".
   *
   * Every existing balance test fed the checker a journal built by the builder,
   * which is always balanced -- so the function only ever saw inputs that
   * returned true. Nothing proved it could say FALSE. A one-cent tolerance is
   * exactly how a rounding bug gets waved through, and a one-cent plug repeated
   * every fortnight is a permanent, unexplainable drift in the ledger.
   */
  it("rejects a journal that is out by a single cent, in either direction", () => {
    const r = run();
    const j = buildPayrollJournal(r, evaluatePayrollRun(r))!;
    expect(payrollJournalIsBalanced(j)).toBe(true);

    for (const drift of [1, -1, 2, -2, 100]) {
      const broken = {
        ...j,
        lines: j.lines.map((l, i) => (i === 0 ? { ...l, amountCents: l.amountCents + drift } : l)),
      };
      expect(payrollJournalIsBalanced(broken), `drift ${drift}`).toBe(false);
    }
  });

  /**
   * MUTANTS CAUGHT: "content fingerprint ignores the amounts" and "content
   * fingerprint ignores the allocations".
   *
   * The existing test changed gross, withholding AND net all at once, so it
   * still passed when the fingerprint stopped reading gross. These change ONE
   * field at a time.
   *
   * Why it matters: the source reference is deliberately keyed only on entity +
   * period + pay date, so a double-click cannot post payroll twice. That means
   * a CORRECTED run has the same reference as the original. The fingerprint is
   * the only thing that can tell the ledger "same reference, different money" --
   * and if it stops noticing, the correction is silently discarded and the
   * original wrong numbers stay in the books forever.
   */
  it("notices a change to the money even when nothing else moves", () => {
    const base = run();
    const fields: ReadonlyArray<keyof PayrollEmployeeInput> = [
      "grossWagesCents",
      "employeeWithholdingCents",
      "employerTaxCents",
      "netPayCents",
    ];
    for (const field of fields) {
      const changed = run({
        employees: [emp({ [field]: (emp()[field] as number) + 1 } as Partial<PayrollEmployeeInput>)],
      });
      expect(payrollSourceRef(changed), `${String(field)} must not change the ref`)
        .toBe(payrollSourceRef(base));
      expect(payrollContentFingerprint(changed), `${String(field)} must change the fingerprint`)
        .not.toBe(payrollContentFingerprint(base));
    }
  });

  it("notices a change to the time allocation even when the money is identical", () => {
    // This is the dangerous one: the paycheques are byte-for-byte the same, but
    // the §280E answer moved. Same money, different tax return.
    const base = run();
    const reallocated = run({
      employees: [emp({ allocations: [{ roleCode: "management", shareMilliPct: 100000 }] })],
    });
    expect(payrollSourceRef(reallocated)).toBe(payrollSourceRef(base));
    expect(payrollContentFingerprint(reallocated)).not.toBe(payrollContentFingerprint(base));

    // And a change to the SHARE alone, with the same roles, must also register.
    const shifted = run({
      employees: [emp({
        allocations: [
          { roleCode: "receiving", shareMilliPct: 5000 },
          { roleCode: "budtender", shareMilliPct: 95000 },
        ],
      })],
    });
    const shiftedMore = run({
      employees: [emp({
        allocations: [
          { roleCode: "receiving", shareMilliPct: 6000 },
          { roleCode: "budtender", shareMilliPct: 94000 },
        ],
      })],
    });
    expect(payrollContentFingerprint(shifted)).not.toBe(payrollContentFingerprint(shiftedMore));
  });

  it("gives the same fingerprint when only the employee ORDER changes", () => {
    // The flip side: re-ordering the same people is not a correction, and must
    // not look like one, or every re-submission would raise a false alarm.
    const a = emp({ employeeId: "a", employeeName: "A" });
    const b = emp({ employeeId: "b", employeeName: "B" });
    expect(payrollContentFingerprint(run({ employees: [a, b] })))
      .toBe(payrollContentFingerprint(run({ employees: [b, a] })));
  });

  /**
   * MUTANT CAUGHT: "split ranks by smallest remainder instead of largest".
   *
   * The existing arithmetic tests asserted that the parts SUM to the whole,
   * which both methods satisfy. Nothing pinned WHICH part receives the odd
   * cent, so the allocation method could be swapped without a single failure.
   * These values were computed by hand from the largest-remainder rule and
   * verified to differ under the smallest-remainder rule.
   *
   * NOTE ON A MUTANT THAT IS NOT A HOLE: the campaign also tried removing the
   * `|| a.i - b.i` tie-break. That is an EQUIVALENT MUTANT -- Array.sort has
   * been required to be stable since ES2019, so equal remainders already retain
   * index order. It was verified over 18,006 cases with zero differences. The
   * explicit tie-break stays because relying on an implicit guarantee for money
   * is a bad trade, but no test can kill it, and pretending otherwise would
   * mean writing a test that asserts nothing.
   */
  it("gives the odd cent to the LARGEST remainder, at a pinned index", () => {
    expect(splitCentsByMilliPct(101, [33333, 33333, 33334])).toEqual([34, 33, 34]);
    expect(splitCentsByMilliPct(5, [10000, 20000, 30000, 40000])).toEqual([1, 1, 1, 2]);
    expect(splitCentsByMilliPct(1, [33333, 33333, 33334])).toEqual([0, 0, 1]);
    expect(splitCentsByMilliPct(2, [33333, 33333, 33334])).toEqual([1, 0, 1]);
  });

  /**
   * MUTANT CAUGHT: "acquisition share ignores the treatment (counts every role)".
   *
   * `acquisitionShareMilliPct` was EXPORTED and never called by a single test --
   * the campaign could delete its entire reason for existing and nothing
   * noticed. An exported function with no test is a promise nobody is keeping.
   */
  it("measures the acquisition share of a time split, and only the acquisition part", () => {
    expect(acquisitionShareMilliPct([{ roleCode: "receiving", shareMilliPct: 5000 }, { roleCode: "budtender", shareMilliPct: 95000 }])).toBe(5000);
    expect(acquisitionShareMilliPct([{ roleCode: "budtender", shareMilliPct: 100000 }])).toBe(0);
    expect(acquisitionShareMilliPct([{ roleCode: "management", shareMilliPct: 100000 }])).toBe(0);
    expect(acquisitionShareMilliPct([{ roleCode: "atm_operation", shareMilliPct: 100000 }])).toBe(0);
    // Both acquisition roles count, and they add.
    expect(acquisitionShareMilliPct([
      { roleCode: "receiving", shareMilliPct: 4000 },
      { roleCode: "delivery_driver", shareMilliPct: 3000 },
      { roleCode: "budtender", shareMilliPct: 93000 },
    ])).toBe(7000);
    // An unknown role contributes nothing rather than being assumed harmless.
    expect(acquisitionShareMilliPct([{ roleCode: "not_a_role", shareMilliPct: 100000 }])).toBe(0);
    expect(acquisitionShareMilliPct([])).toBe(0);
  });

  /**
   * THE OTHER FROZEN TABLE.
   *
   * MUTANTS CAUGHT: trimming/drying makes you a producer; repackaging makes you
   * a producer; selling reclassified as production.
   *
   * Those three died on the existing tests, but only because a test happened to
   * name those specific codes. The activity list is the OTHER decision surface
   * in this module -- it decides whether §1.471-3(b) or §1.471-3(c) governs,
   * which decides whether direct labor is capitalisable at all -- and it was
   * only ever checked in aggregate. Pinning it per-code closes the same class of
   * gap the role taxonomy had, before a mutant has to find it.
   *
   * The `false` entries are the load-bearing ones: each is an activity a
   * dispensary really does, that a promoter would really argue makes you a
   * producer, and that a court has already said does not.
   */
  it("pins which activities make you a producer, one by one", () => {
    const EXPECTED_ACTIVITIES: ReadonlyArray<readonly [string, boolean]> = [
      ["receive_manifest",   false], // taking delivery is acquisition, not production
      ["inspect",            false], // reinspection: Patients Mutual, expressly
      ["test_send_out",      false], // sending OUT for testing is not producing
      ["repackage",          false], // "packaging and labeling" -- Patients Mutual
      ["trim_dry",           false], // Richmond trimmed and dried; still a reseller
      ["store_maintain",     false], // "maintained the stock" -- reseller side
      ["display_sell",       false], // selling is excluded even for a producer
      ["cultivate",          true],  // real production -- and not on a retail licence
      ["extract",            true],
      ["infuse_manufacture", true],
    ];
    expect(PRODUCTION_ACTIVITIES.length).toBe(EXPECTED_ACTIVITIES.length);
    for (const [code, makesProducer] of EXPECTED_ACTIVITIES) {
      const a = findProductionActivity(code);
      expect(a, `activity ${code} must exist`).toBeDefined();
      expect(a!.makesYouAProducer, `${code} makesYouAProducer`).toBe(makesProducer);
    }
    const pinned = new Set(EXPECTED_ACTIVITIES.map((t) => t[0]));
    for (const a of PRODUCTION_ACTIVITIES) {
      expect(pinned.has(a.code), `activity ${a.code} is not pinned`).toBe(true);
    }
  });

  it("keeps every retail activity on the reseller side of the line, end to end", () => {
    // The determination, not just the table: everything Greenway actually does,
    // fed in together, must still come out "reseller".
    const everythingGreenwayDoes = [
      "receive_manifest", "inspect", "test_send_out",
      "repackage", "trim_dry", "store_maintain", "display_sell",
    ];
    const d = determineCharacter(everythingGreenwayDoes);
    expect(d.character).toBe("reseller");
    expect(d.directLaborCapitalisable).toBe(false);
    expect(d.governingRule).toBe("REG_1_471_3_B_RESELLER");
    expect(d.producerActivities).toEqual([]);
    expect(d.unknownActivities).toEqual([]);

    // And a single production activity flips it -- so the test above is not
    // passing merely because the function always says "reseller".
    const flipped = determineCharacter([...everythingGreenwayDoes, "cultivate"]);
    expect(flipped.character).toBe("producer");
    expect(flipped.directLaborCapitalisable).toBe(true);
  });

  it("totals a time split without trusting the numbers it is given", () => {
    expect(totalAllocationMilliPct([{ roleCode: "budtender", shareMilliPct: 100000 }])).toBe(100000);
    expect(totalAllocationMilliPct([
      { roleCode: "receiving", shareMilliPct: 5000 },
      { roleCode: "budtender", shareMilliPct: 95000 },
    ])).toBe(100000);
    // A NaN share must not poison the total into NaN, which would make every
    // downstream comparison silently false and let a broken split through.
    expect(totalAllocationMilliPct([
      { roleCode: "receiving", shareMilliPct: Number.NaN },
      { roleCode: "budtender", shareMilliPct: 95000 },
    ])).toBe(95000);
    expect(totalAllocationMilliPct([])).toBe(0);
  });
});

// ===========================================================================
// 13) THE OWNER-FACING PAGE MUST NOT LIE
//
// The /admin/books/payroll page shows Michael a worked example as a bar chart,
// because he said he learns best visually. A picture is the most persuasive
// thing on the screen and therefore the most dangerous thing to get wrong: he
// will remember the shape of that bar long after he has forgotten the prose.
//
// These tests exist because a chart can go wrong in ways TypeScript and lint
// cannot see. Numbers hard-coded into JSX compile perfectly and keep displaying
// last year's answer forever. A bar whose widths sum to 99.9% renders without
// complaint. So: the page must COMPUTE its example from the engine, and the
// engine's bars must be internally exact.
// ===========================================================================
describe("13) the payroll page's worked example is computed, not asserted", () => {
  const pageSrc = readFileSync(
    resolve(__dirname, "../../src/app/admin/books/payroll/page.tsx"),
    "utf8",
  );

  it("the page derives its example from the real engine functions", () => {
    // If someone replaces these calls with a literal array of pretty numbers,
    // the illustration stops tracking the rules and starts misinforming him.
    expect(pageSrc).toContain("evaluatePayrollRun(EXAMPLE_RUN)");
    expect(pageSrc).toContain("payrollBars(EXAMPLE_VERDICT)");
  });

  it("the page's example is SUBSTANTIATED, so it teaches the defensible case", () => {
    // An unsubstantiated example hard-blocks. That is correct engine behaviour
    // but the wrong lesson: he needs to see what a claim that SURVIVES looks
    // like, together with the evidence it rests on.
    expect(pageSrc).toContain("tiedToManifests: true");
    expect(pageSrc).toContain("taskLevelDetail: true");
    expect(pageSrc).toContain("contemporaneous: true");
  });

  it("money-bar percentages sum to EXACTLY 100%, never 99.9%", () => {
    // Largest-remainder, checked on the same shape the page renders plus a
    // deliberately awkward split designed to expose naive rounding.
    const shapes: readonly PayrollEmployeeInput[][] = [
      [
        {
          employeeId: "a",
          employeeName: "Receiver",
          grossWagesCents: 240_000,
          employeeWithholdingCents: 48_000,
          employerTaxCents: 18_360,
          netPayCents: 192_000,
          allocations: [
            { roleCode: "receiving", shareMilliPct: 50_000 },
            { roleCode: "budtender", shareMilliPct: 50_000 },
          ],
        },
        {
          employeeId: "b",
          employeeName: "Manager",
          grossWagesCents: 320_000,
          employeeWithholdingCents: 64_000,
          employerTaxCents: 24_480,
          netPayCents: 256_000,
          allocations: [{ roleCode: "management", shareMilliPct: 100_000 }],
        },
      ],
      // Thirds: the classic case where three naive roundings lose a cent.
      [
        {
          employeeId: "c",
          employeeName: "Split",
          grossWagesCents: 100_001,
          employeeWithholdingCents: 20_000,
          employerTaxCents: 7_650,
          netPayCents: 80_001,
          allocations: [
            { roleCode: "receiving", shareMilliPct: 33_333 },
            { roleCode: "budtender", shareMilliPct: 33_333 },
            { roleCode: "management", shareMilliPct: 33_334 },
          ],
        },
      ],
    ];

    for (const employees of shapes) {
      const verdict = evaluatePayrollRun({
        entityCode: "greenway",
        payDate: "2026-11-20",
        periodStart: "2026-11-01",
        periodEnd: "2026-11-15",
        activityCodes: ["receive_manifest", "display_sell"],
        substantiation: null,
        employees,
      });
      const bars = payrollBars(verdict);

      const sumMilli = bars.reduce((n, b) => n + b.milliPct, 0);
      const sumCents = bars.reduce((n, b) => n + b.cents, 0);

      expect(sumMilli, "bar widths must total exactly 100.000%").toBe(100_000);
      // And the cents behind the picture must be the whole payroll -- no dollar
      // may vanish between the ledger and the illustration.
      expect(sumCents, "bars must account for every cent of gross").toBe(
        verdict.totalGrossCents,
      );
    }
  });

  it("no bar is ever negative, which would render as an inverted sliver", () => {
    const verdict = evaluatePayrollRun({
      entityCode: "greenway",
      payDate: "2026-11-20",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-15",
      activityCodes: ["receive_manifest"],
      substantiation: null,
      employees: [
        {
          employeeId: "z",
          employeeName: "Receiver",
          grossWagesCents: 1,
          employeeWithholdingCents: 0,
          employerTaxCents: 0,
          netPayCents: 1,
          allocations: [{ roleCode: "receiving", shareMilliPct: 100_000 }],
        },
      ],
    });
    for (const b of payrollBars(verdict)) {
      expect(b.cents).toBeGreaterThanOrEqual(0);
      expect(b.milliPct).toBeGreaterThanOrEqual(0);
    }
  });
});
