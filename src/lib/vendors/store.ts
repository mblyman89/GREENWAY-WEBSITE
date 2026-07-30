/**
 * src/lib/vendors/store.ts
 *
 * Server-side read/write helpers for vendors + brands. Admin (staff) reads use
 * the service-role client; public reads rely on RLS (published-only).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured, supabaseUrl } from "@/lib/supabase/env";
import { ilikeContains } from "@/lib/supabase/postgrest-escape";
import type { Brand, Vendor, VendorWithBrands } from "@/lib/vendors/types";

/** Build a public URL for a media asset stored in the `media` bucket. */
export function publicMediaUrl(storageKey: string | null | undefined): string | null {
  if (!storageKey || !supabaseUrl) return null;
  return `${supabaseUrl}/storage/v1/object/public/media/${storageKey}`;
}

export type ListVendorsOpts = {
  status?: string;
  /** true = only is_active vendors; false = only inactive. */
  active?: boolean;
  /** true = license_number present; false = missing. */
  hasLicense?: boolean;
  /** Case-insensitive match on display_name, dba, or license_number. */
  q?: string;
};

/**
 * List vendors — ALL of them.
 *
 * PostgREST caps a single `select()` at 1000 rows, so a plain query silently
 * returned only the first 1000 (the root cause of "the system thinks we only
 * have 1000 vendors"). We page through with `.range()` in 1000-row windows
 * until a short page, mirroring listKbStrainsFull() in src/lib/ai/kb/store.ts.
 */
export async function listVendors(opts?: ListVendorsOpts): Promise<Vendor[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const PAGE = 1000;
  const LIMIT = 5000; // sane ceiling to bound memory
  const rows: Vendor[] = [];
  for (let from = 0; from < LIMIT; from += PAGE) {
    let q = admin
      .from("vendors")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("display_name", { ascending: true })
      .range(from, Math.min(from + PAGE, LIMIT) - 1);
    if (opts?.status) q = q.eq("status", opts.status);
    if (opts?.active !== undefined) q = q.eq("is_active", opts.active);
    if (opts?.hasLicense === true) q = q.not("license_number", "is", null);
    if (opts?.hasLicense === false) q = q.is("license_number", null);
    if (opts?.q) {
      // GW-021: shared escaping (wildcards + .or() grammar) instead of a local one-off.
      const like = ilikeContains(opts.q);
      if (like) q = q.or(`display_name.ilike.${like},dba.ilike.${like},license_number.ilike.${like}`);
    }
    const { data, error } = await q;
    if (error || !data) break;
    rows.push(...(data as Vendor[]));
    if (data.length < PAGE) break; // short page => done
  }
  return rows;
}

/**
 * Inventory-derived vendor facts, for the "My vendors" scope + product-type /
 * category filters. Reads inventory_lots (paged past the 1000-row cap) and
 * aggregates per-vendor sets. With zero inventory this returns empty sets and
 * the page degrades gracefully.
 */
export type VendorInventoryFacts = {
  /** Vendor ids that have at least one inventory lot ("my vendors"). */
  vendorIds: Set<string>;
  /** Distinct inventory_type values seen in inventory (sorted). */
  inventoryTypes: string[];
  /** Distinct category values seen in inventory (sorted). */
  categories: string[];
  /** vendor id -> set of inventory_type values it supplies. */
  typesByVendor: Map<string, Set<string>>;
  /** vendor id -> set of category values it supplies. */
  categoriesByVendor: Map<string, Set<string>>;
};

