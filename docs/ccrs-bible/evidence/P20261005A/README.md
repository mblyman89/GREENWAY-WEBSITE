# PREprod run P20261005A — P-04 pass-through fidelity (first attempt)

Uploaded by Michael Lyman, 2026-10-06 (Pacific). Files 01 Strain and 02 Area: **success**. File 03 Product (8 cases in one file): **failed**. Files 04–12 were not uploaded (correct: they depend on 03).

| File | What it is |
|---|---|
| `SENT_Product_413541_20261005182936.csv` | the exact bytes uploaded (copied from `preprod-P20261005A-P04/03-Product-all-cases/`) |
| `Product__20261006T113333390.csv` | CCRS's error echo, verbatim |

## What the bytes show

Sent rows 1, 4 and 7 (`P20261005A-P01`, `-P04`, `-P07`) each held a comma inside an RFC 4180-quoted cell (C1 and C4 in Description, C7 in Name). The echo returns exactly those 3 rows, each split at that comma: `"P20261005A Smith` | ` Jane Fidelity - 1g"`. Every later value moves one column right, so the Operation column gets a blank and the whole row is rejected `Operation is invalid must be Insert, Update or Delete`. The quote characters survive in the echo, so CCRS read them as data, not as CSV quoting. Rows 2, 3, 5, 6 and 8 have no comma and are **not** in the echo.

Two facts follow. First, CCRS splits each row on every comma and ignores quoting, which closes U-27 as false (S-09b). Second, only 3 of the 8 rows were echoed. That contradicts U-17, so it is recorded as an open note, settled by P-04b optional step B.

Reproduce: `tests/compliance/ccrs-csv-fidelity.test.ts` › "the PREprod evidence this slice rests on".
