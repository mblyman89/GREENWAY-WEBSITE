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

### 4.10 Placing and releasing a recall hold

**What a recall hold is in this app.** It is not a separate screen. A lot is "on recall hold" when its **Lifecycle status** is **Recalled** (`HOLD_LOT_STATUS = "recalled"`, `src/lib/pos/recall-hold-core.ts` L44). Every product key that has at least one Recalled lot is held (`buildRecallHoldIndex`, L53–63; read by `recalledProductKeys`, `recall-hold-store.ts` L72–121). Routine **Quarantine** lots do **not** trip the hold (`completion-gate.ts` L98–100).

**What the law requires** (WAC 314-55-225, read 2026-10-27 at app.leg.wa.gov):
- **Recall** (a risk to consumers, for example pesticides or residual solvents above action levels, (3)(a)): *"Immediately notify the local LCB enforcement officer"* and *"Secure, isolate, and prevent the distribution"* of all product that may have been exposed. The licensee *"is prohibited from destroying any affected product prior to notifying the LCB and coordinating with the local LCB officer on destruction activities."* ((3)(b)(i)(A)–(B))
- **Market withdrawal** (no risk to consumers, for example aesthetics or packaging, (2)(a)): *"notify the LCB by contacting the local LCB enforcement officer assigned to the local area within 48 hours of beginning the market withdrawal."* ((2)(b))
- **Tracking.** An affected licensee *"must track the total amount of affected product and the amount of affected product returned"*, and report progress to the LCB at least once a week ((3)(f)).
- **Destruction** of recalled product is coordinated with, and may be overseen by, LCB enforcement ((3)(e)).

**Recall or withdrawal: who decides.** The **recall coordinator** (the owner until Q-05a-2 is answered, §2) decides which one it is. A manager who is unsure treats it as a **recall** and calls the owner.

**Procedure: placing a recall hold** (manager, the moment a recall notice, a vendor notice, an LCB call or a failed-safety finding arrives):
1. **Open form 8.5** (recall event worksheet). Write who told you, when, how, and the product, vendor, lot or batch numbers and recall reference exactly as given.
2. **Find every affected lot.** Inventory → type into the search box (*"Product, lot code, POS key, vendor, brand, strain, notes…"*, `InventoryFilterPanel.tsx` L345): the product, the vendor, and each lot number. Use the **All** status tab, so sold-out and quarantined lots also show. List each lot on form 8.5 with its **On hand**.
3. **Set each affected lot to Recalled.** For each lot: write a form 8.1 line first, then **Lifecycle status → Set status → Recalled → Update status** (§4.8). The page shows **Saved.**
4. **Pull the product physically.** Remove every unit from the sales floor, the display cases and the vault shelf. Put it in a sealed bin or bag marked **"RECALL — DO NOT SELL — <product> — <date>"**, in the quarantine area. Count it; the count must match **On hand**. Write the count on form 8.5. Any difference is reported to the owner the same hour.
5. **Hide it from the website as well** (finding F-05a-16, below). Open **Product Intake → Product Enrichment** (`admin-nav-data.ts` L77), open the product, set **Visibility** to **Always hide**, type the reason (for example "RECALL 2026-10-27") in **Reason if hidden**, and press **Save enrichment** (`products/[key]/page.tsx` L1054–1074; `products/actions.ts` L205–211, L255–270, audited `product.visibility_changed`). The recall hold alone does not stop online reservations.
6. **Check the register.** Scan or search the product at a register (download the menu first: a register that has not refreshed may still show it). It should not appear. If it is still listed after a refresh, stop the register from selling it by word of mouth and call the owner (§4.11 explains why the sale would still be refused at completion).
7. **Check open orders.** Open **Online Orders** (`admin-nav-data.ts` L53) and look for pending pickup orders that hold the product. Call those customers, tell them the item is unavailable, and remove it at pickup. (The pickup cannot be completed with it in the order, §4.11.)
8. **Notify.** The **recall coordinator** notifies the LCB: immediately for a **recall**, within **48 hours** for a **market withdrawal**. Write the officer's name, the time and the method on form 8.5. A manager acting in the owner's absence makes the call if the owner cannot be reached within 1 hour of a recall.
9. **Do not destroy anything.** Recalled product stays in the bin until the coordinator has notified the LCB and agreed the destruction with the officer. When that is done, destruction runs through **Returns & Destruction** (SOP-15), which refuses a recall destruction until **LCB coordination** is confirmed and the **officer is named**: *"RECALL product: destruction is prohibited until LCB has been notified and destruction is coordinated with your enforcement officer (WAC 314-55-225). Confirm coordination first."* and *"Record the LCB enforcement officer you coordinated with."* (`disposition-core.ts` L226–243). Never use the **Recall removal** adjustment reason (§4.7), and never set **Destroyed** by hand (§4.9).
10. **Track weekly.** Each week while the recall is open, write on form 8.5 the units held, returned, destroyed and sold before the hold, and the date the progress was reported to the LCB ((3)(f)).

