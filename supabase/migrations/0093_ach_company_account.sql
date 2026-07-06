-- =============================================================================
-- 0093_ach_company_account.sql
--
-- Adds the ORIGINATING company's own bank account fields to the
-- ach_company_settings singleton (created in 0057).
--
-- WHY: The NACHA file header does NOT carry the originator's own account
-- number (verified against the NACHA file layout — File Header + Company/Batch
-- Header records). But the value is still needed because:
--   (1) most bank ACH-upload portals ask which account funds the batch, and
--   (2) a BALANCED file needs the offsetting entry against this account.
-- That is why there was previously "nowhere to enter the account number" — the
-- schema only stored header fields. This migration adds it (plus the account
-- type) so the banking-settings page is complete.
--
-- Idempotent: add column if not exists. Apply MANUALLY in the Supabase SQL
-- editor. Account numbers are sensitive — RLS on ach_company_settings already
-- restricts this row to admins (unchanged here).
-- =============================================================================

alter table public.ach_company_settings
  add column if not exists company_account_number text not null default '',
  add column if not exists company_account_type   text not null default 'checking'
        check (company_account_type in ('checking', 'savings'));

comment on column public.ach_company_settings.company_account_number is
  'Your funding bank account number at the ODFI. Not written to the NACHA header; used for the balanced-file offset entry and your bank''s upload portal.';
comment on column public.ach_company_settings.company_account_type is
  'checking | savings — the funding account type at your originating bank.';
