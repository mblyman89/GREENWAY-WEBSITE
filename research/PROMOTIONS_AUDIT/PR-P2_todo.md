# PR-P2 — The deterministic "selection brain" (promotion-selector-core.ts) + smart audiences

Branch: feat/promotions-selection-brain
Base: main @ 8b57c0a8

## Design (grounded in real code — no guessing)
Attribute palette from src/lib/pos/db-types.ts MenuItemRow + MenuVariantRow:
- name / product_name / brand_name / vendor_name
- category + filter_categories[]  (GREENWAY_CATEGORY_VALUES, 21 values)
- pos_inventory_type / pos_inventory_category
- strain_type (indica/sativa/hybrid/indica-hybrid/sativa-hybrid/cbd/unknown — strain-taxonomy.ts) + strain_name
- thc / cbd (string %), total_thc_json / total_cbd_json, compounds_json [{type,value,unit}]
  compound types: thc, thca, cbd, cbda, cbg, cbn, cbc, cbdv (draft-injection-core.ts:155)
- servings_per_pack, mg_per_serving, package_thc_mg, package_cbd_mg, ratio_label
- net_weight_grams, net_volume_ml
- price_label, price_minor_units, inventory_status, hidden, sort_order
- variants: label (size: Eighth/Quarter/Half/Ounce/Gram), price_minor_units, inventory_level, medical

Size vocabulary (Michael-confirmed): gram=1g, eighth=3.5g, quarter=7g, half=14g, ounce=28g.

## SelectionPredicate (typed, JSON-safe, AI-emittable later)
A flat, validated filter with include/exclude semantics. Fields (all optional; AND across kinds, OR within a kind's list):
- sizes: SizeBucket[]  (gram/eighth/quarter/half/ounce) — matched via net_weight_grams tolerance OR variant label
- categories: string[]  (must be GREENWAY_CATEGORY_VALUES)
- strainTypes: string[]
- brands: string[] / vendors: string[]
- nameContains: string[]  (any)
- nameExcludes: string[]
- priceMinCents / priceMaxCents
- weightMinGrams / weightMaxGrams
- thcMinPercent / thcMaxPercent
- cbdMinPercent / cbdMaxPercent
- hasCannabinoid: string[]  (cbg/cbn/cbc/cbdv/thca... "any product with measurable CBN")
- ratioProducts: boolean  (1:1 etc via ratio_label)
- inventoryStatuses: string[]  ("in_stock" etc)
- lowStock: boolean + lowStockThreshold (variant inventory_level)
- creative flags: onSaleAlready (has active promo — resolved by caller, predicate just carries flag), newArrival (sort_order/created heuristic — caller supplies), staffPick? (skip unless data exists)
- excludeKeys: string[] / includeKeys: string[] (hard overrides — always win)

## Tasks — COMPLETE (full battery green: self-tests, tsc, eslint, vitest 3033, crawler 450, next build)
- [x] 1. promotion-selector-core.ts: SizeBucket + SIZE_GRAMS table; SelectionPredicate type; SelectableProduct type (the normalized menu row the resolver reads); resolveSelection(products, predicate) -> {matched:{key,name,brand,reasons[]}[], skipped, warnings[]}; helper predicates; describePredicate() plain-English restatement.
- [ ] 2. Extensive pure self-tests inside the file (assert(...) block) covering every field + fail-safe (empty predicate matches NOTHING, never everything) + size tolerance + cannabinoid presence + reasons.
- [ ] 3. Register the self-test in scripts/compliance/run-pure-selftests.ts.
- [ ] 4. Vitest spec tests/compliance/promotion-selector-core.test.ts mirroring/extending self-tests.
- [ ] 5. Smart audiences: agent-written idempotent migration for `promotion_saved_audiences` (id, name, predicate jsonb, created_at, created_by). Store helpers listSavedAudiences/createSavedAudience/deleteSavedAudience (code must not break if migration not yet applied).
- [ ] 6. Manual "build a rule" UI: client island PromotionRuleBuilder.tsx — pick attributes -> live SelectionPredicate -> server action resolves against live menu -> table of matched products WITH reasons; "Apply as includes" writes target_product hidden inputs (reuse P1 picker mechanic) OR saves as audience.
- [ ] 7. Server action resolvePredicateAction(predicate) in actions.ts -> loads listMenuProducts (extended to carry attributes) -> resolveSelection -> returns matched list. Extend listMenuProducts to a richer listSelectableProducts.
- [ ] 8. Full battery + PR + merge + sync.

## Guardrails
- FAIL-SAFE: empty/parse-fail predicate => match NOTHING (never widen a sale).
- Deterministic only (no AI in P2).
- Exclusions/excludeKeys always win over includes.
- No per-customer pricing (CCRS). No below-cost (enforced on publish already).

## Michael's question to answer in report:
Can exclude carve a specific product out of a DAILY/recurring deal (edible on Mon, preroll on Tue)?
ANSWER (verified in code): YES — ruleMatchesLine (discount-engine-core.ts:262-265) applies excludeProductKeys/Brands/Categories to EVERY published rule incl weekday recurring; promotionToRule + snapshotFromPublished carry them (published-rules-core.ts:154-244). Nuance: the daily deal must exist as an EDITABLE promotion row (published), not only the committed seed fallback. Verify seed-vs-row nuance before reporting.
