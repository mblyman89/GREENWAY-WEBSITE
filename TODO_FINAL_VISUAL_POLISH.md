# Final Visual Polish — Handoff (branch: `feature/final-visual-polish`)

Batch of cosmetic/visual fixes (tasks A–O). All items implemented, validated, and **visually verified** on
both **mobile (390×844, iPhone emulation via Playwright/CDP)** and **desktop (1024+)** against a clean production build.

## Validation summary (final, clean build)
- `npx tsc --noEmit` → **EXIT 0**
- `npx eslint <17 modified files>` → **0 errors** (1 pre-existing `<img>` warning in `AccessoryCard`, unrelated to this batch)
- `rm -rf .next && npm run build` → **EXIT 0** (all 2331+ product pages prerendered)

---

## Tasks

- [x] **A. Home hero carousel** — `src/components/home/Hero.tsx` rebuilt as a `"use client"` 3-slide
  carousel (autoplay 6s, pause-on-hover, prev/next arrows, dot indicators).
  - Slide 1: "PREMIUM CANNABIS, EVERYDAY DEALS" (left-aligned, original look) — `/home/hero-banner.webp`
  - Slide 2: "A NEW DAILY DEAL, EVERY DAY" / eyebrow "DEAL OF THE DAY" (right-aligned) — `/home/hero-dailydeal.webp`
  - Slide 3: "GREENWAY SUMMER CAR SHOW" / eyebrow "SPECIAL EVENT · JULY 25, 2026" — `/home/hero-carshow.webp`
  - **Fix note:** the `relative`/`absolute` Tailwind source-order bug (all slides stacked vertically) was
    resolved by keeping `relative` OUT of the base class and applying it only to the active branch.
  - Verified: desktop slides 1/2/3 + mobile slides 1/2/3, all show 3 dots.

- [x] **B. Top banner search bar** — `src/components/site/SearchModal.tsx`. Desktop full-width dark top bar
  (`fixed inset-x-0 top-0 bg-[#111]`), "SEARCH PRODUCTS" left (`whitespace-nowrap`), X right, dark input
  (`bg-[#1a1a1a] text-white`, `autoFocus`). Mobile typeable + title one line.

- [x] **C. Mobile address pill** — `src/components/site/SecondaryBar.tsx`. First grid column widened to
  `minmax(0,34vw)`; full address ("…WA 98367") no longer cut off.

- [x] **D. Store hours sizing** — `src/components/site/SecondaryBar.tsx`.
  - Desktop: one line, bigger (`hours.short`, `md:text-[0.82rem] lg:text-[0.88rem]`).
  - Mobile: stacked — "8AM-11PM" TOP (`dailyShort`) / "MON-SUN" BOTTOM, as large as possible.

- [x] **E. Shop page mobile sort/search** — `src/components/menu/InteractiveMenuBrowser.tsx`. Mobile-only
  search + SORT BY row moved ABOVE the "FILTERS & CATEGORIES" dropdown; desktop toolbar unchanged.

- [x] **F. Specials filter style** — `src/components/menu/FilterMobile.tsx`. "50% Off" / "Daily Deals" now
  use the same styled checkbox-row treatment (`peer sr-only` + `peer-checked:bg-[var(--orange)]`) as the
  other filter sections (no more white background). Verified desktop checked & unchecked.

- [x] **G. Vendor cards (mobile)** — `src/components/vendors/VendorDirectory.tsx`. Vendor NAME at TOP for both
  viewports; no text overlay on mobile; no "tap to learn more" / "Tap to close" text; expanded description
  overlay is desktop-only. `mobileNameSizeClass()` auto-shrinks long names to fit ONE line.
  **Verified: ZERO name overflows** across all vendor cards (every name `scrollWidth == clientWidth`),
  including 28-char "NORTHWEST CANNABIS SOLUTIONS".

- [x] **H. Vendor email** — `src/components/vendors/VendorDirectory.tsx`. `mailto` body is BLANK
  (`EMAIL_BODY = ""`; `&body=` omitted entirely).

- [x] **I. Newsletter/Blog page (mobile)** — `src/components/blog/BlogContent.tsx`. Title split so
  "STORIES | CULTURE" is line 1 and "Newsletters" drops to line 2 (`mt-2 block`) — the "|" no longer bleeds.

- [x] **J. Daily specials logic (CRITICAL)** — `src/lib/specials/daily-deals.ts`. Added
  `perItemSalePrice` flag. Per-item sale prices only render when genuinely per-item (Mon–Thu). Friday
  ("Ounce Friday") is weight-based → info-only badge, NO fake struck price. Saturday & Sunday return
  `undefined` (storewide/basket deals, not per-item). `formatActiveDiscountBadge` shows
  `${label} · ${bonusNote}` only when `!perItemSalePrice`. Verified on cards (Friday: info-only badge).

- [x] **K. Product card price layout** — `src/components/menu/ProductCardPriceSelector.tsx`. `PriceLine` is
  `flex-col`: struck regular "before" price on TOP (`mb-0.5 ... line-through`), discounted price-per-unit
  on BOTTOM (`flex items-baseline`). Renders only when `hasSalePrice` (genuine per-item sale).

- [x] **L. Desktop loyalty hero image** — `public/brand/greenway-loyalty-points-hero.png` regenerated
  (gold leaf left of centered "GREENWAY LOYALTY POINTS", generous margins, 3.2:1 ≈ 1408×440) so it fits
  perfectly on desktop AND survives `object-cover` on narrow mobile. `LoyaltySignupForm.tsx` uses plain
  `object-cover object-center`. Verified: full text visible, not clipped, on BOTH mobile and desktop.

- [x] **M. FAQ page (mobile)** — `src/components/faq/FaqContent.tsx`. Subtitle fits ONE line
  (`whitespace-nowrap text-[0.74rem] sm:text-sm md:text-base`).

- [x] **N. About page** — `src/components/about/AboutContent.tsx`. The orange section title
  ("YOUR MOST TRUSTED CANNABIS DISPENSARY") is now `text-center`.

- [x] **O. Phone numbers (site-wide)** — display "360-BUY-WEED" everywhere; `tel:` dials the real number
  **+1 360-443-6988**. `src/content/business.ts` phone object:
  `{ display: "360-BUY-WEED", numeric: "360-443-6988", formatted: "(360) 443-6988", tel: "+13604436988" }`.
  Applied across `SecondaryBar.tsx`, `Footer.tsx`, `LocationsContent.tsx`, `location-preview-data.ts`.

---

## Files changed (17)
```
public/brand/greenway-loyalty-points-hero.png   (regenerated, task L)
public/home/hero-dailydeal.webp                 (new, task A)
public/home/hero-carshow.webp                   (new, task A)
src/components/about/AboutContent.tsx           (N)
src/components/blog/BlogContent.tsx             (I)
src/components/faq/FaqContent.tsx               (M)
src/components/home/Hero.tsx                    (A)
src/components/location/LocationsContent.tsx    (O)
src/components/location/location-preview-data.ts(O)
src/components/loyalty/LoyaltySignupForm.tsx    (L)
src/components/menu/FilterMobile.tsx            (F)
src/components/menu/InteractiveMenuBrowser.tsx  (E)
src/components/menu/ProductCardPriceSelector.tsx(K)
src/components/site/Footer.tsx                  (O)
src/components/site/SearchModal.tsx             (B)
src/components/site/SecondaryBar.tsx            (C, D, O)
src/components/vendors/VendorDirectory.tsx      (G, H)
src/content/business.ts                         (O)
src/lib/specials/daily-deals.ts                 (J)
```
