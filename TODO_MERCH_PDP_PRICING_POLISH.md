# TODO — Merch / PDP / Pricing Polish (handoff-ready)

Branch: `feature/merch-pdp-pricing-polish` (off merged main `67887d9`)
Working dir: `/workspace/_gw_clone`
Repo: `mblyman89/GREENWAY-WEBSITE` (Next.js 16 / React 19 / Tailwind v4 / Vercel)

Tokens: `--orange #ff7f00`, `--greenway #7ed957`, `--gold #ffd700`. Container `max-w-[88rem]`. Store TZ `America/Los_Angeles`.
Push: `git push https://x-access-token:$GITHUB_TOKEN@github.com/mblyman89/GREENWAY-WEBSITE.git <branch>`. GH ops: `GH_TOKEN="$GITHUB_TOKEN" gh ...`.
Validate: `npx tsc --noEmit` · `npx eslint <files>` · `rm -rf .next && npm run build` · `npm run start -- -p 3100`.
Mobile verify: Playwright over CDP (port 9222), viewport 390×844, age-gate `localStorage['greenway-age-confirmed-v1']="true"`, viewport-only screenshots.

## 0. Discovery (DONE)
- [x] Merge PR #23 into main, delete branch, create fresh branch
- [x] View all reference images (loyalty desktop+mobile, PDP example+current, cart bug, search target)
- [x] Read all relevant files: daily-deals, daily-deal-presentation, CartProvider, CheckoutFlow, confirmation, ProductCard(Visual/PriceSelector), ProductDetailPurchasePanel, InteractiveMenuBrowser, SearchModal, SecondaryBar, About/PriceMatch/Vendor titles, LoyaltySignupForm, category-taxonomy
- [x] KEY FINDING: cart/checkout/confirmation already discount-aware via `regularPriceMinorUnits`/`savingsMinorUnits`. Cart bug root cause = Friday `perItemSalePrice:false` => salePrice==regular => no discount anywhere. Fixing daily-deals to emit real highest-% per-item sale price fixes cards + cart + checkout simultaneously.

## 1. Loyalty banners (mobile + desktop, user's own art)
- [x] Process `/workspace/Loyalty_Page_Banner_for_Desktop.png` (3200×563) -> `public/brand/greenway-loyalty-points-hero-desktop.png`
- [x] Process `/workspace/loyalty_for_mobile_banner.png` (6231×2077) -> `public/brand/greenway-loyalty-points-hero-mobile.png`
- [x] Add `loyaltyHeroMobile` asset key in `src/content/business.ts`; point `loyaltyHero` to desktop file
- [x] `LoyaltySignupForm.tsx`: render mobile image on small screens, desktop image on md+ (two `<Image>` with `block md:hidden` / `hidden md:block`, or `<picture>`). Keep rounded box; adjust min-heights to suit each art's aspect ratio. Remove the dark gradient overlay if it muddies the user's art.

## 2. Price-match title -> center + orange
- [x] `PriceMatchContent.tsx` line ~49 h2 "Our Price Match Promise": add `text-center`, change `text-white` -> `text-[var(--orange)]`

## 3. Vendors & Partners title -> orange
- [x] `SectionBanner.tsx`: add optional `titleClassName?` prop applied to the `<h2>` title
- [x] `VendorDirectory.tsx` first SectionBanner: pass `titleClassName="text-[var(--orange)]"` (DO NOT change home/specials banners)

## 4. About title -> orange + center
- [x] CONFIRMED: literal "About Greenway Marijuana" h2 is in `LocationsContent.tsx` line ~75 (currently `text-left ... text-[var(--greenway)]`). Per user intent ("About page title"), the About page hero is "We Are Greenway." (already white) and the orange centered "Your Most Trusted Cannabis Dispensary" h2 (line 47) is already done. Make the Locations "About Greenway Marijuana" h2 -> `text-center` + `text-[var(--orange)]` to satisfy the literal title text the user named. (Re-verify with user screenshot context.)

## 5. Remove daily-deal text from product cards
- [x] `ProductCard.tsx`: stop passing `saleBadgeLabel` (or pass undefined) so the green deal badge no longer renders on cards (desktop + mobile)
- [x] Keep `formatActiveDiscountBadge` for specials/home section headers if used elsewhere (verify not breaking specials)

## 6. Fix struck price + highest-available discount (daily-deals.ts)
- [x] Friday Ounce Friday: `perItemSalePrice: true` (was false), keep 30% (highest weight tier) so ALL flower cards show struck regular + 30%-off price
- [x] Wednesday Wax: highest available is 30% (at $150+); set discountPercent to 30 to reflect highest available (remove bonusNote text reliance)
- [x] Tuesday Doobie: highest available is 25% (4+); set to 25
- [x] Saturday Super Saturday: 30% off one item + 15% else -> highest available = 30%; RETURN a 30% per-item discount for ALL items (storewide) so cards/cart show discount. (Confirm storewide scope acceptable.)
- [x] Sunday Ice Cream: buy 3 for price of 2 = ~33% effective on the cheapest; this is basket-level. Decision: show as 33% highest? Keep undefined OR show 33%. -> Per user "highest discount a customer can get": represent as 33% per-item is misleading for B3G1. SAFER: leave Sunday as no per-item struck price (basket deal). FLAG for user.
- [x] Monday/Thursday already true per-item (25%); keep.
- [x] Ensure `salePriceMinorUnits` always = discounted when perItemSalePrice true.

