/**
 * src/lib/compliance/ccrs-ledger-store.ts — CCRS Bible v2 slice S-12b (I/O).
 *
 * The only code that talks to the 0248 functions. Every decision is in the
 * pure cores (ccrs-ledger-store-core, ccrs-outbox-core); this file just calls.
 *
 *   loadLedgerForBatch  → ccrs_ledger_slice   (read; "absent" = legacy routing)
 *   emitOutboxFiles     → ccrs_emit_files     (write; one transaction, 0248)
 *   readStoredFile      → ccrs_file_contents  (the exact stored bytes, re-hashed)
 *
 * S-12c (0249): listCcrsFiles, getCcrsFile, fileRowsForEcho, markUploaded,
 *   recordOutcome, abandonFile, startPreprodLedger.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkAssignResult, decodeLedgerSlice, LEDGER_SLICE_RPC, type AssignedProductId, type LedgerSliceOutcome } from "./ccrs-ledger-store-core";
import { checkEmitResult, sha256Utf8, type EmitIssue, type EmitPayloadFile, type EmitResultFile } from "./ccrs-outbox-core";
import type { LedgerEnv } from "./ccrs-ledger-core";
import type { CcrsRetailerFileType } from "./ccrs-batch-core";
import type { CcrsOutcomeKind, OurRow, RejectedRow } from "./ccrs-outcome-core";
import {
  decodeAbandon,
  decodeMarkUploaded,
  decodeOutcome,
  decodePreprodStart,
  type MarkUploadedAnswer,
  type OutcomeAnswer,
} from "./ccrs-lifecycle-core";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export async function loadLedgerForBatch(
  admin: Admin,
  env: LedgerEnv,
  inventoryIds: readonly string[],
  productNames: readonly string[],
): Promise<LedgerSliceOutcome> {
  const { data, error } = await admin.rpc(LEDGER_SLICE_RPC, {
    p_env: env,
    p_inventory_ids: [...new Set(inventoryIds)],
    p_product_names: [...new Set(productNames)],
  });
  return decodeLedgerSlice(env, data, error);
}

/**
 * Assign GWP- CCRS Product ids to product keys (D-01a). Idempotent: a key that
 * already has an id gets the SAME id back (newlyAssigned false); ids are never
 * reassigned (the 0248 trigger refuses UPDATE/DELETE).
 */
export async function assignProductIds(
  admin: Admin,
  env: LedgerEnv,
  keys: readonly string[],
  assignedBy: string,
  preprodRun?: string,
): Promise<AssignedProductId[]> {
  const { data, error } = await admin.rpc("ccrs_assign_product_ids", {
    p_env: env,
    p_keys: [...keys],
    p_assigned_by: assignedBy,
    p_preprod_run: env === "preprod" ? (preprodRun ?? null) : null,
  });
  if (error) throw new Error(`ccrs_assign_product_ids: ${error.code ?? "?"} ${error.message ?? ""}`.trim());
  return checkAssignResult(env, keys, data, preprodRun);
}

export async function emitOutboxFiles(
  admin: Admin,
  env: LedgerEnv,
  files: readonly EmitPayloadFile[],
  generalIssues: readonly EmitIssue[],
): Promise<EmitResultFile[]> {
  const { data, error } = await admin.rpc("ccrs_emit_files", {
    p_env: env,
    p_files: files,
    p_general_issues: generalIssues,
  });
  if (error) throw new Error(`ccrs_emit_files: ${error.code ?? "?"} ${error.message ?? ""}`.trim());
  return checkEmitResult(files, data);
}

/**
 * The stored bytes of one emitted file. Re-hashed against ccrs_files.sha256 on
 * EVERY read: a mismatch throws (the stored record would no longer be what
 * was handed to the operator, Part 05 §B).
 */
