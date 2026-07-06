/**
 * src/lib/payroll/payroll-guardrails-core.ts
 *
 * PURE guardrail logic for payroll → ACH generation. No I/O, no server-only
 * imports — fully unit-testable with tsx. The store gathers the facts (recent
 * runs, each employee's payment history, the linked source document) and hands
 * them to `evaluatePayrollGuardrails`, which returns a list of findings the UI
 * renders and the generate action enforces.
 *
 * Owner's explicit requirements (verbatim item 3):
 *   (a) "I will upload the payroll data … block payments unless there is a
 *        source document to tie it to."  → SOURCE_DOCUMENT hard block.
 *   (b) "only one payment to one employee every two weeks"
 *        → EMPLOYEE_CADENCE hard block (14-day window per employee).
 *   (c) "no more than one check per two week period"
 *        → PERIOD_CADENCE hard block (one generated file per 14-day window).
 *
 * Expert, research-backed additions (Nacha 2026 Risk Management Rules require
 * originators to run risk-based, LAYERED fraud monitoring; RMAG best practices):
 *   - DUPLICATE payment detection (same employee + same net + within window).
 *   - AMOUNT_CEILING red flags (per-employee and per-run sanity limits).
 *   - BANK_ACCOUNT_CHANGED red flag (employee's banking differs from last paid).
 *   - DUAL_CONTROL note (creator releasing their own file = logged self-approval).
 *
 * All money is in CENTS (integer minor units).
 */

/** The pay cadence window in days. Owner said "every two weeks" = 14 days. */
export const CADENCE_DAYS = 14;

/** Default sanity ceilings (cents). Not legal limits — fraud red flags only.
 * Chosen high enough not to nag on normal pay; tune later if needed. */
export const DEFAULT_PER_EMPLOYEE_CEILING_CENTS = 2_000_000; // $20,000 net / run
export const DEFAULT_PER_RUN_CEILING_CENTS = 20_000_000; // $200,000 total / run

export type GuardrailSeverity = "block" | "warn" | "info";

export type GuardrailCode =
  | "SOURCE_DOCUMENT" // (a) hard block — no uploaded payroll data tied to run
  | "EMPLOYEE_CADENCE" // (b) hard block — employee paid within the last 14 days
  | "PERIOD_CADENCE" // (c) hard block — a file was already generated this 14-day window
  | "DUPLICATE_PAYMENT" // red flag — same employee + same amount + within window
  | "AMOUNT_CEILING_EMPLOYEE" // red flag — a line exceeds the per-employee ceiling
  | "AMOUNT_CEILING_RUN" // red flag — run total exceeds the per-run ceiling
  | "BANK_ACCOUNT_CHANGED" // red flag — banking differs from the employee's last payment
  | "DUAL_CONTROL"; // info — self-approval (creator === releaser)

export type GuardrailFinding = {
  code: GuardrailCode;
  severity: GuardrailSeverity;
  /** Plain-language message shown to the owner/manager. */
  message: string;
  /** Optional employee this finding is about (line-level findings). */
  employeeId?: string | null;
  employeeName?: string | null;
  /** Whether an admin may consciously override this finding. Blocks (a-c) are
   * NOT overridable; red-flag warnings are. */
  overridable: boolean;
};

/** A minimal record of a past payment to one employee, for history checks. */
export type EmployeePaymentHistory = {
  employeeId: string;
  /** ISO date (YYYY-MM-DD) the employee was last PAID via a generated run. */
  lastPaidDate: string | null;
  lastPaidNetCents: number | null;
  /** The banking last used to pay this employee (for change detection). */
  lastRouting: string | null;
  lastAccountNumber: string | null;
};

/** The lines about to be paid on this run (post-validation snapshot). */
export type GuardrailLine = {
  employeeId: string;
  employeeName: string;
  netPayCents: number;
  routing: string;
  accountNumber: string;
};

export type GuardrailInput = {
  /** The run's ACH effective / pay date (YYYY-MM-DD). */
  payDate: string;
  lines: GuardrailLine[];
  /** True when a source document is tied to the run. */
  hasSourceDocument: boolean;
  /** ISO dates (YYYY-MM-DD) of any OTHER generated runs in the ±window. Used
   * for the "one check per two-week period" period cadence block. */
  otherGeneratedRunDates: string[];
  /** Per-employee payment history (last generated payment). */
  history: EmployeePaymentHistory[];
  /** Dual control: is the releaser the same person who created the run? */
  releaserIsCreator?: boolean;
  /** Optional overrides for the sanity ceilings. */
  perEmployeeCeilingCents?: number;
  perRunCeilingCents?: number;
};

