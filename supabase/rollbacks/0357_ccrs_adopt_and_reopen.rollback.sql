-- Rollback for 0357_ccrs_adopt_and_reopen.sql (D228).
--
-- Drops the two functions and puts the 0282 guard back (a set-aside email is
-- final again). The three history columns are KEPT on purpose: they hold the
-- record of every reopen (archive, never delete). They are unused by 0282.
-- Files adopted through 0357 stay in the ledger as ordinary files.
-- Idempotent.

drop function if exists public.ccrs_adopt_handmade_file(text, jsonb, timestamptz, uuid, text);
drop function if exists public.ccrs_reopen_mail(uuid, uuid, text);

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

notify pgrst, 'reload schema';
