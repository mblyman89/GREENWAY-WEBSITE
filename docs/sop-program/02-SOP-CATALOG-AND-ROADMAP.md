# SOP Program — Catalog of SOPs + Slice Roadmap

Slice SOP-00 · 2026-10-27 · audited at `main@54445a68`
Updated in slice SOP-05b · SOP-05a v1.1 (D36–D43); SOP-05b written (v1.0 draft) · Updated in slice SOP-05a · owner answers D29–D35 applied (SOP-04 v1.1); SOP-05 split into 05a/05b per D35; SOP-05a written (v1.0 draft) (earlier: slice SOP-04, D21–D28, SOP-04 written; slice SOP-03, D14–D20; slice SOP-02, D10–D13; slice SOP-01, D1–D9, SOP-21 SEO added per D6)

Every SOP below is mapped to the **real code** it will be verified against. Code sizes come from a census of the tree (`.ts/.tsx` files and lines) and show how much audit work each slice involves. "Requested" quotes the owner. EXISTS/PARTIAL/MISSING is the recon verdict and is re-verified in depth in the SOP's own slice.

---

## Part 1 — The SOP catalog (21 SOPs)

### SOP-01 · Register Operations: Shift, Till & Cash (the flagship)
**Audience:** every employee (budtender), plus a manager section · **Requested:** clocking in, counting the till, entering the amount, closing the till, what to do with the money, balancing, second-person sign-off, shift-close and day-close reports, the EOD sheet, morning recount → seal bag → safe → bank.
**Code (≈25.6k lines, 70 files):** `src/app/(site)/pos/RegisterShell.tsx`, `SaleFlow.tsx`, `RegisterCartEditor.tsx`, `RegisterInterruptModal.tsx`; `/api/pos/{unlock,till,approve,witness,void,returns,day-report,sync,transactions,reprint,email-receipt,loyalty,member*,stock-flag,interrupts,pickup}`; `src/lib/pos/{till-core,sale-flow-core,day-report-core,void-sale-core,returns-core,price-override-core,cash-rounding-core,change-calc-core,id-scan-core,medical-pos-core,special-discount-sale-core,employee-loan-core,receipt-*}`; `src/lib/registers/*`; `/admin/registers/**`; `src/lib/compliance/sales-limit*`, `sales-hours-*`.
**Covers:** unlock & PIN; handbook gate; clock in/out at the register; count-in (denominations); ringing a sale (scan-required, ID check, sales limits, medical, special discounts, rounding, change); hold/resume; no-sale, price override, void (manager/lead PIN); returns desk; mid-shift drops (witness PIN); safe swaps (approver PIN); blind close + tips; X/Z day report; what to do with the cash; manager reconcile + morning verify; EOD report; offline mode and the exception queue.
**Status:** **WRITTEN** in slice SOP-01 as `docs/sop/SOP-01-register-operations.md` v1.0 (draft for owner review), revised to **v1.1** in slice SOP-04 (reason only over $5.00 per D21; the float stays in the drawer, fixing F-03-4). Per D9 it covers every kind of sale, every discount, every block and warning, and how to read the register and checkout screens. 16 findings (F-01-1…F-01-16), gaps G-01…G-05 in `05-GAP-REGISTER.md`.
**SOP-01 audit verdict:** count-in, drop, swap, blind close, reconcile, verify, X/Z report, offline queue **EXIST**. Expected close shows $0.00 on the reconcile screen (F-01-3). Cash sales are hand-typed (F-01-4, S1). Second count at close **MISSING** (F-01-9, D2). Swap denominations **MISSING** (F-01-8, D3). $5 warnings screen **MISSING** (F-01-11, D7). Medical test mode can record a tax-removed sale with no exemption record (F-01-14, S1).
**Recon verdict (SOP-00, kept for history):** count-in, drop, swap, blind close, reconcile and the EOD print **EXIST**. Second-person close sign-off is **MISSING** (F-00-5). Morning recount is **BROKEN/PARTIAL** (F-00-3, F-00-4). Bag seal → safe → bank is **MISSING** in the UI (F-00-6). Report export is **MISSING** (print only, F-00-8).

### SOP-02 · Master Till / Store Safe Routine
**Audience:** opening + closing employees, manager · **Requested:** count twice a day (AM/PM); balance using small bills from the little safe in exchange for big bills from the master; exportable and printable.
**Code:** `/admin/registers/safe` (`page.tsx`, `actions.ts`), `src/lib/registers/safe-core.ts` (`SAFE_TARGET_MINOR=$1,000`, windows am/pm/other, open (non-blind) counts), `safe-store.ts`, migration `0135_safe_counts_swaps.sql`, `src/lib/accounting/safe-bag-core.ts`, `register-cash-journal-core.ts` (swap = no accounting effect).
**Status:** **WRITTEN** in slice SOP-02 as `docs/sop/SOP-02-master-till-safe.md` v1.0 (draft for owner review), revised to **v1.1** in slice SOP-03 with D14–D19 and to **v1.2** in slice SOP-04 with D21–D22 (swaps are till ↔ master till, anyone records the master count, $5 rule covers the master till, supply-run screen approved, Manager Till $300). Owner facts D10–D13 applied: three tills at $167.50, the $1,000 master till mix, the counts page, everything pinned. 13 findings (F-02-1…F-02-13), gaps G-08…G-12 (G-02/G-03 updated) in `05-GAP-REGISTER.md`.
**SOP-02 audit verdict:** the AM/PM counts page **EXISTS** (D12 met; `/admin/registers/safe`). The $1,000 target **MATCHES** D11. Denomination mix is stored but never compared to a standard (F-02-3). The Manager Till float is $300 in the system. That was first recorded as a mismatch (F-02-2), then **withdrawn**: the owner confirmed $300 (D19). Drops are never posted to the books (F-02-1, **S1**). Counted-by is optional, with no PIN (F-02-4). Several AM/PM counts are allowed a day (F-02-5). No variance threshold or reason (F-02-6). Little safe is **MISSING** (F-00-7, D3 → G-02). Print/export is **MISSING** (F-00-8 → G-09). Supply runs are **UNREACHABLE** (F-02-11).
**Recon verdict (SOP-00, kept for history):** twice-daily counts **EXIST**. Register↔safe swaps **EXIST**. The "little safe" store is **MISSING** (F-00-7). Print/export **MISSING** (F-00-8).

