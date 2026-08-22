-- ══════════════════════════════════════════════════════════════════════════════
-- 0199  YEAR-TO-DATE WAGE ACCUMULATORS, AND THE END OF THE ONE-LUMP TAX COLUMN
--
-- books-34. Michael asked for this before the sick-leave screens and before net
-- pay, and he was right to. Of everything left in the payroll pipeline, this is
-- the only gap that produces A WRONG NUMBER THAT LOOKS RIGHT.
--
-- ──────────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS AT ALL — the defects it is built to make impossible
-- ──────────────────────────────────────────────────────────────────────────────
--
-- DEFECT 1 — THE PAY RUN WITH NO MEMORY.
--
-- src/lib/payroll/payroll-withholding-core.ts has accepted a seven-field
-- YtdWageAccumulators argument since the withholding slice. It caps social
-- security at the wage base, leaves Medicare uncapped, starts Additional
-- Medicare at $200,000, and stops FUTA at $7,000. All of that arithmetic is
-- correct and all of it is unreachable, because a grep across the entire tree
-- finds exactly ONE caller passing that argument and it passes the constant
-- ZERO_YTD — legitimately, since it is a documented onboarding illustration.
--
-- Nothing stores the seven figures between runs. Nothing can, because before
-- this file there was no table to store them in. The consequence is not an
-- error message; it is a cheque. Social security keeps being withheld after the
-- ceiling is reached, the cheque looks perfectly ordinary, and the discrepancy
-- surfaces the following January when the W-2 will not reconcile:
--
--     "The total of boxes 3 and 7 cannot exceed $184,500 (2026 maximum social
--      security wage base)."
--                          — IRS Instructions for Forms W-2 and W-3 (2026), Box 3
--
-- Read that as a database constraint, because that is what it is. It is an
-- ANNUAL ceiling. No per-period calculation can see it. A pay run that knows
-- only about itself cannot know that the twenty-third cheque of the year
-- crossed the line, and biweekly Greenway writes twenty-six of them.
--
-- DEFECT 2 — ONE LUMP CALLED "taxes_cents".
--
-- 0057 created payroll_run_lines with a single `taxes_cents` column, described
-- in its own comment as "Manually-typed paystub totals". That was honest for
-- what it was: a place to retype what Sage had already computed. It cannot
-- support this slice, and the reason is not tidiness.
--
-- Each tax has its OWN wage definition and its OWN ceiling. Social security
-- stops at $184,500; Medicare never stops; Additional Medicare starts at
-- $200,000 and the employer does not match it; FUTA stops at $7,000. To
-- accumulate a year you must know which dollars belonged to which tax, and a
-- single summed column has thrown that away irretrievably. You cannot unmix
-- paint. §2 therefore ADDS per-tax columns beside the lump (standing rule 25:
-- extend, do not replace) and leaves every existing row and reader untouched.
--
-- DEFECT 3 — INVARIANTS THE SSA WILL ENFORCE WHETHER OR NOT WE DO.
--
-- The SSA publishes the exact conditions under which it throws a wage report
-- back. They are arithmetic relationships between running totals — which makes
-- them CHECK constraints, written by the SSA rather than invented here:
--
--     "The SSA will reject Form W-2 electronic and paper wage reports under the
--      following conditions.
--      • Medicare wages and tips are less than the sum of social security wages
--        and social security tips.
--      • Social security tax is greater than zero; social security wages and
--        social security tips are equal to zero.
--      • Medicare tax is greater than zero; Medicare wages and tips are equal
--        to zero."
--   — IRS Instructions for Forms W-2 and W-3 (2026), Rejected wage reports (SSA)
--
-- The IRS repeats them in checklist form and adds the per-employee ceiling test
-- ("Make sure that the social security wage amount for each employee does not
-- exceed the annual social security wage base limit ($184,500 for 2026)").
-- When a tax authority states a rule twice in one document, it is worth
-- encoding as a constraint rather than a habit. §3 does exactly that.
--
-- A note on where those quotes come from: every one is verified character for
-- character against the mirrored IRS instructions on disk by
-- scripts/verify-verbatim-quotes.ts, through the authorities registered in
-- src/lib/payroll/ytd-authorities.ts. They are not retyped here from memory.
--
-- ──────────────────────────────────────────────────────────────────────────────
-- WHAT THIS FILE CREATES
--
--   §0  ordering guard                          — rule 61, refuse loudly
--   §2  payroll_run_lines per-tax columns       — ADDED beside the lump
--   §3  public.payroll_ytd_accumulators         — the memory, per employee/year
--   §4  updated_at trigger
--   §5  row level security                      — owner only
--
-- UNITS. Every *_cents column is WHOLE CENTS as bigint, matching the engine and
-- the rest of the payroll schema. lni_hundredth_hours is HUNDREDTH-HOURS
-- (4000 = 40.00 hours), matching YtdWageAccumulators.lniHundredthHours and the
-- L&I quarterly report, which is worked in hours rather than money.
-- ══════════════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────────────
-- §0  ORDERING GUARD
--
-- Standing rule 61: an out-of-order migration must refuse loudly and change
-- nothing, rather than half-apply and leave a shape nobody can reason about.
-- Every dependency below is one this file actually touches.
-- ──────────────────────────────────────────────────────────────────────────────
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


-- ══════════════════════════════════════════════════════════════════════════════
-- §2  PAYROLL RUN LINES — PER-TAX COLUMNS, ADDED BESIDE THE LUMP
--
-- STANDING RULE 25: EXTEND, DO NOT DUPLICATE — AND DO NOT DEMOLISH.
--
-- `taxes_cents` is NOT dropped and NOT renamed. Every existing row keeps its
-- value and every existing reader keeps working. Dropping it would turn a
-- schema improvement into a data-loss event for the pay runs already recorded,
-- whose per-tax detail genuinely no longer exists and cannot be reconstructed
-- by arithmetic. A summed column cannot be un-summed.
--
-- WHY EVERY NEW COLUMN IS NULLABLE WITH NO DEFAULT.
--
-- Standing rule 62d: never invent a default. A zero default here would be a lie
-- with a specific and expensive meaning — "we know no social security was
-- withheld on this line" — asserted about historical rows where the truth is
-- "nobody recorded it separately". Those are different claims. NULL says the
-- second one honestly, and the reconciliation engine can then distinguish a
-- line that has been split from a line that never was, instead of silently
-- reporting a year of zero withholding as fact.
-- ══════════════════════════════════════════════════════════════════════════════

-- The employee's own withholding, one column per tax, because each has its own
-- wage base and they cannot be recovered from a total.
alter table public.payroll_run_lines add column if not exists federal_income_tax_cents bigint;
alter table public.payroll_run_lines add column if not exists oasdi_employee_cents      bigint;
alter table public.payroll_run_lines add column if not exists medicare_employee_cents   bigint;
-- Additional Medicare is SEPARATE from ordinary Medicare rather than folded in.
-- It has a different rate (0.9%), a different trigger ($200,000 year to date),
-- and — the reason it must never be merged — NO EMPLOYER MATCH. Adding it to
-- medicare_employee_cents would make the employer's matching liability
-- overstate itself by 0.9% of every dollar above the threshold.
alter table public.payroll_run_lines add column if not exists addl_medicare_employee_cents bigint;

-- Washington employee-side withholdings. Both are real deductions from the
-- employee's cheque and neither is a tax the employer owes, so they belong here
-- and not in the employer block below.
alter table public.payroll_run_lines add column if not exists wa_pfml_employee_cents  bigint;
alter table public.payroll_run_lines add column if not exists wa_cares_employee_cents bigint;
-- L&I is split between employer and worker by statute; this is the worker half.
alter table public.payroll_run_lines add column if not exists wa_lni_employee_cents   bigint;

-- The employer's own liability. NOT withheld from the employee and NOT part of
-- net pay — kept on the line because it is incurred by this line's wages, and
-- because the 941 and 940 need it per period rather than per year.
alter table public.payroll_run_lines add column if not exists oasdi_employer_cents    bigint;
alter table public.payroll_run_lines add column if not exists medicare_employer_cents bigint;
alter table public.payroll_run_lines add column if not exists futa_employer_cents     bigint;
alter table public.payroll_run_lines add column if not exists wa_suta_employer_cents  bigint;
alter table public.payroll_run_lines add column if not exists wa_pfml_employer_cents  bigint;
alter table public.payroll_run_lines add column if not exists wa_lni_employer_cents   bigint;

-- The WAGES each tax was measured on, which is NOT the same as gross pay and is
-- not the same across taxes. Pre-tax deductions reduce some wage bases and not
-- others; the wage base ceiling truncates social security wages mid-period. The
-- W-2 reports WAGES in boxes 3 and 5, not gross, so the wages have to be stored
-- as their own figures rather than inferred by dividing tax by rate — which
-- would compound rounding error twenty-six times a year and, once the ceiling
-- is reached and the tax is zero, would divide by a rate to recover a wage
-- figure that is not zero at all.
alter table public.payroll_run_lines add column if not exists oasdi_wages_cents    bigint;
alter table public.payroll_run_lines add column if not exists medicare_wages_cents bigint;
alter table public.payroll_run_lines add column if not exists futa_wages_cents     bigint;
alter table public.payroll_run_lines add column if not exists wa_suta_wages_cents  bigint;
alter table public.payroll_run_lines add column if not exists wa_pfml_wages_cents  bigint;
alter table public.payroll_run_lines add column if not exists wa_cares_wages_cents bigint;
-- L&I premiums are assessed on HOURS WORKED, not on wages. Hundredth-hours.
alter table public.payroll_run_lines add column if not exists lni_hundredth_hours  bigint;

comment on column public.payroll_run_lines.taxes_cents is
  -- NO SEMICOLONS INSIDE THIS STRING. A splitter that does not track quotes
  -- cuts the statement at the first one it sees and every following fragment
  -- becomes garbage in the Supabase SQL editor. That is not hypothetical: it
  -- is the class of transit hazard that cost Michael two failed pastes on
  -- 0195, and tests/compliance/migration-editor-safe-copy.test.ts counts them.
  'books-34: SUPERSEDED but deliberately retained. Historical rows hold a single manually-typed total whose per-tax detail was never recorded and cannot be reconstructed. New rows populate the per-tax columns. This column stays for those older rows and for readers written before 0199.';
comment on column public.payroll_run_lines.addl_medicare_employee_cents is
  'books-34: Additional Medicare Tax (0.9% above $200,000 YTD). Kept separate from medicare_employee_cents because THE EMPLOYER DOES NOT MATCH IT.';
comment on column public.payroll_run_lines.oasdi_wages_cents is
  'books-34: social security WAGES for this line, already truncated at the annual wage base. W-2 box 3 is built from the sum of these, not from gross pay.';


-- ══════════════════════════════════════════════════════════════════════════════
-- §3  THE ACCUMULATORS — the memory the pay run never had
--
-- One row per employee per CALENDAR year. Calendar, not fiscal and not the
-- employer's plan year, because every ceiling this table exists to enforce is
-- defined on the calendar year and the W-2 is a calendar-year document.
--
-- These are DERIVED figures: each one is the sum of the corresponding column
-- across that employee's posted payroll_run_lines for the year. Storing a
-- derived value is a deliberate trade and it earns its keep twice — the running
-- total is read on every single pay run and must be fast, and it must be
-- STABLE, because a figure recomputed from scratch each time silently changes
-- whenever a historical line is corrected, which is precisely how withholding
-- becomes unexplainable after the fact.
--
-- The trade has a price: a stored total can drift from the lines beneath it.
-- That price is paid openly. `last_run_id` and `last_recomputed_at` below make
-- drift detectable, and the engine ships a reconciliation that recomputes from
-- the lines and reports any difference rather than quietly overwriting it.
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.payroll_ytd_accumulators (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,

  -- The calendar year these totals belong to. Bounded on both sides: an
  -- employee cannot accrue 2026 wages in the year 1900, and a four-digit typo
  -- in a date field is one of the few data errors a database can catch by
  -- itself. The lower bound is 2020 rather than "whenever Greenway opened",
  -- because inventing a founding year here would be a guess (rule 62d) and the
  -- point of the check is to catch typos, not to assert history.
  tax_year    integer not null check (tax_year between 2020 and 2100),

  -- ── THE SEVEN FIGURES, matching YtdWageAccumulators field for field ────────
  -- Named to mirror the TypeScript exactly, so a reader moving between the
  -- engine and the schema is never translating.
  --
  -- Social security wages, capped by law at the annual wage base.
  oasdi_wages_cents    bigint not null default 0,
  -- Medicare wages. NO CEILING — this is why one "wages" column would be wrong.
  medicare_wages_cents bigint not null default 0,
  futa_wages_cents     bigint not null default 0,
  wa_suta_wages_cents  bigint not null default 0,
  wa_pfml_wages_cents  bigint not null default 0,
  wa_cares_wages_cents bigint not null default 0,
  -- Hours, not money. L&I premiums are assessed per hour worked.
  lni_hundredth_hours  bigint not null default 0,

  -- ── THE TAXES ACTUALLY WITHHELD, year to date ─────────────────────────────
  -- Carried alongside the wages because the SSA's rejection conditions are
  -- relationships BETWEEN a tax and its wage figure, and a constraint cannot
  -- compare two columns that do not live in the same row.
  oasdi_employee_cents         bigint not null default 0,
  medicare_employee_cents      bigint not null default 0,
  addl_medicare_employee_cents bigint not null default 0,
  federal_income_tax_cents     bigint not null default 0,

  -- ── DRIFT DETECTION ───────────────────────────────────────────────────────
  -- Which pay run last contributed, and when the totals were last rebuilt from
  -- the lines. Without these a stored total is an assertion with no provenance.
  last_run_id        uuid references public.payroll_runs(id) on delete set null,
  last_recomputed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ── DEFAULTS ARE ZERO HERE, AND THAT IS NOT A CONTRADICTION OF RULE 62d ───
  -- On payroll_run_lines a zero default would have invented a fact about a
  -- historical row. Here the row IS the year's running total, and a year that
  -- has just begun genuinely has zero wages in it. Zero is the measured truth
  -- at the moment of creation, not a stand-in for an unknown.

  -- ── ONE ROW PER EMPLOYEE PER YEAR ─────────────────────────────────────────
  -- Not merely tidiness. Two accumulator rows for one employee-year means two
  -- different answers to "has this employee passed the wage base", and the pay
  -- run would take whichever the query happened to return first.
  constraint payroll_ytd_one_row_per_employee_year unique (employee_id, tax_year),

  -- ── THE SSA'S OWN REJECTION CONDITIONS, AS CONSTRAINTS ────────────────────
  -- Each of the three below is one bullet of the SSA rejection paragraph
  -- quoted in the header. They are enforced HERE, at write time, rather than
  -- discovered in January by a rejected wage report.

  -- SSA bullet 1: "Medicare wages and tips are less than the sum of social
  -- security wages and social security tips." Medicare has no ceiling and
  -- social security does, so medicare wages are always >= oasdi wages. If this
  -- ever inverts, the accumulation logic is wrong.
  constraint payroll_ytd_medicare_ge_oasdi
    check (medicare_wages_cents >= oasdi_wages_cents),

  -- SSA bullet 2: "Social security tax is greater than zero; social security
  -- wages and social security tips are equal to zero." Tax without wages is a
  -- rejected report.
  constraint payroll_ytd_no_oasdi_tax_without_wages
    check (oasdi_employee_cents = 0 or oasdi_wages_cents > 0),

  -- SSA bullet 3: "Medicare tax is greater than zero; Medicare wages and tips
  -- are equal to zero."
  constraint payroll_ytd_no_medicare_tax_without_wages
    check (medicare_employee_cents = 0 or medicare_wages_cents > 0),

  -- IRS pre-filing checklist: "Make sure that the social security wage amount
  -- for each employee does not exceed the annual social security wage base
  -- limit ($184,500 for 2026)."
  --
  -- THE CEILING IS NOT HARDCODED, and the reason matters. The wage base is
  -- indexed and changes most years; a literal 18450000 here would silently
  -- become wrong in 2027 and would have to be found by whoever noticed. What
  -- IS permanent is that a ceiling EXISTS. This constraint therefore encodes
  -- the invariant that survives every annual adjustment — social security
  -- wages can never exceed medicare wages, already covered above — plus a
  -- sanity bound that no single employee-year reaches a hundred million
  -- dollars, which catches a units error (dollars typed where cents belong)
  -- without asserting a figure that expires. The YEAR-SPECIFIC ceiling is
  -- enforced in the engine, where the year is known and the authority for it
  -- is cited.
  constraint payroll_ytd_sane_magnitude
    check (
      oasdi_wages_cents    between 0 and 10000000000 and
      medicare_wages_cents between 0 and 10000000000 and
      futa_wages_cents     between 0 and 10000000000 and
      wa_suta_wages_cents  between 0 and 10000000000 and
      wa_pfml_wages_cents  between 0 and 10000000000 and
      wa_cares_wages_cents between 0 and 10000000000
    ),

  -- Negative wages are not a correction, they are a bug. A refund or a reversal
  -- is expressed by unwinding the contributing LINE, which lowers the total
  -- through the same path that raised it.
  constraint payroll_ytd_no_negative_taxes
    check (
      oasdi_employee_cents         >= 0 and
      medicare_employee_cents      >= 0 and
      addl_medicare_employee_cents >= 0 and
      federal_income_tax_cents     >= 0
    ),

  constraint payroll_ytd_no_negative_hours
    check (lni_hundredth_hours >= 0),

  -- FUTA is capped at $7,000 per employee per year by 26 U.S.C. §3306(b)(1),
  -- and unlike the social security wage base that figure has not moved since
  -- 1983. It is still not hardcoded as an equality — only as a ceiling that
  -- cannot be exceeded — so that a future statutory increase relaxes rather
  -- than breaks. 700000 cents = $7,000.
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

-- Read on every pay run: "what has this employee earned this year". The unique
-- constraint above already indexes (employee_id, tax_year); this one serves the
-- other direction — every employee's totals for one year, which is how the
-- quarterly and annual reports read the table.
create index if not exists payroll_ytd_accumulators_year_idx
  on public.payroll_ytd_accumulators (tax_year, employee_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- §4  updated_at
-- ══════════════════════════════════════════════════════════════════════════════
drop trigger if exists payroll_ytd_accumulators_set_updated_at on public.payroll_ytd_accumulators;
create trigger payroll_ytd_accumulators_set_updated_at
  before update on public.payroll_ytd_accumulators
  for each row execute function public.set_updated_at();


-- ══════════════════════════════════════════════════════════════════════════════
-- §5  ROW LEVEL SECURITY — owner only
--
-- Year-to-date wages are among the most sensitive figures the system holds: one
-- row states what a named person has earned so far this year. Same posture as
-- every other payroll table since 0185 — the owner, and nobody else. Notably
-- there is no employee-self-select policy here, deliberately: an employee's own
-- year-to-date figures reach them through their pay stub, which is a rendered
-- document with an audit trail, not through direct table access.
-- ══════════════════════════════════════════════════════════════════════════════
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
