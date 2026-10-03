-- ===========================================================================
-- 0244_intake_lot_received_date_strain_type_backfill.sql
--
-- R25 A (owner-reported). INTAKE LOTS GET THEIR RECEIVED DATE AND THE
-- STRAIN TYPE THE OWNER PICKED AT ONBOARDING.
--
-- Owner request, verbatim:
--   "Something I noticed about the products I received via intake, the
--    strain type and receive date is not getting recorded to the inventory
--    table. The inventory page and or the system is not saving the receive
--    date for products we received through intake. The receive date should
--    be the date the manifest was accepted into the system via receiving.
--    Also, the strain type did not get saved to the inventory page, or it is
--    unaware of them. I entered the strain type for all products in
--    onboarding."
--
-- THE CODE FIX (same PR) stops new lots from missing either fact:
--   * finalizeManifestDispositions stamps received_on with the Pacific day of
--     the accept instant, source 'manifest' (src/lib/inventory/
--     intake-lot-facts-core.ts planReceivedOnStamp), fill-only.
--   * approveDraftWithPrice mirrors the approver's strain-type pick onto the
--     lot with fact_provenance.strain_type = 'reviewer'
--     (planLotStrainTypeMirror).
-- THIS MIGRATION repairs the lots that were received BEFORE the fix, from
-- evidence already in the database. It invents nothing.
--
-- 1. RECEIVED DATE: evidence = the manifest's accepted_at (0032), stamped by
--    finalize, and each lot's own 'receive' adjustment written at the same
--    instant ("Accepted from vendor manifest intake ..."). The EARLIER of the
--    two is used: a re-finalize rewrites accepted_at to a later instant, but
--    can never move the lot's first receive adjustment. The day is the
--    PACIFIC calendar day (0214 comment; standing rule 8).
--    Only lots that:
--      * have received_on IS NULL (fill-only; a typed or POS date is never
--        touched),
--      * belong to a REAL intake manifest. The Cultivera migration's
--        synthetic manifest (manifest_number 'POS-IMPORT-...', raw_payload
--        kind 'pos-import-migration', import-service.ts) is EXCLUDED: its
--        accepted_at is the import run instant, exactly the fiction 0214
--        forbids. Those lots keep 0214's pos_import date or stay flagged.
--      * were accepted (disposition 'accepted'), not refused at dock and not
--        status 'rejected',
--      * whose evidenced day passes 0214's sane window.
--    received_on_set_by stays NULL (0214: NULL for machine-derived values).
--
-- 2. STRAIN TYPE: evidence = catalog_product_drafts.chosen_strain_type
--    (0146), the HUMAN pick on an APPROVED draft linked to the lot (lot_id).
--    The latest approved draft per lot wins. Only canonical values
--    (strain-taxonomy.ts) are copied. A lot is updated when its value
--    differs from the pick, EXCEPT where a person hand-edited the lot after
--    the approval (audit_logs action 'inventory_lot.details_edited' newer
--    than the draft's updated_at): that later human decision is kept.
--
-- AUDIT + EXACT ROLLBACK. Every lot changed gets one audit_logs row
-- (actor_email 'migration:0244') holding the BEFORE values, so the rollback
-- (supabase/rollbacks/0244_...rollback.sql) restores exactly what this
-- changed and nothing else.
--
-- IDEMPOTENT: a second run finds nothing (received_on is no longer NULL; the
-- strain type now equals the pick with 'reviewer' provenance). Owner applies
-- MANUALLY in the Supabase SQL editor. The check queries are in
-- scripts/recon/intake-lot-facts-pg-check.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Received date from the manifest acceptance
-- ---------------------------------------------------------------------------
with evidence as (
  select
    l.id as lot_id,
    m.id as manifest_id,
    least(
      m.accepted_at,
      (select min(a.created_at)
         from public.inventory_adjustments a
        where a.lot_id = l.id
          and a.reason = 'receive'
          and a.note like 'Accepted from vendor manifest intake%')
    ) as accepted_instant
  from public.inventory_lots l
  join public.inbound_manifests m on m.id = l.manifest_id
  where l.received_on is null
    and l.disposition = 'accepted'
    and l.status <> 'rejected'
    and m.accepted_at is not null
    and coalesce(m.manifest_number, '') not like 'POS-IMPORT-%'
    and coalesce(m.raw_payload ->> 'kind', '') <> 'pos-import-migration'
),
dated as (
  select
    lot_id,
    manifest_id,
    accepted_instant,
    (accepted_instant at time zone 'America/Los_Angeles')::date as day
  from evidence
  where accepted_instant is not null
),
sane as (
  select * from dated
  where day >= date '2014-07-08'
    and day <= ((now() at time zone 'America/Los_Angeles')::date + 1)
),
stamped as (
  update public.inventory_lots l
     set received_on        = s.day,
         received_on_source = 'manifest',
         received_on_set_by = null,
         received_on_set_at = s.accepted_instant
    from sane s
   where l.id = s.lot_id
     and l.received_on is null
  returning l.id, s.manifest_id, s.day, s.accepted_instant
)
insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, before_json, after_json)
select
  null,
  'migration:0244',
  'migration_0244.received_on_backfill',
  'inventory_lot',
  st.id::text,
  jsonb_build_object('received_on', null, 'received_on_source', null),
  jsonb_build_object(
    'received_on', st.day,
    'received_on_source', 'manifest',
    'manifest_id', st.manifest_id,
    'accepted_instant', st.accepted_instant,
    'basis', 'Pacific day of the earlier of inbound_manifests.accepted_at and the lot''s first intake receive adjustment.'
  )
