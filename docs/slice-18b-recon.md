# SLICE 18B — RECON (facts only, every claim cites a file:line read from primary source)

Michael's brief:
> "Our filters are dynamic and appear in the list when there are products with
> those traits in the menu. So please make sure there is an easy path for
> customers and budtenders to filter and sort and find these products. Make sure
> the back office is also properly connected so it behaves dynamically like all
> the other filters do. I want this to be additive and not something new."

Rule: never guess, never assume. Everything below was read, not remembered.

---

## F1 — The dynamic-filter pattern already exists, and DOH is the exact precedent

The shop filter that most closely matches what 18B needs is the **DOH filter**
(SLICE D/E/F). It is a *compliance trait* threaded onto the public menu item and
surfaced as a sidebar facet that only appears when matching products exist.

Its full chain, read end to end:

| Hop | File | What it does |
|---|---|---|
| 1. truth | `src/lib/medical/sale-store.ts` `getMedicalRegistryForKeys()` | batched read, empty map when unconfigured/un-migrated |
| 2. overlay (server) | `src/lib/menu/menu-doh-server.ts:33` `withDohCompliance()` | `"server-only"`, calls the pure attacher |
| 3. overlay (pure) | `src/lib/menu/menu-doh-core.ts` `attachDohCompliance()` | non-mutating, normalizes fields even on the empty fast path |
| 4. item fields | `src/lib/leafly/types.ts:126,133` | `dohCompliant`, `dohCategory` |
| 5. facet (pure) | `src/lib/menu/menu-doh-filter-core.ts` | `resolveDohFilterOptions()` + `itemMatchesDohFilter()` |
| 6. client state | `src/components/menu/InteractiveMenuBrowser.tsx:741-743` | `activeDohId`, `dohOptions`, `activeDohOption` |
| 7. URL persist | `InteractiveMenuBrowser.tsx:771` | `params.set("doh", activeDohId)` |
| 8. popstate resync | `InteractiveMenuBrowser.tsx:834` | `setActiveDohId(...)` |
| 9. apply | `InteractiveMenuBrowser.tsx:874-876` | `pool.filter(itemMatchesDohFilter)` |
| 10. reset | `InteractiveMenuBrowser.tsx:1033` | cleared by `resetFilters()` |
| 11. removable pill | `InteractiveMenuBrowser.tsx:1064-1070` | `FilterTags` entry |
| 12. sidebar render | `src/components/menu/FilterMobile.tsx:245-285` | `{dohEnabled ? <FilterSection …> : null}` |
| 13. gate | `FilterMobile.tsx:176` | `const dohEnabled = Boolean(onDohToggle) && dohOptions.length > 0;` |

**This is the template to extend.** 18B follows all thirteen hops or it is a bolt-on.

### The "dynamic" contract, quoted exactly

