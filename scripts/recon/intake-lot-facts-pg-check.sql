-- scripts/recon/intake-lot-facts-pg-check.sql  (R25 A - migration 0244)
--
-- Scenario check for 0244_intake_lot_received_date_strain_type_backfill.sql
-- against a REAL Postgres that has every migration 0001..0243 applied (the
-- verify-migrations-execute.ts database). Runs in ONE transaction that is
-- rolled back, so it leaves nothing behind.
--
-- Seeds one lot per edge case, applies 0244 TWICE (idempotency), asserts
-- every outcome, applies the ROLLBACK and asserts it restored exactly the
-- BEFORE values, then applies 0244 again (re-apply after rollback works).
-- A run that prints INTAKE LOT FACTS CHECK PASSED then ROLLBACK is the
-- all-clear.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/intake-lot-facts-pg-check.sql
begin;

create temp table k (name text primary key, id uuid not null default gen_random_uuid()) on commit drop;
insert into k (name) values
  ('m_real'), ('m_refinal'), ('m_import'), ('m_import_kind'), ('m_late'), ('m_open'),
  ('l_plain'), ('l_has_date'), ('l_refused'), ('l_import'), ('l_import_kind'), ('l_refinal'),
  ('l_late'), ('l_open'), ('l_held'),
  ('l_pending'), ('l_status_rej'), ('l_pick'), ('l_pick_same'), ('l_pick_edited'), ('l_no_pick'), ('l_unapproved'), ('l_junk'), ('l_two'),
  ('d_pick'), ('d_pick_same'), ('d_pick_edited'), ('d_no_pick'), ('d_unapproved'), ('d_junk'), ('d_two_old'), ('d_two_new');

create or replace function pg_temp.kid(n text) returns uuid language sql stable as $$ select id from k where name = n $$;

-- Manifests --------------------------------------------------------------
-- m_real:   accepted 2026-07-15 18:00Z (11am Pacific) -> 2026-07-15
-- m_refinal: accepted_at rewritten later (2026-07-20) but the lot's first
--            receive adjustment is 2026-07-10 -> the EARLIER wins: 2026-07-10
-- m_import: the Cultivera synthetic manifest (by number)   -> excluded
-- m_import_kind: synthetic by raw_payload kind only        -> excluded
-- m_late:   accepted 2026-07-16 06:30Z = 11:30pm Pacific 07-15 -> 2026-07-15
-- m_open:   never accepted (accepted_at null)              -> excluded
insert into public.inbound_manifests (id, manifest_number, status, accepted_at, raw_payload) values
  (pg_temp.kid('m_real'),        '0421',              'accepted', '2026-07-15T18:00:00Z', '{}'),
  (pg_temp.kid('m_refinal'),     '0422',              'accepted', '2026-07-20T18:00:00Z', '{}'),
  (pg_temp.kid('m_import'),      'POS-IMPORT-abcd1234','accepted', '2026-06-01T18:00:00Z', '{}'),
  (pg_temp.kid('m_import_kind'), 'X-1',               'accepted', '2026-06-01T18:00:00Z', '{"kind":"pos-import-migration"}'),
  (pg_temp.kid('m_late'),        '0423',              'accepted', '2026-07-16T06:30:00Z', '{}'),
  (pg_temp.kid('m_open'),        '0424',              'received', null,                   '{}');

