# TODO — Final Revision (handoff-ready)

Branch: `feature/merch-pdp-pricing-polish` (PR #24 still OPEN — stack onto it)
Working dir: `/workspace/_gw_clone`
Repo: `mblyman89/GREENWAY-WEBSITE` (Next.js 16 / React 19 / Tailwind v4 / Vercel)

Tokens: `--orange #ff7f00`, `--greenway #7ed957`, `--gold #ffd700`. Wide container = `max-w-[88rem]`. Store TZ `America/Los_Angeles`.
Push: `git push https://x-access-token:$GITHUB_TOKEN@github.com/mblyman89/GREENWAY-WEBSITE.git feature/merch-pdp-pricing-polish`. GH: `GH_TOKEN="$GITHUB_TOKEN" gh ...`.
Validate: `npx tsc --noEmit` · `npx eslint <files>` · `rm -rf .next && npm run build`.
Today = check `TZ=America/Los_Angeles date`. Friday = Ounce Friday (weight-tiered).

## A. Code cleanup — eslint + useEffect hydration (whole site)
- [x] `CartProvider.tsx` line ~111: `react-hooks/set-state-in-effect` — hydrate via lazy `useState` initializer pattern OR guard so eslint passes. Refactor the localStorage hydration to not setState synchronously in effect (use `useState(() => readJson(...))` is SSR-unsafe; instead use the documented "useSyncExternalStore"-free pattern: keep effect but the rule flags it — convert to a ref-guarded one-time hydration that satisfies the rule, OR move read into a `useState` initializer guarded by `typeof window`). Goal: zero eslint errors.
- [x] `OrderConfirmation.tsx` line ~17: same rule — refactor `useEffect(()=>{setOrder(...)})` to a clean pattern (lazy init + hydrated flag without sync setState-in-effect, or use a small `useHydratedValue` helper).
- [x] Grep the whole `src/` for the same anti-pattern (`useEffect` that calls `setState` synchronously for hydration) and fix all of them.
- [x] Convert flagged `<img>` → `next/image` where reasonable (merch/accessory cards) OR keep but ensure no NEW warnings; aim for clean lint. (Decide: merch/accessory product imgs → can stay `<img>` if eslint disabled inline w/ justification, but prefer `next/image` for cleanliness.)
- [x] Final: `npx eslint src` returns 0 errors (warnings acceptable only if truly unavoidable & pre-existing pattern).

## B. SMART CART — accurate daily-deal discounts (CORE)
Rules per day (highest reachable tier based on cart contents):
- **Friday Ounce Friday** (flower/popcorn/infused-flower/trim): WEIGHT-tiered by total eligible grams.
  - quarter oz (7g) → 15%; half oz (14g) → 20%; full oz (28g) → 30%. Below 7g eligible = NO discount.
  - 3.5g bag = 3.5g. So 2×3.5g = 7g → 15%; 4×3.5g = 14g → 20%; 8×3.5g = 28g → 30%. A single 3.5g or 1g = no discount.
  - Sum grams across ALL eligible flower lines in cart; apply the tier % to those eligible lines.
- **Tuesday Doobie** (preroll family): qty-tiered — 2+ →15%, 4+ →25% (single = none). Confirm tiers; use 4+ = 25% as highest.
- **Wednesday Wax** (concentrate/cart/vape/rso): spend-threshold — show per-item only at threshold; simplest faithful model = qty/spend tier. Use: $150+ eligible spend → 30%, else lower/none. Implement a sensible tier (e.g. 1 item base 15%, 4+ or $150+ → 30%). Keep accurate-not-inflated.
- **Monday Munchie** (edibles/rso/drinks/tincture): per-item 25% (flat) — keep simple per-item.
- **Thursday Top Shelf** (featured brands): per-item 25% on featured brands only.
- **Saturday Super Saturday**: 30% off ONE item + 15% off everything else (storewide). Cart picks the single most-expensive eligible item @30%, rest @15%.
- **Sunday Ice Cream**: buy 3 for price of 2 (cheapest free) per group of 3. Basket-level.
- [x] Create `src/lib/specials/cart-discount.ts`: pure functions. Input = cart lines (category, variantLabel→grams, unit regular price, qty) + weekday. Output = per-line discounted price + total savings + per-line applied label. Include `gramsForLabel(label)` parser (`3.5g`,`7g`,`14g`,`1oz`=28,`1g`,`1.5g`, etc).
- [x] Cart lines must store `regularPriceMinorUnits` as the TRUE regular price (not pre-discounted) + enough metadata (category, variantLabel) to recompute. UPDATE add-to-cart sources to pass regular price + category + variantLabel.
- [x] `CartProvider`: compute discounts at cart level via cart-discount engine (memoized over items + weekday). Derive each line's effective price; totals/savings from engine. Remove reliance on pre-baked `priceMinorUnits` discount.
- [x] `ProductDetailPurchasePanel` + cards: keep showing the day's *best-case* struck preview, but the AUTHORITATIVE discount is the cart engine. (Cards can still show "up to 30%" struck preview for Friday; acceptable since cart is the source of truth. Decide: keep card struck preview as "best case".)
- [x] CheckoutFlow + OrderConfirmation: read engine results (line regular vs discounted, savings). Verify single 3.5g flower on Friday → NO discount; 2×3.5g → 15%; 8×3.5g → 30%.
- [x] Update `daily-deals.ts` card preview to reflect "highest *possible*" but mark weight/qty deals as preview-only so cards don't imply a single bag is discounted (the card may show regular price w/ a "Ounce Friday — up to 30% off by the ounce" note instead of a fake struck price for flower). DECIDE & document.

## A/B STATUS: DONE — hydration helper added (useHydratedValue), CartProvider + OrderConfirmation refactored, smart cart engine (cart-discount.ts) wired through cart/checkout/confirmation, tiers verified (1×3.5g=0%, 2×=15%, 4×=20%, 8×=30%). tsc clean.
## A FULL SWEEP: DONE — useHydratedValue ref-during-render fixed (ref assignment moved into effect); AccessoryCard <img> eslint-disabled to match MerchCard. `npx eslint src` → 0 errors, 0 warnings. tsc clean.

## C. Mobile top-header search bar height  ✅ DONE (VERIFIED)
- [x] `SearchModal.tsx`: the open panel (`fixed inset-x-0 top-0 ... py-4`) is cut off on mobile so the input isn't fully visible. Increase top padding / ensure the input sits below the sticky header safe area (add `pt-[max(1rem,env(safe-area-inset-top))]` and more bottom padding; bump panel min-height so the whole pill shows). DESKTOP header search = DO NOT TOUCH (it's great). Only adjust mobile rendering.

