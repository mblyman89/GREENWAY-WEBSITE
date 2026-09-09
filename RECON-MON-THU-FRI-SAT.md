# Deep Recon — Monday, Thursday, Friday, Saturday

**Scope:** do the four deals charge what we advertise?
**Method:** every claim below was measured by running the real engines. Nothing here is inferred.
**Code state:** no production files were edited. Probe scripts were deleted after measuring.
**Baseline:** `main` @ `7d0c6ee`.

Two engines were exercised for every finding, because we have two:

- **Register** — `src/lib/promotions/discount-engine-core.ts`, fed by `sale-flow-core.ts:404`
- **Website** — `src/lib/specials/cart-discount.ts`, fed by `CartProvider.tsx:227`

---

## The one-paragraph answer

**Monday and Thursday are sound.** They charge exactly what the sign says, to the cent, and the
website and register agree. **Friday is correct for flower but contradicts your own example** — you
said "28 different 1 gram prerolls for 30% off," and prerolls get **nothing** on Friday. **Saturday
is broken in the way you suspected, and worse than expected:** on any item marked up less than
**1.43x**, the advertised "30% off one item" silently under-delivers, the register still *prints
"30% off"* on the line, and the 30% never moves to an item that could actually absorb it. On a
thin-margin item the customer gets **4.9% off while the screen says 30%**.

There is also a **fifth issue that spans all four days**: the website and the register do not price
the same basket the same way, because the website has no cost data.

---

## Day-by-day findings

### Monday — Munchie Monday, 25% flat ✅ CORRECT (one question for you)

