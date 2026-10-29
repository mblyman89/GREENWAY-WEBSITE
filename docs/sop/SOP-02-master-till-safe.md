# SOP-02 — Master Till / Store Safe: Twice-Daily Counts, Change, Swaps & the Little Safe

| | |
|---|---|
| **Version** | 1.8 (draft for owner review; Phase 2.7c fixes G-11: a **supply run** (cash taken from the master till for supplies) is recorded on the new **Supply runs** screen with two PINs, settled with the receipt and the change by a different employee, and posted to the books; form 8.4 becomes the paper backup; Phase 2.7b fixes G-02: every **master till ↔ little safe exchange** is recorded on the Store safe page by denomination on both sides, by any employee with their PIN, and the two sides must be equal; the register's **change swap** now takes the bills both ways instead of one amount; both appear on the count history, the printable sheet and the export; Phase 2.7a fixes G-08, G-09 and G-13: the page shows the owner's standard mix and the difference under every box and says whether the mix is on standard; **any employee** records the count, and the counter proves who they are with their **PIN**; the window starts on the next count due; managers see the count history for any days, a printable **master till sheet** and CSV / Excel export; the end-of-day report says whether each count's mix was on standard; Phase 2.4 fix G-12: cash drops booked to the safe on the close entry; Phase 2.3 fix G-03: $5 reason rule on master till counts, Counted by required, owner's warnings screen; owner answers D14–D19 and D21–D22 applied; D41 living-SOP reminder) |
| **Effective** | On owner approval |
| **Owner** | Michael Lyman |
| **Applies to** | The morning and night employees who count and balance the master till; the managers who record the counts and approve change swaps; the owner, who reviews variances |
| **Verified against** | `main@0055f06c` (2026-10-27). Every label, message, number and rule below was read from the code or quoted from the owner. Nothing was written from memory. Arithmetic was checked by script (`sop02/calc.py`, `sop02/calc2.py`), not by hand. |
| **Program records** | Findings `F-02-*` in `docs/sop-program/03-FINDINGS-LEDGER.md` · Gaps in `docs/sop-program/05-GAP-REGISTER.md` · Owner decisions D3, D7, D10–D19 in `docs/sop-program/00-OWNER-REQUEST-VERBATIM.md` |

> **This SOP is a living document (owner decision D41).** The owner said: *"We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary."* When any gap this SOP names (Appendix B) is built, this SOP is updated in the same piece of work: the sections the gap names, Appendix B, Appendix D (a new revision row), the finding marked FIXED, and the concierge entry (charter §3 rules 9–10). Until then, the interim procedures in this SOP are the rule.

> **How to use this document.** Section 4 is the step-by-step manual. Section 4.1 explains where the money lives, so read it first. Section 5 lists every message the safe page and the register's swap screen can show, and what to do about each. Section 8 holds the paper forms. Section 9 is a one-page card to tape inside the safe door. Words in **bold** are the exact labels you will see on the screen.

---

## Table of contents

1. Purpose & scope
2. Roles & permissions
3. Before you start
4. Procedures
   - 4.1 Where the money lives: tills, master till, little safe, store safe
   - 4.2 The standard master till ($1,000.00, by denomination)
   - 4.3 Opening the Store safe page
   - 4.4 Reading the Store safe page
   - 4.5 The AM count (before open)
   - 4.6 The PM count (evening)
   - 4.7 Extra counts
   - 4.8 Reading the result: Balanced, Over, Short
   - 4.9 Checking the mix against the standard
   - 4.10 Balancing the master till with the little safe
   - 4.11 Register change swaps (the master till side)
   - 4.12 Drops and takings are NOT part of the master till
   - 4.13 Supply runs and petty cash
   - 4.14 The three till floats
   - 4.15 The safe section of the end-of-day report
   - 4.16 Reviewing recent counts and swaps
   - 4.17 A count was recorded wrong
   - 4.18 Printing and exporting (interim)
5. Hard blocks: "If you see this message"
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

**Purpose.** The master till is the store's change fund. The owner says it is **the one to watch**: it is shared, it is counted less often than a drawer, and it is the drawer people take cash out of (`docs/MICHAEL-books-98-the-store-safe.md` L64–80). This SOP makes sure that:

1. it is counted **twice every day**, once in the morning and once at night, and both counts are entered in the back office (owner: *"count twice a day, once in the morning, once at night"*);
2. it always holds **exactly $1,000.00** in the owner's standard mix of bills and coin (D11);
3. every exchange of big bills for small bills is logged by denomination (D3);
4. any difference is noticed, explained and reported the same day.

**In scope:**
- The back-office **Store safe** page (`/admin/registers/safe`).
- The master till's twice-daily counts.
- Balancing the master till with the little safe.
- Register change swaps, as seen from the master till side.
- The safe section of the end-of-day report.
- The till float amounts.

**Out of scope (separate SOPs):**
- Drawer count-in, drops, swaps at the register, blind close, reconcile and verify → **SOP-01** (§4.3, §4.25–4.30).
- Takings in the store safe, the end-of-day sheet, the morning recount and the deposit bag → **SOP-03**.
- The shop card (supplies are bought on the card, not with master till cash) → books SOPs (later slice).

**One word, two meanings.** The app calls the master till the **"Store safe"**. Its page title is **Store safe** and its subtitle is *"The master till: the change fund behind the registers — target $1,000.00, counted twice a day."* (`safe/page.tsx` L132–134). In the store, the **store safe** is also the box where drops and takings sit until the deposit (owner: *"167.50 is left in the register and the rest goes into the safe"*, quoted in `safe-bag-core.ts` L17–22). In this SOP:
- **master till** = the $1,000 change fund. This is what the **Store safe** page counts.
- **store safe** = the physical safe that holds drops and takings for the deposit (SOP-03).
- **little safe** = where spare small bills and coin are kept to rebuild the master till's mix (D3).

The code models one "safe" only, not three places. That is finding **F-02-7**.

---

## 2. Roles & permissions

| Task | Who | How the system checks |
|---|---|---|
| Physically count the master till (AM / PM) | The morning or night employee (owner: *"Either morning or night employee can balance the master till"*) | Not checked. The counting itself happens off-screen. |
| **Enter** the count on the Store safe page | **Any employee (D15).** Built in Phase 2.7a (gap G-13): any back-office login (owner, admin, manager **or staff**) can open the page and save a count | `requirePermission("orders.manage")` (`safe/page.tsx` L93, `safe/actions.ts` L71). `orders.manage` = owner/admin/manager/staff (`src/lib/auth/roles.ts` L95). |
| Prove who did the count (**Counted by**) | **The employee who counted**, with their own PIN | **PIN required** since Phase 2.7a: the box **Counted by: your PIN (required)** (`safe/page.tsx` L250). The server finds the **active** employee with that PIN and saves them as the counter; a blank, badly formed or unknown PIN is refused, and repeated wrong PINs lock the pad like the register's (`safe/actions.ts` L52–65, scope `backoffice-safe-count`). F-02-4 FIXED. |
| See the count history, the printable sheet and the export | Owner, admin, manager | `can(role, "inventory.manage")` on the page (`safe/page.tsx` L94, L280); `requirePermission("inventory.manage")` on the sheet (`safe/sheet/page.tsx` L73) and the export (`safe/export/route.ts` L36). A staff login sees a note instead of the history. |
| See the **Over / short warnings** screen | Owner, admin | Permission `registers.warnings` (owner, admin). Managers write reasons but do not see the list (Phase 2.3, G-03). |
| Balance the master till with the little safe, and **record the exchange** | Morning or night employee (any employee) | Built in Phase 2.7b (gap G-02): the **Little safe exchange** form on the Store safe page, open to every back-office login (`requirePermission("orders.manage")`, `safe/actions.ts` L153). The person who did the exchange types their own PIN; a blank, badly formed or unknown PIN is refused and repeated wrong PINs lock the pad (scope `backoffice-little-safe`, L164–173). Managers see the exchange log (`safe/page.tsx` L114, L467). |
| Approve a register change swap | An employee whose job role is **manager** or **lead**, and not the person doing the swap | Approver PIN checked on the server (`src/app/api/pos/till/route.ts` L55, L194–219) |
| See the end-of-day report | Owner, admin, manager | `requirePermission("inventory.manage")` (`eod/page.tsx` L80) |
| Read the counts straight from the database | Owner/admin/manager logins only | RLS `safe_counts_mgr_read` / `safe_swaps_mgr_read` → `public.is_manager()` (`0135_safe_counts_swaps.sql` L99–108, `0130` L55–61). No one can write through RLS. Every write goes through the app's server code. |

**Two kinds of role.** A back-office login has a *staff role* (owner, admin, manager, staff). An employee has a *job role* (sales, manager, lead, other). They are kept separate on purpose (D8). The Store safe page checks the **login's staff role**. The register swap checks the **approver's job role**.

> **Staff logins can now use the Safe button** (Phase 2.7a, finding F-02-10 FIXED for the safe page). On Register Activity, **Safe** (`registers/page.tsx` L135–137) opens the Store safe page for a *staff* login too. The staff login sees the cards and the **Count the safe** form, and a note that the count history, the printable sheet and the export are for managers (`safe/page.tsx` L280–284). The counter types their own PIN, so it does not matter whose login is open.

---

## 3. Before you start

1. **Know the standard mix by heart**, or keep form 8.1 in the safe (§4.2).
2. **Have form 8.1 (Master till count sheet)** and a pen. You count on paper first, then type the numbers in. Paper is the backup if the page is down. Since Phase 2.7a the page also shows the mix against the standard (§4.9), so the paper is a backup, not the only record of the mix.
3. **Know your PIN** (the same PIN as the register). Any back-office login can be open (Phase 2.7a, D15); the PIN says who counted.
4. **Count in a closed, camera-covered area**, with the master till only. Keep drop bags and takings away from the count (§4.12).
5. **Make sure the page works.** If it shows *"Safe tracking not set up yet"*, the database migration has not been run. Count on paper and tell the owner (§5).

---

## 4. Procedures

### 4.1 Where the money lives: tills, master till, little safe, store safe

| Place | How much | What it is for | Counted | Recorded in the app? |
|---|---|---|---|---|
| **Sales Register 1** till | $167.50 float (D10) | Customer sales | Count-in, blind close (SOP-01) | Yes: drawer sessions |
| **Sales Register 2** till | $167.50 float (D10) | Customer sales | Same | Yes |
| **Manager Till** (the manager register, D18) | **$300.00** float (D19, correcting D10). The system is seeded at $300.00 too (§4.14). | Shared by the two manager shifts | Same | Yes |
| **Master till** | **$1,000.00**, exact mix in §4.2 (D11) | The change fund. Gives the tills small bills and coin. | **Twice a day**, AM and PM | Yes: **Store safe** page, `safe_counts` table |
| **Little safe** | No set balance (D3) | Spare small bills and coin used to rebuild the master till's mix | Not counted (D3) | **Its exchanges, yes** (Phase 2.7b, G-02; F-00-7 FIXED): each exchange with the master till, both sides by denomination. Never a balance (D3). |
| **Store safe** | Whatever the day's drops and takings are | Holds drops and close takings until the deposit bag is sealed | SOP-03 | Drops: yes (drawer sessions). Bag: **no screen** (F-00-6). |

