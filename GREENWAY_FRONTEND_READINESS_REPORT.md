# Greenway Marijuana — Front-End Readiness Deep-Dive

**Prepared:** June 2026  ·  **Live:** https://greenwaywebsite1.vercel.app  ·  **Repo:** mblyman89/GREENWAY-WEBSITE @ main (`029b4cc`)

---

## TL;DR

**Yes — the customer-facing front end is ready to move into the back-office project.** It is a polished, fast, compliant, mobile-and-desktop-tuned marketing + menu-browsing site that already looks more professional than most Washington dispensary sites (Uncle Ike's included). Every issue you flagged across four rounds is fixed and verified on live production.

There is **one architectural truth to be clear-eyed about**: the site today is a beautiful, fully-built *front end* whose "transactional" pieces (live menu inventory, cart→order, loyalty enrollment, real pricing/specials rules) are wired to **sandbox/placeholder data** and a **simulated checkout**. That is exactly what the back-office project is for — it's the engine that makes these front-end pieces real. So the natural, professional sequence is: **start the back office now**, and do a short, parallel "polish pass" on ~6 small front-end refinements that don't depend on the back office (listed below). You do **not** need to keep grinding on the front end before starting the back office.

**My recommendation:** Green-light the back-office project. Knock out the 6 quick polish items either now or alongside early back-office work. Hold the larger "needs the back office" items (live inventory, real checkout, loyalty CRM, analytics) for the back-office phase where they belong.

---

## 1. What was done this round (Round 4 — Final Mile)

All six requested items are implemented, validated (TypeScript + ESLint + production build all clean), visually verified on both the local production build and **live production**, and deployed:

1. **Desktop "Vendors" tab** — added to the top navigation bar (Home · Shop · Specials · About · Location · Loyalty · Blog · FAQ · **Vendors**), in addition to the existing hamburger entry. Verified live.
2. **Legal-document audit (vs. ikes.com source).** I scraped Uncle Ike's actual live Privacy Policy, Terms of Use, and Consumer Health Data Policy and diffed them against yours. Your swaps were clean — the entity (Jet City Retail, Inc. → **LYMAN'S MARIJUANA, Inc.**), brand (Uncle Ike's → **Greenway Marijuana**), and all contact details were correctly Greenway's. **One residual leak found and fixed:** the Terms of Use governing-law clause (§15.8) still named **"King County"** — that's Uncle Ike's Seattle county. Greenway/Port Orchard is in **Kitsap County**, so I corrected it. Per your instruction, all App / Apple / Google references were **kept** (for your future app).
3. **Cross-reference hyperlinks** — every in-document mention of "Privacy Policy," "Terms of Use," "Consumer Health Data Policy," the contact email, and the WA Attorney General complaint URL is now a real link, across all three legal pages. A page never links to itself (no circular links).
4. **Consumer Health Data title** — resized so it sits cleanly on **two lines** instead of three, at every breakpoint. Verified live.
5. **Mobile footer reorder** — the Privacy / Terms / Consumer Health links now sit **below** the Washington Cannabis Warning, with the **copyright directly beneath them** (kept on two lines as you like).
6. **Desktop footer copyright** — `© {year} LYMAN'S MARIJUANA, Inc., dba Greenway Marijuana. / All rights reserved.` added below the logo (year auto-updates).

---

## 2. Front-end health scorecard

| Area | State | Notes |
|---|---|---|
| Visual design / brand | **Excellent** | Consistent dark theme, gold/green/orange tokens, strong typography, professional polish. |
| Responsive (mobile + desktop) | **Excellent** | Dedicated mobile and desktop layouts; the trouble spots (search, price cards, PDP, footer) are all fixed. |
| Performance | **Strong** | Next.js 16 + Turbopack, 2,371 statically pre-rendered pages, image optimization via `next/image` + `sharp`. |
| SEO foundations | **Good** | Per-page metadata, sitemap.xml, robots.txt, JSON-LD structured data. |
| Accessibility | **Good, improvable** | aria-labels, roles, focus handling present; would benefit from a formal audit pass. |
| Legal / compliance | **Strong** | Age gate (21+), WA cannabis warning on every page, MHMDA consumer-health policy, now Greenway-clean. |
| Code quality | **Strong** | TypeScript strict, ESLint clean, component-driven, single-source content files. |
| Automated tests | **Missing** | No unit/E2E tests yet (acceptable for a marketing front end; worth adding before transactional features go live). |
| Analytics | **Not wired** | No GA4 / GTM / pixel. Easy add; recommended before launch for traffic insight. |

---

## 3. The honest architecture picture (why the back office is the right next step)

Several "interactive" features are intentionally front-end-only today and need a back office to become real:

- **Menu / inventory** points at the **Leafly _sandbox_ API**, backed by a preview JSON dataset. Real, live, accurate stock + pricing needs the POS/inventory integration (back office).
- **Cart → Checkout** is a **simulation**: it generates an order number and stores the order in the browser's localStorage. There is no payment capture and no write-back to a POS. Real ordering/pickup needs the back office.
- **Loyalty signup** posts to an API route that emails the store *if* a Resend key is configured (`email-not-configured` otherwise). A real loyalty program needs a CRM/database (back office).
- **Specials / Price Match** are presented as **previews** with "rules to be verified later" language. Real promo rules + price-match logic need the back office.

None of this is a defect — it's the correct separation of concerns. The front end is the showroom; the back office is the warehouse, register, and CRM. **The showroom is built. It's time to build the engine.**

---

## 4. Recommended polish pass (small, front-end-only, does NOT need the back office)

If you want the front end to be unimpeachably "top of the line" before/at launch, these are the high-value, low-effort wins. None require the back-office project:

1. **Wire analytics (GA4 or Plausible)** — you'll want day-one traffic/behavior data. ~1 hour.
2. **Replace remaining "preview / in development / placeholder" copy** that's user-visible (Specials, Price Match, policy "this is not final legal advice" banner, "App downloads coming soon"). Decide per-item: ship as final, or hide until backed by the back office. ~half day.
3. **Accessibility audit pass** (Lighthouse + axe): color-contrast on a few zinc-on-black labels, focus-visible states, and alt text review. ~half day.
4. **Open Graph / social share images** per key page (home, menu, a product) so links look premium when shared. ~2 hours.
5. **404 / error page polish** to match the brand (currently functional but plain). ~1 hour.
6. **Add a lightweight E2E smoke test** (Playwright) for the critical paths — age gate, menu load, add-to-cart, policy links — so future changes can't silently break them. ~half day.

**Nice-to-haves (optional, brand-elevating):** subtle scroll/section animations, a real favicon/app-icon set, font preloading for the script logo, and a cookie-consent banner if you add tracking pixels (ties into the privacy policy you now link everywhere).

---

## 5. Bottom line

The front end is **done and strong**. Four rounds of fixes have eliminated every issue you raised, and the legal docs are now genuinely Greenway's (King County leak caught and fixed). You are clear to **start the back-office project**. Treat the six polish items above as a short, parallel checklist — most are an hour or two each and can be done independently of, or alongside, the back-office work. You're not behind; you're at the natural handoff point between "build the showroom" and "build the engine."
