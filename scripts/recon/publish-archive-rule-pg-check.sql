-- scripts/recon/publish-archive-rule-pg-check.sql  (S15 - migration 0236)
--
-- Scenario check for 0236_publish_archive_rule.sql against a real Postgres
-- 15 that has every migration applied (scripts/compliance/verify-migrations-execute.ts).
-- Runs in ONE transaction that is rolled back, so it leaves no rows behind.
-- Every `assert` raises on failure. A run that prints
-- "PUBLISH ARCHIVE RULE CHECK PASSED" and then ROLLBACK is the all-clear.
--
--   PGPASSWORD=postgres psql -h localhost -U postgres -d greenway \
--     -v ON_ERROR_STOP=1 -f scripts/recon/publish-archive-rule-pg-check.sql
--
-- It proves BOTH directions, so it cannot pass by accident:
--   Part 1  the 0236 rule: one mixed sequence (POS import + receiving updates)
--           leaves ZERO stale staged rows, keeps newer ones, records why.
--   Part 2  an unknown id raises and the live menu is untouched.
--   Part 3  clean_slate restores a version that really was live, never a
--           staged update that was archived without ever being published.
--   Part 4  grants: anon and authenticated cannot execute either function.
--   Part 5  the ROLLBACK file really restores the old behaviour (receiving
--           updates are NOT archived by an import-less publish, and
--           clean_slate picks the never-live row) - the bug 0236 fixes is
--           real, not assumed. Then 0236 is re-applied twice (idempotent)
--           and the Part 1 rule holds again.
--
-- Timestamps are explicit because now() is constant inside one transaction.
begin;

-- Fixed ids so later blocks can refer to rows created by earlier ones.
--   L  = live menu before the test (published)
--   I1 = POS import behind version A
--   A  = POS import update, staged, created t1
--   D  = receiving update whose summary_json is NOT an object, created t1.5
--   B  = receiving update (import_id null), staged, created t2  -> published
--   C  = receiving update, staged, created t4 (NEWER than B)    -> must stay
--   T  = receiving update created at the SAME instant as B      -> must stay

create or replace function pg_temp.seed() returns void language plpgsql as $f$
begin
  delete from public.menu_versions;
  delete from public.pos_imports;
  insert into public.pos_imports (id, status, created_at)
    values ('11111111-0000-0000-0000-000000000001', 'staged', timestamptz '2026-01-01 10:00+00'),
           ('11111111-0000-0000-0000-000000000002', 'staged', timestamptz '2026-01-01 15:00+00');
  insert into public.menu_versions (id, import_id, status, summary_json, published_at, created_at)
    values
    ('aaaaaaaa-0000-0000-0000-00000000000f', null, 'published', '{"origin":"seed"}',
       timestamptz '2026-01-01 09:00+00', timestamptz '2026-01-01 09:00+00'),
    ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', 'staged', null,
       null, timestamptz '2026-01-01 10:00+00'),
    ('aaaaaaaa-0000-0000-0000-00000000000d', null, 'staged', '["legacy-array"]',
       null, timestamptz '2026-01-01 10:30+00'),
    ('aaaaaaaa-0000-0000-0000-00000000000b', null, 'staged', '{"origin":"intake","manifest":"m1"}',
       null, timestamptz '2026-01-01 11:00+00'),
    ('aaaaaaaa-0000-0000-0000-00000000000c', null, 'staged', '{"origin":"intake","manifest":"m2"}',
       null, timestamptz '2026-01-01 13:00+00'),
    ('aaaaaaaa-0000-0000-0000-000000000077', null, 'staged', '{"origin":"intake","manifest":"tie"}',
       null, timestamptz '2026-01-01 11:00+00');
end
$f$;

-- The Part 1 assertions, reused after the re-apply in Part 5.
create or replace function pg_temp.assert_rule() returns void language plpgsql as $f$
declare
  r record;
  n int;