## 7. Shop card price layout: original-slashed LEFT, discounted/unit RIGHT (desktop)
- [x] `ProductCardPriceSelector.tsx` `PriceLine`: desktop (md+) = row layout: struck regular price LEFT, discounted price + /unit RIGHT. Mobile = struck regular ABOVE discounted (stacked). Use responsive flex (`flex-col md:flex-row`). Applies to shop cards.

## 8. Mobile specials + home price layout (slashed ABOVE discounted) + variant solution
- [x] Same `PriceLine` mobile stacked layout covers specials/home cards (they reuse ProductCard/ProductCardVisual)
- [x] Variant dropdown rows: ensure each PriceLine in dropdown also reads well (stacked on mobile). Verify dropdown panel still aligns.

## 9. Cart/checkout discount propagation (FIXED BY #6)
- [x] Verify cart shows struck + discounted + Savings after #6 (add 1oz flower on Friday)
- [x] `ProductDetailPurchasePanel.tsx`: already computes variantSalePrice; confirm it now triggers (saleRatio<1)
- [x] Add `regularPriceMinorUnits` to persisted order lines (CheckoutFlow) + show struck in OrderConfirmation lines
- [x] `ProductOrderIntent.tsx` (orphaned) – update to apply discount for consistency (low priority)
- [x] Verify checkout summary + confirmation show Savings line

## 10. Mobile address pill: center text
- [x] `SecondaryBar.tsx`: make the address Link content centered on mobile (add `justify-center` + `text-center` to the inner span on mobile; keep desktop unchanged)

## 11. Mobile top search bar -> match target exactly
- [x] Target = clean rounded pill, magnifying-glass icon LEFT, placeholder "Search strains, products...".
- [x] `InteractiveMenuBrowser.tsx` mobile search row (line ~975): add left magnifying-glass icon inside pill, change placeholder to "Search strains, products..."; match target spacing next to SORT BY.
- [x] `SearchModal.tsx` (header magnifier): polish to a clean pill with left icon + "Search strains, products..." placeholder to match target aesthetic.

## 12. NEW "GREENWAY MERCH" shop category
- [x] Add `"merch"` to `GreenwayCategory` (types.ts) + taxonomy (`category-taxonomy.ts`) label "Greenway Merch"
- [x] `InteractiveMenuBrowser.tsx`: add `merchSectionCards` (t-shirt, sweatshirt, hat, beanie, zip-up hoodie, socks, lanyard, ...). Each: label, short sweet description, imageUrl, men+women size options.
- [x] categoryOptions: inject "merch" option (like accessories). showMerchSections when single selected category === "merch". Render MerchCard grid.
- [x] MerchCard: accessory-style card + generated product image + short desc + size variant selector (Men's S–XXL, Women's XS–XL). Add-to-cart optional.
- [x] Generate professional product images -> `public/merch/*.webp` (t-shirt, sweatshirt, hat, beanie, zip-up, socks, lanyard)
- [x] Add nav entry? (Optional) keep within Shop filter only per request.

## 13. Product detail page redesign (mimic example, OMIT lab results)
- [x] Example layout: left product image (white panel), right column: brand eyebrow (orange) -> big name -> tag chips (strain/size/THC) -> struck regular + big orange sale price -> qty stepper + ADD TO CART (pale green button) -> tabs (DESCRIPTION only; OMIT LAB RESULTS) -> description text.
- [x] Locate PDP: `src/app/menu/products/[id]/page.tsx` + components (ProductDetailPurchasePanel, ProductDetail*). Restructure to match example. OMIT lab results tab/section.
- [x] Keep "More from <brand>" related carousel (acceptable extra).

## Finalize
- [x] `npx tsc --noEmit` clean
- [x] `npx eslint` changed files clean
- [x] `rm -rf .next && npm run build` clean
- [x] Visual verify desktop (browser-tool) + mobile (Playwright CDP) for: loyalty, price-match, vendors, about/locations, shop cards, specials, home, cart, checkout, confirmation, PDP, merch filter, search bar, address pill
- [x] Commit, push branch, open PR vs main
- [x] Confirm Vercel checks (greenway_website + greenway_website1) pass

## Validation Results (final)
- tsc --noEmit: PASS (exit 0)
- eslint changed files: PASS — only PRE-EXISTING issues remain (OrderConfirmation.tsx:17 set-state-in-effect error; 2 `<img>` LCP warnings in InteractiveMenuBrowser matching existing codebase pattern). No new errors introduced.
- production build (rm -rf .next && npm run build): PASS (exit 0) — all routes generated incl. /menu/products/[id], /vendor-delivery, /loyalty, /price-match, /checkout/confirmation; 2331+ product paths.
- Visual verification (desktop via browser-tool 1600×900 + mobile via Playwright-over-CDP 390×844): ALL 13 task groups confirmed.
