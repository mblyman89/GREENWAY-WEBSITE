# Greenway Website — Enhancement Sprint (Handoff-Ready TODO)

Branch: `feature/tax-loyalty-shop-seo-polish` (off `main` AFTER PR #21 merge — DONE)

This is the authoritative, handoff-ready checklist. Each task lists the exact file(s)
and concrete completion criteria so any agent can resume mid-sprint.

LEGEND: [ ] todo · [~] in progress · [x] done

---

## PHASE 0 — Branch setup
- [x] Merge PR #21 → main (squash). Verified MERGED.
- [x] Update local main, create branch `feature/tax-loyalty-shop-seo-polish`.
- [x] Read all reference images (loyalty_page, my_shop_page, my_logo_and_text_too_small,
      make_phone_number_bigger_on_desktop_version, mobile banner) + key component files.
- [x] Write this handoff TODO.

## PHASE 1 — Tax / pricing logic (CRITICAL: card price = tax-INCLUSIVE out-the-door)
File: `src/components/cart/CartProvider.tsx` (also surfaces in CheckoutFlow + OrderConfirmation via shared totals).
Model: card `priceMinorUnits` is the FINAL out-the-door price (incl 37% WSLCB excise + 9.3% local = 46.3%).
- [x] Replace `ESTIMATED_SALES_TAX_RATE = 0.09` with combined inclusive rate constant `COMBINED_TAX_RATE = 0.463` (and document excise 0.37 + local 0.093).
- [x] Compute: `totalMinorUnits = sum(priceMinorUnits*qty)` (= card prices, what customer pays out-the-door).
- [x] Compute pre-tax: `subtotalMinorUnits = round(total / 1.463)`.
- [x] Compute tax: `estimatedTaxMinorUnits = total - subtotal` (so subtotal + tax === total exactly, no rounding drift).
- [x] `savingsMinorUnits` still = regular − sale (computed on inclusive card prices, unchanged behavior).
- [x] Keep `regularSubtotalMinorUnits` for line-item strikethrough (those are inclusive prices, fine).
- [x] Verify cart drawer summary: Subtotal < card total, Taxes (Est.), Total === sum of card prices.
- [x] Verify CheckoutFlow + OrderConfirmation reflect same (they consume shared totals).
- [x] Update comment block at top of file to describe the inclusive 46.3% model.
- [x] Do NOT change user-facing label text wording beyond what's required (keep "Subtotal", "Taxes (Est.)", "Total").

## PHASE 2 — Loyalty hero (DESKTOP only changes; mobile hero untouched, mobile logo dead space slight tighten)
File: `src/components/loyalty/LoyaltySignupPreview.tsx`
- [x] Make DESKTOP hero banner taller to consume dead space (increase `md:min-h-[10.5rem]` → larger, e.g. `md:min-h-[13rem] lg:min-h-[15rem]`). Keep mobile `min-h-[8.5rem]`.
- [x] Fix hero photo positioning (object-position) so the artwork sits correctly — adjust `object-center` if needed for desktop.
- [x] Reduce dead space around the gold emblem logo: tighten the card top padding / logo top margin on DESKTOP significantly; MOBILE tighten slightly (less aggressive).
- [x] Confirm mobile loyalty hero visual is essentially unchanged.

## PHASE 3 — Desktop nav dropdown stays open when dragging mouse down (Shop + Specials)
File: `src/components/site/NavLink.tsx`
- [x] Remove the hover gap: dropdown has `mt-2` (8px) gap that breaks hover. Replace with a transparent hover-bridge (e.g. `pt-2` wrapper / `top-full` with no margin, or an invisible padding element spanning the gap) so moving the cursor from trigger to menu keeps `group-hover` active.
- [x] Verify both Shop and Specials dropdowns stay open while dragging to a child link and clicking it.

## PHASE 4 — Shop page DESKTOP (ref my_shop_page.png)
Files: `src/app/menu/page.tsx`, `src/components/menu/InteractiveMenuBrowser.tsx`, `src/components/menu/SortDropdown.tsx`, `src/components/menu/FilterMobile.tsx` (MenuFilterControls)
- [x] Breadcrumb ABOVE the top hero (move `<Breadcrumbs>` before the hero `<section>` in page.tsx). Same for mobile (single change covers both).
- [x] SortDropdown button label: always show "SORT BY" (remove the "Sort by" eyebrow label above). Dropdown option still reads "Featured Shuffle" and still functions.
- [x] No text label above the sort control; sort button + search bar perfectly inline, side by side.
- [x] Category title (group.label) on the SAME line as search + sort (left = category title, right = search + sort).
- [x] Move product cards UP so the top of the first card row is flush with the top of the filters box (remove the extra stacked rows that push cards down).
- [x] Specials filter section: same visual style as other FilterSections (convert 50% Off / Daily Deals pill buttons to match the checkbox-row look used by Categories/Brands, OR unify). Desktop + mobile.

## PHASE 5 — Shop page MOBILE
Same files.
- [x] Search bar + sort button share one line side by side on mobile.
- [x] Content moves up the page (reduce top padding).
- [x] Sort says "SORT BY".
- [x] Specials filter unified style (shared with Phase 4).

## PHASE 6 — Desktop cart drawer banner: bigger logo + text (mobile untouched)
File: `src/components/cart/CartProvider.tsx` (StoreCard)
- [x] The `sm:` variants SHRINK on desktop (`sm:w-[5.1rem]`, `sm:text-[0.55rem]`). Enlarge desktop logo width + text so it's clearly readable. Keep mobile sizes (`text-[0.66rem]/0.7rem`, `w-[6rem]`) unchanged.
- [x] Increase StoreCard height on desktop if needed so enlarged content fits.

## PHASE 7 — Green banner (SecondaryBar)
File: `src/components/site/SecondaryBar.tsx`
- [x] DESKTOP: make the phone number BIGGER (increase `md:text-[1rem]` → larger, e.g. `md:text-[1.15rem] lg:text-[1.2rem]`; bump pill height/padding to match).
- [x] MOBILE: location pill slightly LESS wide (reduce `minmax(0,36vw)` first grid col), so phone can shift left; phone number MUCH bigger on mobile (raise the `clamp` min/max on the phone font size noticeably). Keep hours centered + legible.
- [x] Verify no overlap/overflow at 360px, 390px, 768px widths.

## PHASE 8 — SITE_REVIEW execution: cleanup + dev-route removal + Preview renames + EXPERT SEO (NO graphics, NO text changes)
### 8a. Dev route removal
- [ ] Remove dev routes `/menu/mock-preview` and `/menu/pos-preview` (delete dirs `src/app/menu/mock-preview`, `src/app/menu/pos-preview`). Confirm nothing imports them.
- [ ] Ensure sitemap/robots don't reference them (they don't currently).
### 8b. `*Preview` component renames (leftover dev naming)
- [ ] Rename components to production names + update imports/usages: `LoyaltySignupPreview`→`LoyaltySignupForm`, `SpecialsPreview`→`SpecialsContent`, `FaqPreview`→`FaqContent`, `PriceMatchPreview`→`PriceMatchContent`, `LocationsPreview`→`LocationsContent`, `PolicyPreview`→`PolicyContent`, `AboutPreview`→`AboutContent`, `BlogPreview`→`BlogContent`, `MenuPreview`→`MenuHighlights` (home). Verify each rename compiles. (Keep behavior identical; pure rename.)
- [ ] NOTE: Be conservative — only rename what's clearly a dev `*Preview` leftover; verify no breakage. Skip any that risk regressions and note them.
### 8c. EXPERT SEO (do an outstanding job)
- [ ] Per-page unique `metadata` (title + description + canonical + openGraph + twitter) for: home, /menu, /specials, /about, /locations, /loyalty, /blog, /faq, /price-match, /privacy-policy, /terms-of-use, /consumer-health-data, /vendor-delivery.
- [ ] Per-product dynamic `generateMetadata` on `/menu/products/[id]` (title, desc, canonical, OG, product image fallback).
- [ ] JSON-LD structured data:
  - [ ] `Store`/`CannabisStore`+`LocalBusiness` on home/locations (name, address, geo 47.5046,-122.6384, phone, hours openingHoursSpecification, sameAs socials, url, image).
  - [ ] `Product` + `Offer` JSON-LD on product pages (name, brand, price, availability, priceCurrency USD).
  - [ ] `BreadcrumbList` JSON-LD (reusable component) on key pages.
  - [ ] `FAQPage` JSON-LD on /faq.
  - [ ] `Organization` + `WebSite` (with potentialAction SearchAction) site-wide in layout.
