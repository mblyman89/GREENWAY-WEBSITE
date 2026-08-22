do $precheck$begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0197 gates the pay calendar on is_owner(), which does not exist yet. Run 0185_books_owner_only.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.company_profile') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0197 adds the workweek anchor to public.company_profile, which does not exist yet. Run 0196_company_profile.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.employees') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0197 adds the FLSA exemption flag to public.employees, which does not exist yet. Run 0037_staffing.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.time_punches') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0197 builds the pay calendar that clock punches are gathered into, and public.time_punches does not exist yet. Run 0037_staffing.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.employee_pay') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0197 audits the pay calendar against employee pay records, and public.employee_pay does not exist yet. Run 0195_employee_payroll_setup.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.staff_profiles') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0197 records WHO approved a pay period by pointing at public.staff_profiles, which does not exist yet. Run 0001_slice1_foundation.sql first, then run this file again. Nothing was changed.';
  end if;
end
$precheck$;

alter table public.company_profile
  add column if not exists workweek_starts_on smallint;

do $ck$begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_profile_workweek_starts_on_chk'
      and conrelid = 'public.company_profile'::regclass
  ) then
    alter table public.company_profile
      add constraint company_profile_workweek_starts_on_chk
      check (workweek_starts_on is null
             or workweek_starts_on between 0 and 6);
  end if;
end
$ck$;

alter table public.company_profile
  add column if not exists workweek_starts_at_hour smallint not null default 0;

do $ck$begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_profile_workweek_hour_chk'
      and conrelid = 'public.company_profile'::regclass
  ) then
    alter table public.company_profile
      add constraint company_profile_workweek_hour_chk
      check (workweek_starts_at_hour between 0 and 23);
  end if;
end
$ck$;

alter table public.company_profile
  add column if not exists workweek_effective_date date;

alter table public.employees
  add column if not exists flsa_status text not null default 'non_exempt';

do $ck$begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'employees_flsa_status_chk'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_flsa_status_chk
      check (flsa_status in ('non_exempt', 'exempt'));
  end if;
end
$ck$;

alter table public.employees
  add column if not exists flsa_exempt_reason text;

do $ck$begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'employees_flsa_exempt_reason_chk'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_flsa_exempt_reason_chk
      check (
        flsa_status <> 'exempt'
        or (flsa_exempt_reason is not null
            and length(btrim(flsa_exempt_reason)) >= 10)
      );
  end if;
end
$ck$;

create table if not exists public.pay_periods (
  id uuid primary key default gen_random_uuid(),

  label text not null,

  start_date date not null,
  end_date   date not null,

  pay_date date not null,

  pay_frequency text not null
    check (pay_frequency in ('weekly','biweekly','semimonthly',
                             'monthly','quarterly','semiannually',
                             'annually','daily')),

  quarter smallint not null check (quarter between 1 and 4),

  tax_year smallint not null check (tax_year between 2000 and 2200),

  status text not null default 'planned'
    check (status in ('planned', 'approved', 'locked')),

  approved_by uuid references public.staff_profiles(id) on delete set null,
  approved_at timestamptz,

  locked_at timestamptz,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pay_periods_date_order_chk
    check (end_date >= start_date),

  constraint pay_periods_pay_after_end_chk
    check (pay_date >= end_date),

  constraint pay_periods_approval_shape_chk
    check (
      (status = 'planned' and approved_by is null and approved_at is null)
      or (status in ('approved','locked')
          and approved_by is not null and approved_at is not null)
    ),

  constraint pay_periods_lock_shape_chk
    check ((status = 'locked') = (locked_at is not null))
);

create extension if not exists btree_gist;

do $ex$begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pay_periods_no_overlap_excl'
      and conrelid = 'public.pay_periods'::regclass
  ) then
    alter table public.pay_periods
      add constraint pay_periods_no_overlap_excl
      exclude using gist (
        pay_frequency with =,
        daterange(start_date, end_date, '[]') with &&
      );
  end if;
end
$ex$;

create index if not exists pay_periods_pay_date_idx
  on public.pay_periods (pay_date);
