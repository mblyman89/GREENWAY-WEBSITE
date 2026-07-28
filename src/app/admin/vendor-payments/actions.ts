"use server";

/**
 * Vendor ACH payments — server actions (E9 + B6 guardrails).
 *
 * B6 change: a vendor payment must now be MARRIED to an ACCEPTED inbound
 * manifest (the WCIA "invoice"), and is guarded against over/under-paying:
 *   • payment must select an ACCEPTED (or partially-accepted) manifest
 *   • overpay (amount > remaining owed) is BLOCKED
 *   • underpay/partial (0 < amount < remaining) is ALLOWED with a WARNING
 *
 * Amount owed for a manifest = SUM(received_qty * unit_cost_minor_units) over its
 * non-rejected lots — the CCRS cost basis captured at intake. Remaining owed
 * subtracts prior payments (vendor_manifest_payments).
 *
 * Still DRAFTS-ONLY: we build a NACHA (CCD) file for manual bank upload and
 * record the payment intent. Nothing is transmitted. Money is CENTS throughout.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getAchCompanySettings } from "@/lib/payroll/payroll-store";
import type { AchOriginator } from "@/lib/payments/nacha-core";
import {
  validateVendorPayments,
  vendorPaymentsToNacha,
  checkManifestPayment,
  type VendorPayment,
  type VendorAchResult,
} from "@/lib/payments/vendor-ach-core";
import {
  listVendorPayables,
  getVendorPayable,
  recordManifestPayment,
  type PaymentMethod,
} from "@/lib/payments/vendor-payables-store";
import { isValidRouting } from "@/lib/payments/nacha-core";
import { getLinkedPoFactsForManifests } from "@/lib/payments/invoice-po-match";
import {
  compareInvoiceToPo,
  type InvoicePoComparison,
} from "@/lib/payments/invoice-po-match-core";
import { paymentReferenceLabel } from "@/lib/purchasing/po-paid-stamp-core";
import { stampPoPaidIfSettled } from "@/lib/purchasing/po-paid-stamp-store";
import {
  checkNonCannabisInvoicePayment,
  decodePayableKey,
  encodePayableKey,
  type PayableSource,
} from "@/lib/noncannabis/invoice-core";
import {
  getNonCannabisInvoicePayable,
  listNonCannabisInvoicePayables,
  recordNonCannabisInvoicePayment,
} from "@/lib/noncannabis/invoice-store";
import {
  canPayWithVaultRecord,
  detectBankTamper,
} from "@/lib/payments/payee-banking-core";
import { listVendorBankDetails } from "@/lib/payments/payee-banking-store";
import { maskAccountTail } from "@/lib/security/at-rest-crypto";

export type PayableOption = {
  /**
   * Task N: opaque payable key posted by the forms — "manifest:<id>" for
   * cannabis manifests, "ncinv:<id>" for non-cannabis paper invoices. Bare
   * ids decode as manifests for back-compat.
   */
  key: string;
  source: PayableSource;
  manifestId: string;
  manifestNumber: string;
  vendorId: string | null;
  vendorName: string;
  owedMinorUnits: number;
  paidMinorUnits: number;
  remainingMinorUnits: number;
  acceptedAt: string | null;
  lotCount: number;
  /**
   * W8 — invoice ↔ linked-PO cross-check (W5 link; read-only). `hasPo:false`
   * when the manifest isn't linked to a PO or migration 0102 isn't applied.
   */
  poComparison: InvoicePoComparison;
  /**
   * SLICE 80 — banking vault status. When the vault table (migration 0143)
   * is live, payments PULL banking from the vault: the form shows it masked
   * and manual bank entry disappears. Pre-0143 both stay null/false and the
   * legacy manual path runs unchanged.
   */
  vaultReady: boolean;
  vaultBank: {
    bankName: string;
    routingTail: string;
    accountTail: string;
    accountType: string;
    status: string;
    verified: boolean;
  } | null;
};