export type GuardrailReport = {
  findings: GuardrailFinding[];
  /** True when there is at least one non-overridable BLOCK finding. */
  hasHardBlock: boolean;
  /** True when there are only overridable warnings (no hard blocks). */
  hasWarnings: boolean;
  totalNetCents: number;
};

/** Whole-day difference |a − b| between two YYYY-MM-DD dates (UTC, calendar). */
export function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((da - db) / 86_400_000));
}

/** Normalise banking for change detection (ignore spaces/leading zeros noise). */
function bankKey(routing: string | null, account: string | null): string {
  return `${(routing ?? "").replace(/\D/g, "")}|${(account ?? "").replace(/\s/g, "")}`;
}

/**
 * Evaluate every guardrail against the run about to be generated. Returns a
 * report the UI shows and the generate action enforces (it must refuse when
 * `hasHardBlock` is true, unless — for WARN findings only — an override is on).
 */
export function evaluatePayrollGuardrails(input: GuardrailInput): GuardrailReport {
  const findings: GuardrailFinding[] = [];
  const perEmp = input.perEmployeeCeilingCents ?? DEFAULT_PER_EMPLOYEE_CEILING_CENTS;
  const perRun = input.perRunCeilingCents ?? DEFAULT_PER_RUN_CEILING_CENTS;
  const historyById = new Map(input.history.map((h) => [h.employeeId, h]));
  const totalNetCents = input.lines.reduce((s, l) => s + (l.netPayCents || 0), 0);

  // (a) SOURCE DOCUMENT — hard block. Owner: "block payments unless there is a
  //     source document to tie it to."
  if (!input.hasSourceDocument) {
    findings.push({
      code: "SOURCE_DOCUMENT",
      severity: "block",
      overridable: false,
      message:
        "No payroll source document is attached. Upload the payroll data (your Sage register / paystub export) and tie it to this run before generating the file.",
    });
  }

  // (c) PERIOD CADENCE — hard block. Owner: "no more than one check per two
  //     week period." If ANOTHER run already produced a file within 14 days of
  //     this pay date, block.
  const collidingPeriod = input.otherGeneratedRunDates.find(
    (d) => daysBetween(d, input.payDate) < CADENCE_DAYS,
  );
  if (collidingPeriod) {
    findings.push({
      code: "PERIOD_CADENCE",
      severity: "block",
      overridable: false,
      message: `Another payroll file was already generated on ${collidingPeriod}, which is within ${CADENCE_DAYS} days of this pay date. Only one payroll file is allowed per two-week period.`,
    });
  }

  // Per-line checks.
  for (const line of input.lines) {
    const h = historyById.get(line.employeeId);

    // (b) EMPLOYEE CADENCE — hard block. Owner: "only one payment to one
    //     employee every two weeks."
    if (h?.lastPaidDate) {
      const gap = daysBetween(h.lastPaidDate, input.payDate);
      if (gap < CADENCE_DAYS) {
        findings.push({
          code: "EMPLOYEE_CADENCE",
          severity: "block",
          overridable: false,
          employeeId: line.employeeId,
          employeeName: line.employeeName,
          message: `${line.employeeName} was last paid on ${h.lastPaidDate} (${gap} day${gap === 1 ? "" : "s"} ago). Employees can only be paid once every ${CADENCE_DAYS} days.`,
        });

        // DUPLICATE within the window with the SAME net amount is an extra red
        // flag (possible re-run of the same period).
        if (h.lastPaidNetCents != null && h.lastPaidNetCents === line.netPayCents) {
          findings.push({
            code: "DUPLICATE_PAYMENT",
            severity: "warn",
            overridable: true,
            employeeId: line.employeeId,
            employeeName: line.employeeName,
            message: `${line.employeeName}'s net pay ($${(line.netPayCents / 100).toFixed(2)}) is identical to the last payment on ${h.lastPaidDate} — this looks like a duplicate.`,
          });
        }
      }
    }

    // AMOUNT CEILING (per employee) — red flag, overridable.
    if (line.netPayCents > perEmp) {
      findings.push({
        code: "AMOUNT_CEILING_EMPLOYEE",
        severity: "warn",
        overridable: true,
        employeeId: line.employeeId,
        employeeName: line.employeeName,
        message: `${line.employeeName}'s net pay ($${(line.netPayCents / 100).toFixed(2)}) is above the usual per-employee ceiling ($${(perEmp / 100).toFixed(2)}). Confirm it is correct.`,
      });
    }

    // BANK ACCOUNT CHANGED — red flag, overridable. Nacha account-validation /
    // out-of-band best practice: verify changed payment instructions.
    if (h && (h.lastRouting || h.lastAccountNumber)) {
      const before = bankKey(h.lastRouting, h.lastAccountNumber);
      const now = bankKey(line.routing, line.accountNumber);
      if (before !== now) {
        findings.push({
          code: "BANK_ACCOUNT_CHANGED",
          severity: "warn",
          overridable: true,
          employeeId: line.employeeId,
          employeeName: line.employeeName,
          message: `${line.employeeName}'s bank account changed since their last payment. Verify the new routing/account directly with the employee before sending.`,
        });
      }
    }
  }

  // AMOUNT CEILING (run total) — red flag, overridable.
  if (totalNetCents > perRun) {
    findings.push({
      code: "AMOUNT_CEILING_RUN",
      severity: "warn",
      overridable: true,
      message: `This run's total ($${(totalNetCents / 100).toFixed(2)}) is above the usual per-run ceiling ($${(perRun / 100).toFixed(2)}). Confirm it is correct.`,
    });
  }

  // DUAL CONTROL — info. A second person releasing the file is best practice;
  // self-approval is allowed but recorded.
  if (input.releaserIsCreator) {
    findings.push({
      code: "DUAL_CONTROL",
      severity: "info",
      overridable: true,
      message:
        "You created and are releasing this file yourself (self-approval). For extra protection, have a second admin review and release payroll files.",
    });
  }

  const hasHardBlock = findings.some((f) => f.severity === "block" && !f.overridable);
  const hasWarnings = findings.some((f) => f.severity === "warn");
  return { findings, hasHardBlock, hasWarnings, totalNetCents };
}

