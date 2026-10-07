-- 0248_ccrs_outbox.sql  (CCRS Bible v2, slice S-12b — Part 05 §A–§C, §G–§H)
--
-- The Transactional Outbox for CCRS files [SRC S6]: a file's exact bytes,
-- its rows, its control totals and its findings are committed in ONE database
-- transaction BEFORE the zip leaves the building; the operator later uploads
-- the STORED bytes, never a regenerated file.
--
--   ccrs_files.stamp_at       the instant in the file name (one per file;
--                             strictly increasing per env — Part 05 §B)
--   ccrs_files.control_totals the full Part 05 §G totals (op counts, Sale sums)
--   ccrs_file_contents        the exact bytes (text, UTF-8), hash-checked
--   ccrs_product_ids          our product key -> its minted GWP- id (D-01a)
--   ccrs_emit_files(...)      the one-transaction emit (service role only)
--   ccrs_assign_product_ids() idempotent GWP- assignment (service role only)
--   ccrs_link_unfiled_migration_lots() marks Cultivera-import lots whose id
--                             is not on the CCRS record as `unknown` (Part 03
--                             §D.5: "110 unmatched -> unknown pending P-07")
--   ccrs_ledger_slice()       the ledger entries one batch routes against
--   ccrs_seed_finalize()      verifies a loaded production seed against the
--                             server's expected counts, records provenance,
--                             links lots - one transaction (Part 03 §D.4)
--
-- Why the bytes live in Postgres and not in Supabase Storage: Storage writes
-- are outside the Postgres transaction, so a crash between "upload bytes" and
-- "insert row" leaves an orphan or a row without bytes — exactly what an
-- outbox exists to prevent. A 10,000-row Inventory chunk is ~2.1 MB
-- (13,428,087 B / 62,744 rows x 10,000), comfortably a text value.
--
-- Why rows are parsed HERE from the stored bytes: the rows recorded are then
-- by construction the rows in the file (split on every comma, as CCRS's
-- reader does — PREprod P20261005A), and the request carries each file once.
--
-- Grounding (verbatim, Bible v2 Part 01):
--   Brian A29 "The exact same file name will not be accepted twice, nor would
--             the data."   -> duplicate content is refused with the existing
--                             file's name (unique (env, sha256) from 0247)
--   Brian A21 "They are separate environments." -> every lock/stamp is per env
--
-- Idempotent. Safe on an empty database. Requires 0247.
-- Rollback: supabase/rollbacks/0248_ccrs_outbox.rollback.sql.
-- Check:    scripts/recon/ccrs-outbox-pg-check.sql.
-- Owner applies MANUALLY in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- 1) ccrs_files: stamp + full control totals
-- ---------------------------------------------------------------------------
alter table public.ccrs_files add column if not exists stamp_at timestamptz;
alter table public.ccrs_files add column if not exists control_totals jsonb;
create index if not exists ccrs_files_env_stamp_idx on public.ccrs_files (env, stamp_at desc);

comment on column public.ccrs_files.stamp_at is
  'S-12b: the instant written into file_name (Pacific YYYYMMDDHHMMSS). Strictly increasing per env (Part 05 §B), so a regeneration can never reuse a stamp.';
comment on column public.ccrs_files.control_totals is
  'S-12b: Part 05 §G control totals derived from the rows at assembly and re-derived from the bytes before storing (ccrs-control-totals-core.ts).';

-- ---------------------------------------------------------------------------
-- 2) ccrs_file_contents: the exact bytes, immutable
-- ---------------------------------------------------------------------------
create table if not exists public.ccrs_file_contents (
  file_id     uuid primary key references public.ccrs_files(id) on delete cascade,
  content     text not null,
  byte_length integer not null check (byte_length >= 0),
  created_at  timestamptz not null default now(),
  constraint ccrs_file_contents_length_matches check (byte_length = octet_length(content))
);

comment on table public.ccrs_file_contents is
  'S-12b: exact bytes of every emitted CCRS file. The operator downloads THESE bytes (re-hashed to ccrs_files.sha256 on every download); a file is never regenerated.';

