# SLICE 18-0 — BUILD PLAN: classification through the RECEIVING pipeline

Owner decision (verbatim): *"I like your recommendation about the targeted
gate, let's build it that way please."* Plus: *"Let's fix the receiving intake
pipeline first, then address the management of said items."*

Recon that produced this plan: `docs/slice-18-integration-recon.md` §0-PRE.

## THE PROBLEM THIS SLICE FIXES

After the Cultivera cutover, every product enters through RECEIVING. The
receiving pipeline is blind to all four compliance flags, and fact review —
the only screen that can set them — is scoped to an `import_id`, which
received goods never have. So a suppository received after cutover reaches the
shelf with `otherwise_taken = NULL`, and because SLICE 17's fail-safe is
INVERTED, it is silently treated as an ordinary topical against the 2016 g
liquid bucket. The ten-unit limit never engages.

## THE TARGETED GATE — EXACT DEFINITION

The gate must be *targeted*: it may only demand an answer when the answer could
change a limit. Verified from `categoryToBucket()` in
`src/lib/compliance/sales-limits-core.ts`, the ONLY website categories that
reach the `liquid_edible` bucket are:

    edible-liquid, tincture, topical

`qualifiesAsOtherwiseTaken()` requires `categoryToBucket(category) ===
"liquid_edible"`, so a suppository can ONLY hide on those three shelves. A
flower or cartridge lot can never be an otherwise-taken product, and must
never be asked.

Therefore:

    otherwise_taken pick is REQUIRED when
        websiteCategory maps to liquid_edible
        OR suspectsOtherwiseTaken({name, inventoryType}) fires
    otherwise NOT required (machine-defaulted to "no")

    low_thc_liquid pick is PROMPTED (never required) when
        websiteCategory maps to liquid_edible
    otherwise not shown

The asymmetry is deliberate and owner-approved: `otherwise_taken` fails
PERMISSIVELY (unlawful over-sale) so it is gated; `low_thc_liquid` fails
CONSERVATIVELY (a lawful but smaller sale) so it is prompted. This asymmetry
is pinned by a test that states the reason, so it never reads as an oversight.

## PROVENANCE HONESTY (non-negotiable)

When the gate does not ask, the value stored is a MACHINE decision, not a human
one. It must be recorded as such. We never write a human-looking `false` that
nobody actually asserted. This mirrors `fact_provenance` on `menu_items`.

## THE SIX STAGES AND WHAT EACH GETS

1. `intake-parser.ts` — `ParsedLine` gains the four fields, seeded `null`.
   NEVER derived from the manifest: WA manifests carry no such field, and
   guessing is the SLICE 16 servings-vs-units mistake.
2. `intake-review-core.ts` — a per-line WARNING when
   `suspectsOtherwiseTaken()` fires, sitting beside the existing COA warning.
   Imports the ONE shared detector from `sales-limits-core` (pure, verified:
   its only import is `grams-per-ounce`). No second regex.
3. `intake-store.ts` — the `inventory_lots` insert carries the four columns,
   making 0217's `inventory_lots` columns live instead of dead.
4. `lot-activation-gate-core.ts` — NOT touched. The gate lives at Product
   Onboarding where a human is already answering classification questions;
   adding a second block at activation would stop deliveries for a question
   nobody is being shown at that moment. Recorded as a decision, not an
   omission.
5. `catalog-drafts.ts` + `drafts/page.tsx` — the targeted gate, mirroring
   SLICE 64's `assessDraftClassification` / `validateClassificationChoice`
   exactly: server-side re-derivation, never trust the form, closed
   vocabulary, friendly missing-migration error.
6. `draft-injection.ts` — carry the picks onto `menu_items` so the website and
   register receive them exactly as they do from the import path.

## MIGRATION

`0218_receiving_classification.sql` — classification columns on
`catalog_product_drafts` (following the 0141/0146 precedent, including the
missing-column error path).

## TEST PLAN (RED FIRST)

- `otherwise-taken-receiving.test.ts` — the gate core: required on the three
  liquid_edible shelves, required when the detector fires, NOT required on
  flower/cartridge, invalid picks refused, unit count demanded with "yes".
- `receiving-classification-parity.test.ts` — THE point of this slice: an
  identical product classified via IMPORT and via RECEIVING must produce an
  identical limit outcome.
- Extend the real receiving suites (`intake-review`, `draft-injection-core`).
- Mutation-test every new predicate with a pre-flight that proves each anchor
  matched exactly once.

Names are deliberately `-receiving-` because `*-intake.test.ts` already means
"the fact-review form parser" in this repo (recon §4).
