/**
 * src/lib/ai/kb/intake.ts
 *
 * KB INTAKE "already known?" check (Request D). When a product arrives (POS
 * import / new invoice), we first ask the KB: do we already know this exact
 * product (brand + normalized name + variant)?
 *
 *   • If a PUBLISHED kb_products row exists → return it so the caller can
 *     auto-fill the product's copy/sensory/effects/images EXACTLY from the KB.
 *     This is the "existing vendor supplies an existing product" fast path.
 *   • If only a DRAFT row exists → it's staged but not yet validated; treat as
 *     "known but needs review" (caller can pre-fill but should confirm).
 *   • If NO row exists → it's "new-to-us"; the caller should run product
 *     enrichment first, then fill the blanks.
 *
 * This is READ-ONLY and non-destructive. It never writes. Defensive: if the
 * kb_products table isn't there yet (migration 0071 not applied), it returns a
 * "not-ready" result so intake still proceeds via enrichment.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

function slugifyDashed(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type KbProductMatch = {
  id: string;
  brand_slug: string;
  product_slug: string;
  variant_label: string;
  display_name: string;
  category: string | null;
  aroma_notes: string[];
  flavor_notes: string[];
  terpenes: string[];
  effects: string[];
  description: string | null;
  short_description: string | null;
  image_media_ids: string[];
  primary_media_id: string | null;
  status: string;
  active: boolean;
};

export type IntakeVerdict =
  | { known: "exact"; match: KbProductMatch } // published, auto-fill exactly
  | { known: "draft"; match: KbProductMatch } // staged, pre-fill but confirm
  | { known: "new" } // new-to-us → run enrichment
  | { known: "not-ready" }; // KB table not migrated yet

export type IntakeQuery = {
  productName: string;
  brandName?: string | null;
  variantLabel?: string | null;
};

/**
 * Look up whether we already know a product. Returns a verdict the caller uses
 * to decide auto-fill vs. enrichment. Never throws.
 */
export async function checkProductKnown(query: IntakeQuery): Promise<IntakeVerdict> {
  if (!isSupabaseServiceConfigured) return { known: "new" };

  const brandSlug = query.brandName ? slugifyDashed(query.brandName) : "unknown-brand";
  const productSlug = slugifyDashed(query.productName) || "product";
  const variantLabel = (query.variantLabel ?? "").trim();

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_products")
      .select(
        "id, brand_slug, product_slug, variant_label, display_name, category, aroma_notes, flavor_notes, terpenes, effects, description, short_description, image_media_ids, primary_media_id, status, active",
      )
      .eq("brand_slug", brandSlug)
      .eq("product_slug", productSlug)
      .eq("variant_label", variantLabel)
      .maybeSingle();

    if (error) {
      // Table missing / not migrated → let intake fall back to enrichment.
      return { known: "not-ready" };
    }
    if (!data) return { known: "new" };

    const match = data as KbProductMatch;
    if (match.status === "published" && match.active) {
      return { known: "exact", match };
    }
    return { known: "draft", match };
  } catch {
    return { known: "not-ready" };
  }
}

/**
 * Batch variant of checkProductKnown for an import file. Returns a Map keyed by
 * the caller's own row index (so results line up with the input array).
 */
export async function checkProductsKnown(
  queries: IntakeQuery[],
): Promise<Map<number, IntakeVerdict>> {
  const out = new Map<number, IntakeVerdict>();
  for (let i = 0; i < queries.length; i += 1) {
    out.set(i, await checkProductKnown(queries[i]));
  }
  return out;
}
