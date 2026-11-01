-- scripts/recon/cultivera-loyalty-0336-pg-check.sql  (CVL - migration 0336)
--
-- Scenario check for 0336_cultivera_loyalty_import.sql on Postgres 15 with
-- every migration applied. ONE transaction, rolled back: nothing remains.
--   * 0336 applies twice (idempotent);
--   * grants: history table select/insert/update for service_role, never
--     delete; nothing for anon / authenticated; the function is service_role only;
--   * apply credits Cultivera's balance once as an opening adjust row, enrolls
--     without a signup bonus, recomputes balance / lifetime / tier;
--   * an existing account keeps its own rows and gains the opening on top;
--   * a second apply (same or new run) never credits again, but refreshes history;
--   * a zero balance stores history and adds no ledger row;
--   * an unknown Cultivera id is counted unmatched, never an error;
--   * more than 500 rows and a bad run id are refused.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/cultivera-loyalty-0336-pg-check.sql
--
-- "CULTIVERA LOYALTY 0336 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/migrations/0336_cultivera_loyalty_import.sql
\i supabase/migrations/0336_cultivera_loyalty_import.sql

do $$ begin
  assert has_table_privilege('service_role', 'public.customer_cultivera_loyalty', 'SELECT'), 'service_role reads';
  assert has_table_privilege('service_role', 'public.customer_cultivera_loyalty', 'INSERT'), 'service_role inserts';
  assert has_table_privilege('service_role', 'public.customer_cultivera_loyalty', 'UPDATE'), 'service_role refreshes';
  assert not has_table_privilege('service_role', 'public.customer_cultivera_loyalty', 'DELETE'), 'never deleted';
  assert not has_table_privilege('anon', 'public.customer_cultivera_loyalty', 'SELECT'), 'anon cannot read';
  assert not has_table_privilege('authenticated', 'public.customer_cultivera_loyalty', 'SELECT'), 'authenticated cannot read';
  assert has_function_privilege('service_role', 'public.apply_cultivera_loyalty(text, timestamptz, uuid, jsonb)', 'EXECUTE'), 'service_role may apply';
  assert not has_function_privilege('anon', 'public.apply_cultivera_loyalty(text, timestamptz, uuid, jsonb)', 'EXECUTE'), 'anon may not';
  assert not has_function_privilege('authenticated', 'public.apply_cultivera_loyalty(text, timestamptz, uuid, jsonb)', 'EXECUTE'), 'authenticated may not';
  assert exists (select 1 from pg_indexes where indexname = 'loyalty_ledger_import_key_uidx'), 'import key index';
  assert (select relrowsecurity from pg_class where oid = 'public.customer_cultivera_loyalty'::regclass), 'RLS on';
  assert not exists (select 1 from pg_constraint where conrelid = 'public.customer_cultivera_loyalty'::regclass
                      and contype = 'f' and confrelid in ('public.customers'::regclass, 'public.loyalty_ledger'::regclass)),
    'kept by the factory reset: no foreign key into a wiped table';
end $$;

-- A signup bonus must NOT be granted by the import.
update public.loyalty_config set signup_bonus_points = 50;

insert into public.customers (id, first_name, external_id) values
  ('00000000-0000-4000-8000-000000003361', 'Ann', '2322'),
  ('00000000-0000-4000-8000-000000003362', 'Bo', '5219'),
  ('00000000-0000-4000-8000-000000003363', 'Cy', '1');
-- Bo already has an account with 40 points earned here.
insert into public.loyalty_accounts (id, customer_id, balance_points, lifetime_points)
values ('00000000-0000-4000-8000-00000000336a', '00000000-0000-4000-8000-000000003362', 40, 40);
insert into public.loyalty_ledger (account_id, kind, points, note)
values ('00000000-0000-4000-8000-00000000336a', 'earn', 40, 'earned here');

