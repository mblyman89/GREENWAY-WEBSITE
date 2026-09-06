-- ============================================================================
-- 0221_order_name_rotation.sql  (SLICE 23)
--
-- Smart rotation for the fun order-name pool, plus walk-in (register) support.
--
-- WHY
-- ---
-- Migration 0147 shipped an LRU pool keyed on `last_assigned_at` (a wall
-- clock). That was fine for a handful of online orders a day. Slice 23 puts
-- the SAME pool behind the register, where the shop averages ~200
-- transactions a day against ~50 names, and a wall clock stops being good
-- enough for three concrete reasons:
--
--   1. A fresh pool has last_assigned_at = null on every row, so the first
--      pass is not a rotation at all -- it is whatever order sort_order
--      happens to be in.
--   2. Two assignments inside the same clock tick sort EQUAL, and the
--      tie-break is constant, so under load the rotation biases toward the
--      same low-sort_order rows.
--   3. Nothing can promise "this name will not reappear for at least N
--      sales", which is exactly what the owner asked for.
--
-- THE FIX: a monotonic assignment counter. Each assignment takes the next
-- integer and stamps it on the row it used, so "how many sales ago" is exact
-- integer arithmetic with no clock skew and no ties. This is the same reason
-- CPU caches use a counter rather than a timestamp for LRU.
--
-- CONCURRENCY: assignment is done by a single SQL function that both picks
-- and stamps inside ONE statement, under an advisory lock. The previous
-- read-then-write in order-name-pool-store.ts had a genuine race -- two
-- checkouts landing together could read the same LRU head and both take it.
-- At 200 transactions a day that stops being theoretical.
--
-- The application ships fully working BEFORE this migration is applied: the
-- store falls back to the 0147 LRU path (and then to the real receipt number)
-- whenever the column or function is missing, so nothing breaks in between.
--
-- SAFE TO RE-RUN (idempotent). No existing row is renumbered or reassigned.
-- ============================================================================

-- 1) The monotonic stamp on each pool row. ------------------------------------
alter table public.order_name_pool
  add column if not exists last_assigned_seq bigint;

comment on column public.order_name_pool.last_assigned_seq is
  'SLICE 23: value of the global assignment counter when this name was last '
  'handed out. NULL = never used (sorts oldest). Exact integer age beats a '
  'wall clock: no clock skew, no same-tick ties, and it makes "no repeat '
  'within N assignments" a checkable guarantee.';

-- 2) The global, strictly-increasing assignment counter. -----------------------
-- A sequence is the right primitive: nextval() is atomic, never hands the same
-- value to two callers, and is not rolled back by a failed transaction (which
-- is what we want -- a burned number is harmless, a duplicated one is not).
create sequence if not exists public.order_name_assignment_seq as bigint start 1;

comment on sequence public.order_name_assignment_seq is
  'SLICE 23: monotonic counter for fun-name assignments. Shared by online '
  'orders AND walk-in register sales so one rotation covers both channels.';

