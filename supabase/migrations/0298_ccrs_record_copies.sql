-- 0298_ccrs_record_copies.sql  (R74 S40, Round 20)
--
-- The CCRS Records page: upload a data copy received from the LCB Service
-- Desk (Inventory / Product / Strain / Area CSVs), compare it with our ledger,
-- our filings and our live lots, and merge it into the ledger from the admin
-- page instead of the S-15 command line. Idempotent.
--
--   ccrs_record_copies        one row per uploaded delivery (KEEP: what the
--                             State told us it holds, and when)
--   ccrs_record_copy_stage    the merge plan's writes, staged in chunks by the
--                             server just before the apply (WIPE: transient)
--   ccrs_records_ledger_page  read the prod ledger a page at a time (one jsonb
--                             array, so PostgREST's row cap never truncates it)
--   ccrs_records_sent_page    read every row we sent, a page at a time
--   ccrs_apply_record_copy    the guarded all-or-nothing merge (same rules as
--                             reseedApplyStatements: STALE refuses everything)
--   storage bucket ccrs-records (private)

create table if not exists public.ccrs_record_copies (
  id uuid primary key default gen_random_uuid(),
  env text not null default 'prod' check (env = 'prod'),
  as_of date not null,
  status text not null default 'uploading' check (status in ('uploading', 'ready', 'failed', 'applied', 'discarded')),
  files jsonb not null default '[]'::jsonb,
  summary jsonb,
  error text,
  notes text check (notes is null or length(notes) <= 2000),
  uploaded_by uuid,
  uploaded_by_email text,
  compared_at timestamptz,
  applied_at timestamptz,
  applied_by uuid,
  applied_by_email text,
  apply_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ccrs_record_copies_created on public.ccrs_record_copies (created_at desc);

alter table public.ccrs_record_copies enable row level security;
drop policy if exists "ccrs_record_copies staff read" on public.ccrs_record_copies;
create policy "ccrs_record_copies staff read" on public.ccrs_record_copies for select using (public.is_staff());

create table if not exists public.ccrs_record_copy_stage (
  copy_id uuid not null references public.ccrs_record_copies(id) on delete cascade,
  op text not null check (op in ('add', 'refresh', 'settleLink', 'settleUncertain')),
  file_type text not null check (file_type in ('Inventory', 'Product', 'Strain', 'Area')),
  external_id text not null check (external_id <> ''),
  filed_name text,
  product_external_id text,
  state text not null,
  payload jsonb not null,
  conflicts jsonb,
  expect_state text,
  expect_us bigint,
  primary key (copy_id, file_type, external_id)
);
alter table public.ccrs_record_copy_stage enable row level security;
drop policy if exists "ccrs_record_copy_stage staff read" on public.ccrs_record_copy_stage;
create policy "ccrs_record_copy_stage staff read" on public.ccrs_record_copy_stage for select using (public.is_staff());

-- Ledger rows, the LEDGER_READ_SQL shape (ccrs-reseed-core.ts), one page.
create or replace function public.ccrs_records_ledger_page(p_offset integer, p_limit integer)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(x.j order by x.t, x.id), '[]'::jsonb) from (
    select e.file_type as t, e.external_id as id,
      jsonb_build_object('t', e.file_type, 'id', e.external_id, 'name', e.filed_name, 'prod', e.product_external_id,
        'state', e.state, 'source', e.source, 'lastFile', e.last_file_id, 'lastOp', e.last_operation, 'uploadedAt', f.uploaded_at,
        'updatedAt', (extract(epoch from e.updated_at) * 1000000)::bigint::text, 'payload', e.seed_payload) as j
    from public.ccrs_filed_entities e left join public.ccrs_files f on f.id = e.last_file_id
    where e.env = 'prod' and e.file_type in ('Inventory', 'Product', 'Strain', 'Area')
    order by e.file_type, e.external_id
    offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 10000)
  ) x;
$$;

