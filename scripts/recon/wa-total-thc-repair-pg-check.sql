-- scripts/recon/wa-total-thc-repair-pg-check.sql  (R27 - migration 0251)
--
-- Scenario check for 0251_wa_total_thc_cbd_repair.sql against a REAL
-- Postgres with every migration 0001..0251 applied (the
-- verify-migrations-execute.ts database). ONE transaction, rolled back.
--
-- Seeds one row per edge case, applies 0251 TWICE (idempotency), asserts
-- every outcome, applies the ROLLBACK and asserts the BEFORE values are back
-- (and a later edit is kept), then re-applies 0251. A run that prints
-- WA TOTAL THC REPAIR CHECK PASSED then ROLLBACK is the all-clear.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/wa-total-thc-repair-pg-check.sql
begin;

-- Start from a clean audit slate for this migration (the runner applied it).
delete from public.audit_logs where actor_email = 'migration:0251';

create temp table k (name text primary key, id uuid not null default gen_random_uuid()) on commit drop;
insert into k (name) values
  ('lab_apple'), ('lab_ok'), ('lab_noreport'), ('lab_string'), ('lab_neg'), ('lab_cbd_only'), ('lab_thc_only'), ('lab_nulljson'),
  ('d_apple'), ('d_apple_edited'), ('d_ok'), ('d_other'),
  ('kb_apple'), ('kb_apple_curated'), ('kb_other');
create or replace function pg_temp.kid(n text) returns uuid language sql stable as $$ select id from k where name = n $$;

-- lab_apple: the owner's Apple Cardamom - total = total-cannabinoids, cbd total = cbd (both wrong for THC; CBD equal here)
-- lab_ok: already right -> untouched
-- lab_noreport: no total-thc key -> untouched (no formula applied)
-- lab_string: total-thc is a STRING -> untouched (only JSON numbers)
-- lab_neg: negative reported -> untouched
-- lab_cbd_only: only total-cbd reported and differs -> CBD repaired, THC kept
-- lab_thc_only: only total-thc reported and differs -> THC repaired, CBD kept
-- lab_nulljson: potency_json null -> untouched
insert into public.lab_results (id, total_thc_pct, total_cbd_pct, potency_json) values
  (pg_temp.kid('lab_apple'),    0.7045, 0.4589, '{"thc":0.2456,"cbd":0.4589,"total-thc":0.2456,"total-cbd":0.4589,"total-cannabinoids":0.7045}'),
  (pg_temp.kid('lab_ok'),       26.67554, 0.05942, '{"thca":30.1,"total-thc":26.67554,"total-cbd":0.05942,"total-cannabinoids":31}'),
  (pg_temp.kid('lab_noreport'), 27.4, 0.1, '{"thc":0.9,"thca":25.3,"cbd":0.1,"total-cannabinoids":27.4}'),
  (pg_temp.kid('lab_string'),   9.9, null, '{"total-thc":"1.5"}'),
  (pg_temp.kid('lab_neg'),      9.9, null, '{"total-thc":-1}'),
  (pg_temp.kid('lab_cbd_only'), 20, 0.5, '{"cbd":0.5,"cbda":10,"total-cbd":9.27}'),
  (pg_temp.kid('lab_thc_only'), 30, 0.7, '{"thca":30,"total-thc":26.31}'),
  (pg_temp.kid('lab_nulljson'), 5, 5, null);

insert into public.catalog_product_drafts (id, pos_product_key, name, status, lab_result_id, total_thc_pct) values
  (pg_temp.kid('d_apple'),        'K-APPLE',  'Apple Cardamom',  'approved', pg_temp.kid('lab_apple'), 0.7045),
  (pg_temp.kid('d_apple_edited'), 'K-APPLE2', 'Apple Cardamom 2', 'draft',    pg_temp.kid('lab_apple'), 0.5),
  (pg_temp.kid('d_ok'),           'K-OK',     'OK',              'draft',    pg_temp.kid('lab_ok'),    26.67554),
  (pg_temp.kid('d_other'),        'K-NR',     'No report',       'draft',    pg_temp.kid('lab_noreport'), 27.4);

insert into public.kb_products (id, brand_slug, product_slug, display_name, total_thc_pct, total_cbd_pct, potency_source) values
  (pg_temp.kid('kb_apple'),         'b', 'apple',   'Apple',   0.7045, 0.4589, 'lab_results:' || pg_temp.kid('lab_apple')),
  (pg_temp.kid('kb_apple_curated'), 'b', 'apple-c', 'Apple C', 0.3,    0.4589, 'lab_results:' || pg_temp.kid('lab_apple')),
  (pg_temp.kid('kb_other'),         'b', 'other',   'Other',   0.7045, 0.4589, 'curated');

\ir ../../supabase/migrations/0251_wa_total_thc_cbd_repair.sql
\ir ../../supabase/migrations/0251_wa_total_thc_cbd_repair.sql

do $$
declare
  n int;
  v numeric;
  c numeric;
