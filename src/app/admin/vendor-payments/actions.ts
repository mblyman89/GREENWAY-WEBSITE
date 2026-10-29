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
import { requirePermission, type StaffSession } from "@/lib/auth/session";
import { achGate } from "@/lib/payments/ach-gate";
import { vendorBuildOutcome, type RedirectOutcome } from "@/lib/payments/ach-gate-core";
import { recordAudit } from "@/lib/auth/audit";
import { getOriginatorReadiness } from "@/lib/payroll/payroll-store";
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
import { listManualAdjustments, writeManualAdjustment } from "@/lib/inventory/invoice-adjustments-store";
import { formatUsdCents, validateManualCredit } from "@/lib/inventory/invoice-adjustments-core";
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
  vaultPayDisplay,
} from "@/lib/payments/payee-banking-core";
import { listVendorBankDetails } from "@/lib/payments/payee-banking-store";
import { optOutPayRefusal } from "@/lib/payments/vendor-ach-enrollment-core";
import { listVendorAchFlags } from "@/lib/payments/vendor-ach-enrollment-store";
import { maskAccountTail } from "@/lib/security/at-rest-crypto";
import { releaseAchFile } from "@/lib/payments/ach-file-ledger-store";
import { checkEffectiveDateForTimberland } from "@/lib/payments/timberland-deadline-core";
import { pacificDayKey } from "@/lib/reports/timezone";

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
   * D-72 (books-92). Lots on this manifest that are NOT samples and have no
   * unit cost keyed yet. When above zero the owed figure is INCOMPLETE: the
   * bill engine refuses the manifest with BILL_LOT_COST_UNKNOWN rather than
   * post a partial payable, so paying against this total would underpay.
   * Zero for paper invoices, whose totals come from the invoice itself.
   */
  unpricedLotCount: number;
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
    /**
     * R39 S3: computed server-side by the SAME gate the pay action uses
     * (canPayWithVaultRecord) and the vault badge — the client only shows
     * them, so the form can never call revoked/archived/unknown "payable".
     */
    payable: boolean;
    statusLabel: string;
    blockedReason: string | null;
  } | null;
};

