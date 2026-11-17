-- ============================================================================
-- 0366 - MEDIA SEARCH WITHOUT A FULL SCAN  (D247)
--
-- WHY. Owner, verbatim (D247): "why is it taking so long? ... the enrichment
-- page is terrible too." Measured on the live database (pg_stat_statements,
-- 2026-11-16): public.media_search was the single most expensive statement,
-- about 1.8 s a call on average (max 4.5 s), 2,884 calls, about 5,085 s of
-- database time. Every enrichment page and every onboarding photo search
-- calls it several times (the full name and then one call per word).
--
-- CAUSE. The 0352 function computes three trigram scores on EVERY live photo
-- (lower(...) on each column) before it filters, so none of the existing
-- indexes (search_tsv, title / product_name trigram) can be used: each call
-- scores all ~8,000 live photos.
--
-- FIX. The SAME ranking, written in plpgsql so the query words are computed
-- first and the planner can use the indexes, with a candidate step that
-- the indexes can answer: a photo can only pass the 0352 cut (full-text hit,
-- or score >= 0.3) if it is a full-text hit or one of its three trigram
-- scores is >= 0.3 (when there is no full-text hit the rank part is zero -
-- verified on the live data), so the filter keeps every photo 0352 would
-- return. The thresholds are set to 0.29 for this call only (set_config in
-- the body - see the note there - then put back). pg_trgm is
-- case-insensitive, so the raw columns match the lower() scores (verified:
-- zero differences on the live library). Verified before writing this file:
-- for seven real queries the ordered top 60 (ids, scores and totals)
-- were identical to 0352. One new trigram index on the photo package text +
-- AI caption (the only searched text without one).
--
-- Safe to re-run (create index if not exists, create or replace). Service
-- role only, as before. Rollback: supabase/rollbacks/0366_media_search_fast.rollback.sql
-- ============================================================================

create index if not exists idx_media_assets_text_trgm
  on public.media_assets using gin ((coalesce(visible_text, '') || ' ' || coalesce(ai_caption, '')) gin_trgm_ops);

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
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_t   text := nullif(lower(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'))), '');
  v_tq  tsquery := null;
  v_lim integer := least(greatest(coalesce(p_limit, 60), 1), 200);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_old_sim  text;
  v_old_wsim text;
begin
  if v_t is null then
    return query
      select m.id, 0::real, count(*) over ()
        from public.media_assets m
       where (case when p_status is null or p_status = '' then m.status <> 'archived'
                   else m.status::text = p_status end)
         and (p_vendor_id is null or m.vendor_id = p_vendor_id)
         and (p_brand_id is null or m.brand_id = p_brand_id)
         and (p_role is null or p_role = '' or m.role = p_role)
         and (p_category is null or p_category = '' or m.category = p_category)
         and (p_platform is null or p_platform = '' or m.platform = p_platform)
       order by m.created_at desc, m.id
       limit v_lim offset v_off;
    return;
  end if;

  v_tq := to_tsquery('simple', (
    select string_agg(w || ':*', ' & ')
      from regexp_split_to_table(regexp_replace(v_t, '[^a-z0-9 ]', ' ', 'g'), ' +') w
     where w <> ''));

  -- Thresholds for the candidate step, for this call only. Set in the body
  -- with set_config because a function SET clause naming a pg_trgm setting
  -- is refused (42501) for a non-superuser such as the SQL editor login.
  -- The caller values are saved first and put back before returning.
  v_old_sim  := coalesce(nullif(current_setting('pg_trgm.similarity_threshold', true), ''), '0.3');
  v_old_wsim := coalesce(nullif(current_setting('pg_trgm.word_similarity_threshold', true), ''), '0.6');
  perform set_config('pg_trgm.similarity_threshold', '0.29', true);
  perform set_config('pg_trgm.word_similarity_threshold', '0.29', true);

  return query
    with cand as (
      select c.id from public.media_assets c where v_tq is not null and c.search_tsv @@ v_tq
      union
      select c.id from public.media_assets c where c.product_name % v_t
      union
      select c.id from public.media_assets c where c.title % v_t
      union
      select c.id from public.media_assets c where v_t <% (coalesce(c.visible_text, '') || ' ' || coalesce(c.ai_caption, ''))
    ),
    base as (
      select m.id, m.created_at,
             (coalesce(ts_rank_cd(m.search_tsv, v_tq), 0) * 2
              + greatest(similarity(lower(coalesce(m.product_name, '')), v_t),
                         similarity(lower(coalesce(m.title, '')), v_t),
                         word_similarity(v_t, lower(coalesce(m.visible_text, '') || ' ' || coalesce(m.ai_caption, ''))))
             )::real as s,
             (v_tq is not null and m.search_tsv @@ v_tq) as fts_hit
        from cand
        join public.media_assets m on m.id = cand.id
       where (case when p_status is null or p_status = '' then m.status <> 'archived'
                   else m.status::text = p_status end)
         and (p_vendor_id is null or m.vendor_id = p_vendor_id)
         and (p_brand_id is null or m.brand_id = p_brand_id)
         and (p_role is null or p_role = '' or m.role = p_role)
         and (p_category is null or p_category = '' or m.category = p_category)
         and (p_platform is null or p_platform = '' or m.platform = p_platform)
    ),
    hits as (
      select b.id, b.s, b.created_at from base b where b.fts_hit or b.s >= 0.3
    )
    select h.id, h.s, count(*) over ()
      from hits h
     order by h.s desc, h.created_at desc, h.id
     limit v_lim offset v_off;

  perform set_config('pg_trgm.similarity_threshold', v_old_sim, true);
  perform set_config('pg_trgm.word_similarity_threshold', v_old_wsim, true);
end;
$$;

comment on function public.media_search(text, uuid, uuid, text, text, text, text, integer, integer) is
  'D221 M1 (0352), D247 (0366): ranked media search. Same ranking and results as 0352, and 0366 first collects candidates through the indexes (full text, or trigram similarity at 0.29, just under the 0.3 cut) so a search no longer scores every photo. Service role only.';

revoke all on function public.media_search(text, uuid, uuid, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.media_search(text, uuid, uuid, text, text, text, text, integer, integer) to service_role;

notify pgrst, 'reload schema';
