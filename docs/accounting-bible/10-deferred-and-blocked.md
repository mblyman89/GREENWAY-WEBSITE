# 10 — Deferred and Blocked (what I deliberately do NOT build yet, and why)

> **Audience: me.** Anything here is out of scope until its trigger fires. Building it early breaks rule 133 (no half-wiring) or rule 100 (owner facts).
> Each row records the **trigger** that moves it into part 09.
> Moving an item: add a line "MOVED → S-xx on <date> because <trigger>". Never delete a row.

## 1. Blocked on the owner (decision or documents)

> **2026-10-31 round 2:** every B-row below was answered (part 05 OD-22…OD-39). Status is prefixed in bold; rows are kept as history. F-02 (GAAP layer) is **un-deferred** by OD-34 → 15 G-08; F-04 (1099) is un-deferred for tax year 2027 → 15 E-05; F-08 (budgets) → 15 G-09.

| ID | Item | Blocked by | Trigger to unblock | Evidence pin |
|---|---|---|---|---|
| B-01 | **RETIRED 2026-10-31** by OD-22/OD-26: the 11/01 inventory journal is replaced by the year-end count (15 D-03 + I-03). Cut-over inventory journal (S-06) | **OD-08** "we are not ready to migrate inventory over yet." | Michael releases OD-08 in writing | DEFECTS.md:2439; ledger-census-data.ts:444-446 |
| B-02 | **RE-SCOPED** by OD-24: evidence is now Sage's 12/31/2026 TB (15 I-02). Opening-balance bless (S-07) | **D-47** Sage spreadsheets/evidence (Q-02) | Sage 10/31 TB + bank statements + loan statements received | DEFECTS.md:2105 |
| B-03 | **UNBLOCKED** by OD-29 (Q-07 b) → 15 B-01. Daily POS summary (S-03) | **Q-07** (it reverses books-82's per-order design) | Owner answer | 04 §N-03 |
| B-04 | **UNBLOCKED** by OD-23/OD-38; U-19 threshold default $5.00 → 15 A-03/C-02. Template rows (S-01) values | **Q-01, Q-16** ceilings/tolerances | Owner answer; until then rows ship `is_active=false` | 0174 template table |
| B-05 | **UNBLOCKED** by OD-31 (hybrid, part 14 Q-09) → 15 H-03. Intercompany payments from the ATM account (S-15/S-16 variants) | **Q-09**, OD-10, OD-12 | Owner confirms the loan vs. capital vs. due-to treatment | DEFECTS.md:2551, :3084 |
| B-06 | **DECIDED** by OD-28 (aggressive, warn not block) → 15 D-06/D-07. 280E position choice (S-20) | **Q-06** | Owner + CPA choose; the report can show all positions meanwhile | cogs-position-core (DC-03) |
| B-07 | **STILL DEFERRED** by OD-30. 12300 Excise Receivable use | **Q-08** | Owner/CPA | 04 §5 |
| B-08 | **DECIDED** by OD-32 → 15 D-04/D-05. Inventory write-down method (S-21 tail) | **Q-10** | Owner/CPA | 26 CFR 1.471-2/-4 |
| B-09 | **UNBLOCKED** by OD-37 → 15 A-04. Template account allow-list (S-01c) | **Q-15** | Owner answer | 08 §4.2 |

## 2. Deferred by design (owner or law says "not now")

| ID | Item | Why deferred | Revisit when |
|---|---|---|---|
| F-01 | **Crypto (D-45)** | Deliberate per DEFECTS.md:2063. `crypto` source_kind exists (0172:279), and no producer is wanted. Holdings would need FMV-at-receipt and lot basis tracking (property treatment, IRS Notice 2014-21). | Owner holds or accepts crypto in any entity |
| F-02 | **GAAP vs tax dual books** | One accrual tax-basis book (OD-02). A GAAP layer (ASC 606 loyalty deferral, ASC 842 leases, ASC 330 per ASU 2015-11 LCNRV) is only needed if a lender, investor or acquirer demands GAAP statements. | Q-12 answer = GAAP, or a lender asks |
| F-03 | **Rev. Proc. 98-29 retail safe-harbor shrink estimate** | Year-end only. It needs a full physical count history, and it may conflict with Greenway's perpetual lot system. | Dec 2026 (Q-11) |
| F-04 | **Form 1099-NEC/MISC production** | Vendors and contractors paid via AP. 2026 threshold $2,000 for NEC (per Pub 15 / 2026 update recorded in part 02). Needs vendor TIN capture (W-9). | Before Jan 31 2027; slice S-36 to be created in Dec |
| F-05 | **B&O tier above $1M (N-07)** | ATM service activity is far below $1M; the current .015 rate is correct for it. The .0175 tier applies ≥$1M, and the .021 tier applies to specific activities/very large taxpayers (DOR classifications page). | ATM service income nears $1M/yr (it won't soon) |
| F-06 | **Loyalty points as a liability (U-11)** | Under the tax-basis accrual book, points are a discount when redeemed (50900/72030), not a deferred-revenue liability. ASC 606 would defer. | F-02 triggers, or points become cash-redeemable |
| F-07 | **Multi-currency, multi-location consolidation** | One store, USD only. 4 entities are handled by `entity_id`, not consolidation software. | Second store license |
| F-08 | **Budgeting / forecasting** | Not an accounting-branch completion requirement. | After W6 |
| F-09 | **Sage export round-trip** | Parallel run ends 2026-12-31 (0186:123); after that Sage is read-only history. | Never, unless the CPA requires Sage files for 2026 |
| F-10 | **Self-service COA editing UI** | OD-14: "no asking, hard no! Block everything, gate everything lock everything." New accounts are migration-only. | Owner reverses OD-14 |
| F-11 | **Widening autopost-eligible kinds** | 0174:494-497 is a deliberate control (*"they are estimates, allocations or judgments and always get a human review"*). | Never; recorded refusal (rule 134) |
| F-12 | **SAR/FinCEN tooling** | FIN-2014-G001 obligations sit with the **bank** (marijuana-limited SARs). Greenway's duty is to keep clean, explainable deposit records. S-18 cash proof is the contribution. | Bank requests a specific report |

## 3. Known risks accepted for now (monitor)

| ID | Risk | Mitigation in place | Monitor |
|---|---|---|---|
| R-01 | Owner-operator self-approval removes segregation of duties (0211:97-104) | Detective controls: override log (gl_override_report, ledger-store.ts:370), gl_audit_events, monthly external bookkeeper review | part 11 C-SOD-1 |
| R-02 | 40400 plug at OB bless (N-06) | Recorded as an assumption_note, explained on screen (S-07), closed to 40300 by gl_close_opening_balance_equity | OB review |
| R-03 | Non-current liabilities presented as current (N-12) | Deliberate simplification. Loans are on the balance sheet, only misclassified by term. | Before any lender package |
| R-04 | Refused autoposts are invisible except in audit (N-01) | Operational action still succeeds; S-01b backfill is idempotent | Exceptions queue (S-01 step 5) |
| R-05 | Excise and sales-tax liabilities grow without a clearing journal until S-12 | The vendor-bill `excise_remittance`/`sales_tax_remittance` kinds (vendor-bill-core.ts:755/769) can clear them manually | Monthly rollforward |
