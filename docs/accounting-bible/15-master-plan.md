# ACCOUNTING BIBLE — 15 · THE MASTER PLAN (every slice, by block)

> **Audience: Michael and me.** This is the roadmap of record from 2026-10-31 (OD-39). It **supersedes the order** in part 09. Part 09's slice texts (RED/GREEN proofs, pins) stay valid as detail, and §Y maps old IDs to new ones.
> Every slice follows the part 06 recipe: RED test first, five gates, mutation campaign, invariants, census flip, a DEFECTS UPDATE, and an owner-run step written read-only-first.
> One branch → one PR → **rebase-merge** per slice (AGENTS.md rule 5: up to 6 in flight).
> Pins are as of `c0363fbb`. **Re-grep before editing** (rule 4).

---

## 0. The master plan in one screen

**Goal.** On **1/1/2027** the Greenway platform becomes the book of record for all entities, opened from Sage 50's audited 12/31/2026 balances and the year-end full count. The quality bar is Sage 50 Quantum / Intacct (OD-22a).

**Strategy, in four sentences:**

1. **November–December is a dress rehearsal on real data.** Every feeder is wired and posts into the GL while Sage stays the official book. I prove each one against Sage's numbers for the same days.
2. On 12/31 we count, close Sage, wipe **only** the rehearsal journals, flip the dates, and load the opening balances.
3. January is the first real month and runs alongside a light Sage shadow.
4. The January close (by about 2/25) is the graduation exam: TB ties, bank reconciles, tax returns tie, and the Internal Accounting Review is clean.

**Why rehearse instead of wait:** every slice gets about 8 weeks of real transactions (≈12,000 sales, 2 excise months, 2 payroll months, 4+ bank statements) before it counts. Bugs show up on rehearsal data, not on your 2027 books.

**Key mechanics decision.** `gl_conversion_config` stays at **2026-11-01 / 2026-10-31** during rehearsal. Bank matching refuses lines dated before the cut-over (GL_BANK_PRE_CUTOVER, 0189:599), so moving the dates now would block the November rehearsal. The flip to **2027-01-01 / 2026-12-31** happens once, inside slice I-01, right after the rehearsal wipe.

---

## 1. Timeline

| Window | Phase | Slices (in priority order) | Exit gate |
|---|---|---|---|
| **Tonight 10/31** | — | Owner: run the Q-05 SQL (part 14). | Endorsement row = false |
| **11/01 – 11/15** | Rehearsal build 1: foundations | A-00, A-01, A-02, A-06, A-03, A-04, A-05, A-07, A-08, I-00 | Every cash event posts by template in rehearsal; periods exist through 2027-12; medical is one fail-closed switch |
| **11/16 – 11/30** | Rehearsal build 2: sales, cash, bank | B-01, B-03, B-04, B-05, C-01, C-02, C-03, C-04, C-05 | Rehearsal November sales TB = Sage November sales; bank rec of November statement |
| **12/01 – 12/15** | Rehearsal build 3: taxes, AP, payroll, inventory | F-01, F-02, F-03, F-04, F-05, E-01, E-02, E-03, D-01, D-02, D-04, D-05, G-01, G-02 | November LCB + DOR returns tie in rehearsal (filed for real by their due dates from Sage/existing tools) |
| **12/16 – 12/31** | Year-end preparation | D-03, D-06, I-02, I-03, I-04, H-01, H-02, H-03, H-06, G-03, G-04 | Count plan published; OB loader proven on a Sage November TB; rehearsal November close passes the IAR |
| **12/31 – 1/10** | **Cut-over** | Year-end count → Sage close → I-01 (wipe + flip) → I-04 (OB load) → I-05 (bless) | OB blessed per entity; TB = Sage post-closing TB |
| **1/1 – 2/25** | **Live month 1** | I-06, C-06, D-07, H-04, H-05, E-04, G-05 | January closed and locked; IAR clean; parallel proof signed |
| **Feb – Jun 2027** | Strengthen | G-06, G-07, G-08 (when a lender appears), H-07, E-05, J-01…J-04 | Q1 close; 941/W-2 tie-outs; 1120-S 2027 support ready by 2028 |

**Statutory dates inside the window:**

- LCB excise (LIQ-1295) is due the **20th** of the following month.
- DOR combined excise return (monthly filer) is due the **25th**. When a due date falls on a weekend/holiday it moves to the next business day: November 2026's LCB return (12/20 is a Sunday) and DOR return (12/25 is Christmas) both move. December 2026's DOR return is due **Monday 1/25/2027**. Confirm each date on the agency site (part 12 U-24).
- Federal payroll deposits follow your deposit schedule.
- W-2/1099-NEC for 2026 are due 1/31/2027 and come **from Sage/your payroll provider**, not us.
- The first W-2/1099 cycle we own is **2027 (due 1/31/2028)**.

---

## 2. How to read a slice

Each slice lists:

- **Why** — the purpose, in plain English.
- **Needs** — code, data and pins.
- **Depends** — the slices that must merge first.
- **Done when** — the acceptance proof.
- **You** — the owner step, if any.

"Rehearsal" means it posts real Nov–Dec data that I-01 wipes.

---

## Block A · Foundations and controls (the plumbing every other block stands on)

