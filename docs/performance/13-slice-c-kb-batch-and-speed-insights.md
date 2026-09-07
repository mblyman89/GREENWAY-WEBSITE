# Slice C — Killing the N+1 query loop, and installing Speed Insights

**Status:** shipped
**Branch:** `slice-c-kb-batch-and-speed-insights`
**Predecessors:** Slice A (`07ded72c`, menu cache), Slice B (`73d4e684` + `ab4f0130`, render cap)

---

## 1. Why the first two slices did not fix the symptom

Michael reported a menu that took "what feels like over a minute" to load. Slice A added
`unstable_cache` around the published menu. Slice B capped how many product cards the browser
mounts on first paint. Neither produced a perceptible change, and that fact was the most valuable
piece of evidence in the whole investigation, because it eliminated two entire classes of cause.

Slice A cached `loadLiveMenuItemsCached()`. That call is the *innermost* step of the menu pipeline.
Five enrichment passes wrap **around** it:

```ts
const menuItems = await withCategoryOverride(
  await withDohCompliance(
    await withDisplayKnowledge(
      await withResolvedImages(await withMenuProfile(await loadLiveMenuItemsCached())),
    ),
  ),
);
```

Everything expensive happened *outside* the cache boundary, so the cache faithfully cached the
cheap part. That was a diagnostic error on my side, and it is worth stating plainly rather than
burying: the fix was chosen because it was safe, not because it matched the symptom.

Slice B was aimed at the browser. It was worth doing on its own merits and it stays, but the
measurements taken afterwards showed the client was never the bottleneck. The full menu payload
compresses to 0.13 MB brotli and `JSON.parse` costs 34 ms; a full client-side filter pass costs
3.8 ms, and seven chained passes cost 27 ms — roughly 133 ms on phone-class hardware. Milliseconds
cannot explain a minute.

Eliminating the cache and the browser left exactly one place for the time to be going.

---

## 2. The actual cause

`resolveDisplayKnowledgeMap()` in `src/lib/menu/product-knowledge-display.ts` resolved product
knowledge with one `await` per product, eight at a time:

```ts
const concurrency = Math.max(1, Math.min(opts.concurrency ?? 8, 16));
async function worker() {
  while (cursor < cannabis.length) {
    const item = cannabis[cursor++];
    const knowledge = await lookupProductKnowledge(queryFor(item)); // ONE await PER ITEM
    out.set(item.id, toDisplay(knowledge, banned));
  }
}
```

`lookupProductKnowledge()` is not a single query. It is a fall-through ladder of up to **four**
separate single-row round trips:

| Rung | Table | Source label |
|---|---|---|
| 1 | `kb_products` (published + active) | `kb-exact` |
| 2 | `kb_products` (any other status) | `kb-draft` |
| 3 | `product_enrichments` by `pos_product_key` | `enrichment` |
| 4 | `kb_strains` by slug, **plus a defensive second read** for `effects` | `strain` |
| 5 | nothing found | `none` |

With 4,500 products that is between 4,500 and 18,000 sequential database queries on **every single
menu load**. The arithmetic:

| Queries/item | Total queries | @ 3 ms | @ 8 ms | @ 60 ms |
|---|---|---|---|---|
| 1 | 4,500 | 1.7 s | 4.5 s | 33.8 s |
| 4 | 18,000 | 6.8 s | **18.0 s** | **135.0 s** |

This is the textbook **N+1 query problem**. Supabase's own guidance
(`supabase/agent-skills`, `data-n-plus-one.md`) rates batch-loading as worth "10-100x fewer database
round trips"; here it is closer to 400x.

The Vercel observability panel corroborated it exactly: **0% errors, 0% timeouts, CPU awake and
spiking**. That is the precise signature of a function that is alive and blocked on I/O, not one
that is crashing, cold-starting, or starved of CPU. It also explains why changing the Vercel region
to match Supabase helped so little — moving from 60 ms to 8 ms per round trip is a large
improvement per query, but 18,000 × 8 ms is still 18 seconds.

### Only one of the five enrichment passes was broken

Before changing anything I audited all five. Four were already correctly batched:

- `withMenuProfile` — one `listKbStrains(50_000)` call
- `withResolvedImages` — chunked `.in()` via `chunkedIn`
- `withDohCompliance` — `getMedicalRegistryForKeys(items.map(i => i.id))`
- `withCategoryOverride` — `getOverridesForKeys(...)`

Only `withDisplayKnowledge` was N+1. That confined the fix to a single function, which is why this
slice is small despite the size of the effect.

---

## 3. The fix

Three batched, chunked, fully-paginated reads issued **concurrently** up front, then the identical
ladder resolved in memory.

**`src/lib/ai/kb/product-knowledge-batch-core.ts`** (PURE, no I/O) owns the precedence:

```ts
export function resolveKnowledgeFromIndexes(query, indexes): ProductKnowledge {
  const kbMatch = indexes.kbProducts.get(kbIdentityKey(query));
  if (kbMatch) {
    const isExact = kbMatch.status === "published" && kbMatch.active;
    return fromKbMatchPure(kbMatch, isExact ? "kb-exact" : "kb-draft");
  }
  if (query.posProductKey) {
    const enrichment = indexes.enrichments.get(query.posProductKey);
    if (enrichment && enrichmentHasContent(enrichment)) return fromEnrichmentPure(enrichment);
  }
  const slug = strainSlugOf(query.strainName);
  if (slug) { const strain = indexes.strains.get(slug); if (strain) return fromStrainPure(strain); }
  return emptyKnowledge();
}
```

