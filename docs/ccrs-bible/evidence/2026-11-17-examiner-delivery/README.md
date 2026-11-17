# 2026-11-17: Examiner delivery (full data set) and the 2026-11-13 delta, D250

The owner received this from the CCRS examiner (Brian) on 2026-11-17, in answer to the 11/13 full-data request. It goes together with the 11/13 delta the owner received earlier.

**The data files are NOT committed.** This repository is public, and the bible's rule is that "the seed file is LCB data and is never committed". Only hashes, headers and measured facts are recorded here. The owner keeps the files; the loader (D250 slice 2/3) re-checks the md5 below before it reads a byte.

## Files

| file | bytes | md5 | sha256 | encoding |
|---|---|---|---|---|
| `Data_Request_11_17_26_inventory.csv` | 174,883 | `c245d2a1be802ae2dd914e43b7c04601` | `7a1aa19f047e71ee9ceb598e46b958f57540f2f188275db4f45c28874aeb1443` | UTF-8 BOM, CRLF |
| `Data_Request_11_17_26_sales.csv` | 1,575,728 | `b9462d6cd2e7f762550163a179e10294` | `29eac7369048635420c8be6bd82bb0039236bc7954d60500a2bc2d768a19f68c` | UTF-8 BOM, CRLF |
| `11_17_datarequest.xlsx` (sheets `areas`, `strains`, `Product`) | 5,012,430 | `1b7d3e4b23d18791c872148c681a471f` | `b6548527f8548cc18c658423919024bb473dd6872655d65a8cc7afe9a3f08001` | xlsx |
| `Data_Request_11_13_26_inventory.csv` | 13,183 | `035a8e661418f5eb0bd37e4ffcf0d413` | `0680fddfc15d8c03d01e79312743aa874751f04e9761db2e9d9a18978ee39235` | UTF-8 BOM, CRLF |
| `Data_Request_11_13_26_sales.csv` | 305,324 | `51d35a2236bd65cfe02743cd909b0395` | `a198c1aea92657fe067da78254a90b5cc6fcd002ddcc6cfe23fac79102479ef6` | UTF-8 BOM, CRLF |

## Exact headers (after the BOM; the spelling is LCB's, including the typo and the spaces)

- 11/17 inventory: `LicenesNumber,Strain,Product Type,Product Name,isMedical,InventoryIdentifier,InitialQuantity,QuantityonHand,TotalCost,Createdby,CreatedDate,Updateby,UpdatedDate,SystemDate`
- 11/13 inventory: `LicenseNumber,Strain,Product Type,Product Name,Is medical,Inventory Identifier,Initial Quantity,Quantity on Hand,Total Cost,Created By,Created Date,Updated by, Updated Date ,System Date`
- 11/17 sales: `LicenseNumber,Name,InventoryType,InventoryIdentifier,ismedical,saletype,SaleDate,quantity,UnitPrice,Discount,SalesTax,Excisetax,SystemDate`
- 11/13 sales: `License Number,Name,Inventory Type,Inventory Identifier,is Medical,Sale Type,Sale Date,Quantity,Unit Price ,Discount,Sales Tax,Excise Tax,System Date`
- xlsx `areas`: `LicenseNumber,DBA,areaexternalIdentifier,Name,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate`
- xlsx `strains`: `LicenseNumber,DBA,Name,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate`
- xlsx `Product`: `LicenseNumber,DBA,Name,Description,ExternalIdentifier,InventoryCategory,ProductType,unitofmeasure,UnitWeightGrams,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,SystemModifiedDate`

None of these is the 2026-09-18 seed layout (`SEED_HEADERS` in `ccrs-ledger-seed-core.ts`), so the seed/reseed readers refuse them. That is correct, and it is why D250 adds a delivery reader.

## What the set is (measured)

**It is not a full inventory history.** It contains:

- the lots created after the 9/18 seed that are still open;
- the complete Product list;
- the Strains and Areas added since 9/18 (Areas: all 9).

So the full CCRS picture is the 9/18 seed (already in the ledger) plus the 11/13 delta plus the 11/17 set.

### 11/17 inventory
- 1,093 rows, 1,093 distinct ids, all license 413541.
- Every row has QoH > 0 (none zero, none negative, none above InitialQuantity).
- CreatedDate runs from 2026-08-20 to 2026-10-24 (2 in Aug, 335 in Sep, 756 in Oct). SystemDate runs from 9/19 to 10/24.
- Every row: TotalCost `0.01`, Createdby `User-110211`, Updateby and UpdatedDate `NULL`.
- isMedical is `1`/`0` (884/209).
- 606 distinct strain names (126 of them are in the `strains` sheet; the rest pre-date 9/18).
- None of the 81 lots in the 11/13 delta is in this file (0 overlap).