begin
  perform pg_temp.seed();

  -- Publish the RECEIVING update B (import_id null). Under 0002 this archived
  -- nothing staged at all.
  perform public.publish_menu_version('aaaaaaaa-0000-0000-0000-00000000000b', null);

  select status, published_at is not null as stamped into r
    from public.menu_versions where id = 'aaaaaaaa-0000-0000-0000-00000000000b';
  assert r.status = 'published' and r.stamped, 'B must be published and stamped';

  select status, summary_json into r
    from public.menu_versions where id = 'aaaaaaaa-0000-0000-0000-00000000000f';
  assert r.status = 'archived', 'the previous live menu L must be archived';
  assert r.summary_json = '{"origin":"seed"}'::jsonb,
    'the previous LIVE version is archived by the swap, not superseded - its summary must be untouched';

  -- A: POS import update, OLDER than B -> archived with the reason.
  select status, summary_json into r
    from public.menu_versions where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  assert r.status = 'archived', 'older POS import update A must be archived by a receiving publish';
  assert r.summary_json ->> 'archived_reason' = 'superseded_by_publish:aaaaaaaa-0000-0000-0000-00000000000b',
    format('A must record the reason, got %s', r.summary_json);
  assert r.summary_json ? 'archived_at', 'A must record archived_at';

  -- D: non-object summary is preserved under summary_before_archive.
  select status, summary_json into r
    from public.menu_versions where id = 'aaaaaaaa-0000-0000-0000-00000000000d';
  assert r.status = 'archived', 'older receiving update D must be archived';
  assert r.summary_json -> 'summary_before_archive' = '["legacy-array"]'::jsonb,
    format('D must keep its old summary, got %s', r.summary_json);
  assert r.summary_json ->> 'archived_reason' like 'superseded_by_publish:%', 'D must record the reason';

  -- C: NEWER than B -> left staged, summary untouched.
  select status, summary_json into r
    from public.menu_versions where id = 'aaaaaaaa-0000-0000-0000-00000000000c';
  assert r.status = 'staged', 'NEWER receiving update C must stay staged';
  assert not (r.summary_json ? 'archived_reason'), 'C must not be marked';

  -- T: created at EXACTLY the same instant as B -> not provably older, kept.
  select status into r from public.menu_versions where id = 'aaaaaaaa-0000-0000-0000-000000000077';
  assert r.status = 'staged', 'a staged update created at the same instant as B must stay staged (strictly older only)';

  -- pos_imports of A is NOT stamped published (only the target import is).
  select status into r from public.pos_imports where id = '11111111-0000-0000-0000-000000000001';
  assert r.status = 'staged', 'publishing B must not stamp import I1';

  -- Now a POS import update E, newer than C, is published: C must go, and
  -- import I2 is stamped.
  insert into public.menu_versions (id, import_id, status, created_at)
    values ('aaaaaaaa-0000-0000-0000-00000000000e', '11111111-0000-0000-0000-000000000002', 'staged',
            timestamptz '2026-01-01 15:00+00');
  perform public.publish_menu_version('aaaaaaaa-0000-0000-0000-00000000000e', null);

  select status, summary_json into r
    from public.menu_versions where id = 'aaaaaaaa-0000-0000-0000-00000000000c';
  assert r.status = 'archived', 'receiving update C, older than import update E, must be archived';
  assert r.summary_json ->> 'archived_reason' = 'superseded_by_publish:aaaaaaaa-0000-0000-0000-00000000000e',
    format('C must name E, got %s', r.summary_json);
  assert r.summary_json ->> 'manifest' = 'm2', 'C must keep its own summary keys';

  select status into r from public.pos_imports where id = '11111111-0000-0000-0000-000000000002';
  assert r.status = 'published', 'import I2 must be stamped published';

  -- The acceptance line of S15: after the mixed sequence, zero stale staged rows.
  select count(*) into n from public.menu_versions where status = 'staged';
  assert n = 0, format('after the mixed sequence no staged row may remain, found %s', n);
  select count(*) into n from public.menu_versions where status = 'published';
  assert n = 1, 'exactly one published version';
