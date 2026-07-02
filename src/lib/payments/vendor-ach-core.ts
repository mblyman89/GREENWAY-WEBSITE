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

// ---------------------------------------------------------------------------
// MANIFEST-BACKED GUARDRAILS (B6)
//
// A vendor ACH payment must be married to an ACCEPTED inbound manifest (the
// "invoice"). The amount owed for a manifest is the CCRS cost basis:
//   owed = SUM(received_qty * unit_cost_minor_units) over its non-rejected lots.
// We subtract what has already been paid to get the REMAINING owed. Then:
//   • overpay  (amount > remaining)  = BLOCKED (error)
//   • underpay (0 < amount < remaining) = allowed WITH WARNING
//   • exact                          = clean
// All amounts CENTS (integer). PURE — no I/O.
// ---------------------------------------------------------------------------

/** A payable derived from an accepted manifest + what we've already paid. */
export type ManifestPayable = {
  manifestId: string;
  manifestNumber: string;
  vendorId: string | null;
  vendorName: string;
  /** Manifest status; must be an accepted state to be payable. */
  status: string;
  /** SUM(received_qty * unit_cost_minor_units) over non-rejected lots, CENTS. */
  owedMinorUnits: number;
  /** SUM of prior payments applied to this manifest, CENTS. */
  paidMinorUnits: number;
};

/** Manifest statuses we consider "accepted" (payable). */
export const PAYABLE_MANIFEST_STATUSES = new Set(["accepted", "partially_accepted"]);

export type PaymentCheckSeverity = "ok" | "warning" | "blocked";

export type PaymentCheck = {
  severity: PaymentCheckSeverity;
  /** Remaining owed = owed - alreadyPaid (never below 0 for display). */
  remainingMinorUnits: number;
  /** Human-readable explanation. */
  message: string;
};

/** True if a manifest is in a payable (accepted) state. */
export function isPayableManifest(payable: Pick<ManifestPayable, "status">): boolean {
  return PAYABLE_MANIFEST_STATUSES.has((payable.status || "").toLowerCase());
}

/** Remaining owed for a payable (owed - paid), clamped at 0. PURE. */
export function remainingOwed(payable: Pick<ManifestPayable, "owedMinorUnits" | "paidMinorUnits">): number {
  const remaining = (payable.owedMinorUnits || 0) - (payable.paidMinorUnits || 0);
  return remaining > 0 ? remaining : 0;
}

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Check ONE proposed payment against ONE manifest payable. PURE. Returns a
 * severity (ok | warning | blocked) with a message. Never throws.
 *
 *   - manifest not accepted           -> blocked
 *   - amount not a positive integer   -> blocked
 *   - nothing left to pay (remaining 0) -> blocked
 *   - amount > remaining (overpay)    -> blocked
 *   - 0 < amount < remaining (partial)-> warning (allowed)
 *   - amount === remaining            -> ok
 */
