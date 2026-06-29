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

## DF-2 — Image-substitute KB
- [ ] Migration `0021_image_substitutes.sql` (idempotent): `kb_image_substitutes` table + indexes + RLS.
- [ ] Store: `listImageSubstitutes`, `upsertImageSubstitute`, `setSubstituteActive`,
      `resolveSubstituteFor(category, inventoryType)`.
- [ ] Admin "Fallback images" section/page: upload media, tag scope+key, priority, preview grid.
- [ ] Seed all 52 categories + 6 inventory types + global with neutral placeholders.
- [ ] tsc/eslint/build. PR. Hand migration to owner.

## DF-3 — Product image resolver + media draft pipeline
- [ ] `resolveProductImage(posKey)` ladder: exact → brand/vendor generic → honest substitute →
      category/type fallback. Returns `{url, source, isFallback}`.
- [ ] Front-end card + PDP use resolver; "representative image" cue on fallback.
- [ ] Crawler/AI image candidates → draft `image_media_ids` on `product_enrichment` (source-tagged).
- [ ] Brand/vendor generic-shot library (scope=brand/vendor in DF-2 table).
- [ ] tsc/eslint/build. PR.

## DF-4 — Vendors & brands data + admin enrichment
- [ ] Audit vendors/brands tables; migration `0022_*` for draft columns if needed (about, region,
      website, logo_media_id, brands_carried[], enrichment_status, provenance/confidence).
- [ ] Admin Vendors/Brands editable forms + AI-draft badges + accept/reject.
- [ ] Link `kb_brands` house-style/known-for.
- [ ] tsc/eslint/build. PR. Hand migration to owner.

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
