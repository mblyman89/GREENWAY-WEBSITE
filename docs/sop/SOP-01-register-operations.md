# SOP-01 — Register Operations: Shift, Sales, Discounts, Till & Cash

| | |
|---|---|
| **Version** | 1.2 (draft for owner review; D21 and F-03-4 correction applied; D41 living-SOP reminder) |
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
- The register does **not** enforce a set float amount. Whatever you count is your opening float. Use the store's standard float. If your count does not match it, tell a manager **before** ringing sales.

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

**Amber banner "🧪 Medical TEST MODE — endorsement is SIMULATED…"**: someone turned on the medical rehearsal switch on this iPad. **Turn it off before real sales** (MORE ▾ → the medical test mode item). See finding F-01-14.

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
- No member attached? Use the member search (**Member name, phone, or email…**). If nobody matches: *"No members match — sign them up in the back office."* The **✕** detaches a member.

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
- One barcode matches several sizes: *"Barcode matched <name> — pick the size that left the shelf:"*. Tap the size in your hand.
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

> **Drawer effect:** the void pays cash out of **your** drawer. The manager must subtract it from cash sales at reconcile (4.30, finding F-01-4). Write the receipt number and the amount on your close slip.

### 4.23 Customer returns

**Store policy, stricter than the state rule:**
1. The sale must have had a **loyalty member** attached.
2. The customer brings the **original receipt**, or you find the sale in the history list.
3. Returns are accepted **within 15 days** of purchase. The purchase day is day 0, counted in Pacific time.
4. The product must be in its **original packaging** with the **lot / batch label fully legible** (WAC 314-55-079(12)).
5. **Refunds are cash**, the original form of payment.

Steps:
1. **MORE ▾ → Return an item** (online only).
2. Find the sale. Either type the **receipt number** (8 characters), or search recent sales (**Search name, receipt, item or staff**) and tap the sale.
3. If the sale fails policy, every reason is shown. For example:
   - *"Outside the 15-day return window — this sale was N days ago (store policy). Refuse the return."*
   - *"No loyalty member is attached to this sale — store policy requires … Refuse the return."*
4. Pick the **line** and the **quantity** (it shows "N of M returnable").
5. Pick the **reason**: **Defective / Wrong item / Adverse reaction / Quality issue / Mislabeled / Other**. A detail note is optional, but give context for **Other**. An **adverse reaction** also needs a manager to follow the product-complaint process.
6. Choose **Restock** (sellable) or **Destroy** (the product goes to the quarantine bin for destruction, SOP-15).
7. Tick both attestations: **Product is in its ORIGINAL packaging** and **Lot / batch ID on the package is FULLY LEGIBLE**.
8. A manager or lead enters their PIN and taps **Process return & refund $X**.
9. *"Return processed — hand back $X cash; N points reversed."* (plus *"Product goes to the quarantine bin."* when destroying). Hand back the cash from the drawer.

The refund is the exact price the customer paid. The server also queues the state-reporting (CCRS) correction and claws back loyalty points in proportion to the refund.

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
3. **Amount swapped**: enter the value of **one side** only. *"Example: $100 in twenties goes to the safe, $100 in fives, ones and coins comes back. Enter the value of one side."*
4. A manager or lead (**not you**) counts **both** sides with you and enters **Manager or lead PIN (approval)**.
5. **Notes (optional)…**: write what went each way, for example "OUT: 5×$20 · IN: 10×$5, 40×$1, 2 rolls quarters ($20)".
6. Tap **Record swap of $X**. Success: *"$X change swap with the safe recorded."*

Messages:
- *"A manager or lead must approve the swap with their PIN."*: the approver box is empty.
- *"A swap cannot approve itself — a manager or lead must enter their PIN."*: you used your own PIN.
- *"<name> is not a manager or lead — safe swaps need a manager PIN."*: the approver is a budtender.
- *"No active employee for the approver PIN."* / *"Approver PIN must be 4–6 digits."*: re-enter it.

