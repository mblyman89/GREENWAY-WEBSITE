-- ══════════════════════════════════════════════════════════════════════════════
-- 0204  WHAT WAS ACTUALLY FILED ON THE FOUR 941s
--
-- books-46, slice A. Found while wiring the W-2 store, not while planning it.
--
-- ──────────────────────────────────────────────────────────────────────────────
-- THE DEFECT THIS FIXES, AND HOW IT WAS FOUND
-- ──────────────────────────────────────────────────────────────────────────────
--
-- src/lib/payroll/form-w2-core.ts exports `reconcileW3To941s`. It is the most
-- important function on the W-2 screen, because a W-2 is an INFORMATION return:
-- the question is never "is this arithmetic right" (the engine guarantees that)
-- but "does it AGREE with what was already reported". The IRS says so directly:
--
--     "You may be contacted by the IRS and SSA if your Forms W-2 do not
--      reconcile with the totals reported on your Forms 941."
--                          — IRS General Instructions for Forms W-2 and W-3
--
-- Note "will be contacted", not "may consider". The reconciliation is the whole
-- point of the screen.
--
-- That function takes a `Form941YearTotals`. Grepping for producers of that
-- type across the entire repository returned TWO hits, both inside
-- tests/compliance/form-w2-core.test.ts. Nothing in src/ has ever built one.
--
-- So the reconciliation engine was fully written, fully tested, mutation
-- tested — and UNREACHABLE FROM THE RUNNING APPLICATION. Standing rule 50:
-- dead code wearing a green check. The tests passed because the tests supplied
-- the input the application could not.
--
-- ──────────────────────────────────────────────────────────────────────────────
-- WHY THE OBVIOUS FIX IS THE WRONG FIX
-- ──────────────────────────────────────────────────────────────────────────────
--
-- The tempting repair is to sum `payroll_run_lines` for the year and call the
-- result "the 941 side". It would compile, it would be quick, and it would
-- destroy the entire value of the check.
--
-- The W-2 side of the comparison already comes from `payroll_ytd_accumulators`,
-- which is itself fed from `payroll_run_lines`. If the 941 side were summed
-- from the same table, both sides of the reconciliation would descend from ONE
-- source and would therefore agree TRIVIALLY, ALWAYS. Every quarter would show
-- five green ticks, forever, including the quarter where a 941 was filed with a
-- transposed figure. That is standing rule 39 — a gate that parses nothing
-- approves everything — applied to the highest-stakes screen in the payroll
-- module.
--
-- The comparison has value for exactly one reason: THE TWO SIDES ARE
-- INDEPENDENT. One is what the W-2s say today. The other is what was actually
-- transmitted to the federal government on four separate occasions, months
-- apart, possibly by hand, possibly with a typo. Independence is the mechanism.
-- Remove it and there is no check, only its appearance.
--
-- ──────────────────────────────────────────────────────────────────────────────
-- SO WHAT IS MISSING IS A RECORD OF WHAT LEFT THE BUILDING
-- ──────────────────────────────────────────────────────────────────────────────
--
-- Grepping the migrations for any table storing a filed return returned
-- nothing. `loadForm941` RECOMPUTES the quarter from the pay runs every time
-- the screen is opened. It is a calculator, not a filing cabinet.
--
-- That is a real gap independent of the W-2. If a pay run is edited in
-- September, the Q2 screen silently starts showing different figures from the
-- Q2 return that was filed in July, and nothing anywhere records the
-- difference. The screen cannot tell Michael "this no longer matches what you
-- filed" because it does not know what he filed.
--
-- This migration adds that filing cabinet. Michael types in what he actually
-- submitted, from the return in his hand. Those figures are then a FIXED,
-- INDEPENDENT record that the W-3 can be compared against.
--
-- ──────────────────────────────────────────────────────────────────────────────
-- WHY THE FIGURES ARE TYPED IN AND NOT IMPORTED
-- ──────────────────────────────────────────────────────────────────────────────
--
-- Because typing them in is what makes them independent, and independence is
-- the feature. This is the same reason a bank reconciliation uses the bank's
-- statement and not a second copy of the cash book.
--
-- It is also honest about the project boundary. This system prepares figures;
-- it is not a filing agent and it does not transmit anything. Michael files
-- every return himself. The authoritative record of what was filed is
-- therefore the paper in his hand, and this table is where that paper is
-- transcribed — with the date he filed it, so the transcription is anchored to
-- an event and not to a guess.
--
-- ──────────────────────────────────────────────────────────────────────────────
-- WHY THE COLUMNS ARE 941 LINE NUMBERS AND NOT W-2 BOX NUMBERS
-- ──────────────────────────────────────────────────────────────────────────────
--
-- Michael will be reading these values off a Form 941. The column names must
-- match what is printed next to the number on the page he is copying from, or
-- transcription becomes translation and translation is where transposition
-- happens. Each column below names its line and says what the engine field it
-- feeds is called, so the seam is legible from both sides (rule 63d).
--
-- One column deliberately does NOT correspond to a printed line: see §2 on
-- Additional Medicare Tax, which is the single hardest thing about this
-- reconciliation and the reason `reconcileW3To941s` takes a fourth argument.
-- ══════════════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────────────
-- §0  ORDERING GUARD
--
-- Standing rule 61: an out-of-order migration must refuse loudly and change
-- nothing. Every dependency named below is one this file actually touches.
-- ──────────────────────────────────────────────────────────────────────────────
do $precheck$begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0204 gates the filed-941 table on is_owner(), which does not exist yet. Run 0185_books_owner_only.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regprocedure('public.set_updated_at()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0204 attaches an updated_at trigger that calls set_updated_at(), which does not exist yet. Run 0001_slice1_foundation.sql first, then run this file again. Nothing was changed.';
  end if;
end
$precheck$;


-- ══════════════════════════════════════════════════════════════════════════════
-- §1  THE FILED RETURN, ONE ROW PER QUARTER
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.filed_form_941_totals (
  id          uuid primary key default gen_random_uuid(),

  -- The quarter this return covered. `quarter` is 1-4 and is CHECKed rather
  -- than left to the application, because a 5 here would silently make a
  -- four-quarter reconciliation add up to five quarters of wages.
  tax_year    integer not null check (tax_year between 2020 and 2100),
  quarter     smallint not null check (quarter between 1 and 4),

  -- ── THE FIVE FIGURES `Form941YearTotals` NEEDS ────────────────────────────
  -- Named for the LINE Michael reads them from. Every one is whole cents and
  -- every one is non-negative: a 941 line cannot be negative, and a negative
  -- here would make a reconciliation difference point the wrong way, which is
  -- worse than no answer because it sends him looking in the wrong quarter.

  -- Line 3. Feeds Form941YearTotals.federalIncomeTaxWithheldCents.
  -- Compared against W-3 box 2.
  line_3_federal_income_tax_cents bigint not null check (line_3_federal_income_tax_cents >= 0),

  -- Line 5a COLUMN 1 — the WAGES, not the tax. Feeds
  -- Form941YearTotals.socialSecurityWagesCents. Compared against W-3 box 3.
  --
  -- THIS IS THE COLUMN MOST LIKELY TO BE FILLED IN WRONG, and the reason is
  -- printed on the form itself: line 5a reads "Taxable social security wages
  -- x 0.124", so there are TWO numbers on that line — the base and the tax.
  -- The wage base is the left-hand one. Getting this wrong overstates the
  -- comparison by a factor of about eight and produces a difference so large
  -- it looks like a system fault rather than a typo, so the column comment
  -- below says which number to copy.
  line_5a_ss_wages_cents bigint not null check (line_5a_ss_wages_cents >= 0),

  -- Line 5a COLUMN 2 — the TAX, both halves. Feeds
  -- Form941YearTotals.socialSecurityTaxCents. Compared against W-3 box 4
  -- DOUBLED, because the 941 carries the employer match and the W-3 does not.
  line_5a_ss_tax_cents bigint not null check (line_5a_ss_tax_cents >= 0),

  -- Line 5c column 1 — Medicare WAGES. Feeds
  -- Form941YearTotals.medicareWagesCents. Compared against W-3 box 5.
  line_5c_medicare_wages_cents bigint not null check (line_5c_medicare_wages_cents >= 0),

  -- Lines 5c + 5d TAX together. Feeds Form941YearTotals.medicareTaxCents.
  -- 5c is ordinary Medicare, both halves. 5d is Additional Medicare Tax,
  -- employee only. They are summed because the W-3's box 6 also contains both
  -- of them added together, and a comparison must put like against like.
  line_5c_5d_medicare_tax_cents bigint not null check (line_5c_5d_medicare_tax_cents >= 0),

  -- ── PROVENANCE ────────────────────────────────────────────────────────────
  -- The date the return was actually filed. NOT NULL because this row's whole
  -- claim is "this is what was filed", and a claim about a filing with no
  -- filing date is an assertion with nothing behind it. It is also the field
  -- that lets a later screen say "filed 31 July, but the pay runs have been
  -- edited since" — which is the drift this table exists to make visible.
  filed_on    date not null,

  -- Where the figures came from. Required, same reasoning as
  -- employee_scorp_health_premiums.source_note in 0203: a number that decides
  -- whether a federal information return gets filed must be traceable to a
  -- document.
  source_note text not null check (length(btrim(source_note)) > 0),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- One filed return per quarter. A second row would let a four-quarter total
  -- silently double one quarter, and the reconciliation would then disagree by
  -- exactly one quarter's wages — a difference that looks like a missing pay
  -- run and would send Michael hunting in entirely the wrong place.
  --
  -- An AMENDED return (941-X) is deliberately NOT a second row here. When that
  -- becomes real it needs its own table with its own columns, because a 941-X
  -- reports CORRECTIONS (differences), not totals, and storing a difference in
  -- a column named "total" is how a schema becomes unreadable. Until then this
  -- constraint refuses rather than guesses.
  unique (tax_year, quarter)
);

comment on table public.filed_form_941_totals is
  'What was ACTUALLY FILED on each Form 941, transcribed by hand from the filed return. This is NOT computed and must never be: it is the independent side of the W-2/W-3 reconciliation. The other side (payroll_ytd_accumulators) descends from payroll_run_lines, so if this table were also derived from pay runs both sides would agree trivially and the reconciliation would be a green tick that means nothing. Independence is the entire mechanism. Consumed by reconcileW3To941s in src/lib/payroll/form-w2-core.ts.';

comment on column public.filed_form_941_totals.line_5a_ss_wages_cents is
  'Line 5a, the LEFT-hand number: taxable social security WAGES, not the tax. Line 5a prints as "Taxable social security wages x 0.124" and therefore shows two figures; copy the base, not the product. Compared against W-3 box 3, which is also wages after the annual cap, so the two must match to the cent.';

comment on column public.filed_form_941_totals.line_5a_ss_tax_cents is
  'Line 5a, the RIGHT-hand number: the social security tax, which on a 941 is BOTH halves (12.4%). The W-3 box 4 reports only the employee half, so the reconciliation expects this to be exactly DOUBLE box 4. If it equals box 4 the employer match was omitted; if it is four times, something was double counted.';

comment on column public.filed_form_941_totals.line_5c_5d_medicare_tax_cents is
  'Line 5c tax PLUS line 5d tax, added together. 5c is ordinary Medicare at 2.9% (both halves). 5d is the 0.9% Additional Medicare Tax on pay above the threshold, which has NO employer match. They are summed here because W-3 box 6 also contains both, and a reconciliation must compare like with like. The absence of an employer match on the 5d part is why the IRS says box 6 is only APPROXIMATELY twice the 941 figure — and why the amount of 5d must be recorded separately in §2 below.';

comment on column public.filed_form_941_totals.filed_on is
  'The date this return was actually submitted. NOT NULL because the row asserts "this is what was filed" and that assertion needs an event behind it. Also lets a screen detect that pay runs were edited AFTER a return was filed, which is drift that currently nothing in this system can see.';


-- ══════════════════════════════════════════════════════════════════════════════
-- §2  THE ADDITIONAL MEDICARE TAX, RECORDED SEPARATELY
--
-- THIS COLUMN IS THE SUBTLEST THING IN THIS FILE. It is recorded here, at
-- length, because the reason it must exist is not visible from the form.
--
-- `reconcileW3To941s` takes `unmatchedAdditionalMedicareCents` as a separate
-- argument and uses it like this (form-w2-core.ts):
--
--     matchedMedicare      = box6 - unmatchedAdditional
--     expectedMedicareTax  = matchedMedicare * 2 + unmatchedAdditional
--
-- Every OTHER FICA figure doubles cleanly between the W-3 and the 941, because
-- the employer matches it. Additional Medicare Tax does not: the employee pays
-- 0.9% on pay above the threshold and the employer pays nothing. So the part
-- of box 6 that is Additional Medicare must be counted ONCE and the rest
-- counted TWICE.
--
-- If this were folded into the Medicare tax column and assumed to be zero, the
-- reconciliation would expect too much tax by exactly the Additional Medicare
-- amount, and would report a difference on a return that was perfectly
-- correct. A false alarm on this screen is expensive in a specific way: it
-- teaches Michael that the red line is usually wrong, and the day it is right
-- he will not believe it.
--
-- DEFAULT ZERO IS SAFE HERE, AND THIS IS WHY — the default is not a guess.
-- Additional Medicare Tax applies only to wages above $200,000 for the year
-- (IRC 3101(b)(2)). Line 5d on a return with no such employee is genuinely
-- blank, so zero is not "we did not ask", it is the value the form carries.
-- Contrast 0203 §1, where a nullable column was required precisely because
-- absent had to be distinguishable from entered. The distinction is whether
-- there exists a real-world state the default misrepresents. Here there is
-- not; there, there was.
-- ══════════════════════════════════════════════════════════════════════════════
alter table public.filed_form_941_totals
  add column if not exists line_5d_addl_medicare_tax_cents bigint not null default 0
    check (line_5d_addl_medicare_tax_cents >= 0);

comment on column public.filed_form_941_totals.line_5d_addl_medicare_tax_cents is
  'Line 5d only: Additional Medicare Tax withheld, the 0.9% on wages above the annual threshold. Recorded SEPARATELY from 5c even though the two are summed in the column above, because this is the one FICA figure with NO employer match. The reconciliation counts it once and everything else twice; if it were assumed zero, a correct return would show a difference equal to this amount. Zero is a safe default because line 5d is genuinely blank when nobody was paid above the threshold — unlike the name columns in 0203, where absent had to stay distinguishable from entered.';

create index if not exists filed_form_941_totals_year_idx
  on public.filed_form_941_totals (tax_year, quarter);

drop trigger if exists trg_filed_form_941_totals_updated
  on public.filed_form_941_totals;
create trigger trg_filed_form_941_totals_updated
  before update on public.filed_form_941_totals
  for each row execute function public.set_updated_at();


-- ══════════════════════════════════════════════════════════════════════════════
-- §3  OWNER ONLY
--
-- A filed federal return is the owner's business. No manager needs it, and it
-- contains the company's full wage totals. Same gate 0199 and 0203 use.
-- ══════════════════════════════════════════════════════════════════════════════
alter table public.filed_form_941_totals enable row level security;

drop policy if exists filed_form_941_totals_owner_all on public.filed_form_941_totals;
create policy filed_form_941_totals_owner_all
  on public.filed_form_941_totals
  for all
  using (public.is_owner())
  with check (public.is_owner());


-- ══════════════════════════════════════════════════════════════════════════════
-- §4  WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
-- It populates nothing. Greenway's first payroll is 1 January 2027, so no 941
-- has been filed under this system and there is nothing truthful to insert.
-- The W-2 screen will report the comparison as NOT RUN — which is an honest
-- gold, not a green — until four rows exist for the year.
--
-- It does not create a 941-X table. A 941-X reports corrections, not totals,
-- and inventing its shape before a correction exists is how a schema acquires
-- columns nobody can explain. The unique constraint in §1 refuses the second
-- row rather than quietly accepting an amendment it cannot model.
--
-- It does not touch public.employees, so it does NOT need to re-run 0195's
-- column-privilege grant loop. That loop is required only when a column is
-- added to `employees` — see 0203 §6 for why. This file adds a new table with
-- ordinary table-level privileges, so the loop would be noise here, and
-- copying it "for safety" would revoke and regrant privileges for no reason
-- while implying a dependency that does not exist.
-- ══════════════════════════════════════════════════════════════════════════════
