"use server";

/**
 * R41 S0: the owner's approvals list (D-6 option B, D-7, D-8).
 *
 *   approveAchRequestAction   Michael only. Re-checks the record has not
 *                             changed (D-7: stale requests are refused),
 *                             records the decision through the 0271 function
 *                             (owner + staleness re-checked under a row lock),
 *                             then re-runs the SAME exported action as Michael
 *                             inside the approval replay context. The result
 *                             is recorded on the request, Stephen is emailed,
 *                             and Michael gets a "Was this you?" receipt.
 *   rejectAchRequestAction    Michael only. Nothing runs.
 *   withdrawAchRequestAction  The person who asked only (0271 re-checks).
 *   checkOffReviewAction      Michael only. One item at a time.
 *
 * Every function here returns a result in words for useActionState; none of
 * them redirects. A failure is never silent.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { achAuthority, decisionEmail, isAchActionKind, ownerReceiptEmail, type AchActionKind } from "@/lib/auth/ach-authority-core";
import {
  approvalResultText,
  entriesToPairs,
  KIND_SPECS,
  pacificWhen,
  parseStoredEntries,
  redirectOutcome,
  redirectUrlFromDigest,
  vendorBuildOutcome,
  type RedirectOutcome,
} from "@/lib/payments/ach-gate-core";
import { APPROVALS_PATH, runAsApprovalReplay } from "@/lib/payments/ach-gate";
import {
  checkOffOwnerReview,
  decideChangeRequest,
  getChangeRequest,
  readTargetVersion,
  recordRequestResult,
  staffContact,
  supersedePendingFor,
} from "@/lib/payments/ach-requests-store";
import { resolveNotifyContacts } from "@/lib/payments/ach-authorization-core";
import { resendOpsMailer } from "@/lib/payments/ach-ops-store";
import { opsSiteUrl } from "@/lib/payments/ach-ops-ui-core";
import { decryptSecret } from "@/lib/security/at-rest-crypto";
import * as vault from "../vault-actions";
import * as ops from "../ops-actions";
import * as docs from "../document-actions";
import * as company from "../actions";
import * as payroll from "../../../payroll/actions";
import * as esign from "../../../vendors/vendor-esign-actions";
import * as flags from "../../../vendors/ach-flag-actions";
import * as ap from "../../../vendor-payments/actions";

export type ApprovalState = {
  ok: boolean;
  message: string;
  /** Only for an approved vendor ACH build: the file goes to Michael's browser. */
  file?: string;
  filename?: string;
} | null;

/**
 * Each kind runs the exported action Stephen's request came from. The map is
 * total over AchActionKind (TypeScript refuses a missing kind), and is pinned
 * against the gate calls by tests/compliance/r41-s0-owner-authority.test.ts.
 */
const REPLAY: { readonly [K in AchActionKind]: (fd: FormData, targetId: string | null) => Promise<unknown> } = {
  "vendor_bank.save": (fd) => vault.saveVendorBankingAction(fd),
  "vendor_bank.hold": (fd) => vault.holdVendorBankAction(fd),
  "vendor_bank.release": (fd) => vault.releaseVendorBankHoldAction(fd),
  "vendor_bank.verify": (fd) => vault.markVendorBankVerifiedAction(fd),
  "vendor_bank.archive": (fd) => vault.archiveVendorBankingAction(fd),
  "vendor_contact.add": (fd) => vault.addVendorContactAction(fd),
  "vendor_contact.retire": (fd) => vault.retireVendorContactAction(fd),
  "employee_bank.save": (fd) => vault.saveEmployeeBankingAction(fd),
  "employee_bank.clear": (fd) => vault.clearEmployeeBankingAction(fd),
  "ach_notice.log": (fd) => ops.logNoticeAction(fd),
  "ach_notice.resolve": (fd) => ops.resolveNoticeAction(fd),
  "employee_hold.release": (fd) => ops.releaseEmployeeHoldAction(fd),
  "ach_check.start": (fd) => ops.startCheckAction(fd),
  "ach_check.mark_sent": (fd) => ops.markCheckFileSentAction(fd),
  "ach_check.finish": (fd) => ops.finishCheckAction(fd),
  "legal_hold.set": (fd) => ops.setLegalHoldAction(fd),
  "annual_review.done": (fd) => ops.reviewDoneAction(fd),
  "ach_document.reject": (fd) => docs.rejectAchDocumentAction(fd),
  "banking_settings.save": (fd) => company.saveBankingSettingsAction(fd),
  "timberland_setup.confirm": (fd) => company.confirmTimberlandSetupAction(fd),
  "payroll.generate": (fd, targetId) => payroll.generateRunAction(targetId ?? "", fd),
  "vendor_esign.countersign": (fd) => esign.countersignVendorEsignAction(fd),
  "vendor_esign.reject": (fd) => esign.rejectVendorEsignAction(fd),
  "vendor_ach_flag.change": (fd) => flags.changeVendorAchFlagAction(fd),
  "vendor_ach.build": (fd) => ap.buildVendorAchAction(null, fd),
};

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const noteOf = (fd: FormData) => str(fd, "note").slice(0, 1000) || null;

