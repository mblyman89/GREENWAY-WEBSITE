do $precheck$begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0199 gates the year-to-date accumulators on is_owner(), which does not exist yet. Run 0185_books_owner_only.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regprocedure('public.set_updated_at()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0199 attaches an updated_at trigger that calls set_updated_at(), which does not exist yet. Run 0001_slice1_foundation.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.employees') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0199 keys every year-to-date accumulator to public.employees, which does not exist yet. Run 0037_staffing_timeclock.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.payroll_run_lines') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0199 splits the single taxes_cents column on public.payroll_run_lines into per-tax columns, and that table does not exist yet. Run 0057_payroll_ach.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.payroll_runs') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0199 records which pay run last fed each accumulator by pointing at public.payroll_runs, which does not exist yet. Run 0057_payroll_ach.sql first, then run this file again. Nothing was changed.';
  end if;
end
$precheck$;

alter table public.payroll_run_lines add column if not exists federal_income_tax_cents bigint;
alter table public.payroll_run_lines add column if not exists oasdi_employee_cents      bigint;
alter table public.payroll_run_lines add column if not exists medicare_employee_cents   bigint;

alter table public.payroll_run_lines add column if not exists addl_medicare_employee_cents bigint;

alter table public.payroll_run_lines add column if not exists wa_pfml_employee_cents  bigint;
alter table public.payroll_run_lines add column if not exists wa_cares_employee_cents bigint;

alter table public.payroll_run_lines add column if not exists wa_lni_employee_cents   bigint;

alter table public.payroll_run_lines add column if not exists oasdi_employer_cents    bigint;
alter table public.payroll_run_lines add column if not exists medicare_employer_cents bigint;
alter table public.payroll_run_lines add column if not exists futa_employer_cents     bigint;
alter table public.payroll_run_lines add column if not exists wa_suta_employer_cents  bigint;
alter table public.payroll_run_lines add column if not exists wa_pfml_employer_cents  bigint;
alter table public.payroll_run_lines add column if not exists wa_lni_employer_cents   bigint;

alter table public.payroll_run_lines add column if not exists oasdi_wages_cents    bigint;
alter table public.payroll_run_lines add column if not exists medicare_wages_cents bigint;
alter table public.payroll_run_lines add column if not exists futa_wages_cents     bigint;
alter table public.payroll_run_lines add column if not exists wa_suta_wages_cents  bigint;
alter table public.payroll_run_lines add column if not exists wa_pfml_wages_cents  bigint;
alter table public.payroll_run_lines add column if not exists wa_cares_wages_cents bigint;

alter table public.payroll_run_lines add column if not exists lni_hundredth_hours  bigint;

comment on column public.payroll_run_lines.taxes_cents is

  'books-34: SUPERSEDED but deliberately retained. Historical rows hold a single manually-typed total whose per-tax detail was never recorded and cannot be reconstructed. New rows populate the per-tax columns. This column stays for those older rows and for readers written before 0199.';
comment on column public.payroll_run_lines.addl_medicare_employee_cents is
  'books-34: Additional Medicare Tax (0.9% above $200,000 YTD). Kept separate from medicare_employee_cents because THE EMPLOYER DOES NOT MATCH IT.';
comment on column public.payroll_run_lines.oasdi_wages_cents is
  'books-34: social security WAGES for this line, already truncated at the annual wage base. W-2 box 3 is built from the sum of these, not from gross pay.';

