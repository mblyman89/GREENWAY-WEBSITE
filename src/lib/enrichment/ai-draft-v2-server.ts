/**
 * src/lib/enrichment/ai-draft-v2-server.ts  (D244 E-4 - AI drafting v2)
 *
 * Gathers everything the "all fields" draft needs ON THE SERVER (never from
 * the form): POS facts from the published menu row, the vendor (F-08 - the
 * old drafts never saw it), the attached photos' vision text, and the
 * fields already on record (for the diff + the prompt). Then runs one
 * generateProductAllFields call. Shared by the detail-page button (E-4) and
 * the bulk background job (E-5). Never throws on the reads; says so instead.
 * D244 R-3: prepareAllFields is the ONE reader; the overnight Gemini batch
 * builds its request from it too (buildAllFieldsRequestForProduct).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getEnrichment } from "@/lib/enrichment/store";
import type { ProductEnrichment } from "@/lib/enrichment/types";
import { buildAllFieldsRequest, generateProductAllFields, type AllFieldsCurrent, type AllFieldsOutcome, type AllFieldsRequest } from "@/lib/ai/all-fields-draft";
import type { ProductFacts } from "@/lib/ai/suggestions";
import { MAX_PHOTOS, sensoryText, type PhotoFacts } from "@/lib/enrichment/ai-draft-v2-core";
import { buildLotEvidence, type LotEvidence, type LotEvidenceLab, type LotEvidenceLot } from "@/lib/enrichment/lot-evidence-core";
import { readStoredCoaExtract } from "@/lib/inventory/coa-facts-core";

/** Most lots read per product (newest first; the core keeps in-stock first). */
const LOT_READ_LIMIT = 12;

/** Top lab-measured terpenes from a stored certificate read (JSON first, then PDF). */
function coaTerpenes(raw: unknown): { terpenes: string[]; thc: number | null; cbd: number | null } {
  const x = readStoredCoaExtract(raw);
  if (!x) return { terpenes: [], thc: null, cbd: null };
  const fromJson = (x.json?.terpenes ?? []).filter((t) => t.ppm > 0).sort((a, b) => b.ppm - a.ppm).map((t) => t.name);
  const fromPdf = (x.pdf?.terpeneSummary.top ?? []).map((t) => t.name);
  return {
    terpenes: (fromJson.length ? fromJson : fromPdf).slice(0, 4),
    thc: x.json?.totals["total-thc"] ?? x.pdf?.summary.totalThcPct ?? null,
    cbd: x.json?.totals["total-cbd"] ?? x.pdf?.summary.totalCbdPct ?? null,
  };
}

/**
 * D244 R-2: this product's lots and their lab certificates, as [lot:N] /
 * [coa:N] evidence. null on any read failure (the draft runs without it and
 * says so in the input summary) - never a partial guess.
 */
export async function readLotEvidence(key: string): Promise<LotEvidence | null> {
  if (!isSupabaseServiceConfigured || !key) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("inventory_lots")
      .select("*")
      .eq("pos_product_key", key)
      .order("created_at", { ascending: false })
      .limit(LOT_READ_LIMIT);
    if (error) return null;
    const lots = ((data ?? []) as (LotEvidenceLot & { lab_result_id?: string | null })[]).filter((l) => l && l.id);
    const labIds = [...new Set(lots.map((l) => l.lab_result_id).filter((x): x is string => typeof x === "string" && x.length > 0))];
    const labs = new Map<string, LotEvidenceLab>();
    if (labIds.length) {
      const res = await admin.from("lab_results").select("*").in("id", labIds);
      if (res.error) return null;
      for (const r of (res.data ?? []) as (LotEvidenceLab & { id: string; coa_extract_json?: unknown })[]) {
        const c = coaTerpenes(r.coa_extract_json);
        labs.set(r.id, { ...r, coa: { terpenes: c.terpenes, totalThcPct: c.thc, totalCbdPct: c.cbd } });
      }
    }
    return buildLotEvidence(lots.map((l) => ({ ...l, lab: l.lab_result_id ? (labs.get(l.lab_result_id) ?? null) : null })));
  } catch {
    return null;
  }
}

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

/** D244 R-2: strain type + potency already on the card (for "on record" and the diff). */
export function cardFacts(item: Pick<DraftItem, "strain_type" | "thc" | "cbd">): AllFieldsCurrent {
  const t = (item.strain_type ?? "").trim();
  const pot = [item.thc ? `THC ${item.thc}` : "", item.cbd ? `CBD ${item.cbd}` : ""].filter(Boolean).join(" · ");
  return { strain_type: t && t !== "unknown" ? t : null, potency: pot || null };
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

/** Everything the all-fields draft reads about one product (live and overnight share it). */
export async function prepareAllFields(
  key: string,
  item: DraftItem,
): Promise<{ facts: ProductFacts; photos: PhotoFacts[]; current: AllFieldsCurrent; lots: LotEvidence | null; vendor: string | null }> {
  const enrichment = await getEnrichment(key).catch(() => null);
  const [vendor, photos, accepted, lots] = await Promise.all([
    vendorName(enrichment, item),
    readAttachedPhotoFacts(enrichment),
    acceptedFacts(key),
    readLotEvidence(key),
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
  const current = { ...currentFields(enrichment, accepted.sensory, accepted.effects), ...cardFacts(item) };
  return { facts, photos, current, lots, vendor };
}

/** D244 R-3: the overnight batch's request for one product (same prompt + evidence as live). */
export async function buildAllFieldsRequestForProduct(key: string, item: DraftItem): Promise<AllFieldsRequest> {
  const p = await prepareAllFields(key, item);
  return buildAllFieldsRequest(p.facts, p.photos, p.current, p.lots);
}

/** Run the all-fields draft for one product. Throws only on the AI call. */
export async function draftAllFieldsForProduct(
  key: string,
  item: DraftItem,
  actorId: string | null,
): Promise<AllFieldsOutcome & { photos: number; vendor: string | null; lots: number }> {
  const { facts, photos, current, lots, vendor } = await prepareAllFields(key, item);
  const out = await generateProductAllFields(key, facts, photos, current, actorId, lots);
  return { ...out, photos: Math.min(photos.length, MAX_PHOTOS), vendor, lots: lots ? lots.ids.filter((i) => i.startsWith("lot:")).length : 0 };
}
