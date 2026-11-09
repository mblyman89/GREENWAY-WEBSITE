-- =============================================================================
-- 0350 — vendor merge v2: a merged card can never collect new rows again (D220)
-- =============================================================================
-- Owner (D220): "I thought I had merged the remaining duplicate vendors. can you
-- help me finish merging all the vendors."
--
-- WHY. merge_vendors() (0104) repoints the 12 tables that existed in 0104. Since
-- then 15 more tables gained a vendor_id foreign key (catalog_product_drafts,
-- the four menu-snapshot tables, vendor_platform_map, noncannabis_invoices,
-- gl_vendor_profiles, banking / ACH / payee / e-sign ...), and nothing stopped
-- receiving from resolving a delivery to the ARCHIVED card (its license is still
-- on it). Measured on production before this migration: 240 inventory lots,
-- 41 manifests, 244 kb_products and 627 catalog drafts sit on archived (merged)
-- cards, many created AFTER the merge.
--
-- WHAT THIS ADDS (no table, no deletes):
--   1. vendors.merged_into_id / merged_at — the merge as DATA, not just a note.
--      Backfilled from the exact note 0104 stamps on every archived duplicate:
--      'Merged into "<name>" (<uuid>) on <date>.'
--   2. vendor_survivor_id(uuid) — follows merged_into_id to the live card
--      (chains of merges, max 16 hops, cycle-safe).
--   3. vendor_repoint_references(survivor, dups) — CATALOG-DRIVEN repoint: every
--      single-column foreign key to vendors(id) found in pg_constraint, so a
--      table added next year is covered without editing this function. Guarded
--      money-identity tables (banking, ACH, payee contacts, e-sign) are NEVER
--      moved here; they are counted and reported as needs_attention.
--      gl_vendor_profiles (one per vendor) moves only when the survivor has none.
--      CCRS SAFETY: before a manifest moves, the duplicate card's license is
--      written onto the manifest itself (raw_payload.from_license_number) when the
--      manifest carries no sending license — the CCRS InventoryTransfer export
--      reads that first, so the license reported for an old delivery never
--      changes because of a merge.
--   4. merge_vendors_v2(survivor, dups) — 0104's merge (same gap-fill, aliases,
--      notes, archive) using (3), stamping merged_into_id, refusing a survivor
--      that is itself archived or merged.
--   5. trg_vendor_follow_merge — BEFORE INSERT/UPDATE OF vendor_id on the
--      operational tables: a row written against a merged card lands on the
--      survivor (the backstop behind the intake fix in intake-store.ts).
--   6. sweep_merged_vendor_rows() — moves everything still sitting on a merged
--      card to its survivor. Run once at the end of this migration.
--   7. Finishes the production merge that was left half-done (Alpha Crux 412306,
--      noted as merged but still published), plus the two duplicate pairs the
--      D220 recon confirmed (Fire Bros., Botanica Seattle). Each only runs when
--      both cards exist and the duplicate is not merged yet (no-op elsewhere).
--
-- merge_vendors() (0104) is left exactly as it is.
-- Idempotent. Apply MANUALLY in the Supabase SQL editor (one run = one transaction).
-- =============================================================================

