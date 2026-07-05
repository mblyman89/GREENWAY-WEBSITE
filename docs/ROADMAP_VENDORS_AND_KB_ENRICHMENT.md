# Roadmap — Vendor Directory at Full Scale + KB Enrichment from State Data

> Owner request (verbatim, 2026-07-05):
> "Will you add a filter option that lets me see only my vendors. It should be
> based on what I have in my inventory. Also, currently, the vendors page has
> the same limitation that the inventory page had, it only allows 1000 rows, so
> the system thinks we only have 1000 vendors when there are actually 1500. Can
> you add the trick method to allow me to have full access to all of the
> vendors? Will you also add a bunch of filter options. When I have my actual
> inventory, it'll be nice to lean on the kb to sort by type and category and
> such so it pulls up my vendors with the products I'm looking for. And since we
> have all the vendors in the whole state in our system now, let's add filter
> options to see vendors that have products in those categories. Now that I
> think about it, with the data we will get from product/ vendor leads by
> importing the state data, we should be able to enrich our kb significantly
> right?! Will you make sure that whatever data we pull in from the state to do
> our leads and set our bench marks and such, are also connected to our kb. Any
> information we get that is accurate, needs to find its home in the kb. Will
> you audit this and then build it if it is not yet implemented."
>
> Direction: Slice A first, ship it; Slice B on a new branch. The KB is the
> backbone of the operation — no guessing, no corner-cutting.

---

## 0. Ground truth (verified 2026-07-05 against the live DB + migrations)

| Fact | Where verified |
| --- | --- |
| `vendors` table now holds **1,775 rows** (113 curated + 1,662 seeded from Cultivera, migration 0081 applied). | Live PostgREST count |
| `listVendors()` (src/lib/vendors/store.ts) uses a plain `.select("*")` → **PostgREST silently caps at 1000 rows**. This is the bug. | Code read |
| The codebase's established fix ("the trick method") is **`.range()` paging in 1000-row windows** — see `listKbStrainsFull()` in `src/lib/ai/kb/store.ts` (documents the same root cause), `src/lib/discovery/benchmarks.ts`, `competitors.ts`, `compare.ts`, `ingest.ts`, `src/lib/reports/newsletter-stats.ts`. | Code read |
| Inventory ↔ vendor link: **`inventory_lots.vendor_id`** (FK, indexed; migration 0023). "My vendors" = vendors having ≥1 lot. | Migration 0023 |
| Lot classification columns for product-based filters: `inventory_lots.category` (EndProduct \| IntermediateProduct), `inventory_lots.inventory_type` ("Usable Marijuana", "Concentrate for Inhalation", …), `strain_name` (migration 0024). | Migration 0024 |
| `inventory_lots` currently has **0 rows** — filters must degrade gracefully until real inventory arrives. | Live count |
| Discovery (state data) tables: `discovery_datasets`, `discovery_ccrs_sales`, `discovery_ccrs_products` (license_number, category, product_type, name, brand, description, unit_weight_grams, ext_id), `discovery_ccrs_lab` (potency tests), `discovery_ccrs_licensees` (derived roster), `discovery_benchmarks`, `discovery_vendor_leads`, `discovery_product_leads` (migrations 0078–0080). All currently **0 rows**. | Migrations + live counts |
| **KB ↔ Discovery connection: NONE.** Zero references in either direction (`grep kb_ src/lib/discovery/` and `grep discovery_ src/lib/ai/kb/` both empty). The enrichment pipeline is net-new work. | Code audit |
| KB homes: `kb_products` (0071 — has `brand_slug`, `product_slug`, `category`, `vendor_id`, `brand_id`, `kb_strain_id`, `kb_brand_id`, **provenance**: `source`, `confidence`, `sources[]`, and a **drafts-only lifecycle** `status: draft\|published\|archived`, `active`). `kb_brands` (0019 — slug, name, aliases, vendor_id, brand_id, known_for, house_style, signature_lines, sensory_notes, `active`; **no provenance/status columns** — gap to close in Slice B). `kb_strains`, `kb_terpenes`, `kb_category_terms`, `kb_product_categories` also exist. | Migrations 0019/0071 |
| Vendor reconciliation logic already exists for discovery: `src/lib/discovery/reconcile.ts` (`normalizeLicense`, `normalizeName`, `slugifyName`, `matchVendorLead` — license = confident match). Reuse it; don't reinvent. | Code read |
| Standing rules: migrations applied MANUALLY by owner + idempotent; money in MINOR UNITS; drafts-only for AI/derived data; never overwrite curated data (gap-fill); branch → PR → squash-merge; verify with tsc → eslint → next build → `rm -rf .next`. | Project conventions |

