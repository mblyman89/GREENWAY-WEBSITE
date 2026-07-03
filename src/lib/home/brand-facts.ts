/**
 * src/lib/home/brand-facts.ts
 *
 * Slice 7d \u2014 make the customer-facing brand surfaces MASTER-DATA DRIVEN.
 *
 * The home "Shop by Brand" grid legitimately shows only brands that have live
 * products (so a tile never links to an empty menu), so we keep the menu as the
 * source of WHICH brands appear. But the tile CONTENT should be governed by the
 * operational `brands` master table (single source of truth) \u2014 canonical
 * display name + the folded-in brand facts (known_for tagline). This helper
 * builds a lookup the client grid overlays onto its menu-derived brand list.
 *
 * Matching is by normalized display name (the menu stores the brand as free
 * text in `brand`; master data stores it in `brands.display_name`). READ-ONLY,
 * defensive, never throws \u2014 returns an empty map when unconfigured/unmatched so
 * the grid degrades to today's behavior.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export type BrandFactsOverlay = {
  /** Canonical master-data display name (may differ in casing/spacing). */
  displayName: string;
  /** Folded-in "known for" tagline (compliance-safe, sensory/style only). */
  knownFor: string | null;
};

/** Normalize a brand name for matching (lowercase, collapse whitespace). */
export function normalizeBrandKey(value: string): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Build a normalized-name -> master-data overlay map for all operational
 * brands. The home grid uses this to (a) render the canonical display name and
 * (b) show the brand's known_for tagline when present.
 */
export async function loadBrandFactsOverlay(): Promise<Record<string, BrandFactsOverlay>> {
  if (!isSupabaseServiceConfigured) return {};
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("brands")
      .select("display_name, known_for, status")
      .neq("status", "archived");
    if (error || !data) return {};
    const out: Record<string, BrandFactsOverlay> = {};
    for (const r of data as { display_name: string; known_for: string | null; status: string }[]) {
      const name = String(r.display_name ?? "").trim();
      if (!name) continue;
      const key = normalizeBrandKey(name);
      // First write wins; brands are display_name-ordered so this is stable.
      if (!out[key]) out[key] = { displayName: name, knownFor: r.known_for ?? null };
    }
    return out;
  } catch {
    return {};
  }
}
