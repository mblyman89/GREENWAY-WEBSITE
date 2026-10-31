# SOP-06 — Inventory Audits (owner), Cycle Counts (every employee) and Daily Checklists

| | |
|---|---|
| **Version** | 1.3 (Fix Phase 4.1–4.3 built: G-33, G-34, G-35, G-36, G-37; needs migration 0326. Fix Phase 4.4a built: G-39 housekeeping, no migration. Fix Phase 4.4b built: G-38 daily checklists; needs migration 0327) |
| **Effective** | On owner approval |
| **Owner** | Michael Lyman |
| **Applies to** | **Inventory Audits** (planning a count, approving its scope and pushing it to the floor, reviewing, approving, posting, the work paper): **the owner only** (D50). **Cycle Counts** (the blind count) and the **daily checklists** (§8): **every employee**: admin, manager and budtender ("sales") (D51). |
| **Verified against** | `main@c976c7e4` (2026-10-28) for v1.0; the v1.1 additions (owner answers, cockpit, claim, checklist catalog) were checked at `main@b8101abb` (2026-10-28), and no SOP-06 code changed between the two. **v1.2** was written against branch `fix/p4-1-count-integrity` (Fix Phase 4.1–4.3) and migration `0326_audit_count_integrity.sql`; **v1.3** against branch `fix/p4-4a-count-housekeeping` (G-39); **v1.4** against branch `fix/p4-4b-daily-checklists` (G-38) and migration `0327_daily_checklists.sql`. Every label, button, message, number and rule below was read from the code or quoted from the owner. Nothing was written from memory. Where the code and a help panel or explainer disagree, this SOP follows the code and records a finding. Where the code cannot do what the owner asked, this SOP says so plainly and gives the safe interim. |
| **Program records** | Findings `F-06-*` in `docs/sop-program/03-FINDINGS-LEDGER.md` · Gaps `G-33`…`G-41` in `docs/sop-program/05-GAP-REGISTER.md` · Owner decisions D41 (living SOPs), D42 (concierge covers every feature), D50–D52 (this SOP), **D54–D61 (owner answers to Q-06-1…Q-06-8)** in `docs/sop-program/00-OWNER-REQUEST-VERBATIM.md` · Owner source letter `docs/MICHAEL-books-23.md` · Scope in `docs/sop-program/02-SOP-CATALOG-AND-ROADMAP.md` (SOP-06) |

> **This SOP is a living document (owner decision D41).** The owner said: *"We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary."* When any gap named here (Appendix B) is built, this SOP is updated in the same piece of work: the sections the gap names, Appendix B, Appendix D (a new revision row), the finding marked FIXED, and the concierge entry (charter §3 rules 9–10). Until then, the interim procedures in this SOP are the rule.

> **How to use this document.** Part 1 (§4.1–§4.3) explains the two screens and the life of one count. Part 2 (§4.4–§4.7) is the **owner's set-up**: planning the count and pushing it to the Cycle Counts page. Part 3 (§4.8–§4.12) is the **blind count** that every employee does. Part 4 (§4.13–§4.18) is the **owner's review, approval, posting and journal approval**. Part 5 (§4.19–§4.22) covers the work paper, the old cycle-count sessions, the "Stock needing recount" list and the Issues reminder. Part 6 (§4.23) is the **daily checklists**. Section 5 lists every message. Section 8 holds the paper forms (the daily ones, 8.5–8.8, are the fallback since v1.4; the app list is the record). Section 9 is two one-page cards (owner and counter). Words in **bold** are the exact labels you will see on the screen.

> **The one thing to know before anything else (v1.2).** **Migration 0326 must be applied first** (`supabase/migrations/0326_audit_count_integrity.sql`, in the Supabase SQL editor, after 0325). Until it is, every counting button answers *"Apply migration 0326"* and nothing is written. Once it is applied, the whole life of a count works on screen: **Create this count** (being planned) → **Release to Cycle Counts** (owner, signed) → an employee presses **Start counting** (one counter, D56) → each scan adds one package (D60) → **I'm done** (locks the count, sends it to the owner's review and puts a notice on the /admin cockpit, D55) → **Approve this result** → **Post**. The books quantity for each lot is captured **when that lot is first counted** (D58, D61), so counting during open hours is safe, and a sale between creating the audit and counting is no longer subtracted twice (F-06-7 FIXED). Two counts that disagree now **block** approval and posting until a third count settles them (F-06-13 FIXED). The owner can **Send back**, **Reassign** and **Cancel** (with a reason) on the audit page.

> **What the owner decided (v1.1, D54–D61).** The owner answered every open question. **Release** is a separate owner button after creating the audit, the way NetSuite and Lightspeed do it (D54). **I'm done** sends the count back to the audit and puts a notice on the /admin cockpit (D55). **One employee per count; the owner alone initiates** (D56). **Each scan adds one package** (D60). **Counting during open hours**, with the shelf quantity captured per lot when that lot is first counted, so sales in between are reconciled and never subtracted twice (D58, D61). **One full count a year at year end, plus a small count every day, about one vendor per day**, with intelligent generators to propose them (D58; §4.24). Old test sessions are cancelled (D59). **Built in v1.2 (Fix Phase 4.1–4.3):** D54, D55, D56, D58 (per-lot capture), D60, D61, and the D59 cleanup of held audits and open legacy sessions (done by migration 0326). **Still to build:** the intelligent generators and vendor of the day (G-40), the year-end full count (G-41). **Built in v1.3 (Fix Phase 4.4a, G-39):** one count schedule, the Issues reminder opens **Plan a count** for the owner, old cycle counts truly read-only, Pacific default name. **Built in v1.4 (Fix Phase 4.4b, G-38):** the daily checklists in the app at **Inventory → Daily Checklists** (needs migration 0327; §4.23). Until each is built, the interim rules for it in this SOP stay in force.

---

## Table of contents

1. Purpose & scope
2. Roles & permissions
3. Before you start
4. Procedures

   **Part 1: The two screens and the life of a count**
   - 4.1 Inventory Audits and Cycle Counts: who sees what
   - 4.2 The six stages of an audit
   - 4.3 What is frozen, what is blind, and what moves the shelf

   **Part 2: Setting up an audit and pushing it to Cycle Counts (owner)**
   - 4.4 Reading the Inventory Audits hub
   - 4.5 Planning a count: Plan a count
   - 4.6 Naming it and writing down why
   - 4.7 Approving the scope and pushing it to Cycle Counts (blocked: interim)

   **Part 3: The blind count (every employee)**
   - 4.8 Finding your count on the Cycle Counts page
   - 4.9 Opening the count sheet
   - 4.10 Counting: scan, type, zero, never blank
   - 4.11 The timing rule: count before anything sells
   - 4.12 A second count ("Count again")

   **Part 4: Review, approve, post (owner)**
   - 4.13 Closing the count: Finish counting and review the differences
   - 4.14 Reading the review page
   - 4.15 Reasons for each difference
   - 4.16 Approving the result
   - 4.17 Posting: correct the shelf and draft the entry
   - 4.18 Approving the journal draft in the books

   **Part 5: Records and related screens**
   - 4.19 The work paper (print or save as PDF)
   - 4.20 Older cycle counts (the retired sessions)
   - 4.21 "Stock needing recount" (oversold products)
   - 4.22 The "overdue for a cycle count" Issues row

   **Part 6: Daily checklists (every employee)**
   - 4.23 The daily checklists (Inventory → Daily Checklists)
   - 4.24 The counting programme: one full count a year, a small count every day, intelligent counts

5. Messages: "If you see this message"
6. Exceptions & escalation
7. Controls & compliance (why the rules exist)
8. Checklists & forms
9. Quick reference cards
10. Glossary

Appendix A: Source map · Appendix B: Not built yet (interim procedures) · Appendix C: Open questions for the owner · Appendix D: Revision history

---

## 1. Purpose & scope

**Purpose.** A cannabis retailer must be able to show that what is on its shelves is what its books say, and must document every difference. The state treats an undocumented shortage as a sale and taxes it: *"Product inventory reductions that are not adequately documented will be deemed to be sales and will be assessed the excise tax."* (WAC 314-55-089(4)(c), quoted in `inventory-audit-authorities.ts` L163–165). This SOP is how Greenway counts: the owner decides what is counted and why, the floor counts it blind, the owner reviews and signs the result, and the app corrects the shelf, reports the correction to CCRS and drafts the journal entry for the owner's approval.

**The owner's design, in his words** (from `docs/MICHAEL-books-23.md` and the code that quotes him):

- *"I approve the scope and push it to the cycle counts page. The employees then open the cycle count and record the counts. I think all we need to do is remove the create cycle count button in the employee page and have the created and opened cycle counts be listed in the table below."* (`cycle-counts/page.tsx` L17–20)
- *"When they finish the count, it should disappear from the cycle counts page and be redirected back to the inventory audit page where I can spot check and approve the change... So the audit inventory page will need a table and a way for me to open up the finished cycle counts."* (`audits/page.tsx` L98–101)
- *"For question 3, yes any employee can count, it should be a blind count without cost, variances, or the approve button."* (`roles.ts`, `inventory.count`)
- *"4, yes, I am the only one that can approve an audit and create an audit. Anything accounting, bookkeeping, taxes, finance, should be hard gated to me only."* (`roles.ts`, `inventory.audit`)
- *"Yes I meant create the draft and await my approval before auto posting."* (postings question 1; this is why posting an audit **drafts** the journal entry and does not post it, §4.17–§4.18)

**And for this SOP:** *"the inventory audits is specifically meant for owner only. the cycle counts and daily checklists are for all employees, admin, manger, sales. i want a very comprehensive sop written for me for setting up and pushing audits to the cycle counts page."* (D50–D52)

**In scope.** The Inventory Audits hub (`/admin/inventory/audits`), Plan a count (`/audits/new`), the audit page (`/audits/{id}`), the count sheet (`/audits/{id}/count`), the work paper (`/audits/{id}/export`), the Cycle Counts page (`/admin/inventory/cycle-counts`) including the oversold list and the retired sessions, the journal draft in the books, the CCRS Reconciliation row, and the daily checklists.

**Out of scope.** Single-lot hand adjustments (SOP-05a §4.6–§4.7; the lot-page reason **Cycle-count correction** is for owner-directed hand fixes only), receiving counts (SOP-04 §4.9), drawer and safe counts (SOP-01, SOP-02), destruction (SOP-15), the CCRS upload itself (SOP-16), store cleaning (SOP-07).

## 2. Roles & permissions

