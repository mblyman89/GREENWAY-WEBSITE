# 08 — Target Architecture ("the power of the big boys, all for one")

> **Audience: me.** This is the end state the slices in part 09 build toward. Every box names the **existing** file, table or RPC it reuses (rule 4: reuse, don't rebuild).
> Where something new is required, it is marked **NEW** with the slice that adds it.
> Enterprise reference patterns (cited in part 13) are NetSuite/Oracle subledger → GL with summarized POS journals, the NetSuite month-end close checklist, COSO 2013 control activities, and Plaid `/transactions/sync` cursors.
> They are adapted to a single-store WA i502 retailer with 4 entities, one owner-operator and accrual basis (OD: cutover-core.ts:91-99).

---

## 1. Design principles (ranked; when two conflict, the higher one wins)

1. **The GL is a consequence, not a data-entry screen.** Every money event that already exists operationally produces its journal automatically from a pure `*-core.ts` builder. Human journals are the exception: corrections, accruals, owner equity.
2. **One authority per number (rule 25).** Taxes are computed once (sale-journal-core / order pricing) and stored per line (S-03c). The GL, the LIQ-1295 return, the DOR return and the receipt all read that stored number and never recompute it.
3. **Subledger detail, GL summary.** Orders, lots, bills, bags, payroll runs and bank lines are the subledgers. The GL holds daily or per-document summaries that link back via `source_ref`. A controller can drill from a GL line to the subledger rows that made it.
4. **Idempotent by construction.** `gl_submit_journal` is idempotent on (entity, source_kind, source_ref) (0174:344) and refuses changed lines with GL_POST_CONFLICT. Every poster derives `source_ref` deterministically from the business document, so a retried cron or double click can never double-book.
5. **Standing approval = template.** A `gl_posting_templates` row (0174) is the owner's signed, standing approval of a recurring journal *shape*. Autopost is allowed only through one (0174:494-541). This is the control an auditor wants, and it is already built. It is just empty (N-01).
6. **Fail safe, fail loud.** When the GL refuses, the operational action still succeeds (e.g. registers/actions.ts:250), **and** the refusal lands on a visible "Books exceptions" queue. Today it is silent. The target fixes the "loud" half, not the "safe" half.
7. **Integer cents, millionths for rates, dated rates (rule 114), Pacific time for business dates.**
8. **Owner-only books (0185 `is_owner()`), admin-capable operations (AP, payroll).** Operations write subledgers, and posting to the GL happens under a SECURITY DEFINER RPC. The wall stays.

---

## 2. Entity model (verified at 0172:75-76)

| Entity code | Tax shape | What flows into it | Notes |
|---|---|---|---|
| `greenway` | S-corp (1120-S), **280E** | all retail: sales, COGS, inventory, payroll, AP, excise, sales tax, B&O | 99% of volume. COGS is the only 280E deduction (26 CFR 1.471-3, Harborside 9th Cir.). |
| `atm` | Schedule C | ATM surcharge income 51000, ATM vault 10300, settlement | atm-settlement-service.ts posts. Vault custody S-22. |
| `landholding` | Schedule C | rental income 52000, land/building 21xxx, depreciation 78010 | Related-party rent with greenway: intercompany S-23. |
| `personal` | 1040 | 79xxx personal, distributions received, contributions made | Mirrors 41000/41100 on greenway (basis, S-27). |

**Intercompany rule:** every cross-entity event is **two journals with one `intercompany_ref`** (column exists on gl_journals, 0172), posted together. 36000 Due To/From nets to zero across entities. The elimination report (S-24) proves it, and it is never plugged.

---

## 3. The flow map, end to end (target)

```
                    OPERATIONS (subledgers, admin-capable)                      GL (owner-only)
┌───────────────┐   ┌───────────────────────────┐   pure builder            ┌────────────────────┐
│ POS order     │──▶│ orders / order_lines       │──▶ sale-journal-core ───▶ │ pos-day:<date>     │ daily summary (S-03)
│ medical repr. │──▶│ medical_exempt_sales 0040  │    (+exempt lines S-03b)  │  Dr 10110 tills    │
└───────────────┘   └───────────────────────────┘                           │  Cr 500xx revenue  │
┌───────────────┐   ┌───────────────────────────┐                           │  Cr 32000 excise   │
│ Refund        │──▶│ refunds                    │──▶ refund-journal-core ─▶ │  Cr 32100 salestax │
└───────────────┘   └───────────────────────────┘                           │ cogs-day:<date>    │
┌───────────────┐   ┌───────────────────────────┐                           │  Dr 600xx Cr 200xx │
│ Till close    │──▶│ drawer counts (0314)       │──▶ register-cash-journal ▶│ till-close:<id>    │ Dr 10400 Cr 10110 ±50920
│ Safe bag/seal │──▶│ deposit_bags (0212/0316)   │──▶ safe-bag-core ───────▶ │ seal-bag:<id>      │
│ Bank deposit  │──▶│ bag → bank                 │──▶ deposit-clearing-core ▶│ deposit:<id>       │ Dr 10200 Cr 10400
│ Card/debit    │──▶│ settlements                │──▶ card-payment-core ───▶ │ card:<id>          │
└───────────────┘   └───────────────────────────┘                           │                    │
┌───────────────┐   ┌───────────────────────────┐                           │                    │
│ PO / receive  │──▶│ inventory_lots, receipts   │──▶ receipt-journal-core ▶ │ receipt:<id>       │ Dr 200xx Cr 30000/20890
│ Vendor bill   │──▶│ vendor_bills (0187)        │──▶ vendor-bill-core ────▶ │ bill:<id>          │
│ AP payment/ACH│──▶│ ach files (0262/0274/0289) │──▶ NEW ap-payment-core ─▶ │ ap-pay:<id>        │ Dr 30000 Cr 10200 (S-15)
└───────────────┘   └───────────────────────────┘                           │                    │
┌───────────────┐   ┌───────────────────────────┐                           │                    │
│ Count/audit   │──▶│ inventory_adjustments      │──▶ migration-stock-core ▶ │ audit:<session>    │ (inventory-audit-store:485)
│ Payroll run   │──▶│ payroll runs (0188,0195+)  │──▶ payroll-posting-core ▶ │ payroll:<run>      │ + 61000 COGS alloc
│ Payroll remit │──▶│ 941/ESD/L&I filings        │──▶ NEW remit core ──────▶ │ remit:<agency>:<p> │ Dr 311xx Cr 10200 (S-16)
└───────────────┘   └───────────────────────────┘                           │                    │
┌───────────────┐   ┌───────────────────────────┐                           │                    │
│ Plaid feed    │──▶│ bank lines + gl_bank_matches│─▶ bank-match-core ─────▶ │ match only (no new │
│               │   │ gl_bank_reconciliations    │                           │  journal unless    │
│ Card expenses │──▶│ bank-expense               │──▶ bank-expense-core ───▶ │  bank-only item)   │
└───────────────┘   └───────────────────────────┘                           │                    │
┌───────────────┐                                                           │                    │
│ Tax returns   │──▶ excise-return-core / tax-base-core ──▶ NEW remit poster ▶│ excise-remit:<mo>  │ Dr 32000 Cr 10200 (S-12)
│ (LIQ-1295,DOR)│                                                           │ dor-remit:<mo>     │ Dr 32100/32200 Cr 10200
│ B&O accrual   │──▶ bo-tax-core#boAccrualEntry (wire, S-13) ─────────────▶ │ bo-accrual:<mo>    │ Dr 75040 Cr 32200
└───────────────┘                                                           │                    │
┌───────────────┐                                                           │                    │
│ Month-end     │──▶ fixed-assets-core (depr) / interest-core / accruals ──▶ │ depr:<mo>, accr:.. │
│ Close         │──▶ period-close-core → gl_close_period ───────────────────▶│ period status      │
└───────────────┘                                                           └────────────────────┘
```

---

## 4. Posting contract (the one shape every poster obeys)

```
submitJournal({                       // posting-service.ts:330 → gl_submit_journal 0174:344
  entityCode,                         // 'greenway' | 'atm' | 'landholding' | 'personal'
  journalDate,                        // Pacific business date, never UTC date of now()
  sourceKind,                         // one of the 16 in 0172:277-280
  sourceRef,                          // DETERMINISTIC: '<doc>:<id>' or '<doc>-day:<yyyy-mm-dd>'
  memo,                               // >= 3 chars (0172 check), human-readable
  lines: [{accountCode, amountCents}],// Σ = 0; leaf accounts only
  templateCode,                       // REQUIRED when autoPost=true (0174:504-511)
  autoPost,                           // true only for templated, count-verified events
  assumptionNote,                     // rule 12: any judgement recorded
  intercompanyRef,                    // pairs cross-entity journals
})
```

### 4.1 source_kind usage (the 16 values allowed by 0172:277-280)

| source_kind | Producer(s) today | Target producer | Autopost? (template) |
|---|---|---|---|
| `manual` | journal-entry-service.ts:346 (autoPost:false) | same | never |
| `opening_balance` | gl_bless_opening_balances 0176:348 | same (S-07) | never; owner blesses |
| `pos_sale` | sale-posting-service (per order, drafts, N-03) | daily summary `pos-day:` + refunds `refund:` | **yes**, `TPL-POS-DAY-<entity>` |
| `purchase` | receipt-service, vendor-bill-service | same + 3-way match (S-08) | yes only if 3-way matched (0174 rule) |
| `payroll` | gl_post_payroll_run (0188) | same + remittances | draft; owner approves the run |
| `excise` | none (N-11) | excise remittance poster (S-12) | yes, `TPL-EXCISE-REMIT` (amount = return) |
| `inventory` | inventory-audit-store.ts:485 (`audit:<session>`, **draft**; never autoPost, asserted by its own self-test ~:788-793) | same + cut-over inventory (S-06) | **never** (0174:494 GL_AUTOPOST_NOT_ELIGIBLE) |
| `bank` | drawer, seal-bag, deposit-clearing, supply-run (autoPost, **no template → refused**, N-01) | same + templates | **yes**, `TPL-TILL-CLOSE`, `TPL-SEAL-BAG`, `TPL-DEPOSIT`, `TPL-SUPPLY-RUN` |
| `loan` | none | related-party-loan-core (S-26) | draft |
| `crypto` | none | deferred (D-45, part 10) | — |
| `atm` | atm-settlement-service | same + custody (S-22) | never (not eligible); pure cash moves may use kind `bank` + TPL-ATM-CASH |
| `intercompany` | wrapper exists, no caller | S-23 | draft, paired |
| `depreciation` | fixed-assets-core (unreachable) | monthly depr (S-25) | never (draft, owner approves) |
| `accrual` | none | B&O accrual, month-end accruals (S-13/S-11) | never (draft) |
| `close` | gl_close_opening_balance_equity | year-end close (S-11) | never |
| `reversal` | gl_reverse_journal (no caller) | reversal UI (S-10) | owner only |

> **Note on non-eligible kinds (verified 0174:494-497):** only (pos_sale, excise, purchase, bank) can ever autopost. Any other kind with autoPost=true raises `GL_AUTOPOST_NOT_ELIGIBLE`.
> The inventory audit correctly never passes autoPost (inventory-audit-store.ts self-test near :788-793: *"THE JOURNAL IS NEVER AUTO-POSTED"*). So U-15 is **RESOLVED: no defect**.
> **Consequence for `atm`, `depreciation` and `accrual`:** these can never autopost under 0174. They land as drafts, and the approval queue (owner, self-approval per 0211) posts them.
> Widening the list would be a migration that changes a deliberate control ("they are estimates, allocations or judgments and always get a human review", 0174:495). **I do not propose widening it.** The ATM settlement row in the table below is therefore `bank`-kind only if the settlement is a pure cash movement; otherwise it is a draft.

### 4.2 Templates to seed (S-01; owner approves each row, Q-01)

Each template is a row in `gl_posting_templates` (verified at 0174:~120-160). Its columns are `code` (unique, ≥3 chars), `entity_id`, `source_kind` ∈ (pos_sale, excise, purchase, bank), `description` (≥10), `is_active` (default false), `approved_by`/`approved_at` (paired; active requires approved), `effective_from` (≥ 2026-01-01), `effective_to`, `tol_abs_cents`, `tol_milli_pct`, `max_autopost_cents` (>0), `change_reason` (≥10), and created/updated.
**Templates do NOT restrict accounts.** The gate checks entity, kind, active, approved, window, ceiling and tolerance vs `p_expected_cents` (0174:509-556). The "allowed accounts" column below is therefore **documentation of intent**. Enforcing it would need a new column/table and is a design choice (Q-15, new). Until then, the account discipline lives in the pure builders and their tests.
Tolerance only applies when the caller passes `p_expected_cents`. The till close should pass the counted total and the POS-day summary should pass Σ order totals, so the template genuinely compares two independent numbers.

| Template code (proposed) | Entity | Kind | Allowed accounts | Per-journal limit (proposal) | Rationale |
|---|---|---|---|---|---|
| TPL-TILL-CLOSE | greenway | bank | 10110, 10400, 50920 | $25,000 | daily till close; over/short to 50920 |
| TPL-SEAL-BAG | greenway | bank | 10400, 10100, 10900 | $50,000 | bag custody |
| TPL-DEPOSIT | greenway | bank | 10100/10400/10900 → 10200 | $100,000 | deposit clearing |
| TPL-SUPPLY-RUN | greenway | bank | 10100/10110, 76020, 76010, 12100 | $2,000 | petty supply runs |
| TPL-POS-DAY | greenway | pos_sale | 10110, 33000/10900 (card), 500xx, 50900, 50910, 32000, 32100, 72030 | $60,000 | daily revenue summary |
| TPL-COGS-DAY | greenway | pos_sale | 600xx, 200xx | $40,000 | daily COGS |
| TPL-EXCISE-REMIT | greenway | excise | 32000, 10200, 12300 | $100,000 | remit = return figure |
| TPL-ATM-CASH | atm | bank | 10300, 10100 (pure cash replenish/settle only) | $50,000 | surcharge income/intercompany parts stay drafts |

Limits are proposals only. **The owner sets them (Q-01).** I never pick a dollar number silently (rule 100).

---

## 5. Daily rhythm (business day D, Pacific)

| Time | Event | Journal | Proof |
|---|---|---|---|
| open | Till float issued (vault → till) | `bank` till-open (if modelled) or nothing (float stays in 10110) | drawer count |
| all day | Sales/refunds | **none per order** (target); subledger only | orders |
| close | Till close (second count 0314) | `till-close:<id>` autopost | counted vs expected; over/short |
| close | Seal bag | `seal-bag:<id>` autopost | bag id, custody (0316) |
| 23:59 → next 06:00 cron | **POS day summary** for D | `pos-day:D` + `cogs-day:D` autopost | Σ order_lines(D) = revenue + taxes; Σ lot cost of sold units = COGS |
| next bank day | Deposit | `deposit:<id>` autopost | bag → bank slip |
| T+1..3 | Plaid line arrives | **match**, not a new journal (bank-match-core) | gl_bank_matches row |
| daily | Exceptions queue | — | refused submits, unmatched > 3 days, drafts > 1 day, 20890 ≠ 0 |

**Cash proof (S-18), daily:** expected cash (cash tenders − cash refunds + float) = counted till; Σ sealed bags = Σ till-close transfers to 10400; Σ deposits matched = Σ bags. Every difference is an over/short line or an exception, never a plug.

---

## 6. Monthly close calendar (WA-tailored)

| Day | Task | System support (existing → target) |
|---|---|---|
| M+1 | Last POS day summary posted; drafts = 0 except manual | exceptions queue (NEW S-11) |
| M+1..3 | Bank recs for 10200, 10300, each card (33000) | gl_bank_reconciliations (0189) + rec screen (S-17) |
| M+2 | Inventory: Σ lots × cost = 200xx; count adjustments posted | cogs-position-core (S-20), inventory valuation (S-21) |
| M+3 | Payroll liabilities 31xxx tie to filings | payroll remittance (S-16) |
| M+3 | AP aging = 30000; 20890 quarantine = 0 | vendor-bill (S-08/S-15) |
| M+5 | Depreciation, interest, B&O accrual, prepaid amortisation | fixed-assets-core, interest-core, bo-tax-core (S-25/S-26/S-13) |
| M+5 | Intercompany 36000 nets to 0 | elimination (S-24) |
| **M+20** | **LCB excise LIQ-1295 due the 20th** (WAC 314-55-092); excise remittance journal | excise-return-core → `excise-remit:<M>` (S-12) |
| **M+25** | **DOR combined excise return due the 25th** (monthly filer; WAC 458-20-22801): retail sales tax 32100 + B&O 32200 | tax-base-core → `dor-remit:<M>` (S-12/S-13) |
| M+25 | Close period (`gl_close_period`, owner) after the checklist is green | period-close-core (unreachable → wire S-11) |
| year-end | 1120-S package, Form 7203 basis, AAA, distributions vs basis | s-corporation-year-core, basis-aaa-core (S-27) |
| on filing | Lock the period (`GL_PERIOD_LOCKED`, 0172:946) | period-close (S-11) |

---

## 7. Controls (COSO 2013 mapping; full checklist in part 11)

- **Control environment:** owner-only books (0185); separate logins from employees (0210).
- **Risk assessment:** the 280E exposure and trust-tax exposure are the two existential risks. Trust taxes (32000/32100) carry personal liability for responsible persons in WA, so they get daily accrual and monthly rollforward proof.
- **Control activities:**
  - templates (standing approval) and the $5k large-draft flag (approval-core; 0211 flag screen owed, "PR D")
  - gapless numbering (0172:240-252); indelible posted rows (prove-gl-indelible.sql); period lock
- **Information:** every journal has a memo (0172 check), source_ref drill-down, and an assumption_note (rule 12).
- **Monitoring:** exceptions queue, daily cash proof, monthly close checklist, census self-test.
- **Owner-operator compensating control:** self-approval is allowed (0211:97-104), so segregation of duties is replaced by **detective** controls: an after-the-fact review log of every self-approved journal over the flag threshold, a monthly external-bookkeeper review (74010), and immutable audit events (gl_audit_events).

---

## 8. Reporting layer (target)

| Report | Source | Status |
|---|---|---|
| Trial balance per entity / consolidated | 0175 RPCs, trial-balance-core | built |
| Balance sheet / P&L | financial-statements-core (+ui-core) | built, reachable; N-12 presentation |
| 280E P&L (COGS vs non-deductible) | cogs-position-core | **unreachable** → S-20 |
| Inventory valuation (lot level, 26 CFR 1.471-2 lower-of-cost-or-market) | lots × unit_cost | NEW S-21 |
| Excise rollforward (accrued vs returned vs remitted) | 32000 activity + excise-return-core | NEW S-12 |
| Sales-tax / B&O rollforward | 32100/32200 + tax-base-core | NEW S-12/S-13 |
| AP aging | vendor_bills | partial; S-15 |
| Cash proof | drawer/bag/deposit/Plaid | NEW S-18 |
| Shareholder basis / AAA / Form 7203 | basis-aaa-core, s-corporation-year-core | **unreachable** → S-27 |
| Fixed-asset register + depreciation | fixed-assets-core (0178) | **unreachable** → S-25 |
| Intercompany elimination | 36000 by intercompany_ref | NEW S-24 |
| Close checklist status | period-close-core | **unreachable** → S-11 |
| Statements mentor / learning path | learning-path-core, worked-examples-core | built (S-30 polish) |

---

## 9. What I will NOT build (scope guardrails)

- No second GL or second COA (rule 25). No "simplified" posting path that bypasses gl_submit_journal.
- No GAAP-vs-tax dual ledger now (part 10). Accrual tax basis is the one book.
- No auto-plugging, anywhere (rule 27). The OB bless 40400 difference is the single recorded exception (N-06).
- No per-order GL journals once S-03 lands. The subledger is the detail.
- No cron that posts without an idempotent source_ref and a claim (AGENTS.md:44).
