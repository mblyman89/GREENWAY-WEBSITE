-- supabase/migrations/0348_time_punch_breaks.sql  (D211 - clock out for lunch or an "other" break)
--
-- Owner request (verbatim, D211): "My employees told me they cannot clock out for a lunch break. The
-- logic currently requires them to close their drawer first. There needs to be an option to clock out
-- for lunch, or, for an “other” reason."
--
-- time_punches has allowed punch_kind = 'break' since 0037, and payroll (timesheet-core) already pays
-- only 'work' punches. Nothing wrote a break, though, and there was nowhere to say WHY. This adds:
--   break_reason   'lunch' | 'other' on a break punch, NULL on a work punch (CHECK)
--   break_note     why, in the employee's words; REQUIRED for 'other' (3-200 chars), optional for lunch
-- and a partial index for "who is on break right now".
--
-- A paid 10-minute rest period stays ON the clock (WAC 296-126-092(4)), so it is not a reason here.
-- A lunch is an unpaid meal period (WAC 296-126-092(1), 29 CFR 785.19).
--
-- Existing break rows (none are expected: no screen ever wrote one) are backfilled as 'other' with the
-- note 'Recorded before migration 0348 (no reason was captured).' so the new CHECK can be added.
--
-- Factory reset: time_punches is already WIPE (0240); no new table, the pinned list is not touched.
-- Idempotent: safe to run twice. APPLY MANUALLY in the Supabase SQL editor (standing rule 15).
-- Until it is applied the clock keeps working exactly as before; "Clock out for a break" is refused
-- with "run migration 0348" rather than saved without a reason.
-- ROLLBACK: supabase/rollbacks/0348_time_punch_breaks.rollback.sql

do $precheck$
begin
  if to_regclass('public.time_punches') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0348 depends on time_punches from 0037_staffing_timeclock.sql';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'time_punches'
                    and column_name = 'task_note') then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0348 depends on time_punches.task_note from 0188_payroll_to_gl.sql';
  end if;
  if to_regclass('public.deposit_bags') is not null
     and not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'deposit_bags'
                        and column_name = 'atm_pull_twenties') then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0348 comes after 0347_deposit_bag_atm_pull.sql';
  end if;
end
$precheck$;

alter table public.time_punches add column if not exists break_reason text;
alter table public.time_punches add column if not exists break_note text;

-- Backfill any break written before this migration so the shape CHECK can be added.
update public.time_punches
   set break_reason = 'other',
       break_note = coalesce(nullif(btrim(break_note), ''), 'Recorded before migration 0348 (no reason was captured).')
 where punch_kind = 'break'
   and break_reason is null;

do $m$
begin
  if not exists (select 1 from pg_constraint where conname = 'time_punches_break_reason_values') then
    alter table public.time_punches
      add constraint time_punches_break_reason_values
      check (break_reason is null or break_reason in ('lunch', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'time_punches_break_shape') then
    alter table public.time_punches
      add constraint time_punches_break_shape
      check (
        (punch_kind = 'work' and break_reason is null and break_note is null)
        or (punch_kind = 'break' and break_reason is not null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'time_punches_break_note_len') then
    alter table public.time_punches
      add constraint time_punches_break_note_len
      check (break_note is null or char_length(btrim(break_note)) between 3 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'time_punches_break_other_needs_note') then
    alter table public.time_punches
      add constraint time_punches_break_other_needs_note
      check (break_reason is distinct from 'other' or break_note is not null);
  end if;
end
$m$;

comment on column public.time_punches.break_reason is
  'D211 (0348): why a BREAK punch was taken: lunch (unpaid meal period, WAC 296-126-092(1)) or other (note required). NULL on work punches.';
comment on column public.time_punches.break_note is
  'D211 (0348): the employee''s words for the break. Required for other (3-200 chars), optional for lunch. NULL on work punches.';

create index if not exists time_punches_open_break_idx
  on public.time_punches (employee_id)
  where clock_out_at is null and punch_kind = 'break';

notify pgrst, 'reload schema';
