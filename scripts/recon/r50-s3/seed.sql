-- R50 S3 real-DB probe seed (harness only). Undo with undo.sql.
begin;
insert into brands (id, display_name, slug) values ('5c3b0000-0000-4000-8000-0000000000b1','Phat Panda','r50s3-phat-panda') on conflict do nothing;
insert into inbound_manifests (id, manifest_number, vendor_label, status, accepted_at, accepted_lot_count, raw_payload)
values ('5c3a0000-0000-4000-8000-000000000001','CV-S3-PROBE','Phat Panda','accepted', now(), 5,
        jsonb_build_object('kind','cultivera-reconstructed','import_id','5c2c0000-0000-4000-8000-00000000000a'));
-- snapshot then borrow 5 synthetic lots (restored by undo.sql)
create table if not exists r50s3_snap as select id, manifest_id, pos_product_key, brand_id, pos_thc, pos_cbd, pos_potency_unit, product_name, inventory_type, category, strain_name, unit_weight, unit_weight_uom from inventory_lots where false;
insert into r50s3_snap select id, manifest_id, pos_product_key, brand_id, pos_thc, pos_cbd, pos_potency_unit, product_name, inventory_type, category, strain_name, unit_weight, unit_weight_uom from inventory_lots
  where manifest_id = '5c2c1000-0000-4000-8000-000000000001' order by id limit 5;
with s as (select id, row_number() over (order by id) n from r50s3_snap)
update inventory_lots l set manifest_id='5c3a0000-0000-4000-8000-000000000001',
  brand_id='5c3b0000-0000-4000-8000-0000000000b1',
  pos_product_key = case s.n when 1 then 'pos-s3-a' when 2 then 'pos-s3-a' when 3 then 'pos-s3-b' when 4 then 'pos-s3-c' else null end,
  product_name = case s.n when 3 then 'Phat Panda - Gelato 1g' when 4 then 'Phat Panda - Lemon Haze 1g' else 'Phat Panda - Blue Dream 3.5g' end,
  strain_name = case s.n when 3 then 'Gelato' when 4 then 'Lemon Haze' else 'Blue Dream' end,
  inventory_type = 'Usable Marijuana', category = 'Flower', unit_weight = case when s.n in (3,4) then 1 else 3.5 end, unit_weight_uom = 'g',
  pos_thc = 23.456, pos_cbd = case s.n when 3 then 1.5 else 0.2 end, pos_potency_unit='%'
from s where l.id = s.id;
insert into menu_versions (id, status) values ('5c3c0000-0000-4000-8000-000000000001','published');
insert into menu_items (id, menu_version_id, source_item_id, name, category) values
 ('5c3d0000-0000-4000-8000-00000000000a','5c3c0000-0000-4000-8000-000000000001','pos-s3-a','A','Flower'),
 ('5c3d0000-0000-4000-8000-00000000000b','5c3c0000-0000-4000-8000-000000000001','pos-s3-b','B','Flower'),
 ('5c3d0000-0000-4000-8000-00000000000c','5c3c0000-0000-4000-8000-000000000001','pos-s3-c','C','Flower');
insert into menu_variants (menu_item_id, source_variant_id, label, price_minor_units) values
 ('5c3d0000-0000-4000-8000-00000000000a','va1','3.5g',2500),('5c3d0000-0000-4000-8000-00000000000a','va2','3.5g',2500),
 ('5c3d0000-0000-4000-8000-00000000000b','vb1','1g',1000),('5c3d0000-0000-4000-8000-00000000000b','vb2','2g',1800),
 ('5c3d0000-0000-4000-8000-00000000000c','vc1','1g',1500);
commit;
