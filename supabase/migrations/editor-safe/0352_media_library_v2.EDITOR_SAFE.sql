create extension if not exists pg_trgm;

alter table public.media_assets add column if not exists vendor_id uuid;
alter table public.media_assets add column if not exists brand_id uuid;
alter table public.media_assets add column if not exists kb_product_id uuid;
alter table public.media_assets add column if not exists platform text;
alter table public.media_assets add column if not exists source_url text;
alter table public.media_assets add column if not exists source_page_url text;
alter table public.media_assets add column if not exists menu_item_ref text;
alter table public.media_assets add column if not exists product_name text;
alter table public.media_assets add column if not exists strain_name text;
alter table public.media_assets add column if not exists captured_at timestamptz;

alter table public.media_assets add column if not exists role text;
alter table public.media_assets add column if not exists category text;
alter table public.media_assets add column if not exists subcategory text;
alter table public.media_assets add column if not exists pack_size text;
alter table public.media_assets add column if not exists colors text[] not null default '{}';
alter table public.media_assets add column if not exists background text;
alter table public.media_assets add column if not exists orientation text;
alter table public.media_assets add column if not exists quality_score numeric(4,3);

alter table public.media_assets add column if not exists ai_description text;
alter table public.media_assets add column if not exists ai_caption text;
alter table public.media_assets add column if not exists visible_text text;
alter table public.media_assets add column if not exists ai_tags text[] not null default '{}';
alter table public.media_assets add column if not exists ai_confidence numeric(4,3);
alter table public.media_assets add column if not exists ai_model text;
alter table public.media_assets add column if not exists ai_described_at timestamptz;
alter table public.media_assets add column if not exists ai_status text not null default 'pending';
alter table public.media_assets add column if not exists ai_error text;

alter table public.media_assets add column if not exists seo_title text;
alter table public.media_assets add column if not exists seo_alt text;
alter table public.media_assets add column if not exists seo_description text;
alter table public.media_assets add column if not exists seo_slug text;
alter table public.media_assets add column if not exists seo_keywords text[] not null default '{}';
alter table public.media_assets add column if not exists credit_text text;
alter table public.media_assets add column if not exists copyright_notice text;
alter table public.media_assets add column if not exists license_url text;

alter table public.media_assets add column if not exists content_hash text;
alter table public.media_assets add column if not exists canonical_id uuid;
alter table public.media_assets add column if not exists duplicate_count integer not null default 0;
alter table public.media_assets add column if not exists phash text;

alter table public.media_assets add column if not exists publish_reason text;
alter table public.media_assets add column if not exists published_at timestamptz;
alter table public.media_assets add column if not exists published_by uuid;
alter table public.media_assets add column if not exists review_state text not null default 'ok';
alter table public.media_assets add column if not exists review_note text;
alter table public.media_assets add column if not exists field_provenance jsonb not null default '{}'::jsonb;

alter table public.media_assets add column if not exists search_tsv tsvector;