**Totals before a single sale** (script-checked, `sop03/calc.py`): 2 sales tills × $167.50 + Manager Till $300.00 = **$635.00**. Plus the master till, $1,000.00, that is **$1,635.00** of float in the building. ⚠ The system's worked example on the end-of-day page still uses 3 × $167.50 = $1,502.50 (`src/lib/accounting/register-cash-specimen-core.ts` L51, L138; `docs/MICHAEL-books-93-register-cash.md` L6–8). That was written from D10 before the D19 correction (finding **F-03-2**, SOP-03).

**How cash moves:**
```
                 change swap (equal value, manager/lead PIN)
   TILL  <──────────────────────────────────────────────>  MASTER TILL ($1,000)
     │                                                        ▲   │
     │ drops + close takings                     small bills  │   │ big bills
     ▼                                            & coin in   │   ▼ out
  STORE SAFE ──(SOP-03: count, bag, seal)──> BANK           LITTLE SAFE (no balance)
```
- A till keeps its float ($167.50 sales, $300.00 Manager Till) overnight. Only the takings leave it (owner, quoted in `safe-bag-core.ts` L17–22; the close posting assumes this, `floatStaysInDrawer: true`, `drawer-posting-service.ts` L191–194).
- The master till never gains or loses value. It only changes its **mix**. Swaps are equal on both sides.
- Supplies are bought on the shop card, not with master till cash (owner: *"I don't want to use the master till any more for petty cash"*, `card-payment-core.ts` L7–8). See §4.13.

> **Q-02-1 (resolved, D14).** The register's swap screen says *"Swap big bills for change with the safe"*. That "safe" is the $1,000 master till. Register swaps go **till ↔ master till**, and the master till then rebuilds its mix from the little safe. Owner: *"Q02-1- yes you have that correct."*

### 4.2 The standard master till ($1,000.00, by denomination)

This is the owner's standard (D11). The total is script-checked to exactly $1,000.00. The owner's earlier mix had 90 nickels and came to $999.50. It was corrected to 100 nickels (`docs/MICHAEL-books-93-register-cash.md` L9–10; DEFECTS.md "Arithmetic caught what eyes did not").

| Denomination | Standard count | Value |
|---|---:|---:|
| $100 | 0 | $0.00 |
| $50 | 0 | $0.00 |
| $20 | 0 | $0.00 |
| **$10** | **32** | **$320.00** |
| **$5** | **64** | **$320.00** |
| $2 | 0 | $0.00 |
| **$1** | **318** | **$318.00** |
| $1 coin | 0 | $0.00 |
| 50¢ | 0 | $0.00 |
| **25¢** | **95** | **$23.75** |
| **10¢** | **120** | **$12.00** |
| **5¢** | **100** | **$5.00** |
| **1¢** | **125** | **$1.25** |
| **Total** | | **$1,000.00** |

Bills = $958.00. Coin = $42.00.

**What "right" means.** The master till is right only when **both** of these are true:
1. the total is $1,000.00, **and**
2. every denomination matches the table.

A $20, $50 or $100 in the master till means a register swap brought in big bills that have not yet gone to the little safe (§4.10).

> **The page checks the total and the mix, apart (Phase 2.7a, G-08; F-02-3 FIXED).** **Balanced / Over / Short** is about the total only (`safe-core.ts` L84–95). The mix is a separate line: under every box the grid shows **Standard N** and **Diff ±N**, and a line **Mix vs standard (owner D11)** says **Mix on standard** or, for example, **Mix off: +10 × $20, −20 × $10** (`CountGrid.tsx` L89, L99, L140–142). That example totals $1,000.00, so it shows **Balanced** and **Mix off** together. The standard is one constant in the code, `MASTER_TILL_STANDARD` (`safe-core.ts` L42), shared with the end-of-day worked example.

**The till float, for comparison** (owner, `0077_drawer_counts_extra_denoms.sql` L27–36): 5 × $10, 10 × $5, 50 × $1, and one roll each of quarters (40 = $10.00), dimes (50 = $5.00), nickels (40 = $2.00) and pennies (50 = $0.50). Total $167.50.

### 4.3 Opening the Store safe page

1. Sign in to the back office with any login (owner, admin, manager or staff; §2).
2. Go to **Register Activity** (Employee group in the menu, `/admin/registers`). Register Activity itself needs the `orders.manage` permission (`admin-nav-data.ts` L112).
3. In the header buttons, tap **Safe** (`registers/page.tsx` L135–137).
4. The page opens with the breadcrumb **Sell › Register Activity › Safe** and the title **Store safe**. **← Register Activity** takes you back.

Direct address: `/admin/registers/safe`.

**Help on the page:** tap **How the safe works** (HelpPanel `registers-safe`, `safe/page.tsx` L141–180). It explains the twice-daily count, that counts are open (not blind), the standard mix (D11), swaps and the $5 rule. Since Phase 2.7a it says *"Drops and close takings are **not** master till money. They go to the store safe…"* (L158). The old sentence about drops waiting to be banked is gone (finding F-02-7, page-wording part FIXED).

### 4.4 Reading the Store safe page

From top to bottom (`safe/page.tsx` L130–515):

**Message banner** (after a save):
- Green: *"Safe counted — balanced on the $1,000 target."*, *"Safe counted — over the target by $X."* or *"Safe counted — short of the target by $X."*, then *"Counted by <name>."* and the mix: *"Mix on standard."* or *"Mix off standard: +10 × $20, −20 × $10."* (`safe/actions.ts` L129–136).
- Red: an error from §5.

**Four cards:**

| Card | Shows | Notes |
|---|---|---|
| **Target float** | $1,000.00, hint *"Store policy"* | Fixed in code (`SAFE_TARGET_MINOR = 100_000`, `safe-core.ts` L26). There is no setting to change it. |
| **Last count** | Total of the newest count, plus *"Balanced / Over $X / Short $X · time"*. *"No counts yet"* if none. | The newest count of any window |
| **Today's AM count** | **Done** / **Not yet**, hint *"Before open"* | Done if at least one AM count exists for today's Pacific business day (`safe-store.ts` `safeStatus` L276) |
| **Today's PM count** | **Done** / **Not yet**, hint *"Evening"* | Same, for PM |

**Count the safe** form: *"Count every denomination in the safe. The variance against the $1,000.00 target updates live as you type."*
- A grid of 13 boxes: **$100, $50, $20, $10, $5, $2, $1, $1 coin, 50¢, 25¢, 10¢, 5¢, 1¢** (`cash.ts` L36–50). Each box takes digits only. Anything else is removed as you type (`CountGrid.tsx` L75–80).
- Under every box: **Standard N** (the owner's D11 count) and a live **Diff ±N**, gold when it is not 0 (Phase 2.7a, `CountGrid.tsx` L89–99).
- **Safe total** (live sum), **Target: $1,000.00**, and a live **Balanced** / **Over by $X** / **Short by $X**. Below it, on its own line, **Mix vs standard (owner D11)**: **Mix on standard** or **Mix off: …** (L140–142).
- **Count window**: **AM (before open)** / **PM (evening)** / **Extra count**. Since Phase 2.7a it **starts on the next count due**: AM until today's AM is done, then PM, then Extra once both are done (`defaultCountWindow`, `master-till-core.ts` L123; `safe/page.tsx` L127, L241). Check it anyway.
- **Counted by: your PIN (required)**: the counter types their own PIN (Phase 2.7a, `safe/page.tsx` L250). There is no list to pick from any more.
- **Reason box** under the variance (Phase 2.3, G-03): *"Reason for over / short (optional at $5.00 or less)"*. As soon as the live variance is more than $5.00 either way it turns gold, *"Warning: more than $5.00 over. Reason (required)"* (or *short*), and the form will not submit while it is blank (`CountGrid.tsx` L147–168).
- **Notes (optional)**: up to 500 characters. The placeholder is *"e.g. 3 × $20 from swaps, not yet to the little safe"* (`safe/page.tsx` L263).
- **Record safe count** button. It greys out and says **Saving…** while the save runs, so a double tap cannot save twice (`safe/page.tsx` L265).

The sections below are shown to **owner, admin and manager** logins only. A staff login sees a note instead (`safe/page.tsx` L280–284).

**Count history** (Phase 2.7a, G-09): **From** / **To** day boxes and **Show** (the last 30 days by default, up to 366 days; `parseDayRange`, `master-till-core.ts` L131–153). Buttons: **Printable sheet (to)** opens the master till sheet for the **To** day (§4.18), and **CSV** / **Excel** export the whole range (`safe/page.tsx` L296–321). Columns **When / Window / Counted by / Total / Target / Variance / Mix / Reason / Notes**. **Mix** says **On standard** or **Off**; tap it to open a small table of **Standard / Counted / Diff** for every denomination (L325, L361). **Reason** shows the reason written with the count, or *"No reason"* for a count more than $5.00 off saved before Phase 2.3. If any record could not be read, a red box says *"This history may be incomplete."* and the CSV / Excel links are replaced by *"Export is off until every record reads."* (L287, L299, L302–304).

**Change swaps**: register swaps on the same days. Columns **When / Amount / Big bills in / Change out / Performed by / Approved by / Notes** (`safe/page.tsx` L438–439). Since Phase 2.7b the register sends the bills both ways (F-01-8 FIXED); a swap saved before that, or from an iPad not yet rebuilt, says *"not recorded (value only)"* (`little-safe-core.ts` L195).

**Little safe exchanges** (Phase 2.7b, G-02): every master till ↔ little safe exchange on the same days. Columns show the day and time, **OUT of master till → little safe**, **IN from little safe → master till**, the value of each side, who recorded it, and notes (`safe/page.tsx` L467–476). Before migration 0317 the section says *"Not set up yet: run migration 0317_little_safe_exchanges.sql. Until then use paper form 8.2 (SOP-02 §4.10)."* (L473).

### 4.5 The AM count (before open)

**When:** every morning, **before the store opens and before the first change swap**. Owner: *"once in the morning"*. Page hint: *"Before open"*.

1. **Get form 8.1.** Write the date, **AM**, your name and the time.
2. **Count the master till only**, one denomination at a time, in the order on the form ($100 down to 1¢). Count **pieces**, not dollars. Coin rolls: count the rolls and multiply (a quarter roll = 40, dime = 50, nickel = 40, penny = 50). Open any roll that looks short or tampered with.
3. **Write each count** in the **Counted** column. Write the difference from the **Standard** column.
4. **Total it** on the form.
5. **Recount any denomination that differs** from the standard. If the total is not $1,000.00, recount everything once more.
6. Open the **Store safe** page (§4.3).
7. In the grid, type **how many** of each denomination, not the dollar value. Leave empty boxes blank (blank = 0).
8. Check that **Safe total** matches your paper total. If it does not, you mistyped a box. Fix it before you continue.
9. **Check the mix line** under the total: **Mix on standard**, or **Mix off: …** with the denominations that differ. It must agree with your **Diff** column on form 8.1.
10. **Count window**: check it says **AM (before open)** (it starts there until today's AM is done).
11. **Counted by: your PIN (required)**: **the person who physically counted** types their own PIN. If someone else's login is open, that is fine; the PIN names the counter. The Security Log entry `safe.counted` names the count row, the counter (`counter_verified: "pin"`) and the mix.
12. **Reason**: if the grid says more than $5.00 over or short, recount first (§4.7). If it is still off, write **why** in the reason box (required, §4.8). **Notes**: anything else that is not standard, for example *"3×$20 from swaps, not yet to little safe"*.
13. Tap **Record safe count**. It shows **Saving…** until the green banner appears, which names you and says whether the mix is on standard.
14. Check that **Today's AM count** now says **Done**. A manager can see the row in **Count history**.
15. **Write the banner result on form 8.1**, sign it, and file it (§4.18).
16. If the mix is off, **balance with the little safe now** (§4.10), before open.

### 4.6 The PM count (evening)

**When:** every night, **after the last change swap of the day** (normally after the last drawer is closed). Owner: *"once at night"*. Page hint: *"Evening"*.

Follow §4.5 steps 1–16, with these changes:
- Step 10: check the window says **PM (evening)**. Once today's AM count is saved, the selector starts on **PM** (Phase 2.7a). If the AM count was missed, it still starts on **AM**: save the late AM first, or change it to PM yourself.
- Step 2: before counting, make sure every swap of the day has its line on form 8.3, and that every master till ↔ little safe exchange has its line on form 8.2.
- Step 16: rebuild the mix at night if you can, so the morning starts on the standard.
- **Compare the PM result with the AM result.** The value should be identical: swaps are equal value, and nothing else should touch the master till. Any change between AM and PM is a variance to explain (§4.8).

### 4.7 Extra counts

Choose **Extra count** for any count that is not the official AM or PM count:
- a recount after a variance (§4.8);
- a handover count when the master till changes hands mid-day;
- a spot check by the owner or a manager;
- a correction of a count entered wrong (§4.17).

Extra counts appear in **Count history** as **Extra**. The end-of-day report shows only how many there were (*"Extra counts"*), not their totals (§4.15).

### 4.8 Reading the result: Balanced, Over, Short

The page works out **variance = counted total − $1,000.00** on the server. The number you see on the grid while typing is only a preview. The saved figure is calculated again from your denominations (`safe-core.ts` L81–118).

| Result | What it means | What to do |
|---|---|---|
| **Balanced** | Total is exactly $1,000.00 | Still check the mix (§4.9). Done. |
| **Over by $X** | More than $1,000.00 | 1) Recount (Extra count). 2) Check form 8.3: was a swap entered with the wrong value, or did a till give more than it took? 3) Check form 8.2: did more go into the master till from the little safe than came out? 4) Look for takings or drop cash mixed in (§4.12). Pull any that are found, put them in the store safe, and recount. |
| **Short by $X** | Less than $1,000.00 | 1) Recount (Extra count). 2) Check forms 8.3 and 8.2 as above. 3) Check **Supply runs** for open runs (§4.13); the Store safe page shows how much is out. 4) Check the area and the drop slot. 5) Escalate (§6). |

