/**
 * src/lib/enrichment/ai-draft-v2-server.ts  (D244 E-4 - AI drafting v2)
 *
 * Gathers everything the "all fields" draft needs ON THE SERVER (never from
 * the form): POS facts from the published menu row, the vendor (F-08 - the
 * old drafts never saw it), the attached photos' vision text, and the
 * fields already on record (for the diff + the prompt). Then runs one
 * generateProductAllFields call. Shared by the detail-page button (E-4) and
 * the bulk background job (E-5). Never throws on the reads; says so instead.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getEnrichment } from "@/lib/enrichment/store";
import type { ProductEnrichment } from "@/lib/enrichment/types";
import { generateProductAllFields, type AllFieldsCurrent, type AllFieldsOutcome } from "@/lib/ai/all-fields-draft";
import type { ProductFacts } from "@/lib/ai/suggestions";
import { MAX_PHOTOS, sensoryText, type PhotoFacts } from "@/lib/enrichment/ai-draft-v2-core";

export type DraftItem = {
  name: string;
  product_name?: string | null;
  brand_name: string | null;
  vendor_name: string | null;
  category: string | null;
  strain_type: string | null;
  strain_name: string | null;
  thc: string | null;
  cbd: string | null;
};

/** The vendor's display name for the enrichment's own vendor card, else the POS vendor text. */
async function vendorName(enrichment: ProductEnrichment | null, item: DraftItem): Promise<string | null> {
  const posVendor = (item.vendor_name ?? "").trim() || null;
  const id = (enrichment?.vendor_id ?? "").trim();
  if (!id || !isSupabaseServiceConfigured) return posVendor;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("vendors").select("display_name, dba").eq("id", id).maybeSingle();
    const row = data as { display_name: string | null; dba: string | null } | null;
    return (row?.dba || row?.display_name || "").trim() || posVendor;
  } catch {
    return posVendor;
  }
}

/** Vision text of the attached photos (cover first). [] before 0352 or on failure. */
export async function readAttachedPhotoFacts(enrichment: ProductEnrichment | null): Promise<PhotoFacts[]> {
  if (!enrichment || !isSupabaseServiceConfigured) return [];
  const ids = [enrichment.primary_media_id, ...(enrichment.image_media_ids ?? [])].filter(
    (x, i, a): x is string => typeof x === "string" && x.length > 0 && a.indexOf(x) === i,
  );
  if (ids.length === 0) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("media_assets")
      .select("id, ai_description, ai_caption, visible_text, product_name, pack_size")
      .in("id", ids.slice(0, MAX_PHOTOS * 2));
    if (error || !Array.isArray(data)) return [];
    const byId = new Map((data as (PhotoFacts & { id: string })[]).map((r) => [r.id, r] as const));
    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  } catch {
    return [];
  }
}

export function currentFields(e: ProductEnrichment | null, sensory?: string | null, effects?: string | null): AllFieldsCurrent {
  if (!e) return { sensory: sensory ?? null, effects: effects ?? null };
  return {
    display_name: e.display_name,
    description: e.description,
    short_description: e.short_description,
    seo: e.seo_title || e.seo_description ? `${e.seo_title ?? ""} — ${e.seo_description ?? ""}` : null,
    tags: e.tags?.length ? e.tags.join(", ") : null,
    sensory: sensory ?? null,
    effects: effects ?? null,
  };
}

/** Latest ACCEPTED sensory/effects suggestion text, for "on record" (they have no column). */
async function acceptedFacts(key: string): Promise<{ sensory: string | null; effects: string | null }> {
  if (!isSupabaseServiceConfigured) return { sensory: null, effects: null };
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("ai_suggestions")
      .select("field_key, suggested_value, created_at")
      .eq("entity_type", "product")
      .eq("entity_id", key)
      .eq("status", "accepted")
      .in("field_key", ["sensory", "effects"])
      .order("created_at", { ascending: false })
      .limit(10);
    const rows = (data as { field_key: string; suggested_value: string | null }[] | null) ?? [];
    const s = rows.find((r) => r.field_key === "sensory")?.suggested_value ?? null;
    const e = rows.find((r) => r.field_key === "effects")?.suggested_value ?? null;
    return { sensory: s ? sensoryText(s) || null : null, effects: e };
  } catch {
    return { sensory: null, effects: null };
  }
}

/** Run the all-fields draft for one product. Throws only on the AI call. */
export async function draftAllFieldsForProduct(
  key: string,
  item: DraftItem,
  actorId: string | null,
): Promise<AllFieldsOutcome & { photos: number; vendor: string | null }> {
  const enrichment = await getEnrichment(key).catch(() => null);
  const [vendor, photos, accepted] = await Promise.all([
    vendorName(enrichment, item),
    readAttachedPhotoFacts(enrichment),
    acceptedFacts(key),
  ]);
  const facts: ProductFacts = {
    name: item.name || item.product_name || "Product",
    brand: item.brand_name || null,
    vendor,
    category: item.category || null,
    strainType: item.strain_type || null,
    strainName: item.strain_name || null,
    thc: item.thc || null,
    cbd: item.cbd || null,
  };
  const out = await generateProductAllFields(
    key,
    facts,
    photos,
    currentFields(enrichment, accepted.sensory, accepted.effects),
    actorId,
  );
  return { ...out, photos: Math.min(photos.length, MAX_PHOTOS), vendor };
}
