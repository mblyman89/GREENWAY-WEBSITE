/**
 * src/lib/menu/product-sensory-server.ts  (R35 #6, server half - migration 0254)
 *
 * The product page's read of the product's OWN counted effects and aroma
 * (menu_items.effects / menu_items.aroma_notes on the PUBLISHED card), and
 * the merge with the knowledge-base ladder the page already shows.
 *
 * WHY A SEPARATE READ. The full-menu loaders deliberately never select the two
 * columns (MENU_ITEM_DROPPED_COLUMNS, menu-columns-core): before the owner
 * applies 0254 naming them would fail the WHOLE menu read. This file reads
 * ONE row by its key, and any error - including 42703 / PGRST204 before 0254
 * - degrades to "nothing own", so the page renders exactly as before R35.
 *
 * COMPLIANCE, TWICE. The writers only ever store lists that passed
 * checkEffects() / lintTerms() with the owner's kb_banned_phrases. The page
 * re-runs the SAME gate at render time, so a phrase the owner bans later
 * disappears from the page on the next render without any re-write (the
 * same doctrine product-knowledge-display applies to KB copy).
 *
 * CACHING. One tiny entry per product in the menu data cache under
 * MENU_CACHE_TAG (cleared by every publish / correction via
 * revalidatePublicMenuSurfaces), else the menu's own 60 s floor.
 */
import "server-only";
import { unstable_cache } from "next/cache";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkEffects, lintTerms, type ExtraBannedPhrase } from "@/lib/ai/compliance";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { MENU_CACHE_TAG, MENU_CACHE_TTL_SECONDS } from "@/lib/menu/menu-cache-policy-core";
import {
  isMissingSensoryColumnError,
  preferOwnSensory,
  sensoryForStorage,
  type SensoryOrigin,
} from "@/lib/pos/menu-sensory-core";

export type OwnSensory = { effects: string[] | null; aroma: string[] | null };

const NONE: OwnSensory = { effects: null, aroma: null };

/**
 * Uncached: the published card's two lists for `sourceItemId`, in storage
 * form, or NONE. Never throws. Exported for the R35 tests.
 */
export async function readOwnSensoryUncached(sourceItemId: string): Promise<OwnSensory> {
  const key = String(sourceItemId ?? "").trim();
  if (!key || !isSupabaseServiceConfigured) return NONE;
  try {
    const admin = createSupabaseAdminClient();
    const { data: version, error: vErr } = await admin
      .from("menu_versions")
      .select("id")
      .eq("status", "published")
      .limit(1)
      .maybeSingle();
    const versionId = (version as { id: string } | null)?.id;
    if (vErr || !versionId) return NONE;
    const { data, error } = await admin
      .from("menu_items")
      .select("effects, aroma_notes")
      .eq("menu_version_id", versionId)
      .eq("source_item_id", key)
      .limit(1)
      .maybeSingle();
    if (error) {
      // Before 0254 this is expected and silent; anything else is logged.
      if (!isMissingSensoryColumnError(error)) {
        console.error("[product-sensory] own effects/aroma read failed:", error.message);
      }
      return NONE;
    }
    const row = data as { effects?: unknown; aroma_notes?: unknown } | null;
    if (!row) return NONE;
    return { effects: sensoryForStorage(row.effects), aroma: sensoryForStorage(row.aroma_notes) };
  } catch (err) {
    console.error("[product-sensory] own effects/aroma read threw:", err);
    return NONE;
  }
}

const readOwnSensoryCached = unstable_cache(
  async (sourceItemId: string): Promise<OwnSensory> => readOwnSensoryUncached(sourceItemId),
  ["menu-product-own-sensory", "v1"],
  { revalidate: MENU_CACHE_TTL_SECONDS, tags: [MENU_CACHE_TAG] },
);

/**
 * The render-time gate (exported for the R35 tests): effects through
 * checkEffects().allowed, aroma through lintTerms().safe, both with the
 * owner's banned phrases. Never widens a list; empty = null.
 */
export function gateOwnSensory(own: OwnSensory, banned: ExtraBannedPhrase[]): OwnSensory {
  return {
    effects: own.effects ? sensoryForStorage(checkEffects(own.effects, banned).allowed) : null,
    aroma: own.aroma ? sensoryForStorage(lintTerms(own.aroma, banned).safe) : null,
  };
}

export type PageSensory = {
  effects: string[];
  aroma: string[];
  effectsOrigin: SensoryOrigin;
  aromaOrigin: SensoryOrigin;
};

/**
 * What the product page shows for Experience and Aroma: the product's own
 * counted (re-gated) list when it has one, else the knowledge-base list it
 * showed before R35. Never throws; on any failure it is exactly the KB lists.
 */
export async function resolvePageSensory(
  sourceItemId: string,
  kb: { effects?: readonly string[] | null; aroma?: readonly string[] | null },
): Promise<PageSensory> {
  try {
    let own: OwnSensory;
    try {
      own = await readOwnSensoryCached(sourceItemId);
    } catch {
      own = await readOwnSensoryUncached(sourceItemId);
    }
    if (!own.effects && !own.aroma) return preferOwnSensory(null, kb);
    let banned: ExtraBannedPhrase[] = [];
    try {
      banned = await loadBannedPhrases();
    } catch {
      // Fail closed toward the KB: without the owner's list we cannot clear
      // the own lists, so the page shows what it showed before R35.
      return preferOwnSensory(null, kb);
    }
    return preferOwnSensory(gateOwnSensory(own, banned), kb);
  } catch (err) {
    console.error("[product-sensory] resolve failed:", err);
    return preferOwnSensory(null, kb);
  }
}
