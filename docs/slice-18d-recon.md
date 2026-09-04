# SLICE 18D — RECON

**Register visibility + filter.** Everything below was read from primary
source and, where behaviour was in question, executed. Nothing is recalled and
nothing is assumed. Line numbers are from `c8e63742` (18C merged).

## Scope, quoted from the owner's own roadmap

`docs/slice-18-integration-recon.md:346-347`, verbatim:

> **18D — Register visibility + filter.** Extend `PosMenuProduct` display,
> add a classification chip to `filterMenuProducts()`, show a tile marker.

The file-touch map (`:428-434`) names three locations and one instruction:

> - `src/lib/pos/sale-grid-core.ts` — `filterMenuProducts()` (76-86) currently
>   takes `(products, query, category)`; needs a classification knob.
> - `src/app/pos/SaleFlow.tsx` — chip state (~2150), the filter `useMemo`
>   (~2261), and the product tile (~1899-1923).
> - `src/lib/pos/sale-flow-core.ts` — `PosMenuProduct` already carries the flags;
>   **confirm no type change is needed before editing.**

That last instruction is an order to verify, not to trust. F1 and F2 below are
that verification.

---

## Findings

### F1 — `PosMenuProduct` carries all four flags. No type change. CONFIRMED.

`sale-flow-core.ts:69-123`. The flags are present and documented:

| Field | Line | Type |
| --- | --- | --- |
| `lowThcLiquid` | 102 | `boolean \| null` **optional** |
| `unitThcMg` | 108 | `number \| null` **optional** |
| `otherwiseTaken` | 118 | `boolean \| null` **optional** |
| `unitsPerPackage` | 123 | `number \| null` **optional** |

They are OPTIONAL by deliberate design, and the comments say why: *"Optional so
bundles cached before SLICE 16 still parse."* A register running a stale
offline bundle simply lacks the keys.

`sale-flow-core.ts:113-116` records that the fail-safe **inverts** between the
two flags:

> *"the fail-safe INVERTS versus lowThcLiquid: an old bundle missing this flag
> counts a suppository as a normal liquid, which is PERMISSIVE, not
> restrictive."*

This is the single most important fact in this slice. It is the reason 18D must
never render a NEGATIVE claim. Absence of a flag is not evidence of an ordinary
product; it may simply be a device that has not re-synced.

### F2 — the flags reach the device. CONFIRMED.

`src/app/api/pos/menu/route.ts:175-180` serialises all four into the bundle.
No API change, no migration, no new read.

### F3 (DECISIVE) — `PosMenuProduct` is NOT assignable to the shop's predicate helper.

`itemHasClassification()` (`menu-classification-filter-core.ts:173-184`) accepts
a `Pick<GreenwayMenuItem, "category" | "lowThcLiquid" | ...>`. That looked
reusable. It is not. Verified by compiling a probe under the project's own
`tsconfig.json`:

```
error TS2345: Argument of type 'PosMenuProduct' is not assignable to parameter
  of type 'Pick<GreenwayMenuItem, "category" | "lowThcLiquid" | ...>'.
  Property 'lowThcLiquid' is optional in type 'PosMenuProduct'
    but required in type 'Pick<GreenwayMenuItem, ...>'.
```

`GreenwayMenuItem` declares the fields as required-but-nullable; `PosMenuProduct`
declares them optional. Had I "reused the shop core" on the strength of the
roadmap sentence alone, the build would have broken. An adapter is mandatory.

### F4 — the register ALREADY has a classification core. Extend it, do not rebuild.

`src/lib/pos/classification-search-core.ts` (221 lines) shipped in 18B. It
already declares exactly the shape this slice needs:

```ts
export type ClassifiableProduct = {
  category?: string | null;
  lowThcLiquid?: boolean | null;
  unitThcMg?: number | null;
  otherwiseTaken?: boolean | null;
  unitsPerPackage?: number | null;
};
```