### A-00 Census truth and reachability tool (was S-00)
- **Why:** the census (ledger-census-data.ts) is our scoreboard (OD-06). It still mixes up "approval-exempt" with "autopost-eligible" (N-04) and counts 20 unreachable modules (N-10).
- **Needs:** fix the N-04 columns; make `scripts/accounting-bible/reachability.py` a CI report (baseline 91/111).
- **Depends:** — · **Done when:** the census shows a true reachable/posting status per event, and CI prints the reachability count. · **You:** —

### A-01 Cut-over dates have one authority
- **Why:** the go-live moved to 1/1/2027 (OD-22). The dates live in the DB row `gl_conversion_config` (0186:132-135) **and** in hard-coded TS constants (cutover-core.ts:66, :73, :76-77; stale "2025-12-31" at ledger-core.ts:166). Two authorities will drift (rule 25).
- **Needs:**
  - TS reads the config row (as /admin/books/conversion/page.tsx:138 already prefers it). The constants become fallback-only, labelled.
  - A pure `conversionPhase(date)` helper returning `rehearsal | cutover | live`, used by every screen to show a "REHEARSAL — not the official books" banner during P1.
  - The flip itself is **not** run here (it runs in I-01).
- **Depends:** — · **Done when:** grepping for the date literals finds only the fallback and tests; a mutation that changes the config row changes the UI. · **You:** —

### A-02 Periods: re-seed after reset, open fiscal 2027, readiness check (was S-02, CRITICAL)
- **Why:** factory reset deletes every `gl_periods` row (0209:556). Nothing re-seeds them, and every post then fails GL_NO_PERIOD (0172:789) (N-02).
- **Needs:**
  - Reset re-seeds the periods for the current and next fiscal years.
  - "Open fiscal year" button on /admin/books (calls `gl_open_fiscal_year`, 0175:506, which has no callers today).
  - Readiness card: "periods exist through 2027-12 for every entity".
- **Depends:** — · **Done when:** PG15 test resets → posts → succeeds. · **You:** press "Open 2027" once (or I give you the SQL).

### A-03 Posting templates for the cash family (was S-01, Q-01 → OD-23)
- **Why:** five cash call sites autopost with no template and are refused (N-01).
- **Needs:**
  - Template rows (shipped `is_active=false`): TPL-TILL-CLOSE, TPL-SEAL-BAG, TPL-DEPOSIT-CLEAR, TPL-SUPPLY-RUN-CARD, TPL-ATM-SETTLE.
  - Each call site passes `templateCode`.
  - An owner **template screen** to review, approve and activate each template with its ceiling and tolerance. Self-approval is logged (OD-04).
- **Depends:** A-02 · **Done when:** probe P-01 (`scripts/accounting-bible/probe_autopost.sh`) goes from refused → posted. · **You:** approve each template on screen.

### A-04 Template account allow-list (Q-15 → OD-37)
- **Why:** a template should approve a *shape* (which accounts), not just a size.
- **Needs:**
  - Additive migration: `gl_posting_template_accounts(template_id, account_code, side)`.
  - Check inside `gl_submit_journal` (0174:344). On a violation it falls back to a draft and records the reason GL_TEMPLATE_ACCOUNT_NOT_ALLOWED.
  - The template screen shows the list.
- **Depends:** A-03 · **Done when:** PG15: an off-list account becomes a draft, not posted. · **You:** —

### A-05 Approval parity and the "$5k notify" screen (was S-04; OD-04, OD-05)
- **Why:**
  - `approval-core.ts#planApproval` ignores 0177's owner override and opening-balance branch (N-05, latent).
  - You asked for large invoices to **notify and let you approve**, not block (OD-05).
- **Needs:** TS mirrors 0177; a "large items" notice list; the threshold is editable.
- **Depends:** — · **Done when:** parity tests between SQL and TS for every policy row. · **You:** set the notify threshold.

### A-06 Medical endorsement: one switch, fail-closed, dated (Q-05 → OD-27)
- **Why:** three switches exist today (part 14 Q-05). The one the register uses has no UI and fails **open** (src/lib/medical/tax.ts:36).
- **Needs:**
  - An owner toggle on /admin/medical that writes `medical_endorsement_config` and mirrors `tax_settings.medical_endorsement`. Turning it on requires an endorsement number and an effective date.
  - The default when there is no row = **not endorsed**.
  - Fix the 0040 seed comment drift and the contradiction in medical-testmode-core.ts:10.
  - An audit event per flip.
- **Depends:** — (**B-02 must ship before you ever turn it ON**) · **Done when:** with the row deleted the register shows no medical discount; the flip is logged. · **You:** after the merge, open /admin/medical and confirm "Not endorsed".
- **Status:** BUILT (OD-40). Migration 0329 + `endorsement-switch-core.ts` + owner panel on /admin/medical. The same slice adds the owner request in OD-40: a **register medical test mode** switch (default HIDDEN) that removes the test-mode item from every register's MORE menu and switches it off on the next menu refresh. Owner applies 0329 manually. The 0040 seed comment drift is handled by 0329 (default false, legacy TRUE-without-number row switched OFF); medical-testmode-core.ts header corrected.

### A-07 Exceptions inbox: refused and parked postings (R-04)
- **Why:** today a refused autopost is visible only in `audit_log`. Enterprise systems show an **exceptions queue**.
- **Needs:** /admin/books/exceptions listing GL refusals (code, plain-English sentence, resolution, source link) and a "retry" button (posters are idempotent on sourceRef).
- **Depends:** A-03 · **Done when:** a forced refusal shows up with its sentence and retries cleanly. · **You:** glance at it daily (part of the 5-minute routine).

