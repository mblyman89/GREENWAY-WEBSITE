# ACCOUNTING BIBLE — 04 · CURRENT STATE AND GAP MATRIX

> HEAD audited: `aa1f7a8a` (main, 2026-10-31). Everything here is measured. Each claim carries a
> `file:line` pin or the command that proves it. If a pin has drifted when you read this, re-run the
> command in the "re-prove" column. **Do not trust this file over the code.** Trust it over your memory.

Contents:

1. The six-layer census (40 business events)
2. New findings N-01 … N-12 (full write-ups)
3. Dead cores: rule-50 reachability scan
4. Writer RPCs with no caller
5. Trust-liability flow map (who credits, who debits)
6. DEFECTS.md cross-reference (D-30 … D-82), with the status the **code** shows
7. Docs drift (documents that now say something false)
8. What is genuinely good (do not "fix" these)

---

## 1. The six-layer census

Source: `src/lib/accounting/ledger-census-data.ts`, extracted by `scripts/accounting-bible/census_matrix.py`.

The census grades each business event on six layers:

| Layer | Question |
|---|---|
| exists | Is there a builder? |
| reachable | Does a runtime path call it? |
| correct | Are the debits and credits right? |
| accepted | Will the ledger accept the entry? |
| idempotent | Is a double run harmless? |
| married | Is it tied to an external evidence document (bank row, bill, return)? |

The **"line"** column is the census-data line of the row, so you can read the evidence text.

> ⚠️ **The census is itself wrong in one systematic way (finding N-04).** Its "accepted" layer
> marks the cash rows `NOT_APPLICABLE` because `bank` is approval-exempt. Approval exemption
> (`gl_guard_journal_approval`) is **not** autopost eligibility (`gl_submit_journal` template gate,
> 0174:494-541). Rows 22, 23, 25, 26 and 27 should read **MISSING** for "accepted" until S-01 lands.
> The column in the table below shows the census verbatim. My corrected reading is in the last column.

