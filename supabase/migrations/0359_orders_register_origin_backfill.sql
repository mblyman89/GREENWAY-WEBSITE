-- ============================================================================
-- 0359 - LABEL EXISTING REGISTER SALES AS REGISTER SALES  (D226)
--
-- WHY. Every register sale is written into public.orders (it is the sale of
-- record: reprints, returns, CCRS, the books). Until D226 the POS sync never
-- set orders.origin, so each one carried the column default greenway, the
-- value a WEBSITE order has, and the back office listed it as "Website".
-- From D226 on the sync writes origin = register. This file fixes the rows
-- written before that.
--
-- WHAT. One UPDATE of ONE column:
--   origin greenway -> register
--   on rows the POS sync wrote: pos_client_uuid is set (only the sync sets it,
--   migration 0128) OR staff_note starts with the sync note "POS sale " +
--   em dash.
-- Nothing is deleted. No money, status, date, customer or line changes.
-- origin = register is already allowed by the 0226 check constraint, and is
-- already understood everywhere: not announced, not a pickup, not a
-- marketplace, receipt line "REGISTER SALE" (order-origin-core.ts).
-- The customer roll-up trigger does not fire (it watches status, customer,
-- total and dates only). updated_at moves once on each row (set_updated_at),
-- which makes an open Orders board refresh itself once.
--
-- Production check before writing this file (2026-11-10, read only):
--   greenway + pos_client_uuid + POS note : 1,383 rows  <- these change
--   greenway, no uuid, no note             :    11 rows  (website orders, unchanged)
--   leafly                                 :     1 row   (unchanged)
--   register                               :     0 rows
--
-- ROLLBACK: supabase/rollbacks/0359_orders_register_origin_backfill.rollback.sql
-- puts origin back to greenway on the rows this file changed (they are
-- listed in public.orders_origin_backfill_0359 before the update, so the
-- rollback touches exactly those and nothing the sync writes later).
--
-- APPLY BY HAND in the Supabase SQL editor, AFTER 0358. Safe to re-run: a
-- second run finds nothing left to change.
-- ============================================================================

do $precheck$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'origin'
  ) then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0359 sets orders.origin, added by 0226_leafly_outbound_orders.sql.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'pos_client_uuid'
  ) then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0359 reads orders.pos_client_uuid, added by 0128_pos_pending_recovery.sql.';
  end if;
end
$precheck$;

-- The list of rows relabelled, kept so the rollback is exact. Service role
-- only, nothing in the app reads it. No foreign key on purpose: it is an undo
-- list of ids, not part of the sale, so it never blocks or joins a delete of
-- an order (and the factory reset keeps it, where its ids simply match
-- nothing and the rollback changes nothing).
create table if not exists public.orders_origin_backfill_0359 (
  order_id        uuid primary key,
  previous_origin text not null,
  relabelled_at   timestamptz not null default now()
);
alter table public.orders_origin_backfill_0359 enable row level security;
revoke all on table public.orders_origin_backfill_0359 from public, anon, authenticated;
grant select, insert, delete on table public.orders_origin_backfill_0359 to service_role;

comment on table public.orders_origin_backfill_0359 is
  'D226 (0359): the register sales whose origin was relabelled greenway -> register, so the rollback is exact.';

insert into public.orders_origin_backfill_0359 (order_id, previous_origin)
select o.id, o.origin
  from public.orders o
 where o.origin = 'greenway'
   and (o.pos_client_uuid is not null or o.staff_note like 'POS sale ' || chr(8212) || '%')
on conflict (order_id) do nothing;

update public.orders o
   set origin = 'register'
 where o.origin = 'greenway'
   and (o.pos_client_uuid is not null or o.staff_note like 'POS sale ' || chr(8212) || '%');

do $report$
declare
  left_over integer;
  relabelled integer;
begin
  select count(*) into left_over
    from public.orders o
   where o.origin = 'greenway'
     and (o.pos_client_uuid is not null or o.staff_note like 'POS sale ' || chr(8212) || '%');
  if left_over <> 0 then
    raise exception '0359: % register sales still read greenway after the update', left_over;
  end if;
  select count(*) into relabelled from public.orders_origin_backfill_0359;
  raise notice '0359: % register sales are labelled register (listed in orders_origin_backfill_0359).', relabelled;
end
$report$;
