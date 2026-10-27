# SOP Program — Catalog of SOPs + Slice Roadmap

Slice SOP-00 · 2026-10-27 · audited at `main@54445a68`
Updated in slice SOP-03 · owner facts D14–D20 applied; SOP-03 written (earlier: slice SOP-02, D10–D13; slice SOP-01, D1–D9, SOP-21 SEO added per D6)

Every SOP below is mapped to the **real code** it will be verified against. Code sizes come from a census of the tree (`.ts/.tsx` files and lines) and show how much audit work each slice involves. "Requested" quotes the owner. EXISTS/PARTIAL/MISSING is the recon verdict and is re-verified in depth in the SOP's own slice.

---

## Part 1 — The SOP catalog (21 SOPs)

### SOP-01 · Register Operations: Shift, Till & Cash (the flagship)
**Audience:** every employee (budtender), plus a manager section · **Requested:** clocking in, counting the till, entering the amount, closing the till, what to do with the money, balancing, second-person sign-off, shift-close and day-close reports, the EOD sheet, morning recount → seal bag → safe → bank.
**Code (≈25.6k lines, 70 files):** `src/app/pos/RegisterShell.tsx`, `SaleFlow.tsx`, `RegisterCartEditor.tsx`, `RegisterInterruptModal.tsx`; `/api/pos/{unlock,till,approve,witness,void,returns,day-report,sync,transactions,reprint,email-receipt,loyalty,member*,stock-flag,interrupts,pickup}`; `src/lib/pos/{till-core,sale-flow-core,day-report-core,void-sale-core,returns-core,price-override-core,cash-rounding-core,change-calc-core,id-scan-core,medical-pos-core,special-discount-sale-core,employee-loan-core,receipt-*}`; `src/lib/registers/*`; `/admin/registers/**`; `src/lib/compliance/sales-limit*`, `sales-hours-*`.
**Covers:** unlock & PIN; handbook gate; clock in/out at the register; count-in (denominations); ringing a sale (scan-required, ID check, sales limits, medical, special discounts, rounding, change); hold/resume; no-sale, price override, void (manager/lead PIN); returns desk; mid-shift drops (witness PIN); safe swaps (approver PIN); blind close + tips; X/Z day report; what to do with the cash; manager reconcile + morning verify; EOD report; offline mode and the exception queue.
**Status:** **WRITTEN** in slice SOP-01 as `docs/sop/SOP-01-register-operations.md` v1.0 (draft for owner review). Per D9 it covers every kind of sale, every discount, every block and warning, and how to read the register and checkout screens. 16 findings (F-01-1…F-01-16), gaps G-01…G-05 in `05-GAP-REGISTER.md`.
**SOP-01 audit verdict:** count-in, drop, swap, blind close, reconcile, verify, X/Z report, offline queue **EXIST**. Expected close shows $0.00 on the reconcile screen (F-01-3). Cash sales are hand-typed (F-01-4, S1). Second count at close **MISSING** (F-01-9, D2). Swap denominations **MISSING** (F-01-8, D3). $5 warnings screen **MISSING** (F-01-11, D7). Medical test mode can record a tax-removed sale with no exemption record (F-01-14, S1).
**Recon verdict (SOP-00, kept for history):** count-in, drop, swap, blind close, reconcile and the EOD print **EXIST**. Second-person close sign-off is **MISSING** (F-00-5). Morning recount is **BROKEN/PARTIAL** (F-00-3, F-00-4). Bag seal → safe → bank is **MISSING** in the UI (F-00-6). Report export is **MISSING** (print only, F-00-8).

### SOP-02 · Master Till / Store Safe Routine
**Audience:** opening + closing employees, manager · **Requested:** count twice a day (AM/PM); balance using small bills from the little safe in exchange for big bills from the master; exportable and printable.
**Code:** `/admin/registers/safe` (`page.tsx`, `actions.ts`), `src/lib/registers/safe-core.ts` (`SAFE_TARGET_MINOR=$1,000`, windows am/pm/other, open (non-blind) counts), `safe-store.ts`, migration `0135_safe_counts_swaps.sql`, `src/lib/accounting/safe-bag-core.ts`, `register-cash-journal-core.ts` (swap = no accounting effect).
**Status:** **WRITTEN** in slice SOP-02 as `docs/sop/SOP-02-master-till-safe.md` v1.0 (draft for owner review), revised to **v1.1** in slice SOP-03 with D14–D19 (swaps are till ↔ master till, anyone records the master count, $5 rule covers the master till, supply-run screen approved, Manager Till $300). Owner facts D10–D13 applied: three tills at $167.50, the $1,000 master till mix, the counts page, everything pinned. 13 findings (F-02-1…F-02-13), gaps G-08…G-12 (G-02/G-03 updated) in `05-GAP-REGISTER.md`.
**SOP-02 audit verdict:** the AM/PM counts page **EXISTS** (D12 met; `/admin/registers/safe`). The $1,000 target **MATCHES** D11. Denomination mix is stored but never compared to a standard (F-02-3). The Manager Till float is $300 in the system. That was first recorded as a mismatch (F-02-2), then **withdrawn**: the owner confirmed $300 (D19). Drops are never posted to the books (F-02-1, **S1**). Counted-by is optional, with no PIN (F-02-4). Several AM/PM counts are allowed a day (F-02-5). No variance threshold or reason (F-02-6). Little safe is **MISSING** (F-00-7, D3 → G-02). Print/export is **MISSING** (F-00-8 → G-09). Supply runs are **UNREACHABLE** (F-02-11).
**Recon verdict (SOP-00, kept for history):** twice-daily counts **EXIST**. Register↔safe swaps **EXIST**. The "little safe" store is **MISSING** (F-00-7). Print/export **MISSING** (F-00-8).