### 11/13 inventory
- 81 lots, all with the same shape (cost 0.01, User-110211, NULL updates).

### 11/17 sales
- 12,433 rows, all `RecreationalRetail`.
- SaleDate runs from 2026-09-18 to 2026-10-26, across 2,868 distinct lots. 910 of those lots are in the 11/17 inventory.
- **No sale is dated on or after 2026-11-01** (relevant to U-61).

### 11/13 sales
- 2,387 rows. Of these, 942 are also in the 11/17 file (multiset match on 10/24–10/26).
- The union of the two sales files covers 3,015 sold lots.

### xlsx
- `areas`: 9 rows. "Sales Floor" exists twice, as `C1100011` and `C1-11021100011`. There is also `A65303 - Default Inventory Room`.
- `strains`: 129 rows, created 2026-09-18 to 2026-10-23, with no duplicate names.
- `Product`: 65,264 rows with 65,264 distinct ExternalIdentifiers. They were created from 2018-10-04 to 2026-10-30, and 698 were created after 9/18.
  - Id shapes: `P…` 34,522; `C1-…` 17,416; `C11…` 13,326.
  - InventoryCategory: EndProduct 61,608 and IntermediateProduct 3,656.
  - Cells are typed (int license, datetime dates, float/int weight, the string `NULL` for empty updates).

## Join: inventory "Product Name" → Product

- In this layout the inventory's `Product Name` is the Product **Name** (exact), not the Description. In the 9/18 seed, "Product Name" carried the Description and "Product Identifier" gave the id.
  - 11/17: 870 rows match exactly one Product Name and 223 match more than one; 0 match none (also 0 after case and space folding).
  - 11/13: 65 rows match one and 16 match more than one; 0 match none.
- Every single match has the same ProductType as the lot.
- **Twins.** 18,594 product names are held by more than one product. These are the Cultivera pairs `C11…` / `C1-110211…`, which have the same creation date.
  - Of the 239 multi-match lot names, 237 are identical in Description, ProductType, InventoryCategory and UnitWeightGrams; 2 differ.
  - 238 names match exactly 2 products of the lot's type; 1 name matches 4 (two `C1` twins and two `P…`).
- CCRS validates the Inventory `Product` column by name ("Valid Values: Product.Name" `[G L0576]`; "submitted this product name in the same format and spelling as previously submitted on the product.CSV" `[G L0582-L0583]`). So a lot whose name is held by identical twins files correctly under that one name, whichever twin's id is recorded. New register U-82 records the remaining question: which twin CCRS links the lot to internally.

## Quantity on hand is stale (U-68)

The examiner's answer is that "Data is not changed by CCRS, it is changed by you completing an update operation on that inventory along with reporting that sale." `[EXAM2 L0065-L0066]`

The data agree:
- 825 open lots in the delivered inventories have later sales that their QoH does not reflect.
- 186 lots are sold out by those sales but still show open.
- (Recon measure: all delivered sales against Initial Quantity.) The D250 core's measure is stricter: only sales dated after the lot's own System Date, against its Quantity on Hand, with the 10/24-10/26 overlap counted once. By that measure 984 lots are stale and 205 are sold out but still open; an independent Python check gives the same counts. Both measures lead to the same conclusion.

So the delivered QoH is the last Inventory Insert/Update value, not a running balance. The cleanup must be driven by our physical count (Brian 4a: Update to 0, then Reconciliation `[EXAM2 L0029]`), never by CCRS's QoH.

## Week 2026-11-01 to 11-07 (our PREprod Sale file, 1,332 lines, 791 lots)

- 407 of those lots are in the delivered inventories (11/13 + 11/17).
- 224 more are proved to exist by Cultivera's delivered sales.
- 160 lots (269 lines) appear in neither. They were created before 9/18, so they are expected in the 9/18 seed already in the ledger. The readiness check (D250 slice 4) confirms each against the live ledger; none is assumed.

## Recon scripts (outside the repo, read-only)

`/workspace/ccrs-work/recon-2026-11-17/`: `profile.py`, `join.py`, `twins.py`, `insert_only.py`, `soldout.py`, `u68.py`, `week1.py`.
