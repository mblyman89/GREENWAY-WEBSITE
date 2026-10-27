# SOP Program — Gap Register

Created in slice SOP-01 · 2026-10-27 · Updated in slice SOP-02 · 2026-10-27 · Updated in slice SOP-03 · 2026-10-27 (owner answers D14–D19; SOP-03 gaps G-14, G-15; G-04 updated) · Updated in slice SOP-04 · 2026-10-27 (D21 → G-03; D23–D27 → G-04; SOP-04 gaps added) · Updated in slice SOP-05a · 2026-10-27 (D29 → G-16 APPROVED; D32 → G-18; D33/D34 → G-20; D31 → G-21) · Updated in slice SOP-05b · 2026-10-27 (G-29…G-32 added)

A **gap** is something the owner wants, or a procedure needs, that the system does not do today. Each gap is a list of requirements only. **Nothing here is built in the SOP program.** Builds are chosen with the owner in the Phase C strategy session (`SOP-INT`). Until a gap is built, staff follow the **interim procedure** named for it. That procedure is printed in the SOP so the control exists on paper from day one.

Findings (bugs, weaknesses) live in `03-FINDINGS-LEDGER.md`. Gaps cite the findings that prove them.

| Status key | Meaning |
|---|---|
| OPEN | Not built; interim procedure in force |
| OPEN · TO AUDIT | Owner asked for it; the current code has not yet been audited in its own slice |
| APPROVED | Owner asked for it to be built; queued for the build phase (not built in the SOP program) |
| CLOSED | No longer needed (owner decision); kept for history |
| BUILT | Built and verified (moved here only after a later build slice) |

---

## Summary

