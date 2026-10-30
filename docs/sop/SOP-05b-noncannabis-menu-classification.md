# SOP-05b — Non-Cannabis Inventory, Merch, Menu Publishing, Categories, Sales-Limit Classification and Sell Price

| | |
|---|---|
| **Version** | 1.3 (Phase 4 (plan rows 5.1/5.2; G-29/G-30/G-30A/G-32) built: Other Inventory is on the register; draft for owner review) |
| **Effective** | On owner approval |
| **Owner** | Michael Lyman |
| **Applies to** | Every manager-level login (owner, admin, manager) who looks after non-cannabis goods (glass, papers, devices), the greenwaymerch.com apparel list, the menu that goes live on the website and the register, website categories and inventory types, the sales-limit classification worklist, and cannabis sell prices. Budtenders read §4.4 (ringing non-cannabis items) and §9. |
| **Verified against** | `main@e1fe84eb` (v1.1, 2026-10-28: re-checked after the second performance merge; no file this SOP cites changed), `main@827facb5` (v1.0, 2026-10-27). Every label, button, message, number and rule below was read from the code or quoted from the owner. Nothing was written from memory. Where the code and a help panel disagree, this SOP follows the code and records a finding. |
| **Program records** | Findings `F-05b-*` in `docs/sop-program/03-FINDINGS-LEDGER.md` · Gaps `G-29`…`G-32` and `G-30A` in `docs/sop-program/05-GAP-REGISTER.md` · Owner decisions D35 (the 05a / 05b split), D41 (living SOPs), D42 (concierge covers every feature), D45–D49 (the answers applied in v1.1) and D43 (*"Please finish the inventory management sop."*) in `docs/sop-program/00-OWNER-REQUEST-VERBATIM.md` · Scope in `docs/sop-program/02-SOP-CATALOG-AND-ROADMAP.md` (SOP-05b) |

> **This SOP is a living document (owner decision D41).** The owner said: *"We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary."* When any gap named here (Appendix B) is built, this SOP is updated in the same piece of work: the sections the gap names, Appendix B, Appendix D (a new revision row), the finding marked FIXED, and the concierge entry (charter §3 rules 9–10). Until then, the interim procedures in this SOP are the rule.

> **How to use this document.** Part 1 (§4.1–§4.9) is **Other Inventory**: the non-cannabis catalog, SKU labels, adjustments, vendor paper invoices and costs, and how a non-cannabis item is sold today. Part 2 (§4.10–§4.11) is **Merch Inventory** (greenwaymerch.com). Part 3 (§4.12–§4.14) is **Publish Menu**. Part 4 (§4.15–§4.17) is **Types & Categories** and re-filing one product. Part 5 (§4.18–§4.19) is the **Sales-Limit Classification** worklist. Part 6 (§4.20–§4.21) is the **cannabis sell price**. Section 5 lists the messages. Section 8 holds the paper forms. Section 9 is a one-page card. Words in **bold** are the exact labels you will see on the screen.

> **The one thing to know before anything else.** **Other Inventory is on the register (Phase 4, G-29 BUILT; finding F-05b-1 FIXED).** Every **active** item with a price is a product on the register, its SKU label and its manufacturer barcode **ring it up** when scanned, and a completed sale **lowers On hand** in the same database step that writes the ledger row (§4.4). A void puts the units back, and a counter return can put them back on the shelf (§4.4). The sale books the item's average unit cost as cost of goods sold (finding F-05b-15 FIXED). **Database update 0323 must be run first** (`docs/MIGRATIONS_TO_RUN.md`, "Fix 4"); until it is, items still show and scan on the register and sales still lower On hand by the older two-step write, but counter returns of these items are refused with a plain message. The **Keypad** stays for anything not in the catalog, and the Monday reconciliation (§4.5, form 8.1) now only has to catch keypad lines and shrink.

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
| Open **Other Inventory**, add a product, **Confirm**, **Archive**, **Restore**, **Post adjustment**, **Save settings**, **Save invoice**, print a SKU label | Owner, admin, manager (`inventory.manage`) | `noncannabis/page.tsx` L87; `noncannabis/actions.ts` L69, L98 (Confirm / Archive / Restore share one audited step, L96–124), L185, L237, L364; `[id]/label/page.tsx` L28; `roles.ts` L111 |
| **Save change** (change a non-cannabis **shelf price** or **unit cost**; reason required) | Owner, admin, manager (`inventory.manage`; owner D46) | `noncannabis/actions.ts` L146–182; `MerchCatalog.tsx` `PriceCostForm` |
| **Save cost** (key a missing non-cannabis unit cost) | Owner, admin only (`inventory.cost.fill`) | `roles.ts` L154; `noncannabis/actions.ts` L418–419 |
| Open **Merch Inventory**, **Hide from website**, **Put back on website**, **Copy Printful stock to the website**, **Download CSV** | Owner, admin, manager (`inventory.manage`) | `merch/page.tsx` L35; `merch/actions.ts` L23, L51; `merch/export/route.ts` L14 |
| Merch **Remove...** (permanently remove a product from greenwaymerch.com) | Owner, admin only (`merch.remove`; owner D47) | `roles.ts` L155–158; `merch/actions.ts` L35; `merch/page.tsx` L37, L131 (managers do not see the box) |
| Open **Publish Menu** | Owner, admin, manager (`menu.import`) | `publish/page.tsx` L116; `roles.ts` L83 |
| Press the row button that publishes, **Publish this menu live**, **Publish the ready products** | Owner, admin, manager (`menu.publish`) | `publish/page.tsx` L118, L395–412; `menu-imports/actions.ts` L179, L358; `roles.ts` L84 |
| Publish with products still awaiting review (**Publish now and fix after**) | Owner, admin only (`menu.publish.open_reviews`) | `menu-imports/actions.ts` L245–250; `roles.ts` L89 |
| **Types & Categories**: add, save, delete or hide a category or type, **Move products** | Owner, admin only (`settings.manage`) | `settings/types/page.tsx` L68; `settings/types/actions.ts` L50, L89, L124, L181, L217, L284, L368; `roles.ts` L249 |
| Lot page: **Save website type & category**, **Save sales-limit classification**, **Save sell price**, **Save size**; open the classification worklist | Owner, admin, manager (`inventory.manage`) | `inventory/actions.ts` L507, L709, L840, L1040; `compliance/classification/page.tsx` L75 |

**Store rules on top of the app (this SOP).**

- **Non-cannabis sell price and cost changes:** **owner, admin or manager** (owner decision D46: *"Q-05b-2- owner, admin, manager."*). **The app now does this** with **Save change** (Phase 4, G-30 BUILT; finding F-05b-6 FIXED; §4.9): a reason is required, $0.00 is refused, the SKU never changes, and the Security Log keeps old → new. **The cost of a non-cannabis item may be changed** (D48: *"non cannabis should be allowed to have their cost modified."*). This is the opposite of cannabis, whose cost is never typed (D38).
- **Moving or re-filing a product across the cannabis / non-cannabis line** (into or out of **Accessories**, **Greenway Merch** or **Paraphernalia**): **never, by anyone, in either direction. This is permanent** (owner decision D48: *"refused outright, non cannabis should also be refused outright moving them into a cannabis type."*). **The app now refuses it with no override** (Phase 0.4, G-31 **BUILT**; `cannabis-line-core.ts`; §4.15–§4.17; finding F-05b-9 FIXED).
- **Removing a product from greenwaymerch.com:** **owner or admin only** (owner decision D47: *"Q05b-3- owner and admin."*). **The app now enforces it** (`merch.remove`; Phase 4, G-30A BUILT; finding F-05b-14 FIXED; §4.11).
- **Cannabis sell price where the lot page says "Cost is unknown for this lot":** **nobody saves a price until the manifest cost is entered** (owner decision D49: *"blocked until the manifest cost is entered."*; §4.21, D38).

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

**On the register (Phase 4, G-29 BUILT; finding F-05b-1 FIXED):**

