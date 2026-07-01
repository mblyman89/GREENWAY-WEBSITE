/**
 * vendor-ach-core.ts — PURE adapter: vendor payables → a NACHA ACH file draft
 * (Slice 98). Reuses the existing, tested nacha-core builder.
 *
 * No I/O, no `server-only`, no Supabase — unit-testable under tsx.
 *
 * DRAFTS-ONLY (standing rule): this produces a file for EMPLOYEE REVIEW and manual
 * upload to the bank. It NEVER transmits to a bank and NEVER moves money. Vendor
 * payments are corporate-to-corporate, so the SEC code is CCD (per Nacha rules).
 *
 * MONEY IN MINOR UNITS: every amount is CENTS (integer), matching the standing rule.
 */

import {
  buildNachaFile,
  isValidRouting,
  type AchEntry,
  type AchOriginator,
  type BuildNachaResult,
} from "@/lib/payments/nacha-core";

/** One vendor bill to pay. Amount in CENTS (integer, > 0). */
export type VendorPayment = {
  /** Stable vendor identifier (for the ACH id field + our audit trail). */
  vendorId: string;
  /** Vendor's legal/DBA name (goes on their statement). */
  vendorName: string;
  /** Vendor bank 9-digit ABA routing number. */
  routing: string;
  /** Vendor bank account number (≤17 chars). */
  accountNumber: string;
  /** "checking" | "savings" — sets the ACH transaction code. */
  accountType: "checking" | "savings";
  /** Amount owed, in CENTS. Must be a positive integer. */
  amountCents: number;
};

export type VendorPaymentProblem = {
  /** null = file-level; otherwise the 1-based payment index. */
  index: number | null;
  vendorName: string | null;
  message: string;
};

export type VendorAchResult =
  | { ok: true; file: string; totalCents: number; entryCount: number; recordCount: number; problems: VendorPaymentProblem[] }
  | { ok: false; problems: VendorPaymentProblem[] };

/**
 * Validate a list of vendor payments WITHOUT building the file. PURE. Returns a
 * list of problems (empty when every payment is bank-ready). Never throws.
 */
export function validateVendorPayments(payments: ReadonlyArray<VendorPayment>): VendorPaymentProblem[] {
  const problems: VendorPaymentProblem[] = [];
  if (payments.length === 0) {
    problems.push({ index: null, vendorName: null, message: "No vendor payments to pay." });
    return problems;
  }
  payments.forEach((p, i) => {
    const idx = i + 1;
    const name = p.vendorName || p.vendorId || null;
    if (!p.vendorName || !p.vendorName.trim()) {
      problems.push({ index: idx, vendorName: name, message: "Vendor name is required." });
    }
    if (!isValidRouting(p.routing)) {
      problems.push({ index: idx, vendorName: name, message: `Routing number "${p.routing}" fails the ABA check digit.` });
    }
    if (!p.accountNumber || !p.accountNumber.trim()) {
      problems.push({ index: idx, vendorName: name, message: "Account number is required." });
    } else if (p.accountNumber.trim().length > 17) {
      problems.push({ index: idx, vendorName: name, message: "Account number exceeds 17 characters." });
    }
    if (!Number.isInteger(p.amountCents)) {
      problems.push({ index: idx, vendorName: name, message: `Amount (cents) "${p.amountCents}" must be a whole number of cents.` });
    } else if (p.amountCents <= 0) {
      problems.push({ index: idx, vendorName: name, message: "Amount must be greater than zero." });
    }
    if (p.accountType !== "checking" && p.accountType !== "savings") {
      problems.push({ index: idx, vendorName: name, message: 'Account type must be "checking" or "savings".' });
    }
  });
  return problems;
}

/**
 * Build a NACHA (CCD) ACH file DRAFT from vendor payments. PURE. Validates first;
 * on any problem returns ok:false with the problems (no file). Never throws.
 *
 * The result is a DRAFT for employee review + manual bank upload — nothing is
 * transmitted here.
 */
