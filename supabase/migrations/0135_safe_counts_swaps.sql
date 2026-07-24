-- =============================================================================
-- 0135_safe_counts_swaps.sql  (Feature slice 31 - master till / safe)
--
-- Owner: "Master till: $1000 in safe; back office manager count 2x/day
-- (AM+PM); POS 'swap' button for change; tracked + audited - reported."
--
-- Two tables:
--   * safe_counts - a manager's OPEN count of the store safe (the $1,000
--     master change fund). Twice daily (am / pm). Unlike drawer closes,
--     safe counts are NOT blind: the safe target is known policy, so the
--     manager sees the live variance while counting. Each row snapshots
--     the expected amount at count time (expected_minor) so history stays
--     truthful if the target ever changes.
--   * safe_swaps - value-neutral CHANGE SWAPS between a register drawer
--     and the safe: the cashier puts big bills IN and takes the exact
--     same value OUT in small bills/coins. Net cash movement is ZERO on
--     both sides, so drawer expected-close math and the safe total are
--     both untouched - but every swap is recorded, PIN-attributed, and
--     manager-approved, because an UNRECORDED trip into the safe is
--     exactly what this feature exists to prevent.
--
-- Money in MINOR UNITS (cents), integers. Idempotent; safe to re-run in
-- the Supabase SQL editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- safe_counts: twice-daily manager counts of the safe
-- ---------------------------------------------------------------------------
create table if not exists public.safe_counts (
  id            uuid primary key default gen_random_uuid(),
  business_day  date not null,
  -- am | pm | other (the owner's two daily counts, plus ad-hoc recounts)
  count_window  text not null default 'am'
                  check (count_window in ('am', 'pm', 'other')),
  counted_by    uuid references public.employees(id) on delete set null,

  -- Denomination quantities (same shape as drawer_counts incl. 0077 extras).
  pennies       integer not null default 0,
  nickels       integer not null default 0,
  dimes         integer not null default 0,
  quarters      integer not null default 0,
  half_dollars  integer not null default 0,
  dollar_coins  integer not null default 0,
  ones          integer not null default 0,
  twos          integer not null default 0,
  fives         integer not null default 0,
  tens          integer not null default 0,
  twenties      integer not null default 0,
  fifties       integer not null default 0,
  hundreds      integer not null default 0,

  -- Counted total, cents (app computes from the denominations).
  total_minor     integer not null default 0,
  -- What the safe SHOULD hold at count time, cents (the $1,000 target,
  -- snapshotted per count so old rows stay truthful if policy changes).
  expected_minor  integer not null default 100000,
  -- variance = total - expected (positive = over), cents.
  variance_minor  integer not null default 0,

  notes         text,
  counted_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists safe_counts_day_idx on public.safe_counts (business_day desc);
create index if not exists safe_counts_window_idx on public.safe_counts (business_day, count_window);

-- ---------------------------------------------------------------------------
-- safe_swaps: value-neutral change swaps between a drawer and the safe
-- ---------------------------------------------------------------------------
create table if not exists public.safe_swaps (
  id            uuid primary key default gen_random_uuid(),
  -- The drawer session that swapped (register-side swaps; null if the
  -- session was deleted later - the swap record itself must survive).
  session_id    uuid references public.drawer_sessions(id) on delete set null,
  -- Which iPad performed it (register-side swaps).
  device_id     uuid references public.pos_devices(id) on delete set null,
  -- Value swapped, cents (> 0). Big bills IN = the same value OUT in
  -- change, so the net movement is zero on both drawer and safe.
  amount_minor  integer not null check (amount_minor > 0),
  -- The cashier who swapped (their PIN) and the manager/lead who
  -- approved (their PIN, verified server-side, role-gated).
  performed_by  uuid references public.employees(id) on delete set null,
  approved_by   uuid references public.employees(id) on delete set null,
  notes         text,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists safe_swaps_occurred_idx on public.safe_swaps (occurred_at desc);
create index if not exists safe_swaps_session_idx on public.safe_swaps (session_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security: the HARDENED posture from 0130/0133 - deny by
-- default; managers (public.is_manager(), created in 0130) may READ; no
-- write policy is granted to humans at all, because every write goes
-- through the app's server code (service role, which bypasses RLS).
-- ---------------------------------------------------------------------------
alter table public.safe_counts enable row level security;
alter table public.safe_swaps  enable row level security;

drop policy if exists safe_counts_mgr_read on public.safe_counts;
create policy safe_counts_mgr_read on public.safe_counts
  for select using (public.is_manager());

drop policy if exists safe_swaps_mgr_read on public.safe_swaps;
create policy safe_swaps_mgr_read on public.safe_swaps
  for select using (public.is_manager());

comment on table public.safe_counts is
  'Twice-daily manager counts of the store safe (the $1,000 master change fund). Open counts - the target is known policy, variance shown live.';
comment on table public.safe_swaps is
  'Value-neutral change swaps between a register drawer and the safe. Zero net cash movement; recorded and manager-approved so no unrecorded safe trips exist.';
