# Greenway POS — Deep Research (Slice 0)

> **Purpose.** This is the research foundation for transforming the Greenway back office into a
> full **Point of Sale (POS) command center** that replaces Cultivera. It captures the best-practice
> feature sets of professional cannabis + retail POS systems, the **Washington State compliance backbone**
> we must build around (CCRS — *not* Metrc), the metrics a dispensary owner should see at a glance,
> and the cash-handling realities of a cash-heavy cannabis store.
>
> **Status:** Research/planning only. No production feature code ships in Slice 0.
> Implementation is sequenced in `POS_ROADMAP.md`, itemized in `POS_FEATURE_CHECKLIST.md`,
> and grounded against our real schema in `POS_DATA_MODEL_GAP_ANALYSIS.md`.

---

## 0. The single most important architectural fact

**Washington does NOT use Metrc.** Washington's traceability/compliance system is the
**Cannabis Central Reporting System (CCRS)**, an in-house Washington State Liquor and Cannabis Board
(LCB) data-reporting platform that replaced Leaf Data Systems. Any "track-and-trace" or
"seed-to-sale" feature we build must target **CCRS file/report formats**, not Metrc's API.

- Access portal: `cannabisreporting.lcb.wa.gov` (currently behind SAW; LCB has announced a
  transition to WA.gov single sign-on in Oct 2026).
- CCRS is **report/file-based** (CSV uploads) rather than a real-time per-event API like Metrc.
  Licensees submit periodic reports describing inventory, sales, transfers, etc.
- **New required reports went live Oct 1, 2025:**
  - **Harvest.CSV** — required for producers (harvest reporting).
  - **Updated Manifest.CSV** — adds a **`LabtestexternalIdentifier`** column carried from the
    product's Certificate of Analysis (COA). Required for processor → retail transfers.
  - Educational grace period Oct 1–31, 2025; **enforcement begins Nov 1, 2025**.
- **Implication for Greenway (a retailer / I-502 store):** Our POS must (a) capture and store the
  COA `LabtestexternalIdentifier` and lab data on inbound product, (b) preserve full inbound
  **manifest** lineage, and (c) be able to **export CCRS-shaped reports** (sales, inventory
  adjustments, transfers) on the LCB's schedule. We design the data model so a CCRS export is a
  *report over existing tables*, never a bolt-on.

> Source basis: WA LCB CCRS guidance (lcb.wa.gov/ccrs), CCRS reporting-guide/changelog notices for
> the Oct 1 2025 Harvest.CSV / Manifest.CSV updates. Treat exact column lists as **to-be-verified
> against the current LCB CCRS Reporting Guide** before we write the exporter (see roadmap Slice that
> implements CCRS export — we will pull the live spec at build time).

---

## 1. What a professional cannabis POS actually does (feature domains)

Synthesized from cannabis-POS buyer guides (e.g., the "7 essential features" frameworks) and
general retail/ERP inventory references (e.g., NetSuite inventory management literature). Grouped
into the domains we will build.

### 1.1 Customer / Patient management + ID verification + purchase-limit enforcement
- Customer profiles (recreational) and **medical patient** records (authorization card, expiry).
- **Age/ID verification** at point of sale (21+ recreational; medical authorization for patients).
- **Daily purchase-limit enforcement** per WA rules (equivalency math across flower / concentrate /
  edibles / liquids). The POS must *block or warn* when a basket exceeds limits.
- Purchase history, loyalty linkage, marketing consent, do-not-contact flags.

### 1.2 Inventory management (the heart of POS)
- **Real-time inventory tracking** down to the saleable unit; deduct on sale, restore on return.
- **Lot / batch tracking** with source vendor, COA / lab results, and CCRS lineage.
- **FIFO / FEFO** rotation (first-in-first-out; first-expiry-first-out for perishable edibles).
- **Automated reorder alerts** (par levels / reorder points) and **demand forecasting**.
- **Cycle counting** and full physical counts with variance reconciliation.
- **Inventory adjustments** with reason codes (shrink, damage, sample, compliance destruction) —
  every adjustment is auditable and CCRS-reportable.
- Multi-location aware (back stock vs sales floor) even if we start single-store.

### 1.3 Purchasing / receiving (vendor → store)
- **Purchase Orders (POs)**: assign supplier, expected items, costs, lead times, status lifecycle
  (draft → sent → partially received → received → closed).
