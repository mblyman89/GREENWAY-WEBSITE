-- scripts/recon/destruction-hold-0334-pg-check.sql  (Fix Phase 7.1 - migration 0334)
--
-- Scenario check for 0334_destruction_hold_legal_minimum.sql on Postgres 15
-- with every migration applied. ONE transaction, rolled back: nothing remains.
--   * 0334 applies twice (idempotent);
--   * the saved hold of 72 becomes 0; the column default is 0;
--   * a hold chosen on screen (24) is NOT overwritten by a re-run;
--   * the 0042 column comments no longer claim a WSLCB 72h requirement;
--   * grants are unchanged (service_role / anon / authenticated privileges on
--     disposition_settings are the same before and after).
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/destruction-hold-0334-pg-check.sql
--
-- "DESTRUCTION HOLD 0334 CHECK PASSED" then ROLLBACK = all clear.
begin;

create temp table g50_before as
select r.rolname, p.priv,
       has_table_privilege(r.rolname, 'public.disposition_settings', p.priv) as has_it
  from (values ('service_role'), ('anon'), ('authenticated')) r(rolname)
 cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv);

-- Start from the 0115 state: saved row of 72.
insert into public.disposition_settings (id, hold_hours) values (true, 72)
on conflict (id) do update set hold_hours = 72;

\i supabase/migrations/0334_destruction_hold_legal_minimum.sql
\i supabase/migrations/0334_destruction_hold_legal_minimum.sql

do $$ begin
  assert (select hold_hours from public.disposition_settings where id = true) = 0,
    'saved 72 becomes the legal minimum 0';
  assert (select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'disposition_settings'
             and column_name = 'hold_hours') = '0',
    'column default is 0';
  assert col_description('public.destruction_events'::regclass,
           (select attnum from pg_attribute where attrelid = 'public.destruction_events'::regclass
             and attname = 'quarantine_start')) not ilike '%requires%',
    'quarantine_start comment no longer claims a requirement';
  assert col_description('public.destruction_events'::regclass,
           (select attnum from pg_attribute where attrelid = 'public.destruction_events'::regclass
             and attname = 'earliest_destroy_at')) ilike '%no waiting period%',
    'earliest_destroy_at comment states no waiting period';
  assert not exists (
    select 1 from g50_before b
     where b.has_it <> has_table_privilege(b.rolname, 'public.disposition_settings', b.priv)
  ), 'grants on disposition_settings unchanged';
end $$;

-- A value chosen on screen survives a re-run.
update public.disposition_settings set hold_hours = 24 where id = true;
\i supabase/migrations/0334_destruction_hold_legal_minimum.sql
do $$ begin
  assert (select hold_hours from public.disposition_settings where id = true) = 24,
    'a chosen hold (24) is left alone';
end $$;

select 'DESTRUCTION HOLD 0334 CHECK PASSED' as result;
rollback;
