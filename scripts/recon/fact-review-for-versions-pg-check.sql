-- scripts/recon/fact-review-for-versions-pg-check.sql  (S30 - migration 0237)
--
-- Scenario check for 0237_fact_review_for_versions.sql against a real Postgres
-- 15 that has every migration applied (scripts/compliance/verify-migrations-execute.ts).
-- Runs in ONE transaction that is rolled back, so it leaves no rows behind.
-- A run that prints "FACT REVIEW FOR VERSIONS CHECK PASSED" and then ROLLBACK
-- is the all-clear.
--
--   psql -h localhost -U postgres -d greenway -v ON_ERROR_STOP=1 \
--     -f scripts/recon/fact-review-for-versions-pg-check.sql
--
-- Part 1  a receiving decision (manifest scope, no import) is accepted.
-- Part 2  the upsert target the app uses (manifest_id, source_item_id) exists
--         and on conflict updates the one row (latest wins).
-- Part 3  one scope only: both scopes, or neither, are refused by name.
-- Part 4  import-scoped rows (the 0139 path) still work and never collide
--         with each other through the new key (NULLs are distinct).
-- Part 5  deleting the delivery deletes its decisions (cascade), deleting
--         the draft keeps the decision with draft_id null.
-- Part 6  0237 re-applied twice is a no-op (idempotent).
-- Part 7  the rollback file restores import_id NOT NULL and removes the
--         columns, then 0237 re-applies cleanly.
begin;

insert into public.inbound_manifests (id, manifest_number)
  values ('00000000-0000-4000-8000-00000000a001', 'S30-PG-1');
insert into public.catalog_product_drafts (id, manifest_id, name, status)
  values ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000a001', 'Gummies 100mg', 'approved');
insert into public.pos_imports (id, status)
  values ('00000000-0000-4000-8000-00000000b001', 'staged');

-- Part 1
insert into public.pos_fact_reviews (manifest_id, draft_id, source_item_id, action, flag_signature)
  values ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000d001', 'LOT-1', 'approve', 'sigA');
do $p1$ begin
  assert (select count(*) from public.pos_fact_reviews where manifest_id = '00000000-0000-4000-8000-00000000a001') = 1, 'part1: receiving decision stored';
  assert (select import_id from public.pos_fact_reviews where source_item_id = 'LOT-1') is null, 'part1: import_id null';
end $p1$;

-- Part 2
insert into public.pos_fact_reviews (manifest_id, source_item_id, action, flag_signature)
  values ('00000000-0000-4000-8000-00000000a001', 'LOT-1', 'reject', 'sigB')
  on conflict (manifest_id, source_item_id) do update set action = excluded.action, flag_signature = excluded.flag_signature;
do $p2$ begin
  assert (select count(*) from public.pos_fact_reviews where source_item_id = 'LOT-1') = 1, 'part2: still one row';
  assert (select action from public.pos_fact_reviews where source_item_id = 'LOT-1') = 'reject', 'part2: latest wins';
  assert (select flag_signature from public.pos_fact_reviews where source_item_id = 'LOT-1') = 'sigB', 'part2: signature updated';
end $p2$;

-- Part 3
do $p3$ begin
  begin
    insert into public.pos_fact_reviews (import_id, manifest_id, source_item_id, action)
      values ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000a001', 'LOT-2', 'approve');
    raise exception 'part3: both scopes accepted';
  exception when check_violation then
    assert sqlerrm like '%pos_fact_reviews_one_scope%', 'part3: named constraint (both)';
  end;
  begin
    insert into public.pos_fact_reviews (source_item_id, action) values ('LOT-3', 'approve');
    raise exception 'part3: no scope accepted';
  exception when check_violation then
    assert sqlerrm like '%pos_fact_reviews_one_scope%', 'part3: named constraint (neither)';
  end;
end $p3$;

-- Part 4
insert into public.pos_fact_reviews (import_id, source_item_id, action)
  values ('00000000-0000-4000-8000-00000000b001', 'pos-a', 'approve'),
         ('00000000-0000-4000-8000-00000000b001', 'pos-b', 'approve');
insert into public.pos_fact_reviews (import_id, source_item_id, action)
  values ('00000000-0000-4000-8000-00000000b001', 'pos-a', 'fix')
  on conflict (import_id, source_item_id) do update set action = excluded.action;
do $p4$ begin
  assert (select count(*) from public.pos_fact_reviews where import_id is not null) = 2, 'part4: two import rows';
  assert (select action from public.pos_fact_reviews where source_item_id = 'pos-a') = 'fix', 'part4: 0139 upsert still works';
end $p4$;

-- Part 5
delete from public.catalog_product_drafts where id = '00000000-0000-4000-8000-00000000d001';
do $p5a$ begin
  assert (select draft_id from public.pos_fact_reviews where source_item_id = 'LOT-1') is null, 'part5: draft delete sets null';
end $p5a$;
delete from public.inbound_manifests where id = '00000000-0000-4000-8000-00000000a001';
do $p5b$ begin
  assert (select count(*) from public.pos_fact_reviews where source_item_id = 'LOT-1') = 0, 'part5: delivery delete cascades';
end $p5b$;

-- Part 6
\ir ../../supabase/migrations/0237_fact_review_for_versions.sql
\ir ../../supabase/migrations/0237_fact_review_for_versions.sql
do $p6$ begin
  assert (select count(*) from pg_constraint where conname = 'pos_fact_reviews_one_scope') = 1, 'part6: one check';
  assert (select count(*) from pg_constraint where conname = 'pos_fact_reviews_manifest_item_key') = 1, 'part6: one unique';
end $p6$;

-- Part 7
\ir ../../supabase/rollbacks/0237_fact_review_for_versions.rollback.sql
do $p7$ begin
  assert (select is_nullable from information_schema.columns
           where table_schema = 'public' and table_name = 'pos_fact_reviews' and column_name = 'import_id') = 'NO', 'part7: import_id not null again';
  assert not exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'pos_fact_reviews' and column_name in ('manifest_id', 'draft_id', 'flag_signature')), 'part7: columns gone';
  assert (select count(*) from public.pos_fact_reviews) = 2, 'part7: import rows kept';
end $p7$;
\ir ../../supabase/migrations/0237_fact_review_for_versions.sql
do $p7b$ begin
  assert (select count(*) from pg_constraint where conname = 'pos_fact_reviews_manifest_item_key') = 1, 'part7: re-applied';
end $p7b$;

select 'FACT REVIEW FOR VERSIONS CHECK PASSED' as result;
rollback;
