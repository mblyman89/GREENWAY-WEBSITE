# SOP-02 — Master Till / Store Safe: Twice-Daily Counts, Change, Swaps & the Little Safe

| | |
|---|---|
| **Version** | 1.4 (draft for owner review; Phase 2.3 fix G-03: $5 reason rule on master till counts, Counted by required, owner's warnings screen; owner answers D14–D19 and D21–D22 applied; D41 living-SOP reminder) |
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

**One word, two meanings.** The app calls the master till the **"Store safe"**. Its page title is **Store safe** and its subtitle is *"The change fund behind the registers — target $1,000.00, counted twice a day."* (`safe/page.tsx` L76–77). In the store, the **store safe** is also the box where drops and takings sit until the deposit (owner: *"167.50 is left in the register and the rest goes into the safe"*, quoted in `safe-bag-core.ts` L17–22). In this SOP:
- **master till** = the $1,000 change fund. This is what the **Store safe** page counts.
- **store safe** = the physical safe that holds drops and takings for the deposit (SOP-03).
- **little safe** = where spare small bills and coin are kept to rebuild the master till's mix (D3).

The code models one "safe" only, not three places. That is finding **F-02-7**.

---

## 2. Roles & permissions

| Task | Who | How the system checks |
|---|---|---|
| Physically count the master till (AM / PM) | The morning or night employee (owner: *"Either morning or night employee can balance the master till"*) | Not checked. The counting itself happens off-screen. |
| **Enter** the count on the Store safe page | **Owner (D15): any employee.** Today the system only lets a back-office login with the **owner**, **admin** or **manager** role do it (gap G-13) | `requirePermission("inventory.manage")` (`safe/page.tsx` L48, `safe/actions.ts` L31). `inventory.manage` = owner/admin/manager (`src/lib/auth/roles.ts` L107). |
| Choose who did the count (**Counted by**) | The person entering | **Required** since Phase 2.3: any **active employee** (`safe/page.tsx` L175–187); the server refuses a blank or inactive one (`safe/actions.ts` L39–46). There is still no PIN check (finding F-02-4, PIN part open). |
| See the **Over / short warnings** screen | Owner, admin | Permission `registers.warnings` (owner, admin). Managers write reasons but do not see the list (Phase 2.3, G-03). |
| Balance the master till with the little safe | Morning or night employee | Not in the app. Paper form 8.2 (gap G-02). |
| Approve a register change swap | An employee whose job role is **manager** or **lead**, and not the person doing the swap | Approver PIN checked on the server (`src/app/api/pos/till/route.ts` L54, L193–218) |
| See the end-of-day report | Owner, admin, manager | `requirePermission("inventory.manage")` (`eod/page.tsx` L45) |
| Read the counts straight from the database | Owner/admin/manager logins only | RLS `safe_counts_mgr_read` / `safe_swaps_mgr_read` → `public.is_manager()` (`0135_safe_counts_swaps.sql` L99–108, `0130` L55–61). No one can write through RLS. Every write goes through the app's server code. |

**Two kinds of role.** A back-office login has a *staff role* (owner, admin, manager, staff). An employee has a *job role* (sales, manager, lead, other). They are kept separate on purpose (D8). The Store safe page checks the **login's staff role**. The register swap checks the **approver's job role**.

> **Staff logins see a Safe button they cannot use.** On Register Activity, the **Safe** button shows for every login that can open the page (`registers/page.tsx` L125–127). A login with the *staff* role who taps it is sent back to the admin home (`/admin?denied=1`, `src/lib/auth/session.ts` L164). This is expected today (finding F-02-10). A non-manager who counts the master till asks a manager to enter the count, and the manager picks them under **Counted by**.

---

## 3. Before you start

1. **Know the standard mix by heart**, or keep form 8.1 in the safe (§4.2).
2. **Have form 8.1 (Master till count sheet)** and a pen. You count on paper first, then type the numbers in. Paper is the backup if the page is down. It is also the only record of the mix until gap G-08 is built.
3. **Have a back-office login with manager rights** at hand, or a manager who will enter the count for you.
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
| **Little safe** | No set balance (D3) | Spare small bills and coin used to rebuild the master till's mix | Not counted (D3) | **No** (F-00-7). Paper log, form 8.2. |
| **Store safe** | Whatever the day's drops and takings are | Holds drops and close takings until the deposit bag is sealed | SOP-03 | Drops: yes (drawer sessions). Bag: **no screen** (F-00-6). |

**Totals before a single sale** (script-checked, `sop03/calc.py`): 2 sales tills × $167.50 + Manager Till $300.00 = **$635.00**. Plus the master till, $1,000.00, that is **$1,635.00** of float in the building. ⚠ The system's worked example on the end-of-day page still uses 3 × $167.50 = $1,502.50 (`src/lib/accounting/register-cash-specimen-core.ts` L49, L136; `docs/MICHAEL-books-93-register-cash.md` L6–8). That was written from D10 before the D19 correction (finding **F-03-2**, SOP-03).

**How cash moves:**
```
                 change swap (equal value, manager/lead PIN)
   TILL  <──────────────────────────────────────────────>  MASTER TILL ($1,000)
     │                                                        ▲   │
     │ drops + close takings                     small bills  │   │ big bills
     ▼                                            & coin in   │   ▼ out
  STORE SAFE ──(SOP-03: count, bag, seal)──> BANK           LITTLE SAFE (no balance)
```
- A till keeps its float ($167.50 sales, $300.00 Manager Till) overnight. Only the takings leave it (owner, quoted in `safe-bag-core.ts` L17–22; the close posting assumes this, `floatStaysInDrawer: true`, `drawer-posting-service.ts` L190–193).
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

> **The page checks the total only.** It compares your count to $1,000.00 and says **Balanced** if the total matches, whatever the mix (`safe-core.ts` L84–95). For example, 10 × $20 and 12 × $10 in place of 32 × $10 still totals $1,000.00 and shows **Balanced**. The mix check is on paper (form 8.1, §4.9) until gap G-08 is built (finding F-02-3).

**The till float, for comparison** (owner, `0077_drawer_counts_extra_denoms.sql` L27–36): 5 × $10, 10 × $5, 50 × $1, and one roll each of quarters (40 = $10.00), dimes (50 = $5.00), nickels (40 = $2.00) and pennies (50 = $0.50). Total $167.50.

### 4.3 Opening the Store safe page

1. Sign in to the back office with a manager-level login (§2).
2. Go to **Register Activity** (Employee group in the menu, `/admin/registers`). Register Activity itself needs the `orders.manage` permission (`admin-nav-data.ts` L112).
3. In the header buttons, tap **Safe** (`registers/page.tsx` L125–127).
4. The page opens with the breadcrumb **Sell › Register Activity › Safe** and the title **Store safe**. **← Register Activity** takes you back.

Direct address: `/admin/registers/safe`.

**Help on the page:** tap **How the safe works** (HelpPanel `registers-safe`, `safe/page.tsx` L84–109). It explains the twice-daily count, that counts are open (not blind), and swaps. ⚠ Its last paragraph says *"If the safe drifts off target, drops waiting to be banked are the usual reason — note it and bank the overage."* **Do not follow that sentence at Greenway.** Drops and takings belong in the store safe, never in the master till count (§4.12, finding F-02-7).

### 4.4 Reading the Store safe page

From top to bottom (`safe/page.tsx` L113–290):

**Message banner** (after a save):
- Green: *"Safe counted — balanced on the $1,000 target."*, *"Safe counted — over the target by $X."* or *"Safe counted — short of the target by $X."* (`safe/actions.ts` L50–54).
- Red: an error from §5.

**Four cards:**

| Card | Shows | Notes |
|---|---|---|
| **Target float** | $1,000.00, hint *"Store policy"* | Fixed in code (`SAFE_TARGET_MINOR = 100_000`, `safe-core.ts` L26). There is no setting to change it. |
| **Last count** | Total of the newest count, plus *"Balanced / Over $X / Short $X · time"*. *"No counts yet"* if none. | The newest count of any window |
| **Today's AM count** | **Done** / **Not yet**, hint *"Before open"* | Done if at least one AM count exists for today's Pacific business day (`safe-store.ts` L216) |
| **Today's PM count** | **Done** / **Not yet**, hint *"Evening"* | Same, for PM (L179) |

**Count the safe** form: *"Count every denomination in the safe. The variance against the $1,000.00 target updates live as you type."*
- A grid of 13 boxes: **$100, $50, $20, $10, $5, $2, $1, $1 coin, 50¢, 25¢, 10¢, 5¢, 1¢** (`cash.ts` L36–50). Each box takes digits only. Anything else is removed as you type (`CountGrid.tsx` L65–70).
- **Safe total** (live sum), **Target: $1,000.00**, and a live **Balanced** / **Over by $X** / **Short by $X** (`CountGrid.tsx` L78–106).
- **Count window**: **AM (before open)** / **PM (evening)** / **Extra count**. ⚠ The default is always **AM**, even at night (`safe/page.tsx` L169, finding F-02-5).
- **Counted by (required)**: starts at *"Pick who counted…"*; pick any active employee. Non-sales job roles show in brackets, for example *"Jane (manager)"*. There is no **— none —** any more (Phase 2.3).
- **Reason box** under the variance (Phase 2.3, G-03): *"Reason for over / short (optional at $5.00 or less)"*. As soon as the live variance is more than $5.00 either way it turns gold, *"Warning: more than $5.00 over. Reason (required)"* (or *short*), and the form will not submit while it is blank (`CountGrid.tsx` L108–129).
- **Notes (optional)**: up to 500 characters. The placeholder is *"e.g. two drops waiting to be banked"*. Ignore that example (§4.12).
- **Record safe count** button.

**Recent counts**: the last 30 counts, newest first. Columns **When / Window / Counted by / Total / Target / Variance / Reason / Notes**. **Reason** shows the reason written with the count, or *"No reason"* for a count more than $5.00 off saved before Phase 2.3. Window shows **AM**, **PM** or **Extra**. Variance shows **Balanced**, **Over $X** (gold) or **Short $X** (red). The denominations are saved but **not shown** (F-02-3).

**Recent change swaps**: the last 30 register swaps. Columns **When / Amount / Performed by / Approved by / Notes**. Value only, no denominations (F-01-8).

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
9. **Count window**: choose **AM (before open)** (it is the default).
10. **Counted by**: pick **the person who physically counted**. The page requires it (Phase 2.3). If a manager enters someone else's count, pick the counter and write *"entered by <manager>"* in **Notes**. The Security Log entry `safe.counted` now names the count row and the counter.
11. **Reason**: if the grid says more than $5.00 over or short, recount first (§4.7). If it is still off, write **why** in the reason box (required, §4.8). **Notes**: anything else that is not standard, for example *"3×$20 from swaps, not yet to little safe"*.
12. Tap **Record safe count** **once**. Wait for the green banner (finding F-02-5: a second tap saves a second count).
13. Check that **Today's AM count** now says **Done**, and that your row is at the top of **Recent counts**.
14. **Write the banner result on form 8.1**, sign it, and file it (§4.18).
15. If the mix is off but the total is right, **balance with the little safe now** (§4.10), before open.

### 4.6 The PM count (evening)

**When:** every night, **after the last change swap of the day** (normally after the last drawer is closed). Owner: *"once at night"*. Page hint: *"Evening"*.

Follow §4.5 steps 1–15, with these changes:
- Step 9: **choose PM (evening)**. ⚠ The selector starts on **AM**. Change it every time. A PM count saved as AM marks the AM card **Done** a second time, and today's PM shows **Not yet** (F-02-5).
- Step 2: before counting, make sure every swap of the day has its line on form 8.3, and that every master till ↔ little safe exchange has its line on form 8.2.
- Step 15: rebuild the mix at night if you can, so the morning starts on the standard.
- **Compare the PM result with the AM result.** The value should be identical: swaps are equal value, and nothing else should touch the master till. Any change between AM and PM is a variance to explain (§4.8).

### 4.7 Extra counts

Choose **Extra count** for any count that is not the official AM or PM count:
- a recount after a variance (§4.8);
- a handover count when the master till changes hands mid-day;
- a spot check by the owner or a manager;
- a correction of a count entered wrong (§4.17).

Extra counts appear in **Recent counts** as **Extra**. The end-of-day report shows only how many there were (*"Extra counts"*), not their totals (§4.15).

### 4.8 Reading the result: Balanced, Over, Short

The page works out **variance = counted total − $1,000.00** on the server. The number you see on the grid while typing is only a preview. The saved figure is calculated again from your denominations (`safe-core.ts` L59–96).

| Result | What it means | What to do |
|---|---|---|
| **Balanced** | Total is exactly $1,000.00 | Still check the mix (§4.9). Done. |
| **Over by $X** | More than $1,000.00 | 1) Recount (Extra count). 2) Check form 8.3: was a swap entered with the wrong value, or did a till give more than it took? 3) Check form 8.2: did more go into the master till from the little safe than came out? 4) Look for takings or drop cash mixed in (§4.12). Pull any that are found, put them in the store safe, and recount. |
| **Short by $X** | Less than $1,000.00 | 1) Recount (Extra count). 2) Check forms 8.3 and 8.2 as above. 3) Ask whether any cash was taken for supplies (§4.13). 4) Check the area and the drop slot. 5) Escalate (§6). |

