-- =============================================================================
-- Migration 0290 - R41 S17: the notice-email watch (ach_notice_mail)
-- =============================================================================
-- Timberland's ACH notices (returns, notifications of change) reach Greenway
-- two ways (Brenda, Email 3, mirrored at docs/authorities/ach/timberland-
-- brenda-2026-10-19-email-3.txt): "an email directly to you via the federal
-- reserves website and it a secure encrypted email", and the portal's
-- "reporting tab, electronic documents". The Fed's guide (mirrored at
-- docs/authorities/ach/frbservices-edi-encrypted-email-guide.txt) says the
-- email comes "from the domain name encryptedmail.achedi.com" and that the
-- report itself waits in the achedi.com portal.
--
-- The watch (src/lib/payments/ach-notice-mail-core.ts) is OFF until the owner
-- turns it on. When on, each matching Gmail message is stored here ONCE,
-- with its subject and body ENCRYPTED (encv1, src/lib/security/at-rest-
-- crypto.ts) and never parsed: the site does not read the notice, it alerts
-- the owner, who reads it in the portal and logs it on ACH operations.
--
--   ach_notice_mail
--     mailbox, gmail_id      unique together: the INSERT is the claim, so a
--                            doubled cron tick stores nothing twice.
--     from_domain            the sender's DOMAIN only (no address).
--     sender_ok, auth,       facts shown to the owner (sender matches the
--     in_spam, link_verdict, configured list; Google's DMARC result; Spam or
--     link_hosts             Trash; whether every link goes to achedi.com).
--     subject_enc, body_enc  MUST start with encv1: (NOTICE_MAIL_ENCRYPTED).
--     state                  new -> logged | not_a_notice, ONCE, by the owner
--                            or an ACTIVE admin (NOTICE_MAIL_STAFF_ONLY,
--                            NOTICE_MAIL_ONCE), with a 10-500 character note
--                            and no run of 7+ digits. Nothing else changes.
--                            Never deleted (NOTICE_MAIL_APPEND_ONLY).
--
-- The settings (on/off, senders, mailbox) live in site_settings under
-- ach_notice_mail_settings; nothing new is needed for them.
--
-- Add-only: one new table and two trigger functions. Not security definer.
-- Idempotent. Apply MANUALLY (standing rule), AFTER 0289.
-- Rollback: supabase/rollbacks/0290_ach_notice_mail.rollback.sql
-- =============================================================================

