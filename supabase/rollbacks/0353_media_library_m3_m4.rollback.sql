-- Rollback for 0353_media_library_m3_m4.sql (D221 M3+M4).
-- Run MANUALLY only if needed.
--
-- What this does NOT undo: the vendor_id / credit_text values 0353 filled in,
-- and the pictures it auto-published, stay as they are (they are gap-fills a
-- person could also have made; unpublish one from its page if it is wrong).
-- The AI fields the describe worker wrote stay too.
drop function if exists public.media_backfill_vendor_links();
drop function if exists public.media_vendor_tag(text);
drop index if exists public.idx_media_assets_review_queue;
drop index if exists public.idx_media_ai_runs_active;

alter table public.media_assets drop constraint if exists media_assets_reviewed_by_fk;
alter table public.media_assets
  drop column if exists reviewed_by,
  drop column if exists reviewed_at;
alter table public.media_ai_runs
  drop column if exists lease_token,
  drop column if exists lease_until,
  drop column if exists follow_new,
  drop column if exists input_tokens,
  drop column if exists output_tokens,
  drop column if exists last_tick_at;

-- Back to the 0352 resolver (merged cards skipped, not followed).
create or replace function public.media_resolve_vendor(p_label text, p_license text default null)
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  with lab as (
    select public.media_norm_name(p_label) as n,
           coalesce(nullif(btrim(p_license), ''), substring(coalesce(p_label, '') from '([0-9]{6})')) as lic
  )
  select coalesce(
    (select v.id from public.vendors v, lab
      where v.merged_into_id is null and lab.lic is not null and v.license_number = lab.lic
      order by v.created_at limit 1),
    (select v.id from public.vendors v, lab
      where v.merged_into_id is null and length(lab.n) >= 3
        and (public.media_norm_name(v.display_name) = lab.n
             or public.media_norm_name(v.legal_name) = lab.n
             or public.media_norm_name(v.slug) = lab.n)
      order by v.created_at limit 1),
    (select v.id from public.vendors v, lab
      where v.merged_into_id is null and length(public.media_norm_name(v.display_name)) >= 6
        and lab.n like public.media_norm_name(v.display_name) || '%'
      order by length(v.display_name) desc, v.created_at limit 1)
  );
$$;

-- Back to the 0352 health counters.
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
    'with_seo', count(*) filter (where status <> 'archived' and seo_alt is not null and seo_title is not null),
    'needs_review', count(*) filter (where status <> 'archived' and review_state = 'needs_review'),
    'auto_published', count(*) filter (where publish_reason = 'vendor-source-auto')
  )
  from public.media_assets;
$$;
revoke all on function public.media_resolve_vendor(text, text) from public, anon, authenticated;
revoke all on function public.media_library_health() from public, anon, authenticated;
grant execute on function public.media_resolve_vendor(text, text) to service_role;
grant execute on function public.media_library_health() to service_role;

notify pgrst, 'reload schema';
