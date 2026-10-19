# P-11 chunk naming — run `P20261007A` (license 413541)

> **PREPRODUCTION ONLY** — `https://precannabisreporting.lcb.wa.gov`. Do **not** upload to production.

Question (U-36): when one file is too big and is split into chunks, each chunk gets its own name one second apart. Does CCRS accept and store BOTH? (Plus, for information only: is a `_1` suffix allowed?)

## Steps

1. Upload files 1, 2, 3 (Strain, Area, Product) one at a time. Wait for each success email.
2. **Wait at least 10 minutes** [G L0530]. Upload file 4. Wait for its email. Upload file 5. Wait for its email. Upload file 6.
3. When all three Inventory emails are in, upload file 7 (the Update).
4. Save every email verbatim (and any attached CSV) into `docs/ccrs-bible/evidence/P20261007A/`.

## Files

| # | Folder | File (upload exactly as named) | Expect | Why | Result (fill in) |
|---|---|---|---|---|---|
| 1 | 01-Strain | `Strain_413541_20261006222847.csv` | PRE: CCRS Processing Successful | setup | |
| 2 | 02-Area | `Area_413541_20261006222848.csv` | PRE: CCRS Processing Successful | setup | |
| 3 | 03-Product | `Product_413541_20261006222849.csv` | PRE: CCRS Processing Successful | setup | |
| 4 | 04-Inventory-chunk-1-of-2 | `Inventory_413541_20261006222850.csv` | PRE: CCRS Processing Successful | U-36: first chunk, exactly as production names it | |
| 5 | 05-Inventory-chunk-2-of-2 | `Inventory_413541_20261006222851.csv` | PRE: CCRS Processing Successful | U-36: SAME type, name differs by ONE second, no suffix | |
| 6 | 06-Inventory-suffix-_1 | `Inventory_413541_20261006222852_1.csv` | Unknown — record what comes back | U-36 (informational): is a `_1` suffix tolerated? Production never uses one; either answer is fine | |
| 7 | 07-Inventory-Update-both-chunks | `Inventory_413541_20261006222853.csv` | PRE: CCRS Processing Successful | Proves CCRS stored the rows of BOTH chunk files (an Update of a lot it never stored is an error [FAQ L0053]) | |

## What each result means

- **Files 4 and 5 both succeed AND file 7 succeeds** → U-36 CLOSED: chunked files named one second apart are accepted and both are stored. S-12b's chunking is safe for the first big production wave.
- **File 5 fails, or file 7 fails with a record-does-not-exist error for lot `-L02`** → CCRS did not keep the second chunk. STOP: do not upload any multi-chunk production file; paste the email.
- **File 6 (`_1` suffix)** → informational. Production never uses a suffix, so success or failure changes nothing. Write down what came back.

Files are UTF-8 without a BOM, CRLF line endings, no commas inside values. Do not open them in Excel before uploading.
