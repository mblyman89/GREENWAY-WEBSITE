-- ══════════════════════════════════════════════════════════════════════════════
-- 0203  THE FOUR FACTS A W-2 NEEDS AND THIS DATABASE CANNOT CURRENTLY STATE
--
-- books-46, slice A. Found while wiring the W-2 engine to real data, not while
-- planning it. The engine (src/lib/payroll/form-w2-core.ts) was built, tested
-- against published IRS figures, and mutation tested. Then the store was
-- started, and the store could not be written, because the facts the engine
-- requires are not in this database.
--
-- ──────────────────────────────────────────────────────────────────────────────
-- WHAT WAS MISSING, AND WHY EACH ONE IS NOT A NICETY
-- ──────────────────────────────────────────────────────────────────────────────
--
-- GAP 1 — THERE IS NO LEGAL NAME, ONLY A DISPLAY NAME.
--
-- public.employees has ONE name column, `full_name` (0037), and it is the name
-- the timeclock shows. Box e of the W-2 is not one field:
--
--     "Box e—Employee's name. Enter the name as shown on your employee's social
--      security card (first name, middle initial, last name)... If the name does
--      not fit in the space allowed on the form, you may show the first and
--      middle name initials and the full last name."
--                     — IRS General Instructions for Forms W-2 and W-3, Box e
--
-- The obvious shortcut is to split `full_name` on the last space. That is a
-- GUESS, and standing rule 1 forbids it. It is also wrong for a large fraction
-- of real names: compound surnames ("Van Der Berg"), surnames recorded first,
-- suffixes ("Jr", "III"), and single-word legal names. A wrong split produces a
-- W-2 the SSA cannot match to a social security number, and an SSA name/SSN
-- mismatch is a §6721 information-return penalty per form plus a corrected
-- W-2c. The display name is ALSO not necessarily the legal name — a person who
-- goes by "Mike" on the schedule is "Michael" on the card.
--
-- So the legal name parts are stored SEPARATELY and are nullable. Nullable
-- matters: absent must be distinguishable from entered, so the W-2 engine can
-- REFUSE rather than print a guess. `full_name` is untouched (rule 25) and
-- remains what every existing screen reads.
--
-- GAP 2 — NOTHING RECORDS WHO IS A 2% SHAREHOLDER-EMPLOYEE.
--
-- This is the fact that drives the single largest trap on Greenway's W-2. The
-- S corporation's payments for a 2%-or-more shareholder-employee's accident and
-- health premiums are wages for box 1 and are NOT wages for boxes 3 and 5. The
-- engine already implements it and refuses a premium recorded against someone
-- not flagged. But `W2EmployeeFacts.isTwoPercentShareholder` had no source.
--
-- public.gl_shareholders (0172) records OWNERSHIP — Michael 85%, his grandfather
-- 5%, his step-father 5% and his mother 5%, per the filed Form 1120-S (corrected
-- in books-50) — but it is a table of owners, not of employees. It has no
-- employee_id. Ownership and employment are genuinely different relations: his
-- mother is allocated income and is not an employee, and being a shareholder
-- does not by itself make someone a shareholder-EMPLOYEE. Matching the two
-- tables on `name` text would be a guess of exactly the kind that produces a
-- wrong number that looks right.
--
-- So this migration adds an explicit, nullable LINK from the employee to the
-- shareholder row, and lets the presence of that link answer the question.
-- Nullable and unset by default: "we have not said" must not read as "no".
--
-- GAP 3 — NOTHING RECORDS THE PREMIUMS THEMSELVES.
--
-- `scorpHealthPremiumCents` had no column either. It is per employee, per tax
-- year, because it is an annual total that lands on one specific W-2 — so it is
-- a small table keyed by (employee, year), not a column on employees.
--
-- GAP 4 — NOTHING RECORDS THAT A FORM WAS VOIDED.
--
-- `W2EmployeeFacts.isVoid` exists because a voided form still occupies a row and
-- must be excluded from the W-3 totals. Nothing stored it.
--
-- ──────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ──────────────────────────────────────────────────────────────────────────────
--
-- It does not populate anything. Not one row, not one default that stands in for
-- a fact. Michael's own legal name, his shareholder link, and his 2027 premium
-- figure are all things only he can supply, and inventing any of them here would
-- put a fabricated number on a federal information return. Every column added
-- below is nullable or defaulted to the SAFE value, and the W-2 engine refuses
-- to build a form when a required fact is absent. The refusal is the feature.
--
-- It does not touch box 12. Elective deferrals (code D), employer-sponsored
-- health coverage (DD), and HSA contributions (W) are not in scope for this
-- migration because Greenway does not currently operate any of those plans, and
-- creating empty tables for arrangements that do not exist is how a schema
-- acquires shapes nobody can explain later.
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
      'MIGRATION_OUT_OF_ORDER: 0203 gates the W-2 identity columns and the premium table on is_owner(), which does not exist yet. Run 0185_books_owner_only.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regprocedure('public.set_updated_at()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0203 attaches an updated_at trigger that calls set_updated_at(), which does not exist yet. Run 0001_slice1_foundation.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.employees') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0203 adds the W-2 legal-name and shareholder-link columns to public.employees, which does not exist yet. Run 0037_staffing_timeclock.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.gl_shareholders') is null then
    raise exception
      -- The %% is not a typo. RAISE treats % as a parameter placeholder, so a
      -- literal per-cent sign must be doubled. Written as a single % this
      -- guard raised "too few parameters specified for RAISE" at COMPILE time
      -- — which meant the whole precheck block failed to compile and the
      -- ordering guard could never fire at all. Caught by executing the file
      -- against PostgreSQL 15.18, not by reading it.
      'MIGRATION_OUT_OF_ORDER: 0203 points employees at public.gl_shareholders to record who is a 2%% shareholder-employee, and that table does not exist yet. Run 0172_gl_foundation.sql first, then run this file again. Nothing was changed.';
  end if;

  -- 0195 created ssn_full and, critically, the column-privilege gate that
  -- revokes SELECT on employees and grants it back column by column. This
  -- migration ADDS columns to that table, so it must re-run that grant loop at
  -- the end. If 0195 has not run, the loop below would grant privileges that
  -- 0195 then revokes, and the ordinary read path would break.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employees'
      and column_name = 'ssn_full'
  ) then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0203 re-runs the column-privilege grant loop that 0195 established on public.employees, and employees.ssn_full does not exist yet. Run 0195_employee_payroll_setup.sql first, then run this file again. Nothing was changed.';
  end if;
