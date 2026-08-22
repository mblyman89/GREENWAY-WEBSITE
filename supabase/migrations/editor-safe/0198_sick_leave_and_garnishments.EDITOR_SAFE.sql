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

create table if not exists public.sick_leave_policy (

  id smallint primary key check (id = 1),

  accrual_hundredth_minutes_per_hour integer
    check (accrual_hundredth_minutes_per_hour is null
           or accrual_hundredth_minutes_per_hour >= 150),

  carryover_cap_minutes integer
    check (carryover_cap_minutes is null
           or carryover_cap_minutes >= 2400),

  usable_after_days smallint
    check (usable_after_days is null
           or usable_after_days between 0 and 90),

  usage_increment_minutes smallint
    check (usage_increment_minutes is null
           or usage_increment_minutes between 1 and 60),

  verification_after_days smallint
    check (verification_after_days is null
           or verification_after_days >= 4),

  verification_required boolean,

  notification_policy_text text,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists sick_leave_policy_set_updated_at on public.sick_leave_policy;
create trigger sick_leave_policy_set_updated_at
  before update on public.sick_leave_policy
  for each row execute function public.set_updated_at();

insert into public.sick_leave_policy (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.sick_leave_requests (
  id uuid primary key default gen_random_uuid(),

  employee_id uuid not null
    references public.employees(id) on delete restrict,

  leave_date date not null,

  minutes_requested integer not null
    check (minutes_requested > 0 and minutes_requested <= 1440),

  purpose text not null
    check (purpose in ('own_health','family_care','closure',
                       'immigration','domestic_violence')),

  notice_kind text not null
    check (notice_kind in ('foreseeable','unforeseeable')),

  status text not null default 'pending'
    check (status in ('pending','approved','denied','cancelled')),

  employee_note text,

  requested_by_staff_id uuid
    references public.staff_profiles(id) on delete set null,
  requested_at timestamptz not null default now(),

  decided_by_staff_id uuid
    references public.staff_profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sick_leave_requests_decided_together
    check (
      (status = 'pending' and decided_by_staff_id is null and decided_at is null)
      or (status = 'cancelled')
      or (status in ('approved','denied')
          and decided_by_staff_id is not null and decided_at is not null)
    ),

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

create table if not exists public.sick_leave_ledger (
  id uuid primary key default gen_random_uuid(),

  employee_id uuid not null
    references public.employees(id) on delete restrict,

  entry_date date not null,

  entry_kind text not null
    check (entry_kind in ('accrual','award','carry_in','reinstate',
                          'usage','forfeit','payout','correction')),

  minutes integer not null check (minutes <> 0),

  constraint sick_leave_ledger_sign_matches_kind
    check (
      (entry_kind in ('accrual','award','carry_in','reinstate') and minutes > 0)
      or (entry_kind in ('usage','forfeit','payout') and minutes < 0)
      or (entry_kind = 'correction')
    ),

  request_id uuid
    references public.sick_leave_requests(id) on delete restrict,

  constraint sick_leave_ledger_usage_has_request
    check (entry_kind <> 'usage' or request_id is not null),

  drawn_from text
    check (drawn_from is null or drawn_from in ('statutory','awarded')),

  constraint sick_leave_ledger_draw_only_on_usage
    check ((entry_kind = 'usage') = (drawn_from is not null)),

  pay_period_id uuid
    references public.pay_periods(id) on delete restrict,

  paid_rate_milli_cents_per_hour bigint
    check (paid_rate_milli_cents_per_hour is null
           or paid_rate_milli_cents_per_hour > 0),

  paid_amount_cents bigint
    check (paid_amount_cents is null or paid_amount_cents >= 0),

  reason text not null check (length(btrim(reason)) >= 3),

  created_by_staff_id uuid
    references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.wage_orders (
  id uuid primary key default gen_random_uuid(),

  employee_id uuid not null
    references public.employees(id) on delete restrict,

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

  amount_cents_per_period bigint
    check (amount_cents_per_period is null or amount_cents_per_period > 0),
  percent_of_disposable_basis_points integer
    check (percent_of_disposable_basis_points is null
           or percent_of_disposable_basis_points between 1 and 10000),

  constraint wage_orders_states_one_measure
    check ((amount_cents_per_period is not null)
           <> (percent_of_disposable_basis_points is not null)),

  arrears_cents bigint check (arrears_cents is null or arrears_cents >= 0),

  arrears_over_twelve_weeks boolean,

  supports_second_family boolean,

  constraint wage_orders_support_needs_family_answer
    check (order_kind not in ('child_support','spousal_support')
           or supports_second_family is not null),

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

alter table public.sick_leave_policy   enable row level security;
alter table public.sick_leave_requests enable row level security;
alter table public.sick_leave_ledger   enable row level security;
alter table public.wage_orders         enable row level security;

do $rls$begin

  drop policy if exists sick_leave_policy_select on public.sick_leave_policy;
  execute 'create policy sick_leave_policy_select on public.sick_leave_policy for select using (public.is_owner())';

  drop policy if exists sick_leave_policy_insert on public.sick_leave_policy;
  execute 'create policy sick_leave_policy_insert on public.sick_leave_policy for insert with check (public.is_owner())';

  drop policy if exists sick_leave_policy_update on public.sick_leave_policy;
  execute 'create policy sick_leave_policy_update on public.sick_leave_policy for update using (public.is_owner()) with check (public.is_owner())';

  drop policy if exists sick_leave_requests_select on public.sick_leave_requests;
  execute 'create policy sick_leave_requests_select on public.sick_leave_requests for select using (auth.role() = ''authenticated'')';

  drop policy if exists sick_leave_requests_insert on public.sick_leave_requests;
  execute 'create policy sick_leave_requests_insert on public.sick_leave_requests for insert with check (auth.role() = ''authenticated'')';

  drop policy if exists sick_leave_requests_update on public.sick_leave_requests;
  execute 'create policy sick_leave_requests_update on public.sick_leave_requests for update using (public.is_owner()) with check (public.is_owner())';

  drop policy if exists sick_leave_ledger_select on public.sick_leave_ledger;
  execute 'create policy sick_leave_ledger_select on public.sick_leave_ledger for select using (public.is_owner())';

  drop policy if exists sick_leave_ledger_insert on public.sick_leave_ledger;
  execute 'create policy sick_leave_ledger_insert on public.sick_leave_ledger for insert with check (public.is_owner())';

  drop policy if exists sick_leave_ledger_update on public.sick_leave_ledger;
  execute 'create policy sick_leave_ledger_update on public.sick_leave_ledger for update using (public.is_owner()) with check (public.is_owner())';

  drop policy if exists wage_orders_select on public.wage_orders;
  execute 'create policy wage_orders_select on public.wage_orders for select using (public.is_owner())';

  drop policy if exists wage_orders_insert on public.wage_orders;
  execute 'create policy wage_orders_insert on public.wage_orders for insert with check (public.is_owner())';

  drop policy if exists wage_orders_update on public.wage_orders;
  execute 'create policy wage_orders_update on public.wage_orders for update using (public.is_owner()) with check (public.is_owner())';

end
$rls$;

grant select, insert, update on public.sick_leave_policy   to authenticated;
grant select, insert, update on public.sick_leave_requests to authenticated;
grant select, insert, update on public.sick_leave_ledger   to authenticated;
grant select, insert, update on public.wage_orders         to authenticated;

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
  'Which statutory purpose the leave is for. Enumerated rather than free text so that leave cannot be approved for an unauthorised purpose, and so that a medical diagnosis is never typed into the payroll records. CONSUMERS: the approval screen. Any wage-and-hour enquiry. AUTHORITY: RCW 49.46.210(1)(b)(i) through (iv) for own_health, family_care, closure and immigration, and RCW 49.46.210(1)(c) with chapter 49.76 RCW for domestic_violence.';

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

create or replace function public.gl_audit_sick_and_orders()
returns table (finding text, detail text)
language plpgsql
security definer
set search_path = public
as $audit$declare
  v_missing   integer;
  v_defaulted integer;
begin
  if not public.is_owner() then

    raise exception 'GL_NOT_OWNER: the sick leave and wage order audit is owner-only.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select format('table public.%s is missing', t)::text,
         'Migration 0198 did not take, or a later migration dropped it. Sick leave balances and wage orders cannot be recorded without it.'::text
  from unnest(array['sick_leave_policy','sick_leave_requests',
                    'sick_leave_ledger','wage_orders']) as t
  where to_regclass(format('public.%I', t)) is null;

  return query
  select 'public.sick_leave_policy does not hold exactly one row'::text,
         format('found %s rows; the policy is a singleton and every screen reads id = 1', c.n)::text
  from (select count(*) as n from public.sick_leave_policy) c
  where c.n <> 1;

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

  return query
  select 'public.wage_orders.supports_second_family has acquired a DEFAULT'::text,
         format('default is %s; 15 USC 1673(b)(2) sets 50 per centum where the obligor supports another spouse or dependent child and 60 per centum where they do not, so a default picks a side of that on the employee behalf', d.column_default)::text
  from information_schema.columns d
  where d.table_schema = 'public'
    and d.table_name = 'wage_orders'
    and d.column_name = 'supports_second_family'
    and d.column_default is not null;

  return query
  select format('row level security is not enabled on public.%s', c.relname)::text,
         'Without RLS every authenticated session can read and rewrite payroll records, including wage orders and the sick leave ledger.'::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('sick_leave_policy','sick_leave_requests',
                      'sick_leave_ledger','wage_orders')
    and c.relrowsecurity = false;

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

  return query
  select format('public.%s has a DELETE policy', p.tablename)::text,
         format('policy %s permits DELETE; a denied sick leave request is the record that answers a retaliation claim and a terminated wage order proves the date withholding lawfully stopped', p.policyname)::text
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('sick_leave_policy','sick_leave_requests',
                        'sick_leave_ledger','wage_orders')
    and p.cmd = 'DELETE';

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

  return query
  select 'the one-usage-per-request index is missing'::text,
         'Without sick_leave_ledger_one_usage_per_request a repeated approve action writes two usage entries for the same request and the employee silently loses the hours twice over.'::text
  where to_regclass('public.sick_leave_ledger_one_usage_per_request') is null;

  return query
  select 'the one-live-order-per-case index is missing'::text,
         'Without wage_orders_one_live_per_case the same writ entered twice withholds twice, and the employee has no way to notice until their rent bounces.'::text
  where to_regclass('public.wage_orders_one_live_per_case') is null;

  return query
  select 'public.time_punches now accepts a sick leave punch kind'::text,
         'Sick time must never be stored as a time punch. 29 CFR 778.218(a) says such payments are not made as compensation for hours of employment and no part of them may be credited toward overtime compensation due under the Act. A sick punch would silently push a 36-hour week over forty and pay a premium on hours nobody worked.'::text
  from pg_constraint c
  where c.conrelid = to_regclass('public.time_punches')
    and to_regclass('public.time_punches') is not null
    and pg_get_constraintdef(c.oid) ilike '%sick%';

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
