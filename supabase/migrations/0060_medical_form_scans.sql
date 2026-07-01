-- 0060_medical_form_scans.sql
-- Slice 85: efficient authorization intake. Store the SCANNED authorization form
-- (from the Canon PIXMA TS3522 flatbed) alongside each patient_authorizations
-- row so the DOH 608-048 record is complete and auditable (5-year retention,
-- WAC 314-55-090(2)). The scan is a sensitive document, so it lives in a PRIVATE
-- storage bucket readable only by staff.
--
-- Idempotent: safe to run more than once.

-- ── private storage bucket for scanned medical authorization forms ──────────
insert into storage.buckets (id, name, public)
values ('medical-forms', 'medical-forms', false)
on conflict (id) do nothing;

drop policy if exists medforms_bucket_staff_read on storage.objects;
create policy medforms_bucket_staff_read on storage.objects
  for select using (bucket_id = 'medical-forms' and public.is_staff());

drop policy if exists medforms_bucket_staff_write on storage.objects;
create policy medforms_bucket_staff_write on storage.objects
  for all using (bucket_id = 'medical-forms' and public.is_staff())
  with check (bucket_id = 'medical-forms' and public.is_staff());

-- ── attachment columns on patient_authorizations ───────────────────────────
alter table public.patient_authorizations
  add column if not exists form_scan_path text;

alter table public.patient_authorizations
  add column if not exists form_scan_filename text;

alter table public.patient_authorizations
  add column if not exists form_scan_bytes integer;

alter table public.patient_authorizations
  add column if not exists form_scan_uploaded_at timestamptz;

alter table public.patient_authorizations
  add column if not exists form_scan_uploaded_by uuid references public.staff_profiles(id);

-- ── card lifecycle: when we printed/laminated the recognition card ──────────
alter table public.patient_authorizations
  add column if not exists card_printed_at timestamptz;

create index if not exists patient_auth_scan_uploaded_idx
  on public.patient_authorizations (form_scan_uploaded_at);