**The $5 rule (D16; built in Phase 2.3, gap G-03).** The owner set a $5 threshold for over/short, with a required reason (D7), and confirmed it **applies to the master till as well** (*"Q02-3- yes, it applies to the master as well"*).
- **Any** non-zero variance: write the amount on form 8.1. Recount first (Extra count, §4.7).
- A variance **more than $5.00** after the recount: a reason is **required** in the reason box. The server works the variance out again from your denominations and refuses a blank reason: *"The master till is short by $X, more than $5.00. Write the reason (why it is over or short) and try again. Nothing was saved."* (`over-short-warning-core.ts` `checkOverShortReason` L54; called in `safe-store.ts` `recordSafeCount` L93). The refusal is in the Security Log (`safe.count_refused`).
- **$5.00 or less:** no reason is required (owner decision **D21**: *"Q-03-1- only over $5"*). The reason box is optional.
- A count more than $5.00 off is saved as a **warning** (never blocked). The banner adds *"Warning: more than $5.00. The reason is saved and the owner sees it on Over / short warnings."* The owner (and admin) see it on **Over / short warnings** (`/admin/registers/over-short`) with the window, Counted by, time, amount and reason; the Security Log gets `safe.over_short_warning`.
- Form 8.5 is needed only if migration 0315 is not applied (the banner then says the reason is in the Security Log only).

