/**
 * src/lib/ai/kb/product-knowledge-batch-core.ts
 *
 * SLICE C (performance) — THE N+1 FIX, PURE HALF.
 *
 * THE BUG THIS EXISTS TO KILL
 * ───────────────────────────
 * `resolveDisplayKnowledgeMap()` resolved product knowledge with ONE `await`
 * PER PRODUCT, eight at a time:
 *
 *     while (cursor < cannabis.length) {
 *       const item = cannabis[cursor++];
 *       const knowledge = await lookupProductKnowledge(queryFor(item));
 *     }
 *
 * And `lookupProductKnowledge()` is not one query — it is a fall-through ladder
 * of up to FOUR separate round trips per product. At 4,500 products that is up
 * to 18,000 sequential database queries on EVERY menu load. Measured against a
 * realistic 8 ms round trip that is ~18 seconds; cross-region at 60 ms it is
 * ~135 seconds. The owner reported "what feels like over a minute".
 *
 * This is the classic N+1 query problem. Supabase's own best-practice guidance
 * (supabase/agent-skills, `data-n-plus-one.md`) rates the batch-loading fix as
 * "10-100x fewer database round trips". Here it is closer to 400x.
 *
 * WHY A PURE MODULE
 * ─────────────────
 * The dangerous part of this change is NOT the SQL — it is the LADDER
 * PRECEDENCE. If batching quietly reorders the rungs, products start showing
 * the wrong description with no error anywhere. So the precedence lives here,
 * as a pure function over already-fetched lookup maps, where it can be tested
 * exhaustively without a database and proven equivalent to the old per-item
 * path.
 *
 * THE LADDER — UNCHANGED, RUNG FOR RUNG
 * ─────────────────────────────────────
 *   1. kb_products, published + active   → "kb-exact"
 *   2. kb_products, any other status     → "kb-draft"
 *   3. product_enrichments (by pos key)  → "enrichment"   (only if it has content)
 *   4. kb_strains (by strain slug)       → "strain"
 *   5. nothing                           → "none" / needsOnline
 *
 * Only WHERE THE ROWS COME FROM changes: a Map built by one batched query
 * instead of a network call per item. Every conditional below is a direct
 * transcription of `product-lookup.ts` lines 95-181, and
 * `tests/compliance/menu-knowledge-batch.test.ts` asserts the two paths return
 * byte-identical results.
 *
 * PURE: no imports from supabase, no "server-only", no I/O. Unit-testable.
 */

import type { KbProductMatch } from "@/lib/ai/kb/intake";
import type { ProductKnowledge } from "@/lib/ai/kb/product-lookup";
// S24 - read with the SAME identity the writer used (both pure cores).
import {
  identityForLot,
  kbNaturalKeyString,
  variantLabelFromMenuLabel,
} from "@/lib/catalog/product-identity-core";
import { isPromotableLot } from "@/lib/inventory/manifest-kb-bridge-core";
import { dashedSlug, strainSlug as sharedStrainSlug } from "@/lib/catalog/slug-core";

/**
 * Slugify exactly as `checkProductKnown` does (`intake.ts:25-31`).
 *
 * This MUST stay byte-identical to that function. The composite key
 * (brand_slug, product_slug, variant_label) is a UNIQUE INDEX in migration
 * 0071 (`uq_kb_products_identity`); if this slugifier drifts even slightly,
 * batched lookups miss rows the per-item path would have found, and products
 * silently lose their knowledge copy.
 */
export function slugifyDashed(value: string): string {
  return dashedSlug(value);
}

/** The strain-slug normalisation from `product-lookup.ts:139`. */
export function strainSlugOf(strainName: string | null | undefined): string | null {
  if (!strainName) return null;
  const slug = sharedStrainSlug(strainName);
  return slug.length > 0 ? slug : null;
}

/** The lookup query for one product, mirroring `queryFor()`. */
export type KnowledgeQuery = {
  productName: string;
  brandName?: string | null;
  variantLabel?: string | null;
  posProductKey?: string | null;
  strainName?: string | null;
  /**
   * S24 - the card's FIRST menu variant label, raw as published ("3.5g").
   * Canonicalised to the writer's form ("3.5 g") by variantLabelFromMenuLabel
   * for the "menu-variant" rung. Never replaces `variantLabel` (legacy rung).
   */
  menuVariantLabel?: string | null;
  /**
   * S24 - the card's lot keys (vendor-identity-core cardLotKeys: its own key
   * plus each `<lotKey>-onboarded` variant's lot), for the lot rungs.
   */
  lotKeys?: readonly string[] | null;
  /**
   * S20 - the card's product identity in storage form (S03
   * "vendor|category|family", enrichment-identity-core
   * enrichmentIdentityForItem). Used ONLY by rung 3b: when the card's own
   * enrichment row is absent or blank, the PUBLISHED enrichment of the same
   * product (written on an earlier card key) is borrowed. null/blank never
   * matches anything.
   */
  identityKey?: string | null;
};

/**
 * The composite identity key for `kb_products`.
 *
 * `checkProductKnown` defaults a missing brand to "unknown-brand" and a
 * slugified-to-empty product name to "product". Both defaults are reproduced
 * here exactly — dropping them would send different keys to the database than
 * the old path did.
 */
export function kbIdentityParts(query: KnowledgeQuery): {
  brandSlug: string;
  productSlug: string;
  variantLabel: string;
} {
  return {
    brandSlug: query.brandName ? slugifyDashed(query.brandName) : "unknown-brand",
    productSlug: slugifyDashed(query.productName) || "product",
    variantLabel: (query.variantLabel ?? "").trim(),
  };
}

/** A single string key for map lookups, built from the composite identity. */
export function kbIdentityKey(query: KnowledgeQuery): string {
  const { brandSlug, productSlug, variantLabel } = kbIdentityParts(query);
  // Unit separator — cannot appear in a slug, so keys can never collide the way
  // a "-" or "|" joined key could.
  return `${brandSlug}\u001f${productSlug}\u001f${variantLabel}`;
}

/** The `product_enrichments` columns the ladder reads. */
export type EnrichmentRow = {
  pos_product_key: string;
  display_name: string | null;
  description: string | null;
  short_description: string | null;
  image_media_ids: string[] | null;
  primary_media_id: string | null;
};

/** The `kb_strains` columns the ladder reads. */
export type StrainRow = {
  slug: string;
  aroma_notes: string[] | null;
  flavor_notes: string[] | null;
  terpenes: string[] | null;
  summary: string | null;
  effects: string[] | null;
};

/** Everything the batched queries loaded, ready for pure resolution. */
export type KnowledgeIndexes = {
  /** keyed by kbIdentityKey() */
  kbProducts: Map<string, KbProductMatch>;
  /** keyed by pos_product_key */
  enrichments: Map<string, EnrichmentRow>;
  /** keyed by strain slug */
  strains: Map<string, StrainRow>;
  // S24 (optional so every pre-S24 caller and fixture stays valid):
  /** inventory_lots keyed by pos_product_key, each list sorted by lot id. */
  lotsByKey?: Map<string, LotKnowledgeRow[]>;
  /** brands.id -> brands.display_name (what the bridge passes as brandName). */
  brandNames?: Map<string, string>;
  /** kb_products keyed by id (targets of inventory_lots.kb_product_id). */
  kbById?: Map<string, KbProductMatch>;
  // S20 (optional: absent = the flag is off or nothing was loaded = pre-S20):
  /** PUBLISHED product_enrichments keyed by identity_key (survivor per identity). */
  enrichmentsByIdentity?: Map<string, EnrichmentRow>;
};

/**
 * S24 - the inventory_lots columns the lot rungs read. These are exactly
 * the inputs the manifest bridge hands the writer (lotToWritebackFacts):
 * the RAW product_name, the unit weight + uom (deriveVariantLabel) and the
 * brand, plus the S05 link (kb_product_id, 0234) and the promotable gate.
 */
export type LotKnowledgeRow = {
  id: string;
  pos_product_key: string | null;
  product_name: string | null;
  unit_weight: number | null;
  unit_weight_uom: string | null;
  brand_id: string | null;
  /** 0234; null before the migration or when S05 found no KB row. */
  kb_product_id: string | null;
  status: string | null;
  disposition: string | null;
};

