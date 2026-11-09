-- D221 (M1+M2) post-apply scenario check for 0352_media_library_v2.
-- Run by scripts/compliance/verify-migrations-execute.ts after every
-- migration has been applied. Everything happens inside one transaction
-- that is rolled back, so nothing is left behind.
--
-- The scenario: the same vendor-menu photo was saved three times (once
-- per product on the menu), each copy is used by a different product
-- slot, and one copy is a vendor logo. After the migration runs again:
--   * one live row remains, the other two are archived with canonical_id
--   * every reference points at the kept row (single ids, arrays, usages,
--     image memory) with no duplicate slots
--   * a fourth insert of the same file is refused by the unique index
--   * the vendor is resolved from the menu seller name, the row is
--     auto-published, and media_search finds it by product name.
\set ON_ERROR_STOP on
begin;

-- Pretend the library already has copies (the state before 0352): drop the
-- unique index so the duplicates can be inserted, then re-run the migration.
drop index if exists public.uq_media_assets_live_content_hash;

insert into public.vendors (id, display_name, slug, license_number)
values ('00000000-0000-4000-8000-0000000352a1', 'Phat Panda Farms', 'phat-panda-farms', '412345')
on conflict do nothing;

insert into public.media_assets (id, storage_key, filename, mime_type, tags, status, created_at, source)
values
  ('00000000-0000-4000-8000-000000035201', 'cultivera/abcdef0123456789-gelato.jpg', 'gelato.jpg', 'image/jpeg', array['cultivera'], 'draft', now() - interval '3 days', 'cultivera:https://img.example.com/gelato.jpg'),
  ('00000000-0000-4000-8000-000000035202', 'cultivera/abcdef0123456789-gelato.jpg', 'gelato.jpg', 'image/jpeg', array['cultivera','extra-tag'], 'draft', now() - interval '2 days', 'cultivera:https://img.example.com/gelato.jpg'),
  ('00000000-0000-4000-8000-000000035203', 'cultivera/abcdef0123456789-gelato.jpg', 'gelato.jpg', 'image/jpeg', array['cultivera'], 'draft', now() - interval '1 days', 'cultivera:https://img.example.com/gelato.jpg'),
  ('00000000-0000-4000-8000-000000035204', 'uploads/0123456789abcdef-other.png', 'other.png', 'image/png', array[]::text[], 'draft', now(), null);

update public.media_assets set alt_text = 'Gelato 3.5g jar'
 where id = '00000000-0000-4000-8000-000000035203';

update public.vendors set logo_media_id = '00000000-0000-4000-8000-000000035202'
 where id = '00000000-0000-4000-8000-0000000352a1';

insert into public.media_usages (media_asset_id, entity_type, entity_id, field_key) values
  ('00000000-0000-4000-8000-000000035201', 'kb_product', 'phat-panda/gelato/3-5g', 'primary'),
  ('00000000-0000-4000-8000-000000035202', 'kb_product', 'phat-panda/gelato/3-5g', 'primary'),
  ('00000000-0000-4000-8000-000000035203', 'kb_product', 'phat-panda/gelato/7g', 'primary');

insert into public.product_image_memory (identity_key, media_asset_id, times_confirmed) values
  ('gelato|3.5g', '00000000-0000-4000-8000-000000035201', 2),
  ('gelato|3.5g', '00000000-0000-4000-8000-000000035203', 3),
  ('gelato|7g',   '00000000-0000-4000-8000-000000035202', 1);

do $$
declare r jsonb;
begin
  r := public.media_canonicalize(true);
  if (r->>'copies')::int < 2 then raise exception 'dry run should see >= 2 copies, got %', r; end if;
  -- dry run must not change anything
  if (select count(*) from public.media_assets where status = 'archived'
        and id::text like '00000000-0000-4000-8000-00000003520%') <> 0 then
    raise exception 'dry run archived rows';
  end if;
end $$;

\ir ../../supabase/migrations/0352_media_library_v2.sql

do $$
declare
  keep uuid := '00000000-0000-4000-8000-000000035201';
  n int;
  t text[];
  a text;
