# Command Center Enhancements — Owner Request Tasklist

> This file records the owner's feature/enhancement list **verbatim, word-for-word**, then translates
> each item into grounded, handoff-ready slices. Standing rules apply: AI/crawler output is drafts-only
> (employee-validated before publish); migrations/seeds applied MANUALLY by owner in Supabase SQL editor
> (idempotent); ground every decision in FACT, never guess; walk the file tree repeatedly; each task is
> its own slice; work methodically. Build **6 slices at a time** until the whole list is built.

---

## Owner's list (verbatim)

- [ ] Sage 50 reporting tab, I want to add an upload feature so I can enrich the ai with validated source docs I get from online resources. This should help the ai help me better.
- [ ] Loyalty program needs enhancing so it can be customizable.
- [ ] Cycle counts needs to be enhanced to be able to use barcode scanners to be more efficient about counting and auditing plus any other feature that hardens and enhances this feature.
- [ ] Schedule builder for employee management.
- [ ] Ach payment portal for vendor payments
- [ ] Samples limits restrictions and insight to remain compliance by going over those limits.
- [ ] Midjourney page with ai that helps build prompts to give midjourney for producing quality images and graphic art.
- [ ] Have an option for employees to clock in and out via their phones. As well as give me the ability to adjust their hours if needed.
- [ ] On site content page, the top page tab header only has some of the pages on my website. Please extended the list to include all pages.
- [ ] Ability to see pending manifests created by my vendors, in transit flag when it’s been set to in transit from the vendor, awaiting intake for when the vendor updates CCRS that the products have exchanged parties.
- [ ] Ability to pay vendors via an ach method. That is smart and only allows payments to approved vendors and that have an approved CCRS manifest to match it to.
- [ ] If possible a method for paying my employees via ach to complement the clock in and out feature. I don’t mind paying a monthly service fee or whatever to make this work.
- [ ] Upload chart of accounts plus any other useful sage 50 bookkeeping things for a better ai experience when helping me fix things or do things more properly.
- [ ] Make sure to seed all the relevant areas of the back office with kb seed data if available or allow me to upload seed data for anything that might need it or would be useful to add.
- [ ] Mobile friendly for all the relevant things I should have access to via my phone.
- [ ] Reorganized the side menu bar into a top of the page tab system with drop down menus for each one with the relevant things included.
- [ ] Enhance media upload page
- [ ] Bake ai into the customer facing website. It should be intelligent and incredibly useful.

---

## Status: GROUNDED — awaiting owner clarifications before slicing

### What the codebase ALREADY has (verified by walking the tree)
- **Sage 50 (item 1, 13):** `/admin/reports/accounting` already HAS an upload feature (`uploadSageReport()` → private `sage-imports` bucket) with report kinds (`cultivera_sales`, `cultivera_inventory`, `pos_summary`, `gl_export`, `trial_balance`, `other`) and a grounded `SageAssistantChat`. Uploads today only extract a light CSV aggregate summary — they are NOT indexed into the KB/RAG store, and there is NO "Chart of Accounts" kind. So items 1+13 = add COA + bookkeeping kinds AND make uploaded docs actually enrich the assistant (indexed retrieval + PDF text extraction).
- **Loyalty (item 2):** migration `0039_loyalty_engine` has `loyalty_config` (points_per_dollar, point_value_minor, min_redeem_points, signup_bonus_points, code_expiry_days), `loyalty_tiers`, `loyalty_promotions`, `loyalty_accounts`, `loyalty_ledger`, `loyalty_redemptions`. `/admin/loyalty` exists. Item 2 = surface a full customizable editor over these.
- **Cycle counts (item 3):** migration `0041_cycle_counts` has `cycle_counts`, `cycle_count_lines`, `ccrs_adjustment_batches`. `/admin/inventory/cycle-counts` exists. Item 3 = barcode-scanner entry + hardening.
- **Staffing / time clock (items 4, 8):** migration `0037_staffing_timeclock` has `employees` (clock_pin, job_role, staff_id), `shifts` (scheduled/open/closed + scheduled_start/end), `time_punches` (work/break, source web|station|manager_edit). `/admin/staffing` + `/admin/staffing/employees` exist. Item 4 = schedule builder over `shifts`; item 8 = phone clock-in + owner hour adjustment over `time_punches`.
- **Samples (item 6):** migration `0042_returns_destruction_samples` has `sample_settings` = PRICING guardrails only (nominal price, block public sale). Item 6 = NEW: WSLCB/WAC sample-transfer QUANTITY limits + tracking + over-limit insight (needs legal research).
- **Manifests (item 10):** `inbound_manifests` has `status` (pending|accepted|rejected) + lifecycle timestamps (`in_transit_at`, `received_at`, `accepted_at`, `rejected_at`, `eta_date`) + `manifest_events` timeline. Item 10 = a pipeline UI surfacing pending → in-transit → awaiting-intake states.
- **Vendors (items 5, 11):** `vendors` table has NO banking/ACH/approval-for-payment fields yet. ACH = new tables + a payment-rails integration.
- **Media (item 17):** `/admin/media` page (200 lines). Enhancement TBD once owner specifies pain points.
- **Nav (item 16):** `admin-nav-data.ts` + `AdminSidebar.tsx` (already has a mobile hamburger). 6 groups. Item 16 = convert left sidebar to top tabs w/ dropdowns.
- **Pages tabs (item 9):** the PAGES nav group lists Home, Menu, Loyalty, Specials, Vendors, FAQ, About, Locations, Price Match. Live customer site ALSO has: Blog, Checkout, Consumer Health Data, Privacy Policy, Terms of Use, Unsubscribe, Vendor Delivery. (Item 9 interpretation to be confirmed with owner.)
- **AI (items 7, 18):** provider is OpenAI-compatible (`gpt-4o-mini` default), no-ops when unconfigured. KB/RAG store exists (`src/lib/ai/kb/{store,retrieval,seed}.ts`). No customer-facing chat widget yet. Item 7 = Midjourney prompt-builder page; item 18 = customer-site AI.