### SOP-03 · End-of-Day Close & Deposit Bag (night count → morning verify → seal → safe → bank)
**Audience:** closing + opening leads, manager, owner · **Requested:** "end of day spreadsheet that one person completes before close, and the morning employee recounts and verifies…"
**Code:** `/admin/registers/eod` (`page.tsx`, `UndepositedFunds.tsx`, `RegisterCashSpecimen.tsx`), `src/lib/registers/eod-core.ts`, `eod-store.ts`, `deposit_bags` (migration 0212), `safe-bag-core.ts` (bag states available→undeclared→counted→deposited; register cannot close with an undeclared bag), `docs/CASH_DEPOSIT_POLICY_DECISION.md`, `MICHAEL-books-96/98`, the structuring-mirror check.
**Status:** **WRITTEN** in slice SOP-03 as `docs/sop/SOP-03-eod-close-deposit.md` v1.0 (draft for owner review), revised to **v1.1** in slice SOP-04 with owner answers D21–D27 (unsealed overnight, no second night count, anyone seals, owner-only banking, tamper-evident pre-numbered bags, undeclared bag = warning only). Paper procedure: night sheet (form 8.1 A/B/C), bag log (8.2), night/morning/manager/bank-run checklists (8.3–8.6), the $10,000 line. 11 findings (F-03-1…F-03-11), gaps G-14 and G-15 (G-04 updated), open questions Q-03-1…Q-03-7.
**SOP-03 audit verdict:** the EOD report **EXISTS** (print only, one signature, no deposit figure, F-03-5; no refunds, F-03-6; no date picker, F-03-8; silent read failures, F-03-7). Morning recount, seal, bag log and bank run are **MISSING** in the UI (F-00-6 re-confirmed; G-04). The books cash-to-bank chain is **BROKEN**: nothing fills 10400 since D-77, so the Undeposited Funds panel shows a false all-clear (F-03-1, **S1**). Bank-deposit clearing has **no caller**, yet the census says it is reachable (F-03-3, **S1**). The bag lifecycle and $10k shape check are built but **UNREACHABLE** (F-03-10). Help/concierge have **no** EOD/deposit content (F-03-11).
**Recon verdict (SOP-00, kept for history):** EOD report (print) **EXISTS**. Bag lifecycle is core-only, **UNREACHABLE** (F-00-6). Written separately from SOP-01 because it crosses two shifts and two people, and it is the control the owner relies on most.

### SOP-04 · Receiving Intake Pipeline (truck day)
**Audience:** receiving staff, manager · **Requested:** "a sop for the receiving intake pipeline."
**Code (≈19.6k lines core + inventory):** `/admin/inventory/intake`, `/intake/[id]`, `/intake/[id]/match`, `/admin/inventory/drafts`, `/inventory/batch-lookups`, `src/lib/inventory/intake-*`, `brand-resolve-core.ts`, `src/lib/inbound-email/*` (forwarded manifests, .eml explode), quarantine, COA capture, samples cap; `docs/RECEIVING-IS-THE-REAL-PIPELINE.md`, `INTAKE_PIPELINE_*`. **Rule 11: the one way products enter Greenway.** This slice gets the deepest audit.
**Status:** **WRITTEN** in slice SOP-04 as `docs/sop/SOP-04-receiving-intake.md` v1.0 (draft for owner review), revised to **v1.1** in slice SOP-05a with owner answers D29–D34 (partial receive approved as a serious fix, managers only process manifests, second count strongly suggested and expected on a first delivery from a vendor, admin files the PRR on the 10th with the built-in wording and one zip per month, 18-month dataset retention, typed delete confirmation). Part 1 is truck day (§4.1–4.24): morning list check, email and manual import, count every line, per-line and whole-manifest refusal, interim short-count rule, samples, vendor ids, COAs, one-button Finalize, held lots, labels, onboarding. Part 2 is the **monthly CCRS public records request** (§4.25–4.34, owner decision D28): file with the WSLCB, track, store the zip untouched, update competitors, drop the zip, check and use the benchmarks. Forms 8.1–8.5 (truck-day sheet, dock refusal log, vendor follow-up log, monthly PRR log, manager Finalize checklist). 21 findings (F-04-1…F-04-20 + F-04-C), gaps G-16…G-19, open questions Q-04-1…Q-04-6.
**SOP-04 audit verdict: MET with gaps.** Truck day works end to end: email → staged draft → count → refusal → one-button Finalize → go-live gate → books → onboarding. The monthly zip transformer works and feeds Statewide Benchmarks, Reports → Benchmarks and the Local benchmarks section. Gaps: the lot page's Lifecycle status sets Active with no go-live check and no audit (F-04-2, **S1**; G-19). No partial-quantity receive (F-04-1; G-16). Failed vendor emails are invisible (F-04-4; G-17). Dataset Delete has no confirmation (F-04-16). No PRR reminder/log (F-04-19; G-18). There is no Discovery off control (F-04-20). The in-app SOP sheets and help are stale (F-04-5, F-04-13, F-04-14). The concierge has no receiving or PRR content (F-04-C).
**Recon verdict (SOP-00, kept for history):** EXISTS. The existing `sop-core.ts` truck-day + "receive/onboard/publish" sheets get re-audited and absorbed. (SOP-04 found them pre-R31 and stale, F-04-5. SOP-04 replaces them; they are not absorbed.)

### SOP-05 · Inventory Management (daily)
**Audience:** manager, inventory lead · **Requested:** "sop for inventory management."
**Code (≈116k lines across `src/lib/inventory`, the largest domain):** `/admin/inventory`, `/inventory/[id]`, lots + labels, tags, expiration rules, labs/COAs, non-cannabis, merch inventory, recall holds (`recall-hold-*`), held stock, low stock, stock flags from the register, publish menu, Types & Categories, sales-limit classification.

**Split (owner decision D35, "I want you to break this one up into two slices"):** the boundary was drawn from the code in slice SOP-05a. SOP-05a is the cannabis lot itself, from the moment receiving makes it live until it is sold out, held or sent to SOP-15. SOP-05b is everything that is not a cannabis lot, plus the menu and the classification that sit on top of lots.

