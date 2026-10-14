/**
 * src/lib/pos/cultivera-reconcile.ts  (R50 A2)
 *
 * Server reads for the go / no-go page. The rules live in
 * cultivera-reconcile-core.ts; this module only reads:
 *
 *   1. pos_imports row (is_test, inventories_storage_key, status, created_at).
 *   2. The stored inventories workbook from the private `pos-raw` bucket - the
 *      SAME file createImportLots re-read to make the lots - parsed exactly the
 *      way transform.ts readWorkbookRowsFromBuffer does (sheet "Inventories",
 *      else the first sheet; raw:false; defval ""; keys and values
 *      whitespace-normalised).
 *   3. Every lot on the import's manifests (import-lineage-store, fail-closed,
 *      follows S2c re-homing). Destroyed lots are INCLUDED: received_qty is what
 *      the import wrote, whatever happened to the lot afterwards.
 *   4. For each missing barcode, any lot OUTSIDE the import with that CCRS id
 *      (the import's own dedupe key, import-service.ts createImportLots step 4).
 *   5. The owner's notes (audit_logs rows for this import).
 *
 * Nothing here writes. A failed read never becomes "balanced": reads 1-3 make
 * the whole answer an error or readsComplete=false; reads 4-5 are reported
 * beside the answer (the lines stay red, notes are shown as "could not load").
 */
import "server-only";
import * as XLSX from "xlsx";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { importManifestIds, readLotsOnManifests } from "@/lib/inventory/import-lineage-store";
import { isSafeImportId } from "@/lib/inventory/import-lineage-core";
import {
  RECONCILE_EXPLAIN_ACTION,
  RECONCILE_SIGNOFF_ACTION,
  RECONCILE_UNEXPLAIN_ACTION,
  RECONCILE_UNITS_COLUMN,
  explanationsFromEvents,
  fileSide,
  missingBarcodes,
  reconcile,
  type ExplainEvent,
  type Explanation,
  type FileSide,
  type ReconcileLot,
  type ReconcileReport,
  type WorkbookRow,
} from "@/lib/pos/cultivera-reconcile-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const RECONCILE_RAW_BUCKET = "pos-raw";
export const RECONCILE_SHEET = "Inventories";
export const RECONCILE_LOT_SELECT = "id, lot_code, received_qty, on_hand_qty, status";
/** Ids per `.in()` for the elsewhere lookup (barcodes are short; 150 stays well under the URL limit). */
export const RECONCILE_ELSEWHERE_CHUNK = 150;

export type ReconcileImport = { id: string; created_at: string; status: string; is_test: boolean; inventories_storage_key: string | null; inventories_filename: string | null };

export type SignOff = { by: string | null; at: string; verdict: string; cultivera: number; ours: number; open: number };

export type ReconcileLoad =
  | { ok: false; error: string; imp: ReconcileImport | null }
  | {
      ok: true;
      imp: ReconcileImport;
      file: FileSide;
      lots: ReconcileLot[];
      manifestIds: string[];
      report: ReconcileReport;
      elsewhereError: string | null;
      explanations: Map<string, Explanation>;
      notesError: string | null;
      lastSignOff: SignOff | null;
    };

function ws(v: unknown): string {
  return String(v ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

/** transform.ts readWorkbookRowsFromBuffer, byte for byte. */
/** Columns the comparison reads; all must be in the header row. */
export const RECONCILE_REQUIRED_COLUMNS = ["Barcode", "Product", RECONCILE_UNITS_COLUMN] as const;

export function readInventoryRows(buffer: Buffer | Uint8Array): WorkbookRow[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const name = wb.SheetNames.includes(RECONCILE_SHEET) ? RECONCILE_SHEET : wb.SheetNames[0];
  if (!name) throw new Error("The stored Cultivera file has no sheets.");
  const sheet = wb.Sheets[name];
  // Junk bytes still "parse" (as one-cell CSV), so prove it is the Cultivera export by its header row.
  const head = (XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false })[0] ?? []).map((h) => ws(h));
  const missing = RECONCILE_REQUIRED_COLUMNS.filter((c) => !head.includes(c));
  if (missing.length) throw new Error(`It does not look like Cultivera's inventories export (missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}).`);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [ws(k), ws(v)])));
}

