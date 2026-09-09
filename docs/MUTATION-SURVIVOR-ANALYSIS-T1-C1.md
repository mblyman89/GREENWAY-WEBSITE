# Mutation survivors — empirical classification (SLICE T1 + SLICE C1)

Final scores: **T1 27/27**, **C1 26/26**, with 3 (T1) + 1 (C1) mutations proven
equivalent and excluded from scoring rather than deleted.

---

# PART 1 — T1 (brand matching)

Run 1: 19/28 caught, 9 survivors. Each investigated with
`scripts/probe-survivors-t1.ts` (real functions vs. an inline re-implementation
of the mutant). Nothing was deleted; nothing was assumed.

## S1 — "key: blank guard removed" → EQUIVALENT MUTANT (proven)

Mutant: `if (!value) return ""` becomes `String(value ?? "")`.

Probe output:

    null      real="" mutant="" same=true
    undefined real="" mutant="" same=true
    ""        real="" mutant="" same=true

For any non-empty string the guard is not taken, so both branches run the same
code. For the three falsy inputs the outputs are identical above. There is no
input that distinguishes them → equivalent.

ACTION: the mutation was too polite. A careless edit does not write a defensive
`?? ""`; it deletes the line and leaves `value.toLowerCase()`, which throws on
`null`. Replaced with that stronger mutation. The equivalent form is retained,
with this proof, in `EQUIVALENT_MUTANTS`.

## S2 — "list: blank value matches" → REAL TEST GAP

Mutant: delete `if (!v) return false` from `brandInList`.

Probe output:

    list=["","Lifted"]  value=null real=false mutant=true  DIFFERS=true
    list=["  "]         value=""   real=false mutant=true  DIFFERS=true
    list=["--"]         value=null real=false mutant=true  DIFFERS=true

This is a real, reachable defect: a rule whose `excludeBrands` contains a blank
or punctuation-only entry (an empty row in the admin UI, a trailing comma) would
start matching every product that has **no brand at all**. On an exclusion list
that silently removes untitled products from a sale; on a target list it puts
them on sale at a price nobody authorised.

ACTION: added blank-entry assertions to `__runBrandMatchTests`.

## S3 — "nearmiss: reports exact matches too" → EQUIVALENT MUTANT (proven)
## S4 — "nearmiss: allows equal-length" → EQUIVALENT MUTANT (proven)

Probe output — all four variants produce the identical result:

    real                         : ["Lifted Cannabis->Lifted"]
    S3 mutant (no exact skip)    : ["Lifted Cannabis->Lifted"]
    S4 mutant (equal len allowed): ["Lifted Cannabis->Lifted"]
    baseline                     : ["Lifted Cannabis->Lifted"]

They are **jointly redundant**, which is exactly the SLICE W1 lesson, so a
single-edit harness can never kill either one:

* `brandKey` is the concatenation of `brandTokens` (both split on the same
  `[^a-z0-9]+` class). So if `bTok` is a strict token-prefix extension of `tTok`,
  then `key(b) = key(t) + <non-empty>`, therefore `key(b) !== key(t)`, therefore
  `brandMatches(brand, target)` is already false by the time the exact-match
  guard runs. **S3 is unreachable while the length guard stands.**
* Conversely, if `bTok.length === tTok.length` and the prefix loop passes, the
  token arrays are identical, so the keys are equal, so the exact-match guard
  already `continue`d. **S4 is unreachable while the exact-match guard stands.**

ACTION: added the multi-edit mutation that removes BOTH at once — that one is
observable (every Thursday target would report itself as a near miss) and the
catalogue test's "exactly 4 near-misses" assertion must catch it.

## S5–S8 — wiring reverts → REAL TEST GAP (four of them)

    wiring: engine brand target reverts to old hasCi
    wiring: engine brand EXCLUSION reverts to old hasCi
    wiring: checkout reverts to its own copy
    wiring: menu card reverts to its own copy

Not equivalent — `scripts/probe-t1-wired.ts` already demonstrated these call
sites behave differently before and after T1 (`'phat-panda'` went 0% → 25%).
They survived because every T1 test calls the core functions **directly**.
The core is proven; the fact that the engine, the checkout and the menu card
actually *use* it is not. That is the whole point of the slice, and it was
untested.

## S9 — "multi: revert engine AND checkout AND card together" → same gap

Consequence of S5–S8; killed by the same new test.

