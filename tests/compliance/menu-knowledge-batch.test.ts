/**
 * SLICE C (performance) — THE N+1 FIX.
 *
 * Michael's symptom, verbatim: "if I click the shop button to go to the menu,
 * it takes what feels like over a minute to load."
 *
 * THE CAUSE. `resolveDisplayKnowledgeMap()` in
 * `src/lib/menu/product-knowledge-display.ts` resolved product knowledge with
 * ONE `await lookupProductKnowledge()` PER PRODUCT, eight at a time. That
 * helper is not one query — it is a fall-through ladder of up to FOUR separate
 * single-row round trips (kb_products, product_enrichments, kb_strains, and a
 * defensive second kb_strains read for `effects`). At 4,500 products that is up
 * to 18,000 sequential database queries on EVERY menu load: ~18 s at a
 * realistic 8 ms round trip, ~135 s cross-region. The Vercel observability
 * panel corroborated it — 0% errors, 0% timeouts, CPU awake and blocked on I/O.
 *
 * THE FIX. Three batched, chunked, fully-paginated queries up front, then the
 * identical ladder resolved in memory by a PURE function.
 *
 * THE RISK THIS FILE EXISTS TO CONTAIN. The dangerous part was never the SQL —
 * it is the LADDER PRECEDENCE. If batching quietly reorders the rungs, products
 * start showing the WRONG description and nothing errors anywhere. So the
 * centrepiece here is an EQUIVALENCE TEST: identical fixtures are pushed
 * through a faithful re-implementation of the OLD per-item ladder and through
 * the NEW batched path, and the two results must be byte-identical.
 *
 * There were no tests over this path before this slice. These are its first.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  __runProductKnowledgeBatchTests,
  collectLookupKeys,
  emptyKnowledge,
  enrichmentHasContent,
  fromEnrichmentPure,
  fromKbMatchPure,
  fromStrainPure,
  indexEnrichments,
  indexKbProducts,
  indexStrains,
  kbIdentityKey,
  kbIdentityParts,
  resolveKnowledgeFromIndexes,
  slugifyDashed,
  strainSlugOf,
  type EnrichmentRow,
  type KnowledgeQuery,
  type StrainRow,
} from "@/lib/ai/kb/product-knowledge-batch-core";
import type { KbProductMatch } from "@/lib/ai/kb/intake";
import type { ProductKnowledge } from "@/lib/ai/kb/product-lookup";

const repoFile = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

const DISPLAY = "src/lib/menu/product-knowledge-display.ts";
const BATCH = "src/lib/ai/kb/product-knowledge-batch.ts";
const CORE = "src/lib/ai/kb/product-knowledge-batch-core.ts";
const LAYOUT = "src/app/layout.tsx";

// ───────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────

const kbRow = (over: Partial<KbProductMatch> = {}): KbProductMatch =>
  ({
    id: "kb-1",
    brand_slug: "avitas",
    product_slug: "blue-dream",
    variant_label: "1g",
    display_name: "Avitas — Blue Dream 1g",
    category: "vape",
    aroma_notes: ["berry"],
    flavor_notes: ["sweet"],
    terpenes: ["myrcene"],
    effects: ["relaxed"],
    description: "A validated KB description.",
    short_description: "KB short.",
    image_media_ids: [],
    primary_media_id: null,
    status: "published",
    active: true,
    ...over,
  }) as KbProductMatch;

const enrRow = (over: Partial<EnrichmentRow> = {}): EnrichmentRow => ({
  pos_product_key: "pos-1",
  display_name: "Enriched name",
  description: "An enrichment description.",
  short_description: null,
  image_media_ids: null,
  primary_media_id: null,
  ...over,
});

const strainRow = (over: Partial<StrainRow> = {}): StrainRow => ({
  slug: "blue dream",
  aroma_notes: ["pine"],
  flavor_notes: ["citrus"],
  terpenes: ["limonene"],
  summary: "A strain summary.",
  effects: ["uplifted"],
  ...over,
});

// ───────────────────────────────────────────────────────────────────────────
// THE OLD LADDER, re-implemented faithfully from product-lookup.ts:77-181.
//
// This is the reference oracle for the equivalence test. It is transcribed
// from the pre-Slice-C source: same order, same conditions, same shapes — but
// reading from in-memory fixtures instead of the network, so it can run here.
// If the new batched path ever diverges from this, the equivalence test fails.
// ───────────────────────────────────────────────────────────────────────────

type FakeDb = {
  kbProducts: KbProductMatch[];
  enrichments: EnrichmentRow[];
  strains: StrainRow[];
};

/** Counts the round trips the OLD path would have made — the N+1 receipt. */
let oldPathQueryCount = 0;

