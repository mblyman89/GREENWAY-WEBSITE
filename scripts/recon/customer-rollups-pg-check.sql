-- Behavioural proof for 0232_customer_rollups.sql against a real Postgres.
-- Usage (after all migrations are applied to a scratch database):
--   psql -d <db> -v ON_ERROR_STOP=1 -f scripts/recon/customer-rollups-pg-check.sql
-- Everything runs in one transaction that is rolled back at the end.
-- Each step raises an exception (and so fails the run) on a wrong number.
begin;

create or replace function pg_temp.expect(p_id uuid, p_visits int, p_spend int, p_last timestamptz, p_label text)
returns void language plpgsql as $$
declare c record;
begin
  select visit_count, lifetime_spend_minor_units, last_visit_at into c from public.customers where id = p_id;
  if c.visit_count is distinct from p_visits or c.lifetime_spend_minor_units is distinct from p_spend
     or c.last_visit_at is distinct from p_last then
    raise exception 'FAIL %: got visits=% spend=% last=%, want visits=% spend=% last=%',
      p_label, c.visit_count, c.lifetime_spend_minor_units, c.last_visit_at, p_visits, p_spend, p_last;
  end if;
  raise notice 'ok  %', p_label;
end $$;

insert into public.customers (id, first_name, import_source, lifetime_spend_minor_units, imported_spend_minor_units)
values ('00000000-0000-0000-0000-00000000000a', 'Ann', null, 0, 0),
       ('00000000-0000-0000-0000-00000000000b', 'Bob', null, 0, 0);

select pg_temp.expect('00000000-0000-0000-0000-00000000000a', 0, 0, null, 'new customer starts at zero');

-- A register sale: inserted 'ready', then completed by the gate.
insert into public.orders (id, customer_first_name, origin, status, total_minor_units, placed_at, customer_id)
values ('00000000-0000-0000-0000-0000000000a1', 'Walk-in', 'register', 'ready', 5000, '2026-05-01T18:00:00Z',
        '00000000-0000-0000-0000-00000000000a');
select pg_temp.expect('00000000-0000-0000-0000-00000000000a', 0, 0, null, 'ready (not yet completed) does not count');

update public.orders set status = 'completed', completed_at = '2026-05-01T18:05:00Z'
 where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.expect('00000000-0000-0000-0000-00000000000a', 1, 5000, '2026-05-01T18:05:00Z', 'completed sale counts');

-- Second completed sale inserted directly as completed, no completed_at -> placed_at used.
insert into public.orders (id, customer_first_name, origin, status, total_minor_units, placed_at, customer_id)
values ('00000000-0000-0000-0000-0000000000a2', 'Walk-in', 'register', 'completed', 2500, '2026-05-10T19:00:00Z',
        '00000000-0000-0000-0000-00000000000a');
select pg_temp.expect('00000000-0000-0000-0000-00000000000a', 2, 7500, '2026-05-10T19:00:00Z', 'second sale, placed_at fallback');
do $$ begin
  if (select first_visit_at from public.customers where id = '00000000-0000-0000-0000-00000000000a') is distinct from '2026-05-01T18:05:00Z'::timestamptz then
    raise exception 'FAIL first_visit_at should be the earliest completed sale';
  end if;
  raise notice 'ok  first_visit_at is the earliest completed sale';
end $$;

-- A sale for nobody (walk-in with no loyalty) touches no customer.
insert into public.orders (id, customer_first_name, origin, status, total_minor_units)
values ('00000000-0000-0000-0000-0000000000c1', 'Walk-in', 'register', 'completed', 9999);
select pg_temp.expect('00000000-0000-0000-0000-00000000000a', 2, 7500, '2026-05-10T19:00:00Z', 'unlinked sale ignored');

-- Staff links that anonymous sale to Bob later.
update public.orders set customer_id = '00000000-0000-0000-0000-00000000000b'
 where id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.expect('00000000-0000-0000-0000-00000000000b', 1, 9999, (select placed_at from public.orders where id = '00000000-0000-0000-0000-0000000000c1'), 'late link counts for Bob');

