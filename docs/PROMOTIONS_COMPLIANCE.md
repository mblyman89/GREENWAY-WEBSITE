# Discounts & Promotions — compliance ground truth + engine design (Task R)

This document is the AI-reference and staff-reference ground truth for the
promotions command center (`/admin/promotions`). Every rule below was verified
against the primary source named next to it — never guessed.

---

## 1. Verified legal / CCRS ground truth

### 1.1 CCRS Upload User Guide (June 2025), Sale.csv `Discount` field — VERBATIM

> "Discount: No discounts are allowable for producers and processors.
> WAC 314-55-018. Discounts can only be offered at a retail sale. **The
> discount must be available to all who meet the discount conditions and may
> not discount the sale price below the cost of acquisition.**"

Field format: "price in US Dollars of the discount applied to the sale",
decimal, no `$`, no parentheses, **no negative values**.

Consequences implemented here:
1. **COST FLOOR (hard rule):** a discounted sale price may never fall below
   the product's **cost of acquisition**. Enforced in three layers (§3).
2. **Uniformity:** a discount must be available to ALL customers who meet the
   conditions. Our engines are deterministic — the same cart always produces
   the same price for every customer. "Store-advantaged" selection (§4) is a
   single uniform rule, not per-customer discretion.
3. **No negative discounts:** engines never produce a unit price above the
   regular price, so exported `Discount` values are always `>= 0`.

### 1.2 RCW 69.50.357 (scraped, current)

Retail outlets may not give cannabis away; sales must be "not less than the
cost of acquisition" (lockable-box donation clause); $1,000 fine per
violation. Already enforced as the positive price floor
(`clampCannabisUnitPrice`, `MIN_CANNABIS_UNIT_PRICE_MINOR = 1`) and the 99%
percent cap for cannabis lines. The cost floor (§3) strictly dominates it
whenever a cost is known.

### 1.3 WAC 314-55-018 (scraped, current)

Tied-house rule — producers/processors may not give retailers gifts,
discounts, or free product. This is the WAC the CCRS guide cites; it is why
"discounts can only be offered at a retail sale." No engine change needed —
we are the retailer — but AI copy must never advertise vendor-funded deals.

---

## 2. Money model recap (verified in `src/lib/orders/order-pricing-core.ts`)

- Card/menu prices are **tax-INCLUSIVE** out-the-door prices, minor units.
  - Cannabis: divisor **1.463** (37% excise + 9.3% sales) → pre-tax subtotal.
  - Non-cannabis (merch/accessories/paraphernalia): divisor **1.093**.
- Acquisition costs are **pre-tax** vendor costs, minor units:
  - Cannabis: `inventory_lots.unit_cost_minor_units` keyed by
    `pos_product_key` (weighted-average across lots — same method as the COGS
    report, `src/lib/reports/cogs.ts`).
  - Non-cannabis: `noncannabis_products.cost_minor_units`.

### The cost-floor conversion

"Sale price below the cost of acquisition" compares PRE-TAX sale revenue to
cost. Because our unit prices are tax-inclusive, the floor on the
tax-inclusive unit price is:

```
floorMinor = max(1, ceil(costMinorUnits × divisor(category)))
```

`ceil` (not `round`) so revenue can never round below cost — the
store-advantaged direction. When a product's cost is unknown the engines fall
back to the statutory positive floor only, and the below-cost audit (§3.3)
lists the product as "cost unknown" so the owner can fix the data.

---

## 3. The three enforcement layers (hard blocks)

### 3.1 Layer 1 — the pure engines clamp every mechanic

`EngineCartLine` / `DiscountCartLine` carry optional `costMinorUnits`.
Every mechanic — percent, fixed, qty/weight/spend tiers, BOGO, basket
top-item, basket N-for-M, either/or — clamps the discounted unit price to
`max(statutoryFloor, costFloor)`. Blended/spread mechanics clamp AFTER
blending, so no unit in a bundle can dip below its own cost.

### 3.2 Layer 2 — publish-time HARD BLOCK

Publishing a promotion runs the below-cost guard
(`src/lib/promotions/promo-guard.ts`): every affected product on the live
menu is checked at the promotion's **worst-case** (maximum) discount. If any
product would fall below its cost floor, the publish is **refused** — no
override — with the offending products listed. The owner excludes those
products or fixes prices/costs, then publishes.

Worst-case percent per mechanic (conservative — the largest discount the
mechanic can ever produce):
- percent → `discountPercent`; fixed → `discountFixed` against each price
- multi_item_tier / weight_tier / threshold_spend → the highest tier percent
- bogo → `getPercent` (a unit can be the discounted one)
- basket headline-item → `max(topPercent, restPercent)` (the engine puts the
  bigger percent on the LOWEST-priced eligible item — store-favorable, owner
  directive — so the guard assumes any product could receive it)
