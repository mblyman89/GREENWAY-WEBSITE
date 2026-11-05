-- supabase/migrations/0343_drawer_count_integrity.sql  (D180 S3 - blind-count integrity)
--
-- Owner request (verbatim, D180 go-ahead): "I am making all of my employees manager types. I am
-- not big enough to have a dedicated manager per shift, so I need to trust my employees, which
-- means we need a system that is very good at beating the fraud triangle."
--
-- The 2026-11-04 audit found that reconcile (D126) and the D127 correction REPLACED
-- closing_count_minor, so History showed the second counter's figure under "Closed by <closer>
-- (blind count)". The closer's own count must be kept exactly as they typed it.
--
--   1. drawer_sessions.reconciled_count_minor - the count the drawer was reconciled on (the
--      closer's, the second counter's, or a typed recount). Books, deposit and EOD use it.
--      closing_count_minor is now ONLY the closer's own blind count.
--   2. drawer_sessions.second_count_opened_at / second_count_flags / second_count_entered_by_login
--      - when the blind second-count form was shown (server-signed), the warnings worked out
--      when it was saved ('fast', 'identical_and_fast', 'closer_login', 'no_timer'), and the
--      signed-in back-office login's employee record that entered it.
--   3. Backfill, for drawers already reconciled: reconciled_count_minor := closing_count_minor
--      (what the books were posted on), then closing_count_minor is restored from the closer's
--      own drawer_counts 'close' row when the two differ. Over/short and the books are unchanged.
--   4. Trigger drawer_sessions_counts_immutable: once a drawer has left 'open', its
--      closing_count_minor can never change; once a second count is saved, second_count_minor /
--      second_counted_by can never change. A correction changes reconciled_count_minor only.
--
-- Factory reset: drawer_sessions is WIPE (delete) - the trigger is BEFORE UPDATE only.
-- Idempotent: safe to run twice. APPLY MANUALLY in the Supabase SQL editor (standing rule).
-- Until it is applied the app keeps working the old way (it falls back when the columns are
-- missing), and the second-count warnings live in the audit log only.

alter table public.drawer_sessions add column if not exists reconciled_count_minor integer;
alter table public.drawer_sessions add column if not exists second_count_opened_at timestamptz;
alter table public.drawer_sessions add column if not exists second_count_flags text[] not null default '{}';
alter table public.drawer_sessions add column if not exists second_count_entered_by_login uuid
  references public.employees(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'drawer_sessions_reconciled_count_nonneg') then
    alter table public.drawer_sessions
      add constraint drawer_sessions_reconciled_count_nonneg
      check (reconciled_count_minor is null or reconciled_count_minor >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'drawer_sessions_second_count_flags_known') then
    alter table public.drawer_sessions
      add constraint drawer_sessions_second_count_flags_known
      check (second_count_flags <@ array['fast', 'identical_and_fast', 'closer_login', 'no_timer']::text[]);
  end if;
end
$$;

comment on column public.drawer_sessions.closing_count_minor is
  'D180: the CLOSER''s own blind count, cents, exactly as typed. Never changed after close (trigger drawer_sessions_counts_immutable).';
comment on column public.drawer_sessions.reconciled_count_minor is
  'D180 (0343): the count the drawer was reconciled on, cents (closer, second counter or recount). Books / deposit / EOD use this. A D127 correction changes this, never closing_count_minor.';
comment on column public.drawer_sessions.second_count_opened_at is
  'D180 (0343): when the blind second-count form was shown (server-signed token). NULL = unknown.';
comment on column public.drawer_sessions.second_count_flags is
  'D180 (0343): warnings at save: fast (<2 min), identical_and_fast (every piece equal and fast), closer_login (entered from the closer''s own sign-in), no_timer. Warnings only, never a block.';
comment on column public.drawer_sessions.second_count_entered_by_login is
  'D180 (0343): the employee record of the back-office login that entered the second count (may differ from second_counted_by, the PIN owner).';

-- 3. Backfill (before the trigger exists). Only drawers that were reconciled and have no
--    reconciled_count_minor yet, so a re-run changes nothing.
update public.drawer_sessions s
   set reconciled_count_minor = s.closing_count_minor
 where s.status in ('reconciled', 'verified')
   and s.reconciled_count_minor is null
   and s.closing_count_minor is not null;

update public.drawer_sessions s
   set closing_count_minor = c.total_minor
  from (
    select distinct on (session_id) session_id, total_minor
      from public.drawer_counts
     where count_type = 'close'
     order by session_id, counted_at asc, created_at asc
  ) c
 where c.session_id = s.id
   and s.status in ('reconciled', 'verified')
   and s.reconciled_count_minor is not null
   and s.closing_count_minor is distinct from c.total_minor
   and c.total_minor >= 0;

-- 4. The closer's count and the second count are write-once.
create or replace function public.drawer_sessions_counts_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'open'
     and old.closing_count_minor is not null
     and new.closing_count_minor is distinct from old.closing_count_minor then
    raise exception 'CLOSER_COUNT_IMMUTABLE: the closer''s blind count is never changed after close (D180). Correct reconciled_count_minor instead.'
      using errcode = 'check_violation';
  end if;
  if old.second_count_minor is not null
     and (new.second_count_minor is distinct from old.second_count_minor
          or new.second_counted_by is distinct from old.second_counted_by) then
    raise exception 'SECOND_COUNT_IMMUTABLE: a saved second count is never changed (D180).'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists drawer_sessions_counts_immutable on public.drawer_sessions;
create trigger drawer_sessions_counts_immutable
  before update on public.drawer_sessions
  for each row execute function public.drawer_sessions_counts_immutable();

revoke all on function public.drawer_sessions_counts_immutable() from public, anon, authenticated;
