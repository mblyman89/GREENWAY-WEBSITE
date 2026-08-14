-- =============================================================================
-- 0175_gl_trial_balance.sql   (slice F4)
--
-- THE TRIAL BALANCE AND THE GENERAL LEDGER REPORT — the first slice where the
-- books can be READ.
--
-- IDEMPOTENT: safe to run any number of times (AGENTS.md: migrations are applied
-- MANUALLY by Michael in the Supabase SQL editor).
--
-- -----------------------------------------------------------------------------
-- THE DEFECT THIS MIGRATION EXISTS TO PREVENT
-- -----------------------------------------------------------------------------
-- A trial balance that foots to zero is NOT proof that it is correct. ANY subset
-- of a double-entry ledger that contains whole journals foots to zero, because
-- each journal individually sums to zero. So a report can drop half the ledger
-- and still print "BALANCED".
--
-- PROVEN BY EXECUTION against a real PostgreSQL with 0172+0173+0174 applied
-- (probe run before this file was written, standing rule 13a):
--
--   #1 a real sale     cash +1,000.00 / revenue -1,000.00   status 'posted'
--   #2 a mistaken sale cash +2,500.00 / revenue -2,500.00   status 'reversed'
--   #3 reversal of #2  cash -2,500.00 / revenue +2,500.00   status 'posted'
--
--   TRUTH:                      cash +1,000.00 / revenue -1,000.00
--   FILTERING ON status='posted': cash -1,500.00 / revenue +1,500.00
--                                 ...and it footed to zero and said BALANCED.
--
-- 0174's trg_gl_mark_reversed flips the ORIGINAL to 'reversed' while the
-- REVERSAL stays 'posted'. Filtering on 'posted' therefore keeps the reversal
-- and drops what it reversed, leaving one naked half of a cancelled pair:
-- $2,500 of negative cash and $2,500 of revenue nobody ever paid. That is a
-- fictional set of books that passes its own self-check, and it is the same
-- shape as the drift Michael already lived through in Sage.
--
-- THE RULE, enforced here rather than remembered:
--     a trial balance includes status 'posted' OR 'reversed'; never 'posted'
--     alone; never a draft.
--
-- Reversed journals KEEP their lines (0172 makes posted lines immutable) and the
-- matching reversal supplies the offsetting lines, so including both nets a
-- cancelled transaction to zero. This is also the ASC 250 presentation: correct
-- by reversal, and show both the error and its correction.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS MIGRATION ADDS
--   1) gl_reportable_lines  — the ONE definition of "a line that counts",
--                             so no future report can invent its own filter
--   2) gl_trial_balance     — per entity/account balances, debit/credit columns
--   3) gl_account_activity  — the drill-down behind any TB row
--   4) gl_trial_balance_check() — refuses to certify an unbalanced TB
--   5) gl_general_ledger()  — running-balance GL detail for export
--   6) RLS/grants consistent with 0172
--
-- Money is integer cents. Positive = debit, negative = credit.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) THE SINGLE SOURCE OF TRUTH FOR "WHICH LINES COUNT".
--
--    Every report in this system reads from this view and never from
--    gl_journal_lines directly. One definition means a future report cannot
--    quietly reintroduce the status='posted' bug in its own WHERE clause.
-- -----------------------------------------------------------------------------
create or replace view public.gl_reportable_lines as
select
  l.id                as line_id,
  l.journal_id,
  l.line_no,
  j.entity_id,
  e.code              as entity_code,
  j.journal_no,
  j.journal_date,
  j.status            as journal_status,
  j.source_kind,
  j.source_ref,
  j.memo,
  j.reverses_journal_id,
  j.reversed_by_journal_id,
  l.account_id,
  a.code              as account_code,
  a.name              as account_name,
  a.type              as account_type,
  a.normal_balance,
  a.is_contra,
  l.amount_cents,
  l.cost_class,
  l.shareholder_id,
  l.description
