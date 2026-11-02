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

**Consequence in code:** every loyalty price reduction (a 10% / 25% reward,
D137) is clamped per unit to
`max(statutory 1¢ cannabis floor, ceil(acquisition_cost × tax divisor))` — the
same floors the promotions engine enforces (`order-pricing-core.ts`,
`cart-discount.ts`). Never-discount items are excluded (D140).

### 1.2 Retailer-funded only (money's worth)

- **LCB Enforcement Bulletin 23-01:** producers/processors may NOT fund,
  negotiate, or participate in retailer discounts, incentive programs, or
  rebates. The loyalty program must be funded 100% by the retailer.

**Consequence:** the program has no vendor-funded mechanics anywhere; the
10% / 25% rewards come out of Greenway margin only. The AI advisor's
system prompt states this so it never suggests vendor-funded loyalty deals.

### 1.3 Equal availability

- The CCRS discount rule requires the discount to be "available to all who
  meet the discount conditions." A loyalty program qualifies because
  enrollment is open to any 21+ customer on equal terms and the reward
  thresholds (150 / 300 points) are objective and the same for everyone.

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

**Superseded rules, owner message 2026-11-02 (D137–D141).** *"yes, one redemption
per sale, and works exactly as you described in the proposed fix. no dollar cap
on the 25% off. bronze and gold stay as names only … the $0.10-per-point should
be retired"*. The pure rules live in `src/lib/loyalty/loyalty-reward-core.ts`
(57 self-tests).

1. **Two fixed rewards.** 150 points = 10% off, 300 points = 25% off. Exactly
   those points are deducted, never the whole balance. Points have **no cash
   value**; `loyalty_config.point_value_minor` and `min_redeem_points` and
   `loyalty_tiers.discount_bps` are retired and ignored (no migration).
2. **Best deal wins, never both, per item.** For each line the engine compares
   the promotion price with the reward-percent-off-REGULAR price and keeps the
   LOWER (`applyTierPricing`). On a tie the promotion is kept. If no line gets
   cheaper the reward is refused and no points are used.
3. **Floors.** Every unit is clamped to its legal floor (§1.1).
4. **One reward per sale, no dollar cap.** The server refuses a second reward or
   a reward together with a special discount.
5. **Badges are names only.** Bronze (150+ lifetime) and Gold (300+) give no
   discount; the owner renames them (`renameLoyaltyTierAction`, audited).
6. **Old-style points codes** (issued with a dollar value) are refused with
   instructions to cancel them on the profile, which returns the points.

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
- **Cancel / no-show:** a code the customer brought is RELEASED back to
  `issued` (they keep it); a code the register or order page issued for that
  sale is cancelled and its points returned (D141).
- **Void (D141):** a full void cancels the used reward code once (conditional
  update) and returns exactly its points (`returnRewardForVoidedOrder`).
- **Cancel an open code (D141):** Cancel & return points on the profile
  (`cancelRedemption`, audited `loyalty.reward_code.cancel`). Best-effort, never blocks the
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

- enrollment, 90-day active accounts, points earned/used (30d), members who
  can use a reward now (10% / 25%), rewards used (10% / 25%, 30d), codes
  outstanding and expired, amount taken off by rewards (90d), average days from
  issue to use, badge distribution, and member vs. guest average order value.
  No dollar liability (points have no cash value, D138).
- A DRAFTS-ONLY AI advisor (same pattern as the Promotions advisor) reads
  ONLY those aggregates — never customer PII or raw rows — and returns a
  briefing: what needs attention, what's healthy, retention ideas, next steps.
  Advisory only; it never changes the program.

## 5. Owner runbook

1. Apply migration `0116_loyalty_at_sale.sql` in the Supabase SQL editor.
2. Set points per dollar, signup bonus, code expiry, badge names and earn promos in `/admin/loyalty`. The rewards (150 = 10%, 300 = 25%) are fixed by the owner (D137).
3. Register flow: open the order → Loyalty section → enter the customer's
   code or apply member pricing → complete the sale as usual. The section
   explains every rule inline.

## 6. Signing up at the register (register-loyalty-signup)

The register can sign a new customer up (`/api/pos/loyalty-signup`, SOP-01 §4.12a; slice doc `docs/slice-register-loyalty-signup.md`).

- **Age.** The birthday comes from the sale's passing ID check and must be 21 or older on the Pacific calendar (RCW 69.50.357).
- **Messages.** Consent is optional, starts unchecked and is never a condition of joining or buying. Saying yes shows the published `loyalty.form.consent_text` wording, and the customer types their name as the signature (47 CFR 64.1200(f)(9) prior express written consent; an electronic signature counts). The server refuses if the wording the customer saw is not the published wording (SHA-256 compare). The row keeps the wording and its hash.
- **A "no" stays a no.** Register signups that said no are stored with `consent = false`, so the newsletter never emails them. Linking an existing customer never removes an earlier signed yes and never overrides `do_not_contact`.
- **Signup bonus.** The bonus is loyalty points, the same as a website signup (`enrollCustomer`). Points are used only for a 10% / 25% reward at a sale, so the cost floor in §1.1 still applies when they are spent.

