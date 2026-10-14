"use server";

/**
 * SLICE 80 — Payee banking vault actions.
 * R41 S0 — every action goes through achGate (src/lib/payments/ach-gate.ts):
 * Michael (owner) acts at once and gets a "Was this you?" receipt; Stephen's
 * (admin) changes wait for Michael's approval; putting banking ON HOLD is a
 * stop action, so Stephen's takes effect at once and lands on Michael's
 * review list (owner decision D-6, option B). Everyone else: no access.
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
import type { StaffSession } from "@/lib/auth/session";
import { achAuthority } from "@/lib/auth/ach-authority-core";
import { achGate } from "@/lib/payments/ach-gate";
import type { RedirectOutcome } from "@/lib/payments/ach-gate-core";
import { recordAudit } from "@/lib/auth/audit";
import {
  describeBankChange,
  maskedBankSnapshot,
  validatePayeeBankInput,
} from "@/lib/payments/payee-banking-core";
import {
  addVendorContact,
  archiveVendorBankDetails,
  getVendorBankDetails,
  holdVendorBank,
  listVendorContacts,
  markVendorBankVerified,
  releaseVendorBankHold,
  retireVendorContact,
  saveVendorBankDetails,
} from "@/lib/payments/payee-banking-store";
import { planVaultRelease } from "@/lib/payments/vault-release-core";
import { maskAccountTail } from "@/lib/security/at-rest-crypto";
import { pacificToday } from "@/lib/reports/timezone";
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

/** The gate's answer (refusal, "sent to Michael", replay mismatch) on the same tab. */
function replyTo(tab: "vendors" | "employees") {
  return (r: RedirectOutcome): never => back(tab, r.ok ? { msg: r.message } : { error: r.message });
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
  return achGate("vendor_bank.save", formData, { reply: replyTo("vendors") }, (session) => saveVendorBankingBody(session, formData));
}

async function saveVendorBankingBody(session: StaffSession, formData: FormData): Promise<void> {

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

  // Audit with masked tails only. The status in the "after" snapshot is what
  // the save really did (R39 S3): a bank change lands on hold.
  const before = snap(res.before);
  const after = maskedBankSnapshot({
    bankName: parsed.value.bankName,
    routing: parsed.value.routing,
    accountNumber: parsed.value.accountNumber,
    accountType: parsed.value.accountType,
    status: res.plan.resultingStatus === "unchanged" ? (res.before?.status ?? "on_hold") : res.plan.resultingStatus,
  });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: res.before ? "payee_banking.vendor.update" : "payee_banking.vendor.add",
    entityType: "vendor_bank_details",
    entityId: vendorId,
    before,
    after: { ...after, changes: describeBankChange(before, after), bank_columns_rewritten: res.plan.writeBankColumns, hold_reason: res.plan.holdReason },
  }).catch(() => {});

  back("vendors", {
    msg: res.plan.writeBankColumns
      ? `${vendor.display_name}'s banking saved and put ON HOLD. Call the vendor at a number already on file (never one from the email that sent the change), or confirm in person, then release the hold.`
      : `${vendor.display_name}'s details saved. The bank numbers did not change, so the status stays ${res.before?.status === "active" ? "active" : (res.before?.status ?? "on hold").replace("_", " ")}.`,
  });
}

/** Put banking on hold, or re-open archived / revoked banking on hold. */
export async function holdVendorBankAction(formData: FormData): Promise<void> {
  return achGate("vendor_bank.hold", formData, { reply: replyTo("vendors") }, (session) => holdVendorBankBody(session, formData));
}

async function holdVendorBankBody(session: StaffSession, formData: FormData): Promise<void> {
  const vendorId = String(formData.get("vendor_id") ?? "").trim();
  const reason = String(formData.get("hold_reason") ?? "").trim();
  if (!vendorId) back("vendors", { error: "Missing vendor." });

  const res = await holdVendorBank({ vendorId, reason, actorId: session.profile.id });
  if (!res.ok) back("vendors", { error: res.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: res.before.status === "active" ? "payee_banking.vendor.hold" : "payee_banking.vendor.reopen",
    entityType: "vendor_bank_details",
    entityId: vendorId,
    before: snap(res.before),
    after: { status: "on_hold", hold_reason: reason, reason_stored_on_row: res.reasonStored },
  }).catch(() => {});

  back("vendors", {
    msg: "Banking put ON HOLD. Payments to this vendor are blocked until the hold is released after a callback.",
  });
}

