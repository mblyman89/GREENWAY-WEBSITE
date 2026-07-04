# CCRS Public Records Extract — VERIFIED Schema

Sources (authoritative):
- WSLCB "CCRS Data Model File Specifications Manual" (v3.0, 2021-10-21) PDF —
  https://lcb.wa.gov/sites/default/files/publications/Cannabis/CCRS/CCRS%20Data%20Model%20File%20Specifications%20Manual.pdf
- WSLCB CCRS Resources (CSV templates) — https://lcb.wa.gov/ccrs/resources
- openthc/ccrs GitHub sample CSVs — https://github.com/openthc/ccrs (./csv/*.csv)

Every WA producer/processor/retailer reports these files (CSV) into CCRS. The public-records
extract released by the WSLCB is derived from the same data model (table per file). Column
headers below are the VERIFIED row-4 headers from the official CSV templates.

Every file's CSV begins with a 3-line preamble: `SubmittedBy`, `SubmittedDate`,
`NumberRecords` (or `CheckSum` for Inventory). The real column header row is line 4.

## The 11 collection files
Area, Inventory, InventoryAdjustment, InventoryTransfer, LabTest, Plant, PlantDestruction,
PlantTransfer, Product, Sale, Strain.

Common trailing columns on most files: `ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy,
UpdatedDate, Operation` (Operation ∈ Insert|Update|Delete).

## Sale.csv  ← the price + velocity engine (MOST IMPORTANT)
```
LicenseNumber, SoldToLicenseNumber, InventoryExternalIdentifier, PlantExternalIdentifier,
SaleType, SaleDate, Quantity, UnitPrice, Discount, SalesTax, OtherTax,
SaleExternalIdentifier, SaleDetailExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy,
UpdatedDate, Operation
```
- `SaleType` valid values: **RecreationalRetail, RecreationalMedical, Wholesale**.
  - `Wholesale` rows = producer/processor → retailer price (what stores PAY vendors). This is
    the wholesale-cost benchmark.
  - `RecreationalRetail` / `RecreationalMedical` rows = retailer → consumer price (retail
    shelf-price benchmark).
- `LicenseNumber` = seller; `SoldToLicenseNumber` = buyer (links supply chain / who-sells-to-whom).
- `UnitPrice, Discount, SalesTax, OtherTax` are decimals in US dollars → store as MINOR UNITS (cents).
- `InventoryExternalIdentifier` links the sale line to an Inventory lot → Product → category/type/strain.

## Product.csv  ← category/type/brand map
```
LicenseNumber, InventoryCategory, InventoryType, Name, Description, UnitWeightGrams,
ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation
```
- `InventoryCategory` (e.g., Flower Lot, Concentrate, Marijuana Mix Packaged, etc.).
- `InventoryType` = subtype (valid values depend on category).
- `Name` = product name (often encodes brand); `Description` optional.
- `UnitWeightGrams` = pack weight → enables $/gram normalization.

## Inventory.csv  ← cost basis + turns
```
LicenseNumber, Strain, Area, Product, InitialQuantity, QuantityOnHand, TotalCost, IsMedical,
ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation
```
- `TotalCost` (dollars) + `InitialQuantity` → derived unit cost basis.
- `Product` = Product.ExternalIdentifier; `Strain` = Strain.Name.

## LabTest.csv  ← potency benchmarks
```
LicenseNumber, InventoryExternalIdentifier, LabLicenseNumber, LabTestStatus, TestName,
TestDate, TestValue, ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation
```
- `TestName` (e.g., THC, THCA, CBD, Total THC...) + `TestValue` → THC/CBD ranges per category/strain.

## Strain.csv
```
Strain, StrainType, CreatedBy, CreatedDate
```
- `StrainType` ∈ (Indica/Sativa/Hybrid/CBD etc.) — links to our KB strain leaning.

## Area.csv
```
LicenseNumber, Area, IsQuarantine, ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation
```

## InventoryAdjustment.csv
```
LicenseNumber, InventoryExternalIdentifier, AdjustmentReason, AdjustmentDetail, Quantity,
AdjustmentDate, ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation
```

## PlantTransfer.csv
```
FromLicenseNumber, ToLicenseNumber, FromExternalPlantIdentifier, ToExternalPlantIdentifier,
TransferDate, ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation
```

## How the public-records extract differs from upload templates
- The upload templates above define the EXACT columns. The WSLCB public-records release is the
  aggregated data across ALL licensees (not just one), commonly delivered as large CSV files per
  table (e.g. a `Sale` file with millions of rows), sometimes zipped, sometimes split by period.
- We must therefore parse a HEADER ROW that may or may not include the 3-line preamble (the
  aggregated extract usually is just the header + rows, no SubmittedBy preamble). Our importer
  will auto-detect: if line 1 == "SubmittedBy", skip 3 lines; else treat line 1 as header.
- Column NAMES are the invariant we key on (case-insensitive), NOT column position.

## Public Records Request — how to obtain (VERIFIED)
- Online portal (preferred): https://lcbwa.govqa.us/WEBAPP/_rs/  (also portal.lcb.wa.gov)
- Email: lcbpublicrecords@lcb.wa.gov  | Phone: (360) 664-1769 | Fax: (360) 704-4940
- Mail: Public Records Office, WA State Liquor and Cannabis Board, PO Box 43080, Olympia, WA 98504-3080
- Records delivered ELECTRONICALLY by default (Gov. Directive 07-08). Large datasets may take
  time and installments.
- LEGAL CAVEAT (verbatim on Frequently Requested Lists page): "Per RCW 42.56.070(8), records
  received through the Public Records Act may not be used for commercial purposes." Owner's WSLCB
  enforcement officer confirmed retailer benchmarking use is acceptable practice; keep documented
  + owner-controlled + removable.

## Example request wording to get the benchmark dataset
"Under the Public Records Act (RCW 42.56), I request the CCRS data extract for all cannabis
licensees for the period [START]–[END], specifically the Sale, Product, Inventory, LabTest, and
Strain data tables, in CSV or Excel electronic format."
