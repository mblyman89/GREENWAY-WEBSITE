-- ---------------------------------------------------------------------------
-- 0130_security_rls_hardening.sql  (GW-019 + GW-020 fix — run manually in the SQL editor)
--
-- Two audit findings, one insider-threat hardening migration. In Supabase the
-- public anon key ships in the browser bundle BY DESIGN, and every staff
-- login carries its own session token — so anything the database itself does
-- not refuse can be reached with one curl command, no matter what the admin
-- UI hides. This migration makes the DATABASE the last line of defense
-- (defense in depth / least privilege — the same posture the big providers
-- run): every table denies by default, the app's service-role server code
-- (which bypasses RLS) keeps working unchanged, and humans get only what
-- their role needs.
--
--   GW-019: four tables had NO row-level security at all —
--   kb_product_categories, noncannabis_products, noncannabis_sku_sequences,
--   noncannabis_adjustments. Anyone holding the public anon key could read
--   wholesale COSTS and margins, corrupt glassware inventory counts, or
--   rewrite the SKU counters — anonymously, without any login.
--
--   GW-020: the employees table (scrypt-hashed clock PINs, and the
--   bank_routing / bank_account_number / bank_account_type direct-deposit
--   columns) was readable AND writable by EVERY active staff account,
--   including 'readonly', because both policies used is_staff(). A
--   disgruntled low-privilege login could dump workforce PII or silently
--   null out a PIN hash / edit records — bypassing the admin UI (and its
--   audit events) entirely by talking to the auto-generated API directly.
--
-- Fraud-triangle note (why this is proactive, not reactive): fraud needs
-- OPPORTUNITY, pressure, and rationalization. Only opportunity is ours to
-- control. This file removes the opportunity (deny-by-default + least
-- privilege), and — for what remains — guarantees DETECTION (a database-level
-- audit trigger on the employee roster that no code path can skip, plus a
-- tamper-evident append-only audit log). An insider who knows every change
-- is recorded has nothing to rationalize with.
--
-- What changes (and what cannot break):
--   • The app reaches ALL tables touched here exclusively through the
--     service-role client (verified across src/ — the staffing, payroll,
--     noncannabis, KB, reports, and POS stores), and the service role
--     BYPASSES RLS. Nothing in the app changes behavior.
--   • Direct PostgREST access with the anon key or a staff session token is
--     what gets locked down — that "side door" is not used by any feature.
--
-- Idempotent: every statement is create-or-replace / drop-if-exists /
-- revoke-grant (naturally re-runnable). Safe to run more than once.
-- APPLY MANUALLY in the Supabase SQL editor (standing rule).
-- ---------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Role helper: is_manager() — owner/admin/manager, mirroring the app's
--    staffing.manage / inventory.manage permission rows (src/lib/auth/roles.ts).
--    Same shape as the existing is_staff()/is_admin() helpers from 0001
--    (security definer so RLS policies can call it without recursion).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.staff_profiles
    where id = auth.uid() and active = true and role in ('owner','admin','manager')
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. GW-019 — the four RLS-less tables get RLS + least-privilege policies.
--    Enabling RLS with NO policy for a verb means that verb is DENIED for
--    anon/authenticated; the service role (the app's server code) bypasses
--    RLS entirely. So: writes everywhere here are service-role-only, and
--    reads are granted only where a human role has a legitimate need.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.kb_product_categories     enable row level security;
alter table public.noncannabis_products      enable row level security;
alter table public.noncannabis_sku_sequences enable row level security;
alter table public.noncannabis_adjustments   enable row level security;

-- kb_product_categories: customer-facing taxonomy (names, aliases, blurbs) —
-- not sensitive; staff read matches the sibling KB tables (0019/0071).
-- Writes: none (service-role only; app gates edits by permission).
drop policy if exists kb_product_categories_staff_read on public.kb_product_categories;
create policy kb_product_categories_staff_read on public.kb_product_categories
  for select using (public.is_staff());

-- noncannabis_products: carries wholesale COST and margin data — manager+
-- read only, mirroring roles.ts "inventory.manage" (owner/admin/manager).
-- Writes: none (service-role only).
drop policy if exists noncannabis_products_mgr_read on public.noncannabis_products;
create policy noncannabis_products_mgr_read on public.noncannabis_products
  for select using (public.is_manager());

-- noncannabis_sku_sequences: internal SKU counter — no human needs direct
-- API access at all. No policies: fully service-role-only.

-- The kb_noncannabis_catalog view (0076) reads noncannabis_products with the
-- view OWNER's rights by default — which would silently bypass the RLS we
-- just enabled. security_invoker makes it run with the CALLER's rights, so
-- the table's policies apply through the view too. (The view exposes no cost
-- column and no app code queries it today — verified by grep — this closes
-- the bypass before anything ever does.)
alter view public.kb_noncannabis_catalog set (security_invoker = on);