Every field optional — structurally compatible with `PosMenuProduct`, which is
precisely what F3 says the shop's type is not. It also owns a private `toLine()`
adapter and delegates to `qualifiesAsLowThcLiquid` / `qualifiesAsOtherwiseTaken`.
This module is the correct home for 18D's logic.

### F5 — search is already wired; the CHIP and the TILE MARKER are the real gaps.

`searchProducts()` (`sale-flow-core.ts:303-320`) already appends
`classificationSearchText(p)`, so typing "suppository" already works. 18D must
not re-solve that.

What genuinely does not exist:

```
$ grep -n "classification|lowThcLiquid|otherwiseTaken|Low-THC|Suppository" src/app/pos/SaleFlow.tsx
(no matches)
```

**Zero occurrences in 5,219 lines.** The register can find these products by
typing a word, but a budtender who does not already know a product is special
is never told. There is no chip and no tile marker.

### F6 — `filterMenuProducts()` has TWO call sites with DIFFERENT intent.

The map mentions the filter `useMemo`. There are two:

- `SaleFlow.tsx:2261` — `results`, the overlay grid. Honours the category chip.
- `SaleFlow.tsx:2267` — `quickResults`, main-screen quick search, passes
  `category: null` **on purpose**. Comment at `:2265-2266`:
  > *"AM-A — main-screen quick-search rows ignore the overlay's category chip:
  > an invisible filter on the main screen would look like missing products."*

That reasoning applies verbatim to a classification chip: a hidden filter on
the main screen would read as missing inventory. The new knob must default to
"no filter" so `quickResults` is untouched.

Every existing call passes three positional arguments, so a fourth OPTIONAL
parameter is backward compatible (`tests/compliance/sale-grid-core.test.ts`
calls it six times with three args; those must keep passing unchanged).

### F7 — the tile marker has an exact precedent: `StockBadge`.

`SaleFlow.tsx:5112-5124`. A tiny component taking `{ product }`, returning
`null` when there is nothing to say, rendered inline inside the tile's name
line (`:1928`). Null-means-silence is the same contract as the DOH pill and the
18C classification pill. `ProductTile` (`:1885-1897`) already receives the whole
`PosMenuProduct`, so a marker needs **no new prop**.

### F8 — the chip row is a flat `<div>` of buttons, gated on `chips.length > 0`.

`SaleFlow.tsx:3308-3342`. "All" button then `chips.map`. Touch targets are
`min-h-11` for a reason — comment at `:3310-3312` cites *"44px-min touch targets
(Apple HIG 44pt / WCAG 2.5.5)"* because *"chips were px-3 py-1.5 text-xs, too
small for confident finger taps during an 8-hour shift."* Any chip I add must
match `min-h-11`.

Note the whole row is hidden when `chips.length === 0`. A classification chip
must not be stranded inside that gate.

### F9 — import direction: the register does not depend on the shop.

`SaleFlow.tsx` imports nothing from `@/lib/menu/` (0 matches). Only one file
under `src/lib/pos/` does (`live-menu.ts:37`, a server file). So the register UI
must NOT import the shop's badge/filter cores for labels.

The shared vocabulary already exists in the module BOTH sides depend on:
`sales-limits-core.ts:139-145`

```ts
low_thc_liquid:  "Low-THC beverages (≤ 4 mg THC per unit)",
otherwise_taken: "Products otherwise taken into the body (suppositories)",
```

and `LIMIT_BUCKET_UNITS` (`:160-171`) carries the unit-trap warning:

> *"Any formatter that assumes a weight will render '10 units' as '0.357 oz',
> which is both meaningless and dangerously wrong."*

---

## Decisions

- **D1.** Extend `src/lib/pos/classification-search-core.ts` rather than create a
  new core (F4). It already owns `ClassifiableProduct`, the adapter, and the
  delegation rule. A second POS core would duplicate the adapter and invite
  drift — the exact failure 18B's shared-predicate rule exists to prevent.
