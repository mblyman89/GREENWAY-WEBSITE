-- scripts/recon/customer-search-0335-pg-check.sql  (G-75 - migration 0335)
--
-- Scenario check for 0335_customer_search.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: nothing remains.
--   * 0335 applies twice (idempotent);
--   * the two import columns exist (timestamptz / text);
--   * the four trigram indexes exist;
--   * customer_search_fuzzy finds a typo ("bil mclendon" -> Bill McClendon),
--     either word order, and not an unrelated customer;
--   * a query under 3 letters returns nothing; p_limit is capped;
--   * grants: service_role may execute; anon / authenticated may not;
--     customers table grants are unchanged.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/customer-search-0335-pg-check.sql
--
-- "CUSTOMER SEARCH 0335 CHECK PASSED" then ROLLBACK = all clear.
begin;

create temp table g75_before as
select r.rolname, p.priv,
       has_table_privilege(r.rolname, 'public.customers', p.priv) as has_it
  from (values ('service_role'), ('anon'), ('authenticated')) r(rolname)
 cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv);

\i supabase/migrations/0335_customer_search.sql
\i supabase/migrations/0335_customer_search.sql

insert into public.customers (id, first_name, last_name, phone_normalized, imported_created_at, tax_designations)
values
  ('00000000-0000-4000-8000-000000000751', 'Bill', 'McClendon', '3608093778', '2024-08-30T14:36:31Z', 'Veteran'),
  ('00000000-0000-4000-8000-000000000752', 'Zelda', 'Quartermaine', null, null, null);

do $$
declare n int;
begin
  assert (select data_type from information_schema.columns
           where table_schema = 'public' and table_name = 'customers' and column_name = 'imported_created_at')
         = 'timestamp with time zone', 'imported_created_at is timestamptz';
  assert (select data_type from information_schema.columns
           where table_schema = 'public' and table_name = 'customers' and column_name = 'tax_designations')
         = 'text', 'tax_designations is text';
  select count(*) into n from pg_indexes
   where schemaname = 'public' and tablename = 'customers'
     and indexname in ('customers_first_name_trgm_idx', 'customers_last_name_trgm_idx',
                       'customers_email_trgm_idx', 'customers_phone_normalized_trgm_idx');
  assert n = 4, 'four trigram indexes';

  assert exists (select 1 from public.customer_search_fuzzy('bil mclendon', 25)
                  where customer_id = '00000000-0000-4000-8000-000000000751'),
    'typo finds Bill McClendon';
  assert exists (select 1 from public.customer_search_fuzzy('mclendon bil', 25)
                  where customer_id = '00000000-0000-4000-8000-000000000751'),
    'reversed order finds Bill McClendon';
  assert exists (select 1 from public.customer_search_fuzzy('Mcclenden', 25)
                  where customer_id = '00000000-0000-4000-8000-000000000751'),
    'last name with a typo finds him';
  assert not exists (select 1 from public.customer_search_fuzzy('bil mclendon', 25)
                      where customer_id = '00000000-0000-4000-8000-000000000752'),
    'an unrelated customer is not returned';
  assert not exists (select 1 from public.customer_search_fuzzy('bi', 25)), 'under 3 letters returns nothing';
  assert (select count(*) from public.customer_search_fuzzy('bill', 100000)) <= 100, 'limit is capped at 100';
  assert (select score from public.customer_search_fuzzy('bill mcclendon', 5)
           where customer_id = '00000000-0000-4000-8000-000000000751') > 0.9, 'exact name scores near 1';

  assert has_function_privilege('service_role', 'public.customer_search_fuzzy(text, integer)', 'EXECUTE'),
    'service_role may execute';
  assert not has_function_privilege('anon', 'public.customer_search_fuzzy(text, integer)', 'EXECUTE'),
    'anon may not execute';
  assert not has_function_privilege('authenticated', 'public.customer_search_fuzzy(text, integer)', 'EXECUTE'),
    'authenticated may not execute';
  assert not exists (
    select 1 from g75_before b
     where b.has_it <> has_table_privilege(b.rolname, 'public.customers', b.priv)
  ), 'grants on customers unchanged';
end $$;

select 'CUSTOMER SEARCH 0335 CHECK PASSED' as result;
rollback;
