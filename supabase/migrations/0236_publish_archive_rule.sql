-- =============================================================================
-- 0236 - One archival rule for every publish (S15)
-- =============================================================================
-- WHY
-- Before this file there were THREE different rules for which staged menu
-- updates get archived when a menu goes live, and none of them covered both
-- kinds of update (bible S15, findings F-057, F-058, F-042):
--
--   1. The database function publish_menu_version (0002, lines 242-269)
--      archived other staged updates ONLY when the published update came from
--      a POS spreadsheet import, and even then its test was
--      "import_id <> the published import". For updates built from receiving
--      the import_id is NULL, and NULL <> x is NULL in SQL, never true, so
--      receiving updates were NEVER archived by the database.
--   2. The Menu Imports publish button then archived receiving updates that
--      were older than the one just published (app code, best effort).
--   3. The automatic publish after an approval archived receiving updates of
--      ANY age, but never a POS import update (app code, best effort).
--
-- Result: after a Cultivera upload that was not published, followed by an
-- approval that published itself, the Cultivera update sat on the Publish
-- page forever with a red "Outdated" chip. Publishing it by mistake would
-- have taken every received product off the menu.
--
-- WHAT THIS FILE DOES
-- A. publish_menu_version keeps its exact signature (p_version_id uuid,
--    p_actor uuid) returns void, SECURITY DEFINER, search_path public.
--    ONE rule now: after the swap, every STAGED update of ANY origin that was
--    created BEFORE the update just published is archived. Each archived row
--    records why, in summary_json:
--      archived_reason = superseded_by_publish:<published version id>
--      archived_at     = the time of the publish
--    Staged updates created AFTER the published one are left alone (they
--    are newer snapshots and are judged on the Publish page by what they
--    contain, not by their age).
--    Two safety fixes ride along:
--      - an unknown version id now RAISES before anything is committed.
--        Before, the old live menu was archived first and then nothing was
--        promoted, which left the public menu EMPTY.
--      - execute is revoked from public, anon and authenticated and granted
--        to service_role only. The function is SECURITY DEFINER, and both
--        callers (src/lib/pos/import-service.ts publishMenuVersion and
--        src/lib/pos/intake-menu-staging.ts autoPublishIntakeVersion) use the
--        service-role admin client, so no app path loses access.
--    Everything else is unchanged: the previous live version is archived, the
--    target gets status published + published_at + published_by, and a POS
--    import target stamps its pos_imports row as published.
--
-- B. clean_slate_test_data (0152) restored "the most recent archived real
--    version" when a TEST version was live. Rule A now archives staged
--    updates that were NEVER live, so that pick could restore a menu nobody
--    ever published. The restore now requires published_at is not null (a
--    version that really was live). Everything else in 0152 is unchanged.
--    Its execute grant is narrowed the same way (its only caller,
--    cleanSlateTestData in src/lib/pos/import-service.ts, uses the admin
--    client).
--
-- ROLLBACK
-- The previous bodies are kept, runnable, in
--   supabase/rollbacks/0236_publish_archive_rule.rollback.sql
-- (verbatim from 0002 lines 242-269 and 0152 lines 34-105, plus the default
-- grants restored). They are not pasted into these comments because their
-- statements end in semicolons, and a semicolon inside a comment line breaks
-- the Supabase SQL editor paste (scripts/compliance/strip-comments-for-sql-editor.ts
-- transitHazards). The app keeps working either way: the Publish code applies
-- the same archival rule itself after every publish, so before this file is
-- run, and after a rollback, nothing breaks.
--
-- SAFE / IDEMPOTENT: create or replace + revoke + grant only. No table,
-- column, index or row is created or deleted. Re-running is a no-op.
-- Verified on Postgres 15 with every migration applied, by
--   scripts/recon/publish-archive-rule-pg-check.sql
-- Apply MANUALLY in the Supabase SQL editor.
-- =============================================================================

create or replace function public.publish_menu_version(p_version_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_import  uuid;
  v_created timestamptz;
  v_reason  text := 'superseded_by_publish:' || p_version_id::text;
begin
  -- Refuse an unknown id BEFORE touching the live menu.
  select mv.import_id, mv.created_at
    into v_import, v_created
    from public.menu_versions mv
   where mv.id = p_version_id;
  if not found then
    raise exception 'PUBLISH_VERSION_NOT_FOUND: menu version % does not exist', p_version_id
      using errcode = 'P0002';
  end if;

  -- Archive the currently published version (unchanged from 0002).
  update public.menu_versions
     set status = 'archived', updated_at = now()
   where status = 'published' and id <> p_version_id;

  -- Promote the target (unchanged from 0002).
  update public.menu_versions
     set status = 'published', published_at = now(), published_by = p_actor, updated_at = now()
   where id = p_version_id;

  if v_import is not null then
    update public.pos_imports
       set status = 'published', published_at = now(), published_by = p_actor, updated_at = now()
     where id = v_import;
  end if;

  -- S15: ONE rule for both origins. Every staged update created before the
  -- published one is superseded. The reason is written on the row itself.
  update public.menu_versions
     set status = 'archived',
         updated_at = now(),
         summary_json =
           case
             when summary_json is null then '{}'::jsonb
             when jsonb_typeof(summary_json) = 'object' then summary_json
             else jsonb_build_object('summary_before_archive', summary_json)
           end
           || jsonb_build_object('archived_reason', v_reason, 'archived_at', now())
   where status = 'staged'
     and id <> p_version_id
     and created_at < v_created;
end;
$$;

comment on function public.publish_menu_version(uuid, uuid) is
  '0236 / S15: atomically publish one menu version. Archives the previous live version, stamps a POS import as published, and archives EVERY staged version of any origin created before the published one, recording summary_json.archived_reason = superseded_by_publish:<id>. Raises PUBLISH_VERSION_NOT_FOUND for an unknown id before changing anything. Service role only.';

revoke all on function public.publish_menu_version(uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_menu_version(uuid, uuid) to service_role;

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
  with del as (
    delete from public.menu_versions
     where is_test = true
       and status = 'staged'
    returning 1
  )
  select count(*) into v_staged_versions_deleted from del;

  delete from public.menu_versions
   where is_test = true
     and status = 'archived';

  select id into v_test_published_id
    from public.menu_versions
   where is_test = true
     and status = 'published'
   limit 1;

  if v_test_published_id is not null then
    delete from public.menu_versions where id = v_test_published_id;
    v_published_version_deleted := 1;

    -- 0236: only a version that really was live can be restored.
    select id into v_restored_id
      from public.menu_versions
     where is_test = false
       and status = 'archived'
       and published_at is not null
     order by published_at desc, created_at desc
     limit 1;

    if v_restored_id is not null then
      update public.menu_versions
         set status = 'published', published_at = now(), updated_at = now()
       where id = v_restored_id;
    end if;
  end if;

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
  '0236 / S15 (was T-327 Slice 2): deletes ALL is_test menu versions (staged, archived, AND published) and is_test pos_imports. When the LIVE published version is a test version it is removed and the most recently published archived NON-TEST version (published_at is not null) is re-published so the storefront restores real data (restored_version_id=null if none). Never touches real data or the knowledge base. Service role only.';

revoke all on function public.clean_slate_test_data() from public, anon, authenticated;
grant execute on function public.clean_slate_test_data() to service_role;