export async function readStoredFile(admin: Admin, fileId: string): Promise<{ fileName: string; csv: string }> {
  const { data: f, error: e1 } = await admin.from("ccrs_files").select("id, file_name, sha256").eq("id", fileId).single();
  if (e1 || !f) throw new Error(`ccrs_files ${fileId}: ${e1?.message ?? "not found"}`);
  const { data: c, error: e2 } = await admin.from("ccrs_file_contents").select("content").eq("file_id", fileId).single();
  if (e2 || !c) throw new Error(`ccrs_file_contents ${fileId}: ${e2?.message ?? "not found"}`);
  const csv = (c as { content: string }).content;
  const row = f as { file_name: string; sha256: string };
  if (sha256Utf8(csv) !== row.sha256) throw new Error(`ccrs_file_contents ${fileId}: stored bytes do not hash to ccrs_files.sha256`);
  return { fileName: row.file_name, csv };
}

/* ================================================================== *
 * S-12c: the upload lifecycle (0249). Decisions are in ccrs-outcome-core
 * and ccrs-lifecycle-core; every answer is decoded strictly there.
 * ================================================================== */

export type CcrsFileRecord = {
  id: string;
  env: LedgerEnv;
  fileType: CcrsRetailerFileType;
  purpose: string;
  fileName: string;
  numberRecords: number | null;
  state: string;
  stampAt: string | null;
  emittedAt: string | null;
  uploadedAt: string | null;
  successEmailAt: string | null;
  errorEmailAt: string | null;
  errorMessages: string[] | null;
  notes: string | null;
};
export type CcrsFileIssue = { fileId: string; severity: string; code: string; message: string };

const FILE_COLS =
  "id, env, file_type, purpose, file_name, number_records, state, stamp_at, emitted_at, uploaded_at, success_email_at, error_email_at, error_messages, notes";

type FileRowDb = {
  id: string; env: LedgerEnv; file_type: CcrsRetailerFileType; purpose: string; file_name: string; number_records: number | null;
  state: string; stamp_at: string | null; emitted_at: string | null; uploaded_at: string | null; success_email_at: string | null;
  error_email_at: string | null; error_messages: string[] | null; notes: string | null;
};
const toRecord = (r: FileRowDb): CcrsFileRecord => ({
  id: r.id, env: r.env, fileType: r.file_type, purpose: r.purpose, fileName: r.file_name, numberRecords: r.number_records,
  state: r.state, stampAt: r.stamp_at, emittedAt: r.emitted_at, uploadedAt: r.uploaded_at, successEmailAt: r.success_email_at,
  errorEmailAt: r.error_email_at, errorMessages: r.error_messages, notes: r.notes,
});

/**
 * The newest outbox files of one env (seed markers excluded: they were never
 * handed out), plus the issues of the files the operator must act on.
 * Returns `available: false` while 0248 is not applied.
 */
export async function listCcrsFiles(
  admin: Admin,
  env: LedgerEnv,
  limit = 60,
): Promise<{ available: boolean; files: CcrsFileRecord[]; issues: CcrsFileIssue[]; error: string | null }> {
  const { data, error } = await admin
    .from("ccrs_files")
    .select(FILE_COLS)
    .eq("env", env)
    .neq("purpose", "seed")
    .order("stamp_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    const missing = error.code === "42P01" || /ccrs_files/.test(error.message ?? "") && /does not exist|schema cache/.test(error.message ?? "");
    return { available: !missing, files: [], issues: [], error: missing ? null : `ccrs_files: ${error.message}` };
  }
  const files = ((data as FileRowDb[] | null) ?? []).map(toRecord);
  const needIssues = files.filter((f) => ["errored", "reconciling", "succeeded", "closed"].includes(f.state)).map((f) => f.id);
  let issues: CcrsFileIssue[] = [];
  if (needIssues.length > 0) {
    // Paged to the end (a fully refused 10,000-row chunk has 10,000 issues;
    // PostgREST would silently stop at 1,000). A short read is REPORTED.
    type IssueDb = { id: string; file_id: string; severity: string; code: string; message: string };
    const { rows, verdict } = await pagedAllChecked<IssueDb>(
      async (from, to) => {
        const { data: iss, error: e2 } = await admin
          .from("ccrs_file_issues")
          .select("id, file_id, severity, code, message")
          .in("file_id", needIssues)
          .in("code", ["CCRS_ROW_REJECTED", "CCRS_ROW_CONTRADICTS_LEDGER", "W_LOT_PRODUCT_UNRESOLVED"])
          .order("id", { ascending: true })
          .range(from, to);
        return { rows: (iss as IssueDb[] | null) ?? [], ok: !e2 };
      },
      { maxRows: 50_000 },
    );
    issues = rows.map((i) => ({ fileId: i.file_id, severity: i.severity, code: i.code, message: i.message }));
    if (!verdict.complete) return { available: true, files, issues, error: `ccrs_file_issues: ${verdict.message}` };
  }
  return { available: true, files, issues, error: null };
}

