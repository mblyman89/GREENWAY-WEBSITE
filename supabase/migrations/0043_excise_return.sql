-- =============================================================================
-- 0043_excise_return.sql  (Run 6 / Slice 32)
--
-- Cannabis excise tax return (FORM LIQ-1295) support — Feature B.
--   • Extend license_settings with the store location fields the LIQ-1295 needs.
--   • Log every generated/filed return for the audit trail.
--
-- Idempotent. Apply MANUALLY in the Supabase SQL editor.
-- =============================================================================

-- Location fields for the LIQ-1295 header (store address, not mailing).
alter table public.license_settings
  add column if not exists location_address text,
  add column if not exists city text,
  add column if not exists contact_phone text,
  add column if not exists contact_email text;

-- ── excise_return_batches ───────────────────────────────────────────────────
create table if not exists public.excise_return_batches (
  id                     uuid primary key default gen_random_uuid(),
  report_month           integer not null check (report_month between 1 and 12),
  report_year            integer not null,
  file_name              text not null,
  -- Snapshot of the computed boxes (dollars) for the record.
  cannabis_sales         numeric not null default 0,   -- box 1
  exempt_medical_sales   numeric not null default 0,   -- box 2 magnitude
  taxable_sales          numeric not null default 0,   -- box 3
  calculated_excise      numeric not null default 0,   -- box 5
  additional_excise      numeric not null default 0,   -- box 6
  amount_to_pay          numeric not null default 0,   -- box 10
  no_sales               boolean not null default false,
  due_date               date,
  -- 'generated' when the file is downloaded; 'emailed' when sent to LCB.
  status                 text not null default 'generated',
  emailed_to             text,
  emailed_at             timestamptz,
  generated_by           uuid references public.staff_profiles(id) on delete set null,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists excise_return_batches_period_idx
  on public.excise_return_batches (report_year, report_month);
create index if not exists excise_return_batches_created_idx
  on public.excise_return_batches (created_at);

drop trigger if exists excise_return_batches_set_updated_at on public.excise_return_batches;
create trigger excise_return_batches_set_updated_at
  before update on public.excise_return_batches
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS — STAFF read, ADMIN write (regulatory filing record).
-- =============================================================================
alter table public.excise_return_batches enable row level security;

drop policy if exists excise_return_batches_staff_read on public.excise_return_batches;
create policy excise_return_batches_staff_read on public.excise_return_batches
  for select using (public.is_staff());

drop policy if exists excise_return_batches_admin_write on public.excise_return_batches;
create policy excise_return_batches_admin_write on public.excise_return_batches
  for all using (public.is_admin()) with check (public.is_admin());
