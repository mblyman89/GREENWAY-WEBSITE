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
| ~~Fees/donations line items~~ | Dutchie | **B45 — CANCELLED (owner: "I don't need or want those last two slices")** |
| ~~Pre-order creation at register (phone orders)~~ | Dutchie | **B46 — CANCELLED (owner: "I don't need or want those last two slices")** |
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

### B33 — Cash rounding, the WA-lawful way (PR #499, 8ed2e67)

Owner-configurable rounding mode (off / nearest / always-down /
always-up) lives in `site_settings` (B13 pattern — **no migration**) and
rides the menu bundle to every register. Pure core
`src/lib/pos/cash-rounding-core.ts` rounds the **amount due only** to the
nearest nickel; `totalMinor` and tax stay pre-rounded per DOR interim
guidance. The adjustment is its own sale-payload block, its own receipt
line ("Cash rounding"), and its own day-report row, so the books always
reconcile to the penny. B31 change plans and the smart tender suggestion
chips run off the rounded due. 41 self-test assertions registered in the
runner (import + call) with a vitest mirror.

### B34 — Budtender leaderboard (PR #500, 80f502a)

Device-authenticated `/api/pos/leaderboard` aggregates completed
register-rung sales per employee from `pos_sale_events` — today and the
trailing week. Pure core `src/lib/pos/leaderboard-core.ts` ranks with
medals and deterministic tie-breaks. The register modal shows two boards:
**today ranks by sale count with dollars deliberately hidden** (blind
drawer-count discipline), the week board ranks by gross. SparkPlug's
motivation loop, zero SaaS bill. 18 self-test assertions + vitest mirror.
No migration.

### B35 — Theme foundation + home screen overhaul (PR #501, be10f8e)