## D. Add "Greenway Merch" to nav menus + reorder desktop hamburger  ✅ DONE (VERIFIED)
- [x] `navigation-data.ts`: add Merch to Shop dropdown children → `{ label: "Greenway Merch", href: "/menu?category=merch", helper: "..." }` (place after Accessories).
- [x] `MobileNavigation.tsx` `shopCategoryItems`: add `{ label: "Greenway Merch", href: "/menu?category=merch" }`.
- [x] `MobileNavigation.tsx` DESKTOP hamburger panel: (1) add Greenway Merch to "Shop by Category" list; (2) MOVE the "Specials" section to ABOVE the "Location" section (currently Specials is top-left col, Location is middle col top). Reorder so order reads: Specials, then Location below it (move Specials down into the flow / Location down to make room), and move Shop categories up. Net effect requested: Specials above Location; Shop categories higher; Merch added. Re-lay the 3-col grid sensibly.
- [x] Desktop top-tab Shop dropdown (NavLink) automatically gets Merch from navigation-data.
- [x] Merch link → `/menu?category=merch` (loads shop w/ merch filter active → scrolls/shows merch section).

## E. Shop page: merch + accessories included in mixed/unfiltered lists  ✅ DONE (VERIFIED)
- [x] `InteractiveMenuBrowser.tsx`: currently merch/accessories only render as standalone sections when EXACTLY ONE of those is selected; multi-select → "No products match".
- [x] New behavior:
  - If merch and/or accessories selected ALONE → keep dedicated section grid (existing).
  - If selected WITH other categories → render their cards appended at the BOTTOM of the product grid (accessories group, then merch group), each as a labeled section.
  - If NO filter at all → also append accessories + merch sections at the very BOTTOM, grouped, after all cannabis groups.
  - Multi-select including merch/accessories must NOT show "No products match" when cannabis items also match.