end
$precheck$;


-- ══════════════════════════════════════════════════════════════════════════════
-- §1  THE LEGAL NAME, AS THREE FIELDS
--
-- Nullable on purpose. An employee whose legal name has not been captured must
-- make the W-2 engine REFUSE, and a refusal requires a distinguishable "not
-- entered". A NOT NULL DEFAULT '' would make every existing employee look as
-- though their legal name were the empty string, which is a fact nobody stated.
-- ══════════════════════════════════════════════════════════════════════════════
alter table public.employees
  add column if not exists w2_first_name_and_initial text
    check (w2_first_name_and_initial is null
           or length(btrim(w2_first_name_and_initial)) > 0);

comment on column public.employees.w2_first_name_and_initial is
  'Box e, first part: first name and middle initial exactly as printed on the social security card. Separate from full_name because full_name is a DISPLAY name for the timeclock and may be a nickname. Nullable so that "not captured" is distinguishable from a value, which is what lets the W-2 engine refuse instead of guessing. The CHECK forbids a whitespace-only string, which would otherwise pass a NOT NULL test while being just as absent.';

alter table public.employees
  add column if not exists w2_last_name text
    check (w2_last_name is null or length(btrim(w2_last_name)) > 0);

comment on column public.employees.w2_last_name is
  'Box e, second part: surname as printed on the social security card. Stored separately rather than split from full_name at read time, because splitting a name on the last space is a guess that fails on compound surnames, surnames recorded first, and single-word legal names — and the cost of the guess is an SSA name/SSN mismatch, a per-form 6721 penalty, and a W-2c.';

alter table public.employees
  add column if not exists w2_name_suffix text
    check (w2_name_suffix is null or length(btrim(w2_name_suffix)) > 0);

