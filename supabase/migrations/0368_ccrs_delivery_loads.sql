-- 0368_ccrs_delivery_loads.sql  (D250 slice 3)
--
-- Load the examiner delivery of 2026-11-13 and 2026-11-17 into the production
-- CCRS ledger from the CCRS Records page (or the load-ccrs-delivery script).
-- The delivery is a DELTA laid on top of the 9/18 seed. The plan is made by
-- src/lib/compliance/ccrs-delivery-core.ts (planDeliveryMerge). This file
-- only stores the plan and applies it, all or nothing. Idempotent.
--
--   (both tables: RLS on, no policies, service role only - the page reads
--   them on the server)
--   ccrs_delivery_loads   one row per uploaded delivery (KEEP: what the State
--                         told us it holds, and when)
--   ccrs_delivery_stage   the plan writes, staged just before the apply
--                         (transient: the apply empties it)
--   ccrs_apply_delivery   the guarded merge. Every change carries the state
--                         and updated_at the plan saw. If one moved, STALE
--                         refuses everything. Each write keeps its own source:
--                           seed:<as_of>-delivery        a delivered record
--                           proof:<as_of>-delivery-sale  a lot proven only by a
--                                                        sale CCRS accepted
--   bucket ccrs-records   also accepts the xlsx sheet file of the delivery

