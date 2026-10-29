-- 0317_little_safe_exchanges.sql  (Fix Phase 2.7b · G-02 · F-00-7 · F-01-8 · F-02-8 · owner D3, D14)
--
-- WHY. The owner, verbatim:
--   request  "Either morning or night employee can balance the master till
--             using small bills from the little safe in exchange for big
--             bills from the master."
--   D3       "I just want to know when big bills leave the master till and
--             go into the little safe. And what the small bills and coin are
--             that came out of the little safe."
--   D14      "Q02-1- yes you have that correct"  (register change swaps go
--             till <-> master till; the master till then rebuilds its mix
--             from the little safe)
-- Before this file the little safe was not modelled at all (F-00-7) and a
-- register change swap recorded a value only, with no bills (F-01-8).
--
-- WHAT.
--   1. public.cash_denoms_total_minor(jsonb)
--        The value in cents of a denomination object ({"twenties": 5, ...},
--        the same 13 keys as drawer_counts). NULL when the object is not a
--        plain object of known keys with whole counts 0..99999, so a CHECK
--        built on it refuses anything it cannot read.
--   2. public.little_safe_exchanges   (new, D3)
--        One row per master till <-> little safe exchange: who (the employee
--        whose PIN was entered), when, the business day, out_denoms (the big
--        bills OUT of the master till into the little safe), in_denoms (the
--        small bills and coin IN from the little safe to the master till),
--        value_minor (one side), and notes. The database refuses a row whose
--        two sides are not both exactly value_minor. There is NO little-safe
--        balance or target (D3), so nothing here adds up a balance.
--        APPEND-ONLY: a trigger refuses UPDATE and DELETE. A wrong exchange
--        is corrected by recording the reverse exchange with a note.
--   3. safe_swaps.in_denoms, safe_swaps.out_denoms   (F-01-8)
--        The register change swap seen from the master till: in_denoms are
--        the big bills IN from the till, out_denoms the change OUT to the
--        till. Both NULL on swaps recorded before 0317; when present, both
--        must equal amount_minor.
--
-- FACTORY RESET. little_safe_exchanges is KEEP (factory-reset-core.ts): an
-- append-only cash-handling record like pos_cart_adjustments, and the
-- pinned 139-table WIPE list in 0240 is not reopened. It references only
-- employees (KEEP), so no kept row points at a wiped one. safe_swaps stays
-- WIPE; its new columns change nothing about the reset.
--
-- SAFE / IDEMPOTENT: create ... if not exists, add column if not exists,
-- constraints and policies dropped and re-made by name, create or replace
-- for the functions. No existing row changes (the new columns start NULL).
-- Row level security: managers read (public.is_manager()); there is no write
-- policy for people, so every write goes through the server, which checks
-- the PIN and records an audit row. Apply MANUALLY in the Supabase SQL
-- editor after 0316. Before it is applied the little-safe form says the
-- migration is pending and saves nothing, and a register swap saves its
-- value with the bills kept in the Security Log only.

