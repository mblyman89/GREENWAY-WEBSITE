# CCRS Data Model & Upload Spec — Source of Truth (verified)

> Grounded in the WA LCB **CCRS Upload User Guide (CIB 133, 2/26)** and the official
> **.CSV templates** on the CCRS Resources page (downloaded; copies in `docs/ccrs-templates/`).
> Sources:
> - CCRS Resources: https://lcb.wa.gov/ccrs/resources
> - CCRS Integrators: https://lcb.wa.gov/ccrs/integrators
> - Upload portal: https://cannabisreporting.lcb.wa.gov/ (SAW-authenticated)
> Do NOT add/remove columns from the templates. The licensee remains responsible for content.

## How CCRS submission works (verified)
- Licensees upload **.CSV files** into CCRS (SAW login), OR assign an **approved integrator**
  to upload on their behalf. Cultivera and other POS vendors are on the approved-integrator
  list; the integrator receives **system-generated access credentials** from the LCB after
  approval (LIQ-1455 application → examiner@lcb.wa.gov).
- **There is no public real-time write API.** "Automated/real-time" reporting by integrators
  is implemented as automated **CSV generation + upload** under the integrator's credentials
  (the LCB-issued credentials / approved transport), not a documented REST API.
- **On error, the LCB emails you** a notification of the failure.

## File naming convention (verified)
- Licensees: `UploadType_LicenseNumber_YYYYMMDDHHMMSS.csv`
- Integrators: `UploadType_IntegratorID_YYYYMMDDHHMMSS.csv`

## Common file HEADER (verified — first 3 rows of every file, before the column row)
Row 1: `SubmittedBy,<value>` — Text(35), required. The submitting user (e.g. "John Doe").
Row 2: `SubmittedDate,<value>` — Date `MM/DD/YYYY`, required.
Row 3: `NumberRecords,<value>` — must EXACTLY equal the number of data rows or the file fails.
Row 4: the column header row (exact template columns).
Rows 5+: data rows.

## Common data fields (verified)
- `LicenseNumber` — Numeric(6) (labs are 10 digits). Required for Insert/Update/Delete.
- `ExternalIdentifier` — Text(100), alpha-numeric, **unique per row**; used to cross-reference
  rows across files (e.g. `InventoryExternalIdentifier`).
- `CreatedBy` Text(35), `CreatedDate` Date, `UpdatedBy`, `UpdatedDate`.
- `Operation` — the row operation: Insert / Update / Delete.

## Order of operations (verified — validation dependencies)
- **Group 1:** `Strain`, `Area`, `Product` (prerequisites for Group 2).
- **Group 2:** `Inventory` (depends on Strain+Area+Product), `Plant` (depends on Strain+Area).
- **Group 3:** `InventoryTransfer`, `InventoryAdjustment`, `Harvest`, `PlantTransfer`,
  `PlantDestruction`, `LabTest`, `Sale`.
  - InventoryTransfer / InventoryAdjustment depend on Inventory.
  - Sale depends on Inventory OR Plant.

## Reports required for a RETAILER (verified — Table 1)
A retailer (our license type) is required to report: **Area, Inventory, InventoryAdjustment,
InventoryTransfer, Product, Sale, Strain.** (Plant/Harvest/PlantDestruction/PlantTransfer are
producer/processor; LabTest is labs.)

## Exact column specs (verified from the templates, line 4 of each)

### Strain.csv
`LicenseNumber, Strain, StrainType, CreatedBy, CreatedDate`

### Area.csv
`LicenseNumber, Area, IsQuarantine, ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation`

### Product.csv
`LicenseNumber, InventoryCategory, InventoryType, Name, Description, UnitWeightGrams, ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation`

### Inventory.csv
`LicenseNumber, Strain, Area, Product, InitialQuantity, QuantityOnHand, TotalCost, IsMedical, ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation`

### InventoryAdjustment.csv
`LicenseNumber, InventoryExternalIdentifier, AdjustmentReason, AdjustmentDetail, Quantity, AdjustmentDate, ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation`

### InventoryTransfer.csv
`FromLicenseNumber, ToLicenseNumber, FromInventoryExternalIdentifier, ToInventoryExternalIdentifier, Quantity, TransferDate, ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation`
- Note: only the **receiving** licensee submits an InventoryTransfer (they know the new ID).

### Sales.csv
`LicenseNumber, SoldToLicenseNumber, InventoryExternalIdentifier, PlantExternalIdentifier, SaleType, SaleDate, Quantity, UnitPrice, Discount, RetailSalesTax, CannabisExciseTax, SaleExternalIdentifier, SaleDetailExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation`

## Tax reporting (verified — separate from CCRS)
- Retail **Sales & Excise Tax** is filed **monthly by email to cannabistaxes@lcb.wa.gov**
  (LCB Cannabis Tax & Fee Unit, 360-664-1789). See the Cannabis Tax Reporting Guide.
- The **LCB Portal** (https://portal.lcb.wa.gov/, SAW login) lets a licensee **pay fees online
  with credit/debit card** — but this is a human portal; **no public payment API exists**.
  → Our excise slice builds the return + a payment **record/reconciliation** workflow and a
  deep-link to the portal, NOT a fabricated payment integration.

## Implications for our build (Slice 54)
1. Generate each required retailer CSV **exactly** to these columns, with the 3-row header and
   correct `NumberRecords`, file naming, and `Operation` values.
2. Respect the Group 1→2→3 ordering when producing a batch.
3. Track submission status + surface failures (since the LCB notifies by email, we record the
   generated batch, let staff mark uploaded/accepted/failed, and flag out-of-sync data).
4. If the owner provides approved integrator SFTP credentials, the same generated files can be
   pushed automatically; otherwise staff upload them at cannabisreporting.lcb.wa.gov.
