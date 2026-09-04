# SLICE 18 RECON — full-platform integration of the low-THC beverage and
# "otherwise taken into the body" classifications

**Status:** RECON ONLY. No code edits were made in this round.
**Date of recon:** see git log for this file's commit.
**HEAD at recon time:** `7fdcee05` (SLICE 17 merged).

Every statement below was verified by reading the file named. Nothing here is
recalled from memory or inferred from a summary. Where a claim is "X does not
exist", the grep that returned empty is recorded so the claim can be re-checked.

---

## 0-PRE. SECOND RECON ROUND — THE RECEIVING PIPELINE (owner-directed)

**The first recon round traced only the one-time Cultivera IMPORT path.** The
owner correctly pointed out that after cutover, **every product enters through
RECEIVING** (manifest → intake → accept → Product Onboarding → live menu).
That pipeline was re-recon'd in full. The finding is severe and is stated
first because it changes the priority order of the whole roadmap.

### THE HEADLINE FINDING

```
grep -rn "low_thc_liquid|lowThcLiquid|otherwise_taken|otherwiseTaken|
          units_per_package|unitsPerPackage|unit_thc_mg|unitThcMg" \
     src/lib/inventory/ src/app/admin/inventory/
  --> RETURNS NOTHING
```

**The entire receiving pipeline is blind to all four compliance flags.**
Not partially wired — *entirely absent*, at every one of the six stages.

This means: after the Cultivera cutover import, **there is no way for a newly
received product to ever be classified**, because fact review — the only screen
in the system that can set these flags — is scoped to an IMPORT id
(`fact-review-store.ts:53,62,86,144,151` all key on `importId`;
`onConflict: "import_id,source_item_id"`). Received goods have a *manifest* id,
not an import id. **They can never appear on that screen.**

### THE CHAIN, VERIFIED STAGE BY STAGE

1. **Parse** — `intake-parser.ts:44-67`. `ParsedLine` carries product_name,
   lot_code, brand, category, strain_name, strain_type, received_qty, unit,
   unit_cost, unit_weight, unit_weight_uom, is_sample, is_medical,
   **`inventory_type`**, expires_on, lab, warnings, raw.
   **No compliance flags.** (Note: `inventory_type` IS parsed — this is the
   exact field `suspectsOtherwiseTaken()` was built to read.)

2. **Review** — `intake-review-core.ts:70-155`. `summarizeIntakeForReview()`
   already emits severity-tagged flags for: missing vendor license (error),
   missing vendor name, missing manifest number, no lines (error), vendor
   SAMPLE, missing lot code, **missing COA (WAC 314-55-102)**, **FAILED lab
   (error)**, zero quantity, missing unit cost.
   **No classification flag.** `suspectsOtherwiseTaken()` is never called
   anywhere under `src/lib/inventory/` or `src/app/admin/inventory/` (verified
   empty) — the suppository detector built in SLICE 17 **never runs at the dock**.

3. **Lot creation** — `intake-store.ts:524-556`. The `inventory_lots` insert
   writes 24 fields including `category` and `inventory_type`.
   **None of the four flags.** Lots land in `status: "quarantine"`.

4. **Activation gate** — `lot-activation-gate-core.ts:22-107`. A genuinely good
   compliance gate: `LotGateFacts` = {id, label, ccrsExternalId, hasLabResult,
   labPassed}, blocking on `missing_ccrs_id`, `missing_lab_result`,
   `failed_lab_result`, each with a WAC citation in the message.
   **Classification is not a gate fact.** A completely unclassified lot
   activates cleanly.

5. **Product Onboarding** — `src/app/admin/inventory/drafts/page.tsx` (519 lines).
   Form fields are `website_category`, `new_category_label`, `house_type`,
   `new_type_label`, `strain_type`, `price`. **No compliance classification.**
   `CatalogDraft` (`catalog-drafts.ts:44-81`) carries `chosen_website_category`,
   `chosen_house_type`, `chosen_strain_type` — **no chosen classification.**