### Owner's answers (verbatim decisions) — locked
- **A (ACH provider):** Research the **best / cheapest / most practical** solution; owner will sign up and paste the info I tell him, where I tell him. Provide **back-office fields** to enter that info. Make it easy, included in the build.
- **B (employee ACH payroll):** **DROPPED.** Owner will do payroll through Sage if desired. (Item 12 = out of scope.)
- **C (item 9):** Yes — if this is the **Site Content page**, add all the necessary pages to complete the list; use best judgement on what makes sense.
- **D (item 6 samples):** **Very important compliance issue.** Deep-research WSLCB rules for samples; bake exact limits into the **Sales Limits page**; **HARD-ENFORCE (hard blocks)**; add helpers, guardrails, and warnings to keep the store in good standing.
- **E (item 7 Midjourney):** Yes — deep-research Midjourney; build a **prompt helper** (we do NOT call Midjourney) for the marketing dept to produce great results. This slice ALSO includes an **overhaul of the media upload page** (easier, more useful, professional in every way). Add **references** to make the prompt builder work better if possible. (So items 7 + 17 are combined.)
- **F (item 18 customer AI):** Yes — an AI helper for customers who describe what they want / want their hand held picking product. Must be an **expert in all things cannabis**, offering top-notch expert recommendations & help, **grounded strictly in owner's real data**. Seed/strengthen it with more data/resources to be super helpful and robust. Include all my recommended ideas.
- **Order:** Any order I find best/most logical. No guessing. Deep-research everything before building. Proceed.

### Revised scope (post-answers)
- Item 12 (employee ACH payroll) = **OUT OF SCOPE** (owner uses Sage).
- Items 7 + 17 = **COMBINED** into one Midjourney-helper + media-overhaul slice group.
- Item 6 = **HARD BLOCKS**, WAC-sourced.
- Items 5 + 11 = ACH vendor payments via a researched, cheap, practical provider + back-office credential fields + approved-vendor + approved-CCRS-manifest matching.

### BANKING FACT (owner-provided, authoritative)
- Owner banks with **Timberland Bank** on a **"Green" account that is cannabis-authorized**.
- Owner **can pay via ACH through Timberland Bank**. Currently pays vendors **by check**.
- IMPLICATION: We do NOT need a third-party cannabis-risk ACH processor (Dwolla/Moov/etc.) — the bank IS the ACH origination rail. The most practical + cheapest path is to have the back office **produce a bank-ready ACH batch (NACHA / bank ACH upload file or a print-ready payment worksheet)** that the owner uploads/keys into Timberland's business online-banking bill-pay / ACH origination. This avoids per-transaction processor fees entirely and stays inside a bank that already accepts I-502.
- ACTION: Confirm Timberland Bank's business online banking ACH origination format before finalizing the file spec (they typically accept **NACHA-formatted (.ach) files** and/or manual ACH entry + CSV import for bill pay). Provide back-office fields for the store's ACH origination profile (company name, company ID / immediate origin, ODFI routing) AND each vendor's banking (routing + account + account type) — stored securely, entry-gated. Every payment must match an **approved vendor** + an **approved CCRS manifest** before it can be included in a batch.
- OUT: real-time API money movement / third-party processor (not needed; bank handles origination).

