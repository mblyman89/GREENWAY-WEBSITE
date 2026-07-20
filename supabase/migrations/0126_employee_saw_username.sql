-- 0126_employee_saw_username.sql
-- Slice 6 — SAW username prefill for the DOH medical-verification step.
--
-- Stores each employee's SecureAccess Washington (SAW) *username only* so the
-- register can SHOW the signed-in budtender their own SAW login at the medical
-- card-verification step (one-tap "copy username" + "open SAW"). This removes
-- the "which login is this / where are the credentials?" fumble during a rare
-- medical sale while keeping the audit trail per-person.
--
-- SECURITY: this column holds the USERNAME ONLY. Passwords are NEVER stored
-- here (or anywhere in this app) — SAW's own multi-factor login (the code sent
-- to the employee's phone) finishes authentication. Do not add a password
-- column; that would centralize master state-government credentials and break
-- the per-person DOH audit trail.
--
-- Apply MANUALLY (owner runs this in Supabase SQL editor). Idempotent.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS saw_username text;

COMMENT ON COLUMN public.employees.saw_username IS
  'SecureAccess Washington (SAW) username ONLY — used to pre-show the correct login at the POS medical-verification step. NEVER store a SAW password here.';
