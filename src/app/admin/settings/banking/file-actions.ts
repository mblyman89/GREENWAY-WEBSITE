"use server";

/**
 * R41 S3: actions on released ACH files (table ach_files, migration 0273).
 *
 * Void: owner only (achGate: Michael at once with a receipt, Stephen's void
 * becomes a request for Michael). A reason of 10+ characters is required.
 * The row and its bytes stay forever. A voided payroll file puts its run back
 * to draft so a corrected file can be released (with a new File ID Modifier).
 * The 0273 trigger checks the owner again (ach_actor_is_owner).
 *
 * R41 S6 (0274): Mark uploaded / Mark approved record the two steps the owner
 * takes in Timberland's cash management portal. Owner only through achGate
 * (an admin's press becomes a request); the 0274 trigger checks the owner
 * again, keeps the order (released -> uploaded -> bank_approved) and never
 * changes a stamp. Timberland's dual approval is off (signed Schedule C), so
 * the same owner may record both steps.
 *
 * R41 S9 (0276): Confirm funding records that the owner looked at the
 * account and saw at least the file total (section 14/16; the app cannot
 * read the balance). Owner only through achGate; the 0276 trigger checks the
 * owner again, allows it once per file, only while released or uploaded, and
 * never for less than the file total. It never blocks an upload.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StaffSession } from "@/lib/auth/session";
import { achGate } from "@/lib/payments/ach-gate";
import type { RedirectOutcome } from "@/lib/payments/ach-gate-core";
import { recordAudit } from "@/lib/auth/audit";
import { confirmAchFileFunding, markAchFileBankStep, readAchFileForFunding, voidAchFile } from "@/lib/payments/ach-file-ledger-store";
import { checkFundingForm, usd } from "@/lib/payments/timberland-funding-core";
import { requirePermission } from "@/lib/auth/session";
import { pacificToday } from "@/lib/reports/timezone";
import { setDualNoteDismiss } from "@/lib/payments/ach-guide-store";
import { dismissValue } from "@/lib/payments/timberland-bank-steps-core";

const FILES = "/admin/settings/banking/operations";

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}

function back(qs: { msg?: string; error?: string }): never {
  const p = new URLSearchParams();
  if (qs.msg) p.set("msg", qs.msg.slice(0, 900));
  if (qs.error) p.set("error", qs.error.slice(0, 900));
  revalidatePath(FILES);
  redirect(`${FILES}?${p.toString()}#files`);
}

export async function voidAchFileAction(fd: FormData): Promise<void> {
  return achGate("ach_file.void", fd, { reply: (r: RedirectOutcome): never => back(r.ok ? { msg: r.message } : { error: r.message }) }, (session) => voidAchFileBody(session, fd));
}

async function voidAchFileBody(session: StaffSession, fd: FormData): Promise<void> {
  const fileId = str(fd, "file_id");
  if (str(fd, "confirm") !== "yes") back({ error: "Tick the box to confirm this file must never be uploaded." });
  const r = await voidAchFile({ fileId, actorId: session.profile.id, reason: str(fd, "reason") });
  if (!r.ok) back({ error: r.error });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.file.voided",
    entityType: "ach_files",
    entityId: fileId,
    after: { kind: r.kind, reason: r.reason },
  }).catch(() => {});
  if (r.kind === "payroll") revalidatePath("/admin/payroll");
  back({
    msg:
      r.kind === "payroll"
        ? "File voided. The payroll run is a draft again: fix it and generate a new file (it gets a new File ID Modifier). If the voided file was already uploaded to Timberland, call Timberland now."
        : "File voided. If it was already uploaded to Timberland, call Timberland now. Release a new file if one is still needed.",
  });
}

export async function markAchFileUploadedAction(fd: FormData): Promise<void> {
  return achGate("ach_file.mark_uploaded", fd, { reply: (r: RedirectOutcome): never => back(r.ok ? { msg: r.message } : { error: r.message }) }, (session) => markBankStepBody(session, fd, "uploaded"));
}

export async function markAchFileBankApprovedAction(fd: FormData): Promise<void> {
  return achGate("ach_file.mark_bank_approved", fd, { reply: (r: RedirectOutcome): never => back(r.ok ? { msg: r.message } : { error: r.message }) }, (session) => markBankStepBody(session, fd, "bank_approved"));
}

async function markBankStepBody(session: StaffSession, fd: FormData, step: "uploaded" | "bank_approved"): Promise<void> {
  const fileId = str(fd, "file_id");
  if (str(fd, "confirm") !== "yes") {
    back({
      error:
        step === "uploaded"
          ? "Tick the box to confirm you uploaded this exact file in Timberland's portal."
          : "Tick the box to confirm you approved this file in Timberland's portal.",
    });
  }
  const r = await markAchFileBankStep({ fileId, actorId: session.profile.id, step });
  if (!r.ok) back({ error: r.error });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: step === "uploaded" ? "ach.file.uploaded" : "ach.file.bank_approved",
    entityType: "ach_files",
    entityId: fileId,
    after: { kind: r.kind, step },
  }).catch(() => {});
  back({
    msg:
      step === "uploaded"
        ? "Recorded: uploaded to Timberland. Now approve it in Timberland's portal, then press Mark approved."
        : "Recorded: approved at Timberland. Watch the bank feed for the settlement debit on the effective date.",
  });
}

export async function confirmAchFileFundingAction(fd: FormData): Promise<void> {
  return achGate("ach_file.confirm_funding", fd, { reply: (r: RedirectOutcome): never => back(r.ok ? { msg: r.message } : { error: r.message }) }, (session) => confirmFundingBody(session, fd));
}

async function confirmFundingBody(session: StaffSession, fd: FormData): Promise<void> {
  const fileId = str(fd, "file_id");
  const file = await readAchFileForFunding(fileId);
  if (!file.ok) back({ error: file.error });
  const form = checkFundingForm({ totalCents: file.totalCents, amount: str(fd, "amount"), confirm: str(fd, "confirm") });
  if (!form.ok) back({ error: form.error });
  const r = await confirmAchFileFunding({ fileId, actorId: session.profile.id, amountCents: form.amountCents });
  if (!r.ok) back({ error: r.error });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.file.funding_confirmed",
    entityType: "ach_files",
    entityId: fileId,
    after: { kind: r.kind, amount_cents: form.amountCents, file_total_cents: file.totalCents },
  }).catch(() => {});
  back({ msg: `Recorded: you saw ${usd(form.amountCents)} in the account. Keep it there through 9:00 am Pacific on the settlement date (you get a reminder at 8:00 am).` });
}

/**
 * R41 S6: "Don't show again" on the grey dual-approval line. The owner's
 * choice only (it is information about his own setup, not an ACH action, so
 * it is not an achGate kind). Logged in the audit trail; it lasts for the
 * calendar year, then the note comes back.
 */
export async function dismissDualApprovalNoteAction(): Promise<void> {
  const session = await requirePermission("settings.manage");
  if (session.profile.role !== "owner") back({ error: "Only the owner can hide this note." });
  const value = dismissValue(pacificToday(), new Date().toISOString(), session.email);
  const r = await setDualNoteDismiss(value);
  if (!r.ok) back({ error: `The note was not hidden: ${r.error}` });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.dual_approval_note.dismissed",
    entityType: "site_settings",
    entityId: "ach_dual_approval_note_dismissed",
    after: { year: value.year },
  }).catch(() => {});
  back({ msg: `Hidden for ${value.year}. It comes back in January, before the year-end Timberland review.` });
}