/**
 * Release a hold (R39 S3, R41 S0). Gated by planVaultRelease -> releaseVerdict:
 * a phone number picked from the vendor's contacts on file 90+ days (or in
 * person) and a note. R41 S0: only Michael (the owner) releases; Stephen's
 * release arrives here only when Michael approves it, and then runs as
 * Michael. No reason is required (owner round 6). The database (0271
 * vendor_bank_guard) checks the same rules.
 */
export async function releaseVendorBankHoldAction(formData: FormData): Promise<void> {
  return achGate("vendor_bank.release", formData, { reply: replyTo("vendors") }, (session) => releaseVendorBankHoldBody(session, formData));
}

async function releaseVendorBankHoldBody(session: StaffSession, formData: FormData): Promise<void> {
  const vendorId = String(formData.get("vendor_id") ?? "").trim();
  if (!vendorId) back("vendors", { error: "Missing vendor." });

  const [vault, contacts] = await Promise.all([getVendorBankDetails(vendorId), listVendorContacts(vendorId)]);
  if (!vault.tableReady) back("vendors", { error: "The banking vault table is not ready \u2014 apply migration 0143 first." });

  const plan = planVaultRelease({
    form: {
      method: String(formData.get("callback_method") ?? ""),
      contactId: String(formData.get("contact_id") ?? ""),
      note: String(formData.get("callback_note") ?? ""),
      reason: String(formData.get("release_reason") ?? ""),
      confirmedCall: formData.get("confirmed") === "yes",
    },
    record: vault.record ? { status: vault.record.status, change_entered_by: vault.record.change_entered_by } : null,
    contacts: contacts.contacts,
    actorIsOwner: achAuthority(session.profile.role) === "act",
    today: pacificToday(),
  });
  if (!plan.ok) back("vendors", { error: plan.refusal });

  const res = await releaseVendorBankHold({
    vendorId,
    actorId: session.profile.id,
    mode: plan.verdict.mode,
    method: plan.method,
    note: plan.note,
    reason: plan.reason,
  });
  if (!res.ok) back("vendors", { error: res.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "payee_banking.vendor.release",
    entityType: "vendor_bank_details",
    entityId: vendorId,
    before: snap(res.before),
    after: {
      status: "active",
      release_mode: plan.verdict.mode,
      callback_method: plan.method,
      // Masked: the contact id and the last 4 of the number called.
      called_contact_id: plan.calledContact?.id ?? null,
      called_number_tail: plan.calledContact ? maskAccountTail(plan.calledContact.value.replace(/\D/g, "")) : null,
      called_number_on_file_since: plan.calledContact?.onFileSince ?? null,
      callback_note: plan.note,
      release_reason: plan.reason,
      record_stored_on_row: res.recordStored,
      // Who entered the change (Stephen or Michael) stays on the row as change_entered_by.
      change_entered_by: res.before.change_entered_by ?? null,
    },
  }).catch(() => {});

  back("vendors", { msg: "Hold released by Michael (the owner). This vendor can be paid again." });
}

export async function markVendorBankVerifiedAction(formData: FormData): Promise<void> {
  return achGate("vendor_bank.verify", formData, { reply: replyTo("vendors") }, (session) => markVendorBankVerifiedBody(session, formData));
}

