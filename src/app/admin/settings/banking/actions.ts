"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  getAchCompanySettings,
  saveAchCompanySettings,
  type AchCompanySettings,
} from "@/lib/payroll/payroll-store";

const ROOT = "/admin/settings/banking";

/**
 * Save the ACH originating bank / company settings. These are shared by both
 * payroll and vendor (Accounts Payable) ACH files. settings.manage only.
 */
export async function saveBankingSettingsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const accountType = String(formData.get("company_account_type") ?? "checking").trim();
  // S-10: the account number renders MASKED (••••1234). A submission that is
  // still masked (or blank while a value exists) means "leave unchanged".
  const submittedAccount = String(formData.get("company_account_number") ?? "").trim();
  let accountNumber = submittedAccount;
  if (!submittedAccount || submittedAccount.startsWith("••••")) {
    const current = await getAchCompanySettings();
    accountNumber = current.company_account_number;
  }
  const input: AchCompanySettings = {
    destination_routing: String(formData.get("destination_routing") ?? "").trim(),
    destination_name: String(formData.get("destination_name") ?? "").trim(),
    immediate_origin: String(formData.get("immediate_origin") ?? "").trim(),
    company_name: String(formData.get("company_name") ?? "").trim(),
    company_id: String(formData.get("company_id") ?? "").trim(),
    originating_dfi: String(formData.get("originating_dfi") ?? "").trim(),
    entry_description: String(formData.get("entry_description") ?? "PAYROLL").trim() || "PAYROLL",
    company_account_number: accountNumber,
    company_account_type: accountType === "savings" ? "savings" : "checking",
  };

  const res = await saveAchCompanySettings(input, session.profile.id);
  await recordAudit({
    actorId: session.profile.id,
    action: "banking.settings.save",
    entityType: "ach_company_settings",
  }).catch(() => {});

  revalidatePath(ROOT);
  // SLICE 94: the Banking page is now the tabbed vault door — the company ACH
  // settings live on the "My banking" tab, so saves land back on that tab.
  redirect(
    res.ok
      ? `${ROOT}?tab=company&msg=${encodeURIComponent("Banking settings saved.")}`
      : `${ROOT}?tab=company&error=${encodeURIComponent(res.error)}`,
  );
}
