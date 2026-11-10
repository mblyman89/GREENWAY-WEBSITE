-- Rollback for 0358_orders_board_snapshot_source.sql (D226).
-- Run MANUALLY only if needed.
--
-- Puts back the 0233 two-argument orders_board_snapshot(). The app keeps
-- working: when it asks for p_source and the function has no such argument,
-- it gets "function not found" and falls back to its own readers, which
-- apply the same online/register filter. Read-only, no data changes.
drop function if exists public.orders_board_snapshot(integer, text[], text);

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
