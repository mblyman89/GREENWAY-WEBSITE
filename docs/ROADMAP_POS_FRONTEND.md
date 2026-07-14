# POS Front-End Roadmap — Matching the Big Players

Owner directive (Task AI, verbatim intent): research how Square, Toast,
Shopify POS, Cova, Dutchie and Flowhub present their front-end POS — the
UI, the tiles, the cart, everything on the home screen — and build a
roadmap of what we have, what we need, and the order to build it, so our
register is as powerful, clean and easy to use as theirs, styled with our
website/back-office theme. **Owner exclusions (permanent): customer-facing
display is skipped by choice; gift cards are NOT ALLOWED for this license
and must never be proposed again.**

Everything below is sourced — vendor docs/support articles read on
2026-07-14 — and cross-checked against our repo (files cited). Nothing is
guessed.

---

## 1. Research notes — how the big players present their POS

### 1.1 Square (Point of Sale / Register)

Sources: squareup.com support "Set up item grid"; "Explore the Updated
Square Point of Sale App" (Inside Square); support "Set up cash rounding"
(open beta).

- **Item grid is the heart of checkout.** A configurable grid of tiles —
  items, categories, discounts, rewards — "transforms your point of sale
  into a lightning-fast, user-friendly tool." Tiles are added by
  press-and-hold on an empty square; multiple pages of tiles; grid syncs
  to all devices at a location.
- **Three checkout surfaces**: Keypad (amount entry), Item Library
  (full searchable catalog) and Favorites (the custom tile grid) —
  switchable tabs, "consistent checkout experience across all of your
  POS devices."
