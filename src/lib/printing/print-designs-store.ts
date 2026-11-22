/**
 * D263 S8 - server-only reads of public.print_designs (migration 0370).
 * Writes: src/app/admin/marketing/print-studio/design-actions.ts.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { rowFromDb, type PrintDesignRow } from "./print-designs-core";

export const PRINT_DESIGNS_TABLE = "print_designs";
export const MIGRATION_0370_MISSING = "The saved print designs table doesn't exist yet - apply migration 0370_print_designs.sql in Supabase (SQL editor), then reload.";

export function printDbError(message: string | undefined | null): string {
  const m = String(message ?? "");
  return /print_designs/.test(m) && /does not exist|schema cache|not find/i.test(m) ? MIGRATION_0370_MISSING : `The database refused: ${m || "unknown error"}.`;
}

export async function listPrintRows(): Promise<{ rows: PrintDesignRow[]; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { rows: [], error: "Database is not configured." };
  try {
    const { data, error } = await createSupabaseAdminClient().from(PRINT_DESIGNS_TABLE).select("*").is("archived_at", null).order("updated_at", { ascending: false }).limit(200);
    if (error) return { rows: [], error: printDbError(error.message) };
    return { rows: ((data ?? []) as Record<string, unknown>[]).map(rowFromDb).filter((r): r is PrintDesignRow => !!r), error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : "read failed" };
  }
}

export async function readPrintRow(id: string): Promise<{ row: PrintDesignRow | null; rev: number | null; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { row: null, rev: null, error: "Database is not configured." };
  try {
    const { data, error } = await createSupabaseAdminClient().from(PRINT_DESIGNS_TABLE).select("*").eq("id", id).is("archived_at", null).maybeSingle();
    if (error) return { row: null, rev: null, error: printDbError(error.message) };
    if (!data) return { row: null, rev: null, error: null };
    const raw = data as Record<string, unknown>;
    return { row: rowFromDb(raw), rev: Number(raw.rev) || 1, error: null };
  } catch (e) {
    return { row: null, rev: null, error: e instanceof Error ? e.message : "read failed" };
  }
}