### Deep research log (grounded in fact; sources cited)

#### R1 — ACH via Timberland Bank (items 5, 11)  [VERIFIED]
- Timberland Bank business ACH is run on **Jack Henry Treasury Management** (`treasury.jackhenry.com/timberlandbank`). Source: timberlandbank.com/banking/business/cash-management + /ach-transactions (scraped 2026-07-01).
- Timberland explicitly supports **ACH origination for vendor payments** ("electronically send funds for payroll, taxes, expense reimbursements, **vendor payments**"). It also offers **Positive Pay / ACH fraud protection** (pre-authorize ACH debits).
- Timberland routing/ABA (public, site footer): **325170754** (used as a sanity reference; the store's real ODFI + Company ID come from its cash-management enrollment).
- **Cheapest/most practical path (chosen):** the back office generates a **standard NACHA-format `.ach` file** (94-char fixed-width) that the owner imports/uploads into Jack Henry Treasury to originate a vendor-payment batch — PLUS a human-readable **CSV payment worksheet** and a **PDF batch summary**. No third-party processor, no per-txn fees.
- **NACHA spec captured (authoritative, treasurysoftware.com):** File is fixed-width ASCII, 94 chars/record, records in multiples of 10 (pad with `9`s). Record types: `1` File Header, `5` Batch Header, `6` Entry Detail, `7` Addenda (optional, type 05 for remittance/invoice), `8` Batch Control, `9` File Control.
  - Batch Header: Service Class `220` (credits only), SEC **`CCD`** (corporate/vendor payments), Company Entry Description e.g. `PAYABLES`, Effective Entry Date `YYMMDD`, Originator Status `1`, Originating DFI = first 8 of store ABA.
  - Entry Detail (`6`): Transaction Code `22` (checking credit) / `32` (savings credit); Receiving DFI (8) + check digit (1) = vendor's 9-digit routing; DFI Account Number (17, left-justified); Amount (10, no decimal, right-justified zero-padded); Individual/Receiving name (22); Trace Number = ODFI(8)+sequence(7).
  - Entry Hash = sum of receiving-DFI 8-digit routing across entries (rightmost 10). Batch/File control totals: entry+addenda count, entry hash, total debit $, total credit $.
  - Numeric fields right-justified zero-padded; alphanumeric left-justified space-padded.
- **Smart guardrails (owner requirement):** a payment may only enter a batch when (a) vendor is **approved for ACH** (owner-verified banking on file), AND (b) it is matched to an **approved/accepted CCRS `inbound_manifest`** (status=accepted). Store the vendor bank details securely, entry-gated; audit every batch.
- **Back-office fields to add (owner will fill):** Store ACH origination profile — Company Name, Company ID (1+EIN), Immediate Origin (ODFI routing 325170754 or as bank instructs), Immediate Destination + bank name, offset account (if bank requires balanced files), default SEC/description. Per-vendor — routing, account #, account type (checking/savings), payee name, ACH-approved toggle.

#### R2 — WSLCB cannabis sample rules (item 6)  [VERIFIED — authoritative]
- **Controlling rule: WAC 314-55-096** "Trade samples, retail display samples, and internal quality control samples." **CURRENT VERSION: WSR 25-08-032, filed 3/26/25, effective 4/26/25** (the big "revamp" that merged the old vendor/educational samples into one "trade sample" concept). Source: app.leg.wa.gov/wac/default.aspx?cite=314-55-096 (scraped 2026-07-01) + Foster Garvey legal alert (04.08.25) + WSLCB CIB 132 Trade Samples & Education Guide.
- **Greenway is a RETAILER.** The rules that bind a retailer:
  - **INCOMING trade samples (processor → this retailer):** a processor may not provide **more than 120 trade sample units** of any combination (useable cannabis / concentrates / infused) **per calendar quarter** to this one retail business. [096(1)(f)(ii)]
  - **OUTGOING to employees:** the retailer **must not provide more than 30 trade sample units to any one employee within a calendar quarter.** [096(1)(j)(vi)]
  - **Sample-jar leftovers** given to a paid employee **count toward that employee's 30-unit quarterly cap.** [096(4)(d)(i)]
  - **Customers:** "**Retailers may not provide free samples to customers.**" [096(2)] — HARD BLOCK.
  - **Recipients:** samples may go ONLY to **current paid employees**; never sold, never given as compensation/incentive/reward. [096(1)(i)]
  - **Per-UNIT size caps** (what counts as "one unit"): a trade sample unit must be representative, **not larger than the smallest unit sold at retail**, and **not exceed**: **3.5 g cannabis; 1 g cannabis concentrate; 100 mg infused product (≤10 mg active delta-9 THC/serving).** [096(1)(e)]
  - **Recordkeeping:** retailer must track all incoming & outgoing sample inventory in state traceability by product type; record each employee sample (product type + employee name). [096(1)(j)(iv)(v)]
  - **Separation & labeling:** keep samples physically separate from resale product, clearly identified; incoming samples labeled "TRADE SAMPLE – NOT FOR RESALE OR DONATION." [096(1)(j)(ii)]
  - **Internal quality control samples** (50 units/employee/qtr; ≤25 concentrate units): **producer/processor ONLY — NOT applicable to a pure retailer.** We will note this but not enforce it for retail.
  - **Calendar quarter** = the limit window for all caps (Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Q4 Oct–Dec).
- **HARD-ENFORCEMENT design (owner: hard blocks):**
  - Model a `sample_units` ledger (incoming from processor; outgoing to employee) with product_type, unit_count, grams/mg, quarter key.
  - BLOCK recording an incoming batch that would push a processor's quarterly total > 120 units to us.
  - BLOCK issuing to an employee that would push that employee's quarter total > 30 units (including sample-jar leftovers).
  - BLOCK any "sample to customer" path entirely (096(2)).
  - Validate per-unit size caps (3.5g / 1g / 100mg & ≤10mg THC/serving) on entry.
  - Insight dashboard: per-quarter usage vs cap per employee + incoming vs 120 cap, with amber warnings approaching the cap and red hard-stops at/over. Audit every sample event. Reference the exact WAC citation in the UI.
- Bake these limits into the **Sales Limits page** (`/admin/compliance/sales-limits`) area as the owner asked, as a new "Samples" compliance module.

#### R3 — Midjourney prompt craft (item 7)  [VERIFIED — official docs]
- Source: docs.midjourney.com Parameter List (current V7 / V8.1 era, scraped 2026-07-01) + Midjourney prompt-structure guidance.
- **Prompt structure that works:** `[subject + description] , [environment/context] , [composition/shot] , [lighting] , [style/medium] , [color/mood] [--parameters]`. Keep it concrete; lead with the subject; comma-separate concept groups; put ALL parameters at the very end.
- **Syntax rules (hard):** parameters go at the END; exactly one space before the `--`; NO punctuation inside parameters; never place prompt text after parameters.
- **Core parameters (current):**
  - `--ar W:H` aspect ratio (e.g. 1:1 square, 2:3 portrait, 3:2 / 16:9 landscape/web hero, 4:5 IG).
  - `--v <n>` model version (or `--niji` for anime/eastern); `--raw` (Raw Mode = more literal, less MJ "beautification"); `--draft` (V7, half GPU cost for iteration); `--hd`/`--sd` (V8.1 resolution).
  - `--stylize / --s 0–1000` (artistic flair; low = literal, high = stylized; default ~100).
  - `--chaos / --c 0–100` (variety across the 4 results); `--weird / --w 0–3000` (quirkiness).
  - `--no <thing>` negative prompt (exclude things); `--tile` seamless patterns; `--seed <n>` reproducibility; `--repeat / --r` batch; `--q` quality.
  - Image inputs: `--sref <url>` style reference (+ `--sw` style weight, `--sv` version), `--oref <url>` Omni Reference (person/object likeness; replaces character-ref in V7), `--iw <0–3>` image weight.
- **Builder design (we do NOT call MJ):** guided fields (subject, product/brand context from OUR real catalog/vendors, medium/style, lighting, mood, composition, palette) → an AI helper (grounded, drafts-only) expands them into a polished MJ prompt string + suggests parameter values + explains WHY. Include curated **style/reference presets** for cannabis-retail marketing (product hero, lifestyle, menu banner, social square, in-store signage). Optionally attach a **reference image** (from the overhauled media library) and emit the correct `--sref`/`--oref` note. One-click copy. Cannabis marketing compliance note (21+, no health claims). This slice ALSO overhauls the **media upload page** (drag-drop, bulk, AI alt-text/caption drafts, tags/search, better UX) since references live there.

---

## FINALIZED ROADMAP — slices (6 at a time), grounded & handoff-ready

**BATCH 1 — foundation & high-value UI (all over EXISTING tables; no external accounts):**
- **Slice 65 — Nav → top tabs w/ dropdowns [item 16]** — convert `AdminSidebar` + `admin-nav-data` into a top tab bar with grouped dropdown menus; keep permission gating + mobile.
- **Slice 66 — Site Content page: all pages [item 9]** — add the missing editable pages (Blog + legal/info: Consumer Health Data, Privacy Policy, Terms of Use, Unsubscribe, Vendor Delivery) to the content hub, grouped sensibly (exclude transactional Checkout).
- **Slice 67 — Loyalty customizer [item 2]** — full editor over `loyalty_config` + `loyalty_tiers` + `loyalty_promotions` (earn rate, point value, min redeem, signup bonus, expiry, tiers, promos) with live preview; audited.
- **Slice 68 — Cycle counts: barcode scanning + hardening [item 3]** — keyboard-wedge/USB & camera barcode capture on `cycle_count_lines`, blind-count mode, variance flags, session locking, audit.
- **Slice 69 — Schedule builder [item 4]** — week grid over `shifts` (create/copy/publish scheduled shifts per employee/role), coverage view.
- **Slice 70 — Phone clock-in + hour adjustments [item 8]** — mobile self clock in/out (PIN over `time_punches`) + owner/manager punch-edit with reason + audit.

**BATCH 2 — AI enrichment, compliance, marketing, seeds, mobile:**
- **Slice 71 — Sample compliance (WAC 314-55-096) [item 6]** — sample ledger + HARD blocks (120/qtr incoming, 30/qtr per employee, per-unit caps, no-customer), insight dashboard, on Sales Limits page.
- **Slice 72 — Midjourney prompt builder + media overhaul [items 7 + 17]** — expert grounded prompt builder w/ presets & references + drag-drop/bulk/AI-alt-text media library.
- **Slice 73 — Sage 50 KB enrichment + Chart of Accounts upload [items 1 + 13]** — add COA + bookkeeping report kinds, extract PDF/CSV text, index uploads into the KB/RAG so the Sage assistant is truly enriched.
- **Slice 74 — Manifest pipeline (pending/in-transit/awaiting-intake) [item 10]** — pipeline board over `inbound_manifests` lifecycle states + events timeline.
- **Slice 75 — KB seed coverage + owner uploads [item 14]** — audit which back-office areas have KB/seed data; add seeds where available; add an upload-your-own-seed path where useful.
- **Slice 76 — Mobile-friendly pass [item 15]** — make the owner's key surfaces (dashboard, orders, clock, manifests, schedule, loyalty) genuinely mobile-usable.

**BATCH 3 — money movement & customer AI:**
- **Slice 77 — Vendor ACH: banking + approval model [items 5/11]** — store ACH origination profile + per-vendor banking (secure, gated); approve-for-ACH; match to accepted CCRS manifest.
- **Slice 78 — Vendor ACH: NACHA batch generation [items 5/11]** — build batches from approved+matched payables → byte-correct NACHA `.ach` (CCD) + CSV worksheet + PDF summary for Timberland/Jack Henry upload; audit.
- **Slice 79 — Customer-facing AI concierge [item 18]** — grounded public chat (menu + strain KB + store info), compliance guardrails (21+, no medical/dosing claims), drafts-safe.
- **Slice 80 — Customer AI knowledge seeding [item 18 cont.]** — strengthen with cannabis-education seed data + store facts so the concierge is robust.
- (Employee ACH payroll — item 12 — intentionally OUT OF SCOPE per owner.)

Total: **16 slices (65–80)** across 3 batches. Build 6 at a time.
