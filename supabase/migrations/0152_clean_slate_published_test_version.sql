-- =============================================================================
-- 0152 — Clean Slate handles a PUBLISHED test version (T-327 roadmap Slice 2)
-- =============================================================================
-- BACKGROUND
-- Migration 0066 added clean_slate_test_data(), which deletes ONLY test-flagged
-- data. But it guarded menu-version deletion with `status <> 'published'`, so a
-- test version that was PUBLISHED to the live menu survived Clean Slate and kept
-- showing on the public storefront. (Michael published a single-product test
-- import to rehearse the flow; it landed on the live menu.)
--
-- The public storefront reads THE ONE row with status='published'
-- (getPublishedVersion + the uniq_menu_version_published partial unique index in
-- 0002). So we CANNOT simply delete a published test version — that would leave
-- ZERO published versions and an empty menu.
--
-- WHAT THIS MIGRATION DOES
-- Replaces clean_slate_test_data() with a version that, ATOMICALLY:
--   1. Deletes test STAGED versions (unchanged from 0066; cascades to items).
--   2. If a PUBLISHED version is a TEST version, deletes it (freeing the single
--      "published" slot) and then PROMOTES the most-recent ARCHIVED, NON-TEST
--      version back to published — restoring the real live menu. If there is no
--      prior real version to fall back to, it deletes the test published version
--      anyway (the menu becomes empty, which is correct: there was never real
--      data) and reports restoredVersionId = null so the caller can warn.
--   3. Deletes test imports (unchanged; cascades to diagnostics).
--
-- It STILL never touches: any is_test=false staged version, any real published
-- version, the knowledge base, vendors, customers, inventory, etc.
--
-- SAFE / IDEMPOTENT: create-or-replace only. Re-running with no test data is a
-- no-op. Apply MANUALLY in the Supabase SQL editor.
-- =============================================================================

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
