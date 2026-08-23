-- ═══════════════════════════════════════════════════════════════════════════
-- 0202_wage_order_answer_log.sql   (books-40c)
--
-- ADDS THE FACT THAT LETS A REMINDER STOP:
--
--     answer_filed_at        date
--     answer_filed_note      text
--     answer_not_required    boolean not null default false
--     answer_waived_reason   text
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY THIS COLUMN IS THE WHOLE POINT OF THE SLICE
-- ───────────────────────────────────────────────────────────────────────────
--
-- books-40c adds deadline surveillance: the system watches the twenty-day
-- answer clock in RCW 26.18.110(1) and the sixty-day creditor lien in
-- RCW 6.27.350(1), and emails and pushes Michael before either runs out.
--
-- A reminder is only useful if it can be SATISFIED. Without somewhere to
-- record "the affidavit went out on the 14th", the reminder engine has no way
-- to know the job is done, so it nags forever. A person who is nagged about a
-- task they have already completed learns, correctly and permanently, that the
-- alert means nothing. The next one gets ignored too - including the one that
-- mattered.
--
-- So this is not bookkeeping garnish. An alerting system without an
-- acknowledgement path is worse than no alerting system, because it trains the
-- person it is protecting to ignore it. This migration is what makes the
-- watchman credible.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY THE ANSWER IS TRACKED ON THE ORDER AND NOT IN A SEPARATE TABLE
-- ───────────────────────────────────────────────────────────────────────────
--
-- One order, one answer. RCW 26.18.110(1) requires "an answer" by sworn
-- affidavit within twenty days of service - a single filing, not a stream of
-- events. A child table would buy history nobody needs and cost a join on the
-- hot path of the reminder engine, which asks "which live orders have no
-- answer on file?" every single day.
--
-- If an amended answer is ever filed, the note column records it in words and
-- the date moves. The termination_note column already sets that precedent.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY THERE ARE TWO WAYS TO SATISFY IT, AND WHY THE SECOND ONE IS AWKWARD
-- ───────────────────────────────────────────────────────────────────────────
--
--   answer_filed_at      - the affidavit was filed. The normal path.
--   answer_not_required  - there is genuinely no answer duty here.
--
-- The second exists because it is real: a federal or state tax levy is not
-- served under chapter 26.18 or chapter 6.27 RCW at all, and neither statute's
-- answer machinery applies to it. Forcing "filed" on an order that never
-- required a filing would put a false statement in the record.
--
-- But it is a loaded gun. "Not required" is also exactly what a tired person
-- clicks at 6pm to make an alert go away, and the consequence of getting it
-- wrong on a support order is liability for one hundred percent of somebody
-- else's child support under RCW 26.18.110(6)(b).
--
-- So it is deliberately awkward:
--   * it defaults to false and must be set on purpose,
--   * it REQUIRES a written reason (the check below), and
--   * the application layer refuses it outright for child_support and
--     spousal_support, where an answer duty always exists.
--
-- The database enforces the reason. The application enforces the kind. Two
-- layers, because a database check cannot explain itself to a human being and
-- an application check is not a guarantee.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ───────────────────────────────────────────────────────────────────────────
--
-- It does not backfill. Every existing live order is treated as having no
-- answer on file, which will make the watchman shout about them the first
-- morning it runs. That is the correct behaviour and it is not a bug: this
-- system has never once tracked whether those answers were filed, so the
-- honest state of that knowledge is "unknown", and unknown on a twenty-day
-- statutory deadline should be loud.
--
-- Defaulting them to "filed" would silence the alarm by asserting something
-- nobody checked. That is the one outcome worth avoiding here (standing rule
-- 62d: never invent a default). Michael clears each one in a few seconds by
-- recording the date the affidavit actually went out, or by saying so in the
-- note if it did not.
--
-- Running this file a second time is safe and does nothing.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 1. The columns.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.wage_orders
  add column if not exists answer_filed_at date;

alter table public.wage_orders
  add column if not exists answer_filed_note text;

alter table public.wage_orders
  add column if not exists answer_not_required boolean not null default false;

alter table public.wage_orders
  add column if not exists answer_waived_reason text;

comment on column public.wage_orders.answer_filed_at is
  'The date the sworn answer or affidavit for this order was actually filed. '
  'RCW 26.18.110(1) requires it within twenty days of SERVICE (served_date), '
  'and RCW 26.18.110(6)(b) makes failing to answer an independent route to '
  'liability for the whole support debt - withholding correctly does not cure '
  'a missing answer. NULL means no answer is on file, which is what the '
  'watchman reminds about. Never inferred and never backfilled.';

comment on column public.wage_orders.answer_filed_note is
  'What was filed and how, in plain words - "sworn affidavit mailed to the '
  'registry, certified 7014 1120 0000 1234 5678". This is the sentence that '
  'answers the question two years later. Optional, and strongly encouraged.';

comment on column public.wage_orders.answer_not_required is
  'TRUE only where no answer duty exists - a tax levy is not served under '
  'chapter 26.18 or 6.27 RCW and neither answer machinery applies. Requires a '
  'written reason. The application refuses this for child_support and '
  'spousal_support, where an answer is always required.';

