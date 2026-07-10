/**
 * src/lib/vendors/merge-service.ts — Task F (combine duplicate vendors).
 *
 * Server-only wrapper around the `merge_vendors(survivor_id, duplicate_ids)`
 * DB function (migration 0104). The function runs the whole merge in ONE
 * transaction: repoints every vendor_id reference, gap-fills only the
 * survivor's EMPTY fields, preserves every license as aliases + notes, then
 * ARCHIVES the duplicates (never deletes). Returns per-table repoint counts.
 *
 * Graceful degradation (0098 precedent): migrations are applied MANUALLY by
 * the owner, so if 0104 isn't in the database yet the RPC fails with a
 * "function … does not exist / schema cache" error — we surface a friendly
 * "apply migration 0104 first" message instead of a raw Postgres error.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type MergeVendorsSummary = {
  ok: boolean;
  mergedAt: string | null;
  survivorId: string;
  duplicateIds: string[];
  /** table name -> rows repointed to the survivor. */
  tables: Record<string, number>;
  totalRowsRepointed: number;
};

export const MERGE_MIGRATION_HINT =
  "The vendor-merge database function isn't installed yet. Apply migration 0104_merge_vendors.sql in the Supabase SQL editor, then try again.";

/** True when the RPC error means migration 0104 hasn't been applied. */
export function isMergeFunctionMissing(message: string): boolean {
  return /could not find|function|does not exist|schema cache/i.test(message);
}

/**
 * Execute the merge. Throws with a readable message on failure (including the
 * friendly migration hint when 0104 is missing) so the server action can show
 * it to the owner.
 */
export async function mergeVendors(
  survivorId: string,
  duplicateIds: string[],
): Promise<MergeVendorsSummary> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("merge_vendors", {
    survivor_id: survivorId,
    duplicate_ids: duplicateIds,
  });

  if (error) {
    if (isMergeFunctionMissing(error.message)) throw new Error(MERGE_MIGRATION_HINT);
    throw new Error(`Merge failed: ${error.message}`);
  }

  const raw = (data ?? {}) as {
    ok?: boolean;
    merged_at?: string;
    survivor_id?: string;
    duplicate_ids?: string[];
    tables?: Record<string, number>;
    total_rows_repointed?: number;
  };

  return {
    ok: raw.ok ?? true,
    mergedAt: raw.merged_at ?? null,
    survivorId: raw.survivor_id ?? survivorId,
    duplicateIds: raw.duplicate_ids ?? duplicateIds,
    tables: raw.tables ?? {},
    totalRowsRepointed: raw.total_rows_repointed ?? 0,
  };
}