/** Lots outside the import that carry a missing barcode as their CCRS id. Throws on any failed page. */
export async function lotsElsewhere(admin: Admin, barcodes: readonly string[], importManifests: readonly string[]): Promise<Map<string, string[]>> {
  const mine = new Set(importManifests);
  const out = new Map<string, string[]>();
  for (let i = 0; i < barcodes.length; i += RECONCILE_ELSEWHERE_CHUNK) {
    const chunk = barcodes.slice(i, i + RECONCILE_ELSEWHERE_CHUNK);
    const read = await pagedAllChecked<{ id: string; ccrs_inventory_external_id: string | null; manifest_id: string | null }>(async (from, to) => {
      const { data, error } = await admin
        .from("inventory_lots")
        .select("id, ccrs_inventory_external_id, manifest_id")
        .in("ccrs_inventory_external_id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      return { ok: !error, rows: (data as { id: string; ccrs_inventory_external_id: string | null; manifest_id: string | null }[] | null) ?? [] };
    });
    if (!read.verdict.complete) throw new Error(`Could not check whether the missing barcodes are lots elsewhere. ${read.verdict.message}`);
    for (const r of read.rows) {
      const code = ws(r.ccrs_inventory_external_id);
      if (!code || (r.manifest_id && mine.has(r.manifest_id))) continue;
      out.set(code, [...(out.get(code) ?? []), r.id]);
    }
  }
  return out;
}

type AuditRow = { id: number; action: string; actor_email: string | null; after_json: unknown; created_at: string };

/** The owner's notes + sign-offs for this import (audit_logs, fully paged). Throws on a failed page. */
export async function loadReconcileNotes(admin: Admin, importId: string): Promise<{ explanations: Map<string, Explanation>; lastSignOff: SignOff | null }> {
  const read = await pagedAllChecked<AuditRow>(async (from, to) => {
    const { data, error } = await admin
      .from("audit_logs")
      .select("id, action, actor_email, after_json, created_at")
      .eq("entity_type", "pos_import")
      .eq("entity_id", importId)
      .in("action", [RECONCILE_EXPLAIN_ACTION, RECONCILE_UNEXPLAIN_ACTION, RECONCILE_SIGNOFF_ACTION])
      .order("id", { ascending: true })
      .range(from, to);
    return { ok: !error, rows: (data as AuditRow[] | null) ?? [] };
  });
  if (!read.verdict.complete) throw new Error(`Could not load your notes. ${read.verdict.message}`);
  const events: ExplainEvent[] = [];
  let lastSignOff: SignOff | null = null;
  for (const r of read.rows) {
    const a = (r.after_json ?? {}) as Record<string, unknown>;
    if (r.action === RECONCILE_SIGNOFF_ACTION) {
      lastSignOff = {
        by: r.actor_email,
        at: r.created_at,
        verdict: String(a.verdict ?? ""),
        cultivera: Number(a.cultivera ?? 0),
        ours: Number(a.ours ?? 0),
        open: Number(a.open ?? 0),
      };
      continue;
    }
    events.push({ action: r.action, key: typeof a.key === "string" ? a.key : "", note: typeof a.note === "string" ? a.note : null, by: r.actor_email, at: r.created_at, id: r.id });
  }
  return { explanations: explanationsFromEvents(events), lastSignOff };
}

/** The non-test imports to pick from (newest first). Throws on a failed read. */
export async function listReconcileImports(admin: Admin, limit = 15): Promise<ReconcileImport[]> {
  const { data, error } = await admin
    .from("pos_imports")
    .select("id, created_at, status, is_test, inventories_storage_key, inventories_filename")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not list the imports. ${error.message}`);
  return ((data as ReconcileImport[] | null) ?? []).filter((r) => !r.is_test);
}

/** Everything the page needs for one import. */
export async function loadReconcile(admin: Admin, importId: string): Promise<ReconcileLoad> {
  if (!isSafeImportId(importId)) return { ok: false, error: "That import id is not valid.", imp: null };
  const { data, error } = await admin
    .from("pos_imports")
    .select("id, created_at, status, is_test, inventories_storage_key, inventories_filename")
    .eq("id", importId)
    .maybeSingle();
  if (error) return { ok: false, error: `Could not read the import. ${error.message}`, imp: null };
  const imp = data as ReconcileImport | null;
  if (!imp) return { ok: false, error: "That import was not found.", imp: null };
  if (imp.is_test) return { ok: false, error: "This is a test import. Test imports never make lots, so there is nothing to balance.", imp };
  if (!imp.inventories_storage_key) return { ok: false, error: "This import has no stored Cultivera inventories file, so it cannot be checked.", imp };

  const dl = await admin.storage.from(RECONCILE_RAW_BUCKET).download(imp.inventories_storage_key);
  if (dl.error || !dl.data) return { ok: false, error: `Could not read the stored Cultivera file (${dl.error?.message ?? "empty"}).`, imp };
  let rows: WorkbookRow[];
  try {
    rows = readInventoryRows(Buffer.from(await dl.data.arrayBuffer()));
  } catch (e) {
    return { ok: false, error: `The stored Cultivera file could not be opened. ${e instanceof Error ? e.message : String(e)}`, imp };
  }
  const file = fileSide(rows);

  let manifestIds: string[] = [];
  let lots: ReconcileLot[] = [];
  let readsComplete = true;
  let readError: string | null = null;
  try {
    manifestIds = await importManifestIds(admin, importId);
    lots = manifestIds.length ? await readLotsOnManifests<ReconcileLot>(admin, manifestIds, RECONCILE_LOT_SELECT) : [];
  } catch (e) {
    readsComplete = false;
    readError = e instanceof Error ? e.message : String(e);
  }

  let elsewhere = new Map<string, string[]>();
  let elsewhereError: string | null = null;
  if (readsComplete) {
    try {
      elsewhere = await lotsElsewhere(admin, missingBarcodes(file, lots), manifestIds);
    } catch (e) {
      elsewhereError = e instanceof Error ? e.message : String(e);
    }
  }
  const report = reconcile({ file, lots, elsewhere, readsComplete });
  if (readError) report.checks[0] = { ...report.checks[0], detail: `${report.checks[0].detail} ${readError}` };

  let explanations = new Map<string, Explanation>();
  let lastSignOff: SignOff | null = null;
  let notesError: string | null = null;
  try {
    ({ explanations, lastSignOff } = await loadReconcileNotes(admin, importId));
  } catch (e) {
    notesError = e instanceof Error ? e.message : String(e);
  }
  return { ok: true, imp, file, lots, manifestIds, report, elsewhereError, explanations, notesError, lastSignOff };
}

/**
 * Save one note / un-note / sign-off as an audit_logs row, CHECKED (recordAudit
 * swallows errors by design; a note that silently failed to save would leave
 * the owner thinking a line was explained). Returns the error text or null.
 */
export async function writeReconcileEvent(
  admin: Admin,
  v: { importId: string; action: string; actorId: string | null; actorEmail: string | null; after: Record<string, unknown> },
): Promise<string | null> {
  const { error } = await admin.from("audit_logs").insert({
    actor_id: v.actorId,
    actor_email: v.actorEmail,
    action: v.action,
    entity_type: "pos_import",
    entity_id: v.importId,
    before_json: null,
    after_json: v.after,
  });
  return error ? error.message : null;
}

/**
 * A2+ bulk notes: many events in ONE insert (all or nothing - PostgREST
 * inserts an array in one statement), CHECKED like writeReconcileEvent.
 * Returns the error text or null.
 */
export async function writeReconcileEvents(
  admin: Admin,
  v: { importId: string; action: string; actorId: string | null; actorEmail: string | null; afters: readonly Record<string, unknown>[] },
): Promise<string | null> {
  if (v.afters.length === 0) return null;
  const { error } = await admin.from("audit_logs").insert(
    v.afters.map((after) => ({
      actor_id: v.actorId,
      actor_email: v.actorEmail,
      action: v.action,
      entity_type: "pos_import",
      entity_id: v.importId,
      before_json: null,
      after_json: after,
    })),
  );
  return error ? error.message : null;
}
