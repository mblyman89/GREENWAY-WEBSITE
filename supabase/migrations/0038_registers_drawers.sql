-- =============================================================================
-- 0038_registers_drawers.sql  (Run 6 / Slice 26)
--
-- REGISTERS + CASH DRAWER MANAGEMENT  (Features K / M / N).
--
-- Owner (Q4): "I have three registers. Two sales registers, 4 drawer drops, two
-- in the afternoon two at night. Employees count their own drawers in, count
-- their closing draw. Blind count. Draw drops, the whole works. We also have a
-- manager till that is shared by the two manager shifts per day. Same rules
-- apply ... morning manager counts it in, night manager counts it out, next
-- morning manager verifies and validates amounts."
--
-- Tables:
--   * registers          -- physical registers. kind = sales | manager_till.
--                           Greenway has 2 sales + 1 shared manager till.
--   * drawer_sessions     -- one open->close cycle of a register, tied to the
--                           employee (and their Slice-25 shift). Holds the
--                           opening float, the count-in total, the count-out
--                           total, the EXPECTED cash (float + cash sales - drops),
--                           and the computed over/short. BLIND: the closing
--                           counter records their count WITHOUT seeing expected;
--                           variance is revealed only on reconcile.
--   * drawer_counts       -- a denomination breakdown for an open/close/verify
--                           count (so blind counts are auditable to the penny).
--   * drawer_drops        -- mid-shift cash drops to the safe (the "4 drops/day",
--                           two afternoon + two night). Reduces expected drawer.
--   * till_verifications  -- the manager-till morning-after verify/validate step.
--
-- Money in MINOR UNITS (cents), integers, to avoid float drift.
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- registers
-- ---------------------------------------------------------------------------
create table if not exists public.registers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  -- sales       -> a customer-facing sales register (employee owns it per shift)
  -- manager_till-> the shared manager drawer (AM in / PM out / next-AM verify)
  kind          text not null default 'sales'
                  check (kind in ('sales', 'manager_till')),
  -- Standard starting float for this register, in cents (e.g. 20000 = $200).
  default_float_minor integer not null default 0,
  active        boolean not null default true,
  sort_order    integer not null default 0,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists registers_kind_idx on public.registers (kind);

