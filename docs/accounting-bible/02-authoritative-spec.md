# ACCOUNTING BIBLE — 02 · AUTHORITATIVE SPEC (what the law and the big systems force)

> Written for me, the next agent. Every row has three columns that matter:
> **what the authority says** (paraphrased from what I actually read, URL in
> part 13), **what it forces in code**, and **where Greenway stands** (pin).
> If a row says "READ" the source was opened and read during recon on
> 2026-10-31. "FOUND" means located but only the summary was read: treat
> it as a lead, not a quote (AGENTS rule: never guess).
>
> Rule of thumb: the code already cites most of these through
> `*-authorities.ts` files. **Do not duplicate an authority (todo rule 25).**
> Before adding a citation, grep `src/lib/accounting/*authorities*.ts` and
> `vendor-bill-core.ts:120-420` (the AUTHORITIES table) and reuse the id.

---

## 0. How to use this part

1. When a slice in part 09 touches a tax or a control, read its row here first.
2. Paste the authority id (for example `RCW_69_50_535`) into the slice's core, not a fresh URL.
3. If a rate or threshold appears here, it **must not be inlined** (rule 114(d)).
   It flows from a config/rates object with an effective date, like
   `DEFAULT_BO_RATES` (bo-tax-core.ts:191) or `payroll-rates-2026.ts:274`.
4. If my paraphrase and the code disagree, **the code's verbatim quote wins** and I
   re-open the URL. My paraphrase is a pointer, not a source.

---

## 1. Washington cannabis excise — RCW 69.50.535 (READ)

| Point | What it says | What it forces in code | Greenway pin / status |
|---|---|---|---|
| Rate | 37% of the selling price on each retail sale of cannabis concentrates, useable cannabis and infused products. | `EXCISE_BPS = 3700` lives once. Every consumer imports it. | sale-journal-core.ts:96; ccrs-preflight-core.ts:196 (`CCRS_EXCISE_BPS`). **Two constants for one fact**: the S-05 dedupe candidate. Do not change values, only reference. |
| Separate from sales tax base | Excise is separate and in addition to the retail sales tax, and is **not** part of the sales tax base. | Tax-inclusive shelf price splits as paid × 3700/14630 (excise) and paid × 930/14630 (sales tax); neither taxes the other. | sale-journal-core.ts:101 `CANNABIS_INCLUSIVE_BPS = 14630`; :242-243 divRoundHalfUp. Correct. |
| Itemized | Must be separately itemized on the receipt. | Receipt renderer shows excise and sales tax as separate lines. | Outside the books branch; leave it. |
| Trust | Held in trust for the state; seller personally liable. | 32000 is a **liability**, never revenue and never expense. Remittance debits 32000. Statements must classify it as a current liability. No journal may credit revenue for excise. | sale-journal-core.ts:45, :108; vendor-bill-core.ts:755-767 (`excise_remittance` debits 32000). Assertion `revenueJournal.lines.every(l => l.accountCode !== EXCISE_PAYABLE_ACCOUNT)` at sale-journal-core.ts:594. |
| Medical exemption | Qualifying sales to patients with a recognition card are exempt from excise (through 2029-06-30 per current statute text). | A medical sale has excise 0 and must not fall back to the 14630 divisor. The exemption has an **end date**: rates/flags need an effective window. | **sale-journal-core.ts contains no "medical" at all** (grep 2026-10-31); it splits on `isCannabis` only (:242). Either no medical-exempt sales occur, or each one over-accrues excise. **U-08 / Q-05.** |

**Book consequence:** each month, `sum(credits to 32000 from sales) − sum(debits from refunds)` must equal the LIQ-1295 excise box. That equality is control **C-TAX-1** in part 11.

---

## 2. LCB monthly retailer report — LIQ-1295 + WAC 314-55-092 (READ)