- **Receiving against a manifest/PO**: partial receiving, backorder management, cost capture,
  COA capture (the CCRS `LabtestexternalIdentifier`), lot creation on receipt.
- Vendor management: contacts, terms, price lists, performance (fill rate, lead time, returns).

### 1.4 Selling (the register)
- Fast cart/basket, barcode scanning, variant selection, quantity, line discounts.
- **Discounts & promotions** with **manager-approval workflow** for overrides above a threshold.
- Loyalty redemption, customer attach, mixed tender.
- **Cannabis tax** handling (WA 37% excise + applicable sales tax), tax-inclusive vs added.
- Receipts (print/email/SMS), returns/exchanges with reason codes and inventory restock.
- Offline resilience (a register must keep selling if the network blips).

### 1.5 Cash management (critical — cannabis is cash-heavy)
- **Register/till sessions**: open with a starting float, track cash in/out (paid-in/paid-out),
  **blind close** (count without seeing expected), compute **over/short variance**.
- Drop/skim to safe; **vault / safe** reconciliation; bank **deposit** records.
- Denomination counting helpers; multi-drawer/multi-register support.
- Full audit trail of who opened/closed/counted each drawer.

### 1.6 Staff roles, permissions & ease of use
- Role-based access (owner, manager, budtender, inventory clerk) layered on existing
  `staff_profiles` + permission checks already used across the admin (`requirePermission(...)`).
- **Manager approval** flows (discount overrides, returns, voids, price changes, adjustments).
- Touch-friendly register UI; minimal clicks; large hit targets; keyboard + scanner support.

### 1.7 Compliance & audit
- CCRS-ready reporting (sales, inventory adjustments, transfers/manifests).
- Immutable **audit log** of every sensitive action (we already have `audit_logs`).
- Traceability lineage: lot → COA → manifest → vendor; sale → lot → customer-limit math.
- Compliance incident tracking; product recall / hold handling.

### 1.8 Reporting & analytics (the "command center")
- Daily sales dashboard, returns, voids, discounts, tax collected, cash variance.
- Inventory health (turnover, age, stock-outs, shrink), purchasing performance.
- Customer/loyalty analytics. Exportable for accounting/bookkeeping.
- See the **KPI catalog** in §3.

---

## 2. Retail/ERP inventory best practices we adopt (NetSuite-style)

These are the inventory disciplines a "professional" system bakes in. We treat each as a first-class
capability with its own data + UI:

- **Inventory control vs management vs tracking** — control = policies (par, reorder, ABC class);
  management = the operational workflows; tracking = real-time quantity by lot/location.
- **Barcoding** — every saleable unit and lot has a scannable code; receiving, counting, and
  selling are all scan-driven.
- **Optimization** — reorder points, economic order quantity hints, safety stock, demand
  forecasting from sales velocity.
- **Alerts** — low-stock, out-of-stock, expiring lots, negative-on-hand, cost anomalies.
- **Partial receiving & backorders** — POs rarely arrive complete; the system tracks remaining.
- **Cycle counting** — scheduled partial counts to keep accuracy high without full shutdowns.
- **Lot tracking & FIFO/FEFO** — mandatory for cannabis traceability and edible expiry.

---

## 3. KPI catalog — what the owner should see at a glance

A dispensary command center should surface (and let staff drill into) these KPIs, grouped. This is
the menu we draw the dashboards from; not all ship at once.

**Sales & financial:** Break-Even Point (BEP), Cash Flow, EBITDA, Gross Margin, Net Profit Margin,
Average Transaction Value (ATV), Daily Sales, Monthly Sales, Sales by Category, Sales Growth Rate
(SGR), Total Sales Revenue (TSR), Conversion Rate.

**Customer:** Customer Lifetime Value (CLV), Customer Retention Rate (CRR), Customer Satisfaction
Score (CSS), Loyalty Participation, New Customer Acquisition, Cost Per Lead, Email Open Rate,
Marketing ROI, Social Engagement.

**Inventory:** Carrying Cost of Inventory, Inventory Turnover Ratio, Product Age in Inventory,
Shrinkage Rate, Stock-out Frequency.

**Operations:** Average Transaction Time, Employee Productivity, Operational Costs, Energy Usage.