| Action | Who the app allows | Where the rule lives |
|---|---|---|
| See the **Inventory Auditing** menu item, open the hub, plan and create an audit, open an audit, write reasons, change the stage, approve, post, print the work paper | **Owner only** (`inventory.audit`) | `roles.ts` L143; nav `admin-nav-data.ts` L183 (Accounting group); pages `audits/page.tsx`, `audits/new/page.tsx` L76, `audits/[id]/page.tsx`, `audits/[id]/export/page.tsx` L86; actions `createAuditAction`, `saveReasonAction`, `moveStatusAction`, `postAuditAction` (`audits/actions.ts` L89–415) |
| See the **Cycle Counts** menu item and page; open a count sheet; record a count | **Owner, admin, manager, budtender** (`inventory.count`; budtender is the role `staff`, labelled "Budtender / Staff") | `roles.ts` L127; nav `admin-nav-data.ts` L89 (Inventory group); `cycle-counts/page.tsx` L86; `audits/[id]/count/page.tsx`; `saveCountAction` (`audits/actions.ts` L148–210) |
| Fill a missing unit cost (needed before an unvalued lot can post, §4.15) | Owner, admin (`inventory.cost.fill`) | `roles.ts` L149 |
| Open a retired cycle-count session, its export, or use its leftover buttons (§4.20) | Owner, admin, manager (`inventory.manage`) | `roles.ts` L107; `cycle-counts/[id]/page.tsx` L74; `cycle-counts/[id]/export/route.ts` L37; `cycle-counts/actions.ts` |
| Approve the journal draft that posting creates | Owner (books) | `postAuditSession` (`inventory-audit-store.ts` L396–520) does not pass auto-post; see SOP for the books |
| Read-only and content-editor logins | Cannot count, cannot open either screen | `roles.ts` L127 (not listed) |

A login without the permission is sent back to the back-office home with a "denied" notice (`requirePermission` redirects to `/admin?denied=1`).

**Store rules on top of the app.**
1. **The owner alone plans, approves, reviews, signs and posts** (D50; books-23 *"I am the only one that can approve an audit and create an audit"*). Nobody asks the owner for his login to "help".
2. **Counters never look up the expected number** on the lot page, the Inventory list, a report or a receipt while a count is open. A count that knows the answer is not a count (`cycle-counts/page.tsx` L136).
3. **One employee per count** (D56: *"Only one employee per scoped count."*). The owner names the counter on form 8.1 or the first employee to open the count takes it; nobody else enters numbers on that count. The sheet's text *"Ideally a different person does it"* (`AuditCountSheet.tsx` L203–209) is **withdrawn** by D56: the recount is done by the same counter (§4.12). The app does not yet stop a second person from entering numbers (F-06-15; gap G-36).
4. **Until F-06-6 is fixed, nobody enters numbers on a count sheet unless the audit says "being counted"**, and nobody re-opens a count sheet after the owner pressed **Finish counting** (§4.13).

## 3. Before you start

**Owner, before planning a count:**
- Pick a time when **nothing in the scope will sell between creating the audit and counting it** (§4.11): before opening or after closing. The quantities are frozen when you press **Create this count**.
- Check that the lots you want counted have a unit cost. A lot with no cost and a difference **cannot post** until the cost is entered (§4.15). Use Plan a count's stat cards and the lot page.
- Know who will count: **one employee per count** (D56). Write the name on form 8.1.
- Have printed copies of form 8.1 (audit planning record) and, until G-33 is built, form 8.2 (paper count sheet).

**Counter, before counting:**
- A working barcode scanner (Bluetooth or USB; it types into the box and presses Enter for you, `AuditCountSheet.tsx` L218–219), or the paper sheet.
- The whole scope pulled together in one place, including back stock and display (checklist step 1, `inventory-audit-core.ts` L1416+).
- Nothing in the scope being sold while you count. If a customer needs an item from the scope, stop and tell the manager (§4.11).

## 4. Procedures

### Part 1: The two screens and the life of a count

### 4.1 Inventory Audits and Cycle Counts: who sees what

| | **Inventory Auditing** (the hub) | **Cycle Counts** |
|---|---|---|
| Menu | Accounting group | Inventory group |
| Who | Owner only | Every employee who counts (owner, admin, manager, budtender) |
| Purpose | Plan the count, choose the scope and the reason, review differences, sign, post | Find the counts the owner has released, open the blind sheet, enter what is on the shelf |
| Shows cost and differences | Yes | **Never** |
| Subtitle on screen | (hub) | *"Counts the owner has approved and asked for. Open one and enter what you actually find on the shelf."* |

There is **no Create button on the Cycle Counts page**, by the owner's order (*"remove the create cycle count button in the employee page"*). When the queue is empty, it says: **Nothing to count right now** — *"When the owner approves a count it will appear here. There is nothing to start from this page — counts are planned and approved on the Inventory Auditing screen."*

### 4.2 The six stages of an audit

The app allows only these moves (`inventory-audit-post-core.ts` L113–119). The words in the middle column are what the screens show (L168–174).

| Stage (database) | Screen label | Where it appears | Allowed next | Button that does it (v1.2) |
|---|---|---|---|---|
| `draft` | **being planned** | Hub only | ready to count, cancelled | **Release to Cycle Counts** (owner, signed) · **Cancel this audit** (owner, reason required) |
| `scope_approved` | **ready to count** | Hub and Cycle Counts | being counted, cancelled | The counter's **Start counting** claims it; recording the first lot makes it **being counted** · owner **Reassign**, **Cancel this audit** |
| `counting` | **being counted** | Hub and Cycle Counts; the count sheet accepts numbers from the counter who claimed it | waiting for your review, cancelled | The counter's **I'm done** (count sheet) · owner **Reassign**, **Cancel this audit** |
| `review` | **waiting for your review** | Hub ("Waiting for you") and the /admin cockpit notice | approved, back to being counted, cancelled | **Approve this result** (owner, only when nothing blocks) · **Send back for more counting** · **Cancel this audit** |
| `approved` | **approved** | Hub ("Waiting for you" until posted) | none (final) | **Post this audit — correct the shelf and draft the entry** (once) |
| `cancelled` | **cancelled** | Hub, with *"Cancelled because: {reason}"* | none (final) | — |

An approval cannot be taken back: *"This audit has already been approved, and an approval cannot be taken back. If the result was wrong, the fix is a new audit and a correcting entry…"* (`canMoveStatus`, L128–165). The way back from review to counting is the owner's **Send back for more counting** button (v1.2).

### 4.3 What is frozen, what is blind, and what moves the shelf

1. **Written at creation, captured at count.** Pressing **Create this count** writes one line per lot, with the books' quantity and the unit cost **as they are at that moment** (the difference is no longer measured against this figure; see point 4) (`audit-hub-store.ts` L596–602). The page says so: *"Creating it freezes today's quantities and costs onto the sheet. Nothing moves on the shelf and nothing reaches the ledger."*
2. **Blind.** The count sheet never receives the expected quantity. The server sends only whether a lot needs a second count (`getCountSheet`, L671–750).
3. **Nothing moves until posting.** Counting, reasons and approval change no inventory. **Posting** (§4.17) changes the shelf quantity, writes an adjustment with reason **count** (reported to CCRS as **Reconciliation**, `ccrs-inventory-adjustment-core.ts` L66–67) and drafts a journal entry.
4. **How posting computes the change (v1.2, migration 0326).** When a lot is **first counted**, the books quantity for that lot is captured (`books_qty_at_count`). For each counted lot: *difference = (second count if there is one, otherwise first count) − the books quantity captured at first count*, and that difference is added to whatever the shelf says at posting time. A sale after the capture lowers the shelf and the books together, so it does not change the difference and is no longer subtracted twice (F-06-7 FIXED). If stock moved on a lot **while it was being counted** (between its first and last entry), posting is refused: *"INVENTORY_AUDIT_CUTOFF_MOVED: stock moved on {lot} while it was being counted. Count it again from zero; nothing was posted."* Lines counted before 0326 fall back to the quantity frozen at creation.

### Part 2: Setting up an audit and pushing it to Cycle Counts (owner)

### 4.4 Reading the Inventory Audits hub

Open **Accounting → Inventory Auditing**. Title **Inventory audits**, button **Plan a new audit**.

- **Stat cards:** **Audits in progress**, **Lots never counted**, **Past their count date**, **Not counted in a year**.
- **"Does your counting programme stand in for an annual count?"**: the hub's test against PCAOB AS 2510.11 (results *"substantially the same as those which would be obtained by a count of all items each year"*).
- **Waiting for you**: audits in review, and approved audits not yet posted. Columns **Audit / What it needs / Counted / Difference**, links **Review** / **Post**.
- **Audits**: every audit. Columns **Audit / Stage / Counted / Difference / Started**. Empty: **No audits yet.** with **Plan your first audit**.

> **Caution (F-06-4, partly fixed in v1.2).** Since migration 0326, **Counted** on the hub and the done / to-go figures on Cycle Counts update with every entry (`inventory_audit_record_count`). **Difference** still reads a total that the database writes **only when an audit is posted** (`audit-hub-store.ts` L203–205, L291–293; migration 0192 L394–400). Before posting it shows **$0.00**. Open the audit itself (§4.14) for the true figures.

### 4.5 Planning a count: Plan a count

1. Press **Plan a new audit**. The page is **Plan a count**: *"The system proposes what to count and says why. You decide, and you write down the reason -- before anyone sees a single number."*
2. Read the stat cards: **Products proposed**, **Lots to count**, **Value in scope**, **Products with several open lots**.
3. Read **How this list was chosen** and **Where the programme stands right now**. The proposal ranks lots by risk and by how overdue they are. The engine's count schedule is **A every 30 days, B every 60, C every 90, unclassified every 14** (`CADENCE_DAYS`, `inventory-audit-core.ts` L324–329). The Issues reminder and the Inventory intelligence panel use the same A/B/C numbers since v1.3 (`COUNT_CADENCE_DAYS`, `inventory-intel-core.ts`; F-06-8 FIXED).
4. Choose the list:
   - **Only what is due** (the default; up to 40 lots).
   - **Show every active lot instead** (up to 400 lots; adds `?all=1`). Back with **Back to only what is due**.
   - If nothing is due: **Nothing is due for a count today**, with **Show every active lot**.
   - **From a Cultivera import:** the import page links here with the flagged products. The banner reads **Counting the products your Cultivera import flagged**, with **Back to the import** and **Plan the usual count instead**.
