-- =============================================================================
-- 0227_leafly_scheduled_sync.sql  (Slice L-7)
--
-- AUTOMATIC menu syncing to Leafly, alongside the manual push button that
-- already exists. The owner asked for BOTH, and both is the correct answer:
--
--   - The SCHEDULE is what Leafly certifies. Their checklist criterion 3 grades
--     "Sync cadence: (recommended) daily full POST + PUT/DELETE for intraday
--     changes, or full POST several times per hour", and criterion 4
--     disqualifies request signatures that look hand-driven. Slice L-4 measured
--     that vercel.json declared exactly three crons -- compliance reminders,
--     regulatory watch, ATM sync -- and none touched Leafly, so until this
--     migration the only thing that ever pushed the menu was a person clicking.
--     That fails both criteria.
--
--   - The BUTTON is what a human needs. You change a price at 2pm and you want
--     Leafly to know now, not at the next scheduled tick.
--
-- The hard part is not either one. It is making them coexist without ever
-- sending two menu writes at once, which is what this migration exists for.
--
-- WHAT THIS MIGRATION ADDS
--   1. public.leafly_sync_runs   -- append-only log of every sync attempt, from
--                                   BOTH the schedule and the button, including
--                                   the ones the pure core refused to make.
--   2. A single-row advisory lock pattern via `started_at`/`finished_at`, so a
--      run in flight is visible to the next cron tick.
--
-- WHAT IT DELIBERATELY DOES NOT ADD
--   No new settings table. The schedule settings live in the EXISTING
--   public.syndication_sync_settings (migration 0119), which is already a
--   per-channel jsonb blob resolved and clamped in code
--   (src/lib/syndication/sync-settings-core.ts, now joined by
--   src/lib/leafly/schedule-core.ts). Adding a second settings home for the
--   same channel is how two sources of truth get created, and house rule 11
--   exists to stop exactly that.
--
-- Reuses: public.syndication_channel enum (0049), public.is_staff(),
--         public.is_owner(), public.set_updated_at(), public.staff_profiles.
-- Idempotent: create-if-not-exists + drop-if-exists guards throughout.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The sync run log (append-only)
-- -----------------------------------------------------------------------------
-- WHY A RUN LOG WHEN syndication_logs (0049) ALREADY EXISTS.
--
-- syndication_logs records what a PUSH did -- the HTTP exchange, per channel.
-- It cannot answer the questions this slice creates, all of which are about the
-- SCHEDULER rather than the push:
--
--   - Did the 4am cron fire at all, or did Vercel never call us?
--   - Did it fire and decide NOT to push? (Overwhelmingly the common case: most
--     ticks are correctly no-ops.)
--   - Was a human mid-push at the time, so the schedule stood aside?
--   - How many consecutive failures have there been, i.e. should we be backing
--     off right now?
--
-- A log that only records requests that reached the network is silent about
-- every one of those, and "the cron is running but deciding not to push" is
-- indistinguishable from "the cron is not running" without it. That distinction
-- is the difference between a five-minute fix and a day of guessing.
--
-- Same posture as leafly_outbound_attempts in 0226: refusals are ROWS, not
-- absences.
create table if not exists public.leafly_sync_runs (
  id                  uuid primary key default gen_random_uuid(),

  -- Which channel. Reuses the existing enum rather than a free-text column, so
  -- a typo cannot create a phantom channel. Defaulted to 'leafly' because that
  -- is what this slice builds, but the column exists so the Weedmaps scheduler
  -- (if it is ever built) does not need a second table.
  channel             public.syndication_channel not null default 'leafly',

  -- WHO asked for this run. The whole point of the slice is that there are two
  -- answers and they must be distinguishable forever after.
  --   'schedule' -- a cron tick
  --   'manual'   -- a person pressed the button
  -- A CHECK rather than an enum: this vocabulary is owned by our own code
  -- (schedule-core.ts), not by a third party, so it will not grow on someone
  -- else's release schedule.
  trigger_source      text not null
                        check (trigger_source in ('schedule', 'manual')),

  -- The decision code from src/lib/leafly/schedule-core.ts. Stored as text and
  -- CHECKed against the exact closed vocabulary that module can emit, so the
  -- database and the pure core cannot drift apart silently. If a new code is
  -- added to ALL_SCHEDULED_RUN_CODES without being added here, the insert fails
  -- loudly -- which is the correct outcome, because an unrecognised code in the
  -- log is a code nobody can interpret later.
  --
  -- 'manual_requested' is the one value that is NOT a schedule-core code: it is
  -- what a button press records, since the button does not consult the
  -- scheduler's due-ness logic at all (a human pressing "push now" has already
  -- decided).
  decision_code       text not null
                        check (decision_code in (
                          'daily_full', 'intraday_delta',
                          'disabled', 'not_due', 'quiet_hours',
                          'not_configured', 'manual_in_flight', 'run_in_flight',
                          'cooldown', 'backoff',
                          'manual_requested'
                        )),

  -- Did this run actually send anything to Leafly? False for every refusal.
  -- Not derivable from decision_code alone, because a run that DECIDED to push
  -- can still fail before the request leaves (preflight block, missing token).
  pushed              boolean not null default false,

  -- POST / PUT / DELETE, or NULL when nothing was sent. Matches the method
  -- vocabulary already used by pushLeaflyMenu().
  method              text
                        check (method is null or method in ('POST', 'PUT', 'DELETE')),

  -- The outcome. NULL while a run is in flight -- which is exactly how the
  -- in-flight lock is detected, see section 2.
  --   'success'   -- Leafly accepted it
  --   'skipped'   -- nothing changed since the last successful sync, so the
  --                  push layer correctly sent nothing (this is a GOOD outcome
  --                  and must not be counted as a failure for backoff)
  --   'refused'   -- the pure core declined to run; no network call
  --   'failed'    -- a call was made and did not succeed
  disposition         text
                        check (disposition is null or disposition in
                          ('success', 'skipped', 'refused', 'failed')),

  -- HTTP status when a call was made. NULL for refusals -- deliberately
  -- nullable for the same reason as 0226's response_status: a refusal is a row,
  -- and forcing a fake 0 into it would make "we never called" look like "we
  -- called and got nothing".
  http_status         integer,

  -- How many items were in the payload, and the delta summary
  -- ("3 new, 5 changed, 120 unchanged, 2 removed") straight from
  -- LeaflyPushResult.planSummary. Both nullable: a refusal has neither.
  item_count          integer,
  plan_summary        text,

  -- The human-readable reason, as produced by schedule-core.ts. Stored rather
  -- than re-derived, because the wording that was shown at the time is the
  -- wording that should appear in the history -- re-deriving it later against
  -- changed settings would rewrite history.
  reason              text,

  -- Error detail when disposition = 'failed'. Free text: it is whatever Leafly
  -- or the network said, and truncating it into a vocabulary would destroy the
  -- one thing that makes a failure diagnosable.
  error_detail        text,

  -- Consecutive failure count AT THE TIME of this run, so the backoff decision
  -- is reconstructable from the log alone without replaying every prior row.
  consecutive_failures integer not null default 0,

  -- Timing. started_at is NOT NULL because a row is written when a run begins;
  -- finished_at stays NULL until it ends, and that NULL is the lock.
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,

  -- Who pressed the button. NULL for scheduled runs (nobody pressed anything)
  -- and ON DELETE SET NULL so that removing a staff member never deletes the
  -- history of what the integration did -- same reasoning as 0226's created_by.
  created_by          uuid references public.staff_profiles(id) on delete set null,

  created_at          timestamptz not null default now()
);

