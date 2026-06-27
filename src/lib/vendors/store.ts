/**
 * src/lib/vendors/store.ts
 *
 * Server-side read/write helpers for vendors + brands. Admin (staff) reads use
 * the service-role client; public reads rely on RLS (published-only).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured, supabaseUrl } from "@/lib/supabase/env";
import type { Brand, Vendor, VendorWithBrands } from "@/lib/vendors/types";

/** Build a public URL for a media asset stored in the `media` bucket. */
export function publicMediaUrl(storageKey: string | null | undefined): string | null {
  if (!storageKey || !supabaseUrl) return null;
  return `${supabaseUrl}/storage/v1/object/public/media/${storageKey}`;
}

export async function listVendors(opts?: { status?: string }): Promise<Vendor[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("vendors")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("display_name", { ascending: true });
  if (opts?.status) q = q.eq("status", opts.status);
  const { data } = await q;
  return (data as Vendor[] | null) ?? [];
}

export async function countVendors(): Promise<{ total: number; published: number }> {
  if (!isSupabaseServiceConfigured) return { total: 0, published: 0 };
  const admin = createSupabaseAdminClient();
  const [{ count: total }, { count: published }] = await Promise.all([
    admin.from("vendors").select("id", { count: "exact", head: true }),
    admin.from("vendors").select("id", { count: "exact", head: true }).eq("status", "published"),
  ]);
  return { total: total ?? 0, published: published ?? 0 };
}

export async function getVendorBySlug(slug: string): Promise<VendorWithBrands | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data: vendor } = await admin.from("vendors").select("*").eq("slug", slug).maybeSingle();
  if (!vendor) return null;
  const v = vendor as Vendor;

  const [{ data: brands }, { data: aliases }, logoKey] = await Promise.all([
    admin.from("brands").select("*").eq("vendor_id", v.id).order("display_name"),
    admin.from("vendor_aliases").select("source_name").eq("vendor_id", v.id),
    resolveMediaKey(v.logo_media_id),
  ]);

  return {
    ...v,
    brands: (brands as Brand[] | null) ?? [],
    logo_url: publicMediaUrl(logoKey),
    aliases: ((aliases as { source_name: string }[] | null) ?? []).map((a) => a.source_name),
  };
}

export async function getVendorById(id: string): Promise<Vendor | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("vendors").select("*").eq("id", id).maybeSingle();
  return (data as Vendor | null) ?? null;
}

export async function listBrandsForVendor(vendorId: string): Promise<Brand[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("brands").select("*").eq("vendor_id", vendorId).order("display_name");
  return (data as Brand[] | null) ?? [];
}

export async function getBrandById(id: string): Promise<Brand | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("brands").select("*").eq("id", id).maybeSingle();
  return (data as Brand | null) ?? null;
}

async function resolveMediaKey(mediaId: string | null): Promise<string | null> {
  if (!mediaId || !isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("media_assets").select("storage_key").eq("id", mediaId).maybeSingle();
  return (data as { storage_key: string } | null)?.storage_key ?? null;
}

/** Map of vendor.id -> public logo URL, for list rendering without N+1 queries. */
export async function vendorLogoUrls(vendors: Vendor[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!isSupabaseServiceConfigured) return map;
  const mediaIds = vendors.map((v) => v.logo_media_id).filter((x): x is string => Boolean(x));
  if (mediaIds.length === 0) return map;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("media_assets").select("id, storage_key").in("id", mediaIds);
  const keyById = new Map<string, string>();
  for (const r of (data as { id: string; storage_key: string }[] | null) ?? []) {
    keyById.set(r.id, r.storage_key);
  }
  for (const v of vendors) {
    if (!v.logo_media_id) continue;
    const key = keyById.get(v.logo_media_id);
    const url = publicMediaUrl(key);
    if (url) map.set(v.id, url);
  }
  return map;
}