5. Read **What the system proposes, and why**. **A product goes in whole**: every open lot of it is counted together; there is no ticking of single lots. An orange badge **Several open lots — count separately** means packages of the same product come from different batches and must be scanned package by package.
6. Record the scope on **form 8.1**, including the planned count time (§4.11).

### 4.6 Naming it and writing down why

Under **Name it and say why**:

1. **What to call this count**: the default is "{Month} {Year} count" in the store's time zone (`defaultAuditLabel`, `audit-count-flow-core.ts`; F-06-11 FIXED in v1.3). Late on the last evening of a month it no longer proposes next month's name. Use a name you will recognise in six months, for example "Flower back stock, August".
2. **Why these products**: at least 10 characters. One honest sentence. *"Highest value and longest since counted"* is enough. Too short and it refuses: *"Write one honest sentence about why THESE lots…"*
3. Press **Create this count — N lots**. You land on the new audit's page, status **being planned**.

**Why the reason comes first.** The reason is written before any number is known, so nobody can later choose the scope to fit the result. The audit page shows it under *"Why these products were chosen — written before the numbers were known"*.

### 4.7 Approving the scope and pushing it to Cycle Counts: Release to Cycle Counts

**What the owner asked for.** *"You approve the scope, and approving it is what pushes the count out to the floor."* (`MICHAEL-books-23.md` L55–59). The owner chose the enterprise pattern (D54: *"Please do what the pros would do."*): create first, release as a separate signed act, as NetSuite does (a count is created and then **started** by a separate action).

**Procedure (owner, v1.2):**
1. **Create** the audit (§4.5–§4.6). It is **being planned**, visible only to you.
2. Open it. Check the scope. Under **What happens next**, press **Release to Cycle Counts**. The app records your name and the time as the scope approval. The audit is now **ready to count** and appears on the Cycle Counts page.
3. The first employee to press **Start counting** on the sheet **claims** it (one counter, D56). Their name shows on the queue (*"{name} is counting"*) and on your audit page (*"{name} is counting this one (started {time})."*). Until then the page says *"Released to Cycle Counts. Nobody has pressed Start counting yet."*
4. The audit becomes **being counted** when the counter records the first lot. Each lot's books quantity is captured at that lot's first count (§4.3, §4.11).
5. The counter presses **I'm done** (§4.8). The audit comes back to you as **waiting for your review**, with a notice on the /admin cockpit (D55).

**Reassign.** While the count is on the floor (**ready to count** or **being counted**), the audit page has a **Reassign** list. Pick a person to hand the count to them, or *nobody* to free it for whoever presses **Start counting** next. It is recorded in the audit log.

**Cancel.** Before approval, the audit page has **Cancel this audit** with a box *"Why is this audit being cancelled?"*. A reason of at least five characters is required (*"AUDIT_CANCEL_REASON: write why this audit is being cancelled."*). The reason shows on the audit as *"Cancelled because: {reason}"* and is in the audit log. An approved audit cannot be cancelled.

**Do not** change a stage in the database. Every move now has a signed button.

**Old held audits (D59).** Migration 0326 cancelled every audit that was still being planned, ready or being counted, and every open legacy cycle count, with a recorded reason, because they were test data (*"be canceled, we are not live yet. It's all test data."*).

### Part 3: The blind count (every employee)

### 4.8 Finding your count on the Cycle Counts page

1. Open **Inventory → Cycle Counts**. Read the panel **How counting works**.
2. Under **Counts waiting for you**, each count shows its name, **{n} lots to count**, the owner's reason, its stage badge and who is counting it (*"· {name} is counting"* or *"· nobody has started"*).
3. The done / to-go figures update as lots are counted (migration 0326). The sheet itself shows the live progress.
4. **When every lot has a number, press I'm done** on the sheet (D55). It is live only when no lot is blank; next to it the sheet says why (for example *"2 lots are still blank. Blank is not zero: count them, or type 0 if the shelf is empty."* or *"Every lot has a number. Press I'm done and the count goes to the owner."*). Pressing it **locks the counts**, takes the count off the Cycle Counts page, sends it to the owner as **waiting for your review**, and puts *"Count finished and waiting for your review: {name}."* on the owner's /admin cockpit, linked to that audit. You land back on Cycle Counts with *"Thank you. The count is locked and has gone to the owner for review."* You are done.
5. Only the person who pressed **Start counting** (or the owner) can press **I'm done**.

### 4.9 Opening the count sheet

Press the count's name. The page title is the count's name, with: *"{stage} — count what is on the shelf and enter what you find. You will not be shown what the system expected."*

- The owner-only links (**Review and finish**, the **Auditing** breadcrumb) are shown **only to the owner**; everyone else sees a **Cycle Counts** breadcrumb (F-06-3 FIXED).
- At the top, a banner says who is counting. If nobody has claimed the count, it offers **Start counting**: press it to claim the count (D56). If someone else is counting, the sheet is read only and names them; ask the owner to **Reassign** if they cannot finish. If the count is in review, approved or cancelled, the sheet is read only.
- The section **How to count** at the bottom is the built-in counting checklist (G-39; F-06-10 FIXED: each scan adds one, as the checklist says).
- The panel at the bottom explains why the sheet hides the expected numbers.

### 4.10 Counting: scan, type, zero, never blank

1. **Gather every package** of each product in scope: shelf, back stock, display case, anywhere a package could be. **Count each lot in one go** once you start it.
2. **Scan every package.** Under **Scan a package** (*"Scan or type a lot code, then press Enter"*; the box re-focuses itself), scan each package of the lot. **Each scan adds one** to that lot's count (D60, Lightspeed: *"Scan the same item multiple times to increase the counted quantity."*). The screen answers *"Recorded. Scan the next package."*
3. **A lot that already has a number.** If a scan would add to a lot you have already counted earlier, the sheet stops and asks **"{product} already has a number"**, with three answers: **Add this one to the count** (*"You found another package of the same batch."*), **Type the right total** (*"The number on screen is wrong; enter what you have now."*), **Count this lot again from zero** (*"Start this batch over. Your first number is cleared."*), and **Cancel** (*"Cancelled. Nothing was recorded."*). A scan never silently becomes a second count (F-06-5b FIXED).
4. **A close match** (the code read is near but not exact) never counts on its own: the sheet opens **"Close match — check the label, then type the total"**.
5. **If the scanner will not read** a label, press **enter by hand** on that lot's row in **The count sheet** table and type the total (**How many are there in total**, **Record this total**). The record notes *"Recorded as a hand-typed count — the label was not read by the scanner."* Tell a manager so the label can be fixed. A counted lot offers **type a total** to correct it.
6. **Found none? Type 0.** Zero is a real count. **Blank means nobody looked**, and **I'm done** stays off while anything is blank.
7. **Several open lots of one product:** read the lot code on each package, sort the packages into a pile per lot, and scan or type each pile on its own row.
8. **Damaged, wrong place, missing:** the sheet has no note box. Write it on form 8.4 with the lot code.
9. Watch the progress line: *"{done} of {n} lots counted"* / *"{n} still blank"*. When nothing is blank, press **I'm done** (§4.8).

**Every entry is checked by the database (migration 0326):** only owner, admin, manager or staff sign-ins can count; only the person who claimed the count; only while it is ready or being counted (*"AUDIT_LINE_STAGE: this count is {stage}, so numbers can no longer be entered."*, F-06-6 FIXED); a count cannot be negative.

### 4.11 Counting during open hours: the per-lot cutoff

**What the owner decided.** Counting *"anytime during open hours"* (D61), with the system *"smart enough to know that when they start the count and finish it, the sales in between should be reconciled"* (D58).

**How it works (v1.2, migration 0326, G-35 built).** The books quantity for each lot is captured **when that lot is first counted**, not when the audit was created or released (Lightspeed: *"Once at least one unit of an item has been counted, the QOH for the item will be recorded."*). The difference is *count − that captured quantity*. A sale after the capture lowers both the shelf and the books, so it does not change the difference (Lightspeed: *"Sales or added inventory don't change a discrepancy."*).

*Example:* the audit is created with 100 on the books. Five sell before anyone counts. The counter scans the lot: the books now say 95 and that is captured. The counter counts 95. The difference is 95 − 95 = 0, and posting changes nothing. (Before 0326 this posted −5 and left 90; F-06-7 FIXED.)

**The one thing that is still refused.** If stock on a lot moves **while that lot is being counted** (between its first and its last entry), the review page shows it on that line and posting is refused for the whole audit (*"INVENTORY_AUDIT_CUTOFF_MOVED: … Count it again from zero; nothing was posted."*). Send the audit back and have the counter use **Count this lot again from zero**, which captures the books again.

**Counter rules (from the same source):**
1. **Count each lot in one go** once you start it.
2. *"If an item is partially counted, don't sell any uncounted units."* If a customer wants a package from a lot you are in the middle of, finish that lot first.

**Work paper and explainer.** The work paper's method line and the hub's ISA 501.A5 explainer were corrected in v1.2 to describe the per-lot capture.

### 4.12 A second count ("Count again")

**What it is.** The owner asked: *"what second count? I am not sure I understand."* The "second count" is the app's own check, not a second employee. When a lot's first count is off from the books by **$50 or more at cost** (`DEFAULT_MATERIALITY` recountAtCents 5000, `inventory-audit-core.ts` L767–771), the sheet asks for the lot to be **counted again from scratch**, without being told the expected number. Counting twice catches the most common error: a package missed in a second location.

**What the owner decided (D56).** *"I am the only one who will initiate a cycle count. Any employee may count inventory. Only one employee per scoped count."* So the recount is done by **the same counter**, before they finish. The sheet's old line *"Ideally a different person does it"* was removed in v1.2. If the owner wants a different person to count, the owner sends the lot back or plans a new audit (an **owner-initiated re-count**).

What you see:
- The notice reads: *"N lots need a second count. You are told THAT they disagreed, never by how much — a second count that knows the target is not a second count. Scan each package of that lot again; each scan adds one to the second count."*
- The lot's row shows the badge **Count again**.

**Procedure (the counter, v1.2):**
1. Recount the lot fresh, from scratch, all locations. Do not look up the first number.
2. **Scan** each package of the lot again. While a second count is asked for, each scan adds one to the **second count**. If a label will not scan, press **type a total** on the row and type the second count.
3. If the two counts still disagree, the row shows **Counts disagree**. Count once more and press **third count** on the row (or scan, which opens it): the third count settles the count it agrees with.
4. Two counts that disagree **block approval and posting** until settled (F-06-13 FIXED). **I'm done** stays available and says *"…still need another count. The owner will send it back if it must be counted again."*