**Never "fix" a variance by moving cash** in from the little safe, a till or the store safe to make the total come out right. The difference must stay visible and be explained. The owner wants a genuine master till variance to be *"rare and therefore meaningful"* (books-98 L77–80).

> **The books do not see master till variances.** A drawer's over/short posts to 50920 Cash Over/(Short) at reconcile. A master till count posts nothing (F-02-6, books part still open). The count row with its reason (Phase 2.3) is the record.

### 4.9 Checking the mix against the standard

The page does not do this (F-02-3). On **form 8.1**, for each denomination:
1. **Counted − Standard = difference.** Write it, with + or −.
2. The differences, each multiplied by the denomination's value, must add up to the total variance. If the total is $1,000.00, the plus and minus differences must cancel out exactly.
3. **Plus bills of $20 or more** → these are big bills from register swaps. Move them to the little safe (§4.10).
4. **Minus small bills or coin** → rebuild them from the little safe (§4.10).
5. If the mix cannot be rebuilt because the little safe has run out of a denomination, write it on form 8.1 and tell the owner (change order needed).

### 4.10 Balancing the master till with the little safe

**Owner:** *"Either morning or night employee can balance the master till using small bills from the little safe in exchange for big bills from the master."* And D3: *"I just want to know when big bills leave the master till and go into the little safe. And what the small bills and coin are that came out of the little safe."*

The app records **none** of this (F-00-7, gap G-02). Use **form 8.2** for every exchange.

