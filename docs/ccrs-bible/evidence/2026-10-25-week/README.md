# 2026-10-25: PREprod, week 10/25-11/01 (a NEW week, not a re-upload)

The owner exported the current week from the hub and uploaded it to PREprod on 2026-10-25. Every file came back with an error.

| file | rows | CCRS answer |
|---|---|---|
| `Strain_413541_20261025122115.csv` | 1,500 | `errors/Strain_20261025T141519690.csv`: 7 × `Duplicate Strain` (benign `[G L0325-L0326]`); the rest filed |
| `sent/Area_413541_20261025122116.csv` | 1 | `errors/Area__20261025T141515303.csv`: `Duplicate External Identifier` (GWA-SALES-FLOOR, already on file since 10/20) |
| `Product_413541_20261025122117.csv` | 2,604 | **no error file**, only the email in `not-processed-email.txt`: *"has not been processed"*. The whole file was refused. |
| `Inventory_413541_20261025122118.csv` | 3,260 | 3,251 × `Invalid Product`, 9 × `Duplicate External Identifier` (first 20 rows in `Inventory-echo-first-20-rows.txt`) |
| `sent/Sale_413541_20261025122119.csv` | 4 | `errors/Sale__20261025T142209583.csv`: 4 × `Invalid InventoryExternalIdentifier` |

The full Product and Inventory files are not kept (0.7 MB and 0.5 MB). md5 (first 12): Product `8da5477e1f3e`, Inventory `e1f6936ea92f`, Inventory echo `d2cd01676dd3`, Strain `8dd4911531ea`.

## Why the Product file was refused whole

`sent/Product_413541_20261025122117.EXTRACT.txt` shows the evidence. It holds the header, the 14 rows with a **blank UnitWeightGrams** (all Concentrate for Inhalation) and 5 of the 140 rows with a **3-decimal** weight (e.g. 453.592).

- UnitWeightGrams is `Decimal (10,2)` and `Required on which operations: Insert, Update and Delete` `[G L0487-L0488]`.
- Other types *"can be reported as 0"* `[G L0489-L0490]`.
- No Product file CCRS ever processed had either a blank or a 3-decimal weight. The other facts checked were normal:
  - columns, names of at most 75 characters, no commas or quotes;
  - valid types;
  - no duplicate names;
  - CRLF line endings, no BOM.
- One Description was 250 characters but 257 bytes, because of an em dash and accented letters.

This is an inference: CCRS gives no reason. A blank in a decimal column is the only thing that differs from every file it ever processed.

## The cascade

1. With no product on file, every Inventory row failed `Invalid Product` `[G L0579-L0583]`.
2. With no lot on file, every sale failed `Invalid InventoryExternalIdentifier` `[G L1302-L1304]`.

The Sale file itself is fine.

## What changed (R74 S47)

- **Product.UnitWeightGrams is never blank and has at most 2 decimals.**
  - Usable Cannabis and Cannabis Mix Packaged with no weight are still held back (E9).
  - Any other type with no weight writes `0`.
- **Descriptions:** typographic dashes and quotes become ASCII, and the text is cut to 250 bytes.
- **The "has not been processed" email is recognised.**
  - The mail panel offers "Record as not processed".
  - The paste box takes the email text as well.
  - Both record the file `error-fatal`: nothing is on file, so the next export sends every row again.
- `Invalid InventoryExternalIdentifier` is now a known message, with a playbook entry.