### Part 4: Review, approve, post (owner)

### 4.13 Closing the count: the counter's I'm done

1. The counter presses **I'm done** (§4.8). The count is locked and comes to you as **waiting for your review**. The /admin cockpit shows *"Count finished and waiting for your review: {name}."*; press it to open the audit.
2. The audit page says *"Counted by {name}, finished {time}."*
3. Nobody can enter numbers any more (the database refuses them, F-06-6 FIXED).
4. If something must be counted again, press **Send back for more counting**. The count returns to the same counter on the Cycle Counts page. Use **Reassign** first if someone else should count it.

The owner's old button **Finish counting and review the differences** was removed (D55: the counter finishes).

### 4.14 Reading the review page

- **Header** with the stage badge, **View the count sheet**, **Work paper**.
- **Stat cards:** **Lots in scope**, **Exactly right**, **Total error found** (the gross amount: every over and short added up as positive), **Net effect on the books**.
- **Read the gross number, not the net one.** A $200 shortage and a $200 overage net to $0 but mean two problems.
- **Why it is blocked** (the blockers list), or **Nothing is blocking this audit**.
- **Line by line** (blockers first). Each line shows the figures, the **Difference**, the **Money effect** and the engine's verdict, for example:
  - *"Counted exactly what the books said. Nothing to do."*
  - *"Off by $X, which is under your $20 threshold…"* (immaterial: $20 or 2%, `DEFAULT_MATERIALITY`)
  - *"This is off by $X… Count it again WITHOUT looking at the first number…"* (needs a second count)
  - *"The first count said A and the second said B… Do not average them. Go and look again."* (second count disagrees)
  - Material shortage: *"…taxed at 37%… Pick a reason and write one honest sentence…"*
  - Overage: *"MORE on the shelf than the books said. Found product is not free money…"*
  - *"This lot has no cost on file…"* (unvalued)

The blockers that stop **Approve this result** (`readinessOf`, `inventory-audit-core.ts` L1109–1210): lines not counted; lines needing a second count; a merge pattern (*"…must be re-counted package by package…"*); *"N lines cannot post yet — either a shrink has no explanation, or a lot has no cost on file."*

**Disagreeing counts now block (F-06-13 FIXED, v1.2).** A lot whose second count disagrees with the first is a blocker, and posting refuses it as well (*"INVENTORY_AUDIT_RECOUNT_DISAGREES: the two counts disagree on {lot}. One of them is wrong; nothing was posted."*). Press **Send back for more counting**; the counter takes a third count. Or cancel the audit with a reason.

**Stock that moved while a lot was counted** is shown on that line (*"Stock moved while this lot was being counted ({n} sold or removed). … Posting is refused until then."*) and blocks posting until the lot is counted again from zero (§4.11). Lines counted before migration 0326 say *"Counted before per-lot capture existed; compared with the books when the audit was created."*

### 4.15 Reasons for each difference

A line that needs documentation shows **Why did this differ?** (editable only while **waiting for your review**):

| Reason on screen | Use when |
|---|---|
| **Earlier miscount — the shelf was always right** | The books were wrong because of an earlier counting or receiving error |
| **Damaged — broken, spilled, or unsaleable** | Damage found (product goes to quarantine and SOP-15) |
| **Expired — past its date and pulled** | Pulled for expiry |
| **Theft or diversion — somebody took it** | Theft suspected; also SOP-20 incident and the owner |
| **Sold but not rung up correctly** | A sale went through under the wrong item or not at all |
| **Unknown — nobody can say what happened** | Tagged **taxed as a sale** (WAC 314-55-089(4)(c)) |

1. Pick the reason. There is no default.
2. **Always write the note** in the same step (placeholder: *"One sentence of detail. 'Jar cracked in transit' is enough."*). A **material shortage needs both a reason and a note**.
3. Press **Record this reason**.

**Changing a reason (v1.2, F-06-14 FIXED).** Until you approve, a line that already has a reason shows **Change the reason**: open it, pick the reason, write the note, and save. The old and new reason are both kept in the audit log. A reason that is not on the list is refused (*"AUDIT_BAD_REASON: pick one of the reasons on the list."*), by the app and by the database. Approval and posting still require every material shortage to have a reason and a note.

**A lot with no cost on file** and any difference blocks approval until the cost is entered by the owner or an admin (`inventory.cost.fill`; SOP-05a and SOP-05b §4.7 for non-cannabis). Enter the cost from the CCRS manifest (D49: *"blocked until the manifest cost is entered."*), then reopen the audit.

### 4.16 Approving the result

When nothing blocks and you have checked §4.14 by eye (gross reviewed, reasons right):

1. Read: *"Everything the system checks for is satisfied. Approving records YOUR NAME and the time against this result — it is a signature, not a formality. It does not move any inventory by itself."*
2. Press **Approve this result**. The stage becomes **approved**. **This cannot be undone.**
3. If the button is missing, the page says *"There is no approve button on this page yet, and that is deliberate rather than a fault. The items above have to be cleared first."* Clear the blockers.

### 4.17 Posting: correct the shelf and draft the entry

1. Sales after a lot was counted are reconciled automatically (§4.11). Posting refuses an audit with disagreeing counts or stock that moved mid-count, and changes nothing.
2. Press **Post this audit — correct the shelf and draft the entry**. Read the note: *"You can only do this once…"*
3. What posting does (migration 0192; `postAuditSession`, `inventory-audit-store.ts` L396–520):
   - For each counted lot with a difference, adjusts the shelf by the difference, with reason **count** and the note *"Inventory audit "{label}": counted X, books said Y."* CCRS receives it as **Reconciliation**.
   - Stamps every counted lot's last-counted date (this is what keeps the count schedule honest).
   - If any lot would go below zero, **nothing at all** is changed (*"Applying this audit would leave less than nothing on a shelf… Nothing was changed — not even the lots that would have worked."*).
   - Lots with no recorded cost: the shelf is corrected but no money moves for them.
   - Drafts one journal entry dated the approval date, memo *"Inventory count adjustment — {label}"*. **It is a draft.**
4. Success reads: *"…A general ledger entry has been DRAFTED for your approval — it has not been posted."* If none was needed: *"…No general ledger entry was needed, because none of the corrected lots have a recorded cost…"*. If the draft failed: *"The shelf was corrected, but the general ledger entry could not be drafted: …"* (record it on form 8.3 and escalate, §6).

### 4.18 Approving the journal draft in the books

1. Open **Books → Journal** (the posting refreshes `/admin/books/journal`).
2. Find the draft with memo *"Inventory count adjustment — {label}"*. Check the amount against the audit's **Net effect on the books** (valued lots only).
3. Approve it there. Until you do, the inventory value in the books does not match the shelf.
4. Tick it on form 8.1.

### Part 5: Records and related screens

### 4.19 The work paper (print or save as PDF)

**Work paper** on the audit page opens a printable record (owner only): **1 Scope**, **2 Method**, **3 Materiality**, **4 Results**, **5 Exceptions**, **6 Outstanding items** and **What this count does and does not establish**. Use the browser's print, or **Save as PDF**. File it with forms 8.1–8.3 for **five years** (WAC 314-55-087). Note the work paper's mid-count-sale line is only true when §4.11 was followed (F-06-7).

### 4.20 Older cycle counts (the retired sessions)

Cycle Counts ends with **Older counts (read only)**: the sessions from the old cycle-count tool, before audits replaced it. Opening one needs owner, admin or manager.

Since v1.3 (Fix Phase 4.4a, G-39) an old session is **truly read only**. The page says *"Read only. This is an old cycle count, kept for the record. Nothing on this page can change it."* and links back to **Cycle Counts**, where counting happens with **Start counting**. There is no **Cancel** button, no scanner, no import and no **Enter count** column; the server actions behind them were deleted, and the library functions refuse with *"CYCLE_COUNT_READ_ONLY: old cycle counts are kept for the record and can no longer be changed. Nothing has been written…"* (`cycle-counts.ts`). You can still filter the lines and use **Export to Excel** or **Export CSV**. **Owner decision D59:** *"be canceled, we are not live yet. It's all test data."* Migration 0326 cancelled every open old session (F-06-9 FIXED).

### 4.21 "Stock needing recount" (oversold products)

The Cycle Counts page lists products the register sold past their tracked count, with **view sale** links and the badge **Recount**. It says: *"Nothing on this list can be corrected from here…plan it on the Inventory Auditing screen."*

- **Counter:** if you see a product here, tell the manager. Do not adjust it.
- **Owner:** include those products in the next audit (§4.5), or follow SOP-05a §4.22. Times on this list are in the store's time zone (Pacific).

### 4.22 The "overdue for a cycle count" Issues row

Inventory → Issues may show *"{n} lots are overdue for a cycle count"*, meaning *"Past their count schedule (A every 30 days, B every 60, C every 90, the same schedule Plan a count uses)…"* (`issues-core.ts`, `intel_count_overdue`).

- **One schedule (v1.3, F-06-8 FIXED).** The reminder, the Inventory intelligence panel and **Plan a count** all use A 30 / B 60 / C 90 days. **Owner decision D58** sets the programme in §4.24 (about one vendor a day, plus a full count at year end); the A/B/C schedule is the risk ranking the intelligent counts use (G-40).
- **Owner:** the row says *"Plan a count for these lots, then release it to Cycle Counts."* with the button **Plan a count** (§4.5).
- **Everyone else:** the row says *"Only the owner can plan a count. Tell the owner these lots are overdue."* and has no button, because only the owner can start a count (D56).

### Part 6: Daily checklists (every employee)

### 4.23 The daily checklists (Inventory → Daily Checklists)

The owner asked for *"Checklists for daily tasks like cycle counts I initiate via the inventory audit feature"* and said they are *"for all employees, admin, manger, sales"* (D51). Since v1.4 (Fix Phase 4.4b, G-38; F-06-12 and F-00-9 FIXED) they are in the app: **Inventory → Daily Checklists** (`/admin/inventory/checklists`, `src/app/admin/inventory/checklists/page.tsx`). Every employee who can count (`inventory.count`: admin, manager, budtender and the owner) sees it.

**Migration 0327 must be applied first** (`supabase/migrations/0327_daily_checklists.sql`, after 0326). Until it is, the page shows *"CHECKLIST_MIGRATION_PENDING: apply migration 0327_daily_checklists.sql in the Supabase SQL editor (after 0326). Until then use paper forms 8.5-8.8 (SOP-06 §4.23). Nothing was saved."* and the paper forms in §8 stay the record.