-- noncannabis_adjustments: the glassware inventory audit trail — manager+
-- read; writes service-role-only so the ledger stays append-only from the
-- API's point of view (the app never updates or deletes adjustment rows).
drop policy if exists noncannabis_adjustments_mgr_read on public.noncannabis_adjustments;
create policy noncannabis_adjustments_mgr_read on public.noncannabis_adjustments
  for select using (public.is_manager());

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. GW-020 — the employee roster: manager+ read, NO direct write, and the
--    sensitive columns (PIN hash + banking) unreadable even to managers at
--    the API layer. "Banking columns have exactly one read path"
--    (TEST-PLAN T-124) is now enforced by the database itself, not just by
--    the app's code discipline.
-- ═══════════════════════════════════════════════════════════════════════════

-- 2a. Replace the two broad is_staff() policies (0037) with manager+ read.
--     No write policy at all: inserts/updates/deletes happen ONLY through
--     the app's service-role server actions (which check staffing.manage and
--     record audit events) — a staff session token can no longer touch the
--     roster directly.
drop policy if exists employees_staff_read  on public.employees;
drop policy if exists employees_staff_write on public.employees;
drop policy if exists employees_mgr_read    on public.employees;
create policy employees_mgr_read on public.employees
  for select using (public.is_manager());

-- 2b. Column-level privileges (defense in depth UNDER the row policy): even
--     a manager's own session token cannot select the PIN hash or banking
--     columns through the API. Postgres column privileges require revoking
--     the table-level SELECT first, then granting back only the allowed
--     columns — so the allowed list below is every employees column EXCEPT
--     clock_pin, bank_routing, bank_account_number, bank_account_type
--     (complete column inventory verified across 0037 + 0057 + 0117 + 0126).
--     NOTE: a column-privileged role cannot use `select *` on this table —
--     irrelevant to the app (service role is unrestricted), and any future
--     column added to employees is UNREADABLE via the API until it is
--     explicitly granted here (fail-closed, exactly what we want).
revoke select on table public.employees from anon, authenticated;
grant select (
  id, full_name, staff_id, job_role, active, notes, created_at, updated_at,
  hire_date, employment_status, termination_date, termination_reason,
  badge_number, age_21_verified, saw_username
) on table public.employees to authenticated;

-- 2c. Belt and braces on writes: RLS already denies them (no write policy),
--     and the privilege layer now refuses them independently. REFERENCES /
--     TRIGGER / TRUNCATE come along from Supabase's default `grant all` —
--     none can read data, but API roles have no business holding them here.
revoke insert, update, delete, references, trigger, truncate
  on table public.employees from anon, authenticated;

-- 2d. The sibling workforce tables keep the same discipline. All app writes
--     go through the service role, so dropping the broad is_staff() WRITE
--     policies costs nothing and closes the same "silent direct edit" edge:
--       • shifts / time_punches (0037): staff read stays (schedule/time-clock
--         visibility mirrors roles.ts "timeclock.use" = any active staff);
--         direct API writes die. A punch can no longer be forged or an hours
--         record silently edited with a session token.
--       • employee_onboarding_tasks / employee_documents /
--         employee_training_log (0117): HR file data (W-4/I-9 status, badge
--         and training records) — read tightens to manager+ (mirroring
--         roles.ts "staffing.manage"), writes service-role-only.
drop policy if exists shifts_staff_write on public.shifts;
drop policy if exists time_punches_staff_write on public.time_punches;

drop policy if exists employee_onboarding_tasks_staff_read  on public.employee_onboarding_tasks;
drop policy if exists employee_onboarding_tasks_staff_write on public.employee_onboarding_tasks;
drop policy if exists employee_onboarding_tasks_mgr_read    on public.employee_onboarding_tasks;
create policy employee_onboarding_tasks_mgr_read on public.employee_onboarding_tasks
  for select using (public.is_manager());

drop policy if exists employee_documents_staff_read  on public.employee_documents;
drop policy if exists employee_documents_staff_write on public.employee_documents;
drop policy if exists employee_documents_mgr_read    on public.employee_documents;
create policy employee_documents_mgr_read on public.employee_documents
  for select using (public.is_manager());

drop policy if exists employee_training_log_staff_read  on public.employee_training_log;
drop policy if exists employee_training_log_staff_write on public.employee_training_log;
drop policy if exists employee_training_log_mgr_read    on public.employee_training_log;
create policy employee_training_log_mgr_read on public.employee_training_log
  for select using (public.is_manager());

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Database-level audit trail on the employee roster (fraud-triangle
--    DETECTION). The app already records audit events in its server actions,
--    but a database trigger cannot be skipped by ANY path — app bug, future
--    code, or a compromised service key. Every insert/update/delete on
--    employees lands in audit_logs with before/after snapshots.
--
--    REDACTION: audit_logs must never leak what the roster protects — the
--    snapshots EXCLUDE clock_pin and the bank_* values. Instead, the entry
--    records WHICH sensitive columns changed (names only, never values)
--    under "_sensitive_changed", so "someone replaced a PIN hash at 2:13 AM"
--    is visible without the hash itself going anywhere.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.log_employees_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sensitive  text[] := array['clock_pin','bank_routing','bank_account_number','bank_account_type'];
  changed    text[] := '{}';
  before_j   jsonb;
  after_j    jsonb;
  col        text;
