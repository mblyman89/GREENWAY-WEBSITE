# D244 — Product Enrichment Powerhouse: audit, roadmap and SOP-10 strategy

Status: **RECON + STRATEGY ONLY. No code was changed.** Every finding below is pinned to
`file:line` on `main` @ 578810a7. Owner sign-off is needed on the decisions in section 9 before any slice starts.

## 0. The owner's request (verbatim, key parts)

> "tackle a much more important area that needs an sop and major enhancements and upgrades to make it more
> efficient and powerful. I have over 2000 products to enrich. I need a much more powerful way to publish
> multiple products at once. I have several products that have an image, but are drafts, so they dont show up
> on the menu yet until I publish them. we need a much more powerful way to recommend good options for
> attaching to a product. right now its terrible. I have over 14000 product photos, and there is substantial ai
> help in organizing and cataloging it all in digital media . it describes it visually, it knows where it came
> from, which vendor it came from, if there is a description attached to it. I can search for the image in the
> search bar and it pops up in the table of results, so I know the images for the most part exist. we need a
> much more powerful image recommendation system. I need a powerful ai partner that can help me slowly go
> through these products to enrich them. help me visually inspect, lean on the knowledge base for knowledge
> about these kinds and types of products. we have a huge kb and it is full of data we should be using when
> enriching products, even if they are best guesses based on proven data from the kb. so it should be using it
> extensively. I need a much more powerful and efficient way to publish multiple products at once. a select and
> select all. I want to use the bulk ai features, but I am not confident they will work, because I am not
> confident they are connected properly to the kb. I need a better way to go from the detail page back to the
> main table, so it goes back to the same filtered list I was working on. I want to be able to filter by
> vendor, then work a full vendor before moving on to the next vendor. I only want to focus on products we
> have quantity on hand. the rest can wait until after the important ones are done. I get this error when I
> try to draft seo or descriptions and aromas and flavors. "AI structured generation failed after retry:
> Error: AI request failed (400): { "error": { "message": "Unsupported parameter: 'max_tokens' is not
> supported with this model. Use 'max_completion_tokens' instead." … please go slow, be meticulous, recon and
> audit the code, find all that is wrong with it, pin it, anchor it, document everything. research more ways of
> incorporating a more inteligent and powerful ai partner … no code edits yet please."

## 1. Executive summary

The enrichment area has strong parts: KB grounding, compliance gates, provenance, image memory and a ranked
media search. But they are **not connected to each other where the owner works**. The concrete problems:

1. **Every AI draft button is broken by one bug** (F-01). All but one of the provider's request paths
   hard-code `max_tokens`. Newer OpenAI models (gpt-5 / gpt-6 / o-series) reject it. One correct pattern
   already exists in the same file (`generateVisionJson`). It was never shared.
2. **Bulk AI is KB-grounded, but thin and fragile** (F-10…F-15). It drafts descriptions only, 25 at a time,
   in sequence, in one request. It has no vendor and no stock scoping. It hides errors behind a "failed"
   count. It has no `maxDuration`.
3. **Draft products with photos are invisible** (F-20), because only `status='published'` enrichment reaches
   the menu. There is no "ready to publish" filter and **no select / select-all / bulk publish anywhere**
   (F-21, F-22).
4. **The image recommender on the product page cannot see the 14,000 photos** (F-30…F-37):
   - The "Suggested" block reads only the **newest 400** `usage_type='product'` rows, and scores only
     title / alt / tags. It ignores the AI description, the package text and the vendor.
   - The picker's default scope also drops every photo whose usage isn't `product`.
   - Search is all-words-must-match.
   - pgvector is installed but no embeddings were ever built.
   - The onboarding "remembered picks" ladder is not used on the enrichment page.
5. **Filters are lost after every save** (F-40). The list correctly passes `?back=` into the detail page, but
   all **54 redirects** in `actions.ts` drop it. There is no "Save & next".
6. **The vendor filter is not a real vendor filter** (F-50). It lists only vendors from the 100 newest
   deliveries, and it vanishes when delivery attribution is unavailable. **The stock filter is not a default**
   and is not quantity-aware (F-51).

What it will take, in short: **one hotfix slice, then six build slices** (section 8). This document is also
the outline for SOP-10.

---

## 2. AI provider: the owner's 400 error (root cause)

| ID | Finding | Pin |
|---|---|---|
| F-01 | `chatRaw()` always sends `max_tokens` plus `temperature`. `generateStructured()` uses it for **every** product draft (description, sensory/aroma/flavor, effects, SEO, tags). | `src/lib/ai/provider.ts:356-387` (body at :362-370) |
| F-02 | The retry loop resends the **identical** payload after an HTTP 400, so the "retry" can never succeed. That is the owner's exact message, *"AI structured generation failed after retry"*. | `provider.ts:411-447` (catch :437-442, throw :447) |
| F-03 | The same hard-coded `max_tokens` appears in `generate()`, `generateJSON()`, `generateVision()`, `generateStream()` and `geminiChatFallback()`. | `provider.ts:229`, `:310`, `:478`, `:637`, `:940` |
| F-04 | The correct pattern already exists: `isReasoningModel()` → `max_completion_tokens` + `reasoning_effort`, no temperature, plus 400-retry fallbacks for each parameter. Only `generateVisionJson` uses it. | `provider.ts:~525` (`/^(o\d\|gpt-5\|gpt-6)/i`), `:537-620` (fallback :560, :604) |
| F-05 | The router picks the model from env: light = `AI_MODEL` (default gpt-4o-mini), heavy = `AI_MODEL_HEAVY`, used only in sprint mode. The owner sees the error on **SEO (light tier)** as well as description/sensory (heavy tier). That means the deployed `AI_MODEL` itself is a reasoning-class model. | `src/lib/ai/router.ts:47-49`, `:79-82`; `src/lib/ai/suggestions.ts:92,146,208,268,305` |
| F-06 | Blast radius: `generateStructured` has 12 caller files, `generateJSON` 15, `generate` 14 and `generateVision` 2 (loyalty, purchasing, CCRS advisor, reports, CMS, promotions…). **Many other AI buttons across the back office fail the same way.** This is not a products-only bug. | grep counts, section 10 |
| F-07 | Reasoning models spend part of `max_completion_tokens` on hidden reasoning. The current budgets (320 for descriptions, `suggestions.ts:93`; 400–700 elsewhere) can come back **empty** even after the parameter is fixed. | `suggestions.ts:93`; `provider.ts:415` |

**Fix design (slice E-0):**
- One pure `buildChatPayload(model, {system, user, maxTokens, temperature, responseFormat, reasoningEffort})`
  in a new `src/lib/ai/chat-payload-core.ts`, with self-tests.
  - Reasoning models get `max_completion_tokens = max(requested × 4, 2000)` and `reasoning_effort: "low"`,
    and temperature is omitted.
  - Other models get `max_tokens` + `temperature`.
- One shared `postChat()` that, on a 400 naming `max_tokens`, `temperature`, `reasoning_effort` or
  `response_format`, rewrites that one parameter and retries **once**. This is the `generateVisionJson`
  logic, lifted.
- All six call sites use it.
- The usage ledger records the parameter variant used.
- A pure test asserts that no request path can build a body containing both `max_tokens` and a
  reasoning-class model.

---

## 3. KB grounding: is the AI actually connected to the KB?

**Single-product drafts: YES, and well.**
- `generateProductDescription` / `Sensory` / `Effects` call `buildGroundedFacts()` (`suggestions.ts:78`,
  `:126-160`, `:188-218`).
- `buildGroundedFacts()` pulls 11 sources in parallel: strains (2,372 seeded rich strains,
  `src/lib/ai/kb/strains-data.ts`), terpenes, cannabinoids, effects, formats, compliance rules, category
  vocabulary, brand facts, notes, the **exact per-SKU `kb_products` record**, and the deep category taxonomy
  (`src/lib/ai/kb/retrieval.ts:633-646`).
- Provenance is recorded as `kb:N` (`suggestions.ts:99`).

**But there are gaps:**

| ID | Finding | Pin |
|---|---|---|
| F-08 | `generateProductAi` builds `ProductFacts` **without `vendor`**, so `loadBrandFact(brand, vendor)` never gets the vendor. The same is true in bulk AI. | `src/app/admin/products/actions.ts:317-325`; `bulk-ai/actions.ts:48-56`; `retrieval.ts:643` |
| F-09 | Strain matching is a plain substring test on name + strain (`haystack.includes(c)` with 3+ characters). Short aliases can false-match ("OG", "Kush"), and misspellings never match. There is no fuzzy or trigram fallback and no confidence. | `retrieval.ts:605-615` |
| F-09b | The exact-SKU lookup needs `product_slug` to equal the slugified POS name **and** `brand_slug` to match exactly. Cultivera-style names with sizes or prefixes rarely match, so the strongest source is usually missed. | `retrieval.ts:530-560` |
| F-09c | SEO and tags (`suggestions.ts:248-305`) do **not** call `buildGroundedFacts`. SEO is grounded only on the card's own description, aroma and flavor. | `suggestions.ts:248-305`; `actions.ts:333-349` |
| F-09d | Nothing the media AI already knows about the product's **attached photo** (`ai_description`, `visible_text` such as "PHAT PANDA Gelato 3.5g", `brand_seen`) is passed to any product draft. The visual facts and the copy facts never meet. | `src/lib/media/media-describe-core.ts:338-340` vs `suggestions.ts:27-36` (no such field) |
| F-09e | Each kind (description / sensory / effects / SEO / tags) is a **separate** model call and button. Five round trips, five budgets and five reviews per product. | `actions.ts:327-353` |

**Bulk AI: also KB-grounded** (it calls the same `generateProductDescription`), so the owner's worry is
partly unfounded. Its real problems are listed in section 4.

---

## 4. Bulk AI

| ID | Finding | Pin |
|---|---|---|
| F-10 | Descriptions only. No aroma, flavor, effects, SEO or tags. | `bulk-ai/actions.ts:25-74` |
| F-11 | Hard cap of 25 per press, run **in sequence** inside one server-action request. There is no `maxDuration` export on the page, so it uses the platform default. 25 heavy calls can time out midway. | `bulk-ai/actions.ts:36`, `:44-62`; only `[key]/page.tsx:70` sets `maxDuration` |
| F-12 | Errors are swallowed (`catch { failed += 1 }`). With F-01 live, **every** item fails and the owner only sees `failed=25`, with no reason. | `bulk-ai/actions.ts:60-62` |
| F-13 | The pick list is the first 60 missing-description products, **all pre-checked**. There is no vendor, stock, category or brand filter and no select-all / none. | `bulk-ai/page.tsx:60`, `:136` |
| F-14 | Accepting writes only `description`. The `short_description` the model produced is kept in `input_summary` and lost. | `bulk-ai/actions.ts:98-100`; `suggestions.ts:107` |
| F-15 | Accepting is one-by-one. There is no "accept all high-confidence", no inline edit, and no publish step after accept. | `bulk-ai/page.tsx` review grid (~:160-210) |

Reusable infrastructure already exists: the Gemini **Batch** engine with cron tick, families, requeue and cost
ledger (`src/lib/ai/gemini-batch-server.ts:1-40`) and the lookup-job runner (`src/lib/catalog/lookup-job-*`).
Bulk enrichment should ride on these instead of a single request.

---

## 5. Publishing and drafts

| ID | Finding | Pin |
|---|---|---|
| F-20 | Only **published** enrichment reaches the public menu: `mergeForDisplay` (`src/lib/enrichment/store.ts:354`), the snapshot reader `.eq("status","published")` (`src/lib/site/public-snapshot-server.ts:104-111`), sensory and facts overlays (`src/lib/menu/product-sensory-server.ts:54`, `product-facts-overlay-server.ts:80`). A draft with a photo shows nothing. This explains *"several products that have an image, but are drafts"*. | as listed |
| F-21 | Publish is **one product at a time**: `setEnrichmentStatus` handles one `key` and redirects back to that product. | `actions.ts:278-307`; form `[key]/page.tsx:1169` |
| F-22 | No selection exists on the list. The grid has 0 checkboxes (`src/components/admin/products/ProductGrid.tsx`), and the table rows have none (`page.tsx:715-770`). No bulk action bar. | as listed |
| F-23 | There is no "ready to publish" filter (draft **and** has an image, or draft with description + image). `gap=image` means *missing*, and status filters can't combine with "has image". | `page.tsx:201-206`, `:519-531` |
| F-24 | Publishing runs `writeBackOnPublish` per product (a KB promotion that reads the full row plus accepted suggestions). A bulk publish must batch or queue this to stay within time. | `actions.ts:290-293`; `src/lib/ai/kb/writeback.ts:514-535` |

---

## 6. Image recommendation (the 14,000 photos)

The media library is rich: `media_assets` has vendor_id, brand_id, product_name, strain_name, platform,
visible_text, ai_description, ai_caption, ai_tags, role, pack_size, colors and quality_score
(`supabase/migrations/0352_media_library_v2.sql:92-136`). It also has a weighted full-text and trigram search
(`0352:200-220`, `:759-818`). The enrichment page barely uses any of this.

| ID | Finding | Pin |
|---|---|---|
| F-30 | The command-center **"Suggested images"** reads `listMedia({usageType:"product", limit:400})`, i.e. only the newest 400 product photos out of about 14,000. | `src/lib/enrichment/command-center.ts:376`; `src/lib/media/store.ts:252-260` |
| F-31 | That ranking (`scoreMediaCandidate`) looks only at `title + alt_text + tags`. It ignores the vendor, product_name, visible_text, ai_description, role, pack size and image memory. Brand is passed as `null`. | `src/lib/enrichment/match-core.ts:154-163` |
| F-32 | Only the top **5** are shown. | `command-center.ts:328` |
| F-33 | The picker's default scope is `product` (`parseLibraryScope` → anything but "all" becomes "product"). Both the reader and the view drop non-`product` usage rows, so photos filed as marketing, vendor-menu etc. are hidden unless the owner clicks "All images". | `src/lib/media/library-picker-core.ts:142-144`, `:206`; `library-picker-server.ts:133`, `:191` |
| F-34 | Typed search is **all words must match**, both in SQL (`string_agg(w || ':*', ' & ')`) and client-side. "Phat Panda Gelato 3.5g Indoor" fails if any one word is missing from the photo's text. The trigram rescue (`s >= 0.3`) compares the whole query against single fields. | `0352_media_library_v2.sql:782`, `:807-810`; `library-picker-core.ts:171-178` |
| F-35 | The picker pool is search hits + vendor/brand-scoped rows (capped at **3,000**, newest first) + newest 400. That works only when the enrichment row already has `vendor_id`/`brand_id`. Many unenriched cards have neither, so the pool falls back to the newest 400. | `library-picker-server.ts:37-38`, `:104-125`, `:176-183`; `[key]/page.tsx:104-110` |
| F-36 | **No semantic or visual similarity.** The migration states that pgvector 0.8.0 is available but was deferred ("M4 adds the embedding column"). It was never added: no `embedding` column or function in any migration or in `src/lib`. "Find similar" is rule-based (`media_similar`: same vendor, name, label). | `0352_media_library_v2.sql:77-80`; `library-picker-server.ts:216-224` |
| F-37 | The best signal, **"you picked this before" (image memory, confidence 97)**, plus the on-record ladder (`recommendImages`), runs **only on the inventory drafts / onboarding page**, never on the enrichment page. | `src/lib/catalog/image-memory-server.ts:135-183`; callers only `src/app/admin/inventory/drafts/*`, `OnboardingImagesPanel.tsx` |
| F-38 | Name scoring is token overlap (`hits/nameTokens`) with caps and boosts. Pack-size words are dropped (`idTokens`), so a 1 g and a 28 g photo score the same. There is no vision check that the photo actually shows this product. | `src/lib/catalog/image-recommend-core.ts:158-160`, `:185-232` |
| F-39 | The detail page runs **two** recommendation systems side by side: the command center (F-30/31) and the picker (F-33…35), with different pools and scores. The owner sees inconsistent answers. | `[key]/page.tsx:104-200`, `:554-680` |

---

## 7. Navigation, vendor workflow and stock focus

| ID | Finding | Pin |
|---|---|---|
| F-40 | The list carries filters into the detail link (`withBackParam`, `page.tsx:72-73`) and the detail page shows `BackLink back={back}` (`[key]/page.tsx:222`). But **every** action redirects to `/admin/products/${key}?saved=1` (or `?error=` / `?ai=1`) **without `back`**: 54 redirects in `actions.ts` (e.g. `:274`, `:307`, `:368`, `:488`, `:551`, `:570`, `:628`, `:665`, `:695`, `:718`), and the forms don't post a `back` field. Only the library search form carries it (`MediaLibraryPicker.tsx:145`). After the first save, "Back" goes to the unfiltered list. | as listed |
| F-41 | There is no **Save & next / Previous / Next in this list** on the detail page. Working a vendor means back → find the next row → click, 2,000 times. | `[key]/page.tsx` (no match for next/prev) |
| F-42 | The list renders only the first **300** results, with no pagination. | `page.tsx:232`, `:715`, `:774-776` |
| F-50 | The "vendor" filter is a **delivery-vendor** filter. Its options are built only from vendors on deliveries shown in the manifest picker (`deliveryVendorChoices`), which is capped at the 100 newest manifests (`ENRICH_PICKER_MAX`). The whole control disappears when attribution can't be read. Cultivera-imported cards (no delivery) can't be filtered by vendor. | `page.tsx:215`, `:484-493`; `src/lib/enrichment/enrichment-manifest-core.ts:72`, `:364-416`, `:341` |
| F-51 | The stock filter exists (`in-stock` / `low-stock` / `unavailable`), but it is **opt-in**, single-value (no "on hand = in or low") and not quantity-based. `inventory_status` is kept live by sales (`src/lib/inventory/sale-decrement.ts:179`). Low stock means ≤ 3 units (`src/lib/pos/draft-injection-core.ts:254-259`). Real `on_hand_qty` lives on `inventory_lots` (`src/lib/inventory/types.ts:160`) and is never shown or sorted on the list. | `page.tsx:533-538`; `src/lib/enrichment/match-core.ts:487-492`, `:615` |
| F-52 | There is no per-vendor progress ("Phat Panda: 41/63 enriched, 9 ready to publish"). The batch-lookups page has a `VendorProgressTable` for *lookups* (`src/app/admin/inventory/batch-lookups/VendorProgressTable.tsx`). That pattern should be reused. | as listed |

---

## 8. Roadmap: slices

Each slice ships as its own PR under the standing rules, with pure cores plus self-tests and scoped tsc /
eslint / vitest. Drafts-only (AGENTS rule 3) still holds: the AI never publishes on its own. "Accept" and
"Publish" are always a person's click, including in bulk.

### E-0 · Hotfix: AI request parameters (fixes the owner's error). *Small. Ship first.*
- `chat-payload-core.ts` + shared `postChat()` as designed in section 2. All six paths migrated (F-01…F-07).
- Larger token budgets for reasoning models. Bulk-AI shows the **first error reason** instead of a bare
  count (F-12).
- The provider health line on `/admin/products` shows the resolved light/heavy model and whether it is
  reasoning-class.

### E-1 · Worklist v2: vendor-first, on-hand-first, keep my place. *Medium.*
- **True vendor filter** over all live cards. Vendor is resolved from
  `enrichment.vendor_id → lot.vendor_id → brand→vendor`. Every vendor is listed with counts, for example
  "Phat Panda (63 · 41 on hand)". It is independent of delivery attribution (F-50).
- **On hand** becomes the default stock focus (in + low stock), with an "Include sold-out" toggle. A
  quantity column and sort come from `inventory_lots.on_hand_qty`, summed per card (F-51).
- **Vendor progress strip**: the vendor's enriched / ready / missing counts, plus a "Next vendor →" button
  (F-52).
- **Keep my place**: every action form posts `back`, and every redirect keeps it through a single
  `detailRedirect(key, back, flash)` helper (F-40). A lint/scanner test fails on any bare
  `/admin/products/${key}?saved` redirect.
- **Prev / Next / Save & next** inside the filtered list. The list's ordered keys are stored in the `back`
  query, so the detail page can compute its neighbours without re-querying (F-41).
- Pagination beyond 300 (F-42).

### E-2 · Bulk publish: select, select all, publish. *Medium.*
- Checkboxes on table and grid rows, "Select all on this page" and **"Select all N matching this filter"**,
  and a sticky action bar (F-22).
- Actions: **Publish**, Unpublish, Archive, Set brand/vendor, Draft with AI (sends to E-4).
- A **pre-flight panel** before publish: "38 ready · 4 have no photo · 2 have only the placeholder
  description". The owner chooses "publish the ready ones" or "publish all".
- **"Ready to publish"** filter and stat card: draft + has photo (+ optionally a real description) (F-23).
  This is the one-click answer to the draft-with-photo backlog.
- Chunked server action with `maxDuration = 300`. Each row is audited, there is one summary audit, and
  `revalidatePublicMenuSurfaces` runs once. KB writeback is queued per product and runs after (F-24).

### E-3 · Image recommender v3: see all 14,000 photos. *Large. Includes one migration.*
- **One recommender** for both the command center and the picker, replacing the newest-400 path (F-30,
  F-39).
- **Candidate generation (recall)**, unioned:
  1. image memory + on-record (bring R51's ladder to the enrichment page, F-37);
  2. vendor/brand-scoped rows;
  3. `media_search` in **OR / ranked mode**: a new `p_mode='any'` that ORs the terms and ranks by coverage,
     fixing F-34;
  4. **vector nearest neighbours** (below).
  Scope defaults to all usages, with product-role photos ranked first (F-33).
- **Embeddings (migration 03xx)**:
  - `media_assets.embedding vector(…)` (HNSW index), built from `product_name + strain + vendor + brand +
    visible_text + ai_caption + ai_description + pack_size`. Filled by a cron backfill that reuses the
    media-describe runner and ledger. Each card's query vector comes from its name, brand, vendor, strain and
    category.
  - Hybrid ranking with **Reciprocal Rank Fusion** (full-text + vector), the method in Supabase's own
    hybrid-search guide.
  - Optional phase 2: true **image** embeddings (a CLIP-class model) to find visually identical packshots
    across vendors and to deduplicate.
- **Re-rank (precision)**: the top ~12 candidates are scored on vendor match, pack-size match (stop dropping
  sizes, F-38), role (product/packaging > logo/banner), quality_score, published state and memory.
- **Visual confirmation (optional, per click or in bulk)**: the vision model looks at the top 3 thumbnails
  plus the product facts and answers "is this Phat Panda Gelato 3.5g? yes/no/partly + why". This uses the
  working `generateVisionJson` path.
- UI: 8–12 tiles with a confidence band and why-chips ("Same vendor · Label reads 'gelato' · Pack 3.5g ·
  Picked before"). One-click **Attach + set cover**. Every attach is written to `product_image_memory`, so
  each decision improves the next card of the same identity.
- **Bulk image match**: for a vendor, propose the best photo for every on-hand card with no image. The owner
  approves a grid (keyboard: ✓ / ✗ / next).

### E-4 · AI drafting v2: one grounded "Enrich this product". *Medium-large.*
- One structured call returns **all fields**: display name, description, short description, SEO title, meta,
  aroma, flavor, terpenes, effects, tags and strain type. Each field carries its own `confidence` and
  `evidence: ["kb:strain:gelato", "kb:product:published", "photo:visible_text", "pos:thc"]` (F-09e).
- The facts block adds the **vendor** (F-08), the **attached photo's** `visible_text` / `ai_description` /
  `brand_seen` (F-09d), the KB block for SEO and tags too (F-09c), and lot/COA potency.
- Better KB matching:
  - trigram/fuzzy strain matching with a minimum alias length and confidence (F-09);
  - an exact-SKU lookup that tries normalized names (sizes and prefixes removed) and identity keys before
    giving up (F-09b).
- **"Best guess from proven KB data"**, the owner's words: when the exact product is unknown, the draft may
  use strain-family, terpene and category norms. It is labelled *Best guess (KB: strain family)* with lower
  confidence, so the owner can see what is known and what is inferred.
- Review card: every field shows a diff against the current value plus its evidence chips. Buttons: Accept
  all ≥ 85 · Accept field · Edit · Reject. Compliance re-scan at accept stays (`accept-gate`).

### E-5 · Bulk AI v2: vendor batches in the background. *Large.*
- "Draft with AI" for a selection or a whole vendor queues a **job** (reusing `lookup-job` + cron). It runs
  E-4's all-fields call per product. Progress shows on the vendor strip, and failures show their reason
  (F-10…F-12).
- For large runs, an option to use the provider's **Batch API** (asynchronous, about half price, results
  within 24 h). Gemini Batch is already integrated, and OpenAI's Batch API works the same way.
- Review grid v2: filter by vendor and confidence, **accept all high-confidence**, inline edit, then
  **Accept & publish** (still a person's click) (F-13…F-15).

### E-6 · The Enrichment Copilot: the AI partner. *Large. Builds on E-1…E-5.*
A focused split-screen **work session** for one vendor, on-hand first:
- Left: the product (POS facts, lots and quantity, COA).
- Centre: recommended photos (E-3) and the drafted fields with evidence (E-4).
- Right: a **chat partner** grounded in this product's KB block, the photo descriptions and the vendor's
  other enriched products. The owner can say "this is actually the live-resin version", "use the second
  photo" or "make it shorter". The partner proposes field changes as structured diffs and never writes
  directly (same safety model as Partner AI, `src/lib/ai/partner-core.ts:1-20`).
- **Visual inspect**: "look at this photo — what does the label say, what strain, what size?" uses
  `generateVisionJson` on the candidate.
- Keyboard flow: `A` accept-all-high, `1–9` pick photo, `P` publish, `N` next, `S` skip. A session counter
  shows "Phat Panda 41/63 · 22 min".
- **Learning loop**: every accept or reject trains `product_image_memory` and fact memory
  (`src/lib/catalog/fact-memory*`). Every accepted product promotes into `kb_products` through the existing
  writeback, so the next lot of the same product is pre-filled at confidence 97.
- **Vendor pre-pass** (optional): before the owner opens a vendor, the job (E-5) has already drafted every
  on-hand card and matched photos, so the session is mostly review-and-approve.

### E-7 · SOP-10 + Concierge. *Small.*
- `docs/sop/SOP-10-product-enrichment.md` for the daily flow below, the SOP sheet slug `enrich`
  (already linked at `page.tsx:299`), and Concierge coverage rows.

**Proposed SOP-10 daily flow** (after the slices):
1. Products → filter **Vendor = X**, **On hand** (default) → the vendor strip shows what is left.
2. Press **"Ready to publish"** → select all → pre-flight → Publish. This clears the draft-with-photo
   backlog.
3. Select the rest → **Draft with AI** (all fields) + **Match photos**, as a background job.
4. Open the **Copilot session**. For each card: check the photo, glance at the evidence chips, accept, then
   `P` and `N`.
5. When the vendor shows 100%, press **Next vendor →**. Sold-out products wait until every on-hand vendor is
   done.

**Rough size:**
- E-0: about ½ day.
- E-1 and E-2: about 1–1½ days each.
- E-3: about 2–3 days (migration + backfill).
- E-4: about 1½ days.
- E-5: about 2 days.
- E-6: about 3 days.
- E-7: about ½ day.

**Recommended order:** E-0 → E-2 (immediate publishing win) → E-1 → E-3 → E-4 → E-5 → E-6 → E-7.

---

## 8b. Progress

| Slice | PR | Status | What shipped |
|---|---|---|---|
| E-0 | #1798 | merged | `src/lib/ai/chat-payload-core.ts` (pure: `isReasoningModel`, `buildChatPayload`, `adjustPayloadFor400`, `friendlyAiError`, 30 self-tests). `provider.ts` `postChat()` now builds every OpenAI-style body (generate, generateJSON, chatRaw → generateStructured, generateVision, generateStream). Reasoning models get `max_completion_tokens = max(4 × budget, 2000)`, no temperature, `reasoning_effort: "low"`. A 400 naming a parameter is repaired and resent (≤ 3 sends). generateStructured no longer re-sends an identical failing 4xx. Bulk AI shows the first failure reason and the drafting model; `/admin/products` shows light/heavy model ids and "(reasoning)". `geminiChatFallback` keeps `max_tokens` on purpose (Gemini accepts it; R66 pins it). `generateVisionJson` keeps its own (already-correct) loop. Vendor was NOT added to bulk facts: published menu items carry no vendor field (needs E-1's vendor resolver). |
| E-2 | #1799 | merged | `src/lib/enrichment/bulk-publish-core.ts` (pure: `planBulkStatus`, `isReadyToPublish`, `bulkPreflight`, `resolveBulkKeys`, `bulkOutcomeMessage`, 34 self-tests). `/admin/products`: a checkbox on every grid card and table row, a sticky bulk bar (`BulkStatusBar.tsx`) with "Select all on this page", **"Select every card matching this filter"** (up to 2,000), Clear, a live pre-flight ("N ready · N have no photo · N have no real description → Publish will change about N"), a Publish rule picker (ready = draft + photo [default] / photo + real description / every ticked), and Publish · Unpublish · Archive. New **"Ready to publish"** filter (`gap=ready`) and call-out with count. `bulkSetEnrichmentStatusAction`: one chunked UPDATE (`setEnrichmentStatusForKeys`, 200 keys per round trip), one summary audit `product.bulk_<status>` listing every changed key and the skip reasons, one `revalidatePublicMenuSurfaces`, KB write-back 4 at a time inside a 200 s budget (leftovers are reported, they stay live). Returns to the same filtered list with an `?ok=` sentence. `maxDuration = 300` on the page. The default publish rule answers owner Q2 provisionally as "photo only"; change the default in the picker if the owner decides otherwise. |
| E-1a | #1800 | merged | `src/lib/enrichment/worklist-core.ts` (pure: `resolveCardVendor` enrichment → lot → brand → POS vendor name, only to vendors that exist; `parseWorklistStock` with **on hand = in + low stock as the default**; `onHandByCard`; `vendorProgress` / `nextVendor` / `vendorOptionLabel`; `pageWindow`; 36 self-tests) and `worklist-server.ts` (server-only reads: vendors + aliases + brands, and `inventory_lots.on_hand_qty > 0` chunked by lot key; each returns null on failure and the page says so). `/admin/products`: a **true vendor** select `?vv=` listing every vendor as "Phat Panda (63 · 41 on hand)" plus "No vendor on file" (S22's delivery `?vendor=` is untouched); the stock select now defaults to **On hand** with **Include sold-out** (`stock=all`); an **On hand** quantity column (table), "N on hand" on each grid card, and a "most on hand first" sort (`sort=onhand`); a **vendor progress strip** (published / ready / missing copy / missing photo, % bar) with **"Next vendor →"** (next A–Z vendor with unpublished on-hand cards); pages of 300 with Previous/Next (`page=`) instead of the hard 300 cap. The "Ready to publish" call-out links with `stock=all` because its count covers every live card. Q7 answered provisionally as on hand = in-stock + low-stock (the menu's stock status); the quantity column shows the real units. |
| E-1b | #1801 | merged | `src/lib/enrichment/detail-nav-core.ts` (pure: `cleanBack` keeps only a query string, `detailUrl(key, back, flash, hash)` the ONE detail-redirect builder, the stored list order, `neighbours`, `parseStatusIntent`; 32 self-tests). **Keep my place:** all 20 key-posting forms on `/admin/products/[key]` now also post `back`, and every action in `products/actions.ts` reads `listBack = cleanBack(formData.get("back"))` and redirects through `detailUrl(...)` (about 50 redirects; no bare `/admin/products/${key}?saved` remains, and a scanner test fails on any). After saving, publishing, accepting an AI draft, attaching a photo and so on, "← All products" returns to the same filtered list and page. **Prev / Next:** the list records its ordered keys (up to 2,000) for its own query string in the browser session (`WorklistOrderRecorder`). The detail page shows "← Previous · N of M in your list · Next →" at the top, and **Save & next →** / **Publish & next →** under the publish bar, without re-running the list query. They only appear when the product was opened from a list in this browser tab. |
| E-3 | #1802 | merged | `src/lib/enrichment/image-recommend-v3-core.ts` (pure, 33 self-tests) + `image-recommend-v3-server.ts`. **One "Recommended photos" panel** on `/admin/products/[key]` (up to 12 tiles, each with confidence, why-chips and the reasons on hover). The pool is now: pictures remembered for this product identity (0279) and pictures already approved on another card of the same identity, both fetched by id; the full-name search; one search per own name word (so one odd word no longer hides a photo, F-34); the vendor's and brand's whole shelf (vendor = the card's own vendor, else the brand's vendor / POS vendor name, the E-1a resolution); and the newest pictures of the whole library (no longer only "product" usage, F-30). Order: remembered → on record → confidence, with small tie-breaks for the same pack size and a real product photo; photos already attached go last. **Attach** and **Attach as cover**; every attach from the detail page now writes image memory (F-37), so the next card of the product is offered the same photo first. The old "From the media library" list in Suggested matches now points to the panel. Not in this slice: embeddings / vision confirmation (owner Q5). |
| E-4 | #1803 | merged | `src/lib/enrichment/ai-draft-v2-core.ts` (pure, 44 self-tests) + `ai-draft-v2-server.ts` + `src/lib/ai/all-fields-draft.ts` + `productAllFieldsSchema`. **"Enrich this product (all fields)"** on `/admin/products/[key]`: ONE structured call drafts display name, description, short description, SEO title + meta, aroma / flavor / terpenes, effects and tags. The facts are read on the server, not from the form: the POS row, the **vendor** (F-08), the attached photos' `visible_text` / `ai_description` / `product_name` / `pack_size` (F-09d; `brand_seen` does not exist as a column, so it is not used), and the KB block. Every fact is tagged with an evidence id (`pos`, `vendor`, `photo:N`, `kb:…`), and each field cites its ids (F-09e). Ids the model invents are dropped. A field resting only on strain-family or category norms is a **Best guess** (capped at 70%), and a field with no evidence is capped at 40%. Effects are re-gated by `checkEffects`, SEO is re-cleaned by `seo-draft-core`, and tags are kept to the allowed list. Each field is stored as one pending suggestion. The review card shows the field label, a **Best guess** badge, a diff against what is on record and evidence chips. **Accept all ≥ 85%** takes the newest draft per field at or above `ACCEPT_ALL_THRESHOLD` (85, a single constant while owner Q3 is open). Best guesses are never included (owner Q4 open), and each draft still passes the accept-time compliance re-scan. Single Accept now also writes display name and short description. Retrieval: strain matching uses whole words, long aliases only and a strict fuzzy floor (0.94 plus a 0.03 lead; "Daydreamer" no longer matches "Dream"; F-09). The KB product lookup tries the name without the pack size and brand prefix (F-09b). The one-field draft buttons stay. Not in this slice: strain type and lot/COA potency as drafted fields. |
| E-5 | #1804 | merged | `src/lib/enrichment/bulk-ai-v2-core.ts` (pure, 38 self-tests) + `bulk-ai-v2-server.ts` + `accept-drafts-server.ts`. On `/admin/products/bulk-ai`, **Draft with AI (all fields, background)** queues the ticked products, or every live product from one **vendor**, into one `site_settings` row (`enrichment_bulk_ai_v2`; no migration). It does not reuse `lookup_jobs`, whose items are manifest lines. The every-minute worker `/api/cron/lookup-jobs` drafts the queue only on a tick that had nothing else to do: no lookup, no automatic start and no background reading. **No new cron** (still 23). Each product gets E-4's own all-fields call (`draftAllFieldsForProduct`), so there is one code path. Safety follows the background-reading pattern: compare-and-swap writes on `updated_at`, a lease of 540 s budget + 260 s slack = the route's 800 s, a per-product claim, at most 12 products a run, and a product only starts if a 150 s worst case still fits. A product left half-done by a killed run is re-queued once. A failure keeps its `friendlyAiError` reason, waits for the next run (it is never retried seconds later) and is marked failed after 2 tries. The page shows a progress line, a **vendor strip** ("Vendor: 3 of 10 drafted"), a **failure list with reasons** (F-10…F-12) and **Cancel**. Review grid v2 groups all-fields drafts by product, with **vendor** and **minimum-confidence** filters (Any / 50 / 70 / 85), best-guess badges and evidence chips (F-13). Per product there are **Accept all ≥ 85%** and **Accept all ≥ 85% & publish**, both still a person's click (F-14/F-15). Publish follows the worklist's default rule: only a draft that **has a photo** is published, otherwise the flash says why. The accept logic moved into `accept-drafts-server.ts`, so the product page and the grid share one writer, with the compliance gate first and best guesses never included (Q4). The old description-only grid stays. Not in this slice: the provider **Batch API** option (owner Q6 open) and inline edit on the grid (use Open product). |
| R-1 | #1805 | merged | **Owner round 2.** One enrichment model: `src/lib/ai/enrich-model-core.ts` (pure, 16 self-tests) resolves `AI_ENRICH_MODEL` → `AI_MODEL_HEAVY` → `gpt-4o` and `AI_ENRICH_REASONING_EFFORT` (default medium); a Gemini id is sent to Gemini's OpenAI-compatible endpoint with the Gemini key (`chatTargetFor` in `provider.ts`). Recommended: live drafting `gpt-6.1-sol` effort medium, overnight batch `gemini-4-carbon`, hardest cards `gpt-6-astra`. Accept-all threshold 80. **Confidence calibration** (`calibrateConfidence`): a field resting on direct evidence (POS, vendor, photo text, COA) is lifted to at least 80, +5 per further direct source, max 95; best guesses keep their 70 cap and no-evidence keeps 40. **Best guesses are accepted by Accept all** and flagged (`ai2:…|best-guess`) in a new **Needs a closer look** list on the product page and Bulk AI, cleared by **Looks right** (`|checked`, audit `product.ai_best_guess_checked`). **Publish on photo**: after a person attaches a published photo (upload, matched media, vendor image, research image, intake drafts) the card publishes (`photoPublishDecision`, audit `product.published` reason `photo-attached`). **On hand** = at least one lot with stock, or the menu says in/low stock (`isOnHandCard`). |
| R-2 | #1806 | merged | **Owner round 2:** "please also include the ai the ability to draft strain type and potency from the lot/ coa, as well as any source available to it to for making drafts. please also include this round the ability to edit a draft directly on the bulk grid." `src/lib/enrichment/lot-evidence-core.ts` (pure, 26 self-tests) turns up to 3 of the product's lots (in-stock first, the Q7 on-hand rule) and their lab certificates into evidence lines `[lot:N]` / `[coa:N]` (strain type, manifest potency, COA total THC / CBD, lab-measured terpenes). Lot and COA are **direct evidence**. The all-fields call now also drafts **Strain type** and **Potency (THC / CBD)**. A potency number is kept only if it matches a POS / lot / COA number (within 0.05 % or 0.5 mg; `checkPotencyDraft`), so a number is never invented, and a best-guess potency is never taken by Accept all (`NEVER_AUTO_GUESS`). An accepted strain type / potency is written to the product's own menu cards (published + intake-staged) and stamped `reviewer` in `fact_provenance` (`card-facts-write-server.ts`). **Edit a draft in place:** `src/lib/enrichment/draft-edit-core.ts` (pure, 21 self-tests) gives every draft an editable box on the Bulk AI grid and the product page (**Save & accept** / **Reject**). The edited text is re-checked by kind (SEO re-cleaned, tags kept to the allowed list, effects through `checkEffects`, strain type canonical, potency parsed and bounded) and then passes the same compliance gate; the row stays `accepted` with `|checked|edited` and the audit keeps the original and the saved value. After Save & accept the grid returns to the same product (`#product-…`). |
| R-3 | #1807 | merged | **Owner round 2 (Q6):** "I want both options available for the quickly finding results, or batch lookups for over night runs. please build it so I can chose in the enrichment page/ detail. make sure it is clear and obvious which is which and how to use both." Two modes, named the same everywhere (`ENRICH_MODES` in `src/lib/enrichment/enrich-batch-core.ts`): **⚡ Draft now (live)**, which drafts within minutes at the normal price, and **🌙 Add to the overnight batch**, which is back within 24 hours (usually a few) at about half the price through Google's Gemini Batch API. `/admin/products/bulk-ai` shows a two-card chooser (when to use each, speed, price and how), a status block for each mode, and one picker with both buttons. The product page has **⚡ Enrich now (live, all fields)** and **🌙 Add to the overnight batch** with an explainer and this product's overnight status. Overnight state is one `site_settings` row (`enrichment_batch_ai`; no migration) that is separate from the lookup engine's `ai_batches`; Google display names use `greenway-enrich-`. It runs on the idle tick of `/api/cron/lookup-jobs` (**no new cron**, still 23; when it did work, the live queue waits for the next tick). Each tick does three things in order. It recovers an orphaned send by looking the name up at Google. It polls and ingests open batches. Then it sends queued products as one batch: after 2 minutes of gathering, at most 200 products, at most 3 open batches. Safety: compare-and-swap on `updated_at`, an 800 s lease, and the batch record is written **before** Google is called. A refused batch returns its products (the try is not counted) and pauses sending for 30 minutes. A bad answer is re-queued once, then failed with its reason. The live and overnight paths share one prompt builder (`buildAllFieldsRequest`) and one store path (`storeAllFieldsResult`), so an overnight draft is the same pending `ai_suggestions` row a live draft makes (strain type and potency checks, compliance, best-guess flags), stamped ` · overnight batch`. The batch requests strict JSON (`responseJsonSchema`), with no web search. Model: `AI_ENRICH_BATCH_MODEL`, else the live model if it is Gemini, else `gemini-4-carbon`. Pure core has 45 self-tests; proven in `tests/compliance/d244-r3-live-vs-batch.test.ts`. |
| R-4 | #1808 | merged | **Owner round 2 (Q5):** "for the embeddings question, I am not sure. is this the professional enterprise grade solution? please use your expert judgement to implement this properly, the right way, not the easy way." Yes: **hybrid search** (keyword + meaning, fused) is the enterprise pattern, so photos are found by meaning and the old name/vendor rules still count. Migration `0365_media_embeddings.sql` adds `media_embeddings` (one row per photo and kind: **text** = name, strain, vendor, brand, AI description; **image** = the picture itself), a pgvector `vector(768)` column with two HNSW cosine indexes, and the RPCs `media_vector_search`, `media_vector_neighbors`, `media_embedding_capability`, `media_embedding_health` (service role only). Where pgvector is not available the file still applies (functions return no rows) and re-running it after enabling the extension finishes the job. Model `gemini-embedding-2` (`AI_EMBED_MODEL`), 768 dimensions, task-prefixed query/document text. Results are merged with **Reciprocal Rank Fusion** (k = 60) in the library search, "Find similar" (adds "Similar description" / "Looks alike") and the product page **Recommended photos** panel ("Matches by meaning" chip). Meaning alone is calibrated to 35-74% and **never reaches High** on its own; when the name also matches it adds +6 (max 88). Vendor scope is respected. The index builds itself on the idle tick of `/api/cron/lookup-jobs` (**no new cron**, still 23; only when the batch and live queues did nothing; lease + compare-and-swap in the `media_embed_state` setting; unchanged photos are skipped by a content hash; 3 tries then "could not be read"). `/admin/media` shows a **Semantic photo search** panel: status, progress, Pause/Resume and Retry (permission `media.manage`, audited). Pure core 55 self-tests (`src/lib/media/media-embed-core.ts`); image-recommend core 40; proven in `tests/compliance/d244-r4-embeddings.test.ts` and `scripts/recon/media-embeddings-0365-pg-check.sql`. |
| R-5 | #1809 | merged | **Owner round 2:** "please finish the last 2 slices." This is strategy slice **E-6, the Enrichment Copilot**, at `/admin/products/copilot`. It is a one-vendor session over the **on-hand** cards that are not published yet (owner: "so long as the system thinks we have at least 1 lot in stock"). Cards **with no photo come first** (owner: "a product should be publish once it has a picture"), then the biggest stock, then A-Z. A skipped card moves to the back and the skip list stays in the URL. The page has three columns. The first shows the product with its lots and lab certificates. The second shows the photos on the card, the recommended photos numbered 1-9, and the pending drafts, each editable with Save & accept / Reject. The third is the **chat**. Keyboard: **A** accept all ≥ 80% (best guesses too, flagged); **1-9** attach a photo (it becomes the cover when there is none, is remembered for the product, and the publish-on-photo rule runs); **P** publish & next (needs a photo and nothing else); **N** next; **S** skip; **D** draft every field now; **/** talk. The chat reads the same evidence as the all-fields draft (POS, vendor, attached photos' vision text, lots + certificates, KB) plus three of this vendor's published cards for house style. It **only proposes**: a strict JSON reply with per-field values, a "based on" line, and a photo number. **Use this** files the (editable) proposal as an `ai2:copilot\|checked` draft and accepts it through the ONE accept path (`acceptDraftWithEdit`: shape check, compliance re-scan, effects gate). Potency is refused unless a lab, lot or POS number says it. **Look closely** reads one photo's label with the vision model. Chat model: `AI_COPILOT_MODEL` (recommended `gpt-6-astra`), else `AI_ENRICH_MODEL`. Every action needs `products.enrich` and is audited (`product.copilot_asked`, `product.copilot_used` / `_use_blocked`, `product.copilot_inspected`, plus the usual accept / publish / photo rows). It is linked from the worklist vendor strip ("Open Copilot session"), the Bulk AI banner, the product page and Help. The pure core has 55 self-tests (`src/lib/enrichment/copilot-core.ts`), and the slice is proven in `tests/compliance/d244-r5-copilot.test.ts`. |
| R-6 | #1810 | merged | **Owner round 2:** "please finish the last 2 slices." This is strategy slice **E-7, SOP-10 + Concierge**, and it completes the roadmap (E-0 … E-7). `docs/sop/SOP-10-product-enrichment.md` (v1.0) is the full procedure: photo-first publishing (owner: "a product should be publish once it has a picture"), on hand = at least 1 lot in stock, the daily per-vendor flow (Ready to publish → Copilot → live or overnight drafts → Accept all ≥ 80% → Next vendor), confidence and best guesses (accepted and flagged, Needs a closer look → Looks right), the Copilot keys, live vs overnight side by side, edit in place, strain type and potency from the lot and certificate, semantic photo search, messages, controls, checklists, a quick reference card and an owner-settings appendix. It is on the SOP Library **Receiving & Inventory** shelf as `sop-10` (`src/lib/sop-library/catalog-core.ts`). The printable one-page sheet `enrich` (`src/lib/catalog/sop-core.ts`) is rewritten to the same flow, and the Product Enrichment HelpPanel now reads its steps from the sheet (`sopForStage("enrich").steps`), so paper and screen cannot disagree; the panel links SOP-10. The empty-state panels say photo-first. **Concierge:** a new `product-enrichment` topic (photo first, on hand, the Copilot and its keys, the 80% rule and best guesses, lot/COA potency, live vs overnight, edit in place, semantic search, the model settings), and the Product Intake line points to it. **Help Center:** "When does a product go live on the menu?" is new; the AI and bulk answers now describe all-fields drafting, Accept all and the two modes. Proven in `tests/compliance/d244-r6-sop10-concierge.test.ts` (SOP facts checked against `ACCEPT_ALL_THRESHOLD` and `COPILOT_KEYS`, every source-map file exists, every link resolves). No migration, no new cron. |
| R-7 | #1811 | merged | **Owner round 3:** "Add more details about the product, like its category and type and vendor assigned to it on the details page at the top of the page with its name. Then use that to help the image recommendations and drafting." The product page now opens with an **identity strip** under the name: Category (with its plain type, e.g. "Cartridge · vape"), Inventory type (POS), POS category, Vendor (linked to the vendor card, with how it was found: set on this card / a delivery / the brand's vendor / the POS vendor name), Brand and Strain. Missing facts are shown in orange, never guessed. The pure core is `src/lib/enrichment/product-identity-core.ts` (26 self-tests). **Photos:** the recommender now knows the type. A photo whose text names this type is lifted (+4, "Same type"), and one that names a *different* type is dropped by 20 ("Different type (vape)"), so a cart photo no longer wins on a flower card. The POS type words join the category match, and the semantic search asks about the type ("Cartridge vape product photo"). **Drafts:** the all-fields prompt (live, bulk, overnight and Copilot) carries `[pos] Product type: … (a vape product — write for this type only)`, `[pos] Inventory type (POS)` and `[pos] POS category` beside the vendor line. Proven in `tests/compliance/d244-r7-identity.test.ts`. No migration, no new cron. |
| R-8 | #1812 | merged | **Owner round 3:** “Many vendors use the same non labeled images for all their like kind products. I want to be able to sort the vendors by type/ category so I can pick a generic on brand image and add it to all their like kind products that would use this image. I want the ai to help with this.” New page **Products → Vendor kits** (`/admin/products/vendor-kits`, also a button on the products banner and the vendor strip). Pick a vendor, sort its cards by website category or POS category, and open a group (e.g. “Cartridge · 14 cards, 9 on hand with no photo”). The page ranks on-brand photos for that group: same vendor or brand (+40), already used on this vendor’s like-kind cards (+8 each, up to 3), product role (+12), same type (+12); another vendor’s photo (−25), a different type (−35), a logo/banner/menu/COA (−30), or a photo whose text names one specific product of the group (−30, “Names Blue Dream”) drop. **Ask the AI** sends up to 4 top photos to the vision model, which says whether each is a generic, no-name photo safe for every product in the group and quotes any label text it sees (generic +10, names a product −40). The AI only reads; nothing is attached until you press **Apply to N products**, with the checkbox list preselected to the cards with no photo and a choice of “add to gallery” (cover only where there is none) or “make it the cover”. Apply re-checks each card belongs to the vendor, never duplicates a photo, records usage, publishes photo-ready cards and writes `product.match_image_attached` per card plus one `product.vendor_kit_applied` audit. The pure core is `src/lib/enrichment/vendor-kit-core.ts` (36 self-tests). Proven in `tests/compliance/d244-r8-vendor-kits.test.ts`. No migration, no new cron. |
| R-9 | #1813 | merged | **Owner round 3:** “I need a way to remove text on a product picture. I want to drag a box over the text, then click a button to remove it. Maybe on the product image card in the main enrichment table, that has the attach and attach as cover buttons, add a remove text button. If there is the perfect image for a product, but it has a different name on it, I want the ai to help recommend the name to be removed from the image. Can we use flux for this or is one of the other ai models we use.” **Answer: both.** The vision model (the media AI model) *reads* the photo and FLUX.1 Fill [pro] (`flux-pro-1.0-fill`, already wired for the newsletter canvas) *removes* the text. Every Recommended photo tile (beside Attach / Attach as cover) and every gallery photo now has **✂ Remove text**, opening `/admin/products/[key]/remove-text?media=…`. Drag boxes on the picture (up to 12). **Find the text (AI)** boxes every piece of text and gives advice against this product: another strain or product name, another size or another brand is ticked to remove, with the reason; this product’s own name and brand are kept, and warning or compliance text is always kept. Optionally say what is under the text (“black jar label”). **Remove text** pads the boxes, builds a black/white mask (white = repaint, refusing masks over 60% of the picture) and FLUX Fill repaints only there; the browser polls every 3 s. Before / After, then **Attach as cover** or **Attach to gallery** (the normal attach: audit, usage, memory, publish-on-photo). The original is never changed. The result is a **new** library photo titled “… (text removed)”, tagged text-removed + flux-fill, with source `text-removed:<id>`, the original’s vendor/brand/role/pack facts, and published only when the original is published with clear rights. **AI hint:** when a tile’s known label text names another product, the tile says “AI: the label names “Gelato” — not this product. Remove that text?” and its button turns orange. Audits: product.remove_text_found / _started / _saved. Pure core `src/lib/enrichment/text-erase-core.ts` (45 self-tests). Proven in `tests/compliance/d244-r9-remove-text.test.ts`. No migration, no new cron. |
| R-10 | #1814 | merged | **Owner round 3, wrap-up:** SOP-10 **v1.1** (sections 4.11 identity strip, 4.12 Vendor kits, 4.13 Remove text; four new messages; controls 6–7; a checklist row; quick-reference lines; source-map rows; version history). The printable Product Enrichment sheet and its HelpPanel (one list) gain the Vendor kits and Remove text steps (8 steps). The Concierge knows all three (identity strip, Vendor kits, Remove text with FLUX Fill). The SOP Library catalog summary and keywords now cover vendor kits, generic photos, remove text and FLUX. Proven in `tests/compliance/d244-r10-sop-round3.test.ts`. No migration, no new cron. |
| R-11 | #1815 | merged | **Owner round 4:** "the remove text feature, I would like it to be available on the copilot feature as well as the brand kit… I want to draw a box on all product images, then click the remove text button. that way I can quickly queue up several images to feed to flux to fix one after the next." A reusable **Remove text from several photos** queue (`RemoveTextQueue`) on the Copilot (card photos + recommended photos; Attach / Attach as cover) and on Vendor kits (ranked photos; Use as the kit photo, then Apply). Tick photos, draw boxes (or Find the text) on each, one press sends them to FLUX Fill one after the next (sequential, max 12). Scope-aware server actions (product or vendor), products.enrich, audited. The **facts/AI first, photo last** helper text (attaching a photo publishes, and the product leaves the list, by design) on the Copilot, Vendor kits and the single-photo editor. text-erase-core 45 → 54 self-tests. Proven in `tests/compliance/d244-r11-remove-text-queue.test.ts`. No migration, no new cron. |
| R-12 | #1816 | merged | **Owner round 4:** "on the bulk draft ai feature, to be able to select one or all drafts waiting for me to approve. I want this page to auto approve the ones that are over 80%. all 250 I am seeing in the list are 85%." Bulk AI gets a sticky **approve bar**: a tick box on every product and every draft, **Select all**, **Approve selected** (a ticked product accepts its drafts at 80%+, best guesses flagged; a ticked draft is accepted as it is), and **⚡ Approve every draft at 80%+** (one confirmed press for every product with one). The browser sends chunks of 8 products / 40 drafts so 250 products never hit the time limit, with a running total. Same compliance re-scan as one-by-one Accept, audit row per product (`via: "bulk-select"`), never publishes. New pure core `bulk-approve-core` (17 self-tests). Proven in `tests/compliance/d244-r12-bulk-approve.test.ts`. No migration, no new cron. |
| R-13 | #1817 | merged | **Owner round 4, wrap-up:** SOP-10 **v1.2** (4.2 "facts and AI first, photo last"; 4.7 step 5 Bulk AI select one / all and ⚡ Approve every draft at 80%+; new 4.14 Remove text from several photos on the Copilot and Vendor kits; three new messages; control 8; checklist; quick-reference lines; source map; history). The printable sheet / HelpPanel steps teach facts-first, the queue and bulk approve (still 8 steps). Concierge gets three facts; Help gets the bulk-approve Q&A; SOP Library summary and keywords updated. Proven in `tests/compliance/d244-r13-sop-round4.test.ts`. No migration, no new cron. |
| R-14 | #1818 | merged | **Owner round 5:** "I need the word "cure", "cured", and others like it to be a warn only, and the system should allow me to attach facts that use that word… if we can make the system smarter by looking at the words before and after the word cure, or any of the blocked words for that matter, so it will allow the words if used not in a medical way." New pure core `src/lib/ai/compliance-context-core.ts` (76+ self-tests). The rules live in the shared fixture `compliance-patterns.json` → `contextRules` (patterns **version 4**): a window of 4 words before and 5 after in the same sentence, a medical-word list, and word families. The **cure** family (cure/cures/cured/curing) is allowed unless used medically: "miracle cure", "cures your/everything", "a cure-all", "cure for" without a length of time, or a medical word nearby. Treat, prevent, therapy, safe, healthy, kids/children and alcohol stay blocking unless an everyday context is within reach. An allowed hit is a **heads-up** flag naming why, never silent. `checkCompliance` (accept gate, Approve, Attach facts, KB writer, review inbox, display linter) and the owner's banned phrases use it. The crawler mirrors it in Python (`crawler/app/compliance.py`, byte-identical fixture, 9 parity tests incl. the shared examples). The culture desk / curated reviews, the newsletter AI check, the banner/ad check and the deal-copy check read context too. The prompt says the curing process may be described. SOP-10 v1.3 §4.15, Help, Concierge, SOP Library keywords. Test `d244-r14-cure-context`. |
| R-15 | #1819 | merged | **Owner round 6:** "Batch over night lookup fails… Finished: 0 drafted · 396 failed… Google's answer did not fit the draft form: - display_name: is required - description: must be an object…" Cause: the batch request sent `responseJsonSchema`, which Google's Batch API does not reliably honour (python-genai#1307; Google's forum answer says to use `response_schema` with OpenAPI types), and it did not get the shape hint the live path adds. Fix: send `responseSchema` (OpenAPI subset: OBJECT/STRING/ARRAY, propertyOrdering), add the live shape hint to the prompt, and run a tolerant reader before the strict check (`batch-answer-core.ts`). It unwraps wrappers, arrays and JSON strings, lifts flat text to a best guess at 40% confidence, cuts over-long text at a word, and folds enum case. The strict validator still runs after. Plus 🌙 Retry the failed in the next overnight batch. |
| R-16 | #1819 | merged | **Owner round 6:** "does it start right away… I would like a way to either queue up every vendor, or select multiple vendors more efficiently… it does not tell me the vendors added." Bulk AI: **Or tick several vendors** checkboxes and **Every vendor**; the flash names each vendor and its count; the queue box lists vendors in the batch and says when it leaves (`vendor-pick-core.ts`). |
| R-17 | #1820 | merged | **Owner round 6:** "Flux adds weird things to the removed text. Barcodes, more text, fuzzy looking text, etc. it is really bad at this right now. Please deep research how to do this properly from the authoritative docs and sources." Research: BFL's FLUX Erase docs (docs.bfl.ai/flux_tools/flux_erase: no prompt, `dilate_pixels` 0–25 default 10, trained on ~1 MP) and BFL's "Working Without Negative Prompts" (naming a thing makes FLUX paint it). The community crop-and-stitch / paste-back practice keeps everything outside the mask. Fix (`text-erase-core.ts`, `text-erase-server.ts`): Erase first, Fill only as a fallback (positive-only prompt); send at ~1 MP; a feathered paste-back onto the original inside the boxes only; EXIF upright. |
| R-18 | #1821 | merged | **Owner round 6:** "I need a way to select many/ all and approve many/ all drafts awaiting my review on the bulk ai draft page in enrichment." Bulk AI gets ✅ Approve every draft (any confidence, all pages): `listPendingDraftKeys()` pages every pending v2 draft by id (not capped at the grid's 3,000), and `approveEveryDraftChunkAction` (new `approve-all-actions.ts`) runs `acceptHighConfidenceForKey(key, userId, 0)` 8 products per call. The compliance re-scan stays, potency best guesses never auto-accept, there is an audit `via: "bulk-approve-every"`, a Stop button, and nothing publishes. The older description drafts get ✅ Accept all (`AcceptAllDescriptions.tsx`). SOP-10 4.7 step 6. |
| R-19 | #1821 | merged | **Owner round 6:** "I need a way to approve all of the 20,000 records awaiting me in the kb data pipeline. The bronze, silver, gold page… too much of it to go through one by one with system wait time from thinking and such." New pure `kb-bulk-review-core.ts` (17 self-tests): quality bar (same `scoreProduct` as the review card), source filter, compliance gate, totals, messages. `kbBulkPublishPageAction` reads 500 drafts by keyset id, scans each with `checkCompliance` + the banned phrases, publishes the passing ones 100 ids per UPDATE (`.eq("status","draft")`), and writes the audit `kb.bulk.publish_passing`. `KbBulkPublishBar` sits on the Data pipeline and the Review inbox, with Check first (dry run), a running total and Stop. No AI call, no cron. SOP-10 4.16. |
| R-20 | #1822 | merged | **Owner round 7:** "If this is an actual feature flux has, the results should be significantly better in my opinion. Rather than us just trying to use it in a way it's not meant to be used. We are not doing something right." Diagnosis on his photo (IMG_1262, 550 × 550): Erase got 0.3 MP (we only ever shrank, never enlarged; BFL: trained on ~1 MP, "significant deviations may reduce quality") and a big rectangle over busy packaging (BFL's tips assume SAM-style object masks; Roy & Stenger, BMVC 2024: stroke masks beat box masks, diffusion hallucinates text into boxes), so it painted pseudo-letters. Fix (`text-erase-core.ts` +21 self-tests, `text-erase-server.ts`): crop-and-stitch (ComfyUI Inpaint-CropAndStitch practice) - `eraseCropPlan` cuts the text area with context and enlarges it to ~1 MP (16s, 1:2..2:1, ≤4×); `strokeMask` masks only the letters (median background + MAD threshold, halo; whole box when none found); Erase dilation 6 for a letters mask; `pasteBack` stitches through the same mask. Editor: "The letters only" / "The whole box"; queue: a whole-boxes tick; a detail line after each run. SOP-10 v1.5 4.13. |
| R-21 | #1823 | merged | **Owner round 8:** "I do not want two sections of images, I want to be able to remove text from any and all images available on the vendor kit page, not just the small section at the bottom." Vendor kits had the ranked photo grid plus a separate Remove-text strip of only the first 12 photos. Now one grid (`vendor-kits/KitPhotoGrid.tsx`): clicking a photo still picks the kit photo, and every photo has a ✂ Remove text toggle that feeds the queue below (pure `toggleQueuePick`, 12 at a time, +3 self-tests). `RemoveTextQueue` gains `picked` / `onToggle` / `hidePicker` so the page owns the ticks; the Copilot is unchanged. SOP-10 v1.6 4.14. |
| R-22 | #1824 | merged | **Owner round 9:** "give me the ability to publish the draft from removing the text so it can be suggested on the copilot page. I need every product image I remove text from to be the second highest suggested item behind exact matches. The removed text gives me the ability to use a generic version of their product as a representation. So it's a very valuable image in the list of suggestions. Please also expand the list of suggestions on the copilot page to be every image from that vendor." Text-removed results that were saved as drafts (the original was a draft or its rights were pending) now have a Publish button. It is in `RemoveTextQueue` and `RemoveTextEditor`; the server actions are `queuePublishErasedAction` and `publishErasedAction`, which call `publishErasedPhoto`. The decision is the pure `erasedPublishStep` (+2 self-tests). It requires products.enrich and writes the audit row `product.remove_text_published`. Ranking: `orderRecommendPanel` tiers are picked before > on the card > exact (80%+) > published text-removed photos of this vendor/brand (`genericTierFits`, chip "Text removed · generic") > the rest. `recommendExtras` adds the vendor's published text-removed photos that fell under the 35% floor. The Copilot (`wholeVendor`) adds every vendor/brand photo with no 12-tile cap (`COPILOT_PANEL_LIMIT`), and the page lists them after 1–9 (`copilotMorePhotos`). +14 v3 and +2 copilot self-tests. SOP-10 v1.7 4.17. |
| R-23 | #1826 | merged | **Owner round 10:** "we need to go back to the banned words we have in the system. we have a "compliance guardrails" page in the knowledge base. I want every banned and warning words and phrases to be in this page. I keep getting blocked out right for things that are not disallowed. I need to be in control, and if I choose something is ok to do, thats my choice. please upgrade and enhance that compliance guardrails page to have any and all things that block me from publishing text to be included here. so I can fine tune them myself and enable and disable them as I see fit. please make sure you find everything that blocks, and add it to the page. be methodical please." Built an inventory of every word rule, from 16 sources. The two effect lists moved to the pure `effects-lists-core.ts`. The new pure `guardrails-state-core.ts` holds the owner settings (`{v,rules:{key→block|warn|off},allow[]}`, site_settings `compliance_guardrails`, no migration, +17 self-tests). The new pure `guardrails-catalog-core.ts` lists every rule from the live sources, with readable words and a tester (+18 self-tests). Every word rule reads `ruleLevel` and the allowed words: `checkCompliance`, `checkEffects`, newsletter AI and picture asks, blog templates, culture desk, curated reviews, promotion wording, banner ad check, merch art themes, merch ad, and newsletter design pictures. The sync runs in `loadBannedPhrases`, in 30 server paths that check without it, and in the browser through `GuardrailsSync` in the admin layout. The crawler (`compliance.py`, `store.py`) follows the levels, the allowed words and the Warn phrases. The JSON is unchanged and parity still holds. The page was rewritten with Block / Warn / Off per rule, allowed words, owner phrase edit and delete, a tester, the other checks and Reset all. There are 9 audited actions in `compliance/guardrails-actions.ts`. Test: `d244-r23-guardrails` (24). SOP-10 v1.8 4.18. |

## 9. Owner decisions needed

1. **Models.** Which model is set as `AI_MODEL` / `AI_MODEL_HEAVY` / `AI_VISION_MODEL` in Vercel? (It is
   reasoning-class, per F-05.) Keep it, or use a fast non-reasoning model for bulk drafts and the stronger
   model for the Copilot?
2. **Publish rule.** Should bulk publish require *photo + real description*, or *photo only* (to clear the
   draft-with-photo backlog fast)?
3. **Auto-accept threshold.** May "Accept all high-confidence" accept fields at ≥ 85, or ≥ 90?
   (Publishing remains a click.)
4. **Best-guess copy.** May KB-inferred copy (strain-family norms) go live, labelled internally as best
   guess, or must best guesses stay drafts until a person edits them?
5. **Embeddings.** OK to add one migration (pgvector column + index) and a backfill over about 14,000
   photos? Text embeddings for this volume cost very little (a few cents to low dollars, depending on the
   model). Image embeddings are an optional phase 2.
6. **Batch API.** OK to run overnight vendor pre-passes through a Batch API (cheaper, results within 24 h)?
7. **"On hand"** = in-stock + low-stock (≤ 3 units)? Or a minimum quantity?

### 9a. Owner answers (round 2, verbatim)

- Q1: "I want to use a powerful ai modal that is best suited for the task. I do not mind spending extra for a better quality experience and better quality output. I will let you tell me what to use. we have gpt and gemini available." → `AI_ENRICH_MODEL=gpt-6.1-sol`, `AI_ENRICH_REASONING_EFFORT=medium` for live drafting; `gemini-4-carbon` for overnight batch.
- Q2: "a product should be publish once it has a picture. the other important details like description and facts can come later." → publish on photo (R-1).
- Q3: "lets drop it to 80%." → `ACCEPT_ALL_THRESHOLD = 80`.
- Q4: "best guesses should auto accepted, but flagged so we can take a closer look once we have time to." → Needs a closer look (R-1).
- Confidence: "I have noticed there are times where the ai is 100% accurate yet gives itself a 50% confidence result. if you can make it trust itself better would be great." → `calibrateConfidence` (R-1).
- Q5: "for the embeddings question, I am not sure. is this the professional enterprise grade solution? please use your expert judgement to implement this properly, the right way, not the easy way." → R-4 (hybrid semantic search, pgvector + RRF; see the R-4 row).
- Q6: "I want both options available for the quickly finding results, or batch lookups for over night runs. please build it so I can chose in the enrichment page/ detail. make sure it is clear and obvious which is which and how to use both." → R-3.
- Round 2 extra: "please also include the ai the ability to draft strain type and potency from the lot/ coa, as well as any source available to it to for making drafts." → R-2 (lot/COA evidence). "please also include this round the ability to edit a draft directly on the bulk grid." → R-2 (Save & accept).
- Q7: "so long as the system thinks we have at least 1 lot in stock, we should consider that to be what I mean by "on-hand"." → `isOnHandCard` (R-1).

## 10. Evidence appendix (commands run, read-only)

- `grep -n "max_tokens" src/lib/ai/provider.ts` → 229, 310, 365, 478, 560 (correct), 604 (correct), 637,
  940.
- Caller counts (`grep -rlnE "\bX[(<]" src | grep -v provider.ts | wc -l`): generateStructured 12,
  generateJSON 15, generate 14, generateVision 2, generateStream 0.
- `grep -n "redirect(" src/app/admin/products/actions.ts | grep -c "?saved=1\|?ai=1\|?error="` → 54. None
  read `formData.get("back")`.
- `grep -c checkbox src/components/admin/products/ProductGrid.tsx` → 0.
- `grep -rln embedding supabase/migrations src/lib` → no media embedding column or function (only the
  0352/0354 comments).
- `grep -c "slug:" src/lib/ai/kb/strains-data.ts` → 2,372 seeded strains.

## 11. Research notes (sources)

- OpenAI reasoning models (gpt-5 family, o-series) reject `max_tokens` and require `max_completion_tokens`.
  Many also reject non-default `temperature`. A `reasoning_effort` parameter controls hidden reasoning
  tokens. Sources: https://community.openai.com/t/api-stopped-working-max-tokens-and-temperature-no-longer-allowed/1110863,
  https://www.datastudios.org/post/openai-claude-gemini-api-max-tokens-not-supported-max-completion-tokens
- Hybrid search (full-text + pgvector, Reciprocal Rank Fusion) in Postgres/Supabase:
  https://supabase.com/docs/guides/ai/hybrid-search
- pgvector on Supabase: https://supabase.com/docs/guides/database/extensions/pgvector
- Image search with CLIP embeddings on Supabase: https://supabase.com/docs/guides/ai/examples/image-search-openai-clip
- Product-similarity with CLIP-class models and fine-tuning trade-offs:
  https://www.width.ai/post/image-embedding-models
- OpenAI Batch API (asynchronous, about 50% cheaper, 24 h window):
  https://the-decoder.com/openai-introduces-batch-api-with-up-to-50-discount-for-asynchronous-tasks
