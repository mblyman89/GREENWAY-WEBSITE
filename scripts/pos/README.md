# Greenway POS scripts (retired)

**SLICE 48:** the static POS snapshot pipeline that used to live here has been
fully retired. The website menu is now served exclusively from the live
Supabase-published menu (`src/lib/pos/live-menu.ts`), and Cultivera workbooks
are imported through the back-office **Menu Imports** page
(`/admin/menu-imports`), which stages, reviews, and publishes them — including
compliance inventory lot creation at publish time.

## What was removed

- `transform_pos_data.ts` — the old CLI transformer that wrote
  `src/data/pos-menu-preview.json` at build time. The shared transform logic it
  wrapped still lives in `src/lib/pos/transform.ts` and is used by the Menu
  Imports service (`src/lib/pos/import-service.ts`).
- `build_pos_menu_preview.py`, `verify_pos_menu_mapping.py`,
  `analyze_matching_v2.py` — legacy Python prototypes.
- `src/data/pos-menu-preview.json`, `src/data/pos-menu-sample-preview.json`,
  `src/data/vendors.json` — frozen snapshot data files.
- `src/lib/pos/preview-menu.ts` — the loader for those snapshots.
- The `transform:pos` npm script; `npm run build` is now just `next build`.

## Where things live now

- Menu data: Supabase `menu_items` (published via Menu Imports or intake).
- Vendor directory: derived live from the published menu by
  `src/lib/menu/vendor-directory-core.ts` and rendered on `/vendor-delivery`.
- Transform logic and tests: `src/lib/pos/transform.ts` plus the pure self-test
  runner (`scripts/compliance/run-pure-selftests.ts`).
