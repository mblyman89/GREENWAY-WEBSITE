# SOP-05b — Non-Cannabis Inventory, Merch, Menu Publishing, Categories, Sales-Limit Classification and Sell Price

| | |
|---|---|
| **Version** | 1.0 (draft for owner review) |
| **Effective** | On owner approval |
| **Owner** | Michael Lyman |
| **Applies to** | Every manager-level login (owner, admin, manager) who looks after non-cannabis goods (glass, papers, devices), the greenwaymerch.com apparel list, the menu that goes live on the website and the register, website categories and inventory types, the sales-limit classification worklist, and cannabis sell prices. Budtenders read §4.4 (ringing non-cannabis items) and §9. |
| **Verified against** | `main@827facb5` (2026-10-27). Every label, button, message, number and rule below was read from the code or quoted from the owner. Nothing was written from memory. Where the code and a help panel disagree, this SOP follows the code and records a finding. |
| **Program records** | Findings `F-05b-*` in `docs/sop-program/03-FINDINGS-LEDGER.md` · Gaps `G-29`…`G-32` in `docs/sop-program/05-GAP-REGISTER.md` · Owner decisions D35 (the 05a / 05b split), D41 (living SOPs), D42 (concierge covers every feature) and D43 (*"Please finish the inventory management sop."*) in `docs/sop-program/00-OWNER-REQUEST-VERBATIM.md` · Scope in `docs/sop-program/02-SOP-CATALOG-AND-ROADMAP.md` (SOP-05b) |

> **This SOP is a living document (owner decision D41).** The owner said: *"We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary."* When any gap named here (Appendix B) is built, this SOP is updated in the same piece of work: the sections the gap names, Appendix B, Appendix D (a new revision row), the finding marked FIXED, and the concierge entry (charter §3 rules 9–10). Until then, the interim procedures in this SOP are the rule.

> **How to use this document.** Part 1 (§4.1–§4.9) is **Other Inventory**: the non-cannabis catalog, SKU labels, adjustments, vendor paper invoices and costs, and how a non-cannabis item is sold today. Part 2 (§4.10–§4.11) is **Merch Inventory** (greenwaymerch.com). Part 3 (§4.12–§4.14) is **Publish Menu**. Part 4 (§4.15–§4.17) is **Types & Categories** and re-filing one product. Part 5 (§4.18–§4.19) is the **Sales-Limit Classification** worklist. Part 6 (§4.20–§4.21) is the **cannabis sell price**. Section 5 lists the messages. Section 8 holds the paper forms. Section 9 is a one-page card. Words in **bold** are the exact labels you will see on the screen.

> **The one thing to know before anything else.** **Other Inventory is not connected to the register.** The SKU label it prints and the manufacturer barcode it stores **do not ring up** when scanned, and a sale at the register **does not lower** the count on the Other Inventory page (§4.4, finding F-05b-1, **S1**). Today every non-cannabis item is rung on the register **Keypad** under **merch** or **accessories**, and the shelf count is put right by the weekly reconciliation in §4.5 (form 8.1). Until gap G-29 is built, the **On hand**, **Reorder now**, **Retail value** and **Margin on hand** figures on that page are only as good as the last reconciliation.

---

## Table of contents

