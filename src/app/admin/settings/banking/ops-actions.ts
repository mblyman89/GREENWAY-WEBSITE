"use server";

/**
 * R39 S7 part 2 — ACH operations actions (/admin/settings/banking/operations).
 * R41 S0: every action goes through achGate (src/lib/payments/ach-gate.ts).
 * Michael, the owner, acts at once and gets a "Was this you?" receipt.
 * Stephen (admin): logging a return or change notice only stops money, so it
 * takes effect at once and lands on Michael's review list (D-6, option B);
 * every other action here is sent to Michael for approval. Each body: ONE
 * store call (which calls ONE 0263 function), an audit row with ids / codes /
 * last-4 only, and a redirect back with the result in words.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StaffSession } from "@/lib/auth/session";
import { achAuthority, type AchActionKind } from "@/lib/auth/ach-authority-core";
import { achGate } from "@/lib/payments/ach-gate";
import type { RedirectOutcome } from "@/lib/payments/ach-gate-core";
import { recordAudit } from "@/lib/auth/audit";
import { pacificToday } from "@/lib/reports/timezone";
import {
  finishCheck,
  logNotice,
  markCheckFileSent,
  markReviewDone,
  releaseCheckFile,
  releaseEmployeeHold,
  resendOpsMailer,
  resolveNotice,
  setLegalHold,
  startCheck,
  type OwnerNotice,
} from "@/lib/payments/ach-ops-store";
import { opsNoticeLine, opsSiteUrl } from "@/lib/payments/ach-ops-ui-core";

const OPS = "/admin/settings/banking/operations";

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}

function back(qs: { msg?: string; error?: string }, anchor = ""): never {
  const p = new URLSearchParams();
  if (qs.msg) p.set("msg", qs.msg.slice(0, 900));
  if (qs.error) p.set("error", qs.error.slice(0, 900));
  revalidatePath(OPS);
  redirect(`${OPS}?${p.toString()}${anchor}`);
}

/** The gate's answer (refusal, "sent to Michael", replay mismatch) on the same section. */
function replyAt(anchor: string) {
  return (r: RedirectOutcome): never => back(r.ok ? { msg: r.message } : { error: r.message }, anchor);
}

/** A notice has no record yet: name it by the payee it is for ("vendor:<uuid>" / "employee:<uuid>"). */
function noticePayee(fd: FormData): { kind: AchActionKind; id: string | null } {
  const m = /^(vendor|employee):([0-9a-f-]{36})$/.exec(str(fd, "payee"));
  if (!m) return { kind: "ach_notice.log", id: null };
  return { kind: m[1] === "vendor" ? "vendor_bank.save" : "employee_bank.save", id: m[2] };
}

function ownerLine(o: OwnerNotice | null): string {
  return o ? ` ${opsNoticeLine(o)}` : "";
}

export async function logNoticeAction(fd: FormData): Promise<void> {
  return achGate("ach_notice.log", fd, { reply: replyAt("#notices"), labelFrom: noticePayee(fd) }, (session) => logNoticeBody(session, fd));
}

async function logNoticeBody(session: StaffSession, fd: FormData): Promise<void> {
  const r = await logNotice({
    get: (k) => (fd.get(k) === null ? null : String(fd.get(k))),
    actorId: session.profile.id,
    actorLabel: session.profile.full_name || session.email,
    todayIso: pacificToday(),
    bankingUrl: `${opsSiteUrl(process.env)}${OPS}`,
    mail: resendOpsMailer(),
  });
  if (!r.ok) back({ error: r.error }, "#notices");
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: r.notice.kind === "noc" ? "ach.noc.logged" : "ach.return.logged",
    entityType: "ach_return_notices",
    entityId: r.noticeId,
    after: { code: r.notice.code, payee_type: r.notice.payeeType, payee_id: r.notice.payeeId, received_on: r.notice.receivedOn, hold: r.hold, apply_by: r.notice.applyBy, emailed: r.owner.emailed },
  }).catch(() => {});
  const held = r.hold === "none" ? "Nothing was on file to hold: check how this payment went out." : r.hold === "already_on_hold" ? "It was already on hold." : "The payee's banking is now ON HOLD.";
  back({ msg: `${r.notice.code} logged. ${held}${ownerLine(r.owner)}` }, "#notices");
}

