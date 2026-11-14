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
| E-1b | PRNUM_E1B | merged | `src/lib/enrichment/detail-nav-core.ts` (pure: `cleanBack` keeps only a query string, `detailUrl(key, back, flash, hash)` the ONE detail-redirect builder, the stored list order, `neighbours`, `parseStatusIntent`; 32 self-tests). **Keep my place:** all 20 key-posting forms on `/admin/products/[key]` now also post `back`, and every action in `products/actions.ts` reads `listBack = cleanBack(formData.get("back"))` and redirects through `detailUrl(...)` (about 50 redirects; no bare `/admin/products/${key}?saved` remains, and a scanner test fails on any). After saving, publishing, accepting an AI draft, attaching a photo and so on, "← All products" returns to the same filtered list and page. **Prev / Next:** the list records its ordered keys (up to 2,000) for its own query string in the browser session (`WorklistOrderRecorder`). The detail page shows "← Previous · N of M in your list · Next →" at the top, and **Save & next →** / **Publish & next →** under the publish bar, without re-running the list query. They only appear when the product was opened from a list in this browser tab. |

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
