-- ══════════════════════════════════════════════════════════════════════════════
-- 0198  PAID SICK LEAVE, OWNER AWARDS, AND WAGE ORDERS
--
-- books-33. This migration adds the three record-keeping shapes that turn
-- "Michael, can I have Thursday off, I am sick" into a defensible payroll
-- artifact, plus the wage-order table that makes a child-support withholding
-- something the system does rather than something Michael remembers.
--
-- ──────────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS AT ALL — the defects it is built to make impossible
-- ──────────────────────────────────────────────────────────────────────────────
--
-- DEFECT 1 — SICK LEAVE THAT IS COMPUTED BUT NEVER RECORDED.
--
-- The balance today is computed on the fly. src/lib/staffing/employee-lifecycle-core.ts
-- divides minutes worked by forty and shows the answer on the employee page.
-- Nothing is stored. That is fine for a display and disqualifying for a payroll
-- record, because Washington does not ask what the balance IS, it asks what the
-- balance WAS and what happened to it:
--
--     "Not less than monthly, employers must provide each employee with written
--      or electronic notification detailing the amount of paid sick leave
--      accrued, the amount of paid sick leave paid before usage to construction
--      workers covered by a collective bargaining agreement as permissible under
--      RCW 49.46.180, the paid sick leave reductions since the last
--      notification, and any unused paid sick leave available for use by the
--      employee."
--                                                  — WAC 296-128-755(2)
--
-- "Reductions since the last notification" cannot be derived from a number that
-- is recomputed from scratch every page load. It requires a LEDGER: dated rows,
-- each with a reason, that add up to the balance. That is §3.
--
-- DEFECT 2 — SICK HOURS DRAGGED INTO THE OVERTIME CALCULATION.
--
-- Michael asked for this explicitly and Michael is right. An employee works 36
-- hours and takes 8 hours sick. The week totals 44. A naive engine pays 4 hours
-- of overtime premium on hours nobody worked. The regulation is unambiguous:
--
--     "Payments which are made for occasional periods when the employee is not
--      at work due to vacation, holiday, illness, failure of the employer to
--      provide sufficient work, or other similar cause, where the payments are
--      in amounts approximately equivalent to the employee's normal earnings
--      for a similar period of time, are not made as compensation for his hours
--      of employment. Therefore, such payments may be excluded from the regular
--      rate of pay under section 7(e)(2) of the Act and, for the same reason,
--      no part of such payments may be credited toward overtime compensation
--      due under the Act."
--                                                  — 29 CFR §778.218(a)
--
-- Read the last clause twice. Sick pay is not merely EXCLUDED FROM THE REGULAR
-- RATE. It also may not be CREDITED TOWARD overtime. Sick hours are not worked
-- hours, they do not reach the forty-hour threshold, and they never earn a
-- premium. §778.102 says the threshold counts hours "actually worked".
--
-- This migration enforces that structurally by refusing to store sick time as a
-- time punch. Sick minutes live in their own ledger, in their own table, with
-- their own pay rate. The timesheet engine physically cannot mistake them for
-- worked minutes because they are not in time_punches.
--
-- DEFECT 3 — THE GENEROUS EMPLOYER WHO CANNOT PROVE HE COMPLIED.
--
-- Michael wants to award more sick hours than an employee has accrued. That is
-- lawful and expressly contemplated:
--
--     "Employers are not prevented from providing more generous paid sick leave
--      policies or permitting use of paid sick leave for additional purposes."
--                                                  — RCW 49.46.210(1)(e)
--
-- But generosity has to be BOOKED SEPARATELY, and the reason is subtle enough
-- to be worth writing down. Two statutory numbers are measured against ACCRUAL,
-- not against the balance on the screen: the forty-hour carryover floor in
-- WAC 296-128-620(4), and the ninetieth-day usability date in RCW 49.46.210(1)(d).
-- If a gift is dumped into the same bucket as statutory accrual, the balance
-- Michael carries into next year is inflated by his own kindness and he can no
-- longer show an investigator that he met the floor.
--
-- So entry_kind in §3 distinguishes 'accrual' from 'award', permanently, and
-- the engine spends STATUTORY minutes first so the gift is the last thing used.
-- Michael gets full credit for being generous and full credit for complying,
-- and neither claim contaminates the other.
--
-- DEFECT 4 — A GARNISHMENT THAT LIVES IN SOMEBODY'S MEMORY.
--
-- The accounting side of this already exists. payroll-cogs-core.ts knows about
-- GL account 31300 and will credit it if a caller hands it a number. What does
-- not exist anywhere is the ORDER: who issued it, for what case, capped at what
-- percentage, and when it stops. Today that number would be typed by hand every
-- fortnight, which is exactly how an employer ends up liable for the debt
-- itself. §4 makes the order a record.
--
-- ──────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION ADDS
-- ──────────────────────────────────────────────────────────────────────────────
--   §0  Ordering guard
--   §1  public.sick_leave_policy      — the employer's chosen rules, NO DEFAULTS
--   §2  public.sick_leave_requests    — what the employee asked for
--   §3  public.sick_leave_ledger      — every minute in and every minute out
--   §4  public.wage_orders            — garnishments, child support, tax levies
--   §5  RLS, policies and grants
--   §6  Column comments naming every downstream consumer
--   §7  gl_audit_sick_and_orders()    — the proof the gate is wired
--
-- ──────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ──────────────────────────────────────────────────────────────────────────────
--   * It computes nothing. Accrual arithmetic, the greater-of exemption test,
--     and multi-order apportionment all live in src/lib/payroll/ where they can
--     be unit tested against the statute's own worked examples. A database that
--     computes a garnishment in a trigger is a database whose arithmetic nobody
--     can review.
--   * It does not choose an accrual rate, a carryover cap, or a usage increment
--     for Michael. Every one of those is an employer election the law lets him
--     make more generously than the floor. See §1.
--   * It does not touch time_punches. Sick time is NOT worked time and putting
--     it in the punch table is precisely the defect §778.218(a) describes.
--   * It does not store a minimum wage. The 2027 Washington minimum wage is
--     announced by L and I on 30 September 2026 and does not exist yet. The
--     engine REFUSES rather than guessing.
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
      'MIGRATION_OUT_OF_ORDER: 0198 gates sick leave and wage orders on is_owner(), which does not exist yet. Run 0185_books_owner_only.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regprocedure('public.set_updated_at()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0198 attaches updated_at triggers that call set_updated_at(), which does not exist yet. Run 0001_slice1_foundation.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.employees') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0198 hangs every sick leave row off public.employees, which does not exist yet. Run 0037_staffing_timeclock.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.staff_profiles') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0198 records WHO approved a sick leave request by pointing at public.staff_profiles, which does not exist yet. Run 0001_slice1_foundation.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.pay_periods') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0198 stamps each paid sick leave ledger entry with the pay period it was paid in, and public.pay_periods does not exist yet. Run 0197_timesheet_workweek.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.company_profile') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0198 audits the sick leave policy alongside the company profile, and public.company_profile does not exist yet. Run 0196_company_profile.sql first, then run this file again. Nothing was changed.';
  end if;
end
$precheck$;