create or replace function public.ccrs_file_contents_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'CCRS_CONTENT_IMMUTABLE: stored CCRS file bytes can never be changed'
      using errcode = 'check_violation';
  end if;
  -- DELETE: only while the owning file is still a draft (or is being deleted
  -- as a draft by the cascade, in which case it is already gone).
  if exists (select 1 from public.ccrs_files f where f.id = old.file_id and f.state <> 'draft') then
    raise exception 'CCRS_CONTENT_IS_RECORD: bytes of a file that left draft can never be deleted'
      using errcode = 'check_violation';
  end if;
  return old;
end $$;

drop trigger if exists trg_ccrs_file_contents_guard on public.ccrs_file_contents;
create trigger trg_ccrs_file_contents_guard
  before update or delete on public.ccrs_file_contents
  for each row execute function public.ccrs_file_contents_guard();

-- ---------------------------------------------------------------------------
-- 3) ccrs_product_ids: minted GWP- ids (D-01a), assigned once, never derived
-- ---------------------------------------------------------------------------
create sequence if not exists public.ccrs_gwp_seq minvalue 1 maxvalue 999999 no cycle;

create table if not exists public.ccrs_product_ids (
  id           uuid primary key default gen_random_uuid(),
  env          text not null check (env in ('preprod', 'prod')),
  product_key  text not null check (product_key <> ''),
  external_id  text not null check (external_id ~ '^(P[0-9]{8}[A-Z]-)?GWP-[0-9]{6}$'),
  assigned_by  text,
  created_at   timestamptz not null default now(),
  constraint ccrs_product_ids_env_key unique (env, product_key),
  constraint ccrs_product_ids_env_ext unique (env, external_id)
);

comment on table public.ccrs_product_ids is
  'S-12b: our product key -> the CCRS Product ExternalIdentifier minted for it (GWP-<6-digit seq>, D-01a). Assigned by an explicit owner action, never at export time; never reassigned.';

create or replace function public.ccrs_product_ids_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'CCRS_PRODUCT_ID_IS_RECORD: an assigned CCRS Product id can never be changed or removed'
    using errcode = 'check_violation';
end $$;

drop trigger if exists trg_ccrs_product_ids_guard on public.ccrs_product_ids;
create trigger trg_ccrs_product_ids_guard
  before update or delete on public.ccrs_product_ids
  for each row execute function public.ccrs_product_ids_guard();

-- ---------------------------------------------------------------------------
-- 4) RLS — mirrors 0247: staff read, admin write.
-- ---------------------------------------------------------------------------
alter table public.ccrs_file_contents enable row level security;
alter table public.ccrs_product_ids   enable row level security;

drop policy if exists "ccrs_file_contents staff read" on public.ccrs_file_contents;
create policy "ccrs_file_contents staff read" on public.ccrs_file_contents
  for select using (public.is_staff());
drop policy if exists "ccrs_file_contents admin write" on public.ccrs_file_contents;
create policy "ccrs_file_contents admin write" on public.ccrs_file_contents
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "ccrs_product_ids staff read" on public.ccrs_product_ids;
create policy "ccrs_product_ids staff read" on public.ccrs_product_ids
  for select using (public.is_staff());
