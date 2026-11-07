/**
 * src/lib/registers/atm-drop-settings-store.ts  (D198 S2 - ATM cash drops)
 *
 * The owner's ATM-drop settings (enabled, ATM terminal id, witness policy, max $20s per drop,
 * match window). One site_settings JSON row (key pos_atm_drop), the same NO-migration pattern as
 * the cash-rounding policy. Reads NEVER throw: unset / unreadable -> safe defaults
 * (DEFAULT_ATM_DROP_SETTINGS in atm-drop-core).
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  DEFAULT_ATM_DROP_SETTINGS,
  POS_ATM_DROP_KEY,
  normalizeAtmDropSettings,
  type AtmDropSettings,
} from "@/lib/registers/atm-drop-core";

const LABEL = "ATM cash drops from the tills (D198)";

export async function getAtmDropSettings(): Promise<AtmDropSettings> {
  if (!isSupabaseServiceConfigured) return { ...DEFAULT_ATM_DROP_SETTINGS };
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("site_settings").select("value_json").eq("key", POS_ATM_DROP_KEY).maybeSingle();
    if (!data || data.value_json == null) return { ...DEFAULT_ATM_DROP_SETTINGS };
    return normalizeAtmDropSettings(data.value_json);
  } catch {
    return { ...DEFAULT_ATM_DROP_SETTINGS };
  }
}

export async function saveAtmDropSettings(
  settings: unknown,
  updatedBy: string | null,
): Promise<{ ok: boolean; error?: string; settings: AtmDropSettings }> {
  const normalized = normalizeAtmDropSettings(settings);
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured.", settings: normalized };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      { key: POS_ATM_DROP_KEY, label: LABEL, value_json: normalized as unknown as Record<string, unknown>, updated_by: updatedBy },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message, settings: normalized };
    return { ok: true, settings: normalized };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed.", settings: normalized };
  }
}
