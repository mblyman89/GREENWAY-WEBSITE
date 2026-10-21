-- scripts/recon/ccrs-sale-slice-0283-pg-check.sql  (Round 5 / R5-1 - migration 0283)
--
-- Scenario check for public.ccrs_sale_slice on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-sale-slice-0283-pg-check.sql
--
-- "CCRS 0283 CHECK PASSED" then ROLLBACK = all clear.
begin;

do $$
declare
  j    jsonb;
  f_up uuid;
  f_em uuid;
  f_ab uuid;
  f_pp uuid;
  n    int;
begin
  -- 0. shape: read-only (stable), not security definer, service role only
  select count(*) into n from pg_proc where proname = 'ccrs_sale_slice' and provolatile = 's' and not prosecdef;
  assert n = 1, 'one stable, non-definer ccrs_sale_slice';
  assert has_function_privilege('service_role', 'public.ccrs_sale_slice(text, text[])', 'execute'), 'service_role may execute';
  assert not has_function_privilege('anon', 'public.ccrs_sale_slice(text, text[])', 'execute'), 'anon may not execute';
  assert not has_function_privilege('authenticated', 'public.ccrs_sale_slice(text, text[])', 'execute'), 'authenticated may not execute';

  -- 1. bad env refused
  begin
    perform public.ccrs_sale_slice('test', array['X']);
    raise exception 'bad env was ACCEPTED';
  exception when others then
    if position('CCRS_SALE_SLICE_BAD_ENV' in sqlerrm) = 0 then raise; end if;
  end;

  -- 2. fixtures: held lines in prod, one in preprod, files in each in-flight state
  insert into public.ccrs_filed_entities (env, file_type, external_id, state, source, last_operation, last_payload) values
    ('prod', 'Sale', 'R5-HELD', 'filed', 'r5:check', 'Insert', '{"Quantity":"4"}'::jsonb),
    ('prod', 'Sale', 'R5-DEL',  'deleted', 'r5:check', 'Delete', '{"Quantity":"4"}'::jsonb),
    ('prod', 'Sale', 'R5-FLY',  'filed', 'r5:check', 'Insert', '{"Quantity":"2"}'::jsonb),
    ('preprod', 'Sale', 'R5-PP', 'filed', 'r5:check', 'Insert', '{"Quantity":"9"}'::jsonb);

  insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path) values ('prod', 'Sale', 'weekly', 'R5CHK_Sale_up.csv', repeat('1', 64), 1, 'r5chk/up') returning id into f_up;
  insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path) values ('prod', 'Sale', 'weekly', 'R5CHK_Sale_em.csv', repeat('2', 64), 1, 'r5chk/em') returning id into f_em;
  insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path) values ('prod', 'Sale', 'weekly', 'R5CHK_Sale_ab.csv', repeat('3', 64), 1, 'r5chk/ab') returning id into f_ab;
  insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path) values ('preprod', 'Sale', 'weekly', 'R5CHK_Sale_pp.csv', repeat('4', 64), 1, 'r5chk/pp') returning id into f_pp;
  insert into public.ccrs_file_rows (file_id, row_no, external_id, operation, payload, state) values
    (f_up, 1, 'R5-FLY', 'Update', '{}'::jsonb, 'emitted'),   -- uploaded, unanswered
    (f_em, 1, 'R5-NEW', 'Insert', '{}'::jsonb, 'emitted'),   -- emitted, not held yet
    (f_em, 2, '', 'Insert', '{}'::jsonb, 'emitted'),         -- a blank id must never be answered
    (f_ab, 1, 'R5-HELD', 'Update', '{}'::jsonb, 'emitted'),  -- abandoned: not in flight
    (f_pp, 1, 'R5-HELD', 'Update', '{}'::jsonb, 'emitted');  -- other env: not in flight here
  update public.ccrs_files set state = 'emitted' where id in (f_up, f_em, f_ab, f_pp);
  update public.ccrs_files set state = 'uploaded' where id = f_up;
  update public.ccrs_files set state = 'abandoned' where id = f_ab;

  -- 3. the answer
  j := public.ccrs_sale_slice('prod', array['R5-HELD', 'R5-DEL', 'R5-FLY', 'R5-NEW', 'R5-NONE', 'R5-PP', '', null, 'R5-HELD']);
  assert j->>'env' = 'prod', 'echoes env';
  assert j->'entries' = '[["R5-DEL","deleted","4",false],["R5-FLY","filed","2",true],["R5-HELD","filed","4",false],["R5-NEW",null,null,true]]'::jsonb,
    'entries wrong: ' || (j->'entries')::text;

  -- 4. env isolation: preprod sees only its own line and its own in-flight file
  j := public.ccrs_sale_slice('preprod', array['R5-HELD', 'R5-PP']);
  assert j->'entries' = '[["R5-HELD",null,null,true],["R5-PP","filed","9",false]]'::jsonb, 'preprod entries wrong: ' || (j->'entries')::text;

  -- 5. empty / null input
  assert public.ccrs_sale_slice('prod', null)->'entries' = '[]'::jsonb, 'null ids -> []';
  assert public.ccrs_sale_slice('prod', '{}')->'entries' = '[]'::jsonb, 'empty ids -> []';

  raise notice 'CCRS 0283 CHECK PASSED';
end $$;

rollback;