### SOP-03 · End-of-Day Close & Deposit Bag (night count → morning verify → seal → safe → bank)
**Audience:** closing + opening leads, manager, owner · **Requested:** "end of day spreadsheet that one person completes before close, and the morning employee recounts and verifies…"
**Code:** `/admin/registers/eod` (`page.tsx`, `UndepositedFunds.tsx`, `RegisterCashSpecimen.tsx`), `src/lib/registers/eod-core.ts`, `eod-store.ts`, `deposit_bags` (migration 0212), `safe-bag-core.ts` (bag states available→undeclared→counted→deposited; register cannot close with an undeclared bag), `docs/CASH_DEPOSIT_POLICY_DECISION.md`, `MICHAEL-books-96/98`, the structuring-mirror check.
**Status:** **WRITTEN** in slice SOP-03 as `docs/sop/SOP-03-eod-close-deposit.md` v1.0 (draft for owner review). Paper procedure: night sheet (form 8.1 A/B/C), bag log (8.2), night/morning/manager/bank-run checklists (8.3–8.6), the $10,000 line. 11 findings (F-03-1…F-03-11), gaps G-14 and G-15 (G-04 updated), open questions Q-03-1…Q-03-7.
**SOP-03 audit verdict:** the EOD report **EXISTS** (print only, one signature, no deposit figure, F-03-5; no refunds, F-03-6; no date picker, F-03-8; silent read failures, F-03-7). Morning recount, seal, bag log and bank run are **MISSING** in the UI (F-00-6 re-confirmed; G-04). The books cash-to-bank chain is **BROKEN**: nothing fills 10400 since D-77, so the Undeposited Funds panel shows a false all-clear (F-03-1, **S1**). Bank-deposit clearing has **no caller**, yet the census says it is reachable (F-03-3, **S1**). The bag lifecycle and $10k shape check are built but **UNREACHABLE** (F-03-10). Help/concierge have **no** EOD/deposit content (F-03-11).
**Recon verdict (SOP-00, kept for history):** EOD report (print) **EXISTS**. Bag lifecycle is core-only, **UNREACHABLE** (F-00-6). Written separately from SOP-01 because it crosses two shifts and two people, and it is the control the owner relies on most.

### SOP-04 · Receiving Intake Pipeline (truck day)
**Audience:** receiving staff, manager · **Requested:** "a sop for the receiving intake pipeline."
**Code (≈19.6k lines core + inventory):** `/admin/inventory/intake`, `/intake/[id]`, `/intake/[id]/match`, `/admin/inventory/drafts`, `/inventory/batch-lookups`, `src/lib/inventory/intake-*`, `brand-resolve-core.ts`, `src/lib/inbound-email/*` (forwarded manifests, .eml explode), quarantine, COA capture, samples cap; `docs/RECEIVING-IS-THE-REAL-PIPELINE.md`, `INTAKE_PIPELINE_*`. **Rule 11: the one way products enter Greenway.** This slice gets the deepest audit.
**Recon verdict:** EXISTS. The existing `sop-core.ts` truck-day + "receive/onboard/publish" sheets get re-audited and absorbed.

### SOP-05 · Inventory Management (daily)
**Audience:** manager, inventory lead · **Requested:** "sop for inventory management."
**Code (≈116k lines across `src/lib/inventory`, the largest domain):** `/admin/inventory`, `/inventory/[id]`, lots + labels, tags, expiration rules, labs/COAs, non-cannabis, merch inventory, recall holds (`recall-hold-*`), held stock, low stock, stock flags from the register, publish menu, Types & Categories, sales-limit classification.