comment on column public.employees.w2_name_suffix is
  'Box e, optional third part: Jr, Sr, III. Its own column because a suffix concatenated into the surname is a mismatch, and one appended to the first-name field is a different mismatch.';


-- ══════════════════════════════════════════════════════════════════════════════
-- §2  WHO IS A 2% SHAREHOLDER-EMPLOYEE
--
-- A LINK, not a boolean. The link carries strictly more information than a flag:
-- it says WHICH owner this employee is, which is what a later Schedule K-1 and
-- Form 7203 will need. A bare boolean would have to be reconciled against
-- gl_shareholders by hand, and the two would eventually disagree.
--
-- NULL means "this employee is not a shareholder-employee, or we have not said
-- so". Those two readings are deliberately NOT separated here, because the
-- engine's behaviour is identical for both: no premium may be recorded, and
-- box 1 gets no addition. The moment they need separating, that is a new
-- column with its own comment, not a re-reading of NULL.
-- ══════════════════════════════════════════════════════════════════════════════
alter table public.employees
  add column if not exists gl_shareholder_id uuid
    references public.gl_shareholders(id) on delete restrict;

comment on column public.employees.gl_shareholder_id is
  'Set when this employee is also an owner, which is what makes them a 2%-or-more shareholder-EMPLOYEE for IRC 1372 purposes. NULL for ordinary staff. A LINK rather than a boolean so it cannot disagree with gl_shareholders, and so Form 7203 and the K-1 can follow it later. ON DELETE RESTRICT because deleting an owner row out from under a filed W-2 would silently change how that W-2 should have been built.';

create index if not exists employees_gl_shareholder_idx
  on public.employees (gl_shareholder_id) where gl_shareholder_id is not null;

-- Two employees must not both claim to be the same owner. That would double
-- one person's shareholder-employee status across two W-2s.
create unique index if not exists employees_one_per_shareholder_idx
  on public.employees (gl_shareholder_id) where gl_shareholder_id is not null;


-- ══════════════════════════════════════════════════════════════════════════════
-- §3  THE VOID FLAG
--
-- Defaulted to false, which is the safe value: a form is not void unless
-- somebody says it is. This is the one column here that can safely carry a
-- default, because "no" and "unstated" genuinely mean the same thing for a void.
-- ══════════════════════════════════════════════════════════════════════════════
alter table public.employees
  add column if not exists w2_void boolean not null default false;

comment on column public.employees.w2_void is
  'True when this person''s W-2 for the current year has been voided. A voided form still EXISTS as a row — it is printed with the VOID box checked — but it must be excluded from every W-3 total. Defaulted false because unstated and no are the same thing for a void, unlike the name and shareholder fields above.';


-- ══════════════════════════════════════════════════════════════════════════════
-- §4  SHAREHOLDER HEALTH PREMIUMS, PER EMPLOYEE PER YEAR
--
-- WHY A TABLE AND NOT A COLUMN. The figure is an ANNUAL total that lands on ONE
-- year's W-2. A column on employees would hold only the current year and would
-- be overwritten each January, destroying the basis for any prior-year W-2c.
--
-- WHY IT IS NOT ON payroll_ytd_accumulators. That table is fed by pay runs and
-- is rebuilt from them. This figure is not produced by a pay run — it is what
-- the corporation paid an insurer — so storing it there would mix a derived
-- accumulator with a stated fact, and the next rebuild would erase it.
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.employee_scorp_health_premiums (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,

  -- CALENDAR year. Box 1 is a calendar-year figure regardless of the S
  -- corporation's tax year, and the bounds catch a four-digit typo the same way
  -- 0199 does.
  tax_year      integer not null check (tax_year between 2020 and 2100),

  -- Whole cents. Never negative: a refund of premiums is a different event and
  -- must be recorded as such rather than as a negative premium, because a
  -- negative here would silently REDUCE box 1 below the wages actually paid.
  premium_cents bigint not null check (premium_cents >= 0),

  -- Where the figure came from. Free text, and required, because an amount that
  -- lands in box 1 of a federal information return must be traceable to a
  -- document. This is the field that makes the number defensible in an audit.
  source_note   text not null check (length(btrim(source_note)) > 0),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One figure per person per year. Two rows would silently double box 1.
  unique (employee_id, tax_year)
);

