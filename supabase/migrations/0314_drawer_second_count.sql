-- 0314_drawer_second_count.sql  (Fix Phase 2.2 · G-01 · F-01-9 · F-00-5 · owner D2)
--
-- WHY. The owner (D2): "Q2- close only, and it can be any second employee.
-- It doesn't need to be a lead or manager." Today a blind close takes ONE
-- employee PIN (till-core TillCloseRequest) and nothing records a second
-- counter (findings F-01-9, F-00-5). SOP-01 §4.27 step 8 covered it on paper.
--
-- WHAT.
--   drawer_sessions.second_counted_by   the second employee (PIN-verified on
--                                       the register; PIN-verified in the
--                                       back office too)
--   drawer_sessions.second_count_minor  their own count of the drawer, cents
--   drawer_sessions.second_counted_at   when it was recorded
--       All three NULL on drawers closed before this migration.
--   A check refuses the closer as their own second counter. The app checks
--   it first and says so in plain words; this is the backstop.
--   drawer_counts.count_type gains 'second' so the second person's
--   denomination breakdown is kept next to the closer's ('close').
--
-- Which count is used for over / short? The CLOSER's (closing_count_minor),
-- as before. The second count is the check on it: when the two differ the
-- register and the reconcile card show the difference as a WARNING. The owner
-- has not said a mismatch should block (G-01 requirement 2), so nothing does.
--
-- drawer_sessions and drawer_counts are both WIPE in the factory reset, so
-- the reset function needs no change.
--
-- SAFE / IDEMPOTENT: add column if not exists; constraints replaced only
-- when needed. No existing data changes. Apply MANUALLY in the SQL editor
-- after 0313.

alter table public.drawer_sessions
  add column if not exists second_counted_by uuid
    references public.employees (id) on delete set null;
alter table public.drawer_sessions
  add column if not exists second_count_minor integer;
alter table public.drawer_sessions
  add column if not exists second_counted_at timestamptz;

do $m$
declare
  c record;
begin
  if not exists (select 1 from pg_constraint where conname = 'drawer_sessions_second_not_closer') then
    alter table public.drawer_sessions
      add constraint drawer_sessions_second_not_closer
      check (second_counted_by is null or closed_by is null or second_counted_by <> closed_by);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'drawer_sessions_second_count_nonneg') then
    alter table public.drawer_sessions
      add constraint drawer_sessions_second_count_nonneg
      check (second_count_minor is null or second_count_minor >= 0);
  end if;

  -- drawer_counts.count_type: the 0038 check was declared inline, so its name
  -- was chosen by Postgres. Drop every CHECK on drawer_counts that mentions
  -- count_type (whatever it is called), then add the named one with 'second'.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.drawer_counts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%count_type%'
      and conname <> 'drawer_counts_count_type_check_v2'
  loop
    execute format('alter table public.drawer_counts drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'drawer_counts_count_type_check_v2') then
    alter table public.drawer_counts
      add constraint drawer_counts_count_type_check_v2
      check (count_type in ('open', 'close', 'verify', 'second'));
  end if;
end
$m$;

comment on column public.drawer_sessions.second_counted_by is
  'Fix Phase 2.2 (G-01, owner D2): the second employee who counted the drawer at close. Any employee, never the closer. NULL = closed before 0314.';
comment on column public.drawer_sessions.second_count_minor is
  'Fix Phase 2.2 (G-01): the second person''s own count, cents. Over/short still uses closing_count_minor; a difference is a warning only.';
comment on column public.drawer_sessions.second_counted_at is
  'Fix Phase 2.2 (G-01): when the second count was recorded.';
