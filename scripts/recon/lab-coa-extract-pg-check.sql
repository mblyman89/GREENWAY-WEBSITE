-- scripts/recon/lab-coa-extract-pg-check.sql  (R28 - migration 0252)
--
-- Scenario check for 0252_lab_coa_extract.sql against a REAL Postgres with
-- every migration 0001..0252 applied. ONE transaction, rolled back.
--
-- Seeds one row per backfill edge case, applies 0252 TWICE (idempotency),
-- asserts every outcome and every constraint, applies the ROLLBACK and
-- asserts the columns are gone, then re-applies 0252. A run that prints
-- LAB COA EXTRACT CHECK PASSED then ROLLBACK is the all-clear.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/lab-coa-extract-pg-check.sql
begin;

-- Clean slate (the runner may have applied 0252 already), then the columns
-- exist so a pre-filled link can be seeded; the backfill runs after seeding.
\ir ../../supabase/rollbacks/0252_lab_coa_extract.rollback.sql
\ir ../../supabase/migrations/0252_lab_coa_extract.sql

create temp table k (name text primary key, id uuid not null default gen_random_uuid()) on commit drop;
insert into k (name) values
  ('m1'), ('m2'), ('m_text'), ('m_noitems'),
  ('lab_ok'), ('lab_gg'), ('lab_pdf'), ('lab_http'), ('lab_two'), ('lab_nolot'), ('lab_preset'),
  ('lab_otherdelivery'), ('lab_noext'), ('lab_numlink'), ('lab_textpayload'), ('lab_noitems'), ('lab_same_twice'),
  ('l_ok'), ('l_gg'), ('l_pdf'), ('l_http'), ('l_two'), ('l_preset'), ('l_other'), ('l_noext'), ('l_num'),
  ('l_text'), ('l_noitems'), ('l_same1'), ('l_same2');
create or replace function pg_temp.kid(n text) returns uuid language sql stable as $$ select id from k where name = n $$;

-- m1: the owner transfer shape (WCIA inventory_transfer_items).
insert into public.inbound_manifests (id, manifest_number, raw_payload) values
  (pg_temp.kid('m1'), 'R28-PG-1', jsonb_build_object('inventory_transfer_items', jsonb_build_array(
    jsonb_build_object('lab_result_link', 'https://certs.conflabs.com/wcia/v2_1/WA-7mDLOjIpm5i3-WA-260921-006',
                       'lab_result_data', jsonb_build_object('lab_result_id', 'EXT-OK')),
    jsonb_build_object('lab_result_link', '  https://gglabs-j.github.io/2025/october/10.17.2025/buddyboy/x.json  ',
                       'lab_result_data', jsonb_build_object('lab_result_id', 'EXT-GG')),
    jsonb_build_object('lab_result_link', 'https://certs.conflabs.com/full/WA-x.pdf',
                       'lab_result_data', jsonb_build_object('lab_result_id', 'EXT-PDF')),
    jsonb_build_object('lab_result_link', 'http://certs.conflabs.com/wcia/v2_1/WA-plain',
                       'lab_result_data', jsonb_build_object('lab_result_id', 'EXT-HTTP')),
    jsonb_build_object('lab_result_link', 'https://a.example/one',
                       'lab_result_data', jsonb_build_object('lab_result_id', 'EXT-TWO')),
    jsonb_build_object('lab_result_link', 'https://a.example/two',
                       'lab_result_data', jsonb_build_object('lab_result_id', 'EXT-TWO')),
    jsonb_build_object('lab_result_link', 'https://a.example/new',
                       'lab_result_data', jsonb_build_object('lab_result_id', 'EXT-PRESET')),
    jsonb_build_object('lab_result_link', 'https://a.example/noext',
                       'lab_result_data', jsonb_build_object('lab_result_id', null)),
    jsonb_build_object('lab_result_link', 12345,
                       'lab_result_data', jsonb_build_object('lab_result_id', 'EXT-NUM')),
    jsonb_build_object('lab_result_link', jsonb_build_array('https://a.example/in-array'),
                       'lab_result_data', jsonb_build_object('lab_result_id', 'EXT-NUM')),
    jsonb_build_object('lab_result_link', 'https://a.example/same',
                       'lab_result_data', jsonb_build_object('lab_result_id', 'EXT-SAME')),
    jsonb_build_object('lab_result_link', 'https://a.example/same',
                       'lab_result_data', jsonb_build_object('lab_result_id', 'EXT-SAME')),
    'not an object'::text
  ))),
  -- m2: another delivery whose item carries EXT-OTHER - the lab row below is
  -- only linked to a lot of m1, so m2 must never feed it.
  (pg_temp.kid('m2'), 'R28-PG-2', jsonb_build_object('inventory_transfer_items', jsonb_build_array(
    jsonb_build_object('lab_result_link', 'https://a.example/wrong-delivery',
                       'lab_result_data', jsonb_build_object('lab_result_id', 'EXT-OTHER'))))),
  -- a CSV/text delivery (raw_payload is a JSON string) and a JSON object without items.
  (pg_temp.kid('m_text'), 'R28-PG-3', to_jsonb('lot,name'::text)),
  (pg_temp.kid('m_noitems'), 'R28-PG-4', jsonb_build_object('inventory_transfer_items', 'nope'));

