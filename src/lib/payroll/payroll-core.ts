/**
 * src/lib/payroll/payroll-core.ts  (Slice B — manual-entry payroll → ACH)
 *
 * PURE logic for the owner's clarified workflow: the owner runs payroll in
 * Sage MANUALLY, gets paystubs, then TYPES the amounts owed into the back
 * office. We are NOT importing from Sage — we give tidy input fields, add
 * up/verify the totals, and turn the net-pay amounts into a NACHA direct-
 * deposit file the owner uploads to Timberland (Jack Henry).
 *
 * No I/O, no server-only imports — unit-testable with tsx. All money is in
 * CENTS (integer minor units) to avoid float drift.
 */

import type { AchEntry } from "@/lib/payments/nacha-core";
import { isValidRouting } from "@/lib/payments/nacha-core";

/** Parse a user-typed dollar amount ("$1,234.56", "1234.5", "") into integer
 * cents. Returns null when the field is blank; throws-free — bad input → null. */
export function dollarsToCents(input: string | null | undefined): number | null {
  const raw = (input ?? "").replace(/[$,\s]/g, "").trim();
  if (raw === "") return null;
  if (!/^-?\d*(\.\d{0,2})?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Format integer cents as a plain dollar string, e.g. 150000 → "1500.00". */
export function centsToDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const d = Math.floor(abs / 100);
  const c = abs % 100;
  return `${sign}${d}.${String(c).padStart(2, "0")}`;
}

/** The manual-entry line the owner fills per employee, straight off the paystub.
 * Everything is in CENTS. Only net pay is required for the ACH; gross / taxes /
 * deductions are recorded for the run's books and reconciliation. */
export type PayrollLineInput = {
  employeeId: string;
  employeeName: string;
  /** Net pay = the amount actually deposited (the ACH amount). Required, > 0. */
  netPayCents: number;
  /** Recorded totals off the paystub (optional but reconciled if present). */
  grossPayCents?: number | null;
  taxesCents?: number | null;
  deductionsCents?: number | null;
  /** Banking (prefilled from the employee's stored banking; editable). */
  accountType: "checking" | "savings";
  routing: string;
  accountNumber: string;
};

export type LineValidation = {
  employeeId: string;
  employeeName: string;
  errors: string[];
  /** Whether gross - taxes - deductions ties out to net (when all provided). */
  reconciles: boolean | null;
  /** The difference gross-(taxes+deductions)-net in cents, when computable. */
  reconcileDeltaCents: number | null;
};

/** Validate a single payroll line. Net pay must be positive; if gross+taxes+
 * deductions are all present, check they reconcile to net. */
export function validateLine(line: PayrollLineInput): LineValidation {
  const errors: string[] = [];
  if (!line.employeeName?.trim()) errors.push("Employee name is required.");
  if (!Number.isInteger(line.netPayCents) || line.netPayCents <= 0) {
    errors.push("Net pay must be a positive amount.");
  }
  if (!isValidRouting(line.routing)) {
    errors.push("Routing number is not a valid 9-digit ABA number.");
  }
  if (!line.accountNumber?.replace(/\s/g, "")) {
    errors.push("Account number is required.");
  }
  for (const [label, v] of [
    ["Gross pay", line.grossPayCents],
    ["Taxes", line.taxesCents],
    ["Deductions", line.deductionsCents],
  ] as const) {
    if (v != null && (!Number.isInteger(v) || v < 0)) {
      errors.push(`${label} must be a non-negative amount.`);
    }
  }

  let reconciles: boolean | null = null;
  let delta: number | null = null;
  const { grossPayCents: g, taxesCents: t, deductionsCents: d, netPayCents: n } = line;
  if (g != null && t != null && d != null) {
    delta = g - t - d - n;
    reconciles = delta === 0;
    if (!reconciles) {
      errors.push(
        `Gross − taxes − deductions (${centsToDollars(g - t - d)}) doesn't equal net pay (${centsToDollars(n)}).`,
      );
    }
  }

  return { employeeId: line.employeeId, employeeName: line.employeeName, errors, reconciles, reconcileDeltaCents: delta };
}

export type PayrollTotals = {
  net: number;
  gross: number;
  taxes: number;
  deductions: number;
  count: number;
};

/** Running totals across all lines (missing optionals treated as 0 for sums). */
export function sumTotals(lines: PayrollLineInput[]): PayrollTotals {
  return lines.reduce<PayrollTotals>(
    (acc, l) => ({
      net: acc.net + (l.netPayCents || 0),
      gross: acc.gross + (l.grossPayCents || 0),
      taxes: acc.taxes + (l.taxesCents || 0),
      deductions: acc.deductions + (l.deductionsCents || 0),
      count: acc.count + 1,
    }),
    { net: 0, gross: 0, taxes: 0, deductions: 0, count: 0 },
  );
}

export type PayrollValidation = {
  ok: boolean;
  lines: LineValidation[];
  totals: PayrollTotals;
  /** Global errors not tied to one line. */
  errors: string[];
};

/** Validate an entire manual-entry payroll run. */
export function validatePayrollRun(lines: PayrollLineInput[]): PayrollValidation {
  const errors: string[] = [];
  if (lines.length === 0) errors.push("Add at least one employee line.");
  // Duplicate employee guard.
  const seen = new Set<string>();
  for (const l of lines) {
    if (seen.has(l.employeeId)) errors.push(`Employee ${l.employeeName} appears more than once.`);
    seen.add(l.employeeId);
  }
  const lineResults = lines.map(validateLine);
  const ok = errors.length === 0 && lineResults.every((r) => r.errors.length === 0);
  return { ok, lines: lineResults, totals: sumTotals(lines), errors };
}

/** Map validated payroll lines → NACHA PPD credit entries (net pay). */
export function linesToAchEntries(lines: PayrollLineInput[]): AchEntry[] {
  return lines.map((l) => ({
    accountType: l.accountType,
    routing: l.routing,
    accountNumber: l.accountNumber,
    amountCents: l.netPayCents,
    name: l.employeeName,
    idNumber: l.employeeId.slice(0, 15),
  }));
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runPayrollCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // money parsing
  ok(dollarsToCents("$1,234.56") === 123456, "dollarsToCents strips $ and ,");
  ok(dollarsToCents("1500") === 150000, "dollarsToCents whole");
  ok(dollarsToCents("1500.5") === 150050, "dollarsToCents 1 decimal");
  ok(dollarsToCents("") === null, "dollarsToCents blank → null");
  ok(dollarsToCents("abc") === null, "dollarsToCents garbage → null");
  ok(dollarsToCents("1.234") === null, "dollarsToCents >2 decimals → null");
  ok(centsToDollars(150000) === "1500.00", "centsToDollars");
  ok(centsToDollars(5) === "0.05", "centsToDollars small");

  const good: PayrollLineInput = {
    employeeId: "e1",
    employeeName: "Jane Doe",
    netPayCents: 150000,
    grossPayCents: 200000,
    taxesCents: 40000,
    deductionsCents: 10000,
    accountType: "checking",
    routing: "021000021",
    accountNumber: "123456789",
  };
  const gv = validateLine(good);
  ok(gv.errors.length === 0, "good line no errors");
  ok(gv.reconciles === true && gv.reconcileDeltaCents === 0, "good line reconciles");

  const mismatch = validateLine({ ...good, netPayCents: 140000 });
  ok(mismatch.reconciles === false, "mismatch flagged");
  ok(mismatch.errors.some((e) => e.includes("doesn't equal net pay")), "mismatch error msg");

  const badRouting = validateLine({ ...good, routing: "021000022" });
  ok(badRouting.errors.some((e) => e.includes("ABA")), "bad routing error");

  const zeroNet = validateLine({ ...good, netPayCents: 0, grossPayCents: null, taxesCents: null, deductionsCents: null });
  ok(zeroNet.errors.some((e) => e.includes("Net pay")), "zero net error");
  ok(zeroNet.reconciles === null, "no reconcile when optionals absent");

  // totals
  const totals = sumTotals([good, { ...good, employeeId: "e2", netPayCents: 100000, grossPayCents: 120000, taxesCents: 15000, deductionsCents: 5000 }]);
  ok(totals.net === 250000 && totals.count === 2, "totals net + count");
  ok(totals.gross === 320000 && totals.taxes === 55000 && totals.deductions === 15000, "totals breakdown");

  // run validation + duplicate guard
  const run = validatePayrollRun([good, { ...good, employeeId: "e2", employeeName: "John Roe", netPayCents: 90000, grossPayCents: null, taxesCents: null, deductionsCents: null }]);
  ok(run.ok, "valid run ok");
  const dup = validatePayrollRun([good, good]);
  ok(!dup.ok && dup.errors.some((e) => e.includes("more than once")), "duplicate employee blocked");
  const empty = validatePayrollRun([]);
  ok(!empty.ok, "empty run blocked");

  // ach mapping
  const entries = linesToAchEntries([good]);
  ok(entries.length === 1 && entries[0].amountCents === 150000 && entries[0].name === "Jane Doe", "lines→ach entries");
  ok(entries[0].accountType === "checking" && entries[0].routing === "021000021", "ach entry banking mapped");

  console.log(`payroll-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