- **Every active item with a price is a register product.** The register's menu download adds them as their own cards, keyed `nc-<item id>` so they can never be mistaken for a cannabis product (`api/pos/menu/route.ts` L449–464; `pos-catalog-core.ts` `toPosMenuProduct`). A draft, an archived item or an item priced $0.00 is not sold. An item at **On hand** 0 still shows, marked unavailable, so a scan says it is out instead of "not found".
- **The SKU label and the UPC ring it up.** Both join the register's barcode list. If a code is also a cannabis lot code, **the cannabis product wins** and the Other Inventory code is left out (`mergeNcBarcodes`).
- **Category, tax and limits.** Apparel goes on the register as **merch**, everything else as **accessories** (`ncRegisterCategory`). Those are the store's non-cannabis categories, so the line is taxed 9.3% only, with no excise and no purchase limit (§7).
- **A completed sale lowers On hand** in one database step, with a ledger row **Sold at the register** that keeps the order line and the unit cost at that moment (`sale-decrement.ts` L126; `register-stock.ts` `moveNcStockForOrder`; 0323 `apply_noncannabis_delta`). The same line can never be taken off twice. If the shelf already reads 0, the count stays at 0 (the customer already has the item) and the Monday count finds the gap.

**The owner approved G-29 and widened it** (decision D45): *"Q-05b-1- yes, and any other upgrade, enhancement and such needed to fully utilize non cannabis goods in the system and on the register and on the menu."* So G-29 now covers non-cannabis goods **everywhere they should appear**, not only the scan. Read in the code, these are the places where non-cannabis goods are not yet fully used, and each is part of G-29:

1. **Register scan and sale:** **BUILT** (above).
2. **Cost of goods sold:** **BUILT.** A catalog line's cost is the item's average unit cost, read when the sale is posted to the books (`sale-posting-service.ts` L364–372). An item whose cost is $0.00 (**Cost missing**) makes the sale's cost entry refuse with the reason, never post a zero, so key the cost (§4.7). Keypad lines still carry no cost (`custom-sale-core.ts` L144), which is why catalog items should be scanned, not keyed (finding **F-05b-15** FIXED for catalog items).
3. **The website:** **BUILT, display only.** The shop shows an **Also in store** list under the menu: name, brand and shelf price of active, in-stock items (`InStoreGoods.tsx`; `ShopPage.tsx` L210–214). There is no add-to-cart, because online pickup orders stay cannabis-only. Cost, count, SKU and barcode are never shown.
4. **Voids, returns and reports:** **BUILT.** A void puts the units back (`void-store.ts` L233); a counter return puts them back or writes them off (§4.4); the page shows **Register sales — last 30 days** with revenue, cost and margin (§4.2). Sale.csv for the state never includes these lines (`ccrs-sales.ts` L329–337), and a return of one is never a CCRS Sale correction (`ccrs-batch.ts` L474–475).

The full build list is in gap G-29 (gap register).

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

### 4.4 Selling, voiding and returning a non-cannabis item

**Selling (Phase 4, G-29 BUILT).**

1. **Scan the SKU label or the package's UPC.** The item goes on the check at its shelf price. You can also find it by name in the register's product list (under **accessories** or **merch**).
2. If the register says the item is out (On hand 0) but it is in your hand, use the usual **Sell anyway** override; the Monday count (§4.5) puts the count right.
3. Complete the sale as normal. On hand drops by the units sold, and the ledger row reads **Sold at the register** (§4.5).

**The Keypad stays** for something that is not in the catalog (SOP-01 §4.8). The keypad offers only **merch** and **accessories** (`custom-sale-core.ts` L48), with the line *"Non-cannabis only (merch & accessories) — cannabis must be rung from the menu so inventory, excise, and limits stay exact."* (`SaleFlow.tsx` L2541–2542). Type the item and a short name in *"What is it? (optional — prints on the receipt)"* (L2564). A keypad line lowers no count and books no cost, and **a keypad line makes the whole sale's cost entry refuse** (the accounting rule refuses an unknown cost; `sale-posting-service.ts`). So: **if the item is in the catalog, scan it.** If it is not, add it to the catalog (§4.3 or §4.6) and print its label.

**Voiding a sale.** A void of a sale with catalog items puts each unit back on the shelf, with a ledger row **Sale voided (put back)**. A line is only ever put back once (`void-store.ts` L233; 0323).

**A counter return** (SOP-01 returns). Look up the receipt and pick the line as usual.

- **Restock** puts the units back (**Customer return (put back)** in the ledger) and **Destroy** writes them off (the count does not change, and the result says *"Written off (not put back on the shelf)."*). Both are saved in one database step together with the return record (`returns-store.ts` L285–300; `noncannabis/returns.ts`; 0323 `record_noncannabis_return`).
- The register still shows the two cannabis checkboxes (original packaging, lot ID legible). Tick both for a non-cannabis item; they are not used for it.
- The refund, the loyalty clawback and the refund receipt work exactly as for cannabis. The return is **not** sent to the state (non-cannabis is never reported to CCRS).
- If you see *"Database update 0323 is not applied yet, so Other Inventory returns can't be saved."*, nothing was changed. Tell the owner (the update is in `docs/MIGRATIONS_TO_RUN.md`, Fix 4).

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
2. Pick the **Reason**. **The reason now sets the direction** (Phase 4, G-32 item 3; finding F-05b-4 FIXED): **Received stock** and **Customer return to stock** always add; **Damaged / broken**, **Theft / loss**, **Promo / giveaway** and **Sale not rung correctly** always remove, and the form shows *"(set by reason)"*. Only **Count correction** and **Other** let you choose **+ Add** or **− Remove**, and the server checks it again (`noncannabis/actions.ts` L184–200; `pos-catalog-core.ts` `signedDeltaForReason`).
3. Enter **Units** (a whole number) and a **Note**.
4. Press **Post adjustment**. The count cannot go below zero (*"That would take on-hand below zero (N on hand)."*). The change is audited (`noncannabis.adjust`, `noncannabis/actions.ts` L137–145).

**An adjustment is one database step** (Phase 4, G-32 item 2; finding F-05b-3 FIXED). The item's row is locked, the count is checked, and the ledger row and the new **On hand** are written together, so two people adjusting at once can no longer lose a change, and a refusal changes nothing (*"That would take On hand below zero (N on hand). Nothing was changed."*; `store.ts` `createNonCannabisAdjustment`; 0323 `apply_noncannabis_delta`). Before update 0323 is run, the older two-step write is used.

**Recent adjustments** now shows **By** (who) and the time in Pacific time (G-32 item 4; finding F-05b-5 FIXED). Register rows (**Sold at the register**, **Sale voided (put back)**) show **Register**.

**The weekly reconciliation (every Monday, before opening; form 8.1 part B).** Scanned sales now lower On hand by themselves, so this count catches **keypad lines** (part A) and **shrink**.

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

**The whole invoice is saved in one database step** (Phase 4, G-32 item 5; finding F-05b-7 FIXED; 0323 `record_noncannabis_invoice`). The header, every line, every new draft and every restock are saved together, or nothing is: *"The invoice was not saved and nothing was changed: …"*. Fix the line and press **Save invoice** again. The Security Log entry is now checked, not skipped silently (G-32 item 6; finding F-05b-8 FIXED).

**Average cost.** A **Restock existing** line sets the item's unit cost to the moving average of what was on hand and what arrived: (old count × old cost + new units × new cost) ÷ (old count + new units), rounded to the cent. If the item's cost was $0.00 or it had none on hand, the new cost is used. This is the cost a sale then books (§4.1 item 2).

The same vendor and invoice number can only be entered once: *"Invoice #… from … is already entered. Each paper invoice is entered once."* (`invoice-store.ts` L107–111).

### 4.7 Unit cost: keying a missing cost

A non-cannabis item with a $0.00 cost shows the **Cost missing** chip (`cost-fill-core.ts` L44), and its margin is overstated.

1. Only the owner or an admin can do this (`inventory.cost.fill`). A manager sees *"Only the owner or an admin can key a missing cost."*
2. Open the item. Type **Unit cost (what you paid per item)** from the vendor's invoice and press **Save cost** (`MerchCatalog.tsx` L148–173).
3. The save works only while the cost is still $0.00: *"Filling only works when the cost is $0.00, so a keyed cost is never overwritten."* (`cost-fill-core.ts` L46–47). It is audited (`noncannabis.cost_fill`).

**How this fits the owner's newer answer.** Today **Save cost** is owner and admin only (`inventory.cost.fill`, `roles.ts` L149). The code cites an earlier owner decision for that, D-R3-1: *"owner and admin can add cost if missing. … It can only be used for non cannabis inventory."* (`roles.ts` L144–146). In this SOP program the owner answered that an owner, admin or manager may change a non-cannabis price or cost (D46), and that the cost may be modified (D48). This SOP does not guess whether D46 also widens **Save cost** to managers. That is question **Q-05b-6**. Until it is answered, **Save cost** stays owner and admin as the app enforces. A manager can still set a cost with **Save change** (§4.9), which also works on a $0.00 cost and requires a reason.