insert into public.lab_results (id, labtest_external_identifier, wcia_json_url) values
  (pg_temp.kid('lab_ok'), 'EXT-OK', null),
  (pg_temp.kid('lab_gg'), 'EXT-GG', null),
  (pg_temp.kid('lab_pdf'), 'EXT-PDF', null),
  (pg_temp.kid('lab_http'), 'EXT-HTTP', null),
  (pg_temp.kid('lab_two'), 'EXT-TWO', null),
  (pg_temp.kid('lab_nolot'), 'EXT-OK', null),
  (pg_temp.kid('lab_preset'), 'EXT-PRESET', 'https://a.example/kept'),
  (pg_temp.kid('lab_otherdelivery'), 'EXT-OTHER', null),
  (pg_temp.kid('lab_noext'), null, null),
  (pg_temp.kid('lab_numlink'), 'EXT-NUM', null),
  (pg_temp.kid('lab_textpayload'), 'EXT-OK', null),
  (pg_temp.kid('lab_noitems'), 'EXT-OK', null),
  (pg_temp.kid('lab_same_twice'), 'EXT-SAME', null);

insert into public.inventory_lots (id, lot_code, manifest_id, lab_result_id) values
  (pg_temp.kid('l_ok'),      'R28-L1',  pg_temp.kid('m1'), pg_temp.kid('lab_ok')),
  (pg_temp.kid('l_gg'),      'R28-L2',  pg_temp.kid('m1'), pg_temp.kid('lab_gg')),
  (pg_temp.kid('l_pdf'),     'R28-L3',  pg_temp.kid('m1'), pg_temp.kid('lab_pdf')),
  (pg_temp.kid('l_http'),    'R28-L4',  pg_temp.kid('m1'), pg_temp.kid('lab_http')),
  (pg_temp.kid('l_two'),     'R28-L5',  pg_temp.kid('m1'), pg_temp.kid('lab_two')),
  (pg_temp.kid('l_preset'),  'R28-L6',  pg_temp.kid('m1'), pg_temp.kid('lab_preset')),
  (pg_temp.kid('l_other'),   'R28-L7',  pg_temp.kid('m1'), pg_temp.kid('lab_otherdelivery')),
  (pg_temp.kid('l_noext'),   'R28-L8',  pg_temp.kid('m1'), pg_temp.kid('lab_noext')),
  (pg_temp.kid('l_num'),     'R28-L9',  pg_temp.kid('m1'), pg_temp.kid('lab_numlink')),
  (pg_temp.kid('l_text'),    'R28-L10', pg_temp.kid('m_text'), pg_temp.kid('lab_textpayload')),
  (pg_temp.kid('l_noitems'), 'R28-L11', pg_temp.kid('m_noitems'), pg_temp.kid('lab_noitems')),
  (pg_temp.kid('l_same1'),   'R28-L12', pg_temp.kid('m1'), pg_temp.kid('lab_same_twice')),
  (pg_temp.kid('l_same2'),   'R28-L13', pg_temp.kid('m1'), pg_temp.kid('lab_same_twice'));

