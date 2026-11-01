# 2026-10-31: PREprod, the last three scoreboard tests

The owner uploaded two files to PREprod on 2026-10-31. CCRS refused every row of both. The owner's message is saved word for word in `owner-request-verbatim.md`.

| file sent | rows | CCRS answer (error file) |
|---|---|---|
| `sent/Product_413541_20261031141036.csv` | 8 Product **Update** rows | `errors/Product__20261031T185120035.csv`: 8 × `UpdatedBy is required for Update or Delete Operations: UpdatedDate is required for Update or Delete Operations: UpdatedDate must be a date for Update and Delete operations` |
| `sent/Inventory_413541_20261031142647.csv` | 6 Inventory **Update** rows | `errors/Inventory__20261031T182905659.csv`: 6 × `Strain is required` |

md5 (first 12): Product sent `dfe43b63d27f`, Product echo `575625d8dd57`, Inventory sent `084d4f5fb38a`, Inventory echo `7c9986094641`.

## Why the Product rows were refused

The sent rows have UpdatedBy and UpdatedDate **blank** on an `Update`. The guide requires them: "Each record provides an UpdatedBy field to enter the user who subsequently updated a file" and "an UpdatedDate field to enter the date that the file was modified", and "Updated Date cannot be prior to Created Date" `[G L0234-L0242]`.

This was an exporter fault. `applyProductPlan` turned rows into Updates but never filled the two cells. Inventory, Sale-correction, Transfer and Area Updates already filled them. Fixed in slice P-F with `stampProductUpdates` (ccrs-ledger-core). The last check before export (`verifyCcrsFile`) now also refuses any Update or Delete row with either cell blank.

## Why the Inventory rows were refused

All 6 lots are products with no strain set on the menu. Five are Canna Processing "Legit" infused pre-rolls and one is a Mountain Hi Shatter J's pre-roll. So the Strain cell was blank. The guide says Inventory Strain is "Required on which operations: Insert, Update and Delete" and lists the error "Strain is required" `[G L0551-L0554]`.

Fixed in slice P-F (ccrs-strain-fill-core). The strain now comes from the product, else from the lot's own strain (when CCRS holds it), else from the strain CCRS already accepted for that lot. The examiner said: "use the same strain name that was already provided for the product" `[EXAM2 L0034-L0035]`. A lot with no strain anywhere is held back (E64) with a link to the product, never sent blank.

## Why the hub said "answer unclear"

None of these four texts had been received before, so they were not in `CCRS_KNOWN_MESSAGES`. Applying the error file therefore recorded `error-unmatched` (LAW 4): every row became `uncertain`, and the scoreboard printed "answer unclear". All four are now known row errors, each with a playbook entry. Applying such a file now records the rows as refused, and the scoreboard shows CCRS's own words and the fix.
