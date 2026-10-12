/**
 * R47 — read / save the Google store listing hours (site_settings KV, no
 * migration; site_settings is KEEP on factory reset). Reads never throw and
 * fall back to the built-in 8 AM–11 PM daily hours.
 */
import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificDayKey } from "@/lib/reports/timezone";
import { DEFAULT_STORE_HOURS, normalizeStoreHours, type StoreHours } from "./store-hours-core";

export const STORE_HOURS_KEY = "google_store_hours";
const STORE_HOURS_LABEL = "Google store listing hours (weekly + holiday)";
export const STORE_HOURS_TAG = "store-hours";

function fresh(): StoreHours {
  return normalizeStoreHours(DEFAULT_STORE_HOURS);
}

async function readUncached(): Promise<StoreHours> {
  if (!isSupabaseServiceConfigured) return fresh();
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("site_settings")
      .select("value_json")
      .eq("key", STORE_HOURS_KEY)
      .maybeSingle();
    if (!data || data.value_json == null) return fresh();
    return normalizeStoreHours(data.value_json);
  } catch {
    return fresh();
  }
}

const readCached = unstable_cache(readUncached, ["google-store-hours", "v1"], {
  revalidate: 3600,
  tags: [STORE_HOURS_TAG],
});

/** For the public pages (cached; cleared on save). */
export async function getStoreHours(): Promise<StoreHours> {
  try {
    return await readCached();
  } catch {
    return readUncached();
  }
}

/** For the admin editor (always fresh). */
export async function getStoreHoursForEdit(): Promise<StoreHours> {
  return readUncached();
}

/** Hours + today's Pacific date, ready for storeSchema(hours, today). */
export async function getStoreSchemaInput(): Promise<[StoreHours, string]> {
  return [await getStoreHours(), pacificDayKey(new Date())];
}

export async function saveStoreHours(
  hours: StoreHours,
  updatedBy: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const normalized = normalizeStoreHours(hours);
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: STORE_HOURS_KEY,
        label: STORE_HOURS_LABEL,
        value_json: normalized as unknown as Record<string, unknown>,
        updated_by: updatedBy,
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
  try {
    revalidateTag(STORE_HOURS_TAG, "max");
  } catch (e) {
    console.error("[store-hours] revalidateTag failed:", e);
  }
  return { ok: true };
}
