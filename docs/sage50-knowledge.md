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
