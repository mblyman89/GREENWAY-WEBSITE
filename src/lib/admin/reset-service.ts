/**
 * src/lib/admin/reset-service.ts
 *
 * Server-only service that wraps the `reset_operational_data()` DB function
 * (migration 0069). That function deletes ONLY operational/transactional data
 * (sales, COGS, inventory, imported products, customers/loyalty signups, tills,
 * time/payroll, etc.) in a verified child->parent order, and NEVER touches
 * owner settings/config, the knowledge base, CMS/marketing, product masters /
 * members / enrichments, brands, vendors, promotions, people/hardware, or
 * audit_logs.
 *
 * The caller (server action) is responsible for permission gating + a typed
 * confirmation + audit logging. This module just executes the RPC and returns
 * a typed, per-table summary of what was removed.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ResetOperationalDataSummary = {
  ok: boolean;
  resetAt: string | null;
  totalRowsDeleted: number;
  /** table name -> rows deleted (only tables the DB function reported). */
  tables: Record<string, number>;
};

/**
 * Execute the full operational-data reset. Throws with a readable message on
 * failure so the server action can surface it to the admin.
 *
 * S-6 retention guard (migration 0097): when completed orders or CCRS batches
 * exist, the DB function refuses unless `acknowledgeRetention` is true — the
 * caller must have collected the export-first attestation (WAC 314-55-087
 * three-year record retention) before passing it.
 *
 * Backward-compatible: if 0097 hasn't been applied yet the guarded signature
 * doesn't exist, so we retry the legacy zero-argument call (owner applies
 * migrations manually).
 */
export async function resetOperationalData(
  acknowledgeRetention = false,
): Promise<ResetOperationalDataSummary> {
  const admin = createSupabaseAdminClient();
  let { data, error } = await admin.rpc("reset_operational_data", {
    acknowledge_wac_314_55_087: acknowledgeRetention,
  });
  if (error && /function|parameter|argument|acknowledge_wac_314_55_087|schema cache/i.test(error.message)) {
    // Migration 0097 not applied yet — fall back to the legacy 0069 signature.
    ({ data, error } = await admin.rpc("reset_operational_data"));
  }
  if (error) throw new Error(`Reset failed: ${error.message}`);

  const raw = (data ?? {}) as {
    ok?: boolean;
    reset_at?: string;
    total_rows_deleted?: number;
    tables?: Record<string, number>;
  };

  return {
    ok: raw.ok ?? true,
    resetAt: raw.reset_at ?? null,
    totalRowsDeleted: raw.total_rows_deleted ?? 0,
    tables: raw.tables ?? {},
  };
}
