# TODO — Round 2 Fixes (handoff-ready)

Branch: `feature/merch-pdp-pricing-polish` (PR #24 still OPEN — stack onto it)
Working dir: `/workspace/_gw_clone`
Repo: `mblyman89/GREENWAY-WEBSITE` (Next.js 16 / React 19 / Tailwind v4 / Vercel)

Tokens: `--orange #ff7f00`, `--greenway #7ed957`, `--gold #ffd700`. Wide container = `max-w-[88rem]`. Store TZ `America/Los_Angeles`.
Push: `git push https://x-access-token:$GITHUB_TOKEN@github.com/mblyman89/GREENWAY-WEBSITE.git feature/merch-pdp-pricing-polish`. GH: `GH_TOKEN="$GITHUB_TOKEN" gh ...`.
Validate: `npx tsc --noEmit` · `npx eslint src` · clean `rm -rf .next && npm run build` (2371 pages, ~130s, run in bg).
Browser verify: Chromium CDP :9222 (1600x900 desktop). Mobile = Playwright connect_over_cdp fresh ctx 390x844 dsf3 is_mobile has_touch iPhone UA, localStorage greenway-age-confirmed-v1="true". ALWAYS CDP Network.clearBrowserCache.

## 1. Desktop side-cart: address banner too close to right edge  [x] DONE & VERIFIED
- File: `src/components/cart/CartProvider.tsx` (StoreCard, ~line 387).
- Current: `sm:pl-4 sm:pr-10` — still touches the screen edge.
- Fix: significantly increase the RIGHT padding/margin of the address text block on desktop so the full "...WA 98367" sits comfortably inside the banner with breathing room from the edge. Mobile (`px-3`) UNCHANGED.
- Verify: desktop side cart open — address has clear gap from right edge.

## 2. Mobile top search bar still cropped  [x] DONE & VERIFIED (input top=120px bottom=178px, fullyVisible:true)
- File: `src/components/site/SearchModal.tsx`.
- Symptom (screenshot): the search INPUT pill is cut off at the top — only the bottom orange outline shows below the "SEARCH PRODUCTS" title; the input box top is clipped above the visible content area.
- Root cause: the panel/input doesn't reserve enough top space below the device status bar + the panel header; the input is rendered partially off-screen / behind the header.
- Fix: ensure on mobile the open search panel pushes the input fully into view: add safe-area top padding (`pt-[max(...,env(safe-area-inset-top))]`), give the header + input enough vertical room, make the input its own block with margin below the title so the WHOLE pill is visible. DESKTOP header search = DO NOT TOUCH.
- Verify (mobile Playwright): open search, screenshot — full search input pill visible with title above it, not clipped.

## 3. Product card price box: missing struck original price  [x] DONE & VERIFIED (desktop 414 struck; mobile menu 414, home rail 16; samples $120/$84 /14g, $63/$44.10 /3.5g, $60/$42 /1oz)  (CORE)
- Files: `src/components/menu/ProductCardPriceSelector.tsx` (PriceLine), and the discount source `src/lib/specials/daily-deals.ts` / `ProductCard.tsx` / `RelatedProductCard.tsx`.
- Symptom: cards show ONLY the discounted (orange) price; the struck "before" regular price is missing on desktop (all card surfaces) AND mobile home/specials.
- Root cause: on weight/qty/spend/storewide deal days (Fri/Tue/Wed/Sat) `getActiveMenuDiscount` returns `perItemSalePrice:false` → `salePriceMinorUnits = regular` → PriceLine `hasSalePrice=false` → no strike shown.
- DECISION (pro call): cards SHOULD show a struck regular price + the best-case (headline) discounted price whenever a deal targets that item — this is the standard storefront pattern ("up to X% off" with best price shown). The CART remains authoritative for the exact charged amount. So compute a headline per-item sale price for ALL deal types using the deal's top `discountPercent`, and let the card show struck+discounted.
  - Implement: a card-facing sale price (e.g. always set `salePriceMinorUnits = discountPrice(price, discountPercent)` for the card, OR add a separate `cardPreviewSalePriceMinorUnits`). Keep cart engine unchanged (it already recomputes accurately).
- PriceLine layout requirements (BOTH mobile + desktop):
  - Struck regular price to the LEFT of the discounted price, in the SAME box.
  - Reduce font sizes so BOTH values + unit fit for ALL price points (e.g. "$160.00" + "$112.00 /14g") without overflow/wrap.
  - Centered horizontally AND vertically in the box.
  - Mobile home/specials: same left-of layout, but text MUCH smaller to fit all price points.
- Verify: desktop shop/home/specials/PDP related cards + mobile home/specials all show struck regular (left) + discounted (right), centered, no overflow, all price points.

## 4. PDP product image height (cannabis + merch)  [x] DONE & VERIFIED (cannabis + merch PDP image fills column to "More from" boundary; no float on scroll; mobile untouched)
- File: `src/app/menu/products/[id]/page.tsx` (+ `ProductHeroArt` / image panel).
- Symptom: image panel is too SHORT; as you scroll the (sticky) image moves with you until it hits the "More from" section — looks like it floats. Image doesn't fill its column.
- Fix: increase the image panel HEIGHT so it fills the available area beside the purchase panel (taller min-height matching the right column), so the sticky image stays put / fills the area and doesn't visibly drift. Mobile PDP = DO NOT TOUCH.
- Applies to BOTH cannabis and merch PDP (same layout/component).
- Verify: desktop cannabis PDP + merch PDP — large image fills column; scrolling down doesn't show the image floating in empty space.

## 5. Merch PDP "More from" uses cannabis cards instead of merch cards  [x] DONE & VERIFIED (renders MerchProductCard with price range + color swatches, NO THC/CBD)
- Files: `src/app/menu/products/[id]/page.tsx` (related section) + `RelatedProductCard.tsx` / merch card component (`src/components/merch/*` or MerchCard in InteractiveMenuBrowser).
- Symptom (screenshot): merch PDP "More from Greenway" renders generic cannabis cards (THC:—/CBD:— boxes, purple "G" gradient art) instead of the proper MERCH cards (price range, colors, no THC/CBD).
- Fix: when the current product is merch, render the MERCH card component for related items (merch siblings), not the cannabis `ProductCardVisual`. Mirror the merch card used on the shop page (price range "$X–$Y", color count, no THC/CBD, merch art/photo).
- Verify: merch PDP "More from" shows real merch cards; cannabis PDP related unchanged (cannabis cards).

## Finalize  [x] DONE
- [x] `npx tsc --noEmit` clean (exit 0)
- [x] `npx eslint src` → 0 errors (exit 0)
- [x] clean `rm -rf .next && npm run build` OK (✓ Compiled, ✓ 2371/2371 static pages, ~55s)
- [x] Visual verify ALL 5 on desktop + mobile (browser cache cleared via CDP)
- [x] Scratch files live OUTSIDE repo at /workspace/_verify/ — none committed
- [x] Commit + push (PR #24). Confirm Vercel checks pass.