from stamped st;

-- ---------------------------------------------------------------------------
-- 2. Strain type from the approver's pick
-- ---------------------------------------------------------------------------
with picks as (
  select distinct on (d.lot_id)
    d.lot_id,
    d.id as draft_id,
    lower(btrim(d.chosen_strain_type)) as pick,
    d.updated_at as approved_at
  from public.catalog_product_drafts d
  where d.status = 'approved'
    and d.lot_id is not null
    and d.chosen_strain_type is not null
    and lower(btrim(d.chosen_strain_type)) in ('indica', 'sativa', 'hybrid', 'indica-hybrid', 'sativa-hybrid', 'cbd')
  order by d.lot_id, d.updated_at desc
),
targets as (
  select
    l.id as lot_id,
    p.draft_id,
    p.pick,
    l.strain_type as before_strain_type,
    l.fact_provenance -> 'strain_type' as before_provenance
  from picks p
  join public.inventory_lots l on l.id = p.lot_id
  where (
      l.strain_type is distinct from p.pick
      or coalesce(l.fact_provenance ->> 'strain_type', '') <> 'reviewer'
    )
    and not exists (
      select 1 from public.audit_logs a
       where a.entity_type = 'inventory_lot'
         and a.entity_id = l.id::text
         and a.action = 'inventory_lot.details_edited'
         and a.created_at > p.approved_at
    )
),
mirrored as (
  update public.inventory_lots l
     set strain_type     = t.pick,
         fact_provenance = coalesce(l.fact_provenance, '{}'::jsonb) || jsonb_build_object('strain_type', 'reviewer')
    from targets t
   where l.id = t.lot_id
  returning l.id, t.draft_id, t.pick, t.before_strain_type, t.before_provenance
)
insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, before_json, after_json)
select
  null,
  'migration:0244',
  'migration_0244.strain_type_backfill',
  'inventory_lot',
  mi.id::text,
  jsonb_build_object('strain_type', mi.before_strain_type, 'fact_provenance_strain_type', mi.before_provenance),
  jsonb_build_object(
    'strain_type', mi.pick,
    'fact_provenance_strain_type', 'reviewer',
    'draft_id', mi.draft_id,
    'basis', 'catalog_product_drafts.chosen_strain_type on the approved draft linked to this lot (the human pick at Product Onboarding).'
  )
from mirrored mi;
