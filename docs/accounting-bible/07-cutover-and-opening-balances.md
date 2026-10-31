# ACCOUNTING BIBLE — 07 · CUT-OVER AND OPENING BALANCES (URGENT)

> Today is **Sat 2026-10-31**, the last Cultivera day. The cut-over is **Sun 2026-11-01** before
> the 08:00 open. The shelf count was **Fri 10/30** after the close. The opening-balance date is
> **2026-10-31** (cutover-core.ts:73, `gl_conversion_config` via 0186).
>
> **The one sentence that matters:** the store's *operations* cut over tomorrow and are well
> prepared. The *books* cannot receive an opening balance tomorrow, because the path does not
> exist (D-47, D-48). That is fine **if and only if the evidence is captured perfectly before the
> first sale**. Every poster is idempotent on `sourceRef`, so everything can be back-filled later,
> **except a moment in time nobody photographed.**
>
> I write nothing to production. Every SQL statement in this part is **for Michael to run, or for a
> future slice to wrap in an action**. Read-only statements are marked READ-ONLY.


> ⚠ **SUPERSEDED DATES (2026-10-31, OD-22/OD-24).** The books now go live **2027-01-01**, with an OB date of **2026-12-31**; Sage 50 is the book of record through 2026. The 11/01 *store* runbook steps (evidence capture, lot snapshot) remain useful as records. The *books* steps here (periods, OB, backfill, Nov–Dec parallel) are replaced by part 15 blocks A and I (I-01 rehearsal wipe + date flip, I-02 Sage TB import, I-03 count-valued inventory, I-05 bless). Read this part as mechanics reference only.
---

## 7.1 Timeline: what happens, and what the books need from each step

| When (Pacific) | Operational step (CUTOVER_WEEKEND_ONE_PAGE.md) | What the books need | Who | Status |
|---|---|---|---|---|
| Fri 10/30 after close | Shelf count into per-counter workbooks | The **workbook files** are the primary evidence (`evidence_kind = inventory_count`). Keep them unaltered. | Michael | Done (per plan) |
| Sat 10/31 | Sell on Cultivera; rehearsal #4 in Test mode | Cultivera's 10/31 **sales report** and **Z/close-out** are the evidence that converts the 10/30 count into a 10/31 balance. Keep a PDF/CSV. | Michael | Today |
| Sat 10/31 close | Sage: last entries | **Sage trial balance as of 10/31** (evidence_kind `sage_trial_balance`) for every entity. This unblocks D-47. | Michael | **Ask (Q-02)** |
| Sat 10/31 close | Bank | Bank balances as of 10/31 for 10200 operating, ATM account, any others: the **statement or a dated screenshot** (`bank_statement`) | Michael | **Ask** |
| Sat 10/31 close | Vault/tills/ATM cassettes | Physical cash count of 10100 vault, 10110 tills, 10300 ATM vault, signed with date and time | Michael | **Ask** |
| Sun 11/01 06:00-06:40 | Fetch, GO/NO-GO, stage (Test OFF), publish, units balance | `pos_imports` row (not test) is the lineage of every lot | app | planned |
| Sun 11/01 06:50 | Upload count workbooks and apply | `applyCountPlan` writes `inventory_adjustments` + sets `on_hand_qty`; the 10/31 Cultivera sales are rolled off (`a.rolled`, cultivera-count-store.ts:~298) | app | planned |
| **Sun 11/01 07:30-07:59** | "Nothing waiting, menu and register checked" | **SNAPSHOT THE LOTS NOW (§7.2).** This is the only moment when on-hand × cost = the 10/31 closing inventory. After the first sale, it must be reconstructed. | Michael | **ADD TO ONE-PAGER** |
| Sun 11/01 08:00 | Open | Sales begin posting drafts (N-03). Drawer/deposit entries are refused (N-01). Possibly no periods (N-02). **None of that loses data.** | — | known |
| Nov 1 – Dec 31 | Parallel run with Sage (`PARALLEL_RUN_*` cutover-core.ts:76-77) | Monthly comparison via `reconcileParallelRun` (cutover-core.ts:497); retirement gate `canRetireLegacySystem` (:598) | slices | S-09 |

---

## 7.2 The snapshot (the one thing that cannot be done later)

### Why

