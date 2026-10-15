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
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StaffSession } from "@/lib/auth/session";
import { achGate } from "@/lib/payments/ach-gate";
import type { RedirectOutcome } from "@/lib/payments/ach-gate-core";
import { recordAudit } from "@/lib/auth/audit";
import { markAchFileBankStep, voidAchFile } from "@/lib/payments/ach-file-ledger-store";

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