-- Sent rows, the SENT_READ_SQL shape (ccrs-copy-verify-core.ts), one page.
create or replace function public.ccrs_records_sent_page(p_offset integer, p_limit integer)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with ev as (
    select er.payload->>'InventoryExternalIdentifier' as lot, array_agg(ef.stamp_at) as stamps
      from public.ccrs_file_rows er join public.ccrs_files ef on ef.id = er.file_id
     where ef.env = 'prod' and ef.file_type in ('Sale', 'InventoryAdjustment')
       and ef.state in ('succeeded', 'errored', 'reconciling', 'closed') and er.state in ('submitted', 'confirmed')
     group by 1
  ), page as (
    select jsonb_build_object('t', f.file_type, 'id', r.external_id, 'op', r.operation, 'rowState', r.state, 'fileState', f.state,
        'file', f.file_name, 'stampUs', (extract(epoch from f.stamp_at) * 1000000)::bigint::text,
        'uploadedUs', (extract(epoch from f.uploaded_at) * 1000000)::bigint::text, 'rowNo', r.row_no, 'payload', r.payload,
        'eventsAfter', coalesce((select count(*) from unnest(ev.stamps) s where s > f.stamp_at), 0)) as j,
      row_number() over (order by f.file_type, r.external_id collate "C", f.stamp_at, r.row_no, f.id) as n
      from public.ccrs_file_rows r join public.ccrs_files f on f.id = r.file_id
      left join ev on f.file_type = 'Inventory' and ev.lot = r.external_id
     where f.env = 'prod' and f.purpose <> 'seed' and f.file_type in ('Inventory', 'Product', 'Strain', 'Area')
       and f.state in ('uploaded', 'succeeded', 'errored', 'reconciling', 'closed')
  )
  select coalesce(jsonb_agg(j order by n), '[]'::jsonb) from page
   where n > greatest(p_offset, 0) and n <= greatest(p_offset, 0) + least(greatest(p_limit, 1), 10000);
$$;

