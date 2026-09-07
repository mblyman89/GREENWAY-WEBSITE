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
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The strain-slug normalisation from `product-lookup.ts:139`. */
export function strainSlugOf(strainName: string | null | undefined): string | null {
  if (!strainName) return null;
  const slug = strainName.trim().toLowerCase().replace(/\s+/g, " ");
  return slug.length > 0 ? slug : null;
}

/** The lookup query for one product, mirroring `queryFor()`. */
export type KnowledgeQuery = {
  productName: string;
  brandName?: string | null;
  variantLabel?: string | null;
  posProductKey?: string | null;
  strainName?: string | null;
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
  // ── Rungs 1 & 2: kb_products by composite identity ────────────────────────
  const kbMatch = indexes.kbProducts.get(kbIdentityKey(query));
  if (kbMatch) {
    // `checkProductKnown` calls it "exact" ONLY when published AND active.
    // Anything else present is a draft — staged, usable, flagged.
    const isExact = kbMatch.status === "published" && kbMatch.active;
    return fromKbMatchPure(kbMatch, isExact ? "kb-exact" : "kb-draft");
  }

  // ── Rung 3: product_enrichments by POS key ────────────────────────────────
  if (query.posProductKey) {
    const enrichment = indexes.enrichments.get(query.posProductKey);
    if (enrichment && enrichmentHasContent(enrichment)) {
      return fromEnrichmentPure(enrichment);
    }
  }

  // ── Rung 4: kb_strains by strain slug ─────────────────────────────────────
  const slug = strainSlugOf(query.strainName);
  if (slug) {
    const strain = indexes.strains.get(slug);
    if (strain) return fromStrainPure(strain);
  }

  // ── Rung 5: nothing validated ─────────────────────────────────────────────
  return emptyKnowledge();
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
} {
  const seenIdentity = new Set<string>();
  const identityParts: { brandSlug: string; productSlug: string; variantLabel: string }[] = [];
  const posKeys = new Set<string>();
  const strainSlugs = new Set<string>();

  for (const query of queries) {
    const key = kbIdentityKey(query);
    if (!seenIdentity.has(key)) {
      seenIdentity.add(key);
      identityParts.push(kbIdentityParts(query));
    }
    if (query.posProductKey) posKeys.add(query.posProductKey);
    const slug = strainSlugOf(query.strainName);
    if (slug) strainSlugs.add(slug);
  }

  return {
    identityParts,
    posKeys: [...posKeys],
    strainSlugs: [...strainSlugs],
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

  return { passed, failed };
}