1. **Work out what to swap** from form 8.1 (§4.9). Normally: big bills ($20, $50, $100) out of the master till, and the small bills and coin the master till is short of in from the little safe.
2. **Count the big bills out** of the master till. Write them on form 8.2 under **OUT of master till → little safe**, by denomination (for example *"5 × $20 = $100.00"*).
3. **Count the small bills and coin out** of the little safe. Write them under **IN from little safe → master till**, by denomination (for example *"10 × $5, 40 × $1, 1 roll 25¢ = $100.00"*).
4. **The two sides must be equal.** If they are not, stop. This is not a swap. (The system's swap rule says the same: an unequal exchange *"is a cash movement wearing a swap's clothes"* and is refused, `register-cash-journal-core.ts` L667–688.)
5. Put the big bills in the little safe and the small bills and coin in the master till.
6. **Sign and time the line.** If a second person is present, have them initial it.
7. If you just counted (AM or PM), you can record an **Extra count** after the exchange, with *"after little-safe balance"* in Notes, so the page shows the rebuilt state. The total should still be $1,000.00.

The little safe has **no balance and no target** (D3). Do not count it into the master till, and do not enter it on the Store safe page.

### 4.11 Register change swaps (the master till side)

At the register, a cashier trades big bills for the same value in small bills and coin. That is SOP-01 §4.26. From the master till side:

1. The cashier opens **MORE ▾ → Change swap**. The screen is titled **Change swap with the safe** and says *"Swap big bills for change with the safe — the same value goes each way, so the drawer total does not move. Recorded under <name>'s PIN and approved by a manager or lead with theirs."* (`RegisterShell.tsx` L5666, L5790).
2. **Amount swapped**: the value of **one side** only (*"Example: $100 in twenties goes to the safe, $100 in fives, ones and coins comes back. Enter the value of one side."*, L5801–5812).
3. **Manager or lead PIN (approval)** (L5815). The approver must be a different person (§5).
4. **Notes (optional)…**: write the bills both ways here.
5. **Record swap of $X**. Success: *"$X change swap with the safe recorded."* (L5713).
6. The swap appears in **Recent change swaps** on the Store safe page, and is counted on the end-of-day report.

**The master till person's job during a swap:**
- Count the big bills **in** from the till, and count the small bills and coin **out** to the till, in front of the cashier.
- Make sure the register's **Amount swapped** equals one side.
- Fill in **one line on form 8.3** with the denominations both ways. SOP-01's form 8.3 is replaced by this SOP's form 8.3; see the note in §8.3.
- The master till's **value** does not change. Its **mix** now has big bills, which go to the little safe at the next balance (§4.10).

**Rules from the code:**
- The till must have an open drawer: *"No open drawer on this register."* (`till/route.ts` L139–142).
- A swap needs a connection (the PIN is checked on the server).
- A single swap over $2,000.00 is refused as a typo (`MAX_SWAP_MINOR`, `safe-core.ts` L32, L113–114).
- A swap creates **no journal entry**, by design (`buildBillSwapJournal`, `register-cash-journal-core.ts` L667–702).
- Do **not** use **No sale → Change fund swap with the safe** for a real swap. That only opens the drawer and records no amount or approver (SOP-01 §4.26).

### 4.12 Drops and takings are NOT part of the master till

- **Drops** during a shift and the **takings** at close go to the **store safe**, not the master till (owner: *"the rest goes into the safe"*; SOP-01 §4.25, §4.29).
- **Never** put drop bags or takings in the master till. **Never** count them in the AM or PM count.
- If you find takings mixed into the master till, take them out, put them in the store safe, write it on form 8.1 and in **Notes**, and tell the manager. Count the master till alone.

Why this matters:
1. The page's target is $1,000.00. Any takings in the count show as a false **Over**.
2. The page's own help text and placeholder suggest the opposite (*"drops waiting to be banked are the usual reason"*; *"e.g. two drops waiting to be banked"*). That is finding **F-02-7**. Greenway's rule is the one in this section.

> **For the owner and bookkeeper (finding F-02-1, S1).** In the books, account 10100 "Cash on Hand — Vault" means *"the safe / master till"* (`register-cash-journal-core.ts` L70). Close takings are posted **into** 10100 at reconcile (L302). Mid-shift **drops are never posted anywhere**. `buildTillCloseJournal` relieves 10110 Tills only by *counted − float*, so every dollar dropped stays in 10110 for good. This was proven by running the real builder: for a shift with $500 cash sales and a $200 drop, it posted 10100 +$300.00 and 10110 −$300.00, and **$200.00 stayed in 10110**. No drop journal exists (`grep drawer_drops src/lib/accounting` returns only the factory-reset list). Staff need do nothing differently. This is recorded for the build phase.

### 4.13 Supply runs and petty cash

**Store rule: no cash leaves the master till for supplies.** The owner moved supply buying to a low-limit shop card: *"I will go with the low limit credit card ... I don't want to use the master till any more for petty cash."* (`card-payment-core.ts` L7–8). In books-99 (L20–21): *"The master till stays at exactly $1,000, all day, every day."*

> **D17 note.** The owner has asked for the supply-run screen to be built, so supply runs from the master till are an approved, recordable event, not just an emergency. The shop-card statement above is quoted from books-99 and is kept as history. When the screen is built, this section will be rewritten around it.

Until the screen exists, when cash is taken for supplies:
1. **Form 8.4 (supply-run log)**: who took it, how much, when, why. That person signs.
2. When they come back: the receipt amount, the change returned, both signatures.
3. The receipt and the change go back **into the master till envelope, never into a drawer**. A receipt in a till *"is evidence, not cash"*, so the till really is short (books-98 L84–86).
4. The next count will be **short** by the receipt amount. Write *"supply run, form 8.4"* in **Notes**, and give the form and receipt to the owner the same day.

The system can book a supply run correctly (12100 Employee Advances Receivable, `buildSupplyAdvanceJournal` / `buildSupplySettleJournal`, `register-cash-journal-core.ts` L501–646). But **no screen calls it** (ledger census: *"No screen records a supply run yet"*, `ledger-census-data.ts` L1660–1665). That is finding F-02-11 and gap G-11. The owner has **approved building the screen** (D17: *"id like the supply run screen built"*). It is queued for the build phase. Until it exists, use form 8.4.

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

**End-of-day report** (`/admin/registers/eod`, Register Activity → **End-of-day report**) has a section **Safe ($1,000 change fund)** (`eod/page.tsx` L208–247):

| Line | Shows | Source |
|---|---|---|
| **AM count** | Total · **Balanced** / **Over by $X** / **Short by $X**, or **Not done** | The **newest** AM count for that business day (`eod-core.ts` L182) |
| **PM count** | Same, for PM | Newest PM count (L183) |
| **Extra counts** | How many (only shown if there is at least one) | L184 |
| **Change swaps (value-neutral)** | *"N · $total"* or **None** | Swaps on that Pacific day (`eod-store.ts` L138–150) |

If the database migration has not run: *"Safe tracking not set up yet — run migration 0135_safe_counts_swaps.sql to include safe counts and change swaps on this report."*

**Know this when you read it:**
- If two AM counts were saved, the report shows **only the newest**. An earlier count, even a bad one, is not shown (F-02-5). Check **Recent counts** on the Store safe page for the full list.
- Extra count totals are not on the report. Only how many there were.
- The report is printable (**Print** button, `eod/page.tsx` L74) but cannot be exported (F-00-8).
- Close-of-day steps → SOP-03.

### 4.16 Reviewing recent counts and swaps

Daily (manager) and weekly (owner), on the Store safe page:
1. **Recent counts:** two counts per day (AM + PM), each with a **Counted by** name. Look for **—** (no name) in **Counted by**; days with a missing AM or PM; several AM or PM counts on one day; and any **Over** or **Short** without a note.
2. **Pattern, not day.** The owner: small differences in both directions mean little, while the same person or shift showing the same rough amount again and again means something (books-98 L66–72).
3. **Recent change swaps:** every swap has an **Approved by** name, and each has a matching line on form 8.3.
4. Only the last **30** of each are shown (`safe-store.ts` L164, L177). For older records, use the filed paper forms or ask the owner to query Supabase.

### 4.17 A count was recorded wrong

Saved counts **cannot be edited or deleted** in the app (there is no update or delete path for `safe_counts`; humans have no write policy, `0135` L95–108). This is a good control.

To correct a wrong count:
1. Do **not** try to "overwrite" it by saving another AM or PM count. That hides the first one from the end-of-day report (F-02-5) and looks like a cover-up.
2. Recount. Save it as **Extra count**, with Notes: *"CORRECTION of <AM/PM> count at <time>: <what was wrong, e.g. typed 31 tens as 13>. Correct total $X."*
3. Write the correction on that day's form 8.1 and sign it.
4. If the wrong count was the **only** AM or PM count of the day, the end-of-day report still shows the wrong figure. Attach the corrected form 8.1 to the end-of-day printout.

### 4.18 Printing and exporting (interim)

The Store safe page has **no Print button and no export** (re-confirmed: no `PrintButton` or CSV route in `src/app/admin/registers/safe/`; finding F-00-8, gap G-09). The owner asked for the master till sheet to be *"exportable and printable"*.

Until it is built:
- **The paper form 8.1 is the printable record.** Keep each day's AM and PM sheets together, in a binder by month.
- To capture the screen, use the browser's print (Ctrl/Cmd + P) on the Store safe page. The layout is not designed for print.
- The end-of-day report prints the AM/PM summary (§4.15).
- For an export, the owner can query `safe_counts` and `safe_swaps` in Supabase and download a CSV.

---

## 5. Hard blocks: "If you see this message"

### 5.1 Store safe page (back office)

| Message (exact) | Type | Why | What to do | Who |
|---|---|---|---|---|
| *"Pick a count window (morning, evening, or other)."* | BLOCK | The window value was missing or not am/pm/other (`safe-core.ts` L71) | Choose **AM**, **PM** or **Extra count** and save again | — |
| *"Count at least one bill or coin — an empty safe count records nothing."* | BLOCK | Every box was blank or 0 (L76) | Enter the counts | — |
| *"Notes must be 500 characters or fewer."* | BLOCK | Notes too long (L81). The box stops at 500 anyway. | Shorten it. Put details on form 8.1. | — |
| *"The safe tables aren't set up yet — run migration 0135_safe_counts_swaps.sql in the Supabase SQL editor."* | BLOCK | Database migration not run (`safe-store.ts` L26–27) | Count on paper. Tell the owner. | Owner |
| *"Safe tracking not set up yet"* (empty page) | BLOCK | Same (`safe/page.tsx` L123–127). Register swaps will also refuse. | Same | Owner |
| *"Supabase not configured"* / *"Connect the service role key to manage the safe."* | BLOCK | Server not connected to the database (L49–57) | Paper. Tell the owner. | Owner |
| *"Database not configured."* | BLOCK | Same, at save (`safe-store.ts` L81) | Same | Owner |
| Any other red database message | BLOCK | Unexpected database error (the raw message is shown, L90) | Do not retry more than once. Paper. Screenshot it for the owner. | Owner |
| Sent to the admin home (`/admin?denied=1`) | BLOCK | Your login is not owner/admin/manager (`session.ts` L184) | Ask a manager to enter the count, naming you as **Counted by** | Manager |
| *"Pick who counted the master till (Counted by). Nothing was saved."* | BLOCK | Counted by left blank (Phase 2.3; `safe/actions.ts` L41) | Pick the person who counted | — |
| *"Counted by must be an active employee. Nothing was saved."* | BLOCK | The person picked is not active (L45) | Pick an active employee; if the counter is missing from the list, tell a manager | Manager |
| *"The master till is over/short by $X, more than $5.00. Write the reason (why it is over or short) and try again. Nothing was saved."* | BLOCK (reason only) | More than $5.00 off with a blank reason (§4.8) | Recount; if still off, write the reason | Manager |
| *"… Warning: more than $5.00. The reason is saved and the owner sees it on Over / short warnings."* | WARN (saved) | Saved with a reason; on the owner's screen | Nothing more (form 8.5 no longer needed) | Owner |
| *"Safe counted — over the target by $X."* | WARN (saved) | The total is above $1,000.00 | §4.8 | Manager |
| *"Safe counted — short of the target by $X."* | WARN (saved) | The total is below $1,000.00 | §4.8 | Manager → owner |
| *"Safe counted — balanced on the $1,000 target."* | OK | Total is $1,000.00. **The mix is not checked.** | §4.9 | — |

### 5.2 Register change swap (seen at the register)

| Message (exact) | Type | Why | What to do |
|---|---|---|---|
| *"A manager or lead must approve the swap with their PIN."* | BLOCK | No approver PIN entered (`till-core.ts` L241) | Get a manager or lead |
| *"Approver PIN must be 4–6 digits."* | BLOCK | PIN format (`till/route.ts` L196) | Re-enter |
| *"No active employee for the approver PIN."* | BLOCK | Wrong PIN, or the employee is inactive. Counts toward PIN lockout (L193–194). | Re-enter carefully |
| *"<name> is not a manager or lead — safe swaps need a manager PIN."* | BLOCK | The approver's job role is sales/other (L197–201) | Get a manager or lead |
| *"A swap cannot approve itself — a manager or lead must enter their PIN."* | BLOCK | Approver = cashier (L203–207) | A different person approves |
| *"Swap amount must be a positive whole number of cents."* | BLOCK | Amount 0, negative or not whole cents (`safe-core.ts` L110) | Enter one side's value |
| *"Swap amount is implausibly large — check the number."* | BLOCK | Over $2,000.00 (L113) | Check. Very large swaps are not normal. |
| *"No open drawer on this register."* | BLOCK | No drawer counted in (`till/route.ts` L139–142) | Count in first (SOP-01 §4.3) |
| *"Offline — drawer actions need a connection to verify your PIN and record the cash."* | BLOCK | No connection | Wait for the connection. Do not swap off the record. |
| The migration message above (as the swap error) | BLOCK | Safe tables missing. The swap is refused, not skipped (`safe-store.ts` L157–159). | Tell the owner. No swaps until fixed. |
| *"$X change swap with the safe recorded."* | OK | Saved | Fill in form 8.3 |

---

## 6. Exceptions & escalation

| Situation | Immediate action | Escalate to |
|---|---|---|
| Master till short, still short after a recount | Stop all swaps. Recount with a second person. Check forms 8.2/8.3/8.4. Save as **Extra count** with notes. Fill in form 8.5. | Manager → owner, same day |
| Master till over, still over after a recount | Look for takings mixed in (§4.12). Check form 8.3 values. Form 8.5. | Manager → owner, same day |
| Total right, mix wrong | Balance with the little safe (§4.10) | — (owner if the little safe is out of a denomination) |
| AM or PM count missed | Count as soon as noticed. Save as **Extra count** with *"late AM/PM count"* in Notes, or as the window if it is still that day. | Manager |
| Wrong count saved | §4.17 | Manager |
| Cash taken for supplies | §4.13, form 8.4 | Owner, same day |
| Register swap without a form 8.3 line | Reconstruct with the cashier and approver now | Manager |
| Unequal "swap" | Stop. It is not a swap. Recount both sides. | Manager → owner |
| Page down / database message | Paper only. Enter later as **Extra count**, with the real time in Notes. | Owner |
| Signs of tampering (torn rolls, bundles light) | Do not continue. Photograph it. Second person present. | Owner |
| Robbery | Comply. Do not resist. Call 911 when safe. | Owner (security SOP) |

---

## 7. Controls & compliance (why the rules exist)

| Control | How it works today | Strength | Finding / gap |
|---|---|---|---|
| Twice-daily count | AM and PM windows; cards show **Done / Not yet** | Exists (D12 met) | Default window always AM (F-02-5) |
| Total calculated by the server | Total and variance are worked out from the denominations on the server, never taken from the form (`safe-core.ts` L59–96) | Strong | — |
| Target recorded with each count | `expected_minor` is saved per row, so old rows stay true if the target ever changes (`0135` L54–56) | Strong | — |
| Counts cannot be changed | No edit or delete; no human write policy (`0135` L95–108) | Strong | — |
| Who counted | **Counted by** is required and must be an active employee (Phase 2.3); still no PIN | Partial | F-02-4 (PIN part open) |
| Who entered | The audit log records the login and now names the count row and the counter (`safe.counted`, `entityId` = the count, `safe/actions.ts` L63–77) | **Good** | F-02-4 (audit part FIXED) |
| One official AM/PM per day | Not enforced. Any number allowed; the report uses the newest. | **Weak** | F-02-5 |
| Mix (denomination) standard | Not checked. Denominations are saved but not shown. | **Missing** | F-02-3, G-08 |
| Variance reason / threshold | $5.00 threshold; reason required over $5.00 (server-checked), optional at $5.00 or less; warning on the owner's screen (Phase 2.3) | **Good** | F-02-6 (threshold and reason FIXED), D7 + D16 + D21 |
| Variance in the books | Not posted | Missing | F-02-6 |
| Open (not blind) count | By design: *"the target is known policy"* (`safe-core.ts` L7–10, help text). Drawers are blind, the master till is not. | Design choice | Because the count is open, the counter's name (F-02-4) and a second counter matter more |
| Register swap approval | Manager/lead PIN, different person, checked on the server, `safe.swap` audit tied to the drawer session (`till/route.ts` L193–241) | Strong | Value only, no denominations (F-01-8) |
| Little safe exchange | Not recorded | Missing | F-00-7, G-02 |
| Supply runs | No screen (approved to build, D17). Form 8.4 meanwhile. | Missing | F-02-11, G-11 |
| Print / export | None on the page | Missing | F-00-8, G-09 |
| Database access | RLS: managers read, no human writes | Strong | — |
| Factory reset | Counts and swaps are wiped with test data (`factory-reset-core.ts` L429–430) | As designed | — |

**Why an open count?** The master till always has the same target. Hiding it would not stop a dishonest counter, who knows it is $1,000. The protections are the counter's name, the twice-daily rhythm and the AM-to-PM comparison. That is why this SOP insists on **Counted by** and on a second person for any variance.

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

### 8.3 Register change-swap log (till ↔ master till)

```
GREENWAY — REGISTER CHANGE-SWAP LOG                          Date: ____/____/______
Time | Register | Big bills IN from till → master till | Small bills & coin OUT master till → till | Value (one side) | Register "Record swap of $X" matches? | Cashier | Approver (mgr/lead)
     |          | e.g. 5×$20                          | e.g. 10×$5, 40×$1, 1 roll 25¢             | $100.00          | [ ]                                   |         |
```
> **Replaces SOP-01 form 8.3 on approval.** SOP-01's form 8.3 was titled "master till ↔ little safe" but logged register swaps. Those are two different exchanges: a register swap is **till ↔ master till** (the app records its value), and a balance is **master till ↔ little safe** (the app records nothing). They now have separate forms, 8.3 and 8.2. That is finding F-02-8. SOP-01 will be updated to point here at its next revision.

### 8.4 Supply-run log (exceptions only; the store rule is the shop card)

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
- [ ] Enter it on **Store safe**, window **AM (before open)**, **Counted by** = the counter
- [ ] **Today's AM count: Done**
- [ ] Mix checked; little-safe balance done if needed (form 8.2)
- [ ] Any variance: amount written; over $5 → reason in the app's reason box (D21; form 8.5 only before migration 0315)

**During the day**
- [ ] Every register swap: manager/lead PIN + one line on form 8.3
- [ ] No cash out for supplies (shop card). Exception → form 8.4.
- [ ] No takings or drops in the master till

**Night (after the last swap)**
- [ ] Count on form 8.1 (PM)
- [ ] Enter on **Store safe**, **change the window to PM (evening)**
- [ ] **Today's PM count: Done**
- [ ] PM value = AM value? If not, explain (§4.8)
- [ ] Rebuild the mix for morning (form 8.2)
- [ ] File today's forms 8.1–8.5 with the end-of-day printout (SOP-03)

---

## 9. Quick reference card

```
┌──────────────── MASTER TILL — $1,000.00 — COUNT TWICE A DAY ────────────────┐
│ STANDARD: 32×$10  64×$5  318×$1  95×25¢  120×10¢  100×5¢  125×1¢            │
│           NO $20s / $50s / $100s / $2s / $1 coins in the master till        │
│ AM (before open) and PM (after last swap): count on paper → Store safe page │
│   Register Activity → Safe → type HOW MANY of each → window → Counted by    │
│   → Record safe count (ONCE). PM: CHANGE THE WINDOW TO PM.                  │
│ "Balanced" = total only. Check the MIX on the paper sheet.                  │
│ Over/short: recount (Extra count) → if > $5: reason box (required)          │
│ Big bills out → little safe; small bills/coin in → log BOTH SIDES (form 8.2)│
│ Register swap: manager/lead PIN + one line on form 8.3                      │
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
| **Supply run** | Cash taken for supplies. Not allowed: use the shop card (§4.13). |
| **Open count** | A count where the target is shown while you count (the master till). The opposite of a blind count (drawers). |

---

## Appendix A: Source map (verified at `main@0055f06c`)

| SOP section | Code / document (read for this SOP) |
|---|---|
| 2 roles | `src/lib/auth/roles.ts` L91, L107; `src/lib/auth/session.ts` L182–186; `src/components/admin/admin-nav-data.ts` L112; `supabase/migrations/0130_*.sql` L55–61; `0037_staffing_timeclock.sql` L43 (job roles) |
| 4.1 layers | `src/lib/accounting/safe-bag-core.ts` L15–25 (owner quote); `docs/MICHAEL-books-98-the-store-safe.md`; `src/lib/registers/drawer-posting-service.ts` L183–194; `src/lib/accounting/card-payment-core.ts` L7–8 |
| 4.2 standard | Owner D11; `src/lib/accounting/register-cash-specimen-core.ts` L37–48; `docs/MICHAEL-books-93-register-cash.md` L6–12; `docs/DEFECTS.md` (books-93 entry, "Arithmetic caught what eyes did not") |
| 4.3–4.7 page and counts | `src/app/admin/registers/safe/page.tsx` (277 lines), `safe/actions.ts` (57), `src/lib/registers/safe-core.ts` (184), `safe-store.ts` (181), `src/components/admin/registers/CountGrid.tsx` (95), `src/lib/registers/cash.ts` L30–70, `src/lib/staffing/time.ts` L17 (Pacific business day), `src/app/admin/registers/page.tsx` L125–127 |
| Data model | `supabase/migrations/0135_safe_counts_swaps.sql` (113 lines) |
| 4.8 variance | `safe-core.ts` L59–96; `safe/actions.ts` L47–55 |
| 4.10 little safe | Owner request + D3; `register-cash-journal-core.ts` L660–702 |
| 4.11 swaps | `src/app/api/pos/till/route.ts` L54, L139–142, L190–241; `src/lib/pos/till-core.ts` L75–88, L233–255; `src/app/(site)/pos/RegisterShell.tsx` L5666, L5752, L5790, L5846–5879, L6015–6030 |
| 4.12 drops / books | `register-cash-journal-core.ts` L45–77, L235–345, L855–872; `src/lib/registers/store.ts` L122–136, L186–208; `drawer-posting-service.ts` L170–195; builder run (finding F-02-1) |
| 4.13 supply runs | `register-cash-journal-core.ts` L495–646; `src/lib/accounting/ledger-census-data.ts` L1639–1670; `docs/MICHAEL-books-98…` L82–108; `docs/MICHAEL-books-99-the-shop-card.md` L1–25 |
| 4.14 floats | `supabase/migrations/0038_registers_drawers.sql` L1–14, L175–186; `0077_drawer_counts_extra_denoms.sql` L27–46; `src/components/admin/registers/RegisterControls.tsx` L55–80; `src/lib/registers/oversight.ts` L316 |
| 4.15 EOD | `src/app/admin/registers/eod/page.tsx` L45, L74, L208–247; `src/lib/registers/eod-core.ts` L80–88, L181–192; `eod-store.ts` L122–151 |
| 4.17 immutability | `0135` L95–108; `grep safe_counts src` (insert and select only) |
| 4.18 print/export | `safe/page.tsx` (no `PrintButton`); finding F-00-8 |
| 7 reset | `src/lib/accounting/factory-reset-core.ts` L429–430; `0140` L97–100; `0209` L335–336 |
| Tests | `tests/compliance/safe-core.test.ts` (85 lines, 6 cases); self-tests `safe-core.ts` L122–184 |

## Appendix B: Not built yet (interim paper procedures)

| Owner requirement / need | Today | Interim procedure in this SOP | Gap · finding |
|---|---|---|---|
| D12: page for the two daily counts | **Built**: Store safe page, AM / PM / Extra | §4.5–4.7 | — (met) |
| D11: master till standard mix checked | Total only; mix not shown | Form 8.1 mix columns (§4.9) | G-08 · F-02-3 |
| D3: master till ↔ little safe log | Nothing recorded | Form 8.2 (§4.10) | G-02 · F-00-7, F-02-8 |
| D3: register swap denominations | Value only | Form 8.3 + Notes (§4.11) | G-02 · F-01-8 |
| Master till sheet printable and exportable | Neither | Form 8.1 binder; EOD print (§4.18) | G-09 · F-00-8 |
| ~~D7 for the master till ($5 / reason), confirmed D16~~ | **BUILT, Phase 2.3**: reason box, required over $5.00; **Over / short warnings** screen lists master till counts with window and Counted by (§4.8) | Form 8.5 only if migration 0315 is not applied | G-03 BUILT · F-02-6 threshold and reason FIXED (books posting open) |
| D19: Manager Till float $300.00 | Seeded $300 ✅ | — (met) | G-10 closed · F-02-2 withdrawn |
| Supply runs recorded (screen approved, D17) | Builders only, no screen | Store rule: shop card; form 8.4 (§4.13) | G-11 (approved) · F-02-11 |
| D15: any employee records the master till count | Manager-level login required (`safe/actions.ts` L31) | A manager login enters it and picks the counter (§4.5) | G-13 · F-02-10 |
| Named, verified counter | **Counted by required** (Phase 2.3); no PIN yet | Pick the counter; note the enterer (§4.5) | F-02-4 (required picker and audit link FIXED; PIN open, G-13) |

## Appendix C: Open questions for the owner

All five SOP-02 questions were answered after v1.0 (owner reply recorded in `00-OWNER-REQUEST-VERBATIM.md`).

| # | Question | Owner answer | Decision |
|---|---|---|---|
| Q-02-1 | When a cashier does a **change swap** at the register, do the small bills come from the **master till**? | *"yes you have that correct"* | **D14** — till ↔ master till (form 8.3); master till ↔ little safe (form 8.2) |
| Q-02-2 | May **any** employee count the master till, or managers only? | *"anyone can count and record the master count"* | **D15** — any employee counts **and records**. Today recording needs a manager login (`safe/actions.ts` L31), so gap **G-13**. Interim: a manager login enters it and picks the counter. |
| Q-02-3 | Does the **$5** rule (D7) also apply to the **master till** counts? | *"yes, it applies to the master as well"* | **D16**. The carried half was answered in SOP-04 as **D21**: a reason is required **only over $5**. |
| Q-02-4 | Should a supply run ever happen; is the supply-run screen needed? | *"id like the supply run screen built"* | **D17** — G-11 approved, queued for build |
| Q-02-5 | Is the system's "Manager Till" the **manager register** of D10? | *"yes correct"* + *"it should be 300 in it"* | **D18** (yes) and **D19** (Manager Till float $300.00) |

## Appendix D: Revision history

| Version | Date | Change | By |
|---|---|---|---|
| 1.0 draft | 2026-10-27 | First issue. Written from the code at `0055f06c`, with owner decisions D3, D7 and D10–D13. Adds findings F-02-1…F-02-13 and gaps G-08…G-11. | SOP program (for owner review) |
| 1.1 draft | 2026-10-27 | Owner answers D14–D19 applied in slice SOP-03: Manager Till float $300.00 (D19; F-02-2 withdrawn, G-10 closed); totals now $635.00 / $1,635.00; Q-02-1…Q-02-5 resolved; D7 applies to the master till (D16); supply-run screen approved (D17); any employee may record the count (D15, G-13). No code was re-audited; pins still at `0055f06c` (no code changed since, `3385bfa9` is docs-only). | SOP program |
| 1.2 draft | 2026-10-27 | Slice SOP-04. D21: a reason is required only for a variance over $5.00 (§4.8, checklist, quick card, Appendix C). D22 confirms floats ($167.50 sales, $300.00 Manager Till). Docs only. | SOP program |
| 1.4 draft | Fix phase | Phase 2.3 (owner message 4: *"then over/short warnings"*; owner D7, D16, D21). G-03 BUILT for the master till: reason box under the variance, required (server-checked) when more than $5.00 off, optional at $5.00 or less; reason saved on the count (migration 0315) and shown in **Recent counts**; warnings audited and listed on the owner/admin **Over / short warnings** screen. **Counted by** is now required and must be active; the audit entry names the count row (F-02-4 partly FIXED). §2, §4.4, §4.5 steps 10–11, §4.8, §5.1, §7, Appendix B updated. | Fix program |
| 1.3 draft | 2026-10-27 | Slice SOP-05b. Living-SOP reminder added under the title (owner decision D41: update this SOP whenever a gap it names is built). Line references re-checked after the performance merge (`main@827facb5`; register files now under `src/app/(site)/pos/`). No procedure changed. | SOP program (for owner review) |