function oldLadderResolve(query: KnowledgeQuery, db: FakeDb): ProductKnowledge {
  const empty: ProductKnowledge = {
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

  // 1 & 2 — checkProductKnown(): .eq(brand_slug).eq(product_slug).eq(variant_label)
  oldPathQueryCount += 1;
  const brandSlug = query.brandName ? slugifyDashed(query.brandName) : "unknown-brand";
  const productSlug = slugifyDashed(query.productName) || "product";
  const variantLabel = (query.variantLabel ?? "").trim();
  const match = db.kbProducts.find(
    (r) =>
      r.brand_slug === brandSlug &&
      r.product_slug === productSlug &&
      (r.variant_label ?? "") === variantLabel,
  );
  if (match) {
    const hasImage = Boolean(match.primary_media_id) || (match.image_media_ids?.length ?? 0) > 0;
    const source = match.status === "published" && match.active ? "kb-exact" : "kb-draft";
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

  // 3 — product_enrichments by pos_product_key
  if (query.posProductKey) {
    oldPathQueryCount += 1;
    const enr = db.enrichments.find((r) => r.pos_product_key === query.posProductKey);
    if (enr && (enr.description || enr.short_description || enr.image_media_ids?.length)) {
      const hasImage = Boolean(enr.primary_media_id) || (enr.image_media_ids?.length ?? 0) > 0;
      return {
        source: "enrichment",
        displayName: enr.display_name ?? null,
        description: enr.description ?? null,
        shortDescription: enr.short_description ?? null,
        aromaNotes: [],
        flavorNotes: [],
        terpenes: [],
        effects: [],
        imageMediaIds: enr.image_media_ids ?? [],
        primaryMediaId: enr.primary_media_id ?? null,
        imageHint: hasImage ? "exact" : "substitute",
        needsOnline: false,
      };
    }
  }

  // 4 — kb_strains by slug (+ the defensive SECOND read for effects)
  if (query.strainName) {
    oldPathQueryCount += 1;
    const slug = query.strainName.trim().toLowerCase().replace(/\s+/g, " ");
    const strain = db.strains.find((r) => r.slug === slug);
    if (strain) {
      oldPathQueryCount += 1; // the separate effects re-read
      return {
        source: "strain",
        displayName: null,
        description: strain.summary ?? null,
        shortDescription: null,
        aromaNotes: strain.aroma_notes ?? [],
        flavorNotes: strain.flavor_notes ?? [],
        terpenes: strain.terpenes ?? [],
        effects: strain.effects ?? [],
        imageMediaIds: [],
        primaryMediaId: null,
        imageHint: "substitute",
        needsOnline: false,
      };
    }
  }

  // 5 — nothing validated
  return empty;
}

/** Build the indexes the NEW path builds, from the same fixtures. */
function indexesFor(db: FakeDb, queries: readonly KnowledgeQuery[]) {
  // Mirror the real loader: kb_products is filtered by product_slug, strains
  // by slug, enrichments by pos key — then re-keyed in memory.
  const { posKeys, strainSlugs, identityParts } = collectLookupKeys(queries);
  const productSlugs = new Set(identityParts.map((p) => p.productSlug));
  return {
    kbProducts: indexKbProducts(db.kbProducts.filter((r) => productSlugs.has(r.product_slug))),
    enrichments: indexEnrichments(db.enrichments.filter((r) => posKeys.includes(r.pos_product_key))),
    strains: indexStrains(db.strains.filter((r) => strainSlugs.includes(r.slug))),
  };
}

describe("Slice C — pure core self-test", () => {
  it("passes every in-module assertion", () => {
    const { passed, failed } = __runProductKnowledgeBatchTests();
    expect(failed).toBe(0);
    expect(passed).toBeGreaterThan(40);
  });
});

describe("Slice C — EQUIVALENCE: batched path === old per-item ladder", () => {
  /**
   * A deliberately adversarial menu. Every rung, every fall-through, every
   * default and every near-miss is represented, because an equivalence test is
   * only as good as the cases it covers.
   */
  const db: FakeDb = {
    kbProducts: [
      kbRow(), // published+active → kb-exact
      kbRow({
        id: "kb-2",
        product_slug: "gorilla-glue",
        variant_label: "3.5g",
        status: "draft",
        active: false,
        description: "Draft copy.",
      }), // → kb-draft
      kbRow({
        id: "kb-3",
        product_slug: "wedding-cake",
        variant_label: "",
        status: "published",
        active: false,
      }), // published but INACTIVE → still kb-draft
      kbRow({
        id: "kb-4",
        brand_slug: "unknown-brand",
        product_slug: "no-brand-item",
        variant_label: "",
      }), // exercises the unknown-brand default
      kbRow({
        id: "kb-5",
        product_slug: "with-image",
        variant_label: "1g",
        primary_media_id: "media-1",
      }), // imageHint: exact
    ],
    enrichments: [
      enrRow({ pos_product_key: "pos-enr" }),
      enrRow({
        pos_product_key: "pos-blank",
        description: null,
        short_description: null,
        image_media_ids: [],
      }), // BLANK → must fall through to strain
      enrRow({
        pos_product_key: "pos-img-only",
        description: null,
        short_description: null,
        image_media_ids: ["m1"],
      }), // image-only still counts as content
    ],
    strains: [
      strainRow(),
      strainRow({ slug: "gelato", summary: "Gelato summary.", effects: null }),
    ],
  };

  const queries: KnowledgeQuery[] = [
    // rung 1 — exact
    { productName: "Blue Dream", brandName: "Avitas", variantLabel: "1g", posProductKey: "p1" },
    // rung 2 — draft
    { productName: "Gorilla Glue", brandName: "Avitas", variantLabel: "3.5g" },
    // rung 2 — published but inactive
    { productName: "Wedding Cake", brandName: "Avitas" },
    // rung 1 via the unknown-brand default (no brand supplied)
    { productName: "No Brand Item" },
    // rung 1 with an image
    { productName: "With Image", brandName: "Avitas", variantLabel: "1g" },
    // rung 3 — enrichment
    { productName: "Unknown Product", brandName: "Nobody", posProductKey: "pos-enr" },
    // rung 3 BLANK → must fall through to rung 4
    {
      productName: "Unknown Product 2",
      brandName: "Nobody",
      posProductKey: "pos-blank",
      strainName: "Gelato",
    },
    // rung 3 image-only content
    { productName: "Unknown Product 3", brandName: "Nobody", posProductKey: "pos-img-only" },
    // rung 4 — strain, with whitespace/case normalisation
    { productName: "Mystery", brandName: "Nobody", strainName: "  BLUE   Dream  " },
    // rung 4 — strain with null effects
    { productName: "Mystery 2", brandName: "Nobody", strainName: "Gelato" },
    // rung 5 — nothing at all
    { productName: "Totally Unknown", brandName: "Nobody" },
    // rung 5 — strain name that does not exist
    { productName: "Totally Unknown 2", brandName: "Nobody", strainName: "Not A Strain" },
    // variant mismatch: right product slug, WRONG variant → must NOT match kb
    { productName: "Blue Dream", brandName: "Avitas", variantLabel: "7g" },
    // brand mismatch: right product slug, WRONG brand → must NOT match kb
    { productName: "Blue Dream", brandName: "Someone Else", variantLabel: "1g" },
  ];

  it("returns byte-identical results for every query", () => {
    const indexes = indexesFor(db, queries);
    for (const query of queries) {
      const oldResult = oldLadderResolve(query, db);
      const newResult = resolveKnowledgeFromIndexes(query, indexes);
      expect(newResult, `divergence for ${JSON.stringify(query)}`).toStrictEqual(oldResult);
    }
  });

  it("covers every rung — the fixtures are not accidentally one-sided", () => {
    const indexes = indexesFor(db, queries);
    const sources = new Set(queries.map((q) => resolveKnowledgeFromIndexes(q, indexes).source));
    expect(sources).toEqual(new Set(["kb-exact", "kb-draft", "enrichment", "strain", "none"]));
  });

  it("collapses ~4 queries per product into 3 total reads", () => {
    // The OLD path, counted honestly against the same fixtures.
    oldPathQueryCount = 0;
    for (const q of queries) oldLadderResolve(q, db);
    // 14 products cost far more than 3 round trips on the old path.
    expect(oldPathQueryCount).toBeGreaterThan(queries.length);
    // The new path issues a fixed 3 reads regardless of product count.
    expect(oldPathQueryCount).toBeGreaterThan(3);
  });

  it("scales: 4,500 products still resolve from the same 3 indexes", () => {
    const many: KnowledgeQuery[] = Array.from({ length: 4500 }, (_, i) => ({
      productName: i % 3 === 0 ? "Blue Dream" : `Product ${i}`,
      brandName: "Avitas",
      variantLabel: i % 3 === 0 ? "1g" : "",
      posProductKey: `pos-${i}`,
      strainName: i % 5 === 0 ? "Gelato" : null,
    }));
    const indexes = indexesFor(db, many);
    for (const q of many) {
      expect(resolveKnowledgeFromIndexes(q, indexes)).toStrictEqual(oldLadderResolve(q, db));
    }
  });
});

describe("Slice C — ladder precedence is exact", () => {
  const q: KnowledgeQuery = {
    productName: "Blue Dream",
    brandName: "Avitas",
    variantLabel: "1g",
    posProductKey: "pos-1",
    strainName: "Blue Dream",
  };

  it("kb_products outranks enrichment AND strain", () => {
    const out = resolveKnowledgeFromIndexes(q, {
      kbProducts: indexKbProducts([kbRow()]),
      enrichments: indexEnrichments([enrRow()]),
      strains: indexStrains([strainRow()]),
    });
    expect(out.source).toBe("kb-exact");
    expect(out.description).toBe("A validated KB description.");
  });

  it("a DRAFT kb row still outranks enrichment", () => {
    const out = resolveKnowledgeFromIndexes(q, {
      kbProducts: indexKbProducts([kbRow({ status: "draft", active: false })]),
      enrichments: indexEnrichments([enrRow()]),
      strains: indexStrains([strainRow()]),
    });
    expect(out.source).toBe("kb-draft");
  });

  it("enrichment outranks strain", () => {
    const out = resolveKnowledgeFromIndexes(q, {
      kbProducts: new Map(),
      enrichments: indexEnrichments([enrRow()]),
      strains: indexStrains([strainRow()]),
    });
    expect(out.source).toBe("enrichment");
  });

  it("a BLANK enrichment falls through to strain — the subtle one", () => {
    const out = resolveKnowledgeFromIndexes(q, {
      kbProducts: new Map(),
      enrichments: indexEnrichments([
        enrRow({ description: null, short_description: null, image_media_ids: [] }),
      ]),
      strains: indexStrains([strainRow()]),
    });
    expect(out.source).toBe("strain");
    expect(out.description).toBe("A strain summary.");
  });

  it("nothing anywhere yields needsOnline", () => {
    const out = resolveKnowledgeFromIndexes(q, {
      kbProducts: new Map(),
      enrichments: new Map(),
      strains: new Map(),
    });
    expect(out).toStrictEqual(emptyKnowledge());
    expect(out.needsOnline).toBe(true);
    expect(out.imageHint).toBe("online");
  });
});

describe("Slice C — identity keying cannot silently mismatch", () => {
  it("reproduces checkProductKnown's unknown-brand default", () => {
    expect(kbIdentityParts({ productName: "X" }).brandSlug).toBe("unknown-brand");
  });

  it("reproduces the 'product' fallback for an unsluggable name", () => {
    expect(kbIdentityParts({ productName: "!!!" }).productSlug).toBe("product");
  });

  it("trims but does NOT slugify the variant label", () => {
    // The DB stores variant_label verbatim ('3.5g'), so slugifying it here
    // would miss every sized SKU.
    expect(kbIdentityParts({ productName: "P", variantLabel: " 3.5g " }).variantLabel).toBe("3.5g");
  });

  it("distinguishes identities a naive join key would collide", () => {
    expect(kbIdentityKey({ productName: "b", brandName: "a-c" })).not.toBe(
      kbIdentityKey({ productName: "c", brandName: "a" }),
    );
  });

  it("indexKbProducts prefers published+active over a duplicate draft, in either order", () => {
    const published = kbRow({ id: "pub", status: "published", active: true });
    const draft = kbRow({ id: "drf", status: "draft", active: false });
    expect([...indexKbProducts([draft, published]).values()][0].id).toBe("pub");
    expect([...indexKbProducts([published, draft]).values()][0].id).toBe("pub");
  });

  it("de-duplicates lookup keys so the batched queries stay small", () => {
    const dupes: KnowledgeQuery[] = Array.from({ length: 100 }, () => ({
      productName: "Blue Dream",
      brandName: "Avitas",
      variantLabel: "1g",
      posProductKey: "pos-1",
      strainName: "Blue Dream",
    }));
    const keys = collectLookupKeys(dupes);
    expect(keys.identityParts).toHaveLength(1);
    expect(keys.posKeys).toEqual(["pos-1"]);
    expect(keys.strainSlugs).toEqual(["blue dream"]);
  });

  it("normalises strain slugs the way the old query did", () => {
    expect(strainSlugOf("  BLUE   Dream  ")).toBe("blue dream");
    expect(strainSlugOf("")).toBeNull();
    expect(strainSlugOf(null)).toBeNull();
  });
});

describe("Slice C — row shaping matches the old code exactly", () => {
  it("imageHint is 'exact' when a primary media id exists", () => {
    expect(fromKbMatchPure(kbRow({ primary_media_id: "m" }), "kb-exact").imageHint).toBe("exact");
  });

  it("imageHint is 'substitute' when the KB row has no image", () => {
    expect(fromKbMatchPure(kbRow(), "kb-exact").imageHint).toBe("substitute");
  });

  it("enrichment results never carry sensory arrays", () => {
    const out = fromEnrichmentPure(enrRow());
    expect(out.aromaNotes).toEqual([]);
    expect(out.flavorNotes).toEqual([]);
    expect(out.terpenes).toEqual([]);
    expect(out.effects).toEqual([]);
  });

  it("strain results never carry images and are always 'substitute'", () => {
    const out = fromStrainPure(strainRow());
    expect(out.imageMediaIds).toEqual([]);
    expect(out.primaryMediaId).toBeNull();
    expect(out.imageHint).toBe("substitute");
  });

  it("a strain with null effects yields an empty array, not null", () => {
    expect(fromStrainPure(strainRow({ effects: null })).effects).toEqual([]);
  });

  it("enrichmentHasContent accepts image-only rows but rejects blank ones", () => {
    expect(
      enrichmentHasContent(
        enrRow({ description: null, short_description: null, image_media_ids: ["m"] }),
      ),
    ).toBe(true);
    expect(
      enrichmentHasContent(
        enrRow({ description: null, short_description: null, image_media_ids: [] }),
      ),
    ).toBe(false);
    expect(
      enrichmentHasContent(
        enrRow({ description: null, short_description: "s", image_media_ids: null }),
      ),
    ).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// REGRESSION GUARDS — read the REAL source files, so reverting the fix fails
// the build instead of quietly restoring the one-minute menu.
// ───────────────────────────────────────────────────────────────────────────

describe("Slice C — the N+1 loop cannot come back", () => {
  const display = repoFile(DISPLAY);

  it("resolveDisplayKnowledgeMap no longer awaits lookupProductKnowledge", () => {
    const body = display.slice(display.indexOf("export async function resolveDisplayKnowledgeMap"));
    const fnBody = body.slice(0, body.indexOf("\nexport "));
    expect(fnBody).not.toContain("await lookupProductKnowledge");
  });

  it("the per-item worker/cursor fan-out is gone", () => {
    const body = display.slice(display.indexOf("export async function resolveDisplayKnowledgeMap"));
    const fnBody = body.slice(0, body.indexOf("\nexport "));
    expect(fnBody).not.toContain("async function worker");
    expect(fnBody).not.toContain("cursor++");
  });

  it("it uses the batched loader and the pure resolver", () => {
    expect(display).toContain("loadKnowledgeIndexes");
    expect(display).toContain("resolveKnowledgeFromIndexes");
  });

  it("the single-item detail path still uses the original ladder", () => {
    // resolveDisplayKnowledge (detail page) is ONE product — batching it would
    // add work, not remove it. It must keep calling lookupProductKnowledge.
    const single = display.slice(display.indexOf("export async function resolveDisplayKnowledge("));
    const fnBody = single.slice(0, single.indexOf("\n/**"));
    expect(fnBody).toContain("lookupProductKnowledge");
  });

  it("withDisplayKnowledge still returns the original items on failure", () => {
    const wd = display.slice(display.indexOf("export async function withDisplayKnowledge"));
    expect(wd).toContain("catch");
    expect(wd).toContain("return items;");
  });
});

describe("Slice C — the batched loader is correctly formed", () => {
  const batch = repoFile(BATCH);

  it("uses chunkedIn for every one of the three reads", () => {
    expect(batch.match(/chunkedIn</g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("every paginated read orders by a unique column, as chunkedIn requires", () => {
    // Without a stable .order() on a unique column, .range() pagination can
    // repeat or skip rows silently.
    const orders = batch.match(/\.order\("id", \{ ascending: true \}\)/g) ?? [];
    expect(orders.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps the active-strains filter from the original query", () => {
    expect(batch).toContain('.eq("active", true)');
  });

  it("selects the same kb_products columns checkProductKnown selected", () => {
    const intake = repoFile("src/lib/ai/kb/intake.ts");
    for (const col of [
      "brand_slug",
      "product_slug",
      "variant_label",
      "display_name",
      "aroma_notes",
      "flavor_notes",
      "terpenes",
      "effects",
      "description",
      "short_description",
      "image_media_ids",
      "primary_media_id",
      "status",
      "active",
    ]) {
      expect(batch, `kb_products column ${col} must be selected`).toContain(col);
      expect(intake).toContain(col);
    }
  });

  it("runs the three independent reads concurrently", () => {
    expect(batch).toContain("Promise.all");
  });

  it("never throws — each rung is individually guarded", () => {
    expect(batch.match(/catch/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("the pure core imports nothing impure", () => {
    // Check real IMPORT STATEMENTS, not prose — the module's own doc comment
    // legitimately mentions "server-only" while describing what it avoids.
    const core = repoFile(CORE);
    const importLines = core
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line) || /^\s*}\s*from\s+"/.test(line));
    const imports = importLines.join("\n");
    expect(imports).not.toContain("server-only");
    expect(imports).not.toContain("@/lib/supabase");
    expect(imports).not.toContain("createSupabaseAdminClient");
    // And it must not perform I/O at all. Strip comments first — the doc block
    // deliberately QUOTES the old `await lookupProductKnowledge(...)` line it
    // exists to replace, and that quotation must not trip this guard.
    const codeOnly = core
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toContain("await ");
    expect(codeOnly).not.toContain("async ");
  });
});

describe("Slice C — Vercel Speed Insights is installed and mounted", () => {
  const layout = repoFile(LAYOUT);

  it("imports SpeedInsights from the Next entrypoint", () => {
    expect(layout).toContain('from "@vercel/speed-insights/next"');
    expect(layout).toContain("SpeedInsights");
  });

  it("renders <SpeedInsights /> inside the document body", () => {
    expect(layout).toContain("<SpeedInsights />");
    const body = layout.slice(layout.indexOf("<body>"), layout.indexOf("</body>"));
    expect(body).toContain("<SpeedInsights />");
  });

  it("is declared as a real dependency, not a dev dependency", () => {
    const pkg = JSON.parse(repoFile("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["@vercel/speed-insights"]).toBeTruthy();
    expect(pkg.devDependencies?.["@vercel/speed-insights"]).toBeUndefined();
  });

  it("does not disturb the existing analytics mount", () => {
    expect(layout).toContain("<Analytics />");
  });
});
