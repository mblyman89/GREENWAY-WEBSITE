# Cash Management → Register & Shift Oversight (Back-Office Console)

**Status:** Second attempt (corrected direction). Supersedes the first-attempt plan.
**Branch:** `feat/cash-management-page` · **PR:** #238
**Page:** `/admin/registers`

---

## 1. Why this was rewritten

The first attempt renamed "Registers & Drawers" → "Cash Management" and reorganized the
existing **count-in / drop / blind-close / reconcile** cash-drawer *workflow* into the page.

The owner corrected the intent (verbatim):

> "I feel like the cash management page should be something the employee would see on the
> front end ipad pos system. I am hoping for more along the lines of shift management, cash
> register activity, a live transaction feed, and such. can you go back to the authoritative
> resources and help me actually transform this important arm of the pos system back end."

So the **hands-on drawer-counting workflow belongs on the front-end iPad POS** (the cashier
does it at the register). The **back office** version of this arm of the POS is a
**manager oversight / monitoring console** — read-only visibility into who is working,
what the registers are doing, and a live feed of activity — with the ability to jump into
the few genuinely-manager actions (reconcile / verify) when something needs attention.

---

## 2. Authoritative research (best-in-class POS, not cannabis-specific)

Verified against vendor documentation on 2026-07-04.

### Square — Shifts + Dashboard (the "business headquarters")
- **Square Shifts** (back office): scheduling & shift management, time tracking & attendance,
  **labor-cost reporting**, "real-time attendance, shift, and **sales vs. labor** reports",
  overtime/break tracking, automatic timecards.
  Source: https://squareup.com/us/en/staff/shifts
- **Square Dashboard** ("your new business headquarters"): "**real-time reports** show you
  hourly sales", "see all your **transactions**", **team-member-attributed activity log**
  (who's selling, refunds), and "**handle tasks that need attention right away**."
  Source: https://squareup.com/us/en/point-of-sale/features/dashboard

### Toast — Reporting Dashboard (Weekly Overview)
- A single manager view across four areas: **Net Sales, Labor Cost, Guest Count, Top Items**,
  each with % change vs. a comparison period; **refreshes hourly**; every number is a
  drill-through link to the detailed report.
  Source: https://support.toasttab.com/en/article/How-to-Use-the-Toast-Reporting-Dashboard

### Lightspeed — BackOffice **Shifts Summary** (the closest analogue to our need)
- "A **read-only overview of cash flow during each register shift**... so you can **monitor
  the cash drawer from anywhere**." Columns: **Register (green dot = open shift, red = closed)**,
  Opening Manager, Opened time, Closing Manager, Closed time, Starting Cash, Cash Tenders,
  Expected Cash, Actual Cash, **Variance (over/short)**.
  Source: https://shopkeep-support.lightspeedhq.com/hc/en-us/articles/47479940209819-Shifts-Summary
- **X / Z reports** (the count/close detail) are explicitly **run at the register** (front-end),
  not in BackOffice — confirming the split the owner described.
  Source: https://shopkeep-support.lightspeedhq.com/hc/en-us/articles/47480030210971-X-and-Z-Reports

### Consensus pattern for a back-office oversight console
1. **Who's working right now** — live on-the-clock roster + today's shifts (shift management).
2. **Register / shift activity** — per-register live status (open/closed, by whom, since when,
   starting cash, cash moved), read-only, with a green/red status signal.
3. **Live activity feed** — a reverse-chronological stream of what's happening (orders coming
   in, drawers opening/closing, reconcile/verify events).
4. **At-a-glance KPIs** — the day's headline numbers (sales vs. yesterday, active orders,
   open drawers, over/short).
5. **Needs attention** — the short list of manager-only actions to resolve (drawers awaiting
   reconcile, tills awaiting verify).

---

## 3. Backend data reality (verified in the file tree — do NOT fabricate)

There is **no in-store per-transaction POS table** in this back end. In-store sales are not
recorded as individual transactions. The only transaction-like records are **online pickup
orders**. So the "live transaction feed" must be built from **real** events only:

| Console surface (from research)     | Real backend source (verified)                                             |
|-------------------------------------|-----------------------------------------------------------------------------|
| Who's working now / shift mgmt      | `staffing/store.ts` → `onTheClock()`, `listRecentShifts()`, `Shift` type    |
| Register / shift activity           | `registers/store.ts` → `liveRegisters()` (`RegisterLive`), `recentSessions()` |
| Live activity feed                  | `orders-store.ts` → `listOrders()` (`OrderRow`) **+** drawer `recentSessions()` **+** clock-ins from `onTheClock()` |
| At-a-glance KPIs                    | `admin/cockpit-data.ts` → `getCockpitSnapshot()` (today-vs-yesterday sales, active orders, drawers rollup) |
| Cash over/short & drawer state      | `registers/store.ts` → `cashDrawerSummary()`; `cash.ts` → `formatCents`, `overShortLabel` |
| Needs attention (reconcile/verify)  | `recentSessions()` filtered by status + existing `reconcileDrawerAction` / `verifyTillAction` |