**The six lists.** Tabs across the top: **Opening**, **During the shift**, **Closing**, **Weekly**, **Monthly** and **Year end**. Each list is one sheet per period: one per day for the three daily lists, one per week (starting Monday) for weekly, one per month and one per year (`checklistPeriodKey`, `daily-checklist-core.ts`). The period is always today in the store's time zone, worked out by the server, never by the browser. The sheet header says which paper form it replaces (*"Replaces paper form 8.5 (SOP-06 §8). N of M done."*). Migration 0327 seeds the lists from forms 8.5–8.8 word for word: 61 tasks (opening 19, during the shift 15, closing 11, weekly 10, monthly 5, year end 1).

**Initial a task as you do it.** Each task shows its wording and, under it, links to where the procedure lives: an SOP section opens the SOP library at that heading (for example *SOP-05a §4.16*); a bare *§4.x* opens this SOP; a screen name (for example *Marketing & Advertising*, *Blog & Newsletter*, *Product Enrichment*) opens that screen; an SOP that is not written yet shows *"(SOP not written yet)"*. Your initials are filled in from your name; change them if needed (1 to 4 letters), add a note if useful, and press **Initial**. The row is struck through and shows your initials and the Pacific time. A task cannot be initialled twice on the same sheet (*"CHECKLIST_ALREADY_DONE: that task is already initialled on this sheet. Nothing was saved."*), and an initial cannot be changed or removed. Anyone with Cycle Counts initials the three daily lists; **weekly, monthly and year end are initialled by a manager, admin or the owner** (form 8.8; *"Only a manager, admin or the owner initials the weekly, monthly and year-end tasks (form 8.8). Nothing was saved."*).

**The live Cycle Counts line.** The tasks that begin *"Cycle Counts page checked"* show a gold line read live from the count queue, for example *"2 counts waiting on Cycle Counts: 1 not started, 1 being counted by Ana."* or *"No counts waiting on Cycle Counts right now."*, with an **Open Cycle Counts** link. Counting itself is still §4.8–§4.12.

**Sign-off (manager, admin or owner).** Once the first task is initialled, **Sign off this sheet** appears. If every task is done, sign off with an optional note. If tasks were left, the note is **required** (at least 3 characters): say why (*"Why tasks were left (required)"*). The server counts what is open; the form cannot. After sign-off the sheet is locked (*"CHECKLIST_SIGNED_OFF: this sheet is already signed off. Nothing was saved."*) and shows *"Signed off by {name} · {time}"*.

**The owner edits the tasks (D57).** The owner presses **Edit the tasks** to reword a task, move it to another section, change its SOP reference or order, **retire** it (untick Active), or add a new one to any list. A retired task leaves the list but stays on old sheets exactly as it was worded then (each initial keeps a copy of the wording). Every edit is recorded in the audit log with the before and after. Re-applying migration 0327 never overwrites the owner's edits.

**Records.** **Recent sheets** lists the last sheets with who signed them off. Sheets, initials and tasks can never be deleted (database guards in 0327); keep them five years with the store's other records (WAC 314-55-087). If the app is down, use paper forms 8.5–8.8 and file them by month as before.

**What the owner asked to be on them (D57).** *"Tasks should include cleaning, organizing, stocking, marketing content like website banners, flyers, newsletters, blog posts, social media posts, in store content, yard banners, inventory management like product enrichment, making sure products get heavily discounted before expiring. Plus any other small retail business daily duties that you think ought to be included as well. Use your professional expert judgement when adding value there."*

**How the forms are built.** Every line names where its procedure lives:
- **An SOP section** (for example *SOP-01 §4.x*) when a written SOP covers it.
- **The screen** (for example *Marketing & Advertising*, *Blog & Newsletter*, *Shop Banner*, *Product Enrichment*) when the app has the tool but its SOP is not written yet (SOP-10, SOP-11, SOP-12, SOP-13 on the roadmap).
- **owner-directed (D57)** when it is a store task no SOP covers yet (cleaning is SOP-07; opening and closing is SOP-18; security is SOP-20). The detailed method for those comes with that SOP; the checklist line only makes sure the task is done and initialled.

**The professional additions, and why each is there** (expert judgement, as the owner asked):
- **Security and cameras** (cameras recording, alarm armed and disarmed, doors and safe): Washington retailers must keep surveillance running and secure the premises (WAC 314-55-083). It is the first thing an LCB officer checks.
- **ID scanner and age signage**: every sale needs a valid ID check (SOP-19 on the roadmap). A dead scanner discovered at 4 pm is a lost afternoon.
- **Compliance signage and display rules** (no product visible from outside, required warnings posted): an officer can cite the store for a missing or covered sign.
- **Online orders queue**: an unseen pickup order is a lost customer (**Online Orders**, SOP-13 on the roadmap).
- **Expired and expiring stock**: the Issues tab and the Sell-first list, so nothing expired is sold and soon-to-expire stock is discounted in time (SOP-05a §4.16).
- **Safety walk** (trip hazards, exits clear, first-aid kit stocked): basic employer duty and cheap to check.
- **Customer-facing readiness** (menus and price tags match the register, display cases clean and lit, music and lights on): the standard small-retail opening walk.

