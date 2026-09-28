-- =============================================================================
-- ROLLBACK for 0236_publish_archive_rule.sql (S15)
-- =============================================================================
-- This file is NOT a migration. It lives outside supabase/migrations on
-- purpose, so the migration runner (scripts/compliance/verify-migrations-execute.ts,
-- which reads only supabase/migrations/*.sql) never applies it.
--
-- Run it ONLY to undo 0236. It restores, byte for byte:
--   A. publish_menu_version from 0002_slice2_pos_import.sql lines 242-269,
--      minus the two comment lines above the final update (lines 263-264).
--      One has an apostrophe and one a semicolon, which can confuse the
--      Supabase SQL editor when pasted. Every line of code is unchanged.
--   B. clean_slate_test_data and its comment from
--      0152_clean_slate_published_test_version.sql lines 34 to the end
--   C. the execute grants those functions had before 0236 (Postgres gives
--      execute to PUBLIC by default, and Supabase also grants anon,
--      authenticated and service_role).
-- After a rollback the app keeps working: the Publish code applies the same
-- archival rule itself after every publish.
-- =============================================================================

create or replace function public.publish_menu_version(p_version_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_import uuid;
begin
  -- Archive any currently published version.
  update public.menu_versions
    set status = 'archived', updated_at = now()
    where status = 'published' and id <> p_version_id;

  -- Promote the target version.
  update public.menu_versions
    set status = 'published', published_at = now(), published_by = p_actor, updated_at = now()
    where id = p_version_id
    returning import_id into v_import;

  if v_import is not null then
    update public.pos_imports
      set status = 'published', published_at = now(), published_by = p_actor, updated_at = now()
      where id = v_import;

    update public.menu_versions
      set status = 'archived', updated_at = now()
      where status = 'staged' and import_id <> v_import;
  end if;
end $$;

create or replace function public.clean_slate_test_data()
returns jsonb
language plpgsql
as $$
declare
  v_staged_versions_deleted    integer := 0;
  v_published_version_deleted  integer := 0;
  v_imports_deleted            integer := 0;
  v_test_published_id          uuid;
  v_restored_id                uuid;
begin
  -- 1. Delete TEST *staged* versions (as in 0066). Cascades to menu_items.
  with del as (
    delete from public.menu_versions
     where is_test = true
       and status = 'staged'
    returning 1
  )
  select count(*) into v_staged_versions_deleted from del;

  -- Also sweep any TEST *archived* versions (dead history, safe to remove).
  delete from public.menu_versions
   where is_test = true
     and status = 'archived';

  -- 2. Is the CURRENT live (published) version a TEST version? If so, remove it
  --    and restore the previous real menu. All inside this function = atomic.
  select id into v_test_published_id
    from public.menu_versions
   where is_test = true
     and status = 'published'
   limit 1;

  if v_test_published_id is not null then
    -- Delete the test published version FIRST so the single "published" slot is
    -- free (uniq_menu_version_published), then promote the fallback.
    delete from public.menu_versions where id = v_test_published_id;
    v_published_version_deleted := 1;

    -- Promote the most-recent ARCHIVED, NON-TEST version back to published so
    -- the storefront falls back to real data. NULL if none exists.
    select id into v_restored_id
      from public.menu_versions
     where is_test = false
       and status = 'archived'
     order by coalesce(published_at, updated_at, created_at) desc, created_at desc
     limit 1;

    if v_restored_id is not null then
      update public.menu_versions
         set status = 'published', published_at = now(), updated_at = now()
       where id = v_restored_id;
    end if;
  end if;

  -- 3. Delete TEST imports (as in 0066). Cascades to pos_import_diagnostics.
  with del as (
    delete from public.pos_imports
     where is_test = true
    returning 1
  )
  select count(*) into v_imports_deleted from del;

  return jsonb_build_object(
    'menu_versions_deleted',        v_staged_versions_deleted + v_published_version_deleted,
    'staged_versions_deleted',      v_staged_versions_deleted,
    'published_version_deleted',    v_published_version_deleted,
    'pos_imports_deleted',          v_imports_deleted,
    'restored_version_id',          v_restored_id
  );
end;
$$;

comment on function public.clean_slate_test_data() is
  'T-327 Slice 2: deletes ALL is_test menu versions (staged, archived, AND published) and is_test pos_imports. When the LIVE published version is a test version, it is removed and the most-recent archived NON-TEST version is re-published so the storefront restores real data (restored_version_id=null if none). Never touches real data or the knowledge base.';

grant execute on function public.publish_menu_version(uuid, uuid) to public, anon, authenticated, service_role;
grant execute on function public.clean_slate_test_data() to public, anon, authenticated, service_role;