| # | census key | line | exists | reach | correct | accepted | idemp | married | **My reading** |
|---|---|---|---|---|---|---|---|---|---|
| 1 | revenue_and_tax_collected.retail_sale | :98 | P | P | PART | PART | PART | n/a | Wired (books-82). Lands as **2 drafts per sale** (N-03); medical lines over-accrue tax (N-09). |
| 2 | revenue_and_tax_collected.excise_liability_split | :172 | M | M | M | M | M | n/a | Stale. The split now exists inside sale-journal-core (`extractTaxes` :239-243). Census row predates books-82. **Docs drift DR-03.** |
| 3 | revenue_and_tax_collected.discount_and_comp | :222 | M | M | M | M | M | n/a | Real gap. Revenue is booked net of discount (paid × rate); 50900 is never used. A comp (free item) books zero revenue and full COGS, which is acceptable for tax, but there is no visibility. S-05. |
| 4 | revenue_and_tax_collected.refund_or_return | :252 | P | P | P | PART | P | n/a | refund-posting-service :272/:377 produce drafts. Same queue problem as N-03. |
| 5 | cost_of_goods_sold.cogs_on_sale | :327 | P | P | PART | PART | PART | n/a | Second journal of a sale (`#cogs`). Cost from lot plan (sale-posting-service.ts:352-470). |
| 6 | cost_of_goods_sold.cutover_inventory_load | :390 | PART | M | ? | PART | M | n/a | **D-48. URGENT.** Part 07. |
| 7 | cost_of_goods_sold.cultivera_manifest_import | :515 | PART | M | PART | M | PART | M | D-49: manifests carry no cost. Cost comes from the vendor bill (row 13). Acceptable if bill ↔ receipt matching (D-61) is settled. |
| 8 | cost_of_goods_sold.inventory_receipt | :597 | P | P | P | P | P | M | receipt-service.ts:318. "married" is MISSING: no link to the vendor bill. D-61. |
| 9 | cost_of_goods_sold.inventory_audit_adjustment | :664 | P | P | P | P | P | n/a | inventory-audit-store.ts:480, draft-only by design. |
| 10 | cost_of_goods_sold.freight_in | :713 | M | M | M | M | M | M | 60800 exists; no classifier kind routes to it unless vendor-bill-core has one. Grep `60800` → vendor-bill-core only. **Treat as PARTIAL, verify in S-08.** |
| 11 | vendor_cycle.purchase_order_commitment | :744 | M | M | n/a | n/a | n/a | n/a | Commitments are not GL events. Correct to leave. |
| 12 | vendor_cycle.goods_received | :793 | P | P | PART | P | PART | M | Same as row 8. |
| 13 | vendor_cycle.vendor_bill_recorded | :864 | P | P | P | P | P | M | vendor-bill-service.ts:462 + `gl_post_vendor_bill` (0187:383). The bills page references it. |
| 14 | vendor_cycle.expense_classified_to_account_and_entity | :922 | P | P | PART | PART | ? | n/a | expense-classification-core. D-56/D-80 history. |
| 15 | vendor_cycle.vendor_paid_by_ach | :1043 | M | M | M | M | M | PART | **Real gap.** AP (30000) is credited by bills and never debited. The ACH crons exist (`src/app/api/cron/ach-*`) but post nothing to the GL. D-36 (double-booking risk) must be designed around. S-15. |
| 16 | vendor_cycle.operating_expense_from_bank | :1087 | P | P | P | PART | P | n/a | bank-expense-service.ts:166/:228. The bank door (D-70 fixed books-88). |
| 17 | vendor_cycle.card_bill_paid | :1174 | P | P | P | PART | P | n/a | card-payment-core (33000). D-78. |
| 18 | payroll_cycle.payroll_run_accrued | :1252 | P | P | P | P | PART | M | `gl_post_payroll_run` via payroll-posting-service.ts:394 (draft-only by design :322-331). |
| 19 | payroll_cycle.net_pay_disbursed | :1330 | M | M | M | M | M | PART | Gap. Net pay liability (31000?) never debited. S-16. |
| 20 | payroll_cycle.payroll_tax_remitted | :1364 | M | M | M | M | M | M | Gap. 941 deposits never clear 31xxx. S-16. |
| 21 | payroll_cycle.garnishment_remitted | :1399 | M | M | M | M | M | M | Gap, low volume. S-16b. |
| 22 | cash_and_banking.till_open_from_vault | :1432 | P | M | P | n/a→**M** | M | n/a | Builder exists, no caller. And if called, N-01 refuses it. |
| 23 | cash_and_banking.till_close_to_safe | :1490 | P | P | P | n/a→**M** | P | M | drawer-posting-service.ts:236 → **refused (N-01)**. |
| 24 | cash_and_banking.cash_deposit_to_bank | :1561 | P | P | PART | M | P | PART | deposit-clearing-service.ts:317 → **refused (N-01)**. |
| 25 | cash_and_banking.seal_deposit_bag | :1626 | P | P | P | n/a→**M** | P | M | seal-bag-posting-service.ts:112 → **refused (N-01)**. |
| 26 | cash_and_banking.employee_supply_advance | :1699 | P | P | P | n/a→**M** | P | n/a | supply-run-posting-service.ts:101 → **refused (N-01)**. |
| 27 | cash_and_banking.till_over_short | :1780 | P | P | P | n/a→**M** | P | n/a | Inside the drawer journal (50920) → refused with it. |
| 28 | cash_and_banking.atm_vault_load | :1836 | M | M | PART | M | M | PART | D-57: custody, not revenue. Position decided, code not written. S-22. |
| 29 | cash_and_banking.atm_surcharge_income | :1894 | P | P | P | PART | P | PART | atm-settlement-service.ts:193 (draft). D-40 settlement half closed. |
| 30 | cash_and_banking.intercompany_transfer | :1977 | P | M | PART | M | ? | M | `submitIntercompanyPair` (posting-service.ts:443) has **zero callers** (census :1995 says so). atm-sweep-core classifies sweeps (intercompany / distribution) but posts nothing. S-23. |
| 31 | periodic_and_other.manual_journal | :2044 | P | P | P | P | n/a | n/a | journal-entry-service.ts:343 + /admin/books/journal. Works. |
| 32 | periodic_and_other.bo_tax_accrual | :2095 | P | M | P | M | M | n/a | bo-tax-core unreachable (DC-02). S-13. |
| 33 | periodic_and_other.excise_tax_remitted | :2145 | M | M | M | M | M | M | Only via a manually keyed vendor bill of kind `excise_remittance` (vendor-bill-core.ts:755). S-12. |
| 34 | periodic_and_other.fixed_asset_acquired | :2173 | PART | M | P | M | M | M | fixed-assets-core unreachable (DC-04). S-25. |
| 35 | periodic_and_other.depreciation_booked | :2222 | M | M | P | M | M | n/a | Same. |
| 36 | periodic_and_other.loan_activity | :2269 | PART | M | PART | M | M | M | related-party-loan-core unreachable (DC-07); D-44/D-59/D-60. S-26. |
| 37 | periodic_and_other.crypto_activity | :2332 | M | M | M | M | M | ? | D-45: deliberately deferred. Part 10. |
| 38 | periodic_and_other.period_close | :2374 | M | M | M | M | M | n/a | `gl_close_period` exists (0172:891), no caller. period-close-core unreachable. S-11. |
| 39 | periodic_and_other.reversal | :2412 | M | M | M | M | M | n/a | **Confirmed MISSING.** `grep -rn "reverseJournal\|gl_reverse_journal" src` finds only the comment at approval-service.ts:58. No posted entry can be undone from the app. S-10. |
| 40 | periodic_and_other.opening_balance | :2453 | PART | M | ? | M | M | n/a | **D-47. URGENT.** Part 07. |

