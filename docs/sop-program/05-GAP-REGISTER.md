# SOP Program — Gap Register

Created in slice SOP-01 · 2026-10-27 · Updated in slice SOP-02 · 2026-10-27

A **gap** is something the owner wants, or a procedure needs, that the system does not do today. Each gap is a list of requirements only. **Nothing here is built in the SOP program.** Builds are chosen with the owner in the Phase C strategy session (`SOP-INT`). Until a gap is built, staff follow the **interim procedure** named for it. That procedure is printed in the SOP so the control exists on paper from day one.

Findings (bugs, weaknesses) live in `03-FINDINGS-LEDGER.md`. Gaps cite the findings that prove them.

| Status key | Meaning |
|---|---|
| OPEN | Not built; interim procedure in force |
| OPEN · TO AUDIT | Owner asked for it; the current code has not yet been audited in its own slice |
| BUILT | Built and verified (moved here only after a later build slice) |

---

## Summary

| Gap | What | Owner decision | Findings | Interim procedure | Status |
|---|---|---|---|---|---|
| G-01 | Second-person count at till close | D2 | F-01-9, F-00-5 | SOP-01 §4.27 step 8, forms 8.2 / 8.4 | OPEN |
| G-02 | Master till ↔ little safe denomination log (and register-swap denominations) | D3 | F-01-8, F-00-7, F-02-8 | **SOP-02 §4.10 form 8.2** (master ↔ little safe) and **§4.11 form 8.3** (register ↔ master); SOP-01 §4.26 | OPEN |
| G-03 | $5 over/short admin warnings screen (reason required); master till scope pending Q-02-3 | D7 | F-01-11, F-02-6 | SOP-01 §4.30 form 8.5 · SOP-02 §4.8 form 8.5 | OPEN |
| G-04 | Deposit bag screen (seal → morning verify → safe → bank) | (original request) | F-00-6 | SOP-03 (paper), SOP-01 §4.29 | OPEN |
| G-05 | Per-shift / per-cashier report | (original request: "shift close reports") | F-01-10 | SOP-01 §4.27 step 9 (X report), close slip 8.2 per drawer | OPEN |
| G-06 | SOPs readable, printable and **exportable** in the Employee area; report export | (original request) | F-00-8, F-00-10 | Markdown files in `docs/sop/`; print from the browser | OPEN |
| G-07 | Crawler PO builder: save the fetched vendor-menu data | D4 | F-00-15 | None needed yet | OPEN · TO AUDIT (SOP-09) |
| G-08 | Master till denomination standard (D11 mix) checked and shown | D11 | F-02-3 | SOP-02 §4.9, form 8.1 mix columns | OPEN |
| G-09 | Master till sheet printable and exportable; history beyond 30 rows | (original request: "exportable and printable") | F-00-8, F-02-13 | SOP-02 §4.18, form 8.1 binder, EOD print | OPEN |
| G-10 | Manager Till standard float = $167.50, and a way to set register floats | D10 | F-02-2, F-01-13 | SOP-02 §4.14 (ignore the $300 hint) | OPEN |
| G-11 | Supply-run screen (only if the owner wants supply runs at all) | Q-02-4 (pending) | F-02-11 | SOP-02 §4.13, form 8.4 (exceptions only; store rule is the shop card) | OPEN · AWAITING OWNER |
| G-12 | Post cash drops to the books (10110 → 10100) | (books integrity; owner model till → safe → bank) | F-02-1 | None needed for staff; recorded for the build phase | OPEN |

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
  2. A **reason is required** whenever there is any over/short, as the owner wrote ("should be required to be input for over/ under"). Whether "any" means every non-zero difference or only those above $5 is to be **confirmed with the owner in Phase C**. Until then the interim form asks for a reason for any non-zero difference (the safer reading).
  3. An **admin-only** screen showing who, when, how much (over or short) and the reason. Proposed location: under Registers, next to reconcile (the owner will confirm the "most logical place").
- **Interim:** SOP-01 §4.30 and form 8.5. The manager writes who / when / how much / reason and hands it to the owner.
- **SOP-02 update (2026-10-27):** master till counts have no threshold or reason either (F-02-6). Whether D7 covers them is **Q-02-3**. Interim: SOP-02 §4.8 and its form 8.5. If yes, the same warnings screen should list master till variances, with the count window and **Counted by**.

## G-04 · Deposit bag screen

- **Owner (original request):** night count → morning recount → seal bag → safe → bank.
- **Today:** the bag tables and core exist, but no screen reaches them (F-00-6, S1).
- **Interim:** SOP-03 paper procedure (to be written in slice SOP-03). SOP-01 §4.29 covers what to do with the money at close.

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

- **Owner (D10):** all three tills hold $167.50.
- **Today:** Manager Till seeded at $300.00 and never corrected (`0038` L184; `0077` L40–46). No screen edits `default_float_minor`. The register app does not compare count-in to any standard (F-01-13).
- **Requirements (draft):**
  1. Set the Manager Till `default_float_minor` to 16750 (migration; idempotent, like 0077).
  2. Optionally, an owner-only setting for each register's float, audited.
  3. With F-01-13: warn at count-in when the count is not the standard float.
  4. Fix the `drawer-posting-service.ts` L190–191 comment.
- **Interim:** SOP-02 §4.14.

## G-11 · Supply-run screen (pending owner)

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
