-- ---------------------------------------------------------------------------
-- 0128_pos_pending_recovery.sql  (GW-023 fix — run manually in the SQL editor)
--
-- Closes the "stranded pending sale" hole: a sync invocation that dies
-- mid-processing used to leave its pos_sale_events row at `pending` forever,
-- the register's retry was acked "duplicate" (so the device deleted its only
-- copy), and no sweeper existed. The code half (same PR) now RE-PROCESSES
-- stale pending rows on retry and sweeps stragglers from the daily cron.
-- This migration adds the two columns that make the recovery loop safe:
--
--   1. pos_sale_events.recovery_attempts — counts recovery re-runs so a
--      poison event escalates to the manager exception queue after 3 tries
--      instead of retrying forever.
--
--   2. orders.pos_client_uuid + a UNIQUE index — the ABSOLUTE double-order
--      guarantee. A crash after the order insert but before the ledger row
--      was stamped leaves no breadcrumb the recovery path can trust, so the
--      database itself now refuses a second order for the same register
--      event (the code turns that refusal into a manager exception, never a
--      duplicate sale).
--
-- Idempotent: every statement is IF NOT EXISTS / conditional. Safe to re-run.
-- ---------------------------------------------------------------------------

-- 1. Recovery attempt counter (0 = never needed recovery).
alter table public.pos_sale_events
  add column if not exists recovery_attempts integer not null default 0;

-- 2. Which register event materialized this order (nullable — website orders
--    and back-office orders have no register event).
alter table public.orders
  add column if not exists pos_client_uuid uuid;

-- 2a. Backfill from the breadcrumb every POS sale already leaves in its
--     staff note ("POS sale — <device> — rung by <name>. Event <uuid>.").
--     Only unambiguous matches are written: if the same event uuid somehow
--     appears on TWO orders (the very bug this migration prevents), both are
--     left NULL so the unique index below can still be created — and the
--     review query at the bottom will surface them for a human.
with extracted as (
  select
    o.id,
    ((regexp_match(
      o.staff_note,
      'Event ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'
    ))[1])::uuid as cu
  from public.orders o
  where o.pos_client_uuid is null
    and o.staff_note ~ 'Event [0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
),
unambiguous as (
  select cu from extracted group by cu having count(*) = 1
)
update public.orders o
set pos_client_uuid = e.cu
from extracted e
join unambiguous u on u.cu = e.cu
where o.id = e.id
  -- Re-run safety: never write a uuid some other order already carries.
  and not exists (
    select 1 from public.orders o2 where o2.pos_client_uuid = e.cu
  );

-- 2b. The guarantee itself: one register event ⇒ at most one order, enforced
--     by the database no matter what the application code does.
create unique index if not exists orders_pos_client_uuid_key
  on public.orders (pos_client_uuid)
  where pos_client_uuid is not null;

-- ---------------------------------------------------------------------------
-- OWNER REVIEW QUERIES (read-only — run each once after applying, just look):
--
-- (a) Any register events stranded mid-processing right now? Healthy answer:
--     zero rows. Rows older than ~10 minutes will be picked up by the daily
--     sweeper (or re-processed the next time that register flushes); anything
--     it cannot heal lands in Admin → Registers → exceptions with a written
--     reason — nothing stays invisible anymore.
--
--   select id, client_uuid, event_type, occurred_at, received_at, recovery_attempts
--   from public.pos_sale_events
--   where status = 'pending'
--   order by received_at asc;
--
-- (b) Did any past crash already double-materialize a sale? Healthy answer:
--     zero rows. If a row appears, both orders share one register event —
--     review them in Admin → Orders and cancel the duplicate by hand.
--
--   select ((regexp_match(staff_note,
--            'Event ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'))[1]) as event_uuid,
--          count(*) as orders_for_event,
--          array_agg(order_number order by created_at) as order_numbers
--   from public.orders
--   where staff_note ~ 'Event [0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
--   group by 1 having count(*) > 1;
-- ---------------------------------------------------------------------------
