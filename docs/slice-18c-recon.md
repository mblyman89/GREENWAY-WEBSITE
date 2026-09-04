# SLICE 18C — RECON (badges + PDP disclosure)

Standing rule: *"do not guess, do not assume. we build from fact, not memory."*
Every claim below carries a `file:line` so the next slice can re-verify it
rather than trusting this document.

Scope comes from Michael's own roadmap, not from my imagination
(`docs/slice-18-integration-recon.md:343-346`, verbatim):

> **18C — Badges + PDP disclosure.** New pure core mirroring
> `menu-doh-badge-core.ts`; render through `ProductCardVisual`; add an
> allowance explainer to the PDP.

And the file-touch map (`:410-416`):

> - NEW `src/lib/menu/menu-compliance-badge-core.ts` (mirrors
>   `menu-doh-badge-core.ts`, incl. tone constants for one-line recolour).
> - `src/components/menu/ProductCardVisual.tsx` — the shared pill lane.
> - `src/components/menu/ProductDetailPurchasePanel.tsx` — allowance disclosure.
> - Register the badge core in the pure self-test runner.

Four deliverables. Nothing else is in scope.

---

## F1. The precedent: `menu-doh-badge-core.ts` is the exact template

Read in full (`src/lib/menu/menu-doh-badge-core.ts`, 6,682 bytes). Its shape is
the house pattern for "a compliance trait rendered as an on-card pill":

| Element | Purpose |
| --- | --- |
| `DOH_PILL_LABEL` | wording as a constant, so copy is a one-line change |
| `DohPillTone = { id, border, text, dot }` | Tailwind fragments, not colours |
| `DOH_PILL_TONE_BLUE / _PURPLE / _GREEN` | named alternates |
| `DOH_PILL_TONE` | **the active tone** — recolour is one assignment |
| `dohPillForItem(item)` | returns a spec, or `null` = render nothing |
| `shouldShowDohPill(item)` | convenience predicate, `!== null` |
| `__runMenuDohBadgeCoreTests()` | pure self-tests, registered in CI |

Two design rules are stated explicitly in its header and both bind 18C:

1. **It reuses the filter's predicate.** `dohPillForItem` calls
   `isItemDohCompliant` (`:24`, `:81`) "so the pill, the sidebar filter, and the
   register can never disagree." 18B already established
   `itemHasClassification` as that shared predicate for our two lanes, so 18C
   must call it rather than re-testing the flags.
2. **Null means render nothing.** "Ships WORKING pre-migration: a non-compliant
   item yields null → no pill, exactly like today." Our equivalent: a product
   that does not affirmatively qualify gets no pill.

## F2. The pill lane in `ProductCardVisual.tsx` — verified geometry

`src/components/menu/ProductCardVisual.tsx:285-291` computes `dohPill`
**outside** the cannabinoid block, deliberately, so a DOH item always shows its
pill even when the profile pill is suppressed. It renders at `:369-381` inside
`<div className="mb-3 grid gap-2 text-center">` (`:357`), between the
strain-type banner (`:360-368`) and the cannabinoid block (`:382`).

The pill markup is a `rounded-full border` + `bg-black/45` + `backdrop-blur-sm`
span with a leading `h-1.5 w-1.5 rounded-full` dot. 18C's pill must reuse this
exact shape so it "sits naturally in the pill lane" — the same requirement
Michael gave for DOH.

**One visual serves both card types**: `ProductCard.tsx:32` and
`RelatedProductCard.tsx:36` both render `<ProductCardVisual>`. So a single edit
covers the menu grid AND the "More from" carousel on the PDP. Verified by
`grep -rn "ProductCardVisual" src/ --include=*.tsx`.

## F3. DECISIVE — the PDP already carries the flags, so again no server work

`src/app/menu/products/[id]/page.tsx:104-106` resolves the item via
`getLiveMenuItemById`, which (`src/lib/pos/live-menu.ts:145-149`) reads
`loadLiveMenuItems()` and therefore flows through
`menuRowToGreenwayItem` (`:75`). That mapper sets all four fields at
`live-menu.ts:93,94,98,99`:

```
lowThcLiquid:    row.low_thc_liquid    ?? null
unitThcMg:       row.unit_thc_mg       ?? null
otherwiseTaken:  row.otherwise_taken   ?? null
unitsPerPackage: row.units_per_package ?? null
```