> **Owner rule D3, interim paper step.** The owner wants to know **when big bills leave the master till and go into the little safe, and which small bills and coin came out of the little safe**. The register records only the **dollar value** of a swap, not which bills (finding F-01-8). Until that is built, **fill in the Change-swap denomination log (form 8.3) for every swap**, and also put the breakdown in **Notes**. Both people initial the form.

**Change swap vs No sale:** a swap goes through **Change swap** and records the exchange. Do **not** use **No sale → Change fund swap with the safe** for an actual swap. That reason only opens the drawer. It records no amount and no approver for the exchange itself.

### 4.27 Closing your drawer (blind count)

You close the drawer at the end of your shift, or at end of day. **Do it before you clock out.**

1. Finish or hold any sale. Make sure the last receipt is printed.
2. Make your last **cash drop** if one is due (4.25). The drop must be recorded **before** the close.
3. Take the **tip jar** out and count it **by itself**. Tips are employee money, not drawer cash.
4. **MORE ▾ → 🔐 Close drawer (blind count)** (or **Close (blind count)** in the Cash drawer panel).
5. The window is titled **Close drawer — blind count**: *"Count what's in the drawer right now. You will NOT see the expected amount — a manager reveals over/short at reconcile. That protects you."*
6. Count **every** bill and coin in the drawer by denomination and type **how many** of each. Count twice.
7. **Tips (counted separately)**: enter the tip-jar total, or leave it blank if there is no tip jar. *"Count the tip jar by itself — tips are your money, NOT drawer cash, so keep them out of the count above. Leave blank if there is no tip jar."* Blank means "not recorded". **0** means "counted, and there were none".
8. **Second-person count (owner rule D2, interim paper step).** Before you tap the button, **any second employee** recounts the drawer by themselves and writes their total on the **Close slip (form 8.2)**. If the two counts differ, recount together until they agree. Both sign the slip. The register does not record the second count yet (findings F-01-9 and F-00-5).
9. **More than one drawer on this register today?** If someone else will count in on this register after you, ask a manager or lead to print an **X report** (4.28) **right before** you tap the button below. The day report covers the whole register for the day. The manager needs your X report to split the day's sales between drawers (4.30).
10. Tap **Record blind count & close**.
11. Success: *"Blind count recorded — a manager reconciles it in the back office."* (or *"Blind count recorded with $X in tips — …"*).
12. Handle the cash as in 4.29.

**Why it is blind:** if you could see the expected amount, a short drawer could be "fixed" by fudging the count, and an honest miscount could not be told apart from theft. With a blind count your number stands on its own. A manager compares it to the system later. A blind count protects you.

Messages: *"No open drawer on this register."* (already closed, or never opened) · *"Tips must be zero or a positive whole number of cents."* · *"Tips amount is implausibly large — check the number."* · *"Enter tips as dollars and cents (like 42.50) or leave it blank."*

**After closing:** the register shows **No drawer**. You cannot ring another sale on this register until someone counts in again.

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

**Cash the register took today** = **Gross + Cash rounding − Employee tab − refunds paid from this drawer**. The manager uses this figure at reconcile (4.30).

Messages: *"Offline — the day report needs a connection to verify the PIN and read the day's ledger."* · *"Day report failed — try again."* · *"Could not reach the server — try again."*

### 4.29 What to do with the money

At close, after the blind count:
1. **Drawer cash**: follow the store's cash routine in **SOP-02** (master till / safe) and **SOP-03** (end-of-day sheet, deposit bag). **The float stays in the drawer** for tomorrow (**$167.50** in each sales register, **$300.00** in the Manager Till, owner decisions D19/D22; the system closes with `floatStaysInDrawer: true`, `drawer-posting-service.ts` L193). Everything above the float is the takings and goes into the deposit (SOP-03 §4.4–4.5). *(Corrected in v1.1: v1.0 said the float "goes back to the master till / safe", which was wrong, finding F-03-4.)*
2. **Tips**: per store tip policy. Tips never go into the drawer count or the deposit.
3. **Close slip (form 8.2)**: hand it to the manager with the second-person signature, the void and return receipts, and the swap log (form 8.3).
4. **Print the Z report** (4.28) when the last drawer of the day is closed, and put it with the end-of-day paperwork.

