-- scripts/ops/menu-copy-reclaim.sql  (PERF round P1/P2 - run ONCE, by the owner, after 0344)
--
-- 0344 stops the menu-copy pile-up from growing (the app prunes a few old copies after every
-- publish). This script clears the backlog that is already there - about 320 old copies, roughly
-- 700,000 menu_items rows and 800,000 menu_variants rows - and then gives the disk space back so
-- the tables fit in memory again.
--
-- HOW TO RUN (Supabase SQL editor). Run each numbered step ON ITS OWN (paste just that step,
-- press Run, wait for the result). Step 3 cannot run together with anything else: Postgres
-- refuses VACUUM inside a multi-statement run.
--
-- Nothing here touches the published menu, a staged menu, an import's menu, a test menu, the
-- newest 5 archived copies, or any menu_versions row (the Publish history keeps every entry).
-- Sales reports keep every product's category: they read product_latest_facts (0344).

-- STEP 0 (optional) - see the size before.
select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) as total_size
  from pg_stat_user_tables
 where relname in ('menu_items', 'menu_variants', 'menu_versions', 'product_latest_facts')
 order by pg_total_relation_size(relid) desc;

-- STEP 1 - clear old copies, 25 at a time. Run it again until "remaining" is 0 (about 13 runs,
-- each a few seconds to a minute). Each run is its own short transaction; stopping half-way is fine.
set statement_timeout = '5min';
select public.prune_menu_version_items(5, 25);

-- STEP 2 - check: remaining = 0, and every product key still has its facts.
select public.prune_menu_version_items(5, 1) as should_say_remaining_0,
       (select count(*) from public.product_latest_facts) as product_keys_with_facts,
       (select count(distinct source_item_id) from public.menu_items) as product_keys_in_kept_copies;

-- STEP 3 - give the space back (run these two lines ONE AT A TIME). Each locks its table for
-- the few seconds it takes to rewrite what is left (now small); do it outside opening hours.
vacuum (full, analyze) public.menu_variants;
vacuum (full, analyze) public.menu_items;

-- STEP 4 - see the size after (same as step 0). menu_items should drop from about 755 MB to a
-- few MB, menu_variants from about 169 MB to a few MB.
select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) as total_size
  from pg_stat_user_tables
 where relname in ('menu_items', 'menu_variants', 'menu_versions', 'product_latest_facts')
 order by pg_total_relation_size(relid) desc;