\ir ../../supabase/migrations/0252_lab_coa_extract.sql
\ir ../../supabase/migrations/0252_lab_coa_extract.sql

do $$
declare
  v text;
  n int;
begin
  select wcia_json_url into v from public.lab_results where id = pg_temp.kid('lab_ok');
  if v is distinct from 'https://certs.conflabs.com/wcia/v2_1/WA-7mDLOjIpm5i3-WA-260921-006' then raise exception 'lab_ok: got %', v; end if;
  select wcia_json_url into v from public.lab_results where id = pg_temp.kid('lab_gg');
  if v is distinct from 'https://gglabs-j.github.io/2025/october/10.17.2025/buddyboy/x.json' then raise exception 'lab_gg (trimmed): got %', v; end if;
  select wcia_json_url into v from public.lab_results where id = pg_temp.kid('lab_pdf');
  if v is not null then raise exception 'lab_pdf: a PDF link must never be stored as the JSON link, got %', v; end if;
  select wcia_json_url into v from public.lab_results where id = pg_temp.kid('lab_http');
  if v is not null then raise exception 'lab_http: plain http must be refused, got %', v; end if;
  select wcia_json_url into v from public.lab_results where id = pg_temp.kid('lab_two');
  if v is not null then raise exception 'lab_two: two different links = ambiguous = untouched, got %', v; end if;
  select wcia_json_url into v from public.lab_results where id = pg_temp.kid('lab_nolot');
  if v is not null then raise exception 'lab_nolot: no lot links it to a delivery, got %', v; end if;
  select wcia_json_url into v from public.lab_results where id = pg_temp.kid('lab_preset');
  if v is distinct from 'https://a.example/kept' then raise exception 'lab_preset: an existing link must be kept, got %', v; end if;
  select wcia_json_url into v from public.lab_results where id = pg_temp.kid('lab_otherdelivery');
  if v is not null then raise exception 'lab_otherdelivery: another delivery must never feed it, got %', v; end if;
  select wcia_json_url into v from public.lab_results where id = pg_temp.kid('lab_noext');
  if v is not null then raise exception 'lab_noext: no lab id = no match, got %', v; end if;
  select wcia_json_url into v from public.lab_results where id = pg_temp.kid('lab_numlink');
  if v is not null then raise exception 'lab_numlink: a non-string link is refused, got %', v; end if;
  select wcia_json_url into v from public.lab_results where id = pg_temp.kid('lab_textpayload');
  if v is not null then raise exception 'lab_textpayload: a text payload has no items, got %', v; end if;
  select wcia_json_url into v from public.lab_results where id = pg_temp.kid('lab_noitems');
  if v is not null then raise exception 'lab_noitems: non-array items, got %', v; end if;
  select wcia_json_url into v from public.lab_results where id = pg_temp.kid('lab_same_twice');
  if v is distinct from 'https://a.example/same' then raise exception 'lab_same_twice: one distinct link via two lots = filled, got %', v; end if;

  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'lab_results'
     and column_name in ('wcia_json_url', 'coa_extract_json', 'coa_extract_status', 'coa_extracted_at');
  if n <> 4 then raise exception 'expected 4 new columns, found %', n; end if;
  select data_type into v from information_schema.columns
   where table_schema = 'public' and table_name = 'lab_results' and column_name = 'coa_extract_json';
  if v <> 'jsonb' then raise exception 'coa_extract_json must be jsonb, is %', v; end if;
  select data_type into v from information_schema.columns
   where table_schema = 'public' and table_name = 'lab_results' and column_name = 'coa_extracted_at';
  if v <> 'timestamp with time zone' then raise exception 'coa_extracted_at must be timestamptz, is %', v; end if;

  -- constraints: every allowed status is accepted
  update public.lab_results set coa_extract_json = '{"version":1}', coa_extract_status = 'ok', coa_extracted_at = now() where id = pg_temp.kid('lab_ok');
  update public.lab_results set coa_extract_json = '{"version":1}', coa_extract_status = 'partial' where id = pg_temp.kid('lab_gg');
  update public.lab_results set coa_extract_json = '{"version":1}', coa_extract_status = 'failed' where id = pg_temp.kid('lab_pdf');

  begin
    update public.lab_results set coa_extract_json = '{"version":1}', coa_extract_status = 'great' where id = pg_temp.kid('lab_http');
    raise exception 'MISSED: an unknown status was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.lab_results set coa_extract_json = '[1,2]', coa_extract_status = 'ok' where id = pg_temp.kid('lab_http');
    raise exception 'MISSED: a non-object extract was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.lab_results set coa_extract_json = '{"version":1}', coa_extract_status = null where id = pg_temp.kid('lab_http');
    raise exception 'MISSED: an extract without a status was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.lab_results set coa_extract_json = null, coa_extract_status = 'ok' where id = pg_temp.kid('lab_http');
    raise exception 'MISSED: a status without an extract was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.lab_results set wcia_json_url = 'http://insecure.example/x' where id = pg_temp.kid('lab_http');
    raise exception 'MISSED: a plain-http JSON link was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.lab_results set wcia_json_url = 'javascript:alert(1)' where id = pg_temp.kid('lab_http');
    raise exception 'MISSED: a javascript: link was accepted';
  exception when check_violation then null;
  end;
  update public.lab_results set wcia_json_url = 'HTTPS://upper.example/x' where id = pg_temp.kid('lab_http');
