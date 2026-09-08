# Doobie Tuesday — Deep Recon and Fix Strategy

**Date:** 2026 session, topicals round
**Author:** Greenway Dev
**Status:** RECON COMPLETE — fix NOT yet applied, awaiting owner decision on §6
**Ground rule for this document:** every number below was produced by running the
real engine over the real seeded rule. Nothing here is estimated or remembered.
The probes are committed as `scripts/compliance/probe-doobie.ts` and
`scripts/compliance/probe-doobie-math.ts` so any claim can be re-run.

---

## 1. What the owner reported

Michael, testing sales on the register:

> Tuesdays deal is prerolls are 20% off, or buy 4 for the price of 3. But because
> my customers regularly buy many more than 4 prerolls, the deal has to apply all
> the way up to the legal limit they can buy. It correctly applies 20% to any
> preroll product, but it does not apply the buy 4 for the price of 3 when the
> 4th preroll is added to the cart. It does add it after adding 6 prerolls, but
> at that point it is applying the 4 for 3 on 6, so the average discount actually
> drops to 16% rather than going from 20 to 25 percent. And then even worse,
> after adding more than 7, the discount goes back to being 20% off for the whole
> cart of prerolls. It's really weird.

Intended behaviour, as stated by the owner:

> The tiers are, 1-3 prerolls are 20%, 4+ are 25% off. This should apply to any
> preroll including infused, blunts and packs.

## 2. Reproduction — the register was right

`scripts/compliance/probe-doobie.ts` runs `applyOnePromotion` (the live engine)
against the committed Tuesday rule, on identical $10.00 prerolls.

| qty | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **effective discount** | 20% | 20% | 20% | **20%** | 20% | **16%** | **14%** | 20% | 20% | 20% | 18% | 20% |

Every symptom reproduces exactly:

- the 4th preroll changes nothing (still 20%),
- at 6 it "kicks in" and the discount **falls** to 16%,
- at 7 it falls further to 14%,
- from 8 it "goes back" to 20%.

The result is identical whether the prerolls are one line at quantity 6 or six
separate lines, so this is not a line-merging problem.

**The owner's read of the register was correct in every particular, including
the 16% figure.** The only thing his description understates is the bottom of
the dip: at 7 prerolls the customer receives **14%**, the worst point on the
curve.

## 3. Root cause

One line, `src/lib/promotions/discount-engine-core.ts:370`:

```ts
else chosen = savingsA <= savingsB ? optionA : optionB;
```

`applyOnePromotion` intercepts any rule carrying an `eitherOr` config *before*
the `discountType` switch. It computes both options and deliberately keeps the
one that saves the customer **less**:

```ts
// Either/or overrides the base mechanic: flat % OR bundle N-for-M, whichever
// yields the SMALLER total savings when both qualify (store-advantaged).
```

So "20% off **or** 4 for 3" is implemented as **whichever is worse for the
customer**, not whichever is better. Two further mechanics turn that single
decision into the observed sawtooth.

### 3.1 Why the 4th preroll does nothing

At 4 identical units a true 4-for-3 is worth exactly 25%. The engine compares
25% against the flat 20%, takes the **smaller** saving, and applies 20%. The
tier is reachable, correctly computed, and then discarded every time. **The
4-for-3 option can only ever be chosen when it is worth less than 20%** — which
is precisely when it should not be chosen.

### 3.2 Why it "kicks in" at 6

`bundleSpreadDiscounts` converts the bundle into a basket-wide percent:

```ts
const percent = Math.min(99, Math.floor((targetSavings / eligibleTotal) * 100));
```

At 6 units, one full group of 4 frees one unit: 1/6 = 16.67%, floored to **16%**.
16% is smaller than 20%, so the bundle now wins the store-advantaged comparison.
The customer's discount *drops from 20% to 16% because they added a sixth
preroll*. At 7 units it is 1/7 = 14.28% → **14%**.

### 3.3 Why it reverts above 7