**Heavy discounts before expiry (the owner's rule).** The owner's markdown rule is recorded in the code: *"a 50% off products we have been sitting on for too long and things about to expire"*, excluded from every other deal (`src/lib/promotions/markdown-lock-core.ts` L8–11). The pricing engine has the lock that keeps a clearance item out of other deals (`markdownOnly`, `discount-engine-core.ts` L169), but **no admin screen sets it** (no use in `src/app` or `src/components`; finding F-06-17). So the daily line is: read **Inventory → Issues** (*"N lots expiring within 30 days"*) and **Inventory → Insights → Sell first (FEFO)** (SOP-05a §4.16), move those units to the front, and **list them for the owner**; the owner sets the markdown. G-38 adds an expiring-soon list to the checklist with a link to mark items down when the clearance screen exists.

**The cycle-count line.** Each checklist has the line *"Cycle Counts page checked; today's count claimed and done, or handed over"*. Under D58 there is a small count to do **every day** (§4.24).

### 4.24 The counting programme: one full count a year, a small count every day, intelligent counts

**What the owner decided (D58).** *"we do a full inventory audit once per year at the end of the year. My plan for cycle counts is to issue small counts the employees can do everyday to keep inventory accurate. Something like a vendor per day, broken into chunks if a large vendor, or if small enough, to do on their own."* And: *"I also want options for initiating intelligent cycle counts."*

**1. The annual full count (year end).** One wall-to-wall count of every lot, once a year at the end of the year. Today it is done as one audit using **Show every active lot instead** on Plan a count (§4.5), which stops at **400 lots** (§4.5 step 4). A store with more open lots than that needs several audits, split by vendor or category, planned the same day (write all of them on form 8.1). Gap **G-41** adds a proper annual count: every lot with no cap, split into counter-sized sections, one release, one combined review and one work paper for the accountant. Until G-41 and G-35 are built, the annual count is done **outside selling hours** (§4.11).

**2. The daily count (about one vendor a day).**
- **Today (interim):** Plan a count proposes lots by risk and due date, not by vendor (§4.5). The vendor name shows on each product group (`audits/new/page.tsx` L388) but the planner cannot filter by vendor. So: open **Show every active lot instead**, pick today's vendor from your rotation list (form 8.1), and plan a count containing only that vendor's products. If a vendor has more products than one employee can count in about an hour, split it into chunks (for example by category) and plan one count per chunk across the week. Remember the timing rule: until G-35 is built, create and count **before opening or after closing** (§4.11).
- **When G-40 is built (APPROVED):** the planner offers **Vendor of the day**. It rotates through every vendor with open lots, splits a large vendor into chunks of a size you set (lots or estimated minutes), and proposes the next chunk each day. You release it (§4.7) and any employee claims it.

**3. Intelligent counts (G-40, APPROVED).** Options the owner can choose to propose a count, each explaining why it chose each lot:

| Generator | What it picks | Why professionals use it |
|---|---|---|
| **Vendor of the day** | The next vendor (or chunk) in the rotation | Small daily counts cover the whole store over a cycle (the owner's plan) |
| **High value / ABC** | A-class lots more often than C | Most of the money sits in a few products (the A/B/C ranking already in the planner, `CADENCE_DAYS`, `inventory-audit-core.ts` L324–329) |
| **Exceptions** | Oversold products (**Stock needing recount**, §4.21), lots adjusted recently, open 86s, zero on hand with recent sales | A count is cheapest where the books are already known to be doubtful |
| **Expiring soon** | Lots expiring within 30 days | Confirms what is on the shelf before the markdown (§4.23) |
| **Cultivera-import flags** | Products the import flagged | Already exists (§4.5 step 4) |
| **Never counted / overdue** | Lots never counted or past their date | The hub's own stat cards (§4.4) |

Each generator only **proposes**. The owner still names it, writes why, creates it and releases it (D50, D54). Only one open count per lot at a time (NetSuite: *"Until an inventory count is completed, you cannot start a new inventory count for that item."*).

## 5. Messages: "If you see this message"

### 5.1 Planning and creating (owner)

| Message (screen text, abbreviated only where marked …) | What it means | Do this |
|---|---|---|
| *"Write one honest sentence about why THESE lots…"* (SCOPE_RATIONALE_TOO_THIN) | The reason is under 10 characters | Write a real sentence (§4.6) |
| *"Give this audit a name you will recognise in six months — 'Flower back stock, August' beats 'Audit 4'…"* (NO_LABEL) | No name | Name it |
| *"An audit with nothing in it is not an audit. Pick at least one product group to count."* (EMPTY_SCOPE) | Empty scope | Pick products or show every active lot |
| *"{n} of the {m} batches you selected could not be found…"* (LOT_NOT_FOUND) | Lots changed since the page loaded | Reload **Plan a count** and create again |
| **Nothing is due for a count today** | Nothing past its schedule | **Show every active lot** if you still want to count |
| *"That lot is already on this audit…"* | Duplicate line | Nothing to do |

### 5.2 Counting (every employee)

| Message | What it means | Do this |
|---|---|---|
| *"No quantity was entered. If the shelf is empty, type 0 deliberately…"* (BLANK_IS_NOT_ZERO) | Blank entry | Type the number, or 0 |
| *""{raw}" is not a quantity the system can use. Enter digits only -- for grams a decimal like 3.5 is fine."* (NOT_A_NUMBER) | Letters or symbols | Digits only |
| *"A count cannot be negative. You can have none of something, but not less than none. Enter 0 if the shelf is empty."* (NEGATIVE_COUNT) | Negative number | Enter 0 or the real count |
| *"That batch is not part of this audit…Finish this one, then start another that includes it."* (LOT_NOT_IN_SCOPE) | Lot not in scope | Put it aside; note it on form 8.4 for the owner |
| *"Nothing in this count matches "{code}"…Nothing was recorded."* | Scan matched nothing | Check the label; it may be outside scope; note it on form 8.4 |
| *"…so the system will not guess which one you are holding. Pick it from the list below instead…"* | Code matches more than one lot | Use **enter by hand** on the right row (only offered for uncounted lots; F-06-5) |
| *"Close match on {lot}. Check the label agrees before entering a number."* | Fuzzy match | Read the label; enter only if it agrees |
| *"Recorded. Scan the next package."* | Saved | Next lot (§4.10 step 4) |
| *"That audit could not be found."* (NOT_FOUND) | Wrong or old link | Go back to Cycle Counts |
| Title **That entry was not recorded** | Any refusal on the sheet | Read the text; nothing was saved |
| *"You do not have permission to do that. Counting is staff work; approving an audit and moving the books is the owner's. Nothing was changed."* | Role not allowed | Tell the manager |
| *"Nothing was saved. The database accepted the request to {what} but changed no rows…"* (WRITE_BLOCKED) | The save silently failed | Try once more; then stop and tell the owner |
| *"A count has to record who took it and when…"* / *"You cannot record a recount for a lot that was never counted the first time…"* | Database guards | Tell the owner |

### 5.3 Review, approval and posting (owner)

| Message | What it means | Do this |
|---|---|---|
| *"Pick a reason before saving. A difference with no reason is treated by the state as a sale you did not report."* (MISSING_REASON) | No reason chosen | Pick one, with a note |
| *"N lines have not been counted. Blank is not zero…"* | Uncounted lines | Not fixable after Finish counting today (no button back, F-06-1); new audit for those lots |
| *"N lines need a second blind recount before posting."* | Second counts missing | Same as above while the sheet is closed; see §6 |
| *"N lines cannot post yet — either a shrink has no explanation, or a lot has no cost on file."* | Reason/note missing, or no cost | §4.15 |
| *"…must be re-counted package by package…"* | Merge pattern across lots | Re-count those packages one by one in a new audit |
| *"An approval has to be signed…"* (NO_APPROVER) / *"An approved audit has to name who approved it. Nothing was changed."* | Signature missing | Sign in again as the owner and retry |
| *"This audit is already {label}. Nothing to change."* | Double press | Nothing |
| *"This audit has already been approved, and an approval cannot be taken back…"* | Approval is final | New audit and a correcting entry |
| *"This audit was cancelled. A cancelled audit stays cancelled — start a new one…"* | Final | New audit |
| *"An audit that is {from} cannot jump straight to {to}. From here the only options are: …"* (ILLEGAL_MOVE) | Skipped a stage | Follow §4.2 |
| *"Only an approved audit can change inventory. Nothing was posted."* (NOT_APPROVED) | Not approved | Approve first |
| ALREADY_POSTED / *"…already recorded a correction…"* | Posting twice | Nothing; check the shelf |
| *"Every line in "{label}" matched the books exactly… no entry is needed."* (NOTHING_TO_POST) | Clean audit | File the work paper |
| *"Applying this audit would leave less than nothing on a shelf… Nothing was changed — not even the lots that would have worked."* (INVENTORY_AUDIT_NEGATIVE) | A lot sold below the count since the freeze (§4.11) | Do not post; plan a new audit |
| *"Only the owner can post an inventory audit…"* (INVENTORY_AUDIT_FORBIDDEN) | Not the owner | Owner only |
| *"That audit session does not exist. Nothing was changed."* / *"That audit could not be identified, so nothing was posted."* | Wrong link | Open from the hub |
| *"…A general ledger entry has been DRAFTED for your approval — it has not been posted."* | Success | §4.18 |
| *"The shelf was corrected, but the general ledger entry could not be drafted: …"* | Books draft failed | Form 8.3; §6 |
| *"The inventory audit tables are not installed yet. Apply migration 0191 and then 0192…"* | Database not set up | Developer |
| *"That could not be saved: {text}"* (AUDIT_HUB_ERROR) / INVENTORY_AUDIT_ERROR / MIGRATION_OUT_OF_ORDER | Unexpected | Screenshot; developer |

## 6. Exceptions & escalation

| Situation | Do this | Who |
|---|---|---|
| A new audit is stuck in **being planned** | Expected today (F-06-1). Use the paper interim, §4.7 | Owner |
| Something in scope sold after the audit was created | Do not approve or post. Form 8.1 note; new audit (§4.11) | Counter tells manager; owner decides |
| A lot was entered wrong, or a second package scanned after recording | Stop. Form 8.4. Owner re-counts that lot in a new audit or by hand adjustment with a note | Counter → owner |
| Second count disagrees with the first | Do not approve. Paper re-count (form 8.2) by a third person | Owner |
| Reason saved without a note, or the wrong reason | Not fixable on screen (F-06-14). Leave unapproved; new audit for those lots | Owner |
| Lots left blank after **Finish counting** | No way back on screen (F-06-1). New audit for those lots | Owner |
| Posting refused for negative stock | Do not retry. Plan a new audit | Owner |
| Journal draft failed | Shelf is already corrected. Record on form 8.3; ask the bookkeeping help to draft the entry by hand, approved by the owner | Owner |
| A difference points to theft | SOP-20 incident; reason **Theft or diversion**; do not discuss with staff on the floor | Owner |
| Damaged product found | Quarantine it; reason **Damaged**; SOP-15 for destruction | Counter → manager → owner |
| Anyone sees expected numbers during a count | Stop the count; owner plans a new one with another counter | Manager |

## 7. Controls & compliance (why the rules exist)

| Rule in this SOP | Why (authority) | Where the app enforces it today |
|---|---|---|
| Every difference documented with a reason and a sentence | *"Product inventory reductions that are not adequately documented will be deemed to be sales and will be assessed the excise tax."* (WAC 314-55-089(4)(c)) | Reason form; material shrink blocks approval (`assessLine`, `readinessOf`) — but see F-06-14 |
| Lost or destroyed product reported monthly | WAC 314-55-089(4)(a) (*"…lost and/or destroyed product in a manner prescribed by the LCB."*) | Posting writes a **count** adjustment → CCRS **Reconciliation**; destruction is SOP-15 |
| Every sale and adjustment traceable | CCRS reporting (WAC 314-55-083(4)) | Adjustment note names the audit and both quantities |
| Records kept five years | WAC 314-55-087 | Work paper + forms 8.1–8.4 in the binder |
| Blind count; second count by another person; collect the unused count records | ISA 501.A4 (*"…count and re-count procedures…"*) | Sheet hides expected quantities; second count requested at $50, done by the same counter (D56) — a disagreement does not block (F-06-13); one counter per count is not enforced (F-06-15) |
| Count with no movement before, during and after | ISA 501.A5 (cutoff) | **Not enforced**; the claimed warning does not exist (F-06-7). §4.11 is the control |
| Counting slices must add up to a full annual count | PCAOB AS 2510.11 | Hub's programme panel; count schedule |
| Records alone are not enough; existence must be observed | PCAOB AS 2510.12, AS 1105.11 | The physical count itself |
| Owner alone approves and posts | Owner, books-23 (*"Anything accounting, bookkeeping, taxes, finance, should be hard gated to me only."*) | `inventory.audit` owner-only; posting checks owner |
| Journal drafted, not posted | Owner, postings Q1 (*"create the draft and await my approval before auto posting"*) | `postAuditSession` does not auto-post |

## 8. Checklists & forms

Since v1.4 the daily, weekly, monthly and year-end checklists (forms 8.5–8.8) are kept in the app at **Inventory → Daily Checklists** (§4.23); the printed forms below are the fallback when the app is down or migration 0327 is not applied yet, and the master copy of the task wording the app was seeded from. Print on letter paper. Initials in every box. File by month in the inventory binder for five years (WAC 314-55-087).

### 8.1 Audit planning and sign-off record (owner, one per audit)

```
AUDIT NAME (as on screen): ______________________________  Audit created (date/time): __________
Why these products (as typed): __________________________________________________________
Scope: ____ products, ____ lots, value in scope $________   [ ] only due  [ ] every active lot  [ ] Cultivera flags
Planned count window:  start ______  end ______   [ ] before opening  [ ] after closing
Lots without a cost in scope (fill before review): ______________________________________
Counter(s): ____________________   Second-count person: ____________________
Pushed to floor:  [ ] on screen (when G-33 built)   [ ] paper form 8.2 (interim, §4.7)
Any sale of an in-scope product after creation and before its count?  [ ] No  [ ] YES -> do not post
Finish counting pressed (time): ______   Reasons entered (form 8.3): [ ]
No "Do not average them" lines: [ ]   Gross reviewed: $________   Net: $________
Approved (time): ______   Posted (time): ______   Journal draft approved in Books (time): ______
Work paper printed and filed: [ ]          Owner signature: ____________________
```

### 8.2 Paper blind count sheet (interim until G-33; also any re-count)

```
AUDIT NAME: ____________________________   Date: ________   Start: ______  Finish: ______
Counter: ______________   (Second counter: ______________)
NO EXPECTED QUANTITIES ARE PRINTED ON THIS SHEET. Do not look them up.

| # | Product | Lot code | Locations checked (shelf/back/display) | Count | Second count | Initials | Note |
|---|---------|----------|----------------------------------------|-------|--------------|----------|------|
| 1 |         |          |                                        |       |              |          |      |
| 2 |         |          |                                        |       |              |          |      |
(0 is a count. Never leave Count blank.)
Handed to owner (time): ______  Owner initials: ____
```

### 8.3 Difference reason worksheet (owner; fill before typing reasons in)

```
| Lot code | Difference (units) | Money effect | Reason (one of the six) | One-sentence note | Typed in (initials) |
|----------|--------------------|--------------|-------------------------|-------------------|---------------------|
|          |                    |              |                         |                   |                     |
Anything saved wrong or without a note (F-06-14): ______________________________________
Journal draft problem (if any): _______________________________________________________
```

### 8.4 Counter's note slip (anything the sheet cannot hold)

```
Audit: ______________  Lot code: ______________  Time: ______  Counter: ______
[ ] Damaged  [ ] Wrong place  [ ] Not in this audit  [ ] Label will not scan
[ ] I re-scanned a lot already recorded / entered a wrong number  [ ] Product sold during the count
What happened (one sentence): ____________________________________________
Given to: ______________ (manager/owner)
```

### 8.5 Opening checklist (every employee on the opening shift)

```
Date: ________  Opener(s): ______________          Initials / time
SECURITY & SAFETY
[ ] Alarm disarmed; doors, back door and safe checked (owner-directed D57; SOP-20) ____
[ ] Cameras recording, every view live, date/time right (owner-directed D57; WAC 314-55-083) ____
[ ] Safety walk: exits clear, no trip hazards, first-aid kit stocked (owner-directed D57) ____
CASH & REGISTERS
[ ] SOP-01 form 8.1 shift-open checklist done (each register)            ____
[ ] SOP-02 AM master till count done                                       ____
[ ] SOP-03 §4.10-4.12 morning bag recount and log (manager)                ____
[ ] ID scanner, label printer, card terminal, scales powered and tested (SOP-17) ____
INVENTORY
[ ] SOP-05a §4.4 Inventory -> Issues worked, form 8.3 (manager)            ____
[ ] Expired lots checked; expired edibles/liquids/tinctures/capsules/RSO pulled (SOP-05a §4.16) ____
[ ] Expiring-within-30-days list read; units fronted; list given to owner for markdown (§4.23) ____
[ ] Cycle Counts page checked; today's count claimed and done, or handed over ____
    Count name: __________  Counter (one person, D56): __________
[ ] Anyone counting today knows the rule: count each lot in one go (§4.11) ____
SALES FLOOR (cleaning, organizing, stocking)
[ ] Display cases and counters wiped, glass cleaned (owner-directed D57; SOP-07) ____
[ ] Shelves faced and stocked from back stock; gaps filled or 86'd (SOP-05a §4.12) ____
[ ] Menu boards / screens match the register; price tags correct (SOP-05b) ____
[ ] Required warning and age signs posted and visible; no product visible from outside (owner-directed D57) ____
[ ] Restroom and entry clean and stocked (owner-directed D57; SOP-07)     ____
[ ] Lights, music, OPEN sign on at opening time                            ____
ORDERS
[ ] Online Orders checked; pickups for today pulled and bagged (Online Orders; SOP-13) ____
```

### 8.6 During-the-shift checklist

```
Date: ________  Shift lead: ______________            Initials / time
[ ] Cycle Counts page checked at mid-shift                                 ____
[ ] Any product on "Stock needing recount" told to the manager (§4.21)     ____
[ ] No package sold from a lot while that lot is being counted (§4.11)    ____
[ ] Online Orders checked (every hour)                                     ____
[ ] Shelves re-faced and restocked after the lunch rush                    ____
[ ] Counters, scale and door handles wiped (owner-directed D57; SOP-07)    ____
[ ] Trash and recycling emptied if over half full (owner-directed D57)     ____
[ ] Cash drops made per SOP-01 when a drawer is over its limit             ____
MARKETING (one block per day; the owner assigns which)
[ ] Social media post published (Marketing & Advertising / Creative Studio; SOP-11) ____
[ ] Website banner checked: current, not expired (Shop Banner; Schedule & Releases) ____
[ ] In-store content: specials board, shelf talkers, screens updated (owner-directed D57) ____
[ ] Flyer or handout stock checked and reprinted if low (owner-directed D57) ____
[ ] Yard banners / street signs out, straight and undamaged (owner-directed D57) ____
INVENTORY MANAGEMENT
[ ] Product enrichment: ____ products finished (photos, description, effects) (Product Enrichment; SOP-10) ____
[ ] Expiring-soon units fronted; markdown labels match the register        ____
```

### 8.7 Closing checklist

```
Date: ________  Closer(s): ______________             Initials / time
[ ] SOP-01 drawers closed (blind count), SOP-03 night sheet and bag        ____
[ ] SOP-02 PM master till count                                            ____
[ ] Cycle Counts page checked; today's count done, or handed over          ____
[ ] A count started today is finished (I'm done) or the owner told to reassign it (§4.13) ____
[ ] All count sheets / slips (forms 8.2, 8.4) handed to the owner          ____
[ ] Online Orders: no unfulfilled pickups left without a note              ____
[ ] Shelves faced and restocked for the morning (owner-directed D57)       ____
[ ] Floors swept/mopped; cases and counters wiped; trash out (owner-directed D57; SOP-07) ____
[ ] Product returned to the vault / secure storage as store policy requires (owner-directed D57) ____
[ ] Lights, screens and music off; OPEN sign off                           ____
[ ] Doors locked, alarm armed, cameras still recording (owner-directed D57; SOP-20) ____
Manager sign-off: ______________
```

### 8.8 Weekly and monthly checklist (manager, owner)

```
Week of: ________                                        Initials / date
WEEKLY
[ ] Newsletter drafted or sent (Email Newsletter / Blog & Newsletter; SOP-11) ____
[ ] Blog post published (Blog & Newsletter; SOP-11; SEO SOP-21)           ____
[ ] Flyers and in-store content refreshed for next week's deals (owner-directed D57) ____
[ ] Website banners and specials match next week's promotions (Shop Banner, Specials) ____
[ ] Expiration report read; markdown list agreed with the owner (SOP-05a §4.16) ____
[ ] Product enrichment backlog reviewed (Catalog Hub; SOP-10)             ____
[ ] Deep clean: back stock room, shelves under displays, glass (owner-directed D57; SOP-07) ____
[ ] Supplies ordered: bags, labels, receipt paper, cleaning (owner-directed D57) ____
[ ] Vendor-of-the-day rotation on track; next week's vendors listed (§4.24) ____
[ ] CCRS weekly upload done (SOP-16)                                       ____
MONTHLY
[ ] Camera footage retention checked; recorder storage healthy (owner-directed D57; SOP-20) ____
[ ] Fire extinguisher and first-aid kit checked (owner-directed D57)       ____
[ ] Recall plan and contact list still current (SOP-05a §4.13)             ____
[ ] Compliance signage re-checked against current rules (Regulatory Watch) ____
[ ] Every vendor counted at least once this month (§4.24)                  ____
YEAR END
[ ] Annual full count planned, done and posted (§4.24; G-41)               ____
```

## 9. Quick reference cards

### 9.1 Owner card

1. **Plan:** Inventory Auditing → **Plan a new audit** → read the proposal → name it → write why → **Create this count**. Do it **right before** counting, outside selling hours.
2. **Push to floor:** no button yet (G-33). Print form 8.2 and count on paper (§4.7).
3. **When G-33 / G-34 exist (D54, D55):** create → **Release to Cycle Counts** → one employee claims and counts → they press **I'm done** → the cockpit tells you → review.
3a. **Daily:** about one vendor a day, chunked if large; **year end:** one full count (§4.24).
4. **Review:** read **Total error found**, not net. No "Do not average them" lines. Reason **and** note together (form 8.3 first).
5. **Approve this result** (final) → **Post this audit** (once) → **Books → Journal**: approve the draft.
6. Anything sold in scope after creation? **Do not post.**
7. File the **Work paper** and forms 8.1–8.3.

### 9.2 Counter card (admin, manager, budtender)

1. **Inventory → Cycle Counts** → open the count. Ignore the done/remaining figures.
2. Gather every package of a product. Count each lot's packages. **Scan one, type the total, Record this count.**
3. **Never scan a lot again once recorded.** Mistake? Stop, form 8.4, tell the owner.
4. Label will not scan → **enter by hand** (uncounted lots only).
5. **None on the shelf = type 0. Never leave blank.**
6. **Count again** badge → fresh count by you (same counter, D56), scan, enter once.
6a. **One counter per count.** If someone else already started it, leave it.
7. Never look up expected numbers. Never press **Review and finish**.
8. Done → **tell the owner** (the count does not leave the page by itself).
9. Product in scope needs to be sold mid-count → stop, tell the manager.
10. **Inventory → Daily Checklists** → your list → **Initial** each task as you do it (§4.23).

## 10. Glossary

| Word | Meaning |
|---|---|
| **Audit** (inventory audit) | One planned count: a scope, a reason, frozen books quantities, counts, reasons, an approval and a posting |
| **Cycle count** | Counting part of the store on a schedule, instead of everything once a year |
| **Blind count** | A count done without seeing what the books expect |
| **Scope** | The products (all their open lots) in an audit |
| **Second count / recount** | A fresh blind count of a lot whose first count was off by $50 or more |
| **Frozen quantity** | The books' quantity copied onto the audit when it was created |
| **Cutoff** | Keeping sales and receipts from mixing with a count (§4.11) |
| **Gross / net** | Gross: every difference counted as positive. Net: shortages and overages offset |
| **Material** | Off by at least $20 or 2% (default), so a reason and note are needed |
| **Unvalued lot** | A lot with no unit cost on file |
| **Posting** | Applying the approved result to the shelf, CCRS and a journal draft |
| **Reconciliation** | The CCRS reason a count adjustment is reported under |
| **Journal draft** | A books entry waiting for the owner's approval |
| **Work paper** | The printable record of the audit |
| **ABC class** | A/B/C ranking of products by importance that sets how often they are counted |

---

## Appendix A: Source map

| Topic | Source (verified at `main@c976c7e4`) |
|---|---|
| Roles | `src/lib/auth/roles.ts` L107, L127, L143, L149; nav `src/components/admin/admin-nav-data.ts` L89, L183 |
| Hub | `src/app/admin/inventory/audits/page.tsx` (L60–65 tones, L98–101 owner quote) |
| Plan a count | `audits/new/page.tsx` L76–92, L433–435 |
| Actions | `audits/actions.ts` L89–133, L148–210, L221–263, L277–308, L369–415 |
| Audit page | `audits/[id]/page.tsx` L71–75, L105–114, L209–279 |
| Count sheet | `audits/[id]/count/page.tsx` L60–100; `audits/AuditCountSheet.tsx` L72–128, L203–219, L364–375 |
| Review | `audits/AuditVarianceReview.tsx` L255–297; `src/lib/inventory/audit-hub-guidance-core.ts` L80–180, L228–244, L545–605 |
| Work paper | `audits/[id]/export/page.tsx` L86, L194–196 |
| Store | `src/lib/inventory/audit-hub-store.ts` L92–141, ~L175, L203–205, L291–293, L379–382, L513–628, L671–750, L777–855, L877–950, L953–970, L983–1063 |
| Rules engine | `src/lib/inventory/inventory-audit-core.ts` L324–329, L767–771, L800–980, L1109–1210, L1416–1493 |
| Stages and posting gate | `src/lib/inventory/inventory-audit-post-core.ts` L113–174, L256–331, L470–620 |
| Posting | `src/lib/inventory/inventory-audit-store.ts` L146–184, L290–355, L396–534 |
| Database | `supabase/migrations/0191_*.sql` L154, L177, L183, L238, L254, L376–398; `0192_*.sql` L286–400; `0194_*.sql` (legacy read-only) |
| Authorities | `src/lib/inventory/inventory-audit-authorities.ts` L160–215; `src/lib/inventory/audit-hub-authorities.ts` L144–259 |
| CCRS | `src/lib/compliance/ccrs-inventory-adjustment-core.ts` L66–67 |
| Cycle Counts page | `src/app/admin/inventory/cycle-counts/page.tsx` L17–20, L86–90, L131–139, L186, L206, L238–305 |
| Legacy | `cycle-counts/actions.ts`; `src/lib/inventory/cycle-counts.ts` L278–320, L382–415, L526–545; `cycle-counts/[id]/page.tsx` L74, L161–222, L317, L389; `cycle-counts/[id]/export/route.ts` L37 |
| Issues reminder | `src/lib/admin/issues-core.ts` L481–488; `src/lib/inventory/inventory-intel-core.ts` L301 |
| Concierge / help | `src/lib/admin/concierge-kb.ts` L66, L73, L175; `src/lib/admin/help-content.ts` L450–451 |
| Owner letter | `docs/MICHAEL-books-23.md` L55–59, L72–76 |

## Appendix B: Not built yet (interim procedures)

> **Living SOP reminder (D41).** The owner: *"We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary."* When a gap below is built, update this SOP in the same piece of work: the named sections, this table, Appendix D, the findings ledger (FIXED) and the concierge entry (D42: *"I want to upgrade the concierge to use all features including future ones we will build after the sop is finished."*).

| Gap | What is missing | Findings | Interim procedure | Sections to update when built | Status |
|---|---|---|---|---|---|
| **G-33** | Owner controls for every stage: **Approve scope and send to Cycle Counts** (signed), start counting, **Send back to counting**, **Cancel** (with a reason) | F-06-1 (**S1**), F-06-2 | Paper count, form 8.2 (§4.7) | §2, §4.2, §4.7, §4.13, §6, §9 | **BUILT** (v1.2, Fix Phase 4.3, migration 0326): Release, Send back, Reassign, Cancel with reason |
| **G-34** | Counter's **I'm done** on the sheet that notifies the owner; correct help step 4; staff-safe links on the count sheet; live counted/difference figures on the hub and queue | F-06-3, F-06-4 | Tell the owner in person (§4.8) | §4.4, §4.8, §4.9, §4.13 | **BUILT** (v1.2, Fix Phase 4.1): I'm done, cockpit notice, help step, owner links hidden, live progress on the sheet, hub and queue, claimer on the queue. The hub's Difference still fills at posting |
| **G-35** | Cutoff: post the difference against the **live** quantity at count time (or freeze at count, not at creation) and warn when sales landed between freeze and count; correct the work paper and explainer | F-06-7 (**S1**) | Create right before counting, outside selling hours; never post if anything sold (§4.11) | §4.3, §4.11, §4.17, §4.19, §7 | **BUILT** (v1.2, Fix Phase 4.2, migration 0326): per-lot capture, movement shown and refused, work paper and explainer corrected |
| **G-36** | Count-sheet integrity: per-package scans add up; a scan of a counted lot warns instead of becoming the second count; hand entry for second counts; a disagreeing second count **blocks** approval and posting; status check on every line write (code and database) | F-06-5, F-06-5b, F-06-6, F-06-13 (**S1**) | §4.10 step 4, §4.12, §4.14 owner rule, store rule 4 | §2, §4.10, §4.12, §4.14, §4.16, §5.2 | **BUILT** (v1.2, Fix Phase 4.1, migration 0326): +1 per scan, ask on a re-scan, third count, disagreement blocks, Start counting claim, database stage and claimer checks |
| **G-37** | Reasons: edit reason and note until approval (audited); validate the reason against the list; enforce `readyToPost` at posting | F-06-14 | Form 8.3 first; new audit if saved wrong (§4.15) | §4.15, §5.3 | **BUILT** (v1.2, Fix Phase 4.1): Change the reason (audited), reason validated in app and database, posting refuses disagreeing counts |
| **G-38** | Daily checklists in the app, for every employee (D51), with sign-off and a Cycle Counts line | F-06-12 (F-00-9) | Paper forms 8.5–8.8 (§4.23) | §4.23, §8, §9 | **BUILT** (v1.4, Fix Phase 4.4b, migration 0327: six lists seeded from forms 8.5–8.8, initials per task, live Cycle Counts line, manager sign-off with a required note when tasks are left, owner edits the catalog, sheets kept and never deleted) |
| **G-40** | Intelligent cycle counts: **Vendor of the day** with chunking, ABC, exceptions, expiring soon, Cultivera flags, never counted; one open count per lot | F-06-8 | Plan by hand from **Show every active lot** (§4.24) | §4.5, §4.22, §4.24, §9 | **APPROVED** (D58) |
| **G-41** | Annual year-end full count: every lot, no 400 cap, sections, one release, one review, one work paper | — | Several audits the same day, outside selling hours (§4.24) | §4.5, §4.24, §8.8 | **APPROVED** (D58) |
| **G-39** | Housekeeping: one count schedule everywhere; Issues fix links to the planner (owner) or tells staff to tell the owner; legacy sessions truly read-only; render the built-in counting checklist on the sheet; Pacific times; one approved colour | F-06-8, F-06-9, F-06-10, F-06-11 | — | §4.5, §4.20, §4.22 | **BUILT** (v1.2 checklist, colour, Cycle Counts times, D59 cleanup in 0326; v1.3 Fix Phase 4.4a: one schedule, Issues → Plan a count / tell the owner, old sessions read-only with the writers deleted, Pacific default name and hub dates) |

## Appendix C: Open questions for the owner

All eight v1.0 questions were answered by the owner after SOP-06 merged (recorded verbatim in `00-OWNER-REQUEST-VERBATIM.md`).

| # | Question | Owner's answer | Decision |
|---|---|---|---|
| Q-06-1 | Auto-start counting, or by button? | *"…what is the enterprise grade approach? Please do what the pros would do."* | **D54**: separate **Release to Cycle Counts** button; per-lot capture at first count |
| Q-06-2 | May a counter press **I'm done**? | *"yes, pressing I'm done should sent the cycle count back to the inventory audit page linking back to the one that initiated the count. It should notify me in the main /admin cockpit command center."* | **D55** |
| Q-06-3 | A different person for the second count? | *"…I am the only one who will initiate a cycle count. Any employee may count inventory. Only one employee per scoped count."* | **D56**: one counter; recount by the same counter |
| Q-06-4 | Daily checklist tasks | Cleaning, organizing, stocking, marketing content, product enrichment, discounts before expiry, plus expert additions | **D57**: forms 8.5–8.8 |
| Q-06-5 | Which count schedule? | *"…a full inventory audit once per year at the end of the year … a vendor per day, broken into chunks if a large vendor … I also want options for initiating intelligent cycle counts."* | **D58**: §4.24, G-40, G-41 |
| Q-06-6 | Cancel old sessions? | *"be canceled, we are not live yet. It's all test data."* | **D59** |
| Q-06-7 | +1 per scan? | *"yes."* | **D60** |
| Q-06-8 | Counting hours? | *"anytime during open hours."* | **D61** (safe once G-35 is built) |

No new questions in v1.1.

## Appendix D: Revision history

| Version | Date | Change | By |
|---|---|---|---|
| 1.4 | 2026-10-30 | Fix Phase 4.4b built (G-38, migration 0327): **Inventory → Daily Checklists** with six lists (opening, during the shift, closing, weekly, monthly, year end) seeded from forms 8.5–8.8 (61 tasks), initials and Pacific time per task, SOP and screen links, the live Cycle Counts line, manager sign-off (note required when tasks are left), the owner edits the tasks (D57), sheets permanent. Rewrote §4.23; updated the one-thing-to-know, §8 intro, §9.2, Appendix B; forms 8.5–8.7 lines that pointed at G-35 now state the built rule. Findings F-06-12, F-00-9 FIXED | SOP program |
| 1.3 | 2026-10-30 | Fix Phase 4.4a built (G-39): one count schedule A 30 / B 60 / C 90 for the planner, the Issues row and the intelligence panel; the overdue row opens **Plan a count** for the owner and tells everyone else to tell the owner; old cycle-count sessions truly read only (Cancel, scanner, import and Enter count removed, their server actions deleted, library writers refuse CYCLE_COUNT_READ_ONLY); Pacific default audit name and hub dates. Updated the one-thing-to-know, §4.5, §4.6, §4.20, §4.21, §4.22, Appendix B. Findings F-06-8, F-06-9, F-06-10, F-06-11 FIXED | SOP program |
| 1.2 | 2026-10-30 | Fix Phase 4.1–4.3 built (G-33, G-34, G-35, G-36, G-37; migration 0326): **Release to Cycle Counts**, **Start counting** claim, +1 per scan with the already-counted question, third count, **I'm done** and the cockpit notice, **Send back**, **Reassign**, **Cancel** with a reason, per-lot books capture at first count, mid-count movement shown and refused, disagreeing counts block, reasons editable and validated. Rewrote the one-thing-to-know, §4.2, §4.3, §4.7–§4.13, §4.14 rule, §4.15–§4.17, Appendix B. Findings F-06-1–7, F-06-13–16 FIXED | SOP program |
| 1.1 | 2026-10-28 | Owner answers Q-06-1…Q-06-8 applied as D54–D61: release button (§4.7), I'm done + cockpit notice (§4.8), one counter and the same-counter recount (§2, §4.12), +1 per scan (§4.10), counting in open hours once G-35 is built (§4.11), the counting programme (new §4.24), the full daily task catalog (§4.23, forms 8.5–8.8 including new 8.8), legacy sessions cancelled (§4.20). Gaps G-33…G-36, G-38, G-39 APPROVED; new G-40, G-41; new findings F-06-15…F-06-17. Research: Oracle NetSuite Inventory Count and Lightspeed R-Series inventory counts, quoted | SOP program |
| 1.0 | 2026-10-28 | First draft, verified against `main@c976c7e4`. Owner decisions D41, D42, D50–D52 applied. Findings F-06-1…F-06-14 (with F-06-5b) and F-06-C; gaps G-33…G-39; questions Q-06-1…Q-06-8. Paper daily checklists (forms 8.5–8.7) | SOP program |
