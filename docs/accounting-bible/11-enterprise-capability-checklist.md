# 11 — Enterprise Capability Checklist ("the power of the big boys", tailored)

> **Audience: me.** This is the scorecard: what a NetSuite/Sage Intacct-class implementation for a regulated single-store retailer would have, mapped to Greenway.
> Status: **HAVE** (built and wired), **PART** (built, not wired or not complete), **GAP** (absent), **N/A** (deliberately out, see part 10).
> Each row names the slice that closes it. I update this file when a slice merges.

## 1. Core ledger

| # | Capability | Status | Evidence / slice |
|---|---|---|---|
| L-01 | Double-entry, balanced-only journals in integer cents | HAVE | 0172; INV-01 |
| L-02 | Multi-entity dimension (4 books) | HAVE | gl_entities 0172:75-76 |
| L-03 | Gapless per-entity journal numbers, assigned at post | HAVE | gl_journal_sequences 0172:240-252 |
| L-04 | Immutable posted entries; correction by reversal only | PART | prove-gl-indelible.sql; reversal unwired → S-10 |
| L-05 | Idempotent posting door keyed by source document | HAVE | gl_submit_journal 0174:344 |
| L-06 | Line-in-the-sand date control | HAVE | 0172:309-314; 0186 OB date |
| L-07 | Fiscal periods: open/close/lock-on-filing | PART | 0172:891/929/946; periods wiped by reset (N-02) → S-02, S-11 |
| L-08 | Chart of accounts locked, category-level inventory/COGS | HAVE | 0173/0178 (193 codes); OD-13, OD-14 |
| L-09 | Standing-approval templates for automated posting | PART | 0174 table empty (N-01) → S-01 |
| L-10 | Approval workflow, thresholds, owner override | PART | 0177/0211; TS parity N-05 → S-04 |
| L-11 | Audit trail of every change | HAVE | gl_audit_events, gl_template_changes, gl_override_log |
| L-12 | Mandatory memo + recorded assumptions | HAVE | 0172 memo check; assumption_note |
| L-13 | Owner-only access to books | HAVE | 0185 is_owner(); 0190 |
| L-14 | Recurring / accrual journals | GAP | S-11/S-13/S-25 |

## 2. Subledgers → GL

| # | Capability | Status | Evidence / slice |
|---|---|---|---|
| S-L1 | POS revenue + trust taxes | PART | per-order drafts (N-03); medical (N-09) → S-03, S-03b |
| S-L2 | COGS from lot cost | PART | `#cogs` draft → S-03 |
| S-L3 | Refunds | PART | refund-posting-service drafts; mirror N-09 |
| S-L4 | Cash: till → bag → vault → bank | PART | wired but refused (N-01) → S-01 |
| S-L5 | Card settlements / card expenses | HAVE | card-payment-core, bank-expense-core |
| S-L6 | Purchasing: PO/receipt/bill three-way match | PART | D-35, D-61 → S-08 |
| S-L7 | AP payments / ACH | GAP | D-36 → S-15 |
| S-L8 | Payroll gross-to-net | HAVE (draft) | gl_post_payroll_run 0188 |
| S-L9 | Payroll remittances | GAP | S-16 |
| S-L10 | Inventory count adjustments | HAVE (draft) | inventory-audit-store.ts:485 |
| S-L11 | Fixed assets + depreciation | PART | fixed-assets-core unreachable → S-25 |
| S-L12 | Loans P&I | PART | related-party-loan-core unreachable → S-26 |
| S-L13 | Intercompany | PART | wrapper unused → S-23/S-24 |
| S-L14 | ATM entity | PART | settlement draft; custody → S-22 |
| S-L15 | Tax remittances (excise, RST, B&O) | GAP | N-11 → S-12, S-13 |

## 3. Cash and bank

| # | Capability | Status | Slice |
|---|---|---|---|
| C-01 | Bank feed with cursor sync, pending handling | HAVE | plaid sync-core / planTransactionMerge; pending refused bank-match-core.ts:948, :1368 (U-09 resolved) |
| C-02 | Match suggestions | HAVE | bank-match-core |
| C-03 | Match posting / unmatch | GAP | 0189:537/712 uncalled → S-17 |
| C-04 | Reconciliation + sign-off | GAP | 0189:774/967 → S-17 |
| C-05 | Daily cash proof (POS ↔ count ↔ bag ↔ deposit ↔ bank) | GAP | S-18 |
| C-06 | Aged undeposited cash warning | HAVE | deposit-clearing-core.ts:716 (OD-16) |

## 4. Tax and compliance (WA cannabis-specific)

| # | Capability | Status | Slice |
|---|---|---|---|
| T-01 | 37% excise accrued on the selling price (RCW 69.50.535(1)(a)) | HAVE | sale-journal-core extractTaxes |
| T-02 | Medical excise exemption (RCW 69.50.535(2), sunset 2029-06-30) in the GL | GAP | N-09 → S-03b |
| T-03 | Separate exemption line on the excise form (69.50.535(2)(c)) | HAVE (return) | excise-return-core.ts:11, :39-40 `exemptMedicalSalesMinor` (U-17); the GL disagrees until S-03b |
| T-04 | LIQ-1295 monthly, due the 20th (WAC 314-55-092) | HAVE (report) | excise-return-core; GL tie → S-12 |
| T-05 | DOR combined excise return, due the 25th for monthly filers | PART | tax-base-core; GL tie → S-12 |
| T-06 | B&O accrual by classification, dated rates | PART | bo-tax-core unreachable → S-13 |
| T-07 | Tax per line stored once (single authority) | GAP | D-32 → S-03c |
| T-08 | 280E: COGS-only deduction, inventoriable cost capture | PART | lot-cost-classification, payroll-cogs 61000; report → S-20 |
| T-09 | Form 1125-A / 1120-S support | PART | cogs-position-core, s-corporation-year-core → S-20/S-27 |
| T-10 | Form 7203 basis/AAA per shareholder | PART | basis-aaa-core → S-27 |
| T-11 | 1099-NEC | GAP | F-04 |
| T-12 | Payroll tax filings (941, ESD, L&I, PFML, WA Cares) tie to GL | PART | filings exist (0204); remit → S-16 |