1. Purpose & scope
2. Roles & permissions
3. Before you start
4. Procedures

   **Part 1: Other Inventory (non-cannabis goods)**
   - 4.1 What Other Inventory is, and what it is not
   - 4.2 A tour of the page
   - 4.3 Adding a product: draft, confirm, label
   - 4.4 Selling a non-cannabis item today (the Keypad)
   - 4.5 Adjusting a count, and the weekly reconciliation
   - 4.6 Entering a vendor's paper invoice
   - 4.7 Unit cost: keying a missing cost
   - 4.8 Barcode, reorder point and shelf: Save settings
   - 4.9 Changing a price, and archiving an item

   **Part 2: Merch Inventory (greenwaymerch.com)**
   - 4.10 What the Merch page is
   - 4.11 Hide, put back, remove and copy stock

   **Part 3: Publish Menu**
   - 4.12 How a menu goes live
   - 4.13 Working the "Waiting for you" queue
   - 4.14 Publishing an update by hand: the removal check

   **Part 4: Types & Categories**
   - 4.15 Website categories and inventory types
   - 4.16 Moving products between categories
   - 4.17 Re-filing one product from its lot page

   **Part 5: Sales-limit classification**
   - 4.18 Why classification decides the purchase limit
   - 4.19 Working the classification worklist

   **Part 6: The cannabis sell price**
   - 4.20 Reading the sell price on a lot
   - 4.21 Correcting the sell price (and the size link)

5. Messages: "If you see this message"
6. Exceptions & escalation
7. Controls & compliance (why the rules exist)
8. Checklists & forms
9. Quick reference card
10. Glossary

Appendix A: Source map · Appendix B: Not built yet (interim procedures) · Appendix C: Open questions for the owner · Appendix D: Revision history

---

## 1. Purpose & scope

The owner asked for SOPs that cover how the back office is really used (`00-OWNER-REQUEST-VERBATIM.md`), split inventory management in two (D35, *"I want you to break this one up into two slices"*), and then said *"Please finish the inventory management sop."* (D43). SOP-05a covers the cannabis lot itself. **This SOP covers everything around the lot:**

