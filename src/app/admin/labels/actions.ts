"use server";
/**
 * D177 S6 — Label Studio server actions: saved store designs + print history.
 *
 * Gate: inventory.manage (owner / admin / manager), the same permission every
 * Label Studio page already requires. Everything from the browser is
 * re-validated by label-saved-core; designs are written to 0342 tables and
 * every create / change / removal / default move goes to the Security Log.
 * The print log is append-only and is NOT copied to the Security Log (it would
 * drown it); it has its own table and history panel.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  buildPrintLogRow,
  checkTemplateWrite,
  historyEntryFromRow,
  isKind,
  isLabelStudioMigrationMissing,
  sampleSubjectFor,
  savedErrorText,
  savedTemplateFromRow,
  sortSavedTemplates,
  type PrintHistoryEntry,
  type PrintLogInput,
  type SavedTemplate,
} from "@/lib/printing/label-saved-core";
import {
  archiveLabelTemplate,
  insertLabelTemplate,
  insertPrintLog,
  listLabelTemplates,
  listPrintHistoryFor,
  setDefaultLabelTemplate,
  updateLabelTemplate,
} from "@/lib/printing/label-saved-store";
import type { SubjectKind } from "@/lib/printing/label-layout-core";

export type SavedListResult =
  | { ok: true; templates: SavedTemplate[] }
  | { ok: false; error: string; migrationMissing: boolean };

export type SavedWriteResult =
  | { ok: true; templates: SavedTemplate[]; id?: string }
  | { ok: false; error: string; migrationMissing: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function reload(kind: SubjectKind): Promise<SavedListResult> {
  const res = await listLabelTemplates(kind);
  if (!res.ok) return { ok: false, error: savedErrorText(res.code, res.message, "designs"), migrationMissing: isLabelStudioMigrationMissing(res.code) };
  const sample = sampleSubjectFor(kind);
  const templates = sortSavedTemplates(res.rows.map((r) => savedTemplateFromRow(r, sample)).filter((t): t is SavedTemplate => !!t));
  return { ok: true, templates };
}

export async function listLabelTemplatesAction(kind: unknown): Promise<SavedListResult> {
  await requirePermission("inventory.manage");
  if (!isKind(kind)) return { ok: false, error: "Unknown label kind.", migrationMissing: false };
  return reload(kind);
}

export async function saveLabelTemplateAction(input: {
  id?: string | null;
  kind: unknown;
  name: unknown;
  printerId: unknown;
  stockId: unknown;
  template: unknown;
  makeDefault?: boolean;
}): Promise<SavedWriteResult> {
  const session = await requirePermission("inventory.manage");
  if (!isKind(input.kind)) return { ok: false, error: "Unknown label kind.", migrationMissing: false };
  const kind = input.kind;
  const selfId = typeof input.id === "string" && UUID_RE.test(input.id) ? input.id.toLowerCase() : null;

  const current = await listLabelTemplates(kind);
  if (!current.ok) return { ok: false, error: savedErrorText(current.code, current.message, "designs"), migrationMissing: isLabelStudioMigrationMissing(current.code) };
  const existing = current.rows.map((r) => ({ id: String(r.id), name: String(r.name ?? "") }));
  if (selfId && !existing.some((e) => e.id === selfId)) return { ok: false, error: "That design was removed by someone else. Save it as a new design.", migrationMissing: false };

  const check = checkTemplateWrite(input, existing, sampleSubjectFor(kind), selfId);
  if (!check.ok) return { ok: false, error: check.error, migrationMissing: false };

  let id = selfId;
  if (selfId) {
    const up = await updateLabelTemplate(selfId, check.row, session.userId);
    if (!up.ok) return { ok: false, error: up.code === "P0002" ? up.message : savedErrorText(up.code, up.message, "designs"), migrationMissing: isLabelStudioMigrationMissing(up.code) };
  } else {
    const ins = await insertLabelTemplate(check.row, session.userId);
    if (!ins.ok) return { ok: false, error: savedErrorText(ins.code, ins.message, "designs"), migrationMissing: isLabelStudioMigrationMissing(ins.code) };
    id = ins.id;
  }
  if (input.makeDefault && id) {
    const d = await setDefaultLabelTemplate(id, kind);
    if (!d.ok) return { ok: false, error: savedErrorText(d.code, d.message, "designs"), migrationMissing: isLabelStudioMigrationMissing(d.code) };
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: selfId ? "label_template.update" : "label_template.create",
    entityType: "label_templates",
    entityId: id ?? undefined,
    after: { kind, name: check.row.name, printer: check.row.printer_id, stock: check.row.stock_id, symbology: check.row.template.symbology, fields: check.row.template.fields, makeDefault: !!input.makeDefault },
  });

  const list = await reload(kind);
  if (!list.ok) return list;
  return { ok: true, templates: list.templates, id: id ?? undefined };
}

export async function setDefaultLabelTemplateAction(id: unknown, kind: unknown): Promise<SavedWriteResult> {
  const session = await requirePermission("inventory.manage");
  if (!isKind(kind) || typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, error: "Unknown design.", migrationMissing: false };
  const d = await setDefaultLabelTemplate(id, kind);
  if (!d.ok) {
    const gone = d.code === "P0002";
    return { ok: false, error: gone ? "That design was removed by someone else." : savedErrorText(d.code, d.message, "designs"), migrationMissing: isLabelStudioMigrationMissing(d.code) };
  }
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "label_template.set_default", entityType: "label_templates", entityId: id, after: { kind } });
  const list = await reload(kind);
  if (!list.ok) return list;
  return { ok: true, templates: list.templates };
}

export async function archiveLabelTemplateAction(id: unknown, kind: unknown): Promise<SavedWriteResult> {
  const session = await requirePermission("inventory.manage");
  if (!isKind(kind) || typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, error: "Unknown design.", migrationMissing: false };
  const a = await archiveLabelTemplate(id, kind, session.userId);
  if (!a.ok) return { ok: false, error: a.code === "P0002" ? a.message : savedErrorText(a.code, a.message, "designs"), migrationMissing: isLabelStudioMigrationMissing(a.code) };
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "label_template.archive", entityType: "label_templates", entityId: id, after: { kind, archived: true } });
  const list = await reload(kind);
  if (!list.ok) return list;
  return { ok: true, templates: list.templates };
}

/**
 * Record a print in the history. Never blocks printing: the studio calls this
 * after the print dialog opens and only shows a warning if it fails. "0342 not
 * applied" is reported as ok:false with migrationMissing so the UI can stay quiet.
 */
