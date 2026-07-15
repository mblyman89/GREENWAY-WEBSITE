/**
 * src/lib/pos/cash-rounding-store.ts  (POS Slice B33)
 *
 * Server-side persistence for the cash-rounding policy. Stored as a single
 * site_settings JSON row (same NO-migration pattern as the B13 receipt
 * customization), so the owner can apply this slice with zero database work.
 *
 * Reads degrade to "off" when unset/unavailable — the register never
 * invents a rounding policy the owner didn't pick.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  DEFAULT_POS_CASH_ROUNDING_CONFIG,
  normalizePosCashRoundingConfig,
  type PosCashRoundingConfig,
} from "@/lib/pos/cash-rounding-core";

export const POS_CASH_ROUNDING_KEY = "pos_cash_rounding";
const POS_CASH_ROUNDING_LABEL = "Cash rounding policy (POS B33)";

/** Read the owner's rounding policy; safe "off" when unset/unavailable. */
export async function getPosCashRoundingConfig(): Promise<PosCashRoundingConfig> {
  if (!isSupabaseServiceConfigured) return { ...DEFAULT_POS_CASH_ROUNDING_CONFIG };
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("site_settings")
      .select("value_json")
      .eq("key", POS_CASH_ROUNDING_KEY)
      .maybeSingle();
    if (!data || data.value_json == null) return { ...DEFAULT_POS_CASH_ROUNDING_CONFIG };
    return normalizePosCashRoundingConfig(data.value_json);
  } catch {
    return { ...DEFAULT_POS_CASH_ROUNDING_CONFIG };
  }
}

/** Upsert the rounding policy (normalized before write). */
export async function savePosCashRoundingConfig(
  config: PosCashRoundingConfig,
  updatedBy: string | null,
): Promise<{ ok: boolean; error?: string; config: PosCashRoundingConfig }> {
  const normalized = normalizePosCashRoundingConfig(config);
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Database is not configured.", config: normalized };
  }
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: POS_CASH_ROUNDING_KEY,
        label: POS_CASH_ROUNDING_LABEL,
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
