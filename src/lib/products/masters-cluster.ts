/**
 * src/lib/products/masters-cluster.ts
 *
 * PURE helpers for product mastering (Slice 24). No server-only imports, so this
 * can be unit-tested directly with tsx. The clustering here narrows the menu
 * into small candidate sets BEFORE any AI call, so the AI only adjudicates fine
 * grouping (not the whole menu), which keeps cost low and accuracy high.
 */

export type MasterCandidateItem = {
  /** Stable POS key (menu_items.source_item_id). */
  key: string;
  name: string;
  brand: string;
  category: string;
  strainName: string | null;
  priceMinor: number;
};

/** Normalise a string for fuzzy comparison: lowercase, strip punctuation/sizes. */
export function normalizeForMatch(raw: string): string {
  return raw
    .toLowerCase()
    // Remove common size tokens so "OG Kush 1g" ~ "OG Kush 3.5g".
    .replace(/\b\d+(\.\d+)?\s*(g|mg|gram|grams|oz|ml|pk|pack|ct|count)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A coarse cluster key: brand + category. Same key = AI candidate cluster. */
export function clusterKey(item: MasterCandidateItem): string {
  return `${normalizeForMatch(item.brand)}|${normalizeForMatch(item.category)}`;
}

/**
 * Group items into coarse candidate clusters by brand+category. Clusters with
 * a single item are NOT worth grouping and are dropped — there's nothing to
 * merge. Returns clusters sorted by size (largest first) so the most impactful
 * suggestions surface first.
 */
export function buildCandidateClusters(
  items: MasterCandidateItem[],
): MasterCandidateItem[][] {
  const map = new Map<string, MasterCandidateItem[]>();
  for (const item of items) {
    const k = clusterKey(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return [...map.values()]
    .filter((cluster) => cluster.length >= 2)
    .sort((a, b) => b.length - a.length);
}

/**
 * A deterministic pre-grouping WITHIN a cluster by normalised name. When two
 * items share an identical normalised name (size stripped), they are almost
 * certainly the same product — we can suggest these even without the AI, and
 * flag them high-confidence. Returns groups of 2+ only.
 */
export function deterministicNameGroups(
  cluster: MasterCandidateItem[],
): MasterCandidateItem[][] {
  const map = new Map<string, MasterCandidateItem[]>();
  for (const item of cluster) {
    const k = normalizeForMatch(item.strainName || item.name);
    if (!k) continue;
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return [...map.values()].filter((g) => g.length >= 2);
}

/** Derive a variant label for a member from its name (e.g. "1g", "3.5g", "10pk"). */
export function deriveVariantLabel(name: string): string | null {
  const m = name.match(/\b(\d+(?:\.\d+)?)\s*(g|mg|gram|grams|oz|ml|pk|pack|ct)\b/i);
  if (!m) return null;
  const unit = m[2].toLowerCase().replace(/grams?/, "g").replace(/pack/, "pk");
  return `${m[1]}${unit}`;
}
