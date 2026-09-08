# Liquids round — L5a + L5 (working tracker)

## L5a — customer-facing website volume gap  [COMPLETE — MERGED]
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
- [x] PR #1132 rebase-merged; commits 26692ae + 329e9b4, authorship mblyman89 verified.

## L5 — receiving volume gate  [COMPLETE — MERGED]

### Recon findings (verified in source, nothing assumed)
- L3 ALREADY derives volume at receiving (draft-injection-core.ts:439
  `deriveNetVolumeMl`) and writes `net_volume_ml` (:579). So L5 must NOT
  re-derive anything — that work is done.
- `inventory_lots.net_volume_ml` + `menu_items.net_volume_ml` ALREADY exist
  (migration 0138).
- CORRECTION to the line above (it was written before the drafts table was
  grepped, and it was wrong): the receiver answers the gate on a DRAFT, and
  `catalog_product_drafts` had nowhere to put that answer. Verified by grep
  across every migration — no `chosen_net_volume_ml` column existed. So L5
  DOES need one migration: `0224_receiving_volume_gate.sql`. Nullable, no
  backfill, so it cannot retro-block drafts already in flight.
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
- [x] `assessReceivingVolume()` in receiving-classification-core.ts:
      needsVolumePick = isLiquidShelf AND no derived volume. (f7ae792)
- [x] `validateReceivingVolumeChoice()`: accept a measured volume + unit,
      REFUSE rather than coerce, bare ounces rejected as ambiguous. (f7ae792)
- [x] Migration 0224: `catalog_product_drafts.chosen_net_volume_ml`, nullable.
- [x] Server gate in `catalog-drafts.ts`: derive from the name first, and only
      refuse the approval when the derivation came back empty. (eb73a9f)
- [x] Injection: a human measurement OUTRANKS the name derivation, and is
      attributed `fact_provenance.net_volume_ml = "human"`. (eb73a9f)
- [x] `draft-injection.ts` selects `chosen_net_volume_ml` in the widest
      fallback tier, or the value would always arrive undefined. (eb73a9f)
- [x] The receiver's way to answer: gated quantity + unit control on the
      drafts page, forwarded by the server action. (0a3856c)
- [x] 63 pure self-tests + 28 unit tests in receiving-volume-gate.test.ts.
- [x] Mutation harness: 23/23 caught, 0 survived. Two survived the first
      run and BOTH were real holes, now closed:
      M15 - the server derived the volume then ignored it (tests asserted
            deriveNetVolumeMl was CALLED, never that its answer was USED).
      M10 - `||`->`&&`; probed, not assumed: still refuses all three partial
            answers so nothing over-sells, but loses the only actionable
            message. A half-answered gate must report as an unanswered one.
      Two harness defects found BEFORE running it: M12's anchor matched
      nothing, and missing case M23 let fl oz store as ml (~30x under).
- [x] Migration 0224 PROVEN, not renumbered: prove-0224-executes.sh applies
      all 224 to real PostgreSQL 15 (224 applied / 0 failed, idempotent),
      then inspects: numeric(12,3) nullable NO default; 354.882 (12 fl oz)
      round-trips exactly; unmeasured stays NULL, 0 zero-rows; pre-0224-style
      draft lands NULL = nothing backfilled.
- [x] tsc 0, eslint 0, self-tests 63 + 97, unit 28,
      FULL suite 598 files / 15,215 tests / 0 failures.
- [x] PR #1133 rebase-merged. Commits 1be94b9, 66b5845, b1768dc, 1d5ae6a,
      5d37a0b - authorship mblyman89 verified on all five.

### Next (owner-confirmed, separate round)
- [ ] Move topicals out of the `liquid_edible` bucket onto weighted ounces.
      Deliberate marker left in tests/compliance/liquid-limit-ml-engine.test.ts:
      `expect(categoryToBucket("topical")).toBe("liquid_edible")` - it will
      fail loudly when that round starts, which is the point.

### Owner action outstanding
- Apply `0223_liquid_volume_ml_snapshot.sql` AND `0224_receiving_volume_gate.sql`
  in Supabase. Until 0224 is applied the gate still refuses unmeasured liquids
  (safe direction), but the measurement cannot be stored.