### A-08 Journal dimensions: `book` and related-party classification hooks
- **Why:** we add the cheap columns now so later features need no data migration (Q-12 GAAP layer; Q-09 tags).
- **Needs:**
  - `gl_journals.book text not null default 'tax'` (check 'tax' | 'gaap_adj').
  - `gl_journal_lines.rp_class` (null | loan | capital | distribution | ic_charge).
  - Reports filter book = 'tax' by default.
- **Depends:** — · **Done when:** additive migration + verifier; all reports unchanged. · **You:** —

---

## Block B · Sales and sales tax

### B-01 Daily POS summary journals (was S-03; Q-07 → OD-29)
- **Why:** per-order journals would make about 400 drafts a day (N-03).
- **Needs:**
  - A pure builder that aggregates one business day per entity: revenue by category account, discounts, excise 32000, sales tax 32100, tenders → clearing, plus a COGS journal at lot cost.
  - sourceRef `pos-day:<entity>:<yyyy-mm-dd>`.
  - Posted by template TPL-POS-DAY after the drawer close.
  - A **dated switch** (rule 114): days before it use the old per-order path, which is then retired (one authority).
- **Depends:** A-03, A-04 · **Done when:** the rehearsal November daily totals equal the orders table to the cent, and Sage's November sales. · **You:** approve TPL-POS-DAY.

### B-02 Medical-exempt lines in the GL (was S-03b, priority lowered by OD-27)
- **Why:** the GL ignores exemptions (sale-journal-core.ts:239-243; refunds :292/:305) while the return honours them (excise-return-core.ts:39-40). That is harmless while unendorsed, and **mandatory before A-06 is ever turned on**.
- **Needs:** per-line exemption flags flow into B-01's aggregation.
- **Depends:** B-01, B-03 · **Done when:** with test mode on in a sandbox, an exempt line accrues $0 excise/sales tax in the GL and on the return. · **You:** —

### B-03 Store excise and sales tax per order line, with rate effective dates (was S-03c; N-08)
- **Why:** a single source of tax truth per line, and dated rates for when WA/local rates change.
- **Needs:** order_lines tax columns written at sale; `tax_rates` with `effective_from`; returns and B-01 read the stored values and never recompute them.
- **Depends:** — · **Done when:** a rate change mid-month splits correctly. · **You:** enter the rate changes when DOR announces them.

### B-04 Discounts, loyalty and dedupe on the sale journal (was S-05)
- **Why:** discounts must be visible (gross sales − discounts = net). Loyalty is a discount when redeemed (U-11, tax-basis). Avoid double counting.
- **Needs:** contra-revenue lines; a fingerprint dedupe test.
- **Depends:** B-01 · **Done when:** gross/discount/net tie to the POS Z-report. · **You:** —

### B-05 Refunds, voids and post-close returns
- **Why:** a return after the day's journal (or after a filed month) must reverse the right revenue, tax and COGS, and restock the lot at cost.
- **Needs:** refund lines aggregated into the day of the refund. Tax credits feed the next return (the excise return already supports credits). Restocked units go back to inventory, damaged ones to quarantine (D-04).
- **Depends:** B-01, D-04 · **Done when:** a refund in a later month adjusts that month's return correctly. · **You:** —

---

## Block C · Cash and bank

### C-01 Cash events post by template
- **Why:** till close, seal bag, vault → deposit, deposit clearing, and supply runs on the card (OD-17).
- **Needs:** services from A-03 wired. Undeposited aged cash **posts with a warning** (OD-16, deposit-clearing-core.ts:716). The deposit account per U-18 (default 10200).
- **Depends:** A-03 · **Done when:** one rehearsal week of every cash event is posted with no exceptions. · **You:** answer U-18 if not 10200.

### C-02 Till over/short against POS expected cash (Q-16 → OD-38)
- **Why:** an over/short beyond your threshold should wait for you; small ones post (to an over/short account).
- **Needs:** pass `p_expected_cents` = POS-expected (0174:548-556); tolerance = U-19 (proposed $5.00).
- **Depends:** C-01 · **Done when:** a $20 short becomes a draft with the reason shown; a $2 short posts. · **You:** confirm $5.00 or give your number.

### C-03 Daily cash-to-deposit proof (was S-18)
- **Why:** proves every cash dollar sold reached the bank (C-CASH-1…4 in part 11). This is the core cannabis control (cash-heavy, FinCEN optics).
- **Needs:** a daily proof report: POS cash → drawer counts → seal bags → deposit → bank line, with breaks highlighted.
- **Depends:** C-01, C-04 · **Done when:** November rehearsal proof shows zero unexplained breaks. · **You:** review weekly.

### C-04 Plaid bank match (was S-17a)
- **Why:** Timberland transactions must be paired to journals so nothing is recorded twice (your Q-13 hope).
- **Needs:**
  - Match engine on `gl_post_bank_match` (0189:537).
  - Rules: amount + date window + payee pattern.
  - Pending lines are refused (bank-match-core:948).
  - Unmatched bank lines become a "categorize" list that can create a journal from a template.
- **Depends:** C-01, F-03, E-01 · **Done when:** 95%+ of November rehearsal lines auto-match. · **You:** categorize the rest (about 10 minutes a week).

