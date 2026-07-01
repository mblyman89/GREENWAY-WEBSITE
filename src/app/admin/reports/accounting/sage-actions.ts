"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  uploadSageReport,
  deleteSageUpload,
  askSageAssistant,
  clearSageChatHistory,
  type SageAskResult,
} from "@/lib/accounting/sage-helper";

const BASE = "/admin/reports/accounting";

/** Upload a report used for Sage import. Staff (reports.view) may upload. */
export async function uploadSageReportAction(formData: FormData) {
  const session = await requirePermission("reports.view");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`${BASE}?tab=sage&error=${encodeURIComponent("Choose a file to upload.")}`);
  }
  const f = file as File;
  const buffer = Buffer.from(await f.arrayBuffer());
  const reportKind = ((formData.get("report_kind") as string | null) ?? "other").trim();
  const notes = ((formData.get("notes") as string | null) ?? "").trim() || null;

  const result = await uploadSageReport({
    fileName: f.name,
    contentType: f.type || "application/octet-stream",
    buffer,
    reportKind,
    notes,
    uploadedBy: session.profile.id,
  });
  if (!result.ok) {
    redirect(`${BASE}?tab=sage&error=${encodeURIComponent(result.error)}`);
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "sage.report_uploaded",
    entityType: "sage_import_uploads",
    entityId: result.id,
    after: { file_name: f.name, report_kind: reportKind, bytes: buffer.byteLength },
  });
  revalidatePath(BASE);
  redirect(`${BASE}?tab=sage&uploaded=1`);
}

/** Delete an uploaded report. */
export async function deleteSageReportAction(formData: FormData) {
  const session = await requirePermission("reports.view");
  const id = ((formData.get("id") as string | null) ?? "").trim();
  if (!id) redirect(`${BASE}?tab=sage`);
  const result = await deleteSageUpload(id);
  if (result.ok) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "sage.report_deleted",
      entityType: "sage_import_uploads",
      entityId: id,
    });
  }
  revalidatePath(BASE);
  redirect(`${BASE}?tab=sage`);
}

/** Ask the grounded Sage 50 assistant a question (returns the answer). */
export async function askSageAssistantAction(question: string, uploadId?: string | null): Promise<SageAskResult> {
  const session = await requirePermission("reports.view");
  return askSageAssistant(question, { id: session.profile.id, email: session.email }, uploadId ?? null);
}

/** Clear the Sage chat history. */
export async function clearSageChatAction() {
  const session = await requirePermission("reports.view");
  await clearSageChatHistory();
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "sage.chat_cleared",
    entityType: "sage_chat_messages",
    entityId: "all",
  });
  revalidatePath(BASE);
  redirect(`${BASE}?tab=sage`);
}
