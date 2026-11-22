"use server";

/**
 * D263 S8 - Print Studio saved designs + templates (content.edit, audited).
 * Save = insert (baseRev 0) or update only while the row is still at baseRev.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { cleanName, docBytes, MAX_DOC_BYTES, newPrintId, normalizeDoc, PRINT_ID_RE, saveDecision, summarize, type PrintDesignSummary, type PrintDoc } from "@/lib/printing/print-designs-core";
import { listPrintRows, printDbError, PRINT_DESIGNS_TABLE, readPrintRow } from "@/lib/printing/print-designs-store";

export async function listPrintDesignsAction(): Promise<{ items: PrintDesignSummary[]; error: string | null }> {
  await requirePermission("content.edit");
  const { rows, error } = await listPrintRows();
  return { items: rows.map(summarize), error };
}

export async function openPrintDesignAction(id: string): Promise<{ ok: true; id: string; rev: number; isTemplate: boolean; doc: PrintDoc } | { ok: false; error: string }> {
  await requirePermission("content.edit");
  if (!PRINT_ID_RE.test(String(id))) return { ok: false, error: "Bad design id." };
  const { row, error } = await readPrintRow(id);
  if (error) return { ok: false, error };
  if (!row) return { ok: false, error: "That design was archived or can't be read." };
  return { ok: true, id: row.id, rev: row.rev, isTemplate: row.isTemplate, doc: row.doc };
}

export async function savePrintDesignAction(p: { id: string | null; baseRev: number; doc: unknown; isTemplate?: boolean }): Promise<{ ok: true; id: string; rev: number } | { ok: false; error: string; conflict?: boolean }> {
  const session = await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const doc = normalizeDoc(p?.doc);
  if (!doc) return { ok: false, error: "Nothing to save - the design couldn't be read." };
  if (docBytes(doc) > MAX_DOC_BYTES) return { ok: false, error: "This design is too big to save (over 2 MB). Use library pictures instead of pasted ones." };
  const isNew = !p?.id;
  const id = isNew ? newPrintId() : String(p.id);
  if (!PRINT_ID_RE.test(id)) return { ok: false, error: "Bad design id." };
  const baseRev = isNew ? 0 : Math.max(0, Math.floor(Number(p.baseRev) || 0));
  const cur = isNew ? { rev: null, error: null } : await readPrintRow(id);
  if (cur.error) return { ok: false, error: cur.error };
  const decision = saveDecision(baseRev, cur.rev);
  if (decision === "gone") return { ok: false, error: "That design was archived. Use “Save as new”." };
  if (decision === "conflict") return { ok: false, conflict: true, error: "Someone saved this design after you opened it. Use “Save as new” to keep yours, or open it again." };
  const now = new Date().toISOString();
  const fields = { name: cleanName(doc.name), preset_id: doc.presetId, doc, is_template: !!p?.isTemplate, updated_by_email: session.email ?? null, updated_at: now };
  const admin = createSupabaseAdminClient();
  let rev = 1;
  if (decision === "insert") {
    const { error } = await admin.from(PRINT_DESIGNS_TABLE).insert({ id, ...fields, rev: 1, created_by_email: session.email ?? null });
    if (error) return { ok: false, error: printDbError(error.message) };
  } else {
    rev = baseRev + 1;
    const { data, error } = await admin.from(PRINT_DESIGNS_TABLE).update({ ...fields, rev }).eq("id", id).eq("rev", baseRev).is("archived_at", null).select("id");
    if (error) return { ok: false, error: printDbError(error.message) };
    if (!data?.length) return { ok: false, conflict: true, error: "Someone saved this design a moment ago. Use “Save as new”." };
  }
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: p?.isTemplate ? "print.template_saved" : "print.design_saved", entityType: "print_design", entityId: id, after: { name: fields.name, preset: doc.presetId, pages: doc.pages.length, rev } });
  return { ok: true, id, rev };
}

export async function archivePrintDesignAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requirePermission("content.edit");
  if (!PRINT_ID_RE.test(String(id))) return { ok: false, error: "Bad design id." };
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const { error } = await createSupabaseAdminClient().from(PRINT_DESIGNS_TABLE).update({ archived_at: new Date().toISOString(), updated_by_email: session.email ?? null }).eq("id", id).is("archived_at", null);
  if (error) return { ok: false, error: printDbError(error.message) };
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "print.design_archived", entityType: "print_design", entityId: id });
  return { ok: true };
}
