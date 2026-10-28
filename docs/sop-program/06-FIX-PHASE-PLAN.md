# 06 — Fix Phase Plan (recommended order)

| | |
|---|---|
| **Status** | **Approved by the owner (D76).** Phase 0 and Phase 1 are in progress; see §7 |
| **Written** | After SOP-08 v1.1 and the SOP Library build |
| **Sources** | [03 Findings Ledger](03-FINDINGS-LEDGER.md) (165 findings: 23 × S1, 67 × S2, 57 × S3, 16 × S4) · [05 Gap Register](05-GAP-REGISTER.md) |

## 1. What the owner asked

The owner's words are in [00](00-OWNER-REQUEST-VERBATIM.md), in the section "Owner reply after SOP-08 + request for the SOP Library and a fix plan":

> "Should we go in the same order as we did for the sop creation? It was good ordering, priority wise in my opinion. I want your opinion too though. Maybe another area struggles more and needs more attention. Or maybe the fix we want to work on first requires fixing this other thing first."

## 2. Recommendation in one paragraph

Keep the SOP order as the **tie-breaker**, but do not use it as the main order. The main order should be **risk first, then dependencies**. Some fixes protect the license and the excise return, and are small: they go first. One shared foundation, the **lot lifecycle** (who can change a lot's status, with what checks, and with what audit trail), sits underneath Receiving (SOP-04), Inventory (SOP-05a), Counts (SOP-06) and Returns & Destruction (SOP-15). Three S1 findings cannot be fixed properly until that foundation exists, so it comes next. The cash chain (SOP-01 → 02 → 03) follows in its own order. Each step depends on the one before it, and the paper forms in the SOPs already cover the gap in the meantime. Customers, loyalty, online orders and digital content come last, as the owner said.

> **Owner note (D77):** the bookkeeping branch is not connected to business events yet and outside bookkeeping services are still in use, so books accuracy is not a current worry. Books-only fixes stay in their phase.

## 3. Why not just follow the SOP order

1. **Exposure is different.** The cash findings are about **books integrity**: drops are not posted (F-02-1, line 183), and 10400 is never filled (F-03-1, line 264). Money is not leaving the store, and the SOP-01/02/03 paper forms control the cash today. Several inventory and compliance findings are different: they can put a **held, recalled, sample or destroy-bound unit in front of a customer**, or report the wrong thing to CCRS. That is a license risk, so it ranks above books risk. Those findings are F-05a-18 (line 513), F-15-6 (line 732), F-15-20 (line 808) and F-05a-1 (line 438).
2. **Dependencies cut across SOPs.** The lot-status rules are needed by:
   - G-19 (SOP-04)
   - G-22 and G-28 (SOP-05a)
   - G-33 to G-36, posting through the hardened adjustment G-23 (SOP-06)
   - G-42, G-43 and G-44 (SOP-15)

   Building them once, first, avoids redoing the same screens four times.
3. **Small fixes with high exposure should not wait.** F-01-14 (medical test mode removes tax, line 164) is in SOP-01, and G-51 (samples) is in SOP-15. Each is small, but each one touches the excise return or the WAC directly.

## 4. The phases

Each phase is a set of slices. Each slice follows the standing rules: commit → PR → rebase-merge → summary report. Each slice also updates its SOP (D41) and the concierge (D42), and closes its gap rows with the merge commit.

### Phase 0 — License and tax exposure (small, independent fixes)

| Order | Fix | Finding (03 line) | Gap | Why first |
|---|---|---|---|---|
| 0.1 | Medical test mode can't finish a real sale without tax | F-01-14 (164) | none yet; the slice opens one | Tax removed with no exemption record |
| 0.2 | Samples never reach the menu, register, barcode index or website; remove the dead sample panel | F-15-20 (808), F-15-16 | G-51, G-47 | WAC 314-55-096(1)(i) |
| 0.3 | New people start as Candidate; Activate runs the gate; Activate, Terminate and Rehire are owner/admin only | F-08-1 (822) | G-52, G-59 | An unvetted person must not be able to sign in to the register (RCW 69.50.357) |
| 0.4 | Cannabis-line guard, refused in both directions | F-05b-9 (578) | G-31 | Excise and purchase limits |
| 0.5 | No typed cannabis unit cost in Bulk fill | F-05a-11 (482) | G-27 | Owner re-rated S1 (D38); one-field removal |

### Phase 1 — The lot lifecycle foundation (shared by SOP-04, 05a, 06 and 15)

| Order | Fix | Finding (03 line) | Gap | Depends on |
|---|---|---|---|---|
| 1.1 | Gated, audited lifecycle: go-live check on Active, a reason on every change, no manual Destroyed, owner-only recall release, status history | F-04-2 (332), F-05a-1 (438), F-05a-2 (443) | G-19 → G-22 | — |
| 1.2 | Hardened manual adjustment (atomic, no negative, Theft/Seizure, audit + name) | — | G-23 | 1.1 |
| 1.3 | Destruction keeps Recalled; Cancel restores the earlier status with a reason | F-05a-18 (513) | G-28 | 1.1 |
| 1.4 | Customer returns marked Destroy are never sellable; the save is atomic | F-15-6 (732) | G-44 | 1.1, 1.2 |
| 1.5 | State-exact vendor return (reserve at logging, reduce at departure, outgoing manifest) | F-15-1 (707) | G-42 | 1.1, 1.2 |
| 1.6 | Destruction record hardening; recall plan and log; expired-stock block at the register | — | G-43, G-25, G-24 | 1.1 |

### Phase 2 — The cash chain (SOP-01 → 02 → 03, in that order)

| Order | Fix | Finding (03 line) | Gap | Depends on |
|---|---|---|---|---|
| 2.1 | Per-drawer sales and refunds figure; reconcile stops being hand-typed | F-01-4 (121) | G-05 | — |
| 2.2 | Second-person count at till close | F-01-9 (143), F-00-5 (42) | G-01 | 2.1 (the second person checks a real figure) |
| 2.3 | $5 over/short warnings, including the master till | — | G-03 | 2.1 |
| 2.4 | Post cash drops (10110 → 10100) | F-02-1 (183) | G-12 | — |
| 2.5 | Cash-to-bank books wiring (10400, bank-deposit clearing caller) | F-03-1 (264), F-03-3 (275) | G-14 | 2.4 |
| 2.6 | Deposit bag screen, then the EOD deposit sheet and export | F-00-6 (46) | G-04 → G-15 | 2.5 |
| 2.7 | Master till items: denomination log, mix standard, printable sheet, supply run, any-employee count | — | G-02, G-08, G-09, G-11, G-13 | 2.4 |
| 2.8 | Returns in the books and excise Box 1 | — | G-48 | 2.5, 1.4 |

### Phase 3 — Receiving (SOP-04)

| Order | Fix | Finding (03 line) | Gap | Depends on |
|---|---|---|---|---|
| 3.1 | Partial-quantity receive, "N of M" | F-04-1 (326) | G-16 | 1.1 |
| 3.2 | Failed-to-stage emails, first-delivery marker, CCRS records request, benchmark retention | — | G-17, G-21, G-18, G-20 | — |

### Phase 4 — Counts and audits (SOP-06)

| Order | Fix | Finding (03 line) | Gap | Depends on |
|---|---|---|---|---|
| 4.1 | Count-sheet integrity (claim, +1 per scan, a disagreeing recount blocks) | F-06-5b (641), F-06-13 (677) | G-36 | 1.2 |
| 4.2 | Count cutoff (per-lot capture, sales during the count reconciled) | F-06-7 (651) | G-35 | 4.1 |
| 4.3 | Audit stage controls, Release to Cycle Counts | F-06-1 (616) | G-33 | 4.1 |
| 4.4 | "I'm done", editable reasons, housekeeping, daily checklists, intelligent cycle counts, year-end count | — | G-34, G-37, G-39, G-38, G-40, G-41 | 4.1–4.3 |

### Phase 5 — Non-cannabis goods (SOP-05b)

| Order | Fix | Finding (03 line) | Gap | Depends on |
|---|---|---|---|---|
| 5.1 | Other Inventory connected to the register end to end | F-05b-1 (539) | G-29 | 0.4 |
| 5.2 | Audited price/cost edits; hardening bundle | — | G-30, G-32 | 5.1 |

### Phase 6 — People (SOP-08), the remaining items

| Order | Fix | Gap | Depends on |
|---|---|---|---|
| 6.1 | Owner-set user ↔ employee link (D70) | G-53 | 0.3 |
| 6.2 | One-step offboarding (D71) | G-54 | 0.3, 6.1 |
| 6.3 | Checklist ↔ tracker in step; rehire periods; housekeeping | G-55, G-56, G-58 | 6.1 |

### Phase 7 — Remaining S3/S4, then the next audits

1. Readable errors, disposition housekeeping, destruction hold text, removal of the back-office customer-return wizard (G-46, G-49, G-50, G-45), plus the remaining S3/S4 findings in 03.
2. SOP export (the open half of G-06) and the crawler PO builder (G-07, after the SOP-09 audit).
3. Audits **without SOPs** of customers, loyalty and online orders, as the owner said ("Worth doing the audit on them still, but probably won't need an sop for them").
4. Digital content audit and fixes, funded with the money left over (owner, same message).

## 5. Ground rules for every fix slice

1. **One gap (or one tightly linked group) per PR.** That keeps every PR small enough for the owner to test.
2. **The server enforces the rule, not just the button.** Each role limit is checked in the server action and also hidden in the screen (pattern: G-59).
3. **An audit row on every status, cost or cash change.** It records the old value, the new value, who made the change and the reason.
4. **The SOP and the concierge move with the code.** A slice is not done until its SOP section and concierge topic match the screen (D41, D42). The SOP Library shows the new version immediately because it reads `docs/sop/` directly.
5. **Each slice gets a focused test**, and the compliance suite stays green.
6. **Gap rows close with the merge commit hash** in [05](05-GAP-REGISTER.md).

## 6. What the owner needs to decide

1. Agree to this order, or move a phase. Phase 2 (cash) can swap with Phase 1 if the owner sees books integrity as the bigger worry. The only hard rules are the dependencies inside each phase.
2. Q-05b-6 (managers saving cost) is still open, and it matters for G-30 in Phase 5. It does not block anything before Phase 5.

## 7. Progress

| Step | Gap / finding | Status | PR |
|---|---|---|---|
| 0.1 | F-01-14 medical test mode tax | **FIXED** | #1529 |
| 0.2 | G-51 + G-47 samples off menu, register and website; legacy panel removed | **BUILT** | #1530 |
| 0.3 | G-52 + G-59 new hires start as Candidate (PIN locked until Active); lifecycle owner and admin only (F-08-1) | **BUILT** | #1531 |
| 0.4 | G-31 cannabis-line guard, refused both directions at all three entry points, audited, Issues row (F-05b-9) | **BUILT** | #1532 |
| 0.5 | G-27 no typed cannabis unit cost: Bulk fill cost removed, guard test, "correct from the manifest" (F-05a-11) | **BUILT** | #1533 |
| 1.1 | G-19 + G-22 gated, audited lot lifecycle: go-live check on Active, reason required, no manual Destroyed, recall release owner/admin with clearance reference, Status history; guard extended (F-04-2, F-04-12, F-05a-1, F-05a-2) | **BUILT** | #1534 |
| 1.2 | G-23 hardened manual adjustment: atomic strict write, no negative, Sold out at zero, Theft / Seizure with incident reference, CCRS notes required, Receive / Destruction / Recall removal removed, Schedule destruction link, audit + name (F-05a-3…F-05a-7, F-05a-13) | **BUILT** | #1535 |
| 1.3 | G-28 destruction keeps held lots held: Active + Quarantine listed with status, Recalled never destroyed (D65), earlier status kept (migration 0307) and restored on cancel and partial completion, owner-only cancel with reason, guard step 5 (F-05a-17, F-05a-18, F-05a-19, F-15-9, F-15-11) | **BUILT** | #1536 |
| 1.4 | G-44 customer-return Destroy units held on the lot (migration 0308 `held_qty`), never sellable at the register, menu or sale draw; return, add-back, hold and destruction event in one RPC; held units refused to other reductions; owner cancel releases them; guard step 6 (F-15-6, F-15-7) | **BUILT** | #1537 |
| 1.5 | G-42 state-exact vendor return: logging reserves the units on the lot (migration 0309), Recalled lots returnable and kept Recalled until departure, server-checked state steps (upload Manifest.CSV, LCB success email, departure), departure reduces on-hand and posts the CCRS Other adjustment in one RPC, Manifest.CSV built from the return (no guessed values), owner-only cancel releases the units, 48–72 hour / Mon-Wed-Fri text removed, guard step 7 (F-15-1, F-15-2, F-15-3, F-15-19) | **BUILT** | #1538 |
| 1.6a | G-43 hardened destruction record: witness from the roster (never the person completing) and camera with start/end time required on the server, refusals audited; Other method needs the LCB approval reference and date; scheduling refuses more than on hand less held and already-scheduled units; Pacific times; printable monthly Destruction log; migration 0310; guard step 8 (F-15-4, F-15-5, F-15-12, F-15-21) | **BUILT** | #1539 |
| 1.6b | G-24 expired stock (D36, D44): expired Solid Edible, Liquid Edible, Tincture, Capsule and RSO (by CCRS type, store category or name) refused at completion with no override and left off the register menu; every other expired item needs "I told the customer" (back office, register) and is noted on the order; FEFO sale draw; nightly quarantine at 4:20 AM PDT (compare-and-set on Active); Issues text follows the owner's rule; no migration; guard step 9 (F-05a-8, F-05a-20) | **BUILT** | #1540 |
| 1.6c | G-25 recall plan and log (WAC 314-55-225): Settings → Recall plan with annual review; Inventory → Recalls (notice, lots set Recalled through the gated path, LCB notification by owner/admin, weekly rows, close-out); Issues shows the LCB deadline (recall now, withdrawal 48 h), weekly report due and open pickup orders holding a recalled product; the public menu drops held products and sizes; online ordering refuses them fail-closed; a Recall vendor return takes the officer and date from the event (G-42 req 6); migration 0311 (F-05a-15, F-05a-16) | **BUILT** | #1541 |
| 1.7a | G-43 req 7 (owner message 4): optional photo and video evidence on each destruction event, private `destruction-evidence` bucket, size/type/first-bytes checked before recording, append-only (migration 0312, KEEP), audited; per-event printable record; Photo / video column on the monthly log | **BUILT** | #1542 |
| 1.7b | G-42 req 7 (owner message 4): printable vendor-return packet, form 8.2 filled in from the app on every vendor-return row (who and when for each step, Pacific; blanks for what the app does not hold, never guessed); no migration | **BUILT** | #1543 |
