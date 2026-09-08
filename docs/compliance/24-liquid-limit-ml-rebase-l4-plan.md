# Slice L4 — rebasing the liquid bucket from grams to millilitres

Status: PLANNED (recon complete, no edits yet)
Depends on: L1 (volume basis), L2 (litre parsing), L3 (intake plumbing)

## What L3 left on the table

L3 made `net_volume_ml` real: it is derived at receiving, persisted to
`inventory_lots` and `menu_items`, and mapped onto the register/website item as
`netVolumeMl`. The register can now *see* a bottle's true size.

It still does not *measure* with it. `evaluateCart` routes every liquid line
through `lineGrams()`, which reads `line.grams` or falls back to
`DEFAULT_UNIT_GRAMS[cat]`. The cart line has no volume field at all, so the
plumbed fact stops at the card and the 2016 g cap is still enforced against a
28 g-per-unit guess.

## The one thing that must not be repeated

The original diagnosis in this workstream was wrong in an instructive way, and
the correction governs this slice.

`RECREATIONAL_LIMITS.liquid_edible = 72 * GRAMS_PER_OUNCE = 2016` is **not the
bug**. For an ounce-labelled product the grams basis is *numerically exact*,
because the 28 cancels:

```
2016 / (q * 28)  ==  72 / q  ==  (72 * 29.5735) / (q * 29.5735)
```

So `1oz -> 72`, `2oz -> 36`, `16oz -> 4`, `32oz -> 2` all enforce correctly
today. Changing that constant alone fixes nothing. The defect is that
`ml`/`fl oz`/`L` never produce a per-unit measure at all, so they fall back to
the 28 g default and every size allows exactly 72 packages.

L4 therefore changes the **basis**, and must do so without changing any
currently-correct answer.

## Verified: the rescale is behaviour-preserving

The bucket total and the cap are rescaled by the same ratio
`R = 29.5735 / 28 = 1.056196`, so the over/under verdict cannot move:

```
G <= 2016  <==>  G*R <= 2129.292
```

Checked numerically across `g = 0 .. 4000` in 0.25 g steps: **0 mismatches**.
Boundaries land exactly — `2016 * R = 2129.2920` against a cap of `2129.2920`,
and `2016.25 * R` exceeds it. Medical likewise: `6048 * R = 6387.8760` against
`6387.8760`.

The same identity is what keeps **topicals** safe. An ounce-labelled salve
yields identical package counts under either basis:

| salve | allowed (grams basis) | allowed (ml basis) | |
|---|---|---|---|
| 1 oz | 72 | 72 | identical |
| 1.7 oz | 42 | 42 | identical |
| 2 oz | 36 | 36 | identical |
| 4 oz | 18 | 18 | identical |
| 8 oz | 9 | 9 | identical |

This matters because `categoryToBucket` routes `topical` into `liquid_edible`,
and the owner's decision is that **topicals stay on weighted ounces until their
own later slice**. The rescale honours that: a weight-labelled topical keeps its
exact present behaviour. No density is assumed anywhere — an ounce-count is
carried across as an ounce-count, never converted through a made-up g/ml.

## Design

1. `LIMIT_BUCKET_UNITS.liquid_edible` becomes a new `"ml"` `LimitUnit`.
   `BucketUsage` already carries an explicit `unit` field (the SLICE 16
   precedent for `mg_thc`), so consumers that read `unit` need no change.
2. `RECREATIONAL_LIMITS.liquid_edible = REC_LIQUID_ML` (2129.292) and
   `MEDICAL_LIMITS.liquid_edible = MED_LIQUID_ML` (6387.876), imported from
   `liquid-volume-core` rather than re-derived.
3. `LimitCartLine` gains `volumeMl?: number | null` (the plumbed per-package
   volume) alongside the existing `grams`.
4. A new `lineMl(line, overrides)` computes the liquid bucket's contribution:
   - a real `volumeMl` (from L3) is used directly — this is the fix;
   - otherwise a weight measure is carried across at its **ounce-count**
     (`grams / 28 * 29.5735`), which is the behaviour-preserving path that keeps
     topicals and ounce-labelled liquids exactly where they are;
   - otherwise the category default, carried across the same way, so an
     unmeasured line is never silently free.
5. `formatLimitAmount` renders the ml bucket as fluid ounces
   (`formatMl` already produces `"2129.3 ml (72.0 fl oz)"`), because the statute
   states the limit in ounces and the owner asked for fluid-ounce consistency.
6. Thread `volumeMl` through the 8 `LimitCartLine`/`evaluateCart` consumers.

## Tests to retarget, not weaken

These pin the old basis and must be re-pointed at the ml figures with the
*reason* recorded, never relaxed:

- `tests/compliance/sales-limits.test.ts:31,37`
- `tests/compliance/low-thc-liquid-limit.test.ts:346,394,398`
- `tests/compliance/receiving-pipeline-plumbing.test.ts:509`
- explanatory comments in `otherwise-taken-*.test.ts`,
  `receiving-classification-parity.test.ts:148`

## Acceptance

For every label in the oversell table, `evaluateCart` must block at the legal
count and not one package later — and every currently-correct answer
(`1oz`, `12oz`, and all weight-labelled topicals) must be **unchanged**.
