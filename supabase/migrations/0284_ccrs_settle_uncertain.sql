-- 0284_ccrs_settle_uncertain.sql  (Round 6 / Slice R6-1)
--
-- WHY. The owner's first end-to-end PREprod upload (2026-10-20, evidence in
-- docs/ccrs-bible/evidence/2026-10-20-real-upload/) sent 18 Inventory Inserts.
-- CCRS refused 13 with "Duplicate External Identifier" and filed 5. The 13 are
-- exactly the lots whose strain CCRS also answered "Duplicate Strain": the
-- same vendor lots (same vendor ids, which we keep as our lot ids) had been
-- filed by an EARLIER PREprod test, while our PREprod ledger started EMPTY
-- (0249 ccrs_preprod_ledger_start). 0249 then marks the 13 "uncertain", and
-- routing holds an uncertain id out of every export until a Service Desk copy
-- settles it. That is right for production. In PREprod it means the 13 lots
-- can never be reported again, and the examiner has said PREprod cannot be
-- reset: "NO, you can request a copy from the Service Desk for what has been
-- reported to Preproduction and clean or work around the data." [EXAM L0518]
--
-- This migration adds two ways an uncertain id becomes "on file" again:
--
--   ccrs_prove_by_reference(env)    BOTH envs, automatic. A Sale or
--     InventoryAdjustment row that CCRS ACCEPTED names a lot. CCRS refuses such
--     a row with "Invalid InventoryExternalIdentifier" unless the inventory was
--     already reported [G L1302-L1304] [G L1082-L1084], so an accepted row
--     proves CCRS holds that lot. Only rows of a file uploaded AFTER the file
--     that made the lot uncertain count (a later file cannot be explained by an
--     earlier state). On 2026-10-20 the Sale file was accepted and named 4 of
--     the 13 refused lots (WA413287-INE6AQ, WA413287-INUKZB,
--     21375127720298989, 21375127433073461).
--
--   ccrs_preprod_settle_duplicates(by)   PREPROD ONLY, operator button. Every
--     PREprod Inventory / Product / Area id that is uncertain ONLY because CCRS
--     answered "Duplicate External Identifier" to our Insert becomes filed:
--     an Insert creates "a new record with a unique external identifier"
--     [G L0246], so the refusal says PREprod already holds the id. This is the
--     examiner's "work around the data" [EXAM L0518]. Production is refused
--     with no override: production uncertainty is settled only by a copy.
--
-- Both move entities exactly like ccrs_promote_rows (0249) does for an Insert:
-- state filed (closed when the last payload says QuantityOnHand 0), and an
-- Inventory lot gets product_external_id = the ONE present Product holding the
-- row's Product name exactly (else resolveProductName withholds it next week).
-- A reconciling file whose uncertain rows are all settled closes.
--
-- No new tables or columns. Service role only, search_path pinned, NOT
-- security definer, idempotent to re-create.
-- Rollback: supabase/rollbacks/0284_ccrs_settle_uncertain.rollback.sql

-- ---------------------------------------------------------------------------
-- 1) internal: close reconciling files of an env whose uncertain rows are all
--    settled (their entity is no longer uncertain).
-- ---------------------------------------------------------------------------
create or replace function public.ccrs_close_settled_files(p_env text, p_note text)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  update public.ccrs_files f
     set state = 'closed', reconciled_at = now(),
         notes = concat_ws(E'\n', nullif(f.notes, ''), p_note)
   where f.env = p_env and f.state = 'reconciling'
     and not exists (
       select 1 from public.ccrs_file_rows r
         join public.ccrs_filed_entities e
           on e.env = f.env and e.file_type = f.file_type and e.external_id = r.external_id
        where r.file_id = f.id and r.state = 'uncertain' and e.state = 'uncertain');
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.ccrs_close_settled_files(text, text) is
  'R6-1 internal: reconciling -> closed for files whose uncertain rows no longer have an uncertain entity.';