### SOP-06 · Cycle Counts & Inventory Audits + Daily Task Checklists
**Audience:** all floor staff (counting), owner (create/approve) · **Requested:** "Checklists for daily tasks like cycle counts I initiate via the inventory audit feature."
**Code (≈13.5k lines):** `/admin/inventory/audits/**` (owner: `inventory.audit`), `/admin/inventory/cycle-counts/**` (staff: `inventory.count`, a blind sheet with no cost/variance), export route, migrations 0191/0192. Owner decisions books-23 (verbatim in `roles.ts`).
**Recon verdict:** audits + blind counts **EXIST**. A daily-task checklist **MISSING** (F-00-9).

### SOP-07 · Store Cleaning & Facility Schedule
**Audience:** all staff · **Requested:** "cleaning schedules, including dusting products and such."
**Code:** none (F-00-9). Written as a **paper-first SOP** (daily/weekly/monthly matrices with initials columns, display-product dusting, glass cases, counters, scales, restrooms, vault/safe area, CCRS-relevant waste handling pointer to SOP-15). The app build is a Phase C decision. Grounded in WA requirements where they exist (WAC 314-55 security/facility rules). I will not invent regulatory claims.

### SOP-08 · New Hire Onboarding & System Access (and offboarding)
**Audience:** manager/admin/owner · **Requested:** "new hires and setting them up with access to the system."
**Code (≈13.3k lines):** `/admin/staffing/employees/**` (onboarding/offboarding checklists in `employee-lifecycle-core.ts`: I-9, W-4, DSHS, handbook, PIN, badge, schedule, payroll, direct deposit), e-sign, `/admin/users` (invite, role, deactivate; `roles.ts` permission matrix), `/admin/staffing` time clock, PIN hashing (`security/pin-hash`), PIN throttle, handbook-ack gate (back office + register), WebAuthn/security settings, `job_role` sales/lead/manager vs `StaffRole`.
**Note:** two identity systems (employee PIN record vs staff login) must be explained clearly. This slice audits how they link.

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

> **Program governance (not a numbered SOP).** `SOP-00 · How SOPs are written, versioned, acknowledged and updated`. Document control: owner approval, version bump rules, re-acknowledgment, annual review. Written in the integration phase.

---

## Part 2 — Slice roadmap

Order principle: **highest owner priority + highest money/license risk first**, with dependencies respected (SOP-02/03 build on SOP-01's cash model; SOP-15 needs the CCRS bible from SOP-16 but the bible is already written, so the order holds).

| Slice | SOP | Why this position | Est. audit size |
|---|---|---|---|
| **SOP-00** | Recon + roadmap (this) | Owner asked for it first | — |
| **SOP-01** | Register Operations | Owner's first and most detailed request; most findings already | XL (25.6k) · **DONE** (draft v1.0) |
| **SOP-02** | Master Till / Safe | Same cash model; finish while it is loaded in context | S · **DONE** (draft v1.0) |
| **SOP-03** | EOD Close & Deposit Bag | Completes the cash chain till → safe → bank | M · **DONE** (draft v1.0) |
| **SOP-04** | Receiving Intake | Rule 11: the business-critical pipeline | XL |
| **SOP-05** | Inventory Management | Follows intake downstream | XL (largest domain; split into 05a/05b if needed) |
| **SOP-06** | Cycle Counts, Audits & Daily Checklists | Depends on SOP-05 vocabulary | M |
| **SOP-15** | Returns to Vendor & Destruction | Inventory exit, license-critical | M |
| **SOP-16** | CCRS Uploads | License-critical; closes the inventory compliance loop | L |
| **SOP-13** | Online Orders | Daily floor operation | L |
| **SOP-14** | Leafly Integration | Pairs with online orders | XL (79k) |
| **SOP-08** | New Hire & Access | Needed before rollout of the SOP library | M |
| **SOP-19** | Customers, ID, Limits, Medical | Floor compliance | M |
| **SOP-17** | Hardware | Self-contained | M |
| **SOP-09** | Purchasing, Vendor Menus & Crawler PO Builder | Q4 answered (D4): crawler PO builder approved; own procedure + saved data | L |
| **SOP-10** | Enrichment (product + vendor) | | L |
| **SOP-11** | Creative & Merch Studio | | M |
| **SOP-12** | Digital Assets page | Q5 answered (D5) | M |
| **SOP-21** | SEO | New per D6; pairs with SOP-12 | M |
| **SOP-07** | Cleaning Schedule | Paper-first; no code to audit | S |
| **SOP-18** | Opening & Closing Checklist | Composed from the others, so it goes last | S |
| **SOP-20** | Incident & Emergency | Composed from the others | S |
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
