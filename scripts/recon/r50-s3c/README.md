# R50 S3c/S3d real-DB probe (harness only)

This probe runs against PG15 (all migrations) and PostgREST 12.2.3. Setup: `/workspace/r50/harness/rebuild.sh`.

1. `before.txt` holds three values: the inventory_lots md5, the kb_products count and md5, and the menu_versions count.
2. `psql ... -f seed.sql` borrows 5 harness lots into a rebuilt (`cultivera-reconstructed`) manifest. It snapshots the
   **whole rows** and publishes a 3-card menu that carries Cultivera-style data:
   - shouty names;
   - blank brand;
   - the raw `Usable Marijuana` label;
   - blank descriptions, except one card with real staff copy.
3. Copy `probe.ts` to the repo root as `_probe.ts`. Add a `node_modules/server-only` stub, then run
   `NEXT_PUBLIC_SUPABASE_URL=http://localhost:3903 SUPABASE_SERVICE_ROLE_KEY=probe npx tsx _probe.ts`.
   The probe runs Start, then approves every draft through the real `approveDraftWithPrice`, which stages in
   refresh mode and auto-publishes.
4. `psql ... -f undo.sql` restores every column of the borrowed lots and deletes every row the probe created.
   It lifts the provenance append-only trigger only inside its own transaction.
5. `after-undo.txt` must equal `before.txt`. The measured results are in `after.txt`.
