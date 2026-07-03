# Backbone Connectivity Audit

**Purpose:** Methodically map how every part of the back office connects (or fails to
connect) to the Knowledge Base "backbone" — the golden-record data command center.
This is an AUDIT + STRATEGY document. No behavior is changed by this file.

**Method:** Every claim below is verified against the file tree / migrations (never
guessed). Where a claim is verified, the source file + line/grep is noted.

**Standing rules honored:** verified fact only; find it in the tree; money in cents;
CCRS + DOH compliance preserved; drafts-only; hand-off ready.

---

## 0. TL;DR — the core finding

There are **two parallel data universes** that are only loosely (string-)joined:

1. **KB universe (the "backbone" we just built):**
   `kb_strains`, `kb_terpenes`, `kb_category_terms`, `kb_product_categories`,
   `kb_brands` (brand *facts*), `kb_products` (per-SKU golden records),
   `kb_banned_phrases`, `kb_image_substitutes`, `kb_notes`.

2. **Operational universe (what the POS/menu/inventory/purchasing actually run on):**
   `vendors` + `brands` (real master data, FK-linked), `product_masters`
   (curated menu cards), `menu_items`/`menu_variants` (imported live menu),
   inventory lots, purchase orders, etc.

The KB hub's "Brand facts" card counts `kb_brands` (a *facts* table, likely near-empty),
while the real brands the owner sees on the Vendors page live in `brands`. That is why
the card reads **0** even though brands exist. (Verified below.)

The public menu's product cards (`product_masters`) reference brand/vendor/strain by
**free-text name**, not by FK — so the menu is only string-joined to the backbone.

---

## 1. Confirmed bugs (owner-reported, root-caused)

### Bug A — "Brand facts" card shows 0 brands
- **Where:** `src/app/admin/knowledge-base/page.tsx` L121 `count={counts.brands}`.
- **Source of count:** `getKbCounts()` (`src/lib/ai/kb/store.ts` L44) counts table
  `kb_brands` (L57 `tableCount("kb_brands")`).
- **Real brands live in:** operational table `brands` (migration 0003), read by
  `src/lib/vendors/store.ts` (`listAllBrands`, `listBrandsForVendor`).
- **Root cause:** `kb_brands` (brand *facts*: "known for", voice) is a DIFFERENT table
  from `brands` (operational master data). The KB "Brand facts" editor writes to
  `kb_brands`; the Vendors page manages `brands`. They are not linked.
- **Fix direction (Slice 7 candidate):** either (a) show the operational `brands` count
  on the KB hub and treat `kb_brands` as an *enrichment overlay* keyed by brand slug, or
  (b) unify — make brand facts a column set on `brands` (bigger migration). Needs owner
  decision. See §5 Strategy.

### Bug B — "Terpenes" tile is not a link (goes nowhere)
- **Where:** `src/app/admin/knowledge-base/page.tsx` L160–171 — the Terpenes tile is a
  plain `<div>` (stat card), NOT a `KbNavCard`, and there is **no** `/admin/knowledge-base/terpenes`
  route (verified: `ls` → No such file or directory).
- **There is no terpene editor UI anywhere** (grep: terpenes only appear in StrainEditor,
  setup, review, actions — all read/seed only). Terpenes ARE consumed by the menu
  (`src/lib/menu/strain-terpenes.ts`).
- **Fix direction:** either build a real `/terpenes` view (list + read-only detail, since
  terpenes are seeded reference data) OR restyle the tile so it clearly isn't clickable.
  Recommend building the read view for consistency (every other tile opens a page).

---

## 2. Backbone tables (schema truth, from migrations)

| Table | Migration | Role | Keyed by |
|---|---|---|---|
| kb_strains | 0019/0020 | strain golden facts | slug |
| kb_terpenes | 0019 | aroma/flavor reference | slug/name |
| kb_category_terms | 0019 | vocabulary per format | — |
| kb_product_categories | 0070 | product-format taxonomy | slug |
| kb_brands | 0019 | brand *facts* (voice/known-for) | slug |
| kb_products | 0071 | per-SKU golden records | brand_slug + product_slug |
| kb_banned_phrases | 0019 | compliance guardrails | phrase |
| kb_image_substitutes | 0021 | DAM fallbacks | scope+key |
| kb_notes | 0056 | house knowledge | — |
| **vendors** | 0003 | operational vendor master | slug, id |
| **brands** | 0003 | operational brand master | slug, id, vendor_id→vendors |
| **product_masters** | 0036 | curated public-menu cards | id; brand_name/vendor_name/strain_name = TEXT |
| menu_items / menu_variants | (POS import) | imported live menu | pos_product_key |