create or replace function pg_temp.apply_as_service_role(run text, rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  r := public.apply_cultivera_loyalty(run, '2026-11-01T20:00:00Z', null, rows);
  reset role;
  return r;
end $$;

do $$
declare r jsonb; rows jsonb; n int; bal int; life int; tier text;
begin
  rows := '[
    {"external_id":"2322","balance":509.13,"spent_points":900,"spent_minor":0,"earned_orders":694.23,"initial":783,"adjusted":0,"returned":0,"cancelled":0,"accrual_rows":24,"orders":20,"total_minor":123456,"deleted":false,"opening_points":509},
    {"external_id":"5219","balance":675.6,"spent_points":2100,"spent_minor":0,"earned_orders":881.1,"initial":0,"adjusted":-25,"returned":0,"cancelled":0,"accrual_rows":40,"orders":30,"total_minor":99900,"deleted":false,"opening_points":676},
    {"external_id":"1","balance":0,"spent_points":0,"spent_minor":0,"earned_orders":116,"initial":20,"adjusted":0,"returned":0,"cancelled":0,"accrual_rows":5,"orders":4,"total_minor":11600,"deleted":false,"opening_points":0},
    {"external_id":"999999","balance":10,"spent_points":0,"spent_minor":0,"deleted":false,"opening_points":10}
  ]'::jsonb;
  r := pg_temp.apply_as_service_role('20261101T200000Z-0336abcd', rows);
  assert (r->>'rows')::int = 4 and (r->>'matched')::int = 3 and (r->>'unmatched')::int = 1, 'match counts: ' || r::text;
  assert (r->>'accountsCreated')::int = 1, 'Ann enrolled, Bo already had one, Cy has nothing to credit: ' || r::text;
  assert (r->>'openingsCredited')::int = 2 and (r->>'openingsAlreadyDone')::int = 0, 'two openings: ' || r::text;

  select balance_points, lifetime_points, t.name into bal, life, tier
    from public.loyalty_accounts a left join public.loyalty_tiers t on t.id = a.tier_id
   where a.customer_id = '00000000-0000-4000-8000-000000003361';
  assert bal = 509 and life = 509, 'Ann = Cultivera balance, no signup bonus: ' || bal || '/' || life;
  assert tier = 'Gold', 'tier recomputed from lifetime (Gold at 300): ' || coalesce(tier, 'none');

  select balance_points into bal from public.loyalty_accounts where customer_id = '00000000-0000-4000-8000-000000003362';
  assert bal = 716, 'Bo keeps his 40 and gains 676: ' || bal;

  assert not exists (select 1 from public.loyalty_accounts where customer_id = '00000000-0000-4000-8000-000000003363'),
    'a zero balance does not enroll';
  assert (select balance_points from public.customer_cultivera_loyalty where cultivera_customer_id = '1') = 0, 'Cy history stored';
  assert exists (select 1 from public.loyalty_ledger where import_key = 'cultivera-opening:00000000-0000-4000-8000-000000003361'),
    'opening row keyed to the customer';
  select count(*) into n from public.loyalty_ledger where import_key like 'cultivera-opening:%';
  assert n = 2, 'two opening rows: ' || n;
  assert (select kind::text from public.loyalty_ledger where import_key = 'cultivera-opening:00000000-0000-4000-8000-000000003361') = 'adjust',
    'opening row is an adjust';

  -- Second crawl: Ann's Cultivera balance changed. History refreshes, nothing is credited again.
  rows := '[{"external_id":"2322","balance":600,"spent_points":950,"spent_minor":0,"deleted":false,"opening_points":600}]'::jsonb;
  r := pg_temp.apply_as_service_role('20261102T200000Z-0336abce', rows);
  assert (r->>'openingsCredited')::int = 0 and (r->>'openingsAlreadyDone')::int = 1, 'never credited twice: ' || r::text;
  assert (select balance_points from public.loyalty_accounts where customer_id = '00000000-0000-4000-8000-000000003361') = 509,
    'balance unchanged by a second apply';
  assert (select balance_points from public.customer_cultivera_loyalty where cultivera_customer_id = '2322') = 600,
    'history refreshed';
  assert (select opening_points from public.customer_cultivera_loyalty where cultivera_customer_id = '2322') = 509,
    'opening points stay what was credited';
  select count(*) into n from public.loyalty_ledger where import_key like 'cultivera-opening:%';
  assert n = 2, 'still two opening rows';

  -- Duplicate ids in one batch are applied once.
  rows := '[{"external_id":"5219","balance":1,"spent_points":0,"spent_minor":0,"deleted":false,"opening_points":1},
            {"external_id":"5219","balance":1,"spent_points":0,"spent_minor":0,"deleted":false,"opening_points":1}]'::jsonb;
  r := pg_temp.apply_as_service_role('20261102T200000Z-0336abcf', rows);
  assert (r->>'matched')::int = 1 and (r->>'openingsCredited')::int = 0, 'duplicate in batch: ' || r::text;
  assert (select balance_points from public.loyalty_accounts where customer_id = '00000000-0000-4000-8000-000000003362') = 716,
    'Bo unchanged';

  -- The unique key itself refuses a second opening row.
  begin
    insert into public.loyalty_ledger (account_id, kind, points, import_key)
    select id, 'adjust', 1, 'cultivera-opening:00000000-0000-4000-8000-000000003361' from public.loyalty_accounts
     where customer_id = '00000000-0000-4000-8000-000000003361';
    assert false, 'duplicate import key must fail';
  exception when unique_violation then null;
  end;
end $$;

do $$
declare big jsonb;
begin
  select jsonb_agg(jsonb_build_object('external_id', g::text, 'balance', 0, 'spent_points', 0, 'spent_minor', 0,
                                      'deleted', false, 'opening_points', 0))
    into big from generate_series(1, 501) g;
  begin
    perform pg_temp.apply_as_service_role('20261101T200000Z-0336abcd', big);
    assert false, '501 rows must be refused';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform pg_temp.apply_as_service_role('../etc', '[]'::jsonb);
    assert false, 'bad run id must be refused';
  exception when invalid_parameter_value then null;
  end;
end $$;

\echo 'CULTIVERA LOYALTY 0336 CHECK PASSED'
rollback;
