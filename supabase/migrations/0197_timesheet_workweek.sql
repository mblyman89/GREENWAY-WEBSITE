-- ═══════════════════════════════════════════════════════════════════════════
-- 0197  THE WORKWEEK, THE EXEMPTION FLAG, AND THE PAY CALENDAR
--
-- books-32. This migration adds the three facts that turn a pile of clock
-- punches into payable hours, and one audit function that proves it took.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS AT ALL — the defect it is built to make impossible
-- ───────────────────────────────────────────────────────────────────────────
--
-- Greenway pays biweekly: twenty-six periods, every other Friday. A biweekly
-- pay period is FOURTEEN DAYS, which means it contains TWO WORKWEEKS.
--
-- Overtime is owed per WORKWEEK. It is not owed per pay period, and the
-- regulation says so in words that leave no room:
--
--     "The Act takes a single workweek as its standard and does not permit
--      averaging of hours over 2 or more weeks. Thus, if an employee works 30
--      hours one week and 50 hours the next, he must receive overtime
--      compensation for the overtime hours worked beyond the applicable
--      maximum in the second week, even though the average number of hours
--      worked in the 2 weeks is 40."
--                                                    — 29 CFR §778.104
--
-- Read what that means for a payroll system. An employee works 45 hours, then
-- 35 hours. Eighty hours in the period. An engine that totals the period and
-- asks "is 80 more than 80?" answers no and pays zero overtime. The correct
-- answer is five hours of overtime premium, owed in week one, and NOTHING in
-- week two can offset it.
--
-- That defect is invisible. The gross pay looks plausible, the employee's
-- hours are correct, the tax withholding is arithmetically consistent with the
-- gross, and the error repeats every single period for as long as the system
-- runs. It surfaces years later as a wage claim with interest and, in
-- Washington, exposure well past the unpaid wages themselves.
--
-- A system cannot split a pay period into workweeks unless it knows WHICH DAY
-- A WORKWEEK STARTS. That fact does not exist anywhere in this database today.
-- Adding it is the entire point of §1 below.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION ADDS
-- ───────────────────────────────────────────────────────────────────────────
--   §1  company_profile.workweek_starts_on   — 0=Sunday .. 6=Saturday, NO DEFAULT
--   §2  employees.flsa_status                — 'non_exempt' (default) | 'exempt'
--   §3  public.pay_periods                   — the stored, approved pay calendar
--   §4  RLS, policies and grants
--   §5  Column comments naming every downstream consumer
--   §6  gl_audit_timesheet_setup()           — the proof the gate is wired
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ───────────────────────────────────────────────────────────────────────────
--   * It does not compute anything. Hours arithmetic lives in
--     src/lib/payroll/timesheet-core.ts where it can be unit tested against
--     the regulation's own worked examples. A database that computes overtime
--     in a trigger is a database whose arithmetic nobody can review.
--   * It does not pick a workweek for Michael. See §1.
--   * It does not touch time_punches. Punches are raw evidence and this slice
--     does not get to edit evidence.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- §0  ORDERING GUARD
--
-- Standing rule 61: an out-of-order migration must refuse loudly and change
-- nothing, rather than half-apply and leave a shape nobody can reason about.
-- Every dependency below is one this file actually touches.
-- ───────────────────────────────────────────────────────────────────────────
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


