# Loyalty Program — Compliance & Sale-Side Design (Task S-a)

This document records the VERIFIED regulatory ground truth behind Greenway's
loyalty program and the design decisions for how loyalty value is applied at
the point of sale. Scraped/verified July 2026 against current sources — never
guessed.

---

## 1. Verified ground truth

### 1.1 Loyalty discounts are still discounts (cost floor applies)

- **CCRS Upload User Guide (June 2025), Sale.csv "Discount":** a discount
  "must be available to all who meet the discount conditions and may not
  discount the sale price below the cost of acquisition."
- **WAC 314-55-155(5)(g)** (advertising/promotions, current through WSR
  26-12-082): "Coupons may not discount the price of a product below the
  retailer's acquisition cost." A loyalty redemption code functions as a
  coupon — the same floor applies.
- **RCW 69.50.357:** a retailer may not sell usable cannabis, concentrates, or
  cannabis-infused products below the cost of acquisition, and may never give
  cannabis away free. Violations run $1,000 each.

**Consequence in code:** every loyalty price reduction (tier discount or
redemption code) is clamped per unit to
`max(statutory 1¢ cannabis floor, ceil(acquisition_cost × tax divisor))` — the
same floors the promotions engine enforces (`order-pricing-core.ts`,
`cart-discount.ts`). A redemption code can only be applied when the cart can
absorb its FULL value above those floors.

### 1.2 Retailer-funded only (money's worth)

- **LCB Enforcement Bulletin 23-01:** producers/processors may NOT fund,
  negotiate, or participate in retailer discounts, incentive programs, or
  rebates. The loyalty program must be funded 100% by the retailer.

**Consequence:** the program has no vendor-funded mechanics anywhere; point
value and tier discounts come out of Greenway margin only. The AI advisor's
system prompt states this so it never suggests vendor-funded loyalty deals.

### 1.3 Equal availability

- The CCRS discount rule requires the discount to be "available to all who
  meet the discount conditions." A loyalty program qualifies because
  enrollment is open to any 21+ customer on equal terms and tier thresholds
  are objective (lifetime points).

### 1.4 Taxes

- Cannabis card prices are tax-INCLUSIVE (37% excise RCW 69.50.535 + 9.3%
  sales; divisor 1.463; merch divisor 1.093). Excise is owed on the ACTUAL
  selling price, so loyalty reductions are embedded in the line unit prices
  and the pre-tax subtotal is backed out from the reduced prices — the
  standard `computeOrderTotals` math. No special-case tax handling exists.
- Points accrue on the PRE-TAX subtotal AFTER all discounts (points reflect
  what the customer actually paid, industry standard).

---

## 2. Sale-side policy (owner directive)

> "No discount stacking, better discount wins for the customer with respect
> to loyalty points getting used."

1. **Tier standing discount vs. promotion — best deal wins, never both.**
   For each line, the engine compares the promotion-discounted unit price with
   the tier-discounted-from-REGULAR unit price and keeps whichever is LOWER
   (better for the customer). A line never receives both. On a tie the
   promotion label is kept.
2. **Redemption codes are stored value, not a stackable percent.** Points were
   already deducted when the code was issued (the code is a wallet). The code
   value is spread across the cart's units evenly (capacity-weighted, whole
   cents) after promo/tier pricing, and each unit is still clamped to its
   floor. If the cart cannot absorb the full value above the floors, the code
   is refused with the exact absorbable amount so staff can add items or use a
   smaller code — value is never silently forfeited.
3. **One code per order.** Applying a second code requires removing the first.
4. **Member pricing before code.** If a code is already applied, tier pricing
   changes are blocked until the code is removed (prevents ordering games).

## 3. Lifecycle & integrity

- **Apply (register):** staff enters the customer's `GW-XXXX-XXXX` code on the
  order detail page. The code is consumed ATOMICALLY (conditional update on
  `status='issued'` — two registers can't both win), the lines are re-written
  with the spread, totals recomputed, `orders.loyalty_*` columns and
  `customer_id` set, and an order event + audit row recorded.
- **Remove (register, open order):** line prices restored from the per-line
  `loyalty_discount_minor_units` snapshot, the redemption row conditionally
  returned to `issued`, order columns cleared, event + audit recorded.
- **Completion gate:** an order carrying a loyalty code may only complete if
  the redemption row is `redeemed` AND `redeemed_order_id` matches the order —
  otherwise completion is blocked with instructions (defense in depth against
  reopened/cancelled-order drift).
- **Cancel / no-show:** the code is automatically RELEASED back to `issued`
  (the sale never happened; the customer keeps their stored value). Points
  stay deducted because the code still exists. Best-effort, never blocks the
  transition, always logged as an order event.
- **Earn:** unchanged — accrual runs once per order on completion
  (idempotent ledger `kind='earn'`), now on the post-discount pre-tax
  subtotal, for the linked `customer_id`.
- The money completion gate (`verifyStoredOrderForCompletion`) needs NO
  changes: loyalty value lives in the line unit prices, so the recomputed
  totals match the header exactly like any promo.

## 4. Metrics & AI insight (back office)

`/admin/loyalty` is a command center showing program health computed from the
ledger/redemptions/orders (all aggregates):

- enrollment, 90-day active accounts, points earned/redeemed (30d),
  redemption rate, outstanding point liability in dollars, codes outstanding
  and expired, average days from issue to use, tier distribution, and member
  vs. guest average order value.
- A DRAFTS-ONLY AI advisor (same pattern as the Promotions advisor) reads
  ONLY those aggregates — never customer PII or raw rows — and returns a
  briefing: what needs attention, what's healthy, retention ideas, next steps.
  Advisory only; it never changes the program.

## 5. Owner runbook

1. Apply migration `0116_loyalty_at_sale.sql` in the Supabase SQL editor.
2. Set point value / tiers / earn promos in `/admin/loyalty` (unchanged).
3. Register flow: open the order → Loyalty section → enter the customer's
   code or apply member pricing → complete the sale as usual. The section
   explains every rule inline.
