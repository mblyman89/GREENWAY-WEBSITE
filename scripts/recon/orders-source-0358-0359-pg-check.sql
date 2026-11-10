-- D226 post-apply scenario check for 0358_orders_board_snapshot_source and
-- 0359_orders_register_origin_backfill.
-- Run by scripts/compliance/verify-migrations-execute.ts after every
-- migration has been applied. One transaction, rolled back.
--
-- The scenario:
--   * a website order, a Leafly copy, a register sale already labelled
--     'register', and two OLD register sales still labelled 'greenway' (one
--     found by pos_client_uuid, one by the "POS sale <em dash>" note);
--   * snapshot(p_source => 'online') counts / lists only the website order
--     (and the Leafly copy, which callers exclude with p_exclude_origins);
--   * before 0359, snapshot('register') finds register sales by origin OR
--     pos_client_uuid (rows 3 and 4); row 5 (note only, no uuid: a shape
--     production does not have, 0 rows on 2026-11-10) is found once 0359
--     relabels it by its note;
--   * online + register = every row, per status;
--   * the old two-argument calls still resolve;
--   * 0359 relabels exactly the old register sales, lists them, leaves the
--     website order and the Leafly copy alone, and is safe to re-run;
--   * the 0359 rollback puts 'greenway' back on exactly those rows;
--   * service role only on the function and the list table.
\set ON_ERROR_STOP on
begin;

insert into public.orders (id, order_number, status, origin, placed_at, customer_first_name,
                           subtotal_minor_units, estimated_tax_minor_units, savings_minor_units,
                           total_minor_units, item_count, staff_note, pos_client_uuid)
values
  ('00000000-0000-4000-8000-000000035801', 'D226-1', 'new',       'greenway', now() + interval '5 seconds', 'Web',
   100, 0, 0, 100, 1, null, null),
  ('00000000-0000-4000-8000-000000035802', 'D226-2', 'new',       'leafly',   now() + interval '4 seconds', 'Leafly',
   100, 0, 0, 100, 1, null, null),
  ('00000000-0000-4000-8000-000000035803', 'D226-3', 'ready',     'register', now() + interval '3 seconds', 'Walk-in',
   100, 0, 0, 100, 1, 'POS sale ' || chr(8212) || ' Register 1 ' || chr(8212) || ' rung by Test.', '00000000-0000-4000-8000-0000000358a3'),
  ('00000000-0000-4000-8000-000000035804', 'D226-4', 'completed', 'greenway', now() + interval '2 seconds', 'Walk-in',
   100, 0, 0, 100, 1, 'POS sale ' || chr(8212) || ' Register 2 ' || chr(8212) || ' rung by Test.', '00000000-0000-4000-8000-0000000358a4'),
  ('00000000-0000-4000-8000-000000035805', 'D226-5', 'completed', 'greenway', now() + interval '1 second',  'Walk-in',
   100, 0, 0, 100, 1, 'POS sale ' || chr(8212) || ' Register 1 ' || chr(8212) || ' rung by Old.', null);

do $$
declare
  s_all jsonb;
  s_on  jsonb;
  s_reg jsonb;
  st    text;
  ids_on  text;
  ids_reg text;
begin
  s_all := public.orders_board_snapshot(20, null, null);
  s_on  := public.orders_board_snapshot(20, null, 'online');
  s_reg := public.orders_board_snapshot(20, null, 'register');

  -- online + register = every row, per status (row 5 is counted as online
  -- here: no uuid and still 'greenway'. 0359 below fixes that label).
  for st in select jsonb_object_keys(s_all->'counts') loop
    if (s_all->'counts'->>st)::int <> (s_on->'counts'->>st)::int + (s_reg->'counts'->>st)::int then
      raise exception 'online + register <> all for status %', st;
    end if;
  end loop;

  select string_agg(a->>'order_number', ',' order by a->>'order_number') into ids_on
    from jsonb_array_elements(s_on->'arrivals') a where a->>'order_number' like 'D226-%';
  select string_agg(a->>'order_number', ',' order by a->>'order_number') into ids_reg
    from jsonb_array_elements(s_reg->'arrivals') a where a->>'order_number' like 'D226-%';
  if ids_reg <> 'D226-3,D226-4' then
    raise exception 'register arrivals before 0359 were %, expected D226-3,D226-4', ids_reg;
  end if;
  if ids_on <> 'D226-1,D226-2,D226-5' then
    raise exception 'online arrivals before 0359 were %, expected D226-1,D226-2,D226-5', ids_on;
  end if;

  -- Old call shapes still resolve to the one function (p_source defaults null).
  if public.orders_board_snapshot()->'counts' <> s_all->'counts' then raise exception 'no-arg call differs'; end if;
  if public.orders_board_snapshot(20, array[]::text[])->'counts' <> s_all->'counts' then raise exception 'two-arg call differs'; end if;
  -- Garbage source = every row.
  if public.orders_board_snapshot(20, null, 'bogus')->'counts' <> s_all->'counts' then raise exception 'garbage source not = all'; end if;

  -- Service role only.
  if has_function_privilege('anon', 'public.orders_board_snapshot(integer, text[], text)', 'execute')
     or has_function_privilege('authenticated', 'public.orders_board_snapshot(integer, text[], text)', 'execute') then
    raise exception 'orders_board_snapshot is callable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.orders_board_snapshot(integer, text[], text)', 'execute') then
    raise exception 'service_role cannot call orders_board_snapshot';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'orders_board_snapshot'
                and pg_get_function_identity_arguments(p.oid) <> 'p_arrivals_limit integer, p_exclude_origins text[], p_source text') then
    raise exception 'a second orders_board_snapshot overload exists';
  end if;
