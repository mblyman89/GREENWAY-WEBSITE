# 2026-10-25: "all files failed" (a re-upload of the 2026-10-20 files)

On 2026-10-25 the owner uploaded six files to PREprod. Six error emails came back between 12:24 and 12:32 PT. The six files he sent have the **same md5 as the six 2026-10-20 files** in `../2026-10-20-real-upload/sent/`: Area `93e1274f`, Inventory `61c325f0`, InventoryAdjustment `5ae937e3`, Product `5986cf97`, Sale `3fdf523d`, Strain `378b4fe6`. CCRS had already processed those files on 2026-10-20. Product, Area, Adjustment and Sale were accepted that day, and Inventory got 13 of 18 back as Duplicate External Identifier.

| echo (in `errors/`) | rows | message | meaning |
|---|---|---|---|
| `Strain_20261025T122405198.csv` | 14 | Duplicate Strain | benign `[G L0325-L0326]` |
| `Area__20261025T122405001.csv` | 1 | Duplicate External Identifier | GWA-SALES-FLOOR is already held (accepted 10/20) |
| `Product__20261025T122405344.csv` | 18 | Duplicate External Identifier | P20261020A-GWP-000087..104 already held (accepted 10/20) |
| `Inventory__20261025T123119337.csv` | 18 | Duplicate External Identifier | all 18 lots are now held (5 accepted on 10/20, 13 were already there) |
| `InventoryAdjustment__20261025T123120263.csv` | 3 | Duplicate External Identifier | the 3 ADJ- rows already held (accepted 10/20) |
| `Sale__20261025T123200526.csv` | 7 | **Duplicate Sale for Licensee** | the first time we have received this text. CCRS refuses a sale it already holds `[G L1390]` |

## What it proves

1. **Nothing is wrong with the data.** Every row is "already on file". The Cultivera-imported products, lots and sales were accepted on 10/20. CCRS refused them on 10/25 only because it refuses the same data twice `[BRIAN A29]`.
2. **U-07 is answered.** An unchanged Sale row uploaded again comes back as `Duplicate Sale for Licensee` on every line (not ignored).
3. **Inventory: all 18 lots are held in PREprod now.** The 13 that were refused on 10/20 (and fixed later with "Settle PREprod duplicates") and the 5 accepted that day all came back as Duplicate External Identifier.
4. **The echo shapes are the same as before, with three new details.** The Sale echo renames `RetailSalesTax,CannabisExciseTax` to `SalesTax,OtherTax`. The Adjustment and Product echoes write dates as `2026-10-20`. The Area echo writes IsQuarantine as `F`. The readers parse by column name, so nothing breaks.

## What changed because of it (R74 S46)

- `Duplicate Sale for Licensee` is a known message (row-contradicts-ledger) with a playbook entry `[G L1390-L1397]`. It no longer triggers a "never seen before" examiner draft.
- When Apply finds no waiting file, `ccrs-reupload-core.ts` checks the files CCRS has already answered. If every row of every CSV ties to one of them and says "already held", the email is set aside with the reason, and nothing is written to the ledger.
- The zip README says **DO NOT UPLOAD** for a file the outbox serves again when CCRS already answered it. The file list warns next to "Download exact file" on answered files.
