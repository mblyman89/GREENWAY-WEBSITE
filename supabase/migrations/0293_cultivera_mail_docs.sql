-- 0293_cultivera_mail_docs.sql  (R74 S7: the Cultivera email harvest run)
--
-- WHY. Owner (R74 round 2, #2/#5): "every Cultivera manifest was sent to
-- stephen@. Please go as far back as you are allowed to go." and "Whatever
-- Cultivera doesn't find, the email will." The harvest (Menu imports ->
-- Vendor mailbox -> "Harvest the next batch") walks that mailbox with a
-- resumable cursor and keeps every vendor document it finds: attached JSON /
-- CSV / PDF / spreadsheet files and the WCIA "Transfer Data Link" JSON the
-- Cultivera emails link to. Each file is kept privately in the pos-raw bucket
-- (mail-harvest/<mailbox>/<gmail id>/<n>-<name>), and ONE row per document is
-- kept here with what the site's own parsers read from it: the manifest
-- number, vendor, transfer date and, per line, [barcode, qty, product name,
-- inventory type, unit cost in cents]. The email match (R74 S6) places each
-- Cultivera lot that the crawler could not place by that barcode.
--
-- THE INSERT IS THE CLAIM (AGENTS rule 12). unique (mailbox, gmail_id,
-- doc_index): a doubled click or two people pressing the button store each
-- document once, and an email that has any row is never opened again. An
-- email with no vendor document gets ONE row (status no_documents) for that
-- reason. Files and rows are never deleted by the app.
--
-- WHAT CAN CHANGE. What was received never changes: mailbox, gmail id,
-- index, email date, sender, subject, file name, kind, source, storage key,
-- size and fingerprint. The parse fields may be filled later (a PDF stored
-- today is read by a later slice: status stored -> parsed | unreadable).
--
-- FACTORY RESET KEEPS IT. These are copies of vendor documents from the real
-- mailbox, not test activity; re-reading years of mail would only cost time.
--
-- RLS: staff read, admin write (same as 0282). The app writes with the
-- service role.
-- Idempotent: safe to run more than once.
-- Rollback: supabase/rollbacks/0293_cultivera_mail_docs.rollback.sql

create table if not exists public.cultivera_mail_docs (
  id              uuid primary key default gen_random_uuid(),
  mailbox         text not null,
  gmail_id        text not null,
  doc_index       integer not null,
  fetched_at      timestamptz not null default now(),
  email_at        timestamptz,
  from_header     text,
  subject         text not null default '',
  filename        text not null default '',
  kind            text not null,
  source          text not null,
  storage_key     text,
  bytes           integer,
  sha256          text,
  status          text not null,
  note            text,
  source_format   text,
  manifest_number text,
  vendor_label    text,
  vendor_license  text,
  transfer_date   text,
  line_count      integer not null default 0,
  lines           jsonb not null default '[]'::jsonb,
  barcodes        text[] not null default '{}',
  constraint cultivera_mail_docs_once unique (mailbox, gmail_id, doc_index),
  constraint cultivera_mail_docs_mailbox_ck check (mailbox = lower(mailbox) and mailbox ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'),
  constraint cultivera_mail_docs_gmail_id_ck check (gmail_id ~ '^[0-9A-Za-z_-]{6,64}$'),
  constraint cultivera_mail_docs_index_ck check (doc_index between 0 and 999),
  constraint cultivera_mail_docs_kind_ck check (kind in ('json', 'pdf', 'csv', 'xlsx', 'link-json', 'none')),
  constraint cultivera_mail_docs_source_ck check (source in ('attachment', 'link', 'email')),
  constraint cultivera_mail_docs_status_ck check (status in ('parsed', 'stored', 'unreadable', 'skipped', 'failed', 'no_documents')),
  constraint cultivera_mail_docs_format_ck check (source_format is null or source_format in ('wcia', 'generic', 'ccrs-csv', 'pdf-manifest')),
  -- A kept document has its private file; a row with no file never claims one.
  constraint cultivera_mail_docs_file_ck check (
    (status in ('parsed', 'stored', 'unreadable')) = (storage_key is not null)
    and (storage_key is null or (storage_key like 'mail-harvest/%' and bytes is not null and bytes >= 0 and sha256 ~ '^[0-9a-f]{64}$'))
  ),
  constraint cultivera_mail_docs_no_docs_ck check ((status = 'no_documents') = (kind = 'none' and source = 'email')),
  constraint cultivera_mail_docs_lines_ck check (jsonb_typeof(lines) = 'array' and line_count = jsonb_array_length(lines)),
  constraint cultivera_mail_docs_parsed_ck check (status <> 'parsed' or (line_count > 0 and source_format is not null))
);

-- The email match looks documents up by barcode.
create index if not exists cultivera_mail_docs_barcodes_idx
  on public.cultivera_mail_docs using gin (barcodes);
create index if not exists cultivera_mail_docs_recent_idx
  on public.cultivera_mail_docs (mailbox, email_at desc nulls last);
create index if not exists cultivera_mail_docs_status_idx
  on public.cultivera_mail_docs (status);

-- Guard: what was received never changes; a stored document is never deleted.
create or replace function public.cultivera_mail_docs_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'CULTIVERA_MAIL_DOC_KEPT: a harvested vendor document is never deleted';
  end if;
  if new.mailbox is distinct from old.mailbox
     or new.gmail_id is distinct from old.gmail_id
     or new.doc_index is distinct from old.doc_index
     or new.fetched_at is distinct from old.fetched_at
     or new.email_at is distinct from old.email_at
     or new.from_header is distinct from old.from_header
     or new.subject is distinct from old.subject
     or new.filename is distinct from old.filename
     or new.kind is distinct from old.kind
     or new.source is distinct from old.source
     or new.storage_key is distinct from old.storage_key
     or new.bytes is distinct from old.bytes
     or new.sha256 is distinct from old.sha256 then
    raise exception 'CULTIVERA_MAIL_DOC_IMMUTABLE: a harvested vendor document is kept as received';
  end if;
  -- Only a kept file may be (re)read: stored / unreadable / parsed move among themselves.
  if new.status is distinct from old.status
     and not (old.status in ('stored', 'unreadable', 'parsed') and new.status in ('stored', 'unreadable', 'parsed')) then
    raise exception 'CULTIVERA_MAIL_DOC_STATUS: % cannot become %', old.status, new.status;
  end if;
  return new;
end
$$;

drop trigger if exists cultivera_mail_docs_guard on public.cultivera_mail_docs;
create trigger cultivera_mail_docs_guard
  before update or delete on public.cultivera_mail_docs
  for each row execute function public.cultivera_mail_docs_guard();

alter table public.cultivera_mail_docs enable row level security;

drop policy if exists "cultivera_mail_docs staff read" on public.cultivera_mail_docs;
create policy "cultivera_mail_docs staff read" on public.cultivera_mail_docs
  for select using (public.is_staff());
drop policy if exists "cultivera_mail_docs admin write" on public.cultivera_mail_docs;
create policy "cultivera_mail_docs admin write" on public.cultivera_mail_docs
  for all using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';
