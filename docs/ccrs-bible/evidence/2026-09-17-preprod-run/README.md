# Evidence — PREproduction run, 2026-09-17

Primary evidence for Part 15. **In four cases these files are more authoritative than the
Upload User Guide, because they are CCRS's own words about its own behaviour.**

Nothing here is a summary. Every file is the artifact exactly as CCRS or the LCB produced
it, so a future agent can re-derive the conclusions instead of trusting Part 15's prose.

## What is here

| Path | What it is |
|---|---|
| `errors/` | The **14 files CCRS returned**, unmodified. Each is the submitted file echoed back with an `ErrorMessage` column. |
| `success-emails-2026-09-17.txt` | Text of the **10 "PRE: CCRS Processing Successful"** emails from `info@lcb.wa.gov`. |
| `examiner-reply-2026-09-17.txt` | The full thread with the Cannabis Examiner Unit (Brian McQuay), including the question email. |
| `probes/` | The **23 probe files as uploaded**, one folder per test, each CSV keeping its CCRS-legal name. |
| `*.py` | The four scripts that produced every number in Part 15. |

## Reproduce the findings

```bash
cd docs/ccrs-bible/evidence/2026-09-17-preprod-run
python3 correlate.py   # 10 successes, 14 rejections, the 11 verbatim error strings
python3 timeline.py    # the minute-by-minute run; the 10-minute-gap observation
python3 rowcount.py    # proves rejection is all-or-nothing (U-17)
python3 coverage.py    # what our pre-flight caught: 6/14 today, 12/14 with the ledger
```

The scripts default to this folder. Override with `CCRS_EVIDENCE` / `CCRS_PROBES`.

## Two traps for whoever reads these next

1. **`ErrorMessage` is per-FILE, not per-row.** The same string is stamped on every
   returned row, including rows that are provably innocent — `AREA-2` in
   `errors/Area__20260917T130607480.csv` had never been submitted before and still came
   back "Duplicate External Identifier." Never render "row N is the problem" from this
   column.
2. **Column order is not stable between types.** Inventory error files put `ErrorMessage`
   **third** and append an `InventoryIdentifier` column we never sent; Product moves
   `UnitWeightGrams` last. **Parse by column name, never by position.**

## Provenance

Uploaded by the owner to `https://precannabisreporting.lcb.wa.gov` on 2026-09-17 between
12:52 and 13:40 Pacific, under license 413541. PREproduction only — *"These environments
are autonomous and do not share administration or reporting data."* `[FAQ L0096]` None of
this touched the production record.