**Consequence: no server overlay, no new DB read, no migration — again.** Same
reason 18B was additive. The PDP already proves it uses them:
`ProductDetailPurchasePanel.tsx:155-159` passes all four into the cart so the
meter applies the right bucket.

## F4. GAP FOUND — the PDP threads DOH compliance but never renders it

`page.tsx:303-305` runs `withDohCompliance(...)` on every non-merch item, and
the comment at `:300-302` states the intent plainly: *"thread the DOH-compliant
flag onto the detail item too… so the product page agrees with the menu card."*

But `grep -rn "menu-doh-badge-core" src/` returns **exactly one consumer**:
`ProductCardVisual.tsx:8`. The PDP never imports it. The PDP's own chip row
(`page.tsx:404-440`) renders merch/strain/profile/cannabinoid/net-weight chips —
**no DOH pill**.

So today: a DOH product's card shows the blue DOH pill; you click it and the
detail page silently drops it. The page pays the registry-read cost and shows
nothing. This is the same class of defect as 18B's un-forwarded `?doh=`, found
the same way — by checking whether the precedent actually does what it claims.

**In scope?** Yes, narrowly. The roadmap says 18C renders badges "through
`ProductCardVisual`" and the PDP gets an "allowance explainer". A new
classification pill that appears on the card and then vanishes on the PDP would
reproduce this bug in new code. Fixing the DOH omission at the same time costs
one import and keeps the two facets symmetric. **D6** records the decision.

## F5. Verified statutory figures (never paraphrase these)

Ran the real constants through the real formatter (`npx tsx`, output captured):

```
usable           rec= 1 oz         med= 3 oz         triples
solid_edible     rec= 16 oz        med= 48 oz        triples
concentrate      rec= 7 g          med= 21 g         triples
liquid_edible    rec= 72 oz        med= 216 oz       triples
low_thc_liquid   rec= 200 mg THC   med= 200 mg THC   <== IDENTICAL
otherwise_taken  rec= 10 units     med= 10 units     <== IDENTICAL
```

**The two buckets 18C discloses are the ONLY two that do not triple for a
DOH-database patient.** `sales-limits-core.ts:239-256` documents why in
capital letters ("⚠ DO NOT 'FIX' low_thc_liquid TO 600") and `:263-269` says
the statute does not list `otherwise_taken` in the medical subsection at all.

This is a hard constraint on the disclosure copy: it must NOT say or imply
"medical patients get more", and it must not hard-code figures. It will read
them from `RECREATIONAL_LIMITS` / `formatLimitAmount` so the wording tracks the
constants automatically.

Owner-facing bucket wording already exists and must be reused, not reinvented
(`sales-limits-core.ts:139-146`):

- `low_thc_liquid: "Low-THC beverages (≤ 4 mg THC per unit)"`
- `otherwise_taken: "Products otherwise taken into the body (suppositories)"`

Note these are OWNER/admin phrasings. 18B already introduced the shopper-facing
equivalents (`CLASSIFICATION_FILTER_LABELS` = "Low-THC Beverages" /
"Suppositories") plus `CLASSIFICATION_FILTER_HELP`. The badge and the PDP must
use the **shopper** vocabulary so the pill, the sidebar checkbox and the
explainer all say the same words.

## F6. Existing customer-facing limit language (the tone to match)

`src/components/cart/CartLimitMeter.tsx` (121 lines) is the only place we
currently explain limits to a shopper. Verified wording:

- header `"Legal limit (WAC 314-55-095)"` (`:57`)
- unit-aware readout `${mg} / ${max}mg THC` (`:85-86`)
- near-limit copy: *"You're close to Washington's per-visit limit on one
  category. You can still check out — final limits are confirmed in store."*
  (`:114-116`)

Two things to copy: it cites the WAC, and it defers final authority to the store
("confirmed in store"). The 18C explainer will do both. It will NOT promise a
quantity, because the true maximum depends on the rest of the basket — the cart
meter is the honest place for arithmetic.

## F7. The PDP panel is a client component with the item in hand

