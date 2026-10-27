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

<!-- PART 2 (sections 4.1 onward) is appended in the next commit. -->
