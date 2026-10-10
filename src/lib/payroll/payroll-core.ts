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
import {
  allocateSplit,
  normalizeAccountKey,
  payable as authorizationPayable,
  AUTHORIZATION_STATES,
  type AuthorizationState,
  type SplitRule,
} from "@/lib/payments/ach-authorization-core";

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
// R39 S3 — split deposits (owner answers Q4 + Q11: credits only, up to 3
// accounts per employee). One payroll LINE per employee (the duplicate guard
// above stays); the NACHA file may carry up to 3 ENTRIES for that line.
// ---------------------------------------------------------------------------

/** One deposit account on an employee's signed ACH authorization (decrypted, server-side only). */
export type SplitDepositAccount = {
  priority: number;
  rule: SplitRule;
  routing: string;
  accountNumber: string;
  accountType: "checking" | "savings";
  verificationStatus: string;
};

/** An employee's authorization as payroll sees it (null = none on file). */
export type EmployeeDepositPlan = {
  state: string;
  accounts: SplitDepositAccount[];
};

export type PlannedEntries =
  | {
      ok: true;
      entries: AchEntry[];
      /** Plain notes for the screen (single-account fallback, $0 legs skipped, shared accounts). */
      notes: string[];
      /** Per employee: how many entries went in the file. */
      perEmployee: { employeeId: string; entries: number; split: boolean }[];
    }
  | { ok: false; errors: string[] };

/**
 * Turn validated payroll lines into NACHA entries, honouring split deposits.
 *
 *  - No authorization on file: one entry to the account on the employee
 *    record (today's behaviour), and a note says so — never silent.
 *  - Authorization on file: it must be payable (only "active"; the same
 *    payable() the rest of R39 uses) and EVERY account on it must be
 *    verified. Then allocateSplit() divides net pay; $0 legs are skipped.
 *    Anything else blocks THAT employee with a reason a person can act on.
 *  - The same bank account receiving money for two different employees is a
 *    payroll-fraud red flag (Nacha/WA auditor guidance); it is reported as a
 *    note, not a block, because spouses can share an account.
 *
 * The result always sums to the run's net total exactly, or it refuses.
 */
export function planPayrollEntries(
  lines: readonly PayrollLineInput[],
  plans: ReadonlyMap<string, EmployeeDepositPlan>,
): PlannedEntries {
  const errors: string[] = [];
  const notes: string[] = [];
  const entries: AchEntry[] = [];
  const perEmployee: { employeeId: string; entries: number; split: boolean }[] = [];
  const owners = new Map<string, Set<string>>(); // account key -> employee names
  const own = (key: string, name: string) => {
    const set = owners.get(key) ?? new Set<string>();
    set.add(name);
    owners.set(key, set);
  };

  for (const l of lines) {
    const id = l.employeeId.slice(0, 15);
    const plan = plans.get(l.employeeId) ?? null;
    if (!plan) {
      entries.push({ accountType: l.accountType, routing: l.routing, accountNumber: l.accountNumber, amountCents: l.netPayCents, name: l.employeeName, idNumber: id });
      own(normalizeAccountKey(l.routing, l.accountNumber, l.accountType), l.employeeName);
      perEmployee.push({ employeeId: l.employeeId, entries: 1, split: false });
      notes.push(`${l.employeeName}: no signed ACH authorization in the vault yet, so pay goes to the single account on their employee record.`);
      continue;
    }
    const known = (AUTHORIZATION_STATES as readonly string[]).includes(plan.state);
    if (!known) {
      errors.push(`${l.employeeName}: authorization status "${plan.state}" is not one payroll knows. Nothing is paid until an admin fixes it.`);
      continue;
    }
    const pay = authorizationPayable(plan.state as AuthorizationState);
    if (!pay.ok) {
      errors.push(`${l.employeeName}: ${pay.reason}`);
      continue;
    }
    const unverified = plan.accounts.filter((a) => a.verificationStatus !== "verified");
    if (unverified.length > 0) {
      errors.push(`${l.employeeName}: ${unverified.length} deposit account(s) not verified yet (prenote, test credit or callback). Verify them in the vault first.`);
      continue;
    }
    const bad = plan.accounts.find((a) => !isValidRouting(a.routing) || !a.accountNumber.replace(/\s/g, ""));
    if (bad) {
      errors.push(`${l.employeeName}: a deposit account has an invalid routing number or no account number (could the encryption key be missing?).`);
      continue;
    }
    const keyed = plan.accounts.map((a) => ({ ...a, accountKey: normalizeAccountKey(a.routing, a.accountNumber, a.accountType) }));
    const alloc = allocateSplit(l.netPayCents, keyed.map((a) => ({ accountKey: a.accountKey, priority: a.priority, rule: a.rule })));
    if (!alloc.ok) {
      errors.push(`${l.employeeName}: ${alloc.errors.join(" ")}`);
      continue;
    }
    let sent = 0;
    for (const leg of alloc.lines) {
      const acct = keyed.find((a) => a.accountKey === leg.accountKey)!;
      if (!leg.send) {
        notes.push(`${l.employeeName}: the account ending ${acct.accountNumber.slice(-4)} gets $0.00 this run (net pay was used up by higher-priority accounts), so it is left out of the file.`);
        continue;
      }
      entries.push({ accountType: acct.accountType, routing: acct.routing, accountNumber: acct.accountNumber, amountCents: leg.cents, name: l.employeeName, idNumber: id });
      own(acct.accountKey, l.employeeName);
      sent += 1;
    }
    perEmployee.push({ employeeId: l.employeeId, entries: sent, split: plan.accounts.length > 1 });
  }

  for (const [key, names] of owners) {
    if (names.size > 1) {
      notes.push(`The account ending ${key.split(":")[1].slice(-4)} receives pay for ${[...names].join(" and ")}. Confirm this is intended (a shared account is a common payroll-fraud sign).`);
    }
  }
  if (errors.length) return { ok: false, errors };

  const want = lines.reduce((t, l) => t + l.netPayCents, 0);
  const got = entries.reduce((t, e) => t + e.amountCents, 0);
  if (want !== got) {
    return { ok: false, errors: [`Internal check failed: entries add up to ${centsToDollars(got)} but net pay is ${centsToDollars(want)}. No file was built.`] };
  }
  return { ok: true, entries, notes, perEmployee };
}

