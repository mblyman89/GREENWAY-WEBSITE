-- 0315_over_short_reasons.sql  (Fix Phase 2.3 · G-03 · F-01-11 · F-02-6 · owner D7, D16, D21)
--
-- WHY. Owner D7: "Q6- $5. It should be an admin only screen placed in the
-- most logical place to put it for me to interact with. Just warnings for
-- now. Who, when, how much, their reason for why it's over/ under (should be
-- required to be input for over/ under)." D16: "Q02-3- yes, it applies to the
-- master as well". D21: "Q-03-1- only over $5".
-- Today there is no reason column anywhere (F-01-11), and master till counts
-- have no threshold or reason either (F-02-6).
--
-- WHAT (columns only):
--   drawer_sessions.over_short_reason      the reason written at reconcile.
--                                          Required by the app when the
--                                          over/short is more than $5.00;
--                                          optional at $5.00 or less (D21).
--   drawer_sessions.over_short_reason_by   the employee record of the manager
--                                          who reconciled and wrote it
--   safe_counts.variance_reason            the reason written with a master
--                                          till count, same $5 rule
--   Both reasons are at most 500 characters (the app checks first).
--   NULL on everything recorded before this migration (the warnings screen
--   shows those as "No reason (recorded before Phase 2.3)").
--
-- The $5 rule itself lives in the app (over-short-warning-core.ts), so the
-- owner can change the amount in one place. Warnings only: nothing here
-- blocks a count.
--
-- drawer_sessions and safe_counts are both WIPE in the factory reset, so the
-- reset function needs no change.
--
-- SAFE / IDEMPOTENT: add column if not exists; constraints added only when
-- missing. No existing data changes. Apply MANUALLY in the SQL editor after
-- 0314.

alter table public.drawer_sessions
  add column if not exists over_short_reason text;
alter table public.drawer_sessions
  add column if not exists over_short_reason_by uuid
    references public.employees (id) on delete set null;
alter table public.safe_counts
  add column if not exists variance_reason text;

do $m$
begin
  if not exists (select 1 from pg_constraint where conname = 'drawer_sessions_over_short_reason_len') then
    alter table public.drawer_sessions
      add constraint drawer_sessions_over_short_reason_len
      check (over_short_reason is null or char_length(over_short_reason) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'safe_counts_variance_reason_len') then
    alter table public.safe_counts
      add constraint safe_counts_variance_reason_len
      check (variance_reason is null or char_length(variance_reason) <= 500);
  end if;
end
$m$;

comment on column public.drawer_sessions.over_short_reason is
  'Fix Phase 2.3 (G-03, owner D7/D21): why the drawer was over or short. Required by the app when more than $5.00; optional otherwise. NULL = none written or recorded before 0315.';
comment on column public.drawer_sessions.over_short_reason_by is
  'Fix Phase 2.3 (G-03): the employee record of the manager who reconciled and wrote the reason.';
comment on column public.safe_counts.variance_reason is
  'Fix Phase 2.3 (G-03, owner D16/D21): why the master till count was over or short of the target. Required by the app when more than $5.00; optional otherwise.';
