# 09 — Slice Plan (the ordered build list)

> **Audience: me.** Work top to bottom. Do not start a slice whose "Waits on" is unanswered. Record a refusal instead (rule 134).
> Every slice follows the recipe in part 06 §2: RED first, five gates, mutation campaign, invariants, census flip, DEFECTS UPDATE, owner-run step.
> AGENTS.md rule 5 is to ship up to 6 slices at a time, each its own branch → PR → **rebase-merge** (`gh pr merge <n> --rebase --delete-branch --admin`, never squash) → sync main.
> Pins were verified at `1f3e258a`. Re-grep before editing (rule 4).

---

## 0. The order at a glance

| Wave | Slices | Theme | Why this order |
|---|---|---|---|
| **W0, day 1 (11/01-11/03)** | S-00, S-02, S-01, S-03b | Make the cash and sales actually reach the GL, correctly | N-02 blocks every non-OB post. N-01 silently drops all cash journals. N-09 over-accrues trust taxes daily. |
| **W1, week 1** | S-03, S-04, S-05, S-07a, S-06a | Volume, approval parity, OB plumbing | N-03 floods drafts. N-05 latent. N-13 mislabels OB. |
| **W2, by 11/20 (first LIQ-1295 under the new system is due 12/20, but November accrual must be right)** | S-12, S-03c, S-18, S-17 | Trust taxes out, cash proof, bank rec | Excise is the first statutory deadline the new books must support. |
| **W3, November close (by ~12/25)** | S-11, S-10, S-13, S-08, S-15, S-16 | Close, reversal, B&O, AP and payroll clear their liabilities | Liabilities with a creator and no clearer grow forever (part 04 §5). |
| **W4, OB and inventory (owner-gated, OD-08)** | S-06, S-07, S-01b, S-09 | Opening balances, cut-over inventory, backfill, parallel-run proof | Waits on Sage spreadsheets (D-47) and the owner releasing OD-08. |
| **W5, before year-end** | S-20, S-21, S-25, S-26, S-22, S-23, S-24 | 280E position, valuation, assets, loans, ATM custody, intercompany | Needed for the 2026 1120-S and the Dec 31 balance sheet. |
| **W6, year-end and beyond** | S-27, S-30, S-31, S-35, S-16b, S-40 | Basis/AAA/7203, mentor, rule dating, controls, garnishments, crypto decision | |

---

## W0: day one

### S-00 Census truth and the reachability tool (docs + tests, no behaviour change)
- **Fixes:** N-04 (approval-exempt ≠ autopost-eligible), DR-01…DR-07 (docs drift, part 04 §7), N-10 baseline.
- **Files:**
  - `src/lib/accounting/ledger-census-data.ts`: add an `autopostEligible` / `templateRequired` notion per row. Rows for drawer, seal bag, deposit and supply run flip from "accepted" to "refused: GL_AUTOPOST_NO_TEMPLATE (N-01)", with evidence `0174:504-511`.
  - `src/lib/accounting/ledger-census-core.ts`: add a self-test asserting **every `autoPost: true` caller passes a `templateCode`**. Grep-style, like the caller-list assertions (DEFECTS D-31 :1398). It must FAIL on main (5 call sites: drawer-posting-service.ts:236, seal-bag-posting-service.ts:112, deposit-clearing-service.ts:317, supply-run-posting-service.ts:101, :179). It goes green with S-01. **Ship S-00 and S-01 together, or mark the test `todo` in S-00** (no red main).
  - `scripts/accounting-bible/reachability.py`: saved from the recon tool (part 06 §5).
- **Acceptance:** census text matches 0174. The reachability baseline is 20 unreachable, recorded in DEFECTS.
- **Waits on:** nothing.

