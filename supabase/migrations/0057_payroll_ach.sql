-- =============================================================================
-- 0057 — Manual-entry payroll → ACH direct deposit
-- =============================================================================
-- Owner's clarified workflow (verbatim): "I will take the time card info and
-- manually input the totals into my sage software. It will produce a paystub …
-- I will then manually input into the back office the amounts owed to the
-- employee. So I will need input fields for all the totals and the routing and
-- accounting info … I don't need to make it full auto, but enhancing the
-- process so it's more efficient and quicker."
--
-- So this is NOT a Sage import. It is:
--   1. employees gains banking columns (entered once, reused every run).
--   2. ach_company_settings — the ORIGINATING bank/company block for the NACHA
--      header (Timberland Bank via Jack Henry). Admin-only. Singleton.
--   3. payroll_runs + payroll_run_lines — one run holds the manually-typed
--      per-employee totals (net/gross/taxes/deductions in CENTS) and a snapshot
--      of the banking used, plus the generated NACHA filename.
--
-- Amounts are stored in CENTS (integer minor units). Account numbers are
-- sensitive; RLS restricts them to staff, writes to admins.
--
-- Idempotent: create if not exists + drop policy/trigger if exists. Apply
-- MANUALLY in the Supabase SQL editor.
-- =============================================================================

-- ---------- employees: banking columns (entered once, reused) ---------------
alter table public.employees
  add column if not exists bank_routing        text,
  add column if not exists bank_account_number text,
  add column if not exists bank_account_type   text
        check (bank_account_type in ('checking', 'savings'));

-- ---------- ach_company_settings: originating bank/company (singleton) -------
create table if not exists public.ach_company_settings (
  id                     boolean primary key default true,
  constraint ach_company_settings_singleton check (id = true),
  -- Immediate Destination: the ORIGINATING bank's 9-digit ABA (Timberland).
  destination_routing    text not null default '',
  destination_name       text not null default '',       -- "TIMBERLAND BANK"
  -- Immediate Origin / Company Identification: typically "1" + EIN.
  immediate_origin       text not null default '',
  company_name           text not null default '',       -- your legal/DBA name
  company_id             text not null default '',
  -- Originating DFI: first 8 digits of YOUR routing at the ODFI.
  originating_dfi        text not null default '',
  -- Default statement description, e.g. "PAYROLL".
  entry_description       text not null default 'PAYROLL',
  updated_by             uuid references public.staff_profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

insert into public.ach_company_settings (id) values (true)
  on conflict (id) do nothing;

-- ---------- payroll_runs -----------------------------------------------------
create table if not exists public.payroll_runs (
  id                 uuid primary key default gen_random_uuid(),
  label              text,                                -- e.g. "Pay period ending 6/14"
  pay_date           date not null,                       -- ACH effective entry date
  status             text not null default 'draft'
                       check (status in ('draft', 'file_generated', 'submitted', 'void')),
  -- Run totals (CENTS), summed from lines at generation time.
  total_net_cents        bigint not null default 0,
  total_gross_cents      bigint not null default 0,
  total_taxes_cents      bigint not null default 0,
  total_deductions_cents bigint not null default 0,
  entry_count        integer not null default 0,
  -- NACHA output metadata.
  nacha_filename     text,
  file_id_modifier   text not null default 'A',
  generated_at       timestamptz,
  notes              text,
  created_by         uuid references public.staff_profiles(id) on delete set null,
  updated_by         uuid references public.staff_profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists payroll_runs_status_idx on public.payroll_runs (status);
create index if not exists payroll_runs_paydate_idx on public.payroll_runs (pay_date desc);

-- ---------- payroll_run_lines ------------------------------------------------
create table if not exists public.payroll_run_lines (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id        uuid references public.employees(id) on delete set null,
  employee_name      text not null,                       -- snapshot
  -- Manually-typed paystub totals (CENTS).
  net_pay_cents      bigint not null default 0,
  gross_pay_cents    bigint,
  taxes_cents        bigint,
  deductions_cents   bigint,
  -- Banking snapshot used for this run (so history stays accurate even if the
  -- employee later changes banks).
  bank_routing        text,
  bank_account_number text,
  bank_account_type   text check (bank_account_type in ('checking', 'savings')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists payroll_run_lines_run_idx on public.payroll_run_lines (run_id);

-- ---------- updated_at triggers ---------------------------------------------
drop trigger if exists trg_ach_company_settings_updated on public.ach_company_settings;
create trigger trg_ach_company_settings_updated before update on public.ach_company_settings
  for each row execute function public.set_updated_at();

drop trigger if exists trg_payroll_runs_updated on public.payroll_runs;
create trigger trg_payroll_runs_updated before update on public.payroll_runs
  for each row execute function public.set_updated_at();

drop trigger if exists trg_payroll_run_lines_updated on public.payroll_run_lines;
create trigger trg_payroll_run_lines_updated before update on public.payroll_run_lines
  for each row execute function public.set_updated_at();

-- ---------- RLS --------------------------------------------------------------
alter table public.ach_company_settings enable row level security;
alter table public.payroll_runs         enable row level security;
alter table public.payroll_run_lines    enable row level security;

-- Company settings: staff read, admin write (contains bank routing info).
drop policy if exists ach_company_settings_read on public.ach_company_settings;
create policy ach_company_settings_read on public.ach_company_settings
  for select using (public.is_staff());
drop policy if exists ach_company_settings_write on public.ach_company_settings;
create policy ach_company_settings_write on public.ach_company_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- Payroll runs + lines: admin-only (payroll is sensitive).
drop policy if exists payroll_runs_admin on public.payroll_runs;
create policy payroll_runs_admin on public.payroll_runs
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists payroll_run_lines_admin on public.payroll_run_lines;
create policy payroll_run_lines_admin on public.payroll_run_lines
  for all using (public.is_admin()) with check (public.is_admin());