async function mail(to: string, msg: { subject: string; html: string }): Promise<boolean> {
  try {
    return (await resendOpsMailer()([to], msg)).ok;
  } catch {
    return false;
  }
}

function done(r: { ok: boolean; message: string; file?: string; filename?: string }): ApprovalState {
  revalidatePath(APPROVALS_PATH);
  revalidatePath("/admin/settings/banking");
  return r;
}

export async function approveAchRequestAction(_prev: ApprovalState, fd: FormData): Promise<ApprovalState> {
  const session = await requirePermission("ach.act");
  if (achAuthority(session.profile.role) !== "act") return { ok: false, message: "Only Michael (the owner) approves ACH requests." };
  const req = await getChangeRequest(str(fd, "request_id"));
  if (!req) return { ok: false, message: "That request no longer exists. Reload the page." };
  if (req.status !== "pending") return done({ ok: false, message: `That request is already ${req.status}.` });
  if (!isAchActionKind(req.kind)) return { ok: false, message: "That request names an action this version of the site does not know. Reject it." };
  const kind: AchActionKind = req.kind;
  if (KIND_SPECS[kind].targetType !== req.target_type) return { ok: false, message: "That request does not match its record type. Reject it." };

  // Read the payload BEFORE deciding, so a damaged payload is never approved.
  const parsed = parseStoredEntries(decryptSecret(req.payload_enc));
  if (!parsed.ok) return { ok: false, message: parsed.refusal };

  const now = await readTargetVersion(kind, req.target_id);
  if (!now.ok) return { ok: false, message: now.error };

  const decided = await decideChangeRequest({ requestId: req.id, actorId: session.profile.id, decision: "approved", note: noteOf(fd), currentVersion: now.version });
  if (!decided.ok) return done({ ok: false, message: decided.error });

  const replayFd = new FormData();
  for (const [k, v] of entriesToPairs(parsed.entries)) replayFd.append(k, v);

  let outcome: RedirectOutcome;
  let value: unknown;
  try {
    value = await runAsApprovalReplay({ kind, targetId: req.target_id, ownerId: session.profile.id }, () => REPLAY[kind](replayFd, req.target_id));
    outcome = kind === "vendor_ach.build" ? vendorBuildOutcome(value as Parameters<typeof vendorBuildOutcome>[0]) : { ok: true, message: "Done." };
  } catch (e) {
    const url = redirectUrlFromDigest((e as { digest?: unknown } | null)?.digest);
    if (url === null) {
      // A real error: record it (the request stays approved, with the error), never rethrow into a blank page.
      outcome = { ok: false, message: "The change hit an unexpected error and may not have been made. Check the record before trying again." };
      console.error("[ach-approvals] replay error", kind, req.id, e instanceof Error ? e.message : "unknown");
    } else {
      outcome = redirectOutcome(url);
    }
  }

  const recorded = await recordRequestResult({
    requestId: req.id,
    actorId: session.profile.id,
    ref: outcome.ok ? outcome.message : null,
    error: outcome.ok ? null : outcome.message,
  });
  if (outcome.ok && req.target_id) {
    await supersedePendingFor({ ownerKind: kind, targetType: KIND_SPECS[kind].targetType, targetId: req.target_id, actorId: session.profile.id });
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.request.approve",
    entityType: "ach_change_request",
    entityId: req.id,
    after: { kind, target_id: req.target_id, requested_by: req.requested_by, applied: outcome.ok, result: outcome.message.slice(0, 300) },
  }).catch(() => {});

  const requester = await staffContact(req.requested_by);
  const applied = approvalResultText(kind, outcome);
  const toStephen = requester
    ? await mail(requester.email, decisionEmail({ decision: "approved", kind, target: req.target_label, note: noteOf(fd), applied }))
    : false;
  // D-8: an approval is an owner action, so Michael gets the receipt too.
  const owner = resolveNotifyContacts(process.env).contacts.michael.email;
  await mail(owner, ownerReceiptEmail({ kind, target: req.target_label, outcome: applied, whenPacific: pacificWhen(new Date()), url: `${opsSiteUrl(process.env)}${APPROVALS_PATH}` }));

  const extra = [
    recorded.ok ? "" : "The result could not be saved on the request (it is still approved).",
    toStephen ? "" : "The email to Stephen did not go; tell him.",
  ]
    .filter(Boolean)
    .join(" ");
  const v = value as { file?: unknown; filename?: unknown } | undefined;
  const file = kind === "vendor_ach.build" && outcome.ok && typeof v?.file === "string" ? v.file : undefined;
  const filename = file && typeof v?.filename === "string" ? v.filename : undefined;
  return done({ ok: outcome.ok, message: extra ? `${applied} ${extra}` : applied, file, filename });
}

