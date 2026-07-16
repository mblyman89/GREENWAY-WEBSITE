-- 0123_pin_throttle.sql  (Task AN-8)
--
-- Durable PIN brute-force throttle. The S-10 throttle (5 failures / 60 s
-- window -> 60 s lock) lived in server memory, per lambda instance: it reset
-- on every cold start and was not shared across concurrently-warm instances,
-- so an online attacker who spread attempts across instances (or simply
-- waited out cold starts) faced far less than the intended lockout. This
-- table makes the window durable and shared.
--
-- One row per SCOPE (the physical entry point for PIN attempts):
--   'pos-device:<uuid>'  -- each register device's PIN pad (unlock, approve,
--                           till, void, returns, day-report)
--   'timeclock'          -- the shared staffing clock pad (web station + phone)
-- A failed PIN identifies NO employee (that's the point of the attack), so
-- keying by attempted-employee is impossible; keying by entry point preserves
-- the existing shared-pad model while surviving cold starts.
--
-- failure_times is a jsonb array of epoch-ms timestamps (bounded: the app
-- prunes entries older than the 60 s window on every write, so it never
-- grows past MAX_FAILURES). locked_until is set when the window fills.
--
-- Written ONLY via the service-role client (the API routes / server actions
-- own all writes); staff may read for debugging.

create table if not exists public.pin_throttle (
  scope         text primary key,
  failure_times jsonb not null default '[]'::jsonb,
  locked_until  timestamptz,
  updated_at    timestamptz not null default now()
);

alter table public.pin_throttle enable row level security;

drop policy if exists "pin_throttle staff read" on public.pin_throttle;
create policy "pin_throttle staff read" on public.pin_throttle
  for select using (public.is_staff());

-- No insert/update/delete policies: writes go through the service role only.
