-- 0232_customer_rollups.sql  (Slice 3: enterprise customer tracking)
--
-- WHY THIS EXISTS
-- ---------------
-- 0022 created customers.visit_count / lifetime_spend_minor_units /
-- last_visit_at and said they would be "maintained by the sell flow in a later
-- slice". Nothing ever maintained them, so every customer showed 0 visits and
-- $0 spend even after real sales were linked to them (orders.customer_id).
-- The Cultivera import (src/lib/customers/import.ts) was the only writer of
-- lifetime_spend_minor_units, and what it wrote was the OLD POS's lifetime
-- total, not ours.
--
-- WHAT THIS DOES
-- --------------
-- 1. Adds customers.imported_spend_minor_units and copies the Cultivera figure
--    into it (once) so that history is kept, separately and clearly labelled.
-- 2. Adds customer_rollup_recompute(customer_id), the ONE definition of the
--    three live numbers:
--      visit_count                = number of COMPLETED orders linked to the
--                                   customer (a voided sale is cancelled, an
--                                   online order picked up at the register is
--                                   cancelled in favour of the register sale,
--                                   so neither is double counted)
--      lifetime_spend_minor_units = sum(total_minor_units) of those orders
--                                   minus refunds recorded in customer_returns
--                                   against them (never below 0)
--      last_visit_at              = latest coalesce(completed_at, placed_at)
--                                   of those orders
--      first_visit_at (new)       = earliest of the same (for tenure, the
--                                   shop's typical visit rhythm and segments)
--    This matches src/lib/reports/revenue-basis.ts (status = 'completed').
-- 3. Triggers on orders (insert / delete / update of status, customer_id,
--    total_minor_units, completed_at, placed_at) and on customer_returns keep
--    the numbers live. A change of customer_id recomputes BOTH customers.
-- 4. Backfills every customer.
-- 5. customer_rollup_audit() returns any customer whose stored numbers differ
--    from a fresh computation (should always return zero rows).
--
-- Idempotent: safe to run more than once.

-- 1. Imported (old POS) spend, kept apart from live spend ---------------------
-- The copy happens ONLY in the run that creates the column. At that moment
-- lifetime_spend_minor_units still holds exactly what the Cultivera import
-- wrote (nothing else ever wrote it). Any later re-run finds the column
-- already present and skips the copy, so a live figure can never be copied
-- over the preserved one.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'customers'
       and column_name = 'imported_spend_minor_units'
  ) then
    alter table public.customers
      add column imported_spend_minor_units integer not null default 0;
    update public.customers
       set imported_spend_minor_units = lifetime_spend_minor_units
     where import_source = 'cultivera-export'
       and lifetime_spend_minor_units > 0;
  end if;
end;
$$;

comment on column public.customers.imported_spend_minor_units is
  '0232: lifetime spend reported by the previous POS (Cultivera export). '
  'Historical only. Live spend is lifetime_spend_minor_units, maintained by '
  'customer_rollup_recompute() from completed orders.';

alter table public.customers
  add column if not exists first_visit_at timestamptz;

comment on column public.customers.first_visit_at is
  '0232: earliest completed order linked to the customer. Maintained by '
  'customer_rollup_recompute(); never written by the app.';