create index if not exists pay_periods_year_quarter_idx
  on public.pay_periods (tax_year, quarter);
create index if not exists pay_periods_status_idx
  on public.pay_periods (status);

drop trigger if exists pay_periods_set_updated_at on public.pay_periods;
create trigger pay_periods_set_updated_at
  before update on public.pay_periods
  for each row execute function public.set_updated_at();

alter table public.pay_periods enable row level security;

do $rls$begin
  drop policy if exists pay_periods_select on public.pay_periods;
  execute 'create policy pay_periods_select on public.pay_periods for select using (public.is_owner())';

  drop policy if exists pay_periods_insert on public.pay_periods;
  execute 'create policy pay_periods_insert on public.pay_periods for insert with check (public.is_owner())';

  drop policy if exists pay_periods_update on public.pay_periods;
  execute 'create policy pay_periods_update on public.pay_periods for update using (public.is_owner()) with check (public.is_owner())';

end
$rls$;

grant select, insert, update on public.pay_periods to authenticated;

comment on column public.company_profile.workweek_starts_on is
  'Day the fixed 168-hour workweek begins. 0=Sunday, 1=Monday .. 6=Saturday. NULL means UNANSWERED and the overtime engine refuses to compute until it is set - it is not permitted to guess. CONSUMERS: timesheet-core.ts splits every pay period into workweek buckets on this boundary. Overtime calculation, since the 40-hour threshold applies per workweek. The L and I quarterly hours report. Any future FLSA records request. AUTHORITY: 29 CFR 778.105 - the workweek is a fixed and regularly recurring period of 168 hours which may begin on any day and at any hour, and once established it remains fixed regardless of the schedule of hours worked.';

comment on column public.company_profile.workweek_starts_at_hour is
  'Hour of the day the workweek begins, 0 to 23, Pacific wall clock. Defaults to 0 (midnight). CONSUMERS: timesheet-core.ts workweek bucketing, for shifts that cross the boundary. AUTHORITY: 29 CFR 778.105 expressly permits a workweek to begin at any hour of the day, which matters for a retailer whose closing shift ends after 11pm.';

comment on column public.company_profile.workweek_effective_date is
  'Date the current workweek definition took effect. CONSUMERS: audit trail for any change of workweek. AUTHORITY: 29 CFR 778.105 requires the workweek to remain fixed once established. A change must be intended to be permanent and not designed to evade overtime, so the date it changed is the fact that makes that reviewable.';

comment on column public.employees.flsa_status is
  'Overtime eligibility. non_exempt (the default) means overtime is owed at 1.5x the regular rate over 40 hours in a workweek. exempt means it is not, and requires a written reason. CONSUMERS: timesheet-core.ts overtime computation. The pay run. Any wage-and-hour enquiry. AUTHORITY: RCW 49.46.130(1) requires one and one-half times the regular rate beyond forty hours per workweek, and RCW 49.46.130(2)(a) states that paying a salary is NOT a factor in determining exemption - exemption turns on duties, not on how someone is paid.';

comment on column public.employees.flsa_exempt_reason is
  'Written justification for an exempt classification, minimum ten characters, structurally required whenever flsa_status is exempt. CONSUMERS: wage-and-hour audit defence. Owner review screen. AUTHORITY: RCW 49.46.130(2)(a) - the exemption flows from RCW 49.46.010(3) duties tests, so the duties actually relied on must be written down at the time of the decision rather than reconstructed afterwards.';

comment on column public.pay_periods.label is
  'Human-readable name for the period, shown on every screen so a date range never has to be decoded. CONSUMERS: timesheet approval screen, pay run screen, owner reports.';

comment on column public.pay_periods.start_date is
  'First Pacific calendar day of the period, inclusive. CONSUMERS: timesheet-core.ts gathers time_punches whose Pacific day falls in this range. Overtime bucketing starts here. NOTE: this is a DATE and not a timestamp on purpose - the engine converts to UTC instants at query time via src/lib/reports/timezone.ts so a 5pm punch cannot slip into the neighbouring period.';

