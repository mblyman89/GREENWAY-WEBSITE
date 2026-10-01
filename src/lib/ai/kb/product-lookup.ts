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
import { loadKbKnowledgeIndexes } from "@/lib/ai/kb/product-knowledge-batch";
import {
  enrichmentByIdentity,
  fromEnrichmentPure,
  queryIdentityKey,
  resolveKbFromIndexes,
  type EnrichmentRow,
} from "@/lib/ai/kb/product-knowledge-batch-core";
import { loadPublishedEnrichmentsByIdentity } from "@/lib/enrichment/enrichment-identity-server";
import type { IdentityCandidate } from "@/lib/enrichment/enrichment-identity-core";

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
  /** S24: the card's first menu variant label, raw ("3.5g"). */
  menuVariantLabel?: string | null;
  /** S24: the card's lot keys (cardLotKeys), for the writer-identity rungs. */
  lotKeys?: readonly string[] | null;
  /** S20: the card's product identity (storage form), for rung 3b. */
  identityKey?: string | null;
};

/** S24: does this query carry anything the writer-identity rungs can use? */
export function hasWriterIdentityInputs(query: ProductLookupQuery): boolean {
  return (query.lotKeys?.length ?? 0) > 0 || Boolean(query.menuVariantLabel?.trim());
}

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
  // S24 (F-065/F-083): with lot keys / a menu variant, resolve rungs 1 & 2
  // from the SAME indexes and pure picker the batched menu uses, so the
  // detail page and command center find the rows the manifest bridge wrote
  // (raw name + "3.5 g"). The legacy display-name key is one of its
  // candidates, so nothing the old read found can be lost.
  if (hasWriterIdentityInputs(query)) {
    const kbIndexes = await loadKbKnowledgeIndexes(query);
    const kb = kbIndexes ? resolveKbFromIndexes(query, kbIndexes) : null;
    if (kb) return kb;
    if (!kbIndexes) {
      const legacy = await checkProductKnown({
        productName: query.productName,
        brandName: query.brandName,
        variantLabel: query.variantLabel,
      });
      if (legacy.known === "exact") return fromKbMatch(legacy.match, "kb-exact");
      if (legacy.known === "draft") return fromKbMatch(legacy.match, "kb-draft");
    }
  } else {
    const verdict = await checkProductKnown({
      productName: query.productName,
      brandName: query.brandName,
      variantLabel: query.variantLabel,
    });
    if (verdict.known === "exact") return fromKbMatch(verdict.match, "kb-exact");
    if (verdict.known === "draft") return fromKbMatch(verdict.match, "kb-draft");
  }

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

  // 3b (S20) — the same PRODUCT's published enrichment, by identity, when the
  // card's own row is absent or blank. The SAME loader + pure picker as the
  // batched menu (enrichmentByIdentity), so the detail page and the menu
  // can never disagree. Flag off / pre-0234 / error -> empty map -> skipped.
  const identityKey = queryIdentityKey(query);
  if (identityKey) {
    const byIdentity = await loadPublishedEnrichmentsByIdentity<EnrichmentRow & IdentityCandidate>(
      [identityKey],
      "pos_product_key, display_name, description, short_description, image_media_ids, primary_media_id",
      admin,
    );
    const borrowed = enrichmentByIdentity(query, {
      kbProducts: new Map(),
      enrichments: new Map(),
      strains: new Map(),
      enrichmentsByIdentity: byIdentity,
    });
    if (borrowed) return fromEnrichmentPure(borrowed);
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
