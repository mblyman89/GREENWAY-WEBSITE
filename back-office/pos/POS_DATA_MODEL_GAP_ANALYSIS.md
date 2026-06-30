# Greenway POS — Data Model Gap Analysis (Slice 0)

> Maps what the locked Supabase schema **already has** against what a full POS command center
> **needs**, then proposes the **new tables** to add (idempotent, RLS-protected, owner-applied).
> Grounded in the actual schema read from `supabase/migrations/0001–0021` during Slice 0.

---

## A. What we already have (38 tables) and its POS role

| Existing table | Current role | POS reuse |
|---|---|---|
| `pos_imports`, `pos_import_diagnostics` | Ingest POS export files + diagnostics | Source of inbound catalog; later: receiving cross-check |
| `menu_versions`, `menu_items`, `menu_variants` | Read-only catalog snapshots (price/inventory from POS) | **Catalog spine**; becomes "products" we sell. `source_item_id`/`source_variant_id` are the join keys |
| `vendors`, `vendor_aliases` | Vendor directory + KB workflow | Supplier master for **purchasing/receiving** |
| `brands`, `brand_aliases` | Brand directory + KB | Product attribution + analytics dimension |
| `product_enrichments` | Staff/AI content overlay keyed by `pos_product_key` | Editorial layer; never overrides POS price/inventory |
| `ai_suggestions`, `ai_usage` | AI drafts (gated) + usage ledger | Draft enrichment, forecast suggestions (drafts-only) |
| `orders`, `order_lines`, `order_events` | **Web pre-order / reservation** (guest checkout) | Online channel; **NOT** the in-store register ledger |
| `promotions`, `promotion_targets`, `promotion_exclusions`, `promotion_audit_snapshots` | Discount engine | Reused by the register's discount/pricing |
| `loyalty_signups` | Loyalty list | Seed for customer/loyalty; needs real customer records |
| `media_assets`, `media_usages` | Image library | Product/vendor/brand imagery |
| `audit_logs` | Immutable audit trail | **Reused for all POS-sensitive actions** |
| `staff_profiles` | Staff + permissions | **Reused** for POS roles/approvals |
| `site_settings` | Key/value config | POS config (tax rates, limits, register defaults) |
| CMS/content (`content_blocks`, `content_revisions`, `page_sections`, `blog_posts`, `faq_items`, `seo_entries`, `home_carousel_slides`, `newsletter_*`) | Website CMS | Not POS-core; unaffected |
| KB (`kb_strains`, `kb_terpenes`, `kb_brands`, `kb_category_terms`, `kb_banned_phrases`, `kb_image_substitutes`) | Cannabis knowledge base | Enrichment/education; analytics dimension (strain/terpene) |

### Verified schema facts that shape the design
- `menu_items` carries `source_item_id`, name/brand/vendor, category, `strain_type`, THC/CBD,
  `price_minor_units`, `inventory_status`, `hidden` — but **price/inventory are POS-sourced
  snapshots**, not a live sellable on-hand by lot.
- `menu_variants` has `price_minor_units` + `inventory_level` (snapshot integer), `medical` flag.
- `orders` is explicitly a **reservation/pre-order**: `reservation_expires_at`, guest contact fields,
  `public_token`, status enum `order_status` (new → … ), money in minor units. Comment in schema:
  "cart engine/POS remain truth." So it is the *online* channel, not the register of record.
- `order_lines` snapshot product/variant by **text id** (not FK) to preserve history.
- `audit_logs`, `staff_profiles`, `site_settings` are all reusable foundations.

---

## B. What a full POS needs but we DON'T have yet

| Capability | Gap | Proposed solution |
|---|---|---|
| In-store **register transactions** | `orders` is web reservations only | New `register_sessions`, `transactions`, `transaction_lines`, `transaction_tenders` |
| **Customer / patient** records + limits | only `loyalty_signups` (email list) | New `customers` (+ `patient_authorizations`); link loyalty + orders |
| **Purchase orders** + receiving | none | New `purchase_orders`, `purchase_order_lines`, `receivings`, `receiving_lines` |
| **Inventory lots** with COA/manifest lineage | `menu_*` are snapshots, no lots | New `inventory_lots`, `inventory_adjustments`, `lab_results` (COA), `inbound_manifests` |
| **On-hand by location/lot** (sellable truth) | only snapshot integers | New `inventory_levels` (item/lot/location on-hand) + movement ledger |
| **Cash management** | none | New `cash_drawers`, `cash_movements`, `deposits` |
| **CCRS export** layer | none | New `compliance_reports` (export jobs) + report builders over real tables |
| **Roles / approvals** workflow | permission checks exist, no approval records | New `approval_requests` (override/void/return), reuse `staff_profiles` + `audit_logs` |
| **Returns / voids** as first-class | implicit in web orders | Modeled on `transactions` (type=return/void) + `inventory_adjustments` |
| **Suppliers terms / price lists** | `vendors` has profile only | Extend `vendors` (or `vendor_terms`) with terms, lead time, contacts |

---

## C. Proposed new tables (high-level shape — finalized per-slice before SQL)

