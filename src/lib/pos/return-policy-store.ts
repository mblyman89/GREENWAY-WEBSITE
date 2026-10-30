/**
 * src/lib/pos/return-policy-store.ts  (Fix Phase 6F, G-67 / G-68)
 *
 * Server-side persistence for the owner's customer-return policy (loyalty
 * toggle, return window, returnable product types). One site_settings JSON
 * row, the same no-migration pattern as cash rounding and scan-required.
 *
 * Reads degrade to DEFAULT_POS_RETURN_POLICY (owner message 9: anyone, 7
 * days, every product type) when unset or unavailable.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  DEFAULT_POS_RETURN_POLICY,
  normalizePosReturnPolicy,
  type PosReturnPolicyConfig,
} from "@/lib/pos/return-policy-core";

export const POS_RETURN_POLICY_KEY = "pos_return_policy";
const POS_RETURN_POLICY_LABEL = "Customer return policy (Fix Phase 6F)";

function defaults(): PosReturnPolicyConfig {
  return { ...DEFAULT_POS_RETURN_POLICY, excludedCategories: [] };
}

/** Read the owner's return policy; the message-9 default when unset/unavailable. */
export async function getPosReturnPolicy(): Promise<PosReturnPolicyConfig> {
  if (!isSupabaseServiceConfigured) return defaults();
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("site_settings")
      .select("value_json")
      .eq("key", POS_RETURN_POLICY_KEY)
      .maybeSingle();
    if (!data || data.value_json == null) return defaults();
    return normalizePosReturnPolicy(data.value_json);
  } catch {
    return defaults();
  }
}

/** Upsert the return policy (normalized before write). */
export async function savePosReturnPolicy(
  config: PosReturnPolicyConfig,
  updatedBy: string | null,
): Promise<{ ok: boolean; error?: string; config: PosReturnPolicyConfig }> {
  const normalized = normalizePosReturnPolicy(config);
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Database is not configured.", config: normalized };
  }
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: POS_RETURN_POLICY_KEY,
        label: POS_RETURN_POLICY_LABEL,
        value_json: normalized as unknown as Record<string, unknown>,
        updated_by: updatedBy,
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message, config: normalized };
    return { ok: true, config: normalized };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed.", config: normalized };
  }
}
