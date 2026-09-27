-- scripts/recon/attached-facts-pg-check.sql  (S08 — migration 0235)
--
-- Scenario check for 0235_attached_facts.sql against a real Postgres that
-- has every migration applied (scripts/compliance/verify-migrations-execute.ts).
-- Runs in ONE transaction that is rolled back, so it leaves no rows behind.
-- Every `assert` raises on failure. A run that prints
-- "ATTACHED FACTS CHECK PASSED" and then ROLLBACK is the all-clear.
--
--   PATH=/usr/lib/postgresql/15/bin:$PATH psql \
--     'postgres://postgres@/greenway?host=/tmp/pgsock&port=5433' \
--     -v ON_ERROR_STOP=1 -f scripts/recon/attached-facts-pg-check.sql
--
-- The expected-failure probes run inside BEGIN ... EXCEPTION blocks: each
-- asserts that the constraint or trigger fires, with the exact SQLSTATE or
-- message, and that a VALID row just beside it is accepted. A check that
-- rejects everything would fail the accept half.
begin;

do $$
declare
  n        int;
  v_id     uuid;
  v_other  uuid;
  plan     text;
  r        record;
  src      text;
  raised   boolean;
begin
  -- 1. Draft columns: jsonb, nullable, NO default (NULL = never attached).
  for r in select * from (values ('attached_facts'), ('attached_facts_provenance')) as t(col) loop
    select count(*) into n from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'catalog_product_drafts'
       and c.column_name = r.col and c.data_type = 'jsonb'
       and c.is_nullable = 'YES' and c.column_default is null;
    assert n = 1, format('catalog_product_drafts.%s must be nullable jsonb with no default', r.col);
    assert col_description('public.catalog_product_drafts'::regclass,
             (select attnum from pg_attribute where attrelid = 'public.catalog_product_drafts'::regclass and attname = r.col))
           like '0235 / S08:%', format('%s must carry its doctrine comment', r.col);
  end loop;

  -- 2. Table shape, exactly the spec's columns and types.
  for r in
    select * from (values
      ('id','uuid','NO'), ('identity_key','text','NO'), ('kb_product_id','uuid','YES'),
      ('draft_id','uuid','YES'), ('lot_id','uuid','YES'), ('pos_product_key','text','YES'),
      ('field','text','NO'), ('value_json','jsonb','YES'), ('source','text','NO'),
      ('confidence','numeric','YES'), ('source_urls','ARRAY','YES'), ('actor_id','uuid','YES'),
      ('created_at','timestamp with time zone','NO')
    ) as t(col, typ, nul)
  loop
    select count(*) into n from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'product_fact_provenance'
       and c.column_name = r.col and c.data_type = r.typ and c.is_nullable = r.nul;
    assert n = 1, format('product_fact_provenance.%s must be %s nullable=%s', r.col, r.typ, r.nul);
  end loop;
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'product_fact_provenance';
  assert n = 13, format('product_fact_provenance must have exactly 13 columns, has %s', n);

  -- 3. No foreign keys at all (kept table; stamps not links).
  select count(*) into n from pg_constraint
   where conrelid = 'public.product_fact_provenance'::regclass and contype = 'f';
  assert n = 0, 'product_fact_provenance must declare no foreign keys';

  -- 4. RLS on, no policy, no grants to anon/authenticated.
  assert (select relrowsecurity from pg_class where oid = 'public.product_fact_provenance'::regclass),
    'RLS must be enabled';
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'product_fact_provenance';
  assert n = 0, 'no RLS policy may exist (service role only)';
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'product_fact_provenance'
     and grantee in ('anon', 'authenticated');
  assert n = 0, 'anon/authenticated must hold no privileges';

  -- 5. Every allowed source is accepted (the SQL half of the TS parity test).
  foreach src in array array['manifest','coa','kb_published','kb_draft','gemini','human','remembered','cultivera'] loop
    insert into public.product_fact_provenance (identity_key, field, value_json, source, confidence)
    values ('acme|flower|blue dream', 'description', to_jsonb('v-' || src), src, 0.9);
  end loop;
  select count(*) into n from public.product_fact_provenance where identity_key = 'acme|flower|blue dream';
  assert n = 8, 'all 8 sources must insert';

  -- 6. An invalid source is REJECTED by the check constraint (spec test 2).
  foreach src in array array['ai','Gemini','GEMINI',' gemini','kb','',  'openai'] loop
    raised := false;
    begin
      insert into public.product_fact_provenance (identity_key, field, source) values ('acme|flower|x', 'description', src);
    exception when check_violation then
      raised := true;
      get stacked diagnostics plan = constraint_name;
      assert plan = 'pfp_source_known', format('source %L rejected by the wrong constraint %s', src, plan);
    end;
    assert raised, format('invalid source %L must be rejected', src);
  end loop;
  raised := false;
  begin
    insert into public.product_fact_provenance (identity_key, field, source) values ('acme|flower|x', 'description', null);
  exception when not_null_violation then raised := true;
  end;
  assert raised, 'NULL source must be rejected';

  -- 7. Blank identity, bad field keys and out-of-range confidence are rejected.
  for r in
    select * from (values
      ('', 'description', '0.5', 'pfp_identity_not_blank'),
      ('   ', 'description', '0.5', 'pfp_identity_not_blank'),
      ('acme|flower|x', 'Description', '0.5', 'pfp_field_key'),
      ('acme|flower|x', 'desc ription', '0.5', 'pfp_field_key'),
      ('acme|flower|x', '1description', '0.5', 'pfp_field_key'),
      ('acme|flower|x', '', '0.5', 'pfp_field_key'),
      ('acme|flower|x', 'description', '95', 'pfp_confidence_unit'),
      ('acme|flower|x', 'description', '1.01', 'pfp_confidence_unit'),
      ('acme|flower|x', 'description', '-0.01', 'pfp_confidence_unit')
    ) as t(ik, fld, conf, con)
  loop
    raised := false;
    begin
      insert into public.product_fact_provenance (identity_key, field, source, confidence)
      values (r.ik, r.fld, 'gemini', r.conf::numeric);
    exception when check_violation then
      raised := true;
      get stacked diagnostics plan = constraint_name;
      assert plan = r.con, format('(%L,%L,%s) rejected by %s, expected %s', r.ik, r.fld, r.conf, plan, r.con);
    end;
    assert raised, format('(%L,%L,%s) must be rejected by %s', r.ik, r.fld, r.conf, r.con);
  end loop;
  -- ...and the boundaries just inside are accepted.
  insert into public.product_fact_provenance (identity_key, field, source, confidence)
  values ('acme|flower|edge', 'short_description', 'gemini', 0),
         ('acme|flower|edge', 'thc_pct', 'coa', 1),
         ('acme|flower|edge', 'terpenes', 'human', null);

  -- 8. Defaults: id and created_at are filled; created_at can not be NULL.
  insert into public.product_fact_provenance (identity_key, field, source)
  values ('acme|flower|defaults', 'lineage', 'human') returning id into v_id;
  assert v_id is not null, 'id default';
  assert (select created_at from public.product_fact_provenance where id = v_id) is not null, 'created_at default';
  raised := false;
  begin
    insert into public.product_fact_provenance (identity_key, field, source, created_at)
    values ('acme|flower|defaults', 'lineage', 'human', null);
  exception when not_null_violation then raised := true;
  end;
  assert raised, 'explicit NULL created_at must be rejected';

  -- 9. APPEND-ONLY: update and delete raise PROVENANCE_IMMUTABLE.
  raised := false;
  begin
    update public.product_fact_provenance set confidence = 0.1 where id = v_id;
  exception when raise_exception then
    raised := true;
    get stacked diagnostics plan = message_text;
    assert plan like 'PROVENANCE_IMMUTABLE:%', 'update must raise PROVENANCE_IMMUTABLE, got ' || plan;
  end;
  assert raised, 'UPDATE must be refused';
  raised := false;
  begin
    delete from public.product_fact_provenance where id = v_id;
  exception when raise_exception then raised := true;
  end;
  assert raised, 'DELETE must be refused';
  assert exists (select 1 from public.product_fact_provenance where id = v_id), 'row survives the refused delete';
  -- A no-row update is not an attack; a row-level trigger does not fire.
  update public.product_fact_provenance set confidence = 0.1 where false;

  -- 10. The recall pattern: latest row per (identity, field) wins, via the index.
  insert into public.product_fact_provenance (identity_key, field, value_json, source, confidence, created_at)
  values ('acme|flower|recall', 'description', '"old"', 'gemini', 0.7, now() - interval '2 days'),
         ('acme|flower|recall', 'description', '"new"', 'human',  null, now() - interval '1 day');
  assert (select value_json #>> '{}' from public.product_fact_provenance
           where identity_key = 'acme|flower|recall' and field = 'description'
           order by created_at desc limit 1) = 'new', 'newest row wins the recall';

  select indexdef into plan from pg_indexes where schemaname = 'public' and indexname = 'idx_pfp_identity';
  assert plan like '%(identity_key, field, created_at DESC)%', 'idx_pfp_identity shape: ' || coalesce(plan, 'missing');

  -- 11. Drafts take attached facts; NULL stays distinct from {}; the raw
  --     manifest columns are untouched by an attach write.
  insert into public.catalog_product_drafts (pos_product_key, source_item_id, name, status, identity_key)
    values ('LOT-0235', 'LOT-0235', 'Acme Blue Dream 3.5g', 'draft', 'acme|flower|blue dream')
    returning id into v_other;
  assert (select attached_facts is null and attached_facts_provenance is null
            from public.catalog_product_drafts where id = v_other), 'a new draft starts with NULL facts';
  update public.catalog_product_drafts
     set attached_facts = '{"description":{"value":"Sweet berry nose.","source":"gemini","confidence":0.95,"at":"2026-01-01T00:00:00Z"}}',
         attached_facts_provenance = '{"description":{"source":"gemini","confidence":0.95,"at":"2026-01-01T00:00:00Z","by":null,"urls":["https://a.example"]}}'
   where id = v_other;
  assert (select attached_facts #>> '{description,value}' from public.catalog_product_drafts where id = v_other) = 'Sweet berry nose.',
    'attached_facts round-trips';
  assert (select name = 'Acme Blue Dream 3.5g' and pos_product_key = 'LOT-0235'
            from public.catalog_product_drafts where id = v_other), 'raw manifest columns untouched';
  update public.catalog_product_drafts set attached_facts = '{}' where id = v_other;
  assert (select attached_facts = '{}'::jsonb from public.catalog_product_drafts where id = v_other), '{} is stored as {}, not NULL';

  -- 12. A provenance row may name a draft that is later deleted (a stamp,
  --     not a link): deleting the draft succeeds and the history stays.
  insert into public.product_fact_provenance (identity_key, draft_id, field, source, confidence)
    values ('acme|flower|blue dream', v_other, 'description', 'gemini', 0.95);
  delete from public.catalog_product_drafts where id = v_other;
  assert (select count(*) from public.product_fact_provenance where draft_id = v_other) = 1,
    'history survives the draft being deleted';

  -- 13. The planner can use idx_pfp_identity for the recall query, including
  --     the ORDER BY (seqscan off so a tiny table cannot hide a bad index).
  set local enable_seqscan = off;
  --     (EXECUTE ... INTO keeps only the FIRST plan line - here "Limit" - so
  --     every line is collected before matching.)
  plan := '';
  for r in execute 'explain select value_json from public.product_fact_provenance where identity_key = ''x'' and field = ''description'' order by created_at desc limit 1' loop
    plan := plan || r."QUERY PLAN" || E'\n';
  end loop;
  assert plan not ilike '%Sort%', 'recall needs no sort (index order serves ORDER BY): ' || plan;
  assert plan ilike '%idx_pfp_identity%', 'recall uses idx_pfp_identity: ' || plan;
end
$$;

-- 14. TRUNCATE is refused too.
do $$
declare raised boolean := false;
begin
  begin
    execute 'truncate public.product_fact_provenance';
  exception when raise_exception then raised := true;
  end;
  assert raised, 'TRUNCATE must be refused';
  raise notice 'ATTACHED FACTS CHECK PASSED';
end
$$;

rollback;
