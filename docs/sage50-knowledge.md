# Sage 50 Quantum — Grounded Knowledge Base (verified)

> This file is the **source of truth** for the in-app Sage 50 AI helper. Every fact
> here is taken from official Sage 50 documentation (URLs cited) so the AI chat can
> answer accurately and never guess. When a question falls outside this pack, the
> assistant is instructed to say so rather than invent an answer.
>
> Sources (verified this build):
> - General Journal Import/Export fields:
>   https://help-sage50.na.sage.com/en-us/2019/Content/Importing_Exporting/Import_Export_Fields/IEFIELDS_General_Journal.htm
> - Import Data into Sage 50 (procedure):
>   https://help-sage50.na.sage.com/en-us/2019/Content/Importing_Exporting/Import_Data_into_Sage50.htm
> - Cash Receipts Journal fields:
>   https://help-sage50.na.sage.com/en-us/2022/Content/Importing_Exporting/Import_Export_Fields/Import_Export_Fields_Cash_Receipts_Journal.htm
> - Payments Journal fields:
>   https://help-sage50.na.sage.com/en-us/2019/Content/Importing_Exporting/Import_Export_Fields/IEFIELDS_Cash_Disbursements_Journal.htm
> - Purchases Journal fields:
>   https://help-sage50.na.sage.com/en-us/2019/Content/Importing_Exporting/Import_Export_Fields/IEFIELDS_Purchase_Journal.htm
> - Inventory Adjustments Journal fields:
>   https://help-sage50.na.sage.com/en-us/2019/Content/Importing_Exporting/Import_Export_Fields/IEFIELDS_Inventory_Adjustments_Journal.htm
> - Payroll Journal fields:
>   https://help-sage50.na.sage.com/en-us/2019/Content/Importing_Exporting/Import_Export_Fields/IEFIELDS_Payroll_Journal.htm
> - Import/Export Tips (incl. authoritative import ORDER):
>   https://help-sage50.na.sage.com/en-us/2019/Content/Importing_Exporting/IEFIELDS_General_Import_Export_Field_Tips.htm
> - Account Reconciliation:
>   https://help-sage50.na.sage.com/en-us/2024/Content/Banking_General_Ledger/Account_Reconciliation/Account_Reconciliation.htm
> - Close Fiscal Year (Year-End Wizard):
>   https://help-sage50.na.sage.com/en-us/2019/Content/Company_Maintenance/Close_Fiscal_Year.htm
> - About Bank Feeds (US):
>   https://help-sage50.na.sage.com/en-us/2024/Content/ConnectedServices/BankingService/About_Bank_Feeds.htm
> - Set Up Bank Feeds:
>   https://help-sage50.na.sage.com/en-us/2024/Content/ConnectedServices/BankingService/Connect_Bank_Feeds.htm
> - How to reconcile using Bank Feeds (Sage KB 225924450087415):
>   https://us-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=225924450087415
> - Item Class (all inventory classes, incl. Master/Substock/Serialized):
>   https://help-sage50.na.sage.com/en-us/2019/Content/Inventory/ItemClass.htm
> - Set Up Master Stock and Substock Items:
>   https://help-sage50.na.sage.com/en-us/2022/Content/Inventory/Set_Up_Master_Stock_and_Substock_Items.htm
> - General tab, Maintain Inventory Items (item G/L accounts, costing methods):
>   https://help-sage50.na.sage.com/en-us/2019/Content/Inventory/Maintain_Inventory_Items_General.htm
> - Enter Beginning Balances for Inventory:
>   https://help-sage50.na.sage.com/en-us/2019/Content/Inventory/Enter_Beginning_Balances_for_Inventory.htm
> - Enter General Ledger Account Beginning Balances:
>   https://help-sage50.na.sage.com/en-us/2026/Content/Banking_General_Ledger/Enter_Beginning_Balances_GL_Accounts.htm
> - Set Up Terms and Credit / Customer Defaults (Discount % + Discount G/L account):
>   https://help-sage50.na.sage.com/en-us/2022/Content/Transactions/Accounts_Receivable/Terms_and_Credit_Customer_Defaults.htm
> - Receive Money fields (direct sales with blank Customer ID; Discount + Discount Account):
>   https://help-sage50.na.sage.com/en-us/2023/Content/Transactions/Accounts_Receivable/Payments_Receipts_Refunds/Receipts_Fields.htm

