# Intake → Our-Conventions Category/Type Conversion Audit (Request B)

Date: 2026-07-02. Branch base: `main` @ `b02d8b6`. Hand-off ready.

Scope: inventory entering via **intake** carries LCB/CCRS classifications
(`inventory_type` / `inventory_category`, e.g. "Usable Cannabis" / "Usable
Marijuana"). Convert these to **our conventions** (website categories) for the
menu + back office (esp. **cycle-count filters**). Leave LCB/CCRS reporting
untouched/hard-set.

## Acceptance criteria → current state

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| B1 | Intake inventory converted to our conventions for menu + back office | ⚠️ PARTIAL | POS import (`transform.ts` `CATEGORY_MAP`) converts *menu* items to `GreenwayCategory`. Intake lots store RAW `category`/`inventory_type` and are NOT converted for back-office display/filtering |
| B2 | Cycle-count filters use OUR conventions (not "usable marijuana") | ❌ MISSING | `cycle-count-sheet-core.ts` filters/labels straight off raw `l.category` / `l.inventoryType`; options come from `distinctValues(... l.inventoryType)` — raw LCB strings |
| B3 | LCB/CCRS reporting untouched / hard-set | ✅ MUST KEEP | `ccrs-batch-core.ts` holds the authoritative `CCRS_INVENTORY_TYPES` per category. Do NOT modify |
| B4 | Works for website AND back office | ⚠️ PARTIAL | Website menu already converts (import path). Back office (intake list, lot detail, cycle counts) does not |

**Conclusion:** the *website menu* is already converted via the POS import
pipeline. The gap is the **back-office intake/lot/cycle-count surfaces**, which
show raw LCB values. We must convert those to our website-category convention for
display + filtering while preserving the raw LCB values for CCRS reporting.

## The two vocabularies (verified, grounded)

### 1) LCB / CCRS (authoritative, HARD-SET — leave alone)
`src/lib/compliance/ccrs-batch-core.ts` → `CCRS_INVENTORY_TYPES` maps each
`InventoryCategory` to its exact valid `InventoryType` set (2026-02 CCRS Upload
User Guide, Table 2). The coarse types intake carries include:
- **EndProduct**: Usable Cannabis, Concentrate for Inhalation, CO2/Ethanol/
  Hydrocarbon/Non-Solvent Concentrate, Solid Edible, Liquid Edible, Capsule,
  Tincture, Topical Ointment, Transdermal, Suppository, Cannabis Mix Infused/
  Packaged, Sample Jar, Waste.
- **IntermediateProduct**: Cannabis Mix, CBD, Food Grade Solvent Concentrate,
  Infused Cooking Medium, Waste.
- **HarvestedMaterial**: Flower Lot/Unlotted, Other Material Lot/Unlotted, Wet
  Flower, Waste.  **PropagationMaterial**: Clones, Plant, Seed.

Intake `ParsedLine` (from `intake-parser.ts`):
- `category`       ← manifest `inventory_category` (POS label, e.g. "Usable Marijuana")
- `inventory_type` ← manifest `inventory_type`     (CCRS type, e.g. "Usable Cannabis")

Stored VERBATIM onto `inventory_lots.category` / `inventory_lots.inventory_type`
(migration 0024). This is the CCRS source of truth for that lot — **keep it**.

### 2) OUR conventions (website categories — the target)
`GreenwayCategory` (`src/lib/leafly/types.ts`) + `websiteCategoryDefinitions`
(`src/lib/pos/category-taxonomy.ts`) + DB table `website_category_types`
(migration 0035). Values: flower, popcorn-bud, infused-flower, blunt,
infused-blunt, tincture, rso, paraphernalia, accessories, merch, preroll-pack,
cartridge, disposable-cartridge, edible-solid, concentrate, infused-preroll,
infused-preroll-pack, preroll, edible-liquid, topical, trim.

## What ALREADY exists for the conversion (big head start)

- **`transform.ts` `CATEGORY_MAP`** — maps fine POS *product category* labels
  (Flower, Rosin, Gummies, …) → `GreenwayCategory`, with anomaly flagging for
  unmapped values. Used by the POS import → menu path. (Authoritative today.)
- **`src/lib/pos/inventory-type-catalog.ts` `INVENTORY_TYPE_CATALOG`** — mirrors
  that map as `{ label, websiteCategory }[]` (fine POS labels → website category).
- **Migration 0035** created `inventory_types` (key → `website_category`) and
  `website_category_types` tables so staff can manage the mapping WITHOUT a deploy;
  `inventory_types` is auto-backfilled from distinct `inventory_lots.category`.
- **`src/lib/pos/types-store.ts`** — DB-backed reads w/ hardcoded fallback:
  `listInventoryTypes()`, `listWebsiteCategoryTypes()`, `normalizeInventoryTypeKey()`.
- **Admin `/admin/settings/types`** — UI to edit categories + map inventory types
  to a website category (`page.tsx` + `actions.ts`).

**So the mapping data + management UI exist.** What's missing is a **single
resolver** that turns a lot's raw (`category`, `inventory_type`, and when needed
`product_name`) into our website category, applied at the **back-office display /
cycle-count filter** layer.

## Files inventory (Request B)

