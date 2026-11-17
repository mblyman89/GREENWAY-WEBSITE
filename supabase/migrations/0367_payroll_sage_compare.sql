-- ============================================================================
-- 0367 - PAYROLL: SAGE AMOUNTS ENTERED FOR COMPARISON  (D248 slice 4)
--
-- WHY. Owner, verbatim (D248): "I just want to take the hours worked and
-- calculate all things employee payroll for me to compare with sage."
-- The comparison screen needs somewhere to keep what Sage produced for a pay
-- period, per employee, per paystub line, so a comparison typed in once is
-- still there tomorrow.
--
-- WHY A TABLE AND NOT site_settings. site_settings is readable by every staff
-- login under RLS (0001 settings_staff_read). Per-employee pay amounts must
-- not be. This table is service role only, like 0364: no policies, all
-- privileges revoked from anon and authenticated. The app reads and writes it
-- through the server behind settings.manage (owner + admin), and audits
-- every save.
--
-- WHAT IT IS NOT. Not a pay record, not a journal, not a filing. Nothing reads
-- these numbers except the comparison screen. One row per pay period. The
-- amounts are integer cents (hours in hundredths) in a jsonb object keyed by
-- employee id then paystub line.
--
-- NO FOREIGN KEY to pay_periods, deliberately. pay_periods is emptied by the
-- factory reset (0209) and this table is kept, and a kept table may not point
-- at an emptied one. The id is a plain uuid. After a reset no period carries
-- an old id, so old rows are never shown again.
--
-- Safe to re-run. Rollback: supabase/rollbacks/0367_payroll_sage_compare.rollback.sql
-- ============================================================================

create table if not exists public.payroll_sage_comparisons (
  pay_period_id uuid primary key,
  entries       jsonb not null default '{}'::jsonb,
  updated_by    uuid,
  updated_at    timestamptz not null default now(),
  constraint payroll_sage_comparisons_entries_obj_chk check (jsonb_typeof(entries) = 'object')
);

alter table public.payroll_sage_comparisons enable row level security;
revoke all on table public.payroll_sage_comparisons from public, anon, authenticated;
grant select, insert, update, delete on table public.payroll_sage_comparisons to service_role;

comment on table public.payroll_sage_comparisons is
  'D248 (0367): amounts Sage produced for a pay period, typed or pasted by the owner/admin to compare with the calculated pay preview. Comparison only - never a pay record, journal or filing. Service role only.';
comment on column public.payroll_sage_comparisons.entries is
  'Object: employee id -> { paystub line key -> integer cents (hours in hundredths) }. Keys match PREVIEW_COLUMNS in src/lib/payroll/pay-preview-core.ts. CONSUMER: /admin/payroll-center/compare only.';
