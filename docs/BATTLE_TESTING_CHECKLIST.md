# Greenway Battle-Testing Checklist

Companion to **`docs/BATTLE_TESTING_GUIDE.md`**, which explains *how to think* about each of these. This file is the tracker: what to test, what is done, what is left.

**How to use it.** Work top to bottom — it is ordered by how much a failure would hurt. Mark `[x]` when you have tried it and it behaved correctly. If something misbehaves, mark `[!]` and write what happened on the line beneath. Do not mark anything `[x]` you have not actually done; a checklist that lies is worse than no checklist.

**Legend**
- `[ ]` not yet tested
- `[x]` tested, behaved correctly
- `[!]` tested, PROBLEM FOUND — note it underneath
- `[HEAVY]` high-volume; run it, then use the factory reset to clear the debris
- `[2-DEVICE]` needs two registers, or two browser tabs

---

## 0a. Do this FIRST — prove the factory reset works

Everything in this checklist is safe to run hard because the factory reset can clear it. That makes the reset the safety net under the whole exercise, and an untested safety net is a decoration. Test it once, before the rest.

- [ ] Open **Settings → Factory reset**. Read the two lists — the screen now counts the real tables (138 emptied / 120 kept) rather than describing them from memory
- [ ] Check the four "before you press it" figures: completed sales, CCRS files, excise returns filed, posted journal entries
- [ ] Tick the retention attestation, type `ERASE ALL TEST DATA` exactly, and run it
- [ ] Confirm the success line reports rows removed across ~138 tables **and mentions the general ledger**
- [ ] Confirm no `WARNING` follows it — the post-reset check runs automatically and reports only problems
- [ ] Spot-check that it truly emptied: Reports show zero, register history is empty, the books show a blank trial balance
- [ ] Spot-check that it truly kept: your login still works, the chart of accounts is intact, the knowledge base is intact, vendors and brands are intact
- [ ] Try it once with the phrase typed **wrongly** (e.g. lower case) and confirm it refuses and deletes nothing

Three things the reset deliberately cannot reach, so do not be surprised: uploaded **files** stay in storage buckets, **login accounts** in Supabase Auth are not deleted, and auto-numbering **counters** do not restart. None of the three can put a wrong number on a report or a tax form. The screen states all three.

---

## 0. Already confirmed by you (recorded so you do not re-tread)

Your words: *"I can import Cultivera's products, they show on the menu and I can sell them. I can intake products through receiving, they land on the menu and I can sell them. I can enrich products and it works great. I can create art and it works great. I have all the reporting I could ever want and it seems to be accurate. The daily discounts work perfect now."*

- [x] Cultivera product import → products appear on menu → sellable
- [x] Receiving intake → products land on menu → sellable
- [x] Product enrichment
- [x] Art / creative generation
- [x] Reporting renders and appears accurate
- [x] Daily deal discounts apply correctly
- [x] Register transaction history search — **fixed and verified this session**

These were "lite" passes. They confirm the happy path works. Sections 1 onward are the same features under pressure.

---

## 1. Money and inventory accuracy — HIGHEST PRIORITY

A silent failure here costs real money and makes the books untrue.

### 1.1 Non-daily discount types (you flagged this as untested)

The system supports seven discount types. You have exercised the daily deals. Each of the rest needs its own pass.

