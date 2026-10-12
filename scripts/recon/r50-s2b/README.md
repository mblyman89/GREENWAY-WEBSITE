# R50 S2b: an import's lots are found by import id (real-database proof)

## Why

R50 S2c will move Cultivera lots off the import's synthetic manifest (`POS-IMPORT-<id8>`) onto manifests
rebuilt from the real transfers (`raw_payload.kind = cultivera-reconstructed`, `raw_payload.import_id`).
Every reader that found an import's lots by that ONE manifest number would lose the moved lots without any
error.

Those readers are:

- the received-date bulk page;
- the legacy-lot removal;
- the backfill count;
- the classification source tab;
- the enrichment "Cultivera import" pseudo-manifest.

S2b moves all of them onto `import-lineage-core.ts` + `import-lineage-store.ts`. That is one PostgREST read
(`.or(manifest_number.eq.POS-IMPORT-<id8>,raw_payload->>import_id.eq.<id>)`), then the pure core keeps:

- the POS-IMPORT manifest of THIS import (when the row records an import id, it must match), and
- every migration-kind manifest stamped with this import id.

A real delivery is never matched.

## How it was run

- Local PG15 with all 269 migrations applied (`scripts/compliance/verify-migrations-execute.ts`), plus
  PostgREST 12.2.3 behind a `/rest/v1` proxy.
- The SHIPPED TypeScript was run with `NEXT_PUBLIC_SUPABASE_URL` pointed at the proxy.
- `seed.sql` holds:
  - import A's POS-IMPORT manifest;
  - import B's POS-IMPORT manifest, **with the same 8-character prefix**;
  - a manifest rebuilt from A (`0001108`);
  - a native WCIA delivery;
  - six lots: A on POS undated, A on POS dated, A rebuilt undated, A rebuilt destroyed, B undated, native
    undated;
  - a published menu version for A, with cards k-a1, k-a3 and k-n1 hidden as `no_product_master`.
- The probes are `lineage-probe.ts` (received dates) and `removal-probe.ts` (removal plan, read-only).

## Measured

**main (before):**

| Probe | Result |
|---|---|
| received dates, both imports present | `THREW "Could not find this import's lots: JSON object requested, multiple (or no) rows returned"` (the 8-char prefix collision) |
| removal plan, both imports present | `found:false, rows:[]` (the same collision, reported as "no manifest") |
| received dates, B removed | lists only `A on POS undated`; **`A rebuilt undated` is missing**; dating writes 1 lot |
| removal plan, B removed | rows = lot 1 only; **the re-homed lot 3 is missing** |

**branch (after), both imports present:**

| Probe | Result |
|---|---|
| ids for A | the POS-IMPORT manifest for A + `0001108` (B's manifest is not included) |
| ids for B | B's own manifest only |
| received dates A | `A on POS undated`, `A rebuilt undated` (dated: 1) |
| received dates B | `B on POS undated` |
| date all 6 lot ids under A | writes lots 1 and 3 only |
| removal plan A | rows = lots 1 and 3; the native card k-n1 is ignored |

When dating all 6 lot ids under A, these are left alone: the dated lot, the destroyed lot, B's lot and the
native lot.

**A defect found and fixed during this measurement.** The first branch run also dated the **destroyed** lot
4: the write scope was "lots on this import's manifests", but the page only lists non-destroyed lots. The
write scope now matches the page (`excludeDestroyed`), and the run above is after that fix. A vitest pins it.

The PostgREST aliases `payload_kind:raw_payload->>kind` and `payload_import_id:raw_payload->>import_id` were
also checked on the real server. They return the text values, and `null` when absent.
