-- scripts/ops/perf-remeasure.sql  (PERF round, owner 2026-11-05, D186-D190)
-- READ-ONLY. Paste each step into the Supabase SQL editor after 0344 and
-- scripts/ops/menu-copy-reclaim.sql. Nothing here writes.

-- 1) Table sizes: menu_items / menu_variants should be far below 720k / 803k rows.
select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) as total
from pg_stat_user_tables
where relname in ('menu_items','menu_variants','product_latest_facts','vendors','product_first_seen','kb_strains','kb_products','inventory_lots')
order by pg_total_relation_size(relid) desc;

-- 2) The heavy vendor row (459 kB measured): which column holds the weight?
select id, display_name,
       pg_column_size(v.*)                 as row_bytes,
       pg_column_size(about)               as about_bytes,
       pg_column_size(mission_statement)   as mission_bytes,
       pg_column_size(social_json)         as social_bytes,
       pg_column_size(internal_notes)      as notes_bytes,
       pg_column_size(usual_transport)     as transport_bytes
from public.vendors v
order by pg_column_size(v.*) desc
limit 5;
-- If one column is hundreds of kB (an inline image or pasted document), send
-- the result to the developer: the fix is to move it to storage and read
-- the vendor list without that column.

-- 3) The top database costs since the last reset (needs pg_stat_statements).
select round(total_exec_time::numeric / 1000, 1) as total_s,
       calls,
       round(mean_exec_time::numeric, 1)          as mean_ms,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) as query
from pg_stat_statements
order by total_exec_time desc
limit 20;