#### SOP-05a · Inventory Core: lots, holds, labels, labs, expiry (daily)
**Code:** `/admin/inventory` (`page.tsx` 1,297 lines, `actions.ts` 1,260), `/admin/inventory/[id]` (lot page, 1,560 lines: lifecycle status, edit, carry-over F-04-2 / G-19), `/admin/inventory/lots/[id]/label`, `/admin/inventory/tags`, `/admin/inventory/labs` (`testing-labs-*`, `coa-*`), `/admin/inventory/expiration-rules` (`expiry-rules-*`), recall holds (`src/lib/pos/recall-hold-*`), restore to sale (`restore-to-sale-*`), register sellability (`register-sellability-store.ts`), oversold report (`oversold-report-*`), low stock (`src/lib/pos/low-stock-core.ts`), register stock flags (`/api/pos/stock-flag`, `stock-flag-core.ts`).

**Status:** **WRITTEN** in slice SOP-05a as `docs/sop/SOP-05a-inventory-core.md` v1.0 (draft for owner review). Covers the lot from go-live to sold out: reading the Inventory list and lot page, lifecycle status and recall holds, manual adjustments, restore to sale, the register 86, expiry dates and expiration rules, labels, tags, testing labs and COAs, bulk fill, the Issues tab, and a written recall plan (WAC 314-55-225). Forms 8.1–8.5 (status/recall log, adjustment log, daily Issues check, recall plan, recall event worksheet). 17 findings (F-05a-1…F-05a-16 + F-05a-C), gaps G-22…G-26 (G-19 extended), open questions Q-05a-1…Q-05a-5.
**SOP-05a audit verdict: MET with serious gaps.** The daily lot work runs end to end and every rule is enforceable on paper today. Gaps: setting **Destroyed** by hand leaves units on file and drops the lot from the CCRS Inventory file (F-05a-1, **S1**; G-22). A recall hold is placed and released with no audit, no reason and no role limit (F-05a-2, **S1**; G-22). Manual adjustments are not atomic, can go negative and offer Receive / Destruction / Recall removal reasons that bypass CCRS and SOP-15 (F-05a-3…F-05a-7; G-23). Nothing stops the register selling an expired lot (F-05a-8; G-24, waits on Q-05a-1). There is no recall plan or log in the app, and a recall hold does not reach the website or online orders (F-05a-15, F-05a-16; G-25). The concierge has no recall or expiry content (F-05a-C).

#### SOP-05b · Non-Cannabis, Merch, Menu Publishing & Classification
**Code:** `/admin/inventory/noncannabis` (+ `[id]/label`, ≈2k lines), `/admin/inventory/merch` (Greenway Merchandising LLC, never on the cannabis POS), `/admin/publish` (`menu.import`; `src/lib/pos/publish-*`), `/admin/settings/types` (Types & Categories, `settings.manage`), `/admin/compliance/classification` (sales-limit worklist, `classification-status-*`).

**Status:** **WRITTEN** in slice SOP-05b as `docs/sop/SOP-05b-noncannabis-menu-classification.md` v1.0, **revised to v1.1** in the fix slice (owner answers D45–D49: G-29 widened, G-30 / G-30A / G-31 / G-32 APPROVED; new findings F-05b-14, F-05b-15; Q-05b-6 open). SOP-05a revised to **v1.2** (D44: RSO, tincture and capsule in the expiry hard block; F-05a-20). Draft for owner review. Covers Other Inventory (drafts, SKU labels, Keypad selling, adjustments, Monday reconciliation, vendor paper invoices, cost fill, settings, price change, archive), Merch Inventory (hide, put back, remove, copy Printful stock), Publish Menu (the Waiting-for-you queue, the removal check, the 86 explained), Types & Categories (Move products, the cannabis line), re-filing one lot, the sales-limit classification worklist (WAC 314-55-095) and the cannabis sell price (floor RCW 69.50.357 / WAC 314-55-155). Forms 8.1–8.4. 14 findings (F-05b-1…F-05b-13 + F-05b-C), gaps G-29…G-32, open questions Q-05b-1…Q-05b-5.
**SOP-05b audit verdict: PARTLY MET, with two S1 gaps.** Publish Menu, merch, classification and the price floor are careful and audited. **Other Inventory is not connected to the register**: its SKU and UPC don't scan and sales don't lower On hand (F-05b-1, **S1**; G-29). **A category change can turn cannabis into non-cannabis** for tax (no 37% excise), limits and scan (F-05b-9, **S1**; G-31). There is no way to edit a non-cannabis price (F-05b-6; G-30). The rest is a hardening bundle (G-32), including the publish removal check failing open (F-05b-10) and no floor on a cost-unknown price (F-05b-12).

**Not in SOP-05 (stays where the roadmap puts it):** `/inventory/intake/**`, `/inventory/drafts`, `/inventory/batch-lookups` (SOP-04 / SOP-10), `/inventory/audits/**`, `/inventory/cycle-counts/**` (SOP-06), `/inventory/disposition` (SOP-15).

### SOP-06 · Cycle Counts & Inventory Audits + Daily Task Checklists
**Audience:** all floor staff (counting), owner (create/approve) · **Requested:** "Checklists for daily tasks like cycle counts I initiate via the inventory audit feature."
**Code (≈13.5k lines):** `/admin/inventory/audits/**` (owner: `inventory.audit`), `/admin/inventory/cycle-counts/**` (staff: `inventory.count`, a blind sheet with no cost/variance), export route, migrations 0191/0192. Owner decisions books-23 (verbatim in `roles.ts`).
**Recon verdict:** audits + blind counts **EXIST**. A daily-task checklist **MISSING** (F-00-9).
**WRITTEN (slice SOP-06, v1.0, verified at `c976c7e4`):** `docs/sop/SOP-06-cycle-counts-audits-daily-checklists.md`. Audience per owner D50–D51: Inventory Audits **owner only**; Cycle Counts and daily checklists **every employee** (admin, manager, budtender). **Verdict after audit:** the planner, blind sheet, review, approval and posting exist, but **no screen pushes an audit to Cycle Counts** (F-06-1, S1), sales between creation and count are subtracted twice (F-06-7, S1), re-scans become second counts (F-06-5b) and a disagreeing second count does not block (F-06-13, S1). Paper interim and paper daily checklists shipped. 16 findings, gaps G-33…G-39, questions Q-06-1…Q-06-8.