**`src/lib/ai/kb/product-knowledge-batch.ts`** (impure) does the loading.

### Design decisions, and why

**Why not one SQL join.** The ladder is a *precedence*, not a join: rung 3 is only consulted when
rung 1 missed. Expressing that in SQL buries the precedence in a query plan where it cannot be
unit-tested. Loading each rung's candidates in bulk and applying precedence in a pure function keeps
the dangerous part testable.

**Why `kb_products` is filtered by `product_slug`.** The natural key is the triple
`(brand_slug, product_slug, variant_label)` — `uq_kb_products_identity`, migration 0071. PostgREST
cannot express `.in()` over a composite key, so we filter on one indexed leg
(`idx_kb_products_product`) and re-apply the full triple in memory via `indexKbProducts()`. Only a
true three-part match is ever returned, exactly like the old `.eq().eq().eq()`.
`product_slug` is chosen over `brand_slug` deliberately: distinct product slugs are bounded by menu
size, whereas a brand filter would pull every SKU that brand has ever had.

**Why the strain `effects` re-read disappears.** Migration 0071 line 95 adds
`kb_strains.effects text[] not null default '{}'`. The column exists, so it is selected inline. The
loader still retries once without it if the column is genuinely absent, preserving the original
resilience.

**Preserved verbatim:** the `.eq("active", true)` filter on strains, the `"unknown-brand"` and
`"product"` slug defaults from `checkProductKnown`, the published-**and**-active rule for `kb-exact`,
the trimmed-not-slugified `variant_label`, and the rule that a *blank* enrichment row falls through
to the strain rung rather than short-circuiting the ladder.

### Round trips

| | Before | After |
|---|---|---|
| Queries per menu load | up to 18,000 | **3** batched calls → ~15-45 round trips after chunking/paging |
| Scaling | linear in product count | flat |

The three reads run under `Promise.all`, so wall-clock cost is the slowest rung, not the sum.

### What was deliberately NOT touched

- `lookupProductKnowledge()` itself is unchanged — `src/lib/enrichment/command-center.ts:184`
  depends on it.
- `resolveDisplayKnowledge()` (the single-product detail page) still uses the original ladder.
  Batching one product would add work, not remove it.
- `withDisplayKnowledge()` keeps its `try/catch` returning the original items unchanged on failure.

---

## 4. Vercel Speed Insights

`@vercel/speed-insights@2.0.0` is installed as a production dependency and `<SpeedInsights />` is
mounted in `src/app/layout.tsx`, immediately after the existing `<Analytics />`.

The component renders `null` — it injects one small deferred script and has no visual output, no
layout effect, and is inert outside Vercel. The existing GA4 mount is untouched.

This gives field Core Web Vitals (LCP, CLS, INP, TTFB) from real visitors, so the next round of
performance work can be measured rather than estimated.

---

## 5. Verification

There were **no existing tests over this code path**. `tests/compliance/menu-knowledge-batch.test.ts`
(39 tests) is its first safety net.

**The equivalence test is the centrepiece.** The old per-item ladder is re-implemented faithfully
from `product-lookup.ts:77-181` as a reference oracle reading in-memory fixtures. Identical
adversarial fixtures — covering all five rungs, published-but-inactive rows, blank enrichments,
image-only enrichments, the unknown-brand default, whitespace/case strain normalisation, and both
brand and variant near-misses — are pushed through both paths and asserted `toStrictEqual`. A
4,500-product scale test does the same at production size.

**Mutation testing.** Eight deliberate defects were injected and every one was caught:

| # | Mutation | Tests failed |
|---|---|---|
| 1 | Skip the `kb_products` rung entirely | 6 |
| 2 | Blank enrichment short-circuits instead of falling through | 3 |
| 3 | `kb-exact` requires only `status`, not `active` | 2 |
| 4 | `variant_label` slugified instead of trimmed | 2 |
| 5 | `unknown-brand` default dropped | 3 |
| 6 | `.eq("active", true)` removed from the strain query | 1 |
| 7 | `<SpeedInsights />` removed from the layout | 1 |
| 8 | The N+1 `await` loop restored | 1 |

Mutation 8 matters most: the guard reads the **real source file**, so reverting the fix fails the
build rather than quietly restoring the one-minute menu.

**Gates:** `tsc --noEmit` 0 errors (including `tests/`), `eslint` 0 problems, `next build` clean,
full suite **585 files / 14,851 tests passing** — baseline +1 file, +39 tests, zero regressions.

---

## 6. What to expect, honestly

The server-side database wait for `/menu` should drop from tens of seconds to well under a second.
This addresses the dominant cost, and unlike Slices A and B it targets the thing that was actually
consuming the time.

It will not make the menu instantaneous on its own. Remaining known costs, none of which are close
to the same order of magnitude:

- `matchesSearch` (`InteractiveMenuBrowser.tsx:363`) builds a concatenated haystack for every item
  even when the search box is empty — 21 ms of a 27 ms client pass. Real, minor, not yet fixed.
- `ProductCardVisual.tsx:341` uses a raw `<img>` rather than `next/image`.
- `public/` holds 52 MB across 78 images, though these serve blog and vendor pages, not the menu.
- With the N+1 gone, it now finally makes sense to move the cache boundary *outward* to cache the
  fully **enriched** menu. That was pointless before, because the enrichment happening outside the
  boundary was the expensive part. This is the natural next slice.

Speed Insights will now provide real field numbers to confirm or refute all of the above.
