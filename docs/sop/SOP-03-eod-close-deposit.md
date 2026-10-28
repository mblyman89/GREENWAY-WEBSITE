# SOP-03 — End-of-Day Close & Deposit Bag: Night Sheet, Morning Recount, Seal, Safe, Bank

| | |
|---|---|
| **Version** | 1.3 (draft for owner review; Phase 2.2: the second count at till close is now in the app; owner answers D21–D27 applied; D41 living-SOP reminder) |
| **Effective** | On owner approval |
| **Owner** | Michael Lyman |
| **Applies to** | The night closer who completes the end-of-day sheet; the morning employee who recounts, verifies and seals the deposit bag; the manager who reconciles, verifies and prints the end-of-day report; the owner, who takes the bags to the bank and reviews the books |
| **Verified against** | `main@3385bfa9` (2026-10-27). No application code changed between `0055f06c` (SOP-02 audit) and `3385bfa9`; both merges were docs only. Every label, message, number and rule below was read from the code or quoted from the owner. Nothing was written from memory. Arithmetic was checked by script (`sop03/calc.py`, `sop03/calc2.py`), not by hand. |
| **Program records** | Findings `F-03-*` in `docs/sop-program/03-FINDINGS-LEDGER.md` · Gaps in `docs/sop-program/05-GAP-REGISTER.md` · Owner decisions D2, D7, D10, D14–D27 in `docs/sop-program/00-OWNER-REQUEST-VERBATIM.md` |

> **This SOP is a living document (owner decision D41).** The owner said: *"We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary."* When any gap this SOP names (Appendix B) is built, this SOP is updated in the same piece of work: the sections the gap names, Appendix B, Appendix D (a new revision row), the finding marked FIXED, and the concierge entry (charter §3 rules 9–10). Until then, the interim procedures in this SOP are the rule.

> **How to use this document.** Section 4 is the step-by-step manual, in the order the work happens: night, morning, bank day. Section 4.1 explains what goes in the bag and what stays behind, so read it first. Section 5 lists every message the end-of-day report can show. Section 8 holds the paper forms; the night sheet (form 8.1) **is** the owner's "end of day spreadsheet" until the app has one. Section 9 is a one-page card to tape inside the safe door. Words in **bold** are the exact labels you will see on the screen.

> **The one thing to know before anything else.** The deposit bag is **not in the app yet**. There is no screen to record a bag, a seal, a morning recount or a bank run (finding F-00-6, gap G-04). The database table and the rules for bags exist, but nothing calls them (§4.12). **The paper forms in this SOP are the record.** The end-of-day report prints the day's numbers; it does not record the bag.

---

## Table of contents

1. Purpose & scope
2. Roles & permissions
3. Before you start
4. Procedures
   - 4.1 What goes in the bag, and what stays behind
   - 4.2 The end-of-day timeline at a glance
   - 4.3 Night: close every drawer first (SOP-01)
   - 4.4 Night: pull the takings and gather the drops
   - 4.5 Night: count the deposit and complete the night sheet
   - 4.6 Night: bag it (unsealed) and put it in the store safe
   - 4.7 Night or morning: manager reconciles every drawer
   - 4.8 Opening and reading the End-of-day report
   - 4.9 Printing the End-of-day report and filing it
   - 4.10 Morning: recount and verify the night sheet
   - 4.11 Morning: seal the bag, log it, back into the safe
   - 4.12 Morning: Verify till in the back office
   - 4.13 Bank day: taking the bags to the bank
   - 4.14 The $10,000 line: one day, one bag, whole
   - 4.15 "Cash on its way to the bank" panel (read with care)
   - 4.16 Days with no sales, a missed bank run, a bag held over
   - 4.17 Printing and exporting (interim)
5. Hard blocks and messages: "If you see this message"
6. Exceptions & escalation
7. Controls & compliance (why the rules exist)
8. Checklists & forms
9. Quick reference card
10. Glossary
- Appendix A: Source map
- Appendix B: Not built yet (interim paper procedures)
- Appendix C: Open questions for the owner
- Appendix D: Revision history

---

## 1. Purpose & scope

**Purpose.** This SOP closes the cash chain that SOP-01 (the register) and SOP-02 (the master till) start: **till → store safe → bank**. The owner asked for exactly this:

> *"There should be an end of day spreadsheet that one person completes before close, and the morning employee recounts and verifies the amount before sealing the bag and putting it into the safe for depositing to the bank."* (`00-OWNER-REQUEST-VERBATIM.md` L7)

and described the money itself:

> *"167.50 is left in the register and the rest goes into the safe. The end of the day, the safe money goes into the deposit bag with an id. Any over under is dealt with on the spot once the total till is reconciled."* (quoted in `src/lib/accounting/safe-bag-core.ts` L17–22)

The owner later set the cadence:

> *"I will keep cash at the shop and start doing daily deposit bags. Even if I don't make it to the bank for 15 days, each deposit will still match the day it came from."* (`docs/MICHAEL-books-96-one-bag-one-day.md` L6–9)

This SOP makes sure that:
1. every business day's cash takings are counted **once at night** by one person and **again in the morning** by another person, and the two counts are signed on paper;
2. each business day goes into **one numbered bag**, sealed, and the bag stays in the store safe on the licensed premises until it is banked;
3. the $10,000 bank reporting line **never** decides how a day is split (§4.14);
4. the end-of-day report is printed, signed and filed with the day's paper.

**In scope:**
- The **End-of-day report** page (`/admin/registers/eod`).
- The night sheet, the morning recount, the seal, the bag log and the bank run (paper, gap G-04).
- The **Verify till** step as it fits into the morning (the step itself is documented in SOP-01 §4.30).
- The **Cash on its way to the bank** panel on the end-of-day page.

**Out of scope (separate SOPs):**
- Ringing sales, drops, swaps, blind close, X/Z reports, reconcile and verify **mechanics** → **SOP-01** (§4.25–4.30). This SOP refers to them; it does not repeat them.
- The master till ($1,000 change fund) AM/PM counts → **SOP-02**. The master till is **never** part of the deposit.
- Matching bank lines and the books (**/admin/books/bank**, owner-only) → books SOPs (later slice). §4.13 and §4.15 say only what the floor needs to know.

---

## 2. Roles & permissions

