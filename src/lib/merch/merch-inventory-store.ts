/**
 * R73 S7 - server-only read/write of the merch catalog (site_settings key
 * merch_catalog; same no-migration pattern as the ACH / compliance calendars).
 * Rules live in merch-inventory-core.ts. Never overwrites a catalog it could
 * not read (that could erase every published product).
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { MERCH_CATALOG_KEY, MERCH_CATALOG_LABEL, emptyCatalog, normalizeCatalog, type MerchCatalog } from "./merch-inventory-core";

export async function readMerchCatalog(): Promise<{ catalog: MerchCatalog; readError: string | null }> {
  if (!isSupabaseServiceConfigured) return { catalog: emptyCatalog(), readError: "Database is not configured." };
  try {
    const { data, error } = await createSupabaseAdminClient().from("site_settings").select("value_json").eq("key", MERCH_CATALOG_KEY).maybeSingle();
    if (error) return { catalog: emptyCatalog(), readError: error.message };
    return { catalog: normalizeCatalog(data?.value_json ?? null), readError: null };
  } catch (e) {
    return { catalog: emptyCatalog(), readError: e instanceof Error ? e.message : "read failed" };
  }
}

/** Read -> change -> write. `change` returns the next catalog or an error string. */
export async function updateMerchCatalog(change: (c: MerchCatalog) => MerchCatalog | string): Promise<{ ok: true; catalog: MerchCatalog } | { ok: false; error: string }> {
  const cur = await readMerchCatalog();
  if (cur.readError) return { ok: false, error: `Couldn't read the merch catalog, so nothing was changed: ${cur.readError}` };
  const next = change(cur.catalog);
  if (typeof next === "string") return { ok: false, error: next };
  try {
    const { error } = await createSupabaseAdminClient()
      .from("site_settings")
      .upsert({ key: MERCH_CATALOG_KEY, label: MERCH_CATALOG_LABEL, value_json: next as unknown as Record<string, unknown>, updated_by: null }, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
    return { ok: true, catalog: next };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}
