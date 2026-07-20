# Chapter 06 — Loyalty & Members (points, tiers, codes, and the two legal floors)

> **Status:** COMPLETE (traced line-by-line against main @ `9a63c8b1`)
> **Primary files:**
> `src/lib/loyalty/engine.ts` (pure math: earn, tiers, promotions, code generation, redeem gating)
> `src/lib/loyalty/loyalty-store.ts` (accounts, THE LEDGER, redemption codes — Slice 27, S-20 race fixes)
> `src/lib/loyalty/loyalty-sale-core.ts` (Task S-a pure: legal floors, tier best-deal-wins, code value spread)
> `src/lib/loyalty/loyalty-sale-store.ts` (applying/removing loyalty on an ORDER; code release on cancel)
> `src/lib/pos/register-loyalty-core.ts` (Task AM-B pure: cart fingerprint, apply spread on device)
> `src/app/api/pos/loyalty/route.ts` (register redemption: redeem-points / apply-code / release)
> `src/app/api/pos/member/route.ts` (B14 member lookup) · `member-match/route.ts` (AO-3 scan-to-member) · `member-history/route.ts` (B29)
> `src/lib/pos/sale-event-core.ts` + `src/lib/pos/sync-store.ts` (loyalty blocks in the sale payload; sync-time claim)
> `src/lib/orders/orders-store.ts` (completion accrual; code release on cancel/no-show)
> `src/lib/loyalty/signup.ts` / `signups-store.ts` / `signup-customer-core.ts` (website signups → customer records)

Loyalty is where marketing meets two hard laws: **RCW 69.50.357** (cannabis may
never be given away — every unit price must stay above zero) and
**WAC 314-55-155(5)(g)** (never sell below acquisition cost). Every discount
this program hands out is clamped to those floors by the same pure math,
whether it's applied in the back office or on the iPad. The owner's one
program rule, stated in the code headers: **no discount stacking — the better
discount wins for the customer.**

---

## 1. The pure engine (engine.ts) — how points are earned and valued

- **Earning is PRETAX**: `basePointsForSubtotal` (engine.ts:43) floors
  `subtotal dollars × pointsPerDollar` — fractional points are never granted,
  tax never earns points (owner directive in the module header).
- **Promotions** (`isPromotionLive`, engine.ts:53) support date windows and
  daily happy-hour windows in **Pacific hours**, including wrap-around windows
  (22→2). `earnedPoints` (engine.ts:76) applies the **single best-yield** live
  promotion (multiplier + flat bonus) — promotions never stack with each other
  either.
- **Tiers** (`tierForPoints`, engine.ts:98): highest tier whose `minPoints`
  the account meets; each grants a standing `discountBps`.
- **Redemption codes** (`generateRedemptionCode`, engine.ts:129):
  `GW-XXXX-XXXX` from an unambiguous alphabet (no O/0/I/1). `canRedeem`
  (engine.ts:119) gates on balance ≥ requested AND balance ≥
  `minRedeemPoints`. `pointsValueMinor` (engine.ts:114) converts points to
  cents (`pointValueMinor` per point, default 1¢).
- Program knobs live in the `loyalty_config` DB row (defaults at
  loyalty-store.ts:68: 1 pt/$1, 1¢/pt, 100-pt minimum, no signup bonus, no
  code expiry).

---

## 2. The ledger is the source of truth (loyalty-store.ts)

Every point movement is a `loyalty_ledger` row (kinds seen in code: `earn`,
`redeem`, `adjust`, `signup_bonus`). The cached `loyalty_accounts.balance_points`
/ `lifetime_points` are **recomputed from the whole ledger after every write**
(`applyLedger`, loyalty-store.ts:189) — the S-20 race fix documented inline:
the old read-modify-write could lose one of two concurrent updates; the
recompute converges because the last writer sums a ledger that already
contains every inserted row. Self-healing. Lifetime = sum of positive rows
only; the account's tier is re-derived from lifetime on every write.

Key operations:

- **`accrueForOrder`** (loyalty-store.ts:250) — earn on a completed order's
  PRETAX subtotal. **Idempotent per order**: skips if an `earn` row already
  references the order. Auto-enrolls the customer (`enrollCustomer`,
  loyalty-store.ts:155, which pays the configured signup bonus once). The
  Pacific hour for happy-hour promos comes from `pacificParts`.
- **`adjustPoints`** (loyalty-store.ts:300) — signed manual adjustment; the
  optional `orderId` is what lets the B16 return clawback and the B27 void
  clawback stay **cumulative-safe** (ch.05: they subtract prior negative
  adjust rows for the order before clawing more).
