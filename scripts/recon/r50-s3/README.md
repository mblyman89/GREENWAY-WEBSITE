# R50 S3 real-DB probe (harness only)

1. `psql ... -f seed.sql` borrows 5 harness lots into a rebuilt (cultivera-reconstructed) manifest and publishes a tiny menu.
2. Copy `probe.ts` to the repo root as `_probe.ts`, run with `NEXT_PUBLIC_SUPABASE_URL=http://localhost:3903 SUPABASE_SERVICE_ROLE_KEY=probe npx tsx _probe.ts` (needs a `node_modules/server-only` stub; delete it afterwards).
3. `psql ... -f undo.sql` restores every borrowed lot from the snapshot and deletes everything the probe created. It lifts the provenance append-only trigger only inside its own transaction; never do this outside the harness.
4. Compare the inventory_lots md5 with `before.txt`. Results: `after.txt`.