| Task | Who | How the system checks |
|---|---|---|
| Close a drawer (blind count, second count) | The cashier, plus **any second employee** (D2) | Register PIN, then the second employee's PIN and their own blind count in the app (SOP-01 §4.27 steps 8–12; built in Phase 2.2, G-01) |
| Pull takings, count the deposit, complete the **night sheet** (form 8.1) | The night closer ("one person completes before close") | Not in the app. Paper. |
| Reconcile each drawer | Owner, admin or manager login | `requirePermission("inventory.manage")` on Register Activity (SOP-01 §4.30) |
| Open and print the **End-of-day report** | Owner, admin, manager | `requirePermission("inventory.manage")` (`eod/page.tsx` L45). `inventory.manage` = owner/admin/manager (`src/lib/auth/roles.ts` L106). A staff login that taps **End-of-day report** on Register Activity (`registers/page.tsx` L126–128) is sent to `/admin?denied=1` (F-02-10). |
| **Morning recount** and verify the night sheet | The morning employee ("the morning employee recounts and verifies") | Not in the app. Paper (form 8.1, part B). |
| Seal the bag, write the bag number, log it | **Any employee** (D25: *"anyone can seal the bag"*), after the morning recount | Not in the app (F-00-6). Paper (form 8.2). |
| **Verify till** in the back office | Owner, admin, manager | `inventory.manage`. Records no recount (F-00-3); paper is the record. |
| Take bags to the bank | **The owner only** (D25: *"I am the only one to take cash to the bank"*) | Not in the app. Paper bag log + bank receipt. |
| Match the deposit in the books | Owner only | `requireBooksAccess()` (`src/app/admin/books/bank/page.tsx` L175). **No screen clears a deposit today** (F-03-3). |

**Who may count the deposit?** The owner's request names *"one person"* at night and *"the morning employee"* in the morning. It does not restrict either to a manager. This SOP therefore lets **any employee** do either count, but they must be **two different people** (the whole point of the morning recount). **There is no second count at night** (D24: *"no second count at night, just the recount in the morning by any employee"*). The morning recount is the second count. *(This is only about the deposit count. The second-person sign-off at till close, SOP-01 / D2, is separate and still applies.)*

---

## 3. Before you start

1. **Supplies in the safe:** tamper-evident deposit bags with **pre-printed numbers**, bank deposit slips, a pen, blank night sheets (form 8.1), and the bag log (form 8.2). If you are down to the last three bags, tell the owner.
2. **Know the floats by heart:** **Sales Register 1** $167.50, **Sales Register 2** $167.50, **Manager Till** $300.00 (D10, D19; system `0038` L178–184, `0077` L43–46). The floats **stay in the drawers**. They are never bagged.
3. **Know what is not deposit money:** the **master till** ($1,000, SOP-02), the **little safe** (SOP-02 §4.10), and **tips** (employee money; SOP-01 §4.27 step 3).
4. **Count in a closed, camera-covered area**, with the door locked and nothing else on the table.
5. **Check the end-of-day page loads** (manager). If it shows **Supabase not configured**, the back office cannot reach the database. Do the paper steps anyway and tell the owner (§5).

---

## 4. Procedures

### 4.1 What goes in the bag, and what stays behind

| Money | Where it goes tonight | In the bag? | Source |
|---|---|---|---|
| Each till's **float** ($167.50 / $167.50 / $300.00) | Stays in its drawer overnight | **No** | Owner quote (`safe-bag-core.ts` L17–22); the books assume it (`floatStaysInDrawer: true`, `drawer-posting-service.ts` L189–193) |
| Each till's **takings** = closing count − float | Out of the drawer → store safe → bag | **Yes** | Owner: *"167.50 is left in the register and the rest goes into the safe"* |
| **Drops** made during the day (already in the store safe) | Bag | **Yes** | SOP-01 §4.25; owner: *"the safe money goes into the deposit bag"* |
| **Master till** ($1,000) | Stays in the master till | **No** | SOP-02 §4.12 |
| **Little safe** | Stays | **No** | SOP-02 §4.1 |
| **Tips** | Per store tip policy, never in the drawer count | **No** | SOP-01 §4.27 step 3; tips are excluded from the books close (`drawer-posting-service.ts` L20–29) |

**The deposit for the day is therefore:**

```
DEPOSIT  =  all of today's drops  +  Σ (each till's closing count − its float)
```

**Worked example** (script-checked, `sop03/calc2.py`; made-up numbers):

| Till | Float stays | Drops today | Closing count | Takings from close | To the bag |
|---|---:|---:|---:|---:|---:|
| Sales Register 1 | $167.50 | $500.00 (2 drops) | $612.40 | $444.90 | $944.90 |
| Sales Register 2 | $167.50 | $250.00 (1 drop) | $398.15 | $230.65 | $480.65 |
| Manager Till | $300.00 | — | $522.60 | $222.60 | $222.60 |
| **Total** | **$635.00** | **$750.00** | | **$898.15** | **$1,648.15** |

After the bag is made, the building holds the $635.00 of floats plus the $1,000.00 master till = **$1,635.00** (D19; `sop03/calc.py`), plus the sealed bags and the little safe.

> **The over/short is not "fixed" from the bag.** If a drawer is short, the bag is short by the same amount. Do **not** top the bag up from the master till, the little safe or your pocket, and do not take an "over" out. The owner: *"Any over under is dealt with on the spot once the total till is reconciled"*: the manager records it at reconcile (SOP-01 §4.30, form 8.5) and the bag carries what was really there.

> **If a closing count is less than the float** (the drawer cannot leave its full float behind), stop. Do not bag anything from that drawer. The books refuse this case too (`TILL_CLOSE_BELOW_FLOAT`, `register-cash-journal-core.ts` L279–289). Call the manager (§6).

### 4.2 The end-of-day timeline at a glance

```
 NIGHT (closer)                          MORNING (a different employee)         BANK DAY (owner, ~3×/week)
 ─────────────────────────────────────   ───────────────────────────────────   ─────────────────────────────
 1 every drawer closed blind + 2nd count  6 open the safe, take last night's    10 take every sealed bag,
   (SOP-01 §4.27)                            UNSEALED bag + night sheet             oldest first, with the
 2 pull takings (count − float)          7 recount by denomination, alone          bag log
 3 gather the day's drops from safe      8 agree? sign part B → seal → write    11 bank receipt per bag →
 4 count deposit → night sheet part A       bag # on sheet, slip, log 8.2          staple to bag log
 5 cash + sheet in a bag, UNSEALED,      9 sealed bag back into the safe        12 owner files; books
   into the store safe                      manager: Verify till (paper rules)     (later slice)
 manager: reconcile drawers, print EOD
```

The owner's words fix steps 4 (*"one person completes before close"*) and 7–9 (*"the morning employee recounts and verifies the amount before sealing the bag and putting it into the safe"*). The owner confirmed that the counted cash sits **unsealed in the store safe** overnight until the morning recount (D23: *"Q-03-3- yes, that is correct"*).

### 4.3 Night: close every drawer first (SOP-01)

Before the deposit can be counted, **every** drawer that was open today must be closed:

1. Each cashier makes any last drop, takes out the tip jar, and does the **blind close** (SOP-01 §4.27 steps 1–12).
2. **Any second employee** recounts that drawer in the app: the closer taps **Next: second count**, the second person counts blind and enters their own PIN (SOP-01 §4.27 steps 8–12; owner rule D2; built in Phase 2.2). Both still sign the **close slip** (SOP-01 form 8.2) for the paper trail. If the app warned that the two counts differ, write both totals on the slip and tell a manager.
3. If a register had two drawers today, the X report was printed before the first drawer closed (SOP-01 §4.27 step 9).
4. A manager or lead prints the **Z report** when the last drawer of the day is closed (SOP-01 §4.28). Put it with tonight's paper.