At 8 units two groups free two units: 2/8 = 25%, which is not smaller than 20%,
so the flat option wins again. The bundle only wins at quantities whose
`floor(q/4)/q` ratio falls below 20% — **q = 6, 7, 11** (and, but for the 20%
floor, 13, 14, 15, 19…). The result is a sawtooth rather than a tier.

### 3.4 Non-monotonic pricing

Adding a preroll can reduce the customer's total savings in absolute dollars:

| cart | discount | total saved |
|---|---|---|
| 5 × $10.00 | 20% | **$10.00** |
| 6 × $10.00 | 16% | **$9.60** |

The cart grew by $10 and the customer's savings went **down**. This is the
single hardest symptom to explain at the counter.

### 3.5 A mixed-price cart is worse still

Because the bundle frees the **cheapest** units and then spreads the saving as a
floored basket percent, a cheap item poisons the whole basket. Four prerolls
priced $2, $10, $10, $10:

- engine result: **6% off** the whole basket ($1.92 saved).
- owner's intent at 4+: 25%.

## 4. Blast radius — three implementations, one bug

The same store-advantaged pick is implemented **three times**. A fix must land
in all three or the register, the website cart, and the estimator will disagree.

| # | File | Role | Status |
|---|---|---|---|
| 1 | `src/lib/promotions/discount-engine-core.ts:355-372` | Canonical engine (register + published rules) | **has the bug** |
| 2 | `src/lib/specials/cart-discount.ts:227-285` | Website cart fallback path | **has the bug** (independent copy of the same arithmetic) |
| 3 | `src/lib/checkout/estimator-core.ts:330` | Tier nudges ("add 1 more to save") | **suppressed entirely**: `if (rule.config.eitherOr) continue;` |

Site 3 is a second-order consequence: because completing a bundle can never
increase savings today, the estimator was correctly told there is no nudge worth
showing. Once the tier actually pays 25%, that `continue` must go, or the cart
will stay silent about a real "add one more preroll" opportunity.

Supporting surfaces that carry the same assumption and need review, not
necessarily change:

- `src/lib/promotions/published-rules-core.ts:139` — DB-empty seed fallback.
- `src/lib/promotions/promo-guard-core.ts:78-84` — worst-case percent for the
  below-cost audit. **Checked and already correct at 25%** (see Phase 3);
  listed here only so the next reader does not have to re-check it.
- `src/lib/promotions/promotions-advisor.ts:27` — tells the AI advisor the deal
  is "whichever saves less"; would become false.
- `src/app/admin/promotions/page.tsx:218`, `PromotionForm.tsx`,
  `PromotionAiMechanics.tsx` — admin copy describing "store-advantaged".

## 5. Advertising exposure

This is the part that matters beyond arithmetic. Every customer-facing surface
advertises a **20% headline**:

- `daily-deal-presentation.ts:34` — "20% off prerolls & blunts · or 4 for the price of 3"
- `deal-badge-core.ts` — menu badge "Doobie Tuesday · 20% off · or 4 for 3"
- `daily-deal-seed.ts:57` — "20% off prerolls, blunts, and packs — or buy 4 for the price of 3"

At 6 and 7 prerolls the register charges **16%** and **14%**. The store is
advertising one price and charging a worse one, and the customer who buys *more*
is the one who gets short-changed. Two independent problems live here:

1. **The 20% floor is being breached.** Whatever else is decided, the effective
   discount must never fall below the advertised headline. This alone is a
   defect regardless of the tier question.
2. **"Buy 4 for the price of 3" is advertised but unreachable.** A customer can
   never obtain it, because it is discarded whenever it is worth having.

## 6. The one question the owner must answer

The owner's instruction is unambiguous about the destination: **1-3 → 20%, 4+ →
25%.** But the existing code was written to a deliberate, documented,
owner-directed policy of "store-advantaged, whichever saves less", cited in
`cart-discount.ts` against the CCRS guide's requirement that a discount be
"available to all who meet the discount conditions".