**Procedure: releasing a recall hold** (**owner** only, as recall coordinator):
1. Release only on **written** clearance: the recall notice withdrawn, the vendor's written clearance for these lots, or the LCB's release. Put the copy in the compliance binder.
2. Write a form 8.1 line: lot, Recalled → Active, the clearance reference, your name, time.
3. **Lifecycle status → Active → Update status** on each cleared lot. Lots that will be destroyed or returned are **not** set Active. They stay Recalled until SOP-15 completes, and SOP-15 sets **Destroyed** when the destruction empties the lot (§4.9).
4. Set **Visibility** back to **Inherit POS** (or **Always show**) on Product Enrichment if you hid it in step 5 above.
5. Scan the product at a register to confirm it rings up again. Close form 8.5 with the date and a one-line outcome.

**What the app does not record** (findings F-05a-2, F-05a-15): placing or lifting **Recalled** writes **no audit row**, asks for **no reason**, and the release is open to any manager-level login (§4.8). The app has no recall-plan record and no recall-coordinator field (the only mention is `docs/RETURNS_DESTRUCTION_COMPLIANCE.md` L136). Forms 8.1, 8.4 and 8.5 are the record until gaps **G-22** and **G-25** are built.

**Finding F-05a-16 (S2): a recall hold does not reach the website or online ordering.** The public menu filters out only **hidden** cards (`src/lib/pos/live-menu.ts` L167–171, L289–292). Online order pricing skips only hidden cards (`src/lib/orders/order-pricing.ts` L124–134). Neither reads lot status: `recalledProductKeys` has exactly four callers, the register menu route, the completion gate, restore to sale and the sellability report (`api/pos/menu/route.ts` L121; `completion-gate.ts` L103; `restore-to-sale-store.ts` L131; `register-sellability-store.ts` L175). A customer can still see a recalled product on the website and **reserve** it for pickup. The sale is refused only when staff try to complete the pickup (§4.11). Step 5 above (**Always hide**) is the interim control. It hides every size of the product, so if only one size of a mastered product is recalled, ask the owner before hiding.

> **Control: a recall is placed by a manager, on form 8.1 and form 8.5, the same hour the notice arrives; the product is physically segregated and counted; the website card is hidden; the LCB is notified (immediately for a recall, 48 hours for a withdrawal); nothing is destroyed before LCB coordination; only the owner releases a hold, on written clearance.** The app's hold stops register sales but writes no record, and does not reach the website (F-05a-2, F-05a-15, F-05a-16; gaps G-22, G-25).

### 4.11 What a recall hold does at the register

Budtenders: read this section.

**Two layers stop a recalled product at the register.**

| Layer | What it does | How strong | Where |
|---|---|---|---|
| 1. The register menu | When a register downloads the menu, a product with any Recalled lot is left out. If only one size of a mastered product is recalled, only **that size** is left out | **Advisory.** If the recall read fails, the register gets the full menu rather than a blank screen | `api/pos/menu/route.ts` L116–121, L225–238, L302–304 |
| 2. The completion gate | When the sale is completed (at the register, at sync, or a pickup order in the back office), every line is checked again. A held product refuses the whole sale | **Hard. No override.** If the recall table cannot be read, the sale is refused | `completion-gate.ts` L95–119; `recall-hold-core.ts` L108–117 |