export async function logLabelPrintAction(input: PrintLogInput): Promise<{ ok: boolean; error?: string; migrationMissing?: boolean }> {
  const session = await requirePermission("inventory.manage");
  const built = buildPrintLogRow(input);
  if (!built.ok) return { ok: false, error: built.error };
  const res = await insertPrintLog(built.row, { id: session.userId, email: session.email ?? null });
  if (!res.ok) return { ok: false, error: savedErrorText(res.code, res.message, "history"), migrationMissing: isLabelStudioMigrationMissing(res.code) };
  return { ok: true };
}

export type HistoryResult =
  | { ok: true; entries: PrintHistoryEntry[] }
  | { ok: false; error: string; migrationMissing: boolean };

/** The last few prints that included one lot / item (newest first). */
export async function listPrintHistoryAction(subjectId: unknown): Promise<HistoryResult> {
  await requirePermission("inventory.manage");
  if (typeof subjectId !== "string" || !UUID_RE.test(subjectId)) return { ok: false, error: "Unknown item.", migrationMissing: false };
  const id = subjectId.toLowerCase();
  const res = await listPrintHistoryFor(id);
  if (!res.ok) return { ok: false, error: savedErrorText(res.code, res.message, "history"), migrationMissing: isLabelStudioMigrationMissing(res.code) };
  return { ok: true, entries: res.rows.map((r) => historyEntryFromRow(r, id)).filter((e): e is PrintHistoryEntry => !!e) };
}
