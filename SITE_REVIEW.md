# Greenway Marijuana — Full Website Review

**Repo:** `mblyman89/GREENWAY-WEBSITE` · **Branch reviewed:** `feature/checkout-vendors-overhaul` (PR #21)
**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · deployed on Vercel
**Scope:** Whole site — UX, visual design, content, compliance, performance, accessibility, SEO, code health, and conversion. Verified against a local production build (`npm run build` → 2,366 routes) and live browser walkthroughs (desktop 1599px).

---

## TLDR

Greenway is in genuinely good shape. The design language is strong and consistent — a confident dark theme with green/gold/orange accents, a reusable wide-and-short hero band (`SectionBanner`), and a clean card system shared across Home, Brands, and now the new Vendors page. The two pieces just overhauled — **checkout** and the **Vendors & Partners** page — are now the most polished parts of the site: the checkout finally behaves like a real store (collect customer info → place order → confirmation with an order number and receipt), and a successful order **decrements on-page inventory** exactly as requested, resetting on the next spreadsheet upload.

The biggest opportunities are not bugs, they're **finish-line items**: (1) several pages still carry internal *"Preview"* component names and a couple of dev-only routes (`/menu/mock-preview`, `/menu/pos-preview`) that should not ship publicly; (2) product cards render **gradient placeholders instead of real product photography**, which is the single largest visual and conversion gap; and (3) a handful of accessibility and SEO polish items (per-page metadata, focus states, alt text). None of these block launch, but cleaning them up would take the site from "very good" to "store-ready and trustworthy."

**Top 5 to do next:** real product images → remove/guard dev preview routes → per-page `<title>`/description metadata → loyalty/age-gate copy + a11y pass → wire the (already-stubbed) order alert/receipt to the third-party integration when ready.

---

## 1. What's working well

- **Cohesive visual system.** The charcoal/green/gold/orange palette is applied consistently. The `SectionBanner` (wide + short hero) and the aspect-ratio gradient cards give every page the same premium rhythm. The new Vendors page slots in seamlessly because it reuses both.
- **Checkout now feels real.** "Secure Checkout" collects First/Last name, email, phone (auto-formatted), and birthday (MM/DD/YYYY) with sane validation, a "Save Information" step, an order summary, and a single "Place Order" action. Confirmation shows a generated order number (`GWY-XXXXXX`), an itemized receipt, and a clear 21+/pickup/no-online-payment disclaimer.
- **Runtime inventory decrement works as specified.** Placing an order records the sale to a localStorage ledger keyed by `variantId`; the on-page count drops "as if one was sold," and a fresh transformer/spreadsheet upload resets it. This matches the stated plan precisely and needs no backend today.
- **Honest tax + compliance language.** Tax is shown as **"Taxes (Est.)"** (~9% Port Orchard) with "confirmed in store" wording rather than implying a live transaction. The required RCW-style warning text exists in `business.ts`.
- **Cart UX.** Cart persists across reloads (localStorage), supports per-line quantity steppers (capped at inventory), line removal, sale badges with struck regular price, and live Subtotal/Tax/Savings/Total.
- **Data pipeline is clean.** The POS transformer reliably produces 3,005 visible items and now a 112-vendor `vendors.json`. Build is deterministic (`transform:pos` then `next build`).
- **Performance baseline is good.** Most routes are statically prerendered; cached home/specials responses returned in ~25ms locally. Product detail pages are SSG (2,300+ pre-rendered).

## 2. Vendors & Partners page (newly built) — verification notes

- Two `SectionBanner` heroes (creative imagery, professional copy) bracket the content as requested.
- Outreach statement is cannabis-shop-specific and concise, with an **Email Our Buying Team** button → `contact@greenwaymarijuana.com` (prefilled subject/body).
- 112 vendor cards in the Home "Shop by Brand" style show **logo + name only**; tapping a card triggers a **seamless expand** where the description overlays the card art (no separate box). Placeholder logo + copy are in place for inspection.
- Nav label updated to **"Vendors & Partners"** (route `/vendor-delivery` preserved).
- Follow-ups: swap placeholder logo/description for real per-vendor assets; consider linking each card to `/menu?...vendor` once a vendor filter exists; add a lightweight search/filter if the 112-card grid feels long on mobile.

## 3. Findings by area

### UX / Information architecture
- Navigation is clear and consistent across pages; breadcrumbs are present on inner pages.
- **Dev/preview routes are publicly reachable:** `/menu/mock-preview` and `/menu/pos-preview` build as static pages. These should be removed, redirected, or `noindex`'d before launch.
- Cart auto-opens on add — good feedback — but consider a subtle toast as a less intrusive option for power users.

### Visual design / content
- **Product imagery is the #1 gap.** Cards show colored gradient placeholders with initials instead of real product photos. Real images (or at least category-specific art) would dramatically improve perceived quality and conversion.
- Several components are still named `*Preview` internally (`SpecialsPreview`, `FaqPreview`, `LoyaltySignupPreview`, `PriceMatchPreview`, etc.). The *visible copy* is mostly clean, but the naming invites stray "preview" wording to leak; rename when convenient and audit on-screen text page-by-page.
- Hero/banner imagery is strong and on-brand; keep the right-weighted composition standard.

### Compliance (WA I-502 / cannabis)
- Age gate is present at the root layout. Confirm it blocks content until acknowledged and persists appropriately.
- 21+ language, pickup-only, and "no online payment" are clearly stated at cart, checkout, and confirmation. 
- The full required warning string exists; ensure it's surfaced on product detail and/or footer where regulators expect it.
- Recommend a visible "no online sales / informational menu only" note near primary CTAs to avoid any implication of e-commerce checkout.

### Accessibility
- Color contrast on dark cards is generally good; verify the lighter zinc body text on gradient cards meets WCAG AA at small sizes.
- Vendor cards are real `<button>`s with `aria-expanded` — good. Ensure visible focus rings exist site-wide (Tailwind `focus-visible:` styles) for keyboard users.
- Add descriptive `alt` text for product and vendor logos (placeholder alts are currently generic).
- Confirm the age gate and cart drawer trap focus and are escapable via keyboard.

### SEO
- Root metadata + `metadataBase` are set, and `sitemap.xml` / `robots.txt` exist — solid foundation.
- **Per-page metadata is uneven.** Some routes have tailored titles/descriptions (checkout, vendors now do); others inherit generic copy. Add unique `title`/`description` per route and product (template like `<Product> | <Brand> | Greenway`).
- Exclude dev preview routes from the sitemap/robots.
- Add JSON-LD `LocalBusiness`/`Store` structured data (address, hours, geo already in `business.ts`) for rich local results.

### Code health
- 80 components, ~7.8k lines of TSX; largest is `InteractiveMenuBrowser.tsx` (~1,015 lines) — a candidate to split into smaller hooks/subcomponents for maintainability.
- `tsc --noEmit` and ESLint are clean on the changed files; full build passes.
- Cart/inventory logic centralized in `CartProvider.tsx` (good); checkout/order helpers isolated in `src/lib/checkout/order.ts` (good).
- Consider extracting the vendor card's expand state into a small reusable `ExpandableCard` if the pattern recurs.

### Conversion
- Clear primary CTAs ("Shop the Menu", "Today's Specials", "Proceed to Checkout", "Place Order").
- Daily-deal logic (e.g., "Top Shelf Thursday — 25% off") on the home page is a strong, dynamic hook.
- Biggest conversion levers: real product photos, a persistent "reserve for pickup" value-prop, and reducing friction on the checkout form (e.g., remember saved info across sessions).

## 4. Recommended next steps (prioritized)

1. **Add real product/vendor imagery** (or category fallbacks) — largest visual + conversion win.
2. **Remove or `noindex`+sitemap-exclude** `/menu/mock-preview` and `/menu/pos-preview`; audit any remaining on-screen "preview" wording.
3. **Per-page + per-product SEO metadata** and `LocalBusiness` JSON-LD.
4. **Accessibility pass:** focus-visible rings, alt text, age-gate/drawer focus management, AA contrast check on small text.
5. **Swap vendor placeholders** for real logos/descriptions; consider vendor → menu filtering.
6. **Integration hook-up (when ready):** the order flow already generates a number, builds a receipt, and decrements inventory client-side — wire the store alert + receipt print to the third-party POS/printer at that time. (Intentionally not built now.)
7. **Refactor** the largest menu component into smaller pieces for long-term maintainability.

## 5. Verification performed this pass

- Full production build: **passed** (2,366 routes; transformer emitted 3,005 items + 112 vendors).
- `tsc --noEmit`: **clean.** ESLint on changed files: **clean.**
- Browser walkthrough: vendors page heroes + email button + 112 cards + seamless expand; add-to-cart → cart drawer totals; Secure Checkout form + validation; Place Order → `/checkout/confirmation?order=GWY-JEUFZD`; cart cleared (badge → 0); inventory ledger recorded the sale (`{"<variantId>":1}`).

---

*Prepared as part of the checkout + vendors overhaul (PR #21). Findings reflect the state of the reviewed branch and are intended as a prioritized, launch-readiness checklist rather than blocking defects.*
