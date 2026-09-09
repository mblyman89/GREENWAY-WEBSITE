# Discounts round — D1 + D2

## Owner's rules (verbatim, this session)

> "the reason we implemented the store wins policy is more for rounding issues.
> we like whole numbers as much as possible, so if we need to round, we should
> always round up or round in our favor."

> "for discounts, the rule is no stacking, unless explicitly allowed."

> "we cant sell below cost either by law... we spread the discount evenly
> instead of reducing one below cost."

> "for specific discounts that are built like the ones we have for the daily
> deals, the rules should be respected within each discount created. i dont
> want to change the rules universally."

> "i want the store to always win, but if a discount specifically states 4 or
> more prerolls is 25% off, then its 25% off, whether the store wants to win or
> not. but for any other product on tuesday, the store wins."

> "Sunday needs to be exact."

### The deals, as the OWNER states them
- Monday: 25% off edibles/RSO/drinks/tinctures.
- Tuesday: 20% off prerolls, OR 4 for 3 (= 25% off). Tiers 1-3 = 20%, 4+ = 25%.
  Any preroll: infused, blunts, packs.
- Wednesday: 20% off, OR 30% off over $150.  <-- owner corrected: NOT the
  15/20/30 ladder, NOT 25%.
- Thursday: 25% off featured top-shelf brands.
- Friday: 30% off 28g flower, 20% off 14g, 15% off 7g.  (code already matches)
- Saturday: 30% one item + 15% everything else.
- Sunday: buy 3 for the price of 2, storewide mix & match. EXACT.

## The distinction that was lost

"Store wins" is a ROUNDING rule (half-cent to the store), not a DEAL-SELECTION
rule. The code applied it at the PERCENT level (~100x coarser than a cent) and
then reused it to choose which of two advertised options applies.

## D1 — exact-cent apportionment + Tuesday's real tier

- [ ] Ground: measure every affected path before touching it.
- [ ] Exact-cent spread (largest-remainder, cost-floor capped) in the shared
      engine, replacing the floored whole-percent spread.
- [ ] Tuesday: 1-3 -> 20%, 4+ -> 25%, all six preroll categories.
- [ ] Restore the estimator "add one more" nudge.
- [ ] Correct the self-tests that PIN the shortfall.
- [ ] Tests + mutation harness. tsc/eslint/full suite. PR. CI. Merge.

## D2 — Wednesday

- [ ] Two tiers: 20% base, 30% at $150+. Remove the 15%/$50 and 20%/$100 rungs.
- [ ] Reconcile seed + presentation copy + admin copy.
- [ ] Tests + mutation harness. Same gauntlet.

---

## D1 — DONE (commit 01d08be)

- [x] `bundle-apportionment-core.ts` — largest-remainder (Hamilton) split over
      whole cents. Self-tests 10/10, registered in `pure-selftests.test.ts`.
- [x] Either/or takes the option BETTER for the customer (`savingsA >= savingsB`).
- [x] `bundleSpreadDiscounts` uses exact-cent apportionment, not a floored percent.
- [x] Tuesday is a real quantity tier: 1–3 = 20%, 4+ = 25%.
- [x] Tuesday tiers DERIVE from the seed (`seedConfigFor` reads `DAILY_DEAL_SEEDS`)
      so the seed and the fallback cannot drift apart.
- [x] Website cart's independent Tuesday copy brought into line + stale header.
- [x] Engine self-tests that PINNED the shortfall (990 where 1000 is correct)
      corrected, not worked around.
- [x] Estimator "add one more" nudge restored; AI advisor ground truth fixed.
- [x] `mutate-d1.py` — 10/10 caught.

### Bugs D1's own tooling found
- The first engine script rewrote the `STATUTORY_GRAMS_PER_OUNCE` import to
  `sales-limits-core`, which re-exports it under a DIFFERENT name → `undefined`
  → `gramsForLabel("1oz")` = `NaN` → **Ounce Friday would have silently stopped
  applying.** Now guarded in the script.
- Removing the cost floor from apportionment looked harmless (the floor is
  enforced twice) but hands savings to a line that cannot absorb them; the later
  clamp eats them. Measured: a $5.00 target collapsing to $2.60. Now covered.

## D2 — DONE

- [x] Wednesday is TWO tiers: 20% base, 30% at $150+. No $50 or $100 rung.
- [x] Wednesday tiers derive from the seed, same pattern as Tuesday.
- [x] `waxWednesdayPercentForSpend` rewritten; website cart matches the engine.
- [x] `DEFAULT_SPEND_TIERS` deliberately UNCHANGED — it is the generic fallback
      for staff-created promotions, not Wednesday's definition.
- [x] Card/badge copy reconciled with the mechanics.
- [x] `mutate-d1.py` extended to 17 mutations — 17/17 caught.

### Bugs D2 found
- **The code under-delivered its own advertising.** `/specials` already said
  "All concentrates and vapes are 20% off", but the ladder paid **0% below $50**
  and 15% from $50–$99.99. A single $40 cartridge: advertised 20%, charged full
  price.
- **`parseTierRows` rejected `at > 0`**, so a zero-threshold base tier was
  silently deleted whenever staff opened Wax Wednesday and pressed Save —
  collapsing the deal to "nothing under $150". Fixed to `at >= 0`.
- **Every flat percent rounded against the customer.** `Math.round()` was applied
  to the PRICE, so rounding the price up rounded the discount down. Measured over
  79,604 price/percent combinations: **47.1% under-delivered** by up to 0.5¢.
- **Flooring the price was not enough:** `170 * (1 - 30/100)` is
  `118.99999999999999`, so the floor dropped an extra cent. Now the DISCOUNT is
  computed with exact integer maths — `Math.ceil((price * percent) / 100)` — so
  the result is exact, customer-favoured, and never more than 1¢ above the rate.

