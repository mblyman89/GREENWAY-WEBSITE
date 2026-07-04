# Cash Management page overhaul — plan & research

**Task (owner, verbatim):** "now lets overhaul the registers and tills page. I am not sure what this page is or for, so I think we should go back to the internet to gather definitive authoritative resources and documentation about pos software, not necessarily cannabis pos, but the best pos systems, so we can properly transform it into what it is meant to be. please rename it to be an industry standard page name. please proceed, follow the standing rules and never guess."

Standing rules honored: grounded in file tree first; deep research from authoritative sources; money in minor units; no schema changes without owner-applied idempotent migration; AI output = draft.

## 1. What the page IS today (grounded in code + migration 0038)

Route `/admin/registers` (+ `/admin/registers/history`). Nav label **"Registers & Drawers"** (group "Sell", permission `orders.manage`).

It is a **cash-drawer management / reconciliation** tool for Greenway's physical registers:
- 3 registers seeded by migration 0038: `Sales Register 1`, `Sales Register 2` (kind `sales`), `Manager Till` (kind `manager_till`).
- Lifecycle per drawer session (table `drawer_sessions`, status `open → closed → reconciled → verified`):
  1. **Count-in / open** — employee counts the starting float by denomination (`drawer_counts` count_type `open`).
  2. **Cash drops** — mid-shift drops to the safe (`drawer_drops`, windows afternoon/night/other; owner runs 4 drops/day).
  3. **Blind count-out / close** — employee counts drawer WITHOUT seeing expected (`drawer_counts` count_type `close`).
  4. **Reconcile (manager)** — manager enters cash sales; system computes expected = opening + cash sales − drops, reveals **over/short** (`over_short_minor`).
  5. **Verify (manager till)** — next-morning manager independently recounts & validates (`till_verifications`).
- Denomination counting to the penny (pennies…hundreds). All money in cents.
- Audit logged (`recordAudit`): drawer.opened / drawer.drop / drawer.closed_blind / drawer.reconciled / till.verified.
- RLS staff-only. Stores return `[]`/`null` when Supabase unconfigured (graceful).

Files:
- `src/app/admin/registers/page.tsx` — live registers grid + open/drop/close forms + manager reconcile/verify block.
- `src/app/admin/registers/history/page.tsx` — recent sessions table with over/short.
- `src/app/admin/registers/actions.ts` — server actions (open/drop/close/reconcile/verify).
- `src/lib/registers/store.ts` — DB lifecycle.
- `src/lib/registers/cash.ts` — PURE cash math (denoms, expectedClose, overShort, formatCents).
- `src/components/admin/registers/DenomFields.tsx` — denomination input grid.

## 2. Research — how leading POS systems name & structure this

Authoritative sources (accessed for this task):
- **Square** — "Start and end a cash drawer session" & "Set up cash management" (squareup.com/help). The feature area is **Cash Management**; a working period is a **cash drawer session** (Start Drawer → Pay In/Out → End Drawer); reporting is the **Cash drawer report**. Concepts: *starting cash, cash sales, cash refunds, cash paid in/out, expected cash amount*.
- **Toast** — "Use Cash Drawers" (support.toasttab.com). Main POS menu section is **Cash Management**; sub-page **Cash Drawers**. States **Open/Active/Paused/Closed**; per-drawer info: *expected balance, starting balance, actual close out cash, cash overage/shortage*; actions *Add Cash / Remove Cash (Cash out, Payout, Tip Out, Cash Drop), No Sale, Count bills (by denomination), Create Deposit*; reporting **Cash Drawer Report / History**; business-day cutoff auto-close.
- **Lightspeed** — "How to Balance a Cash Register Drawer like a Pro" (lightspeedhq.com/blog). Best practices: **one person per drawer** (accountability), **count starting cash each morning**, **count by denomination**, **deposit cash throughout the day**, **two-step verification** for large counts, **overage vs shortage** definitions, **regular audits**, **written over/short tolerance policy**.

**Convergent industry vocabulary → Greenway mapping (already implemented):**
| Industry term (Square/Toast/Lightspeed) | Greenway code today |
| --- | --- |
| Cash Management (feature area) | the page itself (currently "Registers & Drawers") |
| Cash drawer session / Open drawer / Starting cash | `drawer_sessions`, `openDrawer`, `opening_count_minor` |
| Count by denomination | `drawer_counts`, `DenomFields`, `cash.ts` |
| Cash drop / Paid out / Remove cash | `drawer_drops`, `recordDrop` |
| Blind close / End drawer / Actual close out cash | `closeDrawerBlind`, `closing_count_minor` |
| Expected cash / Reconcile | `expectedClose`, `reconcileDrawer`, `expected_close_minor` |
| Overage / Shortage (over-short) | `overShort`, `over_short_minor`, `overShortLabel` |
| Two-step verification | `verifyTill`, `till_verifications` (manager till) |
| Cash Drawer Report / History | `/admin/registers/history` |

