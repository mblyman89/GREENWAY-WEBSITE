/**
 * src/lib/pos/drawer-on-sale-store.ts  (R-DRAWER-1)
 *
 * Server-side persistence for "open the cash drawer with or without a printed
 * receipt". One site_settings JSON row (no migration), same pattern as the
 * B41 scan-required mode. Reads fall back to the default (with a printed
 * receipt, today's behaviour) when unset or unavailable.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { dbErrorForStaff } from "@/lib/db/rpc-fallback-core";
import {
  DEFAULT_POS_DRAWER_ON_SALE_CONFIG,
  normalizePosDrawerOnSaleConfig,
  type PosDrawerOnSaleConfig,
} from "@/lib/pos/drawer-on-sale-core";

export const POS_DRAWER_ON_SALE_KEY = "pos_drawer_on_sale";
const POS_DRAWER_ON_SALE_LABEL = "Cash drawer on a sale: with or without a receipt (R-DRAWER-1)";

/** Read the owner's setting; the default when unset/unavailable. */
export async function getPosDrawerOnSaleConfig(): Promise<PosDrawerOnSaleConfig> {
  if (!isSupabaseServiceConfigured) return { ...DEFAULT_POS_DRAWER_ON_SALE_CONFIG };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("site_settings")
      .select("value_json")
      .eq("key", POS_DRAWER_ON_SALE_KEY)
      .maybeSingle();
    if (error) {
      console.error("[drawer-on-sale] read failed:", dbErrorForStaff(error));
      return { ...DEFAULT_POS_DRAWER_ON_SALE_CONFIG };
    }
    if (!data || data.value_json == null) return { ...DEFAULT_POS_DRAWER_ON_SALE_CONFIG };
    return normalizePosDrawerOnSaleConfig(data.value_json);
  } catch {
    return { ...DEFAULT_POS_DRAWER_ON_SALE_CONFIG };
  }
}

/** Upsert the setting (normalized before write). */
export async function savePosDrawerOnSaleConfig(
  config: PosDrawerOnSaleConfig,
  updatedBy: string | null,
): Promise<{ ok: boolean; error?: string; config: PosDrawerOnSaleConfig }> {
  const normalized = normalizePosDrawerOnSaleConfig(config);
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Database is not configured.", config: normalized };
  }
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: POS_DRAWER_ON_SALE_KEY,
        label: POS_DRAWER_ON_SALE_LABEL,
        value_json: normalized as unknown as Record<string, unknown>,
        updated_by: updatedBy,
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: dbErrorForStaff(error, "Save failed."), config: normalized };
    return { ok: true, config: normalized };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed.", config: normalized };
  }
}