ACTION for S5–S9: new integration suite
`tests/compliance/brand-match-wiring.test.ts` drives the REAL engine, the REAL
checkout cart-discount and the REAL menu-card matcher with the same brand
spellings and asserts all three agree.

Result: **T1 27/27 caught**, 3 documented equivalents.

---

# PART 2 — C1 (clearance / vendor-day markdown lock)

Run 1: 22/27 caught, five survivors, all in the engine wiring.

## A METHOD FAILURE I HAVE TO RECORD FIRST

My first two differential probes reported "0 differing scenarios" for the
basket-pre-pass and short-circuit survivors across 204 scenarios, and I nearly
wrote both off as equivalent. **That result was worthless and the fault was
mine.** `Tier` is `{ at: number; percent: number }`
(discount-engine-core.ts:131). I wrote `{ minGrams, minSpendMinorUnits,
percent }` and silenced the compiler with `as unknown as never`. So `t.at` was
`undefined`, `value >= undefined` is always false, `tierPercent` always
returned 0, and **every threshold_spend and weight_tier rule in those probes
did nothing at all.** I was measuring a mechanism that never ran and would
have concluded "no witness exists" from it.

The cast is what hid it. The rewritten probe declares `const spendTiers:
Tier[]` with no cast, and asserts up front that `tierPercent` returns
0/20/30 and 0/15/30 at the boundaries before any conclusion is drawn. With the
correct shape the "equivalent" mutant produced **13 witnesses immediately**.

Lesson, recorded so it is not relearned: a probe that finds nothing must first
prove it can find something.

## C-S1 — "main loop ignores the lock" → REAL GAP

17 witnesses on flat deals plus 4 on aggregate ones. The plainest: a 10%
clearance line beside a 25% day deal charged 3000 with the label "Day Deal"
instead of 3600 / "Clearance 10%". Also lends its UNITS to a bundle — a
clearance line pushed the rest of the cart into a 4-for-3 (25%) it had not
earned (measured 750 vs the correct 800).

CLOSED BY: "a locked line does not lend its UNITS to a bundle deal" plus the
existing DEFECT D test.

## C-S2 — "basket pre-pass ignores the lock" → REAL GAP (13 witnesses)

Only observable through a rule whose percent depends on the WHOLE eligible
basket. Witness: a $100.00 clearance item beside a real $52.00 basket. With
the pre-pass reading the unfiltered cart, the spend rule is measured as though
the basket were $152.00, the Saturday headline is steered away, and the
cheapest real line drops from 30% to 20%.

Every pre-existing C1 test used flat-percent day deals, where the input set
cannot change another line's answer — which is precisely why all of them
passed against the mutant.

CLOSED BY: "a markdown line does not inflate an AGGREGATE rule's tier for the
rest of the cart" and "an aggregate day deal tiers on the UNLOCKED basket
only" (the latter with a +$1.00 sanity case proving the rule is live).

## C-S3 / C-S4 — markdown-exemption guards → REAL GAP (4 witnesses each)

These two are jointly redundant in ordinary carts: a locked line is never
shown to another rule, so the exemption has nothing to overrule. They separate
only when the markdown's saving is clamped to ZERO by the CCRS cost floor.
Then `newSavingsPerUnit > current.unitSavingsMinorUnits` is `0 > 0` = false,
the markdown is discarded, and the line reports **no deal at all**.

Witness: price 4000, cost 3000, floor `ceil(3000 × 1.463)` = 4389 > 4000.
Baseline reports `clr / 50% / "Clearance 50% · 50% off"`; both mutants report
`- / 0%`.

CLOSED BY: "a markdown clamped to the cost floor still wins the line" and "two
markdowns on a cost-floored line: the deeper one is still reported".

## C-S5 — "empty-visible short-circuit removed" → EQUIVALENT MUTANT (proven)

`if (visible.length === 0) continue` is a performance guard, not a behavioural
one. `applyOnePromotion` opens with
`const eligible = lines.filter(...); if (eligible.length === 0) return out;`
and performs no side effect before it, so an empty `visible` produces an empty
map and the loop body never executes. 105 differential scenarios (with the
tier shapes verified correct) found zero witnesses, matching the proof.

Kept in `EQUIVALENT_MUTANTS` with this reasoning; excluded from scoring.

Result: **C1 26/26 caught**, 1 documented equivalent.