drop policy if exists "ccrs_product_ids admin write" on public.ccrs_product_ids;
create policy "ccrs_product_ids admin write" on public.ccrs_product_ids
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5) ccrs_emit_files: ONE transaction for every file of an emission.
--
-- p_files: jsonb array of
--   { file_type, purpose, chunk_no, chunk_of, file_name, stamp_at (ISO),
--     content, sha256, number_records, distinct_ids, sum_qoh, sum_total_cost,
--     control_totals, issues: [{severity, code, message}] }
-- p_general_issues: [{severity, code, message}] not tied to one file
--
-- Returns {"files":[...]} in input order, one entry per input file:
--   {status:"emitted",   id, file_name, sha256, state, in_flight}   written now
--   {status:"duplicate", id, file_name, sha256, state, emitted_at}  same bytes
--     already stored in this env (Brian A29): nothing written for it; the
--     caller serves the STORED bytes under the STORED name.
-- Raises (whole emission rolled back) on: hash mismatch, NumberRecords or
-- row-width mismatch, missing CRLF, a stamp not after every stored stamp.
-- ---------------------------------------------------------------------------
create or replace function public.ccrs_emit_files(p_env text, p_files jsonb, p_general_issues jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  f          jsonb;
  v_id       uuid;
  v_lines    text[];
  v_cols     text[];
  v_n        integer;
  v_idcol    text;
  v_last     timestamptz;
  v_min      timestamptz;
  v_dup      jsonb;
  v_out      jsonb := '[]'::jsonb;
  v_inflight integer;
begin
  if p_env not in ('preprod', 'prod') then
    raise exception 'CCRS_EMIT_BAD_ENV: %', p_env using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'CCRS_EMIT_NO_FILES: an emission needs at least one file' using errcode = 'check_violation';
  end if;

  -- One emitter per env at a time: the stamp check below must see every
  -- stamp committed before it.
  perform pg_advisory_xact_lock(hashtext('ccrs_emit_files:' || p_env));

  -- Stamps of the NEW files strictly after every stamp already stored in this
  -- env (Part 05 §B). Files whose bytes are already stored are not new.
  select max(c.stamp_at) into v_last from public.ccrs_files c where c.env = p_env;
  select min((x->>'stamp_at')::timestamptz) into v_min
    from jsonb_array_elements(p_files) x
   where not exists (select 1 from public.ccrs_files c where c.env = p_env and c.sha256 = x->>'sha256');
  if exists (select 1 from jsonb_array_elements(p_files) x where nullif(x->>'stamp_at', '') is null) then
    raise exception 'CCRS_EMIT_NO_STAMP: every file needs stamp_at' using errcode = 'check_violation';
  end if;
  if v_last is not null and v_min is not null and v_min <= v_last then
    raise exception 'CCRS_STAMP_NOT_AFTER_LAST: % is not after the last stamp % in %', v_min, v_last, p_env
      using errcode = 'check_violation';
  end if;

  for f in select value from jsonb_array_elements(p_files) loop
    -- Same data never twice (Brian A29): a file whose exact bytes are already
    -- stored in this env is NOT written again; the existing file is returned
    -- so the operator gets the stored bytes under the stored name.
    select jsonb_build_object('status', 'duplicate', 'id', c.id, 'file_name', c.file_name, 'state', c.state,
                              'sha256', c.sha256, 'emitted_at', c.emitted_at)
      into v_dup
      from public.ccrs_files c
     where c.env = p_env and c.sha256 = f->>'sha256';
    if v_dup is not null then
      v_out := v_out || v_dup;
      continue;
    end if;

    -- bytes: hash and shape
    if encode(sha256(convert_to(f->>'content', 'UTF8')), 'hex') is distinct from f->>'sha256' then
      raise exception 'CCRS_HASH_MISMATCH: % bytes do not hash to the stated sha256', f->>'file_name'
        using errcode = 'check_violation';
    end if;
    if right(f->>'content', 2) <> E'\r\n' then
      raise exception 'CCRS_NOT_CRLF_TERMINATED: %', f->>'file_name' using errcode = 'check_violation';
    end if;
    v_lines := string_to_array(left(f->>'content', -2), E'\r\n');
    if coalesce(array_length(v_lines, 1), 0) < 4 then
      raise exception 'CCRS_SHORT_HEADER: % has fewer than 4 header lines', f->>'file_name' using errcode = 'check_violation';
    end if;
    v_n := array_length(v_lines, 1) - 4;
    if v_lines[3] <> ('NumberRecords,' || v_n::text) or (f->>'number_records')::integer <> v_n then
      raise exception 'CCRS_RECORD_COUNT_MISMATCH: % header says [%], stated %, data lines %',
        f->>'file_name', v_lines[3], f->>'number_records', v_n using errcode = 'check_violation';
    end if;
    v_cols := string_to_array(v_lines[4], ',');
    if exists (
      select 1 from unnest(v_lines[5:]) with ordinality as d(line, n)
       where coalesce(array_length(string_to_array(d.line, ','), 1), 0) <> array_length(v_cols, 1)
    ) then
      raise exception 'CCRS_ROW_WIDTH: a data row of % does not have % cells when split on every comma',
        f->>'file_name', array_length(v_cols, 1) using errcode = 'check_violation';
    end if;

    -- born draft (0247 guard), then emitted in this same transaction
    insert into public.ccrs_files (env, file_type, purpose, chunk_no, chunk_of, file_name, number_records,
                                   distinct_ids, sum_qoh, sum_total_cost, control_totals, stamp_at)
    values (p_env, f->>'file_type', coalesce(f->>'purpose', 'weekly'),
            coalesce((f->>'chunk_no')::integer, 1), coalesce((f->>'chunk_of')::integer, 1),
            f->>'file_name', v_n, (f->>'distinct_ids')::integer,
            (f->>'sum_qoh')::numeric, (f->>'sum_total_cost')::numeric, f->'control_totals',
            (f->>'stamp_at')::timestamptz)
    returning id into v_id;

    insert into public.ccrs_file_contents (file_id, content, byte_length)
    values (v_id, f->>'content', octet_length(f->>'content'));

    v_idcol := case f->>'file_type' when 'Strain' then 'Strain' when 'Sale' then 'SaleDetailExternalIdentifier' else 'ExternalIdentifier' end;
    insert into public.ccrs_file_rows (file_id, row_no, entity_id, external_id, operation, payload, state)
    select v_id, d.n::integer, e.id, p.payload->>v_idcol, nullif(p.payload->>'Operation', ''), p.payload, 'emitted'
      from unnest(v_lines[5:]) with ordinality as d(line, n)
      cross join lateral (
        select jsonb_object_agg(u.col, u.val) as payload
          from unnest(v_cols, string_to_array(d.line, ',')) as u(col, val)
      ) p
      left join public.ccrs_filed_entities e
        on e.env = p_env and e.file_type = f->>'file_type' and e.external_id = p.payload->>v_idcol;

    insert into public.ccrs_file_issues (file_id, severity, code, message)
    select v_id, i->>'severity', i->>'code', i->>'message'
      from jsonb_array_elements(coalesce(f->'issues', '[]'::jsonb)) i;

    -- Part 05 §A: one in-flight assertion per (env,type,id,op). Reported, not
    -- yet blocking: files cannot be closed until the S-12c hub records uploads.
    select count(*) into v_inflight
      from public.ccrs_file_rows r
      join public.ccrs_files o on o.id = r.file_id
      join public.ccrs_file_rows mine on mine.file_id = v_id
       and mine.external_id = r.external_id and mine.operation is not distinct from r.operation
     where o.env = p_env and o.file_type = f->>'file_type' and o.id <> v_id
       and o.state in ('emitted', 'uploaded', 'succeeded', 'errored', 'reconciling');
    if v_inflight > 0 then
      insert into public.ccrs_file_issues (file_id, severity, code, message)
      values (v_id, 'warning', 'W_IN_FLIGHT',
              v_inflight || ' row(s) repeat an assertion already in a file that is not closed yet (Part 05 §A).');
    end if;

    update public.ccrs_files
       set state = 'emitted', sha256 = f->>'sha256', storage_path = 'db:ccrs_file_contents/' || v_id, emitted_at = now()
     where id = v_id;

    v_out := v_out || jsonb_build_object('status', 'emitted', 'id', v_id, 'file_name', f->>'file_name', 'sha256', f->>'sha256',
                                         'state', 'emitted', 'in_flight', v_inflight);
  end loop;

  -- General findings are recorded only when something new was emitted (a
  -- pure re-download must not duplicate the findings of the first emission).
  if exists (select 1 from jsonb_array_elements(v_out) o where o->>'status' = 'emitted') then
    insert into public.ccrs_file_issues (file_id, severity, code, message)
    select null, i->>'severity', i->>'code', i->>'message'
      from jsonb_array_elements(coalesce(p_general_issues, '[]'::jsonb)) i;
  end if;

  return jsonb_build_object('files', v_out);
end $$;

comment on function public.ccrs_emit_files(text, jsonb, jsonb) is
  'S-12b: Transactional Outbox emit. One transaction: duplicate-content refusal, monotonic stamps, hash + NumberRecords + row-width checks on the exact bytes, rows parsed from the bytes, issues, draft->emitted.';

-- ---------------------------------------------------------------------------
-- 6) ccrs_assign_product_ids: idempotent GWP- assignment
-- ---------------------------------------------------------------------------
create or replace function public.ccrs_assign_product_ids(p_env text, p_keys text[], p_assigned_by text default null, p_preprod_run text default null)
returns table (product_key text, external_id text, newly_assigned boolean)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  k text;
begin
  if p_env not in ('preprod', 'prod') then
    raise exception 'CCRS_ASSIGN_BAD_ENV: %', p_env using errcode = 'check_violation';
  end if;
  if (p_env = 'preprod') <> (p_preprod_run is not null) then
    raise exception 'CCRS_ASSIGN_RUN_PREFIX: PREprod ids need a run prefix and production ids must not have one'
      using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('ccrs_assign_product_ids:' || p_env));
  for k in select distinct trim(x) from unnest(p_keys) x where trim(x) <> '' order by 1 loop
    if exists (select 1 from public.ccrs_product_ids c where c.env = p_env and c.product_key = k) then
      return query select c.product_key, c.external_id, false from public.ccrs_product_ids c where c.env = p_env and c.product_key = k;
    else
      return query
        insert into public.ccrs_product_ids as c (env, product_key, external_id, assigned_by)
        values (p_env, k,
                coalesce(p_preprod_run || '-', '') || 'GWP-' || lpad(nextval('public.ccrs_gwp_seq')::text, 6, '0'),
                p_assigned_by)
        returning c.product_key, c.external_id, true;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7) ccrs_link_unfiled_migration_lots: Part 03 §D.5 lot linking
