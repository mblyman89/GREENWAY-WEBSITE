-- =============================================================================
-- 0184 — THE CUT-OVER IS 2026-11-01, NOT 2026-01-01 (slice books-02)
--
-- WHAT THIS FIXES, AND WHY IT IS URGENT
--
-- The entire general ledger was built assuming a 1 January 2026 cut-over, with
-- the opening balance sheet dated 2025-12-31. That assumption is hard-coded, in
-- literal form, in the two functions that create the single most important
-- entry in the system:
--
--     0176 §gl_bless_opening_balances       p_journal_date := date '2025-12-31'
--     0176 §gl_close_opening_balance_equity p_journal_date := date '2025-12-31'
--
-- Michael's actual cut-over, decided 2026-08-17 and recorded verbatim:
--
--   "I am cutting over from Cultivera pos and sage on November 1st 2026. I will
--    drop Cultivera completely. I will keep sage and run both books in parallel
--    until year end. If all goes well, we will drop sage and use our platform
--    exclusively. Sage will have all of my Cultivera activity recorded in it
--    already, so I won't need to recreate the full year. I will start from
--    beginning balances."
--
-- So the opening balance sheet is dated 2026-10-31 (the day before he starts),
-- and the first day of business on this platform is 2026-11-01.
--
-- Left unfixed, blessing the worksheet would have stamped the cut-over TEN
-- MONTHS EARLY. Nothing would have errored. The journal would have balanced.
-- Every report would have rendered. And every period, every comparative, every
-- 280E calculation and every tax figure would have been measured from a date
-- Michael's business did not cut over on — with ten months of Sage-recorded
-- activity sitting on the wrong side of the line. That is the exact shape of
-- error this branch exists to prevent: silent, balanced, and wrong.
--
-- WHY A CONFIG TABLE INSTEAD OF JUST CHANGING THE LITERAL
-- Because the literal was the bug. A date that governs every downstream number
-- should be stated ONCE, in a place a human can read, with the reason attached
-- — not copied into two function bodies where the copies can drift. It is also
-- how the parallel-run window (Nov–Dec 2026, books kept in BOTH systems) gets
-- represented at all: that window has a start and an end, and reconciliation
-- needs to know them.
--
-- WHAT IS DELIBERATELY *NOT* CHANGED
--   * The `gl_journals_line_in_the_sand` CHECK. It reads
--         journal_date >= date '2026-01-01'
--         or (source_kind = 'opening_balance' and journal_date = date '2025-12-31')
--     and 2026-10-31 satisfies the FIRST arm on its own. No constraint change is
--     needed, and not touching a CHECK on a table with live rows is the safer
--     path. The 2025-12-31 escape hatch stays valid but unused.
--   * Period control. 0172 §8 exempts source_kind='opening_balance' from period
--     checks entirely, so it does not matter that 2026-10-31 now falls inside a
--     real period.
--
-- STANDING RULES HONOURED
--   rule 7  — money is integer cents
--   rule 10 — the line in the sand is respected, not weakened
--   rule 12 — the assumption is RECORDED, never applied silently
--   rule 14 — when in doubt, REFUSE
--
-- IDEMPOTENT. Safe to run repeatedly, as repo law requires.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- §1  THE CONVERSION CONFIGURATION
--
-- Exactly one row, enforced. This is the single statement of when the business
-- changed systems, and every function that needs the cut-over date reads it
-- from here rather than carrying its own copy.
-- -----------------------------------------------------------------------------
create table if not exists public.gl_conversion_config (
  id                    integer primary key default 1,

  -- The first day the business runs on THIS platform.
  cutover_date          date not null,

  -- The opening balance sheet date: the close of business the day before.
  -- Derived, but STORED, because it is the date stamped on the one entry the
  -- whole ledger rests on and it must not be recomputed differently anywhere.
  opening_balance_date  date not null,

  -- The parallel run: the window during which the books are kept in BOTH this
  -- platform and Sage, so the two can be compared before Sage is retired.
  --   "I will keep sage and run both books in parallel until year end."
  parallel_run_start    date not null,
  parallel_run_end      date not null,

  -- The system being left behind, named so the record says what was replaced.
  legacy_pos_system     text not null default 'Cultivera',
  legacy_gl_system      text not null default 'Sage 50',

  -- Has the owner declared the parallel run successful and retired Sage? This
  -- starts false and only the owner can set it. It is NOT automatic: agreeing
  -- with Sage for two months is evidence, not proof.
  --   "If all goes well, we will drop sage and use our platform exclusively."
  legacy_retired        boolean not null default false,
  legacy_retired_at     timestamptz,
  legacy_retired_note   text,

  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id),

  -- One row. Ever.
  constraint gl_conversion_config_singleton check (id = 1),

  -- The opening balance sheet is the day BEFORE the cut-over. Not the same day
  -- (you cannot both open and trade on it) and not an arbitrary earlier date.
  constraint gl_conversion_config_opening_is_day_before
    check (opening_balance_date = cutover_date - 1),

  -- The parallel run starts when the platform does.
  constraint gl_conversion_config_parallel_starts_at_cutover
    check (parallel_run_start = cutover_date),

  constraint gl_conversion_config_parallel_ordered
    check (parallel_run_end >= parallel_run_start),

  -- Retirement must be attributable in time.
  constraint gl_conversion_config_retired_has_timestamp
    check ((legacy_retired = false and legacy_retired_at is null)
        or (legacy_retired = true  and legacy_retired_at is not null))
);