- `inventory_lots.on_hand_qty` changes with every sale from 08:00.
- `unit_cost_minor_units` can change through enrichment (0215 provenance `unit_cost_source ∈ {pos_import, invoice, owner_entered}`).
- Reconstruction later is possible in principle: on-hand now + units sold since + adjustments since. But it depends on every decrement being recorded, and the D-65 / drift work shows that is exactly what is being verified in the first week. **A snapshot is cheap and final.**

### What

The statement below is **READ-ONLY**: it returns rows and changes nothing. Run it in the Supabase SQL editor at about 07:30 on 11/01, after "Applied, with nothing refused". Download the result as CSV. Store the CSV and its SHA-256 next to the count workbooks.

```sql
-- READ-ONLY. Opening inventory snapshot, intended for 2026-11-01 ~07:30 PT, before the first sale.
select l.id                        as lot_id,
       l.lot_code,
       l.product_name,
       l.category,
       l.on_hand_qty,
       l.unit,
       l.unit_cost_minor_units,
       l.unit_cost_source,
       l.is_sample,
       l.status,
       l.updated_at,
       now()                       as snapshot_at
from public.inventory_lots l
where l.on_hand_qty <> 0
order by l.category, l.product_name, l.lot_code;
```

And the totals, so the number is on paper the same morning (also READ-ONLY):

```sql
select l.category,
       count(*)                                                   as lots,
       sum(l.on_hand_qty)                                         as units,
       sum(l.on_hand_qty * l.unit_cost_minor_units)               as value_cents,
       count(*) filter (where l.unit_cost_minor_units is null)    as lots_without_cost,
       count(*) filter (where l.on_hand_qty <> trunc(l.on_hand_qty)) as fractional_qty_lots
from public.inventory_lots l
where l.on_hand_qty <> 0
group by rollup (l.category)
order by l.category nulls last;
```

### Notes for whoever turns this into code (S-06)

- `on_hand_qty` is `numeric` (0023:102). `extendLotCents` refuses fractional quantities (cutover-inventory-core.ts:265 comment: "Fractional quantities are REFUSED upstream"). Lots tracked in grams (`unit` = 'g') **will be refused**. Count them in `fractional_qty_lots` and decide per Q-03.
- `is_sample` lots: are samples inventory at cost? They were bought (or received free at $0). A $0 cost lot is dropped by the builder as `zero_or_negative_cost` and **named**. That is correct: nothing is invented.
- Test imports: `pos_imports.is_test` (0066:27). The runbook stages the real import with Test mode OFF and runs Clean Slate after rehearsals, so test lots should not exist. **The S-06 action must still assert it** by joining lineage, or refuse.
- Category → account: `cutoverAccountForSlug` (cutover-inventory-core.ts:221) needs a **slug**. `inventory_lots.category` is free text (D-64). The caller resolves slugs via the ledger's own map (`ledger-category-map-core`, D-50 decided). **Never** call the builder with an unresolved category. It refuses (null slug), which is correct.

---

## 7.3 Periods (N-02): check, then fix if needed

**Check (READ-ONLY):**

```sql
select e.code, count(p.*) as periods,
       min(p.start_date) as first, max(p.end_date) as last,
       count(*) filter (where p.status = 'open') as open_periods,
       bool_or(date '2026-11-01' between p.start_date and p.end_date and p.status = 'open') as nov_open
from public.gl_entities e
left join public.gl_periods p on p.entity_id = e.id
group by e.code order by e.code;
```

**If any entity shows 0 periods** (the factory reset deletes them; 0209:556), the fix is the same seed 0175 used: a plain idempotent INSERT, because `gl_open_fiscal_year` refuses in the SQL editor (`auth.uid()` is null, so the guard fails; 0175:556-565 explains this. 0185 later re-gated it from `is_admin()` to `is_owner()`, which changes nothing here). Michael runs this; I do not:

```sql
-- WRITES. Idempotent (ON CONFLICT DO NOTHING). Mirrors 0175:567-576 exactly.
insert into public.gl_periods (entity_id, fiscal_year, period_no, start_date, end_date)
select e.id, y.n, m.n,
       make_date(y.n, m.n, 1),
       (make_date(y.n, m.n, 1) + interval '1 month - 1 day')::date
from public.gl_entities e
cross join unnest(array[2026, 2027, 2028, 2029, 2030]) as y(n)
cross join generate_series(1, 12) as m(n)
on conflict (entity_id, fiscal_year, period_no) do nothing;
```