This is **non-cannabis** cost only. **A cannabis unit cost is never typed by anyone**; it comes only from the vendor's CCRS manifest (owner decision D38; SOP-05a §4.20).

### 4.8 Barcode, reorder point and shelf: Save settings

In the open row: **Manufacturer barcode (UPC/EAN)** (*"Scan or type the code on the package"*), **Reorder point** (*"0 = untracked"*), **Order qty**, **Shelf / bin**. Press **Save settings**. The barcode check digit is checked, and the change is audited (`noncannabis.ops_update`, `noncannabis/actions.ts` L155–207). The banner reads **Settings saved for <SKU>.**

Set a reorder point on every **A** and **B** item, so the **Reorder now** list means something. Remember that the count it compares against is only as fresh as the last reconciliation (§4.5).

### 4.9 Changing a price or cost, archiving and restoring an item

**Change a price or a cost (Phase 4, G-30 BUILT; finding F-05b-6 FIXED).** Owner, admin or manager (D46: *"Q-05b-2- owner, admin, manager."*); the cost may be changed (D48: *"non cannabis should be allowed to have their cost modified."*).

1. Open the item (**Adjust**). Under **Price / cost**, choose **Shelf price** or **Unit cost** (the current amount is shown).
2. Type the **New amount ($)** and a **Reason** (for example *vendor raised the price*), then press **Save change** (`MerchCatalog.tsx` `PriceCostForm`; `noncannabis/actions.ts` L146–182).
3. The app refuses $0.00 (*"A price of $0.00 is refused. Type the shelf price."* / *"A cost of $0.00 is refused. Type what one unit cost."*), the same amount, an amount over $100,000, and a missing reason (`pos-catalog-core.ts` `validatePriceCostChange`).
4. If someone changed the same amount while you were typing, nothing is saved: *"The price of … changed while you were typing (or the item is archived). Nothing was saved; reload and try again."*
5. On success: **Saved the new <SKU> price** (or cost). The Security Log keeps the old and new amounts and the reason (`noncannabis.price_change` / `noncannabis.cost_change`). **The SKU never changes**, so the printed label still scans; reprint it if the price on it is now wrong.

The register picks up a new price on its next menu download.

**Archiving an item.** **Archive item** (or **Archive** on a draft) takes it out of the catalog and off the register. **Archive and Confirm are now audited** (old → new status, `noncannabis.archive` / `noncannabis.activate`; G-32 item 1; finding F-05b-2 FIXED).

**Restoring an item.** Open **Archived items** at the bottom of the page and press **Restore**. The item comes back as a **draft** (*"Item restored as a draft — confirm it to put it back on sale."*), so you check its price and **Confirm** it again (§4.3). Restore is audited (`noncannabis.restore`).

---

# Part 2: Merch Inventory (greenwaymerch.com)

### 4.10 What the Merch page is

**Merch inventory** (`/admin/inventory/merch`) is the apparel list for greenwaymerch.com. The page's subtitle reads: *"Greenway Glass & Goods apparel on greenwaymerch.com. Publishing in Merch Studio adds products here automatically."* (`merch/page.tsx` L55). The seller is Greenway Merchandising LLC (dba Greenway Glass & Goods). It is a separate company, it sells on a separate website, and Printful makes and ships every order. **Merch is never rung on the cannabis register, and it never appears on the cannabis menu.**

What you see:

- **Publish a design** (opens Merch Studio) and **Download CSV** (L59–60).
- Stat cards: **Products**, **Variants**, **Need attention**, **Units sold**, and **Revenue / gross profit** (L72–76).
- A filter row: **Search**, and **Show** = All / Live / Hidden / Needs attention.
- One card per product, with status **Live on greenwaymerch.com** or **Hidden**, and a variant table with these columns: **Colour**, **Size**, **Printful stock**, **Website**, **Retail**, **Printful**, **Profit**, **Margin**, **Sold**, **Revenue**.
- **Printful stock** is one of: **In stock**, **Made to order**, **Out of stock**, **Discontinued**, **Not checked**.

New products appear here only when they are published from Merch Studio. Designing and publishing a product is covered by the marketing SOPs on the roadmap, not by this SOP.

### 4.11 Hide, put back, remove and copy stock

**Hide a product from the website.** Press **Hide from website** on the product card (L126). The banner reads *"<name> is hidden from greenwaymerch.com (within about a minute)."* (`merch/actions.ts` L30). Use this for a product that is temporarily unavailable, or one with a problem you are looking into. It is audited (`merch.product_hidden`).

**Put it back.** Press **Put back on website**. The banner reads *"<name> is live on greenwaymerch.com again (within about a minute)."* It is audited (`merch.product_shown`).

**Remove a product (owner or admin only, D47).** The owner said: *"Q05b-3- owner and admin."* **The app enforces it** (Phase 4, G-30A BUILT; finding **F-05b-14** FIXED): **Remove...** is shown only to the owner and admins, and the action itself refuses anyone else (`merch.remove`; `merch/actions.ts` L35; `merch/page.tsx` L37, L131). Prefer **Hide**, because Hide can be undone.

1. Open **Remove...** on the card (L129).
2. Type the product's web name exactly as shown in grey in the box, then press **Remove** (L132–133).
3. If the name doesn't match, you will see *"Type the product's web name exactly to confirm removal."* (L36).
4. On success: *"<name> was removed. Past orders in Printful are not affected."* (L47). It is audited (`merch.product_removed`). To bring the product back, it has to be published again from Merch Studio.

**Copy Printful stock to the website.** Press **Copy Printful stock to the website** (`merch/page.tsx` L90). The app asks Printful for every variant's stock and updates the website: *"Checked N variants at Printful; M changed on greenwaymerch.com."*, followed by a note if Printful reported a problem (`merch/actions.ts` L62). It is audited (`merch.stock_synced`). Do this every Monday, alongside the reconciliation in §4.5, and any time a customer reports an item that looks out of stock.

**Needs attention.** Set **Show** to **Needs attention** to list the products that need you. Hide any variant that is **Discontinued** or **Out of stock** at Printful until it comes back.

---

# Part 3: Publish Menu

### 4.12 How a menu goes live

**Publish Menu** (`/admin/publish`) is where the menu for the website **and the register** goes live. The subtitle reads *"Approved products go live by themselves. This page shows the few updates that need you."* (`publish/page.tsx` L228), and the **In short** line reads *"Products you approve go live by themselves. This page lists the few updates that need a human first."* (`publish-guard-core.ts` L45–46).

The page's **How publishing works** panel has six steps (`publish-guard-core.ts` L59–66). Quoted in full:

1. *"When you approve a received product with a price, it goes live on the website and the register by itself. No Publish click."*
2. *"An update only waits here when a product fact needs a second look, or the automatic publish didn't finish. Each one says why and has one button."*
3. *"Publishing makes that update your live menu. The menu it replaces is archived, never deleted."*
4. *"When a newer menu goes live, older waiting updates are archived automatically, so you never have to pick between them."*
5. *"If publishing would take any product off the menu, the page names them and asks you to tick a box first."*
6. *"POS-export uploads and import history stay under Menu Imports (Settings)."*

The page has three tabs: **Overview**, **Issues** and **History** (`page-tab-sets.ts` L63–65). Its stat cards are **Live menu**, **Live variants**, **Waiting for you** and **Newest draft**. After a successful publish, the banner reads *"Published. The public menu now shows this version and its products are sellable at the register."* (L258).

> **"86" in plain words.** "86" is old restaurant slang for *"take it off the menu, we're out of it."* At Greenway, the 86 is the register link **"Shelf is empty? Mark out of stock…"**. It hides a product from every register and the website, and it changes no count, no lot and nothing sent to the state (SOP-05a §4.12). **An 86 is never done on Publish Menu.** Never publish an older or smaller menu to take one product off: the removal check in §4.14 would list everything that version removes, and the owner would lose the menu changes since then. The professional method (owner decision D40, gap G-26 APPROVED) treats every 86 as an exception with an owner and a cause. The manager works it the same shift on **Inventory → Issues**, and fixes the cause at the source (count, quarantine, recall or listing) per SOP-05a.

### 4.13 Working the "Waiting for you" queue

Open **Overview**. The **Waiting for you** section (L310–425) shows one row per update that needs a person. Each row carries a tag that says why it is waiting, and a single button (`publish-queue-core.ts` L68–82):