-- Lots ---------------------------------------------------------------------
insert into public.inventory_lots (id, manifest_id, product_name, status, disposition, received_on, received_on_source, strain_type, fact_provenance) values
  (pg_temp.kid('l_plain'),       pg_temp.kid('m_real'),        'Plain',        'active',     'accepted',         null,         null,           'hybrid', '{}'),
  (pg_temp.kid('l_has_date'),    pg_temp.kid('m_real'),        'Has date',     'active',     'accepted',         '2026-07-01', 'owner_entered', null,    '{}'),
  (pg_temp.kid('l_refused'),     pg_temp.kid('m_real'),        'Refused',      'rejected',   'rejected_at_dock', null,         null,           null,     '{}'),
  (pg_temp.kid('l_import'),      pg_temp.kid('m_import'),      'Import',       'active',     'accepted',         null,         null,           null,     '{}'),
  (pg_temp.kid('l_import_kind'), pg_temp.kid('m_import_kind'), 'Import kind',  'active',     'accepted',         null,         null,           null,     '{}'),
  (pg_temp.kid('l_refinal'),     pg_temp.kid('m_refinal'),     'Refinal',      'active',     'accepted',         null,         null,           null,     '{}'),
  (pg_temp.kid('l_late'),        pg_temp.kid('m_late'),        'Late',         'active',     'accepted',         null,         null,           null,     '{}'),
  (pg_temp.kid('l_open'),        pg_temp.kid('m_open'),        'Open',         'quarantine', null,               null,         null,           null,     '{}'),
  (pg_temp.kid('l_held'),        pg_temp.kid('m_real'),        'Held',         'quarantine', 'accepted',         null,         null,           null,     '{}'),
  -- disposition still undecided: not received yet (isolates the disposition filter)
  (pg_temp.kid('l_pending'),     pg_temp.kid('m_real'),        'Pending',      'quarantine', 'pending',          null,         null,           null,     '{}'),
  -- status rejected even though disposition says accepted (isolates the status filter)
  (pg_temp.kid('l_status_rej'),  pg_temp.kid('m_real'),        'Status rej',   'rejected',   'accepted',         null,         null,           null,     '{}'),
  (pg_temp.kid('l_pick'),        pg_temp.kid('m_real'),        'Pick',         'active',     'accepted',         '2026-07-15', 'manifest',     'indica', '{"package_thc_mg":"name"}'),
  (pg_temp.kid('l_pick_same'),   pg_temp.kid('m_real'),        'Pick same',    'active',     'accepted',         '2026-07-15', 'manifest',     'hybrid', '{"strain_type":"reviewer"}'),
  (pg_temp.kid('l_pick_edited'), pg_temp.kid('m_real'),        'Pick edited',  'active',     'accepted',         '2026-07-15', 'manifest',     'sativa', '{}'),
  (pg_temp.kid('l_no_pick'),     pg_temp.kid('m_real'),        'No pick',      'active',     'accepted',         '2026-07-15', 'manifest',     'indica', '{}'),
  (pg_temp.kid('l_unapproved'),  pg_temp.kid('m_real'),        'Unapproved',   'active',     'accepted',         '2026-07-15', 'manifest',     null,     '{}'),
  (pg_temp.kid('l_junk'),        pg_temp.kid('m_real'),        'Junk',         'active',     'accepted',         '2026-07-15', 'manifest',     null,     '{}'),
  (pg_temp.kid('l_two'),         pg_temp.kid('m_real'),        'Two drafts',   'active',     'accepted',         '2026-07-15', 'manifest',     null,     '{}');

-- Receive adjustments (finalize writes one per activated lot) -------------
insert into public.inventory_adjustments (lot_id, qty_delta, reason, note, created_at) values
  (pg_temp.kid('l_refinal'), 10, 'receive', 'Accepted from vendor manifest intake (partial-accept flow).', '2026-07-10T18:00:00Z'),
  -- an unrelated receive adjustment must NOT count as evidence
  (pg_temp.kid('l_plain'),   5,  'receive', 'Manual receive by hand.',                                    '2026-01-01T18:00:00Z');

-- Drafts --------------------------------------------------------------------
insert into public.catalog_product_drafts (id, pos_product_key, name, status, lot_id, chosen_strain_type, updated_at) values
  (pg_temp.kid('d_pick'),        'K-pick',   'Pick',        'approved', pg_temp.kid('l_pick'),        'hybrid',        '2026-07-16T18:00:00Z'),
  (pg_temp.kid('d_pick_same'),   'K-same',   'Pick same',   'approved', pg_temp.kid('l_pick_same'),   'hybrid',        '2026-07-16T18:00:00Z'),
  (pg_temp.kid('d_pick_edited'), 'K-edit',   'Pick edited', 'approved', pg_temp.kid('l_pick_edited'), 'hybrid',        '2026-07-16T18:00:00Z'),
  (pg_temp.kid('d_no_pick'),     'K-nopick', 'No pick',     'approved', pg_temp.kid('l_no_pick'),     null,            '2026-07-16T18:00:00Z'),
  (pg_temp.kid('d_unapproved'),  'K-unappr', 'Unapproved',  'draft',    pg_temp.kid('l_unapproved'),  'sativa',        '2026-07-16T18:00:00Z'),
  (pg_temp.kid('d_junk'),        'K-junk',   'Junk',        'approved', pg_temp.kid('l_junk'),        'banana',        '2026-07-16T18:00:00Z'),
  (pg_temp.kid('d_two_old'),     'K-two-a',  'Two old',     'approved', pg_temp.kid('l_two'),         'indica',        '2026-07-16T18:00:00Z'),
  (pg_temp.kid('d_two_new'),     'K-two-b',  'Two new',     'approved', pg_temp.kid('l_two'),         ' Sativa-Hybrid ','2026-07-18T18:00:00Z');