## 1. General Journal — import field specification (authoritative)

The General Journal exports/imports using **GENERAL.CSV** by default. Fields available
for import, in the canonical order, with required flags:

| # | Field | Required | Rules |
|---|-------|----------|-------|
| 1 | Date | **Yes** | Transaction date. Format `MM/DD/YY` (month/day/year). |
| 2 | Reference | No | Alphanumeric, up to **20 characters**. |
| 3 | Date Cleared in Bank Rec | No | Date the line cleared in bank rec (cash accounts). `MM/DD/YY`. Leave blank/omit if not applicable. |
| 4 | Number of Distributions | **Yes** | Whole number, valid **2–560**. The count of distribution (G/L) lines in the transaction. |
| 5 | G/L Account | **Yes** | Alphanumeric G/L account number for a distribution line, up to **15 characters**. |
| 6 | Description | No | Alphanumeric line description, up to **160 characters**. |
| 7 | Amount | **Yes** | Real number. **Positive = debit, negative = credit.** |
| 8 | Job ID | No | (Premium+). Combine job,phase,costcode as `"jobid,phase,costcode"`. Up to 20 chars. |
| 9 | Used for Reimbursable Expense | No | Boolean `[True]`/`[False]`. |
| 10 | Consolidated Transaction | No | Boolean `[True]`/`[False]` (consolidated companies). |
| 11 | Recur Number | **Yes** | Identifies a recurring entry/group. `0` = not recurring; `>0` = recurring. |
| 12 | Recur Frequency | **Yes** | `0`=none `1`=weekly `2`=bi-weekly `3`=monthly `4`=per period `5`=quarterly `6`=yearly `7`=every four weeks `8`=twice a year. |

**Note:** Transaction Period and Transaction Number are **export-only** (Import? = N). They
are used together to mark where a multi-line transaction begins/ends when Sage exports.

## 2. Import procedure (File > Select Import/Export)

1. **File menu → Select Import/Export.** The Select Import/Export window opens.
2. Choose the **program area** (General Ledger) and then the **General Journal** template.
3. Click **Import**. The template opens with the **Fields** tab in front.
4. On the **Fields** tab, check **Show** for each field present in your file. The set of
   shown fields must match your file **exactly in number and order** — the import fails
   otherwise. Use **Move** to reorder fields to match your file.
5. On the **Options** tab, set the file path/name (default is `C:\...\GENERAL.CSV`).
6. If your file has a header row, check **First Row Contains Headings** so Sage ignores it.
7. Optionally **Save** the template under a unique name to reuse the layout.
8. Click **OK** to import. If a line has a problem, Sage reports the problem **and the line
   number**; fix the CSV and re-import.

## 3. Import order matters

Some data must exist before other data can be imported. You must import the **Chart of
Accounts** (and Customer/Vendor lists) **before** transaction journals that reference them.
For our General Journal export, every G/L account used must already exist in Sage's Chart
of Accounts.

## 3a. Chart of Accounts fields (Import/Export) — default file `CHART.CSV`

Source: official Sage 50 help (Chart of Accounts Import/Export fields).

| Field | Import? | Description | Limit |
| --- | --- | --- | --- |
| Account ID | **Yes** | Alphanumeric G/L account number | ≤ 15 chars |
| Account Description | **Yes** | Alphanumeric account description | ≤ 30 chars |
| Account Type | **Yes** | Whole-number code (see below) | — |
| Inactive | **Yes** | Boolean `[True]`/`[False]` (True = inactive) | — |
| 1099 Settings | **Yes** | Whole-number code `0..14` (from Vendor Defaults) | — |
| Begin/period/prev-yr Debit-Credit-Net totals, Current Balance | No | Export-only | — |

**Account Type codes:** `0`=Cash, `1`=Accounts Receivable, `2`=Inventory,
`3`=Receivable Retainage, `4`=Other Current Assets, `5`=Fixed Assets,
`6`=Accumulated Depreciation, `8`=Other Assets, `10`=Accounts Payable,
`11`=Payable Retainage, `12`=Other Current Liabilities, `14`=Long Term Liabilities,
`16`=Equity-doesn't close, `18`=Equity-Retained Earnings, `19`=Equity-gets closed,
`21`=Income, `23`=Cost of Sales, `24`=Expenses.

