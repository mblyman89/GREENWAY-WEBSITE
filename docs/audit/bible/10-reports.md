# Bible Chapter 10 — Reports & Day Close (Dashboards, X/Z Reports, Tax Filings, Exports)

> **Audience:** the owner (novice) and any future auditor (human or AI).
> **Verified against:** main @ `9f472a17` (every file:line anchor re-checked on
> that tree — if a line looks off, the file changed after this chapter was
> written; re-verify before trusting).
> **Plain-English promise of this chapter:** every number the owner sees —
> dashboard charts, the register's end-of-day slip, the monthly excise return —
> is computed from the same underlying rows, in cents, on Pacific time. The
> three filings that must reconcile to the dollar (LIQ-1295, CCRS Sale.csv, the
> WA tax report) share ONE canonical period basis so they can never disagree.
> And the end-of-day report is manager-gated because it reveals the exact
> number the blind drawer count is designed to hide.

---

## 1. The big idea in one paragraph

Reporting is split into three families that deliberately do NOT share one
definition of "a sale," because they answer different questions. **Dashboards**
(`src/lib/reports/sales.ts`, `cogs.ts`, `analytics.ts`, `operations.ts`) answer
"how is the business doing" — gross revenue over non-cancelled orders by
`placed_at`, grouped every way the owner asked for. **Filings**
(`src/lib/reports/wa-tax.ts`, `src/lib/compliance/excise-return*.ts`,
`ccrs-sales.ts`) answer "what do we owe the state" — COMPLETED orders bucketed
by `completed_at` on Pacific time, the canonical basis written down in
`docs/PERIOD_BASIS.md` so the LIQ-1295, the CCRS Sale.csv and the WA tax report
always reconcile. **The register's own day close** (X/Z report, Slice B22)
answers "does the drawer balance" — it sums only the server-verified
`pos_sale_events` ledger and is PIN-gated to managers because it reveals
expected drawer cash. Everything everywhere is minor units (cents) and
America/Los_Angeles.

---

## 2. The two foundations: Pacific time and the period basis

### 2a. Pacific time (`src/lib/reports/timezone.ts`, pure)

