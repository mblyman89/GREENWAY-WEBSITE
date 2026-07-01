# Becoming Your Own CCRS Reporting Entity — Step-by-Step Guide

For: Greenway Marijuana (WA I-502 retailer, Port Orchard). Purpose: replace Cultivera by reporting
your own data directly to the LCB's CCRS. Every fact here is verified from official LCB pages
(see `docs/_research_notes_ccrs.md`). Do NOT guess — if a screen differs from this guide, stop and ask.

---

## THE KEY INSIGHT (read this first)

There are **two different things** people call "being your own reporting entity," and you almost
certainly want the **first, simpler one**:

- **PATH A — SELF-REPORT (this is you).** As the licensee, you log into CCRS and upload your **own**
  CSV files. **No application, no LIQ-1455, no integrator approval is required.** This fully replaces
  paying Cultivera to submit on your behalf. Our back office generates the CSVs; you upload them.

- **PATH B — THIRD-PARTY INTEGRATOR.** Required **only** if you want to submit reports **on behalf of
  OTHER licensees** (i.e., become a Cultivera-like service provider for other shops). This needs form
  **LIQ-1455** and LCB approval. You do **not** need this just to report for your own store.

> Recommendation: Do **Path A** now. Keep Path B documented (Section C) in case you later want to
> report for additional licenses/entities you control or offer it as a service.

Either way: **the licensee is always legally responsible for the accuracy of what is reported.**

---

## PART A — SELF-REPORT SETUP (do this to replace Cultivera)

### Step A1 — Create/confirm your login
- CCRS lives at **https://cannabisreporting.lcb.wa.gov/**.
- Sign in with your **SAW (SecureAccess Washington)** account today.
- **Transition note:** WA is moving CCRS sign-in to **WA.gov single sign-on around October 2026**.
  Create a WA.gov account ahead of time at **https://manage.login.wa.gov** so you're not locked out
  during the switch.

### Step A2 — Confirm your license is linked and you are the active admin
- Make sure your CCRS profile is tied to your I-502 retail license.
- Confirm you (or a trusted staffer) are the **active administrator** on the license — only the active
  admin can manage access (this matters if you ever add/remove an integrator later).

### Step A3 — Understand what you upload (file types)
CCRS accepts **CSV files only** (uploaded through the portal). The relevant ones for a retailer:
- **Sale.CSV** — every retail sale.
- **Inventory / InventoryAdjustment.CSV** — receiving product, returns, waste/loss, corrections.
- **Manifest.CSV** — when you record incoming transfers (CCRS then generates the official manifest PDF).
- (Other CSV types exist for producers/processors; a pure retailer mainly files Sales + Inventory,
  plus Manifests for inbound transfers.)

**Hard technical facts (verified):**
- **There is NO API.** CCRS is file-upload only. Nothing pushes in real time. Our system's job is to
  produce correct CSVs; a human uploads them via the portal.
- **You cannot pull your data back out** of CCRS. To see what was reported historically you must file a
  **Public Records request**. So keep your own copies of everything you upload (our back office does).
- **File size:** keep each file **≤ 1 GB** (2 GB max, but slower). The file **name** is referenced in the
  processing status (PST), so use clear names.

### Step A4 — Learn the reporting cadence (put these on a calendar)
- **Weekly reporting (CCRS):** the week runs **Sunday–Saturday**, and that week's data is due **no later
  than the following Sunday.** More frequent uploads are allowed. There is **no "nothing changed" report**
  — if there's nothing new, you file nothing.
- **Monthly tax return (LIQ-1295 — Retailer Sales & Excise Tax):** you **must** file this **every month,
  even if you had zero sales**, and pay by the tax due date. (Historically the 20th of the following
  month — confirm the current due date on your LIQ-1295.) Missing this is grounds for suspension/revocation
  (WAC 314-55-092(2)). This is separate from the weekly CCRS uploads.

### Step A5 — The weekly self-report routine (what you'll actually do)
1. In the back office, generate the week's CCRS CSV export (our Slice-105 hard gate guarantees the file is
   well-formed before it will let you export — if it blocks, fix the flagged data first).
