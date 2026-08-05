-- =============================================================================
-- 0153_excise_return_sent_tracking.sql
--
-- Adds "sent to WSLCB" tracking to the LIQ-1295 draft so each month is tracked
-- filed -> SENT -> paid. The "Send to WSLCB" button emails the completed
-- LIQ-1295 to cannabistaxes@lcb.wa.gov (cc contact@greenwaymarijuana.com) via
-- Resend; on success we stamp these columns and the button shows "Sent on <date>".
--
-- Columns added to public.excise_return_drafts (all nullable — a never-sent
-- return simply has them null):
--   sent_at          timestamptz  — when the submission email was accepted
--   sent_by          uuid         — staff member who sent it
--   sent_to          text         — destination address (cannabistaxes@lcb.wa.gov)
--   sent_cc          text         — cc address (contact@greenwaymarijuana.com)
--   sent_from        text         — verified sender used
--   sent_message_id  text         — Resend message id (for support/audit)
--   sent_file_name   text         — the LIQ-1295 file name that was attached
--
-- Idempotent (add column if not exists). Apply MANUALLY in the Supabase SQL editor.
-- =============================================================================

alter table public.excise_return_drafts
  add column if not exists sent_at         timestamptz,
  add column if not exists sent_by         uuid references public.staff_profiles(id) on delete set null,
  add column if not exists sent_to         text,
  add column if not exists sent_cc         text,
  add column if not exists sent_from       text,
  add column if not exists sent_message_id text,
  add column if not exists sent_file_name  text;

comment on column public.excise_return_drafts.sent_at is
  'When the LIQ-1295 submission email to the WSLCB was accepted by the mail provider.';
comment on column public.excise_return_drafts.sent_message_id is
  'Resend message id for the submission email (support/audit trail).';
