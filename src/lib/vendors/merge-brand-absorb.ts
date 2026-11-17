import "server-only";
/**
 * D247: before a hand-picked merge, every merged-in card with no brand of its own becomes a brand
 * (named after the card) ON THAT CARD; merge_vendors_v2 then repoints brands.vendor_id to the kept
 * card with everything else, so "each brand absorbed gets added to the vendor's profile". The
 * card's products / lots / enrichment rows with an EMPTY brand get that brand (never overwrites).
 * Pure planning: merge-brand-absorb-core.ts.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  absorbSlugsToCheck,
  planBrandAbsorption,
  type AbsorbBrand,
  type AbsorbStep,
  type AbsorbVendor,
} from "@/lib/vendors/merge-brand-absorb-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Rows that carry vendor_id + brand_id: an empty brand_id on the absorbed card's rows is filled. */
export const ABSORB_BRAND_FILL_TABLES = ["catalog_product_drafts", "product_enrichments", "inventory_lots", "kb_products"] as const;

export type AbsorbResult = { steps: AbsorbStep[]; created: number; claimed: number; filled: Record<string, number>; errors: string[] };

const VENDOR_COLS = "id, display_name, status, website, about, mission_statement, product_philosophy, logo_media_id";

export async function absorbVendorsAsBrands(
  survivorId: string,
  duplicateIds: string[],
  actorId: string | null,
  deps: { admin?: Admin } = {},
): Promise<AbsorbResult> {
  const admin = deps.admin ?? createSupabaseAdminClient();
  const errors: string[] = [];
  const { data: dupRows, error: vErr } = await admin.from("vendors").select(VENDOR_COLS).in("id", duplicateIds);
  if (vErr) throw new Error(`Could not read the cards to merge: ${vErr.message}`);
  const dups = ((dupRows as AbsorbVendor[] | null) ?? []).sort((a, b) => duplicateIds.indexOf(a.id) - duplicateIds.indexOf(b.id));
  const { data: cardBrands, error: bErr } = await admin.from("brands").select("id, display_name, slug, vendor_id").in("vendor_id", [survivorId, ...duplicateIds]);
  if (bErr) throw new Error(`Could not read the cards' brands: ${bErr.message}`);
  const slugs = absorbSlugsToCheck(dups);
  let slugBrands: AbsorbBrand[] = [];
  if (slugs.length) {
    const { data, error } = await admin.from("brands").select("id, display_name, slug, vendor_id").in("slug", slugs);
    if (error) throw new Error(`Could not check existing brand names: ${error.message}`);
    slugBrands = (data as AbsorbBrand[] | null) ?? [];
  }
  const steps = planBrandAbsorption({ survivorId, duplicates: dups, brandsOfCards: (cardBrands as AbsorbBrand[] | null) ?? [], brandsBySlug: slugBrands });

  let created = 0;
  let claimed = 0;
  const filled: Record<string, number> = {};
  const done = new Set<string>();
  for (const s of steps) {
    let brandId: string | null = null;
    if (s.kind === "create") {
      const { data, error } = await admin.from("brands").insert({ ...s.row, created_by: actorId, updated_by: actorId }).select("id").maybeSingle();
      if (error) {
        errors.push(`“${s.vendorName}”: ${error.message}`);
        continue;
      }
      brandId = (data as { id: string } | null)?.id ?? null;
      if (brandId) created += 1;
    } else if (s.kind === "claim") {
      // Only while it still belongs to nobody (never steals one assigned meanwhile).
      const { data, error } = await admin.from("brands").update({ vendor_id: s.vendorId, updated_by: actorId }).eq("id", s.brandId).is("vendor_id", null).select("id");
      if (error) {
        errors.push(`“${s.vendorName}”: ${error.message}`);
        continue;
      }
      if (((data as unknown[] | null) ?? []).length === 1) {
        brandId = s.brandId;
        claimed += 1;
      } else errors.push(`“${s.vendorName}”: the brand “${s.brandName}” was given to another vendor meanwhile`);
    }
    if (!brandId) continue;
    done.add(s.vendorId);
    for (const t of ABSORB_BRAND_FILL_TABLES) {
      const { data, error } = await admin.from(t).update({ brand_id: brandId }).eq("vendor_id", s.vendorId).is("brand_id", null).select("id");
      if (error) errors.push(`${t}: ${error.message}`);
      else filled[t] = (filled[t] ?? 0) + ((data as unknown[] | null) ?? []).length;
    }
  }
  return { steps: steps.filter((x) => (x.kind !== "create" && x.kind !== "claim") || done.has(x.vendorId)), created, claimed, filled, errors };
}