| Point | What it says | Forces | Pin |
|---|---|---|---|
| Due | Monthly; due the **20th** of the following month, even for $0. | A due-date calendar row per month. The books close (part 09 S-11) must finish before the 20th, so the excise number comes from a **closed** period. | excise-return-core.ts:22-23, :266 compute the plain 20th; the next-business-day roll is noted, not computed. |
| Penalty | 2% per month late (WAC 314-55-092). | The tax-penalty engine knows it; the books only need the accrual if late. | tax-penalty-core.ts (reachable). |
| Payment | Paid via the LCB pay station. | The payment must produce **Dr 32000 / Cr 10200** in the GL. | excise-payment-core.ts builds the pay-station link and **writes no journal**. Compliance has no `submitJournal` call (grep src/lib/compliance: zero). Clearing 32000 depends on Michael keying a vendor bill of kind `excise_remittance`. **Gap G-EX-1 → slice S-12.** |

---

## 3. Washington retail sales tax and B&O (READ: DOR classifications + due dates)

### 3.1 Due dates (dor.wa.gov/file-pay-taxes/filing-frequencies-due-dates, WAC 458-20-22801)

- **Monthly** filers: due the **25th** of the following month.
- **Quarterly**: due the last day of the month after the quarter.
- **Annual**: due April 15.
- Weekends and holidays roll to the next business day.
- DOR assigns monthly frequency above roughly $4,801 of annual liability. Greenway is monthly (any cannabis retailer at ~200 tx/day is).
- **Forces:**
  - One combined excise return per entity per month: sales tax (32100) and B&O (32200) are on the **same DOR return**.
  - The ATM entity's service B&O is filed under its own registration (BO_CLASSIFICATION_ENTITY bo-tax-core.ts:214-217 maps service_and_other → atm).
  - The close calendar must be 20th (LCB) → 25th (DOR).

### 3.2 Rates (dor.wa.gov B&O classifications page)

| Classification | DOR rate | Code | Status |
|---|---|---|---|
| Retailing | 0.00471 | `retailing: 4710` millionths (bo-tax-core.ts:192) | Correct |
| Service & other, prior-year gross < $1M | 0.015 | `service_and_other: 15000` (:193) | Correct **only while ATM surcharge < $1M** |
| Service & other, $1M – $4.99M | 0.0175 | — | **Missing tier.** Michael's own quote (bo-tax-core.ts:181-183) says "less than 1,000,000". The ATM surcharge measured ≈ $16,272.50 (related-party-loan-core.ts:191 `MEASURED_SURCHARGE_CENTS = 1_627_250`), so the tier is **not live risk**. Record as finding N-07 (LOW). |
| Service & other, $5M+ | 0.021 | — | Not reachable. |
| Wholesaling | 0.00484 | — | Not applicable (retailer). |

**Forces:**

- B&O is an **expense** (75040) accrued against a **liability** (32200): `boAccrualEntry` (bo-tax-core.ts:501).
- Payment is Dr 32200 / Cr 10200: `boPaymentEntry` (:539).
- Both builders exist and **nothing imports bo-tax-core** (reachability scan: unreachable from src/app). That is dead-core finding **DC-02** → slice S-13.

### 3.3 Retail sales tax

- 9.3% combined rate is `SALES_TAX_BPS = 930` (sale-journal-core.ts:98). Rate is location-based and can change on any Jan 1 / Apr 1 / Jul 1 / Oct 1. **Forces:** the rate must carry an effective date. Today it is a constant. Finding **N-08 (MEDIUM, latent)**. Do not fix inline; S-13 should move it into a dated rates object alongside B&O.
- Sales tax is a trust liability (32100). Remittance via vendor bill kind `sales_tax_remittance` (vendor-bill-core.ts:769-776) or the S-12 remittance slice.

---

## 4. Federal income tax: §280E and inventory costing

### 4.1 26 USC §280E (READ)

No deduction or credit is allowed for any amount paid or incurred in carrying on a trade or business that consists of trafficking in Schedule I/II controlled substances.

**Forces:**

- Every expense line must carry a **cost class**: inventoriable (COGS, allowed), nondeductible (280E), or neutral (balance-sheet / trust).
- The GL already enforces cost-class checks inside `gl_post_journal` (0172:668 onward; part 03b lists the columns).
- The entity split is the planning lever: ATM and landholding are separate Schedule C businesses (part 00 entity table). Their costs **must not** be booked on the greenway entity, and vice versa.

### 4.2 26 CFR 1.471-3(b) and (e)/(f) (READ)

