# R38 - Inventory table: connected columns, enterprise columns, paging, export

Branch `r38-inventory-table` from main `e15ba8b5` (R37 merged).
Standing rules: never guess / never assume, test it and test the tests,
commit + push after every task, no drift.

## Owner request (scope, in his order)
1. The Website category column is blank: make sure every column is connected.
2. More columns: a professional, all-inclusive, data-rich, enterprise table.
   Stacked cells and horizontal scrolling are fine.
3. Rows per page 25 / 50 / 100 / All, scroll to the bottom, a numbered pager
   (numbers + carets) at the top AND the bottom, Back to top at the bottom.
4. An intelligent export of any and all data.
5. Explain "the 4 errors" and whether they must be fixed first.

## Research used
- Dutchie / Flowhub / Cova inventory reports: ext. cost, ext. retail,
  sell-through, days of supply, aging buckets, ABC class.
- Data-table UX (Pencil & Paper, NN/g, Material data grid): sticky header,
  frozen first column, density toggle, column chooser and saved views in the
  URL, numbered pager with first/prev/next/last and page size, totals row.
- OWASP CSV injection (CWE-1236): neutralise = + - @ TAB CR leading cells.
- Supabase: the 1,000-row `db-max-rows` API cap applies on every plan
  (Pro included). The app reads in pages (`pagedAll`, `chunkedIn`), so "All"
  really means all.

## Slices
- S1 Website category connected: `lot-website-category-core` (override >
  live menu > onboarding pick > type map > heuristic > unmapped, with a
  source chip); paged menu read; filter + sort use the effective value.
  11 tests, 11/11 mutants killed.
- S2 `inventory-metrics-core` (28 assertions) + `inventory-table-core`
  column registry (39 columns in 8 groups, 77 export fields, 6 presets,
  61 assertions); 12 new sort keys; `matched` rows for totals/export; new
  table with sticky header + frozen first column + totals over every page.
- S3 `InventoryTablePager` top and bottom (25/50/100/250/All), `BackToTopLink`,
  `InventoryTableToolbar` (views, column picker, density, export panel);
  display params survive filter Apply and Clear all.
- S4 `/admin/inventory/export`: scope view|page|all, columns visible|all,
  xlsx (Lots / Summary / Columns) or CSV, formula guard, fail-closed 503,
  `inventory.manage`, audited as `inventory.export`. Same pipeline as the
  page (`inventory-table-server`).
- S5 The 4 lint warnings: unused `LIQUID_VOLUME_TYPES` import
  (draft-injection-core, superseded by the R33 bucket pass) and unused
  `Req` / `Reply` / `actions` in s17-batch-staging.test.ts. Removed.
  They were warnings, never errors, and never blocked anything.
- S6 Verification + docs (TEST-PLAN T-343 to T-346, test manual, bible).

## Bugs found by testing
- The export panel dropped `page`, so "Only the rows on this page" always
  exported page 1. Fixed; test + mutant.
- `attachLotWebsiteCategory<L extends { onboarding?: unknown }>` was a weak
  type constraint that tsc rejected for lots without `onboarding`; now
  `L extends object`.
- A bare export link defaulted to CSV while the panel defaults to Excel; the
  route now defaults to xlsx.

## Status
- [x] S0 survey + research
- [x] S1 connected website category
- [x] S2 metrics + registry + table
- [x] S3 pager + page size + toolbar
- [x] S4 export
- [x] S5 lint warnings
- [x] S6 full suite (812 files, 21,586 tests), tsc, eslint, PG reset (257 migrations); PR + merge
