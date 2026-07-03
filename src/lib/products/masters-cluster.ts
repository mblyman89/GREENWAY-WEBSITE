/**
 * src/lib/products/masters-cluster.ts
 *
 * PURE helpers for product mastering (Slice 24 + the 7f "super-intelligent"
 * backbone upgrade). No server-only imports, so this can be unit-tested directly
 * with tsx. The clustering here narrows the menu into small candidate BLOCKS
 * before any AI call, so the AI only adjudicates fine grouping (not the whole
 * menu), which keeps cost low and accuracy high.
 *
 * 7f grounds the grouping IDENTITY on the backbone rather than raw name strings:
 *
 *     identity = BRAND-IDENTITY x CATEGORY-FAMILY x CANONICAL-STRAIN x MARKET
 *
 * where brand/family/strain are resolved against the operational `brands`,
 * `kb_product_categories`, and `kb_strains` (alias-aware) master tables. This is
 * the hybrid deterministic+probabilistic entity-resolution pattern that MDM/PIM
 * best practice prescribes, and matches NN/g's rule that variants differing only
 * by a single attribute (size) belong under one listing.
 * See docs/PRODUCT_MASTERING_DESIGN.md for the full grounding + algorithm.
 */

export type MasterCandidateItem = {
  /** Stable POS key (menu_items.source_item_id). */
  key: string;
  name: string;
  brand: string;
  category: string;
  strainName: string | null;
  priceMinor: number;
  /** 7f: adult-use vs medical never marry (regulatory + pricing correctness). */
  medical?: boolean;
};

/**
 * 7f: the backbone-resolved identity for a candidate. Every field falls back to
 * a normalized raw string when the backbone has no row, so resolution degrades
 * gracefully and never blocks a match it could still make by string.
 */
export type ResolvedIdentity = {
  /** Canonical brand slug (`brands`) or normalized brand string fallback. */
  brandIdentity: string;
  /** Category family key (`kb_product_categories.group_key`) or normalized category. */
  categoryFamily: string;
  /** Canonical strain slug (`kb_strains`, alias-aware) or normalized strain/name. */
  strainIdentity: string;
  /** True when strainIdentity came from a curated kb_strains row (higher confidence). */
  strainVerified: boolean;
  /** 'medical' | 'adult'. */
  market: string;
};

/** A resolver that maps a candidate to its backbone identity (injected, testable). */
export type IdentityResolver = (item: MasterCandidateItem) => ResolvedIdentity;

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
 *
 * (Legacy string-based path, retained for compatibility + fallback.)
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

// ===========================================================================
// 7f — backbone-grounded blocking + deterministic grouping
// ===========================================================================

/** The full backbone identity key for a candidate (all four axes). */
export function backboneIdentityKey(id: ResolvedIdentity): string {
  return [id.brandIdentity, id.categoryFamily, id.strainIdentity, id.market].join("|");
}

/** The blocking key (brand-identity + category-family) — cheap partition. */
export function backboneBlockKey(id: ResolvedIdentity): string {
  return [id.brandIdentity, id.categoryFamily].join("|");
}

export type BackboneGroup = {
  items: MasterCandidateItem[];
  identity: ResolvedIdentity;
  /** True when the strain was matched to a curated kb_strains row. */
  strainVerified: boolean;
};

/**
 * BLOCK candidates by brand-identity + category-family (MDM blocking step), then
 * within each block form DETERMINISTIC groups by the full backbone identity
 * (adds canonical strain + market). Returns only groups of 2+ that differ solely
 * by size (i.e. share the backbone identity). Every group carries its resolved
 * identity + whether the strain was verified, so the caller can set confidence.
 *
 * Pure: the resolver is injected. Strict by design — brand, family, canonical
 * strain, and market must ALL match, so different strains or a flower vs a vape
 * can never marry (guards against the expensive false-positive).
 */
export function backboneGroups(
  items: MasterCandidateItem[],
  resolve: IdentityResolver,
): BackboneGroup[] {
  // 1) block by brand + family.
  const blocks = new Map<string, MasterCandidateItem[]>();
  const idCache = new Map<string, ResolvedIdentity>();
  for (const item of items) {
    const id = resolve(item);
    idCache.set(item.key, id);
    const bk = backboneBlockKey(id);
    const list = blocks.get(bk) ?? [];
    list.push(item);
    blocks.set(bk, list);
  }

  // 2) within each block, group by the full identity.
  const groups: BackboneGroup[] = [];
  for (const block of blocks.values()) {
    if (block.length < 2) continue;
    const byIdentity = new Map<string, MasterCandidateItem[]>();
    for (const item of block) {
      const id = idCache.get(item.key)!;
      const ik = backboneIdentityKey(id);
      const list = byIdentity.get(ik) ?? [];
      list.push(item);
      byIdentity.set(ik, list);
    }
    for (const g of byIdentity.values()) {
      if (g.length < 2) continue;
      const id = idCache.get(g[0].key)!;
      groups.push({ items: g, identity: id, strainVerified: id.strainVerified });
    }
  }
  // Largest, highest-impact groups first.
  return groups.sort((a, b) => b.items.length - a.items.length);
}

/** Derive a variant label for a member from its name (e.g. "1g", "3.5g", "10pk"). */
export function deriveVariantLabel(name: string): string | null {
  const m = name.match(/\b(\d+(?:\.\d+)?)\s*(g|mg|gram|grams|oz|ml|pk|pack|ct)\b/i);
  if (!m) return null;
  const unit = m[2].toLowerCase().replace(/grams?/, "g").replace(/pack/, "pk");
  return `${m[1]}${unit}`;
}
