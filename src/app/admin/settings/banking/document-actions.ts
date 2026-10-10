"use server";

/**
 * R39 S5 — ACH document intake actions.
 *
 *   dropAchDocumentAction    managers and admins (owner Q2). Employees need
 *                            staffing.manage, vendors vendors.manage, and both
 *                            need a drop role (owner/admin/manager), matching
 *                            the bucket policy public.is_manager() (0258).
 *   open / extract / rekey / reject: owner + admin only (settings.manage),
 *                            matching public.is_admin() and owner Q1.
 *
 * Audit rows carry document ids, kinds, statuses and last-4 only. Redirect
 * targets go through safeReturnPath (our own /admin pages only).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  canDropDocuments,
  entryFromForm,
  safeReturnPath,
  type PayeeType,
} from "@/lib/payments/ach-document-intake-core";
import {
  dropAchDocument,
  extractAchDocument,
  getAchDocument,
  rejectAchDocument,
  rekeyAndMaybeAccept,
  signedAchDocumentUrl,
} from "@/lib/payments/ach-document-store";

const QUEUE = "/admin/settings/banking/documents";

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}

function back(path: string, param: "ok" | "error", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${param}=${encodeURIComponent(message.slice(0, 600))}`);
}

function docPage(id: string): string {
  return /^[0-9a-f-]{36}$/.test(id) ? `${QUEUE}/${id}` : QUEUE;
}

export async function dropAchDocumentAction(fd: FormData): Promise<void> {
  const payeeType = str(fd, "payee_type") as PayeeType;
  const payeeId = str(fd, "payee_id").toLowerCase();
  const fallback = payeeType === "vendor" ? `/admin/vendors/${payeeId}` : `/admin/staffing/employees/${payeeId}`;
  const ret = safeReturnPath(str(fd, "return_to"), safeReturnPath(fallback, "/admin"));
  if (payeeType !== "employee" && payeeType !== "vendor") back(ret, "error", "Unknown payee type.");
  const session = await requirePermission(payeeType === "vendor" ? "vendors.manage" : "staffing.manage");
  if (!canDropDocuments(session.profile.role)) back(ret, "error", "Only managers, admins and the owner can drop ACH documents.");

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) back(ret, "error", "Pick the file to drop.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const res = await dropAchDocument({
    payeeType,
    payeeId,
    kind: str(fd, "kind"),
    filename: file.name,
    declaredMime: file.type,
    bytes,
    actorId: session.profile.id,
  });
  if (!res.ok) back(ret, "error", res.error);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "ach_document.drop",
    entityType: "ach_authorization_document",
    entityId: res.document.id,
    before: null,
    after: { payee_type: payeeType, payee_id: payeeId, kind: res.document.kind, mime: res.document.mime_type, bytes: res.document.byte_size, sha256: res.document.sha256 },
  });
  revalidatePath(ret);
  revalidatePath(QUEUE);
  back(ret, "ok", "Document dropped. The owner or an admin will check it and set up the banking. You will not see the bank details.");
}

export async function openAchDocumentAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const id = str(fd, "document_id");
  const doc = await getAchDocument(id);
  if (!doc) back(QUEUE, "error", "That document no longer exists.");
  const link = await signedAchDocumentUrl(doc);
  if (!link.ok) back(docPage(id), "error", link.error);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "ach_document.view",
    entityType: "ach_authorization_document",
    entityId: doc.id,
    before: null,
    after: { kind: doc.kind },
  });
  redirect(link.url);
}

export async function extractAchDocumentAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const id = str(fd, "document_id");
  const doc = await getAchDocument(id);
  if (!doc) back(QUEUE, "error", "That document no longer exists.");
  const res = await extractAchDocument({ doc, actorId: session.profile.id, actorEmail: session.email, useLlamaParse: str(fd, "llamaparse") === "on" });
  if (!res.ok) back(docPage(id), "error", res.error);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "ach_document.extract",
    entityType: "ach_authorization_document",
    entityId: doc.id,
    before: { intake_status: doc.intake_status },
    after: { llamaparse: str(fd, "llamaparse") === "on" },
  });
  revalidatePath(docPage(id));
  back(docPage(id), "ok", res.summary);
}

export async function rekeyAchDocumentAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const id = str(fd, "document_id");
  const doc = await getAchDocument(id);
  if (!doc) back(QUEUE, "error", "That document no longer exists.");
  const entry = entryFromForm((k) => str(fd, k), doc.payee_type);
  if (!entry.ok) back(docPage(id), "error", entry.errors.join(" "));
  const res = await rekeyAndMaybeAccept({
    doc,
    actorId: session.profile.id,
    accounts: entry.accounts,
    bankNames: entry.bankNames,
    signedOnRaw: str(fd, "signed_on"),
    payeeName: str(fd, "payee_name"),
    replaceOpen: str(fd, "replace_open") === "on",
  });
  if (!res.ok) back(docPage(id), "error", res.error);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: res.done ? "ach_document.accept" : "ach_document.rekey_mismatch",
    entityType: "ach_authorization_document",
    entityId: doc.id,
    before: { intake_status: doc.intake_status },
    after: { accounts: entry.accounts.length, account_last4: entry.accounts.map((a) => a.account.replace(/\D/g, "").slice(-4)) },
  });
  revalidatePath(docPage(id));
  revalidatePath(QUEUE);
  if (doc.payee_type === "employee" && doc.employee_id) revalidatePath(`/admin/staffing/employees/${doc.employee_id}`);
  if (doc.payee_type === "vendor" && doc.vendor_id) revalidatePath(`/admin/vendors/${doc.vendor_id}`);
  back(docPage(id), res.done ? "ok" : "error", res.message);
}

export async function rejectAchDocumentAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const id = str(fd, "document_id");
  const doc = await getAchDocument(id);
  if (!doc) back(QUEUE, "error", "That document no longer exists.");
  const reason = str(fd, "reason");
  if (reason.length < 10) back(docPage(id), "error", "Say why the document is rejected (at least 10 characters).");
  const res = await rejectAchDocument({ doc, actorId: session.profile.id, reason });
  if (!res.ok) back(docPage(id), "error", res.error);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "ach_document.reject",
    entityType: "ach_authorization_document",
    entityId: doc.id,
    before: { intake_status: doc.intake_status },
    after: { intake_status: "rejected", reason: reason.slice(0, 500) },
  });
  revalidatePath(QUEUE);
  back(QUEUE, "ok", "Document rejected and kept as evidence. Ask the payee for a new signed form.");
}
