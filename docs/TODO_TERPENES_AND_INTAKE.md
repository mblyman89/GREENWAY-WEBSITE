# TODO — Terpenes + Intake Conversion + Card Neon Split

Branch: `feat-terpenes-intake-conversion`. Base: `main` @ `b02d8b6`.
Refs: REQUESTS_TERPENES_AND_INTAKE_CONVERSION.md, TERPENE_AUDIT.md,
INTAKE_CATEGORY_CONVERSION_AUDIT.md. Standing rules apply. Hand-off ready.

## Phase 0 — setup
- [x] Create branch `feat-terpenes-intake-conversion` from main.

## Phase 1 — Terpene menu filter (Request A / A4) — NO migration
- [x] Add optional `terpenes?: string[]` to `GreenwayMenuItem` (leafly/types.ts).
- [x] Build a KB-strain → terpene resolver used at menu build/serve time
      (strain-terpenes.ts pure core + strain-terpenes-server.ts; 10/10 tests).
- [x] Wire the resolver into the /menu data path (posMenuPreviewItems → withTerpenes).
- [x] Add a terpene filter facet to InteractiveMenuBrowser (multi-select, ANY match).
- [x] Mirror in the static MenuFilterControls (FilterMobile.tsx) fallback component.
- [x] 460 preview items carry real terpenes (8 distinct types) — no sample fabrication needed.

## Phase 2 — Card neon leaning split (BONUS)
- [x] ProductCardVisual: split neon — leaning color LEFT, hybrid color RIGHT
      (indica-hybrid = indica-blue L / hybrid-green R; sativa-hybrid = sativa-orange L / hybrid-green R).
      Applied to radial bg, boxShadow, + both edge strips. Pure types keep single color.
- [x] Print-safe / accessible; no layout breakage.

## Phase 3 — Intake → our-convention resolver (Request B) — NO migration
- [x] New `src/lib/inventory/website-category-resolver.ts` (PURE core, 31/31 tests):
      resolveWebsiteCategory(lot) precedence a→d exactly as specced.
- [x] Returns { websiteCategory, label, raw, source, unmapped }.
- [x] Server companion `website-category-resolver-server.ts`: loadInventoryTypeMap
      (DB overlay on catalog), loadMenuCategoriesForKeys (published menu_items),
      resolveWebsiteCategories (batch), resolveWebsiteCategoryForLot. Degrades gracefully.

## Phase 4 — Cycle counts: our-convention filter (B2, Q1 = replace + keep raw)
- [x] cycle-count-sheet-core: added websiteCategory/label/categoryUnmapped to SheetLine;
      PRIMARY `category` filter now matches website category (value OR label);
      added `rawCategory` filter; category sort uses website label; export shows
      "Category" (our label) + "LCB Type" + "LCB Category" columns. KEEP raw fields.
- [x] cycle-counts.ts: batch-resolve website category on sheet lines (read-only).
- [x] cycle-counts/[id]/page.tsx: primary Category filter = our convention;
      added "LCB category" + "LCB inventory type" reference filters (kept available);
      each row shows resolved category badge + raw "LCB:" + unmapped warning w/ "Map it →".
- [x] Self-tests updated (all pass).

## Phase 5 — Intake / lot back office (B1, B4, Q2 = show resolved read-only)
- [x] Lot detail (admin/inventory/[id]/page.tsx): "Category" row = resolved our
      convention; added "LCB classification" row (raw); unmapped warning banner
      linking to Settings → Types. Stored CCRS values untouched.
- [x] Intake review (admin/inventory/intake/[id]/page.tsx): each lot shows resolved
      category badge + raw "LCB:" + unmapped "Map it →". listManifestLots now selects
      category/inventory_type (read-only). CCRS values never modified.

## Phase 6 — verify + ship
- [x] resolver self-tests pass (31/31); terpene 10/10; cycle-count-sheet-core pass.
- [x] terpene filter + card split verified (build renders /menu).
- [x] `rm -rf .next && npx tsc --noEmit` clean (exit 0).
- [x] `npm run build` succeeds (2380 routes, BUILD_DONE_EXIT=0).
- [x] CCRS untouched (git diff main -- src/lib/compliance = empty).
- [ ] Commit, push, open PR, squash-merge.
