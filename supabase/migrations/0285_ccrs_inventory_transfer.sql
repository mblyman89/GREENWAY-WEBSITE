-- 0285_ccrs_inventory_transfer.sql  (Round 6 / Slice R6-2, Part 09 S-05)
--
-- WHY. "InventoryTransfer.CSV is required weekly by any licensed facility that
-- receives inventory." [G L1162]. "Only the receiving licensee should submit
-- an inventory transfer report" [G L0124-L0128], and for a retailer: "The
-- retailer uploads a product to create a product, inventory and inventory
-- transfer files." [G L0143-L0144]. Until now the batch emitted the file
-- EMPTY with a note that retail intake is covered by Inventory.csv (Part 04
-- E14). That note was wrong.
--
-- A transfer row names the vendor's lot as FromInventoryExternalIdentifier,
-- exactly as the vendor filed it ("the 'From' ID is assigned as the original
-- ID by the producer or processor" [FAQ L0059]); a wrong one is answered
-- "Invalid FromInventoryExternalIdentifier" [G L1191]. Intake kept that id
-- only inside lot_code, mixed with PDF guesses that may be a batch number, so
-- this migration gives it its own column with a provenance stamp:
--
--   inventory_lots.vendor_inventory_external_id         raw, never sanitized
--   inventory_lots.vendor_inventory_external_id_source  wcia_json | ccrs_csv |
--                                                       pdf_guess | owner_entered | unknown
--
-- BACKFILL (fill-only, real deliveries only). lot_code holds the vendor id
-- for WCIA JSON (intake-parser.ts: lot_code <- inventory_id) and for CCRS
-- manifest CSVs (ccrs-manifest-csv-core.ts: InventoryExternalIdentifier).
-- A PDF manifest picks lot_code from lot/batch keys, so it is stamped
-- pdf_guess and the transfer builder will not send it until a person
-- confirms it. Cultivera migration lots are NOT touched: Cultivera filed
-- their transfers (raw_payload.kind is a migration kind, or the legacy
-- POS-IMPORT- number, or the notes carry the migration marker).
--
-- ccrs_transfer_slice(env, ids) is read-only: per transfer ExternalIdentifier
-- it says what the env's ledger holds and whether a file naming it is still
-- unanswered, so a transfer is reported ONCE ("Duplicate InventoryTransfer
-- for Licensee" [G L1190]) and never guessed.
--
-- Idempotent. Owner applies MANUALLY in the Supabase SQL editor.
-- Rollback: supabase/rollbacks/0285_ccrs_inventory_transfer.rollback.sql.
-- Check: scripts/recon/ccrs-transfer-0285-pg-check.sql.

alter table public.inventory_lots
  add column if not exists vendor_inventory_external_id text,
  add column if not exists vendor_inventory_external_id_source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_vendor_inv_ext_id_source_check') then
    alter table public.inventory_lots
      add constraint inventory_lots_vendor_inv_ext_id_source_check
      check (vendor_inventory_external_id_source is null
             or vendor_inventory_external_id_source in ('wcia_json', 'ccrs_csv', 'pdf_guess', 'owner_entered', 'unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_vendor_inv_ext_id_shape_check') then
    alter table public.inventory_lots
      add constraint inventory_lots_vendor_inv_ext_id_shape_check
      check (vendor_inventory_external_id is null
             or (vendor_inventory_external_id <> '' and length(vendor_inventory_external_id) <= 100));
  end if;
end $$;

comment on column public.inventory_lots.vendor_inventory_external_id is
  'R6-2: the SENDING licensee''s InventoryExternalIdentifier exactly as filed (FromInventoryExternalIdentifier on InventoryTransfer.csv [G L1211-L1221], [FAQ L0059]). Never sanitized.';
comment on column public.inventory_lots.vendor_inventory_external_id_source is
  'R6-2: where the vendor id came from: wcia_json | ccrs_csv (machine-read ids) | pdf_guess (may be a batch number; not sent until confirmed) | owner_entered | unknown.';

with src as (
  select l.id,
         left(trim(l.lot_code), 100) as vid,
         case m.source_format when 'wcia' then 'wcia_json' when 'ccrs-csv' then 'ccrs_csv'
                              when 'pdf-manifest' then 'pdf_guess' else 'unknown' end as how
    from public.inventory_lots l
    join public.inbound_manifests m on m.id = l.manifest_id
   where l.vendor_inventory_external_id is null
     and nullif(trim(l.lot_code), '') is not null
     and coalesce(m.raw_payload->>'kind', '') not in ('pos-import-migration', 'cultivera-reconstructed')
     and upper(coalesce(m.manifest_number, '')) not like 'POS-IMPORT-%'
     and coalesce(l.notes, '') not like '%Cultivera migration (one-time POS import).%'
), done as (
  update public.inventory_lots l
     set vendor_inventory_external_id = s.vid,
         vendor_inventory_external_id_source = s.how
    from src s
   where l.id = s.id
  returning s.how
)
insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, before_json, after_json)
select null, 'migration:0285', 'migration_0285.vendor_inventory_external_id_backfill', 'inventory_lot', 'batch',
       null, jsonb_build_object('lots', count(*), 'by_source', jsonb_object_agg(x.how, x.n))
  from (select how, count(*) as n from done group by how) x
having count(*) > 0;

create or replace function public.ccrs_transfer_slice(p_env text, p_ids text[])
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_entries jsonb;
begin
  if p_env not in ('preprod', 'prod') then
    raise exception 'CCRS_TRANSFER_SLICE_BAD_ENV: %', p_env using errcode = 'check_violation';
  end if;
  with ids as (
    select distinct u.id from unnest(coalesce(p_ids, '{}')) as u(id) where coalesce(u.id, '') <> ''
  ), x as (
    select i.id,
           e.state,
           exists (
             select 1 from public.ccrs_file_rows r
               join public.ccrs_files f on f.id = r.file_id
              where f.env = p_env and f.file_type = 'InventoryTransfer' and f.state in ('emitted', 'uploaded')
                and r.external_id = i.id
           ) as in_flight
      from ids i
      left join public.ccrs_filed_entities e
        on e.env = p_env and e.file_type = 'InventoryTransfer' and e.external_id = i.id
  )
  select coalesce(jsonb_agg(jsonb_build_array(x.id, x.state, x.in_flight) order by x.id), '[]'::jsonb)
    into v_entries
    from x
   where x.state is not null or x.in_flight;
  return jsonb_build_object('env', p_env, 'entries', v_entries);
end $$;

comment on function public.ccrs_transfer_slice(text, text[]) is
  'R6-2: ledger state and in-flight flag of InventoryTransfer ExternalIdentifiers a batch would send. Read-only.';

revoke all on function public.ccrs_transfer_slice(text, text[]) from public, anon, authenticated;
grant execute on function public.ccrs_transfer_slice(text, text[]) to service_role;