comment on column public.pay_periods.end_date is
  'Last Pacific calendar day of the period, inclusive. CONSUMERS: same as start_date. The exclusion constraint pay_periods_no_overlap_excl uses this to guarantee a punch belongs to exactly one period of a given cadence, so no hour can ever be paid twice.';

comment on column public.pay_periods.pay_date is
  'The date wages are actually paid. THIS, not end_date, determines the tax year and the quarter the wages are reported in. CONSUMERS: Form 941 quarter assignment. Form 940 and W-2 year assignment. Federal tax deposit due-date calculation. ACH effective date. AUTHORITY: 26 CFR 31.6001-1 requires records of wages paid. Wages are reported for the period in which they are PAID, which is why a period ending 31 December and paid in January belongs to the following year.';

comment on column public.pay_periods.pay_frequency is
  'Cadence of this period. Uses the identical vocabulary as employee_pay.pay_frequency, deliberately, so the two tables can be joined without translation. CONSUMERS: withholding table selection in payroll-withholding-core.ts, which picks a Pub 15-T column by payroll period. The overlap exclusion constraint is scoped by this column so the owner annual period may legitimately span the staff biweekly ones.';

comment on column public.pay_periods.quarter is
  'Calendar quarter (1-4) of the PAY DATE. Stored rather than derived so a filed quarter can never shift under a later code change. CONSUMERS: Form 941 quarterly return. ESD quarterly wage report. L and I quarterly report.';

comment on column public.pay_periods.tax_year is
  'Calendar year of the PAY DATE. Stored for the same reason as quarter. CONSUMERS: W-2, W-3, Form 940, annual reconciliation.';

comment on column public.pay_periods.status is
  'planned = generated but not reviewed, nothing may be posted. approved = a human read it and said yes. locked = payroll filed, nothing may change. CONSUMERS: timesheet gathering refuses periods that are not approved, and the pay run refuses periods that are locked. This is the approval gate - the calendar is generated automatically but only a person may promote it out of planned.';

comment on column public.pay_periods.approved_by is
  'Staff profile of the person who approved this period. CONSUMERS: audit trail. Structurally paired with approved_at by pay_periods_approval_shape_chk so an approval can never be half-recorded.';

comment on column public.pay_periods.approved_at is
  'When the approval happened. CONSUMERS: audit trail. See approved_by.';

comment on column public.pay_periods.locked_at is
  'When the period was locked after filing. CONSUMERS: audit trail. Proves the period was closed before the return was filed rather than after.';

comment on column public.pay_periods.notes is
  'Free text. CONSUMERS: owner reference only. Nothing computes from this.';

comment on table public.pay_periods is
  'The approved pay calendar. Generated once, reviewed by a human, then stored as rows so that historical periods stay reproducible even if the generating rule is later changed. A W-2 filed in one year must still reconcile to a period this table can produce years afterwards.';

create or replace function public.gl_audit_timesheet_setup()
returns table (finding text, detail text)
language plpgsql
security definer
set search_path = public
as $audit$declare
  v_policy_count integer;
  v_missing      integer;
