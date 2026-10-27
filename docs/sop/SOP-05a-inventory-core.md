# SOP-05a — Inventory Core: Lots, Holds, Recalls, Expiry, Labels and Labs (daily)

| | |
|---|---|
| **Version** | 1.1 (owner answers to Q-05a-1…5 applied; draft for owner review) |
| **Effective** | On owner approval |
| **Owner** | Michael Lyman |
| **Applies to** | Every manager-level login (owner, admin, manager) who looks after cannabis lots once they are received: the daily Issues check, quantity corrections, holds and recalls, expiry dates, tags, testing labs and lot labels. Budtenders read §4.10–§4.11 (what a recall hold and the register's "86" do) and §9. |
| **Verified against** | `main@827facb5` (v1.1; first written at `main@ac251766`, 2026-10-27). The performance merge that came between moved the register files into `src/app/(site)/pos/` and shifted some line numbers. Every reference below was checked again; no behaviour this SOP describes changed. Every label, button, message, number and rule below was read from the code or quoted from the owner. Nothing was written from memory. Where the code and a help panel disagree, this SOP follows the code and records a finding. |
| **Program records** | Findings `F-05a-*` in `docs/sop-program/03-FINDINGS-LEDGER.md` · Gaps `G-19`, `G-22`…`G-28` in `docs/sop-program/05-GAP-REGISTER.md` · Owner decisions D35 (the 05a / 05b split) and D36–D41 (the answers applied in v1.1) in `docs/sop-program/00-OWNER-REQUEST-VERBATIM.md` · Split scope in `docs/sop-program/02-SOP-CATALOG-AND-ROADMAP.md` |

> **This SOP is a living document (owner decision D41).** The owner said: *"We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary."* When any gap named here (Appendix B) is built, this SOP is updated in the same piece of work: the sections the gap names, Appendix B, Appendix D (a new revision row), the finding marked FIXED, and the concierge entry (charter §3 rules 9–10). Until then, the interim procedures in this SOP are the rule.

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

**Why it matters.** The Inventory page describes itself as *"the traceability backbone"*: *"Compliance reports are built on top of this real data, never re-entered."* (`inventory/page.tsx` L436). The weekly CCRS files (SOP-16) are built from these lot rows. A wrong quantity or a wrong status here becomes a wrong state filing there.

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
| **Place** a recall hold (status **Recalled**) | **Manager-level login, with a reason written on form 8.1** (this SOP's control; confirm in Q-05a-7) | The app checks only `inventory.manage`; it writes no audit row and asks for no reason (F-05a-2). The paper log is the record until gap G-22 is built. |
| **Release** a recall hold; notify the LCB | **The admin** (recall coordinator, D37) | Same: the app checks only `inventory.manage`. Form 8.1 and form 8.5 are the record. |
| **Destroy** a lot | Owner, admin, manager through **Returns & Destruction** only | `disposition/page.tsx` L97 (`inventory.manage`). SOP-15. |

**Recall coordinator.** WAC 314-55-225(3)(d) requires a named recall coordinator (§4.13). The owner answered Q-05a-2: *"admin. No back up. Just my manager and I."* (decision D37). So **the admin is the recall coordinator, with no back-up**, and the recall team is **the owner and the manager**. The coordinator decides recall or withdrawal, notifies the LCB, agrees any destruction with the officer and releases holds. This SOP still lets the manager **place** a hold at once, because that only protects customers; the owner is asked to confirm that in **Q-05a-7**.

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
| **Expiration rules** | **Expiration rules** button at the top of Inventory (`inventory/page.tsx` L442) | Best-by dates for lots with no manufacturer date (§4.15) |
| **Tags** | **Tags** button (L446) | Labels shown on menu cards (§4.17) |
| **Testing labs** | **Testing labs** button (L450) | WA labs and the hosts COAs may be read from (§4.18) |
| **Print lot label** | **🏷 Print 4×6 label** on a manifest line (`intake/[id]/page.tsx` L1072–1078), or the address `/admin/inventory/lots/<id>/label` | Reprint a 4×6 lot label (§4.19) |
| **Expiration report** | **Expiration report** button on Expiration rules (`expiration-rules/page.tsx` L284) | Aging buckets, value at risk, 12-month forecast |
| **Returns & Destruction** | Top bar **Inventory → Returns & Destruction** | Destruction and returns (**SOP-15**). The only correct way to destroy a lot (§4.9) |

The green **+ Import vendor JSON** button at the top of Inventory opens **Receiving** (L453–455). That is SOP-04 work.

### 4.2 The Inventory list: tabs, cards, filters and columns

**Page title and help.** **Inventory**, with the subtitle *"Every lot tied to its vendor, brand, COA, and manifest — the traceability backbone…"* (L435–436). The help panel **How inventory lots work** (L457–475) lists four steps. Step 4, *"Vendor JSON intake (next slice) drafts lots + COAs for you to review and accept."* (L465), is out of date: intake has been built for a long time (SOP-04). Its **SOP** link opens the old "publish" sheet (L473). See finding F-05a-12.

**The four cards** (L493–543):

| Card | What it counts |
|---|---|
| **Total lots** | Every lot in the store |
| **Active lots** | Lots with status Active |
| **On-hand cost** | On hand × unit cost. It turns **orange** when some lots have no cost, because those count as $0 and the total is understated (L502–509) |
| **Needs attention** | Recalled + quarantine + expired + expiring soon + no COA + no expiry date. *"Recalls, expiry, quarantine, missing COA"*. The card turns orange for every one of these **except** expiring soon (L528–536; cosmetic, F-05a-14) |

**The three tabs** (`page-tab-sets.ts` L77–85):
- **Lots**: *"Every lot, with filters, sorting and bulk edits."*
- **Issues**: *"Stock the register cannot sell, missing data and crossed compliance limits — each with its fix."* The tab shows a count badge.
- **Insights**: *"Months of supply, shrink, ABC and aging (WAC 314-55-079(10))."* It includes the **Sell first (FEFO)** shortlist (`InventoryIntelPanel.tsx` L199–201).

**The status chips** on the Lots tab: **All**, **Active**, **Quarantine**, **Recalled**, **Sold out**, **Destroyed**, **Leafly** (L92–102). A bare `/admin/inventory` opens on **Active**. To see everything, press **All**. **Leafly** is not a status; it lists lots carrying the LEAFLY badge.

**Filters.** The filter panel under the chips (L667–673) holds multi-select facets, yes/no flags, number ranges and date ranges, with removable chips for whatever is switched on. Every filter lives in the address bar, so a filtered view can be bookmarked or sent to another manager. When the list is filtered to one vendor, a banner says *"Showing only lots from <vendor>."* with **Open vendor page →** and **✕ Clear filter (show all lots)** (L609–626).

**Columns** (L806–852) include COA, potency, lab, COA expiry, received, age, on hand, sold, sell-through, velocity, days of supply, ABC class, last counted, unit cost, extended cost, price, margin, extended retail, website category, onboarded, on menu, expires, compliance, disposition, notes, updated and status.

**Bulk fill missing fields…** appears under the filters when the list has lots (L701–706). See §4.20.

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

1. Open **Inventory → Issues**. If it is clean, it reads: *"Nothing needs attention. No recalls, expired or undated stock, no blocked lots, and no crossed compliance limits (expiry window: 30 days)."* (`inventory/page.tsx` L578–581; window `EXPIRING_SOON_DAYS = 30`, `store.ts` L32). Tick "clean" on form 8.3 and stop.
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
| **N lots active with no unit cost on file (understates on-hand value)** | Worth a look | (L396) | Tell the owner. Nobody keys cannabis cost; it comes only from the manifest (§4.20, D38) |
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
| **Receive (add)** | Do **not** use. **The owner has ordered it removed** (D39, G-23 APPROVED). Stock arrives through Receiving (SOP-04) | *Not sent.* `isReportableAdjustment` skips it (L101–105) | — | **Never.** Adding units by hand puts units on our books that CCRS never hears about (F-05a-7). If units were truly missed at receiving, tell the owner |
| **Shrink** | Units missing with no known cause, found outside a cycle count | Lost | Required by this SOP | Tell the owner the same day if more than 1 unit or any amount above $50 at cost |
| **Damage** | A package broken or unsellable in the store | Lost | Required by this SOP: what broke, how | Keep the damaged product in quarantine for SOP-15 destruction. The adjustment does not destroy it |
| **Sample (lab/QA)** | Units pulled for a lab or QA test | ReturnedLabSample | Required by this SOP: lab and reason | |
| **Employee sample (WAC 314-55-096)** | A vendor trade sample given to a paid employee | Other | **Required by CCRS**: the employee's name. Without it, CCRS withholds the row with error **E13** (`ccrs-inventory-adjustment-core.ts` L201–212; `ccrs-preflight-core.ts` L271) | Prefer the trade-samples screen, which writes the note for you (`trade-samples.ts` L280–300) |
| **Destruction** | Do **not** use. **To be removed** (D39); the lot page will link to Returns & Destruction instead | Destruction | — | **Never.** Destruction is SOP-15, with its hold, method, witness and waste record (F-05a-5) |
| **Cycle-count correction** | Only when the owner tells you to correct a count by hand | Reconciliation | Required by this SOP: which count | Normal count corrections come from the cycle count itself (SOP-06) |
| **Recall removal** | Do **not** use. **To be removed** (D39) | Destruction | — | **Never.** Recalled product may not be destroyed until the LCB is notified and the destruction is coordinated (§4.10). SOP-15 enforces that; this reason does not (F-05a-5) |
| **Other** | Anything else, with owner approval | Other | **Required by CCRS**: a clear sentence. Without it the row is withheld (E13) | Ask the owner first |

**Theft and seizure.** The owner has ordered **Theft** and **Seizure** added to the list (*"Add theft and seizure."*, D39; gap G-23 APPROVED). CCRS already has both reasons, and the app already maps them (`ccrs-inventory-adjustment-core.ts` L87–90). Only the lot page's list is missing them (L118–128; finding F-05a-6). CCRS needs a written detail for **Theft** (`ccrs-preflight-core.ts` L273; `docs/RETURNS_DESTRUCTION_COMPLIANCE.md` §5.5). If product is stolen or seized:
1. Do not adjust anything yet. Follow SOP-20 (incident) and call the owner.
2. The owner decides how it is recorded. **Until G-23 is built**, the only path on this screen is **Other** with a note that begins "THEFT:" or "SEIZURE:", followed by the police or LCB report number. That reaches CCRS as **Other**, not **Theft** or **Seizure**. Write the report number on form 8.2 as well.
3. **When G-23 is built**, choose **Theft** or **Seizure** and type the same note. This paragraph is then rewritten (D41).

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
| Recalled → **Active** | Only when the recall notice (or the LCB) clears this lot, in writing | **Admin** (recall coordinator, D37) | Form 8.1 with the notice reference; the notice copy goes in the binder |
| Active → **Sold out** | Yes, when the lot is physically empty and **On hand** is 0 | Manager | Form 8.1 line |
| Any → **Destroyed** | **No.** Never by hand (§4.9) | — | Use Returns & Destruction (SOP-15) |

**Procedure.**
1. Check the move against the table above. If it is not allowed, stop.
2. Fill in form 8.1 **first**: lot, product, from, to, reason, reference (recall notice, Issues row, COA), your name, time.
3. **Set status** → choose → **Update status**. The page shows **Saved.**
4. Check the **Status** card on the lot page.
5. If you set **Recalled**, continue with §4.10. If you set **Active** from a recall, check the register by scanning the product: it should ring up.

> **Control: every status change is a manager decision written on form 8.1 before the button is pressed; Active from quarantine only from a "now clear" row; Recalled → Active only by the admin (recall coordinator) with the written clearance; Destroyed never by hand.** The Lifecycle status box checks nothing and logs nothing (F-04-2, F-05a-1, F-05a-2; gaps G-19, G-22).

### 4.9 Never "Destroyed" by hand

**What happens if someone does it** (finding F-05a-1, **S1**):
1. The status becomes **Destroyed**, but **On hand stays the same** and **no destruction is recorded** (`store.ts` L836–851).
2. The weekly CCRS Inventory file reads only lots that are **not** Destroyed (`ccrs-batch.ts` L1209–1217). Destroyed lots are added back only when the same week's file carries a destruction event for them (`readDestroyedLots`, L380–391).
3. So the lot **silently disappears from what Greenway reports**, while the state's system still shows its last quantity on hand. No Destruction adjustment is filed, and no waste record exists. That is a traceability error in a state filing.

**What to do instead.** Every destruction goes through **Inventory → Returns & Destruction** (SOP-15). That flow records the hold, the method, the waste record and, for recalls, the LCB coordination. It sets **Destroyed** itself, and **only when the destruction empties the lot** (`disposition.ts` L1087–1095).

**The owner asked: should the Destructions page mark the lot's fields automatically?** (Q-05a-4.) **Yes, and for the most part it already does.** Read in the code at `main@827facb5`:

| Step on Returns & Destruction | What it does to the lot by itself | Where |
|---|---|---|
| **Schedule** a destruction | Sets the lot's status to **Quarantine** (unless it is a single customer-returned unit) and starts the store's hold timer | `disposition.ts` L939–997 (status L965–971; returned unit L716–723) |
| **Complete** it after the hold | Checks the method, the waste mix and, for a recall, the LCB coordination and officer; takes the units off **On hand** in one safe step that cannot go below zero; files the CCRS **Destruction** adjustment; sets **Destroyed** when nothing is left | L999–1098 (`postReduction` L1050, L233–282; Destroyed L1087–1095) |
| **Cancel** it | Sets the lot back to **Active** | L1100–1116 |
| Every step | Writes an audit row | `disposition/actions.ts` L184, L225, L250 |

So nobody should touch **Lifecycle status** or **Adjust quantity** to destroy anything. The owner's decision (D39) is to take **Destruction** and **Recall removal** off the lot page and put a **Schedule destruction** link there instead (gap G-23). Three defects stop the page from handling **recalled** and **quarantined** lots properly. They are recorded as findings and fixed by gap **G-28**:
- **F-05a-17 (S2): the destruction form lists only Active lots.** The page loads `listLots({ status: "active", limit: 500 })` (`disposition/page.tsx` L103). A lot already in **Quarantine** or **Recalled** cannot be picked, which are exactly the lots most likely to be destroyed.
- **F-05a-18 (S1): scheduling overwrites Recalled with Quarantine.** L965–971 writes `quarantine` whatever the status was. The register's recall hold reads only **Recalled** (`recall-hold-core.ts` L44), so the hold on the product is lifted, and the lot no longer shows as recalled anywhere.
- **F-05a-19 (S2): Cancel always sets the lot to Active** (L1113–1114), even if it was Quarantine or Recalled before. Cancelling a recalled lot's destruction would put recalled product back on sale.

**Interim, until G-28 is built:**
1. **Never cancel** a scheduled destruction without the owner. If one must be cancelled, the manager sets the lot straight back to its earlier status (**Quarantine**, or **Recalled** by the admin) with a form 8.1 line, the same minute.
2. **A lot in Quarantine** (for example damaged or expired) that has to be destroyed: the owner decides. The app cannot select it. Do **not** set it Active to make it selectable unless the owner says so, the product is in the sealed quarantine bin, and the scheduling is done in the same sitting; write every step on form 8.1.
3. **A Recalled lot: do not use the app to destroy it.** Keep it **Recalled** and in the sealed bin. The admin (coordinator) agrees the destruction with the LCB officer, the destruction is done and witnessed as the officer directs, and it is written on form 8.5 and the SOP-15 paper waste record. The admin and the owner then decide how the app is brought into line (Q-05a-8). Setting a recalled lot to Active even for a minute lifts the hold and can put it on sale.

**If you find a lot set to Destroyed by hand** (status Destroyed, On hand above 0, nothing in Returns & Destruction):
1. Do **not** change it back yourself.
2. Write it on form 8.1 (lot, on hand, when found) and tell the owner the same day.
3. The owner decides, with SOP-15 and SOP-16, how to record what really happened to the product.

> **Control: a lot becomes Destroyed only through Returns & Destruction; recalled lots are never moved out of Recalled to be destroyed.** The manual path skips the destruction record and drops the lot from the CCRS Inventory file with units still on hand (F-05a-1, S1; gap G-22). The Destructions page does the lot changes itself, but cannot yet pick a held lot and overwrites Recalled (F-05a-17…19; gap G-28).

# Part 3: Recalls, the 86 and restore to sale

### 4.10 Placing and releasing a recall hold

**What a recall hold is in this app.** It is not a separate screen. A lot is "on recall hold" when its **Lifecycle status** is **Recalled** (`HOLD_LOT_STATUS = "recalled"`, `src/lib/pos/recall-hold-core.ts` L44). Every product key that has at least one Recalled lot is held (`buildRecallHoldIndex`, L53–63; read by `recalledProductKeys`, `recall-hold-store.ts` L72–121). Routine **Quarantine** lots do **not** trip the hold (`completion-gate.ts` L98–100).

**What the law requires** (WAC 314-55-225, read 2026-10-27 at app.leg.wa.gov):
- **Recall** (a risk to consumers, for example pesticides or residual solvents above action levels, (3)(a)): *"Immediately notify the local LCB enforcement officer"* and *"Secure, isolate, and prevent the distribution"* of all product that may have been exposed. The licensee *"is prohibited from destroying any affected product prior to notifying the LCB and coordinating with the local LCB officer on destruction activities."* ((3)(b)(i)(A)–(B))
- **Market withdrawal** (no risk to consumers, for example aesthetics or packaging, (2)(a)): *"notify the LCB by contacting the local LCB enforcement officer assigned to the local area within 48 hours of beginning the market withdrawal."* ((2)(b))
- **Tracking.** An affected licensee *"must track the total amount of affected product and the amount of affected product returned"*, and report progress to the LCB at least once a week ((3)(f)).
- **Destruction** of recalled product is coordinated with, and may be overseen by, LCB enforcement ((3)(e)).

**Recall or withdrawal: who decides.** The **recall coordinator** (the **admin**, D37, §2) decides which one it is. A manager who is unsure treats it as a **recall** and calls the admin.

**Procedure: placing a recall hold** (manager, the moment a recall notice, a vendor notice, an LCB call or a failed-safety finding arrives):
1. **Open form 8.5** (recall event worksheet). Write who told you, when, how, and the product, vendor, lot or batch numbers and recall reference exactly as given.
2. **Find every affected lot.** Inventory → type into the search box (*"Product, lot code, POS key, vendor, brand, strain, notes…"*, `InventoryFilterPanel.tsx` L345): the product, the vendor, and each lot number. Use the **All** status tab, so sold-out and quarantined lots also show. List each lot on form 8.5 with its **On hand**.
3. **Set each affected lot to Recalled.** For each lot: write a form 8.1 line first, then **Lifecycle status → Set status → Recalled → Update status** (§4.8). The page shows **Saved.**
4. **Pull the product physically.** Remove every unit from the sales floor, the display cases and the vault shelf. Put it in a sealed bin or bag marked **"RECALL — DO NOT SELL — <product> — <date>"**, in the quarantine area. Count it; the count must match **On hand**. Write the count on form 8.5. Any difference is reported to the admin and the owner the same hour.
5. **Hide it from the website as well** (finding F-05a-16, below). Open **Product Intake → Product Enrichment** (`admin-nav-data.ts` L77), open the product, set **Visibility** to **Always hide**, type the reason (for example "RECALL 2026-10-27") in **Reason if hidden**, and press **Save enrichment** (`products/[key]/page.tsx` L1054–1074; `products/actions.ts` L205–211, L255–270, audited `product.visibility_changed`). The recall hold alone does not stop online reservations.
6. **Check the register.** Scan or search the product at a register (download the menu first: a register that has not refreshed may still show it). It should not appear. If it is still listed after a refresh, stop the register from selling it by word of mouth and call the admin (§4.11 explains why the sale would still be refused at completion).
7. **Check open orders.** Open **Online Orders** (`admin-nav-data.ts` L53) and look for pending pickup orders that hold the product. Call those customers, tell them the item is unavailable, and remove it at pickup. (The pickup cannot be completed with it in the order, §4.11.)
8. **Notify.** The **recall coordinator** notifies the LCB: immediately for a **recall**, within **48 hours** for a **market withdrawal**. Write the officer's name, the time and the method on form 8.5. There is no back-up coordinator (D37). If the admin cannot be reached within 1 hour of a **recall**, the manager calls the owner, and the owner decides who makes the call; write that on form 8.5.
9. **Do not destroy anything.** Recalled product stays in the bin until the coordinator has notified the LCB and agreed the destruction with the officer. When the app is fixed (gap G-28), destruction will run through **Returns & Destruction** (SOP-15), which refuses a recall destruction until **LCB coordination** is confirmed and the **officer is named**: *"RECALL product: destruction is prohibited until LCB has been notified and destruction is coordinated with your enforcement officer (WAC 314-55-225). Confirm coordination first."* and *"Record the LCB enforcement officer you coordinated with."* (`disposition-core.ts` L226–243). **Today that page cannot pick a Recalled lot, and scheduling would lift the hold** (F-05a-17, F-05a-18). Follow the interim in §4.9 point 3: the lot stays **Recalled**, and the destruction is recorded on form 8.5 and the SOP-15 paper waste record. Never use the **Recall removal** adjustment reason (§4.7), and never set **Destroyed** by hand (§4.9).
10. **Track weekly.** Each week while the recall is open, write on form 8.5 the units held, returned, destroyed and sold before the hold, and the date the progress was reported to the LCB ((3)(f)).

**Procedure: releasing a recall hold** (**admin** only, as recall coordinator, D37):
1. Release only on **written** clearance: the recall notice withdrawn, the vendor's written clearance for these lots, or the LCB's release. Put the copy in the compliance binder.
2. Write a form 8.1 line: lot, Recalled → Active, the clearance reference, your name, time.
3. **Lifecycle status → Active → Update status** on each cleared lot. Lots that will be destroyed or returned are **not** set Active. They stay Recalled until they are destroyed or returned (§4.9 point 3).
4. Set **Visibility** back to **Inherit POS** (or **Always show**) on Product Enrichment if you hid it in step 5 above.
5. Scan the product at a register to confirm it rings up again. Close form 8.5 with the date and a one-line outcome.

**What the app does not record** (findings F-05a-2, F-05a-15): placing or lifting **Recalled** writes **no audit row**, asks for **no reason**, and the release is open to any manager-level login (§4.8), although only the admin may use it (D37). The app has no recall-plan record and no recall-coordinator field (the only mention is `docs/RETURNS_DESTRUCTION_COMPLIANCE.md` L136). Forms 8.1, 8.4 and 8.5 are the record until gaps **G-22** and **G-25** are built.

**Finding F-05a-16 (S2): a recall hold does not reach the website or online ordering.** The public menu filters out only **hidden** cards (`src/lib/pos/live-menu.ts` L167–171, L289–292). Online order pricing skips only hidden cards (`src/lib/orders/order-pricing.ts` L124–134). Neither reads lot status: `recalledProductKeys` has exactly four callers, the register menu route, the completion gate, restore to sale and the sellability report (`api/pos/menu/route.ts` L121; `completion-gate.ts` L103; `restore-to-sale-store.ts` L131; `register-sellability-store.ts` L175). A customer can still see a recalled product on the website and **reserve** it for pickup. The sale is refused only when staff try to complete the pickup (§4.11). Step 5 above (**Always hide**) is the interim control. It hides every size of the product, so if only one size of a mastered product is recalled, ask the owner before hiding.

> **Control: a recall is placed by a manager, on form 8.1 and form 8.5, the same hour the notice arrives; the product is physically segregated and counted; the website card is hidden; the LCB is notified (immediately for a recall, 48 hours for a withdrawal); nothing is destroyed before LCB coordination; only the admin (recall coordinator) releases a hold, on written clearance.** The app's hold stops register sales but writes no record, does not reach the website, and is lifted if the lot is scheduled for destruction (F-05a-2, F-05a-15, F-05a-16, F-05a-18; gaps G-22, G-25, G-28).

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

**What is an "86"?** (the owner asked, Q-05a-5.) It is old restaurant and bar slang for **"take it off the menu, we're out of it."** When a cook says "86 the salmon," nobody can order the salmon until it is back. At Greenway, an 86 means a budtender has told every register and the website **"don't offer this product right now."** It does not change any count, any lot or anything sent to the state. It only hides the product from sale. The register calls it **"Mark out of stock"**; this SOP calls it the 86 because that is what the code and the restaurant software it copies call it (`stock-flag-core.ts` L4 names Toast's *"Quick Edit / 86 it"*).

**The 86 (register).** On a product's detail sheet at the register there is a small link **"Shelf is empty? Mark out of stock…"** (`src/app/(site)/pos/SaleFlow.tsx` L4266–4276). Pressing it asks:

> *"Remove <product> from every register and the website? Pick why — a manager brings it back through the back office when stock returns."* (L4279–4280)

The reasons are buttons: **shelf empty**, **damaged / unsellable**, **wrong listing**, and **Cancel** (`stock-flag-core.ts` L32; free text is deliberately not allowed, L31). It is not offered on keypad (custom) lines (`canFlagOutOfStock`, L79–81).

**What it does.** The register calls `/api/pos/stock-flag`. The route checks the device (L28–34), sets the product's published menu card to **unavailable** (L77–83) and writes an audit row `pos.stock_flag` with the device, the register, the reason and the name the register sent (L85–102). The name is supplied by the register, not checked by the server (L48–52). It changes **only the menu card**. It does **not** change any lot, quantity or status, and nothing is reported to CCRS.

**When a budtender uses it.** Only when a product shows on the menu but there is truly none on the shelf or in the back stock, or the listing is plainly wrong. Tell the manager right after. Never use it for a recall. A recall is a lot status set by a manager (§4.10), and the 86 can come undone on its own (next paragraph).

**Finding F-05a-9 (S3): the 86 does not stick while stock is on file.** Every time a register downloads the menu, the reconciler checks each unavailable card against live **Active** lots. If units are on hand, the card is put back on sale automatically: *"Restored to the register: inventory shows N units on hand in active lots, but the published menu still had it marked unavailable."* (`register-availability-core.ts` L318–421, message L389; called at `api/pos/menu/route.ts` L240). So an 86 on a product the system thinks it still has, for example **damaged / unsellable** with units still on the lot, reappears at the next menu download. The register's own prompt says a manager brings it back. The code brings it back without one.

**The owner's decision: the professional method** (D40: *"Do the enterprise grade solution, the professional method."*; gap **G-26 APPROVED**). An 86 is treated as an **exception with an owner and a cause**, the same discipline as a quarantine or a recall, not as an on/off switch. When G-26 is built:
1. **The reason decides how it comes back.** **Shelf empty** clears by itself only when **new stock is received** for that product. If the books still show units, that is a counting difference: it becomes a **count task** (SOP-06), and the item stays off until the count is done. **Damaged / unsellable** and **wrong listing** never clear on their own; a manager clears them after the product is dealt with (SOP-15) or the listing is fixed (SOP-05b).
2. **One queue.** Every open 86 is listed on **Inventory → Issues** with who pressed it, when and why. The manager works the list every shift.
3. **A restore needs a manager and a reason,** and is audited, as **Restore to sale** already is (`restore-to-sale-store.ts` L166–172).
4. **It reaches the website and online ordering.** The register 86 already does this today (`api/pos/stock-flag/route.ts` L77–83).

Point 1 is what is missing today (F-05a-9, below). **Until G-26 is built, the manager does points 1–3 by hand**, as follows. When it is built, this section is rewritten (D41).

**What the manager does when an item is 86'd** (same shift):
1. Find the reason. Check the shelf, the back stock and the lot's **On hand**.
2. **Shelf truly empty, On hand above zero:** the count is wrong. Do not adjust by hand on a guess. Count it (SOP-06 cycle count, or §4.6 with form 8.2 if the owner approves). Until the count is fixed, the item will keep coming back at the register.
3. **Damaged or unsellable:** move the units to quarantine, set the lot to **Quarantine** with a form 8.1 line (§4.8), and handle it under SOP-15. Quarantine takes the lot out of the live count, so the card stays unavailable.
4. **Wrong listing:** tell the owner. Menu listings are SOP-05b.
5. **Stock is really there** (someone 86'd it by mistake, or it was restocked): use **Restore to sale** below.

**Restore to sale (back office).** On **Inventory → Issues**, the panel **Marked unavailable, but you have stock** appears only when a product is flagged unavailable while Active lot units sit behind it (`RegisterSellabilityBanner.tsx` L142–188; placed at `inventory/page.tsx` L590–592). Its text: *"Someone pressed "86" on these at a register, or they were emptied and then restocked. They are on the shelf now. Restoring recomputes each one from its live lot count, so it can only clear a stale flag — it can never invent stock."* (L154–158). Each row shows the product and **N units on hand**, with the button **Restore to sale → <status>** (L180).

**Procedure: Restore to sale** (manager):
1. Look at the shelf. Restore only when the product is physically there and sellable.
2. Press **Restore to sale → …**. The server rechecks everything (`actions.ts` L1174–1198 → `restore-to-sale-store.ts`). It refuses if the product is under a recall hold (that check fails closed, `restore-to-sale-store.ts` L125–140), if the card is hidden, or if no Active lot holds stock (`restore-to-sale-core.ts` L115–158). The status it sets is computed from live units: **0 or less → unavailable, 1–3 → low-stock, more than 3 → in-stock** (`statusForUnits`, `register-availability-core.ts` L141–145).
3. Read the banner at the top of Inventory. Success: *"<product> is back on sale (N units on hand — <status>)."* (`restore-to-sale-core.ts` L167). The restore writes an audit row `inventory.restore_to_sale` with the old and new status (`restore-to-sale-store.ts` L166–172) and refreshes the website.
4. A refusal (§5.3) tells you what is wrong. Fix that; do not try to work around it.

> **Control: the 86 is a register shortcut, not a stock record. The manager investigates every 86 the same shift, fixes the cause (count, quarantine or listing), and restores only product that is physically on the shelf.** The 86 is audited (`pos.stock_flag`) but comes back on its own while units are on file (F-05a-9; gap G-26, APPROVED by the owner as the professional method, D40).

### 4.13 The written recall plan (WAC 314-55-225)

**The law.** *"All licensees must develop a recall plan"* setting the procedures the licensee will follow in a recall of product under its control. At a minimum it must include ((3)(d)(i)):
- **(A)** *"Designation of a member of the licensee's staff who serves as the licensee's recall coordinator"*;
- **(B)** *"Procedures for identifying and isolating product to prevent or minimize its distribution to consumers"*;
- **(C)** *"Procedures to retrieve and destroy product"*; and
- **(D)** *"A communications plan to notify those affected by the recall"*, including how other licensees in possession are told and the use of press releases or other notices when product reached consumers.

A recall *"must follow the procedures outlined in the recall plan unless otherwise agreed by the LCB and the licensee."* ((3)(d)(ii))

**What the app has.** No recall plan, no coordinator field and no recall log (finding F-05a-15, **S2**; gap G-25). It has the pieces a plan points to: the **Recalled** status and its register hold (§4.10–§4.11) and the recall-destruction block in Returns & Destruction (SOP-15).

**What Greenway does.** **Form 8.4** in §8 is the recall plan, written to (A)–(D) and built on this SOP:
- (A) **Recall coordinator**: **the admin**, named on the form. The owner decided there is **no back-up**; the recall team is the owner and the manager (D37).
- (B) **Identify and isolate**: §4.10 steps 1–7.
- (C) **Retrieve and destroy**: §4.10 steps 8–10 and SOP-15. Greenway is a retailer. It does not sell to other licensees, so "retrieve" means customer returns brought back to the store (SOP-15 customer returns) and the product held in the bin.
- (D) **Communications**: who calls the LCB officer, the vendor, and the customers with open orders, and who approves any public notice. Only the owner speaks to the press or posts publicly.

**Procedure.**
1. The owner fills in form 8.4, signs and dates it, and files it in the compliance binder. Staff sign that they have read it.
2. Review it **every year** and whenever the coordinator (the admin), the LCB officer's contact or this SOP changes. Write the review date on the form.
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

**Finding F-05a-8 (S2): the only stop on selling expired product is a person reading the Issues tab.** The register will sell an expired Active lot. The Issues tab says *"Expired product may not be sold."* (`issues-core.ts` L388, L460), a rule the code itself says the state does not impose (§4.14). Its fix text, *"Open the lot and change its status (or record the destruction under Adjust quantity)."* (L461), points to the manual destruction reason this SOP forbids (§4.7, §4.9). **The owner's decision** (Q-05a-1, D36): *"hard block edibles and liquid edibles, warnings for everything else."* Gap **G-24** is **APPROVED**: when built, the register **refuses** an expired **Solid Edible** or **Liquid Edible** lot, with no override, and **warns** on every other expired lot. The CCRS inventory types are **Solid Edible** and **Liquid Edible** (`ccrs-batch-core.ts` L250, L253). Whether **Tincture**, **Capsule** and other ingestibles count as "edibles" is question **Q-05a-6**; the sales-limit code already treats tinctures as liquid edibles (`sales-limits-core.ts` L364–366).

**Until G-24 is built, this paper rule follows the owner's decision:**
1. Every morning (§4.4), for each **Expired and still active** row, open the lot and read its **LCB classification** (lot page, `[id]/page.tsx` L568–569).
2. **Solid Edible, Liquid Edible, and (until Q-05a-6 is answered) Tincture and Capsule: never sell. Hard stop.** Pull every unit from the shelf, put them in quarantine, and set the lot to **Quarantine** with a form 8.1 line that reads "EXPIRED EDIBLE <date>" (§4.8). Quarantine takes the lot off the register's live count. Tell the owner. The owner decides: return to the vendor or destroy (both **SOP-15**). No one may put it back on sale.
3. **Everything else (flower, pre-rolls, vapes, concentrates, topicals and the rest): a warning.** Check the product (sealed, looks and smells right). Write it on form 8.1 as "EXPIRED <date> — checked, on sale" or "EXPIRED <date> — pulled". Tell the owner the same morning; **the owner decides** whether it stays on sale. If in doubt, pull and quarantine it until the owner answers. Budtenders tell the customer the date before the sale.
4. **Never** use **Adjust quantity → Destruction**, whatever the Issues text says (§4.7, §4.9).

When G-24 is built, this list is replaced by the register's own block and warning (D41).

**Expiring soon (30 days).** The **Worth a look** row *"N lots expiring within 30 days"* says: *"These lots expire soon. Sell them first (First-Expired, First-Out) or plan a markdown."* (`issues-core.ts` L392; window `EXPIRY_SOON_DAYS = 30`, `expiry-rules-core.ts` L52, equal to `EXPIRING_SOON_DAYS`, `store.ts` L32).
1. Open **Inventory → Insights → Sell first (FEFO)** (`InventoryIntelPanel.tsx` L199–201) for the ranked list.
2. Move those units to the front of the shelf and tell the budtenders.
3. Because the register draws the **oldest received** lot first, not the soonest-expiring, two lots of one product with different dates can sell out of order. Where possible, keep only one lot of a product on the floor at a time, and put the soonest-expiring one out first.
4. A markdown is a pricing decision for the owner (sell price: SOP-05b).

**The Expiration report** (**Reports → Expiration** tab, `ReportTabs.tsx` L22, or the **Expiration report** button; any role with `reports.view`, including read-only, `reports/expiration/page.tsx` L151). Its sections: **Aging - lots**, **Aging - value** (uncosted lots count as $0), **12-month forecast** (value reaching its date each month), **Where dates come from**, **Coverage gaps** (categories with stock and no date), **By category** and **Rule usage** (L229–277). Most sections export. The owner reviews it monthly (form 8.3, monthly line).

> **Control: every expired Active lot is checked and logged the morning it appears; expired edibles and liquid edibles are pulled and quarantined; expiring-soon stock goes to the front of the shelf; the owner reviews the Expiration report monthly.** Expired edibles and liquid edibles are never sold; other expired lots only with the owner's decision (D36). The register does not yet block or warn, and draws oldest-received first (F-05a-8; gap G-24 APPROVED).

# Part 5: Tags, labs, labels and corrections

### 4.17 Tags (New, Staff Pick and your own)

**Where:** **Inventory → Tags** (`/admin/inventory/tags`; owner, admin, manager, `tags/page.tsx` L85). **What it is:** *"Label products on the website menu (New, Staff Pick, Local ...). Shoppers see the tags on product cards and can filter by them. The New tag is automatic."* (L130–131). Tags are a **website** feature. They change nothing about the lot, the price or CCRS. Header buttons: **View the menu**, **Back to inventory**.

**The built-in New tag.** A product shows **New** for **14 days** from the first time it appeared on a published menu, then it comes off by itself (`DEFAULT_NEW_WINDOW_DAYS = 14`, `src/lib/menu/product-tags-core.ts` L28; the window can be 1–365 days, L29). It can be renamed, recoloured or turned off, but **not deleted** (`tags/page.tsx` L252–256). Its row shows **Show "New" for (days)**. The card **Showing "New" right now (N)** lists every product inside the window with its end date.

**Procedure: create a tag** (manager, with owner approval for any tag shoppers will see):
1. Under **Create a tag**: **Name** (up to 32 characters, L30), a colour, **Order** (lower shows first) and **Show on the website** (untick it for a staff-only label). Press **Create tag**. A card shows **up to 3 tags** (`MAX_TAGS_ON_CARD = 3`, L31).
2. The green banner says *"Created "<name>". The website menu updates on the next page load."*

**Procedure: put a tag on products, or take it off:**
1. Under **Add or remove products**: choose the **Tag**, type in **Search the live menu** (*"name, brand, strain, category"*), press **Show products**. Or press **Add / remove products** on the tag's row.
2. Tick the products. Press **Apply "<tag>" to ticked** or **Remove from ticked**. Products already carrying the tag by hand are marked. Hand-added products under **New** keep it until removed, *"on top of the automatic window"*.
3. Products tagged by hand are listed below with boxes; tick and press **Remove ticked** to take it off.

**Procedure: change or delete a tag.** On the tag's row, edit and press **Save**, or untick **On** to turn it off everywhere. To delete: tick **Yes, delete**, then press **Delete tag**. Without the tick, nothing happens and you see *"Tick "Yes, delete" to delete a tag."* (`tags/actions.ts` L111). Deleting removes it from every product: *"Deleted "<name>" and removed it from every product."*

**Rules.** Never use a tag to say anything a WA advertising rule would not allow (health claims, appeal to minors). SOP-11 covers marketing content. Every tag change is audited (`product_tag.created|updated|deleted|applied|removed`, `tags/actions.ts` L62, L98, L117, L146).

### 4.18 Testing labs and certificate hosts

**Where:** **Inventory → Testing labs** (`/admin/inventory/labs`; owner, admin, manager, `labs/page.tsx` L156). **What it is:** *"Every Washington cannabis testing lab, and the web hosts their certificates (COAs) are read from. The certificate reader only opens links from these hosts."* The list is copied from the WSLCB lab lists (header L7–12). The host list is a **security allow-list**: the app downloads certificates only from these hosts.

**When to use it.** Only when receiving or a COA re-read fails because a vendor's COA link comes from a host the reader will not open (SOP-04), or a newly certified lab is missing.

**Procedure: add a certificate host to a lab:**
1. Check the host is the lab's own or a well-known COA host. If unsure, ask the owner. **Never** add a host just because a link "won't open".
2. In the lab's row, paste the host or a certificate link in *"host or a certificate link"* and press **Add**. Banner: *"<host> added. Certificate links from it are read on the next COA pass (press Read COA again on the delivery)."*
3. Return to the delivery or lot and read the COA again.
4. Owner-added hosts must be a public https web host. The app checks every address before it downloads (**Always-allowed certificate hosts** card). To take one away, press **Remove** beside it.

**Procedure: add a lab.** Press **Add a lab** (top) → **Name (required)**, **WSLCB / WSDA lab # (optional)**, **City**, **Phone**, **Website**, **Notes** → **Add lab**. Then add its host (above). Banner: *"Added <lab>. Add the host its certificate links come from so the reader will open them."*

Every change is audited (`testing_lab.add`, `testing_lab.host_added`, `testing_lab.host_removed`; `labs/actions.ts` L49, L68).

### 4.19 Printing or reprinting a lot label

**What it is.** A 4×6 reprint label for one lot, for the Rollo printer: store name, product, lot code, on hand, **Expires** or **Best by** (§4.14), vendor, and a Code 128 barcode. It is a **reprint view**: *"nothing here touches CCRS or inventory counts"* (`lots/[id]/label/page.tsx` L1–11; owner, admin, manager, L33).

**Where it is (finding F-05a-10).** The only link to it is **🏷 Print 4×6 label** on the **receiving manifest** page, one per lot (`intake/[id]/page.tsx` L1072–1078). The lot page has **no** print-label link. To reprint a label for a lot:
1. Open the lot page and click its **Manifest** link, then **🏷 Print 4×6 label** on that lot's row; **or**
2. Change the address of the lot page from `/admin/inventory/<lot id>` to `/admin/inventory/lots/<lot id>/label`.

**Procedure:**
1. On the label page (**Print lot label** — *"4×6 label for the Rollo. Press Print, choose the Rollo, confirm 4×6."*), press **🖨 Print label** (`LabelPrintControls.tsx` L25–32).
2. In the print dialog choose the Rollo and confirm 4×6.
3. **Scan the printed label at a register before using it.** The barcode is the **lot code**, or, if the lot has none, the **POS product key**, or else the lot's internal id (L38–40). The register finds a product only by **lot code** or **CCRS id** (`buildBarcodeIndex`, `src/lib/pos/scan-to-cart-core.ts` L55–70). So a label printed from a lot with no lot code **will not scan**; the register treats it as a search. Tell the owner (F-05a-10) and fix the lot's lot code through receiving, not by hand.
4. Use **← Back to lot** to return.

**Rules.** A reprint label is for the store's shelf and back stock. It never replaces the vendor's compliance label on a package (WAC 314-55-105). If a package's own label is damaged, quarantine it (§4.8) and tell the owner.

### 4.20 Bulk fill (Cultivera-import lots only)

**What it is.** A way to fill blank fields on many lots at once, **only** on lots from the one-time Cultivera / POS import, and **only** where the field is blank. Panel title: **Bulk fill — complete what the Cultivera import left blank**. *"It can only turn a blank into a value, only on lots from that one-time import, and it never overwrites a value that is already there."* (`BulkFillPanel.tsx` L113–122; migration test `isMigrationLot`, `bulk-fill-core.ts` L49, L107.)

**The three fields** (`bulk-fill-core.ts` L318–325; hints `BulkFillPanel.tsx` L62–80):
- **Expiration date**: *"Read the expiration date off the physical package or the COA."* Saved as **Typed by owner** (`actions.ts` L986).
- **Unit cost**: *"Read the unit cost off the vendor invoice. Dollars — stored to the cent."* **Never used for cannabis** (owner rule D38, below).
- **POS product key**: *"The catalog key that links this lot to a product."*

**Who.** The button is open to managers (`actions.ts` L904, `inventory.manage`). But the permission table says *"Cannabis cost entry is NOT built"* and gives cost entry only to owner and admin, for non-cannabis (`roles.ts` L143–148). Bulk fill **Unit cost** therefore lets anyone with Inventory access key a **cannabis** cost.

**The owner's rule** (Q-05a-3, D38): *"absolutely not. That's illegal. Cost comes from the state CCRS manifest created by the vendor."* **Nobody, the owner included, ever types a cannabis unit cost.** The cost of a cannabis lot comes only from the vendor's CCRS manifest: receiving reads it from the manifest line (line price ÷ quantity, `intake-parser.ts` L415–420), and the lot page locks it (`lot-edit-core.ts` L33–45, `unit_cost_minor_units` at L38). Bulk fill is the one place it can still be typed (`bulk-fill-core.ts` L54). Finding **F-05a-11** is re-rated **S1** at the owner's direction, and gap **G-27** (APPROVED) removes **Unit cost** from Bulk fill for cannabis lots.
- **Never** choose **Unit cost** in Bulk fill. A cannabis lot with no cost stays blank and goes to the owner, who has it corrected **from the manifest** (SOP-04), never typed.
- Managers may use **Expiration date** (from the package or COA) and **POS product key** (from Product Onboarding).
- Non-cannabis cost is a different screen and a different rule (owner and admin, `inventory.cost.fill`; SOP-05b).

**Procedure:**
1. Filter the list to the lots to fill. The easiest way is from the Issues tab: **Bulk fill the Cultivera-import lots** or a gap row, which opens the list already filtered.
2. Press **Bulk fill missing fields…** under the filters (`inventory/page.tsx` L701–706). The panel uses **every lot the current filters show**.
3. Choose **Field**, type **Value**, press **Preview fill for N lots**.
4. Read **Review before saving — <field> on N lots**: *"Nothing has been saved yet."* It says how many will be set and how many will be skipped (*"they already have a value, are not from the one-time Cultivera import, or are destroyed. Those are protected and will not be changed."*).
5. **Check the value applies to every one of those lots.** One value goes to all of them. An expiry date or a cost is rarely the same across many lots; filter tighter (one vendor, one product) until it is.
6. Press **Save N changes**, or **Cancel**. Result: *"Filled N lots."* plus any skipped or failed counts. Audited `inventory_lot.bulk_filled` (`actions.ts` L975–996). **Exit bulk fill** closes the panel.

> **Control: bulk fill one value only across lots that truly share it, read from the package, COA or invoice; never a cannabis unit cost: cannabis cost comes only from the vendor's CCRS manifest (D38).** The tool can only fill blanks on import lots, and it is audited (F-05a-11, S1; gap G-27).

### 4.21 Correcting a lot: received date, details, product link, lab result, re-reading the COA

Each of these is on the lot page. All are manager-level and audited. None of them changes quantity, status, lot code or cost.

| What | Where on the lot page | How | Audit |
|---|---|---|---|
| **Received date**: the date reported to CCRS as the inventory date | **Received date** (L439–475) | **Date received**: *"Use the date on the vendor manifest or invoice."* Not before the WA floor date and not in the future. Press **Save received date** / **Update received date**. A lot with no date says *"No received date on file… CCRS reporting falls back to the day this lot was imported…"* | `inventory_lot.received_date_set` (`actions.ts` L198) |
| **Vendor, brand, strain, strain type** | **Correct lot details** (L806–868) | Pick from the lists; press **Save corrections**. *"Everything else on this lot (quantities, lot code, cost, LCB classification, dates, COA) is compliance data and can only change through receiving or an audited adjustment."* If the website shows a different strain type, a box offers **Send <type> to the website** | `inventory_lot.details_edited` (L371) |
| **Product link** (the POS product key the register and menu use) | **Product link** (`LotLinkPanels.tsx` L55–140) | Only when **Not linked**. Use a suggested **Link to <key>** button, or type **POS product key** and press **Link product**. Not sure: **Find it in Product Onboarding**. A linked lot cannot be re-pointed here | `inventory_lot.product_linked` (L250) |
| **Lab result (COA)** | **Attach a lab result** (`LotLinkPanels.tsx` L150–220; lot page L763) | Type the **Lab test ID** from the COA, press **Find lab result**, check the facts and **Result**, press **Attach this lab result**. Only fills an empty link | `inventory_lot.coa_linked` (L294) |
| **Re-read the COA** | Lab certificate panel → **Re-read lab certificate** (`LabCertificatePanels.tsx` L54) | Reads the lot's lab JSON and COA PDF again. Can take up to about 90 seconds (`[id]/page.tsx` L96). Wait for the banner | `inventory_lot.coa_reread` (L1247) |

**Rules.**
- Use the received date from the **vendor manifest or invoice** only. Never guess it.
- **Never attach a lab result whose result is FAILED to an Active lot.** Quarantine the lot and follow SOP-04 §4.19 / SOP-15.
- The **sell price** (**Correct the sell price**, L1022), **Which size is this lot?** and **Website type & category** are SOP-05b.

### 4.22 Low stock and oversold sales (pointers)

**Low stock at the register.** A product with **3 or fewer** units shows as **low-stock** (`statusForUnits`, `register-availability-core.ts` L141–145). The register's low-stock flag is a **warning only, never a block**: *"the register informs, the human decides."* (`src/lib/pos/low-stock-core.ts` L18–21). When a budtender sees it, they tell the manager. Reordering is **SOP-09**.

**Oversold sales.** When a sale takes more units than a lot had on file, the sale still completes and an **OVERSOLD** note is recorded. The list is on **Inventory → Cycle Counts** (`cycle-counts/page.tsx` L70, L96). An oversold product means the count is wrong: count it under **SOP-06**. Never "fix" it with **Receive (add)** (§4.7).

---

## 5. Messages: "If you see this message"

Every message below was read from the code at `main@ac251766`. Messages in *italics* are word for word. `<...>` marks a value the screen fills in.

### 5.1 Lot page (top banner)

The green or red banner at the top of the lot page (`src/app/admin/inventory/[id]/page.tsx` L385–401).

| Message | Cause | Do this |
|---|---|---|
| *"Saved."* | The last button worked | Check the card or section you changed |
| *"Saved."* followed by a sentence about the menu | **Record adjustment** worked, but the menu stock for this lot's size could not follow (`actions.ts` L135–138; `src/lib/inventory/store.ts` L615) | Read the sentence. If it says the menu did not move, tell the owner (§4.6 step 4) |
| *"Enter a non-zero quantity."* | **Quantity change** was blank or 0 (`actions.ts` L120) | Type the difference, negative to remove |
| *"Choose a valid reason."* | No reason picked (L123) | Pick a reason from §4.7 |
| *"Choose a valid status."* | No status picked (L146) | Pick one allowed by the §4.8 table |
| *"Something went wrong saving that."* | The save failed (L133, L152) | Reload the lot and check **On hand** / **Status** before trying again. **Never press Record adjustment twice without checking**: the first may have saved. Twice → owner |
| *"That lot no longer exists."* | The lot was removed or the link is old (L184, L234, L279, L331) | Go back to the Inventory list and search for it |
| *"Enter the received date as YYYY-MM-DD (for example 2026-08-14)."* | Wrong date format (`received-date-core.ts` L171) | Retype |
| *"<date> isn't a real calendar date — check the month and day."* | For example 2026-02-30 (L174) | Retype from the manifest |
| *"The received date can't be in the future. Today is <date> in Port Orchard."* | A future date (L176–180) | Check the manifest |
| *"<date> is before Washington retail cannabis sales began (<floor date>). Check the year — that looks like a typo."* | A date before the WA floor date (L182–188) | Check the year |
| *"That vendor isn't in the vendors database — pick one from the list."* | **Correct lot details** (`actions.ts` L340) | Pick from the list; a new vendor is added under Vendors first |
| *"That brand isn't in the brands database — pick one from the list."* | (L343) | Pick from the list |
| *"That brand belongs to a different vendor. Pick the brand's own vendor, or clear the brand."* | (L346) | Fix the pair |
| *"This lot is already linked to a product. Linking only fills an empty key; it never re-points one."* | **Product link** on a lot that already has one (`lot-link-core.ts` L75) | Leave it. A wrong link → owner |
| *"This lot already has a lab result linked. Attaching only fills an empty link; it never replaces a COA."* | **Attach a lab result** on a lot with one (L77) | Leave it. A wrong COA → owner |
| *"This lot is destroyed and out of inventory, so it cannot be linked."* | (L73) | Nothing to do |
| *"No published menu card, menu size or Product Onboarding draft uses that product key. Check the key, or onboard the product first."* | The typed key does not exist (L173) | Check the key in Product Onboarding |
| *"That product key is only on a dismissed Product Onboarding draft. Restore the draft in Product Onboarding first, then link the lot."* | (L167) | Restore the draft first (SOP-04 §4.22) |
| *"That lab result no longer exists. Search again."* | (`actions.ts` L285) | Search by **Lab test ID** again |

**Re-read lab certificate** banners (`coa-panel-core.ts` L304–319):

| Message | Do this |
|---|---|
| *"The lab certificate was read again and every check agrees."* (may add *"The delivery's menu update was rebuilt with what it says."*) | Nothing |
| *"The lab certificate was read again, but only partly - see what it did and did not give below."* | Read the panel. Missing facts → owner |
| *"The lab certificate could not be read - the reasons are below. Set the facts by hand if the lab cannot be reached."* | Check the host (§4.18). Otherwise owner |
| *"This lot has no lab result attached, so there is no certificate to read."* | Attach the lab result first (§4.21) |
| *"Reading the lab certificate failed. Try again in a minute."* | Wait one minute, then try once more. Twice → owner |
| *"Lab certificates cannot be read yet: the database is missing migration 0252 (lab certificate reading)."* | Developer |

### 5.2 Expiration rules

| Message | Cause | Do this |
|---|---|---|
| *"Rules saved: N saved, N removed, N unchanged. Lots are not changed until you Preview and Apply."* | **Save rules** worked (`expiration-rules/page.tsx` L329–330) | Preview next (§4.15 step 4) |
| **Nothing was saved**, with a list of rows (L316–325) | One or more rows are invalid; **nothing** was saved | Fix every listed row and save again |
| *"Choose months, days, a fixed date, or does not expire."* | A row with a number but no rule (`expiry-rules-core.ts` L232) | Pick the rule |
| *"Enter a whole number of months."* / *"...of days."* | (L215) | Whole numbers only |
| *"Months must be 1 to 120."* / *"Days must be 1 to 3650."* | (L218; maxima L55–56) | Use a smaller number |
| *"Enter a real date (YYYY-MM-DD)."* | **Fixed date** typed wrong (L224) | Retype |
| *"That date is before WA legal retail cannabis began (<floor date>)."* | (L227) | Check the year |
| *"That date is more than 10 years out - check for a typo."* | (L229) | Check the year |
| *"Count from must be the received date or the lab test date."* | (L209) | Pick one |
| *"Unknown category or type."* | The category or type was renamed or removed while the page was open (L321) | Reload the page |
| *"Notes are limited to N characters."* | (L340) | Shorten the note |
| *"Applied to N lots: …"* | **Apply** worked (L335–342) | Read every number. *"N writes failed - see the audit log."* → owner |
| *"Something changed since your preview (a lot, a rule, or a date). Nothing was written. Here is the fresh preview - review it and apply again."* | The plan changed after you previewed (L405–409) | Review the new preview, then apply |

**Why lots are left alone** (the preview's fold-out; `SKIP_REASON_LABELS`, `expiry-rules-core.ts` L438–447):

| Line in the fold-out | Meaning | Do this |
|---|---|---|
| *"Destroyed lot - never changed"* | Destroyed lots are skipped | Nothing |
| *"Has a manifest / JSON / COA / POS date - always kept"* | A document date | Nothing. A wrong document date → owner |
| *"Has a date on file with no recorded source - kept (never guess)"* | An old date of unknown origin | Nothing. The owner may check the package |
| *"Owner-typed date - kept (turn on override to replace)"* | Someone typed this date | Replace only on the owner's say-so |
| *"No rule for its type or category"* | No rule covers it | Add a rule, or leave it undated on purpose |
| *"Rule says does not expire"* | **Does not expire** | Nothing |
| *"No date to count from (received / lab test date missing)"* | The rule counts from a date the lot lacks | Set the received date (§4.21), then preview again |
| *"Already has this exact rule date"* | Nothing to change | Nothing |

### 5.3 Restore to sale, the 86 and the register

**Restore to sale** results appear at the top of the Inventory page (`inventory/page.tsx` L541–556).

| Message | Cause | Do this |
|---|---|---|
| *"<product> is back on sale (N units on hand — <status>)."* | Success (`restore-to-sale-core.ts` L167) | Check the shelf matches |
| *"That product is under a recall hold — it cannot be put back on sale until the hold is lifted."* | A lot of this product is **Recalled** (L132) | **Do not** work around it. §4.10. Only the owner releases a hold |
| *"Could not confirm this product is free of recall holds — not restoring. Try again in a moment."* | The recall check failed, so the restore failed closed (`restore-to-sale-store.ts` L137) | Wait a minute and try once more. Twice → owner |
| *"That product is hidden from the menu — unhide it first; restoring stock will not reveal a hidden card."* | Its card is hidden (`restore-to-sale-core.ts` L140) | Find out **why** it was hidden first; it may be a recall (§4.10 step 5). Ask the owner |
| *"That product is already available on the register — nothing to restore."* | Someone already restored it, or the next menu download did (L122) | Nothing |
| *"No inventory lots are linked to that product, so there is no stock to put back on sale. Receive it in, or link the lot's product key."* | (L155) | §4.21 (product link) |
| *"Every lot for that product is empty or not active, so there is nothing to sell. Receive stock in and it returns on its own."* | (L156) | Check the shelf; count (SOP-06) |
| *"That product is not on the published menu — publish the menu first, then restore it."* | (`restore-to-sale-store.ts` L96) | SOP-05b (Publish Menu) |
| *"There is no published menu to update."* | (L75) | Owner |
| *"Could not read this product's inventory lots - try again in a moment."* | (L121) | Try once more, then owner |

**At the register** (budtenders):

| Message | Cause | Do this |
|---|---|---|
| *"Sale blocked: "<product>" is under an active RECALL hold — …"* | A recall hold (§4.11) | Remove the item. No override. Tell the manager |
| *"Sale blocked: the recall-hold status of this order's products could not be verified (inventory read failed). …"* | The recall table could not be read (`completion-gate.ts` L117–118) | Try once. Repeats → manager → owner. No sale proceeds |
| *"Offline — flagging stock needs a connection (it changes the shared menu)."* | The 86 was pressed while offline (`RegisterShell.tsx` L1563–1565) | Tell the manager; take the product off the shelf display by hand |
| *"Item not found on the published menu — refresh and try again."* | (`api/pos/stock-flag/route.ts` L70) | Download the menu, try again |
| *"No published menu to update."* | (L56) | Manager → owner |
| *"Could not flag the item — try again."* / *"Could not reach the server — try again."* | (`RegisterShell.tsx` L1578, L1592) | Try once. Then tell the manager |

**Back office, Issues tab**: *"Restored to the register: inventory shows N units on hand in active lots, but the published menu still had it marked unavailable."* (`register-availability-core.ts` L389). The 86 was undone by the next menu download (§4.12, F-05a-9). The manager checks why it was 86'd.

### 5.4 Tags, testing labs and bulk fill

| Screen | Message | Cause | Do this |
|---|---|---|---|
| Tags | *"Give the tag a name."* | Blank name (`product-tags-core.ts` L163) | Type a name |
| Tags | *"Keep the name to 32 characters or fewer."* | (L164) | Shorten it |
| Tags | *"The name needs at least one letter or number."* | (L166) | Retype |
| Tags | *"A tag called "<name>" already exists."* | (L168) | Use the existing tag |
| Tags | *"Pick a colour (for example #c2410c)."* | (L171) | Pick one |
| Tags | *"Only the built-in New tag can be automatic."* | (L176) | Nothing |
| Tags | *"Tick "Yes, delete" to delete a tag."* | Delete pressed without the tick (`tags/actions.ts` L111) | Tick, if you mean it (§4.17) |
| Tags | *"Tick at least one product first."* | (L136) | Tick products |
| Tags | *"That tag no longer exists."* | Someone deleted it (L78, L140) | Reload |
| Testing labs | *"Enter the lab's name."* | (`testing-labs-core.ts` L238) | Type the name |
| Testing labs | *"The lab # is the whole number on the WSLCB / WSDA list (e.g. 18)."* | (L242) | Check the WSLCB list |
| Testing labs | *"<name> is already on the list."* / *"Lab #N is already on the list."* | (L246–247) | Use the existing lab |
| Testing labs | *"Enter a host name, e.g. files.cultivera.com, or paste a certificate link."* | Blank host (L141) | Paste the link |
| Testing labs | *"Wildcards are not allowed - add each exact host."* | (L143) | Add the exact host |
| Testing labs | *"Only https certificate links are read (that one is <protocol>)."* | (L151) | Ask the lab for the https link. Never work around it |
| Testing labs | *"IP addresses are not allowed - only named hosts."* | (L160) | Same. Owner |
| Testing labs | *"<host> is already built in - certificates from it are always read."* | (L300) | The fault is elsewhere; owner |
| Testing labs | *"A lab can have at most N hosts."* | (L302) | Owner |
| Bulk fill | *"Enter an expiration date."* / *"Enter a unit cost."* / *"Enter a POS product key."* | Blank value (`bulk-fill-core.ts` L164, L197, L218) | Type the value |
| Bulk fill | *"That expiration date is more than 10 years away — check for a typo."* (or *"…past…"*) | | Check the package |
| Bulk fill | *"Enter a dollar amount like 12.50 (no negative costs)."* / *"That cost is too large."* | | Check the invoice |
| Bulk fill | *"Select at least one lot first."* | The filters show no lots (L290) | Change the filters |

---

## 6. Exceptions & escalation

| Situation | What to do | Who to tell |
|---|---|---|
| **A recall notice arrives** (vendor, LCB, news, email) | §4.10 at once: form 8.5, set Recalled, pull, count, hide on the website, check open orders | Recall coordinator (**admin**) **within 1 hour** |
| **The admin (coordinator) cannot be reached within 1 hour of a recall** | No back-up (D37). Call the owner; the owner decides who makes the LCB call (§4.10 step 8). Write it on form 8.5 | Owner, at once; admin as soon as reachable |
| **Unsure whether it is a recall or a market withdrawal** | Treat it as a **recall** | Admin (coordinator) |
| **A recalled product was sold before the hold** (or synced from an offline register) | Record the units on form 8.5 ("sold before the hold"). Do not contact the customer yourself | Owner, same day; owner decides customer notice (form 8.4 part D) |
| **A recalled product still shows at a register after a menu refresh** | Tell every budtender by word of mouth; the sale will still be refused at completion (§4.11) | Owner, same hour |
| **A recalled product still shows on the website** | Expected (F-05a-16). Set **Always hide** (§4.10 step 5) | Owner |
| **"Sale blocked: … could not be verified"** repeats | No sales of that order. Try once more | Owner, at once; developer |
| **Someone set a lot to Destroyed by hand** | Do not change it back. Form 8.1 | Owner, same day (§4.9) |
| **Someone set Active a lot that has no COA, no CCRS id or a FAILED result** | Set it back to **Quarantine** at once with a form 8.1 line; check whether any units sold | Owner, same day (F-04-2) |
| **On hand is below zero** | Do not add units to "fix" it. Count the lot (SOP-06) | Owner, same day (F-05a-3) |
| **A count is short by more than 1 unit or more than $50 at cost** | Recount with a second person. **Shrink** with a full note | Owner, same day (§4.7) |
| **Theft or seizure** | Do not adjust. SOP-20 | Owner, at once (§4.7) |
| **An expired lot is Active** | Edible or liquid edible (and, until Q-05a-6, tincture or capsule): pull, quarantine, form 8.1, never sell. Anything else: check, form 8.1, owner decides (§4.16) | Owner, same morning |
| **A recalled or quarantined lot has to be destroyed** | Do not set it Active to make it selectable on Returns & Destruction. Recalled: stays Recalled, admin coordinates with the LCB, paper record (§4.9) | Admin (recall) or owner (quarantine) |
| **A destruction was cancelled and the lot went back to Active** | Set it back to its earlier status at once (Quarantine, or Recalled by the admin), form 8.1 (F-05a-19) | Owner, same day |
| **A cannabis lot has no unit cost** | Do not type one. It is corrected from the vendor's manifest (§4.20, D38) | Owner |
| **An 86'd product keeps coming back** | The count is wrong, or the product should be quarantined (§4.12) | Manager, same shift |
| **A label will not scan** | The lot has no lot code (§4.19) | Owner (F-05a-10) |
| **Bulk fill or Expiration rules wrote the wrong date** | Do not fix it by hand. The audit row holds every old date | Owner, same day |
| **A COA host will not open** | §4.18. Never add a host just to make a link open | Owner |
| **"Something went wrong saving that."** twice | Stop. Write the lot, what you pressed and the time | Owner or developer |
| **The Issues tab will not load, or shows rows nobody can explain** | Write it on form 8.3 | Owner, same morning |
| **An LCB officer asks for the recall plan or the recall records** | Show form 8.4 and the form 8.5 for that recall | Owner, at once |

---

## 7. Controls & compliance (why the rules exist)

| Control | Why | Where it comes from |
|---|---|---|
| **Never set Destroyed by hand; destruction only through Returns & Destruction** | The manual path leaves units on file, writes no destruction and drops the lot from the CCRS Inventory file (F-05a-1, **S1**) | `store.ts` L836–851; `ccrs-batch.ts` L1209–1217, L380–391; `disposition.ts` L1087–1095 |
| **A form 8.1 line before every status change** | **Lifecycle status** writes no audit row and asks no reason (F-05a-2; F-04-2) | `actions.ts` L142–155 |
| **Active from quarantine only from a "now clear" Issues row** | No go-live check on the manual path (F-04-2, **S1**). WAC 314-55-102: no retail sale without a passing COA | SOP-04 §4.19; `lot-activation-gate-core.ts` |
| **A recall placed the same hour; segregate, count, hide on the website, check open orders** | WAC 314-55-225(3)(b)(i): secure, isolate and prevent distribution; the hold does not reach the website (F-05a-16) | §4.10; `live-menu.ts` L167–171; `order-pricing.ts` L124–134 |
| **LCB notified immediately (recall) or within 48 hours (withdrawal)** | WAC 314-55-225(3)(b)(i)(A); (2)(b) | §4.10 step 8 |
| **Nothing recalled is destroyed before LCB coordination** | WAC 314-55-225(3)(b)(i)(B), (3)(e) | §4.10 step 9; `disposition-core.ts` L226–243 |
| **Weekly recall tracking** | WAC 314-55-225(3)(f) | Form 8.5 |
| **A written, signed recall plan with a named coordinator, reviewed yearly** | WAC 314-55-225(3)(d) (mandatory) | Form 8.4; F-05a-15 |
| **Only the admin (recall coordinator) releases a recall hold, on written clearance** | Owner decision D37; the app lets any manager release with no record | §4.10; F-05a-2 |
| **A recalled lot is never scheduled for destruction in the app until G-28 is built** | Scheduling overwrites Recalled with Quarantine and lifts the register hold (F-05a-18, S1); Cancel sets Active (F-05a-19) | `disposition.ts` L965–971, L1113–1114; `recall-hold-core.ts` L44 |
| **Every manual adjustment: reason, note, double count, form 8.2** | CCRS withholds an Other / Employee-sample row with no note (E13); the history shows no name; the write is not atomic and has no floor (F-05a-3, F-05a-4, F-05a-13) | `ccrs-inventory-adjustment-core.ts` L62–105, L201–212; `ccrs-preflight-core.ts` L271; `store.ts` L578–616 |
| **Never use Receive (add), Destruction or Recall removal on the lot page** | Receive is not sent to CCRS (F-05a-7); the other two bypass SOP-15 (F-05a-5) | `ccrs-inventory-adjustment-core.ts` L101–105 |
| **Theft and seizure go to the owner, never straight to an adjustment** | No Theft / Seizure reason on the form yet (F-05a-6); the owner approved adding them (D39, G-23) | Lot page L118–128; `ccrs-inventory-adjustment-core.ts` L87–90 |
| **The daily Issues check, logged on form 8.3** | It is the only stop on expired stock (F-05a-8) and the place every blocked lot shows | §4.4 |
| **Expired edibles and liquid edibles never sold; other expired lots on the owner's decision** | Owner decision D36. The register sells expired lots and draws FIFO, not FEFO (F-05a-8) | `sale-lot-read.ts` L39–47 |
| **Expiration rules: owner decides, Save → Preview → Apply** | The fingerprint check stops a different plan being applied; every date is audited | `expiration-rules/actions.ts` L146–180 |
| **Document dates are never overwritten** | A manifest, COA or POS date is the authoritative record | `expiry-rules-core.ts` L10–34, L49 |
| **The manager investigates every 86 the same shift** | The 86 is not sticky while units are on file (F-05a-9). The owner chose the professional method (D40, G-26) | `register-availability-core.ts` L318–421 |
| **Restore only product that is physically on the shelf** | The restore recomputes from the books; the shelf is the truth | `restore-to-sale-core.ts` L115–167 |
| **Scan every reprinted label before use** | A label without a lot code does not scan (F-05a-10) | `lots/[id]/label/page.tsx` L38–40; `scan-to-cart-core.ts` L55–70 |
| **Nobody types a cannabis unit cost; it comes only from the vendor's CCRS manifest** | Owner decision D38 ("That's illegal"). Bulk fill still allows it (F-05a-11, **S1**; gap G-27) | `intake-parser.ts` L415–420; `lot-edit-core.ts` L38; `bulk-fill-core.ts` L54 |
| **New COA hosts only with owner approval** | The host list is the certificate reader's security allow-list | `labs/page.tsx` header L7–12 |
| **Tags say nothing an advertising rule forbids** | Tags show on the public website | §4.17; SOP-11 |
| **Every status and adjustment record kept 5 years** | WAC 314-55-087 (records retention) | Forms 8.1–8.5 in the binder |

---

## 8. Checklists & forms

Print these. Keep the filled forms in the compliance binder, by month, for **five years** (WAC 314-55-087). Until gaps G-22 and G-25 are built, these forms are the only record of who changed a lot's status, who adjusted it, and how a recall was handled.

### 8.1 Lot status and recall log (one line per status change)

```
GREENWAY — LOT STATUS & RECALL LOG                         Month: ________ / ______
Write the line BEFORE pressing Update status. Destroyed is NEVER set here (SOP-05a §4.9).
====================================================================================
Date  | Time  | Lot code / product        | From → To            | Reason / reference
      |       |                           | (Active, Quarantine, | (Issues row "now clear",
      |       |                           |  Recalled, Sold out) |  recall notice #, COA,
      |       |                           |                      |  "EXPIRED <date>", damage)
------+-------+---------------------------+----------------------+-------------------------
      |       |                           |          →           |
------+-------+---------------------------+----------------------+-------------------------
      |       |                           |          →           |
------+-------+---------------------------+----------------------+-------------------------
      |       |                           |          →           |
------+-------+---------------------------+----------------------+-------------------------
      |       |                           |          →           |
------+-------+---------------------------+----------------------+-------------------------
      |       |                           |          →           |
------+-------+---------------------------+----------------------+-------------------------
For each line also write:   Manager (print + initials): ________   Status card checked? [ ]
Recalled → Active:  OWNER ONLY. Written clearance attached?  [ ] yes  Ref: ____________
Quarantine → Active: only from a "Held in quarantine, now clear" Issues row. Never FAILED.
Quarantine lots: decision (release / return / destroy) due within 3 business days.
Found a lot Destroyed by hand with units on hand?  Write it here + tell the owner TODAY.
====================================================================================
Owner monthly review:  Signed ________________   Date ____/____/______
```

### 8.2 Manual adjustment log (one line per Record adjustment)

```
GREENWAY — MANUAL ADJUSTMENT LOG                           Month: ________ / ______
Count twice first. Never: Receive (add) · Destruction · Recall removal. (SOP-05a §4.7)
====================================================================================
Date | Time | Lot code / product      | On hand | Counted | Change | Reason        | Note written on screen (always)
     |      |                         | before  | (2x)    | (+/-)  |               |
-----+------+-------------------------+---------+---------+--------+---------------+--------------------------------
     |      |                         |         |         |        |               |
-----+------+-------------------------+---------+---------+--------+---------------+--------------------------------
     |      |                         |         |         |        |               |
-----+------+-------------------------+---------+---------+--------+---------------+--------------------------------
     |      |                         |         |         |        |               |
-----+------+-------------------------+---------+---------+--------+---------------+--------------------------------
For each line:  Entered by ________  Second person who saw the count ________
                On hand after ______ (below 0? → owner TODAY)   Menu banner OK? [ ]
Shrink/Damage over 1 unit or over $50 at cost → owner told at ____:____ by ________
Employee sample: employee's name in the note? [ ]   Other: owner approved? [ ]
Theft / seizure: DO NOT ADJUST — SOP-20, call the owner.
====================================================================================
Owner monthly review:  Signed ________________   Date ____/____/______
```

### 8.3 Daily Issues check (opening manager, before the store opens)

```
GREENWAY — DAILY INVENTORY ISSUES CHECK                    Month: ________ / ______
Inventory → Issues. Work every NEEDS ACTION row before opening. (SOP-05a §4.4)
====================================================================================
Day | Time | Clean? | # Needs | RECALLED | Expired | Can't  | 86 with | Done / passed to owner | Initials
    |      |        | action  | rows     | active  | sell   | stock   |                        |
----+------+--------+---------+----------+---------+--------+---------+------------------------+---------
 1  |      |  [ ]   |         |          |         |        |         |                        |
 2  |      |  [ ]   |         |          |         |        |         |                        |
 3  |      |  [ ]   |         |          |         |        |         |                        |
 …  (one line per day; 31 lines on the printed sheet)
31  |      |  [ ]   |         |          |         |        |         |                        |
====================================================================================
For each EXPIRED row: pulled [ ]  quarantined [ ]  form 8.1 line [ ]  owner told [ ]
For each RECALLED row: units segregated and counted [ ]  form 8.5 open [ ]
For each 86 row: cause found (count / damage / listing / mistake) [ ]  restored only if on shelf [ ]
Expiring within 30 days: moved to the front of the shelf [ ]  (Insights → Sell first (FEFO))
------------------------------------------------------------------------------------
MONTHLY (owner, first business day):
  Reports → Expiration reviewed [ ]   Expired value $________   Due next 30 days $________
  Coverage gaps (categories with stock and no date): ______________________________
  Forms 8.1 and 8.2 reviewed and signed [ ]       Recall plan (8.4) still current [ ]
Owner signed ________________   Date ____/____/______
```

### 8.4 Recall plan (WAC 314-55-225(3)(d)): one signed copy in the compliance binder

```
GREENWAY MARIJUANA — WRITTEN RECALL PLAN                   WAC 314-55-225(3)(d)
Licensee: Greenway Marijuana · Port Orchard, WA   UBI / license # ____________________
====================================================================================
(A) RECALL COORDINATOR
    Coordinator (the ADMIN, owner decision D37): ______________________
    Phone ______________   No back-up. Recall team: the owner and the manager.
    Owner: ______________________  Phone ______________
    Local LCB enforcement officer: ______________________  Phone ______________
    Email ______________________   (update whenever it changes)

(B) IDENTIFY AND ISOLATE  (SOP-05a §4.10 steps 1–7)
    1. Open a recall event worksheet (8.5) the hour the notice arrives.
    2. Find every affected lot (Inventory, All tab, search product / vendor / lot #).
    3. Set each lot to Recalled (form 8.1). The register then refuses the product.
    4. Pull every unit to a sealed bin "RECALL — DO NOT SELL", count it, match On hand.
    5. Hide the product on the website (Product Enrichment → Always hide).
    6. Check a register and the open pickup orders.

(C) RETRIEVE AND DESTROY  (SOP-05a §4.10 steps 8–10; SOP-15)
    1. Greenway is a retailer and sells to consumers only. "Retrieve" means product
       held in the store and consumer returns brought back (SOP-15 customer returns).
    2. NOTHING is destroyed before the LCB is notified and destruction is coordinated
       with the local officer (WAC 314-55-225(3)(b)(i)(B), (3)(e)).
    3. The lot stays Recalled. Until gap G-28 is built, the destruction is NOT
       scheduled in the app (it would lift the hold): coordinator and officer agree
       it, it is witnessed, and it is written on form 8.5 and the SOP-15 waste record.
    4. Track affected and returned amounts; report progress to the LCB at least weekly
       ((3)(f)) on form 8.5.

(D) COMMUNICATIONS
    LCB:        coordinator calls the local officer — IMMEDIATELY for a recall,
                within 48 HOURS for a market withdrawal ((3)(b)(i)(A); (2)(b)).
    Vendor:     coordinator or manager, same day; ask for the written notice.
    Owner:      the manager calls the owner if the coordinator cannot be reached in 1 hour.
    Customers with open pickup orders: manager calls, "item unavailable".
    Customers who already bought:  owner decides how they are told (in-store notice,
                website notice, press release) when product reached consumers.
    Staff:      manager briefs every budtender the same shift.
    Public / press / social media: OWNER ONLY.

APPROVAL AND ANNUAL REVIEW (review every year and when the coordinator, the officer
or SOP-05a changes)
    Approved by owner ______________________  Signed ____________  Date ____/____/____
    Reviewed: ____/____/____ by ______   ____/____/____ by ______   ____/____/____ by ______
STAFF ACKNOWLEDGMENT — "I have read this recall plan."
    Name ____________________ Signed ____________ Date ________
    Name ____________________ Signed ____________ Date ________
    Name ____________________ Signed ____________ Date ________
```

### 8.5 Recall event worksheet (one per recall or market withdrawal)

```
GREENWAY — RECALL / MARKET WITHDRAWAL WORKSHEET          Event #: ______
====================================================================================
1. NOTICE
   Received ____/____/______  at ____:____   by (name) ____________________
   From: [ ] vendor  [ ] LCB  [ ] lab  [ ] news / public  [ ] our own finding
   How: [ ] phone  [ ] email  [ ] letter  [ ] other ____________   Copy in binder [ ]
   Product(s) ___________________________   Vendor __________________________
   Lot / batch #s as given _________________________________________________
   Reason ____________________________________   Recall ref # ______________
   Coordinator decision:  [ ] RECALL (consumer risk)  [ ] MARKET WITHDRAWAL (no risk)
   Unsure → treat as RECALL.

2. AFFECTED LOTS                                       (set Recalled + form 8.1 line)
   Lot code              | On hand (screen) | Counted in bin | Diff | Set Recalled at
   ----------------------+------------------+----------------+------+----------------
                         |                  |                |      |     :
                         |                  |                |      |     :
                         |                  |                |      |     :
   Bin location ____________________   Sealed by ________   Witness ________

3. ISOLATE — CHECKS
   Website hidden (Product Enrichment → Always hide) [ ] at ____:____
   Register scanned after a menu refresh — product absent [ ]
   Open pickup orders checked [ ]  Customers called: ______________________________
   Staff briefed [ ]  Units sold BEFORE the hold (offline sync, earlier sales): ______

4. NOTIFY THE LCB         (recall: immediately · withdrawal: within 48 hours)
   Officer ____________________  Date ____/____/______  Time ____:____
   Method [ ] phone [ ] email   By ________________   Reference / notes ____________
   Destruction coordinated with officer?  [ ] yes on ____/____/______  [ ] not yet

5. WEEKLY TRACKING  (WAC 314-55-225(3)(f) — report progress to the LCB weekly)
   Week of  | Held | Returned by customers | Returned to vendor | Destroyed (SOP-15) | Reported to LCB
   ---------+------+-----------------------+--------------------+--------------------+----------------
            |      |                       |                    |                    |
            |      |                       |                    |                    |
            |      |                       |                    |                    |

6. CLOSE
   Outcome: [ ] released (written clearance ref __________, OWNER set Active)
            [ ] destroyed via Returns & Destruction   [ ] returned to vendor (SOP-15)
   Website visibility restored (if released) [ ]   Register rings up (if released) [ ]
   Departures from the recall plan agreed with the LCB: ___________________________
   Closed ____/____/______   Coordinator signed ____________________
```

---

## 9. Quick reference card

```
┌──────────────────────────── GREENWAY — INVENTORY CORE (DAILY) ────────────────────────────┐
│ EVERY MORNING: Inventory → Issues. Work every NEEDS ACTION row before opening. Form 8.3.  │
│   RECALLED row → product segregated + counted? · EXPIRED row → read the type (§4.16):     │
│   edible / liquid edible = pull, Quarantine, never sell · other = check, 8.1, owner.      │
│   "Marked unavailable, but you have stock" → check the shelf → Restore to sale.           │
│ ADJUST QUANTITY: count twice · avoid busy times · ALWAYS write a note · form 8.2.         │
│   NEVER: Receive (add) · Destruction · Recall removal. Theft / seizure → owner, SOP-20.   │
│   It does not stop at zero and does not set Sold out. Check On hand after.                │
│ LIFECYCLE STATUS: form 8.1 line FIRST. It checks nothing and logs nothing.                │
│   Quarantine → Active only from a "now clear" Issues row. Never a FAILED COA.             │
│   ⚠ NEVER "Destroyed" by hand — destruction only via Returns & Destruction (SOP-15).      │
│ RECALL (same hour): form 8.5 → every lot Recalled (8.1) → pull, bin, count → website      │
│   Always hide → check a register + pickup orders → ADMIN tells LCB (recall: now;          │
│   withdrawal: 48 h) → DESTROY NOTHING until LCB coordinated → track weekly.               │
│   Only the ADMIN (coordinator, no back-up) releases a recall, on written clearance.       │
│   Never schedule a Recalled lot for destruction in the app: it lifts the hold.            │
│ REGISTER: "Sale blocked … RECALL hold" → remove the item. No override. Tell the manager.  │
│   86 = "we're out, take it off the menu". It comes back if stock is on file: manager      │
│   checks the cause the same shift (count / quarantine / listing).                         │
│ EXPIRY: rules = owner decides → Save → Preview → read orange rows → Apply.                │
│   Manifest / COA / POS dates are never changed. Expiring in 30 days → front of shelf.     │
│ LABELS: lot page → Manifest → 🏷 Print 4×6 label. SCAN IT before use.                      │
│ BULK FILL: blanks only, import lots only. One value must fit every lot.                   │
│   NEVER type a cannabis unit cost. It comes only from the vendor's CCRS manifest.         │
│ RECALL PLAN (8.4) signed, in the binder, reviewed every year. Records kept 5 years.       │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **Lot** | One received package line: one product, one vendor lot code, one manifest, one lab result, one CCRS identifier. The unit this SOP manages. |
| **On hand** | The units the system believes the lot still holds. Sales, voids, counts, destructions and manual adjustments move it. |
| **Active / Quarantine / Recalled / Sold out / Destroyed** | The five lot statuses (§4.3). Only **Active** lots sell. |
| **Lifecycle status** | The box on the lot page that writes a status directly, with no check and no audit (§4.8). |
| **Adjustment** | A manual change to **On hand** with a reason, sent to CCRS weekly except **Receive (add)** (§4.6–§4.7). |
| **AdjustmentReason** | The CCRS code an adjustment is reported under: Lost, ReturnedLabSample, Destruction, Reconciliation, Other, Theft, Seizure. |
| **E13** | The CCRS check that withholds an **Other** adjustment with no detail note. |
| **Recall hold** | The register block on every product with at least one **Recalled** lot (§4.11). No override. |
| **Recall** | WAC 314-55-225: product that may pose a risk to consumers. LCB notified immediately. |
| **Market withdrawal** | WAC 314-55-225: removal for a reason with no consumer risk (for example packaging). LCB notified within 48 hours. |
| **Recall coordinator** | The staff member the recall plan names to run every recall (WAC 314-55-225(3)(d)(i)(A)). At Greenway, **the admin**, with no back-up (D37). |
| **Recall plan** | The written plan every licensee must have (form 8.4). |
| **Completion gate** | The final check when a sale completes. It refuses recalled products even if the register menu showed them. |
| **86 / Mark out of stock** | Restaurant slang for "take it off the menu, we're out." The register link that marks a product's menu card unavailable on every register and the website (§4.12). It does not touch the lot, the count or CCRS. |
| **Hard block** | The register refuses the sale and no one can override it. Owner decision D36 for expired edibles and liquid edibles (§4.16), once G-24 is built. |
| **CCRS manifest cost** | The unit cost of a cannabis lot, read from the vendor's state manifest at receiving (line price ÷ quantity). The only allowed source of cannabis cost (D38). |
| **Restore to sale** | The back-office button that recomputes an 86'd card from live lot units (§4.12). |
| **Always hide** | The Product Enrichment visibility setting that takes a card off the website and online ordering (§4.10 step 5). |
| **Expiry source** | Where a lot's date came from: manifest / COA / POS (protected), typed by owner, rule, unsourced, none (§4.14). |
| **Expiration rule** | A category or type rule that gives undated lots a **Best by** date (§4.15). |
| **Best by / Expires** | How the label prints a rule date / every other date. |
| **FIFO / FEFO** | First-In, First-Out (what the register does) / First-Expired, First-Out (what the shelf should do). |
| **Issues tab** | The daily list of everything in inventory that needs action or a look (§4.4). |
| **Tag** | A website label on product cards (New, Staff Pick…). Not a compliance field. |
| **COA host** | A web host the certificate reader may download COAs from. A security allow-list (§4.18). |
| **Bulk fill** | Filling one blank field on many Cultivera-import lots at once (§4.20). |
| **Cultivera import** | The one-time migration of lots from the previous POS. Those lots carry a migration marker. |
| **Product key (POS product key)** | The identifier that links a lot to its menu product. |
| **Audit row** | A permanent record in the audit log of who did what, when, with the before and after values. |

---

## Appendix A: Source map (verified at `main@ac251766`)

| SOP section | Code / document (read for this SOP) |
|---|---|
| 1 purpose | `docs/sop-program/00-OWNER-REQUEST-VERBATIM.md` L7, L98, L114; `02-SOP-CATALOG-AND-ROADMAP.md` (Split, D35); `src/app/admin/inventory/page.tsx` L436 |
| 2 roles | `src/lib/auth/roles.ts` L106, L126, L142–149; `inventory/actions.ts` (every action `inventory.manage`: L112, L143, L175, L228, L273, L316, L451, L507, L709, L840, L904, L1040, L1175, L1210); `expiration-rules/page.tsx` L222, `actions.ts` L62, L131, L141; `tags/page.tsx` L85; `labs/page.tsx` L156; `lots/[id]/label/page.tsx` L33; `reports/expiration/page.tsx` L151; `disposition/page.tsx` L97; `api/pos/stock-flag/route.ts` L28–34 |
| 3 before you start | `src/components/admin/admin-nav-data.ts` L84–90; `completion-gate.ts` L95–119; `restore-to-sale-core.ts` L115–158; `expiration-rules/actions.ts` L146–157; `expiry-rules-core.ts` L10–34; `tags/actions.ts` L108–111 |
| 4.1–4.2 list | `inventory/page.tsx` L92–102, L204–209, L439–475, L493–570, L603–709, L806–852; `InventoryFilterPanel.tsx` L345 |
| 4.3 statuses | `inventory/actions.ts` L103–109; `[id]/page.tsx` L130–136; `sale-lot-read.ts` L39–47; `atomic-quantity.ts` L44; `disposition.ts` L1087–1094; `ccrs-batch.ts` L1006–1010, L1118–1122, L1209–1217 |
| 4.4 Issues | `src/lib/admin/issues-core.ts` L16–25, L281–285, L314–486; `IssuesList.tsx` L11–12; `inventory/page.tsx` L572–597; `src/lib/inventory/store.ts` L32 |
| 4.5 lot page | `[id]/page.tsx` L360–418, L439–868, L1474–1546; `LabCertificatePanels.tsx` L35–56; `store.ts` L594–600 |
| 4.6–4.7 adjust | `inventory/actions.ts` L89–140; `store.ts` L578–616; `[id]/page.tsx` L118–128, L1474–1494; `ccrs-inventory-adjustment-core.ts` L62–105, L201–212; `ccrs-preflight-core.ts` L271; `trade-samples.ts` L280–300; `atomic-quantity.ts` |
| 4.8–4.9 status | `inventory/actions.ts` L142–155; `store.ts` L836–851; `[id]/page.tsx` L1496–1512; `ccrs-batch.ts` L380–411, L1209–1217; `disposition.ts` L1087–1095 |
| 4.10–4.11 recall | `src/lib/pos/recall-hold-core.ts` L17–26, L44, L53–63, L108–117; `recall-hold-store.ts` L72–121; `api/pos/menu/route.ts` L116–121, L225–240, L302–304; `orders/completion-gate.ts` L95–119, L199; `pos/sync-store.ts` L1133–1162; `register-availability-core.ts` L332–345; `live-menu.ts` L167–171, L289–292; `order-pricing.ts` L124–134; `register-sellability-store.ts` L175; `products/[key]/page.tsx` L1054–1074; `products/actions.ts` L205–211, L255–270; `disposition-core.ts` L226–243; WAC 314-55-225 (app.leg.wa.gov, read 2026-10-27) |
| 4.12 86 / restore | `src/app/(site)/pos/SaleFlow.tsx` L4263–4280; `RegisterShell.tsx` L1557–1594; `stock-flag-core.ts` L31–32, L79–81; `api/pos/stock-flag/route.ts` L28–102; `register-availability-core.ts` L141–145, L318–421; `RegisterSellabilityBanner.tsx` L142–188; `inventory/actions.ts` L1174–1198; `restore-to-sale-core.ts` L115–167; `restore-to-sale-store.ts` L68–172 |
| 4.13 recall plan | WAC 314-55-225(3)(d); `docs/RETURNS_DESTRUCTION_COMPLIANCE.md` L136 |
| 4.14–4.16 expiry | `expiry-rules-core.ts` L10–69, L209–232, L321–340, L438–447, L505, L770–777, L1116–1127; `expiration-rules/page.tsx` L57–62, L117–127, L180–216, L279–409; `expiration-rules/actions.ts` L61–180; `[id]/page.tsx` L603–628; `intake-store.ts` L1587–1612; `issues-core.ts` L388–392, L417, L452–473; `InventoryIntelPanel.tsx` L199–201; `reports/expiration/page.tsx` L151, L229–277; `ReportTabs.tsx` L22 |
| 4.17 tags | `tags/page.tsx` L85, L130–131, L194, L246–256, L315, L375; `tags/actions.ts` L45–146; `src/lib/menu/product-tags-core.ts` L28–31, L163–176 |
| 4.18 labs | `labs/page.tsx` L7–12, L156; `labs/actions.ts` L30–76; `testing-labs-core.ts` L141–160, L236–309 |
| 4.19 label | `lots/[id]/label/page.tsx` L1–40, L116–124; `LabelPrintControls.tsx` L25–32; `intake/[id]/page.tsx` L1072–1078; `src/lib/pos/scan-to-cart-core.ts` L55–70 |
| 4.20 bulk fill | `inventory/actions.ts` L903–996; `bulk-fill-core.ts` L49, L107, L164–290, L318–325; `BulkFillPanel.tsx` L62–122; `inventory/page.tsx` L684–709; `roles.ts` L143–148 |
| 4.21 corrections | `inventory/actions.ts` L174–211, L228–303, L315–371, L1247; `received-date-core.ts` L163–190; `lot-link-core.ts` L73–77, L167–173, L218–219; `LotLinkPanels.tsx` L55–220; `coa-panel-core.ts` L304–319; `[id]/page.tsx` L96, L439–475, L763, L806–868, L1022 |
| 4.22 pointers | `src/lib/pos/low-stock-core.ts` L1–22; `oversold-report-core.ts` L45; `cycle-counts/page.tsx` L70, L96 |
| Tests | This slice changes documentation only. The full CI gate (announcer check, compliance tests, pure self-tests) is run before merge and its result recorded in the pull request |

## Appendix B: Not built yet (interim procedures)

> **Reminder (owner decision D41).** When any row below is built, update this SOP in the same piece of work: the sections the row names, this table, Appendix D, the finding (mark it FIXED) and the concierge entry.

| Need | Today | Interim procedure in this SOP | Gap · finding |
|---|---|---|---|
| A status change that checks the go-live rule, asks a reason and writes an audit row | **Lifecycle status** writes any status blindly, including **Destroyed** with units on hand | Form 8.1 before every change; Destroyed never by hand; Recalled → Active by the admin only (§4.8–§4.10) | G-19, **G-22** · F-04-2, F-05a-1, F-05a-2 |
| A safe manual adjustment (atomic, no negative, Sold out at zero, **Theft / Seizure added**, note required where CCRS needs it, **Receive / Destruction / Recall removal removed**, a **Schedule destruction** link to Returns & Destruction) — **APPROVED** (D39) | Read-then-write, no floor, optional note, unsafe reasons on the list | Count twice, quiet times, always a note, form 8.2, forbidden reasons (§4.6–§4.7) | **G-23** · F-05a-3 … F-05a-7 |
| Register **hard block** on expired Solid / Liquid Edible lots, **warning** on all other expired lots; FEFO lot draw; correct Issues text — **APPROVED** (D36) | Register sells expired lots, draws FIFO; Issues text points to the wrong fix | Daily check by type: edibles pulled and quarantined, others on the owner's decision; one lot on the floor at a time (§4.16) | **G-24** (**APPROVED**, D36; Q-05a-6) · F-05a-8 |
| A recall plan and recall log in the app, with a named coordinator; the hold reaching the website and online orders | No plan, no coordinator, no log; the hold stops the register only | Forms 8.4 and 8.5; **Always hide** on Product Enrichment (§4.10, §4.13) | **G-25** · F-05a-15, F-05a-16 |
| A **Print label** link on the lot page; a scannable fallback barcode; **the professional 86** (reason-driven clearing, one queue, audited manager restore) — 86 part **APPROVED** (D40) | Label linked from the manifest only; fallback barcode does not scan; 86 reverts on the next download | Manifest link or typed address; scan before use; manager checks every 86 (§4.12, §4.19) | **G-26** · F-05a-9, F-05a-10 |
| **No typed cannabis unit cost anywhere**: remove **Unit cost** from Bulk fill for cannabis lots — **APPROVED** (D38) | Anyone with Inventory access can bulk-fill it | Never use Bulk fill → Unit cost; cost only from the manifest (§4.20) | **G-27** · F-05a-11 (S1) |
| Returns & Destruction able to pick **Quarantine** and **Recalled** lots, keep **Recalled** when scheduling (hold stays on), and on Cancel put the lot back to the status it had | Lists Active lots only; scheduling writes Quarantine over Recalled; Cancel always sets Active | Recalled lots destroyed on paper with the LCB officer and stay Recalled; cancel only with the owner and restore the old status at once (§4.9) | **G-28** · F-05a-17, F-05a-18, F-05a-19 |
| Adjustment history in store time, with the name | Browser time zone; no name shown | Form 8.2 (§4.5) | F-05a-13 |

## Appendix C: Open questions for the owner

| # | Question | Why it matters | Interim rule in this SOP |
|---|---|---|---|
| **Q-05a-1** | ~~May Greenway sell product past its expiry or best-by date? Block or warn?~~ | **ANSWERED** (D36): *"hard block edibles and liquid edibles, warnings for everything else."* | §4.16 paper rule; G-24 APPROVED |
| **Q-05a-2** | ~~Who is the recall coordinator, and who is the back-up?~~ | **ANSWERED** (D37): *"admin. No back up. Just my manager and I."* | §2, §4.13, form 8.4 |
| **Q-05a-3** | ~~May a manager key a cannabis unit cost through Bulk fill?~~ | **ANSWERED** (D38): *"absolutely not. That's illegal. Cost comes from the state CCRS manifest created by the vendor."* | §4.20; F-05a-11 re-rated S1; G-27 APPROVED |
| **Q-05a-4** | ~~Remove Receive, Destruction and Recall removal; add Theft and Seizure?~~ | **ANSWERED** (D39): *"remove receive … Add theft and seizure."* The owner's question about the Destructions page is answered in §4.9 | §4.7, §4.9; G-23 APPROVED; G-28 new |
| **Q-05a-5** | ~~Should the 86 stay put until a manager restores it?~~ | **ANSWERED** (D40): *"what is an 86? I forget. Do the enterprise grade solution, the professional method."* | §4.12; G-26 APPROVED |
| **Q-05a-6** | **Does "edibles and liquid edibles" include Tincture and Capsule** (and any other swallowed product), for the expiry hard block? | CCRS has separate types for Solid Edible, Liquid Edible, Tincture and Capsule (`ccrs-batch-core.ts` L245–258). The sales-limit code already counts tinctures as liquid edibles (`sales-limits-core.ts` L364–366). G-24 needs the exact list. | Treated as included (hard stop) until answered (§4.16). |
| **Q-05a-7** | **May the manager still place a recall hold** (set **Recalled**) the moment a notice arrives, with the admin releasing it? | The admin is the coordinator with no back-up (D37). A hold only protects customers; waiting for the admin could let recalled product sell. | Yes: the manager places, the admin releases (§2, §4.10). |
| **Q-05a-8** | **Approve the design for Returns & Destruction (G-28)?** (a) list Quarantine and Recalled lots too; (b) keep a Recalled lot **Recalled** while its destruction is pending, so the register hold stays on; (c) on Cancel, put the lot back to the status it had before; (d) add the **Schedule destruction** link on the lot page. Also: until it is built, is the paper procedure in §4.9 point 3 acceptable for a recalled lot? | Today the page cannot pick a held lot, lifts a recall hold when scheduling, and puts any cancelled lot back on sale (F-05a-17, F-05a-18, F-05a-19). | §4.9 interim. |

## Appendix D: Revision history

| Version | Date | Change | By |
|---|---|---|---|
| 1.0 draft | 2026-10-27 | First issue (slice SOP-05a, owner decision D35: inventory management in two slices). Written from the code at `main@ac251766`. Part 1 screens and the daily Issues check (§4.1–§4.4); Part 2 the lot page, adjustments and lifecycle status (§4.5–§4.9); Part 3 recalls, the 86, restore to sale and the written recall plan (§4.10–§4.13, WAC 314-55-225); Part 4 expiry dates and expiration rules (§4.14–§4.16); Part 5 tags, testing labs, labels, bulk fill and lot corrections (§4.17–§4.22). Adds findings F-05a-1…F-05a-16, gaps G-22…G-26, questions Q-05a-1…Q-05a-5, forms 8.1–8.5 (8.4 is the statutory recall plan). | SOP program (for owner review) |
| 1.1 draft | 2026-10-27 | Owner answers to Q-05a-1…5 applied (decisions D36–D41). Re-verified at `main@827facb5` after the performance merge (register files now under `src/app/(site)/pos/`; line references updated; no described behaviour changed). Living-SOP reminder added (D41). §2, §4.10, §4.13, §6, form 8.4: the **admin** is the recall coordinator, no back-up (D37). §4.7: Receive, Destruction and Recall removal to be removed, Theft and Seizure to be added (D39, G-23 APPROVED). §4.9: how Returns & Destruction changes the lot by itself, and new findings F-05a-17…19 with an interim (gap G-28). §4.12: what an 86 is, and the professional method (D40, G-26 APPROVED). §4.16: expired edibles and liquid edibles never sold, others on the owner's decision (D36, G-24 APPROVED). §4.20: nobody types a cannabis unit cost (D38; F-05a-11 re-rated S1; gap G-27). §7, §9, glossary, Appendices B–C updated; questions Q-05a-6…8 added. | SOP program (for owner review) |