The new instruction supersedes it, and the two are not compatible. **This
document does not assume that away.** The recommendation below is written for
confirmation, not applied silently:

> **Recommended:** replace the either/or comparison for Doobie Tuesday with a
> flat quantity tier — `[{ at: 1, percent: 20 }, { at: 4, percent: 25 }]` —
> applied to the whole eligible preroll basket.

This is exactly what the owner described, and it has three properties the
current mechanic lacks: it is **monotonic** (more prerolls never means less
money off), it is **explainable at the counter** in one sentence, and it is
**uniform for every customer**, which preserves the CCRS "available to all"
posture that motivated the original design. It also happens to be the mechanic
`multi_item_tier` — the deal's declared `discountType` — already implements
correctly at line 393; the `eitherOr` block is what pre-empts it.

Note the equivalence worth telling customers: on identical items, "buy 4 for the
price of 3" **is** 25% off. The tier does not withdraw the advertised bundle; it
delivers it, and extends it to every quantity above 4 instead of only exact
multiples of four.

## 7. Proposed fix

### Phase 1 — make the tier real (the owner's ask)

1. Change the Tuesday seed config from `eitherOr` to explicit qty tiers:
   ```ts
   { qtyTiers: [{ at: 1, percent: 20 }, { at: 4, percent: 25 }] }
   ```
   in `daily-deal-seed.ts` and the DB-empty fallback in
   `published-rules-core.ts:139`.
2. Mirror the same tiers in `cart-discount.ts`'s `case "tuesday"`, replacing the
   two-option comparison with a single `tierPercent` lookup, so the website cart
   and the register agree by construction.
3. Leave the generic `eitherOr` mechanic in place for any other rule that wants
   it, but **fix its comparison direction** (§7.3) so it can never again silently
   underpay an advertised headline.

### Phase 2 — restore the "add one more" nudge

Remove the `if (rule.config.eitherOr) continue;` guard in `estimator-core.ts:330`
once Tuesday is a real tier, so the cart can say "add 1 more preroll for 25%
off". With `qtyTiers` the existing `pushTierNudge("qty", …)` path already does
this correctly — the nudge returns for free.

### Phase 3 — keep the guards honest

- `promo-guard-core.ts`: **verified already correct — no change needed.** An
  earlier draft of this document asserted the worst-case percent had to be
  raised from 20 to 25. That was wrong, and running
  `scripts/compliance/probe-doobie-guard.ts` disproved it:

  | rule shape | `worstCaseDiscountPercent` |
  |---|---|
  | today, `eitherOr` 20 / 4-for-3 | **25%** |
  | proposed `qtyTiers` 1→20, 4→25 | **25%** |
  | bare `multi_item_tier` defaults | **25%** |

  Line 83 takes `Math.max(flatPercent, bundlePct)` — the guard deliberately
  audits against the *deepest* discount a rule could ever produce, which is the
  opposite convention from the pricing path. So the below-cost audit has been
  protecting the store at 25% all along, and the tier change does not move it.
  The audit is the one place in this feature that was already right.
- `promotions-advisor.ts`: correct the "whichever saves less" description.
- Admin copy in `promotions/page.tsx` and the promotion form.

### 7.1 A floor invariant, tested

Independently of the tier, add an invariant the engine must satisfy for any
advertised deal:

> the effective basket discount may never be **below** the advertised headline
> percent, and adding an eligible unit may never **reduce** total savings.

The second half is a monotonicity property and is worth pinning for every
mechanic, not just Tuesday: it is the property whose absence produced the
$10.00 → $9.60 result.

### 7.2 Scaling to the legal limit

The owner specifically asked that the deal "apply all the way up to the legal
limit". A flat 4+ tier does this by construction — there is no upper bound and
no per-group arithmetic, so 4 prerolls and 40 prerolls both receive 25%. The
purchase ceiling itself stays where it belongs, in the sales-limit engine.

### 7.3 If the either/or mechanic is kept anywhere

