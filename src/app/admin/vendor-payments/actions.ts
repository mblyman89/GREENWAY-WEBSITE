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
  type VendorPayableRow,
} from "@/lib/payments/vendor-payables-store";
import { isValidRouting } from "@/lib/payments/nacha-core";

export type PayableOption = {
  manifestId: string;
  manifestNumber: string;
  vendorId: string | null;
  vendorName: string;
  owedMinorUnits: number;
  paidMinorUnits: number;
  remainingMinorUnits: number;
  acceptedAt: string | null;
  lotCount: number;
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

/** Load payables for the form (accepted manifests still owing money). */
export async function loadPayableOptionsAction(): Promise<PayableOption[]> {
  await requirePermission("settings.manage");
  const rows = await listVendorPayables({ includePaid: false, limit: 300 });
  return rows.map((r) => ({
    manifestId: r.manifestId,
    manifestNumber: r.manifestNumber,
    vendorId: r.vendorId,
    vendorName: r.vendorName,
    owedMinorUnits: r.owedMinorUnits,
    paidMinorUnits: r.paidMinorUnits,
    remainingMinorUnits: Math.max(0, r.owedMinorUnits - r.paidMinorUnits),
    acceptedAt: r.acceptedAt,
    lotCount: r.lotCount,
  }));
}

/** One parsed row from the form (before guardrail checks). */
type ParsedRow = {
  index: number; // 1-based
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
  const session = await requirePermission("settings.manage");

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

  // Resolve every referenced payable (fresh owed/paid at submit time).
  const problems: VendorPayFormResult["problems"] = [];
  const warnings: NonNullable<VendorPayFormResult["warnings"]> = [];
  const payableById = new Map<string, VendorPayableRow>();

  // Guardrail: a manifest can only appear once per batch (avoid double-spend
  // math across rows of the same submit).
  const seenManifests = new Set<string>();

  for (const row of rows) {
    if (!row.manifestId) {
      problems.push({
        index: row.index,
        vendorName: null,
        message: "Select an accepted manifest (invoice) to pay against.",
      });
      continue;
    }
    if (seenManifests.has(row.manifestId)) {
      problems.push({
        index: row.index,
        vendorName: null,
        message: "This manifest is already selected on another row. Pay each manifest once per batch.",
      });
      continue;
    }
    seenManifests.add(row.manifestId);

    let payable = payableById.get(row.manifestId) ?? null;
    if (!payable) {
      payable = await getVendorPayable(row.manifestId);
      if (payable) payableById.set(row.manifestId, payable);
    }
    if (!payable) {
      problems.push({
        index: row.index,
        vendorName: null,
        message: "That manifest could not be found or is no longer payable.",
      });
      continue;
    }

    // Bank fields still required.
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

    // THE GUARDRAIL: accepted + over/under check.
    const check = checkManifestPayment(payable, row.amountCents);
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
    const payable = payableById.get(row.manifestId)!;
    return {
      vendorId: payable.vendorId || `manifest-${payable.manifestId}`,
      vendorName: payable.vendorName,
      routing: row.routing,
      accountNumber: row.accountNumber,
      accountType: row.accountType,
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

  // Record each payment against its manifest (persist the applied amount so
  // future over/under math is correct). Best-effort — never blocks the draft.
  for (const row of rows) {
    const payable = payableById.get(row.manifestId)!;
    const remaining = Math.max(0, payable.owedMinorUnits - payable.paidMinorUnits);
    await recordManifestPayment({
      manifestId: payable.manifestId,
      vendorId: payable.vendorId,
      vendorName: payable.vendorName,
      manifestNumber: payable.manifestNumber,
      amountMinorUnits: row.amountCents,
      owedMinorUnits: payable.owedMinorUnits,
      isPartial: row.amountCents < remaining,
      achBatchRef: batchRef,
      createdBy: session.userId,
    }).catch(() => null);
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