-- ═══════════════════════════════════════════════════════════════════════════
-- §1  THE WORKWEEK ANCHOR
--
-- WHY THERE IS NO DEFAULT ON THIS COLUMN
--
-- Every other column added in this project carries a sensible default. This
-- one carries none, on purpose, and the reason is worth stating plainly.
--
--     "An employee's workweek is a fixed and regularly recurring period of 168
--      hours—seven consecutive 24-hour periods. It need not coincide with the
--      calendar week but may begin on any day and at any hour of the day. ...
--      Once the beginning time of an employee's workweek is established, it
--      remains fixed regardless of the schedule of hours worked by him."
--                                                    — 29 CFR §778.105
--
-- The workweek is a CHOICE THE EMPLOYER MAKES, once, and then lives with. It
-- has real consequences: it decides which side of the line a Sunday-night
-- closing shift falls on, and therefore whether that shift is overtime.
--
-- If this column defaulted to 0 (Sunday), then every employer who never opened
-- the screen would silently be running a Sunday workweek that nobody chose,
-- that nothing recorded, and that no one could later defend to an
-- investigator. "The software picked it" is not an answer.
--
-- So: NULL means UNANSWERED, the engine REFUSES to compute overtime while it
-- is NULL, and the screen explains why. A refusal Michael can read beats a
-- default nobody decided. Standing rule 62d: never invent a default for
-- missing upstream data.
-- ═══════════════════════════════════════════════════════════════════════════
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
end$ck$;

-- The hour the workweek begins. §778.105 permits "any hour of the day", and a
-- cannabis retailer closing at 11pm is exactly the business where that matters.
-- Stored separately from the day so the two questions stay separable, and
-- defaulted to 0 (midnight) because — unlike the DAY — midnight is not a
-- silent choice: it is what "a day" means to everyone, and any other value is
-- a deliberate act. Recorded so the answer is on file either way.
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
end$ck$;

-- WHEN the workweek was established, because §778.105 makes it a fixed choice
-- and a later change has to be a permanent one rather than one timed to dodge
-- a heavy week. Recording the date is what makes that reviewable.
alter table public.company_profile
  add column if not exists workweek_effective_date date;


-- ═══════════════════════════════════════════════════════════════════════════
-- §2  THE EXEMPTION FLAG
--
-- WHY THE DEFAULT IS 'non_exempt' AND NOT NULL
--
-- Unlike the workweek, this one gets a default, and the direction of that
-- default is the whole point. Non-exempt is the SAFE side: it means overtime
-- gets paid. If the flag were NULL-by-default the engine would refuse for
-- every employee and Michael would face twenty refusals on day one; if it
-- defaulted to 'exempt' the engine would silently stop paying overtime to
-- people who are owed it. Defaulting to the side that PAYS is the only
-- defensible choice.
--
--     "This section does not apply to:(a) Any person exempted pursuant to
--      *RCW 49.46.010(3). The payment of compensation or provision of
--      compensatory time off in addition to a salary shall not be a factor in
--      determining whether a person is exempted under *RCW 49.46.010(3)(c);"
--                                                — RCW 49.46.130(2)(a)
--
-- Read the second sentence twice. PAYING A SALARY DOES NOT MAKE SOMEONE
-- EXEMPT. This is the most expensive misunderstanding in small-business
-- payroll: an employer promotes a floor lead, puts them on salary, stops
-- paying overtime, and has just created a liability that accrues every week.
--
-- At Greenway the honest answer is short: everyone on the floor is non-exempt,
-- and Michael is the only salaried person. The flag exists so that stays TRUE
-- ON PURPOSE rather than by luck, and so marking someone exempt is a
-- deliberate act with a reason attached to it.
-- ═══════════════════════════════════════════════════════════════════════════
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
end$ck$;

-- The justification. Not optional in practice: an exemption you cannot explain
-- is an exemption you will lose. The CHECK below makes the pairing structural
-- rather than a habit — you cannot mark someone exempt and leave the box blank.
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
end$ck$;