-- ── 1. merged_into_id / merged_at ────────────────────────────────────────────
alter table public.vendors add column if not exists merged_into_id uuid;
alter table public.vendors add column if not exists merged_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vendors_merged_into_fk') then
    alter table public.vendors
      add constraint vendors_merged_into_fk foreign key (merged_into_id)
      references public.vendors(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vendors_merged_into_not_self') then
    alter table public.vendors
      add constraint vendors_merged_into_not_self check (merged_into_id is null or merged_into_id <> id);
  end if;
end
$$;

create index if not exists idx_vendors_merged_into on public.vendors(merged_into_id) where merged_into_id is not null;

comment on column public.vendors.merged_into_id is
  '0350 (D220): the card this one was merged into (archived duplicate -> survivor). Follow with vendor_survivor_id().';

-- Backfill from 0104's note. Only archived cards; the target must exist and not be the card itself.
update public.vendors v
   set merged_into_id = t.target,
       merged_at      = coalesce(v.merged_at, t.on_day)
  from (
    select x.id,
           (m[1])::uuid as target,
           (to_date(m[2], 'YYYY-MM-DD'))::timestamptz as on_day
      from public.vendors x
      cross join lateral (
        -- The LAST note wins (a card merged, restored and merged again), the same
        -- rule as mergedIntoFromNotes() in vendor-menu-coverage-core.ts.
        select t.mm as m
          from regexp_matches(x.internal_notes,
               'Merged into "[^"]*" \(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\) on ([0-9]{4}-[0-9]{2}-[0-9]{2})',
               'g') with ordinality as t(mm, n)
         order by t.n desc
         limit 1
      ) r
     where x.status = 'archived'
       and x.merged_into_id is null
       and r.m is not null
  ) t
 where v.id = t.id
   and t.target <> v.id
   and exists (select 1 from public.vendors s where s.id = t.target);

-- ── 2. vendor_survivor_id ────────────────────────────────────────────────────
create or replace function public.vendor_survivor_id(p_vendor_id uuid)
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  cur  uuid := p_vendor_id;
  nxt  uuid;
  hops integer := 0;
begin
  if p_vendor_id is null then
    return null;
  end if;
  loop
    select merged_into_id into nxt from public.vendors where id = cur;
    exit when nxt is null or nxt = cur or nxt = p_vendor_id;
    cur  := nxt;
    hops := hops + 1;
    exit when hops >= 16;
  end loop;
  return cur;
end;
$$;

revoke all on function public.vendor_survivor_id(uuid) from public, anon, authenticated;
grant execute on function public.vendor_survivor_id(uuid) to service_role;

-- ── 3. vendor_repoint_references ─────────────────────────────────────────────
create or replace function public.vendor_repoint_references(survivor_id uuid, duplicate_ids uuid[])
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  fk          record;
  n           integer;
  counts      jsonb := '{}'::jsonb;
  attention   jsonb := '{}'::jsonb;
  total       integer := 0;
  guarded     text[] := array[
    'vendor_bank_details', 'ach_authorizations', 'ach_authorization_documents',
    'ach_authorization_events', 'ach_return_notices', 'payee_contacts', 'vendor_esign_invites'
  ];
begin
  if survivor_id is null or duplicate_ids is null or array_length(duplicate_ids, 1) is null then
    return jsonb_build_object('tables', counts, 'needs_attention', attention, 'total', 0);
  end if;

  -- CCRS safety: keep each old delivery's sending license on the manifest itself.
  update public.inbound_manifests m
     set raw_payload = coalesce(m.raw_payload, '{}'::jsonb)
                       || jsonb_build_object('from_license_number', btrim(d.license_number),
                                             'license_stamped_by', '0350 vendor merge')
    from public.vendors d
   where m.vendor_id = any(duplicate_ids)
     and d.id = m.vendor_id
     and nullif(btrim(d.license_number), '') is not null
     and coalesce(nullif(btrim(m.raw_payload->>'from_license_number'), ''),
                  nullif(btrim(m.raw_payload->>'vendor_license'), '')) is null;
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('inbound_manifests_license_stamped', n);

  -- One profile per vendor: move only when the survivor has none.
  if to_regclass('public.gl_vendor_profiles') is not null then
    if not exists (select 1 from public.gl_vendor_profiles where vendor_id = survivor_id) then
      update public.gl_vendor_profiles set vendor_id = survivor_id
       where vendor_id = (select g.vendor_id from public.gl_vendor_profiles g
                           where g.vendor_id = any(duplicate_ids) order by g.vendor_id limit 1);
      get diagnostics n = row_count;
      counts := counts || jsonb_build_object('gl_vendor_profiles', n); total := total + n;
    end if;
    select count(*) into n from public.gl_vendor_profiles where vendor_id = any(duplicate_ids);
    if n > 0 then attention := attention || jsonb_build_object('gl_vendor_profiles', n); end if;
  end if;

  -- Every other single-column FK to vendors(id), straight from the catalog.
  for fk in
    select c.conrelid::regclass as tbl, cl.relname as tname, a.attname as col
      from pg_constraint c
      join pg_class cl     on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_attribute a  on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.vendors'::regclass
       and array_length(c.conkey, 1) = 1
       and ns.nspname = 'public'
       and cl.relname <> 'vendors'
       and cl.relname <> 'gl_vendor_profiles'
     order by cl.relname, a.attname
  loop
    if fk.tname = any(guarded) then
      execute format('select count(*) from %s where %I = any($1)', fk.tbl, fk.col)
         into n using duplicate_ids;
      if n > 0 then attention := attention || jsonb_build_object(fk.tname, n); end if;
      continue;
    end if;
    execute format('update %s set %I = $1 where %I = any($2)', fk.tbl, fk.col, fk.col)
      using survivor_id, duplicate_ids;
    get diagnostics n = row_count;
    if n > 0 then
      counts := counts || jsonb_build_object(fk.tname, coalesce((counts->>fk.tname)::integer, 0) + n);
      total := total + n;
    end if;
  end loop;

  -- Entity-scoped rows keyed by text ids (same three tables as 0104).
  update public.ai_suggestions set entity_id = survivor_id::text
   where entity_type = 'vendor' and entity_id in (select d::text from unnest(duplicate_ids) d);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_suggestions', n); total := total + n;

  update public.media_usages set entity_id = survivor_id::text
   where entity_type = 'vendor' and entity_id in (select d::text from unnest(duplicate_ids) d);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('media_usages', n); total := total + n;

  update public.seo_entries set entity_id = survivor_id::text
   where entity_type = 'vendor' and entity_id in (select d::text from unnest(duplicate_ids) d);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('seo_entries', n); total := total + n;

  return jsonb_build_object('tables', counts, 'needs_attention', attention, 'total', total);
end;
$$;

revoke all on function public.vendor_repoint_references(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.vendor_repoint_references(uuid, uuid[]) to service_role;

-- ── 4. merge_vendors_v2 ──────────────────────────────────────────────────────
create or replace function public.merge_vendors_v2(survivor_id uuid, duplicate_ids uuid[])
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  survivor        public.vendors%rowtype;
  dup             public.vendors%rowtype;
  dup_id          uuid;
  dup_count       integer;
  repoint         jsonb;
  today           text := to_char(now(), 'YYYY-MM-DD');
  merge_note      text;
  new_brand_count integer;
begin
  if survivor_id is null then
    raise exception 'merge_vendors_v2: survivor_id is required';
  end if;
  if duplicate_ids is null or array_length(duplicate_ids, 1) is null then
    raise exception 'merge_vendors_v2: at least one duplicate vendor id is required';
  end if;
  if survivor_id = any(duplicate_ids) then
    raise exception 'merge_vendors_v2: the surviving vendor cannot also be listed as a duplicate';
  end if;
  duplicate_ids := (select array_agg(distinct d) from unnest(duplicate_ids) d where d is not null);
  dup_count := coalesce(array_length(duplicate_ids, 1), 0);
  if dup_count = 0 then
    raise exception 'merge_vendors_v2: at least one duplicate vendor id is required';
  end if;
  if dup_count > 4 then
    raise exception 'merge_vendors_v2: merge at most 4 duplicates per call (got %)', dup_count;
  end if;

  select * into survivor from public.vendors where id = survivor_id;
  if not found then
    raise exception 'merge_vendors_v2: surviving vendor % not found', survivor_id;
  end if;
  if survivor.merged_into_id is not null then
    raise exception 'merge_vendors_v2: "%" was itself merged into another card (%); merge into that card instead',
      survivor.display_name, public.vendor_survivor_id(survivor_id);
  end if;
  if survivor.status = 'archived' then
    raise exception 'merge_vendors_v2: "%" is archived; un-archive it (or pick a live card) before merging into it',
      survivor.display_name;
  end if;

  foreach dup_id in array duplicate_ids loop
    select * into dup from public.vendors where id = dup_id;
    if not found then
      raise exception 'merge_vendors_v2: duplicate vendor % not found', dup_id;
    end if;
    if dup.merged_into_id is not null and public.vendor_survivor_id(dup_id) <> survivor_id then
      raise exception 'merge_vendors_v2: "%" was already merged into a different card (%)',
        dup.display_name, public.vendor_survivor_id(dup_id);
    end if;
  end loop;

  repoint := public.vendor_repoint_references(survivor_id, duplicate_ids);

  foreach dup_id in array duplicate_ids loop
    select * into dup from public.vendors where id = dup_id;

    merge_note := format(
      'Merged in "%s"%s on %s. Its brands, products, purchase orders, manifests, and drafts now live on this card; the old card was archived (nothing deleted).',
      dup.display_name,
      case when nullif(dup.license_number, '') is not null
           then format(' (license %s)', dup.license_number) else '' end,
      today
    );

    update public.vendors s set
      legal_name          = coalesce(nullif(s.legal_name, ''),          nullif(dup.legal_name, '')),
      license_number      = coalesce(nullif(s.license_number, ''),      nullif(dup.license_number, '')),
      mission_statement   = coalesce(nullif(s.mission_statement, ''),   nullif(dup.mission_statement, '')),
      about               = coalesce(nullif(s.about, ''),               nullif(dup.about, '')),
      product_philosophy  = coalesce(nullif(s.product_philosophy, ''),  nullif(dup.product_philosophy, '')),
      website             = coalesce(nullif(s.website, ''),             nullif(dup.website, '')),
      email               = coalesce(nullif(s.email, ''),               nullif(dup.email, '')),
      phone               = coalesce(nullif(s.phone, ''),               nullif(dup.phone, '')),
      vendor_day_notes    = coalesce(nullif(s.vendor_day_notes, ''),    nullif(dup.vendor_day_notes, '')),
      vendor_number       = coalesce(nullif(s.vendor_number, ''),       nullif(dup.vendor_number, '')),
      dba                 = coalesce(nullif(s.dba, ''),                 nullif(dup.dba, '')),
      external_id         = coalesce(nullif(s.external_id, ''),         nullif(dup.external_id, '')),
      shipping_address1   = coalesce(nullif(s.shipping_address1, ''),   nullif(dup.shipping_address1, '')),
      shipping_address2   = coalesce(nullif(s.shipping_address2, ''),   nullif(dup.shipping_address2, '')),
      shipping_city       = coalesce(nullif(s.shipping_city, ''),       nullif(dup.shipping_city, '')),
      shipping_state      = coalesce(nullif(s.shipping_state, ''),      nullif(dup.shipping_state, '')),
      shipping_zip        = coalesce(nullif(s.shipping_zip, ''),        nullif(dup.shipping_zip, '')),
      billing_address1    = coalesce(nullif(s.billing_address1, ''),    nullif(dup.billing_address1, '')),
      billing_address2    = coalesce(nullif(s.billing_address2, ''),    nullif(dup.billing_address2, '')),
      billing_city        = coalesce(nullif(s.billing_city, ''),        nullif(dup.billing_city, '')),
      billing_state       = coalesce(nullif(s.billing_state, ''),       nullif(dup.billing_state, '')),
      billing_zip         = coalesce(nullif(s.billing_zip, ''),         nullif(dup.billing_zip, '')),
      billing_same_as_shipping = coalesce(s.billing_same_as_shipping, dup.billing_same_as_shipping),
      sage_vendor_id      = coalesce(nullif(s.sage_vendor_id, ''),      nullif(dup.sage_vendor_id, '')),
      logo_media_id       = coalesce(s.logo_media_id, dup.logo_media_id),
      hero_media_id       = coalesce(s.hero_media_id, dup.hero_media_id),
      usual_transport     = coalesce(s.usual_transport, dup.usual_transport),
      usual_transport_updated_at = case when s.usual_transport is null
                                        then dup.usual_transport_updated_at
                                        else s.usual_transport_updated_at end,
      social_json         = coalesce(dup.social_json, '{}'::jsonb) || coalesce(s.social_json, '{}'::jsonb),
      is_active           = case when s.is_active is null and dup.is_active is null then null
                                 else (coalesce(s.is_active, false) or coalesce(dup.is_active, false)) end,
      total_accepted_ytd_cents = case
                                   when s.total_accepted_ytd_cents is null and dup.total_accepted_ytd_cents is null then null
                                   else coalesce(s.total_accepted_ytd_cents, 0) + coalesce(dup.total_accepted_ytd_cents, 0)
                                 end,
      last_accepted_at    = greatest(s.last_accepted_at, dup.last_accepted_at),
      product_count       = s.product_count + coalesce(dup.product_count, 0),
      internal_notes      = case when nullif(s.internal_notes, '') is null then merge_note
                                 when position(merge_note in s.internal_notes) > 0 then s.internal_notes
                                 else s.internal_notes || E'\n' || merge_note end
    where s.id = survivor_id;

    insert into public.vendor_aliases (vendor_id, source_name, source_system)
    values (survivor_id, dup.display_name, 'merge')
    on conflict (source_system, source_name) do nothing;

    if nullif(dup.license_number, '') is not null then
      insert into public.vendor_aliases (vendor_id, source_name, source_system)
      values (survivor_id, 'license:' || dup.license_number, 'merge')
      on conflict (source_system, source_name) do nothing;
    end if;

    update public.vendors set
      status         = 'archived',
      is_active      = false,
      product_count  = 0,
      brand_count    = 0,
      merged_into_id = survivor_id,
      merged_at      = coalesce(merged_at, now()),
      slug           = case when slug like '%-merged-%' then slug
                            else slug || '-merged-' || left(dup_id::text, 8) end,
      internal_notes = case
                         when coalesce(internal_notes, '') like '%(' || survivor_id::text || ')%' then internal_notes
                         when nullif(internal_notes, '') is null
                           then format('Merged into "%s" (%s) on %s.', survivor.display_name, survivor_id, today)
                         else internal_notes || E'\n' ||
                              format('Merged into "%s" (%s) on %s.', survivor.display_name, survivor_id, today) end
    where id = dup_id;
  end loop;

  select count(*) into new_brand_count from public.brands where vendor_id = survivor_id;
  update public.vendors set brand_count = new_brand_count where id = survivor_id;

  return jsonb_build_object(
    'ok', true,
    'version', 2,
    'merged_at', now(),
    'survivor_id', survivor_id,
    'duplicate_ids', to_jsonb(duplicate_ids),
    'tables', repoint->'tables',
    'needs_attention', repoint->'needs_attention',
    'total_rows_repointed', (repoint->>'total')::integer
  );
end;
$$;

revoke all on function public.merge_vendors_v2(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.merge_vendors_v2(uuid, uuid[]) to service_role;

comment on function public.merge_vendors_v2(uuid, uuid[]) is
  '0350 (D220): merge_vendors (0104) + catalog-driven repoint of EVERY vendor FK, CCRS license stamping on moved manifests, merged_into_id, survivor guards. Banking/ACH/payee/e-sign rows are never moved; they are reported under needs_attention.';

-- ── 5. Follow-the-merge trigger ──────────────────────────────────────────────
create or replace function public.vendor_follow_merge()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  s   uuid;
  lic text;
begin
  if new.vendor_id is null then
    return new;
  end if;
  s := public.vendor_survivor_id(new.vendor_id);
  if s is null or s = new.vendor_id then
    return new;
  end if;
  if tg_table_name = 'inbound_manifests' then
    select nullif(btrim(license_number), '') into lic from public.vendors where id = new.vendor_id;
    if lic is not null
       and coalesce(nullif(btrim(new.raw_payload->>'from_license_number'), ''),
                    nullif(btrim(new.raw_payload->>'vendor_license'), '')) is null then
      new.raw_payload := coalesce(new.raw_payload, '{}'::jsonb)
                         || jsonb_build_object('from_license_number', lic, 'license_stamped_by', '0350 vendor merge');
    end if;
  end if;
  new.vendor_id := s;
  return new;
end;
$$;

revoke all on function public.vendor_follow_merge() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'inventory_lots', 'inbound_manifests', 'catalog_product_drafts', 'kb_products', 'kb_brands',
    'brands', 'product_enrichments', 'purchase_orders', 'vendor_returns', 'trade_sample_events',
    'vendor_manifest_payments', 'noncannabis_invoices', 'vendor_platform_map',
    'leaflink_menu_snapshots', 'cultivera_menu_snapshots', 'growflow_menu_snapshots', 'emailed_menu_snapshots'
  ] loop
    if to_regclass('public.' || t) is not null
       and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t and column_name = 'vendor_id') then
      execute format('drop trigger if exists trg_vendor_follow_merge on public.%I', t);
      execute format('create trigger trg_vendor_follow_merge before insert or update of vendor_id on public.%I '
                     'for each row execute function public.vendor_follow_merge()', t);
    end if;
  end loop;
end
$$;

-- ── 6. sweep_merged_vendor_rows ──────────────────────────────────────────────
create or replace function public.sweep_merged_vendor_rows()
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v        record;
  r        jsonb;
  s        uuid;
  moved    integer := 0;
  cards    integer := 0;
  attn     jsonb := '{}'::jsonb;
begin
  for v in select id, display_name from public.vendors where merged_into_id is not null order by id loop
    s := public.vendor_survivor_id(v.id);
    continue when s is null or s = v.id;
    r := public.vendor_repoint_references(s, array[v.id]);
    if (r->>'total')::integer > 0 then
      cards := cards + 1;
      moved := moved + (r->>'total')::integer;
    end if;
    if r->'needs_attention' <> '{}'::jsonb then
      attn := attn || jsonb_build_object(v.id::text, r->'needs_attention');
    end if;
  end loop;
  return jsonb_build_object('cards_swept', cards, 'rows_moved', moved, 'needs_attention', attn);
end;
$$;

revoke all on function public.sweep_merged_vendor_rows() from public, anon, authenticated;
grant execute on function public.sweep_merged_vendor_rows() to service_role;

-- ── 7. Finish the production merges (no-op where the cards don't exist) ──────
do $$
declare
  pair record;
begin
  for pair in
    select * from (values
      -- Alpha Crux Llc 427037 (58 lots) <- Alpha Crux Llc 412306 (constellationcannabis.com; half-merged, still published)
      ('b9483868-45be-4088-a39e-20ce19a1f68d'::uuid, 'fdfb3531-33ea-47b4-9f68-0a1538a15a87'::uuid),
      -- Fire Bros. 425450 (143 lots, firebros.com) <- FIREBROS 416025 (5 lots, brand Fire Bros)
      ('f69231c1-18ef-4e19-92de-834dbb12352b'::uuid, '366ec135-cfc0-41ab-9ff7-89319e476abc'::uuid),
      -- Botanica Seattle 412723 (38 lots, mrmoxeys.com) <- BOTANICA SEATTLE 412724 (0 lots)
      ('bc64f709-dec7-4e51-9e31-27e8b7febece'::uuid, '477204dc-f790-441b-9103-3f6b43dc15ff'::uuid)
    ) as p(survivor, dup)
  loop
    if exists (select 1 from public.vendors where id = pair.survivor and merged_into_id is null and status <> 'archived')
       and exists (select 1 from public.vendors where id = pair.dup and merged_into_id is null) then
      perform public.merge_vendors_v2(pair.survivor, array[pair.dup]);
    end if;
  end loop;
end
$$;

select public.sweep_merged_vendor_rows();