create table if not exists public.ach_notice_mail (
  id                uuid primary key default gen_random_uuid(),
  mailbox           text not null check (mailbox ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$'),
  gmail_id          text not null check (gmail_id ~ '^[0-9A-Za-z_-]{6,64}$'),
  received_at       timestamptz,
  fetched_at        timestamptz not null default now(),
  from_domain       text check (from_domain is null or from_domain ~ '^[a-z0-9.-]{4,253}$'),
  sender_ok         boolean not null,
  auth              text not null check (auth in ('pass', 'fail', 'unknown')),
  in_spam           boolean not null default false,
  link_verdict      text not null check (link_verdict in ('none', 'portal_only', 'other_hosts')),
  link_hosts        text[] not null default '{}' check (cardinality(link_hosts) <= 20),
  attachment_count  integer not null default 0 check (attachment_count between 0 and 100),
  subject_enc       text not null,
  body_enc          text not null,
  state             text not null default 'new' check (state in ('new', 'logged', 'not_a_notice')),
  handled_by        uuid references public.staff_profiles (id) on delete restrict,
  handled_at        timestamptz,
  handled_note      text check (handled_note is null or (length(trim(handled_note)) between 10 and 500 and replace(handled_note, '1-800-562-8761', '') !~ '[0-9]{7,}')),
  constraint anm_unique_message unique (mailbox, gmail_id),
  constraint anm_handled_shape check (
    (state = 'new' and handled_by is null and handled_at is null and handled_note is null)
    or (state <> 'new' and handled_by is not null and handled_at is not null and handled_note is not null)
  )
);

create index if not exists anm_new_idx on public.ach_notice_mail (received_at desc) where state = 'new';

comment on table public.ach_notice_mail is
  'R41 S17 (0290): emails that may announce a Timberland / Federal Reserve ACH notice. Subject and body encrypted (encv1), never parsed. Marked once (logged / not a notice) by the owner or an active admin; never deleted.';

create or replace function public.ach_notice_mail_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'NOTICE_MAIL_APPEND_ONLY: a notice email is never deleted.';
  end if;
  if new.subject_enc not like 'encv1:%' or new.body_enc not like 'encv1:%' then
    raise exception 'NOTICE_MAIL_ENCRYPTED: the subject and body must be stored encrypted (encv1).';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'new' then
      raise exception 'NOTICE_MAIL_ONCE: a notice email is stored as new; a person marks it later.';
    end if;
    return new;
  end if;
  -- UPDATE: only new -> logged | not_a_notice, once, by the owner or an active admin.
  if old.state <> 'new' then
    raise exception 'NOTICE_MAIL_ONCE: this email was already marked.';
  end if;
  if new.state = 'new' then
    raise exception 'NOTICE_MAIL_ONCE: the only change allowed is marking the email.';
  end if;
  if new.id <> old.id or new.mailbox <> old.mailbox or new.gmail_id <> old.gmail_id
     or new.received_at is distinct from old.received_at or new.fetched_at <> old.fetched_at
     or new.from_domain is distinct from old.from_domain or new.sender_ok <> old.sender_ok
     or new.auth <> old.auth or new.in_spam <> old.in_spam or new.link_verdict <> old.link_verdict
     or new.link_hosts <> old.link_hosts or new.attachment_count <> old.attachment_count
     or new.subject_enc <> old.subject_enc or new.body_enc <> old.body_enc then
    raise exception 'NOTICE_MAIL_APPEND_ONLY: nothing on a stored email changes except marking it.';
  end if;
  if not (
    public.ach_write_by_owner(new.handled_by)
    or (
      exists (select 1 from public.staff_profiles where id = new.handled_by and active = true and role = 'admin')
      and (auth.uid() is null or auth.uid() = new.handled_by)
    )
  ) then
    raise exception 'NOTICE_MAIL_STAFF_ONLY: only the owner or an active admin marks a notice email.';
  end if;
  if new.handled_at > now() + interval '5 minutes' or new.handled_at < now() - interval '1 day' then
    raise exception 'NOTICE_MAIL_ONCE: the handled time is the moment it is marked.';
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_notice_mail_guard on public.ach_notice_mail;
create trigger trg_ach_notice_mail_guard
  before insert or update or delete on public.ach_notice_mail
  for each row execute function public.ach_notice_mail_guard();

create or replace function public.ach_notice_mail_no_truncate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'NOTICE_MAIL_APPEND_ONLY: the notice emails are never truncated.';
end $$;

drop trigger if exists trg_ach_notice_mail_no_truncate on public.ach_notice_mail;
create trigger trg_ach_notice_mail_no_truncate
  before truncate on public.ach_notice_mail
  for each statement execute function public.ach_notice_mail_no_truncate();

alter table public.ach_notice_mail enable row level security;

drop policy if exists ach_notice_mail_admin_read on public.ach_notice_mail;
create policy ach_notice_mail_admin_read on public.ach_notice_mail
  for select using (public.is_admin());

revoke all on table public.ach_notice_mail from anon;
revoke all on table public.ach_notice_mail from authenticated;
grant select on table public.ach_notice_mail to authenticated;
revoke delete, truncate on table public.ach_notice_mail from service_role;
grant select, insert, update on table public.ach_notice_mail to service_role;

revoke all on function public.ach_notice_mail_guard() from public, anon, authenticated;
revoke all on function public.ach_notice_mail_no_truncate() from public, anon, authenticated;
