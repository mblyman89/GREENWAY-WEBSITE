# SOP-04 — Receiving Intake: From Vendor Email to Sellable Lot, plus the Monthly CCRS Public Records Request

| | |
|---|---|
| **Version** | 1.2 (draft for owner review; owner answers D29–D34 applied; D41 living-SOP reminder) |
| **Effective** | On owner approval |
| **Owner** | Michael Lyman |
| **Applies to** | Everyone who handles a vendor delivery: the manager who processes the manifest (D30), any trained employee who helps count at the dock, the person who onboards new products onto the menu, the **admin** who files the monthly CCRS public records request on the 10th (D32), and the owner, who reviews the books |
| **Verified against** | `main@5299660b` (2026-10-27). Every label, button, message, number and rule below was read from the code or quoted from the owner. Nothing was written from memory. Where the code and a help panel disagree, this SOP follows the code and records a finding. |
| **Program records** | Findings `F-04-*` in `docs/sop-program/03-FINDINGS-LEDGER.md` · Gaps `G-16`…`G-19` in `docs/sop-program/05-GAP-REGISTER.md` · Owner decisions D28–D34 in `docs/sop-program/00-OWNER-REQUEST-VERBATIM.md` · Owner rulings on rejection in `docs/ccrs-rejection-and-returns.md` |

> **This SOP is a living document (owner decision D41).** The owner said: *"We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary."* When any gap this SOP names (Appendix B) is built, this SOP is updated in the same piece of work: the sections the gap names, Appendix B, Appendix D (a new revision row), the finding marked FIXED, and the concierge entry (charter §3 rules 9–10). Until then, the interim procedures in this SOP are the rule.

> **How to use this document.** Part 1 (§4.1–§4.24) is truck day, in the order the work happens: the manifest arrives, the truck arrives, you count, you refuse what is wrong, you press one Finalize button, and the new products go onto the menu. Part 2 (§4.25–§4.34) is the **monthly CCRS public records request**, which brings the state's market data in for the benchmarks. It is owner work, done once a month. Section 5 lists every message the screens can show, with what to do. Section 8 holds the paper forms. Section 9 is a one-page card for the receiving area. Words in **bold** are the exact labels you will see on the screen.

> **The one thing to know before anything else.** **Count first, decide at the dock, then press Finalize once.** Every line on a manifest says **Will accept** until you press **✕ Reject** on it. When you press Finalize, **every line you did not reject is accepted** (`intake-store.ts` L1416; by design, recorded as control note F-04-3). So the count is the one job only a human can do, and a line that is short, broken or wrong must be rejected **before** Finalize, while the driver is still there. Refused product leaves on the truck, never becomes Greenway's inventory, and **Greenway files nothing with CCRS**. The vendor fixes their own manifest.

---

## Table of contents

1. Purpose & scope
2. Roles & permissions
3. Before you start
4. Procedures

   **Part 1: Truck day**
   - 4.1 The pipeline at a glance
   - 4.2 The screens you will use
   - 4.3 Every morning: check the Receiving list
   - 4.4 How a manifest gets in: the email path (automatic)
   - 4.5 How a manifest gets in: the manual tools
   - 4.6 Reading a staged manifest before the truck arrives
   - 4.7 Duplicates, invoice numbers and overdue trucks
   - 4.8 When the truck arrives: driver, vehicle and transport details
   - 4.9 Count every line (the one human job)
   - 4.10 Refusing a line at the dock
   - 4.11 Short counts (interim rule)
   - 4.12 Refusing the whole manifest
   - 4.13 Trade samples and the quarterly sample cap
   - 4.14 Vendor inventory ids (for the weekly CCRS report)
   - 4.15 COAs and lab results
   - 4.16 Linking the purchase order
   - 4.17 Finalize: the one button
   - 4.18 After Finalize: the result banner
   - 4.19 The Issues tab and held lots
   - 4.20 The Accounting tab
   - 4.21 Printing lot labels
   - 4.22 Product Onboarding: putting new products on the menu
   - 4.23 "This product looks like more than one card on your menu"
   - 4.24 After the truck: vendor follow-up and the weekly CCRS hand-off

   **Part 2: The monthly CCRS public records request (benchmarks)**
   - 4.25 What it is and why we do it
   - 4.26 The monthly timeline at a glance
   - 4.27 Step A: file the request with the WSLCB
   - 4.28 Step B: track the request until the files arrive
   - 4.29 Step C: download and store the zip, untouched
   - 4.30 Step D: update the competitor roster first
   - 4.31 Step E: drop the zip on the CCRS Benchmarks page
   - 4.32 Step F: check the dataset that was saved
   - 4.33 Step G: read and use the benchmarks
   - 4.34 Re-doing a month, removing a month, turning it off
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

**Purpose.** Receiving is how product enters Greenway. The owner asked for this SOP in the original request:

> *"There should be a sop for the receiving intake pipeline."* (`00-OWNER-REQUEST-VERBATIM.md` L7)

and set the standard for it when this slice began:

> *"Please proceed with sop-04, receiving. Please make sure to include the monthly CCRS public record request to ingest the states data for the benchmarks. Please go slow and be meticulous, this is a major branch of my operation. I want this sop to be extremely well explained and detailed set of procedures. Go above and beyond."* (D28, `00-OWNER-REQUEST-VERBATIM.md` L81, L94)

**How Greenway handles a bad delivery** comes from the owner, word for word:

> *"Currently when ever a vendor brings in product, we can choose to reject it, in other words we don't or have not ever had to process a return manifest. We just tell the vendor to take it back with them. So we need the ability to tell the system that we are only accepting a part of the manifest and the rest was rejected. There are several instances where the vendor forgot to send an item, or it broke in transit, etc. but again, we have never had to re manifest the products back."* (`docs/ccrs-rejection-and-returns.md` L15–21)

**How the Receiving page should feel**, also from the owner. This is why there is no per-line Accept button:

> *"I don't want to have to push any buttons while I walk the page unless I have to."* (quoted in `src/components/admin/inventory/ManifestLotDisposition.tsx` L135)

**What the monthly records request is for**, from the owner:

> *"Ideally, I will make the public records request once per month to get the previous months data. One big zip file with nested zips in it. I drag and drop or upload the full zip file, the back office via some sort of transformer, extracts what we need and then uses it in all the system I've described. I do not want to have to do a bunch of steps or validate anything."* (`docs/ROADMAP_BACKOFFICE_FIXES.md` L276–300)

**Background documents.** The owner's intake decisions are in `docs/INTAKE_PIPELINE_ROADMAP_DECISIONS.md`. That file cites an *"INTAKE_PIPELINE_BIBLE.md"* that is not in the repository (finding F-04-9), so this SOP was written from the code and the files that do exist.

**Volume.** The owner reports **15–20 manifests per week, about 65–87 per month** (`docs/INTAKE_PIPELINE_ROADMAP_DECISIONS.md` L157).

**In scope.**
- Every way a manifest enters the system: email, Transfer Data Link, batch, JSON, CCRS manifest.csv, PDF.
- The dock count, refusing lines and refusing a whole manifest.
- Samples, vendor ids, COAs, the PO link, Finalize, held lots, the books hand-off and labels.
- Product Onboarding and the menu match.
- The **monthly CCRS public records request** and benchmark intake.

**Out of scope.** These are covered elsewhere and only pointed to here:
- Daily lot management, expiry, recalls (**SOP-05**).
- Cycle counts (**SOP-06**).
- Returning **already-accepted** product to a vendor, and destruction (**SOP-15**).
- The weekly CCRS upload, including the InventoryTransfer file (**SOP-16**).
- Building purchase orders and vendor menus (**SOP-09**).
- Paying the vendor (Accounts Payable, **SOP-09**).
- Product photos and descriptions (**SOP-10**).

---

## 2. Roles & permissions

| Task | Who | How the system checks |
|---|---|---|
| Physically count a delivery at the dock | **Any employee** trained on this SOP | Not in the app. The paper truck-day sheet (form 8.1) is the record of who counted. |
| Open **Receiving**, import a manifest, save transport details, reject lines, **Finalize** | Owner, admin or manager login | Every Receiving action calls `requirePermission("inventory.manage")` (`src/app/admin/inventory/intake/actions.ts` L65, L80, L103, L153, L201 … L1292; page L99). `inventory.manage` = owner, admin, manager (`src/lib/auth/roles.ts` L106). |
| **Product Onboarding** (approve new products with a price) | Owner, admin, manager | `requirePermission("inventory.manage")` (`drafts/page.tsx` L252) |
| Menu match review, lot labels, Batch Lookups | Owner, admin, manager | `inventory.manage` (`intake/[id]/match/page.tsx` L54; `lots/[id]/label/page.tsx` L33; `batch-lookups/page.tsx` L58) |
| Accounts Payable link on the Accounting tab | Owner, admin, manager | `payables.manage` (`roles.ts` L99) |
| Review the books for a delivery (**Waiting to Post**) | Owner | `books.view`. Others see *"The owner reviews this in the books."* (`ManifestAccountingPanel.tsx`) |
| File the monthly CCRS public records request on the **10th**; receive the files | **Admin** only (D32). The owner may step in if the admin is away (Q-04-9) | Outside the app (WSLCB portal) |
| Drop the monthly zip; manage the competitor roster; read Statewide Benchmarks | Owner, admin, manager | `inventory.manage` (`discovery/ccrs/page.tsx` L59; `discovery/competitors/page.tsx` L66; `discovery/benchmarks/page.tsx` L131) |
| Read **Reports → Benchmarks** | Owner, admin, manager, readonly | `reports.view` (`reports/benchmarks/page.tsx` L81; `roles.ts` L149) |
| Turn Product Discovery (and so the CCRS benchmarks) on or off | Owner, admin | `settings.manage` (`discovery/actions.ts` L99; `roles.ts` L248) |

**Who processes a manifest? A manager (D30).** The owner ruled: *"only managers will process manifests."* Every Receiving screen action already needs `inventory.manage` (owner, admin, manager), and no receiver-level access will be built. The manager is responsible for the whole manifest, from reading it before the truck to pressing Finalize.