`menu-doh-filter-core.ts:resolveDohFilterOptions()` returns `[]` when nothing
qualifies, and `FilterMobile.tsx:176` hides the whole section on an empty list.
That is *precisely* the behavior Michael described ("appear in the list when
there are products with those traits"). It is enforced in two places, not one.

A second, subtler rule lives in `resolveDohFilterOptions()`:

```ts
if (count > 0 && count < compliantTotal) {
```

A per-category lane is surfaced ONLY when it is a **proper subset** of the
umbrella. A lone category that would trivially equal the umbrella is suppressed
as "a redundant duplicate checkbox". 18B must honor the same anti-redundancy
rule or the sidebar will grow twin checkboxes that always return the same rows.

---

## F2 — The four classification flags are ALREADY on the public menu item

This is the single most important finding, because it decides whether 18B is
additive or a rebuild.

`src/lib/pos/live-menu.ts:menuRowToGreenwayItem()` already maps all four:

```
lowThcLiquid:    row.low_thc_liquid   ?? null   (live-menu.ts:93)
unitThcMg:       row.unit_thc_mg      ?? null   (live-menu.ts:94)
otherwiseTaken:  row.otherwise_taken  ?? null   (live-menu.ts:98)
unitsPerPackage: row.units_per_package?? null   (live-menu.ts:99)
```

and `src/lib/leafly/types.ts:80,82,94,96` declares them on `GreenwayMenuItem`.

**Consequence:** 18B needs **NO server overlay** — no `withXCompliance()`, no new
DB read, no migration. Unlike DOH (which needed a registry read), the truth is
already riding on every item because SLICE 16/17 put it there for the register.
The facet is pure client-side derivation over data already in the browser.

This is what "extending, not rebuilding" looks like in practice.

---

## F3 — The null asymmetry is real and is documented in the type

From `src/lib/leafly/types.ts:74-96`, verbatim:

- `lowThcLiquid` — "Absent/null = not classified = treated as a normal liquid
  (fail-safe)."
- `otherwiseTaken` — "**CAUTION** — unlike lowThcLiquid, absent/null here is the
  PERMISSIVE direction: an unflagged suppository is a `topical`, which buckets
  as a 2016 g liquid and is effectively unlimited."

**Consequence for 18B:** the facet must describe what was **affirmatively
verified**, never what was merely left blank. A "not a suppository" lane built
from `otherwiseTaken !== true` would silently include every unclassified
product and would be a lie on the shop page. Only `=== true` earns a lane.

---

## F4 — Sort options are a closed, typed union

`src/components/menu/SortDropdown.tsx` defines `SortOption`. Any new sort must
be added to that union, its label map, and `sortItems()` in the browser, and it
must survive `parsePersistedSort()` round-tripping through the URL.

---

## F5 — The back office already has the classification surfaces (18A)

- Worklist: `src/app/admin/compliance/classification/page.tsx`
- Per-product edit: `src/app/admin/inventory/[id]/page.tsx#classification`
- Truth written to: `menu_items` via
  `src/lib/inventory/classification-status-store.ts:applyClassificationToMenu()`

So the back-office → website loop is already closed at the data layer: an owner
edit writes `menu_items`, and `live-menu.ts` reads those same columns onto the
public item. 18B's "back office properly connected" requirement is therefore
about **visibility and parity of language**, not new plumbing.

---

## F6 — Qualifying is a THREE-condition test, not a boolean

`src/lib/compliance/sales-limits-core.ts` is the register's authority and it is
strict. Read verbatim:

```ts
export function qualifiesAsLowThcLiquid(line: LimitCartLine): boolean {
  if (categoryToBucket(line.category) !== "liquid_edible") return false;   // 1
  if (line.lowThcLiquid !== true) return false;                            // 2
  const mg = typeof line.unitThcMg === "number" ? line.unitThcMg : NaN;
  if (!Number.isFinite(mg) || mg <= 0) return false;                       // 3
  return mg <= LOW_THC_UNIT_MAX_MG;                                        // 3
}

export function qualifiesAsOtherwiseTaken(line: LimitCartLine): boolean {
  if (line.otherwiseTaken !== true) return false;
  return categoryToBucket(line.category) === "liquid_edible";
}
```

Three consequences that shape 18B:

1. **The flag alone never decides.** `lowThcLiquid === true` with a missing or
   5 mg `unitThcMg` does NOT qualify. A facet keyed on the raw boolean would
   advertise "Low-THC Beverages" for products the register still counts in the
   72 oz bucket — the website and the register would disagree in public.
2. **Category is part of the test.** Both predicates require the item to bucket
   as `liquid_edible`. (`categoryToBucket`'s liquid slugs are `edible-liquid`,
   `tincture`, `topical` — confirmed at `sales-limits-core.ts:304` and the
   `LIQUID_CATEGORIES` list at :343.)
3. **The flag must be LITERALLY `true`** — the comment at :634 says a string
   `"true"` or a `1` must return false, because "an intake bug must never widen
   an allowance."

**Therefore 18B MUST reuse these two exported predicates rather than
re-implement the conditions.** Re-implementing would create the exact drift
SLICE 18A's parity test was written to prevent.

`LimitCartLine` (`sales-limits-core.ts:413`) needs only `category` + `quantity`
plus the optional flags, so adapting a `GreenwayMenuItem` to it is a small pure
function with `quantity: 1`.

`LIMIT_BUCKET_LABELS` (`sales-limits-core.ts:139-146`) already holds the
owner-facing wording, including the em-dash-free
`"Low-THC beverages (≤ 4 mg THC per unit)"`. Reusing these keeps the shop, the
register and the back office speaking one language.

---

## F7 — The register already carries the flags to budtenders

`src/app/api/pos/menu/route.ts:175-180` puts all four flags in the offline
bundle, and `PosMenuProduct` (`src/lib/pos/sale-flow-core.ts:97-115`) declares
them. The budtender's find path is:

- `filterMenuProducts(products, query, category)` — `sale-grid-core.ts:74`
- which delegates text matching to `searchProducts()` — `sale-flow-core.ts:299`

```ts
const hay = `${p.name} ${p.brand ?? ""} ${p.category} ${p.variantLabel ?? ""}`.toLowerCase();
```

**Finding:** the haystack is name/brand/category/variant only. A budtender
CANNOT currently type "suppository" or "low thc" and find those products unless
those words happen to appear in the product name. The register has the data but
no path to it.

This is the budtender half of Michael's "easy path for customers AND
budtenders". It is satisfiable additively by widening the haystack with
classification keywords — no new UI, no new state, no new bundle field.

---

## F8 — Sort is a closed union with a validating parser

- `src/components/menu/SortDropdown.tsx:1` — `SortOption` union (9 values) and
  the `sortOptions` label/helper table that renders the `<select>`.
- `InteractiveMenuBrowser.tsx:399` — `sortItems()` if-chain.
- `InteractiveMenuBrowser.tsx:590` — `parsePersistedSort()` validates against
  `SORT_OPTION_VALUES`, so an unknown `?sort=` token falls back rather than
  breaking. A new sort must be added to all four places.

---

## DECISIONS (what 18B builds, and why each is an extension)

| # | Decision | Grounded in |
|---|---|---|
| D1 | NO server overlay, NO migration, NO new DB read | F2 — the flags already ride on every item |
| D2 | New pure core `menu-classification-filter-core.ts` mirroring `menu-doh-filter-core.ts` exactly | F1 — that is the house pattern |
| D3 | Facet lanes derive from `qualifiesAsLowThcLiquid` / `qualifiesAsOtherwiseTaken`, never raw booleans | F6 — website must agree with the register |
| D4 | Only affirmatively-verified products earn a lane; no "unclassified" lane on the shop | F3 — null is permissive for `otherwiseTaken` |
| D5 | Empty list ⇒ section never renders; also gated in `FilterMobile` | F1 — the two-place dynamic contract |
| D6 | Anti-redundancy: suppress a lane that would duplicate the umbrella | F1 — `count < compliantTotal` rule |
| D7 | Follow all 13 hops (state, URL persist, popstate, reset, pill, sidebar) | F1 — anything less is a bolt-on |
| D8 | Budtender: widen `searchProducts` haystack with classification keywords | F7 — data present, path missing |
| D9 | Back office: the worklist gets the same dynamic facet language | F5 — parity of language, plumbing already closed |

### Explicitly NOT doing (out of scope / would be a rebuild)

- No new sort option. The existing nine already cover ordering, and a
  "classification" sort would duplicate what the facet does. (Revisit only if
  Michael asks.) **Correction after review:** see BUILD NOTES — grouping the
  facet's lanes is handled by the existing `category` sort, since these products
  bucket as liquids.
- No PDP badge — that is 18C by Michael's own roadmap.
- No register visibility/filter UI — that is 18D.

---

## BUILD ADDENDUM — what the build actually found

Recon predicted the shape of this slice correctly (no server overlay, no
migration, reuse the register's predicates). Three things came out of the build
itself that recon could not have known, and one pre-existing defect was
repaired. All of it is recorded here because the standing rule is that we build
from fact, not memory — and the next slice reads this file.

### A1. A genuine pre-existing gap: `?doh=` was never forwarded server-side

While wiring `classification` through `src/app/menu/page.tsx` I checked what the
DOH facet — the precedent this slice mirrors (F1) — actually does at the same
hop. It did not do it. `resolveInitialParams` in `InteractiveMenuBrowser`
accepted a `doh` value and the client hydrated from it, but the server page
never read `resolvedSearchParams?.doh`, so a shared `/menu?doh=...` link painted
an **unfiltered** grid before the client took over. The lane then appeared to
"pop in", or not at all if the visitor never triggered a client update.

18B forwards both params, so `/menu?doh=...` and `/menu?classification=...` are
now equally deep-linkable. This was in scope precisely because Michael asked for
the new facet to behave "dynamically like all the other filters do" — matching a
broken precedent would have propagated the bug rather than the pattern. Mutant
`M12-doh-forwarding-regressed` now guards the repair so it cannot silently
return.

### A2. `shopLane` — the back-office half of "properly connected"

Recon F5 established that the 18A surfaces already write `menu_items`, so the
data loop was closed. What was missing was the *reverse* view: staff could set
the flags but had no way to see whether a product had actually earned a
customer-facing lane. Since qualification is a three-condition test (F6), "I
ticked the box" and "shoppers can filter to it" are genuinely different facts.

So `ClassificationWorklistEntry` gained `shopLane: ClassificationFilterKind |
null`, computed with the SHARED `classificationKindForItem`, and the admin
worklist gained an **"On the website"** column that either links to the live
shop lane via `classificationShopHref()` or says `— not in a filter lane`. The
over-4 mg drink case is the one that earns this column: flags set, but the
register still counts it in the 72 oz bucket, so the honest answer is "no lane".

### A3. The budtender gap (F7) closed additively

`searchProducts()`'s haystack was `name/brand/category/variantLabel`, so a
suppository whose product name never says "suppository" was unfindable at the
till even though the flags were right there on the bundle. Widening the haystack
with `classificationSearchText(p)` closes it. The additive guarantee is
structural, not incidental: that function returns `""` for any product the
register would not route to a special bucket, so an ordinary product's haystack
is byte-for-byte what it was before this slice.

### A4. Testing the tests — two real holes found

`scripts/slice18b/mutate.py` runs 18 mutants, each a defect a shopper or
budtender would physically feel. Two rounds were needed.

**Round 1: 17/18 killed, `M16-worklist-lane-always-null` SURVIVED.** Two causes,
both worth recording:

1. `scripts/slice18b/run-selftests.ts` did not include
   `__runClassificationWorklistTests`, so the four new `shopLane` assertions
   never executed in the mutation loop at all.
2. More importantly, the plumbing test only *text-matched* `shopLane` and
   `classificationKindForItem`. The mutant kept both identifiers while
   hard-coding the value to `null` — so a source-reading assertion passed on
   provably broken code. **Reading the source can prove a name is present; it
   cannot prove a value is right.**

Fixed by adding a **behavioural** test that builds a worklist over four real
staff-facing states (qualifying drink, over-dosed drink, suppository,
unreviewed) and asserts both the lane value AND that it agrees with the shop's
own `itemHasClassification` for identical facts. It carries an anti-vacuity
guard so an always-null implementation cannot pass by matching the null
expectations. **Round 2: 18/18 killed.**

Two of my own test defects were also caught and fixed by STRENGTHENING, never
loosening:

- The purity test asserted `not.toContain("server-only")` against the **raw**
  file — a false positive generator, since the module's header comment explains
  *why* it avoids server-only. Replaced with an import **allowlist** that
  enumerates every real specifier and fails closed on any dependency nobody
  predicted, which is strictly stronger than the blocklist it replaced.
- The new behavioural fixture did not satisfy `WorklistLotInput` (`lotId`,
  `vendorName`, `onHandQty`, `fromImport` are required). Vitest does not
  typecheck, so only `tsc --noEmit` caught it; the fixture is now typed via
  `Parameters<typeof buildClassificationWorklist>` so it stays honest as the
  contract evolves.

### A5. Verification results

- `npx vitest run` — **544 files, 13,838 tests passed**, 0 failed
- `npx tsx scripts/compliance/run-pure-selftests.ts` — `ALL PURE SELF-TESTS PASSED`
- 18B cores: `menu-classification-filter-core` 71, `classification-search-core`
  24, `classification-worklist-core` 124 (was 120) = **219 assertions**
- `npx tsc --noEmit` — exit 0
- `npx eslint` on all 12 touched paths — exit 0
- `python3 scripts/slice18b/mutate.py` — **18/18 killed, 0 survivors**,
  post-restore baseline green
- Migrations unchanged at **218**, `sort -c` clean, 0 duplicate prefixes
- `todo.md` intact at **3,577** lines
- No `\uXXXX` escapes in any touched source file

### A6. Non-goals confirmed unchanged

No new sort option (the closed 9-value `SortOption` union is untouched — F4/F8),
no PDP badge (18C), no register visibility UI (18D), no migration, no new DB
read.
