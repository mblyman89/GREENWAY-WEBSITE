"use server";

/**
 * SLICE 80 — Payee banking vault actions (settings.manage = owner + admin ONLY).
 * SLICE 94 — the vault moved to /admin/settings/banking (the "Banking" page in
 * the Admin menu is now the vault door: Vendors | Employees | My banking).
 * Same actions, same audits, new home; old /admin/settings/payees links redirect.
 *
 * Every action that touches a bank record writes an audit entry with MASKED
 * tails only (payee-banking-core.maskedBankSnapshot) — full routing/account
 * numbers never appear in audit logs. This page is the ONLY editing surface
 * for payee banking: vendor ACH and payroll both READ from here and never
 * accept hand-typed bank numbers (WA State Auditor vendor-master-file fraud
 * guidance: segregate who edits the master file from who runs payments, and
 * audit every change).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  describeBankChange,
  maskedBankSnapshot,
  validatePayeeBankInput,
} from "@/lib/payments/payee-banking-core";
import {
  deleteVendorBankDetails,
  markVendorBankVerified,
  saveVendorBankDetails,
  setVendorBankStatus,
} from "@/lib/payments/payee-banking-store";
import { listEmployeeBanking, listEmployees } from "@/lib/staffing/store";
import { saveEmployeeBanking } from "@/lib/payroll/payroll-store";
import { listVendors } from "@/lib/vendors/store";

const ROOT = "/admin/settings/banking";

function back(tab: "vendors" | "employees", qs: { msg?: string; error?: string }): never {
  const p = new URLSearchParams({ tab });
  if (qs.msg) p.set("msg", qs.msg);
  if (qs.error) p.set("error", qs.error);
  revalidatePath(ROOT);
  redirect(`${ROOT}?${p.toString()}`);
}

/** Snapshot helper: vault record → masked audit shape (or null). */
function snap(rec: {
  bank_name: string;
  routing: string;
  account_number: string;
  account_type: string;
  status: string;
} | null) {
  return rec
    ? maskedBankSnapshot({
        bankName: rec.bank_name,
        routing: rec.routing,
        accountNumber: rec.account_number,
        accountType: rec.account_type,
        status: rec.status,
      })
    : null;
}

// ---------------------------------------------------------------------------
// Vendors tab
// ---------------------------------------------------------------------------

export async function saveVendorBankingAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const vendorId = String(formData.get("vendor_id") ?? "").trim();
  if (!vendorId) back("vendors", { error: "Pick a vendor first." });

  const parsed = validatePayeeBankInput({
    bankName: String(formData.get("bank_name") ?? ""),
    routing: String(formData.get("routing") ?? ""),
    accountNumber: String(formData.get("account_number") ?? ""),
    accountType: String(formData.get("account_type") ?? ""),
  });
  if (!parsed.ok) back("vendors", { error: parsed.refusal });

  // Snapshot the vendor name so the vault row stays readable even if the
  // vendor record is later renamed or merged.
  const vendors = await listVendors();
  const vendor = vendors.find((v) => v.id === vendorId);
  if (!vendor) back("vendors", { error: "That vendor no longer exists." });

  const res = await saveVendorBankDetails({
    vendorId,
    vendorName: vendor.display_name,
    bankName: parsed.value.bankName,
    routing: parsed.value.routing,
    accountNumber: parsed.value.accountNumber,
    accountType: parsed.value.accountType,
    notes: String(formData.get("notes") ?? "").trim() || null,
    actorId: session.profile.id,
  });
  if (!res.ok) back("vendors", { error: res.error });

  // Audit with masked tails only. New/changed banking goes ON HOLD in the
  // caller's mind — we surface a reminder to verify out-of-band.
  const before = snap(res.before);
  const after = maskedBankSnapshot({
    bankName: parsed.value.bankName,
    routing: parsed.value.routing,
    accountNumber: parsed.value.accountNumber,
    accountType: parsed.value.accountType,
    status: res.before?.status ?? "active",
  });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: res.before ? "payee_banking.vendor.update" : "payee_banking.vendor.add",
    entityType: "vendor_bank_details",
    entityId: vendorId,
    before,
    after: { ...after, changes: describeBankChange(before, after) },
  }).catch(() => {});

  back("vendors", {
    msg: `${vendor.display_name}'s banking saved. Before paying against it, verify the numbers with the vendor by PHONE using a number you already have on file — never one from the email that sent them.`,
  });
}

export async function setVendorBankHoldAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const vendorId = String(formData.get("vendor_id") ?? "").trim();
  const status = String(formData.get("status") ?? "") === "on_hold" ? "on_hold" : "active";
  if (!vendorId) back("vendors", { error: "Missing vendor." });

  const res = await setVendorBankStatus({ vendorId, status, actorId: session.profile.id });
  if (!res.ok) back("vendors", { error: res.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: status === "on_hold" ? "payee_banking.vendor.hold" : "payee_banking.vendor.release",
    entityType: "vendor_bank_details",
    entityId: vendorId,
    before: snap(res.before),
    after: { status },
  }).catch(() => {});

  back("vendors", {
    msg:
      status === "on_hold"
        ? "Banking put ON HOLD — payments to this vendor are blocked until you release it."
        : "Hold released — this vendor can be paid again.",
  });
}