export function checkManifestPayment(
  payable: ManifestPayable,
  amountMinorUnits: number,
): PaymentCheck {
  const remaining = remainingOwed(payable);

  if (!isPayableManifest(payable)) {
    return {
      severity: "blocked",
      remainingMinorUnits: remaining,
      message: `Manifest ${payable.manifestNumber || payable.manifestId} is not accepted (status: ${payable.status}). Payment must be married to an ACCEPTED manifest.`,
    };
  }
  if (!Number.isInteger(amountMinorUnits) || amountMinorUnits <= 0) {
    return {
      severity: "blocked",
      remainingMinorUnits: remaining,
      message: "Payment amount must be a whole number of cents greater than zero.",
    };
  }
  if (remaining <= 0) {
    return {
      severity: "blocked",
      remainingMinorUnits: 0,
      message: `Manifest ${payable.manifestNumber || payable.manifestId} is already fully paid (${usd(payable.paidMinorUnits)} of ${usd(payable.owedMinorUnits)}). Nothing left to pay.`,
    };
  }
  if (amountMinorUnits > remaining) {
    return {
      severity: "blocked",
      remainingMinorUnits: remaining,
      message: `Overpayment blocked: paying ${usd(amountMinorUnits)} exceeds the remaining ${usd(remaining)} owed on manifest ${payable.manifestNumber || payable.manifestId} (owed ${usd(payable.owedMinorUnits)}, already paid ${usd(payable.paidMinorUnits)}).`,
    };
  }
  if (amountMinorUnits < remaining) {
    return {
      severity: "warning",
      remainingMinorUnits: remaining,
      message: `Partial payment: ${usd(amountMinorUnits)} is less than the remaining ${usd(remaining)} owed on manifest ${payable.manifestNumber || payable.manifestId}. Allowed — the balance of ${usd(remaining - amountMinorUnits)} will remain outstanding.`,
    };
  }
  return {
    severity: "ok",
    remainingMinorUnits: remaining,
    message: `Pays the manifest in full (${usd(amountMinorUnits)}).`,
  };
}

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

  // ---- Manifest-backed guardrails (B6) ------------------------------------
  const payable = (over: Partial<ManifestPayable> = {}): ManifestPayable => ({
    manifestId: "M-1",
    manifestNumber: "15410217973875889",
    vendorId: "vendor-1",
    vendorName: "Freddy's Fuego",
    status: "accepted",
    owedMinorUnits: 19995, // $199.95 (from the real invoice/transfer sample)
    paidMinorUnits: 0,
    ...over,
  });

  // Exact full payment → ok.
  const exact = checkManifestPayment(payable(), 19995);
  ok(exact.severity === "ok", "exact full payment is ok");
  ok(exact.remainingMinorUnits === 19995, "remaining equals owed when nothing paid");

  // Underpayment → warning (allowed).
  const under = checkManifestPayment(payable(), 10000);
  ok(under.severity === "warning", "underpay is a warning (allowed)");

  // Overpayment → blocked.
  const over = checkManifestPayment(payable(), 20000);
  ok(over.severity === "blocked", "overpay is blocked");
  ok(/overpayment blocked/i.test(over.message), "overpay message");

  // Partially-paid manifest: remaining subtracts prior payments.
  const partial = checkManifestPayment(payable({ paidMinorUnits: 15000 }), 4995);
  ok(partial.severity === "ok", "pays remaining balance exactly");
  ok(partial.remainingMinorUnits === 4995, "remaining = owed - paid");

  // Overpay relative to REMAINING (not owed) is blocked.
  const overRemaining = checkManifestPayment(payable({ paidMinorUnits: 15000 }), 5000);
  ok(overRemaining.severity === "blocked", "overpay vs remaining blocked");

  // Fully-paid manifest → blocked (nothing left).
  const done = checkManifestPayment(payable({ paidMinorUnits: 19995 }), 100);
  ok(done.severity === "blocked", "fully paid manifest blocks further payment");
  ok(done.remainingMinorUnits === 0, "remaining 0 when fully paid");

  // Non-accepted manifest → blocked regardless of amount.
  const notAccepted = checkManifestPayment(payable({ status: "received" }), 19995);
  ok(notAccepted.severity === "blocked", "non-accepted manifest blocked");

  // partially_accepted is payable.
  ok(isPayableManifest({ status: "partially_accepted" }) === true, "partially_accepted is payable");
  ok(isPayableManifest({ status: "pending" }) === false, "pending not payable");

  // Zero/negative amount → blocked.
  ok(checkManifestPayment(payable(), 0).severity === "blocked", "zero amount blocked");
  ok(checkManifestPayment(payable(), -5).severity === "blocked", "negative amount blocked");

  // remainingOwed clamps at 0.
  ok(remainingOwed({ owedMinorUnits: 100, paidMinorUnits: 200 }) === 0, "remaining clamps at 0");

  if (failed === 0) console.log(`vendor-ach-core: all ${passed} tests passed`);
  return { passed, failed };
}
