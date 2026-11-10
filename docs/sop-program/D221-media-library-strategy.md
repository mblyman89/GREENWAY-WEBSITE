# D221: Media Library overhaul, recon and strategy (read-only round, 2026-11-09)

Status: **plan only, no code changed.** Slices M1 to M8 below are proposed for the next rounds.

## 1. What the live database says

All numbers below are from read-only SELECTs against production.

| Fact | Value | Why it matters |
|---|---|---|
| `media_assets` rows | 6,936 (127 published, 6,809 draft) | Almost everything is a draft, so it is hidden from picker scopes that prefer published |
| Crawled rows (`source = crawl:…`) | 6,806 | Almost the whole library came "from the horse's mouth" |
| Distinct `storage_key` | 3,581 | **About 3,355 rows are duplicates of the same bytes.** One Cultivera `IMG_1947` exists 195 times and a GrowFlow photo 87 times |
| Rows with a description | 43 | AI has never described the library |
| Rows with a blur placeholder | 6,189 | Fine |
| Storage | about 827 MB | The duplicate rows share files, so the waste is in rows, not bytes |
| Hosts | cdn1.s2solutions.com 2,755 (1,306 unique); files.cultivera.com 2,587 (889); growflowweb blob 1,200 (950); vendor websites 400+ | Platform is knowable from the URL |
| `media_usages` | kb_product 4,732 · cultivera_strain 4,494 · growflow_menu_item 1,204 · product 84 · cultivera_menu_item 53 · vendor/brand logo 61 | Provenance links exist but are not columns on the asset |
| kb_product usages whose entity id starts `unknown-brand/` | 4,658 of 4,896 | Brand is missing on most KB cards, so brand-matching can't work today |
| `kb_products` | 9,801; vendor_id 4,248; brand_id 2,136; `unknown-brand` 6,973 | vendor_id is the stronger key we can use |
| Assets with no usage at all | 1,142 | Orphans: need provenance from the source URL |
| Indexes on media_assets | btree status / usage_type / storage_key / public_url, GIN tags | No full-text, trigram or vector index |
| Extensions | `pg_trgm` 1.6 installed; **`vector` 0.8.0 available**; unaccent available | Hybrid semantic search is possible inside Supabase with no new vendor |
| Tags | `{harvested, cultivera, product-image, <vendor-slug>}` | Some are misclassified (a jar tagged `vendor-logo`) |

## 2. Root causes of "terrible suggestions, not even the same vendor"

1. **The picker only ever sees 400 assets.** `readLibraryPickerAssets()` does `order(created_at desc).limit(400)` with no
   vendor/brand filter (`src/lib/media/library-picker-server.ts`, `LIBRARY_READ_LIMIT = 400`). The onboarding recommender
   (`loadOnboardingImageRecommendations`) reuses this. So 94% of the library can never be suggested, and the 400 newest
   are whatever vendor was crawled last.
2. **Matching is token overlap on title, filename and alt text** (`image-recommend-core.ts`). Titles are boilerplate
   ("… (Cultivera)", "SUBX (harvested)"), alt text is "<name> product image from <vendor>", and filenames are
   `IMG_1947.jpeg`. So tokens like "product", "image" and "pack" match everything.
3. **Vendor is not a column.** The only vendor signal is a slug inside `tags` (+4 boost). There is no `vendor_id`,
   `brand_id`, `platform`, `category` or `strain`. Yet all of that is known at harvest time and is still recoverable through
   menu-item rows, `media_usages` and the source URL.
4. **Duplicates crowd the results.** The harvest dedupe (`findExistingByHash`, a `like '%/hash-%'` with `.limit(1)`)
   lost races during parallel menu imports, so the same image was inserted dozens of times within minutes.
5. **No real search.** The library has no full-text, trigram or semantic index, and no AI description to search
   against.
6. **Drafts-only policy.** Crawled assets stay `draft` + `pending-review` forever unless someone attaches them.

## 3. Research: what enterprise DAMs do, and what we can borrow

- **Adobe AEM Assets Smart Tags / Cloudinary AI tagging / Bynder:** an AI tagger adds tags with a **confidence score**.
  Tags above a threshold are applied automatically, lower ones go to a review queue, and every tag records its origin
  (AI vs human). A **controlled vocabulary/taxonomy** sits on top so tags are consistent. We copy all of it: confidence-gated
  auto-apply, a review queue, a provenance flag per field, and a closed vocabulary.
