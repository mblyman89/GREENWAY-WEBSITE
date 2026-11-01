-- scripts/recon/cultivera-benchmark-0337-pg-check.sql  (CVB-3 - migration 0337)
--
-- Scenario check for 0337_cultivera_benchmark_archive.sql on Postgres 15 with
-- every migration applied. ONE transaction, rolled back: nothing remains.
--   * 0337 applies twice (idempotent; the two owner payback rows exist once);
--   * grants: every table is service_role only, the archive and the payback
--     ledger are append-only, benchmark days may be refreshed, never deleted;
--     nothing for anon / authenticated; RLS on; both functions service_role only;
--   * the bucket is private;
--   * registering a run stores its files; the same manifest again is "already";
--     a different manifest under the same run id is refused;
--   * benchmark days are stored; an older run never overwrites a newer day;
--   * a bad run id / sha / file name and an unknown run are refused;
--   * the payback ledger refuses a negative saving and a duplicate key.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/cultivera-benchmark-0337-pg-check.sql
--
-- "CULTIVERA BENCHMARK 0337 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/migrations/0337_cultivera_benchmark_archive.sql
\i supabase/migrations/0337_cultivera_benchmark_archive.sql

do $$
declare t text;
begin
  foreach t in array array['cultivera_archive_runs', 'cultivera_archive_files', 'cultivera_payback_entries'] loop
    assert has_table_privilege('service_role', 'public.' || t, 'SELECT'), t || ': service_role reads';
    assert has_table_privilege('service_role', 'public.' || t, 'INSERT'), t || ': service_role inserts';
    assert not has_table_privilege('service_role', 'public.' || t, 'UPDATE'), t || ': append-only (no update)';
    assert not has_table_privilege('service_role', 'public.' || t, 'DELETE'), t || ': append-only (no delete)';
  end loop;
  assert has_table_privilege('service_role', 'public.cultivera_benchmark_days', 'UPDATE'), 'days may be refreshed';
  assert not has_table_privilege('service_role', 'public.cultivera_benchmark_days', 'DELETE'), 'days never deleted';
  foreach t in array array['cultivera_archive_runs', 'cultivera_archive_files', 'cultivera_payback_entries',
                           'cultivera_benchmark_days'] loop
    assert not has_table_privilege('anon', 'public.' || t, 'SELECT'), t || ': anon cannot read';
    assert not has_table_privilege('authenticated', 'public.' || t, 'SELECT'), t || ': authenticated cannot read';
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ': RLS on';
  end loop;
  assert has_function_privilege('service_role', 'public.cvb_register_archive_run(text, timestamptz, text, uuid, jsonb)', 'EXECUTE'), 'register: service_role';
  assert not has_function_privilege('anon', 'public.cvb_register_archive_run(text, timestamptz, text, uuid, jsonb)', 'EXECUTE'), 'register: not anon';
  assert not has_function_privilege('authenticated', 'public.cvb_register_archive_run(text, timestamptz, text, uuid, jsonb)', 'EXECUTE'), 'register: not authenticated';
  assert has_function_privilege('service_role', 'public.cvb_upsert_benchmark_days(text, jsonb)', 'EXECUTE'), 'days: service_role';
  assert not has_function_privilege('anon', 'public.cvb_upsert_benchmark_days(text, jsonb)', 'EXECUTE'), 'days: not anon';
  assert not has_function_privilege('authenticated', 'public.cvb_upsert_benchmark_days(text, jsonb)', 'EXECUTE'), 'days: not authenticated';
  assert (select public = false from storage.buckets where id = 'cultivera-archive'), 'bucket is private';
  assert (select count(*) from public.cultivera_payback_entries where entry_key in ('owner-build-cost', 'owner-saving-2026-11-01')) = 2,
    'owner figures seeded once';
  assert (select sum(case kind when 'build_cost' then amount_minor else -amount_minor end)
            from public.cultivera_payback_entries
           where entry_key in ('owner-build-cost', 'owner-saving-2026-11-01')) = 3450000,
    '$40,000 - $5,500 = $34,500 remaining';
end $$;

create or replace function pg_temp.reg(run text, sha text, files jsonb) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  r := public.cvb_register_archive_run(run, '2026-11-01T20:00:00Z', sha, null, files);
  reset role;
  return r;
end $$;

