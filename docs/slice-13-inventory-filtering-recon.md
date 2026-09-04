# Slice 13 — Inventory page filtering/sorting/search: RECON

Every statement below was **read out of the repository** at commit `3d250267`.
Nothing here is remembered or inferred. File:line references are given so each
claim can be re-checked.

## 1. What the page is today

`src/app/admin/inventory/page.tsx` — 659 lines, an **async server component**
with `export const dynamic = "force-dynamic"` (line 28). All state lives in the
URL; there is no client component and no client state on this page.

Data comes from three parallel awaits (lines 170-174):

- `listLotsPaged({...queryFilter, from, to})` — one page of lots
- `computeInventoryStats()` — header KPI numbers
- `getInventoryCommandCenter()` — the intel panel

Pagination is **server-side**, `DEFAULT_PAGE_SIZE = 100`
(`src/lib/admin/list-window-core.ts:23`).

## 2. The filters that exist TODAY (measured, not assumed)

Read from the `searchParams` type (lines 67-109) and the parsing block
(lines 112-138):

| Param | Meaning | Parser |
|---|---|---|
| `q` | free text | passed straight to the store |
| `status` | one of the 6 status tabs | compared as a string |
| `sort` | sort key | `resolveSort(sp.sort, LOT_SORTS)` |
| `coa` | tri-state yes/no | `parseYesNo` |
| `sample` | tri-state yes/no | `parseYesNo` |
| `medical` | tri-state yes/no | `parseYesNo` |
| `expiring` | days, `/^\d{1,3}$/` | inline regex |
| `vendor` | UUID shape only | inline regex |
| `needsReceivedDate` | literal `"1"` | inline compare |
| `missingProductLink`, `emptyActive`, `missingExpiry`, `unknownCost` | gap worklists | `parseGapFlag` |
| `bulk*` | bulk-fill mode | separate feature |

So the visible filter form (lines 425-506) offers exactly **five** controls
plus sort: Search, COA, Sample, Medical, Expiring, Sort by.

**Established doctrine, to be preserved:** a garbage param silently means
"filter off" — never an exception (comment at lines 116-117, repeated for each
knob). Any new knob must behave the same way.

## 3. The sort menu that exists TODAY

`LOT_SORTS` in `src/lib/admin/list-filter-core.ts:50-57` — **six** options:

`newest`, `oldest`, `expiry`, `qty_high`, `qty_low`, `name`.

The first entry is the default (`resolveSort` line 71-75 falls back to
`menu[0]`). Keys are described as "part of the URL contract — never rename,
only append" (lines 39-40). **This slice appends only.**

Sorting is applied in the store by passing `sort.columns` to PostgREST
`.order()` (store.ts:154-160).

## 4. Why the owner's search "found nothing" — the ROOT CAUSE

`listLotsPaged` (`src/lib/inventory/store.ts:106-115`):

```ts
const like = opts.q ? ilikeContains(opts.q) : null;
if (like) {
  query = query.or(
    [
      `product_name.ilike.${like}`,
      `lot_code.ilike.${like}`,
      `pos_product_key.ilike.${like}`,
    ].join(","),
  );
}
```

and `ilikeContains` (`src/lib/supabase/postgrest-escape.ts:53-57`) returns
`%term%` for the **whole string as one unit**.

Three consequences, all provable from the code above:

1. **The whole phrase must appear contiguously.** `%blue dream gummies%`
   matches only a name containing that exact substring. Typing
   `"gummies blue"` matches nothing even when "Blue Dream Gummies" exists,
   because the words are in the wrong order.
2. **Only three columns are searched.** `strain_name`, `category`,
   `inventory_type`, `notes`, vendor name and brand name are NOT searched.
   Typing a brand or a strain therefore finds nothing.
3. **Zero typo tolerance.** `ilike` is exact-substring; one wrong letter
   yields zero rows.

This matches the owner's report exactly: *"I tried typing something in and
couldn't find it, and it only found it when I very specifically used the
product's name exactly."*

## 5. The architectural constraint that decides the design

`hydrateLots` (`src/lib/inventory/store.ts:202-245`) resolves
`vendor_name`, `brand_name` and `lab` (the whole COA incl. THC/CBD) **after**
the page window has already been fetched, by looking up the ids of the rows on
that page in the `vendors`, `brands` and `lab_results` tables.

