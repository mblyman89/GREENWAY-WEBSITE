/**
 * src/lib/pos/scan-required-store.ts  (POS Slice B41)
 *
 * Server-side persistence for the scan-required register mode. Stored as a
 * single site_settings JSON row (same NO-migration pattern as the B33 cash
 * rounding), so the owner can apply this slice with zero database work.
 *
 * Reads degrade to OFF when unset/unavailable — the register never invents
 * a restriction the owner didn't pick.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  DEFAULT_POS_SCAN_REQUIRED_CONFIG,
  normalizePosScanRequiredConfig,
  type PosScanRequiredConfig,
} from "@/lib/pos/scan-required-core";

export const POS_SCAN_REQUIRED_KEY = "pos_scan_required";
const POS_SCAN_REQUIRED_LABEL = "Scan-required register mode (POS B41)";

/** Read the owner's scan-required setting; safe OFF when unset/unavailable. */
export async function getPosScanRequiredConfig(): Promise<PosScanRequiredConfig> {
  if (!isSupabaseServiceConfigured) return { ...DEFAULT_POS_SCAN_REQUIRED_CONFIG };
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("site_settings")
      .select("value_json")
      .eq("key", POS_SCAN_REQUIRED_KEY)
      .maybeSingle();
    if (!data || data.value_json == null) return { ...DEFAULT_POS_SCAN_REQUIRED_CONFIG };
    return normalizePosScanRequiredConfig(data.value_json);
  } catch {
    return { ...DEFAULT_POS_SCAN_REQUIRED_CONFIG };
  }
}

/** Upsert the scan-required setting (normalized before write). */
export async function savePosScanRequiredConfig(
  config: PosScanRequiredConfig,
  updatedBy: string | null,
): Promise<{ ok: boolean; error?: string; config: PosScanRequiredConfig }> {
  const normalized = normalizePosScanRequiredConfig(config);
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Database is not configured.", config: normalized };
  }
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: POS_SCAN_REQUIRED_KEY,
        label: POS_SCAN_REQUIRED_LABEL,
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