`ProductDetailPurchasePanel.tsx:1` is `"use client"`, receives the full
`GreenwayMenuItem` (`:15-17`), and already reads the four flags at `:155-159`.
So the explainer needs **no new prop and no new data** — pure derivation, which
is what keeps this additive.

Insertion point: after the deal badge (`:107-112`) and before the price block
(`:114-119`), so the disclosure sits above the money and the Add-to-Cart button
rather than being buried under the fold.

## F8. Self-test registration pattern

`scripts/compliance/run-pure-selftests.ts` — 18B registered its cores at
`:415-416` (imports) and `:740-741` (calls), each with the `passed < 1`
anti-vacuity guard. 18C follows the identical two-line pattern. Note
`__runMenuDohBadgeCoreTests` returns `{ passed: number }`, so the new core will
too (some older cores return `void`; ours must return a count so the guard is
meaningful).

---

## Decisions

- **D1.** New pure core at `src/lib/menu/menu-classification-badge-core.ts`.
  The roadmap suggested the name `menu-compliance-badge-core.ts`, but 18B
  shipped `menu-classification-filter-core.ts`; matching that stem keeps the
  facet's two halves adjacent and greppable. Noted as a deliberate,
  documented deviation.
- **D2.** The badge calls 18B's `itemHasClassification`, never the raw flags.
  A pill keyed on `lowThcLiquid === true` would label a 10 mg drink a "Low-THC
  Beverage" while the register still counts it in the 72 oz bucket. Same trap
  as 18B, same defence: one predicate.
- **D3.** Two pills, one per lane, using 18B's shopper labels. Short forms for
  the card ("LOW-THC" / "SUPPOSITORY") because the lane is a narrow
  `text-[0.62rem]` column; the full label rides in `title` for hover/assistive
  text.
- **D4.** Distinct tones, with named alternates for one-line recolour, matching
  the DOH core's structure exactly. DOH owns blue; the deal badge and profile
  dot own green. So the two new pills must avoid blue and green to stay
  unambiguous. Michael can recolour by editing one assignment.
- **D5.** The PDP explainer derives its figures from `RECREATIONAL_LIMITS` via
  `formatLimitAmount`, cites WAC 314-55-095, and defers to the cart meter and
  the store for the final number. It never states a medical multiple (F5).
- **D6.** Render the missing DOH pill on the PDP chip row at the same time
  (F4). One import, restores the stated intent of `page.tsx:300-302`, and stops
  the new pill from inheriting the same asymmetry.
- **D7.** No PDP disclosure for products in no lane — silence, not "this is an
  ordinary product". `types.ts` documents `otherwiseTaken: null` as the
  PERMISSIVE direction, so a negative statement about an unreviewed product
  would be a claim we cannot support (the same honesty rule that killed 18B's
  "unclassified" lane).
- **D8.** No new prop on `ProductCardVisual` / `ProductDetailPurchasePanel`.
  Both already receive the item; deriving in place is what makes 18C additive.

## Non-goals (explicitly out of scope)

- No register visibility/filter UI — that is **18D**.
- No lot-level truth or correction path — **18E**.
- No catalog defaults or bulk classify — **18F**.
- No migration, no new DB read, no server overlay (F3).
- No new filter, sort, or URL param — 18B owns those and they are untouched.
- No arithmetic promise of "you may buy N" on the PDP (F6).

---

# BUILD ADDENDUM — what was actually built and proven

Written after the build, from verified command output only. Every figure below
was read off a real run, not recalled.

## Files delivered

| File | Change |
| --- | --- |
| `src/lib/menu/menu-classification-badge-core.ts` | **new** pure core, 75 self-test assertions |
| `src/components/menu/ProductCardVisual.tsx` | derive + render the pill lane (serves both card types) |
| `src/components/menu/ProductDetailPurchasePanel.tsx` | allowance disclosure above the price |
| `src/app/menu/products/[id]/page.tsx` | classification pills **+ the DOH repair (D6)** |
| `scripts/compliance/run-pure-selftests.ts` | register the new core in CI |
| `scripts/slice18c/run-selftests.ts` | fast runner: badge + filter + doh cores |
| `tests/compliance/menu-classification-badge-core.test.ts` | 28 tests |
| `tests/compliance/classification-badge-plumbing.test.ts` | 26 tests |
| `scripts/slice18c/mutate.py` | 18-mutant harness |