- **Cloudinary / Bynder visual search:** "find similar" and natural-language search via embeddings. Our equivalent is
  **pgvector** (available, v0.8.0) with an HNSW index, plus **hybrid search**: Postgres full-text (`tsvector`) and
  trigram (typos, partial names) fused with vector similarity by **Reciprocal Rank Fusion**, the pattern Supabase
  documents. It needs no new vendor and runs inside our DB.
- **PIM-linked DAM (Akeneo, Salsify, Pimcore):** assets link to product, brand and vendor records by key, not by name. The
  picker opens **already filtered to that product's vendor/brand**. We do this by adding real FK columns.
- **Dedupe:** an exact content hash (we have sha256/16 in the key) plus a **perceptual hash (dHash/pHash, 64-bit)** for
  near-duplicates (re-encoded or resized copies), compared by Hamming distance. Duplicates collapse to one **canonical**
  asset, and usages are re-pointed to it.
- **Image SEO (Google Search Central guidance):** descriptive, concise alt text (not keyword-stuffed); a descriptive
  hyphenated filename/slug; a caption or description near the image; schema.org `ImageObject` / `Product.image` with
  `contentUrl`, `name`, `description`, `creditText`, `copyrightNotice` and `acquireLicensePage`; IPTC/XMP-style creator
  and credit fields; image sitemaps; WebP/AVIF with width/height (we already optimize). Compliance: no medical claims and
  no appeal to minors, so SEO text runs through our existing WA compliance lint.
- **Costs (OpenAI list prices):**
  - Vision, gpt-4o-mini at "low" detail: under $0.001 per image, so about $3–5 for the 3,581 unique images, or about
    $15–25 at high detail.
  - Embeddings, `text-embedding-3-small` at $0.02 per 1M tokens: about $0.05 for the whole library.
  - A full backfill is a few dollars, not hundreds.

## 4. Target design

### 4.1 Data model (migration 0352, additive)

`media_assets` gains:

- **Provenance (structured):**
  - `vendor_id`, `brand_id`, `kb_product_id`, `strain_name`;
  - `platform` (cultivera / growflow / leaflink / website / upload / email);
  - `menu_item_ref` (e.g. `growflow:<id>`), `source_page_url`, `captured_at`.
- **Classification:**
  - `role` (product-shot, packaging, lifestyle, flower-macro, logo, banner, coa, label, other);
  - `category` (flower / pre-roll / vape / edible / concentrate / topical / beverage / accessory), `subcategory`;
  - `pack_size`, `colors text[]`, `background` (white / transparent / scene), `orientation`, `quality_score`.