- [x] Make accessory/merch cards participate in `filteredItems.length` logic so the empty state only shows when truly nothing matches.

## F. Merch checkout feature (price ranges, colors, sizes, PDP, add-to-cart)  ✅ DONE (VERIFIED end-to-end)
- [x] Research average retail prices for dispensary-style merch (tee, pullover hoodie, zip hoodie, dad hat, beanie, crew socks, lanyard) across sizes/genders. Build a price table (base price + any size upcharge e.g. 2XL +$2). Store as data.
- [x] Add to each merch card: PRICE RANGE display ("$X–$Y" spanning all options) + COLOR options (e.g. Black, Forest Green, Heather Gray, etc per item).
- [x] Create merch product detail pages mirroring cannabis PDP layout (NO THC/CBD, NO strain type). Selectors: Size, Color, Gender (Men's/Women's where applicable). Add-to-cart → cart → checkout → confirmation.
- [x] Implement as synthetic menu items (so existing cart/checkout works) OR a dedicated `/merch/[key]` route. PREFER: generate `GreenwayMenuItem`-shaped merch items (category "merch") with variants = size/color/gender combos so the WHOLE existing pipeline (PDP, cart, checkout, confirmation) just works. Wire `getMenuItemById` to resolve merch ids.
- [x] Merch cards link to their PDP. Merch PDP "More from" = other merch.
- [x] Merch is non-cannabis: no daily-deal discount applies (ensure cart engine skips merch/accessories).

## G. Cannabis product card price box — center vertically + horizontally  ✅ DONE
- [x] `ProductCardPriceSelector.tsx`: button is now `relative grid place-items-center` (full-width PriceLine), chevron is `absolute inset-y-0 right-0` overlay — so price content is dead-center on BOTH axes (no longer pushed left by the reserved chevron column).

## H. Desktop side-cart address pill spacing  ✅ DONE
- [x] `CartProvider.tsx` `StoreCard`: desktop padding changed `sm:px-4` → `sm:pl-4 sm:pr-10`, nudging the address/hours/phone left so they sit comfortably inside the banner. Mobile (`px-3`) unchanged.

## I. Desktop PDP wider + bigger image  ✅ DONE (VERIFIED)
- [x] `app/menu/products/[id]/page.tsx`: desktop container `md:max-w-5xl` → widen to site-wide `md:max-w-[88rem]` (match home/shop). Keep mobile `max-w-[430px]`.
- [x] Increase product image size on desktop substantially (target = HUGE like reference). Adjust grid cols (e.g. `md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]`) and `ProductHeroArt` min-height so the image panel is large. Mobile PDP = DO NOT TOUCH.

## Finalize
- [x] `npx tsc --noEmit` clean
- [x] `npx eslint src` → 0 errors
- [x] `rm -rf .next && npm run build` clean
- [x] Visual verify desktop (browser-tool) + mobile (Playwright CDP): search bar height, nav menus (3 places) w/ merch, shop mixed/unfiltered merch+accessories at bottom, merch price ranges+colors, merch PDP + add-to-cart + checkout + confirmation, cannabis card centered price, cart address spacing, wide desktop PDP huge image, AND smart-cart discount cases (single 3.5g = none, 2×3.5g = 15%, 8×3.5g = 30%).
- [x] Clean up scratch files (screenshots, helper .py). Do NOT commit them.
- [ ] Commit + push branch (PR #24 updates). Confirm Vercel checks pass.