2. Save the CSV(s) locally with a clear name (e.g., `Sale_2026-07-05_to_2026-07-11.csv`).
3. Log into CCRS (Step A1) → upload the CSV(s).
4. Check the **Processing Status (PST)** for that filename; resolve any rejected rows and re-upload.
5. Keep a copy of the file and the confirmation. Done for the week.

### Step A6 — Key data rules to get right (verified — the back office enforces these, but know them)
- **Sale rows with QTY > 1:** the Discount and Taxes fields reflect the **entire transaction**;
  **UnitPrice** is the price of **one** unit **before** discount/tax.
- **"Other Tax" = the 37% cannabis excise** on retail sales. Sales tax is separate.
- **Medical (DOH) sales:** mark as **"RecreationalMedical"**; **both sales tax AND excise tax = $0.00.**
  This is a **tax exemption, not a discount.** Only valid when: your store holds the DOH medical
  endorsement, the customer's card is in the **MCAD** database, and the product is **"Medically Compliant."**
- **Returns:** you **DELETE the Sale identifier** from CCRS **and** report the inventory id on an
  **Inventory Adjustment** as a return (with a reason).
- **UnitWeightGrams:** the sellable unit weight **excluding packaging**, never over the consumer carry limit.
- **Infused pre-rolls** are classified as **Concentrates** (affects transaction limits).
- **Manifests:** the ONLY valid manifest is the **PDF that CCRS generates** after you submit a
  **Manifest.CSV**. A POS/printed manifest is **not accepted**, and there is **no contingency manifest**.

---

## PART B — DUAL-RUN & CUTOVER FROM CULTIVERA (safe transition)

Do NOT flip off Cultivera and hope. Cut over deliberately:

1. **Pick a clean week boundary** (a Sunday, so it aligns with the CCRS week).
2. **Parallel run:** for at least 2–4 weeks, generate CCRS CSVs from the back office **and** keep
   Cultivera live. Compare our generated files against what Cultivera would submit. Reconcile any diffs.
   (Only Cultivera actually submits during the parallel period.)
3. **Reconcile the knowledge base:** verify your live inventory in the back office matches CCRS reality
   before you take over submission. Use the menu-import/reconciliation tooling; keep validated data,
   purge test data with the "clean slate" tool (do NOT touch validated records).
4. **Cutover:** on the chosen Sunday, you begin self-submitting the prior week's file; you can then stop
   Cultivera's submission (and its subscription) once you've confirmed a successful, clean upload cycle.
5. **First independent week:** upload, check PST carefully, fix any rejects, confirm, and archive.
6. **Keep the monthly LIQ-1295 going the whole time** — it never pauses.

---

## PART C — (OPTIONAL, LATER) BECOMING A THIRD-PARTY INTEGRATOR

Only if you want to report on behalf of **other** licensees (a Cultivera-style service). Not needed for
your own store.

1. Complete form **LIQ-1455 "CCRS System Access Application."**
2. Email it to **examiner@lcb.wa.gov** with: your integrator/company contact info, a statement of the
   services you'll provide, a **list of the LCB licensee clients** you're contracted with, and a **blank
   copy of your service contract** template.
3. LCB vetting confirms: you're a legally registered business, you have a genuine business need to report
   on behalf of a licensee, and you're actually working with those licensees.
4. After approval, **each licensee must "unlock the door"**: their **active administrator** logs into CCRS
   and assigns your integrator entity to **each** license you'll report for (and can remove you anytime).
5. **Remember:** even as integrator, **the licensee remains responsible** for the accuracy of reported data.
6. There is still **no API** — even integrators upload CSVs through the portal.

---

## QUICK REFERENCE

- CCRS portal: https://cannabisreporting.lcb.wa.gov/
- Future WA.gov login: https://manage.login.wa.gov (transition ~Oct 2026)
- Integrator application email: examiner@lcb.wa.gov (Path B only)
- Weekly cadence: Sun–Sat week, due by the following **Sunday**.
- Monthly: **LIQ-1295** every month even with zero sales; pay by due date.
- No API. No data pull-back (Public Records request). Keep your own copies. Files ≤ 1 GB.
