/**
 * src/lib/accounting/sage-helper.ts  (Slice 56)
 *
 * Server-side Sage 50 helper:
 *   - uploadSageReport(): store an uploaded report in the private 'sage-imports'
 *     bucket + extract a light aggregate summary (CSV totals) for AI mapping hints.
 *   - listSageUploads() / getSageChatHistory(): read the uploads + chat log.
 *   - askSageAssistant(): answer a Sage 50 question grounded on the verified KB +
 *     the store's GL mapping + recent upload summaries. Persists the Q and A.
 *
 * Grounded on docs/sage50-knowledge.md. .ptb backups are rejected in code.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { generate, isAiConfigured, aiModelId } from "@/lib/ai/provider";
import { getAccountingSettings } from "@/lib/accounting/sage50";
import {
  summarizeCsv,
  buildSageSystemPrompt,
  isRejectedSageFile,
  isAcceptedSageFile,
  fileExtension,
  isSageReportKind,
  sageReportKindLabel,
  type SageUploadSummary,
} from "@/lib/accounting/sage-helper-core";

const SAGE_BUCKET = "sage-imports";

export type SageUpload = {
  id: string;
  file_name: string;
  storage_path: string;
  content_type: string | null;
  file_bytes: number | null;
  report_kind: string;
  summary: SageUploadSummary | null;
  notes: string | null;
  created_at: string;
};

export type SageChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  upload_id: string | null;
  created_at: string;
};

const UPLOAD_COLS =
  "id, file_name, storage_path, content_type, file_bytes, report_kind, summary, notes, created_at";

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}

export type UploadSageReportInput = {
  fileName: string;
  contentType: string;
  buffer: Buffer;
  reportKind: string;
  notes?: string | null;
  uploadedBy: string | null;
};

/** Store an uploaded report + extract an aggregate summary. */
export async function uploadSageReport(
  input: UploadSageReportInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  if (isRejectedSageFile(input.fileName)) {
    return {
      ok: false,
      error:
        "A .ptb file is a proprietary Sage backup and cannot be read outside Sage 50. Please export the report (e.g. General Ledger or Trial Balance) to CSV or PDF and upload that instead.",
    };
  }
  if (!isAcceptedSageFile(input.fileName)) {
    return { ok: false, error: `Unsupported file type ${fileExtension(input.fileName)}. Upload a CSV, Excel, PDF, or TXT report.` };
  }
  const reportKind = isSageReportKind(input.reportKind) ? input.reportKind : "other";

  const admin = createSupabaseAdminClient();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `${stamp}/${sanitize(input.fileName)}`;

  const { error: upErr } = await admin.storage.from(SAGE_BUCKET).upload(key, input.buffer, {
    contentType: input.contentType || "application/octet-stream",
    upsert: true,
  });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  // Aggregate extraction for CSV/TXT only; other types stored as-is.
  let summary: SageUploadSummary | null = null;
  const ext = fileExtension(input.fileName);
  if (ext === ".csv" || ext === ".txt") {
    try {
      summary = summarizeCsv(input.buffer.toString("utf8"));
    } catch {
      summary = null;
    }
  } else {
    summary = { format: "non-csv", rowCount: 0, columnCount: 0, columns: [], numericTotals: [], note: `${ext} stored as a file; totals not auto-extracted.` };
  }

  const { data, error } = await admin
    .from("sage_import_uploads")
    .insert({
      file_name: input.fileName,
      storage_path: key,
      content_type: input.contentType || null,
      file_bytes: input.buffer.byteLength,
      report_kind: reportKind,
      summary,
      notes: input.notes?.trim() || null,
      uploaded_by: input.uploadedBy,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as { id: string }).id };
}

export async function listSageUploads(limit = 25): Promise<SageUpload[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sage_import_uploads")
    .select(UPLOAD_COLS)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as SageUpload[] | null) ?? [];
}

export async function deleteSageUpload(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data: row } = await admin.from("sage_import_uploads").select("storage_path").eq("id", id).maybeSingle();
  const path = (row as { storage_path?: string } | null)?.storage_path;
  if (path) await admin.storage.from(SAGE_BUCKET).remove([path]).catch(() => undefined);
  const { error } = await admin.from("sage_import_uploads").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function getSageChatHistory(limit = 40): Promise<SageChatMessage[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sage_chat_messages")
    .select("id, role, content, upload_id, created_at")
    .order("created_at", { ascending: true })
    .limit(limit);
  return (data as SageChatMessage[] | null) ?? [];
}

export async function clearSageChatHistory(): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin.from("sage_chat_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000");
}

/** Build the store/upload context string fed to the assistant (aggregate only). */
async function buildStoreContext(): Promise<string> {
  const lines: string[] = [];
  try {
    const s = await getAccountingSettings();
    lines.push("Store General-Journal G/L mapping (accounts must exist in Sage):");
    lines.push(`  Cash clearing=${s.glCashClearing || "(unset)"} · Cannabis sales=${s.glSalesCannabis || "(unset)"} · Non-cannabis sales=${s.glSalesNonCannabis || "(unset)"}`);
    lines.push(`  Sales tax payable=${s.glSalesTaxPayable || "(unset)"} · Excise tax payable=${s.glExciseTaxPayable || "(unset)"}`);
    lines.push(`  COGS=${s.glCogs || "(unset)"} · Inventory=${s.glInventory || "(unset)"} · Discounts=${s.glDiscounts || "(unset)"} · Ref prefix=${s.journalRefPrefix || "GW"}`);
  } catch {
    // settings optional
  }
  const uploads = await listSageUploads(5);
  if (uploads.length > 0) {
    lines.push("", "Recently uploaded reports (aggregate only — headers + numeric totals):");
    for (const u of uploads) {
      const totals = (u.summary?.numericTotals ?? [])
        .slice(0, 8)
        .map((t) => `${t.header}=${t.total}`)
        .join(", ");
      lines.push(
        `  • ${u.file_name} [${sageReportKindLabel(u.report_kind)}] — ${u.summary?.rowCount ?? 0} rows, ${u.summary?.columnCount ?? 0} cols${totals ? `; totals: ${totals}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

export type SageAskResult =
  | { ok: true; answer: string; model: string }
  | { ok: false; error: string };

/** Answer a Sage 50 question grounded on the KB + store context; persist Q&A. */
export async function askSageAssistant(
  question: string,
  actor: { id: string | null; email: string | null },
  uploadId?: string | null,
): Promise<SageAskResult> {
  const q = question.trim();
  if (!q) return { ok: false, error: "Ask a question first." };
  if (!isAiConfigured) return { ok: false, error: "The AI assistant is not configured (missing API key)." };

  const context = await buildStoreContext();
  const system = buildSageSystemPrompt(context);

  let answer: string;
  try {
    answer = await generate({
      system,
      user: q,
      temperature: 0.2,
      maxTokens: 700,
      context: {
        feature: "sage.assistant",
        entityType: "sage_chat_messages",
        actorId: actor.id,
        actorEmail: actor.email,
      },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI request failed." };
  }

  // Persist both messages (best-effort).
  if (isSupabaseServiceConfigured) {
    const admin = createSupabaseAdminClient();
    await admin
      .from("sage_chat_messages")
      .insert([
        { role: "user", content: q, upload_id: uploadId ?? null, author_id: actor.id },
        { role: "assistant", content: answer, upload_id: uploadId ?? null, author_id: actor.id },
      ])
      .then(() => undefined, () => undefined);
  }

  return { ok: true, answer, model: aiModelId };
}