### S-02 Periods: reseed after factory reset + readiness check (CRITICAL)
- **Fixes:** N-02.
- **Facts:**
  - Reset deletes `gl_periods`: 0209:556; table list 0240:257; factory-reset-core.ts:313 (WIPE).
  - `gl_open_fiscal_year` (0175:506) has zero callers.
  - `gl_post_journal` raises `GL_NO_PERIOD` at 0172:789. OB is exempt at 0172:780-782.
- **Build:**
  1. Migration `0329_*`: after the reset's wipe step, re-insert periods for the current and next fiscal year, mirroring 0175:567-576. **Or** move `gl_periods` to a "reset then reseed" list in the reset function. Choose whichever touches less of 0240; verify in PG15 with a new `verify-factory-reset-periods.sh`.
  2. Books home readiness: a pure `period-readiness-core.ts` (or extend period-close-core) that returns "no open period covers today" as a blocking banner.
  3. Owner-run step: the read-only periods check plus the idempotent insert in part 07 §7.3, **if U-02 shows periods missing**.
- **RED:** PG15. Reset → `gl_submit_journal(... 'bank' ...)` draft → `gl_post_journal` → `GL_NO_PERIOD`.
- **GREEN:** after reset, periods 2026/2027 exist and the post succeeds.
- **Invariant:** INV-06.
- **Waits on:** nothing. (U-02 decides only whether Michael must run the insert today.)

### S-01 Posting templates for the cash family (CRITICAL)
- **Fixes:** N-01, D-39 (half), D-72-D-76 (refused), and the census lie from N-04.
- **Build:**
  1. Migration: insert **inactive, unapproved** template rows (0174 columns; part 08 §4.2) for greenway/bank. Proposed codes: TPL-TILL-CLOSE, TPL-SEAL-BAG, TPL-DEPOSIT, TPL-SUPPLY-RUN.
     - `is_active=false`, so the migration never grants standing approval on the owner's behalf (rule 100).
     - `effective_from = '2026-11-01'`.
     - `max_autopost_cents` and tolerances are filled from Q-01/Q-16 answers.
  2. Owner screen: list templates; approve/activate (sets approved_by/approved_at = owner, is_active=true). **Verified: 0174 has no template-approve RPC.** Its functions are gl_guard_template_change_reason :213, gl_audit_template_change :238, gl_guard_template_changes_append_only :265, gl_idempotency_key :288, gl_line_fingerprint :317, gl_submit_journal :344, gl_submit_intercompany_pair :587, gl_approve_journal :735, gl_guard_journal_approval :805 and gl_mark_reversed :888. The update is audited by trigger into gl_template_changes, and `change_reason` (≥10) is required. A new owner-only `gl_approve_posting_template` RPC (or an RLS-guarded update) is needed.
  3. Pass `templateCode` and `expectedCents` from the five call sites.
  4. (If Q-15 = b) `gl_posting_template_accounts` allow-list, checked in gl_submit_journal. This is an additive `create or replace` of the function, so diff it carefully against 0174:344-570.
  5. Exceptions surface: registers/actions.ts:250 already records the refusal in audit. Add it to a Books "refused postings" list.
- **RED:** probe P-01 (`probe_autopost.sh`) → GL_AUTOPOST_NO_TEMPLATE.
- **GREEN:** with an approved active template → `GL_AUTOPOST_OK`, journal_no assigned.
- **Also prove:** over ceiling → GL_AUTOPOST_OVER_LIMIT; inactive → TEMPLATE_INACTIVE; wrong entity → WRONG_ENTITY.
- **Invariants:** INV-01, 02, 06, 07.
- **Mutation:** `mutate-slice-books-09` (drop templateCode at one site → census test fails; change the ceiling compare → PG test fails).
- **Waits on:** **Q-01** (template vs draft), **Q-16** (expected cents), **Q-15** (account allow-list; it can follow as S-01c).

