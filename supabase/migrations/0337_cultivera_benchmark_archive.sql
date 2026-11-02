-- 0337_cultivera_benchmark_archive.sql  (CVB-3 - Cultivera benchmark, owner request 2026-11-01)
--
-- Owner (verbatim, docs/roadmap/CVB-CULTIVERA-BENCHMARK.md section 1): "I want to create a Cultivera
-- benchmark report in the reports page. I want to compare Cultivera's system with ours. ... Maybe add a
-- total build cost amount that goes down as our system outperforms theirs as well as account for the 5500
-- less for not using Cultivera anymore. We just now today from switching saved 5500. ... Total build was
-- 40k. This will also allow me to retain Cultivera historical data safely in our system. This will be
-- owner only access."
--
-- The crawler's archive harvester (crawler/app/cultivera_archive.py, CVB-2) writes one run directory of
-- gzip JSONL parts plus manifest.json (bytes + sha256 + rows for every file). This migration gives the
-- site somewhere safe to keep that history and the two things the benchmark needs:
--
--   1. storage bucket cultivera-archive (PRIVATE): the run's files, byte for byte, at
--      <run_id>/<file name>. Nothing in this migration reads them; they are the retained copy.
--   2. public.cultivera_archive_runs  - one row per archived run (who, when, manifest sha256, totals).
--   3. public.cultivera_archive_files - one row per file of a run (dataset, bytes, sha256, rows, path),
--      the provenance of every byte in the bucket.
--   4. public.cultivera_benchmark_days - Cultivera's own daily-sales figures (reports/daily-sales), one
--      row per Pacific day, money in cents. The benchmark compares OUR day against THIS row.
--   5. public.cultivera_payback_entries - an append-only ledger against the build cost. Seeded with
--      the two figures the owner stated: build cost $40,000.00 and $5,500.00 saved on 2026-11-01.
--      Every later credit (a saving, or a day our system beat Cultivera) is its own row with its basis;
--      a mistake is corrected by an 'adjustment' row, never by an edit (append-only).
--   6. public.cvb_register_archive_run(...) - registers a run and its files in one transaction;
--      re-registering the same manifest is "already done", a different manifest under the same run id
--      is refused (rule 15: a claim on a unique key).
--   7. public.cvb_upsert_benchmark_days(...) - stores up to 1,000 daily rows from one run.
--
-- Grants (rule 15, stated in full). Owner-only is enforced in the app (permission
-- "cultivera.benchmark": ["owner"]); the database only ever serves the server role:
--   cultivera_archive_runs / cultivera_archive_files: RLS on, no policies; service_role select, insert;
--     never update / delete (an archived run is history). Nothing for anon / authenticated.
--   cultivera_benchmark_days: RLS on; service_role select, insert, update (a later run with a newer
--     capture refreshes a day); never delete. Nothing for anon / authenticated.
--   cultivera_payback_entries: RLS on; service_role select, insert only (append-only). Nothing for
--     anon / authenticated.
--   both functions: security invoker, pinned search_path, execute for service_role only.
--   bucket cultivera-archive: private (public = false); no storage policies, so only the service role
--     (which bypasses storage RLS) can read or write it.
--
-- Factory reset: all four tables are KEPT (src/lib/accounting/factory-reset-core.ts). They are the old
-- system's record and the owner's cost ledger, not test data. The only foreign keys point at each other
-- and at staff_profiles (also KEPT).
--
-- Safe to re-run.

-- 1. the private bucket ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('cultivera-archive', 'cultivera-archive', false)
on conflict (id) do nothing;

do $m$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute 'update storage.buckets set file_size_limit = 104857600 where id = ''cultivera-archive''';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute 'update storage.buckets set allowed_mime_types = array[''application/gzip'', ''application/json'', ''application/x-ndjson''] where id = ''cultivera-archive''';
  end if;
end
$m$;