from public.gl_journal_lines l
join public.gl_journals j on j.id = l.journal_id
join public.gl_entities e on e.id = j.entity_id
join public.gl_accounts a on a.id = l.account_id
-- THE RULE. Do not "simplify" this to j.status = 'posted'. See the header for
-- the executed proof that doing so produces a balanced, fictional report.
where j.status in ('posted', 'reversed');

comment on view public.gl_reportable_lines is
  'THE definition of a ledger line that counts in a report: journals with status posted OR reversed, never posted alone (which orphans reversals and yields a balanced but fictional trial balance), never drafts. Every GL report must read from here.';

-- -----------------------------------------------------------------------------
-- 2) THE TRIAL BALANCE.
--
--    One row per entity+account with a non-zero balance, presented in debit and
--    credit columns. Accounts that net to exactly zero are omitted: a trial
--    balance is a list of balances, and a zero balance is not one.
-- -----------------------------------------------------------------------------
create or replace view public.gl_trial_balance as
select
  entity_id,
  entity_code,
  account_id,
  account_code,
  account_name,
  account_type,
  normal_balance,
  is_contra,
  sum(amount_cents)                                   as balance_cents,
  greatest(sum(amount_cents), 0)                      as debit_cents,
  greatest(-sum(amount_cents), 0)                     as credit_cents,
  count(*)                                            as line_count,
  min(journal_date)                                   as first_activity,
  max(journal_date)                                   as last_activity,
  -- A balance sitting opposite its normal side. Sometimes legitimate (an
  -- overdrawn bank account), but negative inventory and negative ATM cash are
  -- on Michael's permanent failure corpus (standing rule 19), and both look
  -- exactly like this.
  case
    when sum(amount_cents) = 0 then false
    when normal_balance = 'debit'  and sum(amount_cents) < 0 then true
    when normal_balance = 'credit' and sum(amount_cents) > 0 then true
    else false
  end                                                 as is_abnormal
from public.gl_reportable_lines
group by entity_id, entity_code, account_id, account_code, account_name,
         account_type, normal_balance, is_contra
having sum(amount_cents) <> 0;

comment on view public.gl_trial_balance is
  'Trial balance by entity and account, all time. Positive balance_cents = net debit. Excludes accounts that net to zero. Built on gl_reportable_lines so the posted/reversed rule cannot be bypassed.';

-- -----------------------------------------------------------------------------
-- 3) ACCOUNT ACTIVITY — the drill-down behind a trial balance row.
--    Every number a human sees must be traceable to the entries that made it.
-- -----------------------------------------------------------------------------
create or replace view public.gl_account_activity as
select
  entity_code,
  account_code,
  account_name,
  journal_date,
  journal_no,
  journal_status,
  source_kind,
  source_ref,
  memo,
  description,
  cost_class,
  amount_cents,
  greatest(amount_cents, 0)  as debit_cents,
  greatest(-amount_cents, 0) as credit_cents,
  journal_id,
  line_id
from public.gl_reportable_lines;

comment on view public.gl_account_activity is
  'Line-level drill-down behind any trial balance figure, so every reported number can be traced to the entries that produced it.';