/** Does this report permit generation, given whether the admin turned on an
 * override for the soft warnings? Hard blocks are NEVER bypassable. */
export function guardrailsPermitGeneration(
  report: GuardrailReport,
  overrideWarnings: boolean,
): boolean {
  if (report.hasHardBlock) return false;
  if (report.hasWarnings && !overrideWarnings) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runPayrollGuardrailsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // daysBetween
  ok(daysBetween("2026-07-06", "2026-07-06") === 0, "daysBetween same day = 0");
  ok(daysBetween("2026-07-06", "2026-06-22") === 14, "daysBetween 14");
  ok(daysBetween("2026-07-06", "2026-06-30") === 6, "daysBetween 6");

  const baseLine: GuardrailLine = {
    employeeId: "e1",
    employeeName: "Jane Doe",
    netPayCents: 150000,
    routing: "021000021",
    accountNumber: "123456789",
  };

  // (a) missing source document = hard block
  const noDoc = evaluatePayrollGuardrails({
    payDate: "2026-07-06",
    lines: [baseLine],
    hasSourceDocument: false,
    otherGeneratedRunDates: [],
    history: [],
  });
  ok(noDoc.hasHardBlock, "missing source doc → hard block");
  ok(noDoc.findings.some((f) => f.code === "SOURCE_DOCUMENT" && !f.overridable), "SOURCE_DOCUMENT not overridable");
  ok(!guardrailsPermitGeneration(noDoc, true), "override cannot bypass source-doc block");

  // clean run with doc, no history = permitted
  const clean = evaluatePayrollGuardrails({
    payDate: "2026-07-06",
    lines: [baseLine],
    hasSourceDocument: true,
    otherGeneratedRunDates: [],
    history: [],
  });
  ok(!clean.hasHardBlock && !clean.hasWarnings, "clean run has no block/warn");
  ok(guardrailsPermitGeneration(clean, false), "clean run permitted");

  // (b) employee paid 6 days ago = hard block
  const empCadence = evaluatePayrollGuardrails({
    payDate: "2026-07-06",
    lines: [baseLine],
    hasSourceDocument: true,
    otherGeneratedRunDates: [],
    history: [{ employeeId: "e1", lastPaidDate: "2026-06-30", lastPaidNetCents: 140000, lastRouting: "021000021", lastAccountNumber: "123456789" }],
  });
  ok(empCadence.findings.some((f) => f.code === "EMPLOYEE_CADENCE" && f.severity === "block"), "employee cadence block");
  ok(empCadence.hasHardBlock, "employee cadence → hard block");

  // exactly 14 days ago = allowed (not < 14)
  const exactly14 = evaluatePayrollGuardrails({
    payDate: "2026-07-06",
    lines: [baseLine],
    hasSourceDocument: true,
    otherGeneratedRunDates: [],
    history: [{ employeeId: "e1", lastPaidDate: "2026-06-22", lastPaidNetCents: 150000, lastRouting: "021000021", lastAccountNumber: "123456789" }],
  });
  ok(!exactly14.findings.some((f) => f.code === "EMPLOYEE_CADENCE"), "14 days apart is allowed");

  // duplicate: paid 6 days ago with SAME amount → cadence block + duplicate warn
  const dup = evaluatePayrollGuardrails({
    payDate: "2026-07-06",
    lines: [baseLine],
    hasSourceDocument: true,
    otherGeneratedRunDates: [],
    history: [{ employeeId: "e1", lastPaidDate: "2026-07-01", lastPaidNetCents: 150000, lastRouting: "021000021", lastAccountNumber: "123456789" }],
  });
  ok(dup.findings.some((f) => f.code === "DUPLICATE_PAYMENT" && f.severity === "warn"), "duplicate payment flagged");

  // (c) another file within 14 days = period block
  const periodBlock = evaluatePayrollGuardrails({
    payDate: "2026-07-06",
    lines: [baseLine],
    hasSourceDocument: true,
    otherGeneratedRunDates: ["2026-06-30"],
    history: [],
  });
  ok(periodBlock.findings.some((f) => f.code === "PERIOD_CADENCE" && f.severity === "block"), "period cadence block");
  ok(periodBlock.hasHardBlock, "period cadence → hard block");

  // another file exactly 14 days apart = allowed
  const periodOk = evaluatePayrollGuardrails({
    payDate: "2026-07-06",
    lines: [baseLine],
    hasSourceDocument: true,
    otherGeneratedRunDates: ["2026-06-22"],
    history: [],
  });
  ok(!periodOk.findings.some((f) => f.code === "PERIOD_CADENCE"), "14-days-apart period allowed");

  // amount ceilings (per employee + per run)
  const bigLine: GuardrailLine = { ...baseLine, netPayCents: 3_000_000 };
  const ceiling = evaluatePayrollGuardrails({
    payDate: "2026-07-06",
    lines: [bigLine],
    hasSourceDocument: true,
    otherGeneratedRunDates: [],
    history: [],
  });
  ok(ceiling.findings.some((f) => f.code === "AMOUNT_CEILING_EMPLOYEE" && f.overridable), "per-employee ceiling warn overridable");
  ok(!ceiling.hasHardBlock && ceiling.hasWarnings, "ceiling is warn not block");
  ok(!guardrailsPermitGeneration(ceiling, false), "warn blocks generation until overridden");
  ok(guardrailsPermitGeneration(ceiling, true), "warn can be overridden");

  // bank account change red flag
  const changed = evaluatePayrollGuardrails({
    payDate: "2026-07-06",
    lines: [{ ...baseLine, accountNumber: "999999999" }],
    hasSourceDocument: true,
    otherGeneratedRunDates: [],
    history: [{ employeeId: "e1", lastPaidDate: "2026-06-01", lastPaidNetCents: 150000, lastRouting: "021000021", lastAccountNumber: "123456789" }],
  });
  ok(changed.findings.some((f) => f.code === "BANK_ACCOUNT_CHANGED" && f.overridable), "bank change red flag");

  // dual control info
  const selfApprove = evaluatePayrollGuardrails({
    payDate: "2026-07-06",
    lines: [baseLine],
    hasSourceDocument: true,
    otherGeneratedRunDates: [],
    history: [],
    releaserIsCreator: true,
  });
  ok(selfApprove.findings.some((f) => f.code === "DUAL_CONTROL" && f.severity === "info"), "dual control info");
  ok(!selfApprove.hasHardBlock, "self-approval is not a block");
  ok(guardrailsPermitGeneration(selfApprove, false), "self-approval info does not block");

  console.log(`payroll-guardrails-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
