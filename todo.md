# Shop Page Enhancement — PR #18 (feature/shop-page-cosmetic-overhaul)

Handoff plan for the 7-part enhancement request. All tasks complete & verified.

## A. Sidebar in-flow scroll (FIX prior sticky)
- [x] Remove `lg:sticky lg:top-6 lg:max-h-[...] lg:overflow-y-auto` from `<aside>`
- [x] Keep `lg:self-start` so sidebar is tied to its top position and scrolls with the page
- [x] Verified: sidebar scrolls together with product cards, stops once past last filter

## B. Remove helper text under filter labels
- [x] Removed `helper=` from Strains, Weights, Price, THC, CBD FilterSections
- [x] Kept Categories ("Shop by product type") and Brands helper text
- [x] Applies to both desktop + mobile (shared `MenuFilterControls`)

## C. Remove preview-only paragraph
- [x] Removed "Preview-only filters use exact-match POS product data..." block

## D. Fix Shop dropdown navigation
- [x] navigation-data.ts: 20 real categories mirroring `websiteCategoryDefinitions`
- [x] Each href `/menu?category=<value>` pre-filters the shop page
- [x] NavLink.tsx: dropdown scrollable (`max-h-[70vh] overflow-y-auto`)
- [x] MobileNavigation.tsx: same category list with `?category=<value>`
- [x] Verified: dropdown shows all 20 categories w/ customer-friendly helpers

## E. Fix daily-deals → product card mapping (CRITICAL BUG)
- [x] daily-deals.ts rewritten: `getStoreWeekday()` via Intl America/Los_Angeles
- [x] All 7 days implemented (Mon Munchie, Tue Doobie, Wed Wax, Thu Top Shelf,
      Fri Ounce, Sat Super, Sun Ice Cream) with category gating + bonus notes
- [x] useStoreWeekday.ts hook (useSyncExternalStore, hydration-safe)
- [x] ProductCard / RelatedProductCard / ProductDetailPurchasePanel resolve client-side
- [x] Verified LIVE: badge reads "Top Shelf Thursday · 25% off" (today=Thursday) — bug fixed

## F. Accessories images + descriptions
- [x] 14 professional WebP images on dark theme in public/accessories/ (516K total)
- [x] Rewrote all 14 accessory descriptions as compelling sales copy
- [x] Verified: 14/14 images load, descriptions render

## G. Filter persistence on back/breadcrumb
- [x] menu/page.tsx forwards categories/strains/brands/weights/maxThc/maxCbd/maxPrice/sort
- [x] InteractiveMenuBrowser lazy-inits state from persisted params (hydration-safe)
- [x] URL-write effect (replaceState) gated by firstWriteRef
- [x] Verified: product → back restores URL, pills, sort

## H. Verify & deliver
- [x] tsc --noEmit: 0 errors
- [x] eslint changed files: 0 errors (1 pre-existing <img> warning)
- [x] npm run build: success, 2366 pages, /menu Dynamic, BUILD_ID qcpeTe04ev_kNl9kuo4JS
- [x] Live browser verification of A–G
- [ ] Commit + push to feature/shop-page-cosmetic-overhaul
- [ ] Confirm PR #18 updates + Vercel preview
