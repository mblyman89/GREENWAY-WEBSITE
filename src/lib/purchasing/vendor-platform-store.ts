/**
 * src/lib/purchasing/vendor-platform-store.ts
 *
 * GF-4 — Supabase persistence for the unified smart-search MEMORY
 * (public.vendor_platform_map, migration 0125). The memory remembers which
 * marketplace ('cultivera' | 'growflow') a vendor's menu was last found on so
 * the unified search hits the known platform FIRST.
 *
 * Pure decision logic lives in unified-search-core.ts; this file only reads
 * and writes rows. Best-effort like the other stores: returns []/false when
 * the Supabase service role isn't configured — never a crash.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { escapeLikeWildcards } from "@/lib/supabase/postgrest-escape";
import {
  normalizeVendorKey,
  type PlatformMemoryUpsert,
} from "@/lib/purchasing/unified-search-core";

/** A vendor_platform_map row as stored (mirrors migration 0125). */
export type VendorPlatformRow = {
  id: string;
  vendor_key: string;
  vendor_name: string | null;
  license_number: string | null;
  platform: string;
  platform_ref: string | null;
  platform_slug: string | null;
  vendor_id: string | null;
  last_seen_at: string;
  hit_count: number;
  created_at: string;
  updated_at: string;
};

/**
 * Load the remembered platform rows for one vendor name (exact key match).
 * Newest-seen first. [] when nothing is remembered or Supabase is off.
 */
export async function getMemoriesForVendor(vendorName: string): Promise<VendorPlatformRow[]> {
  const key = normalizeVendorKey(vendorName);
  if (!key || !isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("vendor_platform_map")
    .select("*")
    .eq("vendor_key", key)
    .order("last_seen_at", { ascending: false });
  if (error || !data) return [];
  return data as VendorPlatformRow[];
}

/**
 * Load memory rows whose vendor_key CONTAINS the (normalized) query — the
 * search box passes partial names. Capped for sanity. [] when Supabase is off
 * or the query is blank (a blank search shouldn't bias platform order).
 */
export async function findMemories(query: string, limit = 10): Promise<VendorPlatformRow[]> {
  const key = normalizeVendorKey(query);
  if (!key || !isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("vendor_platform_map")
    .select("*")
    .ilike("vendor_key", `%${escapeLikeWildcards(key)}%`)
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as VendorPlatformRow[];
}

/**
 * Remember (upsert) that a vendor's menu was found on a platform. Unique on
 * (vendor_key, platform): an existing row gets its recency bumped and
 * hit_count incremented; otherwise a fresh row is inserted with hit_count 1.
 * Returns false (without throwing) when Supabase is off or the write fails.
 */
export async function rememberPlatform(upsert: PlatformMemoryUpsert): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  const admin = createSupabaseAdminClient();

  // Read the existing (vendor_key, platform) row so we can bump hit_count —
  // Supabase upsert can't do `hit_count = hit_count + 1` server-side.
  const { data: existing } = await admin
    .from("vendor_platform_map")
    .select("id, hit_count")
    .eq("vendor_key", upsert.vendor_key)
    .eq("platform", upsert.platform)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await admin
      .from("vendor_platform_map")
      .update({
        vendor_name: upsert.vendor_name,
        license_number: upsert.license_number,
        platform_ref: upsert.platform_ref,
        platform_slug: upsert.platform_slug,
        last_seen_at: upsert.last_seen_at,
        hit_count: ((existing.hit_count as number) ?? 0) + 1,
      })
      .eq("id", existing.id);
    return !error;
  }

  const { error } = await admin.from("vendor_platform_map").insert({
    vendor_key: upsert.vendor_key,
    vendor_name: upsert.vendor_name,
    license_number: upsert.license_number,
    platform: upsert.platform,
    platform_ref: upsert.platform_ref,
    platform_slug: upsert.platform_slug,
    last_seen_at: upsert.last_seen_at,
    hit_count: 1,
  });
  return !error;
}