**Tally (my reading):**

- **Effectively working end-to-end today** (assuming periods exist; see N-02): rows 8, 9, 12, 13, 16, 17, 18, 29, 31 (as drafts → approval queue).
- **Wired but refused at runtime:** rows 22–27 (N-01).
- **Wired, but a flood of drafts:** rows 1, 4, 5 (N-03).
- **Builder exists, no caller:** 30, 32, 34, 35, 36, 38, 40, and the bank RPCs.
- **Missing entirely:** 3, 10 (partial), 15, 19, 20, 21, 28, 33, 37.

---

## 2. New findings (N-series)

The numbering is stable. Never renumber. If one is disproved, mark it **WITHDRAWN** with the proof.

### N-01: Autopost without a template is refused (CRITICAL)

- **What:** five call sites submit `autoPost: true` and pass **no `templateCode`**:

  | Call site | Path |
  |---|---|
  | drawer-posting-service.ts:236 | Till close |
  | seal-bag-posting-service.ts:112 | |
  | deposit-clearing-service.ts:317 | |
  | supply-run-posting-service.ts:101 | |
  | supply-run-posting-service.ts:179 | |

  Inside `gl_submit_journal` (0174:344), with `p_auto_post = true`, the gate at 0174:494-541 runs:

  1. Kind must be in (pos_sale, excise, purchase, bank).
  2. `purchase` requires a three-way match.
  3. If `p_template_code is null` → `GL_AUTOPOST_NO_TEMPLATE` (0174:504-511).
  4. The template must exist, be active, approved, effective, match entity/kind, be within its limit and be within tolerance.
- **No migration inserts a row into `gl_posting_templates`.** Re-prove: `grep -ln "insert into public.gl_posting_templates" supabase/migrations` returns nothing.
- **Proof:** `scripts/accounting-bible/probe_autopost.sh` on PG15 with the harness + migrations: refusal reproduced.
- **What the user sees:** src/app/admin/registers/actions.ts:250 records the outcome in audit and **does not block**. So the till close "succeeds" operationally and **nothing reaches the GL**. That is the right fail-safe (rule 134) but it is invisible.
- **TS mirror:** posting-core.ts:388 `decidePosting` encodes the same NO_TEMPLATE rule, so the pure layer *knew*. The services just never pass a code.
- **Why it hid:** the census graded "accepted" from the approval trigger (exempt kinds) instead of the template gate. See N-04.
- **Fix shape:** S-01 in part 09.
  - Option A: seed templates (migration, owner-approved rows, one per kind/entity) and pass `templateCode` from each service.
  - Option B: submit as drafts (drop `autoPost`) and let the approval queue post them, since `bank` is approval-exempt and `post_only` is cheap.
  - **The choice is Q-01 (part 05).** My recommendation is A for the drawer/deposit family: these are high-frequency, count-verified events and the template is exactly the "standing approval" a controller would sign.

### N-02: The factory reset wipes periods and nothing reseeds (CRITICAL before cutover)

- **What:**
  - Reset deletes `gl_periods` (0209:556; table list 0240:257; factory-reset-core.ts:313 WIPE).
  - `gl_open_fiscal_year` (0175:506) has **zero callers** in src (re-prove: `grep -rn gl_open_fiscal_year src` → nothing).
  - `gl_post_journal` raises `GL_NO_PERIOD` (0172:789) when no period covers the date.
  - The opening-balance kind is **exempt** from the period check (0172:782), so OB can post, but everything else on 11/01 cannot.
- **Unverified:** whether the live DB had a reset after periods were opened (**U-02**). If Michael ran the reset (D-81/D-82 say he did use it to clean test data), periods are gone.
- **Fix shape:** S-02.
  - Reset must re-open the current fiscal year after wipe (or the KEEP list must include `gl_periods`; no, periods have status/closing history that a reset should clear).
  - Add a "periods exist for today" readiness check to the books home.
  - Ops step for 11/01: call `gl_open_fiscal_year(2026)` and `(2027)` once. Part 07 §7.3 gives the exact statement **for Michael to run**; I never run it on prod myself.

