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

## DF-5 — AI-4: provenance + confidence + accept-rate reporting
- [ ] Surface confidence/source in review grid.
- [ ] Accept-rate-by-prompt_version/feature/source on `/admin/ai-usage`.
- [ ] tsc/eslint/build. PR.

## DF-6 — crawl4ai work-horse engine
- [ ] Decide runtime (Python crawl4ai worker vs TS bridge); provider-agnostic config.
- [ ] Pipeline: permission/robots/rate-limit/cache → CSS-first → fit_markdown → schema LLM
      extraction (Pydantic mirror, temp≈0) → verify-against-source → ground → compliance → POS-key
      map → `ai_suggestions` (source=crawl:<url>, confidence, image candidates).
- [ ] On-demand "research this" entry point.
- [ ] tsc/eslint/build (+ Python lint). PR.

## DF-7 — Crawl tuning + scale
- [ ] Per-domain reliability scoring, scheduling/batch, de-dup, vision alt-text, budget alerts.
- [ ] PR.

## DF-8 (optional) — AI-5/6 hardening
- [ ] Golden-set eval harness + model router/budgets gating prompt changes.

---
### Status log
- 2026-… DF-1 in progress (this session).
