# SOP Program — Gap Register

Created in slice SOP-01 · 2026-10-27

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
| G-02 | Master till ↔ little safe denomination log | D3 | F-01-8, F-00-7 | SOP-01 §4.26, form 8.3 | OPEN |
| G-03 | $5 over/short admin warnings screen (reason required) | D7 | F-01-11 | SOP-01 §4.30, form 8.5 | OPEN |
| G-04 | Deposit bag screen (seal → morning verify → safe → bank) | (original request) | F-00-6 | SOP-03 (paper), SOP-01 §4.29 | OPEN |
| G-05 | Per-shift / per-cashier report | (original request: "shift close reports") | F-01-10 | SOP-01 §4.27 step 9 (X report), close slip 8.2 per drawer | OPEN |
| G-06 | SOPs readable, printable and **exportable** in the Employee area; report export | (original request) | F-00-8, F-00-10 | Markdown files in `docs/sop/`; print from the browser | OPEN |
| G-07 | Crawler PO builder: save the fetched vendor-menu data | D4 | F-00-15 | None needed yet | OPEN · TO AUDIT (SOP-09) |

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

## G-03 · $5 over/short admin warnings screen

- **Owner:** *"Q6- $5. It should be an admin only screen placed in the most logical place to put it for me to interact with. Just warnings for now. Who, when, how much, their reason for why it's over/ under (should be required to be input for over/ under)."* (D7).
- **Today:** no threshold, no warnings screen and no reason field (F-01-11; `actions.ts` L109–141; no `over_short_reason` anywhere in the code). Accurate over/short also depends on F-01-3 (expected shows $0.00) and F-01-4 (hand-typed cash sales). Those must be fixed first or the warnings will be wrong.
- **Requirements (draft):**
  1. Threshold **$5.00** (500 cents). An over or short of more than $5 raises a **warning**. Warnings only: nothing is blocked.
  2. A **reason is required** whenever there is any over/short, as the owner wrote ("should be required to be input for over/ under"). Whether "any" means every non-zero difference or only those above $5 is to be **confirmed with the owner in Phase C**. Until then the interim form asks for a reason for any non-zero difference (the safer reading).
  3. An **admin-only** screen showing who, when, how much (over or short) and the reason. Proposed location: under Registers, next to reconcile (the owner will confirm the "most logical place").
- **Interim:** SOP-01 §4.30 and form 8.5. The manager writes who / when / how much / reason and hands it to the owner.

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

---

## Not gaps (decisions with no build)

- **D1:** no SOP acknowledgment gate. Nothing to build.
- **D5 / D6:** SOP-12 (Digital Assets) and the new SOP-21 (SEO) are documents, scheduled in `02-SOP-CATALOG-AND-ROADMAP.md`.
- **D8:** keep employee `job_role` and user `StaffRole` separate. This is the current design; SOP-01 §2 and SOP-08 explain it.