## D2 (part 2) — legacy suites + card/cart advertising parity

Correcting the four legacy suites that still encoded the OLD behaviour turned
into a defect hunt. Every number below was MEASURED with throwaway probes
before any test was touched — the discipline is that a red test is a question,
not an instruction, and the answer is only ever "the test pinned the bug" or
"I broke something real". Both answers turned up.

- [x] `cart-discount-parity` — three tests pinned bugs, corrected from measured
      values: Tuesday's "the SMALLER savings wins", Wednesday's 15/20/30 ladder,
      and Sunday's floored 33% (which charged $20.10 for three $10 units, 10¢
      MORE than "pay for 2" advertises).
- [x] `promotions-harmony-parity` — Tuesday/Wednesday are tiered now, not
      either/or, so `config.eitherOr` is gone and the offer labels read
      "20–25% off" / "20–30% off".
- [x] `deal-badge-core` — Tuesday badge copy now states the percent the register
      charges at 4+ units: "20% off · or 4 for 3 (25%)".
- [x] `cart-estimator-core` — Wednesday nudges point at the only remaining tier
      (30% at $150). Doobie Tuesday now nudges HONESTLY: the old code skipped
      either/or rules outright because "add one more preroll" could have LOWERED
      the discount, which would have been a lie. D1 removed the inverted
      selection, so the nudge is now true.
- [x] Full suite green: **600 files / 15,291 tests**. tsc 0. eslint 0 errors.
- [x] `mutate-d1.py` extended to 22 mutations across 6 suites — **22/22 caught**.

### Bugs D2 part 2 found

- **The product card advertised a price the register would not honour.**
  `headlinePercentFor` returns the BEST case (top tier), and the struck card
  price used it directly. On Wax Wednesday that meant a $40 cartridge card
  showed **$28.00** (30% off) while the cart charged **$32.00** (20%) — a $4.00
  over-advertisement on every sub-$150 card. Fixed with `guaranteedPercentFor`:
  the percent a single unit is CERTAIN to earn on its own, evaluated through the
  engine's own `tierPercent` so the card cannot drift from the register. The
  BADGE copy still states the full offer ("20% off · 30% at $150+"), because
  that is honest advertising of the deal — only the PRICE, which is a promise
  about one item right now, was tightened.
- **Branded merch was struck on Top Shelf Thursday.** `ruleMatchesLine` matched
  non-storewide rules on BRAND alone, and merch carries a brand — so a
  Lifted-branded t-shirt showed 25% off on its card while the cart charged full
  price (`cart-discount.ts` skips merch in its thursday branch). The storewide
  branch one line above already encoded the right intent ("never touch
  merch/accessories unless explicitly targeted"); the brand/key branch never
  got the same guard. Pre-existing, not introduced by D1/D2.
- **Measured impact:** card-vs-cart over-advertisements across 6,370
  weekday × category × price × variant combinations went **265 → 0**. The 884
  remaining disagreements are all UNDER-advertisements — the intended
  Fri/Sat/Sun policy where the card shows the regular price because a lone item
  cannot know the basket.
- **The mutation harness earned its keep.** Run 3 scored **19/22**, and all three
  survivors were the fixes above — proving the fixes were real but *untested*,
  because nothing in the suite compared the card price to the charged price.
  Closed with an exhaustive sweep asserting the card never advertises below what
  the cart charges. An untested fix is one refactor from silently reverting.
- **My own new test then caught an ordering bug in the fix.**
  `guaranteedPercentFor` returned any authored `discountPercent` before checking
  basket mechanics, so Super Saturday (`discountType: "basket"` with an authored
  headline of 30%) claimed a lone item was guaranteed 30% — when Saturday's 30%
  lands on exactly ONE unit of a multi-item basket. The basket check existed but
  sat below the early return and was unreachable. Basket mechanics are now
  evaluated first.
- **`tsc` caught a field I had assumed existed.** I wrote
  `item.variantLabel`; `GreenwayMenuItem` has no such property —
  `itemToEngineLine` hardcodes `variantLabel: null`. Corrected to read the label
  off the engine line, which is the single definition of what the engine sees,
  so the card tracks it automatically if variant data is ever attached.

### Process notes worth keeping

- Two apply scripts aborted on a wrong anchor and **wrote nothing** — the
  `assert count == 1` guard doing exactly its job. One was a Python `re` call
  missing `re.DOTALL`; one was an anchor guessed instead of read.
- Idempotency is still decided on `count(new) == 1` ALONE. Testing
  `count(old) == 0` as well misfires whenever NEW contains OLD as a substring.

### Self-review found two more (before commit, not after)

Reading my own diff back rather than trusting it turned up two problems that
every test was passing over:

- **The card guarantee joined its rule by TITLE** (`s.title === deal.label`).
  Nothing enforces title uniqueness — staff publish promotions from
  /admin/promotions — so two same-titled rows would let the card read a
  guarantee from a rule that did not produce the deal, re-opening the
  over-advertisement. Now joined by rule IDENTITY through the engine's own
  `ruleMatchesLine` + `snapshotToEngineRule` + `itemToEngineLine`, the same
  three functions that picked the deal. Proved the new test FAILS against the
  old join (expected 30 to be 20) before keeping it.
- **eslint went 15 → 16 warnings and the new one was mine** — a helper taking an
  `over` argument it never spread, which is both dead weight and a trap for the
  next caller. Removed; every call site now passes category and price
  explicitly. Back to the 15 pre-existing warnings, none in files this round
  touched.

Final state: **tsc 0 · eslint 0 errors · 600 files / 15,296 tests green ·
mutation 24/24 caught**.
