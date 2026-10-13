begin;
-- HARNESS ONLY: provenance is append-only by design; lift the guard just for this probe cleanup.
alter table product_fact_provenance disable trigger trg_pfp_append_only;
delete from product_fact_provenance where draft_id in (select id from catalog_product_drafts where manifest_id='5c3a0000-0000-4000-8000-000000000001');
update inventory_lots l set kb_product_id = null where l.id in (select id from r50s3_snap);
delete from kb_products where id in (select kb_product_id from catalog_product_drafts where manifest_id='5c3a0000-0000-4000-8000-000000000001' and kb_product_id is not null);
delete from catalog_product_drafts where manifest_id='5c3a0000-0000-4000-8000-000000000001';
update inventory_lots l set manifest_id=s.manifest_id, pos_product_key=s.pos_product_key, brand_id=s.brand_id, pos_thc=s.pos_thc, pos_cbd=s.pos_cbd, pos_potency_unit=s.pos_potency_unit, product_name=s.product_name, inventory_type=s.inventory_type, category=s.category, strain_name=s.strain_name, unit_weight=s.unit_weight, unit_weight_uom=s.unit_weight_uom from r50s3_snap s where l.id=s.id;
delete from manifest_events where manifest_id='5c3a0000-0000-4000-8000-000000000001';
delete from inbound_manifests where id='5c3a0000-0000-4000-8000-000000000001';
delete from menu_variants where menu_item_id::text like '5c3d0000%';
delete from menu_items where menu_version_id='5c3c0000-0000-4000-8000-000000000001';
delete from menu_versions where id='5c3c0000-0000-4000-8000-000000000001';
drop table r50s3_snap;
commit;