- [ ] **Percent off** — apply to a single product, sell it, confirm the receipt, sales report and excise all agree
- [ ] **Fixed amount off** — same three-way check
- [ ] **BOGO (buy one get one)** — sell exactly 2, then exactly 3, then exactly 4. The odd number is where BOGO logic usually breaks
- [ ] **Spend threshold (% off at $X)** — Lens 3 boundary: cart at exactly $X, one cent under, one cent over
- [ ] **Multi-item tier (qty)** — buy exactly the tier quantity, one under, one over
- [ ] **Weight tier (oz / half / quarter)** — buy exactly the tier weight, and just under it
- [ ] **Basket deal (e.g. 3 for 2)** — try 3, then 5, then 6 items
- [ ] Discount scoped to **a whole category** — confirm it hits every product in it and nothing outside it
- [ ] Discount scoped to **a brand** — same
- [ ] Discount scoped to **a single product** — same
- [ ] Discount scoped to **all products**
- [ ] An **exclusion** on a discount — confirm the excluded product is genuinely excluded
- [ ] A discount whose date range has **not started yet** — must not apply
- [ ] A discount that has **expired** — must not apply
- [ ] Boundary: a discount starting Tuesday, tested at 11:59pm Monday and 12:01am Tuesday
- [ ] **[COLLISION]** Two discounts that both legitimately apply to one product — do they stack? Is that intended? Does the receipt match the report?
- [ ] A discount large enough to take a line **below zero** — must be refused, never a negative line
- [ ] A discount applied to a product that is **already marked down** — check against the markdown lock rules
- [ ] Discount + return: sell at a discount, then return it. Is the refund the discounted price or the full price? Whichever it is, is it consistent everywhere?

### 1.2 Price overrides and manual pricing

- [ ] Override a price upward, complete the sale, check the report and excise
- [ ] Override a price downward
- [ ] Override to **zero**
- [ ] Attempt an override without the required permission — must be refused clearly
- [ ] Override, then void the sale — does the inventory and the ledger fully unwind?

### 1.3 Returns and voids

- [ ] Return **one line** from a multi-line sale
- [ ] Return **every line** from a sale — status should read fully returned
- [ ] Attempt to return **more than was bought** — must be refused
- [ ] Return the same line **twice** — the second must be refused
- [ ] Boundary: return at day 14, day 15, day 16 of the 15-day window
- [ ] Return a sale that had a **discount** applied
- [ ] Return a sale that **earned loyalty points** — are the points clawed back?
- [ ] **Void** a sale immediately after completing it — inventory, ledger and CCRS all unwind
- [ ] **[INTERRUPTION]** Start a return, abandon it halfway, confirm nothing partial was written
- [ ] Look up a return by **scanning** the receipt — *fixed this session, please re-confirm on real hardware*
- [ ] Look up a return by **typing** the receipt and pressing Enter — *fixed this session, please re-confirm*
- [ ] Search transaction history for a customer from **several days ago** — *fixed this session; this is the case that used to fail*
- [ ] Search transaction history for a product that was the **7th item** in a large basket — *fixed this session*

### 1.4 Till, cash and end of day

- [ ] Open the till, ring several cash sales, close and count. Does the expected figure match?
- [ ] A deliberately **short** till — is the discrepancy reported clearly?
- [ ] A deliberately **over** till
- [ ] Cash sale requiring **change** — check the change calculation, especially with rounding
- [ ] A sale split across **two payment methods**
- [ ] End-of-day report against the day's actual sales
- [ ] **[INTERRUPTION]** Close the till while a sale is still open on another register

---

## 2. Compliance — SECOND PRIORITY

Exposure here is regulatory, not just financial.

### 2.1 Purchase limits (Lens 3 — test the exact boundary)

- [ ] Recreational usable at exactly **28.0g** — allowed
- [ ] Recreational usable at **28.01g** — refused
- [ ] Recreational usable at **27.99g** — allowed
- [ ] Recreational concentrate at exactly **7g**, then just over
- [ ] Medical usable at exactly **84g**, then just over
- [ ] Medical concentrate at exactly **21g**, then just over
- [ ] A **mixed cart** that is under on each category but over in combination
- [ ] A cart that hits the limit, then **remove an item** — does the limit release correctly?
- [ ] **[2-DEVICE]** Same customer, two registers, two carts that are individually legal but jointly over the limit
- [ ] Medical customer with a valid authorisation — higher limits apply
- [ ] Medical customer with an **expired** authorisation — recreational limits apply
- [ ] Low-THC product unit maximum (4mg) boundary

### 2.2 Sales hours

- [ ] Attempt a sale before **8:00am** — refused
- [ ] A sale at exactly **8:00am** — allowed
- [ ] A sale started at **11:58pm** and completed after midnight — what happens?

### 2.3 Age and ID

