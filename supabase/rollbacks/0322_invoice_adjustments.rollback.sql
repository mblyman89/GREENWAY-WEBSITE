-- supabase/rollbacks/0322_invoice_adjustments.rollback.sql  (Fix Phase 3.4)
-- Drops the five invoice columns. Credits read from invoices and credits
-- added by hand are LOST (their timeline entries stay). Only if needed.
alter table public.inbound_manifests
  drop constraint if exists inbound_manifests_invoice_adjustments_minor_nonpos,
  drop column if exists invoice_manual_adjustments,
  drop column if exists invoice_adjustments_note,
  drop column if exists invoice_adjustments_minor,
  drop column if exists invoice_adjustments,
  drop column if exists invoice_total_minor;
