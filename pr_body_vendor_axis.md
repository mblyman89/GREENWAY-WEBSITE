## Problem

After resetting operational data and intaking a fresh WCIA manifest, product mastering produced ONE MENU CARD PER SIZE (e.g. SPR Sour Diesel 1g / 3.5g / 7g / 14g / 28g as five separate cards) instead of one card with size variants.

Root cause (verified end-to-end, never guessed): WCIA/Cultivera manifests carry the vendor at the **document level** and **no per-line brand at all** — `parseWciaLine` correctly leaves `brand_name: null` (confirmed against a real Cultivera transfer JSON: no brand-ish key exists on any line). So every intake draft has a blank brand, and the mastering planner — whose identity was `brand|categoryAxis|family` — refused to group anything: every line became a standalone card with an `intake_master_no_brand` warning pointing at a "fix the brand on Product Onboarding" remedy that doesn't exist (the drafts page has no brand input).

## Owner rule update

> "All of our vendors have separate licenses for their different brands … they are all vendor names, so there shouldn't be any unwanted cross brand roll ups. Replace the brand with the vendor."

## Change

Rollup identity is now **`vendor|categoryAxis|family`**:

- **intake-mastering-core** — `identityKey` takes the vendor; blank vendor → standalone card + `intake_master_no_vendor` warning (message points at the manifest header, where the vendor actually comes from); `LiveCardCandidate` gains `vendor_name`; `deriveFamily` strips BOTH the vendor and (when a manifest does carry one) the brand prefix from product names so families fold consistently; the grouped-card description falls back to the vendor when no brand exists.
- **intake-menu-staging-core** — the carried-item → `liveCards` mapping now passes `vendor_name`, so restock merges match live cards on the vendor axis.
- **Tests** — embedded self-tests + both vitest mirrors updated: vendor-split replaces brand-split; **new** test pins that different brand labels under the SAME vendor roll up into one card; blank-vendor never-guess test; restock/ambiguous/pack-axis fixtures match on `vendor_name`.

Everything else is unchanged: eligibility still delegated to `buildDraftInjectionPlan`, lot accuracy preserved (`${lotKey}-onboarded` per variant), never-merge-on-a-guess, hidden/medical-only cards never targets, pack-axis folding intact.

## Verification

- Pure self-test runner: **ALL PASSED**
- `tsc --noEmit`: clean
- `eslint` on all touched files: clean
- Full vitest: **1742 tests / 133 files green**
