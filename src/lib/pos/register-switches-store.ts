/**
 * src/lib/pos/register-switches-store.ts (D241)
 *
 * Server-side persistence for the two owner register switches (browser
 * registers on/off, swap dual approval on/off). One site_settings JSON row,
 * no migration (same pattern as B41 scan-required).
 *
 * Reads degrade to TODAY's behaviour when unset or unavailable: browser
 * registers allowed, swap approval required.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  DEFAULT_REGISTER_SWITCHES,
  normalizeRegisterSwitches,
  type RegisterSwitches,
} from "@/lib/pos/register-switches-core";

export const POS_REGISTER_SWITCHES_KEY = "pos_register_switches";
const POS_REGISTER_SWITCHES_LABEL = "Register switches: browser registers, swap approval (D241)";

/** Read the owner's switches; today's behaviour when unset/unavailable. */
export async function getRegisterSwitches(): Promise<RegisterSwitches> {
  if (!isSupabaseServiceConfigured) return { ...DEFAULT_REGISTER_SWITCHES };
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("site_settings")
      .select("value_json")
      .eq("key", POS_REGISTER_SWITCHES_KEY)
      .maybeSingle();
    if (!data || data.value_json == null) return { ...DEFAULT_REGISTER_SWITCHES };
    return normalizeRegisterSwitches(data.value_json);
  } catch {
    return { ...DEFAULT_REGISTER_SWITCHES };
  }
}

/** Upsert the switches (normalized before write). */
export async function saveRegisterSwitches(
  switches: RegisterSwitches,
  updatedBy: string | null,
): Promise<{ ok: boolean; error?: string; switches: RegisterSwitches }> {
  const normalized = normalizeRegisterSwitches(switches);
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Database is not configured.", switches: normalized };
  }
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: POS_REGISTER_SWITCHES_KEY,
        label: POS_REGISTER_SWITCHES_LABEL,
        value_json: normalized as unknown as Record<string, unknown>,
        updated_by: updatedBy,
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message, switches: normalized };
    return { ok: true, switches: normalized };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed.", switches: normalized };
  }
}