export async function markVendorBankVerifiedAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const vendorId = String(formData.get("vendor_id") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!vendorId) back("vendors", { error: "Missing vendor." });
  if (!note) {
    back("vendors", {
      error:
        "Write a short verification note — who you spoke with and the phone number you called (e.g. \u201cConfirmed with Maria in accounting at 360-555-0142\u201d).",
    });
  }

  const res = await markVendorBankVerified({ vendorId, note, actorId: session.profile.id });
  if (!res.ok) back("vendors", { error: res.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "payee_banking.vendor.verify",
    entityType: "vendor_bank_details",
    entityId: vendorId,
    after: { verified_note: note },
  }).catch(() => {});

  back("vendors", { msg: "Verification recorded — nice work closing the loop." });
}

export async function deleteVendorBankingAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const vendorId = String(formData.get("vendor_id") ?? "").trim();
  if (!vendorId) back("vendors", { error: "Missing vendor." });

  const res = await deleteVendorBankDetails({ vendorId });
  if (!res.ok) back("vendors", { error: res.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "payee_banking.vendor.delete",
    entityType: "vendor_bank_details",
    entityId: vendorId,
    before: snap(res.before),
  }).catch(() => {});

  back("vendors", { msg: "Banking removed from the vault." });
}

// ---------------------------------------------------------------------------
// Employees tab
// ---------------------------------------------------------------------------

export async function saveEmployeeBankingAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const employeeId = String(formData.get("employee_id") ?? "").trim();
  if (!employeeId) back("employees", { error: "Pick an employee first." });

  const parsed = validatePayeeBankInput({
    // Employees don't need a bank NAME for NACHA — routing identifies the bank.
    bankName: "(employee direct deposit)",
    routing: String(formData.get("routing") ?? ""),
    accountNumber: String(formData.get("account_number") ?? ""),
    accountType: String(formData.get("account_type") ?? ""),
  });
  if (!parsed.ok) back("employees", { error: parsed.refusal });

  const employees = await listEmployees({ includeInactive: true });
  const employee = employees.find((e) => e.id === employeeId);
  if (!employee) back("employees", { error: "That employee no longer exists." });

  // Before-snapshot for the audit diff (masked).
  const bankingRows = await listEmployeeBanking();
  const existing = bankingRows.find((b) => b.employee_id === employeeId) ?? null;
  const before =
    existing && (existing.bank_routing || existing.bank_account_number)
      ? maskedBankSnapshot({
          bankName: "",
          routing: existing.bank_routing ?? "",
          accountNumber: existing.bank_account_number ?? "",
          accountType: existing.bank_account_type ?? "",
          status: "active",
        })
      : null;

  const res = await saveEmployeeBanking(employeeId, {
    routing: parsed.value.routing,
    accountNumber: parsed.value.accountNumber,
    accountType: parsed.value.accountType,
  });
  if (!res.ok) back("employees", { error: res.error });

  const after = maskedBankSnapshot({
    bankName: "",
    routing: parsed.value.routing,
    accountNumber: parsed.value.accountNumber,
    accountType: parsed.value.accountType,
    status: "active",
  });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: before ? "payee_banking.employee.update" : "payee_banking.employee.add",
    entityType: "employees",
    entityId: employeeId,
    before,
    after: { ...after, changes: describeBankChange(before, after) },
  }).catch(() => {});

  back("employees", {
    msg: `${employee.full_name}'s direct deposit saved. It will prefill on every payroll run automatically.`,
  });
}

export async function clearEmployeeBankingAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const employeeId = String(formData.get("employee_id") ?? "").trim();
  if (!employeeId) back("employees", { error: "Missing employee." });

  const bankingRows = await listEmployeeBanking();
  const existing = bankingRows.find((b) => b.employee_id === employeeId) ?? null;
  const before =
    existing && (existing.bank_routing || existing.bank_account_number)
      ? maskedBankSnapshot({
          bankName: "",
          routing: existing.bank_routing ?? "",
          accountNumber: existing.bank_account_number ?? "",
          accountType: existing.bank_account_type ?? "",
          status: "active",
        })
      : null;

  const res = await saveEmployeeBanking(employeeId, {
    routing: "",
    accountNumber: "",
    accountType: "checking",
  });
  if (!res.ok) back("employees", { error: res.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "payee_banking.employee.clear",
    entityType: "employees",
    entityId: employeeId,
    before,
  }).catch(() => {});

  back("employees", { msg: "Direct deposit cleared — this employee drops off the next NACHA file until banking is re-entered here." });
}
