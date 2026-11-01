# SOP-01 — Register Operations: Shift, Sales, Discounts, Till & Cash

| | |
|---|---|
| **Version** | 1.12 (draft for owner review; G-75 (owner message 17, D118–D119): the register customer search finds any part of a name in either order, a last name, phone digits, email or Customer ID, as you type, with the last purchase and total spent on each result (§4 cart header). Earlier, 1.11: Fix Phase 6F (owner message 9, D91–D96): **anyone may return by default**, with the loyalty rule, the return window (default **7 days**) and the returnable product types as settings at Register Activity → Return policy (§4.23); the **tips box is required** on the iPad close, 0 allowed (§4.27). Earlier: Fix Phase 6 / Fix E (owner message 8, D81–D90): **clock-out is blocked while you still own an open drawer, and closing a drawer never clocks you out** (§4.2, D84); a count-in that is not the standard float **warns** (§4.3, D85); the **crew tip pool** is split evenly and your share goes on your own close (§4.27, D89); **shift change on your own insert** (§4.27a, D81/D90); **Verify till is retired**, the morning bag recount is the verify (§4.30, D83); reconcile by either manager before the bag is sealed (§4.30, D87). Earlier: Phase 2.1b fix G-05 completed: printable **Cashier shift report** per cashier and shift (§4.35); Phase 2.1c: **Tip Tracker** in the Employee menu (§4.36); Phase 2.9: the Register Activity buttons wrap so every one is on screen; Phase 2.7b fix G-02 / F-01-8: the change swap takes the bills both ways, by denomination; form 8.3 now points to SOP-02 (F-02-8); Phase 2.3 fix G-03: $5 over/short reason at reconcile and the owner's warnings screen; Phase 2.2 fix G-01: the register records the second-person count at close; Phase 2.1 fix G-05 / F-01-4: reconcile uses the system figure per drawer; Phase 1.4 fix G-44: a Destroy return is held by the app; D21 and F-03-4 correction applied; D41 living-SOP reminder; Phase 0.1 fix F-01-14) |
| **Effective** | On owner approval |
| **Owner** | Michael Lyman |
| **Applies to** | Every employee who works the register (budtenders), plus the leads and managers who approve, and the managers who reconcile |
| **Verified against** | `main@d03fe15b` (2026-10-27). Every label, message and rule below was read from the code. Nothing was written from memory. |
| **Program records** | Findings `F-01-*` in `docs/sop-program/03-FINDINGS-LEDGER.md` · Gaps in `docs/sop-program/05-GAP-REGISTER.md` |

> **This SOP is a living document (owner decision D41).** The owner said: *"We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary."* When any gap this SOP names (Appendix B) is built, this SOP is updated in the same piece of work: the sections the gap names, Appendix B, Appendix D (a new revision row), the finding marked FIXED, and the concierge entry (charter §3 rules 9–10). Until then, the interim procedures in this SOP are the rule.

> **How to use this document.** Section 4 is the step-by-step manual, in the order a shift happens. Section 5 lists every message the register can show you, why it appears, and what to do. Section 9 is a one-page card to keep at the counter. Words in **bold** are the exact labels you will see on the screen.

---

## Table of contents

1. Purpose & scope
2. Roles & permissions
3. Before you start
4. Procedures
   - 4.1 Unlocking the register (your PIN)
   - 4.2 Clocking in and out
   - 4.3 Counting in your drawer (opening float)
   - 4.4 Reading the home screen
   - 4.5 Starting a sale: the ID check
   - 4.6 Medical patients (recognition card)
   - 4.7 Reading the checkout (cart) screen
   - 4.8 Adding items: scanning, searching, browsing, keypad
   - 4.9 Changing quantities and removing items
   - 4.10 The legal limit meter and other blocks on the cart
   - 4.11 Discounts: what exists and how each one works
   - 4.12 Loyalty: points and codes
   - 4.13 Special discounts: employee, friends & family, veteran, industry
   - 4.14 Price override and discount adjust (line level)
   - 4.15 Taking cash: the tender screen
   - 4.16 Finishing the sale: change, receipt, drawer
   - 4.17 Employee pay later (employee tab)
   - 4.18 Holding (saving) a sale, and loading it back
   - 4.19 Cancelling a sale
   - 4.20 Online pickup orders at the register
   - 4.21 No sale (open the drawer without a sale)
   - 4.22 Voiding a sale (same day)
   - 4.23 Customer returns
   - 4.24 Reprinting a receipt
   - 4.25 Cash drops to the safe
   - 4.26 Change swaps with the safe
   - 4.27 Closing your drawer (blind count)
   - 4.28 The X / Z day report
   - 4.29 What to do with the money
   - 4.30 Manager: reconcile and verify
   - 4.31 Locking, auto-lock and resuming
   - 4.32 Offline mode, sync and rejected events
   - 4.33 Marking an item out of stock
   - 4.34 Other MORE-menu items
   - 4.35 Manager: the cashier shift report
   - 4.36 Tip Tracker (Employee menu)
   - 4.37 Register Activity buttons
5. Hard blocks: "If you see this message"
6. Exceptions & escalation
7. Controls & compliance (why the rules exist)
8. Checklists & forms
9. Quick reference card
10. Glossary
- Appendix A: Source map
- Appendix B: Not built yet (interim paper procedures)
- Appendix C: Revision history

---

## 1. Purpose & scope

**Purpose.** This SOP gives every register employee everything needed to complete **any** sale correctly. That includes checking ID, ringing items, applying every allowed discount, taking cash, giving change, handling voids, returns and pickups, and opening, managing and closing a cash drawer. It explains **why** the register blocks or warns you and **what to do** about it.

**Greenway is cash only.** The register has no card tender. The only non-cash way a sale can be paid is the **employee tab** (section 4.17).

**In scope:** the iPad register app (`/pos`). It covers everything from the lock screen to the end-of-day report. It also covers the manager steps at **Registers** in the back office that finish a drawer (reconcile and verify).

**Out of scope (separate SOPs):**
- The master till / store safe routine and its twice-daily counts → **SOP-02**.
- The end-of-day sheet, the morning recount and the deposit bag → **SOP-03**.
- Back-office handling of online orders → **SOP-13**. This SOP covers only handing an order over at the register.
- Pairing iPads, printers and scanners → **SOP-17**.
- Deep detail on ID types, medical patients, limits and loyalty consent → **SOP-19**. This SOP contains everything you need at the counter. SOP-19 adds background.

---

## 2. Roles & permissions

The register knows who you are by your **PIN** (4–6 digits). The iPad itself is identified separately by a device key, so a PIN only works on a paired register. There are two separate identity systems. Do not confuse them (owner decision D8):

- **Employees** have a **job role**: `sales` (budtender), `lead`, or `manager`. The register uses **only** the job role.
- **Users** are back-office logins with a staff role (owner, admin, manager, …). Every employee is also a user. Not every user is an employee.

| Step | Who can do it | How the system checks |
|---|---|---|
| Unlock the register, ring sales, count in, drop cash, close blind | Any active employee | Your PIN. You must be clocked in to start a sale, and your handbook acknowledgment must be current. |
| Clock in / out | Any active employee | PIN on the lock screen (works offline, syncs later) |
| No sale (open drawer) | Cashier asks; a **manager or lead** approves | Manager/lead PIN, checked online |
| Price override (markdown) | **Manager or lead** | Manager/lead PIN, checked online |
| Lift scan-required for one sale | **Manager or lead** | Manager/lead PIN, checked online |
| Void a sale (same day) | **Manager or lead** | Manager/lead PIN, checked online |
| Customer return | **Manager or lead** | Manager/lead PIN, checked online |
| Change swap with the safe | **Manager or lead** (not the person recording it) | Manager/lead PIN, checked online |
| X/Z day report | **Manager or lead** | Manager/lead PIN, checked online |
| Discount adjust on a line | A **second employee** who is clocked in (any job role), not the cashier | Witness PIN, checked online |
| Employee discount | The **buying employee** enters their PIN; a **different** employee witnesses | Two PINs, checked online. The buyer can never be the cashier logged into this register. |
| Friends & family | A **sponsoring employee** who is not the cashier | Sponsor PIN, checked online, plus the guest's 30-day cap |
| Cash drop witness (optional) | Any other employee | Witness PIN, checked online |
| Reconcile a closed drawer | Back-office user with `inventory.manage` | Back-office login |
| Verify a till (morning) | Back-office user with `inventory.manage` | Back-office login |
| See Registers overview | Back-office user with `orders.manage` | Back-office login |
| Resolve register exceptions, manage iPads | Back-office user with `staffing.manage` | Back-office login |
| Change rounding or scan-required policy | Back-office user with `settings.manage` | Back-office login |

> **PIN rules.** Never share your PIN, and never type someone else's. Every action is recorded against the PIN that unlocked or approved it. After **5 wrong PINs within one minute**, the PIN pad on that iPad locks for **60 seconds**.

---

## 3. Before you start

1. **Your employee file is ready.** A manager has created your employee record with a PIN. Your handbook acknowledgment is recorded: either you ticked it in the back office, or a manager marked your signed paper copy in your employee file. Without it, the register will not unlock for you.
2. **Optional: your SAW username** is on your employee file. If it is, the medical screen shows it with a **Copy username** button for the DOH database login.
3. **Hardware is on:** the iPad shows the register, the Star receipt printer is on with paper, the cash drawer is connected to the printer (the printer kicks the drawer), and the Socket scanner is charged.
4. **The iPad is paired** to a register. If it is not, the lock screen will say so. Call a manager (SOP-17).
5. **The menu has downloaded.** The home-screen footer shows **MENU** with a time. If it says the menu has not downloaded, you cannot start a sale. Connect to the internet, then **MORE ▾ → Refresh menu**.
6. **You know where the safe drop slot and the change fund are** (SOP-02).

---

## 4. Procedures

### 4.1 Unlocking the register (your PIN)

1. On the lock screen (**Enter PIN to unlock**), type your 4–6 digit PIN.
2. The register checks your PIN **online**. If the iPad is offline you will see *"Offline — unlock requires a connection in this build."* Unlocking needs internet; clocking in does not.
3. When it opens you are on the **home screen**. The top right shows your name, your job role, and **clocked in** or **NOT clocked in**.

What can stop you (full list in section 5):
- *"Enter a valid 4–6 digit PIN."*: wrong length.
- *"No active employee for that PIN."*: wrong PIN, or your employee record is inactive.
- *"Too many wrong PINs — the PIN pad is locked for N more seconds."*: wait it out.
- *"This device is not bound to a register — a manager must assign one in the back office."*: the iPad is not assigned. Call a manager.
- *"Handbook acknowledgment required before using the register…"*: read and acknowledge the handbook in the back office, or ask a manager to mark your signed paper copy. Owners are exempt.

**Also on the lock screen:**
- **Update available — tap to refresh** (or **Force refresh**): loads the newest app version. Do this between customers, never mid-sale.
- The app version number, for support calls.

### 4.2 Clocking in and out

You must be **clocked in** before you can start a sale.

**From the lock screen (recommended at the start of a shift):**
1. Tap **Clock in / out instead**.
2. Enter your PIN. The register clocks you in if you were out, or out if you were in.
3. A banner confirms it, for example *"Jamie: clock-in recorded."* If the iPad is offline it says *"(offline — will sync)"*. Punches are queued and sent automatically when the connection returns.

**From the home screen:** if you unlocked while not clocked in, the main card shows *"You're not clocked in…"* with a **Clock in now** button. You can also use **MORE ▾ → Clock in/out**.

**End of shift:** close your drawer first (4.27), then clock out.

**Clock-out guard (owner rule D84, Fix Phase 6, gap G-61).** The owner said: *"Block. I don't want to clock out on the register change out step. A lot of times they count out early to let the new employee add their till ahead of their shift, so they can finish other tasks if needed before they clock out. Anyone can clock in and out on a locked register so we can use that for now."*
- **Closing your drawer does not clock you out.** You can close early (so the next cashier can count in their insert), keep working, and clock out later from the lock screen.
- **You cannot clock out while you still own an open drawer** (a drawer you counted in that is not closed yet). The register says: *"You still have an open drawer on <register>. Close your drawer first (blind count and second count), then clock out. Closing the drawer does not clock you out (owner rule D84)."* The server refuses it too (`src/lib/staffing/store.ts` `toggleClock`), so it holds on every iPad and in the browser.
- **Offline:** an offline clock-out is queued. If it reaches the server while you still own an open drawer, it is refused and shows on **Register exceptions** as *"Punch replay failed: You still have an open drawer …"*. A manager fixes the punch on the timesheet.
- A manager's correction of a punch on the timesheet is never blocked.

### 4.3 Counting in your drawer (opening float)

You cannot ring a sale until a drawer is open on this register.

1. On the home screen, tap **Count in drawer** on the card *"Count in your drawer to start the day"*. You can also use **Open drawer** in the Cash drawer panel.
2. The **Count in drawer** window shows a denomination grid: **$100, $50, $20, $10, $5, $2, $1, $1 coin, 50¢, 25¢, 10¢, 5¢, 1¢**. Type **how many** of each you have, not the dollar value. The window adds it up live as **Counted: $X**.
3. Count every bill and coin physically in the drawer, twice. Enter the counts.
4. Tap **Open drawer with $X**.
5. Success banner: *"Drawer counted in at $X — ready to ring sales."*

Rules:
- An empty count is refused: *"Count in at least one bill or coin — an empty float cannot open a drawer."*
- Only one drawer can be open per register: *"This register already has an open drawer. Close it first."*
- Counting in needs a connection: *"Offline — drawer actions need a connection to verify your PIN and record the cash."*
- **Float check (owner rule D85, Fix Phase 6, gap G-62; finding F-01-13 FIXED).** The owner said: *"Warn please"*. The window shows the register's standard float under the grid (*"Standard float: $167.50"*; $300.00 on the Manager Till; set per register on Register Activity). If your count is different, it shows, in gold: *"This count-in is $X over / short of the standard float of $Y (counted $Z). Count it again. If it is right, you can still open: the drawer is measured against what you counted, and a manager sees this warning."*
- It is a **warning, never a block**. The drawer opens with what you counted, and the warning is saved on the audit log (`drawer.float_warning`) so the difference is never blamed on the next person. Tell the manager on duty **before** ringing sales.

### 4.4 Reading the home screen

**Top bar, left to right:**
- **REGISTER**: this home screen.
- **PICKUP**, with a number badge: online orders waiting to be handed over (4.20). It is greyed out with no open drawer or while offline.
- **REPORTS**: the X/Z day report (manager/lead PIN, 4.28).
- **MORE ▾**: the menu of everything else (4.34).

**Top right:** **Name (job role) · clocked in / NOT clocked in**. Under it: **device name · Online / OFFLINE · Drawer open / No drawer**.

**Main card:** **Scan an ID to start a sale**, with the button **Start sale — scan ID**. If something stops you, the card says why. The register checks in this order and shows the **first** problem only:
1. No drawer → *"Count in your drawer first…"*
2. Not clocked in → *"You're not clocked in…"*, with **Clock in now**
3. No menu → *"The menu hasn't downloaded yet…"*

**Saved sale card** (only when a sale was held): who saved it and when, with **Load sale** and **Discard** (4.18).

**Right-side panels:**
- **Pickup orders**: the count of waiting orders.
- **Cash drawer**: *"Open for <business day> since <time>"*, with **Open drawer**, **Cash drop**, **Change swap** and **Close (blind count)**.

**Footer (health strip):**
- **SYNC**: how many events are waiting to upload, the last sync time, and **Sync now**.
- **MENU**: when the menu was last downloaded, plus how many items are low on stock.
- **QUEUE**: **all clear**, or *"N rejected — kept on this register; back office has been notified"* (4.32).

**Amber banner "🧪 Medical TEST MODE — endorsement is SIMULATED…"**: someone turned on the medical rehearsal switch on this iPad. **Turn it off before real sales** (MORE ▾ → the medical test mode item). Since A-06 the owner controls whether the item exists at all: Back office → Medical → "Register medical test mode" → **Hide on registers** removes it from every register and switches it off the next time that register loads its menu (MORE ▾ → 🔄 Refresh menu, or close and reopen the register). Since the Phase 0.1 fix (F-01-14 FIXED), the register refuses to take payment on a sale that took tax off while test mode is on. The message reads *"Medical TEST MODE is on, so the tax taken off this sale is only a simulation. A real sale cannot be paid this way."* Turn test mode off and ring the sale again at full tax.

### 4.5 Starting a sale: the ID check

**Every sale starts with an ID check. Nothing can go in the cart first.** The screen title is *"Check ID — required before anything enters the cart"*.

The panel at the top reminds you of house policy:
- **Under 40: SCAN the ID. Every time.**
- **Clearly 40+: Check the ID is real & valid · enter DOB.**
- **⚠ Vertical ID? It MUST be scanned. This is how we do it here — no exceptions.** A vertical licence means the person is under 21 or was recently under 21.

Three ways to pass the check:

**A. Scan (the normal way, and required for anyone who might be under 40)**
1. Tap **Start sale — scan ID**. The screen shows **Ready to scan**.
2. Point the scanner at the **big barcode on the back of the licence** and pull the trigger. You do not need to tap anything.
3. **Reading barcode…**, then the verdict appears instantly.
4. If the ID passes, you go to the cart. The register also tries to **attach the loyalty member automatically** by matching the name and date of birth on the licence.
5. If it fails, the reason shows in red (section 5). Common ones:
   - *"Customer is under 21 (age N). Sale refused."* **Refuse the sale.**
   - *"ID expired YYYY-MM-DD. Expired identification is not acceptable (WAC 314-55-150)."* **Refuse the sale.** An expired ID is never acceptable.
   - *"Not an AAMVA DL/ID barcode (no ANSI header found)."* You scanned the wrong barcode, or it is not a licence. Scan the big barcode on the back.
   - If the barcode will not read at all, the message ends with *"If the barcode won't read, use manual verification."*

**B. "Clearly 40+ — visual check" (only for customers who are obviously over 40)**
1. Tap **Clearly 40+ — visual check**.
2. Pick the **Document type (WAC 314-55-150)**.
3. Hold the ID. Check that it is real, that it is not expired, and that the photo is the customer.
4. Type the **date of birth**, numbers only (MM/DD/YYYY).
5. If the date of birth works out to under 40, the register refuses: *"DOB says age N — under 40. House policy: scan the ID (the visual check is only for customers clearly 40+)."* Go back and scan.
6. This path is recorded as a manual ID verification. Managers can see every one.

**C. "Other ID / won't scan" (manual verification)**

Use this only when the barcode will not scan, or when the document has no barcode: passport, tribal enrollment card, armed forces ID and similar. The screen reminds you: *"Manual verifications are audited."*
1. Tap **Other ID / won't scan**.
2. **Document type**: pick from the WAC 314-55-150 list:
   - Driver's licence / instruction permit / ID card (any US state or territory, DC, or Canadian province)
   - Washington identicard
   - United States armed forces ID
   - Passport or passport card
   - NEXUS card
   - Global Entry card
   - Permanent Resident card
   - Merchant Marine ID
   - Tribal enrollment card
3. **Date of birth** and **Expiration date**, numbers only.
4. **Why manual? (audited, 3–500 chars)**. Example: *"Barcode scratched — visual check of WA DL"*.
5. Tick **The photo matches the customer in front of me.**
6. Tap **Verify manually**.

Anything else is refused. That includes a foreign ID not on the list, an expired ID, someone under 21, or a missing photo-match tick. **Refuse the sale.** Do not try another path to get around a refusal.

### 4.6 Medical patients (recognition card)

Only for customers who show a **DOH medical cannabis recognition card**. Do this on the ID screen, **before** you scan or verify the ID.

1. Tick **Medical patient (DOH recognition card)**.
   - If the box is unavailable with *"Medical config not in the cached menu — refresh the menu while online to enable medical sales."*, refresh the menu (MORE ▾ → Refresh menu) while online.
2. Follow the on-screen steps:
   1. **Confirm the recognition-card NAME matches the ID you just verified.**
   2. **Verify the card is ACTIVE in the DOH registry** (the SAW link). Do this on **every** sale, because cards can be revoked. If your SAW username is on file it is shown with **Copy username**. Finish the login with the code SAW texts to your phone.
   3. Enter the card details:
      - **Unique patient identifier (UPID)**, exactly as printed
      - **Card effective** (YYYY-MM-DD)
      - **Card expires** (YYYY-MM-DD)
      - **Patient** or **Designated provider**
3. Tick **I verified this card is ACTIVE in the DOH Medical Cannabis Database (required — no verification, no exemption).**
4. Now scan the ID (or use a manual path). The card is checked together with the ID.

What medical changes:
- **Age:** a valid card allows **18–20-year-olds** to buy. Under 18 is always refused: *"Customer is under 18. Sale refused — no medical exception exists at retail."* Without a valid card, 18–20 is refused: *"Customers 18–20 may only buy with a valid recognition card at an endorsed store."*
- **Limits:** medical limits are **3×** the recreational limits for usable cannabis, solid edibles, concentrate and liquid edibles. The low-THC beverage cap (200 mg) and the suppository count (10 units) do **not** increase.
- **Tax:** on DOH-registered products, the exempt taxes come off, but only when the store holds the medical endorsement. Lines show **MED · TAX OFF**, and the totals show **Medical savings (tax off)**.
- **High-THC products** (DOH list) can be sold **only** to a carded patient. See 4.10.

Card errors (fix the entry or refuse the exemption):
- UPID wrong length
- Dates not in YYYY-MM-DD format
- Patient / designated provider not picked
- Verification box not ticked
- *"Card is not effective until …"*
- *"Recognition card expired … — an expired card grants no exemptions and no 18–20 purchase allowance."*

> **Back office must have the card on file.** At sync, the server looks for an ACTIVE recognition card with that UPID. If the card has not been entered in **Admin → Medical**, the sale lands in the exception queue (section 4.32). New patients: a manager intakes the card first.

### 4.7 Reading the checkout (cart) screen

The cart screen has three zones.

**1. Customer band (top).**
- Left: the member's name, or **Walk-in customer**; an **ID ✓ age** badge; a **MEDICAL** badge with the card number (plus **EXPIRED, no exemptions** if it has lapsed); and the tier and points.
- Right: **History** (what this member usually buys), **⏸ Hold sale** (4.18) and **Cancel sale** (4.19).
- Under it, for members: **The usual:** chips. One tap re-adds a usual item if it is on today's menu, in exactly one size.
- No member attached? Tap **👤 Attach customer** and type (**Part of a name, last name, phone, email or Customer ID…**). Results appear as you type, best match first, up to 25: any part of any word in either order (*"bill mcc"*, *"mcclendon bill"*), a last name, any digits of the phone in any format (*"3778"*, *"(360) 809-3778"*), an email, or the old-POS Customer ID. Each result shows the full name and one line: the last 4 phone digits, the last purchase, the total spent (here and in the old POS), **medical** and the Customer ID, so two customers with the same name can be told apart; ask the customer for the last 4 of their phone to confirm. If there are more than 25: *"Showing the best 25 of N matches. Add the last name or more of the phone to narrow it."* A misspelling with no exact match shows *"No exact match, so these are the closest spellings."* If nobody matches: *"No customer matches. Try the last name, part of the phone, or the Customer ID."* (then sign them up in the back office). The **✕** detaches a member. (G-75, owner message 17.)

**2. Item area (left, large).**
- The always-live search bar: **Scan a barcode (no click needed) or search name, brand, size…**
- **Scan required** chip, plus a **Manager unlock** button, when the store requires scanning (4.8).
- Messages: *"Scanned: <item> — added to sale"* (green), a scan miss (amber), or a size picker.
- The **check**: one row per item, with product, category, price, the **− / +** quantity steppers, the line total and **✕** remove. The last scanned item wears **JUST SCANNED**. Tags may also show **MED · TAX OFF**, **OVERRIDE · <manager>**, or the name of an applied deal.
- Tap a product name to open its **line options** (override, discount adjust, undo).
- **☰ Browse menu**, **★ Favorites**, **Keypad** (4.8).

**3. Cart summary rail (right).**
- Item count.
- **Red/amber notices** (blocks and warnings, 4.10).
- **Legal limit (WAC 314-55-095)** meter with an **OK / NEAR / OVER** badge and a bar for each category used (for example *Usable 3.5g / 28g*).
- **Items** list.
- **Loyalty box** (members): *"💚 <name> has N points (= $X)"* and *"This sale earns ~N points"*, with **★ Redeem N pts (~$X)** and **Loyalty code…**.
- **Special discount buttons** (employee, friends & family, veteran, industry, where enabled).
- **Totals:**
  - **Subtotal (pre-tax)**
  - **Discount**: promotion savings
  - **Medical savings (tax off)**
  - **Loyalty <code>**
  - **<Program> (35%)**
  - **Tax (excise + sales)**
  - **TOTAL**
  - A discount breakdown, if the owner turned it on
- The big green **Tender Cash — $X** button, with quick chips under it (**Exact**, then likely bills such as **$40 / $50 / $100**). A chip opens the tender screen with that cash already entered.

**Prices on the shelf include tax.** The TOTAL is what the customer pays (before cash rounding, 4.15).

### 4.8 Adding items: scanning, searching, browsing, keypad

**Scan (preferred).** Scan the **package barcode**. You do not need to click into anything, because the register listens for the scanner even when nothing is selected.
- Success: *"Scanned: Blue Dream · 3.5g — added to sale"*. The row is tagged **JUST SCANNED**.
- **Each package adds its own size.** Scanning the 3.5g bag adds the 3.5g; scanning the 7g bag adds the 7g. The register does not show the other sizes. It knows the size from the lot's size link (Back office → Inventory → the lot → **Which size is this lot?**), from the size it was received as, or from the package weight.
- Size not on sale right now: *"This package is <name> (<size>), and that size is not on the register right now … Nothing was added."* **Do not ring it up as another size.** Set it aside and tell a manager.
- Lot not linked to a size yet (rare): *"<name>: this package's lot is not linked to a size yet. Check the size printed on the package and tap it."* Tap the size **printed on the package**. Then a manager links the lot once under **Which size is this lot?**, and from then on every scan adds it straight away.
- You typed the product key rather than scanning a package: *"<name>: pick the size."* Tap the size in your hand.
- No match: *"Barcode "X" matched nothing on the menu — check the label or search by name."* Check that you scanned the right label. If the item is real but missing from the menu, tell a manager. **Do not ring a different item in its place.**
- If a customer's licence gets scanned on the cart screen, the register ignores it.

**Search.** Type a name, brand or size in the bar. Matching rows appear underneath; tap one to add it. Press Enter to treat the text as a barcode.

**☰ Browse menu.** Opens the full product grid. Use the category chips across the top and the classification chips (special limit buckets) to filter. Tap a tile to add it. **ⓘ** shows product info. **☆** pins the item to this register's **Favorites** (up to 24 per iPad).

**★ Favorites.** This register's pinned best-sellers, one tap to add.

**Keypad.** Custom amounts for **non-cannabis items only** (merch, accessories). Cannabis must always be a real menu item, because it has to be tracked for state reporting, excise tax and purchase limits.

**Scan-required mode** (if the owner turned it on in Registers → Scanning):
- Cannabis items **must be scanned**. Tapping a cannabis tile shows *"<name> is a cannabis item — scan its package barcode to add it. (Manager PIN can lift this for one sale.)"*
- Merch, accessories and the keypad stay tappable.
- Damaged label or scanner down? Tap **Manager unlock**. A manager or lead enters their PIN (online only) and taps **Lift for this sale**. The chip changes to **Scan lifted (this sale)**. It turns back on automatically for the next customer.
- **Why:** the scan proves you are holding the exact package (strain and lot) that is leaving the shelf. That prevents wrong-item picks that later show up as inventory errors.

**Stock limits.** The register knows how many units the menu says are left.
- Adding more than that is refused, for example *"none left in stock"* or *"only 1 left — that one is already in the cart"*.
- If the product **is physically on the shelf**, the cached count is simply behind. Tap **Sell anyway — the unit is on the shelf**. **Any staff member** can do this. It needs no PIN and applies to this sale only.
- After that, the rail shows *"Stock limits are OFF for this sale — a staff member confirmed the product is on the shelf. The count will be reconciled at the next cycle count. Enforcement returns automatically for the next customer."*
- The notice also tells you when the stock count was last refreshed, so you can judge how far behind it might be.
- If the shelf is truly empty, do not override. Mark it out of stock (4.33).

### 4.9 Changing quantities and removing items

- **+** adds one, subject to the stock limit.
- **−** removes one. At 1, it removes the line.
- **✕** removes the whole line.

> **Every −, ✕ and Cancel sale is recorded** against your name, with the time and how many units (owner request: *"keep track of who is using the minus quantity button… it is like a void"*). Managers review these counts. Only remove items the customer does not want, or that were rung by mistake.

**Changing the cart drops loyalty and special discounts.** If a loyalty redemption or a special discount is applied and you then change the cart, it is removed automatically. Points are refunded. **Re-apply it after the cart is final.** This is why discounts should be applied **last**, just before tendering (4.11).

### 4.10 The legal limit meter and other blocks on the cart

The **Tender Cash** button is disabled until **all** of these are true:
1. The cart has at least one item.
2. No item has a pricing problem.
3. The cart is **not over a legal limit**, when the owner has set limits to hard block.
4. There are **no High-THC items for a non-carded customer**.
5. **No line is over its stock count**, unless **Sell anyway** was used.

**Legal limit (WAC 314-55-095).** The meter adds up the cart by legal category and compares it to the single-sale maximum:

| Category | Recreational max | Medical (carded) max |
|---|---|---|
| Usable cannabis (flower) | 28 g (1 oz) | 84 g (3 oz) |
| Solid infused edibles | 448 g (16 oz) | 1,344 g (48 oz) |
| Concentrate (also infused pre-rolls and infused flower) | 7 g | 21 g |
| Liquid infused (drinks) | 72 fl oz | 216 fl oz |
| Low-THC beverages (≤ 4 mg THC per unit) | 200 mg THC | 200 mg THC (does not increase) |
| Products "otherwise taken into the body" (suppositories) | 10 units | 10 units (does not increase) |

- **OK** (green): under the limit. **NEAR** (amber): close to it. **OVER** (red): over it.
- Over the limit with hard block on (the default): *"Over the WAC 314-55-095 single-transaction limit — remove items."*, followed by the reason. **Remove items.** The register has no override.
- Over the limit with warn-only (an owner setting): *"Over the configured limit (soft warning)."* The sale is allowed. Still, do not sell over a legal limit.
- **Why:** state law caps how much one customer may buy in one transaction. Selling over the cap is a licence violation.
- **Do not split one customer's purchase into two sales to get around the limit.**

**High-THC (red, no override).** The notice reads: *"<item> is a DOH High-THC product and may ONLY be sold to a patient with a valid recognition card (chapter 246-70 WAC). Remove it, or restart the sale on the medical path. No override."* Remove the item, or, if the customer has a card, cancel and restart with the medical box ticked.

**Stock warnings (amber, advisory).** *"<item>: this takes the last one in stock."* or *"<item>: cart has N, menu shows only M left — check the shelf before promising."* They never block the sale.

**Saved-sale conflict (amber, advisory).** The notice reads: *"A saved sale is holding stock this cart needs — saved by <name> <time ago>."* It lists the conflicting items and offers **Delete the saved sale — free its items for this customer**. Only use that if the saved customer has clearly left.

**Sales hours (full-screen block).** Outside the store's sales hours a **Sales hours** screen replaces the sale. Sales are illegal between midnight and 8:00 AM (WAC 314-55-147), and the owner may set a narrower window. Wait until the window opens.

### 4.11 Discounts: what exists and how each one works

There are **six** kinds of price reduction at the register. Knowing which ones combine prevents most discount errors.

| Kind | Who triggers it | Combines with | Approval |
|---|---|---|---|
| **Promotions / deals** (menu prices, tiers, "Deals & sale prices") | Automatic, from the menu | Shown in **Discount**; a loyalty or special discount is compared against it (best deal wins) | None |
| **Medical tax exemption** | Automatic, on a valid card + DOH-registered product + endorsed store | Stacks with everything (it is a tax, not a discount) | Card capture (4.6) |
| **Loyalty redemption** (points or a code) | Cashier, member present | **Never** with a special discount | None (server checks it) |
| **Special discount** (employee, friends & family, veteran, industry) | Cashier | **Never** with a loyalty redemption; never compounds on a promotion | PINs as listed in 4.13 |
| **Price override** (markdown, one line) | Manager or lead | Replaces the line's price | Manager/lead PIN |
| **Discount adjust** (one line, %, or new price) | Cashier + a second employee | Replaces the line's price (never stacks) | Second employee's PIN |

**The rules that hold everything together:**
1. **One reward per sale.** Applying a special discount removes a loyalty redemption (points are refunded), and applying a loyalty redemption removes a special discount. The server refuses a sale that carries both.
2. **Best deal wins, never stacked.** A special discount is a percent off the **regular** price. If the item already carries a better promotion, the customer keeps the promotion and the special discount takes nothing off that line. When nothing in the cart would get cheaper, you see *"Nothing to take off — every item is already at a better deal than this program (best deal wins, no stacking) or at its legal floor."*
3. **Legal floors always win.** No discount, override or adjust can take a cannabis item below **1¢** (cannabis can never be free, RCW 69.50.357) or below its **acquisition cost** (WAC 314-55-155). A line at its floor simply absorbs less.
4. **Discounts are tied to the exact cart.** Any change to the cart after applying a loyalty or special discount removes it. **Build the cart first, apply the discount last, then tender.**
5. **PIN-based discounts need internet.** The register verifies every PIN with the server.

### 4.12 Loyalty: points and codes

The loyalty box appears only when a **member is attached** (automatically after an ID scan, or by searching).

**Redeem points**
1. Tap **★ Redeem N pts (~$X)**. The button appears only when the member has enough points (at or above the program minimum) and the program has a point value set.
2. The server decides how much of the cart can legally take the discount, and **never burns points partially**.
3. The applied line shows **★ Loyalty <code> — $X off (N pts)** with **Remove (refund pts)**.

**Apply a code** (a reward code the customer brings, format **GW-XXXX-XXXX**)
1. Tap **Loyalty code…**, type the code, then tap **Apply** or press Enter.
2. While the server checks it you see **Checking with the server…**.
3. On success the code shows as applied, with **Remove**.

Errors:
- *"Code not found, expired, or already used. Check the code with the customer."*
- *"Not enough points: balance N, minimum M."*
- *"This member has no loyalty account yet — points start earning on their first completed sale."*
- *"The loyalty program has no point cash value configured."* Tell a manager.

**Earning.** The rail shows *"This sale earns ~N points"*. The real points are added by the server when the sale syncs.

### 4.13 Special discounts: employee, friends & family, veteran, industry

The rates are set by the owner in **Settings → Special discounts** (admin only). Defaults are employee 35%, friends & family 35% (capped at 4 uses per guest per rolling 30 days), veteran 15%, and industry off until the owner sets a rate. **Only programs the owner has enabled show as buttons.** Each button shows its rate, for example **Employee discount 35%**. Hover text explains what each needs.

**Employee discount (staff purchase)**

*The buying employee must not be the cashier logged into this register. They buy on a different register, or have a co-worker ring them up.*
1. Build the cart and tap **Employee discount 35%**.
2. **Step 1 of 2 — the BUYING employee enters their own PIN.** If it is the cashier's PIN you see *"That's the cashier logged into THIS register — employees buy on a register they're not logged into."*
3. **Step 2** — a **different** employee witnesses with their PIN. If the witness is the buyer: *"The witness must be someone OTHER than the buyer."* Tap **Witness & apply**.
4. The rail shows **★ Employee discount 35% — $X off (<buyer name>)**.
5. The employee may pay cash, or use **Pay later (employee tab)** (4.17).

**Friends & family**
1. **Attach the guest's customer account first.** Friends & family is tracked per account: *"Attach the guest's customer account first (look them up or sign them up)… no account, no discount."*
2. Tap **Friends & family 35%**. A **sponsoring employee**, not the cashier, enters their PIN (**Sponsor's PIN**), then taps **Sponsor & apply**.
3. The server checks the guest's 30-day count. Over the cap: *"This guest already used friends & family N time(s) in the last 30 days (limit X)."* Ring the sale at the regular price.
4. If the sponsor is the cashier: *"The sponsor must be someone OTHER than the cashier ringing this sale."*
5. The rail shows **★ Friends & family 35% — $X off (<guest> · sponsor <name>)**. Detaching the member removes the discount.

**Veteran discount**
1. Look at the customer's military ID or veteran ID.
2. Tap **Veteran discount 15%**, tick **I checked a military ID**, then tap **Apply veteran discount**.

**Industry discount** (only if the owner has enabled it)
1. Tap **Industry discount**. Type the **Company name (who are they with?)**, at least 2 characters.
2. Tap **Apply industry discount**. Usage is tracked per company.

**Removing a special discount:** tap **Remove** on the applied line.

Errors for all programs:
- *"Offline — employee PINs can only be verified with a connection."*
- *"PIN checks need the register shell — restart the app."*
- A PIN that is not an active employee: *"No active employee for that PIN."*

**What the back office sees.** Every use is recorded: who gave it, who received it, the company or guest, and how much it saved. Reports are at **Reports → Special discounts**.

### 4.14 Price override and discount adjust (line level)

Tap a product name in the check to open its line options.

**Override price… (manager or lead)**

Use it for damaged packaging, a posted-price mismatch, a short-dated last unit, or customer recovery.
1. Tap **Override price…**. The window shows the item's **floor** (statutory minimum or acquisition cost).
2. Enter the new, **lower** unit price.
3. Pick a reason or type one (3–500 characters):
   - **Damaged packaging**
   - **Price match (posted price discrepancy)**
   - **Last unit — short expiry**
   - **Customer recovery (manager decision)**
4. A manager or lead enters their PIN and taps **Approve override**.
5. The line is tagged **OVERRIDE · <manager>**. To remove it, tap **Undo override**.

Rules:
- **Markdowns only.** *"An override must LOWER the price — the line already charges $X. Raise prices in the back office menu, not at the register."*
- **Never below the floor.** *"$X is below this item's floor of $Y (statutory cannabis minimum / acquisition cost — RCW 69.50.357, WAC 314-55-155). No PIN can approve it."*
- If the quantity change moves the item to a different promotion price, the override is **dropped** and you see the new price. Get it re-approved if it still applies.

**Adjust discount… (second employee)**

Use it for small service courtesies.
1. Tap **Adjust discount…**. Pick **5% / 10% / 15% / 20% / 25%**, or type a new unit price.
2. Pick a reason:
   - **Customer service recovery**
   - **Price match**
   - **Damaged / open package**
   - **Manager-approved courtesy**
3. A **second employee who is clocked in, not you**, enters their PIN and taps **Approve adjustment**.
4. It **replaces** the current price and never stacks. **Undo adjust** removes it.
5. *"That's your own PIN — a second employee on duty must approve."* / *"<name> is not clocked in — the approver must be on duty."*

### 4.15 Taking cash: the tender screen

1. When **Tender Cash — $X** is green, tap it, or tap a quick chip (**Exact**, **$40**…) to arrive with the cash already entered.
2. The **Cash tender** screen shows:
   - **Total due — cash only at this store.** (or **Cash due…** when rounding applies) and the big amount.
   - With cash rounding on: *"Total $X · cash rounding +/−$0.0N — tax is charged on the pre-rounded total."*
   - **Medical savings**, **Loyalty**, and **Customer saved $X (N% off the regular $Y)** lines where relevant.
3. Enter what the customer handed you:
   - Tap a chip: **Exact $X**, the next whole dollar, then the next $5 / $10 / $20, and $50 / $100.
   - Or use the keypad. It works like a cash register: digits shift in from the right, so **2-6-4-1** reads **$26.41**. **C** clears, **⌫** deletes one digit.
4. The screen shows **$X change** with a bills-and-coins plan for the change, or **$X more needed**.
5. Tap **Complete sale**. It is disabled until the cash covers the amount due.
6. **Back to cart** returns to the cart with nothing lost.

**Cash rounding.** The owner picks a policy in **Registers → Rounding**: off (exact pennies), nearest nickel, always up, or always down. Only the **cash due** is rounded. The sale, its tax and the receipt keep the exact total, and the rounding prints as its own line. The day report shows a **Cash rounding** row.

**Change plan.** The register suggests change using twenties down to pennies, with the fewest pieces. It never plans $50s, $100s, $2 bills, half-dollars or dollar coins as change.

### 4.16 Finishing the sale: change, receipt, drawer

After **Complete sale** the screen title becomes **Sale complete**.
1. The big **$X change** and the bills-and-coins plan.
2. Tap **Print receipt**. The counter printer prints the receipt and **kicks the cash drawer open**.
   - **The drawer opens only when you print.** If the customer does not want a receipt, still tap **Print receipt** to open the drawer for the cash. Hand them the slip or keep it.
   - **Tap again to reprint**. Note: **every tap on this screen opens the drawer again** (see finding F-01-6). Do not tap it repeatedly. To reprint later, use **MORE ▾ → Reprint last receipt**, which never opens the drawer.
   - If the printer fails: *"… The drawer did not open — use No Sale if you need it."* Fix the printer (SOP-17). If you need the drawer, use **No Sale** (4.21) with a manager.
   - **Browser print**: for a laptop, or when the counter printer is unavailable. It does not open the drawer. If pop-ups are blocked you see *"Pop-up blocked — allow pop-ups for this site to use browser printing."*
3. **Email this receipt (customer's request)**: only if the customer asks. Type their email (**customer@example.com**) and send. If email is not set up: *"Email receipts are not configured — print the paper receipt."* If the send fails: *"Email did not go through — offer the paper receipt instead."*
4. **Count check needed** (amber), if shown: the sale sold more than the system thought was on hand. *"This sale is already recorded, and the shortfall is logged against it so the back office can trace it and reconcile the count. Just verify the physical count on the shelf."* Check the shelf after the customer leaves and tell a manager the real count.
5. Put the cash in the drawer. **Count the change back to the customer**, out loud, from the amount due up to the amount they gave you. Close the drawer.
6. Tap **Done — lock register** (or **Lock register**). **The register locks after every sale**, so the next sale starts with a PIN. That way no sale can ride on someone else's PIN.

**The sale is saved the moment you tap Complete sale.** Printing, emailing or a printer failure cannot undo it. If the iPad is offline, the sale waits in the queue and uploads later (4.32).

### 4.17 Employee pay later (employee tab)

Available only when the **employee discount** is applied (4.13).
1. On the tender screen, the buying employee reads the amber box and ticks it: *"<name> — pay later: I am taking this product now and will pay for it later. If it is still unpaid after the store's set number of days, I authorize Greenway to deduct the amount from my pay."*
2. Tap **Pay later (employee tab)**. No cash changes hands, and the drawer is not affected.
3. The sale is recorded as an **employee tab**. A loan row is opened for the employee. Managers track open tabs at **Staffing → Employee tabs**, and the default deduction age is 14 days (owner setting).
4. Without the employee discount: *"Pay later is only for an employee purchase (apply the employee discount first)."*
5. The day report shows **Employee tab (no cash)**. That amount is **not** expected in the drawer.

### 4.18 Holding (saving) a sale, and loading it back

Use this when a customer steps away (forgot cash, went to the car).
1. On the cart, tap **⏸ Hold sale**. The items and counts are saved on **this** iPad.
2. **Only one saved sale at a time.** While one is saved, Hold is unavailable for other sales.
3. The home screen shows the **Saved sale** card: who saved it, when, and the items.
4. When the customer returns: **Load sale**. **The ID check runs again** (always), then the cart is rebuilt against today's menu and prices.
5. **Discard** deletes the saved sale. Use it if the customer is not coming back.
6. A saved sale reserves nothing in the back office. If another cart needs the same last unit, the register warns you and offers to delete the saved sale (4.10).

### 4.19 Cancelling a sale

- Tap **Cancel sale** (customer band, or the frame's cancel button). The cart is discarded and nothing is charged.
- A cancel is recorded as a cart adjustment against your name (4.9).
- If the sale came from an online order, cancelling at the register leaves the order **live in the pickup queue**. Nothing is lost.

### 4.20 Online pickup orders at the register

1. Tap **PICKUP** (the badge shows how many orders are waiting). It needs an open drawer and a connection (*"Open a drawer first — pickup orders take cash"* / *"Pickup orders need a connection"*).
2. **Scan the order slip or tap an order.** The search box reads **Scan or type the order name, GWY number, or customer…**. *"The printed slip shows the order name and GWY number at the top — scan it with the handheld scanner…"*
3. The order detail shows its items, **Regular price**, **Deals & sale prices**, **Tax**, **Customer saved** and **Total due**. Marketplace orders (for example Leafly) are badged with their origin.
4. **Move the order along** while you pack it: **Confirm order**, then **Mark ready for pickup**. *"Each step is sent to <marketplace> too, which updates the customer."* *"Picked up is marked automatically the moment the register sale for this order completes."*
5. **Change items (marketplace orders only):** **✏️ Change items (swap, add, remove, quantity)…**. The server reviews the change first. If you set a price by hand: *"A price was set by hand. A manager or lead must enter their PIN."* A website order is changed by loading it into a sale instead.
6. Tap **Start handover — scan ID · $X**. *"Scan <customer>'s ID next. Starting the handover opens this order as a register sale, and the register will not take payment until the ID is verified — age verification happens at handover, not at checkout (WAC 314-55-150)."* **The ID check runs exactly as in 4.5.**
7. *"Items reprice at today's menu prices. The online order stays open until this sale completes, so nothing is lost if the customer walks away."* Tender, print and lock as usual.

**Cancelling an order:** **Cancel this order…** → pick a reason (**Customer asked to cancel** / **Customer never picked up** / **We cancelled it (out of stock, etc.)**) → a **manager or lead PIN** → **Cancel order** (or **Keep order**). *"This cancels it at <marketplace> too — the customer is notified by them. It leaves the Orders board and shows as cancelled in Reports. A manager or lead PIN is required. Put the bag's items back on the shelf."* If the connection drops: *"Could not reach the server — the order was NOT confirmed cancelled. Check the queue before trying again."*

If the marketplace cancels while the order is in your sale, a pop-up asks for a decision, and a banner then tells you what to do. It is either *"Leafly cancelled that order. Void this sale and restock anything already bagged."* or *"Leafly cancelled that order. Ring it up as a normal walk-in sale — it is no longer a Leafly order."* Do exactly what the banner says.

Full online-order handling is in **SOP-13**.

### 4.21 No sale (open the drawer without a sale)

1. **MORE ▾ → No sale — open drawer**. It is unavailable with no drawer open or while offline (*"Offline — manager approval needs a connection to verify the PIN."*).
2. Pick a reason, or type one (3–500 characters):
   - **Change for a large bill**
   - **Change fund swap with the safe**
   - **Stuck bill / jammed drawer**
   - **Drawer count check (manager)**
3. A manager or lead enters their PIN and taps **Approve, print slip & open drawer**.
4. The printer prints an audit slip and opens the drawer. The day report counts **No-sale opens**.

**Why:** an unexplained drawer opening is the classic way cash disappears. Every opening without a sale needs a reason and a manager.

### 4.22 Voiding a sale (same day)

Use this when a sale was rung wrong and the customer is still here (or it was a duplicate). **Same Pacific business day only.**
1. **MORE ▾ → Void a sale (today)** (*"Same-day only — manager PIN; restocks + returns cash"*).
2. Enter the **8-character receipt number** from the receipt, then tap **Find**.
3. Check the lines, then pick a reason or type one (3–500 characters):
   - **Wrong item rung up**
   - **Customer changed mind before leaving**
   - **Wrong quantity entered**
   - **Duplicate ring-up**
   - **Tender entered incorrectly**
4. A manager or lead enters their PIN and taps **Void sale & return $X**.
5. *"Sale X voided — hand back $Y cash; N points reversed."* Hand the cash back from the drawer. The items return to stock.

Limits: whole sales only; completed sales only; only once; not after any part was returned; same day only. For older sales, use **Return an item** (4.23).

> **Drawer effect:** the void pays cash out of **your** drawer. Since Phase 2.1 (G-05) the register records which drawer paid it: the drawer that is open on this register when the void is processed (`src/app/api/pos/void/route.ts` L101). Reconcile subtracts it automatically (4.30). If no drawer was open on the register, the void is left **not tied to a drawer**, and the manager says where its cash came from before reconciling. Still write the receipt number and the amount on your close slip.

### 4.23 Customer returns

**Store policy (Fix Phase 6F, owner message 9, D93–D96).** The owner sets it in the back office at **Register Activity → Return policy** (`/admin/registers/return-policy`). The window opening the return shows the saved policy in one sentence.
1. **Who may return:** by default **anyone** with the receipt (D93). If the owner turns on **Loyalty members only**, the sale must have had a loyalty member attached.
2. The customer brings the **original receipt**, or you find the sale in the history list. This is always required.
3. Returns are accepted **within the return window**, by default **7 days** of purchase (D94; the owner can set 1 to 60). The purchase day is day 0, counted in Pacific time.
3a. **Product types:** the owner can mark product types as not returnable (D95). Such a line shows *"… is not a returnable product type (store return policy, Register Activity → Return policy). Refuse the return of this item."* and cannot be picked.
4. The product must be in its **original packaging** with the **lot / batch label fully legible** (WAC 314-55-079(12)).
5. **Refunds are cash**, the original form of payment.

Steps:
1. **MORE ▾ → Return an item** (online only).
2. Find the sale. Either type the **receipt number** (8 characters), or search recent sales (**Search name, receipt, item or staff**) and tap the sale.
3. If the sale fails policy, every reason is shown. For example:
   - *"This sale was N days ago, and our store policy only allows returns within 7 days (the 7-day return window). Please politely refuse the return."* (the number is the owner's window)
   - *"This sale has no loyalty member on it, and our store policy only allows returns on loyalty purchases. Please politely refuse the return."* (only when **Loyalty members only** is on)
4. Pick the **line** and the **quantity** (it shows "N of M returnable").
5. Pick the **reason**: **Defective / Wrong item / Adverse reaction / Quality issue / Mislabeled / Other**. A detail note is optional, but give context for **Other**. An **adverse reaction** also needs a manager to follow the product-complaint process.
6. Choose **Restock** (sellable) or **Destroy** (the product goes to the quarantine bin for destruction, SOP-15). Since Phase 1.4 (G-44) the app holds a Destroy unit: it is counted on hand but never sold or shown as stock until it is destroyed (SOP-15 §4.7).
7. Tick both attestations: **Product is in its ORIGINAL packaging** and **Lot / batch ID on the package is FULLY LEGIBLE**.
8. A manager or lead enters their PIN and taps **Process return & refund $X**.
9. *"Return processed — hand back $X cash; N points reversed."* (plus *"Product goes to the quarantine bin."* when destroying). Hand back the cash from the drawer.

The refund is the exact price the customer paid. Each item on a sale can be returned on its own, in any order: return one now and another later, and each still gets back exactly what was paid for it (R-RET-2, owner message 13: before, the second item of a two-item line was refused with *"max 0.00"*).

> **Drawer effect (Phase 2.1, G-05):** a return processed on the register is tied to the drawer that is open on this register at that moment (`src/app/api/pos/returns/route.ts` L169). Reconcile subtracts it automatically (4.30). If no drawer was open, the return is left **not tied to a drawer** and a manager ties it before reconcile. A return processed at the back-office **Returns desk** asks **Cash paid from** (an open drawer, or **Store safe**) and will not process until one is picked (SOP-15). The server also queues the state-reporting (CCRS) correction and claws back loyalty points in proportion to the refund.

### 4.24 Reprinting a receipt

- **Last sale:** **MORE ▾ → Reprint last receipt**. It never opens the drawer.
- **An older sale:** in **Return an item**, find the sale in the history list and use its reprint button. The receipt is rebuilt from what was actually charged at the time. *"Receipt X sent to the printer."* It never opens the drawer.

### 4.25 Cash drops to the safe

A **cash drop** takes excess cash out of your drawer and puts it in the safe during the shift. Less cash at the counter means less to lose in a robbery and less to miscount at close.

**When to drop:** whenever a manager tells you to, and at least at the **afternoon** and **night** windows. Drop big bills ($100s, $50s and extra $20s) first. Keep enough small bills to make change.

1. **MORE ▾ → 💰 Cash drop** (or **Cash drop** in the Cash drawer panel).
2. The window explains: *"Cash pulled from the drawer into the safe. Recorded under <your name>'s PIN; a second person can witness with theirs."*
3. Count the cash you are pulling **twice**, then enter the amount in dollars and cents in **Amount**.
4. Pick the **Drop window**: **afternoon**, **night** or **other**.
5. **Witness PIN (optional, second person)**: if another employee is present, have them watch the count and enter their PIN. **Store practice: always get a witness when someone else is on the floor** (see finding F-01-15; the register does not force it).
6. **Notes (optional)…**: up to 500 characters, for example "two $100s and five $50s".
7. Tap **Record drop of $X**.
8. Success: *"$X dropped to the safe (window)."* Put the cash in the drop safe **immediately**, in front of the witness. Do not carry it around the store.

Messages you might see:

| Message | Meaning / what to do |
|---|---|
| *"A drop cannot witness itself — a second person must enter their PIN."* | You typed your own PIN as the witness. A different employee must enter theirs, or leave the box empty. |
| *"No active employee for the witness PIN."* / *"Witness PIN must be 4–6 digits."* | Re-enter the witness PIN. |
| *"Pick a drop window (afternoon, night, or other)."* | Choose a window. |
| *"Drop amount must be a positive whole number of cents."* | Enter a positive amount. |
| *"Drop amount is implausibly large — check the number."* | The limit is $50,000. You almost certainly typed an extra digit. |
| *"No open drawer on this register."* | Nothing to drop from. Count in first (4.3). |

**Drawer effect:** a drop lowers the cash **expected** in your drawer at close by exactly the amount recorded. Record **every** drop, or your drawer will be "over" by the drop and the safe will be "short".

### 4.26 Change swaps with the safe

A **change swap** trades big bills from your drawer for small bills and coin from the safe. **The same value goes each way**, so your drawer total does not change.

1. **MORE ▾ → 🔁 Change swap** (or **Change swap** in the Cash drawer panel).
2. The window explains: *"Swap big bills for change with the safe — the same value goes each way, so the drawer total does not move. Recorded under <your name>'s PIN and approved by a manager or lead with theirs."*
3. **Big bills to the safe (from this till)**: type **how many of each** bill leaves your drawer. **Change back (from the master till)**: how many of each bill and coin comes back (Phase 2.7b; `RegisterShell.tsx` L5858–5859). Coin is counted in pieces: a roll of quarters is 40. The line under the grids says *"Both sides $X — equal."* or *"Not equal yet: big bills $X, change $Y (…)"* (L5890–5896). You cannot record the swap until both sides are equal.
4. A manager or lead (**not you**) counts **both** sides with you and enters **Manager or lead PIN (approval)**.
5. **Notes (optional)…**.
6. Tap **Record swap of $X**. Success: *"$X change swap with the safe recorded."* The bills both ways are saved with the swap and shown on the Store safe page (SOP-02 §4.11).

Messages:
- *"A manager or lead must approve the swap with their PIN."*: the approver box is empty.
- *"A swap cannot approve itself — a manager or lead must enter their PIN."*: you used your own PIN.
- *"<name> is not a manager or lead — safe swaps need a manager PIN."*: the approver is a budtender.
- *"No active employee for the approver PIN."* / *"Approver PIN must be 4–6 digits."*: re-enter it.
- *"Enter the bills both ways: the big bills going to the safe and the change coming back."* / *"The big bills to the safe add up to $X, not the swap amount $Y."* / *"The change back adds up to $X, but the big bills are $Y. A swap must be the same value both ways."*: recount both sides (`little-safe-core.ts` L133, L142, L147).

> **Owner rule D3 (built, Phase 2.7b).** The owner wants to know **when big bills leave the master till and go into the little safe, and which small bills and coin came out of the little safe**. The register now records **which bills** went each way (finding F-01-8 FIXED). The master till ↔ little safe exchange itself is recorded on the Store safe page (SOP-02 §4.10). **The iPad app must be rebuilt** to show the two grids: an iPad built before Phase 2.7b still shows **Amount swapped** (the value of one side) and saves the swap by value only. On such an iPad, keep filling in **SOP-02 form 8.3** for every swap.

**Change swap vs No sale:** a swap goes through **Change swap** and records the exchange. Do **not** use **No sale → Change fund swap with the safe** for an actual swap. That reason only opens the drawer. It records no amount and no approver for the exchange itself.

### 4.27 Closing your drawer (blind count)

You close the drawer at the end of your shift, or at end of day. **Do it before you clock out.** Closing does **not** clock you out (owner rule D84); clock out on the lock screen when you are done (4.2).

1. Finish or hold any sale. Make sure the last receipt is printed.
2. Make your last **cash drop** if one is due (4.25). The drop must be recorded **before** the close.
3. Take the **tip jar** out and count it **by itself**, with your crew-mate (the tip jar is the crew's, owner rule D89). Tips are employee money, not drawer cash.
4. **MORE ▾ → 🔐 Close drawer (blind count)** (or **Close (blind count)** in the Cash drawer panel).
5. The window is titled **Close drawer — blind count**: *"Count what's in the drawer right now. You will NOT see the expected amount — a manager reveals over/short at reconcile. That protects you. Then a second employee counts it too."*
6. Count **every** bill and coin in the drawer by denomination and type **how many** of each. Count twice.
7. **Tips: crew tip pool (owner rule D89, Fix Phase 6, gap G-64).** The owner said: *"The tip jar is pooled for the morning crew, and pooled for the night crew. At shift change the tips are counted and evenly distributed to the two employees. This is the amount to be reported on everyone's own close till summary report. I want everyone to be completely accountable for their register."*
   - The window starts on **Crew tip pool** (the other choice is **My own tips**). Enter the **whole jar** under *"Crew tip pool (the whole jar, counted together)"* and **People sharing** (starts at 2; up to 10).
   - The window works out your share live, for example *"Crew tip pool $85.01 split evenly between 2: your share is $42.50. $0.01 cannot be split evenly; leave it in the jar for the next pool."* The split is in whole cents, rounding down; any leftover cents stay in the jar.
   - **Your share is what is saved as your tips** and printed on your own till summary (*"Tips at close: this cashier's own share …"*). Your crew-mate enters the same pool at their close and gets the same share. The server does the split again itself; it does not trust the screen.
   - **My own tips** (no pool, e.g. working alone on a register with your own jar): the old box below.
   Old box, **My own tips**: enter the tip-jar total. *"Count the tip jar by itself — tips are your money, NOT drawer cash, so keep them out of the count above. Type 0 if there were no tips."*
   - **The tips box is required (Fix Phase 6F, D92).** The owner said: *"I just want to make sure the cashier is accountable for their tips too. We are a cash only business, so pooled tips won't show up in the system until they are reported."* A blank box shows *"Required — count the tip jar and enter it (type 0 if there were no tips)."* and **Next: second count** stays off. **0** means "counted, and there were none". (The back-office close still allows blank for when the cashier is not there to count; that close shows "not recorded".)
8. **Enter your PIN** and tap **Next: second count**. (The button stays off until your PIN is typed and the tips box is valid.)
9. **Second-person count (owner rule D2, built in Phase 2.2, gap G-01).** The owner said: *"Q2- close only, and it can be any second employee. It doesn't need to be a lead or manager."* Hand the iPad to **any other employee**. The window now reads: *"Second count. Hand the iPad to another employee (any employee, not <you>). They count the drawer by themselves and enter their own PIN. <your> count stays hidden."*
   - Your count is **hidden** on this step and the second grid starts **empty**, so the second person counts blind, on their own.
   - They count every bill and coin and type how many of each. The line **Second count: $X** adds up as they type.
   - They type **their own PIN** under **Second employee's PIN**.
   - Made a mistake? **Back to <your> count (clears the second count)** returns to your step and wipes the second count.
   - The server checks the second PIN and refuses **your own** PIN: *"The second count must be done by a different employee. Hand the count to someone else and have them enter their own PIN."* A wrong PIN: *"No active employee for the second PIN."* (wrong PINs count toward the iPad's lock, 5 misses in 60 seconds).
   - Count-in has **no** second count (D2 says close only).
10. **More than one drawer on this register today?** You no longer need an X report to split the day. Since Phase 2.1 (G-05) every sale carries the drawer it was rung on, and reconcile adds up only this drawer's sales (4.30). An X report is still useful for the paperwork, but it is optional.
11. The second person taps **Record blind count & close**.
12. Success: *"Blind count recorded — a manager reconciles it in the back office."* (or *"Blind count recorded with $X in tips — …"*; with a crew pool, the pool sentence from step 7), then *"You are still clocked in: clock out when you are done (owner rule D84)."*, followed by the second-count result:
    - *"Second count by <name>: both counts agree."*, or
    - *"WARNING: the second count by <name> differs by $X (they counted more / they counted less). Both counts are saved; tell a manager."*
    A difference is a **warning only**: the drawer is already closed and both counts are saved. The owner has not said a difference should block (gap G-01 requirement 2). **Over / short uses your count** (the closer's), the same as before. If the counts differ, tell the manager on duty. It is good practice to recount together before you walk away, but the system does not ask for it.
13. Handle the cash as in 4.29.

**Why two counts:** one person can miscount, or be tempted. A second person counting on their own catches a miscount on the spot, and a match is strong evidence the count is right. Both names and both totals stay on the drawer record (migration 0314: `second_counted_by`, `second_count_minor`), and both denomination breakdowns are kept (`drawer_counts` rows `close` and `second`).

**Closing from the back office (managers).** A manager can also close a drawer on **Register Activity** → the register's card → **Close drawer (blind count-out)** (used for the Manager Till, SOP-02). The same rule applies there (Phase 2.2):
- **Counted by** is now **required** (it says *"Select…"*): pick the person who counted.
- Under **Second count (required)**: *"Any other employee counts the drawer by themselves, without looking at the count above, and types what they counted. They cannot be the person in Counted by. If the two counts differ, the drawer still closes and the difference is shown at reconcile."* They fill in **Second count total** and type their PIN under **Second employee's PIN**.
- The server checks the PIN and refuses the person picked in **Counted by**. Wrong PINs on this form share one lock (5 misses in 60 seconds locks it for 60 seconds).
- The banner reads *"Drawer closed. Both counts agree. A manager reconciles it below."* or, in gold, *"Drawer closed. Warning: The counts differ by $X: the second person counted $X more/less. Over / short uses the closer's count. Both counts are saved and shown at reconcile."*

**Two taps, or two iPads.** Only one close counts. If the drawer was closed a moment earlier: *"This drawer was closed by someone else a moment ago. Nothing was changed."* (finding F-01-2, close part).

**The iPad app must be updated (owner action).** The packaged iPad register app is built from the same register screen (`register-app/vite.config.ts` L5–8, `register-app/src/main.tsx` L23), so it only shows the second-count step after it is rebuilt and reinstalled. The server now **requires** the second count, so an iPad still on an older build cannot close a drawer: it shows *"A second employee must count the drawer and enter their PIN before it can close (owner rule D2). Any employee can do it, but not you."* Until the iPads are updated, close from the browser register (`/pos`) or from the back office (above).

**Why it is blind:** if you could see the expected amount, a short drawer could be "fixed" by fudging the count, and an honest miscount could not be told apart from theft. With a blind count your number stands on its own. A manager compares it to the system later. A blind count protects you.

Messages: *"No open drawer on this register."* (already closed, or never opened) · *"A second employee must count the drawer and enter their PIN before it can close (owner rule D2). Any employee can do it, but not you."* · *"The second employee's PIN must be 4–6 digits."* · *"The second count cannot be saved yet: database migration 0314 has not been applied. Nothing was changed."* (tell the owner) · *"Tips must be zero or a positive whole number of cents."* · *"Tips amount is implausibly large — check the number."* · *"Enter tips as dollars and cents (like 42.50), or 0 if there were none."* · *"Required — count the tip jar and enter it (type 0 if there were no tips)."*

**After closing:** the register shows **No drawer**. You cannot ring another sale on this register until someone counts in again.

### 4.27a Shift change on your own insert (owner rules D81, D90)

*Fix Phase 6. The owner said (Q-E-1): "I have 2 cashiers on shift at all times. 2 in the morning, 2 at night. Sometimes I have a 3rd cashier on busier days. We will have 3 registers with 6 removable inserts. 8am to 4pm and 3pm to 11pm." and (Q-E-3) "option b if not obvious at this point."*

Every cashier has **their own insert** for their shift, and is accountable for it from count-in to close. The 3pm–4pm overlap is the shift change:

1. **Outgoing cashier** (morning crew, around 3pm–4pm): make your last drop, close your drawer (4.27: blind count, crew tip pool, second count by any other employee). **You stay clocked in.** Take your insert out and give it to the manager or lead for the safe / deposit (SOP-03 §4.4).
2. **Incoming cashier** (night crew): put **your own fresh insert** in the same register and **Count in drawer** (4.3). The float check warns if it is not the standard float.
3. The register allows **one open drawer at a time**, so the incoming cashier can only count in after the outgoing close is saved (*"This register already has an open drawer. Close it first."*).
4. The outgoing cashier finishes any other tasks, then clocks out on the lock screen (4.2). The app refuses the clock-out only if they still own an open drawer.
5. **No solo close or open** (owner rule D86: *"No solo closer or opener."*). The second count at close is always required (D2). **A lead or manager is always on at open and close** (D88: *"There is always a lead or manager at open and close."*).

**Quick card: shift change and close**

```
SHIFT CHANGE (3-4pm)                         NIGHT CLOSE (11pm)
Outgoing: last drop -> tips: crew pool       Each cashier: last drop -> close (blind +
  + people -> blind count -> 2nd person        2nd person, crew tip pool) -> still clocked in
  counts -> Record. STILL CLOCKED IN.        Manager/lead: Deposit bags -> tick each till
Incoming: own fresh insert -> Count in         stack against the screen -> Save assembled bag
  (warns if not $167.50).                      -> bag in safe UNSEALED. Reconcile now or the
Outgoing: finish tasks -> lock screen ->       morning manager does it before the seal.
  Clock out (refused while you own an      Everyone: clock out on the lock screen.
  an open drawer).                         Morning: different employee counts the bag blind
                                             -> seal (warns if a drawer is unreconciled).
```

### 4.28 The X / Z day report

1. Tap **REPORTS** in the top bar. The window is titled **Day report (X/Z)**: *"Prints this register's totals for today: sales, tax, medical exemptions, no-sales, drops, and reconciled over/short. X while a drawer is open, Z once the day is closed. Manager or lead…"*
2. A manager or lead enters their PIN and taps **Print day report** (it shows **Building report…** while working).
3. The receipt printer prints the report. **It never opens the drawer.**

**X or Z?** If any drawer on this register is still open, it prints **X REPORT — MID-DAY SNAPSHOT**. If every drawer for the day is closed, it prints **Z REPORT — END OF DAY**. The report covers **this register** for the **Pacific business day**. It is not per cashier or per shift (finding F-01-10).

**How to read it:**

| Section / row | What it means |
|---|---|
| **Sales completed** | Number of sales the server has processed today on this register |
| **Gross (tax incl.)** | Total charged, including tax, **before** cash rounding |
| **Subtotal** / **Tax collected** | Pre-tax sales and the tax on them |
| **Medical sales** / **Medical tax exempt** | Count of medical sales and the tax taken off |
| **Cash rounding (N sales)** | Net rounding added (+) or given up (−). Shown only when rounding touched a sale. |
| **Employee tab, no cash (N)** | Sales on an employee tab. They are sales, but **no cash** came in. |
| **REFUNDS — STORE-WIDE CASH OUT**: **Voided sales (N)**, **Counter returns (N)**, **Total cash refunded** | Cash paid **out** for voids and returns across the **whole store**. *"Voids/returns are not tied to one register — count them against the drawer that paid."* |
| **No-sale drawer opens** | How many times the drawer was opened without a sale |
| **Exceptions (manager queue)** | Sales the server could not process (4.32) |
| **Still processing** | Sales uploaded but not processed yet. Wait and reprint. |
| **Drawer sessions**, **Opening float**, **Safe drops (N)** | Drawer activity for the day |
| **Over / short (reconciled)** or **Over / short: pending manager reconcile** | The over/short appears only after a manager reconciles (4.30) |

**Cash the register took today** = **Gross + Cash rounding − Employee tab − refunds paid from this drawer**. Since Phase 2.1 (G-05) the manager does **not** work this out at reconcile: the reconcile card shows the same figure **per drawer**, built by the system (4.30). The day report stays per register, and its refund section stays store-wide.

Messages: *"Offline — the day report needs a connection to verify the PIN and read the day's ledger."* · *"Day report failed — try again."* · *"Could not reach the server — try again."*

### 4.29 What to do with the money

At close, after the blind count:
1. **Drawer cash**: follow the store's cash routine in **SOP-02** (master till / safe) and **SOP-03** (end-of-day sheet, deposit bag). **The float stays in the drawer** for tomorrow (**$167.50** in each sales register, **$300.00** in the Manager Till, owner decisions D19/D22; the system closes with `floatStaysInDrawer: true`, `drawer-posting-service.ts` L194). Everything above the float is the takings and goes into the deposit (SOP-03 §4.4–4.5). *(Corrected in v1.1: v1.0 said the float "goes back to the master till / safe", which was wrong, finding F-03-4.)*
2. **Tips**: the crew pool is split evenly at each close (D89, 4.27 step 7); each person takes their share. Tips never go into the drawer count or the deposit.
3. **Close slip (form 8.2)**: hand it to the manager with the void and return receipts and the swap log (form 8.3). The second count is now recorded by the register (Phase 2.2). Fill in the slip's second-count column only when the register could not take it (for example, migration 0314 not applied yet).
4. **Print the Z report** (4.28) when the last drawer of the day is closed, and put it with the end-of-day paperwork.

> The deposit bag is on **Deposit bags** in the back office (SOP-03 §4.5–§4.13; built in Phase 2.6, assembled and verified at night since Fix Phase 6, D82).

### 4.30 Manager: reconcile (back office); Verify till retired

*Managers and admins only. Reconcile and verify need `inventory.manage` (owner, admin, manager). Anyone with `orders.manage` (which includes staff) can **see** Register Activity, but only sees "Ask a manager to sign off".*

A drawer moves through three states: **open → closed → reconciled**. (**Verified** is kept only on old drawers: Verify till is retired, owner rule D83, below.)

**Who reconciles, and when (owner rule D87, Fix Phase 6, gap G-66).** The owner asked for a professional call: *"I think it can be done by either the night manager or morning manager. But don't build it this way just because I say to. I want your professional opinion … build this one like the big boys would."* The large POS systems close blind at the till and leave the manager review to be done after, with a deadline. So:
- **Either the night manager or the morning manager** reconciles. Night is best when there is time; otherwise the morning manager does it first thing.
- **Deadline: before the day's deposit bag is sealed** (SOP-03 §4.11). Sealing a bag that holds an unreconciled drawer is **not** blocked, but it warns: *"Warning: N drawer(s) in this bag have not been reconciled yet (…). The bag is sealed; a manager reconciles it/them on Register Activity today (SOP-03 §4.11). The owner sees this on the audit log."* (audit `deposit_bag.sealed_unreconciled`).
- The **End-of-day report** reads *"Closed — N drawers awaiting manager reconcile"* until every drawer is reconciled, then *"Final — all drawers closed and reconciled"*.

**Where:** back office → **Register Activity** (`/admin/registers`). The **Needs attention** section holds one orange **Reconcile** card per closed drawer. (The gold **Verify till** card is gone, D83.)

**Reconcile (reveal over/short)**

Since Phase 2.1 (G-05, findings F-01-4 and F-01-3) **you do not type cash sales**. The card shows the drawer's **system figure**, built from the server's own records (`src/lib/registers/drawer-figure-core.ts` `buildDrawerFigure` L129):

| Row on the card | Where it comes from |
|---|---|
| **Opening float** | The count-in of this drawer |
| **Sales on this drawer (N)** | Every processed register sale that carries this drawer's ID (the register stamps the open drawer on each sale, and the server checks it) |
| **Cash rounding** | Net nickel rounding on those sales (shown only when not $0.00) |
| **Employee tab, no cash (N)** | Tab sales: sales, but no cash came in (taken off) |
| **Other tender, not cash (N)** | Only if a non-cash tender is ever switched on (the store is cash-only today) |
| **= Cash sales** | Gross + Cash rounding − Employee tab − Other tender |
| **Refunds paid from this drawer (N)** | Voids and returns tied to this drawer, listed one per line |
| **Drops to the safe** | This drawer's recorded drops |
| **= Expected in drawer** | Opening float + Cash sales − Refunds − Drops |
| **Counted at close (name)** / **Over / short** | The closer's blind count, and counted − expected |
| **Second count (name)** | The second employee's own count (Phase 2.2, G-01). **None** on drawers closed before migration 0314 |

1. Read the figure. The expected amount is now the real one (the old "$0.00 before reconcile" problem is gone).
   - Under the figure one line compares the two counts: *"Both counts agree."* or, in gold, *"Warning: The counts differ by $X: the second person counted $X more/less. Over / short uses the closer's count."* A difference does **not** block reconcile (warning only, gap G-01). Talk to both counters before you reconcile, and note what you find on the close slip.
2. If a sale from this drawer was **refused by the server** (an exception), the card says so. It is **not** counted, so if the customer paid, the drawer will show over by that amount. Clear it in **Register exceptions** (4.32).
3. **Reconcile waits until:** a red box lists anything the system cannot know. The **Reconcile** button stays off until the list is empty:
   - *"N sale(s) from this drawer is/are still processing. Wait for the register to finish syncing, then reload."*
   - *"N cash refund(s) ($X) on this day is/are not tied to a drawer or the safe. Say where each one was paid from first."*
   - *"The records behind this drawer's figure could not all be read … Nothing is guessed: try again in a minute."*
   - *"This drawer has no opening count, so its expected cash cannot be worked out."*
4. **Tying a refund.** Under *"Say where each refund's cash came from:"* each untied void or return is listed with its amount and time. Pick the drawer it was paid from (or **Store safe**) under **Paid from…**, then tap **Tie refund**. Use the close slips and the void/return receipts to decide. **Do not guess**: if you are not sure, ask the cashiers first. A refund can be tied only once, and never to a drawer that is already reconciled. The banner reads *"Refund tied. The drawer figures below now include it."*
5. Tap **Reconcile**. You are signed in, so the system records **you** as the reconciler (your employee record). There is no name box any more (finding F-01-5). The server builds the figure again at the moment you click, and refuses if anything changed. Expected and over/short are worked out as in the table. The banner shows *"Drawer reconciled · Balanced"*, *"Over by $X"* or *"Short by $X"*, plus the books outcome. Reconcile posts the drawer's cash and over/short to the books, and that posting cannot be undone from this screen.
   - If two managers click at once, only the first counts. The second sees *"This drawer was reconciled by someone else a moment ago. Nothing was changed. Reload the page."* (finding F-01-2, reconcile part).
6. **$5 rule (owner decisions D7 and D21; built in Phase 2.3, gap G-03, finding F-01-11 FIXED).** Above the **Reconcile** button there is a reason box (`registers/page.tsx` L725–750):
   - **More than $5.00 over or short:** the box turns gold and reads *"Warning: more than $5.00 over. Reason (required)"* (or *short*). Talk to the cashier and the second counter, then write **why** it is over or short. The server works out the over/short again when you click and refuses a blank reason: *"This drawer is short by $X, more than $5.00. Write the reason (why it is over or short) and try again. Nothing was saved."* (`over-short-warning-core.ts` `checkOverShortReason` L54; called in `store.ts` `reconcileDrawer` L360). The refusal is written to the Security Log (`drawer.reconcile_refused`).
   - **$5.00 or less:** the box reads *"Reason for over / short (optional at $5.00 or less)"*. **No reason is required** (owner decision **D21**: *"Q-03-1- only over $5"*). A note is welcome if the cause is known.
   - After a warning reconcile the banner adds *"Warning: more than $5.00 over or short. The reason is saved and the owner sees it on Over / short warnings."* The reason is saved on the drawer (migration 0315), printed on its **Till summary** as **Over/short reason**, and the Security Log gets `drawer.over_short_warning`. **Warnings never block** (D7: *"Just warnings for now"*).
   - **Over / short warnings** (`/admin/registers/over-short`) is the owner's screen: **owner and admin only** (permission `registers.warnings`), reached from the **Over / short warnings** button on Register Activity and from the menu (Employee → **Over / Short Warnings**). It lists every drawer and master till count more than $5.00 off: when, what (register or master till and window), who counted (closer and second counter), who signed it off, how much, and the reason. Ranges 7 / 30 / 90 / 365 days; printable. Managers write the reasons but do not see this list.
   - Paper form 8.5 is no longer needed when migration 0315 is applied. Before it is applied the reconcile still lands, the reason is kept in the Security Log only, and the banner says so; then fill in form 8.5 as before.

**Verify till is retired (owner rule D83, Fix Phase 6, gap G-63; findings F-00-3, F-00-4 verify part, F-01-12 RETIRED).** The owner said: *"Yes please do this."* The morning **blind recount of the deposit bag** by a different employee (SOP-03 §4.10) is the verify now: it is a real count, by denomination, with the counter's PIN. The old card, which saved no recount and took a typed name into an ID column, is removed. A stale page that still posts it is refused with *"Verify till is retired (owner rule D83). The morning recount on Deposit bags is the verify now. Nothing was saved."* and the attempt is audited (`till.verify_retired`). Drawers verified before Fix Phase 6 keep their history.

**Related back-office pages** (Registers menu):
- **Cash drawer reports** (`/admin/registers/history`): closed, reconciled and verified sessions, each with a printable summary. After a Phase 2.1 reconcile the summary also prints **Cash sales on this drawer (system figure)** and **Refunds paid from this drawer**. Drawers reconciled before Phase 2.1 were typed, so those rows are left off.
- **End of day** (`/admin/registers/eod`): the whole-store day, marked *"Preliminary — a drawer is still open"*, *"Closed — N drawers awaiting manager reconcile"* (D87) or *"Final — all drawers closed and reconciled"*. Printable.
- **Store safe** (`/admin/registers/safe`): *"The $1,000 change fund behind the registers."* AM/PM counts → SOP-02.
- **Over / short warnings** (`/admin/registers/over-short`, owner and admin only): every drawer and master till count more than $5.00 over or short, with who, when, how much and the reason (step 6 above).
- **Register exceptions** (`/admin/registers/exceptions`) → 4.32.
- **Rounding**, **Scanning** (policy, `settings.manage`) and **Devices** (`staffing.manage`) → SOP-17.

### 4.31 Locking, auto-lock and resuming

- **Lock after every sale.** **Done — lock register** (4.16) or **MORE ▾ → 🔒 Lock register**.
- **Auto-lock:** after **2 minutes** with no touch or keypress, the register locks by itself. That includes the middle of a sale. It also locks when the app is hidden (switching apps, closing the iPad cover).
- **What happens to a sale in progress:** the register **parks** it on this iPad. When the **next** person unlocks, it checks the parked sale again before resuming:
  - It must be under **30 minutes** old.
  - The customer must still be 21+ by today's Pacific date, and the ID must not have expired since.
  - Any medical card must still be in effect.
  - If all checks pass, the sale reopens **past the ID check** with the same cart, **repriced** at current menu prices.
  - Otherwise you see why, for example *"Parked sale is too old to resume — rescan the ID."*, *"Parked ID has since expired — rescan the ID."*, *"Parked medical card has expired — restart the sale."*, and you start fresh at the ID check.
- **Whoever unlocks owns the sale from that point.** Do not unlock with your PIN to finish someone else's customer unless you are taking over that customer.
- **Parking is not holding.** A parked sale resumes only on the next unlock. Use **⏸ Hold sale** (4.18) when the customer steps away.

### 4.32 Offline mode, sync and rejected events

The register keeps working through a short internet outage, with limits.

**Works offline:** ringing and completing a cash sale with an already-open drawer, already-unlocked register and downloaded menu; clock in/out on the lock screen; reprint last receipt; printing (the printer is local).

**Needs a connection (each shows an "Offline — …" message):**

| Action | Offline message |
|---|---|
| Unlock | *"Offline — unlock requires a connection in this build. (Offline PIN cache ships with the Capacitor app.)"* |
| Count in, drop, swap, close | *"Offline — drawer actions need a connection to verify your PIN and record the cash."* |
| No sale, override, scan unlock, void, return | *"Offline — manager approval needs a connection to verify the PIN."* |
| Special discounts, discount adjust | *"Offline — employee PINs can only be verified with a connection."* / *"Offline — employee PINs need a connection to verify."* |
| Loyalty redemption | *"Offline — loyalty redemption needs a connection. Ring the sale without it, or reconnect."* |
| Member lookup | *"Offline — ring the sale without the member, or reconnect first."* |
| Email receipt | *"Offline — print the paper receipt instead."* |
| Member history | *"Offline — history needs a connection."* |
| Pickup queue | *"Offline — the pickup queue lives on the server."* |
| Mark out of stock | *"Offline — flagging stock needs a connection (it changes the shared menu)."* |
| Day report | *"Offline — the day report needs a connection to verify the PIN and read the day's ledger."* |

**How sync works.** Every sale, punch and cart adjustment is saved on the iPad first, as an event in a queue, then uploaded. Uploads are safe to repeat: the same event is never counted twice. The footer **SYNC** shows how many are waiting. **Sync now** pushes them immediately.

**Do not** clear the browser or app data, sign out the device, or reinstall the app while **SYNC** shows pending events. The sales live only on that iPad until they upload.

**Rejected events.** If the server refuses an event outright, it stays **on the iPad**. The footer **QUEUE** shows *"N rejected — kept on this register; back office has been notified"*, and a banner shows the first reason. Register Activity lists the iPad under **Rejected events on registers**. Tell a manager. Do **not** re-ring until a manager has looked.

**Exceptions.** If the server accepts a sale but cannot finish it, it goes to **Register exceptions** (`/admin/registers/exceptions`, `staffing.manage`). The page says: *"Fix the underlying problem FIRST, then resolve with a note. Resolving never replays the event — re-ring at the register if the sale still needs to happen."* Typical reasons:

| Exception reason (shortened) | Fix |
|---|---|
| *"Medical sale: no ACTIVE recognition card with UPID … exists in the back office. Intake the patient's card (Admin → Medical)…"* | Intake the card, then resolve |
| *"A sale cannot carry BOTH a loyalty redemption and a special discount — re-ring with one or the other…"* | Re-ring correctly, then resolve |
| *"The <kind> discount program is turned OFF — the register applied it from a stale menu. Refresh the register's menu, re-ring…"* | **MORE ▾ → Refresh menu**, re-ring |
| *"The <kind> discount rate changed (register applied … bps; the saved rate is … bps)…"* | Refresh the menu, re-ring |
| *"Sale claims to have occurred BEFORE its drawer session was opened. Needs manager review."* | Manager reviews the timeline (iPad clock?) |
| *"Sale references a drawer session belonging to a DIFFERENT register. Needs manager review."* | Manager reviews the device binding |
| Legal-limit / High-THC / friends & family cap / loyalty code problems | Per the message; never re-ring a sale that breaks a legal rule |

The day report counts exceptions under **Exceptions (manager queue)**. A sale sitting in exceptions is **not** in the day's sales totals.

### 4.33 Marking an item out of stock ("86 it")

Use this when the shelf is empty but the register still shows the item.
1. In the cart or browse view, open the item's info (tap its photo/name).
2. Tap **Shelf is empty? Mark out of stock…**.
3. Read: *"Remove <item> from every register and the website? Pick why — a manager brings it back through the back office when stock returns."*
4. Pick a reason: **shelf empty**, **damaged / unsellable** or **wrong listing**.

It is **one-way at the register**. The item disappears from every register and the website. A manager restores it at **Inventory → "Marked unavailable, but you have stock" → Restore to sale**. Restoring recalculates from the live lot count, so it can never invent stock. It needs a connection.

Do **not** 86 an item just because you cannot find it. Ask someone first, because this removes it for every customer and the website.

### 4.34 Other MORE-menu items

| Item | What it does |
|---|---|
| **Reprint last receipt** | Reprints the last sale on this iPad. Never opens the drawer. Greyed out (*"Available after the first sale on this device"*) until there is one. |
| **🏆 Leaderboard** | Rankings by completed sales today (*"Dollar totals stay off the same-day board so drawer counts stay blind."*) and by gross for the trailing 7 days. Online only. |
| **🔄 Refresh menu** | Downloads the latest menu, prices, promotions and discount settings. Do this after the back office changes prices or programs, after an exception tells you to, or if an item is missing. Between customers only. |
| **🖨 Receipt printer** | Printer setup and status (SOP-17). |
| **☀️ Light mode / 🌙 Dark mode** | Changes the colour theme on this iPad only. |
| **⚕️ Turn ON medical test mode (simulate endorsement)** / **🧪 Turn OFF medical test mode** | **Training only.** It pretends the store is medically endorsed so staff can rehearse a tax-free medical sale. *"TEST ONLY … Turn OFF for real sales until the store is actually endorsed."* While it is on, an amber banner shows on every screen. **Never ring a real sale with it on.** Two locks now stop a mistake (Phase 0.1, F-01-14 FIXED). (1) The register refuses payment when test mode took any tax off. (2) If such a sale still reaches the server, the sync checks the store's **real** endorsement and turns the sale into an exception instead of recording it. You can still rehearse the medical flow up to the payment screen. (3) Since A-06 this menu item only appears when the owner has set **Register medical test mode** to AVAILABLE on Back office → Medical; by default it is hidden. |
| **⏱️ Clock in / Clock out** | Punches the signed-in employee (4.2). |
| **🔒 Lock register** | Locks now (4.31). |

### 4.35 Manager: the cashier shift report (per cashier, printable)

**Who:** managers and up (`inventory.manage`, the same gate as Cash drawer reports). **Where:** Register Activity → **Cashier shift report** (`/admin/registers/cashiers`).

G-05 asked for *"a printable per-cashier shift summary (sales, voids, no-sales, discounts, adjustments by employee)"* (owner's original request: *"shift close reports"*). Built in Phase 2.1b (owner message 6: *"please completely finish G-05 (2.1), the per cashier print out"*).

1. Pick **From** and **To** (Pacific business days, up to 31 days; `CASHIER_REPORT_MAX_DAYS`, `cashier-report-core.ts` L418) and tap **Show**. A bad date or a range over 31 days shows an error, nothing else.
2. The summary table lists each cashier: **Shifts, Sales, Gross, Cash, Discounts, No-sales, Adjustments, Voids, Returns, Net**, then a **Store** row.
3. Below it, one section per cashier (each starts on a new printed page) with **All shifts** and then each **Shift · <day>**: Sales (and units), Gross (tax in), Pre-tax / tax, Average sale, Cash, Employee tab, Other tender, Cash rounding, Medical sales, Registers; **Discounts total** split into Deals and sale prices, Manager overrides, Loyalty rewards, Special programs (by kind) and Medical tax exempt (the parts always add up to the total, the same split the receipt explains); **No-sales (drawer opened)** with each reason and who approved it; **Cart adjustments** (lines removed, quantities lowered, carts cancelled, and their value); **Voids of their sales**, **Returns of their sales**, **Net after refunds**.
4. A line at the end of each cashier's section reads *"cashier sign-off: ____ · manager: ____"*. Print with **Print**, sign, and file with the day's close slips. **Download CSV** gives one row per shift.

**How the figures are made** (`buildCashierReport`, core L297; read by `loadCashierReport`, `cashier-report-store.ts` L57):
- A **shift** is one cashier on one business day. Sales and no-sales come from the register events, which always carry the employee signed in to ring them. Only **processed** sales count as money (the X/Z rule); exceptions and pending sales are counted, shown as *"Not counted as money"*.
- Voids and returns do not record a cashier, so each is filed against the cashier who **rang the original sale**, on the day of the refund. A refund that cannot be traced to a register sale (an online order) is listed separately and given to nobody (`untracedNote`, L533).
- If any record fails to load the page says *"This report is incomplete. Do not file it until it loads cleanly."* and the CSV refuses to download (409) until it loads.

### 4.36 Tip Tracker (Employee menu)

**Who:** everyone with a time clock (`timeclock.use`) sees **their own** tips; managers (`staffing.manage`) see everyone and can correct a figure. **Where:** Employee → **Tip Tracker** (`/admin/staffing/tips`; menu entry `admin-nav-data.ts` L109). Owner, message 6: *"I want to add to this an employee tip tracker with a new page in the employee drop down menu to track tips and give stats on them."*

**Where the figure comes from (existing, unchanged).** At close the cashier counts the tip jar by itself and types it in **Tips (counted separately)** on the iPad close (§4.27) or the back-office close form. It is stored on the drawer session (`drawer_sessions.tips_minor`, migration 0134). Tips are the employee's money: they never enter the drawer count, the expected figure or the over/short. A blank box is **not recorded**; `$0.00` means an empty jar was counted. They are different and stay different.

1. Pick **From** and **To** (up to 366 days; `checkTipRange`, `tips-core.ts` L220) and tap **Show**.
2. The cards show **Total tips**, **Average per close** (recorded closes only), **Closes not recorded** and **Best day of the week**.
3. **By employee**: Total, Closes, Recorded, Not recorded, Average, Highest (and the day), Hours worked (from the time clock in the same days) and Per hour.
4. **By day of the week**, and every session: Day, Register, Closed by (with *"opened by …"* when someone else opened it), Status, Tips.
5. **Who gets the tips:** the employee who **closed** the session (`buildTipReport`, L110). The app never splits tips by itself; if two people shared a drawer, settle it by hand and correct the figure.
6. **Correcting a figure (managers):** in the session's **Correct** column type the amount (or leave it blank for not recorded) and a **Reason (required)** (5–300 characters), then **Save**. An open drawer is refused (*"That drawer is still open. Tips are recorded when it is closed."*). If somebody changed it since the page loaded: *"The tip figure changed (or the drawer is open) since this page loaded. Nothing was changed; reload and try again."* Every correction is logged with the old and new amounts and the reason (`drawer.tips_corrected`, `tips-store.ts` L145).
7. **Print** or **Download CSV**. If your sign-in is not linked to an employee record the page says *"Your sign-in is not linked to an employee record"*: ask a manager to link it (SOP-08).

### 4.37 Register Activity buttons

Since Phase 2.9 (owner message 6: *"The register activity page also, the top button bar, is cutoff. Can you fix it so everything is visible on screen."*) the buttons along the top of Register Activity sit in their own full-width row under the title and **wrap onto as many lines as they need**, so none is cut off on any screen (`AdminPageHeader.tsx` `toolbar`, L76; `registers/page.tsx` L123). The order: End-of-day report, Cashier shift report, Cash drawer reports, Over / short warnings (owner and admin), Exceptions, Returns desk, Safe, Deposit bags, Supply runs, Tip tracker, POS devices, Receipt design, Cash rounding, Scan-required mode.

---

## 5. Hard blocks: "If you see this message"

**How to read this table.** A **BLOCK** stops you until the cause is fixed. A **WARN** lets you carry on but asks you to check something. "Call" says who can help. A manager or lead can approve a PIN step **only** where this SOP says so. **Nobody can override a legal block.**

### 5.1 PIN, unlock and approval

| Message (exact) | Type | Why | What to do | Call |
|---|---|---|---|---|
| *"Enter a valid 4–6 digit PIN."* (also *"…manager PIN."*) | BLOCK | PINs are 4–6 digits | Re-type | — |
| *"No active employee for that PIN."* | BLOCK | Wrong PIN, or the employee is inactive | Re-type carefully. Every miss counts toward the lockout. | Manager (employee record) |
| *"Too many wrong PINs — the PIN pad is locked for N more seconds."* | BLOCK | 5 misses in 60 s locks this iPad's PIN pad for 60 s (stops guessing) | Wait | — |
| *"This device is not bound to a register — a manager must assign one in the back office."* | BLOCK | The iPad has no register assigned | Stop. Use another register. | Manager (SOP-17) |
| *"Handbook acknowledgment required before using the register. Read the employee handbook in the back office and check the acknowledgment box (or have a manager mark your signed paper copy in your employee file)."* | BLOCK | Owner rule: no register use without a current handbook acknowledgment | Acknowledge it | Manager |
| *"Offline — unlock requires a connection in this build…"* | BLOCK | PINs are checked by the server | Restore internet. You can still clock in/out. | Manager |
| *"<name> is not a manager or lead — approvals need a manager PIN."* (also *"…voids need…"*, *"…returns need…"*, *"…safe swaps need…"*, *"…cancelling an order needs…"*, *"…the day report reveals expected drawer cash."*) | BLOCK | That step needs a lead or manager | Get a lead or manager | Lead / manager |
| *"That's your own PIN — a second employee on duty must approve."* | BLOCK | Two-person rule: you cannot approve yourself | Get another employee | Co-worker |
| *"<name> is not clocked in — the approver must be on duty."* | BLOCK | Approvers must be on shift | They clock in first, or get someone on duty | Co-worker |

### 5.2 Starting a sale

| Message (exact) | Type | Why | What to do | Call |
|---|---|---|---|---|
| *"Count in your drawer first…"* | BLOCK | Every sale belongs to a counted drawer | Count in (4.3) | — |
| *"You're not clocked in…"* (**Clock in now**) | BLOCK | Sales must be tied to a worked shift | Clock in | — |
| *"The menu hasn't downloaded yet…"* | BLOCK | No prices or items on the iPad | Connect, **Refresh menu** | Manager |
| **Sales hours** screen: *"WAC 314-55-147 prohibits cannabis sales between midnight and 8:00 AM (store time). This sale cannot be completed until 8:00 AM Pacific."* | BLOCK (legal) | State law | Wait. No override. | — |
| **Sales hours**: *"This store's configured sales hours are X–Y (store time). An owner can widen the window in Settings → Sales hours…"* | BLOCK | Owner's window | Wait, or ask the owner | Owner |

### 5.3 ID and medical

| Message (exact) | Type | Why | What to do | Call |
|---|---|---|---|---|
| *"Customer is under 21 (age N). Sale refused."* | BLOCK (legal) | RCW 69.50.357 / WAC 314-55-079 | Refuse politely. No override. | Manager if there is a dispute |
| *"ID expired YYYY-MM-DD. Expired identification is not acceptable (WAC 314-55-150)."* / *"Document expired …"* | BLOCK (legal) | Expired ID is not valid ID | Ask for another valid ID | — |
| *"Not an AAMVA DL/ID barcode (no ANSI header found)."* … *"If the barcode won't read, use manual verification."* | BLOCK (scan) | The barcode is not a licence barcode | Rescan the back barcode, or use **Other ID / won't scan** | — |
| *"DOB says age N — under 40. House policy: scan the ID (the visual check is only for customers clearly 40+)."* | BLOCK (house) | House rule: under 40 must scan | Scan, or use manual verification with a reason | — |
| *"Select an acceptable ID type from the WAC 314-55-150 list."* | BLOCK | Only the listed IDs are legal | Pick the document type | — |
| *"Enter why the ID was verified manually (3–500 characters)."* | BLOCK | Manual checks are audited | Write the real reason | — |
| *"Confirm the photo matches the customer."* | BLOCK | ID must belong to the person | Compare the photo, tick | — |
| *"Enter the date of birth exactly as shown on the document."* / *"Enter the document's expiration date."* | BLOCK | Needed to check age and validity | Type it | — |
| *"Medical config not in the cached menu — refresh the menu while online to enable medical sales."* | BLOCK (medical) | iPad has no medical settings | **Refresh menu** online | Manager |
| *"Customer is under 18. Sale refused — no medical exception exists at retail."* | BLOCK (legal) | No retail sale under 18 | Refuse | — |
| *"Customers 18–20 may only buy with a valid recognition card at an endorsed store."* | BLOCK (legal) | RCW 69.50.375 | Refuse unless both are true | — |
| *"Recognition card expired …"* / *"Card is not effective until …"* | BLOCK (medical) | Invalid card = no medical benefits | Ring as recreational (if 21+) or refuse | — |

### 5.4 Cart

| Message (exact) | Type | Why | What to do | Call |
|---|---|---|---|---|
| *"<name> is a cannabis item — scan its package barcode to add it. (Manager PIN can lift this for one sale.)"* | BLOCK | Scanning proves which package left the shelf (traceability) | Scan the package. If the label is damaged, a manager uses **Manager unlock**. | Lead / manager |
| *"Barcode "X" matched nothing on the menu — check the label or search by name."* | BLOCK | Unknown barcode | Search by name, then tell a manager (SOP-04 labels) | Manager |
| *"none left in stock"* / *"only 1 left — that one is already in the cart"* | BLOCK (soft) | Count says none left | Check the shelf. If the unit is really there, tap **Sell anyway — the unit is on the shelf**. | — |
| *"Over the WAC 314-55-095 single-transaction limit — remove items."* | BLOCK (legal) | Purchase limit per sale | Remove items. Never split the sale. | — |
| *"Over the configured limit (soft warning)."* | WARN | Owner set warn-only | Still do not sell over a legal limit | Manager |
| *"<item> is a DOH High-THC product and may ONLY be sold to a patient with a valid recognition card (chapter 246-70 WAC)…"* | BLOCK (legal) | DOH rule | Remove it, or restart on the medical path | — |
| *"<item>: this takes the last one in stock."* / *"…menu shows only M left — check the shelf before promising."* | WARN | Low count | Check the shelf | — |
| *"A saved sale is holding stock this cart needs — saved by <name> <time ago>."* | WARN | Another held sale uses the item | Only delete the saved sale if that customer left | — |

### 5.5 Discounts and price changes

| Message (exact) | Type | Why | What to do | Call |
|---|---|---|---|---|
| *"Nothing to take off — every item is already at a better deal than this program (best deal wins, no stacking) or at its legal floor."* | BLOCK | Best deal wins, no stacking | Nothing to do; the customer already has the better price | — |
| *"That's the cashier logged into THIS register — employees buy on a register they're not logged into."* | BLOCK | Nobody rings their own discount | Use another register, or have a co-worker ring it up | — |
| *"The witness must be someone OTHER than the buyer."* | BLOCK | Two-person rule | Get another witness | — |
| *"Attach the guest's customer account first (look them up or sign them up)… no account, no discount."* | BLOCK | F&F is capped per account | Attach or sign up the guest | — |
| *"The sponsor must be someone OTHER than the cashier ringing this sale."* | BLOCK | Two-person rule | Another employee sponsors | — |
| *"This guest already used friends & family N time(s) in the last 30 days (limit X)."* | BLOCK | Owner cap | Regular price | Owner (cap setting) |
| *"Code not found, expired, or already used. Check the code with the customer."* | BLOCK | Codes are single-use | Check the code | — |
| *"Not enough points: balance N, minimum M."* | BLOCK | Program minimum | No redemption | — |
| *"This member has no loyalty account yet — points start earning on their first completed sale."* | BLOCK | No account yet | Ring without redemption | — |
| *"The loyalty program has no point cash value configured."* | BLOCK | Setup missing | Ring without redemption | Owner |
| *"An override must LOWER the price — the line already charges $X…"* | BLOCK | Markdown only; prices are set in the back office | Fix the price in the back office | Manager |
| *"$X is below this item's floor of $Y (statutory cannabis minimum / acquisition cost — RCW 69.50.357, WAC 314-55-155). No PIN can approve it."* | BLOCK (legal) | No giveaways, no below-cost sales | Choose a price at or above the floor | — |
| *"Pay later is only for an employee purchase (apply the employee discount first)."* | BLOCK | Tabs are for employee purchases only | Apply the employee discount first | — |
| *"Offline — employee PINs can only be verified with a connection."* | BLOCK | PINs are checked by the server | Reconnect, or ring without it | — |
| *"PIN checks need the register shell — restart the app."* | BLOCK | App not fully loaded | Restart the app (between sales) | Manager |

### 5.6 Done screen, printing, email

| Message (exact) | Type | Why | What to do | Call |
|---|---|---|---|---|
| *"… The drawer did not open — use No Sale if you need it."* | WARN | Printer failed; the drawer kicks through the printer | Fix the printer. If you need the drawer, use **No Sale** with a manager. | Manager / SOP-17 |
| *"Pop-up blocked — allow pop-ups for this site to use browser printing."* | WARN | Browser setting | Allow pop-ups | — |
| *"Email receipts are not configured — print the paper receipt."* / *"Email did not go through — offer the paper receipt instead."* | WARN | Email is not available | Print | — |
| **Count check needed** | WARN | Sold more than the count | Check the shelf and report it | Manager |

### 5.7 Voids, returns, no sale

| Message (exact) | Type | Why | What to do | Call |
|---|---|---|---|---|
| *"Voids are same-day only (Pacific business day). For an earlier sale, use the returns desk — it handles the return policy, restock/destroy, and CCRS corrections."* | BLOCK | Same-day control | Use **Return an item** | Manager |
| *"This sale has already been voided."* | BLOCK | Only once | — | — |
| *"Only COMPLETED sales can be voided (this order is "…")."* / *"This sale can't be returned because it was never finished …"* | BLOCK | The sale is not finished (still syncing, or an exception) | Wait for sync, or check exceptions | Manager |
| *"Part of this sale was already returned at the returns desk — voiding now would refund the same items twice. Process the rest as a return instead."* | BLOCK | Prevents a double refund | Use **Return an item** | Manager |
| *"The sale has no completion timestamp — void it from the back office instead."* | BLOCK | Data problem | Back office | Manager |
| *"Give a reason (at least 3 characters) — it is logged to the audit trail."* / *"Keep the reason under 500 characters."* | BLOCK | Audit | Write a reason | — |
| *"A manager or lead must approve the void (PIN)."* | BLOCK | Control | Manager PIN | Lead / manager |
| *"This sale was N days ago, and our store policy only allows returns within N days (the N-day return window). Please politely refuse the return."* (the owner's setting, default 7) | BLOCK (policy) | Store policy | Refuse | Owner for exceptions |
| *"This sale has no loyalty member on it, and our store policy only allows returns on loyalty purchases. Please politely refuse the return."* | BLOCK (policy) | Store policy | Refuse | — |
| *"This sale's date is in the future, which usually means the register's clock is wrong. Check the date and time on the register, then try the return again."* | BLOCK | iPad clock problem | Check the iPad's date/time | Manager |
| *"Everything on this line of the sale has already been returned, so there is nothing left to return."* / *"You're returning N, but only M of this item can still be returned on this sale. Lower the quantity to M or less."* | BLOCK | Prevents a double refund | Fix the quantity | — |
| *"Pick the line item being returned."* / *"Pick a valid return reason."* / *"Pick restock or destroy."* / *"Tap the item the customer is returning first."* | BLOCK | Required fields | Fill them in | — |
| *"Enter the receipt number."* | BLOCK | Required | Type the 8-character number | — |
| *"Offline — manager approval needs a connection to verify the PIN."* | BLOCK | Server check | Reconnect | — |

### 5.8 Drawer (till)

| Message (exact) | Type | Why | What to do | Call |
|---|---|---|---|---|
| *"Count in at least one bill or coin — an empty float cannot open a drawer."* | BLOCK | A drawer needs a float | Count the float | — |
| *"This register already has an open drawer. Close it first."* | BLOCK | One drawer per register | Use the open drawer, or close it | Manager |
| *"No open drawer on this register."* | BLOCK | Drop/swap/close need an open drawer | Count in | — |
| *"A drop cannot witness itself — a second person must enter their PIN."* | BLOCK | Two-person rule | Another person, or no witness | — |
| *"A second employee must count the drawer and enter their PIN before it can close (owner rule D2). Any employee can do it, but not you."* | BLOCK | Owner rule D2: a second count at every close | Hand the iPad to any other employee | Co-worker |
| *"The second count must be done by a different employee. Hand the count to someone else and have them enter their own PIN."* | BLOCK | The closer typed their own PIN as the second counter | Another employee counts and enters their PIN | Co-worker |
| *"No active employee for the second PIN."* / *"The second employee's PIN must be 4–6 digits."* | BLOCK | The second PIN did not match an active employee (counts toward the PIN lock) | Re-type carefully | — |
| *"WARNING: the second count by <name> differs by $X …"* | WARN | The two counts are different. The drawer **is** closed and both counts are saved | Tell the manager on duty; recount together if you can | Manager |
| *"This drawer was closed by someone else a moment ago. Nothing was changed."* | BLOCK | A second close of the same drawer (two taps or two iPads) | Nothing; it is already closed | — |
| *"The second count cannot be saved yet: database migration 0314 has not been applied. Nothing was changed."* | BLOCK | Setup not finished | Use the paper close slip (8.2) and tell the owner | Owner |
| *"Pick a drop window (afternoon, night, or other)."* | BLOCK | Required | Pick one | — |
| *"Drop amount must be a positive whole number of cents."* / *"Drop amount is implausibly large — check the number."* | BLOCK | Typo guard (max $50,000) | Re-type | — |
| *"A manager or lead must approve the swap with their PIN."* / *"A swap cannot approve itself — a manager or lead must enter their PIN."* | BLOCK | Control | Manager or lead | Lead / manager |
| *"Notes must be 500 characters or fewer."* | BLOCK | Length | Shorten | — |
| *"You still have an open drawer on <register>. Close your drawer first (blind count and second count), then clock out. …"* | BLOCK | Owner rule D84: no clock-out while you own an open drawer | Close your drawer (4.27), then clock out | — |
| *"This count-in is $X over / short of the standard float of $Y …"* | WARN | Owner rule D85: the count-in is not the standard float. The drawer still opens | Recount; if right, open and tell the manager | Manager |
| *"The number of people sharing the tips must be between 1 and 10."* / *"The crew tip pool must be zero or more, in dollars and cents."* | BLOCK | Crew tip pool typo guard (D89) | Re-type | — |
| *"Tips must be zero or a positive whole number of cents."* / *"Tips amount is implausibly large — check the number."* | BLOCK | Typo guard | Re-type | — |
| *"Offline — drawer actions need a connection to verify your PIN and record the cash."* | BLOCK | Server check | Reconnect | Manager |
| *"Till action failed — try again."* / *"Could not reach the server — try again."* | BLOCK | Network or server error | Try **once** more. If it fails again, stop and call a manager. Do not tap repeatedly (F-01-2). | Manager |

### 5.9 Back office (managers)

| Message | Why | What to do |
|---|---|---|
| *"Drawer must be closed before reconciling."* | The drawer is still open, or already reconciled | Close it first, or refresh the page |
| *"Till must be closed before it can be verified."* | Wrong state | Refresh |
| A database error mentioning **uuid** after typing a name in **Reconciled by** / **Verified by** | Findings F-00-3/F-00-4/F-01-5 | Leave the box blank; sign the paper slip |

---

## 6. Exceptions & escalation

| Situation | First step | Escalate to |
|---|---|---|
| Customer disputes an ID refusal | Stay polite. Do not argue the law. Offer to have a manager explain. | Manager on duty |
| Fake or altered ID suspected | Refuse the sale. Hand the ID back unless the manager directs otherwise. Note the time. | Manager, then the owner |
| Possible straw purchase (an adult buying for a minor) | Refuse the sale (Employee Handbook) | Manager |
| Visibly intoxicated customer | Refuse the sale (Employee Handbook: *"Never sell to anyone who is visibly intoxicated or who you believe is buying for a minor."*) | Manager |
| Register will not unlock (any reason in 5.1) | Try another register | Manager → owner |
| Internet down | Keep ringing sales on an open drawer. No PIN steps are possible. | Manager. If the outage lasts, stop sales that need approval. |
| Printer down | **Browser print** for receipts; **No Sale** cannot open the drawer without a printer (the printer kicks the drawer). Use the drawer key if the store has one. | Manager / SOP-17 |
| Rejected events or exceptions on the iPad | Do not re-ring. Do not reset the iPad. | Manager → owner |
| Drawer over or short by more than $5 at reconcile | Write the required reason in the Reconcile card (4.30 step 6); it lands on the owner's **Over / short warnings** screen. Form 8.5 only if migration 0315 is not applied | Owner (D7) |
| Two drawers open on one register (F-01-1) | Stop. Do not ring more sales. | Manager → owner |
| Robbery | Comply. Do not resist. Call 911 when safe. Do not touch anything. | Owner (who handles any required reporting; security SOP) |
| Adverse reaction reported at a return | Process the return as **Adverse reaction** | Manager → product-complaint process |
| Marketplace cancels an order mid-sale | Follow the banner (4.20) | Manager |

---

## 7. Controls & compliance (why the rules exist)

| Rule | Source | How the register enforces it |
|---|---|---|
| No sale to anyone under 21 (18–20 only with a valid recognition card at an endorsed store) | RCW 69.50.357(2), RCW 69.50.375 | ID gate before the cart (4.5); age and expiry checks; medical path (4.6) |
| Acceptable ID types only | WAC 314-55-150 | Manual-check type list; expired ID refused |
| Retail sales hours 8:00 AM–midnight | WAC 314-55-147 | **Sales hours** block on the device |
| Single-transaction purchase limits | RCW 69.50.360 / WAC 314-55-095 | Legal-limit meter; hard block (owner may set warn-only) |
| Medical 3× limits; recognition card; exempt-sale records | WAC 314-55-095(2)(d), WAC 314-55-090, ch. 246-70 WAC | Card capture and DOH verify attestation; server writes the exemption ledger or refuses the sale |
| High-THC products to carded patients only | ch. 246-70 WAC | Hard block, no override |
| No giving away cannabis; no sale below cost | RCW 69.50.357, WAC 314-55-155 | 1¢ and acquisition-cost floors on every discount/override |
| Returns: original packaging, legible lot ID | WAC 314-55-079(12) (store policy is stricter) | Return attestations; CCRS correction queued |
| Traceability | CCRS reporting (WAC 314-55-083(4)) | Scan-required for cannabis items; every sale and return reported |
| Cash controls (internal) | Owner policy | Blind close, drops, swaps with approver, no-sale with reason + manager, void/return with manager, two-person discounts, cart-adjustment tracking, auto-lock |

**Why these internal controls matter:** cash businesses lose money mostly through small, repeated, unexplained gaps: an extra drawer opening, a quiet void, a discount given to a friend. Every control in this SOP leaves a record **with a name on it**. Honest staff are protected because the record shows what really happened.

---

## 8. Checklists & forms

Print these from this page. Keep completed forms with the day's paperwork (SOP-03). The retention period is set in SOP-03 with the owner. Until then, keep everything and throw nothing away.

### 8.1 Shift-open checklist (budtender)

- [ ] Clocked in (lock screen → **Clock in / out instead**)
- [ ] Register unlocked; top right shows **clocked in** and **Online**
- [ ] Footer: **MENU** has today's time; **QUEUE all clear**; **SYNC** 0 pending
- [ ] **No** amber "Medical TEST MODE" banner
- [ ] Printer is on with paper (the drawer opens only through the printer)
- [ ] My **own insert**; float counted twice; if the gold float warning shows, recount and tell the manager (D85); **Open drawer with $X** done
- [ ] Scanner charged and scanning
- [ ] I know who the manager/lead on duty is (for PIN approvals)

### 8.2 Close slip (one per drawer)

```
GREENWAY — DRAWER CLOSE SLIP                     Date: ____/____/______
Register: ____________   Cashier: ______________________  Time closed: ______

BLIND COUNT (cashier)                 SECOND COUNT (any 2nd employee — D2)
$100 x ____ = ________                $100 x ____ = ________
$50  x ____ = ________                $50  x ____ = ________
$20  x ____ = ________                $20  x ____ = ________
$10  x ____ = ________                $10  x ____ = ________
$5   x ____ = ________                $5   x ____ = ________
$2   x ____ = ________                $2   x ____ = ________
$1   x ____ = ________                $1   x ____ = ________
$1c  x ____ = ________                $1c  x ____ = ________
50¢  x ____ = ________                50¢  x ____ = ________
25¢  x ____ = ________                25¢  x ____ = ________
10¢  x ____ = ________                10¢  x ____ = ________
5¢   x ____ = ________                5¢   x ____ = ________
1¢   x ____ = ________                1¢   x ____ = ________
TOTAL      = ________                 TOTAL      = ________
Counts agree?  [ ] Yes  [ ] No → recounted together, final: ________

Tips (separate, not in drawer): ________
Drops recorded today (time · amount · witness):  ____________________________
Swaps recorded today (see form 8.3):              ____________________________
Voids paid from THIS drawer (receipt # · $):      ____________________________
Returns paid from THIS drawer (receipt # · $):    ____________________________
No-sale opens (time · reason · manager):          ____________________________

Cashier signature: ____________________   2nd counter signature: ____________________

MANAGER RECONCILE                      MORNING VERIFY
Cash sales entered: ________           Recount total: ________
Over/short shown:   ________           Agrees with close?  [ ] Yes  [ ] No
Over/short > $5? [ ] Yes → form 8.5   Verifier: ____________  Time: ______
Reason (any over/short, even < $5): ________________________________
Manager: ____________  Time: ______
```

### 8.3 Change-swap denomination log (register ↔ master till) — replaced by SOP-02 form 8.3

> **Use SOP-02 form 8.3** (finding F-02-8, fixed in v1.8). This form's old title said *"master till ↔ little safe"*, but a register swap is **till ↔ master till** (owner D14); the master till ↔ little safe exchange is SOP-02 form 8.2 and is recorded on the Store safe page. Since Phase 2.7b the register records the bills both ways, so a paper line is needed only for an iPad not yet rebuilt. The layout below is kept for reference.

```
Date | Time | Register/till | OUT of till → little safe (big bills) | IN from little safe → till (small bills & coin) | Value each side | Recorded by | Approved by (mgr/lead) | Matches register "Record swap"? 
     |      |               | e.g. 5×$20                           | e.g. 10×$5, 40×$1, 2 rolls 25¢ ($20)           | $100.00         |             |                        | [ ]
```
Only for swaps from an iPad not yet rebuilt (they show *"not recorded (value only)"* on the Store safe page). A rebuilt register keeps **which bills and coin** itself.

### 8.4 Second-person count sign-off (D2)

Part of form 8.2. Any second employee counts alone, without seeing the first count, then the two compare. Both sign.

> **Since Phase 2.2 (G-01) the register records the second count** (4.27 step 9): the second person's PIN, their own denominations and total. Use this paper sign-off only when the register cannot take it (migration 0314 not applied). Otherwise the slip's second-count column may be left blank.

### 8.5 Over/short reason form (D7: more than $5.00)

> **Since Phase 2.3 (G-03) the reason is written in the app** at reconcile (4.30 step 6) and the owner reads it on **Over / short warnings**. Use this paper form only when migration 0315 is not applied (the banner says the reason is in the Security Log only).

```
GREENWAY — OVER/SHORT REASON           (required when |over/short| > $5.00)
Date of drawer: ____/____/______   Register: __________
Cashier(s) on the drawer: ______________________________
Reconciled by: __________________   Reconciled at (time): ________
Amount:  [ ] OVER  [ ] SHORT   $__________
Reason (REQUIRED — what most likely happened; checks done):
______________________________________________________________________
______________________________________________________________________
Recount done? [ ] Yes  By: ______________   Result: ______________
Cashier signature: ____________________   Manager signature: ____________________
Owner reviewed: ____________________   Date: ________
```

### 8.6 Manager end-of-day checklist

- [ ] Every drawer closed blind (with the second count and the crew tip pool), with a signed close slip (8.2); everyone clocked out on the lock screen after their close (D84)
- [ ] Z report printed (REPORTS → manager PIN)
- [ ] Register Activity: every closed drawer **reconciled** (cash sales worked out on paper, net of this drawer's voids/returns, never blank)
- [ ] Any over/short > $5 → reason written in the Reconcile card (form 8.5 only before migration 0315)
- [ ] **Register exceptions** reviewed; **Rejected events on registers** is empty
- [ ] Swap log (8.3) matches the register's swap records
- [ ] Cash and deposit handled per SOP-02 / SOP-03
- [ ] Every drawer reconciled by the night manager, or left for the morning manager **before the bag is sealed** (D87). Verify till is retired (D83): the morning bag recount is the verify

---

## 9. Quick reference card (print and keep at the counter)

```
┌──────────────────────────── GREENWAY REGISTER — QUICK CARD ────────────────────────────┐
│ START: Clock in → Unlock (PIN) → Count in drawer → check MENU / QUEUE / no TEST banner │
│ EVERY SALE: Start sale — scan ID → (medical box if carded) → scan items → discounts     │
│   LAST → Tender Cash → enter cash → Complete sale → Print receipt (opens drawer ONCE)   │
│   → count change back → Done — lock register                                           │
│ ID: under 40 = SCAN, every time. Vertical ID = MUST scan. Clearly 40+ = visual + DOB.   │
│ LEGAL — NO OVERRIDE: under 21 · expired ID · over limit · High-THC w/o card · 12–8 AM  │
│ ONE REWARD PER SALE: loyalty OR special discount, never both. Best deal wins.           │
│ PINS: Employee disc = buyer + different witness (buyer ≠ cashier).                      │
│   F&F = member attached + sponsor ≠ cashier. Adjust = 2nd employee on duty.            │
│   Override / Void / Return / No sale / Swap / Day report = MANAGER or LEAD.            │
│ CHANGED THE CART? Re-apply the loyalty/special discount.                               │
│ HOLD = ⏸ (one at a time, ID re-checked on load). CANCEL = recorded under your name.    │
│ VOID = same day only. RETURN = receipt, 7 days*, original pkg, legible lot. *setting   │
│ REPRINT = MORE ▸ Reprint last receipt (drawer stays shut). Don't re-tap Print.         │
│ DROP big bills (afternoon/night) + witness. SWAP = mgr PIN + bills BOTH WAYS on screen. │
│ CLOSE: drop first → crew tip pool → blind count → 2nd person counts → Record. Clock out after.│
│ OFFLINE: sales OK on open drawer; no PIN steps; never wipe the iPad with SYNC pending. │
│ STUCK? Read the message. It tells you why and what to do. Then call the manager.        │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **Blind count** | Counting the drawer without seeing what it should be |
| **Business day** | The Pacific-time calendar day a drawer or sale belongs to |
| **Cash drop** | Moving excess cash from the drawer to the safe mid-shift |
| **Change swap** | Equal-value exchange of big bills (out) for small bills and coin (in) with the safe |
| **Drawer session** | One drawer from count-in to close: open → closed → reconciled → verified |
| **Employee tab** | An employee purchase paid later (no cash in the drawer) |
| **Exception** | A synced sale the server could not finish. It waits in the back-office queue. |
| **Expected close** | Opening float + cash sales − drops (calculated at reconcile) |
| **Float** | The cash counted into the drawer at the start |
| **Hold / saved sale** | A cart parked by choice, on one iPad, until it is loaded or discarded |
| **Lead** | Job role that can approve manager-PIN steps at the register |
| **Over / short** | Counted − expected. Positive = over, negative = short. |
| **Park** | Automatic save of an in-progress sale on auto-lock, resumed at the next unlock if still valid |
| **Recognition card** | DOH medical cannabis card (UPID) |
| **Reconcile** | Manager step that calculates expected and over/short |
| **Rejected event** | An event the server refused. It stays on the iPad. |
| **Special discount** | Employee, friends & family, veteran or industry program |
| **Sync** | Upload of queued events from the iPad to the server |
| **Verify** | Morning manager recount of a reconciled drawer |
| **X / Z report** | Mid-day snapshot / end-of-day report for one register |
| **86** | Mark an item out of stock everywhere |

---

## Appendix A: Source map (verified at `main@d03fe15b`)

| SOP section | Code (read for this SOP) |
|---|---|
| 2, 4.1 unlock, PIN rules | `src/app/api/pos/unlock/route.ts`, `approve/route.ts`, `witness/route.ts`, `src/lib/staffing/handbook-ack-core.ts` |
| 4.2 clock | `src/app/(site)/pos/RegisterShell.tsx` (onPunch, clock-out guard), `src/lib/staffing/store.ts` (`toggleClock`, `openDrawersOwnedBy`), `src/lib/registers/shift-end-core.ts` (`clockOutBlocked`), `src/app/api/pos/unlock/route.ts` (`openDrawerSessionIds`, `clockOutBlockedMessage`, `defaultFloatMinor`) |
| 4.3 float check, 4.27 crew tip pool, 4.27a shift change | `shift-end-core.ts` (`floatCheck`, `splitTipPool`, `tipPoolSentence`), `src/app/api/pos/till/route.ts` (open: `drawer.float_warning`; close: `tipPool`), `src/lib/pos/till-core.ts` (`tipPool`), `src/app/admin/registers/actions.ts` (open/close), `src/components/admin/registers/RegisterControls.tsx` |
| 4.3, 4.25–4.27 till | `src/app/(site)/pos/RegisterShell.tsx` (TillModal L5611; second-count step L5643, L5660, L5982, L6012), `src/app/api/pos/till/route.ts` (close L243–294), `src/lib/pos/till-core.ts` (`secondPin` L66, `SECOND_COUNT_REQUIRED_ERROR` L72), `src/lib/registers/store.ts` (`closeDrawerBlind` L209, compare-and-swap L255), `src/lib/registers/second-count-core.ts`, `src/app/admin/registers/actions.ts` (`closeDrawerAction` L104), `src/components/admin/registers/RegisterControls.tsx` (L153), `src/lib/registers/cash.ts`, `supabase/migrations/0038_registers_drawers.sql`, `0314_drawer_second_count.sql` |
| 4.4 home screen, 4.34 MORE | `RegisterShell.tsx` (≈L2550–2915), `src/lib/pos/medical-testmode-core.ts` |
| 4.5–4.6 ID / medical | `src/lib/pos/id-scan-core.ts`, `src/lib/pos/medical-pos-core.ts`, `SaleFlow.tsx` (ID gate) |
| 4.7–4.10 cart, limits | `src/app/(site)/pos/SaleFlow.tsx`, `src/lib/pos/scan-required-core.ts`, `low-stock-core.ts`, `favorites-core.ts`, `src/lib/compliance/sales-limits-core.ts`, `sales-hours-core.ts` |
| 4.11–4.14 discounts | `src/lib/pos/special-discount-sale-core.ts`, `src/lib/discounts/special-discount-core.ts`, `src/lib/pos/price-override-core.ts`, loyalty in `SaleFlow.tsx` + `/api/pos/loyalty` |
| 4.15–4.17 tender, done, tab | `src/lib/pos/cash-rounding-core.ts`, `change-calc-core.ts`, `employee-loan-core.ts`, `SaleFlow.tsx` (done screen ≈L1580) |
| 4.18–4.19, 4.31 hold/cancel/lock | `RegisterShell.tsx` (≈L1060–1340), `src/lib/pos/active-sale-resume-core.ts` |
| 4.20 pickup | `RegisterShell.tsx` (PickupQueueModal ≈L4350), `src/app/api/pos/pickup/route.ts`, `src/lib/pos/pickup-progress-core.ts`, `pickup-detail-core.ts` |
| 4.21–4.24 no sale, void, return, reprint | `RegisterShell.tsx` (NoSaleModal ≈L3176, VoidSaleModal ≈L3319, ReturnsModal ≈L3574), `src/lib/pos/void-sale-core.ts`, `returns-core.ts`, `/api/pos/void`, `/api/pos/returns`, `/api/pos/reprint` |
| 4.28 X/Z | `RegisterShell.tsx` (DayReportModal ≈L5149), `src/lib/pos/day-report-core.ts`, `/api/pos/day-report` |
| 4.30 reconcile (verify retired: `actions.ts` `verifyTillAction` stub, `oversight.ts` reconcile only) | `src/app/admin/registers/page.tsx` (ReconcileCard L548), `actions.ts` (reconcileDrawerAction L170, assignRefundAction L305), `src/lib/registers/store.ts` (reconcileDrawer L326), `over-short-warning-core.ts` (checkOverShortReason L54), `over-short/page.tsx`, `drawer-figure-core.ts` (buildDrawerFigure L129), `drawer-figure-store.ts` (loadDrawerFigure L218, assignReturnRefund L306), `oversight.ts`, `eod/`, `history/`, `safe/`, `supabase/migrations/0313_drawer_cash_refunds.sql` |
| 4.32 sync/exceptions | `src/lib/pos/sync-store.ts`, `sync-core.ts`, `src/lib/orders/completion-gate.ts`, `src/app/admin/registers/exceptions/page.tsx` |
| 4.35 cashier shift report | `src/app/admin/registers/cashiers/page.tsx` (gate L109), `cashiers/csv/route.ts` (gate L24, 409 on incomplete), `src/lib/registers/cashier-report-core.ts` (`saleDiscounts` L210, `buildCashierReport` L297, `CASHIER_REPORT_MAX_DAYS` L418, `untracedNote` L533), `cashier-report-store.ts` (`loadCashierReport` L57) |
| 4.36 tip tracker | `src/app/admin/staffing/tips/page.tsx` (gate L40, own-only L58), `tips/actions.ts` (`staffing.manage` L24), `tips/csv/route.ts`, `src/lib/staffing/tips-core.ts` (`buildTipReport` L110, `validateTipCorrection` L240), `tips-store.ts` (`loadTipReport` L39, `correctSessionTips` L145), `src/components/admin/admin-nav-data.ts` L109; tips entered `RegisterShell.tsx` TillModal, stored `drawer_sessions.tips_minor` (0134) |
| 4.37 buttons | `src/components/admin/AdminPageHeader.tsx` (`toolbar` L76), `src/app/admin/registers/page.tsx` L123 |
| 4.33 86 | `SaleFlow.tsx` (ProductInfoModal ≈L4274), `src/lib/pos/stock-flag-core.ts`, `src/components/admin/inventory/RegisterSellabilityBanner.tsx` |

## Appendix B: Not built yet (interim paper procedures)

| Owner requirement | Today | Interim procedure in this SOP | Gap / finding |
|---|---|---|---|
| ~~D2: second-person count at close (any second employee)~~ | **BUILT, Phase 2.2**: the register (and the back-office close) takes a second employee's PIN and own count (4.27). A difference is a warning | Paper slip 8.2/8.4 only if migration 0314 is not applied | G-01 BUILT · F-01-9 FIXED, F-00-5 close part FIXED |
| ~~D3: log big bills master till → little safe, and which small bills/coin came back~~ | **BUILT, Phase 2.7b**: the change swap takes the bills both ways (4.26); the master till ↔ little safe exchange is on the Store safe page (SOP-02 §4.10) | SOP-02 form 8.3 only for an iPad not yet rebuilt | G-02 BUILT · F-01-8, F-00-7 FIXED |
| ~~D7: $5 over/short warning screen (admin only: who, when, how much, required reason)~~ | **BUILT, Phase 2.3**: reason required over $5.00 at reconcile (optional at $5.00 or less, D21); **Over / short warnings** screen, owner and admin only, drawers and master till (4.30 step 6) | Form 8.5 only if migration 0315 is not applied | G-03 BUILT · F-01-11 FIXED |
| ~~Deposit bag (seal → morning verify → safe → bank)~~ | **BUILT, Phase 2.6**; night assembled and verified since Fix Phase 6 (D82) | SOP-03 | G-04 · F-00-6 FIXED |
| ~~Per-shift / per-cashier report~~ | **BUILT, Phase 2.1 (drawer figure) and Phase 2.1b (printable Cashier shift report, §4.35).** The X/Z day report stays per register | None needed; print the Cashier shift report | G-05 BUILT · F-01-10 FIXED |
| ~~Morning verify with recount and verifier identity~~ | **RETIRED, Fix Phase 6 (D83)**: the morning blind bag recount (by denomination, with PIN) is the verify | None needed | F-00-3 RETIRED · G-63 |
| ~~Verify name box~~ | **Removed with Verify till (D83)** | None needed | F-00-4 RETIRED (reconcile part FIXED, Phase 2.1) |
| ~~Standard float check at count-in~~ | **BUILT, Fix Phase 6**: warns, never blocks (D85) | None needed | F-01-13 FIXED · G-62 |
| ~~Clock-out while still owning a drawer~~ | **BUILT, Fix Phase 6**: refused (D84) | None needed | G-61 |
| ~~Computed cash sales per drawer~~ | **BUILT, Phase 2.1**: the system figure (4.30) | None needed | F-01-4, F-00-13, F-01-3 FIXED |

## Appendix C: Revision history

| Version | Date | Change | By |
|---|---|---|---|
| 1.0 draft | 2026-10-27 | First issue. Written from the code at `d03fe15b`. Includes owner decisions D1–D9. Supersedes `docs/POS_OPERATIONS_GUIDE.md` §2 (F-00-11) on approval. | SOP program (for owner review) |
| 1.1 draft | 2026-10-27 | Slice SOP-04, docs-only corrections. §4.29: the float stays in the drawer (fixes finding F-03-4; floats $167.50 / Manager Till $300.00 per D19/D22). §4.30 step 6: a written reason is required only for over/short **over $5.00** (owner decision D21). No code was re-audited; other pins still at `d03fe15b`. | SOP program |
| 1.2 draft | 2026-10-27 | Slice SOP-05b. Living-SOP reminder added under the title (owner decision D41: update this SOP whenever a gap it names is built). Line references re-checked after the performance merge (`main@827facb5`; register files now under `src/app/(site)/pos/`). No procedure changed. | SOP program (for owner review) |
| 1.12 draft | Fix phase | G-75 (owner message 17, D118–D119). §4 cart header: the customer search (any part of a name in either order, last name, phone digits, email, Customer ID; results as you type, up to 25, with last 4 phone digits, last purchase, total spent, medical, Customer ID; closest spellings after migration 0335). Messages updated. The iPad app must be rebuilt for the new result layout. | Fix program |
| 1.11 draft | Fix phase | Fix Phase 6F (owner message 9, D91–D96; G-67, G-68 BUILT). §4.23 store policy: anyone with the receipt by default, Loyalty members only toggle, return window setting (default 7), non-returnable product types; receipt and packaging always required. §4.27 step 7: the tips box is required on the iPad close (0 allowed). §5 messages, quick card. No migration. The iPad app must be rebuilt. | Fix program |
| 1.10 draft | Fix phase | Fix Phase 6 / Fix E (owner message 8, D81–D90; G-61, G-62, G-63, G-64, G-66 BUILT; F-01-13 FIXED; F-00-3, F-00-4 verify part, F-01-12 RETIRED). §4.2 clock-out guard (D84: blocked while you own an open drawer; closing never clocks out); §4.3 float warning (D85); §4.27 steps 3, 7, 12 crew tip pool (D89) and the still-clocked-in line; new §4.27a shift change on your own insert with the quick card (D81, D86, D88, D90); §4.29 notes; §4.30 reconcile by either manager before the seal (D87), Verify till retired (D83); §5.8 three rows; forms 8.1 and 8.6; quick card; Appendix A and B. No migration. The iPad app must be rebuilt for the register changes. | Fix program |
| 1.9 draft | Fix phase | Phase 2.1b, 2.1c, 2.9 (owner message 6: *"please completely finish G-05 (2.1), the per cashier print out. I want to add to this an employee tip tracker with a new page in the employee drop down menu to track tips and give stats on them … The register activity page also, the top button bar, is cutoff."*). G-05 BUILT, F-01-10 FIXED: new §4.35 **Cashier shift report** (per cashier and shift; sales, voids, no-sales, discounts by kind, cart adjustments; sign-off line; print and CSV). New §4.36 **Tip Tracker** (Employee menu; own tips for everyone, all for managers; totals, averages, highest, weekday, per hour; manager correction with a reason, audited). New §4.37: the Register Activity buttons wrap so none is cut off. No migration. Appendix A and B updated. | Fix program |
| 1.8 draft | Fix phase | Phase 2.7b (plan row 2.7: *"Master till items"*; owner D3, D14). G-02 BUILT, F-01-8 FIXED: §4.26 change swap now takes **Big bills to the safe** and **Change back** by denomination and refuses unequal sides; new messages listed; the D3 note says the iPad must be rebuilt. Form 8.3 retitled and pointed to SOP-02 form 8.3 (F-02-8 FIXED). Quick card and Appendix B updated. | Fix program |
| 1.7 draft | Fix phase | Phase 2.3 (owner message 4: *"then over/short warnings"*; owner D7, D16, D21). G-03 BUILT, F-01-11 FIXED: the Reconcile card has a reason box; more than $5.00 over or short needs a reason, checked by the server against its own figure (blank → refused, audited); $5.00 or less optional; the reason is saved on the drawer (migration 0315) and printed on the till summary; every warning is audited; new owner/admin screen **Over / short warnings** (drawers and master till; who, when, how much, reason), linked from Register Activity and the menu. Warnings never block. §4.30 step 6 and related pages, §6 row, form 8.5 note, checklist 8.6 and Appendix B updated. | Fix program |
| 1.6 draft | Fix phase | Phase 2.2 (owner message 4: *"then second-person count"*; owner D2: *"Q2- close only, and it can be any second employee"*). G-01 BUILT: a close needs a second employee's PIN and their own blind count (register two-step close and the back-office close form); the server refuses the closer's own PIN; both counts are stored (migration 0314); a difference is a warning only; over/short still uses the closer's count. Close is now compare-and-swap (F-01-2, close part) and count-row save errors are recorded, not ignored. §4.27 steps 5, 8–13 and back-office close, §4.29 step 3, §4.30 card rows and step 1, §5.8 messages, form 8.4 note, Appendix A and B updated. | Fix program |
| 1.5 draft | Fix phase | Phase 2.1 (owner message 4: *"per-drawer figure"*). G-05 drawer figure BUILT: reconcile shows and uses the system figure per drawer (no typed cash sales, F-01-4 / F-00-13 FIXED; real expected before reconcile, F-01-3 FIXED); refunds say which drawer or the safe paid (migration 0313); untied refunds block reconcile until a manager ties them; reconcile is compare-and-swap (F-01-2 reconcile part) and records the signed-in manager (F-01-5 reconcile part). §4.22, §4.23, §4.27 step 9, §4.28, §4.30, Appendix A and B updated. | Fix program |
| 1.4 draft | Fix phase | Phase 1.4 (owner D76). G-44 BUILT (SOP-15 v1.4): a **Destroy** return's units are held on the lot, counted on hand but never sellable, and the return is saved in one step. §4.23 step 6 updated. | Fix program |
| 1.3 draft | Fix phase | Phase 0.1 (owner D76). F-01-14 FIXED: the register refuses payment when the simulated endorsement took tax off (`medicalTestModeSaleBlock`, `src/lib/pos/medical-testmode-core.ts`; called in `SaleFlow.tsx` onPaid). The server sync refuses a medical sale with tax removed when `medical_endorsement_config` says not endorsed (`src/lib/pos/sync-store.ts`). §4.4 banner note and the MORE-menu row updated. | Fix program |
