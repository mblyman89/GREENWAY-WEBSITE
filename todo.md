# Home + Specials Overhaul — Handoff Plan

## A. Home hero (shorten + clean) — DONE
- [x] Replace tall (560–650px) carousel Hero with a short, wide banner
- [x] Use `public/home/hero-banner.webp` (graphic-art, left-dark gradient)
- [x] Match shop-page proportions: `min-h-[8.5rem] md:min-h-[10.5rem]`, `max-w-[88rem]`
- [x] Concise title + one subline + Shop/Specials CTAs (no carousel)

## B. Home Daily Deals (dynamic day) — DONE
- [x] New `HomeDailyDeals` client component (`useStoreWeekday`)
- [x] Dynamic section title via `getDailyDealPresentation()` (e.g. "Top Shelf Thursday")
- [x] On-deal products via `selectDailyDealItems()` + standard `ProductCard`
- [x] 16 cards, reshuffles each visit, replaces the old "50% OFF CLEARANCE"

## C. Home Shop by Category — DONE
- [x] `SectionBanner` with `category-banner.webp`
- [x] 6 lanes (Flower incl popcorn+infused, Prerolls all types, Concentrates, Edibles, Liquids, Topicals)
- [x] Each tile links to `/menu?categories=a,b,c` (verified filters menu)

## D. Home Shop by Brand — DONE
- [x] `SectionBanner` with `brand-banner.webp`
- [x] `HomeBrands` client component — feature-shuffle rotation, fresh each visit
- [x] 16 cards, desktop 4x4 grid, links `/menu?brands=<brand>`

## E. Desktop / mobile parity — DONE
- [x] Wide `max-w-[88rem]` containers, 4 across desktop / 2 across mobile
- [x] Standard ProductCard used everywhere (sale badge + price auto-resolve)

## F. Hamburger Trim → Popcorn Bud — DONE
- [x] navigation-data.ts: removed duplicate Trim (Popcorn Bud already present)
- [x] MobileNavigation.tsx: same fix

## G. Specials page — DONE
- [x] Top hero shortened to `min-h-[8.5rem] md:min-h-[10.5rem]`, wide `max-w-[88rem]`
- [x] Kept 7-day `DailyDealCard` explainer (canonical rules reference)
- [x] Added `SpecialsDailyDeals`: wide day banner + 16 standard ProductCards
- [x] Desktop 4 across; data switched to `posMenuPreviewItems`

## H. Verify + ship — DONE
- [x] tsc --noEmit clean
- [x] eslint clean
- [x] npm run build clean (2366 pages, / and /specials static)
- [x] Browser verification: home hero, daily deals, category lanes (filter works),
      16 brand cards, specials hero + banner + 16 daily-deal cards
- [x] Removed unused HomeProductCard.tsx; no mockMenuItems in home/specials
- [x] Commit + push + open PR