| Check | Result |
|---|---|
| Categories receiving 25% | `edible-solid`, `edible-liquid`, `rso`, `tincture` |
| Flat at every price? | Yes — 0 shortfalls in 20,000 prices |
| Quantity changes the rate? | No — 25% at qty 1, 2, 3, 7, 12 |
| Website vs register | Identical |
| Exact-cent math | Correct (only a 1¢ item can't be discounted, which is unavoidable) |

Advertised text is *"All edibles, RSO, drinks, and tinctures are 25% off."* The code matches that
sentence **exactly**. No defect.

**The one open question — `topical`.** You described Monday as *"25% off all edibles, **liquids**,
and rso,"* and earlier you told me *"lets keep topicals in the same liquids bucket."* Right now
`topical` is a real category in our system and it receives **0%** on Monday. This is not a bug I can
fix on my own authority, because the sign doesn't promise topicals either — it's a question of what
you *intend*. **Nothing is being over-advertised**, so there is no customer-facing risk today. I need
your ruling before touching it.

### Thursday — Top Shelf Thursday, 25% off select brands ✅ CORRECT

You guessed this one was set up right initially. You were right.

| Check | Result |
|---|---|
| Brands | Lifted, Phat Panda, Buddies, Clarity Farms, Constellation |
| Case-insensitive | Yes — `lifted`, `LIFTED`, `Lifted` all match |
| Whitespace-tolerant | Yes — `"  Lifted  "` matches |
| Reaches all product types | Yes, except merch/accessories/paraphernalia (correct) |
| Exact-cent math | Correct |
| Website vs register | Identical |

**One brittleness worth knowing about (not a bug today).** Brand matching is *exact* after trimming
and lowercasing. These all silently get **0%**:

- `"PhatPanda"` (no space)
- `"Phat  Panda"` (two spaces)
- `"Constellation Cannabis"` (suffix)
- `"Lifted Cannabis Co"` (suffix)

If a vendor ever ships us a feed where the brand is written slightly differently, the deal quietly
stops applying to that product and **nobody gets an error** — it just doesn't discount. This is a
*silent* failure mode. It is not currently firing, but it is worth a guard.

### Friday — Ounce Friday, tiered mix & match ⚠️ CORRECT FOR FLOWER, CONTRADICTS YOUR EXAMPLE

The tier mechanics are **exactly right**, and the mix-and-match works properly:

| Total weight in cart | Percent | Correct? |
|---|---|---|
| under 7g | 0% | ✅ |
| 7g – 13.9g | 15% | ✅ |
| 14g – 27.9g | 20% | ✅ |
| 28g and up | 30% | ✅ |

Weight totals **across different lines, categories and brands** — I put 3.5g + 3.5g + 7g + 14g in a
cart as four different products from four categories and all four lines correctly received 30%.
That's the mix-and-match you described, and it works.

**The contradiction.** You said: *"someone could buy 28 different 1 gram prerolls for 30% off. Or 28
different 1 gram flowers for 30% off."* Measured:

```
28 x 1g PREROLL : lines discounted = 0/28   percent = 0%     <-- your example FAILS
28 x 1g FLOWER  : lines discounted = 28/28  percent = 30%    <-- works
```

Friday targets only `flower`, `popcorn-bud`, `infused-flower`, `trim`. **Prerolls are assigned to
Tuesday**, not Friday. And our own `/specials` page says *"Mix and match any **flower** from any
brand"* — so the **website and the code agree with each other**, and both disagree with **you**.

This is the one place where I genuinely cannot tell you what "correct" means. Either:
- the sign is right and your preroll example was a slip, **or**
- your intent is right and both the sign and the code need to change.

**I will not guess this one.** It also interacts with Tuesday: if prerolls join Friday, a customer on
Tuesday buying 28 prerolls could reasonably ask why Friday is better. This needs your decision.

**A real Friday bug, independent of the above — package labels.** Friday reads weight off the variant
label, and the parser is loose:

| Label | Read as | Friday gives | Verdict |
|---|---|---|---|
| `1/8 oz` | **224g** | **30%** | ❌ reads "8 oz", should be 3.5g → 0% |
| `1/4 oz` | **112g** | **30%** | ❌ should be 7g → 15% |
| `1/2 oz` | **56g** | **30%** | ❌ should be 14g → 20% |
| `28 grams` | 0g | **0%** | ❌ should be 30% |
| `3.5 grams` | 0g | 0% | ❌ word "grams" not understood |
| *(blank label)* | 0g | 0% | ⚠️ silently no deal |

An eighth labelled `1/8 oz` currently gets a **full ounce discount**. We are not using those label
formats today, which is why this hasn't bitten — but one vendor feed or one hand-typed label away
and we're giving 30% off an eighth.

Worse: we have **two different weight parsers** that disagree on **14 of 35** label formats. The
discount engine uses `gramsForLabel()`; the **legal purchase-limit engine** uses
`gramsFromVariantLabel()`. A package can be read as 224g by the discount and `null` by the limit
checker. That is a compliance-adjacent divergence and should not persist regardless of what you
decide about prerolls.

### Saturday — 30% off one item + 15% everything else ❌ CONFIRMED BROKEN

You were right that this is the day with complexity. What works:

- The 30% correctly targets the **lowest-priced** item ✅
- Merch is correctly excluded ✅
- Single item alone gets 30% ✅
- Website and register agree on the **total** across 3,000 random baskets ✅

#### Defect S1 — the 30% silently under-delivers on thin-margin items (**the big one**)

We may never discount below acquisition cost. That's correct and legally required. But Saturday
applies the 30% to the cheapest item **without checking whether that item can absorb 30%**, then
clamps it to the cost floor and **still labels the line "30% off."**

The break-even is **markup 1.43x**. Measured against predicted algebra — they match exactly:

| Advertised | Deliverable only at markup ≥ | Engine confirms |
|---|---|---|
| 30% | 1.429x | **1.43x** ✅ |
| 25% | 1.333x | **1.34x** ✅ |
| 20% | 1.250x | **1.25x** ✅ |
| 15% | 1.176x | **1.18x** ✅ |

A real example — thin-margin item, cost 65% of shelf price:

```
regular = $50.00 | charged = $47.55 | real discount = 4.9% | LINE PRINTS: "30% off"
```

**The customer is told 30% and given 4.9%.** The register displays that label
(`SaleFlow.tsx:3081`), so **a budtender reading the screen will confirm "yes, that's 30% off."**

#### Defect S2 — the 30% is stranded, never reassigned

When the cheapest item cannot absorb the 30%, the discount is simply **lost**. It does not move to
the next item that *could* take it. Measured:

```
cheap item (no headroom): charged 1000 of 1000 -> 0% off
dear item  (lots of room): charged 1020 of 1200 -> 15% off
highest percent ANYONE in this basket received: 15%   (advertised: 30%)
```

**Nobody in the basket got the advertised "30% off any one item."** In a worked case, moving the 30%
to the high-margin item would have saved the customer more *and* kept every line above cost — the
store loses nothing by fixing this.

#### Defect S3 — multi-quantity lines overcharge by up to 12¢

When the 30% target line has quantity > 1, the engine blends one unit at 30% and the rest at 15%,
then rounds. **1,169 of 1,498** blended lines charge **more** than advertised. Worst case measured:
`price=507 qty=8` → charged 3376, advertised 3364 (**12¢ over**).

#### Defect S4 — Saturday still rounds the price, not the discount

Saturday uses `round(price × 0.7)`. This is the **exact defect we fixed in Slice D2** for flat
percents, where it caused 47% of prices to under-deliver. Saturday never got the fix. It should use
`ceil((price × pct) / 100)` like the rest of the system now does.

#### Defect S5 — ties are decided by cart order

Two items at the same price: whichever was added to the cart **first** gets the 30%. Totals come out
identical so no customer is harmed today, but it means the same basket rung up in a different order
produces different per-line receipts.

#### Defect S6 — the website labels a full-price line "30% off"

On a floored item the website charges full price but reports `pct=30`.

---

## The cross-cutting issue: the website and the register don't price alike

This one spans every day and is the finding I'd flag hardest after Saturday.

- The **register** passes real acquisition costs into the engine (`sale-flow-core.ts:404`)
- The **website** passes `costMinorUnits: null` (`CartProvider.tsx:227`, `CartEstimator.tsx:146`)

So the website computes discounts **with no cost floor at all** and the register computes them
**with one**. The website can quote a price the register will refuse to honour:

```
Saturday basket — website quotes $49.50, register charges $52.50
The customer is quoted one price online and charged $3.00 more at the counter.
```

Measured across 2,000 baskets per day at a realistic 40–60% cost band:

| Day | Baskets quoted differently |
|---|---|
| Thursday | 62.8% |
| Friday | 78.0% |
| Saturday | 62.6% |
| Sunday | 5.3% |

**An honest caveat about this table:** my probe used flower lines, so Monday/Tuesday/Wednesday showed
0% purely because flower isn't eligible on those days — *not* because they're immune. The cost floor
applies on **every** day where a discount actually lands on a thin-margin item. Do not read those
three as "clean."

Note this gap only becomes *visible* to a customer where the website shows a discounted price.
Friday/Saturday/Sunday product cards already hide struck prices, which limits — but does not
eliminate, since the cart still quotes — the exposure.

---

## Why our test suite didn't catch any of this

Worth stating plainly. There is exactly **one** Saturday assertion in the entire suite
(`promotions-harmony-parity.test.ts:292`) and it only checks the **config shape**
(`{topPercent: 30, restPercent: 15}`) — never the **behaviour**.

More importantly, the engine's own self-test at `discount-engine-core.ts:948` **enshrines the bug**:

```
expect("basket headline clamps at cost floor", ...unitPriceMinorUnits === 878)
```

That test asserts the clamped price is correct — which it is, legally — but **never checks that the
line is still labelled 30%**, and never checks that *somebody* in the basket received the advertised
headline. The test passes while the customer is misled. Any fix must therefore **also fix the test**,
not just the code.

---

## Roadmap

Ordered by customer-facing risk. Nothing here has been implemented — this is strategy, per your
instruction.

### Priority 1 — Saturday truth-in-advertising (S1 + S2)

The rule to adopt: **the advertised headline must actually be delivered to someone in the basket.**

Choose the 30% target by *deliverable savings*, not by sticker price:
1. Compute, for each eligible line, the discount it can actually absorb above its cost floor.
2. Award the 30% to the cheapest item **that can absorb it**.
3. If no item can absorb a full 30%, award it to the item delivering the **greatest real saving**.
4. **Never print a percent the customer did not receive** — label the line with the real percent.

This preserves the cost floor exactly as-is (we never sell below cost), spends no extra margin in the
common case, and ends the mislabelling. Note step 3 changes *which* item is discounted versus
"lowest priced," so I want your sign-off on that before writing a line of it.

### Priority 2 — Saturday exact-cent math (S3 + S4)

Port the D2 fix: replace `round(price × 0.7)` with `ceil((price × pct) / 100)`, and apportion the
blended multi-quantity line with the **largest-remainder** helper already built and merged in D1
(`bundle-apportionment-core.ts`). This is low-risk, well-precedented work — the hard thinking was
already done in D1/D2 — and it eliminates the 12¢ overcharge.

### Priority 3 — the website/register pricing gap

Two candidate strategies:
- **(a)** Plumb costs into the website engine so both sides floor identically.
- **(b)** Keep costs server-side (they're sensitive) and have the website call a shared pricing
  endpoint, so there is **one** source of truth.

I lean to **(b)** — vendor costs arguably shouldn't ship to a browser at all — but this is an
architecture decision with real trade-offs and it's your call.

### Priority 4 — Friday's preroll question (**needs your ruling**)

Three options:
- **(a)** Add prerolls to Friday — matches what you told me; requires updating `/specials` copy and
  thinking through the Tuesday overlap.
- **(b)** Leave Friday as flower-only — matches the current sign; your preroll example was a slip.
- **(c)** Flower-only but make the sign more explicit so nobody expects prerolls.

**I've made no change and formed no assumption. Tell me which.**

### Priority 5 — unify the two weight parsers

Make the discount engine and the legal-limit engine read a package **the same way**: anchor the
regex, understand `grams`/`gram`, handle fractional ounces (`1/8 oz` → 3.5g), and decide explicitly
what an unlabelled variant should do. Ships with a shared fixture list so both engines are tested
against identical labels.

### Priority 6 — Thursday brand-match hardening

Normalise internal whitespace and add a back-office warning when a published brand matches **zero**
live products — turning today's silent no-op into something visible.

### Priority 7 — close the test gap

Saturday needs behavioural tests, not shape tests: every basket must deliver its advertised headline
to someone; no line may be labelled with a percent it didn't get; exact-cent sweeps across the price
range; and mutation coverage proving the tests actually fail when the behaviour regresses. Per your
standing rule — test it, and test the tests.

---

## Summary table

| Day | Advertised | Actually charged | Status |
|---|---|---|---|
| Monday | 25% off edibles/RSO/drinks/tinctures | Exactly 25% | ✅ correct — `topical` ruling wanted |
| Thursday | 25% off select brands | Exactly 25% | ✅ correct — matching is brittle |
| Friday | 30/20/15 tiered, mix & match | Exact for flower | ⚠️ prerolls excluded; label parsing unsafe |
| Saturday | 30% one item + 15% rest | As low as **4.9%** while printing "30%" | ❌ **needs work** |

**Decisions I need from you:** (1) does Monday include topicals? (2) do prerolls qualify on Friday?
(3) for Saturday, may the 30% move off the lowest-priced item when that item can't absorb it? (4)
website costs — plumb through, or shared endpoint?

No code has been changed. Say the word and I'll start with Saturday.