| Gap | What | Owner decision | Findings | Interim procedure | Status |
|---|---|---|---|---|---|
| G-01 | Second-person count at till close | D2 | F-01-9, F-00-5 | SOP-01 §4.27 step 8, forms 8.2 / 8.4 | OPEN |
| G-02 | Master till ↔ little safe denomination log (and register-swap denominations) | D3 | F-01-8, F-00-7, F-02-8 | **SOP-02 §4.10 form 8.2** (master ↔ little safe) and **§4.11 form 8.3** (register ↔ master); SOP-01 §4.26 | OPEN |
| G-03 | $5 over/short admin warnings screen (reason required); **covers the master till too (D16)** | D7, D16 | F-01-11, F-02-6 | SOP-01 §4.30 form 8.5 · SOP-02 §4.8 form 8.5 | OPEN |
| G-04 | Deposit bag screen (night count → morning verify → seal → safe → bank) | (original request) | F-00-6, F-03-9, F-03-10 | **SOP-03 §4.5–4.13, forms 8.1 / 8.2 / 8.6** | OPEN (D23–D27 set the rules) |
| G-05 | Per-shift / per-cashier report | (original request: "shift close reports") | F-01-10 | SOP-01 §4.27 step 9 (X report), close slip 8.2 per drawer | OPEN |
| G-06 | SOPs readable, printable and **exportable** in the Employee area; report export | (original request) | F-00-8, F-00-10 | Markdown files in `docs/sop/`; print from the browser | OPEN |
| G-07 | Crawler PO builder: save the fetched vendor-menu data | D4 | F-00-15 | None needed yet | OPEN · TO AUDIT (SOP-09) |
| G-08 | Master till denomination standard (D11 mix) checked and shown | D11 | F-02-3 | SOP-02 §4.9, form 8.1 mix columns | OPEN |
| G-09 | Master till sheet printable and exportable; history beyond 30 rows | (original request: "exportable and printable") | F-00-8, F-02-13 | SOP-02 §4.18, form 8.1 binder, EOD print | OPEN |
| G-10 | ~~Manager Till standard float = $167.50~~. Owner corrected: Manager Till = $300.00, already in the code | D10 → D19 | F-02-2 (withdrawn) | None needed | **CLOSED** (D19) |
| G-11 | Supply-run screen | **D17** ("id like the supply run screen built") | F-02-11 | SOP-02 §4.13, form 8.4 | **APPROVED** |
| G-12 | Post cash drops to the books (10110 → 10100) | (books integrity; owner model till → safe → bank) | F-02-1 | None needed for staff; recorded for the build phase | OPEN |
| G-13 | Any employee can record the master till count (not only manager-level logins) | **D15** | F-02-10, F-02-4 | SOP-02 §2, §4.5: a manager login enters it and picks the counter | OPEN |
| G-14 | Cash-to-bank books wiring (seal poster → 10400, bank-deposit clearing caller, census corrected, panel text) | (original request: "for depositing to the bank") | F-03-1, F-03-3, F-03-10, F-02-1 | SOP-03 §4.13 bag log + bank receipts; §4.15 ignore the panel | OPEN |
| G-15 | EOD deposit sheet in the app + export (deposit figure, denominations, two signatures, refunds, date picker, CSV/XLSX) | (original request: "End of day spreadsheet" … "exported and printed") | F-03-5, F-03-6, F-03-7, F-03-8, F-00-8 | SOP-03 form 8.1 night sheet; §4.8 Z report for cash; §4.9 print | OPEN |
| G-16 | Partial-quantity receive: record "N of M received", the rest refused, per line | **D29** (*"we need a way to accept less than what came in, please add this to the list of serious issues to fix"*) | F-04-1 (**S1**) | SOP-04 §4.11: refuse the whole short line; vendor re-sends | **APPROVED · SERIOUS** |
| G-17 | Show emails that failed to stage (parse failed / no manifest) on the Receiving screen | (procedure need) | F-04-4 | SOP-04 §4.3 step 4: daily mailbox-vs-list check, form 8.1 | OPEN |
| G-18 | Monthly CCRS public records request: reminder on the 10th (admin), month drop-down (one or several months) filling the built-in text, tracking # / received log, corrected phone and stale help | D28, **D32** | F-04-19, F-04-18, F-04-13, F-04-14, F-04-17 | SOP-04 §4.26–§4.28, form 8.4 | **APPROVED** (drop-down, D32) · rest OPEN |
| G-19 | Gated and audited lot activation from the lot page (Lifecycle status runs the go-live check and writes an audit row) | (compliance: WAC 314-55-102) | F-04-2, F-04-12 | SOP-04 §4.19: manager only, from a "now clear" Issues row, logged on form 8.1 | OPEN |
| G-20 | Benchmark dataset lifecycle: typed delete confirmation, 18-month retention purge (notice, hold, audit), working-buttons-only on monthly cards | **D33**, **D34** | F-04-15, F-04-16 | SOP-04 §4.33–§4.34, form 8.4 part G | **APPROVED** |
| G-21 | First-delivery-from-vendor marker on the manifest review screen (prompts the recommended second count) | **D31** | — (no finding; feature need) | SOP-04 §4.9 Vendor-filter check, form 8.1 box | OPEN |
| G-22 | Audited, gated lot lifecycle: no manual Destroyed, a reason on every change, owner-only recall release, status history (extends G-19) | (compliance: WAC 314-55-225, CCRS traceability) | F-05a-1 (**S1**), F-05a-2 (**S1**), F-04-2 | SOP-05a §4.8–§4.10, form 8.1 | OPEN |
| G-23 | Hardened manual adjustment: atomic, no negative, Sold out at zero, notes where CCRS needs them, no Destruction / Recall removal / Receive, add Theft / Seizure, audit + name | (procedure need; CCRS E13) | F-05a-3…F-05a-7, F-05a-13 | SOP-05a §4.6–§4.7, form 8.2 | **APPROVED** (D39: remove Receive, Destruction, Recall removal; add Theft, Seizure; Schedule destruction link) |
| G-24 | Expired stock at the register: **hard block** expired Solid / Liquid Edible, **warn** on the rest; FEFO lot draw | **D36** (Q-05a-6 open: tincture, capsule) | F-05a-8 | SOP-05a §4.16, form 8.3 | **APPROVED** |
| G-25 | Recall plan + recall event log in the app; recall hold reaches the website and online orders | (compliance: WAC 314-55-225(3)(d), (3)(f)) | F-05a-15, F-05a-16 | SOP-05a §4.10, §4.13, forms 8.4–8.5; Always hide | OPEN |
| G-26 | Print-label link on the lot page, scannable fallback barcode, **the professional 86** (reason-driven clearing, one queue, audited manager restore) | **D40** | F-05a-9, F-05a-10 | SOP-05a §4.12, §4.19 | **APPROVED** (86 part, D40) · rest OPEN |
| G-27 | No typed cannabis unit cost: remove **Unit cost** from Bulk fill for cannabis lots (cost only from the vendor's CCRS manifest) | **D38** | F-05a-11 (**S1**) | SOP-05a §4.20 | **APPROVED** |
| G-28 | Returns & Destruction handles held lots: lists Quarantine and Recalled lots, keeps Recalled while pending (hold stays on), Cancel restores the earlier status | **D39** (design: Q-05a-8) | F-05a-17, F-05a-18 (**S1**), F-05a-19 | SOP-05a §4.9, §4.10, form 8.4 | OPEN (design awaits Q-05a-8) |
| G-29 | Other Inventory on the register: SKU / UPC scan to a priced line, sale decrements On hand, void / return restores, audited | (procedure need; D43) | F-05b-1 (**S1**) | SOP-05b §4.1–§4.5, form 8.1 | OPEN (Q-05b-1) |
| G-30 | Edit non-cannabis price and cost by role, audited old → new; refuse a $0.00 price | (procedure need) | F-05b-6 | SOP-05b §4.3, §4.6, §4.9, form 8.2 | OPEN (Q-05b-2) |
| G-31 | Cannabis-line guard: no lot override, Move products or type mapping may move cannabis into or out of a non-cannabis category without the owner | (compliance: RCW 69.50.535 excise, WAC 314-55-095 limits) | F-05b-9 (**S1**) | SOP-05b §4.15–§4.17, §4.21, form 8.3 | OPEN (Q-05b-4) |
| G-32 | Hardening bundle: audit Confirm / Archive + Restore, atomic adjustment, Direction locked to Reason, full invoice rollback, checked audits, publish fails closed, owner-only cost-unknown price, classification write warning | (procedure need; D38 for the price) | F-05b-2, 3, 4, 5, 7, 8, 10, 11, 12, 13 | SOP-05b §4.3–§4.9, §4.14, §4.15, §4.19, §4.21 | OPEN (Q-05b-5) |

---

## G-01 · Second-person count at till close

- **Owner:** *"Q2- close only, and it can be any second employee"* (D2).
- **Today:** a blind close takes one employee PIN (`TillCloseRequest`, till-core L48–58). There is no second counter (F-01-9, S1; narrows F-00-5).
- **Requirements (draft, for Phase C):**
  1. At blind close, after the first count, a **second employee** (any job role, but a different employee from the closer) enters their PIN and their own count.
  2. Both counts are stored against the drawer session. If they differ, the system shows the difference. The owner has not said whether a mismatch should block; a warning only is the default until the owner decides.
  3. **Not** required at count-in (D2 says close only).
  4. Same-person check is enforced on the server, not only in the UI.
- **Interim:** SOP-01 §4.27 step 8. The second employee counts the drawer on paper and both sign close slip 8.2 / sign-off 8.4. The slip goes in the drawer bag.

## G-02 · Master till ↔ little safe denomination log

- **Owner:** *"Q3- no, I just want to know when big bills leave the master till and go into the little safe. And what the small bills and coin are that came out of the little safe."* (D3).
- **Today:** a register↔safe swap records a total value only, with no denominations (F-01-8; till-core `TillSwapRequest` L61–74, validator L210–232). The little safe is not modelled at all (F-00-7).
- **Requirements (draft):**
  1. **No** little-safe balance or target (D3).
  2. Each exchange records: who, when, the **big bills out of the master till** by denomination, and the **small bills and coin out of the little safe** by denomination. The two sides must be equal in value.
  3. A log is viewable and printable/exportable (ties to G-06).
- **Interim:** SOP-01 §4.26, swap denomination log form 8.3. Do **not** use "No sale" for swaps.
- **SOP-02 update (2026-10-27):** two different exchanges were being logged on one form (F-02-8). The interim is now **SOP-02 form 8.2** for master till ↔ little safe (what D3 asks for) and **SOP-02 form 8.3** for register ↔ master till swaps. Requirement 2 applies to both. Also add: 4. the register swap screen captures the denominations both ways (F-01-8); 5. the exchange log is shown on the Store safe page next to **Recent change swaps**. Owner question Q-02-1 (do register swaps draw on the master till?) affects the screen design.

## G-03 · $5 over/short admin warnings screen

- **Owner:** *"Q6- $5. It should be an admin only screen placed in the most logical place to put it for me to interact with. Just warnings for now. Who, when, how much, their reason for why it's over/ under (should be required to be input for over/ under)."* (D7).
- **Today:** no threshold, no warnings screen and no reason field (F-01-11; `actions.ts` L109–141; no `over_short_reason` anywhere in the code). Accurate over/short also depends on F-01-3 (expected shows $0.00) and F-01-4 (hand-typed cash sales). Those must be fixed first or the warnings will be wrong.
- **Requirements (draft):**
  1. Threshold **$5.00** (500 cents). An over or short of more than $5 raises a **warning**. Warnings only: nothing is blocked.
  2. A **reason is required only when the over/short is more than $5.00** (owner decision **D21**, slice SOP-04: *"Q-03-1- only over $5"*). At $5.00 or less the amount is recorded, and a reason is optional.
  3. An **admin-only** screen showing who, when, how much (over or short) and the reason. Proposed location: under Registers, next to reconcile (the owner will confirm the "most logical place").
- **Interim:** SOP-01 §4.30 and form 8.5. The manager writes who / when / how much / reason and hands it to the owner.
- **SOP-02 update (2026-10-27):** master till counts have no threshold or reason either (F-02-6). D7 covers them (**D16**), with a reason only over $5 (**D21**). Interim: SOP-02 §4.8 and its form 8.5. The same warnings screen should list master till variances, with the count window and **Counted by**.

## G-04 · Deposit bag screen

- **Owner (original request):** night count → morning recount → seal bag → safe → bank.
- **Today:** the bag tables and core exist, but no screen reaches them (F-00-6, S1).
- **Interim:** **SOP-03** (written, v1.0 draft): night sheet form 8.1 (part A at night, part B morning recount, part C seal), bag log form 8.2, bank-run checklist 8.6. SOP-01 §4.29 covers the hand-off at close (but see F-03-4: the float stays in the till).
- **Updated in slice SOP-03 — requirements (draft), from `0212_deposit_bags.sql` and `safe-bag-core.ts` (already designed, not wired):**
  1. Bag record: pre-numbered bag #, business day(s) covered, sessions in the bag, night amount (who counted), morning amount (who recounted, **a different person**), sealed at/by, deposited on.
  2. Lifecycle `available → undeclared → counted → deposited` (`safe-bag-core.ts`); a sealed bag is **append-only** and changes go through a server action with an audit row (closes F-03-9).
  3. Night vs morning difference: show it, require a reason (D7 style), and keep both figures.
  4. Seal posts `buildSealBagJournal` (10100 → 10400) (see G-14).
  5. Show `checkDepositShape` (near-$10k / structuring note) at seal time (F-03-10; `CASH_DEPOSIT_POLICY_DECISION.md`).
  6. **Undeclared bag at till close = warning only, never a block** (owner decision **D27**: *"Q-03-7- warning only please"*). This departs from the books-98 design (`blockCloseForUndeclaredBags`, `safe-bag-core.ts` L212–226, which blocks), so that function must be changed or replaced when it is wired.
  6a. Roles (D23–D26): the night count is **one person** with no second count at night (D24). The **morning recount by any employee** is the second count and must be a different person from the night counter. **Any employee may seal** (D25). **Only the owner records a bag as taken to the bank** (D25). The bag number is the pre-printed number on a **tamper-evident** bag (D26). Unsealed counted cash sits in the safe overnight (D23).
  7. Print and export the bag log (G-06/G-09 pattern).

## G-05 · Per-shift / per-cashier report

- **Owner (original request):** "shift close reports" and day close.
- **Today:** the day report is per register, not per shift or cashier (F-01-10; day-report L58/104/119).
- **Interim:** SOP-01 §4.27 step 9. Print an X report before a close when the register has more than one drawer that day, and keep close slip 8.2 per drawer.

## G-06 · SOPs in the Employee area + export

- **Owner (original request):** SOPs must be readable, exportable and printable in the Employee area. Reports must be exportable.
- **Today:** staff cannot open the SOP/Handbook pages (F-00-10). The safe sheet has no print/export, and EOD/till summary print only (F-00-8).
- **Interim:** SOPs live as Markdown in `docs/sop/` and are printed from GitHub/browser. The Employee-area reader is built in the program's integration phase (charter, `01-PROGRAM-CHARTER-AND-STORAGE.md`). Per D1 there is **no** acknowledgment gate.

## G-07 · Crawler PO builder: save fetched data

- **Owner:** *"The po builder using the crawler will continue to be allowed going forward and should have a proper sop explaining how to use it, and save the data we get from it."* (D4).
- **Today:** **not yet audited.** Whether vendor-menu fetches (Cultivera / GrowFlow / LeafLink) are persisted is checked in slice SOP-09. Nothing is assumed here.
- **Related:** F-00-15 (the "ONE-TIME IMPORT ONLY" banner contradicts D4).

## G-08 · Master till denomination standard

- **Owner (D11):** *"The master till has 1000. 32 tens, 64 fives, 318 ones, 95 quarters, 120 dimes, 100 nickels, and 125 pennies."*
- **Today:** the page checks the total only and shows **Balanced** for any $1,000.00 mix. The denominations are stored but not shown (F-02-3; `safe-core.ts` L64–96; `safe/page.tsx` L192–233).
- **Requirements (draft):**
  1. Store the standard mix as one constant or setting (it already exists as `SPECIMEN_MASTER_COUNTS`, `register-cash-specimen-core.ts` L43–46; rule 25: one source).
  2. The count grid shows **Standard** and **Diff** per denomination, live.
  3. The result separates **total variance** from **mix off standard** (for example "Balanced · mix off: +10 × $20, −20 × $10").
  4. **Recent counts** can show the denominations of any count.
  5. The EOD safe section shows "mix on standard: yes/no".
- **Interim:** SOP-02 §4.9, form 8.1.

## G-09 · Master till sheet print / export

- **Owner (original request):** *"I want to make sure the master till spreadsheet is built … This should be exportable and printable."*
- **Today:** no Print button and no export on `/admin/registers/safe`. 30-row cap, no date filter (F-00-8, F-02-13).
- **Requirements (draft):**
  1. A printable daily sheet (AM + PM + extras, with denominations, standard, diff, counter, notes, swaps, exchanges) in the same style as the EOD print.
  2. CSV/XLSX export by date range (precedents: `inventory/cycle-counts/[id]/export/route.ts`, `reports/compliance/export/route.ts`; `exceljs` is already a dependency).
  3. A date picker for history.
- **Interim:** SOP-02 §4.18.

## G-10 · Manager Till float and register float setting

- **CLOSED in slice SOP-03 (D19).** Owner: *"And I was wrong, it should be 300 in it."* The Manager Till is seeded at $300.00 (`0038` L184), which matches. Requirement 1 below is cancelled. Requirement 2 (an owner-only float setting) is kept as a nice-to-have idea, not an owner request. Requirement 4 (the `drawer-posting-service.ts` L190–191 comment) stays open under F-02-9. The text below is history.

- **Owner (D10):** all three tills hold $167.50.
- **Today:** Manager Till seeded at $300.00 and never corrected (`0038` L184; `0077` L40–46). No screen edits `default_float_minor`. The register app does not compare count-in to any standard (F-01-13).
- **Requirements (draft):**
  1. Set the Manager Till `default_float_minor` to 16750 (migration; idempotent, like 0077).
  2. Optionally, an owner-only setting for each register's float, audited.
  3. With F-01-13: warn at count-in when the count is not the standard float.
  4. Fix the `drawer-posting-service.ts` L190–191 comment.
- **Interim:** SOP-02 §4.14.

## G-11 · Supply-run screen (APPROVED, D17)

- **Owner (D17, slice SOP-03):** *"Q-02-4- id like the supply run screen built."* The decision below is answered: **build**, using the three-part design (cash-out, settle, open-advances list). Queued for the build phase per charter C5.

- **Owner policy (books-99):** *"I don't want to use the master till any more for petty cash."*
- **Today:** builders done, no screen (F-02-11).
- **Decision needed (Q-02-4):** if supply runs should never happen, close this gap as "not needed" and keep form 8.4 for emergencies. If they can happen, build: a cash-out record (who, amount, approver PIN) → `buildSupplyAdvanceJournal`; a settle record (receipt amount, change, expense account) → `buildSupplySettleJournal`; an open-advances list for the owner.
- **Interim:** SOP-02 §4.13, form 8.4.

## G-12 · Post cash drops to the books

- **Today:** drops are recorded on the drawer session but never posted. 10110 keeps the dropped amount; 10100 is short by it (F-02-1, S1, proven by running `buildTillCloseJournal`).
- **Requirements (draft):**
  1. Either post each drop (debit 10100, credit 10110, source ref `till-drop:<dropId>`, idempotent), or have the close relieve 10110 by `counted − float + drops` and debit 10100 the same.
  2. Add a census row for the drop event.
  3. Add a self-test asserting the **net 10110 movement** for a dropped shift equals −(cash sales − over/short). That is the assertion missing today.
- **Interim:** none needed for staff (SOP-02 §4.12 note).

---

## Not gaps (decisions with no build)

- **D1:** no SOP acknowledgment gate. Nothing to build.
- **D5 / D6:** SOP-12 (Digital Assets) and the new SOP-21 (SEO) are documents, scheduled in `02-SOP-CATALOG-AND-ROADMAP.md`.
- **D8:** keep employee `job_role` and user `StaffRole` separate. This is the current design; SOP-01 §2 and SOP-08 explain it.
- **D12:** a page for the two daily master till counts. **Already built** (`/admin/registers/safe`, AM / PM / Extra). SOP-02 §4.3–4.7 documents it. Its weaknesses are findings F-02-3/4/5, not a missing page.
- **D3 (little-safe balance):** no balance or target for the little safe. Nothing to build beyond G-02's log.

## G-13 · Any employee records the master till count

- **Owner (D15, slice SOP-03):** *"Q02-2- anyone can count and record the master count."*
- **Today:** the Store safe page and its action need `inventory.manage` (owner/admin/manager) (`safe/page.tsx` L47, `safe/actions.ts` L29, `roles.ts` L106). Staff logins see the **Safe** button but are refused (F-02-10).
- **Requirements (draft):**
  1. Let any active employee record a count. Options: (a) open the page to the `staff` role (e.g. `orders.manage`) for the count form only, keeping history and settings manager-only; or (b) a register-side "Master till count" screen that takes the counter's **employee PIN**, which also fixes F-02-4 (verified counter).
  2. Keep D8: back-office permission uses the login's StaffRole; the counter identity uses the employee.
  3. Keep the audit: link the audit row to the `safe_counts` row (F-02-4).
- **Interim:** SOP-02 §4.5: a manager login enters the count and picks the counter.

## G-14 · Cash-to-bank books wiring

- **Owner (original request):** the bag goes *"into the safe for depositing to the bank"*. The books must follow the cash: till → safe (10100) → sealed bag (10400) → bank (10200).
- **Today:** the till → safe leg posts (D-77). The seal leg has **no poster** and the bank-clearing leg has **no caller** (F-03-1, F-03-3, F-03-10). So 10400 is never filled, the Undeposited Funds panel shows a false all-clear, and the census marks bank clearing reachable.
- **Requirements (draft):**
  1. Post the seal (`buildSealBagJournal`) from the G-04 bag screen.
  2. Give `clearDepositForBankRow` an owner-only caller on `/admin/books/bank` (match a bank deposit line to bags).
  3. Correct the census rows `cash_deposit_to_bank` (exists/reachable evidence) and keep `seal` MISSING until wired.
  4. Fix the stale text and comments listed in F-03-1 (panel L82–84 and file headers).
  5. Drops posting (G-12 / F-02-1) must land first, or the 10100 pool the bags are drawn from is short by the day's drops.
- **Interim:** SOP-03 §4.13 (bag log plus bank receipts is the trail); §4.15 (do not use the panel).

## G-15 · EOD deposit sheet in the app + export

- **Owner (original request):** *"End of day spreadsheet that one person completes before close"*; closing-day reports *"exported and printed"*.
- **Today:** `/admin/registers/eod` prints a day summary with one signature line. It has no deposit (takings-to-bag) figure, no denomination grid, no refunds, no date picker and no export (F-03-5, F-03-6, F-03-8, F-00-8). Read errors render as empty (F-03-7).
- **Requirements (draft):**
  1. Per-till takings = closing count − float; deposit = drops + Σ takings (SOP-03 §4.2), shown and printed.
  2. Denomination grid for the bag; night counter and morning verifier signature lines (two different people).
  3. Refunds / voids from the Z report source (`day-report-core.ts`), so the cash figure is net.
  4. Date picker; an invalid `?day=` shows an error, not today.
  5. CSV / XLSX export of the sheet (with G-06 / G-09).
  6. Surface read errors instead of "No drawer sessions".
- **Interim:** SOP-03 form 8.1 (night sheet), §4.8 (use the Z report for cash), §4.9 (print and file).

## G-16 · Partial-quantity receive

- **Owner:** *"So we need the ability to tell the system that we are only accepting a part of the manifest and the rest was rejected. There are several instances where the vendor forgot to send an item, or it broke in transit, etc."* (`docs/ccrs-rejection-and-returns.md` L15–21). Line-level refusal exists; unit-level does not.
- **Today:** each line is accepted whole or refused whole. `received_qty` = the manifest quantity (`intake-parser.ts` L606), and the InventoryTransfer reports the received quantity (`ccrs-transfer-core.ts` L33–36) (F-04-1).
- **Owner decision (D29):** *"we need a way to accept less than what came in, please add this to the list of serious issues to fix."* **APPROVED, serious.** In Phase C it is ranked with the S1 items.
- **Requirements:**
  1. Per line, an optional **counted** quantity (≤ shipped) with a refusal reason for the difference.
  2. The lot is activated at the counted quantity; the inventory adjustment `receive` is at the counted quantity.
  3. The weekly InventoryTransfer reports the quantity actually received, consistent with the vendor's CCRS Update.
  4. The timeline and partial note record shipped / counted / refused.
  5. Tests for "18 of 20", overage refusal, and zero counted (= refuse).
  6. Manager-only, like the rest of Receiving (D30).
- **Interim:** SOP-04 §4.11.

## G-17 · Failed-email visibility in Receiving

- **Today:** `inbound_email_log` records `parse_failed` / `no_manifest`, but no screen shows them (`inbound-store.ts` L862–884; panel removed in 7cb4702c) (F-04-4).
- **Requirements (draft):**
  1. A "Needs attention" strip on the Incoming (email) tab listing failed or no-manifest emails from the last 30 days, with sender, subject, received time and the archived attachments.
  2. A "Resolved (imported by hand / not a manifest)" action with an audit row.
  3. A count badge on the Receiving status cards.
- **Interim:** SOP-04 §4.3 step 4.

## G-18 · Monthly CCRS public records request (reminder, log, template)

- **Owner (D28):** *"Please make sure to include the monthly CCRS public record request to ingest the states data for the benchmarks."* Vision: *"Ideally, I will make the public records request once per month to get the previous months data…"* (`ROADMAP_BACKOFFICE_FIXES.md` L276–289).
- **Today:** there is no calendar task (`compliance-calendar-core.ts` L86–136), and no place to record the tracking number for a monthly zip (`discovery/actions.ts` L857–862). The template omits tables the transformer needs (F-04-18). The phone is wrong (F-04-13). Step 1 item 5 and the help panel are stale (F-04-14). The time estimate is understated (F-04-17) (F-04-19).
- **Requirements (draft):**
  1. A compliance-calendar task "CCRS public records request (previous month)", monthly, **admin-assigned, due on the 10th** (D32), moving to the next business day on a weekend or holiday. If the WSLCB accepts a standing request, the task becomes "confirm last month's request is open or delivered".
  2. A small request log on the CCRS page: month, filed date, tracking #, acknowledged date, received date, linked dataset.
  3. **Approved (D32):** keep the built-in text (the owner's proven wording) and add a **month drop-down that selects one month or several**. The selection fills [START DATE]/[END DATE] (the 1st of the first month through the last day of the last month), so the text is copied **without editing**. Default: the previous calendar month. A note under it: "Each month is delivered as its own zip; drop them one at a time."
  4. The phone corrected to (360) 664-1753; Step 1 item 5 and the help panel rewritten for the one-zip flow; an honest time estimate.
  5. A "last month not yet dropped" nudge on the benchmarks pages.
  6. The log in item 2 holds one row per **month**, even when one request covered several months (one tracking # → several rows), because each month arrives as its own zip (D32).
- **Interim:** SOP-04 §4.26–§4.28, form 8.4.

## G-19 · Gated and audited lot activation from the lot page

- **Today:** **Lifecycle status** writes any status, including Active, with no `evaluateLotActivation` and no `recordAudit` (`inventory/actions.ts` L142–155; `store.ts` L836–851). The activation grep guard only matches the literal `status: "active"` (F-04-2). The Issues text points staff to this box (`issues-core.ts` L553).
- **Requirements (draft):**
  1. Setting **Active** runs the same go-live check as Finalize (`lot-activation-gate-core.ts` L76–107) and refuses with the reasons.
  2. Every status change writes an audit row (who, from, to, when, reason).
  3. `check-activation-gate.ts` also catches non-literal status writes to `active`.
  4. The Issues "now clear" row activates through the gated path.
  5. Fix the stale "cannot attach one yet" text (F-04-12).
- **Interim:** SOP-04 §4.19 control. Carried into SOP-05.
- **SOP-05a note:** carried into SOP-05a §4.8. The same blind write also sets **Destroyed** and **Recalled** with no record (F-05a-1, F-05a-2); those requirements are in **G-22**, which extends this gap. Build G-19 and G-22 together.

## G-20 · Benchmark dataset lifecycle (retention, delete confirmation, working buttons only) (APPROVED, D33/D34)

- **Owner:** *"delete after 18 months, I think this is long enough right? what is the enterprise grade solution for this. I want to do what the pros do."* · *"delete should as "are you sure", I am not sure about the generate vendor leads or enrich kb… if there is an enterprise grade professional solution, just go with it."* (D33, D34)
- **Today:** the red **Delete** submits at once (`ccrs/page.tsx` L422–425 → `discovery/actions.ts` L770–788), cascading every benchmark table (`ingest.ts` L81; FKs `on delete cascade` in migrations 0079, 0106, 0109, 0181, 0182). Any `inventory.manage` login can press it. There is no retention rule. Compute benchmarks, Generate vendor leads and Enrich KB show on monthly-zip cards even though they do nothing there (F-04-15, F-04-16).
- **Requirements:**
  1. **Retention schedule in code**: monthly benchmark datasets are kept **18 months from the end of the data month** (`period_end`). The schedule is shown on the CCRS page in plain words.
  2. **Automatic purge**: a scheduled job (monthly, after the 10th) deletes datasets past the schedule. Each purge writes an audit row (`discovery.ccrs.retention_purge`, dataset id, label, period, rows removed). No one has to remember.
  3. **Notice**: a banner 30 days before a month is purged ("CCRS monthly · 2025-05 will be removed on 2026-12-01 under the 18-month retention rule").
  4. **Hold**: an owner-only "Keep (hold)" toggle with a required reason. Held months are skipped by the purge, and the hold is audited.
  5. **Manual delete**: a confirmation dialog that names the month and requires typing the month (for example `2025-05`) before **Delete** is enabled. The action is moved to the admin tier (`settings.manage`: owner, admin) and stays audited.
  6. **Working buttons only**: on `ingest_kind = monthly_zip` cards, hide **Compute benchmarks**, **Generate vendor leads** and **Enrich KB**. Show a one-line pointer: "Vendor leads for this month: Product Discovery → Market movers → Draft vendor leads from these suppliers." Legacy CSV cards keep their buttons.
  7. **Optional (Q-04-8)**: before the detail is purged, keep the month's overall headline row (scope `overall`) in a small history table, so long-run trend lines survive.
  8. Pure-core tests: due-date math across month lengths and leap years, hold skip, typed-confirm match, button visibility by ingest kind.
- **Out of scope:** Greenway's own receiving and sales records (five-year rule, WAC 314-55-087(1)) are never touched by this purge.
- **Interim:** SOP-04 §4.33–§4.34, form 8.4 part G.

## G-21 · First delivery from a vendor marker

- **Owner (D31):** *"no second count required, it should be highly suggested, especially for new vendors we havent received from before."*
- **Today:** nothing on the Receiving list or the review screen says a manifest is the first from its vendor (searched `src/app/admin/inventory/intake`, `src/lib/inventory`, `src/components/admin/inventory`). The vendor filter lists vendors seen in the loaded manifests only (`intake/page.tsx` L175; `ReceivingFilterBar.tsx` L101–111). With a filter on, the list reads the newest 1,000 manifests (`intake/page.tsx` L156–160).
- **Requirements (draft):**
  1. A **"First delivery from this vendor"** chip on the Receiving row and the review screen, computed from all accepted manifests for that vendor (license number first, name as fallback).
  2. On a first delivery, the review screen shows "Second count strongly recommended (owner policy)" and an optional "Second counter" name field saved on the manifest. It is not required (D31).
  3. Pure-core test for the first-delivery rule.
- **Interim:** SOP-04 §4.9 (Vendor-filter check), form 8.1 first-delivery box.

## G-22 · Audited, gated lot lifecycle changes (extends G-19)

- **Today:** **Lifecycle status** writes any of the five statuses with no check, no reason and no audit row (`inventory/actions.ts` L142–155 → `store.ts` L836–851). **Destroyed** leaves units on file and drops the lot from the CCRS Inventory file (F-05a-1, **S1**). **Recalled** is placed and lifted by any manager-level login with no record (F-05a-2, **S1**).
- **Requirements (draft):**
  1. Everything in G-19 (the go-live check on Active, an audit row on every change).
  2. **Destroyed removed** from the lot page's status choices. Destruction only through Returns & Destruction (SOP-15), which already sets it correctly (`disposition.ts` L1087–1094).
  3. A **required reason** on every status change, saved in the audit row (who, from, to, when, reason, reference).
  4. **Recalled → any other status** limited to the owner (or a new `inventory.recall.release` permission the owner assigns), with a required clearance reference.
  5. A **Status history** list on the lot page (from the audit rows), shown in Pacific time with names.
  6. A guard (compliance script or test) that no code path writes `destroyed` without a disposition record.
- **Interim:** SOP-05a §4.8–§4.10, form 8.1.

## G-23 · Hardened manual adjustment

- **Today:** read-then-write, no zero floor, no Sold out flip, no audit row (F-05a-3); empty note accepted although CCRS needs one for Other / Employee sample (F-05a-4); Destruction, Recall removal and Receive (add) offered (F-05a-5, F-05a-7); no Theft / Seizure (F-05a-6).
- **Requirements (draft):**
  1. Use the atomic `applyLotDelta` path (GW-012), with a refusal when the result would be below zero, and the same automatic Sold out flip at zero.
  2. A **required note** when the reason maps to CCRS Other, with the same wording CCRS needs; a warning for every reason.
  3. Remove **Destruction**, **Recall removal** and **Receive (add)** from the manual list (owner decision **D39**). Add a **Schedule destruction** link on the lot page that opens Returns & Destruction with this lot chosen (needs G-28).
  4. Add **Theft** and **Seizure** (D39: *"Add theft and seizure."*), with a required incident reference (SOP-20). The CCRS mapping exists (`ccrs-inventory-adjustment-core.ts` L87–90); CCRS needs detail for Theft (`ccrs-preflight-core.ts` L273). Whether they are owner-only is not yet decided; the SOP routes them to the owner.
  5. An audit row per adjustment (`inventory_lot.adjusted`), and the actor's name and Pacific date on the history list (F-05a-13).
  6. Fix the Issues expired-row fix text that points to Adjust quantity (`issues-core.ts` L461).
- **Interim:** SOP-05a §4.6–§4.7, form 8.2.

## G-24 · Expired stock at the register and FEFO lot draw (APPROVED, D36)

- **Today:** the register never reads expiry dates; sales draw oldest-created first (`sale-lot-read.ts` L39–47); the Issues tab is the only stop (F-05a-8).
- **Owner decision D36:** *"hard block edibles and liquid edibles, warnings for everything else."*
- **Requirements:**
  1. A completion-gate check on expired lots: **hard block, no override** when the lot's CCRS type is **Solid Edible** or **Liquid Edible** (plus Tincture / Capsule if the owner says so in **Q-05a-6**); a **warning** the budtender must acknowledge on every other expired lot, recorded on the sale. The same rule on the menu card (an expired edible lot does not count toward sellable stock).
  2. FEFO lot draw (soonest-expiring Active lot first, then oldest) in `sale-lot-read.ts`, with tests.
  3. The Issues text aligned with the owner's rule (it says *"Expired product may not be sold."* today).
  4. A nightly job that moves expired **edible / liquid edible** Active lots to Quarantine with an audit row.
- **Interim:** SOP-05a §4.16 (daily check by type), form 8.3.

## G-25 · Recall plan, recall log and recall reaching the website

- **Owner basis:** WAC 314-55-225(3)(d) (mandatory recall plan); (3)(f) weekly tracking. D37 (coordinator = admin, no back-up).
- **Today:** no recall plan, coordinator or log in the app (F-05a-15); the hold stops the register only, not the website or online orders (F-05a-16).
- **Requirements (draft):**
  1. A **Recall plan** settings page holding the coordinator (the admin, no back-up, **D37**), the LCB officer contact and the four plan sections, with an annual-review date and reminder.
  2. A **Recall event** record: notice, type (recall / market withdrawal), affected lots (sets them Recalled through the G-22 audited path), notification time and officer, weekly tracking rows (held, returned, destroyed, sold before hold), close-out.
  3. **Propagation:** a product with any Recalled lot is left out of the public menu and refused by online order pricing (read `recalledProductKeys` in `live-menu.ts` and `order-pricing.ts`, fail-closed for ordering), and open pickup orders holding it are flagged.
  4. A 48-hour countdown on market withdrawals and an "LCB not yet notified" warning on recalls.
- **Interim:** SOP-05a §4.10, §4.13, forms 8.4 and 8.5; **Always hide** on Product Enrichment.

## G-26 · Lot label link, scannable fallback barcode, sticky 86

- **Today:** the label is linked only from the manifest page; a lot with no lot code prints a barcode the register will not scan (F-05a-10). An 86 reverts at the next menu download while units are on file (F-05a-9).
- **Requirements (draft):**
  1. A **Print label** link on the lot page.
  2. The label barcode always uses a value the register's scan index knows (lot code or CCRS id), or warns on the label page when the lot has neither.
  3. **The professional 86 (D40, APPROVED):** (a) **shelf empty** clears by itself only when new stock is received for the product; if the books show units, a count task (SOP-06) is raised and the item stays off until it is done; (b) **damaged / unsellable** and **wrong listing** never clear on their own; (c) one **Open 86s** queue on Inventory → Issues with who, when and why; (d) every restore needs a manager and a reason and is audited, like **Restore to sale**; (e) the reconciler (`register-availability-core.ts` L318–421) honours all of this instead of auto-restoring.
  4. The 86 audit row records the signed-in employee's id from the register session, not only a client-sent name.
- **Interim:** SOP-05a §4.12, §4.19.

## G-27 · No typed cannabis unit cost (APPROVED, D38)

- **Owner decision D38:** *"absolutely not. That's illegal. Cost comes from the state CCRS manifest created by the vendor."*
- **Today:** cannabis cost is read from the manifest at receiving (`intake-parser.ts` L415–420) and locked on the lot page (`lot-edit-core.ts` L33–45, L38), but **Bulk fill → Unit cost** can still type it on Cultivera-import lots (`bulk-fill-core.ts` L54; `actions.ts` L904) (F-05a-11, **S1**).
- **Requirements:**
  1. Remove `unit_cost_minor_units` from the Bulk fill field list for cannabis lots (non-cannabis cost keeping its own owner/admin path, `inventory.cost.fill`).
  2. A compliance guard (test or script) that no server action writes a cannabis lot's unit cost except the manifest intake path.
  3. A cannabis lot with no cost shows "cost missing — correct from the manifest" on Issues instead of inviting a typed value.
- **Interim:** SOP-05a §4.20.

## G-28 · Returns & Destruction handles held lots (design awaits Q-05a-8)

- **Owner basis:** D39 (the owner's question: *"Should the destructions page handle marking those fields automatically?"* Answer: yes; it mostly does).
- **Today:** the destruction form lists only Active lots (`disposition/page.tsx` L103, F-05a-17); scheduling writes Quarantine over Recalled, lifting the register hold (`disposition.ts` L965–971, F-05a-18, **S1**); Cancel always sets Active (L1113–1114, F-05a-19).
- **Requirements (draft):**
  1. The lot picker lists **Active, Quarantine and Recalled** lots with their status shown.
  2. Scheduling a **Recalled** lot leaves it **Recalled** (the register hold stays on); only Active lots move to Quarantine.
  3. The destruction event stores the lot's status before scheduling; **Cancel** restores that status, with an audit row.
  4. The lot page gets a **Schedule destruction** link that opens the page with the lot chosen (pairs with G-23).
  5. Tests for all three, plus a guard that no destruction path changes a Recalled lot to anything but Destroyed.
- **Interim:** SOP-05a §4.9 (points 1–3), §4.10 step 9, form 8.4 (C).

## G-29 · Other Inventory on the register (Q-05b-1)

- **Owner basis:** the intake form already promises it (*"Has one? Scan it here — it becomes the register code."*, `NonCannabisIntakeForm.tsx` L122–124). D42/D43 ask for inventory management to be finished end to end.
- **Today:** the register reads only `menu_items` and cannabis lots. Non-cannabis is rung on the Keypad as free text, and **On hand** never moves with a sale (F-05b-1, **S1**).
- **Requirements (draft):**
  1. Active non-cannabis items are served to the register with SKU, UPC/EAN, name, price and the category (`accessories` or `merch`), taxed at 9.3% with no limit.
  2. A scanned SKU label or manufacturer barcode adds the priced line. An unknown code says so and never falls through to cannabis.
  3. A completed sale decrements `on_hand` atomically, with a ledger row (`sale`) and the order id. A void or return restores it.
  4. Offline sales queue and replay the decrement once.
  5. The Keypad stays for genuinely un-catalogued items, and its lines are listed for the weekly count.
  6. Tests: scan → line → tax; decrement / void / return; no cannabis path changed.
- **Interim:** SOP-05b §4.4–§4.5, form 8.1.

## G-30 · Edit a non-cannabis price and cost (Q-05b-2)

- **Today:** price is set only at draft; cost only while $0.00; a $0.00 price is accepted (F-05b-6).
- **Requirements (draft):**
  1. **Change price** and **Change cost** on an active item, limited to the role the owner picks (Q-05b-2), with a required reason and an audit row old → new.
  2. Refuse a $0.00 or blank price at draft, at confirm and in the invoice builder (or require an explicit "free item" flag).
  3. Price history on the item. The SKU never changes.
- **Interim:** SOP-05b §4.9 (archive and re-create, owner only, form 8.2).

## G-31 · Cannabis-line guard for categories (Q-05b-4)

- **Today:** the lot override, **Move products** and the inventory-type mapping can each cross into or out of `merch` / `accessories` / `accessory` / `paraphernalia` with no check. This changes tax, limits, scan and floor (F-05b-9, **S1**).
- **Requirements (draft):**
  1. One pure check, `crossesCannabisLine(fromCategory, toCategory)`, shared by `parseClassificationEdit`, `buildReassignPlan` and the inventory-type save.
  2. A crossing is refused, or (if the owner chooses in Q-05b-4) allowed only for the owner with a typed reason, recorded as its own audit action.
  3. A product that came from a CCRS manifest (it has a cannabis lot) can never be moved into a non-cannabis category.
  4. A daily check lists any menu row whose product has a cannabis lot but a non-cannabis category, on Inventory → Issues.
  5. Tests for all three entry points.
- **Interim:** SOP-05b §4.15–§4.17, form 8.3 (never cross; owner only).

## G-32 · Non-cannabis, publish and price hardening bundle (Q-05b-5)

- **Today / requirements (draft), one line per finding:**
  1. Confirm and Archive write an audit row; add **Restore** for an archived item (F-05b-2).
  2. Adjustments use one atomic database update with a zero floor (F-05b-3).
  3. Direction is fixed by Reason; **Count correction** and **Other** allow either (F-05b-4).
  4. Recent adjustments shows the actor and Pacific time (F-05b-5).
  5. A failed invoice save removes everything it wrote (one transaction) (F-05b-7).
  6. The invoice audit write is awaited and failure is shown (F-05b-8).
  7. Publish refuses (fails closed) when the removal diff can't be read (F-05b-10).
  8. Category audits carry before / after (F-05b-11).
  9. **Save sell price** on a cost-unknown lot is owner only, or blocked until the CCRS cost is in (owner's choice, Q-05b-5) (F-05b-12, D38).
  10. A classification lot-row write failure shows a warning, not "saved" (F-05b-13).
- **Interim:** the store rules in SOP-05b §4.3–§4.9, §4.14, §4.15, §4.19, §4.21.

