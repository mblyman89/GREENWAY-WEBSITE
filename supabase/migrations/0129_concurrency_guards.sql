-- ---------------------------------------------------------------------------
-- 0129_concurrency_guards.sql  (GW-011 + GW-012 fix — run manually in the SQL editor)
--
-- Two structural concurrency holes, one migration:
--
--   GW-011: two requests completing the SAME order at the same instant could
--   both run the completion side effects (inventory decrement, loyalty earn,
--   void restock). Each side effect's "have I already run?" latch was a
--   SELECT followed much later by an INSERT with NO unique constraint — so
--   under a race, stock could be decremented twice and points earned twice
--   for one order. The code half (same PR) makes the status flip a true
--   compare-and-swap and inserts each latch marker FIRST; this migration
--   gives the database the final word: partial UNIQUE indexes that make the
--   second marker insert fail (23505), which the code treats as "already
--   done".
--
--   GW-012: every quantity change (menu_variants.inventory_level,
--   inventory_lots.on_hand_qty) was computed in JavaScript from a previously
--   SELECTed value and written back blind — two concurrent sales of the same
--   product could both read 10, write 9 and 8, and silently lose a unit.
--   This migration adds two tiny ATOMIC delta functions (the database does
--   `qty = qty + delta` itself, under its own row lock) plus a
--   `on_hand_qty >= 0` check constraint so the column can never go negative.
--
-- Idempotent: every statement is IF NOT EXISTS / conditional / re-runnable.
-- ---------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. GW-011 — side-effect latches become database-enforced
-- ═══════════════════════════════════════════════════════════════════════════

-- 1a. Dedup any pre-existing double markers (keep the OLDEST of each pair —
--     it carries the original human-readable summary). Normally deletes 0.
with ranked as (
  select id,
         row_number() over (
           partition by order_id, event_type
           order by created_at asc, id asc
         ) as rn
  from public.order_events
  where event_type in ('inventory_decremented', 'sale_void_restocked')
)
delete from public.order_events e
using ranked r
where e.id = r.id and r.rn > 1;

-- 1b. One inventory-decrement marker and one void-restock marker per order,
--     enforced by the database itself.
create unique index if not exists order_events_side_effect_once_uniq
  on public.order_events (order_id, event_type)
  where event_type in ('inventory_decremented', 'sale_void_restocked');

-- 1c. Dedup any pre-existing double EARN rows (keep the oldest). Normally 0.
with ranked as (
  select id,
         row_number() over (
           partition by order_id
           order by created_at asc, id asc
         ) as rn
  from public.loyalty_ledger
  where kind = 'earn' and order_id is not null
)
delete from public.loyalty_ledger l
using ranked r
where l.id = r.id and r.rn > 1;

-- 1d. Points can be EARNED at most once per order.
create unique index if not exists loyalty_ledger_earn_once_uniq
  on public.loyalty_ledger (order_id)
  where kind = 'earn' and order_id is not null;

-- 1e. Self-heal the cached loyalty balances from the ledger (the source of
--     truth) in case step 1c removed a double-paid earn row. Re-run safe:
--     recomputing from the ledger is idempotent. Tier = highest active tier
--     whose threshold the LIFETIME points meet (mirrors the app's
--     tierForPoints exactly).
update public.loyalty_accounts a
set balance_points  = coalesce(s.bal, 0),
    lifetime_points = coalesce(s.life, 0),
    tier_id = (
      select t.id
      from public.loyalty_tiers t
      where t.is_active and t.min_points <= coalesce(s.life, 0)
      order by t.min_points desc
      limit 1
    )
from (
  select account_id,
         sum(points)               as bal,
         sum(greatest(points, 0))  as life
  from public.loyalty_ledger
  group by account_id
) s
where s.account_id = a.id;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. GW-012 — atomic quantity deltas + a floor of zero
-- ═══════════════════════════════════════════════════════════════════════════

-- 2a. Repair any negative on-hand quantities before the constraint lands
--     (normally 0 rows).
update public.inventory_lots set on_hand_qty = 0 where on_hand_qty < 0;

