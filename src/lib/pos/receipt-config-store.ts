/**
 * src/lib/pos/receipt-config-store.ts  (POS Slice B13)
 *
 * Server-side persistence for the register-receipt customization. Stored as
 * a single site_settings JSON row (same NO-migration pattern as the
 * WAC 314-55-147 sales-hours window), so the owner can apply this slice with
 * zero database work.
 *
 * Reads degrade to DEFAULT_POS_RECEIPT_CONFIG when unset/unavailable — the
 * register always has a printable receipt.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  DEFAULT_POS_RECEIPT_CONFIG,
  normalizePosReceiptConfig,
  type PosReceiptConfig,
} from "@/lib/pos/receipt-config-core";

export const POS_RECEIPT_CONFIG_KEY = "pos_receipt_config";
const POS_RECEIPT_CONFIG_LABEL = "Register receipt customization (POS B13)";

/** Read the owner's receipt config; safe defaults when unset/unavailable. */
export async function getPosReceiptConfig(): Promise<PosReceiptConfig> {
  if (!isSupabaseServiceConfigured) return { ...DEFAULT_POS_RECEIPT_CONFIG };
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("site_settings")
      .select("value_json")
      .eq("key", POS_RECEIPT_CONFIG_KEY)
      .maybeSingle();
    if (!data || data.value_json == null) return { ...DEFAULT_POS_RECEIPT_CONFIG };
    return normalizePosReceiptConfig(data.value_json);
  } catch {
    return { ...DEFAULT_POS_RECEIPT_CONFIG };
  }
}

/** Upsert the receipt config (normalized/clamped before write). */
export async function savePosReceiptConfig(
  config: PosReceiptConfig,
  updatedBy: string | null,
): Promise<{ ok: boolean; error?: string; config: PosReceiptConfig }> {
  const normalized = normalizePosReceiptConfig(config);
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Database is not configured.", config: normalized };
  }
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: POS_RECEIPT_CONFIG_KEY,
        label: POS_RECEIPT_CONFIG_LABEL,
        value_json: normalized as unknown as Record<string, unknown>,
        updated_by: updatedBy,
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message, config: normalized };
    return { ok: true, config: normalized };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Save failed.",
      config: normalized,
    };
  }
}