-- 2. The single definition ----------------------------------------------------
-- A re-run must be able to change the result shape, so drop first (create or
-- replace cannot change a function's return columns).
drop function if exists public.customer_rollup_audit();
drop function if exists public.customer_rollup_compute(uuid);
create or replace function public.customer_rollup_compute(p_customer_id uuid)
returns table (visit_count integer, lifetime_spend_minor_units integer, last_visit_at timestamptz, first_visit_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with done as (
    select o.id, o.total_minor_units, coalesce(o.completed_at, o.placed_at) as at
      from public.orders o
     where o.customer_id = p_customer_id
       and o.status = 'completed'
  ),
  refunds as (
    select coalesce(sum(r.refund_minor_units), 0)::bigint as minor
      from public.customer_returns r
     where r.order_id in (select id from done)
  )
  select
    (select count(*) from done)::integer,
    greatest(0, (select coalesce(sum(total_minor_units), 0) from done) - (select minor from refunds))::integer,
    (select max(at) from done),
    (select min(at) from done);
$$;

create or replace function public.customer_rollup_recompute(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  if p_customer_id is null then
    return;
  end if;
  select * into v from public.customer_rollup_compute(p_customer_id);
  update public.customers c
     set visit_count = v.visit_count,
         lifetime_spend_minor_units = v.lifetime_spend_minor_units,
         last_visit_at = v.last_visit_at,
         first_visit_at = v.first_visit_at
   where c.id = p_customer_id
     and (c.visit_count is distinct from v.visit_count
       or c.lifetime_spend_minor_units is distinct from v.lifetime_spend_minor_units
       or c.last_visit_at is distinct from v.last_visit_at
       or c.first_visit_at is distinct from v.first_visit_at);
end;
$$;

comment on function public.customer_rollup_recompute(uuid) is
  '0232: recompute visit_count / lifetime_spend_minor_units / last_visit_at '
  '(and first_visit_at) for one customer from completed orders minus customer_returns refunds. '
  'Writes only when a value actually changes.';

-- 3. Triggers -----------------------------------------------------------------
create or replace function public.customer_rollup_orders_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.customer_rollup_recompute(new.customer_id);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.customer_rollup_recompute(old.customer_id);
    return old;
  else
    perform public.customer_rollup_recompute(new.customer_id);
    if old.customer_id is distinct from new.customer_id then
      perform public.customer_rollup_recompute(old.customer_id);
    end if;
    return new;
  end if;
end;
$$;

drop trigger if exists orders_customer_rollup on public.orders;
drop trigger if exists orders_customer_rollup_ins_del on public.orders;
drop trigger if exists orders_customer_rollup_upd on public.orders;

create trigger orders_customer_rollup_ins_del
  after insert or delete on public.orders
  for each row execute function public.customer_rollup_orders_trg();

create trigger orders_customer_rollup_upd
  after update of status, customer_id, total_minor_units, completed_at, placed_at on public.orders
  for each row
  when (old.status is distinct from new.status
     or old.customer_id is distinct from new.customer_id
     or old.total_minor_units is distinct from new.total_minor_units
     or old.completed_at is distinct from new.completed_at
     or old.placed_at is distinct from new.placed_at)
  execute function public.customer_rollup_orders_trg();

create or replace function public.customer_rollup_returns_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new uuid;
  v_old uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') and new.order_id is not null then
    select o.customer_id into v_new from public.orders o where o.id = new.order_id;
    perform public.customer_rollup_recompute(v_new);
  end if;
  if tg_op in ('DELETE', 'UPDATE') and old.order_id is not null then
    select o.customer_id into v_old from public.orders o where o.id = old.order_id;
    if v_old is distinct from v_new then
      perform public.customer_rollup_recompute(v_old);
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists customer_returns_customer_rollup on public.customer_returns;
create trigger customer_returns_customer_rollup
  after insert or delete or update of order_id, refund_minor_units on public.customer_returns
  for each row execute function public.customer_rollup_returns_trg();

-- 4. Backfill -----------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select id from public.customers loop
    perform public.customer_rollup_recompute(r.id);
  end loop;
end;
$$;

-- 5. Audit --------------------------------------------------------------------
create or replace function public.customer_rollup_audit()
returns table (
  customer_id uuid,
  stored_visits integer,
  expected_visits integer,
  stored_spend_minor integer,
  expected_spend_minor integer,
  stored_last_visit_at timestamptz,
  expected_last_visit_at timestamptz,
  stored_first_visit_at timestamptz,
  expected_first_visit_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.visit_count, x.visit_count, c.lifetime_spend_minor_units,
         x.lifetime_spend_minor_units, c.last_visit_at, x.last_visit_at,
         c.first_visit_at, x.first_visit_at
    from public.customers c
    cross join lateral public.customer_rollup_compute(c.id) x
   where c.visit_count is distinct from x.visit_count
      or c.lifetime_spend_minor_units is distinct from x.lifetime_spend_minor_units
      or c.last_visit_at is distinct from x.last_visit_at
      or c.first_visit_at is distinct from x.first_visit_at;
$$;

comment on function public.customer_rollup_audit() is
  '0232: customers whose stored rollups differ from a fresh computation. '
  'Expected: zero rows. Fix any drift with customer_rollup_recompute(id).';

-- Only the server (service_role) may call these.
revoke all on function public.customer_rollup_compute(uuid) from public, anon, authenticated;
revoke all on function public.customer_rollup_recompute(uuid) from public, anon, authenticated;
revoke all on function public.customer_rollup_audit() from public, anon, authenticated;
revoke all on function public.customer_rollup_orders_trg() from public, anon, authenticated;
revoke all on function public.customer_rollup_returns_trg() from public, anon, authenticated;
grant execute on function public.customer_rollup_compute(uuid) to service_role;
grant execute on function public.customer_rollup_recompute(uuid) to service_role;
grant execute on function public.customer_rollup_audit() to service_role;

create index if not exists customer_returns_order_idx on public.customer_returns (order_id);
create index if not exists orders_customer_status_idx on public.orders (customer_id, status);
create index if not exists customers_visit_count_idx on public.customers (visit_count) where visit_count > 0;

-- Let PostgREST see the new columns immediately.
notify pgrst, 'reload schema';
