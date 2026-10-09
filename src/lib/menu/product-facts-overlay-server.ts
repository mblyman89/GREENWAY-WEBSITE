/**
 * src/lib/menu/product-facts-overlay-server.ts  (R33, T-329)
 *
 * Server reads for the product-facts overlay (pure rules in
 * product-facts-overlay-core.ts): each product's OWN counted lab terpenes
 * from its approved onboarding drafts, and the ids of PUBLISHED cards whose
 * strain type a person set (menu_items.fact_provenance.strain_type =
 * "reviewer"). Applied by withMenuProfile BEFORE the strain library, so a
 * product's own lab panel wins over the library's per-strain list and a
 * person's strain type is never overwritten by the library's.
 *
 * Kept in its own file (not strain-terpenes-server.ts) so the SLICE D guards
 * on that file keep meaning exactly what they say.
 *
 * CACHING. One small entry (keyed by product, ~names only) in the same data
 * cache as the strain indexes, under MENU_CACHE_TAG, so every publish /
 * correction that calls revalidatePublicMenuSurfaces() clears it at once;
 * otherwise it refreshes on the menu's own 60 s floor. Stored as plain
 * arrays (JSON-safe). Any read failure degrades to "no overlay" - the menu
 * then renders exactly as it did before R33; it never breaks.
 */
import "server-only";
import { unstable_cache } from "next/cache";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { MENU_CACHE_TAG, MENU_CACHE_TTL_SECONDS } from "@/lib/menu/menu-cache-policy-core";
import {
  EMPTY_PRODUCT_FACTS_OVERLAY,
  applyProductFactsOverlay,
  buildProductFactsOverlay,
  type OverlayDraftRow,
  type ProductFactsOverlay,
} from "@/lib/menu/product-facts-overlay-core";

/** Memory ceiling for the draft read (reported, never a silent cap). */
export const OVERLAY_MAX_DRAFTS = 50_000;

/**
 * Uncached build. PostgREST JSON-path select keeps the payload to the one
 * fact this needs (`terpenes:attached_facts->terpenes`) instead of every
 * attached fact of every approved draft.
 */
export async function buildProductFactsOverlayUncached(): Promise<ProductFactsOverlay> {
  if (!isSupabaseServiceConfigured) return EMPTY_PRODUCT_FACTS_OVERLAY;
  const admin = createSupabaseAdminClient();

  // 1. Each product's own lab terpenes (approved drafts only).
  let drafts: OverlayDraftRow[] = [];
  try {
    const read = await pagedAllChecked<{ pos_product_key: string | null; terpenes: unknown; updated_at: string | null }>(
      async (from, to) => {
        const { data, error } = await admin
          .from("catalog_product_drafts")
          .select("id, pos_product_key, terpenes:attached_facts->terpenes, updated_at")
          .eq("status", "approved")
          .order("id", { ascending: true })
          .range(from, to);
        return { rows: (data as { pos_product_key: string | null; terpenes: unknown; updated_at: string | null }[] | null) ?? [], ok: !error };
      },
      { maxRows: OVERLAY_MAX_DRAFTS },
    );
    if (!read.verdict.complete) {
      console.error("[product-facts-overlay] approved-draft read incomplete:", read.verdict);
    }
    drafts = read.rows
      .filter((r) => r.terpenes != null)
      .map((r) => ({ pos_product_key: r.pos_product_key, attached_facts: { terpenes: r.terpenes }, updated_at: r.updated_at }));
  } catch (err) {
    console.error("[product-facts-overlay] draft read failed:", err);
  }

  // 2. Published cards whose strain type a person set.
  const reviewer: string[] = [];
  try {
    const { data: version, error: vErr } = await admin
      .from("menu_versions")
      .select("id")
      .eq("status", "published")
      .limit(1)
      .maybeSingle();
    const versionId = (version as { id: string } | null)?.id;
    if (!vErr && versionId) {
      const read = await pagedAllChecked<{ source_item_id: string | null }>(
        async (from, to) => {
          const { data, error } = await admin
            .from("menu_items")
            .select("id, source_item_id")
            .eq("menu_version_id", versionId)
            .eq("fact_provenance->>strain_type", "reviewer")
            .order("id", { ascending: true })
            .range(from, to);
          return { rows: (data as { source_item_id: string | null }[] | null) ?? [], ok: !error };
        },
        { maxRows: OVERLAY_MAX_DRAFTS },
      );
      for (const r of read.rows) if (r.source_item_id) reviewer.push(r.source_item_id);
    }
  } catch (err) {
    console.error("[product-facts-overlay] reviewer read failed:", err);
  }

  return buildProductFactsOverlay(drafts, reviewer);
}

const loadProductFactsOverlayCached = unstable_cache(
  async (): Promise<ProductFactsOverlay> => buildProductFactsOverlayUncached(),
  ["menu-product-facts-overlay", "v1"],
  { revalidate: MENU_CACHE_TTL_SECONDS, tags: [MENU_CACHE_TAG] },
);

/** The cached overlay; falls back to an uncached build, then to no overlay. */
export async function loadProductFactsOverlay(): Promise<ProductFactsOverlay> {
  try {
    return await loadProductFactsOverlayCached();
  } catch {
    try {
      return await buildProductFactsOverlayUncached();
    } catch {
      return EMPTY_PRODUCT_FACTS_OVERLAY;
    }
  }
}

/** Apply the overlay to menu items. Never throws; identity on any failure. */
export async function withProductFacts(items: GreenwayMenuItem[]): Promise<GreenwayMenuItem[]> {
  if (items.length === 0) return items;
  try {
    return applyProductFactsOverlay(items, await loadProductFactsOverlay());
  } catch (err) {
    console.error("[product-facts-overlay] apply failed:", err);
    return items;
  }
}