**Import procedure:** File → Select Import/Export → General Ledger → **Chart of Accounts List**
→ Import; on the Fields tab check Show for exactly the fields in your file (same order); on
Options set the path and "First Row Contains Headings" if your file has a header.

**Back-office validation:** upload your `CHART.CSV` on the Accounting (Sage 50) tab and choose
report type "Sage Chart of Accounts". The back office parses the account IDs and cross-checks
every G/L account you've mapped in Accounting settings, flagging any that are **missing** or
**inactive** — so a General Journal import won't fail on a nonexistent account.

## 4. How our back office produces the file

The "Accounting (Sage 50)" tab builds a **daily General Journal CSV** from completed sales
using the store's editable **chart-of-accounts mapping** (cash clearing, cannabis sales,
non-cannabis sales, sales tax payable, excise tax payable, COGS, inventory, discounts).
Each day becomes one balanced transaction: **debits positive, credits negative**, summing
to zero. The file header is `Date, Reference, Transaction Number, G/L Account ID,
Description, Amount`, so when importing, enable **First Row Contains Headings** and show
those fields in that order.

Common questions the assistant should be able to answer from the above:
- Why won't my import work? → Field count/order must match; enable headings; G/L accounts
  must already exist; date format `MM/DD/YY`; debits positive / credits negative.
- What's the amount sign convention? → Positive debit, negative credit.
- Where do I start the import? → File → Select Import/Export → General Ledger → General Journal → Import.
- What's the max distributions per transaction? → 2 to 560.

## 5. Uploaded reports (Cultivera / POS exports)

The owner can **upload the reports they currently use to key data into Sage** (e.g. Cultivera
sales/inventory exports, POS daily summaries). We store the file and extract a light,
**aggregate** summary (row counts, detected columns, totals where obvious) that the AI uses
to *suggest* how the numbers map onto the General Journal — as a **draft** the employee
validates. We never auto-post to Sage and never invent figures.

## 6. The .ptb backup file (honest constraint)

A `.ptb` is a **Sage 50 company backup** (a proprietary, compressed archive of the entire
Pervasive/Btrieve company database). It is **not** a readable report format and cannot be
parsed into usable data outside Sage 50 itself. We therefore **do not** attempt to read or
ingest `.ptb` files. If the owner wants the AI to use their book data, the correct path is
to **export the specific reports** from Sage (e.g. General Ledger, Trial Balance) to CSV/PDF
and upload those. This is stated plainly to the owner rather than pretending `.ptb` works.

---

# Sage 50 export pipeline (this build)

The sections below document the **new export pipeline** added with migration
`0091_sage50_exports.sql`. Every format decision is verified against BOTH the
official Sage 50 import specifications above AND the owner's own Sage company
exports (CHART_OF_ACCOUNTS / CUSTOMERS / VENDORS / RECEIPTS_JOURNAL /
PURCHASE_JOURNAL / PAYMENTS_JOURNAL / PAYROLL_JOURNAL, uploaded by the owner).

## 7. Import order (authoritative — Import/Export Tips)

Lists first, journals second:

1. **Lists:** Chart of Accounts → Employee list → Vendor list → Customer list →
   Inventory Item list.
2. **Journals:** General Journal → Purchase Orders → **Purchases** → Assemblies →
   Inventory Adjustments → Sales Orders → Sales → **Payments** → **Cash Receipts** →
   Payroll. Purchases must precede sales so inventory costing computes correctly.

Other verified tips:
- **No double quotes** in memos/notes/descriptions (quotes delimit fields).
- Blank values import as `0` / `False`. Always include **Date Due** or AP/AR aging breaks.
- **Duplicate invoice numbers** for the same customer/vendor are rejected.
- You cannot import entries dated past the end of the **second open fiscal year**.
- **Sales tax IDs/agencies cannot be imported** (`taxcode.dat` / `taxauth.dat`);
  they must exist in Sage already and are referenced by ID in import files.

## 8. The store's REAL bookkeeping pattern (verified from the owner's exports)

- **Daily sales = Cash Receipts per category "customer"** `01-CONCENTRATE`,
  `01-EDIBLE`, `01-FLOWER`, `01-LIQUID`, `01-NON CANNABIS`, `01-PREROLL`,
  `01-TOPICAL`. Cash account `10000-GRNWY` (cash on hand). Distributions:
  - `WA LIQUOR & CANNABIS BOARD` → `31000-GRNWY` (agency `WA_LCB01`) — 37% excise, cannabis only
  - `LOCAL SALES TAX` → `31001-GRNWY` (agency `WA_DOR02`)
  - `STATE SALES TAX` → `31001-GRNWY` (agency `WA_DOR01`)
  - `SALES` → category income account `50000`–`50006-GRNWY` (Tax Type 1, with units + unit price)
