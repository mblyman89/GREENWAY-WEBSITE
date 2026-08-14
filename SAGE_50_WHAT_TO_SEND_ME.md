# Sage 50 — What To Send Me, And Exactly How To Get It

**Michael — this is your checklist. You do not need to read anything else in this
file's neighbourhood to use it. Seven files, each one a menu path and a few clicks.**

There is **no rush**. Per your direction we are building and battle-testing first;
this data gets gathered over the next two months while that happens. Nothing here
is needed today. When you do have a spare hour, work down the list.

---

## Before you start — three things worth knowing

**1. Do NOT send me a `.ptb` file.** That is a Sage *backup*, not data. It cannot be
opened without Sage installed. The app already refuses `.ptb` uploads on purpose.

**2. Everything below is CSV.** Sage exports CSV natively. If a step gives you a
choice of format, choose CSV every time.

**3. Always tick "Include Headings."** It is a checkbox on the Options tab. Without
it the file arrives with no column names and I cannot tell a debit column from a
credit column. This is the single most common thing that makes an export useless.

---

## The two menus you will use

Sage puts this in two different places, and knowing which is which saves confusion:

- **File → Select Import/Export** — for *list and journal* data (chart of accounts,
  vendors, transactions). This is the one with the Fields/Options tabs.
- **Reports & Forms** — for *reports* (trial balance, aged payables). These have a
  simple "Export to CSV" instead.

---

## THE LIST — seven files

### 1. Trial Balance ⭐ THE MOST IMPORTANT ONE

> **Reports & Forms → General Ledger → General Ledger Trial Balance**
> Set the date to **the day BEFORE our start date** (so if we go live 1/1/2026,
> date it **12/31/2025**). Then **Export → CSV**.

**Why it matters more than the rest combined:** this is the file every other number
gets checked against. Total debits must equal total credits **to the penny**. When
you upload it, the back office now ties it out automatically and tells you
pass/fail. If it fails, that gets fixed in Sage *before* anything is keyed — because
otherwise Sage silently dumps the difference into an account called "Beginning
Balance Equity," and that is exactly how books start out already drifting.

---

### 2. Chart of Accounts

> **File → Select Import/Export → General Ledger → Chart of Accounts List → Export**
> Fields tab: **Select All**. Options tab: set the filename, tick **Include Headings**. **OK.**

Default filename is `CHART.CSV`. This is your account list. I use it to map your old
account numbers onto the new 5-digit scheme — this is where those four different
"Accounts Payable" accounts finally collapse into one.

---

### 3. Aged Payables (who you owe right now)

> **Reports & Forms → Accounts Payable → Aged Payables**
> Same "day before start date" date. **Export → CSV.**

Every open bill has to be entered individually in the new system so payments can be
applied against the right invoice. A single lump-sum "accounts payable" number is
useless for paying anyone.

---

### 4. Vendor List

> **File → Select Import/Export → Accounts Payable → Vendor List → Export**
> Select All / Include Headings.

Default `VENDOR.CSV`. Names, terms, contact info, 1099 flags.

---

### 5. General Journal (the ledger detail)

> **File → Select Import/Export → General Ledger → General Journal → Export**
> On the **Filter** tab set the date range (I'd like the **full current fiscal year**
> and the **prior year** if it exports without complaint).
> Select All / Include Headings.

Default `GENERAL.CSV`. This is for *verification and history*, **not** for re-keying.
See "What we are NOT doing" below.

---

### 6. Fixed Asset / Depreciation Schedule 🔴 THE ONE I ACTUALLY NEED MOST

> If you use Sage's fixed-asset module: **Reports & Forms → Fixed Assets →
> Depreciation Schedule → Export → CSV.**
> **If you do not use that module — and you may not — then what I need is the
> depreciation schedule attached to your most recently filed tax return.** Your
> grandfather will have it. It is usually titled "Depreciation and Amortization"
> (Form 4562) with a detail schedule behind it.

**Why this one is urgent and different from the others:** if depreciation has already
been claimed on a filed return, the accumulated amount is a **fact already on file
with the IRS**, not a number we get to choose. If we pick a different one, fixing it
later means Form 3115 and a lot of professional time. Everything else on this list
can be re-exported any time; this one has to be *right*.

This also feeds the Geiger property basis, which matters for the road-improvement
condemnation.

---

### 7. Inventory Valuation (only if Sage holds real inventory numbers)

> **Reports & Forms → Inventory → Inventory Valuation Report → Export → CSV.**

Skip this if your inventory truth lives in Cultivera rather than Sage. Tell me which,
and don't guess — if you're unsure, send it and I'll compare.

---

## How to send them

Upload through the back office: **Admin → Reports → Accounting → Sage helper**, in the
"Upload reports for Sage import" section. Pick the matching kind from the dropdown
(Trial balance export, Aged Payables, Sage Chart of Accounts, etc.) so the right
checks run automatically on arrival.

---

## What we are NOT doing (and why that's deliberate)

We are **not** re-importing years of transaction history. We migrate **balances**,
not history:

- **Moves into the new books:** chart of accounts, opening balances, open vendor
  bills, fixed assets and their accumulated depreciation.
- **Stays in Sage forever:** every historical transaction, prior-year financials,
  the full audit trail.

Sage stays installed as a permanent read-only archive. Trying to drag every historical
transaction across is what turns a conversion into a six-month project and imports
every old error along with it. You keep the history; you just stop *writing* to it.

---

## Quick reference

| # | File | Where | Priority |
|---|---|---|---|
| 1 | Trial Balance | Reports & Forms → General Ledger | ⭐ **highest** |
| 2 | Chart of Accounts | File → Select Import/Export → General Ledger | high |
| 3 | Aged Payables | Reports & Forms → Accounts Payable | high |
| 4 | Vendor List | File → Select Import/Export → Accounts Payable | medium |
| 5 | General Journal | File → Select Import/Export → General Ledger | medium |
| 6 | **Depreciation schedule** | Fixed Assets module **or the filed tax return** | 🔴 **get this right** |
| 7 | Inventory Valuation | Reports & Forms → Inventory | only if Sage holds it |

**Two rules for all seven: CSV, and tick "Include Headings."**

---

*Sources: Sage 50 US official documentation — Export Data from Sage 50
(help-sage50.na.sage.com/en-us/2023/Content/Importing_Exporting/Export_Data_from_Sage50.htm),
Import/Export field specifications, and Beginning Balances guidance. Full field-level
specs live in `docs/sage50-knowledge.md`; the migration strategy lives in
`/workspace/sage50-migration-plan.md`.*
