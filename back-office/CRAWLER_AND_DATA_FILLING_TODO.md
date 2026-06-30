# Crawler + Data-Filling — Task List (handoff-ready)

> Companion to `CRAWLER_AND_DATA_FILLING_ROADMAP.md`. One PR per slice. AI/crawler = drafts only.
> Migrations idempotent + owner-applied. Re-read roadmap + walk file tree every session (standing rule).

## DF-1 — Manual strain entry on KB page  *(prerequisite #1)*  ✅ DONE (PR pending)
- [x] `upsertKbStrain(input, actorId)` in `src/lib/ai/kb/store.ts` (upsert on `slug`, all rich fields, clamps confidence 0..1).
- [x] `KbStrainFull` read type + `listKbStrainsFull` returning all fields for edit pre-fill.
- [x] `setStrainActive` toggle helper.
- [x] Server actions `upsertStrainAction` + `toggleStrainAction` in `knowledge-base/actions.ts`
      (requirePermission `products.enrich`, audit, revalidate, comma-split+dedupe arrays, validated type).
- [x] UI: `StrainEditor.tsx` client component — "Add / edit a strain" form with ALL fields
      (name, slug, aliases, type, lineage, aroma, flavor, terpenes, dominant_cannabinoid, potency_note,
      bud_structure, origin, sources, confidence, summary, active). NO brand field.
- [x] Manage list with click-to-edit pre-fill + search + active/hide toggle.
- [x] Compliance helper copy (sensory/factual only).
- [x] tsc + eslint + next build green.

## DF-2 — Image-substitute KB  ✅ DONE (PR pending; migration 0021 owner-applied)
- [x] Migration `0021_image_substitutes.sql` (idempotent): `kb_image_substitutes` table
      (scope category|inventory_type|brand|vendor|global, key, media_id→media_assets, label,
      priority, active, audit) + indexes + staff-only RLS + updated_at trigger.
- [x] Store `image-substitutes.ts`: `listImageSubstitutes`, `imageSubstituteCounts`,
      `imageSubstitutesMigrated`, `upsertImageSubstitute`, `setSubstituteActive`,
      `deleteImageSubstitute`, `resolveSubstituteFor(category, inventoryType)` (category →
      inventory_type → global), `resolveBrandVendorSubstitute(brand, vendor)`.
- [x] Taxonomy constants seeded in code: all 52 categories + 6 inventory types (measured from sheets).
- [x] Admin "Fallback images" section (`SubstituteManager.tsx`): pick from Media Library, tag
      scope+key (dropdown of categories/types), priority, preview, coverage summary, enable/disable/remove.
- [x] Server actions `upsertSubstituteAction` / `toggleSubstituteAction` / `deleteSubstituteAction`.
- [x] tsc/eslint/build green.
- [ ] **Owner action:** apply `supabase/migrations/0021_image_substitutes.sql` in the SQL editor.
- Note: image *upload* uses the existing Media Library; admin assigns from there (no new bucket).

## DF-3 — Product image resolver + media draft pipeline ✅ (PR #90)
- [x] `resolveProductImage(posKey)` ladder: exact → brand/vendor generic → honest substitute →
      category/type fallback. Returns `{url, source, isFallback}`. (+ batch resolve, no N+1)
- [x] Front-end card + PDP use resolver; "representative image" cue on fallback.
- [~] Crawler/AI image candidates → draft `image_media_ids` on `product_enrichment` (source-tagged).
      (Resolver already reads PUBLISHED enrichment images; the crawler that *writes* draft
       candidates lands in DF-6.)
- [x] Brand/vendor generic-shot library (scope=brand/vendor in DF-2 table) — resolver consumes it.
- [x] tsc/eslint/build. PR #90 merged.

## DF-4 — Vendors & brands data + admin enrichment ✅ (PR #91)
- [x] Audit vendors/brands tables. FINDING: slice 3 tables already have about, mission,
      website, logo/hero media, social, counts, status; UX-5 already ships the full AI
      research→draft→accept/reject lifecycle. **No migration needed** — `ai_suggestions`
      already has confidence/source (0018). Scope tightened to the provenance seam.
- [x] Admin Vendors/Brands editable forms + AI-draft badges + accept/reject.
      (Forms + lifecycle pre-existed; added `AiProvenanceBadge` + wired source/confidence
       through vendor/brand drafts via the shared `AiDraftCard`.)
- [~] Link `kb_brands` house-style/known-for. (Deferred — `kb_brands` not yet a table;
      brand house-style will be populated by the crawler in DF-6.)
- [x] tsc/eslint/build. PR #91 merged. No migration to hand over.

## DF-5 — AI-4: provenance + confidence + accept-rate reporting ✅ (PR #92)
- [x] Surface confidence/source in review grid. (Done in DF-4 via AiProvenanceBadge.)
- [x] Accept-rate by prompt_version / feature / source / confidence-band on `/admin/ai-usage`.
- [x] tsc/eslint/build. PR #92 merged.

