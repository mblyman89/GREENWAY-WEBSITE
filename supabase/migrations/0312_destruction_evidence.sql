-- 0312_destruction_evidence.sql  (Fix Phase 1.7a · G-43 req 7 · owner message 4)
--
-- WHY. G-43 requirement 7 ("Optional photo upload of the rendered mixture")
-- was not built in Phase 1.6a. Owner (message 4): "please build the photo
-- upload (G-43), as well as a video upload just in case." A destruction
-- record is kept five years (WAC 314-55-097), so the evidence is kept with it.
--
-- WHAT.
--   storage bucket destruction-evidence   PRIVATE (public = false). The
--                                         `media` bucket is public, so it is
--                                         never used for evidence. No
--                                         storage.objects policy is created:
--                                         only the server (service role)
--                                         signs uploads and short-lived
--                                         viewing links.
--   destruction_evidence                  one row per verified photo or
--                                         video. Written by the server only
--                                         AFTER the file's size, type and
--                                         first bytes were checked in
--                                         Storage. APPEND-ONLY: a trigger
--                                         refuses UPDATE and DELETE (an
--                                         evidence record is never altered).
--
-- destruction_event_id is a plain uuid with NO foreign key: this table is
-- KEEP in the factory reset (five-year destruction record) while
-- destruction_events is WIPE, and a KEEP table may not reference a WIPE
-- table (same rule as recall_event_lots.lot_id in 0311).
--
-- SAFE / IDEMPOTENT: create ... if not exists, on conflict do nothing, the
-- bucket limits set only when the columns exist. No existing data changes.
-- Row level security is enabled with no policies. Apply MANUALLY in the SQL
-- editor after 0311. Before it is applied the upload panel says the
-- migration is pending and refuses (nothing is written).

create table if not exists public.destruction_evidence (
  id                   uuid primary key default gen_random_uuid(),
  destruction_event_id uuid not null,
  kind                 text not null check (kind in ('photo', 'video')),
  storage_key          text not null unique check (storage_key like 'events/%'),
  filename             text not null check (length(filename) between 1 and 200),
  mime                 text not null check (mime in (
                         'image/jpeg', 'image/png', 'image/webp', 'image/heic',
                         'video/mp4', 'video/webm', 'video/quicktime')),
  size_bytes           bigint not null check (size_bytes > 0),
  note                 text check (note is null or length(note) <= 500),
  uploaded_by          uuid references public.staff_profiles (id) on delete set null,
  uploaded_by_name     text,
  uploaded_at          timestamptz not null default now()
);
create index if not exists idx_destruction_evidence_event
  on public.destruction_evidence (destruction_event_id, uploaded_at);

alter table public.destruction_evidence enable row level security;

create or replace function public.destruction_evidence_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'DESTRUCTION_EVIDENCE_APPEND_ONLY: destruction evidence % cannot be changed or deleted (kept five years, WAC 314-55-097).', old.id;
end $$;

drop trigger if exists trg_destruction_evidence_append_only on public.destruction_evidence;
create trigger trg_destruction_evidence_append_only
  before update or delete on public.destruction_evidence
  for each row execute function public.destruction_evidence_append_only();

insert into storage.buckets (id, name, public)
values ('destruction-evidence', 'destruction-evidence', false)
on conflict (id) do nothing;

do $m$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute 'update storage.buckets set file_size_limit = 209715200 where id = ''destruction-evidence''';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute 'update storage.buckets set allowed_mime_types = array[''image/jpeg'', ''image/png'', ''image/webp'', ''image/heic'', ''video/mp4'', ''video/webm'', ''video/quicktime''] where id = ''destruction-evidence''';
  end if;
end
$m$;