> The deposit bag (seal, morning verify, into the safe, to the bank) is **not built in the app yet** (finding F-00-6). Follow SOP-03's paper procedure.

### 4.30 Manager: reconcile and verify (back office)

*Managers and admins only. Reconcile and verify need `inventory.manage` (owner, admin, manager). Anyone with `orders.manage` (which includes staff) can **see** Register Activity, but only sees "Ask a manager to sign off".*

A drawer moves through four states: **open → closed → reconciled → verified**.

**Where:** back office → **Register Activity** (`/admin/registers`). The **Needs attention** section (*"Closed drawers awaiting a manager sign-off."*) holds one card per drawer:
- an orange **Reconcile** card for a closed drawer;
- a gold **Verify till** card for a reconciled drawer.

**Reconcile (reveal over/short)**
1. The card reads *"<business day> · counted $X vs expected $Y"*, plus tips if recorded (*"(employee money, not drawer cash)"*).
   - ⚠ **Before reconcile, "expected" always shows $0.00.** The expected figure is calculated **only when you reconcile** (finding F-01-3). Ignore it.
2. If there were refunds that day: *"$X refunded store-wide this day (voids + returns) — enter cash sales NET of refunds paid from this drawer."*
3. Work out **Cash sales ($)** from the Z (or X) report for this register: **Gross + Cash rounding − Employee tab − voids/returns paid from this drawer** (use the close slip to see which voids/returns this drawer paid). If the register had **two or more drawers** that day, the first drawer's sales come from the X report printed at its close, and each later drawer's sales = the next report's figure − the previous report's figure. Do it on paper. Check it twice. **Never leave it blank.** A blank counts as $0, which shows a huge false "over" (findings F-01-4 and F-00-13).
4. **Reconciled by**: see the warning below.
5. Tap **Reconcile**. The system calculates **expected = opening float + cash sales − drops** and **over/short = counted − expected**. The banner shows *"Drawer reconciled · Balanced"*, *"Over by $X"* or *"Short by $X"*, plus the books outcome. Reconcile posts the drawer's cash and over/short to the books, and that posting cannot be undone from this screen.
6. **$5 rule (owner decision D7, interim paper step):** if the result is **over or short by more than $5.00**, the manager fills in the **Over/short reason form (form 8.5)** with the cashier: who, when, how much, and the **required** reason. Give it to the owner. The admin-only warnings screen the owner asked for is not built yet (finding F-01-11).
   - **$5.00 or less:** write the amount on the close slip (form 8.2). **No reason is required** (owner decision **D21**: *"Q-03-1- only over $5"*). A note is welcome if the cause is known, but it is optional (gap G-03).

> ⚠ **Known problem, "Reconciled by" / "Verified by" (findings F-00-4, F-00-3, F-01-5).** These boxes are typed text, but the database column only accepts an employee ID. **Typing a name is expected to fail with a database error.** Until this is fixed: **leave the box blank** and write your name and the time on the close slip. The back-office audit log still records which login pressed the button.

**Verify till (next morning)**
1. The gold card reads *"<business day> · reconciled, awaiting manager verify"*.
2. The morning manager **recounts the closed drawer / bag by hand** and compares it with the close slip.
3. Tick or untick **Count agrees**. Leave **Verified by** blank (see the warning above). Tap **Verify**.
4. ⚠ **The screen has no denomination boxes**, so the system records the recount as $0 and the variance as minus the closing count, whatever you tick (finding F-00-3). **The paper close slip, signed by the morning verifier, is the real record until this is fixed.**

> ⚠ **Double-clicks.** Reconcile and verify do not guard against being run twice (finding F-01-2). Click **once** and wait for the green banner.

> ⚠ **Always reconcile before you verify.** The system will accept **Verify** on a drawer that was never reconciled (finding F-01-12). If that happens, the drawer can never be reconciled afterwards, so its over/short is never calculated and never posted to the books. The screen shows the **Verify till** card only after reconcile. Do not try to get around that order.