- **Bottom navigation bar** with a small set of tabs ("declutter your POS
  and make it easy to navigate during busy business hours"); merchants can
  customize which tools appear.
- **Cash rounding (US penny phase-out, open beta)**: cash totals rounded
  to the nearest $0.05; **card/digital unaffected; tax computed on the
  original amount before rounding**; the adjustment prints on receipts as
  its own line and appears in reports as a separate "Cash rounding" row.
  Unavailable in Connecticut (state law). Rounding table: .01/.02→.00,
  .03/.04→.05, .06/.07→.05, .08/.09→.10.
- Loyalty prompts at checkout ("prompt members of your loyalty program to
  redeem rewards").

### 1.2 Toast (restaurant POS — the gold standard for speed-of-service)

Sources: support.toasttab.com "Manage Orders With Toast POS"; "Configure
Cash Rounding During U.S. Penny Phase Out".

- **Quick Order screen** (their retail-speed mode): menu items grouped by
  menu → group → item; **search bar above the items**; check (cart) pinned
  on the **left side** with the most-relevant actions at the top of the
  check (discount, split, guest count) and less-used actions behind a
  **check overflow menu** (vertical dots). Pay/Print locked at the bottom.
  Dark and light modes.
- **Item-on-check editing**: tapping a cart line opens quantity, repeat,
  delete, item-level discount — editing happens ON the check, not in a
  separate screen.
- **Overflow menu** in the top-right for register-level actions (switch
  user, lookup check, void order, device status) — keeps the main surface
  clean.
- **Quick Edit mode**: staff can mark an item out of stock directly from
  the POS.
- **Cash rounding**: a **non-taxable adjustment for cash only**, applied
  after tax/discounts, three owner-selectable modes — always down (guest's
  favor), always up (house's favor), or nearest nickel — with the rule
  table matching Square's. Receipts carry a rounding line + a disclaimer
  ("If you pay with cash, your total may be rounded per this location's
  policy"). Reporting keeps rounding **out of net sales and sales tax**,
  recorded as cash over/short.

### 1.3 Shopify POS

Source: help.shopify.com "Changing the Shopify POS smart grid".

- **Smart grid home screen**: configurable tiles for products,
  collections, apps, and features; multiple pages; **tile colors are
  editable**; drag-to-reorder with a press-and-hold "shake" mode; grid
  templates managed centrally and assigned per location. Permission-gated
  ("Customize smart grid").

### 1.4 Cova (cannabis POS — 2,200+ dispensaries)

Source: covasoftware.com/pos (front-of-house feature list).

Front-of-house pillars: ID scanning creating instant profiles, queue
management, **purchase limit gauge ("Upsell, without overselling")**,
product info on demand ("every budtender is an expert"), offline mode,
smart promotions with auto-redemption, cash management (till/safe
reconciliation), auto tax calculation, anti-looping limit enforcement.
Their pitch: "fast, easy, reliable" with 100% uptime on 4/20.

### 1.5 Dutchie (cannabis POS)

Sources: support.dutchie.com register articles (cart, add items,
purchase-limit FAQ, reprint/email receipts).

- Register flow is **guest-first**: search the guest → open their profile
  → Create Order → scan or search items into the cart. (Ours is ID-first
  — same principle: the person is verified before the cart.)
- Optional hard mode: **require staff to scan products** (manager PIN to
  unlock manual search) — scan-first accuracy discipline.
- Cart actions overview: discounts, loyalty redemption, fees, weigh-at-
  register, pre-orders, returns/exchanges, void, reprint/email receipts —
  all one tap from the cart.

### 1.6 Flowhub / SparkPlug (leaderboards)

Sources: flowhub.com partners/sparkplug-integration; sparkplug.app.

- Flowhub itself ships register + "View" companion dashboards; budtender
  **performance visibility** is a first-class integration category.
- SparkPlug (the #1 incentive platform, integrated by Flowhub AND Meadow):
  automated **sales leaderboards and contests for budtenders** driven by
  POS transaction data — the industry-standard motivation loop. Key
  mechanics: per-employee sales attribution, daily/weekly windows,
  ranked boards, goals/celebrations.

### 1.7 Washington cash-rounding ground truth (compliance)

Source: WA Department of Revenue, "Interim guidance statement regarding
the elimination of the penny" (Feb 26, 2026, read 2026-07-14):

- Retailers **may choose their own rounding procedures** for cash
  (nearest / always up / always down).
- **Sales tax remains due on the sales price BEFORE rounding** — rounding
  never changes the tax calculation.
- A rounding **gain** is currently B&O-taxable gross income (Service &
  Other), **but DOR is pausing enforcement** pending final guidance; a
  rounding loss is a cost of doing business.
- Worked examples confirm: tax computed on the pre-rounded total; the
  cash collected differs only by the rounding adjustment.

Implication for us (cash-only): round the **total due** at tender by an
owner-chosen mode, show the adjustment as its own receipt line, keep
`totalMinor`/tax in the payload pre-rounded so the server money gate and
CCRS/DOR reporting are untouched, and track the adjustment separately for
drawer math.

---

## 2. What we already have (verified in-repo)

| Big-player capability | Ours | Where |
| --- | --- | --- |
| ID-first compliance gate (scan + audited manual) | ✅ B3/B6 | `id-scan-core.ts`, `SaleFlow.tsx` IdGateScreen |
| Offline-first queue + server re-validation | ✅ B2/B4/B5 | `register-client-core.ts`, `sync-store.ts` |
| Purchase-limit gauge (Cova's "upsell without overselling") | ✅ B6 | `judgeLimits` + cart limit meter |
| Medical pricing/exemptions at register | ✅ B7–B9 | `medical-pos-core.ts` |
| Receipts: paper + customization + email | ✅ B10/B13/B30 | `receipt-core.ts`, `email-receipt-core.ts` |
| Loyalty attach + earn + member history | ✅ B14/B29 | `member-history-core.ts`, MemberPanel |
| Returns desk w/ receipt lookup + 15-day policy | ✅ B15/B16 | `returns-core.ts`, returns desk |
| Hold/resume, reprint, audited no-sale | ✅ B17 | RegisterShell/SaleFlow |
| Inventory decrement + lot capture on sale | ✅ B19/B20 | `sale-decrement-core.ts` |
| Till: count-in / drops / blind close | ✅ B21 | `till-core.ts`, TillModal |
| X/Z day report | ✅ B22 | `day-report-core.ts` |
| Barcode scan-to-cart (wedge) | ✅ B23 | `resolveScan` |
| Manager price override w/ reason + audit | ✅ B24 | override flow |
| Void sale (same-day, manager PIN) | ✅ B27 | void flow |
| Online-order pickup queue | ✅ B28 | `pickup-core.ts` |
| Change count-back + smart tender | ✅ B31 | `change-calc-core.ts` |
| Low-stock badges + cart advisories | ✅ B32 | `low-stock-core.ts` |
| PWA install, auto-lock, PIN unlock | ✅ B5/B11 | `pos-sw.js`, lock screen |

## 3. What we need (gap analysis vs Square/Toast/Shopify/Cova/Dutchie)

| Gap | Who does it | Priority |
| --- | --- | --- |
| Cash rounding (nickel; penny phase-out) | Square, Toast | **B33 — now** |
| Budtender leaderboard (daily/weekly, celebratory) | SparkPlug via Flowhub/Meadow | **B34 — now** |
| Branded, dashboard-style home screen (status strip + big action tiles) | Square nav/smart grid, Shopify smart grid | **B35 — now** |
| Product **tile grid** + category color chips + prominent search | Square item grid, Toast menu groups, Shopify tiles | **B36 — now** |
| Cart as a proper check panel: tap-line editing, sticky totals, clean rows | Toast check details | **B37 — now** |
| Tender/done/modal theme unification (brand tokens everywhere) | all (consistent design systems) | **B38 — now** |
| Quick amount keypad tab (Square Keypad) | Square | B39 |
| Favorites tile page (pinned best-sellers, per-register) | Square Favorites, Shopify smart grid | B40 |
| Scan-required mode (manager PIN to search manually) | Dutchie | B41 |
| Register-side product info on demand (COA/terpene/THC detail card) | Cova "Product Info On Demand" | B42 |
| Out-of-stock quick-flag from the register (Toast Quick Edit) | Toast | B43 |
| Light/dark mode toggle per device | Toast | B44 |
| Fees/donations line items | Dutchie | B45 |
| Pre-order creation at register (phone orders) | Dutchie | B46 |
| ~~Customer-facing display~~ | — | **SKIPPED (owner choice)** |
| ~~Gift cards~~ | — | **EXCLUDED (not allowed under license — never propose)** |

## 4. Build order (this task = B33–B38)

1. **B33 — Cash rounding, done the WA-lawful way.** Owner-configurable
   mode (off / nearest / always-down / always-up) stored in
   `site_settings` (no migration, B13 pattern), shipped in the menu
   bundle, applied at tender to the amount due only. `totalMinor` and tax
   stay pre-rounded (DOR interim guidance); the adjustment is its own
   payload block, receipt line, and day-report row. Change plans (B31) and
   smart tender suggestions run off the rounded due.
2. **B34 — Budtender leaderboard.** Device-authenticated
   `/api/pos/leaderboard` aggregates the day's + trailing week's
   register-rung sales per employee (from `pos_sale_events`), pure core
   ranks with medals/tie-breaks, register modal celebrates the leaders —
   SparkPlug's motivation loop without the SaaS bill.
3. **B35 — Theme foundation + home screen overhaul.** POS design tokens
   in `globals.css` mirroring the website/admin brand (Greenway green
   #7ed957, gold, deep green, charcoal surfaces), then the home screen
   rebuilt as a branded dashboard: header with store identity, status
   strip (drawer/sync/menu/queue), big color-coded action tiles with
   icons, Square-style clarity.
4. **B36 — Sale screen overhaul.** Product results become a responsive
   **tile grid** with deterministic category color chips (Square/Shopify
   tiles), category filter chips above the grid (Toast groups), prominent
   search/scan bar; stock badges carry over.
5. **B37 — Cart/check overhaul.** Toast-style check panel: tap a line to
   edit quantity/override in place, cleaner line rows, sticky totals
   panel, limit meter and advisories restyled to the brand.
6. **B38 — Tender/done/global unification.** Tender keypad-quality
   layout, brand-styled suggestion chips + count-back pills, celebratory
   done screen, and a sweep so every modal (till, day report, no-sale,
   pickup, void, leaderboard) uses the same tokens.

Slices ship one PR each per the standing rules (pure cores self-tested +
vitest mirrors, tsc/eslint/suite green, CI, squash-merge, roadmap notes).

## 5. Shipped

(Notes appended as slices merge.)
