P="psql -h /tmp/pgsock -p 5433 -d greenway -U postgres -At"
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:3903 SUPABASE_SERVICE_ROLE_KEY=probe
$P -f scripts/recon/r50-s2c/s2c-snap.sql > /tmp/b1.txt; diff -q /tmp/b1.txt scripts/recon/r50-s2c/s2c-before.txt && echo BASELINE-SAME
timeout 100 npx tsx scripts/recon/r50-s2c/rehome-probe.ts apply 2>&1 | grep "APPLY#1" | cut -c1-120
M=$($P -c "select id from inbound_manifests where raw_payload->>'kind'='cultivera-reconstructed' order by id limit 1")
echo M=$M
$P -c "update inventory_lots set manifest_id='$M' where id='5c2c3000-0000-4000-8000-000000000001' returning id"
timeout 100 npx tsx scripts/recon/r50-s2c/rollback-probe.ts 2>&1 | grep -E "ROLLBACK|THREW"
$P -c "select manifest_id from inventory_lots where id='5c2c3000-0000-4000-8000-000000000001'"
$P -c "select count(*) from inbound_manifests where raw_payload->>'kind'='cultivera-reconstructed'"
$P -c "select count(*) from inventory_lots where manifest_id='$M'"
$P -c "update inventory_lots set manifest_id='5c2c1000-0000-4000-8000-000000000002' where id='5c2c3000-0000-4000-8000-000000000001'"
timeout 100 npx tsx scripts/recon/r50-s2c/rollback-probe.ts 2>&1 | grep -E "ROLLBACK|THREW"
$P -f scripts/recon/r50-s2c/s2c-snap.sql > /tmp/b2.txt; diff -q /tmp/b2.txt scripts/recon/r50-s2c/s2c-before.txt && echo FINAL-SAME