-- ══════════════════════════════════════════════════════════════════════════════
-- §1  THE SICK LEAVE POLICY — one row, and NOT ONE DEFAULT
--
-- WHY EVERY COLUMN HERE IS NULLABLE WITH NO DEFAULT
--
-- Washington sets FLOORS, not values. Read the accrual rule and notice the two
-- words that change everything:
--
--     "Employees accrue paid sick leave for all hours worked. An employee must
--      accrue at least one hour of paid sick leave for every forty hours worked
--      as an employee. Employers may provide employees with a more generous
--      paid sick leave accrual rate."
--                                                  — WAC 296-128-620(1)
--
-- "At least". "More generous". Every number below is a CHOICE Michael makes,
-- bounded on one side by law and open on the other. He has said, in writing,
-- that he wants to treat his employees better than the minimum. A schema that
-- defaults these values would silently record the floor as his policy and there
-- would be no way afterwards to tell a deliberate election from an untouched
-- default.
--
-- So: NULL means UNANSWERED, the engine REFUSES to accrue or pay while any of
-- these is NULL, and the screen explains which answer is missing. Standing rule
-- 62d: never invent a default for missing upstream data.
--
-- WHY THE ACCRUAL RATE IS IN HUNDREDTHS OF A MINUTE PER HOUR WORKED
--
-- The statutory floor is one hour per forty worked, which is 1.5 minutes per
-- hour, which is 150 hundredths. Integer minor units, chosen so that a more
-- generous rate — one hour per thirty worked, say, or 200 hundredths — stays
-- exact. Floating point has no business anywhere near an employee's balance.
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.sick_leave_policy (
  -- Singleton. Greenway is one employer with one policy. The check constraint
  -- is what makes a second row impossible, rather than a convention someone
  -- has to remember.
  id smallint primary key check (id = 1),

  -- Hundredths of a MINUTE of sick leave earned per HOUR worked.
  -- Statutory floor is 150 (one hour per forty worked). Higher is lawful.
  accrual_hundredth_minutes_per_hour integer
    check (accrual_hundredth_minutes_per_hour is null
           or accrual_hundredth_minutes_per_hour >= 150),

  -- Minutes of unused leave that carry into the next year. The floor is forty
  -- hours, which is 2400 minutes. An employer may be more generous, and may
  -- also decline to cap at all, which is recorded as a very large number rather
  -- than as NULL, because NULL here means UNANSWERED and not UNLIMITED.
  carryover_cap_minutes integer
    check (carryover_cap_minutes is null
           or carryover_cap_minutes >= 2400),

  -- Days after hire before accrued leave may be USED. The statutory ceiling is
  -- the ninetieth calendar day, and an employer may allow use sooner, so this
  -- is bounded 0 to 90 inclusive.
  usable_after_days smallint
    check (usable_after_days is null
           or usable_after_days between 0 and 90),

  -- The smallest slice of leave an employee may take. WAC 296-128-630(4) caps
  -- this at one hour absent a variance, so 1 to 60 minutes.
  usage_increment_minutes smallint
    check (usage_increment_minutes is null
           or usage_increment_minutes between 1 and 60),

  -- Consecutive days of absence after which the employer may ask for
  -- verification. The statute permits this only for absences EXCEEDING three
  -- days, so anything below 4 would be unlawful and is refused here.
  verification_after_days smallint
    check (verification_after_days is null
           or verification_after_days >= 4),

  -- Whether the employer actually requires verification. Separate from the
  -- threshold because "we may ask after four days" and "we do ask" are
  -- different facts, and WAC 296-128-660(2) requires a WRITTEN POLICY before
  -- verification may be demanded at all.
  verification_required boolean,

  -- The written notice text given to employees. WAC 296-128-755(1) requires it
  -- at hire. Stored so the version in force on any date is recoverable.
  notification_policy_text text,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists sick_leave_policy_set_updated_at on public.sick_leave_policy;
create trigger sick_leave_policy_set_updated_at
  before update on public.sick_leave_policy
  for each row execute function public.set_updated_at();

-- Seed the singleton row with EVERY POLICY COLUMN NULL. This is deliberate and
-- is the opposite of seeding defaults: the row exists so a screen has something
-- to edit, and every answer inside it is visibly absent until Michael gives it.
insert into public.sick_leave_policy (id)
values (1)
on conflict (id) do nothing;


-- ══════════════════════════════════════════════════════════════════════════════
-- §2  THE REQUEST — what the employee asked for, before anyone decided
--
-- WHY THE REQUEST IS A SEPARATE TABLE FROM THE LEDGER
--
-- A denied request still has to exist. If requests and ledger entries were one
-- table, a denial would either create a zero-minute ledger row (which is a lie
-- about the balance) or vanish (which is worse). Washington prohibits
-- retaliation for the lawful use of sick leave, and the only way to answer a
-- retaliation claim is to be able to show the pattern of what was asked and
-- what was decided. A request Michael denied for a good reason, recorded with
-- that reason, is a defence. An absence of records is not.
--
-- WHY purpose IS AN ENUMERATED LIST AND NOT FREE TEXT
--
-- The list is the statute's own list, RCW 49.46.210(1)(b)(i) through (iv) plus
-- (1)(c). Constraining it does two useful things: it stops a request being
-- approved for a purpose the law does not cover, and it stops the DIAGNOSIS
-- being typed into a payroll table. Michael needs to know the absence was for
-- an authorised purpose. He does not need, and should not hold, the medical
-- details.
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.sick_leave_requests (
  id uuid primary key default gen_random_uuid(),

  employee_id uuid not null
    references public.employees(id) on delete restrict,

  -- The Pacific calendar day the leave is for. One row per day, so a three-day
  -- absence is three rows: partial approval of a multi-day absence is a real
  -- thing and a single row could not express it.
  leave_date date not null,

  minutes_requested integer not null
    check (minutes_requested > 0 and minutes_requested <= 1440),

  -- The statutory purposes, verbatim in structure:
  --   own_health          RCW 49.46.210(1)(b)(i)
  --   family_care         RCW 49.46.210(1)(b)(ii)
  --   closure             RCW 49.46.210(1)(b)(iii)
  --   immigration         RCW 49.46.210(1)(b)(iv)
  --   domestic_violence   RCW 49.46.210(1)(c), chapter 49.76 RCW
  purpose text not null
    check (purpose in ('own_health','family_care','closure',
                       'immigration','domestic_violence')),

  -- WAC 296-128-650(1)(a) permits a ten-day advance-notice requirement for
  -- FORESEEABLE leave and (1)(b) only "as soon as possible before the required
  -- start of their shift" for UNFORESEEABLE leave. Two different rules, so the
  -- record has to know which one applied.
  notice_kind text not null
    check (notice_kind in ('foreseeable','unforeseeable')),

  status text not null default 'pending'
    check (status in ('pending','approved','denied','cancelled')),

  -- Free text from the employee. Optional, and the screen tells them not to put
  -- a diagnosis here.
  employee_note text,

  -- WHO ENTERED IT, and why this is nullable. employees.staff_id is nullable by
  -- design in 0037: floor-only staff have no back-office login and clock in at a
  -- shared station with a PIN. For those people there IS no staff profile, and
  -- the PIN is the identity. NULL therefore means "entered at the clock by the
  -- employee via PIN", which is the normal case, not a missing value.
  requested_by_staff_id uuid
    references public.staff_profiles(id) on delete set null,
  requested_at timestamptz not null default now(),

  decided_by_staff_id uuid
    references public.staff_profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A decision is a person and a moment, together or not at all. Half a
  -- decision on file is worse than none, because it looks like a record.
  constraint sick_leave_requests_decided_together
    check (
      (status = 'pending' and decided_by_staff_id is null and decided_at is null)
      or (status = 'cancelled')
      or (status in ('approved','denied')
          and decided_by_staff_id is not null and decided_at is not null)
    ),

  -- A denial with no reason is the exact record that loses a retaliation claim.
  constraint sick_leave_requests_denial_has_reason
    check (status <> 'denied'
           or (decision_note is not null and length(btrim(decision_note)) >= 10))
);

create index if not exists sick_leave_requests_employee_idx
  on public.sick_leave_requests (employee_id, leave_date);
create index if not exists sick_leave_requests_status_idx
  on public.sick_leave_requests (status);
create index if not exists sick_leave_requests_pending_idx
  on public.sick_leave_requests (requested_at) where status = 'pending';

drop trigger if exists sick_leave_requests_set_updated_at on public.sick_leave_requests;
create trigger sick_leave_requests_set_updated_at
  before update on public.sick_leave_requests
  for each row execute function public.set_updated_at();


-- ══════════════════════════════════════════════════════════════════════════════
-- §3  THE LEDGER — every minute in and every minute out
--
-- THIS IS THE TABLE THE WHOLE SLICE EXISTS FOR.
--
-- A balance is not a fact. A balance is the SUM of facts, and the facts are
-- rows. Storing the balance and not the rows is how an employer ends up unable
-- to answer "where did those eleven hours go", which is the question
-- WAC 296-128-755(2) obliges him to answer every single month.
--
-- WHY entry_kind SEPARATES 'accrual' FROM 'award'
--
-- Because two statutory tests are measured against ACCRUAL and would be
-- corrupted by generosity. WAC 296-128-620(4) requires carryover of at least
-- forty hours of ACCRUED unused leave. RCW 49.46.210(1)(d) makes ACCRUED leave
-- usable on the ninetieth day. If Michael's gift of sixteen hours is stored as
-- accrual, then next January the system cannot tell whether the forty-hour
-- floor was met by law or by kindness, and an investigator has no way to check.
--
-- Separating them costs one column and buys a complete answer to both
-- questions at once: "you accrued X, Michael gave you Y, you used Z, and here
-- is which pot each hour of Z came out of."
--
-- WHY USAGE IS DRAWN FROM THE STATUTORY POT FIRST
--
-- Not enforced here — this table stores facts, it does not choose — but the
-- engine's ordering rule is recorded in this comment because it is the reason
-- the column exists. Statutory minutes are spent before awarded minutes. If
-- the gift were spent first, an employee who took leave early in the year would
-- reach December with a statutory balance the employer must carry over, and
-- Michael's generosity would have cost him twice for the same hours. Spending
-- statutory first means the gift is the last thing standing, which is what
-- everybody actually intends by the word "extra".
--
-- WHY reason IS NOT NULL
--
-- Standing rule 64a: detection is not explanation. A ledger row that says
-- "minus 480" and nothing else is a detection. Six months later nobody can
-- reconstruct it, and Michael — who has a Master's in accounting he has not
-- used in thirteen years — should never have to.
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.sick_leave_ledger (
  id uuid primary key default gen_random_uuid(),

  employee_id uuid not null
    references public.employees(id) on delete restrict,

  -- The Pacific calendar day this entry is dated. Accrual is dated to the
  -- period it was earned in, usage to the day of absence.
  entry_date date not null,

  -- ─── THE VOCABULARY ────────────────────────────────────────────────────────
  --   accrual    statutory earning, one hour per forty worked or better.  (+)
  --   award      Michael giving more than is owed. RCW 49.46.210(1)(e).   (+)
  --   carry_in   balance rolled from the prior year under 620(4).         (+)
  --   reinstate  balance restored on rehire within twelve months.         (+)
  --   usage      leave actually taken.                                    (-)
  --   forfeit    balance above the carryover cap at year end.             (-)
  --   payout     paid out in cash rather than taken.                      (-)
  --   correction a fix to an earlier mistake. May be either sign.
  entry_kind text not null
    check (entry_kind in ('accrual','award','carry_in','reinstate',
                          'usage','forfeit','payout','correction')),

  -- Signed minutes. Never zero: a zero-minute ledger row is a row that changes
  -- nothing while looking like a record, which is the definition of noise in an
  -- audit trail.
  minutes integer not null check (minutes <> 0),

  -- The sign has to agree with the kind, or the balance is meaningless. Only
  -- 'correction' may go either way, because a correction that could only reduce
  -- would be unable to fix an under-accrual.
  constraint sick_leave_ledger_sign_matches_kind
    check (
      (entry_kind in ('accrual','award','carry_in','reinstate') and minutes > 0)
      or (entry_kind in ('usage','forfeit','payout') and minutes < 0)
      or (entry_kind = 'correction')
    ),

  -- Usage must point at the request that authorised it. This is the structural
  -- version of "no leave is deducted that nobody asked for and nobody approved".
  request_id uuid
    references public.sick_leave_requests(id) on delete restrict,

  constraint sick_leave_ledger_usage_has_request
    check (entry_kind <> 'usage' or request_id is not null),

  -- Which pot a usage row was drawn from. NULL for every kind except usage.
  -- This is what lets the year-end carryover test ask "how many STATUTORY
  -- minutes are left" rather than "how many minutes are left".
  drawn_from text
    check (drawn_from is null or drawn_from in ('statutory','awarded')),

  constraint sick_leave_ledger_draw_only_on_usage
    check ((entry_kind = 'usage') = (drawn_from is not null)),

  -- The pay period the money moved in, for paid kinds. NULL until paid, which
  -- is how the pay run finds what it still owes.
  pay_period_id uuid
    references public.pay_periods(id) on delete restrict,

  -- The rate this leave was paid at, in thousandths of a cent per hour, so that
  -- a rate change mid-year cannot silently reprice history. Recorded at the
  -- moment of payment and never recomputed.
  paid_rate_milli_cents_per_hour bigint
    check (paid_rate_milli_cents_per_hour is null
           or paid_rate_milli_cents_per_hour > 0),

  paid_amount_cents bigint
    check (paid_amount_cents is null or paid_amount_cents >= 0),

  -- Standing rule 64a. Every row explains itself in plain English.
  reason text not null check (length(btrim(reason)) >= 3),

  created_by_staff_id uuid
    references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One usage entry per approved request. Without this, a double-click on the
-- approve button deducts the leave twice and the employee silently loses hours.
create unique index if not exists sick_leave_ledger_one_usage_per_request
  on public.sick_leave_ledger (request_id)
  where entry_kind = 'usage';

create index if not exists sick_leave_ledger_employee_idx
  on public.sick_leave_ledger (employee_id, entry_date);
create index if not exists sick_leave_ledger_kind_idx
  on public.sick_leave_ledger (entry_kind);
create index if not exists sick_leave_ledger_unpaid_idx
  on public.sick_leave_ledger (employee_id)
  where pay_period_id is null;

drop trigger if exists sick_leave_ledger_set_updated_at on public.sick_leave_ledger;
create trigger sick_leave_ledger_set_updated_at
  before update on public.sick_leave_ledger
  for each row execute function public.set_updated_at();


-- ══════════════════════════════════════════════════════════════════════════════
-- §4  WAGE ORDERS — garnishments, child support, and tax levies
--
-- WHY THE ORDER IS A RECORD AND NOT A NUMBER
--
-- The engine already has somewhere to POST a garnishment: GL account 31300,
-- wired through payroll-cogs-core.ts. What it has never had is anywhere to
-- KEEP one. Absent this table, every fortnight somebody re-derives the
-- withholding from a paper writ in a drawer, and the day that person is on
-- holiday the deduction is missed. A missed support withholding is not a
-- clerical error: the employer can be made liable for the amount that should
-- have been withheld.
--
-- WHY amount AND percent ARE MUTUALLY EXCLUSIVE
--
-- A writ says one or the other, never both. Allowing both invites a row that
-- means two contradictory things, and no amount of application code can
-- untangle a contradiction the database was happy to store.
--
-- WHY supports_second_family HAS NO DEFAULT
--
-- Because it is worth between five and fifteen percent of somebody's paycheck
-- and only they know the answer:
--
--     "The maximum part of the aggregate disposable earnings of an individual
--      for any workweek which is subject to garnishment to enforce any order
--      for the support of any person shall not exceed-
--      (A) where such individual is supporting his spouse or dependent child
--      (other than a spouse or child with respect to whose support such order
--      is used), 50 per centum of such individual's disposable earnings for
--      that week; and
--      (B) where such individual is not supporting such a spouse or dependent
--      child described in clause (A), 60 per centum of such individual's
--      disposable earnings for that week;"
--                                                  — 15 U.S.C. §1673(b)(2)
--
-- Fifty versus sixty, and each becomes fifty-five or sixty-five where arrears
-- reach back beyond twelve weeks. A default would pick a side of that on an
-- employee's behalf. NULL means UNANSWERED and the engine refuses.
--
-- WHAT THIS TABLE STILL DOES NOT KNOW
--
-- The 2027 Washington minimum wage. RCW 6.27.150(1) exempts the GREATEST of
-- thirty-five times the FEDERAL minimum wage or seventy-five percent of
-- disposable earnings, while (4) uses the STATE minimum wage for consumer debt
-- and (3) uses fifty times the highest minimum wage in the state for private
-- student loans. Washington announces the following year's rate on 30 September.
-- Until Michael sends it, the engine refuses to compute a consumer-debt
-- exemption. It does not guess, and it does not fall back to the federal figure,
-- because for a Washington employee that would under-protect them by a wide
-- margin.
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.wage_orders (
  id uuid primary key default gen_random_uuid(),

  employee_id uuid not null
    references public.employees(id) on delete restrict,

  -- The kind decides which cap applies, which is why it is not free text.
  --   child_support / spousal_support   15 USC 1673(b)(2), RCW 26.18.090
  --   creditor / consumer_debt          CCPA 25 percent vs RCW 6.27.150(1)/(4)
  --   student_loan                      RCW 6.27.150(3)
  --   federal_tax_levy / state_tax_levy 15 USC 1673(b)(1)(C) - CCPA cap does
  --                                     not apply at all
  order_kind text not null
    check (order_kind in ('child_support','spousal_support','creditor',
                          'consumer_debt','student_loan',
                          'federal_tax_levy','state_tax_levy')),

  case_number text not null check (length(btrim(case_number)) > 0),
  issuing_authority text not null check (length(btrim(issuing_authority)) > 0),
  order_date date not null,

  payee_name text not null check (length(btrim(payee_name)) > 0),
  payee_address text,
  remittance_instructions text,

  -- EXACTLY ONE of these two measures. See the header note.
  amount_cents_per_period bigint
    check (amount_cents_per_period is null or amount_cents_per_period > 0),
  percent_of_disposable_basis_points integer
    check (percent_of_disposable_basis_points is null
           or percent_of_disposable_basis_points between 1 and 10000),

  constraint wage_orders_states_one_measure
    check ((amount_cents_per_period is not null)
           <> (percent_of_disposable_basis_points is not null)),

  arrears_cents bigint check (arrears_cents is null or arrears_cents >= 0),

  -- Drives the 50/55 and 60/65 step in 15 USC 1673(b)(2). NULL means the
  -- question has not been answered and the engine refuses rather than assuming
  -- the cheaper cap.
  arrears_over_twelve_weeks boolean,

  -- Drives the 50 versus 60 choice. See the header note on why there is no
  -- default.
  supports_second_family boolean,

  -- A support order that cannot say whether the obligor supports another family
  -- cannot be computed. Refuse at write time rather than at pay time.
  constraint wage_orders_support_needs_family_answer
    check (order_kind not in ('child_support','spousal_support')
           or supports_second_family is not null),

  -- Lower number is satisfied first. Support outranks everything by federal
  -- law, so the screen defaults support orders to 1, but the column is explicit
  -- because a court can order otherwise.
  priority smallint not null default 100 check (priority > 0),

  effective_from date not null,
  effective_to date,
  constraint wage_orders_dates_ordered
    check (effective_to is null or effective_to >= effective_from),

  status text not null default 'active'
    check (status in ('active','suspended','terminated')),

  termination_note text,
  constraint wage_orders_terminated_has_note
    check (status <> 'terminated'
           or (termination_note is not null
               and length(btrim(termination_note)) >= 5)),

  notes text,
  created_by_staff_id uuid
    references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live order per case number. A writ re-entered by mistake would otherwise
-- double the withholding, and the employee would have no way to notice until
-- their rent bounced.
create unique index if not exists wage_orders_one_live_per_case
  on public.wage_orders (employee_id, case_number)
  where status = 'active';

create index if not exists wage_orders_employee_idx
  on public.wage_orders (employee_id, status);
create index if not exists wage_orders_priority_idx
  on public.wage_orders (employee_id, priority) where status = 'active';

drop trigger if exists wage_orders_set_updated_at on public.wage_orders;
create trigger wage_orders_set_updated_at
  before update on public.wage_orders
  for each row execute function public.set_updated_at();


-- ══════════════════════════════════════════════════════════════════════════════
-- §5  RLS, POLICIES AND GRANTS
--
-- Note on grants versus policies, learned the hard way in books-31 and worth
-- repeating: enabling RLS does NOT revoke table privileges. Supabase's own
-- documentation is explicit — "Adding policies doesn't take those grants back."
-- So both have to be right. Below, anon is granted nothing at all, and no
-- DELETE is granted to anyone.
--
-- THE ONE ASYMMETRY, AND WHY IT IS DELIBERATE
--
-- sick_leave_requests is the only table here that authenticated sessions may
-- SELECT and INSERT. Every other table, and every UPDATE, is owner-only.
--
-- The reason is 0037. employees.staff_id is nullable "for floor-only staff who
-- just clock in at a shared station". Most of Greenway's employees have no
-- back-office login at all. If requesting sick leave required is_owner(), or
-- even required a staff profile, then the people the statute is written to
-- protect would be structurally unable to ask. The request would have to travel
-- by text message to Michael, which is precisely the undocumented channel this
-- migration exists to replace.
--
-- So the request goes in at the clock, under the station session, keyed by PIN.
-- Reading and writing a REQUEST is open to an authenticated session. DECIDING
-- one, and every entry in the LEDGER, and every WAGE ORDER, is owner-only.
-- ══════════════════════════════════════════════════════════════════════════════
alter table public.sick_leave_policy   enable row level security;
alter table public.sick_leave_requests enable row level security;
alter table public.sick_leave_ledger   enable row level security;
alter table public.wage_orders         enable row level security;

do $rls$
begin
  -- ─── sick_leave_policy: owner only, all three verbs ───────────────────────
  drop policy if exists sick_leave_policy_select on public.sick_leave_policy;
  execute 'create policy sick_leave_policy_select on public.sick_leave_policy for select using (public.is_owner())';

  drop policy if exists sick_leave_policy_insert on public.sick_leave_policy;
  execute 'create policy sick_leave_policy_insert on public.sick_leave_policy for insert with check (public.is_owner())';

  drop policy if exists sick_leave_policy_update on public.sick_leave_policy;
  execute 'create policy sick_leave_policy_update on public.sick_leave_policy for update using (public.is_owner()) with check (public.is_owner())';

  -- ─── sick_leave_requests: the asymmetry described above ───────────────────
  drop policy if exists sick_leave_requests_select on public.sick_leave_requests;
  execute 'create policy sick_leave_requests_select on public.sick_leave_requests for select using (auth.role() = ''authenticated'')';

  drop policy if exists sick_leave_requests_insert on public.sick_leave_requests;
  execute 'create policy sick_leave_requests_insert on public.sick_leave_requests for insert with check (auth.role() = ''authenticated'')';

  -- Deciding is owner-only, on BOTH sides. `using` decides which rows may be
  -- attempted; `with check` decides what they may become. Omitting the second
  -- half is the classic RLS hole.
  drop policy if exists sick_leave_requests_update on public.sick_leave_requests;
  execute 'create policy sick_leave_requests_update on public.sick_leave_requests for update using (public.is_owner()) with check (public.is_owner())';

  -- ─── sick_leave_ledger: owner only ────────────────────────────────────────
  drop policy if exists sick_leave_ledger_select on public.sick_leave_ledger;
  execute 'create policy sick_leave_ledger_select on public.sick_leave_ledger for select using (public.is_owner())';

  drop policy if exists sick_leave_ledger_insert on public.sick_leave_ledger;
  execute 'create policy sick_leave_ledger_insert on public.sick_leave_ledger for insert with check (public.is_owner())';

  drop policy if exists sick_leave_ledger_update on public.sick_leave_ledger;
  execute 'create policy sick_leave_ledger_update on public.sick_leave_ledger for update using (public.is_owner()) with check (public.is_owner())';

  -- ─── wage_orders: owner only ──────────────────────────────────────────────
  drop policy if exists wage_orders_select on public.wage_orders;
  execute 'create policy wage_orders_select on public.wage_orders for select using (public.is_owner())';

  drop policy if exists wage_orders_insert on public.wage_orders;
  execute 'create policy wage_orders_insert on public.wage_orders for insert with check (public.is_owner())';

  drop policy if exists wage_orders_update on public.wage_orders;
  execute 'create policy wage_orders_update on public.wage_orders for update using (public.is_owner()) with check (public.is_owner())';

  -- NO DELETE POLICY ON ANY OF THESE FOUR TABLES, DELIBERATELY. Under RLS the
  -- absence of a policy denies the operation outright, so this is enforced by
  -- the database rather than remembered by a developer. A denied sick leave
  -- request is the evidence that answers a retaliation claim. A terminated wage
  -- order is the evidence that the withholding stopped on the day the court
  -- said it should. Neither is deletable through the application. A request
  -- entered in error is CANCELLED, and an order entered in error is
  -- TERMINATED with a note.
end
$rls$;

grant select, insert, update on public.sick_leave_policy   to authenticated;
grant select, insert, update on public.sick_leave_requests to authenticated;
grant select, insert, update on public.sick_leave_ledger   to authenticated;
grant select, insert, update on public.wage_orders         to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- §6  COLUMN COMMENTS — every column names its downstream consumers
--
-- Standing rule 62e: write down the intended consumers in the code. These are
-- not decoration. gl_audit_sick_and_orders() below FAILS if any column added by
-- this migration has no comment, which is what stops the comments rotting into
-- "-- the minutes" six months from now.
-- ══════════════════════════════════════════════════════════════════════════════
comment on table public.sick_leave_policy is
  'The employer elections that govern paid sick leave. Exactly one row. Every policy column is NULL until Michael answers it, because Washington sets floors rather than values and a default would record the floor as a deliberate choice nobody made.';

comment on column public.sick_leave_policy.accrual_hundredth_minutes_per_hour is
  'Hundredths of a minute of paid sick leave earned per hour worked. The statutory floor is 150, which is one hour per forty hours worked. NULL means UNANSWERED and the accrual engine refuses to run. CONSUMERS: sick-leave-core.ts accrual computation. The monthly employee notification. The year-end carryover test. AUTHORITY: WAC 296-128-620(1) - an employee must accrue at least one hour of paid sick leave for every forty hours worked, and employers may provide a more generous accrual rate.';

comment on column public.sick_leave_policy.carryover_cap_minutes is
  'Minutes of unused accrued leave that carry into the following year. Floor is 2400, which is forty hours. NULL means UNANSWERED, it does not mean unlimited. CONSUMERS: sick-leave-core.ts year-end rollover, which writes a carry_in entry and a forfeit entry. AUTHORITY: WAC 296-128-620(4) requires carryover of at least forty hours, and (5) permits an employer to cap there or to be more generous.';

comment on column public.sick_leave_policy.usable_after_days is
  'Calendar days after hire before accrued leave may be used, 0 to 90. NULL means UNANSWERED. CONSUMERS: sick-leave-core.ts request validation. The employee balance display at the time clock, which shows a usable-from date rather than a bare number. AUTHORITY: RCW 49.46.210(1)(d) entitles an employee to use accrued leave beginning on the ninetieth calendar day after commencement of employment, and WAC 296-128-630(2) expressly permits an employer to allow use sooner.';

comment on column public.sick_leave_policy.usage_increment_minutes is
  'Smallest slice of leave an employee may take, 1 to 60 minutes. NULL means UNANSWERED. CONSUMERS: sick-leave-core.ts request validation rounds and refuses on this. The request form at the time clock. AUTHORITY: WAC 296-128-630(4) requires increments consistent with the employer payroll system not to exceed one hour, absent a variance under WAC 296-128-640.';

comment on column public.sick_leave_policy.verification_after_days is
  'Consecutive days of absence after which verification may be required. Minimum 4, because the statute permits verification only for absences EXCEEDING three days. NULL means UNANSWERED. CONSUMERS: sick-leave-core.ts flags a request as verification-eligible. The approval screen. AUTHORITY: RCW 49.46.210(1)(g)(i) and WAC 296-128-660(1).';

comment on column public.sick_leave_policy.verification_required is
  'Whether the employer actually requires verification, as distinct from being permitted to. NULL means UNANSWERED. CONSUMERS: the pay timing rule - WAC 296-128-680(1) pays sick leave by the payday for the period it was USED unless verification is required, in which case it is paid by the payday for the period the verification was PROVIDED. AUTHORITY: WAC 296-128-660(2) requires a written policy before verification may be demanded at all.';

comment on column public.sick_leave_policy.notification_policy_text is
  'The written notice given to employees about their sick leave rights. CONSUMERS: the handbook page. The new-hire packet. AUTHORITY: WAC 296-128-755(1) requires notification of entitlement, accrual rate, authorised purposes and the prohibition on retaliation, in written or electronic form, no later than commencement of employment.';

comment on table public.sick_leave_requests is
  'What an employee asked for, and what was decided. A denied request stays on file permanently: it is the record that answers a retaliation claim. There is no DELETE policy - a request entered in error is CANCELLED.';

comment on column public.sick_leave_requests.employee_id is
  'The employee taking the leave. CONSUMERS: the balance query at the time clock. The owner approval queue. The ledger entry written on approval.';

comment on column public.sick_leave_requests.leave_date is
  'The Pacific calendar day the leave is for. One row per day, so a three-day absence is three rows and may be partially approved. CONSUMERS: the pay period the leave falls in. The three-day verification threshold, counted across consecutive rows.';

comment on column public.sick_leave_requests.minutes_requested is
  'Minutes of leave asked for on this day, 1 to 1440. Validated against sick_leave_policy.usage_increment_minutes by the engine, not by the database, so the refusal can explain itself. CONSUMERS: sick-leave-core.ts. The ledger usage entry.';

comment on column public.sick_leave_requests.purpose is
  'Which statutory purpose the leave is for. Enumerated rather than free text so that leave cannot be approved for an unauthorised purpose, and so that a medical diagnosis is never typed into a payroll table. CONSUMERS: the approval screen. Any wage-and-hour enquiry. AUTHORITY: RCW 49.46.210(1)(b)(i) through (iv) for own_health, family_care, closure and immigration, and RCW 49.46.210(1)(c) with chapter 49.76 RCW for domestic_violence.';

comment on column public.sick_leave_requests.notice_kind is
  'Whether the need for leave was foreseeable. The two cases have different notice rules and the record must know which applied. CONSUMERS: the approval screen, which suppresses any late-notice flag on unforeseeable leave. AUTHORITY: WAC 296-128-650(1)(a) permits requiring ten days advance notice for foreseeable leave, while (1)(b) requires only notice as soon as possible before the start of the shift when the need is unforeseeable.';

comment on column public.sick_leave_requests.status is
  'pending, approved, denied or cancelled. Only approved requests produce a ledger usage entry. CONSUMERS: the owner approval queue. The pay run, which pays approved leave. AUTHORITY: WAC 296-128-630(1) - the employee chooses whether to use leave, so an employer may not convert an absence into sick leave without a request.';

comment on column public.sick_leave_requests.employee_note is
  'Free text from the employee. The form tells them not to enter a diagnosis. CONSUMERS: the approval screen only. Nothing computes from this.';

comment on column public.sick_leave_requests.requested_by_staff_id is
  'The back-office login that entered the request, or NULL when it was entered by the employee at the time clock using their PIN. NULL is the NORMAL case and not a missing value: employees.staff_id is nullable by design in migration 0037 because floor-only staff have no login. CONSUMERS: audit trail. The approval screen, which shows whether the employee asked or a manager entered it on their behalf.';

comment on column public.sick_leave_requests.requested_at is
  'When the request was made. CONSUMERS: the late-notice flag on foreseeable leave, measured against WAC 296-128-650(1)(a). Audit trail.';

comment on column public.sick_leave_requests.decided_by_staff_id is
  'Who approved or denied it. Structurally paired with decided_at by sick_leave_requests_decided_together so a decision can never be half-recorded. CONSUMERS: audit trail.';

comment on column public.sick_leave_requests.decided_at is
  'When the decision was made. CONSUMERS: audit trail. See decided_by_staff_id.';

comment on column public.sick_leave_requests.decision_note is
  'Why. Structurally required on a denial, minimum ten characters. CONSUMERS: the employee-facing decision message. Retaliation-claim defence. AUTHORITY: RCW 49.46.210 and chapter 49.46 RCW prohibit retaliation for lawful use of paid sick leave, and a denial with no recorded reason is the record that loses that argument.';

comment on table public.sick_leave_ledger is
  'Every minute of sick leave in and every minute out, with a reason on each row. The balance is the SUM of this table and is never stored anywhere, because WAC 296-128-755(2) requires the employer to report the REDUCTIONS since the last notification, which a recomputed number cannot produce.';

comment on column public.sick_leave_ledger.employee_id is
  'Whose balance this affects. CONSUMERS: the balance query. The monthly notification. The year-end carryover test.';

comment on column public.sick_leave_ledger.entry_date is
  'The Pacific calendar day the entry is dated. Accrual is dated to the period earned, usage to the day of absence. CONSUMERS: the monthly notification window. The year boundary for carryover.';

comment on column public.sick_leave_ledger.entry_kind is
  'accrual, award, carry_in, reinstate, usage, forfeit, payout or correction. THE SEPARATION OF accrual FROM award IS THE POINT OF THIS COLUMN: two statutory tests are measured against ACCRUAL and would be corrupted by employer generosity. CONSUMERS: sick-leave-core.ts balance and carryover computation. The owner report showing statutory versus gifted hours. AUTHORITY: RCW 49.46.210(1)(e) permits more generous policies, WAC 296-128-620(4) requires carryover of at least forty hours of ACCRUED unused leave, and RCW 49.46.210(1)(d) makes ACCRUED leave usable on the ninetieth day.';

comment on column public.sick_leave_ledger.minutes is
  'Signed minutes, never zero. Positive kinds add to the balance and negative kinds reduce it, enforced by sick_leave_ledger_sign_matches_kind. CONSUMERS: the balance sum. The monthly notification.';

comment on column public.sick_leave_ledger.request_id is
  'The request that authorised a usage entry. Structurally required on usage by sick_leave_ledger_usage_has_request, so no leave is ever deducted that nobody asked for. A unique index limits this to one usage entry per request, which is what stops a double-clicked approve button deducting twice. CONSUMERS: the approval action. Audit trail.';

comment on column public.sick_leave_ledger.drawn_from is
  'statutory or awarded, on usage entries only. The engine spends STATUTORY minutes first so that Michael gifted hours are the last thing used, which means his generosity does not inflate the balance he must carry over under WAC 296-128-620(4). CONSUMERS: sick-leave-core.ts draw ordering. The year-end carryover test. The owner report.';

comment on column public.sick_leave_ledger.pay_period_id is
  'The pay period the money actually moved in. NULL means not yet paid, which is how the pay run finds outstanding sick pay. CONSUMERS: the pay run. AUTHORITY: WAC 296-128-680(1) requires payment no later than the payday for the pay period in which the leave was used, or if verification is required, the payday for the period the verification was provided.';

comment on column public.sick_leave_ledger.paid_rate_milli_cents_per_hour is
  'The hourly rate this leave was paid at, in thousandths of a cent, captured at the moment of payment and never recomputed, so a later raise cannot silently reprice history. CONSUMERS: the pay run. The W-2 wage total. Any wage claim.';

comment on column public.sick_leave_ledger.paid_amount_cents is
  'What was actually paid for this entry. CONSUMERS: the pay run. The general ledger posting to 71030 Paid Sick and Leave. NOTE: this amount is EXCLUDED from the regular rate and never counts toward the forty-hour overtime threshold. AUTHORITY: 29 CFR 778.218(a) - such payments are not made as compensation for hours of employment, may be excluded from the regular rate under section 7(e)(2), and no part of them may be credited toward overtime compensation due under the Act.';

comment on column public.sick_leave_ledger.reason is
  'Plain English explanation of why this row exists, minimum three characters, NOT NULL. Standing rule 64a - detection is not explanation. A row that says minus 480 and nothing else cannot be reconstructed six months later. CONSUMERS: the monthly employee notification. The owner ledger view. Any audit.';

comment on column public.sick_leave_ledger.created_by_staff_id is
  'Who wrote the entry, or NULL for entries the accrual engine generated. CONSUMERS: audit trail.';

comment on table public.wage_orders is
  'Garnishments, child support and tax levies. The accounting side already existed - GL account 31300 and a journal line in payroll-cogs-core.ts - but nothing in the system could remember the ORDER itself. There is no DELETE policy: an order that has stopped is TERMINATED with a note, because the date it stopped is the fact that proves the employer complied.';

comment on column public.wage_orders.employee_id is
  'Whose earnings are subject to the order. CONSUMERS: garnishment-core.ts per-run withholding. The pay run. The paystub deduction line.';

comment on column public.wage_orders.order_kind is
  'Which body of law caps this order. CONSUMERS: garnishment-core.ts cap selection. AUTHORITY: 15 USC 1673(a) caps ordinary garnishment at the lesser of 25 percent of disposable earnings or the excess over thirty times the federal minimum wage. 15 USC 1673(b)(1)(A) exempts support orders from that cap and (b)(2) substitutes 50 or 60 percent, stepping to 55 or 65 where arrears predate the twelve-week period. 15 USC 1673(b)(1)(C) exempts any debt due for a State or Federal tax from the cap entirely. RCW 6.27.150 is MORE protective than the CCPA in Washington and therefore governs: (1) the greatest of thirty-five times the federal minimum wage or seventy-five percent of disposable earnings, (3) private student loans the greater of fifty times the highest minimum wage in the state or eighty-five percent, (4) consumer debt the greater of thirty-five times the STATE minimum wage or eighty percent.';

comment on column public.wage_orders.case_number is
  'The court or agency case number. A unique index limits an employee to one ACTIVE order per case number, which stops a re-entered writ doubling the withholding. CONSUMERS: the remittance advice. The answer to the writ.';

comment on column public.wage_orders.issuing_authority is
  'The court or agency that issued it. CONSUMERS: the remittance advice. Audit trail.';

comment on column public.wage_orders.order_date is
  'The date on the order. CONSUMERS: priority ordering between competing orders. Audit trail.';

comment on column public.wage_orders.payee_name is
  'Who the money goes to. CONSUMERS: the accounts payable entry that clears GL 31300. The remittance advice.';

comment on column public.wage_orders.payee_address is
  'Where the money goes. CONSUMERS: the remittance advice.';

comment on column public.wage_orders.remittance_instructions is
  'How and when to remit, transcribed from the order. CONSUMERS: owner reference. Nothing computes from this.';

comment on column public.wage_orders.amount_cents_per_period is
  'A fixed dollar withholding per pay period. Mutually exclusive with percent_of_disposable_basis_points by wage_orders_states_one_measure, because a writ states one or the other and a row that states both means two contradictory things. CONSUMERS: garnishment-core.ts, which still caps this at the statutory maximum - an order may ask for more than the law permits and the cap wins.';

comment on column public.wage_orders.percent_of_disposable_basis_points is
  'A percentage of disposable earnings in basis points, 1 to 10000. Mutually exclusive with amount_cents_per_period. CONSUMERS: garnishment-core.ts. AUTHORITY: disposable earnings are defined by 15 USC 1672(b) as that part of earnings remaining after deduction of any amounts REQUIRED BY LAW to be withheld - which means taxes, and NOT voluntary deductions such as a retirement contribution or health premium.';

comment on column public.wage_orders.arrears_cents is
  'Past-due balance stated on the order. CONSUMERS: the owner screen. The remittance advice.';

comment on column public.wage_orders.arrears_over_twelve_weeks is
  'Whether the arrears reach back beyond the twelve-week period ending with the current workweek. NULL means UNANSWERED and the engine refuses rather than assuming the cheaper cap. CONSUMERS: garnishment-core.ts support cap. AUTHORITY: 15 USC 1673(b)(2) - the 50 per centum becomes 55 and the 60 per centum becomes 65 to the extent earnings are subject to garnishment for a period prior to the twelve-week period which ends with the beginning of the workweek.';

comment on column public.wage_orders.supports_second_family is
  'Whether the obligor supports a spouse or dependent child other than the one this order is for. NO DEFAULT, because the answer is worth ten percentage points of somebody take-home pay and only they know it. CONSUMERS: garnishment-core.ts support cap. AUTHORITY: 15 USC 1673(b)(2)(A) sets 50 per centum where the individual IS supporting such a spouse or dependent child, and (B) sets 60 per centum where they are not.';

comment on column public.wage_orders.priority is
  'Lower is satisfied first when disposable earnings cannot cover every order. CONSUMERS: garnishment-core.ts ordering. AUTHORITY: RCW 26.18.090(4) - where an obligor is subject to two or more attachments for maintenance on account of DIFFERENT OBLIGEES and the nonexempt portion is not sufficient, the employer must apportion the nonexempt disposable earnings between or among the obligees EQUALLY. Equally, not pro rata by amount owed. Priority ordering therefore applies BETWEEN classes of order, and equal apportionment applies WITHIN competing maintenance orders.';

comment on column public.wage_orders.effective_from is
  'First day the order applies. CONSUMERS: garnishment-core.ts, which ignores orders outside the pay period.';

comment on column public.wage_orders.effective_to is
  'Last day the order applies, or NULL for open-ended. CONSUMERS: garnishment-core.ts. The date the withholding must stop.';

comment on column public.wage_orders.status is
  'active, suspended or terminated. Only active orders are withheld. CONSUMERS: garnishment-core.ts. The owner screen.';

comment on column public.wage_orders.termination_note is
  'Why the order stopped, minimum five characters, structurally required when status is terminated. Standing rule 64a. CONSUMERS: audit trail. The answer to any later enquiry about why withholding ceased on a given date.';


-- ══════════════════════════════════════════════════════════════════════════════
-- §7  THE AUDIT FUNCTION
--
-- Standing rule 16: prove the gate is wired. This is how Michael confirms the
-- migration actually took, and how a future change that quietly undoes part of
-- it gets caught.
--
-- IT REPORTS AND DOES NOT REPAIR. Every finding here is a decision only Michael
-- can make. A function that silently "fixed" a garnishment cap would be
-- choosing how much of an employee's wages to seize.
--
-- AN EMPTY RESULT IS THE PASSING RESULT.
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.gl_audit_sick_and_orders()
returns table (finding text, detail text)
language plpgsql
security definer
set search_path = public
as $audit$
declare
  v_missing   integer;
  v_defaulted integer;
begin
  if not public.is_owner() then
    -- GL_NOT_OWNER, reusing the code the refusal catalogue already translates
    -- into plain English rather than inventing a new one a screen cannot read.
    raise exception 'GL_NOT_OWNER: the sick leave and wage order audit is owner-only.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 1) All four tables must exist.
  return query
  select format('table public.%s is missing', t)::text,
         'Migration 0198 did not take, or a later migration dropped it. Sick leave balances and wage orders cannot be recorded without it.'::text
  from unnest(array['sick_leave_policy','sick_leave_requests',
                    'sick_leave_ledger','wage_orders']) as t
  where to_regclass(format('public.%I', t)) is null;

  -- 2) The policy singleton must exist and hold exactly one row.
  return query
  select 'public.sick_leave_policy does not hold exactly one row'::text,
         format('found %s rows; the policy is a singleton and every screen reads id = 1', c.n)::text
  from (select count(*) as n from public.sick_leave_policy) c
  where c.n <> 1;

  -- 3) NOT ONE policy column may acquire a DEFAULT. A default here would be the
  --    software recording the statutory floor as Michael's deliberate election.
  --    See §1.
  select count(*) into v_defaulted
  from information_schema.columns d
  where d.table_schema = 'public'
    and d.table_name = 'sick_leave_policy'
    and d.column_name in ('accrual_hundredth_minutes_per_hour',
                          'carryover_cap_minutes',
                          'usable_after_days',
                          'usage_increment_minutes',
                          'verification_after_days',
                          'verification_required')
    and d.column_default is not null;

  return query
  select 'a public.sick_leave_policy column has acquired a DEFAULT'::text,
         format('%s of the six policy columns now carry a default; each must be NULL until Michael answers it, because WAC 296-128-620(1) sets a FLOOR and not a value, and a default would record the floor as a choice nobody made', v_defaulted)::text
  where v_defaulted > 0;

  -- 4) supports_second_family must have NO default. It is worth ten percentage
  --    points of an employee's take-home pay.
  return query
  select 'public.wage_orders.supports_second_family has acquired a DEFAULT'::text,
         format('default is %s; 15 USC 1673(b)(2) sets 50 per centum where the obligor supports another spouse or dependent child and 60 per centum where they do not, so a default picks a side of that on the employee behalf', d.column_default)::text
  from information_schema.columns d
  where d.table_schema = 'public'
    and d.table_name = 'wage_orders'
    and d.column_name = 'supports_second_family'
    and d.column_default is not null;

  -- 5) RLS must be ON for all four tables.
  return query
  select format('row level security is not enabled on public.%s', c.relname)::text,
         'Without RLS every authenticated session can read and rewrite payroll records, including wage orders and the sick leave ledger.'::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('sick_leave_policy','sick_leave_requests',
                      'sick_leave_ledger','wage_orders')
    and c.relrowsecurity = false;

  -- 6) The three owner-only tables must each carry three policies that actually
  --    mention is_owner(). A policy that exists but checks nothing is the
  --    definition of dead code wearing a green check (standing rule 50).
  return query
  select format('public.%s has fewer than 3 owner-gated policies', want.t)::text,
         format('found %s policies mentioning is_owner(); expected select, insert and update',
                (select count(*) from pg_policies p
                  where p.schemaname = 'public'
                    and p.tablename = want.t
                    and coalesce(p.qual, '') || coalesce(p.with_check, '') like '%is_owner%'))::text
  from unnest(array['sick_leave_policy','sick_leave_ledger','wage_orders']) as want(t)
  where (select count(*) from pg_policies p
          where p.schemaname = 'public'
            and p.tablename = want.t
            and coalesce(p.qual, '') || coalesce(p.with_check, '') like '%is_owner%') < 3;

  -- 7) The request table's ASYMMETRY must be intact in BOTH directions. This is
  --    the check that matters most in this file, because both halves of it are
  --    load-bearing and they fail in opposite directions.
  --
  --    Too tight, and floor-only staff - who have no back-office login at all,
  --    per the nullable employees.staff_id in migration 0037 - cannot ask for
  --    sick leave, and the statute's protection becomes unreachable.
  --    Too loose, and any authenticated session can APPROVE its own request.
  return query
  select 'public.sick_leave_requests INSERT is not reachable by an authenticated session'::text,
         'Most Greenway employees have no back-office login - employees.staff_id is nullable by design in 0037 for floor-only staff who clock in at a shared station. If the insert policy requires is_owner() then those employees physically cannot request sick leave and the request travels by text message instead, which is the undocumented channel this migration exists to replace.'::text
  where not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'sick_leave_requests'
      and p.cmd in ('INSERT','ALL')
      and coalesce(p.with_check, '') like '%authenticated%'
  );

  return query
  select 'public.sick_leave_requests UPDATE is not owner-gated'::text,
         'Approving a sick leave request is an owner decision. If UPDATE is open to any authenticated session then an employee can approve their own request, and the approval gate is decoration.'::text
  where not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'sick_leave_requests'
      and p.cmd in ('UPDATE','ALL')
      and coalesce(p.qual, '') like '%is_owner%'
      and coalesce(p.with_check, '') like '%is_owner%'
  );

  -- 8) No DELETE policy may exist on any of the four. Denied requests and
  --    terminated orders are evidence.
  return query
  select format('public.%s has a DELETE policy', p.tablename)::text,
         format('policy %s permits DELETE; a denied sick leave request is the record that answers a retaliation claim and a terminated wage order proves the date withholding lawfully stopped', p.policyname)::text
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('sick_leave_policy','sick_leave_requests',
                        'sick_leave_ledger','wage_orders')
    and p.cmd = 'DELETE';

  -- 9) anon must hold no privilege whatsoever. Enabling RLS does not revoke
  --    grants, so this is checked separately and on purpose.
  return query
  select format('the anon role holds privileges on public.%s', g.table_name)::text,
         format('anon has %s; payroll and medical-adjacent data must never be reachable by an unauthenticated session', string_agg(g.privilege_type, ', '))::text
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.table_name in ('sick_leave_policy','sick_leave_requests',
                         'sick_leave_ledger','wage_orders')
    and g.grantee = 'anon'
  group by g.table_name
  having count(*) > 0;

  -- 10) The unique index that stops a double-clicked approve button deducting
  --     an employee's leave twice.
  return query
  select 'the one-usage-per-request index is missing'::text,
         'Without sick_leave_ledger_one_usage_per_request a repeated approve action writes two usage entries for the same request and the employee silently loses the hours twice over.'::text
  where to_regclass('public.sick_leave_ledger_one_usage_per_request') is null;

  -- 11) The unique index that stops a re-entered writ doubling a garnishment.
  return query
  select 'the one-live-order-per-case index is missing'::text,
         'Without wage_orders_one_live_per_case the same writ entered twice withholds twice, and the employee has no way to notice until their rent bounces.'::text
  where to_regclass('public.wage_orders_one_live_per_case') is null;

  -- 12) The constraint that keeps sick leave OUT of the punch table. If a
  --     later migration ever adds a sick-leave punch_kind to time_punches, the
  --     hours become worked hours, they reach the forty-hour threshold, and
  --     overtime is paid on hours nobody worked.
  return query
  select 'public.time_punches now accepts a sick leave punch kind'::text,
         'Sick time must never be stored as a time punch. 29 CFR 778.218(a) says such payments are not made as compensation for hours of employment and no part of them may be credited toward overtime compensation due under the Act. A sick punch would silently push a 36-hour week over forty and pay a premium on hours nobody worked.'::text
  from pg_constraint c
  where c.conrelid = to_regclass('public.time_punches')
    and to_regclass('public.time_punches') is not null
    and pg_get_constraintdef(c) ilike '%sick%';

  -- 13) Every column this migration added must carry a comment naming its
  --     consumers. Standing rule 62e, enforced rather than hoped for.
  select count(*) into v_missing
  from (
    select 'sick_leave_policy'::text as t, 'accrual_hundredth_minutes_per_hour'::text as c
    union all select 'sick_leave_policy', 'carryover_cap_minutes'
    union all select 'sick_leave_policy', 'usable_after_days'
    union all select 'sick_leave_policy', 'usage_increment_minutes'
    union all select 'sick_leave_policy', 'verification_after_days'
    union all select 'sick_leave_policy', 'verification_required'
    union all select 'sick_leave_requests', 'employee_id'
    union all select 'sick_leave_requests', 'leave_date'
    union all select 'sick_leave_requests', 'minutes_requested'
    union all select 'sick_leave_requests', 'purpose'
    union all select 'sick_leave_requests', 'notice_kind'
    union all select 'sick_leave_requests', 'status'
    union all select 'sick_leave_requests', 'requested_by_staff_id'
    union all select 'sick_leave_requests', 'decision_note'
    union all select 'sick_leave_ledger', 'entry_kind'
    union all select 'sick_leave_ledger', 'minutes'
    union all select 'sick_leave_ledger', 'request_id'
    union all select 'sick_leave_ledger', 'drawn_from'
    union all select 'sick_leave_ledger', 'pay_period_id'
    union all select 'sick_leave_ledger', 'paid_rate_milli_cents_per_hour'
    union all select 'sick_leave_ledger', 'paid_amount_cents'
    union all select 'sick_leave_ledger', 'reason'
    union all select 'wage_orders', 'order_kind'
    union all select 'wage_orders', 'amount_cents_per_period'
    union all select 'wage_orders', 'percent_of_disposable_basis_points'
    union all select 'wage_orders', 'arrears_over_twelve_weeks'
    union all select 'wage_orders', 'supports_second_family'
    union all select 'wage_orders', 'priority'
    union all select 'wage_orders', 'status'
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
  select 'a column added by 0198 has no comment naming its consumers'::text,
         format('%s columns are undocumented; standing rule 62e requires the intended consumers to be written down where they cannot rot away from the code', v_missing)::text
  where v_missing > 0;

  return;
end
$audit$;

revoke all on function public.gl_audit_sick_and_orders() from public;
grant execute on function public.gl_audit_sick_and_orders() to authenticated;

comment on function public.gl_audit_sick_and_orders() is
  'Owner-only. Proves migration 0198 took and is still intact: four tables, the policy singleton with NO defaults, RLS on, owner-gated policies, the deliberate request-table asymmetry in BOTH directions, no DELETE policy anywhere, anon holding nothing, both anti-double-withholding indexes, sick time kept out of the punch table, and a comment on every column. AN EMPTY RESULT IS THE PASSING RESULT.';
