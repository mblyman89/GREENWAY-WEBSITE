-- Rollback for 0366_media_search_fast.sql (D247).
-- Run MANUALLY only if needed. Puts back the 0352 media_search body exactly
-- (same results, slower) and drops the one index 0366 added.
create or replace function public.media_search(
  p_query      text default null,
  p_vendor_id  uuid default null,
  p_brand_id   uuid default null,
  p_role       text default null,
  p_category   text default null,
  p_status     text default null,
  p_platform   text default null,
  p_limit      integer default 60,
  p_offset     integer default 0
)
returns table (media_id uuid, score real, total bigint)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with q as (
    select nullif(lower(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'))), '') as t
  ),
  tsq as (
    select q.t,
           case when q.t is null then null
                else to_tsquery('simple', (
                  select string_agg(w || ':*', ' & ')
                    from regexp_split_to_table(regexp_replace(q.t, '[^a-z0-9 ]', ' ', 'g'), ' +') w
                   where w <> ''))
           end as tq
      from q
  ),
  base as (
    select m.id, m.created_at,
           case when tsq.t is null then 0::real
                else (coalesce(ts_rank_cd(m.search_tsv, tsq.tq), 0) * 2
                      + greatest(similarity(lower(coalesce(m.product_name, '')), tsq.t),
                                 similarity(lower(coalesce(m.title, '')), tsq.t),
                                 word_similarity(tsq.t, lower(coalesce(m.visible_text, '') || ' ' || coalesce(m.ai_caption, ''))))
                     )::real
           end as s,
           (tsq.tq is not null and m.search_tsv @@ tsq.tq) as fts_hit
      from public.media_assets m, tsq
     where (case when p_status is null or p_status = '' then m.status <> 'archived'
                 else m.status::text = p_status end)
       and (p_vendor_id is null or m.vendor_id = p_vendor_id)
       and (p_brand_id is null or m.brand_id = p_brand_id)
       and (p_role is null or p_role = '' or m.role = p_role)
       and (p_category is null or p_category = '' or m.category = p_category)
       and (p_platform is null or p_platform = '' or m.platform = p_platform)
  ),
  hits as (
    select b.id, b.s, b.created_at
      from base b, tsq
     where tsq.t is null or b.fts_hit or b.s >= 0.3
  )
  select h.id, h.s, count(*) over () as total
    from hits h
   order by h.s desc, h.created_at desc, h.id
   limit least(greatest(coalesce(p_limit, 60), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.media_search(text, uuid, uuid, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.media_search(text, uuid, uuid, text, text, text, text, integer, integer) to service_role;
drop index if exists public.idx_media_assets_text_trgm;

notify pgrst, 'reload schema';