---

## SLICE A — Vendor directory at full scale (branch `feat/vendors-full-scale-filters`)

Goal: every one of the 1,775 vendors is reachable, and the page filters like a
professional POS back office.

### A1. Fix the 1000-row cap ("the trick method")
- [x] Rewrite `listVendors()` to page with `.range(from, to)` in 1000-row
      windows until a short page, mirroring `listKbStrainsFull()`. Cap at a
      sane ceiling (5,000) to bound memory.
- [x] Keep the existing ordering (`sort_order`, then `display_name`).

### A2. Server-side filter support (`src/lib/vendors/store.ts`)
- [x] Extend `listVendors(opts)` with: `status`, `active` (is_active true/false),
      `hasLicense` (license_number not null), `q` (name/dba/license ilike).
- [x] New helper `vendorInventoryFacts()` → reads `inventory_lots` (paged) and
      returns: set of vendor ids with ≥1 lot ("my vendors"), distinct
      `inventory_type` values, distinct `category` values, and per-vendor
      type/category sets — so the page can filter vendors by what they supply.
- [x] Degrade gracefully: with 0 lots, "My vendors" shows an honest empty state
      (not an error).

### A3. Vendors page UI (`src/app/admin/vendors/page.tsx`)
- [x] Filter bar: Search (name/DBA/license) · **Scope: All / My vendors** ·
      Status (draft/published) · Active (active/inactive) · License (has/missing)
      · Inventory type · Inventory category. GET form, URL-driven (shareable).
- [x] Results are **paginated in the UI** (60/page + Prev/Next + "X–Y of N") so
      1,775 cards don't render at once (perf = professional POS behavior).
- [x] Stat cards reflect the FULL vendor set (not the filtered page):
      total / published / drafts / my-vendors count.
- [x] Aggregate insight (completeness) computed on the full set as before.
- [x] Empty-state copy updated (no more "105 vendors" reference).

### A4. Verification + ship
- [x] `npx tsc --noEmit` clean.
- [x] `npx eslint` on changed files clean.
- [x] `npx next build` passes; `rm -rf .next` after.
- [x] PR opened → owner directed: ship → squash-merge → sync main.

---

## SLICE B — KB enrichment from state/discovery data (branch `feat/kb-enrich-from-discovery`)

Goal: **every accurate fact that enters via state data finds its home in the
KB**, as reviewable drafts with provenance — never auto-published, never
overwriting curated work. The KB is the backbone; treat it that way.

### B1. Migration `0082_kb_enrichment_provenance.sql` (idempotent)
- [x] `kb_brands`: add `source text`, `confidence numeric`, `sources text[]
      default '{}'`, `status text default 'published'` (existing rows keep
      behaving; enrichment inserts land `status='draft'`). Backfill null →
      'published' for existing rows (idempotent update).
- [x] Indexes: `kb_brands (status)`, `kb_products (status)` if missing.
- [x] Comment every new column (handoff-ready).

