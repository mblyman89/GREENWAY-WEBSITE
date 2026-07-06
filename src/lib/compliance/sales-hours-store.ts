/**
 * src/lib/compliance/sales-hours-store.ts  (S-12)
 *
 * Server glue for the owner-configurable sales-hours window. Persists in the
 * EXISTING `site_settings` KV table (same pattern as store-profile-store) — no
 * migration required. Reads degrade to the statutory default (8:00 AM–midnight,
 * WAC 314-55-147) whenever the row is missing or the database is unreachable,
 * so the completion gate always has a valid, legal window to enforce.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  DEFAULT_SALES_HOURS,
  normalizeSalesHoursWindow,
  type SalesHoursWindow,
} from "./sales-hours-core";

export const SALES_HOURS_KEY = "compliance_sales_hours";
const SALES_HOURS_LABEL = "Sales hours window (WAC 314-55-147)";

/** Read the configured window; statutory default when unset/unavailable. */
export async function getSalesHoursWindow(): Promise<SalesHoursWindow> {
  if (!isSupabaseServiceConfigured) return { ...DEFAULT_SALES_HOURS };
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("site_settings")
      .select("value_json")
      .eq("key", SALES_HOURS_KEY)
      .maybeSingle();
    if (!data || data.value_json == null) return { ...DEFAULT_SALES_HOURS };
    return normalizeSalesHoursWindow(data.value_json);
  } catch {
    return { ...DEFAULT_SALES_HOURS };
  }
}

/** Upsert the window (normalized — can tighten but never widen the statute). */
export async function saveSalesHoursWindow(
  window: SalesHoursWindow,
  updatedBy: string | null,
): Promise<{ ok: boolean; error?: string; window: SalesHoursWindow }> {
  const normalized = normalizeSalesHoursWindow(window);
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Database is not configured.", window: normalized };
  }
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: SALES_HOURS_KEY,
        label: SALES_HOURS_LABEL,
        value_json: normalized as unknown as Record<string, unknown>,
        updated_by: updatedBy,
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message, window: normalized };
    return { ok: true, window: normalized };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Save failed.",
      window: normalized,
    };
  }
}