### N-03: Every sale lands as two drafts (HIGH, day 1)

- **What:** `postSaleForOrder` submits `order:<id>#revenue` and `order:<id>#cogs` (sale-posting-service.ts:245-277) with **no `autoPost`**. It is called on completion from orders-store.ts:928.
  - Owner-stated volume is about 200 in-store transactions/day (docs/slice-23…md:5), giving **≈400 drafts/day, ~12,000/month**.
  - `listDraftJournals` defaults to 200 and caps at 500 (approval-service.ts:188, 209).
  - `pos_sale` is approval-exempt, so `planApproval` returns `post_only`. But that is still **one click per draft**.
- **Side issue:** the COGS-failure message at sale-posting-service.ts:~281 says "Revenue is already on the books". It is only a **draft**. Wording is misleading (D-66 lesson: "on the books" ≠ status=posted). Low.
- **Fix options (Q-07):**
  - (a) Template + `autoPost` per sale. Two posted journals per sale is high volume, but Postgres handles 400/day trivially.
  - (b) **Daily summary journal**: one revenue + one COGS journal per business day per entity, built from the same `buildSaleJournal` over all completed orders of the day, sourceRef `pos-day:<yyyy-mm-dd>`. This is what enterprise retail (Oracle Xstore → GL, NetSuite POS summaries) does, and what an examiner expects.
  - (c) Bulk-approve button.
- **Recommendation: (b) for revenue/COGS, keep per-order drafts off.** Reasons:
  - It matches the LIQ-1295 / DOR monthly returns, which are sums.
  - Fewer journals means a readable GL.
  - The drawer close is also daily, so cash and revenue meet on the same day.
  - Per-order detail stays in `orders`/`order_lines` as subledger evidence.
  - **This reverses books-82's per-order design, so it is an owner decision. Do not do it silently.**

### N-04: The census conflates approval-exempt with autopost-eligible (MEDIUM, a docs/truth defect)

- ledger-census-data.ts marks the bank-family rows' "accepted" layer `NOT_APPLICABLE` (:1530, :1663, :1745, :1810).
- **Fix:**
  - Correct those four rows to MISSING with the N-01 evidence.
  - Add a census self-test asserting that every `autoPost: true` caller passes a `templateCode`. This is a grep-style test in the census core, like the existing "caller list" assertions (DEFECTS D-31 :1398).

### N-05: TypeScript approval parity with 0177 (HIGH, latent)

- planApproval (approval-core.ts:280-292) refuses when the actor is the author, the amount is ≥ threshold, and `!allowSelfApproval`.
- 0177 added:
  - `owner_override_enabled`
  - an `opening_balance` self-approval exemption (0177:322-327 in gl_approve_journal; :428 in the trigger)
- TS reads neither: approval-service.ts:282 and :445 select only `threshold_cents, allow_self_approval`.
- **Neutralised today** by 0211 (:97-104), which sets `allow_self_approval = true` everywhere and aborts if any row still blocks.
- **Bites when:** a second books user is added and the flag returns to false. The OB journal (≫ $5k) would be refused by TS while SQL would accept it.
- **Also:** `needs_second_approver` is computed and nothing renders it (0211 header, "PR D" in todo.md). So Michael's wanted $5k **warning** is invisible.
- **Fix:** S-04 (parity + flag badge on the drafts screen).

### N-06: The opening-balance bless plugs silently-but-loudly to 40400 (MEDIUM, design tension with rule 27)

- `gl_bless_opening_balances` (0176:348) computes the worksheet difference and **adds a 40400 line for it** (0176:452), writing an `assumption_note` (0176:474-476). Todo rule 27 says never plug.
- The SQL is honest: it records the plug, and `gl_ob_readiness` / summary (0176:320-328) shows it before blessing.
- **Forces in the slice:** the OB screen (S-07) must treat **any non-zero plug as a blocker** requiring Michael's typed acknowledgement, and must show the source of every row's evidence.
- `gl_close_opening_balance_equity` (0176:514) later moves 40400 → 40300.
- **Note:** 40400 is **also** the credit side of the inventory OB (OPENING_BALANCE_EQUITY_CODE cutover-inventory-core.ts:178). So 40400 is expected to carry a large legitimate balance until the full balance sheet is entered. "Plug" here means only the *unexplained difference*.

### N-07: B&O service rate tiers (LOW)

- `DEFAULT_BO_RATES.service_and_other = 15000` is correct only below $1M prior-year service income (DOR: 1.75% for $1M–$4.99M; 2.1% for $5M+).
- Measured ATM surcharge is ≈ $16,272.50 (related-party-loan-core.ts:191), so it is not live.
- **Fix:** S-13 makes rates dated and tiered.

