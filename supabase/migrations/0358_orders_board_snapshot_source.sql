-- ============================================================================
-- 0358 - ORDERS BOARD SNAPSHOT, ONLINE ORDERS ONLY  (D226)
--
-- WHY. Owner (D226): "In the back office online orders page, it shows
-- thousands of orders in history. Are all orders getting added to this table
-- or is there a bug?" Production on 2026-11-10: 1,376 of the 1,388 orders
-- rows since Nov 1 were register walk-in sales. Every register sale is
-- written into public.orders on purpose (it is the sale of record), but the
-- POS sync never set origin, so each one carried the default greenway and
-- the board, its counts and the new-order feed treated it as a website order.
--
-- WHAT. orders_board_snapshot() gains ONE optional argument, p_source:
--   null        every row (exactly the 0233 behaviour)
--   online    rows that are NOT register sales
--   register  register sales only
-- A register sale is: origin = register OR pos_client_uuid is not null.
-- That is the same rule the app applies (src/lib/orders/order-source-core.ts),
-- so the cards above the list always match the rows in it. The source applies
-- to the counts AND to the arrivals list that drives the new-order chime.
--
-- The function is dropped (both the 0233 two-argument form and this one) and
-- re-created, so a later re-run of 0233 is the only way to get two overloads
-- back, and the old two-argument calls still resolve to this one (p_source
-- defaults to null).
--
-- Read-only. No data changes. Service role only, same as 0233.
-- Until it is applied the app calls the 0233 function with no p_source,
-- gets "function not found", and falls back to its own readers with the same
-- filter, so the board is right before and after.
--
-- APPLY BY HAND in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

do $precheck$
begin
  if to_regclass('public.orders') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0358 reads public.orders, created by 0007_slice7_orders.sql.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'pos_client_uuid'
  ) then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0358 reads orders.pos_client_uuid, added by 0128_pos_pending_recovery.sql.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'origin'
  ) then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0358 reads orders.origin, added by 0226_leafly_outbound_orders.sql.';
  end if;
  if to_regclass('public.leafly_orders') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0358 reads public.leafly_orders, created by 0225_leafly_order_webhooks.sql.';
  end if;
end
$precheck$;

drop function if exists public.orders_board_snapshot(integer, text[]);
drop function if exists public.orders_board_snapshot(integer, text[], text);

create or replace function public.orders_board_snapshot(
  p_arrivals_limit  integer default 20,
  p_exclude_origins text[]  default null,
  p_source          text    default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with lim as (
    select greatest(0, least(100, coalesce(p_arrivals_limit, 20))) as n
  ),
  src as (
    select case when p_source in ('online', 'register') then p_source else null end as s
  ),
  in_scope as (
    select o.id, o.status, o.placed_at, o.order_number, o.display_name
      from public.orders o, src
     where (p_exclude_origins is null
            or cardinality(p_exclude_origins) = 0
            or o.origin <> all (p_exclude_origins))
       and (src.s is null
            or (src.s = 'online'   and not (o.origin = 'register' or o.pos_client_uuid is not null))
            or (src.s = 'register' and     (o.origin = 'register' or o.pos_client_uuid is not null)))
  ),
  by_status as (
    select status, count(*)::integer as c
      from in_scope
     group by status
  ),
  counts as (
    select jsonb_object_agg(e.enumlabel, coalesce(b.c, 0) order by e.enumsortorder) as j
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      left join by_status b on b.status::text = e.enumlabel
     where t.typname = 'order_status'
       and t.typnamespace = 'public'::regnamespace
  ),
  arrivals as (
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'id',           a.id,
               'placed_at',    a.placed_at,
               'order_number', a.order_number,
               'display_name', a.display_name
             ) order by a.placed_at desc
           ), '[]'::jsonb) as j
      from (
        select o.id, o.placed_at, o.order_number, o.display_name
          from public.orders o, src
         where src.s is null
            or (src.s = 'online'   and not (o.origin = 'register' or o.pos_client_uuid is not null))
            or (src.s = 'register' and     (o.origin = 'register' or o.pos_client_uuid is not null))
         order by o.placed_at desc
         limit (select n from lim)
      ) a
  )
  select jsonb_build_object(
    'counts',            coalesce((select j from counts), '{}'::jsonb),
    'arrivals',          (select j from arrivals),
    'orders_updated_at', (select max(updated_at) from public.orders),
    'leafly_updated_at', (select max(updated_at) from public.leafly_orders)
  );
$$;

comment on function public.orders_board_snapshot(integer, text[], text) is
  'USAGE-3 + D226: one round-trip for the Orders dashboard poll. p_source null = every row, '
  'online = not a register sale, register = register sales only (origin register or pos_client_uuid set). '
  'Read-only; service_role only.';

revoke all on function public.orders_board_snapshot(integer, text[], text) from public, anon, authenticated;
grant execute on function public.orders_board_snapshot(integer, text[], text) to service_role;

notify pgrst, 'reload schema';
