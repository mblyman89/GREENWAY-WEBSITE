# Vendors/Brands Import + Dynamic Menu — Work Plan

**Status:** living document. Hand-off ready. Follows standing rules
(verbatim requests, verified-not-guessed, drafts-only, slices, idempotent
migrations applied MANUALLY by owner, money in minor units, CCRS+DOH
compliance, branch+PR+squash-merge to protected `main`).

Branch: `feature/vendors-import-and-dynamic-menu` (off `main` after #222 + #223 merged).

---

## Verbatim request (Request F)
> "the vendor and brands data should not be deleted... I will be getting my vendor
> and brand data from Cultivera soon, and when I do I will upload it in and it will
> fill in as many gaps as it can. I will however need an import button so the
> vendors and brands page can get the data from Cultivera please add that feature
> in first. I'll give it to you first so you can make sure the file upload works
> for the spreadsheet they give me, but for now just add an import button if there
> isn't one there already. Then let's just focus on the dynamic menu. You can
> merge the reset feature and the one after it too... After the import button has
> been added and the dynamic menu has been resolved, we can go back to the kb
> hardening. Please complete all work on the import button and dynamic menu issue
> then stop. Then I will inspect, then on to kb hardening."
> (Follow-up: "I need you to do the pushing and merging and stuff.")

---

## Done
- [x] Squash-merged PR #222 (reset) → main (0069 on main).
- [x] Squash-merged PR #223 (KB deep-extraction + taxonomy) → main (0070 on main).
- [x] Branched `feature/vendors-import-and-dynamic-menu` off fresh main.

## Verified facts (not guessed)
- `/admin/vendors` = the combined Vendors & Brands page. No separate `/admin/brands`.
- **No import button exists today.** Vendors/brands are only seeded via
  `npm run seed:vendors` (105 vendors + 168 brands, upsert by slug) or edited
  one at a time.
- Customer menu is served from the **static committed JSON**
  `src/data/pos-menu-preview.json` (6,226 items) via `src/lib/pos/preview-menu.ts`
  — NOT the DB. The DB menu (`menu_versions`→`menu_items`, migration 0002) exists
  but the site never reads it. THIS is the "broken pipeline."

## Slice V1 — Vendors/Brands Import button (FIRST) ✅ DONE
- [x] Import control on `/admin/vendors` header → `/admin/vendors/import`.
- [x] `src/lib/vendors/import.ts`: tolerant header mapping (vendor & brand sheet
  synonyms), gap-fill upsert BY SLUG (never overwrites curated data), new rows
  land as `draft`, social links merged non-destructively, brands resolve parent
  vendor by slug. Reuses `parseCsv` from customers importer.
- [x] `/admin/vendors/import` page (paste-CSV, mirrors customers import UX).
- [x] Server action `importVendorsBrandsAction` — audit-logged (`vendors.import`).
- [x] tsc clean. Column mapping is tolerant of common variants; finalize exact
  columns when owner supplies the real Cultivera export file.

## Slice P1 — Dynamic menu (SECOND, then STOP) ✅ DONE (pending build verify)
- [x] New `src/lib/pos/live-menu.ts`: `loadLiveMenuItems()`,
  `loadLiveMenuAll()`, `getLiveMenuItemById()`, `menuRowToGreenwayItem()`.
  Reads the PUBLISHED `menu_versions` snapshot via `getPublishedVersion()` +
  `getVersionItems()` and converts `MenuItemRow`(+variants) → `GreenwayMenuItem`.
  Fallback: committed JSON ONLY when Supabase unconfigured; when configured but
  no published version → returns [] (empty menu = no product cards). This is the
  fix for the broken pipeline.
- [x] Rewired all 6 consumers off the static JSON:
  - `src/app/page.tsx` (home deal items + PromoGrid brand grid)
  - `src/components/home/PromoGrid.tsx` (now takes `items` prop)
  - `src/app/menu/page.tsx`
  - `src/app/menu/products/[id]/page.tsx` (helpers now async; `generateStaticParams`
    removed; `dynamic = "force-dynamic"`)
  - `src/components/specials/SpecialsContent.tsx` (now takes `menuItems` prop) +
    `src/app/specials/page.tsx` (`dynamic = "force-dynamic"`)
  - `src/app/sitemap.ts` (now async)
- [x] tsc clean. No remaining direct consumers of `preview-menu` outside the
  live-menu fallback.
- [ ] Full `npm run build` verification (running).

## After that: STOP for owner inspection, then resume KB hardening
(see prior audit conclusion: validated enrichment does NOT flow to KB yet;
build write-back per agreed design — drafts-only, per-SKU kb_products,
effects with medical-claim filter, images via kb_image_substitutes).
