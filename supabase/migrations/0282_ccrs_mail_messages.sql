-- 0282_ccrs_mail_messages.sql  (CCRS Bible v2 slice S-18a)
--
-- WHY. CCRS answers every upload by email, to the address that submitted the
-- file ("it is the email that submits the file will get confirmation and
-- error messages" [EXAM L0098]). Until now the owner pasted those emails into
-- the hub by hand. S-18a reads them from the submitting Gmail mailbox
-- (michael@greenwaymarijuana.com) every 5 minutes and keeps ONE row per
-- message here, so the hub can show it and the owner can apply it with one
-- click. Nothing here writes the ledger: Apply calls the same 0249 function
-- (ccrs_record_outcome) as the paste boxes, as the signed-in owner (standing
-- rule 3, machine output is drafts-only).
--
-- THE INSERT IS THE CLAIM (AGENTS rule 12). unique (mailbox, gmail_id): a
-- doubled cron tick inserts nothing twice, and a message already stored is
-- never fetched again.
--
-- WHAT IS KEPT. Headers that identify the message, the decoded text (capped
-- at 20,000 characters by the app), the classifier's analysis, and the CCRS
-- error CSV attachments verbatim (Apply re-reads them and proves which
-- uploaded file they answer, row by row, with classifyEcho). These are the
-- State's own answers about files the State keeps, so factory-reset KEEPs the
-- table, like ccrs_files.
--
-- A HANDLED MESSAGE STAYS HANDLED. state moves new -> applied | dismissed
-- once; the guard refuses any other update, refuses edits to what was
-- received, and refuses DELETE.
--
-- RLS: staff read, admin write (same as 0247/0248). The cron writes with the
-- service role.
-- Idempotent: safe to run more than once.
-- Rollback: supabase/rollbacks/0282_ccrs_mail_messages.rollback.sql

create table if not exists public.ccrs_mail_messages (
  id            uuid primary key default gen_random_uuid(),
  mailbox       text not null,
  gmail_id      text not null,
  thread_id     text,
  received_at   timestamptz,
  fetched_at    timestamptz not null default now(),
  from_header   text,
  subject       text not null default '',
  kind          text not null,
  env           text,
  env_verified  boolean not null default false,
  auth          text not null,
  in_spam       boolean not null default false,
  body_text     text not null default '',
  analysis      jsonb not null default '{}'::jsonb,
  csvs          jsonb not null default '[]'::jsonb,
  state         text not null default 'new',
  handled_by    uuid references public.staff_profiles(id) on delete set null,
  handled_at    timestamptz,
  handled_note  text,
  constraint ccrs_mail_messages_gmail_once unique (mailbox, gmail_id),
  constraint ccrs_mail_messages_kind_ck check (kind in ('success', 'error', 'unknown', 'not-ccrs')),
  constraint ccrs_mail_messages_env_ck check (env is null or env in ('preprod', 'prod')),
  constraint ccrs_mail_messages_auth_ck check (auth in ('aligned-pass', 'not-aligned', 'dmarc-fail', 'absent')),
  constraint ccrs_mail_messages_state_ck check (state in ('new', 'applied', 'dismissed')),
  constraint ccrs_mail_messages_handled_ck check ((state = 'new') = (handled_at is null)),
  constraint ccrs_mail_messages_csvs_ck check (jsonb_typeof(csvs) = 'array'),
  constraint ccrs_mail_messages_analysis_ck check (jsonb_typeof(analysis) = 'object')
);

create index if not exists ccrs_mail_messages_recent_idx
  on public.ccrs_mail_messages (mailbox, received_at desc nulls last);
create index if not exists ccrs_mail_messages_open_idx
  on public.ccrs_mail_messages (state) where state = 'new';

-- Guard: what was received never changes; state moves out of 'new' once; a
-- stored email is never deleted (the Gmail copy may be gone by then).
create or replace function public.ccrs_mail_messages_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'CCRS_MAIL_KEPT: a received CCRS email is never deleted';
  end if;
  if new.mailbox is distinct from old.mailbox
     or new.gmail_id is distinct from old.gmail_id
     or new.received_at is distinct from old.received_at
     or new.from_header is distinct from old.from_header
     or new.subject is distinct from old.subject
     or new.body_text is distinct from old.body_text
     or new.csvs is distinct from old.csvs then
    raise exception 'CCRS_MAIL_IMMUTABLE: a received CCRS email is kept as received';
  end if;
  if old.state <> 'new' and new.state is distinct from old.state then
    raise exception 'CCRS_MAIL_HANDLED: this email was already %', old.state;
  end if;
  return new;
end
$$;

drop trigger if exists ccrs_mail_messages_guard on public.ccrs_mail_messages;
create trigger ccrs_mail_messages_guard
  before update or delete on public.ccrs_mail_messages
  for each row execute function public.ccrs_mail_messages_guard();

alter table public.ccrs_mail_messages enable row level security;

drop policy if exists "ccrs_mail_messages staff read" on public.ccrs_mail_messages;
create policy "ccrs_mail_messages staff read" on public.ccrs_mail_messages
  for select using (public.is_staff());
drop policy if exists "ccrs_mail_messages admin write" on public.ccrs_mail_messages;
create policy "ccrs_mail_messages admin write" on public.ccrs_mail_messages
  for all using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';