- **Daily COGS = separate Cash Receipt per category** under `07-*` customers:
  "cash account" = category **COGS** account `60000`–`60006-GRNWY` (the debit), one
  distribution crediting the category **inventory** account `20000`–`20006-GRNWY`.
- **Vendor invoices** post to AP `30000-GRNWY`; manifest line items at
  `20009-GRNWY` (the owner's default purchases/inventory account).
- **Vendor payments** come out of checking `10005-GRNWY`; payment methods in the
  company are `Cash`, `Check`, `Electronic`.
- Sage vendor IDs look like `01-TWO HEADS`, `03-LOWES`, `06-IRS`, `08-PAYPAL`.

## 9. What the back office exports (and what it deliberately does NOT)

Rule from the owner: **if the back office doesn't hold the data, there is no Sage
upload for it.** The Accounting tab therefore offers exactly five downloads:

| Export | Source data | Sage import template |
|---|---|---|
| Cash Receipts (daily sales + COGS) | completed orders + menu categories + lot costs | Receipts (Accounts Receivable ▸ Cash Receipts Journal) |
| Purchases (vendor invoices) | accepted inbound manifests + lots | Purchases Journal (Accounts Payable) |
| Payments (vendor payments) | vendor manifest payments (ACH register) | Payments Journal (Accounts Payable) |
| Inventory adjustments | inventory_adjustments (excluding `receive`) | **General Journal** — see below |
| Vendor list | vendors with a Sage Vendor ID set | Vendor List (Accounts Payable) |

**Why adjustments go through the General Journal:** Sage's Inventory Adjustments
import (ADJUST.CSV) **requires a Sage Item ID** per row, and the back office has no
mapping to Sage inventory items. Rather than guess item ids, each adjustment is
exported as a balanced GL entry — DR category COGS / CR category inventory for
shrink (reversed for count-ups) — valued at the lot's unit cost.

**Why there is NO payroll upload:** PAYROLL.CSV needs per-pay-field amounts and
accounts (fields 1–20 gross, 21–60 employee withholdings, 61–100 employer). The
back office stores only net/gross/taxes/deductions totals per employee, so a
faithful payroll import is impossible without inventing data. Payroll stays keyed
in Sage directly.

**Sales / Sales Orders / POs / BOM / Time / U-M:** the owner's own exports of these
journals are empty (his sales flow through Cash Receipts, not invoiced Sales), so
no exports are generated for them.

## 10. Mapping tables (migration 0091 — apply manually)

- `sage_category_accounts` — one row per bucket with the category customers
  (`01-*` / `07-*`) and the G/L trio (sales/COGS/inventory). **Seeded verbatim**
  from the owner's chart; editable on the Accounting tab.
- `sage_category_map` — normalized back-office menu category → bucket. Only
  identity matches are seeded; **unmapped categories are flagged in the UI and
  excluded** (never guessed).
- `accounting_settings` new columns — `gl_ap_account`, `gl_bank_account`,
  `gl_purchases_default`, `gl_cash_on_hand`, `sales_tax_id_cannabis`,
  `sales_tax_id_other` (gap-filled with the owner's real values).
- `vendors.sage_vendor_id` — set per vendor on the vendor admin page; manifests
  and payments for vendors without one are skipped **with a warning**.

## 11. Professional bookkeeping habits (verified topics the assistant coaches on)

- **Reconcile monthly** (Tasks ▸ Account Reconciliation): statement ending balance
  + date, tick cleared items until Unreconciled Difference = 0.00, add bank
  fees/interest via Adjust.
- **Year-end** (Tasks ▸ System ▸ Year-End Wizard): two open fiscal years; close the
  first when you need the third; close the **payroll year first** when it's the
  calendar year (after W-2/941/940); the wizard forces a backup; closing is permanent.
- **Import hygiene:** always review generated CSVs before importing; import into a
  freshly-backed-up company; Sage reports the failing line number on error.

## 12. Bank Feeds — connecting a bank and reconciling with it (verified)

Bank Feeds (US banks only; requires a Sage service plan with Bank Services)
automatically retrieves bank transactions into Sage 50. **It does not create
transactions** — downloaded records appear only inside Account Reconciliation
and are matched against what you have already entered.

**Setup** (Apps & Services ▸ Bank Feeds, or Account Reconciliation ▸ Bank Feeds ▸
Connect to Bank Feed): confirm an email (cannot be changed later) → accept terms +
CAPTCHA → pick the bank (popular list / search / submit missing bank) → sign in
with online-banking credentials → choose the account type matching the G/L
account → pick a **Start date** → Process. Start-date rules: default 90 days back,
maximum two years, no future dates, and **never include a period you already
reconciled** — the bank itself may cap how far back it serves.

**Matching:** records that match already-entered transactions auto-clear.
Unmatched ones appear as *New Bank Records* → right-click ▸ **Manual Match** (link
to an existing transaction) or **Create New** (make the missing one). Connect each
G/L bank account separately (e.g. checking `10005-GRNWY`). Disconnecting keeps
already-downloaded records.

## 13. Inventory the professional way — one item per product, not per lot (verified)

- Item **class** is chosen once on the General tab of Maintain Inventory Items and
  **cannot be changed after saving**. Classes: Stock, Master Stock + Substock
  (Premium+), Serialized Stock (Premium+), Non-stock, Service, Labor,
  Activity/Charge, Description-only, Assembly / Serialized Assembly.
- Sage 50 US has **no native lot-tracking**. A new received lot is **not** a new
  item — it is a new **cost layer** on the same Stock item. The item's costing
  method (Average / FIFO / LIFO, or Specific Unit on Premium+) values each sale
  automatically. Sage's guidance: generally use the **same costing method for all
  items** (confirm with the CPA).
- Each Stock item carries three G/L accounts: **GL Sales** (credited on sale),
  **GL Inventory** (debited on purchase, credited on sale), **GL Cost of Sales**
  (debited on sale). Selling through Sales/Invoicing or Receive Money with the
  item on the line posts COGS automatically — the professional replacement for
  manually keyed 07-* COGS receipts.
- **Master Stock + Substock** (Premium+): one master defines attribute sets (e.g.
  Size × Flavor) and Sage auto-generates the substocks; substocks cannot be
  created or deleted directly (remove the attribute instead).
- Lot-level traceability stays in the POS/back office (the WA seed-to-sale system
  of record); Sage carries the financial view.

## 14. Discounts — early-payment terms vs POS promo discounts (verified)

1. **Early-payment (terms) discounts:** Maintain ▸ Default Information ▸ Customers ▸
   *Terms and Credit* holds Discount % / Discount-in-N-days plus the **G/L link
   accounts**: default Sales account, **Discount G/L account** (required; posted
   whenever a customer takes an early-pay discount), and Cash account. In Receive
   Money the Discount is computed from the customer's terms and the Discount
   Account is a required, editable field.
2. **POS/promo discounts (what this store gives):** professional treatment is
   **gross sales credited to income** and the discount **debited to a contra-revenue
   "Sales Discounts" account**, so the P&L shows gross revenue → discounts → net.
   The back-office receipts export does this automatically once the *Sales
   discounts* G/L account is set in Accounting settings (per day/bucket it credits
   SALES at the pre-discount amount and adds a positive SALES DISCOUNTS line, using
   `order_lines.regular_price_minor_units − price_minor_units`). If the account is
   blank, sales export **net** and the export warns about untracked discounts.

## 15. Beginning balances (verified)

- **G/L:** Maintain ▸ Chart of Accounts ▸ **Beginning Balances** → pick the period →
  type amounts in the white cells (minus = credit-side). Balances roll forward:
  changing Period 1 updates later periods, not vice-versa. If transactions have
  already been posted, the same button records **prior-period adjustments**.
- **Inventory:** Maintain Inventory Items ▸ General ▸ **Beginning Balances** → per
  item enter quantity, unit cost, total cost (serialized items also need serial
  numbers). Only used at startup.
- Source documents: the old company's **trial balance** (as of the day before the
  start date), Aged Payables, and the back-office inventory valuation. Debits must
  equal credits or Sage plugs the difference into **Beginning Balance Equity** —
  drive that account to zero before going live.

## 16. Fresh-start restructure playbook (the assistant walks the owner through this)

| Phase | What happens |
|---|---|
| 0 — Close out the old | Pick a clean start date (month/fiscal start). Old company: post everything, reconcile all cash/bank accounts, run Trial Balance (day before start), Aged Payables, back-office inventory valuation. Keep the old company forever as read-only history. |
| 1 — New company | File ▸ New Company; match fiscal periods to the start date; build the chart (keep 10000/10005/20000s/30000/31000/31001/50000s/60000s; add a Sales Discounts contra-revenue account, e.g. 50007). |
| 2 — Defaults first | Vendor defaults (methods Cash/Check/Electronic, terms), Customer defaults (Terms & Credit + G/L links incl. Discount account), Inventory Item defaults (one costing method, CPA-confirmed), and manual sales-tax IDs/agencies (WA_LCB01, WA_DOR01/02 — not importable). |
| 3 — Lists | Vendor list (back-office export), real customers only (walk-in retail needs none — blank Customer ID = direct sale), inventory items only if adopting the item model. |
| 4 — Beginning balances | G/L from the trial balance; each open vendor invoice entered individually; inventory qty+cost if using items; Beginning Balance Equity must end at zero; balance sheet ties to old books. |
| 5 — Connect & reconcile | Bank Feeds on checking; first reconciliation = first statement after start date; monthly cadence. |
| 6 — Go-forward rhythm | Daily/weekly: import back-office Receipts / Purchases / Payments. Monthly: reconcile all cash accounts, review P&L + Balance Sheet, tie inventory G/L to back-office valuation (one adjustment if needed). Quarterly: excise/sales-tax filings tie to 31000/31001. Yearly: Year-End Wizard after CPA review. |

**Two honest models (owner chooses; never guessed):**
- **A — Summary model (recommended for a high-SKU dispensary):** back office stays
  the perpetual inventory system; Sage receives daily summary receipts (gross
  sales, discounts, taxes, COGS by category) exactly as the exports build them;
  no Sage items; monthly inventory tie-out.
- **B — Item model:** every product is a Sage Stock item; purchases/sales flow
  item-by-item and Sage computes COGS automatically; most accurate inside Sage but
  heavy import volume for thousands of cannabis SKUs.

**On the 01-*/07-* "category customers":** verified — leaving Customer ID blank in
Receive Money records a **direct sale** applied straight to revenue accounts, so
daily summary receipts never required category customers. The old pattern is a
harmless grouping convention, but the fresh start should use direct-sale daily
receipts (or a single DAILY SALES reference customer if grouping is wanted) and
item-driven or export-driven COGS — not a customer per category.

## 17. Owner's decision: Model A with DETAILED categories (migration 0092)

The owner chose **Model A (summary model)** with **detailed** category tracking —
sales and COGS are summarized by the store's detailed product categories (rosin,
cartridges, infused pre-rolls, …), not only the seven broad types.

