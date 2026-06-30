-- 0039_loyalty_engine.sql
-- Slice 27 — Loyalty engine (Feature G).
--
-- Model (per owner):
--   * Points accrue PRETAX at 1pt / $1 by default (no tax counts toward points).
--   * Customers submit email + phone for loyalty + daily discounts.
--   * Tiers grant discounts (e.g. 150 pts = 10%, 300 pts = 25%).
--   * Points are redeemable via a CODE texted/emailed, usable online or in store.
--   * Signup / happy-hour / promo bonuses; custom plans supported.
--
-- All money in MINOR UNITS (cents). Rates in basis points where applicable.
-- Idempotent: safe to re-run. Owner applies manually in the SQL editor.

-- ---------------------------------------------------------------------------
-- Program configuration (single active row, but versioned for history)
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_config (
  id                    uuid primary key default gen_random_uuid(),
  is_active             boolean not null default true,
  -- earn rate: points per dollar (pretax). 1.00 = 1pt/$1.
  points_per_dollar     numeric(8,4) not null default 1.0,
  -- value of one point when redeemed, in minor units (cents). 1 = $0.01/pt.
  point_value_minor     integer not null default 1,
  -- minimum points before a customer may redeem.
  min_redeem_points     integer not null default 100,
  -- signup bonus points granted when a loyalty account is created.
  signup_bonus_points   integer not null default 0,
  -- redemption codes expire after this many days (null = never).
  code_expiry_days      integer,
  notes                 text,
  created_by            uuid references public.staff_profiles(id) on delete set null,
  updated_by            uuid references public.staff_profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Seed one active config row only if none exists.
insert into public.loyalty_config (points_per_dollar, point_value_minor, min_redeem_points, signup_bonus_points, notes)
select 1.0, 1, 100, 0, 'Default program: 1pt/$1 pretax, $0.01/pt, redeem at 100+ pts.'
where not exists (select 1 from public.loyalty_config);

-- ---------------------------------------------------------------------------
-- Tiers (spend/points thresholds that unlock a standing discount)
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_tiers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  -- points required to reach this tier (lifetime earned or current balance,
  -- evaluated by app logic; stored as the threshold).
  min_points        integer not null,
  -- standing discount in basis points (1000 = 10%, 2500 = 25%).
  discount_bps      integer not null default 0,
  sort_order        integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Seed the two tiers the owner described (idempotent on name).
insert into public.loyalty_tiers (name, min_points, discount_bps, sort_order)
select 'Bronze', 150, 1000, 1
where not exists (select 1 from public.loyalty_tiers where name = 'Bronze');

insert into public.loyalty_tiers (name, min_points, discount_bps, sort_order)
select 'Gold', 300, 2500, 2
where not exists (select 1 from public.loyalty_tiers where name = 'Gold');

-- ---------------------------------------------------------------------------
-- Promotions (signup / happy-hour / promo bonuses & custom plans)
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'loyalty_promo_kind') then
    create type public.loyalty_promo_kind as enum ('signup', 'happy_hour', 'promo', 'custom');
  end if;
end $$;

create table if not exists public.loyalty_promotions (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  kind              public.loyalty_promo_kind not null default 'promo',
  -- bonus multiplier on base earn (200 = 2x points) OR flat bonus points.
  multiplier_bps    integer not null default 10000,   -- 10000 = 1.0x (no change)
  flat_bonus_points integer not null default 0,
  -- optional active window
  starts_at         timestamptz,
  ends_at           timestamptz,
  -- optional daily happy-hour window in Pacific time (0-23).
  hour_start        integer,
  hour_end          integer,
  is_active         boolean not null default true,
  notes             text,
  created_by        uuid references public.staff_profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Accounts (one per customer who opts in)
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_accounts (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid not null unique references public.customers(id) on delete cascade,
  -- denormalized current balance (kept in sync by app logic; ledger is source of truth)
  balance_points      integer not null default 0,
  lifetime_points     integer not null default 0,
  tier_id             uuid references public.loyalty_tiers(id) on delete set null,
  enrolled_at         timestamptz not null default now(),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists loyalty_accounts_customer_idx on public.loyalty_accounts (customer_id);

-- ---------------------------------------------------------------------------
-- Ledger (immutable record of every points change — source of truth)
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'loyalty_ledger_kind') then
    create type public.loyalty_ledger_kind as enum ('earn', 'redeem', 'adjust', 'signup_bonus', 'promo_bonus', 'expire');
  end if;
end $$;

create table if not exists public.loyalty_ledger (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.loyalty_accounts(id) on delete cascade,
  kind              public.loyalty_ledger_kind not null,
  -- signed points: positive for earn/bonus, negative for redeem/expire.
  points            integer not null,
  -- the order this is tied to (earn) if any.
  order_id          uuid references public.orders(id) on delete set null,
  -- pretax basis (minor units) used to compute earn, for auditing.
  basis_minor       integer,
  promotion_id      uuid references public.loyalty_promotions(id) on delete set null,
  redemption_id     uuid,
  note              text,
  created_by        uuid references public.staff_profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists loyalty_ledger_account_idx on public.loyalty_ledger (account_id, created_at desc);
create index if not exists loyalty_ledger_order_idx on public.loyalty_ledger (order_id);

-- ---------------------------------------------------------------------------
-- Redemption codes (texted/emailed; usable online or in store)
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'loyalty_redemption_status') then
    create type public.loyalty_redemption_status as enum ('issued', 'redeemed', 'expired', 'cancelled');
  end if;
end $$;

create table if not exists public.loyalty_redemptions (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.loyalty_accounts(id) on delete cascade,
  code              text not null unique,
  points            integer not null,          -- points reserved by this code
  value_minor       integer not null,          -- cash value at issue time (minor units)
  status            public.loyalty_redemption_status not null default 'issued',
  channel           text,                       -- 'sms' | 'email' | 'both'
  expires_at        timestamptz,
  redeemed_at       timestamptz,
  redeemed_order_id uuid references public.orders(id) on delete set null,
  issued_by         uuid references public.staff_profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists loyalty_redemptions_account_idx on public.loyalty_redemptions (account_id);
create index if not exists loyalty_redemptions_status_idx on public.loyalty_redemptions (status);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'loyalty_config','loyalty_tiers','loyalty_promotions','loyalty_accounts','loyalty_redemptions'
  ] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I;', t, t);
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at();',
      t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'loyalty_config','loyalty_tiers','loyalty_promotions','loyalty_accounts','loyalty_ledger','loyalty_redemptions'
  ] loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists %I_staff_read on public.%I;', t, t);
    execute format(
      'create policy %I_staff_read on public.%I for select using (public.is_staff());', t, t
    );

    execute format('drop policy if exists %I_staff_write on public.%I;', t, t);
    execute format(
      'create policy %I_staff_write on public.%I for all using (public.is_staff()) with check (public.is_staff());',
      t, t
    );
  end loop;
end $$;