-- 2b. The column can never go negative again.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_lots_on_hand_nonneg'
  ) then
    alter table public.inventory_lots
      add constraint inventory_lots_on_hand_nonneg check (on_hand_qty >= 0);
  end if;
end $$;

-- 2c. Atomic lot delta. The UPDATE computes qty + delta INSIDE the database
--     under the row lock, so two concurrent callers can never lose an update.
--       p_clamp = true  → floor at 0 (sale decrement / restock / count
--                          variance; the caller's plan already reported any
--                          oversell in plain English).
--       p_clamp = false → STRICT: refuse (return null) when the delta would
--                          go below 0 (dispositions/destruction must never
--                          remove more than exists).
--       p_auto_status   → flip active→sold_out at 0 and sold_out→active
--                          above 0 (the sale/void vocabulary). Dispositions
--                          pass false and manage status themselves.
--     Returns the NEW on_hand_qty, or null when the lot is missing or a
--     strict call had insufficient stock.
create or replace function public.apply_lot_delta(
  p_lot_id      uuid,
  p_delta       numeric,
  p_clamp       boolean default true,
  p_actor       uuid    default null,
  p_auto_status boolean default true
) returns numeric
language plpgsql
as $$
declare
  v_new numeric;
begin
  if p_clamp then
    update public.inventory_lots
       set on_hand_qty = greatest(on_hand_qty + p_delta, 0),
           updated_by  = coalesce(p_actor, updated_by),
           status = case
             when not p_auto_status then status
             when greatest(on_hand_qty + p_delta, 0) <= 0 and status = 'active'   then 'sold_out'
             when greatest(on_hand_qty + p_delta, 0) > 0  and status = 'sold_out' then 'active'
             else status
           end
     where id = p_lot_id
     returning on_hand_qty into v_new;
  else
    update public.inventory_lots
       set on_hand_qty = on_hand_qty + p_delta,
           updated_by  = coalesce(p_actor, updated_by),
           status = case
             when not p_auto_status then status
             when on_hand_qty + p_delta <= 0 and status = 'active'   then 'sold_out'
             when on_hand_qty + p_delta > 0  and status = 'sold_out' then 'active'
             else status
           end
     where id = p_lot_id
       and on_hand_qty + p_delta >= 0
     returning on_hand_qty into v_new;
  end if;
  return v_new;
end;
$$;

-- 2d. Atomic menu-variant delta (published-menu stock counter). Floors at 0
--     — the sale plan already reports oversell in plain English. Returns the
--     new level, or null when the variant is missing.
create or replace function public.apply_variant_delta(
  p_variant_id uuid,
  p_delta      integer
) returns integer
language plpgsql
as $$
declare
  v_new integer;
begin
  update public.menu_variants
     set inventory_level = greatest(inventory_level + p_delta, 0)
   where id = p_variant_id
   returning inventory_level into v_new;
  return v_new;
end;
$$;

-- 2e. These are service-role tools (the app's server code), not public API.
--     Security-invoker + RLS already guards the underlying tables, but there
--     is no reason for browser roles to see them at all.
revoke execute on function public.apply_lot_delta(uuid, numeric, boolean, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.apply_variant_delta(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- OWNER REVIEW QUERIES (read-only — run each once after applying, just look):
--
-- A. Confirm the two unique guards exist (expect BOTH names listed):
--
--   select indexname from pg_indexes
--   where indexname in ('order_events_side_effect_once_uniq',
--                       'loyalty_ledger_earn_once_uniq');
--
-- B. Confirm no order ever earned points twice (expect ZERO rows — if a row
--    appears something re-broke; tell the developer):
--
--   select order_id, count(*) from public.loyalty_ledger
--   where kind = 'earn' and order_id is not null
--   group by order_id having count(*) > 1;
--
-- C. Confirm no lot is negative (expect ZERO rows):
--
--   select id, product_name, on_hand_qty from public.inventory_lots
--   where on_hand_qty < 0;
-- ---------------------------------------------------------------------------