**Related back-office pages** (Registers menu):
- **Cash drawer reports** (`/admin/registers/history`): closed, reconciled and verified sessions, each with a printable summary.
- **End of day** (`/admin/registers/eod`): the whole-store day, marked *"Preliminary — a drawer is still open"* or *"Final — all drawers closed"*. Printable.
- **Store safe** (`/admin/registers/safe`): *"The $1,000 change fund behind the registers."* AM/PM counts → SOP-02.
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
| **⚕️ Turn ON medical test mode (simulate endorsement)** / **🧪 Turn OFF medical test mode** | **Training only.** It pretends the store is medically endorsed so staff can rehearse a tax-free medical sale. *"TEST ONLY … Turn OFF for real sales until the store is actually endorsed."* While it is on, an amber banner shows on every screen. **Never ring a real sale with it on.** The server checks the store's real endorsement, not this switch, and does not recalculate tax. A real sale rung in test mode can therefore be recorded with tax taken off but with no exemption record behind it (finding F-01-14). |
| **⏱️ Clock in / Clock out** | Punches the signed-in employee (4.2). |
| **🔒 Lock register** | Locks now (4.31). |

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
| *"Voids are same-day only (Pacific business day). For an earlier sale, use the returns desk — it handles the 15-day policy, restock/destroy, and CCRS corrections."* | BLOCK | Same-day control | Use **Return an item** | Manager |
| *"This sale has already been voided."* | BLOCK | Only once | — | — |
| *"Only COMPLETED sales can be voided (this order is "…")."* / *"Only COMPLETED sales can be returned …"* | BLOCK | The sale is not finished (still syncing, or an exception) | Wait for sync, or check exceptions | Manager |
| *"Part of this sale was already returned at the returns desk — voiding now would refund the same items twice. Process the rest as a return instead."* | BLOCK | Prevents a double refund | Use **Return an item** | Manager |
| *"The sale has no completion timestamp — void it from the back office instead."* | BLOCK | Data problem | Back office | Manager |
| *"Give a reason (at least 3 characters) — it is logged to the audit trail."* / *"Keep the reason under 500 characters."* | BLOCK | Audit | Write a reason | — |
| *"A manager or lead must approve the void (PIN)."* | BLOCK | Control | Manager PIN | Lead / manager |
| *"Outside the 15-day return window — this sale was N days ago (store policy). Refuse the return."* | BLOCK (policy) | Store policy | Refuse | Owner for exceptions |
| *"No loyalty member is attached to this sale — store policy requires the product to have been purchased by a loyalty customer. Refuse the return."* | BLOCK (policy) | Store policy | Refuse | — |
| *"This sale is timestamped in the future — check the register clock before processing a return."* | BLOCK | iPad clock problem | Check the iPad's date/time | Manager |
| *"Nothing left to return on this line — it has already been fully returned."* / *"Return quantity (N) exceeds what is still returnable on this line (M)."* | BLOCK | Prevents a double refund | Fix the quantity | — |
| *"Pick the line item being returned."* / *"Pick a valid return reason."* / *"Pick restock or destroy."* / *"Select at least one line to return."* | BLOCK | Required fields | Fill them in | — |
| *"Enter the receipt number."* | BLOCK | Required | Type the 8-character number | — |
| *"Offline — manager approval needs a connection to verify the PIN."* | BLOCK | Server check | Reconnect | — |

### 5.8 Drawer (till)

