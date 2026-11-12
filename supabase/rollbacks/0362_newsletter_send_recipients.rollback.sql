-- Rollback for 0362_newsletter_send_recipients.sql (D237 N-2).
-- Run MANUALLY only if needed.
--
-- Drops the per-recipient send table and its triggers. Put the code back to
-- the pre-N-2 version first: the queued sender writes to this table. Any send
-- left in status 'sending' is moved to 'failed' so the old constraint fits.
drop trigger if exists newsletter_sends_recipients_trunc on public.newsletter_sends;
drop trigger if exists newsletter_sends_recipients_del on public.newsletter_sends;
drop function if exists public.newsletter_send_recipients_on_truncate();
drop function if exists public.newsletter_send_recipients_on_delete();
drop table if exists public.newsletter_send_recipients;
drop index if exists public.idx_newsletter_sends_open;

update public.newsletter_sends set status = 'failed' where status = 'sending';
alter table public.newsletter_sends drop constraint if exists newsletter_sends_status_chk;
alter table public.newsletter_sends
  add constraint newsletter_sends_status_chk
  check (status in ('queued', 'sent', 'partial', 'failed'));
alter table public.newsletter_sends drop column if exists claimed_at;

notify pgrst, 'reload schema';