No migration. No new DB read. No server overlay. F3 held: the PDP item already
carries all four flags through `menuRowToGreenwayItem`.

## The DOH gap (F4) — repaired

`page.tsx` had always called `withDohCompliance(...)`, its own comment stating
the intent "so the product page agrees with the menu card", while no PDP
surface rendered the result. The registry read was paid for and thrown away and
a DOH product silently lost its pill on click. 18C renders it. Mutant **M16**
re-introduces the old bug and the suite now fails — the defect can never return
unnoticed.

## Mutation testing — "test everything including the tests"

Two rounds. A green suite is not evidence; a suite that *notices* is.

**Round 1: 17/18 killed, 1 survivor.**

`M15-pdp-drops-cart-flags` SURVIVED. The mutant kept the key and nulled the
value:

```
lowThcLiquid: item.lowThcLiquid ?? null,   ->   lowThcLiquid: null,
```

The guarding assertion was `expect(code).toContain("lowThcLiquid")` — the word
is still present, so the test stayed green. **This is the exact failure mode
18B's round #1 exposed**: a text match proves a word exists, never that a value
is right. The consequence was not cosmetic — it is the SLICE 16 defect
returning, with the cart meter measuring a low-THC beverage against the 72 oz
`liquid_edible` allowance instead of the 200 mg THC allowance, so the meter on
screen would disagree with the till.

**The fix strengthened the suite, never softened the mutant.** Four behavioural
tests now extract the real object literal handed to `addItem()` by brace
balancing, EVALUATE it against a fixture item, and push the result through the
same `lineBucket()` the cart meter uses. Verified by live probe before the tests
were written:

```
REAL   drink bucket       = low_thc_liquid     <- 200 mg allowance
M15    drink bucket       = liquid_edible      <- 72 oz: the regression
REAL   suppository bucket = otherwise_taken    <- ten-unit allowance
```

One of the four is a test OF THE TEST: it applies M15's edit to an in-memory
copy and asserts the harness notices, so a future no-op refactor of the
extractor fails loudly. Anti-vacuity guards pin `productId` and a key count so
an empty object can never pass.

A fixture note worth keeping: both predicates require
`categoryToBucket(category) === "liquid_edible"`, so a fixture using a
non-slug category (`"drinks"`) yields a `null` bucket and proves nothing. The
real slugs are `edible-liquid` / `topical`. Read from source, not assumed.

**Round 2: 18/18 killed, 0 survivors.** Post-restore baseline green.

## Verification (all commands run, all green)

```
npx vitest run                                  546 files / 13892 tests passed
  menu-classification-badge-core.test.ts        28 passed
  classification-badge-plumbing.test.ts         26 passed
npx tsx scripts/slice18c/run-selftests.ts       159 assertions (75 + 71 + 13)
npx tsx scripts/compliance/run-pure-selftests.ts  ALL PURE SELF-TESTS PASSED
npx tsc --noEmit -p tsconfig.json               exit 0
npx eslint <7 touched files>                    exit 0, zero warnings
ls supabase/migrations/*.sql | wc -l            218 (unchanged), sorted, 0 dup prefixes
wc -l todo.md                                   3577 (untouched)
grep '\uXXXX' in touched JSX                    none — real em dashes only
python3 scripts/slice18c/mutate.py              18/18 killed, 0 survivors
```

The 18C runner deliberately includes the **filter** and **doh-badge** cores as
well as the new one. That is the direct lesson of 18B round #1, where a mutant
survived purely because its core was missing from the fast runner and four
assertions never executed.

## Statutory pin (F5) — the trap this slice had to avoid

`low_thc_liquid` and `otherwise_taken` are the **only two** buckets that do NOT
triple for medical. Verified by live run:

```
low_thc_liquid   rec=200 mg THC   med=200 mg THC   IDENTICAL
otherwise_taken  rec=10 units     med=10 units     IDENTICAL
```

Copy therefore never states a medical multiple, and the suite pins
`MEDICAL_LIMITS === RECREATIONAL_LIMITS` for both buckets. Mutants **M05** and
**M07** attack precisely this and both die. The disclosure renders
`10 units` — not `0.357 oz` — with **M04** (unit-blind formatter) proving the
unit trap is guarded.
