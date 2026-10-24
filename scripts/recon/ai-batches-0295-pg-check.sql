-- scripts/recon/ai-batches-0295-pg-check.sql  (R74 S34 - migration 0295)
--
-- Scenario check for 0295_ai_batches.sql on Postgres 15 with every migration
-- applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ai-batches-0295-pg-check.sql
--
-- "R74 0295 CHECK PASSED" then ROLLBACK = all clear.
begin;

create or replace function pg_temp.must_fail(sql text, expect text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(expect in sqlerrm) = 0 and sqlstate <> expect then
      raise exception 'probe raised the WRONG error. expected %, got [%] %  -- %', expect, sqlstate, sqlerrm, sql;
    end if;
    return;
  end;
  raise exception 'probe was ACCEPTED but must be refused (expected %): %', expect, sql;
end $$;

do $$
declare
  n   int;
  b1  uuid;
  j1  uuid;
  i1  uuid;
begin
  -- 0. shape: table with RLS, staff read policy, the link column + indexes
  select count(*) into n from pg_class where relname = 'ai_batches' and relkind = 'r' and relrowsecurity;
  assert n = 1, 'ai_batches with RLS on';
  select count(*) into n from pg_policies where tablename = 'ai_batches';
  assert n = 1, 'one staff read policy';
  select count(*) into n from information_schema.columns where table_name = 'lookup_job_items' and column_name = 'batch_id';
  assert n = 1, 'lookup_job_items.batch_id';
  select count(*) into n from pg_indexes where indexname in ('ai_batches_open_idx', 'lookup_job_items_batch_idx');
  assert n = 2, 'both indexes';

  -- 1. a valid batch + a product waiting on it
  insert into public.ai_batches (model, families, items, request_keys) values ('gemini-3.8-flash', 1, 1, '{"f0": []}') returning id into b1;
  insert into public.lookup_jobs (manifest_id, status, total) values (gen_random_uuid(), 'running', 1) returning id into j1;
  insert into public.lookup_job_items (job_id, draft_id, position, status, batch_id) values (j1, gen_random_uuid(), 0, 'running', b1) returning id into i1;
  update public.ai_batches set name = 'batches/abc', state = 'pending' where id = b1;
  update public.ai_batches set state = 'ingested', prompt_tokens = 10, output_tokens = 5, search_queries = 2, cost_cents = 2.81 where id = b1;

  -- 2. deleting a batch frees its products (set null), never deletes them
  delete from public.ai_batches where id = b1;
  select count(*) into n from public.lookup_job_items where id = i1 and batch_id is null;
  assert n = 1, 'on delete set null';
end $$;

-- 3. refusals
select pg_temp.must_fail($q$insert into public.ai_batches (model, state) values ('m', 'bogus')$q$, 'ai_batches_state_check');
select pg_temp.must_fail($q$insert into public.ai_batches (model, cost_cents) values ('m', -1)$q$, 'ai_batches_cost_cents_check');
select pg_temp.must_fail($q$insert into public.ai_batches (model, search_queries) values ('m', -1)$q$, 'ai_batches_search_queries_check');
select pg_temp.must_fail($q$insert into public.ai_batches (model) values (null)$q$, '23502');
select pg_temp.must_fail($q$insert into public.ai_batches (model, name) values ('m', 'batches/dup'), ('m', 'batches/dup')$q$, '23505');
select pg_temp.must_fail($q$update public.lookup_job_items set batch_id = gen_random_uuid() where true$q$, '23503');

select 'R74 0295 CHECK PASSED';
rollback;