/** The files of one env with exactly these names (success-email matching; never "the newest N"). */
export async function ccrsFilesByName(admin: Admin, env: LedgerEnv, names: readonly string[]): Promise<CcrsFileRecord[]> {
  if (names.length === 0) return [];
  if (names.length > 500) throw new Error("ccrs_files: more than 500 names in one paste; paste fewer emails at a time");
  const { data, error } = await admin.from("ccrs_files").select(FILE_COLS).eq("env", env).in("file_name", [...new Set(names)]);
  if (error) throw new Error(`ccrs_files: ${error.message}`);
  return ((data as FileRowDb[] | null) ?? []).map(toRecord);
}

export async function getCcrsFile(admin: Admin, fileId: string): Promise<CcrsFileRecord> {
  const { data, error } = await admin.from("ccrs_files").select(FILE_COLS).eq("id", fileId).single();
  if (error || !data) throw new Error(`ccrs_files ${fileId}: ${error?.message ?? "not found"}`);
  return toRecord(data as FileRowDb);
}

/** Every row of one file (identity only), COMPLETE or it throws: a short read would mis-tie an echo. */
export async function fileRowsForEcho(admin: Admin, fileId: string, expected: number | null): Promise<OurRow[]> {
  const { rows, verdict } = await pagedAllChecked<{ row_no: number; external_id: string; operation: string | null }>(
    async (from, to) => {
      const { data, error } = await admin
        .from("ccrs_file_rows")
        .select("row_no, external_id, operation")
        .eq("file_id", fileId)
        .order("row_no", { ascending: true })
        .range(from, to);
      return { rows: (data as { row_no: number; external_id: string; operation: string | null }[] | null) ?? [], ok: !error };
    },
    { expectedTotal: expected },
  );
  if (!verdict.complete) throw new Error(`ccrs_file_rows ${fileId}: ${verdict.message}`);
  return rows.map((r) => ({ rowNo: r.row_no, externalId: r.external_id, operation: r.operation }));
}

function rpcError(fn: string, error: { code?: string; message?: string } | null): never {
  throw new Error(`${fn}: ${error?.message ?? "no answer"}`.trim());
}

export async function markUploaded(admin: Admin, fileId: string, uploadedAtISO: string, byProfileId: string, override: string | null): Promise<MarkUploadedAnswer> {
  const { data, error } = await admin.rpc("ccrs_mark_uploaded", {
    p_file_id: fileId, p_uploaded_at: uploadedAtISO, p_by: byProfileId, p_override: override,
  });
  if (error) rpcError("ccrs_mark_uploaded", error);
  return decodeMarkUploaded(fileId, data);
}

export async function recordOutcome(
  admin: Admin,
  fileId: string,
  outcome: CcrsOutcomeKind,
  atISO: string,
  rejected: readonly RejectedRow[],
  messages: readonly string[] | null,
): Promise<OutcomeAnswer> {
  const { data, error } = await admin.rpc("ccrs_record_outcome", {
    p_file_id: fileId, p_outcome: outcome, p_at: atISO, p_rejected: rejected, p_messages: messages,
  });
  if (error) rpcError("ccrs_record_outcome", error);
  return decodeOutcome(fileId, outcome, data);
}

export async function abandonFile(admin: Admin, fileId: string, reason: string): Promise<{ id: string; fileName: string }> {
  const { data, error } = await admin.rpc("ccrs_abandon_file", { p_file_id: fileId, p_reason: reason });
  if (error) rpcError("ccrs_abandon_file", error);
  return decodeAbandon(fileId, data);
}

export async function startPreprodLedger(admin: Admin, by: string): Promise<{ status: "started" | "already"; id: string }> {
  const { data, error } = await admin.rpc("ccrs_preprod_ledger_start", { p_by: by });
  if (error) rpcError("ccrs_preprod_ledger_start", error);
  return decodePreprodStart(data);
}
