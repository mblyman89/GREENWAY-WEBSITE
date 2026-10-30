/**
 * CCRS slice C1 (D-3): the owner's approved InventoryTransfer corrections
 * (site_settings, one list per environment, no migration).
 *
 * A transfer CCRS holds whose facts changed since CCRS accepted it is sent as
 * an Update with the same ExternalIdentifier only after the owner approved
 * EXACTLY the new values: "Yes, the update path is the correct way to make
 * corrections." [EXAM2 L0058]. The pure rules live in ccrs-transfer-core.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { LedgerEnv } from "@/lib/compliance/ccrs-ledger-core";
import {
  approveTransferCorrection,
  normalizeTransferApprovals,
  transferCorrectionSettingKey,
  withdrawTransferCorrection,
  type TransferCorrectionApproval,
} from "@/lib/compliance/ccrs-transfer-core";

export async function readTransferCorrectionApprovals(env: LedgerEnv): Promise<{ items: TransferCorrectionApproval[]; error: string | null }> {
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("site_settings")
      .select("value_json")
      .eq("key", transferCorrectionSettingKey(env))
      .maybeSingle();
    if (error) return { items: [], error: error.message };
    return { items: normalizeTransferApprovals((data as { value_json?: unknown } | null)?.value_json ?? null), error: null };
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateTransferCorrectionApprovals(
  env: LedgerEnv,
  op: "approve" | "withdraw",
  item: { id: string; fingerprint: string },
  byId: string | null,
): Promise<{ ok: boolean; error?: string; items?: TransferCorrectionApproval[] }> {
  const cur = await readTransferCorrectionApprovals(env);
  if (cur.error) return { ok: false, error: cur.error };
  const next =
    op === "approve"
      ? approveTransferCorrection(cur.items, { id: item.id, fingerprint: item.fingerprint, at: new Date().toISOString(), by: byId })
      : withdrawTransferCorrection(cur.items, item.id);
  const { error } = await createSupabaseAdminClient()
    .from("site_settings")
    .upsert(
      {
        key: transferCorrectionSettingKey(env),
        label: `CCRS InventoryTransfer corrections approved by the owner (${env}, slice C1)`,
        value_json: { items: next } as unknown as Record<string, unknown>,
        updated_by: byId,
      },
      { onConflict: "key" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true, items: next };
}