**Key relational gaps found so far:**
- `product_masters.brand_name / vendor_name / strain_name` are FREE TEXT, not FKs.
  (Verified: 0036 L40–46.) → menu is string-joined to backbone, not relationally.
- `kb_brands` (facts) has no FK to `brands` (operational). Two brand tables.
- `kb_products` keyed by `brand_slug` (text) — soft link to `brands.slug`.

---

## 3. Per-area connectivity map (IN PROGRESS)

(Filled in methodically below as each admin area + lib module is traced.)

### 3.1 Public MENU (the heart of Slice 7)
- **Render path (verified):** `src/app/menu/page.tsx` L36
  `withResolvedImages(await withMenuProfile(await loadLiveMenuItems()))`.
- **Source of truth:** `src/lib/pos/live-menu.ts` → `loadLiveMenuItems()` reads the single
  published `menu_versions` snapshot (`menu_items` + `menu_variants`). Falls back to
  committed JSON only when Supabase unconfigured.
- **`menuRowToGreenwayItem` (L74–99):** maps DB row → site item using
  `brand_name`, `vendor_name`, `strain_name`, `description`, `category` — ALL free text
  from the POS import. **No FK to `brands`/`vendors`/`kb_*`.**
- **What KB enrichment IS applied today:**
  - `withMenuProfile` (`src/lib/menu/strain-terpenes-server.ts`) overlays
    **strain type + terpenes** from `kb_strains` by normalized strain name/slug. ✅ connected
  - `withResolvedImages` (`src/lib/enrichment/image-resolver.ts`) resolves product image →
    `product_masters` media → `kb_image_substitutes` (scope product/brand/vendor/category).
    ✅ connected (DAM fallbacks reach the menu).
- **What KB enrichment is NOT applied (the Slice-7 gap):**
  - `kb_products` (per-SKU golden records: curated description, aroma/flavor/effects,
    curated images) — **NOT read by the menu at all.** ❌
  - `kb_brands` (brand facts / "known for" / voice) — **NOT read by the menu.** ❌
  - `kb_product_categories` (format taxonomy / vocabulary) — **NOT read by the menu.** ❌
- **Consumers of GreenwayMenuItem (verified grep):** product detail page, specials, home
  daily deals, home brands, promo grid, related products, syndication feed, merch catalog.
  → Any menu enrichment we add propagates to all of these. High leverage.

### 3.2 Images / DAM
- `image-resolver.ts` is a real connection: menu images fall back through
  `kb_image_substitutes`. ✅
- BUT it resolves the product image from `product_masters` media (L179), NOT from
  `kb_products.primary_media_id/image_media_ids`. So curated KB product images don't
  reach the menu yet. Soft gap to close in Slice 7.

### 3.3 Brands — the "two brand tables" problem (root of Bug A)
- Operational `brands` (0003): managed on `/admin/vendors`, FK `vendor_id → vendors`,
  read by `src/lib/vendors/store.ts`. This is what the owner SEES as "brands".
- KB `kb_brands` (0019): brand *facts* only (slug, name, known_for, active); managed on
  `/admin/knowledge-base/brands`; read by KB retrieval. Near-empty unless seeded.
- **No link between them.** The KB hub counts `kb_brands` → shows 0.
- Menu uses neither relationally — it uses `menu_items.brand_name` (free text).
- Home "brands" section: `src/components/home/HomeBrands.tsx` derives brands from
  `GreenwayMenuItem[]` (i.e. `menu_items.brand_name` strings), NOT from `brands` or
  `kb_brands`. ❌ fully disconnected from master data.

### 3.4 Products admin & the product_masters ↔ kb_products bridge
- **Products admin** (`/admin/products`) manages `product_masters` /
  `product_master_members` / `product_master_suggestions` (0036). Self-contained.
- **One-way WRITE bridge EXISTS:** `src/lib/ai/kb/writeback.ts` promotes accepted product
  enrichment / AI suggestions into `kb_products` as drafts, carrying `pos_product_key`
  (writeback L203/L257). Products admin actions log `kb_writeback` (actions.ts L147, L236;
  bulk-ai/actions.ts L100). ✅ product data flows INTO the KB.
