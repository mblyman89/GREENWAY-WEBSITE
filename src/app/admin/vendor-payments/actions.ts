"use server";

/**
 * Vendor ACH payments — server actions (E9).
 *
 * The vendor ACH CORE logic already existed (src/lib/payments/vendor-ach-core.ts:
 * validateVendorPayments + vendorPaymentsToNacha) but had NO UI. This mirrors
 * the payroll ACH page: staff enter vendor payment lines, we validate, then
 * build a NACHA (CCD) draft for manual bank upload. Nothing is transmitted.
 *
 * Reuses the SAME company/bank originator settings as payroll
 * (getAchCompanySettings) so there is one bank configuration, not two.
 *
 * Money is handled in CENTS end-to-end (minor units).
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getAchCompanySettings } from "@/lib/payroll/payroll-store";
import type { AchOriginator } from "@/lib/payments/nacha-core";
import {
  validateVendorPayments,
  vendorPaymentsToNacha,
  type VendorPayment,
  type VendorAchResult,
} from "@/lib/payments/vendor-ach-core";

export type VendorPayFormResult = {
  problems: { index: number | null; vendorName: string | null; message: string }[];
  file?: string;
  filename?: string;
  totalCents?: number;
  entryCount?: number;
};

/** Parse the repeated form rows into VendorPayment[] (amounts entered in dollars → cents). */
function parsePayments(formData: FormData): VendorPayment[] {
  const names = formData.getAll("vendorName").map((v) => String(v));
  const routings = formData.getAll("routing").map((v) => String(v));
  const accounts = formData.getAll("accountNumber").map((v) => String(v));
  const types = formData.getAll("accountType").map((v) => String(v));
  const amounts = formData.getAll("amountDollars").map((v) => String(v));

  const payments: VendorPayment[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = (names[i] ?? "").trim();
    const routing = (routings[i] ?? "").trim();
    const account = (accounts[i] ?? "").trim();
    const type = (types[i] ?? "checking").trim();
    const dollarsRaw = (amounts[i] ?? "").trim();
    // Skip fully-empty rows so trailing blanks don't create false problems.
    if (!name && !routing && !account && !dollarsRaw) continue;
    // Dollars → integer cents (round to avoid float drift).
    const dollars = Number(dollarsRaw);
    const amountCents = Number.isFinite(dollars) ? Math.round(dollars * 100) : NaN;
    payments.push({
      vendorId: `vp-${i + 1}`,
      vendorName: name,
      routing,
      accountNumber: account,
      accountType: type === "savings" ? "savings" : "checking",
      amountCents,
    });
  }
  return payments;
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

  const payments = parsePayments(formData);
  const preProblems = validateVendorPayments(payments);
  if (preProblems.length > 0) {
    return { problems: preProblems };
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
  const effectiveDate = effectiveDateRaw
    ? new Date(`${effectiveDateRaw}T00:00:00Z`)
    : new Date();

  const result: VendorAchResult = vendorPaymentsToNacha(payments, originator, {
    effectiveDate,
    companyEntryDescription: "VENDOR PAY",
  });

  if (!result.ok) {
    return { problems: result.problems };
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "vendor_ach.generate",
    entityType: "vendor_payments",
    after: {
      entryCount: result.entryCount,
      totalCents: result.totalCents,
      recordCount: result.recordCount,
    },
  }).catch(() => {});

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    problems: [],
    file: result.file,
    filename: `vendor-ach-${stamp}.txt`,
    totalCents: result.totalCents,
    entryCount: result.entryCount,
  };
}
