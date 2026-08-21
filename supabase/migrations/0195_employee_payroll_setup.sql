-- ═══════════════════════════════════════════════════════════════════════════
-- 0195_employee_payroll_setup.sql
-- Slice books-25 — EMPLOYEE PAYROLL SETUP (W-4 + I-9 + PAY).
--
-- WHAT THIS DOES, IN PLAIN ENGLISH
--
-- Today this system can tell you who works here and when they clocked in. It
-- cannot tell you what to withhold from their paycheck, because the three
-- documents payroll actually runs on have nowhere to live: the W-4, the I-9,
-- and the pay agreement. This migration gives each of them a table.
--
-- Three tables, and one more that exists only to watch us:
--
--   employee_w4        the federal withholding certificate
--   employee_i9        employment eligibility verification (QUARANTINED)
--   employee_pay       rate, basis, frequency, and the GL role wages land in
--   employee_ssn_reveals   an append-only log of every time a full SSN was
--                          shown to a human being
--
-- OWNER DECISIONS, recorded verbatim (Michael, this slice):
--
--   On storing the SSN in full:
--     "I need the full ssn stored, masked for everyone but me, with a reveal
--      toggle like sage has."
--   On pay:
--     "hourly for all employees, salary for me"
--     "every two weeks on friday"
--     "I pay myself once at the end of the year."
--   On why any of this exists at all:
--     "It should have a check list of task to be completed before it lets you
--      save them to the system, and if a field is missing, it should highlight
--      it so something can't silently fail me in some way."
--     "Sage has no safety nets."
--
-- WHY THE SSN IS STORED IN FULL, AND WHAT PAYS FOR THAT
--
-- A W-2 needs the whole number. 26 CFR 31.6051-1 requires it, and the SSA
-- rejects a W-2 filed with a truncated one. 31 CFR 31.3402(f)(2)-1(f)(2) is
-- the same story on the W-4 side. So "store only the last four" is not a
-- privacy win, it is a filing failure in January.
--
-- What pays for holding it is this: the column is owner-only at the RLS
-- level, it is never selected by the read path that draws the employee list,
-- and every single reveal writes a row to employee_ssn_reveals BEFORE the
-- value is returned. If the audit insert fails, the reveal fails. That
-- ordering is the whole point — an audit log you can skip when it is
-- inconvenient is decoration.
--
-- WHY THE I-9 IS QUARANTINED
--
-- 8 CFR 274a.2(b)(4) limits what the I-9 may be used for. Sage puts the I-9
-- fields on the same screen as the pay rate, two dropdowns away from the
-- money, which makes it trivially easy to let citizenship status leak into a
-- pay or hiring decision. We take the opposite approach: the I-9 lives in its
-- own table, no view joins it to pay, and the application layer carries an
-- active guard (assertI9NotUsedForPay) that throws if the data is dragged
-- into a pay computation. Separation here is not tidiness, it is the control.
--
-- HOW TO RUN IT: see docs/HOW_TO_RUN_A_MIGRATION.md. Then check:
--   select * from public.gl_audit_employee_payroll_setup();
-- AN EMPTY RESULT IS THE PASSING RESULT.
--
-- This file is IDEMPOTENT. Running it twice is safe and changes nothing the
-- second time.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- §0  PRECONDITIONS — REFUSE TO RUN OUT OF ORDER
--
-- If this file runs before the things it depends on exist, it would create
-- payroll tables with no owner gate and no labor-role FK, and still report
-- success. That is the silent failure Michael asked us to make impossible.
-- ═══════════════════════════════════════════════════════════════════════════
do $precheck$
begin
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

  -- gen_random_uuid() comes from pgcrypto (0001). Without it every default
  -- below fails at insert time, not at migrate time, which is worse.
  if to_regprocedure('public.gen_random_uuid()') is null
     and to_regprocedure('gen_random_uuid()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0195 needs gen_random_uuid() from pgcrypto. Run 0001_slice1_foundation.sql first, then run this file again. Nothing was changed.';
  end if;
end
$precheck$;

-- ═══════════════════════════════════════════════════════════════════════════
-- §1  employee_w4 — THE FEDERAL WITHHOLDING CERTIFICATE
--
-- One current W-4 per employee, plus history. The form_year matters because
-- the 2020 redesign changed the arithmetic: pre-2020 forms carry allowances,
-- 2020-and-later forms carry dollar amounts. A system that stores "number of
-- allowances" and a 2027 form in the same column will compute a wrong
-- paycheck and never say a word about it.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.employee_w4 (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,

  -- The tax year of the FORM ITSELF, not the year we are paying in. An
  -- employee can keep a 2025 form on file for years; it stays valid.
  form_year     integer not null check (form_year between 1987 and 2100),

  -- Step 1(c). These are the three the IRS actually prints. "single" is NOT a
  -- value here: the box reads "Single or Married filing separately", and
  -- collapsing that to "single" is how you end up unable to reproduce a
  -- withholding figure later.
  filing_status text not null
                  check (filing_status in ('married_filing_jointly',
                                           'single_or_married_filing_separately',
                                           'head_of_household')),

  -- Step 2. A checkbox, not a number. When it is on, the standard deduction
  -- and brackets are halved in the percentage-method tables.
  step2_multiple_jobs        boolean not null default false,

  -- Step 3, and Step 4 (a)/(b)/(c). All INTEGER CENTS. Never floats: a
  -- withholding figure that is off by a fraction of a cent every period is
  -- off by real money by December, and it will not tie to the 941.
  step3_annual_credit_cents      bigint not null default 0
                                   check (step3_annual_credit_cents >= 0),
  step4a_other_income_cents      bigint not null default 0
                                   check (step4a_other_income_cents >= 0),
  step4b_deductions_cents        bigint not null default 0
                                   check (step4b_deductions_cents >= 0),
  step4c_extra_per_period_cents  bigint not null default 0
                                   check (step4c_extra_per_period_cents >= 0),

  -- Claiming exempt is legal, time-limited, and loud. It expires and has to be
  -- refiled; that is why it is its own flag and not a zero somewhere.
  exempt_from_federal_income_tax boolean not null default false,

  -- Pre-2020 forms only. NULL on a redesigned form, and the CHECK below makes
  -- the wrong combination impossible rather than merely unlikely.
  legacy_allowances              integer
                                   check (legacy_allowances is null
                                          or legacy_allowances >= 0),

  -- 31 CFR 31.3402(f)(2)-1(a)(1): furnished on commencement of employment. We
  -- record WHEN, because the date is the evidence.
  signed_on      date not null,
  effective_from date not null,

  -- An unsigned W-4 is not a W-4. §31.3402(f)(2)-1(f)(3)(i): an altered or
  -- unsigned certificate is invalid, and (f)(3)(ii) says the employer must
  -- disregard it. So we store the fact of signature explicitly.
  employee_signed boolean not null default false,

  is_current     boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- ─── THE STRUCTURAL GUARANTEES ───────────────────────────────────────────
  -- A 2020-or-later form CANNOT carry allowances, and a pre-2020 form CANNOT
  -- carry Step 3/4 dollars. Sage lets you mix them and then quietly picks one.
  constraint employee_w4_redesign_shape_chk
    check (
      (form_year >= 2020 and legacy_allowances is null)
      or
      (form_year < 2020
       and step3_annual_credit_cents = 0
       and step4a_other_income_cents = 0
       and step4b_deductions_cents = 0)
    ),

  -- Exempt means exempt. It does not mean "exempt, but also withhold extra."
  -- That combination is incoherent, so it is unrepresentable.
  constraint employee_w4_exempt_no_extra_chk
    check (not (exempt_from_federal_income_tax
                and step4c_extra_per_period_cents > 0)),

  -- A form cannot take effect before it was signed.
  constraint employee_w4_effective_after_signed_chk
    check (effective_from >= signed_on)
);

-- Exactly ONE current W-4 per employee. Two "current" forms is the state in
-- which nobody can say which one produced the paycheck.
create unique index if not exists employee_w4_one_current_idx
  on public.employee_w4 (employee_id) where is_current;

create index if not exists employee_w4_employee_idx
  on public.employee_w4 (employee_id, form_year desc);

comment on table public.employee_w4 is
  'Federal Form W-4 on file for an employee. Integer cents only. Exactly one row may be is_current per employee; the redesign-shape CHECK makes a 2020+ form with allowances (or a pre-2020 form with Step 3/4 dollars) unrepresentable.';

-- ═══════════════════════════════════════════════════════════════════════════
-- §2  employee_i9 — EMPLOYMENT ELIGIBILITY (QUARANTINED)
--
-- READ THIS BEFORE YOU JOIN THIS TABLE TO ANYTHING.
--
-- 8 CFR 274a.2(b)(4) limits the use of the I-9 and the information in it.
-- Nothing in this table may inform a pay decision, a scheduling decision, or
-- a hiring decision. It exists to prove one thing — that eligibility was
-- verified on time — and to be produced on inspection.
--
-- There is deliberately NO view joining this to employee_pay, and the
-- application layer throws (assertI9NotUsedForPay) if this data reaches a pay
-- computation. If you find yourself needing a join here, the requirement is
-- wrong, not the schema.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.employee_i9 (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,

  -- ─── Section 1: the employee completes this. ───
  -- 8 CFR 274a.2(b)(1)(i)(A): no later than the FIRST DAY of employment.
  section1_completed_on date,

  -- The four categories on the form. Stored as given; NEVER used to decide
  -- anything about pay or continued employment.
  citizenship_status    text
                          check (citizenship_status is null
                                 or citizenship_status in
                                   ('us_citizen','noncitizen_national',
                                    'permanent_resident','authorized_alien')),

  -- Only meaningful for authorized_alien, and only when the authorization is
  -- time-limited. Drives reverification under §274a.2(b)(1)(vii).
  work_authorization_expires_on date,

  -- ─── Section 2: the EMPLOYER completes this. ───
  -- 8 CFR 274a.2(b)(1)(ii): within THREE BUSINESS DAYS of the first day of
  -- work for pay. Not three calendar days. The engine computes the due date
  -- with the same business-day helper the rest of the app uses.
  section2_completed_on date,
  first_day_of_work     date,

  -- The documents examined. A List A document alone is sufficient; otherwise
  -- it takes one from List B (identity) AND one from List C (authorization).
  -- Stored as jsonb because the count varies and the shape is validated in
  -- the engine, where it can produce a readable message instead of a
  -- constraint violation code.
  documents_examined    jsonb not null default '[]'::jsonb
                          check (jsonb_typeof(documents_examined) = 'array'),

  -- §274a.2(b)(1)(v): only UNEXPIRED documents are acceptable. The engine
  -- refuses expired ones; this column records that the check was made.
  all_documents_unexpired boolean not null default false,

  -- §274a.2(b)(3): if you copy documents you must do it for EVERYONE, not
  -- selectively. Selective copying is itself the discrimination finding.
  documents_copied      boolean not null default false,

  -- §274a.2(b)(1)(vii): reverification, when authorization expires.
  reverified_on         date,

  -- §274a.2(b)(2)(i)(A): retain 3 years after hire, or 1 year after
  -- termination, WHICHEVER IS LATER. The engine computes the later RESULT of
  -- the two dates — not the later anchor, which is a different and wrong
  -- answer.
  retain_until          date,

  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Section 2 cannot precede the first day of work, and cannot precede
  -- Section 1 — the employee signs first, then the employer examines.
  constraint employee_i9_section2_order_chk
    check (section2_completed_on is null
           or section1_completed_on is null
           or section2_completed_on >= section1_completed_on),

  -- One I-9 per employee. The form is per-hire, and a duplicate row is how
  -- you end up producing the wrong one on inspection.
  constraint employee_i9_one_per_employee unique (employee_id)
);

create index if not exists employee_i9_reverify_idx
  on public.employee_i9 (work_authorization_expires_on)
  where work_authorization_expires_on is not null;

create index if not exists employee_i9_retention_idx
  on public.employee_i9 (retain_until) where retain_until is not null;

comment on table public.employee_i9 is
  'QUARANTINED. Form I-9 verification record. 8 CFR 274a.2(b)(4) limits use of this data: it must never inform a pay, scheduling, or hiring decision. Do not join this table to employee_pay; the application layer throws if I-9 data reaches a pay computation.';

comment on column public.employee_i9.citizenship_status is
  'Recorded to complete the form only. Using this column in any pay or employment decision is a 8 CFR 274a.2(b)(4) violation.';

-- ═══════════════════════════════════════════════════════════════════════════
-- §3  employee_pay — WHAT WE AGREED TO PAY, AND WHERE IT LANDS IN THE BOOKS
--
-- Michael: "hourly for all employees, salary for me", "every two weeks on
-- friday", "I pay myself once at the end of the year."
--
-- So this table has to hold two genuinely different animals without letting
-- either contaminate the other: an hourly rate that needs sub-cent precision,
-- and an annual salary paid in a single event.
--
-- WHY hourly_rate_milli_cents AND NOT CENTS
--
-- Some real rates cannot be written in cents. L&I charges $0.16445 per hour
-- worked for the employee's share — five decimal places of a dollar. And the
-- moment anyone negotiates $17.855/hour, cents cannot hold it either.
-- Rounding the RATE before multiplying is the classic silent shortfall:
-- rounding $0.16445 to 16 cents over 2,080 hours under-deducts $9.26, and
-- under-deducting L&I is a gross misdemeanor under RCW 51.16.140(2), not a
-- rounding difference. So we store rates at 1000x the cent and round the
-- PRODUCT, once.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.employee_pay (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,

  -- 'hourly' for staff, 'salary' for the owner. Nothing else is in scope,
  -- because nothing else is what Greenway actually does.
  basis         text not null check (basis in ('hourly','salary')),

  -- Thousandths of a cent. See the note above for why this is not cents.
  hourly_rate_milli_cents  bigint
                             check (hourly_rate_milli_cents is null
                                    or hourly_rate_milli_cents > 0),

  -- Whole cents is correct here: an annual salary is a stated round figure,
  -- and the per-period split is computed, not stored.
  annual_salary_cents      bigint
                             check (annual_salary_cents is null
                                    or annual_salary_cents > 0),

  -- 'biweekly' = 26 periods, which is what "every two weeks on friday" means.
  -- 'annually' exists for exactly one row: the owner, paid once at year end.
  --
  -- WHY ALL EIGHT, AND NOT JUST THE TWO GREENWAY USES
  --
  -- An earlier version of this CHECK listed six cadences. It omitted
  -- 'semiannually' and 'daily' -- not by decision, but because nobody wrote
  -- them down. The TypeScript union PayFrequency has eight members and
  -- validatePay() does not check the cadence at all, so a record with
  -- pay_frequency = 'daily' passed every layer of validation and was then
  -- rejected HERE, by the database, with "violates check constraint". Proven
  -- by inserting all eight against this schema: six accepted, two refused.
  --
  -- That is the exact failure mode this slice exists to eliminate. The message
  -- Michael would have seen is the one writeFailed() prints -- "the checklist
  -- has a gap worth reporting" -- which is the system correctly reporting a
  -- gap in itself, but only AFTER the save had already failed.
  --
  -- The fix is to widen the CHECK, not to narrow the engine, because the two
  -- missing cadences are not exotic: 'semiannually' and 'daily' are two of the
  -- SEVEN payroll periods Pub. 15-T Worksheet 1A Table 3 itself prints, and
  -- IRC 3401(b) names both ("a daily, weekly, biweekly, semimonthly, monthly,
  -- quarterly, semiannual, or annual payroll period"). A database that refuses
  -- a payroll period the IRS publishes a withholding table for is the
  -- database being wrong.
  --
  -- Greenway will only ever use 'biweekly' (staff) and 'annually' (the owner).
  -- This column is not where that is enforced -- a CHECK constraint cannot
  -- explain itself to the person it just blocked. The engine's mentor layer
  -- steers the choice with a reason attached; this constraint's only job is to
  -- refuse a cadence NO payroll period recognises, so that the set the
  -- database accepts and the set the engine can compute are the same set. Two
  -- tests police that in both directions.
  pay_frequency text not null
                  check (pay_frequency in ('weekly','biweekly','semimonthly',
                                           'monthly','quarterly','semiannually',
                                           'annually','daily')),

  -- Which GL role these wages land in — this is the join that keeps payroll
  -- and the ledger telling the same story. For Michael this resolves to
  -- 'owner_officer', which 0188 seeds to account 71010 with
  -- never_inventoriable = true, so owner comp CANNOT reach COGS.
  labor_role_code text not null
                    references public.gl_payroll_labor_roles(code),

  -- When only part of a role's time is inventoriable. Basis points so the
  -- split is exact; 10000 = 100%.
  cogs_split_basis_points integer not null default 0
                            check (cogs_split_basis_points between 0 and 10000),

  effective_from date not null,
  effective_to   date,

  -- The minimum wage in force WHEN THIS RATE WAS SET. Recorded, not derived,
  -- so that a later minimum-wage increase does not silently rewrite history
  -- and make a lawful past rate look unlawful.
  minimum_wage_milli_cents_at_hire bigint
                            check (minimum_wage_milli_cents_at_hire is null
                                   or minimum_wage_milli_cents_at_hire > 0),

  is_current    boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- ─── THE STRUCTURAL GUARANTEES ───────────────────────────────────────────
  -- Exactly one rate field is populated, and it is the one matching the
  -- basis. Sage's screens happily hold an hourly rate AND a salary at once,
  -- and then one of them wins invisibly.
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

-- ═══════════════════════════════════════════════════════════════════════════
-- §4  THE SSN — STORED IN FULL, OWNER-ONLY, AND WATCHED
--
-- Michael asked for the full number with a Sage-style reveal toggle. The W-2
-- needs it in full anyway (26 CFR 31.6051-1), so pretending otherwise just
-- moves the failure to January.
--
-- The column lives on employees, not in a new table, because it is an
-- attribute of the person and a separate table would need the identical gate
-- plus a join that someone would eventually forget.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.employees
  add column if not exists ssn_full text
    check (ssn_full is null or ssn_full ~ '^[0-9]{9}$');

comment on column public.employees.ssn_full is
  'FULL nine digits, no dashes. Protected by a COLUMN-LEVEL revoke (see below), not by RLS. Never select this into a list view. Every reveal to a human must first write a row to employee_ssn_reveals — if that insert fails, the reveal must fail.';

-- ───────────────────────────────────────────────────────────────────────────
-- THE COLUMN-LEVEL GATE, AND WHY RLS ALONE WAS NOT ENOUGH
--
-- This was caught by testing rather than by reading, so it is written down.
--
-- public.employees already carries an `employees_mgr_read` SELECT policy, so
-- managers can read the staff roster — which is correct and necessary. But RLS
-- filters ROWS, not COLUMNS. The moment ssn_full was added to this table,
-- every manager who could see the roster row could also see the SSN in it.
-- Verified live: a manager account selected ssn_full and got all nine digits
-- back. The earlier version of this comment claimed the column was "owner-only
-- at the RLS level", and that claim was simply false.
--
-- Row security cannot fix this, because the row is legitimately visible. The
-- correct instrument is a column privilege. So: revoke SELECT on the whole
-- table, then grant it back column by column, omitting ssn_full. Reads of the
-- full number then go through the service role, which is the only path that
-- writes the reveal audit row first.
--
-- ssn_last_four IS granted. That is the point of having it: ordinary screens
-- identify a person by the last four and never touch the protected column.
-- ───────────────────────────────────────────────────────────────────────────
-- ORDER MATTERS HERE, AND IT WAS WRONG.
--
-- ssn_last_four is created BEFORE the gate block below, and that sequence is
-- load-bearing rather than cosmetic. The gate revokes SELECT on employees and
-- grants it back one column at a time by reading information_schema.columns.
-- A column that does not exist when that catalogue is read receives no grant.
--
-- This column used to be created AFTER the gate. The result, proven against a
-- real PostgreSQL 15 rather than argued: apply 0195 once and
--   set role authenticated; select ssn_last_four from public.employees;
-- returns "permission denied for table employees". Apply it a SECOND time and
-- the same query succeeds, because by then the column existed when the loop
-- ran. A migration whose outcome depends on how many times it has been run is
-- not idempotent in the way that matters, and the failure lands exactly on the
-- read path every ordinary screen uses.
--
-- The comment below is now true because the order makes it true.
-- The last four are NOT a second copy of the truth. They are a derived
-- convenience so ordinary screens can identify a person without the gated
-- column being in the query at all. Generated, so it cannot drift.
alter table public.employees
  add column if not exists ssn_last_four text
    generated always as (right(ssn_full, 4)) stored;

comment on column public.employees.ssn_last_four is
  'Derived from ssn_full, not entered. Safe for ordinary screens. Because it is GENERATED it can never disagree with the full value, which a hand-maintained duplicate eventually would.';

do $ssn_col_gate$
declare
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

  -- Writes to the roster keep working; only reading the SSN is narrowed.
  -- ssn_full is deliberately absent from the update grant too: it is set by
  -- the service role during onboarding, not edited from a screen.
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

-- ───────────────────────────────────────────────────────────────────────────
-- The reveal log. Append-only: no update, no delete, for anyone.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.employee_ssn_reveals (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,

  -- WHO looked. Nullable only because auth.uid() is null under the service
  -- role; a null here means "a server process", which is itself informative.
  revealed_by  uuid references auth.users(id),

  -- The role as it was AT THE MOMENT of the reveal. Roles change; the log
  -- must not silently re-narrate history when they do.
  revealed_by_role text not null,

  -- Why. Free text, required, minimum length enforced — "because I clicked
  -- it" is not a reason, and a blank reason field is how audit logs become
  -- worthless.
  reason       text not null check (length(btrim(reason)) >= 3),

  revealed_at  timestamptz not null default now()
);

create index if not exists employee_ssn_reveals_employee_idx
  on public.employee_ssn_reveals (employee_id, revealed_at desc);

create index if not exists employee_ssn_reveals_actor_idx
  on public.employee_ssn_reveals (revealed_by, revealed_at desc);

comment on table public.employee_ssn_reveals is
  'Append-only record of every full-SSN disclosure. Written BEFORE the value is returned, so a failed audit write means a failed reveal. No UPDATE or DELETE policy exists for any role, including the owner.';

-- ═══════════════════════════════════════════════════════════════════════════
-- §5  ROW LEVEL SECURITY — OWNER ONLY, IN BOTH DIRECTIONS
--
-- Michael, recorded in 0190: "there is no reason anyone else needs to see my
-- books or my financials ever". A W-4 tells you someone's marital status and
-- second-job situation; an I-9 tells you their citizenship. Neither is
-- floor-staff reading material.
--
-- Write paths use createSupabaseAdminClient() (service role), which bypasses
-- RLS, so nothing operational breaks here.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.employee_w4            enable row level security;
alter table public.employee_i9            enable row level security;
alter table public.employee_pay           enable row level security;
alter table public.employee_ssn_reveals   enable row level security;

do $rls$
declare
  t text;
begin
  foreach t in array array['employee_w4','employee_i9','employee_pay',
                           'employee_ssn_reveals']
  loop
    -- Drop first so re-running this file cannot leave a stale permissive
    -- policy sitting behind the new one.
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

  -- UPDATE and DELETE on the three setup tables: owner only. Deliberately NOT
  -- granted on employee_ssn_reveals — that table is append-only, and the
  -- absence of a policy is what enforces it. RLS denies by default, so no
  -- policy means no route, for anyone.
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

-- ═══════════════════════════════════════════════════════════════════════════
-- §6  THE SELF-AUDIT — PROVE THE GATE IS REAL
--
-- A migration that claims to have locked something should be able to show it.
-- This function returns one row per PROBLEM. An empty result is the passing
-- result; anything it returns is a finding with a plain-English explanation.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.gl_audit_employee_payroll_setup()
returns table (finding text, detail text)
language sql
stable
security definer
set search_path = public
as $$
  -- 1) RLS must actually be ON. Policies on a table with RLS disabled are
  --    decoration: Postgres never consults them.
  select
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

  -- 2) Every policy must be gated on is_owner(). A policy that says
  --    "using (true)" reads as a policy and behaves as no policy at all.
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

  -- 3) The reveal log must remain append-only. If an UPDATE or DELETE policy
  --    ever appears here, the audit trail became editable and the log stopped
  --    being evidence.
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

  -- 4) Owner compensation must never point at a COGS account. 0188's CHECK
  --    already makes it unrepresentable; this re-asks the question from the
  --    payroll side, because a constraint nobody re-verifies is a constraint
  --    someone eventually drops.
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

  -- 5) THE COLUMN GATE. This is the finding that caught a real leak during
  --    this slice: employees carries a manager-readable RLS policy, and RLS
  --    filters rows, not columns, so adding ssn_full to that table exposed it
  --    to every manager. If a SELECT privilege on ssn_full ever reappears for
  --    a non-service role, say so loudly.
  select
    'SSN_COLUMN_READABLE'::text,
    format('role %s holds SELECT on employees.ssn_full. RLS cannot fix this - '
           'the roster row is legitimately visible, so the SSN must be gated by '
           'a COLUMN privilege. Revoke it; ssn_last_four is what screens should '
           'read.', g.grantee)::text
  from information_schema.column_privileges g
  where g.table_schema = 'public'
    and g.table_name   = 'employees'
    and g.column_name  = 'ssn_full'
    and g.privilege_type = 'SELECT'
    and g.grantee in ('authenticated','anon','public')

  union all

  -- 6) An SSN that is not exactly nine digits will be rejected by the SSA at
  --    W-2 time. Better to hear it now than next January.
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