- [ ] Customer aged exactly 21 today — allowed
- [ ] Customer one day under 21 — refused
- [ ] Expired ID — refused with a clear message
- [ ] Scan an ID vs. key it manually — same verdict both ways
- [ ] An unreadable or damaged ID barcode — clear failure, not a silent one

### 2.4 CCRS (you flagged the CSV upload as untested)

- [ ] Generate the CCRS sales CSV for a normal day — open it and eyeball the columns
- [ ] **Upload it to the real CCRS portal** and confirm acceptance ← *the big one on your list*
- [ ] Generate a CSV for a day with **returns** in it
- [ ] Generate a CSV for a day with **voids** in it
- [ ] Generate a CSV for a day with **discounts** applied
- [ ] Generate a CSV for a day you were **closed** (the empty case — Lens 1)
- [ ] A product with an **ampersand, apostrophe or comma** in its name — does the CSV survive it? (Lens 6)
- [ ] A very long product name — is it truncated, and if so does CCRS still accept it?
- [ ] Inventory adjustment reporting
- [ ] Check the CCRS deadline / filing-status screen against the real calendar
- [ ] Deliberately submit something CCRS will reject, and confirm the error triage screen explains it usefully

### 2.5 Excise and tax

- [ ] Excise figure for a plain day, checked by hand against the sales total
- [ ] Excise on a day with returns
- [ ] Excise on a day with discounts — is tax on the pre- or post-discount amount, and is that correct?
- [ ] Medical (tax-exempt) sale — confirm exemption is recorded properly
- [ ] A cart mixing exempt and non-exempt items

---

## 3. Interruption and collision — THIRD PRIORITY

Rare per shift, certain over a year.

### 3.1 Interruptions

- [ ] Build a cart, let the screen **lock**, unlock — cart intact and correct?
- [ ] Build a cart, **close the browser/app**, reopen — recovered or cleanly discarded, not half-there
- [ ] Start receiving a PO, close the tab halfway, reopen — no partial save
- [ ] Complete a sale with the **printer unplugged** — sale completes, receipt failure reported clearly
- [ ] Complete a sale with the **printer out of paper**
- [ ] **Wifi off** mid-sale, then back on — one sync, not two
- [ ] Turn wifi off, ring a sale offline, reconnect — exactly one sale lands
- [ ] **Double-tap** the complete-sale button fast — one sale, not two ← *high value*
- [ ] Double-tap the refund button — one refund, not two
- [ ] Double-tap "receive" on a purchase order — received once
- [ ] Press the browser **back button** in the middle of every multi-step flow

### 3.2 Collisions

- [ ] **[2-DEVICE]** Last unit of a product added to two carts, both completed — exactly one succeeds
- [ ] **[2-DEVICE]** Same customer served at two registers at once
- [ ] **[2-DEVICE]** Same purchase order opened and received on two screens
- [ ] Edit the same product in two back-office tabs, save both — does one silently undo the other?
- [ ] Change a product's price while it sits in an open cart — which price is charged, and does the receipt agree with the report?
- [ ] Delete or deactivate a product while it is in an open cart
- [ ] Change a discount while a cart it affects is open
- [ ] Run inventory adjustment on a lot that is being actively sold

---

## 4. Volume and data shape — FOURTH PRIORITY

Where the Cultivera migration will bite hardest.

### 4.1 Too much (Lens 2) — all [HEAVY]

- [ ] A cart with **40+ line items** — screen, receipt, printer
- [ ] **[HEAVY]** A purchase order with 300+ lines through receiving
- [ ] **[HEAVY]** 10,000+ products in the catalogue — menu, search, filters still usable
- [ ] **[HEAVY]** A single day with 1,000+ sales — reports, history, CCRS export
- [ ] A customer with a very long purchase history
- [ ] A report over a **12-month** range
- [ ] **[HEAVY]** Cultivera import file with 5,000+ rows

### 4.2 Wrong shape (Lens 6)