> Shapes below are the planning target. Exact columns/constraints/RLS are written in the slice that
> ships them, idempotently, for the owner to apply manually. Money always in **minor units (cents)**.
> Every table: `id uuid pk`, audit columns (`created_at/by`, `updated_at/by`), staff-only RLS unless noted.

### Selling / register
- **`register_sessions`** — drawer/register open→close; `opened_by`, `opening_float_minor_units`,
  `closing_counted_minor_units`, `expected_minor_units`, `variance_minor_units`, `status`, timestamps.
- **`transactions`** — a completed sale/return/void at the register; `session_id`, `customer_id?`,
  `type` (sale/return/void/exchange), money totals (subtotal/discount/tax/total minor units),
  `cashier_id`, `receipt_number`, `voided_by?`, links to web `order_id?` (if fulfilling a reservation).
- **`transaction_lines`** — per item: `item_source_id`/`variant_source_id` (join to `menu_*`),
  `lot_id?`, qty, unit price, discount, tax, line total; reason code if return.
- **`transaction_tenders`** — split payment: `type` (cash/debit/loyalty/other), `amount_minor_units`,
  `change_given_minor_units` for cash.

### Customers / patients
- **`customers`** — name, contact, birthdate (for 21+), marketing consent, `loyalty_signup_id?`,
  totals (visit count, lifetime spend), flags (do-not-contact).
- **`patient_authorizations`** — `customer_id`, authorization id, issue/expiry, medical limits.

### Purchasing / receiving
- **`purchase_orders`** — `vendor_id`, status (draft/sent/partial/received/closed/cancelled),
  expected date, cost totals, notes.
- **`purchase_order_lines`** — `po_id`, product/brand ref, ordered qty, unit cost, received qty.
- **`receivings`** — `po_id?`, `vendor_id`, `manifest_id?`, received_by, received_at, status.
- **`receiving_lines`** — `receiving_id`, `po_line_id?`, qty received, unit cost, **creates a lot**.

### Inventory truth
- **`inventory_lots`** — `lot_code`, `vendor_id`, `brand_id?`, product ref, **`lab_result_id?`**
  (COA), `manifest_id?`, received qty, expiry date, status (active/quarantine/recalled/destroyed).
- **`inventory_levels`** — on-hand by (`item_source_id`/`variant_source_id`, `lot_id`, `location`)
  — the **sellable truth** once the register owns selling.
- **`inventory_adjustments`** — qty delta, **reason code** (shrink/damage/sample/destruction/count),
  `lot_id`, `actor_id` — auditable + CCRS-reportable.
- **`lab_results`** — COA data incl. **`labtest_external_identifier`** (CCRS Manifest column),
  potency, terpenes, pass/fail, lab name, tested date.
- **`inbound_manifests`** — manifest number, `vendor_id`, transfer date, raw payload; lots link back.

### Cash
- **`cash_drawers`** — physical drawer/register definitions.
- **`cash_movements`** — paid-in/paid-out/drop/skim, `session_id`, amount, reason, actor.
- **`deposits`** — bank/vault deposit records with amounts + reconciliation.

### Compliance & control
- **`compliance_reports`** — CCRS export jobs: `report_type` (sales/inventory/manifest/harvest),
  period, status, generated file ref, submitted_at.
- **`approval_requests`** — manager approvals for discount overrides/voids/returns/price changes:
  `requested_by`, `approved_by?`, `type`, `context_json`, status.

### Config
- Reuse **`site_settings`** for: WA excise/sales tax rates, purchase-limit equivalencies, register
  defaults, receipt header/footer, low-stock thresholds.

---

## D. KPI → data-source mapping (so every metric is computable)

| KPI group | Computed from |
|---|---|
| Daily/Monthly Sales, TSR, ATV, Sales by Category, SGR, Conversion | `transactions` + `transaction_lines` + `menu_items.category` |
| Gross Margin, Net Profit, EBITDA, BEP | `transaction_lines` (price) − `inventory_lots`/`receiving_lines` (cost) + `operational costs` config |
| Cash Flow, cash variance | `register_sessions`, `cash_movements`, `deposits` |
| Inventory Turnover, Product Age, Stock-out Freq, Shrinkage, Carrying Cost | `inventory_levels` + `inventory_adjustments` + `inventory_lots` + sales velocity |
| CLV, CRR, New Customer Acq, Loyalty Participation | `customers` + `transactions` + `loyalty_signups` |
| Return Rate, Recall Freq, Compliance Incident, Batch Testing | `transactions(type=return)`, `inventory_lots(status)`, `lab_results`, `compliance_reports` |
| Avg Transaction Time, Employee Productivity | `transactions` timestamps + `cashier_id` |
| Marketing ROI, Email Open, Social Engagement | `newsletter_sends` + external (later) |
| Security/safety (CCTV, incidents, theft loss) | `inventory_adjustments(reason=theft)` + incident records (later) |

> Any KPI without a real source is **not shown** until its source exists. No invented numbers.

---

## E. Migration sequencing note

New tables will be added in **numbered migrations continuing from 0021** (e.g., `0022_pos_customers.sql`,
`0023_pos_inventory_lots.sql`, …), one cohesive migration per slice, **idempotent** and **owner-applied**.
RLS staff-only for all POS internals; `audit_logs` triggers/writes for sensitive mutations.