### C-05 Bank reconciliation and sign-off (was S-17b)
- **Why:** Sage-style monthly rec: statement ending balance = book balance ± outstanding items, signed and locked.
- **Needs:** `gl_bank_reconciliations` screen; statement PDF attach; sign-off feeds the period close (G-02).
- **Depends:** C-04 · **Done when:** November statement reconciled in rehearsal. · **You:** upload the statement PDF monthly.

### C-06 ATM vault custody and settlement (was S-22)
- **Why:** cash in the ATM belongs to the ATM entity (D-57). Settlements and surcharge revenue post to the ATM books, with B&O at .015 (OD-18).
- **Needs:** atm-settlement-service + custody journal; ATM-entity templates.
- **Depends:** C-01, H-03 · **Done when:** ATM entity TB ties to the processor statements for a month. · **You:** —

### C-07 Credit card (33000) statement and payment
- **Why:** supply runs go on the low-limit card (OD-17). The monthly statement and payment must clear 33000.
- **Needs:** card statement import or Plaid account; payment journal by template; match.
- **Depends:** C-04 · **Done when:** card balance = statement. · **You:** —

---

## Block D · Inventory and COGS

### D-01 PO → receipt → bill three-way match (was S-08)
- **Why:** inventory and AP must agree. A receipt raises inventory and accrued AP; the bill clears it; price/qty variances are explained.
- **Needs:** wire the receipt journal (Dr 200xx / Cr 30000 AP, or a received-not-billed accrual if the COA gains one (OD-14: migration-only)) and the bill match; purchase autopost only when 3-way matched (0174 rule).
- **Depends:** A-03 · **Done when:** a November rehearsal vendor's receipts + bills tie to the lot costs. · **You:** —

### D-02 Cycle-count posting with reason codes (Q-11 → OD-33, Q-10 → OD-32)
- **Why:** every approved audit session books its result; the count system already exists.
- **Needs:** reason codes on discrepancy lines; inventory-audit-post-core extended to post shrink (60810) or quarantine moves (20890) per reason. Still an owner-approved draft.
- **Depends:** D-04 · **Done when:** a rehearsal cycle count posts each reason to the right account. · **You:** approve count journals.

### D-03 Year-end full count = valuation event (Q-11, Q-04 → OD-26)
- **Why:** one count gives Sage's 2026 closing inventory and our 2027 opening inventory.
- **Needs:**
  - When all sections of the 2026 `full_count_id` are approved (full-count-core), produce:
    - (a) the valuation report by lot/category, with samples shown at $0 (OD-15);
    - (b) the Sage adjusting entry (count value vs Sage balance);
    - (c) per-category totals for I-04.
  - A roll-forward if the count is not on 12/31.
- **Depends:** D-02 · **Done when:** a dry run on a partial count produces all three outputs. · **You:** set the count date (default 12/31 after close) and run the count.

### D-04 Write-downs: quarantine, subnormal goods, book vs tax (Q-10 → OD-32)
- **Why:** unsaleable product is written down when known (book), and deducted for tax when disposed with evidence (26 CFR 1.471-2(c)).
- **Needs:**
  - Quarantine move at cost to 20890; write-down Dr 60810 / Cr 20890.
  - A per-lot `tax_status` (book-only until destroyed or sold within 30 days).
  - 20810 reserve unused by default; if used, it is an automatic tax add-back (1.471-2(f)(1)).
- **Depends:** — · **Done when:** the year-end report lists every book-only write-down as an add-back. · **You:** —

### D-05 Destruction evidence closes the lot
- **Why:** destruction is the tax event. It posts **no new expense** (already written down) but flips the add-back to deductible.
- **Needs:** destruction-evidence-core (photo/video, witness, CCRS record) linked to the quarantine lot; census row (ledger-census-data.ts:293) updated.
- **Depends:** D-04 · **Done when:** a destroyed lot disappears from the add-back list. · **You:** record destruction evidence as you do now.

### D-06 Payroll COGS: follow the employee record, warn don't block (Q-06 → OD-28)
- **Why:** you chose the aggressive position: the employee's COGS percent drives the split.
- **Needs (all three layers together, rule 133):**
  - payroll-posting-core.ts:387 builds the allocation from `employee_pay.labor_role_code` + `cogs_split_basis_points` (0195:381-387) instead of refusing.
  - The `gl_payroll_allocation_guard` trigger (0188:480-534) accepts an allocation that carries an acknowledgement id; it refuses only unacknowledged ones.
  - payroll-cogs-core.ts severities "block" → "warn" (:1772, ceiling :1008), except: `owner_officer` (:957) stays refused, plus balance and 0–100%.
  - New `gl_payroll_risk_acknowledgements` (who, when, reason, evidence refs, warning codes). The plain-English sentences already exist in payroll-cogs-core.
- **Depends:** E-02 · **Done when:**
  - mutation tests prove each warning fires;
  - an acknowledged run posts;
  - an unacknowledged run cannot post through any layer.
- **You:** review each employee's COGS role and percent before the first 2027 payroll (U-23).

### D-07 §280E position and Form 1125-A support report (was S-20)
- **Why:** shows COGS and tax under the conservative (Harborside) and your chosen position side by side, with add-backs (D-04), for your CPA.
- **Needs:** cogs-position-core (DC-03) wired to real data; the 1125-A line mapping.
- **Depends:** D-04, D-06 · **Done when:** January 2027 report produced. · **You:** record your CPA's name and position memo date.

