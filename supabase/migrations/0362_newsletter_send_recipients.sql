-- ============================================================================
-- 0362 - NEWSLETTER SEND RECIPIENTS  (D237, SOP-22 N-2, G-112)
--
-- WHY. A broadcast ran inside the one request that pressed Send: 5 at a time,
-- one email per call. If the browser or the server stopped part-way, the
-- newsletter_sends row stayed "queued" and nobody knew who got it (F-22-3).
-- Owner, verbatim (D237): "I approve all from serious to small along with
-- your recommendations".
--
-- WHAT.
--   public.newsletter_send_recipients: one row per address per broadcast,
--   with its batch number, status (pending, sent, failed), the Resend id and
--   the error. The worker sends 100 per Resend batch call with an
--   Idempotency-Key made from (send, batch, round), so a resumed or doubled
--   run never sends the same email twice. "Retry failed" moves failed rows
--   back to pending with round + 1.
--   newsletter_sends gets claimed_at (the worker lease) and the status
--   'sending'.
--
-- RESET. No foreign key (send_id is a plain uuid), so the factory reset's
-- "no kept table points into a wiped table" check is not touched. The table
-- is KEEP in the reset core and is emptied together with newsletter_sends by
-- its own AFTER TRUNCATE trigger (the 0344 product_latest_facts pattern), so
-- the pinned WIPE list in 0240 is not reopened. Deleting a send row deletes
-- its recipient rows too.
--
-- Service role only, RLS on. Idempotent: safe to run more than once.
-- ROLLBACK: supabase/rollbacks/0362_newsletter_send_recipients.rollback.sql
-- ============================================================================

create table if not exists public.newsletter_send_recipients (
  id                 uuid primary key default gen_random_uuid(),
  send_id            uuid not null,
  email              text not null,
  unsubscribe_token  text,
  batch_no           integer not null,
  round              integer not null default 0,
  tries              integer not null default 0,
  status             text not null default 'pending',
  resend_id          text,
  error              text,
  sent_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint newsletter_send_recipients_send_email_key unique (send_id, email),
  constraint newsletter_send_recipients_status_chk check (status in ('pending', 'sent', 'failed')),
  constraint newsletter_send_recipients_email_chk check (length(btrim(email)) between 3 and 320),
  constraint newsletter_send_recipients_batch_chk check (batch_no >= 0),
  constraint newsletter_send_recipients_round_chk check (round >= 0 and tries >= 0),
  constraint newsletter_send_recipients_error_chk check (error is null or length(error) <= 500)
);

create index if not exists idx_newsletter_send_recipients_pending
  on public.newsletter_send_recipients (send_id, batch_no) where status = 'pending';

create index if not exists idx_newsletter_send_recipients_send_status
  on public.newsletter_send_recipients (send_id, status);

alter table public.newsletter_send_recipients enable row level security;
revoke all on table public.newsletter_send_recipients from public, anon, authenticated;
grant select, insert, update, delete on table public.newsletter_send_recipients to service_role;

comment on table public.newsletter_send_recipients is
  'D237 N-2 (0362): one row per address per newsletter broadcast (batch, status, Resend id). Sent 100 per batch with an Idempotency-Key. Emptied with newsletter_sends. Service role only.';

-- newsletter_sends: worker lease + the sending status --------------------------
alter table public.newsletter_sends add column if not exists claimed_at timestamptz;

alter table public.newsletter_sends drop constraint if exists newsletter_sends_status_chk;
alter table public.newsletter_sends
  add constraint newsletter_sends_status_chk
  check (status in ('queued', 'sending', 'sent', 'partial', 'failed'));

create index if not exists idx_newsletter_sends_open
  on public.newsletter_sends (created_at) where status in ('queued', 'sending');

-- Emptied with newsletter_sends ---------------------------------------------
create or replace function public.newsletter_send_recipients_on_truncate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  truncate table public.newsletter_send_recipients;
  return null;
end;
$$;

comment on function public.newsletter_send_recipients_on_truncate() is
  '0362 (D237 N-2): AFTER TRUNCATE on newsletter_sends (the factory reset, 0240) empties newsletter_send_recipients.';

revoke all on function public.newsletter_send_recipients_on_truncate() from public, anon, authenticated, service_role;

drop trigger if exists newsletter_sends_recipients_trunc on public.newsletter_sends;
create trigger newsletter_sends_recipients_trunc
  after truncate on public.newsletter_sends
  for each statement execute function public.newsletter_send_recipients_on_truncate();

create or replace function public.newsletter_send_recipients_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.newsletter_send_recipients r
   using old_rows o
   where r.send_id = o.id;
  return null;
end;
$$;

comment on function public.newsletter_send_recipients_on_delete() is
  '0362 (D237 N-2): deleting newsletter_sends rows deletes their recipient rows.';

revoke all on function public.newsletter_send_recipients_on_delete() from public, anon, authenticated, service_role;

drop trigger if exists newsletter_sends_recipients_del on public.newsletter_sends;
create trigger newsletter_sends_recipients_del
  after delete on public.newsletter_sends
  referencing old table as old_rows
  for each statement execute function public.newsletter_send_recipients_on_delete();

notify pgrst, 'reload schema';
