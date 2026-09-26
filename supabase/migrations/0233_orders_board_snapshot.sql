-- ============================================================================
-- 0233 — ORDERS BOARD SNAPSHOT (USAGE-3)
--
-- WHY THIS EXISTS
-- ---------------
-- The Orders dashboard keeps itself fresh by polling /api/admin/orders/count
-- every 15 seconds while the tab is visible (pinned by
-- tests/compliance/new-order-watch.test.ts — the owner wants the chime within
-- 15 s of an order landing). Before this migration each of those polls cost
-- TEN PostgREST round-trips:
--
--     7 × select count(*) from orders where status = <one status>
--     1 × the 20 newest arrivals (id, placed_at, order_number, display_name)
--     1 × newest orders.updated_at
--     1 × newest leafly_orders.updated_at
--
-- That is 2,400 requests an hour per open Orders tab, every one of them a
-- Supabase egress body and a Vercel function await. The information is
-- small — a handful of integers, twenty short rows and two timestamps — so
-- the cost was all in the trip count, not the data.
--
-- WHAT THIS DOES
-- --------------
-- Adds ONE read-only function, orders_board_snapshot(), that computes all
-- four answers inside the database and returns them as a single small jsonb
-- document. The counts come from one `group by status` over the existing
-- orders_status_idx instead of seven separate exact counts. The optional
-- p_exclude_origins lets the board page (which shows Leafly orders in their
-- own panel — SLICE L-38) get counts that agree with its table, so the page
-- render also drops from seven count queries to one.
--
-- Result shape (all keys always present; nulls where there is nothing):
--   {
--     "counts":            {"new":0,"acknowledged":0,"preparing":0,"ready":0,
--                           "completed":0,"cancelled":0,"no_show":0},
--     "arrivals":          [{"id":"…","placed_at":"…","order_number":"…",
--                            "display_name":"…"|null}, …]   newest first
--     "orders_updated_at": "…"|null,
--     "leafly_updated_at": "…"|null
--   }
--
-- Every status in the order_status enum is present in counts even when zero,
-- so the client never has to know the enum. Arrivals are capped at 100 the
-- same way getRecentOrderArrivals() caps its argument.
--
-- UNTIL IT IS APPLIED
-- -------------------
-- The code calls the function first and, on PostgREST's "function not found"
-- (PGRST202 / 42883 — see src/lib/db/rpc-fallback-core.ts), falls back to the
-- exact ten-query path it used before. Nothing breaks; the saving simply
-- waits for this file to be run. That fallback is asserted in
-- tests/compliance/orders-board-snapshot.test.ts.
--
-- APPLIED BY HAND (AGENTS rule 6). Safe to re-run: the function is dropped and
-- re-created so a later change of shape cannot be blocked by
-- "cannot change return type".
-- ============================================================================

-- ── 0. Refuse politely if an earlier migration is missing ────────────────────
do $precheck$
begin
  if to_regclass('public.orders') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0233 reads public.orders, created by 0007_slice7_orders.sql. Run the earlier migrations first.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'display_name'
  ) then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0233 reads orders.display_name, added by 0147_order_name_pool.sql. Run 0147 first.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'origin'
  ) then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0233 filters on orders.origin, added by 0226_leafly_outbound_orders.sql. Run 0226 first.';
  end if;
  if to_regclass('public.leafly_orders') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0233 reads public.leafly_orders, created by 0225_leafly_order_webhooks.sql. Run 0225 first.';
  end if;
end
$precheck$;

-- ── 1. The function ──────────────────────────────────────────────────────────
drop function if exists public.orders_board_snapshot(integer, text[]);

create or replace function public.orders_board_snapshot(
  p_arrivals_limit  integer default 20,
  p_exclude_origins text[]  default null
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
  scoped as (
    select o.status
      from public.orders o
     where p_exclude_origins is null
        or cardinality(p_exclude_origins) = 0
        or o.origin <> all (p_exclude_origins)
  ),
  by_status as (
    select status, count(*)::integer as c
      from scoped
     group by status
  ),
  counts as (
    -- Every enum label present, zero when absent, so the client never has to
    -- know the enum.
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
          from public.orders o
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

comment on function public.orders_board_snapshot(integer, text[]) is
  'USAGE-3: one round-trip for the Orders dashboard poll — per-status counts, '
  'newest arrivals and the latest orders/leafly_orders change, as jsonb. '
  'Replaces ten PostgREST requests per 15 s poll. Read-only; service_role only.';

-- ── 2. Lock it to the server (the admin client uses service_role) ───────────
revoke all on function public.orders_board_snapshot(integer, text[]) from public, anon, authenticated;
grant execute on function public.orders_board_snapshot(integer, text[]) to service_role;

-- ── 3. Let PostgREST see it without waiting for its cache to expire ─────────
notify pgrst, 'reload schema';