Therefore, **today it is impossible to filter or sort by vendor name, brand
name, THC or CBD** — the database query does not have those values when it
runs. This is not an oversight to be patched around in SQL; it is the reason
the requested features do not exist yet.

Row volume, from the SLICE 2 comment at `store.ts:320-338`: the store has
**4,179 lots**, and `computeInventoryStats()` already walks **every** row on
every page load via `pagedAll` (`src/lib/supabase/chunked-in.ts:87-101`).

**Design consequence:** loading the full lot set for filtering is a cost the
page already pays once. The honest way to deliver name/brand/potency filtering
and true whole-result sorting is to filter and sort over the complete set, in
pure code, then paginate the RESULT. That also makes fuzzy scoring possible,
which SQL `ilike` fundamentally cannot do.

## 6. Fuzzy matching already exists in this repo — reuse, do not reinvent

`src/lib/ai/kb/strain-matcher.ts` has **zero imports** (verified: `grep -n
"^import"` returns nothing) and exports a complete, pure fuzzy stack:

- `levenshtein` (185), `levenshteinRatio` (203)
- `diceCoefficient` (210)
- `tokenJaccard` (235), `tokenAlignment` (251)
- `similarity` (276) — weighted blend `0.5*align + 0.3*dice + 0.2*lev`
  with a containment bonus
- `normalizeStrainQuery` (144), `alnumKey` (171)

**Gap discovered:** this module has **no `__run*` self-tests** (`grep -n
"__run"` returns nothing) and **no vitest file** (`grep -rln "strain-matcher"
tests/` returns nothing). Its only coverage is a manual script,
`scripts/kb/test_strain_matcher.ts`.

So if this slice depends on `similarity()`, the dependency is currently
**unproven**. This slice must therefore bring it under test as part of the
work — otherwise the new search would rest on untested code.

## 7. The row fields available to filter on

From `InventoryLot` (`src/lib/inventory/types.ts:110-181`) plus the
`LotWithDetail` additions (195-199). Every field, grouped by how it can be
filtered:

**Text / identity:** `id`, `lot_code`, `pos_product_key`, `product_name`,
`strain_name`, `notes`, `vendor_name`*, `brand_name`*
**Enumerable facets:** `status`, `strain_type`, `category`, `inventory_type`,
`unit`, `unit_weight_uom`, `received_on_source`, `vendor_id`, `brand_id`
**Booleans (tri-state):** `is_sample`, `is_medical`
**Nullable booleans (UNKNOWN is a real third state):** `low_thc_liquid`,
`otherwise_taken`
**Numeric:** `received_qty`, `on_hand_qty`, `unit_weight`, `unit_thc_mg`,
`units_per_package`, `unit_cost_minor_units`
**Dates:** `created_at`, `updated_at`, `expires_on`, `received_on`
**From the joined COA\*:** `total_thc_pct`, `total_cbd_pct`, `thc_pct`,
`cbd_pct`, `total_cannabinoids_pct`, `lab_name`, `tested_on`, `passed`,
`coa_url`

`*` = only available after `hydrateLots`, i.e. only filterable in the
whole-set approach described in §5.

**A doctrine that must carry into the new filters:** for `low_thc_liquid`,
`otherwise_taken`, `received_on`, `expires_on` and `unit_cost_minor_units`,
**NULL means UNKNOWN and never "no"** — stated explicitly at types.ts:132-170
and 158-166. A "Low-THC: no" filter that swept up unknowns would be a lie, so
these need three states, not two.

## 8. Display helpers that already exist

`src/lib/inventory/lot-table-core.ts` (259 lines) is **display only** —
`lotReceivedDate`, `lotTypeLabel`, `lotSizeLabel`, `lotSoldQty`,
`lotStrainLabel`, `lotPotencyLabel`, `lotStrainTypeLabel`. It contains **no
filter or sort logic** and has embedded self-tests registered in the pure
runner. It has no dedicated vitest file.

