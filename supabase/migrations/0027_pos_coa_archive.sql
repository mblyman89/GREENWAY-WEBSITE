-- 0027_pos_coa_archive.sql
-- Slice 9: archive each COA PDF into private storage so the certificates are
-- kept on hand as part of our records (LCB enforcement can ask to see them).
-- We keep the file even if the vendor's link later expires.
--
-- Idempotent: safe to run more than once.

-- ── private storage bucket for COA PDFs ────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('coa', 'coa', false)
on conflict (id) do nothing;

drop policy if exists coa_bucket_staff_read on storage.objects;
create policy coa_bucket_staff_read on storage.objects
  for select using (bucket_id = 'coa' and public.is_staff());

drop policy if exists coa_bucket_staff_write on storage.objects;
create policy coa_bucket_staff_write on storage.objects
  for all using (bucket_id = 'coa' and public.is_staff())
  with check (bucket_id = 'coa' and public.is_staff());

-- ── lab_results: where the archived PDF lives + when we grabbed it ──────────
alter table public.lab_results
  add column if not exists coa_storage_path text;

alter table public.lab_results
  add column if not exists coa_archived_at timestamptz;

-- Number of bytes archived (sanity / display).
alter table public.lab_results
  add column if not exists coa_file_bytes integer;

create index if not exists lab_results_coa_archived_idx
  on public.lab_results (coa_archived_at);