### SOP-07 · Store Cleaning & Facility Schedule
**Audience:** all staff · **Requested:** "cleaning schedules, including dusting products and such."
**Code:** none (F-00-9). Written as a **paper-first SOP** (daily/weekly/monthly matrices with initials columns, display-product dusting, glass cases, counters, scales, restrooms, vault/safe area, CCRS-relevant waste handling pointer to SOP-15). The app build is a Phase C decision. Grounded in WA requirements where they exist (WAC 314-55 security/facility rules). I will not invent regulatory claims.

### SOP-08 · New Hire Onboarding & System Access (and offboarding)
**Audience:** manager/admin/owner · **Requested:** "new hires and setting them up with access to the system."
**Code (≈13.3k lines):** `/admin/staffing/employees/**` (onboarding/offboarding checklists in `employee-lifecycle-core.ts`: I-9, W-4, DSHS, handbook, PIN, badge, schedule, payroll, direct deposit), e-sign, `/admin/users` (invite, role, deactivate; `roles.ts` permission matrix), `/admin/staffing` time clock, PIN hashing (`security/pin-hash`), PIN throttle, handbook-ack gate (back office + register), WebAuthn/security settings, `job_role` sales/lead/manager vs `StaffRole`.
**Note:** two identity systems (employee PIN record vs staff login) must be explained clearly. This slice audits how they link.
**WRITTEN (slice SOP-08, v1.0, verified at `bad718b4`):** `docs/sop/SOP-08-onboarding-system-access-offboarding.md`. Owner request (D69): *"new hire onboarding, system management and off boarding employees."* 11 findings (F-08-1…F-08-10 + F-08-C; one S1: new hires are created Active, so the Activate gate never runs), gaps G-52…G-58, questions Q-08-1…Q-08-5. Paper forms 8.1–8.6 (onboarding sign-off, badge register, offboarding record, role-change log, visitor log, quarterly access review).

### SOP-09 · Purchasing & Purchase Orders (incl. vendor menus: Cultivera / GrowFlow / LeafLink / emailed)
**Audience:** purchase manager · **Requested:** "purchase orders and how to fetch the menu from Cultivera marketplace and growflow marketplace."
**Code (≈20.8k lines):** `/admin/purchasing/**`, `/purchasing/menus/**` (`cultivera`, `growflow`, `leaflink`, `email`), `src/lib/purchasing/*` (po-core, po-builder, po-document, po-review-ai, unified-search), crawler worker (`crawler/app/*_auth.py`, `*_api.py`), `/admin/vendor-payments` (AP, drafts-only NACHA), `/admin/discovery`.
**Owner answer D4:** *"The po builder using the crawler will continue to be allowed going forward and should have a proper sop explaining how to use it, and save the data we get from it."* SOP-09 therefore includes a full **crawler PO builder** procedure, and the slice audits whether fetched menu data is saved (gap G-07). The "ONE-TIME IMPORT ONLY" banner (F-00-15) is a doc fix for Phase C.

### SOP-10 · Product Enrichment & Mastering + Vendor/Brand Enrichment
**Audience:** content/inventory staff · **Requested:** "product enrichment and how to do it, as well as vendor enrichment."
**Code (≈23k + 7k lines):** `/admin/products`, `/products/[key]`, `/products/bulk-ai`, `/products/masters/**`, `/admin/inventory/batch-lookups`, `src/lib/enrichment/*`, `src/lib/ai/*` (Gemini batch, grounding, accept-gate: **drafts-only, rule 3**), `/admin/knowledge-base/**`, `/admin/vendors/**` (import, merge), `src/lib/vendors/*`.

### SOP-11 · Creative Studio, Merch Studio & Marketing Content
**Audience:** content editor, manager · **Requested:** "utilize the creative studio to create banners, ads and marketing content, graphics for garments."
**Code (≈18.3k lines):** `/admin/marketing`, `/admin/marketing/midjourney` (Creative Studio), `/admin/merch-studio` (garment graphics, proofs, ads), `/admin/merch-site/*`, `src/lib/marketing/*` (campaign-rules-core: WA advertising compliance, creative placements), `src/lib/merch-studio/*`, banner studio, `/admin/helpers`, WAC 314-55-155 advertising rules (already in `compliance-general`).

**WRITTEN, merch half (slice SOP-11, v1.0, verified at `d766e4a8`, D231):** `docs/sop/SOP-11-merch-studio-merch-inventory.md`. It covers the Merch Studio (6 tabs), Merch Inventory, merch orders, Reports → Merch, the Website → Merchandise editors, the `merch-site/` shop, and the owner setup of Printful, Stripe, Resend and Vercel. 18 findings (F-11-1 S1: the catalog feed redirect drops the token), gaps G-76 … G-93, and plan M-1 … M-8 (PROPOSED). The Creative Studio (`/admin/marketing/**`) follows as SOP-11 v2.0.

