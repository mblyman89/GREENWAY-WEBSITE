/**
 * R73 S7 - server-only read/write of the merch catalog (site_settings key
 * merch_catalog; same no-migration pattern as the ACH / compliance calendars).
 * Rules live in merch-inventory-core.ts. Never overwrites a catalog it could
 * not read (that could erase every published product).
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { MERCH_CATALOG_CONFLICT, MERCH_CATALOG_KEY, MERCH_CATALOG_LABEL, emptyCatalog, normalizeCatalog, type MerchCatalog } from "./merch-inventory-core";

export async function readMerchCatalog(): Promise<{ catalog: MerchCatalog; readError: string | null; updatedAt: string | null }> {
  if (!isSupabaseServiceConfigured) return { catalog: emptyCatalog(), readError: "Database is not configured.", updatedAt: null };
  try {
    const { data, error } = await createSupabaseAdminClient().from("site_settings").select("value_json, updated_at").eq("key", MERCH_CATALOG_KEY).maybeSingle();
    if (error) return { catalog: emptyCatalog(), readError: error.message, updatedAt: null };
    const row = data as { value_json?: unknown; updated_at?: string | null } | null;
    return { catalog: normalizeCatalog(row?.value_json ?? null), readError: null, updatedAt: row ? row.updated_at ?? null : null };
  } catch (e) {
    return { catalog: emptyCatalog(), readError: e instanceof Error ? e.message : "read failed", updatedAt: null };
  }
}

/**
 * Read -> change -> compare-and-set write. `change` returns the next catalog
 * or an error string. D232 M-5 (G-88 / F-11-16): the write only lands if the
 * row's updated_at is still the one we read (the trg_settings_updated trigger
 * moves it on every update, the same pattern as the D230 reopen and the
 * Cultivera auto-start state). The loser changes nothing and is told
 * MERCH_CATALOG_CONFLICT. A first-ever write inserts; a racing insert loses
 * the same way (unique key 23505).
 */
export async function updateMerchCatalog(change: (c: MerchCatalog) => MerchCatalog | string): Promise<{ ok: true; catalog: MerchCatalog } | { ok: false; error: string }> {
  const cur = await readMerchCatalog();
  if (cur.readError) return { ok: false, error: `Couldn't read the merch catalog, so nothing was changed: ${cur.readError}` };
  const next = change(cur.catalog);
  if (typeof next === "string") return { ok: false, error: next };
  try {
    const admin = createSupabaseAdminClient();
    const value = next as unknown as Record<string, unknown>;
    if (cur.updatedAt === null) {
      const { error } = await admin.from("site_settings").insert({ key: MERCH_CATALOG_KEY, label: MERCH_CATALOG_LABEL, value_json: value, updated_by: null });
      if (error) return { ok: false, error: (error as { code?: string }).code === "23505" ? MERCH_CATALOG_CONFLICT : error.message };
      return { ok: true, catalog: next };
    }
    const { data, error } = await admin
      .from("site_settings")
      .update({ value_json: value, updated_by: null })
      .eq("key", MERCH_CATALOG_KEY)
      .eq("updated_at", cur.updatedAt)
      .select("key");
    if (error) return { ok: false, error: error.message };
    if (((data as unknown[] | null) ?? []).length !== 1) return { ok: false, error: MERCH_CATALOG_CONFLICT };
    return { ok: true, catalog: next };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}