Every bucket boundary is anchored to `PACIFIC_TZ = "America/Los_Angeles"`
(`:19`) using `Intl.DateTimeFormat` — NOT a fixed offset, because Washington
observes DST and a fixed offset would drift twice a year (header `:8–13`). Key
helpers: `pacificParts` (`:43`), `pacificDayKey` (`:64`), `pacificMonthKey`
(`:70`), `pacificHour` (`:76`), `pacificWallTimeToUtcISO` (`:139` — converts a
Pacific calendar day's start/end to exact UTC instants), `pacificToday`
(`:178`), `addPacificDays` (`:186`). All pure, safe to import anywhere.

`src/lib/reports/range.ts` builds date ranges on top: `resolveRange` (`:121`)
turns the report pages' from/to/preset params into precise UTC boundaries for
Pacific calendar days (header promise: "'today' / 'this quarter' / 'last year'
always mean Pacific dates regardless of the server's zone"), with self-tests
(`:198`).

### 2b. The canonical period basis (S-8, `docs/PERIOD_BASIS.md`)

The decision, verbatim from the doc: **"tax and compliance filings are based on
COMPLETED orders, bucketed by `orders.completed_at`"** (Pacific bucketing,
`placed_at` fallback only for legacy completed orders predating the column).
Before S-8 the three filings disagreed — wa-tax counted never-picked-up online
orders and used `placed_at`. The doc's table names the three artifacts that
must reconcile: LIQ-1295 (excise-return.ts), CCRS Sale.csv (ccrs-sales.ts),
WA tax report (wa-tax.ts). `wa-tax.ts:241–260` shows the basis in code:
`.eq("status", "completed")` with completed_at bucketing.

**Deliberate asymmetry to know:** the DASHBOARD sales report
(`sales.ts:224–243`) still uses non-cancelled orders by `placed_at` — its
header (`:21–24`) says so explicitly ("matching the existing dashboard's
'gross' definition"). Dashboards measure demand; filings measure completed
taxable sales. Different questions, different bases, both documented.

---

## 3. The tax engine (`src/lib/reports/tax.ts`)

One shared engine so cart, reports, and filings can never drift:

- `TaxSettings` (`:44`): `exciseRateBps` 3700 = 37%, `stateSalesRateBps` 650,
  `localSalesRateBps` 280 (Port Orchard local), `medicalEndorsement`,
  `taxBaseMode`. `DEFAULT_TAX_SETTINGS` (`:53`) mirrors the cart's own
  constants from `order-pricing-core.ts` — the comment at `:54–55` names this
  the "single source of truth… so the client and server can never drift"
  (S-19/S-20).
- Pure math: `applyBps` (`:69`), `combinedSalesRateBps` (`:64`),
  `effectiveTaxRateBps` (`:78`), `backOutTaxInclusive` (`:96`),
  `normalizeTaxableBase` (`:112`), `detectTaxInclusive` (`:137`),
  `computeLineTax` (`:183`), `computeCartTax` (`:212`).
- Cannabis vs non-cannabis classification: `getCannabisCategorySet` (`:266`)
  reads the `tax_category_rules` table; `isCannabisCategory` (`:287`) applies
  it. Excise applies to cannabis lines only; sales tax to all retail.

---

## 4. Dashboards — the owner's business questions

All report pages sit behind the `reports.view` permission — enforced once in
the layout (`src/app/admin/reports/layout.tsx:16`).

- **Sales** (`sales.ts`, Slice 14): gross = Σ(unit price × qty) on
  non-cancelled orders; groupings by category/vendor/brand/product/hour/
  customer-type; discounts = regular − sold. Category and vendor labels come
  from the `menu_items` snapshot keyed by `source_item_id` =
  `order_lines.product_id` (header `:15–19`) so historical products still
  resolve. Busy ranges page past PostgREST's row cap via `pagedAll`
  (`:231–241`, S-7) — reports are complete, not truncated.
- **COGS** (`cogs.ts`): weighted-average unit cost per product from
  `inventory_lots.unit_cost_minor_units` (weighted by received_qty, falling
  back to simple average, then 0 — header), COGS = avgUnitCost × qty, gross
  profit and margin; groupings resolve labels the same way Sales does so tabs
  line up. Entry point `getCogsReport` (`:307`).
- **Operations** (`operations.ts`): `getLoyaltyReport` (`:103`),
  `getEmployeeReport` (`:396`), `getMedicalReport` (`:670`) — loyalty points
  flow, staffing productivity, and the medical program's numbers.
- **Analytics** (`analytics.ts`): `getOrdersReport` (`:78`),
  `getLoyaltyReport` (`:207`), `getInventoryHealthReport` (`:279` — reads the
  published menu version for stock diagnostics), `getPromotionsReport`
  (`:348`).
- **AI briefing** (`src/app/admin/reports/actions.ts:40`,
  `generateReportInsightsAction`): re-reads the same aggregates the tabs
  render and summarizes them in plain language. Gated on `reports.view`;
  "drafts-only spirit: it informs, it never changes anything" (comment
  `:32–33`). Degrades politely when no AI key is configured (`:45–50`).

---

## 5. Exports — one table spec, two formats

`src/lib/reports/workbook.ts` (Slice 47) renders a single "table spec" as
either a clean CSV or a styled `.xlsx` (bold frozen header, real currency cells
`$#,##0.00`, percent cells, banding, TOTALS row — the owner's ask, "very clean
tables of data," quoted in the header). Money arrives in cents; currency
columns divide by 100 at render. The master export route
(`src/app/admin/reports/export/route.ts`) builds the multi-sheet workbook (or
multi-section CSV) from the same specs the tabs render — the export can never
disagree with the screen.

**Sage 50 accounting exports** (`src/lib/accounting/sage-exports-core.ts`,
pure): Cash Receipts Journal, Purchases Journal (vendor invoices from accepted
manifests), Payments Journal, inventory adjustments as balanced General
Journal entries, and Vendor List — every field name/order/format taken from
the official Sage 50 import specs (citations in `docs/sage50-knowledge.md`),
verified against the owner's own real RECEIPTS_JOURNAL export. Uploads and
actions live under `src/app/admin/reports/accounting/` behind `reports.view`.

---

## 6. The register's day close — X/Z reports (Slice B22)

**Files:** `src/lib/pos/day-report-core.ts` (pure, 581 lines, self-tests
`:384`), `src/app/api/pos/day-report/route.ts`, `src/lib/pos/refunds-store.ts`.

### 6a. What X and Z mean

X = a mid-day snapshot (a drawer session is still open). Z = end of day (every
session for the business day is closed). `reportKind` (`core:242`) is the
whole rule: `Z` only when sessions exist and none are open; no data → X
(self-tests `:474–477`).

### 6b. Only verified facts are summed

`summarizeDayEvents` (`core:74`) walks this register's `pos_sale_events` for
the Pacific business day and sums ONLY `status = "processed"` sale payloads —
the totals the compliance gate recomputed and accepted at sync (Chapter 04).
Exceptions and pendings are COUNTED, never summed as money (`:89–97`). The
summary carries gross/subtotal/tax, medical sale count + savings, B33 cash
rounding (net adjustment — expected drawer cash = gross + rounding, since tax
was computed pre-rounding; `:49–55`), and audited no-sale opens.

### 6c. The manager gate — protecting the blind count

The route header (`route.ts:12–17`) states the reasoning: gross cash sales +
opening float − drops IS the expected drawer cash — exactly the number the
blind close hides from the cashier. So the request requires a manager/lead PIN
(`APPROVER_ROLES` `:48`, same role gate as /api/pos/approve): device auth →
register binding required (`:57–61`) → per-device throttle scope (`:68–69`) →
PIN format (`:78`) → `getEmployeeByPin` with failure noted (`:81–83`) → role
check with a plain-English refusal naming WHY (`:87–89`: "the day report
reveals expected drawer cash"). Over/short prints only from
manager-reconciled sessions — it is stored on the session by then; the report
never computes it early (`core:16–20`, `core:226` — only
`reconciled`/`verified` sessions contribute over/short).

### 6d. Refunds are store-wide, on purpose (AN-4)

`refundsForBusinessDay` (`refunds-store.ts:33`) is ONE query shared by the X/Z
slip and the back-office reconcile screen "so both print the same number"
(header `:4–6`). Two flows pay cash out and neither writes to
`pos_sale_events`: same-day voids (audit_logs `register.sale_voided`) and
counter returns (`customer_returns.refund_minor_units`). Neither carries
register attribution, so the number is STORE-WIDE — "callers must present it
as such, never as one register's number" (`:13–16`). Best-effort: a read
failure returns zeros, because "a slip without a refund section beats no slip."

### 6e. The audit trail and the slip

Every day-report request writes a `register.day_report` audit event with kind,
business day, sale count, gross and refund total (`route.ts:145–160`). The
response is DATA; the iPad builds the 576px Star slip client-side
(`buildDayReportSlipHtml`, `core:280`) and prints with the drawer kick OFF —
"a report never pops the drawer" (`route.ts:23–24`).

### 6f. The drawer lifecycle it reports on

From `src/lib/registers/store.ts` (traced in Chapter 01, recapped for
completeness): open with counted float (`openDrawer` `:120`), cash drops
(`recordDrop` `:165`), **blind close** (`closeDrawerBlind` `:192` — cashier
counts without seeing expected), manager reconcile (`reconcileDrawer` `:231` —
enters cash sales, computes expected = opening + cashSales − drops, reveals
over/short, `:243–255`), and next-morning `verifyTill` (`:268` — independent
recount by the morning manager).

---

## 7. The excise return — LIQ-1295 (Slice 32/55)

**Files:** `src/lib/compliance/excise-return-core.ts` (pure),
`excise-return.ts` (server + XLSX), `excise-draft.ts` (saved drafts),
page `src/app/admin/reports/excise/page.tsx`.

- The pure core (`excise-return-core.ts:1–28`) encodes the official form's box
  map (from the LIQ-1295 R 7.24 workbook): Box 1 = pretax cannabis sales,
  Box 2 = medical exemption (negative, valid 6/6/2024–6/30/2029), Box 3 =
  taxable, Box 4 = `EXCISE_RATE = 0.37` (`:74`), Box 5 = round(Box3 × 0.37),
  Boxes 6–10 for extra excise/penalty/credits/amount-to-pay.
  `computeExciseReturn` (`:90`), due date = the 20th of the following month
  with weekend roll-forward noted (`exciseDueDate` `:123`), `monthRange`
  (`:139`), self-tests (`:149`). Inputs in cents; the form wants dollars, so
  boxes come back as 2-dp dollars (`toDollars` `:77` / `round2` `:82`).
- The server side fills the OFFICIAL template file
  (`templates/LIQ-1295-template.xlsx`) cell-by-cell (E9 license, S20 Box 1,
  S21 Box 2 negative, etc. — header of `excise-return.ts`),
  via `computeExciseReturnForMonth` (`:93`) and `buildLiq1295Xlsx` (`:191`);
  batches are logged (`logExciseReturnBatch` `:234`). Owner-entered boxes
  (1/2/6/8/9 overrides) persist as drafts in `excise_return_drafts`
  (`excise-draft.ts` — `getExciseDraft` `:60`, `saveExciseDraft` `:103`,
  `resolveExciseReturn` `:170`).

## 8. The WA tax report (`wa-tax.ts`, Slice 16 + S-8)

Produces both filings' figures from one pass: 37% cannabis excise (CCRS calls
it "OtherTax") and combined retail sales tax (6.50% state + 2.80% Port Orchard
= 9.30%) for the DOR return. Basis: completed orders by `completed_at`,
Pacific months (`:241–260`), classified cannabis/non-cannabis via the
menu_items snapshot + `tax_category_rules`, computed with the shared engine.
**S-8 medical exemptions:** lines covered by a WAC 314-55-090(2)
`medical_exempt_sales` record report their exempted tax as ZERO with the
exempted amounts broken out separately (`:302–316`) — the same records that
feed LIQ-1295 Box 2 (Chapter 03), so the two filings agree by construction.

---

## 9. Findings that live in this chapter

No new findings. Three deliberate postures to restate for future auditors:

1. **Dashboards and filings use different bases on purpose** (§2b). Anyone
   "fixing" `sales.ts` to match `wa-tax.ts` (or vice versa) would be breaking
   a documented decision — `docs/PERIOD_BASIS.md` is the authority.
2. **The X/Z report never computes over/short early.** It only prints
   over/short already revealed by a manager reconcile (`core:226`). Moving
   that computation into the slip would quietly defeat the blind count.
3. **Refund totals on the slip are store-wide** because voids and counter
   returns carry no register attribution (AN-4). Presenting them as one
   register's number would be wrong — the shared query exists precisely so
   the slip and the back office can never print different numbers.

Cross-reference: GW-009 (Chapter 03) is the UTC-vs-Pacific day bug family —
notable here because the REPORTING suite is where the Pacific discipline is
done correctly (`timezone.ts` everywhere); the four GW-009 sites are outside
this module and should be fixed to match it.

---

## 10. What SHOULD never happen (watchlist)

1. **A filing computed off `placed_at` or non-completed orders.** The S-8
   basis is completed + `completed_at`; LIQ-1295, CCRS Sale.csv and wa-tax
   must never drift from it or from each other.
2. **A date bucket computed in UTC.** Every day/month/hour key must go through
   `timezone.ts`; a raw `toISOString().slice(0,10)` in report code is the
   GW-009 bug family reappearing.
3. **Tax rates defined twice.** `DEFAULT_TAX_SETTINGS` mirrors the cart's
   constants (S-19/S-20); a second hardcoded 37%/9.3% anywhere is drift
   waiting to happen.
4. **A day report without a manager PIN.** The route's role gate is the blind
   count's bodyguard; any new endpoint exposing expected drawer cash needs the
   same gate.
5. **Exception or pending events summed as money.** `summarizeDayEvents`
   counts them but only sums processed sales; a slip that includes exception
   money is lying.
6. **Over/short computed anywhere but manager reconcile.**
   `reconcileDrawer` is the single reveal point; the X/Z slip only echoes
   stored values from reconciled/verified sessions.
7. **A day-report response that pops the drawer.** Slips print with drawer
   kick OFF, always.
8. **A truncated report.** Busy ranges must page (`pagedAll`); a report
   silently capped at PostgREST's row limit under-reports revenue and tax.
9. **Medical exemptions counted in one filing but not the other.** Box 2 of
   LIQ-1295 and wa-tax's exempt figures come from the same
   `medical_exempt_sales` records; a divergence means one side changed alone.
10. **An export that disagrees with its screen.** CSV/XLSX render from the
    same table specs as the tabs; a hand-rolled second query for an export
    reintroduces the drift the workbook helper exists to prevent.
11. **Money in dollars inside the engines.** Cents in, cents through;
    dollars appear only at the last render step (workbook currency cells,
    LIQ-1295 boxes).
12. **A refund figure attributed to a single register.** AN-4's store-wide
    caveat must survive any UI change.

---

*Chapter status: DRAFTED at main `9f472a17`. No new findings — three
deliberate postures documented in §9 for future auditors.*
