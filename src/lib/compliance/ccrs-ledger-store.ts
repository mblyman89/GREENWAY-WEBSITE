/**
 * src/lib/compliance/ccrs-ledger-store.ts — CCRS Bible v2 slice S-12b (I/O).
 *
 * The only code that talks to the 0248 functions. Every decision is in the
 * pure cores (ccrs-ledger-store-core, ccrs-outbox-core); this file just calls.
 *
 *   loadLedgerForBatch  → ccrs_ledger_slice   (read; "absent" = legacy routing)
 *   emitOutboxFiles     → ccrs_emit_files     (write; one transaction, 0248)
 *   readStoredFile      → ccrs_file_contents  (the exact stored bytes, re-hashed)
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkAssignResult, decodeLedgerSlice, LEDGER_SLICE_RPC, type AssignedProductId, type LedgerSliceOutcome } from "./ccrs-ledger-store-core";
import { checkEmitResult, sha256Utf8, type EmitIssue, type EmitPayloadFile, type EmitResultFile } from "./ccrs-outbox-core";
import type { LedgerEnv } from "./ccrs-ledger-core";

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