export type VendorPayFormResult = {
  problems: { index: number | null; vendorName: string | null; message: string }[];
  /** Non-blocking notices (e.g. partial-payment warnings) — the file still built. */
  warnings?: { index: number | null; message: string }[];
  file?: string;
  filename?: string;
  totalCents?: number;
  entryCount?: number;
};

/**
 * Load payables for the form: accepted manifests still owing money PLUS
 * non-cannabis paper invoices still owing money (Task N — the paper invoice
 * keyed in on the non-cannabis inventory page is a payable source document).
 */
export async function loadPayableOptionsAction(): Promise<PayableOption[]> {
  await requirePermission("payables.manage");
  const rows = await listVendorPayables({ includePaid: false, limit: 300 });
  // W8: cross-check each invoice against its LINKED purchase order (when the
  // W5 link exists) so the human sees "invoice vs ordered" before paying.
  // Best-effort — an empty map (pre-0102 or any failure) just means no chips.
  const poFacts = await getLinkedPoFactsForManifests(rows.map((r) => r.manifestId));
  // SLICE 80: masked vault banking per vendor (null pre-0143 / no record).
  const vault = await listVendorBankDetails();
  const vaultMap = new Map(vault.records.map((v) => [v.vendor_id, v]));
  const vaultInfo = (vendorId: string | null) => {
    if (!vault.tableReady || !vendorId) return null;
    const rec = vaultMap.get(vendorId);
    if (!rec) return null;
    return {
      bankName: rec.bank_name,
      routingTail: maskAccountTail(rec.routing),
      accountTail: maskAccountTail(rec.account_number),
      accountType: rec.account_type,
      status: rec.status,
      verified: !!rec.verified_at,
    };
  };
  const manifestOptions: PayableOption[] = rows.map((r) => ({
    key: encodePayableKey("manifest", r.manifestId),
    source: "manifest" as const,
    manifestId: r.manifestId,
    manifestNumber: r.manifestNumber,
    vendorId: r.vendorId,
    vendorName: r.vendorName,
    owedMinorUnits: r.owedMinorUnits,
    paidMinorUnits: r.paidMinorUnits,
    remainingMinorUnits: Math.max(0, r.owedMinorUnits - r.paidMinorUnits),
    acceptedAt: r.acceptedAt,
    lotCount: r.lotCount,
    poComparison: compareInvoiceToPo(r.owedMinorUnits, poFacts.get(r.manifestId) ?? null),
    vaultReady: vault.tableReady,
    vaultBank: vaultInfo(r.vendorId),
  }));

  // Non-cannabis paper invoices (merch). [] pre-migration-0112 — no forks.
  const ncRows = await listNonCannabisInvoicePayables({ includePaid: false, limit: 300 });
  const ncOptions: PayableOption[] = ncRows.map((r) => ({
    key: encodePayableKey("noncannabis_invoice", r.invoiceId),
    source: "noncannabis_invoice" as const,
    manifestId: r.invoiceId,
    manifestNumber: r.invoiceNumber,
    vendorId: r.vendorId,
    vendorName: r.vendorName,
    owedMinorUnits: r.totalMinorUnits,
    paidMinorUnits: r.paidMinorUnits,
    remainingMinorUnits: Math.max(0, r.totalMinorUnits - r.paidMinorUnits),
    acceptedAt: r.invoiceDate,
    lotCount: r.lineCount,
    poComparison: { hasPo: false },
    vaultReady: vault.tableReady,
    vaultBank: vaultInfo(r.vendorId),
  }));

  return [...manifestOptions, ...ncOptions];
}

/**
 * A resolved payable, source-agnostic (Task N). Wraps either an accepted
 * manifest or a non-cannabis paper invoice behind one shape so the guardrail /
 * NACHA / recording code has a single path. Money is CENTS.
 */
type ResolvedPayable = {
  source: PayableSource;
  id: string;
  /** Manifest number or paper-invoice number (the human label). */
  number: string;
  vendorId: string | null;
  vendorName: string;
  owedMinorUnits: number;
  paidMinorUnits: number;
};

