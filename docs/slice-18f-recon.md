# SLICE 18F — RECON: catalog defaults + safe bulk classify

Owner instruction for this round, verbatim: *"Let's finish 18G and 18F first,
then we can build the scanner feature. Follow the standing rules and never
guess and never assume."*

Standing rule: **do not guess, do not assume. we build from fact, not memory.**
Everything below was read out of the tree at commit `541f68d5` (18G merged).

---

## 0. HEADLINE FINDING — HALF OF 18F IS ALREADY BUILT

`docs/slice-18-integration-recon.md:352` scopes 18F as two things:

> **18F — Catalog defaults + safe bulk classify.** Product-master default that
> pre-fills fact review, and a bulk action that still records a reviewer
> decision per row (never an invented one).

The **"safe bulk classify"** half already exists, complete and wired, and was
delivered by SLICE 6A — not by any 18-series slice. Verified:

- `src/lib/pos/fact-review-bulk-core.ts` (15,686 bytes) exports
  `groupPendingReviews()`, `planBulkDecision()`, `bulkDecisionNote()` and a
  `__runFactReviewBulkCoreTests()` self-test registered in the pure runner.
- It is consumed for real, not merely present:
  `src/app/admin/menu-imports/actions.ts:27-29` imports all three;
  `resolveFactReviewGroup()` (:385) re-derives the group SERVER-SIDE, refuses a
  truncated diagnostics read, and writes **one `pos_fact_reviews` row per
  product** (:445) plus an audit row.
- It already enforces exactly the constraint the 18F scope line demands
  ("never an invented one"): bulk `fix` is refused (:167), an anonymous bulk is
  refused (:177), an unknown or empty group is refused (:185/:193).
- `tests/compliance/slice6a-fact-review-visibility.test.ts` covers all of it.

**Conclusion: building a "safe bulk classify" for 18F would be duplicate work.**
It is done. Re-implementing it would add a second, competing bulk path over the
same table — the precise "two detectors" mistake the 18-0 build plan forbids.

## 1. WHAT IS GENUINELY MISSING — THE CATALOG DEFAULT

Neither 18F file touches the four compliance columns. Measured, not assumed:

```
grep -c "otherwise_taken|otherwiseTaken" src/app/admin/products/[key]/page.tsx        -> 0
grep -n  ...                              src/app/admin/products/masters/[id]/page.tsx -> 0
```

Nothing under `src/lib/pos/` or `src/lib/inventory/` reads `product_masters`
for classification at all. `product_masters` (migration 0036) has **no**
classification columns, and no later migration adds any (`0036` is the only
file that alters it).

### The defect, stated precisely

**A product that has been classified before is asked again, from scratch,
every single time it is received.**

Chain of evidence:

1. `seedDraftsFromManifest()` inserts a `catalog_product_drafts` row
   (`catalog-drafts.ts:313`). That insert carries `name`, `brand_name`,
   `category`, `inventory_type`, potency, cost — and **none** of
   `chosen_otherwise_taken`, `chosen_units_per_package`,
   `chosen_low_thc_liquid`, `chosen_unit_thc_mg`. Verified by grepping the
   insert body: NONE.
2. The approval card renders the gate with `defaultValue=""` and `required`
   (`drafts/page.tsx:508-521`). There is no prefill: the only
   `otherwise_taken` occurrence on that page is the form control itself.
3. `assessReceivingClassification()` takes `{productName, inventoryType,
   resolvedWebsiteCategory}` (`receiving-classification-core.ts:140`). It has
   **no parameter for a previously recorded answer**, so it structurally
   cannot remember one.

So for a suppository line received weekly, Michael answers the ten-unit
question weekly. The answer he gave last week is sitting in
`menu_items.otherwise_taken` (the enforcement column) and in the prior
`catalog_product_drafts.chosen_otherwise_taken`, and nothing reads either.

### Why this is worth fixing, not cosmetic

The 18-0 gate is `required`. A required question with no memory is a question
answered under time pressure at a receiving dock. The failure direction is the
dangerous one: `otherwise_taken` fails PERMISSIVELY (unlawful over-sale), which
is precisely why 18-0 gated it rather than prompting it
(`slice-18-0-build-plan.md:41-46`). Fatigue on a permissive-failure gate is a
compliance risk, and "the same answer, retyped from memory each week" is the
definition of a value we cannot audit.

## 2. THE GATE POSTURE QUESTION IS ALREADY ANSWERED — DO NOT RE-ASK IT

`docs/slice-18-integration-recon.md:437` marks the hard/targeted/soft gate
choice "OPEN QUESTION FOR THE OWNER (do not guess this)". It is no longer open.
`docs/slice-18-0-build-plan.md:3` records the answer verbatim:

> *"I like your recommendation about the targeted gate, let's build it that way
> please."*

and it is built (`assessReceivingClassification()` implements exactly the
targeted rule). 18F must inherit that decision, not revisit it.

