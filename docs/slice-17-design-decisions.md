# SLICE 17 — design decisions and why

Written BEFORE the code, from the recon in `slice-17-legal-findings.md` plus a read of the
engine at commit 694722a0. Every claim about existing code below was verified by reading it.

## Decision 1 — the flag rides on the product, exactly like SLICE 16

**Rejected:** adding `"suppository"` as a new `GreenwayCategory`.

`GreenwayCategory` is referenced by 16 source files. Adding a member forces changes to the
promotions targeting list, the daily-deal seeds, the auto-discount tables, the navigation
menu, the receipt/COGS category map, the import transform's filter fan-out, and the menu
browser. Most of those changes have nothing to do with compliance, and each is a chance to
break something that works today. Worse, it would change how suppositories are BROWSED on the
website (a new menu section), which the owner did not ask for and which is a merchandising
decision, not a compliance one.

**Chosen:** a per-product boolean `otherwise_taken` plus the same intake screen that SLICE 16
uses, with `categoryToBucket` untouched for `topical`.

This mirrors the SLICE 16 precedent exactly — `low_thc_liquid` is also not a category, it is a
flag on an `edible-liquid` product. Consistency with the shipped pattern is worth a lot here:
the intake screen, the CSV export, the fact-review store and the order snapshot all already
know how to carry a per-product compliance boolean.

It is also the only correct answer legally. WAC 314-55-010(40) defines the category by
**route of administration**, which is a property of the specific product, not of a
merchandising bucket. A "topical" shelf can legitimately hold a balm (skin → 72 oz bucket) and
a suppository (otherwise → ten-unit bucket). No category slug can express that split; a
per-product flag can.

## Decision 2 — the bucket is measured in UNITS, a third unit type

`LimitUnit` is currently `"g" | "mg_thc"`. This slice adds `"units"`.

This is the reason the slice is not trivial. The ten-unit cap counts ITEMS. It does not
convert to grams and it does not convert to milligrams. `formatLimitAmount` must render it as
`"10 units"`, never `"0.353 oz"`.

SLICE 16 already did the hard part by introducing `LIMIT_BUCKET_UNITS` and making every
formatter consult it. This slice proves that groundwork generalizes by adding a third unit
through the same seam.

## Decision 3 — medical stays at ten, and the clamp ceiling enforces it

Established in `slice-17-legal-findings.md` §4: WAC 314-55-095(2)(d) enumerates five
categories and this is not one of them.

`MEDICAL_LIMITS.otherwise_taken = 10`, identical to recreational. `clampLimitProfile` already
prevents a settings row from widening past the profile ceiling, so the owner can tighten below
ten but the app will refuse to store eleven — for either customer type.

This makes `otherwise_taken` the **second** non-tripling bucket, after `low_thc_liquid`. The
feature-parity test asserts exactly which buckets triple and which do not, so a future
developer "restoring consistency" by tripling one of them fails the suite.

## Decision 4 — quantity is the contribution; there is no weight math

`lineUnits(line) = max(0, quantity)`, integer-floored.

A box of six suppositories is one package of six units (RCW 69.50.101 defines both terms).
If it is sold as a single sellable item whose package contains six units, the per-product
`unitsPerPackage` figure captured at intake supplies the multiplier — the same way SLICE 16
captures `unit_thc_mg` per container. Default when unset is 1, which is the FAIL-SAFE
direction only if we also refuse to under-count; see Decision 5.

## Decision 5 — the fail-safe direction is INVERTED for this bucket, and that matters

For low-THC beverages, an unflagged product falls back to the 72 oz bucket, which is
*stricter* for a bulky low-dose drink. Fail-safe = fall back.

Here the arithmetic runs the other way. An unflagged suppository falls into `liquid_edible`
(72 oz), where it is essentially unlimited — a few grams against a 2016 g cap. Falling back is
the PERMISSIVE direction, not the safe one.

So this slice cannot rely on a silent default the way SLICE 16 could. It needs the
classification to actually happen. Two mechanisms, both built:

1. **The intake screen surfaces the question** for any product whose name or CCRS type
   contains a suppository token, and the migration ships a partial index for the
   "unclassified but suspicious" review list.
2. **`suspectsOtherwiseTaken()`** — a pure detector over product name + CCRS inventory type.
   When it fires on a line that is NOT flagged, `evaluateCart` emits a WARNING (never a silent
   pass) so the budtender is told the product looks like a suppository and has not been
   classified. This does not block the sale — blocking on a name regex would be wrong — but it
   makes the gap visible instead of invisible.

This is the single most important design decision in the slice and it is the opposite of the
SLICE 16 answer. Copying SLICE 16's fail-safe reasoning blindly would have produced a feature
that silently does nothing.

## Decision 6 — do NOT change `categoryToBucket("topical")`

It stays `liquid_edible`. A balm, a lotion and a transdermal patch are all "applied topically
to the skin", which is squarely inside (E)'s 72 oz bucket. Only the flagged suppository is
carved out, via `lineBucket`, exactly as `low_thc_liquid` is carved out of the same bucket.

Changing the category mapping would misfile every balm in the store.

## Decision 7 — website AND register both block

The owner asked for both explicitly. Both already run `evaluateCart` through shared cores
(`cart-limit-meter-core` for the site, `sale-flow-core` for the register), so the block comes
for free ONCE the flag is plumbed to both. The work is the plumbing and the tests that prove
it, not new gate logic.

## Decision 8 — snapshot parity

`orders-store.ts` already conditionally serializes `lowThcLiquid`/`unitThcMg` onto the order
line. The same treatment is given to `otherwiseTaken`/`unitsPerPackage`, behind the same
"column exists" guard, so an order records the facts that determined its own limit math.