/**
 * Resolve a posted payable key to fresh owed/paid figures. Bare ids decode as
 * manifests (back-compat with pre-Task-N forms). Null when not found.
 */
async function resolvePayable(key: string): Promise<ResolvedPayable | null> {
  const { source, id } = decodePayableKey(key);
  if (source === "noncannabis_invoice") {
    const p = await getNonCannabisInvoicePayable(id);
    if (!p) return null;
    return {
      source,
      id: p.invoiceId,
      number: p.invoiceNumber,
      vendorId: p.vendorId,
      vendorName: p.vendorName,
      owedMinorUnits: p.totalMinorUnits,
      paidMinorUnits: p.paidMinorUnits,
    };
  }
  const p = await getVendorPayable(id);
  if (!p) return null;
  return {
    source: "manifest",
    id: p.manifestId,
    number: p.manifestNumber,
    vendorId: p.vendorId,
    vendorName: p.vendorName,
    owedMinorUnits: p.owedMinorUnits,
    paidMinorUnits: p.paidMinorUnits,
  };
}

/**
 * Run the source-appropriate payment guardrail (identical policy on both
 * paths: non-payable/fully-paid BLOCKED, overpay BLOCKED, partial WARNING).
 * For manifests this re-fetches the full ManifestPayable so the status check
 * (accepted / partially_accepted) still runs exactly as before.
 */
async function checkPayablePayment(
  payable: ResolvedPayable,
  amountCents: number,
): Promise<{ severity: "ok" | "warning" | "blocked"; message: string }> {
  if (payable.source === "noncannabis_invoice") {
    return checkNonCannabisInvoicePayment(
      {
        invoiceId: payable.id,
        invoiceNumber: payable.number,
        vendorId: payable.vendorId,
        vendorName: payable.vendorName,
        status: "open",
        totalMinorUnits: payable.owedMinorUnits,
        paidMinorUnits: payable.paidMinorUnits,
      },
      amountCents,
    );
  }
  const full = await getVendorPayable(payable.id);
  if (!full) return { severity: "blocked", message: "That manifest could not be found or is no longer payable." };
  return checkManifestPayment(full, amountCents);
}

/** One parsed row from the form (before guardrail checks). */
type ParsedRow = {
  index: number; // 1-based
  /** The posted payable key ("manifest:<id>" / "ncinv:<id>" / bare id). */
  manifestId: string;
  routing: string;
  accountNumber: string;
  accountType: "checking" | "savings";
  amountCents: number;
  amountRaw: string;
};

function parseRows(formData: FormData): ParsedRow[] {
  const manifestIds = formData.getAll("manifestId").map((v) => String(v));
  const routings = formData.getAll("routing").map((v) => String(v));
  const accounts = formData.getAll("accountNumber").map((v) => String(v));
  const types = formData.getAll("accountType").map((v) => String(v));
  const amounts = formData.getAll("amountDollars").map((v) => String(v));

  const rows: ParsedRow[] = [];
  const count = Math.max(
    manifestIds.length,
    routings.length,
    accounts.length,
    amounts.length,
  );
  for (let i = 0; i < count; i++) {
    const manifestId = (manifestIds[i] ?? "").trim();
    const routing = (routings[i] ?? "").trim();
    const account = (accounts[i] ?? "").trim();
    const type = (types[i] ?? "checking").trim();
    const dollarsRaw = (amounts[i] ?? "").trim();
    // Skip fully-empty rows so trailing blanks don't create false problems.
    if (!manifestId && !routing && !account && !dollarsRaw) continue;
    const dollars = Number(dollarsRaw);
    const amountCents = Number.isFinite(dollars) ? Math.round(dollars * 100) : NaN;
    rows.push({
      index: i + 1,
      manifestId,
      routing,
      accountNumber: account,
      accountType: type === "savings" ? "savings" : "checking",
      amountCents,
      amountRaw: dollarsRaw,
    });
  }
  return rows;
}

