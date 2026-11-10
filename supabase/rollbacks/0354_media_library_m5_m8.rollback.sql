-- Rollback for 0354_media_library_m5_m8.sql (D221 M5 to M8).
-- Run MANUALLY only if needed.
--
-- What this does NOT undo: pictures an "Undo auto-publish" set back to draft
-- stay drafts with publish_reason 'auto-reverted' (run "Re-publish" first if
-- you want them back). Collections and the search log are dropped with their
-- tables - export them first if they matter.
drop function if exists public.media_set_auto_publish(text, uuid[]);
drop function if exists public.media_similar(uuid, integer);
drop function if exists public.media_search_summary(integer);
drop table if exists public.media_collection_items;
drop table if exists public.media_collections;
drop table if exists public.media_search_log;

-- Back to the 0352 auto-publish rule.
create or replace function public.media_auto_publish()
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  update public.media_assets m
     set status = 'published',
         publish_reason = 'vendor-source-auto',
         published_at = coalesce(m.published_at, now())
   where m.status = 'draft'
     and m.canonical_id is null
     and m.review_state = 'ok'
     and m.vendor_id is not null
     and m.platform in ('cultivera', 'growflow', 'leaflink', 'email', 'website')
     and (m.mime_type like 'image/%' or m.mime_type = 'application/pdf');
  get diagnostics n = row_count;
  return jsonb_build_object('published', n);
end;
$$;

-- Back to the 0353 health counters.
create or replace function public.media_library_health()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'live', count(*) filter (where status <> 'archived'),
    'published', count(*) filter (where status = 'published'),
    'draft', count(*) filter (where status = 'draft'),
    'archived', count(*) filter (where status = 'archived'),
    'archived_copies', count(*) filter (where canonical_id is not null),
    'with_vendor', count(*) filter (where status <> 'archived' and vendor_id is not null),
    'with_product', count(*) filter (where status <> 'archived' and product_name is not null),
    'ai_described', count(*) filter (where status <> 'archived' and ai_status = 'done'),
    'ai_pending', count(*) filter (where status <> 'archived' and ai_status = 'pending' and mime_type like 'image/%'),
    'ai_failed', count(*) filter (where status <> 'archived' and ai_status = 'failed'),
    'ai_skipped', count(*) filter (where status <> 'archived' and ai_status = 'skipped'),
    'with_seo', count(*) filter (where status <> 'archived' and seo_alt is not null and seo_title is not null),
    'needs_review', count(*) filter (where status <> 'archived' and review_state = 'needs_review'),
    'rejected', count(*) filter (where status <> 'archived' and review_state = 'rejected'),
    'auto_published', count(*) filter (where publish_reason = 'vendor-source-auto'),
    'ai_spend_usd', (select coalesce(sum(r.cost_usd), 0) from public.media_ai_runs r)
  )
  from public.media_assets;
$$;
revoke all on function public.media_auto_publish() from public, anon, authenticated;
revoke all on function public.media_library_health() from public, anon, authenticated;
grant execute on function public.media_auto_publish() to service_role;
grant execute on function public.media_library_health() to service_role;

notify pgrst, 'reload schema';