async function markVendorBankVerifiedBody(session: StaffSession, formData: FormData): Promise<void> {
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

/** Archive (owner answer Q7: delete becomes archive). The row and its history stay. */
export async function archiveVendorBankingAction(formData: FormData): Promise<void> {
  return achGate("vendor_bank.archive", formData, { reply: replyTo("vendors") }, (session) => archiveVendorBankingBody(session, formData));
}

async function archiveVendorBankingBody(session: StaffSession, formData: FormData): Promise<void> {
  const vendorId = String(formData.get("vendor_id") ?? "").trim();
  const reason = String(formData.get("archive_reason") ?? "").trim();
  if (!vendorId) back("vendors", { error: "Missing vendor." });

  const res = await archiveVendorBankDetails({ vendorId, reason, actorId: session.profile.id });
  if (!res.ok) back("vendors", { error: res.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "payee_banking.vendor.archive",
    entityType: "vendor_bank_details",
    entityId: vendorId,
    before: snap(res.before),
    after: { status: "archived", archive_reason: reason },
  }).catch(() => {});

  back("vendors", { msg: "Banking archived. It is kept with its history, and payments to it are refused." });
}

// ---------------------------------------------------------------------------
// Vendor callback contacts (payee_contacts, 0258)
// ---------------------------------------------------------------------------

export async function addVendorContactAction(formData: FormData): Promise<void> {
  return achGate("vendor_contact.add", formData, { reply: replyTo("vendors") }, (session) => addVendorContactBody(session, formData));
}

async function addVendorContactBody(session: StaffSession, formData: FormData): Promise<void> {
  const vendorId = String(formData.get("vendor_id") ?? "").trim();
  const kind = String(formData.get("contact_kind") ?? "") === "email" ? "email" : "phone";
  const raw = String(formData.get("contact_value") ?? "").trim();
  const today = pacificToday();
  const onFileSince = String(formData.get("on_file_since") ?? "").trim() || today;
  const sourceRaw = String(formData.get("source") ?? "existing_record");
  const source = (["existing_record", "signed_form", "in_person", "onboarding"] as const).find((x) => x === sourceRaw) ?? "existing_record";
  if (!vendorId) back("vendors", { error: "Missing vendor." });
  let value = raw;
  if (kind === "phone") {
    const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (d.length !== 10) back("vendors", { error: "Phone numbers are 10 digits, like 360-555-0100." });
    value = `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  } else {
    value = raw.toLowerCase();
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onFileSince) || onFileSince > today) {
    back("vendors", { error: "The on-file date must be a real date, today or earlier." });
  }

  const res = await addVendorContact({ vendorId, kind, value, onFileSince, source, actorId: session.profile.id });
  if (!res.ok) back("vendors", { error: res.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "payee_contact.vendor.add",
    entityType: "payee_contacts",
    entityId: res.id,
    after: {
      vendor_id: vendorId,
      kind,
      // Contacts are not secret, but the audit keeps only a tail by habit.
      value_tail: kind === "phone" ? value.slice(-4) : value.replace(/^[^@]*/, "…"),
      on_file_since: onFileSince,
      backdated: onFileSince < today,
      source,
    },
  }).catch(() => {});

  back("vendors", {
    msg:
      onFileSince < today
        ? `Contact added, on file since ${onFileSince} (backdated; this is recorded in the audit log).`
        : "Contact added. A phone number can be used for a release callback once it has been on file 90 days; until then, confirm in person.",
  });
}

export async function retireVendorContactAction(formData: FormData): Promise<void> {
  return achGate("vendor_contact.retire", formData, { reply: replyTo("vendors") }, (session) => retireVendorContactBody(session, formData));
}

async function retireVendorContactBody(session: StaffSession, formData: FormData): Promise<void> {
  const vendorId = String(formData.get("vendor_id") ?? "").trim();
  const contactId = String(formData.get("contact_id") ?? "").trim();
  if (!vendorId || !contactId) back("vendors", { error: "Missing contact." });
  const res = await retireVendorContact({ contactId, vendorId });
  if (!res.ok) back("vendors", { error: res.error });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "payee_contact.vendor.retire",
    entityType: "payee_contacts",
    entityId: contactId,
    after: { vendor_id: vendorId },
  }).catch(() => {});
  back("vendors", { msg: "Contact retired. It stays in the history and can no longer be used for a callback." });
}

// ---------------------------------------------------------------------------
// Employees tab
// ---------------------------------------------------------------------------

export async function saveEmployeeBankingAction(formData: FormData): Promise<void> {
  return achGate("employee_bank.save", formData, { reply: replyTo("employees") }, (session) => saveEmployeeBankingBody(session, formData));
}

async function saveEmployeeBankingBody(session: StaffSession, formData: FormData): Promise<void> {

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
  }, session.profile.id);
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
  return achGate("employee_bank.clear", formData, { reply: replyTo("employees") }, (session) => clearEmployeeBankingBody(session, formData));
}

async function clearEmployeeBankingBody(session: StaffSession, formData: FormData): Promise<void> {
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
  }, session.profile.id);
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
