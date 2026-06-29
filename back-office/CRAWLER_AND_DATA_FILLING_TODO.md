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

## DF-6 — crawl4ai work-horse engine ✅ (PR pending)
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
- [x] tsc + eslint + next build green. Python tests green. PR pending.
- [ ] **Owner action:** deploy the worker (RUNBOOK), set the two CRAWLER_* env vars in Vercel,
      then fine-tune on a few real vendor/brand sites before any batch run.

## DF-7 — Crawl tuning + scale
- [ ] Per-domain reliability scoring, scheduling/batch, de-dup, vision alt-text, budget alerts.
- [ ] PR.

## DF-8 (optional) — AI-5/6 hardening
- [ ] Golden-set eval harness + model router/budgets gating prompt changes.

---
### Status log
- 2026-… DF-1 in progress (this session).