end
$f$;

-- ---------------------------------------------------------------- Part 1
do $$
declare
  src text;
  sd  boolean;
begin
  select prosrc, prosecdef into src, sd from pg_proc
   where oid = 'public.publish_menu_version(uuid,uuid)'::regprocedure;
  assert sd, 'publish_menu_version must stay SECURITY DEFINER';
  assert src like '%superseded_by_publish:%', '0236 body must be installed';
  assert obj_description('public.publish_menu_version(uuid,uuid)'::regprocedure, 'pg_proc') like '0236 / S15:%',
    'publish_menu_version must carry its 0236 comment';
  assert obj_description('public.clean_slate_test_data()'::regprocedure, 'pg_proc') like '0236 / S15%',
    'clean_slate_test_data must carry its 0236 comment';
  perform pg_temp.assert_rule();
  raise notice 'part 1 ok - one rule, both origins, newer kept, reason recorded';
end $$;

-- ---------------------------------------------------------------- Part 2
do $$
declare
  raised boolean := false;
  st     text;
  n      int;
begin
  -- E is live from Part 1.
  begin
    perform public.publish_menu_version('00000000-0000-0000-0000-00000000dead', null);
  exception when others then
    raised := true;
    get stacked diagnostics st = returned_sqlstate;
    assert st = 'P0002', format('unknown id must raise P0002, got %s', st);
    assert sqlerrm like 'PUBLISH_VERSION_NOT_FOUND:%', format('message was %s', sqlerrm);
  end;
  assert raised, 'publishing an unknown id must raise';
  select count(*) into n from public.menu_versions
   where status = 'published' and id = 'aaaaaaaa-0000-0000-0000-00000000000e';
  assert n = 1, 'the live menu must be untouched after an unknown id';
  raise notice 'part 2 ok - unknown id raises P0002, live menu intact';
end $$;

-- ---------------------------------------------------------------- Part 3
-- E is live (real). A was archived by Part 1 WITHOUT ever being live, and the
-- set_updated_at trigger gave it the newest updated_at. Push E's published_at
-- back an hour so the old 0152 pick (coalesce(published_at, updated_at,
-- created_at)) would choose A.
create or replace function pg_temp.stage_clean_slate() returns void language plpgsql as $f$
begin
  update public.menu_versions set published_at = now() - interval '1 hour'
   where id = 'aaaaaaaa-0000-0000-0000-00000000000e';
  update public.menu_versions set summary_json = summary_json
   where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  insert into public.menu_versions (id, status, is_test, created_at)
    values ('aaaaaaaa-0000-0000-0000-0000000000ff', 'staged', true, timestamptz '2026-01-01 16:00+00');
  perform public.publish_menu_version('aaaaaaaa-0000-0000-0000-0000000000ff', null);
  update public.menu_versions set published_at = now() - interval '1 hour'
   where id = 'aaaaaaaa-0000-0000-0000-00000000000e';
  -- B was live before E - keep that order so E is the unique latest-live row.
  update public.menu_versions set published_at = now() - interval '2 hours'
   where id = 'aaaaaaaa-0000-0000-0000-00000000000b';
end
$f$;

do $$
declare
  res jsonb;
  n   int;
begin
  perform pg_temp.stage_clean_slate();
  res := public.clean_slate_test_data();
  assert res ->> 'restored_version_id' = 'aaaaaaaa-0000-0000-0000-00000000000e',
    format('clean slate must restore E (really was live), got %s', res);
  select count(*) into n from public.menu_versions
   where id = 'aaaaaaaa-0000-0000-0000-00000000000a' and status = 'archived';
  assert n = 1, 'the never-live update A must stay archived';
  raise notice 'part 3 ok - clean slate restores a version that was really live';
