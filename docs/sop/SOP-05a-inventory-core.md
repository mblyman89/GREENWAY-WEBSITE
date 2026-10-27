# SOP-05a — Inventory Core: Lots, Holds, Recalls, Expiry, Labels and Labs (daily)

| | |
|---|---|
| **Version** | 1.0 (draft for owner review) |
| **Effective** | On owner approval |
| **Owner** | Michael Lyman |
| **Applies to** | Every manager-level login (owner, admin, manager) who looks after cannabis lots once they are received: the daily Issues check, quantity corrections, holds and recalls, expiry dates, tags, testing labs and lot labels. Budtenders read §4.10–§4.11 (what a recall hold and the register's "86" do) and §9. |
| **Verified against** | `main@ac251766` (2026-10-27; the code is unchanged since `5299660b`, the SOP-04 audit point). Every label, button, message, number and rule below was read from the code or quoted from the owner. Nothing was written from memory. Where the code and a help panel disagree, this SOP follows the code and records a finding. |
| **Program records** | Findings `F-05a-*` in `docs/sop-program/03-FINDINGS-LEDGER.md` · Gaps `G-19`, `G-22`…`G-26` in `docs/sop-program/05-GAP-REGISTER.md` · Owner decision D35 (the 05a / 05b split) in `docs/sop-program/00-OWNER-REQUEST-VERBATIM.md` · Split scope in `docs/sop-program/02-SOP-CATALOG-AND-ROADMAP.md` |

> **How to use this document.** §4.1–§4.4 are the screens and the **daily Issues check** (10 minutes, every morning). §4.5–§4.9 are the lot page: correcting a quantity and changing a lot's status, which are the two most dangerous buttons in Inventory. §4.10–§4.13 are **recalls**, the register's **86**, **restore to sale**, and the written recall plan the law requires. §4.14–§4.16 are **expiry dates**. §4.17–§4.21 are tags, testing labs, lot labels, bulk fill and lot corrections. Section 5 lists every message the screens can show. Section 8 holds the paper forms. Section 9 is a one-page card. Words in **bold** are the exact labels you will see on the screen.

> **The one thing to know before anything else.** On the lot page, the **Lifecycle status** box and the **Adjust quantity** box write straight to the lot. **Lifecycle status** checks nothing and writes **no audit row** (`inventory/actions.ts` L142–155 → `store.ts` L836–851). **Never set a lot to "Destroyed" there**: the units stay on file, no destruction is recorded, and the lot silently drops out of the weekly CCRS inventory file (§4.9, finding F-05a-1, **S1**). Destruction always goes through **Inventory → Returns & Destruction** (SOP-15). A recall is placed and released only by a manager, with a written reason on form 8.1, every time (§4.10).

---

## Table of contents

1. Purpose & scope
2. Roles & permissions
3. Before you start
4. Procedures

   **Part 1: The screens and the daily check**
   - 4.1 Where inventory lives
   - 4.2 The Inventory list: tabs, cards, filters and columns
   - 4.3 Lot statuses: what each one means
   - 4.4 Every morning: the Issues tab

   **Part 2: The lot page**
   - 4.5 A tour of the lot page
   - 4.6 Adjust quantity: the procedure
   - 4.7 Which reason to choose (and what CCRS receives)
   - 4.8 Lifecycle status: the procedure
   - 4.9 Never "Destroyed" by hand

   **Part 3: Recalls, the 86 and restore to sale**
   - 4.10 Placing and releasing a recall hold
   - 4.11 What a recall hold does at the register
   - 4.12 The register's "86" and Restore to sale
   - 4.13 The written recall plan (WAC 314-55-225)

   **Part 4: Expiry dates**
   - 4.14 Where a lot's expiry date comes from
   - 4.15 Expiration rules: Save, Preview, Apply
   - 4.16 Expired and expiring-soon stock

   **Part 5: Tags, labs, labels and corrections**
   - 4.17 Tags (New, Staff Pick and your own)
   - 4.18 Testing labs and certificate hosts
   - 4.19 Printing or reprinting a lot label
   - 4.20 Bulk fill (Cultivera-import lots only)
   - 4.21 Correcting a lot: received date, details, product link, lab result, re-reading the COA
   - 4.22 Low stock and oversold sales (pointers)
5. Messages: "If you see this message"
6. Exceptions & escalation
7. Controls & compliance (why the rules exist)
8. Checklists & forms
9. Quick reference card
10. Glossary
- Appendix A: Source map
- Appendix B: Not built yet (interim procedures)
- Appendix C: Open questions for the owner
- Appendix D: Revision history

---

## 1. Purpose & scope

**Purpose.** Once a delivery is finalized (SOP-04), every package becomes a **lot**: one row that ties the product to its vendor, its manifest, its lab result and its CCRS identifier. Inventory management is keeping those lots true, every day. That means the right quantity, the right status, the right dates, and nothing on the floor that may not be sold. The owner asked for this SOP in the original request:

> *"Sop for inventory management."* (`00-OWNER-REQUEST-VERBATIM.md` L7)

and set how it is to be built when this slice began:

> *"please proceed with the next SOP, inventory management. I want you to break this one up into two slices. commit work often out of the sandbox, it is unstable. protect the work. follow the standing rules and never guess. go above and beyond."* (D35, `00-OWNER-REQUEST-VERBATIM.md` L98, L114)

**The two slices (D35).** Inventory management is split in two (catalog `02-SOP-CATALOG-AND-ROADMAP.md`, "Split (D35)"):

- **SOP-05a (this document): the cannabis lot core.** The Inventory list and Issues tab, the lot page, quantity adjustments, lot status, recall holds, the register's 86 and restore to sale, expiry dates and expiration rules, tags, testing labs, lot labels, bulk fill and lot corrections.
- **SOP-05b (next slice):** Other Inventory (non-cannabis) and its labels, Merch Inventory, Publish Menu, Settings → Types & Categories, and Sales-Limit Classification. It also covers the sell-price correction on the lot page (§4.21 points there).

**Why it matters.** The Inventory page describes itself as *"the traceability backbone"*: *"Compliance reports are built on top of this real data, never re-entered."* (`inventory/page.tsx` L430). The weekly CCRS files (SOP-16) are built from these lot rows. A wrong quantity or a wrong status here becomes a wrong state filing there.

**In scope.**
- The Inventory list, its status tabs, cards, filters and columns, and the Issues and Insights tabs.
- The lot page: adjustments, lifecycle status, the adjustment history, the received date, lot details, the product link, the lab result and the COA re-read.
- Recall holds, the register's **86** (out-of-stock flag) and **Restore to sale**.
- The written recall plan required by WAC 314-55-225(3)(d).
- Expiry dates, the **Expiration rules** page and the expiration report.
- **Tags**, **Testing labs**, lot labels and **Bulk fill**.

**Out of scope.** Covered elsewhere and only pointed to here:
- Receiving and Finalize (**SOP-04**).
- Cycle counts, inventory audits and the oversold report (**SOP-06**).
- Purchasing and the 4-month inventory ceiling action (**SOP-09**).
- Product Enrichment (**SOP-10**).
- Returns to vendor and **destruction**, including recall destruction (**SOP-15**).
- The weekly CCRS upload (**SOP-16**).
- Other Inventory, Merch, Publish Menu, Types & Categories, Sales-Limit Classification and the sell price (**SOP-05b**).

---

## 2. Roles & permissions

| Task | Who | How the system checks |
|---|---|---|
| Open **Inventory**, the lot page, **Expiration rules**, **Tags**, **Testing labs**, a lot label | Owner, admin, manager | Page gates `requirePermission("inventory.manage")`: list `inventory/page.tsx` L205; lot page; `expiration-rules/page.tsx` L222; `tags/page.tsx` L85; `labs/page.tsx` L156; `lots/[id]/label/page.tsx` L33. `inventory.manage` = owner, admin, manager (`src/lib/auth/roles.ts` L106). |
| **Record adjustment**, **Update status**, received date, lot details, product link, lab result, website classification, size, bulk fill, compliance classification, **Restore to sale**, **Re-read lab certificate** | Owner, admin, manager | Every action in `src/app/admin/inventory/actions.ts` calls `requirePermission("inventory.manage")` (L112, L143, L175, L228, L273, L316, L451, L507, L709, L840, L904, L1040, L1175, L1210). |
| Save, preview and apply **Expiration rules** | Owner, admin, manager | `expiration-rules/actions.ts` L62, L131, L141 (`inventory.manage`) |
| Read the **Expiration report** | Owner, admin, manager, readonly | `reports/expiration/page.tsx` L151 (`reports.view`; `roles.ts` L149) |
| Press **"Shelf is empty? Mark out of stock…"** (the 86) at the register | Any signed-in register | Device-authenticated route `api/pos/stock-flag/route.ts` L28–34; button `SaleFlow.tsx` L4263–4274 |
| Count the shelf (cycle counts) | Owner, admin, manager, **staff** | `inventory.count` (`roles.ts` L126). SOP-06. |
| Approve and post an inventory audit | **Owner only** | `inventory.audit` (`roles.ts` L142). SOP-06. |
| Key a missing **non-cannabis** unit cost | Owner, admin | `inventory.cost.fill` (`roles.ts` L148). SOP-05b. |
| **Place or release a recall hold** (status **Recalled**) | **Manager-level login, with a reason written on form 8.1** (this SOP's control) | The app checks only `inventory.manage`; it writes no audit row and asks for no reason (F-05a-2). The paper log is the record until gap G-22 is built. |
| **Destroy** a lot | Owner, admin, manager through **Returns & Destruction** only | `disposition/page.tsx` L97 (`inventory.manage`). SOP-15. |

**Recall coordinator.** WAC 314-55-225(3)(d) requires a named recall coordinator (§4.13). Until the owner names one (question **Q-05a-2**), this SOP treats **the owner** as the recall coordinator, with the on-duty manager acting in the owner's absence.

---

## 3. Before you start

1. **Know where Inventory lives.** In the top bar, the **Inventory** group holds **Inventory** (`/admin/inventory`), **Other Inventory**, **Merch Inventory**, **Cycle Counts** and **Returns & Destruction** (`admin-nav-data.ts` L84–90). This SOP uses the first one.
2. **Log in with a manager-level account.** A staff login cannot open Inventory (§2).
3. **Have the paper forms to hand** (§8):
   - form 8.1, the lot status and recall log;
   - form 8.2, the manual adjustment log;
   - form 8.3, the daily Issues check;
   - form 8.4, the recall plan (one copy, signed, in the compliance binder);
   - form 8.5, the recall event worksheet (blank copies).
4. **Know the four rules that never bend:**
   - **Never set a lot to Destroyed by hand.** Use Returns & Destruction (§4.9, SOP-15).
   - **Never destroy recalled product before the LCB is notified and the destruction is coordinated** with the local LCB officer (WAC 314-55-225(3)(b)(i)(B); §4.10).
   - **Every manual adjustment gets a reason and a note** (§4.6). The note is what the state reads.
   - **Every status change gets a line on form 8.1** (§4.8). The app keeps no record of it.
5. **Know what the app protects for you and what it does not.**

   | The app blocks this on its own | The app does **not** block this; a person must |
   |---|---|
   | Selling any product that has a **Recalled** lot. There is no override (`completion-gate.ts` L95–119) | Selling an **expired** lot (§4.16, F-05a-8) |
   | Restoring an 86'd product that is under a recall hold, hidden, or has no live stock (`restore-to-sale-core.ts` L115–158) | Setting **Active**, **Recalled** or **Destroyed** without a check or an audit row (§4.8, F-04-2, F-05a-1, F-05a-2) |
   | Applying expiration rules after something changed since the preview (`expiration-rules/actions.ts` L146–157) | Taking a lot's quantity **below zero** with a manual adjustment (§4.6, F-05a-3) |
   | Overwriting an expiry date that came from a manifest, COA or the POS (`expiry-rules-core.ts` L10–34) | Sending a manual "Other" or "Employee sample" adjustment with no note. CCRS will withhold it (§4.7, F-05a-4) |
   | Deleting a tag without the **Yes, delete** tick (`tags/actions.ts` L108–111) | Recording a destruction outside the SOP-15 flow (§4.7, F-05a-5) |

---

## 4. Procedures

# Part 1: The screens and the daily check

### 4.1 Where inventory lives

| Screen | How to get there | What it is for |
|---|---|---|
| **Inventory** | Top bar **Inventory → Inventory** (`/admin/inventory`) | Every cannabis lot. Three tabs: **Lots**, **Issues**, **Insights** (`page-tab-sets.ts` L77–85) |
| **Lot page** | Click a lot on the list | One lot: quantities, dates, COA, corrections, adjustments, status |
| **Expiration rules** | **Expiration rules** button at the top of Inventory (`inventory/page.tsx` L436) | Best-by dates for lots with no manufacturer date (§4.15) |
| **Tags** | **Tags** button (L440) | Labels shown on menu cards (§4.17) |
| **Testing labs** | **Testing labs** button (L444) | WA labs and the hosts COAs may be read from (§4.18) |
| **Print lot label** | **🏷 Print 4×6 label** on a manifest line (`intake/[id]/page.tsx` L1072–1078), or the address `/admin/inventory/lots/<id>/label` | Reprint a 4×6 lot label (§4.19) |
| **Expiration report** | **Expiration report** button on Expiration rules (`expiration-rules/page.tsx` L284) | Aging buckets, value at risk, 12-month forecast |
| **Returns & Destruction** | Top bar **Inventory → Returns & Destruction** | Destruction and returns (**SOP-15**). The only correct way to destroy a lot (§4.9) |

The green **+ Import vendor JSON** button at the top of Inventory opens **Receiving** (L447–449). That is SOP-04 work.

### 4.2 The Inventory list: tabs, cards, filters and columns

**Page title and help.** **Inventory**, with the subtitle *"Every lot tied to its vendor, brand, COA, and manifest — the traceability backbone…"* (L429–430). The help panel **How inventory lots work** (L451–469) lists four steps. Step 4, *"Vendor JSON intake (next slice) drafts lots + COAs for you to review and accept."* (L459), is out of date: intake has been built for a long time (SOP-04). Its **SOP** link opens the old "publish" sheet (L467). See finding F-05a-12.

**The four cards** (L487–537):

| Card | What it counts |
|---|---|
| **Total lots** | Every lot in the store |
| **Active lots** | Lots with status Active |
| **On-hand cost** | On hand × unit cost. It turns **orange** when some lots have no cost, because those count as $0 and the total is understated (L496–503) |
| **Needs attention** | Recalled + quarantine + expired + expiring soon + no COA + no expiry date. *"Recalls, expiry, quarantine, missing COA"*. The card turns orange for every one of these **except** expiring soon (L522–530; cosmetic, F-05a-14) |

**The three tabs** (`page-tab-sets.ts` L77–85):
- **Lots**: *"Every lot, with filters, sorting and bulk edits."*
- **Issues**: *"Stock the register cannot sell, missing data and crossed compliance limits — each with its fix."* The tab shows a count badge.
- **Insights**: *"Months of supply, shrink, ABC and aging (WAC 314-55-079(10))."* It includes the **Sell first (FEFO)** shortlist (`InventoryIntelPanel.tsx` L199–201).

**The status chips** on the Lots tab: **All**, **Active**, **Quarantine**, **Recalled**, **Sold out**, **Destroyed**, **Leafly** (L92–102). A bare `/admin/inventory` opens on **Active**. To see everything, press **All**. **Leafly** is not a status; it lists lots carrying the LEAFLY badge.

**Filters.** The filter panel under the chips (L661–667) holds multi-select facets, yes/no flags, number ranges and date ranges, with removable chips for whatever is switched on. Every filter lives in the address bar, so a filtered view can be bookmarked or sent to another manager. When the list is filtered to one vendor, a banner says *"Showing only lots from <vendor>."* with **Open vendor page →** and **✕ Clear filter (show all lots)** (L603–620).

**Columns** (L800–846) include COA, potency, lab, COA expiry, received, age, on hand, sold, sell-through, velocity, days of supply, ABC class, last counted, unit cost, extended cost, price, margin, extended retail, website category, onboarded, on menu, expires, compliance, disposition, notes, updated and status.

**Bulk fill missing fields…** appears under the filters when the list has lots (L695–700). See §4.20.

### 4.3 Lot statuses: what each one means

A lot has exactly one of five statuses (`actions.ts` L103–109; lot page L130–136):

| Status (screen) | Meaning | Can the register sell it? | How a lot normally gets it |
|---|---|---|---|
| **Active** | On the shelf, for sale | Yes, if it has units and a menu card | Finalize with a passing go-live check (SOP-04), or a manager from a "now clear" Issues row (§4.8) |
| **Quarantine** | Held out of sale while a decision is pending: release, return or destroy | No. Sales draw only from Active lots (`sale-lot-read.ts` L39–47). A quarantined lot does **not** hold the rest of the product (§4.11) | Finalize holds a lot that fails the go-live check (no CCRS id, no COA, or a FAILED result); SOP-15 holds before destruction |
| **Recalled** | Under a recall. The whole product is blocked at the register while **any** of its lots is Recalled (§4.11) | **No, and nothing else under the same product either.** No override | A manager, by hand, on the lot page (§4.10) |
| **Sold out** | Empty | No | The database flips it automatically when a **sale**, void or count takes it to zero (`atomic-quantity.ts` L44). A manual adjustment does **not** (§4.6) |
| **Destroyed** | Gone: destroyed and recorded | No | **Only** Returns & Destruction, which sets it after the destruction empties the lot (`disposition.ts` L1087–1094). **Never by hand** (§4.9) |

**How CCRS sees these statuses.** The weekly Inventory file lists every lot that is **not** Destroyed (`ccrs-batch.ts` L1209–1217). A Quarantine or Recalled lot is still listed in the Sales Floor area; the CCRS screen shows advisory note E45 for it. That is expected and needs no action (`ccrs-batch.ts` L1006–1010, L1118–1122).

### 4.4 Every morning: the Issues tab

**When:** every morning, before the store opens, by the opening manager. **Time:** about 10 minutes. **Record:** form 8.3.

1. Open **Inventory → Issues**. If it is clean, it reads: *"Nothing needs attention. No recalls, expired or undated stock, no blocked lots, and no crossed compliance limits (expiry window: 30 days)."* (`inventory/page.tsx` L572–575; window `EXPIRING_SOON_DAYS = 30`, `store.ts` L32). Tick "clean" on form 8.3 and stop.
2. Otherwise the rows come in two groups: **Needs action** (blocking) first, then **Worth a look** (warning) (`IssuesList.tsx` L11–12; `issues-core.ts` L16–25). Work every **Needs action** row before opening.
3. Use the row's own button. Every row names its fix. The rows you will see (`src/lib/admin/issues-core.ts`):

| Row title (screen) | Group | What it means (screen text) | Do this |
|---|---|---|---|
| **N lots with stock the register cannot sell — not linked to a product / not on the published menu / hidden on the menu / under a recall hold** | Needs action | *"These lots have units on hand, so a customer can ask for them, but the register will refuse the scan until the cause is fixed."* (L320–332) | **See the lots and their fixes**. The list under the rows gives one button per lot. A recall hold is §4.10; the other three causes are SOP-05b (menu) or §4.21 (product link) |
| **Received dates missing** | Needs action while undated lots hold stock; otherwise Worth a look (L338–346) | The lot has no real received date, and CCRS falls back to the import day | **Show these lots** → on each lot, **Received date** (§4.21) |
| **N lots currently flagged RECALLED — pull from sale** | Needs action (`issues-core.ts` L314) | *"A recall is on these lots. They must be pulled from sale and handled as the recall notice says."* (L387) | Check that every unit is physically segregated and that form 8.5 is open for this recall (§4.10) |
| **Expired and still active — <product>** (one row per lot, up to 50, then **…and N more expired lots**) | Needs action (L452–473) | *"Expired on <date>. Expired product may not be sold."* (L460) | Follow §4.16. **Do not** use the row's suggestion to *"record the destruction under Adjust quantity"* (L461); destruction is SOP-15 (§4.9) |
| **N lots in quarantine awaiting review** | Worth a look | *"Held out of sale, waiting for a decision (release, return or destroy)."* (L389) | Open each. If it was held at Finalize, follow SOP-04 §4.19. Never leave a lot in quarantine without a written reason on form 8.1 |
| **N lots active without a linked COA / lab result** | Worth a look | The COA link is what CCRS reads (L390–391) | §4.21 (attach the lab result) |
| **N lots expiring within 30 days** | Worth a look | *"These lots expire soon. Sell them first (First-Expired, First-Out) or plan a markdown."* (L392) | Move them to the front of the shelf. See **Insights → Sell first (FEFO)** (§4.16) |
| **N lots active not linked to a catalog product** | Worth a look | *"…cannot be sold at the register."* (L393) | §4.21 (link the product) |
| **N lots active but out of stock (0 on hand)** | Worth a look | *"Usually a lot that should be sold out."* (L394) | Check the shelf. If it is really empty, see §4.6 (a manual zero does not flip status; set **Sold out** under §4.8 and log it) |
| **N lots active with no expiry date on file** | Worth a look | *"…expiry checks cannot protect these lots."* (L395) | **Date them with expiration rules** (§4.15), or **Bulk fill the Cultivera-import lots** (§4.20) |
| **N lots active with no unit cost on file (understates on-hand value)** | Worth a look | (L396) | Tell the owner. A manager does not key cannabis cost (§4.20, Q-05a-3) |
| **N products are marked unavailable but you have stock** | Worth a look (L371–380) | *"Someone pressed "86" at a register, or they were emptied and restocked…"* | §4.12 (**Restore to sale**) |
| **Over the 4-month inventory ceiling** | Needs action (L431–440) | WAC 314-55-079(10): at most four months of average inventory | Tell the owner. **Open Purchasing** (SOP-09) |
| **No DOH-compliant (medical) product in stock** | Needs action, only if the store holds a medical endorsement (L441–450) | WAC 314-55-080 | Tell the owner. **Open Purchasing** |
| **N lots are overdue for a cycle count** | Worth a look (L477–486) | Past the A/B/C count cadence | **Open cycle counts** (SOP-06) |

4. Below the rows, two panels may appear: the per-lot list of **stock the register cannot sell** (`RegisterSellabilityBanner`), and **Marked unavailable, but you have stock** (§4.12). Each is silent when there is nothing to show.
5. Write the time, the number of Needs-action rows, and what you did on form 8.3. Anything you could not clear goes to the owner the same morning.

# Part 2: The lot page

### 4.5 A tour of the lot page

Open a lot from the list. From top to bottom (`src/app/admin/inventory/[id]/page.tsx`):

| Section (screen heading) | What it holds | Where in this SOP |
|---|---|---|
| Title, *"Lot <code> · <vendor>"*, and **← Back** when you came from another page (L360–373) | | |
| Green **Saved.** or red message banner (L385–401) | The result of your last button | §5.1 |
| Four cards: **On hand**, **Received**, **Unit cost**, **Status** (L404–418; Status is orange when Recalled) | | |
| **Received date** (L439–475) | The real day the lot arrived. It is what CCRS reports as the inventory date | §4.21 |
| Sell price (L479–517) | The out-the-door price and its legal floor | SOP-05b |
| Product link (L521) | Which menu product this lot sells as | §4.21 |
| **Lot details** (L534–) | Vendor, brand, strain, weight, sample, medical, **Expires** and **Expiry source** (L614–628), manifest link | §4.14 |
| *"From the one-time Cultivera import"* callout (L655–678) | Only on Cultivera-import lots, with links to Bulk fill | §4.20 |
| **COA / lab result** (L689–) | The linked lab result, or *"No COA linked to this lot…"*; the **Attach a lab result** search (`LotCoaAttach`, L763) | §4.21 |
| **Lab certificate (read by the system)** with **Re-read lab certificate** (`LabCertificatePanels.tsx` L35–56) | What the system read from the COA | §4.21 |
| **Correct lot details** (L806–868) | Vendor, brand, strain and strain type only. **Save corrections** | §4.21 |
| **Saved to Knowledge Base**, **On the menu (enrichment)** | Product Enrichment links | SOP-10 |
| **Correct the sell price**, **Which size is this lot?**, **Website type & category (menu)**, **Sales-limit classification** | Menu and price corrections | SOP-05b |
| **Adjust quantity** (L1474–1494) | Quantity change, reason, note. **Record adjustment** | §4.6–§4.7 |
| **Lifecycle status** (L1498–1512) | **Set status**. **Update status** | §4.8–§4.9 |
| **Adjustment history** (L1518–1546) | Every manual adjustment: +/- quantity, reason, note, date | below |

**Reading the Adjustment history.** Each line shows the change (green +, red -), the reason code (for example `shrink`), the note, and a date. Two limits (finding F-05a-13):
- The date is formatted by **your browser's clock and time zone** (`toLocaleDateString()`, L1539), not the store's Pacific day. A computer set to another time zone can show a different day.
- The line does **not** show **who** made the adjustment, although the system stores it (`actor_id`, `store.ts` L594–600). Form 8.2 is the readable record.

The history lists **manual** adjustments only. Sales, voids, cycle counts and destructions move quantity through their own records (SOP-01, SOP-06, SOP-15).

### 4.6 Adjust quantity: the procedure

**What it does.** **Record adjustment** adds the number you type (negative to remove) to the lot's on-hand quantity, writes one line to the Adjustment history, and moves the menu stock for the size this lot sells as by the same amount (`actions.ts` L111–140 → `store.ts` L578–616; menu sync L611–615). Except for reason **Receive (add)**, the line is also sent to CCRS in the next weekly InventoryAdjustment file (§4.7).

**What it does not do** (findings F-05a-3, F-05a-7):
- **It does not stop at zero.** The new quantity is the old quantity plus your number, with no floor (`store.ts` L603–608). Type -10 on a lot with 6 and the lot shows -4.
- **It does not flip the lot to Sold out** at zero. Sales, voids and counts do (`atomic-quantity.ts` L44). An adjustment does not.
- **It is not protected against a sale at the same moment.** It reads the quantity, then writes old + change (`store.ts` L587–591, L603–608). If a register sells from the same lot in between, that sale's decrement can be lost. Sales, counts and destructions use the protected database write (`applyLotDelta`, GW-012); this button does not.
- **It writes no audit-log row.** The adjustment line itself (with the user id) is the only record.

**Procedure.**
1. **Count first.** Count the physical units of this lot twice. Know the exact difference before you touch the screen. If the difference came from a full shelf count, use a cycle count instead (SOP-06): it uses the protected write and has a review step.
2. **Avoid busy times.** Make adjustments when no register is selling this product. Before opening or after close is best.
3. Fill in **Adjust quantity**:
   - **Quantity change**: the difference. *"Use a negative number to remove stock."* (L1477). Never more negative than **On hand**.
   - **Reason**: pick from the table in §4.7. Never **Destruction** or **Recall removal** (§4.7).
   - **Note**: **always** write one, even though the screen says *"Optional detail for the audit trail…"* (L1489). Say what happened, who found it, and where the product is now. For **Employee sample** and **Other** the note is **required by CCRS** (§4.7).
4. Press **Record adjustment**. The page shows **Saved.** If the menu stock could not follow, the banner adds a sentence after *"Saved."* (`actions.ts` L135–138). Read it and tell the owner if it says the menu did not move.
5. Check **On hand**. If it is below zero, or exactly zero on an Active lot, see §4.8 (set **Sold out**) and tell the owner.
6. Write the adjustment on **form 8.2** (lot, change, reason, note, who, time, second person who saw the count).

### 4.7 Which reason to choose (and what CCRS receives)

The **Reason** list (lot page L118–128) and what each one sends to CCRS (`ccrs-inventory-adjustment-core.ts` L62–105):

| Reason (screen) | Use it when | CCRS AdjustmentReason | Note | Rule |
|---|---|---|---|---|
| **Receive (add)** | Do **not** use. Stock arrives through Receiving (SOP-04) | *Not sent.* `isReportableAdjustment` skips it (L101–105) | — | **Never.** Adding units by hand puts units on our books that CCRS never hears about (F-05a-7). If units were truly missed at receiving, tell the owner |
| **Shrink** | Units missing with no known cause, found outside a cycle count | Lost | Required by this SOP | Tell the owner the same day if more than 1 unit or any amount above $50 at cost |
| **Damage** | A package broken or unsellable in the store | Lost | Required by this SOP: what broke, how | Keep the damaged product in quarantine for SOP-15 destruction. The adjustment does not destroy it |
| **Sample (lab/QA)** | Units pulled for a lab or QA test | ReturnedLabSample | Required by this SOP: lab and reason | |
| **Employee sample (WAC 314-55-096)** | A vendor trade sample given to a paid employee | Other | **Required by CCRS**: the employee's name. Without it, CCRS withholds the row with error **E13** (`ccrs-inventory-adjustment-core.ts` L201–212; `ccrs-preflight-core.ts` L271) | Prefer the trade-samples screen, which writes the note for you (`trade-samples.ts` L280–300) |
| **Destruction** | Do **not** use | Destruction | — | **Never.** Destruction is SOP-15, with its hold, method, witness and waste record (F-05a-5) |
| **Cycle-count correction** | Only when the owner tells you to correct a count by hand | Reconciliation | Required by this SOP: which count | Normal count corrections come from the cycle count itself (SOP-06) |
| **Recall removal** | Do **not** use | Destruction | — | **Never.** Recalled product may not be destroyed until the LCB is notified and the destruction is coordinated (§4.10). SOP-15 enforces that; this reason does not (F-05a-5) |
| **Other** | Anything else, with owner approval | Other | **Required by CCRS**: a clear sentence. Without it the row is withheld (E13) | Ask the owner first |

**Theft and seizure.** CCRS has **Theft** and **Seizure** reasons (L91–94), but the lot page has **no Theft or Seizure choice** (L118–128; finding F-05a-6). If product is stolen or seized:
1. Do not adjust anything yet. Follow SOP-20 (incident) and call the owner.
2. The owner decides how it is recorded. Until gap G-23 is built, the only path on this screen is **Other** with a note that begins "THEFT:" or "SEIZURE:". That reaches CCRS as **Other**, not **Theft** or **Seizure**.

> **Control: every manual adjustment has a reason, a written note, a double count and a line on form 8.2.** The screen accepts an empty note, but CCRS withholds an Other or Employee-sample row that has none (E13). The adjustment history shows no name. The note and form 8.2 are how the owner and the state can tell what happened.

### 4.8 Lifecycle status: the procedure

**What it does.** **Lifecycle status → Set status → Update status** writes the status you pick to the lot, and nothing else (`actions.ts` L142–155 → `store.ts` L836–851). The help text says *"Recalled / destroyed lots are excluded from sale."* (L1500).

**What it does not do** (findings F-04-2, F-05a-1, F-05a-2):
- It runs **no go-live check**. It will set **Active** on a lot with no COA, no CCRS id, or a FAILED lab result (F-04-2, **S1**).
- It writes **no audit row** and asks for **no reason**. Nobody can later see who placed or lifted a recall, or when.
- It does **not** change the quantity. **Destroyed** leaves every unit on file (§4.9).

**Allowed uses, and the control for each:**

| From → to | Allowed? | Who | Control |
|---|---|---|---|
| Quarantine → **Active** | Only from a **"Held in quarantine, now clear"** Issues row (SOP-04 §4.19) | Manager | Form 8.1 line. Never for a FAILED result |
| Active → **Quarantine** | Yes: a product question (damage, label error, customer complaint) while you decide | Manager | Form 8.1 line with the reason. Decide within 3 business days (release, return SOP-15, or destroy SOP-15) |
| Active or Quarantine → **Recalled** | Yes: a recall (§4.10) | Manager, then the recall coordinator | Form 8.1 **and** form 8.5 |
| Recalled → **Active** | Only when the recall notice (or the LCB) clears this lot, in writing | **Owner** (recall coordinator) | Form 8.1 with the notice reference; the notice copy goes in the binder |
| Active → **Sold out** | Yes, when the lot is physically empty and **On hand** is 0 | Manager | Form 8.1 line |
| Any → **Destroyed** | **No.** Never by hand (§4.9) | — | Use Returns & Destruction (SOP-15) |

**Procedure.**
1. Check the move against the table above. If it is not allowed, stop.
2. Fill in form 8.1 **first**: lot, product, from, to, reason, reference (recall notice, Issues row, COA), your name, time.
3. **Set status** → choose → **Update status**. The page shows **Saved.**
4. Check the **Status** card on the lot page.
5. If you set **Recalled**, continue with §4.10. If you set **Active** from a recall, check the register by scanning the product: it should ring up.

> **Control: every status change is a manager decision written on form 8.1 before the button is pressed; Active from quarantine only from a "now clear" row; Recalled → Active only by the owner with the written clearance; Destroyed never by hand.** The Lifecycle status box checks nothing and logs nothing (F-04-2, F-05a-1, F-05a-2; gaps G-19, G-22).

### 4.9 Never "Destroyed" by hand

**What happens if someone does it** (finding F-05a-1, **S1**):
1. The status becomes **Destroyed**, but **On hand stays the same** and **no destruction is recorded** (`store.ts` L836–851).
2. The weekly CCRS Inventory file reads only lots that are **not** Destroyed (`ccrs-batch.ts` L1209–1217). Destroyed lots are added back only when the same week's file carries a destruction event for them (`readDestroyedLots`, L380–391).
3. So the lot **silently disappears from what Greenway reports**, while the state's system still shows its last quantity on hand. No Destruction adjustment is filed, and no waste record exists. That is a traceability error in a state filing.

**What to do instead.** Every destruction goes through **Inventory → Returns & Destruction** (SOP-15). That flow records the hold, the method, the waste record and, for recalls, the LCB coordination. It sets **Destroyed** itself, and **only when the destruction empties the lot** (`disposition.ts` L1087–1094).

**If you find a lot set to Destroyed by hand** (status Destroyed, On hand above 0, nothing in Returns & Destruction):
1. Do **not** change it back yourself.
2. Write it on form 8.1 (lot, on hand, when found) and tell the owner the same day.
3. The owner decides, with SOP-15 and SOP-16, how to record what really happened to the product.

> **Control: a lot becomes Destroyed only through Returns & Destruction.** The manual path skips the destruction record and drops the lot from the CCRS Inventory file with units still on hand (F-05a-1, S1; gap G-22).

# Part 3: Recalls, the 86 and restore to sale

<!-- PART 3 (sections 4.10 onward) is appended in the next commit. -->
