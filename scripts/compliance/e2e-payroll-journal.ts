/**
 * scripts/compliance/e2e-payroll-journal.ts
 *
 * Emits the JSON payload that buildPayrollJournal() produces for a realistic
 * Greenway pay period, so the SAME numbers the TypeScript core computes can be
 * posted through the real gl_post_payroll_run() function in a real PostgreSQL
 * database.
 *
 * This exists because a passing unit test proves the core agrees with ITSELF.
 * It does not prove the core agrees with the LEDGER. This script is what closes
 * that gap: whatever it prints is fed straight into SQL, and the trial balance
 * on the other side has to come out right.
 *
 * Not part of the app. Development verification only.
 */
import {
  evaluatePayrollRun,
  buildPayrollJournal,
  buildPayrollPaymentJournal,
  payrollJournalIsBalanced,
  payrollSourceRef,
  payrollContentFingerprint,
  type PayrollRunInput,
} from "../../src/lib/accounting/payroll-cogs-core";

// A realistic period: four people, one of whom genuinely works the door on
// delivery days, with a fully documented allocation study behind the split.
const run: PayrollRunInput = {
  entityCode: "greenway",
  payDate: "2026-11-20",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-15",
  activityCodes: ["retail_sale", "receiving_inspection"],
  substantiation: {
    daysOfRecords: 42,
    contemporaneous: true,
    taskLevelDetail: true,
    tiedToManifests: true,
    documentRef: "STUDY-2026-01",
    basisNote:
      "Six weeks of task-tagged time punches tied to 42 numbered inbound manifests.",
    approvedBy: "Nicholas Mullan, CPA",
  },
  employees: [
    {
      employeeId: "e1",
      employeeName: "Receiving lead",
      grossWagesCents: 240000,
      overtimeCents: 15000,
      employeeWithholdingCents: 48000,
      employerTaxCents: 18360,
      netPayCents: 192000,
      hoursWorked: 80,
      allocations: [
        { roleCode: "receiving", shareMilliPct: 40000 },
        { roleCode: "budtender", shareMilliPct: 60000 },
      ],
    },
    {
      employeeId: "e2",
      employeeName: "Budtender",
      grossWagesCents: 180000,
      employeeWithholdingCents: 36000,
      employerTaxCents: 13770,
      netPayCents: 144000,
      hoursWorked: 80,
      allocations: [{ roleCode: "budtender", shareMilliPct: 100000 }],
    },
    {
      employeeId: "e3",
      employeeName: "Store manager",
      grossWagesCents: 320000,
      paidLeaveCents: 20000,
      employeeWithholdingCents: 64000,
      employerTaxCents: 24480,
      garnishmentCents: 10000,
      netPayCents: 246000,
      hoursWorked: 80,
      allocations: [{ roleCode: "management", shareMilliPct: 100000 }],
    },
    {
      employeeId: "e4",
      employeeName: "Part-time, repaying an advance",
      grossWagesCents: 96000,
      employeeWithholdingCents: 19200,
      employerTaxCents: 7344,
      advanceRepaymentCents: 5000,
      netPayCents: 71800,
      hoursWorked: 40,
      allocations: [
        { roleCode: "receiving", shareMilliPct: 25000 },
        { roleCode: "security", shareMilliPct: 75000 },
      ],
    },
  ],
};

const verdict = evaluatePayrollRun(run, { minimumWageCentsPerHour: 1666 });
const journal = buildPayrollJournal(run, verdict);
// The cash side is a SEPARATE journal on the day the money actually leaves the
// bank. Accruing the cost and paying it are two different events, and Michael's
// books are accrual basis.
const payment = buildPayrollPaymentJournal(run, "2026-11-20");

if (!journal) {
  console.error("REFUSED. Findings:");
  for (const f of verdict.findings) console.error(`  [${f.severity}] ${f.code}`);
  process.exit(1);
}

const out = {
  postable: verdict.postable,
  sourceRef: payrollSourceRef(run),
  fingerprint: payrollContentFingerprint(run),
  balanced: payrollJournalIsBalanced(journal),
  totals: {
    grossCents: verdict.totalGrossCents,
    acquisitionLaborCents: verdict.acquisitionLaborCents,
    productionLaborCents: verdict.productionLaborCents,
    disallowedLaborCents: verdict.disallowedLaborCents,
    separateBusinessLaborCents: verdict.separateBusinessLaborCents,
    trustWithholdingCents: verdict.trustWithholdingCents,
    employerTaxCents: verdict.employerTaxCents,
    netPayCents: verdict.netPayCents,
  },
  findings: verdict.findings.map((f) => ({ code: f.code, severity: f.severity })),
  // NOTE: cost_class MUST travel with every line. gl_submit_journal() defaults a
  // missing cost_class to 'none', which silently strips the §280E label off the
  // ledger -- the books would still BALANCE and still be WRONG, because the
  // 280E reports read cost_class, not the account number. An earlier version of
  // this script omitted it and posted eight 'none' lines that looked perfect.
  lines: journal.lines.map((l) => ({
    account_code: l.accountCode,
    amount_cents: l.amountCents,
    cost_class: l.costClass,
    description: l.description,
  })),
  paymentSourceRef: payment?.sourceRef ?? null,
  paymentLines:
    payment?.lines.map((l) => ({
      account_code: l.accountCode,
      amount_cents: l.amountCents,
      cost_class: l.costClass,
      description: l.description,
    })) ?? [],
};

console.log(JSON.stringify(out, null, 2));
