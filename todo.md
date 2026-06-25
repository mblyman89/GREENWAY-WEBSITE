# FIX: Filter persistence on return to /menu — PR #18 (feature/shop-page-cosmetic-overhaul)

## Problem (was confirmed empirically)
Returning to /menu from a product detail page did NOT restore filters:
- Page "← Back" button was `<Link href="/menu">` (no params) → reset to 2325 of 2325
- Breadcrumb "Menu" was `<Link href="/menu">` (no params) → reset filters
- Browser back was unreliable (App Router RSC cache served the empty-param render)

## Fix (implemented + verified)
- [x] Read & trace all relevant files
- [x] Reproduce the bug in the production build via browser automation
- [x] A. Created `src/components/menu/BackToMenuLink.tsx` — client component that
      calls `router.back()` (returns to the EXACT prior filtered URL + router state)
      with a safe fallback to `<Link href="/menu">` for direct landings (no
      same-origin history). Respects modifier/middle clicks.
- [x] B. Product page "← Back" now uses `BackToMenuLink`.
- [x] C. Breadcrumb "Menu" now uses `BackToMenuLink`.
- [x] D. `InteractiveMenuBrowser` lazy state init now reads the LIVE
      `window.location.search` (merged with server params via `resolveInitialParams`)
      so cache-restored renders rehydrate every filter.
- [x] E. Kept the replaceState URL-write effect (URL always reflects state).
- [x] F. Added a `popstate` listener safety net that re-syncs ALL filters from the
      URL on browser back/forward (sets firstWriteRef so the write effect won't
      clobber the restored state).

## Verify & deliver
- [x] tsc --noEmit: 0 errors
- [x] eslint changed files: 0 errors (1 pre-existing <img> warning only)
- [x] npm run build: success (2366 pages, /menu dynamic)
- [x] Browser verify ALL THREE return methods restore filters AND product count:
      baseline flower+indica+price-low = "Showing 30 of 2325"
      - [x] Browser back button → 30 of 2325 ✓
      - [x] Page "← Back" button → 30 of 2325 ✓
      - [x] Breadcrumb "Menu" → 30 of 2325 ✓
- [x] Complex combo (flower+indica+maxPrice=40+sort=price-high = 25 items):
      product → Back restored URL, count=25, sort, and $40 price pill ✓
- [x] Direct-landing fallback: Back still navigates to a valid /menu (not stuck) ✓
- [x] Visual proof screenshot: pills FLOWER/INDICA/$40, "Showing 25 of 2325",
      sort Price High-Low, indica flower products shown ✓
- [ ] Commit + push to feature/shop-page-cosmetic-overhaul
- [ ] Confirm PR #18 + Vercel preview