create or replace function pg_temp.days(run text, rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  r := public.cvb_upsert_benchmark_days(run, rows);
  reset role;
  return r;
end $$;

do $$
declare
  r jsonb;
  files jsonb := '[{"name": "manifest.json", "bytes": 900, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "rows": null},
                   {"name": "daily_sales.p0000.jsonl.gz", "bytes": 1200, "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "rows": 2},
                   {"name": "orders.2024-08.jsonl.gz", "bytes": 5000, "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", "rows": 40}]';
  sha1 text := repeat('1', 64);
begin
  r := pg_temp.reg('20261101T200000Z-0337abcd', sha1, files);
  assert r->>'status' = 'archived', 'first register archives: ' || r::text;
  assert (r->>'files')::int = 3 and (r->>'bytes')::bigint = 7100 and (r->>'rows')::bigint = 42, 'totals: ' || r::text;
  assert (select count(*) from public.cultivera_archive_files where run_id = '20261101T200000Z-0337abcd') = 3, '3 files';
  assert (select dataset from public.cultivera_archive_files where file_name = 'orders.2024-08.jsonl.gz') = 'orders', 'dataset';
  assert (select storage_path from public.cultivera_archive_files where file_name = 'orders.2024-08.jsonl.gz')
         = '20261101T200000Z-0337abcd/orders.2024-08.jsonl.gz', 'path';

  r := pg_temp.reg('20261101T200000Z-0337abcd', sha1, files);
  assert r->>'status' = 'already', 'same manifest again is already done';
  assert (select count(*) from public.cultivera_archive_files where run_id = '20261101T200000Z-0337abcd') = 3, 'no duplicate files';

  begin
    perform pg_temp.reg('20261101T200000Z-0337abcd', repeat('2', 64), files);
    assert false, 'a different manifest under the same run id must fail';
  exception when unique_violation then null;
  end;
  begin
    perform pg_temp.reg('../etc', sha1, files);
    assert false, 'bad run id must fail';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform pg_temp.reg('20261101T200001Z-0337abcd', 'nope', files);
    assert false, 'bad sha must fail';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform pg_temp.reg('20261101T200002Z-0337abcd', sha1,
      '[{"name": "../x.json", "bytes": 1, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "rows": null}]');
    assert false, 'bad file name must fail';
  exception when check_violation then null;
  end;
  assert not exists (select 1 from public.cultivera_archive_runs where run_id = '20261101T200002Z-0337abcd'),
    'a refused run leaves nothing behind';
end $$;

do $$
declare
  r jsonb;
  day1 jsonb := '{"day": "2026-10-31", "gross_sales_minor": 868414, "discounts_minor": 257770, "taxes_minor": 277990,
                  "returns_minor": 0, "net_sales_minor": 610644, "cost_minor": 368618, "gross_profit_minor": 499796,
                  "net_profit_minor": 242026, "cash_redemption_minor": 0}';
begin
  r := pg_temp.days('20261101T200000Z-0337abcd', jsonb_build_array(day1));
  assert (r->>'written')::int = 1, 'day stored: ' || r::text;
  assert (select net_sales_minor from public.cultivera_benchmark_days where day = '2026-10-31') = 610644, 'cents kept';

  -- An OLDER run must not overwrite the newer day.
  insert into public.cultivera_archive_runs (run_id, captured_at, manifest_sha256, file_count, total_bytes, total_rows)
  values ('20261001T200000Z-0337abcd', '2026-10-01T20:00:00Z', repeat('3', 64), 0, 0, 0);
  r := pg_temp.days('20261001T200000Z-0337abcd', jsonb_build_array(day1 || '{"net_sales_minor": 1}'));
  assert (r->>'written')::int = 0 and (r->>'kept_newer')::int = 1, 'older run kept out: ' || r::text;
  assert (select net_sales_minor from public.cultivera_benchmark_days where day = '2026-10-31') = 610644, 'newer kept';

  begin
    perform pg_temp.days('20260101T000000Z-deadbeef', '[]'::jsonb);
    assert false, 'unknown run must fail';
  exception when invalid_parameter_value then null;
  end;
end $$;

do $$
begin
  begin
    insert into public.cultivera_payback_entries (entry_key, entry_date, kind, amount_minor, note)
    values ('bad-saving', '2026-11-02', 'saving', -100, 'negative saving');
    assert false, 'a negative saving must fail';
  exception when check_violation then null;
  end;
  begin
    insert into public.cultivera_payback_entries (entry_key, entry_date, kind, amount_minor, note)
    values ('owner-build-cost', '2026-11-02', 'build_cost', 1, 'dup');
    assert false, 'a duplicate entry key must fail';
  exception when unique_violation then null;
  end;
  -- A correction is its own row, either sign.
  insert into public.cultivera_payback_entries (entry_key, entry_date, kind, amount_minor, note)
  values ('check-adjustment', '2026-11-02', 'adjustment', -500, 'correction');
end $$;

\echo 'CULTIVERA BENCHMARK 0337 CHECK PASSED'
rollback;