| Paragraph | What it says |
|---|---|
| (b) | Cost of purchased merchandise = invoice price **less trade or other discounts**, **plus transportation or other necessary charges incurred in acquiring possession**. |
| (e) | Vendor allowances / chargebacks reduce cost. |
| (f) | Amounts described in §162(c), (f), (g) are not cost. |

**Forces:**

| Item | Account | Pin / status |
|---|---|---|
| Freight-in | 60800 inventoriable (capitalised under 1.471-3(b)) | Present in COA (coa.txt) |
| Purchase discounts | 60900 contra-COGS (a reduction of cost) | Present in COA (coa.txt) |
| Vendor bill classifier | Respects both of the above | vendor-bill-core.ts trade-discount/freight kinds |

### 4.3 Patients Mutual (Harborside) v. Commissioner, 9th Cir. No. 19-73078 (2021), affirming 151 T.C. 176 (READ)

- A cannabis reseller computes COGS under **1.471-3(b)** only.
- §263A UNICAP cannot pull otherwise-nondeductible costs into inventory.
- 1.471-3(d) (producer) is not available.

**Forces:**

- Greenway is a retailer (no producer/processor licence), so only acquisition costs are inventoriable. This decides `payroll-cogs-core` (61000 inventory payroll) **conservatively**: the D-50 decision ("own map") must remain consistent with this case.
- `cogs-position-core.ts#computeCogsPosition` (:1237) exists to compare positions and is **unreachable** (DC-03).
- The **position election is an owner decision** (part 05, Q-06). Never auto-elect.

### 4.4 26 CFR 1.471-2 (FOUND) and ASC 330 / ASU 2015-11 LCNRV (FOUND)

**1.471-2: inventory must:**

- conform to best accounting practice in the trade
- clearly reflect income
- be consistent year to year

Write-downs below cost are allowed only for subnormal goods.

**ASU 2015-11 (book/GAAP):** FIFO/average inventory is measured at the lower of cost and net realisable value.

**Forces:**

| Item | Account / owner | Status |
|---|---|---|
| Quarantine / expired / damaged write-downs | 20890 quarantine → 60810 shrink | Accounts exist |
| Write-down journal | inventory-audit-store.ts:480 (draft only) | Exists |
| Cost method | Must be declared **once** and kept consistent | `ACCOUNTING_BASIS` (cutover-core.ts:94). Read it before S-20. |
| Tax-basis LCNRV | Not required | Greenway files tax-basis statements, so Michael chooses (Q-10) |

### 4.5 Rev. Proc. 98-29: retail inventory shrinkage safe harbor (FOUND)

Retail safe-harbor method for estimating shrinkage between physical counts at year end.

**Forces (only if adopted):**

- a shrink reserve (20810) estimated from a historical ratio
- a **physical count at least annually**

The December full count reminder (commit e41c6329, G-41) is the operational hook. The election is a method change (Form 3115 territory), so this is **owner decision Q-11, deferred** (part 10).

---

## 5. S-corporation shareholder level: Form 7203, 1120-S, K-1 (READ: i7203)

| Point | What the instructions say | Forces |
|---|---|---|
| Who files | A shareholder must attach 7203 when they: claim a loss/deduction; receive a non-dividend distribution; dispose of stock; or receive loan repayment from the corporation. | Every year with distributions (41000), each of the 4 shareholders needs a basis schedule. |
| Ordering | Basis increases by income items, then decreases by distributions, then nondeductible expenses, then losses (the §1.1367-1(g) election reverses nondeductible/loss order). | `basis-aaa-core.ts#computeStockBasisSchedule` (:836) and `computeBasisAndAaa` (:1121) implement this. Both are **unreachable** (DC-01). |
| **280E interaction** | Nondeductible expenses **reduce basis** (and do not reduce AAA). | 280E-disallowed amounts are huge for Greenway. They grind basis down, which makes **distributions over basis = capital gain** a real risk. This is the single most valuable report the system can give Michael. |
| Debt basis | Per-loan tracking; open account debt over $25,000 becomes a formal note. | `related-party-loan-core.ts` (:120 accounts, :827 FIFO repayments) is unreachable (DC-07). The ATM circuit numbers (:190-199) are **measured facts** from Michael's data. Never rewrite them. |
| Pro-rata | Distributions must be per-share pro rata (single class of stock). | `assessProportionality` (basis-aaa-core.ts:1025). Shareholders: 85/5/5/5 (shareholder-roster-core.ts; part 00). A non-pro-rata draw by Michael is an **S-election termination risk**. Control **C-EQ-2**. |