## 3. THE PROVENANCE VOCABULARY ALREADY EXISTS — REUSE, DO NOT INVENT

`receiving-classification-core.ts:101`:

```ts
export const RECEIVING_CLASSIFICATION_PROVENANCE = {
  human: "human",
  /** Nobody was asked; the machine applied the safe default. */
  machine: "machine_default",
}
```

persisted to `catalog_product_drafts.chosen_classification_provenance` (jsonb,
migration 0218:97) and doctrinally ratified for `menu_items` /`inventory_lots`
by migration 0219 ("ENFORCEMENT READS MENU. PROVENANCE READS LOT.").

Any catalog default MUST land inside this vocabulary. Today it has exactly two
values. A remembered prior answer is honestly **neither**: it is not a fresh
human assertion made about this delivery, and it is not the machine's safe
default either. That is the one decision this slice cannot make on its own.

## 4. NO NEW MIGRATION IS REQUIRED TO SOURCE THE DEFAULT

The prior answers already persist and are already durable:

- `menu_items.otherwise_taken` / `units_per_package` / `low_thc_liquid` /
  `unit_thc_mg` — the enforcement columns (0216/0217), and 18G proved nothing
  ever deletes `menu_versions` / `menu_items`, so history is retained.
- `catalog_product_drafts.chosen_*` — every prior approval (0218).
- The join key is stable and already used: `catalog_product_drafts
  .pos_product_key` is seeded from `lot.pos_product_key` and matched against
  `menu_items.source_item_id` (`catalog-drafts.ts:192-200, 314-315`), described
  in-tree as "Durable across re-imports" (0036).

So the default is **derivable from committed fact**, not invented. Whether it
also warrants a `product_masters`-level column is a separate question and is
NOT needed for the fix.

## 4b. CORRECTION TO §1 — THE KEY IS NOT ALWAYS STABLE (measured)

My first pass called `pos_product_key` "durable across re-imports" on the
strength of the 0036 comment. Reading the PARSER rather than the comment shows
that is only *sometimes* true, and the difference is the whole slice.

`src/lib/inventory/intake-parser.ts:414`, verbatim:

```ts
pos_product_key: sku ?? lot_code, // fall back to inventory_id for catalog linking
```

So on the WCIA/CCRS path, when a manifest line carries no SKU the key becomes
the **LOT CODE**, and a lot code is unique to one physical delivery. The
generic path (:571) picks the first of
`pos_product_key | source_item_id | sku | product_id | external_id | item_id`
and leaves the key NULL when none is present (:607 warns exactly that).

This has two consequences, and they point in opposite directions:

1. **When the key IS stable (a real SKU):** `planDraftSeeding()` marks the lot
   `"match"` when the key is already on the published menu
   (`draft-seed-core.ts:93`), so NO draft is seeded and the receiver is never
   re-asked. The classification also survives the re-stage — that is precisely
   what 18G fixed. **For SKU'd products there is no re-ask, and §1 overstated
   the defect.**

2. **When the key is NOT stable (lot-code fallback, or null):** every delivery
   presents a NEW key. `publishedKeys` cannot match it, so a fresh draft is
   seeded and the 18-0 gate fires again — on a product the owner has already
   classified, possibly many times. The prior answer is unreachable **because
   it is filed under a key that will never recur.**

**Corrected defect statement:** the re-ask is not universal; it is specific to
products whose manifests do not carry a stable SKU. That is not a rare corner
— it is the WCIA fallback path, and it is exactly the population where the
answer is hardest to look up by hand.

This also invalidates keying the memory on `pos_product_key` alone: for the
affected population that key is precisely the thing that changes. The memory
must key on something that survives a new lot code. The tree already has that
vocabulary and it must be REUSED, not reinvented:

- `normalizeForMatch()` (`masters-cluster.ts:56`) — lowercases and strips size
  tokens so "OG Kush 1g" ~ "OG Kush 3.5g".
- `familyFromName()` / `identityKey()` (`intake-mastering-core.ts:210/319`) —
  `vendor|categoryAxis|family`, described in-tree as "the owner's 'same
  product, same vendor' identity".

## 5. SCOPE PROPOSED FOR 18F

1. A pure core that, given a prior recorded classification for a
   `pos_product_key`, returns a **suggestion** carrying its own provenance and
   its own age/source, never a silent value.
2. Wire it into the drafts approval card so the gate arrives pre-answered and
   visibly labelled as a remembered answer with the date it was first given.
3. Extend `chosen_classification_provenance` honestly (see §3) so an auditor
   can tell a remembered answer from a fresh one.
4. Leave `fact-review-bulk-core.ts` ALONE (§0).
5. Full mutation testing per the standing "test everything including the
   tests" mandate.

**Blocked on ONE owner decision: the provenance posture of a remembered
answer (§3). Raised, not guessed.**
