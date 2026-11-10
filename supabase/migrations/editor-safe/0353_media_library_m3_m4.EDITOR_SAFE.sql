alter table public.media_ai_runs add column if not exists lease_token text;
alter table public.media_ai_runs add column if not exists lease_until timestamptz;
alter table public.media_ai_runs add column if not exists follow_new boolean not null default false;
alter table public.media_ai_runs add column if not exists input_tokens bigint not null default 0;
alter table public.media_ai_runs add column if not exists output_tokens bigint not null default 0;
alter table public.media_ai_runs add column if not exists last_tick_at timestamptz;

comment on column public.media_ai_runs.lease_token is
  '0353 (D221 M4): compare-and-set lease of the describe worker tick holding this run. Null = free.';
comment on column public.media_ai_runs.follow_new is
  '0353 (D221 M4): when true the run stays open after the backlog is done and describes each new picture within one tick of its save.';

alter table public.media_assets add column if not exists reviewed_by uuid;
alter table public.media_assets add column if not exists reviewed_at timestamptz;

do $$begin
  if not exists (select 1 from pg_constraint where conname = 'media_assets_reviewed_by_fk') then
    alter table public.media_assets add constraint media_assets_reviewed_by_fk
      foreign key (reviewed_by) references public.staff_profiles(id) on delete set null;
  end if;
end
$$;

create index if not exists idx_media_assets_review_queue
  on public.media_assets (created_at) where review_state = 'needs_review' and status <> 'archived';
create index if not exists idx_media_ai_runs_active
  on public.media_ai_runs (created_at) where status in ('queued', 'running');

create or replace function public.media_resolve_vendor(p_label text, p_license text default null)
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$with lab as (
    select public.media_norm_name(p_label) as n,
           coalesce(nullif(btrim(p_license), ''), substring(coalesce(p_label, '') from '([0-9]{6})')) as lic
  )
  select public.vendor_survivor_id(coalesce(
    (select v.id from public.vendors v, lab
      where lab.lic is not null and v.license_number = lab.lic
      order by (v.merged_into_id is not null), v.created_at limit 1),
    (select v.id from public.vendors v, lab
      where length(lab.n) >= 3
        and (public.media_norm_name(v.display_name) = lab.n
             or public.media_norm_name(v.legal_name) = lab.n
             or public.media_norm_name(v.slug) = lab.n)
      order by (v.merged_into_id is not null), v.created_at limit 1),
    (select v.id from public.vendors v, lab
      where length(public.media_norm_name(v.display_name)) >= 6
        and lab.n like public.media_norm_name(v.display_name) || '%'
      order by (v.merged_into_id is not null), length(v.display_name) desc, v.created_at limit 1)
  ));
$$;

comment on function public.media_resolve_vendor(text, text) is
  'D221 (0352, 0353): the live vendor card a menu seller name / store name / license belongs to, or null. License first, then the normalised display / legal name / slug, then a long-enough name prefix. 0353: a merged card is followed to its survivor. Service role only.';

create or replace function public.media_vendor_tag(p text)
returns text
language sql
immutable
as $$select left(btrim(regexp_replace(lower(btrim(coalesce(p, ''))), '[^a-z0-9]+', '-', 'g'), '-'), 40);
$$;

create or replace function public.media_backfill_vendor_links()
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$declare
  n_code integer := 0; n_tag integer := 0; n_title integer := 0; n_credit integer := 0; n integer;
  placeholder uuid;