### N-08: The sales tax rate has no effective date (MEDIUM, latent)

- `SALES_TAX_BPS = 930` (sale-journal-core.ts:98), mirrored and checked against order-pricing-core by `SALE_TAX_RATES_MATCH_POS` (comment :84-95).
- A WA local rate change (quarterly possible) changes POS and ledger together, which is good. But **historic periods re-derived after a change** would split old sales at the new rate.
- Today `buildSaleJournal` runs once per order at completion, so it is safe. With the N-03 option (b) daily summary rebuilt later, it would become unsafe.
- **Forces:**
  - Any rebuild must use the rate in force on the sale date.
  - The tax actually collected should be **stored per order line** at sale time, not re-derived. D-32 says `orders` has no excise column; this is the root fix.

### N-09: Medical-exempt sales over-accrue excise and sales tax in the GL (HIGH)

- **What:**
  - Medical lines are **repriced** at the register (medical-pos-core.ts header: "the exemption is passed through by REPRICING the line's unit price to base + (still-due tax)").
  - The exemption is recorded in `medical_exempt_sales` (0040:83: `sales_tax_exempt`, `excise_tax_exempt`, `excise_amount_exempt_minor`).
  - The endorsement is seeded true (0040:66-68).
  - `sale-posting-service.ts` reads `order_lines` (`price_minor_units`, `quantity`, `category`; :170) and **never reads `medical_exempt_sales`**.
  - `sale-journal-core.ts#extractTaxes` (:239-243) splits every cannabis line with the 14630 divisor. Re-prove: `grep -n -i medical src/lib/accounting/sale-journal-core.ts src/lib/accounting/sale-posting-service.ts` → nothing.
- **Effect:** for an excise-exempt line at repriced paid amount P (= base × 1.093), the GL books excise = P×3700/14630 and sales tax = P×930/14630. It should book excise 0 and sales tax 0 (or P×930/10930 if only excise is exempt).
  - 32000 is **overstated**. Revenue is **understated** by the same amount.
  - The LIQ-1295 box (which compliance computes from medical exemption records) will **not tie** to 32000. That breaks control C-TAX-1.
- **Size:** depends on medical volume (unknown; **U-13**). Even small volume makes the trust account permanently disagree with the return.
- **Fix:** S-03b.
  - `postSaleForOrder` loads `medical_exempt_sales` rows for the order (index `med_exempt_order_idx` exists) and passes per-line exemption flags into `SaleLineInput`.
  - `extractTaxes` gains an exemption parameter.
  - The test "excise presence must follow isCannabis" (sale-journal-core.ts:728) is amended to "…unless excise-exempt".
  - Mutation: drop the flag → test must fail.
- Note that the refund path (returns-core.ts:38-40) explicitly relies on repricing ("no medical special-casing needed at refund time"). **Verified:** refund-journal-core.ts:305 says "Taxes are extracted from each refund with the same divisors as the sale entry (14630 cannabis, 10930 other)" and :292 pushes excise back. **The refund has the mirror defect.** S-03b fixes both together.

### N-10: 20 of 111 accounting modules are unreachable from runtime (MEDIUM, rule 50)

- See §3. Not a bug by itself; these are the **un-connected foundation** Michael referred to ("The foundation is set mostly I think, its connections that need to be made").

### N-11: Excise payment writes no journal (MEDIUM)

- The compliance excise flow (excise-return-core, excise-send-core, excise-payment-core) builds the return and a pay-station link. `grep -rln "submitJournal\|gl_" src/lib/compliance` returns **nothing**.
- 32000 is cleared only if Michael separately keys a vendor bill of kind `excise_remittance`. That is double entry by a human, and a forgotten one leaves 32000 growing forever.
- **Fix:** S-12: when the excise payment is confirmed (`wa-quarterly/confirmation`-style receipt or LCB confirmation), post Dr 32000 / Cr 10200 with sourceRef `excise-remit:<yyyy-mm>`. Married to the return.

### N-12: Non-current liabilities are always presented as current (LOW, deliberate)

- `loadNonCurrentAccountCodes` returns `[]` (financial-statements-store.ts:194), deliberately and loudly, until loan terms are on file.
- **Fix:** comes with S-26 (loans).

---

## 3. Dead cores: rule-50 reachability scan

Method: `python3 /tmp/reach.py`, reproduced in `scripts/accounting-bible/` as part of S-00 if wanted. It builds the import graph from every `src/app/**` file (plus middleware), follows `@/` and relative imports, and lists `src/lib/accounting/*` files never reached. Result saved at `/workspace/notes/reachability.txt` during recon: **91 reachable of 111**.