- **D2.** Add an **optional 4th parameter** to `filterMenuProducts()` defaulting
  to no-filter, so both existing call sites and all six existing test calls are
  byte-for-byte unaffected (F6).
- **D3.** Every decision delegates to `qualifiesAsLowThcLiquid` /
  `qualifiesAsOtherwiseTaken`. A chip, a marker and the limit meter must be the
  same fact — never two opinions. Same rule as 18B/18C.
- **D4.** Chips are derived from the products actually in the bundle, and render
  only when at least one product qualifies (the dynamic-lane contract from 18B).
  A chip for an empty lane is a promise of inventory that is not there.
- **D5.** Labels come from POS-side constants seeded from the statutory
  vocabulary, NOT by importing `@/lib/menu/*` (F9). Register chips must be short
  enough for a touch target; the full statutory phrasing rides in `title`.
- **D6.** **No negative claim, ever.** An unmarked tile means "no classification
  on this bundle", never "this is an ordinary product" — because F1 proves a
  stale bundle looks identical to an unclassified product, and for
  `otherwiseTaken` that absence is the PERMISSIVE direction.
- **D7.** The classification chip is INDEPENDENT of the category chip. They
  compose (`AND`), because "flower" and "suppository" answer different
  questions and a budtender may legitimately want both narrowed.
- **D8.** No new props on `ProductTile` (F7) and no change to `PosMenuProduct`
  (F1). 18D stays additive.
- **D9.** `quickResults` keeps passing "no classification filter", preserving
  the AM-A reasoning at `:2265-2266` (F6).

## Non-goals (explicitly out of scope)

- No new search behaviour — 18B already wired the keywords (F5).
- No change to `PosMenuProduct`, the bundle format, or `/api/pos/menu` (F1, F2).
- No `ProductInfoModal` work — that is a separate component and a later slice.
- No lot-level truth or correction path — **18E**.
- No catalog defaults or bulk classify — **18F**.
- No migration, no new DB read (F2).
- No arithmetic "you may sell N more" promise on a tile; the limit meter owns
  quantity maths.

---

# BUILD ADDENDUM — what was actually built and proven

Written after the build, from verified command output only.

## Files delivered