- **`issueRedemption`** (loyalty-store.ts:323) — checks `canRedeem`, generates
  a unique code (6 collision retries), inserts the redemption row
  `status='issued'`, and **deducts the points immediately** (a negative
  `redeem` ledger row) — the value now lives in the code.
- **`lookupRedeemableCode`** (loyalty-store.ts:402) — only `issued` codes; an
  expired code is flipped to `expired` on read and returns null.
- **`markRedemptionUsed`** (loyalty-store.ts:421) — the **atomic claim**: the
  update is CONDITIONAL on `status='issued'` (second S-20 race fix), so two
  registers presenting the same code at once cannot both win; the loser's
  update matches zero rows and is refused with "it can only be redeemed once."

**Where accrual actually fires:** `setOrderStatus` on the completed transition
(orders-store.ts:383–398) — for EVERY completion path (register sync, pickup
handover, back office), on the post-discount subtotal ("points reflect what
the customer actually paid"), best-effort (accrual failure never blocks the
sale). The mirror rule: on `cancelled`/`no_show`, `releaseLoyaltyCodeForOrder`
returns any consumed code to the customer (orders-store.ts:353–364;
loyalty-sale-store.ts:444) — "the sale never happened, so their stored value
must survive."

---

## 3. The two legal floors (loyalty-sale-core.ts) — no discount may cross them

`loyaltyUnitFloor` (loyalty-sale-core.ts:53) computes the lowest legal unit
price for a line:

- **Statutory floor**: cannabis lines never go below
  `MIN_CANNABIS_UNIT_PRICE_MINOR` (1¢ — RCW 69.50.357, "never free").
- **Cost floor**: when the acquisition cost is known, the tax-inclusive floor
  is `ceil(cost × category divisor)` (WAC 314-55-155(5)(g)), capped at the
  regular price (a regular price already at/below cost is a pricing problem
  for the below-cost audit — loyalty simply refuses to discount further).
- Costs resolve **variant-first** (`lotKeyForSaleLine`, Mastering Slice 1) so
  a size on a mastered card uses ITS OWN lot's cost.

Two appliers sit on those floors:

- **`applyTierPricing`** (loyalty-sale-core.ts:94) — per-line
  **best-deal-wins**: the customer gets the LOWER of the current
  (promo-discounted) price and the tier percent off the REGULAR price — never
  both compounded. Tier bps clamped below 100%. Ties keep the existing price
  (promo label preserved).
- **`spreadCodeValue`** (loyalty-sale-core.ts:170) — spreads a code's stored
  value across lines as whole-cent per-unit reductions: proportional-by-
  capacity first pass, then a greedy remainder pass visiting single-unit lines
  LAST so the final cents land where they fit exactly. **The cart must absorb
  the full value** (minus at most a penny-split remainder): otherwise the
  spread refuses with the exact absorbable amount — "value is never silently
  forfeited" (staff add items or issue a smaller code).
- **`checkLoyaltyCodeForCompletion`** (loyalty-sale-core.ts:246) — the
  completion gate's defense-in-depth (ch.02 §7): an order claiming a code may
  only complete while the redemption row is `redeemed` **by this order** —
  catches reopened-order drift and codes released/re-used elsewhere.

---

## 4. Applying loyalty to an ORDER (loyalty-sale-store.ts)

Both appliers enforce, in order: order must be OPEN
(new/acknowledged/preparing/ready), **only ONE loyalty application per order**
(a set `loyalty_kind` refuses with the no-stacking message), and lines must
exist. Migration 0116 added the loyalty columns; missing-column errors
(42703) return "Migration 0116 … has not been applied yet."

- **`applyCodeToOrder`** (loyalty-sale-store.ts:136): looks up the code,
  spreads the value (floors enforced), then **atomically claims** it via
  `markRedemptionUsed` BEFORE touching prices. Line updates carry a per-line
  snapshot (`loyalty_discount_minor_units`); any write failure restores the
  already-written lines to their ORIGINAL prices, releases the claim
  (conditional on `redeemed` + this order), and refuses. Header totals are
  recomputed with the same `computeOrderTotals` the money gate uses. A
  penny-split remainder is reported on the order timeline ("returned unused").
- **`applyTierToOrder`** (loyalty-sale-store.ts:266): requires an enrolled,
  active account with a discount-bearing tier; refuses (correctly, with the
  no-stacking explanation) when promo prices already beat tier pricing on
  every line. Same write-and-rollback discipline; header stamps
  `loyalty_kind='tier'` + the tier label.