**Migration `0092_sage50_dynamic_buckets.sql`** (apply manually, AFTER 0091)
removes the fixed 7-value CHECK constraints on `sage_category_accounts.bucket`
and `sage_category_map.bucket` and replaces them with a slug-format constraint
(`^[a-z0-9][a-z0-9_-]{0,39}$`). The seven broad buckets remain as seeds; any
number of detailed buckets may be added.

**Workflow for adding a detailed category (e.g. ROSIN):**
1. In Sage, create the three G/L accounts first via Maintain → Chart of Accounts:
   an income account (e.g. `50010` ROSIN SALES, type Income), a COGS account
   (e.g. `60010` ROSIN COGS, type Cost of Sales), and an inventory account
   (e.g. `20010` ROSIN INVENTORY, type Inventory).
2. If keeping the 01-*/07-* customer convention, also create `01-ROSIN` and
   `07-ROSIN` customers in Sage; otherwise direct sales work with the fields set.
3. In the back office, Admin → Reports → Accounting → "Sage category buckets" →
   **+ New category**: enter the label and the account/customer IDs from step 1–2.
4. Map each POS category name to the new bucket in "Sage category map".
   Exports warn about unmapped categories and about buckets whose G/L accounts
   are blank — nothing posts to a guessed account.

The exports group each day's sales, discounts, taxes, and COGS by these buckets,
so the Sage P&L shows gross revenue, discounts, and COGS per detailed category —
professional summary-level books with the back office as the perpetual
inventory system (monthly tie-out per the playbook in §16).