create table if not exists public.ccrs_delivery_loads (
  id uuid primary key default gen_random_uuid(),
  env text not null default 'prod' check (env = 'prod'),
  as_of date not null,
  status text not null default 'uploading' check (status in ('uploading', 'ready', 'failed', 'applied', 'discarded')),
  files jsonb not null default '[]'::jsonb,
  summary jsonb,
  report text,
  error text,
  notes text check (notes is null or length(notes) <= 2000),
  uploaded_by uuid,
  uploaded_by_email text,
  planned_at timestamptz,
  applied_at timestamptz,
  applied_by uuid,
  applied_by_email text,
  apply_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ccrs_delivery_loads_created on public.ccrs_delivery_loads (created_at desc);

alter table public.ccrs_delivery_loads enable row level security;

create table if not exists public.ccrs_delivery_stage (
  load_id uuid not null references public.ccrs_delivery_loads(id) on delete cascade,
  op text not null check (op in ('add', 'refresh', 'settleLink')),
  file_type text not null check (file_type in ('Inventory', 'Product', 'Strain', 'Area')),
  external_id text not null check (external_id <> ''),
  filed_name text,
  product_external_id text,
  state text not null check (state in ('seed', 'closed', 'unknown')),
  source text not null check (source ~ '^(seed:\d{4}-\d{2}-\d{2}-delivery|proof:\d{4}-\d{2}-\d{2}-delivery-sale)$'),
  payload jsonb not null,
  conflicts jsonb,
  expect_state text,
  expect_us bigint,
  primary key (load_id, file_type, external_id),
  check ((op = 'add') = (expect_state is null and expect_us is null))
);
alter table public.ccrs_delivery_stage enable row level security;

-- p_provenance: [{role, fileName, sha256, rows, storagePath}], 1 to 10 files.
-- role is the ledger file type the file is recorded under (Inventory for the
-- inventory and sales CSVs, Product for the xlsx sheet file).
create or replace function public.ccrs_apply_delivery(
  p_load_id uuid, p_expect_add integer, p_expect_upd integer, p_provenance jsonb,
  p_actor uuid, p_actor_email text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d public.ccrs_delivery_loads%rowtype;
  v_seed text;
  v_proof text;
  v_stage integer;
  v_add integer;
  v_upd integer;
  v_prov integer;
  v_n integer;
  v_result jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('ccrs_seed_finalize'));
  select * into d from public.ccrs_delivery_loads where id = p_load_id for update;
  if not found then
    raise exception 'CCRS_DELIVERY_NOT_FOUND: no such delivery load' using errcode = 'check_violation';
  end if;
  if d.status <> 'ready' then
    raise exception 'CCRS_DELIVERY_NOT_READY: this load is %, only a checked (ready) load can be applied', d.status using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.ccrs_files where env = 'prod' and purpose = 'seed' and state = 'closed') then
    raise exception 'CCRS_RESEED_NOT_SEEDED: the production ledger was never seeded' using errcode = 'check_violation';
  end if;
  if d.as_of <= date '2026-09-18' then
    raise exception 'CCRS_DELIVERY_TOO_OLD: a delivery must be dated after 2026-09-18 (the delivery already seeded)' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_provenance) is distinct from 'array' or jsonb_array_length(p_provenance) < 1 or jsonb_array_length(p_provenance) > 10
     or exists (select 1 from jsonb_array_elements(p_provenance) x
                 where coalesce(x->>'sha256', '') !~ '^[0-9a-f]{64}$' or coalesce(x->>'role', '') not in ('Inventory', 'Product', 'Strain', 'Area'))
     or (select count(distinct x->>'sha256') from jsonb_array_elements(p_provenance) x) <> jsonb_array_length(p_provenance) then
    raise exception 'CCRS_DELIVERY_PROVENANCE: 1 to 10 distinct files, each with a role and a sha256' using errcode = 'check_violation';
  end if;
  v_seed := 'seed:' || to_char(d.as_of, 'YYYY-MM-DD') || '-delivery';
  v_proof := 'proof:' || to_char(d.as_of, 'YYYY-MM-DD') || '-delivery-sale';

  select count(*) into v_stage from public.ccrs_delivery_stage where load_id = p_load_id;
  if v_stage <> coalesce(p_expect_add, -1) + coalesce(p_expect_upd, -1) then
    raise exception 'CCRS_RESEED_STAGE: staged % rows, the plan has %', v_stage, coalesce(p_expect_add, 0) + coalesce(p_expect_upd, 0) using errcode = 'check_violation';
  end if;
  select count(*) into v_n from public.ccrs_delivery_stage where load_id = p_load_id and source not in (v_seed, v_proof);
  if v_n > 0 then
    raise exception 'CCRS_DELIVERY_SOURCE: % staged rows carry a source not dated %', v_n, to_char(d.as_of, 'YYYY-MM-DD') using errcode = 'check_violation';
  end if;

  insert into public.ccrs_filed_entities (env, file_type, external_id, filed_name, product_external_id, state, source, seed_payload, seed_conflicts)
  select 'prod', s.file_type, s.external_id, s.filed_name, s.product_external_id, s.state, s.source, s.payload, s.conflicts
    from public.ccrs_delivery_stage s where s.load_id = p_load_id and s.op = 'add'
  on conflict (env, file_type, external_id) do nothing;
  get diagnostics v_add = row_count;
  if v_add <> p_expect_add then
    raise exception 'CCRS_RESEED_STALE: added % of % new records; the ledger changed since the check. Nothing was written. Check again.', v_add, p_expect_add using errcode = 'check_violation';
  end if;

  update public.ccrs_filed_entities e
     set state = s.state, filed_name = s.filed_name, product_external_id = s.product_external_id,
         seed_payload = s.payload, seed_conflicts = s.conflicts, source = s.source
    from public.ccrs_delivery_stage s
   where s.load_id = p_load_id and s.op <> 'add' and e.env = 'prod' and e.file_type = s.file_type and e.external_id = s.external_id
     and e.last_file_id is null
     and e.state = s.expect_state and (extract(epoch from e.updated_at) * 1000000)::bigint = s.expect_us;
  get diagnostics v_upd = row_count;
  if v_upd <> p_expect_upd then
    raise exception 'CCRS_RESEED_STALE: updated % of % records; the ledger changed since the check. Nothing was written. Check again.', v_upd, p_expect_upd using errcode = 'check_violation';
  end if;

  perform public.ccrs_link_unfiled_migration_lots(true);

  insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path, state, notes)
  select 'prod', x->>'role', 'seed', v_seed || ':' || left(x->>'sha256', 12) || ':' || coalesce(nullif(x->>'fileName', ''), x->>'role'),
         x->>'sha256', coalesce((x->>'rows')::integer, 0),
         coalesce(nullif(x->>'storagePath', ''), 'local:' || coalesce(nullif(x->>'fileName', ''), x->>'role')), 'closed',
         'LCB examiner delivery current through ' || to_char(d.as_of, 'YYYY-MM-DD') || ' (D250). Loaded on top of the 9/18 seed: +'
           || v_add || ' new, ' || v_upd || ' updated.'
    from jsonb_array_elements(p_provenance) x
  on conflict do nothing;
  get diagnostics v_prov = row_count;

  delete from public.ccrs_delivery_stage where load_id = p_load_id;
  v_result := jsonb_build_object('added', v_add, 'updated', v_upd, 'provenance', v_prov, 'source', v_seed, 'proofSource', v_proof);
  update public.ccrs_delivery_loads
     set status = 'applied', applied_at = now(), applied_by = p_actor, applied_by_email = p_actor_email, apply_result = v_result, updated_at = now()
   where id = p_load_id;
  return v_result;
end $$;

revoke all on table public.ccrs_delivery_loads from public, anon, authenticated;
revoke all on table public.ccrs_delivery_stage from public, anon, authenticated;
grant select, insert, update, delete on table public.ccrs_delivery_loads to service_role;
grant select, insert, update, delete on table public.ccrs_delivery_stage to service_role;
revoke all on function public.ccrs_apply_delivery(uuid, integer, integer, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.ccrs_apply_delivery(uuid, integer, integer, jsonb, uuid, text) to service_role;

-- The delivery's sheet file is an xlsx. Allow it next to the CSVs.
do $m$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute 'update storage.buckets set allowed_mime_types = array[''text/csv'', ''text/plain'', ''application/vnd.openxmlformats-officedocument.spreadsheetml.sheet''] where id = ''ccrs-records''';
  end if;
end
$m$;