end $$;

-- A re-run must keep a stored read and never overwrite a filled link.
\ir ../../supabase/migrations/0252_lab_coa_extract.sql
do $$
declare
  v text;
begin
  select coa_extract_status into v from public.lab_results where id = pg_temp.kid('lab_ok');
  if v is distinct from 'ok' then raise exception 're-run lost the stored read: %', v; end if;
  select wcia_json_url into v from public.lab_results where id = pg_temp.kid('lab_http');
  if v is distinct from 'HTTPS://upper.example/x' then raise exception 're-run changed a filled link: %', v; end if;
end $$;

\ir ../../supabase/rollbacks/0252_lab_coa_extract.rollback.sql
do $$
declare
  n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'lab_results'
     and column_name in ('wcia_json_url', 'coa_extract_json', 'coa_extract_status', 'coa_extracted_at');
  if n <> 0 then raise exception 'rollback left % columns', n; end if;
  select count(*) into n from pg_constraint
   where conrelid = 'public.lab_results'::regclass and conname like 'lab_results_coa_extract%';
  if n <> 0 then raise exception 'rollback left % constraints', n; end if;
  select count(*) into n from pg_constraint
   where conrelid = 'public.lab_results'::regclass and conname = 'lab_results_wcia_json_url_https_check';
  if n <> 0 then raise exception 'rollback left the https constraint'; end if;
  select count(*) into n from public.lab_results where id = (select id from k where name = 'lab_ok');
  if n <> 1 then raise exception 'rollback must keep the lab rows'; end if;
end $$;

\ir ../../supabase/migrations/0252_lab_coa_extract.sql
do $$
declare
  v text;
begin
  select wcia_json_url into v from public.lab_results where id = pg_temp.kid('lab_ok');
  if v is distinct from 'https://certs.conflabs.com/wcia/v2_1/WA-7mDLOjIpm5i3-WA-260921-006' then raise exception 're-apply after rollback did not backfill: %', v; end if;
end $$;

select 'LAB COA EXTRACT CHECK PASSED';
rollback;