### A — conversion source of truth (mapping)
- `src/lib/pos/transform.ts` — `CATEGORY_MAP`, `normalizeCategory`, anomaly flags.
- `src/lib/pos/inventory-type-catalog.ts` — `INVENTORY_TYPE_CATALOG`, `inventoryTypeKey`.
- `src/lib/pos/types-store.ts` — DB-backed inventory-type ↔ website-category.
- `src/lib/pos/category-taxonomy.ts` — website category labels/defs.
- Migration `0035_inventory_category_types.sql` — the two registry tables.

### B — INTAKE path (stores raw; needs converted view)
- `src/lib/inventory/intake-parser.ts` — parses `category`/`inventory_type` raw.
- `src/lib/inventory/intake-store.ts` — writes raw to `inventory_lots`; `LotWithDetail`.
- `src/lib/inventory/intake-review-core.ts` — review/normalize (fixtures use LCB values).
- `src/lib/inventory/types.ts` — `InventoryLot.category` / `.inventory_type`.
- `src/app/admin/inventory/[id]/page.tsx` — lot detail display (shows raw type/category).
- `src/app/admin/inventory/intake/...` — intake review + export routes.

### C — CYCLE COUNTS (the headline gap, B2)
- `src/lib/inventory/cycle-counts.ts` — builds `CycleCountSheetLine` w/ raw
  `category`/`inventoryType` from the lot join.
- `src/lib/inventory/cycle-count-sheet-core.ts` — `SheetLine`, `filterLines`,
  `distinctValues`, `sortSheetLines` — all operate on raw strings.
- `src/app/admin/inventory/cycle-counts/[id]/page.tsx` — builds `filterOptions`
  from `distinctValues(... l.inventoryType)` (raw). **This is the "usable
  marijuana" filter the owner sees.**
- `src/app/admin/inventory/cycle-counts/[id]/export/route.ts` — export sheet.
- cycle-count scan/sheet cores + any `CycleCountFilters`/`CycleCountSheet` UI.

### D — DO NOT TOUCH (CCRS reporting, hard-set — B3)
- `src/lib/compliance/ccrs-batch-core.ts` (+ `ccrs-batch.ts`) — `CCRS_INVENTORY_TYPES`,
  `validateProductClassification`. Authoritative CCRS enum + validation.
- `src/lib/inventory/ccrs-manifest-csv-core.ts` — CCRS manifest export.
- Any report that submits/represents CCRS values (must show the RAW lot values).

## KEY DESIGN DECISION — needs owner confirmation (do NOT guess)

The conversion is **one-to-many** and cannot be done from the coarse CCRS
`inventory_type` alone. Example: CCRS `Usable Cannabis` (or POS "Usable
Marijuana") can be our **flower**, **preroll**, **popcorn-bud**, or **trim** —
the distinction lives in the product NAME / finer POS category, not the CCRS type.

The POS *import* path already solves this via `transform.ts` using the finer POS
category + name heuristics (moon-rocks, infused detection, etc.), producing the
correct `GreenwayCategory` on `menu_items`. **The reliable source of our category
for a given lot is therefore the matching `menu_items` row (by
`pos_product_key`), which already carries the converted `category`.**

**Recommended approach (best judgment, least risk, no new mapping to maintain):**
1. Build one resolver `resolveWebsiteCategory(lot)` in a new
   `src/lib/inventory/website-category-resolver.ts` that resolves a lot's OUR
   category with this precedence:
   a. **Join to `menu_items.category` by `pos_product_key`** — authoritative,
      already converted by the import pipeline. (Preferred.)
   b. Fallback: map the lot's raw `category`/`inventory_type` via the
      `inventory_types` DB table / `INVENTORY_TYPE_CATALOG` (label → website_category).
   c. Fallback: `transform.ts`-style name heuristics for the coarse types.
   d. Final fallback: leave as the raw value + flag (never silently guess a wrong
      bucket — surface it so staff can fix the mapping in `/admin/settings/types`).
2. Apply the resolver's OUR-category to the **cycle-count sheet lines** and the
   **intake/lot back-office displays** — ADD an "Our category" field/filter while
   KEEPING the raw CCRS `category`/`inventory_type` visible for compliance.
3. **Never modify** the stored `inventory_lots.category` / `.inventory_type`
   (CCRS reporting reads them). Conversion is a *presentation/derived* layer.

**Open question for owner (blocking a final build decision):**
- For cycle counts, do you want the filter to be driven by **our website category**
  (e.g. Flower, Concentrate, Edible-Solid) *replacing* the LCB filter, or shown as
  an **additional** filter alongside the raw LCB one? (Recommendation: replace the
  primary type/category filter with our-convention, keep raw visible in a column /
  tooltip for compliance staff.)
- Should the intake **review** screen also show the resolved our-category (so staff
  confirm placement at receiving time)? (Recommendation: yes, read-only, with a
  warning when it falls back / is unmapped.)

## No-migration note (pending confirmation)
If we use approach (1a/1b) as a derived presentation layer, **no DB migration is
needed** — `menu_items.category`, `inventory_types`, and `website_category_types`
already exist. We only add code (a resolver + wire it into the back-office views).
The stored CCRS columns are untouched.

## Verification plan (B)
- Unit tests for `resolveWebsiteCategory` covering: menu_items join hit; catalog
  fallback (Flower→flower, Rosin→concentrate, Gummies→edible-solid); coarse type
  fallback; unmapped → flagged.
- Cycle-count filter shows our-convention options; filtering narrows correctly.
- CCRS export unchanged (grep-verify no compliance file changed; raw lot values
  still exported).
- `tsc --noEmit` clean + full `npm run build`.