| Tag | Button | What to do |
|---|---|---|
| **Fact check** | **Check the flagged facts →** | Open Fact Review and confirm or correct the flagged facts (SOP-04). The update publishes itself once the facts are settled. |
| **Publish didn't finish** | **Try publishing again →** | Open it and publish again (§4.14). If it fails twice, stop and tell the owner (§6). |
| **Needs a Publish click** | **Review & publish →** | Read the change list, then publish (§4.14). |
| **POS upload** | **Review this upload →** | A Menu Imports upload. It is covered by SOP-10. Managers do not publish these without the owner. |
| **Waiting for Cultivera** | **Open the Cultivera cutover step →** | This is a cutover hold. **Do nothing**: SOP-10 covers it. |

A chip shows where each update came from: **from receiving** or **from POS upload**. A publisher may also see **Publish the ready products** (L402). Someone without publish rights sees *"A manager or admin publishes this."* (L411).

Further down the page:

- **Older than your live menu (n) — nothing to do** (L433). These rows really are nothing to do. They archive themselves.
- **Kept off the menu until their facts are set (n)**, with **Set the facts** (L461). These products will not sell until their facts are entered (SOP-04).

When the queue is empty, it reads *"Nothing waiting — every menu update from receiving has published automatically."* **History** lists **Recently published automatically**.

**Daily check (form 8.4).** At opening, open Publish Menu and write down the **Waiting for you** count. Clear every **Fact check** and **Needs a Publish click** row before noon.

### 4.14 Publishing an update by hand: the removal check

You publish by hand on the version page (`menu-imports/version/[versionId]`). A row button on Publish Menu takes you there.

1. Read the note above the button: *"Publishing makes this update your live menu and refreshes the public site. The menu it replaces is archived, not deleted."* (`PUBLISH_SWAP_NOTE`, version page L429).
2. **If the page lists products that would come off the live menu,** read every name. Tick *"I understand N products will come off the live menu (listed above), and that's what I want."* (L433) **only if each removal is intended.** If even one is a surprise, do not tick the box. Stop and tell the owner.
3. Press **Publish this menu live** (L437).
4. If you pressed it without ticking a needed box, nothing is published. You will see *"Not published yet: N products would come off the live menu. Tick the box if that's what you want. Otherwise nothing changes and the live menu stays as it is."* (`menu-imports/actions.ts` L222–231; `publish-guard-core.ts` L108).
5. If a Cultivera upload is waiting, an ordinary update is refused: *"Publish your one-time Cultivera menu first. …"* (L198–200; `cutover-guard-core.ts` L64). That is SOP-10's work.
6. **Publish now and fix after** publishes even though products are still awaiting review. It is **owner or admin only** (L245–250). A manager sees *"Only the owner or an admin can publish with products still awaiting review. Decide them in Fact Review, or ask the owner."* (`publish-now-core.ts` L55–56).

Every publish is audited (`menu_version.published`, L264).

**Know this limit (finding F-05b-10).** If the app cannot work out what would be removed, for example because the comparison fails to read, it **publishes anyway**. It only writes an error to the server log; it does not stop and does not warn you (`menu-imports/actions.ts` L232–237, *"fail open"*). After every hand publish, compare the **Live variants** count with what you expected. If it fell by more than the listed removals, tell the owner at once (§6).

---

# Part 4: Types & Categories

### 4.15 Website categories and inventory types

**Types & Categories** (`/admin/settings/types`) is owner/admin only (`settings.manage`, L68). The subtitle reads: *"Rename labels, edit help text, reorder, and activate or hide the categories that group your menu — and catalog the POS inventory types behind them."* (L115).

- **Website categories** tab: the groups shoppers browse. Stat cards: **Website categories**, **Hidden categories**, **Inventory types**, **Hidden inventory types**.
- **Inventory types** tab: the raw POS labels that arrive with imported stock. Each one **Maps to website category**.
- To add a category: **Add a website category**, then **Label**, **Value (optional)**, **Helper text**, **Sort order**, then **Add category**. To add a type: **Add an inventory type**, then **Label**, **Key (optional)**, **Maps to website category**, **Notes**, then **Add inventory type**.
- **Save** on a row renames it or changes its help text. *"Editing a label here changes it everywhere instantly. Nothing in your sales history changes."* (help step, L124).
- **Delete category** / **Delete type** hides the row instead of deleting it when it is built in or still in use. The page then says *"This is a built-in type, so it was hidden (deactivated) instead of deleted. Historical data stays intact."* or *"Still used by N live item(s), so it was hidden (deactivated) instead of deleted. …"* (L51–55). Built-in rows show **Hide category** / **Hide type** instead.
- **Heads up — N categories on your live menu aren't in this list** (L217) means the live menu uses a category value that has no row here. Add a row with the same value, or move those products (§4.16) after checking the cannabis line.

All changes are audited (`website_category.*`, `inventory_type.*`). The rename and delete audits do not record the before and after values (finding F-05b-11, S4), so **write every change on form 8.3**.

> **The cannabis line.** Three category values make a product **non-cannabis** to the tax and limit engines: **Greenway Merch** (`merch`), **Accessories** (`accessories`/`accessory`) and **Paraphernalia** (`paraphernalia`) (`order-pricing-core.ts` L42–50). Mapping an inventory type to one of these, or away from one, decides how every future product of that type is taxed. **Never map a cannabis inventory type to a non-cannabis category, or the other way round.** Since Phase 0.4 (G-31) the app refuses it on **Add type**, **Adopt** and **Save** (`settings/types/actions.ts` L53, L223, L266, L301): a type that any inventory lot carries, or that is mapped to a cannabis category, cannot be mapped to a non-cannabis one, and a non-cannabis type cannot be mapped to a cannabis one. The message starts *"Refused: ..."* and names the rule. A brand-new type with no lots may be mapped to a non-cannabis category.

### 4.16 Moving products between categories

**Move products between categories** (L237–270): **Move everything from**, **Into**, then **Move products**. The page explains: *"Moves everything at once: live menu, staged drafts, onboarding picks, and the inventory-type mappings (so future intake follows). Your sales history and archived menus are never touched. The change is recorded in the audit log."* (L238–241).

- On success: *"Done — N records moved to the new category. The customer menu updated immediately."* (L43–48).
- If you don't pick both: *"Pick both a source and a target category."* If you pick the same one twice: *"The source and target categories are the same — nothing to move."* If the target is hidden: *"… is hidden — products can't be moved into a hidden category. Re-activate it first."* (`category-registry-core.ts` L157–168).

> **Why this matters.** The move changes `menu_items.category` on the **live menu** (`category-registry.ts` L125–160), which is what the register prices from. If cannabis landed in **Accessories**, **Greenway Merch** or **Paraphernalia**, the register would:
> - charge **9.3% sales tax only, with no 37% excise** (`order-pricing-core.ts` L42–50);
> - stop counting it against the **purchase limit** (`sales-limits-core.ts` L370–374);
> - stop requiring a **scan** at the register (`scan-required-core.ts` L55–61);
> - **lower the legal price floor** (`price-correction-core.ts` L35–39, L61–67).
>
> **The owner's rule (D48, permanent):** a crossing is **refused outright, both ways**. **Built in Phase 0.4 (G-31):** `buildReassignPlan` refuses any move from a cannabis category into a non-cannabis one, or the other way round (`category-registry-core.ts` L174), with *"Refused: "<from>" to "<into>" crosses the cannabis line. ..."*. Nothing is moved, and the refused attempt is written to the audit log as `cannabis_line.refused` (`settings/types/actions.ts` L428–435). Moves between two cannabis categories, or between two non-cannabis categories, work as before; still note them on form 8.3. If anyone ever finds cannabis filed under a non-cannabis category (it will show on **Inventory → Issues**, see §4.17), **stop sales of that product** and tell the owner the same day.

### 4.17 Re-filing one product from its lot page

On a cannabis lot page, the **Website type & category (menu)** box (`[id]/page.tsx` L1176) changes how one product is filed:

- **Website category**: **Keep current** (change nothing), **Auto (remove my override)**, an existing category, or a new one. If you create one, type it in **New category name**.
- **Website type**: the same choices, with **New type name**.
- Press **Save website type & category** (L1270). This is audited (`inventory_lot.website_classification_edited`, `inventory/actions.ts` L506).

This writes a per-product override. On the website it changes where the product is listed (shop, home, specials and product page). On the lot page it changes the tax the price math uses: **Correct the sell price** folds in 9.3% instead of 37% + 9.3% when the category is non-cannabis (L1026, L1083), so the price **floor** drops. The override was **not** found in the register menu or in order pricing. Those read the live menu category, which is changed by **Move products** (§4.16) and by publishing.