| Message (exact) | Type | Why | What to do | Call |
|---|---|---|---|---|
| *"Count in at least one bill or coin — an empty float cannot open a drawer."* | BLOCK | A drawer needs a float | Count the float | — |
| *"This register already has an open drawer. Close it first."* | BLOCK | One drawer per register | Use the open drawer, or close it | Manager |
| *"No open drawer on this register."* | BLOCK | Drop/swap/close need an open drawer | Count in | — |
| *"A drop cannot witness itself — a second person must enter their PIN."* | BLOCK | Two-person rule | Another person, or no witness | — |
| *"Pick a drop window (afternoon, night, or other)."* | BLOCK | Required | Pick one | — |
| *"Drop amount must be a positive whole number of cents."* / *"Drop amount is implausibly large — check the number."* | BLOCK | Typo guard (max $50,000) | Re-type | — |
| *"A manager or lead must approve the swap with their PIN."* / *"A swap cannot approve itself — a manager or lead must enter their PIN."* | BLOCK | Control | Manager or lead | Lead / manager |
| *"Notes must be 500 characters or fewer."* | BLOCK | Length | Shorten | — |
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
| Drawer over or short by more than $5 at reconcile | Form 8.5, the same day | Owner (D7) |
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
- [ ] Float counted twice; matches the store's standard float (set by the owner); **Open drawer with $X** done
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

### 8.3 Change-swap denomination log (D3: master till ↔ little safe)

```
Date | Time | Register/till | OUT of till → little safe (big bills) | IN from little safe → till (small bills & coin) | Value each side | Recorded by | Approved by (mgr/lead) | Matches register "Record swap"? 
     |      |               | e.g. 5×$20                           | e.g. 10×$5, 40×$1, 2 rolls 25¢ ($20)           | $100.00         |             |                        | [ ]
```
Every swap needs one line. The register keeps the dollar value; this log keeps **which bills and coin**, which is what the owner asked for.

### 8.4 Second-person count sign-off (D2)

Part of form 8.2. Any second employee counts alone, without seeing the first count, then the two compare. Both sign.

### 8.5 Over/short reason form (D7: more than $5.00)

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