**The $5 rule (D16; built in Phase 2.3, gap G-03).** The owner set a $5 threshold for over/short, with a required reason (D7), and confirmed it **applies to the master till as well** (*"Q02-3- yes, it applies to the master as well"*).
- **Any** non-zero variance: write the amount on form 8.1. Recount first (Extra count, §4.7).
- A variance **more than $5.00** after the recount: a reason is **required** in the reason box. The server works the variance out again from your denominations and refuses a blank reason: *"The master till is short by $X, more than $5.00. Write the reason (why it is over or short) and try again. Nothing was saved."* (`over-short-warning-core.ts` `checkOverShortReason` L54; called in `safe-store.ts` `recordSafeCount` L93). The refusal is in the Security Log (`safe.count_refused`).
- **$5.00 or less:** no reason is required (owner decision **D21**: *"Q-03-1- only over $5"*). The reason box is optional.
- A count more than $5.00 off is saved as a **warning** (never blocked). The banner adds *"Warning: more than $5.00. The reason is saved and the owner sees it on Over / short warnings."* The owner (and admin) see it on **Over / short warnings** (`/admin/registers/over-short`) with the window, Counted by, time, amount and reason; the Security Log gets `safe.over_short_warning`.
- Form 8.5 is needed only if migration 0315 is not applied (the banner then says the reason is in the Security Log only).

**Never "fix" a variance by moving cash** in from the little safe, a till or the store safe to make the total come out right. The difference must stay visible and be explained. The owner wants a genuine master till variance to be *"rare and therefore meaningful"* (books-98 L77–80).

> **The books do not see master till variances.** A drawer's over/short posts to 50920 Cash Over/(Short) at reconcile. A master till count posts nothing (F-02-6, books part still open). The count row with its reason (Phase 2.3) is the record.

### 4.9 Checking the mix against the standard

**The page does this since Phase 2.7a** (G-08, F-02-3 FIXED): **Standard** and **Diff** under every box, the **Mix vs standard** line, the mix in the banner, the **Mix** column in **Count history**, and the mix rows on the printable sheet. Read the page, and keep form 8.1 as the paper copy. For each denomination:
1. **Counted − Standard = difference.** Write it, with + or −.
2. The differences, each multiplied by the denomination's value, must add up to the total variance. If the total is $1,000.00, the plus and minus differences must cancel out exactly.
3. **Plus bills of $20 or more** → these are big bills from register swaps. Move them to the little safe (§4.10).
4. **Minus small bills or coin** → rebuild them from the little safe (§4.10).
5. If the mix cannot be rebuilt because the little safe has run out of a denomination, write it on form 8.1 and tell the owner (change order needed).

### 4.10 Balancing the master till with the little safe

**Owner:** *"Either morning or night employee can balance the master till using small bills from the little safe in exchange for big bills from the master."* And D3: *"I just want to know when big bills leave the master till and go into the little safe. And what the small bills and coin are that came out of the little safe."*

**Built in Phase 2.7b (gap G-02; finding F-00-7 FIXED).** Every exchange is recorded on the **Store safe** page, in the **Little safe exchange** box (`safe/page.tsx` L271–277). Any employee can do it with their own PIN. Form 8.2 is now the paper backup for when the page is down or migration 0317 has not been applied.

