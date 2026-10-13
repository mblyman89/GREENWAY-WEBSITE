begin;
-- crash A: 100 manifests whose inserts "never happened" (lots back on source, manifests gone)
with victims as (select id from inbound_manifests where raw_payload->>'kind'='cultivera-reconstructed' order by id limit 100)
update inventory_lots set manifest_id='5c2c1000-0000-4000-8000-000000000001' where manifest_id in (select id from victims);
delete from manifest_events where manifest_id in (select m.id from inbound_manifests m where m.raw_payload->>'kind'='cultivera-reconstructed' and not exists (select 1 from inventory_lots l where l.manifest_id=m.id));
delete from inbound_manifests m where m.raw_payload->>'kind'='cultivera-reconstructed' and not exists (select 1 from inventory_lots l where l.manifest_id=m.id);
-- crash B: 500 more lots "not yet moved" though their manifest exists
update inventory_lots set manifest_id='5c2c1000-0000-4000-8000-000000000001' where id in (select id from inventory_lots where manifest_id in (select id from inbound_manifests where raw_payload->>'kind'='cultivera-reconstructed') order by id desc limit 500);
commit;
select 'after crash: manifests', count(*) from inbound_manifests where raw_payload->>'kind'='cultivera-reconstructed';
select 'after crash: on source', count(*) from inventory_lots where manifest_id='5c2c1000-0000-4000-8000-000000000001';