-- The set_updated_at trigger (0026) rewrites updated_at = now() on UPDATE,
-- so disable it (transaction-local; rolled back at the end) while we pin the
-- scenario dates exactly as written above.
alter table public.catalog_product_drafts disable trigger catalog_product_drafts_set_updated_at;
update public.catalog_product_drafts d set updated_at = v.at
  from (values
    (pg_temp.kid('d_pick'), '2026-07-16T18:00:00Z'::timestamptz),
    (pg_temp.kid('d_pick_same'), '2026-07-16T18:00:00Z'),
    (pg_temp.kid('d_pick_edited'), '2026-07-16T18:00:00Z'),
    (pg_temp.kid('d_two_old'), '2026-07-16T18:00:00Z'),
    (pg_temp.kid('d_two_new'), '2026-07-18T18:00:00Z')) v(id, at)
 where d.id = v.id;
alter table public.catalog_product_drafts enable trigger catalog_product_drafts_set_updated_at;

-- A person hand-edited l_pick_edited AFTER approval -> keep their value.
insert into public.audit_logs (actor_email, action, entity_type, entity_id, created_at)
values ('owner@x', 'inventory_lot.details_edited', 'inventory_lot', pg_temp.kid('l_pick_edited')::text, '2026-07-17T18:00:00Z');

-- Snapshot the BEFORE state for the rollback assertion.
create temp table before_snap on commit drop as
  select id, received_on, received_on_source, received_on_set_by, received_on_set_at, strain_type, fact_provenance
    from public.inventory_lots where id in (select id from k);

-- Apply TWICE --------------------------------------------------------------
\i supabase/migrations/0244_intake_lot_received_date_strain_type_backfill.sql
create temp table after_first on commit drop as
  select id, received_on, received_on_source, received_on_set_at, strain_type, fact_provenance
    from public.inventory_lots where id in (select id from k);
\i supabase/migrations/0244_intake_lot_received_date_strain_type_backfill.sql

do $$
declare
  n int;
  r record;
begin
  -- idempotent: the second run changed nothing and wrote no extra audit rows
  select count(*) into n from public.inventory_lots l join after_first a using (id)
   where (l.received_on, l.received_on_source, l.received_on_set_at, l.strain_type, l.fact_provenance)
         is distinct from (a.received_on, a.received_on_source, a.received_on_set_at, a.strain_type, a.fact_provenance);
  assert n = 0, 'second run changed rows: ' || n;

  -- ---- received dates
  select * into r from public.inventory_lots where id = pg_temp.kid('l_plain');
  assert r.received_on = date '2026-07-15', 'plain: ' || coalesce(r.received_on::text, 'null');
  assert r.received_on_source = 'manifest', 'plain source';
  assert r.received_on_set_by is null, 'plain set_by must be null (machine-derived)';
  assert r.received_on_set_at = '2026-07-15T18:00:00Z'::timestamptz, 'plain set_at = accept instant (unrelated adjustment ignored)';

  select * into r from public.inventory_lots where id = pg_temp.kid('l_has_date');
  assert r.received_on = date '2026-07-01' and r.received_on_source = 'owner_entered', 'a typed date is never touched';

  select * into r from public.inventory_lots where id = pg_temp.kid('l_refused');
  assert r.received_on is null, 'refused at dock: never received';

  select * into r from public.inventory_lots where id = pg_temp.kid('l_import');
  assert r.received_on is null, 'Cultivera synthetic manifest (number) excluded';
  select * into r from public.inventory_lots where id = pg_temp.kid('l_import_kind');
  assert r.received_on is null, 'Cultivera synthetic manifest (raw_payload kind) excluded';

  select * into r from public.inventory_lots where id = pg_temp.kid('l_refinal');
  assert r.received_on = date '2026-07-10', 're-finalize: the first receive adjustment wins: ' || coalesce(r.received_on::text, 'null');

  select * into r from public.inventory_lots where id = pg_temp.kid('l_late');
  assert r.received_on = date '2026-07-15', 'late night: PACIFIC day, not UTC day: ' || coalesce(r.received_on::text, 'null');

  select * into r from public.inventory_lots where id = pg_temp.kid('l_open');
  assert r.received_on is null, 'never accepted: no date';

  select * into r from public.inventory_lots where id = pg_temp.kid('l_held');
  assert r.received_on = date '2026-07-15', 'held (accepted, quarantined) lot was received';

  select * into r from public.inventory_lots where id = pg_temp.kid('l_pending');
  assert r.received_on is null, 'pending disposition: not received yet';
  select * into r from public.inventory_lots where id = pg_temp.kid('l_status_rej');
  assert r.received_on is null, 'status rejected: never received';

  -- ---- strain types
  select * into r from public.inventory_lots where id = pg_temp.kid('l_pick');
  assert r.strain_type = 'hybrid', 'pick mirrored over manifest value';
  assert r.fact_provenance ->> 'strain_type' = 'reviewer', 'pick provenance reviewer';
  assert r.fact_provenance ->> 'package_thc_mg' = 'name', 'other provenance kept';

  select * into r from public.inventory_lots where id = pg_temp.kid('l_pick_edited');
  assert r.strain_type = 'sativa', 'a later human edit of the lot is kept';

  select * into r from public.inventory_lots where id = pg_temp.kid('l_no_pick');
  assert r.strain_type = 'indica', 'no pick: lot keeps the manifest value';

  select * into r from public.inventory_lots where id = pg_temp.kid('l_unapproved');
  assert r.strain_type is null, 'unapproved draft is not evidence';

  select * into r from public.inventory_lots where id = pg_temp.kid('l_junk');
  assert r.strain_type is null, 'non-canonical pick never written';

  select * into r from public.inventory_lots where id = pg_temp.kid('l_two');
  assert r.strain_type = 'sativa-hybrid', 'latest approved draft wins, trimmed+lowercased: ' || coalesce(r.strain_type, 'null');

  -- ---- audit rows: exactly one per changed fact
  select count(*) into n from public.audit_logs where actor_email = 'migration:0244' and action = 'migration_0244.received_on_backfill';
  assert n = 4, 'received audit rows (plain, refinal, late, held): ' || n;
  select count(*) into n from public.audit_logs where actor_email = 'migration:0244' and action = 'migration_0244.strain_type_backfill';
  assert n = 2, 'strain audit rows (pick, two): ' || n;
  -- l_pick_same already matched with reviewer provenance -> untouched
  select count(*) into n from public.audit_logs where actor_email = 'migration:0244' and entity_id = pg_temp.kid('l_pick_same')::text;
  assert n = 0, 'already-correct lot not touched';