/** The empty result — rung 5. Mirrors `product-lookup.ts:78-92`. */
export function emptyKnowledge(): ProductKnowledge {
  return {
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
}

/** Rungs 1 & 2. Transcribed from `fromKbMatch()` (`product-lookup.ts:47-63`). */
export function fromKbMatchPure(
  match: KbProductMatch,
  source: "kb-exact" | "kb-draft",
): ProductKnowledge {
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

/**
 * Decide whether an enrichment row is substantial enough to win rung 3.
 *
 * The old code required description OR short_description OR a non-empty
 * image_media_ids array. An enrichment row that exists but is blank must NOT
 * short-circuit the ladder — the strain rung below it may still have real copy.
 * Getting this wrong is subtle: the page would show nothing instead of the
 * strain summary, and nothing would error.
 */
export function enrichmentHasContent(row: EnrichmentRow): boolean {
  return Boolean(row.description || row.short_description || (row.image_media_ids?.length ?? 0) > 0);
}

/** Rung 3. Transcribed from `product-lookup.ts:110-130`. */
export function fromEnrichmentPure(row: EnrichmentRow): ProductKnowledge {
  const hasImage = Boolean(row.primary_media_id) || ((row.image_media_ids ?? []).length ?? 0) > 0;
  return {
    source: "enrichment",
    displayName: row.display_name ?? null,
    description: row.description ?? null,
    shortDescription: row.short_description ?? null,
    aromaNotes: [],
    flavorNotes: [],
    terpenes: [],
    effects: [],
    imageMediaIds: row.image_media_ids ?? [],
    primaryMediaId: row.primary_media_id ?? null,
    imageHint: hasImage ? "exact" : "substitute",
    needsOnline: false,
  };
}

/** Rung 4. Transcribed from `product-lookup.ts:159-172`. */
export function fromStrainPure(row: StrainRow): ProductKnowledge {
  return {
    source: "strain",
    displayName: null,
    description: row.summary ?? null,
    shortDescription: null,
    aromaNotes: row.aroma_notes ?? [],
    flavorNotes: row.flavor_notes ?? [],
    terpenes: row.terpenes ?? [],
    effects: row.effects ?? [],
    imageMediaIds: [],
    primaryMediaId: null,
    imageHint: "substitute",
    needsOnline: false,
  };
}

/**
 * THE LADDER. Resolve one product's knowledge from already-loaded indexes.
 *
 * This is the whole point of the module: identical precedence to the per-item
 * network version, zero I/O. Every early return below matches a return in
 * `lookupProductKnowledge()`, in the same order, under the same condition.
 */
export function resolveKnowledgeFromIndexes(
  query: KnowledgeQuery,
  indexes: KnowledgeIndexes,
): ProductKnowledge {
  // ── Rungs 1 & 2: kb_products (S24: writer identity first, then the legacy
  //    display-name key - see resolveKbFromIndexes) ───────────────────────
  const kb = resolveKbFromIndexes(query, indexes);
  if (kb) return kb;

  // ── Rung 3: product_enrichments by POS key ────────────────────────────────
  if (query.posProductKey) {
    const enrichment = indexes.enrichments.get(query.posProductKey);
    if (enrichment && enrichmentHasContent(enrichment)) {
      return fromEnrichmentPure(enrichment);
    }
  }

  // ── Rung 3b (S20): the same PRODUCT's published enrichment, by identity ──────
  //    Reached only when the card's own row is absent or blank (Q-03: the
  //    card's own copy always wins). The loader only indexes published rows;
  //    a row for this very card key is skipped (it was already judged above).
  const borrowed = enrichmentByIdentity(query, indexes);
  if (borrowed) return fromEnrichmentPure(borrowed);

  // ── Rung 4: kb_strains by strain slug ─────────────────────────────────────
  const slug = strainSlugOf(query.strainName);
  if (slug) {
    const strain = indexes.strains.get(slug);
    if (strain) return fromStrainPure(strain);
  }

  // ── Rung 5: nothing validated ─────────────────────────────────────────────
  return emptyKnowledge();
}

/** The trimmed identity a query asks with, or null (blank never matches). */
export function queryIdentityKey(query: KnowledgeQuery): string | null {
  const k = typeof query.identityKey === "string" ? query.identityKey.trim() : "";
  return k === "" ? null : k;
}

/**
 * Rung 3b's pick: the identity-indexed published enrichment, when it has
 * content and is not the card's own row. null otherwise (including when the
 * index is absent, i.e. ENRICHMENT_FOLLOWS_IDENTITY=off).
 */
export function enrichmentByIdentity(query: KnowledgeQuery, indexes: KnowledgeIndexes): EnrichmentRow | null {
  const id = queryIdentityKey(query);
  if (!id || !indexes.enrichmentsByIdentity) return null;
  const row = indexes.enrichmentsByIdentity.get(id);
  if (!row || !enrichmentHasContent(row)) return null;
  if (query.posProductKey && row.pos_product_key === query.posProductKey) return null;
  return row;
}

/**
 * Collect the distinct keys a batch of queries needs, so the caller can issue
 * exactly three batched reads instead of 4 x N single-row reads.
 *
 * De-duplicated on purpose: a 4,500-item menu typically has far fewer distinct
 * strains than products, so the strain query shrinks dramatically.
 */
export function collectLookupKeys(queries: readonly KnowledgeQuery[]): {
  identityParts: { brandSlug: string; productSlug: string; variantLabel: string }[];
  posKeys: string[];
  strainSlugs: string[];
  /** S24: every distinct lot key (trimmed, non-empty) across the batch. */
  lotKeys: string[];
  /** S20: every distinct product identity (trimmed, non-empty) across the batch. */
  identityKeys: string[];
} {
  const seenIdentity = new Set<string>();
  const lotKeys = new Set<string>();
  const identityParts: { brandSlug: string; productSlug: string; variantLabel: string }[] = [];
  const posKeys = new Set<string>();
  const strainSlugs = new Set<string>();
  const identityKeys = new Set<string>();

  for (const query of queries) {
    const ik = queryIdentityKey(query);
    if (ik) identityKeys.add(ik);
    const key = kbIdentityKey(query);
    if (!seenIdentity.has(key)) {
      seenIdentity.add(key);
      identityParts.push(kbIdentityParts(query));
    }
    if (query.posProductKey) posKeys.add(query.posProductKey);
    const slug = strainSlugOf(query.strainName);
    if (slug) strainSlugs.add(slug);
    for (const k of query.lotKeys ?? []) {
      const t = typeof k === "string" ? k.trim() : "";
      if (t) lotKeys.add(t);
    }
  }

  return {
    identityParts,
    posKeys: [...posKeys],
    strainSlugs: [...strainSlugs],
    lotKeys: [...lotKeys],
    identityKeys: [...identityKeys],
  };
}

/**
 * Build the kb_products index from fetched rows.
 *
 * IMPORTANT — the rows are fetched by BRAND SLUG (a coarse filter that keeps
 * the query small and index-friendly), so the result set can contain products
 * from a matching brand that are NOT the exact variant we asked for. Keying by
 * the full composite identity here means only a true 3-part match is ever
 * returned, exactly like the old `.eq().eq().eq()` query.
 */
export function indexKbProducts(rows: readonly KbProductMatch[]): Map<string, KbProductMatch> {
  const map = new Map<string, KbProductMatch>();
  for (const row of rows) {
    const key = `${row.brand_slug}\u001f${row.product_slug}\u001f${row.variant_label ?? ""}`;
    // The unique index guarantees one row per identity, but if a duplicate ever
    // appears, prefer a published+active row so a stale draft cannot mask it.
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    const existingExact = existing.status === "published" && existing.active;
    const rowExact = row.status === "published" && row.active;
    if (rowExact && !existingExact) map.set(key, row);
  }
  return map;
}

/** Build the enrichment index, keyed by POS product key. */
export function indexEnrichments(rows: readonly EnrichmentRow[]): Map<string, EnrichmentRow> {
  const map = new Map<string, EnrichmentRow>();
  for (const row of rows) {
    if (row.pos_product_key) map.set(row.pos_product_key, row);
  }
  return map;
}

/** Build the strain index, keyed by slug. */
export function indexStrains(rows: readonly StrainRow[]): Map<string, StrainRow> {
  const map = new Map<string, StrainRow>();
  for (const row of rows) {
    if (row.slug) map.set(row.slug, row);
  }
  return map;
}

// ── S24: the KB rungs read with the identity the writer used ──────────────
//
// F-065: the menu asked kb_products for (brand, DISPLAY name, variant "")
// while the manifest bridge wrote (brand, RAW manifest name, "3.5 g"), so the
// rows it created were unreachable. The candidates, in rung order:
//
//   lot-link      inventory_lots.kb_product_id - the S05 link stamped at
//                 finalize (kb-link-store.ts), for the card's own lots.
//   lot-identity  the natural key rebuilt from the card's lots with S03's
//                 identityForLot - byte-for-byte the key the bridge wrote
//                 (raw product_name, brands.display_name, deriveVariantLabel).
//   menu-variant  the display name + brand + the FIRST menu variant label in
//                 the writer's form (variantLabelFromMenuLabel "3.5g"->"3.5 g").
//   menu          the legacy key (display name, brand, query.variantLabel) -
//                 the ONLY rung before S24, unchanged.
//
// kb_products.identity_key (0234) is NOT a rung: nothing writes it yet, and
// it carries no size, so it could not pick a variant anyway.
//
// NEVER A REGRESSION: a new-rung candidate must be published+active OR carry
// real copy to be eligible. A blank draft the bridge created (name, strain,
// potency - no prose) therefore can never mask the enrichment or strain copy
// a card shows today. The legacy "menu" candidate keeps its old power
// exactly (a blank legacy row still wins, as it always did). Among eligible
// candidates: published+active first, then with-copy, then rung order.

export type KbRung = "lot-link" | "lot-identity" | "menu-variant" | "menu";
export const KB_RUNGS: readonly KbRung[] = ["lot-link", "lot-identity", "menu-variant", "menu"];

export type KbCandidate = { match: KbProductMatch; rung: KbRung };

/** `checkProductKnown` calls it "exact" ONLY when published AND active. */
export function isExactKb(m: KbProductMatch): boolean {
  return m.status === "published" && Boolean(m.active);
}

const nonEmpty = (a: readonly unknown[] | null | undefined) => (a?.length ?? 0) > 0;
const hasText = (v: string | null | undefined) => typeof v === "string" && v.trim().length > 0;

/** Real copy a shopper would see: prose, sensory/effects terms or a photo. */
export function kbMatchHasContent(m: KbProductMatch): boolean {
  return (
    hasText(m.description) ||
    hasText(m.short_description) ||
    nonEmpty(m.aroma_notes) ||
    nonEmpty(m.flavor_notes) ||
    nonEmpty(m.terpenes) ||
    nonEmpty(m.effects) ||
    nonEmpty(m.image_media_ids) ||
    hasText(m.primary_media_id)
  );
}

/**
 * The writer-form variant for the "menu-variant" rung, or null when there is
 * none to try: an uncanonicalisable label ("10pk"), the base variant ("" /
 * "each"), or the same label the legacy rung already asks for.
 */
export function menuVariantIdentityLabel(query: KnowledgeQuery): string | null {
  const c = variantLabelFromMenuLabel(query.menuVariantLabel);
  if (!c || c === (query.variantLabel ?? "").trim()) return null;
  return c;
}

/**
 * The kb_products natural key the manifest bridge wrote for this lot, or
 * null. Mirrors promoteManifestToKb: refused/destroyed lots were never
 * written (isPromotableLot); the brand is brands.display_name when the lot
 * has a brand_id, else "unknown-brand". NEVER GUESS: a lot whose brand_id
 * could not be resolved to a name is skipped - treating it as unbranded
 * would ask for a different product's row.
 */
export function lotKbKey(lot: LotKnowledgeRow, brandNames: ReadonlyMap<string, string>): string | null {
  if (!isPromotableLot(lot.status, lot.disposition)) return null;
  const brandId = typeof lot.brand_id === "string" && lot.brand_id.trim() ? lot.brand_id.trim() : null;
  let brandName: string | null = null;
  if (brandId) {
    const name = brandNames.get(brandId);
    if (name === undefined) return null;
    brandName = name;
  }
  const { kb } = identityForLot(lot, { vendorName: null, brandName, websiteCategory: null });
  return kb ? kbNaturalKeyString(kb) : null;
}

/**
 * The card's lots, in lotKeys order, each key's lots by id (as indexed). A
 * repeated key repeats its lots; kbCandidates dedupes by kb row, so that is
 * harmless and needs no second guard here.
 */
function cardLots(query: KnowledgeQuery, indexes: KnowledgeIndexes): LotKnowledgeRow[] {
  const out: LotKnowledgeRow[] = [];
  if (!indexes.lotsByKey) return out;
  for (const k of query.lotKeys ?? []) {
    // A blank key finds nothing: indexLots never indexes one.
    const key = typeof k === "string" ? k.trim() : "";
    out.push(...(indexes.lotsByKey.get(key) ?? []));
  }
  return out;
}

/** Every kb_products row this card could mean, in rung order, deduped by row. */
export function kbCandidates(query: KnowledgeQuery, indexes: KnowledgeIndexes): KbCandidate[] {
  const out: KbCandidate[] = [];
  const seen = new Set<string>();
  const push = (m: KbProductMatch | undefined, rung: KbRung) => {
    if (!m) return;
    const id = m.id || kbNaturalKeyString({ brand_slug: m.brand_slug, product_slug: m.product_slug, variant_label: m.variant_label ?? "" });
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ match: m, rung });
  };
  const lots = cardLots(query, indexes);
  for (const lot of lots) {
    if (!isPromotableLot(lot.status, lot.disposition)) continue;
    const kbId = typeof lot.kb_product_id === "string" ? lot.kb_product_id.trim() : "";
    if (kbId) push(indexes.kbById?.get(kbId), "lot-link");
  }
  const brandNames = indexes.brandNames ?? new Map<string, string>();
  for (const lot of lots) {
    const k = lotKbKey(lot, brandNames);
    if (k) push(indexes.kbProducts.get(k), "lot-identity");
  }
  const mv = menuVariantIdentityLabel(query);
  if (mv !== null) push(indexes.kbProducts.get(kbIdentityKey({ ...query, variantLabel: mv })), "menu-variant");
  push(indexes.kbProducts.get(kbIdentityKey(query)), "menu");
  return out;
}