The permanent fix is slice S-02: the factory reset reseeds periods in the same transaction, and the books home shows "periods exist for today" as a readiness light.

---

## 7.4 The opening-balance journal, by entity

### Mechanics (verified in 0176 / 0172 / 0186)

1. **Stage rows** in `gl_opening_balances`:
   - one row per (entity, account)
   - `amount_cents <> 0` (signed: debit positive, credit negative)
   - `evidence_kind` from the enum (0176:66-78)
   - `evidence_ref` ≥ 3 chars
   - optional `evidence_note` / `assumption_note`
2. **Row guards:** `gl_ob_validate_row` (0176:194) refuses unknown or inactive accounts, accounts with children (`GL_OB_PARENT_ACCOUNT`, :211-213), non-balance-sheet accounts and entities not allowed on the account.
3. **Readiness:** `gl_opening_balance_summary` (called by ledger-store.ts:331) shows debits, credits and the 40400 plug that blessing would create (0176:300-328).
4. **Bless:** `gl_bless_opening_balances(p_entity_code, p_memo)` (0176:348).
   - admin only
   - refuses an empty worksheet
   - builds lines from staged rows
   - adds the 40400 plug for any difference (with `assumption_note`, :452, :474-476)
   - submits ONE journal with `source_kind = 'opening_balance'`, `source_ref = 'opening-balance:<entity>'`, `p_auto_post = false`, dated `gl_opening_balance_date()` (0186 rewrite)
   - marks rows `posted` with the journal id (:485)
   - **Idempotent:** a second bless returns the first journal (0174 idempotency; `GL_POST_CONFLICT` if the lines differ, 0174:~416).
5. **Approve + post:** through the drafts queue (`approveAndPostJournal`, approval-service.ts:371).
   - `opening_balance` is **not** approval-exempt (APPROVAL_EXEMPT_SOURCE_KINDS approval-core.ts:90-95).
   - It is ≫ $5,000, so `needs_second_approver` is true. Self-approval is allowed by 0211, plus the 0177 opening_balance branch.
   - **Period check is skipped** for opening_balance (0172:780-782), so N-02 does not block the OB.
   - Date 2026-10-31 satisfies the line-in-the-sand CHECK's first arm (0186:42-48).
6. **Frozen:** once posted, rows cannot be edited or deleted (`gl_ob_guard_frozen` 0176:162-185). Corrections are by reversing journal.
7. **OBE close:** `gl_close_opening_balance_equity` (0176:514) moves whatever remains in 40400 to 40300 as its own draft (`obe-close:<entity>`).
   - **Only run when every balance-sheet line is in.** Inventory alone is a legitimate credit to 40400 that the Sage equity accounts must eventually offset.

### Problem: the inventory journal and the worksheet journal collide

- `buildCutoverInventoryPlan` (cutover-inventory-core.ts:346) returns a line set: per-category Dr 200xx and one Cr 40400 (:129-131), `evidenceKind: "inventory_count"` (:152).
- The worksheet bless creates **one** `opening-balance:<entity>` journal from **all** staged rows.
- So there are two designs:
  - **(A) Inventory rows go INTO the worksheet.** One staged row per category account (21 max), `evidence_kind = 'inventory_count'`, `evidence_ref = 'count-2026-10-30+rolloff-2026-10-31 sha256:<…>'`. The 40400 side is **not** staged: the bless computes it as the plug. Problem: the plug's `assumption_note` then says "difference plugged", which reads like an error (N-06). The S-07 screen must explain that the inventory credit is *expected* in 40400.
  - **(B) A separate journal** `cutover-inventory:greenway` submitted directly with `source_kind = 'opening_balance'` and its own explicit Cr 40400 line, outside the worksheet. Problem: the worksheet's readiness view would not see inventory, and `reviewOpeningBalances` (cutover-core.ts:279) would warn "no inventory" (and see N-13: it looks for the wrong code anyway).
- **Recommendation: (A).** One opening balance journal per entity is what an auditor expects and what 0176 was designed for. Its own header says the worksheet "was designed to accept exactly this row" (D-48 text, DEFECTS.md:~2160). The builder's per-category lines become worksheet rows; its 40400 line is used only as a **cross-check** (it must equal the inventory share of the plug). **Q-04 confirms.**

