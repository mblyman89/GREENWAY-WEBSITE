# Recon Round 2 — Revised Strategy

**What changed:** you supplied four facts that invalidate part of my last report and expose a
bigger issue I had not yet looked for.

**Method:** unchanged. Every claim measured against the real engines. No production code edited.
Probe scripts deleted after measuring. Baseline `main` @ `7d0c6ee`.

---

## First: I was wrong about the cost floor, and you were right

You told me the store runs a **3x out-the-door minimum markup (2x cost + tax)**. I tested that
against the engine across every cost from $1 to $120 in a Saturday basket:

```
costs tested 100..12000 at 2.0x pretax markup
times the 30% failed to fully apply: 0
tightest headroom above the cost floor: 58c
```

**You are correct.** At your pricing policy the 30% never floors. My "Priority 1" from last round —
the stranded-30% defect — **does not occur in your store**. I was measuring a margin band that
doesn't reflect how you buy. That finding is **withdrawn**.

Here is the cushion your policy buys you, confirmed against the engine:

| Discount | Needs markup | At your 2.0x | Cushion |
|---|---|---|---|
| 15% | 1.176x | safe | 70% |
| 20% | 1.250x | safe | 60% |
| 25% | 1.333x | safe | 50% |
| 30% | 1.429x | safe | 40% |
| **50%** | **2.000x** | **safe by 0c** | **0%** |
| 55% | 2.222x | ❌ cannot deliver | — |

Keep this table. It is the rule for any future deal: **the deepest discount you can ever advertise
at a 2x pretax markup is exactly 50%.**

### But that 50% row is the tightest possible margin, and it is worth your attention

The 50% markdown you've never used yet lands **exactly** on the cost floor — headroom of **0¢**, and
at some costs **−1¢** from rounding:

```
cost= 500 shelf= 1463 floor= 732 50%-off= 731 headroom= -1c
cost=1000 shelf= 2926 floor=1463 50%-off=1463 headroom=  0c
cost=3333 shelf= 9752 floor=4877 50%-off=4876 headroom= -1c
```

Two consequences, both real:

1. **The 50% works, but delivers zero margin** — you sell at exactly cost. That's presumably the
   intent for expiring product, so this is a business call, not a bug.
2. **Any item bought at less than a 2x markup cannot deliver the advertised 50%.** Measured:

```
markup 1.60x -> charged 37.5% off   <-- FLOORED, cannot deliver 50%
markup 1.90x -> charged 47.4% off   <-- FLOORED, cannot deliver 50%
markup 2.00x -> charged 50.0% off   ok
```

You said 3x is your **minimum**, so this should never happen — but it's a one-line guard worth
having, because the failure is **silent** and the sign would say 50%.

---

## Second: discounts do not stack. Confirmed. ✅

Your general rule is sound and the engine already enforces it — `discount-engine-core.ts:642`,
*"Best-deal-wins (strictly exclusive — no stacking, ever)"*. Measured with a 50% clearance rule and
Munchie Monday both matching one item:

```
aged   regular=5852 charged=2926 real=50.0% label=Clearance 50%
normal regular=5852 charged=4389 real=25.0% label=Munchie Monday
if it had STACKED (50%+25%) it would charge ~1463. It did not.
```

**No stacking. Your instinct was right.**

---

## Third: the real problem — clearance items *hijack* the Saturday 30%

This is what I found when I went looking for the interaction you asked about. It is more serious
than anything in my last report, and it is **specific to Saturday**.

Saturday awards its 30% to the **lowest-priced item in the cart**. A clearance item is, almost by
definition, **the cheapest thing in the basket**. So Saturday hands its 30% to the clearance item —
and then "best-deal-wins" quietly discards it, because 50% beats 30%.

The mechanism, measured:

```
Saturday alone:
  aged  charged= 1638  Super Saturday · 30% off
  mid   charged= 4974  Super Saturday · 15% off
  dear  charged= 9948  Super Saturday · 15% off

Saturday + 50% clearance on the cheapest item:
  aged  charged= 1171  Clearance 50% · 50% off
  mid   charged= 4974  Super Saturday · 15% off   <-- still only 15%
  dear  charged= 9948  Super Saturday · 15% off   <-- still only 15%
```

**The 30% is consumed by the one item that was supposed to be excluded from it, and then thrown
away.** Every full-price item in the basket is left on 15%. Nobody receives the advertised "30% off
any one item."

Across 2,000 baskets containing a clearance item:

```
baskets where NOBODY got the advertised Saturday 30%: 2000 (100.0%)
extra savings the customer should have had: ~$26,799 across those baskets
```

**100%.** Not an edge case — this happens *every single time* a clearance item is in a Saturday
basket. And because you've never applied the 50% markdown yet, **this has never fired in
production.** You found it before it cost you anything.

### The same hijack hits vendor days

Measured with a 40% vendor-brand sale on the cheapest item:

```
vend  brand=Buddies  charged=1579  Vendor Day 40%
mid   brand=Lifted   charged=6217  Super Saturday · 15% off
anyone carrying the Saturday 30%? NO — same hijack as clearance
```

Same root cause. Any deal that beats 30% on the cheapest item silently eats Saturday's headline.

### The fix is verified, and it's small

Your own stated rule — *"those items are excluded from any and all other sales/daily deals"* — is
exactly the fix. When the clearance product key is excluded from the daily deal, I re-ran **the
identical 2,000 baskets**:

```
baskets where nobody got the 30%:  2000  ->  0
clearance item still correctly got its 50%: 2000/2000
```

