select 'lots', count(*), sum(on_hand_qty), sum(received_qty), sum(on_hand_qty*unit_cost_minor_units) from inventory_lots where id::text like '5c2c2000-%';
select 'on_source', count(*) from inventory_lots where manifest_id='5c2c1000-0000-4000-8000-000000000001';
select 'native_lot', manifest_id, on_hand_qty, updated_at from inventory_lots where id='5c2c3000-0000-4000-8000-000000000001';
select 'rebuilt_manifests', count(*), count(vendor_id), count(accepted_at), count(transfer_date), sum(accepted_lot_count) from inbound_manifests where raw_payload->>'kind'='cultivera-reconstructed';
select 'by_status', status, count(*) from inbound_manifests where raw_payload->>'kind'='cultivera-reconstructed' group by 1,2 order by 2;
select 'events', count(*) from manifest_events e join inbound_manifests m on m.id=e.manifest_id where m.raw_payload->>'kind'='cultivera-reconstructed';
select 'lot_fingerprint', md5(string_agg(id::text||on_hand_qty||received_qty||coalesce(unit_cost_minor_units,0)||status||coalesce(vendor_id::text,'')||coalesce(received_on::text,''), ',' order by id)) from inventory_lots;
select 'manifest_per_lot_ok', count(*) from inventory_lots l join inbound_manifests m on m.id=l.manifest_id where l.id::text like '5c2c2000-%' and (m.raw_payload->>'import_id'='5c2c0000-0000-4000-8000-00000000000a');