**Check:** the End-of-day report banner reads **Final — all drawers closed** (§4.8). If it reads **Preliminary — a drawer is still open**, a drawer was missed. Find it before you continue.

### 4.4 Night: pull the takings and gather the drops

1. For each closed drawer, take the **close slip** (SOP-01 form 8.2) and read its agreed **TOTAL**.
2. Count out the **float** by the standard mix and leave it in the drawer: **$167.50** for each sales register, **$300.00** for the Manager Till. Everything else in the drawer is takings. (SOP-01 §4.29 says the float "goes back to the master till / safe"; that is wrong, and the float stays in the drawer, finding F-03-4.)
3. Band or clip each drawer's takings separately, with a sticky note: register name, takings amount.
4. Open the store safe and take out **today's drop bags**. Check each one against the drops on the close slips (SOP-01 form 8.2, "Drops recorded today"). A drop that is on a slip but not in the safe, or in the safe but on no slip, is an exception (§6).
5. Do **not** open the master till or the little safe for any of this.

### 4.5 Night: count the deposit and complete the night sheet

1. Take a blank **night sheet** (form 8.1). Fill in the date, your name and the time.
2. **Part A, section 1 (where the money came from):** for each till write the closing count from its slip, the float left behind, and the takings (count − float). Write each drop (time, register, amount).
3. Add it up: **Expected deposit = total drops + total takings.**
4. **Part A, section 2 (what is actually here):** put all of the takings and drops together and count **every bill and coin by denomination**. Count twice.
5. Compare **Counted** with **Expected**:
   - **Equal:** good.
   - **Different:** recount. If it is still different, write the difference and what you checked on the sheet. Do not "fix" it (§4.1). Tell the manager before you leave.
6. Sign part A: **Prepared by**, time.

> **Why count by denomination?** The owner asked for a spreadsheet, and the morning recount must be able to say *which* bills disagree, not just that the total does. A total-only count cannot catch a $20 swapped for a $10 and a $10 note mislaid.

### 4.6 Night: bag it (unsealed) and put it in the store safe

1. Put the counted cash **and part A of the night sheet** into a deposit bag. **Do not seal it.** The morning employee must be able to recount (owner: the morning employee recounts *"before sealing the bag"*).
2. Fold the bag closed and clip it with the night sheet on top, so it cannot be mistaken for a sealed bag.
3. Put it in the store safe, on its own shelf or in the "TO VERIFY" slot, away from sealed bags and away from the master till.
4. Lock the safe. Check the lock.

### 4.7 Night or morning: manager reconciles every drawer

