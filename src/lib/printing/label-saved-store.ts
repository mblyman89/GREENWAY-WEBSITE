/**
 * D177 S6 — server persistence for saved Label Studio designs and the print
 * history (migration 0342_label_studio.sql). Every call returns the DB error
 * code instead of swallowing it; callers explain it with savedErrorText and
 * treat "0342 not applied yet" (isLabelStudioMigrationMissing) as a hint, not
 * a failure — printing never depends on these tables.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import type { SubjectKind } from "@/lib/printing/label-layout-core";
import { HISTORY_LIMIT, MAX_TEMPLATES_PER_KIND, type PrintLogRow, type TemplateWrite } from "@/lib/printing/label-saved-core";

export type DbFail = { ok: false; code: string | null; message: string };
type Err = { code?: string | null; message?: string | null } | null;
const fail = (e: Err): DbFail => ({ ok: false, code: e?.code ?? null, message: e?.message ?? "" });
const NOT_CONFIGURED: DbFail = { ok: false, code: null, message: "Database not connected." };

const TEMPLATE_COLS = "id, kind, name, printer_id, stock_id, template, is_default, updated_at";

/** Live designs of one kind (≤ MAX_TEMPLATES_PER_KIND by construction; read one past it to notice drift). */
export async function listLabelTemplates(kind: SubjectKind): Promise<{ ok: true; rows: Record<string, unknown>[] } | DbFail> {
  if (!isSupabaseServiceConfigured) return { ok: true, rows: [] };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("label_templates")
    .select(TEMPLATE_COLS)
    .eq("kind", kind)
    .is("archived_at", null)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .range(0, MAX_TEMPLATES_PER_KIND);
  if (error) return fail(error);
  return { ok: true, rows: (data as Record<string, unknown>[] | null) ?? [] };
}

export async function insertLabelTemplate(row: TemplateWrite, actorId: string | null): Promise<{ ok: true; id: string } | DbFail> {
  if (!isSupabaseServiceConfigured) return NOT_CONFIGURED;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("label_templates")
    .insert({ ...row, created_by: actorId, updated_by: actorId })
    .select("id")
    .single();
  if (error) return fail(error);
  return { ok: true, id: String((data as { id: string }).id) };
}

export async function updateLabelTemplate(id: string, row: TemplateWrite, actorId: string | null): Promise<{ ok: true } | DbFail> {
  if (!isSupabaseServiceConfigured) return NOT_CONFIGURED;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("label_templates")
    .update({ name: row.name, printer_id: row.printer_id, stock_id: row.stock_id, template: row.template, updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("kind", row.kind)
    .is("archived_at", null)
    .select("id");
  if (error) return fail(error);
  if (!data || data.length === 0) return { ok: false, code: "P0002", message: "That design was removed by someone else." };
  return { ok: true };
}

/** Retire a design (archived, never deleted — 0342 grants no DELETE). A default is un-defaulted first. */
export async function archiveLabelTemplate(id: string, kind: SubjectKind, actorId: string | null): Promise<{ ok: true } | DbFail> {
  if (!isSupabaseServiceConfigured) return NOT_CONFIGURED;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("label_templates")
    .update({ is_default: false, archived_at: new Date().toISOString(), updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("kind", kind)
    .is("archived_at", null)
    .select("id");
  if (error) return fail(error);
  if (!data || data.length === 0) return { ok: false, code: "P0002", message: "That design was already removed." };
  return { ok: true };
}

export async function setDefaultLabelTemplate(id: string, kind: SubjectKind): Promise<{ ok: true } | DbFail> {
  if (!isSupabaseServiceConfigured) return NOT_CONFIGURED;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("label_template_set_default", { p_id: id, p_kind: kind });
  if (error) return fail(error);
  return { ok: true };
}

export async function insertPrintLog(row: PrintLogRow, actor: { id: string | null; email: string | null }): Promise<{ ok: true } | DbFail> {
  if (!isSupabaseServiceConfigured) return NOT_CONFIGURED;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("label_print_log").insert({ ...row, printed_by: actor.id, printed_by_email: actor.email });
  if (error) return fail(error);
  return { ok: true };
}

/** The last HISTORY_LIMIT prints that included this item (GIN on subject_ids). */
export async function listPrintHistoryFor(subjectId: string): Promise<{ ok: true; rows: Record<string, unknown>[] } | DbFail> {
  if (!isSupabaseServiceConfigured) return { ok: true, rows: [] };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("label_print_log")
    .select("id, printed_at, printed_by_email, total_labels, item_count, stock_id, symbology, items")
    .contains("subject_ids", [subjectId])
    .order("printed_at", { ascending: false })
    .range(0, HISTORY_LIMIT - 1);
  if (error) return fail(error);
  return { ok: true, rows: (data as Record<string, unknown>[] | null) ?? [] };
}
