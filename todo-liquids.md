# Liquids round — L5a + L5 (working tracker)

## L5a — customer-facing website volume gap  [IN PROGRESS]
- [x] Recon: website meter's ONLY volume source is `volumeMlFromLabel(variantLabel)`
      because `CartItemInput` has no `unitVolumeMl`.
- [x] MEASURED (scripts/compliance/probe-l5a.ts):
      label ""/"100mg"/"4pk" + qty 72 -> volumeMl=undefined, BLOCKED=false (OVERSELL)
      label "750ml" qty 3 -> volumeMl=2250, BLOCKED=true (already correct)
- [x] SECOND DEFECT FOUND (a hole in L4, register-side too):
      `item.netVolumeMl ?? volumeMlFromLabel(variant.label)` prefers the CARD
      measure over the VARIANT label. `groupingIdentity()` excludes package
      size, so one card holds 750ml AND 1.5L variants; `netVolumeMl` comes
      from `firstAvailable` only. Buying 2 x 1.5L measured 1500 ml instead of
      3000 ml -> BLOCKED=false when the true volume is 41% over the cap.
      Affects 3 call sites: api/pos/menu/route.ts:325, order-pricing.ts:265,
      cart-limit-meter-core.ts:106.
- [ ] Add shared pure `resolveUnitVolumeMl()` to liquid-volume-core.ts
      (variant label first = per-variant truth; card measure only as fallback).
- [ ] Wire `unitVolumeMl` through CartItemInput + ProductDetailPurchasePanel.
- [ ] Fix precedence at all 3 call sites via the shared resolver.
- [ ] Tests + mutation harness (scripts/compliance/mutate-l5a.py).
- [ ] tsc 0 / eslint 0 / full suite / commit / PR / rebase-merge / authorship.

## L5 — receiving volume gate  [PENDING]
- [ ] Third gated question in receiving-classification-core.ts, mirroring
      `needsOtherwiseTakenPick` (isLiquidShelf at line 146).
- [ ] Consume LIQUID_VOLUME_TYPES / deriveNetVolumeMl from
      liquid-volume-derivation-core.ts. Fail closed, never guess.
- [ ] Tests + mutation harness + PR + rebase-merge.