comment on table public.gl_conversion_config is
  'The one statement of when Greenway left Cultivera/Sage for this platform. Cut-over 2026-11-01; opening balance sheet 2026-10-31; books run in parallel with Sage through 2026-12-31.';
comment on column public.gl_conversion_config.opening_balance_date is
  'The date stamped on the opening-balance journal. Every downstream number is measured from here.';
comment on column public.gl_conversion_config.legacy_retired is
  'Set by the OWNER only, after the parallel run is reconciled. Agreeing with Sage is evidence, not proof.';

-- Seed the one row with Michael's actual dates. `on conflict do nothing` so a
-- re-run never overwrites a date the owner has since adjusted.
insert into public.gl_conversion_config
  (id, cutover_date, opening_balance_date, parallel_run_start, parallel_run_end)
values
  (1, date '2026-11-01', date '2026-10-31', date '2026-11-01', date '2026-12-31')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- §2  ACCOUNTING BASIS
--
-- Owner decision, recorded verbatim (2026-08-17):
--   "we are accrual based for all entities and my person."
--
-- This is stored per entity rather than as one global flag, because the basis
-- is an ENTITY-level tax attribute — each of the four files its own return, and
-- a future entity could in principle differ. Recording it per entity means the
-- books can never silently assume a basis they were not told.
-- -----------------------------------------------------------------------------
do $basis$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gl_entities'
      and column_name = 'accounting_basis'
  ) then
    alter table public.gl_entities
      add column accounting_basis text not null default 'accrual'
        check (accounting_basis in ('accrual','cash'));
  end if;
end $basis$;

comment on column public.gl_entities.accounting_basis is
  'Owner decision 2026-08-17: "we are accrual based for all entities and my person." Accrual for all four sets of books.';

-- Make it explicit rather than relying on the column default, so the value is a
-- recorded decision rather than an accident of DDL ordering.
update public.gl_entities set accounting_basis = 'accrual'
 where accounting_basis is distinct from 'accrual';

-- -----------------------------------------------------------------------------
-- §3  READ THE CUT-OVER DATE
--
-- One accessor, so nothing anywhere needs to know the table's shape. STABLE, so
-- the planner may cache it within a statement.
-- -----------------------------------------------------------------------------
create or replace function public.gl_opening_balance_date()
returns date language sql stable security definer set search_path = public as $$
  select opening_balance_date from public.gl_conversion_config where id = 1;
$$;

comment on function public.gl_opening_balance_date() is
  'The date the opening-balance journal carries (2026-10-31). Read from gl_conversion_config so the date is stated once.';

create or replace function public.gl_cutover_date()
returns date language sql stable security definer set search_path = public as $$
  select cutover_date from public.gl_conversion_config where id = 1;
