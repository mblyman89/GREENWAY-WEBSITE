"use server";

/**
 * R39 S6 — in-person e-sign of the employee direct deposit form (GW-ACH-E).
 *
 * Every action needs settings.manage (owner + admin: Stephen and Michael,
 * owner Q1). The person signed in on the store device stays at the counter;
 * the employee types their own email, code, accounts and name (owner Q12:
 * no self-service, so there is no link the employee can open elsewhere).
 *
 * Audit rows carry the session id, state, masked email and last-4 only.
 * Redirect targets are built here from validated ids, never from input.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { sendStaffAlertEmail } from "@/lib/orders/staff-alert-email";
import { resolveNotifyContacts } from "@/lib/payments/ach-authorization-core";
import { clientIp, esignAccountsFromForm, signedNotices } from "@/lib/payments/ach-esign-core";
import {
  cancelEsignSession,
  getEsignSession,
  sendEsignCode,
  signEsignSession,
  startEsignSession,
  verifyCodeAndConsent,
  type CodeMailer,
} from "@/lib/payments/ach-esign-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}

function page(employeeId: string): string {
  return `/admin/staffing/employees/${employeeId}/esign`;
}

function back(employeeId: string, param: "ok" | "error", message: string): never {
  redirect(`${page(employeeId)}?${param}=${encodeURIComponent(message.slice(0, 600))}`);
}

function employeeIdFrom(fd: FormData): string {
  const id = str(fd, "employee_id").toLowerCase();
  if (!UUID.test(id)) redirect("/admin/staffing/employees?error=" + encodeURIComponent("Unknown employee."));
  return id;
}

/** The session must belong to the employee in the URL (no cross-employee posting). */
async function sessionFor(fd: FormData, employeeId: string) {
  const sid = str(fd, "session_id").toLowerCase();
  const s = UUID.test(sid) ? await getEsignSession(sid) : null;
  if (!s || s.employee_id !== employeeId) back(employeeId, "error", "That signing no longer exists. Reload the page.");
  return s;
}

function mailer(): CodeMailer {
  return async (to, msg) => {
    const apiKey = process.env.RESEND_API_KEY ?? "";
    const from = process.env.ORDER_EMAIL_FROM ?? "";
    if (!apiKey || !from) return { ok: false, detail: "RESEND_API_KEY or ORDER_EMAIL_FROM is not set" };
    const r = await sendStaffAlertEmail({ apiKey, from, to: [to], subject: msg.subject, html: msg.html });
    return r.ok ? { ok: true } : { ok: false, detail: r.detail };
  };
}

export async function startEsignAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const employeeId = employeeIdFrom(fd);
  if (str(fd, "id_seen") !== "on") back(employeeId, "error", "Confirm you checked the photo ID in person, and that the face matches.");
  const res = await startEsignSession({
    employeeId,
    actorId: session.profile.id,
    idType: str(fd, "id_type"),
    idDetail: str(fd, "id_detail"),
    legalName: str(fd, "legal_name"),
    todayIso: new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
  });
  if (!res.ok) back(employeeId, "error", res.error);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "ach_esign.start",
    entityType: "ach_esign_session",
    entityId: res.session.id,
    before: null,
    after: { employee_id: employeeId, id_type: res.session.id_type },
  });
  revalidatePath(page(employeeId));
  back(employeeId, "ok", "ID check recorded. Hand the device to the employee.");
}

export async function sendEsignCodeAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const employeeId = employeeIdFrom(fd);
  const s = await sessionFor(fd, employeeId);
  const res = await sendEsignCode({ session: s, email: str(fd, "email"), nowMs: Date.now(), mail: mailer() });
  if (!res.ok) back(employeeId, "error", res.error);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "ach_esign.code_sent",
    entityType: "ach_esign_session",
    entityId: s.id,
    before: { state: s.state, otp_sends: s.otp_sends },
    after: { state: "code_sent", otp_sends: s.otp_sends + 1, email_masked: res.masked },
  });
  revalidatePath(page(employeeId));
  back(employeeId, "ok", `Code sent to ${res.masked}. It expires in 10 minutes.`);
}

