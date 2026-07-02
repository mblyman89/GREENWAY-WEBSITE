# Terpene Audit (Request A) — hand-off ready

Date: 2026-07-02. Branch base: `main` @ `b02d8b6`.
Scope: make terpenes a first-class descriptive attribute of strains — assignable,
in the KB, AI-auto-filled (validated only), and **filterable in the website menu**.
No tracking / no reporting required.

## Acceptance criteria → current state

| # | Requirement | Status today | Evidence |
|---|-------------|--------------|----------|
| A1 | Assign terpenes to a strain | ✅ EXISTS | `kb_strains.terpenes text[]` (0019); StrainEditor "Dominant terpenes" field + table column |
| A2 | Terpenes part of the KB | ✅ EXISTS | `kb_strains.terpenes` + dedicated `kb_terpenes` reference table (0019); `SEED_TERPENES` seeds it (`kb/store.ts`) |
| A3 | AI auto-fills validated terpenes attached to the strain | ✅ EXISTS | `generateProductSensory()` (`ai/suggestions.ts`) — grounded on KB facts, includes a terpene ONLY if facts support it; `productSensorySchema` (`ai/schemas/product.ts`) |
| A4 | **Filter terpenes in the website menu** | ❌ MISSING | `GreenwayMenuItem` has no terpene field; `InteractiveMenuBrowser` has no terpene filter; `product_enrichments` has no terpene column; menu built from `posMenuPreviewItems` (no structured terpene field) |
| A5 | No tracking / no reporting | ✅ N/A | Nothing to build; we will NOT add reporting |

**Conclusion:** A1–A3 and A5 are already satisfied. **The only real gap is A4** — the
website menu cannot filter by terpene because terpene data never reaches the
`GreenwayMenuItem`, and no terpene filter control exists.

## The data model (verified)

- `kb_strains.terpenes text[]` — dominant terpene *names* per strain family
  (e.g. Blue Dream → `{myrcene, pinene, caryophyllene}`). SENSORY ONLY, no effects.
  Migration `0019_cannabis_knowledge_base.sql`.
- `kb_terpenes` — reference table: `slug`, `name`, `aroma_notes[]`, `flavor_notes[]`,
  `also_found_in`. Migration `0019`. Seeded via `SEED_TERPENES` in `kb/store.ts`.
- `product_enrichments` (0004) — marketing overrides per POS product. **NO terpene /
  aroma / flavor column.** (Aroma/flavor/terpene AI output currently lives only as an
  `ai_suggestions` row with `field_key='sensory'` — a *draft*, not persisted to the
  live menu.)
- `GreenwayMenuItem` (`src/lib/leafly/types.ts`) — the website menu shape.
  Fields: id, name, brand, category, `posInventoryType/Category`, strainType,
  **strainName**, thc/cbd, compounds (cannabinoids only), variants, image…
  **NO terpenes field.** `GreenwayCannabinoid.type` is a fixed enum
  (thc/thca/cbd/cbda/cbg/cbn/cbdv) — terpenes do NOT belong in `compounds`
  (this is why the earlier mock had to `as unknown as` cast a "myrcene" compound —
  that cast was removed in PR #218).
- The live `/menu` page builds from **`posMenuPreviewItems`** (`src/lib/pos/preview-menu.ts`
  reading `src/data/pos-menu-preview.json`) → `withResolvedImages()`. The preview
  JSON items have NO structured terpene field (verified: item keys list has none).

## Full terpene inventory (files touching terpenes)

Grouped by role. F = do-not-touch-for-this-request.

### A — KB / data model (source of truth)
- `supabase/migrations/0019_cannabis_knowledge_base.sql` — `kb_strains.terpenes`,
  `kb_terpenes` table. (F — schema already correct.)
- `src/lib/ai/kb/store.ts` — `upsertKbStrain({terpenes})`, `KbStrainFull.terpenes`,
  `SEED_TERPENES`, `seedKnowledgeBase` inserts terpene rows, `listActiveStrains`
  selects `terpenes`. (Read for the menu-enrichment join; likely no edit.)
- `src/lib/ai/kb/seed.ts` — `SeedStrain.terpenes: string[]` starter data.
- `src/lib/ai/kb/strains-data.ts` — curated strain rows w/ terpenes (data).
- `src/lib/ai/kb/retrieval.ts` — grounded-fact retrieval feeds terpenes to the AI.
- `src/lib/ai/schemas/product.ts` — `productSensorySchema.terpenes` (AI output shape).
- `src/lib/ai/suggestions.ts` — `generateProductSensory()` (A3 auto-fill). (F for A.)
- `src/lib/ai/compliance.ts` — prose mentioning terpenes (copy only). (F.)

### B — back office UI (assign)
- `src/app/admin/knowledge-base/StrainEditor.tsx` — terpene input + table column
  (A1). (Works; no edit needed for A.)
- `src/app/admin/knowledge-base/actions.ts` — `upsertStrainAction` parses `terpenes`
  csv. (Works.)
- `src/app/admin/knowledge-base/page.tsx` — KB dashboard counts terpenes.

### C — website menu (filter) — THE GAP (A4)
- `src/lib/leafly/types.ts` — `GreenwayMenuItem` needs an optional `terpenes?: string[]`.
- `src/components/menu/InteractiveMenuBrowser.tsx` — needs a terpene filter facet
  (dynamic options from item terpenes, multi-select, same `buildOptions` pattern
  used for strain type; match = item has ANY selected terpene).
- `src/components/menu/MenuFilters.tsx` — static fallback filter (mirror the facet).
- `src/data/pos-menu-preview.json` + `src/lib/leafly/mock-menu.ts` — sample data must
  carry `terpenes` so the filter demonstrably works on the preview menu.
- Menu build path: a KB-strain → menu-item terpene join by `strainName` (see plan).

### F — DO NOT TOUCH for this request
- CCRS / compliance files (terpenes are not a CCRS field).
- Reporting (A5: explicitly no terpene reporting).
- `blog/posts.ts` (marketing copy).

## Design decision (best judgment, grounded — to confirm with owner)

**How terpenes reach the menu item (A4):** Two viable options.

- **Option 1 (recommended): join at menu-build time from the KB by `strainName`.**
  No new DB column, no migration. When we assemble/serve menu items we look up the
  matching `kb_strains` row (by `slug`/name of `strainName`) and attach its
  `terpenes[]` to the `GreenwayMenuItem`. This directly reuses the validated,
  staff/AI-curated KB terpenes — exactly the "known terpenes validated accurate and
  attached to the strain" the owner described. Falls back to empty when no KB match.
  For the preview JSON menu we add a `terpenes` field to the sample rows.

- **Option 2: persist terpenes onto `product_enrichments`** (new `terpenes text[]`
  column + AI-accept flow writes them). More plumbing, a migration, and duplicates
  data that already lives on the strain. Only better if terpenes must differ
  per-product from the strain default.

Recommendation: **Option 1** — least risk, no migration, single source of truth
(the KB strain), matches the request wording. If the owner later wants per-product
terpene overrides we can add Option 2 on top without rework.

## Verification plan (A)
- `tsc --noEmit` clean after widening `GreenwayMenuItem` + adding the filter.
- Menu filter shows terpene options built from data; selecting one narrows results
  (add mock rows with known terpenes to prove it end-to-end).
- KB self-tests (if any) still pass; AI suggestion path unchanged.
- Full `npm run build` succeeds.
- CCRS untouched (grep-verify no compliance file changed).