- [ ] Every drawer closed blind, with a signed close slip (8.2)
- [ ] Z report printed (REPORTS → manager PIN)
- [ ] Register Activity: every closed drawer **reconciled** (cash sales worked out on paper, net of this drawer's voids/returns, never blank)
- [ ] Any over/short > $5 → form 8.5
- [ ] **Register exceptions** reviewed; **Rejected events on registers** is empty
- [ ] Swap log (8.3) matches the register's swap records
- [ ] Cash and deposit handled per SOP-02 / SOP-03
- [ ] Next morning: **Verify till** against the slip (paper is the record, F-00-3)

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
│ VOID = same day only. RETURN = loyalty member, 15 days, original pkg, legible lot.     │
│ REPRINT = MORE ▸ Reprint last receipt (drawer stays shut). Don't re-tap Print.         │
│ DROP big bills (afternoon/night) + witness. SWAP = mgr PIN + fill swap log (8.3).      │
│ CLOSE: drop first → tips apart → blind count → 2nd person count on slip → Record.      │
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
| 4.2 clock | `src/app/(site)/pos/RegisterShell.tsx` (onPunch) |
| 4.3, 4.25–4.27 till | `src/app/(site)/pos/RegisterShell.tsx` (TillModal ≈L5603), `src/app/api/pos/till/route.ts`, `src/lib/pos/till-core.ts`, `src/lib/registers/store.ts`, `src/lib/registers/cash.ts`, `supabase/migrations/0038_registers_drawers.sql` |
| 4.4 home screen, 4.34 MORE | `RegisterShell.tsx` (≈L2550–2915), `src/lib/pos/medical-testmode-core.ts` |
| 4.5–4.6 ID / medical | `src/lib/pos/id-scan-core.ts`, `src/lib/pos/medical-pos-core.ts`, `SaleFlow.tsx` (ID gate) |
| 4.7–4.10 cart, limits | `src/app/(site)/pos/SaleFlow.tsx`, `src/lib/pos/scan-required-core.ts`, `low-stock-core.ts`, `favorites-core.ts`, `src/lib/compliance/sales-limits-core.ts`, `sales-hours-core.ts` |
| 4.11–4.14 discounts | `src/lib/pos/special-discount-sale-core.ts`, `src/lib/discounts/special-discount-core.ts`, `src/lib/pos/price-override-core.ts`, loyalty in `SaleFlow.tsx` + `/api/pos/loyalty` |
| 4.15–4.17 tender, done, tab | `src/lib/pos/cash-rounding-core.ts`, `change-calc-core.ts`, `employee-loan-core.ts`, `SaleFlow.tsx` (done screen ≈L1580) |
| 4.18–4.19, 4.31 hold/cancel/lock | `RegisterShell.tsx` (≈L1060–1340), `src/lib/pos/active-sale-resume-core.ts` |
| 4.20 pickup | `RegisterShell.tsx` (PickupQueueModal ≈L4350), `src/app/api/pos/pickup/route.ts`, `src/lib/pos/pickup-progress-core.ts`, `pickup-detail-core.ts` |
| 4.21–4.24 no sale, void, return, reprint | `RegisterShell.tsx` (NoSaleModal ≈L3176, VoidSaleModal ≈L3319, ReturnsModal ≈L3574), `src/lib/pos/void-sale-core.ts`, `returns-core.ts`, `/api/pos/void`, `/api/pos/returns`, `/api/pos/reprint` |
| 4.28 X/Z | `RegisterShell.tsx` (DayReportModal ≈L5149), `src/lib/pos/day-report-core.ts`, `/api/pos/day-report` |
| 4.30 reconcile/verify | `src/app/admin/registers/page.tsx`, `actions.ts`, `src/lib/registers/store.ts`, `oversight.ts`, `eod/`, `history/`, `safe/` |
| 4.32 sync/exceptions | `src/lib/pos/sync-store.ts`, `sync-core.ts`, `src/lib/orders/completion-gate.ts`, `src/app/admin/registers/exceptions/page.tsx` |
| 4.33 86 | `SaleFlow.tsx` (ProductInfoModal ≈L4274), `src/lib/pos/stock-flag-core.ts`, `src/components/admin/inventory/RegisterSellabilityBanner.tsx` |

## Appendix B: Not built yet (interim paper procedures)

| Owner requirement | Today | Interim procedure in this SOP | Gap / finding |
|---|---|---|---|
| D2: second-person count at close (any second employee) | Close takes one PIN | Close slip second count (4.27, 8.2/8.4) | G-01 · F-01-9, F-00-5 |
| D3: log big bills master till → little safe, and which small bills/coin came back | Swap records value only | Swap log 8.3 and Notes | G-02 · F-01-8, F-00-7 |
| D7: $5 over/short warning screen (admin only: who, when, how much, required reason) | Not built | Form 8.5 to the owner | G-03 · F-01-11 |
| Deposit bag (seal → morning verify → safe → bank) | Tables exist, no screen | SOP-03 paper | G-04 · F-00-6 |
| Per-shift / per-cashier report | Day report is per register | Close slip per drawer | G-05 · F-01-10 |
| Morning verify with recount and verifier identity | No denominations; name box broken | Paper slip is the record | F-00-3 |
| Reconcile name box | Free text into an ID column | Leave blank, sign the slip | F-00-4, F-01-5 |
| Computed cash sales per drawer | Typed by hand | Paper formula in 4.30 | F-01-4, F-00-13 |

## Appendix C: Revision history

| Version | Date | Change | By |
|---|---|---|---|
| 1.0 draft | 2026-10-27 | First issue. Written from the code at `d03fe15b`. Includes owner decisions D1–D9. Supersedes `docs/POS_OPERATIONS_GUIDE.md` §2 (F-00-11) on approval. | SOP program (for owner review) |
| 1.1 draft | 2026-10-27 | Slice SOP-04, docs-only corrections. §4.29: the float stays in the drawer (fixes finding F-03-4; floats $167.50 / Manager Till $300.00 per D19/D22). §4.30 step 6: a written reason is required only for over/short **over $5.00** (owner decision D21). No code was re-audited; other pins still at `d03fe15b`. | SOP program |
| 1.2 draft | 2026-10-27 | Slice SOP-05b. Living-SOP reminder added under the title (owner decision D41: update this SOP whenever a gap it names is built). Line references re-checked after the performance merge (`main@827facb5`; register files now under `src/app/(site)/pos/`). No procedure changed. | SOP program (for owner review) |