| id | Module | Lines | What it would give Greenway | Wire in slice |
|---|---|---|---|---|
| DC-01 | basis-aaa-core.ts | 1278 | Shareholder stock/debt basis + AAA, pro-rata check, carry-forward (Form 7203) | S-27 |
| DC-02 | bo-tax-core.ts | 942 | B&O accrual + payment journals, three-type breakdown | S-13 |
| DC-03 | cogs-position-core.ts | 1260 | Form 1125-A under each 280E position; position comparison | S-20 |
| DC-04 | fixed-assets-core.ts | 1380 | MACRS schedules, disposal, purchase-price allocation, account per class | S-25 |
| DC-05 | period-close-core.ts | 868 | Close/reopen verdicts, close checklist (`findCloseCheck` :256) | S-11 |
| DC-06 | internal-control-core.ts | 364 | COSO assessment, SoD finding | S-04 (badge) / S-35 |
| DC-07 | related-party-loan-core.ts | 1188 | ATM circuit split, bona-fide test, AFR, FIFO repayments | S-26 |
| DC-08 | cutover-inventory-core.ts | 940 | **The opening inventory journal** | **S-06 (URGENT)** |
| DC-09 | s-corporation-year-core.ts | 413 | S-year classification, OB carry-forward rule | S-27 |
| DC-10 | ledger-census-core.ts + ledger-census-data.ts | 3329 | The census itself (only tests read it) | S-00 (a census screen is optional) |
| DC-11 | *mentor / mentor-gates / worked-examples-gates* (8 files) | ~2100 | Teaching layer that follows the cores | with each core |
| — | financial-statements-mentor.ts | 401 | | S-30 |

Wiring rule for every DC (todo rule 133, no half-wiring): a DC is "wired" only when **all four** hold:

1. A server action or cron imports it.
2. A screen shows its output or refusal.
3. Its journals reach `submitJournal` with a stable `sourceRef`.
4. The census row flips with evidence.

---

## 4. Writer RPCs with no caller

Re-prove with `grep -rn "<name>" src`. Definitions from part 03b.

| RPC | Defined | Callers in src | Consequence | Slice |
|---|---|---|---|---|
| gl_open_fiscal_year | 0175:506 | **none** | N-02 | S-02 |
| gl_close_period | 0172:891 | none (named only in period-close-core/-authorities) | No close | S-11 |
| gl_reopen_period | 0172:929 | none | — | S-11 |
| gl_bless_opening_balances | 0176:348 | none (census text only) | D-47 | S-07 |
| gl_close_opening_balance_equity | 0176:514 | none | — | S-07 |
| gl_post_bank_match | 0189:537 | none (bank-expense-service.ts:20-24 explains why it went via submitJournal) | No bank match | S-17 |
| gl_unmatch_bank_row | 0189:712 | none | — | S-17 |
| gl_bank_reconcile | 0189:774 | none | No bank rec | S-17 |
| gl_sign_off_bank_reconciliation | 0189:967 | none (named in gl-refusal-core) | — | S-17 |
| gl_submit_intercompany_pair | 0174:587 | posting-service.ts:468 wrapper, **wrapper has no caller** | D-41 | S-23 |
| gl_set_owner_override | 0177:187 | **none** (books-client.ts only lists it; grep verified) | Override toggle has no screen | S-04 |
| gl_upsert_account | 0173:374 | **none** (only a grep recipe in a comment, expense-classification-core.ts:200) | COA changes need a migration; acceptable, decide in S-31 | S-31 |
| gl_mark_reversed | 0174:888 | named in trial-balance-core | — | S-10 |
| gl_reverse_journal | 0172:826 | **none** (comment at approval-service.ts:58 only) | No undo for a posted mistake | S-10 |

RPCs that **are** called (for contrast):

| RPC | Called at |
|---|---|
| gl_submit_journal | posting-service.ts:330 |
| gl_approve_journal | posting-service.ts:415 |
| gl_post_journal | approval-service.ts:494 |
| gl_post_payroll_run | payroll-posting-service.ts:394 |
| gl_trial_balance_check | ledger-store.ts:97 |
| gl_general_ledger | ledger-store.ts:138, 180 |
| gl_opening_balance_summary | ledger-store.ts:331 |
| gl_override_report | ledger-store.ts:370 |
| gl_post_vendor_bill | referenced from bills page (bills/page.tsx:21 comment; the action goes through vendor-bill-service) |

---

## 5. Trust- and control-liability flow map