- **AI vision:**
  - `ai_description` (long, factual, what's in the picture);
  - `ai_caption` (one line), `visible_text` (OCR: brand, strain, weight on the package);
  - `ai_tags text[]`, `ai_confidence numeric`, `ai_model`, `ai_described_at`.
- **SEO:**
  - `seo_title`, `seo_alt` (≤125 chars), `seo_description`, `seo_slug` (hyphenated filename);
  - `keywords text[]`, `credit_text`, `copyright_notice`, `license_url`.
- **Search:**
  - `search_tsv tsvector` (generated, weighted: A = names/brand/vendor/strain, B = caption/visible text, C = description/tags);
  - `embedding vector(1536)` (text embedding of the description plus provenance);
  - trigram index on title.
- **Dedupe:** `content_hash`, `phash bit(64)`, `canonical_id` (null = canonical), `duplicate_count`.
- **Governance:** `publish_reason` (vendor-source-auto / human / rule), `published_by`, `published_at`, `review_state`
  (ok / needs-review / rejected), `field_provenance jsonb` (which fields are AI, rule or human; humans always win).

New tables:

- `media_ai_runs`: job ledger for the backfill (batch, cost, counts, errors, resumable cursor).
- `media_review_queue`: low-confidence or conflicting items (vendor mismatch between the AI-read label and the
  provenance, possible logo/product misclassification).
- `media_collections` (+ items): curated sets such as "Brand kit: Fairwinds" or "Hero shots".
- `media_search_log`: queries and zero-result searches, to tune the vocabulary.

An RPC `media_search(q, vendor, brand, category, role, status, limit, offset)` returns hybrid-ranked rows (FTS + trigram
+ vector, RRF) and a `media_similar(id)` RPC for "find similar".

### 4.2 Publish policy change (owner decision D221)

AGENTS.md rule 3 currently makes all crawler/AI output drafts-only. Proposed amendment: **images harvested from a
vendor's own menu platform (Cultivera / GrowFlow / LeafLink) or the vendor's verified website are auto-published** to the
*library* when:

- provenance resolves to a vendor;
- the AI label/OCR does not contradict that vendor or brand;
- it is not a near-duplicate of a different product's canonical image.

The audit row records `publish_reason='vendor-source-auto'` and every auto-publish can be reverted in one click. Two
things stay human-only: **attaching to a live product page** and setting a product cover. "Published" means "trusted and
findable in the library", not "live on the storefront". Anything failing the rules goes to the review queue.

### 4.3 Backfill pipeline (runs on the Railway crawler worker, resumable, budgeted)

1. **Dedupe (no AI):** group by `storage_key`, pick the oldest row as canonical, re-point `media_usages`, menu-item
   `media_asset_id` and `kb_products.image_media_ids` to it, and **archive (never delete)** the copies. Then compute pHash
   for near-dupes and send them to review. Expected: 6,936 → about 3,581 canonical.
2. **Provenance backfill (no AI):** fill in the provenance fields from these sources, in order:
   - growflow/cultivera menu items (`media_asset_id` gives vendor, brand, category, strain, size, the item);
   - `media_usages` to kb_products (`vendor_id`, `brand_id`, category);
   - vendor/brand logo usages;
   - the source host (platform; vendor website via `vendor_websites`/campaign sites).
3. **Vision describe (AI):** gpt-4o-mini vision with a strict JSON schema: role, category, visible text (OCR), brand/strain
   seen, pack size, colors, background, quality, a factual description, a caption and tags, each with a confidence. The
   prompt is grounded with the known vendor/brand/product name, the same KB-grounded approach as `suggest-core`.
4. **SEO generation (AI, text-only):** seo_title, alt, description, slug and keywords from the provenance and vision data,
   then run through the compliance lint.
5. **Embed:** a `text-embedding-3-small` vector of the composed document.
6. **Auto-publish** per 4.2; then the review queue.
7. **Going forward,** the same steps run inline at harvest (with the dedupe race fixed by a unique index on `content_hash`
   for canonical rows plus `on conflict`), so new menus arrive already clean.

### 4.4 Recommender v2 (onboarding + enrichment)

- **Candidate pool:** filtered in SQL by vendor first (`vendor_id`/`brand_id` of the draft or product), then by
  category, with no 400-cap. Other vendors are shown only if there are no same-vendor hits, and then clearly labelled.
- **Score (explainable):**
  - remembered (97) > on record (90) > exact menu-item link (95, the image came with this very item) >
    same vendor + strain/name;
  - OCR text match (visible "Blue Dream 1g" on the package beats title tokens);
  - vector similarity of the product's name/description to the image document;
  - pack-size and category agreement;
  - penalties for logo/banner roles when a product shot is wanted.
- **The "why" chip on each tile:** "Same vendor · label reads 'Blue Dream' · 1g".
- **"Search for a better picture" box** in both the onboarding panel and the enrichment picker, using `media_search`
  with filter chips (this vendor / this brand / all · role · category). It accepts anything: "purple gummy jar",
  "Fairwinds tincture box", "logo". It also offers "Find similar" from any tile.
- One-click attach (unchanged audited path), and attaching writes image memory so the next delivery learns.

### 4.5 Media Library UI v2 (`/admin/media`)

- A search bar on the hybrid RPC, with faceted filters showing counts: vendor, brand, platform, role, category, status,
  needs-review, has-SEO, orientation, colors.
- Grid / list views, bulk select and bulk actions: publish, archive, re-describe, set vendor, add to collection.
- Asset detail page:
  - all AI and SEO fields, editable, with an AI/human badge per field;
  - "Regenerate";
  - "Where used";
  - "Duplicates";
  - "Similar images";
  - a provenance card (vendor, platform, menu item, source page, captured date).
- A Review Queue tab with accept/fix/reject.
- A **Health dashboard:** % described, % SEO-complete, % published, duplicates remaining, orphans, AI spend, and the
  backfill progress bar with Start/Pause.
- Collections / brand kits.

### 4.6 Storefront SEO payoff

- Product pages emit `ImageObject` (contentUrl, name, description, creditText) inside the existing Product JSON-LD.
- Alt text comes from `seo_alt`.
- An image sitemap lists published product images.

## 5. Slice plan

| Slice | Scope | AI cost | Risk |
|---|---|---|---|
| **M1** | Migration 0352: new columns, tables, pgvector, tsvector + trigram + HNSW indexes, `media_search` / `media_similar` RPCs (additive) | none | low |
| **M2** | Dedupe and canonicalize (dry-run report first, owner approves, then archive copies and re-point usages); fix the harvest race | none | medium, so dry-run first |
| **M3** | Provenance backfill from menu items, usages and hosts; a fix-misclassified-logos rule | none | low |
| **M4** | Vision + SEO + embedding backfill worker on Railway (resumable, budget cap, ledger); inline at harvest going forward | about $5–25 one-time | low |
| **M5** | Auto-publish rules + review queue + AGENTS.md amendment | none | policy |
| **M6** | Recommender v2 + "search for a better picture" in onboarding and enrichment | pennies (query embeddings) | medium |
| **M7** | Media Library UI v2: search, facets, bulk, detail, health dashboard, review queue, collections | none | low |
| **M8** | Storefront SEO: ImageObject JSON-LD, seo_alt, image sitemap | none | low |

Recommended order: M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8. M6 can start once M3 lands, because vendor-scoping alone fixes
most of the "wrong vendor" complaint before any AI runs.

### 5.1 As built (M3 + M4, 2026-11-10)

- **M3** shipped as migration 0353. It adds `media_backfill_vendor_links` (seller folder code, seller tag, harvested title; merged cards follow the survivor; the placeholder vendor never counts) and the review queue at `/admin/media/review` (Looks right / Product photo / Logo / Reject, never delete).
- **M4** shipped as a **Vercel cron** (`/api/cron/media-describe`, every 10 minutes at :08, leased by compare-and-set), not on Railway as section 4.3 planned. It uses `gpt-6-luna` at detail high and has a dollar budget per run. "Keep describing new pictures" covers the inline-at-harvest part.
- **Embeddings** (section 4.3 step 5) are deferred to M6, where the recommender first needs them.

### 5.2 As built (M5 to M8, 2026-11-10)

- **M5** shipped as migration 0354. `media_set_auto_publish('undo' | 'redo', ids)` is the one-click revert (all auto-published pictures, or one). `media_auto_publish` now skips any draft that was ever published or carries a publish reason, so an undone picture stays a draft. The buttons are on the /admin/media health dashboard and on each picture's page. /admin/media and /admin/media/review link to each other.
- **M6** has no embeddings and no pgvector. `media_similar` combines trigram name similarity, full text on the AI package text, the same vendor, brand, strain and category, and the same file. That costs nothing per query and uses the text the M4 describe pass writes. The recommender down-ranks logos, banners and menus for product cards, and shows "why" chips such as "Same vendor", the pack size or "Label matches". It also adds "Search in: This vendor / This brand / Everything" and "Find similar" in onboarding (Images panel) and enrichment (library picker). Attaching stays one human click.
- **M7** adds facets on /admin/media (vendor, platform, role, category, review, SEO, AI, collection) with removable chips. Bulk actions are publish, archive, re-describe, undo auto-publish, set vendor and add to a collection, and they never overwrite a person's values. Each picture's page now shows the SEO and AI fields with "AI" / "Person" badges, provenance, duplicates, similar pictures and collections. There is also a health dashboard with the top searches and the ones that found nothing, and a new /admin/media/collections page. Search logging is best effort.
- **M8** gives the product page alt text from `seo_alt`, then the library alt text, then the product name. The Product JSON-LD carries an `ImageObject` (name, description, creditText), for the product's own photo only. The sitemap lists each product page's own published photo (`images`), with representative pictures left out.

## 6. Decisions needed from the owner

1. Approve the publish-policy amendment in §4.2: auto-publish vendor-sourced images to the library, while attaching to a live
   product stays human.
2. Dedupe: archive the duplicate rows (reversible), never hard-delete. Is that OK?
3. AI budget for the one-time backfill: low detail (about $5) or high detail (about $25, better OCR of small label text)?
4. Vision model: keep gpt-4o-mini (current `AI_VISION_MODEL`) or allow a stronger model for low-confidence retries?