begin
  select total_thc_pct, total_cbd_pct into v, c from public.lab_results where id = pg_temp.kid('lab_apple');
  if v is distinct from 0.2456 or c is distinct from 0.4589 then raise exception 'lab_apple not repaired: % %', v, c; end if;
  select total_thc_pct into v from public.lab_results where id = pg_temp.kid('lab_ok');
  if v is distinct from 26.67554 then raise exception 'lab_ok changed'; end if;
  select total_thc_pct into v from public.lab_results where id = pg_temp.kid('lab_noreport');
  if v is distinct from 27.4 then raise exception 'lab_noreport changed (no formula may be applied)'; end if;
  select total_thc_pct into v from public.lab_results where id = pg_temp.kid('lab_string');
  if v is distinct from 9.9 then raise exception 'string total applied'; end if;
  select total_thc_pct into v from public.lab_results where id = pg_temp.kid('lab_neg');
  if v is distinct from 9.9 then raise exception 'negative total applied'; end if;
  select total_thc_pct, total_cbd_pct into v, c from public.lab_results where id = pg_temp.kid('lab_cbd_only');
  if v is distinct from 20 or c is distinct from 9.27 then raise exception 'lab_cbd_only wrong: % %', v, c; end if;
  select total_thc_pct, total_cbd_pct into v, c from public.lab_results where id = pg_temp.kid('lab_thc_only');
  if v is distinct from 26.31 or c is distinct from 0.7 then raise exception 'lab_thc_only wrong: % %', v, c; end if;
  select total_thc_pct into v from public.lab_results where id = pg_temp.kid('lab_nulljson');
  if v is distinct from 5 then raise exception 'null json changed'; end if;

  select total_thc_pct into v from public.catalog_product_drafts where id = pg_temp.kid('d_apple');
  if v is distinct from 0.2456 then raise exception 'd_apple not repaired: %', v; end if;
  select total_thc_pct into v from public.catalog_product_drafts where id = pg_temp.kid('d_apple_edited');
  if v is distinct from 0.5 then raise exception 'edited draft overwritten'; end if;
  select total_thc_pct into v from public.catalog_product_drafts where id = pg_temp.kid('d_other');
  if v is distinct from 27.4 then raise exception 'unrelated draft changed'; end if;

  select total_thc_pct, total_cbd_pct into v, c from public.kb_products where id = pg_temp.kid('kb_apple');
  if v is distinct from 0.2456 or c is distinct from 0.4589 then raise exception 'kb_apple not repaired: % %', v, c; end if;
  select total_thc_pct into v from public.kb_products where id = pg_temp.kid('kb_apple_curated');
  if v is distinct from 0.3 then raise exception 'curated kb overwritten'; end if;
  select total_thc_pct into v from public.kb_products where id = pg_temp.kid('kb_other');
  if v is distinct from 0.7045 then raise exception 'kb with another source changed'; end if;

  -- audit: one per changed row, idempotent (second apply wrote nothing)
  select count(*) into n from public.audit_logs where actor_email = 'migration:0251' and action = 'migration_0251.lab_total_repair';
  if n is distinct from 3 then raise exception 'expected 3 lab audit rows, got %', n; end if;
  select count(*) into n from public.audit_logs where actor_email = 'migration:0251' and action = 'migration_0251.draft_total_repair';
  if n is distinct from 1 then raise exception 'expected 1 draft audit row, got %', n; end if;
  select count(*) into n from public.audit_logs where actor_email = 'migration:0251' and action = 'migration_0251.kb_total_repair';
  if n is distinct from 1 then raise exception 'expected 1 kb audit row, got %', n; end if;
end $$;

-- A later human edit on the repaired draft must survive the rollback.
update public.catalog_product_drafts set total_thc_pct = 0.25 where id = pg_temp.kid('d_apple');

\ir ../../supabase/rollbacks/0251_wa_total_thc_cbd_repair.rollback.sql

do $$
declare
  n int;
  v numeric;
  c numeric;
begin
  select total_thc_pct, total_cbd_pct into v, c from public.lab_results where id = pg_temp.kid('lab_apple');
  if v is distinct from 0.7045 or c is distinct from 0.4589 then raise exception 'rollback lab_apple: % %', v, c; end if;
  select total_thc_pct, total_cbd_pct into v, c from public.lab_results where id = pg_temp.kid('lab_cbd_only');
  if v is distinct from 20 or c is distinct from 0.5 then raise exception 'rollback lab_cbd_only: % %', v, c; end if;
  select total_thc_pct, total_cbd_pct into v, c from public.lab_results where id = pg_temp.kid('lab_thc_only');
  if v is distinct from 30 or c is distinct from 0.7 then raise exception 'rollback lab_thc_only: % %', v, c; end if;
  select total_thc_pct into v from public.catalog_product_drafts where id = pg_temp.kid('d_apple');
  if v is distinct from 0.25 then raise exception 'rollback undid a later edit: %', v; end if;
  select total_thc_pct into v from public.kb_products where id = pg_temp.kid('kb_apple');
  if v is distinct from 0.7045 then raise exception 'rollback kb_apple: %', v; end if;
  select count(*) into n from public.audit_logs where actor_email = 'migration:0251';
  if n is distinct from 0 then raise exception 'rollback left audit rows'; end if;
end $$;

-- Re-apply after rollback works.
\ir ../../supabase/migrations/0251_wa_total_thc_cbd_repair.sql
do $$
declare v numeric;
begin
  select total_thc_pct into v from public.lab_results where id = pg_temp.kid('lab_apple');
  if v is distinct from 0.2456 then raise exception 're-apply failed'; end if;
  raise notice 'WA TOTAL THC REPAIR CHECK PASSED';
end $$;

rollback;