Who credits (creates) and who debits (clears) each liability. A liability with a creator and no clearer grows forever. That is the single most common silent failure in a small-business GL.

| Account | Created by | Cleared by | Status |
|---|---|---|---|
| 32000 Excise payable (TRUST) | sale-journal-core revenue journal | Manual vendor bill `excise_remittance` only | **Gap N-11 / S-12.** Plus overstatement N-09. |
| 32100 Sales tax payable (TRUST) | sale-journal-core; refund reverses | Manual vendor bill `sales_tax_remittance` only | Gap S-12 |
| 32200 B&O payable | bo-tax-core#boAccrualEntry (**unreachable**) | bo-tax-core#boPaymentEntry (**unreachable**) | Gap S-13 |
| 30000 Accounts payable | vendor-bill-service | **nothing** (no ACH/pay poster) | Gap S-15 |
| 31000–31300 Payroll liabilities | gl_post_payroll_run | **nothing** | Gap S-16 |
| 33000 Credit cards | bank-expense (card charges) | card-payment-core | OK |
| 34000 Loans | — | — | Gap S-26 |
| 36000 Due to/from | atm-sweep classifier (no post) | — | Gap S-23 |
| 10400 Undeposited funds (asset) | drawer journal | deposit-clearing (D-75 fixed) | **Both refused by N-01** |
| 20890 Quarantine (asset) | vendor-bill `unknown` | manual reclass | Needs close-checklist item "20890 = 0" (S-11) |
| 40400 OBE | OB bless + cutover inventory | gl_close_opening_balance_equity | Uncalled (S-07) |
| 12300 Excise receivable | — (no code references) | — | Unused account; probably for refund/overpayment credits. Q-08. |

---

## 6. DEFECTS.md cross-reference (D-30 … D-82)

Heading line numbers are in docs/DEFECTS.md. **"Code says"** is what I verified, which may differ from the defect's last status.

| D | Line | Title (short) | Recorded status | Code says (2026-10-31) | Slice |
|---|---|---|---|---|---|
| D-30 | 1282 | rule table can't be effective-dated | Workaround (dated layer in atm-classification-core) | Unchanged; table index still forbids dating | S-31 |
| D-31 | 1344 | no sale reaches the GL | Wired books-82 | Wired → drafts (N-03), medical (N-09) | S-03 |
| D-32 | 1408 | excise vs sales tax not stored | Open | Derived at post time; not stored per line (N-08) | S-03c |
| D-33 | 1436 | COGS never booked | Wired books-82/83 | `#cogs` journal exists | — |
| D-34 | 1488 | vendor bill builder unreachable | Wired | vendor-bill-service.ts:462 | — |
| D-35 | 1513 | PO → receipt not connected | Open | 20800 in-transit unused | S-08 |
| D-36 | 1538 | ACH payment double-booked | Open (design hazard) | No ACH poster exists yet | S-15 |
| D-37 | 1561 | bank feed cannot post | Partly fixed by D-70 (books-88) | Expense door works; match/rec RPCs uncalled | S-17 |
| D-38 | 1586 | payroll journal dev-only | **CLOSED books-86** | payroll-posting-service draft-only | — |
| D-39 | 1895 | till→vault→bank not booked | HALF CLOSED books-94 | Wired but **refused (N-01)** | S-01 |
| D-40 | 1925 | ATM classifier posts nothing | CLOSED settlement half books-89 | settlement draft OK; vault load not | S-22 |
| D-41 | 1967 / 2551 | intercompany door no caller | Opinion given | Still no caller | S-23 |
| D-42 | 1991 | B&O no caller | Open | DC-02 | S-13 |
| D-43 | 2010 | fixed assets unwired | Open | DC-04 | S-25 |
| D-44 | 2047 | loan P&I not split | Open | DC-07 | S-26 |
| D-45 | 2063 | crypto not booked | Deliberate | — | part 10 |
| D-46 | 2082 | no close, no reversal | Open | close uncalled; reversal U-12 | S-10/S-11 |
| D-47 | 2105 | OB no path | **BLOCKED on Sage spreadsheets** | Unchanged | S-07 |
| D-48 | 2132 | cutover inventory no path | **BLOCKING** | DC-08 | **S-06** |
| D-49 | 2199 | manifests carry no cost | Open | Cost via bill | S-08 |
| D-50 | 2246 / 2404 | category map | **DECIDED** (own map) | ledger-category-map-core reachable | — |
| D-51 | 2312 | cutover builder no caller | Built, double-gated | No caller | S-06 |
| D-52 | 2447 | own map guards unreachable | Noted | — | — |
| D-55 | 2642 | entity structure vs Harborside | Analysis | owner decision context | Q-06 |
| D-56 | 2771 | txn → (account, entity, class) | Built | expense-classification-core | — |
| D-57 | 2847 | ATM custody account | **Position decided, code not written** | — | S-22 |
| D-58 | 2922 | dead refusal codes | FIXED books-75 | — | — |
| D-59 / D-60 | 3002 / 3084 | loan engine / label risk | Open | DC-07 | S-26 |
| D-61 | 3203 | receipt + bill both debit inventory | "Fixed explicitly, reachable by omission" | Still reachable | S-08 |
| D-62 / D-63 | 3327 / 3389 | reset stale / retention | Closed | — | — |
| D-64 | 3420 | category free text | Mapped (D-50) | — | — |
| D-65 | 3452 | decrement lots not told | Used by sale COGS gatherCosts | OK | — |
| D-66 | 3490 | "hit the books" ≠ posted | Lesson | Wording in sale-posting-service (N-03 side issue) | S-03 |
| D-67 | 3548 | every entry stranded as draft | **CLOSED books-85** (approval queue) | Queue works; volume problem N-03 | S-03 |
| D-68 | 1669 | pay period ↔ run link | Fix described | Open | S-16 |
| D-69 / D-70 | 1716 / 1825 | login on payroll / bank poster | Fixed books-87/88 | — | — |
| D-71 | 3698 | refusal only in URL | Fixed | — | — |
| D-72 / D-73 / D-74 | 3783-3932 | cost unknown / drawer accounting / uncounted | Fixed | Drawer journal refused by N-01 | S-01 |
| D-75 / D-76 | 3995 / 4051 | 10400 one-way / ageing | Fixed books-95/96 | Refused by N-01 | S-01 |
| D-77 | 4138 | till close "to safe" | Fixed books-98 | — | — |
| D-78 | 4193 | card bill double expense | Fixed books-99 | — | — |
| D-79 / D-80 | 4269 / 4314 | role tag / account owner | Fixed books-100 | — | — |
| D-81 / D-82 | 4357 / 4404 | factory reset guards / timeout | Fixed 0238/0240 | **Reset wipes periods (N-02)** | S-02 |