export async function resolveNoticeAction(fd: FormData): Promise<void> {
  return achGate("ach_notice.resolve", fd, { reply: replyAt("#notices") }, (session) => resolveNoticeBody(session, fd));
}

async function resolveNoticeBody(session: StaffSession, fd: FormData): Promise<void> {
  const id = str(fd, "notice_id");
  const r = await resolveNotice({ noticeId: id, actorId: session.profile.id, note: str(fd, "note") });
  if (!r.ok) back({ error: r.error }, "#notices");
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "ach.notice.resolved", entityType: "ach_return_notices", entityId: id, after: { note: r.note } }).catch(() => {});
  back({ msg: "Notice resolved. It stays in the log." }, "#notices");
}

export async function releaseEmployeeHoldAction(fd: FormData): Promise<void> {
  return achGate("employee_hold.release", fd, { reply: replyAt("#holds") }, (session) => releaseEmployeeHoldBody(session, fd));
}

async function releaseEmployeeHoldBody(session: StaffSession, fd: FormData): Promise<void> {
  const id = str(fd, "auth_id");
  const r = await releaseEmployeeHold({
    authId: id,
    actorId: session.profile.id,
    actorIsOwner: achAuthority(session.profile.role) === "act",
    method: str(fd, "method"),
    note: str(fd, "note"),
    reason: str(fd, "reason"),
  });
  if (!r.ok) back({ error: r.error }, "#holds");
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.employee_hold.release",
    entityType: "ach_authorizations",
    entityId: id,
    before: { state: r.before.state, hold_reason: r.before.hold_reason, hold_entered_by: r.before.hold_entered_by },
    after: { release_mode: r.mode, callback_method: str(fd, "method") },
  }).catch(() => {});
  back({ msg: "Hold released by Michael (the owner). Payroll may use this authorization again." }, "#holds");
}

export async function startCheckAction(fd: FormData): Promise<void> {
  return achGate("ach_check.start", fd, { reply: replyAt("#checks") }, (session) => startCheckBody(session, fd));
}

async function startCheckBody(session: StaffSession, fd: FormData): Promise<void> {
  const accountId = str(fd, "account_id");
  const r = await startCheck({ accountId, actorId: session.profile.id, method: str(fd, "method") });
  if (!r.ok) back({ error: r.error }, "#checks");
  // The test amount is NOT audited or shown: the person must read it back.
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "ach.verification.started", entityType: "ach_verifications", entityId: r.verificationId, after: { account_id: accountId, method: r.method } }).catch(() => {});
  const next =
    r.method === "voided_check_callback"
      ? "Call the person at a number on file, then record the result."
      : `It goes in the next ${r.method === "prenote" ? "prenote" : "test credit"} file: download it below, upload it to Timberland, then confirm.`;
  back({ msg: `Check started. ${next}` }, "#checks");
}

export async function releaseCheckFileAction(fd: FormData): Promise<void> {
  return achGate("ach_check.release_file", fd, { reply: replyAt("#checks") }, (session) => releaseCheckFileBody(session, fd));
}

/** R41 S3: the check file is released once into the ach_files ledger; the download then serves those bytes. */
async function releaseCheckFileBody(session: StaffSession, fd: FormData): Promise<void> {
  const method = str(fd, "method");
  if (method !== "prenote" && method !== "micro_entry") back({ error: "Choose the prenote or the test credit file." }, "#checks");
  const r = await releaseCheckFile({ method, effective: str(fd, "effective"), fingerprint: str(fd, "fp"), actorId: session.profile.id, todayIso: pacificToday(), now: new Date() });
  if (!r.ok) back({ error: r.error }, "#checks");
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.verification.file_released",
    entityType: "ach_files",
    entityId: r.fileId,
    after: { method, ids: r.plan.ids, effective: r.plan.effective, filename: r.plan.filename, file_id_modifier: r.modifier, entry_count: r.plan.entryCount, total_cents: r.plan.totalCents },
  }).catch(() => {});
  back({ msg: `File released (File ID Modifier ${r.modifier}). Download it, upload it to Timberland, then confirm it was sent.` }, "#checks");
}