### B2. Enrichment engine `src/lib/kb/enrich-from-discovery.ts`
- [x] `enrichKbFromCcrsDataset(datasetId, actorId)` — the single entry point.
- [x] **Brands:** distinct `discovery_ccrs_products.brand` → `kb_brands`
      (slug via existing `slugifyName`); gap-fill aliases; link `vendor_id`
      when the product's `license_number` matches a vendor (reuse
      `normalizeLicense`); insert as `status='draft'`,
      `source='ccrs:<dataset>'`. NEVER touch existing curated rows except to
      append missing aliases.
- [x] **Products:** `discovery_ccrs_products` → `kb_products` drafts keyed by
      (brand_slug, product_slug, variant from unit_weight_grams); map
      `category`/`product_type` → KB `category`; carry `description`;
      `vendor_id` via license match; provenance `source='ccrs:<dataset>'`,
      `confidence` (license-matched 0.9 / name-only 0.6), `sources[]`
      = dataset label. Upsert = gap-fill only.
- [x] **Potency:** `discovery_ccrs_lab` THC/CBD → attach to the matching
      kb_products draft `potency_note`-style fields where they exist (verify
      target columns first — never guess).
      **VERIFIED OUTCOME:** kb_products has NO potency columns (checked
      migration 0071 line-by-line). Per the never-guess rule the engine does
      NOT attach potency; it emits an explicit warning documenting the gap.
      Potency remains available in `discovery_ccrs_lab` / benchmarks. Adding
      dedicated potency columns to kb_products is listed as a follow-up.
- [x] Batch-safe: page every read with `.range()`; chunk inserts; bounded.
- [x] Result report: `{brandsInserted, brandsEnriched, productsInserted,
      productsEnriched, skipped, warnings[]}`.

### B3. Wiring — enrichment runs where state data lands
- [x] Discovery CCRS page: "Enrich KB from this dataset" action (server action
      calling B2, with audit log entry) + result banner.
- [x] Auto-hook: after a dataset ingest completes (`markDatasetReady`), fire
      enrichment automatically. Failures logged, non-fatal.
- [x] Audit entries via `recordAudit` (`kb.enriched_from_ccrs`).

### B4. Review surface (drafts-only lifecycle)
- [x] Audit the existing KB admin pages first (never guess): find where
      kb_products / kb_brands are listed and whether a `status=draft` filter
      exists. Extend so enrichment drafts are visible + reviewable
      (publish / archive), with bulk actions for ccrs-sourced drafts.
- [x] Never auto-publish: enrichment inserts stay `draft` until a human acts.

### B5. Verification + ship
- [x] Unit-checkable dry-run mode (no writes) for the enrichment engine
      (`SEED_DRY_RUN`-style env or an options flag).
- [x] `tsc` / `eslint` / `next build` clean; `rm -rf .next`.
- [ ] PR opened with audit summary; **HELD for owner review** (KB is the
      backbone — owner approves before merge).

### Follow-ups (deliberately out of scope, listed for handoff)
- [ ] KB-powered vendor filter upgrade: once CCRS data exists, extend the
      vendors-page category filter to include "carries products in category X
      per state data" (join discovery_ccrs_products license → vendor).
- [ ] Strain enrichment: CCRS product names → kb_strains alias suggestions
      (needs a confidence model; drafts-only).
- [ ] Benchmarks → kb_products market context (e.g. median price per category)
      as display-only fields.
- [ ] Rotate the Supabase service-role key (owner action; key was shared in
      chat during the seed run).
- [ ] kb_products potency columns (e.g. `thc_pct numeric`, `cbd_pct numeric`
      + provenance) so CCRS lab results can find their KB home — new
      migration + engine extension (drafts-only as always).

---

## Definition of done
Slice A: owner can see and filter all 1,775 vendors, incl. "My vendors" (inventory-driven) and product-type/category filters; page stays fast. ✅ DONE
Slice B: importing state data automatically proposes KB drafts with provenance; nothing curated is ever overwritten; owner reviews drafts in the KB UI.
