"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { LOAN_STATUSES, parseDeductDays, type LoanStatus } from "@/lib/pos/employee-loan-core";
import { getLoanDeductDays, setLoanDeductDays, settleEmployeeLoan } from "@/lib/pos/employee-loan-store";

const ROOT = "/admin/staffing/employee-tabs";
const back = (k: "msg" | "error", v: string): never => redirect(`${ROOT}?${k}=${encodeURIComponent(v)}`);

/** Owner/admin (settings.manage): set N — days before an unpaid tab is deducted from pay. */
export async function saveLoanPolicyAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const days = parseDeductDays(formData.get("days"));
  if (days === null) back("error", "Enter a whole number of days between 1 and 90.");
  const before = await getLoanDeductDays();
  const err = await setLoanDeductDays(days!, session.profile.id);
  if (err) back("error", err);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "employee_tab.policy_saved",
    entityType: "site_settings",
    entityId: "employee_loan_policy",
    before: { deductDays: before },
    after: { deductDays: days },
  });
  revalidatePath(ROOT);
  back("msg", `Saved: unpaid tabs are deducted from pay after ${days} days.`);
}

/** Owner/admin: mark an open tab paid (cash), deducted (payroll) or forgiven. */
export async function settleLoanAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("to") ?? "") as LoanStatus;
  const note = String(formData.get("note") ?? "").trim().slice(0, 300) || null;
  if (!(LOAN_STATUSES as readonly string[]).includes(to) || to === "open") back("error", "Unknown status.");
  if (to === "forgiven" && !note) back("error", "Forgiving a tab needs a short reason.");
  const res = await settleEmployeeLoan(id, to, session.profile.id, note);
  if (!res.ok) back("error", res.error);
  if (res.ok) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: `employee_tab.${to}`,
      entityType: "employee_product_loan",
      entityId: id,
      before: { status: res.before.status, amountMinor: res.before.amount_minor, employeeId: res.before.employee_id },
      after: { status: to, note },
    });
  }
  revalidatePath(ROOT);
  back("msg", "Tab updated.");
}
