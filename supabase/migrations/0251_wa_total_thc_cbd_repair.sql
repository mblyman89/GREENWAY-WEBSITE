-- ===========================================================================
-- 0251_wa_total_thc_cbd_repair.sql
--
-- R27 (owner-reported). TOTAL THC / TOTAL CBD FOLLOW THE WASHINGTON RULE.
--
-- Owner request (excerpt, verbatim in the PR): "Make the system smarter ...
-- CCRS/LCB total THC/CBD rules."
--
-- THE BUG (verified in code + on the owner transfer itself). The WCIA transfer
-- parser (src/lib/inventory/intake-parser.ts parseWciaLab) wrote
--   total_thc_pct = potency["total-cannabinoids"] ?? max(thc, thca)
--   total_cbd_pct = potency["cbd"]
-- so the THC column carried THC + CBD + everything else. Apple Cardamom:
-- the lab reported total-thc 0.2456 and total-cannabinoids 0.7045, and
-- Product Onboarding showed 0.7045% THC. WAC 314-55-102(3)(a)(ii): total THC
-- = THC + 0.877 x THCA (total CBD = CBD + 0.877 x CBDA) - the figure the lab
-- itself reports as "total-thc" / "total-cbd". The CODE FIX (same PR,
-- src/lib/inventory/wa-total-cannabinoids-core.ts) stops new rows from
-- getting it wrong. THIS MIGRATION repairs rows already stored, from evidence
-- already in the database. It invents nothing and computes nothing:
--
-- 1. lab_results: total_thc_pct := potency_json->'total-thc' and
--    total_cbd_pct := potency_json->'total-cbd', ONLY where the lab REPORTED
--    that key as a JSON number >= 0 and the stored value differs. A row
--    without the reported key is never touched (no formula is applied here).
-- 2. catalog_product_drafts: total_thc_pct copied from that lab row at
--    seeding (catalog-drafts.ts) is set to the repaired value ONLY where it
--    still equals the lab BEFORE value (a value someone changed since is
--    kept). Drafts have no total-CBD column (cbd_pct is the lab cbd_pct,
--    which this migration does not change).
-- 3. kb_products: total_thc_pct / total_cbd_pct gap-filled from a lab row
--    (potency_source = 'lab_results:<id>', src/lib/ai/kb/writeback.ts) are
--    repaired the same way - only while they still equal the BEFORE value.
--
-- NOT CHANGED: menu cards. The THC on a card is display TEXT built at staging
-- (rounded, unit, caps, the verified package-total override), never the raw
-- number - rewriting it here would be a guess. Cards built from a repaired
-- draft get the right figure on their next build.
--
-- AUDIT + EXACT ROLLBACK. Every row changed gets one audit_logs row
-- (actor_email 'migration:0251') holding the BEFORE values. The rollback
-- (supabase/rollbacks/0251_wa_total_thc_cbd_repair.rollback.sql) restores
-- exactly those, only where the value is still the one 0251 wrote.
--
-- IDEMPOTENT: a second run finds nothing (the values now equal the reported
-- totals). Order matters inside this file: drafts and KB rows are matched
-- against the BEFORE values recorded in the step 1 audit rows. Owner applies
-- MANUALLY in the Supabase SQL editor.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. lab_results: the totals the lab itself reported
-- ---------------------------------------------------------------------------
with reported as (
  select
    r.id,
    r.total_thc_pct as before_thc,
    r.total_cbd_pct as before_cbd,
    case when jsonb_typeof(r.potency_json -> 'total-thc') = 'number'
              and (r.potency_json ->> 'total-thc')::numeric >= 0
         then (r.potency_json ->> 'total-thc')::numeric end as rep_thc,
    case when jsonb_typeof(r.potency_json -> 'total-cbd') = 'number'
              and (r.potency_json ->> 'total-cbd')::numeric >= 0
         then (r.potency_json ->> 'total-cbd')::numeric end as rep_cbd
  from public.lab_results r
  where jsonb_typeof(r.potency_json) = 'object'
),
targets as (
  select
    id,
    before_thc,
    before_cbd,
    coalesce(rep_thc, before_thc) as new_thc,
    coalesce(rep_cbd, before_cbd) as new_cbd
  from reported
  where (rep_thc is not null and rep_thc is distinct from before_thc)
     or (rep_cbd is not null and rep_cbd is distinct from before_cbd)
),
repaired as (
  update public.lab_results r
     set total_thc_pct = t.new_thc,
         total_cbd_pct = t.new_cbd
    from targets t
   where r.id = t.id
  returning r.id, t.before_thc, t.before_cbd, t.new_thc, t.new_cbd
)
insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, before_json, after_json)
select
  null,
  'migration:0251',
  'migration_0251.lab_total_repair',
  'lab_result',
  rp.id::text,
  jsonb_build_object('total_thc_pct', rp.before_thc, 'total_cbd_pct', rp.before_cbd),
  jsonb_build_object(
    'total_thc_pct', rp.new_thc,
    'total_cbd_pct', rp.new_cbd,
    'basis', 'potency_json total-thc and total-cbd as reported by the lab (WAC 314-55-102(3)(a)(ii)), replacing total-cannabinoids and cbd'
  )
