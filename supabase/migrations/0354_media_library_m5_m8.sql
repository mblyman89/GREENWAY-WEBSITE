-- =============================================================================
-- 0354 - media library M5 to M8: undo auto-publish, find similar, collections,
--        the search log, and the health counters for the library dashboard (D221)
-- =============================================================================
-- SQL EDITOR: if the editor shows "Potential issue detected", click
-- "Run without RLS". The new tables are service-role only with row level
-- security on, like media_ai_runs.
-- A copy with no comments: supabase/migrations/editor-safe/0354_media_library_m5_m8.EDITOR_SAFE.sql
--
-- Owner (D221, 2026-11-10): "Please make sure there is a button from the media
-- library page to the review page and back please. Please finish the last
-- slices of work to be done now." = M5 (auto-publish rules + review queue,
-- one-click revert), M6 (recommender v2 + "search for a better picture" +
-- "find similar"), M7 (library UI v2: search, facets, bulk, detail, health,
-- collections, search log), M8 (storefront ImageObject + alt + image sitemap).
--
-- WHAT THE LIVE DATABASE SHOWED (2026-11-10, read-only, 0352 + 0353 applied):
--   * 10,298 media rows: 4,105 live, 6,193 archived copies.
--   * 3,811 published, 3,678 of them auto-published (vendor-source-auto).
--   * 203 waiting in the review queue. AI describe not started (0 runs).
--   * 44 published product pages have a picture. None has an SEO alt yet.
--
-- WHAT THIS MIGRATION DOES
--   1. media_set_auto_publish(mode, ids): the one-click revert. 'undo' sets
--      auto-published pictures back to draft (publish_reason
--      'auto-reverted', so nothing re-publishes them). 'redo' puts them back.
--      ids = null means every auto-published picture. Nothing is deleted.
--   2. media_auto_publish() only publishes a draft that was NEVER published
--      (published_at is null) and has no publish_reason, so a picture a person
--      set back to draft, or an undone auto-publish, stays a draft.
--   3. media_similar(id, limit): "find similar" - same file, same vendor or
--      brand, similar product name (trigram), same strain, similar package
--      text, same category / role. Each hit says why. No pgvector: the
--      describe pass writes the text this compares, and trigram + full text
--      need no embedding cost.
--   4. media_collections + media_collection_items: curated sets and brand kits.
--      Archive, never delete (archived_at / removed_at).
--   5. media_search_log + media_search_summary(days): what people search for,
--      and which searches found nothing, to tune names and tags.
--   6. media_library_health() adds auto_reverted, collections, searches_30d
--      and zero_result_30d.
--
-- Idempotent: "if not exists" / "create or replace" throughout.
-- Rollback: supabase/rollbacks/0354_media_library_m5_m8.rollback.sql
-- =============================================================================

create extension if not exists pg_trgm;

