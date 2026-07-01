# Mobile Readiness Pass — On-the-Go Owner Experience

Owner request (verbatim intent): a mobile-readiness pass. NOT the whole back office — just the
useful, relevant things an owner needs while away from the computer. DO NOT change the desktop
back office (it's great). No guessing — build on verified fact only. Use best judgement on what's
logical to include.

## Grounding (verified this session)

### A. What on-the-go retail/dispensary owners actually need (researched)
- **Flowhub Stash** (cannabis-industry-standard mobile tool): primary on-the-go jobs are
  (1) inventory **audits** (scan + confirm counts, submit discrepancies w/ manager approval),
  (2) **transfers / move between rooms/locations**, (3) real-time visibility that **syncs back to
  desktop**. Manager-permission-gated approvals matter. Source: flowhub.com/learn (Stash).
- **Tableau mobile dashboard design principles**: on a phone favor **insights over exploration**;
  include ONLY the metrics that truly matter; use **real-time** + **immediately-actionable** data;
  present **simple snapshots / KPIs**, not dense dashboards. Source: tableau.com blog.
- Net: a mobile owner wants a fast glanceable snapshot (today's sales vs yesterday, what needs
  attention) + quick shortcuts to the handful of things they'd act on remotely — NOT the full 40+
  item admin nav.

### B. What ACTUALLY exists in the back office (walked the tree — reuse, don't rebuild)
- `getCockpitSnapshot()` (`src/lib/admin/cockpit-data.ts`) already returns REAL data:
  today vs yesterday revenue/orders/units/avgOrder + deltas; activeOrders + orderBoard;
  live registers + drawers (open/closed/variance/needsAttention); lowStockCount; publishedItems;
  lastImportISO; loyaltySignups. Degrades to zeros when Supabase unconfigured.
- `buildAttentionFlags(...)` + `cockpit-core` helpers (formatMoneyMinor, deltaLabel, peakHour, etc.)
  are pure and reusable.
- Nav map `adminNav` (grouped Sell/Inventory/Compliance/Finance/Marketing/Website/Insights/Admin),
  each item permission-gated; `can(role, permission)` filters visibility.
- Layout is responsive already; `AdminTopNav` has a mobile accordion (a shrunk desktop menu).
- Auth: `requireStaff()` / `getStaffSession()` → `{ profile.role, email, profile.full_name }`.

## Design decision (grounded, best-judgement)
Build a DEDICATED, curated mobile view at `/admin/mobile` ("On the Go") — a purpose-built,
phone-first snapshot + short actionable shortcut list — INSTEAD of just shrinking the desktop.
Rationale: research says curate for the person + actionable snapshot; the existing accordion just
mirrors desktop. Desktop remains 100% untouched.

Curated content (only what an owner would act on remotely, all permission-gated, reusing real data):
- **Today snapshot**: revenue (vs yesterday delta), orders, units, avg order — from cockpit snap.
- **Needs attention**: attention flags (open orders, low stock, drawers needing verification) —
  from buildAttentionFlags + drawers rollup. Each links to the relevant desktop page.
- **Quick glances**: active orders, low-stock count, live registers/drawers, published menu size,
  last menu import, loyalty signups — read-only tiles that deep-link.
- **Shortcuts**: a curated, permission-filtered subset of nav most useful on the go
  (Orders, Registers & Drawers, Reports, Inventory, Menu Imports, Compliance Health, Marketing).
- Links to the AI concierge (already global) for questions.

## Slices
- [x] M1  Mobile snapshot lib `src/lib/admin/mobile-core.ts`: PURE selectors over CockpitSnapshot →
        mobileKpis / mobileAttention (reuses buildAttentionFlags) / mobileGlances + curated
        MOBILE_SHORTCUTS with visibleShortcuts(role) permission filter via can(). No server imports,
        no new data source. Self-tested: __runMobileCoreTests() = 10/10 assertions pass (tsx).
- [x] M2  `/admin/mobile` route (server component, requireStaff-gated) + phone-first
        `MobileHome` component (greeting, 2-col KPI grid, attention list w/ deep links, 3-col glance
        grid, 1-col shortcut list, "Open desktop view" link). Reuses getCockpitSnapshot + cockpit-core
        formatters (formatMoneyMinor/deltaLabel). Desktop cockpit UNTOUCHED. Relative "menu updated Xm ago".
- [x] M3  Discoverability: `MobileLauncher` — phone-ONLY (lg:hidden) floating "📱 On the Go" pill,
        bottom-center bottom-20 (clears the bottom-right Concierge + bottom-left Help), hidden on the
        mobile page itself + login/logout. Mounted additively in admin layout chrome; desktop chrome
        unchanged. tsc clean; npm run build succeeds (route ƒ /admin/mobile registered).

## Status: mobile readiness pass COMPLETE. Desktop back office unchanged (additive route + components only).

## Constraints honored
- Desktop back office UNCHANGED. Mobile view is additive (new route + new components).
- No new migration; no new data source; reuse verified stores only. Money stays in minor units.
- Everything permission-gated via `can()` / `requireStaff()`.