from repaired rp;

-- ---------------------------------------------------------------------------
-- 2. catalog_product_drafts: the THC copied from a repaired lab row
-- ---------------------------------------------------------------------------
with labfix as (
  select
    a.entity_id::uuid as lab_id,
    (a.before_json ->> 'total_thc_pct')::numeric as before_thc,
    (a.after_json ->> 'total_thc_pct')::numeric as new_thc
  from public.audit_logs a
  where a.actor_email = 'migration:0251'
    and a.action = 'migration_0251.lab_total_repair'
    and a.entity_type = 'lab_result'
    and (a.after_json ->> 'total_thc_pct') is not null
    and (a.before_json ->> 'total_thc_pct') is distinct from (a.after_json ->> 'total_thc_pct')
),
targets as (
  select d.id, d.total_thc_pct as before_thc, f.new_thc, f.lab_id
  from public.catalog_product_drafts d
  join labfix f on f.lab_id = d.lab_result_id
  where d.total_thc_pct is not distinct from f.before_thc
    and d.total_thc_pct is distinct from f.new_thc
),
repaired as (
  update public.catalog_product_drafts d
     set total_thc_pct = t.new_thc
    from targets t
   where d.id = t.id
  returning d.id, t.before_thc, t.new_thc, t.lab_id
)
insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, before_json, after_json)
select
  null,
  'migration:0251',
  'migration_0251.draft_total_repair',
  'catalog_product_draft',
  rp.id::text,
  jsonb_build_object('total_thc_pct', rp.before_thc),
  jsonb_build_object('total_thc_pct', rp.new_thc, 'lab_result_id', rp.lab_id)
from repaired rp;

-- ---------------------------------------------------------------------------
-- 3. kb_products: totals gap-filled from a repaired lab row
-- ---------------------------------------------------------------------------
with labfix as (
  select
    a.entity_id as lab_id,
    (a.before_json ->> 'total_thc_pct')::numeric as before_thc,
    (a.after_json ->> 'total_thc_pct')::numeric as new_thc,
    (a.before_json ->> 'total_cbd_pct')::numeric as before_cbd,
    (a.after_json ->> 'total_cbd_pct')::numeric as new_cbd
  from public.audit_logs a
  where a.actor_email = 'migration:0251'
    and a.action = 'migration_0251.lab_total_repair'
    and a.entity_type = 'lab_result'
),
targets as (
  select
    k.id,
    k.total_thc_pct as before_thc,
    k.total_cbd_pct as before_cbd,
    case when k.total_thc_pct is not distinct from f.before_thc then f.new_thc else k.total_thc_pct end as new_thc,
    case when k.total_cbd_pct is not distinct from f.before_cbd then f.new_cbd else k.total_cbd_pct end as new_cbd,
    f.lab_id
  from public.kb_products k
  join labfix f on k.potency_source = 'lab_results:' || f.lab_id
),
changed as (
  select * from targets
  where new_thc is distinct from before_thc or new_cbd is distinct from before_cbd
),
repaired as (
  update public.kb_products k
     set total_thc_pct = c.new_thc,
         total_cbd_pct = c.new_cbd
    from changed c
   where k.id = c.id
  returning k.id, c.before_thc, c.before_cbd, c.new_thc, c.new_cbd, c.lab_id
)
insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, before_json, after_json)
select
  null,
  'migration:0251',
  'migration_0251.kb_total_repair',
  'kb_product',
  rp.id::text,
  jsonb_build_object('total_thc_pct', rp.before_thc, 'total_cbd_pct', rp.before_cbd),
  jsonb_build_object('total_thc_pct', rp.new_thc, 'total_cbd_pct', rp.new_cbd, 'lab_result_id', rp.lab_id)
from repaired rp;
