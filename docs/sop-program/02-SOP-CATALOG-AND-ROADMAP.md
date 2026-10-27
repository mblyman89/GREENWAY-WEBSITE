# SOP Program — Catalog of SOPs + Slice Roadmap

Slice SOP-00 · 2026-10-27 · audited at `main@54445a68`

Every SOP below is mapped to the **real code** it will be verified against. Code sizes come from a census of the tree (`.ts/.tsx` files and lines) and show how much audit work each slice involves. "Requested" quotes the owner. EXISTS/PARTIAL/MISSING is the recon verdict and is re-verified in depth in the SOP's own slice.

---

## Part 1 — The SOP catalog (20 SOPs)

### SOP-01 · Register Operations: Shift, Till & Cash (the flagship)
**Audience:** every employee (budtender), plus a manager section · **Requested:** clocking in, counting the till, entering the amount, closing the till, what to do with the money, balancing, second-person sign-off, shift-close and day-close reports, the EOD sheet, morning recount → seal bag → safe → bank.
**Code (≈25.6k lines, 70 files):** `src/app/pos/RegisterShell.tsx`, `SaleFlow.tsx`, `RegisterCartEditor.tsx`, `RegisterInterruptModal.tsx`; `/api/pos/{unlock,till,approve,witness,void,returns,day-report,sync,transactions,reprint,email-receipt,loyalty,member*,stock-flag,interrupts,pickup}`; `src/lib/pos/{till-core,sale-flow-core,day-report-core,void-sale-core,returns-core,price-override-core,cash-rounding-core,change-calc-core,id-scan-core,medical-pos-core,special-discount-sale-core,employee-loan-core,receipt-*}`; `src/lib/registers/*`; `/admin/registers/**`; `src/lib/compliance/sales-limit*`, `sales-hours-*`.
**Covers:** unlock & PIN; handbook gate; clock in/out at the register; count-in (denominations); ringing a sale (scan-required, ID check, sales limits, medical, special discounts, rounding, change); hold/resume; no-sale, price override, void (manager/lead PIN); returns desk; mid-shift drops (witness PIN); safe swaps (approver PIN); blind close + tips; X/Z day report; what to do with the cash; manager reconcile + morning verify; EOD report; offline mode and the exception queue.
**Recon verdict:** count-in, drop, swap, blind close, reconcile and the EOD print **EXIST**. Second-person close sign-off is **MISSING** (F-00-5). Morning recount is **BROKEN/PARTIAL** (F-00-3, F-00-4). Bag seal → safe → bank is **MISSING** in the UI (F-00-6). Report export is **MISSING** (print only, F-00-8).

### SOP-02 · Master Till / Store Safe Routine
**Audience:** opening + closing employees, manager · **Requested:** count twice a day (AM/PM); balance using small bills from the little safe in exchange for big bills from the master; exportable and printable.
**Code:** `/admin/registers/safe` (`page.tsx`, `actions.ts`), `src/lib/registers/safe-core.ts` (`SAFE_TARGET_MINOR=$1,000`, windows am/pm/other, open (non-blind) counts), `safe-store.ts`, migration `0135_safe_counts_swaps.sql`, `src/lib/accounting/safe-bag-core.ts`, `register-cash-journal-core.ts` (swap = no accounting effect).
**Recon verdict:** twice-daily counts **EXIST**. Register↔safe swaps **EXIST**. The "little safe" store is **MISSING** (F-00-7). Print/export **MISSING** (F-00-8).

### SOP-03 · End-of-Day Close & Deposit Bag (night count → morning verify → seal → safe → bank)
**Audience:** closing + opening leads, manager, owner · **Requested:** "end of day spreadsheet that one person completes before close, and the morning employee recounts and verifies…"
**Code:** `/admin/registers/eod` (`page.tsx`, `UndepositedFunds.tsx`, `RegisterCashSpecimen.tsx`), `src/lib/registers/eod-core.ts`, `eod-store.ts`, `deposit_bags` (migration 0212), `safe-bag-core.ts` (bag states available→undeclared→counted→deposited; register cannot close with an undeclared bag), `docs/CASH_DEPOSIT_POLICY_DECISION.md`, `MICHAEL-books-96/98`, the structuring-mirror check.
**Recon verdict:** EOD report (print) **EXISTS**. Bag lifecycle is core-only, **UNREACHABLE** (F-00-6). Written separately from SOP-01 because it crosses two shifts and two people, and it is the control the owner relies on most.

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
**Code (≈20.8k lines):** `/admin/purchasing/**`, `/purchasing/menus/**` (`cultivera`, `growflow`, `leaflink`, `email`), `src/lib/purchasing/*` (po-core, po-builder, po-document, po-review-ai, unified-search), crawler worker (`crawler/app/*_auth.py`, `*_api.py`), `/admin/vendor-payments` (AP, drafts-only NACHA), `/admin/discovery`. **Owner question Q4** (F-00-15) must be answered first.