### Greenway (S-corp): expected rows

| Account(s) | Evidence kind | Source document | Status |
|---|---|---|---|
| 10100 vault, 10110 tills | other (signed cash count) | 10/31 close count | Ask |
| 10200 operating bank | bank_statement | October statement (ending 10/31) | Ask |
| 10400 undeposited | other | any cash counted but not yet deposited | Ask |
| 12100 employee advances | other | supply-run ledger | Probably 0 |
| 12200 prepaid | other / legal_document | insurance, licences | Ask |
| 200xx inventory by category | inventory_count | §7.2 snapshot + workbooks | **Tomorrow 07:30** |
| 21100–21800 fixed assets (cost), 21900 accumulated depreciation (contra, credit) | fixed_asset_schedule | Sage FA list or the last 1120-S Form 4562; accounts from 0178 (`FIXED_ASSET_ACCOUNTS` fixed-assets-core.ts:684-695). 21000 is a parent and is refused | Ask (Q-02) |
| 30000 AP | ap_aging | unpaid vendor invoices at 10/31 | Ask |
| 31xxx payroll liabilities | payroll_report | last payroll register + 941 deposits | Ask |
| 32000 excise payable | tax_notice | LCB October excise (due 11/20) | Computed from Cultivera October sales |
| 32100 sales tax, 32200 B&O | tax_notice | DOR October return (due 11/25) | same |
| 33000 cards | bank_statement | card statements | Ask |
| 34000 loans | loan_statement | | Ask |
| 36000 due to/from | other | must net to zero against atm/landholding | Ask |
| 40100 common stock, 40200 APIC, 40300 RE, 41000 distributions, 41100 contributions (40000 is a parent) | sage_trial_balance / k1_or_return | Sage TB + 2025 1120-S Schedule L / M-2 | Ask (Q-02) |

### ATM entity, landholding, personal

- **ATM:** 10300 ATM vault cash (custody, D-57), its own bank account, 36000 against greenway, and its equity. The measured circuit numbers (related-party-loan-core.ts:190-199) are **analysis**, not opening balances.
- **Landholding:** 21100 land (not depreciable), 21300 building, 21900 accumulated depreciation, 34000 mortgage. YTD rental income (52000) is not a balance-sheet item. Check `allowed_entity_codes` on each 21xxx account in 0178 before staging; `gl_ob_validate_row` refuses an entity not allowed.
- **Personal:** only if Michael wants the personal books live on day 1 (Q-02b).

### Year-to-date P&L: the trap

The OB is a **balance sheet**. Jan 1 – Oct 31 2026 income and expense live in Sage. For the **2026 tax returns** the year is split:

- **Jan–Oct** comes from Sage.
- **Nov–Dec** comes from this ledger.

Two consequences:

1. The OB must put Jan–Oct net income **into equity**. Do not load YTD revenue/expense accounts: 0176 refuses non-balance-sheet accounts anyway (`gl_ob_validate_row`). In practice 40300 RE gets the prior-years figure and the current-year income lands in 40400 until the close (or a dedicated current-year-earnings line). **This is the hardest accounting decision of the cut-over and it is Michael's/his CPA's: Q-02c.**
2. The 1120-S / K-1 / 7203 for 2026 (S-27) must **combine** Sage Jan–Oct with this ledger's Nov–Dec. Write that combination as a deliberate import (a "prior-system YTD" table with evidence), never by loading Sage P&L into the GL.

---

## 7.5 The backfill strategy (what happens to Nov 1 activity before the doors are fixed)

| Stream | What happens from 08:00 on 11/01 | Backfill when the slice lands | Safety |
|---|---|---|---|
| Sales (revenue + COGS) | 2 drafts per order (N-03). Medical lines over-accrue (N-09). | If Q-07 = daily summary: **delete nothing**. Reject/void the per-order drafts (they are drafts, no journal_no) and post `pos-day:<date>` summaries rebuilt from orders. If per-order is kept: bulk post. | Drafts never touched the trial balance (D-66: only posted counts). |
| Drawer close / seal bag / deposit / supply run | Refused (N-01), recorded in audit; till ops unaffected | After S-01, a one-off "re-post" action iterates closed drawers / sealed bags / deposits since 11/01 and calls the same services. Idempotent on sourceRef. | `registers/actions.ts:250` already records the outcome without blocking. |
| Vendor bills, receipts, bank expenses | Drafts → approve as normal | none | — |
| Payroll | Draft only by design | none | — |
| Periods (N-02) | If missing: every **post** fails `GL_NO_PERIOD`; drafts still accumulate | Run §7.3 insert, then post | Drafts are harmless |

