/**
 * R74 S42: the owner's CCRS clean-up list (site_settings, no migration).
 * A product on it is never reported to CCRS and never counted as owed:
 * "allow me to add it to the clean up list of products we will remove from
 * our ccrs record file" (owner, Round 22).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  CCRS_CLEANUP_SETTING_KEY,
  addCleanup,
  normalizeCleanup,
  removeCleanup,
  type CleanupProduct,
} from "@/lib/compliance/ccrs-never-block-core";

export async function readCcrsCleanup(): Promise<{ items: CleanupProduct[]; error: string | null }> {
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("site_settings")
      .select("value_json")
      .eq("key", CCRS_CLEANUP_SETTING_KEY)
      .maybeSingle();
    if (error) return { items: [], error: error.message };
    return { items: normalizeCleanup((data as { value_json?: unknown } | null)?.value_json ?? null), error: null };
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateCcrsCleanup(
  op: "add" | "remove",
  item: { key: string; label: string },
  byId: string | null,
): Promise<{ ok: boolean; error?: string; items?: CleanupProduct[] }> {
  const cur = await readCcrsCleanup();
  if (cur.error) return { ok: false, error: cur.error };
  const next =
    op === "add"
      ? addCleanup(cur.items, { key: item.key, label: item.label || item.key, at: new Date().toISOString() })
      : removeCleanup(cur.items, item.key);
  const { error } = await createSupabaseAdminClient()
    .from("site_settings")
    .upsert(
      {
        key: CCRS_CLEANUP_SETTING_KEY,
        label: "CCRS clean-up list: products never reported to CCRS (R74 S42)",
        value_json: { items: next } as unknown as Record<string, unknown>,
        updated_by: byId,
      },
      { onConflict: "key" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true, items: next };
}
