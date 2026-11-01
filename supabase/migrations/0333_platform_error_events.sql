-- 0333_platform_error_events.sql  (slice G-71d · owner message 12 · platform early warning, item 4)
--
-- WHY. The owner, verbatim (message 12):
--   "Let's build 1-4 first. I see real value in all of them."
-- Item 4 was error alerting: "A spike of 'permission denied' or server errors
-- sends you a text or email right away, instead of waiting for a cashier to
-- report it." In R-RET the database refused the server on every customer
-- return and the code handled it quietly; nobody knew until the counter did.
--
-- WHAT. One append-only log, platform_error_events, one row per:
--   * server_error  - an unhandled error Next.js reports to
--                     src/instrumentation.ts onRequestError;
--   * db_permission - PostgREST answered 42501 to the SERVER role;
--   * db_missing    - PostgREST answered 42883 / PGRST202 / 42P01 / PGRST205.
-- The app counts the last 10 minutes after each row and emails staff once per
-- kind per hour (claims in compliance_reminder_log); the daily platform-health
-- email adds a 24-hour digest. Messages are scrubbed by the app before insert
-- (no tokens, emails or long numbers); the route keeps no query string.
--
-- Deliberate (standing rule 15):
--   * RLS on, no policy: no browser role can read or write it.
--   * revoke all from public, anon, authenticated.
--   * service_role: SELECT and INSERT only. 0330's default privileges would
--     also hand it UPDATE / DELETE; they are taken back, so history cannot be
--     rewritten. No sequence (uuid key), so no sequence grant is needed.
--   * check constraints on kind / source and the text lengths, so a bug in
--     the app cannot store a page of stack trace.
-- Factory reset: KEEP (an operations record, like platform_health_runs).
--
-- Safe to re-run (if not exists; idempotent grants).
-- Rollback: supabase/rollbacks/0333_platform_error_events.rollback.sql.
-- PG check: scripts/recon/platform-errors-0333-pg-check.sql.

do $precheck$
begin
  if to_regclass('public.platform_health_runs') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0333 depends on 0331_platform_health.sql';
  end if;
  if to_regclass('public.compliance_reminder_log') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0333 alerts are claimed in compliance_reminder_log (0118)';
  end if;
end
$precheck$;

create table if not exists public.platform_error_events (
  id           uuid primary key default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),
  kind         text not null check (kind in ('server_error', 'db_permission', 'db_missing')),
  source       text not null check (source in ('request', 'db')),
  code         text null check (code is null or char_length(code) <= 20),
  route        text not null check (char_length(route) between 1 and 200),
  method       text null check (method is null or char_length(method) <= 10),
  message      text not null default '' check (char_length(message) <= 300),
  digest       text null check (digest is null or char_length(digest) <= 100),
  fingerprint  text not null check (char_length(fingerprint) between 1 and 300)
);

create index if not exists idx_platform_error_events_kind_time
  on public.platform_error_events (kind, occurred_at desc);
create index if not exists idx_platform_error_events_time
  on public.platform_error_events (occurred_at desc);

alter table public.platform_error_events enable row level security;

revoke all on table public.platform_error_events from public, anon, authenticated;
revoke update, delete, truncate, references, trigger on table public.platform_error_events from service_role;
grant select, insert on table public.platform_error_events to service_role;

comment on table public.platform_error_events is
  'G-71d error alerting: one row per server error or database refusal of the server role. Append-only; server role only; messages scrubbed by the app.';

notify pgrst, 'reload schema';
