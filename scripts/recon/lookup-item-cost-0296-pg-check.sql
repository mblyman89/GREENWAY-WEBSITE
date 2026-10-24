-- scripts/recon/lookup-item-cost-0296-pg-check.sql  (R74 S37 - migration 0296)
--
-- ONE transaction, rolled back.  "R74 0296 CHECK PASSED" then ROLLBACK = all clear.
begin;

do $$
declare
  n  int;
  j1 uuid;
  i1 uuid;
begin
  select count(*) into n from information_schema.columns where table_name = 'lookup_job_items' and column_name = 'cost_cents' and data_type = 'numeric';
  assert n = 1, 'lookup_job_items.cost_cents numeric';
  insert into public.lookup_jobs (manifest_id, status, total) values (gen_random_uuid(), 'running', 1) returning id into j1;
  insert into public.lookup_job_items (job_id, draft_id, position, status) values (j1, gen_random_uuid(), 0, 'done') returning id into i1;
  select count(*) into n from public.lookup_job_items where id = i1 and cost_cents is null;
  assert n = 1, 'null by default (not measured)';
  update public.lookup_job_items set cost_cents = 4.215 where id = i1;
  update public.lookup_job_items set cost_cents = coalesce(cost_cents, 0) + 1.5 where id = i1;
  select count(*) into n from public.lookup_job_items where id = i1 and cost_cents = 5.715;
  assert n = 1, 'retry adds';
  begin
    update public.lookup_job_items set cost_cents = -1 where id = i1;
    raise exception 'negative cost was ACCEPTED';
  exception when check_violation then null;
  end;
end $$;

select 'R74 0296 CHECK PASSED' as result;
rollback;
