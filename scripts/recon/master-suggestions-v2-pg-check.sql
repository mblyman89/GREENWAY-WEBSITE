-- scripts/recon/master-suggestions-v2-pg-check.sql  (S36 - migration 0243)
--
-- Scenario check for 0243_master_suggestions_v2.sql against a real Postgres.
-- Runs in ONE transaction that is rolled back, so it leaves nothing behind.
-- If the base tables are missing (a bare build-sandbox database) it creates
-- the minimum stand-ins first, inside the same transaction.
-- Applies the migration TWICE (idempotency), then proves the constraints,
-- then applies the rollback and proves it removed both objects.
-- A run that prints MASTER SUGGESTIONS V2 CHECK PASSED then ROLLBACK is the
-- all-clear.
--
--   sudo -u postgres psql -d greenway -v ON_ERROR_STOP=1 \
--     -f scripts/recon/master-suggestions-v2-pg-check.sql
begin;

create table if not exists public.staff_profiles (id uuid primary key);
create table if not exists public.product_master_suggestions (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  members_json jsonb not null default '[]'::jsonb,
  confidence numeric,
  status text not null default 'pending'
);

\i supabase/migrations/0243_master_suggestions_v2.sql
\i supabase/migrations/0243_master_suggestions_v2.sql

do $$
declare
  s uuid := gen_random_uuid();
  sid uuid;
  n int;
begin
  insert into public.staff_profiles (id) values (s);

  -- the column exists, is jsonb and nullable
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'product_master_suggestions'
     and column_name = 'evidence_json' and data_type = 'jsonb' and is_nullable = 'YES';
  assert n = 1, 'evidence_json jsonb nullable missing';
  insert into public.product_master_suggestions (display_name, evidence_json)
    values ('x', '{"v":1,"band":"strong"}') returning id into sid;
  insert into public.product_master_suggestions (display_name) values ('old row');

  -- an ordered pair is accepted
  insert into public.product_master_pair_decisions (key_a, key_b, decision, fingerprint, decided_by)
    values ('A-1', 'a1', 'not_a_match', 'fp1#x#y', s);

  -- reversed order refused (byte order: 'a1' > 'A-1')
  begin
    insert into public.product_master_pair_decisions (key_a, key_b, decision, fingerprint)
      values ('a1', 'A-1', 'not_a_match', 'fp');
    raise exception 'reversed pair was accepted';
  exception when check_violation then null;
  end;

  -- self pair refused
  begin
    insert into public.product_master_pair_decisions (key_a, key_b, decision, fingerprint)
      values ('k', 'k', 'not_a_match', 'fp');
    raise exception 'self pair was accepted';
  exception when check_violation then null;
  end;

  -- one row per pair
  begin
    insert into public.product_master_pair_decisions (key_a, key_b, decision, fingerprint)
      values ('A-1', 'a1', 'not_a_match', 'fp2');
    raise exception 'duplicate pair was accepted';
  exception when unique_violation then null;
  end;

  -- upsert on the key replaces the fingerprint (what rejectSuggestion does)
  insert into public.product_master_pair_decisions (key_a, key_b, decision, fingerprint)
    values ('A-1', 'a1', 'not_a_match', 'fp3')
    on conflict (key_a, key_b) do update set fingerprint = excluded.fingerprint;
  select count(*) into n from public.product_master_pair_decisions where fingerprint = 'fp3';
  assert n = 1, 'upsert did not replace the fingerprint';

  -- only not_a_match
  begin
    insert into public.product_master_pair_decisions (key_a, key_b, decision, fingerprint)
      values ('b', 'c', 'match', 'fp');
    raise exception 'bad decision accepted';
  exception when check_violation then null;
  end;

  -- fingerprint required
  begin
    insert into public.product_master_pair_decisions (key_a, key_b, decision, fingerprint)
      values ('b', 'c', 'not_a_match', null);
    raise exception 'null fingerprint accepted';
  exception when not_null_violation then null;
  end;

  -- decided_at defaults
  select count(*) into n from public.product_master_pair_decisions where decided_at is not null;
  assert n = 1, 'decided_at default missing';

  -- deleting the staff member keeps the decision, clears the link
  delete from public.staff_profiles where id = s;
  select count(*) into n from public.product_master_pair_decisions where decided_by is null;
  assert n = 1, 'decided_by was not set null';

  -- RLS on, no policy
  select count(*) into n from pg_class c
   where c.relname = 'product_master_pair_decisions' and c.relrowsecurity;
  assert n = 1, 'RLS is not on';
  select count(*) into n from pg_policies where tablename = 'product_master_pair_decisions';
  assert n = 0, 'unexpected policy';
end $$;

\i supabase/rollbacks/0243_master_suggestions_v2.rollback.sql

do $$
declare n int;
begin
  assert to_regclass('public.product_master_pair_decisions') is null, 'rollback left the table';
  select count(*) into n from information_schema.columns
   where table_name = 'product_master_suggestions' and column_name = 'evidence_json';
  assert n = 0, 'rollback left the column';
  select count(*) into n from public.product_master_suggestions;
  assert n = 2, 'rollback lost suggestion rows';
  raise notice 'MASTER SUGGESTIONS V2 CHECK PASSED';
end $$;

rollback;