begin
  -- (NEW is unassigned in DELETE triggers and OLD in INSERT triggers, and
  -- Postgres does not promise AND short-circuit order — so every reference
  -- below is nested under its tg_op branch.)
  if tg_op = 'UPDATE' then
    if to_jsonb(old) = to_jsonb(new) then
      return new;  -- true no-op write: nothing to record
    end if;
  end if;

  if tg_op in ('UPDATE','DELETE') then
    before_j := to_jsonb(old) - sensitive;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    after_j := to_jsonb(new) - sensitive;
  end if;

  foreach col in array sensitive loop
    if tg_op = 'INSERT' then
      if to_jsonb(new) -> col is not null and to_jsonb(new) ->> col is not null then
        changed := changed || col;
      end if;
    elsif tg_op = 'UPDATE' then
      if (to_jsonb(old) -> col) is distinct from (to_jsonb(new) -> col) then
        changed := changed || col;
      end if;
    elsif tg_op = 'DELETE' then
      if to_jsonb(old) -> col is not null and to_jsonb(old) ->> col is not null then
        changed := changed || col;
      end if;
    end if;
  end loop;
  if array_length(changed, 1) is not null then
    after_j := coalesce(after_j, '{}'::jsonb)
                 || jsonb_build_object('_sensitive_changed', to_jsonb(changed));
  end if;

  -- NB: in a plpgsql DELETE trigger NEW is unassigned (and vice versa for
  -- INSERT/OLD) — referencing the wrong one raises — so branch on tg_op.
  insert into public.audit_logs
    (actor_id, action, entity_type, entity_id, before_json, after_json)
  values
    (auth.uid(),                              -- null for service-role writes
     'employee.db.' || lower(tg_op),
     'employee',
     case when tg_op = 'DELETE' then old.id::text else new.id::text end,
     before_j,
     after_j);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_employees_audit on public.employees;
create trigger trg_employees_audit
  after insert or update or delete on public.employees
  for each row execute function public.log_employees_change();

-- The trigger function is internal plumbing — nobody calls it directly.
revoke execute on function public.log_employees_change() from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The audit log itself becomes tamper-evident and need-to-know:
--    • Read tightens from "any staff" to admin-only — matching the app's own
--      gate on the audit page (users.manage = owner/admin). A readonly or
--      floor-staff session can no longer dump who-did-what history (actor
--      emails, action trails) through the API.
--    • APPEND-ONLY at the privilege layer: update/delete revoked from anon,
--      authenticated, AND service_role. The app only ever INSERTs audit rows
--      (verified: recordAudit + read paths; the 0069/0097 reset functions
--      deliberately never touch audit_logs), so revoking from service_role
--      costs nothing and means even a leaked service key cannot rewrite
--      history. (The owner's postgres role in the SQL editor is unaffected —
--      re-grant there if a retention purge is ever wanted.)
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists audit_staff_read on public.audit_logs;
drop policy if exists audit_admin_read on public.audit_logs;
create policy audit_admin_read on public.audit_logs
  for select using (public.is_admin());

revoke update, delete on table public.audit_logs from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- OWNER REVIEW QUERIES (read-only — run each once after applying, just look):
--
-- A. Every table must now have RLS enabled (expect ZERO rows — if any table
--    appears, tell the developer immediately):
--
--   select tablename from pg_tables
--   where schemaname = 'public' and rowsecurity = false;
--
-- B. The employee roster's policies (expect exactly ONE row: employees_mgr_read,
--    cmd 'SELECT' — no write policy of any kind):
--
--   select policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'employees';
--
-- C. The sensitive columns are NOT API-readable (expect ZERO rows — this asks
--    "can the logged-in role read or write the PIN hash or bank columns?"):
--
--   select column_name, privilege_type
--   from information_schema.column_privileges
--   where table_schema = 'public' and table_name = 'employees'
--     and grantee in ('anon', 'authenticated')
--     and privilege_type in ('SELECT','INSERT','UPDATE')
--     and column_name in ('clock_pin','bank_routing','bank_account_number','bank_account_type');
--
-- D. The audit trigger is armed (expect ONE row: trg_employees_audit):
--
--   select tgname from pg_trigger
--   where tgrelid = 'public.employees'::regclass and tgname = 'trg_employees_audit';
--
-- E. The audit log is append-only (expect ZERO rows — nobody, not even the
--    service role, holds UPDATE or DELETE on audit_logs):
--
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'audit_logs'
--     and privilege_type in ('UPDATE','DELETE')
--     and grantee in ('anon','authenticated','service_role');
-- ---------------------------------------------------------------------------