### S-01b Backfill the refused cash journals (after S-01)
- Every till close, bag and deposit since 11/01 whose submit was refused can be re-submitted. The source_ref is deterministic, so re-submission is idempotent (INV-02).
- **Build:** an owner-run "re-post refused" action that iterates audit rows with the refusal code and calls the same service.
- **Acceptance:** the count of refused audit rows since 11/01 equals the count of journals created. TB=0.

### S-03b Medical-exempt lines: no excise, no sales tax in the GL (HIGH)
- **Fixes:** N-09 (and the refund mirror).
- **Facts:**
  - medical-pos-core reprices exempt lines, and `medical_exempt_sales` (0040:83) records the exemption.
  - sale-posting-service reads `order_lines` only (:170).
  - `extractTaxes` always uses the 14630 divisor (sale-journal-core.ts:239-243).
  - Mirror at refund-journal-core.ts:292/305.
- **Build:** sale-posting-service joins the exemption record per line and carries the register's **two independent flags** from medical-pos-core (`salesExempt`, `exciseExempt`; medical-pos-core.ts:165, :224-245).
  - `extractTaxes` zeroes each component only when its own flag is set. Revenue = the line's actual charged price minus whatever taxes were actually charged.
  - **Authorities (as the code already cites them; re-verify live before coding, AGENTS.md):**
    - RCW 82.08.9998: retail sales tax exemption for qualifying patients on DOH-compliant products (estimator-core.ts:20, :41).
    - **RCW 69.50.535(2)(a)** (fetched live 2026-10-31): *"Until June 30, 2029, the tax levied by subsection (1) of this section does not apply to sales by a cannabis retailer with a medical cannabis endorsement to qualifying patients or designated providers who have been issued a recognition card, of … products, identified by the department as a compliant cannabis product in chapter 246-70 WAC…"* (2)(b) requires eligibility records, and (2)(c) requires a **separate exemption line on the excise form**, so the LIQ-1295 builder (excise-return-core) needs Σ exempt amounts per month from the same stored record. WAC 314-55-090 is the implementing rule. The sunset is carried as config `excise_exemption_until`, default 2029-06-30 (medical-pos-core.ts:61-62, :201, :362).
    - Chapter 246-70 WAC: DOH compliant-product categories.
    So the excise exemption is **dated**. After the sunset the GL must accrue excise again even on medical lines. That is a rule-114 dated rule, and the test must cover a sale on each side of the sunset date.
  - Do **not** recompute the exemption in the GL. Read the register's decision (stored exemption record) so there is one authority (rule 25).
- **RED:** a golden ticket with one exempt line shows non-zero excise. **GREEN:** 0.
- **Invariants:** INV-04, INV-05.
- **Waits on:** **Q-05** (confirm the exemption record carries both flags per line; U-08/U-13 volumes). The fix itself is not owner-discretionary: the register already decided the tax, so the GL must agree with it.

---

## W1: week one

### S-03 Daily POS summary journals (volume)
- **Fixes:** N-03, D-66 wording.
- **Build:** `pos-day-journal-core.ts` (pure).
  - Input: all completed orders and refunds for business date D (Pacific).
  - Output: one revenue journal `pos-day:<D>` and one COGS journal `cogs-day:<D>`, reusing `buildSaleJournal`'s per-line logic summed by account.
  - A cron runs at 06:00 PT for D-1 (idempotent; claim per AGENTS.md:44). Plus a manual "post day" button.
  - Turn off the per-order submit at orders-store.ts:928 → sale-posting-service.ts:245-277, behind a dated switch, so pre-switch orders keep their per-order drafts and nothing is double-booked.
  - The template TPL-POS-DAY / TPL-COGS-DAY (kind `pos_sale`) passes `expectedCents` = Σ order totals.
