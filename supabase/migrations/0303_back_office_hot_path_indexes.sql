-- 0303_back_office_hot_path_indexes.sql  (PERF2 round: "a single button click takes a full minute")
--
-- WHY. Every menu change (intake approval, fact review, publish, price edit)
-- writes a WHOLE new menu snapshot: a menu_versions row plus a copy of every
-- menu_items row and every menu_variants row. Old snapshots are archived, never
-- deleted, so menu_variants holds (catalog size x number of snapshots ever
-- written) rows and keeps growing with every click.
--
-- menu_variants had exactly ONE index (menu_item_id). Five hot back-office
-- paths look variants up by source_variant_id instead:
--   lot-live-price-server.ts   (EVERY /admin/inventory load, .in over all lots)
--   price-write-store.ts       (every price edit)
--   lot-propagation-store.ts   (every lot edit that propagates to the menu)
--   lot-link-store.ts          (lot detail / link)
--   pos/pickup-menu-facts.ts   (pickup orders)
-- Without an index each of those is a sequential scan of the entire, ever-
-- growing variants table, repeated per chunk. This file adds that index and
-- the other missing indexes on filters the back office runs on every load.
--
-- SAFE / IDEMPOTENT: "create index if not exists" only. No table, column or
-- row is changed. Re-running is a no-op. Plain (non-CONCURRENTLY) creates so
-- the whole file pastes into the Supabase SQL editor (which runs a script in
-- one transaction, where CONCURRENTLY is not allowed). Each index builds in
-- seconds at this store's size; writes to that one table wait meanwhile.
-- Apply MANUALLY in the Supabase SQL editor (standing rule).

-- 1. THE BIG ONE: variant lookups by POS source id (all five paths above).
create index if not exists idx_menu_variants_source_variant
  on public.menu_variants (source_variant_id);

-- 2. Product-key lookups on menu_items that are NOT scoped to one version
--    (disposition.ts, pos/pickup-menu-facts.ts, leafly/identity-server.ts and
--    the report category lookups). The existing (menu_version_id,
--    source_item_id) index cannot serve a key-only lookup.
create index if not exists idx_menu_items_source_item_created
  on public.menu_items (source_item_id, created_at desc);

-- 3. "The published version" is read by ~60 call sites (every menu read, every
--    order, every inventory load). A partial index makes it a single-page
--    lookup no matter how many archived versions accumulate.
create index if not exists idx_menu_versions_published
  on public.menu_versions (published_at desc)
  where status = 'published';

-- 4. Staged-version lists (Publish page, restage coalescing, intake step
--    snapshot): status + newest first.
create index if not exists idx_menu_versions_status_created
  on public.menu_versions (status, created_at desc);

-- 5. Lot <-> draft links (lot detail, COA panel, lot-propagation).
create index if not exists catalog_drafts_lot_idx
  on public.catalog_product_drafts (lot_id);

-- 6. Lots by COA (lot-link-store, coa-extract).
create index if not exists inventory_lots_lab_result_idx
  on public.inventory_lots (lab_result_id);

-- 7. Lots by their linked menu size (0294) - lot live price / propagation.
create index if not exists inventory_lots_menu_source_variant_idx
  on public.inventory_lots (menu_source_variant_id);

-- 8. Register/transaction history, returns, voids, leaderboard and the day
--    report filter pos_sale_events by event_type within a time window.
create index if not exists idx_pos_sale_events_type_occurred
  on public.pos_sale_events (event_type, occurred_at desc);

-- 9. Order timeline lookups by type (oversold report, cutover drift).
create index if not exists idx_order_events_type
  on public.order_events (event_type);

-- 10. Pricing history by product (inventory pricing panel).
create index if not exists order_lines_product_idx
  on public.order_lines (product_id);

-- 11. Returns by order line / sale detail (disposition, CCRS batch).
create index if not exists customer_returns_order_line_idx
  on public.customer_returns (order_line_id);
create index if not exists customer_returns_sale_detail_idx
  on public.customer_returns (sale_detail_external_id);

-- 12. Media lookups by storage key / public URL (blur placeholders, harvest).
create index if not exists idx_media_assets_storage_key
  on public.media_assets (storage_key);
create index if not exists idx_media_assets_public_url
  on public.media_assets (public_url);

-- 13. Time clock + payroll by employee and day.
create index if not exists idx_time_punches_clock_in
  on public.time_punches (clock_in_at desc);
create index if not exists idx_payroll_run_lines_employee
  on public.payroll_run_lines (employee_id);

-- 14. Leafly order board: un-acknowledged orders.
create index if not exists idx_leafly_orders_unacked
  on public.leafly_orders (first_seen_at desc)
  where acknowledged_at is null;

-- Refresh planner statistics so the new indexes are used immediately.
analyze public.menu_variants;
analyze public.menu_items;
analyze public.menu_versions;
analyze public.inventory_lots;
analyze public.catalog_product_drafts;
