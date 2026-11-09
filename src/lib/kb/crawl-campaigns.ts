/**
 * src/lib/kb/crawl-campaigns.ts — D220 S6 (DB reads/writes for the Crawl
 * Campaigns board, Website Finder review, and Image Catalog).
 *
 * Reads the durable tables the crawler writes (migration 0351). Every reader
 * degrades to empty + `ready:false` before 0351 is applied, so the pages
 * render a clear "apply migration 0351" note instead of crashing.
 * Paged with .range() — never a single .limit(>=1000).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listVendors } from "@/lib/vendors/store";
import {
  buildCurrentVendorTargets,
  type CatalogImage,
  type CurrentVendorPlan,
  type SiteRow,
  type WebsiteCandidate,
} from "./crawl-campaigns-core";

const PAGE = 1000;

function missingTable(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message ?? "");
}

/** Vendor ids with stock on hand (inventory_lots.on_hand_qty > 0). */
export async function stockedVendorIds(cap = 50_000): Promise<Set<string>> {
  const out = new Set<string>();
  if (!isSupabaseServiceConfigured) return out;
  const admin = createSupabaseAdminClient();
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("vendor_id")
      .gt("on_hand_qty", 0)
      .not("vendor_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const r of data as { vendor_id: string | null }[]) if (r.vendor_id) out.add(r.vendor_id);
    if (data.length < PAGE) break;
  }
  return out;
}

/** The "Harvest all current vendors" plan, computed server-side (never trusted from the form). */
export async function planCurrentVendorHarvest(): Promise<CurrentVendorPlan> {
  const [vendors, stocked] = await Promise.all([listVendors(), stockedVendorIds()]);
  return buildCurrentVendorTargets(vendors, stocked);
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------
export type CampaignRow = {
  id: string;
  label: string;
  scope: string;
  status: string;
  cancel_requested: boolean;
  options: Record<string, unknown>;
  totals: Record<string, number>;
  ai_usage: Record<string, unknown>;
  last_error: string | null;
  worker_heartbeat_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type CampaignSiteRow = SiteRow & {
  campaign_id: string;
  vendor_id: string | null;
  display_name: string;
  entry_url: string;
  host: string;
  platform: string | null;
  drafts_written: number;
  products_written: number;
  current_url: string | null;
  updated_at: string;
};

const SITE_COLS =
  "id,campaign_id,vendor_id,display_name,entry_url,host,status,platform,pages_read,pages_failed,pages_pending," +
  "images_found,images_tagged,images_matched,products_found,drafts_written,products_written,slices,attempts," +
  "coverage_assessment,stopped_reason,last_error,current_url,updated_at";

export async function listCampaigns(limit = 25): Promise<{ ready: boolean; campaigns: CampaignRow[] }> {
  if (!isSupabaseServiceConfigured) return { ready: false, campaigns: [] };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("kb_crawl_campaigns")
    .select("*")
    .order("created_at", { ascending: false })
    .range(0, Math.min(limit, 200) - 1);
  if (error) return { ready: !missingTable(error), campaigns: [] };
  return { ready: true, campaigns: (data ?? []) as CampaignRow[] };
}

export async function listCampaignSites(campaignIds: string[]): Promise<CampaignSiteRow[]> {
  if (!isSupabaseServiceConfigured || campaignIds.length === 0) return [];
  const admin = createSupabaseAdminClient();
  const out: CampaignSiteRow[] = [];
  for (let from = 0; from < 5000; from += PAGE) {
    const { data, error } = await admin
      .from("kb_crawl_sites")
      .select(SITE_COLS)
      .in("campaign_id", campaignIds)
      .order("display_name", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    out.push(...(data as unknown as CampaignSiteRow[]));
    if (data.length < PAGE) break;
  }
  return out;
}

export async function getCampaignSite(siteId: string): Promise<CampaignSiteRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("kb_crawl_sites").select(SITE_COLS).eq("id", siteId).maybeSingle();
  return (data as unknown as CampaignSiteRow | null) ?? null;
}

export type CrawlPageRow = {
  id: string;
  url: string;
  page_type: string;
  title: string | null;
  word_count: number;
  product_names: string[];
  image_count: number;
  source: string;
  fetched_at: string;
};

/** Page-type breakdown + the newest pages for one site. */
export async function sitePages(siteId: string, limit = 200): Promise<{ byType: Record<string, number>; pages: CrawlPageRow[] }> {
  const byType: Record<string, number> = {};
  const pages: CrawlPageRow[] = [];
  if (!isSupabaseServiceConfigured) return { byType, pages };
  const admin = createSupabaseAdminClient();
  for (let from = 0; from < 10_000; from += PAGE) {
    const { data, error } = await admin
      .from("kb_crawl_pages")
      .select("id,url,page_type,title,word_count,product_names,image_count,source,fetched_at")
      .eq("site_id", siteId)
      .order("url", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const p of data as CrawlPageRow[]) {
      byType[p.page_type] = (byType[p.page_type] ?? 0) + 1;
      if (pages.length < limit) pages.push(p);
    }
    if (data.length < PAGE) break;
  }
  return { byType, pages };
}

// ---------------------------------------------------------------------------
// Website candidates
// ---------------------------------------------------------------------------
export type WebsiteCandidateRow = WebsiteCandidate & {
  source: string;
  evidence: Record<string, unknown>;
  created_at: string;
  reviewed_at: string | null;
};

export async function listWebsiteCandidates(
  statuses: string[] = ["pending"],
): Promise<{ ready: boolean; rows: WebsiteCandidateRow[] }> {
  if (!isSupabaseServiceConfigured) return { ready: false, rows: [] };
  const admin = createSupabaseAdminClient();
  const rows: WebsiteCandidateRow[] = [];
  for (let from = 0; from < 10_000; from += PAGE) {
    const { data, error } = await admin
      .from("vendor_website_candidates")
      .select("id,vendor_id,url,host,source,confidence,verify_status,evidence,status,created_at,reviewed_at")
      .in("status", statuses)
      .order("confidence", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) return { ready: !missingTable(error), rows };
    if (!data) break;
    rows.push(...(data as WebsiteCandidateRow[]).map((r) => ({ ...r, confidence: Number(r.confidence) || 0 })));
    if (data.length < PAGE) break;
  }
  return { ready: true, rows };
}

export async function candidatesForVendor(vendorId: string): Promise<WebsiteCandidateRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("vendor_website_candidates")
    .select("id,vendor_id,url,host,source,confidence,verify_status,evidence,status,created_at,reviewed_at")
    .eq("vendor_id", vendorId)
    .range(0, 99);
  if (error) throw new Error(error.message);
  return ((data ?? []) as WebsiteCandidateRow[]).map((r) => ({ ...r, confidence: Number(r.confidence) || 0 }));
}

export async function updateWebsiteCandidates(ids: string[], patch: Record<string, unknown>): Promise<void> {
  if (ids.length === 0) return;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("vendor_website_candidates").update(patch).in("id", ids);
  if (error) throw new Error(error.message);
}

export async function setVendorWebsite(vendorId: string, website: string): Promise<{ before: string | null }> {
  const admin = createSupabaseAdminClient();
  const { data: cur, error: readErr } = await admin.from("vendors").select("id,website").eq("id", vendorId).maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!cur) throw new Error("Vendor not found.");
  const { error } = await admin.from("vendors").update({ website }).eq("id", vendorId);
  if (error) throw new Error(error.message);
  return { before: (cur as { website: string | null }).website };
}