-- ═══════════════════════════════════════════════════════════════════════════
-- §3  THE PAY CALENDAR
--
-- WHY THE CALENDAR IS STORED RATHER THAN COMPUTED ON THE FLY
--
-- It is tempting to generate pay periods from a start date and a cadence every
-- time a screen needs one. That is wrong for a reason that only shows up in
-- year two: a generated calendar CHANGES when the generating rule changes. If
-- someone edits the anchor date in 2028, every historical period silently
-- shifts, and the W-2 you filed for 2027 no longer reconciles to any period
-- this system can produce.
--
-- Filed numbers must stay reproducible. So the calendar is generated ONCE,
-- reviewed, approved by a human, and then stored as rows. After that the rows
-- are the truth and the rule that made them is history.
--
-- Standing rule 63c: automatic, WITH approval gates.
--
-- WHY start_date/end_date ARE DATES AND NOT TIMESTAMPS
--
-- A pay period is a span of Pacific calendar days. Storing timestamps invites
-- a UTC/Pacific mix-up in which a punch at 5pm on the last Friday lands in the
-- next period. The engine converts Pacific wall-clock boundaries to UTC
-- instants at query time using src/lib/reports/timezone.ts, which already
-- handles DST correctly and is already tested.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.pay_periods (
  id uuid primary key default gen_random_uuid(),

  -- Human label, e.g. "2027-01 · Jan 1–Jan 14". Shown on every screen so
  -- Michael never has to decode a date range into "which paycheck was that".
  label text not null,

  -- Pacific calendar days, inclusive both ends.
  start_date date not null,
  end_date   date not null,

  -- The Friday the money actually moves. This — not end_date — is the date
  -- that determines the TAX YEAR of the wages, which is why it is stored
  -- rather than derived. A period ending 31 Dec 2027 paid on 7 Jan 2028 is
  -- 2028 wages on the W-2, and getting that backwards misstates two years at
  -- once.
  pay_date date not null,

  -- 'biweekly' for staff, 'annually' for the owner. Mirrors the vocabulary
  -- employee_pay.pay_frequency already uses, deliberately: two spellings of
  -- the same idea is how joins start failing.
  pay_frequency text not null
    check (pay_frequency in ('weekly','biweekly','semimonthly',
                             'monthly','quarterly','semiannually',
                             'annually','daily')),

  -- Which of the four quarters this pay_date falls in, stored rather than
  -- derived because the 941 is filed by quarter and a quarter boundary that
  -- moves is a quarter boundary that misfiles. 1..4.
  quarter smallint not null check (quarter between 1 and 4),

  -- The tax year of the PAY DATE. Same reasoning as `quarter`.
  tax_year smallint not null check (tax_year between 2000 and 2200),

  -- ─── STATUS ───────────────────────────────────────────────────────────
  --   planned   — generated, not yet reviewed. Nothing may be posted to it.
  --   approved  — a human read it and said yes. Timesheets may be gathered.
  --   locked    — payroll has been run and filed. Nothing may change.
  --
  -- 'locked' is the one that matters. Once a 941 has been filed against a
  -- quarter, the periods inside it are evidence, and evidence that can be
  -- edited is not evidence.
  status text not null default 'planned'
    check (status in ('planned', 'approved', 'locked')),

  -- WHO approved it and WHEN. Standing rule 63c: automatic with approval
  -- gates, and an approval with no name on it is not an approval.
  approved_by uuid references public.staff_profiles(id) on delete set null,
  approved_at timestamptz,

  locked_at timestamptz,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ─── STRUCTURAL GUARANTEES ────────────────────────────────────────────
  -- A period that ends before it starts is a data-entry error that would
  -- silently produce zero hours for everyone in it.
  constraint pay_periods_date_order_chk
    check (end_date >= start_date),

  -- You cannot pay for work before it has been done. Paying ON the last day
  -- is legal and common, so the boundary is >=, not >.
  constraint pay_periods_pay_after_end_chk
    check (pay_date >= end_date),

  -- An approval with no approver, or an approver with no timestamp, is a
  -- half-recorded fact. Refuse both halves.
  constraint pay_periods_approval_shape_chk
    check (
      (status = 'planned' and approved_by is null and approved_at is null)
      or (status in ('approved','locked')
          and approved_by is not null and approved_at is not null)
    ),

  constraint pay_periods_lock_shape_chk
    check ((status = 'locked') = (locked_at is not null))
);