- **`removeLoyaltyFromOrder`** (loyalty-sale-store.ts:371): restores each line
  from its per-unit snapshot (price + reduction), clears the header, and
  releases a code back to `issued` — conditionally, and if the auto-release
  fails the timeline says so LOUDLY ("check it on the customer's profile").
- **`releaseLoyaltyCodeForOrder`** (loyalty-sale-store.ts:444): the
  cancel/no-show hook — conditional release + a timeline note; silent no-op
  pre-0116.

---

## 5. Loyalty at the REGISTER (AM-B + B14 + AO-3 + B29)

### 5.1 Member attach (B14) — privacy budget

`GET /api/pos/member?q=` (member/route.ts) searches customers with the same
matcher the back office uses and returns ONLY: `customerId`, a privacy-lean
label ("Jane D."), `points`, `tierName`. Deliberately never returned:
birthdate, contact details, notes — "the response may sit in device memory."
**Online-only by design**: attaching a member offline would mean caching the
customer book on an iPad. An offline register still rings the sale — just
without the member.

`POST /api/pos/member-match` (AO-3) automates the attach after a PASSING ID
scan: server pulls the (tiny) pool of customers sharing the scanned birthdate
and the pure matcher (`matchScannedCustomer`, member-match-core.ts:116)
answers match/ambiguous/none — an ambiguous result attaches NOTHING (humans
disambiguate via manual lookup). Nothing about the scan is stored; the
response carries the same B14 privacy budget.

`GET /api/pos/member-history` (B29) shows the attached member's last few
completed orders + favorites — same budget (no contact details, no DOB), and
the customerId must have come from the register's own member lookup.

### 5.2 Redeeming at the register (AM-B)

`POST /api/pos/loyalty` (loyalty/route.ts), device-authenticated, three
actions:

- **`redeem-points`** — the attached member spends points NOW. The server
  sizes the redemption to what the CURRENT cart can legally absorb (tries the
  full balance; shrinks to the absorbable value; never below the program
  minimum), **issues** the code (points deducted, `status='issued'`), and
  returns the per-variant spread computed with the SAME `spreadCodeValue` +
  floors (acquisition costs live server-side only — the device could never
  compute the floors).
- **`apply-code`** — a customer-brought GW code: looked up and spread but
  **NOT claimed** — the atomic claim happens at sync against the materialized
  order, exactly like the back-office path. Insufficient capacity refuses
  with the absorbable amount ("value is never partially burned").
- **`release`** — the register dropped the discount (cart changed / sale
  abandoned): a points-issued code is CANCELLED (conditional on still
  `issued`) and the points refunded via `adjustPoints`; a customer-brought
  code needs nothing (it was never claimed).

On the device, `register-loyalty-core.ts` (pure) applies the spread:

- `pricingFingerprint` (register-loyalty-core.ts:108) captures line identity
  + quantity + pre-loyalty price, sorted. **Any cart drift (add, remove,
  quantity, reprice, override) changes the fingerprint, and a changed
  fingerprint means the register must DROP the discount and release the
  code** — a stale spread is never shipped.
- `applyLoyaltyToPricedLines` (register-loyalty-core.ts:144) subtracts the
  per-variant reductions with a defensive clamp (never below 1¢ even if the
  response were corrupted) and recomputes totals with the SAME
  `computeOrderTotals` the sync gate re-verifies.

### 5.3 What rides the sale payload, and what sync does with it

`validateSalePayload` (sale-event-core.ts) enforces coherence offline-safe:

- Optional `loyalty` block (customerId UUID + memberLabel ≤80 chars) — the
  member attach (sale-event-core.ts:466+).
- Optional `loyaltyRedemption` block (redemptionId, code, appliedMinor):
  `appliedMinor` MUST equal Σ per-line `loyaltyDiscountMinor` × quantity, and
  per-line reductions WITHOUT the block are refused as "orphaned discount"
  (sale-event-core.ts:480–520).

At sync (`processSale`, sync-store.ts):