// ---------------------------------------------------------------------------
// Image catalog
// ---------------------------------------------------------------------------
export type CatalogImageRow = CatalogImage & {
  site_id: string;
  campaign_id: string;
  vendor_id: string | null;
  page_url: string;
  image_url: string;
  alt: string | null;
  caption: string | null;
  heading: string | null;
  jsonld_name: string | null;
  source: string;
  role_confidence: number | null;
  product_name: string | null;
  brand_name: string | null;
  strain_name: string | null;
  category: string | null;
  variant_label: string | null;
  packaging_text: string | null;
  tags: string[];
  colors: string[];
  vision_model: string | null;
  vision_at: string | null;
  match_score: number | null;
  match_reason: string | null;
  media_asset_id: string | null;
  reviewed_at: string | null;
  seen_count: number;
};

const IMAGE_COLS =
  "id,site_id,campaign_id,vendor_id,page_url,image_url,alt,caption,heading,jsonld_name,source,role,role_confidence," +
  "product_name,brand_name,strain_name,category,variant_label,packaging_text,tags,colors,vision_model,vision_at," +
  "matched_kb_product_id,match_score,match_reason,match_candidates,match_status,media_asset_id,reviewed_at,seen_count";

export const IMAGES_PER_PAGE = 48;

/** PostgREST .or() value escaping for a free-text ilike. */
function ilikeSafe(q: string): string {
  return q.replace(/[%_\\,()*."]/g, " ").replace(/\s+/g, " ").trim();
}

export async function listCatalogImages(f: {
  role: string | null;
  match: string | null;
  vendorId: string | null;
  siteId: string | null;
  q: string;
  page: number;
}): Promise<{ ready: boolean; rows: CatalogImageRow[]; total: number }> {
  if (!isSupabaseServiceConfigured) return { ready: false, rows: [], total: 0 };
  const admin = createSupabaseAdminClient();
  let q = admin.from("kb_crawl_images").select(IMAGE_COLS, { count: "exact" });
  if (f.role) q = q.eq("role", f.role);
  if (f.match) q = q.eq("match_status", f.match);
  if (f.vendorId) q = q.eq("vendor_id", f.vendorId);
  if (f.siteId) q = q.eq("site_id", f.siteId);
  const text = ilikeSafe(f.q);
  if (text) {
    const like = `%${text}%`;
    q = q.or(
      `product_name.ilike.${like},strain_name.ilike.${like},alt.ilike.${like},packaging_text.ilike.${like},jsonld_name.ilike.${like}`,
    );
  }
  const from = (f.page - 1) * IMAGES_PER_PAGE;
  const { data, error, count } = await q
    .order("match_status", { ascending: false })
    .order("match_score", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .range(from, from + IMAGES_PER_PAGE - 1);
  if (error) return { ready: !missingTable(error), rows: [], total: 0 };
  return {
    ready: true,
    rows: ((data ?? []) as unknown as CatalogImageRow[]).map((r) => ({
      ...r,
      match_candidates: Array.isArray(r.match_candidates) ? r.match_candidates : [],
      match_score: r.match_score === null ? null : Number(r.match_score),
      role_confidence: r.role_confidence === null ? null : Number(r.role_confidence),
    })),
    total: count ?? 0,
  };
}

export async function getCatalogImage(id: string): Promise<CatalogImageRow | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("kb_crawl_images").select(IMAGE_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as unknown as CatalogImageRow;
  return { ...r, match_candidates: Array.isArray(r.match_candidates) ? r.match_candidates : [] };
}

export async function updateCatalogImage(id: string, patch: Record<string, unknown>): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("kb_crawl_images").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Image counts by match_status + role (for the catalog header). Bounded page walk. */
export async function catalogCounts(): Promise<{ byMatch: Record<string, number>; byRole: Record<string, number>; total: number }> {
  const byMatch: Record<string, number> = {};
  const byRole: Record<string, number> = {};
  let total = 0;
  if (!isSupabaseServiceConfigured) return { byMatch, byRole, total };
  const admin = createSupabaseAdminClient();
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await admin
      .from("kb_crawl_images")
      .select("role,match_status")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const r of data as { role: string; match_status: string }[]) {
      byMatch[r.match_status] = (byMatch[r.match_status] ?? 0) + 1;
      byRole[r.role] = (byRole[r.role] ?? 0) + 1;
      total += 1;
    }
    if (data.length < PAGE) break;
  }
  return { byMatch, byRole, total };
}

/** id → display name for the product cards referenced on a catalog page. */
export async function productNames(ids: string[]): Promise<Map<string, { name: string; variant: string | null; hasImage: boolean }>> {
  const out = new Map<string, { name: string; variant: string | null; hasImage: boolean }>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!isSupabaseServiceConfigured || uniq.length === 0) return out;
  const admin = createSupabaseAdminClient();
  for (let i = 0; i < uniq.length; i += 200) {
    const { data } = await admin
      .from("kb_products")
      .select("id,display_name,variant_label,primary_media_id")
      .in("id", uniq.slice(i, i + 200));
    for (const r of (data ?? []) as { id: string; display_name: string; variant_label: string | null; primary_media_id: string | null }[]) {
      out.set(r.id, { name: r.display_name, variant: r.variant_label, hasImage: !!r.primary_media_id });
    }
  }
  return out;
}

/** A vendor's product cards, for the manual "pick a different product" dropdown. */
export async function vendorProductOptions(vendorId: string): Promise<{ id: string; label: string }[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const out: { id: string; label: string }[] = [];
  for (let from = 0; from < 5000; from += PAGE) {
    const { data, error } = await admin
      .from("kb_products")
      .select("id,display_name,variant_label")
      .eq("vendor_id", vendorId)
      .order("display_name", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const r of data as { id: string; display_name: string; variant_label: string | null }[]) {
      out.push({ id: r.id, label: r.variant_label ? `${r.display_name} · ${r.variant_label}` : r.display_name });
    }
    if (data.length < PAGE) break;
  }
  return out;
}