-- Moved from Bob to Ann: both recomputed.
update public.orders set customer_id = '00000000-0000-0000-0000-00000000000a'
 where id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.expect('00000000-0000-0000-0000-00000000000b', 0, 0, null, 'relink: old customer drops back');
select pg_temp.expect('00000000-0000-0000-0000-00000000000a', 3, 17499, (select placed_at from public.orders where id = '00000000-0000-0000-0000-0000000000c1'), 'relink: new customer gains it');
update public.orders set customer_id = null where id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.expect('00000000-0000-0000-0000-00000000000a', 2, 7500, '2026-05-10T19:00:00Z', 'unlink removes it');

-- Partial return with a refund on sale a1.
insert into public.customer_returns (id, order_id, quantity, refund_minor_units)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 1, 1200);
select pg_temp.expect('00000000-0000-0000-0000-00000000000a', 2, 6300, '2026-05-10T19:00:00Z', 'refund reduces spend, not visits');
update public.customer_returns set refund_minor_units = 2000 where id = '00000000-0000-0000-0000-0000000000e1';
select pg_temp.expect('00000000-0000-0000-0000-00000000000a', 2, 5500, '2026-05-10T19:00:00Z', 'refund amount edited');
delete from public.customer_returns where id = '00000000-0000-0000-0000-0000000000e1';
select pg_temp.expect('00000000-0000-0000-0000-00000000000a', 2, 7500, '2026-05-10T19:00:00Z', 'refund deleted restores spend');

-- Void: completed -> ready -> cancelled.
update public.orders set status = 'ready' where id = '00000000-0000-0000-0000-0000000000a2';
update public.orders set status = 'cancelled' where id = '00000000-0000-0000-0000-0000000000a2';
select pg_temp.expect('00000000-0000-0000-0000-00000000000a', 1, 5000, '2026-05-01T18:05:00Z', 'voided sale drops out');

-- Total corrected on a completed order.
update public.orders set total_minor_units = 5200 where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.expect('00000000-0000-0000-0000-00000000000a', 1, 5200, '2026-05-01T18:05:00Z', 'total change flows through');

-- Refund larger than the sale never makes spend negative.
insert into public.customer_returns (order_id, quantity, refund_minor_units)
values ('00000000-0000-0000-0000-0000000000a1', 1, 99999);
select pg_temp.expect('00000000-0000-0000-0000-00000000000a', 1, 0, '2026-05-01T18:05:00Z', 'spend floors at zero');

-- Order deleted.
delete from public.customer_returns where order_id = '00000000-0000-0000-0000-0000000000a1';
delete from public.orders where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.expect('00000000-0000-0000-0000-00000000000a', 0, 0, null, 'deleted order drops out');
do $$ begin
  if (select first_visit_at from public.customers where id = '00000000-0000-0000-0000-00000000000a') is not null then
    raise exception 'FAIL first_visit_at should clear with no completed sales';
  end if;
  raise notice 'ok  first_visit_at clears with no sales';
end $$;

-- Audit finds drift and recompute fixes it.
update public.customers set visit_count = 42 where id = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select count(*) from public.customer_rollup_audit() where customer_id = '00000000-0000-0000-0000-00000000000a') <> 1 then
    raise exception 'FAIL audit did not flag drift';
  end if;
  perform public.customer_rollup_recompute('00000000-0000-0000-0000-00000000000a');
  if (select count(*) from public.customer_rollup_audit()) <> 0 then
    raise exception 'FAIL audit not clean after recompute';
  end if;
  raise notice 'ok  audit flags drift and recompute clears it';
end $$;

-- Browsers cannot call the functions.
do $$ begin
  if has_function_privilege('anon', 'public.customer_rollup_recompute(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.customer_rollup_audit()', 'execute') then
    raise exception 'FAIL anon/authenticated can execute rollup functions';
  end if;
  if not has_function_privilege('service_role', 'public.customer_rollup_audit()', 'execute') then
    raise exception 'FAIL service_role cannot execute audit';
  end if;
  raise notice 'ok  execute is server-only';
end $$;

select 'ALL CUSTOMER ROLLUP CHECKS PASSED' as result;
rollback;