**Store rule (owner decision D48, permanent), enforced since Phase 0.4 (G-31):** this box refuses **Accessories**, **Greenway Merch** or **Paraphernalia** (or a new category with one of those names) for a cannabis lot, and refuses a **Website type** whose mapping is non-cannabis (`lot-website-classification-core.ts` L93; `inventory/actions.ts` L544–557, L634). The page shows *"Refused: this lot came from a CCRS manifest, so it is cannabis and cannot be filed under ..."* and the attempt is audited as `cannabis_line.refused`. Use the box to move a product between cannabis categories, for example *Edibles* to *Edibles (Liquid)*, and note it on form 8.3.

**Daily check (G-31 requirement 4).** **Inventory → Issues** shows a **blocking** row, *"N cannabis lot(s) filed under a non-cannabis category"*, whenever any lot's website category is non-cannabis (data from before the guard, for example). The fix button opens the first lot's Website category box (`cannabis-line-core.ts` L110; `inventory/page.tsx` L423).

---

# Part 5: Sales-limit classification

### 4.18 Why classification decides the purchase limit

Washington caps what one customer may buy in a day (WAC 314-55-095). The register works out the limit from each product's category **and** two facts the category cannot tell it:

- **Taken otherwise into the body** (a suppository, for example): a **10-unit** limit, counted in **units**, so **units per package** must be recorded (WAC 314-55-095(1)(d)(i)(D)). An unanswered product is sold under the 100-unit limit instead of the 10-unit one.
- **Low-THC beverage:** a liquid in individual units of **no more than 4 mg** delta-9 THC each (`LOW_THC_UNIT_MAX_MG = 4`, `sales-limits-core.ts` L288) moves out of the 72 oz liquid limit into its own limit ((1)(d)(i)(E)–(F)). An unanswered liquid stays under the stricter 72 oz limit, which is safe but may under-sell.

The worklist explains each gap in plain words (`classification-status-core.ts` L230–239). For example: *"Nobody has said whether this is taken otherwise into the body (a suppository). Until somebody does, the register sells it under the 100-unit limit instead of the 10-unit one."*

This applies only to cannabis products. Non-cannabis categories carry no purchase limit (`sales-limits-core.ts` L370–374), which is why §4.16–§4.17 matter.

### 4.19 Working the classification worklist

1. Open **Sales-limit classification** (`/admin/compliance/classification`; `inventory.manage`, L75). The subtitle reads *"Products whose classification decides which purchase limit the register applies"* (L87).
2. **If you see "This list is incomplete — do not read it as an all-clear."** (L108), the app could not read everything. Reload. If it persists, tell the owner, and do not record the weekly check as clean.
3. Read the stat cards: **Urgent**, **Unconfirmed**, **Classified**, **In scope**. Filter with **Show** (Needs attention, Urgent, Unconfirmed, Classified, All in scope) and **Source** (All products, From Cultivera import, Received through intake).
4. For each row, read **What is missing**, then press **Classify →** (or **Review →** on a settled row) (L322). This opens the lot at its **Sales-limit classification** box (`[id]/page.tsx` L1299).
5. With the **package label in hand**, answer:
   - **Is this taken otherwise into the body?**: **No — ordinary product** or **Yes — taken otherwise into the body**.
   - **Units per package**: required when the answer is Yes. Count the units on the label (for example, a box of 6 suppositories is 6).
   - For liquids only: **Is this a low-THC beverage?** (**Not answered**, **No — ordinary liquid**, **Yes — low-THC beverage**) and **Active delta-9 THC per unit (mg)** from the label.
6. Press **Save sales-limit classification** (L1465). This is audited (`inventory_lot.compliance_classification_edited`). The answer is written to the published menu (which the register enforces from) and copied onto the lot row. If the copy onto the lot row fails, the page still says it was saved, and the failure is recorded only inside the audit row (`lot_row_write_failed`, `inventory/actions.ts` L1105–1145; finding F-05b-13, S3). After saving, reload the worklist and check that the row moved.
7. If the row now shows a contradiction (low-THC marked Yes, but above 4 mg per unit, or both buckets marked), one of the answers is wrong. Re-read the label and fix it.

**Rules.** Never answer **Yes — low-THC beverage** without a label that shows 4 mg or less per individual unit. If the label is unclear, answer **No — ordinary liquid**, which is the stricter limit, and tell the owner. **Weekly (form 8.4):** the **Urgent** count must be 0 by Monday close.

---

# Part 6: The cannabis sell price

### 4.20 Reading the sell price on a lot

The lot page shows **Sell price (after tax, out-the-door)** (`[id]/page.tsx` L486). This is what the customer pays at the register. The formula sits under it (L492). To the right is **Legal floor:**, either an amount or **— (cost unknown)** (L503), followed by *"Edit it in "Correct the sell price" below ↓"*.

If there is no price, the page says why (L508–512):

- *"This product has several sizes on its menu card. Pick this lot's size in "Which size is this lot?" below to see and set its price."*
- *"The menu price couldn't be read right now. Reload the page in a moment."*
- *"No published price yet. A price appears once this product's import is published to the menu."*

**The floor.** Washington forbids selling below acquisition cost (RCW 69.50.357 / WAC 314-55-155). The floor is the lot's **unit cost with tax folded in**: × 1.463 for cannabis (37% excise + 9.3% sales tax), or × 1.093 for a non-cannabis category (`price-correction-core.ts` L35–39, L61–67). **The unit cost comes only from the vendor's CCRS manifest** (owner, D38: *"Cost comes from the state CCRS manifest created by the vendor."*). Nobody types it.

### 4.21 Correcting the sell price (and the size link)

1. **Check the size first.** In **Which size is this lot?** (L1132), choose the size this lot sells as and press **Save size**. **Clear the size link** undoes it. The panel says who set it: *"You picked this size."*, *"The Cultivera import set this size."*, or *"Not linked yet."*.
2. In **Correct the sell price** (L1022), read the explanation. It folds in *"37% excise + 9.3% sales tax"* for cannabis, or *"9.3% sales tax"* for a non-cannabis category (L1026), and it changes *"this product only"*.
3. **Check the line above the box.** If the category shown makes the tax read **9.3% sales tax** on a cannabis lot, **stop**: the product has been filed across the cannabis line (§4.16–§4.17). Tell the owner before changing the price.
4. Type **New after-tax price ($)**. The help text shows the minimum: *"Minimum allowed for this lot is $X (cost + tax)."* (L1065–1066). The reverse math under the field divides by 1.463 or 1.093 (L1083).
5. Press **Save sell price**. This is audited (`inventory_lot.after_tax_price_edited`, `inventory/actions.ts` L708–830).

**What blocks a save:**

- an empty, invalid or $0.00 price (`price-correction-core.ts` L105–120);
- a price below the floor: *"Blocked: $X is below the legal minimum of $Y. Washington law (RCW 69.50.357 / WAC 314-55-155) forbids selling below acquisition cost. …"* (L128–133);
- a lot not linked to a product key;
- a multi-size card with no size picked;
- a product that isn't on the menu;
- a failed check of other lots that share this price: *"… so nothing was saved."*.

> **Cost unknown: blocked until the manifest cost is entered (finding F-05b-12; owner decisions D38, D49).** When the lot's cost is unknown, the help reads *"Cost is unknown for this lot, so no floor can be enforced."* (L1067), and the app will save **any** price above $0.00 (`afterTaxFloorMinor` returns nothing, `price-correction-core.ts` L65). **The owner's rule:** *"blocked until the manifest cost is entered."* **Nobody, the owner included, presses Save sell price on a lot whose floor shows — (cost unknown).** First get the cost onto the lot from the vendor's CCRS manifest (SOP-04 / SOP-05a §4.20); then the floor appears and the price can be set. Gap G-32 (**APPROVED**) makes the app refuse the save.

---

## 5. Messages: "If you see this message"

### 5.1 Other Inventory

