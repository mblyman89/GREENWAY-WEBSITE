/**
 * store-profile-store.ts (Slice 63) — server glue for the Store Profile.
 *
 * Persists the profile in the EXISTING `site_settings` KV table under the
 * STORE_PROFILE_KEY, using the admin client (RLS: staff read / staff write per
 * migration 0001; the app gates writes to settings.manage). No migration.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  DEFAULT_STORE_PROFILE,
  STORE_PROFILE_KEY,
  STORE_PROFILE_LABEL,
  normalizeStoreProfile,
  type StoreProfile,
} from "./store-profile-core";

/** Read the store profile; falls back to grounded defaults if unset/unavailable. */
export async function getStoreProfile(): Promise<StoreProfile> {
  if (!isSupabaseServiceConfigured) return DEFAULT_STORE_PROFILE;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("site_settings")
      .select("value_json")
      .eq("key", STORE_PROFILE_KEY)
      .maybeSingle();
    if (!data || data.value_json == null) return DEFAULT_STORE_PROFILE;
    return normalizeStoreProfile(data.value_json);
  } catch {
    return DEFAULT_STORE_PROFILE;
  }
}

/** Upsert the store profile row (value_json). Returns the normalized value. */
export async function saveStoreProfile(
  profile: StoreProfile,
  updatedBy: string | null,
): Promise<{ ok: boolean; error?: string; profile: StoreProfile }> {
  const normalized = normalizeStoreProfile(profile);
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Database is not configured.", profile: normalized };
  }
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: STORE_PROFILE_KEY,
        label: STORE_PROFILE_LABEL,
        value_json: normalized as unknown as Record<string, unknown>,
        updated_by: updatedBy,
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message, profile: normalized };
    return { ok: true, profile: normalized };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed.", profile: normalized };
  }
}