A manager reconciles each closed drawer on **Register Activity** exactly as in **SOP-01 §4.30** (cash sales worked out on paper from the Z/X report, net of this drawer's voids/returns, never blank; leave **Reconciled by** blank because of F-00-4/F-01-5; any over/short **over $5.00** → a written reason is required, on SOP-01 form 8.5; $5.00 or less needs no reason, D21).

What reconcile does to the books (owner and bookkeeper only): it posts the drawer's takings into **10100 Cash on Hand — Vault** (*"Cash from <register> to safe"*, `register-cash-journal-core.ts` L294–303) and the over/short to Cash Over/(Short). It does **not** touch **10400 Undeposited Funds**. That account was designed to fill only when a bag is sealed (L296–301, self-test L807–813), and the seal is not wired (§4.15, F-03-1).

Reconcile can happen tonight or first thing in the morning. The End-of-day report shows over/short only for reconciled drawers (§4.8). **Print the report after reconcile** if you can.

### 4.8 Opening and reading the End-of-day report

**Where:** back office → **Register Activity** → **End-of-day report** (`/admin/registers/eod`). Managers, admins and the owner only (§2). The breadcrumb reads **Sell › Register Activity › End-of-day report** (`eod/page.tsx` L63–65).

**Which day:** today's Pacific business day by default (`pacificToday`, L16–19). **There is no date picker on the page.** To see or reprint another day, add `?day=YYYY-MM-DD` to the address, for example `/admin/registers/eod?day=2026-11-02` (L15–19). Anything that is not in that shape silently shows today instead (finding F-03-8).

**The report, top to bottom:**

| Part | Exact label(s) | What it means | Pin |
|---|---|---|---|
| Header | **Greenway Marijuana** · **End-of-day summary report** · **Print** button | | L68–75 |
| Business day | **Business day** + the full date | | L78–81 |
| Status banner | **Final — all drawers closed** or **Preliminary — a drawer is still open** | Final = at least one drawer session today and none still open (`eod-core.ts` L195). It does **not** mean reconciled. | L82–89 |
| Sales | **Sales (all registers, server-verified)**: **Completed sales**, **Subtotal**, **Tax collected**, **Gross sales** | Store-wide, from the server's processed sales for the Pacific day (`eod-store.ts` L112–120) | L92–113 |
| | **Cash rounding (N sales)** (only if any) | Net rounding; cash expected = gross + rounding (`day-report-core.ts` L49–56) | L114–119 |
| | **Employee tab, no cash (N)** (only if any) | A sale, but no cash came in | L120–125 |
| | **Medical sales (tax savings)** (only if any) | Count · tax taken off | L126–133 |
| | **Audited no-sale drawer opens** | | L134–137 |
| | **⚠ Unresolved: exceptions / pending** (only if any) | Sales the server bounced, or still processing. Resolve before you trust the totals (SOP-01 §4.32). | L138–145 |
| Tills | **Tills by register**: **Register**, **Opening**, **Drops**, **Closed count**, **Over/short**, **Tips**, then **Store total** | One row per register used today; idle registers are left out (`eod-core.ts` L122–125). **(open)** after a name = a drawer still open; **×2** = two sessions that day. | L149–202 |
| | **No drawer sessions on this business day.** | Nothing was opened that day (or the read failed, F-03-7) | L153–154 |
| | Footnote: *"Over/short shows only after a manager reconciles a session — blind counts stay blind until then. Tips are employee money, listed for the record and never part of drawer math."* | **Closed count** shows once a drawer is closed (`eod-core.ts` L135); **Over/short** only once reconciled or verified (L139). | L203–206 |
| Safe | **Safe ($1,000 change fund)**: **AM count**, **PM count**, **Extra counts**, **Change swaps (value-neutral)** | The **master till**, not the deposit. See SOP-02 §4.15. | L208–246 |
| Sign-off | **Prepared by (signature)** · **Date / time** | One signature line only (F-03-5) | L248–258 |
| Footer | *"Greenway Marijuana · WA license 413541 · file with the day's physical records"* | | L259–261 |
| Panel | **Cash on its way to the bank** | Read §4.15 before you trust it | L263; `UndepositedFunds.tsx` |
| Panel | **What the ledger does with the cash drawer — a worked example** (folded; hidden when printed) | A teaching example, not your books. Its float total is out of date (F-03-2) | L264; `RegisterCashSpecimen.tsx` L113 |

**What the report does NOT show** (so do not look for it):
- **The deposit amount.** It shows Opening, Drops and Closed count, but not *takings to the bag*. Work the deposit out on the night sheet (§4.5). (F-03-5)
- **Refunds.** Voids and counter returns paid cash out of the drawers, and the Z report lists them (*"REFUNDS — STORE-WIDE CASH OUT"*, SOP-01 §4.28), but the End-of-day report does not (F-03-6). **Gross sales on this report is not the cash you should have.** Use the Z report for cash.
- The bag number, the morning recount, or a second signature (F-03-5, gap G-04).

**A quick cross-check the manager can do on the printed report:** for each register, *Closed count − float* is that till's takings. Add the **Drops** column total. The sum must equal the night sheet's **Expected deposit**. If it does not, a slip or a drop is wrong. Find which before the morning seal.

### 4.9 Printing the End-of-day report and filing it

1. When the banner says **Final — all drawers closed** and every drawer is reconciled (Over/short shows a figure, not **—**), tap **Print** (`eod/page.tsx` L74; it opens the browser's print dialog).
2. If you must print before reconcile, write **"PRINTED BEFORE RECONCILE"** across the top and reprint after.
3. Sign **Prepared by (signature)** and **Date / time**.
4. Staple to it, in this order: the night sheet (form 8.1, after the morning recount), the Z report, every close slip (SOP-01 form 8.2), any over/short forms (SOP-01 form 8.5), the master till sheet (SOP-02 form 8.1).
5. File by date in the month binder. The footer says it plainly: *"file with the day's physical records"*. Records are kept on the licensed premises for five years (`docs/CASH_DEPOSIT_POLICY_DECISION.md` L116–121; WAC 314-55-087).

### 4.10 Morning: recount and verify the night sheet

Done by the **morning employee**, who must **not** be the person who signed part A last night.

1. Before opening, take last night's **unsealed** bag and its night sheet out of the store safe. If the bag is **already sealed**, do not open it; note it and tell the manager (§6).
2. **Without looking at part A's figures**, count every bill and coin by denomination into **part B** (form 8.1). Count twice.
3. Now compare part B's total with part A's **Counted** total:
   - **Equal:** tick **Agrees**, sign part B with the time. Go to §4.11.
   - **Different:** recount once more. If still different, find which denominations disagree (that is why both counts are by denomination). **Do not seal.** Put the bag back in the safe, tell the manager, and fill in part C (variance). The manager and the morning employee recount together. The owner is told the same day.
4. If part A's **Counted** differed from its **Expected** (a short or over night), that difference is already explained on part A; you are checking that the cash in the bag is what the closer counted, not re-doing the till math.

### 4.11 Morning: seal the bag, log it, back into the safe

1. Fill in the **bank deposit slip** for the counted total (part B). One slip per bag.
2. Put the cash, the slip and **a copy of the night sheet's totals** (or the tear-off strip on form 8.1) in a **new** tamper-evident bag if the old one was handled; otherwise use the bag from last night.
3. **Seal** the bag. Write the **bag number** (the number printed on the bag) on:
   - the night sheet (part B, **Bag #**),
   - the deposit slip,
   - the **bag log** (form 8.2): date of the business day, bag #, amount, sealed by, time.
4. Put the sealed bag in the store safe's **"SEALED — TO BANK"** slot. Lock the safe.
5. Give the stapled night sheet and EOD printout (§4.9) to the manager for the binder.

**One bag per business day, whole** (§4.14). If one day's cash will not fit in one bag, use two bags with **consecutive numbers**, write both on the sheet and the log as one deposit ("Bag 1041 + 1042, one day"), and bank them together. Never split a day across two bank trips.

> **What the system would do here, once built:** the bag table records the bag number, the business day, the status (*available → undeclared → counted → deposited*), who pulled the cash, who counted it, when it was sealed and when the bank confirmed it (`0212_deposit_bags.sql` L48–84). Sealing would post *Undeposited Funds ← Vault* with the bag number on both lines (`buildSealBagJournal`, `register-cash-journal-core.ts` L405–441), and would refuse a bag with no number: *"This bag has no id. The id is the only thing that ties a sealed bag to the deposit the bank confirms days later…"* (L413–418). None of this is reachable from any screen today (`grep deposit_bags src/app` → 0 hits; census `seal_deposit_bag` reachable **MISSING**, `ledger-census-data.ts` L1577–1600). The paper bag log is the record.

### 4.12 Morning: Verify till in the back office

After the recount, a manager does **Verify till** for each drawer on Register Activity, as in **SOP-01 §4.30 "Verify till (next morning)"**.

Remember the known problems, which are not fixed yet:
- **Verified by** is typed text going into an employee-ID column. **Leave it blank** (F-00-4, F-01-5).
- The screen has **no denomination boxes**, and **Count agrees** is ticked by default (`registers/page.tsx` L258–259). The system records the recount as **$0** whatever you tick (F-00-3). **Part B of the night sheet, signed, is the real morning verify.**
- Always reconcile before verify (F-01-12). Click once (F-01-2).

### 4.13 Bank day: taking the bags to the bank

The policy decision (`docs/CASH_DEPOSIT_POLICY_DECISION.md` L109–121) sets these standing rules:
- Deposits are bagged **per business day**, sealed, with the slip, and banked **roughly three times a week**.
- **The $10,000 threshold never influences how a day is split.** One day, one bag, whole, whatever it totals.
- Currency transaction reports (CTRs) are expected and unremarkable. Nothing is done to avoid one.
- Cash stays on the **licensed premises** until banked, not at a residence.

**Only the owner takes cash to the bank** (D25). Nobody else removes sealed bags from the safe for banking.

Steps (owner):
1. Open the safe. Take **every** sealed bag in the "SEALED — TO BANK" slot. Check each bag number against the bag log (form 8.2). A bag on the log but not in the safe, or in the safe but not on the log, is an exception: stop and call the owner (§6).
2. Check each seal is intact. A broken or re-taped seal: do not bank it; open it with a second person, recount, write it up (§6).
3. Write **"to bank, <date>, <name>"** against each bag on the log.
4. Bank all of them in one visit, oldest first. Keep each bag's **bank receipt**.
5. Back at the store, staple each receipt to the bag log line and write the date the bank confirmed it (form 8.2, **Bank confirmed**).
6. The owner keeps the bag log with the books papers.

**The books side (owner only, for awareness).** The bank later shows a deposit line on **/admin/books/bank**. The books were designed to clear that line against the day(s) it covered, oldest first, one credit line per day (`deposit-clearing-core.ts`; `docs/MICHAEL-books-96-one-bag-one-day.md` L14–20), and to warn if a deposit splits a day or holds cash older than 30 days (`deposit-clearing-core.ts` L460–488). **No screen calls that clearing today** (finding F-03-3), and even if one did, it would refuse every deposit with *"Nothing is sitting in Undeposited Funds…"* (L396–402) because nothing fills 10400 since D-77 (F-03-1). Until it is built, the bag log plus the bank receipts are the till-to-bank trail.

### 4.14 The $10,000 line: one day, one bag, whole

This is the rule that keeps a lawful deposit lawful. It comes from the owner's own question and the recorded answer (`docs/CASH_DEPOSIT_POLICY_DECISION.md`):

- The owner asked: *"So would multiple sealed deposit bags be considered a work around to the 10k deposit issue?"* (L11–16). The answer: **no**. Structuring is making deposits in a shape **for the purpose of** evading the bank's report (31 U.S.C. § 5324(a), L18–22). Same-day deposits are aggregated by the bank anyway (31 CFR § 1010.313(b), L40–46).
- **The trap to avoid** (L66–73): *"The dangerous version … is the one where a day's takings run over $10,000 and somebody splits that day across two bags, or holds part back to the next trip, 'to keep it simple.' … **Bag exactly one business day, whatever that day happens to be — $600 or $16,000 — and bank it whole.** The day decides the amount; the amount never decides the day."*

So, on the floor:
1. **Never** split a day's cash across two trips, and never hold part of a day back.
2. **Never** choose which bags to take to the bank by adding them up against $10,000. Take **all** sealed bags (§4.13 step 1).
3. If a bank run is missed and the safe holds a lot, take it all next time. A large deposit is *"perfectly lawful and completely routine for a cash business"* (`books/bank/page.tsx` L500–502).
4. If anything ever **must** stay behind (bank closed early, armoured-car limit, safety), write the reason on the bag log **at the time**. The owner memo: *"write down why the rest stayed behind, because an unexplained habit looks worse than a large deposit ever will"* (`safe-bag-core.ts` L319–327; `docs/MICHAEL-books-98-the-store-safe.md` L43–60).

> The system has a "deposit shape" self-check that would show this question on screen (`checkDepositShape`, `safe-bag-core.ts` L305–328). It is **not called by any screen** (F-03-10). The bag log's **Note** column is the interim record. *Not legal advice*; the policy file itself says to mention the cadence to the CPA and counsel (`CASH_DEPOSIT_POLICY_DECISION.md` L122–124).

### 4.15 "Cash on its way to the bank" panel (read with care)

The panel under the report (`UndepositedFunds.tsx`) reads account **10400 Undeposited Funds** from the books.

| What you see | Exact text | Pin |
|---|---|---|
| Amber box | *"This figure could not be read from the books just now. That is not the same as there being nothing waiting — it means the question was not answered, so no conclusion should be drawn from this panel."* | L39–49 |
| Big number | *"$X counted out of the tills and not yet confirmed at the bank"* | L66–71 |
| Green box (when $0) | *"Every dollar counted out of a drawer has been matched to a deposit that reached the bank. This is what it should read most mornings."* | L74–78 |
| Otherwise | *"This is account 10400 Undeposited Funds. A drawer close moves cash into it; a confirmed bank deposit moves cash out of it…"*, oldest day, list of days, *"Each line should be one sealed deposit bag…"* | L80–123 |
| Rose box | *"More was banked than was counted, on …"* | L128–151 |
| Footer | *"Showing this figure does not clear it…"* | L153–158 |

> ⚠ **Do not use this panel to check the safe today (finding F-03-1, S1).** Since the D-77 fix, a drawer close posts to **10100 Vault**, not 10400 (`register-cash-journal-core.ts` L294–303), and only sealing a bag would move cash into 10400. Sealing has no screen. So 10400 stays at **$0.00** and the panel shows the **green "Every dollar … matched" message even while several days of bags sit in the safe**. Its sentence *"A drawer close moves cash into it"* (L82–84) is out of date. **Use the bag log (form 8.2) and the safe itself.** The owner may see a non-zero figure only if entries were posted before D-77 (books-94 to books-97).

### 4.16 Days with no sales, a missed bank run, a bag held over

- **No drawer opened that day:** the report says **No drawer sessions on this business day.** No bag. Write "NO SALES — no bag" on the bag log for that date so the gap is explained.
- **A drawer opened but no cash taken** (every till left with only its float): no bag. Note it on the night sheet and the bag log.
- **Missed bank run:** bags stay sealed in the safe. Take them all next time (§4.14). Each still matches its day (books-96).
- **A bag sealed for the wrong day:** do not open it. Write the correction on the bag log and the night sheet, initial it, and tell the owner.
- **Reprint an old day:** `/admin/registers/eod?day=YYYY-MM-DD` (§4.8).

### 4.17 Printing and exporting (interim)

- The End-of-day report **prints** (§4.9). It has **no export** (no CSV or spreadsheet route under `src/app/admin/registers/eod/`; finding F-00-8, gap G-09/G-15).
- The owner asked that the closing-day reports *"can be exported and printed"*. Until export is built, the printed report plus the paper night sheet are the record. The owner can query `drawer_sessions`, `drawer_drops` and `pos_sale_events` in Supabase for a CSV.
- The per-drawer **Till summary** (Register Activity → **Cash drawer reports** → a session) also prints, with one **Manager (signature)** line (`registers/history/[id]/page.tsx` L80, L219). Use it when a single drawer needs a record (an exception, a disputed shortage).

---

## 5. Hard blocks and messages: "If you see this message"

| Where | Message (exact) | What it means | What to do |
|---|---|---|---|
| End-of-day page | **Supabase not configured** — *"Connect the service role key to build the end-of-day report."* (with only the worked example below) | The back office cannot reach the database (`eod/page.tsx` L48–56) | Do every paper step. Tell the owner. Print the report later with `?day=`. |
| End-of-day page | *(redirected to the admin home)* | Your login is not owner/admin/manager (L45) | A manager prints the report. |
| Banner | **Preliminary — a drawer is still open** | A drawer session that day is still open (`eod-core.ts` L133, L195) | Find and close it (SOP-01 §4.27; a manager can close from Register Activity). Do not seal a bag for a day that is not closed. |
| Sales | **⚠ Unresolved: exceptions / pending** | Sales were bounced to the exception queue or are still processing (L138–145) | Pending: wait and reload. Exceptions: SOP-01 §4.32. Totals are not final until this is gone. |
| Tills | **No drawer sessions on this business day.** | No drawer was opened, **or** the read failed silently (F-03-7) | If you know drawers were used, reload. Still empty → tell the owner; use the close slips. |
| Tills | **—** in **Over/short** | That drawer is not reconciled yet (`eod-core.ts` L139) | Reconcile (SOP-01 §4.30), then reprint. |
| Safe | *"Safe tracking not set up yet — run migration 0135_safe_counts_swaps.sql to include safe counts and change swaps on this report."* | The master till tables are missing (L213–215) | Owner runs the migration (SOP-02 §5). The deposit is unaffected. |
| Safe | **Not done** on AM or PM | No master till count of that kind that day, **or** the read failed for another reason (F-03-7) | SOP-02 §4.5–4.6. |
| Panel | Amber *"This figure could not be read…"* | The books could not be read (`UndepositedFunds.tsx` L39–49) | Ignore the panel; use the bag log. |
| Panel | Green *"Every dollar counted out of a drawer has been matched…"* | **Not reliable today** (F-03-1) | Use the bag log and the safe. |
| Panel | Rose *"More was banked than was counted, on …"* | The books say a day was cleared for more than it held (L128–151) | Owner/bookkeeper only. |
| Books (when built) | *"This bag has no id…"* | A seal without a bag number would be refused (`register-cash-journal-core.ts` L413–418) | Not reachable today. Always write the bag # on paper. |
| Books (when built) | *"Bag GW-7 was taken out of the drawer but never counted into the safe…"* | The code was designed to block the close while a bag is undeclared (`safe-bag-core.ts` L212–226; books-98 L29–35). **Owner decision D27: warning only, never block.** | Not reachable today (F-03-10). When built, it must warn, not block (G-04). |

---

## 6. Exceptions & escalation

| Situation | Do this | Tell |
|---|---|---|
| Night count ≠ expected deposit | Recount. Still off → write the difference and what you checked on part A. Do not adjust the cash. | Manager before leaving; owner next day |
| Morning recount ≠ night count | Do **not** seal. Recount with the manager. Fill part C. | Owner, same day |
| Bag found already **sealed** in the morning without a part B | Do not open. Note it on the bag log. | Manager; owner same day |
| Drop on a slip but not in the safe (or the reverse) | Stop. Search the safe, the drawer and the drop bag area. Write it up on part A. | Manager immediately; owner same day |
| Closing count below the float | Do not bag that drawer. Leave the drawer as is. | Manager immediately (SOP-01 §4.30) |
| Broken / re-taped seal on bank day | Do not bank. Open with a second person, recount, write it up, re-seal in a new bag (new #). | Owner immediately |
| Bag on the log not in the safe | Stop the bank run. Check every slot and the binder. | Owner immediately |
| End-of-day page will not load | Paper steps continue. | Owner |
| Out of tamper-evident numbered bags (or they have not arrived yet, D26) | Do not seal in a plain envelope. Keep the verified cash with its night sheet in the safe "TO VERIFY" slot and write "no bag" on the bag log. | Owner the same day (only the owner banks, D25) |
| A day's cash will not fit in one bag | Two consecutive-numbered bags, logged as one deposit (§4.11). | — |
| Someone suggests splitting or holding back cash because of $10,000 | Do not. Bank the whole day (§4.14). | Owner |

**Escalation order:** manager on duty → owner (Michael). Money missing, a broken seal, or a missing bag goes **straight to the owner**, the same day.

---

## 7. Controls & compliance (why the rules exist)

| Control | Why | Source |
|---|---|---|
| Night count by one person, morning recount by another | The owner's own design; a second, independent count is what turns a number into a fact. A shortage is caught in hours, not at the bank. | Owner request (L7); D2 (second count at close) |
| Both counts by denomination | Lets the two counts say *where* they disagree | This SOP; owner asked for a "spreadsheet" |
| Bag unsealed overnight, sealed only after the recount | You cannot recount a sealed bag without breaking the seal | Owner: recount *"before sealing the bag"* |
| Numbered bag, number on sheet, slip and log | The number is the only link between a sealed bag and the bank credit days later | `0212_deposit_bags.sql` L14–19, L52–55; `register-cash-journal-core.ts` L413–418 |
| One business day per bag, banked whole | Bank row = deposit slip = Z-report day: a one-to-one audit trail; and the $10,000 line never decides a split | `CASH_DEPOSIT_POLICY_DECISION.md` L66–92, L109–114 |
| Floats stay in drawers; master till never bagged | Keeps the $635.00 floats and $1,000.00 change fund fixed, so every bag is pure takings | D10, D19; SOP-02 §4.1 |
| Over/short is recorded, never "fixed" from the bag | A topped-up bag hides a shortage | Owner quote (`safe-bag-core.ts` L21–22); SOP-01 §4.30 |
| Cash stays on the licensed premises | Records and cash on premises; a house safe is effectively uninsured | `CASH_DEPOSIT_POLICY_DECISION.md` L116–120 |
| Paper filed five years | WAC 314-55-087 records retention | Footer L260; policy L116–121 |
| End-of-day report is manager-only | It shows closed counts and over/short, which the blind close hides from cashiers | `eod-core.ts` L14–16 |

**Known weaknesses this SOP works around** (all recorded, none fixed): no bag screen (F-00-6), the panel's false all-clear (F-03-1), unwired cash-to-bank books (F-03-3), the verify that records $0 (F-00-3), ~~no second count in the app (F-00-5/F-01-9)~~ (fixed in Phase 2.2: the app records the second count at close), a single-signature EOD print without the deposit figure (F-03-5), refunds missing from the EOD (F-03-6), silent read failures (F-03-7), no export (F-00-8).

---

## 8. Checklists & forms

### 8.1 Night sheet: end-of-day deposit count (the owner's "end of day spreadsheet")

```
GREENWAY — END-OF-DAY DEPOSIT SHEET            Business day: ____/____/______
================================================================================
PART A — NIGHT (one person, before close)    Prepared by: ______________  Time: ______

1. Where the money came from
   Till              Closing count   − Float left   = Takings
   Sales Register 1  ___________     − 167.50       = ___________
   Sales Register 2  ___________     − 167.50       = ___________
   Manager Till      ___________     − 300.00       = ___________
                                       TOTAL TAKINGS  ___________ (a)
   Drops today (time · register · amount · witness)
   ______________________________________________   TOTAL DROPS  ___________ (b)
                                     EXPECTED DEPOSIT (a)+(b)    ___________ (c)

2. What is actually here (count twice)                 PART B — MORNING RECOUNT
   $100 x ____ = ________                               $100 x ____ = ________
   $50  x ____ = ________                               $50  x ____ = ________
   $20  x ____ = ________                               $20  x ____ = ________
   $10  x ____ = ________                               $10  x ____ = ________
   $5   x ____ = ________                               $5   x ____ = ________
   $2   x ____ = ________                               $2   x ____ = ________
   $1   x ____ = ________                               $1   x ____ = ________
   $1c  x ____ = ________                               $1c  x ____ = ________
   Coin (25¢/10¢/5¢/1¢/50¢) ________                    Coin ________________
   COUNTED          ________ (d)                        RECOUNTED ________ (e)

   (d) − (c) = ________  If not 0: what was checked ______________________________
   Prepared by (signature): ____________________

PART B — MORNING (a DIFFERENT employee, before sealing)
   (e) = (d)?  [ ] Agrees   [ ] Does not agree → do NOT seal, Part C
   Bag # ____________ (+ ____________ if two bags)   Deposit slip amount: ________
   Sealed by (signature): ____________________   Time: ______

PART C — VARIANCE (only if B does not agree)
   Denominations that differ: ____________________________________________
   Recounted together by: ______________ and ______________  Result: ________
   Manager: ____________________   Owner told (time): ______
--------------------------------------------------------------- tear-off strip -
 Business day ____/____/____  Bag # ________  Amount ________  Sealed by ______
```

### 8.2 Deposit bag log (one line per bag; keep in the safe)

```
Business day | Bag # | Amount  | Sealed by | Sealed (time) | To bank (date · name) | Bank confirmed (date) | Receipt stapled? | Note (anything left behind and WHY)
2026-11-02   | 1041  | 1648.15 | J. Doe    | 09:12         | 2026-11-04 · M.L.     | 2026-11-04            | [x]              |
2026-11-03   | —     | —       | —         | —             | —                     | —                     | —                | NO SALES — no bag
```

### 8.3 Night closer checklist

- [ ] Every drawer closed blind, each with a signed close slip and second count (SOP-01 §4.27, form 8.2)
- [ ] Z report printed (SOP-01 §4.28)
- [ ] Floats left in drawers: $167.50 / $167.50 / $300.00
- [ ] Takings pulled; every drop bag accounted for against the slips
- [ ] Deposit counted by denomination, twice; night sheet part A signed
- [ ] Cash + sheet in a bag, **unsealed**, in the store safe "TO VERIFY" slot; safe locked
- [ ] Master till PM count done (SOP-02 §4.6)
- [ ] Manager told about any difference before leaving

### 8.4 Morning opener checklist

- [ ] Unsealed bag + night sheet taken out; I did **not** prepare part A
- [ ] Recounted by denomination, twice, without looking first; part B filled
- [ ] Agrees → slip filled → sealed → bag # on sheet, slip and bag log
- [ ] Sealed bag in "SEALED — TO BANK"; safe locked
- [ ] Doesn't agree → not sealed, part C, manager and owner told
- [ ] Master till AM count done (SOP-02 §4.5)

### 8.5 Manager end-of-day checklist (adds to SOP-01 form 8.6)

- [ ] Every drawer reconciled (Over/short shows a figure on the EOD report)
- [ ] EOD report banner **Final — all drawers closed**; no **⚠ Unresolved** line
- [ ] Cross-check: Σ(Closed count − float) + Drops total = night sheet (c)
- [ ] EOD printed, signed, stapled with night sheet, Z, close slips, forms 8.5, master till sheet; filed
- [ ] Morning: Verify till done (paper part B is the record; leave **Verified by** blank)
- [ ] Bag log up to date; days with no bag explained

### 8.6 Bank-run checklist (owner)

- [ ] Every sealed bag taken; bag numbers match the log; seals intact
- [ ] Nothing held back because of $10,000; if anything stayed, reason written at the time
- [ ] Bank receipt for each bag stapled to the log; **Bank confirmed** date written

---

## 9. Quick reference card

```
┌──────────────────────────── GREENWAY — END OF DAY & DEPOSIT BAG ────────────────────────────┐
│ NIGHT: close every drawer (blind + 2nd count) → Z report → leave floats 167.50/167.50/300   │
│   → pull takings + all drops → count by denomination TWICE → night sheet part A, sign       │
│   → cash + sheet in bag, UNSEALED → safe "TO VERIFY" → lock                                  │
│ DEPOSIT = all drops + Σ(closing count − float).  Master till, little safe, tips: NEVER.     │
│ MORNING (different person): recount BEFORE looking → agrees? sign B → slip → SEAL           │
│   → bag # on sheet + slip + bag log → safe "SEALED — TO BANK".  Disagree? DON'T seal.       │
│ BANK: take ALL sealed bags. ONE DAY = ONE BAG, banked WHOLE. $10,000 never decides a split. │
│ EOD REPORT: /admin/registers/eod  (old day: ?day=YYYY-MM-DD). Print after reconcile, sign.  │
│ ⚠ "Cash on its way to the bank" green box is NOT reliable — use the bag log.               │
│ ⚠ Verify till: leave "Verified by" blank; paper part B is the real verify.                 │
│ Missing money / broken seal / missing bag → OWNER, same day.                                 │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **Business day** | The Pacific-time calendar day (`pacificToday`; `eod-store.ts` L82–83). A drawer belongs to the day it was opened (`drawer_sessions.business_day`). |
| **Float** | The cash a till keeps overnight: $167.50 (sales registers), $300.00 (Manager Till) (D10, D19). |
| **Takings** | A till's closing count minus its float. |
| **Drop** | Cash taken from a drawer to the store safe during a shift (SOP-01 §4.25). |
| **Deposit** | All of a day's drops plus all of its takings. One bag. |
| **Night sheet** | Form 8.1. The owner's "end of day spreadsheet". |
| **Store safe** | The physical safe holding drops and bags. Not the master till (SOP-02 §1). |
| **Master till** | The $1,000 change fund; the app calls it "Store safe" / "Safe ($1,000 change fund)". Never in the deposit. |
| **Bag # / bag id** | The number printed on a tamper-evident deposit bag. |
| **Final / Preliminary** | EOD banner: all of the day's drawers closed / at least one still open. Not the same as reconciled. |
| **10100 Vault / 10400 Undeposited Funds / 10200 Bank** | Books accounts: cash in the safe / cash sealed in a bag on its way to the bank / the operating bank account (`register-cash-journal-core.ts` L70–75; `UndepositedFunds.tsx` L153–158). |
| **CTR** | Currency Transaction Report: the bank's routine filing for cash over $10,000 in a business day. Nothing to avoid. |
| **Structuring** | Shaping deposits *for the purpose of* avoiding a CTR. A crime regardless of the amounts (§4.14). |

---

## Appendix A: Source map (verified at `main@3385bfa9`)

| SOP section | Code / document (read for this SOP) |
|---|---|
| 1 purpose | `docs/sop-program/00-OWNER-REQUEST-VERBATIM.md` L7; `src/lib/accounting/safe-bag-core.ts` L15–25; `docs/MICHAEL-books-96-one-bag-one-day.md` L1–20 |
| 2 roles | `src/app/admin/registers/eod/page.tsx` L45; `src/lib/auth/roles.ts` L106; `src/app/admin/registers/page.tsx` L126–128; `src/app/admin/books/bank/page.tsx` L175 |
| 4.1 money | `drawer-posting-service.ts` L20–29, L170–194; `register-cash-journal-core.ts` L265–303; `0038` L178–184; `0077` L43–46; `sop03/calc.py`, `sop03/calc2.py` |
| 4.3 / 4.7 / 4.12 | `docs/sop/SOP-01-register-operations.md` §4.27–4.30, forms 8.2, 8.5, 8.6; `registers/page.tsx` L232–265 |
| 4.8 report | `eod/page.tsx` (268 lines) L15–19, L48–264; `src/lib/registers/eod-core.ts` (295) L80–201; `src/lib/registers/eod-store.ts` (234) L65–173; `src/lib/pos/day-report-core.ts` L40–70, L136–175 |
| 4.9 / 4.17 print | `eod/page.tsx` L74, L248–261; `registers/history/[id]/page.tsx` L49, L80, L217–227 |
| 4.11 bag model | `supabase/migrations/0212_deposit_bags.sql` (163) L1–30, L48–163; `safe-bag-core.ts` (501) L79–123, L163–260; `register-cash-journal-core.ts` L364–441; `ledger-census-data.ts` L1577–1636; `factory-reset-core.ts` L427–428 |
| 4.13 bank | `docs/CASH_DEPOSIT_POLICY_DECISION.md` (124) L109–124; `src/lib/accounting/deposit-clearing-service.ts` L1–60, L160–260; `deposit-clearing-core.ts` L4–14, L128–130, L390–490; `ledger-census-data.ts` L1519–1575; `books/bank/BankMatchExplainer.tsx` L719–722 |
| 4.14 $10,000 | `CASH_DEPOSIT_POLICY_DECISION.md` L9–73; `safe-bag-core.ts` L262–328; `books/bank/page.tsx` L495–515; `bank-match-core.ts` L1587, L1594; `docs/MICHAEL-books-98-the-store-safe.md` L43–60 |
| 4.15 panel | `src/app/admin/registers/eod/UndepositedFunds.tsx` (161) L1–161; `deposit-clearing-service.ts` L166–228; `register-cash-journal-core.ts` L294–303, L805–813 |
| 4.8 worked example | `src/app/admin/registers/eod/RegisterCashSpecimen.tsx` (190) L110–137; `src/lib/accounting/register-cash-specimen-core.ts` L30–60, L128–140 |
| Payment methods | `src/lib/pos/sale-event-core.ts` L15–33 (cash-only launch) |
| Help / concierge | `src/lib/admin/help-content.ts`, `src/lib/admin/concierge-kb.ts` (grep "eod\|end-of-day\|deposit" → payroll direct deposit only) |
| Tests | `tests/compliance/eod-core.test.ts` (4 cases), `safe-bag.test.ts` (18), `deposit-clearing.test.ts` (77), `journal-specimen.test.ts`; self-tests `eod-core.ts` L207–295 |

## Appendix B: Not built yet (interim paper procedures)

| Owner requirement / need | Today | Interim procedure in this SOP | Gap · finding |
|---|---|---|---|
| "End of day spreadsheet that one person completes before close" | EOD report prints the day; no deposit figure, no denomination count, one signature line | Night sheet form 8.1 part A (§4.5) | G-15 · F-03-5 |
| "Morning employee recounts and verifies" | Verify till records $0, no denominations, free-text name | Form 8.1 part B (§4.10); Verify till per SOP-01 with paper as record | G-04 · F-00-3, F-00-4 |
| "Before sealing the bag and putting it into the safe" | No bag screen; table + rules unreachable | §4.11, bag log form 8.2 | G-04 · F-00-6 |
| "For depositing to the bank" | No bank-run record; bank clearing unreachable; 10400 never filled | §4.13, form 8.2, bank receipts | G-14 · F-03-1, F-03-3 |
| Closing-day report "exported and printed" | Print only | §4.9, §4.17 | G-15 / G-09 · F-00-8 |
| Second-person count at till close (D2) | ~~Paper only~~ **Built (Phase 2.2):** second PIN and blind count at close, both stored | SOP-01 §4.27 steps 8–12, form 8.2 | G-01 · F-01-9 (FIXED) |
| $10,000 shape check | Built, no caller | Bag log **Note** column (§4.14) | G-14 · F-03-10 |
| Refunds on the EOD | Not shown (Z report has them) | Use the Z report for cash (§4.8) | G-15 · F-03-6 |

## Appendix C: Owner answers (were open questions)

All seven questions were answered by the owner after v1.0 (recorded verbatim in `00-OWNER-REQUEST-VERBATIM.md`, D21–D27).

| # | Question | Owner's answer (verbatim) | Decision / effect in this SOP |
|---|---|---|---|
| **Q-03-1** | Reason for **every** over/short, or only **over $5**? | *"only over $5"* | **D21.** Reason required only over $5.00 (§4.7; SOP-01 §4.30 and SOP-02 §4.8 updated). |
| **Q-03-2** | Does "300" mean the Manager Till, with sales tills at $167.50? | *"the manage float should be 300. The sales registers float should be 167.5"* | **D22** (confirms D19). Floats $635.00 in total (§3, §4.1). |
| **Q-03-3** | Does counted cash sit **unsealed in the safe** overnight? | *"yes, that is correct"* | **D23.** §4.6 confirmed. |
| **Q-03-4** | Second person at night, or is the morning recount the second count? | *"no second count at night, just the recount in the morning by any employee"* | **D24.** §2, §4.5 and §4.10 confirmed. |
| **Q-03-5** | Who seals, who banks? | *"anyone can seal the bag, I am the only one to take cash to the bank"* | **D25.** §2, §4.11, §4.13. |
| **Q-03-6** | Pre-numbered tamper-evident bags? | *"yes I plan on using tamper evident pre-numbered bags"* | **D26.** §3 confirmed. Until the bags arrive, see the §6 row "Out of tamper-evident numbered bags". |
| **Q-03-7** | Block a till close for an undeclared bag, or only warn? | *"warning only please"* | **D27.** G-04 requirement: warn, never block (§5). |

## Appendix D: Revision history

| Version | Date | Change | By |
|---|---|---|---|
| 1.0 draft | 2026-10-27 | First issue. Written from the code at `3385bfa9` (no code change since `0055f06c`), with owner decisions D2, D7, D10, D14–D20 and the cash deposit policy decision. Adds findings F-03-1…F-03-11 and gaps G-14, G-15 (G-04 updated). | SOP program (for owner review) |
| 1.1 draft | 2026-10-27 | Slice SOP-04. Owner answers D21–D27 applied: reason only over $5 (D21); floats confirmed (D22); unsealed overnight in the safe (D23); no second night count (D24); anyone seals, owner-only banking (D25); tamper-evident pre-numbered bags (D26); undeclared bag = warning only (D27). Appendix C now records the answers. Docs only; pins still at `3385bfa9`. | SOP program |
| 1.2 draft | 2026-10-27 | Slice SOP-05b. Living-SOP reminder added under the title (owner decision D41: update this SOP whenever a gap it names is built). No procedure changed. | SOP program (for owner review) |
| 1.3 draft | Fix phase | Phase 2.2 (G-01, owner D2). §2 roles table, §4.3 step 2, the known-weaknesses line and the Appendix B row now say the second count at till close is recorded in the app (SOP-01 §4.27 steps 8–12); the paper close slip is still signed. | Fix phase |