create table if not exists public.payroll_ytd_accumulators (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,

  tax_year    integer not null check (tax_year between 2020 and 2100),

  oasdi_wages_cents    bigint not null default 0,

  medicare_wages_cents bigint not null default 0,
  futa_wages_cents     bigint not null default 0,
  wa_suta_wages_cents  bigint not null default 0,
  wa_pfml_wages_cents  bigint not null default 0,
  wa_cares_wages_cents bigint not null default 0,

  lni_hundredth_hours  bigint not null default 0,

  oasdi_employee_cents         bigint not null default 0,
  medicare_employee_cents      bigint not null default 0,
  addl_medicare_employee_cents bigint not null default 0,
  federal_income_tax_cents     bigint not null default 0,

  last_run_id        uuid references public.payroll_runs(id) on delete set null,
  last_recomputed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payroll_ytd_one_row_per_employee_year unique (employee_id, tax_year),

  constraint payroll_ytd_medicare_ge_oasdi
    check (medicare_wages_cents >= oasdi_wages_cents),

  constraint payroll_ytd_no_oasdi_tax_without_wages
    check (oasdi_employee_cents = 0 or oasdi_wages_cents > 0),

  constraint payroll_ytd_no_medicare_tax_without_wages
    check (medicare_employee_cents = 0 or medicare_wages_cents > 0),

  constraint payroll_ytd_sane_magnitude
    check (
      oasdi_wages_cents    between 0 and 10000000000 and
      medicare_wages_cents between 0 and 10000000000 and
      futa_wages_cents     between 0 and 10000000000 and
      wa_suta_wages_cents  between 0 and 10000000000 and
      wa_pfml_wages_cents  between 0 and 10000000000 and
      wa_cares_wages_cents between 0 and 10000000000
    ),

  constraint payroll_ytd_no_negative_taxes
    check (
      oasdi_employee_cents         >= 0 and
      medicare_employee_cents      >= 0 and
      addl_medicare_employee_cents >= 0 and
      federal_income_tax_cents     >= 0
    ),

  constraint payroll_ytd_no_negative_hours
    check (lni_hundredth_hours >= 0),

  constraint payroll_ytd_futa_within_base
    check (futa_wages_cents <= 700000)
);

comment on table public.payroll_ytd_accumulators is
  'books-34: per employee, per calendar year running totals. Exists because every wage-base ceiling and the Additional Medicare threshold are ANNUAL tests that no single pay period can evaluate. Derived from payroll_run_lines. Drift is detectable via last_recomputed_at and repaired by recomputation, never by silent overwrite.';
comment on column public.payroll_ytd_accumulators.tax_year is
  'books-34: CALENDAR year. Every ceiling this table enforces is defined on the calendar year, and the W-2 is a calendar-year document.';
comment on column public.payroll_ytd_accumulators.medicare_wages_cents is
  'books-34: Medicare wages have NO annual ceiling. Kept separate from oasdi_wages_cents for exactly that reason.';
comment on column public.payroll_ytd_accumulators.lni_hundredth_hours is
  'books-34: HUNDREDTH-HOURS (4000 = 40.00 hours), not cents. L&I premiums are assessed on hours worked rather than wages.';

create index if not exists payroll_ytd_accumulators_year_idx
  on public.payroll_ytd_accumulators (tax_year, employee_id);

drop trigger if exists payroll_ytd_accumulators_set_updated_at on public.payroll_ytd_accumulators;
create trigger payroll_ytd_accumulators_set_updated_at
  before update on public.payroll_ytd_accumulators
  for each row execute function public.set_updated_at();

alter table public.payroll_ytd_accumulators enable row level security;

do $rls$begin
  drop policy if exists payroll_ytd_accumulators_select on public.payroll_ytd_accumulators;
  execute 'create policy payroll_ytd_accumulators_select on public.payroll_ytd_accumulators for select using (public.is_owner())';

  drop policy if exists payroll_ytd_accumulators_insert on public.payroll_ytd_accumulators;
  execute 'create policy payroll_ytd_accumulators_insert on public.payroll_ytd_accumulators for insert with check (public.is_owner())';

  drop policy if exists payroll_ytd_accumulators_update on public.payroll_ytd_accumulators;
  execute 'create policy payroll_ytd_accumulators_update on public.payroll_ytd_accumulators for update using (public.is_owner()) with check (public.is_owner())';

  drop policy if exists payroll_ytd_accumulators_delete on public.payroll_ytd_accumulators;
  execute 'create policy payroll_ytd_accumulators_delete on public.payroll_ytd_accumulators for delete using (public.is_owner())';
end
$rls$;