begin
  if not public.is_owner() then

    raise exception 'GL_NOT_OWNER: the timesheet setup audit is owner-only.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select 'company_profile.workweek_starts_on is missing'::text,
         'The overtime engine cannot split a pay period into workweeks without it. 29 CFR 778.104 forbids averaging hours across weeks, so no boundary means no lawful overtime calculation.'::text
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'company_profile'
      and column_name = 'workweek_starts_on'
  );

  return query
  select 'company_profile.workweek_starts_on has acquired a DEFAULT'::text,
         format('default is %s; it must be NULL so that an unanswered workweek REFUSES rather than guesses (29 CFR 778.105)', d.column_default)::text
  from information_schema.columns d
  where d.table_schema = 'public'
    and d.table_name = 'company_profile'
    and d.column_name = 'workweek_starts_on'
    and d.column_default is not null;

  return query
  select 'employees.flsa_status does not default to non_exempt'::text,
         format('default is %s; defaulting to exempt would silently stop paying overtime to people who are owed it (RCW 49.46.130(1))',
                coalesce(d.column_default, 'NULL'))::text
  from information_schema.columns d
  where d.table_schema = 'public'
    and d.table_name = 'employees'
    and d.column_name = 'flsa_status'
    and coalesce(d.column_default, '') not like '%non_exempt%';

  return query
  select 'row level security is not enabled on public.pay_periods'::text,
         'Without RLS every authenticated session can read and rewrite the pay calendar, including locked periods that have already been filed against.'::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'pay_periods'
    and c.relrowsecurity = false;

  select count(*) into v_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'pay_periods'
    and coalesce(qual, '') || coalesce(with_check, '') like '%is_owner%';

  return query
  select 'public.pay_periods has fewer than 3 owner-gated policies'::text,
         format('found %s policies mentioning is_owner(); expected select, insert and update', v_policy_count)::text
  where v_policy_count < 3;

  return query
  select 'public.pay_periods has a DELETE policy'::text,
         format('policy %s permits DELETE; a pay period that has had a 941 filed against it must remain on file', p.policyname)::text
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'pay_periods'
    and p.cmd = 'DELETE';

  return query
  select 'the anon role holds privileges on public.pay_periods'::text,
         format('anon has %s; payroll data must never be reachable by an unauthenticated session', string_agg(g.privilege_type, ', '))::text
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.table_name = 'pay_periods'
    and g.grantee = 'anon'
  having count(*) > 0;

  select count(*) into v_missing
  from (
    select 'company_profile'::text as t, 'workweek_starts_on'::text as c
    union all select 'company_profile', 'workweek_starts_at_hour'
    union all select 'company_profile', 'workweek_effective_date'
    union all select 'employees', 'flsa_status'
    union all select 'employees', 'flsa_exempt_reason'
    union all select 'pay_periods', 'start_date'
    union all select 'pay_periods', 'end_date'
    union all select 'pay_periods', 'pay_date'
    union all select 'pay_periods', 'pay_frequency'
    union all select 'pay_periods', 'quarter'
    union all select 'pay_periods', 'tax_year'
    union all select 'pay_periods', 'status'
  ) want
  where col_description(
          format('public.%I', want.t)::regclass,
          (select ordinal_position
           from information_schema.columns
           where table_schema = 'public'
             and table_name = want.t
             and column_name = want.c)::int
        ) is null;

  return query
  select 'a column added by 0197 has no comment naming its consumers'::text,
         format('%s column(s) missing a comment; standing rule 62e requires every field to name what reads it', v_missing)::text
  where v_missing > 0;

  return query
  select 'public.pay_periods is missing the no-overlap exclusion constraint'::text,
         'Without pay_periods_no_overlap_excl two periods of the same cadence can cover the same day, so a clock punch could be gathered into both and paid twice.'::text
  where not exists (
    select 1 from pg_constraint
    where conname = 'pay_periods_no_overlap_excl'
      and conrelid = 'public.pay_periods'::regclass
  );

  return query
  select 'an employee has a pay cadence with no pay periods on the calendar'::text,
         format('%s (%s) is paid %s and the pay calendar contains no %s period; their hours have nowhere to go',
                e.full_name, ep.basis, ep.pay_frequency, ep.pay_frequency)::text
  from public.employee_pay ep
  join public.employees e on e.id = ep.employee_id
  where ep.is_current = true
    and e.active = true
    and not exists (
      select 1 from public.pay_periods pp
      where pp.pay_frequency = ep.pay_frequency
    );

  return query
  select 'an employee is marked exempt but is paid hourly'::text,
         format('%s is flsa_status=exempt with an hourly rate. Exemption turns on duties, not on how someone is paid (RCW 49.46.130(2)(a)); confirm this is deliberate.',
                e.full_name)::text
  from public.employees e
  join public.employee_pay ep on ep.employee_id = e.id and ep.is_current = true
  where e.flsa_status = 'exempt'
    and ep.basis = 'hourly'
    and e.active = true;

  return;
end
$audit$;

grant execute on function public.gl_audit_timesheet_setup() to authenticated;

comment on function public.gl_audit_timesheet_setup() is
  'books-32. Owner-only. Returns one row per problem with the timesheet and pay-calendar setup. An EMPTY result means everything is correct. Reports and never repairs, because every finding is a decision only the owner can make.';