do $precheck$
begin
  if to_regclass('public.safe_swaps') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0317 depends on safe_swaps from 0135_safe_counts_swaps.sql';
  end if;
  if to_regclass('public.employees') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0317 depends on employees';
  end if;
  if to_regprocedure('public.is_manager()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0317 depends on is_manager()';
  end if;
end
$precheck$;

-- 1. The value of a denomination object, or NULL when it cannot be read.
create or replace function public.cash_denoms_total_minor(d jsonb)
returns bigint
language plpgsql
immutable
set search_path = public
as $$
declare
  k     text;
  v     jsonb;
  n     numeric;
  cents integer;
  total bigint := 0;
begin
  if d is null or jsonb_typeof(d) <> 'object' then
    return null;
  end if;
  for k, v in select e.key, e.value from jsonb_each(d) as e loop
    cents := case k
      when 'pennies'      then 1
      when 'nickels'      then 5
      when 'dimes'        then 10
      when 'quarters'     then 25
      when 'half_dollars' then 50
      when 'dollar_coins' then 100
      when 'ones'         then 100
      when 'twos'         then 200
      when 'fives'        then 500
      when 'tens'         then 1000
      when 'twenties'     then 2000
      when 'fifties'      then 5000
      when 'hundreds'     then 10000
      else null
    end;
    if cents is null or jsonb_typeof(v) <> 'number' then
      return null;
    end if;
    n := (v #>> '{}')::numeric;
    if n < 0 or n > 99999 or n <> trunc(n) then
      return null;
    end if;
    total := total + n::bigint * cents;
  end loop;
  return total;
end $$;

comment on function public.cash_denoms_total_minor(jsonb) is
  '0317 (G-02): cents in a denomination object of the 13 drawer_counts keys. NULL when it is not an object of known keys with whole counts 0..99999, so CHECKs built on it refuse what they cannot read.';

-- 2. The master till <-> little safe exchange log (D3).
create table if not exists public.little_safe_exchanges (
  id            uuid primary key default gen_random_uuid(),
  business_day  date not null,
  -- Big bills OUT of the master till into the little safe.
  out_denoms    jsonb not null,
  -- Small bills and coin IN from the little safe to the master till.
  in_denoms     jsonb not null,
  -- The value of ONE side, cents. Both sides must equal it.
  value_minor   integer not null,
  -- The employee whose PIN was entered (any employee, owner request).
  recorded_by   uuid references public.employees(id) on delete set null,
  notes         text,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

alter table public.little_safe_exchanges
  drop constraint if exists little_safe_exchanges_value_check;
alter table public.little_safe_exchanges
  add constraint little_safe_exchanges_value_check
  check (value_minor > 0 and value_minor <= 200000);

alter table public.little_safe_exchanges
  drop constraint if exists little_safe_exchanges_sides_equal;
alter table public.little_safe_exchanges
  add constraint little_safe_exchanges_sides_equal
  check (
    coalesce(public.cash_denoms_total_minor(out_denoms), -1) = value_minor
    and coalesce(public.cash_denoms_total_minor(in_denoms), -1) = value_minor
  );

alter table public.little_safe_exchanges
  drop constraint if exists little_safe_exchanges_notes_len;
alter table public.little_safe_exchanges
  add constraint little_safe_exchanges_notes_len
  check (notes is null or length(notes) <= 500);

create index if not exists little_safe_exchanges_day_idx
  on public.little_safe_exchanges (business_day desc, occurred_at desc);
create index if not exists little_safe_exchanges_occurred_idx
  on public.little_safe_exchanges (occurred_at desc);

create or replace function public.little_safe_exchanges_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'LITTLE_SAFE_EXCHANGE_APPEND_ONLY: little safe exchange % cannot be changed or deleted. Record the reverse exchange with a note instead (SOP-02 4.10).', old.id;
end $$;

drop trigger if exists trg_little_safe_exchanges_append_only on public.little_safe_exchanges;
create trigger trg_little_safe_exchanges_append_only
  before update or delete on public.little_safe_exchanges
  for each row execute function public.little_safe_exchanges_append_only();

alter table public.little_safe_exchanges enable row level security;

drop policy if exists little_safe_exchanges_mgr_read on public.little_safe_exchanges;
create policy little_safe_exchanges_mgr_read on public.little_safe_exchanges
  for select using (public.is_manager());

comment on table public.little_safe_exchanges is
  '0317 (G-02, owner D3): master till <-> little safe exchanges. Big bills out of the master till (out_denoms) for the same value of small bills and coin from the little safe (in_denoms); the database refuses unequal sides. No little-safe balance or target (D3). Append-only; KEEP in the factory reset.';

-- 3. The register change swap's bills, both ways (F-01-8).
alter table public.safe_swaps add column if not exists in_denoms jsonb;
alter table public.safe_swaps add column if not exists out_denoms jsonb;

alter table public.safe_swaps
  drop constraint if exists safe_swaps_denoms_equal;
alter table public.safe_swaps
  add constraint safe_swaps_denoms_equal
  check (
    (in_denoms is null and out_denoms is null)
    or (
      coalesce(public.cash_denoms_total_minor(in_denoms), -1) = amount_minor
      and coalesce(public.cash_denoms_total_minor(out_denoms), -1) = amount_minor
    )
  );

comment on column public.safe_swaps.in_denoms is
  '0317 (F-01-8): big bills IN from the register till to the master till. NULL on swaps before 0317.';
comment on column public.safe_swaps.out_denoms is
  '0317 (F-01-8): change OUT of the master till to the register till. NULL on swaps before 0317.';
