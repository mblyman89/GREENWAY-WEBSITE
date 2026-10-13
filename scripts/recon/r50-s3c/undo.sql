-- R50 S3c undo (harness only). Superset of r50-s3/undo.sql: also every probe-built menu version.
begin;
-- HARNESS ONLY: provenance is append-only by design; lift the guard just for this probe cleanup.
alter table product_fact_provenance disable trigger trg_pfp_append_only;
delete from product_fact_provenance where draft_id in (select id from catalog_product_drafts where manifest_id='5c3a0000-0000-4000-8000-000000000001');
update inventory_lots l set kb_product_id = null where l.id in (select id from r50s3_snap);
delete from kb_products where id in (select kb_product_id from catalog_product_drafts where manifest_id='5c3a0000-0000-4000-8000-000000000001' and kb_product_id is not null);
delete from catalog_product_drafts where manifest_id='5c3a0000-0000-4000-8000-000000000001';
delete from manifest_events where manifest_id='5c3a0000-0000-4000-8000-000000000001';
delete from inbound_manifests where id='5c3a0000-0000-4000-8000-000000000001';
-- S3c: every version the probe staged/published (the harness had none before the seed).
delete from menu_variants where menu_item_id in (select id from menu_items where menu_version_id in (select id from menu_versions where id <> '5c3c0000-0000-4000-8000-000000000001'));
delete from menu_items where menu_version_id in (select id from menu_versions where id <> '5c3c0000-0000-4000-8000-000000000001');
delete from pos_fact_reviews where manifest_id='5c3a0000-0000-4000-8000-000000000001';
delete from menu_versions where id <> '5c3c0000-0000-4000-8000-000000000001';
delete from menu_variants where menu_item_id::text like '5c3d0000%';
delete from menu_items where menu_version_id='5c3c0000-0000-4000-8000-000000000001';
delete from menu_versions where id='5c3c0000-0000-4000-8000-000000000001';
-- S3c: restore EVERY column from the whole-row snapshot (update, never delete: lots have children).
alter table inventory_lots disable trigger inventory_lots_set_updated_at;
do $$
declare cols text;
begin
  select string_agg(format('%I = s.%I', column_name, column_name), ', ') into cols
  from information_schema.columns where table_schema='public' and table_name='inventory_lots' and column_name <> 'id';
  execute format('update inventory_lots l set %s from r50s3_snap s where l.id = s.id', cols);
end $$;
alter table inventory_lots enable trigger inventory_lots_set_updated_at;
drop table r50s3_snap;
commit;