export async function markCheckFileSentAction(fd: FormData): Promise<void> {
  return achGate("ach_check.mark_sent", fd, { reply: replyAt("#checks") }, (session) => markCheckFileSentBody(session, fd));
}

async function markCheckFileSentBody(session: StaffSession, fd: FormData): Promise<void> {
  const method = str(fd, "method");
  if (method !== "prenote" && method !== "micro_entry") back({ error: "Choose the prenote or the test credit file." }, "#checks");
  if (str(fd, "confirm") !== "yes") back({ error: "Tick the box to confirm the file was uploaded to Timberland." }, "#checks");
  const r = await markCheckFileSent({ method, effective: str(fd, "effective"), fingerprint: str(fd, "fp"), actorId: session.profile.id, todayIso: pacificToday(), now: new Date() });
  if (!r.ok) back({ error: r.error }, "#checks");
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.verification.file_sent",
    entityType: "ach_verifications",
    entityId: r.plan.ids[0] ?? null,
    after: { method, count: r.count, ids: r.plan.ids, effective: r.plan.effective, eligible: r.plan.eligible, filename: r.plan.filename, total_cents: r.plan.totalCents },
  }).catch(() => {});
  back({ msg: `${r.count} marked sent. ${r.plan.next}` }, "#checks");
}

export async function finishCheckAction(fd: FormData): Promise<void> {
  return achGate("ach_check.finish", fd, { reply: replyAt("#checks") }, (session) => finishCheckBody(session, fd));
}

async function finishCheckBody(session: StaffSession, fd: FormData): Promise<void> {
  const id = str(fd, "verification_id");
  const r = await finishCheck({ verificationId: id, actorId: session.profile.id, outcome: str(fd, "outcome"), confirmed: str(fd, "confirmed"), note: str(fd, "note") });
  if (!r.ok) back({ error: r.error }, "#checks");
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: `ach.verification.${r.outcome}`, entityType: "ach_verifications", entityId: id, after: { method: r.method, authorization_state: r.state } }).catch(() => {});
  const tail = r.state === "active" ? " Every account is verified: the authorization is ACTIVE and payroll may use it." : "";
  back({ msg: `Check ${r.outcome}.${tail}` }, "#checks");
}

export async function setLegalHoldAction(fd: FormData): Promise<void> {
  return achGate("legal_hold.set", fd, { reply: replyAt("#records") }, (session) => setLegalHoldBody(session, fd));
}

async function setLegalHoldBody(session: StaffSession, fd: FormData): Promise<void> {
  const id = str(fd, "auth_id");
  const on = str(fd, "on") === "true";
  const r = await setLegalHold({ authId: id, actorId: session.profile.id, on, reason: str(fd, "reason") });
  if (!r.ok) back({ error: r.error }, "#records");
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: on ? "ach.legal_hold.on" : "ach.legal_hold.off", entityType: "ach_authorizations", entityId: id, before: { legal_hold: r.before.legal_hold }, after: { legal_hold: on, reason: r.reason } }).catch(() => {});
  back({ msg: on ? "Legal hold is on: this record is kept until it is taken off." : "Legal hold taken off. The normal keep period applies again." }, "#records");
}

export async function reviewDoneAction(fd: FormData): Promise<void> {
  return achGate("annual_review.done", fd, { reply: replyAt("#reviews") }, (session) => reviewDoneBody(session, fd));
}

async function reviewDoneBody(session: StaffSession, fd: FormData): Promise<void> {
  const id = str(fd, "auth_id");
  const r = await markReviewDone({ authId: id, actorId: session.profile.id, note: str(fd, "note") });
  if (!r.ok) back({ error: r.error }, "#reviews");
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "ach.annual_review.done", entityType: "ach_authorizations", entityId: id, before: { annual_review_due_on: r.before.annual_review_due_on }, after: { annual_review_due_on: r.nextDue } }).catch(() => {});
  back({ msg: `Review recorded. Next one is due ${r.nextDue}.` }, "#reviews");
}