---

## 6. Payroll: IRS Pub 15 (2026) (READ)

| Point | Value | Forces | Pin |
|---|---|---|---|
| SS wage base | $184,500 (6.2% each side) | Rates object with year key | payroll-rates-2026.ts:274 |
| Medicare | 1.45% each, plus 0.9% additional above $200k (employee) | as above | payroll-rates-2026.ts |
| Deposits | Monthly vs semiweekly by lookback; $100k next-day | Liability accounts 31000-31300 must clear on deposit, and the **deposit journal** must exist | payroll-posting-service.ts:322-331 posts the **run** (draft only, deliberately). **The deposit (Dr 31xxx / Cr 10200) has no poster.** Gap G-PR-1 → S-16. |
| Records | Keep 4 years | Retention: journals are never deleted, only reversed | gl_reverse_journal 0172:826 |
| Trust fund recovery penalty | Withheld taxes are trust funds; responsible persons are personally liable | 31xxx are trust liabilities like 32000; same "never P&L" assertion should apply | — |
| 1099-NEC | $2,000 threshold for 2026 (P.L. 119-21); backup withholding 24% | Vendor master needs a 1099 flag; out of scope until AP slice | part 10 |

---

## 7. Banking and cash: FinCEN FIN-2014-G001 (READ)

- The guidance describes three marijuana SAR types: **Limited, Priority, Termination**.
- Red flags banks are told to watch include:
  - deposits not commensurate with reported revenue
  - structuring around $10k
  - commingling with owners' personal accounts
  - financial statements inconsistent with account activity
- CTRs apply above $10,000 per day; an MRB cannot be CTR-exempt. Form 8300 applies to cash > $10k received in a trade/business.

**Forces (this is why bank-to-books integrity is a compliance control, not a nicety):**

- **Revenue in the GL must reconcile to deposits.** POS revenue (50xxx) less change in cash-on-hand (10100/10110/10300/10400) must reconcile to deposits into 10200. If the books show $X of sales and the bank shows $Y of deposits, the bank's examiner sees exactly that red flag. This is control **C-CASH-1**.
- **No commingling:** the `personal` entity exists for that. Owner draws go to 41000 on greenway (or 36000 due-to/from for intercompany), never as an expense.
- Structuring detection already exists: `CTR_THRESHOLD_MINOR = 1_000_000` and the deposit-fluctuation question (safe-bag-core.ts:275-311). Keep it.
- **Bank reconciliation must be signed off monthly.** The 0189 RPCs `gl_bank_reconcile` (:774) and `gl_sign_off_bank_reconciliation` (:967) have **no caller** (bank-expense-service.ts:20-24 admits it). Gap G-BANK-1 → S-17.

---

## 8. Bank feed: Plaid `/transactions/sync` (READ)

| Point | Forces | Pin |
|---|---|---|
| Cursor-based; `added / modified / removed`; paginate while `has_more` | Store cursor per item and apply all three arrays; **`removed` must reverse** any journal created from that transaction | plaid_transactions read at bank-expense-service.ts:320 |
| On `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` restart from the **first** cursor of this sync | Do not persist the cursor until the whole page set succeeds | — |
| Amount **positive = outflow** | Sign convention must be documented at one place | `gl_bank_sign_agrees` 0189:512 exists. Reuse it, never re-derive. |
| `pending_transaction_id` links pending → posted | Never journal pending transactions | Verify in S-17 (U-09) |
| Cursor valid ~1 year; webhook `SYNC_UPDATES_AVAILABLE` | A cron, idempotent and claim-locked (AGENTS rule) | — |

---

## 9. Enterprise close: NetSuite period close checklist (READ)

The checklist sequence:

1. Lock AR, AP and payroll.
2. Review negative inventory and date/period mismatches.
3. Intercompany adjustments, then elimination.
4. Period-end journals (accruals, depreciation, revaluation).
5. Gapless GL audit numbering.
6. Close.

