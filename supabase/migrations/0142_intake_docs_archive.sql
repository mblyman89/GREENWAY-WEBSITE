-- 0142_intake_docs_archive.sql
-- SLICE 69: archive EVERY document a vendor intake email carries (manifest PDF,
-- invoice PDF, COA PDF, WCIA transfer JSON, anything else fetched) into private
-- storage, linked to the staged manifest. This is what makes the Incoming
-- (email) table's download buttons work for EVERY row, permanently - the
-- vendor's signed links expire within hours; our archived copies never do.
--
-- Idempotent: safe to run more than once.

-- ── private storage bucket for intake documents ─────────────────────────────
insert into storage.buckets (id, name, public)
values ('intake-docs', 'intake-docs', false)
on conflict (id) do nothing;

drop policy if exists intake_docs_staff_read on storage.objects;
create policy intake_docs_staff_read on storage.objects
  for select using (bucket_id = 'intake-docs' and public.is_staff());

drop policy if exists intake_docs_staff_write on storage.objects;
create policy intake_docs_staff_write on storage.objects
  for all using (bucket_id = 'intake-docs' and public.is_staff())
  with check (bucket_id = 'intake-docs' and public.is_staff());

-- ── manifest_documents: which archived file belongs to which manifest ───────
create table if not exists public.manifest_documents (
  id            uuid primary key default gen_random_uuid(),
  manifest_id   uuid not null references public.inbound_manifests(id) on delete cascade,
  -- What the document IS: the shipping manifest, the invoice, the COA, the
  -- WCIA transfer JSON, or something else the email carried.
  role          text not null check (role in ('manifest','invoice','coa','transfer-json','other')),
  filename      text not null,
  content_type  text,
  storage_path  text not null,
  bytes         integer,
  -- Where the bytes came from: a MIME attachment, a body link fetch, or the
  -- second-pass "leave no stone unturned" harvest.
  source        text not null default 'email',
  created_at    timestamptz not null default now(),
  unique (manifest_id, storage_path)
);

create index if not exists idx_manifest_documents_manifest
  on public.manifest_documents (manifest_id);

alter table public.manifest_documents enable row level security;

-- Staff may read; all writes go through the server with the service role.
drop policy if exists manifest_documents_staff_read on public.manifest_documents;
create policy manifest_documents_staff_read on public.manifest_documents
  for select using (public.is_staff());