### D-08 Vendor credits, returns and samples
- **Why:** returned product reduces inventory and AP. Samples stay at $0 and separate (OD-15).
- **Needs:** vendor credit memo journal (Dr 30000 / Cr 200xx); sample lots excluded from valuation totals but listed.
- **Depends:** D-01 · **Done when:** a credit memo nets against the next bill. · **You:** —

---

## Block E · Accounts payable and payroll

### E-01 AP payments by template (was S-15; Q-14 → OD-36)
- **Why:** an admin paying an **approved** bill should post on its own (OD-03 lets admins pay).
- **Needs:** TPL-AP-PAYMENT (Dr 30000 / Cr bank, allow-list); payments without an approved bill go to your queue; ATM-account payments use the intercompany pair (OD-10, H-03).
- **Depends:** A-03, A-04, H-03 · **Done when:** a rehearsal payment run posts and matches its bank lines. · **You:** approve TPL-AP-PAYMENT.

### E-02 Payroll journal from each payroll run
- **Why:** gross wages, employer taxes, withholdings and net pay must post per run, with the COGS split (D-06).
- **Needs:** payroll-posting-core wired to the payroll run record; the liabilities 31xxx by tax. From **2027-01-01** payroll is paid from the ATM account (OD-10), so the intercompany pair applies.
- **Depends:** A-02 · **Done when:** rehearsal November payroll = payroll register. · **You:** —

### E-03 Payroll remittances and garnishments (was S-16, S-16b)
- **Why:** each withholding liability must be cleared by its deposit (941 deposits, WA ESD, L&I, PFML, WA Cares, garnishments 31300).
- **Needs:** remittance record + confirmation (same pattern as F-03), template journal, bank match.
- **Depends:** E-02, C-04 · **Done when:** every 31xxx account returns to the expected balance after its due date. · **You:** attach confirmations.

### E-04 Quarterly 941 / ESD tie-outs
- **Why:** each quarter's filed totals must equal the GL (an IAR check).
- **Needs:** a tie-out report.
- **Depends:** E-02 · **Done when:** Q1 2027 ties by 4/30/2027. · **You:** —

### E-05 W-2 and 1099 support for 2027 (F-04 un-deferred for 2027)
- **Why:** the first year we own (filed January 2028). The 1099-NEC threshold rises to $2,000 for payments made after 2025, inflation-indexed later (part 13).
- **Needs:** vendor 1099 flags + TIN on file (W-9); annual totals; export.
- **Depends:** E-01 · **Done when:** a 2027 YTD 1099 report exists by 6/2027. · **You:** collect W-9s.

---

## Block F · Trust taxes (LCB excise, DOR sales tax and B&O) (Q-13 → OD-35)

### F-01 LCB excise return tie-out (LIQ-1295)
- **Why:** the return you file must equal what the books accrued (C-TAX-1).
- **Needs:** excise-return-core output (the same CSV template you use) beside the 32000 accrual for the month; differences listed with causes.
- **Depends:** B-01, B-03 · **Done when:** rehearsal November ties to the cent. · **You:** download the CSV from here instead of building it by hand.

### F-02 DOR combined excise return record (sales tax + B&O)
- **Why:** there is no DOR return record today.
- **Needs:** new `tax_returns` (authority, period, lines by tax type and location code, totals, status) built from B-01/B-03 and F-05; tie to 32100/32200 (C-TAX-2).
- **Depends:** B-03, F-05 · **Done when:** the rehearsal November DOR figures equal what you file. · **You:** —

### F-03 Payment confirmation + PDF → remittance journal
- **Why:** the confirmation is the proof of payment; the journal clears the liability.
- **Needs:**
  - Confirmation number, amount, date and PDF upload on F-01/F-02 records (LCB fields already exist, 0051).
  - Storage bucket private.
  - TPL-TAX-REMIT posts Dr 32000/32100/32200 / Cr 10200.
- **Depends:** F-01, F-02, A-03 · **Done when:** attaching a confirmation posts once (idempotent) and C-04 matches the bank line. · **You:** paste the number and drop the PDF.

### F-04 Retire the vendor-bill path for taxes
- **Why:** one authority. `excise_remittance` / `sales_tax_remittance` bills (vendor-bill-core.ts:755/769) would double-book with F-03.
- **Needs:** those kinds refuse with a sentence pointing to the Tax Returns screen; historical rows stay.
- **Depends:** F-03 · **Done when:** creating one is refused with the explanation. · **You:** —

### F-05 B&O accrual and payment (was S-13; OD-18)
- **Why:** B&O is a business tax (expense, not trust). Retail .00471, ATM service .015.
- **Needs:** bo-tax-core (DC-02) monthly accrual Dr 7xxxx / Cr 32200 per entity; paid in the same DOR payment (F-03).
- **Depends:** B-01, C-06 · **Done when:** rehearsal November B&O = DOR return lines. · **You:** —

### F-06 Tax calendar and reminders
- **Why:** a missed trust-tax deadline is the most expensive mistake a cannabis retailer makes.
- **Needs:** a dashboard card: next LCB (20th) / DOR (25th) / payroll deposits; status from F-01…F-03.
- **Depends:** F-03 · **Done when:** the card shows the December dates correctly. · **You:** —

---

## Block G · Close, review and reporting (the Sage-grade layer)