## DF-6 — crawl4ai work-horse engine ✅ (PR #94)
- [x] Runtime decided: **separate Python crawl4ai/Playwright FastAPI worker** under `/crawler`
      (Vercel can't run a headless browser). Provider-agnostic config via pydantic-settings
      (`app/config.py`); soft-disables with no AI key (CSS-first still works for free).
- [x] Pipeline (`app/pipeline.py`): permission/robots/rate-limit/disk-cache (`app/fetcher.py`,
      crawl4ai with httpx fallback) → CSS-first no-LLM extraction (JSON-LD/OpenGraph/DOM,
      `app/css_extract.py`) → fit_markdown → schema LLM extraction (Pydantic `app/schemas.py`,
      temp≈0, only when key set, `app/llm_extract.py`) → verify-against-source
      (`supported_by_source`, substring/≥60% token overlap) → WA I-502 compliance
      (`app/compliance.py`, faithful mirror of the TS `checkCompliance`) → write DRAFTS to
      `ai_suggestions` (`app/store.py`, source=`crawl:<url>`, confidence, model `crawler/<model>`
      or `crawler/css`, dedup of pending, defensive retry). Image candidates collected.
- [x] On-demand "research this" entry point: `POST /research` (auth `X-Crawler-Secret`) +
      `GET /health` (`app/main.py`). Site-side server client `src/lib/ai/crawler-client.ts`
      (`isCrawlerConfigured`, `researchUrl`, `crawlerHealth`). Per-vendor **and** per-brand
      "🔎 Research with the crawler" buttons on `/admin/vendors/[id]` → `crawlVendorAction` /
      `crawlBrandAction` (requirePermission `vendors.manage`, validate URL, audit, drafts to queue).
- [x] 10/10 Python logic tests pass (`crawler/tests/test_pipeline_logic.py`). FastAPI boots,
      auth returns 503 without secret, full end-to-end mocked flow verified (CSS-first drafted
      about+mission with ZERO LLM cost; verify+compliance passed; dry-run returned drafts).
- [x] Production walkthrough: `crawler/docs/RUNBOOK.md` (setup → run → Docker → systemd →
      connect back office via `CRAWLER_BASE_URL`/`CRAWLER_SHARED_SECRET` → first-run plan →
      cost/safety → troubleshooting). PyCharm run config in `crawler/.run/`. Site `.env.example`
      gained `CRAWLER_BASE_URL` + `CRAWLER_SHARED_SECRET`.
- [x] tsc + eslint + next build green. Python tests green. PR #94 merged.
- [ ] **Owner action:** deploy the worker (RUNBOOK), set the two CRAWLER_* env vars in Vercel,
      then fine-tune on a few real vendor/brand sites before any batch run.

## DF-7 — Legitimate crawler hardening ✅ (PR pending)
> Audit of the DF-6 crawler found: a single static User-Agent (block-prone), no full request
> headers, no retry/backoff on transient failures, no page **discovery** (only fetched the exact
> URL given), basic structured-data coverage, no proxy support, no allow-list. **Owner asked for
> "every trick" incl. fake accounts / IP masking / anti-bot bypass — DECLINED** (CFAA/ToS/contract
> risk to the I-502 license, and unnecessary: target data is public marketing content brands
> *want* indexed). Built the legitimate pro toolkit instead, which the owner approved ("the clean
> route… I never want to do things the dirty way").
- [x] **Browser-parity identity** (`app/http_identity.py`): rotating pool of 5 genuine current
      browser User-Agents + full modern header set (Accept, Accept-Language, Sec-Fetch-*,
      Upgrade-Insecure-Requests…). This is *parity with a normal visitor*, NOT evasion. Toggle via
      `CRAWL_REALISTIC_HEADERS` (default on); falls back to an honest bot UA when off.
- [x] **Resilient fetching** (`app/fetcher.py`): exponential backoff + full jitter on
      `{408,425,429,500,502,503,504}`, honoring numeric `Retry-After`; `CRAWL_MAX_RETRIES`,
      `CRAWL_BACKOFF_BASE_SECONDS`, `CRAWL_BACKOFF_MAX_SECONDS`. Optional transparent egress proxy
      (`CRAWL_PROXY_URL`) wired through crawl4ai + httpx + robots fetch. Per-domain **allow-list**
      (`CRAWL_ALLOW_DOMAINS`, empty = allow any; supports subdomains) to lock the worker to brands
      you carry.
- [x] **Page discovery** (`app/discovery.py` + `pipeline.research_target`): robots.txt `Sitemap:`
      lines → `/sitemap.xml` (one level of sitemap-index), ranked by interest keywords
      (about/our-story/mission/…); RSS/Atom feed `<link>` discovery. If a landing page yields no
      data, the pipeline now follows up to 2 about/story sub-pages and grounds on the richest text.
- [x] **Expanded structured data** (`app/css_extract.py`): microdata (`itemprop=description|image`)
      + `twitter:description` fallback, on top of existing JSON-LD arrays/@graph + OpenGraph.
- [x] 11/11 hardening tests pass (`crawler/tests/test_hardening.py`): allow-list empty/enforced,
      Retry-After numeric/http-date/absent, UA rotate/fallback, full headers, feed discovery,
      microdata, social-disabled-without-token.
- [x] tsc + eslint + next build green. PR pending.

## DF-9 — Sanctioned social connector (Instagram Business Discovery) ✅ (PR pending)
> Owner: several vendors live on social and have bare websites; "I need this data." The **legit**
> path: Greenway authenticates as **itself** (its own Facebook Page + Instagram Business account)
> and uses the Meta Graph API **Instagram Business Discovery** to read ANOTHER business/creator
> account's PUBLIC profile + media. Uses **ACCESS TOKENS from the Meta developer console — never
> passwords, never sent to the agent.** Legal safe-zone (Meta v. Bright Data 2024; hiQ/CFAA):
> reading public data is fine; authenticating-then-circumventing-ToS is the line we do not cross.
- [x] **Social client** (`app/social.py`): `normalize_handle` (@name / name / instagram.com URL),
      `fetch_instagram_business` (Graph `business_discovery` for bio, website, followers,
      profile pic, recent media: type/url/permalink/caption/timestamp), `profile_text_blob` for
      verify-against-source. **Soft-disables** when `META_GRAPH_TOKEN` unset; clear errors when the
      target isn't a discoverable business account.
- [x] **Pipeline** (`pipeline.research_social`): bio → about (vendor/brand) / first long caption →
      description (product); same verify + compliance gates as web; writes DRAFTS with
      source `social:ig:<handle>`. `result_to_draft_rows` honors the `social:` source prefix.
- [x] **Endpoint** (`app/main.py`): `POST /research-social` (auth `X-Crawler-Secret`, 503 when
      social unconfigured); `/health` now reports `social_configured`, `proxy_enabled`,
      `allow_domains`.
- [x] **Site wiring**: `crawler-client.ts` `researchSocial` + `CrawlerHealth`; `actions.ts`
      `crawlVendorSocialAction` / `crawlBrandSocialAction` (requirePermission `vendors.manage`,
      audit `*.social_drafted`); `/admin/vendors/[id]` "📸 Pull from Instagram" blocks for the
      vendor and each brand, gated on `socialOn` (probes `crawlerHealth().socialConfigured`).
- [x] 6/6 social tests pass (`crawler/tests/test_social.py`): handle variants, soft-disabled,
      requires-business-id, parses business-discovery (mocked), Graph-error handling, text blob.
- [x] Owner walkthrough: `crawler/docs/SOCIAL_SETUP.md` (link FB Page + IG Business → create
      Business app → long-lived Page token via Graph API Explorer → find IG business id → curl
      test → token hygiene). `crawler/.env.example` gained the DF-7 + social vars.
- [ ] **Owner action:** create/confirm a Facebook Page + Instagram **Business** account, generate
      `META_GRAPH_TOKEN` + `META_IG_BUSINESS_ID` per SOCIAL_SETUP.md, drop them in the worker
      `.env`. (Optional but only-public-data either way.)

## DF-8 (optional) — AI-5/6 hardening
- [ ] Golden-set eval harness + model router/budgets gating prompt changes.
- [x] **Vendor golden set seeded** (`back-office/kb_seed/vendors_baseline_seed.sql` +
      `VENDOR_BASELINE_RESEARCH.md` + `VENDOR_BASELINE_README.md`): 12 top vendors
      human-verified with strict no-guessing. 9 seeded as `draft` rows (Dogtown at
      medium confidence, flagged); 3 held back as commented stubs pending owner input
      (Mountain Hi = retailer/producer ambiguity; Evergreen Hydro Farms + Canna
      Processing = unconfirmed). This is the ground truth the crawler is scored against.
- [x] **Vendor Batch 2 KB seeded** (`back-office/kb_seed/vendors_batch2_seed.sql` +
      "Batch 2" section of `VENDOR_BASELINE_RESEARCH.md`): 21 producer/processors
      researched with strict no-guessing. 15 CONFIRMED seeded as `draft` rows
      (`sort_order` 10–24): Fire Bros., Canna Pacific, Clarity Farms, Seattle Bubble
      Works, Heavenly Buds, Ceres Garden, Avitas, Sky High Gardens, Mfused, Seattle's
      Private Reserve, Quality Green Trees (Freddy's Fuego), Cultivar Farms, Edgemont
      Group, Fireline Cannabis, Botanica Seattle. 6 held back as commented stubs
      pending owner legal-entity/UBI (Washington Packaging and Processing, R&B Group,
      Virtual Services, Wamsterdam Farms, Botanical Arts, Alpenglow Extracts — the
      last flagged LOW to avoid conflation with CA "Alpenglow Farms 707").

## Where to run the crawler
- [x] `crawler/docs/WHERE_TO_RUN.md`: recommends a dedicated VM on the shop host
      (2 vCPU / 4 GB / 20 GB Ubuntu) reached via **Cloudflare Tunnel** (no inbound ports opened on
      the shop firewall) as the best fit for Greenway; cloud VM as alt; NOT Vercel (no headless
      browser).

---
### Status log
- 2026-… DF-1 in progress (this session).
