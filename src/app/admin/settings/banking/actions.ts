"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StaffSession } from "@/lib/auth/session";
import { achGate } from "@/lib/payments/ach-gate";
import type { RedirectOutcome } from "@/lib/payments/ach-gate-core";
import { recordAudit } from "@/lib/auth/audit";
import {
  getAchCompanySettings,
  getCompanyEin,
  getOriginatorReadiness,
  saveAchCompanySettings,
  saveTimberlandStamp,
  type AchCompanySettings,
} from "@/lib/payroll/payroll-store";
import { confirmStampProblem, originatorFromSettings, validateOriginator } from "@/lib/payments/timberland-originator-core";

const ROOT = "/admin/settings/banking";

/**
 * Save the ACH originating bank / company settings. These are shared by both
 * payroll and vendor (Accounts Payable) ACH files.
 * R41 S0: through achGate. Michael (owner) saves at once with a receipt;
 * Stephen's (admin) change is sent to Michael for approval. 0271 guards the
 * row: only an owner-stamped updated_by may change it.
 */
export async function saveBankingSettingsAction(formData: FormData): Promise<void> {
  return achGate(
    "banking_settings.save",
    formData,
    { reply: (r: RedirectOutcome): never => redirect(`${ROOT}?tab=company&${r.ok ? "msg" : "error"}=${encodeURIComponent(r.message)}`) },
    (session) => saveBankingSettingsBody(session, formData),
  );
}

async function saveBankingSettingsBody(session: StaffSession, formData: FormData): Promise<void> {

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

  // R41 S2: refuse values Timberland would not match, with the exact reason,
  // before anything is written. The EIN itself lives on Books > Company
  // information, so a missing EIN is not a reason to refuse THIS save (the
  // file builder still refuses until it is entered).
  const problems = validateOriginator(originatorFromSettings(input, await getCompanyEin())).filter((p) => p.field !== "companyEin");
  if (problems.length) {
    redirect(`${ROOT}?tab=company&error=${encodeURIComponent(`Not saved. ${problems.map((p) => p.message).join(" ")}`)}`);
  }

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

/**
 * R41 S2: record that Timberland confirmed the company ACH setup (the
 * "Timberland confirmed on ___" stamp, migration 0272). Through achGate:
 * Michael stamps at once; Stephen's goes to Michael as a request, and is
 * refused as stale if the settings were saved after he asked.
 */
export async function confirmTimberlandSetupAction(formData: FormData): Promise<void> {
  return achGate(
    "timberland_setup.confirm",
    formData,
    { reply: (r: RedirectOutcome): never => redirect(`${ROOT}?tab=company&${r.ok ? "msg" : "error"}=${encodeURIComponent(r.message)}`) },
    (session) => confirmTimberlandSetupBody(session, formData),
  );
}

async function confirmTimberlandSetupBody(session: StaffSession, formData: FormData): Promise<void> {
  const note = String(formData.get("confirm_note") ?? "").trim();
  const { readiness } = await getOriginatorReadiness();
  const problem = confirmStampProblem(readiness, note);
  if (problem) redirect(`${ROOT}?tab=company&error=${encodeURIComponent(`Not recorded. ${problem}`)}`);

  const res = await saveTimberlandStamp(session.profile.id, note);
  await recordAudit({
    actorId: session.profile.id,
    action: "banking.timberland.confirm",
    entityType: "ach_company_settings",
    after: { ok: res.ok, note },
  }).catch(() => {});
  revalidatePath(ROOT);
  redirect(
    res.ok
      ? `${ROOT}?tab=company&msg=${encodeURIComponent("Recorded: Timberland confirmed the company ACH setup.")}`
      : `${ROOT}?tab=company&error=${encodeURIComponent(res.error)}`,
  );
}