comment on table public.employee_scorp_health_premiums is
  'Accident and health insurance premiums the S corporation paid for a 2%-or-more shareholder-employee, per calendar year. These are wages for box 1 and NOT wages for boxes 3 and 5 — the single largest trap on an S-corp W-2. Keyed by year rather than stored as a column on employees so that a prior year''s figure survives for a W-2c. source_note is NOT NULL because a number that reaches box 1 must be traceable to a document.';

comment on column public.employee_scorp_health_premiums.premium_cents is
  'Whole cents, never negative. A premium REFUND is a separate event and must not be entered as a negative premium here, because that would reduce box 1 below the wages actually paid and the W-2 would understate the shareholder''s income.';

drop trigger if exists trg_employee_scorp_health_premiums_updated
  on public.employee_scorp_health_premiums;
create trigger trg_employee_scorp_health_premiums_updated
  before update on public.employee_scorp_health_premiums
  for each row execute function public.set_updated_at();

create index if not exists employee_scorp_health_premiums_year_idx
  on public.employee_scorp_health_premiums (tax_year, employee_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- §5  OWNER-ONLY ACCESS TO THE PREMIUM TABLE
--
-- A shareholder's health premium is compensation detail for the owner. It is not
-- roster data, and no manager needs it. Same gate 0199 uses for the year-to-date
-- accumulators.
-- ══════════════════════════════════════════════════════════════════════════════
alter table public.employee_scorp_health_premiums enable row level security;

drop policy if exists employee_scorp_health_premiums_owner_all
  on public.employee_scorp_health_premiums;
create policy employee_scorp_health_premiums_owner_all
  on public.employee_scorp_health_premiums
  for all
  using (public.is_owner())
  with check (public.is_owner());


-- ══════════════════════════════════════════════════════════════════════════════
-- §6  RE-RUN 0195'S COLUMN-PRIVILEGE GRANT LOOP
--
-- THIS SECTION IS THE WHOLE REASON THIS MIGRATION IS DANGEROUS TO GET WRONG,
-- AND IT IS WRITTEN DOWN BECAUSE IT IS NOT OBVIOUS.
--
-- 0195 revoked SELECT on public.employees from `authenticated` and granted it
-- back one column at a time, omitting ssn_full. That grant was made against the
-- columns that existed AT THAT MOMENT. Column privileges do not extend to
-- columns added later — a column added after that loop has NO grant, and a
-- SELECT naming it fails with "permission denied for table employees".
--
-- 0195's own comments record this exact failure: ssn_last_four was originally
-- created after the loop, and the migration only worked when applied twice.
--
-- §1, §2 and §3 above add four new columns to that table. Without re-running the
-- loop, every ordinary screen that selects them would be denied, and the failure
-- would look like a permissions bug rather than a missing grant.
--
-- The loop is reproduced rather than extracted into a function because 0195 did
-- not create one to reuse, and inventing a shared function here would change
-- 0195's behaviour retroactively for anyone re-running it.
-- ══════════════════════════════════════════════════════════════════════════════
do $ssn_col_gate_rerun$
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
end
$ssn_col_gate_rerun$;


-- ══════════════════════════════════════════════════════════════════════════════
-- §7  WHAT MICHAEL MUST STILL SUPPLY
--
-- Nothing below is guessed, so nothing below is populated. Before the first W-2
-- can be built for tax year 2027, these must be entered:
--
--   1. w2_first_name_and_initial, w2_last_name (and w2_name_suffix if any) for
--      every person who will receive a W-2 — read from the social security card,
--      not from memory and not from full_name.
--
--   2. gl_shareholder_id on Michael's own employee row, pointing at his row in
--      gl_shareholders. His grandfather too, if the grandfather is an employee
--      as well as an owner. His mother is allocated income and is not an
--      employee, so she gets no employee row and no W-2.
--
--   3. One row in employee_scorp_health_premiums for the 2027 tax year with the
--      actual premium total and a source_note naming the document it came from.
--
-- Until then the W-2 engine refuses, by design, and says which of these is
-- missing. A refusal in October is a bookkeeping task. A guess in January is a
-- corrected return.
-- ══════════════════════════════════════════════════════════════════════════════