export function vendorPaymentsToNacha(
  payments: ReadonlyArray<VendorPayment>,
  originator: AchOriginator,
  opts?: { effectiveDate?: Date; companyEntryDescription?: string; fileIdModifier?: string; createdAt?: Date },
): VendorAchResult {
  const problems = validateVendorPayments(payments);
  if (problems.length > 0) {
    return { ok: false, problems };
  }

  const entries: AchEntry[] = payments.map((p) => ({
    accountType: p.accountType,
    routing: p.routing,
    accountNumber: p.accountNumber,
    amountCents: p.amountCents,
    name: p.vendorName,
    idNumber: p.vendorId,
  }));

  const result: BuildNachaResult = buildNachaFile({
    originator,
    entries,
    secCode: "CCD", // vendor = corporate credit
    companyEntryDescription: opts?.companyEntryDescription || "VENDOR PAY",
    effectiveDate: opts?.effectiveDate ?? new Date(),
    createdAt: opts?.createdAt,
    fileIdModifier: opts?.fileIdModifier,
  });

  if (!result.ok) {
    return { ok: false, problems: [{ index: null, vendorName: null, message: result.error }] };
  }
  return {
    ok: true,
    file: result.file,
    totalCents: result.totalCents,
    entryCount: result.entryCount,
    recordCount: result.recordCount,
    problems: [],
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run via tsx). Pure — no I/O.
// ---------------------------------------------------------------------------
export function __runVendorAchTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  const originator: AchOriginator = {
    destinationRouting: "021000021", // valid ABA (Chase)
    destinationName: "TIMBERLAND BANK",
    immediateOrigin: "1123456789",
    companyName: "GREENWAY MARIJUANA",
    companyId: "1123456789",
    originatingDfi: "02100002",
  };

  const goodPayment = (over: Partial<VendorPayment> = {}): VendorPayment => ({
    vendorId: "V-1",
    vendorName: "Acme Farms LLC",
    routing: "021000021",
    accountNumber: "123456789",
    accountType: "checking",
    amountCents: 125000,
    ...over,
  });

  // Valid batch builds a file.
  const built = vendorPaymentsToNacha([goodPayment(), goodPayment({ vendorId: "V-2", vendorName: "Beta Extracts", amountCents: 5000 })], originator, {
    effectiveDate: new Date(Date.UTC(2025, 5, 16, 12, 0, 0)),
  });
  ok(built.ok === true, "valid vendor batch builds");
  if (built.ok) {
    ok(built.entryCount === 2, "2 entries");
    ok(built.totalCents === 130000, "total cents summed");
    ok(built.file.length > 0 && built.file.includes("\n"), "file has content");
    // NACHA records are 94 chars/line.
    const firstLine = built.file.split(/\r?\n/)[0];
    ok(firstLine.length === 94, "94-char record length");
  }

  // Empty batch → not ok.
  const empty = vendorPaymentsToNacha([], originator);
  ok(empty.ok === false, "empty batch rejected");

  // Bad routing → not ok, with a routing problem.
  const badRouting = vendorPaymentsToNacha([goodPayment({ routing: "021000022" })], originator);
  ok(badRouting.ok === false, "bad routing rejected");
  if (!badRouting.ok) ok(badRouting.problems.some((p) => /check digit/i.test(p.message)), "routing problem reported");

  // Negative amount → not ok.
  const negAmt = vendorPaymentsToNacha([goodPayment({ amountCents: -100 })], originator);
  ok(negAmt.ok === false, "negative amount rejected");

  // Non-integer cents → not ok.
  const fracAmt = vendorPaymentsToNacha([goodPayment({ amountCents: 12.5 })], originator);
  ok(fracAmt.ok === false, "fractional cents rejected");

  // Missing name → not ok.
  const noName = vendorPaymentsToNacha([goodPayment({ vendorName: "" })], originator);
  ok(noName.ok === false, "missing name rejected");

  // Over-long account → not ok.
  const longAcct = vendorPaymentsToNacha([goodPayment({ accountNumber: "123456789012345678" })], originator);
  ok(longAcct.ok === false, "over-long account rejected");

  // validateVendorPayments standalone: clean batch → no problems.
  ok(validateVendorPayments([goodPayment()]).length === 0, "clean validation empty");

  if (failed === 0) console.log(`vendor-ach-core: all ${passed} tests passed`);
  return { passed, failed };
}