export async function vendorInventoryFacts(): Promise<VendorInventoryFacts> {
  const empty: VendorInventoryFacts = {
    vendorIds: new Set(),
    inventoryTypes: [],
    categories: [],
    typesByVendor: new Map(),
    categoriesByVendor: new Map(),
  };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();
  const PAGE = 1000;
  const LIMIT = 20000;
  type LotRow = { vendor_id: string | null; inventory_type: string | null; category: string | null };
  const facts = empty;
  const typeSet = new Set<string>();
  const catSet = new Set<string>();
  for (let from = 0; from < LIMIT; from += PAGE) {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("vendor_id, inventory_type, category")
      .not("vendor_id", "is", null)
      .range(from, Math.min(from + PAGE, LIMIT) - 1);
    if (error || !data) break;
    for (const r of data as LotRow[]) {
      if (!r.vendor_id) continue;
      facts.vendorIds.add(r.vendor_id);
      const t = r.inventory_type?.trim();
      if (t) {
        typeSet.add(t);
        if (!facts.typesByVendor.has(r.vendor_id)) facts.typesByVendor.set(r.vendor_id, new Set());
        facts.typesByVendor.get(r.vendor_id)!.add(t);
      }
      const c = r.category?.trim();
      if (c) {
        catSet.add(c);
        if (!facts.categoriesByVendor.has(r.vendor_id)) facts.categoriesByVendor.set(r.vendor_id, new Set());
        facts.categoriesByVendor.get(r.vendor_id)!.add(c);
      }
    }
    if (data.length < PAGE) break;
  }
  facts.inventoryTypes = [...typeSet].sort((a, b) => a.localeCompare(b));
  facts.categories = [...catSet].sort((a, b) => a.localeCompare(b));
  return facts;
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

/** All brands (id, name, vendor_id), for link dropdowns in the product editor. */
export async function listAllBrands(): Promise<Pick<Brand, "id" | "display_name" | "vendor_id">[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("brands").select("id, display_name, vendor_id").order("display_name");
  return (data as Pick<Brand, "id" | "display_name" | "vendor_id">[] | null) ?? [];
}

/** Update the folded-in brand FACTS on an operational brand (by id). */
export async function updateBrandFacts(
  id: string,
  facts: {
    known_for: string | null;
    house_style: string | null;
    signature_lines: string[];
    sensory_notes: string[];
  },
  actorId: string | null,
): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("brands")
    .update({
      known_for: facts.known_for,
      house_style: facts.house_style,
      signature_lines: facts.signature_lines,
      sensory_notes: facts.sensory_notes,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  return !error;
}

/** Count of operational brands (the real vendor-attached brands). */
export async function countBrands(): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  const admin = createSupabaseAdminClient();
  const { count } = await admin.from("brands").select("id", { count: "exact", head: true });
  return count ?? 0;
}

/** Full brand rows (all columns, incl. folded-in facts) — for the brand editor. */
export async function listBrandsWithFacts(limit = 1000): Promise<Brand[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("brands")
    .select("*")
    .order("display_name", { ascending: true })
    .limit(limit);
  return (data as Brand[] | null) ?? [];
}

async function resolveMediaKey(mediaId: string | null): Promise<string | null> {
  if (!mediaId || !isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("media_assets").select("storage_key").eq("id", mediaId).maybeSingle();
  return (data as { storage_key: string } | null)?.storage_key ?? null;
}

/**
 * SLICE 97 — back-office profiles for the PUBLIC vendors page.
 *
 * The public directory is derived from the live menu (SLICE 48), so this
 * feeds enrichVendorDirectory (vendor-directory-core.ts) with what the back
 * office knows: display/dba/legal names + aliases for matching, the uploaded
 * logo URL, and about/mission copy. ALL vendors are considered (drafts too):
 * the vendor is already publicly listed via the menu — this only decorates
 * that existing listing with the logo/copy staff explicitly saved (logo
 * uploads are stored status='published' because "logos are meant to be
 * displayed"). Batched reads (3 queries), never N+1.
 */
export type PublicVendorProfile = {
  display_name: string;
  dba: string | null;
  legal_name: string | null;
  aliases: string[];
  logoUrl: string | null;
  about: string | null;
  mission_statement: string | null;
  /** SLICE 114: third description fallback for the public vendor card. */
  product_philosophy: string | null;
};

export async function listPublicVendorProfiles(): Promise<PublicVendorProfile[]> {
  if (!isSupabaseServiceConfigured) return [];
  const vendors = await listVendors();
  if (vendors.length === 0) return [];
  const admin = createSupabaseAdminClient();
  const [logoMap, aliasRows] = await Promise.all([
    vendorLogoUrls(vendors),
    (async () => {
      // Page past the 1000-row cap like listVendors.
      const PAGE = 1000;
      const LIMIT = 10000;
      const rows: { vendor_id: string; source_name: string }[] = [];
      for (let from = 0; from < LIMIT; from += PAGE) {
        const { data, error } = await admin
          .from("vendor_aliases")
          .select("vendor_id, source_name")
          .range(from, Math.min(from + PAGE, LIMIT) - 1);
        if (error || !data) break;
        rows.push(...(data as { vendor_id: string; source_name: string }[]));
        if (data.length < PAGE) break;
      }
      return rows;
    })(),
  ]);
  const aliasesByVendor = new Map<string, string[]>();
  for (const row of aliasRows) {
    if (!aliasesByVendor.has(row.vendor_id)) aliasesByVendor.set(row.vendor_id, []);
    aliasesByVendor.get(row.vendor_id)!.push(row.source_name);
  }
  return vendors.map((v) => ({
    display_name: v.display_name,
    dba: v.dba,
    legal_name: v.legal_name,
    aliases: aliasesByVendor.get(v.id) ?? [],
    logoUrl: logoMap.get(v.id) ?? null,
    about: v.about,
    mission_statement: v.mission_statement,
    product_philosophy: v.product_philosophy ?? null,
  }));
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
