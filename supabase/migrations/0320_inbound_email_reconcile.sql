-- 0320_inbound_email_reconcile.sql  (Fix Phase 3.2a · G-17 · F-04-4 · owner message 7)
--
-- WHY. The owner, verbatim (owner message 7):
--   "In addition to a notice when an email fails, please add a refetch button,
--    or some intelligent way to manually ask the fetcher to look again, or
--    something like that. Every manifest comes via email. So there will never
--    be a time when I have to enter the data manually. If an invoice and
--    manifest don't make it to the table and I know it's in the email account
--    because I have it open and looking at it, I need a way to ask the system
--    to grab the ones it missed or failed to get. Make it enterprise grade.
--    ... I want this table to receive every manifest, no exceptions."
-- Until now the only way a manifest email reached the table was ONE webhook
-- delivery. A delivery that never came, or that failed to read, was visible
-- only in the server log (F-04-4: SOP-04 §4.3 step 4 told staff to compare the
-- mailbox with the list by eye every morning) and could not be fetched again.
--
-- WHAT. inbound_email_log learns where each email came from and what was done
-- about a failure, so the system can (1) compare the mailbox with the table
-- every 15 minutes (reconcile), (2) fetch a failed email again (Try again),
-- (3) pull in an email the owner names (Find an email), and (4) record who
-- closed a failure and why (Resolved):
--   provider        + 'gmail' (an email read straight from the vendor_intake@
--                   Gmail mailbox when the forwarding/webhook path missed it).
--   message_id      the RFC 5322 Message-ID, the one identity an email keeps
--                   in Gmail AND in Resend, so the two sources are matched and
--                   one email never makes two rows.
--   source_ref      the id at the source (Resend email id / Gmail message id).
--   ingest_source   how the row got here: webhook / reconcile / retry / find.
--   retry_count, last_retry_at, last_retry_by   every fetch-again attempt.
--   resolved_at, resolved_by, resolved_reason, resolved_note   a failure a
--                   person closed (it leaves the Needs attention list, the
--                   row and its history stay).
--
-- SAFE / IDEMPOTENT: add column if not exists, guarded constraints, indexes if
-- not exists. Nothing is written or deleted. Apply MANUALLY in the Supabase
-- SQL editor. Before it is applied: the webhook works exactly as before (the
-- new columns are left out of every write when they are missing), the
-- Receiving page says "apply migration 0320" in the mailbox panel, and
-- Check the mailbox now / Try again / Find an email / Resolved refuse with
-- that message and change nothing.
-- FACTORY RESET: no new table (inbound_email_log is already wiped by 0209).
-- Rollback: supabase/rollbacks/0320_inbound_email_reconcile.rollback.sql (read
-- its warning first: rows read from Gmail must be deleted before the provider
-- check can be narrowed again).

begin;

alter table public.inbound_email_log
  drop constraint if exists inbound_email_log_provider_check;
alter table public.inbound_email_log
  add constraint inbound_email_log_provider_check
  check (provider in ('resend', 'sendgrid', 'gmail'));

alter table public.inbound_email_log
  add column if not exists message_id      text,
  add column if not exists source_ref      text,
  add column if not exists ingest_source   text,
  add column if not exists retry_count     integer not null default 0,
  add column if not exists last_retry_at   timestamptz,
  add column if not exists last_retry_by   uuid references public.staff_profiles(id) on delete set null,
  add column if not exists resolved_at     timestamptz,
  add column if not exists resolved_by     uuid references public.staff_profiles(id) on delete set null,
  add column if not exists resolved_reason text,
  add column if not exists resolved_note   text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inbound_email_log_ingest_source_chk') then
    alter table public.inbound_email_log
      add constraint inbound_email_log_ingest_source_chk
      check (ingest_source is null or ingest_source in ('webhook', 'reconcile', 'retry', 'find'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inbound_email_log_retry_count_chk') then
    alter table public.inbound_email_log
      add constraint inbound_email_log_retry_count_chk check (retry_count >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inbound_email_log_resolved_reason_chk') then
    alter table public.inbound_email_log
      add constraint inbound_email_log_resolved_reason_chk
      check (
        (resolved_at is null and resolved_reason is null)
        or (resolved_at is not null and resolved_reason in
            ('handled_manually', 'not_a_manifest', 'vendor_resent', 'duplicate', 'pulled_again', 'other'))
      );
  end if;
end $$;

create index if not exists inbound_email_log_message_id_idx
  on public.inbound_email_log (message_id)
  where message_id is not null;

-- The Needs attention list and the alert read: open failures only.
create index if not exists inbound_email_log_attention_idx
  on public.inbound_email_log (received_at desc)
  where resolved_at is null and disposition in ('received', 'parse_failed', 'no_manifest');

comment on column public.inbound_email_log.message_id is
  'RFC 5322 Message-ID (no angle brackets, lower case). Matches one email across Resend and Gmail. Fix Phase 3.2a (G-17).';
comment on column public.inbound_email_log.ingest_source is
  'webhook / reconcile (the 15-minute mailbox check) / retry (Try again) / find (Find an email). Fix Phase 3.2a.';
comment on column public.inbound_email_log.resolved_reason is
  'Why a person closed this failure (it leaves Needs attention; the row stays). Fix Phase 3.2a.';

commit;

notify pgrst, 'reload schema';