Reopen needs a permission, and prior periods must be closed first.

**Forces / mapping:**

| NetSuite step | Greenway equivalent | Exists? |
|---|---|---|
| Lock subledgers | Drafts in the period are zero (no pending approvals) | `evaluatePeriodClose` (period-close-core.ts:557) checks. **Unreachable** (DC-05). |
| Negative inventory review | inventory valuation vs 20000 control | cycle-counts.ts / inventory-audit-store.ts:480 |
| Intercompany | `gl_submit_intercompany_pair` (0174:587) + 36000 | Caller: posting-service.ts:468, atm-sweep-core.ts |
| Elimination | Consolidated view nets 36000 across entities | **None.** Gap G-IC-2 → S-24 (only if consolidated statements wanted, Q-09). |
| Period-end journals | B&O accrual, depreciation, OBE close | bo-tax-core / fixed-assets-core **unreachable** |
| Gapless numbering | `gl_journal_sequences` (0172:240-251), `journal_no` assigned only at post (0172:319 check) | **Exists.** VERIFIED |
| Close / reopen | `gl_close_period` 0172:891 / `gl_reopen_period` 0172:929 | **No caller** in src (only named in period-close-core/authorities). Gap G-CLOSE-1 → S-11. |
| Prior closed first | `refuseIfNotFinished` period-close-core.ts:435 | Unreachable |

---

## 10. Internal control: COSO 2013 (FOUND)

Five components (control environment, risk assessment, control activities, information & communication, monitoring) and 17 principles.

**Forces:** for a sole owner-operator, segregation of duties is replaced by **compensating detective controls**:

- an immutable audit log (`gl_audit_events`)
- approval flags that warn but don't block (0211)
- monthly reconciliations signed off
- a review of journals posted by the owner over the threshold (`gl_override_report`, called at ledger-store.ts:370)

`internal-control-core.ts#segregationOfDutiesFinding` (:248) and `changeRiskForCutover` (:313) encode this. Both are **unreachable** (DC-06), but this is low urgency: they are teaching material, and the operative control is the 0211 flag screen (todo "PR D").

---

## 11. Accounting framework choices — VERIFIED

- **Method is ACCRUAL for all four entities.** `ACCOUNTING_BASIS` (cutover-core.ts:94-99) records the owner decision of 2026-08-17 verbatim: *"we are accrual based for all entities and my person."*
  - (An earlier draft of this part said "income-tax basis". That was a guess, it was wrong, and it is corrected here. The lesson is to read the literal.)
- Accrual forces:
  - AP at bill date (30000; vendor-bill-service)
  - B&O accrued monthly (32200)
  - payroll accrued at pay-period end (31xxx, 35000 accrued liabilities)
  - excise/sales tax recognised at sale, not at remittance
- **Statement framework (tax-basis vs GAAP presentation) is NOT recorded anywhere I found.** This is open question **Q-12** in part 05.
- Until Q-12 is answered:
  - MACRS depreciation (fixed-assets-core.ts:282) is the only depreciation engine.
  - ASC 842 ROU assets are not built.
  - ASC 330 LCNRV is not built.
  - Part 10 records these as D-GAAP.
- POS revenue is recognised at the point of sale (ASC 606 collapses to that for a retail cash sale). There are no contracts, deferrals or loyalty points unless a loyalty liability exists (grep `loyalty` before S-03; U-11).

## 12. Authority → slice cross-reference

| Authority | Slices (part 09) |
|---|---|
| RCW 69.50.535 / LIQ-1295 | S-03 sale posting, S-12 excise remittance, S-11 close calendar |
| DOR due dates / B&O / sales tax | S-13 B&O accrual + payment, S-12 sales-tax remittance |
| §280E / 1.471-3 / Harborside | S-20 COGS position report, S-21 inventory valuation |
| Form 7203 / §1.1367 | S-26 basis & AAA, S-27 distributions guard |
| Pub 15 | S-16 payroll deposits |
| FinCEN 2014 | S-17 bank rec, S-18 cash-to-deposit proof |
| Plaid sync | S-17 |
| NetSuite close | S-11 period close, S-24 intercompany |
| COSO | S-04 approval parity + flag screen |
