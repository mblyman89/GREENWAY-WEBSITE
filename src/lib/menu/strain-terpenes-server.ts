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
  attachTerpenes,
  buildStaticTerpeneIndex,
  cleanTerpenes,
  normalizeStrainKey,
  type TerpeneIndex,
} from "@/lib/menu/strain-terpenes";

/**
 * Build the effective terpene index: static curated set as the base, overlaid
 * with any active KB strain rows that carry terpenes (KB wins on match).
 */
export async function buildTerpeneIndex(): Promise<TerpeneIndex> {
  const index: TerpeneIndex = buildStaticTerpeneIndex();
  try {
    const rows = await listKbStrains(1000);
    for (const r of rows) {
      if (!r.active) continue;
      const terps = cleanTerpenes(r.terpenes);
      if (terps.length === 0) continue;
      // KB rows override the static base for name + slug.
      for (const k of [r.name, r.slug]) {
        const nk = normalizeStrainKey(k);
        if (nk) index.set(nk, terps);
      }
    }
  } catch {
    // Degrade to the static index on any read error.
  }
  return index;
}

/** Attach terpenes to menu items using the effective (DB-overlaid) index. */
export async function withTerpenes(items: GreenwayMenuItem[]): Promise<GreenwayMenuItem[]> {
  const index = await buildTerpeneIndex();
  return attachTerpenes(items, index);
}