## 5. Close and reporting

| # | Capability | Status | Slice |
|---|---|---|---|
| R-1 | Trial balance per entity | HAVE | 0175; ledger-store.ts:97 |
| R-2 | Balance sheet / P&L | HAVE | financial-statements-core |
| R-3 | General ledger drill-down | HAVE | gl_general_ledger ledger-store.ts:138 |
| R-4 | Close checklist (computed) | GAP | period-close-core → S-11 |
| R-5 | Trust-liability rollforwards | GAP | S-12 |
| R-6 | Inventory valuation report | GAP | S-21 |
| R-7 | AP aging | PART | S-15 |
| R-8 | Intercompany elimination | GAP | S-24 |
| R-9 | Exceptions queue (refused posts, stale drafts, unmatched) | GAP | S-01 step 5 / S-11 |
| R-10 | Teaching layer (mentor) | PART | OD-19 → S-30 |

## 6. Controls (COSO 2013 control activities, owner-operator edition)

| ID | Control | Type | Frequency | Evidence it ran | Status |
|---|---|---|---|---|---|
| C-TAX-1 | 32000 excise rollforward ties to LIQ-1295 filed figure | detective | monthly by the 20th | rollforward report, diff = 0 | GAP → S-12 |
| C-TAX-2 | 32100/32200 tie to DOR return | detective | monthly by the 25th | same | GAP → S-12/S-13 |
| C-TAX-3 | Medical exemption records retained (69.50.535(2)(b)) | preventive | per sale | medical_exempt_sales (0040:83) | HAVE |
| C-CASH-1 | Daily till count with second count | preventive | daily | drawer counts (0314) | HAVE |
| C-CASH-2 | Bag custody chain | preventive | per bag | 0212/0316 | HAVE |
| C-CASH-3 | Cash proof: Σ bags = Σ deposits = bank | detective | daily | S-18 report | GAP |
| C-CASH-4 | Bank reconciliation signed off | detective | monthly by M+3 | gl_bank_reconciliations signed | GAP → S-17 |
| C-INV-1 | Every received lot has a cost or is a flagged sample | preventive | per receipt | lot-cost-classification (OD-15) | HAVE |
| C-INV-2 | 200xx GL = Σ lots × cost | detective | monthly | valuation report | GAP → S-21 |
| C-INV-3 | 20890 quarantine = 0 at close | detective | monthly | close checklist | GAP → S-11 |
| C-AP-1 | Bill posts only on 3-way match (autopost) | preventive | per bill | p_three_way_matched | PART → S-08 |
| C-AP-2 | ACH payment matched, not re-expensed (D-36) | preventive | per payment | match row | GAP → S-15 |
| C-PAY-1 | Payroll run approved by owner before posting | preventive | per run | draft → approve | HAVE |
| C-PAY-2 | 31xxx liabilities zero after remittance | detective | per period | rollforward | GAP → S-16 |
| C-EQ-1 | Distributions ≤ AAA/basis check before paying | preventive | per distribution | basis-aaa-core | GAP → S-27 |
| C-EQ-2 | 40400 OBE = 0 after OB close | detective | once | gl_close_opening_balance_equity | GAP → S-07 |
| C-IC-1 | 36000 nets to 0 across entities | detective | monthly | elimination report | GAP → S-24 |
| C-SOD-1 | Every self-approved journal over the flag threshold reviewed monthly | detective (compensating) | monthly | gl_override_report + review sign-off | PART → S-04 |
| C-GL-1 | TB = 0 for every entity | detective | daily | gl_trial_balance_check | HAVE |
| C-GL-2 | No non-manual draft older than 1 business day | detective | daily | exceptions queue | GAP → S-11 |
| C-GL-3 | Period locked after the return is filed | preventive | per filing | GL_PERIOD_LOCKED | PART → S-11 |
| C-GL-4 | An open period exists for today | preventive | daily | readiness banner | GAP → S-02 |

## 7. Month-end close checklist (the computed list S-11 implements)

1. All business days of M have `pos-day:` and `cogs-day:` journals posted (or, before S-03, zero un-approved sale drafts).
2. Zero refused autoposts outstanding (S-01b backfill done).
3. Every till close, bag and deposit in M has a posted journal; the S-18 cash proof shows no unexplained breaks.
4. 10200, 10300 and every 33000 card reconciled and signed off (C-CASH-4).
5. 10400 Undeposited = bags not yet deposited at M-end (list them).
6. 200xx = Σ lots × cost (C-INV-2). Count adjustments posted.
7. **20890 = 0** (C-INV-3).
8. 30000 = open bills aging total.
9. 31000–31300 tie to payroll registers/remittances.
10. 32000 rollforward ties to LIQ-1295 (C-TAX-1). 32100/32200 tie to DOR (C-TAX-2).
11. Depreciation, interest and B&O accrual drafts posted.
12. 36000 nets to 0 across entities (C-IC-1).
13. Self-approved journals over the threshold reviewed (C-SOD-1).
14. TB = 0 for all four entities (C-GL-1).
15. Owner closes the period (`gl_close_period`). After the return is filed, lock it.