- [ ] OpenGraph + Twitter card defaults in root layout metadata (siteName, type, locale, default OG image if a brand asset already exists — do NOT create new graphics; reuse existing wordmark/og asset if present, else omit image).
- [ ] Canonical URLs via `alternates.canonical` per page.
- [ ] Fix sitemap to use the SAME product set as the live menu (`posMenuPreviewItems`) instead of `mockMenuItems`; keep dev routes excluded; add /loyalty, /vendor-delivery, /price-match if indexable.
- [ ] robots.ts: keep /checkout disallowed; add /admin disallow; confirm sitemap reference.
- [ ] Add `metadataBase` already present — confirm canonical resolves.
- [ ] Add a small reusable `<JsonLd>` component (`src/components/seo/JsonLd.tsx`) using `<script type="application/ld+json">`.
- [ ] Add web manifest / icons only if trivially present; otherwise skip (no new graphics).
### 8d. A11y polish (no text/graphics)
- [ ] Ensure interactive controls have focus-visible rings; alt text present on images (most already have).
- [ ] Verify dropdown / drawer keyboard accessibility not regressed.

## PHASE 9 — Verify + ship
- [ ] `npx tsc --noEmit` clean.
- [ ] `npx eslint` on changed files clean.
- [ ] `npm run build` succeeds.
- [ ] Local prod server on :3100; browser-verify DESKTOP + MOBILE for every phase (cart math, loyalty hero, nav dropdown, shop layout, cart banner, green banner, SEO head tags via view-source / extract).
- [ ] Commit, push branch, open PR. Report PR URL + summary.