/** Pick one candidate (rules in the section header), or null. */
export function pickKbCandidate(cands: readonly KbCandidate[]): KbCandidate | null {
  let best: KbCandidate | null = null;
  for (const c of cands) {
    const eligible = c.rung === "menu" || isExactKb(c.match) || kbMatchHasContent(c.match);
    if (!eligible) continue;
    if (!best) {
      best = c;
      continue;
    }
    const ce = isExactKb(c.match);
    const be = isExactKb(best.match);
    if (ce !== be) {
      if (ce) best = c;
      continue;
    }
    if (kbMatchHasContent(c.match) && !kbMatchHasContent(best.match)) best = c;
  }
  return best;
}

/** Rungs 1 & 2 as one pure step: the picked row as knowledge, or null. */
export function resolveKbFromIndexes(query: KnowledgeQuery, indexes: KnowledgeIndexes): ProductKnowledge | null {
  const picked = pickKbCandidate(kbCandidates(query, indexes));
  if (!picked) return null;
  return fromKbMatchPure(picked.match, isExactKb(picked.match) ? "kb-exact" : "kb-draft");
}

/** Index lots by pos_product_key, each list sorted by id (stable rung order). */
export function indexLots(rows: readonly LotKnowledgeRow[]): Map<string, LotKnowledgeRow[]> {
  const map = new Map<string, LotKnowledgeRow[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = typeof row.pos_product_key === "string" ? row.pos_product_key.trim() : "";
    if (!key || !row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  for (const list of map.values()) list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return map;
}

/** Index kb_products rows by id. */
export function indexKbById(rows: readonly KbProductMatch[]): Map<string, KbProductMatch> {
  const map = new Map<string, KbProductMatch>();
  for (const row of rows) if (row.id) map.set(row.id, row);
  return map;
}

/** brands rows -> id => display_name (blank names are not indexed). */
export function indexBrandNames(rows: readonly { id: string; display_name: string | null }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    const name = typeof r.display_name === "string" ? r.display_name.trim() : "";
    if (r.id && name) map.set(r.id, name);
  }
  return map;
}

/**
 * What the second KB read needs once the lots are in: the linked kb ids, the
 * brand ids to resolve, and the RAW-name product slugs not already loaded
 * (the bridge slugs the raw manifest name, which differs from a mastered
 * display name - F-065 (b)). Only promotable lots count, as for the writer.
 */
export function lotKbReadPlan(
  lotsByKey: ReadonlyMap<string, readonly LotKnowledgeRow[]>,
  loadedProductSlugs: ReadonlySet<string>,
): { kbIds: string[]; brandIds: string[]; productSlugs: string[] } {
  const kbIds = new Set<string>();
  const brandIds = new Set<string>();
  const slugs = new Set<string>();
  for (const list of lotsByKey.values()) {
    for (const lot of list) {
      if (!isPromotableLot(lot.status, lot.disposition)) continue;
      const kbId = typeof lot.kb_product_id === "string" ? lot.kb_product_id.trim() : "";
      if (kbId) kbIds.add(kbId);
      const brandId = typeof lot.brand_id === "string" ? lot.brand_id.trim() : "";
      if (brandId) brandIds.add(brandId);
      const { kb } = identityForLot(lot, { vendorName: null, brandName: null, websiteCategory: null });
      if (kb && !loadedProductSlugs.has(kb.product_slug)) slugs.add(kb.product_slug);
    }
  }
  return { kbIds: [...kbIds], brandIds: [...brandIds], productSlugs: [...slugs] };
}

// ── Self-test ────────────────────────────────────────────────────────────────
export function __runProductKnowledgeBatchTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[kb-batch] FAIL: ${label}`);
    }
  };
  const eq = (label: string, actual: unknown, expected: unknown) =>
    check(`${label} (got ${JSON.stringify(actual)})`, Object.is(actual, expected));

  const kbRow = (over: Partial<KbProductMatch> = {}): KbProductMatch =>
    ({
      id: "kb-1",
      brand_slug: "greenway",
      product_slug: "blue-dream",
      variant_label: "3.5g",
      display_name: "Blue Dream",
      category: "flower",
      aroma_notes: ["berry"],
      flavor_notes: ["sweet"],
      terpenes: ["myrcene"],
      effects: ["relaxed"],
      description: "A KB description.",
      short_description: "KB short.",
      image_media_ids: [],
      primary_media_id: null,
      status: "published",
      active: true,
      ...over,
    }) as KbProductMatch;

  const emptyIdx = (): KnowledgeIndexes => ({
    kbProducts: new Map(),
    enrichments: new Map(),
    strains: new Map(),
  });

  // ── Slugify must match intake.ts byte for byte ────────────────────────────
  eq("slugify lowercases and dashes", slugifyDashed("Blue Dream"), "blue-dream");
  eq("slugify strips punctuation", slugifyDashed("Blue  Dream!! (1g)"), "blue-dream-1g");
  eq("slugify trims leading/trailing dashes", slugifyDashed("  --Blue--  "), "blue");
  eq("slugify handles empty", slugifyDashed(""), "");
  eq("slugify handles only-punctuation", slugifyDashed("!!!"), "");
  eq("slugify collapses runs", slugifyDashed("a___b---c"), "a-b-c");

  // ── Identity defaults must match checkProductKnown exactly ────────────────
  const noBrand = kbIdentityParts({ productName: "Thing" });
  eq("missing brand becomes unknown-brand", noBrand.brandSlug, "unknown-brand");
  const emptyName = kbIdentityParts({ productName: "!!!", brandName: "B" });
  eq("unsluggable product name becomes 'product'", emptyName.productSlug, "product");
  const variant = kbIdentityParts({ productName: "P", variantLabel: "  1g  " });
  eq("variant label is trimmed, not slugified", variant.variantLabel, "1g");
  const noVariant = kbIdentityParts({ productName: "P" });
  eq("missing variant is empty string", noVariant.variantLabel, "");

  // ── Keys cannot collide ───────────────────────────────────────────────────
  check(
    "a dash in one part cannot fake a different identity",
    kbIdentityKey({ productName: "b", brandName: "a-c" }) !==
      kbIdentityKey({ productName: "c", brandName: "a" }),
  );

  // ── RUNG 1: published + active = kb-exact ─────────────────────────────────
  {
    const idx = emptyIdx();
    idx.kbProducts.set(
      kbIdentityKey({ productName: "Blue Dream", brandName: "Greenway", variantLabel: "3.5g" }),
      kbRow(),
    );
    const out = resolveKnowledgeFromIndexes(
      { productName: "Blue Dream", brandName: "Greenway", variantLabel: "3.5g" },
      idx,
    );
    eq("published+active is kb-exact", out.source, "kb-exact");
    eq("kb description travels", out.description, "A KB description.");
    eq("no image ids means substitute hint", out.imageHint, "substitute");
    eq("a KB hit never needs online", out.needsOnline, false);
  }

  // ── RUNG 2: every non-(published+active) combination is kb-draft ──────────
  for (const [label, over] of [
    ["draft status", { status: "draft" }],
    ["published but inactive", { status: "published", active: false }],
    ["draft and inactive", { status: "draft", active: false }],
    ["archived status", { status: "archived" }],
  ] as [string, Partial<KbProductMatch>][]) {
    const idx = emptyIdx();
    idx.kbProducts.set(kbIdentityKey({ productName: "P", brandName: "B" }), kbRow(over));
    const out = resolveKnowledgeFromIndexes({ productName: "P", brandName: "B" }, idx);
    eq(`${label} is kb-draft`, out.source, "kb-draft");
  }

  // ── The KB rung outranks everything below it ──────────────────────────────
  {
    const idx = emptyIdx();
    idx.kbProducts.set(kbIdentityKey({ productName: "P", brandName: "B" }), kbRow());
    idx.enrichments.set("pos-1", {
      pos_product_key: "pos-1",
      display_name: "Enrich",
      description: "Enrichment copy",
      short_description: null,
      image_media_ids: null,
      primary_media_id: null,
    });
    idx.strains.set("blue dream", {
      slug: "blue dream",
      aroma_notes: [],
      flavor_notes: [],
      terpenes: [],
      summary: "Strain copy",
      effects: [],
    });
    const out = resolveKnowledgeFromIndexes(
      { productName: "P", brandName: "B", posProductKey: "pos-1", strainName: "Blue Dream" },
      idx,
    );
    eq("KB beats enrichment AND strain", out.source, "kb-exact");
  }

  // ── RUNG 3: enrichment, and only when it has content ──────────────────────
  {
    const idx = emptyIdx();
    idx.enrichments.set("pos-1", {
      pos_product_key: "pos-1",
      display_name: "Enrich",
      description: "Enrichment copy",
      short_description: null,
      image_media_ids: null,
      primary_media_id: null,
    });
    const out = resolveKnowledgeFromIndexes(
      { productName: "P", brandName: "B", posProductKey: "pos-1" },
      idx,
    );
    eq("enrichment with a description wins rung 3", out.source, "enrichment");
    eq("enrichment copy travels", out.description, "Enrichment copy");
  }
  {
    // A BLANK enrichment row must NOT short-circuit the strain rung below it.
    const idx = emptyIdx();
    idx.enrichments.set("pos-1", {
      pos_product_key: "pos-1",
      display_name: "Name only",
      description: null,
      short_description: null,
      image_media_ids: [],
      primary_media_id: null,
    });
    idx.strains.set("blue dream", {
      slug: "blue dream",
      aroma_notes: ["berry"],
      flavor_notes: [],
      terpenes: [],
      summary: "Strain copy",
      effects: [],
    });
    const out = resolveKnowledgeFromIndexes(
      { productName: "P", brandName: "B", posProductKey: "pos-1", strainName: "Blue Dream" },
      idx,
    );
    eq("a blank enrichment falls through to strain", out.source, "strain");
    eq("...and the strain copy is used", out.description, "Strain copy");
  }
  {
    // image_media_ids alone IS content.
    const idx = emptyIdx();
    idx.enrichments.set("pos-1", {
      pos_product_key: "pos-1",
      display_name: null,
      description: null,
      short_description: null,
      image_media_ids: ["m1"],
      primary_media_id: null,
    });
    const out = resolveKnowledgeFromIndexes({ productName: "P", posProductKey: "pos-1" }, idx);
    eq("images alone qualify as enrichment content", out.source, "enrichment");
    eq("...and the image hint is exact", out.imageHint, "exact");
  }
  {
    // No POS key means the enrichment rung is skipped entirely.
    const idx = emptyIdx();
    idx.enrichments.set("pos-1", {
      pos_product_key: "pos-1",
      display_name: null,
      description: "Copy",
      short_description: null,
      image_media_ids: null,
      primary_media_id: null,
    });
    const out = resolveKnowledgeFromIndexes({ productName: "P" }, idx);
    eq("without a pos key the enrichment rung is skipped", out.source, "none");
  }

  // ── RUNG 4: strain ────────────────────────────────────────────────────────
  {
    const idx = emptyIdx();
    idx.strains.set("blue dream", {
      slug: "blue dream",
      aroma_notes: ["berry"],
      flavor_notes: ["sweet"],
      terpenes: ["myrcene"],
      summary: "Strain summary",
      effects: ["happy"],
    });
    const out = resolveKnowledgeFromIndexes(
      { productName: "P", strainName: "  Blue   Dream  " },
      idx,
    );
    eq("strain slug normalises whitespace and case", out.source, "strain");
    eq("strain summary becomes the description", out.description, "Strain summary");
    eq("strain effects travel", out.effects.join(","), "happy");
    eq("strain never provides its own image", out.imageHint, "substitute");
    eq("a strain hit does not need online", out.needsOnline, false);
  }
  {
    // A strain row with null arrays must not produce undefined.
    const idx = emptyIdx();
    idx.strains.set("x", {
      slug: "x",
      aroma_notes: null,
      flavor_notes: null,
      terpenes: null,
      summary: null,
      effects: null,
    });
    const out = resolveKnowledgeFromIndexes({ productName: "P", strainName: "X" }, idx);
    check("null strain arrays become empty arrays", Array.isArray(out.effects) && out.effects.length === 0);
    eq("null summary becomes null description", out.description, null);
  }

  // ── RUNG 5: nothing ───────────────────────────────────────────────────────
  {
    const out = resolveKnowledgeFromIndexes({ productName: "Unknown" }, emptyIdx());
    eq("no match at all is 'none'", out.source, "none");
    eq("...and needs online", out.needsOnline, true);
    eq("...with an online image hint", out.imageHint, "online");
    check("...and empty arrays, never undefined", out.terpenes.length === 0 && out.effects.length === 0);
  }
  {
    // A strain NAME with no matching row must still fall to none.
    const out = resolveKnowledgeFromIndexes(
      { productName: "P", strainName: "Nonexistent" },
      emptyIdx(),
    );
    eq("an unmatched strain name falls to none", out.source, "none");
  }

  // ── Key collection de-duplicates ──────────────────────────────────────────
  {
    const keys = collectLookupKeys([
      { productName: "A", brandName: "B", posProductKey: "p1", strainName: "Blue Dream" },
      { productName: "A", brandName: "B", posProductKey: "p2", strainName: "Blue Dream" },
      { productName: "C", brandName: "B", posProductKey: "p3", strainName: "OG Kush" },
      { productName: "C", brandName: "B", posProductKey: "p3", strainName: "OG Kush" },
    ]);
    eq("identical identities collapse", keys.identityParts.length, 2);
    eq("pos keys de-duplicate", keys.posKeys.length, 3);
    eq("strain slugs de-duplicate", keys.strainSlugs.length, 2);
  }
  {
    const keys = collectLookupKeys([{ productName: "A" }, { productName: "B" }]);
    eq("no pos keys when absent", keys.posKeys.length, 0);
    eq("no strain slugs when absent", keys.strainSlugs.length, 0);
  }

  // ── Indexing ──────────────────────────────────────────────────────────────
  {
    // Rows arrive filtered by brand only, so non-matching variants ride along.
    const rows = [
      kbRow({ product_slug: "blue-dream", variant_label: "3.5g" }),
      kbRow({ product_slug: "blue-dream", variant_label: "7g", description: "Seven grams" }),
      kbRow({ product_slug: "og-kush", variant_label: "3.5g" }),
    ];
    const idx = indexKbProducts(rows);
    eq("every distinct identity is indexed", idx.size, 3);
    const hit = idx.get(
      kbIdentityKey({ productName: "Blue Dream", brandName: "Greenway", variantLabel: "7g" }),
    );
    eq("the correct variant is retrieved", hit?.description, "Seven grams");
    const miss = idx.get(
      kbIdentityKey({ productName: "Blue Dream", brandName: "Greenway", variantLabel: "28g" }),
    );
    check("a variant that was not published is NOT matched", miss === undefined);
  }
  {
    // Defensive: if a duplicate identity ever appears, published+active wins.
    const idx = indexKbProducts([
      kbRow({ status: "draft", description: "draft copy" }),
      kbRow({ status: "published", active: true, description: "published copy" }),
    ]);
    eq("published beats draft on duplicate identity", idx.size, 1);
    eq(
      "...and the published row is the one kept",
      [...idx.values()][0]!.description,
      "published copy",
    );
  }
  {
    const idx = indexKbProducts([
      kbRow({ status: "published", active: true, description: "published copy" }),
      kbRow({ status: "draft", description: "draft copy" }),
    ]);
    eq(
      "order does not matter — published still wins",
      [...idx.values()][0]!.description,
      "published copy",
    );
  }
  {
    const idx = indexEnrichments([
      { pos_product_key: "a", display_name: null, description: "x", short_description: null, image_media_ids: null, primary_media_id: null },
      { pos_product_key: "", display_name: null, description: "y", short_description: null, image_media_ids: null, primary_media_id: null },
    ]);
    eq("blank pos keys are not indexed", idx.size, 1);
  }
  {
    const idx = indexStrains([
      { slug: "a", aroma_notes: null, flavor_notes: null, terpenes: null, summary: null, effects: null },
      { slug: "", aroma_notes: null, flavor_notes: null, terpenes: null, summary: null, effects: null },
    ]);
    eq("blank strain slugs are not indexed", idx.size, 1);
  }

  // ── Shape parity: every rung returns the full ProductKnowledge shape ──────
  {
    const idx = emptyIdx();
    idx.kbProducts.set(kbIdentityKey({ productName: "P", brandName: "B" }), kbRow());
    const shapes = [
      resolveKnowledgeFromIndexes({ productName: "P", brandName: "B" }, idx),
      fromEnrichmentPure({
        pos_product_key: "k",
        display_name: null,
        description: "d",
        short_description: null,
        image_media_ids: null,
        primary_media_id: null,
      }),
      fromStrainPure({
        slug: "s",
        aroma_notes: null,
        flavor_notes: null,
        terpenes: null,
        summary: null,
        effects: null,
      }),
      emptyKnowledge(),
    ];
    const expectedKeys = Object.keys(emptyKnowledge()).sort().join(",");
    check(
      "every rung returns exactly the same field set",
      shapes.every((s) => Object.keys(s).sort().join(",") === expectedKeys),
    );
    check(
      "no rung ever returns undefined for an array field",
      shapes.every(
        (s) =>
          Array.isArray(s.aromaNotes) &&
          Array.isArray(s.flavorNotes) &&
          Array.isArray(s.terpenes) &&
          Array.isArray(s.effects) &&
          Array.isArray(s.imageMediaIds),
      ),
    );
  }


  // ── S24: the KB rungs read with the identity the writer used ──────────
  const lot = (over: Partial<LotKnowledgeRow> = {}): LotKnowledgeRow => ({
    id: "lot-1",
    pos_product_key: "pos-1",
    product_name: "GW - Blue Dream Flower 3.5g",
    unit_weight: 3.5,
    unit_weight_uom: "g",
    brand_id: "brand-1",
    kb_product_id: null,
    status: "received",
    disposition: null,
    ...over,
  });
  const blankDraft = (over: Partial<KbProductMatch> = {}): KbProductMatch =>
    kbRow({
      aroma_notes: [],
      flavor_notes: [],
      terpenes: [],
      effects: [],
      description: null,
      short_description: null,
      image_media_ids: [],
      primary_media_id: null,
      status: "draft",
      active: true,
      ...over,
    });
  const enrich = (): EnrichmentRow => ({
    pos_product_key: "pos-1",
    display_name: "Enrich",
    description: "Enrichment copy",
    short_description: null,
    image_media_ids: null,
    primary_media_id: null,
  });
  // The mastered display name differs from the raw manifest name (F-065 b).
  const mastered: KnowledgeQuery = {
    productName: "Blue Dream",
    brandName: "Greenway",
    posProductKey: "pos-1",
    menuVariantLabel: "3.5g",
    lotKeys: ["pos-1"],
  };
  // The key promoteManifestToKb -> writeBackProductFacts wrote for lot().
  const bridgedKey = `greenway\u001fgw-blue-dream-flower-3-5g\u001f3.5 g`;
  const s24Idx = (): KnowledgeIndexes => ({
    ...emptyIdx(),
    lotsByKey: indexLots([lot()]),
    brandNames: indexBrandNames([{ id: "brand-1", display_name: "Greenway" }]),
    kbById: new Map(),
  });

  // Writer parity: lotKbKey is byte-for-byte the bridge's natural key.
  eq("lotKbKey = the bridge's key (raw name, display brand, '3.5 g')", lotKbKey(lot(), s24Idx().brandNames!), bridgedKey);
  eq("lotKbKey: no brand_id -> unknown-brand", lotKbKey(lot({ brand_id: null }), new Map()), `unknown-brand\u001fgw-blue-dream-flower-3-5g\u001f3.5 g`);
  eq("lotKbKey: blank brand_id -> unknown-brand", lotKbKey(lot({ brand_id: "  " }), new Map()), `unknown-brand\u001fgw-blue-dream-flower-3-5g\u001f3.5 g`);
  eq("lotKbKey: unresolved brand_id is skipped (never guess)", lotKbKey(lot(), new Map()), null);
  eq("lotKbKey: brand_id trimmed before lookup", lotKbKey(lot({ brand_id: " brand-1 " }), s24Idx().brandNames!), bridgedKey);
  eq("lotKbKey: rejected lot never written", lotKbKey(lot({ status: "rejected" }), s24Idx().brandNames!), null);
  eq("lotKbKey: destroyed lot never written", lotKbKey(lot({ status: "Destroyed" }), s24Idx().brandNames!), null);
  eq("lotKbKey: rejected_at_dock never written", lotKbKey(lot({ disposition: "rejected_at_dock" }), s24Idx().brandNames!), null);
  eq("lotKbKey: nameless lot has no KB key", lotKbKey(lot({ product_name: "  " }), s24Idx().brandNames!), null);
  eq("lotKbKey: no weight -> base variant ''", lotKbKey(lot({ unit_weight: null }), s24Idx().brandNames!), `greenway\u001fgw-blue-dream-flower-3-5g\u001f`);

  // THE BIBLE FIXTURE: a bridged row (variant '3.5 g', raw-name slug) is
  // found for a mastered display-name item.
  {
    const idx = s24Idx();
    idx.kbProducts.set(bridgedKey, kbRow({ id: "kb-bridged", product_slug: "gw-blue-dream-flower-3-5g", variant_label: "3.5 g", status: "draft", description: "Bridged copy." }));
    const out = resolveKnowledgeFromIndexes(mastered, idx);
    eq("bible fixture: bridged row found via lot-identity", out.description, "Bridged copy.");
    eq("bible fixture: a draft stays kb-draft", out.source, "kb-draft");
    eq("bible fixture: rung is lot-identity", pickKbCandidate(kbCandidates(mastered, idx))?.rung, "lot-identity");
    // Pre-S24 (no lot keys, no menu variant) the same index misses it.
    eq("pre-S24 query still misses it (legacy key unchanged)", resolveKnowledgeFromIndexes({ productName: "Blue Dream", brandName: "Greenway" }, idx).source, "none");
  }

  // lot-link: the S05 kb_product_id wins the rung order.
  {
    const idx = s24Idx();
    idx.lotsByKey = indexLots([lot({ kb_product_id: " kb-linked " })]);
    idx.kbById = indexKbById([kbRow({ id: "kb-linked", description: "Linked copy." })]);
    idx.kbProducts.set(bridgedKey, kbRow({ id: "kb-bridged", description: "Bridged copy." }));
    const c = kbCandidates(mastered, idx);
    eq("lot-link is first candidate", c[0]?.rung, "lot-link");
    eq("lot-link id trimmed", c[0]?.match.id, "kb-linked");
    eq("lot-link then lot-identity", c[1]?.rung, "lot-identity");
    eq("lot-link wins a tie", resolveKnowledgeFromIndexes(mastered, idx).description, "Linked copy.");
  }
  // lot-link of a refused lot is ignored.
  {
    const idx = s24Idx();
    idx.lotsByKey = indexLots([lot({ kb_product_id: "kb-linked", status: "rejected" })]);
    idx.kbById = indexKbById([kbRow({ id: "kb-linked" })]);
    eq("refused lot's link ignored", kbCandidates(mastered, idx).length, 0);
  }
  // Duplicate row across rungs is listed once, at its earliest rung.
  {
    const idx = s24Idx();
    const row = kbRow({ id: "kb-same" });
    idx.lotsByKey = indexLots([lot({ kb_product_id: "kb-same" })]);
    idx.kbById = indexKbById([row]);
    idx.kbProducts.set(bridgedKey, row);
    const c = kbCandidates(mastered, idx);
    eq("dedupe by id: one candidate", c.length, 1);
    eq("dedupe keeps earliest rung", c[0]?.rung, "lot-link");
  }

  // menu-variant: "3.5g" asks for the writer's "3.5 g".
  {
    const idx = emptyIdx();
    idx.kbProducts.set(kbIdentityKey({ productName: "Blue Dream", brandName: "Greenway", variantLabel: "3.5 g" }), kbRow({ id: "kb-mv", description: "MV copy." }));
    const q: KnowledgeQuery = { productName: "Blue Dream", brandName: "Greenway", menuVariantLabel: "3.5g" };
    eq("menu-variant rung finds '3.5 g'", resolveKnowledgeFromIndexes(q, idx).description, "MV copy.");
    eq("menu-variant rung name", kbCandidates(q, idx)[0]?.rung, "menu-variant");
  }
  eq("menuVariantIdentityLabel canonicalises", menuVariantIdentityLabel({ productName: "x", menuVariantLabel: "3.5g" }), "3.5 g");
  eq("menuVariantIdentityLabel: base '' -> null", menuVariantIdentityLabel({ productName: "x", menuVariantLabel: "" }), null);
  eq("menuVariantIdentityLabel: each -> null", menuVariantIdentityLabel({ productName: "x", menuVariantLabel: "each" }), null);
  eq("menuVariantIdentityLabel: 10pk -> null", menuVariantIdentityLabel({ productName: "x", menuVariantLabel: "10pk" }), null);
  eq("menuVariantIdentityLabel: absent -> null", menuVariantIdentityLabel({ productName: "x" }), null);
  eq("menuVariantIdentityLabel: same as legacy -> null", menuVariantIdentityLabel({ productName: "x", variantLabel: " 3.5 g ", menuVariantLabel: "3.5g" }), null);
  eq("menuVariantIdentityLabel: base vs other legacy -> null", menuVariantIdentityLabel({ productName: "x", variantLabel: "1 g", menuVariantLabel: "each" }), null);
  eq("menuVariantIdentityLabel: 10pk vs other legacy -> null", menuVariantIdentityLabel({ productName: "x", variantLabel: "1 g", menuVariantLabel: "10pk" }), null);
  eq("menuVariantIdentityLabel: differs from legacy", menuVariantIdentityLabel({ productName: "x", variantLabel: "1 g", menuVariantLabel: "3.5g" }), "3.5 g");

  // NEVER A REGRESSION: a blank bridged draft cannot mask enrichment copy.
  {
    const idx = s24Idx();
    idx.kbProducts.set(bridgedKey, blankDraft({ id: "kb-blank" }));
    idx.enrichments.set("pos-1", enrich());
    const out = resolveKnowledgeFromIndexes(mastered, idx);
    eq("blank bridged draft does not mask enrichment", out.source, "enrichment");
    eq("blank draft from new rung is not eligible", pickKbCandidate(kbCandidates(mastered, idx)), null);
  }
  // ...but a blank PUBLISHED+active new-rung row is exact and eligible.
  {
    const idx = s24Idx();
    idx.kbProducts.set(bridgedKey, blankDraft({ id: "kb-pub", status: "published" }));
    idx.enrichments.set("pos-1", enrich());
    eq("published+active new-rung row eligible", resolveKnowledgeFromIndexes(mastered, idx).source, "kb-exact");
  }
  // A published-but-inactive blank row is NOT exact and has no copy.
  {
    const idx = s24Idx();
    idx.kbProducts.set(bridgedKey, blankDraft({ id: "kb-off", status: "published", active: false }));
    idx.enrichments.set("pos-1", enrich());
    eq("inactive blank new-rung row not eligible", resolveKnowledgeFromIndexes(mastered, idx).source, "enrichment");
  }
  // The legacy rung keeps its old power: a blank legacy draft still wins.
  {
    const idx = emptyIdx();
    idx.kbProducts.set(kbIdentityKey({ productName: "P", brandName: "B" }), blankDraft());
    idx.enrichments.set("pos-1", enrich());
    eq("blank legacy draft still wins (unchanged)", resolveKnowledgeFromIndexes({ productName: "P", brandName: "B", posProductKey: "pos-1" }, idx).source, "kb-draft");
  }
  // Published beats draft, whatever the rung order.
  {
    const idx = s24Idx();
    idx.kbProducts.set(bridgedKey, kbRow({ id: "kb-draft", status: "draft", description: "Draft copy." }));
    idx.kbProducts.set(kbIdentityKey({ productName: "Blue Dream", brandName: "Greenway" }), kbRow({ id: "kb-pub", description: "Published copy." }));
    const out = resolveKnowledgeFromIndexes(mastered, idx);
    eq("published legacy beats earlier draft", out.description, "Published copy.");
    eq("published is kb-exact", out.source, "kb-exact");
  }
  // Earlier exact is not displaced by a later exact.
  {
    const idx = s24Idx();
    idx.kbProducts.set(bridgedKey, kbRow({ id: "kb-a", description: "A." }));
    idx.kbProducts.set(kbIdentityKey({ productName: "Blue Dream", brandName: "Greenway" }), kbRow({ id: "kb-b", description: "B." }));
    eq("two exact: rung order decides", resolveKnowledgeFromIndexes(mastered, idx).description, "A.");
  }
  // Earlier draft-with-copy beats a later blank legacy draft.
  {
    const idx = s24Idx();
    idx.kbProducts.set(bridgedKey, kbRow({ id: "kb-a", status: "draft", description: "Copy." }));
    idx.kbProducts.set(kbIdentityKey({ productName: "Blue Dream", brandName: "Greenway" }), blankDraft({ id: "kb-b" }));
    eq("draft with copy beats blank legacy draft", resolveKnowledgeFromIndexes(mastered, idx).description, "Copy.");
  }
  // A later draft-with-copy displaces an earlier blank (legacy) draft.
  {
    const cands: KbCandidate[] = [
      { match: blankDraft({ id: "x" }), rung: "menu" },
      { match: kbRow({ id: "y", status: "draft" }), rung: "menu" },
    ];
    eq("later copy displaces earlier blank", pickKbCandidate(cands)?.match.id, "y");
    const cands2: KbCandidate[] = [
      { match: kbRow({ id: "x", status: "draft", description: "1" }), rung: "menu" },
      { match: kbRow({ id: "y", status: "draft", description: "2" }), rung: "menu" },
    ];
    eq("two drafts with copy: earlier kept", pickKbCandidate(cands2)?.match.id, "x");
    const cands3: KbCandidate[] = [
      { match: kbRow({ id: "x" }), rung: "lot-link" },
      { match: kbRow({ id: "y", status: "draft" }), rung: "menu" },
    ];
    eq("exact then draft: exact kept", pickKbCandidate(cands3)?.match.id, "x");
    eq("no candidates -> null", pickKbCandidate([]), null);
  }
  // kbMatchHasContent: every copy field counts; whitespace does not.
  {
    const b = blankDraft();
    check("blank draft has no content", !kbMatchHasContent(b));
    check("whitespace description is not content", !kbMatchHasContent({ ...b, description: "  ", short_description: " " }));
    check("description counts", kbMatchHasContent({ ...b, description: "d" }));
    check("short_description counts", kbMatchHasContent({ ...b, short_description: "s" }));
    check("aroma counts", kbMatchHasContent({ ...b, aroma_notes: ["a"] }));
    check("flavor counts", kbMatchHasContent({ ...b, flavor_notes: ["f"] }));
    check("terpenes count", kbMatchHasContent({ ...b, terpenes: ["t"] }));
    check("effects count", kbMatchHasContent({ ...b, effects: ["e"] }));
    check("images count", kbMatchHasContent({ ...b, image_media_ids: ["m"] }));
    check("primary media counts", kbMatchHasContent({ ...b, primary_media_id: "m" }));
    check("null arrays tolerated", !kbMatchHasContent({ ...b, aroma_notes: null as unknown as string[] }));
    check("isExactKb needs published", !isExactKb(kbRow({ status: "draft" })));
    check("isExactKb needs active", !isExactKb(kbRow({ active: false })));
    check("isExactKb published+active", isExactKb(kbRow()));
  }
  // Lot keys: onboarded variant lots count; blanks and dupes ignored.
  {
    const idx = s24Idx();
    idx.lotsByKey = indexLots([lot({ id: "lot-2", pos_product_key: "pos-1-onboarded-x" })]);
    idx.kbProducts.set(bridgedKey, kbRow({ id: "kb-bridged", description: "Bridged copy." }));
    const q = { ...mastered, lotKeys: [" ", "pos-1", " pos-1-onboarded-x ", "pos-1-onboarded-x"] };
    eq("onboarded variant lot resolves", resolveKnowledgeFromIndexes(q, idx).description, "Bridged copy.");
    eq("no lotsByKey -> no lot candidates", kbCandidates(mastered, { ...emptyIdx(), kbProducts: idx.kbProducts }).length, 0);
    eq("padded lot key alone resolves", resolveKnowledgeFromIndexes({ ...mastered, lotKeys: [" pos-1-onboarded-x "] }, idx).description, "Bridged copy.");
    eq("lotKeys null tolerated", kbCandidates({ ...mastered, lotKeys: null }, idx).length, 0);
  }
  // Two lots of one card, one refused: only the promotable one reads.
  {
    const idx = s24Idx();
    idx.lotsByKey = indexLots([
      lot({ id: "lot-a", status: "rejected", product_name: "Other Name" }),
      lot({ id: "lot-b" }),
    ]);
    idx.kbProducts.set(`greenway\u001fother-name\u001f3.5 g`, kbRow({ id: "kb-other", description: "Wrong." }));
    idx.kbProducts.set(bridgedKey, kbRow({ id: "kb-bridged", description: "Right." }));
    eq("refused lot's identity skipped", resolveKnowledgeFromIndexes(mastered, idx).description, "Right.");
  }
  // indexLots: keyed by trimmed pos key, sorted by id, deduped, blanks out.
  {
    const m = indexLots([
      lot({ id: "b" }),
      lot({ id: "a", pos_product_key: " pos-1 " }),
      lot({ id: "b" }),
      lot({ id: "c", pos_product_key: null }),
      lot({ id: "", pos_product_key: "pos-9" }),
      lot({ id: "d", pos_product_key: "  " }),
    ]);
    eq("indexLots: one key", m.size, 1);
    eq("indexLots: sorted + deduped", (m.get("pos-1") ?? []).map((l) => l.id).join(","), "a,b");
    const m2 = indexLots([lot({ id: "a" }), lot({ id: "c" }), lot({ id: "b" })]);
    eq("indexLots: sort is total", (m2.get("pos-1") ?? []).map((l) => l.id).join(","), "a,b,c");
  }
  eq("indexKbById skips blank id", indexKbById([kbRow({ id: "" }), kbRow({ id: "k" })]).size, 1);
  {
    const m = indexBrandNames([
      { id: "a", display_name: " Greenway " },
      { id: "b", display_name: "  " },
      { id: "c", display_name: null },
      { id: "", display_name: "X" },
    ]);
    eq("indexBrandNames trims", m.get("a"), "Greenway");
    eq("indexBrandNames skips blank/null/idless", m.size, 1);
  }
  // lotKbReadPlan: what the second read must fetch.
  {
    const plan = lotKbReadPlan(
      indexLots([
        lot({ id: "1", kb_product_id: " kb-9 " }),
        lot({ id: "2", brand_id: null, product_name: "Blue Dream" }),
        lot({ id: "3", status: "destroyed", kb_product_id: "kb-x", brand_id: "brand-x", product_name: "Nope" }),
        lot({ id: "4", product_name: null, brand_id: " brand-2 " }),
      ]),
      new Set(["blue-dream"]),
    );
    eq("plan kbIds (trimmed, promotable only)", plan.kbIds.join(","), "kb-9");
    eq("plan brandIds (trimmed, promotable only)", plan.brandIds.join(","), "brand-1,brand-2");
    eq("plan productSlugs (raw name, not already loaded)", plan.productSlugs.join(","), "gw-blue-dream-flower-3-5g");
  }
  // collectLookupKeys gathers lot keys (trimmed, deduped).
  eq(
    "collectLookupKeys lotKeys",
    collectLookupKeys([
      { productName: "a", lotKeys: [" k1 ", "k2"] },
      { productName: "b", lotKeys: ["k1", "", null as unknown as string] },
      { productName: "c" },
    ]).lotKeys.join(","),
    "k1,k2",
  );
  eq("KB_RUNGS order", KB_RUNGS.join(","), "lot-link,lot-identity,menu-variant,menu");

  // ── S20: rung 3b, enrichment by product identity ───────────────────────────────
  {
    const enr = (key: string, description: string | null, extra: Partial<EnrichmentRow> = {}): EnrichmentRow => ({
      pos_product_key: key,
      display_name: null,
      description,
      short_description: null,
      image_media_ids: null,
      primary_media_id: null,
      ...extra,
    });
    const ID = "vendor-a|flower|blue-dream";
    const withIdentity = (): KnowledgeIndexes => {
      const idx = emptyIdx();
      idx.enrichmentsByIdentity = new Map([[ID, enr("pos-old", "Old card copy")]]);
      return idx;
    };
    // Own row absent -> borrow by identity.
    {
      const out = resolveKnowledgeFromIndexes({ productName: "P", posProductKey: "lot-new", identityKey: ID }, withIdentity());
      eq("S20 own absent -> identity source", out.source, "enrichment");
      eq("S20 own absent -> identity copy", out.description, "Old card copy");
    }
    // Own row blank -> borrow.
    {
      const idx = withIdentity();
      idx.enrichments.set("lot-new", enr("lot-new", null));
      const out = resolveKnowledgeFromIndexes({ productName: "P", posProductKey: "lot-new", identityKey: ID }, idx);
      eq("S20 own blank -> identity copy", out.description, "Old card copy");
    }
    // Own row with content wins (Q-03).
    {
      const idx = withIdentity();
      idx.enrichments.set("lot-new", enr("lot-new", "Own copy"));
      const out = resolveKnowledgeFromIndexes({ productName: "P", posProductKey: "lot-new", identityKey: ID }, idx);
      eq("S20 own content wins over identity", out.description, "Own copy");
    }
    // Identity key trimmed.
    {
      const out = resolveKnowledgeFromIndexes({ productName: "P", posProductKey: "lot-new", identityKey: `  ${ID} ` }, withIdentity());
      eq("S20 identity key trimmed", out.description, "Old card copy");
    }
    // Blank / null / missing identity never matches (even a "" index entry).
    {
      const idx = withIdentity();
      idx.enrichmentsByIdentity!.set("", enr("pos-x", "Wildcard"));
      eq("S20 blank identity never matches", resolveKnowledgeFromIndexes({ productName: "P", posProductKey: "k", identityKey: "  " }, idx).source, "none");
      eq("S20 null identity never matches", resolveKnowledgeFromIndexes({ productName: "P", posProductKey: "k", identityKey: null }, idx).source, "none");
      eq("S20 missing identity never matches", resolveKnowledgeFromIndexes({ productName: "P", posProductKey: "k" }, idx).source, "none");
    }
    // No index (flag off) -> pre-S20 behaviour.
    {
      const out = resolveKnowledgeFromIndexes({ productName: "P", posProductKey: "lot-new", identityKey: ID }, emptyIdx());
      eq("S20 no identity index -> none", out.source, "none");
    }
    // Identity row with no content does not win; strain below still can.
    {
      const idx = emptyIdx();
      idx.enrichmentsByIdentity = new Map([[ID, enr("pos-old", null)]]);
      idx.strains.set("blue dream", { slug: "blue dream", aroma_notes: null, flavor_notes: null, terpenes: null, summary: "Strain s", effects: null });
      const out = resolveKnowledgeFromIndexes({ productName: "P", posProductKey: "lot-new", identityKey: ID, strainName: "Blue Dream" }, idx);
      eq("S20 blank identity row falls to strain", out.source, "strain");
    }
    // Image-only identity row counts as content.
    {
      const idx = emptyIdx();
      idx.enrichmentsByIdentity = new Map([[ID, enr("pos-old", null, { image_media_ids: ["m1"] })]]);
      const out = resolveKnowledgeFromIndexes({ productName: "P", posProductKey: "lot-new", identityKey: ID }, idx);
      eq("S20 image-only identity row borrowed", out.imageMediaIds.join(","), "m1");
    }
    // The identity survivor IS the card's own (blank) row -> not re-borrowed.
    {
      const idx = emptyIdx();
      idx.enrichmentsByIdentity = new Map([[ID, enr("lot-new", "x")]]);
      idx.enrichments.set("lot-new", enr("lot-new", null));
      const out = resolveKnowledgeFromIndexes({ productName: "P", posProductKey: "lot-new", identityKey: ID }, idx);
      eq("S20 own row via identity is not re-borrowed", out.source, "none");
    }
    // Works without a pos key (identity alone).
    {
      const out = resolveKnowledgeFromIndexes({ productName: "P", identityKey: ID }, withIdentity());
      eq("S20 identity without pos key", out.description, "Old card copy");
    }
    // KB still outranks the borrowed enrichment (S24 order unchanged).
    {
      const idx = withIdentity();
      idx.kbProducts.set(kbIdentityKey({ productName: "Blue Dream", brandName: "Greenway", variantLabel: "3.5g" }), kbRow());
      const out = resolveKnowledgeFromIndexes({ productName: "Blue Dream", brandName: "Greenway", variantLabel: "3.5g", posProductKey: "lot-new", identityKey: ID }, idx);
      check("S20 kb still outranks identity enrichment", out.source === "kb-exact" || out.source === "kb-draft");
    }
    // collectLookupKeys gathers identities (trimmed, deduped, blanks dropped).
    eq(
      "S20 collectLookupKeys identityKeys",
      collectLookupKeys([
        { productName: "a", identityKey: ` ${ID} ` },
        { productName: "b", identityKey: ID },
        { productName: "c", identityKey: "" },
        { productName: "d", identityKey: null },
        { productName: "e" },
        { productName: "f", identityKey: "v|edible|gummy" },
      ]).identityKeys.join(","),
      `${ID},v|edible|gummy`,
    );
    eq("S20 queryIdentityKey blank -> null", queryIdentityKey({ productName: "p", identityKey: " " }), null);
  }

  return { passed, failed };
}