-- ---------------------------------------------------------------------------
-- 2) ccrs_prove_by_reference: an accepted event row proves its lot is held.
-- ---------------------------------------------------------------------------
create or replace function public.ccrs_prove_by_reference(p_env text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ids    text[];
  v_closed integer := 0;
begin
  if p_env is null or p_env not in ('preprod', 'prod') then
    raise exception 'CCRS_SETTLE_BAD_ENV: %', p_env using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('ccrs_lifecycle:' || p_env));

  with proof as (
    select distinct e.id, e.external_id
      from public.ccrs_filed_entities e
      join public.ccrs_files uf on uf.id = e.last_file_id
      join public.ccrs_file_rows r on r.payload->>'InventoryExternalIdentifier' = e.external_id
                                  and r.state in ('submitted', 'confirmed')
      join public.ccrs_files g on g.id = r.file_id
     where e.env = p_env and e.file_type = 'Inventory' and e.state = 'uncertain'
       and g.env = p_env and g.file_type in ('Sale', 'InventoryAdjustment')
       and g.state in ('succeeded', 'errored', 'reconciling', 'closed')
       and g.uploaded_at is not null and uf.uploaded_at is not null
       and g.uploaded_at > uf.uploaded_at
  ), upd as (
    update public.ccrs_filed_entities e
       set state = case when nullif(e.last_payload->>'QuantityOnHand', '')::numeric = 0 then 'closed' else 'filed' end,
           source = 'proof:reference',
           product_external_id = coalesce(e.product_external_id, (
             select case when count(*) = 1 then min(p.external_id) end
               from public.ccrs_filed_entities p
              where p.env = e.env and p.file_type = 'Product' and p.filed_name = e.last_payload->>'Product'
                and p.state in ('seed', 'filed', 'confirmed')))
      from proof
     where e.id = proof.id
    returning e.external_id
  )
  select coalesce(array_agg(external_id order by external_id), '{}') into v_ids from upd;

  if cardinality(v_ids) > 0 then
    insert into public.ccrs_file_issues (file_id, severity, code, message)
    select e.last_file_id, 'info', 'I_PROVED_BY_REFERENCE',
           e.external_id || ': CCRS accepted a later Sale/InventoryAdjustment row naming this lot, so CCRS holds it [G L1302-L1304]. Next export sends it as Update.'
      from public.ccrs_filed_entities e
     where e.env = p_env and e.file_type = 'Inventory' and e.external_id = any(v_ids);
    v_closed := public.ccrs_close_settled_files(p_env, 'Settled ' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI') || ' PT: every uncertain lot was proved by an accepted Sale/InventoryAdjustment row.');
  end if;

  return jsonb_build_object('env', p_env, 'proved', to_jsonb(v_ids), 'files_closed', v_closed);
end $$;

comment on function public.ccrs_prove_by_reference(text) is
  'R6-1: uncertain Inventory lots named by an accepted, later Sale/InventoryAdjustment row become filed ([G L1302-L1304]).';

-- ---------------------------------------------------------------------------
-- 3) ccrs_preprod_settle_duplicates: PREprod work-around [EXAM L0518].
-- ---------------------------------------------------------------------------
create or replace function public.ccrs_preprod_settle_duplicates(p_by text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rows   jsonb;
  v_closed integer := 0;
  v_stamp  text;
begin
  if length(trim(coalesce(p_by, ''))) = 0 then
    raise exception 'CCRS_SETTLE_BY: who settled it is recorded' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('ccrs_lifecycle:preprod'));
  v_stamp := to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI') || ' PT by ' || trim(p_by);

  with dup as (
    select distinct e.id
      from public.ccrs_filed_entities e
      join public.ccrs_file_rows r on r.file_id = e.last_file_id and r.external_id = e.external_id
      join public.ccrs_file_issues i on i.row_id = r.id
     where e.env = 'preprod' and e.state = 'uncertain'
       and e.file_type in ('Inventory', 'Product', 'Area')
       and r.operation = 'Insert' and r.state = 'uncertain'
       and i.code = 'CCRS_ROW_CONTRADICTS_LEDGER'
       and i.message like '%: Duplicate External Identifier'
  ), upd as (
    update public.ccrs_filed_entities e
       set state = case when e.file_type = 'Inventory' and nullif(e.last_payload->>'QuantityOnHand', '')::numeric = 0 then 'closed' else 'filed' end,
           source = 'preprod-settle:' || v_stamp,
           filed_name = case e.file_type when 'Product' then e.last_payload->>'Name' when 'Area' then e.last_payload->>'Area' else e.filed_name end,
           product_external_id = case when e.file_type = 'Inventory' then coalesce(e.product_external_id, (
             select case when count(*) = 1 then min(p.external_id) end
               from public.ccrs_filed_entities p
              where p.env = 'preprod' and p.file_type = 'Product' and p.filed_name = e.last_payload->>'Product'
                and p.state in ('seed', 'filed', 'confirmed'))) else e.product_external_id end
      from dup
     where e.id = dup.id
    returning e.file_type, e.external_id, e.last_file_id
  )
  select coalesce(jsonb_agg(jsonb_build_array(file_type, external_id) order by file_type, external_id), '[]'::jsonb)
    into v_rows from upd;

  if jsonb_array_length(v_rows) > 0 then
    insert into public.ccrs_file_issues (file_id, severity, code, message)
    select e.last_file_id, 'info', 'I_PREPROD_SETTLED',
           e.external_id || ': PREprod already held this id (Duplicate External Identifier on our Insert) from an earlier test. Treated as on file in PREprod only, per the examiner [EXAM L0518]. Next PREprod export sends it as Update.'
      from public.ccrs_filed_entities e
     where e.env = 'preprod' and e.source = 'preprod-settle:' || v_stamp
       and exists (select 1 from jsonb_array_elements(v_rows) x where x->>0 = e.file_type and x->>1 = e.external_id);
    v_closed := public.ccrs_close_settled_files('preprod', 'Settled ' || v_stamp || ': PREprod duplicates treated as on file [EXAM L0518].');
  end if;

  return jsonb_build_object('env', 'preprod', 'settled', v_rows, 'files_closed', v_closed);
end $$;

comment on function public.ccrs_preprod_settle_duplicates(text) is
  'R6-1: PREprod only. Ids uncertain only because CCRS answered Duplicate External Identifier to our Insert become filed ([G L0246], [EXAM L0518]).';

-- ---------------------------------------------------------------------------
-- 4) Grants: service role only.
-- ---------------------------------------------------------------------------
revoke all on function public.ccrs_close_settled_files(text, text) from public, anon, authenticated;
revoke all on function public.ccrs_prove_by_reference(text) from public, anon, authenticated;
revoke all on function public.ccrs_preprod_settle_duplicates(text) from public, anon, authenticated;
grant execute on function public.ccrs_close_settled_files(text, text) to service_role;
grant execute on function public.ccrs_prove_by_reference(text) to service_role;
grant execute on function public.ccrs_preprod_settle_duplicates(text) to service_role;