- **READ-BACK ladder EXISTS BUT IS ORPHANED:** `src/lib/ai/kb/product-lookup.ts`
  (`resolveProductKnowledge`) implements exactly the KB-first read ladder Slice 7 needs
  (kb_products published → draft → product_enrichments → kb_strains → "find online").
  **It has ZERO callers** (verified grep). Built, never wired. ⭐ high-value Slice-7 hook.

### 3.5 Product DETAIL page (/menu/products/[id])
- Sources (verified): `getLiveMenuItemById` + `withMenuProfile` (strain/terpene) +
  `withResolvedImages` (images). Does NOT call `resolveProductKnowledge` / read
  `kb_products` / `kb_brands`. ❌ Same strain-only enrichment as the menu grid.

### 3.6 Operational master data IS well-connected (the good news)
- `vendors` + `brands` (0003) are FK-linked (brands.vendor_id → vendors.id) and read
  relationally by: Vendors admin, Inventory (`inventory_lots` + reads vendors/brands),
  Purchasing (`purchase_orders` + reads vendors/brands). ✅
- So the operational spine is solid. The gaps are specifically KB↔operational/menu.

### 3.7 Table-usage census (verified via grep of from("...") per area)
- products: product_masters(8), product_master_suggestions(5), product_master_members(4)
- inventory: inventory_lots(30), cycle_count_lines(12), inbound_manifests(9),
  cycle_counts(9), inventory_adjustments(7), destruction_events(7), lab_results(6),
  catalog_product_drafts(6), vendors(4), brands(4), vendor_returns(3), sample_settings(2)
- purchasing: purchase_orders(6), purchase_order_lines(5), reorder_settings(2),
  vendors(1), brands(1)
- media: media_assets(9), media_usages(3)
- vendors: vendors(12), brands(9), media_assets(3), vendor_aliases(1)

### 3.8 AI retrieval / the "brain"
- `src/lib/ai/kb/retrieval.ts` reads: kb_strains, kb_terpenes, kb_category_terms,
  kb_brands, kb_notes, kb_banned_phrases. ✅
- Does NOT read `kb_products` or `kb_product_categories` (verified grep count 0). ❌
  → even the AI brain doesn't yet use the two newest, richest KB tables.

### 3.9 Syndication (external menus: Leafly/Weedmaps)
- `src/lib/syndication/menu-feed-core.ts` maps from published `menu_items` (subset of
  MenuItemRow). So ANY enrichment we push onto the live menu also flows to third-party
  channels. High leverage — AND a compliance surface (external menus must stay clean).

---

## 4. The backbone is ALREADY DESIGNED to join — schema proof (kb_products, 0071)

`kb_products` (0071) already carries the full join set (verified from migration):

```
product_category_id uuid → kb_product_categories(id)
primary_media_id    uuid → media_assets(id)          -- DAM
kb_strain_id        uuid → kb_strains(id)
kb_brand_id         uuid → kb_brands(id)              -- KB brand facts
brand_id            uuid → brands(id)                 -- OPERATIONAL brand
vendor_id           uuid → vendors(id)                -- OPERATIONAL vendor
pos_product_key     text                              -- soft link to menu_items
brand_slug/product_slug/variant_label (unique)        -- natural key
```

**This means the hard part (schema) is DONE.** `kb_products` is purpose-built to be the
JOIN HUB between the KB and the operational/menu world. Slice 7 is mostly *populating
these FKs* and *reading them back*, not new schema.

**Write-side status (verified in `writeback.ts` L217–219):**
- Populates: `kb_strain_id`, `brand_id`, `vendor_id`. ✅ (partial)
- Does NOT populate: `kb_brand_id`, `product_category_id`. ❌ (2 FKs left empty)

**Read-side status:**
- `product-lookup.ts` `resolveProductKnowledge()` = the KB-first read ladder — **built but
  ORPHANED (zero callers).** ⭐ The single highest-value hook to wire.

---

## 5. GAP REGISTER (what needs connecting)