**Constraints:**
- Sales figures (`sales.ts`, `getSalesReport`) are derived from the `orders` table — i.e.
  **online orders**. Label them honestly ("online order sales"), never as full in-store sales.
- The count-in / drop / blind-close forms stay in the codebase (`actions.ts`, `DenomFields`,
  `cash.ts`) because the front-end iPad POS is not built here yet — but they are **removed
  from this back-office page**. The only manager actions kept on this page are **reconcile**
  and **verify**, which are genuinely back-office oversight actions (a manager signs off).
- All time-dependent computation stays in the **server data layer** (store functions), never
  in the page render, to satisfy `react-hooks/purity`.

---

## 4. Page design (what we build)

**Name:** the page is renamed to **"Register Activity"** in navigation and headers — the
plainest industry term for a back-office register/shift oversight surface (Lightspeed's own
term is "Shifts Summary"; Square calls it register/team activity). Route stays `/admin/registers`.

**Sections (top to bottom):**
1. **AdminPageHeader** — title "Register Activity", subtitle about live oversight, help panel,
   breadcrumbs (Sell › Register Activity), action → "Cash drawer reports" (history page).
2. **Today at a glance** — StatCards from `getCockpitSnapshot()` + `cashDrawerSummary()`:
   online order sales today (vs. yesterday), active orders, open drawers, net over/short today.
3. **Needs attention** — only rendered when non-empty: drawers awaiting reconcile (form),
   tills awaiting verify (form). Manager-permission gated.
4. **On the clock** — live roster from `onTheClock()` (name, role, clocked-in since). Shift
   management at-a-glance; links to the full staffing/timeclock pages for editing.
5. **Registers** — per-register live cards from `liveRegisters()`: green/red status dot,
   open session's opener + opened-at, starting cash, dropped-to-safe, expected close. Read-only.
6. **Live activity feed** — merged, reverse-chronological stream built server-side from
   real events: new/updated online orders, drawer open/close/reconcile/verify, clock-ins.
   Each row: timestamp (Pacific), icon, human sentence, optional amount.

**Removed from this page:** open-drawer, record-drop, blind-close forms + `DenomFields`
(these are front-end iPad POS responsibilities).

---

## 5. Data-layer additions (server-side, pure page render)

- `registers/store.ts`: keep `cashDrawerSummary()`. Add nothing impure to the page.
- New assembler `lib/registers/oversight.ts` → `getRegisterActivity()` returning one typed
  snapshot: `{ configured, kpis, onClock, registers, needsAttention, feed }`, computing all
  `new Date()` / business-day logic server-side. Degrades to empty when unconfigured.
- Activity feed items are a discriminated union `ActivityEvent` with a stable sort key
  (ISO timestamp) so the page just maps over them.

---

## 5b. Premium manager cash controls (follow-up slice)

Owner feedback after review: an open drawer showed up but there was **no way to
close it** from the console, and the command center should carry premium cash
controls. Added — all reusing the EXISTING server actions / store functions and
real tables (no new backend contract, no fabricated data):

- **Open drawer** (idle register) — count-in the starting float by denomination,
  pre-labelled with the register's standard float. → `openDrawerAction`.
- **Cash drop to safe** (open register) — amount + window (afternoon/night/other)
  + dropped-by/witnessed-by + notes. → `recordDropAction` (real `drawer_drops`).
- **Close drawer** (open register) — **blind** denomination count-out (expected /
  variance intentionally hidden until reconcile). → `closeDrawerAction`.
- **Drops-today detail** on each open register card (real `dropsForSession`).
- **Live count total** as the manager types — new client component
  `CountGrid.tsx` (the only client piece; server actions still read the same
  denomination field names off FormData).
- **Employee attribution pickers** (real `listEmployees`), and `opened_by` /
  `closed_by` / drop actors now resolve to **employee names** (were raw UUIDs).
- Cash drops now also appear in the **live activity feed**.

New files: `src/components/admin/registers/CountGrid.tsx`,
`src/components/admin/registers/RegisterControls.tsx`. Controls are gated by the
page's existing `orders.manage` requirement; reconcile/verify remain
`inventory.manage`. All `new Date()` logic stays server-side.

## 6. Verification & handoff
- `npx tsc --noEmit -p tsconfig.json` → `npx eslint <changed>` → `npx next build` → `rm -rf .next`.
- Commit on `feat/cash-management-page`; update PR #238; report handoff-ready.
- No migrations required (reuses existing tables).