export async function rejectAchRequestAction(_prev: ApprovalState, fd: FormData): Promise<ApprovalState> {
  const session = await requirePermission("ach.act");
  if (achAuthority(session.profile.role) !== "act") return { ok: false, message: "Only Michael (the owner) rejects ACH requests." };
  const req = await getChangeRequest(str(fd, "request_id"));
  if (!req) return { ok: false, message: "That request no longer exists. Reload the page." };
  const r = await decideChangeRequest({ requestId: req.id, actorId: session.profile.id, decision: "rejected", note: noteOf(fd), currentVersion: null });
  if (!r.ok) return done({ ok: false, message: r.error });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.request.reject",
    entityType: "ach_change_request",
    entityId: req.id,
    after: { kind: req.kind, target_id: req.target_id, requested_by: req.requested_by, note: noteOf(fd) },
  }).catch(() => {});
  const requester = await staffContact(req.requested_by);
  const mailed = requester ? await mail(requester.email, decisionEmail({ decision: "rejected", kind: req.kind, target: req.target_label, note: noteOf(fd), applied: null })) : false;
  return done({ ok: true, message: `Not approved. Nothing was changed.${mailed ? "" : " The email to Stephen did not go; tell him."}` });
}

export async function withdrawAchRequestAction(_prev: ApprovalState, fd: FormData): Promise<ApprovalState> {
  const session = await requirePermission("ach.request");
  const req = await getChangeRequest(str(fd, "request_id"));
  if (!req) return { ok: false, message: "That request no longer exists. Reload the page." };
  if (req.requested_by !== session.profile.id) return { ok: false, message: "Only the person who sent a request can withdraw it." };
  const r = await decideChangeRequest({ requestId: req.id, actorId: session.profile.id, decision: "withdrawn", note: noteOf(fd), currentVersion: null });
  if (!r.ok) return done({ ok: false, message: r.error });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.request.withdraw",
    entityType: "ach_change_request",
    entityId: req.id,
    after: { kind: req.kind, target_id: req.target_id },
  }).catch(() => {});
  return done({ ok: true, message: "Request withdrawn. Nothing was changed." });
}

export async function checkOffReviewAction(_prev: ApprovalState, fd: FormData): Promise<ApprovalState> {
  const session = await requirePermission("ach.act");
  if (achAuthority(session.profile.role) !== "act") return { ok: false, message: "Only Michael (the owner) checks off review items." };
  const reviewId = str(fd, "review_id");
  const r = await checkOffOwnerReview({ reviewId, actorId: session.profile.id, note: noteOf(fd) });
  if (!r.ok) return done({ ok: false, message: r.error });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.review.check_off",
    entityType: "ach_owner_review",
    entityId: reviewId,
    after: { note: noteOf(fd) },
  }).catch(() => {});
  return done({ ok: true, message: "Checked off." });
}