**The message the register shows** (layer 2), word for word:

> *"Sale blocked: "<product>" is under an active RECALL hold — recalled product must be segregated and may NOT be sold. Remove the item from the sale. There is no override for this rule; the hold clears only when a manager releases or destroys the recalled lot in Admin → Inventory."* (`recall-hold-core.ts` L108–117)

If the recall status cannot be read at all:

> *"Sale blocked: the recall-hold status of this order's products could not be verified (inventory read failed). Try again; if it persists, contact the administrator. Selling cannot proceed while recall status is unknown."* (`completion-gate.ts` L117–118)

**What the budtender does:**
1. Remove the item from the sale. Do not try another register, another size code or a keypad line to get around it.
2. Tell the customer the product is not available today. Do not say "recall" to the customer unless the owner has approved the wording (§4.13, communications plan).
3. Tell the manager on duty. The manager checks that the product is off the shelf (§4.10 step 4).
4. If it was the second message (status could not be verified), try once more. If it repeats, the manager calls the owner. No sale proceeds while recall status is unknown.

**The manager override does not apply.** The sales-limit override (`sales_limit.override`) is evaluated after the recall gate (`completion-gate.ts` L199) and never lifts a recall. A sale synced from a register **never** carries an override (`sync-store.ts` L1133–1141).

**An offline sale.** A register selling offline uses its last downloaded menu. If a recalled product was sold offline, the sale is refused when it syncs, recorded as `order.completion_blocked`, and sent to the sync exception queue (`sync-store.ts` L1136–1162). The product has already left the store. The manager treats it as a recall incident: write it on form 8.5 (units sold before the hold) and tell the owner the same day. The exception queue itself is SOP-01 / SOP-03.

**On the back office.** The **Issues** tab shows **N lots currently flagged RECALLED — pull from sale** (§4.4). The **Stock on hand that the register cannot sell** panel lists recalled lots under *"under a recall hold"* (`issues-core.ts` L281–285). The register's own reconciler describes it as: *"Blocked by a recall hold. Recalled product cannot be sold even though stock is on hand — clear the recall in the back office first."* (`register-availability-core.ts` L333–345). Stock on hand never overrides a recall (L332–333).

### 4.12 The register's "86" and Restore to sale

**The 86 (register).** On a product's detail sheet at the register there is a small link **"Shelf is empty? Mark out of stock…"** (`src/app/pos/SaleFlow.tsx` L4266–4276). Pressing it asks:

> *"Remove <product> from every register and the website? Pick why — a manager brings it back through the back office when stock returns."* (L4279–4280)

The reasons are buttons: **shelf empty**, **damaged / unsellable**, **wrong listing**, and **Cancel** (`stock-flag-core.ts` L32; free text is deliberately not allowed, L31). It is not offered on keypad (custom) lines (`canFlagOutOfStock`, L79–81).

**What it does.** The register calls `/api/pos/stock-flag`. The route checks the device (L28–34), sets the product's published menu card to **unavailable** (L77–83) and writes an audit row `pos.stock_flag` with the device, the register, the reason and the name the register sent (L85–102). The name is supplied by the register, not checked by the server (L48–52). It changes **only the menu card**. It does **not** change any lot, quantity or status, and nothing is reported to CCRS.

**When a budtender uses it.** Only when a product shows on the menu but there is truly none on the shelf or in the back stock, or the listing is plainly wrong. Tell the manager right after. Never use it for a recall. A recall is a lot status set by a manager (§4.10), and the 86 can come undone on its own (next paragraph).

**Finding F-05a-9 (S3): the 86 does not stick while stock is on file.** Every time a register downloads the menu, the reconciler checks each unavailable card against live **Active** lots. If units are on hand, the card is put back on sale automatically: *"Restored to the register: inventory shows N units on hand in active lots, but the published menu still had it marked unavailable."* (`register-availability-core.ts` L318–421, message L389; called at `api/pos/menu/route.ts` L240). So an 86 on a product the system thinks it still has, for example **damaged / unsellable** with units still on the lot, reappears at the next menu download. The register's own prompt says a manager brings it back. The code brings it back without one.