### G-01 Reversal (was S-10)
- **Why:** posted entries are immutable (0172:524); corrections are reversals. `gl_reverse_journal` (0172:826) has no caller.
- **Needs:** a "Reverse" button with a reason; optional auto-reverse on the 1st (accruals).
- **Depends:** — · **Done when:** reversing a posted journal produces a linked mirror and the TB returns. · **You:** —

### G-02 Period close and lock (was S-11; DC-05)
- **Why:** a closed month cannot change. This is Sage's "locked periods".
- **Needs:** wire period-close-core to `gl_close_period` (0172:891) / `gl_reopen_period` (:929, owner-only, with a reason); prerequisites come from G-03.
- **Depends:** G-03 · **Done when:** posting into a closed period is refused with a sentence. · **You:** close each month.

### G-03 Month-end checklist (part 11's 15 steps, computed)
- **Why:** you are not an accountant, so the system tells you what's left, in order, with green ticks it computes itself.
- **Needs:** the checklist screen reading the bank rec (C-05), tax tie-outs (F-01/F-02), drafts = 0, exceptions = 0 (A-07), count posted (D-02), payroll remitted (E-03), depreciation (H-06), and IAR clean (G-04).
- **Depends:** many; built progressively · **Done when:** the rehearsal November checklist runs end to end. · **You:** work down the list monthly.

### G-04 Internal Accounting Review (Sage-style automated checks)
- **Why:** Sage 50 runs an Internal Accounting Review (about 15 checks) before year-end. Ours runs every close.
- **Needs (checks):**
  1. TB balances.
  2. Sub-ledgers = control accounts (AP, inventory, payroll liabilities).
  3. Trust taxes tie to returns.
  4. Bank reconciled.
  5. No drafts or exceptions in period.
  6. No negative inventory/cash.
  7. Intercompany 36000 nets to zero across entities.
  8. Distributions pro-rata (H-02).
  9. Unacknowledged payroll risks = 0 (D-06).
  10. Book-only write-downs listed (D-04).
  11. Undeposited cash age (OD-16).
  12. Unusual entries (round amounts, weekends, overrides; R-01 detective control).
  13. Duplicate vendor invoices.
  14. Missing documents (tax confirmations).
  15. Retained-earnings roll.
- **Depends:** builds over time · **Done when:** all 15 run on rehearsal November. · **You:** read the red items.

### G-05 Financial statements, comparatives and drill-down
- **Why:** P&L, balance sheet and cash flow by entity, month vs month and vs last year, with click-through to journals → source documents.
- **Needs:** financial-statements-store + the statements mentor (G-10); a cash-flow statement (indirect).
- **Depends:** G-02 · **Done when:** January 2027 statements tie to the TB. · **You:** —

### G-06 Year-end wizard (2027 onward)
- **Why:** Sage's Year-End Wizard: review → count → adjust → close the year → roll profit to retained earnings → open the next year.
- **Needs:** orchestrates IAR, D-03, the depreciation true-up, the 280E report, `gl_close_opening_balance_equity`, and period opening.
- **Depends:** G-02, G-04, D-03 · **Done when:** rehearsed on a copy before 12/2027. · **You:** run it each December.

### G-07 Accruals, prepaids and recurring entries
- **Why:** insurance, licences and rent paid ahead are spread monthly; recurring bills are memorized.
- **Needs:** a prepaid schedule + monthly template journals; auto-reversing accruals (G-01).
- **Depends:** A-03, G-01 · **Done when:** the annual LCB licence fee amortizes monthly. · **You:** list prepaid items once.

### G-08 GAAP adjustments book (Q-12 → OD-34)
- **Why:** lender/buyer-ready statements without disturbing the tax book (Sage Intacct user-defined books pattern).
- **Needs:** `book='gaap_adj'` journals (A-08); report switch Tax | GAAP-adj | Combined; first adjustments: ASC 842 lease, and loyalty deferral if material.
- **Depends:** A-08, G-05 · **Done when:** combined statements = tax + adjustments. · **You:** tell me when a lender or buyer appears.

### G-09 Budgets and forecast (was F-08)
- **Why:** Sage Quantum offers multi-year budgets. Useful, not urgent.
- **Needs:** budget table by account/month; budget-vs-actual on G-05.
- **Depends:** G-05 · **Done when:** — · **You:** enter the 2027 budget if you want one.

### G-10 Statements mentor (was S-30; OD-19)
- **Why:** you learn visually; every statement line explains itself.
- **Needs:** financial-statements-mentor (DC-11) wired to G-05.
- **Depends:** G-05 · **Done when:** every line has a "what is this?" panel. · **You:** —

---

## Block H · Entities, equity and the related-party structure (Q-09 → OD-31)

### H-01 Related-party classification on every movement
- **Why:** each dollar between you, Greenway, ATM and Landholding is labelled loan / capital / distribution / intercompany charge **when it happens**.
- **Needs:** the `rp_class` (A-08) required on lines touching 36000/41000/41100/loan accounts; the Plaid categorize screen asks for it.
- **Depends:** A-08, C-04 · **Done when:** a movement without a class cannot post. · **You:** pick the class when asked.

