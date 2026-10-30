# SOP Program — Gap Register

Created in slice SOP-01 · 2026-10-27 · Updated in slice SOP-02 · 2026-10-27 · Updated in slice SOP-03 · 2026-10-27 (owner answers D14–D19; SOP-03 gaps G-14, G-15; G-04 updated) · Updated in slice SOP-04 · 2026-10-27 (D21 → G-03; D23–D27 → G-04; SOP-04 gaps added) · Updated in slice SOP-05a · 2026-10-27 (D29 → G-16 APPROVED; D32 → G-18; D33/D34 → G-20; D31 → G-21) · Updated in slice SOP-05b · 2026-10-27 (G-29…G-32 added) · Updated in fix slice after SOP-05b · 2026-10-28 (D44 → G-24; D45–D49 → G-29, G-30, G-30A new, G-31, G-32 all APPROVED)

Updated in slice SOP-15 · 2026-10-28 (D54–D61 → G-33…G-39 APPROVED, new G-40, G-41; SOP-15 gaps G-42…).

Updated in slice SOP-08 · 2026-10-28 (D63–D68 → G-42, G-43, G-45, G-47 APPROVED; new G-50, G-51; SOP-08 gaps G-52…G-58 PROPOSED).

Updated after SOP-08 · 2026-10-28 (D70–D74 → G-53, G-54 APPROVED; G-57 DEFERRED; new G-59 APPROVED; D75 → G-06 PARTLY BUILT by the SOP Library).

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
| G-01 | Second-person count at till close | D2 | F-01-9, F-00-5 | SOP-01 §4.27 steps 8–12, forms 8.2 / 8.4 | **BUILT** (Phase 2.2) |
| G-02 | Master till ↔ little safe denomination log (and register-swap denominations) | D3 | F-01-8, F-00-7, F-02-8 | **SOP-02 §4.10 form 8.2** (master ↔ little safe) and **§4.11 form 8.3** (register ↔ master); SOP-01 §4.26 | **BUILT** (Phase 2.7b, #1552) |
| G-03 | $5 over/short admin warnings screen (reason required); **covers the master till too (D16)** | D7, D16 | F-01-11, F-02-6 | SOP-01 §4.30 form 8.5 · SOP-02 §4.8 form 8.5 | **BUILT** (Phase 2.3) |
| G-04 | Deposit bag screen (night count → morning verify → seal → safe → bank) | (original request) | F-00-6, F-03-9, F-03-10 | **SOP-03 §4.5–4.13, forms 8.1 / 8.2 / 8.6** | **BUILT** (Phase 2.6a, #1549; needs migration 0316) |
| G-05 | Per-shift / per-cashier report | (original request: "shift close reports") | F-01-10 | Close slip 8.2 per drawer; the till summary prints the drawer's figure | **BUILT** (Phase 2.1: per-drawer cash figure at reconcile, F-01-4 FIXED, #1544; Phase 2.1b: printable per-cashier shift report, F-01-10 FIXED, #1556; SOP-01 §4.35) |
| G-06 | SOPs readable, printable and **exportable** in the Employee area; report export | (original request) | F-00-8, F-00-10 | Markdown files in `docs/sop/`; print from the browser | **PARTLY BUILT** (D75: SOP Library at Employee → SOP Library reads and prints every SOP); report export still OPEN |
| G-07 | Crawler PO builder: save the fetched vendor-menu data | D4 | F-00-15 | None needed yet | OPEN · TO AUDIT (SOP-09) |
| G-08 | Master till denomination standard (D11 mix) checked and shown | D11 | F-02-3 | SOP-02 §4.9, form 8.1 mix columns | **BUILT** (Phase 2.7a, #1551) |
| G-09 | Master till sheet printable and exportable; history beyond 30 rows | (original request: "exportable and printable") | F-00-8, F-02-13 | SOP-02 §4.18, form 8.1 binder, EOD print | **BUILT** (Phase 2.7a, #1551; the exchanges line added in Phase 2.7b, #1552) |
| G-10 | ~~Manager Till standard float = $167.50~~. Owner corrected: Manager Till = $300.00, already in the code | D10 → D19 | F-02-2 (withdrawn) | None needed | **CLOSED** (D19) |
| G-11 | Supply-run screen | **D17** ("id like the supply run screen built") | F-02-11 | SOP-02 §4.13, form 8.4 | **BUILT** (Phase 2.7c, #1554) |
| G-12 | Post cash drops to the books (10110 → 10100) | (books integrity; owner model till → safe → bank) | F-02-1 | None needed for staff; recorded for the build phase | **BUILT** (Phase 2.4) |
| G-13 | Any employee can record the master till count (not only manager-level logins) | **D15** | F-02-10, F-02-4 | SOP-02 §2, §4.5: a manager login enters it and picks the counter | **BUILT** (Phase 2.7a, #1551) |
| G-14 | Cash-to-bank books wiring (seal poster → 10400, bank-deposit clearing caller, census corrected, panel text) | (original request: "for depositing to the bank") | F-03-1, F-03-3, F-03-10, F-02-1 | SOP-03 §4.13 bag log + bank receipts; §4.15 the panel counts sealed bags only | **BUILT** (Phase 2.5 door; Phase 2.6a seal poster, #1549) |
| G-15 | EOD deposit sheet in the app + export (deposit figure, denominations, two signatures, refunds, date picker, CSV/XLSX) | (original request: "End of day spreadsheet" … "exported and printed") | F-03-5, F-03-6, F-03-7, F-03-8, F-00-8 | SOP-03 form 8.1 night sheet; §4.8 Z report for cash; §4.9 print | **BUILT** (Phase 2.6b, #1550; bag section needs 0316) |
| G-16 | Partial-quantity receive: record "N of M received", the rest refused, per line | **D29** (*"we need a way to accept less than what came in, please add this to the list of serious issues to fix"*) | F-04-1 (**S1**, FIXED) | SOP-04 v1.5 §4.11: **Count short** (before migration 0319: refuse the whole short line) | **BUILT** (Phase 3.1) |
| G-17 | Show emails that failed to stage (parse failed / no manifest) on the Receiving screen; refetch what was missed or failed | (procedure need); owner message 7 (*"I need a way to ask the system to grab the ones it missed or failed to get"*) | F-04-4 (FIXED) | SOP-04 v1.6 §4.3 step 4, §4.4a–c: Needs attention, Try again / Resolved, Check the mailbox now, Find an email (before migration 0320: missed emails still pulled in; failures closed with a manual import) | **BUILT** (Phase 3.2a) |
| G-18 | Monthly CCRS public records request: reminder on the 10th (admin), month drop-down (one or several months) filling the built-in text, tracking # / received log, corrected phone and stale help | D28, **D32** | F-04-19, F-04-18, F-04-13, F-04-14, F-04-17 | SOP-04 §4.26–§4.28, form 8.4 | **APPROVED** (drop-down, D32) · rest OPEN |
| G-19 | Gated and audited lot activation from the lot page (Lifecycle status runs the go-live check and writes an audit row) | (compliance: WAC 314-55-102) | F-04-2, F-04-12 | SOP-04 §4.19: manager only, from a "now clear" Issues row, logged on form 8.1 | **BUILT** (Phase 1.1) |
| G-20 | Benchmark dataset lifecycle: typed delete confirmation, 18-month retention purge (notice, hold, audit), working-buttons-only on monthly cards | **D33**, **D34** | F-04-15, F-04-16 | SOP-04 §4.33–§4.34, form 8.4 part G | **APPROVED** |
| G-21 | First-delivery-from-vendor marker on the manifest review screen (prompts the recommended second count) | **D31** | — (no finding; feature need) | SOP-04 §4.9 Vendor-filter check, form 8.1 box | OPEN |
| G-22 | Audited, gated lot lifecycle: no manual Destroyed, a reason on every change, owner-only recall release, status history (extends G-19) | (compliance: WAC 314-55-225, CCRS traceability) | F-05a-1 (**S1**), F-05a-2 (**S1**), F-04-2 | SOP-05a §4.8–§4.10, form 8.1 | **BUILT** (Phase 1.1) |
| G-23 | Hardened manual adjustment: atomic, no negative, Sold out at zero, notes where CCRS needs them, no Destruction / Recall removal / Receive, add Theft / Seizure, audit + name | (procedure need; CCRS E13) | F-05a-3…F-05a-7, F-05a-13 | SOP-05a §4.6–§4.7, form 8.2 | **BUILT** (Phase 1.2) |
| G-24 | Expired stock at the register: **hard block** expired Solid Edible, Liquid Edible, Tincture, Capsule and RSO (RSO by store category), **warn** on the rest; FEFO lot draw | **D36, D44** | F-05a-8, F-05a-20 | SOP-05a §4.16, form 8.3 | **BUILT** (Phase 1.6b) |
| G-25 | Recall plan + recall event log in the app; recall hold reaches the website and online orders | (compliance: WAC 314-55-225(3)(d), (3)(f)) | F-05a-15, F-05a-16 | SOP-05a §4.10, §4.13, forms 8.4–8.5 | **BUILT** (Phase 1.6c) |
| G-26 | Print-label link on the lot page, scannable fallback barcode, **the professional 86** (reason-driven clearing, one queue, audited manager restore) | **D40** | F-05a-9, F-05a-10 | SOP-05a §4.12, §4.19 | **APPROVED** (86 part, D40) · rest OPEN |
| G-27 | No typed cannabis unit cost: remove **Unit cost** from Bulk fill for cannabis lots (cost only from the vendor's CCRS manifest) | **D38** | F-05a-11 (**S1**) | SOP-05a §4.20 | **BUILT** (Phase 0.5) |
| G-28 | Returns & Destruction handles held lots: lists Quarantine and Recalled lots, keeps Recalled while pending (hold stays on), Cancel restores the earlier status **with a reason (owner only)**; a partial destruction restores the earlier status (SOP-15 extension) | **D39** (design: Q-05a-8, Q-15-3) | F-05a-17, F-05a-18 (**S1**), F-05a-19, F-15-9, F-15-11 | SOP-05a §4.9, §4.10, form 8.4; SOP-15 §4.19–§4.22, form 8.5 | **BUILT** (Phase 1.3) |
| G-29 | Non-cannabis goods fully used everywhere: register scan to a priced line, sale decrements On hand, void / return restores, cost of goods posted, menu presence, reports; audited | **D45** | F-05b-1 (**S1**), F-05b-15 | SOP-05b §4.1–§4.5, §4.8, form 8.1 | **BUILT** (Phase 4) |
| G-30 | Edit non-cannabis price and cost by owner, admin or manager, audited old → new; refuse a $0.00 price | **D46, D48** (Q-05b-6 open: Save cost for managers) | F-05b-6 | SOP-05b §4.3, §4.6, §4.7, §4.9, form 8.2 | **BUILT** (Phase 4) |
| G-30A | Merch **Remove** limited to owner and admin (a new permission) | **D47** | F-05b-14 | SOP-05b §2, §4.11, §6, §9 | **BUILT** (Phase 4) |
| G-31 | Cannabis-line guard: **refused outright, both directions, no override**, for any lot override, Move products or type mapping | **D48** (compliance: RCW 69.50.535 excise, WAC 314-55-095 limits) | F-05b-9 (**S1**) | SOP-05b §4.15–§4.17, §4.21, form 8.3 | **BUILT** (Phase 0.4) |
| G-32 | Hardening bundle: audit Confirm / Archive + Restore, atomic adjustment, Direction locked to Reason, full invoice rollback, checked audits, publish fails closed, **no price save on a cost-unknown lot**, classification write warning | **D45, D49** (D38 for the price) | F-05b-2, 3, 4, 5, 7, 8, 10, 11, 12, 13 | SOP-05b §4.3–§4.9, §4.14, §4.15, §4.19, §4.21 | **BUILT** (Phase 4 items 1–6; Phase 4b items 7–10) |
| G-33 | Audit stage controls: **Release to Cycle Counts** (separate owner button), send back, cancel | **D54** | F-06-1 (**S1**), F-06-2 | SOP-06 §4.7 (paper count, form 8.2) | **APPROVED** |
| G-34 | Counter **I'm done** → back to the audit + **/admin cockpit** notice; staff-safe links; live progress | **D55** | F-06-3, F-06-4, F-06-16 | SOP-06 §4.8 (tell the owner) | **APPROVED** |
| G-35 | Count cutoff: per-lot capture at first count; sales during the count reconciled; counting in open hours | **D58, D61** | F-06-7 (**S1**) | SOP-06 §4.11 (outside selling hours) | **APPROVED** |
| G-36 | Count-sheet integrity: one counter per count (claim), +1 per scan, recount blocks, stage checks | **D56, D60** | F-06-5, F-06-5b (**S1**), F-06-6, F-06-13 (**S1**), F-06-15 | SOP-06 §2, §4.10, §4.12 | **APPROVED** |
| G-37 | Reasons editable before approval, validated, owner decisions enforced | (procedure need) | F-06-14 | SOP-06 §4.15, form 8.3 | OPEN |
| G-38 | Daily checklists in the app with the full task catalog | **D57** | F-06-12, F-00-9, F-06-17 | SOP-06 §4.23, forms 8.5–8.8 | **APPROVED** |
| G-39 | Counting housekeeping: one schedule, legacy sessions cancelled, Pacific times | **D58, D59** | F-06-8…F-06-11 | SOP-06 §4.20, §4.22 | **APPROVED** |
| G-40 | Intelligent cycle counts: vendor of the day with chunking, ABC, exceptions, expiring, Cultivera, overdue | **D58** | F-06-8 | SOP-06 §4.24 | **APPROVED** |
| G-41 | Annual year-end full count (no cap, sections, one review) | **D58** | — | SOP-06 §4.24 | **APPROVED** |
| G-42 | State-exact vendor return: Greenway files the CCRS manifest as origin (outgoing Manifest.CSV builder); reserve at logging, reduce and post CCRS Other at departure; RMA, manifest, license, detail required; no 48–72 h / Mon-Wed-Fri text; server-checked steps with actor; Pacific times | D63 (compliance: WAC 314-55-079(11), -085; CCRS Manifest User Guide) | F-15-1 (**S1**), F-15-2, F-15-3, F-15-19 | SOP-15 §4.9–§4.13, form 8.2 | **BUILT** (Phase 1.5; packet Phase 1.7b) |
| G-43 | Hardened destruction record: witness required (anyone, not the performer), camera reference, approval reference for Other method, on-hand checked at scheduling, Pacific times, printable destruction log | D64 (WAC 314-55-097, -083(3)(a)) | F-15-4, F-15-5, F-15-12, F-15-21 | SOP-15 §4.17–§4.18, form 8.3 | **BUILT** (Phase 1.6a; req 7 photo + video and the per-event print in Phase 1.7a) |
| G-44 | Customer-return segregation: destroy-return units never sellable (returned / quarantine bucket); return, add-back and destruction event saved atomically | (procedure need; D62) | F-15-6 (**S1**), F-15-7 | SOP-15 §4.7, form 8.1 | **BUILT** (Phase 1.4) |
| G-45 | Remove the back-office Customer return wizard; CSV download checks the ledger or is removed | D66 | F-15-8, F-15-10 | SOP-15 §4.4–§4.8 | **APPROVED** |
| G-46 | Readable errors on Returns & Destruction (no bare "qty" / "reason") | (procedure need) | F-15-13 | SOP-15 §4.15 | PROPOSED |
| G-47 | Remove the dead legacy Sample-pricing panel (`sample_settings`, `sample-guardrails.ts`), with G-51 | D68 | F-15-16 | SOP-15 §4.26 | **BUILT** (Phase 0.2) |
| G-48 | Returns in the books and taxes: refund journal to 50910 for owner approval; excise Box 1 net of returned sales | (books-23; RCW 69.50.535) | F-15-14, F-15-15 | SOP-15 §4.24, form 8.6 | **BUILT** (Phase 2.8, #1555) · Phase 2.8b: cost of returned units drafted back (`refunds:<day>#cogs`), #1556 |
| G-49 | Disposition housekeeping: migration comment, reasons header, help panel names the Sale correction file; compliance doc's "Returned to seller" citation corrected | (procedure need) | F-15-17, F-15-18 | SOP-15 §4.1, §4.13, §4.27 | PROPOSED |
| G-50 | Destruction hold default 0 h and panel text "the law sets no hold" | D67 (WAC 314-55-097) | F-15-17 | SOP-15 §4.27 | **APPROVED** |
| G-51 | Samples never reach the menu or the register: no draft for a sample lot; register menu, barcode index and lot draw skip sample lots; website never lists them | D68 (WAC 314-55-096(1)(i)) | F-15-20 (**S1**) | SOP-15 §4.26 interim check | **BUILT** (Phase 0.2) |
| G-52 | New people start as **Candidate** (Add to roster and Payroll Setup); PIN locked until **Activate**; Activate runs the gate; help text matches | (procedure need; RCW 69.50.357(2)–(3)) | F-08-1 (**S1**), F-08-7 | SOP-08 §4.6, §4.13 (no PIN until form 8.1 is signed) | **BUILT** (Phase 0.3) |
| G-53 | Owner-set **link** between a user and an employee file; never creates an employee (books-87); register then accepts the digital acknowledgment | Q-08-1 | F-08-2 | SOP-08 §4.10 (paper handbook route for everyone) | **BUILT** (Phase 5, #1566) |
| G-54 | **One-step offboarding**: Terminate offers to deactivate the linked sign-in, deletes future shifts, flags an open punch; Deactivate points to the file | Q-08-2 | F-08-3 | SOP-08 §4.21–§4.22, form 8.3 (both halves by hand, same day) | **BUILT** (Phase 5, #1566) |
| G-55 | Checklist ↔ Document tracker kept in step; Activate also needs hire date, badge number and a training-log line per required topic; paper handbook row carries the version | (procedure need; WAC 314-55-087(1)(e)) | F-08-4, F-08-5 | SOP-08 §4.10 step 4, §4.11 step 3, §4.18 | PROPOSED |
| G-56 | **Rehire** keeps the earlier termination (employment periods) and starts a fresh checklist | (procedure need) | F-08-6 | SOP-08 §4.24 (print status card first; uncheck everything) | PROPOSED |
| G-57 | **Visitor log and badges** in the app; employee badge printing | Q-08-3 (WAC 314-55-083(1)) | F-08-8 | SOP-08 forms 8.2, 8.5 (§4.12, §4.19) | DEFERRED (D72: paper for now) |
| G-58 | Housekeeping: invite default role the same on screen and server; full role descriptions; job-role changes audited with old and new values | (procedure need) | F-08-9, F-08-10 | SOP-08 form 8.4 (§4.16–§4.17) | PROPOSED |
| G-60 | **Emailed COAs attach to the delivery's lines**: read every lab PDF certificate by certificate, match by lab id then a unique name (verify), say the outcome, file each PDF under its own lab results; re-read and attach by hand on the receiving page | Owner message 6 (*"didn't or couldn't attach the coa lab results to the products in the receiving detail page"*) | F-04-21 (**S1**), F-04-10 (COA part) | SOP-04 v1.4 §4.15 | **BUILT** (Phase 3.1a) |
| G-59 | **Activate, Terminate and Rehire owner and admin only**: new permission (e.g. `staffing.lifecycle` = [owner, admin]); buttons hidden for managers; server actions refuse | D74 | F-08-1, F-08-3 (context) | SOP-08 v1.1 §2 rules 1–2 (managers never press them) | **BUILT** (Phase 0.3) |
| G-61 | **Clock-out guard**: a register clock-out is refused while the employee owns an open drawer; closing a drawer never clocks out | D84 (Q-E-6) | — | SOP-01 §4.2 | **BUILT** (Fix Phase 6, #1567) |
| G-62 | **Float check at count-in**: compare with the register's standard float; warn, never block; audited | D85 (Q-E-7) | F-01-13 | SOP-01 §4.3 | **BUILT** (Fix Phase 6, #1567) |
| G-63 | **Retire Verify till**: the morning blind bag recount is the verify; stale posts refused and audited | D83 (Q-E-5) | F-00-3, F-00-4 (verify part), F-01-12 | SOP-01 §4.30, SOP-03 §4.12 | **BUILT** (Fix Phase 6, #1567) |
| G-64 | **Crew tip pool**: pool + people at close, even split in whole cents (floor, leftover stays), share saved as the cashier's own tips | D89 (Q-E-10) | — | SOP-01 §4.27 step 7 | **BUILT** (Fix Phase 6, #1567) |
| G-65 | **Night deposit assembled and verified**: tick each till's stack against the screen, server re-works the lines, no night denominations; denomination count is the fallback | D82 (Q-E-4) | — | SOP-03 §4.5 | **BUILT** (Fix Phase 6, #1567) |
| G-66 | **Reconcile timing**: either manager, before the seal; seal warns and audits unreconciled drawers; EOD "awaiting manager reconcile" | D87 (Q-E-8) | — | SOP-01 §4.30, SOP-03 §4.7, §4.11 | **BUILT** (Fix Phase 6, #1567) |

---

## G-01 · Second-person count at till close

- **Owner:** *"Q2- close only, and it can be any second employee"* (D2).
- **Today:** a blind close takes one employee PIN (`TillCloseRequest`, till-core L48–58). There is no second counter (F-01-9, S1; narrows F-00-5).
- **Requirements (draft, for Phase C):**
  1. At blind close, after the first count, a **second employee** (any job role, but a different employee from the closer) enters their PIN and their own count.
  2. Both counts are stored against the drawer session. If they differ, the system shows the difference. The owner has not said whether a mismatch should block; a warning only is the default until the owner decides.
  3. **Not** required at count-in (D2 says close only).
  4. Same-person check is enforced on the server, not only in the UI.
- **Status: BUILT (Phase 2.2, #1545).** Requirement 1: the register close is two steps and the back-office close form has a **Second count (required)** block; any active employee, not the closer. Requirement 2: both counts are stored (migration 0314, `drawer_sessions.second_counted_by / second_count_minor / second_counted_at`, plus `drawer_counts` rows `close` and `second`); a difference is a **warning only**, shown on the register, the back-office banner, the Reconcile card and the till history; over / short still uses the closer's count. Requirement 3: count-in is unchanged. Requirement 4: `checkSecondCounter` on the server in both paths, plus the DB check `drawer_sessions_second_not_closer`. Owner action: rebuild and reinstall the iPad register app (it bundles the same register screen); until then an old build cannot close and the browser register or back office must be used. SOP-01 v1.6, SOP-03 v1.3.
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
- **Status: BUILT (Fix Phase 2.7b, G-02, #1552; plan row 2.7: *"Master till items: denomination log, …"*; owner D3).** (1) No little-safe balance or target (D3): only exchanges are stored. (2) Each exchange stores who (the PIN's employee, checked on the server with lockout), when, the big bills **OUT** of the master till and the small bills and coin **IN** from the little safe by denomination, and the value; the two sides must be equal on screen, on the server (`validateExchange`, `little-safe-core.ts` L89) and in the database (`little_safe_exchanges_sides_equal`); rows are append-only (migration `0317_little_safe_exchanges.sql`). (3) Managers see the log for any days, the printable master till sheet lists the day's exchanges, and the CSV / Excel export has an **Exchanges** sheet (`exchangesSheet`, `master-till-core.ts` L363). (4) The register **Change swap** screen takes the bills both ways (Q-02-1 / D14: the change comes from the master till), each side equal to the swap amount (`checkSwapDenoms`, `little-safe-core.ts` L125), stored on `safe_swaps.in_denoms` / `out_denoms`. (5) The **Little safe exchanges** log sits on the Store safe page next to **Recent change swaps** (`safe/page.tsx` L467–476). Tests: `fix-p2-7b-little-safe.test.ts` (38) and self-tests (little-safe 30, master-till 42); mutations in SOP-02 Appendix A. **Owner actions:** run migration 0317; rebuild and reinstall the iPad register app (until then the iPad swaps are value only, form 8.3). SOP-02 v1.7, SOP-01 v1.8.

## G-03 · $5 over/short admin warnings screen

- **Owner:** *"Q6- $5. It should be an admin only screen placed in the most logical place to put it for me to interact with. Just warnings for now. Who, when, how much, their reason for why it's over/ under (should be required to be input for over/ under)."* (D7).
- **Today:** no threshold, no warnings screen and no reason field (F-01-11; `actions.ts` L109–141; no `over_short_reason` anywhere in the code). Accurate over/short also depends on F-01-3 (expected shows $0.00) and F-01-4 (hand-typed cash sales). Those must be fixed first or the warnings will be wrong.
- **Requirements (draft):**
  1. Threshold **$5.00** (500 cents). An over or short of more than $5 raises a **warning**. Warnings only: nothing is blocked.
  2. A **reason is required only when the over/short is more than $5.00** (owner decision **D21**, slice SOP-04: *"Q-03-1- only over $5"*). At $5.00 or less the amount is recorded, and a reason is optional.
  3. An **admin-only** screen showing who, when, how much (over or short) and the reason. Proposed location: under Registers, next to reconcile (the owner will confirm the "most logical place").
- **Interim:** SOP-01 §4.30 and form 8.5. The manager writes who / when / how much / reason and hands it to the owner.
- **SOP-02 update (2026-10-27):** master till counts have no threshold or reason either (F-02-6). D7 covers them (**D16**), with a reason only over $5 (**D21**). Interim: SOP-02 §4.8 and its form 8.5. The same warnings screen should list master till variances, with the count window and **Counted by**.
- **Status: BUILT (Phase 2.3, #1546).** All three requirements are built as drafted. (1) `OVER_SHORT_WARN_MINOR = 500`, more than $5.00 is a warning, nothing blocked (`over-short-warning-core.ts` L23–29). (2) Reason required only over $5.00 (D21), checked on the server against its own figure for a drawer (`store.ts` L360) and for a master till count (`safe-store.ts` L122); saved in `drawer_sessions.over_short_reason` / `safe_counts.variance_reason`. (3) Admin-only screen **Employee → Over / Short Warnings** (`/admin/registers/over-short`; permission `registers.warnings` = owner, admin) next to Register Activity, with a button on Register Activity. It lists who counted, who signed off, when, how much, the reason, and links to the till summary or the safe page; 7/30/90/365-day ranges; printable. Master till **Counted by** is now required (F-02-4 part). **Owner action:** apply migration **0315** (until then the reason is still required and audited, but not stored on the row, and the screen says so).

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
- **Status: BUILT (Phase 2.6a, #1549; owner message 4: *"deposit bag screen"*).** `/admin/registers/deposit-bags`. Requirement 1: bag #, business day, drawers in the bag, night amount and who, morning amount and who (a different person, refused by the server and by 0316), sealed at/by, banked on/by (migration 0316 columns). 2: the lifecycle runs `available → undeclared` (night) `→ counted` (recount) `→ deposited` (seal); a sealed bag is locked by the 0316 trigger and the staff write policy is gone (F-03-9). 3: the night/morning difference is shown and both kept; a reason only over $5.00 (D21). 4: the seal posts through `postSealForBag` (see G-14). 5: the $10k shape note at seal and bank run (F-03-10). 6: **D27 honoured** — `blockCloseForUndeclaredBags` (the text above is the pre-2.6 state) was replaced by `undeclaredBagWarning`, a gold warning on Register Activity that blocks nothing. 6a: night = one person (D24), recount by a different employee, anyone seals (D25), only the owner records the bank run (`requireBooksAccess`, D25), the bag # is the pre-printed number (D26), unsealed overnight (D23). 7: the bag log prints with a signature line and downloads CSV. Tests: `fix-p2-6-deposit-bags.test.ts` (31), mutations 32/32. SOP-03 v1.6.

## G-05 · Per-shift / per-cashier report

- **Owner (original request):** "shift close reports" and day close.
- **Today:** the day report is per register, not per shift or cashier (F-01-10; day-report L58/104/119).
- **Interim:** SOP-01 §4.27 step 9. Print an X report before a close when the register has more than one drawer that day, and keep close slip 8.2 per drawer.
- **Status: PARTLY BUILT (Phase 2.1; owner message 4: *"per-drawer figure"*).** Built: each drawer's cash figure (sales count, gross, rounding, employee tab, cash sales, refunds paid from the drawer, drops, expected, over/short) is built by the server from the sales that carry the drawer's id and the refunds tied to it (migration 0313), shown on the Reconcile card and used by reconcile (no typed figure). The till summary prints the stored cash sales and refunds. Untied refunds block reconcile until a manager ties them. The X report split (SOP-01 §4.27 step 9) is no longer needed. **Still OPEN:** a printable per-cashier shift summary (sales, voids, no-sales, discounts, adjustments by employee); the X/Z day report stays per register.
- **Status: BUILT (Phase 2.1b, #1556; owner message 6: *"please completely finish G-05 (2.1), the per cashier print out"*).** The *"Still OPEN"* sentence above (*"a printable per-cashier shift summary (sales, voids, no-sales, discounts, adjustments by employee)"*) is superseded. Each part as worded: **sales** (count, units, gross, pre-tax, tax, cash, tab, other tender, rounding, medical, average), **voids** and returns (filed against the cashier who rang the sale, on the refund day; untraceable online refunds listed apart and given to nobody), **no-sales** (each with reason and approver), **discounts** (deals and sale prices, manager overrides, loyalty, special programs by kind, medical exempt; parts add up to the total), **adjustments by employee** (lines removed, quantities lowered, carts cancelled, value). Printable with a sign-off line, one cashier per page, CSV (409 while incomplete). `/admin/registers/cashiers`; `cashier-report-core.ts` L297, `cashier-report-store.ts` L57; tests `fix-p2-1b-cashier-report.test.ts`. The X/Z day report stays per register. SOP-01 v1.9 §4.35.

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
- **Today:** the page checks the total only and shows **Balanced** for any $1,000.00 mix. The denominations are stored but not shown (F-02-3; `safe-core.ts` L86–118; `safe/page.tsx` L203–244).
- **Requirements (draft):**
  1. Store the standard mix as one constant or setting (it already exists as `SPECIMEN_MASTER_COUNTS`, `register-cash-specimen-core.ts` L43–46; rule 25: one source).
  2. The count grid shows **Standard** and **Diff** per denomination, live.
  3. The result separates **total variance** from **mix off standard** (for example "Balanced · mix off: +10 × $20, −20 × $10").
  4. **Recent counts** can show the denominations of any count.
  5. The EOD safe section shows "mix on standard: yes/no".
- **Interim:** SOP-02 §4.9, form 8.1.
- **Status: BUILT (Phase 2.7a, #1551; owner message 4: *"mix standard"*).** All five requirements as drafted. (1) `MASTER_TILL_STANDARD` (`safe-core.ts` L42) is the one source; the specimen reads it. (2) **Standard** and **Diff** per box, live (`CountGrid.tsx` L89, L99). (3) The total and the mix are separate: *"Balanced · mix off: +10 × $20, −20 × $10"* (`countResultWords`, `master-till-core.ts` L101; banner `mixSentence` L112). (4) Count history: a **Mix** column whose details show every denomination (`safe/page.tsx` L346, L382), plus the printable sheet. (5) EOD *"mix on standard: yes/no"* (`eod/page.tsx` L59–62). Tests: `fix-p2-7a-master-till.test.ts` (30), self-tests 38+, mutations 38/38. SOP-02 v1.6.

## G-09 · Master till sheet print / export

- **Owner (original request):** *"I want to make sure the master till spreadsheet is built … This should be exportable and printable."*
- **Today:** no Print button and no export on `/admin/registers/safe`. 30-row cap, no date filter (F-00-8, F-02-13).
- **Requirements (draft):**
  1. A printable daily sheet (AM + PM + extras, with denominations, standard, diff, counter, notes, swaps, exchanges) in the same style as the EOD print.
  2. CSV/XLSX export by date range (precedents: `inventory/cycle-counts/[id]/export/route.ts`, `reports/compliance/export/route.ts`; `exceljs` is already a dependency).
  3. A date picker for history.
- **Interim:** SOP-02 §4.18.
- **Status: BUILT (Phase 2.7a, #1551; owner message 4: *"printable sheet"*).** (1) `/admin/registers/safe/sheet?day=` prints one day: AM, PM and Extra counts by denomination against the **Standard (D11)** column with Diff, Total / Over-short / Mix / Counted by rows, reasons and notes, the day's swaps with a total, and signature lines (`safe/sheet/page.tsx`). **Exchanges:** the sheet says *"Not recorded in the app yet (gap G-02). Attach paper form 8.2"* until G-02 is built (superseded in Phase 2.7b, #1552: the sheet now lists the day's exchanges, `safe/sheet/page.tsx` L326–332). (2) CSV / Excel by date range (`safe/export/route.ts`; `safeSheetWorkbook`, `master-till-core.ts` L277); a failed read is refused, never partial. (3) **From** / **To** on Count history (no 30-row cap; read in pages). Manager-only (`inventory.manage`). SOP-02 v1.6 §4.16, §4.18.

## G-10 · Manager Till float and register float setting

- **CLOSED in slice SOP-03 (D19).** Owner: *"And I was wrong, it should be 300 in it."* The Manager Till is seeded at $300.00 (`0038` L184), which matches. Requirement 1 below is cancelled. Requirement 2 (an owner-only float setting) is kept as a nice-to-have idea, not an owner request. Requirement 4 (the `drawer-posting-service.ts` L191–192 comment) stays open under F-02-9. The text below is history.

- **Owner (D10):** all three tills hold $167.50.
- **Today:** Manager Till seeded at $300.00 and never corrected (`0038` L184; `0077` L40–46). No screen edits `default_float_minor`. The register app does not compare count-in to any standard (F-01-13).
- **Requirements (draft):**
  1. Set the Manager Till `default_float_minor` to 16750 (migration; idempotent, like 0077).
  2. Optionally, an owner-only setting for each register's float, audited.
  3. With F-01-13: warn at count-in when the count is not the standard float.
  4. Fix the `drawer-posting-service.ts` L191–192 comment.
- **Interim:** SOP-02 §4.14.

## G-11 · Supply-run screen (BUILT, Phase 2.7c; D17)

- **Owner (D17, slice SOP-03):** *"Q-02-4- id like the supply run screen built."* The decision below is answered: **build**, using the three-part design (cash-out, settle, open-advances list). Queued for the build phase per charter C5.

- **Owner policy (books-99):** *"I don't want to use the master till any more for petty cash."*
- **Today:** builders done, no screen (F-02-11).
- **Decision needed (Q-02-4):** if supply runs should never happen, close this gap as "not needed" and keep form 8.4 for emergencies. If they can happen, build: a cash-out record (who, amount, approver PIN) → `buildSupplyAdvanceJournal`; a settle record (receipt amount, change, expense account) → `buildSupplySettleJournal`; an open-advances list for the owner.
- **Interim:** SOP-02 §4.13, form 8.4.
- **Status: BUILT (Fix Phase 2.7c, G-11, #1554; owner D17: *"Q-02-4- id like the supply run screen built"*; plan row 2.7 *"supply run"*).** The three parts as designed above: (1) **cash out** on `/admin/registers/supply-runs`: who (taker PIN), amount, why not the shop card, approver PIN (manager or lead, not the taker) → `buildSupplyAdvanceJournal` via `postAdvanceForRun`; (2) **settle**: receipt amount, change, expense account (six 280E chart accounts), receiver PIN (not the taker), receipt + change = amount → `buildSupplySettleJournal` via `postSettleForRun`, with the expense line's cost class set (the ledger refuses an unclassified expense, 0172); (3) **open-advances list**: open runs, total out with employees, oldest open, entries not posted, on the screen, a count on the Register Activity button and a notice on the Store safe page. Printable log with an owner sign line. Every step audited (`supply_run.cash_out`, `supply_run.cash_out_refused`, `supply_run.settled`, `supply_run.post_retried`). Migration 0318 (owner action). Form 8.4 is now the paper backup. Tests: `fix-p2-7c-supply-runs.test.ts` (41), self-tests 45, mutations 44/44.

## G-12 · Post cash drops to the books

- **Today:** drops are recorded on the drawer session but never posted. 10110 keeps the dropped amount; 10100 is short by it (F-02-1, S1, proven by running `buildTillCloseJournal`).
- **Requirements (draft):**
  1. Either post each drop (debit 10100, credit 10110, source ref `till-drop:<dropId>`, idempotent), or have the close relieve 10110 by `counted − float + drops` and debit 10100 the same.
  2. Add a census row for the drop event.
  3. Add a self-test asserting the **net 10110 movement** for a dropped shift equals −(cash sales − over/short). That is the assertion missing today.
- **Interim:** none needed for staff (SOP-02 §4.12 note).
- **Status: BUILT (Phase 2.4, #1547).** Requirement 1 built as the second option: the close relieves 10110 by `counted − float + drops` (less over/short) and debits 10100 the same (`register-cash-journal-core.ts` L301, L314–321, L329). Requirement 2: no separate drop event exists to add, because drops are booked on the existing close row; the census row `cash_and_banking.till_close_to_safe` (`ledger-census-data.ts`) now names the drops in its event and evidence. Requirement 3 built: the self-test asserts net 10110 for a dropped shift is zero (the sales debited it by the cash sales, the close credits the same), with the shortage on 50920 (L898–939; `register-cash.test.ts`). Entries posted before the fix are not re-posted.

---

## Not gaps (decisions with no build)

- **D1:** no SOP acknowledgment gate. Nothing to build.
- **D5 / D6:** SOP-12 (Digital Assets) and the new SOP-21 (SEO) are documents, scheduled in `02-SOP-CATALOG-AND-ROADMAP.md`.
- **D8:** keep employee `job_role` and user `StaffRole` separate. This is the current design; SOP-01 §2 and SOP-08 explain it.
- **D12:** a page for the two daily master till counts. **Already built** (`/admin/registers/safe`, AM / PM / Extra). SOP-02 §4.3–4.7 documents it. Its weaknesses are findings F-02-3/4/5, not a missing page.
- **D3 (little-safe balance):** no balance or target for the little safe. Nothing to build beyond G-02's log.

## G-13 · Any employee records the master till count

- **Owner (D15, slice SOP-03):** *"Q02-2- anyone can count and record the master count."*
- **Today:** the Store safe page and its action need `inventory.manage` (owner/admin/manager) (`safe/page.tsx` L50, `safe/actions.ts` L41, `roles.ts` L107). Staff logins see the **Safe** button but are refused (F-02-10).
- **Requirements (draft):**
  1. Let any active employee record a count. Options: (a) open the page to the `staff` role (e.g. `orders.manage`) for the count form only, keeping history and settings manager-only; or (b) a register-side "Master till count" screen that takes the counter's **employee PIN**, which also fixes F-02-4 (verified counter).
  2. Keep D8: back-office permission uses the login's StaffRole; the counter identity uses the employee.
  3. Keep the audit: link the audit row to the `safe_counts` row (F-02-4).
- **Interim:** SOP-02 §4.5: a manager login enters the count and picks the counter.
- **Status: BUILT (Phase 2.7a, #1551; owner message 4: *"any-employee count"*).** Requirement 1, option (a) plus the PIN of option (b): the page and action need `orders.manage` (includes `staff`; `safe/page.tsx` L93, `safe/actions.ts` L71), history / sheet / export stay `inventory.manage`; the counter types their **employee PIN** (`safe/actions.ts` L52–66, server-checked against active employees, lockout scope `backoffice-safe-count`). (2) D8 kept: the login's StaffRole gates the page, the PIN names the employee. (3) The audit row links the count (`entityId`) and carries `counter_verified: "pin"`. F-02-4 and F-02-10 (safe page) FIXED. SOP-02 v1.6 §2, §4.5.

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
- **Status: PARTLY BUILT (Phase 2.5, #1548; owner message 4: *"deposit-to-bank books"*).** Requirement 2 built: an owner-only **Clear against bags** button per money-in line on the **Main operating** account (60 days) on `/admin/books/bank`, gated by `requireBooksAccess()` on the page and again in `clearBankDepositAction`, audited as `books.bank_deposit.cleared`, idempotent by `deposit-clear:<transaction id>`; other account roles, unreadable lines and failed reads are refused or shown as failures (rule 46). Requirement 3 built: `cash_deposit_to_bank` evidence corrected; `seal_deposit_bag` kept MISSING. Requirement 4 built: panel text and the file comments named in F-03-1. Requirement 5 was met first (G-12, Phase 2.4). **Still OPEN → Phase 2.6:** requirement 1, the seal poster, which comes with the G-04 bag screen. Until then the button refuses every deposit with *"Nothing is sitting in Undeposited Funds…"*, which is correct: the books never saw the cash sealed. SOP-03 v1.5.
- **Status: BUILT (Phase 2.6a, #1549).** Requirement 1 built: the bag screen's seal calls `src/lib/accounting/seal-bag-posting-service.ts#postSealForBag`, which re-reads the bag, refuses one not sealed, calls `buildSealBagJournal` dated on the bag's business day and `submitJournal` with autoPost under `seal-bag:<bag id>` (idempotent), then records `seal_journal_id` once. A failed post leaves the bag sealed and shows NOT POSTED with a **Post to the books** retry. Census `seal_deposit_bag`: poster named, reachable PRESENT, idempotent PRESENT (`ledger-census-data.ts`); the census now reads 24 of 40 events unreachable. The Phase 2.5 bank door now has sealed bags to clear. SOP-03 v1.6.

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
- **Status: BUILT (Phase 2.6b, #1550; owner message 4: *"… and end-of-day sheet"*).** `/admin/registers/eod`. Requirement 1: **Deposit: what goes in the bag** per till and **Expected deposit** (`eod/page.tsx` L176–222). 2: the day's bag by denomination, night and morning columns, the night figure blind until the recount (L256–302; `eod-sheet-core.ts` L226–227), and two signature lines, night closer and a different morning employee (L464–470). 3: **Cash check (refunds taken off)** from `readDayRefunds`, split drawer / safe (L212–254; `splitRefunds` L119). 4: date picker; a bad day is an error (`parseBusinessDay`; L21–33, L70–82). 5: CSV / Excel export (`eod/export/route.ts`; six sheets, `eodSheetWorkbook` L299). 6: every failed read is listed under **⚠ This report may be incomplete. Do not file it.** and export is refused (`eod-store.ts` L124–222). Tests: `fix-p2-6b-eod-sheet.test.ts` (25) and 28 self-tests; mutations 40/40. SOP-03 v1.7.

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
- **Status: BUILT (Phase 3.1, #1558; owner message 6: *"please begin work on phase 3, receiving: accept "18 of 20""*).** Each requirement:
  1. **Count short** on the line: **Counted at the dock (manifest: N)** and a reason for the rest (the dock reasons less Overage; **Other** needs text) (`ManifestLotDisposition.tsx` L71–141; `intake-count-core.ts` L50–72). Stored as `received_qty` = counted, `shipped_qty` = manifest, `short_reason_code` / `short_reason`, `counted_by` / `counted_at` (migration `0319_intake_counted_short.sql`, check `received_qty < shipped_qty`; rollback file shipped).
  2. Finalize activates at the count: the `receive` adjustment is +counted with the note *"Accepted from vendor manifest intake at the dock count: 18 of 20 shipped (Fix Phase 3.1)."* (`intake-store.ts` L1808; `intake-count-core.ts` L255–258).
  3. Every reader of `received_qty` follows: InventoryTransfer Quantity (`ccrs-transfer-core.ts` rule 3; `ccrs-batch.ts` L312), Inventory.csv, the goods receipt, the vendor bill (`vendor-bill-service.ts` L237), the PO and the sample count. The vendor Updates their CCRS manifest to the count (SOP-04 §4.11 step 5).
  4. The timeline: the count event names shipped / counted / refused and the reason; Finalize adds *"Received short: … 18 of 20 (2 refused: …)."*; a short count makes the delivery partial, so the why-partial note is required (`statusWithShortLines`, used by the pre-flight, the outcome and the button plan, `finalize-label-core.ts` L85).
  5. Tests (`fix-p3-1-partial-receive`, 42): 18 of 20 end to end, overage refused, 0 counted = the line refused, equal = cleared, finalized line refused, a racing save refused, 0319 missing refused with nothing changed, refusal puts the manifest quantity back (line and whole manifest), the count read failing refuses Finalize. Self-tests `intake-count-core` 36. Mutation probe `scripts/compliance/mutate-fix-p3-1.py`.
  6. `setLotDockCountAction` requires `inventory.manage` (`intake/actions.ts` L623–640).
- **Was (interim, superseded):** *"SOP-04 §4.11: refuse the whole short line; vendor re-sends"*. It now applies only until migration 0319 is applied (the button is hidden until then).

## G-17 · Failed-email visibility in Receiving

- **Today:** `inbound_email_log` records `parse_failed` / `no_manifest`, but no screen shows them (`inbound-store.ts` L862–884; panel removed in 7cb4702c) (F-04-4).
- **Requirements (draft):**
  1. A "Needs attention" strip on the Incoming (email) tab listing failed or no-manifest emails from the last 30 days, with sender, subject, received time and the archived attachments.
  2. A "Resolved (imported by hand / not a manifest)" action with an audit row.
  3. A count badge on the Receiving status cards.
- **Owner (message 7):** *"In addition to a notice when an email fails, please add a refetch button, or some intelligent way to manually ask the fetcher to look again … I need a way to ask the system to grab the ones it missed or failed to get. Make it enterprise grade … I want this table to receive every manifest, no exceptions."*
- **Status: BUILT (Phase 3.2a, #1559).** Each requirement, and what was added:
  1. **Needs attention** on the Incoming (email) tab (`InboundAttentionPanel.tsx`): every intake email from the last **90** days (wider than the draft's 30) with no manifest and not Resolved, with sender, subject, received time, a badge (Could not read / Fetch failed / Stuck / No manifest found), one sentence of advice and **What the fetch saw**. The archived attachments stay in the Docs column of the delivery once it stages.
  2. **Resolved** with a reason (handled by hand, not a manifest, vendor re-sent, duplicate, pulled in with Find, other + note), compare-and-set, audit row `inbound_email.resolve` (`resolveInboundEmail`, `inbound-reconcile-store.ts` L403).
  3. A red count line on every Receiving tab linking to the panel (`intake/page.tsx` L402–408) rather than a status card (the cards count manifests; these are emails with no manifest).
  4. (Owner message 7) **Try again**: refetch from the recorded source (Resend id or Gmail id), compare-and-set so one press wins, the same row completed (L318). **Find an email**: Gmail search over vendor_intake@ (Spam and Trash included) that pulls in each match not on the table and refetches a match that failed (L597). **Check the mailbox now** runs the 15-minute check at once.
  5. (Professional practice: dead-letter queue + reconciliation against the source of truth) the 15-minute cron `/api/cron/inbound-reconcile` compares the mailbox with the table and pulls in what the webhook missed, claimed by delivery key so it never stages twice (AGENTS rule 12); automatic retries of temporary failures with backoff (5 min / 30 min / 2 h / 6 h); one claimed alert per email needing a person and one when the check itself fails for an hour; a heartbeat and a health line.
  6. Manager-only (`inventory.manage`) on every action, each audited.
  Migration `0320_inbound_email_reconcile.sql` (manual; rollback shipped). Tests `fix-p3-2a-inbound-reconcile` (31), self-tests 111, mutation probe `scripts/compliance/mutate-fix-p3-2a.py`.
- **Was (interim, superseded):** *"SOP-04 §4.3 step 4"*, the daily mailbox-vs-list comparison logged on form 8.1.

### Fix Phase 3.2b (F-04-11, F-04-3): hardening on the receiving screen (no new gap number)

- **Owner (owner message 7: *"Please proceed with the remaining receiving list … If there are other things you feel as the expert you are, add in these things as you go. Add value if you can."*)**. Two findings from the receiving list had no gap row; both are hardening of the screen built under R31.
- **Status: BUILT (Phase 3.2b, #1560).**
  1. **F-04-11 (FIXED).** A line that fails to save at staging is a red timeline event naming the line, a banner on the review screen, a sentence on the email row and the batch import result; Finalize is refused until **The missing lines go back with the driver** is ticked; the delivery is then partial and the timeline records it (`intake-staging-core.ts`; `intake-store.ts` L968–987, L1744–1756, L1998; `[id]/page.tsx` L712–735, L1569–1575).
  2. **F-04-3 (control note BUILT).** The sticky bar names lines not marked one by one; the Finalize timeline counts lines accepted with no decision (`finalize-label-core.ts` L128–134; `undecidedFinalizeNote`).
  No migration. Tests `fix-p3-2b-intake-visibility` (26), self-tests `intake-staging-core` 29 (+ `finalize-label-core` 37, `manifest-event-labels-core` 66), mutation probe `scripts/compliance/mutate-fix-p3-2b.py`. SOP-04 v1.7.
- **Was (interim, superseded):** SOP-04 v1.6 §4.6, *"A line on the paper but not on the screen means: do not finalize; tell the manager, who re-imports it with a manual tool (§4.5) or calls the owner."*

### Fix Phase 3.3 (F-04-22, F-04-23): GrowFlow emails read whole, one delivery one row (no new gap number)

- **Owner:** *"also, the growflow manifest that keeps failing, is still failing somehow … in the future, these emails with the manifests and invoices will be sent directly to the vendor_intake@ address rather than me forwarding them … i think it would be worth adding a button to dismiss duplicate manifests that somehow make it to the table. we should have logic in place to prevent this, so it may need hardening."* Hardening of the R31 intake and the G-17 pipeline; no new gap row.
- **Status: BUILT (Phase 3.3, #1561).**
  1. **F-04-22 (FIXED).** A GrowFlow *QA Results* PDF (one table, one row per Child ID with THC/CBD/total) is read as lab results for every line (`coa-bundle-core.ts` `readGrowFlowQaResults`), at staging and by **Re-read COAs**. The GrowFlow invoice is a price donor (`pdf-growflow-invoice-core.ts`). The transfer log no longer reads the UBI as the manifest number (`pdf-transferlog-core.ts` `transferLogManifestNumber`), and the primary PDF no longer depends on attachment order.
  2. **F-04-23 (FIXED).** A second copy of one delivery is stopped at staging by sibling evidence (same vendor and the same invoice #, or the same vendor and the same lots) as well as by number (`manifest-sibling-core.ts`; `intake-store.ts` `findStagingSibling`). One already on the table is offered to **Dismiss duplicate** as a sibling; migration `0321_inbound_sibling_dismiss.sql` lets the dismiss function accept it. Label text such as "Manifest ID" is never taken as the vendor.
  3. (Above and beyond) The Vercel build no longer logs `[enrichment-identity] identity read failed: TypeError: fetch failed` per page: identity reads are skipped during `NEXT_PHASE=phase-production-build`, and network failures at runtime warn once a minute.
  Migration `0321_inbound_sibling_dismiss.sql` (manual; rollback shipped). Tests `fix-p3-3-growflow-intake` (37), self-tests `pdf-growflow-invoice-core` 11, `manifest-sibling-core` 17, mutation probe `scripts/compliance/mutate-fix-p3-3.py`. SOP-04 v1.8.
- **Was (interim, superseded):** SOP-04 v1.7 §4.4, *"duplicate (the same manifest # and vendor is already live, so it is not staged again)"*.

### Fix Phase 3.5 (F-04-26): Receiving reads only vendor_intake@ mail (no new gap number)

- **Owner:** *"It should only target vendor_intake@ and none of my other @greenwaymarijuana.com addresses. Right now it is trying to fetch emails from any of them."*
- **Status: BUILT (Phase 3.5, #1565).** The Gmail search names vendor_intake@ (To, Cc, Delivered-To). Each message is checked against what the sender wrote: To/Cc vendor_intake@, or a Bcc to it with no other store address on To/Cc. Anything else is skipped (counted in the run banner), and on Try again it is closed as ignored. The mailbox setting can only name vendor_intake. No migration. Tests: `fix-p3-2a-inbound-reconcile` section 2a; self-test `inbound-reconcile-core` 126. SOP-04 v1.10.

### Fix Phase 3.4 (F-04-24, F-04-25): invoice credits, invoice amount, re-read everything, vendor name, closable banners (no new gap number)

- **Owner:** *"this new manifest has a credit amount on it, and the system did not see it or did and disregarded it … i want the invoice amount to be shown on the receiving table … i want the system to keep trying to find the name of the vendor for that manifest … no exceptions … i need a way to add a credit or discount to the invoice before paying for it in the vendor payments page. finally, i want to be able to dismiss the warnings and other banners at the top of the page. the emails that did not make a manifest section should be collapsed when landing on the page."*
- **Status: BUILT (Phase 3.4, #1562).**
  1. **F-04-24 (FIXED).** Credits read off the invoice (`invoice-adjustments-core.ts`), stored on the delivery (migration 0322), subtracted from owed (`vendor-payables-store.ts`) and posted as a 60900 trade-discount line (`vendor-bill-service.ts`); **Invoice amount** on Receiving; **Add a credit or discount to an invoice** on Vendor payments; re-read reads every document (costs, invoice #, credits, vendor); label vendors repaired at staging, re-read and page load.
  2. **F-04-25 (FIXED).** Banners have **×**; Needs attention starts closed.
  Migration `0322_invoice_adjustments.sql` (manual; rollback shipped). Tests `fix-p3-4-invoice-credits`, self-tests `invoice-adjustments-core` 25, `manifest-sibling-core` 21. SOP-04 v1.9.
- **Was (interim, superseded):** SOP-04 v1.8 §4.15 *"Re-read COAs from this delivery's documents"* (COAs only).

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

## G-19 · Gated and audited lot activation from the lot page (BUILT, Phase 1.1)
- **Built (Phase 1.1, D76):** requirements 1–5 met. Active runs `evaluateLotActivation` through `evaluateLotLifecycleChange` (`lot-lifecycle-core.ts`) in `setLotStatusAction`; every change writes `inventory_lot.status_changed` (who, from, to, when, reason, reference) and every refusal `inventory_lot.status_change_refused`; `check-activation-gate.ts` also catches non-literal and `destroyed` lot status writes and is run by `tests/compliance/fix-p1-1-gated-lot-lifecycle.test.ts` (it had been red on main with three unreviewed `status: "active"` hits, each now reviewed in the script); the Issues "now clear" row points at the gated path; the stale attach text is replaced (F-04-12).

- **Today:** **Lifecycle status** writes any status, including Active, with no `evaluateLotActivation` and no `recordAudit` (`inventory/actions.ts` L142–155; `store.ts` L849–864). The activation grep guard only matches the literal `status: "active"` (F-04-2). The Issues text points staff to this box (`issues-core.ts` L556).
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

## G-22 · Audited, gated lot lifecycle changes (extends G-19) (BUILT, Phase 1.1)
- **Built (Phase 1.1, D76):** requirements 1–6 met. Destroyed removed from the lot page and refused by the core and the store; reason required; Recalled → other limited to the new `inventory.recall.release` permission (owner, admin; D37) with a required clearance reference; **Status history** on the lot page from the audit rows (Pacific time, names; `listLotStatusHistory`); the write is compare-and-set on the checked status; the guard fails the build if `destroyed` is written outside `disposition.ts` completeDestruction. Placing a hold stays open to `inventory.manage` (Q-05a-7 still open).

- **Today:** **Lifecycle status** writes any of the five statuses with no check, no reason and no audit row (`inventory/actions.ts` L142–155 → `store.ts` L849–864). **Destroyed** leaves units on file and drops the lot from the CCRS Inventory file (F-05a-1, **S1**). **Recalled** is placed and lifted by any manager-level login with no record (F-05a-2, **S1**).
- **Requirements (draft):**
  1. Everything in G-19 (the go-live check on Active, an audit row on every change).
  2. **Destroyed removed** from the lot page's status choices. Destruction only through Returns & Destruction (SOP-15), which already sets it correctly (`disposition.ts` L1163–1170).
  3. A **required reason** on every status change, saved in the audit row (who, from, to, when, reason, reference).
  4. **Recalled → any other status** limited to the owner (or a new `inventory.recall.release` permission the owner assigns), with a required clearance reference.
  5. A **Status history** list on the lot page (from the audit rows), shown in Pacific time with names.
  6. A guard (compliance script or test) that no code path writes `destroyed` without a disposition record.
- **Interim:** SOP-05a §4.8–§4.10, form 8.1.

## G-23 · Hardened manual adjustment (BUILT, Phase 1.2)
- **Built (Phase 1.2, D76):** requirements 1–6 met. `evaluateManualAdjustment` (`manual-adjustment-core.ts`) holds the D39 list (no Receive, Destruction, Recall removal; Theft and Seizure with a required incident reference), the CCRS note rule and the zero pre-check; `createAdjustment` uses the strict `applyLotDelta` and deletes the adjustment row on refusal, writes `inventory_lot.adjusted`, and asks for the automatic flip only when removing stock from an Active lot (0129's flip would otherwise restock Sold out → Active without the go-live check); the history shows Pacific time and names; a Schedule destruction link preselects the lot on Returns & Destruction (only Active lots until G-28); the Issues expired-lot text no longer points to Adjust quantity. Owner-only for Theft / Seizure was not decided, so the app leaves them to `inventory.manage` and the SOP routes them to the owner.

- **Today:** read-then-write, no zero floor, no Sold out flip, no audit row (F-05a-3); empty note accepted although CCRS needs one for Other / Employee sample (F-05a-4); Destruction, Recall removal and Receive (add) offered (F-05a-5, F-05a-7); no Theft / Seizure (F-05a-6).
- **Requirements (draft):**
  1. Use the atomic `applyLotDelta` path (GW-012), with a refusal when the result would be below zero, and the same automatic Sold out flip at zero.
  2. A **required note** when the reason maps to CCRS Other, with the same wording CCRS needs; a warning for every reason.
  3. Remove **Destruction**, **Recall removal** and **Receive (add)** from the manual list (owner decision **D39**). Add a **Schedule destruction** link on the lot page that opens Returns & Destruction with this lot chosen (needs G-28).
  4. Add **Theft** and **Seizure** (D39: *"Add theft and seizure."*), with a required incident reference (SOP-20). The CCRS mapping exists (`ccrs-inventory-adjustment-core.ts` L87–90); CCRS needs detail for Theft (`ccrs-preflight-core.ts` L273). Whether they are owner-only is not yet decided; the SOP routes them to the owner.
  5. An audit row per adjustment (`inventory_lot.adjusted`), and the actor's name and Pacific date on the history list (F-05a-13).
  6. Fix the Issues expired-row fix text that points to Adjust quantity (`issues-core.ts` L463).
- **Interim:** SOP-05a §4.6–§4.7, form 8.2.

## G-24 · Expired stock at the register and FEFO lot draw (BUILT, Phase 1.6b; D36, D44)

- **Today:** the register never reads expiry dates; sales draw oldest-created first (`sale-lot-read.ts` L45–53); the Issues tab is the only stop (F-05a-8).
- **Owner decision D36:** *"hard block edibles and liquid edibles, warnings for everything else."* **Owner decision D44:** *"Q-05a-6- yes, same with rso too."*
- **Requirements:**
  1. A completion-gate check on expired lots: **hard block, no override** when the lot's CCRS type is **Solid Edible**, **Liquid Edible**, **Tincture** or **Capsule**, **or** the product's store category is `rso` (or `edible-solid`, `edible-liquid`, `tincture`). RSO is filed in CCRS as *Concentrate for Inhalation* (`fact-extraction-core.ts` L890–894), so the CCRS type alone would miss it (F-05a-20); a **warning** the budtender must acknowledge on every other expired lot, recorded on the sale. The same rule on the menu card (an expired edible lot does not count toward sellable stock).
  2. FEFO lot draw (soonest-expiring Active lot first, then oldest) in `sale-lot-read.ts`, with tests.
  3. The Issues text aligned with the owner's rule (it says *"Expired product may not be sold."* today).
  4. A nightly job that moves expired **edible, liquid edible, tincture, capsule and RSO** Active lots to Quarantine with an audit row.
  5. Tests: one per hard-blocked kind, including an RSO lot whose CCRS type is Concentrate for Inhalation; a warning case for a non-RSO concentrate.
- **Interim:** SOP-05a §4.16 (daily check by type), form 8.3.
- **Built (Phase 1.6b, D76):** requirements 1–5 met; no migration. (1) `completion-gate.ts` L151–188 reads expired Active lots fail-closed (`expired-stock-store.ts` `readExpiredActiveLots`, paged) and refuses with no override when `expiryKindFor` (`expired-stock-core.ts` L121–135) finds the CCRS type Solid Edible, Liquid Edible, Tincture or Capsule (and the 2021 spellings), the store category edible-solid, edible-liquid, tincture, capsule or `rso` (direct, or through `resolveLedgerCategory`, where *RSO* is `rso`), the order line category, or *RSO* / *Rick Simpson* in the name. The hold is on the whole product, because an order line carries no lot; quarantining the expired lot releases fresh stock. Every other expired lot needs **I told the customer**: the back office is refused until it is ticked (`orders/actions.ts`, `orders/[id]/page.tsx` L197–201); the register's payment screen will not complete without it (`SaleFlow.tsx` L5986–6012) and sends `expiredWarningAck`; either way a note is written to the order history. The register menu leaves out hard-blocked products and carries `expiredSince` on the rest (`api/pos/menu/route.ts` L133, L329–331, L373). (2) FEFO: `sale-lot-read.ts` L65. (3) Issues text: `issues-core.ts` L390–391, L465–467. (4) Nightly job `api/cron/expired-quarantine` at `20 11 * * *` UTC (4:20 AM PDT / 3:20 AM PST), CRON_SECRET-guarded, compare-and-set on Active, audit `inventory_lot.expired_quarantined`. (5) `tests/compliance/fix-p1-6b-expired-stock.test.ts` (one case per hard-blocked kind, RSO as Concentrate for Inhalation by category and by name, non-RSO concentrate warns); 37 core self-tests; guard step 9 (`check-activation-gate.ts`). SOP-05a v1.8. F-05a-8, F-05a-20 FIXED.

## G-25 · Recall plan, recall log and recall reaching the website (BUILT, Phase 1.6c)

- **Built (Phase 1.6c, under the D76-approved plan row 1.6; the requirements below were still a draft and were built as written):** req 1 **Settings → Recall plan** (`settings/recall-plan/page.tsx`, `saveRecallPlanAction` L17, `settings.manage`, audited with before and after) holds the coordinator (the admin, D37), the owner, the LCB officer's contact, sections A–D (form 8.4 wording to start) and the approval and annual-review dates; Issues warns when it is incomplete, when the review is overdue, and 30 days before (`recallPlanIssues`, `recall-event-core.ts` L418). Req 2 **Inventory → Recalls** (`recalls/page.tsx`, `recalls/[id]/page.tsx`): the notice; **Add and set Recalled** runs `evaluateLotLifecycleChange` then `updateLotStatus` (the G-22 path) and records the on-hand when added; the LCB notification (officer, method, Pacific time; owner or admin; once; not future, not before the notice); weekly rows (held, returned by customers, returned to vendor, destroyed, sold before the hold, reported on); close with an outcome (Released needs the clearance reference and no lot still Recalled; the others need no Recalled lot with units). Tables `recall_events`, `recall_event_lots`, `recall_event_weekly` with RLS (migration 0311). Every step and refusal audited. Req 3 the public menu leaves out held products and held sizes (advisory), online order pricing refuses them and refuses when the status cannot be read (fail-closed), and open pickup orders holding one are a blocking Issue with links. Req 4 Issues: **Recall: LCB not yet notified** (blocking), **Market withdrawal: LCB notice due in N h** (warning; blocking at 12 h or less) and **OVERDUE** (blocking), and the weekly report due after 7 days. G-42 req 6 completed with it (below). Tests: `tests/compliance/fix-p1-6c-recall.test.ts`, self-test `recall-event-core`. **Owner action:** apply migration 0311 (after 0310) and fill in Settings → Recall plan.

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

## G-27 · No typed cannabis unit cost (BUILT, Phase 0.5, D38)
- **Built (Phase 0.5, D76):** requirements 1–3 met. Bulk fill offers Expiration date and POS product key only; the planner, the server action and the store each refuse a cost. A source-scanning compliance test fails if any `inventory_lots` write carrying a unit cost appears outside manifest intake (`intake-store.ts`), the manifest receipt (`receipt-service.ts`) or the one-time Cultivera import (`import-service.ts`), and none may be in `src/app/`. The unknown-cost Issues row reads "Cost missing — correct from the manifest" with no Bulk fill link. Non-cannabis cost keeps its own owner/admin path (`inventory.cost.fill`).

- **Owner decision D38:** *"absolutely not. That's illegal. Cost comes from the state CCRS manifest created by the vendor."*
- **Today:** cannabis cost is read from the manifest at receiving (`intake-parser.ts` L415–420) and locked on the lot page (`lot-edit-core.ts` L33–45, L38), but **Bulk fill → Unit cost** can still type it on Cultivera-import lots (`bulk-fill-core.ts` L54; `actions.ts` L904) (F-05a-11, **S1**).
- **Requirements:**
  1. Remove `unit_cost_minor_units` from the Bulk fill field list for cannabis lots (non-cannabis cost keeping its own owner/admin path, `inventory.cost.fill`).
  2. A compliance guard (test or script) that no server action writes a cannabis lot's unit cost except the manifest intake path.
  3. A cannabis lot with no cost shows "cost missing — correct from the manifest" on Issues instead of inviting a typed value.
- **Interim:** SOP-05a §4.20.

## G-28 · Returns & Destruction handles held lots (BUILT, Phase 1.3)
- **Built (Phase 1.3, D76; recall part per D65):** req 1 as amended by D65: the picker lists Active and Quarantine lots with their status, never Recalled (a Recalled lot goes back to the vendor; listing it for a vendor return comes with G-42, Phase 1.5). Req 2 by D65: a Recalled lot is refused at scheduling and completion and is never changed; only an Active lot moves to Quarantine (compare-and-set). Req 3: `destruction_events.previous_lot_status` (migration 0307) and the restore on Cancel, audited before/after. Req 4 was built in Phase 1.2. Req 5: test `fix-p1-3-destruction-held-lots.test.ts` and activation-guard step 5 (every lot-status write in `disposition.ts` is compare-and-set on Active or Quarantine, or Destroyed). Req 6: `inventory.destruction.cancel` (owner only), required reason, a customer-return event never touches the lot. Req 7: a partial completion restores. The restore only ever moves Quarantine → Active, for a lot that was Active (go-live checked) when scheduled, when no other open destruction holds it and nobody changed it since.

- **Owner basis:** D39 (the owner's question: *"Should the destructions page handle marking those fields automatically?"* Answer: yes; it mostly does).
- **Today:** the destruction form lists only Active lots (`disposition/page.tsx` L107, F-05a-17); scheduling writes Quarantine over Recalled, lifting the register hold (`disposition.ts` L968–974, F-05a-18, **S1**); Cancel always sets Active (L1113–1114, F-05a-19).
- **Requirements (draft):**
  1. The lot picker lists **Active, Quarantine and Recalled** lots with their status shown.
  2. Scheduling a **Recalled** lot leaves it **Recalled** (the register hold stays on); only Active lots move to Quarantine.
  3. The destruction event stores the lot's status before scheduling; **Cancel** restores that status, with an audit row.
  4. The lot page gets a **Schedule destruction** link that opens the page with the lot chosen (pairs with G-23).
  5. Tests for all three, plus a guard that no destruction path changes a Recalled lot to anything but Destroyed.
  6. **(SOP-15 extension)** **Cancel** requires a written reason and the owner (or a permission the owner holds); a customer-return destruction cancel never touches the lot status (F-15-9).
  7. **(SOP-15 extension)** After a partial destruction the lot returns to its status before scheduling, not left in Quarantine (F-15-11).
- **Interim:** SOP-05a §4.9 (points 1–3), §4.10 step 9, form 8.4 (C); SOP-15 §4.19–§4.22, form 8.5.

### Fix Phase 6 / Fix E (G-61..G-66; owner message 8, D81–D90): shift end and end-of-day cash

- **Owner:** Q-E-6 *"Block. I don't want to clock out on the register change out step."*; Q-E-7 *"Warn please"*; Q-E-4 *"Please change it to assembled and verified at night, and blind counted in the morning."*; Q-E-5 *"Yes please do this."*; Q-E-10 *"The tip jar is pooled for the morning crew, and pooled for the night crew."*; Q-E-8 *"build this one like the big boys would."*
- **Status: BUILT (Fix Phase 6, #1567).** New `src/lib/registers/shift-end-core.ts` (pure, 46 self-tests). Clock-out guard in `staffing/store.ts` `toggleClock` (the single punch path: register, lock screen, back office, offline replay) via `openDrawersOwnedBy`; the register learns the owned drawers at unlock. Float warning on both count-in paths (`/api/pos/till`, `openDrawerAction`) with `drawer.float_warning`. Crew tip pool on both close paths; `till-core.ts` re-splits on the server. Verify till retired (`verifyTillAction` stub, `till.verify_retired`; `verifyTill()` removed; attention list reconcile only). Night `nightAssembleAction` (`deposit_bag.night_assembled`, `night_denoms` null). Seal warns (`deposit_bag.sealed_unreconciled`). EOD `awaitingReconcile` banner. **No migration.** Test `tests/compliance/fix-p6-shift-end.test.ts`.

### Fix Phase 5 (plan rows 6.1/6.2; G-53/G-54): sign-in link and one-step offboarding

- **Owner:** D70 *"yes, built right, professionally and of enterprise grade standards."*; D71 *"yes."*; books-87 *"I want to create the employee in payroll/ W-4 setup, then I will give them access to the back office if they need access to it."*
- **Status: BUILT (Phase 5, #1566).** New `offboarding-core.ts` (pure, 49 self-tests), `employee-login-link-store.ts` (the only `employees.staff_id` writer, update only, race-guarded), `sign-in-deactivate.ts` (Users guard rails + ban, shared). Employee file: Back-office sign-in card (link/unlink) and the new Terminate box. Users: linked employee per row, "Terminate on their file", Deactivate message names the file. Migration 0324 `employees_staff_id_unique` (refuses to run over duplicate links). Trap test `logins-are-not-employees` now allows exactly that one write site (9 sites, 1 sanctioned). Tests: `fix-p5-people-link-offboarding`. SOP-08 v1.3.

### Fix Phase 4b (G-32 items 7–10): publish fails closed, before/after audits, no price on a cost-unknown lot, Partly saved

- **Owner (D49):** *"Q-05b-5- yes, plan on the group of smaller fixes. blocked until the manifest cost is entered."*
- **Status: BUILT (Phase 4b, #1564).**
  7. **F-05b-10 FIXED.** `menu-version.ts` `getPublishedVersion({ strict: true })` + `diffVersions(…, { strict: true })` (throws on an incomplete read) + `publish-guard-core.ts` `removalCheckFailedCopy`; audit `menu.publish_refused_check_failed`.
  8. **F-05b-11 FIXED.** Website-category and inventory-type update / deactivate / delete audits carry before / after.
  9. **F-05b-12 FIXED (D49, D38).** `COST_UNKNOWN_PRICE_REFUSAL` in `parsePriceCorrection`; `sharedFloorRefusal` refuses while any sharing lot has no cost; Save greyed out on the lot page.
  10. **F-05b-13 FIXED.** `?class_warn=` → **Partly saved.** banner.
  No migration. Test `fix-p4b-g32-items-7-10`; self-tests `price-correction-core`, `lot-size-link-core` (23), `publish-guard-core`. SOP-05b v1.4.
- **Was (interim, superseded):** SOP-05b v1.3 §4.14 (*"it publishes anyway"*), §4.15 (form 8.3 for before/after), §4.19 step 6, §4.21 (*"Nobody … presses Save sell price"* by hand).

### Fix Phase 4 (plan rows 5.1/5.2; G-29/G-30/G-30A/G-32): Other Inventory on the register

- **Owner (D45):** *"Q-05b-1- yes, and any other upgrade, enhancement and such needed to fully utilize non cannabis goods in the system and on the register and on the menu."* · D46 *"Q-05b-2- owner, admin, manager."* · D47 *"Q05b-3- owner and admin."* · D48 *"non cannabis should be allowed to have their cost modified."* · D49 *"Q-05b-5- yes, plan on the group of smaller fixes."*
- **Status: BUILT (Phase 4, #1563).**
  1. **G-29 (F-05b-1, F-05b-15 FIXED).** Register products `nc-<id>` with SKU/UPC scan (cannabis wins a clash); sale decrement in one step with a cost snapshot (`apply_noncannabis_delta`); void restore once (unique order line + reason); counter return restock / write-off (`record_noncannabis_return`, never a CCRS correction; `ccrs-batch.ts` skips `NonCannabis`); Sale.csv excludes these lines with a warning; COGS from the catalog average cost; refund cost-back from the sale snapshot; price drift vs the catalog; **Register sales — last 30 days**; display-only **Also in store** on the shop. Requirements 4 (offline replay uses the same idempotent sync path), 9 (PO draft) and 10 (concierge stock lookup) remain open.
  2. **G-30 (F-05b-6 FIXED).** **Save change** price/cost, owner/admin/manager, reason, $0 refused, optimistic check, audit old → new. Q-05b-6 stays open (Bulk fill not widened).
  3. **G-30A (F-05b-14 FIXED).** `merch.remove` = owner, admin.
  4. **G-32 items 1–6 (F-05b-2, 3, 4, 5, 7, 8 FIXED).** Items 7–10 remain APPROVED.
  Migration `0323_noncannabis_register.sql` (manual; rollback shipped). Test `fix-p4-noncannabis-register`, self-test `nc-pos-catalog-core` 40. SOP-05b v1.3.
- **Was (interim, superseded):** SOP-05b v1.1 §4.4 (Keypad + Monday count), §4.9 (archive and re-create).

## G-29 · Non-cannabis goods fully used: register, menu, books (APPROVED, D45)

- **Owner basis:** the intake form already promises it (*"Has one? Scan it here — it becomes the register code."*, `NonCannabisIntakeForm.tsx` L122–124). D42/D43 ask for inventory management to be finished end to end.
- **Today:** the register reads only `menu_items` and cannabis lots. Non-cannabis is rung on the Keypad as free text, and **On hand** never moves with a sale (F-05b-1, **S1**).
- **Owner decision D45:** *"Q-05b-1- yes, and any other upgrade, enhancement and such needed to fully utilize non cannabis goods in the system and on the register and on the menu."*
- **Requirements:**
  1. Active non-cannabis items are served to the register with SKU, UPC/EAN, name, price and the category (`accessories` or `merch`), taxed at 9.3% with no limit.
  2. A scanned SKU label or manufacturer barcode adds the priced line. An unknown code says so and never falls through to cannabis.
  3. A completed sale decrements `on_hand` atomically, with a ledger row (`sale`) and the order id. A void or return restores it.
  4. Offline sales queue and replay the decrement once.
  5. The Keypad stays for genuinely un-catalogued items, and its lines are listed for the weekly count.
  6. **Cost of goods:** a non-cannabis sale line carries the item's unit cost, and the daily accounting post books it as cost of goods sold. Today keypad lines carry `costMinorUnits: null` (`custom-sale-core.ts` L144) and are skipped when costs are gathered (`sale-posting-service.ts` L360, L369–371), so no COGS posts (F-05b-15).
  7. **Menu:** active non-cannabis items with stock can be listed on the website and register menu under Accessories (and in-store Greenway goods), with price and availability from the catalog, not a separate menu entry. The shop already groups accessories and merch at the bottom of the grid (`InteractiveMenuBrowser.tsx` L1143–1146). On hand reaching zero takes the item off as out of stock.
  8. **Reports:** non-cannabis sales, margin and turns by item in the sales and COGS reports, from the catalog line, not the typed keypad note.
  9. **Reorder:** the **Reorder now** list uses live On hand (after item 3), and can draft a purchase order to the item's vendor.
  10. **Concierge:** the concierge can answer "do we have X, where is it, what does it cost" from the catalog (D42).
  11. Tests: scan → line → tax; decrement / void / return; COGS posted; menu listing follows stock; no cannabis path changed.
- **Interim:** SOP-05b §4.4–§4.5, form 8.1.

## G-30 · Edit a non-cannabis price and cost (APPROVED, D46, D48)

- **Today:** price is set only at draft; cost only while $0.00; a $0.00 price is accepted (F-05b-6).
- **Owner decisions:** D46 *"Q-05b-2- owner, admin, manager."* · D48 *"non cannabis should be allowed to have their cost modified."*
- **Requirements:**
  1. **Change price** and **Change cost** on an active item for **owner, admin and manager**, with a required reason and an audit row old → new. Cost changes are allowed at any value, not only from $0.00. **Open: Q-05b-6**, whether managers may also use the existing **Save cost** (today owner and admin, earlier decision D-R3-1, `roles.ts` L144–149).
  2. Refuse a $0.00 or blank price at draft, at confirm and in the invoice builder (or require an explicit "free item" flag).
  3. Price history on the item. The SKU never changes.
- **Interim:** SOP-05b §4.9 (archive and re-create; owner, admin or manager; form 8.2).

## G-30A · Merch Remove for owner and admin only (APPROVED, D47)

- **Owner decision D47:** *"Q05b-3- owner and admin."*
- **Today:** `removeMerchAction` checks only `inventory.manage`, which includes manager (`merch/actions.ts` L33–34; F-05b-14).
- **Requirements:** a permission such as `merch.remove` = owner, admin; the **Remove...** control hidden for others; the action refuses others; a test.
- **Interim:** SOP-05b §4.11 (managers Hide, never Remove).

## G-31 · Cannabis-line guard for categories (BUILT, Phase 0.4, D48)
- **Built (Phase 0.4, D76):** requirements 1–5 met. `crossesCannabisLine` and friends live in `src/lib/compliance/cannabis-line-core.ts` and are shared by `parseClassificationEdit` (with `cannabisLot: true` from the lot action), `buildReassignPlan` and the type save (`refuseTypeCrossing`). Refused outright both ways, no override; each refusal writes `cannabis_line.refused` with its entry point. Every inventory lot came from a CCRS manifest, so a lot can never take a non-cannabis category or type; a type carried by lots or mapped to cannabis can never be mapped non-cannabis, and a non-cannabis type can never be mapped cannabis. Inventory → Issues shows a blocking `cannabis_on_non_cannabis_category` row. Test `tests/compliance/fix-p0-4-cannabis-line.test.ts`.

- **Today:** the lot override, **Move products** and the inventory-type mapping can each cross into or out of `merch` / `accessories` / `accessory` / `paraphernalia` with no check. This changes tax, limits, scan and floor (F-05b-9, **S1**).
- **Owner decision D48:** *"Q05b-4- refused outright, non cannabis should also be refused outright moving them into a cannabis type."*
- **Requirements:**
  1. One pure check, `crossesCannabisLine(fromCategory, toCategory)`, shared by `parseClassificationEdit`, `buildReassignPlan` and the inventory-type save.
  2. A crossing is **refused outright, in both directions, with no override for anyone.** The refusal message names the rule. A refused attempt is written to the audit log.
  3. A product that came from a CCRS manifest (it has a cannabis lot) can never be moved into a non-cannabis category, and a non-cannabis catalog item can never be given a cannabis category or inventory type.
  4. A daily check lists any menu row whose product has a cannabis lot but a non-cannabis category, on Inventory → Issues.
  5. Tests for all three entry points.
- **Interim:** SOP-05b §4.15–§4.17, form 8.3 (never cross; owner only).

## G-32 · Non-cannabis, publish and price hardening bundle (APPROVED, D45, D49)

- **Owner decision:** *"Q-05b-5- yes, plan on the group of smaller fixes. blocked until the manifest cost is entered."*
- **Today / requirements, one line per finding:**
  1. Confirm and Archive write an audit row; add **Restore** for an archived item (F-05b-2).
  2. Adjustments use one atomic database update with a zero floor (F-05b-3).
  3. Direction is fixed by Reason; **Count correction** and **Other** allow either (F-05b-4).
  4. Recent adjustments shows the actor and Pacific time (F-05b-5).
  5. A failed invoice save removes everything it wrote (one transaction) (F-05b-7).
  6. The invoice audit write is awaited and failure is shown (F-05b-8).
  7. Publish refuses (fails closed) when the removal diff can't be read (F-05b-10).
  8. Category audits carry before / after (F-05b-11).
  9. **Save sell price** on a cost-unknown lot is **refused for everyone until the manifest cost is entered** (D49; F-05b-12, D38). The message says to enter the cost from the CCRS manifest first.
  10. A classification lot-row write failure shows a warning, not "saved" (F-05b-13).
- **Interim:** the store rules in SOP-05b §4.3–§4.9, §4.14, §4.15, §4.19, §4.21.


## G-33 · Owner stage controls for an audit: release to Cycle Counts, send back, cancel (APPROVED, D54, SOP-06)
- **Today:** a new audit is saved as `draft` and no screen moves it on (F-06-1); there is no Cancel (F-06-2) and no way back from review to counting.
- **Owner requirement:** *"I approve the scope and push it to the cycle counts page."* (`cycle-counts/page.tsx` L17–20); *"You approve the scope, and approving it is what pushes the count out to the floor."* (`MICHAEL-books-23.md` L55–59). Audits are owner only (D50).
- **Requirements:**
  1. On a `draft` audit, owner button **Approve scope and send to Cycle Counts** → `scope_approved`, signed (scope_approved_by/at, already in `moveSessionStatus`).
  2. **D54 (enterprise pattern, owner: *"Please do what the pros would do."*):** creating and releasing are separate acts. The owner button is **Release to Cycle Counts** (draft → `scope_approved`, signed). The audit becomes `counting` when the claiming counter records the first lot (D56). Quantities are captured per lot at first count (G-35), not at creation or release (NetSuite *Start* snapshot; Lightspeed per-item QOH).
  3. **Send back to counting** from review (already legal).
  4. **Cancel** with a required reason from draft, scope_approved, counting and review; audited. First use: cancel every held test audit (D59).
  5. Hub "Audits" table links each stage to its next action.
- **Interim:** SOP-06 §4.7 (paper blind count, form 8.2; hand adjustments with reason **Cycle-count correction**).

## G-34 · Counter "I'm done", owner notification in the /admin cockpit, staff-safe links, live progress (APPROVED, D55, SOP-06)
- **Today:** the help says a finished count leaves the page; it doesn't. Staff links on the sheet go to owner-only pages. Progress figures read posting-time totals (F-06-3, F-06-4).
- **Owner requirement:** *"When they finish, it leaves their screen."* (`MICHAEL-books-23.md` L72–76); *"When they finish the count, it should disappear from the cycle counts page and be redirected back to the inventory audit page"* (`audits/page.tsx` L98–101).
- **Owner decision D55:** *"pressing I'm done should sent the cycle count back to the inventory audit page linking back to the one that initiated the count. It should notify me in the main /admin cockpit command center."*
- **Requirements:** a counter **I'm done** (enabled only when nothing is blank) that locks the counts, moves the audit to `review`, removes it from Cycle Counts, and adds a **Needs your attention** item to the /admin cockpit (a new input to `buildAttentionFlags`, `cockpit-core.ts` L138; F-06-16) linking to `/admin/inventory/audits/{id}`; the item clears when the owner approves, sends back or cancels; correct help step 4; hide **Review and finish** and the **Auditing** breadcrumb for non-owners; counted / blank / gross computed live from the lines.
- **Interim:** SOP-06 §4.8 step 4 (tell the owner in person).

## G-35 · Count cutoff: per-lot capture at first count; sales during the count reconciled (APPROVED, D58, D61, SOP-06)
- **Today:** the books quantity freezes at creation and posting applies (count − frozen) to the live shelf, so any sale in between is subtracted twice; the promised warning doesn't exist (F-06-7, **S1**).
- **Owner decisions:** *"The system should be smart enough to know that when they start the count and finish it, the sales in between should be reconciled."* (D58); *"anytime during open hours."* (D61).
- **Design chosen (Lightspeed pattern):** *"Once at least one unit of an item has been counted, the QOH for the item will be recorded."* · *"Sales or added inventory don't change a discrepancy."*
- **Requirements:** store the books quantity on the line **at the moment each lot is first counted** and compute the delta against it (not against the creation freeze); show the owner, per lot, any movement between freeze and count; refuse posting while unexplained movement exists; correct the ISA 501.A5 explainer and the work paper line.
- **Interim:** SOP-06 §4.11 (create right before counting, outside selling hours; never post if anything in scope sold).

## G-36 · Count-sheet integrity, one counter per count, +1 per scan (APPROVED, D56, D60, SOP-06)
- **Today:** re-scans silently become second counts (F-06-5b), second counts are scan-only with no third count (F-06-5), a disagreeing second count does not block approval or posting (F-06-13, **S1**), and line writes have no stage check in code or RLS (F-06-6).
- **Requirements:**
  1. A disagreeing second count is a **blocker** in `readinessOf` and is re-checked in `gateSessionForPosting` (refuse any line with `blocksPosting`).
  2. A scan of an already-counted lot asks "add to this lot / replace / cancel"; it never becomes a second count unless the line was asked for one.
  3. **Per-package counting: each scan adds one** (D60, *"yes."*); typing a total stays for unreadable labels.
  4. Hand entry for second counts; a third count when the second disagrees.
  5. `saveCountLine` / `saveLineReason` refuse unless the stage is `counting` / `review`; matching RLS or trigger on `inventory_audit_lines`; read-only and content_editor cannot write lines.
  6. **One counter per count (D56):** the first employee to open a released count claims it; only they can enter numbers; the owner can reassign. The recount request is done by the same counter before **I'm done**; a different person only by owner-initiated re-count (send back or new audit). Withdraw the sheet text *"Ideally a different person does it"* (F-06-15).
- **Interim:** SOP-06 §2 store rule 4, §4.10 step 4, §4.12, §4.14 owner rule.

## G-37 · Reasons can be completed and corrected before approval; validated; owner decisions enforced (PROPOSED, SOP-06)
- **Today:** the reason form vanishes once saved, so a missing note deadlocks the audit; reasons are free text in the DB; `readyToPost` isn't enforced (F-06-14).
- **Requirements:** edit reason and note until approval, audited old → new; validate against `VARIANCE_REASONS` in the action and with a DB check; posting refuses when `needsOwnerDecision` is not empty.
- **Interim:** SOP-06 §4.15 (form 8.3 first; new audit if saved wrong).

## G-38 · Daily checklists in the app, for every employee, with the full task catalog (APPROVED, D57, SOP-06)
- **Today:** none (F-06-12, F-00-9).
- **Owner requirement:** *"Checklists for daily tasks like cycle counts I initiate via the inventory audit feature."* (catalog SOP-06); *"the cycle counts and daily checklists are for all employees, admin, manger, sales."* (D51).
- **Owner decision D57:** cleaning, organizing, stocking, marketing content (website banners, flyers, newsletters, blog posts, social media posts, in-store content, yard banners), product enrichment, heavy discounts before expiry, plus expert additions. Seed list: SOP-06 forms 8.5–8.8.
- **Requirements:** opening / mid-shift / closing / weekly / monthly checklists seeded from forms 8.5–8.8, owner-editable, each task linking to its SOP section; initials and time per task; a live "counts waiting on Cycle Counts" line; manager sign-off; history kept five years (WAC 314-55-087); visible to `inventory.count` roles.
- **Interim:** SOP-06 forms 8.5–8.7.

## G-39 · Counting housekeeping (APPROVED, D58, D59, SOP-06)
- **Today:** F-06-8, F-06-9, F-06-10, F-06-11.
- **Requirements:** one count schedule used by the planner and the Issues row (D58: daily vendor counts + annual; A/B/C stays the risk ranking); **cancel every legacy session (D59: *"be canceled, we are not live yet. It's all test data."*)**; the Issues fix opens **Plan a count** for the owner and tells others to tell the owner; legacy cycle-count write actions removed or refused (true read-only; Q-06-6); render `buildCountChecklist` on the count sheet (and fix its "add one" step to match G-36); Pacific time on the oversold and older lists and the default audit name; one colour for approved.
- **Interim:** SOP-06 §4.20, §4.22.

## G-40 · Intelligent cycle counts: vendor of the day and other generators (APPROVED, D58, SOP-06)
- **Owner requirement:** *"My plan for cycle counts is to issue small counts the employees can do everyday to keep inventory accurate. Something like a vendor per day, broken into chunks if a large vendor, or if small enough, to do on their own."* · *"I also want options for initiating intelligent cycle counts."*
- **Today:** Plan a count proposes by risk and due date only; vendor shows per group (`audits/new/page.tsx` L388) but cannot be filtered.
- **Requirements:**
  1. Generator **Vendor of the day**: rotates every vendor with open lots; splits a large vendor into chunks by an owner-set size (lots or estimated minutes); remembers the next chunk.
  2. Generators **High value / ABC**, **Exceptions** (oversold, recent adjustments, open 86s, zero on hand with sales), **Expiring soon**, **Cultivera-import flags** (exists), **Never counted / overdue**; each lot shows why it was picked.
  3. Every generator only proposes; the owner names, writes why, creates and releases (D50, D54).
  4. One open count per lot at a time (NetSuite rule).
  5. Optional daily schedule: the proposal is waiting for the owner each morning.
- **Interim:** SOP-06 §4.24 (plan by hand from **Show every active lot**).

## G-41 · Annual year-end full count (APPROVED, D58, SOP-06)
- **Owner requirement:** *"we do a full inventory audit once per year at the end of the year."*
- **Today:** **Show every active lot instead** stops at 400 lots (SOP-06 §4.5).
- **Requirements:** a full-count audit type with no cap; split into counter-sized sections each claimed by one employee (D56); one release, one combined review, one work paper; per-lot capture at first count (G-35) so the store can stay open; the work paper suitable for the accountant (PCAOB AS 2510.11 note on the hub).
- **Interim:** SOP-06 §4.24 (several audits the same day, outside selling hours).

## G-42 · Staged vendor return with the CCRS manifest workflow enforced (BUILT, Phase 1.5)
- **Built (Phase 1.5, D76, D63, D65):** req 1 by a held quantity on the same lot (`inventory_lots.held_qty`, shared with G-44) recorded on the return as `reserved_qty`; `reserve_vendor_return` (migration 0309) holds only free units and inserts the return in one transaction; nothing posts to CCRS. Req 2: vendor (pre-filled from the lot), RMA, numeric processor license (pre-filled from Vendors & Brands) and detail required (`evaluateVendorReturnLog`, `vendor-return-core.ts` L116). Req 3 with (9): one step at a time on the server with compare-and-set, **Manifest uploaded** needs the manifest number, **LCB success email and PDF received** needs the email date (not future, not before the upload); each step stamps `*_by` / `*_at`. Req 4 with (11): **Record departure** (Pacific date + time, driver) runs `depart_vendor_return`: reduction, hold release and CCRS **Other** adjustment naming processor, license, manifest and RMA in one transaction. Req 5: owner-only **Cancel return** (`inventory.vendor_return.cancel`) with a reason runs `release_vendor_return`. Req 6 **in part** (Phase 1.5): reason Recall needs the LCB officer and a contact date on the return itself. **Completed in Phase 1.6c (G-25):** the officer and the date are taken from the lot's open recall event, and the return is refused when the lot is on no open event or the event has no LCB notification (`recallReturnContact`, `recall-event-core.ts` L637; `createVendorReturn`, `disposition.ts` L1101–1112). Req 7: tests for every step (`tests/compliance/fix-p1-5-vendor-return.test.ts`, self-test `vendor-return-core`, guard step 7); the printable packet stays paper form 8.2 (not built). (8) **Download Manifest.CSV** (`vendor-return-manifest/route.ts`) builds the LCB template's 21 header rows and 13 item columns with Greenway as origin, refuses with a list when a required value is missing, and never guesses weight or servings. (10) the 48–72 h / Mon-Wed-Fri text removed from the checklist and the AI advisor. (12) Recalled lots listed for a vendor return and kept Recalled until departure. (13) encoding stays **Other**. Returns logged before 1.5 keep their history; they cannot be cancelled in the app. **Owner action:** apply migration 0309 (after 0308); fill the store's contact phone and email in license settings and each processor's phone and email in Vendors & Brands (the manifest needs them). Until 0309 is applied the app refuses to log a vendor return (never reduces at logging).
- **Owner basis:** D62 (*"We will rarely use these features, but they are necessary for our industry so we must have them and do them properly and accurately."*); compliance doc §3 (manifest in the CCRS portal, 48–72 h, LCB confirms Mon/Wed/Fri, do not release before confirmation). Question Q-15-1.
- **Today:** logging reduces on-hand and posts CCRS **Other** at once (`disposition.ts` L831–840, F-15-1 **S1**); RMA, manifest, license and detail optional; vendor never linked (F-15-2); no server step check, no actor, pickup without a zone (F-15-3).
- **Requirements:**
  1. **Log a vendor return** creates the return in status *awaiting pickup* and moves the units to a held quantity (or a quarantine split lot) that the register and website cannot sell; on-hand is **not** reduced and nothing goes to CCRS yet.
  2. RMA number and processor license required at logging; vendor chosen from Vendors & Brands (pre-filled from the lot); detail required.
  3. Steps enforced on the server in order (`nextManifestStatuses`), each stamped with who and when; manifest number required from **Manifest submitted in CCRS**; LCB confirmation date required at **Manifest confirmed by LCB**.
  4. **Picked up / in transit** (pickup time in Pacific, driver name) posts the reduction and the CCRS **Other** adjustment with a detail naming processor, manifest and RMA.
  5. **Cancel return** (owner) releases the held units with a reason.
  6. Reason **Recall** is refused unless the lot's recall event (G-25) records the coordinator's LCB contact.
  7. Printable vendor-return packet (form 8.2 in the app); tests for every step.
- **Built (Phase 1.7b, owner message 4: *"please also build the printable vendor-return packet (G-42)."*):** req 7 **Print packet (form 8.2)** on every vendor-return row, at every status (`disposition/page.tsx` L639–647), opens `vendor-return-packet/page.tsx` (`inventory.manage`, L26): form 8.2 in the paper order, built by `buildVendorReturnPacket` (`vendor-return-packet-core.ts` L144) from the return, lot, vendor, License settings and the staff roster (`getVendorReturnPacket`, `disposition.ts` L981). A value the app does not hold prints as a blank line; a done step without a stamp prints *not recorded*; paper-only lines stay. No migration. Self-test `vendor-return-packet-core` (37); `tests/compliance/fix-p1-7b-vendor-return-packet.test.ts`. SOP-15 v1.9.
- **Interim:** SOP-15 §4.9–§4.13 (log only on pickup day), form 8.2.
- **v1.1 update (D63, owner: *"I want to follow the states requirements."*):** the state's method replaces the compliance-doc checklist. (8) **Greenway is the origin** and files Manifest.CSV (file name `manifest_413541_…`, OriginLicenseNumber 413541; driver, vehicle, TransportationType, estimated departure and arrival, one row per lot with its CCRS InventoryExternalIdentifier). The app **builds the file** from the return for the owner to upload. (9) The steps are renamed **Manifest uploaded** and **LCB success email and PDF received**. (10) The 48–72 h and Mon/Wed/Fri lines are removed (F-15-19). (11) The reduction posts at **departure**, and the CCRS **Other** detail names the processor, manifest and RMA. (12) Reason **Recall** lists Recalled lots and keeps them Recalled until departure (D65). (13) The encoding stays **Other** until the examiner answers U-72. Interim: SOP-15 v1.1 §4.10–§4.11 (log at departure).

## G-43 · Hardened destruction record and printable log (BUILT, Phase 1.6a)
- **Built (Phase 1.6a, D64, D76):** req 1 (as amended by D64) `evaluateDestructionRecord` (`destruction-record-core.ts` L116) in `completeDestructionAction` (`actions.ts` L342): witness chosen from `employees` (active), refused when it is the signed-in person (by linked login or name); req 2 dropped (D65); req 3 Other method needs the LCB approval reference and date; req 4 `evaluateScheduleQuantity` in `scheduleDestruction` (on hand − held − open events not backed by held units); req 5 Pacific (`formatDestructionPacific`, `holdNotElapsedMessage`); req 6 printable monthly Destruction log (`/admin/inventory/disposition/destruction-log`); req 8 camera name and start/end time required. Columns in migration 0310 (before it, the witness line carries witness and camera). Guard step 8; self-test `destruction-record-core`; `tests/compliance/fix-p1-6a-destruction-record.test.ts`. **Req 7 and the per-event print were built in Phase 1.7a (below).** **Owner action:** apply migration 0310 after 0309; make sure everyone who may witness is on the active staff roster (Staff).
- **Built (Phase 1.7a, owner message 4: *"please build the photo upload (G-43), as well as a video upload just in case."*):** req 7 **Add photo or video (optional)** on each destruction event that is not cancelled (`DestructionEvidenceUploader.tsx`): photo JPG, PNG, WebP or HEIC up to 50 MB, video MP4, WebM or MOV up to 200 MB (the Media Library's limits), straight from the browser to the PRIVATE bucket `destruction-evidence` on a signed URL (TUS over 6 MB). `startEvidenceUploadAction` (`evidence-actions.ts` L45) checks the event and file and signs one fresh key under the event; `finishEvidenceUploadAction` (L80) reads the stored size and type and the first bytes (`evaluateStoredEvidence`, `destruction-evidence-core.ts` L222, using `sniffMime`), removes a refused file, and only then writes the row; both audited (`destruction.evidence_uploaded`, `destruction.evidence_refused`). Table `destruction_evidence` (migration 0312) is append-only (trigger refuses update and delete), KEEP in the factory reset, with no FK to the WIPE `destruction_events`. Viewing by 10-minute signed links only. Req 6 **per event**: **View / print this record** (`/admin/inventory/disposition/destruction-record?id=`, `getDestructionRecordForPrint`, `disposition.ts` L1382) with the photos; the monthly log gains a **Photo / video** column. Self-test `destruction-evidence-core`; `tests/compliance/fix-p1-7a-destruction-evidence.test.ts`. **Owner action:** apply migration 0312 after 0311.
- **Owner basis:** D62; WAC 314-55-097 records (compliance doc §5.3); WAC 314-55-225. Question Q-15-2.
- **Today:** witness optional, recall contact date optional, no approval reference for **Other method** (F-15-4); server-locale hold message (F-15-5); no on-hand check at scheduling (F-15-12).
- **Requirements:**
  1. **Witnessed by** required: a second named staff member chosen from the roster (manager, admin or owner per Q-15-2), not the person completing.
  2. Recall: officer and **Contact date** required, stored in the audit row.
  3. **Other method** requires an LCB approval reference and date.
  4. Scheduling refuses a quantity larger than on-hand (less units already scheduled).
  5. All times shown and messaged in Pacific (`America/Los_Angeles`).
  6. A printable **Destruction log** per event and per month (what, when, method, mix, destination, facility, witness, who), kept five years.
  7. Optional photo upload of the rendered mixture.
- **Interim:** SOP-15 §4.17–§4.18, form 8.3 (two signatures).
- **v1.1 update (D64, owner: *"anyone may witness the destruction. It has to be done on camera as well."*):** requirement 1 becomes "any second staff member from the roster, not the person completing". Requirement 2 is dropped (recalls are not destroyed by us, D65). New (8): a **camera reference** (camera name, start and end time) required to complete, shown on the log (F-15-21; WAC 314-55-083(3)(a)). Interim: SOP-15 v1.1 §4.17–§4.18, form 8.3.

## G-44 · Customer-return segregation and atomic return (BUILT, Phase 1.4)
- **Built (Phase 1.4, D76):** req 1 by a held quantity on the same lot (`inventory_lots.held_qty`, migration 0308), so the CCRS inventory identifier is unchanged; sellable = on hand − held everywhere the register, menu and sale draw read stock (`held-stock-core.ts` L43). Req 2 kept: the Other add-back posts at return, the Destruction at completion (`consume_lot_hold`). Req 3: `record_customer_return` writes the adjustment, on-hand, hold, destruction event and return in one transaction; pre-0308 fallback undoes the add-back on any failure. Req 4: `tests/compliance/fix-p1-4-customer-return-destroy.test.ts`, self-test `held-stock-core`, guard step 6. Owner cancel releases the hold (`release_lot_hold`). **Owner action:** apply migration 0308.
- **Owner basis:** D62; SOP-01 §4.23 (*"Product goes to the quarantine bin."*).
- **Today:** a Destroy return adds the unit to an Active lot (`disposition.ts` L713, L718–726), which the register can draw (`sale-lot-read.ts` L50–53) (F-15-6, **S1**); add-back, destruction event and return insert are separate writes (F-15-7).
- **Requirements:**
  1. A Destroy return lands in a non-sellable bucket (a held quantity on the lot, or a quarantine split lot carrying the same CCRS inventory identifier); the register, website and menu never count it.
  2. The CCRS **Other** add-back and the later **Destruction** both still post, so CCRS nets to zero for the unit.
  3. Return insert, add-back and destruction event in one database transaction (RPC), or none.
  4. Tests: a destroy return never raises sellable stock; a failed insert leaves no add-back.
- **Interim:** SOP-15 §4.7 (sealed destroy bin, form 8.1).

## G-45 · One customer-return path; CSV download behind the ledger (APPROVED, D66, SOP-15)
- **Owner basis:** store policy SOP-01 §4.23; Question Q-15-4.
- **Today:** the wizard skips the 15-day and loyalty checks, takes a typed refund, defaults to Destroy and has no lot picker (F-15-8); the CSV download marks returns exported without the ledger check (F-15-10).
- **Requirements:** the wizard runs `returns-core` policy checks and the automatic refund; an owner-only override with a required reason; a lot picker; default disposition unset (must choose); the CSV download either runs the weekly batch's ledger check and writes to the outbox, or is removed in favour of SOP-16's weekly file; the success message stops telling staff to download.
- **Interim:** SOP-15 §4.4, §4.6, §4.8.
- **v1.1 update (D66, owner: *"Q4- remove it."*):** the wizard is **removed** (component, action and section). The register and Returns desk remain the only customer-return paths. The CSV requirement is unchanged.

## G-46 · Readable errors on Returns & Destruction (PROPOSED, SOP-15)
- **Today:** `?error=qty` / `?error=reason` print as single words (F-15-13).
- **Requirements:** map each code to a sentence (for example "Choose a lot and enter a quantity greater than zero.").
- **Interim:** SOP-15 §4.15.

## G-47 · Legacy Sample-pricing panel removed (BUILT, Phase 0.2, SOP-15)
- **Built (Phase 0.2, D76):** panel, action, store functions and `sample-guardrails.ts` removed; concierge corrected. SOP-15 v1.2 §4.26.
- **Today:** `sample_settings` saved but `checkSampleSale` / `effectiveSamplePrice` have no callers (F-15-16).
- **Requirements:** the register and online checkout call the guardrail for any line flagged as a sample (nominal price forced; public sale blocked when set), with tests; or the panel is removed and the concierge line corrected. Owner choice Q-15-6.
- **Interim:** SOP-15 §4.26 (never sell samples).
- **v1.1 update (D68):** the audit showed the panel is legacy (migration 0042) and unrelated to the samples branch (`trade_sample_settings`, migration 0054). Decision: **remove** the panel, `updateSampleSettingsAction`, `get/updateSampleSettings` and `sample-guardrails.ts` (with its self-test), and correct the concierge line, **in the same build as G-51** so the screen never implies protection. The owner: *"If the panel truly does nothing because our system is properly set up to handle samples, then you may turn it off."*

## G-48 · Returns in the books and the excise return (BUILT, Phase 2.8; SOP-15)
- **Owner basis:** books-23 (*"Anything accounting, bookkeeping, taxes, finance, should be hard gated to me only."*); postings Q1 (drafts await approval).
- **Today:** no refund journal; 50910 unused (F-15-14); excise Box 1 from completed orders only (F-15-15).
- **Requirements:** a daily draft journal for customer refunds (debit 50910 Returns & Refunds and the tax liabilities as applicable, credit cash) awaiting owner approval; LIQ-1295 Box 1 net of returns in the month (by return date), shown as its own line; tests.
- **Interim:** SOP-15 §4.24, form 8.6.
- **Status: BUILT (Fix Phase 2.8, G-48, #1555; plan row 2.8; owner message 5: *"Please finish phase 2"*).** "Today" above is superseded. Each requirement as worded: (1) *"a daily draft journal for customer refunds (debit 50910 Returns & Refunds and the tax liabilities as applicable, credit cash) awaiting owner approval"*: **Draft refunds** on `/admin/books/drafts` writes one draft per business day (`refunds:<day>`) for every void and customer return: DR 50910, DR 32000 excise and DR 32100 sales tax when there is any, CR 10110 for drawer-paid and CR 10100 for safe-paid refunds (`refund-journal-core.ts` L203; `refund-posting-service.ts` L112, no autoPost L173); owner-only, audited; the whole day refused while any refund is untied. (2) *"LIQ-1295 Box 1 net of returns in the month (by return date), shown as its own line"*: `excise-return.ts` L283–342 and **How Box 1 is made** on the excise screen (`page.tsx` L233). (3) *"tests"*: `tests/compliance/fix-p2-8-returns-books.test.ts` (29), self-tests (refund core 20; excise +6), mutation probe `scripts/compliance/mutate-fix-p2-8.py`. Stated limit: the refund entry does not reverse the cost of the returned units. No migration. SOP-15 v1.11.
- **Phase 2.8b (#1556; owner message 6: *"Please completely finish the refund entry, so it puts back the cost of returned items. Please make sure this is of enterprise grade quality."*).** The stated limit above (*"Stated limit: the refund entry does not reverse the cost of the returned units."*) is superseded: **Draft refunds** also drafts `refunds:<day>#cogs`, DR 2xxxx inventory / CR 6xxxx COGS per category (voids from the sale's own `order:<id>#cogs` entry; restocked returns at the lot's unit cost; destroyed returns stay in COGS; an unknown cost refuses the cost draft only). `refund-cogs-core.ts`, `refund-posting-service.ts` L225; tests `fix-p2-8b-refund-cogs.test.ts`; SOP-15 v1.12.

## G-49 · Disposition housekeeping (PROPOSED, SOP-15)
- **Today:** F-15-17 (stale migration comment and reasons header); help panel step 5 implies the Sale correction goes in the InventoryAdjustment file.
- **Requirements:** correct the comments in a new migration's `COMMENT ON` (or a doc note) and the reasons header; help step 5 names both files.
- **Interim:** SOP-15 §4.1, §4.27.

## G-50 · Destruction hold at the legal minimum (APPROVED, D67, SOP-15)
- **Owner basis:** D67 (*"Q5- reduce it to the minimum required by law. Look it up in CCRS please."*). Current WAC 314-55-097 has no waiting period or notice; CCRS needs the Destruction adjustment in that week's file (WAC 314-55-083(4)).
- **Today:** `HOLD_HOURS_DEFAULT = 72` (`disposition-core.ts` L32); min 0 already allowed (L33); the panel says *"72h remains a sensible default."*
- **Requirements:** default 0; panel text "The law sets no waiting period; 0 is the legal minimum"; button text when 0 reads "Schedule" (no "0h hold"); the stale migration comment corrected (with G-49).
- **Interim:** SOP-15 v1.1 §4.27 (the owner or admin sets Hold (hours) to 0).

## G-51 · Trade samples never reach the menu or the register (BUILT, Phase 0.2, SOP-15) — S1
- **Built (Phase 0.2, D76):** requirements 1–5 met. One rule in `src/lib/inventory/sample-lot-core.ts`; enforced in draft seeding, draft approval (refused), menu staging and injection, the register lot draw, the POS menu lot read and barcode index, the sellability report, menu-stock sync and void restock. Intake review now shows the line as information. Test `tests/compliance/fix-p0-2-samples.test.ts`.
- **Owner basis:** D68 (*"They can not be sold at the register, they cannot be found on the menu. They go directly to the employee samples hub where they are distributed there."*); WAC 314-55-096(1)(i) (*"Trade samples may not be sold"*).
- **Today:** F-15-20 (**S1**): no draft, menu, barcode or lot-draw code reads `is_sample`.
- **Requirements:**
  1. `seedDraftsForManifest` skips lots with `is_sample = true` (and an existing draft for a sample lot is shown as "Sample, not for sale" and cannot be approved).
  2. The register lot draw (`readSaleLots`), the POS menu lot read and barcode index, and every website stock count exclude `is_sample` lots.
  3. Intake review shows the line as "Sample → Employee Samples hub" instead of the advisory warning.
  4. Tests: a sample lot sharing a SKU with a sellable lot is never drawn by a sale and never counted as menu stock; no draft is seeded.
  5. The Employee Samples hub stays the only way a sample lot goes down (besides destruction or a count).
- **Interim:** SOP-15 v1.1 §4.26 (dismiss sample drafts; weekly Samples-only check).

## G-52 · New hires start as Candidate; PIN locked until Activate (BUILT, Phase 0.3, SOP-08) — S1
- **Built (Phase 0.3, D76):** requirements 1–4 met. Both create paths insert Candidate / inactive / no PIN; the roster PIN field is gone; the file's PIN field is disabled and the server refuses a PIN until Active (`src/lib/staffing/candidate-start-core.ts`); Activate still runs `activationBlockers`; the roster shows status badges; Payroll Setup still never sets `staff_id`. The payroll roster (and the `employees_on_payroll` view, migration 0306) now include candidate / onboarding people so W-4 and I-9 can be done during onboarding. Test `tests/compliance/fix-p0-3-candidate-lifecycle.test.ts`.
- **Owner basis:** the roster help text already promises it (*"Add them below as a CANDIDATE"*, `employees/page.tsx` L93); RCW 69.50.357(2) (no one under 21) and (3) (training).
- **Today:** F-08-1 (**S1**): Add to roster and Payroll Setup create the person **Active**; the gate runs only on Activate.
- **Requirements:**
  1. `createEmployeeAction` and `addPersonToPayroll` insert `employment_status = 'candidate'` and `active = false`.
  2. The PIN field is hidden or disabled until the status is Active; `getEmployeeByPin` already ignores inactive rows.
  3. Activate keeps running `activationBlockers`; the roster shows status badges.
  4. Tests: a new employee cannot clock in or unlock the register until activated; Payroll Setup still never sets `staff_id` (books-87).
- **Interim:** SOP-08 §4.6, §4.13: no PIN until form 8.1 is signed.

## G-53 · Owner-set user ↔ employee link (BUILT, Phase 5, D70, SOP-08) — S2
- **Status: BUILT (Phase 5, #1566).** Requirements 1–4 met: link/unlink on the file (owner/admin, one sign-in per employee, rank rule, confirmation, audited before/after); no employee or sign-in created or edited (one update-only writer); the register gate already reads the linked sign-in; Users shows the employee, the file shows the sign-in. Migration 0324 (unique partial index). See "Fix Phase 5" below.
- **Owner basis:** books-87 (*"I want to create the employee in payroll/ W-4 setup, then I will give them access to the back office if they need access to it."*). A link set by the owner keeps that order; it never creates an employee.
- **Today:** F-08-2: only the 2023 seed set `staff_id`.
- **Requirements:**
  1. On the employee file (or Users), the owner or admin picks an existing sign-in to link; one sign-in per employee; unlink allowed; audited with before/after.
  2. Linking never creates or edits an employee record or a sign-in.
  3. The register gate then accepts the linked sign-in's acknowledgment (existing code path).
  4. The Users page shows the linked employee and the file shows the linked sign-in.
- **Interim:** SOP-08 §4.10 paper handbook route for everyone.

## G-54 · One-step offboarding (BUILT, Phase 5, D71, SOP-08) — S2
- **Status: BUILT (Phase 5, #1566).** Requirements 1–4 met: Terminate shows the linked sign-in and "Deactivate their sign-in too" (default on, confirmation pop-up); lists future shifts and deletes scheduled ones after the last day; flags an open punch for Hours; Users names the linked file with "Terminate on their file"; every step audited.
- **Today:** F-08-3: two separate pages, nothing connected.
- **Requirements:**
  1. Terminate shows the linked sign-in (needs G-53) and offers "Deactivate their sign-in too" (default on, with a confirmation).
  2. Terminate lists future shifts and deletes them on confirm; flags an open punch for a manager to close with a reason.
  3. Deactivate on Users shows the linked employee and a link to Terminate.
  4. Every step audited.
- **Interim:** SOP-08 §4.21–§4.22, form 8.3, card 9.2 (both halves the same day; for a dismissal, deactivate first).

## G-55 · Checklist and Document tracker in step; stronger Activate gate (PROPOSED, SOP-08) — S2
- **Today:** F-08-4 (box does not set the tracker row; paper row has no version), F-08-5 (no log line or hire info needed).
- **Requirements:**
  1. Checking a task with a `docKey` sets the matching document row (handbook → Read & signed with today's date), and the reverse; the core L62 comment becomes true.
  2. The paper handbook row stores the handbook version; the register gate treats an old version as unsigned.
  3. Activate also needs hire date, badge number and one training-log line per required topic (`training_rules`, `training_id_check`).
- **Interim:** SOP-08 §4.10 step 4, §4.11 step 3, §4.18.

## G-56 · Rehire keeps history and starts fresh (PROPOSED, SOP-08) — S3
- **Today:** F-08-6.
- **Requirements:**
  1. Store employment periods (hire date, termination date, reason) instead of clearing them; the file shows the history.
  2. Rehire resets every onboarding task to unchecked (old rows kept as history).
- **Interim:** SOP-08 §4.24.

## G-57 · Visitor log and badges (DEFERRED, D72: paper for now, SOP-08) — S2
- **Owner basis:** WAC 314-55-083(1)(a)–(d) (visitor badge; log with full name, badge number, arrival and departure times, purpose; kept three years).
- **Today:** F-08-8: nothing in the app.
- **Requirements:**
  1. A visitor sign-in screen (manager tablet) with the WAC fields; numbered visitor badges; sign-out.
  2. Records kept at least three years; printable for an inspector.
  3. Employee badge printing (name or number, WAC 314-55-083(1)) from the file's badge number.
- **Interim:** SOP-08 forms 8.2 and 8.5.

## G-58 · Users and job-role housekeeping (PROPOSED, SOP-08) — S4
- **Today:** F-08-9, F-08-10.
- **Requirements:**
  1. `inviteUser` default matches the screen (staff) or the screen defaults to readonly; one value.
  2. Role descriptions list every permission (generated from `roles.ts`).
  3. Job-role changes audited with old and new values.
- **Interim:** SOP-08 form 8.4.

## G-59 · Activate, Terminate and Rehire are owner and admin only (BUILT, Phase 0.3, SOP-08) — S2
- **Built (Phase 0.3, D76):** `staffing.lifecycle` = [owner, admin] in `roles.ts` (labelled, listed); `setStatusAction` requires it for every transition (Start onboarding, Activate, Terminate, Rehire); the file page hides all four controls for managers and shows "owner or admin only". The legacy `active` checkbox path in `updateEmployeeAction` was removed so nobody can bypass the lifecycle. Managers keep the rest of the file.
- **Owner basis:** D74 (*"I would like to modify this to be owner admin only. No manager access."*).
- **Today:** the status buttons on the employee file and `setStatus` (`[id]/actions.ts` L190–229) need only `staffing.manage` (owner, admin, manager; `roles.ts` L261).
- **Requirements:**
  1. New permission (e.g. `staffing.lifecycle`) = [owner, admin], labelled in the permission matrix.
  2. `setStatus` (Activate, Terminate, Rehire) requires it on the server; the buttons are hidden for managers, with a line saying "Owner or admin only".
  3. Managers keep everything else on the file (checklist, documents, training, hire info, PIN once Active).
  4. Tests: a manager's setStatus is refused for every transition; owner and admin succeed; the nav gate stays in step.
- **Interim:** SOP-08 v1.1 §2 rules 1–2.

## G-60 · Emailed COAs attach to the delivery's lines (BUILT, Phase 3.1a, SOP-04) — S1
- **Owner basis:** owner message 6: *"The last one the system auto fetched had every detailed needed, but for some reason didn't or couldn't attach the coa lab results to the products in the receiving detail page. So I can't accept it nor move it to onboarding. We need a supremely robust table and fetcher, it needs to work every time for every invoice and manifest"*; *"The vendor_intake@ address will only receive manifests."*
- **Was:** the first coa-role PDF only, read as a one-page summary; a GrowFlow certificate bundle gave 0 lots and a console line (F-04-21).
- **Built:**
  1. Every lab PDF (coa role, plus any other PDF that reads like a certificate and is not a manifest) is read in parallel and split on *"Page k of k"* into certificates (`coa-bundle-core.ts`, `pdf-extract.ts` `readCoaBundleFromBase64`).
  2. Matching never guesses: a lab / batch id the line carries (one certificate only), else a product phrase that only one certificate prints (flagged *"verify"* on the line and in the COA cell); generic kind words never match; two candidates = ambiguous, left for a person; a line with a lab result is never changed.
  3. Both paths (JSON and PDF-only) fold the certificates; the outcome is one sentence in the email result and a delivery timeline event (`coa_attach` / `coa_attach_incomplete`); an unreadable lab PDF is named.
  4. Each PDF is archived only under the lab results read from it.
  5. Receiving page: COA cell wording, **Re-read COAs from this delivery's documents** (audited `manifest.coa_reread`, timeline `coa_reread`), per-line **Choose its certificate… / Attach lab result** (stale pick refused; audited `inventory_lot.coa_linked`, timeline `coa_linked_by_hand`). Manager (`inventory.manage`). No migration.
- **Tests:** `fix-p3-1a-coa-bundle` (real GrowFlow PDFs and text; truth = the vendor's own `lab_result_link`), `fix-p3-1a-coa-archive`; `r26`, `s29`, `pipeline-fix-links-connected` updated; mutation probe `scripts/compliance/mutate-fix-p3-1a.py`.

## G-61 · Clock-out guard (BUILT, Fix Phase 6, D84, SOP-01) — S2
- **Owner basis:** D84 (Q-E-6): *"Block. I don't want to clock out on the register change out step. A lot of times they count out early to let the new employee add their till ahead of their shift, so they can finish other tasks if needed before they clock out."*
- **Built:** `clockOutBlocked` (`shift-end-core.ts`) checked in `toggleClock` before the clock-out write; `openDrawersOwnedBy` (opened_by = employee, status open). Manager timesheet edits exempt. Register lock-screen and home punch show the same words; an offline punch refused on replay becomes a Register exception. Closing never clocks out (the register says *"You are still clocked in"*).

## G-62 · Float check at count-in (BUILT, Fix Phase 6, D85, SOP-01) — S3
- **Owner basis:** D85 (Q-E-7): *"Warn please"*. Closes F-01-13.
- **Built:** `floatCheck` against `registers.default_float_minor`; shown live on the register and the back office; saved in the `drawer.opened` audit plus `drawer.float_warning` when over or short. Never blocks.

## G-63 · Retire Verify till (BUILT, Fix Phase 6, D83, SOP-01/SOP-03) — S2
- **Owner basis:** D83 (Q-E-5): *"Yes please do this."* Retires F-00-3, F-00-4 (verify part), F-01-12.
- **Built:** Verify card removed (`oversight.ts` attention items are reconcile only); `verifyTill()` removed from `registers/store.ts`; `verifyTillAction` kept as a refusing, audited stub (`till.verify_retired`). The morning blind bag recount (SOP-03 §4.10) is the verify. History of verified drawers kept.

## G-64 · Crew tip pool (BUILT, Fix Phase 6, D89, SOP-01) — S3
- **Owner basis:** D89 (Q-E-10): *"At shift change the tips are counted and evenly distributed to the two employees. This is the amount to be reported on everyone's own close till summary report. I want everyone to be completely accountable for their register."*
- **Built:** `splitTipPool` (integer cents, floor, leftover stays in the jar, 1–10 people); register close (`tipPool` in the request, re-split by `validateTillRequest`) and back-office close (`tip_mode`, `tip_people`); the share is `tips_minor`; the pool is in the close audit. Till summary label says it is the cashier's own share.

## G-65 · Night deposit assembled and verified (BUILT, Fix Phase 6, D82, SOP-03) — S2
- **Owner basis:** D82 (Q-E-4): *"Please change it to assembled and verified at night, and blind counted in the morning."*
- **Built:** `checkAssembledDeposit` (every till with money ticked, ticks match the server's lines, lines add up to expected, expected workable); `nightAssembleAction` (PIN → drawers re-read → check → `checkNightCount` → `insertNightCount` with `denoms: null` → `deposit_bag.night_assembled`). Bag log / EOD mark the night figure as assembled (`nightMethod`, list `nightAssembled`). The denomination form stays as the fallback. No migration (`night_denoms` was already nullable).

## G-66 · Reconcile timing (BUILT, Fix Phase 6, D87, SOP-01/SOP-03) — S2
- **Owner basis:** D87 (Q-E-8): *"I think it can be done by either the night manager or morning manager. But don't build it this way just because I say to. I want your professional opinion"*.
- **Professional call:** blind close at the till, asynchronous manager review with a deadline (the large POS pattern). Either manager; deadline = the bag seal; never blocks.
- **Built:** `sealBagAction` reads `bagDrawers`, appends `sealReconcileWarning` and audits `deposit_bag.sealed_unreconciled`; `eod-core.ts` `awaitingReconcile` + `eodStatus` banner *"Closed — N drawers awaiting manager reconcile"*.