**What the manager does when an item is 86'd** (same shift):
1. Find the reason. Check the shelf, the back stock and the lot's **On hand**.
2. **Shelf truly empty, On hand above zero:** the count is wrong. Do not adjust by hand on a guess. Count it (SOP-06 cycle count, or §4.6 with form 8.2 if the owner approves). Until the count is fixed, the item will keep coming back at the register.
3. **Damaged or unsellable:** move the units to quarantine, set the lot to **Quarantine** with a form 8.1 line (§4.8), and handle it under SOP-15. Quarantine takes the lot out of the live count, so the card stays unavailable.
4. **Wrong listing:** tell the owner. Menu listings are SOP-05b.
5. **Stock is really there** (someone 86'd it by mistake, or it was restocked): use **Restore to sale** below.

**Restore to sale (back office).** On **Inventory → Issues**, the panel **Marked unavailable, but you have stock** appears only when a product is flagged unavailable while Active lot units sit behind it (`RegisterSellabilityBanner.tsx` L142–188; placed at `inventory/page.tsx` L584–586). Its text: *"Someone pressed "86" on these at a register, or they were emptied and then restocked. They are on the shelf now. Restoring recomputes each one from its live lot count, so it can only clear a stale flag — it can never invent stock."* (L154–158). Each row shows the product and **N units on hand**, with the button **Restore to sale → <status>** (L180).

**Procedure: Restore to sale** (manager):
1. Look at the shelf. Restore only when the product is physically there and sellable.
2. Press **Restore to sale → …**. The server rechecks everything (`actions.ts` L1174–1198 → `restore-to-sale-store.ts`). It refuses if the product is under a recall hold (that check fails closed, `restore-to-sale-store.ts` L125–140), if the card is hidden, or if no Active lot holds stock (`restore-to-sale-core.ts` L115–158). The status it sets is computed from live units: **0 or less → unavailable, 1–3 → low-stock, more than 3 → in-stock** (`statusForUnits`, `register-availability-core.ts` L141–145).
3. Read the banner at the top of Inventory. Success: *"<product> is back on sale (N units on hand — <status>)."* (`restore-to-sale-core.ts` L167). The restore writes an audit row `inventory.restore_to_sale` with the old and new status (`restore-to-sale-store.ts` L166–172) and refreshes the website.
4. A refusal (§5.3) tells you what is wrong. Fix that; do not try to work around it.

> **Control: the 86 is a register shortcut, not a stock record. The manager investigates every 86 the same shift, fixes the cause (count, quarantine or listing), and restores only product that is physically on the shelf.** The 86 is audited (`pos.stock_flag`) but comes back on its own while units are on file (F-05a-9; gap G-26 proposes a sticky 86 option, owner question Q-05a-5).

### 4.13 The written recall plan (WAC 314-55-225)

**The law.** *"All licensees must develop a recall plan"* setting the procedures the licensee will follow in a recall of product under its control. At a minimum it must include ((3)(d)(i)):
- **(A)** *"Designation of a member of the licensee's staff who serves as the licensee's recall coordinator"*;
- **(B)** *"Procedures for identifying and isolating product to prevent or minimize its distribution to consumers"*;
- **(C)** *"Procedures to retrieve and destroy product"*; and
- **(D)** *"A communications plan to notify those affected by the recall"*, including how other licensees in possession are told and the use of press releases or other notices when product reached consumers.

A recall *"must follow the procedures outlined in the recall plan unless otherwise agreed by the LCB and the licensee."* ((3)(d)(ii))

**What the app has.** No recall plan, no coordinator field and no recall log (finding F-05a-15, **S2**; gap G-25). It has the pieces a plan points to: the **Recalled** status and its register hold (§4.10–§4.11) and the recall-destruction block in Returns & Destruction (SOP-15).

**What Greenway does.** **Form 8.4** in §8 is the recall plan, written to (A)–(D) and built on this SOP:
- (A) **Recall coordinator**: named on the form (the owner until Q-05a-2 is answered), with a back-up.
- (B) **Identify and isolate**: §4.10 steps 1–7.
- (C) **Retrieve and destroy**: §4.10 steps 8–10 and SOP-15. Greenway is a retailer. It does not sell to other licensees, so "retrieve" means customer returns brought back to the store (SOP-15 customer returns) and the product held in the bin.
- (D) **Communications**: who calls the LCB officer, the vendor, and the customers with open orders, and who approves any public notice. Only the owner speaks to the press or posts publicly.

**Procedure.**
1. The owner fills in form 8.4, signs and dates it, and files it in the compliance binder. Staff sign that they have read it.
2. Review it **every year** and whenever the coordinator, the LCB officer's contact or this SOP changes. Write the review date on the form.
3. In a recall, follow form 8.4 and §4.10. Any departure must be agreed with the LCB and written on form 8.5.

> **Control: a signed, current recall plan (form 8.4) with a named coordinator is in the binder, and every recall follows it.** WAC 314-55-225(3)(d) makes the plan mandatory. The app does not hold one (F-05a-15; gap G-25).

# Part 4: Expiry dates

### 4.14 Where a lot's expiry date comes from

**The law, as the code states it.** The code says Washington does not *require* an expiration date: *"Washington does not require an expiration date (WAC 314-55-105(8) lists a "best by" date as optional label information)"* (`expiry-rules-core.ts` L32–34; same sentence on the **Expiration rules** page, **How this works**). This SOP records that as the code's statement. The store's own rule on selling past a date is an owner decision (question **Q-05a-1**, §4.16).

**Every expiry date has a source.** The lot page shows it under **Expiry source**, next to **Expires** (`[id]/page.tsx` L603–628). The source names (`SOURCE_LABELS`, `expiry-rules-core.ts` L61–69):

| Expiry source (screen) | Where the date came from | Can a rule change it? |
|---|---|---|
| **Vendor manifest / JSON / COA (intake)** | Read from the vendor's manifest or COA when the delivery was received (SOP-04) | **Never** (`PROTECTED_SOURCES`, L49; skipped at L505) |
| **Certificate of analysis** | Read from the COA | **Never** |
| **POS import** | The one-time POS / Cultivera import | **Never** |
| **Typed by owner** | Keyed by hand, for example through **Bulk fill** (§4.20; `actions.ts` L986) | Only with **Also replace owner-typed dates** or **Override all owner-typed dates** ticked |
| **Expiration rule** | Calculated by a rule on the **Expiration rules** page | Yes. It is recalculated when the rule changes and cleared when no rule covers it any more (L19–23) |
| **On file (source not recorded)** | An old date with no recorded source | **Never** (*"never guess"*, L13–15) |
| **No date** | Nothing on file | A rule fills it |

Beside the source, the lot page shows a countdown (`expiryStatus`, L770–777): **No date**, **Expired Nd ago**, **Expires today**, **Expires in Nd** (30 days or less), or **Good to <date>**. An expired lot shows its date as **<date> (EXPIRED)** in red (L603–612). When the source is a rule or there is no date, an **Expiration rules** link appears (L622–626).

**On the lot label.** A rule date prints as **Best by**; every other date prints as **Expires** (`labelWord`, `expiry-rules-core.ts` L1116–1127; label page L116–124). A rule date is an estimate, not a manufacturer's date.

**There is no box on the lot page to type an expiry date.** The only ways a date is set after receiving are **Bulk fill** (Cultivera-import lots, blanks only, §4.20) and **Expiration rules** (§4.15). If a vendor sends a corrected date, tell the owner.

### 4.15 Expiration rules: Save, Preview, Apply

**Where:** **Inventory → Expiration rules** (button on the Inventory header; `/admin/inventory/expiration-rules`). **Who:** owner, admin or manager (`page.tsx` L222; `actions.ts` L62, L131, L141). **Recommended:** the owner sets the rules; a manager applies them only when the owner asks.

**The page** (title **Expiration rules**; subtitle *"Give products without a manufacturer date a best-by date, by category or type. Dates from the vendor manifest / JSON, a COA or the POS are never changed."*, L279–280):
- Header buttons: **Expiration report**, **Manage categories & types**, **Back to inventory** (L284–292).
- Four cards: **Lots on hand**, **Have a date** (percent dated; green at 90% or more), **Rules active**, **Value at risk** (*"Expired or due in 30 days, at cost"*; opens the report) (L341–356).
- **How this works**: five plain rules (L364–386). A type rule beats its category rule. Document dates are always kept. Owner-typed dates are kept unless you tick the override. *"Save first, then Preview… Apply writes exactly that and nothing else. New deliveries get rule dates automatically when you finalize a manifest (blank dates only)."*
- **Preview and apply** card (*"Uses the SAVED rules. Nothing changes until you press Apply."*).
- The rules form: one fold-out group per category, with a **category rule** row (*"Every <category> item"*) and one row per **type**. Each row has a **Research suggests** column, with a **Why** fold-out and its citations, and a **Lots** count (blank, document date, owner-typed, by rule, unsourced).
- **Where dates come from now** (a badge per source) and **Sources behind the suggestions** (the published studies behind each suggestion).

**One rule row** (L180–216):
- **Rule**: **No rule** · **Months after** · **Days after** · **Fixed date** · **Does not expire**. Up to 120 months or 3,650 days (`MAX_RULE_MONTHS`, `MAX_RULE_DAYS`, `expiry-rules-core.ts` L55–56).
- The number (**#**) or the date.
- **Count from**: **from received date** or **from lab test date**. A lot with no such date is skipped (*"No date to count from (received / lab test date missing)"*).
- **Also replace owner-typed dates** (tick box).
- **Note (optional)**: write why you chose this rule.
- **Suggested - not saved yet** (orange badge) marks a value filled from the research that you have not saved.

**Procedure** (owner, or a manager on the owner's instruction):
1. **Decide the rules first, on paper.** For each category, and only those types that differ, decide **Months after / from received date** or **Does not expire**. Prefer the manufacturer's stated shelf life over the research suggestion. For types you created yourself, the page says there is *"No researched default"* (L117–127).
2. Fill in the rows, or press **Fill blanks with suggestions** to pre-fill every empty row from the research (each shows **Suggested - not saved yet**). Check every suggested row. Clear the ones you do not want back to **No rule**.
3. Press **Save rules** (top or bottom of the form). The page shows *"Rules saved: N saved, N removed, N unchanged. Lots are not changed until you Preview and Apply."* (L329–330). Each saved, changed or deleted rule is audited (`inventory_expiry_rule.created|updated|deleted`, `actions.ts` L92–117). If a row is invalid, nothing is saved and the orange card **Nothing was saved** lists the problem rows (L316–325).
4. Press **Preview all rules**, or **Preview this rule** on one row. Leave **Override all owner-typed dates** unticked unless the owner has said to replace them. The preview shows *"N lots would change; N are left alone"*, coloured badges per kind of change (**Fill blank date**, **Update rule date**, **Replace owner-typed date**, **Clear rule date (no rule now)**; orange for the last two, L57–62), the fold-out **Why lots are left alone** (§5.2), and a table of the first 300 lots with **From** and **To**.
5. **Read the table.** Look hard at every orange badge. **Replace owner-typed date** overwrites a date someone keyed on purpose. **Clear rule date** blanks a date because no rule covers it any more.
6. Press **Apply to N lots**, or **Cancel**. If anything changed since the preview (a lot, a rule or a date), nothing is written and a fresh preview appears: *"Something changed since your preview (a lot, a rule, or a date). Nothing was written. Here is the fresh preview - review it and apply again."* (L405–409; fingerprint check, `actions.ts` L146–157). Review it and apply again.
7. Read the green banner: *"Applied to N lots: N blank dates filled, N rule dates updated, N owner-typed dates replaced, N rule dates cleared."* It may add *"N lots changed since the preview and were left alone."* or *"N writes failed - see the audit log."* (L335–342). One audit row, `inventory_lot.expiry_rules_applied`, records every lot's old and new date (`actions.ts` L161–180), so any date can be traced and undone.

**At receiving.** When a manifest is finalized (SOP-04), lots with no document date get the rule date automatically. This is **fill-only**: blank dates only, never an override (`intake-store.ts` L1587–1612). A failure is written on the manifest timeline. Re-run Preview / Apply here to fix it.

> **Control: rules are decided by the owner, saved, previewed and only then applied; every orange change in the preview is read before Apply; document dates are never touched.** Save and Apply are audited with every lot's before and after date. The two-step Preview/Apply with its fingerprint check means a manager cannot apply something other than what was reviewed.

### 4.16 Expired and expiring-soon stock

**What the app does with an expired lot**, verified in the code:

| Where | What happens |
|---|---|
| **Issues tab** | One **Needs action** row per expired Active lot, *"Expired and still active — <product>"*, up to 50, then *"…and N more expired lots"* (`issues-core.ts` L417, L452–473) |
| **Lot page** | The date shows **(EXPIRED)** in red; the source line shows **Expired Nd ago** |
| **Expiration report** | The **Expired** bucket and value (§ below) |
| **Register** | **Nothing.** The register menu and the completion gate do not read expiry dates (no expiry check in `completion-gate.ts` or `api/pos/menu/route.ts`) |
| **Which lot a sale draws from** | The **oldest received lot first** (FIFO by when the lot row was created: `sale-lot-read.ts` L39–47), not the soonest-expiring (FEFO) |

**Finding F-05a-8 (S2): the only stop on selling expired product is a person reading the Issues tab.** The register will sell an expired Active lot. The Issues tab says *"Expired product may not be sold."* (`issues-core.ts` L388, L460), a rule the code itself says the state does not impose (§4.14). Its fix text, *"Open the lot and change its status (or record the destruction under Adjust quantity)."* (L461), points to the manual destruction reason this SOP forbids (§4.7, §4.9). Whether Greenway sells product past its date is an owner decision (**Q-05a-1**). Gap **G-24** (a register block or warning, and FEFO lot draw) waits on that answer.

**Until the owner answers Q-05a-1, this SOP treats expired product as not for sale:**
1. Every morning (§4.4), for each **Expired and still active** row: find the units and pull them from the shelf.
2. Put them in quarantine, then set the lot to **Quarantine** with a form 8.1 line that reads "EXPIRED <date>" (§4.8). Quarantine takes the lot off the register's live count.
3. Tell the owner. The owner decides: return to the vendor or destroy (both are **SOP-15**). **Never** use **Adjust quantity → Destruction**, whatever the Issues text says (§4.7).
4. If the date is a **rule** date (**Best by**) and the product looks and smells fine, write that on form 8.1. The owner may choose to keep selling it once Q-05a-1 is answered.

**Expiring soon (30 days).** The **Worth a look** row *"N lots expiring within 30 days"* says: *"These lots expire soon. Sell them first (First-Expired, First-Out) or plan a markdown."* (`issues-core.ts` L392; window `EXPIRY_SOON_DAYS = 30`, `expiry-rules-core.ts` L52, equal to `EXPIRING_SOON_DAYS`, `store.ts` L32).
1. Open **Inventory → Insights → Sell first (FEFO)** (`InventoryIntelPanel.tsx` L199–201) for the ranked list.
2. Move those units to the front of the shelf and tell the budtenders.
3. Because the register draws the **oldest received** lot first, not the soonest-expiring, two lots of one product with different dates can sell out of order. Where possible, keep only one lot of a product on the floor at a time, and put the soonest-expiring one out first.
4. A markdown is a pricing decision for the owner (sell price: SOP-05b).

**The Expiration report** (**Reports → Expiration** tab, `ReportTabs.tsx` L22, or the **Expiration report** button; any role with `reports.view`, including read-only, `reports/expiration/page.tsx` L151). Its sections: **Aging - lots**, **Aging - value** (uncosted lots count as $0), **12-month forecast** (value reaching its date each month), **Where dates come from**, **Coverage gaps** (categories with stock and no date), **By category** and **Rule usage** (L229–277). Most sections export. The owner reviews it monthly (form 8.3, monthly line).

> **Control: every expired Active lot is pulled, quarantined and logged the morning it appears; expiring-soon stock goes to the front of the shelf; the owner reviews the Expiration report monthly.** The register does not block expired lots and draws oldest-received first (F-05a-8; gap G-24 pending Q-05a-1).

# Part 5: Tags, labs, labels and corrections

<!-- PART 5 (sections 4.17 onward) is appended in the next commit. -->