begin
  -- one live row per file; copies archived and pointing at the kept row
  select count(*) into n from public.media_assets
   where content_hash = 'abcdef0123456789' and status <> 'archived';
  if n <> 1 then raise exception 'expected 1 live row, got %', n; end if;
  select count(*) into n from public.media_assets
   where content_hash = 'abcdef0123456789' and status = 'archived' and canonical_id = keep;
  if n <> 2 then raise exception 'expected 2 archived copies, got %', n; end if;
  select duplicate_count, tags, alt_text into n, t, a from public.media_assets where id = keep;
  if n < 2 then raise exception 'duplicate_count %', n; end if;
  if not ('extra-tag' = any(t)) then raise exception 'tags not merged: %', t; end if;
  if a is distinct from 'Gelato 3.5g jar' then raise exception 'alt not gap-filled: %', a; end if;

  -- references moved
  if (select logo_media_id from public.vendors where id = '00000000-0000-4000-8000-0000000352a1') <> keep then
    raise exception 'vendor logo not repointed';
  end if;
  select count(*) into n from public.media_usages where media_asset_id <> keep
     and entity_id like 'phat-panda/gelato/%';
  if n <> 0 then raise exception 'usages left on copies: %', n; end if;
  select count(*) into n from public.media_usages where entity_id = 'phat-panda/gelato/3-5g';
  if n <> 1 then raise exception 'duplicate usage slot kept: %', n; end if;
  select count(*) into n from public.media_usages where entity_id = 'phat-panda/gelato/7g' and media_asset_id = keep;
  if n <> 1 then raise exception '7g usage lost'; end if;
  select times_confirmed into n from public.product_image_memory where identity_key = 'gelato|3.5g';
  if n <> 5 then raise exception 'image memory not merged: %', n; end if;
  select count(*) into n from public.product_image_memory where media_asset_id <> keep
     and identity_key like 'gelato|%';
  if n <> 0 then raise exception 'image memory left on copies'; end if;

  -- the unrelated upload is untouched
  if (select status::text from public.media_assets where id = '00000000-0000-4000-8000-000000035204') <> 'draft' then
    raise exception 'upload changed';
  end if;

  -- provenance + publish: platform from the source prefix, credit from the vendor logo slot
  if (select platform from public.media_assets where id = keep) is distinct from 'cultivera' then
    raise exception 'platform not backfilled';
  end if;
  if (select vendor_id from public.media_assets where id = keep) is distinct from '00000000-0000-4000-8000-0000000352a1' then
    raise exception 'vendor not resolved';
  end if;
  if (select status::text from public.media_assets where id = keep) <> 'published' then
    raise exception 'vendor-sourced row not auto-published';
  end if;
  if (select publish_reason from public.media_assets where id = keep) is distinct from 'vendor-source-auto' then
    raise exception 'publish_reason missing';
  end if;

  -- vendor resolution helper
  if public.media_resolve_vendor('PHAT PANDA FARMS LLC', null) is distinct from '00000000-0000-4000-8000-0000000352a1' then
    raise exception 'resolve by name prefix failed';
  end if;
  if public.media_resolve_vendor('anything 412345', null) is distinct from '00000000-0000-4000-8000-0000000352a1' then
    raise exception 'resolve by license failed';
  end if;

  -- search
  update public.media_assets set product_name = 'Gelato Cake 3.5g' where id = keep;
  select count(*) into n from public.media_search('gelat', null, null, null, null, null, null, 20, 0) where media_id = keep;
  if n <> 1 then raise exception 'prefix search missed'; end if;
  select count(*) into n from public.media_search('gelato', '00000000-0000-4000-8000-0000000352a1', null, null, null, null, null, 20, 0);
  if n < 1 then raise exception 'vendor-scoped search missed'; end if;
  select count(*) into n from public.media_search('gelato', null, null, null, null, null, null, 20, 0)
   where media_id <> keep and media_id::text like '00000000-0000-4000-8000-00000003520%';
  if n <> 0 then raise exception 'archived copies leaked into search'; end if;

  if (public.media_library_health()->>'archived_copies')::int < 2 then raise exception 'health archived_copies'; end if;
end $$;

-- A fourth save of the same file is refused (the harvest reuses the row).
do $$
begin
  begin
    insert into public.media_assets (storage_key, filename) values ('cultivera/abcdef0123456789-gelato.jpg', 'gelato.jpg');
    raise exception 'duplicate insert was allowed';
  exception when unique_violation then null;
  end;
end $$;

-- media_ai_runs is service-role only.
do $$
begin
  if has_table_privilege('anon', 'public.media_ai_runs', 'select') then raise exception 'anon can read media_ai_runs'; end if;
  if has_table_privilege('authenticated', 'public.media_ai_runs', 'select') then raise exception 'authenticated can read media_ai_runs'; end if;
  if has_function_privilege('anon', 'public.media_canonicalize(boolean)', 'execute') then raise exception 'anon can canonicalize'; end if;
  if not has_function_privilege('authenticated', 'public.media_search_document(public.media_assets)', 'execute') then raise exception 'staff writes would fail in the search trigger'; end if;
  if has_function_privilege('authenticated', 'public.media_canonicalize(boolean)', 'execute') then raise exception 'authenticated can canonicalize'; end if;
end $$;

-- Rollback file runs cleanly and the migration re-applies after it.
\ir ../../supabase/rollbacks/0352_media_library_v2.rollback.sql
do $$
begin
  if to_regclass('public.media_ai_runs') is not null then raise exception 'rollback left media_ai_runs'; end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='media_assets' and column_name='content_hash') then
    raise exception 'rollback left content_hash';
  end if;
end $$;
\ir ../../supabase/migrations/0352_media_library_v2.sql
do $$
begin
  if to_regclass('public.media_ai_runs') is null then raise exception 're-apply failed'; end if;
  raise notice 'MEDIA LIBRARY V2 0352 CHECK PASSED';
end $$;

rollback;
