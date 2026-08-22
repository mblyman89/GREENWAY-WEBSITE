do $precheck$begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0195 gates the payroll setup tables on is_owner(), which does not exist yet. Run 0185_books_owner_only.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.employees') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0195 attaches W-4/I-9/pay records to public.employees, which does not exist yet. Run 0037_staffing_timeclock.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.gl_payroll_labor_roles') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0195 points every pay row at a GL labor role, and gl_payroll_labor_roles does not exist yet. Run 0188_payroll_to_gl.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regprocedure('public.gen_random_uuid()') is null
     and to_regprocedure('gen_random_uuid()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0195 needs gen_random_uuid() from pgcrypto. Run 0001_slice1_foundation.sql first, then run this file again. Nothing was changed.';
  end if;
end
$precheck$;

create table if not exists public.employee_w4 (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,

  form_year     integer not null check (form_year between 1987 and 2100),

  filing_status text not null
                  check (filing_status in ('married_filing_jointly',
                                           'single_or_married_filing_separately',
                                           'head_of_household')),

  step2_multiple_jobs        boolean not null default false,

  step3_annual_credit_cents      bigint not null default 0
                                   check (step3_annual_credit_cents >= 0),
  step4a_other_income_cents      bigint not null default 0
                                   check (step4a_other_income_cents >= 0),
  step4b_deductions_cents        bigint not null default 0
                                   check (step4b_deductions_cents >= 0),
  step4c_extra_per_period_cents  bigint not null default 0
                                   check (step4c_extra_per_period_cents >= 0),

  exempt_from_federal_income_tax boolean not null default false,

  legacy_allowances              integer
                                   check (legacy_allowances is null
                                          or legacy_allowances >= 0),

  signed_on      date not null,
  effective_from date not null,

  employee_signed boolean not null default false,

  is_current     boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint employee_w4_redesign_shape_chk
    check (
      (form_year >= 2020 and legacy_allowances is null)
      or
      (form_year < 2020
       and step3_annual_credit_cents = 0
       and step4a_other_income_cents = 0
       and step4b_deductions_cents = 0)
    ),

  constraint employee_w4_exempt_no_extra_chk
    check (not (exempt_from_federal_income_tax
                and step4c_extra_per_period_cents > 0)),

  constraint employee_w4_effective_after_signed_chk
    check (effective_from >= signed_on)
);

create unique index if not exists employee_w4_one_current_idx
  on public.employee_w4 (employee_id) where is_current;

create index if not exists employee_w4_employee_idx
  on public.employee_w4 (employee_id, form_year desc);

comment on table public.employee_w4 is
  'Federal Form W-4 on file for an employee. Integer cents only. Exactly one row may be is_current per employee. The redesign-shape CHECK makes a 2020+ form with allowances (or a pre-2020 form with Step 3/4 dollars) unrepresentable.';

create table if not exists public.employee_i9 (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,

  section1_completed_on date,

  citizenship_status    text
                          check (citizenship_status is null
                                 or citizenship_status in
                                   ('us_citizen','noncitizen_national',
                                    'permanent_resident','authorized_alien')),

  work_authorization_expires_on date,

  section2_completed_on date,
  first_day_of_work     date,

  documents_examined    jsonb not null default '[]'::jsonb
                          check (jsonb_typeof(documents_examined) = 'array'),

  all_documents_unexpired boolean not null default false,

  documents_copied      boolean not null default false,

  reverified_on         date,

  retain_until          date,

  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint employee_i9_section2_order_chk
    check (section2_completed_on is null
           or section1_completed_on is null
           or section2_completed_on >= section1_completed_on),

  constraint employee_i9_one_per_employee unique (employee_id)
);

create index if not exists employee_i9_reverify_idx
  on public.employee_i9 (work_authorization_expires_on)
  where work_authorization_expires_on is not null;

create index if not exists employee_i9_retention_idx
  on public.employee_i9 (retain_until) where retain_until is not null;

comment on table public.employee_i9 is
  'QUARANTINED. Form I-9 verification record. 8 CFR 274a.2(b)(4) limits use of this data: it must never inform a pay, scheduling, or hiring decision. Do not join this table to employee_pay. The application layer throws if I-9 data reaches a pay computation.';

comment on column public.employee_i9.citizenship_status is
  'Recorded to complete the form only. Using this column in any pay or employment decision is a 8 CFR 274a.2(b)(4) violation.';

create table if not exists public.employee_pay (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,

  basis         text not null check (basis in ('hourly','salary')),

  hourly_rate_milli_cents  bigint
                             check (hourly_rate_milli_cents is null
                                    or hourly_rate_milli_cents > 0),

  annual_salary_cents      bigint
                             check (annual_salary_cents is null
                                    or annual_salary_cents > 0),

  pay_frequency text not null
                  check (pay_frequency in ('weekly','biweekly','semimonthly',
                                           'monthly','quarterly','semiannually',
                                           'annually','daily')),

  labor_role_code text not null
                    references public.gl_payroll_labor_roles(code),

  cogs_split_basis_points integer not null default 0
                            check (cogs_split_basis_points between 0 and 10000),

  effective_from date not null,
  effective_to   date,

  minimum_wage_milli_cents_at_hire bigint
                            check (minimum_wage_milli_cents_at_hire is null
                                   or minimum_wage_milli_cents_at_hire > 0),

  is_current    boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint employee_pay_basis_shape_chk
    check (
      (basis = 'hourly'
         and hourly_rate_milli_cents is not null
         and annual_salary_cents is null)
      or
      (basis = 'salary'
         and annual_salary_cents is not null
         and hourly_rate_milli_cents is null)
    ),

  constraint employee_pay_effective_order_chk
    check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists employee_pay_one_current_idx
  on public.employee_pay (employee_id) where is_current;

create index if not exists employee_pay_role_idx
  on public.employee_pay (labor_role_code);

comment on table public.employee_pay is
  'The pay agreement for an employee. Rates are stored in thousandths of a cent so the product can be rounded once, rather than the rate being rounded first (which silently under-deducts). The basis-shape CHECK makes "hourly rate AND salary at the same time" unrepresentable.';

alter table public.employees
  add column if not exists ssn_full text
    check (ssn_full is null or ssn_full ~ '^[0-9]{9}$');

comment on column public.employees.ssn_full is
  'FULL nine digits, no dashes. Protected by a COLUMN-LEVEL revoke (see below), not by RLS. Never select this column for any list view. Every reveal to a human must first write a row to employee_ssn_reveals. If that insert fails, the reveal must fail.';

alter table public.employees
  add column if not exists ssn_last_four text
    generated always as (right(ssn_full, 4)) stored;

comment on column public.employees.ssn_last_four is
  'Derived from ssn_full, not entered. Safe for ordinary screens. Because it is GENERATED it can never disagree with the full value, which a hand-maintained duplicate eventually would.';

do $ssn_col_gate$declare
  col text;
begin
  revoke select on public.employees from authenticated;

  for col in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'employees'
      and column_name <> 'ssn_full'
  loop
    execute format('grant select (%I) on public.employees to authenticated', col);
  end loop;

  revoke update on public.employees from authenticated;
  for col in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'employees'
      and column_name not in ('ssn_full','ssn_last_four')
  loop
    execute format('grant update (%I) on public.employees to authenticated', col);
  end loop;
end
$ssn_col_gate$;

create table if not exists public.employee_ssn_reveals (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,

  revealed_by  uuid references auth.users(id),

  revealed_by_role text not null,

  reason       text not null check (length(btrim(reason)) >= 3),

  revealed_at  timestamptz not null default now()
);

create index if not exists employee_ssn_reveals_employee_idx
  on public.employee_ssn_reveals (employee_id, revealed_at desc);

create index if not exists employee_ssn_reveals_actor_idx
  on public.employee_ssn_reveals (revealed_by, revealed_at desc);

comment on table public.employee_ssn_reveals is
  'Append-only record of every full-SSN disclosure. Written BEFORE the value is returned, so a failed audit write means a failed reveal. No UPDATE or DELETE policy exists for any role, including the owner.';

alter table public.employee_w4            enable row level security;
alter table public.employee_i9            enable row level security;
alter table public.employee_pay           enable row level security;
alter table public.employee_ssn_reveals   enable row level security;

do $rls$declare
  t text;
begin
  foreach t in array array['employee_w4','employee_i9','employee_pay',
                           'employee_ssn_reveals']
  loop

    execute format('drop policy if exists %I on public.%I',
                   t || '_owner_select', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_owner())',
      t || '_owner_select', t);

    execute format('drop policy if exists %I on public.%I',
                   t || '_owner_insert', t);
    execute format(
      'create policy %I on public.%I for insert with check (public.is_owner())',
      t || '_owner_insert', t);
  end loop;

  foreach t in array array['employee_w4','employee_i9','employee_pay']
  loop
    execute format('drop policy if exists %I on public.%I',
                   t || '_owner_update', t);
    execute format(
      'create policy %I on public.%I for update using (public.is_owner()) with check (public.is_owner())',
      t || '_owner_update', t);

    execute format('drop policy if exists %I on public.%I',
                   t || '_owner_delete', t);
    execute format(
      'create policy %I on public.%I for delete using (public.is_owner())',
      t || '_owner_delete', t);
  end loop;
end
$rls$;

create or replace function public.gl_audit_employee_payroll_setup()
returns table (finding text, detail text)
language sql
stable
security definer
set search_path = public
as $$select
    'RLS_NOT_ENABLED'::text,
    format('%s has policies but row level security is not enabled, so the '
           'policies are never consulted and the table is readable by anyone '
           'with a connection.', c.relname)::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('employee_w4','employee_i9','employee_pay',
                      'employee_ssn_reveals')
    and c.relrowsecurity = false

  union all

  select
    'POLICY_NOT_OWNER_GATED'::text,
    format('policy %s on %s does not reference is_owner(); its expression is: %s',
           p.policyname, p.tablename,
           coalesce(p.qual, p.with_check, '(none)'))::text
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('employee_w4','employee_i9','employee_pay',
                        'employee_ssn_reveals')
    and coalesce(p.qual, '') || coalesce(p.with_check, '') not like '%is_owner%'

  union all

  select
    'REVEAL_LOG_IS_MUTABLE'::text,
    format('employee_ssn_reveals has a %s policy (%s). This table must be '
           'append-only: a log that can be rewritten proves nothing.',
           p.cmd, p.policyname)::text
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'employee_ssn_reveals'
    and p.cmd in ('UPDATE','DELETE')

  union all

  select
    'OWNER_PAY_IN_COGS'::text,
    format('employee_pay row %s uses labor role %s, which maps to account %s. '
           'Owner compensation is not a cost of goods sold and must not sit in '
           'a 6xxxx account.', ep.id, ep.labor_role_code, r.account_code)::text
  from public.employee_pay ep
  join public.gl_payroll_labor_roles r on r.code = ep.labor_role_code
  where r.treatment = 'owner'
    and r.account_code like '6%'

  union all

  select
    'SSN_COLUMN_READABLE'::text,
    format('role %s holds SELECT on employees.ssn_full. RLS cannot fix this - '
           'the roster row is legitimately visible, so the SSN must be gated by '
           'a COLUMN privilege. Revoke it. ssn_last_four is what screens should '
           'read.', g.grantee)::text
  from information_schema.column_privileges g
  where g.table_schema = 'public'
    and g.table_name   = 'employees'
    and g.column_name  = 'ssn_full'
    and g.privilege_type = 'SELECT'
    and g.grantee in ('authenticated','anon','public')

  union all

  select
    'SSN_MALFORMED'::text,
    format('employee %s has an ssn_full that is not exactly nine digits. The '
           'SSA rejects a W-2 filed with a malformed SSN.', e.id)::text
  from public.employees e
  where e.ssn_full is not null
    and e.ssn_full !~ '^[0-9]{9}$'
$$;

comment on function public.gl_audit_employee_payroll_setup() is
  'Returns one row per PROBLEM with the employee payroll setup gates. An empty result is the passing result.';

revoke all on function public.gl_audit_employee_payroll_setup() from public;
grant execute on function public.gl_audit_employee_payroll_setup() to authenticated;
