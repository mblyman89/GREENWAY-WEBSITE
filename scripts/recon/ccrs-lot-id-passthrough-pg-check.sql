-- scripts/recon/ccrs-lot-id-passthrough-pg-check.sql  (CCRS Bible v2 S-10 - migration 0246)
--
-- Scenario check for 0246_ccrs_lot_external_id_passthrough.sql against a real
-- Postgres with all migrations applied. ONE transaction, rolled back, so it
-- leaves nothing behind. Seeds seven lots covering every edge, applies the
-- migration TWICE (idempotency), asserts exactly which ids changed and that
-- exactly one audit row per changed lot was written, then applies the
-- rollback and asserts every id is back and the audit rows are gone.
-- A run that prints CCRS LOT ID PASSTHROUGH CHECK PASSED then ROLLBACK is the
-- all-clear.
--
--   psql -d greenway -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-lot-id-passthrough-pg-check.sql
begin;

-- Seed. M = Cultivera migration marker (bulk-fill-core.ts MIGRATION_MARKER).
insert into public.inventory_lots (id, lot_code, ccrs_inventory_external_id, notes) values
  -- 1 REPAIR: migration lot, dotted barcode, stored id = 0034 sanitized form
  ('00000000-0000-4000-8000-000000002461', 'WA413287.IN0W29', 'WA413287-IN0W29',
   'Cultivera migration (one-time POS import). Received 2026-06-17.'),
  -- 2 REPAIR: dotted + surrounding spaces in lot_code (trim applies)
  ('00000000-0000-4000-8000-000000002462', ' WAR413541.IN132IB0 ', 'WAR413541-IN132IB0',
   'Cultivera migration (one-time POS import).'),
  -- 3 KEEP: operator hand-set id (not the sanitized form)
  ('00000000-0000-4000-8000-000000002463', 'WA413287.INCY2E', 'HAND-SET-ID',
   'Cultivera migration (one-time POS import).'),
  -- 4 KEEP: NOT a migration lot (manifest intake), even though dotted+sanitized
  ('00000000-0000-4000-8000-000000002464', 'WA413287.INUC8M', 'WA413287-INUC8M',
   'Received via manifest 123.'),
  -- 5 KEEP: migration lot, no dot (space-bearing accessory; out of scope)
  ('00000000-0000-4000-8000-000000002465', 'Firebros Lanyard', 'Firebros-Lanyard',
   'Cultivera migration (one-time POS import).'),
  -- 6 KEEP: already correct (dotted id stored as filed)
  ('00000000-0000-4000-8000-000000002466', 'WA413287.IN5IS7', 'WA413287.IN5IS7',
   'Cultivera migration (one-time POS import).'),
  -- 7 KEEP: NULL notes
  ('00000000-0000-4000-8000-000000002467', 'WA1.X', 'WA1-X', null);

\i supabase/migrations/0246_ccrs_lot_external_id_passthrough.sql
\i supabase/migrations/0246_ccrs_lot_external_id_passthrough.sql

do $$
declare
  n int;
begin
  assert (select ccrs_inventory_external_id from public.inventory_lots where id = '00000000-0000-4000-8000-000000002461') = 'WA413287.IN0W29', 'lot 1 must be repaired to the dotted filed id';
  assert (select ccrs_inventory_external_id from public.inventory_lots where id = '00000000-0000-4000-8000-000000002462') = 'WAR413541.IN132IB0', 'lot 2 must be repaired and trimmed';
  assert (select ccrs_inventory_external_id from public.inventory_lots where id = '00000000-0000-4000-8000-000000002463') = 'HAND-SET-ID', 'lot 3 hand-set id must be untouched';
  assert (select ccrs_inventory_external_id from public.inventory_lots where id = '00000000-0000-4000-8000-000000002464') = 'WA413287-INUC8M', 'lot 4 non-migration lot must be untouched';
  assert (select ccrs_inventory_external_id from public.inventory_lots where id = '00000000-0000-4000-8000-000000002465') = 'Firebros-Lanyard', 'lot 5 undotted must be untouched';
  assert (select ccrs_inventory_external_id from public.inventory_lots where id = '00000000-0000-4000-8000-000000002466') = 'WA413287.IN5IS7', 'lot 6 already-correct must be untouched';
  assert (select ccrs_inventory_external_id from public.inventory_lots where id = '00000000-0000-4000-8000-000000002467') = 'WA1-X', 'lot 7 null-notes must be untouched';
  select count(*) into n from public.audit_logs where actor_email = 'migration:0246';
  assert n = 2, 'exactly one audit row per repaired lot across two runs (got ' || n || ')';
  select count(*) into n from public.audit_logs
   where actor_email = 'migration:0246'
     and entity_id = '00000000-0000-4000-8000-000000002461'
     and before_json ->> 'ccrs_inventory_external_id' = 'WA413287-IN0W29'
     and after_json  ->> 'ccrs_inventory_external_id' = 'WA413287.IN0W29';
  assert n = 1, 'audit row must hold exact before/after ids';
end $$;

-- A later human edit on lot 2 must survive the rollback.
update public.inventory_lots set ccrs_inventory_external_id = 'OWNER-FIXED'
 where id = '00000000-0000-4000-8000-000000002462';

\i supabase/rollbacks/0246_ccrs_lot_external_id_passthrough.rollback.sql

do $$
begin
  assert (select ccrs_inventory_external_id from public.inventory_lots where id = '00000000-0000-4000-8000-000000002461') = 'WA413287-IN0W29', 'rollback must restore lot 1';
  assert (select ccrs_inventory_external_id from public.inventory_lots where id = '00000000-0000-4000-8000-000000002462') = 'OWNER-FIXED', 'rollback must not undo a later human edit';
  assert (select count(*) from public.audit_logs where actor_email = 'migration:0246') = 0, 'rollback must remove its audit rows';
  raise notice 'CCRS LOT ID PASSTHROUGH CHECK PASSED';
end $$;

rollback;
