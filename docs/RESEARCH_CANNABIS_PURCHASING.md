# Research — Cannabis Retail Purchasing & Inventory (authoritative findings)

> Purpose: ground the Create-New-Purchase-Order overhaul (`/admin/purchasing/new`)
> in verified industry practice, specifically for a WA I-502 cannabis retailer.
> Standing rule: NEVER guess. Everything below is sourced; formulas are stated
> exactly so the code can reproduce them. This is a reference doc — keep it.

---

## 1. Sources consulted

1. **Cova — "Dispensary Inventory Optimization" / dispensary inventory management
   guides.** Cova is a leading cannabis-specific POS. Findings: ABC analysis,
   par levels by category, sales velocity, safety stock, reorder points,
   MOQ handling, FIFO, batch/expiration tracking, inventory-turnover targets,
   and the retail KPI set (turnover, GMROI, sell-through, shrinkage).
2. **Northstar Financial — "Cannabis Dispensary Products: Category Mix, Margins
   & Inventory Turns."** Cannabis-specialist accounting firm. Findings: per-category
   gross-margin ranges, inventory-turn ranges, revenue-share norms, GMROI formula,
   and the 280E accessory carve-out.
3. **NetSuite — procurement KPI library.** Findings: PO accuracy, PO cycle time,
   supplier lead time, vendor late-delivery rate as the standard procurement scorecard.
4. **Mercury / general AP practice — three-way match.** Findings: PO ↔ receiving ↔
   invoice reconciliation is the control standard before paying a vendor.

(These were scraped/read during research. If a figure is used in the UI it is
labelled as a benchmark/guidance range, never presented as this store's actual data.)

---

## 2. Core inventory formulas (used by the reorder engine)

The existing engine (`src/lib/purchasing/po-core.ts`) already implements the
industry-standard reorder math; documenting it here so the UI copy matches:

- **Average daily sales** = units sold in the velocity window ÷ window days.
- **Safety stock** = average daily sales × safety-stock days (buffer for demand
  spikes and lead-time variability).
- **Reorder point (ROP)** = (average daily sales × lead-time days) + safety stock.
  → When on-hand ≤ ROP, it's time to reorder.
- **Suggested order qty** ≈ enough to reach the target days-of-supply, i.e.
  target coverage minus what's on hand (never negative).
- **Days of supply left** = on-hand ÷ average daily sales.

Default planning parameters (Cova-aligned, editable in Reorder settings):
velocity window **30 days**, lead time **7 days**, target days of supply **21 days**,
safety stock **7 days**.

---

## 3. Cannabis category benchmarks (Northstar)

These are **industry benchmark ranges**, shown in the UI as *guidance only* to help
the purchasing manager sanity-check a category's weight in an order. They are NOT
this store's numbers.

| Category      | Gross margin | Inventory turns / yr | Typical revenue share |
|---------------|--------------|----------------------|-----------------------|
| Flower        | 40–50%       | 12–18 (fastest)      | 35–50%                |
| Pre-rolls     | 48–58%       | 8–14                 | —                     |
| Vape          | 55–65%       | 8–12                 | —                     |
| Concentrates  | 45–65%       | 6–10                 | —                     |
| Edibles       | 50–60%       | 4–8                  | —                     |
| Topicals      | 55–65%       | 3–6 (slowest)        | —                     |
| Accessories   | 60–70%       | varies (non-280E)    | —                     |

Key takeaways for purchasing:
- **Flower turns fastest** → order more frequently, smaller safety buffer OK, but
  never stock out (it drives foot traffic).
- **Topicals/edibles turn slowly** → order conservatively; watch expiration.
- **Accessories are not inventory of a controlled substance** → not subject to
  280E, higher margin, but don't over-index vs. cannabis SKUs.
- **GMROI = gross profit ÷ average inventory cost.** Northstar's headline KPI:
  measures dollars of margin earned per dollar of inventory carried. Flower and
  vape usually win on GMROI because of the turn velocity.

---

## 4. Cannabis-specific purchasing considerations (Cova + WA I-502 / CCRS)

- **Batch / lot tracking is mandatory.** WA CCRS traceability means every unit
  received ties to a source batch/lot and a manifest. Receiving (not PO creation)
  is where lot + COA data is captured, but the PO should reference expected
  product/brand/category so receiving can match against it.
- **Expiration & FIFO.** Edibles and some concentrates carry expiration; rotate
  first-in-first-out. Slow categories should be ordered in smaller lots.
- **Compliance limits.** All purchases are WSLCB-licensed producer/processor →
  retailer. The PO's vendor must be a licensed vendor; the back office already
  stores `license_number` on vendors.
- **MOQ / case packs.** Producers often sell in case/unit multiples; the manager
  needs a free-hand quantity field (already present) to honor MOQ.
- **Potency/unit-size context.** Useful *reference* on a line (e.g. "3.5g",
  "100mg 10-pack") but must come from real product data — never fabricated.

---

## 5. Procurement scorecard (NetSuite) + AP control (Mercury)

Standard PO lifecycle & controls this workflow should support end-to-end:

1. **Draft** → build lines from reorder suggestions (velocity-driven).
2. **Send to vendor** → email the PO directly from the back office (Resend).
3. **Receive** → three-way match: PO ↔ receiving ↔ invoice, capture lot/COA.
4. **Pay** → Accounts Payable once matched.

Procurement KPIs worth surfacing later: PO cycle time, supplier lead time,
vendor late-delivery rate, PO accuracy (received vs. ordered).

---

## 6. How this shapes the `/admin/purchasing/new` overhaul

- **Guided, decluttered flow** instead of four equally-weighted stacked cards:
  1) *Describe / filter* (AI draft + manual filters, collapsed by default),
  2) *Review & build the order* (the suggestion table — the primary work),
  3) *Send* (vendor + email the PO directly).
- **Cannabis-first framing:** category chips/guidance grounded in §3; ROP/velocity
  explanation grounded in §2; batch/FIFO reminders grounded in §4.
- **Email in the pipeline:** capture `vendor_email` on the builder (auto-pulled
  from the selected vendor record) and offer "Save & send to vendor" so the PO
  goes out without a second trip to the detail page. Uses the existing
  `sendPurchaseOrderEmail` (Resend) infra. Falls back to "Save as draft" cleanly
  when no email is on file or Resend isn't configured.
- **On design tokens:** remove all hardcoded `text-stone-*` and raw borders;
  use the admin UI kit so it "looks and flows like a professional system."
- **Drafts-only rule:** every AI/auto quantity remains an editable default the
  manager confirms before saving.