- basket N-for-M → `(n−m)/n × 100` (basket-wide equivalent)
- either/or → the **max** across both options (conservative; the runtime
  picks the store-advantaged option, but the guard assumes the worst)

### 3.3 Layer 3 — checkout final clamp + daily-deal audit

The server reprice (`order-pricing.ts`) attaches per-product costs to the
cart and the engine clamps as a last-resort guard (e.g. price edited after
publish). The command center shows a standing **below-cost audit panel** that
scans the live menu against ALL published promotions plus the seeded daily
deals, so drift (new cheap lot, price drop) surfaces the same day.

Edge note: if the last-resort clamp ever binds at checkout, the charged price
is HIGHER than the advertised sale price (never lower). The audit panel
exists precisely so this never happens in practice.

---

## 4. The owner's set-in-stone daily deals (Tuesday / Sunday specifics)

### Tuesday — Doobie Tuesday (UPDATED per owner, Task R)

> "20% off prerolls and blunts **or** buy 4 for the price of three mix and
> match … the logic needs to spread the discount across all products …
> designed to be advantageous for us rather than the customer."

Implemented as ONE uniform either/or rule (`config.eitherOr`):
- Option A: flat **20%** off every eligible line (applies from qty 1).
- Option B (qty ≥ 4): **4-for-3 mix & match** — for every full group of 4
  eligible units, the cheapest unit's price is the group's savings; total
  savings are spread across ALL eligible lines as an equivalent whole-number
  percent (floor — store-advantaged), so every unit keeps a positive,
  above-cost price.
- **Selection: the option with the SMALLER total savings wins** when both
  qualify (store-advantaged). If only one option yields savings, it applies.
  Deterministic and identical for every customer ⇒ satisfies "available to
  all who meet the discount conditions."

Eligible categories (unchanged): preroll, blunt, preroll-pack,
infused-preroll, infused-blunt, infused-preroll-pack.

### Sunday — Ice Cream Sunday (confirmed, unchanged mechanics)

> "3 for the price of 2, full store mix and match … lowest product price is
> the discounted amount split across the other items."

For every full group of 3 eligible units (storewide, merch excluded), the
cheapest unit's price is the group's savings; the total is converted to an
equivalent whole-number percent of the eligible basket (floor —
store-advantaged) and spread across every eligible line. No unit is ever free
and no unit goes below its cost floor. This matches the existing checkout
behaviour (`cart-discount.ts`, Sunday case) — verified, kept.

### Store-advantaged conventions (engine-wide)

- Percent spreads round DOWN to whole percents (`Math.floor`).
- Group counts round DOWN (`Math.floor(units / n)`).
- Cost floors round UP (`Math.ceil`).
- Tie between two promotions → the higher-priority one wins; equal savings
  never upgrades to a bigger discount.

---

## 5. NO discount stacking (hard block)

Owner directive: "No discount stacking." The engine's former opt-in stacking
is removed: `computePromotions` is strictly **best-deal-wins** — each line
receives exactly one promotion (the highest savings; priority breaks ties).
`config.stackable` is ignored everywhere, the simulator badge, the AI
mechanics schema and the builder no longer offer it. Legacy configs with
`stackable: true` are treated as false.

---

## 6. Engines map (who charges whom)

| Engine | File | Used by | Cost floor |
|---|---|---|---|
| Weekday cart engine | `src/lib/specials/cart-discount.ts` | client cart preview (`CartProvider`) + **server checkout reprice** (`order-pricing.ts`) | server passes costs; client preview clamps statutory floor only |
| Generic POS engine | `src/lib/promotions/discount-engine-core.ts` | admin **simulator** (with costs), future register | yes |
| Register helper | `src/lib/pos/auto-discount.ts` | (currently unimported) | yes (pre-tax prices ⇒ floor = cost directly) |

The daily-deal seeds (`daily-deal-seed.ts`) remain the zero-blank fallback
and the single source of truth for the set-in-stone weekly deals.

## 7. Command center surfaces

- `/admin/promotions` — stats, weekly strip, sortable/filterable promotions
  table (status/type/weekday/search/sort), conflicts panel, **below-cost
  audit panel**, AI advisor briefing (drafts-only, aggregates only).
- Builder (`/new`, `/[id]`) — full mechanics editor (tiers, BOGO, baskets,
  either/or), targeting/exclusions, schedule, AI copy writer + AI mechanics
  drafter (both drafts-only), live affected-products preview with cost-floor
  flags, publish hard-block.
- Simulator — same pure engine with real costs attached; shows floor hits.
