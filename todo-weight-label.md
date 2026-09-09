# SLICE W1 — weight-label parser unification (the `1/8 oz` fix)

## Ground truth (measured, not assumed)

Probe `scripts/probe-labels.ts` over 37 label shapes, both parsers:

| label | `gramsForLabel` (discount) | `gramsFromVariantLabel` (compliance) |
|---|---|---|
| `1/8 oz` | **224** | null |
| `1/4 oz` | **112** | null |
| `1/2 oz` | 56 | null |
| `3/4 oz` | **112** | null |
| `28 grams` | **0** | 28 |
| `7 grams` | **0** | 7 |
| `1 gram` | **0** | 1 |
| `1 oz jar` | 28 | null |
| `1fl oz` / `100mg` / `30ml` / `2pk` / `each` | 0 | null |
| `3.5g` `7g` `14g` `1oz` `2oz` `0.5g` `28g` `1g` `2g` `3.5 g` `1 OZ` `2 ounces` `1 ounce` | agree | agree |

Two independent regexes, two files:
- `discount-engine-core.ts:208` and `cart-discount.ts:103` — byte-identical copies,
  UNANCHORED (`/([\d.]+)\s*(oz|ounce)/`), so `1/8 oz` matches the `8 oz` substring.
- `variant-grams-core.ts:45` — ANCHORED `^...$`, so anything odd returns null.

## Reachability — HONEST ASSESSMENT (corrects my Round-2 report)

`parsePackageSize` (transform.ts:423) is the ONLY writer of `variant.label`, and it
BUILDS labels as `${formatNumber(qty)}${unit}` — a fraction can never be emitted.
Fed the raw string `1/8 oz`, its own regex `/(-?\d+(?:\.\d+)?)\s*([a-zA-Z ]+)?/`
stops at `1`, finds no letter unit, falls back to `each`, and emits label `each`.

=> `1/8 oz` is **NOT reachable in production today**. This slice is
   DEFENSE-IN-DEPTH + drift elimination, not a live money leak.
   My Round-2 report should have said this plainly. Recorded.

Free text DOES reach `gramsFromVariantLabel` via vendor feeds
(`cultivera-menu-core.ts:213` `pickText(["size","weight","packageSize",...])`
-> `size_label` -> `growflow-menu-ui-core.ts:80`), but that call site only
computes a SORT KEY, not limit math. Limit math is fed exclusively by the
machine-generated `variant.label`.

## The trap: the two engines want OPPOSITE ambiguity handling

- DISCOUNT: over-reporting grams = bigger discount = store loses money.
- COMPLIANCE: under-reporting grams = over-sale = LICENSE risk.

So "be generous when unsure" is safe for neither. A parser may only return a
weight it is CERTAIN of, and must otherwise decline (discount -> 0 = no tier;
compliance -> null = conservative category default).

REJECTED DESIGN (would have been a compliance loosening): allow a trailing
descriptor after a leading weight token, to preserve `1 oz jar` -> 28.
Counter-example that killed it: `10pk 0.5g` and `1g 10pk` would parse 0.5 g and
1 g per unit, UNDER-reporting a 10-pack whose category default is 5 g.
=> STRICT ANCHORED for both. `1 oz jar` -> 0/null (not machine-emittable).

## Plan

- [x] Recon both parsers + every call site + the label writer
- [x] Probe 37 label shapes, record the disagreement table
- [x] Establish reachability honestly
- [x] `src/lib/compliance/weight-label-core.ts` — ONE strict anchored parser
      (fractions `1/8`, mixed `1 1/2`, unicode `⅛`, spelled `grams`/`ounces`)
- [x] Both parsers delegate; duplicate regexes deleted
- [x] Prove NO-OP on the machine vocabulary (the only labels that exist today)
- [x] Self-tests `__runWeightLabelTests()` + register in pure-selftests (both runners)
- [x] Vitest mirror + shared fixture table asserting the two parsers AGREE 1:1
- [x] Update `cart-discount-parity.test.ts` expectations if behaviour moved
- [x] Mutation harness — test the tests
- [x] tsc 0 / eslint 0 / full suite / PR / rebase-merge