-- Two periods of the same cadence may not overlap. This is the constraint that
-- makes "which period does this punch belong to?" a question with exactly one
-- answer. Without it a punch could be paid twice, which is the only payroll
-- error worse than paying it never.
--
-- daterange with '[]' bounds because both dates are inclusive. The exclusion
-- is scoped BY CADENCE so the owner's annual period may legitimately span the
-- staff's biweekly ones.
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
end$ex$;

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


-- ═══════════════════════════════════════════════════════════════════════════
-- §4  RLS, POLICIES AND GRANTS
--
-- Note on grants versus policies, learned the hard way in books-31 and worth
-- repeating here: enabling RLS does NOT revoke table privileges. Supabase's own
-- documentation is explicit — "Adding policies doesn't take those grants back."
-- So both have to be right. Below, `anon` is granted nothing at all, and no
-- DELETE is granted to anyone: a pay period that has been filed against is
-- evidence, and evidence is not deletable through the application.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.pay_periods enable row level security;

do $rls$
begin
  drop policy if exists pay_periods_select on public.pay_periods;
  execute 'create policy pay_periods_select on public.pay_periods for select using (public.is_owner())';

  drop policy if exists pay_periods_insert on public.pay_periods;
  execute 'create policy pay_periods_insert on public.pay_periods for insert with check (public.is_owner())';

  -- UPDATE is owner-gated on BOTH sides. `using` decides which rows you may
  -- attempt to change; `with check` decides what they may become. Omitting the
  -- second half is the classic RLS hole: it lets a permitted row be updated
  -- into a shape the policy would never have permitted.
  drop policy if exists pay_periods_update on public.pay_periods;
  execute 'create policy pay_periods_update on public.pay_periods for update using (public.is_owner()) with check (public.is_owner())';

  -- NO DELETE POLICY, DELIBERATELY. Under RLS the absence of a policy denies
  -- the operation outright, so this is enforced by the database rather than
  -- remembered by a developer. A pay period that has had a 941 filed against
  -- it must still exist in five years.
end
$rls$;

grant select, insert, update on public.pay_periods to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- §5  COLUMN COMMENTS — every column names its downstream consumers
--
-- Standing rule 62e: write down the intended consumers in the code. These are
-- not decoration. gl_audit_timesheet_setup() below FAILS if any column added
-- by this migration has no comment, which is what stops the comments rotting
-- into "-- the workweek" six months from now.
-- ═══════════════════════════════════════════════════════════════════════════
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


-- ═══════════════════════════════════════════════════════════════════════════
-- §6  THE AUDIT FUNCTION
--
-- Standing rule 16: prove the gate is wired. This is how Michael confirms the
-- migration actually took, and how a future change that quietly undoes part of
-- it gets caught.
--
-- IT REPORTS AND DOES NOT REPAIR. Every finding here is a decision only Michael
-- can make; a function that silently "fixed" a workweek would be choosing his
-- overtime boundary for him.
--
-- AN EMPTY RESULT IS THE PASSING RESULT.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.gl_audit_timesheet_setup()
returns table (finding text, detail text)
language plpgsql
security definer
set search_path = public
as $audit$
declare
  v_policy_count integer;
  v_missing      integer;
