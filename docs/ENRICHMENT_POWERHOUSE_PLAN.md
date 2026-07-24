# Enrichment Powerhouse Plan (SLICE 38)

Owner directive: turn `/admin/products` (Product Enrichment) into a powerhouse
command center that intelligently searches the KB, the media library, and
vendor data to match assets to products; when nothing exists, suggest how to
get assets or offer an approved fallback image. Filters and sorting must be
relevant to enrichment work.

## Part 1 — Audit findings (traced, not guessed)

### What the page does today
- List (`src/app/admin/products/page.tsx`): published menu snapshot
  (`getPublishedVersion`/`getVersionItems`) merged with
  `getEnrichmentsForKeys` + `computeGaps`; filters `q` / `category` /
  `gap=description|image|brand`; grid/table toggle; 300-item cap; stat cards.
- Editor (`src/app/admin/products/[key]/page.tsx`): POS facts strip, AI
  suggestion panel (description/tags/sensory), enrichment form, single-file
  image upload, publish controls.
- Actions (`src/app/admin/products/actions.ts`): `updateProductEnrichment`
  (upload → media library + recordUsage), `setEnrichmentStatus` (publish →
  `writeBackOnPublish`), AI generate/accept/reject.

### Confirmed gaps (the "orphaned wiring")
1. **KB is invisible to the editor.** `lookupProductKnowledge`
   (`src/lib/ai/kb/product-lookup.ts`) — the KB-first read ladder
   (kb_products published → draft → enrichment → kb_strains) — is consumed
   ONLY by the public menu (`src/lib/menu/product-knowledge-display.ts`).
   The enrichment editor never shows KB descriptions, sensory notes,
   terpenes, effects, or KB product images.
2. **No media-library browsing.** The editor is upload-only. `listMedia` /
   `resolveMediaUrls` (`src/lib/media/store.ts`) power four other admin pages
   but not this one.
3. **Image fallback ladder is hidden.** `resolveProductImage`
   (`src/lib/enrichment/image-resolver.ts`, exact → brand/vendor substitute →
   category → inventory_type → global) serves the public menu + syndication,
   but the editor never previews what will actually render, nor its
   provenance, nor offers the approved substitutes
   (`src/lib/ai/kb/image-substitutes.ts`).
4. **Vendor data is unreachable.** `cultivera_menu_items` /
   `growflow_menu_items` rows carry `image_url`, `description`, potency and
   (when saved) `media_asset_id` — never surfaced during enrichment.
5. **Matching intelligence exists but only for media→product.**
   `src/lib/media/product-link-core.ts` (tokenize/score/bestProductMatches)
   matches harvested images to kb_products. Nothing matches a POS product to
   KB products, media assets, or vendor items from the enrichment side.
6. **No "no assets" flow.** When nothing matches, the page gives no guidance
   (harvest vendor menu, ask rep, photograph in store, use a substitute).
7. **Filters/sorting are thin.** No sort control, no enrichment-status
   filter, gap filter can't target "no image AND no substitute coverage".
8. **KB image attach path exists** (`attachKbProductImage`, H9c) but there is
   no enrichment-side "use this KB image" action.

### Data model (verified)
- `product_enrichments` (migration 0004): pos_product_key unique,
  display_name/description/short_description, image_media_ids[],
  primary_media_id, brand_id/vendor_id, tags[], staff_pick/featured,
  hidden_override, seo, status. No new migration needed for this slice.
- `kb_products` (0071, potency 0084): brand_slug/product_slug/variant_label
  identity, sensory arrays, description, image_media_ids, primary_media_id.
- Intake → KB carry: `promoteManifestToKb` → `writeBackProductFacts` stamps
  manifests into kb_products; enrichment publish also writes back
  (`writeBackOnPublish`). So the KB fills up — the enrichment editor just
  never reads it.

## Part 2 — Build plan (no new migration)

### New pure core — `src/lib/enrichment/match-core.ts`
- `tokenizeProductText` (stop-word aware, own copy tuned for POS names).
- `scoreKbProductMatch(posItem, kbProduct)` → score + reasons (name-token
  coverage + brand agreement bonus / disagreement penalty), mirroring the
  proven conservative approach of product-link-core.
- `scoreMediaAssetMatch(posItem, asset)` → score + reasons from
  title/alt/tags tokens.
- `scoreVendorItemMatch(posItem, vendorItem)` → score + reasons from
  name/brand tokens; carries platform + image availability.
- `rankMatches` (min-score gate, cap, best-first).
- `buildAssetGuidance(gapFlags, matches)` → ordered plain-English suggestions
  when no exact asset exists (harvest the vendor menu, request from the
  brand rep, shoot it in store, apply an approved substitute).
- Self-test `__runEnrichmentMatchCoreTests()` wired into
  `scripts/compliance/run-pure-selftests.ts`.

### New server aggregator — `src/lib/enrichment/command-center.ts`
`getEnrichmentCommandCenter(posKey)` gathers in parallel, all read-only,
never throws (defensive like siblings):
- enrichment row + gaps (`getEnrichment`, `computeGaps`);
- KB knowledge via `lookupProductKnowledge` (source + needsOnline +
  imageHint);
- ranked KB product candidates (listKbProducts all → match-core), with
  gallery URLs resolved (`resolveMediaUrls`);
- ranked media-library candidates (`listMedia({usageType:"product"})` →
  match-core);
- ranked vendor-item candidates (query `cultivera_menu_items` /
  `growflow_menu_items` by recent snapshots → match-core), including saved
  `media_asset_id` when present;
- what-the-menu-will-show image via `resolveProductImage` (url + source +
  isFallback provenance);
- approved substitute options for this category/inventory type/brand
  (`listSubstitutes` filtered via image-substitutes);
- guidance lines from `buildAssetGuidance`.

### Editor overhaul — `src/app/admin/products/[key]/page.tsx`
- "Knowledge Base match" panel: KB description/short/sensory/terpenes/
  effects with per-field **Apply** buttons (server actions copy KB text into
  the enrichment draft — human stays in the loop, nothing auto-publishes).
- "Image command center": current resolved image + provenance badge
  (exact / substitute rung / none); KB image suggestions; vendor image
  suggestions; media-library picker (searchable, published product images);
  approved-substitute offer ("use fallback image instead"); upload stays.
- "Vendor data" panel: matched vendor menu lines (platform badge, price,
  potency, description) with Apply-image and Apply-description.
- "No assets?" guidance box when nothing matched.

### New server actions (in `actions.ts`)
- `applyKbTextAction(key, field)` — copy a KB field into the enrichment.
- `attachMediaToEnrichmentAction(key, mediaId)` — set gallery/primary from
  a picked/suggested asset + `recordUsage`.
- Both compliance-linted where text flows (reuse existing lint path) and
  permission-gated by `products.enrich`.

### List page — relevant filters & sorting
- `sort=name|updated|gaps|category` control (gaps-first default keeps the
  worklist actionable).
- `status=` enrichment-status filter (none/draft/published/archived).
- Keep existing gap filters; add `gap=any`.

### Tests & tripwires
- Vitest for match-core + guidance.
- Manual test T-192 appended at END of Phase 12 (both TEST-PLAN.md and
  test-manual/index.html); anchors 163→164 at the 3 sites in
  verify_testplan_anchors.py AND the matching asserts in
  verify_employee_handbook.py / verify_store_favorable_discounts.py.
- New /workspace/verify_enrichment_powerhouse.py.
- No new tables → verify_gw019_020_fix.py count (168) unchanged.
- 3 pre-existing eslint errors on main (CommandPalette.tsx, HelpPanel.tsx)
  are documented, never fixed.