### SOP-10 · Product Enrichment & Mastering + Vendor/Brand Enrichment
**Audience:** content/inventory staff · **Requested:** "product enrichment and how to do it, as well as vendor enrichment."
**Code (≈23k + 7k lines):** `/admin/products`, `/products/[key]`, `/products/bulk-ai`, `/products/masters/**`, `/admin/inventory/batch-lookups`, `src/lib/enrichment/*`, `src/lib/ai/*` (Gemini batch, grounding, accept-gate: **drafts-only, rule 3**), `/admin/knowledge-base/**`, `/admin/vendors/**` (import, merge), `src/lib/vendors/*`.

### SOP-11 · Creative Studio, Merch Studio & Marketing Content
**Audience:** content editor, manager · **Requested:** "utilize the creative studio to create banners, ads and marketing content, graphics for garments."
**Code (≈18.3k lines):** `/admin/marketing`, `/admin/marketing/midjourney` (Creative Studio), `/admin/merch-studio` (garment graphics, proofs, ads), `/admin/merch-site/*`, `src/lib/marketing/*` (campaign-rules-core: WA advertising compliance, creative placements), `src/lib/merch-studio/*`, banner studio, `/admin/helpers`, WAC 314-55-155 advertising rules (already in `compliance-general`).

### SOP-12 · Digital Content: Digital Assets, Website Content & Scheduling
**Audience:** content editor · **Requested:** "how to use digital content." **Assumption to confirm (Q5):** I read this as the **Digital Assets** media library (renamed from Media Library in R69) plus the website content tools that use it (shop banner, carousel, content schedule/releases, SEO, store listing). If you meant in-store screens/menu boards: **no such feature exists in the code** (verified: no signage/menu-board module).
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

> **Program governance (not a numbered SOP).** `SOP-00 · How SOPs are written, versioned, acknowledged and updated`. Document control: owner approval, version bump rules, re-acknowledgment, annual review. Written in the integration phase.

---

## Part 2 — Slice roadmap

Order principle: **highest owner priority + highest money/license risk first**, with dependencies respected (SOP-02/03 build on SOP-01's cash model; SOP-15 needs the CCRS bible from SOP-16 but the bible is already written, so the order holds).

| Slice | SOP | Why this position | Est. audit size |
|---|---|---|---|
| **SOP-00** | Recon + roadmap (this) | Owner asked for it first | — |
| **SOP-01** | Register Operations | Owner's first and most detailed request; most findings already | XL (25.6k) |
| **SOP-02** | Master Till / Safe | Same cash model; finish while it is loaded in context | S |
| **SOP-03** | EOD Close & Deposit Bag | Completes the cash chain till → safe → bank | M |
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
| **SOP-09** | Purchasing & Vendor Menus | Needs Q4 answered | L |
| **SOP-10** | Enrichment (product + vendor) | | L |
| **SOP-11** | Creative & Merch Studio | | M |
| **SOP-12** | Digital Content | Needs Q5 answered | M |
| **SOP-07** | Cleaning Schedule | Paper-first; no code to audit | S |
| **SOP-18** | Opening & Closing Checklist | Composed from the others, so it goes last | S |
| **SOP-20** | Incident & Emergency | Composed from the others | S |
| **SOP-INT** | Phase C strategy session | Walk the findings ledger + gap register with the owner | — |

Each slice ends the same way: commit `docs/sop/SOP-XX-*.md` + ledger updates → push → PR → rebase-merge → sync main. That is 20 PRs, each small and independently reviewable.

**Pace:** one SOP per slice, as the owner asked. XL slices (01, 04, 05, 14) may need a mid-slice WIP push for sandbox safety (rule 14). The SOP is still delivered as one unit.

---

## Part 3 — Open questions for the owner (answers change what the SOPs say)

| # | Question | Blocks |
|---|---|---|
| **Q1** | Should each SOP need an in-app "read & acknowledged" sign-off (like the handbook), and should SOP-01 acknowledgment **gate register unlock**? | Phase D design |
| **Q2** | Second-person till sign-off: at **every close** (night) only, or also at **count-in** (morning)? Must the second person be a lead/manager, or any employee (like the employee-purchase witness)? | SOP-01 wording and the build spec |
| **Q3** | The "little safe": is it a separate physical safe whose balance we should **track and count** (a second $ target), or just a supply of small bills with no tracked balance? What is its target amount? | SOP-02 |
| **Q4** | Is browsing **Cultivera Marketplace** vendor menus to build POs an ongoing, approved workflow (rule 11 only forbids it as a product-entry path)? | SOP-09 |
| **Q5** | "Digital content": the Digital Assets library + website content tools, or in-store TV/menu screens (which do not exist in the code)? | SOP-12 |
| **Q6** | Over/short tolerance: is there a dollar threshold that must be escalated (for example ±$5 = note, ±$20 = manager call)? None exists in code today. I will not invent one. | SOP-01/03 |
| **Q7** | Who is "manager" at the register? The code's PIN approver roles are `manager` and `lead` (employee `job_role`), separate from back-office `StaffRole`. Is that split intended? | SOP-01/08 |