-- 2. runs -----------------------------------------------------------------------------------------
create table if not exists public.cultivera_archive_runs (
  -- The crawler's run id (YYYYMMDDTHHMMSSZ-xxxxxxxx), the same shape every crawler run uses.
  run_id            text primary key check (run_id ~ '^\d{8}T\d{6}Z-[0-9a-f]{8}$'),
  -- When the crawler finished reading Cultivera (from its manifest), not when we stored it.
  captured_at       timestamptz not null,
  manifest_sha256   text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  file_count        integer not null check (file_count >= 0),
  total_bytes       bigint not null check (total_bytes >= 0),
  total_rows        bigint not null check (total_rows >= 0),
  archived_by       uuid references public.staff_profiles(id) on delete set null,
  archived_at       timestamptz not null default now()
);

comment on table public.cultivera_archive_runs is
  'CVB-3 (0337): one row per Cultivera archive run stored in the private cultivera-archive bucket (manifest sha256 and totals). Append-only. Kept by the factory reset.';

alter table public.cultivera_archive_runs enable row level security;
revoke all on table public.cultivera_archive_runs from public, anon, authenticated;
revoke update, delete, truncate, references, trigger on table public.cultivera_archive_runs from service_role;
grant select, insert on table public.cultivera_archive_runs to service_role;

-- 3. files ----------------------------------------------------------------------------------------
create table if not exists public.cultivera_archive_files (
  run_id        text not null references public.cultivera_archive_runs(run_id) on delete restrict,
  -- The file name exactly as the crawler wrote it (crawler/app/cultivera_archive.py PART_NAME / SINGLE_FILES).
  file_name     text not null check (file_name ~ '^[a-z0-9_]+(\.(p\d{4}|\d{4}-\d{2}|s\d{5}|cc\d{5}))?\.(jsonl\.gz|json|jsonl)$'),
  -- The dataset the file belongs to (the part of the name before the first dot).
  dataset       text not null check (dataset ~ '^[a-z0-9_]+$'),
  bytes         bigint not null check (bytes >= 0),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Rows in the file per the manifest (null for single JSON files that are not row lists).
  row_count     bigint check (row_count is null or row_count >= 0),
  storage_path  text not null,
  primary key (run_id, file_name),
  check (storage_path = run_id || '/' || file_name)
);

create index if not exists cultivera_archive_files_dataset_idx
  on public.cultivera_archive_files (dataset, run_id);

comment on table public.cultivera_archive_files is
  'CVB-3 (0337): every file of an archived Cultivera run (bytes, sha256, rows, bucket path). Append-only provenance for the cultivera-archive bucket. Kept by the factory reset.';

alter table public.cultivera_archive_files enable row level security;
revoke all on table public.cultivera_archive_files from public, anon, authenticated;
revoke update, delete, truncate, references, trigger on table public.cultivera_archive_files from service_role;
grant select, insert on table public.cultivera_archive_files to service_role;

-- 4. Cultivera's daily figures --------------------------------------------------------------------
create table if not exists public.cultivera_benchmark_days (
  -- The Pacific day Cultivera's reports/daily-sales row is for (its Day / Month / Year).
  day                       date primary key,
  -- Cultivera's dollars converted to cents exactly once (src/lib/reports/cultivera-benchmark-core.ts).
  gross_sales_minor         bigint not null,
  discounts_minor           bigint not null,
  taxes_minor               bigint not null,
  returns_minor             bigint not null,
  net_sales_minor           bigint not null,
  cost_minor                bigint not null,
  gross_profit_minor        bigint not null,
  net_profit_minor          bigint not null,
  cash_redemption_minor     bigint not null,
  run_id                    text not null references public.cultivera_archive_runs(run_id) on delete restrict,
  captured_at               timestamptz not null,
  updated_at                timestamptz not null default now()
);

comment on table public.cultivera_benchmark_days is
  'CVB-3 (0337): Cultivera''s own reports/daily-sales figures per Pacific day, in cents, from an archived run. The benchmark compares our day with this row. Kept by the factory reset.';

alter table public.cultivera_benchmark_days enable row level security;
revoke all on table public.cultivera_benchmark_days from public, anon, authenticated;
revoke delete, truncate, references, trigger on table public.cultivera_benchmark_days from service_role;
grant select, insert, update on table public.cultivera_benchmark_days to service_role;