### H-02 Shareholder distributions: pro-rata tracker
- **Why:** an S-corp needs one class of stock. Distributions should follow 85/5/5/5 (26 CFR 1.1361-1(l)(2)).
- **Needs:** per-shareholder distributions-to-date vs entitlement (gl_shareholders); a warning when ahead; an option to book the excess as a shareholder loan.
- **Depends:** H-01 · **Done when:** a test $8,500 distribution shows $500 owed to each minority holder. · **You:** —

### H-03 Intercompany pairs with demand notes and AFR interest (was S-23 + S-26)
- **Why:** keeps Greenway, ATM and Landholding truly separate (OD-11, OD-12, D-41).
- **Needs:**
  - posting-service.ts:468 wrapper → `gl_submit_intercompany_pair` (0174:587).
  - Note record per pair (lender, demand, short-term AFR, start date, note PDF).
  - related-party-loan-core (DC-07) monthly interest accrual.
  - ATM-account vendor payments from 11/01 and payroll from 1/1 (OD-10).
- **Depends:** A-08 · **Done when:** both sides of every pair post together and 36000 nets to zero. · **You:** sign the demand notes (I draft the terms text; your CPA/attorney reviews).

### H-04 Intercompany statement and elimination report (was S-24)
- **Why:** shows what each entity owes the other, and the combined picture without the internal amounts.
- **Needs:** report by intercompany_ref.
- **Depends:** H-03 · **Done when:** January 2027 nets to zero. · **You:** —

### H-05 Dated tax-regime setting and cost-class split (the "upgrade path")
- **Why:** when federal law lets you deduct normally (medical Schedule III today for endorsed medical sales; adult-use pending), it should be a **setting from a date**, not a rebuild.
- **Needs:**
  - `tax_regime` rows (entity, effective_from, regime: `280e_full | 280e_apportioned | ordinary`, CPA memo ref).
  - D-07 and statements apply it.
  - Medical/adult-use apportionment by revenue share when endorsed.
- **Depends:** D-07, A-06 · **Done when:** flipping the regime in a test changes the report only from the effective date. · **You:** a regime change requires your CPA memo reference.

### H-06 Fixed-asset register and depreciation (was S-25)
- **Why:** the balance sheet needs assets at cost less depreciation, and monthly depreciation entries.
- **Needs:** fixed-assets-core (DC-04), 0178; import Sage's asset list at 12/31; monthly drafts 78010.
- **Depends:** I-02 · **Done when:** NBV = Sage at 12/31; January depreciation posted. · **You:** confirm the asset list.

### H-07 Basis, AAA and Form 7203 support (was S-27)
- **Why:** each shareholder's stock and debt basis, plus the S-corp AAA, for the 1120-S/K-1s.
- **Needs:** basis-aaa-core (DC-01), s-corporation-year-core (DC-09), fed from H-02/H-03 and the year's results.
- **Depends:** H-02, H-03 · **Done when:** 2027 year-end schedule produced. · **You:** give the CPA's 12/31/2026 basis figures.

### H-08 Arm's-length rent and ATM fees
- **Why:** Landholding's rent and the ATM company's charges must be at market rates and posted monthly (OD-11 protection).
- **Needs:** recurring intercompany templates (G-07) with the lease/agreement attached.
- **Depends:** H-03, G-07 · **Done when:** January rent posts on both sides. · **You:** attach the lease and the ATM agreement.

---

## Block I · Opening balances and go-live

### I-00 Sage exports stay healthy for Nov–Dec (P1)
- **Why:** Sage is the book through 12/31. Our existing exports (sage-exports-core.ts: cash receipts, purchases, payments, adjustments GJ, vendor list; sage50-core.ts; /admin/reports/accounting/sage-export) must keep feeding it.
- **Needs:** a run of each export on the first November days; fix any break.
- **Depends:** — · **Done when:** your first weekly Sage import succeeds. · **You:** import weekly as you do now.

### I-01 Books-only rehearsal wipe + date flip (new)
- **Why:** the full factory reset (0209, factory-reset-core.ts) also wipes operational data, which would destroy real Nov–Dec sales. We need a wipe of **only** rehearsal GL rows.
- **Needs:**
  - An owner RPC that, inside one transaction:
    - (a) refuses unless every period ≤ 2026-12 is rehearsal;
    - (b) deletes gl_journals/lines/audit/bank_matches/reconciliations/opening_balances/override and payroll-allocation rows dated before 2027-01-01;
    - (c) UPDATEs `gl_conversion_config` to 2027-01-01 / 2026-12-31 / parallel per I-06;
    - (d) re-seeds 2027 periods.
  - Preview mode first, like `gl_factory_reset_preview`.
  - Templates, COA and policies survive.
- **Depends:** A-01, A-02 · **Done when:** PG15: after the wipe, operational row counts are unchanged and GL counts are 0. · **You:** press it once, on 1/1 or after Sage's close.

### I-02 Sage trial-balance import per entity (D-47)
- **Why:** the OB source is Sage's post-closing 12/31/2026 TB (OD-24).
- **Needs:**
  - CSV upload → map Sage account → our COA (gl_account_migration_map) → OB worksheet rows with `evidence_kind`.
  - Every unmapped line is a refusal with a sentence.
  - Rehearse with Sage's **November** TB in December.
- **Depends:** — · **Done when:** the November-TB rehearsal loads with zero unmapped. · **You:** export the TB from Sage per entity (I give click-steps).