-- ---------------------------------------------------------------------------
-- drawer_sessions
-- ---------------------------------------------------------------------------
create table if not exists public.drawer_sessions (
  id              uuid primary key default gen_random_uuid(),
  register_id     uuid not null references public.registers(id) on delete restrict,
  -- Who owns this session (the counting employee). For the manager till the
  -- opening employee is the AM manager; the closing employee is the PM manager.
  opened_by       uuid references public.employees(id) on delete set null,
  closed_by       uuid references public.employees(id) on delete set null,
  shift_id        uuid references public.shifts(id) on delete set null,
  business_day    date not null,

  -- open | closed | reconciled | verified (manager till final state)
  status          text not null default 'open'
                    check (status in ('open', 'closed', 'reconciled', 'verified')),

  -- Opening float the drawer started with (count-IN total), cents.
  opening_count_minor   integer,
  -- Closing count the employee recorded (count-OUT, BLIND), cents.
  closing_count_minor   integer,
  -- Cash the register SHOULD hold at close = opening + cash sales - drops, cents.
  -- Computed/entered at reconcile time so the closing count stays blind.
  expected_close_minor  integer,
  -- Over/short = closing_count - expected_close (positive = over), cents.
  over_short_minor      integer,

  opened_at       timestamptz,
  closed_at       timestamptz,
  reconciled_at   timestamptz,
  reconciled_by   uuid references public.employees(id) on delete set null,

  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists drawer_sessions_register_idx on public.drawer_sessions (register_id);
create index if not exists drawer_sessions_day_idx on public.drawer_sessions (business_day);
create index if not exists drawer_sessions_status_idx on public.drawer_sessions (status);
-- At most one OPEN session per register at a time (enforced in app; index helps).
create index if not exists drawer_sessions_open_idx
  on public.drawer_sessions (register_id) where status = 'open';

-- ---------------------------------------------------------------------------
-- drawer_counts: denomination breakdown for a count event
-- ---------------------------------------------------------------------------
create table if not exists public.drawer_counts (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.drawer_sessions(id) on delete cascade,
  -- open | close | verify -- which count event this breakdown is for.
  count_type    text not null default 'close'
                  check (count_type in ('open', 'close', 'verify')),
  counted_by    uuid references public.employees(id) on delete set null,
  -- Denomination quantities. Bills + coins. Cents value derived in app/below.
  pennies       integer not null default 0,
  nickels       integer not null default 0,
  dimes         integer not null default 0,
  quarters      integer not null default 0,
  ones          integer not null default 0,
  fives         integer not null default 0,
  tens          integer not null default 0,
  twenties      integer not null default 0,
  fifties       integer not null default 0,
  hundreds      integer not null default 0,
  -- Convenience computed total in cents (app fills; also a generated column).
  total_minor   integer not null default 0,
  counted_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists drawer_counts_session_idx on public.drawer_counts (session_id);

-- ---------------------------------------------------------------------------
-- drawer_drops: mid-shift cash drops to the safe
-- ---------------------------------------------------------------------------
create table if not exists public.drawer_drops (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.drawer_sessions(id) on delete cascade,
  amount_minor  integer not null,             -- cents removed from the drawer
  -- afternoon | night (two each per the owner's 4-drops/day model) | other
  drop_window   text not null default 'other'
                  check (drop_window in ('afternoon', 'night', 'other')),
  dropped_by    uuid references public.employees(id) on delete set null,
  witnessed_by  uuid references public.employees(id) on delete set null,
  notes         text,
  dropped_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists drawer_drops_session_idx on public.drawer_drops (session_id);

-- ---------------------------------------------------------------------------
-- till_verifications: manager-till next-morning verify/validate
-- ---------------------------------------------------------------------------
create table if not exists public.till_verifications (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.drawer_sessions(id) on delete cascade,
  verified_by     uuid references public.employees(id) on delete set null,
  -- The verifying (next-morning) manager's independent recount total, cents.
  verified_count_minor integer not null,
  -- Whether the verifier agrees with the prior night's close.
  agrees          boolean not null default true,
  variance_minor  integer not null default 0,  -- verified - prior close
  notes           text,
  verified_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists till_verifications_session_idx on public.till_verifications (session_id);

-- updated_at triggers.
drop trigger if exists registers_set_updated_at on public.registers;
create trigger registers_set_updated_at before update on public.registers
  for each row execute function public.set_updated_at();

drop trigger if exists drawer_sessions_set_updated_at on public.drawer_sessions;
create trigger drawer_sessions_set_updated_at before update on public.drawer_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed the three registers (idempotent: only if none exist yet).
-- ---------------------------------------------------------------------------
insert into public.registers (name, kind, default_float_minor, sort_order)
select * from (values
  ('Sales Register 1', 'sales',        20000, 10),
  ('Sales Register 2', 'sales',        20000, 20),
  ('Manager Till',     'manager_till', 30000, 30)
) as seed(name, kind, default_float_minor, sort_order)
where not exists (select 1 from public.registers);

-- ---------------------------------------------------------------------------
-- Row-Level Security: staff read; staff write (app gates by permission); no
-- public access (internal financial data).
-- ---------------------------------------------------------------------------
alter table public.registers          enable row level security;
alter table public.drawer_sessions    enable row level security;
alter table public.drawer_counts      enable row level security;
alter table public.drawer_drops       enable row level security;
alter table public.till_verifications enable row level security;

do $$
declare t text;
begin
  foreach t in array array['registers','drawer_sessions','drawer_counts','drawer_drops','till_verifications']
  loop
    execute format('drop policy if exists %1$s_staff_read on public.%1$s;', t);
    execute format('create policy %1$s_staff_read on public.%1$s for select using (public.is_staff());', t);
    execute format('drop policy if exists %1$s_staff_write on public.%1$s;', t);
    execute format('create policy %1$s_staff_write on public.%1$s for all using (public.is_staff()) with check (public.is_staff());', t);
  end loop;
end $$;