$$;

comment on function public.gl_cutover_date() is
  'The first day of business on this platform (2026-11-01).';

-- -----------------------------------------------------------------------------
-- §4  RE-POINT THE TWO CUT-OVER FUNCTIONS AT THE CONFIG
--
-- Rather than re-declaring both function bodies here (which would duplicate ~150
-- lines of 0176 and guarantee the copies drift), the literal is REPLACED inside
-- the live definitions, the same catalog-driven technique 0179 used for the
-- owner-only re-gate. A function whose text no longer contains the literal is
-- left untouched, so this is safe to run repeatedly.
--
-- The replacement is deliberately narrow: only the `p_journal_date :=` argument
-- is rewritten. Comments mentioning 2025-12-31 are left alone — they explain the
-- history, and rewriting prose is how comments start lying.
-- -----------------------------------------------------------------------------
do $repoint$
declare
  r        record;
  v_def    text;
  v_new    text;
  v_count  integer := 0;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('gl_bless_opening_balances','gl_close_opening_balance_equity')
  loop
    v_def := r.def;

    -- Only the argument, not every mention of the date.
    v_new := replace(
      v_def,
      'p_journal_date   := date ''2025-12-31''',
      'p_journal_date   := public.gl_opening_balance_date()');
    v_new := replace(
      v_new,
      'p_journal_date := date ''2025-12-31''',
      'p_journal_date := public.gl_opening_balance_date()');

    -- The default memo names the date; keep it truthful.
    v_new := replace(
      v_new,
      '''Opening balances at cut-over 2025-12-31 for ''',
      '''Opening balances at cut-over '' || public.gl_opening_balance_date() || '' for ''');

    if v_new is distinct from v_def then
      execute v_new;
      v_count := v_count + 1;
      raise notice '0184: re-pointed %() at gl_opening_balance_date()', r.proname;
    end if;
  end loop;

  raise notice '0184: % cut-over function(s) re-pointed', v_count;
end $repoint$;

-- -----------------------------------------------------------------------------
-- §5  RLS — the config is part of the books, so it is OWNER ONLY
--
-- Consistent with 0179 and with the owner decision: "there is no reason anyone
-- else needs to see my books or my financials ever."
-- -----------------------------------------------------------------------------
alter table public.gl_conversion_config enable row level security;

drop policy if exists gl_conversion_config_owner_read on public.gl_conversion_config;
create policy gl_conversion_config_owner_read
  on public.gl_conversion_config for select
  using (public.is_owner());

drop policy if exists gl_conversion_config_owner_write on public.gl_conversion_config;
create policy gl_conversion_config_owner_write
  on public.gl_conversion_config for update
  using (public.is_owner()) with check (public.is_owner());

-- Nobody inserts or deletes: there is exactly one row and it is seeded here.
-- Omitting those policies denies them under RLS, which is the intent.

-- -----------------------------------------------------------------------------
-- §6  AUDIT — prove no cut-over function still carries the old literal date
--
-- Empty result = passing. Same shape as gl_audit_owner_only_gate() in 0179.
-- -----------------------------------------------------------------------------
create or replace function public.gl_audit_cutover_date()
returns table (function_name text, problem text)
language sql stable security definer set search_path = public as $$
  select p.proname::text,
         'still posts the opening balance at a hard-coded 2025-12-31'::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('gl_bless_opening_balances','gl_close_opening_balance_equity')
    and pg_get_functiondef(p.oid) like '%p_journal_date%date ''2025-12-31''%';
$$;

comment on function public.gl_audit_cutover_date() is
  'Returns a row for any cut-over function still hard-coding 2025-12-31. An EMPTY result means the cut-over date is correctly read from gl_conversion_config.';

revoke all on function public.gl_audit_cutover_date() from public;
grant execute on function public.gl_audit_cutover_date() to authenticated;
revoke all on function public.gl_opening_balance_date() from public;
grant execute on function public.gl_opening_balance_date() to authenticated;
revoke all on function public.gl_cutover_date() from public;
grant execute on function public.gl_cutover_date() to authenticated;