--
-- A one-time Cultivera import lot (notes carry the import marker,
-- bulk-fill-core.ts MIGRATION_MARKER) whose assigned id is NOT a filed
-- Inventory id in the production ledger gets an `unknown` ledger entity, so
-- routing WITHHOLDS it (state unknown -> "pending probe P-07") instead of
-- Inserting a lot CCRS never received from Cultivera. Lots that match are
-- already linked (their id IS the filed id, S-10/0246). Non-destructive: no
-- lot is edited. Refuses to run on an empty ledger (nothing to compare to).
-- p_apply = false is a dry run (counts only).
-- ---------------------------------------------------------------------------
create or replace function public.ccrs_link_unfiled_migration_lots(p_apply boolean default false)
returns table (migration_lots integer, linked_live integer, linked_closed integer, unknown_new integer, unknown_before integer)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_ledger integer;
  v_total integer; v_live integer; v_closed integer; v_new integer; v_unknown integer;
begin
  select count(*) into v_ledger from public.ccrs_filed_entities where env = 'prod' and file_type = 'Inventory' and source <> 'link:unfiled-migration-lot';
  if v_ledger = 0 then
    raise exception 'CCRS_LINK_NO_LEDGER: load the production seed first' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('ccrs_link_unfiled_migration_lots'));

  -- counts BEFORE any write, so a dry run and the real run report the same numbers
  with k as (
    select distinct trim(l.ccrs_inventory_external_id) as ext
      from public.inventory_lots l
     where l.notes like '%Cultivera migration (one-time POS import).%'
       and l.status <> 'destroyed'
       and coalesce(trim(l.ccrs_inventory_external_id), '') <> ''
  )
  select count(*)::integer,
         count(*) filter (where e.state in ('seed', 'filed', 'confirmed'))::integer,
         count(*) filter (where e.state = 'closed')::integer,
         count(*) filter (where e.id is null)::integer,
         count(*) filter (where e.state = 'unknown')::integer
    into v_total, v_live, v_closed, v_new, v_unknown
    from k
    left join public.ccrs_filed_entities e
      on e.env = 'prod' and e.file_type = 'Inventory' and e.external_id = k.ext;

  if p_apply then
    insert into public.ccrs_filed_entities (env, file_type, external_id, state, source)
    select distinct 'prod', 'Inventory', trim(l.ccrs_inventory_external_id), 'unknown', 'link:unfiled-migration-lot'
      from public.inventory_lots l
     where l.notes like '%Cultivera migration (one-time POS import).%'
       and l.status <> 'destroyed'
       and coalesce(trim(l.ccrs_inventory_external_id), '') <> ''
    on conflict (env, file_type, external_id) do nothing;
  end if;

  return query select v_total, v_live, v_closed, v_new, v_unknown;