6. **Injection to live menu** — `draft-injection.ts`. `DRAFT_COLS` (line 59) +
   the item build (220-244) write name, brand, vendor, category,
   pos_inventory_type, strain, thc, package_thc_mg, price…
   **grep for the four flags returns empty.** Nothing classification-related
   reaches `menu_items` through this path.

**Net effect:** a suppository received after cutover flows dock → shelf → website
→ register with `otherwise_taken = NULL`, which — because SLICE 17's fail-safe is
INVERTED — is silently treated as an ordinary topical against the 2016 g liquid
bucket. Effectively unlimited. **The ten-unit limit would never engage.** The
low-THC case fails in the safe direction (a qualifying beverage is under-sold
against 72 oz instead of 200 mg), but is equally unreachable.

### WHY THE EXISTING ARCHITECTURE MAKES THIS CHEAP TO FIX

Two strong precedents already exist and should be copied, not invented:

- **The intake review flag system** (`intake-review-core.ts`) already carries
  WAC-cited, severity-tagged, per-line warnings. Adding a "possible
  suppository — classify before accepting" flag is a natural extension of a
  list that already includes "no COA (WAC 314-55-102)".

- **The SLICE 64 classification GATE** (`catalog-drafts.ts:467-546`) is
  *exactly* the pattern needed. `approveDraftWithPrice()` already:
  re-runs the resolver **server-side and never trusts the form**, refuses the
  approval when a required human pick is missing, validates picks against a
  closed vocabulary, persists picks only when made, and returns a friendly
  "run migration NNNN" error if the column is absent. A compliance
  classification pick drops straight into this shape. SLICE 93 (strain type)
  shows the same pattern added later as a *non*-gating optional pick — so both
  postures are already demonstrated in this one function.

### CONSEQUENCE FOR THE ROADMAP

**18A is no longer the right starting point on its own.** A back-office
worklist that lists unclassified products is necessary but not sufficient if
the pipeline can never classify them in the first place. A new sub-slice
**18-0 (RECEIVING PIPELINE)** is inserted ahead of everything else, and it is
the highest-priority work in this document.

---

## 0. THE ONE-PARAGRAPH ANSWER

SLICE 16 and SLICE 17 built the **law** correctly and wired it end-to-end for
**enforcement**: the flags are captured at fact review, stored on `menu_items`,
carried to both the website and the register, enforced in the cart and at the
register, and snapshotted onto `order_lines`. What they did **not** build is
the **management and discovery layer** that every other classification in this
platform has: filters, badges, sort options, an inventory worklist, a lot-level
correction path, and a catalog-level editor. The limits work; they are just
invisible and unmanageable outside the one import-review screen.

---

## 1. WHAT IS ALREADY DONE (verified — do not rebuild)

### 1.1 Intake capture — COMPLETE, BOTH FLAGS
`src/app/admin/menu-imports/[id]/facts/page.tsx`
- Lines ~437-473: the low-THC block. `select name="lowThcLiquid"` with three
  options (leave / yes / no) plus `FixField name="unitThcMg"` labelled
  "THC mg per SEALED CONTAINER".
- Lines ~476-515: the otherwise-taken block. `select name="otherwiseTaken"`
  plus `FixField name="unitsPerPackage"` labelled "Individual units per
  PACKAGE", with explicit "a box of six is 6" copy and an orange warning that
  an unclassified suppository is treated as an ordinary topical.

Michael asked to double-check this. **It is genuinely there and complete.**

### 1.2 Parse + persist — COMPLETE
- `src/app/admin/menu-imports/actions.ts:286-313` calls
  `parseLowThcClassification()` and `parseOtherwiseTakenClassification()`,
  redirecting with an error string on a bad value.
- `src/lib/pos/fact-review-store.ts:122-135` — `FACT_COLUMN` maps
  `lowThcLiquid→low_thc_liquid`, `unitThcMg→unit_thc_mg`,
  `otherwiseTaken→otherwise_taken`, `unitsPerPackage→units_per_package`.
- `fact-review-store.ts:160-192` writes those columns onto **`menu_items`**
  (scoped by `menu_version_id` + `source_item_id`) and stamps
  `fact_provenance[column] = "reviewer"`.