- **Other Inventory** (`/admin/inventory/noncannabis`): glass, papers, lighters, batteries and other non-cannabis goods. These are not reported to CCRS.
- **The SKU label** for a non-cannabis item (`/admin/inventory/noncannabis/[id]/label`).
- **Merch Inventory** (`/admin/inventory/merch`): the apparel sold by Greenway Merchandising LLC on greenwaymerch.com. It is never sold on the cannabis register.
- **Publish Menu** (`/admin/publish`): how approved products reach the website and the register.
- **Types & Categories** (`/admin/settings/types`): the website categories shoppers browse, and the inventory types behind them.
- **Re-filing one product** (the lot page's **Website type & category (menu)** box).
- **Sales-Limit Classification** (`/admin/compliance/classification` and the lot page's **Sales-limit classification** box).
- **The cannabis sell price** (the lot page's **Sell price** row, **Correct the sell price** and **Which size is this lot?**).

**Not in this SOP.** Everything about the lot's quantity, status, recalls, expiry, labels and labs (**SOP-05a**). Receiving and onboarding, including the first price a product gets (**SOP-04**). Menu Imports uploads and the Cultivera cutover (**SOP-10**, data migration). Cycle counts (**SOP-06**). Returns and destruction (**SOP-15**). The register itself, including the Keypad (**SOP-01** §4.8). Paying a vendor invoice on Accounts Payable (the accounts payable SOP on the roadmap). Merch Studio design and publishing (the marketing SOPs on the roadmap). Sales-limit settings (`/admin/compliance/sales-limits`, the compliance SOPs on the roadmap).

**Why it matters.** Three things on these pages decide what a customer pays and how much they may buy: a product's **website category** (it picks the tax: cannabis carries 37% excise plus 9.3% sales tax, non-cannabis carries 9.3% only), its **sales-limit classification** (it picks the purchase limit), and its **sell price** (it may never go below cost plus tax). A mistake on any of them is a tax or licence problem, not a cosmetic one (§7).

## 2. Roles & permissions

| Action | Who the app allows | Where the rule lives |
|---|---|---|
| Open **Other Inventory**, add a product, **Confirm**, **Archive**, **Post adjustment**, **Save settings**, **Save invoice**, print a SKU label | Owner, admin, manager (`inventory.manage`) | `noncannabis/page.tsx` L87; `noncannabis/actions.ts` L66, L87, L95, L108, L156, L284; `[id]/label/page.tsx` L28; `roles.ts` L106 |
| **Save cost** (key a missing non-cannabis unit cost) | Owner, admin only (`inventory.cost.fill`) | `roles.ts` L148; `noncannabis/actions.ts` L337–368 |
| Open **Merch Inventory**, **Hide from website**, **Put back on website**, **Remove**, **Copy Printful stock to the website**, **Download CSV** | Owner, admin, manager (`inventory.manage`) | `merch/page.tsx` L34; `merch/actions.ts` L23, L34, L51; `merch/export/route.ts` L14 |
| Open **Publish Menu** | Owner, admin, manager (`menu.import`) | `publish/page.tsx` L116; `roles.ts` L82 |
| Press the row button that publishes, **Publish this menu live**, **Publish the ready products** | Owner, admin, manager (`menu.publish`) | `publish/page.tsx` L118, L395–412; `menu-imports/actions.ts` L179, L358; `roles.ts` L83 |
| Publish with products still awaiting review (**Publish now and fix after**) | Owner, admin only (`menu.publish.open_reviews`) | `menu-imports/actions.ts` L245–250; `roles.ts` L88 |
| **Types & Categories**: add, save, delete or hide a category or type, **Move products** | Owner, admin only (`settings.manage`) | `settings/types/page.tsx` L68; `settings/types/actions.ts` L50, L89, L124, L181, L217, L284, L368; `roles.ts` L248 |
| Lot page: **Save website type & category**, **Save sales-limit classification**, **Save sell price**, **Save size**; open the classification worklist | Owner, admin, manager (`inventory.manage`) | `inventory/actions.ts` L507, L709, L840, L1040; `compliance/classification/page.tsx` L75 |

**Store rules on top of the app (this SOP).**

- **Non-cannabis sell price and cost changes:** owner only, on form 8.2, until Q-05b-2 is answered (§4.9). The app has no way to change either after an item is created (finding F-05b-6).
- **Moving or re-filing a product across the cannabis / non-cannabis line** (into or out of **Accessories**, **Greenway Merch** or **Paraphernalia**): **never**, by anyone, until gap G-31 is built (§4.16–§4.17, finding F-05b-9, **S1**).
- **Removing a product from greenwaymerch.com:** owner or admin only, until Q-05b-3 is answered (§4.11).
- **Cannabis sell price where the lot page says "Cost is unknown for this lot":** owner only, after reading the cost on the vendor's CCRS manifest (§4.21, D38).

## 3. Before you start

1. **Know which inventory you are in.** **Inventory** is cannabis lots (SOP-05a). **Other Inventory** is non-cannabis goods sold in the store. **Merch Inventory** is apparel sold by a separate company on a separate website (`admin-nav-data.ts` L84–86).
2. **Know the three non-cannabis categories.** The tax and limit engines treat exactly these category values as non-cannabis: `merch`, `accessories`, `accessory`, `paraphernalia` (`order-pricing-core.ts` L42–47). On screen they are **Greenway Merch**, **Accessories** and **Paraphernalia** (`category-taxonomy.ts` L13–15). Everything else, including a blank category, is treated as cannabis (`scan-required-core.ts` L55–61).
3. **Know that a published price is out-the-door.** Every price on the menu and the register already includes tax. The lot page shows the pre-tax base so the math is visible (§4.20).
4. **Have the paperwork.** For a vendor invoice: the paper invoice. For a cannabis price: the vendor's CCRS manifest cost (SOP-04). For classification: the product's package label.
5. **Keep the binder forms to hand:** 8.1 (non-cannabis keypad sales and weekly reconciliation), 8.2 (non-cannabis price or cost change), 8.3 (category and menu change log), 8.4 (weekly menu and classification check).

---

## 4. Procedures

# Part 1: Other Inventory (non-cannabis goods)

### 4.1 What Other Inventory is, and what it is not

The page header reads **Non-cannabis inventory** with the line *"Glass, accessories, papers & devices — professionally tracked (not CCRS-reported)"* (`noncannabis/page.tsx` L142–143). It is the store's catalog of non-cannabis goods: one row per item, with a SKU, an optional manufacturer barcode, a price, a cost, a count, a reorder point and a shelf location.

**What it does today:**

- keeps the catalog, the counts you post by hand, and an append-only adjustment ledger (§4.5);
- prints a 2.25 in × 1.25 in SKU label with a Code128 barcode, the price and the name (`[id]/label/page.tsx` L37–80);
- records a vendor's paper invoice and turns it into a payable on Accounts Payable (§4.6);
- shows a **Reorder now** list, **Retail value**, **Margin on hand** and an ABC ranking by retail value (`merch-intel-core.ts` L231–258).

**What it does not do (finding F-05b-1, S1):**

- **It is not on the register.** The register's product list comes only from the published menu (`live-menu.ts` L155–157). The register's barcode list holds only cannabis lot codes and CCRS identifiers (`api/pos/menu/route.ts` L179, L405–415; `scan-to-cart-core.ts` L55–75), and a scan matches only those (`scan-to-cart-core.ts` L101–144). No register or sale code reads the non-cannabis catalog at all; the only readers are this page, its store, the knowledge base and system tools.
- **So the SKU label and the UPC do not ring up,** although the label page's own design note says it exists *"so staff can scan them at the register"* (`[id]/label/page.tsx` L7–8), and the page's help panel says *"staff scan the package itself"* (`noncannabis/page.tsx` L230–240).
- **A register sale does not lower On hand.** Keypad lines are skipped by the sale decrement on purpose (`sale-decrement.ts` L107–110), and there is no other link.

Until gap **G-29** is built, run Other Inventory as a **shelf catalog with a weekly count** (§4.4–§4.5). Its figures are true only as of the last reconciliation.

### 4.2 A tour of the page

From top to bottom (`noncannabis/page.tsx`):

| Area | What it shows | Lines |
|---|---|---|
| Result banners | **Could not save: …** · **Staged draft … Confirm it below to make it active.** · adjustment posted · **Settings saved for …** · cost saved · the orange **Cost missing** banner with **Show only cost-missing catalog items** (owner / admin) or *"Only the owner or an admin can key a missing cost."* (managers) | L150–203 |
| KPI cards | **Active items**, **Units on hand**, **Retail value** (price × on hand), **Margin on hand** (retail − cost), **Reorder now** (out / below / near min), **Need SKU labels** (no manufacturer barcode) | L207–227 |
| Help panel | **How this page manages merch like a pro** | L230–240 |
| **Reorder now (n)** | Items that are **OUT**, **Below min** or **Near min** against their reorder point | L243–294 |
| **Documented reductions — last 30 days** | Damaged, theft, promo and other removals in the last 30 days | L297–335 |
| **Active catalog (n)** | The searchable catalog (below) | L338–343 |
| **Recent adjustments** | The ledger: time, item, change, reason, note | L346–391 |
| **Enter a vendor invoice (paper intake)** | The invoice builder (§4.6) | L394–408 |
| **Recent vendor invoices** | Saved invoices | L411–469 |
| **Add a non-cannabis product** | The intake form (§4.3) | L472–483 |
| **Drafts awaiting confirmation (n)** | Staged drafts with **🖨 Print SKU**, **Confirm** and **Archive** | L486–555 |

**The catalog** (`MerchCatalog.tsx`). **Search** (*"Name, SKU, barcode or shelf — scan a code to jump to the item"*, L288) finds an item on this page only; it does not sell it. **Type** filters by product type, and a checkbox shows only **Cost missing** items. The columns are **Item**, **Scan identity**, **ABC**, **On hand**, **Price**, **Shelf** (L318–323). **Adjust** opens the row; **Close** shuts it (L420). An open row has **Adjust quantity — every change is logged (who / why / when)** (L442), the cost box for an owner or admin when the cost is $0.00, the settings box (§4.8), **🖨 Print SKU label** (L457) and **Archive item** (L462).

**Recent adjustments shows the time in the browser's time zone and does not show who posted the row** (`noncannabis/page.tsx` L369 uses `toLocaleString()`; finding F-05b-5). Read the time on a store computer, and use form 8.1 for the name.

### 4.3 Adding a product: draft, confirm, label

Every new item is a **draft** first. A draft does not appear in the catalog until someone confirms it.

1. Go to **Inventory → Other Inventory → Add a non-cannabis product** (`NonCannabisIntakeForm.tsx`).
2. Fill in the fields:
   - **Brand (optional)** (*"e.g. RAW, Lookah, Sitka"*).
   - **Type** (required). The 22 types and their SKU prefixes are fixed, from **Pipe** (PIPE) to **Apparel / Merch** (APRL) and **Other** (MISC) (`noncannabis-core.ts` L30–53).
   - **Size / joint size**, **Gender (glass joint)**, **Color**.
   - **KB category (optional)**.
   - **Price ($)** (required on the form).
   - **Cost ($)**.
   - **Qty on hand**.
   - **Manufacturer barcode (optional)**: *"Has one? Scan it here — it becomes the register code. No barcode? Leave blank and print the SKU label."* (L122–124). See F-05b-1: today it does **not** become a register code.
   - **Reorder point** (*"0 = untracked"*), **Order qty**, **Shelf / bin** (*"e.g. Glass wall A2"*).
   - **Name override (optional)**, **Notes (optional)**.
3. Read the **Preview** box (*"drafts-only — you confirm before it goes live"*). It shows the SKU the server will build (PREFIX-0001, then size, color and M/F when given; `noncannabis-core.ts` L153–164) and the naming check. Fix anything it lists.
4. Press **Stage draft**. A manufacturer barcode must pass its check digit or the draft is refused (`noncannabis/actions.ts` L71–77). The banner reads **Staged draft PIPE-0001. Confirm it below to make it active.**
5. **Store rule: check the price before you confirm.** The app stores a blank or $0.00 price without complaint (`store.ts` L261), and **nothing on the page can change a price later** (F-05b-6, §4.9). A wrong price stays until the owner deals with it.
6. Under **Drafts awaiting confirmation**, press **Confirm**. The item moves to the catalog. **Confirm writes no audit row** (`noncannabis/actions.ts` L86–92; finding F-05b-2). Write the confirmation on form 8.1's catalog line.
7. If the item has no manufacturer barcode, press **🖨 Print SKU** and stick the label on the item or its peg. The label carries the price and name for the customer and the shelf. **Do not try to scan it at the register** (§4.4).

### 4.4 Selling a non-cannabis item today (the Keypad)

Until gap G-29 is built, every non-cannabis item in the store is rung on the **Keypad** (SOP-01 §4.8):

1. On the register, open the **Keypad** tab.
2. Pick the category. The keypad offers only **merch** and **accessories** (`custom-sale-core.ts` L48), with the line *"Non-cannabis only (merch & accessories) — cannabis must be rung from the menu so inventory, excise, and limits stay exact."* (`SaleFlow.tsx` L2538–2539). Glass, papers, lighters and devices are **accessories**; Greenway-branded goods sold in the store are **merch**.
3. In *"What is it? (optional — prints on the receipt)"* (L2564), type **the SKU and a short name** (for example `PIPE-0001 blue spoon`). Store rule: always fill it in. It is up to 60 characters (`custom-sale-core.ts` L55), and it is the only record of what was sold.
4. Key the price from the label and press **Add to check** (L2586). The keypad stops at $999.99 (`custom-sale-core.ts` L51–52).
5. Never ring a cannabis product on the keypad, and never ring a non-cannabis item as cannabis. The keypad line is taxed at 9.3% only, with no excise and no purchase limit (§7).

The **On hand** figure on Other Inventory does **not** change. The weekly reconciliation (§4.5) brings it back in line.

### 4.5 Adjusting a count, and the weekly reconciliation

**The reasons** (`merch-intel-core.ts` L269–278):

| Reason on screen | Normal direction | Note |
|---|---|---|
| **Received stock** | + | Optional. Prefer the invoice builder (§4.6) for vendor stock. |
| **Customer return to stock** | + | Optional |
| **Count correction** | either | Optional in the app. **Store rule: always write one.** |
| **Damaged / broken** | − | Optional |
| **Theft / loss** | − | **Required** (*"A note is required for theft/other — say what happened."*) |
| **Promo / giveaway** | − | Optional |
| **Sale not rung correctly** | − | Optional |
| **Other** | either | **Required** |

**To post an adjustment:**

1. Open the item (**Adjust**).
2. Pick the **Reason**. The **Direction** (**+ Add** / **− Remove**) follows the reason, but it can be changed afterwards and the app accepts any direction with any reason (`MerchCatalog.tsx` L90–110; `noncannabis/actions.ts` L119; finding F-05b-4). **Store rule: never change the direction away from what the reason means.** Theft is never an add.
3. Enter **Units** (a whole number) and a **Note**.
4. Press **Post adjustment**. The count cannot go below zero (*"That would take on-hand below zero (N on hand)."*). The change is audited (`noncannabis.adjust`, `noncannabis/actions.ts` L137–145).

**Two people adjusting the same item at once can lose a change.** The save reads the count, writes the ledger row and then writes the new count as two separate steps, and a failure in the second step leaves a ledger row with no count change (`store.ts` L307–343; finding F-05b-3). Adjust one item at a time and check **On hand** after you post.

**The weekly reconciliation (every Monday, before opening; form 8.1 part B).** This is the interim control for F-05b-1.

1. Print or open form 8.1 part A for last week: every keypad line with a SKU in the note.
2. Count every item on the shelf (start with **A** items, then **B**, then **C**).
3. For each item: last week's **On hand** − units on form 8.1 part A = expected. Compare to the shelf count.
4. Post the keypad sales as **Count correction**, **− Remove**, with the note `Keypad sales week of <date>, form 8.1`.
5. If the shelf still differs from expected after that, post the difference as a **second** line with its true reason (**Theft / loss**, **Damaged / broken**, or **Count correction** with what you found), never folded into the sales line. That keeps shrink visible.
6. Initial form 8.1 part B. A difference of more than two units on any one item, or more than $50 retail in the week, goes to the owner the same day.

### 4.6 Entering a vendor's paper invoice

The owner's requirement, quoted in the code: *"The glass vendor will come in with a stock of inventory, we pick out what we want, then they write us up a paper invoice. So id like a way to intake non cannabis products through the other inventory page. It should be a simple invoice builder type of form, where we manually input the details and submit the form. That way we can use it as a source document for the ach payments page for vendors."* (`noncannabis/actions.ts` L212–217).

1. Go to **Enter a vendor invoice (paper intake)** (`InvoiceBuilderForm.tsx`).
2. Header: **Vendor** (*"As written on the invoice"*), **Invoice #** (*"Printed on the paper"*), **Invoice date**, and **Paper total ($)** (*"Optional typo-catcher — must match the lines"*). Store rule: **always** type the paper total. It is the check that catches a wrong line.
3. For each line, choose **New item** or **Restock existing**:
   - **New item:** **Description** (*"Becomes the draft's name"*), **Type** (*"Drives the SKU"*), **Qty**, **Unit cost ($)**, **Retail ($)** (*"Optional shelf price"*). Store rule: **always** type the retail price. A blank retail creates a draft priced $0.00 (`invoice-store.ts` L142), which nothing can correct later (§4.9).
   - **Restock existing:** **Product**, **Qty**, **Unit cost ($)**.
4. Add rows with the add-row button; add a **Note** if useful.
5. Press **Save invoice**. On success: *"Invoice #… from … saved ($…). … It now appears on the Accounts Payable page as a payable."* (`noncannabis/actions.ts` L319). New items appear under **Drafts awaiting confirmation**; restocks post **Received stock** adjustments with the invoice number in the note.
6. Confirm each new draft (§4.3 steps 5–7), checking its price first.
7. File the paper invoice in the vendor folder, marked with the date entered.

**If the save fails part-way.** When a line fails, the app deletes the invoice header but **not** the drafts or restock adjustments that earlier lines already made (`invoice-store.ts` L124–128, L135–158; finding F-05b-7). Before you try again:

- look under **Drafts awaiting confirmation** for drafts with the note *"From vendor invoice #…"* and **Archive** them;
- look under **Recent adjustments** for **Received stock** lines with the note *"Vendor invoice #…"* and reverse each with a **Count correction**, **− Remove**, note `Reversing failed invoice save #<n>`;
- then enter the invoice again.

The same vendor and invoice number can only be entered once: *"Invoice #… from … is already entered. Each paper invoice is entered once."* (`invoice-store.ts` L107–111).

### 4.7 Unit cost: keying a missing cost

A non-cannabis item with a $0.00 cost shows the **Cost missing** chip (`cost-fill-core.ts` L44), and its margin is overstated.

1. Only the owner or an admin can do this (`inventory.cost.fill`). A manager sees *"Only the owner or an admin can key a missing cost."*
2. Open the item. Type **Unit cost (what you paid per item)** from the vendor's invoice and press **Save cost** (`MerchCatalog.tsx` L148–173).
3. The save works only while the cost is still $0.00: *"Filling only works when the cost is $0.00, so a keyed cost is never overwritten."* (`cost-fill-core.ts` L46–47). It is audited (`noncannabis.cost_fill`).

This is **non-cannabis** cost only. **A cannabis unit cost is never typed by anyone**; it comes only from the vendor's CCRS manifest (owner decision D38; SOP-05a §4.20).

### 4.8 Barcode, reorder point and shelf: Save settings

In the open row: **Manufacturer barcode (UPC/EAN)** (*"Scan or type the code on the package"*), **Reorder point** (*"0 = untracked"*), **Order qty**, **Shelf / bin**. Press **Save settings**. The barcode check digit is checked, and the change is audited (`noncannabis.ops_update`, `noncannabis/actions.ts` L155–207). The banner reads **Settings saved for <SKU>.**

Set a reorder point on every **A** and **B** item, so the **Reorder now** list means something. Remember that the count it compares against is only as fresh as the last reconciliation (§4.5).

### 4.9 Changing a price, and archiving an item

**There is no way to change a non-cannabis price or a non-zero cost in the app** (finding F-05b-6). The price is set once, when the draft is created (`noncannabis/actions.ts` L51), and no screen or action edits it later. The cost can be filled once, only while it is $0.00 (§4.7).

**Interim procedure (owner only, form 8.2), until gap G-30 is built:**

1. Write the change on form 8.2: item, SKU, old price, new price, reason. The owner signs.
2. **Archive** the old item (§4.9 below), noting its **On hand**.
3. Stage a new draft with the same details and the new price (§4.3). It gets a new SKU. If the old item had a manufacturer barcode, enter it on the new item.
4. Confirm the new item and post its stock as **Count correction**, **+ Add**, note `Price change from <old SKU>, form 8.2`.
5. Print and apply new SKU labels and remove the old ones.

**Archiving an item.** **Archive item** (or **Archive** on a draft) hides it from the catalog. **There is no restore, and archiving writes no audit row** (`noncannabis/actions.ts` L94–100; `store.ts` L436–447; finding F-05b-2). Archive only an item that is gone for good, at **On hand** zero, or as part of the price-change procedure above. Write every archive on form 8.1's catalog line.