end $$;

comment on function public.ccrs_link_unfiled_migration_lots(boolean) is
  'S-12b: Part 03 §D.5. Cultivera-import lots whose id is not on the CCRS record get an unknown ledger entity (withheld until P-07). Dry run by default; counts are measured before writing.';

-- ---------------------------------------------------------------------------
-- 7b) ccrs_seed_finalize: verify the loaded seed, record provenance, link lots
--
-- The production seed is loaded in idempotent batches (on conflict do nothing).
-- Finalize is the ONE transaction that makes it count:
--   1. the entities carrying p_source must equal p_expected exactly (counts
--      come from the SERVER's constant, never from the browser);
--   2. the four delivery files are recorded as closed 'seed' pseudo-files
--      (Part 03 D.4) - their presence is what switches routing on (the app
--      treats the ledger as loaded only when these rows exist);
--   3. ccrs_link_unfiled_migration_lots(true) runs in the same transaction, so
--      routing can never see the seed without the 110-style unknown lots.
-- Idempotent: a second call re-checks counts by source, records nothing new
-- and the link writes nothing new.
-- ---------------------------------------------------------------------------
create or replace function public.ccrs_seed_finalize(p_source text, p_expected jsonb, p_provenance jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_got jsonb;
  v_closed integer;
  v_before integer;
  p jsonb;
  r record;
begin
  if p_source is null or p_source !~ '^seed:[0-9]{4}-[0-9]{2}-[0-9]{2}-delivery$' then
    raise exception 'CCRS_SEED_BAD_SOURCE: %', p_source using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_provenance) <> 'array' or jsonb_array_length(p_provenance) <> 4
     or (select count(distinct x->>'file_type') from jsonb_array_elements(p_provenance) x
          where x->>'file_type' in ('Inventory', 'Product', 'Strain', 'Area')) <> 4 then
    raise exception 'CCRS_SEED_PROVENANCE: exactly one provenance entry each for Inventory, Product, Strain, Area'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from jsonb_array_elements(p_provenance) x
              where coalesce(x->>'sha256', '') !~ '^[0-9a-f]{64}$'
                 or coalesce(x->>'file_name', '') = ''
                 or (x->>'rows')::integer < 0) then
    raise exception 'CCRS_SEED_PROVENANCE: every entry needs file_name, a 64-hex sha256 and rows'
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('ccrs_seed_finalize'));

  select jsonb_build_object(
           'Inventory', count(*) filter (where file_type = 'Inventory'),
           'Product',   count(*) filter (where file_type = 'Product'),
           'Strain',    count(*) filter (where file_type = 'Strain'),
           'Area',      count(*) filter (where file_type = 'Area'))
    into v_got
    from public.ccrs_filed_entities
   where env = 'prod' and source = p_source;
  if v_got is distinct from (p_expected->'entities') then
    raise exception 'CCRS_SEED_COUNTS: loaded % but expected %; load every batch again (it is idempotent), then finalize', v_got, p_expected->'entities'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_before from public.ccrs_files where env = 'prod' and purpose = 'seed';
  if v_before = 0 then
    -- first finalize: the states are still exactly as seeded, so check them too
    select count(*) into v_closed from public.ccrs_filed_entities
     where env = 'prod' and source = p_source and file_type = 'Inventory' and state = 'closed';
    if v_closed <> (p_expected->>'inventoryClosed')::integer then
      raise exception 'CCRS_SEED_COUNTS: % closed Inventory entities, expected %', v_closed, p_expected->>'inventoryClosed'
        using errcode = 'check_violation';
    end if;
  end if;

  for p in select value from jsonb_array_elements(p_provenance) loop
    insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path, state, notes)
    values ('prod', p->>'file_type', 'seed',
            p_source || ':' || left(p->>'sha256', 12) || ':' || (p->>'file_name'),
            p->>'sha256', (p->>'rows')::integer, 'delivery/' || (p->>'file_name'), 'closed',
            'LCB Service Desk delivery (U-30). Loaded and verified by ccrs_seed_finalize.')
    on conflict do nothing;
  end loop;

  select * into r from public.ccrs_link_unfiled_migration_lots(true);

  return jsonb_build_object(
    'status', case when v_before = 0 then 'finalized' else 'already-finalized' end,
    'entities', v_got,
    'link', jsonb_build_object('migration_lots', r.migration_lots, 'linked_live', r.linked_live,
                               'linked_closed', r.linked_closed, 'unknown_new', r.unknown_new,
                               'unknown_before', r.unknown_before));
