-- Rollback for 0320_inbound_email_reconcile.sql (Fix Phase 3.2a · G-17 · F-04-4).
--
-- WARNING. Rows read straight from the Gmail mailbox have provider = 'gmail'.
-- The original check (resend, sendgrid) cannot be put back while any exist.
-- Before running this, look at them:
--   select id, received_at, from_address, subject, disposition, manifest_id
--   from public.inbound_email_log where provider = 'gmail';
-- A row with a manifest_id staged a real delivery: keep a copy of the query
-- result with the paperwork. Then either delete those rows (the manifests
-- they staged are NOT deleted: manifest_id is only a link) or relabel them:
--   update public.inbound_email_log set provider = 'resend' where provider = 'gmail';
-- Dropping resolved_* loses who closed each failure and why; retry_* loses the
-- fetch-again history. The audit log (Settings -> Audit log) keeps both.
-- After this rollback the Receiving page says "apply migration 0320" and the
-- mailbox check, Try again, Find an email and Resolved refuse; the webhook
-- works as before 0320.
begin;
drop index if exists public.inbound_email_log_attention_idx;
drop index if exists public.inbound_email_log_message_id_idx;
alter table public.inbound_email_log drop constraint if exists inbound_email_log_resolved_reason_chk;
alter table public.inbound_email_log drop constraint if exists inbound_email_log_retry_count_chk;
alter table public.inbound_email_log drop constraint if exists inbound_email_log_ingest_source_chk;
alter table public.inbound_email_log drop column if exists resolved_note;
alter table public.inbound_email_log drop column if exists resolved_reason;
alter table public.inbound_email_log drop column if exists resolved_by;
alter table public.inbound_email_log drop column if exists resolved_at;
alter table public.inbound_email_log drop column if exists last_retry_by;
alter table public.inbound_email_log drop column if exists last_retry_at;
alter table public.inbound_email_log drop column if exists retry_count;
alter table public.inbound_email_log drop column if exists ingest_source;
alter table public.inbound_email_log drop column if exists source_ref;
alter table public.inbound_email_log drop column if exists message_id;
alter table public.inbound_email_log drop constraint if exists inbound_email_log_provider_check;
alter table public.inbound_email_log
  add constraint inbound_email_log_provider_check check (provider in ('resend', 'sendgrid'));
commit;
notify pgrst, 'reload schema';