| Message | What it means | What you do |
|---|---|---|
| **Staged draft PIPE-0001. Confirm it below to make it active.** | The draft was saved | Check the price, then **Confirm** (§4.3) |
| *"That would take On hand below zero (N on hand). Nothing was changed."* | The adjustment would make the count negative | Recount. Post only what is really there (§4.5) |
| *"For a count correction or other, choose Add or Remove."* | **Count correction** / **Other** needs a direction | Pick **+ Add** or **− Remove** (§4.5) |
| *"A price of $0.00 is refused. Type the shelf price."* / *"A cost of $0.00 is refused. Type what one unit cost."* | **Save change** with $0.00 | Type the real amount (§4.9) |
| *"Type a reason for the change (for example: vendor raised the price)."* | **Save change** with no reason | Write why (§4.9) |
| *"The … of … changed while you were typing (or the item is archived). Nothing was saved; reload and try again."* | Someone else changed it first | Reload and check before saving again (§4.9) |
| *"The invoice was not saved and nothing was changed: …"* | One invoice line failed, so nothing was saved | Fix the line and save again (§4.6) |
| *"Database update 0323 is not applied yet, so Other Inventory returns can't be saved. …"* | Update 0323 has not been run | Tell the owner; nothing was changed (§4.4) |
| *"A note is required for theft/other — say what happened."* | **Theft / loss** or **Other** needs a note | Write what happened (§4.5) |
| *"Only the owner or an admin can key a missing cost."* | A manager tried **Save cost** | Give the invoice to the owner (§4.7) |
| *"Filling only works when the cost is $0.00, so a keyed cost is never overwritten."* | The cost is already set | Use **Save change** (owner, admin or manager; §4.9, D46) |
| *"Invoice #… from … is already entered. Each paper invoice is entered once."* | A duplicate invoice | Check **Accounts Payable**. Do not enter it again (§4.6) |
| *"Invoice #… from … saved ($…). … It now appears on the Accounts Payable page as a payable."* | Saved | Confirm the drafts and file the paper (§4.6) |
| **Settings saved for <SKU>.** | Barcode, reorder point or shelf saved | None (§4.8) |

### 5.2 Merch

| Message | What it means | What you do |
|---|---|---|
| *"<name> is hidden from greenwaymerch.com (within about a minute)."* | Hidden | Note why on form 8.3 (§4.11) |
| *"<name> is live on greenwaymerch.com again (within about a minute)."* | Back on sale | None |
| *"Type the product's web name exactly to confirm removal."* | The name didn't match | Prefer **Hide**. Removal is owner/admin only (§4.11) |
| *"<name> was removed. Past orders in Printful are not affected."* | Removed for good | Record it on form 8.3 |
| *"Checked N variants at Printful; M changed on greenwaymerch.com."* | Stock copied | Read any **Note:** that follows (§4.11) |

### 5.3 Publish Menu

| Message | What it means | What you do |
|---|---|---|
| *"Published. The public menu now shows this version and its products are sellable at the register."* | Live | Check **Live variants** (§4.14) |
| *"Not published yet: N products would come off the live menu. …"* | The removal box was needed | Read the list. Tick only if every removal is intended (§4.14) |
| *"Publish your one-time Cultivera menu first. …"* | A Cultivera cutover is waiting | Stop. That is SOP-10 |
| *"Only the owner or an admin can publish with products still awaiting review. …"* | A manager tried **Publish now and fix after** | Decide them in Fact Review, or ask the owner |
| *"Tick "Publish now and fix after" to publish with products still awaiting review, or decide them first in Fact Review."* | The publish-now box was left unticked | Decide the reviews first (SOP-04) |
| *"Nothing waiting — every menu update from receiving has published automatically."* | Queue clear | Write 0 on form 8.4 |

### 5.4 Types & Categories

| Message | What it means | What you do |
|---|---|---|
| *"Done — N records moved to the new category. The customer menu updated immediately."* | The move is live | Form 8.3 (§4.16) |
| *"Refused: ... crosses the cannabis line. ..."* / *"Refused: this lot came from a CCRS manifest, so it is cannabis ..."* / *"Refused: the type ... is cannabis ..."* | A crossing of the cannabis line was refused (G-31) and audited | Nothing changed. Pick a category on the same side. Tell the owner if you think the product is filed wrongly |
| *"Pick both a source and a target category."* / *"The source and target categories are the same — nothing to move."* | Incomplete pick | Pick again |
| *"… is hidden — products can't be moved into a hidden category. Re-activate it first."* | The target is hidden | Owner decides whether to re-activate it |
| *"This is a built-in type, so it was hidden (deactivated) instead of deleted. …"* / *"Still used by N live item(s), so it was hidden …"* | It could not be deleted | Expected. History stays intact |
| **Heads up — N categories on your live menu aren't in this list** | Menu categories with no row | Add the row with the same value (§4.15) |

### 5.5 Classification and sell price

| Message | What it means | What you do |
|---|---|---|
| *"This list is incomplete — do not read it as an all-clear."* | Not everything could be read | Reload. Tell the owner if it stays (§4.19) |
| *"Nobody has said whether this is taken otherwise into the body (a suppository). …"* | The answer is missing | **Classify →** with the label (§4.19) |
| *"… marked as a low-THC beverage, but the stated per-unit THC is above 4 mg …"* | Contradiction | Re-read the label. Fix the wrong answer |
| *"Blocked: $X is below the legal minimum of $Y. Washington law (RCW 69.50.357 / WAC 314-55-155) forbids selling below acquisition cost. …"* | Below cost plus tax | Enter $Y or more (§4.21) |
| *"Cost is unknown for this lot, so no floor can be enforced."* | No floor is checked | Owner only (§4.21) |
| *"This product has several sizes on one menu card and this lot isn't linked to one yet. …"* | No size picked | **Which size is this lot?** first |
| *"This product isn't on the published menu, so there is no menu price to set yet. …"* | Not on the menu | Publish or approve it first (§4.13) |
| *"Couldn't check the other lots that share this price (…), so nothing was saved."* | The read failed | Try again in a minute |

## 6. Exceptions & escalation

| Situation | Do this | Tell |
|---|---|---|
| Cannabis found under **Accessories**, **Greenway Merch** or **Paraphernalia** (Inventory → Issues blocking row, the website, the register or the lot price box) | Stop selling it at once. Do not move it back yourself | **Owner, same day.** Excise owed on the sales since has to be worked out (F-05b-9) |
| Weekly reconciliation is off by more than 2 units on one item, or more than $50 retail | Post the difference with its true reason (§4.5) | Owner, same day |
| A non-cannabis item has the wrong price or cost, or $0.00 | Keep selling at the label price on the keypad, with a correct label. Owner, admin or manager corrects it (§4.9) | Form 8.2; owner reviews weekly |
| An invoice save failed part-way | Clean up the partial drafts and adjustments (§4.6), then enter it again | Owner if you are unsure what was left |
| A Save invoice succeeds, but the audit log has no `noncannabis.invoice_entered` row | Nothing to fix on the page. The audit write is not checked (`noncannabis/actions.ts` L307, `.catch(() => {})`; finding F-05b-8) | Note it on form 8.1 |
| **Live variants** fell by more than the listed removals after a publish | Do not publish again | Owner, at once (F-05b-10) |
| **Publish didn't finish** twice | Stop | Owner |
| Classification: the package label is unclear | Answer the stricter way (No — ordinary liquid). Keep the item on sale | Owner |
| A lot shows **— (cost unknown)** and needs a price | Do not set a price. Get the manifest cost onto the lot first (SOP-05a §4.20) | Owner (§4.21, D49) |
| A merch product must come off greenwaymerch.com for good | **Hide** it. A manager never presses **Remove** (D47) | Owner or admin removes it (§4.11) |

## 7. Controls & compliance (why the rules exist)

| Rule | Why | Where in the code |
|---|---|---|
| Cannabis carries 37% excise plus 9.3% sales tax; non-cannabis carries 9.3% only. Every published price is out-the-door | WA cannabis excise (RCW 69.50.535) and retail sales tax. The **category** alone picks the tax | `order-pricing-core.ts` L42–50 |
| Never move or re-file a product across the cannabis line, in either direction (D48) | It removes excise, the purchase limit and the scan requirement, and it lowers the floor (F-05b-9, FIXED by G-31) | Enforced: `cannabis-line-core.ts`; `category-registry-core.ts` L174; `lot-website-classification-core.ts` L93; `settings/types/actions.ts` L53 |
| Purchase limits follow the classification | WAC 314-55-095(1)(d)(i): the 10-unit "otherwise taken" limit and the low-THC (≤ 4 mg per unit) beverage limit | `sales-limits-core.ts` L288; `classification-status-core.ts` L230–239 |
| No sale below cost plus tax | RCW 69.50.357 / WAC 314-55-155 | `price-correction-core.ts` L61–67, L125–133 |
| Cannabis cost comes only from the vendor's CCRS manifest. Nobody types it | Owner D38 (*"absolutely not. That's illegal."*) | SOP-05a §4.20; G-27 |
| No price is saved on a cost-unknown lot until the manifest cost is entered | Owner D49. The app enforces no floor there (F-05b-12) | `price-correction-core.ts` L65 |
| Non-cannabis goods are rung on the keypad with the SKU in the note, and reconciled weekly | Other Inventory is not on the register (F-05b-1, **S1**) | §4.4–§4.5; G-29 |
| Removing anything from the live menu needs a named list and a tick | One old draft once wiped an 18-item menu (code comment, `menu-imports/actions.ts` L214–218) | `publish-guard-core.ts` L102–108 |
| Non-cannabis is not reported to CCRS | CCRS covers cannabis only | `admin-nav-data.ts` L84–86 |