**2,000 → 0.** The 30% moves to the cheapest *full-price* item, and the clearance item keeps its
50%. Both rules do exactly what you'd want.

### Tiered days already handle exclusions correctly ✅

I checked whether excluding an item would corrupt Friday's weight tiers. It does not — it behaves
exactly right:

```
Friday, 14g + 14g = 28g, no clearance:      both lines -> 30%
Friday, 'a' is clearance and excluded:      a -> 50% (clearance)
                                            b -> 20% (14g tier)
```

Once the clearance item leaves the eligible pool, only 14g of eligible weight remains, so the
remaining item correctly drops from the 28g tier to the 14g tier. **The tier total already respects
exclusions.** No work needed there — that's the engine being genuinely well built.

---

## What already exists that we can build on

Good news on the plumbing. The engine already has:

- `excludeProductKeys`, `excludeBrands`, `excludeCategories` — and *"Exclusions win"* is enforced
  first in `ruleMatchesLine` (`discount-engine-core.ts:266`)
- `targetProductKeys` — so a 50% markdown on specific items is directly expressible
- A built admin page at **`/admin/promotions/never-discount`** with a `NeverDiscountManager` UI,
  backed by migration 0155

That last one is the closest existing machinery, **but it has the wrong semantics for this job**:
never-discount means *"this product receives no promotion, ever."* What you need is different —
*"this product receives its markdown and nothing else."* Same exclusion plumbing, different intent.
We should not overload it.

---

## Revised roadmap

Reordered from last round, because your facts removed my #1 and added a bigger one.

### Priority 1 — Clearance/vendor exclusivity (the hijack)

The one that actually matters. Two parts:

**(a) A markdown concept in the back office.** A way to mark a product as clearance/expiring with a
percent, which automatically excludes it from every daily deal. Mechanically this is
`targetProductKeys` on the markdown rule plus those same keys in every daily deal's
`excludeProductKeys` — the pattern already proven above.

**(b) Saturday must pick its 30% from *eligible* items only.** Even with (a), I'd want the
headline-selection logic to choose from items the deal actually applies to, so the 30% can never
again be handed to something that's about to discard it. Belt and braces.

Worth doing **before** you ever apply the 50%, since today it would misfire 100% of the time.

### Priority 2 — Saturday exact-cent math (unchanged, still real)

Independent of everything above and still confirmed:

- Saturday uses `round(price × 0.7)` — the exact defect D2 fixed everywhere else. Should be
  `ceil((price × pct) / 100)`.
- Multi-quantity target lines overcharge up to **12¢** (`price=507 qty=8` → 12¢ over). The
  largest-remainder helper from D1 (`bundle-apportionment-core.ts`) already solves this.
- Blended lines report `15%` when the line contains a 30% unit — mislabelled.
- Ties are broken by cart order.

Low-risk, well-precedented — the hard thinking was done in D1/D2.

### Priority 3 — Website/register pricing endpoint

You agreed on the endpoint, and **yes, it is the industry-standard, enterprise-grade answer.** One
server-side pricing authority that both the website cart and the register call, so a price can only
ever be computed one way. The alternative — shipping vendor costs to a browser — is the thing you'd
fail a security review for.

Worth noting your 3x markup **also** shrinks this problem: the divergence I measured last round was
driven by cost-floor clamping, which your pricing policy prevents. So this is now an
**architectural correctness** fix rather than an active bug — real, but not on fire. That's a
deliberate downgrade from my last report.

### Priority 4 — Weight-label parser unification

Still worth doing, unchanged. `1/8 oz` reads as **224g** and would grant a full-ounce 30% on an
eighth; `28 grams` reads as **0g**. The discount parser and the **legal purchase-limit** parser
disagree on **14 of 35** label formats. Not firing today because we don't use those formats — but
it's one vendor feed away, and one of the two parsers governs a compliance limit.

### Priority 5 — Deep-discount guard

A cheap guard implementing the table at the top: warn in the back office when a published percent
exceeds what an item's markup can deliver (>50% at 2x). Turns a silent under-delivery into a visible
warning at publish time.

### Priority 6 — Test coverage

Saturday has exactly **one** test and it only checks config shape. Worse, the engine self-test at
`discount-engine-core.ts:948` **enshrines** the floor behaviour without ever checking the line is
still labelled correctly — it passes while a customer is misled. Any fix must fix that test too.
New tests needed: clearance never absorbs a daily-deal headline; every basket delivers its
advertised headline to someone eligible; exact-cent sweeps; mutation coverage proving the tests fail
when behaviour regresses.

---

## Closed items

- ~~Friday prerolls~~ — you confirmed flower-only. Engine is **correct as built**. No change.
- ~~Monday topicals~~ — you confirmed excluded. Engine is **correct as built**. No change.
- ~~Saturday stranded 30% at cost floor~~ — **withdrawn**; your 3x markup prevents it.
- ~~Thursday~~ — verified correct.

## Status

| Day | Status |
|---|---|
| Monday | ✅ Correct as built |
| Thursday | ✅ Correct (brand matching is brittle but not firing) |
| Friday | ✅ Correct as built (label parser worth hardening) |
| Saturday | ⚠️ Rounding defects + **clearance hijack before you use the 50%** |

**The single most important line in this report:** do not apply the 50% markdown until Priority 1 is
done. Today it would cancel the Saturday 30% in **100%** of baskets containing a clearance item, and
nothing would alert you — the receipt would simply be quietly wrong.

No code has been changed. Ready to start on Priority 1 when you give the word.
