# Transformer Final Hardening Todo

## Context / logic map (verified this session)
- POS data: `pos-data/raw/PRODUCTS.xlsx` + `pos-data/raw/INVENTORIES.xlsx`.
- `scripts/pos/transform_pos_data.ts` builds `src/data/pos-menu-preview.json` (+ sample) during `npm run transform:pos` and `npm run build`.
- THC displayed from `Total` column (`totalRaw`); CBD from `Cbd` column (`cbdRaw`). mg units for Solid/Liquid Edible + Tincture; `%` otherwise.
- Package logic: `packageCandidateFromProductName` (name) vs `parsePackageSize` (column), reconciled in `validatedPackageSize`.
- Display names cleaned in `stripVariantNoise`. Category mapping in `normalizeCategory` (hard-throws on unmapped).
- UI reads `item.thc`/`item.cbd` strings + `item.totalThc`/`item.totalCbd` (% slider only filters unit==="%").

## A. Full context tracing
- [x] Re-read transformer end-to-end and trace UI data flow
- [x] Analyze raw INVENTORIES THC/CBD distributions by InventoryType
- [x] Deep internet research on average THC/CBD by product type

## B. Bug 1 — Volume must win over potency (mg) for tinctures/shots/edibles/RSO
- [x] Reorder/guard `packageCandidateFromProductName` so a real volume (fl oz/ml/oz) or weight (g) always wins over bare mg potency
- [x] In `validatedPackageSize`, make column volume win over name-derived mg potency
- [x] Treat RSO and all edible weight types (solid mg-grams, liquid ml/floz) correctly; never use a potency mg figure as the package size
- [x] Add diagnostic when a name-derived mg figure is rejected in favor of a volume/weight package

## C. Bug 2 — Exclude ineligible InventoryTypes from name override
- [x] Exclude `Usable Marijuana`, `Topical Ointment`, `Concentrate for Inhalation` from edible/liquid package-name override
- [x] Drive eligibility from InventoryType (authoritative) not just raw Category strings
- [x] Add expert-judgment robustness: guard against pack/dose patterns hijacking flower/preroll weights

## D. Bug 3 — Sanity cap on absurd cannabinoid values
- [x] Add data-derived caps: THC% ≤ 100; edible/tincture mg ≤ sensible ceiling
- [x] Emit `cannabinoid_value_capped` diagnostic when capping
- [x] Prefer a sane sibling value (e.g. `Thc` column) before falling back when `Total` is garbage

## E. Remove underscores from display names
- [x] Strip/normalize underscores to spaces in `stripVariantNoise`/name cleanup
- [x] Regenerate and verify `Bite_ind_...`, `Chew_sat_...` style names are clean (0 underscores remain)

## F. New-category detection flag
- [x] Make unmapped category log to anomaly report as a clear flagged anomaly (industry-standard) while keeping a safe outcome
- [x] Confirm anomaly report captures the flag (`new_unmapped_category`; 0 currently, all mapped)

## G. THC/CBD average fallback (every card shows a value)
- [x] Build fallback table keyed by category/inventory type from raw medians + internet research
- [x] When raw THC/CBD missing/zero, apply average fallback (auditable via diagnostic)
- [x] Mark fallback values so they're auditable (`~` prefix + diagnostic); ensure no card shows N/A/-- for THC where a fallback exists
- [x] Decide CBD fallback approach (low % for flower-type/concentrate; source-only for edibles)

## H. Verification & delivery
- [x] Run `npm run transform:pos`; inspect diagnostics + outputs with targeted checks
- [x] Run `npm run build` (typecheck) clean (tsc 0 errors; build generated 2334 pages, 0 errors)
- [x] Review git diff for scope; remove temp scripts (256/-31 in transformer + regenerated JSON only; no temp files)
- [ ] Commit, push branch `feature/transformer-final-hardening`, open/update PR; report status