| File | Change |
| --- | --- |
| `src/lib/pos/classification-search-core.ts` | **extended** (18B's core) — lanes, labels, predicate, chips. 70 self-test assertions (was 25) |
| `src/lib/pos/sale-grid-core.ts` | optional 4th `classification` parameter on `filterMenuProducts()`. 31 assertions (was 20) |
| `src/app/pos/SaleFlow.tsx` | chip state + derived active lane, chip row, `ClassificationBadge` tile marker |
| `scripts/slice18d/run-selftests.ts` | fast runner: search + grid + flow cores |
| `tests/compliance/pos-classification-visibility.test.ts` | 28 tests |
| `tests/compliance/pos-classification-plumbing.test.ts` | 19 tests |
| `scripts/slice18d/mutate.py` | 21-mutant harness |

**No new core was created.** Recon F4 found 18B had already shipped
`classification-search-core.ts` with a `ClassifiableProduct` shape whose
optional fields match `PosMenuProduct` exactly. Extending it means one adapter,
one delegation rule, one place to change. No migration, no new DB read, no API
change, no change to `PosMenuProduct`.

## The finding that changed the design (F3)

The roadmap implies reusing the shop's `itemHasClassification()`. Compiling a
probe under the project's own `tsconfig.json` proved that impossible:

```
error TS2345: Argument of type 'PosMenuProduct' is not assignable to parameter
  of type 'Pick<GreenwayMenuItem, "category" | "lowThcLiquid" | ...>'.
  Property 'lowThcLiquid' is optional in type 'PosMenuProduct'
    but required in type 'Pick<GreenwayMenuItem, ...>'.
```

`GreenwayMenuItem` declares the flags required-but-nullable; `PosMenuProduct`
declares them optional (so bundles cached before SLICE 16/17 still parse). Had
the roadmap sentence been taken on trust, the build would have broken.

## A hazard found during the build, and guarded

A doc comment I wrote contained a wildcard module path. The two characters that
open a block comment sat inside a LINE comment, so the comment-stripping pass
in the plumbing test ran from there to the next block-comment terminator and
silently deleted **80,000 characters** of real code — making a genuine import
look absent and turning a correct source into a red test.

The comment was reworded, and a permanent guard added
(`"contains no line comment that opens a block comment"`) that scans every file
these tests read. The length-based anti-vacuity guard did **not** catch this:
deleting a few hundred lines out of five thousand still leaves plenty of text.
Any future source-reading suite in this repo inherits the lesson.

## A defect prevented: the invisible filter

Chips render only for lanes that currently have stock. If the last low-THC
beverage sells out and the bundle re-syncs, that chip disappears. Reading the
filter straight from state would then leave an **invisible filter** pinned on —
an empty grid with no control on screen to clear it, which a budtender would
reasonably read as the register having lost the menu.

`activeClassification` is therefore DERIVED against the chips that actually
render, so a lane that is not on screen cannot be filtering. Deriving rather
than using an effect means there is no frame in which the stale lane still
applies. This is the same hazard the existing AM-A comment describes for the
category chip, given the same answer. Mutant **M16** removes the derivation and
the suite fails.

## Mutation testing — "test everything including the tests"

**21 mutants, one round, 21/21 killed, 0 survivors.** Post-restore baseline
green.

Unlike 18B and 18C — each of which lost its first round to a survivor that kept
an identifier and broke a value — 18D was written behaviourally from the start
precisely because of those two lessons. Backward compatibility of the new
optional parameter is proven by CALLING `filterMenuProducts()` with three
arguments, not by matching text; chip/filter agreement is proven by running
every chip through the filter and asserting the row count equals the chip's
count and every hit wears the matching marker.

The mutants cover the whole failure surface: raw-flag shortcuts (M01, M12),
inverted and always-on/always-off predicates (M02–M04), unstable lane order
(M05), zero-count chips (M06), inflated counts (M07), hand-typed statutory
copy (M08), a quantity promised on a chip (M09), a knob that does nothing
(M10), a lost default (M11), a regressed category filter (M13), chips computed
and never rendered (M14), a lane never passed to the filter (M15), the
invisible filter (M16), AM-A violated (M17), a vanished tile marker (M18), a
hard-coded label (M19), a marker that stops being silent (M20), and CI
registration removed (M21).

## Verification (all commands run, all green)

```
npx vitest run                                    548 files / 13939 tests passed
  pos-classification-visibility.test.ts           28 passed
  pos-classification-plumbing.test.ts             19 passed
  sale-grid-core.test.ts                          (existing, unchanged) passed
npx tsx scripts/slice18d/run-selftests.ts         search 70 + grid 31 + flow 41
npx tsx scripts/compliance/run-pure-selftests.ts  ALL PURE SELF-TESTS PASSED
npx tsc --noEmit -p tsconfig.json                 exit 0
npx eslint <5 touched files>                      exit 0, zero warnings
ls supabase/migrations/*.sql | wc -l              218 (unchanged), sorted, 0 dup prefixes
wc -l todo.md                                     3577 (untouched)
grep '\uXXXX' in touched files                    none
python3 scripts/slice18d/mutate.py                21/21 killed, 0 survivors
```

`sale-flow-core` self-tests stayed at **41 assertions, unchanged**, which is the
evidence that 18B's search behaviour was not disturbed: every pre-existing query
returns exactly the same rows.

## Honest note on a stale comment

`sale-grid-core.ts`'s header claimed *"Pure: no imports, no I/O"*. That stopped
being true when `searchProducts` was imported, before this slice. Rather than
extend a false statement, the header now says what is actually true — no I/O,
no React, no server-only, and both imports are themselves pure.