-- A manual run must have a person; a scheduled run must not. Enforced in the
-- database rather than only in code, because this is the one field that makes
-- the log admissible as evidence of who did what.
--
-- Written as a table CHECK rather than two column CHECKs because it is a
-- relationship between two columns.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leafly_sync_runs_trigger_actor_coherent'
  ) then
    alter table public.leafly_sync_runs
      add constraint leafly_sync_runs_trigger_actor_coherent
      check (
        (trigger_source = 'manual')
        or (trigger_source = 'schedule' and created_by is null)
      );
  end if;
end$$;

-- A run that pushed must say how; a run that did not must not claim a method.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leafly_sync_runs_pushed_has_method'
  ) then
    alter table public.leafly_sync_runs
      add constraint leafly_sync_runs_pushed_has_method
      check (
        (pushed = false and method is null)
        or (pushed = true and method is not null)
      );
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- 2. Indexes
-- -----------------------------------------------------------------------------
-- The operational query: "what did the sync do lately", newest first.
create index if not exists leafly_sync_runs_recent_idx
  on public.leafly_sync_runs (channel, started_at desc);

-- THE LOCK QUERY. "Is a run of this channel currently in flight?" is asked by
-- every single cron tick, and it is the query that must be fast and must not
-- scan history. A PARTIAL index on the unfinished rows only, so its size is
-- bounded by the number of in-flight runs (normally zero or one) rather than by
-- the size of the log.
--
-- The predicate is `finished_at is null` -- the same condition the code tests --
-- so the planner can actually use it.
create index if not exists leafly_sync_runs_in_flight_idx
  on public.leafly_sync_runs (channel, trigger_source, started_at desc)
  where finished_at is null;

-- The backoff query: "how many times in a row has this failed?" needs the
-- recent failures, not the successes.
create index if not exists leafly_sync_runs_failures_idx
  on public.leafly_sync_runs (channel, started_at desc)
  where disposition = 'failed';

-- -----------------------------------------------------------------------------
-- 3. RLS
-- -----------------------------------------------------------------------------
-- Same posture as 0225 and 0226: RLS ON with NO policies and NO grants, so the
-- table is reachable only through the service role used by server code. This
-- log contains no customer PII, but it does contain the shape of our commercial
-- relationship with Leafly (how often we sync, what fails), and there is no
-- reason for a browser session to ever read it directly.
alter table public.leafly_sync_runs enable row level security;

-- Deliberately no `create policy` here. A policy would be the thing that makes
-- this table browser-reachable; its absence is the security posture, not an
-- oversight. 0225 and 0226 do the same, and the migration proof asserts
-- 0 policies and 0 grants so that adding one silently is impossible.

-- -----------------------------------------------------------------------------
-- 4. Factory reset (0209) -- classification is in the TypeScript core
-- -----------------------------------------------------------------------------
-- The DELETE for this table is added to public.factory_reset_all_data() in
-- 0209_factory_reset.sql, and the matching WIPE rule is added to
-- src/lib/accounting/factory-reset-core.ts in the same commit.
--
-- Both halves, in the same commit, deliberately: slice L-6 shipped the SQL
-- DELETE without the TypeScript rule, and the repo's own staleness guard
-- refused to build a reset plan at all until it was fixed. That guard caught a
-- real defect, and the lesson is written here so the next person adding a table
-- does both halves at once rather than rediscovering it.
-- =============================================================================