- [ ] Product name with `&`, `#`, `'`, `/`, `%` — menu, search, receipt, label, CCRS
- [ ] Product name with an emoji or non-English characters
- [ ] A 200-character product name
- [ ] A product with **no image**
- [ ] A product with **no category**
- [ ] A product priced at **$0.00**
- [ ] A quantity with many decimals (0.333g)
- [ ] Customer with **one name only**
- [ ] Customer with an apostrophe in their surname (O'Brien)
- [ ] Import CSV with a **blank row at the bottom**
- [ ] Import CSV with a missing required column — clear error, not a silent partial import
- [ ] Import CSV with **duplicate** rows — deduplicated or clearly reported?
- [ ] Import the **same file twice** — duplicates created?
- [ ] Import a file that is **not a CSV** at all — clean refusal

### 4.3 Empty (Lens 1)

- [ ] Transaction history before the first sale of the day
- [ ] Every report for a day you were closed
- [ ] Receiving with an empty purchase order
- [ ] A discount applied to a category containing nothing
- [ ] Customer search with no matches
- [ ] Product search with no matches
- [ ] The menu with everything out of stock
- [ ] A customer with no purchase history

---

## 5. Honest failure (Lens 7) — run these deliberately

For each: is the message clear enough for a brand-new budtender to know what to do next?

- [ ] Wifi off, then press every major button in turn
- [ ] Printer unplugged
- [ ] Printer out of paper
- [ ] Wrong manager PIN, four times in a row — lockout behaves sensibly
- [ ] Receipt number that does not exist
- [ ] Barcode scan of something that is not a product
- [ ] Open a report while the connection is flaky — does it say "could not load" or show zeroes? ← **critical distinction**
- [ ] Attempt an action your role does not permit
- [ ] Session expiry mid-task

---

## 6. Back office by section — routine sweep

### 6.1 Inventory and catalogue
- [ ] Create, edit, deactivate a product
- [ ] Lot creation, editing, splitting
- [ ] Inventory audit / count
- [ ] Blocked and held stock
- [ ] Low stock alerts
- [ ] Recall hold
- [ ] Restore-to-sale
- [ ] Inventory filters, sorting, search under a large catalogue

### 6.2 Purchasing and receiving
- [ ] Create a purchase order manually
- [ ] Import a vendor invoice
- [ ] Receive in full
- [ ] Receive **partially**
- [ ] Receive **more** than ordered — flagged?
- [ ] Receive a product **not on the PO** — *the defect fixed in the previous session; please re-confirm*
- [ ] Vendor reconciliation
- [ ] Price drift detection between PO and invoice

### 6.3 Menu and website
- [ ] Publish menu changes and confirm they appear
- [ ] Out-of-stock product disappears from the public menu
- [ ] Specials page reflects active discounts
- [ ] Menu syndication (Leafly / Weedmaps) payloads

### 6.4 Customers and loyalty
- [ ] Sign up a new member at the register
- [ ] Duplicate detection on signup
- [ ] Points earned, points redeemed
- [ ] Redeem more points than the balance — refused
- [ ] Loyalty on a returned sale — clawed back
- [ ] Medical authorisation upload and expiry

### 6.5 Staffing
- [ ] Clock in / clock out
- [ ] Clock out without clocking in
- [ ] Schedule creation
- [ ] Employee lifecycle (hire, deactivate)
- [ ] Permissions genuinely restrict what they claim to

### 6.6 Reporting
- [ ] Sales report cross-checked by hand against a known day
- [ ] Returns report
- [ ] Special discounts report
- [ ] Employee / leaderboard report
- [ ] COGS
- [ ] Net income
- [ ] Every report for an **empty** day
- [ ] Every report over a very **long** range
- [ ] Two reports covering the same period **agree with each other** ← high value

---

## 7. Known gaps and next steps

- [ ] Supply the make and model of the old USB printers (deferred from the previous session)
- [ ] Purchase or decide against the Star Cloud printer

---

## Running notes

*Record anything odd here, even if you are not sure it is a bug. "That felt wrong" is a valid entry and is often the first sighting of a real defect.*

| Date | Where | What happened | Repeatable? |
|------|-------|---------------|-------------|
|      |       |               |             |
