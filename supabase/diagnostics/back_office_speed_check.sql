-- back_office_speed_check.sql  (PERF2 round) - READ ONLY. Changes nothing.
-- Paste into the Supabase SQL editor and run. Each block is one result grid.
-- What it answers: is the database itself the bottleneck, and why?

-- 1. How big are the menu snapshot tables? (Every menu change copies the
--    whole catalog into a new version; archived copies are never deleted.)
select
  (select count(*) from public.menu_versions)                              as versions_total,
  (select count(*) from public.menu_versions where status = 'archived')    as versions_archived,
  (select count(*) from public.menu_versions where status = 'staged')      as versions_staged,
  (select count(*) from public.menu_items)                                 as menu_item_rows,
  (select count(*) from public.menu_variants)                              as menu_variant_rows,
  (select count(*) from public.menu_items mi
     join public.menu_versions mv on mv.id = mi.menu_version_id
    where mv.status = 'published')                                         as live_menu_items;

-- 2. Largest tables on disk (top 15).
select relname as table_name,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size,
       n_live_tup as live_rows,
       n_dead_tup as dead_rows,
       last_autovacuum, last_autoanalyze
  from pg_stat_user_tables
 order by pg_total_relation_size(relid) desc
 limit 15;

-- 3. Tables read mostly by full scans (seq_scan >> idx_scan = missing index).
select relname as table_name, seq_scan, seq_tup_read, idx_scan, n_live_tup
  from pg_stat_user_tables
 where seq_scan > 0
 order by seq_tup_read desc
 limit 15;

-- 4. The slowest statements (needs the pg_stat_statements extension, which
--    Supabase enables by default; Dashboard -> Database -> Query Performance
--    shows the same thing with a UI).
select round(total_exec_time::numeric / 1000, 1) as total_seconds,
       calls,
       round(mean_exec_time::numeric, 1)          as mean_ms,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) as query
  from extensions.pg_stat_statements
 order by total_exec_time desc
 limit 20;

-- 5. Connection pressure right now.
select state, count(*) from pg_stat_activity group by state order by 2 desc;

-- 6. Did migration 0303's indexes land?
select indexname from pg_indexes
 where schemaname = 'public'
   and indexname in ('idx_menu_variants_source_variant', 'idx_menu_items_source_item_created',
                     'idx_menu_versions_published', 'idx_menu_versions_status_created');