export async function verifyEsignCodeAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const employeeId = employeeIdFrom(fd);
  const s = await sessionFor(fd, employeeId);
  const res = await verifyCodeAndConsent({
    session: s,
    typedCode: str(fd, "code"),
    agreed: str(fd, "agree") === "on",
    disclosureSha256Shown: str(fd, "disclosure_sha256"),
    nowMs: Date.now(),
  });
  if (!res.ok) {
    revalidatePath(page(employeeId));
    back(employeeId, "error", res.error);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "ach_esign.consented",
    entityType: "ach_esign_session",
    entityId: s.id,
    before: { state: s.state },
    after: { state: "consented" },
  });
  revalidatePath(page(employeeId));
  back(employeeId, "ok", "Email confirmed and consent recorded. Now enter the accounts and sign.");
}

export async function signEsignAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const employeeId = employeeIdFrom(fd);
  const s = await sessionFor(fd, employeeId);
  const parsed = esignAccountsFromForm((k) => str(fd, k));
  if (!parsed.ok) back(employeeId, "error", parsed.errors.join(" "));
  const h = await headers();
  const res = await signEsignSession({
    session: s,
    actorId: session.profile.id,
    startedBy: { name: session.profile.full_name || session.email, email: session.email },
    typedName: str(fd, "typed_name"),
    intentChecked: str(fd, "intent") === "on",
    replaceOpen: str(fd, "replace_open") === "on",
    accounts: parsed.accounts,
    ip: clientIp((k) => h.get(k)),
    userAgent: h.get("user-agent"),
    nowMs: Date.now(),
  });
  if (!res.ok) back(employeeId, "error", res.error);

  // Notices (owner Q9): the employee (account change = fraud signal) and
  // Stephen, Michael and the store. Email only; phones are call reminders.
  const notices = signedNotices({
    employeeName: s.legal_name,
    accountsLast4: res.accountsLast4,
    checkedBy: session.profile.full_name || session.email,
    whenPacific: new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" }),
    replacedPrevious: res.replacedPrevious,
  });
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.ORDER_EMAIL_FROM ?? "";
  const book = resolveNotifyContacts(process.env).contacts;
  let mailed = "not sent (RESEND_API_KEY or ORDER_EMAIL_FROM is not set)";
  if (apiKey && from) {
    const owners = await sendStaffAlertEmail({ apiKey, from, to: [book.stephen.email, book.michael.email, book.store.email], subject: notices.owners.subject, html: notices.owners.html });
    const emp = res.emailTo ? await sendStaffAlertEmail({ apiKey, from, to: [res.emailTo], subject: notices.employee.subject, html: notices.employee.html }) : null;
    mailed = `owners ${owners.ok ? "emailed" : "NOT emailed"}, employee ${emp ? (emp.ok ? "emailed" : "NOT emailed") : "no address"}`;
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "ach_esign.signed",
    entityType: "ach_esign_session",
    entityId: s.id,
    before: { state: s.state },
    after: { state: "signed", authorization_id: res.authorizationId, record_sha256: res.recordSha256, account_last4: res.accountsLast4, replaced: res.replacedPrevious, notices: mailed },
  });
  revalidatePath(page(employeeId));
  revalidatePath(`/admin/staffing/employees/${employeeId}`);
  revalidatePath("/admin/settings/banking");
  const okMsg = `Signed. The record and certificate are filed. Notices: ${mailed}. Verify each account (prenote or $1 test credit) before payroll pays it.`;
  redirect(`${page(employeeId)}?done=${encodeURIComponent(s.id)}&ok=${encodeURIComponent(okMsg.slice(0, 600))}`);
}

export async function cancelEsignAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const employeeId = employeeIdFrom(fd);
  const s = await sessionFor(fd, employeeId);
  const reason = str(fd, "reason");
  const res = await cancelEsignSession({ session: s, reason, nowMs: Date.now() });
  if (!res.ok) back(employeeId, "error", res.error);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "ach_esign.cancel",
    entityType: "ach_esign_session",
    entityId: s.id,
    before: { state: s.state },
    after: { state: "cancelled", reason: reason.slice(0, 500) },
  });
  revalidatePath(page(employeeId));
  back(employeeId, "ok", "Signing cancelled and kept on record.");
}