- **Double-booking guard:** a day summary must exclude any order that already has `order:<id>#revenue` in gl_journals. The test proves it with a mixed day.
- **Invariants:** INV-01, 02, 04, 05, 09, 10 (Σ order_lines(D) = journal).
- **Waits on:** **Q-07** (owner must accept reversing books-82's per-order design).

### S-04 Approval parity + the $5k flag screen ("PR D")
- **Fixes:** N-05 (TS approval-core vs 0177 owner override/self-approval), OD-05 flag screen owed since 0211:6-12.
- **Build:**
  - approval-core mirrors 0177/0211 exactly. Tests enumerate (kind × amount × self × override) against a PG15 truth table.
  - Owner override toggle screen calling `gl_set_owner_override` (0177:187, no caller today).
  - Large-draft flag screen.
- **Waits on:** nothing for parity. U-03 (is 0211 live) only changes the copy.

### S-05 Discounts and dedupe on the sale journal
- Per part 04 census: discounts to 50900, comps to 72030 (loyalty). The dedupe of combined deals must not double-count.
- Pin the discount source in order pricing (order-pricing-core) and assert Σ discounts in the journal = Σ discounts on the receipt.
- **Waits on:** U-11 (loyalty liability model).

### S-07a Fix `EXPECTED_OPENING_ACCOUNTS` (N-13)
- `cutover-core.ts:247-265` labels 10100 "operating bank" (it is the vault) and 12100 "inventory" (it is employee advances). Inventory is 200xx under the 20000 parent, and the operating bank is 10200.
- **Build:** correct the list against 03c. Add a self-test that every code in the list exists in the COA with the asserted name. This kind of test would have caught the drift.
- **Waits on:** nothing.

### S-06a Cut-over one-pager additions
- `src/lib/pos/cutover-weekend-core.ts` `renderWeekendMarkdown`: add the 07:30 read-only lot snapshot, the periods check and the "refused postings are expected until S-01" note (part 07). Regenerate CUTOVER_WEEKEND_ONE_PAGE.md.
- **Waits on:** nothing. (After 11/01 its value is historical, so ship it only if the weekend is still ahead.)

---

## W2: trust taxes and cash proof

### S-12 Excise and sales-tax remittance journals
- **Fixes:** N-11, and the 32000/32100 "created, never cleared" gap.
- **Build:**
  - `tax-remittance-core.ts` (pure). From the filed return figures (excise-return-core, tax-base-core), it builds
    `excise-remit:<YYYY-MM>`: Dr 32000 / Cr 10200 (any difference to 12300 or an expense, per **Q-08**, never plugged), and
    `dor-remit:<YYYY-MM>`: Dr 32100 + Dr 32200 / Cr 10200.
  - Trigger: the payment confirmation (Q-13). Today the only path is a vendor bill of kind `excise_remittance` / `sales_tax_remittance` (vendor-bill-core.ts:755/769). **Choose one authority (rule 25):** either keep the bill path and document it, or retire it for the remittance core. Do not run both.
  - Rollforward report: opening liability + accrued − remitted = closing. It must tie to the return. A non-zero gap is an exception.
- **Deadlines:** LIQ-1295 due the 20th (WAC 314-55-092); DOR monthly due the 25th (WAC 458-20-22801).
- **Waits on:** Q-08, Q-13.

### S-03c Store excise and sales tax per order line (single authority)
- **Fixes:** D-32, N-08 (rate without an effective date).
- **Build:** a migration adds `excise_cents` and `sales_tax_cents` (and `rate_millionths`, with effective-dated rate rows) to order_lines, written at sale time by order pricing. sale-journal-core, the returns and the receipt read the stored values.
- Backfill historic lines from the current derivation, with an assumption_note.
- **Waits on:** nothing, but coordinate with S-03b (same functions).

### S-18 Daily cash-to-deposit proof
- Pure `cash-proof-core.ts`. For business date D: expected cash (POS) vs counted (drawer 0314) vs bags (0212/0316) vs deposits vs Plaid matches. Output: a list of breaks with amounts.
- Screen on Books home. Never posts. It only reports, and S-01 posts.
- **Waits on:** S-01.

### S-17 Bank match, reconciliation and sign-off
- Wire `gl_post_bank_match` (0189:537), `gl_unmatch_bank_row` (:712), `gl_bank_reconcile` (:774) and `gl_sign_off_bank_reconciliation` (:967). Use bank-match-core (reachable) for suggestions.
- **Plaid:** confirm that `/transactions/sync` handling removes or ignores `pending` and handles `removed` (U-09). A pending→posted transition must not double-match.
- **Acceptance:** November 10200 rec signs off with difference 0.
- **Waits on:** U-09.

---

## W3: November close

### S-11 Period close (wire period-close-core, DC-05)
- Close checklist screen from `findCloseCheck` (period-close-core:256) plus the part 11 checklist. `gl_close_period` (0172:891) and `gl_reopen_period` (:929); lock-on-filing (0172:946).
- Checklist items must be **computed**, not ticked: TB=0, drafts=0 (non-manual), 20890=0, every bank account reconciled, 32000 rollforward ties, 31xxx tie, 36000 nets to 0.
- **Waits on:** S-17 and S-12 for the rec/tax items (the checklist can show "not available" until then).

### S-10 Reversal
- Wire `gl_reverse_journal` (0172:826) and `gl_mark_reversed` (0174:888): an owner action on a posted journal requiring a reason (≥ N chars). The new journal is source_kind `reversal`.
- **Invariant:** INV-11.
- **Waits on:** nothing.

### S-13 B&O accrual and payment (DC-02)
- Wire bo-tax-core#boAccrualEntry (draft, kind `accrual`) and #boPaymentEntry (inside S-12's dor-remit).
- Rates are effective-dated (rule 114). The current owner rates are retailing .00471 and ATM service .015 (OD-18). N-07: the service tier above $1M is .0175 and the top tier .021 (DOR; verify).
- **Waits on:** nothing for retailing. N-07 tiers are fine to defer (part 10).

### S-08 PO → receipt → bill three-way match
- **Fixes:** D-61 (receipt and bill both debit inventory; still reachable), D-35 (PO→receipt), D-49 (cost via bill), freight.
- **Build:** receipt posts Dr 200xx / Cr 20800 (20800 "Inventory — In Transit" verified in 03c; used here as the GRNI clearing, which needs an owner OK because the name says in-transit). The bill posts Dr 20800 / Cr 30000. The difference is a price variance to COGS or inventory per 26 CFR 1.471-3 (freight-in is inventoriable).
  - Set `p_three_way_matched` only when PO = receipt = bill within tolerance.
- **Waits on:** Q-10 (write-downs) only for the variance treatment edge.

### S-15 AP payments / ACH (D-36)
- `ap-payment-core.ts`: an ACH file (0262/0274/0289) or check produces `ap-pay:<id>`: Dr 30000 / Cr 10200 (or 10300 per OD-10: vendors are paid from the ATM account from 11/01, **which makes it intercompany**: atm Cr 10300 / Dr 36000; greenway Dr 30000 / Cr 36000. Use `gl_submit_intercompany_pair`).
- **D-36 guard:** the bank line for the ACH must *match* this journal, not create a second expense.
- **Waits on:** Q-14, Q-09 (related-party money).

### S-16 Payroll remittances (and S-16b garnishments)
- 941 deposits, ESD, L&I and PFML/WA Cares → `remit:<agency>:<period>`: Dr 31100/31200 / Cr bank. Garnishments → Dr 31300 / Cr bank.
- D-68 (pay period ↔ run link) is fixed in the same slice.
- **Payroll from ATM (OD-10)** is intercompany, like S-15.
- **Waits on:** Q-09.

---

## W4: opening balances and inventory (owner-gated)

### S-06 Cut-over inventory journal (DC-08, D-48, D-51)
- Wire `cutover-inventory-core.ts` (940 lines, double-gated, no caller). Input: the lot snapshot (part 07 §2), which was the 07:30 read-only query on 11/01. Output: per-category Dr 200xx / Cr 40400 (or inside the OB worksheet; Q-04, recommendation A).
- Fractional/gram lots per Q-03. Zero-cost samples per OD-15.
- **Waits on:** **OD-08 release** ("we are not ready to migrate inventory over yet."), Q-03, Q-04.

### S-07 OB worksheet and bless screen (D-47)
- Screen over `gl_opening_balances` (0176) with evidence fields; `gl_opening_balance_summary` (already called at ledger-store.ts:331); bless → `gl_bless_opening_balances` (0176:348, dated `gl_opening_balance_date()` via 0186); then `gl_close_opening_balance_equity` (0176:514).
- **N-06:** the screen must explain the 40400 difference line before the owner blesses. The expected parts (e.g. inventory if done via S-06 option B) are itemised, and an unexplained remainder is shown in red.
- **Waits on:** **Q-02** (the Sage spreadsheets / evidence), S-07a.

### S-09 Parallel-run proof (Nov–Dec 2026, 0186:123)
- Monthly comparison: Sage TB vs Greenway TB per account mapping (gl_account_migration_map exists). Differences are explained or fixed, never plugged.
- **Waits on:** Michael exporting the Sage TB monthly.

---

## W5: before year-end

| Slice | What | Wires | Waits on |
|---|---|---|---|
| S-20 | 280E COGS position report (Form 1125-A view) | cogs-position-core (DC-03), payroll-cogs-core 61000 allocation | Q-06 |
| S-21 | Inventory valuation at lot level; LCM write-down path (26 CFR 1.471-2/-4) | new valuation core over inventory_lots | Q-10 |
| S-25 | Fixed-asset register + monthly depreciation drafts | fixed-assets-core (DC-04), 0178, 21xxx/78010 | asset list from owner |
| S-26 | Related-party loans: P&I split, AFR interest | related-party-loan-core (DC-07), interest-core | Q-09 |
| S-22 | ATM vault custody (D-57 position decided) | atm-settlement-service + new custody journal | — |
| S-23 | Intercompany pairs (D-41) | posting-service.ts:468 wrapper → gl_submit_intercompany_pair 0174:587 | Q-09, OD-12 |
| S-24 | Intercompany elimination report | 36000 by intercompany_ref | S-23 |

## W6: year-end and beyond

| Slice | What | Wires | Waits on |
|---|---|---|---|
| S-27 | Basis/AAA/Form 7203; 1120-S support | basis-aaa-core (DC-01), s-corporation-year-core (DC-09) | year-end figures |
| S-30 | Statements mentor (OD-19 visual learning) | financial-statements-mentor, mentor files (DC-11) | — |
| S-31 | Rule dating (D-30) / COA upsert path | gl_account_rules dating; gl_upsert_account (0173:374) behind OD-14's "block everything" | OD-14 stands: probably **no** UI, migration-only |
| S-35 | Internal-control self-assessment (COSO) | internal-control-core (DC-06) | — |
| S-16b | Garnishment remittance detail | 31300 | — |
| S-40 | Crypto (D-45) decision | — | part 10 |

---

## Cross-slice rules I must not forget

1. **One switch, one authority.** When S-03 turns off per-order journals, the switch is dated and the old path stays for pre-switch orders. Never two live paths for the same money.
2. **Every new core gets both runners:** a `__run…Tests` registration in run-pure-selftests.ts **and** a vitest file.
3. **Every migration:** idempotent, ordered guards (`MIGRATION_OUT_OF_ORDER` style, as 0192:78-97 does), an editor-safe twin if long, PG15 behavioural verifier, re-apply proven.
4. **Every owner-run SQL:** read-only first, expected result shown (part 06 §4.1).
5. **Pins move.** After each merge, re-grep the pins this plan cites for the next slice before editing.