export type VendorPayFormResult = {
  problems: { index: number | null; vendorName: string | null; message: string }[];
  /** Non-blocking notices (e.g. partial-payment warnings) — the file still built. */
  warnings?: { index: number | null; message: string }[];
  /** R41 S4: gold notes when a released file takes Timberland's daily or monthly room to 80% or more. */
  limitWarnings?: string[];
  /** R41 S5: "Wed Oct 21, 3:30 pm Pacific (bank cutoff 4:00 pm)": upload AND approve at Timberland by then. */
  uploadBy?: string;
  /** R41 S5: set when released after our 3:30 pm target (still before the 4:00 pm cutoff). */
  deadlineWarning?: string | null;
  file?: string;
  filename?: string;
  totalCents?: number;
  entryCount?: number;
  /** R41 S0: a plain-words note that is not a problem (e.g. "Sent to Michael for approval..."). */
  notice?: string;
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
      ...vaultPayDisplay(rec),
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
    unpricedLotCount: r.unpricedLotCount,
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
    // A paper invoice states its own total; there is no per-lot cost to miss.
    unpricedLotCount: 0,
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

/** Requests land in `notice` (not a problem); refusals land in the file-level problem slot. */
function buildReply(r: RedirectOutcome): VendorPayFormResult {
  return r.ok ? { problems: [], notice: r.message } : { problems: [{ index: null, vendorName: null, message: r.message }] };
}

/**
 * R41 S0 / D-4: only Michael (ach.act) builds vendor ACH files; Stephen
 * (ach.request) sends the batch to Michael, and nothing is recorded until he
 * approves it on the approvals page (which hands the file to his browser).
 * Managers keep Accounts Payable (payables.manage) but no longer build files.
 */
export async function buildVendorAchAction(
  _prev: VendorPayFormResult | null,
  formData: FormData,
): Promise<VendorPayFormResult> {
  return achGate("vendor_ach.build", formData, { reply: buildReply, outcomeOf: vendorBuildOutcome }, (session) => buildVendorAchBody(session, formData));
}

async function buildVendorAchBody(session: StaffSession, formData: FormData): Promise<VendorPayFormResult> {
  // R41 S2: one readiness answer (settings + company EIN vs Timberland's setup).
  const { readiness } = await getOriginatorReadiness();
  if (!readiness.originator) {
    return {
      problems: readiness.problems.map((message) => ({ index: null, vendorName: null, message: `${message} (Banking > My banking.)` })),
    };
  }
  const originator = readiness.originator;

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
  // R39 S4: a vendor marked "opted out" on its page is never paid by ACH,
  // whatever the vault says (check/cash/wire still work via the manual path).
  // Empty before 0258, so nothing changes until the columns exist.
  const achFlags = await listVendorAchFlags();

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

    if (payable.vendorId) {
      const flags = achFlags.byVendor.get(payable.vendorId);
      const refusal = flags ? optOutPayRefusal(flags, payable.vendorName) : null;
      if (refusal) problems.push({ index: row.index, vendorName: payable.vendorName, message: refusal });
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

  // R41 S5: the effective date is REQUIRED and must meet Timberland's
  // deadline (Schedule A: uploaded and approved 2 usable banking days ahead,
  // by 4:00 pm Pacific). No fallback to today: a blank or late date is refused
  // with the earliest date that still works. releaseLoop checks it again with
  // the same clock, so this cannot be skipped.
  const effectiveDateRaw = String(formData.get("effectiveDate") ?? "").trim();
  const now = new Date();
  const deadline = checkEffectiveDateForTimberland(effectiveDateRaw, now);
  if (!deadline.ok) {
    return { problems: [{ index: null, vendorName: null, message: `Effective date: ${deadline.error}` }], warnings };
  }
  const effectiveYmd = deadline.date;
  const effectiveDate = new Date(`${effectiveYmd}T00:00:00Z`);

  // R41 S3: the file is RELEASED ONCE into the ach_files ledger (0273) with
  // today's next File ID Modifier, BEFORE any payment is recorded: a
  // duplicate (same payments, same effective date) is refused by the
  // database and nothing is marked paid. The browser gets the stored bytes.
  const stamp = pacificDayKey(now);
  const batchRef = `vendor-ach-${stamp}-${now.getTime().toString(36)}`;
  const filename = `vendor-ach-${stamp}-${batchRef.slice(-8)}.ach`;
  let result: VendorAchResult | null = null;
  const released = await releaseAchFile({
    kind: "vendor",
    sourceId: batchRef,
    actorId: session.userId,
    now,
    effectiveDate: effectiveYmd,
    filename,
    build: (fileIdModifier) => {
      result = vendorPaymentsToNacha(payments, originator, { effectiveDate, companyEntryDescription: "VENDOR PAY", createdAt: now, fileIdModifier });
      return result.ok ? { ok: true, file: result.file, entryCount: result.entryCount, totalCents: result.totalCents } : { ok: false, error: result.problems.map((p) => p.message).join(" ") };
    },
  });
  const built = result as VendorAchResult | null;
  if (built && !built.ok) {
    return { problems: built.problems, warnings };
  }
  if (!released.ok || !built) {
    return { problems: [{ index: null, vendorName: null, message: released.ok ? "The vendor file was not built. Reload the page." : released.error }], warnings };
  }

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
      achFileId: released.id,
      fileIdModifier: released.modifier,
      entryCount: released.entryCount,
      totalCents: released.totalCents,
      recordCount: built.recordCount,
      manifests: rows.map((r) => r.manifestId),
      partials: warnings.length,
      limitWarnings: released.limitWarnings,
      effectiveDate: effectiveYmd,
      uploadBy: released.uploadBy,
    },
  }).catch(() => {});

  return {
    problems: [],
    warnings,
    limitWarnings: released.limitWarnings,
    uploadBy: released.uploadBy,
    deadlineWarning: released.deadlineWarning,
    file: released.body,
    filename: released.filename,
    totalCents: released.totalCents,
    entryCount: released.entryCount,
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

// ---------------------------------------------------------------------------
// Fix 3.4 — credits / discounts added by hand before paying an invoice.
// Owner (verbatim): "if the system isnt able to work out if there is a credit
// or discount, i need a way to add a credit or discount to the invoice before
// paying for it in the vendor payments page."
// Stored on inbound_manifests.invoice_manual_adjustments (migration 0322);
// never deleted, only voided with a reason. Owed on this page and the vendor
// bill (60900 trade-discount line) both subtract the live credits.
// ---------------------------------------------------------------------------

export type InvoiceCreditResult = { ok: boolean; message?: string; error?: string };

export type InvoiceCreditView = {
  id: string;
  kind: string;
  amountMinor: number;
  reason: string;
  at: string;
  voided: boolean;
  voidReason: string | null;
};

export async function listInvoiceCreditsAction(payableKey: string): Promise<InvoiceCreditView[]> {
  await requirePermission("payables.manage");
  const { source, id } = decodePayableKey(String(payableKey ?? ""));
  if (source !== "manifest" || !id) return [];
  const list = (await listManualAdjustments(id)) ?? [];
  return list.map((m) => ({
    id: m.id,
    kind: m.kind,
    amountMinor: m.amountMinor,
    reason: m.reason,
    at: m.at,
    voided: Boolean(m.voidedAt),
    voidReason: m.voidReason ?? null,
  }));
}

export async function addInvoiceCreditAction(
  _prev: InvoiceCreditResult | null,
  formData: FormData,
): Promise<InvoiceCreditResult> {
  const session = await requirePermission("payables.manage");
  const { source, id } = decodePayableKey(String(formData.get("payableKey") ?? ""));
  if (source !== "manifest" || !id) {
    return { ok: false, error: "Pick a delivery (manifest) invoice. Merch invoices take credits on the non-cannabis invoice itself." };
  }
  const payable = await getVendorPayable(id);
  if (!payable) return { ok: false, error: "That invoice is not open for payment (not accepted, or already paid)." };
  const remaining = payable.owedMinorUnits - payable.paidMinorUnits;
  const v = validateManualCredit({
    amountText: String(formData.get("amountDollars") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    kind: String(formData.get("kind") ?? "credit"),
    remainingOwedMinor: remaining,
  });
  if (!v.ok) return { ok: false, error: v.error };
  const res = await writeManualAdjustment(
    id,
    { add: { kind: v.kind, amountMinor: v.amountMinor, reason: v.reason, by: session.email ?? session.userId } },
    session.userId,
  );
  if (!res.ok) return { ok: false, error: res.error };
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "vendor_invoice.credit_added",
    entityType: "inbound_manifest",
    entityId: id,
    after: { kind: v.kind, amountMinor: v.amountMinor, reason: v.reason, entryId: res.entry.id },
  }).catch(() => {});
  revalidatePath("/admin/vendor-payments");
  revalidatePath("/admin/inventory/intake");
  return {
    ok: true,
    message: `${formatUsdCents(v.amountMinor)} ${v.kind.replace("_", " ")} added to manifest #${payable.manifestNumber}. It now owes ${formatUsdCents(Math.max(0, remaining + v.amountMinor))}.`,
  };
}

export async function voidInvoiceCreditAction(
  _prev: InvoiceCreditResult | null,
  formData: FormData,
): Promise<InvoiceCreditResult> {
  const session = await requirePermission("payables.manage");
  const { source, id } = decodePayableKey(String(formData.get("payableKey") ?? ""));
  const entryId = String(formData.get("entryId") ?? "").trim();
  const voidReason = String(formData.get("voidReason") ?? "").replace(/\s+/g, " ").trim();
  if (source !== "manifest" || !id || !entryId) return { ok: false, error: "Pick the credit to void." };
  if (voidReason.length < 3) return { ok: false, error: "Say why this credit is being voided." };
  const res = await writeManualAdjustment(id, { voidId: entryId, voidReason, by: session.email ?? session.userId }, session.userId);
  if (!res.ok) return { ok: false, error: res.error };
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "vendor_invoice.credit_voided",
    entityType: "inbound_manifest",
    entityId: id,
    after: { entryId, voidReason },
  }).catch(() => {});
  revalidatePath("/admin/vendor-payments");
  revalidatePath("/admin/inventory/intake");
  return { ok: true, message: "Credit voided. The invoice owes the full amount again." };
}
