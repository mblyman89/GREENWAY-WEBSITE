# KB Hardening & Enrichment Write-Back — Roadmap (Request G)

**Owner:** Greenway Marijuana (WA I-502, Port Orchard)
**Author:** back-office agent · drafts-only, hand-off ready
**Branch:** `feature/kb-hardening-writeback` → PR → squash-merge to `main`
**Migrations:** applied **MANUALLY** by the owner; every migration is **idempotent** and safe to run more than once. New migrations start at **0071** (0070 = `kb_product_categories`).

---

## Why this work exists

Request C audit proved: **validated product enrichment does NOT flow into the Knowledge Base today.** The KB is currently a one-way *input* to enrichment (KB → product copy), never an *output* of it. The only KB writers are the seed script and the manual KB editor.

The owner (Request D) wants the KB to become the **backbone / brain**:

1. **Drafts-only** promotion for now — nothing auto-publishes; a human validates.
2. **Per-SKU, brand-specific** product knowledge (separate rows per brand + product + variant/size), **not** keyed on lot/batch codes.
3. When a fact/image has been **validated**, it should be **promoted into the KB**. All validated product data + images should flow in.
4. **Existing vendor + existing product** on a new invoice → auto-fill exactly from the KB. **New-to-us** (new vendor or new product) → run product enrichment first, then fill the blanks.
5. Images/brands/brand-logos: validated info flows into the KB too. On read: **look in KB first**, then offer an **approved substitute**, else let the user go online.
6. **Effects** are allowed **only as experiential descriptors** (sleepy, relaxed, uplifted, calm, focused, euphoric, energetic, hungry). **Medical claims are forbidden** (cure, treat, heal, remedy, "cures your insomnia", etc.). All effects seed back into the table but must pass a medical-claim filter.

### Compliance grounding (verified in code)

`src/lib/ai/compliance.ts` already blocks medical claims via `RISKY_PATTERNS` (block severity): cure/treat/heal/remedy, symptom-relief, named conditions (pain/anxiety/insomnia/…), safety/efficacy, dosing, appeal-to-minors, alcohol/tobacco. `checkCompliance(text, extra)` layers the owner-editable `kb_banned_phrases` list on top. **`COMPLIANCE_SYSTEM` originally said "never describe effects"** — Slice 2 reconciles this so *experiential* effects are permitted while *medical* claims stay blocked.

---

## Verified current schema (grounding — do not guess)

- **`kb_strains`** (0019+0020): `slug` UNIQUE, `name`, `aliases[]`, `strain_type`, `lineage`, `aroma_notes[]`, `flavor_notes[]`, `terpenes[]`, `summary`, `dominant_cannabinoid`, `potency_note`, `bud_structure`, `origin`, `sources[]`, `confidence`, `active`, audit cols. **NO `effects` column (added in 0071).**
- **`kb_product_categories`** (0070): `slug` UNIQUE, `name`, `group_key`, `summary`, `aliases[]`, `wa_inventory_types[]`, `sort_order`, `active`. **NO `effects` column (added in 0071).**
- **`kb_brands`, `kb_terpenes`, `kb_category_terms`, `kb_banned_phrases`** (0019); `kb_image_substitutes` (image subsystem); `kb_notes` (0056).
- **`product_enrichments`** (0004): `pos_product_key` UNIQUE, `display_name`, `description`, `short_description`, `image_media_ids[]`, `primary_media_id`, `brand_id`, `vendor_id`, `tags[]`, `staff_pick`, `featured`, `staff_note`, `hidden_override`, `seo_*`, `status` (`asset_status` default `draft`), `last_seen_*`.
- **`ai_suggestions`** (0004+0018): `entity_type`, `entity_id`, `field_key` (`description` | `sensory` | `tags` | `effects`), `suggested_value`, `status`, `model`, `prompt_version`, `input_summary`, `confidence`, `source`.
- Shared: `public.set_updated_at()`, `public.is_staff()`.

### Hook points (verified)

- `setEnrichmentStatus` (`src/app/admin/products/actions.ts`) → status `published` → `writeBackOnPublish`.
- `acceptSuggestion` (same file) — handles `description`, `tags`; now also triggers write-back so accepted `sensory`/`effects` reach the KB.
- `bulkAcceptSuggestionAction` (`src/app/admin/products/bulk-ai/actions.ts`) — handles `description`; now also triggers write-back.

---

## Slices (six) — all delivered on this branch

- [x] **Slice 1 — KB schema (migration 0071).** New `public.kb_products` table (per-SKU, brand-specific): keyed on `brand_slug` + `product_slug` + `variant_label` (NOT lot code), with `status` (draft|published|archived) + `active`, sensory arrays, `effects text[]`, image refs (`image_media_ids uuid[]`, `primary_media_id`), provenance (`source`, `confidence`, `sources[]`), FK links (`kb_strain_id`, `kb_brand_id`, `brand_id`, `vendor_id`, `product_category_id`), audit cols, unique key, RLS staff-only + set_updated_at trigger. Also `add column if not exists effects text[]` on `kb_strains` and `kb_product_categories`. Idempotent, applied manually by owner.
- [x] **Slice 2 — Medical-claim filter for effects.** Extended `compliance.ts`: `ALLOWED_EFFECTS` allow-list, `checkEffects()` validator (allow-list + medical-word filter + `checkCompliance` + banned list), `MEDICAL_BANNED_PHRASES`, reconciled `COMPLIANCE_SYSTEM` to permit experiential effects. Idempotent seed helper `seedMedicalBannedPhrases` (`src/lib/ai/kb/seed-banned.ts`).
- [x] **Slice 3 — Write-back service (drafts-only).** `src/lib/ai/kb/writeback.ts`: `writeBackProductFacts` (compliance-gated, non-destructive gap-fill/union, drafts-only kb_products, strain-level sensory/effects union, defensive pre-migration) + `writeBackOnPublish` (gathers enrichment + accepted sensory/effects). Wired into all three hook points; audit-logged.
- [x] **Slice 4 — Intake "already known?" check.** `src/lib/ai/kb/intake.ts`: `checkProductKnown` / `checkProductsKnown` → verdict `exact` (published) / `draft` / `new` / `not-ready`. Existing product auto-fills; new-to-us routes to enrichment. Read-only, defensive.
- [x] **Slice 5 — Read side (KB-first).** `src/lib/ai/kb/product-lookup.ts`: `lookupProductKnowledge` ladder kb_products(published) → kb_products(draft) → product_enrichments → kb_strains → none; returns `imageHint` (exact|substitute|online) + `needsOnline`. Complements the existing `kb_image_substitutes` image ladder.
- [x] **Slice 6 — Effects generation + KB review surface.** `generateProductEffects` (field_key `effects`) gated by `checkEffects` (`productEffectsSchema` constrained to allowed vocab); wired into `generateProductAi` (`kind==='effects'`). Admin review queue at `/admin/knowledge-base/review` (`listKbProducts`/`countKbProductDrafts`/`reviewKbProduct`) so the owner validates staged write-backs into published/active or archives them. Medical-blocklist seed action on the KB page.

**After the slices: STOP** for owner inspection (owner said "then stop"). Agent handles push + PR + squash-merge.

---

## Standing rules honored

Record requests verbatim · deep-research + verified fact, never guess · find it in the tree · slices · AI output = drafts-only · money in cents (n/a here) · CCRS + DOH compliance always · idempotent migrations applied manually · `main` branch-protected (branch + PR + squash) · hand-off ready.
