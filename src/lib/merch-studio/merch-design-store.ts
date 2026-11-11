/**
 * D232 M-4 - server-only reads of public.merch_designs (migration 0360).
 * Writes live in src/app/admin/merch-studio/design-actions.ts (rev
 * compare-and-set). Rules: merch-design-sync-core.ts.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { rowFromDb, type DesignRow } from "./merch-design-sync-core";

export const DESIGNS_TABLE = "merch_designs";
export const MIGRATION_0360_MISSING = "The merch designs table doesn't exist yet - apply migration 0360_merch_designs.sql in Supabase (SQL editor), then reload.";

export function designDbError(message: string | undefined | null): string {
  const m = String(message ?? "");
  return /merch_designs/.test(m) && /does not exist|schema cache|not find/i.test(m) ? MIGRATION_0360_MISSING : `The database refused: ${m || "unknown error"}.`;
}

export async function listDesignRows(): Promise<{ rows: DesignRow[]; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { rows: [], error: "Database is not configured." };
  try {
    const { data, error } = await createSupabaseAdminClient().from(DESIGNS_TABLE).select("*").is("archived_at", null).order("updated_at", { ascending: false }).limit(200);
    if (error) return { rows: [], error: designDbError(error.message) };
    return { rows: ((data ?? []) as Record<string, unknown>[]).map(rowFromDb).filter((r): r is DesignRow => !!r), error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : "read failed" };
  }
}

/** One live (not archived) design, or null. `error` set only when the read itself failed. */
export async function readDesignRow(id: string): Promise<{ row: DesignRow | null; archived: boolean; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { row: null, archived: false, error: "Database is not configured." };
  try {
    const { data, error } = await createSupabaseAdminClient().from(DESIGNS_TABLE).select("*").eq("id", id).maybeSingle();
    if (error) return { row: null, archived: false, error: designDbError(error.message) };
    if (!data) return { row: null, archived: false, error: null };
    const raw = data as Record<string, unknown>;
    return { row: raw.archived_at ? null : rowFromDb(raw), archived: !!raw.archived_at, error: null };
  } catch (e) {
    return { row: null, archived: false, error: e instanceof Error ? e.message : "read failed" };
  }
}
