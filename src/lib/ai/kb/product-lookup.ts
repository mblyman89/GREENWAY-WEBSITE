/**
 * src/lib/ai/kb/product-lookup.ts
 *
 * KB-FIRST read side (Request D): "it should look in the KB first, then ask the
 * user if they want to use an approved substitute if there isn't an exact
 * match. Or the user can go online."
 *
 * This resolves a product's descriptive facts (copy, sensory, effects, images)
 * with a KB-first ladder:
 *   1. kb_products (published) — the validated per-SKU record. Exact.
 *   2. kb_products (draft)     — staged; usable as a suggestion, flagged.
 *   3. product_enrichments     — the live marketing layer (existing behaviour).
 *   4. kb_strains (by strain)  — strain-level sensory/effects gap-fill.
 *   5. none                    — surface a "find online" prompt to the user.
 *
 * Images stay on the existing resolver (image-resolver.ts / kb_image_substitutes)
 * which already offers the approved-substitute ladder. This module returns an
 * `imageHint` describing which image strategy applies, plus a `needsOnline`
 * flag the UI uses to offer the "go online" action.
 *
 * READ-ONLY, defensive (works before migration 0071), never throws.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { checkProductKnown, type KbProductMatch } from "@/lib/ai/kb/intake";

export type ProductKnowledgeSource = "kb-exact" | "kb-draft" | "enrichment" | "strain" | "none";

export type ProductKnowledge = {
  source: ProductKnowledgeSource;
  displayName: string | null;
  description: string | null;
  shortDescription: string | null;
  aromaNotes: string[];
  flavorNotes: string[];
  terpenes: string[];
  effects: string[];
  imageMediaIds: string[];
  primaryMediaId: string | null;
  /** UI hint: 'exact' has its own image; 'substitute' should offer approved fallback; 'online' none found. */
  imageHint: "exact" | "substitute" | "online";
  /** True when we found nothing validated → prompt the user to find it online. */
  needsOnline: boolean;
};

function fromKbMatch(match: KbProductMatch, source: "kb-exact" | "kb-draft"): ProductKnowledge {
  const hasImage = Boolean(match.primary_media_id) || (match.image_media_ids?.length ?? 0) > 0;
  return {
    source,
    displayName: match.display_name ?? null,
    description: match.description ?? null,
    shortDescription: match.short_description ?? null,
    aromaNotes: match.aroma_notes ?? [],
    flavorNotes: match.flavor_notes ?? [],
    terpenes: match.terpenes ?? [],
    effects: match.effects ?? [],
    imageMediaIds: match.image_media_ids ?? [],
    primaryMediaId: match.primary_media_id ?? null,
    imageHint: hasImage ? "exact" : "substitute",
    needsOnline: false,
  };
}

export type ProductLookupQuery = {
  productName: string;
  brandName?: string | null;
  variantLabel?: string | null;
  posProductKey?: string | null;
  strainName?: string | null;
};

/**
 * KB-first lookup for a product's descriptive knowledge. Returns the best
 * available source and a UI hint for images + a needsOnline flag.
 */
export async function lookupProductKnowledge(query: ProductLookupQuery): Promise<ProductKnowledge> {
  const empty: ProductKnowledge = {
    source: "none",
    displayName: null,
    description: null,
    shortDescription: null,
    aromaNotes: [],
    flavorNotes: [],
    terpenes: [],
    effects: [],
    imageMediaIds: [],
    primaryMediaId: null,
    imageHint: "online",
    needsOnline: true,
  };
  if (!isSupabaseServiceConfigured) return empty;

  // 1 & 2 — KB per-SKU (published preferred; draft usable as suggestion).
  const verdict = await checkProductKnown({
    productName: query.productName,
    brandName: query.brandName,
    variantLabel: query.variantLabel,
  });
  if (verdict.known === "exact") return fromKbMatch(verdict.match, "kb-exact");
  if (verdict.known === "draft") return fromKbMatch(verdict.match, "kb-draft");

  const admin = createSupabaseAdminClient();

  // 3 — the live enrichment layer (existing marketing copy for this POS key).
  if (query.posProductKey) {
    try {
      const { data: enr } = await admin
        .from("product_enrichments")
        .select("display_name, description, short_description, image_media_ids, primary_media_id")
        .eq("pos_product_key", query.posProductKey)
        .maybeSingle();
      if (enr && (enr.description || enr.short_description || (enr.image_media_ids as string[])?.length)) {
        const hasImage =
          Boolean(enr.primary_media_id) || ((enr.image_media_ids as string[])?.length ?? 0) > 0;
        return {
          source: "enrichment",
          displayName: (enr.display_name as string) ?? null,
          description: (enr.description as string) ?? null,
          shortDescription: (enr.short_description as string) ?? null,
          aromaNotes: [],
          flavorNotes: [],
          terpenes: [],
          effects: [],
          imageMediaIds: (enr.image_media_ids as string[]) ?? [],
          primaryMediaId: (enr.primary_media_id as string) ?? null,
          imageHint: hasImage ? "exact" : "substitute",
          needsOnline: false,
        };
      }
    } catch {
      /* fall through */
    }
  }

  // 4 — strain-level sensory/effects gap-fill.
  if (query.strainName) {
    const slug = query.strainName.trim().toLowerCase().replace(/\s+/g, " ");
    try {
      const { data: strain } = await admin
        .from("kb_strains")
        .select("aroma_notes, flavor_notes, terpenes, summary")
        .eq("slug", slug)
        .eq("active", true)
        .maybeSingle();
      if (strain) {
        // effects column is optional (0071); read defensively.
        let effects: string[] = [];
        try {
          const { data: eff } = await admin
            .from("kb_strains")
            .select("effects")
            .eq("slug", slug)
            .maybeSingle();
          effects = (eff?.effects as string[]) ?? [];
        } catch {
          /* effects column not migrated yet */
        }
        return {
          source: "strain",
          displayName: null,
          description: (strain.summary as string) ?? null,
          shortDescription: null,
          aromaNotes: (strain.aroma_notes as string[]) ?? [],
          flavorNotes: (strain.flavor_notes as string[]) ?? [],
          terpenes: (strain.terpenes as string[]) ?? [],
          effects,
          imageMediaIds: [],
          primaryMediaId: null,
          imageHint: "substitute",
          needsOnline: false,
        };
      }
    } catch {
      /* fall through */
    }
  }

  // 5 — nothing validated → offer "find online".
  return empty;
}