end $$;

-- People edit backfilled facts BEFORE a rollback: the rollback must keep them.
-- l_late : a different date typed by the owner.
update public.inventory_lots set received_on = '2026-07-14', received_on_source = 'owner_entered'
 where id = pg_temp.kid('l_late');
-- l_held : the owner re-confirms the SAME date (source flips to owner_entered).
update public.inventory_lots set received_on_source = 'owner_entered'
 where id = pg_temp.kid('l_held');
-- l_two  : the lot strain hand-edited (updateLotDetails leaves fact_provenance
--          alone, so provenance still says reviewer; only the value differs).
update public.inventory_lots set strain_type = 'indica'
 where id = pg_temp.kid('l_two');

\i supabase/rollbacks/0244_intake_lot_received_date_strain_type_backfill.rollback.sql

do $$
declare
  n int;
  r record;
begin
  -- every lot except the one a person edited is back to BEFORE, exactly
  select count(*) into n from public.inventory_lots l join before_snap b using (id)
   where l.id not in (pg_temp.kid('l_late'), pg_temp.kid('l_held'), pg_temp.kid('l_two'))
     and (l.received_on, l.received_on_source, l.received_on_set_by, l.received_on_set_at, l.strain_type, l.fact_provenance)
         is distinct from (b.received_on, b.received_on_source, b.received_on_set_by, b.received_on_set_at, b.strain_type, b.fact_provenance);
  assert n = 0, 'rollback did not restore BEFORE exactly: ' || n;
  select * into r from public.inventory_lots where id = pg_temp.kid('l_late');
  assert r.received_on = date '2026-07-14' and r.received_on_source = 'owner_entered', 'rollback never undoes a later human edit';
  select * into r from public.inventory_lots where id = pg_temp.kid('l_held');
  assert r.received_on = date '2026-07-15' and r.received_on_source = 'owner_entered', 'rollback keeps an owner-confirmed same date';
  select * into r from public.inventory_lots where id = pg_temp.kid('l_two');
  assert r.strain_type = 'indica', 'rollback keeps a hand-edited strain type';
  select count(*) into n from public.audit_logs where actor_email = 'migration:0244';
  assert n = 0, 'rollback forgets its audit rows';
end $$;

-- Re-apply after rollback works.
\i supabase/migrations/0244_intake_lot_received_date_strain_type_backfill.sql
do $$
declare r record;
begin
  select * into r from public.inventory_lots where id = pg_temp.kid('l_plain');
  assert r.received_on = date '2026-07-15', 're-apply after rollback';
  raise notice 'INTAKE LOT FACTS CHECK PASSED';
end $$;

rollback;