**Rule for the backfill action (S-01b):**

- It reads sources, never derived GL data.
- It posts through the same service as the live path.
- It is idempotent on sourceRef.
- It prints a count of posted / already-there / refused per stream.

No special "backfill" journal kind.

---

## 7.6 Parallel run and Sage retirement

- `reconcileParallelRun` (cutover-core.ts:497) compares account balances between Sage and this ledger for a month. `canRetireLegacySystem` (:598) gates retirement.
- `/admin/books/conversion/page.tsx` imports `reviewOpeningBalances` (:49, :145) and describes `canRetireLegacySystem` (:16). It is a **read-only** page by design (D-48 quotes its header).
- **Deliverables per month (S-09):**
  1. Sage TB export, saved with SHA-256.
  2. This ledger's TB (`gl_trial_balance_check`, ledger-store.ts:97).
  3. An account map Sage → 0173 codes (the D-41 UPDATE discusses Sage's `41000-GRNWY` "Equity-gets closed" naming).
  4. A comparison report.
  5. Michael's sign-off.
- Retire Sage after December reconciles **and** the 2026 return combination plan (§7.4) is agreed.

---

## 7.7 Finding N-13: `EXPECTED_OPENING_ACCOUNTS` names the wrong accounts (MEDIUM, on the conversion screen today)

- cutover-core.ts:247-265 expects:
  - `10100` labelled "the operating bank account"
  - `12100` labelled "inventory"
- The chart of accounts (0173:436, :442, :457, :470):

  | Code | Name |
  |---|---|
  | 10100 | Cash on Hand — Vault |
  | 10200 | Bank — Operating |
  | 12100 | Employee Advances Receivable |
  | 20000 | Inventory — Cannabis (control), parent of the per-category accounts |
- `reviewOpeningBalances` (:356-369) emits `CUT_MISSING_<code>` warnings from this list, and the conversion page renders them (page.tsx:145).
- **Effect:**
  - The screen warns "no opening balance for inventory (12100)" when inventory **is** staged (in 200xx).
  - It **stays silent** when the bank (10200) is missing.
  - Being a warning, it blocks nothing, but it teaches the wrong account at the worst moment.
- **Fix (S-07a):**
  - 10200 "the operating bank account".
  - Inventory becomes a **prefix rule**: any staged code whose parent is 20000. That needs a small shape change (`codePrefix` or `parentCode`), since the inventory OB lands on children only (0176:211-213 refuses the parent).
  - Add a test that every `EXPECTED_OPENING_ACCOUNTS` code exists in the 0173 seed with the label's meaning. That test is the one that would have caught this.

---

## 7.8 Addition proposed for the cut-over one-pager (needs Michael's OK; generated file)

CUTOVER_WEEKEND_ONE_PAGE.md is **generated** from `src/lib/pos/cutover-weekend-core.ts` (`renderWeekendMarkdown`, header line 3). Edit the core, never the markdown. Proposed rows (slice S-06a, after approval):

| Time | Step | Check |
|---|---|---|
| Sat 10/31 after close | **Books evidence.** Save Cultivera's 10/31 sales report, Sage trial balance at 10/31 for each entity, bank balances at 10/31, and a signed vault/till/ATM cash count. One folder, nothing edited. | Five files in the folder. |
| Sun 11/01 07:30 | **Opening inventory snapshot.** Run the read-only lot snapshot (bible part 07 §7.2), download CSV, write the total on the count sheet. | Total value at cost written down before 08:00. |
| Sun 11/01 07:40 | **Periods check.** Run the read-only periods query (§7.3). If any set of books shows 0, run the insert. | Every set of books shows November open. |

**Status today (10/31):** this addition is not in the generated one-pager. The read-only queries above can be run by hand regardless. **Telling Michael this is the first thing in the completion message.**
