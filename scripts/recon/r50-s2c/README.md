# R50 S2c: rebuild Cultivera manifests + re-home lots (real-DB recon)

These are the evidence files for `src/lib/inventory/cultivera-rehome-core.ts` (pure) and
`src/lib/inventory/cultivera-rehome-store.ts` (server-only). Every number below was measured
against a local PostgreSQL 15 + PostgREST harness. The schema came from the repo migrations, and the seed was built from
the R2A Cultivera fixture with `make-seed.py`. No production data or credentials were used. Lot costs in the seed
are synthetic.

## Files

The `make-seed.py` script builds the seed:

- import `5c2c0000-0000-4000-8000-00000000000a`;
- one POS-IMPORT source manifest `5c2c1000-…0001`;
- one native manifest `…0002` with a native lot `5c2c3000-…0001`;
- 128 vendors;
- 3,762 lots.

The other files are:

- `rehome-probe.ts [preview|apply|all]` runs `previewRehome` / `applyRehome` through supabase-js
  against the harness (`NEXT_PUBLIC_SUPABASE_URL=http://localhost:3903 SUPABASE_SERVICE_ROLE_KEY=probe`).
- `rollback-probe.ts` runs `rollbackRehome`.
- `s2c-snap.sql` is the state fingerprint. It records the lot md5 over every column except `manifest_id`, manifest
  counts by status and kind, and the native lot row.
- `crash.sql` simulates a crash mid-Apply. It deletes 100 rebuilt manifests and moves 500 lots back to the source.
- `s2c-before.txt`, `s2c-after.txt` and `s2c-after-rollback.txt` are the snapshots.

## Measured results

| Step | Result |
|---|---|
| Preview | ok, gate pass, 679 manifests (641 transfer + 38 rebuilt), 3,762 lots to move, 664 vendor ids set, 4 `transfer_date_after_acceptance` exceptions; control totals 3,762 lots / 25,851 units / 65,867,005¢; ~300 ms |
| Apply #1 | created 679, moved 3,762, 679 `manifest_events`, DB re-read verified; 3.1 s |
| Apply #2 | no-op: idempotent |
| After Apply | lot fingerprint md5 `2fccc59af28ee044223d35f53efce8ea` unchanged (only `manifest_id` changed); native lot untouched; 668 accepted / 11 partially_accepted |
| Rollback | movedBack 3,762, deleted 679; snapshot identical to before |
| Crash + resume | after `crash.sql`, re-Apply created 100, reused 579, moved 1,106, verified |
| Lot hand-moved to native manifest | not moved; logged as `planned_barcode_without_lot` exception (no refusal) |
| Foreign manifest holding a planned dedupe key | **Preview refuses** (`… already holds the key … but is not this import's rebuilt manifest`). Before the fix this surfaced only at INSERT time, and safely: 0 created, 0 moved. Now it is caught by `readManifestsByKeys` before anything is written |

## Safety properties exercised

- Every lot move is guarded with `.eq("manifest_id", source.id)`. A lot that someone moved by hand is never pulled back.
- Manifest inserts are idempotent by `dedupe_key`. A crashed run resumes and never duplicates.
- Control totals (lots, on-hand units, received units, cost value) are compared before and after Apply, against a fresh DB
  re-read.
- Rollback deletes only empty rebuilt manifests of this import. It never deletes a manifest that has work attached:
  drafts, fact reviews, documents or vendor payments. `vendor_manifest_payments` is a RESTRICT FK, so accounting is never touched.
- Batches stay within PostgREST's 8000-char URL limit. Moves go in batches of 150 ids, key reads in 100, inserts in 50.

## Rollback hardening (lineage-only move-back)

The mutation testing turned up two things:

- A no-op move-back could make the rollback loop spin forever.
- A blanket move-back would also have pulled hand-placed lots off a rebuilt manifest.

Rollback now works like this:

- It reads each rebuilt manifest's `raw_payload->barcodes` lineage, and refuses if that lineage is missing.
- It pages every lot on the manifest and moves back only the lots whose barcode is in the lineage, in guarded batches of 150.
- It re-checks that each moved batch actually left the manifest. If not, it stops loudly with "not making progress".
- Its final delete is still guarded by kind + import_id.

The measured run is `hand-placed-rollback.sh`:

| Step | Result |
|---|---|
| Apply | created 679, moved 3,762, 679 events, ok (3.0 s) |
| Native lot hand-placed on one rebuilt manifest, then rollback | movedBack 3,762, deleted 678, **keptNonEmpty 1**; the native lot stayed where the person put it |
| Native lot returned by hand, rollback again | movedBack 0, deleted 1 |
| Final snapshot vs before | identical except the native lot's `updated_at`, which was bumped by the two manual SQL updates in the script (trigger), not by the code |

The vitest suite (`tests/compliance/r50-cultivera-rehome.test.ts`, 22 tests) killed 23 of 23 mutants
(`mutants-1/2/3.json`, run with `/workspace/r50/mutate.py`).

## Native readers (§1.3b)

`readers-probe.ts` calls the shipped `listManifests` and `countManifestsByStatus` against the applied harness
(679 rebuilt manifests, plus one null-kind native manifest added for the probe and deleted afterwards).

| Reader | Result |
|---|---|
| Receiving queue `listManifests()` | 3 rows: NOKIND-1, POS-IMPORT-5c2c0000, WCIA-NATIVE-1 (null kind kept, POS-IMPORT kept) |
| Full export `listManifests({includeMigration})` | 682 rows |
| `countManifestsByStatus()` | received 1, accepted 2, **migrated 679** |

After the probe, the extra manifest was deleted and `rollback-probe.ts` restored the baseline (movedBack 3,762, deleted 679).