1. **Work out what to swap** from the mix line (§4.9) or form 8.1. Normally: big bills ($20, $50, $100) out of the master till, and the small bills and coin the master till is short of in from the little safe.
2. **Count the big bills out** of the master till. Type **how many of each** in the grid **OUT of master till → little safe** (for example 5 in **$20**) (`LittleSafeExchangeForm.tsx` L70).
3. **Count the small bills and coin out** of the little safe. Type how many of each in **IN from little safe → master till** (for example 10 in **$5**, 40 in **$1**, 40 in **25¢**) (L78). Coin is counted in pieces, not rolls: one roll of quarters is 40.
4. **The two sides must be equal.** The line under the grids says *"Both sides $X — equal."* or *"Not equal: OUT $X, IN $Y. Recount until both sides are the same value."* (L91–96). **Record exchange** stays grey until they are equal (L123). The server checks again (*"The two sides are not equal: … Nothing was saved."*, `little-safe-core.ts` L100–107), and so does the database (`0317_little_safe_exchanges.sql` L140–147). An unequal exchange is not a swap. (The system's swap rule says the same: it *"is a cash movement wearing a swap's clothes"* and is refused, `register-cash-journal-core.ts` L692–713.)
5. **Done by: your PIN (required)**. The person who did the exchange types their PIN. **Notes (optional)**, up to 500 characters, for example *"after PM count; second person initialled form 8.2"*.
6. Tap **Record exchange**. Green: *"Little safe exchange recorded by <name>: OUT of the master till 5 × $20; IN from the little safe 10 × $5, 40 × $1, 40 × 25¢; $100.00 each side."* (`safe/actions.ts` L204–210). It is in the Security Log as `safe.little_safe_exchange` with both sides and the name.
7. Put the big bills in the little safe and the small bills and coin in the master till.
8. **A saved exchange cannot be changed or deleted** (`0317` L160–171). If one was wrong, record the **reverse** exchange with a note saying which one it corrects.
7. If you just counted (AM or PM), you can record an **Extra count** after the exchange, with *"after little-safe balance"* in Notes, so the page shows the rebuilt state. The total should still be $1,000.00.

The little safe has **no balance and no target** (D3). The app records what moved in and out; it never adds those up into a balance. Do not count the little safe into the master till count.

### 4.11 Register change swaps (the master till side)

At the register, a cashier trades big bills for the same value in small bills and coin. That is SOP-01 §4.26. From the master till side:

1. The cashier opens **MORE ▾ → Change swap**. The screen is titled **Change swap with the safe** and says *"Swap big bills for change with the safe — the same value goes each way, so the drawer total does not move. Recorded under <name>'s PIN and approved by a manager or lead with theirs."* (`RegisterShell.tsx` L5673, L5799).
2. **Big bills to the safe (from this till)**: how many of each bill go to the master till. **Change back (from the master till)**: how many of each bill and coin come back (Phase 2.7b, F-01-8 FIXED; `RegisterShell.tsx` L5858–5859). Each grid shows its total. The line under them says *"Both sides $X — equal."* or *"Not equal yet: big bills $X, change $Y (…)"* (L5890–5896). The swap cannot be recorded until both sides are equal; the amount is the big-bills side.
3. **Manager or lead PIN (approval)** (L5899). The approver must be a different person (§5).
4. **Notes (optional)…**.
5. **Record swap of $X** (L6065). Success: *"$X change swap with the safe recorded."* (L5761). The server checks that both sides equal the amount (`little-safe-core.ts` L125–151) and saves the bills on the swap (`safe-store.ts` L166–210; `0317` L182–197) and in the Security Log (`till/route.ts` L245–247).

> **The iPad app must be rebuilt** to show the two grids. An iPad built before Phase 2.7b still shows **Amount swapped**; its swaps are still accepted and saved by value only, and show *"not recorded (value only)"* on the page, sheet and export. Until it is rebuilt, keep writing the bills on form 8.3.
6. The swap appears in **Recent change swaps** on the Store safe page, and is counted on the end-of-day report.

**The master till person's job during a swap:**
- Count the big bills **in** from the till, and count the small bills and coin **out** to the till, in front of the cashier.
- Make sure the two grids on the register match the bills you counted.
- Form 8.3 is now the paper backup (page down, or an iPad not yet rebuilt). SOP-01's form 8.3 is replaced by this SOP's form 8.3; see the note in §8.3.
- The master till's **value** does not change. Its **mix** now has big bills, which go to the little safe at the next balance (§4.10).

**Rules from the code:**
- The till must have an open drawer: *"No open drawer on this register."* (`till/route.ts` L140–143).
- A swap needs a connection (the PIN is checked on the server).
- A single swap over $2,000.00 is refused as a typo (`MAX_SWAP_MINOR`, `safe-core.ts` L32, L135–136).
- A swap creates **no journal entry**, by design (`buildBillSwapJournal`, `register-cash-journal-core.ts` L692–727).
- Do **not** use **No sale → Change fund swap with the safe** for a real swap. That only opens the drawer and records no amount or approver (SOP-01 §4.26).

### 4.12 Drops and takings are NOT part of the master till

- **Drops** during a shift and the **takings** at close go to the **store safe**, not the master till (owner: *"the rest goes into the safe"*; SOP-01 §4.25, §4.29).
- **Never** put drop bags or takings in the master till. **Never** count them in the AM or PM count.
- If you find takings mixed into the master till, take them out, put them in the store safe, write it on form 8.1 and in **Notes**, and tell the manager. Count the master till alone.

Why this matters:
1. The page's target is $1,000.00. Any takings in the count show as a false **Over**.
2. The page's own help text and placeholder suggest the opposite (*"drops waiting to be banked are the usual reason"*; *"e.g. two drops waiting to be banked"*). That is finding **F-02-7**. Greenway's rule is the one in this section.

> **For the owner and bookkeeper (finding F-02-1, S1) · FIXED in Phase 2.4 (G-12).** In the books, account 10100 "Cash on Hand — Vault" means *"the safe / master till"* (`register-cash-journal-core.ts` L71). Until Phase 2.4, mid-shift drops were never posted: the close relieved 10110 Tills only by *counted − float*, so every dollar dropped stayed in 10110 and 10100 was short by it. **Now the close entry books the drops too.** At Reconcile, the same entry (source ref `till-close:<session>`) debits 10100 with *takings at close + drops during the shift* (`toSafeMinor`, L301, L314–321) and relieves 10110 by that amount less any over/short (L329). The line reads *"Cash from Register 1 to safe (incl. $200.00 dropped during the shift)"* (L319). Worked example, checked by the builder self-test (L886–907): $167.50 float, $500.00 cash sales, a $200.00 drop, counted $467.50 → 10100 +$500.00, 10110 −$500.00, so 10110 nets to zero for the shift. A short dropped shift (counted $461.50) posts 10100 +$494.00, 50920 +$6.00, 10110 −$500.00 (L911–925). A shift whose takings were all dropped still posts the drops (L929–939). The poster already passes the drop total (`drawer-posting-service.ts` L174–194). **Back data:** drawers reconciled before this fix posted without their drops, and those entries are not changed (the source ref is idempotent, so they are never re-posted). Only drawers reconciled after this fix include drops. Staff need do nothing differently.

### 4.13 Supply runs and petty cash

**Store rule: supplies go on the shop card.** The owner moved supply buying to a low-limit shop card: *"I will go with the low limit credit card ... I don't want to use the master till any more for petty cash."* (`card-payment-core.ts` L7–8). In books-99 (L20–21): *"The master till stays at exactly $1,000, all day, every day."*

> **D17.** The owner asked for the supply-run screen (*"Q-02-4- id like the supply run screen built"*). It is built (Phase 2.7c, G-11). Cash for supplies is still the exception: the screen asks why the shop card was not used.

**Where:** Register Activity → **Supply runs** (the button shows *"(N open)"* when runs are open; `registers/page.tsx` L146–147). The page is `/admin/registers/supply-runs`; any back-office login can open it (`orders.manage`, `supply-runs/actions.ts` L71, L120, L182).

**Cash out (form 8.4 top half), in the panel *"Cash out of the master till (two PINs)"*** (`supply-runs/page.tsx` L164):
1. **Cash taken ($, up to $1,000.00)**: the amount. More than the whole master till is refused (`supply-run-core.ts` L55, L135–139).
2. **Why not the shop card (required)**: up to 500 characters. Blank is refused: *"Write why the shop card was not used. The store rule is the shop card (SOP-02 §4.13), so a cash run needs a reason. Nothing was saved."* (L142–146).
3. **PIN of the person taking the cash**.
4. **Manager or lead PIN (approves; not the taker)**. A sales PIN is refused (*"… is not a manager or lead. Cash out of the master till needs a manager or lead to approve it. Nothing was saved."*), and so is the taker approving their own run (L153–164). This is the same approver rule as a register safe swap (`till/route.ts` L56).
5. Press **Record cash out**. Green: *"$X out of the master till with <name>, approved by <name>. Bring back the receipt and the change, and settle it here (SOP-02 §4.13)."* then the books result (`supply-runs/actions.ts` L110–114).

The books: DR **12100 Employee Advances Receivable** / CR **10100 Vault**, dated on the business day (`postAdvanceForRun`, `supply-run-posting-service.ts` L73). It is **not** an expense yet, because nothing has been bought (books-98).

**Settle (form 8.4 bottom half)**, under **Open supply runs**, on that run:
1. Put the receipt and the change **into the master till envelope, never into a drawer**. A receipt is *"evidence, not cash"*, so the till really is short until then (books-98 L84–85).
2. **Receipt total ($)** and **Change handed back ($)**. 0.00 if nothing was bought, or no change. **Receipt + change must equal the cash taken.** If not: *"Receipt $A + change $B = $C, but $D was taken ($E is missing). Recount the change and check the receipt. … Nothing was saved."* (`supply-run-core.ts` L208–217).
3. A receipt bigger than the cash taken is refused: that is *"a reimbursement owed TO the employee, not a settlement; give the receipt to the owner to pay as a bill"* (L198–206).
4. **What the receipt was for** (required when the receipt is more than $0.00): 76020 Packaging & Store Supplies, 76010 Office Supplies, 70060 Janitorial & Waste Removal, 70030 Repairs & Maintenance, 77010 Fuel, or 76030 Postage & Shipping (outbound). These are the chart's accounts, all 280E non-deductible (`supply-run-core.ts` L76–95; `0173_chart_of_accounts.sql` L671–723). The chart's own 76020 caution is shown under the form: packaging that becomes part of the product sold goes to inventory, not here.
5. **Note (optional)**: store name, what was bought.
6. **PIN of who counted the change (not the taker)**: a different employee (form 8.4 has two signatures, taker and receiver). The taker's PIN is refused (L225–230).
7. Press **Settle $X**. Green: *"Settled: receipt $A (code name), change $B back in the master till, received by <name>. Give the receipt to the owner the same day."* then the books result (`supply-runs/actions.ts` L172–176). **Give the receipt to the owner the same day.**

The books: DR the expense account (receipt, with its 280E cost class) / DR **10100** (change) / CR **12100** (the cash taken), dated on the settle day (`postSettleForRun`, `supply-run-posting-service.ts` L127). 12100 is back to zero for that run. The settle is never posted before the cash out is (*ADVANCE_NOT_POSTED*, L144).

**NOT POSTED.** If the books entry fails, the record is still kept and the run shows **Cash out NOT POSTED** or **NOT POSTED** with a **Post to the books** button. Press it; it is safe to press again (`supply-advance:<id>` / `supply-settle:<id>`; nothing is booked twice).

**The master till counts short by every open run.** That is correct. The Store safe page says so: *"N supply run(s) is/are open: $X is out of the master till with an employee/employees. The master till counts short by that until the receipt and change come back (SOP-02 §4.13)."* (`supply-run-core.ts` L299; `safe/page.tsx` L123, L201). At a count, write *"supply run open"* in **Notes** if the shortfall is the open run.

**The log.** **Supply-run log** lists every open run and the last 30 days (who took it, who approved, out, why, receipt, change, what for, received by, books), with **Print** and an owner line *"Checked by (owner)"* (`supply-runs/page.tsx` L262–340). Runs cannot be deleted or changed after the fact; a settle is saved once (migration `0318_supply_runs.sql`).

**Paper backup: form 8.4.** Use it only if the page is down or migration 0318 is not applied yet (the page then says *"Supply-run screen not set up yet"*). Enter the run on the screen when it is back.

### 4.14 The three till floats

**Owner (D10, corrected by D19):** *"there are three tills, two sales and one manager register. They are the ones with 167.5 in them."* Then: *"And I was wrong, it should be 300 in it."* The Manager Till holds **$300.00**.

| Register (system name) | Owner's float | System's standard float | Source |
|---|---:|---:|---|
| **Sales Register 1** | $167.50 | $167.50 | seed `0038` L182; corrected by `0077` L43–46 |
| **Sales Register 2** | $167.50 | $167.50 | same |
| **Manager Till** | **$300.00** (D19) | $300.00 ✅ | seed `0038` L178, L184. `0077` L40 left it: *"the shared Manager Till float is left as-is (owner has not specified a change)"*. |

**What this means for staff:** the system and the owner agree. When a manager opens the Manager Till from the back office, the **Open drawer** panel says *"Standard float for this register is $300.00"* and compares the count to it (`RegisterControls.tsx` L63–75). That is correct. Finding F-02-2 is **withdrawn** (D19).
- The register app itself does not compare the count-in to any standard (F-01-13). Whatever is counted is the opening float.
- Nothing in the app edits a register's float (`default_float_minor` is only read, `oversight.ts` L316). Correcting it is a database change for the build phase.
- These figures come from the migration files. The live database value was **not** read for this SOP (no production access in this slice). The owner can check it in Supabase: `select name, default_float_minor from registers;`.

A till's float never comes from the master till on an ordinary day. It stays in the drawer overnight (§4.1). If a till's float is short at count-in, **do not top it up from the master till**. Report it (SOP-01 §4.3).

### 4.15 The safe section of the end-of-day report

**End-of-day report** (`/admin/registers/eod`, Register Activity → **End-of-day report**) has a section **Safe ($1,000 change fund)** (`eod/page.tsx` L432–475):

| Line | Shows | Source |
|---|---|---|
| **AM count** | Total · **Balanced** / **Over by $X** / **Short by $X** · **mix on standard: yes / no** (Phase 2.7a), or **Not done** | The **newest** AM count for that business day (`eod/page.tsx` L445; mix from `eod-store.ts` L173, L186) |
| **PM count** | Same, for PM | Newest PM count (L451) |
| **Extra counts** | How many (only shown if there is at least one) | L184 |
| **Change swaps (value-neutral)** | *"N · $total"* or **None** | Swaps on that Pacific day (`eod-store.ts` L197–210) |

Under the lines, **Master till sheet for this day** opens the printable sheet for the same day (§4.18; `eod/page.tsx` L472, hidden when printing).

If the database migration has not run: *"Safe tracking not set up yet — run migration 0135_safe_counts_swaps.sql to include safe counts and change swaps on this report."*

**Know this when you read it:**
- If two AM counts were saved, the report shows **only the newest**. An earlier count, even a bad one, is not shown (F-02-5). The master till sheet for the day shows every count.
- Extra count totals are not on the report. Only how many there were. They are on the master till sheet.
- The report prints (**Print**) and exports to CSV / Excel (Phase 2.6b, `eod/page.tsx` L122–134).
- Close-of-day steps → SOP-03.

### 4.16 Reviewing recent counts and swaps

Daily (manager) and weekly (owner), on the Store safe page (manager logins):
1. **Count history:** set **From** / **To** (the last 30 days by default). Two counts per day (AM + PM), each with a **Counted by** name. Look for **—** (no name, counts before Phase 2.3); days with a missing AM or PM; several AM or PM counts on one day; any **Over** or **Short** without a reason; and any **Mix: Off** that was not rebuilt by the next count.
2. **Pattern, not day.** The owner: small differences in both directions mean little, while the same person or shift showing the same rough amount again and again means something (books-98 L66–72).
3. **Change swaps:** every swap has an **Approved by** name and, since Phase 2.7b, the bills both ways. A swap showing *"not recorded (value only)"* after the iPad was rebuilt needs a matching line on form 8.3.
4. **Little safe exchanges** (Phase 2.7b): every **Mix off** count should be followed by an exchange before the next count; each exchange has a name and equal sides. There is no little-safe balance to check (D3).
5. Any range up to 366 days can be shown (Phase 2.7a; exchanges `listLittleSafeExchangesRange`, `safe-store.ts` L257, Phase 2.7b; `listSafeCountsRange` / `listSwapsRange`, `safe-store.ts` L196, L231, read in pages so nothing is cut off). The old 30-row cap is gone. For a file, use **CSV** / **Excel** (§4.18).

### 4.17 A count was recorded wrong

Saved counts **cannot be edited or deleted** in the app (there is no update or delete path for `safe_counts`; humans have no write policy, `0135` L95–108). This is a good control.

To correct a wrong count:
1. Do **not** try to "overwrite" it by saving another AM or PM count. That hides the first one from the end-of-day report (F-02-5) and looks like a cover-up. (The master till sheet and Count history still show both.)
2. Recount. Save it as **Extra count**, with Notes: *"CORRECTION of <AM/PM> count at <time>: <what was wrong, e.g. typed 31 tens as 13>. Correct total $X."*
3. Write the correction on that day's form 8.1 and sign it.
4. If the wrong count was the **only** AM or PM count of the day, the end-of-day report still shows the wrong figure. Attach the corrected form 8.1 to the end-of-day printout.

### 4.18 Printing and exporting

**Built in Phase 2.7a (gap G-09; finding F-00-8, safe part FIXED).** The owner asked for the master till sheet to be *"exportable and printable"*. Both are for owner, admin and manager logins.

**The printable master till sheet** (`/admin/registers/safe/sheet?day=YYYY-MM-DD`; **Printable sheet (to)** on the Store safe page, or **Master till sheet for this day** on the end-of-day report). One page per day (`safe/sheet/page.tsx`):
- The denominations as rows, with a **Standard (D11)** column and, for every count that day (AM, PM and Extra, in that order), **Counted** and **Diff**.
- Rows **Total**, **Over / short**, **Mix** and **Counted by**, then the reason and notes of each count.
- The day's change swaps with the bills both ways (**Big bills IN from till**, **Change OUT to till**, L298–299) and a total.
- **Master till ↔ little safe exchanges** for the day, both sides and a total (Phase 2.7b, L326–332). Before migration 0317: *"The exchange log is not set up yet: run migration 0317_little_safe_exchanges.sql. Attach paper form 8.2 (SOP-02 §4.10) for this day."* (L329).
- Signature lines: **AM counter — signature**, **PM counter — signature**, **Manager review — signature** (L321–323).
- A **Print** button and CSV / Excel links for that day.
- If any record could not be read: *"⚠ This sheet may be incomplete. Do not file it."* (L167). Reload; if it stays, tell the owner and use form 8.1.
- A day that is not a real date is refused: *"That day could not be read"*, *"… Nothing is shown in its place."* (L95).

**CSV / Excel export** (`/admin/registers/safe/export?from=…&to=…&format=csv|xlsx`, `safe/export/route.ts`): file `master-till-<from>-to-<to>`, sheet **Counts** (first row **Standard (D11)**, then one row per count with every denomination, total, variance, **Mix vs standard**, Counted by, reason, notes) sheet **Swaps** (with **Big bills IN from till → master till** and **Change OUT master till → till**, and a total) and sheet **Exchanges** (Phase 2.7b; both sides, value, recorded by, a total) (`safeSheetWorkbook` L277, `exchangesSheet` L363, `master-till-core.ts`). A partial file is **never** exported: if any record could not be read the export is refused (*"… is not exported because some records could not be read: …"*, L50).

Filing: print the day's sheet after the PM count, have it signed, and keep it with the end-of-day printout (SOP-03). Attach form 8.2 / 8.3 only for exchanges or swaps that could not be recorded in the app. Form 8.1 stays the backup when the page is down.

---

## 5. Hard blocks: "If you see this message"

### 5.1 Store safe page (back office)

| Message (exact) | Type | Why | What to do | Who |
|---|---|---|---|---|
| *"Pick a count window (morning, evening, or other)."* | BLOCK | The window value was missing or not am/pm/other (`safe-core.ts` L93) | Choose **AM**, **PM** or **Extra count** and save again | — |
| *"Count at least one bill or coin — an empty safe count records nothing."* | BLOCK | Every box was blank or 0 (L76) | Enter the counts | — |
| *"Notes must be 500 characters or fewer."* | BLOCK | Notes too long (L81). The box stops at 500 anyway. | Shorten it. Put details on form 8.1. | — |
| *"The safe tables aren't set up yet — run migration 0135_safe_counts_swaps.sql in the Supabase SQL editor."* | BLOCK | Database migration not run (`safe-store.ts` L28–29) | Count on paper. Tell the owner. | Owner |
| *"Safe tracking not set up yet"* (empty page) | BLOCK | Same (`safe/page.tsx` L196). Register swaps will also refuse. | Same | Owner |
| *"Supabase not configured"* / *"Connect the service role key to manage the safe."* | BLOCK | Server not connected to the database (L101) | Paper. Tell the owner. | Owner |
| *"Database not configured."* | BLOCK | Same, at save (`safe-store.ts` L110) | Same | Owner |
| *"This history may be incomplete."* (red box, manager view) | WARN | A page of counts or swaps could not be read (`safe/page.tsx` L323–325). CSV / Excel are hidden. | Reload. If it stays, tell the owner. | Owner |
| *"The master till sheet for <from> to <to> is not exported because some records could not be read: …"* | BLOCK (export) | Same, on export (`safe/export/route.ts` L54). No partial file is made. | Same | Owner |
| *"⚠ This sheet may be incomplete. Do not file it."* | WARN (sheet) | Same, on the printable sheet (`safe/sheet/page.tsx` L172) | Do not file it. Reload; use form 8.1 if it stays. | Owner |
| Sent to the admin home (`/admin?denied=1`) from the sheet or the export | BLOCK | A staff login opened the sheet or export address (they need `inventory.manage`, `safe/sheet/page.tsx` L73, `safe/export/route.ts` L36) | Ask a manager to print it | Manager |
| Any other red database message | BLOCK | Unexpected database error (the raw message is shown) | Do not retry more than once. Paper. Screenshot it for the owner. | Owner |
| *"Enter your PIN (the employee who counted the master till). Nothing was saved."* | BLOCK | The PIN box was blank (Phase 2.7a; `safe/actions.ts` L54) | The counter types their PIN | — |
| *"A PIN is 4–6 digits. Nothing was saved."* | BLOCK | Not 4–6 digits (L45) | Re-enter | — |
| *"No active employee has that PIN. Counted by must be an active employee. Nothing was saved."* | BLOCK | Wrong PIN, or the employee is not active (L48–52). Counts toward the PIN lockout. | Re-enter carefully. If it is right and still refused, tell a manager (the employee may be inactive). | Manager |
| *"Too many wrong PINs — the PIN pad is locked for N more seconds."* | BLOCK | Too many wrong PINs on the safe count pad (`pinPadBlocked`, L46–47; message `pin-throttle-core.ts` L77) | Wait, then try again. Do not guess PINs. | Manager |
| *"The master till is over/short by $X, more than $5.00. Write the reason (why it is over or short) and try again. Nothing was saved."* | BLOCK (reason only) | More than $5.00 off with a blank reason (§4.8) | Recount; if still off, write the reason | Manager |
| *"… Warning: more than $5.00. The reason is saved and the owner sees it on Over / short warnings."* | WARN (saved) | Saved with a reason; on the owner's screen | Nothing more (form 8.5 no longer needed) | Owner |
| *"Safe counted — over the target by $X."* | WARN (saved) | The total is above $1,000.00 | §4.8 | Manager |
| *"Safe counted — short of the target by $X."* | WARN (saved) | The total is below $1,000.00 | §4.8 | Manager → owner |
| *"Safe counted — balanced on the $1,000 target. Counted by <name>. Mix on standard."* | OK | Total is $1,000.00 and every denomination matches the standard | Nothing more | — |
| *"… Mix off standard: +10 × $20, −20 × $10."* | WARN (saved) | The mix differs from the standard (the total can still be Balanced) | Balance with the little safe (§4.10) | — |

### 5.2 Register change swap (seen at the register)

| Message (exact) | Type | Why | What to do |
|---|---|---|---|
| *"A manager or lead must approve the swap with their PIN."* | BLOCK | No approver PIN entered (`till-core.ts` L249) | Get a manager or lead |
| *"Approver PIN must be 4–6 digits."* | BLOCK | PIN format (`till/route.ts` L197) | Re-enter |
| *"No active employee for the approver PIN."* | BLOCK | Wrong PIN, or the employee is inactive. Counts toward PIN lockout (L193–194). | Re-enter carefully |
| *"<name> is not a manager or lead — safe swaps need a manager PIN."* | BLOCK | The approver's job role is sales/other (L197–201) | Get a manager or lead |
| *"A swap cannot approve itself — a manager or lead must enter their PIN."* | BLOCK | Approver = cashier (L203–207) | A different person approves |
| *"Swap amount must be a positive whole number of cents."* | BLOCK | Amount 0, negative or not whole cents (`safe-core.ts` L132) | Enter the bills both ways |
| *"Enter the bills both ways: the big bills going to the safe and the change coming back."* | BLOCK | Only one side was sent (Phase 2.7b, `little-safe-core.ts` L133) | Fill in both grids |
| *"The big bills to the safe add up to $X, not the swap amount $Y."* / *"The change back adds up to $X, but the big bills are $Y. A swap must be the same value both ways."* | BLOCK | The bills do not equal the amount (L142, L147). The screen normally stops this first. | Recount both sides |
| *"Swap amount is implausibly large — check the number."* | BLOCK | Over $2,000.00 (L113) | Check. Very large swaps are not normal. |
| *"No open drawer on this register."* | BLOCK | No drawer counted in (`till/route.ts` L140–143) | Count in first (SOP-01 §4.3) |
| *"Offline — drawer actions need a connection to verify your PIN and record the cash."* | BLOCK | No connection | Wait for the connection. Do not swap off the record. |
| The migration message above (as the swap error) | BLOCK | Safe tables missing. The swap is refused, not skipped (`safe-store.ts` L197–208). | Tell the owner. No swaps until fixed. |
| *"$X change swap with the safe recorded."* | OK | Saved, with the bills both ways | Nothing more (form 8.3 only for an iPad not yet rebuilt) |

### 5.3 Little safe exchange (Store safe page, Phase 2.7b)

| Message (exact) | Type | Why | What to do | Who |
|---|---|---|---|---|
| *"Not equal: OUT $X, IN $Y. Recount until both sides are the same value."* (and **Record exchange** grey) | BLOCK (screen) | The two grids are not the same value (`LittleSafeExchangeForm.tsx` L96) | Recount both sides | — |
| *"Enter the big bills OUT of the master till (into the little safe), by denomination. Nothing was saved."* / *"Enter the small bills and coin IN from the little safe (into the master till), by denomination. Nothing was saved."* | BLOCK | One side was empty (`little-safe-core.ts` L95, L98) | Fill in both sides | — |
| *"The two sides are not equal: OUT of the master till $X, IN from the little safe $Y (OUT is $Z more). An exchange must be the same value both ways. Recount both sides. Nothing was saved."* | BLOCK | Unequal sides reached the server (L100–107) | Recount | — |
| *"OUT of the master till: $5: \"2.5\" is not a whole number of pieces. Nothing was saved."* (or *IN from the little safe: …*) | BLOCK | A box held something other than a whole number (L54; `safe/actions.ts` L155–157) | Type whole pieces (a roll of quarters is 40) | — |
| *"$X is more than $2,000.00 for one exchange. Check the counts. Nothing was saved."* | BLOCK | Over the swap cap (`little-safe-core.ts` L110) | Check the counts; split a genuine large exchange | Manager |
| *"Enter your PIN (the employee who did the exchange). Nothing was saved."* | BLOCK | PIN blank (`safe/actions.ts` L165) | Type your PIN | — |
| *"A PIN is 4–6 digits. Nothing was saved."* | BLOCK | PIN format (L166) | Re-enter | — |
| *"No active employee has that PIN. The exchange must be recorded by an active employee. Nothing was saved."* | BLOCK | Wrong PIN or inactive employee; counts toward the lockout (L170–173) | Re-enter carefully; else tell a manager | Manager |
| *"Too many wrong PINs — the PIN pad is locked for N more seconds."* | BLOCK | Lockout on the exchange pad (scope `backoffice-little-safe`) | Wait. Do not guess PINs. | Manager |
| *"The little safe exchange log is not set up yet — run migration 0317_little_safe_exchanges.sql in the Supabase SQL editor. Nothing was saved; use paper form 8.2 (SOP-02 §4.10) until then."* | BLOCK | Migration 0317 not applied (`safe-store.ts` L79–80) | Use form 8.2. Tell the owner. | Owner |
| *"The database refused it: the two sides are not the same value. Recount both sides. Nothing was saved."* | BLOCK | The database's own equality check (`safe-store.ts` L244–246) | Recount | — |
| *"Little safe exchange recorded by <name>: OUT of the master till …; IN from the little safe …; $X each side."* | OK | Saved and in the Security Log | Put the bills away | — |

---

## 6. Exceptions & escalation

| Situation | Immediate action | Escalate to |
|---|---|---|
| Master till short, still short after a recount | Stop all swaps. Recount with a second person. Check open **Supply runs** and the exchange / swap logs (forms 8.2/8.3/8.4 if paper was used). Save as **Extra count** with notes. Fill in form 8.5. | Manager → owner, same day |
| Master till over, still over after a recount | Look for takings mixed in (§4.12). Check form 8.3 values. Form 8.5. | Manager → owner, same day |
| Total right, mix wrong | Balance with the little safe (§4.10) | — (owner if the little safe is out of a denomination) |
| AM or PM count missed | Count as soon as noticed. Save as **Extra count** with *"late AM/PM count"* in Notes, or as the window if it is still that day. | Manager |
| Wrong count saved | §4.17 | Manager |
| Cash taken for supplies | §4.13: **Supply runs** screen (two PINs); settle with the receipt and change. Form 8.4 only if the page is down | Owner gets the receipt, same day |
| Register swap without a form 8.3 line | Reconstruct with the cashier and approver now | Manager |
| Unequal "swap" | Stop. It is not a swap. Recount both sides. | Manager → owner |
| Page down / database message | Paper only. Enter later as **Extra count**, with the real time in Notes. | Owner |
| Signs of tampering (torn rolls, bundles light) | Do not continue. Photograph it. Second person present. | Owner |
| Robbery | Comply. Do not resist. Call 911 when safe. | Owner (security SOP) |

---

## 7. Controls & compliance (why the rules exist)

| Control | How it works today | Strength | Finding / gap |
|---|---|---|---|
| Twice-daily count | AM and PM windows; cards show **Done / Not yet**; the window starts on the next count due (Phase 2.7a) | Exists (D12 met) | F-02-5 default-window part FIXED |
| Total calculated by the server | Total and variance are worked out from the denominations on the server, never taken from the form (`safe-core.ts` L81–118) | Strong | — |
| Target recorded with each count | `expected_minor` is saved per row, so old rows stay true if the target ever changes (`0135` L54–56) | Strong | — |
| Counts cannot be changed | No edit or delete; no human write policy (`0135` L95–108) | Strong | — |
| Who counted | The counter's own **PIN**, checked on the server against active employees, with the PIN lockout (Phase 2.7a) | **Strong** | F-02-4 FIXED, G-13 BUILT |
| Who may record | Any back-office login (D15); history, sheet and export for managers | As decided (D15) | F-02-10 FIXED for the safe page |
| Who entered | The audit log records the login and names the count row, the counter, `counter_verified: "pin"` and the mix (`safe.counted`, `entityId` = the count, `safe/actions.ts` L99–110) | **Good** | F-02-4 FIXED |
| One official AM/PM per day | Not enforced. Any number allowed; the report uses the newest. A double tap no longer saves twice (the button locks while saving), and the sheet shows every count. | **Partial** | F-02-5 (one-per-window part open) |
| Mix (denomination) standard | Standard and Diff per box, a mix line apart from the total, mix in the banner, history, sheet, export and end-of-day report (Phase 2.7a) | **Good** | F-02-3 FIXED, G-08 BUILT |
| Variance reason / threshold | $5.00 threshold; reason required over $5.00 (server-checked), optional at $5.00 or less; warning on the owner's screen (Phase 2.3) | **Good** | F-02-6 (threshold and reason FIXED), D7 + D16 + D21 |
| Variance in the books | Not posted | Missing | F-02-6 |
| Open (not blind) count | By design: *"the target is known policy"* (`safe-core.ts` L7–10, help text). Drawers are blind, the master till is not. | Design choice | Because the count is open, the counter's name (F-02-4) and a second counter matter more |
| Register swap approval | Manager/lead PIN, different person, checked on the server, `safe.swap` audit tied to the drawer session (`till/route.ts` L193–250); the bills both ways, checked equal to the amount by the server and the database (Phase 2.7b) | Strong | F-01-8 FIXED (iPad rebuild needed) |
| Little safe exchange | Recorded by denomination both sides, any employee with PIN and lockout, equal sides enforced on screen, server and database, append-only, managers read (Phase 2.7b; `0317`) | **Good** | F-00-7 FIXED, G-02 BUILT |
| Supply runs | Screen (Phase 2.7c): two PINs out (manager/lead approver, not the taker), settle by a different employee, receipt + change = amount, both legs posted (12100), NOT POSTED + retry, no delete, settle once (`0318`) | **Good** | F-02-11 FIXED, G-11 BUILT |
| Print / export | Printable master till sheet per day with signature lines; CSV / Excel for any range; refused rather than partial (Phase 2.7a) | **Good** | F-00-8 safe part FIXED, G-09 BUILT; exchanges and swap bills on it since Phase 2.7b |
| Database access | RLS: managers read, no human writes | Strong | — |
| Factory reset | Counts and swaps are wiped with test data (`factory-reset-core.ts` L429–430). The little safe exchange log is **kept** (L445): it is an append-only cash-custody record, like the audit log | As designed | — |

**Why an open count?** The master till always has the same target. Hiding it would not stop a dishonest counter, who knows it is $1,000. The protections are the counter's name, the twice-daily rhythm and the AM-to-PM comparison. That is why the counter enters their own PIN, and why this SOP insists on a second person for any variance.

**Why both a total and a mix?** A right total with the wrong mix leaves the registers without change. That pushes staff into informal swaps, and informal swaps are where cash goes missing.

---

## 8. Checklists & forms

### 8.1 Master till count sheet (AM / PM / Extra)

```
GREENWAY — MASTER TILL COUNT SHEET            Date: ____/____/______
Window: [ ] AM (before open)   [ ] PM (evening)   [ ] Extra (why: ____________)
Counted by: ____________________  Time: ______   Second person (if any): ____________

Denom   | Standard | Counted | Diff (+/-) | Value counted
--------+----------+---------+------------+--------------
$100    |     0    |         |            |
$50     |     0    |         |            |
$20     |     0    |         |            |
$10     |    32    |         |            |      ($320.00 std)
$5      |    64    |         |            |      ($320.00 std)
$2      |     0    |         |            |
$1      |   318    |         |            |      ($318.00 std)
$1 coin |     0    |         |            |
50¢     |     0    |         |            |
25¢     |    95    |         |            |      ($23.75 std)
10¢     |   120    |         |            |      ($12.00 std)
5¢      |   100    |         |            |      ($5.00 std)
1¢      |   125    |         |            |      ($1.25 std)
--------+----------+---------+------------+--------------
TOTAL   | $1,000.00|                      | $____________

Variance vs $1,000.00:  [ ] Balanced  [ ] Over $______  [ ] Short $______
Mix matches standard?   [ ] Yes  [ ] No → little-safe balance (form 8.2) done? [ ] Yes
Reason (REQUIRED for any over/short): ________________________________________
Over $5.00 or still off after recount? [ ] Yes → form 8.5
Entered on Store safe page?  [ ] Yes   Banner said: ______________________
Entered by (login): ____________   Signature: ____________________
Takings/drops found in the master till? [ ] No  [ ] Yes → moved to store safe, noted
```

### 8.2 Master till ↔ little safe exchange log (D3)

```
GREENWAY — MASTER TILL ↔ LITTLE SAFE EXCHANGE LOG           Month: ________
Date | Time | OUT of master till → little safe | IN from little safe → master till | Value each side | Equal? | By | 2nd person
     |      | (big bills, by denomination)     | (small bills & coin, by denom.)   |                 |        |    |
     |      | e.g. 5×$20                       | e.g. 10×$5, 40×$1, 1 roll 25¢     | $100.00         |  [x]   |    |
```
One line per exchange. Both sides by denomination. If the sides are not equal, it is not an exchange. Stop and escalate.

> **Paper backup since Phase 2.7b.** Exchanges are recorded on the Store safe page (§4.10). Use this form only when the page is down or migration 0317 has not been applied, and enter the line in the app as soon as it is back (with a note *"from form 8.2, <time>"*).

### 8.3 Register change-swap log (till ↔ master till)

```
GREENWAY — REGISTER CHANGE-SWAP LOG                          Date: ____/____/______
Time | Register | Big bills IN from till → master till | Small bills & coin OUT master till → till | Value (one side) | Register "Record swap of $X" matches? | Cashier | Approver (mgr/lead)
     |          | e.g. 5×$20                          | e.g. 10×$5, 40×$1, 1 roll 25¢             | $100.00          | [ ]                                   |         |
```
> **Replaces SOP-01 form 8.3 on approval.** SOP-01's form 8.3 was titled "master till ↔ little safe" but logged register swaps. Those are two different exchanges: a register swap is **till ↔ master till** (the app records its value), and a balance is **master till ↔ little safe**. They now have separate forms, 8.3 and 8.2. That is finding F-02-8. SOP-01 will be updated to point here at its next revision.
>
> **Paper backup since Phase 2.7b.** The register records the bills both ways (§4.11). Use this form only for swaps from an iPad not yet rebuilt (they show *"not recorded (value only)"*) or when the page is down.

### 8.4 Supply-run log (exceptions only; the store rule is the shop card)

> **Paper backup since Phase 2.7c.** Record supply runs on Register Activity → **Supply runs** (§4.13). Use this form only if the page is down or migration 0318 is not applied.

```
GREENWAY — MASTER TILL SUPPLY RUN (exception)                Date: ____/____/______
Taken by: ______________  Time out: ______  Amount out: $________  Approved by: ______________
Why not the shop card: _______________________________________________
Returned: Time ______  Receipt total $________  Change returned $________
Receipt + change = amount out?  [ ] Yes  [ ] No → difference $______ (explain)
Signatures: taker ______________  receiver ______________   → owner same day
```

### 8.5 Master till variance reason form

```
GREENWAY — MASTER TILL VARIANCE                              Date: ____/____/______
Count window: [ ] AM  [ ] PM  [ ] Extra     Time: ______   Counted by: ______________
Result: [ ] OVER  [ ] SHORT   $__________   Recount done? [ ] Yes  By: __________  Result: ______
Checked: [ ] form 8.3 swaps  [ ] form 8.2 exchanges  [ ] form 8.4 supply runs  [ ] takings mixed in
Reason (REQUIRED): ____________________________________________________
______________________________________________________________________
Counter signature: ______________   Manager signature: ______________   → owner same day
```

### 8.6 Daily master till checklist

**Morning (before open)**
- [ ] Count the master till on form 8.1 (AM)
- [ ] Enter it on **Store safe**, window **AM (before open)**, the counter types their **PIN**
- [ ] **Today's AM count: Done**
- [ ] **Mix on standard**? If **Mix off**: little-safe exchange on the Store safe page (§4.10)
- [ ] Any variance: amount written; over $5 → reason in the app's reason box (D21; form 8.5 only before migration 0315)

**During the day**
- [ ] Every register swap: manager/lead PIN + the bills both ways on the register (form 8.3 only for an iPad not yet rebuilt)
- [ ] No cash out for supplies (shop card). Exception → **Supply runs** screen (form 8.4 if it is down); no run left open overnight without the owner knowing.
- [ ] No takings or drops in the master till

**Night (after the last swap)**
- [ ] Count on form 8.1 (PM)
- [ ] Enter on **Store safe**, check the window says **PM (evening)**, counter's **PIN**
- [ ] **Today's PM count: Done**
- [ ] PM value = AM value? If not, explain (§4.8)
- [ ] Rebuild the mix for morning (little-safe exchange, §4.10)
- [ ] Manager: print the day's **master till sheet**, get it signed, file it with forms 8.1–8.5 and the end-of-day printout (SOP-03)

---

## 9. Quick reference card

```
┌──────────────── MASTER TILL — $1,000.00 — COUNT TWICE A DAY ────────────────┐
│ STANDARD: 32×$10  64×$5  318×$1  95×25¢  120×10¢  100×5¢  125×1¢            │
│           NO $20s / $50s / $100s / $2s / $1 coins in the master till        │
│ AM (before open) and PM (after last swap): count on paper → Store safe page │
│   Register Activity → Safe → type HOW MANY of each → check window → PIN     │
│   → Record safe count. Check the window says PM at night.                   │
│ "Balanced" = total only. Read the MIX line: Mix on standard / Mix off.      │
│ Over/short: recount (Extra count) → if > $5: reason box (required)          │
│ Big bills out → little safe; small in → Store safe: Little safe exchange   │
│   (both sides by denomination, equal, your PIN) · page down: form 8.2      │
│ Register swap: manager/lead PIN + bills BOTH WAYS on the register          │
│ NEVER: takings/drops in the master till · cash for supplies (shop card)    │
│        · fix a variance by moving cash · overwrite a bad count (use Extra)  │
│ Tills: Sales 1 + Sales 2 float $167.50 each; Manager Till floats $300.00    │
│        (D19). Total with the master till: $1,635.00                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **Master till** | The $1,000.00 change fund in the owner's standard mix. The app calls it the **Store safe**. Books account 10100. |
| **Store safe** (the page) | `/admin/registers/safe`, where master till counts are entered |
| **Store safe** (the box) | Where drops and takings wait for the deposit (SOP-03) |
| **Little safe** | Spare small bills and coin used to rebuild the master till's mix. No balance or target (D3). |
| **Till / drawer** | A register's cash drawer. Float $167.50 for the sales tills (D10), $300.00 for the Manager Till (D19). |
| **Float** | The cash a till starts with and keeps overnight |
| **AM / PM count** | The two official daily counts of the master till |
| **Extra count** | Any other count: recount, handover, spot check, correction |
| **Variance** | Counted total − $1,000.00. Positive = over, negative = short. |
| **Mix** | How many of each denomination. Must match the standard (§4.2). |
| **Change swap** | A register trading big bills for equal small bills and coin with the master till. Manager/lead PIN. |
| **Balance (the master till)** | Swapping big bills out of the master till for small bills and coin from the little safe |
| **Drop** | Cash moved from a till to the store safe during a shift (SOP-01 §4.25) |
| **Takings** | Cash above the float, removed from a till at close |
| **Supply run** | Cash taken from the master till for supplies. The rule is the shop card; an exception is recorded on the **Supply runs** screen with two PINs and settled with the receipt and change (§4.13). |
| **Open count** | A count where the target is shown while you count (the master till). The opposite of a blind count (drawers). |

---

## Appendix A: Source map (verified at `main@0055f06c`; Phase 2.7a rows re-pinned to the fix branch)

| SOP section | Code / document (read for this SOP) |
|---|---|
| 2 roles | `src/lib/auth/roles.ts` L91, L95, L107; `safe/page.tsx` L93–94, L280; `safe/actions.ts` L52–71; `src/lib/auth/session.ts` L182–186; `src/components/admin/admin-nav-data.ts` L112; `supabase/migrations/0130_*.sql` L55–61; `0037_staffing_timeclock.sql` L43 (job roles) |
| 4.1 layers | `src/lib/accounting/safe-bag-core.ts` L15–25 (owner quote); `docs/MICHAEL-books-98-the-store-safe.md`; `src/lib/registers/drawer-posting-service.ts` L184–195; `src/lib/accounting/card-payment-core.ts` L7–8 |
| 4.2 standard | Owner D11; `src/lib/registers/safe-core.ts` L42 (`MASTER_TILL_STANDARD`, Phase 2.7a; the worked example now reads it); `src/lib/accounting/register-cash-specimen-core.ts` L37–48; `docs/MICHAEL-books-93-register-cash.md` L6–12; `docs/DEFECTS.md` (books-93 entry, "Arithmetic caught what eyes did not") |
| 4.3–4.7 page and counts | `src/app/admin/registers/safe/page.tsx` (443 lines), `safe/actions.ts` (133), `src/lib/registers/safe-core.ts` (195), `safe-store.ts` (294), `src/lib/registers/master-till-core.ts` (425; Phase 2.7a), `src/components/admin/registers/CountGrid.tsx` (168), `src/lib/registers/cash.ts` L30–70, `src/lib/staffing/time.ts` L17 (Pacific business day), `src/app/admin/registers/page.tsx` L135–137 |
| Data model | `supabase/migrations/0135_safe_counts_swaps.sql` (113 lines) |
| 4.8 variance | `safe-core.ts` L81–118; `safe/actions.ts` L81–89 |
| 4.10 little safe | Owner request + D3; `register-cash-journal-core.ts` L685–727; Phase 2.7b: `src/lib/registers/little-safe-core.ts` (278 lines), `src/components/admin/registers/LittleSafeExchangeForm.tsx` (129), `safe/actions.ts` L152–211, `safe-store.ts` L219–286, `supabase/migrations/0317_little_safe_exchanges.sql` (201) |
| 4.11 swaps | Phase 2.7b bills: `little-safe-core.ts` L125–151 (`checkSwapDenoms`), `till-core.ts` L256, `safe-store.ts` L166–210, `till/route.ts` L218–250, `RegisterShell.tsx` L5642–5653, L5858–5896; `src/app/api/pos/till/route.ts` L54, L139–142, L190–241; `src/lib/pos/till-core.ts` L75–88, L233–255; `src/app/(site)/pos/RegisterShell.tsx` L5666, L5752, L5790, L5846–5879, L6015–6030 |
| 4.12 drops / books | `register-cash-journal-core.ts` L71, L221–228, L241–386 (drops booked: L297–321, L329, L369–372), self-test L886–939; `src/lib/registers/store.ts` L189 (`recordDrop`); `drawer-posting-service.ts` L174–195; finding F-02-1 FIXED (Phase 2.4) |
| 4.13 supply runs | Phase 2.7c: `src/lib/registers/supply-run-core.ts` L46–55, L76–95, L130–164, L186–240, L243–250, L299; `src/lib/accounting/supply-run-posting-service.ts` L73, L127, L144; `src/app/admin/registers/supply-runs/actions.ts` L70–196; `supply-runs/page.tsx` L164, L187, L262–340; `registers/page.tsx` L146–147; `safe/page.tsx` L123, L201; `supabase/migrations/0318_supply_runs.sql`; `register-cash-journal-core.ts` L520–671; `src/lib/accounting/ledger-census-data.ts` L1663–1694; `docs/MICHAEL-books-98…` L82–108; `docs/MICHAEL-books-99-the-shop-card.md` L1–25 |
| 4.14 floats | `supabase/migrations/0038_registers_drawers.sql` L1–14, L175–186; `0077_drawer_counts_extra_denoms.sql` L27–46; `src/components/admin/registers/RegisterControls.tsx` L55–80; `src/lib/registers/oversight.ts` L316 |
| 4.9 mix | `master-till-core.ts` L54–116 (`mixRows`, `mixCheck`, `countResultWords`, `mixSentence`); `CountGrid.tsx` L89–142 |
| 4.15 EOD | `src/app/admin/registers/eod/page.tsx` L59–62, L122–134, L432–475; `src/lib/registers/eod-core.ts` L80–88, L181–192; `eod-store.ts` L164–195 (mix: L173, L186) |
| 4.17 immutability | `0135` L95–108; `grep safe_counts src` (insert and select only) |
| 4.16 history | `safe-store.ts` L319–398 (`listSafeCountsRange`, `listSwapsRange`); `master-till-core.ts` L131–166 (`parseDayRange`) |
| 4.18 print/export | `src/app/admin/registers/safe/sheet/page.tsx` (333 lines), `safe/export/route.ts` (63), `master-till-core.ts` L167–389 (`safeSheetWorkbook` L266) |
| 7 reset | `src/lib/accounting/factory-reset-core.ts` L429–430; `0140` L97–100; `0209` L335–336 |
| Tests | `tests/compliance/safe-core.test.ts` (85 lines, 6 cases); self-tests `safe-core.ts` L133–195; `tests/compliance/fix-p2-7a-master-till.test.ts` (468 lines, 30 cases); self-tests `master-till-core.ts` L336; mutation script `scripts/compliance/mutate-fix-p2-7a.py` (38 of 38 caught); Phase 2.7b: `tests/compliance/fix-p2-7b-little-safe.test.ts` (572 lines, 38 cases), self-tests `little-safe-core.ts` L206, mutation script `scripts/compliance/mutate-fix-p2-7b.py` (48 of 48 caught) |

## Appendix B: Not built yet (interim paper procedures)

| Owner requirement / need | Today | Interim procedure in this SOP | Gap · finding |
|---|---|---|---|
| D12: page for the two daily counts | **Built**: Store safe page, AM / PM / Extra | §4.5–4.7 | — (met) |
| ~~D11: master till standard mix checked~~ | **BUILT, Phase 2.7a**: Standard and Diff per box, mix line apart from the total, mix in the banner, history, sheet, export and end-of-day report (§4.9) | Form 8.1 as the paper copy | G-08 BUILT · F-02-3 FIXED |
| ~~D3: master till ↔ little safe log~~ | **BUILT, Phase 2.7b**: Little safe exchange on the Store safe page, both sides by denomination, equal, PIN; log, sheet and export (§4.10) | Form 8.2 only when the page is down or 0317 is not applied | G-02 BUILT · F-00-7 FIXED, F-02-8 (SOP-01 pointer open) |
| ~~D3: register swap denominations~~ | **BUILT, Phase 2.7b**: the register takes the bills both ways (§4.11) | Form 8.3 only for an iPad not yet rebuilt | G-02 BUILT · F-01-8 FIXED |
| ~~Master till sheet printable and exportable~~ | **BUILT, Phase 2.7a**: printable sheet per day with signature lines; CSV / Excel for any range (§4.18). The little-safe exchanges and the swap bills are on it since Phase 2.7b. | — | G-09 BUILT · F-00-8 safe part FIXED |
| ~~D7 for the master till ($5 / reason), confirmed D16~~ | **BUILT, Phase 2.3**: reason box, required over $5.00; **Over / short warnings** screen lists master till counts with window and Counted by (§4.8) | Form 8.5 only if migration 0315 is not applied | G-03 BUILT · F-02-6 threshold and reason FIXED (books posting open) |
| D19: Manager Till float $300.00 | Seeded $300 ✅ | — (met) | G-10 closed · F-02-2 withdrawn |
| ~~Supply runs recorded (screen approved, D17)~~ | **BUILT, Phase 2.7c**: Supply runs screen, two PINs out, settle with receipt and change, both legs posted (§4.13) | Form 8.4 only if the page is down or 0318 is not applied | G-11 BUILT · F-02-11 FIXED |
| ~~D15: any employee records the master till count~~ | **BUILT, Phase 2.7a**: any back-office login opens the page and saves; the counter's PIN names them (§2, §4.5) | — (none needed) | G-13 BUILT · F-02-10 FIXED (safe page) |
| ~~Drops posted to the books (10110 → 10100)~~ | **BUILT, Phase 2.4**: the close entry books takings + drops to 10100 and relieves 10110 by the same (§4.12 note) | — (none needed for staff) | G-12 built · F-02-1 FIXED |
| ~~Named, verified counter~~ | **BUILT, Phase 2.7a**: the counter's own PIN, server-checked against active employees, with lockout (§4.5) | — | F-02-4 FIXED |

## Appendix C: Open questions for the owner

All five SOP-02 questions were answered after v1.0 (owner reply recorded in `00-OWNER-REQUEST-VERBATIM.md`).

| # | Question | Owner answer | Decision |
|---|---|---|---|
| Q-02-1 | When a cashier does a **change swap** at the register, do the small bills come from the **master till**? | *"yes you have that correct"* | **D14** — till ↔ master till (form 8.3); master till ↔ little safe (form 8.2) |
| Q-02-2 | May **any** employee count the master till, or managers only? | *"anyone can count and record the master count"* | **D15** — any employee counts **and records**. Built in Phase 2.7a (gap **G-13**): any login can record, and the counter's PIN names them (`safe/actions.ts` L52–71). |
| Q-02-3 | Does the **$5** rule (D7) also apply to the **master till** counts? | *"yes, it applies to the master as well"* | **D16**. The carried half was answered in SOP-04 as **D21**: a reason is required **only over $5**. |
| Q-02-4 | Should a supply run ever happen; is the supply-run screen needed? | *"id like the supply run screen built"* | **D17** — G-11 **BUILT** (Phase 2.7c) |
| Q-02-5 | Is the system's "Manager Till" the **manager register** of D10? | *"yes correct"* + *"it should be 300 in it"* | **D18** (yes) and **D19** (Manager Till float $300.00) |

## Appendix D: Revision history

| Version | Date | Change | By |
|---|---|---|---|
| 1.0 draft | 2026-10-27 | First issue. Written from the code at `0055f06c`, with owner decisions D3, D7 and D10–D13. Adds findings F-02-1…F-02-13 and gaps G-08…G-11. | SOP program (for owner review) |
| 1.1 draft | 2026-10-27 | Owner answers D14–D19 applied in slice SOP-03: Manager Till float $300.00 (D19; F-02-2 withdrawn, G-10 closed); totals now $635.00 / $1,635.00; Q-02-1…Q-02-5 resolved; D7 applies to the master till (D16); supply-run screen approved (D17); any employee may record the count (D15, G-13). No code was re-audited; pins still at `0055f06c` (no code changed since, `3385bfa9` is docs-only). | SOP program |
| 1.2 draft | 2026-10-27 | Slice SOP-04. D21: a reason is required only for a variance over $5.00 (§4.8, checklist, quick card, Appendix C). D22 confirms floats ($167.50 sales, $300.00 Manager Till). Docs only. | SOP program |
| 1.4 draft | Fix phase | Phase 2.3 (owner message 4: *"then over/short warnings"*; owner D7, D16, D21). G-03 BUILT for the master till: reason box under the variance, required (server-checked) when more than $5.00 off, optional at $5.00 or less; reason saved on the count (migration 0315) and shown in **Recent counts**; warnings audited and listed on the owner/admin **Over / short warnings** screen. **Counted by** is now required and must be active; the audit entry names the count row (F-02-4 partly FIXED). §2, §4.4, §4.5 steps 10–11, §4.8, §5.1, §7, Appendix B updated. | Fix program |
| 1.5 draft | Fix phase | Phase 2.4 (owner message 4: *"post drops"*). G-12 BUILT: the till-close entry now books mid-shift drops to 10100 Vault together with the takings, and relieves 10110 Tills by takings + drops less over/short, so a dropped shift nets 10110 to zero (F-02-1 FIXED). No new screen, no migration, no staff change. Entries posted before the fix are not re-posted. §4.12 owner note, Appendix A pin row, Appendix B updated. | Fix program |
| 1.3 draft | 2026-10-27 | Slice SOP-05b. Living-SOP reminder added under the title (owner decision D41: update this SOP whenever a gap it names is built). Line references re-checked after the performance merge (`main@827facb5`; register files now under `src/app/(site)/pos/`). No procedure changed. | SOP program (for owner review) |
| 1.6 draft | Fix phase | Phase 2.7a (plan row 2.7: *"Master till items: denomination log, mix standard, printable sheet, supply run, any-employee count"*, `06-FIX-PHASE-PLAN.md` §3; owner D11, D15). **G-08 BUILT**: Standard and Diff under every box, a mix line apart from the total, the mix in the banner, Count history, sheet, export and end-of-day report (F-02-3 FIXED). **G-13 BUILT**: any login records; the counter types their PIN, server-checked, with lockout (F-02-4, F-02-10 FIXED). **G-09 BUILT**: Count history for any days (no 30-row cap), printable master till sheet with signature lines, CSV / Excel (F-00-8 safe part FIXED). The window starts on the next count due and Save cannot double-submit (F-02-5 partly FIXED). Page help and Notes placeholder no longer suggest drops in the master till (F-02-7 page wording FIXED). No migration. Header, §1, §2, §3, §4.2–4.9, §4.15–4.18, §5.1, §7, §8.6, §9, Appendix A–C updated. Still open: G-02 (little-safe log, swap denominations) and G-11 (supply-run screen). | Fix program |
| 1.7 draft | Fix phase | Phase 2.7b (plan row 2.7: *"Master till items: denomination log, mix standard, printable sheet, supply run, any-employee count"*, `06-FIX-PHASE-PLAN.md` §3; owner request *"Either morning or night employee can balance the master till using small bills from the little safe in exchange for big bills from the master."*; D3; D14). **G-02 BUILT**: **Little safe exchange** on the Store safe page, both sides by denomination, equal sides enforced on screen, server and database, any employee with their PIN (own lockout scope), audited, append-only (F-00-7 FIXED). The register's **Change swap** takes **Big bills to the safe** and **Change back** instead of one amount; the bills are checked equal and saved (F-01-8 FIXED; iPad rebuild needed). Exchanges and swap bills on the count history, the printable sheet (replacing the paper-form note) and the export (new **Exchanges** sheet). Migration **0317_little_safe_exchanges.sql** (owner action). Forms 8.2 and 8.3 become paper backups. Header, §2, §4.1, §4.4, §4.10, §4.11, §4.16, §4.18, §5.2, new §5.3, §7, §8.2, §8.3, §8.6, §9, Appendix A, B updated. Still open: G-11 (supply-run screen); F-02-8 SOP-01 pointer. | Fix program |
| 1.8 draft | Fix phase | Phase 2.7c (owner D17: *"Q-02-4- id like the supply run screen built"*; plan row 2.7 *"supply run"*; owner message 5: *"Please finish phase 2"*). **G-11 BUILT**, F-02-11 FIXED: §4.13 rewritten around the **Supply runs** screen: cash out with the taker's PIN and a manager or lead PIN (not the taker) and a required reason, books DR 12100 / CR 10100; settle by a different employee's PIN with receipt + change = the cash taken and one of six 280E expense accounts, books DR expense / DR 10100 / CR 12100; NOT POSTED + retry; open runs on the Store safe page; printable log. Migration **0318_supply_runs.sql** (owner action). Form 8.4 becomes the paper backup. Header, §4.4 short row, §4.13, §6, §7, §8.4, §9, glossary, Appendix A, B, C updated. The 1.6 and 1.7 rows now cite *plan row 2.7* for the *"Master till items"* words (they are the plan's, not the owner's). | Fix program |
