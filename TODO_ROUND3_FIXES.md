# TODO — Round 3 Fixes (handoff-ready)

Branch: `feature/round3-search-price-pdp` (off latest `main` @ 5cc97ce). New PR.
Working dir: `/workspace/_gw_clone`. Repo: `mblyman89/GREENWAY-WEBSITE` (Next.js 16 / React 19 / Tailwind v4 / Vercel).
Live prod URL: https://greenwaywebsite1.vercel.app  (project renamed to greenway_website, subdomain still greenwaywebsite1).
Tokens: `--orange #ff7f00`, `--greenway #7ed957`. Push: `git push https://x-access-token:$GITHUB_TOKEN@github.com/mblyman89/GREENWAY-WEBSITE.git <branch>`. GH: `GH_TOKEN="$GITHUB_TOKEN" gh ...`.
Validate: `npx tsc --noEmit` · `npx eslint src` · clean `rm -rf .next && npm run build`.
Mobile verify: Playwright connect_over_cdp :9222 fresh ctx 390x844 dsf3 is_mobile has_touch iPhone UA, localStorage greenway-age-confirmed-v1="true", CDP Network.clearBrowserCache.

ONLY THESE 3 REMAIN (others confirmed resolved by user — do NOT touch them):

## 1. Mobile top search bar input NOT visible/usable  [x] DONE
- File: `src/components/site/SearchModal.tsx`.
- Symptom (user screenshot): tapping search shows "SEARCH PRODUCTS" title then immediately the page breadcrumb — the search INPUT pill is entirely missing/clipped. Has NEVER been visible.
- Root cause: panel was `fixed top-0 z-[100]` sized to content; the page's sticky header/breadcrumb (and the short panel bg) covered/clipped the input area below the title.
- FIX (done): rewrote as a FULL-SCREEN overlay — `fixed inset-0 z-[10000] flex flex-col bg-black/80 backdrop-blur-sm` with a top panel (`bg-[#111]`, `pt-[calc(env(safe-area-inset-top)+4.5rem)]`) containing title + input. Backdrop click closes. Nothing can render over it now. Focus uses preventScroll.
- Verify: mobile Playwright — open search, the full input pill is visible directly under the title.

## 2. Product card price NOT vertically centered  [x] DONE
- File: `src/components/menu/ProductCardPriceSelector.tsx` (PriceLine, active-sale branch).
- Symptom (user screenshot): struck `$50.00` + `$35.00/3.5g` sit at the BOTTOM of the price box, not vertically centered (horizontal centering was fine).
- Root cause: the active-sale row used `items-baseline` on the full-height (`min-h-[3.35rem]`) flex span, so the baseline pushed text to the bottom.
- FIX (done): changed outer span to `items-center` (true vertical centering) and made the price+unit a nested `inline-flex items-baseline` so they still share a baseline. Horizontal centering (`justify-center`) unchanged. Applies to ALL cards (ProductCard, RelatedProductCard, ProductCardVisual all route through this).
- Verify: desktop + mobile menu — struck+discounted price dead-center (both axes) in the box.

## 3. PDP image too short + scrolls with user (both cannabis & merch)  [x] DONE
- File: `src/app/menu/products/[id]/page.tsx` (image grid cell).
- Symptom: image placeholder not tall enough; should extend DOWN flush with the bottom of the description. Also the (sticky) image still scrolls/moves with the user — it must be COMPLETELY fixed in place.
- FIX (done): grid `md:items-start` → `md:items-stretch`; image cell `md:sticky md:top-28` → `md:h-full`. Now the image column stretches to the full height of the info+description column and the inner `ProductHeroArt` (`h-full`) fills it — image is flush with the description bottom and is a static block that does NOT move on scroll. Mobile PDP layout unchanged (md: only).
- Verify: desktop cannabis PDP + merch PDP — tall image flush with description bottom; scrolling does NOT move the image.

## Finalize  [x] DONE
- [x] `npx tsc --noEmit` clean (exit 0)
- [x] `npx eslint src` 0 errors (exit 0)
- [x] clean build OK (✓ Compiled successfully, 2371 pages)
- [x] Visual verify all 3:
      #1 mobile search input visible top=132 bottom=190 visibleInViewport:true topElIsInput:true (nothing covering)
      #2 price offsetFromCenter:0 alignItems:center (struck+discounted dead-center both axes)
      #3 PDP image pos:static (scrolls with page, no float), tall & flush with description bottom — cannabis + merch verified
- [x] Scratch in /workspace/_verify/ (outside repo) + logs — deleted, none committed
- [x] Commit + push new branch, open PR, confirm Vercel checks pass, merge, confirm prod deploy