begin
  select id into placeholder from public.vendors where slug = 'independent-unlisted-vendor' limit 1;

  create temporary table if not exists media_m3_snap (src text, tag text, vid uuid) on commit drop;
  truncate media_m3_snap;
  insert into media_m3_snap (src, tag, vid)
  select 'cultivera:' || s.id::text, public.media_vendor_tag(t.label),
         coalesce(public.vendor_survivor_id(s.vendor_id),
                  public.media_resolve_vendor(s.seller_name),
                  public.media_resolve_vendor(replace(s.cultivera_market_slug, '-', ' ')))
    from public.cultivera_menu_snapshots s,
         lateral (select coalesce(nullif(btrim(s.seller_name), ''), s.cultivera_market_slug) as label
                  union select s.cultivera_market_slug) t
   where t.label is not null;
  insert into media_m3_snap (src, tag, vid)
  select 'growflow:' || g.id::text, public.media_vendor_tag(coalesce(nullif(btrim(g.store_name), ''), g.license_number)),
         coalesce(public.vendor_survivor_id(g.vendor_id), public.media_resolve_vendor(g.store_name, g.license_number))
    from public.growflow_menu_snapshots g;
  if to_regclass('public.leaflink_menu_snapshots') is not null then
    insert into media_m3_snap (src, tag, vid)
    select 'leaflink:' || l.id::text, public.media_vendor_tag(coalesce(nullif(btrim(l.brand_name), ''), l.company_name)),
           coalesce(public.vendor_survivor_id(l.vendor_id), public.media_resolve_vendor(l.company_name), public.media_resolve_vendor(l.brand_name))
      from public.leaflink_menu_snapshots l;
  end if;

  update media_m3_snap set vid = null where vid = placeholder;
  delete from media_m3_snap where tag is null or tag = '';

  update public.media_assets m
     set vendor_id = x.vid
    from (
      with codes as materialized (
        select substring(i.image_url from '/(435553542D[0-9A-F]+)/') as code,
               coalesce(public.vendor_survivor_id(s.vendor_id),
                        public.media_resolve_vendor(s.seller_name),
                        public.media_resolve_vendor(replace(s.cultivera_market_slug, '-', ' '))) as vid
          from public.cultivera_menu_items i
          join public.cultivera_menu_snapshots s on s.id = i.snapshot_id
         where i.image_url ~ '/435553542D[0-9A-F]+/'
      ),
      one as materialized (
        select code, min(vid::text)::uuid as vid
          from codes
         group by code
        having count(distinct vid) = 1 and count(*) filter (where vid is null) = 0
      )
      select a.id, one.vid
        from public.media_assets a
        join one on substring(a.source_url from '/(435553542D[0-9A-F]+)/') = one.code
       where a.vendor_id is null and a.status <> 'archived'
    ) x
   where m.id = x.id and m.vendor_id is null and x.vid is distinct from placeholder;
  get diagnostics n_code = row_count;

  update public.media_assets m
     set vendor_id = x.vid
    from (
      with one as materialized (
        select tag, min(vid::text)::uuid as vid
          from media_m3_snap
         group by tag
        having count(distinct vid) = 1 and count(*) filter (where vid is null) = 0
      )
      select distinct on (a.id) a.id, one.vid
        from public.media_assets a, unnest(a.tags) as at(tag)
        join one on one.tag = at.tag
       where a.vendor_id is null and a.status <> 'archived'
       order by a.id, array_position(a.tags, at.tag)
    ) x
   where m.id = x.id and m.vendor_id is null;
  get diagnostics n_tag = row_count;

  update public.media_assets m
     set vendor_id = x.vid
    from (
      with w as materialized (
        select a.id,
               btrim(regexp_replace(a.title, '\s*(\(harvested\)|\(web research\)|\(web import\)|logo|banner|hero)\s*$', '', 'i')) as nm
          from public.media_assets a
         where a.vendor_id is null and a.status <> 'archived'
           and (a.platform = 'website' or a.usage_type in ('vendor-logo', 'brand-logo') or a.title ~* '\(harvested\)\s*$')
           and a.title is not null
      ),
      r as materialized (
        select w.id, coalesce(
                 public.media_resolve_vendor(w.nm),
                 (select min(public.vendor_survivor_id(b.vendor_id)::text)::uuid
                    from public.brands b
                   where b.vendor_id is not null and b.vendor_id is distinct from placeholder
                     and length(public.media_norm_name(w.nm)) >= 3
                     and public.media_norm_name(b.display_name) = public.media_norm_name(w.nm)
                  having count(distinct public.vendor_survivor_id(b.vendor_id)) = 1)) as vid
          from w
      )
      select id, vid from r where vid is not null
    ) x
   where m.id = x.id and m.vendor_id is null and x.vid is distinct from placeholder;
  get diagnostics n_title = row_count;

  update public.media_assets m
     set credit_text = v.display_name
    from public.vendors v
   where m.vendor_id = v.id and m.credit_text is null
     and m.platform in ('cultivera', 'growflow', 'leaflink', 'email', 'website');
  get diagnostics n_credit = row_count;

  return jsonb_build_object('seller_code', n_code, 'seller_tag', n_tag, 'title', n_title, 'credit', n_credit);
end;
$$;

comment on function public.media_backfill_vendor_links() is
  'D221 M3 (0353): gap-fill media_assets.vendor_id from the Cultivera seller folder code in the URL, the seller tag the menu save wrote, and the "<Name> (harvested)" title - each only when every source agrees on ONE vendor. Merged cards are followed to the survivor. The placeholder vendor never counts. Never overwrites. Service role only.';

create or replace function public.media_library_health()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$select jsonb_build_object(
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

revoke all on function public.media_resolve_vendor(text, text) from public, anon, authenticated;
revoke all on function public.media_vendor_tag(text) from public, anon, authenticated;
revoke all on function public.media_backfill_vendor_links() from public, anon, authenticated;
revoke all on function public.media_library_health() from public, anon, authenticated;
grant execute on function public.media_resolve_vendor(text, text) to service_role;
grant execute on function public.media_vendor_tag(text) to service_role;
grant execute on function public.media_backfill_vendor_links() to service_role;
grant execute on function public.media_library_health() to service_role;

select public.media_backfill_provenance();
select public.media_backfill_vendor_links();
select public.media_auto_publish();

notify pgrst, 'reload schema';