-- The guarded merge. p_provenance: [{source,fileName,sha256,rows,storagePath}] x4.
create or replace function public.ccrs_apply_record_copy(
  p_copy_id uuid, p_expect_add integer, p_expect_upd integer, p_provenance jsonb,
  p_actor uuid, p_actor_email text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c public.ccrs_record_copies%rowtype;
  v_src text;
  v_stage integer;
  v_add integer;
  v_upd integer;
  v_prov integer;
  v_result jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('ccrs_seed_finalize'));
  select * into c from public.ccrs_record_copies where id = p_copy_id for update;
  if not found then
    raise exception 'CCRS_COPY_NOT_FOUND: no such CCRS copy' using errcode = 'check_violation';
  end if;
  if c.status <> 'ready' then
    raise exception 'CCRS_COPY_NOT_READY: this copy is %, only a compared (ready) copy can be merged', c.status using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.ccrs_files where env = 'prod' and purpose = 'seed' and state = 'closed') then
    raise exception 'CCRS_RESEED_NOT_SEEDED: the production ledger was never seeded' using errcode = 'check_violation';
  end if;
  if c.as_of <= date '2026-09-18' then
    raise exception 'CCRS_COPY_TOO_OLD: a merge needs a copy dated after 2026-09-18 (the delivery already seeded)' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_provenance) is distinct from 'array' or jsonb_array_length(p_provenance) <> 4
     or (select count(distinct x->>'source') from jsonb_array_elements(p_provenance) x where x->>'source' in ('Inventory', 'Product', 'Strain', 'Area')) <> 4
     or exists (select 1 from jsonb_array_elements(p_provenance) x where coalesce(x->>'sha256', '') !~ '^[0-9a-f]{64}$') then
    raise exception 'CCRS_COPY_PROVENANCE: exactly one Inventory, Product, Strain and Area file with a sha256 each' using errcode = 'check_violation';
  end if;
  v_src := 'seed:' || to_char(c.as_of, 'YYYY-MM-DD') || '-delivery';

  select count(*) into v_stage from public.ccrs_record_copy_stage where copy_id = p_copy_id;
  if v_stage <> coalesce(p_expect_add, -1) + coalesce(p_expect_upd, -1) then
    raise exception 'CCRS_RESEED_STAGE: staged % rows, the plan has %', v_stage, coalesce(p_expect_add, 0) + coalesce(p_expect_upd, 0) using errcode = 'check_violation';
  end if;

  insert into public.ccrs_filed_entities (env, file_type, external_id, filed_name, product_external_id, state, source, seed_payload, seed_conflicts)
  select 'prod', s.file_type, s.external_id, s.filed_name, s.product_external_id, s.state, v_src, s.payload, s.conflicts
    from public.ccrs_record_copy_stage s where s.copy_id = p_copy_id and s.op = 'add'
  on conflict (env, file_type, external_id) do nothing;
  get diagnostics v_add = row_count;
  if v_add <> p_expect_add then
    raise exception 'CCRS_RESEED_STALE: added % of % new records; the ledger changed since the comparison. Nothing was written. Compare again.', v_add, p_expect_add using errcode = 'check_violation';
  end if;

  update public.ccrs_filed_entities e
     set state = s.state, filed_name = s.filed_name, product_external_id = s.product_external_id,
         seed_payload = s.payload, seed_conflicts = s.conflicts, source = v_src
    from public.ccrs_record_copy_stage s
   where s.copy_id = p_copy_id and s.op <> 'add' and e.env = 'prod' and e.file_type = s.file_type and e.external_id = s.external_id
     and e.state = s.expect_state and (extract(epoch from e.updated_at) * 1000000)::bigint = s.expect_us;
  get diagnostics v_upd = row_count;
  if v_upd <> p_expect_upd then
    raise exception 'CCRS_RESEED_STALE: updated % of % records; the ledger changed since the comparison. Nothing was written. Compare again.', v_upd, p_expect_upd using errcode = 'check_violation';
  end if;

  perform public.ccrs_link_unfiled_migration_lots(true);

  insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path, state, notes)
  select 'prod', x->>'source', 'seed', v_src || ':' || left(x->>'sha256', 12) || ':' || coalesce(nullif(x->>'fileName', ''), x->>'source'),
         x->>'sha256', coalesce((x->>'rows')::integer, 0), x->>'storagePath', 'closed',
         'LCB Service Desk delivery current through ' || to_char(c.as_of, 'YYYY-MM-DD') || ' (Part 17 G-1, U-30). Merged on the CCRS Records page (R74 S40): +'
           || v_add || ' new, ' || v_upd || ' updated.'
    from jsonb_array_elements(p_provenance) x
  on conflict do nothing;
  get diagnostics v_prov = row_count;

  delete from public.ccrs_record_copy_stage where copy_id = p_copy_id;
  v_result := jsonb_build_object('added', v_add, 'updated', v_upd, 'provenance', v_prov, 'source', v_src);
  update public.ccrs_record_copies
     set status = 'applied', applied_at = now(), applied_by = p_actor, applied_by_email = p_actor_email, apply_result = v_result, updated_at = now()
   where id = p_copy_id;
  return v_result;
end $$;

revoke all on function public.ccrs_records_ledger_page(integer, integer) from public, anon, authenticated;
revoke all on function public.ccrs_records_sent_page(integer, integer) from public, anon, authenticated;
revoke all on function public.ccrs_apply_record_copy(uuid, integer, integer, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.ccrs_records_ledger_page(integer, integer) to service_role;
grant execute on function public.ccrs_records_sent_page(integer, integer) to service_role;
grant execute on function public.ccrs_apply_record_copy(uuid, integer, integer, jsonb, uuid, text) to service_role;

insert into storage.buckets (id, name, public)
values ('ccrs-records', 'ccrs-records', false)
on conflict (id) do nothing;

do $m$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute 'update storage.buckets set file_size_limit = 104857600 where id = ''ccrs-records''';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute 'update storage.buckets set allowed_mime_types = array[''text/csv'', ''text/plain''] where id = ''ccrs-records''';
  end if;
end
$m$;