export async function buildVendorAchAction(
  _prev: VendorPayFormResult | null,
  formData: FormData,
): Promise<VendorPayFormResult> {
  const session = await requirePermission("payables.manage");

  const settings = await getAchCompanySettings();
  const settingsComplete =
    !!settings.destination_routing && !!settings.company_name && !!settings.originating_dfi;
  if (!settingsComplete) {
    return {
      problems: [
        {
          index: null,
          vendorName: null,
          message:
            "Bank/company ACH settings are incomplete. Set them once on the Payroll page — they are shared with vendor payments.",
        },
      ],
    };
  }

  const rows = parseRows(formData);
  if (rows.length === 0) {
    return { problems: [{ index: null, vendorName: null, message: "No vendor payments to pay." }] };
  }

  // SLICE 80: when the banking vault (migration 0143) is live, banking comes
  // FROM THE VAULT — form-submitted bank fields are ignored, and any submitted
  // values that differ from the vault are blocked AND audited as tampering
  // (WA State Auditor vendor-master-file fraud guidance). Pre-0143 the legacy
  // manual-entry path below runs unchanged.
  const vault = await listVendorBankDetails();
  const vaultMap = new Map(vault.records.map((v) => [v.vendor_id, v]));

  // Resolve every referenced payable (fresh owed/paid at submit time).
  // Task N: a row may reference an accepted manifest OR a non-cannabis paper
  // invoice — resolvePayable + checkPayablePayment keep one code path.
  const problems: VendorPayFormResult["problems"] = [];
  const warnings: NonNullable<VendorPayFormResult["warnings"]> = [];
  const payableByKey = new Map<string, ResolvedPayable>();

  // Guardrail: a payable can only appear once per batch (avoid double-spend
  // math across rows of the same submit).
  const seenPayables = new Set<string>();

  for (const row of rows) {
    if (!row.manifestId) {
      problems.push({
        index: row.index,
        vendorName: null,
        message: "Select an invoice (accepted manifest or merch invoice) to pay against.",
      });
      continue;
    }
    if (seenPayables.has(row.manifestId)) {
      problems.push({
        index: row.index,
        vendorName: null,
        message: "This invoice is already selected on another row. Pay each invoice once per batch.",
      });
      continue;
    }
    seenPayables.add(row.manifestId);

    let payable = payableByKey.get(row.manifestId) ?? null;
    if (!payable) {
      payable = await resolvePayable(row.manifestId);
      if (payable) payableByKey.set(row.manifestId, payable);
    }
    if (!payable) {
      problems.push({
        index: row.index,
        vendorName: null,
        message: "That invoice could not be found or is no longer payable.",
      });
      continue;
    }

    if (vault.tableReady) {
      // Vault path: banking must exist, be complete, and not be on hold.
      const rec = payable.vendorId ? vaultMap.get(payable.vendorId) ?? null : null;
      if (!payable.vendorId) {
        problems.push({
          index: row.index,
          vendorName: payable.vendorName,
          message: `${payable.vendorName} isn't matched to a vendor record, so vault banking can't be resolved. Match the vendor first (or record a manual check/cash payment).`,
        });
      } else {
        const verdict = canPayWithVaultRecord(
          rec ? { status: rec.status, routing: rec.routing, accountNumber: rec.account_number } : null,
          payable.vendorName,
        );
        if (!verdict.ok) {
          problems.push({ index: row.index, vendorName: payable.vendorName, message: verdict.refusal });
        }
      }
      // Tamper watch: the form renders NO bank fields on the vault path, so
      // any submitted values that differ from the vault mean someone is
      // poking at the request. Block AND log — the deviation is the evidence.
      if (rec) {
        const tamper = detectBankTamper({
          submittedRouting: row.routing,
          submittedAccount: row.accountNumber,
          vaultRouting: rec.routing,
          vaultAccount: rec.account_number,
        });
        if (tamper) {
          problems.push({
            index: row.index,
            vendorName: payable.vendorName,
            message:
              "Submitted bank details do not match the vault. Payments always use the vault's banking — this attempt has been logged.",
          });
          await recordAudit({
            actorId: session.userId,
            actorEmail: session.email,
            action: "payee_banking.tamper_attempt",
            entityType: "vendor_bank_details",
            entityId: payable.vendorId,
            after: { mismatchedFields: tamper.mismatchedFields, payableKey: row.manifestId },
          }).catch(() => {});
        }
      }
    } else {
      // Legacy pre-0143 path: bank fields still typed by hand.
      if (!isValidRouting(row.routing)) {
        problems.push({
          index: row.index,
          vendorName: payable.vendorName,
          message: `Routing number "${row.routing}" fails the ABA check digit.`,
        });
      }
      if (!row.accountNumber) {
        problems.push({ index: row.index, vendorName: payable.vendorName, message: "Account number is required." });
      } else if (row.accountNumber.length > 17) {
        problems.push({ index: row.index, vendorName: payable.vendorName, message: "Account number exceeds 17 characters." });
      }
    }

    // THE GUARDRAIL: payable status + over/under check (source-appropriate).
    const check = await checkPayablePayment(payable, row.amountCents);
    if (check.severity === "blocked") {
      problems.push({ index: row.index, vendorName: payable.vendorName, message: check.message });
    } else if (check.severity === "warning") {
      warnings.push({ index: row.index, message: check.message });
    }
  }

  if (problems.length > 0) {
    return { problems, warnings };
  }

  // Build the VendorPayment[] for the NACHA file (uses the payable's vendor name).
  const payments: VendorPayment[] = rows.map((row) => {
    const payable = payableByKey.get(row.manifestId)!;
    // SLICE 80: on the vault path the NACHA entry uses VAULT banking — the
    // form values never reach the file. (Problems above guarantee rec exists.)
    const rec = vault.tableReady && payable.vendorId ? vaultMap.get(payable.vendorId) ?? null : null;
    return {
      vendorId: payable.vendorId || `${payable.source === "noncannabis_invoice" ? "ncinv" : "manifest"}-${payable.id}`,
      vendorName: payable.vendorName,
      routing: rec ? rec.routing : row.routing,
      accountNumber: rec ? rec.account_number : row.accountNumber,
      accountType: rec ? rec.account_type : row.accountType,
      amountCents: row.amountCents,
    };
  });

  const preProblems = validateVendorPayments(payments);
  if (preProblems.length > 0) {
    return { problems: preProblems, warnings };
  }

  const originator: AchOriginator = {
    destinationRouting: settings.destination_routing,
    destinationName: settings.destination_name,
    immediateOrigin: settings.immediate_origin,
    companyName: settings.company_name,
    companyId: settings.company_id,
    originatingDfi: settings.originating_dfi,
  };

  const effectiveDateRaw = String(formData.get("effectiveDate") ?? "").trim();
  const effectiveDate = effectiveDateRaw ? new Date(`${effectiveDateRaw}T00:00:00Z`) : new Date();

  const result: VendorAchResult = vendorPaymentsToNacha(payments, originator, {
    effectiveDate,
    companyEntryDescription: "VENDOR PAY",
  });

  if (!result.ok) {
    return { problems: result.problems, warnings };
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const batchRef = `vendor-ach-${stamp}-${Date.now().toString(36)}`;

  // Record each payment against its source document (persist the applied
  // amount so future over/under math is correct). Best-effort — never blocks
  // the draft. Manifests keep their exact pre-Task-N path; paper invoices go
  // to the unified ledger via recordNonCannabisInvoicePayment.
  for (const row of rows) {
    const payable = payableByKey.get(row.manifestId)!;
    const remaining = Math.max(0, payable.owedMinorUnits - payable.paidMinorUnits);
    if (payable.source === "noncannabis_invoice") {
      await recordNonCannabisInvoicePayment({
        invoiceId: payable.id,
        vendorId: payable.vendorId,
        vendorName: payable.vendorName,
        invoiceNumber: payable.number,
        amountMinorUnits: row.amountCents,
        owedMinorUnits: payable.owedMinorUnits,
        isPartial: row.amountCents < remaining,
        achBatchRef: batchRef,
        createdBy: session.userId,
      }).catch(() => null);
      continue;
    }
    await recordManifestPayment({
      manifestId: payable.id,
      vendorId: payable.vendorId,
      vendorName: payable.vendorName,
      manifestNumber: payable.number,
      amountMinorUnits: row.amountCents,
      owedMinorUnits: payable.owedMinorUnits,
      isPartial: row.amountCents < remaining,
      achBatchRef: batchRef,
      createdBy: session.userId,
    }).catch(() => null);

    // W9: if this payment settles every invoice linked to a PO, stamp the PO
    // paid so Purchasing can see it. Best-effort; no-op pre-migration 0103.
    await stampPoPaidIfSettled(
      payable.id,
      paymentReferenceLabel({ achBatchRef: batchRef, paymentMethod: "ach" }),
    ).catch(() => null);
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "vendor_ach.generate",
    entityType: "vendor_payments",
    after: {
      batchRef,
      entryCount: result.entryCount,
      totalCents: result.totalCents,
      recordCount: result.recordCount,
      manifests: rows.map((r) => r.manifestId),
      partials: warnings.length,
    },
  }).catch(() => {});

  return {
    problems: [],
    warnings,
    file: result.file,
    filename: `vendor-ach-${stamp}.txt`,
    totalCents: result.totalCents,
    entryCount: result.entryCount,
  };
}

