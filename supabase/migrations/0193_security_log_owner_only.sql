-- =============================================================================
-- 0193_security_log_owner_only.sql   (slice books-22)
--
-- Re-gates the Security Log (public.audit_logs) from is_admin() to is_owner(),
-- so the database says the same word the application says.
--
-- Idempotent: safe to run more than once. Applied MANUALLY by the owner.
--
-- -----------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
-- -----------------------------------------------------------------------------
-- Owner decision, 2026-08-20, verbatim:
--
--   "I am fine with my admin manager to pay employees and vendors, but they
--    shouldn't be able to see my personal finances, the plaid feeds, the
--    crypto, the atm, or the audit log, which you are right, let's change it
--    to be Security Log. I do also want you to make sure the doors are all
--    closed and locked tight. Any owner only page needs tight security."
--
-- The application half of that decision shipped in this same slice: the page
-- at /admin/audit moved off the shared "users.manage" permission and onto a new
-- "audit.view" permission granted to the owner alone.
--
-- This file is the OTHER half. Migration 0130 set the read policy to
-- is_admin(), and said so in its own comment:
--
--   "Read tightens from 'any staff' to admin-only -- matching the app's own
--    gate on the audit page (users.manage = owner/admin)."
--
-- That comment was true when it was written. This slice made it false. The
-- policy and the page no longer agree, and the policy is now the LOOSER of the
-- two. Leaving it that way would mean the owner's instruction was carried out
-- in the part of the system that is easy to see and ignored in the part that
-- actually holds the data.
--
-- -----------------------------------------------------------------------------
-- HONEST SCOPE: WHAT THIS DOES AND DOES NOT CHANGE TODAY
-- -----------------------------------------------------------------------------
-- This is DEFENCE IN DEPTH, not the lock that is holding the door today, and
-- the difference is worth stating plainly rather than overselling the change.
--
-- Every place in this codebase that reads audit_logs does so with the SERVICE
-- ROLE key, which bypasses row-level security entirely. All four were checked
-- one at a time before this file was written:
--
--     src/app/admin/audit/page.tsx        createSupabaseAdminClient()
--     src/app/admin/users/page.tsx        createSupabaseAdminClient()
--     src/lib/admin/audit-anomaly.ts      createSupabaseAdminClient()
--     src/lib/pos/refunds-store.ts        createSupabaseAdminClient()
--
-- So today the thing stopping an admin from reading the Security Log is the
-- permission check on the page, and nothing else. This policy changes who could
-- read the table THROUGH THE API with a logged-in session -- a path the app does
-- not currently use, but which exists, is reachable with any admin's own
-- credentials, and needs no code change by anyone to become useful.
--
-- It is worth doing precisely because it costs nothing: the four readers above
-- are unaffected, so there is no feature to break. What it buys is that the day
-- someone converts one of those readers to a normal session client -- an
-- ordinary, sensible-looking refactor -- the table does not quietly open up.
--
-- -----------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT CHANGED
-- -----------------------------------------------------------------------------
--   * INSERT is untouched. Audit rows are written by the service role, which
--     bypasses RLS, so tightening SELECT cannot stop the system from recording
--     history. If this file broke writing, it would blind the very log it is
--     trying to protect.
--   * The append-only revoke from 0130 stays exactly as it is. update and
--     delete remain revoked from anon, authenticated AND service_role, so even
--     a leaked service key cannot rewrite what already happened.
--   * is_admin() itself is not narrowed. It still gates paying vendors and
--     running payroll, which the owner explicitly wants the admin to keep.
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- §0  PREFLIGHT -- fail loudly and specifically BEFORE changing anything
--
-- A file pasted out of order should say which file to run first, rather than
-- leaving a half-built schema behind.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.audit_logs') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0193 re-gates public.audit_logs, which does not exist yet. Run 0001_slice1_foundation.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regprocedure('public.is_owner()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0193 gates the Security Log on is_owner(), which does not exist yet. Run 0185_books_owner_only.sql first, then run this file again. Nothing was changed.';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- §1  THE RE-GATE
--
-- Both historical policy names are dropped first, so this file lands cleanly
-- whether the database is currently at 0001 (audit_staff_read) or at 0130
-- (audit_admin_read), and so it can be run twice without complaint.
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists audit_staff_read on public.audit_logs;
drop policy if exists audit_admin_read on public.audit_logs;
drop policy if exists audit_owner_read on public.audit_logs;

create policy audit_owner_read on public.audit_logs
  for select using (public.is_owner());

comment on table public.audit_logs is
  'The Security Log: who did what, and when. Renamed from "Audit Log" in books-22 so it cannot be confused with Inventory Auditing, which counts stock. READ IS OWNER-ONLY (owner decision 2026-08-20) and matches requirePermission("audit.view") on /admin/audit. APPEND-ONLY: update and delete are revoked from every role including service_role, so history cannot be edited to hide something. Inserts are made by the service role, which bypasses RLS.';

-- Re-assert the append-only revoke from 0130. Repeating it is intentional: it
-- makes this file self-contained, and re-running a revoke that is already in
-- place is a no-op.
revoke update, delete on table public.audit_logs from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- OWNER REVIEW QUERIES (read-only -- run each once after applying, just look):
--
-- A. The Security Log must have exactly one read policy, and it must name
--    is_owner(). Expect ONE row, with qual = "is_owner()":
--
--      select policyname, cmd, qual
--        from pg_policies
--       where schemaname = 'public' and tablename = 'audit_logs';
--
-- B. Nobody may edit history. Expect ZERO rows -- if anything appears, the
--    append-only guarantee is gone and the developer should be told:
--
--      select grantee, privilege_type
--        from information_schema.role_table_grants
--       where table_schema = 'public' and table_name = 'audit_logs'
--         and privilege_type in ('UPDATE', 'DELETE');
--
-- C. The log is still being written. Run this after clicking around the admin
--    for a minute; the newest row should be from just now, not from before this
--    migration was applied:
--
--      select created_at, action from public.audit_logs
--       order by created_at desc limit 5;
-- ---------------------------------------------------------------------------