The POS design-token block in `globals.css` mirrors the public site and
back office: `--pos-canvas/surface/surface-2/hover`, hairline borders,
three text tiers, and brand accents (`--pos-accent` = Greenway #7ed957
with `--pos-accent-ink` dark-green text for solid green fills, plus
gold/orange/danger soft+border variants). `.pos-shell` paints a subtle
brand glow over near-black; `.pos-tile` gives every tappable surface
:active press feedback. Home screen rebuilt as a branded dashboard:
wordmark header (plain `<img>` on `/pos/wordmark.png` so the service
worker's cache-first `/pos/*` strategy keeps it offline-boot-safe),
status strip (drawer/sync/menu/queue with state dots), and big
color-coded action tiles — Start sale solid green, Pickup gold, Clock
orange, Lock charcoal. Loading/setup/lock screens and PWA chrome colors
(`#060807`) match. No migration.

### B36 — Sale screen tile grid (PR #502, 519dc6d)

Product results became a responsive tile grid with deterministic category
colors: pure core `src/lib/pos/sale-grid-core.ts` hashes category names
(djb2) into `CATEGORY_COLOR_COUNT = 8` palette slots, so "flower" paints
identically on every register with zero config — a module-load guard
throws if the SaleFlow palette ever drifts from the core constant.
Busiest-first category filter chips (`menuCategoryChips`) sit above the
grid; `filterMenuProducts` delegates to the existing `searchProducts` so
search behavior is unchanged. Stock badges carry over onto tiles. 20
self-test assertions + vitest mirror (suite 1,549 → 1,558 / 113 files).
No migration.

### B37 — Cart/check overhaul (PR #503, 7657717)

Toast-style check panel: tapping a line expands it in place for
quantity/override editing (`expandedLine`), Remove is
`setCartQuantity(…, 0)`, line rows are cleaner, and the totals panel is
sticky at the bottom of the check. The limit meter and every advisory
restyled onto the brand tokens. Presentation-only, one file, suite
unchanged. No migration.

### B38 — Tender/done polish + global modal unification (PR #504, 79df8d5)

The finishing sweep. TenderScreen: the amount due is a green-soft hero
card, suggestion/toggle chips use the accent/ink active pattern, Complete
sale is solid greenway with dark-green ink. Done screen: celebratory
green card with the change amount large in brand green; count-back pills
(B31) restyled. ReceiptButtons, EmailReceiptPanel, IdGateScreen,
PriceOverrideModal (approve stays amber — caution color), and MemberPanel
all tokened. In RegisterShell every modal — no-sale, void, pickup queue,
day report, leaderboard, till — now shares one container/close/primary
pattern on the tokens; every `bg-emerald-600` primary became
accent/accent-ink. Zero legacy neutral/emerald classes remain in
SaleFlow/RegisterShell (the pinned B36 category palette is intentional).
Presentation-only; 1,558 tests / 113 files green. No migration.

### B39 — Quick-amount keypad tab (PR #506, ebd7606)

Square-style keypad for the "it's not on the menu" moment — deliberately
**non-cannabis only** (misc/sundry: lighters, a bag fee, a one-off):
every cannabis line must stay item-tied for CCRS, so the keypad refuses
cannabis by construction. Pure core `custom-sale-core.ts`: keypad math,
price cap, `buildCustomProduct` emits `pos-custom-` product keys carrying
one of the NON_CANNABIS_TAX_CATEGORIES (invariant guarded in the
self-test); the B19 sale-decrement skips custom keys, and ccrs-sales
falls back to the category snapshot. KeypadPanel tab in SaleFlow with a
hoisted KeyButton. 27 self-test assertions + vitest mirror. No migration.

### B40 — Favorites tile page (PR #507, 0ae515a)

Per-register pinned best-sellers (Square Favorites): a ★ Favorites tab
first in the grid, pin/unpin via a star overlay on every tile (shared
`ProductTile` component). Pure core `favorites-core.ts`: versioned
envelope in localStorage (`gw-pos-favorites`, per device, cap 24),
corruption-proof parsing, and — the compliance-relevant part —
`favoriteProducts` resolves pins against the **live bundle in pin
order**, so a delisted product never renders and prices are never stale.
22 self-test assertions + vitest mirror. No migration.

### B41 — Scan-required register mode (PR #508, 5189b14)

Dutchie-style owner setting: when ON, cannabis items must be SCANNED —
manual tile taps and search-adds are blocked, and a manager/lead PIN
(`/api/pos/approve`) lifts it for ONE sale. Pure core
`scan-required-core.ts`: `productRequiresScan` is the exact complement of
NON_CANNABIS_TAX_CATEGORIES (blank category conservatively cannabis);
`manualAddBlocked(config, unlockedThisSale, product)` is the single gate.
Config lives in `site_settings` (`pos_scan_required`, B33 pattern — no
migration), rides the bundle as `scanRequired?` so OFFLINE registers keep
enforcing it, and has an admin page (Registers → Scanning) with audit.
Every manual add in SaleFlow funnels through one `manualAdd` guard; a
status pill + per-sale unlock modal surface the mode. 24 self-test
assertions + vitest mirror. No migration.

### B42 — Product info on demand (PR #509, eacf017)

Cova-style detail card: an ⓘ on every tile opens facts — strain type,
THC/CBD, terpenes (top 4), a 400-char word-boundary-trimmed description —
all riding the menu bundle so the card works OFFLINE. A single
representative photo loads ONLINE-ONLY via device-authed
`/api/pos/product-image` (DF-3 resolver ladder vs the published item;
best-effort `{image:null}`, skeleton + "Representative photo" fallback in
the modal). "Add to check" funnels through the same manualAdd guard (B41
respected). Pure core `product-info-core.ts` (25 assertions) + vitest
mirror. Deliberate scope: NO images on the sale grid — the catalog is
large, the register is an offline-first PWA, and tile photos would add
curation burden and cache weight for zero speed; one on-demand photo
answers "is this the right jar?" without any of that. No migration.

### B43 — Out-of-stock quick-flag (PR #510, a31fc3b)

Toast's "86 it": the shelf is empty but the menu still shows it → open
the ⓘ card, tap "Mark out of stock", pick a reason (closed set: shelf
empty / damaged / wrong listing — no free text), and the item leaves
every register and the website. The server flips
`menu_items.inventory_status → "unavailable"` on the PUBLISHED version —
the SAME field B19's sale-decrement writes, so every downstream consumer
already honors it. ONE-WAY at the register (a register can kill a
phantom listing but never invent inventory — restock happens in the back
office), ONLINE-ONLY, audited (`pos.stock_flag` with reason + who),
idempotent across registers. Optimistic local apply removes every
variant from the cached bundle immediately. Pure core
`stock-flag-core.ts` (19 assertions) + vitest mirror. No migration.

### B44 — Per-device light/dark display mode (PR #511, 0b6ab32)

Toast-style: each terminal picks its own mode (bright front window →
light; corner register → dark). Pure core `theme-core.ts`:
`gw-pos-theme` in localStorage per device, corruption degrades to dark,
strict two-state toggle. The register's last hard-coded status colors
(67 amber/red/sky/emerald spots) moved onto new semantic tokens
(`--pos-warn/-danger/-info/-ok` families + `--pos-gold-ink`), finishing
the B38 sweep — then ONE `html[data-pos-theme="light"]` block in
globals.css re-tints every `--pos-*` token (brand accents shift to
readable-on-white equivalents; `.pos-shell` gets a light glow +
`color-scheme: light`). RegisterShell sets the attribute on `<html>`,
removes it on unmount, and offers a ☀️/🌙 toggle in the home header that
works offline. 16 self-test assertions + vitest mirror. Suite now 1,591
tests / 119 files. No migration.

### Task AK — Receiving → website menu FIXED (PR #513, ad6c7bf)

Owner's mission: "I can accept inventory successfully but there is no
way to add those items to the website menu." Root cause (verified,
never guessed): `seedDraftsForManifest` upserted onboarding drafts with
`onConflict: "pos_product_key"`, but the only unique index on that
column is PARTIAL (`catalog_drafts_open_poskey_uidx`, migration 0026) —
PostgREST cannot target partial indexes in ON CONFLICT (Postgres 42P10,
postgrest-js#403) and the error was NEVER READ, so every draft insert
failed silently on every receive. No drafts → nothing to approve → the
intake auto-carry always skipped `no-approved-drafts` → received
products could never reach the menu; the UI even reported
`draftsCreated = unmatched` while writing zero rows. Fix: new pure core
`draft-seed-core.ts` (`planDraftSeeding`: published match → open-draft
skip → in-run dedupe; keyless lots always seed; `classifyInsertError`:
23505 = benign race duplicate, else real failure) + plain INSERTs whose
errors are read; honest `draftsCreated`/`draftsFailed`/`firstError`
returned; `finalizeManifestDispositions` logs a `draft_seed_error`
timeline event on real failures. Batched published-key lookup replaces
per-lot round-trips. B45/B46 struck through as CANCELLED (owner
choice). 20 assertions + vitest mirror; suite 1,597 tests / 120 files.
No migration — the partial index stays as the race backstop.

### Task AL — Front-end presentation & workflow overhaul (PR #515, 43f6c7c)

Owner's mission: "build me a front end that has a great workflow…
using already proven methods and strategies… really actually research
what a great pos frontside should look like… make my front end
beautiful, and clean, and simple and enjoyable." Research (Shopify POS
UI, Bright Inventions payment UX, Creative Navy POS principles,
Dynamics 365 transaction anatomy, Rossul dispensary case study,
Flowhub, Apple HIG 44pt / WCAG 2.5.5 touch targets) is distilled into
`docs/POS_UI_DESIGN_BRIEF.md`; every slice cites a rule. AL-A: the
sale screen owns the viewport at lg+ (h-dvh, no page scroll — grid and
check scroll internally, totals + tender always visible), 60/40
browse/check split (3fr_2fr, 4-col grid at 2xl), 44px minimum touch
targets on chips/tabs/line-editor buttons, 36px tile ★/ⓘ hit areas.
AL-B: register keypad replaces the naked custom-$ text input on the
tender screen — pure `tenderKeypadAppend`/`tenderKeypadBackspace` in
change-calc-core ($9,999.99 cap), chips reset the keypad so the two
inputs never fight; +12 assertions (35 in core) + vitest mirror.
AL-C: home screen reordered hero-first — held-sale banner (urgent),
double-width Start sale hero + action tiles, status strip demoted
below (Dynamics welcome-screen pattern). Suite 1,601 tests / 120
files. No migration; compliance gates and offline-first untouched.
