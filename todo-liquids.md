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
- [x] Add shared pure `resolveUnitVolumeMl()` to liquid-volume-core.ts
      (variant label first = per-variant truth; card measure only as fallback).
- [x] Wire `unitVolumeMl` through CartItemInput + ProductDetailPurchasePanel.
- [x] Fix precedence at all 3 call sites via the shared resolver.
- [x] Tests + mutation harness: 21/21 tests pass; mutation 16/16 caught, 0 survived.
- [x] tsc 0, eslint 0, full suite 597 files / 15,187 tests, 0 failures.
- [ ] PR / rebase-merge / authorship.

## L5 — receiving volume gate  [IN PROGRESS]

### Recon findings (verified in source, nothing assumed)
- L3 ALREADY derives volume at receiving (draft-injection-core.ts:439
  `deriveNetVolumeMl`) and writes `net_volume_ml` (:579). So L5 must NOT
  re-derive anything — that work is done.
- `inventory_lots.net_volume_ml` + `menu_items.net_volume_ml` ALREADY exist
  (migration 0138). **L5 needs NO new migration.**
- THE ACTUAL GAP: when derivation yields nothing, draft-injection pushes a
  `net_volume_missing` diagnostic at severity "warning" (:474). Grepped every
  caller — NOTHING gates on it. The liquid onboards unmeasured, the register
  falls back to the 28 g default, and 72 packages of any size sell.
  A warning nobody is required to read is not a gate.
- Pattern to mirror: `needsOtherwiseTakenPick` (gated, blocks) vs
  `promptsLowThcLiquid` (prompted, never blocks). The asymmetry rule is
  "does silence DISABLE a statutory limit?" — for volume it does, exactly as
  for otherwise_taken. So volume must GATE, not prompt.

### Plan
- [ ] `assessReceivingVolume()` in receiving-classification-core.ts:
      needsVolumePick = isLiquidShelf AND no derived volume.
- [ ] `validateReceivingVolumeChoice()`: accept a measured volume + unit,
      REFUSE rather than coerce, bare ounces rejected as ambiguous.
- [ ] Tests + mutation harness + PR + rebase-merge.
