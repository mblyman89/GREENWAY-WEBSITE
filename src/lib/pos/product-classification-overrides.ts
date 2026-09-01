/**
 * src/lib/pos/product-classification-overrides.ts
 *
 * Server-side read/write for `product_classification_overrides` (migration
 * 0150): the per-product website Type/Category override set from the Inventory
 * Detail corrections section. Keyed by pos_product_key
 * (= menu_items.source_item_id).
 *
 * GRACEFUL FALLBACK is the whole point: on a database where 0150 hasn't run yet
 * (or Supabase isn't configured), reads return "no override" and the system
 * behaves EXACTLY as before. A write on a pre-0150 DB returns a friendly
 * pointer at the migration — it never throws into the pipeline.
 *
 * NEVER touches CCRS/LCB columns. Read-time overlay only.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
// SLICE 3: PostgREST truncates at db.max_rows (1,000) without an error.
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export type ProductClassificationOverride = {
  pos_product_key: string;
  website_category: string | null;
  house_type: string | null;
  note: string | null;
};

/** Postgres "relation does not exist" — the table hasn't been migrated yet. */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "42P01" ||
    /relation .* does not exist|could not find the table|schema cache/i.test(err.message ?? "")
  );
}

/**
 * Fetch overrides for many product keys in one batched pass. Returns a Map keyed
 * by pos_product_key. Empty map when unconfigured / pre-migration / on any error
 * (so callers degrade to auto-resolution silently).
 */
export async function getOverridesForKeys(
  keys: Array<string | null | undefined>,
): Promise<Map<string, ProductClassificationOverride>> {
  const out = new Map<string, ProductClassificationOverride>();
  const unique = Array.from(
    new Set(keys.filter((k): k is string => typeof k === "string" && k.trim().length > 0)),
  );
  if (!isSupabaseServiceConfigured || unique.length === 0) return out;

  try {
    const admin = createSupabaseAdminClient();
    // SLICE 3: chunked AND paged. A 300-key chunk can match more rows than
    // PostgREST's 1,000-row ceiling, which is enforced silently, so an
    // override late in the list was dropped and the product rendered under its
    // raw POS category instead of the one the owner chose.
    const CHUNK = 300;
    let readFailed = false;
    const rows = await chunkedIn<string, ProductClassificationOverride>(
      unique,
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("product_classification_overrides")
          .select("pos_product_key, website_category, house_type, note")
          .in("pos_product_key", chunk)
          .order("pos_product_key", { ascending: true })
          .range(from, to);
        if (error) {
          // Pre-migration or any read hiccup: behave as "no overrides".
          if (!isMissingTable(error)) {
            console.error("[product-classification-overrides] read error:", error.message);
          }
          readFailed = true;
          return [];
        }
        return (data as ProductClassificationOverride[] | null) ?? [];
      },
      { chunkSize: CHUNK },
    );
    if (readFailed) return out;
    for (const row of rows) {
      if (row.pos_product_key) out.set(row.pos_product_key, row);
    }
  } catch (err) {
    console.error("[product-classification-overrides] getOverridesForKeys failed:", err);
  }
  return out;
}

/** Fetch a single product's override (null when none / pre-migration). */
export async function getOverrideForKey(
  key: string | null | undefined,
): Promise<ProductClassificationOverride | null> {
  if (!key || !key.trim()) return null;
  const map = await getOverridesForKeys([key]);
  return map.get(key) ?? null;
}

export type UpsertOverrideResult = { ok: true } | { ok: false; error: string };

/**
 * Set (or partially clear) a product's override. `website_category` /
 * `house_type` are the NEW effective values; pass null to clear that field.
 * When BOTH end up null the row is deleted (no dead rows left behind).
 */
export async function upsertOverride(
  key: string,
  patch: { website_category: string | null; house_type: string | null; note?: string | null },
  actorId: string | null,
): Promise<UpsertOverrideResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "The database isn't configured, so the override can't be saved." };
  }
  const cleanKey = key.trim();
  if (!cleanKey) {
    return { ok: false, error: "This product has no POS product key, so it can't be re-filed yet." };
  }
  const admin = createSupabaseAdminClient();

  // Both cleared → delete the row entirely (fall back to full auto-resolution).
  if (patch.website_category == null && patch.house_type == null) {
    const { error } = await admin
      .from("product_classification_overrides")
      .delete()
      .eq("pos_product_key", cleanKey);
    if (error) {
      if (isMissingTable(error)) return missingTableResult();
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  const { error } = await admin.from("product_classification_overrides").upsert(
    {
      pos_product_key: cleanKey,
      website_category: patch.website_category,
      house_type: patch.house_type,
      note: patch.note ?? null,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "pos_product_key" },
  );
  if (error) {
    if (isMissingTable(error)) return missingTableResult();
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

function missingTableResult(): UpsertOverrideResult {
  return {
    ok: false,
    error:
      "Saving a Type/Category override needs database migration 0150 " +
      "(supabase/migrations/0150_product_classification_overrides.sql). Run it, then try again.",
  };
}