Note `lotTypeLabel` is not a plain column read: it screens CCRS blobs and can
derive a house type. So a "Type" facet built from raw `category` would NOT
agree with what the Type column displays. **The facet must be built from the
same helper the column renders**, or the dropdown will disagree with the table.

Similarly `lotSoldQty` = `received_qty − on_hand_qty` floored at 0, and
`lotPotencyLabel` switches between `%` and `mg` by inventory type
(`intakePotencyUnit`). Sorting on "THC" must therefore be careful: a 3000 mg
edible and a 21.66 % flower are **not comparable numbers**.

## 9. Test landscape

- `tests/compliance/list-filter-core.test.ts` — covers the sort grammar.
- `tests/compliance/slice7-lot-enrichment-worklists.test.ts` — the precedent
  worth copying: it builds a **PostgREST predicate simulator** and asserts the
  store's real predicates and the pure core's `matches()` select the same rows.
- `tests/compliance/slice8-bulk-fill.test.ts` — asserts on page source text.
- No test file for `lot-table-core.ts` or `strain-matcher.ts`.

Baseline before this slice: **556 test files, 14,096 tests**.

## 9b. MEASURED behaviour of the existing fuzzy stack

Run `npx tsx scripts/slice13/probe-similarity.ts`. Measured output (not
predicted):

```
"Blue Dream 3.5g"                        -> "blue dream"
"Cantina Gummies - Guava 10 Pack 400mg"  -> "cantina guava"
"2727 - Live Resin Cart - GG4 1g"        -> "2727 live gg4"

q="blue dream"     best=1.000  Blue Dream 3.5g
q="dream blue"     best=0.733  Blue Dream 3.5g     (reordered — works)
q="blue dreem"     best=0.826  Blue Dream 3.5g     (typo — works)
q="gummies guava"  best=0.908  Cantina Gummies…    (works)
q="guava"          best=0.908  Cantina Gummies…    (middle word — works)
q="gg4"            best=0.885  2727 - Live Resin…  (works)
q="400mg"          best=0.000  —                   ** FAILS **
q="chocolat"       best=0.089  —                   ** FAILS **
q="xyzzy"          best=0.000  —                   (correct: no match)
```

**The two failures are not bugs in `similarity()`.** They are caused by
`normalizeStrainQuery`, which is deliberately *destructive*: it exists to
reduce a product name down to a bare STRAIN name. It strips weights
(`WEIGHT_RE`, line 74), pack counts (`PACK_RE`, 76), percentages
(`PERCENT_RE`, 77) and a 50-entry `FORM_WORDS` list (79-133) that includes
`gummies`, `chocolate`, `preroll`, `cart`, `resin`, `rosin`, `indica`,
`sativa`, `hybrid`.

So `"Cantina Gummies - Guava 10 Pack 400mg"` becomes `"cantina guava"`:
the words **gummies**, **10 Pack** and **400mg** are all destroyed. A budtender
searching "gummies" would get nothing — a *second* way to reproduce the owner's
complaint, and one that would have been introduced by naively reusing this
normalizer.

**Design consequence:** reuse the *metrics* (`similarity`, `diceCoefficient`,
`levenshteinRatio`, `tokenAlignment`, `levenshtein`) which are pure and
content-agnostic, but do **NOT** reuse `normalizeStrainQuery` for product
search. Slice 13 needs a *lossless* normalizer that only lowercases and
collapses punctuation, keeping every meaningful token.

## 9c. Ownership of the code this slice depends on

`listLotsPaged` is called from exactly one place —
`src/app/admin/inventory/page.tsx` (lines 171, 178). Verified by grep across
`src/` and `tests/`. Extending it therefore cannot break another screen.

## 10. Constraints this slice must respect

1. `todo.md` is a tracked 3,577-line file asserted on by tests — never touch.
2. Literal UTF-8 em dashes in source, never `\uXXXX` escapes.
3. `noUncheckedIndexedAccess` is on — `arr[0]` is possibly-undefined.
4. Sort keys are a URL contract — append only, never rename.
5. Garbage params mean "filter off", never an exception.
6. NULL means UNKNOWN, never "no".
7. Existing URLs must keep working: `?needsReceivedDate=1`, `?vendor=<uuid>`,
   the four gap knobs, and the `bulk*` family are all linked from elsewhere in
   the app.
