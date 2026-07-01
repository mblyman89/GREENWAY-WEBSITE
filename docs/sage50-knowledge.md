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
