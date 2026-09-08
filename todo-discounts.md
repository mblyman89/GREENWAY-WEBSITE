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
