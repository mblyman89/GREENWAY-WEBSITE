/**
 * strain-terpenes-server.ts — server-side terpene attachment for the live menu.
 *
 * Overlays live kb_strains rows on top of the curated static index so
 * staff/AI-curated terpenes take precedence, then attaches terpenes to menu
 * items. Degrades gracefully to the static index when the DB is empty / not
 * configured (listKbStrains already returns [] pre-migration).
 *
 * Kept separate from strain-terpenes.ts (the pure core) so the core stays
 * client-safe and unit-testable without server-only imports.
 */

import { unstable_cache } from "next/cache";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { listKbStrains } from "@/lib/ai/kb/store";
import {
  MENU_CACHE_TAG,
  MENU_CACHE_TTL_SECONDS,
} from "@/lib/menu/menu-cache-policy-core";
import {
  attachStrainProfile,
  attachTerpenes,
  buildStaticStrainTypeIndex,
  buildStaticTerpeneIndex,
  cleanTerpenes,
  normalizeStrainKey,
  type StrainTypeIndex,
  type TerpeneIndex,
} from "@/lib/menu/strain-terpenes";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";

/**
 * Build both effective indexes in a single KB read: the static curated sets as
 * the base, overlaid with any active KB strain rows (KB wins on match).
 *   - terpenes: overlaid when the row carries a non-empty terpenes list.
 *   - strainType: overlaid when the row's strain_type canonicalizes to a valid
 *     (non-"unknown") type, so KB leaning-hybrid edits reach the menu.
 * Degrades to the static indexes when the DB is empty / not configured.
 */
export async function buildMenuIndexes(): Promise<{
  terpeneIndex: TerpeneIndex;
  strainTypeIndex: StrainTypeIndex;
}> {
  const terpeneIndex: TerpeneIndex = buildStaticTerpeneIndex();
  const strainTypeIndex: StrainTypeIndex = buildStaticStrainTypeIndex();
  try {
    // SLICE 3: this index must cover the WHOLE strain library, not the first
    // page of it. A strain missing from the index silently loses its terpene
    // profile and strain type on the customer's product card. listKbStrains()
    // now pages, so this bound is a real maximum rather than a silent cap.
    const rows = await listKbStrains(50_000);
    for (const r of rows) {
      if (!r.active) continue;
      const keys = [r.name, r.slug].map(normalizeStrainKey).filter((k) => k.length > 0);

      const terps = cleanTerpenes(r.terpenes);
      if (terps.length > 0) {
        for (const nk of keys) terpeneIndex.set(nk, terps);
      }

      const canon = canonicalStrainType(r.strain_type);
      if (canon !== "unknown") {
        for (const nk of keys) strainTypeIndex.set(nk, canon);
      }
    }
  } catch {
    // Degrade to the static indexes on any read error.
  }
  return { terpeneIndex, strainTypeIndex };
}

/**
 * Build the effective terpene index alone (static base overlaid with KB
 * terpenes). Retained for callers that only need terpenes.
 */
export async function buildTerpeneIndex(): Promise<TerpeneIndex> {
  const { terpeneIndex } = await buildMenuIndexesCached();
  return terpeneIndex;
}

/** Attach terpenes to menu items using the effective (DB-overlaid) index. */
export async function withTerpenes(items: GreenwayMenuItem[]): Promise<GreenwayMenuItem[]> {
  const index = await buildTerpeneIndex();
  return attachTerpenes(items, index);
}

// ---------------------------------------------------------------------------
// SLICE D (performance) — cache the STRAIN LIBRARY, not the product catalog
// ---------------------------------------------------------------------------
/**
 * WHAT THIS FIXES. `buildMenuIndexes()` above calls `listKbStrains(50_000)`,
 * which pages the strain table 1,000 rows at a time (ai/kb/store.ts). Each page
 * is its own round trip and each one waits for the last, so building these two
 * indexes could cost dozens of serial queries — on EVERY request to the menu,
 * the home page and the specials page, none of it cached.
 *
 * WHY THIS IS THE RIGHT THING TO CACHE, AND THE MENU IS NOT. Vercel's Data
 * Cache and Runtime Cache both cap a single entry at 2 MB and, per their
 * documentation, an item over the limit is simply "not cached" — no error, no
 * warning, the write is dropped. The enriched menu is over that line (the raw
 * catalog alone serialises to ~1.6 MB at 4,500 products), so caching it would
 * have produced a cache that never stored anything while looking like a fix.
 * These two indexes are keyed by STRAIN, not by product: their size tracks the
 * strain library, which is orders of magnitude smaller and does not grow when
 * the store receives more inventory.
 *
 * SERIALISATION. `unstable_cache` stores JSON, and a `Map` does not survive
 * that round trip. The entry is therefore stored as plain entry arrays and
 * rebuilt into Maps on the way out — the callers' types are unchanged.
 *
 * FRESHNESS, STATED HONESTLY. This shares MENU_CACHE_TAG, so publishing or
 * resetting the menu clears it instantly along with everything else
 * (public-surfaces.ts). A KB-only edit — renaming a strain's terpenes in Admin
 * without republishing — is NOT a publish, so it appears on the website within
 * MENU_CACHE_TTL_SECONDS instead of on the very next request. That is a
 * descriptive, sensory field on a product card, it is the same 60-second floor
 * the rest of the menu already lives under, and it is a deliberate trade for
 * removing dozens of blocking queries from every page load.
 */
type MenuIndexEntries = {
  terpenes: [string, string[]][];
  strainTypes: [string, GreenwayMenuItem["strainType"]][];
};

const loadMenuIndexEntriesCached = unstable_cache(
  async (): Promise<MenuIndexEntries> => {
    const { terpeneIndex, strainTypeIndex } = await buildMenuIndexes();
    return {
      terpenes: [...terpeneIndex.entries()],
      strainTypes: [...strainTypeIndex.entries()],
    };
  },
  ["menu-strain-indexes", "v1"],
  { revalidate: MENU_CACHE_TTL_SECONDS, tags: [MENU_CACHE_TAG] },
);

/**
 * The cached form of `buildMenuIndexes()`. Falls back to an uncached build if
 * the cache layer is unavailable, so a cache problem can never blank a menu's
 * terpenes — the page just pays the old cost for that request.
 */
export async function buildMenuIndexesCached(): Promise<{
  terpeneIndex: TerpeneIndex;
  strainTypeIndex: StrainTypeIndex;
}> {
  try {
    const entries = await loadMenuIndexEntriesCached();
    return {
      terpeneIndex: new Map(entries.terpenes),
      strainTypeIndex: new Map(entries.strainTypes),
    };
  } catch {
    return buildMenuIndexes();
  }
}

/**
 * Attach the full strain profile (terpenes + corrected strainType) to menu
 * items using the effective (DB-overlaid) indexes. This is what the live menu
 * uses so both the terpene filter and the leaning-hybrid strain-type filter
 * populate from the knowledge base.
 */
export async function withMenuProfile(items: GreenwayMenuItem[]): Promise<GreenwayMenuItem[]> {
  const { terpeneIndex, strainTypeIndex } = await buildMenuIndexesCached();
  return attachStrainProfile(items, terpeneIndex, strainTypeIndex);
}
