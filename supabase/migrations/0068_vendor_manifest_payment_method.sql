-- =============================================================================
-- 0068 — Non-ACH payment methods for vendor manifest payments
-- =============================================================================
-- Owner's requirement (verbatim intent): "If I'm ever required for whatever
-- reason to write a check instead of ach, I need a way to tell the system that
-- I paid via another method. So I dont have hanging invoices."
--
-- 0067 created public.vendor_manifest_payments, but every row was implicitly an
-- ACH payment (it only had ach_batch_ref). To close out a manifest paid by
-- CHECK / CASH / WIRE / OTHER we need to (a) label HOW it was paid and (b) keep
-- a human reference (e.g. a check number or wire confirmation). This makes the
-- same over/under-pay guardrails and remaining-owed math apply regardless of the
-- payment channel, so a manifest paid by check no longer hangs as a payable.
--
-- payment_method: 'ach' (default, back-compat for existing rows) | 'check'
--   | 'cash' | 'wire' | 'other'. Enforced by a CHECK constraint.
-- reference: free text (check #, wire confirmation, memo). Distinct from
--   ach_batch_ref, which stays the NACHA draft grouping for ACH rows.
--
-- DRAFTS/RECORDS ONLY: this records that a payment happened; nothing is
-- transmitted. Amounts remain CENTS (integer minor units).
--
-- Idempotent: add-column-if-not-exists + drop-constraint-if-exists. Apply
-- MANUALLY in the Supabase SQL editor.
-- =============================================================================

-- How the payment was made. Default 'ach' so pre-existing rows keep their
-- meaning (all prior payments came from the ACH generator).
alter table public.vendor_manifest_payments
  add column if not exists payment_method text not null default 'ach';

-- Human reference for non-ACH payments (check #, wire confirmation, memo).
alter table public.vendor_manifest_payments
  add column if not exists reference text;

-- Constrain payment_method to the known set. Drop first so this is re-runnable.
alter table public.vendor_manifest_payments
  drop constraint if exists vendor_manifest_payments_payment_method_check;
alter table public.vendor_manifest_payments
  add constraint vendor_manifest_payments_payment_method_check
  check (payment_method in ('ach', 'check', 'cash', 'wire', 'other'));

-- Helpful when reporting payments by method.
create index if not exists idx_vendor_manifest_payments_method
  on public.vendor_manifest_payments(payment_method, created_at);