end $$;

-- 0359 has already run (on the empty bootstrap); run it again with the rows.
\ir ../../supabase/migrations/0359_orders_register_origin_backfill.sql

do $$
declare
  ids_on text;
  s_on jsonb;
begin
  if (select string_agg(order_number || '=' || origin, ',' order by order_number) from public.orders
       where order_number like 'D226-%')
     <> 'D226-1=greenway,D226-2=leafly,D226-3=register,D226-4=register,D226-5=register' then
    raise exception '0359 relabelled the wrong rows';
  end if;
  if (select string_agg(o.order_number || '=' || b.previous_origin, ',' order by o.order_number)
        from public.orders_origin_backfill_0359 b join public.orders o on o.id = b.order_id
       where o.order_number like 'D226-%')
     <> 'D226-4=greenway,D226-5=greenway' then
    raise exception '0359 did not list exactly the relabelled rows';
  end if;

  s_on := public.orders_board_snapshot(20, array['leafly'], 'online');
  select string_agg(a->>'order_number', ',' order by a->>'order_number') into ids_on
    from jsonb_array_elements(s_on->'arrivals') a where a->>'order_number' like 'D226-%';
  -- Arrivals ignore p_exclude_origins (as in 0233); the Leafly copy stays.
  if ids_on <> 'D226-1,D226-2' then
    raise exception 'online arrivals after 0359 were %, expected D226-1,D226-2', ids_on;
  end if;

  if has_table_privilege('anon', 'public.orders_origin_backfill_0359', 'select')
     or has_table_privilege('authenticated', 'public.orders_origin_backfill_0359', 'select') then
    raise exception 'orders_origin_backfill_0359 is readable by anon/authenticated';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.orders_origin_backfill_0359'::regclass) then
    raise exception 'orders_origin_backfill_0359 has RLS off';
  end if;
end $$;

-- Safe to re-run: nothing left to change, nothing listed twice.
\ir ../../supabase/migrations/0359_orders_register_origin_backfill.sql

-- The rollback puts 'greenway' back on exactly the listed rows.
\ir ../../supabase/rollbacks/0359_orders_register_origin_backfill.rollback.sql
do $$
begin
  if (select string_agg(order_number || '=' || origin, ',' order by order_number) from public.orders
       where order_number like 'D226-%')
     <> 'D226-1=greenway,D226-2=leafly,D226-3=register,D226-4=greenway,D226-5=greenway' then
    raise exception '0359 rollback did not restore exactly the relabelled rows';
  end if;
  if to_regclass('public.orders_origin_backfill_0359') is not null then
    raise exception '0359 rollback left the list table behind';
  end if;
end $$;

-- 0358 rollback then re-apply: the two-argument function comes back, then
-- the three-argument one replaces it.
\ir ../../supabase/rollbacks/0358_orders_board_snapshot_source.rollback.sql
do $$
begin
  if to_regprocedure('public.orders_board_snapshot(integer, text[])') is null then
    raise exception '0358 rollback did not restore the 0233 function';
  end if;
end $$;
\ir ../../supabase/migrations/0358_orders_board_snapshot_source.sql
do $$
begin
  if to_regprocedure('public.orders_board_snapshot(integer, text[], text)') is null
     or to_regprocedure('public.orders_board_snapshot(integer, text[])') is not null then
    raise exception '0358 re-apply did not leave exactly the three-argument function';
  end if;
end $$;

\echo ORDERS SOURCE 0358 0359 CHECK PASSED
rollback;