-- 5. the payback ledger ---------------------------------------------------------------------------
create table if not exists public.cultivera_payback_entries (
  id            uuid primary key default gen_random_uuid(),
  -- A stable key per entry, so a repeat insert is "already recorded", never a double credit.
  entry_key     text not null unique check (length(entry_key) between 3 and 200),
  entry_date    date not null,
  -- build_cost   : what the build cost (positive cents; the starting debt)
  -- saving       : money not spent because Cultivera is gone (positive cents, reduces the debt)
  -- outperform   : money our system earned beyond Cultivera's figure for a period (positive cents)
  -- adjustment   : a correction, either sign (append-only: mistakes are fixed by a new row)
  kind          text not null check (kind in ('build_cost', 'saving', 'outperform', 'adjustment')),
  amount_minor  bigint not null,
  note          text not null check (length(note) between 1 and 1000),
  -- How the amount was worked out (period, our figure, Cultivera's figure, run id). Never guessed.
  basis         jsonb not null default '{}'::jsonb,
  created_by    uuid references public.staff_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  check (kind = 'adjustment' or amount_minor > 0)
);

create index if not exists cultivera_payback_entries_date_idx
  on public.cultivera_payback_entries (entry_date, created_at);

comment on table public.cultivera_payback_entries is
  'CVB-3 (0337): append-only ledger of the Cultivera migration payback: the build cost, savings, and outperformance credits (cents). Remaining = build_cost - savings - outperform - adjustments. Kept by the factory reset.';

alter table public.cultivera_payback_entries enable row level security;
revoke all on table public.cultivera_payback_entries from public, anon, authenticated;
revoke update, delete, truncate, references, trigger on table public.cultivera_payback_entries from service_role;
grant select, insert on table public.cultivera_payback_entries to service_role;

-- The two figures the owner stated on 2026-11-01 (verbatim above). Once each, ever.
insert into public.cultivera_payback_entries (entry_key, entry_date, kind, amount_minor, note, basis)
values
  ('owner-build-cost', '2026-11-01', 'build_cost', 4000000,
   'Total build cost the owner stated: "Total build was 40k."',
   '{"source": "owner request 2026-11-01", "quote": "Total build was 40k."}'::jsonb),
  ('owner-saving-2026-11-01', '2026-11-01', 'saving', 550000,
   'Saved by switching off Cultivera, as the owner stated: "We just now today from switching saved 5500."',
   '{"source": "owner request 2026-11-01", "quote": "We just now today from switching saved 5500."}'::jsonb)
on conflict (entry_key) do nothing;

-- 6. register a run -------------------------------------------------------------------------------
create or replace function public.cvb_register_archive_run(
  p_run_id text,
  p_captured_at timestamptz,
  p_manifest_sha256 text,
  p_actor uuid,
  p_files jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_existing text;
  v_count int;
  v_bytes bigint;
  v_rows bigint;
begin
  if p_run_id is null or p_run_id !~ '^\d{8}T\d{6}Z-[0-9a-f]{8}$' then
    raise exception 'cvb_register_archive_run: bad run id' using errcode = 'invalid_parameter_value';
  end if;
  if p_manifest_sha256 is null or p_manifest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'cvb_register_archive_run: bad manifest sha256' using errcode = 'invalid_parameter_value';
  end if;
  if p_captured_at is null then
    raise exception 'cvb_register_archive_run: captured_at is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0
     or jsonb_array_length(p_files) > 5000 then
    raise exception 'cvb_register_archive_run: files must be a list of 1 to 5,000' using errcode = 'invalid_parameter_value';
  end if;

  -- Claim the run id (unique key). A repeat with the same manifest is "already done".
  select manifest_sha256 into v_existing from public.cultivera_archive_runs where run_id = p_run_id;
  if found then
    if v_existing = p_manifest_sha256 then
      return jsonb_build_object('status', 'already', 'run_id', p_run_id);
    end if;
    raise exception 'cvb_register_archive_run: run % is already archived with a different manifest', p_run_id
      using errcode = 'unique_violation';
  end if;

  select count(*), coalesce(sum((f->>'bytes')::bigint), 0), coalesce(sum((f->>'rows')::bigint), 0)
    into v_count, v_bytes, v_rows
    from jsonb_array_elements(p_files) f;

  insert into public.cultivera_archive_runs (run_id, captured_at, manifest_sha256, file_count, total_bytes,
                                             total_rows, archived_by)
  values (p_run_id, p_captured_at, p_manifest_sha256, v_count, v_bytes, v_rows, p_actor);

  insert into public.cultivera_archive_files (run_id, file_name, dataset, bytes, sha256, row_count, storage_path)
  select p_run_id, f->>'name', split_part(f->>'name', '.', 1), (f->>'bytes')::bigint, f->>'sha256',
         (f->>'rows')::bigint, p_run_id || '/' || (f->>'name')
    from jsonb_array_elements(p_files) f;

  return jsonb_build_object('status', 'archived', 'run_id', p_run_id, 'files', v_count, 'bytes', v_bytes,
                            'rows', v_rows);
end;
$$;

comment on function public.cvb_register_archive_run(text, timestamptz, text, uuid, jsonb) is
  'CVB-3 (0337): register an archived Cultivera run and its files in one transaction. Same manifest again = already; a different manifest under the same run id is refused. Server only.';

revoke all on function public.cvb_register_archive_run(text, timestamptz, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cvb_register_archive_run(text, timestamptz, text, uuid, jsonb) to service_role;

-- 7. store Cultivera's daily figures --------------------------------------------------------------
create or replace function public.cvb_upsert_benchmark_days(
  p_run_id text,
  p_rows jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_captured timestamptz;
  v_n int;
  v_written int;
begin
  select captured_at into v_captured from public.cultivera_archive_runs where run_id = p_run_id;
  if not found then
    raise exception 'cvb_upsert_benchmark_days: run % is not archived', p_run_id
      using errcode = 'invalid_parameter_value';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'cvb_upsert_benchmark_days: rows must be a list of at most 1,000' using errcode = 'invalid_parameter_value';
  end if;
  v_n := jsonb_array_length(p_rows);

  -- A day already stored from a run captured LATER is not overwritten by an older run.
  with src as (
    select (r->>'day')::date as day,
           (r->>'gross_sales_minor')::bigint as g, (r->>'discounts_minor')::bigint as d,
           (r->>'taxes_minor')::bigint as t, (r->>'returns_minor')::bigint as rt,
           (r->>'net_sales_minor')::bigint as n, (r->>'cost_minor')::bigint as c,
           (r->>'gross_profit_minor')::bigint as gp, (r->>'net_profit_minor')::bigint as np,
           (r->>'cash_redemption_minor')::bigint as cr
      from jsonb_array_elements(p_rows) r
  ), up as (
    insert into public.cultivera_benchmark_days as b
      (day, gross_sales_minor, discounts_minor, taxes_minor, returns_minor, net_sales_minor, cost_minor,
       gross_profit_minor, net_profit_minor, cash_redemption_minor, run_id, captured_at, updated_at)
    select day, g, d, t, rt, n, c, gp, np, cr, p_run_id, v_captured, now() from src
    on conflict (day) do update set
      gross_sales_minor = excluded.gross_sales_minor, discounts_minor = excluded.discounts_minor,
      taxes_minor = excluded.taxes_minor, returns_minor = excluded.returns_minor,
      net_sales_minor = excluded.net_sales_minor, cost_minor = excluded.cost_minor,
      gross_profit_minor = excluded.gross_profit_minor, net_profit_minor = excluded.net_profit_minor,
      cash_redemption_minor = excluded.cash_redemption_minor, run_id = excluded.run_id,
      captured_at = excluded.captured_at, updated_at = now()
    where b.captured_at <= excluded.captured_at
    returning 1
  )
  select count(*) into v_written from up;

  return jsonb_build_object('rows', v_n, 'written', v_written, 'kept_newer', v_n - v_written);
end;
$$;

comment on function public.cvb_upsert_benchmark_days(text, jsonb) is
  'CVB-3 (0337): store up to 1,000 of Cultivera''s daily-sales rows (cents) from an archived run; a day from a newer capture is never overwritten by an older one. Server only.';

revoke all on function public.cvb_upsert_benchmark_days(text, jsonb) from public, anon, authenticated;
grant execute on function public.cvb_upsert_benchmark_days(text, jsonb) to service_role;

notify pgrst, 'reload schema';
