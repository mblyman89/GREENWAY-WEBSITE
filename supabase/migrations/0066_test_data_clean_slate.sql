-- =============================================================================
-- 0066 — Test-data flag + "Clean Slate" reset (E8)
-- =============================================================================
-- The owner is transitioning off Cultivera. During that transition they will
-- upload TEST menu exports and accept TEST staged versions to rehearse the
-- workflow WITHOUT touching the real, validated data. This migration:
--
--   1. Adds an `is_test` boolean flag to pos_imports and menu_versions so a
--      test upload can be marked at creation time (default FALSE = real data).
--
--   2. Adds a `clean_slate_test_data()` function that deletes ONLY test-flagged
--      import/menu data — and NOTHING else. It NEVER touches:
--         • any row where is_test = false (real imports / real menu versions),
--         • any PUBLISHED menu version (extra guard, even if mis-flagged),
--         • the validated cannabis KNOWLEDGE BASE (kb_* tables, 0019/0020/0056),
--         • vendors, customers, loyalty, content, or anything else.
--      Deleting a test menu_version cascades to its menu_items/menu_variants;
--      deleting a test pos_import cascades to its pos_import_diagnostics.
--
-- This keeps "start fresh with test data" a safe, one-click, scoped operation.
-- The application layer additionally confirm-gates and audit-logs the call.
--
-- Idempotent: add-column-if-not-exists + create-or-replace. Apply MANUALLY in
-- the Supabase SQL editor.
-- =============================================================================

alter table public.pos_imports   add column if not exists is_test boolean not null default false;
alter table public.menu_versions add column if not exists is_test boolean not null default false;

create index if not exists idx_pos_imports_is_test   on public.pos_imports(is_test)   where is_test = true;
create index if not exists idx_menu_versions_is_test on public.menu_versions(is_test) where is_test = true;

comment on column public.pos_imports.is_test is
  'TRUE if this import was made in test/rehearsal mode. Clean Slate deletes only test-flagged rows.';
comment on column public.menu_versions.is_test is
  'TRUE if this staged version came from a test import. NEVER set on a published version.';

-- Belt-and-suspenders: a published version must never be a test version.
-- (Enforced in app logic on publish; documented here for auditors.)

-- ---------- clean_slate_test_data() -----------------------------------------
-- Returns a small JSON summary of what was removed. Admin-only (SECURITY
-- INVOKER; RLS + the app's requirePermission gate control who may call it).
create or replace function public.clean_slate_test_data()
returns jsonb
language plpgsql
as $$
declare
  v_versions_deleted integer := 0;
  v_imports_deleted  integer := 0;
begin
  -- 1. Delete TEST staged menu versions (never published; extra guard anyway).
  --    Cascades to menu_items -> menu_variants.
  with del as (
    delete from public.menu_versions
     where is_test = true
       and status <> 'published'
    returning 1
  )
  select count(*) into v_versions_deleted from del;

  -- 2. Delete TEST imports. Cascades to pos_import_diagnostics.
  with del as (
    delete from public.pos_imports
     where is_test = true
    returning 1
  )
  select count(*) into v_imports_deleted from del;

  return jsonb_build_object(
    'menu_versions_deleted', v_versions_deleted,
    'pos_imports_deleted',   v_imports_deleted
  );
end;
$$;

comment on function public.clean_slate_test_data() is
  'E8: deletes ONLY is_test menu versions (non-published) and is_test pos_imports (cascading their children). Never touches real data or the knowledge base.';