**When a slice closes a defect,** append an UPDATE block to DEFECTS.md (rule 131). Never edit the original text.

---

## 7. Docs drift (documents that now say something false)

| id | Document | What it says | Truth | Fix in |
|---|---|---|---|---|
| DR-01 | BOOKS_ROADMAP "Also outstanding" R1 (from :1616) | An RLS finding is open | Closed by 0190 (owner-only RLS) | S-00 |
| DR-02 | ledger-census-data.ts :1530, :1663, :1745, :1810 | accepted = NOT_APPLICABLE | MISSING (N-01) | S-01 |
| DR-03 | census row 2 `excise_liability_split` | MISSING | Split exists in sale-journal-core | S-00 |
| DR-04 | CUTOVER_WEEKEND_ONE_PAGE.md:42 | No books steps | Part 07 has them | S-06 (add after Michael approves) |
| DR-05 | 00-INDEX of this bible (first version) | N-05 CRITICAL | Latent (0211). Corrected in commit after 31ce8cd2 | done |
| DR-06 | 02 of this bible (first draft) | "income-tax basis" | ACCRUAL, cutover-core.ts:94 | done |
| DR-07 | sale-posting-service.ts ~:281 | "Revenue is already on the books" | It is a draft | S-03 |

---

## 8. What is genuinely good: leave alone

- **Ledger core (0172):**
  - double-entry enforced in SQL
  - gapless numbering (`gl_journal_sequences` 0172:240)
  - drafts carry no `journal_no` (0172:319 check)
  - period check
  - cost-class checks
  - reversal function
- **Idempotency on `sourceRef`** in `gl_submit_journal`: this is what makes the backfill strategy in part 07 safe.
- **Integer cents everywhere**, `divRoundHalfUp`, millionths for B&O (rule 114).
- **Refusals are sentences**, recorded (rule 134). Callers never block operations on a books failure.
- **The authorities discipline**: every rule cites a source id.
- **Factory reset KEEP/WIPE classification** (factory-reset-core.ts:222-313). Only the periods reseed is missing.
- **Approval queue (books-85)** and the **0211 self-approval reasoning**: correct for a sole operator.
- **Tax-inclusive split constants proven equal to POS** (`SALE_TAX_RATES_MATCH_POS`).
- **Vendor-bill classifier** with trust/quarantine treatments and common-mistake text.
- **The cutover inventory builder** (cutover-inventory-core.ts:346) with its mutation-proven guards (D-51).