comment on column public.wage_orders.answer_waived_reason is
  'Why no answer is required. Mandatory whenever answer_not_required is true, '
  'because an unexplained waiver looks exactly like a mistake.';


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 2. An answer cannot be filed before the order was served.
--
-- Same reasoning as 0201's served-after-ordered check: if these arrive out of
-- order somebody mistyped a date, and the likeliest mistype is on the date
-- that drives a statutory deadline. Catching it at entry is cheap; discovering
-- it when a default judgment notice arrives is not.
--
-- Tolerates NULL on either side so it can never block step 1.
-- ───────────────────────────────────────────────────────────────────────────
do $mig0202a$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'wage_orders_answer_after_served'
       and conrelid = 'public.wage_orders'::regclass
  ) then
    alter table public.wage_orders
      add constraint wage_orders_answer_after_served
      check (answer_filed_at is null
             or served_date is null
             or answer_filed_at >= served_date);
    raise notice '0202: added wage_orders_answer_after_served.';
  else
    raise notice '0202: wage_orders_answer_after_served already present.';
  end if;
end
$mig0202a$;


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 3. A waiver must explain itself.
--
-- The reason column is what makes "not required" auditable. Without it the
-- flag is just a mute button, and a mute button on a statutory deadline is a
-- liability generator. Five characters is the same floor the termination note
-- uses in 0198 - long enough to stop a stray keystroke, short enough that it
-- never blocks somebody writing a real reason.
-- ───────────────────────────────────────────────────────────────────────────
do $mig0202b$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'wage_orders_waiver_has_reason'
       and conrelid = 'public.wage_orders'::regclass
  ) then
    alter table public.wage_orders
      add constraint wage_orders_waiver_has_reason
      check (answer_not_required = false
             or (answer_waived_reason is not null
                 and length(btrim(answer_waived_reason)) >= 5));
    raise notice '0202: added wage_orders_waiver_has_reason.';
  else
    raise notice '0202: wage_orders_waiver_has_reason already present.';
  end if;
end
$mig0202b$;


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 4. An order cannot be both answered and exempt from answering.
--
-- These two states are contradictory, and a row holding both is a row whose
-- history nobody can reconstruct. If an answer was in fact filed, that is the
-- stronger and more useful fact - keep it and clear the waiver.
-- ───────────────────────────────────────────────────────────────────────────
do $mig0202c$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'wage_orders_answer_xor_waiver'
       and conrelid = 'public.wage_orders'::regclass
  ) then
    alter table public.wage_orders
      add constraint wage_orders_answer_xor_waiver
      check (not (answer_filed_at is not null and answer_not_required = true));
    raise notice '0202: added wage_orders_answer_xor_waiver.';
  else
    raise notice '0202: wage_orders_answer_xor_waiver already present.';
  end if;
end
$mig0202c$;


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 5. Index the question the watchman asks every morning.
--
-- "Which live orders still have no answer on file?" runs once a day from the
-- cron and once per page load on the garnishments board. A partial index on
-- exactly that predicate keeps it a lookup rather than a scan, and stays small
-- because it only ever holds the rows that are still outstanding - the index
-- shrinks as the work gets done.
-- ───────────────────────────────────────────────────────────────────────────
create index if not exists wage_orders_answer_outstanding_idx
  on public.wage_orders (served_date)
  where answer_filed_at is null
    and answer_not_required = false
    and status <> 'terminated';


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 6. Tell the reader what just happened, in numbers.
--
-- A migration that prints nothing leaves the operator guessing whether it did
-- anything. This one names exactly how much noise the watchman is about to
-- make on its first run, so that noise is expected rather than alarming.
-- ───────────────────────────────────────────────────────────────────────────
do $mig0202d$
declare
  outstanding bigint;
  supports    bigint;
begin
  select count(*)
    into outstanding
    from public.wage_orders
   where answer_filed_at is null
     and answer_not_required = false
     and status <> 'terminated';

  select count(*)
    into supports
    from public.wage_orders
   where answer_filed_at is null
     and answer_not_required = false
     and status <> 'terminated'
     and order_kind in ('child_support', 'spousal_support');

  if outstanding = 0 then
    raise notice '0202: no live order is missing an answer. The watchman will '
                 'be quiet until the next order is served.';
  else
    raise notice '0202: % live order(s) have no answer on file, % of them '
                 'support orders. This is not a backfill error - nothing has '
                 'ever tracked these, so the honest state is unknown, and '
                 'unknown on a twenty-day deadline is deliberately loud.',
                 outstanding, supports;
    raise notice '0202: clear each one at Books -> Garnishments by recording '
                 'the date the affidavit was filed. Do not guess the date.';
  end if;
end
$mig0202d$;


-- ═══════════════════════════════════════════════════════════════════════════
-- AUDIT. Paste this after the migration. It is a WORKLIST, not a pass/fail.
--
-- Rows here are live orders with no answer recorded, most urgent first. On a
-- fresh install this is empty. On an existing one it is the list of things the
-- system has never been able to see until today.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- select case_number,
--        order_kind,
--        served_date,
--        case
--          when order_kind in ('child_support','spousal_support')
--            then served_date + 20
--          else null
--        end                                    as answer_due_rcw_26_18_110_1,
--        case
--          when order_kind in ('child_support','spousal_support')
--            then (served_date + 20) - current_date
--          else null
--        end                                    as days_remaining,
--        'read the deadline off the writ'       as note_for_creditor_writs
--   from public.wage_orders
--  where answer_filed_at is null
--    and answer_not_required = false
--    and status <> 'terminated'
--  order by served_date nulls first;
