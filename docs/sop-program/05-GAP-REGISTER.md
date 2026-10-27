# SOP Program — Gap Register

Created in slice SOP-01 · 2026-10-27 · Updated in slice SOP-02 · 2026-10-27 · Updated in slice SOP-03 · 2026-10-27 (owner answers D14–D19; SOP-03 gaps G-14, G-15; G-04 updated) · Updated in slice SOP-04 · 2026-10-27 (D21 → G-03; D23–D27 → G-04; SOP-04 gaps added)

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
| G-16 | Partial-quantity receive: record "N of M received", the rest refused, per line | (owner: *"only accepting a part of the manifest"*) · Q-04-1 | F-04-1 | SOP-04 §4.11: refuse the whole short line; vendor re-sends | OPEN (awaiting Q-04-1) |
| G-17 | Show emails that failed to stage (parse failed / no manifest) on the Receiving screen | (procedure need) | F-04-4 | SOP-04 §4.3 step 4: daily mailbox-vs-list check, form 8.1 | OPEN |
| G-18 | Monthly CCRS public records request: reminder task, tracking # / received date / wording log, corrected request template and phone | D28 (*"include the monthly CCRS public record request"*) | F-04-19, F-04-18, F-04-13, F-04-14, F-04-17 | SOP-04 §4.26–§4.28, form 8.4 | OPEN |
| G-19 | Gated and audited lot activation from the lot page (Lifecycle status runs the go-live check and writes an audit row) | (compliance: WAC 314-55-102) | F-04-2, F-04-12 | SOP-04 §4.19: manager only, from a "now clear" Issues row, logged on form 8.1 | OPEN |

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
- **Requirements (draft, only if Q-04-1 = build it):**
  1. Per line, an optional **counted** quantity (≤ shipped) with a refusal reason for the difference.
  2. The lot is activated at the counted quantity; the inventory adjustment `receive` is at the counted quantity.
  3. The weekly InventoryTransfer reports the quantity actually received, consistent with the vendor's CCRS Update.
  4. The timeline and partial note record shipped / counted / refused.
  5. Tests for "18 of 20", overage refusal, and zero counted (= refuse).
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
  1. A compliance-calendar task "CCRS public records request (previous month)", monthly, owner-assigned, due on the owner's chosen day (Q-04-4).
  2. A small request log on the CCRS page: month, filed date, tracking #, acknowledged date, received date, linked dataset.
  3. The request template updated to the owner's proven wording (Q-04-4), with dates pre-filled for the previous calendar month.
  4. The phone corrected to (360) 664-1753; Step 1 item 5 and the help panel rewritten for the one-zip flow; an honest time estimate.
  5. A "last month not yet dropped" nudge on the benchmarks pages.
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

