-- =============================================================================
-- 0031_ccrs_license_export.sql  (Run 4 / Slice 17)
--
-- CCRS (WA Cannabis Central Reporting System) sales export support.
--
-- CCRS is CSV-UPLOAD ONLY (no API), reported weekly (Sun–Sat, due Sunday). The
-- Sale.csv requires, per line:
--   * LicenseNumber (your 6-digit retail license)
--   * InventoryExternalIdentifier (must already exist in CCRS inventory)
--   * SaleExternalIdentifier (one per sale/transaction)
--   * SaleDetailExternalIdentifier (unique per line within a sale)
--   * 37% CannabisExciseTax (cannabis retail), combined 9.3% SalesTax, etc.
--
-- This migration adds:
--   1. license_settings  — singleton holding the license number + SubmittedBy
--      name + default CreatedBy actor used in the export header/rows.
--   2. order_lines.ccrs_inventory_external_id — optional override of the
--      InventoryExternalIdentifier for a line (defaults to product_id at export
--      time when null). Stable external ids for sale/detail are derived from the
--      order_number + line id at export time (deterministic, idempotent).
--   3. ccrs_export_batches — audit log of generated CCRS files (filename, range,
--      record count, generated_by, operation) so we can track what was reported.
--
-- All idempotent: safe to re-run in the Supabase SQL editor.
-- =============================================================================

-- 1) License / reporting identity ---------------------------------------------
create table if not exists public.license_settings (
  id               boolean primary key default true,
  -- WA retail cannabis license number (6 digits in CCRS, stored as text to keep
  -- any leading zeros intact).
  license_number   text not null default '',
  -- Name shown as SubmittedBy / CreatedBy in the CCRS file (text, max 35).
  submitted_by     text not null default '',
  -- Optional: default UBI / trade name for reference (not exported).
  trade_name       text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint license_settings_singleton check (id = true)
);

-- 2) Per-line CCRS inventory id override --------------------------------------
alter table public.order_lines
  add column if not exists ccrs_inventory_external_id text;

-- 3) Export audit log ----------------------------------------------------------
create table if not exists public.ccrs_export_batches (
  id               uuid primary key default gen_random_uuid(),
  file_name        text not null,
  range_from       timestamptz not null,
  range_to         timestamptz not null,
  record_count     integer not null default 0,
  operation        text not null default 'Insert',   -- Insert | Update | Delete
  generated_by     uuid references public.staff_profiles(id) on delete set null,
  notes            text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_ccrs_export_batches_created
  on public.ccrs_export_batches(created_at desc);

-- updated_at trigger for license_settings -------------------------------------
drop trigger if exists trg_license_settings_updated on public.license_settings;
create trigger trg_license_settings_updated
  before update on public.license_settings
  for each row execute function public.set_updated_at();

-- Seed the singleton row (idempotent). Owner fills in the license number in the
-- back office Accounting/Compliance settings.
insert into public.license_settings (id, license_number, submitted_by)
values (true, '', '')
on conflict (id) do nothing;

-- RLS --------------------------------------------------------------------------
alter table public.license_settings enable row level security;
alter table public.ccrs_export_batches enable row level security;

drop policy if exists "license_settings staff read" on public.license_settings;
create policy "license_settings staff read" on public.license_settings
  for select using (public.is_staff());

drop policy if exists "license_settings admin write" on public.license_settings;
create policy "license_settings admin write" on public.license_settings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "ccrs_export_batches staff read" on public.ccrs_export_batches;
create policy "ccrs_export_batches staff read" on public.ccrs_export_batches
  for select using (public.is_staff());

drop policy if exists "ccrs_export_batches admin write" on public.ccrs_export_batches;
create policy "ccrs_export_batches admin write" on public.ccrs_export_batches
  for all using (public.is_admin()) with check (public.is_admin());