| # | Gap | Evidence | Impact | Effort |
|---|---|---|---|---|
| G1 | KB hub "Brand facts" counts `kb_brands` not operational `brands` → shows 0 | page.tsx L121 / store L57 | owner confusion (Bug A) | XS (count swap) or M (unify) |
| G2 | Terpenes tile is a dead `<div>`, no route/editor | page.tsx L160-171; no /terpenes | Bug B; inconsistent UX | S (build read view) |
| G3 | Menu grid does NOT read `kb_products` golden records | live-menu + menu/page.tsx | curated copy never shown | M |
| G4 | Product detail page does NOT call `resolveProductKnowledge` | products/[id] L15-17,253 | orphaned KB-first ladder unused | S–M (wire existing) |
| G5 | `kb_brands` (facts) not linked to `brands` (operational) | two tables, no FK | brand voice not tied to real brand | M (link by slug or FK) |
| G6 | Home "Shop by Brand" derives from menu strings, not `brands` | HomeBrands.tsx | brand pages not master-data driven | M |
| G7 | Menu images resolve from product_masters media, not `kb_products` curated images | image-resolver L179 | curated KB images not shown | S |
| G8 | Writeback leaves `kb_brand_id` + `product_category_id` empty | writeback L217-219 | 2 backbone FKs unpopulated | S |
| G9 | AI retrieval doesn't read `kb_products` / `kb_product_categories` | retrieval.ts grep=0 | AI brain misses richest tables | S–M |
| G10 | `product_masters` uses brand_name/vendor_name/strain_name as TEXT (no FK) | 0036 L40-46 | menu cards only string-joined | M–L (backfill + link) |
| G11 | Menu category vocabulary not sourced from `kb_product_categories` | live-menu category=text | inconsistent format taxonomy | S–M |

Effort key: XS<S<M<L. All read-side work is defensive (degrade pre-0071); no risky migrations
required except the optional deeper G10 backfill.

---

## 6. PROPOSED STRATEGY (for owner discussion — NOT yet built)

Sequenced smallest-risk-first, each a merge-able slice. Numbered as Slice-7 sub-steps.

**7a. Fix the two visible bugs (XS/S).**
   - Bug A: change the KB hub "Brand facts" card to show the OPERATIONAL brand count
     (from `brands` via vendors store), and reframe the KB brands editor as an
     *enrichment overlay* on real brands. (Or, if you prefer full unification, do G5 —
     bigger; needs your call.)
   - Bug B: build a real read-only `/admin/knowledge-base/terpenes` list+detail (matches
     every other tile), OR restyle the tile so it's clearly not a button. Recommend the
     read view for consistency.

**7b. Wire the orphaned KB-first read ladder into the product experience (S–M).**
   - Call `resolveProductKnowledge()` in the product DETAIL page first, then the menu grid,
     so curated `kb_products` copy/sensory/effects/images are shown when present, with the
     existing enrichment/strain fallback. This is the "menu + KB fully integrated" you want.
   - Compliance: run existing banned-phrase guardrails on any surfaced copy.

**7c. Close the write-side FK gaps (S).**
   - Populate `kb_brand_id` (match brand_slug → kb_brands) and `product_category_id`
     (match category → kb_product_categories) in `writeback.ts` so the join hub is complete.

**7d. Make brand surfaces master-data driven (M).**
   - Home "Shop by Brand" + brand filter pages read `brands` (operational) enriched by
     `kb_brands` facts, instead of raw menu strings.

**7e. Feed the AI brain the richest tables (S–M).**
   - Add `kb_products` + `kb_product_categories` to `retrieval.ts` context.

**7f. (Optional, deeper) Relationally link `product_masters` to the backbone (M–L).**
   - Backfill/curate `product_masters` → `brands`/`vendors`/`kb_strains` FKs (or a mapping),
     so the menu is relationally joined, not string-joined. Bigger; do last, with your input.

**Open questions for the owner (need answers before building 7a/7d):**
1. Brands: prefer the QUICK fix (KB hub shows operational count; kb_brands stays an overlay
   keyed by slug) or the UNIFY approach (fold brand facts onto the `brands` table — a
   migration you'd run)? 
2. Terpenes: build a read-only terpenes page, or just restyle the tile?
3. Menu integration order: detail page first (safer, lower traffic) then grid, agreed?
4. Any brand/product copy shown on the PUBLIC site must pass compliance guardrails —
   confirm we apply `kb_banned_phrases` + built-in WA rules to KB copy before display.

