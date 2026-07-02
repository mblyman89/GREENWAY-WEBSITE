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

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { listKbStrains } from "@/lib/ai/kb/store";
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
    const rows = await listKbStrains(1000);
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
  const { terpeneIndex } = await buildMenuIndexes();
  return terpeneIndex;
}

/** Attach terpenes to menu items using the effective (DB-overlaid) index. */
export async function withTerpenes(items: GreenwayMenuItem[]): Promise<GreenwayMenuItem[]> {
  const index = await buildTerpeneIndex();
  return attachTerpenes(items, index);
}

/**
 * Attach the full strain profile (terpenes + corrected strainType) to menu
 * items using the effective (DB-overlaid) indexes. This is what the live menu
 * uses so both the terpene filter and the leaning-hybrid strain-type filter
 * populate from the knowledge base.
 */
export async function withMenuProfile(items: GreenwayMenuItem[]): Promise<GreenwayMenuItem[]> {
  const { terpeneIndex, strainTypeIndex } = await buildMenuIndexes();
  return attachStrainProfile(items, terpeneIndex, strainTypeIndex);
}
