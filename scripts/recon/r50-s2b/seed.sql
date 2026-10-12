-- R50 S2b real-database seed (local PG15 + PostgREST harness only; never production).
-- Two imports that share the same first 8 characters (the POS-IMPORT-<id8> collision),
-- one manifest rebuilt from import A, and one native delivery.
begin;
delete from public.inventory_lots where id::text like 'b0000000-%';
delete from public.inbound_manifests where id::text like 'b1000000-%';

insert into public.inbound_manifests (id, manifest_number, vendor_label, status, raw_payload) values
  ('b1000000-0000-4000-8000-000000000001', 'POS-IMPORT-abcd1234', 'Cultivera POS migration (multi-vendor import)', 'accepted',
     '{"kind":"pos-import-migration","import_id":"abcd1234-0000-4000-8000-00000000000a"}'),
  ('b1000000-0000-4000-8000-000000000002', 'POS-IMPORT-abcd1234', 'Cultivera POS migration (multi-vendor import)', 'accepted',
     '{"kind":"pos-import-migration","import_id":"abcd1234-9999-4000-8000-00000000000b"}'),
  ('b1000000-0000-4000-8000-000000000003', '0001108', 'Grow Op Farms', 'accepted',
     '{"kind":"cultivera-reconstructed","import_id":"abcd1234-0000-4000-8000-00000000000a"}'),
  ('b1000000-0000-4000-8000-000000000004', 'WCIA-0421', 'Acme', 'accepted', '{"kind":"wcia"}');

insert into public.inventory_lots (id, manifest_id, product_name, pos_product_key, on_hand_qty, received_qty, received_on, status) values
  -- import A, still on its POS-IMPORT manifest
  ('b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'A on POS undated', 'k-a1', 3, 3, null, 'active'),
  ('b0000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'A on POS dated',   'k-a2', 2, 2, '2024-05-01', 'active'),
  -- import A, re-homed onto the rebuilt manifest
  ('b0000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003', 'A rebuilt undated', 'k-a3', 5, 5, null, 'active'),
  ('b0000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000003', 'A rebuilt destroyed', 'k-a4', 0, 1, null, 'destroyed'),
  -- import B (same 8-char prefix)
  ('b0000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000002', 'B on POS undated', 'k-b1', 1, 1, null, 'active'),
  -- native delivery
  ('b0000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000004', 'Native undated', 'k-n1', 4, 4, null, 'active');
commit;

-- Legacy removal + backfill count: import A has a menu version whose cards
-- k-a1 (on POS-IMPORT) and k-a3 (re-homed) are hidden for no_product_master.
begin;
delete from public.menu_items where menu_version_id = 'b2000000-0000-4000-8000-000000000001';
delete from public.menu_versions where id = 'b2000000-0000-4000-8000-000000000001';
delete from public.pos_imports where id = 'abcd1234-0000-4000-8000-00000000000a';
insert into public.pos_imports (id, status) values ('abcd1234-0000-4000-8000-00000000000a', 'published');
insert into public.menu_versions (id, import_id, status) values
  ('b2000000-0000-4000-8000-000000000001', 'abcd1234-0000-4000-8000-00000000000a', 'published');
insert into public.menu_items (menu_version_id, source_item_id, name, brand_name, category, strain_type, description,
                               price_label, price_minor_units, inventory_status, hidden, hidden_reason, sort_order) values
  ('b2000000-0000-4000-8000-000000000001', 'k-a1', 'A1', '', 'flower', '', '', '', 0, 'in_stock', true, 'no_product_master', 1),
  ('b2000000-0000-4000-8000-000000000001', 'k-a3', 'A3', '', 'flower', '', '', '', 0, 'in_stock', true, 'no_product_master', 2),
  ('b2000000-0000-4000-8000-000000000001', 'k-n1', 'N1', '', 'flower', '', '', '', 0, 'in_stock', true, 'no_product_master', 3);
commit;