Change `savingsA <= savingsB ? optionA : optionB` to prefer the **larger**
saving, and floor the bundle's spread percent at the flat percent. That makes
"A or B" mean what a customer reads it to mean, and makes the mechanic
monotonic. Any rule advertising two options should never resolve to less than
the better one it advertises.

## 8. Test plan — and testing the tests

New suite `tests/compliance/doobie-tuesday-tiers.test.ts`:

1. **The owner's table, exactly.** Quantities 1-40 of identical prerolls:
   1-3 → 20%, 4+ → 25%. No exceptions, no sawtooth.
2. **Monotonicity.** For q = 1..60, total savings must be non-decreasing. This
   is the assertion that fails loudly on today's code at q = 6.
3. **The 20% floor.** For every quantity, effective discount ≥ 20%.
4. **All six preroll categories.** `preroll`, `blunt`, `preroll-pack`,
   `infused-preroll`, `infused-blunt`, `infused-preroll-pack` — the owner said
   "any preroll including infused, blunts and packs". Mixed baskets across
   categories must tier on the **combined** count.
5. **Mixed prices.** The $2 + 3×$10 basket must be 25%, not 6%.
6. **Three-engine parity.** The register engine, `cart-discount.ts`, and the
   estimator must return the same number for the same basket — extending the
   existing `cart-discount-parity` and `promotions-harmony-parity` suites.
7. **Compliance floors hold.** No unit free (RCW 69.50.357, 99% cap), no unit
   below cost, at the deeper 25%.
8. **Non-prerolls untouched.** A flower line in the same cart gets nothing.
9. **Boundary.** Exactly 3 → 20%, exactly 4 → 25%.

Then `scripts/compliance/mutate-doobie.py`, in the same shape as
`mutate-t.py`: revert the comparison direction, revert the tier boundary to 5,
drop a category from the target list, remove the monotonicity guard — and
require the suite to go red for **every** mutation. A tier fix that is not
mutation-tested is not finished.

## 9. Recommended sequencing

1. Owner confirms §6 (the policy reversal from "saves less" to a real 25% tier).
2. Slice D1: the tier itself + full test suite + mutation harness.
3. Slice D2: guard, advisor, estimator nudge, and admin copy in one pass, so no
   surface is left describing the old behaviour.
4. Verify on the register with the same hand-test Michael ran: 1-12 prerolls,
   confirm 20/20/20/25/25/25/25/25/25/25/25/25.

## 10. Files touched by the eventual fix

| File | Change |
|---|---|
| `src/lib/promotions/daily-deal-seed.ts` | Tuesday config → `qtyTiers` |
| `src/lib/promotions/published-rules-core.ts` | seed fallback → `qtyTiers` |
| `src/lib/specials/cart-discount.ts` | `case "tuesday"` → single tier lookup |
| `src/lib/promotions/discount-engine-core.ts` | either/or comparison direction (§7.3) |
| `src/lib/checkout/estimator-core.ts` | drop the `eitherOr` nudge suppression |
| ~~`src/lib/promotions/promo-guard-core.ts`~~ | **no change — verified already audits at 25%** |
| `src/lib/promotions/promotions-advisor.ts` | corrected description |
| `src/app/admin/promotions/page.tsx` + form + AI mechanics | corrected copy |
| `tests/compliance/doobie-tuesday-tiers.test.ts` | new |
| `scripts/compliance/mutate-doobie.py` | new |

---

**Bottom line.** The register is not behaving erratically; it is behaving
exactly as written. "20% off OR 4 for 3" was implemented as *whichever saves the
customer less*, so the 4-for-3 is discarded at every quantity where it would
help and selected only at the quantities where it hurts — 6 and 7 — where the
floored basket-percent spread produces 16% and 14%. The fix the owner described,
a flat 1-3 → 20% / 4+ → 25% tier, is simpler than what is there now, monotonic,
uniform for every customer, and is what the store has been advertising all along.