### 1.3 Delivery to both surfaces — COMPLETE
- `src/lib/leafly/types.ts:80-96` — `GreenwayMenuItem` carries `lowThcLiquid`,
  `unitThcMg`, `otherwiseTaken`, `unitsPerPackage`.
- `src/lib/pos/live-menu.ts:94-100` maps the DB row onto the item. Line 97
  records that the register rides the same `select("*")`, so **no query change
  is needed** to expose these columns anywhere they are already read.
- `src/app/api/pos/menu/route.ts:175-180` forwards all four to the register
  bundle.
- `src/lib/pos/sale-flow-core.ts:97-113, 327-332, 404-407, 465-477` — the
  register's own product and line types carry and forward the flags.
- `src/components/menu/ProductDetailPurchasePanel.tsx:152-159` forwards them
  into the website cart.

### 1.4 Enforcement — COMPLETE
- `src/lib/compliance/sales-limits-core.ts` — six buckets, unit-aware.
- `src/lib/menu/cart-limit-meter-core.ts` + `src/components/cart/CartLimitMeter.tsx`
  render a per-bucket meter that is already unit-aware (comment at
  CartLimitMeter.tsx:81-83 explicitly handles grams vs mg vs count).
- `src/lib/orders/order-pricing.ts` re-reads the snapshot at the pickup gate.

### 1.5 Back-office settings — COMPLETE
`src/app/admin/compliance/sales-limits/page.tsx` shows all six buckets
(lines 136-171) with editable rec/med fields and explanatory prose at 261-292.