### I-03 Inventory OB from the year-end count (Q-04 → OD-26)
- **Why:** inventory opens at counted lot cost, not Sage's figure.
- **Needs:** D-03 per-category totals replace Sage's inventory line(s) in the worksheet; any difference must already have been booked in Sage (D-03b).
- **Depends:** D-03, I-02 · **Done when:** worksheet inventory = valuation report. · **You:** book the Sage adjusting entry.

### I-04 OB worksheet completion and checks (was S-07a + S-07 part 1)
- **Why:** each line must carry evidence (bank statement, loan statement, count, Sage TB).
- **Needs:** fix `EXPECTED_OPENING_ACCOUNTS` (cutover-core.ts:247-265, N-13); a missing-evidence list; the 40400 plug explained (N-06).
- **Depends:** I-02, I-03 · **Done when:** zero missing evidence. · **You:** upload 12/31 bank and loan statements.

### I-05 Bless and post the opening balances (was S-07 part 2)
- **Why:** one opening journal per entity, dated 12/31/2026, owner one-time approval (OD-04).
- **Needs:** `gl_bless_opening_balances`, then `gl_close_opening_balance_equity` → 40300.
- **Depends:** I-04, I-01 · **Done when:** our 1/1 TB = Sage's post-closing TB per entity. · **You:** press Bless.

### I-06 January parallel proof (was S-09)
- **Why:** proves the live system against Sage for the first month.
- **Needs:** parallel_run 2027-01-01→2027-01-31 (or none). The comparison report reads Sage's January TB.
- **Depends:** I-05 · **Done when:** differences = 0 or explained; signed. · **You:** decide light parallel (bank totals) vs none.

---

## Block J · Teaching, controls and governance

### J-01 Every refusal and warning is a sentence plus a fix (OD-19)
Cross-cutting acceptance rule for every slice above, audited once as a sweep.

### J-02 COSO internal-control self-assessment (was S-35)
- **Needs:** internal-control-core (DC-06) wired; an annual review.
- **You:** an annual 30-minute review.

### J-03 Rule dating (was S-31; D-30)
- **Why:** every rule that changes over time carries `effective_from` (rule 114). This covers account rules, tax rates (B-03), regime (H-05) and endorsement (A-06).
- **Note:** no COA editing UI (OD-14 stands).

### J-04 Owner manual
- **Why:** one illustrated page per routine (daily 5 minutes, weekly bank, monthly close, year-end), generated from the live checklists.

### J-05 Crypto (was S-40), 12300 (Q-08), Rev. Proc. 98-29 (F-03)
- **Status:** stay deferred (part 10).

---

## §X Daily, weekly and monthly routine after go-live (what "done" feels like)

| When | You do | Minutes |
|---|---|---|
| Daily | Close drawers (posts itself); glance at the Exceptions inbox | 5 |
| Weekly | Categorize unmatched bank lines; approve count journals | 15 |
| Monthly by the 20th | Tax Returns → tie-out ticks → LCB CSV → pay → attach confirmation | 15 |
| Monthly by the 25th | DOR return → pay → attach confirmation | 10 |
| Monthly by the 25th | Month-end checklist → IAR → close the month | 30 |
| Year-end | Full count → Year-end wizard → CPA package | half-day |

---

## §Y Old slice IDs (part 09) → new IDs

| Old | New | Old | New |
|---|---|---|---|
| S-00 | A-00 | S-12 | F-01…F-04 |
| S-01 | A-03 + C-01 | S-13 | F-05 |
| S-01b | retired (rehearsal wipe I-01 replaces backfill) | S-15 | E-01 |
| S-02 | A-02 | S-16 / S-16b | E-03 |
| S-03 | B-01 | S-17 | C-04 + C-05 |
| S-03b | B-02 | S-18 | C-03 |
| S-03c | B-03 | S-20 | D-07 |
| S-04 | A-05 | S-21 | D-04 + D-03 |
| S-05 | B-04 | S-22 | C-06 |
| S-06 | **retired** (11/01 inventory journal replaced by D-03 + I-03) | S-23 / S-26 | H-03 |
| S-06a | retired (cut-over one-pager now I-04's evidence list) | S-24 | H-04 |
| S-07a | I-04 | S-25 | H-06 |
| S-07 | I-04 + I-05 | S-27 | H-07 |
| S-08 | D-01 | S-30 | G-10 |
| S-09 | I-06 | S-31 | J-03 |
| S-10 | G-01 | S-35 | J-02 |
| S-11 | G-02 | S-40 | J-05 |

New with no old ID: A-01, A-04, A-06, A-07, A-08, B-05, C-02, C-07, D-02, D-05, D-06, D-08, E-02, E-04, E-05, F-06, G-03, G-04, G-06, G-07, G-08, G-09, H-01, H-02, H-05, H-08, I-00, I-01, I-02, I-03, J-01, J-04.

**Count:** 70 slices in 10 blocks (A 9, B 5, C 7, D 8, E 5, F 6, G 10, H 8, I 7, J 5).

---

## §Z What we deliberately do **not** build (Sage has it; you don't need it)

- Payroll **calculation**: your payroll stays where it is, and we post its results (E-02).
- Job costing and project accounting.
- Multi-currency.
- Customer AR invoicing: retail is cash-and-carry. If wholesale/AR ever appears, it is a new block.
- A self-service chart-of-accounts editor (OD-14).
- Crypto (F-01).
- Rev. Proc. 98-29 estimate (count at year-end instead).
- A Sage round-trip after 1/2027 (F-09).
