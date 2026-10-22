-- scripts/recon/disk-io-diagnose.sql  (USAGE-6 - Disk IO budget)
--
-- READ-ONLY. Paste into Supabase -> SQL Editor and press Run. It changes
-- nothing (one transaction, set read only, rolled back). Each section prints
-- one result set; Supabase shows the LAST one, so run a section at a time if
-- you want to see each (select it, then Run selected).
--
-- What it answers, in the order Supabase's "High Disk I/O" guide lists the
-- common causes (docs/usage-sources/supabase-high-disk-io.txt):
--   1. Low cache usage      -> cache hit ratio (tables and indexes)
--   2. Query performance    -> the statements that read the most from disk
--   3. Scans of big tables  -> tables read by sequential scan, biggest first
--   4. Sizes                -> the largest tables (what fills the cache)
--   5. Unused indexes       -> indexes never read that still cost writes
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/disk-io-diagnose.sql
begin;
set transaction read only;

-- 1. Cache hit ratio. Healthy is about 0.99. Lower means reads go to disk.
select 'table' as kind,
       round(sum(heap_blks_hit)::numeric / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 4) as hit_ratio
  from pg_statio_user_tables
union all
select 'index',
       round(sum(idx_blks_hit)::numeric / nullif(sum(idx_blks_hit) + sum(idx_blks_read), 0), 4)
  from pg_statio_user_indexes;

-- 2. Statements that read the most from disk: see
--    scripts/recon/disk-io-top-queries.sql (needs pg_stat_statements, which
--    Supabase has; a plain local Postgres usually does not).

-- 3. Tables read by sequential scan, the biggest first. A large table with a
--    high seq_scan count is a missing index.
select relname as table_name,
       seq_scan,
       seq_tup_read,
       idx_scan,
       n_live_tup as live_rows,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size
  from pg_stat_user_tables
 where seq_scan > 0
 order by seq_tup_read desc
 limit 20;

-- 4. Largest tables (data + indexes + toast).
select relname as table_name,
       n_live_tup as live_rows,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size
  from pg_stat_user_tables
 order by pg_total_relation_size(relid) desc
 limit 20;

-- 5. Indexes never read since the statistics were last reset. Unique and
--    primary-key indexes are left out (they enforce rules, not speed).
select s.relname as table_name,
       s.indexrelname as index_name,
       pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size
  from pg_stat_user_indexes s
  join pg_index i on i.indexrelid = s.indexrelid
 where s.idx_scan = 0
   and not i.indisunique
   and not i.indisprimary
 order by pg_relation_size(s.indexrelid) desc
 limit 20;

select 'DISK IO DIAGNOSE DONE' as status;
rollback;