-- 3) Where a WALK-IN sale records the fun name it was given. -------------------
-- NO NEW COLUMN IS NEEDED, and this section exists to record WHY -- because the
-- obvious guess is wrong and the next person to read this file will make it.
--
-- The obvious guess is that register sales live in their own table (something
-- like `pos_sales`) and therefore need their own display_name column. They do
-- not. There is no such table anywhere in this schema:
--
--     grep -rn "pos_sales" supabase/migrations/*.sql   -> no matches
--     grep -rn "pos_sales" src/ --include=*.ts(x)      -> no matches
--
-- What actually happens is this. A register sale is enqueued on the device as a
-- `pos_sale_events` row carrying its payload, and at sync time
-- src/lib/pos/sync-store.ts MATERIALIZES A REAL ORDER from it -- an ordinary
-- insert into public.orders with status 'ready' and customer_first_name
-- 'Walk-in' (sync-store.ts:769-789). Walk-in sales and website sales converge
-- on the SAME table.
--
-- So orders.display_name -- added by 0147 and already nullable and NON-unique
-- so a name can recycle -- is ALREADY the right home for a walk-in fun name.
-- Adding a second column on a second table would have created two places to
-- store one fact, which is how a reprint ends up disagreeing with the slip the
-- customer is holding.
--
-- The rotation therefore needs no per-channel storage at all: one pool, one
-- sequence, one column, both channels.

-- 4) The hot path index: enabled names, oldest stamp first. --------------------
-- NULLS FIRST matches "never used sorts oldest", so the picker's ORDER BY can
-- be served straight from the index.
create index if not exists order_name_pool_rotation_idx
  on public.order_name_pool (enabled, last_assigned_seq nulls first, sort_order);

-- 5) Atomic pick-and-stamp. ---------------------------------------------------
-- Returns the chosen name plus the gap (how many assignments since it was last
-- used, null when never used) so the caller can surface "your pool is too
-- small" without a second query.
--
-- The advisory lock serialises concurrent assignments. It is transaction-scoped
-- (pg_advisory_xact_lock), so it always releases -- even if the caller crashes.
create or replace function public.assign_order_name()
returns table (name text, gap bigint)
language plpgsql
as $$
declare
  v_seq  bigint;
  v_id   uuid;
  v_name text;
  v_prev bigint;
begin
  -- One assigner at a time. The constant is arbitrary but must be stable; it
  -- is namespaced to this function alone.
  perform pg_advisory_xact_lock(hashtext('order_name_assignment'));

  select p.id, p.name, p.last_assigned_seq
    into v_id, v_name, v_prev
    from public.order_name_pool p
   where p.enabled
   order by p.last_assigned_seq nulls first, p.sort_order, p.id
   limit 1;

  -- Empty or fully-disabled pool: the caller falls back to the real number.
  if v_id is null then
    return;
  end if;

  v_seq := nextval('public.order_name_assignment_seq');

  update public.order_name_pool
     set last_assigned_seq = v_seq,
         last_assigned_at  = now(),           -- kept fresh for the admin display
         assigned_count    = coalesce(assigned_count, 0) + 1
   where id = v_id;

  name := v_name;
  gap  := case when v_prev is null then null else v_seq - v_prev end;
  return next;
end $$;

comment on function public.assign_order_name() is
  'SLICE 23: atomically pick the least-recently-used enabled pool name, stamp '
  'it with the next assignment sequence, and return it with its gap. Replaces '
  'a read-then-write in the app that could hand the same name to two '
  'simultaneous sales.';

-- 6) Let the app read the counter without consuming a value. ------------------
-- last_value is meaningless before the first nextval(), which is what
-- is_called reports; return 0 in that case so "current sequence" is honest.
create or replace function public.current_order_name_seq()
returns bigint
language sql
stable
as $$
  select case when is_called then last_value else 0 end
    from public.order_name_assignment_seq;
$$;

comment on function public.current_order_name_seq() is
  'SLICE 23: the assignment counter WITHOUT consuming a value, so the admin '
  'preview can compute gaps and show the true next-up order.';

-- 7) Backfill: give already-used names a sane relative age. -------------------
-- Rows used before this migration have a timestamp but no sequence. Ordering
-- them by that timestamp and numbering them preserves their true relative
-- recency, so the first post-migration rotation continues where LRU left off
-- instead of treating every historical name as brand new.
do $$
declare
  v_count bigint;
begin
  if exists (
    select 1 from public.order_name_pool
     where last_assigned_at is not null and last_assigned_seq is null
  ) then
    with ordered as (
      select id, row_number() over (order by last_assigned_at) as rn
        from public.order_name_pool
       where last_assigned_at is not null and last_assigned_seq is null
    )
    update public.order_name_pool p
       set last_assigned_seq = o.rn
      from ordered o
     where p.id = o.id;

    select count(*) into v_count
      from public.order_name_pool
     where last_assigned_seq is not null;

    -- Move the counter past every backfilled value so the next real
    -- assignment cannot collide with a backfilled stamp.
    perform setval('public.order_name_assignment_seq', greatest(v_count, 1), true);
  end if;
end $$;