begin
  if not public.is_owner() then
    -- GL_NOT_OWNER, reusing the code the refusal catalogue already translates
    -- into plain English rather than inventing a new one a screen cannot read.
    raise exception 'GL_NOT_OWNER: the timesheet setup audit is owner-only.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 1) The workweek anchor column must exist. If a later migration drops it,
  --    the overtime engine loses its boundary and this is how we find out.
  return query
  select 'company_profile.workweek_starts_on is missing'::text,
         'The overtime engine cannot split a pay period into workweeks without it. 29 CFR 778.104 forbids averaging hours across weeks, so no boundary means no lawful overtime calculation.'::text
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'company_profile'
      and column_name = 'workweek_starts_on'
  );

  -- 2) The anchor must have NO default. A default here would be the software
  --    silently choosing an employer's overtime boundary. See §1.
  return query
  select 'company_profile.workweek_starts_on has acquired a DEFAULT'::text,
         format('default is %s; it must be NULL so that an unanswered workweek REFUSES rather than guesses (29 CFR 778.105)', d.column_default)::text
  from information_schema.columns d
  where d.table_schema = 'public'
    and d.table_name = 'company_profile'
    and d.column_name = 'workweek_starts_on'
    and d.column_default is not null;

  -- 3) The exemption default must be the side that PAYS overtime.
  return query
  select 'employees.flsa_status does not default to non_exempt'::text,
         format('default is %s; defaulting to exempt would silently stop paying overtime to people who are owed it (RCW 49.46.130(1))',
                coalesce(d.column_default, 'NULL'))::text
  from information_schema.columns d
  where d.table_schema = 'public'
    and d.table_name = 'employees'
    and d.column_name = 'flsa_status'
    and coalesce(d.column_default, '') not like '%non_exempt%';

  -- 4) RLS must be ON for pay_periods.
  return query
  select 'row level security is not enabled on public.pay_periods'::text,
         'Without RLS every authenticated session can read and rewrite the pay calendar, including locked periods that have already been filed against.'::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'pay_periods'
    and c.relrowsecurity = false;

  -- 5) Exactly the three owner-gated policies, and every one of them must
  --    actually mention is_owner(). A policy that exists but checks nothing is
  --    the definition of dead code wearing a green check (standing rule 50).
  select count(*) into v_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'pay_periods'
    and coalesce(qual, '') || coalesce(with_check, '') like '%is_owner%';

  return query
  select 'public.pay_periods has fewer than 3 owner-gated policies'::text,
         format('found %s policies mentioning is_owner(); expected select, insert and update', v_policy_count)::text
  where v_policy_count < 3;

  -- 6) No DELETE policy may exist. Filed periods are evidence.
  return query
  select 'public.pay_periods has a DELETE policy'::text,
         format('policy %s permits DELETE; a pay period that has had a 941 filed against it must remain on file', p.policyname)::text
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'pay_periods'
    and p.cmd = 'DELETE';

  -- 7) anon must hold no privilege whatsoever on the pay calendar. Enabling
  --    RLS does not revoke grants, so this is checked separately and on
  --    purpose.
  return query
  select 'the anon role holds privileges on public.pay_periods'::text,
         format('anon has %s; payroll data must never be reachable by an unauthenticated session', string_agg(g.privilege_type, ', '))::text
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.table_name = 'pay_periods'
    and g.grantee = 'anon'
  having count(*) > 0;

  -- 8) Every column this migration added must carry a comment naming its
  --    consumers. Standing rule 62e, enforced rather than hoped for.
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

  -- 9) The overlap guard must exist. Without it the same punch can fall in two
  --    periods and be paid twice.
  return query
  select 'public.pay_periods is missing the no-overlap exclusion constraint'::text,
         'Without pay_periods_no_overlap_excl two periods of the same cadence can cover the same day, so a clock punch could be gathered into both and paid twice.'::text
  where not exists (
    select 1 from pg_constraint
    where conname = 'pay_periods_no_overlap_excl'
      and conrelid = 'public.pay_periods'::regclass
  );

  -- 10) THE CROSS-TABLE CHECK. Standing rule 63d: the handoff is where the
  --     defect lives, so print the variance. Any employee with a CURRENT
  --     hourly pay record whose cadence has no matching pay period cannot be
  --     paid at all — the timesheet screen would simply have nowhere to put
  --     their hours, and would do so silently.
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

  -- 11) An exempt employee paid hourly is a contradiction worth surfacing.
  --     It is not strictly unlawful, but it is nearly always a mistake, and it
  --     is exactly the shape RCW 49.46.130(2)(a) warns about read backwards.
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