export type DepositAuthRow = { id: string; employee_id: string; state: string };
export type DepositAcctRow = {
  authorization_id: string;
  priority: number;
  rule_kind: "fixed" | "percent" | "remainder";
  fixed_cents: number | null;
  basis_points: number | null;
  routing_enc: string;
  account_enc: string;
  account_type: "checking" | "savings";
  verification_status: string;
};

/** Pure: 0258 rows -> plans (decrypt injected). One open authorization per employee or it throws. */
export function rowsToDepositPlans(auths: readonly DepositAuthRow[], accts: readonly DepositAcctRow[], decrypt: (s: string) => string): Map<string, EmployeeDepositPlan> {
  const byAuth = new Map<string, SplitDepositAccount[]>();
  for (const a of accts) {
    const rule: SplitDepositAccount["rule"] =
      a.rule_kind === "fixed"
        ? { kind: "fixed", cents: Number(a.fixed_cents) }
        : a.rule_kind === "percent"
          ? { kind: "percent", basisPoints: Number(a.basis_points) }
          : { kind: "remainder" };
    const list = byAuth.get(a.authorization_id) ?? [];
    list.push({
      priority: a.priority,
      rule,
      routing: decrypt(a.routing_enc),
      accountNumber: decrypt(a.account_enc),
      accountType: a.account_type,
      verificationStatus: a.verification_status,
    });
    byAuth.set(a.authorization_id, list);
  }
  const plans = new Map<string, EmployeeDepositPlan>();
  for (const auth of auths) {
    if (plans.has(auth.employee_id)) {
      // 0258 allows only one open authorization per employee; two means the
      // index is missing. Refuse rather than guess which one is real.
      throw new Error(`Employee ${auth.employee_id} has more than one open ACH authorization. Fix the vault before running payroll.`);
    }
    plans.set(auth.employee_id, { state: auth.state, accounts: (byAuth.get(auth.id) ?? []).sort((x, y) => x.priority - y.priority) });
  }
  return plans;
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

  // R39 S3: split deposits
  const acct = (priority: number, rule: SplitRule, accountNumber: string, verificationStatus = "verified"): SplitDepositAccount => ({
    priority,
    rule,
    routing: "021000021",
    accountNumber,
    accountType: "checking",
    verificationStatus,
  });
  const jane: PayrollLineInput = { ...good, grossPayCents: null, taxesCents: null, deductionsCents: null, netPayCents: 123457 };
  const three: EmployeeDepositPlan = {
    state: "active",
    accounts: [acct(1, { kind: "fixed", cents: 10000 }, "111"), acct(2, { kind: "percent", basisPoints: 1000 }, "222"), acct(3, { kind: "remainder" }, "333")],
  };
  const sp = planPayrollEntries([jane], new Map([["e1", three]]));
  ok(sp.ok && sp.entries.map((e) => e.amountCents).join() === "10000,12345,101112", "3-way split amounts");
  ok(sp.ok && sp.entries.every((e) => e.name === "Jane Doe" && e.idNumber === "e1"), "split legs carry the employee");
  ok(sp.ok && sp.perEmployee[0].entries === 3 && sp.perEmployee[0].split, "perEmployee counts legs");
  const none = planPayrollEntries([jane], new Map());
  ok(none.ok && none.entries.length === 1 && none.entries[0].accountNumber === "123456789", "no plan → single account on file");
  ok(none.ok && none.notes.some((n) => /no signed ACH authorization/.test(n)), "single-account fallback is visible");
  const held = planPayrollEntries([jane], new Map([["e1", { ...three, state: "on_hold" }]]));
  ok(!held.ok && /On hold/.test(held.errors[0]), "on_hold authorization blocks the employee");
  const weird = planPayrollEntries([jane], new Map([["e1", { ...three, state: "ACTIVE" }]]));
  ok(!weird.ok && /not one payroll knows/.test(weird.errors[0]), "unknown state blocks");
  const unv = planPayrollEntries([jane], new Map([["e1", { state: "active", accounts: [acct(1, { kind: "remainder" }, "9", "pending")] }]]));
  ok(!unv.ok && /not verified/.test(unv.errors[0]), "unverified account blocks");
  const small = planPayrollEntries([{ ...jane, netPayCents: 5000 }], new Map([["e1", three]]));
  ok(small.ok && small.entries.length === 1 && small.entries[0].amountCents === 5000, "$0 legs skipped, total intact");
  ok(small.ok && small.notes.filter((n) => /gets \$0.00/.test(n)).length === 2, "each skipped leg noted");
  const shared = planPayrollEntries(
    [jane, { ...jane, employeeId: "e2", employeeName: "John Roe" }],
    new Map(),
  );
  ok(shared.ok && shared.notes.some((n) => /Jane Doe and John Roe/.test(n)), "shared account across employees flagged");
  const four = planPayrollEntries([jane], new Map([["e1", { state: "active", accounts: [...three.accounts, acct(4, { kind: "fixed", cents: 1 }, "444")] }]]));
  ok(!four.ok && /At most 3/.test(four.errors[0]), "4 accounts refused");

  console.log(`payroll-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