end $$;

comment on function public.ccrs_seed_finalize(text, jsonb, jsonb) is
  'S-12b: Part 03 D.4/D.5. One transaction: loaded seed counts verified against the measured expectation, provenance pseudo-files recorded (switches routing on), migration lots linked.';

-- ---------------------------------------------------------------------------
-- 7c) ccrs_ledger_slice: the part of the ledger ONE batch needs, in one call
--
-- A batch routes ~4,000 lots; the ledger holds ~137,000 entities. Paging all
-- of them through PostgREST (1,000 rows a page) on every hub page load is
-- slow, so the batch asks for exactly what routing reads:
--   Inventory  entities for the batch's lot ids
--   Product    entities those lots point at, every assigned GWP- id, and every
--              entity holding one of our product names (name-collision rule)
--   Strain     all (case-fold lookup needs every filed casing)
--   Area       all
-- plus the env's GWP- assignments, the last stamp used, and `loaded` (true
-- only once ccrs_seed_finalize recorded the seed provenance in this env).
-- Entries are arrays [file_type, external_id, filed_name, state,
-- product_external_id] to keep the response small.
-- ---------------------------------------------------------------------------
create or replace function public.ccrs_ledger_slice(p_env text, p_inventory_ids text[], p_product_names text[])
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_entries jsonb;
begin
  if p_env not in ('preprod', 'prod') then
    raise exception 'CCRS_SLICE_BAD_ENV: %', p_env using errcode = 'check_violation';
  end if;
  with inv as (
    select e.* from public.ccrs_filed_entities e
     where e.env = p_env and e.file_type = 'Inventory' and e.external_id = any(coalesce(p_inventory_ids, '{}'))
  ), prod as (
    select e.* from public.ccrs_filed_entities e
     where e.env = p_env and e.file_type = 'Product'
       and (e.external_id in (select i.product_external_id from inv i where i.product_external_id is not null)
            or e.external_id in (select c.external_id from public.ccrs_product_ids c where c.env = p_env)
            or e.filed_name = any(coalesce(p_product_names, '{}')))
  ), rest as (
    select e.* from public.ccrs_filed_entities e
     where e.env = p_env and e.file_type in ('Strain', 'Area')
  ), allx as (
    select * from inv union all select * from prod union all select * from rest
  )
  select coalesce(jsonb_agg(jsonb_build_array(a.file_type, a.external_id, a.filed_name, a.state, a.product_external_id)
                            order by a.file_type, a.external_id), '[]'::jsonb)
    into v_entries
    from allx a;

  return jsonb_build_object(
    'env', p_env,
    'loaded', exists (select 1 from public.ccrs_files f where f.env = p_env and f.purpose = 'seed' and f.state = 'closed'),
    'last_stamp', (select max(f.stamp_at) from public.ccrs_files f where f.env = p_env),
    'entries', v_entries,
    'product_ids', coalesce((select jsonb_agg(jsonb_build_array(c.product_key, c.external_id) order by c.product_key)
                               from public.ccrs_product_ids c where c.env = p_env), '[]'::jsonb));
end $$;

comment on function public.ccrs_ledger_slice(text, text[], text[]) is
  'S-12b: the ledger entries one batch routes against (Part 03 D.3), the env GWP- assignments, the last stamp, and whether the seed is finalized.';

-- ---------------------------------------------------------------------------
-- 8) Grants: these write the State's record — service role only.
-- ---------------------------------------------------------------------------
revoke all on function public.ccrs_emit_files(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.ccrs_assign_product_ids(text, text[], text, text) from public, anon, authenticated;
revoke all on function public.ccrs_link_unfiled_migration_lots(boolean) from public, anon, authenticated;
grant execute on function public.ccrs_emit_files(text, jsonb, jsonb) to service_role;
grant execute on function public.ccrs_assign_product_ids(text, text[], text, text) to service_role;
grant execute on function public.ccrs_link_unfiled_migration_lots(boolean) to service_role;
revoke all on function public.ccrs_seed_finalize(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.ccrs_ledger_slice(text, text[], text[]) from public, anon, authenticated;
grant execute on function public.ccrs_ledger_slice(text, text[], text[]) to service_role;
grant execute on function public.ccrs_seed_finalize(text, jsonb, jsonb) to service_role;