**v1.1 (D232, #1754):** owner answers Q-11-1 … Q-11-9 recorded; the roadmap is approved; slice **M-1** built (www feed, redirect reported, `merch.publish` owner/admin, stale copy).

**v1.2 (D232, #1755):** slice **M-2** built. Merch Health `/admin/merch-studio/health` (H-1 … H-19, Run check now, token expiry, history, morning check with change emails) and the shop `/api/health` behind its own `MERCH_HEALTH_TOKEN`.

**v1.3 (D232, #1756):** slice **M-3a** built. Setup & Launch coach `/admin/merch-studio/launch` (13 cards, proven by Merch Health), "Setup needs you" in the Studio header, printable form 8.1.

**v1.4 (D232, #1757):** slice **M-3b** built. Product journey stepper (nine pills + Next step) and per-tab coaching strips in Merch Studio.

**v1.5 (D232, #1758):** slice **M-5** built. Re-publish keeps Hidden and the stock copy; catalog compare-and-set with the "Someone else changed the catalog" message; old print files deleted after a re-publish.

**v1.6 (D232, #1759):** slice **M-4** built. Designs and art saved on the server (`merch_designs`, migration 0360), any computer, no silent overwrite, **Import design (.json/.zip)**; the sample gate: approval on the server with a photo, Publish blocked until approved for that exact print, owner-only override with a typed reason, audited.

**v1.7 (D232, #1760):** slice **M-6** built. Merch Health registers the Printful webhook (reads first, probes Token C, all 5 events, audited); stock copied automatically every 6 hours and on Printful's `stock_updated` notice.

**v1.8 (D232, #1761):** slice **M-7** built. Held-card monitor (H-15 lists them; day-3 and day-5 emails); merch alerts inbox (`merch_alerts`, 0361) with Acknowledge on Orders and Merch Health; the order page's Stripe half with guidance and the owner/admin Refund / Release button (`merch.refund`, `MERCH_PAYMENTS_TOKEN`); the auto-confirm switch on H-19, built and left off (owner only, reason, 20+ clean orders).

**v1.9 (D232, #1762):** slice **M-8** built. Pricing guard (no fixed $35; Printful STANDARD shipping vs the flat price, gap shown; 35% minimum margin warning; suggested price with Use it); helpers for Merch Inventory and Reports → Merch; Printful, Stripe and Resend guides; merch concierge topic; the 8 studio-default placements labelled as estimates with a Printful print-file compare.

**v2.0 (D233, #1763):** the **second half**, written as `docs/sop/SOP-11b-creative-studio-banner-studio-scheduling.md` (recon, audit and roadmap only, verified at `c384a5e6`). Creative Studio, Branding, the Banner Design Studio and scheduling; why overlays move on the website (six causes with numbers) and the interim procedure; 14 findings F-11-19 … F-11-32 + F-11-C2; gaps G-94 … G-107; Phase C (C-1 … C-8) PROPOSED; Q-11-10 … Q-11-18.

**v2.1 (D234, #1764):** Phase C **approved** (Q-11-10 … Q-11-18 answered). Slice **C-1** built: the studio reads the website's Heading/Body fonts and draws each text box with the website's tag (h2/p/span); a Checks warning for text in System default (G-94, G-95).

**v2.2 (D234, #1765):** slice **C-2** built: a Banner width slider with the site's real widths (same sizing math), and **Check on the real page** (Website Sync at that page and size, Move mode on) (G-97, G-98).

**v2.3 (D234, #1766):** slice **C-3** built: Scale mode (text and buttons grow and shrink with the banner; separate Phone layout; 12 px floor + warning). New banners start in Scale; existing banners switch by choice with a before/after. The Shop banner is capped at 1408 px (G-96, G-100).

**v2.4 (D234, #1767):** slice **C-4** built: drift guard (a test renders the real studio and the real website banner at every width stop and requires them to agree within 1% of the width) and Checks at every width, phone included (`AT_WIDTHS`) (G-99).

**v2.5 (D234, #1768):** slice **C-5** built: picture shape advice that fits each banner at every width (and the placement upload hints follow the design), a safe-area overlay on the focus picture, and a crop-edge hint (G-101).
**v2.8 (D234, #1771):** slice **C-8** built: Creative Studio → **Use in a banner** and **Make a picture for this banner** at the banner's real size (G-104), and the advertising check: banned words in banner words and AI prompts (warn only) plus the required tick "I checked the picture for minors appeal" before Publish and before scheduling a banner to go live (G-105, Q-11-14). Phase C (C-1 … C-8) is complete.

**v2.7 (D234, #1770):** slice **C-7** built: one schedule everywhere (repeat days and hours plus fallback for Shop banner slides and type cards, now applied on the public Shop page; calendars on Shop Banner, Type cards and Schedule & Releases; Loyalty and Specials banners grouped in the schedule picker; G-102) and **Preview as of** a date and time on Schedule & Releases (G-103).
**v2.6 (D234, #1769):** slice **C-6** built: help inside the studio (tooltips, the ? key sheet, a 60-second first-use tour, the "Make a banner" step strip, empty states, the `banner-studio` helper and three concierge topics; G-106) and a proper name dialog for Save to brand (G-107).

### SOP-12 · Digital Assets (Mktg & Adv menu): use, clean up, keep organized
**Audience:** content editor · **Requested:** "how to use digital content." **Owner answer D5:** it is *"the digital assets page in the mktg & adv dropdown menu"*. The SOP covers how to use it, clean it up and keep it organized (`/admin/media`, nav label "Digital Assets", group MKTG & ADV, permission `media.manage`). SEO moved to its own SOP-21 (D6). **Original assumption (superseded):** I read this as the **Digital Assets** media library (renamed from Media Library in R69) plus the website content tools that use it (shop banner, carousel, content schedule/releases, SEO, store listing). If you meant in-store screens/menu boards: **no such feature exists in the code** (verified: no signage/menu-board module).
**Code (≈28.7k lines):** `/admin/media/**`, `src/lib/media/*` (upload policy, folders, optimize), `/admin/content/*`, `src/lib/cms/*`, the content-schedule cron.

### SOP-13 · Online Orders (website pickup + Leafly orders + merch orders)
**Audience:** all staff · **Requested:** "online orders and how to manage them."
**Code (≈20.2k lines):** `/admin/orders/**` (ticket, leafly, merch), `src/lib/orders/*`, register pickup flow (`/api/pos/pickup`, `pickup-*-core`, order-to-cart), announcer (`src/lib/announcer/*`, `pi-agent/greenway_announcer.py`), Leafly 15-minute ack window, cancel approval (manager/lead).

### SOP-14 · Leafly Integration
**Audience:** manager/owner · **Requested:** "Sop for Leafly integration."
**Code (≈79k lines, second largest):** `/admin/integrations/leafly/**`, `src/lib/leafly/*`, crons `leafly-ack-sweep` (2 min) and `leafly-menu-sync` (15 min), evidence export, `docs/leafly-*`, `MICHAEL-leafly-*` memos, `tests/compliance/leafly-certification.test.ts`.

### SOP-15 · Returns to Vendor & Product Destruction
**Audience:** manager · **Requested:** "transferring product back to the vendor, sop for destroying products." (Customer returns are covered in SOP-01.)
**Code:** `/admin/inventory/disposition` (return-to-vendor, scheduled destruction with hold timer + quarantine, CCRS "Destruction" adjustment, sale-correction export), `docs/RETURNS_DESTRUCTION_COMPLIANCE.md`, WAC 314-55-097, CCRS adjustment/transfer files (CCRS bible required reading).
**WRITTEN (slice SOP-15, v1.0, verified at `b8101abb`):** `docs/sop/SOP-15-returns-vendor-destruction.md`. Covers customer-return disposition (quarantine bin → Destroy / Restock / Return to vendor), vendor returns, scheduled destruction with the 72-hour hold, recall coordination and cancel/status restore, per owner D62 ("We will rarely use these features, but they are necessary for our industry so we must have them and do them properly and accurately."). **Verdict after audit:** the disposition screens exist, but a vendor return reduces on-hand when logged, before any manifest (F-15-1, S1), and a Destroy return is put into an Active, sellable lot (F-15-6, S1). 18 findings (F-15-1…F-15-17, F-15-C); gaps G-42…G-49 proposed, G-28 extended; open questions Q-15-1…Q-15-6. Paper interim: forms 8.1–8.6.

**v1.1 (slice SOP-08, owner answers D63–D68):** vendor returns follow the state's CCRS manifest method (Greenway files Manifest.CSV as origin; logged at departure); anyone may witness, always on camera; recalls are returned to the vendor, never destroyed by us; the back-office wizard is to be removed; the hold is set to 0 h (no legal hold); samples audited end to end: everything matches the owner's rules except the register and menu exclusion (F-15-20 **S1**, G-51); the legacy Sample-pricing panel is dead and approved for removal (G-47). New findings F-15-18…F-15-21; gaps G-42, G-43, G-45, G-47 APPROVED; new G-50, G-51.

### SOP-16 · CCRS Reporting & Uploads
**Audience:** owner/manager · **Requested:** "Sop for CCRS uploads."
**Code (≈38k lines):** `/admin/compliance/ccrs` (+ records, file), `/compliance/health`, `/compliance/regulatory`, `src/lib/compliance/ccrs-*`. **Mandatory:** read `docs/ccrs-bible/00,01,05,04,09` first. Every CCRS statement in the SOP is pinned `[G L####]`, per the binding CCRS rules.

### SOP-17 · Hardware: Connect, Pair & Reconnect
**Audience:** manager, any staff for basic reconnects · **Requested:** "connecting and reconnecting hardware."
**Code (≈15.2k lines):** `/admin/registers/devices` (iPad pairing, device keys, heartbeat), `/admin/equipment/**` (printers, printer assistant), `src/lib/printing/*`, Star printer (`star-printer*`, CloudPRNT `/api/cloudprnt`), Socket scanner (`socket-scanner`, `scanner-setup-core`, wedge scan), announcer speakers (pairing codes), `pi-agent/` installers, iOS app (`capacitor.config.ts`, `register:build:ios`).

### SOP-18 · Opening & Closing the Store (daily checklist)
**Audience:** opening/closing leads · **Not listed verbatim. Added under** *"Include anything else you think a professional enterprise grade system would add."* It ties SOP-01/02/03/07/13/17 into a single ordered checklist (lights/alarm → hardware check → safe AM count → till count-in → online-order queue → … → close). It is mostly a composition of other SOPs, so it is cheap to write.

### SOP-19 · Customers, Loyalty, Medical Patients & ID / Sales-Limit Compliance at the Counter
**Audience:** all staff · **Added (enterprise recommendation).** Every sale depends on it: age/ID verification, sales limits (3× for carded patients, WAC 314-55-095), medical card validation via the MCR (no API), excise/sales-tax exemptions, loyalty signup consent, employee purchase program (witness PIN, 35%), employee tabs, samples. Grounded in `docs/medical-doh-requirements.md`, `LOYALTY_COMPLIANCE.md`. It could be folded into SOP-01, but SOP-01 is already the largest document, so it is kept separate and cross-linked.

### SOP-20 · Incident, Security & Emergency Procedures
**Audience:** all staff · **Added (enterprise recommendation).** Covers cash discrepancy over threshold, suspected theft, robbery, power or internet outage (register offline mode), system down, recall notice (recall-hold), LCB inspection visit, who to call. Built only from what the system and existing docs support. Anything policy-only is marked as **owner to confirm**.

### SOP-21 · SEO (search engine optimization)
**Audience:** content editor, manager · **Requested (D6):** *"we should add an seo sop"*.
**Code (≈1.9k lines, recon only, mapped in full in its slice):** `/admin/content/seo` (`page.tsx`), `src/components/admin/SeoEntryEditor.tsx`, `src/lib/seo/*` (`seo.ts`, `seo-override-core.ts`, `seo-entries-server.ts`, `store-hours-*`), `src/lib/cms/ai-seo.ts`, `src/lib/enrichment/seo-draft-core.ts` (AI drafts, **drafts-only, rule 3**), `src/components/seo/JsonLd.tsx`, `src/app/sitemap.ts`, `src/app/robots.ts`, per-page metadata on public pages.
**Recon verdict:** SEO editor + overrides + structured data **EXIST**. Verified in its slice. Advertising wording must still follow WAC 314-55-155 (see SOP-11).

### SOP-22 · The Sunday Newsletter, the Blog, Culture Posts and AI Marketing Content
**Audience:** owner, admin, managers, content editors · **Requested (D236):** *"I want to now work on the newsletter, blog, culture, and other misc marketing and advertising. I want extensive ai help building marketing and advertising content. We will send a newsletter out every Sunday."*
**Code (recon, verified at `main@a4ccd7cb`):** `/admin/blog` (`src/app/admin/blog/*`, `src/lib/cms/blog-store.ts`, `ai-blog.ts`, `ai-blog-ideas.ts`), `/admin/newsletter` Send Center (`src/app/admin/newsletter/*`, `src/lib/cms/newsletter-send-store.ts`), the marketing hub (`src/lib/marketing/*`), Regulatory Watch (`src/lib/regulatory/regulatory-ingest.ts`), the AI provider (`src/lib/ai/provider.ts`), the public blog (`src/app/(site)/blog/*`).
**v1.0 (D236, #1773):** recon, audit and roadmap only, written as `docs/sop/SOP-22-newsletter-blog-culture-marketing.md`. Weekly rhythm (Monday brief → Sunday broadcast), six blog post types, culture and the medical-claims rule, WAC 314-55-155 / CAN-SPAM / Gmail-Yahoo / Google-reviews rules, forms 8.1 and 8.2; 20 findings F-22-1 … F-22-20 + F-22-C (2×S1: F-22-1 the email lacks the four warnings, F-22-14 medical claims); gaps G-108 … G-120; Phase N (N-1 … N-10) PROPOSED; Q-22-1 … Q-22-9. No code changed.

**v1.1 (D237, #1774):** owner approved Phase N (culture posts = the CULTURE card on `/blog`). N-1 send hardening built: four warnings in every email, one-click unsubscribe, PDF kept on save, bounce/complaint suppression, owner/admin-only broadcast.

**v1.2 (D237, #1775):** N-2 reliable sending built: per-address queue `newsletter_send_recipients` (migration 0362), Resend batch endpoint 100 per call with an `Idempotency-Key`, resumed by the 5-minute content-schedule cron, progress bar and Retry failed (G-112, F-22-3). Owner step: apply 0362.

**v1.3 (D237, #1776):** N-3 scheduling + Sunday cadence built: blog posts schedule through the 5-minute content-schedule cron; Ready for approval → Approve and schedule (owner/admin) → sends by itself; editing voids the approval; Friday reminder when nothing is ready (G-113, F-22-5, F-22-9). Owner steps: apply 0363, set the Sunday send time (Q-22-4).

**v1.4 (D237, #1777):** N-4 "This week at Greenway" facts feed built: a card on Blog & Newsletter with last week's new vendors and fresh drops, deals running and coming (below-cost flagged and kept from the AI), vendor days, and holidays, 4/20, 7/10 and local events (G-114, F-22-11). No migration; optional owner step: add local events.

**v1.5 (D237, #1778):** N-5 grounded AI built: "New post from…" on New post with 7 templates fed only by this week's facts; 5 headlines, excerpt, sectioned body, 3 Digital Assets pictures; rule and compliance flags shown at once; prices only in Sale/Vendor-day from the promotion, below-cost held back, no superlatives; drafts only (G-115, F-22-10, F-22-16). No migration.

**v1.6 (D237, #1779):** N-6 culture news desk built: Regulatory Watch, Find news (on demand only) and Vendor wins into CULTURE drafts with their source links; health-topic guard (therapeutic wording blocked; health needs a source, the provider line and no product/deal links) on draft, save, Publish and scheduled publish (G-116, F-22-13, F-22-14). No migration.

**v1.7 (D238, #1781):** N-8a newsletter canvas built: in-app sections, Fill from this week, QR codes, desktop/phone/plain-text preview, fixed warnings + unsubscribe footer, send check (Gmail 102 KB clip, image weight/format/width/alt) that blocks the send on must-fix items, and image compression into Media copies; the broadcast and the queue send the canvas (G-118, F-22-8). No migration.

**v1.8 (D238, #1782):** N-8b canvas AI studio built: Draft the newsletter from this week's facts, Improve the selected section, Suggest 5 subjects (all checked for invented prices/links, superlatives, health claims and compliance before use), and a picture studio that edits or makes pictures with GPT Image, Gemini or FLUX, including Remove background; results saved to Media; budget-guarded, logged and audited (G-118). No migration.

**v1.9 (D238, #1783):** N-8c moving and interactive canvas built: GIF maker (2-10 pictures into an email-sized GIF), Live countdown (drawn at open time), One-tap poll (tracked answer links), Clicks by section with poll votes, and a hosted View in your browser copy (G-118). No migration.

**v2.0 (D239, #1784):** N-7 rich posts built: block body (heading, image from Digital Assets, product card, quote, button, source list) kept in the same paragraphs, a library picker for the hero, All/Store/Culture/Newsletters chips on the same `/blog` page (Q-22-7) and Article JSON-LD (G-117). No migration.

**v2.1 (D239, #1785):** N-9 curated reviews built: a Curated reviews list (quote, first name, Google link, permission tick) used by the canvas, the post editor and the Review spotlight; health wording held back (G-119, Q-22-2 (a)). No migration.

**v2.2 (D239, #1786):** N-10 help built: updated helpers on Blog & Newsletter and the Send Center, a Sunday checklist strip (Forms 8.1 and 8.2 in the app), concierge `blog-newsletter` corrected plus `newsletter-sunday` and `culture-posts` topics, Help Center answers corrected (G-120). No migration. Phase N complete.

**v2.3 (D243, #1790):** Phase E "Email Studio" APPROVED (E-1 … E-6, G-121 … G-126). E-1 brand frame built: one locked header and footer for every newsletter (logo, title, issue number and date; socials, 21+, warnings, unsubscribe), three styles, owner/admin only, at Newsletter Send > Brand frame. No migration.

**v2.4 (D243, #1791):** E-2 design sections built: the Banner Studio inside the newsletter canvas, saved as a hosted picture with alt text and a link; QR on the design, live menu product rows and countdown under it; out-of-date, alt, ad-rule, text-size, price and date checks. No migration.

**v2.5 (D243, #1792):** E-3 full-page editor built: three panes (library with templates and saved sections, inspector with per-section style, preview with dark-mode and inbox mockups), drag to reorder, duplicate, undo; Columns and Picture-with-words sections; "Replace:" template words block the send. No migration.

**v2.6 (D243, #1793):** E-4 AI picture tools built: make, edit, remove background, erase/replace a painted area (FLUX Fill), extend (FLUX Expand), recolour, relight, style, variations, enlarge 2×, AI GIF; new Media files, before/after slider, undoable swap. No migration.

**v2.7 (D243, #1794):** E-5 Ask the canvas built: the AI looks at a picture of the email and the section list, answers and proposes steps (words, style, look, sections, picture tools), checked against the copy and compliance rules; Apply then Undo. No migration.

> **Program governance (not a numbered SOP).** `SOP-00 · How SOPs are written, versioned, acknowledged and updated`. Document control: owner approval, version bump rules, re-acknowledgment, annual review. Written in the integration phase.

---

## Part 2 — Slice roadmap

Order principle: **highest owner priority + highest money/license risk first**, with dependencies respected (SOP-02/03 build on SOP-01's cash model; SOP-15 needs the CCRS bible from SOP-16 but the bible is already written, so the order holds).

| Slice | SOP | Why this position | Est. audit size |
|---|---|---|---|
| **SOP-00** | Recon + roadmap (this) | Owner asked for it first | — |
| **SOP-01** | Register Operations | Owner's first and most detailed request; most findings already | XL (25.6k) · **DONE** (draft v1.1) |
| **SOP-02** | Master Till / Safe | Same cash model; finish while it is loaded in context | S · **DONE** (draft v1.2) |
| **SOP-03** | EOD Close & Deposit Bag | Completes the cash chain till → safe → bank | M · **DONE** (draft v1.1) |
| **SOP-04** | Receiving Intake (+ monthly CCRS PRR) | Rule 11: the business-critical pipeline | XL · **DONE** (draft v1.1) |
| **SOP-05a** | Inventory Core: lots, holds, labels, labs, expiry | Follows intake downstream; split per D35 | L · **DONE** (draft v1.1) |
| **SOP-05b** | Non-Cannabis, Merch, Menu Publishing & Classification | Second half of SOP-05 (D35) | L · **DONE** (draft v1.0) |
| **SOP-06** | Cycle Counts, Audits & Daily Checklists | Depends on SOP-05 vocabulary | M · **DONE** (draft v1.1) |
| **SOP-15** | Returns to Vendor & Destruction | Inventory exit, license-critical | M · **DONE** (draft v1.1; D63–D68 applied in slice SOP-08) |
| **SOP-08** | New Hire Onboarding, System Access & Offboarding | Owner moved it next (D69) | M · **DONE** (draft v1.0) |
| **SOP-16** | CCRS Uploads | License-critical; closes the inventory compliance loop | L · **DEFERRED (D69)** |
| **SOP-13** | Online Orders | Daily floor operation | L |
| **SOP-14** | Leafly Integration | Pairs with online orders | XL (79k) · **DEFERRED (D69)** |
| **SOP-19** | Customers, ID, Limits, Medical | Floor compliance | M |
| **SOP-17** | Hardware | Self-contained | M |
| **SOP-09** | Purchasing, Vendor Menus & Crawler PO Builder | Q4 answered (D4): crawler PO builder approved; own procedure + saved data | L |
| **SOP-10** | Enrichment (product + vendor) | | L |
| **SOP-11** | Creative & Merch Studio | Owner resumed SOPs for it (D231); merch first | M · **DONE (merch half v1.0 … v1.9; Creative Studio, Banner Studio & Scheduling v2.0 as SOP-11b, D233)** |
| **SOP-12** | Digital Assets page | Q5 answered (D5) | M |
| **SOP-21** | SEO | New per D6; pairs with SOP-12 | M |
| **SOP-22** | Newsletter, Blog, Culture & AI content | Owner asked next (D236) | M · **DONE (v2.7, D243; Phase N COMPLETE; Phase E APPROVED, E-1 … E-5 BUILT)** |
| **SOP-07** | Cleaning Schedule | Paper-first; no code to audit | S |
| **SOP-18** | Opening & Closing Checklist | Composed from the others, so it goes last | S |
| **SOP-20** | Incident & Emergency | Composed from the others | S |

**SOP writing paused (D75).** The owner: *"I would like to take a break from the sop and audit work, we have covered the majority of what I want to have on hand as far as sops."* Every written SOP is in the **SOP Library** (Employee → SOP Library). The fix phase starts next (`06-FIX-PHASE-PLAN.md`). Customers, loyalty and online orders are to be audited later, probably without SOPs; digital content is audited and fixed with the remaining budget.

**Deferred by the owner (D69):** SOP-16 (CCRS reporting and uploads: *"We haven't fully finished it, and soon, it will be completely automated"*), SOP-14 (Leafly: *"it works automatically, I have tested each feature"*), everything in the accounting branch, and the Lyman menu. They are left out of SOPs and audits until the owner asks for them.
| **SOP-INT** | Phase C strategy session | Walk the findings ledger + gap register with the owner | — |

Each slice ends the same way: commit `docs/sop/SOP-XX-*.md` + ledger updates → push → PR → rebase-merge → sync main. That is 21 PRs, each small and independently reviewable.

**Pace:** one SOP per slice, as the owner asked. XL slices (01, 04, 05, 14) may need a mid-slice WIP push for sandbox safety (rule 14). The SOP is still delivered as one unit.

---

## Part 3 — Owner questions: ANSWERED (2026-10-27)

The owner answered every question. The decision record (D1–D9, with verbatim quotes) is in `00-OWNER-REQUEST-VERBATIM.md`. The original questions are kept below for history.

| # | Question (original) | Owner answer | Decision | Where it lands |
|---|---|---|---|---|
| **Q1** | In-app "read & acknowledged" sign-off; should SOP-01 gate register unlock? | "no … the system doesn't need to require anything from them" | **D1** — no gate, no required acknowledgment | Phase D (ack design dropped) |
| **Q2** | Second-person till sign-off: close only or also count-in? Lead/manager or any employee? | "close only, and it can be any second employee" | **D2** | SOP-01 §4.27 step 8, form 8.4 · gap G-01 |
| **Q3** | Little safe: tracked balance/target, or just a supply? | "no, I just want to know when big bills leave the master till and go into the little safe. And what the small bills and coin are that came out of the little safe." | **D3** — no balance; log the denominations both ways | SOP-01 §4.26, form 8.3 · SOP-02 · gap G-02 |
| **Q4** | Is browsing Cultivera menus to build POs an ongoing approved workflow? | "The po builder using the crawler will continue to be allowed going forward and should have a proper sop explaining how to use it, and save the data we get from it." | **D4** | SOP-09 · gap G-07 |
| **Q5** | "Digital content": Digital Assets library or in-store screens? | "the digital assets page in the mktg & adv dropdown menu … clean it up and keep it organized" | **D5** (+ **D6** SEO SOP) | SOP-12 · new SOP-21 |
| **Q6** | Over/short tolerance threshold? | "$5. It should be an admin only screen … Just warnings for now. Who, when, how much, their reason … (should be required …)" | **D7** — $5; admin-only warnings screen; reason required | SOP-01 §4.30, form 8.5 · gap G-03 |
| **Q7** | Is the `job_role` (register) vs `StaffRole` (back office) split intended? | "yes, please keep those separate … not all users are employees. All employees are users." | **D8** | SOP-01 §2 · SOP-08 |