### 1.6 Snapshot — COMPLETE
`supabase/migrations/0217_otherwise_taken_limit.sql` §3 adds all four snapshot
columns to `order_lines` (and repairs SLICE 16's omission).

### 1.7 CCRS reporting — NO CHANGE REQUIRED (verified)
`src/lib/compliance/ccrs-sales.ts:10-25` documents the retail sales field spec
verbatim from the CCRS Upload User Guide. The data columns are LicenseNumber,
SoldToLicenseNumber, InventoryExternalIdentifier, PlantExternalIdentifier,
SaleType, SaleDate, **Quantity**, UnitPrice, Discount, SalesTax, OtherTax,
SaleExternalIdentifier, SaleDetailExternalIdentifier, CreatedBy, CreatedDate,
UpdatedBy, UpdatedDate, Operation.

**There is no bucket/category/route-of-administration field in the CCRS sales
submission.** The limit classification is a POINT-OF-SALE control, not a
reporting field. Adding anything to the CCRS file would be inventing a column
the state does not accept and would risk rejecting the whole upload.

---

## 2. THE GAPS (verified absent)

Each gap below is stated with the grep that proves it, so it can be re-verified.

### GAP 1 — No website filter (HIGH VALUE; Michael's primary ask)
`grep -rn "lowThcLiquid|otherwiseTaken" src/components/menu/InteractiveMenuBrowser.tsx`
returns nothing. `FilterCriteria` (InteractiveMenuBrowser.tsx:327-338) has
query / categories / strains / terpenes / brands / vendors / weights /
maxThc / maxCbd / maxPrice. **No compliance-classification facet.**

A customer who wants low-THC beverages cannot find them. Michael actually
stocks these, so this is the highest-value gap.

**The precedent to mirror is exact:** `src/lib/menu/menu-doh-filter-core.ts`
is a PURE module (no `server-only`, no DB, no React) that derives filter
options from the live items, returns `[]` when nothing qualifies so the
sidebar section simply never renders, and is shared by the client browser, the
server, and vitest. It is registered in the pure self-test runner and has a
test file (`tests/compliance/menu-doh-filter-core.test.ts`).

### GAP 2 — No on-card badge
`src/lib/menu/menu-doh-badge-core.ts` is the precedent: a pure core that owns
BOTH "does this card show the pill" and the pill's label + colour tokens, so
the pill, the sidebar filter, and the register can never disagree. It renders
through `ProductCardVisual`. There is no equivalent for the two new
classifications, so a low-THC beverage is visually identical to a regular
infused drink on the shelf page.

### GAP 3 — No product-detail disclosure
`ProductDetailPurchasePanel.tsx` forwards the flags to the cart (152-159) but
renders nothing about them. A customer buying a 4 mg can is never told it
counts against a separate 200 mg allowance rather than the 72 oz liquid limit.

### GAP 4 — No inventory-page filter or sort (Michael asked for this explicitly)
`src/app/admin/inventory/page.tsx` reads its knobs from
`src/lib/admin/list-filter-core.ts` (`LOT_SORTS`, `parseYesNo`, `resolveSort`)
and `src/lib/inventory/lot-gap-core.ts` (`LOT_GAP_DEFINITIONS`).
`LOT_SORTS` (list-filter-core.ts:50-57) has newest / oldest / expiry /
qty_high / qty_low / name. **No classification filter, no classification sort.**

### GAP 5 — No "unclassified" worklist (COMPLIANCE CONTROL, not convenience)
`LOT_GAP_DEFINITIONS` (lot-gap-core.ts:127-160) defines four gaps:
missingProductLink, emptyActive, missingExpiry, unknownCost. Each has a
`param`, `label`, `weight`, an in-memory `matches` predicate, and a documented
`sqlPredicate`.

The doctrine is already written in that file (lines ~88-95):
**"NULL means UNKNOWN, never 'fine'."**

That is precisely the SLICE 17 fail-safe problem. Migration 0217 already
created the supporting index —
`menu_items_otherwise_taken_unreviewed_idx ... where otherwise_taken is null` —
and its comment says verbatim: *"Because the fail-safe is inverted, this index
is a COMPLIANCE CONTROL, not a convenience."* **The index exists; nothing
queries it.** That is the single most important gap in this document.

### GAP 6 — Lot-level flags are write-only dead columns
`grep -rn "otherwise_taken|units_per_package|low_thc_liquid|unit_thc_mg" src/ | grep -iE "inventory_lots|lots"`
returns **empty**. Migration 0217 added these columns to `inventory_lots`
(and created `inventory_lots_otherwise_taken_flagged_idx`), but no code in
`src/` ever reads or writes them.

Consequence: the classification lives ONLY on `menu_items`, which is a
**menu-version-scoped staging table**. The lot detail page
(`src/app/admin/inventory/[id]/page.tsx`, 929 lines) offers vendor, brand,
strain, price, category, house type, qty, status — **no compliance
classification**. So a mis-flagged product cannot be corrected from the lot;
the only correction path is re-running the import fact review.

### GAP 7 — Catalog/product masters do not know the flags
`grep -rln "otherwise_taken|low_thc_liquid|otherwiseTaken|lowThcLiquid" src/app/admin/products/`
returns **empty**. `products/masters/[id]`, `products/[key]`, and `bulk-ai`
have no notion of these classifications, so a durable product-level default
cannot be set. Every new import re-asks the same question about the same
recurring SKU.

### GAP 8 — No register-side visual indicator
`grep -n "lowThcLiquid|otherwiseTaken|unitsPerPackage" src/app/pos/SaleFlow.tsx`
returns **empty** (SaleFlow.tsx is 5,219 lines). The register *enforces* the
limits through `sale-flow-core.ts`, but the product tiles and the menu popup
show only name / category / price. `filterMenuProducts()`
(sale-grid-core.ts:76-86) filters on **search text + a single category chip
only**. A budtender cannot see or filter by classification.

### GAP 9 — Bulk classification is impossible
`src/lib/pos/fact-review-bulk-core.ts` references the four fields ONLY inside a
test fixture default (lines 248-252), with the comment "the bulk tool must
never invent a classification the reviewer did not make." That discipline is
correct, but it means there is no way to classify 40 cans of the same beverage
line in one action — they must be done one at a time.

### GAP 10 — No `GreenwayCategory` distinction
`src/lib/leafly/types.ts:5-26` lists 21 categories including `edible-liquid`
and `topical`. Both new classifications are **flags on top of** those
categories, not categories themselves.

**RECOMMENDATION: do NOT add new `GreenwayCategory` values.** The bucket is a
route-of-administration/packaging fact, not a merchandising category, and
`sales-limits-core.ts` deliberately notes the category cannot be inferred from
the slug. Adding `suppository` as a category would let the slug drift from the
flag and create two competing sources of truth. Filters and badges should read
the FLAG. This is a deliberate design decision, recorded here so it is not
re-litigated as an oversight.

---

## 3. PROPOSED SEQUENCE (each sub-slice independently shippable)

Ordered by value-to-Michael, with the compliance control first because it is
the only gap that can cause an unlawful sale.

- **18-0 — THE RECEIVING PIPELINE. HIGHEST PRIORITY.** Without this, every
  product received after the Cultivera cutover is permanently unclassifiable
  and a received suppository silently escapes the ten-unit limit. Five parts,
  all mirroring patterns that already exist:
  1. **Detect at the door.** Call `suspectsOtherwiseTaken({ name,
     inventoryType })` from `summarizeIntakeForReview()` and emit a per-line
     flag, alongside the existing COA/sample/failed-lab flags. The parser
     already supplies both inputs. Consider a low-THC counterpart driven off
     category + packaging, but ONLY as a prompt to ask a human — never as a
     derived classification (deriving it is the SLICE 16 servings-vs-units
     mistake).
  2. **Carry the fact.** Add the four fields to `ParsedLine` (seeded null,
     never guessed) and to the `inventory_lots` insert, which finally makes the
     `inventory_lots` columns from 0217 live rather than dead (this also
     resolves GAP 6).
  3. **Ask a human at Product Onboarding.** Add the classification picks to
     the drafts form and to `CatalogDraft` / `approveDraftWithPrice()`,
     following the SLICE 64 gate pattern exactly — server-side re-derivation,
     never trust the form, friendly missing-migration error.
  4. **Decide the gate posture (OWNER DECISION REQUIRED — see §5).**
  5. **Carry it to the shelf.** Thread the flags through
     `draft-injection.ts` / `intake-menu-staging.ts` into `menu_items`, so the
     website and register receive them exactly as they do from the import path.
     A feature-parity test must prove import and receiving produce identical
     classification outcomes for identical products.
- **18A — Unclassified worklist + inventory filters/sorts.** Add gap
  definitions for "active, on a topical/edible shelf, `otherwise_taken IS NULL`"
  and the low-THC equivalent; add matching `LOT_SORTS` entries and status
  filters. Uses the index 0217 already created. *This closes the inverted
  fail-safe with a human control.*
- **18B — Website filter facet.** New pure core mirroring
  `menu-doh-filter-core.ts`, wired into `FilterCriteria`, the sidebar,
  `FilterTags`, and URL persistence (`?doh=` is the precedent).
- **18C — Badges + PDP disclosure.** New pure core mirroring
  `menu-doh-badge-core.ts`; render through `ProductCardVisual`; add an
  allowance explainer to the PDP.
- **18D — Register visibility + filter.** Extend `PosMenuProduct` display,
  add a classification chip to `filterMenuProducts()`, show a tile marker.
- **18E — Lot-level truth + correction path.** Decide and document whether
  `inventory_lots` is authoritative or derived; make the lot page able to
  correct a classification; make the dead columns live or explicitly retire
  them.
- **18F — Catalog defaults + safe bulk classify.** Product-master default that
  pre-fills fact review, and a bulk action that still records a reviewer
  decision per row (never an invented one).

---

## 3b. EXACT FILE-TOUCH MAP (verified paths)

**18-0 — receiving pipeline**
- `src/lib/inventory/intake-parser.ts` — `ParsedLine` (44-67); seed the four
  fields null at the two construction sites (~400-409, ~468-477, ~595).
- `src/lib/inventory/intake-review-core.ts` — `summarizeIntakeForReview()`
  (70-155); add the per-line classification flag next to the COA check.
  Importing `suspectsOtherwiseTaken` from
  `@/lib/compliance/sales-limits-core` keeps ONE detector shared with the cart
  warning — do not write a second regex.
- `src/lib/inventory/intake-store.ts` — the `inventory_lots` insert (524-556).
- `src/lib/inventory/lot-activation-gate-core.ts` — `LotGateFacts` +
  `LotGateReasonCode` (22-42) **only if** the owner chooses the hard-gate
  posture in §5.
- `src/app/admin/inventory/drafts/page.tsx` — the approval card form.
- `src/lib/inventory/catalog-drafts.ts` — `CatalogDraft` (44-81) and
  `approveDraftWithPrice()` (471-546).
- `src/lib/pos/draft-injection.ts` — `DRAFT_COLS` (59) + item build (220-244).
- `src/lib/pos/intake-menu-staging.ts` — snapshot persistence.
- NEW migration — `catalog_product_drafts` classification columns (follow the
  0141/0146 precedent, including the friendly missing-column error path).
- `src/lib/inventory/intake-checklist-core.ts` — consider a checklist item, so
  the dock staff see classification as an explicit step.

**18A — worklist + inventory filters**
- `src/lib/inventory/lot-gap-core.ts` — new entries in `LOT_GAP_DEFINITIONS`
  (each needs `key`, `param`, `label`, `weight`, `matches`, `sqlPredicate`).
- `src/lib/admin/list-filter-core.ts` — new `LOT_SORTS` entries.
- `src/app/admin/inventory/page.tsx` — knob parsing + status tabs + links.
- `src/lib/insight/inventory.ts:106` — already loops `LOT_GAP_DEFINITIONS`,
  so new gaps surface in the insight panel automatically. **Verify, don't assume.**
- Store-side predicates must match the counter exactly; `lot-gap-core.ts`
  documents that an equivalence test (not the `sqlPredicate` string) is the
  real pin.

**18B — website filter**
- NEW `src/lib/menu/menu-compliance-filter-core.ts` (pure, mirrors
  `menu-doh-filter-core.ts`).
- `src/components/menu/InteractiveMenuBrowser.tsx` — `FilterCriteria` (line
  ~327), the `useMemo` options block (~742), the URL-persistence effect
  (~770-790, where `doh` is written), and the sidebar render.
- `src/components/menu/FilterMobile.tsx` — mirrors the desktop sidebar; `doh`
  appears at lines 7, 133, 171, 176, 245, 254, 266. Every one needs a sibling.
- `src/app/menu/page.tsx` — server-side param forwarding (`withDohCompliance`
  at line 18 is the precedent for a server enrichment step).
- `scripts/compliance/run-pure-selftests.ts` — register the new core
  (lines 405-407 / 722-724 show the exact two-line pattern).
- `src/components/menu/FilterTags.tsx` — **no change needed**; it is generic
  (`{ tags, onClearAll }`), so an added tag flows through.
- `src/components/menu/FilterSection.tsx` / `FilterCheckboxGroup.tsx` —
  **no change needed**; generic building blocks.

**18C — badges/PDP**
- NEW `src/lib/menu/menu-compliance-badge-core.ts` (mirrors
  `menu-doh-badge-core.ts`, incl. tone constants for one-line recolour).
- `src/components/menu/ProductCardVisual.tsx` — the shared pill lane.
- `src/components/menu/ProductDetailPurchasePanel.tsx` — allowance disclosure.
- Register the badge core in the pure self-test runner.

**18D — register**
- `src/lib/pos/sale-grid-core.ts` — `filterMenuProducts()` (76-86) currently
  takes `(products, query, category)`; needs a classification knob.
- `src/app/pos/SaleFlow.tsx` — chip state (~2150), the filter `useMemo`
  (~2261), and the product tile (~1899-1923).
- `src/lib/pos/sale-flow-core.ts` — `PosMenuProduct` already carries the flags;
  confirm no type change is needed before editing.

**18E — lot truth**
- `src/app/admin/inventory/[id]/page.tsx` (929 lines) + its action.
- Decide: is `inventory_lots.otherwise_taken` authoritative, derived from
  `menu_items`, or retired? Document the answer in the migration comment.

**18F — catalog defaults**
- `src/app/admin/products/masters/[id]/page.tsx`, `src/app/admin/products/[key]/page.tsx`.
- `src/lib/pos/fact-review-bulk-core.ts` — bulk classify that still records a
  real reviewer decision per row.

## 3c. OPEN QUESTION FOR THE OWNER (do not guess this)

**How hard should the classification gate be at Product Onboarding?**

The codebase already demonstrates BOTH postures inside the same function, so
either is idiomatic here and neither requires new machinery:

- **HARD GATE** (the SLICE 64 website-category/house-type posture): approval is
  REFUSED until a human answers. Safest — nothing reaches the shelf
  unclassified. Cost: one extra required answer on every single approval,
  including flower and cartridges where the question is obviously "no."

- **TARGETED GATE** (recommended): required ONLY when the product could
  plausibly be affected — i.e. it resolves to the `topical` / `edible-liquid`
  buckets, or `suspectsOtherwiseTaken()` fires on the name/inventory type.
  Everything else defaults to "no" **with that default recorded as a machine
  decision, not a human one**, so provenance stays honest. This mirrors SLICE
  64's own logic, which gates only when the resolver is uncertain or the
  labeler is below 90% confidence.

- **SOFT PROMPT** (the SLICE 93 strain-type posture): optional pick, never
  blocks. Cheapest, but given SLICE 17's INVERTED fail-safe an unanswered
  suppository sails through unlimited — this posture is **not recommended for
  `otherwise_taken`**, though it may be adequate for `low_thc_liquid`, whose
  failure direction is a safe under-sell.

A defensible split is: **targeted-gate `otherwise_taken`** (inverted fail-safe,
permissive failure = unlawful sale) and **soft-prompt `low_thc_liquid`**
(conservative fail-safe, failure = a lawful but smaller sale). That asymmetry
would need to be recorded and justified in the feature-parity test rather than
left to look like an oversight.

**This is a business judgment about counter workflow, not a legal question.
It is not mine to decide, and I will not assume it.**

## 4. TESTING POSTURE FOR THE BUILD ROUND

Existing test surface to extend rather than duplicate:
`low-thc-liquid-{limit,intake,plumbing,feature-parity,truth-surfaces}.test.ts`,
`otherwise-taken-{limit,intake,both-surfaces,truth-surfaces}.test.ts`,
`list-filter-core.test.ts`, `menu-doh-filter-core.test.ts`.

Non-negotiables carried forward: RED first; never loosen an assertion, only
strengthen; verified-anchor splices; mutation-test every new predicate with a
pre-flight that proves each anchor matched exactly once; `todo.md` untouched.

**Feature parity is the specific risk in this slice.** SLICE 16 already ships
`low-thc-liquid-feature-parity.test.ts`. Every surface added for one
classification must be added for the other, or a parity test must record and
justify the asymmetry.

**A SECOND parity axis is now required: IMPORT vs RECEIVING.** The whole reason
this recon round happened is that SLICE 16/17 were built and tested against the
import path only, and the receiving path was never considered. A test must pin
that an identical product classified through receiving produces an identical
limit outcome to one classified through import. Without that test, the same
blind spot recurs the next time a third intake route is added.

**A NAMING TRAP THAT HELPED HIDE THIS GAP.** `tests/compliance/
otherwise-taken-intake.test.ts` and `low-thc-liquid-intake.test.ts` sound like
they cover receiving. They do not. Both import only
`parseOtherwiseTakenClassification` / `parseLowThcClassification` from
`@/lib/pos/fact-review-core` — "intake" there means *the fact-review form
parser*, not the physical dock. Meanwhile the genuine receiving suites
(`po-receive-core`, `intake-menu-staging-core`, `draft-injection-core`,
`intake-checklist-core`, `receiving-tabs`, `intake-partial-accept`) contain
nothing about these flags. Any new receiving tests should be named
unambiguously (e.g. `otherwise-taken-receiving.test.ts`) so this collision does
not mislead the next reader.

Additional cores to register in `scripts/compliance/run-pure-selftests.ts` and
to mutation-test: the intake-review classification flag, and (if adopted) the
new activation-gate reason code. Existing intake tests to extend rather than
duplicate: search `tests/compliance/` for the intake-review, lot-activation,
and draft-injection suites before writing anything new.