// ---------------------------------------------------------------------------
// Non-ACH manual payment (check / cash / wire / other)
//
// Owner's requirement (verbatim): "If I'm ever required for whatever reason to
// write a check instead of ach, I need a way to tell the system that I paid via
// another method. So I dont have hanging invoices."
//
// This records a payment against an ACCEPTED manifest WITHOUT generating a NACHA
// file, so a manifest paid by check/cash/wire stops showing as an outstanding
// payable. It runs the SAME guardrails as ACH (overpay BLOCKED, partial WARNING,
// non-accepted / fully-paid BLOCKED) via checkManifestPayment. Money is CENTS.
// ---------------------------------------------------------------------------

const MANUAL_METHODS = new Set<PaymentMethod>(["check", "cash", "wire", "other"]);

export type ManualPaymentResult = {
  ok: boolean;
  /** Blocking errors (payment NOT recorded). */
  problems: string[];
  /** Non-blocking notice (e.g. partial payment recorded, balance remains). */
  warning?: string;
  /** Success confirmation message (payment recorded). */
  message?: string;
  /** Fresh remaining owed after this payment (CENTS), for the UI. */
  remainingMinorUnits?: number;
};

export async function recordManualPaymentAction(
  _prev: ManualPaymentResult | null,
  formData: FormData,
): Promise<ManualPaymentResult> {
  const session = await requirePermission("payables.manage");

  const manifestId = String(formData.get("manifestId") ?? "").trim();
  const methodRaw = String(formData.get("paymentMethod") ?? "").trim().toLowerCase();
  const reference = String(formData.get("reference") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const amountRaw = String(formData.get("amountDollars") ?? "").trim();

  const problems: string[] = [];

  if (!manifestId) {
    problems.push("Select an invoice (accepted manifest or merch invoice) to record a payment against.");
  }

  const method = methodRaw as PaymentMethod;
  if (!MANUAL_METHODS.has(method)) {
    problems.push("Choose a payment method: check, cash, wire, or other.");
  }

  // A reference is required for check/wire (so the record is auditable); cash
  // and other may omit it but a note is encouraged.
  if ((method === "check" || method === "wire") && !reference) {
    problems.push(
      method === "check"
        ? "Enter the check number as the reference."
        : "Enter the wire confirmation/reference.",
    );
  }

  const dollars = Number(amountRaw);
  const amountCents = Number.isFinite(dollars) ? Math.round(dollars * 100) : NaN;
  if (!amountRaw || !Number.isFinite(dollars) || amountCents <= 0) {
    problems.push("Enter a payment amount greater than $0.00.");
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }

  // Resolve the payable fresh (owed/paid at submit time). Task N: this may be
  // an accepted manifest OR a non-cannabis paper invoice (opaque key).
  const payable = await resolvePayable(manifestId);
  if (!payable) {
    return {
      ok: false,
      problems: ["That invoice could not be found or is no longer payable."],
    };
  }

  // THE GUARDRAIL — identical policy on both source-document paths.
  const check = await checkPayablePayment(payable, amountCents);
  if (check.severity === "blocked") {
    return {
      ok: false,
      problems: [check.message],
      remainingMinorUnits: Math.max(0, payable.owedMinorUnits - payable.paidMinorUnits),
    };
  }

  const remaining = Math.max(0, payable.owedMinorUnits - payable.paidMinorUnits);
  const isPartial = amountCents < remaining;

  const recorded =
    payable.source === "noncannabis_invoice"
      ? await recordNonCannabisInvoicePayment({
          invoiceId: payable.id,
          vendorId: payable.vendorId,
          vendorName: payable.vendorName,
          invoiceNumber: payable.number,
          amountMinorUnits: amountCents,
          owedMinorUnits: payable.owedMinorUnits,
          isPartial,
          paymentMethod: method,
          reference: reference || null,
          note: note || null,
          createdBy: session.userId,
        })
      : await recordManifestPayment({
          manifestId: payable.id,
          vendorId: payable.vendorId,
          vendorName: payable.vendorName,
          manifestNumber: payable.number,
          amountMinorUnits: amountCents,
          owedMinorUnits: payable.owedMinorUnits,
          isPartial,
          paymentMethod: method,
          reference: reference || null,
          note: note || null,
          createdBy: session.userId,
        });

  if (!recorded) {
    return {
      ok: false,
      problems: ["Could not save the payment. Please try again or check the database connection."],
    };
  }

  // W9: if this payment settles every invoice linked to a PO, stamp the PO
  // paid so Purchasing can see it. Best-effort; no-op pre-migration 0103.
  // (Paper invoices have no PO link — manifests only.)
  if (payable.source === "manifest") {
    await stampPoPaidIfSettled(
      payable.id,
      paymentReferenceLabel({ reference: reference || null, paymentMethod: method }),
    ).catch(() => null);
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "vendor_payment.manual_record",
    entityType: "vendor_manifest_payments",
    entityId: recorded.id,
    after: {
      source: payable.source,
      manifestId: payable.source === "manifest" ? payable.id : null,
      noncannabisInvoiceId: payable.source === "noncannabis_invoice" ? payable.id : null,
      manifestNumber: payable.number,
      vendorName: payable.vendorName,
      amountCents,
      owedCents: payable.owedMinorUnits,
      paymentMethod: method,
      reference: reference || null,
      isPartial,
    },
  }).catch(() => {});

  revalidatePath("/admin/vendor-payments");
  revalidatePath("/admin/inventory/noncannabis");

  const remainingAfter = Math.max(0, remaining - amountCents);
  const methodLabel = method.charAt(0).toUpperCase() + method.slice(1);
  const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const docLabel = payable.source === "noncannabis_invoice" ? "merch invoice" : "manifest";

  if (isPartial) {
    return {
      ok: true,
      problems: [],
      warning: `Partial ${methodLabel.toLowerCase()} payment of ${usd(amountCents)} recorded for ${docLabel} #${payable.number}. Balance of ${usd(remainingAfter)} remains outstanding.`,
      remainingMinorUnits: remainingAfter,
    };
  }

  return {
    ok: true,
    problems: [],
    message: `${methodLabel} payment of ${usd(amountCents)} recorded for ${docLabel} #${payable.number}. This ${docLabel} is now paid in full and cleared from payables.`,
    remainingMinorUnits: remainingAfter,
  };
}
