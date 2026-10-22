-- scripts/recon/disk-io-top-queries.sql  (USAGE-6 - Disk IO budget)
--
-- READ-ONLY. Paste into Supabase -> SQL Editor and press Run. Lists the 20
-- statements that read the most 8 kB blocks from disk since statistics were
-- last reset, using pg_stat_statements (on by default on Supabase). Supabase's
-- "High Disk I/O" guide names slow queries as a common cause
-- (docs/usage-sources/supabase-high-disk-io.txt).
--
-- How to read it: shared_blks_read is disk reads (cache misses); calls is how
-- often it ran. A statement near the top with a huge calls count is a poll; one
-- with few calls but a huge shared_blks_read is a scan of a big table.
begin;
set transaction read only;

select calls,
       shared_blks_read,
       shared_blks_hit,
       round(total_exec_time)::bigint as total_ms,
       round(mean_exec_time::numeric, 2) as mean_ms,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) as query
  from pg_stat_statements
 order by shared_blks_read desc
 limit 20;

rollback;