-- -- 1. One-click revert of auto-publish -------------------------------------------
create or replace function public.media_set_auto_publish(p_mode text, p_ids uuid[] default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  n integer := 0;
begin
  if p_mode = 'undo' then
    update public.media_assets m
       set status = 'draft',
           publish_reason = 'auto-reverted'
     where m.status = 'published'
       and m.publish_reason = 'vendor-source-auto'
       and (p_ids is null or m.id = any(p_ids));
    get diagnostics n = row_count;
  elsif p_mode = 'redo' then
    update public.media_assets m
       set status = 'published',
           publish_reason = 'vendor-source-auto',
           published_at = coalesce(m.published_at, now())
     where m.status = 'draft'
       and m.publish_reason = 'auto-reverted'
       and m.review_state = 'ok'
       and m.canonical_id is null
       and (p_ids is null or m.id = any(p_ids));
    get diagnostics n = row_count;
  else
    raise exception 'media_set_auto_publish: unknown mode %', p_mode;
  end if;
  return jsonb_build_object('mode', p_mode, 'changed', n);
end;
$$;

comment on function public.media_set_auto_publish(text, uuid[]) is
  'D221 M5 (0354): undo = auto-published pictures back to draft (publish_reason auto-reverted), redo = back to published. ids null = all. Never deletes. Service role only.';

-- -- 2. Auto-publish never re-publishes what a person or an undo set back to draft --
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
     and m.publish_reason is null
     and m.published_at is null
     and m.canonical_id is null
     and m.review_state = 'ok'
     and m.vendor_id is not null
     and m.platform in ('cultivera', 'growflow', 'leaflink', 'email', 'website')
     and (m.mime_type like 'image/%' or m.mime_type = 'application/pdf');
  get diagnostics n = row_count;
  return jsonb_build_object('published', n);
end;
$$;

comment on function public.media_auto_publish() is
  'D221 M2 (0352), tightened M5 (0354): publish drafts that were never published, whose source is the vendor menu or website, whose vendor is known, that are not copies and are not flagged for review. A picture set back to draft by a person or by undo stays a draft. Service role only.';

-- -- 3. Find similar -----------------------------------------------------------------
create or replace function public.media_similar(p_id uuid, p_limit integer default 24)
returns table (media_id uuid, score real, reasons text[])
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with me as (
    select m.id, m.vendor_id, m.brand_id, m.content_hash, m.category, m.role,
           lower(coalesce(nullif(m.product_name, ''), nullif(m.title, ''), '')) as nm,
           lower(coalesce(m.strain_name, '')) as st,
           lower(coalesce(m.visible_text, '')) as vt
      from public.media_assets m
     where m.id = p_id
  ),
  c as (
    select m.id, m.created_at,
           (me.content_hash is not null and m.content_hash = me.content_hash) as same_file,
           (me.vendor_id is not null and m.vendor_id = me.vendor_id) as same_vendor,
           (me.brand_id is not null and m.brand_id = me.brand_id) as same_brand,
           case when length(me.nm) >= 3
                then similarity(lower(coalesce(nullif(m.product_name, ''), nullif(m.title, ''), '')), me.nm)
                else 0 end as name_sim,
           (length(me.st) >= 3 and lower(coalesce(m.strain_name, '')) = me.st) as same_strain,
           case when length(me.vt) >= 3 and coalesce(m.visible_text, '') <> ''
                then similarity(lower(m.visible_text), me.vt)
                else 0 end as label_sim,
           (me.category is not null and m.category = me.category) as same_category,
           (me.role is not null and m.role = me.role) as same_role
      from public.media_assets m, me
     where m.id <> me.id
       and m.status <> 'archived'
       and (
         (me.vendor_id is not null and m.vendor_id = me.vendor_id)
         or (me.brand_id is not null and m.brand_id = me.brand_id)
         or (me.content_hash is not null and m.content_hash = me.content_hash)
         or (length(me.st) >= 3 and lower(coalesce(m.strain_name, '')) = me.st)
         or (length(me.nm) >= 3 and lower(coalesce(nullif(m.product_name, ''), nullif(m.title, ''), '')) % me.nm)
       )
  ),
  s as (
    select c.*,
           (case when same_file then 1.0 else 0 end
            + case when same_vendor then 0.3 else 0 end
            + case when same_brand then 0.2 else 0 end
            + name_sim
            + case when same_strain then 0.3 else 0 end
            + label_sim * 0.5
            + case when same_category then 0.1 else 0 end
            + case when same_role then 0.1 else 0 end)::real as total
      from c
  )
  select s.id,
         s.total,
         array_remove(array[
           case when s.same_file then 'same-file' end,
           case when s.same_vendor then 'same-vendor' end,
           case when s.same_brand then 'same-brand' end,
           case when s.name_sim >= 0.4 then 'similar-name' end,
           case when s.same_strain then 'same-strain' end,
           case when s.label_sim >= 0.3 then 'similar-label' end,
           case when s.same_category then 'same-category' end
         ], null)
    from s
   where s.total >= 0.45
   order by s.total desc, s.created_at desc, s.id
   limit least(greatest(coalesce(p_limit, 24), 1), 100);
$$;

comment on function public.media_similar(uuid, integer) is
  'D221 M6 (0354): pictures like this one - same file, vendor, brand, strain, similar product name or package text, same category - ranked, each with the reasons. Archived rows excluded. Service role only.';

-- -- 4. Collections ---------------------------------------------------------------------
create table if not exists public.media_collections (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null,
  description  text,
  kind         text not null default 'collection',
  vendor_id    uuid references public.vendors(id) on delete set null,
  archived_at  timestamptz,
  created_by   uuid references public.staff_profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint media_collections_name_chk check (length(btrim(name)) between 1 and 120),
  constraint media_collections_slug_chk check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  constraint media_collections_kind_chk check (kind in ('collection', 'brand-kit'))
);

create unique index if not exists uq_media_collections_live_slug
  on public.media_collections (slug) where archived_at is null;

drop trigger if exists trg_media_collections_updated on public.media_collections;
create trigger trg_media_collections_updated before update on public.media_collections
  for each row execute function public.set_updated_at();

create table if not exists public.media_collection_items (
  collection_id  uuid not null references public.media_collections(id) on delete cascade,
  media_id       uuid not null references public.media_assets(id) on delete cascade,
  position       integer not null default 0,
  added_by       uuid references public.staff_profiles(id) on delete set null,
  added_at       timestamptz not null default now(),
  removed_at     timestamptz,
  primary key (collection_id, media_id)
);

create index if not exists idx_media_collection_items_media
  on public.media_collection_items (media_id) where removed_at is null;

alter table public.media_collections enable row level security;
alter table public.media_collection_items enable row level security;
revoke all on table public.media_collections from public, anon, authenticated;
revoke all on table public.media_collection_items from public, anon, authenticated;
grant select, insert, update, delete on table public.media_collections to service_role;
grant select, insert, update, delete on table public.media_collection_items to service_role;

comment on table public.media_collections is
  'D221 M7 (0354): curated media sets and brand kits. Archive (archived_at), never delete. Service role only.';
comment on table public.media_collection_items is
  'D221 M7 (0354): which pictures are in which collection. Taking one out stamps removed_at. Service role only.';

-- -- 5. Search log ----------------------------------------------------------------------
create table if not exists public.media_search_log (
  id          bigint generated always as identity primary key,
  surface     text not null,
  query       text not null,
  filters     jsonb not null default '{}'::jsonb,
  results     integer not null default 0,
  actor_id    uuid references public.staff_profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint media_search_log_surface_chk check (surface in ('library', 'picker', 'onboarding')),
  constraint media_search_log_query_chk check (length(query) between 1 and 200),
  constraint media_search_log_results_chk check (results >= 0)
);

create index if not exists idx_media_search_log_created on public.media_search_log (created_at desc);

alter table public.media_search_log enable row level security;
revoke all on table public.media_search_log from public, anon, authenticated;
grant select, insert on table public.media_search_log to service_role;
grant usage, select on sequence public.media_search_log_id_seq to service_role;

comment on table public.media_search_log is
  'D221 M7 (0354): media searches (library, product picker, onboarding) with how many results they found, to tune names and tags. Service role only.';

create or replace function public.media_search_summary(p_days integer default 30)
returns table (query text, searches bigint, zero_hits bigint, last_at timestamptz)
language sql
stable
set search_path = public, pg_temp
as $$
  select lower(btrim(l.query)) as query,
         count(*) as searches,
         count(*) filter (where l.results = 0) as zero_hits,
         max(l.created_at) as last_at
    from public.media_search_log l
   where l.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
   group by lower(btrim(l.query))
   order by count(*) filter (where l.results = 0) desc, count(*) desc, max(l.created_at) desc
   limit 25;
$$;

comment on function public.media_search_summary(integer) is
  'D221 M7 (0354): the 25 most-searched media queries of the last N days, searches that found nothing first. Service role only.';

-- -- 6. Health counters -------------------------------------------------------------------
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
    'auto_reverted', count(*) filter (where publish_reason = 'auto-reverted'),
    'ai_spend_usd', (select coalesce(sum(r.cost_usd), 0) from public.media_ai_runs r),
    'collections', (select count(*) from public.media_collections c where c.archived_at is null),
    'searches_30d', (select count(*) from public.media_search_log l where l.created_at >= now() - interval '30 days'),
    'zero_result_30d', (select count(*) from public.media_search_log l where l.created_at >= now() - interval '30 days' and l.results = 0)
  )
  from public.media_assets;
$$;

-- -- 7. Grants ------------------------------------------------------------------------------
revoke all on function public.media_set_auto_publish(text, uuid[]) from public, anon, authenticated;
revoke all on function public.media_auto_publish() from public, anon, authenticated;
revoke all on function public.media_similar(uuid, integer) from public, anon, authenticated;
revoke all on function public.media_search_summary(integer) from public, anon, authenticated;
revoke all on function public.media_library_health() from public, anon, authenticated;
grant execute on function public.media_set_auto_publish(text, uuid[]) to service_role;
grant execute on function public.media_auto_publish() to service_role;
grant execute on function public.media_similar(uuid, integer) to service_role;
grant execute on function public.media_search_summary(integer) to service_role;
grant execute on function public.media_library_health() to service_role;

notify pgrst, 'reload schema';