## 8. Checklists & forms

### 8.1 Non-cannabis keypad sales and weekly reconciliation

```
FORM 8.1   NON-CANNABIS: KEYPAD SALES + WEEKLY RECONCILIATION    Week of: __________
PART A - keypad lines (from register receipts / Keypad lines with SKU in note)
 SKU          | Name                    | Units sold | Price  | Rung by
 _____________|_________________________|____________|________|________
PART B - Monday count (before opening)
 SKU          | Last On hand | - Part A | = Expected | Shelf | Diff | Reason posted
 _____________|______________|__________|____________|_______|______|______________
PART A covers KEYPAD lines only (scanned catalog sales lower On hand by themselves)
CATALOG LINE - confirms / archives / restores this week (also in the Security Log)
 SKU          | Confirmed or Archived | On hand at archive | By | Date
 Merch: "Copy Printful stock to the website" pressed  [ ]  changed: ____
 Any diff > 2 units or > $50 retail reported to owner [ ]   Initials: ______
```

### 8.2 Non-cannabis price or cost change (owner, admin or manager); cost-unknown cannabis price

```
FORM 8.2   PRICE / COST CHANGE                                   Date: __________
 Item / SKU or lot: ____________________   Old price: ______   New price: ______
 Old cost: ______   New cost: ______   Source (invoice # / CCRS manifest): ________
 Reason: _____________________________________________________________________
 Non-cannabis: changed with "Save change" (reason typed in the app) [ ]
               new price on the shelf label (reprint) [ ]   SKU unchanged
 Cannabis, cost unknown: NO PRICE SAVED until the manifest cost is on the lot (D49)
   manifest cost entered on: ______  floor now shows: ______  price >= floor [ ]
 Changed by (owner / admin / manager): ______________  Owner review: ______
```

### 8.3 Category and menu change log

```
FORM 8.3   CATEGORY / MENU CHANGE LOG
 Date | Who | Page (Types / Lot box / Merch / Publish) | From -> To | Records | Why
 _____|_____|__________________________________________|____________|_________|_____
 Cannabis line crossed?  The app refuses it (G-31). If Issues shows one, stop and call the owner. [ ]
```

### 8.4 Weekly menu and classification check (Monday)

```
FORM 8.4   WEEKLY MENU + CLASSIFICATION CHECK                    Week of: __________
 [ ] Publish Menu: "Waiting for you" = ____ (Fact check / Needs a Publish click cleared)
 [ ] Kept off the menu until facts are set = ____ (sent to SOP-04)
 [ ] Classification: Urgent = 0   Unconfirmed = ____   list complete (no banner)
 [ ] Types & Categories: no "Heads up" orphan banner
 [ ] Spot check 5 non-cannabis items on the public menu / register: none are cannabis
 [ ] Lots showing "Legal floor: - (cost unknown)" = ____ (to owner)
 Initials: ______
```

## 9. Quick reference card

```
╔═════════════════════════════════════════════════════════════════════════════════╗
║ SOP-05b QUICK CARD - NON-CANNABIS, MERCH, PUBLISH, CATEGORIES, LIMITS, PRICE    ║
╠═════════════════════════════════════════════════════════════════════════════════╣
║ OTHER INVENTORY IS ON THE REGISTER (Phase 4; run DB update 0323 first)          ║
║  - SCAN the SKU label or the UPC. Sale lowers On hand; void puts it back.      ║
║  - Return: Restock = back on shelf; Destroy = written off. Not sent to CCRS.    ║
║  - Keypad only for items NOT in the catalog (no count, no cost). Add them.      ║
║  - Monday: count, post keypad sales, post shrink separately (form 8.1).         ║
║ ADDING: Stage draft -> CHECK PRICE -> Confirm -> Print SKU.                     ║
║ PRICE/COST CHANGE: owner/admin/manager, "Save change" + reason. SKU stays.     ║
║ ARCHIVE -> Archived items -> Restore (back as a draft). All audited.            ║
║ MERCH: Hide (undoable) > Remove (owner/admin only, enforced). Printful weekly.  ║
║ PUBLISH: tick the removal box ONLY if every listed product should come off.     ║
║  - Never publish an old/small menu to "86" one product. 86 = SOP-05a 4.12.      ║
║ CATEGORIES: NEVER move cannabis into Accessories / Greenway Merch /             ║
║  Paraphernalia, NOR non-cannabis into cannabis. Refused outright (D48).         ║
║ CLASSIFY: label in hand. Suppository = units per package. Low-THC <= 4 mg/unit  ║
║  Unsure -> the stricter answer. Urgent = 0 by Monday close.                     ║
║ SELL PRICE: out-the-door. Floor = cost x 1.463 (cannabis). Below = Blocked.     ║
║  "Cost unknown" -> NO price save until manifest cost is entered (D49).          ║
╚═════════════════════════════════════════════════════════════════════════════════╝
```

## 10. Glossary

| Term | Meaning |
|---|---|
| **Other Inventory** | The non-cannabis catalog sold in the store (`/admin/inventory/noncannabis`) |
| **Merch Inventory** | Apparel sold by Greenway Merchandising LLC on greenwaymerch.com, made by Printful |
| **Keypad** | The register tab for an open-price non-cannabis line (merch or accessories) |
| **SKU** | The store's own code, PREFIX-0001 style, printed on the SKU label |
| **UPC / EAN** | The manufacturer's barcode on the package |
| **Draft** | A staged non-cannabis item that is not in the catalog until **Confirm** |
| **Publish** | Making a menu version live on the website and the register |
| **86** | Restaurant slang for "take it off the menu, we're out." At Greenway, it is the register's **Mark out of stock** (SOP-05a §4.12) |
| **Website category** | The group shoppers browse. It also decides tax and limits |
| **Inventory type** | A raw POS label that maps to a website category |
| **Override** | A per-product category or type set on the lot page |
| **Otherwise taken into the body** | For example, suppositories: a 10-unit daily limit |
| **Low-THC beverage** | A liquid in individual units of ≤ 4 mg delta-9 THC each |
| **Out-the-door price** | The price including all tax |
| **Legal floor** | Unit cost with tax folded in. Nothing sells below it |
| **CCRS manifest** | The state traceability transfer record created by the vendor. It is the only source of cannabis cost |

---

## Appendix A: Source map

| Area | Files |
|---|---|
| Other Inventory | `src/app/admin/inventory/noncannabis/page.tsx`, `actions.ts`, `MerchCatalog.tsx`, `NonCannabisIntakeForm.tsx`, `InvoiceBuilderForm.tsx`, `[id]/label/page.tsx`; `src/lib/noncannabis/store.ts`, `invoice-store.ts`, `noncannabis-core.ts`, `cost-fill-core.ts`, `merch-intel-core.ts` |
| Other Inventory on the register (Phase 4) | `src/lib/noncannabis/pos-catalog-core.ts` (keys, cards, barcode merge, COGS by line, average cost, direction by reason, price/cost rules, sales summary, in-store cards); `register-stock.ts` (one-step stock moves, catalog read, sales report); `returns.ts`; `src/app/api/pos/menu/route.ts` L449–464; `src/lib/inventory/sale-decrement.ts` L126; `src/lib/pos/void-store.ts` L233; `src/lib/pos/returns-store.ts` L285–300; `src/lib/accounting/sale-posting-service.ts` L364–372; `refund-posting-service.ts` L117–147; `src/lib/pos/sync-store.ts` L1439–1452; `src/lib/compliance/ccrs-sales.ts` L329–337; `ccrs-batch.ts` L474–475; `src/components/menu/InStoreGoods.tsx`; `supabase/migrations/0323_noncannabis_register.sql` |
| Keypad | `custom-sale-core.ts` L48–55; `SaleFlow.tsx` L2541–2589 |
| Merch | `src/app/admin/inventory/merch/page.tsx`, `actions.ts`, `export/route.ts` |
| Publish | `src/app/admin/publish/page.tsx`; `src/lib/pos/publish-guard-core.ts`, `publish-queue-core.ts`, `publish-now-core.ts`; `src/app/admin/menu-imports/actions.ts` L178–270; `menu-imports/version/[versionId]/page.tsx` L429–437; `src/lib/inventory/cutover-guard-core.ts` L64 |
| Types & Categories | `src/app/admin/settings/types/page.tsx`, `actions.ts`; `category-registry-core.ts` L149–198; `category-registry.ts` L125–160 |
| Lot re-file | `src/app/admin/inventory/[id]/page.tsx` L1176–1270; `inventory/actions.ts` L506; `lot-website-classification-core.ts` L61 |
| Classification | `src/app/admin/compliance/classification/page.tsx`; `classification-status-core.ts` L230–239; `[id]/page.tsx` L1299–1465; `inventory/actions.ts` L1036–1157; `sales-limits-core.ts` L288, L370–374 |
| Sell price | `[id]/page.tsx` L486–512, L1022–1163; `inventory/actions.ts` L708–830; `src/lib/inventory/price-correction-core.ts` |
| Tax and scan | `src/lib/orders/order-pricing-core.ts` L42–50; `scan-required-core.ts` L55–61 |