-- -----------------------------------------------------------------------------
-- 4) THE CERTIFICATION FUNCTION.
--
--    Returns the trial balance totals for an entity and period AND a verdict.
--    It REFUSES to certify a trial balance that does not tie (standing rule 14:
--    when a rule could be a warning or a refusal, choose refusal).
--
--    It also refuses to certify an EMPTY period. Zero equals zero, so an empty
--    trial balance "balances" — and a report claiming health after reading
--    nothing is exactly how a broken query masquerades as clean books.
-- -----------------------------------------------------------------------------
create or replace function public.gl_trial_balance_check(
  p_entity_code text,
  p_from        date default null,
  p_to          date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity_id     uuid;
  v_from          date := coalesce(p_from, date '2025-12-31');
  v_to            date := coalesce(p_to, date '2100-12-31');
  v_debits        bigint := 0;
  v_credits       bigint := 0;
  v_lines         bigint := 0;
  v_accounts      bigint := 0;
  v_abnormal      bigint := 0;
  v_diff          bigint;
begin
  -- AUTHORIZATION FIRST, before any argument is even looked at.
  -- This function is SECURITY DEFINER, which means it runs with the owner's
  -- rights and RLS does NOT apply inside it. Without this check it would be a
  -- public read of the entire general ledger for anyone holding any logged-in
  -- session. The books are admin-only (0172). See section 6 for the executed
  -- proof of why relying on RLS alone here does not work.
  if not public.is_admin() then
    raise exception 'TB_FORBIDDEN: the general ledger is admin-only. Staff operate the POS; the books are not part of that job.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_entity_code is null or btrim(p_entity_code) = '' then
    raise exception 'TB_NO_ENTITY: a trial balance is always for exactly one entity. The four entities file different tax forms; a combined figure belongs on no return.'
      using errcode = 'raise_exception';
  end if;

  select id into v_entity_id from public.gl_entities where code = btrim(p_entity_code);
  if v_entity_id is null then
    raise exception 'TB_UNKNOWN_ENTITY: there is no entity called %. Valid entities are greenway, atm, landholding and personal.', p_entity_code
      using errcode = 'raise_exception';
  end if;

  if v_from > v_to then
    raise exception 'TB_RANGE_BACKWARDS: the range starts % and ends %. A backwards range returns nothing, which looks identical to "no activity".', v_from, v_to
      using errcode = 'raise_exception';
  end if;

  -- Aggregate per account first, then sum the columns, so the debit/credit
  -- totals are the presentation totals a human would foot by hand.
  with per_account as (
    select account_id,
           sum(amount_cents) as bal,
           count(*)          as lines
    from public.gl_reportable_lines
    where entity_id = v_entity_id
      and journal_date between v_from and v_to
    group by account_id
    having sum(amount_cents) <> 0
  )
  select coalesce(sum(greatest(bal, 0)), 0),
         coalesce(sum(greatest(-bal, 0)), 0),
         count(*)
    into v_debits, v_credits, v_accounts
  from per_account;

  -- Count lines SEPARATELY from the account aggregation, deliberately.
  --
  -- If we counted lines only within per_account (which excludes accounts that
  -- net to zero), then a period whose every account nets to zero would report
  -- zero lines and be declared EMPTY — when in fact there was real activity
  -- that simply cancelled out. That is not a hypothetical: a sale entered by
  -- mistake and then reversed in the same period does exactly this. Telling
  -- Michael "nothing was found" when four real lines exist would be a lie, and
  -- it would hide the very reversal activity an auditor most wants to see.
  select count(*) into v_lines
  from public.gl_reportable_lines
  where entity_id = v_entity_id
    and journal_date between v_from and v_to;

  select count(*) into v_abnormal
  from (
    select a.normal_balance, sum(r.amount_cents) as bal
    from public.gl_reportable_lines r
    join public.gl_accounts a on a.id = r.account_id
    where r.entity_id = v_entity_id
      and r.journal_date between v_from and v_to
    group by r.account_id, a.normal_balance
    having sum(r.amount_cents) <> 0
  ) q
  where (q.normal_balance = 'debit'  and q.bal < 0)
     or (q.normal_balance = 'credit' and q.bal > 0);

  v_diff := v_debits - v_credits;

  if v_lines = 0 then
    return jsonb_build_object(
      'entity_code', p_entity_code,
      'from', v_from, 'to', v_to,
      'balanced', false,
      'certified', false,
      'total_debit_cents', 0,
      'total_credit_cents', 0,
      'difference_cents', 0,
      'account_count', 0,
      'line_count', 0,
      'abnormal_count', 0,
      'verdict', 'TB_EMPTY: nothing was found for this entity and period. An empty trial balance balances trivially (0 = 0) and is NOT evidence that the books are healthy. Confirm the entity and the dates.'
    );
  end if;

  if v_diff <> 0 then
    return jsonb_build_object(
      'entity_code', p_entity_code,
      'from', v_from, 'to', v_to,
      'balanced', false,
      'certified', false,
      'total_debit_cents', v_debits,
      'total_credit_cents', v_credits,
      'difference_cents', v_diff,
      'account_count', v_accounts,
      'line_count', v_lines,
      'abnormal_count', v_abnormal,
      'verdict', format(
        'TB_OUT_OF_BALANCE: debits %s and credits %s differ by %s cents. Every journal is forced to balance when it posts, so this means lines were lost, double-counted, or read from outside the ledger. Do NOT post an adjustment to make it tie — find the cause. A balancing plug is how drift begins.',
        v_debits, v_credits, v_diff)
    );
  end if;

  return jsonb_build_object(
    'entity_code', p_entity_code,
    'from', v_from, 'to', v_to,
    'balanced', true,
    'certified', true,
    'total_debit_cents', v_debits,
    'total_credit_cents', v_credits,
    'difference_cents', 0,
    'account_count', v_accounts,
    'line_count', v_lines,
    'abnormal_count', v_abnormal,
    'verdict', format(
      '%s balances for %s to %s: %s cents of debits against %s cents of credits across %s accounts and %s lines.%s',
      p_entity_code, v_from, v_to, v_debits, v_credits, v_accounts, v_lines,
      case when v_abnormal > 0
        then format(' NOTE: %s account(s) carry a balance on the opposite side from normal — review them.', v_abnormal)
        else '' end)
  );
end $$;

comment on function public.gl_trial_balance_check(text, date, date) is
  'Returns trial balance totals for one entity and period with a plain-English verdict. Refuses to certify an unbalanced OR an empty trial balance.';

-- -----------------------------------------------------------------------------
-- 5) THE GENERAL LEDGER REPORT — every line for an account, in date order,
--    with a running balance. This is what an auditor asks for first.
-- -----------------------------------------------------------------------------
create or replace function public.gl_general_ledger(
  p_entity_code  text,
  p_account_code text default null,
  p_from         date default null,
  p_to           date default null
)
returns table (
  journal_date     date,
  journal_no       bigint,
  journal_status   text,
  account_code     text,
  account_name     text,
  source_kind      text,
  source_ref       text,
  memo             text,
  description      text,
  cost_class       text,
  debit_cents      bigint,
  credit_cents     bigint,
  running_balance_cents bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity_id uuid;
  v_from date := coalesce(p_from, date '2025-12-31');
  v_to   date := coalesce(p_to, date '2100-12-31');
begin
  -- AUTHORIZATION FIRST. Same reasoning as gl_trial_balance_check: SECURITY
  -- DEFINER bypasses RLS, so the check is written by hand. This function is the
  -- more sensitive of the two — it returns line-by-line detail, not totals.
  if not public.is_admin() then
    raise exception 'GL_FORBIDDEN: the general ledger is admin-only. Staff operate the POS; the books are not part of that job.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_entity_code is null or btrim(p_entity_code) = '' then
    raise exception 'GL_NO_ENTITY: a general ledger report is always for exactly one entity.'
      using errcode = 'raise_exception';
  end if;
  select id into v_entity_id from public.gl_entities where code = btrim(p_entity_code);
  if v_entity_id is null then
    raise exception 'GL_UNKNOWN_ENTITY: there is no entity called %.', p_entity_code
      using errcode = 'raise_exception';
  end if;
  if v_from > v_to then
    raise exception 'GL_RANGE_BACKWARDS: the range starts % and ends %.', v_from, v_to
      using errcode = 'raise_exception';
  end if;

  return query
  select
    r.journal_date,
    r.journal_no,
    r.journal_status,
    r.account_code,
    r.account_name,
    r.source_kind,
    r.source_ref,
    r.memo,
    r.description,
    r.cost_class,
    greatest(r.amount_cents, 0)::bigint  as debit_cents,
    greatest(-r.amount_cents, 0)::bigint as credit_cents,
    sum(r.amount_cents) over (
      partition by r.account_code
      order by r.journal_date, r.journal_no, r.line_no
      rows between unbounded preceding and current row
    )::bigint as running_balance_cents
  from public.gl_reportable_lines r
  where r.entity_id = v_entity_id
    and r.journal_date between v_from and v_to
    and (p_account_code is null or r.account_code = btrim(p_account_code))
  order by r.account_code, r.journal_date, r.journal_no, r.line_no;
end $$;

comment on function public.gl_general_ledger(text, text, date, date) is
  'General ledger detail with a running balance per account. Reads gl_reportable_lines, so reversed originals and their reversals both appear and net correctly.';

-- -----------------------------------------------------------------------------
-- 6) ACCESS CONTROL. Read this section before changing a single line of it.
--
--    An earlier draft of this migration carried the comment "views inherit RLS
--    from their base tables, so no additional policy is needed here." THAT WAS
--    FALSE, and it was caught by executing it rather than believing it.
--
--    THE PROOF (run against a real PostgreSQL 15, not reasoned about):
--      create table secret_ledger(...); insert one row;
--      alter table secret_ledger enable row level security;   -- no policy
--      create view v_secret as select * from secret_ledger;   -- owned by postgres
--      grant select on v_secret to authenticated;
--      set role authenticated; select count(*) from v_secret;  -->  1
--
--    One row. The row RLS was supposed to hide. A view executes with its
--    OWNER's privileges by default, so it launders the owner's access to
--    whoever can select from the view. Repeating the same probe after
--    `alter view v_secret set (security_invoker = true)` produced
--    "ERROR: permission denied for table secret_ledger" — correctly denied.
--
--    WHAT THIS MEANT IN PRACTICE: the books are admin-only by design (0172:
--    "Staff operate the POS; they have no business reading or writing the
--    general ledger"). But every budtender holds an `authenticated` session.
--    Shipping the original grants would have handed every budtender the
--    complete general ledger — every sale, every margin, every owner
--    distribution — through gl_reportable_lines. Not a theoretical exposure:
--    a working one, three lines of SQL wide.
--
--    THE FIX HAS TWO INDEPENDENT LAYERS, because one lock is not a lock:
--
--    (a) security_invoker on all three views, so 0172's admin-only policies
--        actually apply through them. This mirrors what 0130 already had to do
--        for kb_noncannabis_catalog — the same trap, caught once before in this
--        repo, and walked straight back into here.
--
--    (b) An explicit is_admin() gate inside both SECURITY DEFINER functions.
--        SECURITY DEFINER deliberately bypasses RLS, so layer (a) does NOT
--        protect the functions at all — they were the wider hole of the two.
--        A SECURITY DEFINER function without an authorization check is simply
--        a public API onto the owner's privileges.
--
--    The service-role client the server uses is not `authenticated` and does
--    not go through these paths, so server-side reporting is unaffected.
-- -----------------------------------------------------------------------------
alter view public.gl_reportable_lines set (security_invoker = true);
alter view public.gl_trial_balance    set (security_invoker = true);
alter view public.gl_account_activity set (security_invoker = true);

grant select on public.gl_reportable_lines to authenticated;
grant select on public.gl_trial_balance    to authenticated;
grant select on public.gl_account_activity to authenticated;

-- The functions are SECURITY DEFINER (they must be, to read across the ledger
-- consistently), so their access check is written by hand, above, in each
-- function body. `public` retains execute by default in PostgreSQL, which is
-- why it is explicitly revoked here before granting to real sessions.
revoke all on function public.gl_trial_balance_check(text, date, date) from public;
revoke all on function public.gl_general_ledger(text, text, date, date) from public;
grant execute on function public.gl_trial_balance_check(text, date, date) to authenticated;
grant execute on function public.gl_general_ledger(text, text, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) THE 2027 CLIFF — opening fiscal years.
--
--    FOUND BY EXECUTION, not by reading. A test posted an entry dated
--    2028-02-29 and got:
--        GL_NO_PERIOD: no accounting period exists for entity ... on 2028-02-29
--
--    The cause is not a bug in that check — the check is right and should stay.
--    The cause is that 0172 seeds gl_periods for FISCAL YEAR 2026 ONLY:
--        insert into public.gl_periods (...) ... 2026, generate_series(1,12) ...
--    and nothing in 0172, 0173, 0174 or this migration ever opens another year.
--
--    WHAT THAT MEANS IN THE REAL WORLD: at 12:00am on January 1st, 2027, every
--    single posting to the general ledger begins failing. Not degrading —
--    failing. The first sale of the new year, the first purchase, the first
--    bank entry. On a holiday. The books simply stop accepting entries, and the
--    error message ("no accounting period exists") reads like data corruption
--    to anyone who did not write this file.
--
--    It is fixed here, now, because this migration has not yet been applied and
--    a scheduled outage on New Year's Day is not something to leave in place
--    while waiting for a tidier slice to come along.
--
--    Periods are still created OPEN and are still closed and locked by hand.
--    This adds no automation to the close process — it only guarantees that a
--    place to post exists. Opening a period is not an accounting judgement;
--    closing one is, and that stays manual.
-- -----------------------------------------------------------------------------
create or replace function public.gl_open_fiscal_year(p_fiscal_year integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer;
begin
  if not public.is_admin() then
    raise exception 'GL_FORBIDDEN: only an admin may open a fiscal year.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The table's own check constraint is fiscal_year between 2026 and 2100; this
  -- gives a human-readable refusal instead of a constraint violation.
  if p_fiscal_year is null or p_fiscal_year < 2026 or p_fiscal_year > 2100 then
    raise exception 'GL_BAD_FISCAL_YEAR: % is not a valid fiscal year. The books begin in 2026.', p_fiscal_year
      using errcode = 'raise_exception';
  end if;

  -- Twelve calendar months, for every entity, open. ON CONFLICT DO NOTHING
  -- makes this safe to run repeatedly and safe to run when some entities
  -- already have the year (e.g. a new entity added mid-stream).
  insert into public.gl_periods (entity_id, fiscal_year, period_no, start_date, end_date)
  select e.id,
         p_fiscal_year,
         m.n,
         make_date(p_fiscal_year, m.n, 1),
         (make_date(p_fiscal_year, m.n, 1) + interval '1 month - 1 day')::date
  from public.gl_entities e
  cross join generate_series(1, 12) as m(n)
  on conflict (entity_id, fiscal_year, period_no) do nothing;

  get diagnostics v_created = row_count;
  return v_created;
end $$;

comment on function public.gl_open_fiscal_year(integer) is
  'Opens all twelve monthly periods for every entity for a fiscal year. Idempotent. Exists because 0172 seeded 2026 only, which would have stopped all posting on 2027-01-01.';

revoke all on function public.gl_open_fiscal_year(integer) from public;
grant execute on function public.gl_open_fiscal_year(integer) to authenticated;

-- Open the years the business can actually reach from here. This is deliberate
-- and finite rather than "open everything to 2100": an open period is a place
-- where a typo can land. A sale fat-fingered to 2071 should be REFUSED, which
-- is exactly what GL_NO_PERIOD does well. Five years is enough runway that
-- nobody is surprised on a holiday, and short enough that a wrong year is
-- still caught. Extending it is one call: select gl_open_fiscal_year(2031);
do $$
declare y integer;
begin
  foreach y in array array[2026, 2027, 2028, 2029, 2030] loop
    perform public.gl_open_fiscal_year(y);
  end loop;
end $$;