**Who may help count?** The manager may have another trained employee help with the **physical** count at the dock. Whoever counts signs form 8.1. The manager enters every decision on screen and presses Finalize. (That helpers may count is my reading of D30 and the owner's earlier practice; open question **Q-04-7** confirms it.)

**Second count (D31).** A second person re-counting is **not required**, but it is **strongly recommended**, and it is **expected on the first delivery from a vendor Greenway has not received from before** (§4.9).

---

## 3. Before you start

1. **Know where Receiving lives.** Top bar **Product Intake → Receiving** (`/admin/inventory/intake`). Nav group "Product Intake", `admin-nav-data.ts` L73. The same group holds **Product Onboarding**, **Batch Lookups**, **CCRS Benchmarks** and **Accounts Payable** (L74–L81).
2. **Have the paperwork.** You need the vendor's email with the manifest, the **Transfer Data Link** if they sent one, and the invoice if it came separately. In Washington there is **no automatic CCRS inbound feed**: the sending licensee uploads the manifest and everyone gets an email (`intake/page.tsx` L279).
3. **Prepare a clear counting space** in the receiving area. Keep it camera-covered, with nothing else on the table, so the count can be checked on video.
4. **Supplies:**
   - Blank truck-day sheets (form 8.1).
   - The dock refusal log (form 8.2).
   - The vendor follow-up log (form 8.3).
   - A pen.
   - The 4×6 label roll in the Rollo printer (§4.21).
5. **Log in with a manager-level account** on the Receiving computer before the truck comes. A staff login cannot open Receiving (§2).
6. **Know the three rules that never bend:**
   - Refuse at the dock, **before** you finalize (§4.10).
   - Never accept product you did not physically count.
   - Never create a return manifest for a driver-present refusal. Contingency manifests are discontinued (§4.24).

---

## 4. Procedures

# Part 1: Truck day

### 4.1 The pipeline at a glance

Every manifest moves through these stages. The labels are exactly what the screen shows (`src/lib/inventory/manifest-pipeline-core.ts` L58–97):

| Stage (screen label) | What it means (screen text) | How it gets there |
|---|---|---|
| **Pending** | "Imported/entered but not yet marked on its way." | A manual import (§4.5) |
| **In transit** | "The transporter is on the way. Watch the ETA." | An emailed manifest is moved here automatically: *"Auto-advanced to In transit (arrived via vendor email — delivery already dispatched)."* (`inbound-store.ts` L803–814) |
| **Awaiting intake** | "Physically here — verify counts, then accept to activate the lots." | Finalize stamps it received first (R31; `intake/actions.ts` L949, L1075–1097). There are **no** "Mark in transit" / "Mark received" buttons any more. |
| **Accepted** | "Lots activated and receive adjustments logged." | Finalize with every line accepted |
| **Partially Accepted** | "Some lots accepted; the rest were refused at the dock (never received)." | Finalize with a mix, or with a lot held in quarantine (`intake-disposition-core.ts` L128–142) |
| **Rejected** | "Refused at the dock — never received (nothing destroyed; no CCRS filing)." | Whole-manifest reject (§4.12), or Finalize with every line refused |
| **Dismissed duplicate** | "A second copy of a manifest that was already here (the same email delivered twice)…" | **⧉ Dismiss duplicate** (§4.7) |

**What happens to the product at each step:**
- **On staging**, each line becomes an inventory lot with status **quarantine**: "held until the manifest is accepted" (`intake-store.ts` L899). Nothing can be sold.
- **On Finalize**, each accepted lot passes the **go-live check** (`lot-activation-gate-core.ts` L76–107) and becomes **active** (sellable), or is **held in quarantine** with the reason shown (§4.19).
- A refused lot is marked rejected at the dock and never becomes stock.

**The review screen's own guide.** The ribbon at the top of the review screen shows three steps, **Arrived → Verify counts → Accept** (`guided-accept-core.ts` L65). It also gives one plain-English line for the current stage, for example: *"It's here. Count each line against the manifest — the counts are the ONE thing only you can verify. Refuse any short or wrong line at the dock (press Reject on it); every other line is accepted when you press Finalize."* (L84).

> **Do not follow the old printed sheets or the Receiving help panel where they disagree with this SOP (finding F-04-5).** The in-app paper sheets at `/admin/sop` (**SOP — Truck day (delivery to sellable)** and the **receive** sheet behind *"Prefer paper?"*) and the Receiving page's help panel *"How inbound transfers work in Washington"* still say to *"enter it by hand"*, to *"Move the record along the pipeline (in transit → received)"*, and to *"reject it to discard"* (`src/lib/catalog/sop-core.ts` L79, L81, L83, L158, L162; `intake/page.tsx` L279–282). None of that is true any more. There is no hand-entry form, Finalize marks the delivery received, and a refusal is "refuse at the dock" (nothing is discarded). The order sheet's *"receive it against each line in Receiving; the PO moves to Partial then Received"* (L137) is also out of date: a linked PO is received automatically at Finalize (§4.16).

### 4.2 The screens you will use

| Screen | Where | What it is for |
|---|---|---|
| **Receiving** (list) | Product Intake → Receiving, `/admin/inventory/intake` | Every manifest, with status cards, export, and two tabs: **Incoming (email)** and **Manual tools** |
| Manifest review | Click a manifest. `/admin/inventory/intake/<id>`. Its breadcrumb says **Vendor intake** (F-04-8); it is the same thing as Receiving | Count, refuse, samples, vendor ids, COAs, transport, PO link, **Finalize**. Three tabs: **Delivery · Issues · Accounting** (`[id]/page.tsx` L770–790) |
| Menu match | A link from the review screen when needed, `/intake/<id>/match` | Decide where a product belongs on the menu (§4.23) |
| **Print lot label** | **🏷 Print 4×6 label** on a line | 4×6 label for the Rollo printer (§4.21) |
| **Product Onboarding** | Product Intake → Product Onboarding, `/admin/inventory/drafts` | Approve brand-new products with a price (§4.22) |
| **Batch Lookups** | Product Intake → Batch Lookups | Background AI product lookups for onboarding (SOP-10 covers enrichment) |
| Lot page | Inventory → a lot, `/admin/inventory/<lot id>` | Held lots, COA attach (§4.19). Daily lot work is SOP-05. |
| **CCRS Benchmarks** | Product Intake → CCRS Benchmarks → **Manage datasets**, or `/admin/discovery/ccrs` | The monthly records request (Part 2) |

**The Receiving list in detail** (`intake/page.tsx`):
- **Status cards** (L304–322): **Pending**, **In transit**, **Awaiting intake**, **Accepted**, **Rejected**. There is **no** Partially Accepted card (F-04-6); partially accepted manifests are only in the table.
- **Export intake** (L336–357): **Download Excel (.xlsx)** or **Download CSV** of the list.
- **Overdue banner** (L359–363): *"🚨 N in-transit manifest(s) past ETA — follow up with the transporter."*
- **Incoming (email)** tab. Columns: **Manifest #**, **Invoice #**, **AI**, **Vendor**, **Pulled in**, **ETA**, **Status**, **Docs** (`EmailIntakeTable.tsx` L146–168). The **Docs** column links each archived file (⬇ Manifest / Invoice / COA / JSON / File).
- **Manual tools** tab: the import tools in §4.5, plus two maintenance tools (**Promote manifests → Knowledge Base** and **Re-run intelligence now**).

### 4.3 Every morning: check the Receiving list

Do this at opening, before any truck is due. The manager does it; it takes five minutes.

1. Open **Product Intake → Receiving**.
2. Read the status cards. **In transit** = trucks on the way; **Awaiting intake** = product that is here but not finalized.
   > **An "Awaiting intake" manifest from a previous day is a problem.** Its lots sit in quarantine and cannot be sold. Finish it today (§4.17).
3. If the red **🚨 … past ETA** banner shows, call or email the transporter or vendor, and write the answer on form 8.1. ETA days use the store's Pacific calendar (`manifest-pipeline-core.ts` L190–206).
4. **Compare the vendor emails with the list** (finding F-04-4). Open the vendor_intake@ mailbox and look at yesterday's manifest emails. **Every manifest email should have a row on the Incoming (email) tab.**
   - **Why:** an email the system could not read (**parse failed**) or that carried no manifest (**no manifest**) is logged in the database but is **shown nowhere on screen** (`inbound-store.ts` L862–884; the only caller, `intake/page.tsx` L164, uses the log for download links only).
   - **If an email has no row,** bring the manifest in by hand with a manual tool (§4.5). The Transfer Data Link is best.
   - **Write it on form 8.1**, so the owner can see how often this happens.
5. Glance at the **Invoice #** column. A blank or wrong invoice number can be corrected (§4.7).

### 4.4 How a manifest gets in: the email path (automatic)

This is how most manifests arrive. You do nothing.

1. **The vendor emails the manifest** (and usually an invoice and COAs) to the store's vendor_intake@ address (`api/webhooks/inbound-email/route.ts` L4, L67–69).
2. **The system reads every attachment and stages a draft.**
   - The manifest becomes a row with status **In transit** (auto-advanced, §4.1).
   - Each line becomes a quarantined lot.
   - The files are archived and shown in the **Docs** column.
   - **Drafts only:** nothing activates and nothing is published (route.ts L1–30).
3. **Possible outcomes for each email** (route.ts L316–320):
   - **staged** (a new row).
   - **duplicate** (the same manifest # and vendor is already live, so it is not staged again).
   - **parse failed** or **no manifest** (no row; see §4.3 step 4).
4. **Two other mailboxes are not Receiving.**
   - **vendor_menu@** holds vendor menus (SOP-09).
   - **lcb-watch@** holds forwarded LCB bulletins (Regulatory Watch).
   - Do not forward manifests there (route.ts L72–81).

### 4.5 How a manifest gets in: the manual tools

Use these when an email did not produce a row, or a vendor handed over paper or a link. Go to **Receiving → Manual tools**. In order of preference (`intake/page.tsx` L497–681):

| Tool | When to use it | What to do | Button |
|---|---|---|---|
| **Transfer Data Link** (recommended) | The vendor's email has a "Transfer Data Link" | Copy the link from the order email and paste it. *"We fetch the full transfer — every product and every COA — so you never click the per-product COA links."* | **Fetch & stage for review** |
| **Batch import — paste many Transfer Data Links** | Catching up on many links at once (e.g. history) | One link per line. *"Links already imported are detected and skipped… Every manifest lands as a pending draft for review — nothing activates."* | (batch panel) |
| **Vendor JSON** (fallback) | The link will not fetch | *"If the link won't fetch, paste the raw transfer JSON from the email instead."* | **Parse & stage for review** |
| **CCRS manifest.csv** | You only have the state's manifest CSV | Paste the full contents of the `manifest_*.csv`. It carries *"no product names, prices, or COAs"*, so each line is a sparse draft. | **Parse CSV & stage for review** |
| **Manifest PDF** | You only have the WA LCB **Internal Shipping Document (Third Party)** PDF | Choose the .pdf. Text PDFs only, not scans. No prices or COAs. *"Prefer the JSON when you have it."* | **Parse PDF & stage for review** |

**After any import,** you land on the new manifest's review screen with: *"Manifest staged as a draft. Review the lines below, then accept to activate the lots."* (`[id]/page.tsx` L583–587). A manually imported manifest stays **Pending**; that is normal (§4.1).

**CSV and PDF imports carry no cost and no COA.** The screen then adds *"…Fill in cost and COA before accepting."* (L588–596). **There is no field on the review screen to type a cost or a COA** (F-04-10). Do this instead:
1. Ask the vendor for the **Transfer Data Link** or JSON, and import that instead if it arrives before the truck. Dismiss the sparse copy as a duplicate (§4.7) only if both rows show the same manifest # and vendor.
2. If you must receive on the CSV or PDF, finalize as normal. Lots without a COA are **held in quarantine** at Finalize (§4.19). Lots without a cost make the **vendor bill wait** (§4.20). Write "CSV/PDF only — needs COA/cost" on form 8.1 and tell the owner.

If an import fails, the red message tells you why. Every message and its fix is in §5.

**The two maintenance tools** on Manual tools, **Promote manifests → Knowledge Base** and **Re-run intelligence now**, are for the owner or admin after a bulk history import. They are fill-only and safe to re-run (`intake/page.tsx` L639–680). They are not part of truck day.

### 4.6 Reading a staged manifest before the truck arrives

Open the manifest from the list. Before the truck comes, read the review screen top to bottom:

1. **Header.** Manifest number, vendor, transfer date, and the source ("WCIA transfer" or "generic JSON"; L440–443).
2. **Vendor card** (L544–597).
   - Is the vendor linked? If the card says the vendor is not linked, use **Find this vendor**.
   - If the same vendor appears twice in the system, use **Combine duplicate vendors** (`/admin/vendors/merge`).
3. **Guide ribbon and intake checklist.**
   - The checklist (`intake-checklist-core.ts` L102–175) lists **Mark the delivery received**, **Walk the lines & verify counts**, **Verify transport details**, **Finalize intake**, **Mark manifest accepted** and **Promote facts to Knowledge Base**.
   - Steps marked automatic are done by Finalize.
4. **Review flags panel.** Per-line compliance flags (vendor license, lot codes, COAs, failed labs, samples, quantities). It shows nothing when the manifest is clean (`[id]/page.tsx` ~L905). **Read every flag before the truck comes.**
5. **"Which order is this delivery for?"** (§4.16).
6. **Lines table** (L936–1100). Columns: **Product / lot**, **Qty**, **COA** (✅ or —), **Catalog**, **Expires**, **Decision**.
   - A **sample** chip marks free trade samples.
   - **Unmapped category** with **Map it →** means the product type is not mapped yet. Ask the manager to map it under Settings → Types & Categories before Finalize.
7. **Certificates of analysis (N).** The COAs pulled from the transfer file (§4.15).
8. **AI extract.** Shown only when it can add something. **🤖 Run AI extract** re-reads the archived documents for this one manifest. *"The button only fills EMPTY transport fields and re-checks the invoice/order # for this one delivery — it never overwrites what you typed."* (L886–887). It never changes lines or decisions (`intake/actions.ts` L320–337).

Write the manifest number, vendor and the number of lines on form 8.1 before the truck arrives. **Compare that number with the vendor's paper or PDF manifest.** If a line failed to save when the manifest was staged, the system only notes it in a server log and the line is simply missing from the screen (`intake-store.ts` L930–936; finding F-04-11). A line on the paper but not on the screen means: do not finalize; tell the manager, who re-imports it with a manual tool (§4.5) or calls the owner.

### 4.7 Duplicates, invoice numbers and overdue trucks

**A duplicate row** (the same email delivered twice):
- The review screen shows *"Duplicate row. Another row in Receiving has the same manifest # and vendor - the same email was delivered twice. Keep the one you want and dismiss the other (dismissing is not a rejection)."* (L520–536).
- **Open the other copy →** to compare. Then, on the copy you do **not** keep, open **⧉ Dismiss duplicate**, add an optional note (e.g. *"Same email arrived twice"*), and press **⧉ Dismiss this duplicate** (`DismissDuplicateForm.tsx`).
- Dismissing:
  - removes that copy's lines (never received);
  - moves its invoice #, documents and transport details to the kept row;
  - is **not** a rejection, and nothing is filed with CCRS.
- It runs in one database transaction and writes an audit row `manifest.dismiss_duplicate` (`intake/actions.ts` L546–583).

**Identity of a manifest** = manifest number + vendor.
- A manifest with **no** number is never treated as a duplicate (`manifest-dedupe-core.ts` L24–35).
- A **rejected** or **dismissed** manifest does not block a corrected re-send from the vendor (L84).

**Invoice #:**
- The list's **Invoice #** cell can be corrected: type it in **Invoice / Order #** and press **Save** (`InvoiceNumberCell.tsx`).
- Saving a blank clears your correction and goes back to the number read from the documents (`intake/actions.ts` L488–506).
- The banners say *"Invoice # updated — your correction now shows on this manifest everywhere the invoice number appears."* or *"Invoice # correction cleared…"*.

**Overdue truck:** see §4.3 step 3. Write each follow-up call on form 8.1.

### 4.8 When the truck arrives: driver, vehicle and transport details

Washington transport manifests must carry the transport details (WAC 314-55-085, cited in `concierge-kb.ts` L142).

1. **Greet the driver.** Check the driver's identification against the driver name on the manifest. Check the vehicle plate against the manifest. **If they do not match, do not unload. Call the manager.**
2. **On the review screen, open the transport form** (L1157–1308) and fill or check every field:
   - **Transporter / carrier**
   - **Origin / transporter license #**
   - **Driver name**
   - **Driver license #**
   - **Vehicle description**
   - **License plate**
   - **Vehicle VIN**
   - **Expected arrival (ETA)**
   - **Departed**
   - **Arrived**: type the real arrival time.
   - **Route notes**: *"Stops, conditions, seal numbers, etc."* Write any **seal numbers** and the condition of the seals here.
3. Press **💾 Save transport details**. The fields saved are listed in `intake/actions.ts` L289–318.
4. Values that came straight from the signed transfer document show as green **from the manifest** chips. *"These values were staged straight from the signed transfer document — legally validated for CCRS, no need to re-type or re-verify them."* (`GuidedAcceptRibbon.tsx` L128).

### 4.9 Count every line (the one human job)

The screen's own words for the Qty column: *"Shipped quantity from the manifest. Your ONE human job: confirm the physical count matches before accepting."* (`guided-accept-core.ts` L165–175).

1. **Unload onto the counting table, one line at a time.** Do not open other boxes until the current line is done.
2. **For each line, check the product name, the lot or batch number on the package, and the unit count against the Qty on screen.** Also check:
   - **Condition:** broken, crushed, leaking, opened, or a damaged tamper seal.
   - **Expiry or short date**, if printed.
   - **Labels:** the required WA labeling is present.
3. **Mark the line on form 8.1:** ✔ (count matches and condition is good), or the problem in words ("18 of 20", "2 crushed", "wrong strain").
4. **Lines that are correct need nothing on screen.** They say **Will accept**: *"Nothing to press: Finalize accepts this line unless you reject it."* (`ManifestLotDisposition.tsx` L138–143).
5. **Lines that are wrong are refused at the dock now** (§4.10, §4.11). Do this while the driver is still here, so the product can leave on the truck.
6. **Second count: strongly recommended (D31).** The owner's rule: *"no second count required, it should be highly suggested, especially for new vendors we havent received from before."* So:
   - **First delivery from this vendor?** Treat a second count as expected. A second trained employee recounts every line and signs form 8.1. If nobody else is on shift, the manager writes "single count, first delivery, nobody available" on form 8.1.
   - **Any other delivery:** a second count is a good habit, especially for high-value lines or anything that looked short, damaged or odd on the first pass.
   - **How to tell it is a first delivery.** The app has no "new vendor" marker (gap G-21). Before the truck arrives, the manager opens **Receiving**, clicks the **All** view, and picks the vendor in the **Vendor** filter (`ReceivingFilterBar.tsx` L101–111). No earlier manifest from that vendor means it is a first delivery. With a filter on, the list reads only the newest 1,000 manifests (`intake/page.tsx` L156–160), so an old vendor coming back after a long gap may also look new. Treat it as new. Tick the box on form 8.1.
7. **Every line counted? Every problem refused?** Sign form 8.1 as the counter. The second counter signs too.

> **No partial quantities.** The system cannot record "18 received of 20". Each line is accepted **whole** or refused **whole** (finding F-04-1; the received quantity is taken from the manifest, `intake-parser.ts` L606). Read §4.11 before you accept any line that is short.

### 4.10 Refusing a line at the dock

1. On the line, press **✕ Reject**.
2. Pick the **reason** (`intake-disposition-core.ts` L36–44):
   - **Short shipment — vendor forgot it / came up short**
   - **Damaged / broke in transit**
   - **Wrong product**
   - **Failed COA / quality**
   - **Expired / short-dated**
   - **Overage — more than ordered**
   - **Other (explain)**: a text box appears, *"Explain the reason…"*, and it is required (*"Please explain the 'Other' reject reason."*, L68–84).
3. Press **✕ Confirm reject** (or **cancel**). The line now shows **✕ Rejected at dock** with the reason, and an **accept instead** link in case you pressed the wrong line.
4. **Set the product aside with the driver.** Refused product goes back on the truck, and the driver takes it. Write the line, reason and quantity on the dock refusal log (form 8.2). Have the driver initial it if they will.
5. **If a line was already marked accepted earlier,** the reject box warns: *"Heads up: this line was already marked accepted. Product should be refused at the dock before you accept it — accepting first and rejecting later means it briefly entered inventory. Only continue if this is a genuine correction."* (L95–101).

**What refusing does and does not do** (help panel *"How rejecting product works (and stays compliant)"*, `[id]/page.tsx` L1341–1357):
- *"Rejecting is 'refuse at the dock' — the product leaves with the driver and never becomes your reported inventory. Nothing is destroyed."*
- *"Because refused product was never yours, you file NOTHING with CCRS. Ask the vendor to submit a CCRS manifest Update (to fix a quantity) or Delete (to remove a line) so their record matches what physically stayed."*
- *"Do NOT create a return manifest for driver-present refusals. Contingency manifests are discontinued (WSLCB, Nov 2025)."*

### 4.11 Short counts (interim rule)

The system has no way to receive part of a line (F-04-1, gap G-16). **The owner has ruled that this must be built and is on the list of serious issues to fix** (D29: *"we need a way to accept less than what came in"*; F-04-1 is now **S1**, G-16 **APPROVED**). **Until it is built**, follow this interim rule. It matches the owner's own practice of *"We just tell the vendor to take it back with them"*:

1. **Recount** with a second person. Many shorts are miscounts. A short line is one of the times a second count matters most (D31).
2. **Still short? Refuse the whole line** with **Short shipment — vendor forgot it / came up short**. Write the real count in form 8.2 (for example "18 of 20 — refused whole line").
3. **The physical units go back with the driver.** Ask the vendor to Update or Delete the line in CCRS (§4.24) and re-send the correct quantity on a new manifest if you still want it.
4. **Do not** accept the line and then "fix" the number with an inventory adjustment.
   - The lot would say 20 while the shelf holds 18.
   - The weekly CCRS InventoryTransfer report sends the **received quantity** (`ccrs-transfer-core.ts` L33–36), so the state would be told 20.
5. **Overages** (more than the manifest says) are the same. Refuse with **Overage — more than ordered**, or call the manager.

### 4.12 Refusing the whole manifest

Use this when nothing on the truck should come in (for example, the wrong store, or the whole order damaged). For a mix, refuse lines instead (§4.10).

1. Below the Finalize bar, open **✕ Reject the entire manifest**.
2. Pick the **Reason**. Help text: *"Refused at the dock — nothing is destroyed or reported to CCRS."* The list:
   - **Short shipment — vendor forgot it**
   - **Damaged / broke in transit**
   - **Wrong product**
   - **Failed COA / quality**
   - **Expired / short-dated**
   - **Overage — more than ordered**
   - **Other (explain)**
3. **Details (optional / required for Other)**: explain.
4. Press **✕ Reject whole manifest** (`[id]/page.tsx` L1394–1417).
5. The banner reads *"You rejected this whole manifest at the dock."* … *"Refused product never entered inventory (nothing destroyed). No CCRS filing on our end — ask the vendor to Update or Delete their manifest."* (`finalize-banner-core.ts`).
6. **What changes in the system:**
   - Every lot is marked rejected at the dock.
   - The manifest becomes **Rejected**.
   - Its duplicate lock is released, so the vendor's corrected re-send can come in.
   - The timeline records *"…No CCRS filing; vendor to Update/Delete their manifest."* (`intake-store.ts` L970–1036).
7. Fill form 8.2 (one line: "whole manifest") and form 8.3 (vendor follow-up).

### 4.13 Trade samples and the quarterly sample cap

Lines marked **sample** are free trade samples from the processor.

- **The law** (as the code cites it): a processor may send **no more than 120 sample units per quarter** to one retailer (WAC 314-55-096(1)(f)(ii); `intake-store.ts` L1070–1099). Exactly 120 is allowed; 121 is over (`sample-intake-cap-core.ts` L146–154).
- **What happens at Finalize.**
  - If accepting this manifest would put the vendor over 120 this quarter, **and** the owner has the cap set to **Enforce limits** + **Hard block over-cap events** (Compliance → Samples, `samples/page.tsx` L283–286), Finalize is refused **before anything activates**:
    > **Accept refused — quarterly sample cap.** … *"No lots were activated and no sample event was recorded. The processor must not send more sample units this quarter, or an owner may adjust the sample-cap enforcement settings."* (`[id]/page.tsx` L682–705)
  - In **Warn only** mode, it never blocks (`intake-store.ts` L1070–1099).
- **What to do when it is refused:**
  1. Press **✉️ Notify vendor (sample delivery on hold)**. It *"Emails the processor that their delivery is on hold and asks them to hold the samples until next quarter. Cites WAC 314-55-096 — no dollar amounts or customer data. An internal copy is kept for staff."*
  2. Then **refuse the sample lines** that put them over (§4.10, reason **Other (explain)**: "over quarterly sample cap"), and press Finalize again for the rest.
  3. The result of the email shows as one of four banners (L706–722):
     - sent;
     - *"No email is on file for this vendor…"*;
     - *"Email is not configured, so no notice was sent…"*;
     - *"The notice could not be delivered…"*.
     Write it on form 8.3.
- Accepted samples are recorded automatically. Giving samples to employees is a different procedure on **Compliance → Employee samples** (30 units per employee per quarter, current paid employees only; `samples/page.tsx` L103–121).

### 4.14 Vendor inventory ids (for the weekly CCRS report)

Each week Greenway, as the receiver, must report accepted inbound lots to CCRS in an **InventoryTransfer** file. The "from" id must be **exactly the vendor's** inventory id (`ccrs-transfer-core.ts` L1–43). SOP-16 covers the upload itself; receiving's job is to make the id right.

1. On each accepted line, look at **Vendor inventory id** (`[id]/page.tsx` L1038–1072).
2. Ids that came from a Transfer Data Link / WCIA JSON, a CCRS manifest.csv, or that someone already typed are **trusted** (L55). The button says **Save**.
3. Ids read from a **PDF** may really be a batch number, so the line says **needs confirming for CCRS** and the button says **Confirm**. Compare with the vendor's manifest, correct it if needed, and press **Confirm**.
   - It is stamped as owner-entered (`intake/actions.ts` L622–629).
   - Until it is confirmed, the weekly file flags `E14_TRANSFER_VENDOR_ID_UNKNOWN`.
4. If the screen says *"Not saved: enter the vendor's id exactly as on their manifest (1-100 characters, no commas or quotes)."*, retype it without commas or quotes.

### 4.15 COAs and lab results

- The **Certificates of analysis (N)** card lists COAs from the transfer file. *"Finalize downloads and keeps a copy of each on file (so you can print them for LCB enforcement) and reads the numbers into the lab results — no button needed."* (L1104+).
- **The go-live check at Finalize** blocks a lot from becoming sellable when (`lot-activation-gate-core.ts` L76–107):
  - *"Missing CCRS InventoryExternalIdentifier — every lot needs a licensee-assigned identifier before it can be reported or sold."*
  - *"Lab result is FAILED — failed cannabis may not be sold at retail (WAC 314-55-102); this lot cannot be activated."*
  - *"No lab result / COA on record — WA testing rules (WAC 314-55-102) require a passing COA before retail sale."*
  - A COA that is on record but still pending is allowed.
- **A line with no COA (—)** before the truck: ask the vendor to send it now. Lines without a COA are **held in quarantine** at Finalize rather than going live (§4.19).
- **A FAILED result:** refuse that line at the dock with **Failed COA / quality** (§4.10).

### 4.16 Linking the purchase order

If the delivery was ordered on a Greenway purchase order, the panel **Which order is this delivery for?** suggests matching open POs (`ManifestPoLinkPanel.tsx`).

- *"Vendors rarely put our PO number on the manifest, so nothing links automatically — confirm the right order below and the paper trail connects itself."*
- Press **Link this PO** on the right one, or **Unlink** to undo. The link is never made automatically (`intake/actions.ts` L267).
- If the delivery had no PO (a sample drop or walk-in deal), leave it unlinked.
- **Why it matters:** on Finalize, a linked PO is received automatically, and Accounts Payable can compare invoice against PO when paying (`intake-store.ts` L1657+).

### 4.17 Finalize: the one button

When every line is counted and every wrong line refused:

1. Look at the **sticky bar** at the bottom of the review screen. Its button names exactly what it will do (`finalize-label-core.ts` L80–84):
   - **✓ Accept & Finalize** (one line) or **✓ Accept All & Finalize**.
   - **✓ Accept N · Reject M & Finalize**: a mix.
   - **✓ Reject & Finalize** or **✓ Reject All & Finalize**: everything refused (red).
   - **✓ Finalize (no lines)**.
2. **Read the label against form 8.1.** The accept and reject numbers must match your sheet. If they do not, find the line before pressing.
3. **The note box.**
   - If any line is refused, it says *"Why is this partial? (required — audit trail)"* and **must** be filled.
   - Otherwise it says *"Note (required only if this finalize ends up partial)"*.
   - Write a plain reason, for example *"2 lines refused: 1 crushed in transit, 1 short — vendor to Update."* The note is saved to the manifest's permanent timeline (L1366–1391; max 2,000 characters, `intake-disposition-core.ts` L150–168).
4. Press the button. **One press does everything** (help panel step 6; `intake/actions.ts` L937–1073):
   1. Marks the delivery received (if it was Pending or In transit).
   2. Checks the sample cap (§4.13).
   3. Accepts every line you did not reject, runs the go-live check on each, and **activates** the clean ones. Each activation is logged as a "receive" inventory adjustment. Lots that fail the check are **held**.
   4. Marks refused lines rejected at the dock.
   5. Stamps the received date (Pacific) and expiry rules, fill-only.
   6. Records the **goods receipt** in the books, and the **vendor bill** if anything was activated (§4.20).
   7. Archives and reads the COAs, creates product **drafts** for onboarding, writes facts to the Knowledge Base, records samples, receives the linked PO, and publishes updates to products already on the menu.
5. **Do not press twice.** Wait for the page to come back with the result banner (§4.18).

> **Remember:** a line you did not touch is accepted. If you forgot to refuse a broken line and have already finalized, see §6 ("Refused a line too late").

### 4.18 After Finalize: the result banner

The banner at the top tells you the outcome (`finalize-banner-core.ts` L60–125):

| Banner | Meaning | Next |
|---|---|---|
| Green: *"Delivery accepted — N lots activated and on hand."* | All good | Onboarding (§4.22), labels (§4.21) |
| Gold: *"Delivery partially accepted — N lots activated and on hand."* plus *"…refused at the dock — refused product never entered inventory and is not owed for. This is a normal dock decision, not an error."* | Some refused | Vendor follow-up (§4.24) |
| … *"N lots are held in quarantine until the missing paperwork is fixed — see the Issues tab."* | Some lots failed the go-live check | §4.19 |
| *"Finalized with nothing accepted — no lot was activated, so no vendor bill was raised."* | Everything refused | Vendor follow-up |
| Orange: **Note required.** *"This intake is partial … Nothing was changed; add the note next to the Finalize button and finalize again."* | You left the note empty on a partial | Write the note; press again |
| Red: *"Something went wrong with that action."* | Any other failure (F-04-7) | See §5 |

After Finalize the lower part of the page says *"This manifest has been accepted. Lots are managed from the inventory list."* (or partially accepted / rejected). **There is no Finalize button any more.** Corrections from here are SOP-05 or SOP-15 work.

### 4.19 The Issues tab and held lots

The **Issues** tab lists what still needs attention. When clean, it says *"Nothing needs attention on this delivery. Every accepted lot passed the go-live check."* (`[id]/page.tsx` L776–779).

| Issues row | Meaning | Do this |
|---|---|---|
| **Held in quarantine — <lot>** · *"Missing: … It cannot go live until that is resolved."* | The lot was accepted but failed the go-live check (no CCRS id, no COA, or FAILED) | **Failed:** it can never be sold. Return to vendor or destroy (SOP-15). **No COA:** get the COA from the vendor. If the lab result is already imported, attach it on the lot page under **Attach a lab result** (`LotLinkPanels.tsx`; `inventory/actions.ts` L268–303). The row's own text says *"the lot page cannot attach one yet"*; that text is out of date (F-04-12). **No CCRS id:** ask the vendor for a corrected manifest. |
| **Held in quarantine, now clear — <lot>** · *"Its identifier and lab result now pass the go-live check."* | The missing paper is now on file | **Manager:** **Open lot to activate it** → **Lifecycle status** → **Set status** = **Active** → **Update status** (`issues-core.ts` L545–555). |
| **N lines have no COA / lab result** (before Finalize) | COAs missing | **Review the lines** |
| **N lines have an unmapped category** | Product type not mapped | **Open Types & Categories** |

> **Control: only set a held lot to Active when the Issues row says "now clear".** The lot page's **Lifecycle status** box does **not** run the go-live check, and it writes **no audit row** (`inventory/actions.ts` L142–155 → `store.ts` L849–864). It will set any lot to **Active**, even one with no COA or a FAILED result (finding F-04-2, **S1**; gap G-19). Until that is fixed:
> - Only a manager does this.
> - Only from a "now clear" Issues row.
> - Write it on form 8.1 (lot, time, who).

### 4.20 The Accounting tab

The **Accounting** tab shows **Books for this delivery** (`ManifestAccountingPanel.tsx`; texts from `manifest-event-labels-core.ts` L217–230):

| Line | Meaning |
|---|---|
| *"Goods receipt: recorded in the books (it may be waiting as a draft for the owner)."* | Normal |
| *"Vendor bill: not recorded yet — see the reason below."* | The books refused. The most common reason is a lot with **no unit cost**: *"Nothing was recorded. N lot(s) on this delivery have no unit cost yet… Key the unit costs, then finalize again."* (`vendor-bill-service.ts` L262–287) |
| *"…none needed — nothing was activated, so nothing is owed."* | Everything refused |
| *"…not attempted yet — it is recorded when the delivery is finalized…"* | Not finalized yet |

- **If the vendor bill was refused for missing cost, tell the owner the same day.** Note it on form 8.1.
  - There is **no screen to key a cannabis lot's cost on a finalized manifest**. The owner decided not to build one, because *"CCRS and Cultivera always carry cost"*.
  - The owner also asked that the decision be reopened if this refusal ever appears (`INTAKE_PIPELINE_ROADMAP_DECISIONS.md` L34–46; F-04-10).
- **Open Accounts Payable →** takes the manager to AP to pay the vendor (SOP-09). The owner also sees **Waiting to Post (books) →**.

### 4.21 Printing lot labels

1. On a line, press **🏷 Print 4×6 label**. It opens **Print lot label** (`/admin/inventory/lots/<id>/label`).
2. Press the print button. The browser print dialog opens; pick the **Rollo** printer. The page is a true 4×6 with no margins (`lots/[id]/label/page.tsx` L1–63).
3. Label the case or bin before it goes to the back stock area.

### 4.22 Product Onboarding: putting new products on the menu

Finalize matches each accepted lot to the menu. Lots that match an existing product just add stock. **Lots that do not match get a DRAFT product** waiting in **Product Intake → Product Onboarding**. The page's own steps (`drafts/page.tsx` L797–815):

> 1. *"On accepting a manifest, we match each lot to the published menu by its POS key."*
> 2. *"Lots that don't match get a DRAFT product, pre-filled from the JSON + COA potency."*
> 3. *"Review the details, then Approve (validated) or Dismiss (not a new product)."*
> 4. *"If we couldn't classify a product at 90% confidence or better, the approve form asks you to pick its category or type from our own list — no product is ever guessed onto the menu."*
> 5. *"When you approve a product with a price, it is published to the website and the register automatically — no upload and no Publish click."*
> 6. *"If a product has a fact that needs a second look (or the automatic publish didn't finish), the update waits under Admin → Publish Menu and tells you exactly what to check."*

**Steps for each draft:**
1. Check the name, brand, category or type, strain, size and potency against the package in your hand.
2. If asked, **pick the category or type** from the list.
3. **Liquids** (edible liquids, tinctures, topicals):
   - If the name states no size, the form asks for **Package volume — required (the name states no size)**. Measure or read the volume from the package. It drives the 72 fl oz purchase limit (WAC 314-55-095(1)(d)(i)(E); `receiving-classification-core.ts` L178–245).
   - The form also asks **Taken into the body another way? (suppository)**: pick **No — ordinary product** or **Yes — suppository (10-unit limit)** (`drafts/page.tsx` L1984–2026). Read the package; never guess.
4. Enter the **price** (greater than $0; *"Enter a price greater than $0."*, `catalog-drafts.ts` L1348) and press **✓ Approve**. The product is live on the website and register immediately: *"Approved — it's live on the website and sellable at the register now…"* (L775).
5. **Dismiss** only if it is not a new product (for example, it should have joined an existing card; see §4.23).
6. Photos and descriptions come later in Product Enrichment (SOP-10).

**Onboard the same day as Finalize.** Activated lots of an unapproved new product are in stock but not on the menu.

### 4.23 "This product looks like more than one card on your menu"

When a delivered product could belong to more than one menu card, the system does not guess. The match page asks *"Where does this delivered product belong on your menu?"* (`merge-review-core.ts` L30–50):

- *"We didn't guess. Compare them side by side and tell us where it belongs. We'll remember your choice for every future delivery of this product — you can undo it any time."*
- **Join this card**: it joins the card you pick, now and for future deliveries.
- **Keep separate**: it stays its own card.
- **Forget my choice**: the next menu update asks again.

If one of the cards is a duplicate that should not be on the menu at all, the page tells you to open it and set Visibility to "Always hide".

### 4.24 After the truck: vendor follow-up and the weekly CCRS hand-off

1. **For every refused line or whole manifest, contact the vendor the same day.**
   - Ask them to submit a **CCRS manifest Update** (to fix a quantity) or **Delete** (to remove the line), so their CCRS record matches what physically stayed (`docs/ccrs-rejection-and-returns.md` L192–196).
   - Log it on form 8.3, and tick it off when the vendor confirms.
2. **Never create a return manifest** for product the driver took back. A return manifest applies only to product that was **already accepted** (SOP-15).
3. **CCRS confirmations** for manifests are processed Monday, Wednesday and Friday. The confirmation email comes from `info@lcb.wa.gov` with a PDF (`ccrs-rejection-and-returns.md` L158–163). If a vendor says they updated, the change may take until the next processing day.
4. **Weekly CCRS hand-off.** Every accepted lot goes on the weekly InventoryTransfer file (SOP-16). Before the weekly upload, check that every accepted lot from the week has a trusted or confirmed vendor inventory id (§4.14).
5. **File the paper.** Form 8.1 (signed), form 8.2, the driver's copy of the manifest and the invoice go in the receiving binder by date.

---

# Part 2: The monthly CCRS public records request (benchmarks)

### 4.25 What it is and why we do it

**What it is.** Once a month, Greenway asks the Washington State Liquor and Cannabis Board (WSLCB) for a copy of the state's **CCRS** (Cannabis Central Reporting System) data under the Public Records Act. It is the same data every licensee reports to the state: sales, products, inventory, lab results and transfers, for **every licensee in Washington**. The WSLCB delivers it as **one big zip file with zips nested inside it**. Greenway drops that zip on one screen, and the back office turns it into benchmarks.

There is **no API**. The state does not let one licensee pull other licensees' data from CCRS. A public records request is the only route (`docs/CCRS_DATA_ACCESS.md` L6–23, L58–68).

**Why we do it**, in the owner's words:

> *"…I want this data not for my own data, the back office has this already. This data will be used … to create state wide benchmarks on the CCRS benchmark page. It will also be used on the reports page in the local benchmarks page. It will also be used on the leads page so it can help my purchaser make better more informed decisions based on what is moving well in the state but also at our competitors stores. I want the ai to help us beat them by under cutting them or beating them in some other ways. Ideally, I will make the public records request once per month to get the previous months data. One big zip file with nested zips in it. I drag and drop or upload the full zip file, the back office via some sort of transformer, extracts what we need and then uses it in all the system I've described. I do not want to have to do a bunch of steps or validate anything."* (`docs/ROADMAP_BACKOFFICE_FIXES.md` L276–289)

**The three places the data shows up** (`discovery/ccrs/page.tsx` L309–316: *"Feeds the CCRS Benchmarks, the Leads page, and Reports → Local Benchmarks."*):

| Where | Who can open it | What it gives you |
|---|---|---|
| **CCRS Benchmarks** (Product Intake → CCRS Benchmarks, `/admin/discovery/benchmarks`) | Owner, admin, manager (`inventory.manage`, L131) | Statewide prices, $/gram, brand and strain premiums, velocity, month-over-month trends |
| **Reports → Benchmarks** (`/admin/reports/benchmarks`; the section is titled **Local benchmarks**) | Owner, admin, manager, readonly (`reports.view`, L81) | Greenway against every tracked local store: what they sell for, what they pay vendors, who they buy from |
| **Product Discovery** (the Leads page, `/admin/discovery`), **Market movers** section | Owner, admin, manager | *"Lead ideas straight from the latest monthly CCRS drop"* and a **Draft vendor leads from these suppliers** button (`MarketMoversSection.tsx` L173; `DraftSupplierOutreachButton.tsx` L42) |

**It is market data, not Greenway's books.** Greenway's own sales come from the register. The CCRS file is used to see the **market and the competitors** (`ROADMAP_BACKOFFICE_FIXES.md` L291–294). Never use benchmark numbers to correct Greenway's own sales, inventory or taxes.

**The legal limit.** The app shows this on the request screen, and it applies to everything in Part 2:

> *"Per RCW 42.56.070(8), records received through the Public Records Act may not be used for commercial purposes. Use these benchmarks for your own internal buying and pricing decisions only. This feature is fully removable."* (`discovery/ccrs/page.tsx` L278–280)

The program's records add that the owner's WSLCB enforcement officer confirmed that a retailer using the data for its own sourcing and benchmarking is acceptable (`docs/ROADMAP_DISCOVERY_CCRS_BENCHMARKS.md` L19–23). In practice:
- **Do** use the numbers to decide what to buy, from whom and at what price.
- **Do not** sell, publish, share or hand the files or the benchmarks to anyone outside Greenway. That includes vendors, other stores, marketing and social media.
- **Do not** use the data to build contact lists for marketing.

### 4.26 The monthly timeline at a glance

The owner's rule is *"once per month to get the previous months data"* (L276–289). The owner set the day and the person: *"only admin will file monthly requests, on the 10th of the month"* (D32). If the 10th falls on a weekend or holiday, file on the next business day (my reading; the portal accepts requests any day, but the records office works business days).

| When | Step | Who | Section |
|---|---|---|---|
| **The 10th** (next business day if it falls on a weekend or holiday) | File the request for **the previous calendar month** | **Admin** | §4.27 |
| The same day | Write the tracking number on form 8.4 | Admin | §4.28 |
| Within 5 business days | The WSLCB acknowledges, with the records or a time estimate (`ccrs/page.tsx` L245–248) | WSLCB | §4.28 |
| Every week until delivery | Check the portal and email; answer any WSLCB question the same day | Admin | §4.28 |
| The day the files arrive | Download each month's zip, store it untouched, log it | Admin | §4.29 |
| Before dropping | Check the competitor roster | Admin or manager | §4.30 |
| The same day or next | Drop the zip on **CCRS Benchmarks**, keep the tab open until it finishes. **One month's zip at a time** | Admin or manager | §4.31 |
| Straight after | Check the saved dataset | Admin or manager | §4.32 |
| Monthly, on the same day | Check for months older than 18 months; remove them under the retention rule | Admin (owner approves) | §4.34 |
| Through the month | Use the benchmarks for buying and pricing | Owner, manager, purchaser | §4.33 |

> **Nothing in the app reminds you.** The compliance calendar has no task for this request. Its tasks are the LIQ-1295, weekly CCRS, CCTV retention, scale calibration, badge and visitor log, and DOR excise items (`src/lib/compliance/compliance-calendar-core.ts` L86–136). This is finding **F-04-19** and gap **G-18**. Until it is built, **form 8.4 is the reminder.** Keep it at the front of the receiving binder. The admin also puts a **recurring calendar reminder on the 10th** in their own calendar (phone or email), since the app has none yet.

### 4.27 Step A: file the request with the WSLCB

The app's own instructions are under **Step 1 — Request the data from the WSLCB** on the CCRS page: *"A Public Records Act request is free, done online, and delivered electronically as raw CSV files."* (`ccrs/page.tsx` L211–214). Follow them with the corrections marked below.

**Get there.** Go to **Product Intake → CCRS Benchmarks → Manage datasets**. Or go to **Product Discovery → Request & upload data** (`discovery/page.tsx` L222–224). Or type `/admin/discovery/ccrs`. The page is titled **CCRS Benchmarks**, subtitle *"Request WA Public Records → upload the raw CCRS files → own the statewide benchmarks."* (L125–126).

**The steps:**

1. **Open the WSLCB Public Records Center:** `https://lcbwa.govqa.us/WEBAPP/_rs/` (the link on the page, L29, L222–227).
   - **First time only:** *"Create a free account (name + email) so they can deliver the files to you."* Use an email address the owner reads every day; the delivery link and any WSLCB questions come to it.
   - Write down which email the account uses on form 8.4, so the next person can find the deliveries.
2. **Start a new request.** (If the WSLCB has agreed to a recurring monthly request, see "Standing request" at the end of this section first.) The app says: *"In the description box, paste the request wording from the panel on the right and fill in your date range. Ask for the CCRS (Cannabis Central Reporting System) transactional extracts."* (L231–236).
3. **The wording.** The app's **Copy-paste request wording** panel (L272–276, text at L32–36) says:

   ```text
   Pursuant to the Public Records Act (RCW 42.56), I request an electronic copy of the
   Cannabis Central Reporting System (CCRS) transactional data for all licensees for the period
   [START DATE] through [END DATE]. Specifically, I request the CCRS Sales, Products, Inventory,
   Lab Results, and Strain data extracts in delimited (CSV) format. Please deliver electronically
   via the records portal. Thank you.
   ```

   > **This is the owner's wording (D32).** The owner uses this built-in text: *"I use the built in text provided in the ccrs benchmark page."* It is the wording that produced the April and May 2026 deliveries, so **use it word for word.** The only thing to change today is the two dates:
   > 1. **[START DATE]** = the 1st of the first month you want; **[END DATE]** = the last day of the last month you want. For last month only, for example: `October 1, 2026` through `October 31, 2026`.
   > 2. **Several months in one request is fine.** The owner confirmed that *"each month is sent as its own zip file"* (D32). For example, a catch-up request for August 1 through October 31 comes back as three zips. Each is dropped **on its own** (§4.31).
   > 3. **Do not add or remove tables.** The program's earlier caution (F-04-18) noted the text names five extracts, while the transformer reads nine tables (`ccrs-extract/run.ts` L68–80). The owner's deliveries using this text were the full extract (49 and 64 nested table zips, `ROADMAP_BACKOFFICE_FIXES.md` L208–212), so the text works. If a delivery ever comes back **without** sales tables, the drop says *"The zip produced no sales rollups…"* (`discovery/actions.ts` L831–836). Reply on the portal with the tracking number and ask for the full monthly extract including SaleHeader and SalesDetail (§6).
   >
   > **Coming (gap G-18, approved by the owner):** a **month drop-down** on this panel that picks one month or several and fills the dates into the text, so it can be copied and sent **without editing**. Until then, type the dates.

4. **Delivery.** *"Choose electronic delivery (the default). CCRS extracts are large flat files — you'll receive them as CSVs, often zipped, via a download link."* (L238–243). In practice it is one zip of roughly 0.7–1 GB (April 2026 ~713 MB, May 2026 ~990 MB; `ROADMAP_BACKOFFICE_FIXES.md` L207–209).
5. **Submit.** *"You'll get a confirmation with a tracking number. The WSLCB acknowledges within 5 business days and provides the records or a reasonable time estimate."* (L245–248). Go straight to §4.28.

**Other ways to reach the WSLCB records office.** The page lists (L261–268):
- Email: `lcbpublicrecords@lcb.wa.gov`
- Phone: **(360) 664-1769**. ⚠ **This number is out of date.** The WSLCB public records page lists **(360) 664-1753** (finding F-04-13). Call 664-1753.
- Fax: (360) 704-4940
- Mail: PO Box 43080, Olympia, WA 98504-3080

The WSLCB also publishes a paper request form, **LIQ 826**, for mail, fax or email requests. The portal is faster and keeps the history in one place, so use the portal.

**Standing request (D32).** The owner wants a standing monthly request. The legal position, from Washington's model rules: *"An agency must only provide access to public records in existence at the time of the request. An agency is not obligated to supplement responses… A requestor must make a new request to obtain subsequently created public records."* (WAC 44-14-04004(4)). So the WSLCB **may** decline a request for future months. They are not required to accept one. The procedure:
1. **Ask once.** The next time you file, add one line in the portal message or email `lcbpublicrecords@lcb.wa.gov`: *"Would the Public Records office accept a standing request for this same CCRS extract each month, for the previous calendar month?"* Write the answer and the date on form 8.4.
2. **If they say yes:** on the 10th, the admin **checks that last month's request is open or delivered** (form 8.4 part B) instead of filing a new one. Keep the reminder; the 10th is still the check date.
3. **If they say no, or do not answer:** file a new request every 10th, as above. With the month drop-down (G-18) this takes about two minutes.

### 4.28 Step B: track the request until the files arrive

1. **Log it the same day.** On form 8.4 write:
   - the month requested;
   - the date filed;
   - the **tracking number**;
   - the portal account email;
   - the exact wording used (or "same as last month").
2. **Expect the acknowledgment within 5 business days** (L245–248). It either delivers the records or gives a time estimate. Write the estimate on form 8.4.
3. **Answer WSLCB questions the same day.** The records office may ask you to clarify, or to confirm the scope. If a question goes unanswered, the request can be closed. Reply through the portal so the answer stays on the record.
4. **Check weekly** until delivery. If the estimate date passes with no delivery, call (360) 664-1753 or email `lcbpublicrecords@lcb.wa.gov` with the tracking number.
5. **The app does not track this.** The CCRS page has no field for the tracking number on a monthly zip. The saved dataset's note is set automatically to *"Monthly zip: <file name>"* (`discovery/actions.ts` L857–862). **Form 8.4 is the only record** of the request until gap G-18 is built.

### 4.29 Step C: download and store the zip, untouched

1. **Download from the delivery link** to the computer you will drop it from. A multi-month request arrives as **one zip per month** (D32). Download each one. Use a desktop or laptop, not a phone or tablet (§4.31).
2. **Do not unzip it. Do not rename the files inside it. Do not re-zip it.** The transformer wants *"the ONE big zip from the WSLCB delivery"* exactly as delivered, *"nested zips and all"* (`ccrs/page.tsx` L289; `CcrsZipUploader.tsx` L209–214).
   > **The app's Step 1, item 5 is out of date (finding F-04-14).** It says *"When the files arrive, unzip them and upload them in Step 2 below. File names usually look like Sale_*.csv, Product_*.csv…"* (L250–256). That described an older path. The real delivery is one outer zip holding per-table zips named like `<Table>_<n>.zip`; big tables are split into chunks of at most 1,000,000 rows (`ccrs-extract/zip.ts` L1–20). **Do not unzip.** Go to §4.31.
3. **Keep a copy.** Save the original zip to the owner's chosen backup location (an external drive or the owner's cloud storage). Name the folder by month, for example `CCRS PRR 2026-10`, one folder per month. Keep the backup copy **on the same 18-month schedule** as the datasets (§4.34, D33), so the raw data does not outlive the retention rule. The back office **does not keep the raw file**. It is crunched in the browser and only the small rollups are saved (`ccrs/page.tsx` L306–308). If a month ever has to be re-done (§4.34), you need the original.
4. **Write it on form 8.4:** date received, file name, file size.
5. **The file is large and contains every licensee's data.** Keep it on Greenway equipment only. Do not email it or put it in a shared chat. The legal limit in §4.25 applies to the raw file too.

### 4.30 Step D: update the competitor roster first

The zip is read against Greenway's **Competitor Roster**: the list of license numbers the benchmarks track. The page explains: *"Every license on this roster gets tracked when you upload a monthly CCRS zip. That is how the benchmarks know which sales belong to which store."* (`discovery/competitors/page.tsx` L131–135).

**Why do this first?** The roster is read **at the moment you drop the zip**. The CCRS page says *"Tracking N licensees this run."* (`ccrs/page.tsx` L296–304). A store added after the drop is not in that month's competitor numbers until the zip is dropped again.

1. On the CCRS page, under **Step 2 — Drop the monthly zip**, click the **N licensees** link. Or open `/admin/discovery/competitors`. The page is **Competitor Roster**: *"The list of licenses the CCRS benchmarks track. Add a store or a producer/processor yourself - no code changes needed."* (L86–87).
2. **Did a store open, close or change hands nearby this month?**
   - **To add one:** fill **Add a licensee**:
     - **License number**: *"6 digits (10 for a lab). Leading zeros matter - type it exactly."*
     - **Business / store name**
     - **What are they?** (**Retailer**, **Producer / Processor** or **Unclassified**)
     - **Area**, **City**, **County**, **Note**
     - Press **Add to roster** (L186–284).
   - **To stop tracking one:** use **Turn off** on its row. *"Turning a store off stops tracking it going forward but keeps its history. Nothing here is ever permanently deleted."* (L148–151).
3. **Classify every entry.** *"The state's CCRS files do not say which is which - there is no license-type column in the data - so this is the one thing the system genuinely needs you to tell it. Anything left Unclassified is still listed and counted, but stays out of both comparisons until you classify it."* (L143–147).
   - A **Retailer** is compared on shelf prices.
   - A **Producer / Processor** is used for supply-side analysis and *"deliberately kept out of retail price averages so they cannot skew them"* (L136–141).
4. **Greenway itself** is on the roster as "self" (license **413541**). The page falls back to 413541 if no self entry exists (`ccrs/page.tsx` L107). Greenway is passed separately so it is never counted as a competitor.

### 4.31 Step E: drop the zip on the CCRS Benchmarks page

**Before you start:**
- **Computer:** a desktop or laptop with a current **Chrome or Edge** browser. The transformer runs **inside your browser** and needs a browser from 2023 or later (`ccrs-extract/zip.ts` L13–14). The raw file cannot be uploaded to the server because the hosting limit is about 4.5 MB per request (L8–9).
- **Time:** plan for a long, uninterrupted session. The screen says *"Takes a few minutes for a full month."* (`CcrsZipUploader.tsx` L214). The program's records measured a real month at **about 1.5 hours** before the transformer was moved into a background worker (`ROADMAP_BACKOFFICE_FIXES.md` L558, L627). The current time has not been re-measured (finding F-04-17). **Plan for up to 1.5 hours,** and write the real time on form 8.4 so the SOP can be corrected.
- **Power and sleep:** plug the laptop in. Turn off sleep and screen lock for the session, or keep moving the mouse. **If the computer sleeps or the tab closes, the crunch stops and nothing is saved** (L240).
- **Login:** owner, admin or manager (`inventory.manage`, `ccrs/page.tsx` L59).
- **Discovery must be on.** If the page says *"Product Discovery is currently turned off. An owner/admin can turn it back on below."*, an owner or admin presses **Turn Discovery on** (L82–95). That action needs `settings.manage` and is audited as `discovery.toggle` (`discovery/actions.ts` L99–112).

**The steps:**

1. Open the CCRS page (§4.27) and scroll to **Step 2 — Drop the monthly zip**. It says: *"Drag the ONE big zip from the WSLCB delivery straight in. Everything else — unzipping, parsing, statewide benchmarks, competitor stats, market signals — happens automatically."* (L287–290).
2. Check the line under the drop box: **Tracking N licensees this run.** N should match the roster (§4.30).
3. **Drag the zip onto the box** that says **Drag & drop the monthly CCRS zip here**. Or click the box and choose the file. It accepts `.zip` only (`CcrsZipUploader.tsx` L198, L209).
4. **Watch the progress.** The box shows, in order (L222–240):
   - **Reading zip…**
   - **Crunching <file name>**, with a counter such as **12/64 table files · 48,000,000 rows scanned**
   - **Saving rollups…**
   - Throughout: *"Keep this tab open — closing it stops the crunch (nothing partial is saved)."*

   **Do not close the tab, refresh, navigate away or let the computer sleep.** You may use other programs, but leave this tab alone.
5. **The finish message** reads: *"Saved N benchmark rows, N competitor profiles and N market signals for <start> → <end>."* followed by *"Drop next month's zip here whenever it arrives."* (L146, L249).
   - Write the three numbers and the dates on form 8.4.
   - **Check the dates.** They should be the month you asked for. The period is taken from the month that most sales in the file belong to (`discovery/actions.ts` L838–841; `ccrs-extract/aggregate.ts` L2350–2371).
6. **If it fails,** the box shows the reason and *"Nothing was saved. Fix the file (it should be the original monthly delivery zip) and drop it again."* (L258–259). See §5 for each reason. **A failed drop never removes an earlier good month** (`discovery/actions.ts` L847–852).

**One month at a time (D32).** The owner: *"each month is sent as its own zip file. So I can only upload one months zip file at a time."* The drop box takes one `.zip` per run (`CcrsZipUploader.tsx` L198, L209). For a catch-up of several months:
1. Drop the **oldest** month first and wait for its finish message.
2. Check its card (§4.32), then drop the next month.
3. Each zip becomes its own card, **CCRS monthly · YYYY-MM**, named from the month most of its sales fall in (`aggregate.ts` L2347–2368; `discovery/actions.ts` L842–845).

Oldest-first is my recommendation, so the history table fills in order. The app lines months up by period either way (`market-rollups.ts` L933–945). If you drop the same month twice, the second run **replaces** the first (§4.34).

**What the transformer reads and skips.** It reads the tables in a fixed order: Licensee, Strains, ManifestHeader, TransportedItems, Product, Inventory, LabResult, SaleHeader, SalesDetail (`run.ts` L68–80). It deliberately skips grower and lab-side tables: Areas, Contacts, Harvest, Integrator, InventoryAdjustment, InventoryPlantTransfer, Plant and PlantDestructions (`parse.ts` L173–182). You do not need to remove anything from the zip.

**What gets saved.** One dataset, labelled **CCRS monthly · YYYY-MM** (`discovery/actions.ts` L842–845), with its statewide benchmarks, competitor profiles and market signals already computed. The action writes an audit row `discovery.ccrs.monthly_zip` with the file name, period, totals and any replaced dataset ids. A failure writes `discovery.ccrs.monthly_zip.error` (L875–903).

### 4.32 Step F: check the dataset that was saved

Scroll to **Step 3 — Compute benchmarks & generate leads** on the same page (L362–430). The new month is a card. Check it against this list:

| On the card | It should say | If not |
|---|---|---|
| Name | **CCRS monthly · YYYY-MM**, the month you requested | A wrong month means the WSLCB sent a different period. Check the request on form 8.4 |
| Badge | **Ready** (green) | **Error** with red *"Error: …"* text: see §5. **Uploading** that never changes: the drop was interrupted. Delete the card (§4.34) and drop again |
| Dates line | *"<start> → <end> · Uploaded <date> · Monthly zip: <file name> · benchmarks computed <date>"* | *"benchmarks not computed yet"* on a monthly card means it did not finish |
| Chips | **Sales** with a large number. **Products**, **Inventory** and **Strains** also filled. **Lab** may be 0 | **Sales 0**: the zip had no sales tables (§4.27, F-04-18) |
| Only one card for the month | Yes. Dropping a month again **replaces** the older card after the new one succeeds (`discovery/actions.ts` L847–874) | Two cards for one month: tell the owner |

**Read the numbers with the "delta" warning in mind.** A monthly extract only contains what was **touched that month**. For example, inventory lots that moved that month, not every lot in the state. So some category breakdowns are only partly attributed (`ROADMAP_BACKOFFICE_FIXES.md` L262–268). The benchmark pages show how many transactions back each number (**n**). Trust numbers with a large n.

**Write the result on form 8.4** and initial it. The month is done.

### 4.33 Step G: read and use the benchmarks

**The three buttons on the dataset card: do NOT use them on a monthly card.** The card shows **Compute benchmarks**, **Generate vendor leads** and **Enrich KB** (L404–421). They belong to the older per-file upload path. **The owner adopted the professional fix (D34): show only the buttons that work for each kind of dataset.** On monthly cards these three will be hidden (gap G-20). Until then:

| Button | What happens on a **CCRS monthly** card |
|---|---|
| **Compute benchmarks** | Refused, safely: *"This dataset came from the monthly zip transformer — its benchmarks are already computed. Re-drop the zip to recompute."* (`discovery/actions.ts` L598–609). Nothing is lost. |
| **Generate vendor leads** | Enabled, but it reads a table the monthly zip never fills, so it creates no leads (`benchmarks.ts` L410–432, L372). Finding **F-04-15**. Use **Draft vendor leads from these suppliers** on the Leads page instead (below). |
| **Enrich KB** | Same problem. It copies brand and product facts into the knowledge base from the older per-file products table (`enrich-from-discovery.ts` L134; filled only by the per-file upload, `ingest.ts` L148), so a monthly card adds nothing (F-04-15). The per-file upload already runs it by itself (`discovery/actions.ts` L549–583). |

**Statewide view: CCRS Benchmarks.**
- Open **Product Intake → CCRS Benchmarks**. Title **Statewide Benchmarks**, subtitle *"Statewide prices, $/gram, brand & strain premiums, velocity and month-over-month trends — from the monthly CCRS drop."* (`discovery/benchmarks/page.tsx` L214–215).
- Pick the month in the dataset selector. The help panel **Reading these benchmarks** (L231–244) says:
  - *"Wholesale price = what stores PAY vendors (your buying benchmark). Retail price = shelf price shoppers pay."*
  - *"Median is the typical price; p25/p75 show the normal low-to-high band. 'n' is how many transactions back the number."*
  - *"$/gram normalizes across pack sizes so types are comparable."*
  - *"Each monthly drop keeps its own rollups — the History table lines them up month over month."*
- **The AI analyst panel** on the page answers free-text questions about that month. Treat its answers as advice; check the number it cites on the page before acting.

**Local view: Reports → Benchmarks.**
- Open **Reports**, then the **Benchmarks** tab (`ReportTabs.tsx` L19). The intro is **Local competitor & area benchmarks**: *"Know exactly how you stack up against every licensed store in Port Orchard, Bremerton, Silverdale, the Key Peninsula/Gig Harbor, and Tacoma — what they sell products for, what they pay vendors, and who they source from."* (`reports/benchmarks/page.tsx` L256–265).
- For a monthly month, the page shows the dataset switcher, an AI analyst panel, the **Local benchmarks** section (*"Your neighbourhood, <month>. Start with the headline, pick a lens, then click a row for the detail behind it."*, `LocalCommandCenter.tsx` L1091–1093), and the **Verified competitor roster** (`reports/benchmarks/page.tsx` L117–135).
- Readonly logins can see this report, so the owner can share the view with an accountant or advisor **inside Greenway**. The legal limit still applies (§4.25).

**Buying view: Product Discovery → Market movers.**
- Open **Product Intake → Product Discovery**. The **Market movers** section says: *"Lead ideas straight from the latest monthly CCRS drop — the state's best-selling products and what your tracked competitors moved most. 'Price to beat' is the real 25th-percentile unit price: sell at or below it and you undercut ~75% of the observed market."* (`MarketMoversSection.tsx` L172–173). It always uses the **latest** month.
- **Draft vendor leads from these suppliers** turns the suppliers several competitors buy from into **draft** vendor leads. Re-pressing never duplicates; it says how many were new and how many were *"already in your pipeline — skipped"* (`DraftSupplierOutreachButton.tsx` L29–42). **Drafts only. Nobody is contacted and nothing is ordered.** Working those leads is SOP-09.

**How the benchmarks feed buying decisions** (SOP-09 covers the full buying procedure):
1. Before a vendor meeting, look up the product type's **wholesale median and p25** on Statewide Benchmarks. A quote above the p75 is high for the state.
2. Before pricing a new product (§4.22), look at the **retail median and $/gram** for its type, and at the local stores in Reports → Benchmarks.
3. Use **Market movers** to find what sells well that Greenway does not carry.
4. **Never** quote a competitor's figures to a vendor or customer, or publish them (§4.25).

### 4.34 Re-doing a month, removing a month, turning it off

**Re-doing a month.** Drop the same month's original zip again (§4.31). When the new run succeeds, it **replaces** the older card for that month: *"re-uploading a month REPLACES the previous upload"*, following the owner's rule *"the table should replace a duplicate with a newer uploaded version"* (`discovery/actions.ts` L847–874). If the new run fails, the old month stays. Re-drop when:
- the roster changed (§4.30) and you want the new store in that month; or
- the WSLCB sends a corrected file.

**Removing a month: the 18-month retention rule (D33).** The owner set the rule: *"delete after 18 months."* 18 months always keeps the last full year plus six months. Every recent month can be compared with the same month last year, which is what seasonal buying needs. Until the automatic purge (gap G-20) is built:
1. **When:** on the 10th, after filing (§4.26), the admin looks at the cards in **Step 3**.
2. **What is due:** a card whose month **ended more than 18 months ago**. Count from the **end of the data month**, not the upload date. Example: on 2026-11-10, **CCRS monthly · 2025-04** (ended 2025-04-30) is past 18 months (2026-10-31) and is due. **2025-05** is not due until the 2026-12 check.
3. **Hold:** if the owner wants a month kept longer (for example, a special analysis), write **HOLD** and the reason on form 8.4. Held months are not removed.
4. **Approve:** the admin tells the owner which months are due. The owner approves by initialling form 8.4. Deleting has no "are you sure?" today (F-04-16), so the person pressing must **read the card name aloud and compare it with form 8.4** before pressing the red **Delete**. Deletion removes the month **and all its benchmarks at once** (`ccrs/page.tsx` L422–425; `discovery/actions.ts` L770–788; cascade per `ingest.ts` L81). It writes an audit row `discovery.ccrs.delete`.
5. **The raw zip too:** delete that month's backup folder (§4.29) the same day, and note it on form 8.4.
6. **What deleting changes:** the month leaves the History table and the month-over-month trend, and it no longer counts in supplier "first appearance" checks (`supplier-history-core.ts` L7–28). That is why the cut-off is a fixed rule, not an ad-hoc click.

**Other deletes** (an **Error** card or a mistaken upload) follow the same read-aloud check, owner approval only.

**This rule covers only the statewide benchmark datasets.** Greenway's **own** receiving records (manifests, lots, the truck-day sheet, refusal logs) are business records kept **five years** under WAC 314-55-087(1). They are never part of the 18-month purge.

**Coming (gap G-20, approved under D33/D34):**
- A typed "are you sure?" that names the month.
- An automatic monthly purge at 18 months, with a 30-day notice on the page, a **hold** flag and an audit row.
- The month-level headline numbers optionally kept longer for long-run trends (Q-04-8).

**The older per-file upload.** Below Step 2 is **Advanced — upload individual CSV files**: *"The older per-file path… Use the zip drop above for the monthly extract."* (L321–323). **Do not use it for the monthly delivery.** It exists for targeted uploads and needs a manual **Compute benchmarks** afterwards. Its flash message *"Uploaded and ingested N rows… Now click Compute benchmarks"* (L170–175) applies only to that path.

**Turning the whole feature off.** The CCRS benchmarks are part of **Product Discovery**. The legal note says the feature *"is fully removable"* (L280), and every Discovery action checks the switch first (`discovery/actions.ts` L84–94).
- **Turning it on** is a button on the screen (**Turn Discovery on**).
- **There is no "Turn Discovery off" button anywhere in the app.** The only toggle form sends "on" (`discovery/page.tsx` L85–87; `ccrs/page.tsx` L91–93; `discovery/import/page.tsx` L59–61). Finding **F-04-20**.
- If the owner ever needs to switch it off (for example, on WSLCB advice), it currently takes a developer.

---

## 5. Messages: "If you see this message"

### 5.1 Receiving list (import errors)

These appear in red at the top of **Receiving** after a manual import (`intake/page.tsx` L228–257).

| Message | Cause | Do this |
|---|---|---|
| "Paste the vendor JSON before importing." | The JSON box was empty | Paste the JSON, press again |
| "Paste the Transfer Data Link before importing." | The link box was empty | Paste the link |
| "Couldn't fetch that link — it may have expired or be unreachable. Paste the JSON directly instead." | The link expired or the vendor's site is down | Use the JSON from the email; or ask the vendor for a fresh link |
| "That text isn't valid JSON." | Part of the text was missed when copying | Copy the whole JSON block again |
| "No line items were found in that file." | The file has no products | Ask the vendor for the full manifest |
| "Paste the CCRS manifest.csv before importing." | The CSV box was empty | Paste the full file contents |
| "That text isn't a valid CCRS manifest.csv (no item header row found)." | Not a CCRS manifest CSV, or only part of it | Paste the whole `manifest_*.csv` |
| "Choose a PDF manifest file before uploading." | No file chosen | Choose the PDF |
| "That file isn't a PDF. Upload the manifest PDF the vendor emailed." | Wrong file type | Choose the .pdf |
| "That PDF has no readable text (it looks like a scanned image). Paste the JSON/CSV manifest instead." | A scan, not a text PDF | Ask the vendor for the JSON, link or CSV |
| "Couldn't read a WA LCB shipping document from that PDF (no Manifest ID / item table found)." | Not the WA LCB Internal Shipping Document | Use another import tool |
| "Something went wrong staging the manifest." | The save failed | Try once more; then tell the owner with the time and manifest # |
| "The KB backfill couldn't run — check the server logs." | Maintenance tool failed | Owner or developer |
| "The re-run couldn't read your data — check the server logs." | Maintenance tool failed | Owner or developer |
| "🚨 N in-transit manifest(s) past ETA — follow up with the transporter." | A truck is late (L359–363) | §4.3 step 3 |
| "Duplicate manifest X from V is already in intake … not staged again." | The same manifest # and vendor is already live (`intake-store.ts` L626–652) | Use the existing row |

### 5.2 Manifest review screen

| Message | Cause | Do this |
|---|---|---|
| "Manifest staged as a draft. Review the lines below, then accept to activate the lots." | A fresh import | Normal (§4.6) |
| "…that file carries no prices or COAs … Fill in cost and COA before accepting." | CSV or PDF import | §4.5 (no field exists; F-04-10) |
| "Duplicate row. Another row in Receiving has the same manifest # and vendor…" | The same email delivered twice | §4.7 |
| "Not saved: enter the vendor's id exactly as on their manifest (1-100 characters, no commas or quotes)." | Bad vendor id | §4.14 |
| "Please explain the 'Other' reject reason." | **Other** with no text | Type the reason |
| **Accept refused — quarterly sample cap.** "…No lots were activated and no sample event was recorded…" | Over 120 sample units this quarter with hard block on | §4.13 |
| **Note required.** "This intake is partial … add the note next to the Finalize button and finalize again." | A refused line and an empty note | §4.17 step 3 |
| "Something went wrong with that action." | Any other failure. The screen does not say which (F-04-7) | Check: a reject reason was picked; the whole-manifest reason was picked; you are logged in. Try once. Then tell the owner with the manifest # and time |
| Green / gold / grey result banners | Finalize finished | §4.18 |
| "…held in quarantine until the missing paperwork is fixed — see the Issues tab." | A lot failed the go-live check | §4.19 |
| "Vendor bill: not recorded yet — see the reason below." with *"…have no unit cost yet… Key the unit costs, then finalize again."* | A lot with no cost | §4.20: tell the owner; there is no screen to key it (F-04-10) |
| "This manifest has been accepted. Lots are managed from the inventory list." | Already finalized | Corrections are SOP-05 or SOP-15 work |

### 5.3 CCRS Benchmarks page and the zip drop

| Message | Cause | Do this |
|---|---|---|
| "The database isn't fully set up yet. Apply migration 0079_discovery_ccrs.sql…" | A setup step is missing (`ccrs/page.tsx` L82–89) | Developer |
| "Product Discovery is currently turned off. An owner/admin can turn it back on below." | The kill-switch is off | Owner or admin presses **Turn Discovery on** (§4.31) |
| "Product Discovery is turned off." (red, from the drop) | Turned off during the run (`discovery/actions.ts` L823) | Turn it on, drop again |
| "No CCRS table zips found inside this file. Drop the FULL monthly delivery zip (it contains Licensee/Product/Inventory/SaleHeader/SalesDetail zips)." | A file that was unzipped and re-zipped, the wrong file, or a partial delivery (`run.ts` L113–116) | Drop the **original** download (§4.29). If it is the original, the WSLCB sent the wrong scope (§4.27, F-04-18) |
| "The zip produced no sales rollups. It should be the full monthly CCRS delivery (with SaleHeader and SalesDetail zips inside)." | No sales tables in the delivery (`discovery/actions.ts` L831–836) | Ask the WSLCB for the full extract with SaleHeader and SalesDetail (§4.27) |
| "The rollup payload didn't validate: …" | The browser produced unexpected data (L828) | Try again in a current Chrome or Edge. If it repeats, tell the developer with the message |
| "Could not create the dataset (database not configured)." | Server setup (L864) | Developer |
| "Nothing was saved. Fix the file (it should be the original monthly delivery zip) and drop it again." | Shown under any failure (`CcrsZipUploader.tsx` L258–259) | Read the line above it, then use this table |
| A card with **Error** and "Error: …" | Saving failed part way. Nothing partial is used; only **Ready** months are read (`ROADMAP_BACKOFFICE_FIXES.md` L556–561) | Owner deletes the Error card (§4.34) and drops again |
| "This dataset came from the monthly zip transformer — its benchmarks are already computed. Re-drop the zip to recompute." | **Compute benchmarks** pressed on a monthly card | Nothing to do (§4.33) |
| "Created 0 new vendor lead(s)…" or nothing happens | **Generate vendor leads** on a monthly card (F-04-15) | Use **Draft vendor leads from these suppliers** (§4.33) |
| "Dataset deleted." | **Delete** pressed | If it was a mistake, drop the original zip again |
| "Uploaded and ingested N rows… Now click Compute benchmarks…" | The older per-file path was used | Only for **Advanced** uploads (§4.34) |
| Reports → Benchmarks: "No CCRS dataset uploaded yet…" | No month yet (`reports/benchmarks/page.tsx` L104–112) | Finish §4.27–§4.32 |

---

## 6. Exceptions & escalation

| Situation | What to do | Who to tell |
|---|---|---|
| **The driver's ID or plate does not match the manifest** | Do not unload. Call the manager. If it cannot be resolved, refuse the whole manifest (§4.12, reason **Other (explain)**) | Manager → owner |
| **A seal is broken or the product looks tampered with** | Do not accept the affected lines. Photograph it, write the seal numbers in **Route notes**, refuse at the dock (**Damaged / broke in transit** or **Other (explain)**) | Manager, same day |
| **A short count** | §4.11: recount, then refuse the whole line | Vendor via form 8.3 |
| **More product than the manifest** | Refuse the extra with **Overage — more than ordered**, or refuse the line | Manager |
| **A product arrived with no manifest row** (the email did not stage) | §4.3 step 4: import by hand before you count | Owner (note on form 8.1) |
| **A whole delivery arrived with no manifest at all** | Do not accept product with no manifest. Ask the driver for the transfer document; import it (§4.5). If there is none, refuse the delivery | Manager → owner |
| **Refused a line too late** (already finalized and accepted) | The product is now Greenway inventory. **Do not** try to "un-accept" it. Returning accepted product needs a return manifest and is **SOP-15** work | Owner, same day |
| **Accepted a line with a FAILED lab result** | It is held at Finalize and cannot be sold (§4.15). Never set it Active (§4.19). Return or destroy under SOP-15 | Owner |
| **A held lot's Issues row never turns "now clear"** | Chase the vendor for the COA or the corrected manifest. Write each chase on form 8.3 | Owner after 3 business days |
| **"Something went wrong with that action."** twice | Stop. Do not keep pressing. Write the manifest #, what you pressed and the time | Owner or developer |
| **The truck is here but the manifest is still Pending** (manual import) | Normal. Finalize marks it received (§4.1) | No one |
| **The vendor bill was refused for no unit cost** | §4.20 | Owner, same day |
| **A sample delivery is over the quarterly cap** | §4.13 | Vendor (button), owner |
| **The monthly records request has had no answer in 5 business days** | Call (360) 664-1753 or email with the tracking number (§4.28) | Owner |
| **The WSLCB delivered the wrong month or only some tables** | Do not drop it. Reply on the portal with the tracking number and ask for the full month (§4.27) | Owner |
| **The zip drop failed** | §5.3. Never unzip "to help" | Owner; developer if it repeats |
| **Someone deleted a month by mistake** | Drop the original zip again (§4.29 keeps a copy for 18 months) | Owner |
| **The WSLCB declines a standing monthly request** | File a new request every 10th (§4.27) | Admin |
| **A first delivery from a new vendor, and nobody can second-count** | Single count is allowed (D31). Write "single count, first delivery, nobody available" on form 8.1 | Manager |
| **Someone wants a copy of the CCRS data or the benchmarks** (vendor, other store, reporter) | The answer is no (§4.25) | Owner |

---

## 7. Controls & compliance (why the rules exist)

| Control | Why | Where it comes from |
|---|---|---|
| **Count every line before Finalize** | Finalize accepts every line not rejected (`intake-store.ts` L1416). The count is the only check a human does | R31 design; owner quote in §1 |
| **Refuse at the dock, never "accept then fix"** | Refused product was never Greenway's, so nothing is filed with CCRS. Accepting and adjusting misstates the weekly InventoryTransfer quantity | `docs/ccrs-rejection-and-returns.md` L15–21; `ccrs-transfer-core.ts` L33–36 |
| **No partial quantities; refuse the whole short line** | The system cannot record "18 of 20" (F-04-1, **S1**, G-16 **APPROVED**, D29) | Interim rule §4.11 until G-16 is built |
| **Only managers process manifests** | Owner rule D30; matches `inventory.manage` | §2 |
| **Second count strongly recommended; expected on a first delivery** | Owner rule D31 | §4.9 |
| **Benchmark months kept 18 months, then removed on the 10th with owner approval** | Owner rule D33; a fixed schedule protects the history | §4.34 |
| **No return manifest for driver-present refusals** | Contingency manifests are discontinued (WSLCB, Nov 2025); the vendor updates or deletes their own manifest | `[id]/page.tsx` L1341–1357 |
| **A reason for every refusal; a note for every partial finalize** | The permanent timeline shows why stock did not arrive | `intake-disposition-core.ts` L68–84, L150–168 |
| **The go-live check** (CCRS id, lab result, not FAILED) | WAC 314-55-102: no retail sale without a passing COA | `lot-activation-gate-core.ts` L76–107 |
| **Only set a held lot Active from a "now clear" Issues row, manager only, logged on paper** | The lot page's Lifecycle status skips the go-live check and the audit log (F-04-2, S1; G-19) | §4.19 |
| **Quarterly sample cap: 120 units per processor** | WAC 314-55-096(1)(f)(ii) | `intake-store.ts` L1070–1099 |
| **Transport details checked against the driver and vehicle** | WAC 314-55-085 transport manifest requirements | `concierge-kb.ts` L142; §4.8 |
| **Vendor inventory ids confirmed** | The weekly InventoryTransfer "from" id must match the vendor exactly | `ccrs-transfer-core.ts` L1–43 |
| **Manager login for every Receiving action** | `inventory.manage` on every action; staff cannot finalize | `intake/actions.ts`; `roles.ts` L106 |
| **Every manifest email has a row** (daily comparison) | Failed or empty emails are logged but not shown (F-04-4, G-17) | §4.3 |
| **Duplicate dismissal is audited and is not a rejection** | One transaction and an audit row; nothing is filed | `intake/actions.ts` L546–583 |
| **Paper record of the count** (form 8.1, 8.2, 8.3) | The app does not record who physically counted | §2 |
| **PRR data for internal buying and pricing only** | RCW 42.56.070(8) commercial-use limit | `ccrs/page.tsx` L278–280; roadmap L19–23 |
| **Monthly request logged on form 8.4** | The app has no reminder and no tracking-number field (F-04-19, G-18) | §4.26, §4.28 |
| **Original zip kept untouched** | The app keeps only rollups; re-doing a month needs the original | §4.29 |
| **A benchmark month is deleted only with owner approval and a read-aloud check** | Delete has no confirmation (F-04-16; typed confirm approved, D34) | §4.34 |
| **Every benchmark action is audited** | `discovery.ccrs.monthly_zip`, `.error`, `discovery.ccrs.delete`, `discovery.toggle` | `discovery/actions.ts` L99–112, L770–788, L875–903 |

---

## 8. Checklists & forms

### 8.1 Truck-day sheet (one per manifest; the record of who counted)

```
GREENWAY — TRUCK-DAY SHEET                         Date: ____/____/______
================================================================================
BEFORE THE TRUCK (manager, from the review screen)
  Manifest # ______________   Vendor ________________________   Lines on screen: ____
  Source: [ ] email (In transit)  [ ] manual import (Pending)  [ ] CSV/PDF only — needs COA/cost
  Review flags read?  [ ] yes   Lines with no COA (—): ____   Unmapped category: [ ] none
  PO linked?  [ ] yes  PO # ________   [ ] no PO (sample / walk-in)
  FIRST delivery from this vendor? (Receiving → All → Vendor filter, §4.9)  [ ] yes → 2nd count expected  [ ] no
  ETA ____________   Overdue calls (time · who · answer) ______________________________

ARRIVAL (§4.8)
  Driver name matches manifest?  [ ] yes  [ ] NO → manager      Plate matches? [ ] yes [ ] NO
  Arrived (time) ______   Seal #s / condition __________________________________
  Transport details saved on screen?  [ ] yes

COUNT (§4.9) — one row per manifest line, in screen order
  #  | Product / lot (as on screen)        | Qty on screen | Counted | Condition | ✔ or problem
  1  | ___________________________________ | ______        | ______  | ________  | ____________
  2  | ___________________________________ | ______        | ______  | ________  | ____________
  3  | ___________________________________ | ______        | ______  | ________  | ____________
  4  | ___________________________________ | ______        | ______  | ________  | ____________
  5  | ___________________________________ | ______        | ______  | ________  | ____________
  (continue on the back)

  Lines refused on screen (✕ Reject) ____   → each one also on form 8.2
  Counted by (print + sign): ____________________   Second count (strongly recommended, D31): ________________
  [ ] Single count only — reason (first delivery + nobody available / other): ____________________
  Manager processing this manifest (D30): ____________________

FINALIZE (manager, §4.17)
  Button read: "✓ ____________________________________ & Finalize"
  Accept / reject numbers match this sheet?  [ ] yes
  Partial note written (if any refused)?  [ ] yes   Time pressed: ______
  Result banner: [ ] green  [ ] gold (partial)  [ ] held lots ____  [ ] nothing accepted
  Vendor bill: [ ] recorded  [ ] refused — no unit cost → owner told (time) ______
  Held lot set Active from a "now clear" Issues row (lot · time · manager) __________________
  Email with NO row on the Incoming tab (§4.3) → imported by hand?  [ ] n/a  [ ] yes
  Labels printed [ ]   New products onboarded (§4.22) [ ]   Manager sign: ______________
```

### 8.2 Dock refusal log (one line per refused line or whole manifest)

```
Date       | Manifest # | Vendor        | Line / product         | Qty on manifest | Qty here | Reason (as picked on screen)   | Left with driver? | Driver initials | Logged by
2026-11-02 | 0012345678 | Example Farms | Blue Dream 3.5g        | 20              | 18       | Short shipment — refused whole | [x]               | ____            | J.D.
2026-11-02 | 0012345678 | Example Farms | Gummies 10pk           | 12              | 12 (2 crushed) | Damaged / broke in transit | [x]           | ____            | J.D.
2026-11-05 | 0012349999 | Other Co      | WHOLE MANIFEST         | —               | —        | Wrong product                  | [x]               | ____            | M.L.
```

### 8.3 Vendor follow-up log (CCRS Update / Delete, sample notices, missing COAs)

```
Date opened | Manifest # | Vendor | What we asked for                                   | How (email/phone) | Vendor answer | CCRS confirmation seen (date) | Closed by
2026-11-02  | 0012345678 | ...    | CCRS manifest UPDATE: line 3 qty 20 → removed       | email             | ...           | 2026-11-04 (Mon/Wed/Fri run)  | ____
2026-11-02  | 0012345678 | ...    | COA for lot ___ (held in quarantine)                | phone             | ...           | n/a                           | ____
2026-11-05  | 0012349999 | ...    | Sample cap notice sent? [sent / no email / not configured / failed] | button   | ...   | n/a                           | ____
```

### 8.4 Monthly CCRS records request log (the reminder until gap G-18 is built)

```
GREENWAY — MONTHLY CCRS PUBLIC RECORDS REQUEST       Month(s) requested: ____-____ to ____-____
================================================================================
ADMIN FILES ON THE 10TH OF EVERY MONTH (next business day if weekend/holiday).  Data use: internal buying & pricing ONLY
(RCW 42.56.070(8)).  Do NOT share files or benchmarks outside Greenway.

A  FILE (§4.27)      Filed by (admin) ____________   Date ____/____/______
   Standing request? Asked WSLCB on ________  Answer: [ ] yes — check only  [ ] no — file monthly
   Portal: https://lcbwa.govqa.us/WEBAPP/_rs/     Account email: ______________________
   Period asked: ____-____-01 through ____-____-____  (one month, or several — one zip per month)
   Wording: [ ] built-in text from the CCRS Benchmarks page, dates only changed (D32)
   TRACKING #: ______________________

B  TRACK (§4.28)     Acknowledged (date) ________  Estimate / due date ________
   WSLCB questions answered (date · what) ___________________________________________
   Chased (date · phone (360) 664-1753 / email lcbpublicrecords@lcb.wa.gov) _____________

C  RECEIVE (§4.29)   Received (date) ________   Zips (one per month): ________________  Sizes ______
   Backup copy saved (where) _______________________   [ ] NOT unzipped / renamed

D  ROSTER (§4.30)    Roster checked [ ]  Stores added/turned off: ______________________
   "Tracking N licensees this run": N = ____

E  DROP (§4.31)      Dropped by ____________  Computer/browser ________  Start ____  End ____
   Real time taken: ______ (tell the owner — the screen says "a few minutes")
   Finish message: ________ benchmark rows · ________ competitor profiles · ________ signals
   Period on finish message: ____-____-____ → ____-____-____

F  CHECK (§4.32)     Card "CCRS monthly · ____-____"  Badge [ ] Ready   Sales chip ________
   One card only for this month [ ]       Checked by ____________   Date ________
   (several months: drop and check one at a time, oldest first — repeat E/F per month)

G  RETENTION (§4.34, D33 — 18 months from the END of the data month)
   Months now due: ______________________   HOLD (month · reason · owner initials): ____________
   Owner approval (initials) ______   Card name read aloud & matched [ ]   Deleted by ______  Date ______
   Backup zip folder for the same month(s) deleted [ ]
```

### 8.5 Manager Finalize checklist (read before pressing the button)

```
[ ] Every line counted and marked on form 8.1 (by me or a trained employee who signed it)
[ ] Second count done — or the single-count reason written (expected on a FIRST delivery, D31)
[ ] Every short / broken / wrong / overage line shows "✕ Rejected at dock" with a reason
[ ] Refused product is back on the truck; form 8.2 filled
[ ] Transport details saved; driver + plate checked; seal numbers in Route notes
[ ] Vendor inventory ids: no line still says "needs confirming for CCRS" (or confirmed now)
[ ] PO linked (or there was no PO)
[ ] Sample lines: none over the quarterly cap (or the over-cap lines refused)
[ ] The button's accept / reject numbers match form 8.1
[ ] Partial note written if anything is refused
[ ] Press ONCE. Read the banner. Write it on form 8.1.
[ ] After: Issues tab, Accounting tab, labels, Product Onboarding — same day
[ ] NEVER set a lot Active from the lot page unless its Issues row says "now clear"
```

---

## 9. Quick reference card

```
┌──────────────────────────── GREENWAY — RECEIVING (TRUCK DAY) ────────────────────────────┐
│ MORNING: Product Intake → Receiving. "Awaiting intake" from yesterday = finish it today.  │
│   Every vendor manifest email must have a row. No row? Manual tools → Transfer Data Link. │
│ TRUCK: check driver + plate against the manifest. Mismatch → don't unload, call manager.  │
│   Save transport details. Seal numbers → Route notes.                                     │
│ COUNT every line: name · lot · units · condition. Mark form 8.1.                          │
│   2nd count strongly suggested — EXPECTED on a vendor's first delivery. Manager decides.  │
│ GOOD line → touch nothing ("Will accept").                                                │
│ BAD line → ✕ Reject → reason → ✕ Confirm reject → product leaves WITH THE DRIVER.         │
│   SHORT? recount → still short → refuse the WHOLE line. Never "accept then adjust".       │
│ FINALIZE once: read the button numbers vs form 8.1, write the note if partial, press.     │
│   Untouched lines are ACCEPTED. Refuse BEFORE Finalize.                                   │
│ AFTER: Issues tab (held lots) · Accounting (bill refused? tell owner) · labels · onboard. │
│ Refused product: we file NOTHING with CCRS. Vendor does Update/Delete. NO return manifest.│
│ ⚠ Lot page "Lifecycle status" skips the safety check — only from a "now clear" Issues row.│
│                                                                                           │
│ MONTHLY (ADMIN, the 10th): file CCRS records request for LAST month (built-in text) →     │
│   log tracking # on 8.4 → each month = its own zip, DON'T unzip → roster → drop ONE month │
│   at a time on CCRS Benchmarks, keep the tab                                              │
│   open (up to ~1.5 h) → card "CCRS monthly · YYYY-MM" = Ready. Internal use ONLY.         │
│   Don't press Compute / Generate vendor leads / Enrich KB / Delete on a monthly card.     │
│   Records office phone: (360) 664-1753 (the app's 664-1769 is wrong).                     │
│   Months > 18 months old (from month end): remove on the 10th, owner approves, + backup.  │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **Manifest** | The vendor's CCRS transport record for a delivery: what was shipped, by whom, in which vehicle. |
| **Transfer Data Link** | A link in the vendor's order email to the full transfer file (products, prices, COAs). The best import (§4.5). |
| **Staging / staged** | The system has read a manifest and made a draft row with quarantined lots. Nothing is sellable yet. |
| **Quarantine** | Lot status for product that is staged, or accepted but held by the go-live check. Not sellable. |
| **Finalize** | The one button that receives, accepts, activates, refuses and books a delivery (§4.17). |
| **Will accept** | The default state of every line. Finalize accepts it unless you press **✕ Reject**. |
| **Rejected at dock / refuse at the dock** | The product left with the driver and was never Greenway's. Nothing is filed with CCRS. |
| **Partially Accepted** | Some lines accepted, others refused or held. |
| **Go-live check** | The activation gate: a CCRS identifier, a lab result on record, and not FAILED (`lot-activation-gate-core.ts`). |
| **Held lot** | An accepted lot that failed the go-live check. It shows on the Issues tab. |
| **Vendor inventory id** | The vendor's CCRS InventoryExternalIdentifier. It must match exactly on the weekly InventoryTransfer file. |
| **InventoryTransfer** | The weekly CCRS file in which the receiver reports accepted inbound lots (SOP-16). |
| **CCRS manifest Update / Delete** | What the **vendor** submits to fix or remove a line Greenway refused. |
| **Contingency manifest** | A discontinued WSLCB process (Nov 2025). Never used for refusals. |
| **Sample cap** | No more than 120 trade sample units per processor per quarter (WAC 314-55-096). |
| **Product Onboarding / draft product** | A new product made from a delivery, waiting for a manager to approve it with a price. |
| **COA** | Certificate of analysis: the lab's test report for a lot. |
| **PRR / Public Records Request** | A request under RCW 42.56 for government records. Here: the monthly CCRS extract. |
| **CCRS extract / monthly zip** | The WSLCB's statewide CCRS data for one month: one outer zip of per-table zips, UTF-16 tab-delimited. |
| **Transformer** | The back-office code that reads the zip **in your browser** and saves only rollups (`ccrs-extract/`). |
| **Rollups / benchmarks** | Summary numbers (medians, p25/p75, $/gram, velocity) per category, brand, strain and store. |
| **Competitor Roster** | The list of license numbers the benchmarks track, classified Retailer / Producer / Processor / Unclassified. |
| **p25 / median / p75 / n** | The low end of the normal band / the typical value / the high end / how many transactions back it. |
| **Delta** | A monthly extract only holds records touched that month, not the whole state master. |
| **Discovery (kill-switch)** | The Product Discovery feature switch. When off, all Discovery and CCRS benchmark actions stop. |

---

## Appendix A: Source map (verified at `main@5299660b`)

| SOP section | Code / document (read for this SOP) |
|---|---|
| 1 purpose | `docs/sop-program/00-OWNER-REQUEST-VERBATIM.md` L7, L81, L94; `docs/ccrs-rejection-and-returns.md` L13–21; `ManifestLotDisposition.tsx` L133–136; `docs/ROADMAP_BACKOFFICE_FIXES.md` L276–300; `docs/INTAKE_PIPELINE_ROADMAP_DECISIONS.md` L157 |
| 2 roles | `src/app/admin/inventory/intake/actions.ts` (all actions `inventory.manage`); `intake/page.tsx` L99; `src/lib/auth/roles.ts` L99, L106, L149, L248; `drafts/page.tsx` L252; `discovery/ccrs/page.tsx` L59; `discovery/competitors/page.tsx` L66; `discovery/benchmarks/page.tsx` L131; `reports/benchmarks/page.tsx` L81; `discovery/actions.ts` L99 |
| 3 / 4.2 screens | `src/components/admin/admin-nav-data.ts` L71–81; `intake/page.tsx` L264–357, L430–681; `EmailIntakeTable.tsx` L133–294; `receiving-tabs-core.ts` |
| 4.1 pipeline | `src/lib/inventory/manifest-pipeline-core.ts` L28–104, L190–206; `inbound-store.ts` L803–814; `intake-store.ts` L899; `guided-accept-core.ts` L65, L84 |
| 4.3 / 4.4 email | `src/app/api/webhooks/inbound-email/route.ts` L1–81, L135–160, L314–320; `inbound-store.ts` L862–884; `intake/page.tsx` L164, L213–220 (commit 7cb4702c removed the panel) |
| 4.5 manual tools | `intake/page.tsx` L228–257, L497–681; `intake/actions.ts` L34–198, L636–648 |
| 4.6 review | `intake/[id]/page.tsx` L440–597, L886–905, L936–1100; `intake-checklist-core.ts` L102–175 |
| 4.7 duplicates | `manifest-dedupe-core.ts` L24–35, L84, L110–124; `intake-store.ts` L626–652; `intake/actions.ts` L488–506, L546–583; `DismissDuplicateForm.tsx`; `InvoiceNumberCell.tsx` |
| 4.8 transport | `[id]/page.tsx` L1157–1308; `intake/actions.ts` L289–318; `GuidedAcceptRibbon.tsx` L128 |
| 4.9–4.12 count / refuse | `guided-accept-core.ts` L165–175; `ManifestLotDisposition.tsx` L59–151; `intake-disposition-core.ts` L24–84, L128–193; `intake-store.ts` L970–1068; `[id]/page.tsx` L1341–1424; `intake-parser.ts` L606 |
| 4.13 samples | `intake-store.ts` L1070–1100, L1371–1388; `sample-intake-cap-core.ts` L116, L146–154; `samples/page.tsx` L103–121, L283–286; `intake/actions.ts` L1146–1185; `[id]/page.tsx` L682–726 |
| 4.14 vendor ids | `ccrs-transfer-core.ts` L1–63; `[id]/page.tsx` L465–485, L1038–1072; `intake/actions.ts` L622–629 |
| 4.15 COAs | `lot-activation-gate-core.ts` L76–107; `[id]/page.tsx` L1104+ |
| 4.16 PO | `ManifestPoLinkPanel.tsx`; `intake/actions.ts` L267 |
| 4.17–4.18 finalize | `intake/actions.ts` L937–1133; `intake-store.ts` L1301–1840 (L1416 default-accept); `finalize-label-core.ts` L80–116; `finalize-banner-core.ts` L60–125; `[id]/page.tsx` L609–734, L1366–1391 |
| 4.19 held lots | `[id]/page.tsx` L383–397, L770–790; `issues-core.ts` L545–569; `inventory/[id]/page.tsx` L130–136, L763, L1497–1512; `inventory/actions.ts` L142–155, L268–303; `inventory/store.ts` L849–864; `scripts/compliance/check-activation-gate.ts` L60–100 |
| 4.20 accounting | `ManifestAccountingPanel.tsx`; `manifest-event-labels-core.ts` L217–230; `vendor-bill-service.ts` L262–287; `INTAKE_PIPELINE_ROADMAP_DECISIONS.md` L34–46 |
| 4.21 labels | `lots/[id]/label/page.tsx` L1–63 |
| 4.22–4.23 onboarding | `drafts/page.tsx` L263, L775, L797–815, L1984–2026; `src/lib/inventory/catalog-drafts.ts` L1218+, L1348–1356; `receiving-classification-core.ts` L178–245; `merge-review-core.ts` L30–50 |
| 4.24 follow-up | `docs/ccrs-rejection-and-returns.md` L158–163, L192–196 |
| 4.25 PRR purpose | `docs/CCRS_DATA_ACCESS.md` L6–23, L58–68; `ROADMAP_BACKOFFICE_FIXES.md` L196–300; `ROADMAP_DISCOVERY_CCRS_BENCHMARKS.md` L19–23; `discovery/ccrs/page.tsx` L278–280, L306–316 |
| 4.26 timeline | `compliance-calendar-core.ts` L86–136 (no PRR task) |
| 4.27–4.29 file / track / store | `discovery/ccrs/page.tsx` L29–36, L125–126, L211–280; WSLCB public records page (2026: portal, (360) 664-1753, form LIQ 826); `ccrs-extract/zip.ts` L1–20 |
| 4.30 roster | `discovery/competitors/page.tsx` L86–151, L186–284; `competitor-roster-core.ts` L69–71; `ccrs/page.tsx` L103–107, L296–304 |
| 4.31 drop | `ccrs/page.tsx` L82–95, L287–319; `CcrsZipUploader.tsx` L113–259; `ccrs-extract/run.ts` L68–80, L113–116; `parse.ts` L173–182; `aggregate.ts` L2350–2371; `discovery/actions.ts` L817–905 |
| 4.32 check | `ccrs/page.tsx` L44–56, L362–430; `market-rollups.ts` L864–906; `ROADMAP_BACKOFFICE_FIXES.md` L262–268 |
| 4.33 use | `discovery/actions.ts` L592–660, L718–765; `benchmarks.ts` L365–432; `ingest.ts` L251; `discovery/benchmarks/page.tsx` L206–250; `reports/benchmarks/page.tsx` L81–135, L254–275; `LocalCommandCenter.tsx` L1091–1093; `ReportTabs.tsx` L19; `MarketMoversSection.tsx` L172–186; `DraftSupplierOutreachButton.tsx` L1–42 |
| 4.34 redo / delete / off | `discovery/actions.ts` L84–112, L770–788, L847–874; `ccrs/page.tsx` L321–360, L422–425; `discovery/page.tsx` L85–87; `discovery/import/page.tsx` L59–61 |
| In-app SOP sheets (stale) | `src/lib/catalog/sop-core.ts` L66–96 (truck-day; stale L79, L81, L83), L125–145 (order; stale L137), L148–170 (receive; stale L158, L162); `intake/page.tsx` HelpPanel L275–287 (stale L279–282) |
| Help / concierge | `src/lib/admin/concierge-kb.ts` `product-intake` L132–148, `ccrs` L349–360; `src/lib/admin/help-content.ts` L1009–1011 |
| Tests (all in `tests/compliance/`) | `intake-partial-accept`, `otherwise-taken-receiving`, `r31-manifest-review-walk` (.tsx), `r6-2-inventory-transfer`, `manifest-dedupe`, `r36-inbound-dedupe`, `intake-transport`, `intake-checklist-core`, `r23-finalize-banner`, `sample-intake-cap`, `sample-cap-notice`, `disposition-core`, `ccrs-monthly-rollups`, `intake-roadmap-decisions` |

## Appendix B: Not built yet (interim procedures)

| Need | Today | Interim procedure in this SOP | Gap · finding |
|---|---|---|---|
| Receive part of a line ("18 of 20") | Accept whole or refuse whole only | Refuse the whole short line; vendor re-sends (§4.11) | G-16 (**APPROVED**, D29) · F-04-1 (S1) |
| See emails that failed to stage | Logged, shown nowhere | Daily email-vs-list comparison (§4.3) | G-17 · F-04-4 |
| Monthly PRR reminder and tracking | No calendar task; no tracking # field | Form 8.4 (§4.26–§4.28) | G-18 · F-04-19 |
| Activate a now-clear held lot safely | Lifecycle status writes any status, no gate, no audit | Manager only, from a "now clear" row, logged on 8.1 (§4.19) | G-19 · F-04-2 |
| Key cost / COA for a CSV or PDF import | Banner says to; no field | Get the JSON or link; otherwise owner follow-up (§4.5, §4.20) | F-04-10 |
| Record who counted; mark a first delivery from a vendor | Not in the app | Form 8.1 signatures and the first-delivery box (§4.9) | G-21 · D30 · D31 |
| Confirm before deleting a benchmark month; 18-month retention; hide dead buttons | Deletes on one press; no purge; dead buttons shown | Read-aloud check, owner approval, monthly retention check on form 8.4 (§4.33–§4.34) | G-20 (**APPROVED**, D33/D34) · F-04-15 · F-04-16 |
| Month drop-down in the request text; reminder on the 10th; tracking-number field | Free-text dates; no reminder | Type the dates; admin's own calendar reminder; form 8.4 (§4.26–§4.28) | G-18 (**APPROVED** in part, D32) · F-04-19 |
| Turn Discovery off from the screen | No off control | Developer (§4.34) | F-04-20 |

## Appendix C: Open questions for the owner

| # | Question | Why it matters | Interim rule in this SOP |
|---|---|---|---|
| **Q-04-1** | Short lines: refuse whole, or build partial receive? | **Answered (D29):** *"we need a way to accept less than what came in, please add this to the list of serious issues to fix."* G-16 **APPROVED**; F-04-1 → **S1**. | Refuse the whole line until built (§4.11). |
| **Q-04-2** | Receiver-level access without a manager login? | **Answered (D30):** *"no, only managers will process manifests."* | §2. |
| **Q-04-3** | Second count required? | **Answered (D31):** not required; *"highly suggested, especially for new vendors we havent received from before."* | §4.9, form 8.1. |
| **Q-04-4** | Who files, which day, standing request, wording? | **Answered (D32):** admin only, the 10th, standing request wanted, the built-in text; month drop-down approved (G-18); each month arrives as its own zip. | §4.26–§4.31. |
| **Q-04-5** | Retention of monthly datasets? | **Answered (D33):** delete after 18 months, the professional way (G-20). | §4.34, form 8.4 part G. |
| **Q-04-6** | Delete confirmation; Generate vendor leads / Enrich KB on monthly cards? | **Answered (D34):** "are you sure" yes; buttons: the owner delegated to the professional solution, so show only working actions (G-20). | §4.33–§4.34. |
| **Q-04-7** | D30 says only managers process manifests. May a **non-manager trained employee still help with the physical count** (and sign form 8.1), with the manager deciding and finalizing? | My reading of D30; the SOP should not assume. | Yes, helpers may count; the manager decides and finalizes (§2). |
| **Q-04-8** | (Optional, part of the D33 professional design) When a month passes 18 months, keep its **one-row headline summary** (median prices, totals) for long-run trends while deleting the detail? Or delete everything? | Keeps multi-year trend lines at almost no cost; the detail is still purged. | Delete everything at 18 months (§4.34). |
| **Q-04-9** | When the admin is away on the 10th, who files? The owner, or a named manager? | D32 says "only admin". | The owner files and writes it on form 8.4. |

## Appendix D: Revision history

| Version | Date | Change | By |
|---|---|---|---|
| 1.0 draft | 2026-10-27 | First issue. Written from the code at `5299660b`, with the owner's rejection rulings (`ccrs-rejection-and-returns.md`), the R31 one-button design, the owner's CCRS transformer vision, and D28. Part 1 truck day (§4.1–§4.24); Part 2 monthly CCRS public records request (§4.25–§4.34). Adds findings F-04-1…F-04-20, gaps G-16…G-19, questions Q-04-1…Q-04-6, forms 8.1–8.5. | SOP program (for owner review) |
| 1.1 draft | 2026-10-27 | Slice SOP-05a. Owner answers D29–D34 applied: partial receive approved and S1 (§4.11; G-16); only managers process manifests (§2); second count strongly recommended, expected on a vendor's first delivery (§4.9, form 8.1; G-21); admin files on the 10th, standing request procedure with WAC 44-14-04004(4), built-in wording kept, one zip per month (§4.26–§4.31, form 8.4; G-18); 18-month retention with owner approval and backup purge (§4.34, form 8.4 part G; G-20); delete confirmation and working-buttons-only approved (§4.33; G-20). New questions Q-04-7…Q-04-9. No code was re-audited; pins still at `5299660b` (`ac251766` is docs-only). | SOP program |
| 1.2 draft | 2026-10-27 | Slice SOP-05b. Living-SOP reminder added under the title (owner decision D41: update this SOP whenever a gap it names is built). Line references re-checked after the performance merge (`main@827facb5`; register files now under `src/app/(site)/pos/`). No procedure changed. | SOP program (for owner review) |