end $$;

-- ---------------------------------------------------------------- Part 4
do $$
begin
  assert not has_function_privilege('anon', 'public.publish_menu_version(uuid,uuid)', 'execute'),
    'anon must not execute publish_menu_version';
  assert not has_function_privilege('authenticated', 'public.publish_menu_version(uuid,uuid)', 'execute'),
    'authenticated must not execute publish_menu_version';
  assert has_function_privilege('service_role', 'public.publish_menu_version(uuid,uuid)', 'execute'),
    'service_role must execute publish_menu_version';
  assert not has_function_privilege('anon', 'public.clean_slate_test_data()', 'execute'),
    'anon must not execute clean_slate_test_data';
  assert not has_function_privilege('authenticated', 'public.clean_slate_test_data()', 'execute'),
    'authenticated must not execute clean_slate_test_data';
  assert has_function_privilege('service_role', 'public.clean_slate_test_data()', 'execute'),
    'service_role must execute clean_slate_test_data';
  raise notice 'part 4 ok - service role only';
end $$;

-- ---------------------------------------------------------------- Part 5
\ir ../../supabase/rollbacks/0236_publish_archive_rule.rollback.sql

do $$
declare
  r   record;
  res jsonb;
begin
  assert has_function_privilege('anon', 'public.publish_menu_version(uuid,uuid)', 'execute'),
    'the rollback must restore the default grants';
  perform pg_temp.seed();
  perform public.publish_menu_version('aaaaaaaa-0000-0000-0000-00000000000b', null);
  select status into r from public.menu_versions where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  assert r.status = 'staged',
    'OLD rule proof: a receiving publish left the older POS import update staged (the S15 bug)';
  select status into r from public.menu_versions where id = 'aaaaaaaa-0000-0000-0000-00000000000d';
  assert r.status = 'staged', 'OLD rule proof: older receiving update D stayed staged';

  -- Old clean_slate: rebuild the Part 3 shape and show the old pick is wrong.
  perform pg_temp.seed();
  perform public.publish_menu_version('aaaaaaaa-0000-0000-0000-00000000000b', null);
  insert into public.menu_versions (id, import_id, status, created_at)
    values ('aaaaaaaa-0000-0000-0000-00000000000e', '11111111-0000-0000-0000-000000000002', 'staged',
            timestamptz '2026-01-01 15:00+00');
  perform public.publish_menu_version('aaaaaaaa-0000-0000-0000-00000000000e', null);
  -- old rule archived A (import_id <> I2) without it ever being live
  select status, published_at into r from public.menu_versions where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  assert r.status = 'archived' and r.published_at is null, 'old rule archived A without publishing it';
  perform pg_temp.stage_clean_slate();
  res := public.clean_slate_test_data();
  assert (res ->> 'restored_version_id')::uuid in ('aaaaaaaa-0000-0000-0000-00000000000a',
      'aaaaaaaa-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-00000000000d'),
    format('OLD clean slate proof: it restored a version that was NEVER live, got %s', res);
  raise notice 'part 5a ok - rollback restores the old behaviour, so the bug is real';
end $$;

\ir ../../supabase/migrations/0236_publish_archive_rule.sql
\ir ../../supabase/migrations/0236_publish_archive_rule.sql

do $$
begin
  assert not has_function_privilege('anon', 'public.publish_menu_version(uuid,uuid)', 'execute'),
    're-applied 0236 must narrow the grants again';
  assert not has_function_privilege('anon', 'public.clean_slate_test_data()', 'execute'),
    're-applied 0236 must narrow clean_slate grants again';
  perform pg_temp.assert_rule();
  raise notice 'part 5b ok - 0236 re-applied twice, rule holds';
  raise notice 'PUBLISH ARCHIVE RULE CHECK PASSED';
end $$;

rollback;
