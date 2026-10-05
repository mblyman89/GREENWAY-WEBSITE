-- 0246_ccrs_lot_external_id_passthrough.sql  (CCRS Bible v2, slice S-10)
--
-- Restore filed CCRS InventoryExternalIdentifiers that 0034 / the one-time
-- Cultivera import rewrote.
--
-- CCRS matches every row by its ExternalIdentifier exactly as filed
-- (Upload Guide [G L0247]: Update alters "an existing record indicated by
-- external identifier"; [G L1077-L1083]: an adjustment's id must be an
-- Inventory.ExternalIdentifier. The Inventory ExternalIdentifier is reused on
-- InventoryAdjustment/Sale/Transfer). 0034 and the pre-S-10 import "sanitized"
-- ids to [A-Za-z0-9-], turning a filed barcode like WA413287.IN0W29 into
-- WA413287-IN0W29. That is a DIFFERENT id in CCRS: an Update under it is
-- refused because "The record doesn't exist" [FAQ L0053], and an Insert under
-- it would file a second lot for the same physical stock.
--
-- Measured 2026-10-05 against the CCRS Service Desk copy + back-office export
-- (analysis3/dotted_repair_probe.out): 186 back-office barcodes change under
-- sanitizing; 180 are filed in CCRS EXACTLY as written (dotted); 0 of the
-- hyphenated forms is a filed id. So the dotted lot_code is the true id.
--
-- Scope (deliberately narrow):
--   * only one-time Cultivera migration lots (notes carry the import marker,
--     bulk-fill-core.ts MIGRATION_MARKER), whose lot_code IS the POS barcode;
--   * only lot_codes containing '.' (the measured filed case; space-bearing
--     accessory barcodes are not cannabis lots and are left alone);
--   * only rows whose stored id equals exactly what 0034's sanitizer produces
--     from lot_code, so any id an operator set by hand is never touched.
--
-- AUDIT + EXACT ROLLBACK: every lot changed gets one audit_logs row
-- (actor_email 'migration:0246') holding the BEFORE id; the rollback
-- (supabase/rollbacks/0246_...rollback.sql) restores exactly those lots, and
-- only where the id is still the one 0246 wrote. Owner applies MANUALLY in
-- the Supabase SQL editor. Check queries:
-- scripts/recon/ccrs-lot-id-passthrough-pg-check.sql.
--
-- Idempotent: after the first run the stored id equals trim(lot_code), which
-- contains a '.', so it can no longer equal the dot-free sanitized form and
-- the WHERE clause no longer matches (no separate guard needed; S-10 SQL
-- mutant Q5 proved such a guard redundant). Safe on an empty database.

with repaired as (
  update public.inventory_lots l
     set ccrs_inventory_external_id = trim(l.lot_code)
   where l.notes like '%Cultivera migration (one-time POS import).%'
     and l.lot_code is not null
     and trim(l.lot_code) like '%.%'
     and length(trim(l.lot_code)) <= 100
     and l.ccrs_inventory_external_id = left(
           trim(both '-' from regexp_replace(trim(l.lot_code), '[^A-Za-z0-9]+', '-', 'g')),
           100
         )
  returning l.id,
            left(trim(both '-' from regexp_replace(trim(l.lot_code), '[^A-Za-z0-9]+', '-', 'g')), 100) as before_id,
            l.ccrs_inventory_external_id as after_id
)
insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, before_json, after_json)
select
  null,
  'migration:0246',
  'migration_0246.ccrs_external_id_passthrough',
  'inventory_lot',
  r.id::text,
  jsonb_build_object('ccrs_inventory_external_id', r.before_id),
  jsonb_build_object(
    'ccrs_inventory_external_id', r.after_id,
    'basis', 'Filed CCRS id is the barcode exactly as written (dotted); 0034 had sanitized it. CCRS Bible v2 S-10.'
  )
from repaired r;