- The attached customer MUST still resolve (sync-store.ts:438–452) — a
  dangling id is an **exception**, never a silent anonymous completion ("that
  would quietly lose the customer's points"). On a medical sale the
  recognition-card holder is authoritative; a member≠cardholder mismatch is
  an exception ("points would land on the wrong person").
- The redemption row is resolved BEFORE the order is materialized
  (sync-store.ts:471–506): must exist, code must match, must still be
  `issued`, and must be worth at least `appliedMinor` — each failure is a
  reasoned exception.
- The member is linked to the order BEFORE completion so the EXISTING accrual
  earns the points (sync-store.ts:644–662).
- The **atomic claim** happens against the materialized order
  (sync-store.ts:670–683, conditional update); if the 0116 header write then
  fails, the claim is RELEASED before raising the exception — "never strand a
  consumed code on an order that can't record it" (sync-store.ts:697–706).
- The completion gate's `checkLoyaltyCodeForCompletion` then re-verifies the
  claim as the final defense (ch.02 §7).

The earn side needs no special register handling at all: completion accrual
(§2) fires on `orders.customer_id`, exactly as for website orders.

---

## 6. Signups (website → customer records)

- `parseLoyaltySignup` (signup.ts:50) validates the public form (21+
  birthday, phone ≥10 digits, valid email, consent + typed signature
  required) with a honeypot `company` field that silently rejects bots.
  `storeLoyaltySignup` emails the owner via Resend (status degrades to
  `email-not-configured` / `email-failed`, never throws) and the API route
  persists via `createLoyaltySignup` (signups-store.ts:86).
- Staff work the queue (statuses `new → entered / duplicate / archived`,
  signups-store.ts:21). Marking "entered" triggers Task V's
  `connectSignupToCustomer` (signup-customer-store.ts:73): the pure core
  (signup-customer-core.ts) maps signup fields to a NEW customer or picks an
  existing match — **phone+email > phone > email** (`pickExistingCustomer`,
  signup-customer-core.ts:141) — and patches conservatively
  (`buildLinkPatch`: fill gaps only). Consent rules are deliberate:
  marketing consent comes from the checkbox but is REVOKED by an email
  unsubscribe, and an existing `do_not_contact` flag is NEVER overridden.
- `unsubscribeByToken` (signups-store.ts:362): secret-token unsubscribe, no
  login, idempotent.

---

## 7. What SHOULD never happen (the owner's watchlist)

1. **A free (or below-cost) cannabis item via loyalty.** Every reduced unit
   price is clamped to the statutory 1¢ floor AND the acquisition-cost floor
   (RCW 69.50.357; WAC 314-55-155(5)(g)) — by the server. A cart at the floor
   refuses the discount, it never partially applies.
2. **Stacked discounts.** One loyalty application per order (tier OR code);
   tier pricing is per-line best-deal-wins against the promo price, never
   compounded; only the single best promotion multiplies earnings.
3. **The same code redeemed twice** — two registers, or register + back
   office. The claim is a conditional single-row update; the loser is told
   the code was just used.
4. **Points deducted with no code, or a code consumed by an order that never
   completed.** Issuance deducts points into the code; release/cancel/no-show
   paths return the value; the completion gate refuses an order whose claimed
   code isn't consumed by that exact order.
5. **Value silently burned.** A cart that can't absorb a code's full value
   refuses with the absorbable dollar amount; penny-split remainders are
   reported on the order timeline as returned unused.
6. **A stale spread shipped after the cart changed.** The pricing fingerprint
   must drop the discount (and release a points-issued code) on ANY cart
   drift.
7. **Points earned on tax**, or earned twice for one order (idempotent per
   order), or fractional points granted.
8. **Points landing on the wrong person.** A dangling attached customer or a
   member≠medical-cardholder mismatch must become a sync exception, never a
   silent completion.
9. **The cached balance drifting from the ledger.** Balance/lifetime/tier are
   recomputed from the ledger on every write; if a balance ever looks wrong,
   the ledger is the truth to audit against.
10. **Loyalty surviving a reversal.** Voids claw back the full earn; returns
    claw back proportionally; both cumulative-safe (ch.05).
11. **The register learning more than label/points/tier** about a member —
    no DOB, no contact info, no notes on the device, ever. Ambiguous scan
    matches attach nothing.
12. **An offline register redeeming points.** Loyalty needs the live balance
    and live cost floors; offline it degrades to ringing the sale without
    the discount.
13. **A signup overriding do-not-contact**, or marketing consent surviving an
    unsubscribe.

---

## 8. Findings from this chapter

No new findings. Two design notes worth recording for later passes:

- `applyLedger`'s recompute-from-ledger converges under concurrency but reads
  the ENTIRE ledger per write; fine at one store's volume, worth a look in
  the load/concurrency pass (lens 6) if ledgers grow to many thousands of
  rows per account.
- Register redemption issues the code BEFORE the sale syncs (by design, so
  the value is reserved). If a device dies between issuance and sync and the
  register never sends `release`, the points sit in an `issued` code on the
  member's profile — visible to staff, recoverable manually, and bounded by
  the optional code expiry. Acceptable posture; the ops runbook (TEST-PLAN)
  should include "customer says points vanished" → check issued codes on the
  profile.
