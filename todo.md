# Refinements: Age Gate, Mobile Price, Shop Page, Specials Cards, Loyalty/Blog/FAQ

Branch: `feature/refinements-agegate-shop-specials` (off updated `main`, PR #19 merged).
Data: `posMenuPreviewItems` (~2325 items). Cursive wordmark: `/brand/greenway-marijuana-wordmark-transparent.png`.
Tokens: `--greenway #7ed957`, `--gold #ffd700`, `--orange #ff7f00`, `--charcoal #1a1a1a`, `--greenway-dark #12351f`.
Site container width standard: `max-w-[88rem]` (home/shop/specials).

## A. Age Gate — simplify & match target (Uncle Ike's style) ✅
File: `src/components/age-gate/AgeGate.tsx`
- [x] Clean centered card: cursive wordmark image top, "AGE VERIFICATION" orange, 2 text lines, one orange "YES, I AM 21+" button, small "NO, I AM UNDER 21" link, footer "PLEASE CONSUME RESPONSIBLY"
- [x] Remove the 3-col grid + 21+ circle + long disclaimer
- [x] Keep localStorage confirm logic intact

## B. Mobile price-per-unit text too big / cut off (mobile only) ✅
File: `src/components/menu/ProductCardPriceSelector.tsx`
- [x] Shrink mobile price/strikethrough/unit; keep md: desktop sizes unchanged

## C. Shop page — search/sort inline above cards, cards flush with filters top ✅
File: `src/components/menu/InteractiveMenuBrowser.tsx`
- [x] Remove boxed search/sort container + "Showing X of Y POS products" + "Filters use POS..." helper
- [x] Search + SORT BY inline, right-aligned, ABOVE cards, no box
- [x] Cards flush with TOP of filters box; group label sits ABOVE cards
- [x] Remove per-group "X items" + eyebrow helper; remove special/accessory helper text

## D. Shop filters — add "Specials" section at top ✅
Files: `FilterMobile.tsx` (MenuFilterControls) + InteractiveMenuBrowser
- [x] "Specials" section top of filters: "50% OFF" + "Daily Deals" toggle buttons
- [x] 50% OFF → clearance collection (empty state for now)
- [x] Daily Deals → current day's on-deal items (day engine)

## E. Thursday deal → brand-based (5 brands) ✅
File: `src/lib/specials/daily-deals.ts` (+ daily-deal-presentation.ts)
- [x] Thursday matches by BRAND list: Lifted, Phat Panda, Buddies, Clarity Farms, Constellation (export const)
- [x] Update Thursday menu lane href to brands filter; keep 25%

## F. Remove ALL helper text everywhere ✅ (shop/filters scope)
- [x] FilterSection helper usages + MenuFilterControls subtext
- [x] Shop group/accessory/special helper text; no counts/totals on shop

## G. Specials daily-deal cards → product-card palette ✅
File: `src/components/specials/SpecialsPreview.tsx`
- [x] Restyle cards to resemble ProductCardVisual (tone gradients, glow borders, charcoal, orange price); keep info

## H. Loyalty hero shorter + wider ✅
File: `src/components/loyalty/LoyaltySignupPreview.tsx`
- [x] max-w-[88rem]; reduce height so form is visible

## I. Blog newsletter badge + new title ✅
Files: `BlogCard.tsx`, `BlogPreview.tsx`
- [x] Newsletter card: add NEWSLETTER (gold) badge
- [x] Title "STORIES | CULTURE | NEWSLETTERS"; desktop 1 line, mobile 2 lines; keep subtitle

## J. FAQ title one line on desktop ✅
File: `src/components/faq/FaqPreview.tsx`
- [x] Widen title container so it fits one line desktop

## K. Verify + ship
- [x] tsc, eslint, build clean (build3 EXIT 0, 2366 pages; eslint clean except 1 pre-existing img warning)
- [x] Browser verify mobile+desktop for every touched page (desktop verified visually; mobile price fix verified at source/breakpoint level)
- [x] Commit + push + PR (Vercel auto-deploys) — PR #20: https://github.com/mblyman89/GREENWAY-WEBSITE/pull/20