**Compliance & quality:** Compliance Incident Rate, Batch Testing Compliance, Customer Feedback on
Quality, Product Recall Frequency, Product Return Rate, Quality Audit Scores.

**Security & safety:** CCTV Coverage, Emergency Response Time, Safety Training Completion, Incident
Reports, Inventory Loss Due to Theft.

> Source basis: Solink "40 cannabis dispensary KPIs" framework + general retail KPI references.
> We map each KPI to a data source in `POS_DATA_MODEL_GAP_ANALYSIS.md` so we never invent a metric
> we can't compute from real data.

---

## 4. How this stacks on what we already have

Greenway's back office is already ~70% of a POS *data backbone* (validated against the live schema):

- **Catalog snapshots** from POS imports: `menu_versions`, `menu_items`, `menu_variants`
  (read-only ingest; POS is currently source of truth for price/inventory).
- **Vendors & brands**: `vendors`, `brands` (+ alias tables) with research/KB workflows.
- **Enrichment & AI drafts**: `product_enrichments`, `ai_suggestions` (drafts-only gate).
- **Web orders / reservations**: `orders`, `order_lines`, `order_events` (guest pre-order; NOT a
  register/transaction ledger — see gap analysis).
- **Promotions engine**: `promotions` (+ targets/exclusions/audit snapshots).
- **Loyalty**: `loyalty_signups`. **Media**: `media_assets`/`media_usages`. **Audit**: `audit_logs`.
- **Helpers already in code**: `vendorCompleteness` / `brandCompleteness` (`src/lib/vendors/completeness.ts`)
  and `computeGaps`/`GapFlags` on the products page — the seed of "what's missing" insight.

**The big missing pieces** (detailed in the gap analysis): no in-store **register/transaction**
ledger distinct from web orders; no **customer/patient** records with purchase-limit math; no
**purchase orders / receiving**; no **inventory lots** with COA/manifest lineage; no
**cash drawer / till / deposit** records; no **CCRS export** layer; no **roles/approval** workflow
tables beyond existing permission checks.

---

## 5. Design principles for the build (carry into every slice)

1. **POS price/inventory stays authoritative until we own selling.** We never let enrichment or web
   orders silently override imported price/inventory. When the register becomes the source of truth,
   that switch is explicit and slice-gated.
2. **Compliance is a report over real data, not a feature bolt-on.** Model lots, COAs, manifests,
   adjustments, and sales so a CCRS export is a query, not a re-entry.
3. **Everything sensitive is audited.** Reuse `audit_logs`; every void/return/discount-override/
   adjustment/drawer-count writes an immutable event.
4. **Idempotent, owner-applied SQL.** Per standing rules, migrations/seeds are written idempotent
   and the owner runs them manually in the Supabase SQL editor. RLS on every new table (staff-only
   for POS internals).
5. **AI/crawler output is drafts-only.** Any AI-suggested enrichment, description, or forecast is a
   draft an employee validates before it goes live.
6. **Incremental slices, one PR each.** Squash-merge, delete branch, sync main. Owner picks merge
   timing's intent; agent uses judgment.
7. **Ease of use first.** Budtender register flows must be fast, scan-driven, few clicks, and
   resilient to a flaky network.

---

## 6. Source basis (for re-verification at build time)

- **WA LCB CCRS** — lcb.wa.gov/ccrs (CCRS overview, reporting guide, Oct 1 2025 Harvest.CSV +
  Manifest.CSV `LabtestexternalIdentifier` change, SAW→WA.gov SSO transition notice).
- **Cannabis POS essentials** — cannabis-POS buyer-guide frameworks ("7 essential features":
  inventory, compliance, customer/loyalty, reporting, integrations, ease-of-use, security).
- **Retail/ERP inventory** — NetSuite inventory-management literature (control/management/tracking,
  barcoding, optimization, alerts, partial receiving, backorders, cycle counting, lot tracking, FIFO).
- **Dispensary KPIs** — Solink "40 cannabis dispensary KPIs" catalog.
- **Greenway live schema** — `supabase/migrations/0001–0021` (verified table/column read in Slice 0).

> Note on rigor: exact CCRS column specifications and current WA purchase-limit equivalencies will be
> re-pulled from the live LCB source in the slice that implements them, so the exporter and limit math
> match the rule in force at build time rather than a snapshot in this doc.