**Conclusion:** Greenway's backend already matches POS best practice one-to-one. The gap is purely **naming + page organization/clarity**, not capability. Do NOT rebuild the engine.

## 3. Decision: industry-standard name + structure

**Name → "Cash Management"** (the universal term; Square + Toast both use it). Nav label: **"Cash Management"**. Keep the URL working; the sub-view of live drawers is the "Cash Drawers" area of the page.

Rename plan:
- **Nav:** "Registers & Drawers" → **"Cash Management"** (keep icon 💵, permission `orders.manage`, group "Sell").
- **Route:** keep `/admin/registers` as the canonical path (avoids breaking bookmarks/links/audit and needs no redirect infra), but retitle the page to **"Cash Management"**. (A route rename to `/admin/cash-management` would ripple through `revalidatePath`, redirects, and every internal link — higher risk for no functional gain. If the owner wants the URL changed too, that's a clean follow-up.)
- **Page title:** `Cash Management` / subtitle explaining daily cash lifecycle.
- **Terminology on-screen:** adopt the standard words — *Starting cash* (was "opening float"), *Cash drop*, *Expected in drawer*, *Counted*, *Over/Short (overage/shortage)*, *Verify*.

**Page structure (one clean, sectioned page, top → bottom):**
1. **Header** — "Cash Management" + subtitle + primary action to History (renamed "Cash drawer reports").
2. **Today at a glance** — StatCards: Open drawers · Registers · Cash in drawers now (sum of open sessions' running cash) · Awaiting reconcile · Net over/short today.
3. **Needs attention** — closed sessions awaiting reconcile/verify (actionable; only shown when non-empty). Managers act here (reconcile + verify).
4. **Cash drawers** — the live grid: each register card with clearer status, Starting cash, dropped-so-far, and open/drop/blind-close forms. Keep blind-count integrity (never reveal expected to the counter).
5. **Help** — restated in standard POS language so any trained cashier recognizes it.

## 4. Scope guardrails

## 4. Scope guardrails

- Prefer NO schema changes (all data exists). If a migration is truly needed, propose an idempotent one for the owner to apply manually.
- Keep the store + cash math + actions (well-built, blind-count integrity). Reorganize the PAGE and RENAME the nav/route sensibly.
- Reuse the admin design system (AdminPageHeader, Section, Card, StatCard, Badge, Button, HelpPanel, EmptyState).
- AI output = draft for owner review.

## 5. Implementation status — DONE

Delivered on branch `feat/cash-management-page`:

- **Renamed to the industry-standard "Cash Management"** everywhere: nav (`admin-nav-data.ts`), mobile nav (`mobile-core.ts`), admin dashboard card (`app/admin/page.tsx`), page title + breadcrumbs, and help content (`help-content.ts`). Route kept at `/admin/registers` (no breakage; a URL rename can be a clean follow-up if desired).
- **Rebuilt `app/admin/registers/page.tsx`** into a clean, sectioned page using the design system (`Section`, `Card`, `StatCard`, `Badge`, `Button`, `HelpPanel`, `EmptyState`): header + "Cash drawer reports" action → **Today at a glance** (5 stats: open drawers / starting cash open / dropped to safe / awaiting reconcile / net over-short today) → **Needs attention** (manager reconcile + verify, only when non-empty) → **Cash drawers** live grid. Adopted standard terminology (Starting cash, Cash drop, Over/Short, Verify). Preserved blind-count integrity (expected total never shown to the counter).
- **`store.ts`** — added `cashDrawerSummary()` (server-side, keeps page render pure; computes open counts, starting cash, drops, awaiting-reconcile, and net over/short for today's Pacific business day).
- **`history/page.tsx`** — retitled to "Cash drawer reports" with matching breadcrumbs; "Back to Cash Management".

Verification: `tsc --noEmit` clean · `eslint` clean on all changed files · full `next build` compiled successfully (both routes present). No schema changes; degrades gracefully when Supabase unconfigured. The store, cash math, actions, and blind-count workflow were kept intact (they already match POS best practice).