do $$begin
  if not exists (select 1 from pg_constraint where conname = 'media_assets_vendor_fk') then
    alter table public.media_assets add constraint media_assets_vendor_fk
      foreign key (vendor_id) references public.vendors(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_brand_fk') then
    alter table public.media_assets add constraint media_assets_brand_fk
      foreign key (brand_id) references public.brands(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_kb_product_fk') then
    alter table public.media_assets add constraint media_assets_kb_product_fk
      foreign key (kb_product_id) references public.kb_products(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_canonical_fk') then
    alter table public.media_assets add constraint media_assets_canonical_fk
      foreign key (canonical_id) references public.media_assets(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_published_by_fk') then
    alter table public.media_assets add constraint media_assets_published_by_fk
      foreign key (published_by) references public.staff_profiles(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_canonical_not_self') then
    alter table public.media_assets add constraint media_assets_canonical_not_self
      check (canonical_id is null or canonical_id <> id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_platform_chk') then
    alter table public.media_assets add constraint media_assets_platform_chk
      check (platform is null or platform in ('cultivera', 'growflow', 'leaflink', 'email', 'website', 'upload', 'ai', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_role_chk') then
    alter table public.media_assets add constraint media_assets_role_chk
      check (role is null or role in ('product', 'packaging', 'flower', 'lifestyle', 'logo', 'banner', 'label', 'coa', 'menu', 'marketing', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_ai_status_chk') then
    alter table public.media_assets add constraint media_assets_ai_status_chk
      check (ai_status in ('pending', 'done', 'failed', 'skipped'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_review_state_chk') then
    alter table public.media_assets add constraint media_assets_review_state_chk
      check (review_state in ('ok', 'needs_review', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_assets_scores_chk') then
    alter table public.media_assets add constraint media_assets_scores_chk
      check ((ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1))
         and (quality_score is null or (quality_score >= 0 and quality_score <= 1)));
  end if;
end
$$;

create or replace function public.media_search_document(m public.media_assets)
returns tsvector
language sql
stable
set search_path = public, pg_temp
as $$select
    setweight(to_tsvector('simple', coalesce(m.product_name, '') || ' ' || coalesce(m.strain_name, '') || ' '
      || coalesce(m.title, '') || ' ' || coalesce(m.seo_title, '') || ' '
      || coalesce((select v.display_name from public.vendors v where v.id = m.vendor_id), '') || ' '
      || coalesce((select b.display_name from public.brands b where b.id = m.brand_id), '')), 'A')
    || setweight(to_tsvector('simple', coalesce(m.ai_caption, '') || ' ' || coalesce(m.visible_text, '') || ' '
      || coalesce(m.alt_text, '') || ' ' || coalesce(m.seo_alt, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(m.ai_description, '') || ' ' || coalesce(m.description, '') || ' '
      || coalesce(m.seo_description, '') || ' ' || array_to_string(coalesce(m.tags, '{}'), ' ') || ' '
      || array_to_string(coalesce(m.ai_tags, '{}'), ' ') || ' ' || array_to_string(coalesce(m.seo_keywords, '{}'), ' ')
      || ' ' || array_to_string(coalesce(m.colors, '{}'), ' ') || ' ' || coalesce(m.category, '') || ' '
      || coalesce(m.subcategory, '') || ' ' || coalesce(m.role, '') || ' ' || coalesce(m.pack_size, '') || ' '
      || coalesce(m.platform, '')), 'C')
    || setweight(to_tsvector('simple', regexp_replace(coalesce(m.filename, ''), '[^A-Za-z0-9]+', ' ', 'g')), 'D');
$$;

create or replace function public.media_assets_search_refresh()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$begin
  new.search_tsv := public.media_search_document(new);
  if new.content_hash is null and new.storage_key ~ '/[0-9a-f]{16}' then
    new.content_hash := substring(new.storage_key from '/([0-9a-f]{16})');
  end if;
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_media_search_refresh on public.media_assets;
create trigger trg_media_search_refresh
  before insert or update on public.media_assets
  for each row execute function public.media_assets_search_refresh();

update public.media_assets
   set content_hash = substring(storage_key from '/([0-9a-f]{16})')
 where content_hash is null
   and storage_key ~ '/[0-9a-f]{16}';

create index if not exists idx_media_assets_vendor on public.media_assets (vendor_id) where status <> 'archived';
create index if not exists idx_media_assets_brand on public.media_assets (brand_id) where status <> 'archived';
create index if not exists idx_media_assets_kb_product on public.media_assets (kb_product_id);
create index if not exists idx_media_assets_canonical on public.media_assets (canonical_id) where canonical_id is not null;
create index if not exists idx_media_assets_content_hash on public.media_assets (content_hash);
create index if not exists idx_media_assets_role_category on public.media_assets (role, category);
create index if not exists idx_media_assets_ai_status on public.media_assets (ai_status) where status <> 'archived';
create index if not exists idx_media_assets_search on public.media_assets using gin (search_tsv);
create index if not exists idx_media_assets_title_trgm on public.media_assets using gin (title gin_trgm_ops);
create index if not exists idx_media_assets_product_trgm on public.media_assets using gin (product_name gin_trgm_ops);
create index if not exists idx_media_assets_ai_tags on public.media_assets using gin (ai_tags);
create index if not exists idx_media_usages_slot on public.media_usages (entity_type, entity_id, field_key);

create or replace function public.media_canonicalize(p_dry_run boolean default true)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$declare
  groups_n    integer := 0;
  copies_n    integer := 0;
  moved       jsonb := '{}'::jsonb;
  n           integer;
  total_moved integer := 0;
  ref         record;
  refs        text[][] := array[
    array['vendors', 'logo_media_id'],
    array['vendors', 'hero_media_id'],
    array['brands', 'logo_media_id'],
    array['product_enrichments', 'primary_media_id'],
    array['kb_products', 'primary_media_id'],
    array['blog_posts', 'hero_media_id'],
    array['blog_posts', 'og_media_id'],
    array['newsletter_assets', 'pdf_media_id'],
    array['seo_entries', 'og_media_id'],
    array['home_carousel_slides', 'image_media_id'],
    array['shop_carousel_slides', 'image_media_id'],
    array['shop_carousel_slides', 'image_media_id_mobile'],
    array['page_sections', 'image_media_id'],
    array['kb_crawl_images', 'media_asset_id'],
    array['cultivera_menu_items', 'media_asset_id'],
    array['cultivera_menu_items', 'coa_media_asset_id'],
    array['growflow_menu_items', 'media_asset_id'],
    array['growflow_menu_items', 'coa_media_asset_id'],
    array['leaflink_menu_items', 'media_asset_id'],
    array['leaflink_menu_items', 'coa_media_asset_id'],
    array['emailed_menu_items', 'media_asset_id']
  ];
  array_refs  text[][] := array[
    array['kb_products', 'image_media_ids'],
    array['product_enrichments', 'image_media_ids'],
    array['newsletter_assets', 'page_media_ids']
  ];
  i           integer;
begin
  create temporary table if not exists _media_canon_map (dup uuid primary key, keep uuid not null) on commit drop;
  truncate _media_canon_map;

  insert into _media_canon_map (dup, keep)
  select r.id, r.keep
    from (
      select m.id,
             first_value(m.id) over (
               partition by m.content_hash
               order by (m.status = 'published') desc, m.created_at asc, m.id asc
             ) as keep
        from public.media_assets m
       where m.status <> 'archived'
         and m.content_hash is not null
         and m.content_hash in (
           select content_hash from public.media_assets
            where status <> 'archived' and content_hash is not null
            group by content_hash having count(*) > 1
         )
    ) r
   where r.id <> r.keep;

  select count(*), count(distinct keep) into copies_n, groups_n from _media_canon_map;

  if p_dry_run then
    return jsonb_build_object('dry_run', true, 'groups', groups_n, 'copies', copies_n);
  end if;
  if copies_n = 0 then
    return jsonb_build_object('dry_run', false, 'groups', 0, 'copies', 0, 'moved', moved, 'total_moved', 0);
  end if;

  for i in 1 .. array_length(refs, 1) loop
    if to_regclass('public.' || refs[i][1]) is not null
       and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = refs[i][1] and column_name = refs[i][2]) then
      execute format(
        'update public.%I t set %I = m.keep from _media_canon_map m where t.%I = m.dup',
        refs[i][1], refs[i][2], refs[i][2]);
      get diagnostics n = row_count;
      if n > 0 then
        moved := moved || jsonb_build_object(refs[i][1] || '.' || refs[i][2], n);
        total_moved := total_moved + n;
      end if;
    end if;
  end loop;

  for i in 1 .. array_length(array_refs, 1) loop
    if to_regclass('public.' || array_refs[i][1]) is not null
       and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = array_refs[i][1] and column_name = array_refs[i][2]) then
      execute format(
        'update public.%1$I t set %2$I = (
            select coalesce(array_agg(x.id order by x.first_pos), ''{}''::uuid[])
              from (select coalesce(m.keep, e.id) as id, min(e.pos) as first_pos
                      from unnest(t.%2$I) with ordinality as e(id, pos)
                      left join _media_canon_map m on m.dup = e.id
                     group by 1) x)
          where t.%2$I && (select array_agg(dup) from _media_canon_map)',
        array_refs[i][1], array_refs[i][2]);
      get diagnostics n = row_count;
      if n > 0 then
        moved := moved || jsonb_build_object(array_refs[i][1] || '.' || array_refs[i][2], n);
        total_moved := total_moved + n;
      end if;
    end if;
  end loop;

  if to_regclass('public.product_image_memory') is not null then
    update public.product_image_memory k
       set times_confirmed = k.times_confirmed + d.extra
      from (select m.keep, p.identity_key, sum(p.times_confirmed)::integer as extra
              from public.product_image_memory p join _media_canon_map m on m.dup = p.media_asset_id
             group by 1, 2) d
     where k.media_asset_id = d.keep and k.identity_key = d.identity_key;
    delete from public.product_image_memory p
     using _media_canon_map m
     where p.media_asset_id = m.dup
       and exists (select 1 from public.product_image_memory k
                    where k.media_asset_id = m.keep and k.identity_key = p.identity_key);
    update public.product_image_memory p set media_asset_id = m.keep
      from _media_canon_map m where p.media_asset_id = m.dup;
    get diagnostics n = row_count;
    if n > 0 then moved := moved || jsonb_build_object('product_image_memory.media_asset_id', n); total_moved := total_moved + n; end if;
  end if;

  if to_regclass('public.kb_image_substitutes') is not null then
    delete from public.kb_image_substitutes s
     using _media_canon_map m
     where s.media_id = m.dup
       and exists (select 1 from public.kb_image_substitutes k
                    where k.media_id = m.keep and k.scope = s.scope and k.key = s.key);
    update public.kb_image_substitutes s set media_id = m.keep
      from _media_canon_map m where s.media_id = m.dup;
    get diagnostics n = row_count;
    if n > 0 then moved := moved || jsonb_build_object('kb_image_substitutes.media_id', n); total_moved := total_moved + n; end if;
  end if;

  update public.media_usages u set media_asset_id = m.keep
    from _media_canon_map m where u.media_asset_id = m.dup;
  get diagnostics n = row_count;
  if n > 0 then moved := moved || jsonb_build_object('media_usages.media_asset_id', n); total_moved := total_moved + n; end if;
  delete from public.media_usages u
   using public.media_usages o
   where u.media_asset_id = o.media_asset_id
     and u.entity_type = o.entity_type
     and u.entity_id = o.entity_id
     and u.field_key = o.field_key
     and u.id > o.id;

  update public.media_assets k
     set description = coalesce(nullif(btrim(k.description), ''), d.description),
         alt_text    = coalesce(nullif(btrim(k.alt_text), ''), d.alt_text),
         tags        = (select coalesce(array_agg(distinct t), '{}') from unnest(k.tags || d.tags) t),
         status      = case when d.any_published then 'published'::asset_status else k.status end,
         duplicate_count = k.duplicate_count + d.n
    from (
      select m.keep,
             count(*)::integer as n,
             (array_agg(c.description) filter (where nullif(btrim(c.description), '') is not null))[1] as description,
             (array_agg(c.alt_text) filter (where nullif(btrim(c.alt_text), '') is not null))[1] as alt_text,
             coalesce((select array_agg(distinct t2) from public.media_assets c2
                        join _media_canon_map m2 on m2.dup = c2.id, unnest(c2.tags) t2
                       where m2.keep = m.keep), '{}') as tags,
             bool_or(c.status = 'published') as any_published
        from _media_canon_map m join public.media_assets c on c.id = m.dup
       group by m.keep
    ) d
   where k.id = d.keep;

  update public.media_assets c
     set status = 'archived',
         canonical_id = m.keep,
         review_note = 'Archived by media_canonicalize: same file as ' || m.keep::text
    from _media_canon_map m
   where c.id = m.dup;

  return jsonb_build_object('dry_run', false, 'groups', groups_n, 'copies', copies_n,
                            'moved', moved, 'total_moved', total_moved);
end;
$$;

comment on function public.media_canonicalize(boolean) is
  'D221 M2 (0352): fold rows holding the same file into one kept row. Moves every reference (single ids, id arrays, usages, image memory, substitutes), keeps one usage per slot, archives the copies with canonical_id. Dry run by default. Service role only.';

create or replace function public.media_norm_name(p text)
returns text
language sql
immutable
as $$select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]', '', 'g');
$$;

create or replace function public.media_resolve_vendor(p_label text, p_license text default null)
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$with lab as (
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

create or replace function public.media_backfill_provenance()
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$declare
  n_menu integer := 0; n_kb integer := 0; n_tag integer := 0; n_url integer := 0;
  n_plat integer := 0; n_logo integer := 0; n_site integer := 0; n integer;
begin

  update public.media_assets m
     set source_url = coalesce(m.source_url, nullif(regexp_replace(m.source, '^[a-z]+:', ''), '')),
         platform = coalesce(m.platform, case
           when m.source ~* '^(crawl|cultivera):https?://[^/]*cultivera\.com' or 'cultivera' = any(m.tags) then 'cultivera'
           when m.source ~* '^(crawl|growflow):https?://[^/]*(growflow|s2solutions)' or 'growflow' = any(m.tags) then 'growflow'
           when m.source ~* '^crawl:https?://[^/]*cloudfront\.net' and 'leaflink' = any(m.tags) then 'leaflink'
           when 'leaflink' = any(m.tags) then 'leaflink'
           when m.source like 'email:%' or m.usage_type = 'vendor-menu' then 'email'
           when m.source like 'crawl:%' then 'website'
           when m.source like 'upload:%' or m.source is null then 'upload'
           when 'flux' = any(m.tags) or 'ai-generated' = any(m.tags) then 'ai'
           else 'other' end),
         captured_at = coalesce(m.captured_at, m.created_at)
   where m.platform is null or m.source_url is null or m.captured_at is null;
  get diagnostics n_plat = row_count;

  update public.media_assets m
     set vendor_id = coalesce(m.vendor_id, x.vendor_id),
         product_name = coalesce(m.product_name, x.name),
         category = coalesce(m.category, lower(nullif(btrim(x.category), ''))),
         pack_size = coalesce(m.pack_size, nullif(btrim(x.size_label), '')),
         menu_item_ref = coalesce(m.menu_item_ref, x.ref),
         role = coalesce(m.role, 'product')
    from (
      with sv as materialized (
        select id, coalesce(vendor_id, public.media_resolve_vendor(seller_name)) as vid
          from public.cultivera_menu_snapshots
      )
      select distinct on (i.media_asset_id) i.media_asset_id, i.name, i.category, i.size_label,
             'cultivera:' || i.id::text as ref, sv.vid as vendor_id
        from public.cultivera_menu_items i join sv on sv.id = i.snapshot_id
       where i.media_asset_id is not null
       order by i.media_asset_id, i.created_at
    ) x
   where m.id = x.media_asset_id
     and (m.vendor_id is null or m.product_name is null or m.menu_item_ref is null);
  get diagnostics n = row_count; n_menu := n_menu + n;

  update public.media_assets m
     set vendor_id = coalesce(m.vendor_id, x.vendor_id),
         product_name = coalesce(m.product_name, x.name),
         category = coalesce(m.category, lower(nullif(btrim(x.category), ''))),
         pack_size = coalesce(m.pack_size, nullif(btrim(x.size_label), '')),
         menu_item_ref = coalesce(m.menu_item_ref, x.ref),
         role = coalesce(m.role, 'product')
    from (
      with sv as materialized (
        select id, coalesce(vendor_id, public.media_resolve_vendor(store_name, license_number)) as vid
          from public.growflow_menu_snapshots
      )
      select distinct on (i.media_asset_id) i.media_asset_id, i.name, i.category, i.size_label,
             'growflow:' || i.id::text as ref, sv.vid as vendor_id
        from public.growflow_menu_items i join sv on sv.id = i.snapshot_id
       where i.media_asset_id is not null
       order by i.media_asset_id, i.created_at
    ) x
   where m.id = x.media_asset_id
     and (m.vendor_id is null or m.product_name is null or m.menu_item_ref is null);
  get diagnostics n = row_count; n_menu := n_menu + n;

  if to_regclass('public.leaflink_menu_items') is not null then
    update public.media_assets m
       set vendor_id = coalesce(m.vendor_id, x.vendor_id),
           product_name = coalesce(m.product_name, x.name),
           category = coalesce(m.category, lower(nullif(btrim(x.category), ''))),
           pack_size = coalesce(m.pack_size, nullif(btrim(x.size_label), '')),
           menu_item_ref = coalesce(m.menu_item_ref, x.ref),
           role = coalesce(m.role, 'product')
      from (
        with sv as materialized (
          select id, coalesce(vendor_id, public.media_resolve_vendor(company_name)) as vid
            from public.leaflink_menu_snapshots
        )
        select distinct on (i.media_asset_id) i.media_asset_id, i.name, i.category, i.size_label,
               'leaflink:' || i.id::text as ref, sv.vid as vendor_id
          from public.leaflink_menu_items i join sv on sv.id = i.snapshot_id
         where i.media_asset_id is not null
         order by i.media_asset_id, i.created_at
      ) x
     where m.id = x.media_asset_id
       and (m.vendor_id is null or m.product_name is null or m.menu_item_ref is null);
    get diagnostics n = row_count; n_menu := n_menu + n;
  end if;

  if to_regclass('public.emailed_menu_items') is not null then
    update public.media_assets m
       set vendor_id = coalesce(m.vendor_id, x.vendor_id),
           product_name = coalesce(m.product_name, x.name),
           category = coalesce(m.category, lower(nullif(btrim(x.category), ''))),
           pack_size = coalesce(m.pack_size, nullif(btrim(x.size_label), '')),
           menu_item_ref = coalesce(m.menu_item_ref, x.ref),
           role = coalesce(m.role, 'product')
      from (
        select distinct on (i.media_asset_id) i.media_asset_id, i.name, i.category, i.size_label,
               'email:' || i.id::text as ref, s.vendor_id
          from public.emailed_menu_items i join public.emailed_menu_snapshots s on s.id = i.snapshot_id
         where i.media_asset_id is not null
         order by i.media_asset_id, i.created_at
      ) x
     where m.id = x.media_asset_id
       and (m.vendor_id is null or m.product_name is null or m.menu_item_ref is null);
    get diagnostics n = row_count; n_menu := n_menu + n;
  end if;

  update public.media_assets m
     set kb_product_id = coalesce(m.kb_product_id, x.kb_id),
         vendor_id = coalesce(m.vendor_id, x.vendor_id),
         brand_id = coalesce(m.brand_id, x.brand_id),
         product_name = coalesce(m.product_name, x.display_name),
         category = coalesce(m.category, lower(nullif(btrim(x.category), ''))),
         role = coalesce(m.role, 'product')
    from (
      select distinct on (u.media_asset_id) u.media_asset_id, p.id as kb_id, p.vendor_id, p.brand_id,
             p.display_name, p.category
        from public.media_usages u
        join public.kb_products p
          on (p.brand_slug || '/' || p.product_slug || '/' || coalesce(p.variant_label, '')) = u.entity_id
       where u.entity_type in ('kb_product', 'cultivera_strain')
       order by u.media_asset_id, (p.vendor_id is null), u.created_at
    ) x
   where m.id = x.media_asset_id
     and (m.kb_product_id is null or (m.vendor_id is null and x.vendor_id is not null)
          or (m.brand_id is null and x.brand_id is not null));
  get diagnostics n_kb = row_count;

  update public.media_assets m set vendor_id = coalesce(m.vendor_id, v.id), role = coalesce(m.role, 'logo')
    from public.vendors v where v.logo_media_id = m.id and (m.vendor_id is null or m.role is null);
  get diagnostics n = row_count; n_logo := n_logo + n;
  update public.media_assets m set vendor_id = coalesce(m.vendor_id, v.id), role = coalesce(m.role, 'banner')
    from public.vendors v where v.hero_media_id = m.id and (m.vendor_id is null or m.role is null);
  get diagnostics n = row_count; n_logo := n_logo + n;
  update public.media_assets m
     set brand_id = coalesce(m.brand_id, b.id), vendor_id = coalesce(m.vendor_id, b.vendor_id), role = coalesce(m.role, 'logo')
    from public.brands b where b.logo_media_id = m.id and (m.brand_id is null or m.role is null);
  get diagnostics n = row_count; n_logo := n_logo + n;

  update public.media_assets m
     set vendor_id = v.id
    from public.vendors v
   where m.vendor_id is null and v.merged_into_id is null and v.slug = any(m.tags);
  get diagnostics n = row_count; n_tag := n_tag + n;
  update public.media_assets m
     set vendor_id = x.vid
    from (
      with t as materialized (
        select distinct t.tag
          from public.media_assets a, unnest(a.tags) as t(tag)
         where a.vendor_id is null
           and t.tag not in ('harvested', 'cultivera', 'growflow', 'leaflink', 'product-image', 'vendor-logo',
                             'brand-logo', 'coa', 'flux', 'ai-generated', 'marketing', 'flux-reference')
           and length(t.tag) >= 4
      ),
      r as materialized (
        select t.tag, public.media_resolve_vendor(replace(t.tag, '-', ' ')) as vid from t
      )
      select distinct on (a.id) a.id, r.vid
        from public.media_assets a, unnest(a.tags) as at(tag)
        join r on r.tag = at.tag
       where a.vendor_id is null and r.vid is not null
       order by a.id, array_position(a.tags, at.tag)
    ) x
   where m.id = x.id and m.vendor_id is null;
  get diagnostics n = row_count; n_tag := n_tag + n;

  update public.media_assets m
     set vendor_id = x.vid
    from (
      select a.id, (select v.id from public.vendors v
                     where v.merged_into_id is null and nullif(btrim(v.website), '') is not null
                       and lower(regexp_replace(regexp_replace(v.website, '^https?://(www\.)?', ''), '/.*$', ''))
                         = lower(regexp_replace(regexp_replace(a.source_url, '^https?://(www\.)?', ''), '/.*$', ''))
                     order by v.created_at limit 1) as vid
        from public.media_assets a
       where a.vendor_id is null and a.platform = 'website' and a.source_url ~* '^https?://'
    ) x
   where m.id = x.id and x.vid is not null;
  get diagnostics n_site = row_count;

  update public.media_assets m
     set role = case
       when m.mime_type = 'application/pdf' and ('coa' = any(m.tags) or m.usage_type = 'document') then 'coa'
       when m.usage_type = 'vendor-menu' then 'menu'
       when m.usage_type in ('hero', 'banner') then 'banner'
       when m.usage_type = 'marketing' then 'marketing'
       when m.usage_type = 'product' or 'product-image' = any(m.tags) then 'product'
       when m.usage_type in ('vendor-logo', 'brand-logo', 'icon') and m.platform = 'website'
            and m.source_url ~* '(product|jar|box|pack|bag|cart|rosin|resin|gumm|flower|pre-?roll|strain|label|[0-9]+x[0-9]+)'
            and m.source_url !~* 'logo' then 'product'
       when m.usage_type in ('vendor-logo', 'brand-logo', 'icon') then 'logo'
       else 'other' end
   where m.role is null;
  get diagnostics n = row_count;

  update public.media_assets m
     set review_state = 'needs_review',
         review_note = coalesce(m.review_note, 'Filed as a logo, but the file name looks like a product photo.')
   where m.usage_type in ('vendor-logo', 'brand-logo') and m.role = 'product' and m.review_state = 'ok'
     and not exists (select 1 from public.vendors v where v.logo_media_id = m.id)
     and not exists (select 1 from public.brands b where b.logo_media_id = m.id);

  update public.media_assets m
     set credit_text = v.display_name
    from public.vendors v
   where m.vendor_id = v.id and m.credit_text is null and m.platform in ('cultivera', 'growflow', 'leaflink', 'email', 'website');

  return jsonb_build_object('platform', n_plat, 'menu_items', n_menu, 'kb_cards', n_kb, 'logos', n_logo,
                            'tags', n_tag, 'websites', n_site);
end;
$$;

comment on function public.media_backfill_provenance() is
  'D221 M1 (0352): fill platform / vendor / brand / KB card / product / category / pack size / role on media_assets from the menu items, KB cards, logo slots, tags and source host. Gap-fill only: never overwrites a value already set. Service role only.';

create or replace function public.media_auto_publish()
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$declare
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

comment on function public.media_auto_publish() is
  'D221 M2 (0352): publish drafts whose source is the vendor menu or website, whose vendor is known, that are not copies and are not flagged for review. publish_reason = vendor-source-auto. Attaching to a live product stays a human click. Service role only.';

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
as $$with q as (
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

comment on function public.media_search(text, uuid, uuid, text, text, text, text, integer, integer) is
  'D221 M1 (0352): ranked media search - weighted full text (product / strain / vendor / brand / title > caption / package text / alt > description / tags / SEO > file name) with prefix matching, plus pg_trgm typo tolerance, with filters for vendor / brand / role / category / status / platform. Archived rows excluded unless asked for. Service role only.';

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
    'with_seo', count(*) filter (where status <> 'archived' and seo_alt is not null and seo_title is not null),
    'needs_review', count(*) filter (where status <> 'archived' and review_state = 'needs_review'),
    'auto_published', count(*) filter (where publish_reason = 'vendor-source-auto')
  )
  from public.media_assets;
$$;

create table if not exists public.media_ai_runs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'describe',
  status        text not null default 'queued',
  model         text,
  detail        text not null default 'high',
  scope         jsonb not null default '{}'::jsonb,
  total         integer not null default 0,
  done          integer not null default 0,
  failed        integer not null default 0,
  skipped       integer not null default 0,
  cost_usd      numeric(10,4) not null default 0,
  budget_usd    numeric(10,2),
  cursor_id     uuid,
  last_error    text,
  started_by    uuid references public.staff_profiles(id) on delete set null,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint media_ai_runs_kind_chk check (kind in ('describe', 'seo', 'embed', 'full')),
  constraint media_ai_runs_status_chk check (status in ('queued', 'running', 'paused', 'done', 'failed', 'cancelled')),
  constraint media_ai_runs_detail_chk check (detail in ('low', 'high', 'auto')),
  constraint media_ai_runs_counts_chk check (total >= 0 and done >= 0 and failed >= 0 and skipped >= 0 and cost_usd >= 0)
);

drop trigger if exists trg_media_ai_runs_updated on public.media_ai_runs;
create trigger trg_media_ai_runs_updated before update on public.media_ai_runs
  for each row execute function public.set_updated_at();

alter table public.media_ai_runs enable row level security;
revoke all on table public.media_ai_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.media_ai_runs to service_role;

revoke all on function public.media_search_document(public.media_assets) from public, anon, authenticated;
revoke all on function public.media_assets_search_refresh() from public, anon, authenticated;
revoke all on function public.media_canonicalize(boolean) from public, anon, authenticated;
revoke all on function public.media_norm_name(text) from public, anon, authenticated;
revoke all on function public.media_resolve_vendor(text, text) from public, anon, authenticated;
revoke all on function public.media_backfill_provenance() from public, anon, authenticated;
revoke all on function public.media_auto_publish() from public, anon, authenticated;
revoke all on function public.media_search(text, uuid, uuid, text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.media_library_health() from public, anon, authenticated;
grant execute on function public.media_canonicalize(boolean) to service_role;
grant execute on function public.media_backfill_provenance() to service_role;
grant execute on function public.media_auto_publish() to service_role;
grant execute on function public.media_search(text, uuid, uuid, text, text, text, text, integer, integer) to service_role;
grant execute on function public.media_library_health() to service_role;
grant execute on function public.media_resolve_vendor(text, text) to service_role;
grant execute on function public.media_norm_name(text) to service_role;

grant execute on function public.media_search_document(public.media_assets) to authenticated, service_role;

do $$begin
  lock table public.media_assets in share row exclusive mode;
  perform public.media_canonicalize(false);

  create unique index if not exists uq_media_assets_live_content_hash
    on public.media_assets (content_hash)
    where status <> 'archived' and content_hash is not null;
end
$$;

select public.media_backfill_provenance();
select public.media_auto_publish();

update public.media_assets m set search_tsv = public.media_search_document(m) where m.search_tsv is null;

notify pgrst, 'reload schema';