## Appendix B: Not built yet (interim procedures)

> **Living SOP reminder (D41).** The owner: *"We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary."* When a gap below is built, update this SOP in the same piece of work: the named sections, this table, Appendix D, the findings ledger (FIXED) and the concierge entry (D42: *"I want to upgrade the concierge to use all features including future ones we will build after the sop is finished."*).

| Gap | What is missing | Findings | Interim procedure | Sections to update when built | Status |
|---|---|---|---|---|---|
| **G-29** | Other Inventory on the register: the SKU and UPC scan to a priced non-cannabis line, the sale lowers **On hand**, a void or return restores it, and all of it is audited | F-05b-1 (**S1**) | None: scan it (§4.4). Keypad + Monday count only for items not in the catalog | §4.1–§4.5, §4.8, §9, form 8.1; reports and the books (F-05b-15) | **BUILT** (Phase 4, plan row 5.1): register cards, scan, one-step sale decrement, void restore, returns, cost of goods, sales report, display-only website list, Sale.csv exclusion |
| **G-30** | Edit a non-cannabis price and cost, audited old → new, by **owner, admin or manager**; refuse a $0.00 price | F-05b-6 | None: **Save change** (§4.9) | §2, §4.3, §4.6, §4.7, §4.9, form 8.2 | **BUILT** (Phase 4, plan row 5.2) |
| **G-30A** | Merch **Remove** limited to owner and admin (new permission), audited as today | F-05b-14 | None: enforced (§4.11) | §2, §4.11, §6, §9 | **BUILT** (Phase 4, plan row 5.2) |
| **G-31** | Cannabis-line guard: **refuse outright, with no override, in both directions**, any lot override, **Move products** or inventory-type mapping that crosses into or out of a non-cannabis category | F-05b-9 (**S1**) | Never cross the line; owner only; form 8.3 (§4.15–§4.17) | §2, §4.15–§4.17, §4.21, §6, §9 | **BUILT** (Phase 0.4) |
| **G-32** | Hardening bundle: audit Confirm and Archive, plus a Restore; an atomic adjustment; Direction locked to Reason; actor and Pacific time in Recent adjustments; a full invoice rollback; a checked invoice audit; publish refuses when the removal diff can't be read; **no price save at all while the cost is unknown (D49)**; before/after on category audits; a visible warning when the classification lot-row write fails | F-05b-2, 3, 4, 5, 7, 8, 10, 11, 12, 13 | The store rules in §4.14, §4.15, §4.21 for items 7–10 | Those sections, §5, §6 | **Items 1–6 BUILT** (Phase 4, plan row 5.2: audited Confirm/Archive + Restore, one-step adjustment, direction by reason, actor + Pacific time, one-step invoice, checked invoice audit); items 7–10 **APPROVED** (D45, D49) |

## Appendix C: Open questions for the owner

| # | Question | Why it matters |
|---|---|---|
| **Q-05b-1** | ~~Approve G-29, connecting Other Inventory to the register?~~ | **ANSWERED** (D45): *"Q-05b-1- yes, and any other upgrade, enhancement and such needed to fully utilize non cannabis goods in the system and on the register and on the menu."* G-29 APPROVED and widened |
| **Q-05b-2** | ~~Who may change a non-cannabis price or cost?~~ | **ANSWERED** (D46): *"Q-05b-2- owner, admin, manager."* |
| **Q-05b-3** | ~~Who may permanently **Remove** a merch product?~~ | **ANSWERED** (D47): *"Q05b-3- owner and admin."* Gap G-30A |
| **Q-05b-4** | ~~Refuse a cannabis-line crossing outright, or allow it for the owner with a reason?~~ | **ANSWERED** (D48): *"Q05b-4- refused outright, non cannabis should also be refused outright moving them into a cannabis type. non cannabis should be allowed to have their cost modified."* |
| **Q-05b-5** | ~~Approve the G-32 hardening bundle, including blocking a cost-unknown price save?~~ | **ANSWERED** (D49): *"Q-05b-5- yes, plan on the group of smaller fixes. blocked until the manifest cost is entered."* |
| **Q-05b-6** | Does D46 (*"owner, admin, manager"*) also let a **manager** use **Save cost** to fill a missing ($0.00) non-cannabis cost? The earlier decision D-R3-1 (*"owner and admin can add cost if missing"*, `roles.ts` L144–149) says owner and admin. | Until answered: **Save cost** stays owner and admin; managers use the form 8.2 re-create |

## Appendix D: Revision history

| Version | Date | Change | By |
|---|---|---|---|
| 1.0 | 2026-10-27 | First draft, verified against `main@827facb5`. Findings F-05b-1…13 and F-05b-C; gaps G-29…G-32; questions Q-05b-1…5. Owner decisions D35, D38, D40, D41, D42 and D43 applied | SOP program |
| 1.2 | Fix phase | Phase 0.4 (owner D76). G-31 BUILT: one pure check (`src/lib/compliance/cannabis-line-core.ts`) refuses, in both directions and with no override, any crossing of the cannabis line from the lot-page Website category box, **Move products** and the inventory-type mapping (add, adopt, save). Every refusal is audited (`cannabis_line.refused`). Inventory → Issues lists any cannabis lot filed under a non-cannabis category as blocking. §2, §4.15–§4.17, §5, §6, §7, form 8.3 and Appendix B updated. F-05b-9 FIXED. | Fix program |
| 1.3 | Fix phase | Phase 4 (plan rows 5.1/5.2; G-29/G-30/G-30A/G-32), migration 0323. **G-29 BUILT:** active priced Other Inventory items are register products (`nc-<id>`), their SKU and UPC scan (cannabis codes win a collision), a completed sale lowers On hand in one database step with a cost snapshot, a void puts it back once, a counter return restocks or writes off in one step and is never a CCRS correction, Sale.csv leaves these lines out, the sale books average cost as COGS, the refund cost-back uses the sale's cost, the price-drift check compares against the catalog, the page shows **Register sales — last 30 days**, and the shop shows a display-only **Also in store** list. **G-30 BUILT:** **Save change** for price/cost (owner, admin, manager; reason; $0 refused; SKU unchanged; old → new audited). **G-30A BUILT:** `merch.remove` (owner, admin). **G-32 items 1–6 BUILT:** audited Confirm/Archive + **Restore**, one-step adjustment with a zero floor, direction set by reason, **By** + Pacific time in Recent adjustments, one-step invoice with moving-average cost, checked invoice audit. Findings F-05b-1, 2, 3, 4, 5, 6, 7, 8, 14, 15 FIXED. The one-thing box, §2, §4.1, §4.4, §4.5, §4.6, §4.7, §4.9, §4.11, §5.1, forms 8.1–8.2, §9 and Appendices A–B updated. | Fix program |
| 1.1 | 2026-10-28 | Owner answers to Q-05b-1–5 applied (decisions D45–D49). G-29 APPROVED and widened to every place non-cannabis goods should be used (register, menu, cost of goods, returns, reports); new finding F-05b-15 (keypad sales post no cost of goods). G-30 APPROVED: owner, admin or manager change price and cost; non-cannabis cost is changeable. New G-30A and finding F-05b-14: merch Remove is owner and admin only. G-31 APPROVED: crossings refused outright in both directions. G-32 APPROVED: no price save on a cost-unknown lot until the manifest cost is entered. §2, §4.1, §4.9, §4.11, §4.16, §4.17, §4.21, §6, §7, form 8.2, §9, Appendices B–C updated; new question Q-05b-6 (does D46 widen **Save cost** to managers; earlier decision D-R3-1 says owner and admin). Re-verified at `main@e1fe84eb`. | SOP program |
